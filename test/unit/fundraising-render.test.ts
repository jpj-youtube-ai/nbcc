// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  formatPounds,
  timeAgo,
  renderMeter,
  renderFundraiserCard,
  fundraiserEventRecord,
  renderGetInvolvedPage,
  renderFundraiserPage,
  renderFundraiseSignUp,
  WALL_FIRST,
} from "../../src/fundraising/render";
import { renderEventsPage } from "../../src/events/render";
import { meter, type PublicCard, type PublicPage, type WallEntry } from "../../src/fundraising/model";
import { SINGLE_DONATION_WORDING } from "../../src/declarations/wording";
import { SEED_EVENTS } from "./helpers/events-seed";

// TASK-494: the public fundraising pages, drawn on the server. Pure functions, so every state the
// pages can be in is checked here without a database: the meter at nothing, halfway and past its
// target, no target at all, the supporter wall with its first ten, anonymous givers and hidden
// amounts, and Get involved with fundraising switched on and off. Every name here is invented.

const ROOT = resolve(__dirname, "../..");
const read = (f: string) => readFileSync(resolve(ROOT, f), "utf8");
const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");
const frag = (html: string) => parse(`<!doctype html><body>${html}</body>`).body;

const card = (over: Partial<PublicCard> = {}): PublicCard => ({
  id: 41,
  slug: "robins-santa-dash",
  path: "raising",
  kind: "santa_dash",
  kindLabel: "A Santa dash",
  title: "Robin's Santa Dash",
  description: "Five kilometres in a red suit for NBCC.\n\nPlease sponsor me.",
  eventDate: null,
  startTime: null,
  venue: "",
  town: "Exampleton",
  imageSrc: null,
  organisedBy: "Robin Q.",
  url: "/fundraise/robins-santa-dash",
  meter: meter({ onlinePence: 6000, cashPence: 1500, targetPence: 25000 }),
  ...over,
});

const wallEntry = (i: number, over: Partial<WallEntry> = {}): WallEntry => ({
  name: `Giver${i} T.`,
  amountPence: 1000 + i,
  message: `Message ${i}`,
  createdAt: new Date(Date.UTC(2026, 9, 1, 12, 0, 0) - i * 3600_000).toISOString(),
  ...over,
});

const page = (over: Partial<PublicPage> = {}): PublicPage => ({
  ...card(),
  wall: [wallEntry(1)],
  giving: { fundraiserId: 41, minimumPence: 200 },
  ...over,
});

const NOW = new Date(Date.UTC(2026, 9, 2, 12, 0, 0));
const PAGE_URL = "https://nbcc.test/fundraise/robins-santa-dash";

describe("money and time in words", () => {
  it("shows whole pounds without pence, and pence only when there are some", () => {
    expect(formatPounds(0)).toBe("£0");
    expect(formatPounds(6000)).toBe("£60");
    expect(formatPounds(2550)).toBe("£25.50");
    expect(formatPounds(123456)).toBe("£1,234.56");
    expect(formatPounds(10_000_000)).toBe("£100,000");
  });

  it("says how long ago, the way people say it", () => {
    const ago = (ms: number) => timeAgo(new Date(NOW.getTime() - ms).toISOString(), NOW);
    expect(ago(20_000)).toBe("just now");
    expect(ago(60_000)).toBe("1 minute ago");
    expect(ago(5 * 60_000)).toBe("5 minutes ago");
    expect(ago(3600_000)).toBe("1 hour ago");
    expect(ago(5 * 3600_000)).toBe("5 hours ago");
    expect(ago(30 * 3600_000)).toBe("yesterday");
    expect(ago(4 * 86400_000)).toBe("4 days ago");
    expect(ago(15 * 86400_000)).toBe("2 weeks ago");
    expect(ago(70 * 86400_000)).toBe("2 months ago");
    expect(ago(400 * 86400_000)).toBe("over a year ago");
    // A clock a little ahead of ours never reads as the future.
    expect(timeAgo(new Date(NOW.getTime() + 30_000).toISOString(), NOW)).toBe("just now");
  });
});

describe("the meter", () => {
  const bar = (m: ReturnType<typeof meter>) => frag(renderMeter(m)).querySelector('[role="progressbar"]');

  it("at nothing raised: an empty bar that still says what the target is", () => {
    const m = meter({ onlinePence: 0, cashPence: 0, targetPence: 25000 });
    const el = bar(m)!;
    expect(el.getAttribute("aria-valuenow")).toBe("0");
    expect(el.getAttribute("aria-valuemin")).toBe("0");
    expect(el.getAttribute("aria-valuemax")).toBe("100");
    expect(el.getAttribute("aria-valuetext")).toBe("£0 raised of the £250 target, 0%");
    expect(frag(renderMeter(m)).textContent).toContain("£0 raised");
    expect(frag(renderMeter(m)).textContent).toContain("of £250");
  });

  it("halfway: the bar is half full and the words say 50%", () => {
    const m = meter({ onlinePence: 10000, cashPence: 2500, targetPence: 25000 });
    const el = bar(m)!;
    expect(el.getAttribute("aria-valuenow")).toBe("50");
    expect(el.querySelector(".fr-meter__fill")?.getAttribute("style")).toBe("width:50%");
    expect(frag(renderMeter(m)).textContent).toContain("50%");
    expect(frag(renderMeter(m)).textContent).toContain("£125 raised");
  });

  it("past the target: the bar is held full, the words tell the real figure", () => {
    const m = meter({ onlinePence: 30000, cashPence: 0, targetPence: 25000 });
    const el = bar(m)!;
    expect(el.getAttribute("aria-valuenow")).toBe("100");
    expect(el.getAttribute("aria-valuetext")).toBe("£300 raised of the £250 target, 120%");
    expect(el.querySelector(".fr-meter__fill")?.getAttribute("style")).toBe("width:100%");
    expect(frag(renderMeter(m)).textContent).toContain("120%");
    expect(frag(renderMeter(m)).querySelector(".fr-meter")?.classList.contains("is-over")).toBe(true);
  });

  it("with no target: just the amount raised, and no bar pretending to measure anything", () => {
    const m = meter({ onlinePence: 4200, cashPence: 0, targetPence: null });
    expect(bar(m)).toBeNull();
    expect(frag(renderMeter(m)).textContent?.replace(/\s+/g, " ").trim()).toBe("£42 raised");
  });
});

describe("a fundraiser's card on Get involved", () => {
  const li = () => frag(`<ol>${renderFundraiserCard(card())}</ol>`).querySelector("li")!;

  it("is a deck card marked as a fundraiser, so the chips can find it", () => {
    expect(li().classList.contains("ev-card")).toBe(true);
    expect(li().classList.contains("ev-card--fundraiser")).toBe(true);
    expect(li().getAttribute("data-kind")).toBe("fundraiser");
  });

  it("names itself by its heading and carries the meter", () => {
    const face = li().querySelector(".ev-face")!;
    const id = face.getAttribute("aria-labelledby")!;
    expect(li().ownerDocument.getElementById(id)?.textContent).toBe("Robin's Santa Dash");
    expect(li().querySelector('[role="progressbar"]')).not.toBeNull();
    expect(li().textContent).toContain("Organised by Robin Q.");
    expect(li().textContent).toContain("A Santa dash");
  });

  it("links to its own page, saying which fundraiser for a screen reader", () => {
    const link = li().querySelector<HTMLAnchorElement>("a.fr-card__go")!;
    expect(link.getAttribute("href")).toBe("/fundraise/robins-santa-dash");
    expect(link.textContent).toContain("Robin's Santa Dash");
  });

  it("escapes whatever an organiser typed", () => {
    const html = renderFundraiserCard(card({ title: "<img src=x onerror=alert(1)>", description: "<b>bold</b>" }));
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<b>bold</b>");
  });

  it("shows the photo when staff have added one", () => {
    const img = frag(`<ol>${renderFundraiserCard(card({ imageSrc: "/media/events/0f8fad5b-d9cb-469f-a165-70867728950e" }))}</ol>`).querySelector("img");
    expect(img?.getAttribute("src")).toBe("/media/events/0f8fad5b-d9cb-469f-a165-70867728950e");
    expect(img?.getAttribute("alt")).toBeTruthy();
  });
});

describe("a holding an event sign up, shown as an event", () => {
  const ev = card({ path: "event", kind: "bake_sale", kindLabel: "A bake sale or coffee morning", title: "Kim's Bake Sale", eventDate: "2026-11-21", startTime: "10:00", venue: "Example Church Hall", url: null, slug: "kims-bake-sale" });

  it("becomes an ordinary event card run by the organiser, with nothing to book", () => {
    const rec = fundraiserEventRecord(ev)!;
    expect(rec.name).toBe("Kim's Bake Sale");
    expect(rec.date).toBe("2026-11-21");
    expect(rec.start).toBe("10:00");
    expect(rec.runBy).toBe("partner");
    expect(rec.partnerName).toBe("Robin Q.");
    expect(rec.bookingHow).toBe("none");
    // Its own slug space, so a fundraiser can never take an NBCC event's card id.
    expect(rec.slug).not.toBe(ev.slug);
  });

  it("is left out when it has no date to put on the card", () => {
    expect(fundraiserEventRecord({ ...ev, eventDate: null })).toBeNull();
  });
});

describe("Get involved", () => {
  const template = read("events.html");
  const today = "2026-10-02";

  it("with fundraising switched off is the events page as it was: no chips, no fundraisers, no panel", () => {
    const html = renderGetInvolvedPage(template, { events: SEED_EVENTS, fundraisers: [card()], fundraisingOn: false, today });
    const doc = parse(html);
    expect(doc.querySelector("[data-chips]")).toBeNull();
    expect(doc.querySelector(".ev-card--fundraiser")).toBeNull();
    expect(doc.querySelector("#fundraise-panel")).toBeNull();
    expect(html).not.toContain('href="/fundraise"');
    expect(doc.querySelectorAll(".deck > .ev-card")).toHaveLength(parse(renderEventsPage(template, SEED_EVENTS)).querySelectorAll(".deck > .ev-card").length);
    expect(html).not.toContain("<!-- getinvolved:");
  });

  it("with fundraising on: the chips, every fundraiser's card and the Fundraise for us panel", () => {
    const html = renderGetInvolvedPage(template, { events: SEED_EVENTS, fundraisers: [card()], fundraisingOn: true, today });
    const doc = parse(html);
    const chips = doc.querySelector("[data-chips]")!;
    expect([...chips.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["All", "Events", "Fundraisers"]);
    // Without JavaScript the chips could not filter anything, so they ship hidden and everything shows.
    expect(chips.hasAttribute("hidden")).toBe(true);
    expect(doc.querySelectorAll(".ev-card--fundraiser")).toHaveLength(1);
    expect(doc.querySelector("#fundraise-panel a[href='/fundraise']")).not.toBeNull();
    expect(doc.querySelector("#fundraise-panel a[href='/fundraise/manage']")).not.toBeNull();
    expect(doc.querySelector(".intro-hero a[href='/fundraise']")).not.toBeNull();
  });

  it("puts a community event among NBCC's own events by date, and the face down card last", () => {
    const bake = card({ path: "event", title: "Kim's Bake Sale (early)", eventDate: "2026-10-03", url: null, slug: "kims-bake-sale" });
    const html = renderGetInvolvedPage(template, { events: SEED_EVENTS, fundraisers: [bake, card()], fundraisingOn: true, today });
    const cards = [...parse(html).querySelectorAll(".deck > .ev-card")];
    expect(cards[0].textContent).toContain("Kim's Bake Sale (early)");
    expect(cards[0].getAttribute("data-kind")).toBe("event");
    expect(cards[cards.length - 1].classList.contains("ev-card--more")).toBe(true);
    // The invitation on the back of the face down card goes to the sign up while fundraising is on.
    expect(cards[cards.length - 1].querySelector("a.ev-book")?.getAttribute("href")).toBe("/fundraise");
  });

  it("every card says which chip it belongs to", () => {
    const html = renderGetInvolvedPage(template, { events: SEED_EVENTS, fundraisers: [card()], fundraisingOn: true, today });
    for (const li of parse(html).querySelectorAll(".deck > .ev-card")) {
      expect(["event", "fundraiser"]).toContain(li.getAttribute("data-kind"));
    }
  });

  it("has a kind word ready for an empty Fundraisers chip", () => {
    const html = renderGetInvolvedPage(template, { events: SEED_EVENTS, fundraisers: [], fundraisingOn: true, today });
    const empty = parse(html).querySelector('[data-chips-empty="fundraiser"]')!;
    expect(empty.hasAttribute("hidden")).toBe(true);
    expect(empty.querySelector("a[href='/fundraise']")).not.toBeNull();
  });
});

describe("a fundraiser's own page", () => {
  const template = read("fundraiser.html");
  const render = (p: PublicPage = page()) => renderFundraiserPage(template, p, { pageUrl: PAGE_URL, now: NOW });
  const doc = (p?: PublicPage) => parse(render(p));

  it("is titled and described for search and for sharing", () => {
    const d = doc();
    expect(d.title).toBe("Robin's Santa Dash | Night Before Christmas Campaign");
    expect(d.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(PAGE_URL);
    expect(d.querySelector('meta[property="og:url"]')?.getAttribute("content")).toBe(PAGE_URL);
    expect(d.querySelector('meta[property="og:title"]')?.getAttribute("content")).toBe("Robin's Santa Dash");
    expect(render()).not.toMatch(/__[A-Z_]+__/);
  });

  it("shows the name, the kind, who organised it and the story, escaped", () => {
    const d = doc(page({ description: "Line one <script>x</script>\n\nSecond paragraph" }));
    expect(d.querySelector("h1")?.textContent).toBe("Robin's Santa Dash");
    expect(d.body.textContent).toContain("A Santa dash");
    expect(d.body.textContent).toContain("Organised by Robin Q.");
    expect(d.querySelectorAll(".fr-story p")).toHaveLength(2);
    expect(render(page({ description: "<script>x</script>" }))).not.toContain("<script>x</script>");
  });

  it("gives the date and place when there are some", () => {
    const d = doc(page({ eventDate: "2026-12-05", startTime: "10:30", venue: "Example Park", town: "Exampleton" }));
    const text = d.querySelector(".fr-facts")?.textContent ?? "";
    expect(text).toContain("Saturday 5 December 2026");
    expect(text).toContain("10.30am");
    expect(text).toContain("Example Park, Exampleton");
  });

  it("carries the meter", () => {
    expect(doc().querySelector('.fr-summary [role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("30");
  });

  it("shows the photo only when there is one", () => {
    expect(doc().querySelector(".fr-photo")).toBeNull();
    expect(doc(page({ imageSrc: "/media/events/0f8fad5b-d9cb-469f-a165-70867728950e" })).querySelector(".fr-photo img")).not.toBeNull();
  });

  it("gives the give form what checkout needs: the fundraiser and the smallest gift", () => {
    const form = doc().querySelector<HTMLFormElement>("form#frGiveForm")!;
    expect(form.getAttribute("data-fundraiser-id")).toBe("41");
    expect(form.getAttribute("data-minimum-pence")).toBe("200");
  });

  it("uses the donate page's Gift Aid declaration word for word", () => {
    expect(doc().querySelector(".giftaid-statement")?.textContent).toBe(SINGLE_DONATION_WORDING.wording_snapshot);
  });

  it("shows every supporter, marking all but the newest ten for Show all", () => {
    const wall = Array.from({ length: 13 }, (_, i) => wallEntry(i));
    const d = doc(page({ wall }));
    const items = d.querySelectorAll(".fr-wall__item");
    expect(items).toHaveLength(13);
    // Without JavaScript nothing is hidden; the script tucks away the rest behind Show all.
    expect(d.querySelectorAll(".fr-wall__item[hidden]")).toHaveLength(0);
    expect(d.querySelectorAll(".fr-wall__item[data-wall-more]")).toHaveLength(13 - WALL_FIRST);
    expect(WALL_FIRST).toBe(10);
    expect(d.querySelector("[data-wall-show-all]")?.textContent).toContain("13");
  });

  it("has no Show all button with ten or fewer", () => {
    const d = doc(page({ wall: Array.from({ length: 10 }, (_, i) => wallEntry(i)) }));
    expect(d.querySelector("[data-wall-show-all]")).toBeNull();
  });

  it("shows an anonymous giver as Anonymous, and a hidden amount not at all", () => {
    const d = doc(page({ wall: [wallEntry(1, { name: "Anonymous", amountPence: null, message: null })] }));
    const item = d.querySelector(".fr-wall__item")!;
    expect(item.querySelector(".fr-wall__who")?.textContent).toBe("Anonymous");
    expect(item.querySelector(".fr-wall__amount")).toBeNull();
    expect(item.querySelector(".fr-wall__msg")).toBeNull();
    expect(item.textContent).not.toContain("£");
  });

  it("says how long ago each gift was, with the real time underneath", () => {
    const item = doc().querySelector(".fr-wall__item time")!;
    expect(item.getAttribute("datetime")).toBe(wallEntry(1).createdAt);
    expect(item.textContent).toBe("yesterday");
  });

  it("invites the first donation when the wall is empty", () => {
    expect(doc(page({ wall: [] })).querySelector(".fr-wall__empty")?.textContent).toContain("first");
  });

  it("draws the QR code inline, and offers it to download", () => {
    const d = doc();
    expect(d.querySelector(".fr-qr svg")).not.toBeNull();
    const dl = d.querySelector<HTMLAnchorElement>("a.fr-qr__download")!;
    expect(dl.getAttribute("href")).toBe("/fundraise/robins-santa-dash/qr.svg");
    expect(dl.hasAttribute("download")).toBe(true);
    expect(dl.textContent).toContain("Download the QR code");
  });

  it("shares by plain links, with no script from anyone else", () => {
    const d = doc();
    const fb = d.querySelector<HTMLAnchorElement>("a.fr-share__facebook")!;
    const wa = d.querySelector<HTMLAnchorElement>("a.fr-share__whatsapp")!;
    expect(fb.getAttribute("href")).toBe(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(PAGE_URL)}`);
    expect(wa.getAttribute("href")).toBe(`https://wa.me/?text=${encodeURIComponent(`Robin's Santa Dash, raising money for NBCC: ${PAGE_URL}`)}`);
    expect(d.querySelector("[data-copy-link]")?.getAttribute("data-copy-link")).toBe(PAGE_URL);
    for (const s of d.querySelectorAll("script[src]")) expect(s.getAttribute("src")).toMatch(/^\/assets\/js\//);
  });
});

describe("the sign up page", () => {
  const template = read("fundraise.html");

  it("shows the form while fundraising is on", () => {
    const d = parse(renderFundraiseSignUp(template, true));
    expect(d.querySelector("[data-fundraise-open]")?.hasAttribute("hidden")).toBe(false);
    expect(d.querySelector("[data-fundraise-closed]")?.hasAttribute("hidden")).toBe(true);
  });

  it("says gently that it is not open yet while fundraising is off", () => {
    const d = parse(renderFundraiseSignUp(template, false));
    expect(d.querySelector("[data-fundraise-open]")?.hasAttribute("hidden")).toBe(true);
    const closed = d.querySelector("[data-fundraise-closed]")!;
    expect(closed.hasAttribute("hidden")).toBe(false);
    expect(closed.textContent).toContain("not open yet");
  });
});

// The house style on every public page (copy-rules.test.ts): no hyphen between words and no en or em
// dash in what people read, and on a donor facing page the money is a donation, never a gift (only
// the Gift Aid scheme's own name may say gift). Checked on the pages as the server draws them.
describe("the words on the drawn pages", () => {
  function visible(html: string): string {
    const d = parse(html);
    d.body.querySelectorAll("script, style, svg").forEach((e) => e.remove());
    const attrs = [...d.body.querySelectorAll("[alt],[title],[aria-label],[placeholder]")].map((e) =>
      ["alt", "title", "aria-label", "placeholder"].map((a) => e.getAttribute(a) ?? "").join(" "),
    );
    return [d.body.textContent ?? "", ...attrs].join(" ").replace(/\s+/g, " ");
  }
  const fundraiserHtml = renderFundraiserPage(read("fundraiser.html"), page({ wall: [] }), { pageUrl: PAGE_URL, now: NOW });
  const pages: Array<[string, string]> = [
    ["Get involved", renderGetInvolvedPage(read("events.html"), { events: SEED_EVENTS, fundraisers: [card(), card({ path: "event", eventDate: "2026-11-01", slug: "e" })], fundraisingOn: true, today: "2026-10-02" })],
    ["a fundraiser's page", fundraiserHtml],
    ["the sign up", renderFundraiseSignUp(read("fundraise.html"), true)],
    ["the manage page", read("fundraise-manage.html")],
  ];

  it.each(pages)("%s has no hyphen between words and no en or em dash", (_name, html) => {
    // A web address shown for copying is an address, not words: its hyphens are the slug's.
    const text = visible(html).replace(/\S*\/\S*/g, " ");
    expect(text.match(/\w-\w/g) ?? []).toEqual([]);
    expect(text).not.toMatch(/[–—]/);
  });

  it("a fundraiser's page calls the money a donation", () => {
    const text = visible(fundraiserHtml).toLowerCase().split("gift aid").join(" ");
    expect(text.match(/gift/g) ?? []).toEqual([]);
  });

  it("the give button counts as a donation in the site's visit counter, and the card's button never as tickets", () => {
    expect(parse(fundraiserHtml).querySelector("[data-give-submit]")?.hasAttribute("data-give-pay")).toBe(true);
    expect(renderFundraiserCard(card())).not.toMatch(/class="[^"]*\bev-book(?![-\w])/);
    expect('<a class="btn ev-book x">').toMatch(/class="[^"]*\bev-book(?![-\w])/);
  });
});

// Without JavaScript a form would submit the browser's own way, putting names and email addresses in
// the web address. So every form ships hidden with a plain line saying how else to reach us, and the
// page script swaps them round.
describe("forms without JavaScript", () => {
  const cases: Array<[string, string, string]> = [
    ["the give form", renderFundraiserPage(read("fundraiser.html"), page(), { pageUrl: PAGE_URL, now: NOW }), "#frGiveForm"],
    ["the sign up form", renderFundraiseSignUp(read("fundraise.html"), true), "#fundraiseForm"],
    ["the manage request form", read("fundraise-manage.html"), "#manageRequestForm"],
    ["the manage edit form", read("fundraise-manage.html"), "#manageEditForm"],
  ];
  it.each(cases)("%s ships hidden, with another way shown", (_n, html, sel) => {
    const d = parse(html);
    const form = d.querySelector(sel)!;
    expect(form.hasAttribute("hidden")).toBe(true);
    expect(form.hasAttribute("data-needs-js")).toBe(true);
    const nojs = d.querySelectorAll("[data-nojs]");
    expect(nojs.length).toBeGreaterThan(0);
    for (const n of nojs) expect(n.hasAttribute("hidden")).toBe(false);
  });
});

describe("the fundraiser template", () => {
  it("holds each marker exactly once, and none is left after drawing", () => {
    const t = read("fundraiser.html");
    for (const m of ["<!-- fundraiser:intro -->", "<!-- fundraiser:page -->", "<!-- fundraiser:checkout -->"]) {
      expect(t.split(m), m).toHaveLength(2);
    }
    const out = renderFundraiserPage(t, page(), { pageUrl: PAGE_URL, now: NOW });
    expect(out).not.toContain("<!-- fundraiser:");
    expect(parse(out).querySelectorAll("h1")).toHaveLength(1);
    expect(parse(out).querySelector("#embeddedCheckoutModal")).not.toBeNull();
  });
});
