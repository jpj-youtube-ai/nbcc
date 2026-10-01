import { describe, it, expect } from "vitest";
import {
  bankDetailsSchema,
  formatSortCode,
  transferReady,
  publicTransferOpen,
  payByDate,
  TRANSFER_DAYS,
  transferWindowOpen,
  transferPayBy,
  isOverdue,
  reminderDue,
} from "../../src/ball/transfer";

// TASK-484: the rules for paying for the Festive Ball by bank transfer. Every figure here is invented.

describe("the bank details staff enter", () => {
  it("accepts a sort code with or without dashes, and stores it with them", () => {
    expect(bankDetailsSchema.parse({ accountName: "NBCC", sortCode: "123456", accountNumber: "12345678" }).sortCode).toBe("12-34-56");
    expect(bankDetailsSchema.parse({ accountName: "NBCC", sortCode: "12-34-56", accountNumber: "12345678" }).sortCode).toBe("12-34-56");
  });

  it("refuses a sort code or account number that is not one, and a blank name", () => {
    expect(bankDetailsSchema.safeParse({ accountName: "NBCC", sortCode: "12345", accountNumber: "12345678" }).success).toBe(false);
    expect(bankDetailsSchema.safeParse({ accountName: "NBCC", sortCode: "123456", accountNumber: "1234567" }).success).toBe(false);
    expect(bankDetailsSchema.safeParse({ accountName: " ", sortCode: "123456", accountNumber: "12345678" }).success).toBe(false);
  });

  it("formats a stored sort code for reading", () => {
    expect(formatSortCode("123456")).toBe("12-34-56");
  });
});

describe("whether the page may offer a bank transfer", () => {
  const details = { accountName: "NBCC", sortCode: "12-34-56", accountNumber: "12345678" };

  it("does when switched on with every detail filled in", () => {
    expect(transferReady({ on: true, ...details })).toBe(true);
  });

  // Switched on with a detail missing would hand a buyer a booking they cannot pay.
  it("does not when any detail is missing, or when it is switched off", () => {
    expect(transferReady({ on: true, ...details, accountNumber: null })).toBe(false);
    expect(transferReady({ on: false, ...details })).toBe(false);
  });
});

describe("what the public availability feed says about bank transfer", () => {
  const ready = { on: true, accountName: "NBCC", sortCode: "12-34-56", accountNumber: "12345678", lastDay: null };
  const now = new Date("2026-10-01T10:00:00Z");

  it("is open only while tickets are on sale and it is ready", () => {
    expect(publicTransferOpen(true, ready, now)).toBe(true);
    expect(publicTransferOpen(false, ready, now)).toBe(false);
    expect(publicTransferOpen(true, { ...ready, on: false }, now)).toBe(false);
  });

  // TASK-485: after the last day for transfers, the page offers card only.
  it("closes after the last day for transfers, and is open on the day itself", () => {
    expect(publicTransferOpen(true, { ...ready, lastDay: "2026-10-01" }, now)).toBe(true);
    expect(publicTransferOpen(true, { ...ready, lastDay: "2026-09-30" }, now)).toBe(false);
  });
});

// TASK-485: deadlines.
describe("the last day for transfers", () => {
  it("leaves the window open when there is none", () => {
    expect(transferWindowOpen(new Date("2026-10-01T10:00:00Z"), null)).toBe(true);
  });

  it("is judged by the UK date", () => {
    // 23:30 UTC on the 1st is already the 2nd in a British Summer Time October.
    expect(transferWindowOpen(new Date("2026-10-01T23:30:00Z"), "2026-10-01")).toBe(false);
    expect(transferWindowOpen(new Date("2026-10-01T22:30:00Z"), "2026-10-01")).toBe(true);
  });
});

describe("a booking's pay-by date", () => {
  const now = new Date("2026-10-01T10:00:00Z");

  it("is seven days on when no last day is set, or the last day is later", () => {
    expect(transferPayBy(now, null)).toBe("2026-10-08");
    expect(transferPayBy(now, "2026-10-20")).toBe("2026-10-08");
  });

  it("shortens to the last day when that comes first", () => {
    expect(transferPayBy(now, "2026-10-04")).toBe("2026-10-04");
    expect(transferPayBy(now, "2026-10-01")).toBe("2026-10-01");
  });
});

describe("whether a transfer is overdue", () => {
  it("is from the day after its pay-by date, not on it", () => {
    expect(isOverdue("2026-10-08", "2026-10-08")).toBe(false);
    expect(isOverdue("2026-10-08", "2026-10-09")).toBe(true);
  });
});

describe("whether a booking is due its reminder", () => {
  const due = (over: Partial<{ payBy: string; createdDay: string; remindedAt: string | null }>, today: string) =>
    reminderDue({ payBy: "2026-10-08", createdDay: "2026-10-01", remindedAt: null, ...over }, today);

  it("is two days before the date, and the day before, and on the day", () => {
    expect(due({}, "2026-10-05")).toBe(false);
    expect(due({}, "2026-10-06")).toBe(true);
    expect(due({}, "2026-10-07")).toBe(true);
    expect(due({}, "2026-10-08")).toBe(true);
  });

  it("is not once the date has passed: that is for staff, as Overdue", () => {
    expect(due({}, "2026-10-09")).toBe(false);
  });

  it("is sent once", () => {
    expect(due({ remindedAt: "2026-10-06T08:00:00Z" }, "2026-10-07")).toBe(false);
  });

  // A last day close by can make a deadline only a day or two away; reminding on the day they
  // booked, hours after the first email, would read as a mistake.
  it("is not on the day the booking was made", () => {
    expect(due({ payBy: "2026-10-03", createdDay: "2026-10-02" }, "2026-10-02")).toBe(false);
    expect(due({ payBy: "2026-10-03", createdDay: "2026-10-02" }, "2026-10-03")).toBe(true);
  });
});

describe("the date a transfer should arrive by", () => {
  it("is seven days on, as a UK date", () => {
    expect(TRANSFER_DAYS).toBe(7);
    expect(payByDate(new Date("2026-10-01T10:00:00Z"))).toBe("2026-10-08");
  });

  // 23:30 UTC on the 1st is already the 2nd in a British Summer Time October.
  it("counts from the UK date, not the server's", () => {
    expect(payByDate(new Date("2026-10-01T23:30:00Z"))).toBe("2026-10-09");
  });

  it("crosses the end of a month", () => {
    expect(payByDate(new Date("2026-10-28T10:00:00Z"))).toBe("2026-11-04");
  });
});
