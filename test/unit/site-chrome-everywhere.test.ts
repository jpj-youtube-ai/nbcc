import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { renderCalendarPage } from "../../src/elf/pages/calendar";
import { renderEmailsPage } from "../../src/elf/pages/emails";
import { renderEntryPage } from "../../src/elf/pages/entry";
import { renderGoPage } from "../../src/elf/pages/go";
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
import { renderBallDonatePage } from "../../src/ball/donate-page";
import { letterNoticePage } from "../../src/thank-you/letter-notice";
import { certificateNotFoundPage } from "../../src/business/certificate-not-found";
import { preferencesInvalidPage, preferencesPage, unsubscribeConfirmPage, unsubscribeMessagePage } from "../../src/newsletter/email-pages";
import { doneMessage } from "../../src/newsletter/unsubscribe-copy";
import { storyCheckPage, storyFailedPage, storyThanksPage, storyTooManyPage } from "../../src/stories/answer-pages";
import { AFTERNOON, calendarView, emailsView, entryView, goDoneView, goView, hqView, posterView, wardrobeView } from "./elf-fixtures";

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
//     module, and every whole page a file writes takes its banner and footer from the shared module
//     (as many siteHeader() and siteFooter() calls as pages), or the file is named below as writing
//     pages that are not pages of the site, with how many and why.
//
// Pages are drawn here as their code draws them, before they go out, so they must not carry the menu's
// items a page gains as it goes out (Get involved, the Festive Ball and Elf Detective School, added by
// src/routes/site.ts): the test asserts they are absent, except a page's own item on the pages that are
// that item (Get involved and What's on), marked as the page you are on. Which link is marked as the
// page you are on does not count, nor do line endings, indentation or the order of attributes.
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

/** The menu items a page gains as it goes out, never drawn into it: Get involved (once Events), the
 *  Festive Ball and Elf Detective School. */
const ADDED_AS_IT_GOES_OUT = /(^| )href="\/(?:get-involved|events|ball|elf)"/;

/**
 * A banner as its page draws it. `banner` is the markup to compare, with no link marked as the page you
 * are on; `added` is every item of the menu's that a page only gains as it goes out, and so should not
 * be there at all. The one such item a page may draw is its own, marked as the page you are on (Get
 * involved and What's on are the Get involved item's own pages), and it is left out of `banner`.
 */
function drawnBanner(markup: string): { banner: string; added: string[] } {
  const added: string[] = [];
  const banner = canonical(markup)
    .replace(/<li><a ([^>]*)>[^<]*<\/a><\/li>/g, (item, attrs: string) => {
      if (!ADDED_AS_IT_GOES_OUT.test(attrs)) return item;
      if (/(^| )aria-current="page"/.test(attrs)) return "";
      added.push(item);
      return item;
    })
    .replace(/ aria-current="page"/g, "")
    .replace(/ class="([^"]*)"/g, (_m, value: string) => {
      const kept = value.split(" ").filter((c) => c && c !== "active");
      return kept.length ? ` class="${kept.join(" ")}"` : "";
    });
  return { banner, added };
}

// The master: the home page's banner and menu bar, and the master footer.
const HOME = read("index.html");
const MASTER_BANNER = drawnBanner(bannersOf(HOME)[0] ?? "").banner;
const MASTER_FOOTER = canonical(read("partials/footer.html"));
/** The master banner with its Donate button sent somewhere else: the Sleigh's own give form. */
const bannerGivingTo = (href: string) =>
  MASTER_BANNER.replace('<a class="nav-cta" href="/donate">', `<a class="nav-cta" href="${href}">`);

describe("the master", () => {
  it("is the home page's banner, with its menu bar, its Donate button and the burger", () => {
    expect(bannersOf(HOME)).toHaveLength(1);
    expect(drawnBanner(bannersOf(HOME)[0]).added).toEqual([]);
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
    expect(drawnBanner(own).banner).not.toBe(MASTER_BANNER);
    // The same banner typed differently is the same banner.
    const retyped = (bannersOf(HOME)[0] ?? "").replace(/\r?\n\s*/g, "\n      ").replace('id="nav" data-region="nav"', 'data-region="nav" id="nav"');
    expect(drawnBanner(retyped).banner).toBe(MASTER_BANNER);
    expect(drawnBanner(retyped.replace("Supporters</a>", "Our supporters</a>")).banner).not.toBe(MASTER_BANNER);
  });

  it("catches a menu item drawn into a page that it should only gain as it goes out", () => {
    const home = bannersOf(HOME)[0] ?? "";
    const withElf = home.replace("</ul>", '<li><a href="/elf">Elf Detective School</a></li></ul>');
    expect(drawnBanner(withElf).added).toEqual(['<li><a href="/elf">Elf Detective School</a></li>']);
    // Get involved's own pages draw their own item, marked as the page you are on: that is allowed.
    const own = home.replace("</ul>", '<li><a href="/get-involved" class="active" aria-current="page">Get involved</a></li></ul>');
    expect(drawnBanner(own)).toEqual({ banner: MASTER_BANNER, added: [] });
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
const CHOICES = { email: "robin@example.com", lists: [{ id: 11, listId: 3, listName: "Volunteers" }], donor: { newsletter: true, thankYou: false } };
const OFFERS = [{ id: 4, name: "Exampleton walkers", kind: "manual" as const, visibility: "public" as const }];

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
  ["Elf Detective School: having a go at a door", () => renderGoPage(goView())],
  ["Elf Detective School: how a go went", () => renderGoPage(goDoneView())],
  ["Elf Detective School: sending in a picture", () => renderEntryPage(entryView())],
  ["Elf Detective School: the emails link, on", () => renderEmailsPage(emailsView())],
  ["Elf Detective School: the emails link, stopped", () => renderEmailsPage(emailsView({ stopped: true }))],
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
  ["the Festive Ball's Can't make it page", () => renderBallDonatePage(read("ball-donate.html"))],
  ["a thank-you letter's link, not valid", () => letterNoticePage("This letter link is not valid.")],
  ["a thank-you letter's link, the letter gone", () => letterNoticePage("This letter could not be found.")],
  ["a Platinum certificate's link, nothing to show", () => certificateNotFoundPage()],
  ["the unsubscribe link's question", () => unsubscribeConfirmPage("tok123", "everything")],
  ["the unsubscribe link's answer", () => unsubscribeMessagePage(doneMessage("one-list"), "tok123")],
  ["the unsubscribe link, not valid", () => unsubscribeMessagePage("This link is not valid.")],
  ["the email choices page", () => preferencesPage(CHOICES, OFFERS, "tok123", false)],
  ["the email choices page, just saved", () => preferencesPage(CHOICES, [], "tok123", true)],
  ["the email choices page, nothing left to turn off", () => preferencesPage({ email: "robin@example.com", lists: [], donor: null }, [], "tok123", false)],
  ["the email choices link, not valid", () => preferencesInvalidPage()],
  ["Share your story's thank you, without JavaScript", () => storyThanksPage()],
  ["Share your story, details to check", () => storyCheckPage()],
  ["Share your story, too many from one connection", () => storyTooManyPage()],
  ["Share your story, not saved", () => storyFailedPage()],
];

describe.each(PAGES)("%s", (_name, draw, donateHref) => {
  // Without its comments: a note that mentions <main> is not the page's main.
  const html = draw().replace(/<!--[\s\S]*?-->/g, "");

  it("wears the home page's banner and menu bar, once, before the page, with nothing added yet", () => {
    const banners = bannersOf(html);
    expect(banners).toHaveLength(1);
    const { banner, added } = drawnBanner(banners[0]);
    expect(added, "a page is drawn without the menu's items it gains as it goes out (src/routes/site.ts adds them)").toEqual([]);
    expect(banner).toBe(donateHref ? bannerGivingTo(donateHref) : MASTER_BANNER);
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

/** Files at the root with a banner of their own, each with its reason. None: the Festive Ball's terms
 *  and Can't make it pages carried a Tickets button in place of Donate until TASK-615. */
const OWN_BANNER: Record<string, string> = {};
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
    for (const f of ["index.html", "about.html", "donate.html", "get-involved.html", "404.html", "ball-terms.html"]) expect(FILES).toContain(f);
  });

  it.each(FILES.filter((f) => !(f in OWN_BANNER) && !(f in NO_BANNER)))("%s wears the home page's banner and menu bar, once, with nothing added yet", (file) => {
    const banners = bannersOf(read(file));
    expect(banners, `${file} has no banner: give it the home page's, or name it in NO_BANNER with its reason`).toHaveLength(1);
    const { banner, added } = drawnBanner(banners[0]);
    expect(added, `${file} draws a menu item it should only gain as it goes out`).toEqual([]);
    expect(banner, `copy index.html's banner into ${file}`).toBe(MASTER_BANNER);
  });

  it("names only exceptions that are still exceptions", () => {
    for (const file of Object.keys(OWN_BANNER)) {
      expect(FILES).toContain(file);
      expect(drawnBanner(bannersOf(read(file))[0] ?? "").banner).not.toBe(MASTER_BANNER);
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

/** A file named here writes `pages` whole pages that are not pages of the site, so they wear neither
 *  the site's banner nor its footer. If the number changes, the test fails, so a page of the site
 *  cannot be slipped in beside them. A new page of the site is never one of these: it takes its banner
 *  and footer from src/site/chrome.ts. */
const NOT_SITE_PAGES: Record<string, { pages: number; why: string }> = {
  // Emails, read in an inbox.
  "src/email/brand.ts": { pages: 1, why: "the frame every email is drawn in" },
  "src/newsletter/theme.ts": { pages: 1, why: "the newsletter, an email" },
  "src/business/capture-confirmation-email.ts": { pages: 1, why: "an email" },
  "src/business/invite-email.ts": { pages: 1, why: "an email" },
  "src/business/perks-email.ts": { pages: 1, why: "an email" },
  "src/business/reminder-email.ts": { pages: 1, why: "an email" },
  "src/outreach/digest-runner.ts": { pages: 1, why: "an email to staff" },
  "src/outreach/invitation-email.ts": { pages: 1, why: "an email" },
  "src/outreach/nudge-email.ts": { pages: 1, why: "an email" },
  "src/thank-you/letter.ts": { pages: 1, why: "the thank you letter as an email" },
  // Sheets to print or save.
  "src/thank-you/letter-page.ts": { pages: 1, why: "the thank you letter, a sheet to print" },
  "src/business/certificate.ts": { pages: 1, why: "the Platinum certificate, a sheet to print" },
  "src/invoices/page.ts": { pages: 1, why: "a donation's invoice, a sheet to print or save" },
  "src/ball/invoice-page.ts": { pages: 1, why: "the Festive Ball's invoice, a sheet to print or save" },
  "src/fundraising/materials.ts": {
    pages: 2,
    why: "the print page for fundraisers' posters, forms and certificates and for Elf Detective School's posters, cards and certificates, and its short note when one cannot be made",
  },
  "src/sleigh/posters.ts": { pages: 1, why: "the Santa Sleigh's posters, to print" },
  "src/tickets/render.ts": { pages: 1, why: "an event's guest list, to print for the door" },
  "src/newsletter/document-page.ts": { pages: 1, why: "a document sent with a newsletter, shown to read, print or save, like the thank you letter" },
  // Staff, and screens for one moment.
  "src/events/render.ts": { pages: 1, why: "the admin's preview of an event's card" },
  "src/ball/lock-page.ts": { pages: 1, why: "the Festive Ball's password screen before it was published, on its own on purpose so it gives nothing of the page away" },
  "src/ball/bags-page.ts": {
    pages: 1,
    why: "the screen a Festive Ball table card's QR code opened on the night, for a guest on a hotel's signal; it forwards to Fill a Red Bag since 8 November 2026",
  },
};

/** A file named here fills in a page file at the root rather than writing a page: what it counts as a
 *  page is that file's own body tag. The page's banner and footer are the file's, held to the home
 *  page's in part 2, and the page as drawn is in part 1. */
const FILLS_A_PAGE_FILE: Record<string, { pages: number; why: string }> = {
  "src/red-bag/render.ts": { pages: 1, why: "marks fill-a-red-bag.html's own body tag for the night look" },
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
/** How many whole pages a file writes: one body tag each, however small the page, doctype or not. */
const pagesIn = (text: string): number => (text.match(/<body[\s>]/gi) ?? []).length;
/** How many times a file calls the shared module for a banner, or a footer. An import is not a call. */
const callsTo = (text: string, name: "siteHeader" | "siteFooter"): number => (text.match(new RegExp(`\\b${name}\\(`, "g")) ?? []).length;

describe("no file under src/ draws a banner or a footer of its own", () => {
  it("reads every file", () => {
    expect(SOURCES.length).toBeGreaterThan(300);
    expect(SOURCES).toContain("src/routes/site.ts");
  });

  it("holds the banner's and the footer's markup only in the shared module", () => {
    const copies = SOURCES.filter((f) => f !== CHROME_MODULE && !(f in MAY_COPY_THE_CHROME) && COPY.test(source(f)));
    expect(copies, "take the banner and footer from src/site/chrome.ts (siteHeader, siteFooter) rather than writing them").toEqual([]);
  });

  it("gives every whole page of the site the shared banner and footer: a siteHeader() and a siteFooter() for each page", () => {
    const short = SOURCES.filter((f) => !(f in NOT_SITE_PAGES) && !(f in FILLS_A_PAGE_FILE))
      .map((f) => ({ file: f, pages: pagesIn(source(f)), headers: callsTo(source(f), "siteHeader"), footers: callsTo(source(f), "siteFooter") }))
      .filter((x) => x.pages > 0 && (x.headers < x.pages || x.footers < x.pages))
      .map((x) => `${x.file}: ${x.pages} pages, ${x.headers} siteHeader() and ${x.footers} siteFooter()`);
    expect(
      short,
      "each page of the site takes its banner and footer from src/site/chrome.ts; a page that is not one (an email, a sheet to print, a staff screen) is named in NOT_SITE_PAGES with how many and why",
    ).toEqual([]);
  });

  it("counts pages and calls, not imports, so a clean result means something", () => {
    expect(COPY.test('<header class="nav" id="nav" data-region="nav">')).toBe(true);
    expect(COPY.test("<header id='nav' class='nav'>")).toBe(true);
    expect(COPY.test('<footer data-region="footer" class="site-footer wide">')).toBe(true);
    expect(COPY.test('<header class="elf-wd-door__head">')).toBe(false);
    expect(COPY.test('<footer class="bb-foot">')).toBe(false);
    // A small inline page in a route, with or without a doctype, is a page.
    expect(pagesIn('res.type("html").send(`<!doctype html><html lang="en"><body style="margin:4rem">Not found</body></html>`)')).toBe(1);
    expect(pagesIn('send("<html><body><h1>Oops</h1></body></html>")')).toBe(1);
    expect(pagesIn('body.startsWith("<!doctype html>")')).toBe(0);
    // Importing the module, or dressing a page as it goes out, takes no banner: only the calls count.
    const importsOnly = 'import { dressPage, siteFooter, siteHeader } from "../site/chrome";\nres.send(await dressPage(`<!doctype html><html><body><main>x</main></body></html>`, cookie));';
    expect([pagesIn(importsOnly), callsTo(importsOnly, "siteHeader"), callsTo(importsOnly, "siteFooter")]).toEqual([1, 0, 0]);
    const two = '`<body>${siteHeader()}<main>a</main>${siteFooter()}</body>` + `<body><main>b</main></body>`';
    expect([pagesIn(two), callsTo(two, "siteHeader"), callsTo(two, "siteFooter")]).toEqual([2, 1, 1]);
  });

  it("names only exceptions that are still exceptions, each with its count and its reason", () => {
    for (const [file, why] of Object.entries(MAY_COPY_THE_CHROME)) {
      expect(SOURCES).toContain(file);
      expect(COPY.test(source(file)), file).toBe(true);
      expect(why.length).toBeGreaterThan(10);
    }
    for (const [file, { pages, why }] of [...Object.entries(NOT_SITE_PAGES), ...Object.entries(FILLS_A_PAGE_FILE)]) {
      expect(SOURCES, file).toContain(file);
      expect(pagesIn(source(file)), `${file} writes a different number of pages now: is the new one a page of the site?`).toBe(pages);
      expect(callsTo(source(file), "siteHeader"), `${file} takes the shared banner now: take it off the list`).toBe(0);
      expect(why.length).toBeGreaterThan(5);
    }
  });
});
