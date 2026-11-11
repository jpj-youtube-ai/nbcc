import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { addElfNavLink, ELF_NAV_ITEM } from "../../src/elf/nav-link";
import { addElfMenuFit, ELF_MENU_FIT } from "../../src/elf/menu-fit";
import { addEventsNavLink } from "../../src/events/nav-link";
import { addMenuFit, MENU_FIT } from "../../src/events/menu-fit";

// TASK-613: Elf Detective School in the main menu, straight after Get involved, while it is switched on
// and from 10am on Friday 13 November 2026. Which pages carry it, and when, is in
// elf-promo-routes.test.ts; this is the item, where it goes, and the menu's fit with it. Like the Get
// involved item (events-nav-link.test.ts), it finds the nav LIST, never a link, so the footer is safe.

const ROOT = resolve(__dirname, "../..");
const page = (f: string) => readFileSync(resolve(ROOT, f), "utf8");
const navList = (html: string) => html.match(/<ul class="nav-links"[\s\S]*?<\/ul>/)?.[0] ?? "";
const footer = (html: string) => html.match(/<footer[\s\S]*?<\/footer>/)?.[0] ?? "";
const hrefs = (list: string) => [...list.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
const head = (html: string) => html.slice(0, html.indexOf("</head>"));
const withGetInvolved = () => addEventsNavLink(page("contact.html"));

describe("the Elf Detective School item in the menu", () => {
  it("says Elf Detective School in full, and goes to its front page", () => {
    expect(ELF_NAV_ITEM).toBe('<li><a href="/elf">Elf Detective School</a></li>');
  });

  it("goes straight after Get involved", () => {
    const out = addElfNavLink(withGetInvolved());
    expect(hrefs(navList(out))).toEqual(["/", "/about-us", "/get-involved", "/elf", "/donate", "/contact", "/supporters"]);
  });

  it("goes straight after About, where Get involved would be, when the menu has no Get involved", () => {
    expect(hrefs(navList(addElfNavLink(page("contact.html"))))).toEqual(["/", "/about-us", "/elf", "/donate", "/contact", "/supporters"]);
  });

  it("lands in the same place whichever of the two items is added first", () => {
    const elfFirst = addEventsNavLink(addElfNavLink(page("contact.html")));
    expect(elfFirst).toBe(addElfNavLink(withGetInvolved()));
  });

  it("finds Get involved on its own page, where the menu marks it as the page", () => {
    const list = hrefs(navList(addElfNavLink(page("get-involved.html"))));
    expect(list.indexOf("/elf")).toBe(list.indexOf("/get-involved") + 1);
  });

  it("finds About on the About page itself, and never touches the footer", () => {
    const before = page("about.html");
    const out = addElfNavLink(before);
    const list = hrefs(navList(out));
    expect(list.indexOf("/elf")).toBe(list.indexOf("/about-us") + 1);
    expect(footer(out)).toBe(footer(before));
  });

  it("keeps the markup's own indentation and line endings", () => {
    const out = addElfNavLink(withGetInvolved());
    // \r? because a Windows checkout has CRLF line endings; the inserted line must match the file's.
    expect(out).toMatch(/\n( *)<li><a href="\/get-involved">Get involved<\/a><\/li>(\r?\n)\1<li><a href="\/elf">Elf Detective School<\/a><\/li>\2/);
    expect(addElfNavLink(withGetInvolved().replace(/\r\n/g, "\n"))).not.toContain("\r");
  });

  it("goes last in a menu with neither Get involved nor About", () => {
    const bare = '<nav><ul class="nav-links" id="navLinks">\n  <li><a href="/">Home</a></li>\n</ul></nav>';
    expect(hrefs(navList(addElfNavLink(bare)))).toEqual(["/", "/elf"]);
  });

  it("is added once however many times it runs", () => {
    const once = addElfNavLink(withGetInvolved());
    expect(addElfNavLink(once)).toBe(once);
    expect(once.split(ELF_NAV_ITEM)).toHaveLength(2);
  });

  it("leaves a page with no menu alone", () => {
    const hub = page("hub.html");
    expect(addElfNavLink(hub)).toBe(hub);
  });
});

// Measured in a browser (Poppins, as the site loads it), contact.html's menu with the item: the tablet
// fit (MENU_FIT) holds it on one line from about 740px; below that "Get involved", "Elf Detective School"
// and "Contact" each broke onto a second line. With this fit every width from 681px up is one line,
// Donate in view and no sideways scroll; at 360px and 390px the burger's list is one item to a line.
describe("the menu's fit with Elf Detective School in it", () => {
  const withItem = () => addElfNavLink(addMenuFit(withGetInvolved()));

  it("goes in the head of a page whose menu has the item, after the tablet fit, so it wins", () => {
    const out = addElfMenuFit(withItem());
    expect(head(out)).toContain(ELF_MENU_FIT);
    expect(out.indexOf(ELF_MENU_FIT)).toBeGreaterThan(out.indexOf(MENU_FIT));
    expect(out.indexOf(ELF_MENU_FIT)).toBeGreaterThan(out.lastIndexOf('rel="stylesheet"'));
  });

  it("keeps every label on one line above the burger, and tightens the menu where it is narrowest", () => {
    expect(ELF_MENU_FIT).toContain("@media(min-width:681px){.nav-links a{white-space:nowrap}}");
    expect(ELF_MENU_FIT).toContain("@media(min-width:681px) and (max-width:760px){");
    // Never a box the menu could scroll inside.
    expect(ELF_MENU_FIT).not.toMatch(/overflow/);
  });

  it("brings the tablet fit along when the menu has no Get involved to bring it", () => {
    const out = addElfMenuFit(addElfNavLink(page("contact.html")));
    expect(head(out).split(MENU_FIT)).toHaveLength(2);
    expect(out.indexOf(ELF_MENU_FIT)).toBeGreaterThan(out.indexOf(MENU_FIT));
  });

  it("never adds the tablet fit a second time", () => {
    expect(addElfMenuFit(withItem()).split(MENU_FIT)).toHaveLength(2);
  });

  it("is added once however many times it runs", () => {
    const once = addElfMenuFit(withItem());
    expect(addElfMenuFit(once)).toBe(once);
  });

  it("changes nothing on a page without the item", () => {
    const plain = addMenuFit(withGetInvolved());
    expect(addElfMenuFit(plain)).toBe(plain);
    const hub = page("hub.html");
    expect(addElfMenuFit(hub)).toBe(hub);
  });

  it("has left styles.css alone, so no page's weight budget is spent", () => {
    expect(page("assets/css/styles.css")).not.toContain("max-width:760px");
  });
});
