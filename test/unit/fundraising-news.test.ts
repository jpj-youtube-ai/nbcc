import { describe, it, expect } from "vitest";
import {
  countdownFor,
  daysBetween,
  canPostNews,
  checkNewsPhoto,
  newsPostSchema,
  newsStatusWords,
  publicNews,
  sniffImageMime,
  NEWS_MAX,
  NEWS_PER_DAY,
  NEWS_REFUSED,
  newsLimitReached,
  type NewsRow,
} from "../../src/fundraising/news";

// TASK-506: the rules behind a fundraiser page's countdown and its news updates. Pure, so every case
// is checked here without a database or a clock: the days to go across both clock changes and on
// the day itself, what a photo must be, what the update form takes, and what the public may see.
// Every name and word here is invented.

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x24, 0, 0, 0]), Buffer.from("WEBPVP8 ")]);
const GIF = Buffer.from("GIF89a\x01\x00\x01\x00", "binary");
const HTML = Buffer.from("<html><script>alert(1)</script></html>");

describe("the days between two UK dates", () => {
  it("counts whole days, forwards and back", () => {
    expect(daysBetween("2026-12-01", "2026-12-13")).toBe(12);
    expect(daysBetween("2026-12-13", "2026-12-01")).toBe(-12);
    expect(daysBetween("2026-12-05", "2026-12-05")).toBe(0);
  });

  it("is not thrown out by the clocks changing", () => {
    // BST starts on 29 March 2026 and ends on 25 October 2026: a 23 and a 25 hour day.
    expect(daysBetween("2026-03-28", "2026-03-30")).toBe(2);
    expect(daysBetween("2026-10-24", "2026-10-26")).toBe(2);
  });
});

describe("the countdown on a fundraiser's page", () => {
  const at = (iso: string) => new Date(iso);

  it("says how many days to go before the date", () => {
    expect(countdownFor({ eventDate: "2026-12-13", finished: false }, at("2026-12-01T10:00:00Z"))).toEqual({ kind: "days", days: 12 });
  });

  it("is Tomorrow the day before", () => {
    expect(countdownFor({ eventDate: "2026-12-05", finished: false }, at("2026-12-04T23:59:00Z"))).toEqual({ kind: "days", days: 1 });
  });

  it("is the day itself on the date, all day long in the UK", () => {
    expect(countdownFor({ eventDate: "2026-12-05", finished: false }, at("2026-12-05T00:00:00Z"))).toEqual({ kind: "today" });
    expect(countdownFor({ eventDate: "2026-12-05", finished: false }, at("2026-12-05T23:59:00Z"))).toEqual({ kind: "today" });
  });

  it("goes by the UK day in summer time, not the server's", () => {
    // 23:30 on 1 October in UTC is already 2 October in the UK (BST).
    expect(countdownFor({ eventDate: "2026-10-02", finished: false }, at("2026-10-01T23:30:00Z"))).toEqual({ kind: "today" });
    expect(countdownFor({ eventDate: "2026-10-03", finished: false }, at("2026-10-01T23:30:00Z"))).toEqual({ kind: "days", days: 1 });
  });

  it("counts right over the night the clocks go back and the night they go forward", () => {
    expect(countdownFor({ eventDate: "2026-10-26", finished: false }, at("2026-10-24T22:30:00Z"))).toEqual({ kind: "days", days: 2 });
    expect(countdownFor({ eventDate: "2026-03-30", finished: false }, at("2026-03-28T23:30:00Z"))).toEqual({ kind: "days", days: 2 });
    // 23:30 UTC on 29 March is 00:30 on 30 March in the UK.
    expect(countdownFor({ eventDate: "2026-03-30", finished: false }, at("2026-03-29T23:30:00Z"))).toEqual({ kind: "today" });
  });

  it("is nothing after the date, with no date, or once finished", () => {
    expect(countdownFor({ eventDate: "2026-12-05", finished: false }, at("2026-12-06T09:00:00Z"))).toBeNull();
    expect(countdownFor({ eventDate: null, finished: false }, at("2026-12-06T09:00:00Z"))).toBeNull();
    expect(countdownFor({ eventDate: "2026-12-05", finished: true }, at("2026-12-01T09:00:00Z"))).toBeNull();
    expect(countdownFor({ eventDate: "2026-12-05", finished: true }, at("2026-12-05T09:00:00Z"))).toBeNull();
  });
});

describe("what a news photo must be", () => {
  it("knows a JPEG, a PNG and a WebP by their first bytes", () => {
    expect(sniffImageMime(JPEG)).toBe("image/jpeg");
    expect(sniffImageMime(PNG)).toBe("image/png");
    expect(sniffImageMime(WEBP)).toBe("image/webp");
    expect(sniffImageMime(GIF)).toBeNull();
    expect(sniffImageMime(HTML)).toBeNull();
    expect(sniffImageMime(Buffer.alloc(0))).toBeNull();
  });

  it("takes a JPEG, PNG or WebP whose bytes match what it says it is", () => {
    expect(checkNewsPhoto("image/jpeg", JPEG)).toEqual({ ok: true, mime: "image/jpeg" });
    expect(checkNewsPhoto("image/png", PNG)).toEqual({ ok: true, mime: "image/png" });
    expect(checkNewsPhoto("image/webp", WEBP)).toEqual({ ok: true, mime: "image/webp" });
  });

  it("refuses a GIF, anything that is not a picture, and a picture that says it is something else", () => {
    expect(checkNewsPhoto("image/gif", GIF)).toEqual({ ok: false, reason: "type" });
    expect(checkNewsPhoto("image/png", HTML)).toEqual({ ok: false, reason: "type" });
    expect(checkNewsPhoto("text/html", HTML)).toEqual({ ok: false, reason: "type" });
    expect(checkNewsPhoto("image/png", JPEG)).toEqual({ ok: false, reason: "type" });
  });

  it("has the same 2 MB limit as the photos staff upload", () => {
    const big = Buffer.concat([JPEG, Buffer.alloc(2 * 1024 * 1024)]);
    expect(checkNewsPhoto("image/jpeg", big)).toEqual({ ok: false, reason: "size" });
  });
});

describe("the update form", () => {
  it("takes up to 500 characters, trimmed, with or without a photo", () => {
    expect(NEWS_MAX).toBe(500);
    const ok = newsPostSchema.safeParse({ text: "  We walked 10 miles today!  " });
    expect(ok.success && ok.data).toEqual({ text: "We walked 10 miles today!", photo: null });
    const withPhoto = newsPostSchema.safeParse({ text: "Halfway", photo: { mime: "image/jpeg", dataBase64: "AAAA" } });
    expect(withPhoto.success && withPhoto.data.photo).toEqual({ mime: "image/jpeg", dataBase64: "AAAA" });
  });

  it("needs some words, and no more than 500", () => {
    const empty = newsPostSchema.safeParse({ text: "   " });
    expect(empty.success).toBe(false);
    expect(!empty.success && empty.error.issues[0].message).toBe("Write a few words for your update.");
    const long = newsPostSchema.safeParse({ text: "a".repeat(501) });
    expect(!long.success && long.error.issues[0].message).toBe("Keep your update to 500 characters or fewer.");
  });

  it("checks the words the way the supporter wall does", () => {
    const rude = newsPostSchema.safeParse({ text: "What a bloody fuck of a day" });
    expect(rude.success).toBe(false);
    expect(!rude.success && rude.error.issues[0].message).toBe(NEWS_REFUSED);
    // A word that only contains a blocked one is fine (Scunthorpe, Cockburn).
    expect(newsPostSchema.safeParse({ text: "Thank you to everyone in Scunthorpe and the Cockburn family" }).success).toBe(true);
  });
});

describe("how many updates a day", () => {
  it("is five a day for each fundraiser", () => {
    expect(NEWS_PER_DAY).toBe(5);
    expect(newsLimitReached(4)).toBe(false);
    expect(newsLimitReached(5)).toBe(true);
  });
});

describe("who can post an update", () => {
  const f = { status: "approved" as const, public: true, path: "raising" as const };
  it("is an approved fundraiser with a page", () => {
    expect(canPostNews(f)).toBe(true);
  });
  it("is not a finished, new or declined one, an event, or one not shown on the website", () => {
    expect(canPostNews({ ...f, status: "finished" })).toBe(false);
    expect(canPostNews({ ...f, status: "new" })).toBe(false);
    expect(canPostNews({ ...f, status: "declined" })).toBe(false);
    expect(canPostNews({ ...f, path: "event" })).toBe(false);
    expect(canPostNews({ ...f, public: false })).toBe(false);
  });
});

describe("an update's status, in the organiser's words", () => {
  it("says where each one is up to", () => {
    expect(newsStatusWords("pending")).toBe("Waiting for us to check");
    expect(newsStatusWords("approved")).toBe("On your page");
    expect(newsStatusWords("rejected")).toBe("Not used");
    expect(newsStatusWords("hidden")).toBe("Not used");
  });
});

describe("the news the public sees", () => {
  const row = (id: number, over: Partial<NewsRow> = {}): NewsRow => ({
    id,
    fundraiserId: 7,
    text: `Update ${id}`,
    status: "approved",
    photoId: null,
    createdAt: new Date(Date.UTC(2026, 10, id, 12)).toISOString(),
    decidedAt: null,
    decidedBy: null,
    rejectReason: null,
    ...over,
  });

  it("is only what staff approved, newest first", () => {
    const rows = [row(1), row(3), row(2, { status: "pending" }), row(4, { status: "rejected" }), row(5, { status: "hidden" }), row(6)];
    expect(publicNews(rows).map((n) => n.text)).toEqual(["Update 6", "Update 3", "Update 1"]);
  });

  it("gives an approved photo its public address, and nothing else about the row", () => {
    const id = "0b5c1d2e-3f40-4a5b-8c6d-7e8f9a0b1c2d";
    const [n] = publicNews([row(1, { photoId: id, rejectReason: "internal words", decidedBy: "admin:staff@example.com" })]);
    expect(n).toEqual({ id: 1, text: "Update 1", createdAt: row(1).createdAt, photoSrc: `/media/fundraiser-news/${id}` });
  });
});
