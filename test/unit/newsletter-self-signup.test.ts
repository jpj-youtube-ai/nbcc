import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-493: someone joining the newsletter themselves, from the footer form (TASK-261) or the
// fundraising sign up's tick box. One path for both, so they are handled exactly alike: the
// NEWSLETTER list, consent_source 'footer' (a self signup), allowed to revive their own earlier
// opt out, deduped by address, and the welcome email (TASK-276), recorded in the audit log. Every
// name and address here is invented.

const lists = vi.hoisted(() => ({
  getSubscriberListBySlug: vi.fn(),
  addListSubscriber: vi.fn(),
  getListMemberByEmail: vi.fn(),
}));
const { sendNewsletter, recordAudit } = vi.hoisted(() => ({ sendNewsletter: vi.fn(), recordAudit: vi.fn() }));

vi.mock("../../src/db/subscriber-lists", () => lists);
vi.mock("../../src/clients/email", () => ({ sendNewsletter }));
vi.mock("../../src/db/donations", () => ({ recordAudit }));
vi.mock("../../src/config", () => ({
  config: {
    NODE_ENV: "test",
    ADMIN_SESSION_SECRET: "test-secret",
    PORTAL_BASE_URL: "https://nbcc.test",
    NEWSLETTER_FROM_EMAIL: "newsletter@news.nbcc.test",
    NEWSLETTER_REPLY_TO_EMAIL: "newsletter@nbcc.test",
  },
}));

import { subscribeSelf } from "../../src/newsletter/self-signup";

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  for (const fn of Object.values(lists)) fn.mockReset();
  sendNewsletter.mockReset().mockResolvedValue(undefined);
  recordAudit.mockReset().mockResolvedValue(undefined);
  lists.getSubscriberListBySlug.mockResolvedValue({ id: 3, slug: "newsletter" });
  lists.getListMemberByEmail.mockResolvedValue({ id: 41, name: "Robin Testperson", email: "robin@example.com" });
});

describe("joining the newsletter yourself", () => {
  it("adds you to the newsletter list as a self signup that may revive an old opt out", async () => {
    lists.addListSubscriber.mockResolvedValue("added");
    const outcome = await subscribeSelf({ name: "Robin Testperson", email: "robin@example.com", phone: "07700 900123" });
    expect(outcome).toBe("added");
    expect(lists.getSubscriberListBySlug).toHaveBeenCalledWith("newsletter");
    expect(lists.addListSubscriber).toHaveBeenCalledWith(
      3,
      { name: "Robin Testperson", email: "robin@example.com", phone: "07700 900123" },
      "footer",
      { revive: true },
    );
  });

  it("sends the welcome email, with its one click unsubscribe, and records it", async () => {
    lists.addListSubscriber.mockResolvedValue("added");
    await subscribeSelf({ name: "Robin Testperson", email: "robin@example.com", phone: null });
    await flush();
    expect(sendNewsletter).toHaveBeenCalledTimes(1);
    const msg = sendNewsletter.mock.calls[0][0];
    expect(msg.email).toBe("robin@example.com");
    expect(msg.unsubscribeUrl).toMatch(/^https:\/\/nbcc\.test\/unsubscribe\//);
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "welcome.sent", entityId: 41 }));
  });

  it("does not add an address already on the list twice (the list dedupes it)", async () => {
    lists.addListSubscriber.mockResolvedValue("exists");
    expect(await subscribeSelf({ name: "Robin Testperson", email: "robin@example.com", phone: null })).toBe("exists");
  });

  it("says so when the newsletter list is missing, adding nobody", async () => {
    lists.getSubscriberListBySlug.mockResolvedValue(null);
    expect(await subscribeSelf({ name: "Robin Testperson", email: "robin@example.com", phone: null })).toBe("no_list");
    expect(lists.addListSubscriber).not.toHaveBeenCalled();
    expect(sendNewsletter).not.toHaveBeenCalled();
  });

  it("keeps the person subscribed when the welcome fails to send", async () => {
    lists.addListSubscriber.mockResolvedValue("added");
    sendNewsletter.mockRejectedValue(new Error("provider down"));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await subscribeSelf({ name: "Robin Testperson", email: "robin@example.com", phone: null })).toBe("added");
    await flush();
    quiet.mockRestore();
  });
});
