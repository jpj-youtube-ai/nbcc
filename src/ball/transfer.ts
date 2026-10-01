import { z } from "zod";
import { londonDate } from "./sales-report";

// TASK-484: the pure rules for paying for the Festive Ball by bank transfer. No pool, no network: the
// clock is passed in. See docs/superpowers/specs/2026-10-01-ball-bank-transfer-design.md.

/** Days a buyer has to pay. Stage 3 gives an invoice 14; stage 2 caps both at a last day. */
export const TRANSFER_DAYS = 7;

const digits = (s: string): string => s.replace(/[\s-]/g, "");

/** "123456" or "12-34-56" as it is written on a cheque book: "12-34-56". */
export function formatSortCode(raw: string): string {
  const d = digits(raw);
  return `${d.slice(0, 2)}-${d.slice(2, 4)}-${d.slice(4, 6)}`;
}

export const bankDetailsSchema = z.object({
  accountName: z.string().trim().min(1, "Give the account name").max(70),
  sortCode: z
    .string()
    .refine((s) => /^\d{6}$/.test(digits(s)), "A sort code is six digits")
    .transform(formatSortCode),
  accountNumber: z
    .string()
    .refine((s) => /^\d{8}$/.test(digits(s)), "An account number is eight digits")
    .transform(digits),
});
export type BankDetails = z.infer<typeof bankDetailsSchema>;

export interface TransferSettings {
  on: boolean;
  accountName: string | null;
  sortCode: string | null;
  accountNumber: string | null;
}

/** Switched on and every detail there. Otherwise a buyer would be given a booking they cannot pay. */
export function transferReady(s: TransferSettings): boolean {
  return s.on && Boolean(s.accountName && s.sortCode && s.accountNumber);
}

/**
 * Whether the public Ball page should offer bank transfer. A yes or no only: the bank details are
 * given to a buyer after they book, never in the open availability feed.
 */
export function publicTransferOpen(salesOpen: boolean, s: TransferSettings): boolean {
  return salesOpen && transferReady(s);
}

/** The UK date `days` days after `now`, as YYYY-MM-DD. */
export function payByDate(now: Date, days = TRANSFER_DAYS): string {
  const [y, m, d] = londonDate(now).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
