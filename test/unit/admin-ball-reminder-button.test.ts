import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The staff "Send the reminder" button (POST /api/admin/ball/reminders) behaves as it always did:
// everyone paid who has not had the reminder, each stamped as it sends, a failure stepped over.
// The one change (the charity, 2026-10-04): the email says the TRUE time to go on the day it is
// pressed. "A week to go" exactly a week before; otherwise "10 days to go", "4 days to go" or
// "Tomorrow". The database and the mailer are mocked. Every name and address here is invented.

const m = vi.hoisted(() => ({
  listBookingsNeedingReminder: vi.fn(),
  markReminderSent: vi.fn(),
  getSettings: vi.fn(),
  sendBallReminder: vi.fn(),
  recordAudit: vi.fn(),
  getUserAuthRow: vi.fn(),
}));
vi.mock("../../src/db/ball", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/db/ball")>()),
  listBookingsNeedingReminder: m.listBookingsNeedingReminder,
  markReminderSent: m.markReminderSent,
  getSettings: m.getSettings,
}));
vi.mock("../../src/clients/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/clients/email")>()),
  sendBallReminder: m.sendBallReminder,
}));
vi.mock("../../src/db/donations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/db/donations")>()),
  recordAudit: m.recordAudit,
}));
vi.mock("../../src/db/admin-users", () => ({ getUserAuthRow: m.getUserAuthRow }));
vi.mock("../../src/config", () => ({
  config: {
    NODE_ENV: "development",
    DATABASE_URL: "postgres://localhost:5432/test",
    ADMIN_SESSION_SECRET: "test-admin-secret",
    STRIPE_SECRET_KEY: "sk_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    STRIPE_WEBHOOK_SECRET: "whsec_placeholder",
    BALL_BASE_URL: "https://nbcc.test",
    BALL_FROM_EMAIL: "events@nbcc.test",
  },
}));
vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));

import { postAdminBallReminders } from "../../src/routes/admin";
import { signAdminSession } from "../../src/admin/session";

const target = (id: number, email: string) => ({
  id, reference: `BALL-EXAMP${id}`, buyerName: "Alex Example", buyerFirstName: "Alex", buyerEmail: email, seats: 2, tableName: null, guestToken: "tok",
  guests: [{ fullName: "Alex Example", dietary: null, accessNeeds: null, menuChoice: null }],
});

async function press() {
  m.getUserAuthRow.mockResolvedValue({ id: 2, email: "staff@example.com", status: "active", role: "admin", permissions: {} });
  const token = signAdminSession({ sub: 2, email: "staff@example.com", role: "admin", now: new Date(), secret: "test-admin-secret" }).token;
  const res = { statusCode: 200, body: undefined as unknown, status(c: number) { this.statusCode = c; return this; }, json(b: unknown) { this.body = b; return this; } };
  await postAdminBallReminders({ headers: { authorization: `Bearer ${token}` }, params: {}, body: {}, query: {} } as never, res as never);
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  m.getSettings.mockResolvedValue({ arrivalTime: "7pm for 7.30pm", includedNote: null });
  m.listBookingsNeedingReminder.mockResolvedValue([target(1, "alex@example.com"), target(2, "robin@example.com")]);
  m.sendBallReminder.mockResolvedValue(undefined);
  m.markReminderSent.mockResolvedValue(undefined);
  m.recordAudit.mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());

describe("the Send the reminder button, after the Ball", () => {
  it.each(["2026-11-08T00:30:00Z", "2026-11-09T10:00:00Z", "2026-12-01T10:00:00Z"])("pressed at %s it is refused, plainly, and sends nothing", async (now) => {
    vi.setSystemTime(new Date(now));
    const res = await press();
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: "The Ball has been and gone, so the reminder was not sent." });
    expect(m.sendBallReminder).not.toHaveBeenCalled();
    expect(m.markReminderSent).not.toHaveBeenCalled();
    expect(m.listBookingsNeedingReminder).not.toHaveBeenCalled();
    expect(m.recordAudit).not.toHaveBeenCalled();
  });
});

describe("the Send the reminder button", () => {
  it("still sends to everyone who has not had it, stamping each as it sends", async () => {
    vi.setSystemTime(new Date("2026-10-31T10:00:00Z"));
    const res = await press();
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ sent: 2, failed: [] });
    expect(m.sendBallReminder.mock.calls.map((c) => c[0].email)).toEqual(["alex@example.com", "robin@example.com"]);
    expect(m.markReminderSent.mock.calls.map((c) => c[0])).toEqual([1, 2]);
  });

  it("still steps over a send that fails, without stamping it", async () => {
    vi.setSystemTime(new Date("2026-10-31T10:00:00Z"));
    m.sendBallReminder.mockRejectedValueOnce(new Error("mail down"));
    const res = await press();
    expect(res.body).toEqual({ sent: 1, failed: ["BALL-EXAMP1"] });
    expect(m.markReminderSent.mock.calls.map((c) => c[0])).toEqual([2]);
  });

  it.each([
    ["2026-10-28T10:00:00Z", "10 days to go: you're coming to the ball, BALL-EXAMP1", "In 10 days you'll be with us"],
    ["2026-10-31T10:00:00Z", "A week to go: you're coming to the ball, BALL-EXAMP1", "A week on Saturday you'll be with us"],
    ["2026-11-03T10:00:00Z", "4 days to go: you're coming to the ball, BALL-EXAMP1", "In 4 days you'll be with us"],
    ["2026-11-06T10:00:00Z", "Tomorrow: you're coming to the ball, BALL-EXAMP1", "Tomorrow you'll be with us"],
    // On the day of the Ball itself it never says "A week to go".
    ["2026-11-07T10:00:00Z", "Today: you're coming to the ball, BALL-EXAMP1", "Today you'll be with us"],
    ["2026-11-07T23:30:00Z", "Today: you're coming to the ball, BALL-EXAMP1", "Today you'll be with us"],
  ])("pressed at %s it says the true time to go", async (now, subject, sentence) => {
    vi.setSystemTime(new Date(now));
    await press();
    const sent = m.sendBallReminder.mock.calls[0][0];
    expect(sent.subject).toBe(subject);
    expect(sent.html).toContain(sentence);
    expect(sent.text).toContain(sentence);
  });
});
