import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import type Stripe from "stripe";
import { giftArrival, ARRIVAL_CHANNELS } from "../../src/donations/arrival";
import { arrivalFromCheckoutSession } from "../../src/db/stripe-webhook-model";

// What brought someone to give (docs/superpowers/specs/2026-11-05-donations-screen-design.md, "What
// we know today", 1). Pure: the giving page (the checkout request's Referer), the page before it
// (document.referrer, sent by the page) and our own addresses in; one channel out, sorted by the
// same rules page views use (src/analytics/channel.ts). Invented addresses only.

const OWN = ["nbcc.scot", "www.nbcc.scot"];
const arrive = (givingPage: string | null, cameFrom: string | null, over: { doNotTrack?: boolean; ownHosts?: string[] } = {}) =>
  giftArrival({ givingPage, cameFrom, ownHosts: over.ownHosts ?? OWN, doNotTrack: over.doNotTrack ?? false });

describe("giftArrival", () => {
  it("a QR code scanned straight onto the Donate page is that QR code", () => {
    expect(arrive("https://nbcc.scot/donate?utm_medium=qr&utm_campaign=c12", "")).toEqual({
      channel: "qr",
      source: null,
      campaign: "c12",
      givenOn: "/donate",
    });
  });

  it("a QR code scanned onto the home page, then Donate pressed, is still that QR code", () => {
    expect(arrive("https://nbcc.scot/donate", "https://nbcc.scot/?utm_medium=qr&utm_campaign=home")).toEqual({
      channel: "qr",
      source: null,
      campaign: "home",
      givenOn: "/donate",
    });
  });

  it("from the Get involved page is another page of ours, named by its path without its query", () => {
    expect(arrive("https://nbcc.scot/fill", "https://www.nbcc.scot/get-involved/?tab=give")).toEqual({
      channel: "site",
      source: "/get-involved",
      campaign: null,
      givenOn: "/fill",
    });
  });

  it("from the home page is another page of ours, the home page", () => {
    expect(arrive("https://nbcc.scot/donate", "https://nbcc.scot/")?.source).toBe("/");
  });

  it("from Google is Search, Google", () => {
    expect(arrive("https://nbcc.scot/donate", "https://www.google.co.uk/")).toEqual({
      channel: "search",
      source: "Google",
      campaign: null,
      givenOn: "/donate",
    });
  });

  it("from Facebook is Social media, Facebook", () => {
    expect(arrive("https://nbcc.scot/donate", "https://l.facebook.com/l.php?u=https%3A%2F%2Fnbcc.scot")).toMatchObject({
      channel: "social",
      source: "Facebook",
    });
  });

  it("from the newsletter, by its link tags or its link tracker, is the newsletter", () => {
    expect(arrive("https://nbcc.scot/donate?utm_source=newsletter&utm_campaign=december", "")).toMatchObject({
      channel: "newsletter",
      campaign: "december",
    });
    expect(arrive("https://nbcc.scot/donate", "https://click.news.nbcc.scot/CL0/abc")).toMatchObject({ channel: "newsletter" });
  });

  it("a link tagged utm_medium=email is an email", () => {
    expect(arrive("https://nbcc.scot/donate?utm_medium=email&utm_campaign=receipt", "")).toMatchObject({
      channel: "email",
      campaign: "receipt",
    });
  });

  it("another website is that website's host only", () => {
    expect(arrive("https://nbcc.scot/donate", "https://www.example.org/news/our-charity-pick?id=4")).toMatchObject({
      channel: "other_websites",
      source: "example.org",
    });
  });

  it("no page before it is typed in or a bookmark", () => {
    expect(arrive("https://nbcc.scot/donate", "")).toEqual({ channel: "direct", source: null, campaign: null, givenOn: "/donate" });
  });

  it("coming back from paying on Stripe is not a new arrival: typed in or a bookmark", () => {
    expect(arrive("https://nbcc.scot/donate", "https://checkout.stripe.com/c/pay/cs_test_abc")).toMatchObject({ channel: "direct", source: null });
  });

  it("coming back from a thank you page is not another page of ours: typed in or a bookmark", () => {
    expect(arrive("https://nbcc.scot/donate", "https://nbcc.scot/donate/thank-you?session_id=cs_test_abc")).toMatchObject({
      channel: "direct",
      source: null,
    });
    expect(arrive("https://nbcc.scot/fill", "https://nbcc.scot/fill/thank-you")).toMatchObject({ channel: "direct" });
  });

  it("another website's own link tags are not ours, and are not read", () => {
    expect(arrive("https://nbcc.scot/donate", "https://www.example.org/?utm_medium=qr&utm_campaign=c99")).toMatchObject({
      channel: "other_websites",
      source: "example.org",
      campaign: null,
    });
  });

  it("the giving page's tags win over the page before it", () => {
    expect(arrive("https://nbcc.scot/donate?utm_medium=qr&utm_campaign=c12", "https://www.google.com/")).toMatchObject({
      channel: "qr",
      campaign: "c12",
    });
  });

  it("records nothing at all when the browser asks not to be tracked", () => {
    expect(arrive("https://nbcc.scot/donate?utm_medium=qr&utm_campaign=c12", "", { doNotTrack: true })).toBeNull();
  });

  it("records nothing when the page did not say where it came from (an older page, or another caller)", () => {
    expect(arrive("https://nbcc.scot/donate", null)).toBeNull();
    expect(arrive(null, null)).toBeNull();
  });

  it("a giving page that is not ours gives no page, and its tags are not read", () => {
    expect(arrive("https://example.com/donate?utm_medium=qr&utm_campaign=c12", "")).toEqual({
      channel: "direct",
      source: null,
      campaign: null,
      givenOn: null,
    });
    expect(arrive(null, "")).toEqual({ channel: "direct", source: null, campaign: null, givenOn: null });
    expect(arrive("not an address", "")?.givenOn).toBeNull();
  });

  it("names a fundraiser's page by its path", () => {
    expect(arrive("https://nbcc.scot/fundraise/sams-santa-dash?x=1", "")?.givenOn).toBe("/fundraise/sams-santa-dash");
  });

  // Invented tokens only.
  const TOKEN = "Zq7Lm2Xc9Vb4Nk8Pw3Rt";

  it("never keeps a token from one of our own page addresses as where they came from", () => {
    expect(arrive("https://nbcc.scot/donate", `https://nbcc.scot/thank-you/letter/${TOKEN}`)?.source).toBe("/thank-you");
    expect(arrive("https://nbcc.scot/donate", `https://nbcc.scot/gift-aid/declare/${TOKEN}`)?.source).toBe("/gift-aid");
    expect(arrive("https://nbcc.scot/donate", `https://nbcc.scot/fundraise/${TOKEN}/news`)?.source).toBe("/fundraise");
    expect(arrive("https://nbcc.scot/donate", "https://nbcc.scot/ball/7f3e2a1c-9b4d-4e8f-a6c2-1d5b9e0f3a7c")?.source).toBe("/ball");
  });

  it("keeps nothing of a came from page whose first part is itself personal", () => {
    expect(arrive("https://nbcc.scot/donate", `https://nbcc.scot/g/${TOKEN}`)).toMatchObject({ channel: "site", source: null });
    expect(arrive("https://nbcc.scot/donate", `https://nbcc.scot/${TOKEN}`)).toMatchObject({ channel: "site", source: null });
  });

  it("never keeps a token from the giving page's address", () => {
    expect(arrive(`https://nbcc.scot/fundraise/${TOKEN}`, "")?.givenOn).toBe("/fundraise");
    expect(arrive(`https://nbcc.scot/thank-you/letter/${TOKEN}`, "")?.givenOn).toBe("/thank-you");
    expect(arrive(`https://nbcc.scot/g/${TOKEN}`, "")?.givenOn).toBeNull();
  });

  it("knows our own address with a port, as on a local copy", () => {
    expect(arrive("http://localhost:3000/donate", "http://localhost:3000/get-involved", { ownHosts: ["localhost:3000"] })).toEqual({
      channel: "site",
      source: "/get-involved",
      campaign: null,
      givenOn: "/donate",
    });
  });

  it("cuts every value to 100 characters", () => {
    const long = "a".repeat(300);
    const tagged = arrive(`https://nbcc.scot/${long}?utm_medium=qr&utm_campaign=${long}`, "");
    expect(tagged?.campaign).toHaveLength(100);
    expect(tagged?.givenOn).toHaveLength(100);
    expect(arrive("https://nbcc.scot/donate", `https://nbcc.scot/${long}`)?.source).toHaveLength(100);
    expect(arrive("https://nbcc.scot/donate?utm_source=" + long, "")?.source).toHaveLength(100);
  });

  it("only ever answers with one of the known channels", () => {
    expect(ARRIVAL_CHANNELS).toEqual(["qr", "email", "newsletter", "search", "social", "other_websites", "direct", "site"]);
  });
});

const session = (metadata: Record<string, string> | null): Pick<Stripe.Checkout.Session, "metadata"> =>
  ({ metadata }) as Pick<Stripe.Checkout.Session, "metadata">;

describe("arrivalFromCheckoutSession", () => {
  it("reads the four keys the checkout stamps", () => {
    expect(
      arrivalFromCheckoutSession(session({ arrChannel: "qr", arrCampaign: "c12", givenOn: "/donate", mode: "once" })),
    ).toEqual({ channel: "qr", source: null, campaign: "c12", givenOn: "/donate" });
    expect(arrivalFromCheckoutSession(session({ arrChannel: "site", arrSource: "/get-involved", givenOn: "/fill" }))).toEqual({
      channel: "site",
      source: "/get-involved",
      campaign: null,
      givenOn: "/fill",
    });
  });

  it("is null without a known channel, whatever else is there", () => {
    expect(arrivalFromCheckoutSession(session({ mode: "once" }))).toBeNull();
    expect(arrivalFromCheckoutSession(session({ arrChannel: "carrier pigeon", givenOn: "/donate" }))).toBeNull();
    expect(arrivalFromCheckoutSession(session(null))).toBeNull();
    expect(arrivalFromCheckoutSession(null)).toBeNull();
    expect(arrivalFromCheckoutSession(undefined)).toBeNull();
  });

  it("cuts anything long to 100 characters", () => {
    const long = "b".repeat(400);
    const got = arrivalFromCheckoutSession(session({ arrChannel: "other_websites", arrSource: long, arrCampaign: long, givenOn: long }));
    expect(got?.source).toHaveLength(100);
    expect(got?.campaign).toHaveLength(100);
    expect(got?.givenOn).toHaveLength(100);
  });
});

describe("the privacy notice", () => {
  it("says, under What we collect, that we note what brought someone to give and how they paid", async () => {
    const { readFileSync } = await import("node:fs");
    const html = readFileSync(resolve(__dirname, "../../privacy.html"), "utf8").replace(/\s+/g, " ");
    const collect = html.slice(html.indexOf("<h2>What we collect</h2>"), html.indexOf("<h2>Why we use it"));
    expect(collect).toContain(
      "<li>where you came from when you gave, such as one of our QR codes, an email or another website, and how you paid " +
        "(for a card, only its type, country and last four digits, which our payment provider tells us);</li>",
    );
  });
});

// The one migration for this piece of work (Tasks 1 and 2): nullable columns on donations only, so a
// code rollback is safe (golden rule 2). Checked against a fake pgm, without a database.
const ROOT = resolve(__dirname, "../..");
const migration = createRequire(import.meta.url)(resolve(ROOT, "migrations", "1791200000370_donation-arrival-and-payment.js")) as {
  up: (pgm: unknown) => void;
  down: (pgm: unknown) => void;
};

function fakePgm() {
  const calls: Array<{ op: string; args: unknown[] }> = [];
  const record =
    (op: string) =>
    (...args: unknown[]) => {
      calls.push({ op, args });
    };
  return {
    calls,
    pgm: {
      addColumns: record("addColumns"),
      dropColumns: record("dropColumns"),
      createIndex: record("createIndex"),
      dropIndex: record("dropIndex"),
      sql: record("sql"),
    },
  };
}

describe("the arrival and payment migration", () => {
  const COLUMNS = [
    "arrival_channel",
    "arrival_source",
    "arrival_campaign",
    "given_on",
    "pay_method",
    "pay_wallet",
    "card_brand",
    "card_last4",
    "card_country",
    "pay_checked_at",
  ];

  it("adds only nullable columns, each with a comment, to donations", () => {
    const { calls, pgm } = fakePgm();
    migration.up(pgm);
    const adds = calls.filter((c) => c.op === "addColumns");
    expect(adds).toHaveLength(1);
    expect(adds[0].args[0]).toBe("donations");
    const cols = adds[0].args[1] as Record<string, { type: string; notNull?: boolean; default?: unknown; comment?: string }>;
    expect(Object.keys(cols)).toEqual(COLUMNS);
    for (const [name, col] of Object.entries(cols)) {
      expect(col.notNull, name).toBeFalsy();
      expect(col.default, name).toBeUndefined();
      expect(col.comment, name).toMatch(/\w/);
    }
    expect(cols.pay_checked_at.type).toBe("timestamptz");
    expect(cols.arrival_channel.type).toBe("text");
    expect(calls.some((c) => c.op === "sql" && /drop|alter column|rename/i.test(String(c.args[0])))).toBe(false);
    expect(calls.some((c) => c.op === "dropColumns")).toBe(false);
  });

  it("indexes the channel and the payment method, only where they are set", () => {
    const { calls, pgm } = fakePgm();
    migration.up(pgm);
    const idx = calls.filter((c) => c.op === "createIndex");
    expect(idx.map((c) => [c.args[0], c.args[1]])).toEqual([
      ["donations", "arrival_channel"],
      ["donations", "pay_method"],
    ]);
    expect((idx[0].args[2] as { where: string }).where).toBe("arrival_channel IS NOT NULL");
    expect((idx[1].args[2] as { where: string }).where).toBe("pay_method IS NOT NULL");
  });

  it("is numbered above Head Elf HQ's migrations (360), so it sorts after them", async () => {
    const { readdirSync } = await import("node:fs");
    const names = readdirSync(resolve(ROOT, "migrations")).sort();
    const at = names.indexOf("1791200000370_donation-arrival-and-payment.js");
    expect(at).toBeGreaterThan(names.indexOf("1791200000360_elf-families-removed.js"));
    expect(names.indexOf("1791200000360_elf-families-removed.js")).toBeGreaterThan(-1);
  });

  it("goes back down by dropping exactly what it added", () => {
    const { calls, pgm } = fakePgm();
    migration.down(pgm);
    const drops = calls.filter((c) => c.op === "dropColumns");
    expect(drops).toHaveLength(1);
    expect(drops[0].args).toEqual(["donations", COLUMNS]);
  });
});
