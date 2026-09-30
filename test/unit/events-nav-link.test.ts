import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { addEventsNavLink, EVENTS_NAV_ITEM } from "../../src/events/nav-link";
import { addBallNavLink } from "../../src/ball/nav-link";

// TASK-453: while the Events page is switched on, every page's menu offers it, between About and
// Donate. Switched off, nothing changes. The Festive Ball link taught the lesson this pins: find
// the NAV LIST, not a link, or the item lands in the footer on the page whose own nav item is
// marked active.

const ROOT = resolve(__dirname, "../..");
const page = (f: string) => readFileSync(resolve(ROOT, f), "utf8");
const navList = (html: string) => html.match(/<ul class="nav-links"[\s\S]*?<\/ul>/)?.[0] ?? "";
const footer = (html: string) => html.match(/<footer[\s\S]*?<\/footer>/)?.[0] ?? "";
const hrefs = (list: string) => [...list.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);

describe("the Events item in the menu", () => {
  it("goes straight after About", () => {
    const out = addEventsNavLink(page("contact.html"));
    expect(hrefs(navList(out))).toEqual(["/", "/about-us", "/events", "/donate", "/contact", "/supporters"]);
  });

  // about.html's own About item carries class="active" aria-current="page", so a match on the
  // plain link would miss it - and the FOOTER's "About us" link is the next one in the file.
  it("finds About on the About page itself, and never touches the footer", () => {
    const before = page("about.html");
    const out = addEventsNavLink(before);
    expect(hrefs(navList(out))).toContain("/events");
    expect(hrefs(navList(out)).indexOf("/events")).toBe(hrefs(navList(out)).indexOf("/about-us") + 1);
    expect(footer(out)).toBe(footer(before));
  });

  it("keeps the markup's own indentation", () => {
    const out = addEventsNavLink(page("contact.html"));
    // \r? because a Windows checkout has CRLF line endings; the inserted line must match the file's.
    expect(out).toMatch(/\n( *)<li><a href="\/about-us">About<\/a><\/li>(\r?\n)\1<li><a href="\/events">Events<\/a><\/li>\2/);
  });

  it("is added once however many times it runs", () => {
    const once = addEventsNavLink(page("contact.html"));
    expect(addEventsNavLink(once)).toBe(once);
    expect(once.split(EVENTS_NAV_ITEM)).toHaveLength(2);
  });

  it("leaves the Events page alone, which already has its own item", () => {
    const events = page("events.html");
    expect(addEventsNavLink(events)).toBe(events);
  });

  it("leaves a page with no menu alone", () => {
    const hub = page("hub.html");
    expect(addEventsNavLink(hub)).toBe(hub);
  });

  it("sits happily beside the Festive Ball item, whichever is added first", () => {
    const a = addBallNavLink(addEventsNavLink(page("contact.html")));
    const b = addEventsNavLink(addBallNavLink(page("contact.html")));
    expect(a).toBe(b);
    expect(hrefs(navList(a))).toEqual(["/", "/about-us", "/events", "/donate", "/contact", "/supporters", "/ball"]);
  });
});
