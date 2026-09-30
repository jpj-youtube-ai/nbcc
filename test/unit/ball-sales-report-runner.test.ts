import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SalesInputs } from "../../src/ball/sales-report";

// TASK-464: the wiring of the Festive Ball ticket report. The 8am job claims the day, counts, sends
// one email to everyone on the list, and records what went; a test goes only to the person asking.
// The database and the email client are mocked at their boundaries, so this pins what happens when
// each step fails. Every address here is invented.

const m = vi.hoisted(() => ({
  getReportSettings: vi.fn(),
  scheduledSendExists: vi.fn<(day: string) => Promise<boolean>>(),
  claimScheduledSend: vi.fn<(day: string, by: string) => Promise<number | null>>(),
  lastCountedTo: vi.fn<() => Promise<Date | null>>(),
  readSalesInputs: vi.fn<(now: Date, since: Date | null) => Promise<SalesInputs>>(),
  markSendSent: vi.fn<(id: number, to: string[], figures: SalesInputs, countedTo: Date) => Promise<void>>(),
  releaseClaim: vi.fn<(id: number) => Promise<void>>(),
  recordTestSend: vi.fn<(day: string, to: string, figures: SalesInputs, actor: string) => Promise<void>>(),
  sendBallReport: vi.fn<(msg: { to: string[]; subject: string; from: string; replyTo: string }) => Promise<void>>(),
}));

vi.mock("../../src/config", () => ({ config: { BALL_FROM_EMAIL: "events@nbcc.scot" } }));
vi.mock("../../src/ball/run-up-runner", () => ({ BALL_EVENT_DATE: new Date("2026-11-07T19:00:00Z") }));
vi.mock("../../src/clients/email", () => ({ sendBallReport: m.sendBallReport }));
vi.mock("../../src/db/ball-report", () => ({
  getReportSettings: m.getReportSettings,
  scheduledSendExists: m.scheduledSendExists,
  claimScheduledSend: m.claimScheduledSend,
  lastCountedTo: m.lastCountedTo,
  readSalesInputs: m.readSalesInputs,
  markSendSent: m.markSendSent,
  releaseClaim: m.releaseClaim,
  recordTestSend: m.recordTestSend,
}));

import { runBallSalesReport, sendTestReport } from "../../src/ball/sales-report-runner";

const TUESDAY_8AM = new Date("2026-10-06T07:00:00Z"); // 8am in the UK
const WEDNESDAY_8AM = new Date("2026-10-07T07:00:00Z");
const LAST_COUNTED = new Date("2026-10-01T07:00:02Z");
const INPUTS: SalesInputs = {
  totalSeats: 400,
  seatsSold: 212,
  tablesSold: 14,
  singleSeatsSold: 72,
  seatsRemaining: 168,
  tablesRemaining: 12,
  heldSeats: 20,
  soldSinceLast: 18,
  soldLast7Days: 30,
  soldPrevious7Days: 22,
  waitingList: 0,
  waitingSeats: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  m.getReportSettings.mockResolvedValue({
    reportOn: true,
    recipients: [
      { name: "Ada", email: "ada@example.com" },
      { name: "Bo", email: "bo@planner.example" },
    ],
    lastScheduled: null,
    lastTest: null,
  });
  m.scheduledSendExists.mockResolvedValue(false);
  m.claimScheduledSend.mockResolvedValue(7);
  m.lastCountedTo.mockResolvedValue(LAST_COUNTED);
  m.readSalesInputs.mockResolvedValue(INPUTS);
  m.sendBallReport.mockResolvedValue(undefined);
  m.markSendSent.mockResolvedValue(undefined);
  m.releaseClaim.mockResolvedValue(undefined);
  m.recordTestSend.mockResolvedValue(undefined);
});

describe("the scheduled report", () => {
  it("sends one email to everyone on the list, and records what it counted and up to when", async () => {
    expect(await runBallSalesReport(TUESDAY_8AM)).toEqual({ sent: true, recipients: 2 });
    expect(m.claimScheduledSend).toHaveBeenCalledWith("2026-10-06", "system:schedule");
    expect(m.readSalesInputs).toHaveBeenCalledWith(TUESDAY_8AM, LAST_COUNTED);
    expect(m.sendBallReport).toHaveBeenCalledTimes(1);
    expect(m.sendBallReport.mock.calls[0][0]).toMatchObject({
      to: ["ada@example.com", "bo@planner.example"],
      from: "events@nbcc.scot",
      replyTo: "events@nbcc.scot",
      subject: "Festive Ball tickets: Tuesday 6 October update",
    });
    expect(m.markSendSent).toHaveBeenCalledWith(7, ["ada@example.com", "bo@planner.example"], INPUTS, TUESDAY_8AM);
    expect(m.releaseClaim).not.toHaveBeenCalled();
  });

  it("sends nothing on a day that is not a report day", async () => {
    expect(await runBallSalesReport(WEDNESDAY_8AM)).toEqual({ sent: false, recipients: 0 });
    expect(m.claimScheduledSend).not.toHaveBeenCalled();
    expect(m.sendBallReport).not.toHaveBeenCalled();
  });

  it("sends nothing when another run has already claimed the day", async () => {
    m.claimScheduledSend.mockResolvedValue(null);
    expect(await runBallSalesReport(TUESDAY_8AM)).toEqual({ sent: false, recipients: 0 });
    expect(m.sendBallReport).not.toHaveBeenCalled();
  });

  it("gives the day back when the email could not be sent, so a rerun can try again", async () => {
    m.sendBallReport.mockRejectedValue(new Error("SES said no"));
    await expect(runBallSalesReport(TUESDAY_8AM)).rejects.toThrow("SES said no");
    expect(m.releaseClaim).toHaveBeenCalledWith(7);
    expect(m.markSendSent).not.toHaveBeenCalled();
  });

  it("keeps the day when the email went but could not be recorded, so a rerun cannot send it twice", async () => {
    const said = vi.spyOn(console, "error").mockImplementation(() => undefined);
    m.markSendSent.mockRejectedValue(new Error("database hiccup"));
    expect(await runBallSalesReport(TUESDAY_8AM)).toEqual({ sent: true, recipients: 2 });
    expect(m.releaseClaim).not.toHaveBeenCalled();
    expect(said).toHaveBeenCalled();
    said.mockRestore();
  });
});

describe("a test of the report", () => {
  const ASKER = { to: "staff.member@example.com", actor: "admin:staff.member@example.com", now: TUESDAY_8AM };

  it("goes only to the person asking, marked as a test, and is recorded as a test", async () => {
    await sendTestReport(ASKER);
    expect(m.sendBallReport).toHaveBeenCalledTimes(1);
    const sent = m.sendBallReport.mock.calls[0][0];
    expect(sent.to).toEqual(["staff.member@example.com"]);
    expect(sent.subject).toBe("[Test] Festive Ball tickets: Tuesday 6 October update");
    expect(m.recordTestSend).toHaveBeenCalledWith("2026-10-06", "staff.member@example.com", INPUTS, ASKER.actor);
    expect(m.claimScheduledSend).not.toHaveBeenCalled();
  });

  it("counts the same way the scheduled report would, from the last one", async () => {
    await sendTestReport(ASKER);
    expect(m.readSalesInputs).toHaveBeenCalledWith(TUESDAY_8AM, LAST_COUNTED);
  });

  it("is not reported as failed when it went but could not be recorded", async () => {
    const said = vi.spyOn(console, "error").mockImplementation(() => undefined);
    m.recordTestSend.mockRejectedValue(new Error("database hiccup"));
    await expect(sendTestReport(ASKER)).resolves.toBeUndefined();
    expect(said).toHaveBeenCalled();
    said.mockRestore();
  });

  it("fails, and records nothing, when it could not be sent", async () => {
    m.sendBallReport.mockRejectedValue(new Error("SES said no"));
    await expect(sendTestReport(ASKER)).rejects.toThrow("SES said no");
    expect(m.recordTestSend).not.toHaveBeenCalled();
  });
});
