import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// TASK-557: a screen's styles are part of the screen. TASK-513 restyled the Fundraising switch by
// replacing everything between two copies of one comment in admin.css, and every rule for
// Admin > Analytics and for QR codes went with it. Both screens drew as unstyled text for two days
// and no check failed, because nothing read the stylesheet. These do.

const ROOT = resolve(__dirname, "../..");
const read = (file: string) => readFileSync(resolve(ROOT, file), "utf8");
const adminCss = read("assets/css/admin.css");
const html = read("admin.html");
const appSrc = read("assets/js/admin/app.js");

// The names in every class="…" of some markup, whether it is HTML or a string app.js builds. In a
// built string a name can be followed by a quote and a "+", so whatever is not part of a name is
// trimmed off, and a piece that is only the start of a name ("nl-pill-" + kind) is left out.
function classNames(markup: string): string[] {
  const found = new Set<string>();
  for (const m of markup.matchAll(/class=\\?"([^"]*)/g)) {
    for (const word of m[1].split(/\s+/)) {
      const name = word.replace(/[^\w-].*$/, "");
      if (/^[a-z][\w-]*[a-z0-9]$/i.test(name)) found.add(name);
    }
  }
  return [...found].sort();
}

// One screen of admin.html: from its own <section id="view-…"> to the next screen's.
function screen(id: string): string {
  const start = html.indexOf(`id="${id}"`);
  const next = html.indexOf('<section class="admin-view', start);
  return start < 0 ? "" : html.slice(start, next < 0 ? html.length : next);
}

// A rule for the class in a selector that names the screen: "#view-analytics … .an-row … {".
function hasRule(scope: string, name: string): boolean {
  return new RegExp(`${scope}[^{}]*\\.${name}(?![\\w-])[^{}]*\\{`).test(adminCss);
}

describe.each([
  // "an-now-card" names the Right now card for the script and has no style of its own.
  { screenId: "view-analytics", prefix: "an-", namesOnly: ["an-now-card"] },
  { screenId: "view-qr", prefix: "qr-", namesOnly: [] as string[] },
])("the styles for #$screenId", ({ screenId, prefix, namesOnly }) => {
  const used = [...new Set([...classNames(screen(screenId)), ...classNames(appSrc)])].filter((name) => name.startsWith(prefix));
  const styled = used.filter((name) => !namesOnly.includes(name));

  it("reads the screen's own classes from the page and from what app.js draws", () => {
    expect(used.length).toBeGreaterThanOrEqual(8);
  });

  it.each(styled)("has a rule for .%s, scoped to the screen", (name) => {
    expect(hasRule(`#${screenId}`, name)).toBe(true);
  });

  it.each(namesOnly)("still uses .%s as a name only", (name) => {
    expect(used).toContain(name);
    expect(hasRule(`#${screenId}`, name)).toBe(false);
  });
});

describe("no screen loses its styles", () => {
  // Every class in admin.html and in app.js's markup, grouped by the part before its first hyphen
  // (an-, qr-, fr-, nl-, fx-…). Some names are only handles for the script, so not every class has
  // a rule. A family of five or more where most have none has lost its block, whichever screen it is.
  it("styles at least half of every family of five or more classes", () => {
    const styledNames = new Set<string>();
    for (const m of (adminCss + read("assets/css/styles.css")).matchAll(/\.(-?[a-z_][\w-]*)/gi)) styledNames.add(m[1]);
    const families = new Map<string, { used: number; styled: number }>();
    for (const name of new Set([...classNames(html), ...classNames(appSrc)])) {
      if (!name.includes("-")) continue;
      const family = families.get(name.split("-")[0]) ?? { used: 0, styled: 0 };
      family.used += 1;
      if (styledNames.has(name)) family.styled += 1;
      families.set(name.split("-")[0], family);
    }
    const lost = [...families]
      .filter(([, f]) => f.used >= 5 && f.styled * 2 < f.used)
      .map(([prefix, f]) => `${prefix}-: ${f.styled} of ${f.used} styled`);
    expect(lost).toEqual([]);
  });
});
