import { describe, it, expect } from "vitest";
import { bankDetailsSchema, formatSortCode, transferReady, payByDate, TRANSFER_DAYS } from "../../src/ball/transfer";

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
