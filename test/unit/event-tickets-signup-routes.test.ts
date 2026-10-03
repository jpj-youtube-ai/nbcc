import { describe, it, expect, vi, beforeEach } from "vitest";

// Event tickets on the sign up (POST /api/fundraise): an event choosing "NBCC sells the tickets for
// me" proposes its ticket types (and an overall limit) with the sign up, stored as PROPOSED inside
// the sign up's own transaction, for staff to approve. A problem with the tickets is named beside the
// rest of the form, and stores nothing. Never with a split to another cause. Every name is invented.

const db = vi.hoisted(() => ({ createFundraiser: vi.fn(), fundraisingIsOn: vi.fn() }));
const tickets = vi.hoisted(() => ({ insertSignUpTickets: vi.fn() }));
const send = vi.hoisted(() => ({ sendSignUpEmails: vi.fn(), fundraiserPageUrl: (s: string) => `https://nbcc.test/fundraise/${s}` }));

vi.mock("../../src/db/fundraisers", async () => {
  class FundraiserError extends Error {}
  return { ...db, FundraiserError };
});
vi.mock("../../src/db/event-tickets", () => tickets);
vi.mock("../../src/db/fundraising-categories", async () => {
  const c = await import("../../src/fundraising/categories");
  return { loadCategories: vi.fn(async () => (c.rememberCategories([...c.BUILT_IN_CATEGORIES]), c.BUILT_IN_CATEGORIES)) };
});
vi.mock("../../src/fundraising/send", () => send);
vi.mock("../../src/newsletter/self-signup", () => ({ subscribeSelf: vi.fn() }));
vi.mock("../../src/clients/turnstile", () => ({ captchaEnabled: () => false, captchaSiteKey: () => null, verifyCaptcha: vi.fn() }));
vi.mock("../../src/config", () => ({ config: { NODE_ENV: "test", PORTAL_BASE_URL: "https://nbcc.test" } }));

import { postFundraise } from "../../src/routes/fundraise";
import { NBCC_TICKETS_SHARED } from "../../src/tickets/model";

/* eslint-disable @typescript-eslint/no-explicit-any */
let ip = 0;
async function post(body: unknown) {
  const res: any = { statusCode: 200, body: undefined };
  res.status = (c: number) => ((res.statusCode = c), res);
  res.json = (b: unknown) => ((res.body = b), res);
  await postFundraise({ body, params: {}, ip: `10.8.0.${++ip}`, headers: {} } as any, res);
  return res;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const event = (over: Record<string, unknown> = {}) => ({
  path: "event",
  kind: "quiz",
  title: "Example Quiz Night",
  description: "Eight rounds and a raffle.",
  eventDate: "2099-12-05",
  startTime: "19:30",
  venue: "Example Hall",
  town: "Exampleton",
  public: true,
  firstName: "Kim",
  lastName: "Organiser",
  email: "kim@example.com",
  phone: "07700 900111",
  socialOk: false,
  over18: true,
  sharesWithOther: false,
  wants: { shoutOut: false, attend: false },
  newsletterOk: false,
  cardLine: "A quiz for NBCC.",
  booking: "nbcc",
  ticketTypes: [
    { name: "Adult", pricePence: 1000, quantity: 80 },
    { name: "Child", pricePence: 500 },
  ],
  ticketLimit: 100,
  ...over,
});

beforeEach(() => {
  for (const fn of [...Object.values(db), ...Object.values(tickets), send.sendSignUpEmails]) fn.mockReset();
  db.fundraisingIsOn.mockResolvedValue(true);
  db.createFundraiser.mockImplementation(async (s: Record<string, unknown>) => ({ id: 41, slug: "eqn", ...s }));
});

describe("an event where NBCC sells the tickets", () => {
  it("stores its ticket types and limit as proposed, in the sign up's own transaction", async () => {
    const res = await post(event());
    expect(res.statusCode).toBe(200);
    const [stored, extra] = db.createFundraiser.mock.calls[0];
    expect(stored.booking).toBe("nbcc");
    expect(typeof extra).toBe("function");
    const client = { query: vi.fn() };
    await extra(client, 41);
    expect(tickets.insertSignUpTickets).toHaveBeenCalledWith(
      client,
      41,
      {
        types: [
          { name: "Adult", pricePence: 1000, quantity: 80 },
          { name: "Child", pricePence: 500, quantity: null },
        ],
        salesLimit: 100,
        close: { mode: "start", at: null },
      },
      "kim@example.com",
    );
  });

  it("names a problem with the tickets beside the rest, and stores nothing", async () => {
    const res = await post(event({ title: "", ticketTypes: [{ name: "Adult", pricePence: 50 }] }));
    expect(res.statusCode).toBe(400);
    expect(res.body.fields).toMatchObject({ ticketTypes: "Ticket 1: the price needs to be £0 for a free ticket, or from £1 to £500." });
    expect(Object.keys(res.body.fields)).toContain("title");
    expect(db.createFundraiser).not.toHaveBeenCalled();
  });

  it("refuses it when what is raised is shared with another cause", async () => {
    const res = await post(event({ sharesWithOther: true, nbccSharePercent: 50, otherCauseName: "Exampleton Food Larder" }));
    expect(res.statusCode).toBe(400);
    expect(res.body.fields.booking).toBe(NBCC_TICKETS_SHARED);
    expect(db.createFundraiser).not.toHaveBeenCalled();
  });
});

describe("every other sign up", () => {
  it("is exactly as before, whatever ticket types were sent", async () => {
    await post(event({ booking: "door" }));
    expect(db.createFundraiser.mock.calls[0][1]).toBeUndefined();
  });
});
