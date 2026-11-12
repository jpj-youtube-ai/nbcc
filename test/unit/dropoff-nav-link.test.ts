import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { addDropOffNavLink, dropOffNavShown, DROPOFF_NAV_ITEM, DROPOFF_MENU_FIT, addDropOffMenuFit } from "../../src/site/dropoff-nav";
import { addEventsNavLink } from "../../src/events/nav-link";
import { addElfNavLink } from "../../src/elf/nav-link";
import { decorateBallPage } from "../../src/ball/page-decor";

// Jaimie, 12 November 2026: "Drop-off points" in the main menu, straight after Get involved, until the
// collection ends (taken off after Sunday 20 December 2026). Every page gains it as it goes out.

const ROOT = resolve(__dirname, "../..");
const contact = readFileSync(resolve(ROOT, "contact.html"), "utf8");
const menu = (html: string) => {
  const start = html.indexOf('class="nav-links"');
  return html.slice(start, html.indexOf("</ul>", start));
};
const labels = (html: string) => [...menu(html).matchAll(/<a [^>]*>([^<]+)<\/a>/g)].map((m) => m[1]);

describe("the item", () => {
  it("goes to the drop-off points page", () => {
    expect(DROPOFF_NAV_ITEM).toBe('<li><a href="/get-involved/drop-off-points">Drop-off points</a></li>');
  });

  it("goes straight after Get involved, and before Elf Detective School whichever is added first", () => {
    const withGi = addEventsNavLink(contact);
    expect(labels(addDropOffNavLink(withGi)).slice(0, 4)).toEqual(["Home", "About", "Get involved", "Drop-off points"]);
    const both = addDropOffNavLink(addElfNavLink(withGi));
    expect(labels(both).slice(0, 5)).toEqual(["Home", "About", "Get involved", "Drop-off points", "Elf Detective School"]);
  });

  it("goes after About when there is no Get involved, and last when there is neither", () => {
    expect(labels(addDropOffNavLink(contact)).slice(0, 3)).toEqual(["Home", "About", "Drop-off points"]);
    const bare = '<ul class="nav-links" id="navLinks">\n  <li><a href="/">Home</a></li>\n</ul>';
    expect(labels(addDropOffNavLink(bare))).toEqual(["Home", "Drop-off points"]);
  });

  it("is in the menu once, however many times it is added, and never in the footer", () => {
    const once = addDropOffNavLink(addEventsNavLink(contact));
    expect(addDropOffNavLink(once)).toBe(once);
    expect(once.split("Drop-off points</a>").length - 1).toBe(1 + (contact.split("Drop-off points</a>").length - 1));
  });

  it("leaves a page with no menu as it is", () => {
    expect(addDropOffNavLink("<html><body>nothing</body></html>")).toBe("<html><body>nothing</body></html>");
  });

  it("keeps the file's own line endings", () => {
    const crlf = addEventsNavLink(contact.replace(/\r?\n/g, "\r\n"));
    expect(addDropOffNavLink(crlf)).not.toMatch(/[^\r]\n/);
  });
});

describe("when it shows", () => {
  it("shows now and all through Sunday 20 December 2026, in UK time", () => {
    expect(dropOffNavShown(new Date("2026-11-12T12:00:00Z"))).toBe(true);
    expect(dropOffNavShown(new Date("2026-12-20T23:59:00Z"))).toBe(true);
  });

  it("is taken off from Monday 21 December 2026", () => {
    expect(dropOffNavShown(new Date("2026-12-21T00:00:00Z"))).toBe(false);
    expect(dropOffNavShown(new Date("2027-03-01T12:00:00Z"))).toBe(false);
  });

  it("does not show for a time that makes no sense", () => {
    expect(dropOffNavShown(new Date("not a date"))).toBe(false);
  });
});

describe("the Festive Ball's own pages", () => {
  it("carry it when the route says the collection is on, and not when it is over", () => {
    const ball = readFileSync(resolve(ROOT, "ball.html"), "utf8");
    const on = decorateBallPage(ball, { ballItem: true, eventsOn: true, fundraisingOn: false, dropOffOn: true });
    expect(menu(on)).toContain(DROPOFF_NAV_ITEM);
    expect(on).toContain(DROPOFF_MENU_FIT);
    const off = decorateBallPage(ball, { ballItem: true, eventsOn: true, fundraisingOn: false, dropOffOn: false });
    expect(off).not.toContain(DROPOFF_NAV_ITEM);
  });
});

describe("the menu's fit with one more item", () => {
  it("goes in the head once, only on a page whose menu has the item", () => {
    const page = addDropOffNavLink(addEventsNavLink(contact));
    const fitted = addDropOffMenuFit(page);
    expect(fitted.split(DROPOFF_MENU_FIT).length - 1).toBe(1);
    expect(fitted.indexOf(DROPOFF_MENU_FIT)).toBeLessThan(fitted.indexOf("</head>"));
    expect(addDropOffMenuFit(fitted)).toBe(fitted);
    expect(addDropOffMenuFit(contact)).toBe(contact);
  });

  it("never lets the menu scroll inside a box", () => {
    expect(DROPOFF_MENU_FIT).not.toMatch(/overflow(-x)?:\s*(auto|scroll)/);
  });
});
