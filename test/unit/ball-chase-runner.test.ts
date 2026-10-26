import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ChaseBooking } from "../../src/ball/chase";

// TASK-576: the wiring of the Festive Ball guest chase. The 8am job claims each email before it
// sends it, so a second run the same morning sends nothing; a failed send gives its claim back; and
// a send that went is never un-claimed. The database and the email client are mocked at their
// boundaries; the rules of who is chased are ball-chase.test.ts's. Every name and address is invented.

const m = vi.hoisted(() => ({
  getSettings: vi.fn(),
  listChaseBookings: vi.fn<() => Promise<ChaseBooking[]>>(),
  getChaseRecipients: vi.fn<() => Promise<Array<{ name: string; email: string }>>>(),
  claimChaseSend: vi.fn<(kind: "reminder" | "list", day: string, who: string) => Promise<number | null>>(),
  markChaseSent: vi.fn<(id: number, ids: number[]) => Promise<void>>(),
  releaseChaseClaim: vi.fn<(id: number) => Promise<void>>(),
  sendBallRunUp: vi.fn<(msg: { email: string; subject: string; from: string; replyTo: string }) => Promise<void>>(),
  sendBallChaseList: vi.fn<(msg: { to: string[]; subject: string; from: string; replyTo: string }) => Promise<void>>(),
}));

vi.mock("../../src/config", () => ({ config: { BALL_FROM_EMAIL: "events@nbcc.scot" } }));
vi.mock("../../src/ball/sales-report-runner", () => ({ BALL_DAY: "2026-11-07" }));
vi.mock("../../src/ball/run-up-runner", () => ({ guestLink: (token: string) => `https://nbcc.scot/ball/guests/${token}` }));
vi.mock("../../src/clients/email", () => ({ sendBallRunUp: m.sendBallRunUp, sendBallChaseList: m.sendBallChaseList }));
vi.mock("../../src/db/ball", () => ({ getSettings: m.getSettings }));
vi.mock("../../src/db/ball-chase", () => ({
  listChaseBookings: m.listChaseBookings,
  getChaseRecipients: m.getChaseRecipients,
  claimChaseSend: m.claimChaseSend,
  markChaseSent: m.markChaseSent,
  releaseChaseClaim: m.releaseChaseClaim,
}));

import { runBallChase } from "../../src/ball/chase-runner";

// 8am on the day, in the UK: the clocks went back on 25 October, so 08:00Z is 08:00 from then on.
const SEVEN_DAYS = new Date("2026-10-28T08:00:00Z");
const SIX_DAYS = new Date("2026-10-29T08:00:00Z");
const DEADLINE_DAY = new Date("2026-11-04T08:00:00Z");
const DEADLINE = "2026-11-04T10:00:00Z";
const MENU = "To start: Soup\nMain course: Turkey | Vegetarian wellington";
const CHOSEN = "To start: Soup\nMain course: Turkey";

const booking = (over: Partial<ChaseBooking> = {}): ChaseBooking => ({
  id: 1,
  reference: "BALL-EXAMPL",
  status: "paid",
  paymentMethod: "card",
  buyerName: "Alex Example",
  buyerFirstName: "Alex",
  buyerEmail: "alex@example.com",
  buyerPhone: "07000 000001",
  guestToken: "tok-1",
  seats: 2,
  choices: [],
  reminderSentOn: null,
  ...over,
});

const settings = (over: Record<string, unknown> = {}) => ({ guestDetailsLockAt: DEADLINE, menuOptions: MENU, ...over });
const VOLUNTEERS = [
  { name: "First Volunteer", email: "first.volunteer@nbcc.scot" },
  { name: "Second Volunteer", email: "second.volunteer@nbcc.scot" },
];

beforeEach(() => {
  vi.clearAllMocks();
  m.getSettings.mockResolvedValue(settings());
  m.listChaseBookings.mockResolvedValue([
    booking({ id: 1 }),
    booking({ id: 2, buyerEmail: "done@example.com", guestToken: "tok-2", choices: [CHOSEN, CHOSEN] }),
  ]);
  m.getChaseRecipients.mockResolvedValue([]);
  let next = 100;
  m.claimChaseSend.mockImplementation(async () => (next += 1));
  m.markChaseSent.mockResolvedValue(undefined);
  m.releaseChaseClaim.mockResolvedValue(undefined);
  m.sendBallRunUp.mockResolvedValue(undefined);
  m.sendBallChaseList.mockResolvedValue(undefined);
});

describe("a round day", () => {
  it("sends one reminder to the booker still missing something, from the Ball address, and records it", async () => {
    const result = await runBallChase(SEVEN_DAYS);
    expect(result).toEqual({ day: 7, reminders: 1, failed: 0, listSent: false });
    expect(m.claimChaseSend).toHaveBeenCalledWith("reminder", "2026-10-28", "alex@example.com");
    expect(m.sendBallRunUp).toHaveBeenCalledTimes(1);
    const sent = m.sendBallRunUp.mock.calls[0][0];
    expect(sent.email).toBe("alex@example.com");
    expect(sent.from).toBe("events@nbcc.scot");
    expect(sent.replyTo).toBe("events@nbcc.scot");
    expect(sent.subject).toBe("7 days to go: your Festive Ball guests and meals");
    expect(m.markChaseSent).toHaveBeenCalledWith(101, [1]);
  });

  it("sends nothing when the claim is already taken, so a second run the same morning does nothing", async () => {
    m.claimChaseSend.mockResolvedValue(null);
    m.getChaseRecipients.mockResolvedValue(VOLUNTEERS);
    const result = await runBallChase(SEVEN_DAYS);
    expect(result).toEqual({ day: 7, reminders: 0, failed: 0, listSent: false });
    expect(m.sendBallRunUp).not.toHaveBeenCalled();
    expect(m.sendBallChaseList).not.toHaveBeenCalled();
    expect(m.markChaseSent).not.toHaveBeenCalled();
  });

  it("leaves out a booker whose week-to-go email went this morning", async () => {
    m.listChaseBookings.mockResolvedValue([booking({ reminderSentOn: "2026-10-28" })]);
    const result = await runBallChase(SEVEN_DAYS);
    expect(result.reminders).toBe(0);
    expect(m.claimChaseSend).not.toHaveBeenCalled();
  });

  it("gives a failed send's claim back, counts it, and carries on to the next booker", async () => {
    m.listChaseBookings.mockResolvedValue([
      booking({ id: 1, buyerEmail: "one@example.com" }),
      booking({ id: 2, buyerEmail: "two@example.com", guestToken: "tok-2" }),
    ]);
    m.sendBallRunUp.mockRejectedValueOnce(new Error("provider down"));
    const result = await runBallChase(SEVEN_DAYS);
    expect(result).toEqual({ day: 7, reminders: 1, failed: 1, listSent: false });
    expect(m.releaseChaseClaim).toHaveBeenCalledWith(101);
    expect(m.markChaseSent).toHaveBeenCalledTimes(1);
    expect(m.markChaseSent).toHaveBeenCalledWith(102, [2]);
  });

  it("keeps the claim of a send that went, even when recording it fails", async () => {
    m.markChaseSent.mockRejectedValue(new Error("db hiccup"));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await runBallChase(SEVEN_DAYS);
    log.mockRestore();
    expect(result.reminders).toBe(1);
    expect(m.releaseChaseClaim).not.toHaveBeenCalled();
  });

  it("covers every incomplete booking of one booker in one email", async () => {
    m.listChaseBookings.mockResolvedValue([booking({ id: 1 }), booking({ id: 3, reference: "BALL-OTHER", guestToken: "tok-3" })]);
    await runBallChase(SEVEN_DAYS);
    expect(m.sendBallRunUp).toHaveBeenCalledTimes(1);
    expect(m.markChaseSent).toHaveBeenCalledWith(101, [1, 3]);
  });
});

describe("the volunteers' list", () => {
  beforeEach(() => m.getChaseRecipients.mockResolvedValue(VOLUNTEERS));

  it("goes as one email to every volunteer, after the reminders, claimed for the whole day", async () => {
    const result = await runBallChase(SEVEN_DAYS);
    expect(result).toEqual({ day: 7, reminders: 1, failed: 0, listSent: true });
    expect(m.claimChaseSend).toHaveBeenNthCalledWith(1, "reminder", "2026-10-28", "alex@example.com");
    expect(m.claimChaseSend).toHaveBeenNthCalledWith(2, "list", "2026-10-28", "*");
    expect(m.sendBallChaseList).toHaveBeenCalledTimes(1);
    const sent = m.sendBallChaseList.mock.calls[0][0];
    expect(sent.to).toEqual(["first.volunteer@nbcc.scot", "second.volunteer@nbcc.scot"]);
    expect(sent.from).toBe("events@nbcc.scot");
    expect(sent.replyTo).toBe("events@nbcc.scot");
    expect(sent.subject).toBe("Festive Ball chase list: 1 booking to chase, 7 days to go");
    expect(m.markChaseSent).toHaveBeenLastCalledWith(102, [1]);
  });

  it("reads the bookings again for the list, so it shows this morning's state", async () => {
    await runBallChase(SEVEN_DAYS);
    expect(m.listChaseBookings).toHaveBeenCalledTimes(2);
  });

  it("goes on the deadline morning with no reminder", async () => {
    const result = await runBallChase(DEADLINE_DAY);
    expect(result).toEqual({ day: 0, reminders: 0, failed: 0, listSent: true });
    expect(m.sendBallRunUp).not.toHaveBeenCalled();
    expect(m.claimChaseSend).toHaveBeenCalledTimes(1);
    expect(m.claimChaseSend).toHaveBeenCalledWith("list", "2026-11-04", "*");
    expect(m.sendBallChaseList.mock.calls[0][0].subject).toBe("Festive Ball chase list: 1 booking to chase before 10am today");
  });

  it("gives its claim back when it fails, and does not throw", async () => {
    m.sendBallChaseList.mockRejectedValue(new Error("provider down"));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await runBallChase(SEVEN_DAYS);
    log.mockRestore();
    expect(result.listSent).toBe(false);
    expect(m.releaseChaseClaim).toHaveBeenCalledWith(102);
  });

  it("is not sent a second time the same morning", async () => {
    m.claimChaseSend.mockImplementation(async (kind) => (kind === "list" ? null : 101));
    const result = await runBallChase(SEVEN_DAYS);
    expect(result.listSent).toBe(false);
    expect(m.sendBallChaseList).not.toHaveBeenCalled();
  });

  it("is skipped, with no claim, when nobody is on the volunteers' list", async () => {
    m.getChaseRecipients.mockResolvedValue([]);
    const result = await runBallChase(SEVEN_DAYS);
    expect(result.listSent).toBe(false);
    expect(m.claimChaseSend).toHaveBeenCalledTimes(1);
    expect(m.sendBallChaseList).not.toHaveBeenCalled();
  });
});

describe("a day with nothing to send", () => {
  it("sends nothing on a day that is not a round one", async () => {
    m.getChaseRecipients.mockResolvedValue(VOLUNTEERS);
    expect(await runBallChase(SIX_DAYS)).toEqual({ day: null, reminders: 0, failed: 0, listSent: false });
    expect(m.listChaseBookings).not.toHaveBeenCalled();
    expect(m.claimChaseSend).not.toHaveBeenCalled();
  });

  it("sends nothing with no deadline set", async () => {
    m.getSettings.mockResolvedValue(settings({ guestDetailsLockAt: null }));
    m.getChaseRecipients.mockResolvedValue(VOLUNTEERS);
    expect(await runBallChase(SEVEN_DAYS)).toEqual({ day: null, reminders: 0, failed: 0, listSent: false });
    expect(m.claimChaseSend).not.toHaveBeenCalled();
  });

  it("sends nothing after the deadline day", async () => {
    expect((await runBallChase(new Date("2026-11-05T08:00:00Z"))).day).toBeNull();
    expect(m.sendBallRunUp).not.toHaveBeenCalled();
  });

  it("sends nothing on the Ball day, even with a deadline set after it", async () => {
    m.getSettings.mockResolvedValue(settings({ guestDetailsLockAt: "2026-11-07T10:00:00Z" }));
    expect((await runBallChase(new Date("2026-11-07T08:00:00Z"))).day).toBeNull();
  });
});

describe("with no menu to choose from", () => {
  it("reminds only about names", async () => {
    m.getSettings.mockResolvedValue(settings({ menuOptions: null }));
    m.listChaseBookings.mockResolvedValue([
      booking({ id: 1 }),
      booking({ id: 2, buyerEmail: "named@example.com", guestToken: "tok-2", choices: [null, null] }),
    ]);
    await runBallChase(SEVEN_DAYS);
    expect(m.sendBallRunUp).toHaveBeenCalledTimes(1);
    expect(m.sendBallRunUp.mock.calls[0][0].email).toBe("alex@example.com");
  });
});
