// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { kindOptionsHtml, renderFundraiseSignUp } from "../../src/fundraising/render";
import { BUILT_IN_CATEGORIES, formCategories, rememberCategories, type Category } from "../../src/fundraising/categories";

// Fundraising categories on the sign up form: one each, A to Z, Something else last, drawn from the
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
  it("are one each, A to Z, with Something else last, as the page is written", () => {
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
      "Something else",
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
    expect(names.at(-1)).toBe("Something else");
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
    const list: Category[] = [{ key: "pies", label: "Pie & <b>mash</b>", active: true }, { key: "other", label: "Something else", active: true }];
    const html = renderFundraiseSignUp(template, true, list);
    expect(html).toContain("Pie &amp; &lt;b&gt;mash&lt;/b&gt;");
    expect(radios(html).map(labelOf)).toEqual(["Pie & <b>mash</b>", "Something else"]);
  });

  it("keeps the page as written when no list is given", () => {
    expect(renderFundraiseSignUp(template, true)).toBe(template);
  });
});
