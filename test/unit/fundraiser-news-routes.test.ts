import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

// TASK-506: the routes behind news updates, driven over HTTP through the real router and body
// parser, with the database and the emails mocked. What is checked: only the signed in organiser
// posts to their own running fundraiser, five a day, words checked like the wall's, a photo checked
// by its bytes and its size; a waiting photo is never public (only its owner and staff see it);
// staff approve, reject (with an internal reason) and hide with the right permission, every
// decision emailing the organiser where it should. Every name and address here is invented.

const db = vi.hoisted(() => ({
  fundraisingIsOn: vi.fn(),
  listForOrganiser: vi.fn(),
  getFundraiser: vi.fn(),
}));
const news = vi.hoisted(() => ({
  postUpdate: vi.fn(),
  listUpdates: vi.fn(),
  photoForOwner: vi.fn(),
  photoForStaff: vi.fn(),
  publicPhoto: vi.fn(),
  decideUpdate: vi.fn(),
  pendingByFundraiser: vi.fn(),
}));
const signIn = vi.hoisted(() => ({ findSession: vi.fn() }));
const send = vi.hoisted(() => ({ sendNewsDecisionEmail: vi.fn() }));
const users = vi.hoisted(() => ({ getUserAuthRow: vi.fn() }));

vi.mock("../../src/db/fundraisers", () => ({ ...db, FundraiserError: class extends Error {} }));
vi.mock("../../src/db/fundraiser-updates", () => {
  class NewsError extends Error {
    constructor(public readonly reason: string) {
      super(reason);
    }
  }
  return { ...news, NewsError };
});
vi.mock("../../src/db/fundraiser-sign-in", () => signIn);
vi.mock("../../src/fundraising/send", () => ({
  ...send,
  fundraiserPageUrl: (slug: string) => `https://nbcc.test/fundraise/${slug}`,
  manageUrl: () => "https://nbcc.test/fundraise/manage",
  sendSignUpEmails: vi.fn(),
  sendSignInCodeEmail: vi.fn(),
  sendFinishedStaffEmail: vi.fn(),
}));
vi.mock("../../src/db/admin-users", () => users);
vi.mock("../../src/newsletter/self-signup", () => ({ subscribeSelf: vi.fn() }));
vi.mock("../../src/clients/turnstile", () => ({ captchaEnabled: () => false, captchaSiteKey: () => null, verifyCaptcha: vi.fn() }));
vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));
vi.mock("../../src/config", () => ({
  config: {
    NODE_ENV: "production",
    PORTAL_BASE_URL: "https://nbcc.test",
    ADMIN_SESSION_SECRET: "a-test-secret",
    DATABASE_URL: "postgres://localhost:5432/test",
  },
}));

import { fundraiserNewsRouter, newsBodyGuard, NEWS_POST_PATH, NEWS_JSON_BODY_LIMIT } from "../../src/routes/fundraiser-news";
import { signAdminSession } from "../../src/admin/session";
import { meter, type FundraiserRecord } from "../../src/fundraising/model";
import { NEWS_REFUSED, type NewsRow } from "../../src/fundraising/news";

const PHOTO_ID = "0b5c1d2e-3f40-4a5b-8c6d-7e8f9a0b1c2d";
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const COOKIE = "nbcc_fr_session=abcDEF123_-";

let server: Server;
let base = "";
beforeAll(async () => {
  const app = express();
  app.set("trust proxy", 1);
  app.use(NEWS_POST_PATH, newsBodyGuard, express.json({ limit: NEWS_JSON_BODY_LIMIT }));
  app.use(express.json());
  app.use(fundraiserNewsRouter);
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

const record = (over: Partial<FundraiserRecord> = {}) =>
  ({
    id: 9,
    slug: "sams-walk",
    path: "raising",
    kind: "run_walk",
    title: "Sam's Walk",
    description: "Ten miles.",
    eventDate: null,
    public: true,
    status: "approved",
    name: "Sam Sample",
    email: "Sam@Example.com",
    meter: meter({ onlinePence: 0, cashPence: 0, targetPence: 25000 }),
    editWaiting: false,
    ...over,
  }) as FundraiserRecord & { meter: ReturnType<typeof meter>; editWaiting: boolean };

const row = (over: Partial<NewsRow> = {}): NewsRow => ({
  id: 31,
  fundraiserId: 9,
  text: "We walked ten miles!",
  status: "pending",
  photoId: null,
  createdAt: "2026-11-20T10:00:00.000Z",
  decidedAt: null,
  decidedBy: null,
  rejectReason: null,
  ...over,
});

beforeEach(() => {
  for (const group of [db, news, signIn, send, users]) for (const fn of Object.values(group)) fn.mockReset();
  db.fundraisingIsOn.mockResolvedValue(true);
  db.getFundraiser.mockResolvedValue(record());
  db.listForOrganiser.mockResolvedValue([record()]);
  signIn.findSession.mockResolvedValue({ email: "sam@example.com" });
  news.postUpdate.mockResolvedValue({ verdict: "ok", update: row() });
  news.listUpdates.mockResolvedValue([]);
  send.sendNewsDecisionEmail.mockResolvedValue(true);
});

// As the private area's page sends it: JSON, from our own origin, with the session cookie.
function organiser(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  return fetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Origin: base, Cookie: COOKIE, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const post = (body: unknown, headers?: Record<string, string>) => organiser("POST", "/api/fundraise/manage/fundraisers/9/news", body, headers);

describe("posting an update from the private area", () => {
  it("stores the organiser's words as waiting for staff, and answers with where it is up to", async () => {
    const res = await post({ text: "  We walked ten miles!  " });
    expect(res.status).toBe(202);
    expect(news.postUpdate).toHaveBeenCalledWith(9, "sam@example.com", { text: "We walked ten miles!", photo: null });
    const body = await res.json();
    expect(body).toEqual({
      status: "waiting",
      update: { id: 31, text: "We walked ten miles!", status: "pending", statusWords: "Waiting for us to check", createdAt: row().createdAt, photoUrl: null },
    });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("takes a photo whose bytes really are the picture it says", async () => {
    news.postUpdate.mockResolvedValue({ verdict: "ok", update: row({ id: 32, photoId: PHOTO_ID }) });
    const res = await post({ text: "Look at us", photo: { mime: "image/jpeg", dataBase64: JPEG.toString("base64") } });
    expect(res.status).toBe(202);
    const [, , sent] = news.postUpdate.mock.calls[0];
    expect(sent.photo.mime).toBe("image/jpeg");
    expect(Buffer.compare(sent.photo.bytes, JPEG)).toBe(0);
    // The organiser sees their own photo through the private area, never its public address.
    expect((await res.json()).update.photoUrl).toBe("/api/fundraise/manage/news/32/photo");
  });

  it("refuses anything that is not a JPEG, PNG or WebP, and stores nothing", async () => {
    for (const photo of [
      { mime: "image/png", dataBase64: Buffer.from("<html><script>alert(1)</script></html>").toString("base64") },
      { mime: "image/gif", dataBase64: Buffer.from("GIF89a....").toString("base64") },
      { mime: "image/jpeg", dataBase64: "not base64 at all!!" },
    ]) {
      const res = await post({ text: "Hello", photo });
      expect(res.status).toBe(400);
      expect((await res.json()).fields.photo).toBe("That photo is not one we can use. Try a JPG or PNG.");
    }
    expect(news.postUpdate).not.toHaveBeenCalled();
  });

  it("refuses a photo over 2 MB, the same as staff uploads", async () => {
    const big = Buffer.concat([JPEG, Buffer.alloc(2 * 1024 * 1024)]);
    const res = await post({ text: "Hello", photo: { mime: "image/jpeg", dataBase64: big.toString("base64") } });
    expect(res.status).toBe(413);
    expect((await res.json()).fields.photo).toBe("That photo is too big. Try a smaller one.");
    expect(news.postUpdate).not.toHaveBeenCalled();
  });

  it("checks the words like the supporter wall, and the length", async () => {
    let res = await post({ text: "What a fucking day" });
    expect(res.status).toBe(400);
    expect((await res.json()).fields.text).toBe(NEWS_REFUSED);
    res = await post({ text: "a".repeat(501) });
    expect((await res.json()).fields.text).toBe("Keep your update to 500 characters or fewer.");
    res = await post({ text: "" });
    expect((await res.json()).fields.text).toBe("Write a few words for your update.");
    expect(news.postUpdate).not.toHaveBeenCalled();
  });

  it("is five a day for each fundraiser", async () => {
    news.postUpdate.mockResolvedValue({ verdict: "limit" });
    const res = await post({ text: "Number six" });
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe("You have posted 5 updates in the last day. Please try again tomorrow.");
  });

  it("is only for their own fundraiser: anyone else's reads as not there", async () => {
    db.getFundraiser.mockResolvedValue(record({ email: "someone.else@example.com" }));
    const res = await post({ text: "Hello" });
    expect(res.status).toBe(404);
    expect(news.postUpdate).not.toHaveBeenCalled();
  });

  it("is only for one still running with a page", async () => {
    for (const over of [{ status: "finished" as const }, { path: "event" as const }, { public: false }]) {
      db.getFundraiser.mockResolvedValue(record(over));
      const res = await post({ text: "Hello" });
      expect(res.status).toBe(410);
    }
    expect(news.postUpdate).not.toHaveBeenCalled();
  });

  it("needs a session, before the body is even read", async () => {
    const res = await fetch(`${base}/api/fundraise/manage/fundraisers/9/news`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: base },
      body: JSON.stringify({ text: "Hello" }),
    });
    expect(res.status).toBe(401);
    signIn.findSession.mockResolvedValue(null);
    expect((await post({ text: "Hello" })).status).toBe(401);
    expect(news.postUpdate).not.toHaveBeenCalled();
  });

  it("is refused when another website's page sends it", async () => {
    const res = await post({ text: "Hello" }, { Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site" });
    expect(res.status).toBe(403);
    expect(news.postUpdate).not.toHaveBeenCalled();
  });

  it("is not there while fundraising is switched off", async () => {
    db.fundraisingIsOn.mockResolvedValue(false);
    expect((await post({ text: "Hello" })).status).toBe(404);
  });
});

describe("the organiser's own updates", () => {
  it("lists each of their fundraisers with its updates, in their words, and nothing internal", async () => {
    db.listForOrganiser.mockResolvedValue([record(), record({ id: 10, status: "finished", title: "Old walk" })]);
    news.listUpdates.mockResolvedValue([
      row({ id: 33, status: "rejected", rejectReason: "A poster", decidedBy: "admin:fern@example.com" }),
      row({ id: 32, status: "approved", photoId: PHOTO_ID }),
      row({ id: 31, fundraiserId: 10, status: "hidden" }),
    ]);
    const res = await organiser("GET", "/api/fundraise/manage/news");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(news.listUpdates).toHaveBeenCalledWith([9, 10]);
    const body = await res.json();
    expect(body.fundraisers.map((f: { id: number; canPost: boolean }) => [f.id, f.canPost])).toEqual([
      [9, true],
      [10, false],
    ]);
    expect(body.fundraisers[0].updates.map((u: { statusWords: string }) => u.statusWords)).toEqual(["Not used", "On your page"]);
    expect(body.fundraisers[0].updates[1].photoUrl).toBe("/api/fundraise/manage/news/32/photo");
    expect(body.fundraisers[1].updates[0].statusWords).toBe("Not used");
    const text = JSON.stringify(body);
    expect(text).not.toContain("A poster");
    expect(text).not.toContain("fern@example.com");
  });

  it("serves their own photo to them, kept by no cache", async () => {
    news.photoForOwner.mockResolvedValue({ mime: "image/jpeg", bytes: JPEG });
    const res = await organiser("GET", "/api/fundraise/manage/news/32/photo");
    expect(res.status).toBe(200);
    expect(news.photoForOwner).toHaveBeenCalledWith(32, "sam@example.com");
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(Buffer.compare(Buffer.from(await res.arrayBuffer()), JPEG)).toBe(0);
  });

  it("serves no one else's, and nothing without a session", async () => {
    news.photoForOwner.mockResolvedValue(null);
    expect((await organiser("GET", "/api/fundraise/manage/news/32/photo")).status).toBe(404);
    signIn.findSession.mockResolvedValue(null);
    expect((await organiser("GET", "/api/fundraise/manage/news/32/photo")).status).toBe(401);
  });
});

describe("a photo on the public page", () => {
  const get = (id: string) => fetch(`${base}/media/fundraiser-news/${id}`);

  it("is served once its update is approved", async () => {
    news.publicPhoto.mockResolvedValue({ mime: "image/webp", bytes: JPEG });
    const res = await get(PHOTO_ID);
    expect(res.status).toBe(200);
    expect(news.publicPhoto).toHaveBeenCalledWith(PHOTO_ID);
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    // Short, so a photo staff hide stops being served soon after.
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
  });

  it("is never served while it waits, once hidden or rejected (the database answers nothing)", async () => {
    news.publicPhoto.mockResolvedValue(null);
    expect((await get(PHOTO_ID)).status).toBe(404);
  });

  it("is not looked for at an address that is not one of ours, or while fundraising is off", async () => {
    expect((await get("../../etc/passwd")).status).toBe(404);
    expect((await get("not-a-uuid")).status).toBe(404);
    db.fundraisingIsOn.mockResolvedValue(false);
    expect((await get(PHOTO_ID)).status).toBe(404);
    expect(news.publicPhoto).not.toHaveBeenCalled();
  });
});

describe("staff in Admin > Fundraising", () => {
  const SECRET = "a-test-secret";
  const STAFF = "kim.fundraising@nbcc.test";
  function tokenFor(role: string, permissions: Record<string, string> = {}) {
    users.getUserAuthRow.mockResolvedValue({ id: 1, email: STAFF, status: "active", role, permissions });
    return signAdminSession({ sub: 1, email: STAFF, role, now: new Date(), secret: SECRET }).token;
  }
  const staff = (token: string | null, method: string, path: string, body?: unknown) =>
    fetch(`${base}${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  it("lists a sign up's updates for anyone who can look, with the internal reason", async () => {
    news.listUpdates.mockResolvedValue([row({ status: "rejected", rejectReason: "A poster", photoId: PHOTO_ID })]);
    const res = await staff(tokenFor("viewer"), "GET", "/api/admin/fundraisers/9/news");
    expect(res.status).toBe(200);
    expect(news.listUpdates).toHaveBeenCalledWith([9]);
    const [u] = (await res.json()).updates;
    expect(u).toMatchObject({ id: 31, status: "rejected", rejectReason: "A poster", photoUrl: "/api/admin/fundraisers/9/news/31/photo" });
  });

  it("needs a session", async () => {
    expect((await staff(null, "GET", "/api/admin/fundraisers/9/news")).status).toBe(401);
    expect((await staff(null, "POST", "/api/admin/fundraisers/9/news/31/approve")).status).toBe(401);
  });

  it("says how many wait on each sign up, for the pill on the list", async () => {
    news.pendingByFundraiser.mockResolvedValue({ 9: 2 });
    const res = await staff(tokenFor("viewer"), "GET", "/api/admin/fundraising/news-waiting");
    expect(await res.json()).toEqual({ counts: { 9: 2 } });
  });

  it("shows staff a waiting photo, kept by no cache", async () => {
    news.photoForStaff.mockResolvedValue({ mime: "image/png", bytes: JPEG });
    const res = await staff(tokenFor("viewer"), "GET", "/api/admin/fundraisers/9/news/31/photo");
    expect(res.status).toBe(200);
    expect(news.photoForStaff).toHaveBeenCalledWith(9, 31);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    news.photoForStaff.mockResolvedValue(null);
    expect((await staff(tokenFor("viewer"), "GET", "/api/admin/fundraisers/9/news/31/photo")).status).toBe(404);
  });

  it("lets only those who can edit decide", async () => {
    const res = await staff(tokenFor("viewer"), "POST", "/api/admin/fundraisers/9/news/31/approve");
    expect(res.status).toBe(403);
    expect(news.decideUpdate).not.toHaveBeenCalled();
  });

  it("approves, recording who, and emails the organiser that it is live", async () => {
    news.decideUpdate.mockResolvedValue(row({ status: "approved" }));
    const res = await staff(tokenFor("editor"), "POST", "/api/admin/fundraisers/9/news/31/approve");
    expect(res.status).toBe(200);
    expect(news.decideUpdate).toHaveBeenCalledWith(9, 31, "approve", `admin:${STAFF}`, null);
    expect(send.sendNewsDecisionEmail).toHaveBeenCalledWith(expect.objectContaining({ id: 9 }), true, true);
    expect((await res.json()).update.status).toBe("approved");
  });

  it("rejects with a reason kept for staff, and emails the organiser kindly without it", async () => {
    news.decideUpdate.mockResolvedValue(row({ status: "rejected", rejectReason: "A poster" }));
    const res = await staff(tokenFor("editor"), "POST", "/api/admin/fundraisers/9/news/31/reject", { reason: "  A poster  " });
    expect(res.status).toBe(200);
    expect(news.decideUpdate).toHaveBeenCalledWith(9, 31, "reject", `admin:${STAFF}`, "A poster");
    expect(send.sendNewsDecisionEmail).toHaveBeenCalledWith(expect.objectContaining({ id: 9 }), false, true);
    const long = await staff(tokenFor("editor"), "POST", "/api/admin/fundraisers/9/news/31/reject", { reason: "x".repeat(501) });
    expect(long.status).toBe(400);
  });

  it("hides one and shows it again without emailing anyone", async () => {
    news.decideUpdate.mockResolvedValue(row({ status: "hidden" }));
    expect((await staff(tokenFor("editor"), "POST", "/api/admin/fundraisers/9/news/31/hide")).status).toBe(200);
    news.decideUpdate.mockResolvedValue(row({ status: "approved" }));
    expect((await staff(tokenFor("editor"), "POST", "/api/admin/fundraisers/9/news/31/show")).status).toBe(200);
    expect(news.decideUpdate.mock.calls.map((c) => c[2])).toEqual(["hide", "show"]);
    expect(send.sendNewsDecisionEmail).not.toHaveBeenCalled();
  });

  it("answers plainly when it was already decided, or is not there", async () => {
    const { NewsError } = (await import("../../src/db/fundraiser-updates")) as unknown as { NewsError: new (r: string) => Error };
    news.decideUpdate.mockRejectedValue(new NewsError("not_waiting"));
    let res = await staff(tokenFor("editor"), "POST", "/api/admin/fundraisers/9/news/31/approve");
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("That update has already been dealt with. Look again.");
    news.decideUpdate.mockRejectedValue(new NewsError("not_found"));
    res = await staff(tokenFor("editor"), "POST", "/api/admin/fundraisers/9/news/31/approve");
    expect(res.status).toBe(404);
    expect((await staff(tokenFor("editor"), "POST", "/api/admin/fundraisers/9/news/abc/approve")).status).toBe(400);
    expect(send.sendNewsDecisionEmail).not.toHaveBeenCalled();
  });

  it("keeps the decision when the email cannot go", async () => {
    news.decideUpdate.mockResolvedValue(row({ status: "approved" }));
    send.sendNewsDecisionEmail.mockRejectedValue(new Error("SES is down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await staff(tokenFor("editor"), "POST", "/api/admin/fundraisers/9/news/31/approve")).status).toBe(200);
    err.mockRestore();
  });
});

describe("how the app mounts it", () => {
  // Read from the source: the app itself needs a whole environment to start.
  const app = readFileSync(resolve(__dirname, "../../src/app.ts"), "utf8");
  const at = (s: string) => app.indexOf(s);

  it("reads the post's bigger body only on its own path, behind the session guard, before the usual parser", () => {
    expect(at("app.use(NEWS_POST_PATH, newsBodyGuard, express.json({ limit: NEWS_JSON_BODY_LIMIT }));")).toBeGreaterThan(-1);
    expect(at("app.use(NEWS_POST_PATH")).toBeLessThan(at("app.use(express.json());"));
  });

  it("comes before the private area's router, whose retired link route would read news as a link", () => {
    expect(at("app.use(fundraiserNewsRouter);")).toBeGreaterThan(-1);
    expect(at("app.use(fundraiserNewsRouter);")).toBeLessThan(at("app.use(fundraiseRouter);"));
  });
});
