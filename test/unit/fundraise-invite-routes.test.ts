import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-503: the public side of an invite. The sign up form sends the token from its link and gets
// back the first name, surname and email to fill in (nothing else); a token that is unknown, used or out of date
// gets the same plain "not found". When the sign up arrives with the token, the invite is marked
// used and linked to it, best effort: the sign up stands whatever happens to that. Every name and
// address here is invented.

const team = vi.hoisted(() => ({ findInviteByHash: vi.fn(), markInviteUsed: vi.fn() }));
const db = vi.hoisted(() => ({ createFundraiser: vi.fn(), fundraisingIsOn: vi.fn() }));

vi.mock("../../src/db/fundraising-team", () => team);
vi.mock("../../src/db/fundraisers", () => {
  class FundraiserError extends Error {}
  return { ...db, FundraiserError };
});
vi.mock("../../src/fundraising/send", () => ({ sendSignUpEmails: vi.fn(), fundraiserPageUrl: (s: string) => s, manageUrl: () => "" }));
// Fundraising categories: the starting list stands in for the database's (src/fundraising/categories.ts).
vi.mock("../../src/db/fundraising-categories", () => ({ loadCategories: async () => [] }));
vi.mock("../../src/newsletter/self-signup", () => ({ subscribeSelf: vi.fn() }));
vi.mock("../../src/clients/turnstile", () => ({ captchaEnabled: () => false, captchaSiteKey: () => null, verifyCaptcha: vi.fn() }));
vi.mock("../../src/config", () => ({ config: { NODE_ENV: "test", PORTAL_BASE_URL: "https://nbcc.test" } }));

import { postInvitePrefill, useInvite } from "../../src/routes/fundraise-invite";
import { postFundraise } from "../../src/routes/fundraise";
import { hashInviteToken, newInviteToken } from "../../src/fundraising/invite";

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
async function run(handler: (req: any, res: any) => unknown, o: { body?: unknown; ip?: string } = {}) {
  const res = mockRes();
  await handler({ body: o.body ?? {}, params: {}, ip: o.ip ?? `10.1.0.${++ipSeq}`, headers: {} }, res);
  return res;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const TOKEN = newInviteToken();
const found = (over: Record<string, unknown> = {}) => ({
  id: 4,
  name: "Mary Jane Smith",
  firstName: "Mary Jane",
  lastName: "Smith",
  email: "alex@example.com",
  createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
  resentAt: null,
  usedAt: null,
  ...over,
});

beforeEach(() => {
  team.findInviteByHash.mockReset().mockResolvedValue(found());
  team.markInviteUsed.mockReset().mockResolvedValue(4);
  db.createFundraiser.mockReset().mockResolvedValue({ id: 77, name: "Alex Example", email: "alex@example.com" });
  db.fundraisingIsOn.mockReset().mockResolvedValue(true);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("filling in the form from an invite", () => {
  it("gives the first name, surname and email exactly as staff typed them, and nothing else", async () => {
    const res = await run(postInvitePrefill, { body: { token: TOKEN } });
    expect(res.statusCode).toBe(200);
    // `name` too, so a sign up page loaded before the two boxes still fills in.
    expect(res.body).toEqual({ name: "Mary Jane Smith", firstName: "Mary Jane", lastName: "Smith", email: "alex@example.com" });
    expect(team.findInviteByHash).toHaveBeenCalledWith(hashInviteToken(TOKEN));
  });

  it("answers the same for an invite that is unknown, used, or out of date", async () => {
    const answers = [];
    team.findInviteByHash.mockResolvedValueOnce(null);
    answers.push(await run(postInvitePrefill, { body: { token: TOKEN } }));
    team.findInviteByHash.mockResolvedValueOnce(found({ usedAt: new Date() }));
    answers.push(await run(postInvitePrefill, { body: { token: TOKEN } }));
    team.findInviteByHash.mockResolvedValueOnce(found({ createdAt: new Date(Date.now() - 61 * 24 * 60 * 60 * 1000) }));
    answers.push(await run(postInvitePrefill, { body: { token: TOKEN } }));
    for (const a of answers) {
      expect(a.statusCode).toBe(404);
      expect(a.body).toEqual({ error: "That invite link has expired or already been used. You can still fill in the form." });
    }
  });

  it("does not look up anything that is not a token", async () => {
    for (const token of ["", "short", 42, null, TOKEN + "x"]) {
      expect((await run(postInvitePrefill, { body: { token } })).statusCode).toBe(404);
    }
    expect(team.findInviteByHash).not.toHaveBeenCalled();
  });

  it("limits how often one address can try", async () => {
    let last = 0;
    for (let i = 0; i < 31; i++) last = (await run(postInvitePrefill, { body: { token: TOKEN }, ip: "10.9.9.9" })).statusCode;
    expect(last).toBe(429);
  });

  it("says so when it cannot look, without failing the form", async () => {
    team.findInviteByHash.mockRejectedValue(new Error("database away"));
    expect((await run(postInvitePrefill, { body: { token: TOKEN } })).statusCode).toBe(503);
  });
});

describe("using an invite", () => {
  it("marks it used and links the sign up", async () => {
    await useInvite(TOKEN, 77);
    expect(team.markInviteUsed).toHaveBeenCalledWith(hashInviteToken(TOKEN), 77);
  });

  it("does nothing without a token, and never throws", async () => {
    await useInvite(undefined, 77);
    await useInvite("nonsense", 77);
    expect(team.markInviteUsed).not.toHaveBeenCalled();
    team.markInviteUsed.mockRejectedValue(new Error("database away"));
    await expect(useInvite(TOKEN, 77)).resolves.toBeUndefined();
  });
});

describe("a sign up made from an invite", () => {
  const signUp = {
    path: "raising",
    kind: "walk",
    title: "Alex's Walk",
    description: "Ten miles.",
    town: "Exampleton",
    targetPence: 25000,
    public: true,
    // TASK-511: the name in two boxes, and every yes or no answered.
    firstName: "Alex",
    lastName: "Example",
    email: "alex@example.com",
    phone: "07700 900456",
    socialOk: false,
    wants: { shoutOut: false, attend: false },
  };

  it("marks the invite used, linked to the new sign up", async () => {
    const res = await run(postFundraise, { body: { ...signUp, invite: TOKEN } });
    expect(res.statusCode).toBe(200);
    expect(team.markInviteUsed).toHaveBeenCalledWith(hashInviteToken(TOKEN), 77);
  });

  it("stands even when the invite cannot be marked", async () => {
    team.markInviteUsed.mockRejectedValue(new Error("database away"));
    expect((await run(postFundraise, { body: { ...signUp, invite: TOKEN } })).statusCode).toBe(200);
  });

  it("touches no invite without one", async () => {
    await run(postFundraise, { body: signUp });
    expect(team.markInviteUsed).not.toHaveBeenCalled();
  });
});
