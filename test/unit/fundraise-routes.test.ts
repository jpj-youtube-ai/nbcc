import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-493: the public fundraising API. The database and the emails are mocked; what is checked is
// what each endpoint lets through, and that nothing shows while the fundraising switch is off.
// Every name and address here is invented.

const db = vi.hoisted(() => ({
  createFundraiser: vi.fn(),
  fundraisingIsOn: vi.fn(),
  getBySlug: vi.fn(),
  getFundraiser: vi.fn(),
  listApprovedPublic: vi.fn(),
  requestEdit: vi.fn(),
  waitingEditFor: vi.fn(),
  wallRows: vi.fn(),
}));
const send = vi.hoisted(() => ({
  sendSignUpEmails: vi.fn(),
  fundraiserPageUrl: (slug: string) => `https://nbcc.test/fundraise/${slug}`,
}));
const newsletter = vi.hoisted(() => ({ subscribeSelf: vi.fn() }));
const captcha = vi.hoisted(() => ({ enabled: false, verdict: { outcome: "passed" } as { outcome: string; reason?: string } }));

vi.mock("../../src/db/fundraisers", async () => {
  class FundraiserError extends Error {
    constructor(public readonly reason: string) {
      super(reason);
    }
  }
  return { ...db, FundraiserError };
});
vi.mock("../../src/fundraising/send", () => send);
vi.mock("../../src/newsletter/self-signup", () => newsletter);
vi.mock("../../src/clients/turnstile", () => ({
  captchaEnabled: () => captcha.enabled,
  captchaSiteKey: () => (captcha.enabled ? "site-key-for-tests" : null),
  verifyCaptcha: vi.fn(async () => captcha.verdict),
}));
vi.mock("../../src/config", () => ({ config: { NODE_ENV: "test", PORTAL_BASE_URL: "https://nbcc.test" } }));

import {
  postFundraise,
  getFundraiseCaptcha,
  getFundraisers,
  getFundraiserPage,
} from "../../src/routes/fundraise";
import { meter, type FundraiserRecord } from "../../src/fundraising/model";

type MockRes = { statusCode: number; body: unknown; status: (c: number) => MockRes; json: (b: unknown) => MockRes };
function mockRes(): MockRes {
  const res = { statusCode: 200, body: undefined as unknown } as MockRes;
  res.status = (c) => {
    res.statusCode = c;
    return res;
  };
  res.json = (b) => {
    res.body = b;
    return res;
  };
  return res;
}
let ipSeq = 0;
/* eslint-disable @typescript-eslint/no-explicit-any */
async function run(handler: (req: any, res: any) => unknown, o: { body?: unknown; params?: Record<string, string>; ip?: string } = {}) {
  const res = mockRes();
  await handler({ body: o.body ?? {}, params: o.params ?? {}, ip: o.ip ?? `10.0.0.${++ipSeq}`, headers: {} }, res);
  return res;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const signUp = (over: Record<string, unknown> = {}) => ({
  path: "raising",
  kind: "run_walk",
  title: "Sam's Sponsored Walk",
  description: "Ten miles for NBCC.",
  eventDate: "2026-11-14",
  startTime: "",
  venue: "",
  town: "Exampleton",
  targetPence: 25000,
  public: true,
  name: "Sam Sample",
  email: "sam@example.com",
  phone: "07700 900456",
  socialOk: false,
  newsletterOk: true,
  ...over,
});

const record = (over: Partial<FundraiserRecord> = {}): FundraiserRecord & { meter: ReturnType<typeof meter> } => ({
  id: 9,
  slug: "sams-sponsored-walk",
  path: "raising",
  kind: "run_walk",
  title: "Sam's Sponsored Walk",
  description: "Ten miles for NBCC.",
  eventDate: "2099-11-14",
  startTime: null,
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
  wants: { leaflets: 0, buckets: 0, shoutOut: false, attend: false },
  postAddress: null,
  newsletterOk: true,
  imageSrc: null,
  declinedReason: null,
  createdAt: "2026-10-02T10:00:00.000Z",
  approvedAt: "2026-10-02T11:00:00.000Z",
  approvedBy: "admin:someone@example.com",
  updatedAt: "2026-10-02T11:00:00.000Z",
  updatedBy: null,
  meter: meter({ onlinePence: 5000, cashPence: 1000, targetPence: 25000 }),
  ...over,
});

beforeEach(() => {
  for (const fn of Object.values(db)) fn.mockReset();
  send.sendSignUpEmails.mockReset();
  newsletter.subscribeSelf.mockReset().mockResolvedValue("added");
  captcha.enabled = false;
  captcha.verdict = { outcome: "passed" };
  db.fundraisingIsOn.mockResolvedValue(true);
});

describe("signing up", () => {
  it("stores the sign up and sends the two emails", async () => {
    db.createFundraiser.mockResolvedValue(record({ status: "new" }));
    const res = await run(postFundraise, { body: signUp() });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ status: "received" });
    expect(db.createFundraiser.mock.calls[0][0]).toMatchObject({ title: "Sam's Sponsored Walk", targetPence: 25000 });
    expect(send.sendSignUpEmails).toHaveBeenCalledTimes(1);
  });

  it("pretends to take a bot's sign up, and stores nothing", async () => {
    const res = await run(postFundraise, { body: signUp({ company: "Spam Ltd" }) });
    expect(res.statusCode).toBe(200);
    expect(db.createFundraiser).not.toHaveBeenCalled();
  });

  it("limits each address to five sign ups in ten minutes", async () => {
    db.createFundraiser.mockResolvedValue(record({ status: "new" }));
    for (let i = 0; i < 5; i++) expect((await run(postFundraise, { body: signUp(), ip: "10.9.9.9" })).statusCode).toBe(200);
    expect((await run(postFundraise, { body: signUp(), ip: "10.9.9.9" })).statusCode).toBe(429);
  });

  it("refuses a sign up while fundraising is switched off", async () => {
    db.fundraisingIsOn.mockResolvedValue(false);
    expect((await run(postFundraise, { body: signUp() })).statusCode).toBe(404);
    expect(db.createFundraiser).not.toHaveBeenCalled();
  });

  it("refuses a failed Turnstile pass, and keeps one the checker could not answer", async () => {
    captcha.enabled = true;
    captcha.verdict = { outcome: "refused", reason: "invalid-input-response" };
    expect((await run(postFundraise, { body: signUp() })).body).toEqual({ error: "captcha" });
    expect(db.createFundraiser).not.toHaveBeenCalled();
    captcha.verdict = { outcome: "unavailable", reason: "timeout" };
    db.createFundraiser.mockResolvedValue(record({ status: "new" }));
    vi.spyOn(console, "error").mockImplementationOnce(() => {});
    expect((await run(postFundraise, { body: signUp() })).statusCode).toBe(200);
  });

  it("names the fields that need another look", async () => {
    const res = await run(postFundraise, { body: signUp({ phone: "", email: "nope" }) });
    expect(res.statusCode).toBe(400);
    expect(Object.keys((res.body as { fields: Record<string, string> }).fields).sort()).toEqual(["email", "phone"]);
  });

  it("hands the form the Turnstile site key, or null when the check is off", async () => {
    expect((await run(getFundraiseCaptcha)).body).toEqual({ siteKey: null });
    captcha.enabled = true;
    expect((await run(getFundraiseCaptcha)).body).toEqual({ siteKey: "site-key-for-tests" });
  });
});

describe("Get involved's list", () => {
  it("is empty, and says so, while fundraising is off", async () => {
    db.fundraisingIsOn.mockResolvedValue(false);
    const res = await run(getFundraisers);
    expect(res.body).toEqual({ fundraisingOn: false, fundraisers: [] });
    expect(db.listApprovedPublic).not.toHaveBeenCalled();
  });

  it("lists approved public fundraisers with their meters, and drops events already over", async () => {
    db.listApprovedPublic.mockResolvedValue([
      record(),
      record({ id: 10, slug: "bake-sale", path: "event", kind: "bake_sale", eventDate: "2020-01-01" }),
    ]);
    const res = await run(getFundraisers);
    const body = res.body as { fundraisingOn: boolean; fundraisers: Array<Record<string, unknown>> };
    expect(body.fundraisingOn).toBe(true);
    expect(body.fundraisers.map((f) => f.slug)).toEqual(["sams-sponsored-walk"]);
    expect(body.fundraisers[0]).toMatchObject({ organisedBy: "Sam S.", url: "/fundraise/sams-sponsored-walk" });
    expect((body.fundraisers[0].meter as { raisedPence: number }).raisedPence).toBe(6000);
    expect(JSON.stringify(body)).not.toContain("sam@example.com");
  });
});

describe("a fundraiser's page", () => {
  it("has the meter and the wall", async () => {
    db.getBySlug.mockResolvedValue(record());
    db.wallRows.mockResolvedValue([
      { donationId: 1, fullName: "Alex Example", anonymous: false, showName: true, showAmount: true, amountPence: 5000,
        refundedPence: 0, message: "Go Sam", hidden: false, createdAt: "2026-10-02T12:00:00.000Z" },
      { donationId: 2, fullName: "Hidden Person", anonymous: false, showName: true, showAmount: true, amountPence: 100,
        refundedPence: 0, message: "rude", hidden: true, createdAt: "2026-10-02T13:00:00.000Z" },
    ]);
    const res = await run(getFundraiserPage, { params: { slug: "sams-sponsored-walk" } });
    expect(res.statusCode).toBe(200);
    const body = res.body as { wall: unknown[]; giving: unknown; meter: { raisedPence: number } };
    // The hidden message is gone; the gift itself stays.
    expect(body.wall).toEqual([
      { name: "Hidden P.", amountPence: 100, message: null, createdAt: "2026-10-02T13:00:00.000Z" },
      { name: "Alex E.", amountPence: 5000, message: "Go Sam", createdAt: "2026-10-02T12:00:00.000Z" },
    ]);
    expect(body.giving).toEqual({ fundraiserId: 9, minimumPence: 200 });
  });

  it.each([
    ["it does not exist", null],
    ["it is not approved yet", record({ status: "new" })],
    ["it is private", record({ public: false })],
    ["it is an event, with no page", record({ path: "event" })],
    ["it has finished", record({ status: "finished" })],
  ])("is a 404 when %s", async (_why, found) => {
    db.getBySlug.mockResolvedValue(found);
    expect((await run(getFundraiserPage, { params: { slug: "x" } })).statusCode).toBe(404);
  });

  it("is a 404 while fundraising is off, even when approved", async () => {
    db.fundraisingIsOn.mockResolvedValue(false);
    db.getBySlug.mockResolvedValue(record());
    expect((await run(getFundraiserPage, { params: { slug: "sams-sponsored-walk" } })).statusCode).toBe(404);
  });
});

// The private area (TASK-501) replaced the 24 hour manage links: test/unit/fundraise-private-routes.test.ts.

// TASK-493: the newsletter tick box on the sign up subscribes the organiser exactly as the footer
// form does (src/newsletter/self-signup.ts); an unticked box changes nothing.
describe("the newsletter tick box on the sign up", () => {
  it("subscribes the organiser when ticked", async () => {
    db.createFundraiser.mockResolvedValue(record({ status: "new", newsletterOk: true }));
    await run(postFundraise, { body: signUp({ newsletterOk: true }) });
    expect(newsletter.subscribeSelf).toHaveBeenCalledWith({ name: "Sam Sample", email: "sam@example.com", phone: "07700 900456" }, "fundraise");
  });

  it("does nothing when unticked", async () => {
    db.createFundraiser.mockResolvedValue(record({ status: "new", newsletterOk: false }));
    await run(postFundraise, { body: signUp({ newsletterOk: false }) });
    expect(newsletter.subscribeSelf).not.toHaveBeenCalled();
  });

  it("still takes the sign up when subscribing fails", async () => {
    db.createFundraiser.mockResolvedValue(record({ status: "new", newsletterOk: true }));
    newsletter.subscribeSelf.mockRejectedValueOnce(new Error("database away"));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await run(postFundraise, { body: signUp({ newsletterOk: true }) })).statusCode).toBe(200);
    quiet.mockRestore();
  });
});
