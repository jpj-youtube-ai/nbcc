import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-501: the fundraising private area's API. The database, the emails and Stripe are mocked;
// what is checked is what each endpoint lets through: the same answer whether or not an email is
// signed up, the code's limits, the session cookie, and that an organiser sees and changes only
// their own fundraisers. Every name and address here is invented.

const db = vi.hoisted(() => ({
  fundraisingIsOn: vi.fn(),
  listForOrganiser: vi.fn(),
  getFundraiser: vi.fn(),
  requestEdit: vi.fn(),
  markFinishedRequested: vi.fn(),
  waitingEditFor: vi.fn(),
  wallRows: vi.fn(),
  createFundraiser: vi.fn(),
  getBySlug: vi.fn(),
  listApprovedPublic: vi.fn(),
}));
const signIn = vi.hoisted(() => ({
  saveSignInCode: vi.fn(),
  countCodeTry: vi.fn(),
  deleteSignInCode: vi.fn(),
  createSession: vi.fn(),
  findSession: vi.fn(),
  deleteSession: vi.fn(),
}));
const send = vi.hoisted(() => ({
  sendSignUpEmails: vi.fn(),
  sendSignInCodeEmail: vi.fn(),
  sendFinishedStaffEmail: vi.fn(),
  fundraiserPageUrl: (slug: string) => `https://nbcc.test/fundraise/${slug}`,
  eventPageUrl: (slug: string) => `https://nbcc.test/event/${slug}`,
  manageUrl: () => "https://nbcc.test/fundraise/manage",
}));
const stripeMock = vi.hoisted(() => ({ create: vi.fn() }));
// TASK-505: the requests staff have acted on, read for one fundraiser at a time.
const requestsDb = vi.hoisted(() => ({ listRequestRowsFor: vi.fn() }));

vi.mock("../../src/db/fundraisers", async () => {
  class FundraiserError extends Error {
    constructor(public readonly reason: string) {
      super(reason);
    }
  }
  return { ...db, FundraiserError };
});
vi.mock("../../src/db/fundraiser-sign-in", () => signIn);
vi.mock("../../src/db/fundraising-requests", () => requestsDb);
// TASK-512: the organiser's last asks to print, read back from the audit log.
vi.mock("../../src/db/fundraiser-materials", () => ({ lastPrintAsks: vi.fn(async () => []), materialScans: vi.fn(), askToPrint: vi.fn(), PrintAskError: Error }));
vi.mock("../../src/fundraising/send", () => send);
vi.mock("../../src/newsletter/self-signup", () => ({ subscribeSelf: vi.fn() }));
vi.mock("../../src/clients/turnstile", () => ({ captchaEnabled: () => false, captchaSiteKey: () => null, verifyCaptcha: vi.fn() }));
vi.mock("../../src/clients/stripe", () => ({ stripe: { checkout: { sessions: { create: stripeMock.create } } }, stripeConfigured: true }));
vi.mock("../../src/db/ball", () => ({ getCardFeeRate: vi.fn(async () => ({ percent: 1.5, fixedPence: 20 })) }));
vi.mock("../../src/config", () => ({
  config: {
    NODE_ENV: "production",
    PORTAL_BASE_URL: "https://nbcc.test",
    ADMIN_SESSION_SECRET: "a-test-secret",
    STRIPE_SUCCESS_URL: "https://nbcc.test/donate/thank-you",
    STRIPE_CANCEL_URL: "https://nbcc.test/donate",
    STRIPE_PUBLISHABLE_KEY: "",
    DATABASE_URL: "postgres://localhost:5432/test",
  },
}));

import {
  postManageRequest,
  postManageSignIn,
  getManageSession,
  postManageEdit,
  postManageFinished,
  postManagePayIn,
  postManageSignOut,
  retiredManageLink,
  MANAGE_REQUEST_MESSAGE,
  WRONG_CODE_MESSAGE,
} from "../../src/routes/fundraise";
import { hashSignInCode, hashSessionId, SESSION_COOKIE } from "../../src/fundraising/sign-in";
import { meter, type FundraiserRecord } from "../../src/fundraising/model";

type Cookie = { name: string; value: string; options: Record<string, unknown> };
type MockRes = {
  statusCode: number;
  body: unknown;
  cookies: Cookie[];
  cleared: Array<{ name: string; options: Record<string, unknown> }>;
  headers: Record<string, string>;
  status: (c: number) => MockRes;
  setHeader: (name: string, value: string) => MockRes;
  json: (b: unknown) => MockRes;
  cookie: (name: string, value: string, options: Record<string, unknown>) => MockRes;
  clearCookie: (name: string, options: Record<string, unknown>) => MockRes;
};
function mockRes(): MockRes {
  const res = { statusCode: 200, body: undefined as unknown, cookies: [], cleared: [], headers: {} } as unknown as MockRes;
  res.setHeader = (name, value) => ((res.headers[name.toLowerCase()] = value), res);
  res.status = (c) => ((res.statusCode = c), res);
  res.json = (b) => ((res.body = b), res);
  res.cookie = (name, value, options) => (res.cookies.push({ name, value, options }), res);
  res.clearCookie = (name, options) => (res.cleared.push({ name, options }), res);
  return res;
}

let ipSeq = 0;
type Opts = { body?: unknown; params?: Record<string, string>; ip?: string; cookie?: string; headers?: Record<string, string> };
/* eslint-disable @typescript-eslint/no-explicit-any */
async function run(handler: (req: any, res: any) => unknown, o: Opts = {}) {
  const res = mockRes();
  const headers: Record<string, string> = { host: "nbcc.test", ...(o.cookie ? { cookie: o.cookie } : {}), ...(o.headers ?? {}) };
  await handler({ body: o.body ?? {}, params: o.params ?? {}, ip: o.ip ?? `10.1.0.${++ipSeq}`, headers }, res);
  return res;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const record = (over: Partial<FundraiserRecord> = {}): FundraiserRecord & { meter: ReturnType<typeof meter>; editWaiting: boolean } =>
  ({
    id: 9,
    slug: "sams-walk",
    path: "raising",
    kind: "run_walk",
    title: "Sam's Walk",
    description: "Ten miles.",
    eventDate: null,
    startTime: null,
    endTime: null,
    venue: "",
    town: "Exampleton",
    targetPence: 25000,
    public: true,
    status: "approved",
    name: "Sam Sample",
    email: "sam@example.com",
    phone: "07700 900456",
    socialLink: null,
    socialOk: false,
    cardLine: null,
    booking: null,
    ticketUrl: null,
    access: [],
    finishedRequestedAt: null,
    meter: meter({ onlinePence: 5000, cashPence: 1000, targetPence: 25000 }),
    editWaiting: false,
    ...over,
  }) as FundraiserRecord & { meter: ReturnType<typeof meter>; editWaiting: boolean };

const SESSION_ID = "an-invented-session-id-that-is-long-enough-123";
const SAM = `${SESSION_COOKIE}=${SESSION_ID}`;

beforeEach(() => {
  for (const fn of [...Object.values(db), ...Object.values(signIn), stripeMock.create]) fn.mockReset();
  send.sendSignInCodeEmail.mockReset();
  send.sendFinishedStaffEmail.mockReset();
  db.fundraisingIsOn.mockResolvedValue(true);
  db.waitingEditFor.mockResolvedValue(null);
  db.wallRows.mockResolvedValue([]);
  requestsDb.listRequestRowsFor.mockReset().mockResolvedValue([]);
  signIn.findSession.mockImplementation(async (hash: string) =>
    hash === hashSessionId(SESSION_ID) ? { email: "sam@example.com", expiresAt: new Date(Date.now() + 3600_000) } : null,
  );
});

describe("asking for a sign in code", () => {
  it("emails a code to an approved organiser, storing only its keyed hash", async () => {
    db.listForOrganiser.mockResolvedValue([record(), record({ id: 10, name: "Sam Other" })]);
    const res = await run(postManageRequest, { body: { email: "Sam@Example.com" } });
    expect(res.body).toEqual({ message: MANAGE_REQUEST_MESSAGE });
    expect(send.sendSignInCodeEmail).toHaveBeenCalledTimes(1);
    const [to, name, code] = send.sendSignInCodeEmail.mock.calls[0];
    expect(to).toBe("sam@example.com");
    expect(name).toBe("Sam Sample");
    expect(code).toMatch(/^\d{6}$/);
    const [email, hash, expires] = signIn.saveSignInCode.mock.calls[0];
    expect(email).toBe("sam@example.com");
    expect(hash).toBe(hashSignInCode("sam@example.com", code, "a-test-secret"));
    expect(hash).not.toContain(code);
    expect((expires as Date).getTime() - Date.now()).toBeGreaterThan(9 * 60_000);
    expect((expires as Date).getTime() - Date.now()).toBeLessThanOrEqual(10 * 60_000);
  });

  it("gives exactly the same answer for an email nobody signed up with, and sends nothing", async () => {
    db.listForOrganiser.mockResolvedValue([]);
    const known = await run(postManageRequest, { body: { email: "nobody@example.com" } });
    expect(known.statusCode).toBe(200);
    expect(known.body).toEqual({ message: MANAGE_REQUEST_MESSAGE });
    expect(signIn.saveSignInCode).not.toHaveBeenCalled();
    expect(send.sendSignInCodeEmail).not.toHaveBeenCalled();
  });

  it("says the same while fundraising is off, and sends nothing", async () => {
    db.fundraisingIsOn.mockResolvedValue(false);
    db.listForOrganiser.mockResolvedValue([record()]);
    const res = await run(postManageRequest, { body: { email: "sam@example.com" } });
    expect(res.body).toEqual({ message: MANAGE_REQUEST_MESSAGE });
    expect(send.sendSignInCodeEmail).not.toHaveBeenCalled();
  });

  it("says the same over the limit for one email, without looking", async () => {
    db.listForOrganiser.mockResolvedValue([]);
    for (let i = 0; i < 3; i++) await run(postManageRequest, { body: { email: "limit.request@example.com" } });
    db.listForOrganiser.mockClear();
    const res = await run(postManageRequest, { body: { email: "limit.request@example.com" } });
    expect(res.body).toEqual({ message: MANAGE_REQUEST_MESSAGE });
    expect(db.listForOrganiser).not.toHaveBeenCalled();
  });

  it("says the same over the limit for one address, without looking", async () => {
    db.listForOrganiser.mockResolvedValue([]);
    for (let i = 0; i < 20; i++) await run(postManageRequest, { body: { email: `ip${i}@example.com` }, ip: "10.9.9.1" });
    db.listForOrganiser.mockClear();
    const res = await run(postManageRequest, { body: { email: "fresh@example.com" }, ip: "10.9.9.1" });
    expect(res.body).toEqual({ message: MANAGE_REQUEST_MESSAGE });
    expect(db.listForOrganiser).not.toHaveBeenCalled();
  });

  it("refuses something that is not an email address", async () => {
    expect((await run(postManageRequest, { body: { email: "nope" } })).statusCode).toBe(400);
  });

  it("is refused from another website's page", async () => {
    const res = await run(postManageRequest, { body: { email: "sam@example.com" }, headers: { "sec-fetch-site": "cross-site" } });
    expect(res.statusCode).toBe(403);
    expect(db.listForOrganiser).not.toHaveBeenCalled();
  });

  it("never logs the code", async () => {
    db.listForOrganiser.mockResolvedValue([record()]);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    send.sendSignInCodeEmail.mockRejectedValueOnce(new Error("SES is down"));
    await run(postManageRequest, { body: { email: "sam.log@example.com" } });
    const code = send.sendSignInCodeEmail.mock.calls[0][2] as string;
    const logged = [...log.mock.calls, ...err.mock.calls].flat().map(String).join(" ");
    expect(logged).not.toContain(code);
    log.mockRestore();
    err.mockRestore();
  });
});

describe("signing in with the code", () => {
  const codeRow = (code: string, over: Partial<{ attempts: number; expiresAt: Date }> = {}) => ({
    codeHash: hashSignInCode("sam@example.com", code, "a-test-secret"),
    expiresAt: new Date(Date.now() + 5 * 60_000),
    attempts: 1,
    ...over,
  });

  it("starts a fresh session on the right code: a random id in an http only, Secure, SameSite Lax cookie", async () => {
    signIn.countCodeTry.mockResolvedValue(codeRow("482915"));
    db.listForOrganiser.mockResolvedValue([record()]);
    const res = await run(postManageSignIn, { body: { email: "Sam@Example.com", code: "482 915" } });
    expect(res.statusCode).toBe(200);
    expect(res.cookies).toHaveLength(1);
    const c = res.cookies[0];
    expect(c.name).toBe(SESSION_COOKIE);
    expect(c.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(c.options).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax", path: "/api/fundraise/manage", maxAge: 2 * 60 * 60 * 1000 });
    const [hash, email, expires] = signIn.createSession.mock.calls[0];
    expect(hash).toBe(hashSessionId(c.value));
    expect(email).toBe("sam@example.com");
    expect((expires as Date).getTime() - Date.now()).toBeGreaterThan(119 * 60_000);
    expect(signIn.deleteSignInCode).toHaveBeenCalledWith("sam@example.com");
    expect(JSON.stringify(res.body)).not.toContain(c.value);
  });

  it("never keeps a session the browser already had: signing in ends it and makes a new one", async () => {
    signIn.countCodeTry.mockResolvedValue(codeRow("482915"));
    db.listForOrganiser.mockResolvedValue([record()]);
    const res = await run(postManageSignIn, { body: { email: "sam@example.com", code: "482915" }, cookie: `${SESSION_COOKIE}=planted-by-someone-else` });
    expect(signIn.deleteSession).toHaveBeenCalledWith(hashSessionId("planted-by-someone-else"));
    expect(res.cookies[0].value).not.toBe("planted-by-someone-else");
  });

  it("answers a wrong code, no code, an expired code and a dead code all the same way", async () => {
    const answers: unknown[] = [];
    for (const row of [codeRow("111111"), null, codeRow("482915", { expiresAt: new Date(Date.now() - 1) }), codeRow("482915", { attempts: 6 })]) {
      signIn.countCodeTry.mockResolvedValueOnce(row);
      const res = await run(postManageSignIn, { body: { email: "sam@example.com", code: "482915" } });
      expect(res.statusCode).toBe(401);
      expect(res.cookies).toHaveLength(0);
      answers.push(res.body);
    }
    expect(new Set(answers.map((a) => JSON.stringify(a))).size).toBe(1);
    expect(answers[0]).toEqual({ error: WRONG_CODE_MESSAGE });
    expect(signIn.createSession).not.toHaveBeenCalled();
  });

  it("kills a code once its five tries are used", async () => {
    signIn.countCodeTry.mockResolvedValueOnce(codeRow("482915", { attempts: 6 }));
    await run(postManageSignIn, { body: { email: "sam@example.com", code: "482915" } });
    expect(signIn.deleteSignInCode).toHaveBeenCalledWith("sam@example.com");
  });

  it("lets nobody in whose fundraisers are no longer approved", async () => {
    signIn.countCodeTry.mockResolvedValue(codeRow("482915"));
    db.listForOrganiser.mockResolvedValue([]);
    const res = await run(postManageSignIn, { body: { email: "sam@example.com", code: "482915" } });
    expect(res.statusCode).toBe(401);
    expect(signIn.createSession).not.toHaveBeenCalled();
  });

  it("refuses a code that is not six digits without counting a try", async () => {
    const res = await run(postManageSignIn, { body: { email: "sam@example.com", code: "12ab" } });
    expect(res.statusCode).toBe(400);
    expect(signIn.countCodeTry).not.toHaveBeenCalled();
  });

  it("limits tries for one email, whatever the address they come from", async () => {
    signIn.countCodeTry.mockResolvedValue(codeRow("111111"));
    for (let i = 0; i < 10; i++) await run(postManageSignIn, { body: { email: "limit.signin@example.com", code: "000000" } });
    signIn.countCodeTry.mockClear();
    const res = await run(postManageSignIn, { body: { email: "limit.signin@example.com", code: "000000" } });
    expect(res.statusCode).toBe(429);
    expect(signIn.countCodeTry).not.toHaveBeenCalled();
  });

  it("limits tries from one address, whatever the email", async () => {
    signIn.countCodeTry.mockResolvedValue(null);
    for (let i = 0; i < 30; i++) await run(postManageSignIn, { body: { email: `t${i}@example.com`, code: "000000" }, ip: "10.9.9.2" });
    const res = await run(postManageSignIn, { body: { email: "another@example.com", code: "000000" }, ip: "10.9.9.2" });
    expect(res.statusCode).toBe(429);
  });

  it("is a 404 while fundraising is off", async () => {
    db.fundraisingIsOn.mockResolvedValue(false);
    expect((await run(postManageSignIn, { body: { email: "sam@example.com", code: "482915" } })).statusCode).toBe(404);
  });

  it("is refused from another website's page", async () => {
    const res = await run(postManageSignIn, { body: { email: "sam@example.com", code: "482915" }, headers: { origin: "https://evil.example" } });
    expect(res.statusCode).toBe(403);
  });
});

describe("the private area", () => {
  it("needs a session", async () => {
    expect((await run(getManageSession)).statusCode).toBe(401);
    expect((await run(getManageSession, { cookie: `${SESSION_COOKIE}=not-a-session` })).statusCode).toBe(401);
  });

  it("lists every fundraiser of the signed in organiser's, and only theirs", async () => {
    db.listForOrganiser.mockResolvedValue([record(), record({ id: 10, slug: "sams-swim", title: "Sam's Swim", public: false })]);
    const res = await run(getManageSession, { cookie: SAM });
    expect(res.statusCode).toBe(200);
    expect(db.listForOrganiser).toHaveBeenCalledWith("sam@example.com");
    const body = res.body as { fundraisers: Array<Record<string, unknown>> };
    expect(body.fundraisers.map((f) => f.id)).toEqual([9, 10]);
    // Private: never kept by a browser or anything in between.
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(body.fundraisers[0]).toMatchObject({
      title: "Sam's Walk",
      status: "approved",
      pageUrl: "https://nbcc.test/fundraise/sams-walk",
      qrUrl: "/fundraise/sams-walk/qr.svg",
    });
    // A private one has no page, so no page link and no QR code.
    expect(body.fundraisers[1]).toMatchObject({ pageUrl: null, qrUrl: null });
  });

  // Event pages: an approved public event's page, and its QR codes, are at /event/<short name>.
  it("gives an event its own page and QR codes, at /event/", async () => {
    db.listForOrganiser.mockResolvedValue([record({ path: "event", slug: "sqn", title: "Sam's Quiz Night" })]);
    const f = ((await run(getManageSession, { cookie: SAM })).body as { fundraisers: Array<Record<string, unknown>> }).fundraisers[0];
    expect(f).toMatchObject({ pageUrl: "https://nbcc.test/event/sqn", qrUrl: "/event/sqn/qr.svg" });
    expect((f.materials as Record<string, unknown>).qrPng).toBe("/event/sqn/qr.png");
  });

  // Event clarity review: whether it shares with another cause, for the pay in box's words.
  it("says whether each one shares what it raises with another cause", async () => {
    db.listForOrganiser.mockResolvedValue([
      record({ path: "event", slug: "sqn", sharesWithOther: true, nbccSharePercent: 60, otherCauseName: "The Exampleton Larder" }),
      record({ id: 10, slug: "sams-swim" }),
    ]);
    const [shared, plain] = ((await run(getManageSession, { cookie: SAM })).body as { fundraisers: Array<Record<string, unknown>> }).fundraisers;
    expect(shared.sharesWithOther).toBe(true);
    expect(plain.sharesWithOther).toBe(false);
  });

  // TASK-511 review: a sign up made since the form's second round changes Instagram and Facebook,
  // each in a box of its own; one from before keeps its one link box.
  it("says which link boxes each fundraiser's form has, and gives both links to change", async () => {
    db.listForOrganiser.mockResolvedValue([
      record({ firstName: "Sam", lastName: "Sample", instagram: "https://www.instagram.com/sam", facebook: null }),
      record({ id: 10, slug: "sams-swim", socialLink: "https://www.facebook.com/old" }),
    ]);
    const res = await run(getManageSession, { cookie: SAM });
    const [roundTwo, before] = (res.body as { fundraisers: Array<Record<string, unknown> & { editable: Record<string, unknown> }> }).fundraisers;
    expect(roundTwo.linkBoxes).toBe("two");
    expect(roundTwo.editable).toMatchObject({ instagram: "https://www.instagram.com/sam", facebook: null });
    expect(before.linkBoxes).toBe("one");
    expect(before.editable).toMatchObject({ socialLink: "https://www.facebook.com/old", instagram: null, facebook: null });
  });

  it("shows the latest gifts and messages as the wall does, and never a giver's email or full name", async () => {
    db.listForOrganiser.mockResolvedValue([record()]);
    db.wallRows.mockResolvedValue([
      { donationId: 1, fullName: "Alex Example", anonymous: false, showName: true, showAmount: true, amountPence: 2500,
        refundedPence: 0, message: "Go Sam", hidden: false, createdAt: "2026-10-02T12:00:00.000Z" },
      { donationId: 2, fullName: "Hidden Giver", anonymous: true, showName: true, showAmount: false, amountPence: 4000,
        refundedPence: 0, message: "rude", hidden: true, createdAt: "2026-10-02T13:00:00.000Z" },
    ]);
    const res = await run(getManageSession, { cookie: SAM });
    const gifts = (res.body as { fundraisers: Array<{ gifts: unknown[] }> }).fundraisers[0].gifts;
    expect(gifts).toEqual([
      { name: "Anonymous", amountPence: null, giftAidPence: null, message: null, createdAt: "2026-10-02T13:00:00.000Z" },
      { name: "Alex E.", amountPence: 2500, giftAidPence: null, message: "Go Sam", createdAt: "2026-10-02T12:00:00.000Z" },
    ]);
    const all = JSON.stringify(res.body);
    expect(all).not.toContain("Alex Example");
    expect(all).not.toContain("Hidden Giver");
    expect(all).not.toMatch(/@example\.com/);
  });

  it("is a 404 while fundraising is off", async () => {
    db.fundraisingIsOn.mockResolvedValue(false);
    expect((await run(getManageSession, { cookie: SAM })).statusCode).toBe(404);
  });

  // TASK-505: where each thing they asked for is up to, in words, read only.
  it("says where each thing they asked for is up to, and never a staff note or name", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-12-07T10:00:00Z"));
    try {
      db.listForOrganiser.mockResolvedValue([
        record({
          eventDate: "2026-12-12",
          socialOk: true,
          wants: { posterCount: 10, leafletCount: 0, bucketCount: 2, tinCount: 0, leaflets: 0, buckets: 0, shoutOut: true, attend: false },
        }),
      ]);
      const base = { quantityBack: null, backOn: null, doneOn: null, going: null, backNote: null, link: null, updatedAt: null, updatedBy: "admin:fern@example.com" };
      requestsDb.listRequestRowsFor.mockResolvedValue([
        { ...base, fundraiserId: 9, kind: "posters", status: "sent", quantity: 10, how: "post", sentOn: "2026-12-03", handledBy: "Fern Staff", note: "Kept two back" },
        { ...base, fundraiserId: 9, kind: "buckets", status: "with_them", quantity: 2, how: null, sentOn: "2026-12-05", handledBy: "Fern Staff", note: null },
      ]);
      const res = await run(getManageSession, { cookie: SAM });
      expect(res.statusCode).toBe(200);
      expect(requestsDb.listRequestRowsFor).toHaveBeenCalledWith(9);
      expect((res.body as { fundraisers: Array<{ requests: unknown }> }).fundraisers[0].requests).toEqual([
        { label: "Posters", words: "sent on 3 Dec" },
        { label: "Collection buckets", words: "with you, please bring them back by 26 Dec" },
        { label: "Social media shout out", words: "coming soon" },
      ]);
      const all = JSON.stringify(res.body);
      expect(all).not.toContain("Fern");
      expect(all).not.toContain("Kept two back");
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves out a request still at its first step on a finished fundraiser (made before requests were tracked)", async () => {
    db.listForOrganiser.mockResolvedValue([
      record({
        status: "finished",
        wants: { posterCount: 10, leafletCount: 0, bucketCount: 0, tinCount: 0, leaflets: 0, buckets: 0, shoutOut: false, attend: false },
      }),
    ]);
    const res = await run(getManageSession, { cookie: SAM });
    expect((res.body as { fundraisers: Array<{ requests: unknown }> }).fundraisers[0].requests).toEqual([]);
  });

  it("gives an empty list when they asked for nothing", async () => {
    db.listForOrganiser.mockResolvedValue([record()]);
    const res = await run(getManageSession, { cookie: SAM });
    expect((res.body as { fundraisers: Array<{ requests: unknown }> }).fundraisers[0].requests).toEqual([]);
  });

  it("still opens, without the requests, when they cannot be read", async () => {
    db.listForOrganiser.mockResolvedValue([record()]);
    requestsDb.listRequestRowsFor.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await run(getManageSession, { cookie: SAM });
    expect(res.statusCode).toBe(200);
    expect((res.body as { fundraisers: Array<{ requests: unknown }> }).fundraisers[0].requests).toBeNull();
  });
});

describe("two organisers", () => {
  // Kim is signed in; fundraiser 9 is Sam's.
  const KIM_ID = "kims-invented-session-id-also-long-enough-456";
  const KIM = `${SESSION_COOKIE}=${KIM_ID}`;
  beforeEach(() => {
    signIn.findSession.mockImplementation(async (hash: string) =>
      hash === hashSessionId(KIM_ID) ? { email: "kim@example.com", expiresAt: new Date(Date.now() + 3600_000) } : null,
    );
    db.getFundraiser.mockResolvedValue(record());
  });

  it("cannot change someone else's fundraiser", async () => {
    const res = await run(postManageEdit, { cookie: KIM, params: { id: "9" }, body: { description: "Mine now" } });
    expect(res.statusCode).toBe(404);
    expect(db.requestEdit).not.toHaveBeenCalled();
  });

  it("cannot say someone else's has finished", async () => {
    const res = await run(postManageFinished, { cookie: KIM, params: { id: "9" } });
    expect(res.statusCode).toBe(404);
    expect(db.markFinishedRequested).not.toHaveBeenCalled();
  });

  it("cannot pay in to someone else's", async () => {
    const res = await run(postManagePayIn, { cookie: KIM, params: { id: "9" }, body: { amountPence: 500 } });
    expect(res.statusCode).toBe(404);
    expect(stripeMock.create).not.toHaveBeenCalled();
  });

  it("sees only their own in the list", async () => {
    db.listForOrganiser.mockResolvedValue([record({ id: 11, email: "kim@example.com", title: "Kim's Quiz" })]);
    const res = await run(getManageSession, { cookie: KIM });
    expect(db.listForOrganiser).toHaveBeenCalledWith("kim@example.com");
    expect((res.body as { fundraisers: Array<{ id: number }> }).fundraisers.map((f) => f.id)).toEqual([11]);
    // TASK-505: and only their own requests.
    expect(requestsDb.listRequestRowsFor.mock.calls).toEqual([[11]]);
  });
});

describe("asking for a change", () => {
  beforeEach(() => db.getFundraiser.mockResolvedValue(record()));

  it("sends it to wait for staff", async () => {
    db.requestEdit.mockResolvedValue({ id: 3, changes: { targetPence: 30000 }, status: "waiting", createdAt: "2026-10-02T12:00:00.000Z" });
    const res = await run(postManageEdit, { cookie: SAM, params: { id: "9" }, body: { targetPence: 30000 } });
    expect(res.statusCode).toBe(202);
    expect(db.requestEdit).toHaveBeenCalledWith(9, { targetPence: 30000 }, "sam@example.com");
  });

  it("checks the change as it would land: a finish before the start held for it is refused", async () => {
    db.getFundraiser.mockResolvedValue(record({ path: "event", startTime: "19:00", endTime: "22:00", cardLine: "Hi", booking: "door", venue: "Hall", eventDate: "2099-01-01" }));
    const res = await run(postManageEdit, { cookie: SAM, params: { id: "9" }, body: { endTime: "18:00" } });
    expect(res.statusCode).toBe(400);
    expect((res.body as { fields: Record<string, string> }).fields).toEqual({ endTime: "The finish time is before the start." });
    expect(db.requestEdit).not.toHaveBeenCalled();
  });

  it("refuses a change to anything an organiser may not change", async () => {
    const res = await run(postManageEdit, { cookie: SAM, params: { id: "9" }, body: { title: "Something else" } });
    expect(res.statusCode).toBe(400);
    expect(db.requestEdit).not.toHaveBeenCalled();
  });

  // Jaimie, 2026-10-03: the split with another cause is never theirs to change once approved; only
  // staff correct it, and only before the first gift.
  it("never takes a change to the split with another cause", async () => {
    for (const body of [{ sharesWithOther: false }, { nbccSharePercent: 90 }, { otherCauseName: "Another Cause" }, { description: "x", nbccSharePercent: 90 }]) {
      const res = await run(postManageEdit, { cookie: SAM, params: { id: "9" }, body });
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
    }
    expect(db.requestEdit).not.toHaveBeenCalled();
  });

  it("needs a session, and our own page", async () => {
    expect((await run(postManageEdit, { params: { id: "9" }, body: { description: "x" } })).statusCode).toBe(401);
    const cross = await run(postManageEdit, { cookie: SAM, params: { id: "9" }, body: { description: "x" }, headers: { "sec-fetch-site": "cross-site" } });
    expect(cross.statusCode).toBe(403);
    expect(db.requestEdit).not.toHaveBeenCalled();
  });

  it("is a 410 for one no longer running", async () => {
    db.getFundraiser.mockResolvedValue(record({ status: "finished" }));
    expect((await run(postManageEdit, { cookie: SAM, params: { id: "9" }, body: { description: "x" } })).statusCode).toBe(410);
  });
});

describe("I've finished", () => {
  beforeEach(() => db.getFundraiser.mockResolvedValue(record()));

  it("records it, tells staff once, and says thank you", async () => {
    db.markFinishedRequested.mockResolvedValue({ record: record({ finishedRequestedAt: "2026-10-02T12:00:00.000Z" }), first: true });
    const res = await run(postManageFinished, { cookie: SAM, params: { id: "9" } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ status: "thanks", finishedRequestedAt: "2026-10-02T12:00:00.000Z" });
    expect(db.markFinishedRequested).toHaveBeenCalledWith(9, "sam@example.com");
    expect(send.sendFinishedStaffEmail).toHaveBeenCalledTimes(1);
    expect(send.sendFinishedStaffEmail.mock.calls[0][1]).toBe(6000);
  });

  it("does not tell staff twice", async () => {
    db.markFinishedRequested.mockResolvedValue({ record: record({ finishedRequestedAt: "2026-10-01T12:00:00.000Z" }), first: false });
    await run(postManageFinished, { cookie: SAM, params: { id: "9" } });
    expect(send.sendFinishedStaffEmail).not.toHaveBeenCalled();
  });
});

describe("paying in", () => {
  beforeEach(() => {
    db.getFundraiser.mockResolvedValue(record());
    stripeMock.create.mockResolvedValue({ id: "cs_test_pay_in", url: "https://checkout.stripe.com/c/pay/test_pay_in" });
  });

  it("opens a checkout for their own fundraiser, marked as paid in, with no Gift Aid even if asked", async () => {
    const res = await run(postManagePayIn, { cookie: SAM, params: { id: "9" }, body: { amountPence: 12550, giftAid: true } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ url: "https://checkout.stripe.com/c/pay/test_pay_in" });
    const params = stripeMock.create.mock.calls[0][0];
    expect(params.metadata).toMatchObject({ fundraiserId: "9", paidInByOrganiser: "true", giftAid: "false", email: "sam@example.com" });
    expect(params.success_url).toBe("https://nbcc.test/fundraise/manage?paid=1");
  });

  it("refuses less than £1 or more than £10,000", async () => {
    expect((await run(postManagePayIn, { cookie: SAM, params: { id: "9" }, body: { amountPence: 50 } })).statusCode).toBe(400);
    expect((await run(postManagePayIn, { cookie: SAM, params: { id: "9" }, body: { amountPence: 1_000_001 } })).statusCode).toBe(400);
    expect(stripeMock.create).not.toHaveBeenCalled();
  });

  it("says so when Stripe cannot be reached", async () => {
    stripeMock.create.mockRejectedValueOnce(new Error("stripe down"));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await run(postManagePayIn, { cookie: SAM, params: { id: "9" }, body: { amountPence: 500 } })).statusCode).toBe(502);
    quiet.mockRestore();
  });
});

describe("signing out", () => {
  it("ends the session and clears the cookie", async () => {
    const res = await run(postManageSignOut, { cookie: SAM });
    expect(res.statusCode).toBe(200);
    expect(signIn.deleteSession).toHaveBeenCalledWith(hashSessionId(SESSION_ID));
    expect(res.cleared).toEqual([{ name: SESSION_COOKIE, options: expect.objectContaining({ path: "/api/fundraise/manage", httpOnly: true }) }]);
  });

  it("answers the same with no session", async () => {
    expect((await run(postManageSignOut)).statusCode).toBe(200);
  });
});

describe("the 24 hour links", () => {
  it("are no longer used: any link says so, and points to the code", async () => {
    const res = await run(retiredManageLink, { params: { token: "an-old-link-token" } });
    expect(res.statusCode).toBe(410);
    expect((res.body as { error: string }).error).toMatch(/sign in code/i);
  });
});

// ---- TASK-501 review fixes ----

// Jaimie's decision: finishing a fundraiser never locks its organiser out. They can still sign in,
// see it, its gifts and QR code, and pay in late money; only changes stop.
describe("a finished fundraiser", () => {
  const finished = (over: Partial<FundraiserRecord> = {}) => record({ status: "finished", ...over });

  it("can still be signed in to", async () => {
    db.listForOrganiser.mockResolvedValue([finished()]);
    await run(postManageRequest, { body: { email: "finished.request@example.com" } });
    expect(send.sendSignInCodeEmail).toHaveBeenCalledTimes(1);
  });

  it("is listed as finished, with its gifts and its QR code", async () => {
    db.listForOrganiser.mockResolvedValue([finished()]);
    db.wallRows.mockResolvedValue([
      { donationId: 1, fullName: "Alex Example", anonymous: false, showName: true, showAmount: true, amountPence: 2500,
        refundedPence: 0, message: "Go Sam", hidden: false, createdAt: "2026-10-02T12:00:00.000Z" },
    ]);
    const res = await run(getManageSession, { cookie: SAM });
    const f = (res.body as { fundraisers: Array<Record<string, unknown>> }).fundraisers[0];
    expect(f.status).toBe("finished");
    expect(f.qrUrl).toBe("/fundraise/sams-walk/qr.svg");
    expect((f.gifts as unknown[]).length).toBe(1);
  });

  it("takes no more changes, and says to get in touch", async () => {
    db.getFundraiser.mockResolvedValue(finished());
    const res = await run(postManageEdit, { cookie: SAM, params: { id: "9" }, body: { description: "x" } });
    expect(res.statusCode).toBe(410);
    expect(res.body).toEqual({ error: "Your fundraiser is finished. To change anything, get in touch." });
    expect(db.requestEdit).not.toHaveBeenCalled();
  });

  it("can still pay in what was collected", async () => {
    db.getFundraiser.mockResolvedValue(finished());
    stripeMock.create.mockResolvedValue({ id: "cs_test_late", url: "https://checkout.stripe.com/c/pay/late" });
    const res = await run(postManagePayIn, { cookie: SAM, params: { id: "9" }, body: { amountPence: 500 } });
    expect(res.statusCode).toBe(200);
    expect(stripeMock.create.mock.calls[0][0].metadata).toMatchObject({ fundraiserId: "9", paidInByOrganiser: "true" });
  });

  it.each(["new", "declined"] as const)("is not reachable while %s", async (status) => {
    db.getFundraiser.mockResolvedValue(record({ status }));
    const pay = await run(postManagePayIn, { cookie: SAM, params: { id: "9" }, body: { amountPence: 500 } });
    expect(pay.statusCode).toBe(410);
    expect(stripeMock.create).not.toHaveBeenCalled();
  });
});

// The BDD suite drives the app over http://localhost from one address, so loopback is exempt from
// these limits exactly as admin login is (behind the ALB req.ip is always the real client address).
describe("the limits, for the box itself", () => {
  it.each(["127.0.0.1", "::1", "::ffff:127.0.0.1"])("never apply to requests from %s", async (ip) => {
    db.listForOrganiser.mockResolvedValue([]);
    for (let i = 0; i < 25; i++) await run(postManageRequest, { body: { email: `loop.${ip.replace(/[^0-9]/g, "")}@example.com` }, ip });
    expect(db.listForOrganiser).toHaveBeenCalledTimes(25);
    signIn.countCodeTry.mockResolvedValue(null);
    for (let i = 0; i < 12; i++) {
      expect((await run(postManageSignIn, { body: { email: `loop.signin.${ip.replace(/[^0-9]/g, "")}@example.com`, code: "000000" }, ip })).statusCode).toBe(401);
    }
  });
});

// TASK-504: "Your materials". The private area's answer carries each fundraiser's links: the poster,
// the pictures to share, the sponsor form, the print size QR code beside the SVG (only for a page),
// and the certificate once finished.
describe("your materials", () => {
  const at = (id: number, piece: string) => `/api/fundraise/manage/fundraisers/${id}/materials/${piece}`;

  it("links an approved page's poster, pictures, sponsor form and print size QR code, but no certificate yet", async () => {
    db.listForOrganiser.mockResolvedValue([record()]);
    const f = ((await run(getManageSession, { cookie: SAM })).body as { fundraisers: Array<Record<string, unknown>> }).fundraisers[0];
    expect(f.materials).toEqual({
      poster: at(9, "poster"),
      // TASK-512: the same poster on A3, and as an A5 leaflet.
      posterA3: at(9, "poster-a3"),
      leaflet: at(9, "leaflet"),
      social: at(9, "social"),
      sponsorForm: at(9, "sponsor-form"),
      certificate: null,
      qrPng: "/fundraise/sams-walk/qr.png",
    });
  });

  it("adds the certificate once finished", async () => {
    db.listForOrganiser.mockResolvedValue([record({ status: "finished" })]);
    const f = ((await run(getManageSession, { cookie: SAM })).body as { fundraisers: Array<{ materials: Record<string, unknown> }> }).fundraisers[0];
    expect(f.materials.certificate).toBe(at(9, "certificate"));
  });

  // TASK-512: "Ask us to print these": whether they can ask, and where each ask is up to.
  it("says whether they can ask us to print, and where their posters and leaflets are up to", async () => {
    requestsDb.listRequestRowsFor.mockResolvedValue([]);
    db.listForOrganiser.mockResolvedValue([record({ eventDate: "2099-12-05", wants: { ...record().wants, posterCount: 0, leafletCount: 40 } })]);
    const f = ((await run(getManageSession, { cookie: SAM })).body as { fundraisers: Array<Record<string, unknown>> }).fundraisers[0];
    expect(f.print).toEqual({
      canAsk: true,
      posters: null,
      leaflets: { asked: 40, words: "You asked for 40 leaflets. We're getting them ready.", status: "to_send" },
    });
  });

  it("cannot ask once finished", async () => {
    requestsDb.listRequestRowsFor.mockResolvedValue([]);
    db.listForOrganiser.mockResolvedValue([record({ status: "finished" })]);
    const f = ((await run(getManageSession, { cookie: SAM })).body as { fundraisers: Array<{ print: { canAsk: boolean } }> }).fundraisers[0];
    expect(f.print.canAsk).toBe(false);
  });

  it("gives one with no page its poster and sponsor form, but no QR code to download", async () => {
    db.listForOrganiser.mockResolvedValue([record({ public: false })]);
    const f = ((await run(getManageSession, { cookie: SAM })).body as { fundraisers: Array<{ materials: Record<string, unknown> }> }).fundraisers[0];
    expect(f.materials.poster).toBe(at(9, "poster"));
    expect(f.materials.qrPng).toBeNull();
  });
});
