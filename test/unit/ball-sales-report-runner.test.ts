import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SalesInputs, TableBookingRow } from "../../src/ball/sales-report";

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
  recordSendFailure: vi.fn<(day: string) => Promise<void>>(),
  readTableBookings: vi.fn<() => Promise<TableBookingRow[]>>(),
  countedToBefore: vi.fn<(day: string) => Promise<Date | null>>(),
  resendDone: vi.fn<(day: string) => Promise<boolean>>(),
  claimResend: vi.fn<(day: string, actor: string, recipients: number) => Promise<boolean>>(),
  recordResendFailure: vi.fn<(day: string, actor: string) => Promise<void>>(),
  sendBallReport:
    vi.fn<(msg: { to: string[]; subject: string; from: string; replyTo: string; html: string; text: string }) => Promise<void>>(),
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
  recordSendFailure: m.recordSendFailure,
  readTableBookings: m.readTableBookings,
  countedToBefore: m.countedToBefore,
  resendDone: m.resendDone,
  claimResend: m.claimResend,
  recordResendFailure: m.recordResendFailure,
}));

import { canResendToday, resendTodaysReport, runBallSalesReport, sendTestReport } from "../../src/ball/sales-report-runner";

const MONDAY_8AM = new Date("2026-10-05T07:00:00Z"); // 8am in the UK
const TUESDAY_8AM = new Date("2026-10-06T07:00:00Z");
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
  awaitingTransfers: 0,
  awaitingTransferSeats: 0,
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
  m.recordSendFailure.mockResolvedValue(undefined);
  m.readTableBookings.mockResolvedValue([TABLE]);
  m.countedToBefore.mockResolvedValue(LAST_COUNTED);
  m.resendDone.mockResolvedValue(false);
  m.claimResend.mockResolvedValue(true);
  m.recordResendFailure.mockResolvedValue(undefined);
});

// An invented booker of one whole table.
const TABLE: TableBookingRow = {
  firstName: "Sam",
  surname: "Sample",
  name: "Sam Sample",
  email: "sam@example.com",
  company: "Sample Joinery Ltd",
  quantity: 2,
  status: "paid",
  paidAt: new Date("2026-10-01T10:00:00Z"),
  paymentMethod: "card",
};
const NAMED = "Sam Sample (Sample Joinery Ltd): 2 tables";

describe("the scheduled report", () => {
  it("sends one email to everyone on the list, and records what it counted and up to when", async () => {
    expect(await runBallSalesReport(MONDAY_8AM)).toEqual({ sent: true, recipients: 2 });
    expect(m.claimScheduledSend).toHaveBeenCalledWith("2026-10-05", "system:schedule");
    expect(m.readSalesInputs).toHaveBeenCalledWith(MONDAY_8AM, LAST_COUNTED);
    expect(m.sendBallReport).toHaveBeenCalledTimes(1);
    expect(m.sendBallReport.mock.calls[0][0]).toMatchObject({
      to: ["ada@example.com", "bo@planner.example"],
      from: "events@nbcc.scot",
      replyTo: "events@nbcc.scot",
      subject: "Festive Ball tickets: Monday 5 October update",
    });
    expect(m.markSendSent).toHaveBeenCalledWith(7, ["ada@example.com", "bo@planner.example"], INPUTS, MONDAY_8AM);
    expect(m.releaseClaim).not.toHaveBeenCalled();
  });

  it("sends nothing on a day that is not a report day", async () => {
    expect(await runBallSalesReport(WEDNESDAY_8AM)).toEqual({ sent: false, recipients: 0 });
    expect(m.claimScheduledSend).not.toHaveBeenCalled();
    expect(m.sendBallReport).not.toHaveBeenCalled();
  });

  it("sends nothing when another run has already claimed the day", async () => {
    m.claimScheduledSend.mockResolvedValue(null);
    expect(await runBallSalesReport(MONDAY_8AM)).toEqual({ sent: false, recipients: 0 });
    expect(m.sendBallReport).not.toHaveBeenCalled();
  });

  it("gives the day back when the email could not be sent, so a rerun can try again", async () => {
    m.sendBallReport.mockRejectedValue(new Error("SES said no"));
    await expect(runBallSalesReport(MONDAY_8AM)).rejects.toThrow("SES said no");
    expect(m.releaseClaim).toHaveBeenCalledWith(7);
    expect(m.markSendSent).not.toHaveBeenCalled();
  });

  // TASK-471: a failed report used to show only in the server logs. It is recorded, so the card on
  // the Events page can say the day's report did not go.
  it("records a report that could not be sent, so the Events page can say so", async () => {
    m.sendBallReport.mockRejectedValue(new Error("SES said no"));
    await expect(runBallSalesReport(MONDAY_8AM)).rejects.toThrow("SES said no");
    expect(m.recordSendFailure).toHaveBeenCalledWith("2026-10-05");
  });

  it("still throws the real error when even the record of the failure cannot be written", async () => {
    m.sendBallReport.mockRejectedValue(new Error("SES said no"));
    m.recordSendFailure.mockRejectedValue(new Error("database hiccup"));
    await expect(runBallSalesReport(MONDAY_8AM)).rejects.toThrow("SES said no");
  });

  it("records no failure when the report went", async () => {
    await runBallSalesReport(MONDAY_8AM);
    expect(m.recordSendFailure).not.toHaveBeenCalled();
  });

  it("keeps the day when the email went but could not be recorded, so a rerun cannot send it twice", async () => {
    const said = vi.spyOn(console, "error").mockImplementation(() => undefined);
    m.markSendSent.mockRejectedValue(new Error("database hiccup"));
    expect(await runBallSalesReport(MONDAY_8AM)).toEqual({ sent: true, recipients: 2 });
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

describe("who has booked a table, in every report", () => {
  it("is in the scheduled report", async () => {
    await runBallSalesReport(MONDAY_8AM);
    expect(m.sendBallReport.mock.calls[0][0].text).toContain(NAMED);
  });

  it("is in a test", async () => {
    await sendTestReport({ to: "staff.member@example.com", actor: "admin:staff.member@example.com", now: TUESDAY_8AM });
    expect(m.sendBallReport.mock.calls[0][0].text).toContain(NAMED);
  });

  it("is never stored with the numbers", async () => {
    await runBallSalesReport(MONDAY_8AM);
    expect(JSON.stringify(m.markSendSent.mock.calls[0])).not.toContain("Sample");
  });
});

describe("sending today's report again", () => {
  const MONDAY_2PM = new Date("2026-10-05T13:00:00Z");
  const ACTOR = "admin:staff.member@example.com";
  const sentToday = () =>
    m.getReportSettings.mockResolvedValue({
      reportOn: true,
      recipients: [
        { name: "Ada", email: "ada@example.com" },
        { name: "Bo", email: "bo@planner.example" },
      ],
      lastScheduled: { sentOn: "2026-10-05", recipients: [], sentAt: "2026-10-05T07:00:03Z", sentBy: "system:schedule" },
      lastTest: null,
    });
  beforeEach(sentToday);

  it("goes to everyone on the list, says it is sent again, and names the tables", async () => {
    expect(await resendTodaysReport({ actor: ACTOR, now: MONDAY_2PM })).toEqual({ recipients: 2 });
    expect(m.sendBallReport).toHaveBeenCalledTimes(1);
    const sent = m.sendBallReport.mock.calls[0][0];
    expect(sent.to).toEqual(["ada@example.com", "bo@planner.example"]);
    expect(sent.subject).toBe("Festive Ball tickets: Monday 5 October update, sent again");
    expect(sent.text).toContain(NAMED);
  });

  it("counts 'since the last update' as this morning's did, from the report before today's", async () => {
    await resendTodaysReport({ actor: ACTOR, now: MONDAY_2PM });
    expect(m.countedToBefore).toHaveBeenCalledWith("2026-10-05");
    expect(m.readSalesInputs).toHaveBeenCalledWith(MONDAY_2PM, LAST_COUNTED);
  });

  it("leaves the schedule's own record alone, so the next report counts on from this morning", async () => {
    await resendTodaysReport({ actor: ACTOR, now: MONDAY_2PM });
    expect(m.claimScheduledSend).not.toHaveBeenCalled();
    expect(m.markSendSent).not.toHaveBeenCalled();
    expect(m.recordTestSend).not.toHaveBeenCalled();
  });

  it("is claimed, with who asked, before anything is sent", async () => {
    m.sendBallReport.mockImplementation(async () => {
      expect(m.claimResend).toHaveBeenCalledWith("2026-10-05", ACTOR, 2);
    });
    await resendTodaysReport({ actor: ACTOR, now: MONDAY_2PM });
    expect(m.sendBallReport).toHaveBeenCalledTimes(1);
  });

  it("is refused a second time on the same day", async () => {
    m.claimResend.mockResolvedValue(false);
    await expect(resendTodaysReport({ actor: ACTOR, now: MONDAY_2PM })).rejects.toThrow(/already been sent again/);
    expect(m.sendBallReport).not.toHaveBeenCalled();
  });

  it("is refused on a day when no report has gone", async () => {
    await expect(resendTodaysReport({ actor: ACTOR, now: TUESDAY_8AM })).rejects.toThrow(/has not gone today/);
    expect(m.claimResend).not.toHaveBeenCalled();
    expect(m.sendBallReport).not.toHaveBeenCalled();
  });

  it("is refused when the report is switched off or has nobody to go to", async () => {
    m.getReportSettings.mockResolvedValue({
      reportOn: false,
      recipients: [],
      lastScheduled: { sentOn: "2026-10-05", recipients: [], sentAt: "2026-10-05T07:00:03Z", sentBy: "system:schedule" },
      lastTest: null,
    });
    await expect(resendTodaysReport({ actor: ACTOR, now: MONDAY_2PM })).rejects.toThrow(/switched off/);
    expect(m.sendBallReport).not.toHaveBeenCalled();
  });

  it("can be tried again when the email could not be sent", async () => {
    m.sendBallReport.mockRejectedValue(new Error("SES said no"));
    await expect(resendTodaysReport({ actor: ACTOR, now: MONDAY_2PM })).rejects.toThrow("SES said no");
    expect(m.recordResendFailure).toHaveBeenCalledWith("2026-10-05", ACTOR);
  });

  it("is offered only on a day the report went, and only once", async () => {
    const settings = await m.getReportSettings();
    expect(await canResendToday(MONDAY_2PM, settings)).toBe(true);
    expect(await canResendToday(TUESDAY_8AM, settings)).toBe(false);
    m.resendDone.mockResolvedValue(true);
    expect(await canResendToday(MONDAY_2PM, settings)).toBe(false);
  });
});
