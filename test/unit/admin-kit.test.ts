// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";

// The admin kit (assets/css/admin-kit.css and assets/js/admin/kit.js): the one set of parts every
// screen in the Donations look is built from (docs/superpowers/specs/2026-11-14-admin-refresh-design.md).
// The stylesheet's house rules are pinned here so no screen can quietly break them, and the helpers
// are run in jsdom. Every name and figure is invented.

const require = createRequire(import.meta.url);
const ROOT = resolve(__dirname, "../..");
const css = readFileSync(resolve(ROOT, "assets/css/admin-kit.css"), "utf8");
const html = readFileSync(resolve(ROOT, "admin.html"), "utf8");
const Kit = require(resolve(ROOT, "assets/js/admin/kit.js"));

const noComments = css.replace(/\/\*[\s\S]*?\*\//g, "");

/** Every selector in the sheet, with at-rules opened up and keyframe steps left out. */
function selectors(): string[] {
  const out: string[] = [];
  const flat = noComments.replace(/@keyframes[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "");
  for (const m of flat.matchAll(/([^{}]+)\{/g)) {
    const head = m[1].trim();
    if (!head || head.startsWith("@")) continue;
    // Split on the commas between selectors, never the ones inside :where( ... ) or :not( ... ).
    let depth = 0;
    let one = "";
    for (const ch of head) {
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      if (ch === "," && depth === 0) {
        out.push(one.trim());
        one = "";
      } else one += ch;
    }
    out.push(one.trim());
  }
  return out;
}

describe("the kit's stylesheet keeps the house rules", () => {
  it("names every rule through a view in the kit's look, or a kit part, so no other screen is touched", () => {
    const stray = selectors().filter(
      (s) => !(s.startsWith(".admin-view.ak") || s.startsWith(".ak-") || s === ".admin-body" || /^(button|a)\.ak-/.test(s)),
    );
    expect(stray).toEqual([]);
  });

  it("never uses !important", () => {
    expect(noComments).not.toContain("!important");
  });

  it("never makes a box that scrolls, inside itself or sideways", () => {
    expect(noComments).not.toMatch(/overflow(-x|-y)?\s*:\s*(auto|scroll)/);
  });

  it("moves only transform and opacity, and only for someone happy with motion", () => {
    const outside = noComments.replace(/@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n\}/g, "");
    expect(outside).not.toMatch(/transition\s*:/);
    expect(outside).not.toMatch(/animation\s*:/);
    const transitions = [...noComments.matchAll(/transition\s*:\s*([^;]+);/g)].map((m) => m[1]);
    expect(transitions.length).toBeGreaterThan(0);
    transitions.forEach((t) => expect(t.trim().startsWith("transform")).toBe(true));
  });

  it("has no side stripe and no gradient words", () => {
    expect(noComments).not.toMatch(/border-left\s*:\s*\d+px solid/);
    expect(noComments).not.toContain("background-clip: text");
  });

  it("gives every button and field in the look a finger's height", () => {
    const rule = (start: string) => {
      const at = noComments.indexOf(start);
      expect(at, start).toBeGreaterThan(-1);
      return noComments.slice(at, noComments.indexOf("}", at));
    };
    [".admin-view.ak .admin-btn, .ak-btn {", ".admin-view.ak .btn {", ".admin-view.ak .admin-seg {", ".ak-part-btn {", ".admin-view.ak .admin-page-btn {", ".admin-view.ak .admin-back {"].forEach(
      (start) => expect(rule(start)).toMatch(/min-height:\s*4[4-9]px/),
    );
    expect(rule(".admin-view.ak :where(input:not(")).toMatch(/min-height:\s*46px/);
    // 16px or more in a field, or an iPhone zooms the page in when it is tapped.
    expect(rule(".admin-view.ak :where(input:not(")).toContain("font-size: 1rem");
  });

  it("draws the public site's pill button as the look's own, with no arrow", () => {
    expect(noComments).toContain('.admin-view.ak .btn::after { content: none; }');
    expect(noComments).toContain(".admin-view.ak .btn-primary, .admin-view.ak .btn-holly { background: var(--ov-holly);");
  });

  it("pins the bar of parts on a laptop and lets it sit in the page on a phone", () => {
    expect(noComments).toContain(".ak-parts { position: sticky; top: 60px;");
    const phone = noComments.slice(noComments.indexOf("@media (max-width: 860px)"));
    expect(phone).toContain(".ak-parts { position: static;");
  });

  it("is loaded after the old look and the Overview's colours, and its script before app.js", () => {
    const at = (needle: string) => {
      const i = html.indexOf(needle);
      expect(i, needle).toBeGreaterThan(-1);
      return i;
    };
    expect(at("/assets/css/admin-kit.css")).toBeGreaterThan(at("/assets/css/admin.css"));
    expect(at("/assets/css/admin-kit.css")).toBeGreaterThan(at("/assets/css/admin-overview.css"));
    expect(at("/assets/js/admin/kit.js")).toBeLessThan(at("/assets/js/admin/app.js"));
  });
});

describe("plural", () => {
  it("says one of a thing and many of a thing", () => {
    expect(Kit.plural(1, "gift", "gifts")).toBe("1 gift");
    expect(Kit.plural(0, "gift", "gifts")).toBe("0 gifts");
    expect(Kit.plural(12, "gift", "gifts")).toBe("12 gifts");
    expect(Kit.plural(undefined, "gift", "gifts")).toBe("0 gifts");
  });
});

describe("labelCells", () => {
  const table = (body: string) => {
    document.body.innerHTML =
      "<table><thead><tr><th>Name</th><th> Amount\n given </th><th></th></tr></thead><tbody>" + body + "</tbody></table>";
    return document.querySelector("table") as HTMLTableElement;
  };

  it("names each cell after its column's heading, tidying the spaces", () => {
    const t = table("<tr><td>Rowan Example</td><td>£25</td><td><button>Open</button></td></tr>");
    Kit.labelCells(t);
    const cells = t.querySelectorAll("tbody td");
    expect(cells[0].getAttribute("data-label")).toBe("Name");
    expect(cells[1].getAttribute("data-label")).toBe("Amount given");
  });

  it("leaves a cell under a heading with no words unnamed", () => {
    const t = table("<tr><td>Rowan Example</td><td>£25</td><td><button>Open</button></td></tr>");
    Kit.labelCells(t);
    expect(t.querySelectorAll("tbody td")[2].hasAttribute("data-label")).toBe(false);
  });

  it("keeps a name a cell was already given", () => {
    const t = table('<tr><td data-label="Who">Rowan Example</td><td>£25</td><td></td></tr>');
    Kit.labelCells(t);
    expect(t.querySelector("tbody td")!.getAttribute("data-label")).toBe("Who");
  });

  it("does not name a cell that spans the table, such as a nothing here line", () => {
    const t = table('<tr><td colspan="3">Nothing yet.</td></tr>');
    Kit.labelCells(t);
    expect(t.querySelector("tbody td")!.hasAttribute("data-label")).toBe(false);
  });

  it("counts a spanning cell's columns, so the cells after it are still named rightly", () => {
    document.body.innerHTML =
      "<table><thead><tr><th>A</th><th>B</th><th>C</th></tr></thead><tbody><tr><td colspan=\"2\">wide</td><td>last</td></tr></tbody></table>";
    const t = document.querySelector("table") as HTMLTableElement;
    Kit.labelCells(t);
    expect(t.querySelectorAll("tbody td")[1].getAttribute("data-label")).toBe("C");
  });

  it("does nothing, and does not throw, for a table with no headings or no table at all", () => {
    document.body.innerHTML = "<table><tbody><tr><td>x</td></tr></tbody></table>";
    expect(() => Kit.labelCells(document.querySelector("table"))).not.toThrow();
    expect(() => Kit.labelCells(null)).not.toThrow();
    expect(document.querySelector("td")!.hasAttribute("data-label")).toBe(false);
  });
});

describe("wireParts", () => {
  const build = (pressed = "") => {
    document.body.innerHTML =
      '<div id="root"><div class="ak-parts" role="group" aria-label="Which part to show">' +
      ["glance", "money", "history"]
        .map((k) => `<button type="button" class="ak-part-btn" data-akpart="${k}" aria-pressed="${k === pressed}">${k}</button>`)
        .join("") +
      "</div>" +
      ["glance", "money", "history"].map((k) => `<div class="ak-part" data-akpart-body="${k}" hidden>${k} body</div>`).join("") +
      "</div>";
    return document.getElementById("root") as HTMLElement;
  };
  const shown = (root: HTMLElement) =>
    [...root.querySelectorAll<HTMLElement>("[data-akpart-body]")].filter((p) => !p.hidden).map((p) => p.getAttribute("data-akpart-body"));
  const pressed = (root: HTMLElement) =>
    [...root.querySelectorAll("[data-akpart]")].filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.getAttribute("data-akpart"));

  it("opens on the first part, with only that one showing", () => {
    const root = build();
    const parts = Kit.wireParts(root);
    expect(shown(root)).toEqual(["glance"]);
    expect(pressed(root)).toEqual(["glance"]);
    expect(parts.current()).toBe("glance");
  });

  it("opens on the part already pressed, or the one asked for", () => {
    const a = build("money");
    Kit.wireParts(a);
    expect(shown(a)).toEqual(["money"]);
    const b = build();
    Kit.wireParts(b, { start: "history" });
    expect(shown(b)).toEqual(["history"]);
  });

  it("falls back to the first part when asked for one that is not there", () => {
    const root = build();
    Kit.wireParts(root, { start: "nothing" });
    expect(shown(root)).toEqual(["glance"]);
  });

  it("shows a part when its button is pressed, and tells the caller", () => {
    const root = build();
    const onShow = vi.fn();
    Kit.wireParts(root, { onShow });
    (root.querySelector('[data-akpart="money"]') as HTMLElement).click();
    expect(shown(root)).toEqual(["money"]);
    expect(pressed(root)).toEqual(["money"]);
    expect(onShow).toHaveBeenLastCalledWith("money");
  });

  it("brings the bar back into view on a press where the bar is not pinned", () => {
    const root = build();
    const bar = root.querySelector(".ak-parts") as HTMLElement;
    bar.scrollIntoView = vi.fn();
    Kit.wireParts(root);
    (root.querySelector('[data-akpart="history"]') as HTMLElement).click();
    expect(bar.scrollIntoView).toHaveBeenCalledWith({ block: "start" });
  });

  it("brings the part itself into view where the bar is pinned", () => {
    const root = build();
    const bar = root.querySelector(".ak-parts") as HTMLElement;
    bar.style.position = "sticky";
    const part = root.querySelector('[data-akpart-body="history"]') as HTMLElement;
    part.scrollIntoView = vi.fn();
    Kit.wireParts(root);
    (root.querySelector('[data-akpart="history"]') as HTMLElement).click();
    expect(part.scrollIntoView).toHaveBeenCalledWith({ block: "start" });
  });

  it("moves along the bar with the arrow keys, Home and End, going round at the ends", () => {
    const root = build();
    Kit.wireParts(root);
    const key = (from: string, k: string) =>
      root.querySelector(`[data-akpart="${from}"]`)!.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
    key("glance", "ArrowRight");
    expect(shown(root)).toEqual(["money"]);
    expect(document.activeElement?.getAttribute("data-akpart")).toBe("money");
    key("money", "End");
    expect(shown(root)).toEqual(["history"]);
    key("history", "ArrowRight");
    expect(shown(root)).toEqual(["glance"]);
    key("glance", "ArrowLeft");
    expect(shown(root)).toEqual(["history"]);
    key("history", "Home");
    expect(shown(root)).toEqual(["glance"]);
  });

  it("skips a button that is hidden, such as a part this person may not see", () => {
    const root = build();
    (root.querySelector('[data-akpart="money"]') as HTMLElement).hidden = true;
    Kit.wireParts(root);
    root.querySelector('[data-akpart="glance"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
    expect(shown(root)).toEqual(["history"]);
  });

  it("leaves another bar's parts further in alone", () => {
    const root = build();
    const inner = root.querySelector('[data-akpart-body="money"]') as HTMLElement;
    inner.innerHTML = '<div class="ak-part" data-akpart-body="inner">inner body</div>';
    Kit.wireParts(root);
    (root.querySelector('[data-akpart="money"]') as HTMLElement).click();
    expect((inner.querySelector('[data-akpart-body="inner"]') as HTMLElement).hidden).toBe(false);
  });

  it("does nothing, and does not throw, where there is no bar", () => {
    document.body.innerHTML = '<div id="root"></div>';
    const parts = Kit.wireParts(document.getElementById("root"));
    expect(parts.current()).toBe(null);
    expect(() => parts.show("x")).not.toThrow();
    expect(() => Kit.wireParts(null)).not.toThrow();
  });
});

describe("the spreadsheet", () => {
  it("writes rows as a csv, quoting only what needs it", () => {
    expect(Kit.toCsv([["Name", "Amount"], ["Rowan Example", 25], ['Sam "Sammy" Example', "1,000"]])).toBe(
      'Name,Amount\r\nRowan Example,25\r\n"Sam ""Sammy"" Example","1,000"',
    );
  });

  it("keeps a cell that would run as a formula in Excel as plain words", () => {
    expect(Kit.csvCell("=HYPERLINK(\"http://example.com\")")).toBe("\"'=HYPERLINK(\"\"http://example.com\"\")\"");
    expect(Kit.csvCell("+441234567890")).toBe("'+441234567890");
    expect(Kit.csvCell("-5")).toBe("'-5");
    expect(Kit.csvCell("@someone")).toBe("'@someone");
  });

  it("leaves a number a number, and nothing as an empty cell", () => {
    expect(Kit.csvCell(-5)).toBe("-5");
    expect(Kit.csvCell(null)).toBe("");
    expect(Kit.csvCell(undefined)).toBe("");
    expect(Kit.csvCell(NaN)).toBe("");
  });

  it("keeps a cell with a line break in it as one cell", () => {
    expect(Kit.toCsv([["a\nb", "c"]])).toBe('"a\nb",c');
  });

  it("hands over a file with the name it is given, marked as UTF-8", async () => {
    let made: Blob | null = null;
    const clicked: string[] = [];
    const win = {
      document,
      Blob,
      setTimeout: (fn: () => void) => fn(),
      URL: { createObjectURL: (b: Blob) => ((made = b), "blob:made"), revokeObjectURL: vi.fn() },
    };
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this.download + " " + this.getAttribute("href"));
    });
    expect(Kit.downloadCsv("claims.csv", [["Name"], ["Rowan Example"]], win)).toBe(true);
    click.mockRestore();
    expect(clicked).toEqual(["claims.csv blob:made"]);
    expect(made!.type).toBe("text/csv;charset=utf-8");
    expect(win.URL.revokeObjectURL).toHaveBeenCalledWith("blob:made");
    expect(document.querySelector("a[download]")).toBe(null);
  });

  it("says it could not where the browser cannot make a file", () => {
    expect(Kit.downloadCsv("claims.csv", [["Name"]], { document })).toBe(false);
  });
});

describe("copyText", () => {
  it("copies the words and says it did", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    await expect(Kit.copyText("hello", { navigator: { clipboard: { writeText } } })).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello");
  });

  it("says it could not, without throwing, when the browser refuses or cannot", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("no"));
    await expect(Kit.copyText("hello", { navigator: { clipboard: { writeText } } })).resolves.toBe(false);
    await expect(Kit.copyText("hello", { navigator: {} })).resolves.toBe(false);
  });
});
