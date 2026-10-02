import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-502: POST /api/fundraisers/:slug/wall-message, the optional step on the thank you after
// paying. It is tied to the paid Stripe checkout session: the gift the webhook recorded for that
// session must be on THIS fundraiser, gone through, not paid in, and not added to before. Before the
// webhook lands, Stripe is asked, so a real giver hears "try again in a moment" and anyone else is
// refused. The database and Stripe are mocked. Every name and number here is invented.

const db = vi.hoisted(() => ({
  fundraisingIsOn: vi.fn(),
  getBySlug: vi.fn(),
  addWallMessage: vi.fn(),
  giftForSession: vi.fn(),
  listForOrganiser: vi.fn(),
  getFundraiser: vi.fn(),
  requestEdit: vi.fn(),
  markFinishedRequested: vi.fn(),
  waitingEditFor: vi.fn(),
  wallRows: vi.fn(),
  createFundraiser: vi.fn(),
  listApprovedPublic: vi.fn(),
}));
const stripeMock = vi.hoisted(() => ({ retrieve: vi.fn() }));

vi.mock("../../src/db/fundraisers", async () => {
  class FundraiserError extends Error {
    constructor(public readonly reason: string) {
      super(reason);
    }
  }
  return { ...db, FundraiserError };
});
vi.mock("../../src/db/fundraiser-sign-in", () => ({}));
vi.mock("../../src/fundraising/send", () => ({
  fundraiserPageUrl: (slug: string) => `https://nbcc.test/fundraise/${slug}`,
  manageUrl: () => "https://nbcc.test/fundraise/manage",
}));
vi.mock("../../src/newsletter/self-signup", () => ({ subscribeSelf: vi.fn() }));
vi.mock("../../src/clients/turnstile", () => ({ captchaEnabled: () => false, captchaSiteKey: () => null, verifyCaptcha: vi.fn() }));
vi.mock("../../src/clients/stripe", () => ({
  stripe: { checkout: { sessions: { retrieve: stripeMock.retrieve, create: vi.fn() } } },
  stripeConfigured: true,
}));
vi.mock("../../src/config", () => ({
  config: { NODE_ENV: "production", PORTAL_BASE_URL: "https://nbcc.test", ADMIN_SESSION_SECRET: "a-test-secret", DATABASE_URL: "postgres://localhost:5432/test" },
}));

import { postWallMessage } from "../../src/routes/fundraise";
import { meter, type FundraiserRecord } from "../../src/fundraising/model";

type MockRes = {
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
  status: (c: number) => MockRes;
  setHeader: (name: string, value: string) => MockRes;
  json: (b: unknown) => MockRes;
};
function mockRes(): MockRes {
  const res = { statusCode: 200, body: undefined as unknown, headers: {} } as unknown as MockRes;
  res.setHeader = (name, value) => ((res.headers[name.toLowerCase()] = value), res);
  res.status = (c) => ((res.statusCode = c), res);
  res.json = (b) => ((res.body = b), res);
  return res;
}

let ipSeq = 0;
type Opts = { body?: unknown; slug?: string; ip?: string; headers?: Record<string, string> };
async function send(o: Opts = {}) {
  const res = mockRes();
  const headers: Record<string, string> = { host: "nbcc.test", "sec-fetch-site": "same-origin", ...(o.headers ?? {}) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await postWallMessage({ body: o.body ?? {}, params: { slug: o.slug ?? "robins-santa-dash" }, ip: o.ip ?? `10.2.0.${++ipSeq}`, headers } as any, res as any);
  return res;
}

const record = (over: Partial<FundraiserRecord> = {}) =>
  ({
    id: 41,
    slug: "robins-santa-dash",
    path: "raising",
    status: "approved",
    public: true,
    title: "Robin's Santa Dash",
    name: "Robin Quill",
    email: "robin.quill@example.com",
    meter: meter({ onlinePence: 2000, cashPence: 0, targetPence: 25000 }),
    ...over,
  }) as FundraiserRecord & { meter: ReturnType<typeof meter> };

// A new session for every test, as the per session limit is counted across them.
let SESSION = "cs_test_a1B2c3D4e5";
let caseNo = 0;
const good = { sessionId: SESSION, message: "Go Robin!", showName: true, showAmount: true };
const entry = { name: "Alex E.", amountPence: 2000, giftAidPence: null, message: "Go Robin!", createdAt: "2026-10-02T10:00:00.000Z" };

beforeEach(() => {
  SESSION = `cs_test_case${++caseNo}`;
  good.sessionId = SESSION;
  for (const fn of Object.values(db)) fn.mockReset();
  stripeMock.retrieve.mockReset();
  db.fundraisingIsOn.mockResolvedValue(true);
  db.getBySlug.mockResolvedValue(record());
  db.addWallMessage.mockResolvedValue({ verdict: "ok", entry });
});

describe("adding to the wall after paying", () => {
  it("saves it for the paid gift on this fundraiser", async () => {
    const res = await send({ body: good });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ status: "added", entry });
    expect(db.addWallMessage).toHaveBeenCalledWith(SESSION, 41, { message: "Go Robin!", showName: true, showAmount: true });
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("works on a finished fundraiser's page too, which still takes gifts", async () => {
    db.getBySlug.mockResolvedValue(record({ status: "finished" }));
    expect((await send({ body: good })).statusCode).toBe(200);
  });

  it("refuses a second time", async () => {
    db.addWallMessage.mockResolvedValue({ verdict: "already", entry: null });
    const res = await send({ body: good });
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ code: "already" });
  });

  it("refuses a gift made on another fundraiser, without saying whose", async () => {
    db.addWallMessage.mockResolvedValue({ verdict: "not_found", entry: null });
    const res = await send({ body: good });
    expect(res.statusCode).toBe(404);
    expect(JSON.stringify(res.body)).not.toMatch(/fundraiser \d|robin/i);
  });

  it("refuses money the organiser paid in", async () => {
    db.addWallMessage.mockResolvedValue({ verdict: "paid_in", entry: null });
    expect((await send({ body: good })).statusCode).toBe(404);
  });

  it("refuses a payment that did not go through", async () => {
    db.addWallMessage.mockResolvedValue({ verdict: "unpaid", entry: null });
    const res = await send({ body: good });
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ code: "unpaid" });
  });

  it("refuses rude words, beside the message, and saves nothing", async () => {
    const res = await send({ body: { ...good, message: "you bastard" } });
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ fields: { message: "Please choose different words for your message on the supporter wall." } });
    expect(db.addWallMessage).not.toHaveBeenCalled();
  });

  it("refuses a missing or made up session id, and saves nothing", async () => {
    for (const body of [{ ...good, sessionId: undefined }, { ...good, sessionId: "{CHECKOUT_SESSION_ID}" }, { ...good, sessionId: "pi_123" }]) {
      const res = await send({ body });
      expect(res.statusCode).toBe(400);
    }
    expect(db.addWallMessage).not.toHaveBeenCalled();
  });

  it("refuses a message over 200 characters", async () => {
    expect((await send({ body: { ...good, message: "a".repeat(201) } })).statusCode).toBe(400);
  });

  it("is not there for a fundraiser without a page, or while fundraising is off", async () => {
    for (const arrange of [
      () => db.getBySlug.mockResolvedValue(null),
      () => db.getBySlug.mockResolvedValue(record({ status: "new" })),
      () => db.getBySlug.mockResolvedValue(record({ status: "declined" })),
      () => db.getBySlug.mockResolvedValue(record({ public: false })),
      () => db.fundraisingIsOn.mockResolvedValue(false),
    ]) {
      db.fundraisingIsOn.mockResolvedValue(true);
      db.getBySlug.mockResolvedValue(record());
      arrange();
      expect((await send({ body: good })).statusCode).toBe(404);
    }
    expect(db.addWallMessage).not.toHaveBeenCalled();
  });

  it("refuses a send from another website", async () => {
    const res = await send({ body: good, headers: { "sec-fetch-site": "cross-site" } });
    expect(res.statusCode).toBe(403);
    expect(db.addWallMessage).not.toHaveBeenCalled();
  });

  it("is limited per address", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await send({ body: { ...good, sessionId: `cs_test_limit${i}` }, ip: "10.9.9.9" })).statusCode);
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
  });

  it("is limited per session too", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) statuses.push((await send({ body: { ...good, sessionId: "cs_test_samesession" } })).statusCode);
    expect(statuses.slice(0, 5).every((s) => s === 200)).toBe(true);
    expect(statuses.slice(5)).toEqual([429, 429]);
  });
});

describe("before the webhook has recorded the payment", () => {
  beforeEach(() => db.addWallMessage.mockResolvedValue({ verdict: "not_recorded", entry: null }));

  it("asks Stripe, and a paid session for this fundraiser hears to try again in a moment", async () => {
    stripeMock.retrieve.mockResolvedValue({ id: SESSION, status: "complete", payment_status: "paid", metadata: { fundraiserId: "41" } });
    const res = await send({ body: good });
    expect(stripeMock.retrieve).toHaveBeenCalledWith(SESSION);
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ code: "confirming", error: "Your payment is still being confirmed. Please try again in a moment." });
  });

  it("refuses a session that has not been paid", async () => {
    stripeMock.retrieve.mockResolvedValue({ id: SESSION, status: "open", payment_status: "unpaid", metadata: { fundraiserId: "41" } });
    expect((await send({ body: good })).statusCode).toBe(404);
  });

  it("refuses a session for another fundraiser, or a pay in", async () => {
    stripeMock.retrieve.mockResolvedValue({ id: SESSION, status: "complete", payment_status: "paid", metadata: { fundraiserId: "42" } });
    expect((await send({ body: good })).statusCode).toBe(404);
    stripeMock.retrieve.mockResolvedValue({ id: SESSION, status: "complete", payment_status: "paid", metadata: { fundraiserId: "41", paidInByOrganiser: "true" } });
    expect((await send({ body: good })).statusCode).toBe(404);
  });

  it("refuses a session Stripe does not know", async () => {
    stripeMock.retrieve.mockRejectedValue(Object.assign(new Error("No such checkout.session"), { type: "StripeInvalidRequestError", code: "resource_missing" }));
    expect((await send({ body: good })).statusCode).toBe(404);
  });

  it("asks them to try again when Stripe cannot be reached", async () => {
    stripeMock.retrieve.mockRejectedValue(new Error("network down"));
    const res = await send({ body: good });
    expect(res.statusCode).toBe(503);
  });
});

describe("when something breaks", () => {
  it("says so plainly", async () => {
    db.addWallMessage.mockRejectedValue(new Error("database down"));
    const res = await send({ body: good });
    expect(res.statusCode).toBe(500);
    expect(res.body).toMatchObject({ error: expect.stringMatching(/try again/) });
  });
});
