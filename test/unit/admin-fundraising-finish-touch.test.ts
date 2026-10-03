import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-515: pressing Mark finished sends the finished email (17, with the certificate) right after
// the finish has committed, through sendFinishedTouch and every guard in it. Approving and
// declining never do. A failure there never fails the answer. Every name here is invented.

const { getUserAuthRowMock, moveFundraiser, getFundraiser, sendFinishedTouch } = vi.hoisted(() => ({
  getUserAuthRowMock: vi.fn(),
  moveFundraiser: vi.fn(),
  getFundraiser: vi.fn(),
  sendFinishedTouch: vi.fn(),
}));

vi.mock("../../src/db/fundraisers", () => {
  class FundraiserError extends Error {
    constructor(public readonly reason: string) {
      super(reason);
    }
  }
  return { moveFundraiser, getFundraiser, FundraiserError, fundraisingIsOn: vi.fn(async () => true) };
});
vi.mock("../../src/fundraising/send", () => ({
  sendApprovedEmail: vi.fn(async () => true),
  sendWaitingLiveEmails: vi.fn(),
  sendEditDecisionEmail: vi.fn(),
  fundraiserPageUrl: (slug: string) => `https://nbcc.test/fundraise/${slug}`,
}));
vi.mock("../../src/fundraising/touch-runner", () => ({ sendFinishedTouch }));
// Review: the thank you is sent with the meter the daily run reads (a team page's whole team total).
const { touchFundraiser } = vi.hoisted(() => ({ touchFundraiser: vi.fn() }));
vi.mock("../../src/db/fundraising-touch", async (orig) => ({ ...(await orig<Record<string, unknown>>()), touchFundraiser }));
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

function token() {
  getUserAuthRowMock.mockResolvedValue({ id: 1, email: "kim@example.com", status: "active", role: "editor", permissions: {} });
  return signAdminSession({ sub: 1, email: "kim@example.com", role: "editor", now: new Date(), secret: "test-admin-secret" }).token;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function run(handler: (req: any, res: any) => Promise<unknown>) {
  const res = { statusCode: 200, body: undefined as unknown } as any;
  res.status = (c: number) => ((res.statusCode = c), res);
  res.json = (b: unknown) => ((res.body = b), res);
  await handler({ headers: { authorization: `Bearer ${token()}` }, body: {}, params: { id: "9" } } as any, res);
  return res;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const after = { id: 9, slug: "sams-walk", title: "Sam's Walk", kind: "run_walk", status: "finished", path: "raising", public: true };

beforeEach(() => {
  moveFundraiser.mockReset().mockResolvedValue({ before: { ...after, status: "approved" }, after, livePending: false });
  getFundraiser.mockReset().mockResolvedValue({ ...after, meter: { raisedPence: 0 } });
  touchFundraiser.mockReset().mockResolvedValue({ ...after, meter: { raisedPence: 61200 } });
  sendFinishedTouch.mockReset().mockResolvedValue("sent");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("Mark finished", () => {
  it("sends the finished email with the fundraiser's meter, after the finish has committed", async () => {
    const res = await run(routes.postFinishFundraiser);
    expect(res.statusCode).toBe(200);
    expect(touchFundraiser).toHaveBeenCalledWith(9);
    expect(sendFinishedTouch).toHaveBeenCalledWith(expect.objectContaining({ id: 9, meter: { raisedPence: 61200 } }));
    expect(moveFundraiser.mock.invocationCallOrder[0]).toBeLessThan(sendFinishedTouch.mock.invocationCallOrder[0]);
  });

  it("still answers 200 when the email cannot go", async () => {
    sendFinishedTouch.mockRejectedValue(new Error("down"));
    expect((await run(routes.postFinishFundraiser)).statusCode).toBe(200);
  });

  it("is never sent by approving or declining", async () => {
    moveFundraiser.mockResolvedValue({ before: after, after: { ...after, status: "approved" }, livePending: false });
    await run(routes.postApproveFundraiser);
    await run(routes.postDeclineFundraiser);
    expect(sendFinishedTouch).not.toHaveBeenCalled();
  });
});
