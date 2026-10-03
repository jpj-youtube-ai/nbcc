// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { kindOptionsHtml, renderFundraiseSignUp } from "../../src/fundraising/render";
import { BUILT_IN_CATEGORIES, formCategories, rememberCategories, type Category } from "../../src/fundraising/categories";

// Fundraising categories on the sign up form: one each, A to Z, Other last, drawn from the
// list in the database, so a category an admin adds is there at once. The first one carries the
// form's "choose one" messages. Every name here is invented.

const ROOT = resolve(__dirname, "../..");
const template = readFileSync(resolve(ROOT, "fundraise.html"), "utf8");

beforeEach(() => rememberCategories(BUILT_IN_CATEGORIES));

function radios(html: string) {
  const d = new DOMParser().parseFromString(html, "text/html");
  return Array.from(d.querySelectorAll<HTMLInputElement>('#kindGroup input[name="kind"]'));
}
const labelOf = (input: HTMLInputElement) => (input.closest("label")?.textContent ?? "").trim();

describe("the categories on the sign up form", () => {
  it("are one each, A to Z, with Other last, as the page is written", () => {
    expect(radios(template).map(labelOf)).toEqual([
      "Bake sale",
      "Birthday",
      "Coffee morning",
      "Party",
      "Quiz",
      "Run",
      "Santa dash",
      "School collection",
      "Walk",
      "Workplace collection",
      "Other",
    ]);
  });

  it("as written in the page, are exactly what the server draws from the starting list", () => {
    const squash = (s: string) => s.replace(/\s+/g, " ").trim();
    const block = (template.match(/<!-- kinds -->([\s\S]*?)<!-- \/kinds -->/) ?? ["", ""])[1];
    expect(squash(block)).toBe(squash(kindOptionsHtml(formCategories())));
  });

  it("are drawn from the list in the database, with one an admin added in its place A to Z", () => {
    const list: Category[] = [
      ...BUILT_IN_CATEGORIES,
      { key: "sponsored_silence", label: "Sponsored silence", active: true },
      { key: "zumba", label: "Zumba", active: false },
    ];
    const shown = radios(renderFundraiseSignUp(template, true, formCategories(list)));
    const names = shown.map(labelOf);
    expect(names.indexOf("Sponsored silence")).toBe(names.indexOf("School collection") + 1);
    expect(names).not.toContain("Zumba");
    expect(names).not.toContain("Run or walk");
    expect(names.at(-1)).toBe("Other");
    expect(shown.find((r) => r.value === "sponsored_silence")?.id).toBe("kind-sponsored_silence");
  });

  it("puts the 'choose one' messages on the first, and only the first", () => {
    const shown = radios(renderFundraiseSignUp(template, true, formCategories()));
    expect(shown[0].getAttribute("data-invalid-raising")).toBe("Choose what you are doing to raise money");
    expect(shown[0].getAttribute("data-invalid-event")).toBe("Choose what kind of event it is");
    expect(shown.slice(1).every((r) => !r.hasAttribute("data-invalid-message"))).toBe(true);
    expect(shown.every((r) => r.required)).toBe(true);
  });

  it("writes a staff typed name as words, never as markup", () => {
    const list: Category[] = [{ key: "pies", label: "Pie & <b>mash</b>", active: true }, { key: "other", label: "Other", active: true }];
    const html = renderFundraiseSignUp(template, true, list);
    expect(html).toContain("Pie &amp; &lt;b&gt;mash&lt;/b&gt;");
    expect(radios(html).map(labelOf)).toEqual(["Pie & <b>mash</b>", "Other"]);
  });

  it("keeps the page as written when no list is given", () => {
    expect(renderFundraiseSignUp(template, true)).toBe(template);
  });
});

// Jaimie (PR #637): at two columns the list reads A to Z DOWN the left column, then down the right,
// with Other the very last (bottom right). The grid flows by column, with as many rows as half the
// list, rounded up, set by the server. The page's order (and so the tab order) stays A to Z; on a
// phone it is one column, A to Z.
describe("the categories at two columns", () => {
  const grid = (html: string) => new DOMParser().parseFromString(html, "text/html").querySelector<HTMLElement>("[data-kind-options]")!;
  const cats = (n: number): Category[] => [
    ...Array.from({ length: n - 1 }, (_, i) => ({ key: `c${String(i).padStart(2, "0")}`, label: `Cat ${String(i).padStart(2, "0")}`, active: true })),
    { key: "other", label: "Other", active: true },
  ];

  it("has half as many rows as categories, rounded up, as the page is written", () => {
    const g = grid(template);
    expect(g.classList.contains("fr-options--columns")).toBe(true);
    expect(g.style.getPropertyValue("--rows").trim()).toBe(String(Math.ceil(formCategories().length / 2)));
  });

  it.each([[11, 6], [12, 6], [13, 7], [1, 1]])("with %i categories has %i rows", (n, rows) => {
    const g = grid(renderFundraiseSignUp(template, true, cats(n)));
    expect(g.style.getPropertyValue("--rows").trim()).toBe(String(rows));
    expect(radios(renderFundraiseSignUp(template, true, cats(n))).at(-1)?.value).toBe("other");
  });

  it("flows down the columns only at two columns, never on a phone", () => {
    const css = readFileSync(resolve(ROOT, "assets/css/fundraising.css"), "utf8");
    const wide = css.match(/@media \(min-width: 640px\) \{[^}]*\.fr-options--columns \{([^}]*)\}/);
    expect(wide?.[1]).toMatch(/grid-auto-flow:\s*column/);
    expect(wide?.[1]).toMatch(/grid-template-rows:\s*repeat\(var\(--rows[^)]*\),\s*auto\)/);
    // Outside the two column rule, nothing flows by column.
    expect(css.replace(/@media \(min-width: 640px\) \{[^}]*\.fr-options--columns \{[^}]*\}\s*\}/g, "")).not.toMatch(/fr-options--columns[^}]*grid-auto-flow/);
  });
});

describe("the box for Other", () => {
  it("asks 'What is it?' until they say whether they are raising money or holding an event", () => {
    const d = new DOMParser().parseFromString(template, "text/html");
    expect(d.querySelector("label[for=kindOther] > span")?.textContent).toBe("What is it?");
  });
});
