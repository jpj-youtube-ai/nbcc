import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-515: the API behind Admin > Fundraising > Automatic emails and the smart call prompts.
// Anyone who can see Fundraising can read every automatic email (Jaimie's rule: every one readable
// in the admin first) and the prompts; editors and admins record a call; only an admin switches
// the automatic emails on or off. The database is mocked. Every name and address is invented.

const touch = vi.hoisted(() => ({
  getTouchSettings: vi.fn(),
  setTouchEmailsOn: vi.fn(),
  readTouchState: vi.fn(),
  recordPromptCall: vi.fn(),
  listWordingApprovals: vi.fn(),
  approveWording: vi.fn(),
  withdrawWording: vi.fn(),
}));
const { getUserAuthRowMock, getFundraiser } = vi.hoisted(() => ({ getUserAuthRowMock: vi.fn(), getFundraiser: vi.fn() }));

vi.mock("../../src/db/fundraising-touch", () => {
  class TouchError extends Error {
    constructor(public readonly reason: string) {
      super(reason);
    }
  }
  return { ...touch, TouchError };
});
vi.mock("../../src/db/fundraisers", () => ({ getFundraiser }));
vi.mock("../../src/db/admin-users", () => ({ getUserAuthRow: getUserAuthRowMock }));
vi.mock("../../src/config", () => ({
  config: {
    NODE_ENV: "development",
    DATABASE_URL: "postgres://localhost:5432/test",
    ADMIN_SESSION_SECRET: "test-admin-secret",
    STRIPE_SECRET_KEY: "sk_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    STRIPE_WEBHOOK_SECRET: "whsec_placeholder",
    PORTAL_BASE_URL: "https://nbcc.test",
    BALL_FROM_EMAIL: "events@nbcc.test",
  },
}));
vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));

import * as routes from "../../src/routes/admin-fundraising-touch";
import { signAdminSession } from "../../src/admin/session";
import { TouchError } from "../../src/db/fundraising-touch";
import { meter } from "../../src/fundraising/model";

const SECRET = "test-admin-secret";
function tokenFor(role: string, permissions: Record<string, string> = {}) {
  getUserAuthRowMock.mockResolvedValue({ id: 3, email: "fern@example.com", status: "active", role, permissions });
  return signAdminSession({ sub: 3, email: "fern@example.com", role, now: new Date(), secret: SECRET }).token;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Handler = (req: any, res: any) => Promise<unknown>;
type Opts = { token?: string | null; body?: unknown; params?: Record<string, string>; query?: Record<string, string> };
async function run(handler: Handler, o: Opts = {}) {
  const res = { statusCode: 200, body: undefined as unknown } as any;
  res.status = (c: number) => ((res.statusCode = c), res);
  res.json = (b: unknown) => ((res.body = b), res);
  const headers: Record<string, string> = {};
  if (o.token) headers.authorization = `Bearer ${o.token}`;
  await handler({ headers, body: o.body ?? {}, params: o.params ?? {}, query: o.query ?? {} } as any, res);
  return res;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const WANTS = { posterCount: 0, leafletCount: 0, bucketCount: 0, tinCount: 0, leaflets: 0, buckets: 0, shoutOut: false, attend: false };
const robin = {
  id: 12, slug: "robins-walk", path: "raising", kind: "run_walk", title: "Robin's Walk", name: "Robin Sample", email: "robin@example.com",
  status: "approved", public: true, eventDate: null, approvedAt: "2026-10-06T09:00:00.000Z", targetPence: 30000, wants: WANTS,
  meter: meter({ onlinePence: 12000, cashPence: 0, targetPence: 30000 }),
};

beforeEach(() => {
  for (const fn of Object.values(touch)) fn.mockReset();
  getUserAuthRowMock.mockReset();
  getFundraiser.mockReset().mockResolvedValue(robin);
  touch.getTouchSettings.mockResolvedValue({ on: false, updatedAt: null, updatedBy: null });
  touch.setTouchEmailsOn.mockImplementation(async (on: boolean) => ({ on, updatedAt: "2026-10-03T09:00:00.000Z", updatedBy: "admin:fern@example.com" }));
  touch.readTouchState.mockResolvedValue([
    {
      f: robin,
      touch: { firstOnlineGiftAt: null, lastOnlineGiftAt: null, finishedAt: null, sent: [{ kind: "first_gift", sentAt: "2026-10-20T07:00:00.000Z" }] },
      prompt: { lastOnlineGiftAt: null, calls: [] },
    },
  ]);
  touch.listWordingApprovals.mockResolvedValue([
    { key: "target", approvedAt: "2026-10-03T11:00:00.000Z", approvedBy: "Jaimie" },
    { key: "need_a_hand", approvedAt: "2026-10-03T11:00:00.000Z", approvedBy: "Jaimie" },
    { key: "on_track", approvedAt: "2026-10-03T11:00:00.000Z", approvedBy: "Jaimie" },
  ]);
  touch.approveWording.mockImplementation(async (key: string, actor: string) => ({ key, approvedAt: "2026-10-04T09:00:00.000Z", approvedBy: actor }));
  touch.withdrawWording.mockResolvedValue(true);
  touch.recordPromptCall.mockResolvedValue({ prompt: "sponsor_form", calledAt: "2026-10-03T10:00:00.000Z", calledBy: "fern@example.com", note: null });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("who may do what", () => {
  it("needs a session for everything", async () => {
    for (const h of [routes.getTouch, routes.getTouchPreview, routes.putTouchSettings, routes.postPromptCall]) {
      expect((await run(h, { params: { kind: "halfway", id: "12" }, body: { on: true, prompt: "quiet" } })).statusCode).toBe(401);
    }
  });

  it("lets a viewer read the emails and the prompts, but not record a call or switch anything", async () => {
    const t = tokenFor("viewer");
    expect((await run(routes.getTouch, { token: t })).statusCode).toBe(200);
    expect((await run(routes.getTouchPreview, { token: t, params: { kind: "halfway" } })).statusCode).toBe(200);
    expect((await run(routes.postPromptCall, { token: t, params: { id: "12" }, body: { prompt: "quiet" } })).statusCode).toBe(403);
    expect((await run(routes.putTouchSettings, { token: t, body: { on: true } })).statusCode).toBe(403);
    expect(touch.setTouchEmailsOn).not.toHaveBeenCalled();
  });

  it("lets an editor record a call, but never switch the automatic emails on", async () => {
    const t = tokenFor("editor");
    expect((await run(routes.postPromptCall, { token: t, params: { id: "12" }, body: { prompt: "sponsor_form" } })).statusCode).toBe(200);
    expect((await run(routes.putTouchSettings, { token: t, body: { on: true } })).statusCode).toBe(403);
    expect(touch.setTouchEmailsOn).not.toHaveBeenCalled();
  });

  it("lets only an admin switch them on and off, recording who", async () => {
    const t = tokenFor("admin");
    const res = await run(routes.putTouchSettings, { token: t, body: { on: true } });
    expect(res.statusCode).toBe(200);
    expect(touch.setTouchEmailsOn).toHaveBeenCalledWith(true, "admin:fern@example.com");
    expect(res.body).toMatchObject({ on: true });
  });

  it("takes nothing but on, true or false", async () => {
    const t = tokenFor("admin");
    expect((await run(routes.putTouchSettings, { token: t, body: { on: "yes" } })).statusCode).toBe(400);
    expect((await run(routes.putTouchSettings, { token: t, body: { on: true, extra: 1 } })).statusCode).toBe(400);
    expect(touch.setTouchEmailsOn).not.toHaveBeenCalled();
  });
});

describe("the overview", () => {
  it("gives the switch, every email with when it goes, what each fundraiser has had, and its prompts", async () => {
    const res = await run(routes.getTouch, { token: tokenFor("viewer") });
    const body = res.body as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(body.settings).toEqual({ on: false, updatedAt: null, updatedBy: null });
    expect(body.kinds.map((k: { kind: string }) => k.kind)).toEqual([
      "first_gift", "halfway", "target", "week_before", "week_after", "finished", "year_on", "need_a_hand", "on_track",
    ]);
    expect(body.kinds.find((k: { kind: string }) => k.kind === "need_a_hand").newWording).toBe(true);
    expect(body.kinds.find((k: { kind: string }) => k.kind === "halfway").newWording).toBe(false);
    expect(body.sent["12"]).toEqual([{ kind: "first_gift", sentAt: "2026-10-20T07:00:00.000Z" }]);
    expect(body.prompts["12"].map((p: { key: string }) => p.key)).toContain("sponsor_form");
    expect(typeof body.today).toBe("string");
    // Robin has had the first gift email and is at 40% with no date: nothing is due.
    expect(body.due).toEqual({});
  });

  it("says what the next 8am run would send, were it switched on", async () => {
    touch.readTouchState.mockResolvedValue([
      {
        f: { ...robin, meter: meter({ onlinePence: 15000, cashPence: 0, targetPence: 30000 }) },
        touch: { firstOnlineGiftAt: null, lastOnlineGiftAt: null, finishedAt: null, sent: [] },
        prompt: { lastOnlineGiftAt: null, calls: [] },
      },
    ]);
    const res = await run(routes.getTouch, { token: tokenFor("viewer") });
    expect((res.body as { due: Record<string, string> }).due).toEqual({ "12": "halfway" });
  });
});

describe("the preview", () => {
  it("shows an email for the invented sample", async () => {
    const res = await run(routes.getTouchPreview, { token: tokenFor("viewer"), params: { kind: "target" } });
    const body = res.body as { subject: string; html: string; text: string; newWording: boolean; sample: boolean };
    expect(body.subject).toBe("You did it! Target reached");
    expect(body.html).toContain("Sam&#39;s Santa Dash");
    expect(body.text).toContain("Raise my target");
    expect(body.newWording).toBe(true);
    expect(body.sample).toBe(true);
  });

  it("shows the example with nothing raised yet, marking 16, 17 and 18's versions of it as new wording", async () => {
    const t = tokenFor("viewer");
    const zero = await run(routes.getTouchPreview, { token: t, params: { kind: "week_after" }, query: { sample: "zero" } });
    const body = zero.body as { html: string; newWording: boolean; sample: boolean };
    expect(body.sample).toBe(true);
    expect(body.newWording).toBe(true);
    expect(body.html).not.toContain("So far you");
    const raised = await run(routes.getTouchPreview, { token: t, params: { kind: "week_after" } });
    expect((raised.body as { newWording: boolean }).newWording).toBe(false);
    const finished = await run(routes.getTouchPreview, { token: t, params: { kind: "finished" } });
    expect((finished.body as { newWording: boolean }).newWording).toBe(true);
  });

  it("shows an email for a real fundraiser, from its record", async () => {
    const res = await run(routes.getTouchPreview, { token: tokenFor("viewer"), params: { kind: "halfway" }, query: { fundraiserId: "12" } });
    const body = res.body as { html: string; sample: boolean; title: string };
    expect(getFundraiser).toHaveBeenCalledWith(12);
    expect(body.html).toContain("Robin&#39;s Walk");
    expect(body.html).toContain("Hi Robin,");
    expect(body.sample).toBe(false);
  });

  it("refuses an email that does not exist, and a fundraiser that is not there", async () => {
    const t = tokenFor("viewer");
    expect((await run(routes.getTouchPreview, { token: t, params: { kind: "nope" } })).statusCode).toBe(404);
    getFundraiser.mockResolvedValue(null);
    expect((await run(routes.getTouchPreview, { token: t, params: { kind: "halfway" }, query: { fundraiserId: "99" } })).statusCode).toBe(404);
    expect((await run(routes.getTouchPreview, { token: t, params: { kind: "halfway" }, query: { fundraiserId: "x" } })).statusCode).toBe(400);
  });
});

describe("recording a call about a prompt", () => {
  it("records which prompt and the note, against the person", async () => {
    const res = await run(routes.postPromptCall, { token: tokenFor("editor"), params: { id: "12" }, body: { prompt: "behind", note: "  Posters on the way  " } });
    expect(res.statusCode).toBe(200);
    expect(touch.recordPromptCall).toHaveBeenCalledWith(12, "behind", "Posters on the way", "fern@example.com", "admin:fern@example.com");
  });

  it("refuses a prompt that does not exist, a long note, and anything else", async () => {
    const t = tokenFor("editor");
    expect((await run(routes.postPromptCall, { token: t, params: { id: "12" }, body: { prompt: "gossip" } })).statusCode).toBe(400);
    expect((await run(routes.postPromptCall, { token: t, params: { id: "12" }, body: { prompt: "quiet", note: "x".repeat(501) } })).statusCode).toBe(400);
    expect((await run(routes.postPromptCall, { token: t, params: { id: "12" }, body: { prompt: "quiet", calledAt: "2026-01-01" } })).statusCode).toBe(400);
    expect((await run(routes.postPromptCall, { token: t, params: { id: "x" }, body: { prompt: "quiet" } })).statusCode).toBe(400);
    expect(touch.recordPromptCall).not.toHaveBeenCalled();
  });

  it("says when the fundraiser is not there", async () => {
    touch.recordPromptCall.mockRejectedValue(new TouchError("not_found"));
    expect((await run(routes.postPromptCall, { token: tokenFor("editor"), params: { id: "12" }, body: { prompt: "quiet" } })).statusCode).toBe(404);
  });
});

describe("signing off the new wording (Jaimie, 2026-10-03)", () => {
  it("needs a session to approve or withdraw", async () => {
    for (const h of [routes.postWordingApproval, routes.deleteWordingApproval]) {
      expect((await run(h, { params: { key: "finished" } })).statusCode).toBe(401);
    }
  });

  it("lets only an admin approve a wording, recording who", async () => {
    for (const r of ["viewer", "editor"]) {
      const t = tokenFor(r);
      expect((await run(routes.postWordingApproval, { token: t, params: { key: "finished" } })).statusCode).toBe(403);
      expect((await run(routes.deleteWordingApproval, { token: t, params: { key: "target" } })).statusCode).toBe(403);
    }
    expect(touch.approveWording).not.toHaveBeenCalled();
    expect(touch.withdrawWording).not.toHaveBeenCalled();
    const res = await run(routes.postWordingApproval, { token: tokenFor("admin"), params: { key: "finished" } });
    expect(res.statusCode).toBe(200);
    expect(touch.approveWording).toHaveBeenCalledWith("finished", "admin:fern@example.com");
    expect(res.body).toEqual({ approval: { key: "finished", approvedAt: "2026-10-04T09:00:00.000Z", approvedBy: "admin:fern@example.com" } });
  });

  it("lets an admin withdraw an approval", async () => {
    const res = await run(routes.deleteWordingApproval, { token: tokenFor("admin"), params: { key: "target" } });
    expect(res.statusCode).toBe(200);
    expect(touch.withdrawWording).toHaveBeenCalledWith("target", "admin:fern@example.com");
    expect(res.body).toEqual({ withdrawn: true });
  });

  it("refuses a wording that does not need signing off, or does not exist", async () => {
    const t = tokenFor("admin");
    for (const key of ["halfway", "nope", "week_after"]) {
      expect((await run(routes.postWordingApproval, { token: t, params: { key } })).statusCode).toBe(404);
      expect((await run(routes.deleteWordingApproval, { token: t, params: { key } })).statusCode).toBe(404);
    }
    expect(touch.approveWording).not.toHaveBeenCalled();
  });

  it("gives each email's versions waiting for sign off, and every approval, in the overview", async () => {
    const body = (await run(routes.getTouch, { token: tokenFor("viewer") })).body as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const waiting = Object.fromEntries(body.kinds.map((k: { kind: string; waiting: string[] }) => [k.kind, k.waiting]));
    expect(waiting).toEqual({
      first_gift: [], halfway: [], target: [], week_before: [], week_after: ["week_after_zero"],
      finished: ["finished", "finished_zero"], year_on: ["year_on_zero"], need_a_hand: [], on_track: [],
    });
    expect(body.approvals.target).toEqual({ approvedAt: "2026-10-03T11:00:00.000Z", approvedBy: "Jaimie" });
    expect(body.approvals.finished).toBeUndefined();
  });

  it("leaves out of the next run what is waiting for sign off, and says so", async () => {
    // Robin is at the target with no date: target is due. Approved, it would go; withdrawn, it waits.
    touch.readTouchState.mockResolvedValue([
      {
        f: { ...robin, meter: meter({ onlinePence: 30000, cashPence: 0, targetPence: 30000 }) },
        touch: { firstOnlineGiftAt: null, lastOnlineGiftAt: null, finishedAt: null, sent: [] },
        prompt: { lastOnlineGiftAt: null, calls: [] },
      },
    ]);
    expect((await run(routes.getTouch, { token: tokenFor("viewer") })).body).toMatchObject({ due: { "12": "target" }, held: {} });
    touch.listWordingApprovals.mockResolvedValue([]);
    expect((await run(routes.getTouch, { token: tokenFor("viewer") })).body).toMatchObject({ due: {}, held: { "12": "target" } });
  });

  it("says in the preview which version it is, and whether it is approved, by whom and when", async () => {
    const t = tokenFor("viewer");
    const target = (await run(routes.getTouchPreview, { token: t, params: { kind: "target" } })).body as Record<string, unknown>;
    expect(target).toMatchObject({ newWording: true, wordingKey: "target", approval: { approvedAt: "2026-10-03T11:00:00.000Z", approvedBy: "Jaimie" } });
    const finished = (await run(routes.getTouchPreview, { token: t, params: { kind: "finished" } })).body as Record<string, unknown>;
    expect(finished).toMatchObject({ newWording: true, wordingKey: "finished", approval: null });
    const zero = (await run(routes.getTouchPreview, { token: t, params: { kind: "year_on" }, query: { sample: "zero" } })).body as Record<string, unknown>;
    expect(zero).toMatchObject({ newWording: true, wordingKey: "year_on_zero", approval: null });
    const old = (await run(routes.getTouchPreview, { token: t, params: { kind: "halfway" } })).body as Record<string, unknown>;
    expect(old).toMatchObject({ newWording: false, wordingKey: null, approval: null });
  });
});
