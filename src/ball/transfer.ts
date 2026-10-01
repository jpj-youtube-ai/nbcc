import { z } from "zod";
import { londonDate } from "./sales-report";

// TASK-484: the pure rules for paying for the Festive Ball by bank transfer. No pool, no network: the
// clock is passed in. See docs/superpowers/specs/2026-10-01-ball-bank-transfer-design.md.

/** Days a buyer has to pay. Stage 3 gives an invoice 14; stage 2 caps both at a last day. */
export const TRANSFER_DAYS = 7;

/** TASK-486: a company paying an invoice gets 14, because accounts teams pay in runs. */
export const TRANSFER_DAYS_INVOICE = 14;

// An optional box left empty, or only spaces, is "not given".
const optional = (schema: z.ZodString) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), schema.optional());

/** TASK-486: what "My company needs an invoice" asks for. Name and address are needed for it to be an invoice. */
export const invoiceSchema = z.object({
  company: z.string().trim().min(1, "Give the company's name").max(120),
  address: z.string().trim().min(1, "Give the company's address").max(400),
  po: optional(z.string().trim().max(60)),
  accountsEmail: optional(z.string().trim().toLowerCase().email("That isn't an email address").max(254)),
  phone: optional(z.string().trim().max(40)),
});
export type InvoiceDetails = z.infer<typeof invoiceSchema>;

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
  /** TASK-485: the last day transfers may arrive (UK date, YYYY-MM-DD), or null for none. */
  lastDay?: string | null;
}

/** Switched on and every detail there. Otherwise a buyer would be given a booking they cannot pay. */
export function transferReady(s: TransferSettings): boolean {
  return s.on && Boolean(s.accountName && s.sortCode && s.accountNumber);
}

/**
 * Whether the public Ball page should offer bank transfer. A yes or no only: the bank details are
 * given to a buyer after they book, never in the open availability feed.
 */
export function publicTransferOpen(salesOpen: boolean, s: TransferSettings, now: Date): boolean {
  return salesOpen && transferReady(s) && transferWindowOpen(now, s.lastDay ?? null);
}

// --- TASK-485: deadlines -----------------------------------------------------------------------

/** Open while there is no last day, or until the end of it (UK date). */
export function transferWindowOpen(now: Date, lastDay: string | null): boolean {
  return lastDay === null || londonDate(now) <= lastDay;
}

/** Seven days on, or the last day for transfers if that comes first. YYYY-MM-DD compares as text. */
export function transferPayBy(now: Date, lastDay: string | null, days = TRANSFER_DAYS): string {
  const usual = payByDate(now, days);
  return lastDay !== null && lastDay < usual ? lastDay : usual;
}

/** Past its pay-by date: flagged for staff from the next day. Staff decide what happens; nothing is automatic. */
export function isOverdue(payBy: string, today: string): boolean {
  return today > payBy;
}

/** Days before the pay-by date that the reminder goes. */
export const REMINDER_DAYS_BEFORE = 2;

/**
 * Due the "please pay by" reminder: not yet sent; within the two days before the date, inclusive;
 * not past it (an overdue booking is for staff); and not on the day it was booked, which with a
 * short deadline would land hours after the first email.
 */
export function reminderDue(
  b: { payBy: string; createdDay: string; remindedAt: string | null },
  today: string,
): boolean {
  if (b.remindedAt) return false;
  if (today > b.payBy || today <= b.createdDay) return false;
  const [y, m, d] = b.payBy.split("-").map(Number);
  const from = new Date(Date.UTC(y, m - 1, d - REMINDER_DAYS_BEFORE)).toISOString().slice(0, 10);
  return today >= from;
}

/** The UK date `days` days after `now`, as YYYY-MM-DD. */
export function payByDate(now: Date, days = TRANSFER_DAYS): string {
  const [y, m, d] = londonDate(now).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** TASK-486: the accounts team is copied on an invoiced booking's emails, unless it is the buyer anyway. */
export function invoiceCc(accountsEmail: string | null | undefined, buyerEmail: string): string | undefined {
  const cc = accountsEmail?.trim();
  if (!cc || cc.toLowerCase() === buyerEmail.trim().toLowerCase()) return undefined;
  return cc;
}
