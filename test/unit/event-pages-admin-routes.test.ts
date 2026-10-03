import { describe, it, expect, vi, beforeEach } from "vitest";

// Event pages, in Admin > Fundraising's API: approving an event without a short name is refused
// with a plain message naming the short name box, and nobody is emailed; an approved public event
// reports its page at /event/<short name>, so the admin links it and its QR code. The database and
// the emails are mocked. Every name and address here is invented.

const db = vi.hoisted(() => ({
  getFundraiser: vi.fn(),
  getFundraisingSettings: vi.fn(),
  listAllFundraisers: vi.fn(),
  listCash: vi.fn(),
  listEdits: vi.fn(),
  moveFundraiser: vi.fn(),
  wallRows: vi.fn(),
  fundraisingIsOn: vi.fn(),
  countWaitingLiveEmails: vi.fn(),
}));
const { getUserAuthRowMock, sendApprovedEmail } = vi.hoisted(() => ({ getUserAuthRowMock: vi.fn(), sendApprovedEmail: vi.fn() }));

vi.mock("../../src/db/fundraisers", () => {
  class FundraiserError extends Error {
    constructor(
      public readonly reason: string,
      public readonly field?: string,
    ) {
      super(reason);
    }
  }
  return { ...db, FundraiserError };
});
vi.mock("../../src/fundraising/send", () => ({
  sendApprovedEmail,
  sendWaitingLiveEmails: vi.fn(),
  sendEditDecisionEmail: vi.fn(),
  fundraiserPageUrl: (slug: string) => `https://nbcc.test/fundraise/${slug}`,
  eventPageUrl: (slug: string) => `https://nbcc.test/event/${slug}`,
}));
vi.mock("../../src/db/fundraising-categories", () => ({ loadCategories: async () => [] }));
vi.mock("../../src/db/events", () => ({ insertEventImage: vi.fn() }));
vi.mock("../../src/db/admin-users", () => ({ getUserAuthRow: getUserAuthRowMock }));
vi.mock("../../src/config", () => ({
  config: {
    NODE_ENV: "development",
    DATABASE_URL: "postgres://localhost:5432/test",
    ADMIN_SESSION_SECRET: "test-admin-secret",
    STRIPE_SECRET_KEY: "sk_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    STRIPE_WEBHOOK_SECRET: "whsec_placeholder",
    PORTAL_BASE_URL: "https://nbcc.test",
  },
}));
vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));

import * as routes from "../../src/routes/admin-fundraising";
import { signAdminSession } from "../../src/admin/session";
import { FundraiserError } from "../../src/db/fundraisers";
import { EVENT_SHORT_NAME_NEEDED, meter, type FundraiserRecord } from "../../src/fundraising/model";

const EMAIL = "kim.fundraising@nbcc.test";
function editorToken() {
  getUserAuthRowMock.mockResolvedValue({ id: 1, email: EMAIL, status: "active", role: "editor", permissions: {} });
  return signAdminSession({ sub: 1, email: EMAIL, role: "editor", now: new Date(), secret: "test-admin-secret" }).token;
}

type MockRes = { statusCode: number; body: unknown; status: (c: number) => MockRes; json: (b: unknown) => MockRes };
/* eslint-disable @typescript-eslint/no-explicit-any */
async function run(handler: (req: any, res: any) => Promise<unknown>, params: Record<string, string>) {
  const res = { statusCode: 200, body: undefined as unknown } as MockRes;
  res.status = (c) => ((res.statusCode = c), res);
  res.json = (b) => ((res.body = b), res);
  await handler({ headers: { authorization: `Bearer ${editorToken()}` }, body: {}, params } as any, res as any);
  return res;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const event = (over: Partial<FundraiserRecord> = {}): FundraiserRecord =>
  ({
    id: 12, slug: "eqn", path: "event", kind: "quiz", title: "Exampleton Quiz Night", description: "A quiz.",
    eventDate: "2026-12-05", startTime: "19:00", venue: "The Hall", town: "Exampleton", targetPence: null, public: true,
    status: "new", name: "Alex Example", email: "alex@example.com", phone: "07700 900222", socialLink: null, socialOk: false,
    wants: { posterCount: 0, leafletCount: 0, bucketCount: 0, tinCount: 0, leaflets: 0, buckets: 0, shoutOut: false, attend: false },
    postAddress: null, newsletterOk: false, imageSrc: null, declinedReason: null, createdAt: "2026-10-02T10:00:00.000Z",
    approvedAt: null, approvedBy: null, updatedAt: "2026-10-02T10:00:00.000Z", updatedBy: null, slugSetAt: null,
    ...over,
  }) as FundraiserRecord;

beforeEach(() => {
  for (const fn of Object.values(db)) fn.mockReset();
  sendApprovedEmail.mockReset().mockResolvedValue(true);
  db.listEdits.mockResolvedValue([]);
  db.listCash.mockResolvedValue([]);
  db.wallRows.mockResolvedValue([]);
});

describe("approving an event without a short name", () => {
  it("is refused with a plain message that points at the short name box, and emails nobody", async () => {
    db.moveFundraiser.mockRejectedValue(new FundraiserError("needs_short_name"));
    const res = await run(routes.postApproveFundraiser, { id: "12" });
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: EVENT_SHORT_NAME_NEEDED, fields: { slug: EVENT_SHORT_NAME_NEEDED } });
    expect(sendApprovedEmail).not.toHaveBeenCalled();
  });
});

describe("an event's page in the admin", () => {
  it("is its /event/ address once it is approved and public", async () => {
    const after = event({ status: "approved", slugSetAt: "2026-10-03T09:00:00.000Z" });
    db.moveFundraiser.mockResolvedValue({ before: event(), after, livePending: false });
    const res = await run(routes.postApproveFundraiser, { id: "12" });
    expect(res.statusCode).toBe(200);
    const f = (res.body as { fundraiser: { pageUrl: string; pagePath: string } }).fundraiser;
    expect(f.pageUrl).toBe("https://nbcc.test/event/eqn");
    expect(f.pagePath).toBe("/event/eqn");
    expect(sendApprovedEmail).toHaveBeenCalledWith(after);
  });

  it("says whether its short name has been set yet, for the approve button", async () => {
    db.getFundraiser.mockResolvedValue({ ...event(), meter: meter({ onlinePence: 0, cashPence: 0, targetPence: null }), editWaiting: false });
    const res = await run(routes.getAdminFundraiser, { id: "12" });
    const f = (res.body as { fundraiser: { pageUrl: string | null; pagePath: string; slugSetAt: string | null } }).fundraiser;
    expect(f.slugSetAt).toBeNull();
    expect(f.pagePath).toBe("/event/eqn");
    expect(f.pageUrl).toBeNull();
  });

  it("is still /fundraise/ for a fundraiser raising money", async () => {
    const after = event({ path: "raising", slug: "rsd", status: "approved" });
    db.moveFundraiser.mockResolvedValue({ before: event({ path: "raising", slug: "rsd" }), after, livePending: false });
    const f = ((await run(routes.postApproveFundraiser, { id: "12" })).body as { fundraiser: { pageUrl: string; pagePath: string } }).fundraiser;
    expect(f.pageUrl).toBe("https://nbcc.test/fundraise/rsd");
    expect(f.pagePath).toBe("/fundraise/rsd");
  });
});
