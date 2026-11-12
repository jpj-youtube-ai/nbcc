import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { renderCalendarPage } from "../../src/elf/pages/calendar";
import { renderHqPage } from "../../src/elf/pages/hq";
import { renderJoinPage as renderElfJoinPage } from "../../src/elf/pages/join";
import { renderPosterPage } from "../../src/elf/pages/poster";
import { renderRulesPage } from "../../src/elf/pages/rules";
import { renderSignInPage, renderWelcomePage } from "../../src/elf/pages/sign-in";
import { renderWardrobePage } from "../../src/elf/pages/wardrobe";
import { FESTIVE_SURNAMES } from "../../src/elf/names";
import { ELF_DEFAULTS } from "../../src/elf/settings";
import { renderSleighPage, renderSleighThanks } from "../../src/sleigh/page";
import { renderGuestNotFound, renderGuestPage } from "../../src/ball/guest-page";
import { renderBallThankYou } from "../../src/ball/thank-you-page";
import { renderBallPage } from "../../src/ball/page";
import { renderFundraiseSignUp, renderFundraiserPage, renderWhatsOnPage } from "../../src/fundraising/render";
import { renderMemoryPage } from "../../src/fundraising/memory-render";
import { renderNewGetInvolvedPage } from "../../src/fundraising/get-involved-page";
import { renderJoinPage as renderTeamJoinPage } from "../../src/fundraising/team-render";
import { formCategories, memoryCategories } from "../../src/fundraising/categories";
import { meter, type PublicPage } from "../../src/fundraising/model";
import { renderPledgeNotice } from "../../src/pledges/render";
import { renderRedBagPage, renderRedBagThanksPage } from "../../src/red-bag/render";
import { renderGiftAidForm, renderGiftAidMessage } from "../../src/declarations/render";
import { AFTERNOON, calendarView, hqView, posterView, wardrobeView } from "./elf-fixtures";

// TASK-615. Jaimie, 11 November 2026: "every page should have the same banner and the same nav bar
// across the entire site", and lock it in, because it kept happening: the Santa Sleigh (TASK-612),
// then Elf Detective School's pages and the Festive Ball's guest and thank you pages, each drew a
// banner and a footer of its own.
//
// The site's own pages are files at the root of the repository, with one banner and one footer
// (footer-master.test.ts keeps every footer in step with partials/footer.html). A page built in code
// takes both from one place, src/site/chrome.ts, which reads them from the home page. This test is
// the lock, in three parts:
//
//  1. Every kind of page built in code, drawn here with invented data, wears exactly the home page's
//     banner and menu bar and the master footer, and loads the site's stylesheet and script (without
//     main.js the menu's burger does nothing on a phone).
//  2. Every file at the root with a banner has the home page's.
//  3. No file under src/ draws a banner or a footer of its own: none holds the markup but the shared
//     module, and every file that writes a whole page takes the shared module, or is named below as
//     not a page of the site, with its reason.
//
// Only two things are allowed to differ: which link is marked as the page you are on, and the menu's
// items a page gains as it goes out (Get involved, Festive Ball and Elf Detective School, added by
// src/routes/site.ts). Line endings, indentation and the order of attributes do not count.
//
// Every name, place and reference here is invented.

const ROOT = resolve(__dirname, "../..");
const read = (file: string) => readFileSync(resolve(ROOT, file), "utf8");

const BANNER = /<header\b[^>]*\bclass="(?:[^"]*\s)?nav(?:\s[^"]*)?"[^>]*>[\s\S]*?<\/header>/g;
const FOOTER = /<footer\b[^>]*\bclass="(?:[^"]*\s)?site-footer(?:\s[^"]*)?"[^>]*>[\s\S]*?<\/footer>/g;
const bannersOf = (html: string): string[] => html.match(BANNER) ?? [];
const footersOf = (html: string): string[] => html.match(FOOTER) ?? [];

/** Markup as it reads rather than as it was typed: line endings, indentation, the order of an
 *  element's attributes and how an empty element is closed make no difference. */
function canonical(markup: string): string {
  return markup
    .replace(/<([a-zA-Z][\w-]*)([^<>]*?)\s*\/?>/g, (_tag, name: string, rest: string) => {
      const attrs = [...rest.matchAll(/([^\s"'=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)]
        .map((a) => [a[1].toLowerCase(), a[2] ?? a[3] ?? a[4] ?? ""] as const)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([n, v]) => ` ${n}="${v}"`)
        .join("");
      return `<${name.toLowerCase()}${attrs}>`;
    })
    .replace(/\s+/g, " ")
    .replace(/\s*(<[^>]+>)\s*/g, "$1")
    .trim();
}

/** A banner as every page shares it: no link marked as the page you are on, and none of the menu's
 *  items that are added as a page goes out. */
function sharedBanner(markup: string): string {
  return canonical(markup)
    .replace(/ aria-current="page"/g, "")
    .replace(/ class="([^"]*)"/g, (_m, value: string) => {
      const kept = value.split(" ").filter((c) => c && c !== "active");
      return kept.length ? ` class="${kept.join(" ")}"` : "";
    })
    .replace(/<li><a href="\/(?:get-involved|events|ball|elf)">[^<]*<\/a><\/li>/g, "");
}

// The master: the home page's banner and menu bar, and the master footer.
const HOME = read("index.html");
const MASTER_BANNER = sharedBanner(bannersOf(HOME)[0] ?? "");
const MASTER_FOOTER = canonical(read("partials/footer.html"));
/** The master banner with its Donate button sent somewhere else: the Sleigh's own give form. */
const bannerGivingTo = (href: string) =>
  MASTER_BANNER.replace('<a class="nav-cta" href="/donate">', `<a class="nav-cta" href="${href}">`);

describe("the master", () => {
  it("is the home page's banner, with its menu bar, its Donate button and the burger", () => {
    expect(bannersOf(HOME)).toHaveLength(1);
    expect(MASTER_BANNER).toContain('<a class="brand" href="/">');
    expect(MASTER_BANNER).toContain('<ul class="nav-links" id="navLinks">');
    expect(MASTER_BANNER).toContain('<a class="nav-cta" href="/donate">Donate</a>');
    expect(MASTER_BANNER).toContain('id="burger"');
    expect(MASTER_BANNER).not.toContain("aria-current");
  });

  it("is the master footer, with the charity's registration", () => {
    expect(MASTER_FOOTER).toContain("SC047995");
    expect(canonical(footersOf(HOME)[0] ?? "")).toBe(MASTER_FOOTER);
  });

  it("tells a banner apart from another, so a clean result means something", () => {
    const own = '<header class="nav" id="nav"><div class="wrap"><a class="brand" href="/">x</a><a class="nav-cta" href="/elf/join">Join</a></div></header>';
    expect(sharedBanner(own)).not.toBe(MASTER_BANNER);
    // The same banner typed differently is the same banner.
    const retyped = (bannersOf(HOME)[0] ?? "").replace(/\r?\n\s*/g, "\n      ").replace('id="nav" data-region="nav"', 'data-region="nav" id="nav"');
    expect(sharedBanner(retyped)).toBe(MASTER_BANNER);
    expect(sharedBanner(retyped.replace("Supporters</a>", "Our supporters</a>"))).not.toBe(MASTER_BANNER);
  });
});

// ---- 1. every kind of page built in code ---------------------------------------------------------

const elfSettings = { ...ELF_DEFAULTS, schoolOn: true };
const NIGHTS = [
  { id: 1, nightOn: "2026-12-15", areas: "Exampleton", startsAt: null, endsAt: null },
  { id: 2, nightOn: "2026-12-22", areas: "Sampleford", startsAt: "17:30", endsAt: "20:30" },
];
const BOOKING = { reference: "BALL-K7M2PQ", kind: "table" as const, quantity: 1, seats: 10, buyerName: "Sam Example", tableName: null };
const PAID = { reference: "BALL-K7M2PQ", kind: "table" as const, quantity: 1, seats: 10, buyerEmail: "sam@example.com", totalPence: 101_520, guestToken: "tok123" };
const BALL_SETTINGS = { arrivalTime: null, includedNote: null, lineUpNote: null };
const NOW = new Date(Date.UTC(2026, 10, 25, 12, 0, 0));
const card = {
  id: 12,
  slug: "eqn",
  kind: "quiz",
  kindLabel: "A quiz night",
  title: "Exampleton Quiz Night",
  description: "Teams of up to four.",
  eventDate: "2026-12-05",
  startTime: "19:00",
  venue: "The Hall",
  town: "Exampleton",
  imageSrc: null,
  organisedBy: "Exampleton Rotary",
  meter: meter({ onlinePence: 4000, cashPence: 6000, targetPence: null }),
  cardLine: "A quiz for NBCC.",
  endTime: "22:00",
  timeTbc: false,
  venueAddress: "1 Example Street, Exampleton",
  venuePostcode: "KA1 1AA",
  access: [],
  price: "£5 a head",
  booking: "door",
  ticketUrl: null,
  ageLimit: null,
  dressCode: null,
  included: null,
};
const eventPage = { ...card, path: "event", url: "/event/eqn", wall: [], giving: { fundraiserId: 12, minimumPence: 200 } } as unknown as PublicPage;
const fundraiserPage = { ...eventPage, path: "fundraiser", slug: "sams-walk", url: "/fundraise/sams-walk", title: "Sam's Walk" } as unknown as PublicPage;
const memoryPage = { ...fundraiserPage, inMemory: { name: "Pat Example" } } as unknown as PublicPage;

/** Every kind of page built in code: [what it is, the page, where its Donate button goes]. */
const PAGES: [string, () => string, string?][] = [
  ["Elf Detective School: the calendar", () => renderCalendarPage(calendarView(AFTERNOON))],
  ["Elf Detective School: the rules", () => renderRulesPage({ settings: elfSettings })],
  ["Elf Detective School: joining", () => renderElfJoinPage({ settings: elfSettings, captchaSiteKey: null, surnames: FESTIVE_SURNAMES })],
  ["Elf Detective School: signing in", () => renderSignInPage({ stage: "email" })],
  ["Elf Detective School: the welcome after paying", () => renderWelcomePage({ state: "done" })],
  ["Elf Detective School: Detective HQ", () => renderHqPage(hqView())],
  ["Elf Detective School: the wardrobe", () => renderWardrobePage(wardrobeView())],
  ["Elf Detective School: a hiding place's poster page", () => renderPosterPage(posterView())],
  ["the Santa Sleigh", () => renderSleighPage({ nights: NIGHTS, phase: "before", stop: 0, totalPence: 12_345 }), "#give"],
  ["the Santa Sleigh's thank you", () => renderSleighThanks(2000), "/sleigh#give"],
  ["the Festive Ball", () => renderBallPage(read("ball.html"), { settings: BALL_SETTINGS, gateOpen: true, salesClosed: true })],
  ["the Festive Ball's guest details", () => renderGuestPage({ booking: BOOKING, guests: [], token: "tok123" })],
  ["the Festive Ball's guest link, not found", () => renderGuestNotFound()],
  ["the Festive Ball's thank you", () => renderBallThankYou(PAID)],
  ["the Festive Ball's thank you, before the booking can be read", () => renderBallThankYou(null)],
  ["Get involved", () => renderNewGetInvolvedPage(read("get-involved.html"), { events: [], fundraisers: [], fundraisingOn: true, today: "2026-11-25" })],
  ["What's on", () => renderWhatsOnPage(read("whats-on.html"), { events: [], fundraisers: [], fundraisingOn: true, today: "2026-11-25" })],
  ["the fundraising sign up", () => renderFundraiseSignUp(read("fundraise.html"), true, formCategories(), memoryCategories())],
  ["a fundraiser's page", () => renderFundraiserPage(read("fundraiser.html"), fundraiserPage, { pageUrl: "https://nbcc.test/fundraise/sams-walk", now: NOW })],
  ["an event's page", () => renderFundraiserPage(read("fundraiser.html"), eventPage, { pageUrl: "https://nbcc.test/event/eqn", now: NOW })],
  ["a page in memory of someone", () => renderMemoryPage(read("fundraiser.html"), memoryPage, { pageUrl: "https://nbcc.test/fundraise/sams-walk", now: NOW })],
  [
    "joining a fundraising team",
    () =>
      renderTeamJoinPage(read("fundraise-join.html"), {
        open: true,
        team: { slug: "exampleton-juniors", title: "Exampleton Juniors", organisedBy: "Exampleton Juniors", kindLabel: "A sponsored walk", eventDate: null },
        shareNote: null,
        askShare: false,
      }),
  ],
  ["a sponsor's pledge", () => renderPledgeNotice(read("pledge.html"), { heading: "Thank you", body: ["Your pledge is in."] })],
  ["Fill a Red Bag", () => renderRedBagPage(read("fill-a-red-bag.html"), { preview: false })],
  ["Fill a Red Bag at night", () => renderRedBagPage(read("fill-a-red-bag.html"), { preview: false, night: true })],
  ["Fill a Red Bag's thank you", () => renderRedBagThanksPage(read("fill-thank-you.html"), { preview: false })],
  ["a Gift Aid declaration", () => renderGiftAidForm(read("gift-aid.html"), { token: "tok123", wordingSnapshot: "I am a UK taxpayer." })],
  ["a Gift Aid answer", () => renderGiftAidMessage(read("gift-aid.html"), { heading: "Gift Aid added, thank you", body: "Your declaration is complete." })],
];

describe.each(PAGES)("%s", (_name, draw, donateHref) => {
  // Without its comments: a note that mentions <main> is not the page's main.
  const html = draw().replace(/<!--[\s\S]*?-->/g, "");

  it("wears the home page's banner and menu bar, once, before the page", () => {
    const banners = bannersOf(html);
    expect(banners).toHaveLength(1);
    expect(sharedBanner(banners[0])).toBe(donateHref ? bannerGivingTo(donateHref) : MASTER_BANNER);
    expect(html.indexOf(banners[0])).toBeLessThan(html.indexOf("<main"));
  });

  it("ends with the master footer, once, after the page", () => {
    const footers = footersOf(html);
    expect(footers).toHaveLength(1);
    expect(canonical(footers[0])).toBe(MASTER_FOOTER);
    expect(html.indexOf(footers[0])).toBeGreaterThan(html.indexOf("</main>"));
  });

  it("loads the site's stylesheet, and the script that opens the menu on a phone", () => {
    expect(html).toMatch(/<link rel="stylesheet" href="\/?assets\/css\/styles\.css"/);
    expect(html).toMatch(/<script defer src="\/?assets\/js\/main\.js"><\/script>/);
  });
});

// ---- 2. every page of the site that is a file --------------------------------------------------

/** Files at the root with a banner of their own, each with its reason. */
const OWN_BANNER: Record<string, string> = {
  "ball-donate.html":
    "ASK JAIMIE: the Festive Ball's Can't make it page, whose button says Tickets in place of Donate. It forwards to /donate since 8 November 2026, so nobody sees it until the next Ball.",
  "ball-terms.html":
    "ASK JAIMIE: the Festive Ball's ticket terms, whose button says Tickets in place of Donate. Sales have closed: should it say Donate, like every other page?",
};
/** Files at the root with no banner at all, each with its reason. */
const NO_BANNER: Record<string, string> = {
  "admin.html": "the staff tool, not a page of the site",
  "set-password.html": "the staff password form, reached only from an emailed link",
  "hub.html": "the volunteers' own list of tools, linked from nowhere on the site",
};
const FILES = readdirSync(ROOT).filter((f) => f.endsWith(".html")).sort();

describe("the site's own pages, the files at the root", () => {
  it("finds them", () => {
    expect(FILES.length).toBeGreaterThan(30);
    for (const f of ["index.html", "about.html", "donate.html", "get-involved.html", "404.html"]) expect(FILES).toContain(f);
  });

  it.each(FILES.filter((f) => !(f in OWN_BANNER) && !(f in NO_BANNER)))("%s wears the home page's banner and menu bar, once", (file) => {
    const banners = bannersOf(read(file));
    expect(banners, `${file} has no banner: give it the home page's, or name it in NO_BANNER with its reason`).toHaveLength(1);
    expect(sharedBanner(banners[0]), `copy index.html's banner into ${file}`).toBe(MASTER_BANNER);
  });

  it("names only exceptions that are still exceptions", () => {
    for (const file of Object.keys(OWN_BANNER)) {
      expect(FILES).toContain(file);
      expect(sharedBanner(bannersOf(read(file))[0] ?? "")).not.toBe(MASTER_BANNER);
    }
    for (const file of Object.keys(NO_BANNER)) {
      expect(FILES).toContain(file);
      expect(bannersOf(read(file))).toEqual([]);
    }
  });
});

// ---- 3. no file under src/ draws a banner or a footer of its own --------------------------------

const CHROME_MODULE = "src/site/chrome.ts";

/** Files that may hold the banner's or the footer's markup themselves, each with its reason. None
 *  today: a printed sheet or an admin screen that needed one would be named here. */
const MAY_COPY_THE_CHROME: Record<string, string> = {};

/** Files that write a whole page that is not a page of the site, so wear neither the site's banner nor
 *  its footer, each with its reason. A new page of the site is not one of these: it takes its banner
 *  and footer from src/site/chrome.ts. */
const NOT_SITE_PAGES: Record<string, string> = {
  // Emails, read in an inbox.
  "src/email/brand.ts": "the frame every email is drawn in",
  "src/newsletter/theme.ts": "the newsletter, an email",
  "src/business/capture-confirmation-email.ts": "an email",
  "src/business/invite-email.ts": "an email",
  "src/business/perks-email.ts": "an email",
  "src/business/reminder-email.ts": "an email",
  "src/outreach/digest-runner.ts": "an email to staff",
  "src/outreach/invitation-email.ts": "an email",
  "src/outreach/nudge-email.ts": "an email",
  "src/thank-you/letter.ts": "the thank you letter as an email",
  // Sheets to print or save.
  "src/thank-you/letter-page.ts": "the thank you letter, a sheet to print",
  "src/routes/thank-you.ts": "the thank you letter's link when it is not found: part of that sheet",
  "src/business/certificate.ts": "the Platinum certificate, a sheet to print",
  "src/routes/business.ts": "the Platinum certificate's link when it is not found: part of that sheet",
  "src/invoices/page.ts": "a donation's invoice, a sheet to print or save",
  "src/ball/invoice-page.ts": "the Festive Ball's invoice, a sheet to print or save",
  "src/fundraising/materials.ts":
    "the print page for fundraisers' posters, forms and certificates and for Elf Detective School's posters, cards and certificates, with its short note when one cannot be made",
  "src/sleigh/posters.ts": "the Santa Sleigh's posters, to print",
  "src/tickets/render.ts": "an event's guest list, to print for the door",
  "src/newsletter/document-page.ts": "a document sent with a newsletter, shown to read, print or save, like the thank you letter",
  // Staff, and screens for one moment.
  "src/events/render.ts": "the admin's preview of an event's card",
  "src/ball/lock-page.ts": "the Festive Ball's password screen before it was published, on its own on purpose so it gives nothing of the page away",
  "src/ball/bags-page.ts":
    "the screen a Festive Ball table card's QR code opened on the night, for a guest on a hotel's signal; it forwards to Fill a Red Bag since 8 November 2026",
  // Their own small pages, until Jaimie decides.
  "src/routes/unsubscribe.ts": "ASK JAIMIE: unsubscribing from the newsletter, a small page of its own reached from an email. Give it the site's banner and footer too?",
  "src/routes/preferences.ts": "ASK JAIMIE: choosing which emails to have, a small page of its own reached from an email. Give it the site's banner and footer too?",
  "src/routes/api.ts": "ASK JAIMIE: the answers to the Share your story form when the browser has no JavaScript: one line pages. Give them the site's banner and footer too?",
};

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : path.endsWith(".ts") ? [path] : [];
  });
}
const SOURCES = filesUnder(resolve(ROOT, "src"))
  .map((path) => relative(ROOT, path).replace(/\\/g, "/"))
  .sort();
// Read once, as the file is loaded, rather than inside a test that has a time limit.
const TEXTS = new Map(SOURCES.map((file) => [file, read(file)] as const));
const source = (file: string): string => TEXTS.get(file) ?? read(file);

/** The banner's or the footer's own markup, however its attributes are written. */
const COPY = /<header\b[^>]*\bclass=["'](?:[^"']*\s)?nav(?:\s[^"']*)?["']|<footer\b[^>]*\bclass=["'](?:[^"']*\s)?site-footer(?:\s[^"']*)?["']/;
/** A file that writes a whole page, not a piece of one. */
const writesAPage = (text: string) => /<!doctype html/i.test(text) && /<body/i.test(text);
const takesTheChrome = (text: string) => /from\s+["'](?:\.\.?\/)+site\/chrome["']/.test(text);

describe("no file under src/ draws a banner or a footer of its own", () => {
  it("reads every file", () => {
    expect(SOURCES.length).toBeGreaterThan(300);
    expect(SOURCES).toContain("src/routes/site.ts");
  });

  it("holds the banner's and the footer's markup only in the shared module", () => {
    const copies = SOURCES.filter((f) => f !== CHROME_MODULE && !(f in MAY_COPY_THE_CHROME) && COPY.test(source(f)));
    expect(copies, "take the banner and footer from src/site/chrome.ts (siteHeader, siteFooter) rather than writing them").toEqual([]);
  });

  it("gives every whole page of the site the shared banner and footer", () => {
    const own = SOURCES.filter((f) => writesAPage(source(f)) && !takesTheChrome(source(f)) && !(f in NOT_SITE_PAGES));
    expect(
      own,
      "a page of the site takes its banner and footer from src/site/chrome.ts; a page that is not one (an email, a sheet to print, a staff screen) is named in NOT_SITE_PAGES with its reason",
    ).toEqual([]);
  });

  it("catches a copy however it is written, so a clean result means something", () => {
    expect(COPY.test('<header class="nav" id="nav" data-region="nav">')).toBe(true);
    expect(COPY.test("<header id='nav' class='nav'>")).toBe(true);
    expect(COPY.test('<footer data-region="footer" class="site-footer wide">')).toBe(true);
    expect(COPY.test('<header class="elf-wd-door__head">')).toBe(false);
    expect(COPY.test('<footer class="bb-foot">')).toBe(false);
    expect(writesAPage('return `<!doctype html>\n<html lang="en"><body class="sl-page">`;')).toBe(true);
    expect(writesAPage('body.startsWith("<!doctype html>")')).toBe(false);
    expect(takesTheChrome('import { siteFooter, siteHeader } from "../site/chrome";')).toBe(true);
    expect(takesTheChrome('import { siteHeader } from "../../site/chrome";')).toBe(true);
  });

  it("names only exceptions that are still exceptions, each with its reason", () => {
    for (const [file, reason] of Object.entries(MAY_COPY_THE_CHROME)) {
      expect(SOURCES).toContain(file);
      expect(COPY.test(source(file)), file).toBe(true);
      expect(reason.length).toBeGreaterThan(10);
    }
    for (const [file, reason] of Object.entries(NOT_SITE_PAGES)) {
      expect(SOURCES, file).toContain(file);
      expect(writesAPage(source(file)), `${file} no longer writes a whole page: take it off the list`).toBe(true);
      expect(takesTheChrome(source(file)), `${file} takes the shared chrome now: take it off the list`).toBe(false);
      expect(reason.length).toBeGreaterThan(5);
    }
  });
});
