// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// TASK-498: the fundraising help page at /fundraise/help, a draft for sign off. What is pinned here:
// it looks like the other fundraising pages, its contents list reaches every section, the A to Z
// really runs from A to Z, every outside link is https and one we checked by hand, nothing points
// at a file we do not have, no bank details are written down, and the questions panel offers the
// phone and the email side by side with a way back to the sign up. Dashes, accessibility and the
// analytics tag are checked with every other page (copy-rules, accessibility, analytics-pulse-script).

const ROOT = resolve(__dirname, "../..");
const FILE = resolve(ROOT, "fundraise-help.html");
const html = existsSync(FILE) ? readFileSync(FILE, "utf8") : "";
const doc = new DOMParser().parseFromString(html, "text/html");
const $ = (sel: string) => doc.querySelector(sel);
const $$ = (sel: string) => [...doc.querySelectorAll(sel)];
const text = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

// Every outside address on the page, each opened and read on 2026-10-02 to check it is live and
// about the right thing. A new outside link has to be added here, which means checking it first.
const CHECKED_LINKS = [
  "https://www.gov.uk/donating-to-charity/gift-aid",
  "https://www.gov.uk/public-charitable-collection-permit-scotland",
  "https://www.gamblingcommission.gov.uk/public-and-players/guide/page/how-to-run-a-fundraiser-with-lotteries-or-raffles-at-events",
  "https://www.foodstandards.gov.scot/consumer-advice/food-safety/food-safety-in-the-kitchen/parties-and-events/community-and-charity-events",
  "https://www.fundraisingregulator.org.uk/code",
];
// The footer's own links, the same on every page.
const FOOTER_LINKS = /^https:\/\/(www\.instagram\.com|www\.facebook\.com|x\.com|www\.oscr\.org\.uk)\//;

describe("the fundraising help page", () => {
  it("exists", () => {
    expect(html).not.toBe("");
  });

  it("is dressed like the sign up page", () => {
    for (const asset of ["/assets/css/styles.css", "/assets/css/pages.css", "/assets/css/fundraising.css"]) {
      expect($(`link[rel="stylesheet"][href="${asset}"]`), asset).not.toBeNull();
    }
    expect($('script[src="/assets/js/main.js"]')).not.toBeNull();
    expect($("header.nav nav ul.nav-links")).not.toBeNull();
    expect($("footer.site-footer")).not.toBeNull();
    expect($("main#main section.page-top .intro-hero h1#help-heading")).not.toBeNull();
  });

  it("is meant to be found, at its own address", () => {
    expect($('link[rel="canonical"]')?.getAttribute("href")).toBe("https://nbcc.scot/fundraise/help");
    expect($('meta[property="og:url"]')?.getAttribute("content")).toBe("https://nbcc.scot/fundraise/help");
    expect($('meta[name="robots"]')).toBeNull();
    expect(text($("title"))).toBe("Fundraising help | Night Before Christmas Campaign");
    expect($('meta[name="description"]')?.getAttribute("content")?.length).toBeGreaterThan(50);
  });

  it("has a contents list whose every link lands on a section", () => {
    const links = $$('nav[aria-labelledby="help-contents-title"] a');
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "#ideas",
      "#paying-in",
      "#gift-aid",
      "#safe-and-legal",
      "#logo",
      "#questions",
    ]);
    for (const a of links) {
      const target = doc.getElementById(a.getAttribute("href")!.slice(1));
      expect(target, a.getAttribute("href")!).not.toBeNull();
      expect(target!.tagName).toBe("SECTION");
    }
  });

  it("writes its headings in sentence case", () => {
    const proper = new Set(["A", "Z", "NBCC", "Gift", "Aid", "Scotland", "UK", "HMRC"]);
    for (const h of $$("main h2, main h3")) {
      const words = text(h).split(" ").slice(1);
      const shouting = words.filter((w) => /^[A-Z]/.test(w) && !proper.has(w.replace(/[^A-Za-z]/g, "")));
      expect(shouting, text(h)).toEqual([]);
    }
  });

  it("runs its ideas from A to Z, in order, with every letter", () => {
    const ideas = $$("#ideas .help-az li strong").map((s) => text(s));
    const letters = ideas.map((i) => i[0]);
    expect(letters).toEqual([...letters].sort());
    expect([...new Set(letters)]).toEqual("ABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""));
    expect(ideas[0]).toBe("Abseil");
    expect(ideas.at(-1)).toBe("Zumbathon");
  });

  it("links outside the site only over https, and only to addresses we have checked", () => {
    const outside = $$("a[href]")
      .map((a) => a.getAttribute("href")!)
      .filter((h) => /^[a-z]+:\/\//i.test(h) || h.startsWith("//"));
    for (const href of outside) {
      expect(href, href).toMatch(/^https:\/\//);
      expect(CHECKED_LINKS.includes(href) || FOOTER_LINKS.test(href), href).toBe(true);
    }
    for (const href of CHECKED_LINKS) expect(outside, href).toContain(href);
  });

  it("opens outside links in a new tab, safely", () => {
    for (const a of $$("main a[href^='https://']")) {
      expect(a.getAttribute("target")).toBe("_blank");
      expect(a.getAttribute("rel")).toContain("noopener");
    }
  });

  it("never points at a file the site does not have", () => {
    for (const el of $$("[href^='/assets/'], [src^='/assets/']")) {
      const path = (el.getAttribute("href") ?? el.getAttribute("src"))!;
      expect(existsSync(resolve(ROOT, path.slice(1))), path).toBe(true);
    }
  });

  it("asks people to call or email for the bank details, and never writes any down", () => {
    const paying = text($("#paying-in"));
    expect(paying.toLowerCase()).toContain("bank transfer");
    expect(paying.toLowerCase()).toMatch(/call or email us for our bank details/);
    expect(html).not.toMatch(/\b\d{2}[- ]\d{2}[- ]\d{2}\b/); // a sort code
    expect(html).not.toMatch(/\b\d{8}\b/); // an account number
    expect(html.toLowerCase()).not.toContain("sort code");
  });

  it("explains Gift Aid's 25p and when it cannot be claimed", () => {
    const giftAid = text($("#gift-aid"));
    expect(giftAid).toContain("25p");
    expect(giftAid.toLowerCase()).toContain("raffle");
    expect(giftAid.toLowerCase()).toContain("compan");
    expect($('#gift-aid a[href="https://www.gov.uk/donating-to-charity/gift-aid"]')).not.toBeNull();
  });

  it("says the safety section is general information, not legal advice", () => {
    const safe = text($("#safe-and-legal")).toLowerCase();
    expect(safe).toContain("general information");
    expect(safe).toContain("not legal advice");
    expect(safe).toContain("civic government (scotland) act 1982");
    expect(safe).toContain("fundraising for nbcc");
  });

  it("offers the phone and the email equally, and a way back to the sign up", () => {
    const panel = $("#questions");
    const phone = panel?.querySelector('a[href="tel:+441292811015"]');
    const email = panel?.querySelector('a[href="mailto:events@nbcc.scot"]');
    expect(text(phone ?? null)).toBe("01292 811 015");
    expect(text(email ?? null)).toBe("events@nbcc.scot");
    // Side by side, as the same kind of card: neither is the lesser way to reach us.
    expect(phone!.closest(".contact-point")?.className).toBe(email!.closest(".contact-point")?.className);
    expect(panel?.querySelector('a.btn[href="/fundraise"]')).not.toBeNull();
  });
});

describe("the sign up form", () => {
  it("points newcomers at the help page near the top", () => {
    const signUp = new DOMParser().parseFromString(readFileSync(resolve(ROOT, "fundraise.html"), "utf8"), "text/html");
    const link = signUp.querySelector('.intro-hero a[href="/fundraise/help"]');
    expect(link).not.toBeNull();
    expect(text(link!.parentElement)).toContain("New to fundraising?");
  });
});

// TASK-501: the private area is signed in with an emailed code now, not a link we email.
describe("paying in, on the help page", () => {
  const section = text($("#paying-in"));

  it("no longer talks about a link we email", () => {
    expect(html).not.toMatch(/using the link we email you/i);
    expect(section).not.toMatch(/link we email/i);
  });

  // Clarity audit (Jaimie, 2026-10-03): "every penny reaches NBCC" is not true of a fundraiser shared
  // with another cause, so the page makes no such promise.
  it("opens by saying how NBCC's money reaches us, with no promise about every penny", () => {
    expect(section).toContain("However you raise it, here is how NBCC’s money reaches us.");
    expect(html).not.toMatch(/every penny/i);
  });

  it("says how to sign in to the private area with a code", () => {
    expect(section).toContain(
      "Cash and sponsor money can be paid in by card from your private area. Go to nbcc.scot/fundraise/manage, put in your email address, and we will email you a code to sign in.",
    );
    expect($('#paying-in a[href="/fundraise/manage"]')).not.toBeNull();
  });
});
