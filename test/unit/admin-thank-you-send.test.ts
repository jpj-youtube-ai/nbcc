import { describe, it, expect, vi, beforeEach } from "vitest";

// POST /api/admin/thank-you/send says truthfully whether the email went (admin refresh, 2026-11-14).
//
// It used to record the letter, mark the donor thanked, then try the email and swallow a failure, so
// the reply was a 201 either way and the screen said "Sent" for a letter that never left. Now the
// email is sent as part of recording the letter (src/db/thank-you.ts rolls the row back if it fails):
// a 201 carries emailed: true, and a failed email is a 502 that says nothing was recorded.
//
// The data layer and the mailer are mocked: this is the route's own behaviour. Every name and
// address is invented.

const { recordMock, sendMock, getUserAuthRowMock } = vi.hoisted(() => ({
  recordMock: vi.fn(),
  sendMock: vi.fn(),
  getUserAuthRowMock: vi.fn(),
}));
vi.mock("../../src/db/thank-you", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  recordThankYouSent: recordMock,
}));
vi.mock("../../src/clients/email", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  sendThankYou: sendMock,
}));
vi.mock("../../src/db/admin-users", () => ({ getUserAuthRow: getUserAuthRowMock }));
vi.mock("../../src/config", () => ({
  config: {
    NODE_ENV: "development",
    DATABASE_URL: "postgres://localhost:5432/test",
    ADMIN_SESSION_SECRET: "test-admin-secret",
    STRIPE_SECRET_KEY: "sk_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    STRIPE_WEBHOOK_SECRET: "whsec_placeholder",
    PORTAL_BASE_URL: "https://portal.example.com",
    GIVING_FROM_EMAIL: "giving@example.com",
  },
}));
vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));

import { postAdminThankYouSend } from "../../src/routes/admin";
import { signAdminSession } from "../../src/admin/session";

const SECRET = "test-admin-secret";
const tokenFor = (role: string) => {
  getUserAuthRowMock.mockResolvedValue({ id: 1, email: "fern@example.com", status: "active", role, permissions: {} });
  return signAdminSession({ sub: 1, email: "fern@example.com", role, now: new Date(), secret: SECRET }).token;
};

type MockRes = { statusCode: number; body: Record<string, unknown>; status: (c: number) => MockRes; json: (b: unknown) => MockRes };
function mockRes(): MockRes {
  const res = { statusCode: 200, body: {} } as MockRes;
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b as Record<string, unknown>; return res; };
  return res;
}
const letter = (over: Record<string, unknown> = {}) => ({
  donorId: 7,
  thankYouName: "Rowan Example",
  addressedTo: "Rowan",
  recipientEmail: "rowan@example.com",
  giftType: "money",
  giftAmountPence: 150000,
  giftInKind: null,
  giftAided: true,
  personalMessage: null,
  signedByName: "Fern Example",
  signedByRole: "Trustee",
  letterDate: "14 November 2026",
  ccEmail: null,
  ...over,
});
async function send(body: unknown, role = "editor") {
  const res = mockRes();
  const req = { headers: { authorization: "Bearer " + tokenFor(role) }, body, query: {}, params: {} };
  await postAdminThankYouSend(req as never, res as never);
  return res;
}

beforeEach(() => {
  recordMock.mockReset();
  sendMock.mockReset();
  // What the real recordThankYouSent does with the send it is handed: runs it with the new letter's
  // id, and if it throws, keeps nothing and lets the failure through.
  recordMock.mockImplementation(async (_input: unknown, emailIt?: (id: number) => Promise<void>) => {
    if (emailIt) await emailIt(41);
    return 41;
  });
  sendMock.mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("POST /api/admin/thank-you/send", () => {
  it("says the email went, with the letter's number and its gift in words", async () => {
    const res = await send(letter());
    expect(res.statusCode).toBe(201);
    expect(res.body).toEqual({ id: 41, giftSummary: "£1500.00 (Gift Aided)", emailed: true });
  });

  it("emails the donor as part of recording the letter, never after it", async () => {
    await send(letter());
    expect(recordMock).toHaveBeenCalledTimes(1);
    // The send is handed to the data layer, which runs it before it commits.
    expect(typeof recordMock.mock.calls[0][1]).toBe("function");
    expect(sendMock).toHaveBeenCalledTimes(1);
    const mail = sendMock.mock.calls[0][0] as { email: string; from: string; subject: string; html: string };
    expect(mail.email).toBe("rowan@example.com");
    expect(mail.from).toBe("giving@example.com");
    expect(mail.subject).toBe("Thank you, Rowan Example");
    // The link to print the letter is signed from the id of the row just written.
    expect(mail.html).toContain("https://portal.example.com/thank-you/letter/");
  });

  it("says the email did not go, and that nothing was recorded, when the mail service refuses it", async () => {
    sendMock.mockRejectedValue(new Error("the mail service said no"));
    const res = await send(letter());
    expect(res.statusCode).toBe(502);
    expect(res.body.emailed).toBe(false);
    expect(res.body.recorded).toBe(false);
    expect(res.body.error).toBe("The email could not be sent. Nothing has been recorded.");
    expect(res.body.id).toBeUndefined();
  });

  it("counts a mail call that has not answered in 15 seconds as an email that did not go, and lets go of the record", async () => {
    vi.useFakeTimers();
    try {
      sendMock.mockImplementation(() => new Promise(() => undefined)); // the mail service never answers
      const pending = send(letter());
      await vi.advanceTimersByTimeAsync(14_999);
      let settled = false;
      pending.then(() => (settled = true));
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      const res = await pending;
      expect(res.statusCode).toBe(502);
      expect(res.body).toMatchObject({ emailed: false, recorded: false });
    } finally {
      vi.useRealTimers();
    }
  });

  it("says the email went but was not recorded when keeping the record fails after the send", async () => {
    recordMock.mockImplementation(async (_input: unknown, emailIt?: (id: number) => Promise<void>) => {
      if (emailIt) await emailIt(41);
      throw new Error("the commit failed"); // the audit insert or COMMIT, after the email has gone
    });
    const res = await send(letter());
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(500);
    expect(res.body).toMatchObject({ emailed: true, recorded: false });
    expect(String(res.body.error)).toContain("The email went");
  });

  it("does not blame the email when it was the database that failed", async () => {
    recordMock.mockRejectedValue(new Error("connection refused"));
    const res = await send(letter());
    expect(res.statusCode).toBe(500);
    expect(res.body.emailed).toBeUndefined();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("still refuses a letter with no real email address before anything is written or sent", async () => {
    const res = await send(letter({ recipientEmail: "not-an-email" }));
    expect(res.statusCode).toBe(400);
    expect(recordMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("still refuses someone who may only look", async () => {
    const res = await send(letter(), "viewer");
    expect(res.statusCode).toBe(403);
    expect(recordMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("copies in the address it was given, and keeps it on the record", async () => {
    await send(letter({ ccEmail: "colleague@example.com" }));
    expect((recordMock.mock.calls[0][0] as { ccEmail: string }).ccEmail).toBe("colleague@example.com");
    expect((sendMock.mock.calls[0][0] as { cc: string }).cc).toBe("colleague@example.com");
  });
});
