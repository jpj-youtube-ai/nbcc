import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-507: the preference centre records an address level opt out, as well as everything it did
// before. "Stop all emails" adds the address (kind "all"), whether or not it has a donor row;
// turning thank yous off adds it (kind "thank_you"); turning thank yous back on lifts it. The
// database is mocked; the token is signed as the real one is. Every address here is invented.

const { query, newsletters, lists, optOuts } = vi.hoisted(() => ({
  query: vi.fn(),
  newsletters: { donorConsentForEmail: vi.fn(), setDonorConsents: vi.fn() },
  lists: { listMembershipsForEmail: vi.fn(), unsubscribeListMember: vi.fn(), listOfferableLists: vi.fn(), addListSubscriber: vi.fn() },
  optOuts: { addOptOut: vi.fn(), liftOptOut: vi.fn() },
}));
vi.mock("../../src/db/pool", () => ({ pool: { query, connect: vi.fn() } }));
vi.mock("../../src/db/newsletters", () => newsletters);
vi.mock("../../src/db/subscriber-lists", () => lists);
vi.mock("../../src/db/email-opt-outs", () => optOuts);
vi.mock("../../src/config", () => ({ config: { NODE_ENV: "test", ADMIN_SESSION_SECRET: "a-test-secret" } }));

import { postPreferences } from "../../src/routes/preferences";
import { signUnsubscribeToken } from "../../src/donors/unsubscribe-token";

const TOKEN = signUnsubscribeToken(5, "a-test-secret");

function mockRes() {
  const res = { statusCode: 200, html: "" } as { statusCode: number; html: string; status: (c: number) => unknown; type: (t: string) => unknown; send: (b: string) => unknown };
  res.status = (c: number) => ((res.statusCode = c), res);
  res.type = () => res;
  res.send = (b: string) => ((res.html = b), res);
  return res;
}
/* eslint-disable @typescript-eslint/no-explicit-any */
async function post(body: Record<string, unknown>) {
  const res = mockRes();
  await postPreferences({ params: { token: TOKEN }, body } as any, res as any);
  return res;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

beforeEach(() => {
  query.mockReset().mockResolvedValue({ rows: [{ email: "robin@example.com" }] });
  for (const fn of [...Object.values(newsletters), ...Object.values(lists), ...Object.values(optOuts)]) fn.mockReset();
  newsletters.donorConsentForEmail.mockResolvedValue({ id: 5, emailConsent: true, thankyouConsent: true });
  lists.listMembershipsForEmail.mockResolvedValue([{ id: 11, listId: 3, listName: "Volunteers" }]);
  lists.listOfferableLists.mockResolvedValue([]);
  optOuts.addOptOut.mockResolvedValue(true);
  optOuts.liftOptOut.mockResolvedValue(true);
});

describe("the preference centre and the opt out list", () => {
  it("Stop all emails still stops everything, and now also records the address as opted out", async () => {
    await post({ all: "off" });
    expect(lists.unsubscribeListMember).toHaveBeenCalledWith(11);
    expect(newsletters.setDonorConsents).toHaveBeenCalledWith("robin@example.com", { newsletter: false, thankYou: false });
    expect(optOuts.addOptOut).toHaveBeenCalledWith("robin@example.com", "all", "preferences");
    expect(optOuts.liftOptOut).not.toHaveBeenCalled();
  });

  it("records the opt out before the consents, so a failure part way never loses it", async () => {
    const order: string[] = [];
    optOuts.addOptOut.mockImplementation(async () => (order.push("opt out"), true));
    newsletters.setDonorConsents.mockImplementation(async () => (order.push("consents"), undefined));
    lists.unsubscribeListMember.mockImplementation(async () => (order.push("lists"), null));
    await post({ all: "off" });
    expect(order[0]).toBe("opt out");
  });

  it("still saves the rest and shows the saved page when the opt out cannot be written, and says so loudly", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    optOuts.addOptOut.mockRejectedValue(new Error("db down"));
    const res = await post({ all: "off" });
    expect(res.statusCode).toBe(200);
    expect(newsletters.setDonorConsents).toHaveBeenCalledWith("robin@example.com", { newsletter: false, thankYou: false });
    expect(lists.unsubscribeListMember).toHaveBeenCalledWith(11);
    expect(String(err.mock.calls[0]?.[0])).toMatch(/opt out/i);
    err.mockRestore();
  });

  it("records Stop all emails for an address with no donor row too", async () => {
    newsletters.donorConsentForEmail.mockResolvedValue(null);
    await post({ all: "off" });
    expect(newsletters.setDonorConsents).not.toHaveBeenCalled();
    expect(optOuts.addOptOut).toHaveBeenCalledWith("robin@example.com", "all", "preferences");
  });

  it("records thank yous turned off", async () => {
    await post({ newsletter: "on", keep: "3" });
    expect(newsletters.setDonorConsents).toHaveBeenCalledWith("robin@example.com", { newsletter: true, thankYou: false });
    expect(optOuts.addOptOut).toHaveBeenCalledWith("robin@example.com", "thank_you", "preferences");
  });

  it("lifts the opt out when thank yous are turned back on", async () => {
    await post({ thankyou: "on" });
    expect(optOuts.liftOptOut).toHaveBeenCalledWith("robin@example.com", "preferences");
    expect(optOuts.addOptOut).not.toHaveBeenCalled();
  });

  it("changes nothing on the list for a subscriber with no donor row who keeps their lists", async () => {
    newsletters.donorConsentForEmail.mockResolvedValue(null);
    await post({ keep: "3" });
    expect(optOuts.addOptOut).not.toHaveBeenCalled();
    expect(optOuts.liftOptOut).not.toHaveBeenCalled();
  });

  it("refuses a token that is not ours, and records nothing", async () => {
    const res = mockRes();
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    await postPreferences({ params: { token: "5.bad" }, body: { all: "off" } } as any, res as any);
    expect(res.statusCode).toBe(400);
    expect(optOuts.addOptOut).not.toHaveBeenCalled();
  });
});
