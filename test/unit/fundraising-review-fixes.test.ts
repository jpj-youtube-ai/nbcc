// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { renderGetInvolvedPage, renderFundraiserCard, renderFundraiserPage } from "../../src/fundraising/render";
import { addFundraiseFooterLink } from "../../src/fundraising/footer-link";
import { meter, type PublicCard, type PublicPage } from "../../src/fundraising/model";
import { SEED_EVENTS } from "./helpers/events-seed";

// TASK-494 review fixes, each pinned here. Every name and address is invented.

const ROOT = resolve(__dirname, "../..");
const require = createRequire(import.meta.url);
const read = (f: string) => readFileSync(resolve(ROOT, f), "utf8");
const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");
const TODAY = "2026-10-02";

const card = (over: Partial<PublicCard> = {}): PublicCard => ({
  id: 41, slug: "robins-santa-dash", path: "raising", kind: "santa_dash", kindLabel: "A Santa dash", title: "Robin's Santa Dash",
  description: "Five kilometres.", eventDate: null, startTime: null, venue: "", town: "", imageSrc: null, organisedBy: "Robin Q.",
  url: "/fundraise/robins-santa-dash", meter: meter({ onlinePence: 0, cashPence: 0, targetPence: 10000 }), ...over,
});
const page = (): PublicPage => ({ ...card(), wall: [], giving: { fundraiserId: 41, minimumPence: 200 } });
const gi = (on: boolean, fundraisers: PublicCard[] = [card()]) =>
  renderGetInvolvedPage(read("events.html"), { events: SEED_EVENTS, fundraisers, fundraisingOn: on, today: TODAY });

describe("Get involved is exactly as before while fundraising is off", () => {
  it("does not load the fundraising stylesheet while off, and does while on", () => {
    expect(gi(false)).not.toContain("fundraising.css");
    expect(parse(gi(true)).querySelector('link[href="/assets/css/fundraising.css"]')).not.toBeNull();
  });
});

describe("the hint above the deck", () => {
  it("only promises that event cards turn over, once fundraiser cards are among them", () => {
    expect(parse(gi(false)).querySelector("[data-deck-hint]")?.textContent?.trim()).toBe("Turn any card over for the full details.");
    expect(parse(gi(true)).querySelector("[data-deck-hint]")?.textContent?.trim()).toBe("Turn any event card over for the full details.");
  });
});

describe("a fundraiser card's date", () => {
  it("shows a date still to come in the corner", () => {
    expect(renderFundraiserCard(card({ eventDate: "2026-12-05" }), TODAY)).toContain('class="ev-index"');
  });
  it("leaves a date that has passed out of the corner", () => {
    expect(renderFundraiserCard(card({ eventDate: "2026-09-01" }), TODAY)).not.toContain('class="ev-index"');
  });
});

describe("the thank you after paying", () => {
  const draw = (thanks?: { message: boolean }) =>
    parse(renderFundraiserPage(read("fundraiser.html"), page(), { pageUrl: "https://nbcc.test/fundraise/robins-santa-dash", now: new Date(), thanks }));

  it("is not there on an ordinary visit", () => {
    expect(draw().querySelector("[data-thanks-panel]")).toBeNull();
  });

  it("thanks them by the fundraiser's name, with the share links", () => {
    const panel = draw({ message: false }).querySelector("[data-thanks-panel]")!;
    expect(panel.textContent).toContain("Thank you for supporting Robin's Santa Dash.");
    expect(panel.querySelector('a[href^="https://www.facebook.com/sharer/sharer.php"]')).not.toBeNull();
    expect(panel.querySelector('a[href^="https://wa.me/"]')).not.toBeNull();
    expect(panel.textContent).not.toContain("message");
  });

  it("says their message will be on the wall shortly when they left one", () => {
    expect(draw({ message: true }).querySelector("[data-thanks-panel]")?.textContent).toContain("Your message will appear on the wall shortly.");
  });

  it("comes before the rest of the page, and takes focus for a screen reader", () => {
    const d = draw({ message: false });
    const panel = d.querySelector("[data-thanks-panel]")!;
    expect(panel.getAttribute("tabindex")).toBe("-1");
    expect(panel.compareDocumentPosition(d.querySelector(".fr-summary")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("copying the link works from every copy button on the page", () => {
  it("binds each one, and each says so beside itself", async () => {
    const { initShare } = require(resolve(ROOT, "assets/js/fundraiser.js"));
    const d = renderFundraiserPage(read("fundraiser.html"), page(), { pageUrl: "https://nbcc.test/fundraise/robins-santa-dash", now: new Date(), thanks: { message: false } });
    document.documentElement.innerHTML = parse(d).documentElement.innerHTML;
    const writeText = vi.fn(() => Promise.resolve());
    initShare(document, { navigator: { clipboard: { writeText } } });
    const buttons = [...document.querySelectorAll<HTMLButtonElement>("[data-copy-link]")];
    expect(buttons.length).toBe(2);
    buttons[0].click();
    await new Promise((r) => setTimeout(r, 0));
    expect(buttons[0].closest("section, aside, div.fr-thanks-panel")?.querySelector("[data-copy-status]")?.textContent).toBe("Link copied. You can paste it anywhere.");
  });
});

describe("the footer's Fundraise for us link", () => {
  const contact = read("contact.html");
  it("goes to the sign up while fundraising is on", () => {
    const out = addFundraiseFooterLink(contact);
    expect(out).toContain('<a href="/fundraise">Fundraise for us</a>');
    expect(out).not.toContain('<a href="/contact">Fundraise for us</a>');
  });
  it("changes nothing else, and is safe to run twice", () => {
    const once = addFundraiseFooterLink(contact);
    expect(addFundraiseFooterLink(once)).toBe(once);
    expect(once.replace('<a href="/fundraise">Fundraise for us</a>', '<a href="/contact">Fundraise for us</a>')).toBe(contact);
  });
});

describe("the meter's fill", () => {
  it("has a plain colour first, for browsers without color-mix", () => {
    const css = read("assets/css/fundraising.css");
    const rule = css.match(/\.fr-meter__fill\s*\{[^}]*\}/)?.[0] ?? "";
    expect(rule).toMatch(/background:\s*var\(--holly\);[\s\S]*background:\s*linear-gradient/);
  });
});

describe("the manage link's token", () => {
  it("is taken out of the address bar once read", async () => {
    const { initManage } = require(resolve(ROOT, "assets/js/fundraise-manage.js"));
    document.documentElement.innerHTML = parse(read("fundraise-manage.html")).documentElement.innerHTML;
    const replaceState = vi.fn();
    initManage(document, {
      location: { search: "?token=tok123", pathname: "/fundraise/manage" },
      history: { replaceState },
      fetch: vi.fn(() => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) })),
    });
    expect(replaceState).toHaveBeenCalledWith(null, "", "/fundraise/manage");
  });
});

describe("the SEO listing migration", () => {
  const FILE = "1791200000010_site-seo-get-involved.js";
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const migration = require(resolve(ROOT, "migrations", FILE));

  it("sorts after everything before it, the core's included", () => {
    const all = readdirSync(resolve(ROOT, "migrations")).filter((f) => f.endsWith(".js")).sort();
    expect(all.indexOf(FILE)).toBeGreaterThan(all.indexOf("1791200000002_newsletter-source-fundraise.js"));
  });

  it("copies a saved choice for /events to /get-involved, only where none exists, and changes nothing else", () => {
    const sql: string[] = [];
    migration.up({ sql: (s: string) => sql.push(s) });
    expect(sql).toHaveLength(1);
    const q = sql[0].replace(/\s+/g, " ").trim();
    expect(q).toMatch(/^INSERT INTO site_page_seo \(page_path, listed, updated_by, updated_at\)/);
    expect(q).toContain("SELECT '/get-involved', listed,");
    expect(q).toContain("FROM site_page_seo WHERE page_path = '/events'");
    expect(q).toContain("ON CONFLICT (page_path) DO NOTHING");
    expect(q).not.toMatch(/\b(UPDATE|DELETE|DROP|ALTER)\b/);
  });

  it("goes back by removing only the copy it made", () => {
    const sql: string[] = [];
    migration.down({ sql: (s: string) => sql.push(s) });
    const q = sql.join(" ").replace(/\s+/g, " ");
    expect(q).toContain("DELETE FROM site_page_seo WHERE page_path = '/get-involved' AND updated_by = 'migration:get-involved'");
  });
});
