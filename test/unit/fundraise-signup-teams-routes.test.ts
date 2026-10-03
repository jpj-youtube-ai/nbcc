import { describe, it, expect, vi, beforeEach } from "vitest";

// Team pages (Jaimie, 2026-10-03): the sign up's "Just me, or a team?" on the server. A team is
// stored as a team, with its split mode and the people added HELD (inside the sign up's own
// transaction, so a sign up is never half a team); a problem with any person added names its own box
// and stores nothing; an event is never a team. Every name and address here is invented.

const db = vi.hoisted(() => ({ createFundraiser: vi.fn(), fundraisingIsOn: vi.fn() }));
const teams = vi.hoisted(() => ({ markTeam: vi.fn(), insertHeldInvites: vi.fn() }));
const send = vi.hoisted(() => ({ sendSignUpEmails: vi.fn(), fundraiserPageUrl: (s: string) => `https://nbcc.test/fundraise/${s}` }));

vi.mock("../../src/db/fundraisers", async () => {
  class FundraiserError extends Error {}
  return { ...db, FundraiserError };
});
vi.mock("../../src/db/fundraising-teams", () => teams);
vi.mock("../../src/db/fundraising-categories", async () => {
  const c = await import("../../src/fundraising/categories");
  return { loadCategories: vi.fn(async () => (c.rememberCategories([...c.BUILT_IN_CATEGORIES]), c.BUILT_IN_CATEGORIES)) };
});
vi.mock("../../src/fundraising/send", () => send);
vi.mock("../../src/newsletter/self-signup", () => ({ subscribeSelf: vi.fn() }));
vi.mock("../../src/clients/turnstile", () => ({ captchaEnabled: () => false, captchaSiteKey: () => null, verifyCaptcha: vi.fn() }));
vi.mock("../../src/config", () => ({ config: { NODE_ENV: "test", PORTAL_BASE_URL: "https://nbcc.test" } }));

import { postFundraise } from "../../src/routes/fundraise";

/* eslint-disable @typescript-eslint/no-explicit-any */
let ip = 0;
async function post(body: unknown) {
  const res: any = { statusCode: 200, body: undefined };
  res.status = (c: number) => ((res.statusCode = c), res);
  res.json = (b: unknown) => ((res.body = b), res);
  await postFundraise({ body, params: {}, ip: `10.9.0.${++ip}`, headers: {} } as any, res);
  return res;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const signUp = (over: Record<string, unknown> = {}) => ({
  path: "raising",
  kind: "santa_dash",
  title: "Exampleton Juniors",
  description: "The under 12s, dashing in Santa suits.",
  eventDate: "2026-12-05",
  startTime: "",
  venue: "",
  town: "Exampleton",
  targetPence: 200000,
  public: true,
  firstName: "Robin",
  lastName: "Organiser",
  email: "robin@example.com",
  phone: "07700 900111",
  socialOk: false,
  over18: true,
  sharesWithOther: false,
  wants: { shoutOut: false, attend: false },
  // The sign up tidy (Jaimie, 2026-10-03): every new sign up gives an address, for the welcome pack,
  // and someone sharing ticks to say the split is right.
  postLine1: "1 Example Road",
  postTown: "Exampleton",
  postPostcode: "EX1 1EX",
  splitConfirmed: true,
  newsletterOk: false,
  ...over,
});

const people = [
  { firstName: "Ava", lastName: "Example", email: "ava@example.com" },
  { firstName: "Jack", lastName: "Sample", email: "parent@example.com" },
];

beforeEach(() => {
  for (const fn of [...Object.values(db), ...Object.values(teams), send.sendSignUpEmails]) fn.mockReset();
  db.fundraisingIsOn.mockResolvedValue(true);
  db.createFundraiser.mockImplementation(async (s: Record<string, unknown>) => ({ id: 40, slug: "ej", ...s }));
});

describe("a team's sign up", () => {
  it("is stored as a team, its split mode and the people added held, in the sign up's own transaction", async () => {
    const res = await post(signUp({ team: "team", sharesWithOther: true, nbccSharePercent: 50, otherCauseName: "Exampleton Food Larder", teamShareMode: "team", teamMembers: people }));
    expect(res.statusCode).toBe(200);
    const [, extra] = db.createFundraiser.mock.calls[0];
    expect(typeof extra).toBe("function");
    const client = { query: vi.fn() };
    await extra(client, 40);
    expect(teams.markTeam).toHaveBeenCalledWith(client, 40, "team");
    expect(teams.insertHeldInvites).toHaveBeenCalledWith(client, 40, people);
  });

  it("tells the events inbox it is a team, with who is to be invited", async () => {
    await post(signUp({ team: "team", teamMembers: people }));
    expect(send.sendSignUpEmails).toHaveBeenCalledWith(expect.objectContaining({ id: 40 }), { isTeam: true, shareMode: null, members: people });
  });

  it("refuses a half filled person, naming the box, and stores nothing", async () => {
    const res = await post(signUp({ team: "team", teamMembers: [people[0], { firstName: "Cal", lastName: "", email: "x" }] }));
    expect(res.statusCode).toBe(400);
    expect(res.body.fields).toMatchObject({ "teamMembers.1.lastName": "Add their surname.", "teamMembers.1.email": "Check this email address." });
    expect(db.createFundraiser).not.toHaveBeenCalled();
  });

  it("names the team's problems beside the sign up's own, all at once", async () => {
    const res = await post(signUp({ team: "team", title: "", sharesWithOther: true, nbccSharePercent: 50, otherCauseName: "X" }));
    expect(res.statusCode).toBe(400);
    expect(Object.keys(res.body.fields)).toEqual(expect.arrayContaining(["title", "teamShareMode"]));
  });

  it("leaves just me, and every event, exactly as before", async () => {
    await post(signUp({ team: "me" }));
    expect(db.createFundraiser.mock.calls[0][1]).toBeUndefined();
    await post(signUp({ path: "event", kind: "quiz", venue: "Example Hall", cardLine: "A quiz.", booking: "free", team: "team", teamMembers: people }));
    expect(db.createFundraiser.mock.calls[1][1]).toBeUndefined();
    expect(send.sendSignUpEmails.mock.calls[1][1]).toBeUndefined();
  });
});
