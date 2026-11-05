import { z } from "zod";
import { isValidUkPostcode } from "../declarations/fields";

// Invoices for donations (docs/superpowers/specs/2026-11-05-donation-invoices-design.md): staff send
// an invoice from Admin > Giving > Invoices, the person pays it by card or bank transfer from a private
// page, and a paid invoice becomes one ordinary donation. This file holds the pure rules: the invoice
// number, the send form's checks, and the state an invoice is shown in. No pool, no config, no clock:
// "today" is always passed in as a UK date (YYYY-MM-DD).

export const PAYER_KINDS = ["person", "business", "group"] as const;
export type PayerKind = (typeof PAYER_KINDS)[number];

export const INVOICE_STATUSES = ["waiting", "paid", "cancelled"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const DEFAULT_DESCRIPTION = "Donation to NBCC";
export const MIN_PENCE = 100;
export const MAX_PENCE = 5_000_000;
export const NAME_MAX = 120;
export const DESCRIPTION_MAX = 120;
export const NOTE_MAX = 500;
export const ADDRESS_MAX = 300;
export const DUE_DAYS = 30;

/** INV-0012: the invoice's number, and the reference for a bank transfer. Longer numbers stay whole. */
export function invoiceNumber(id: number): string {
  return `INV-${String(id).padStart(4, "0")}`;
}

/** "£1,250.50", "1250.5", "50" or 50 as pence; null for anything else or outside £1 to £50,000. */
export function parseAmountPence(raw: unknown): number | null {
  let s: string;
  if (typeof raw === "number" && Number.isFinite(raw)) s = String(raw);
  else if (typeof raw === "string") s = raw.trim().replace(/^£/, "").replace(/,/g, "");
  else return null;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [pounds, pence = ""] = s.split(".");
  const total = Number(pounds) * 100 + Number(pence.padEnd(2, "0"));
  return total >= MIN_PENCE && total <= MAX_PENCE ? total : null;
}

/** The UK date `days` after a UK date, both YYYY-MM-DD. */
export function addDays(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function defaultDueOn(today: string): string {
  return addDays(today, DUE_DAYS);
}

/** A real calendar day written YYYY-MM-DD (so 2026-02-30 is not one). */
export function isRealDay(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

export interface InvoiceInput {
  payerKind: PayerKind;
  contactName: string;
  orgName: string | null;
  email: string;
  address: string | null;
  postcode: string | null;
  considerationGiven: boolean | null;
  description: string;
  note: string | null;
  amountPence: number;
  dueOn: string;
}

export type ParsedInvoice = { ok: true; value: InvoiceInput } | { ok: false; field: string; error: string };

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const optional = (v: unknown): string | null => text(v) || null;
const emailOk = (s: string): boolean => z.string().email().max(254).safeParse(s).success;

/** The send form's checks, each failure naming its field so the screen can put the words beside it. */
export function parseInvoiceInput(body: unknown, today: string): ParsedInvoice {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const fail = (field: string, error: string): ParsedInvoice => ({ ok: false, field, error });

  const payerKind = b.payerKind;
  if (!(PAYER_KINDS as readonly unknown[]).includes(payerKind)) return fail("payerKind", "Choose who the invoice is for.");
  const kind = payerKind as PayerKind;
  const isOrg = kind !== "person";

  const contactName = text(b.contactName);
  if (!contactName || contactName.length > NAME_MAX) return fail("contactName", `Give a name, up to ${NAME_MAX} letters.`);

  const orgName = isOrg ? text(b.orgName) : "";
  if (isOrg && (!orgName || orgName.length > NAME_MAX)) {
    return fail("orgName", `Give the ${kind === "business" ? "business" : "group"}'s name, up to ${NAME_MAX} letters.`);
  }

  const email = text(b.email);
  if (!emailOk(email)) return fail("email", "Give an email address, so we can send the invoice.");

  const address = text(b.address);
  if (address.length > ADDRESS_MAX) return fail("address", `The address can be up to ${ADDRESS_MAX} letters.`);
  if (isOrg && !address) return fail("address", "Give their address. Their accounts team will expect it on the invoice.");
  const postcode = text(b.postcode).toUpperCase();
  if (isOrg && !postcode) return fail("postcode", "Give their postcode.");
  if (postcode && !isValidUkPostcode(postcode)) return fail("postcode", "That postcode does not look right. Check it and try again.");

  let considerationGiven: boolean | null = null;
  if (kind === "business") {
    if (typeof b.considerationGiven !== "boolean") {
      return fail("considerationGiven", "Say whether we are giving them anything in return.");
    }
    considerationGiven = b.considerationGiven;
  }

  const amountPence = parseAmountPence(b.amount);
  if (amountPence === null) return fail("amount", "Give an amount from £1 to £50,000, for example 250 or 250.50.");

  const description = text(b.description);
  if (!description || description.length > DESCRIPTION_MAX) {
    return fail("description", `Say what it is for, up to ${DESCRIPTION_MAX} letters.`);
  }
  const note = optional(b.note);
  if (note && note.length > NOTE_MAX) return fail("note", `The note can be up to ${NOTE_MAX} letters.`);

  const dueOn = b.dueOn;
  if (!isRealDay(dueOn) || dueOn < today) return fail("dueOn", "Choose a due date from today onwards.");

  return {
    ok: true,
    value: {
      payerKind: kind,
      contactName,
      orgName: isOrg ? orgName : null,
      email,
      address: address || null,
      postcode: postcode || null,
      considerationGiven,
      description,
      note,
      amountPence,
      dueOn,
    },
  };
}

export type DisplayState = "waiting" | "overdue" | "paid" | "cancelled" | "paid-after-cancel";

/** How an invoice is shown: Overdue is a waiting invoice past its due date, never a stored state. */
export function displayState(inv: { status: InvoiceStatus; dueOn: string; cancelledAt: string | null }, today: string): DisplayState {
  if (inv.status === "paid") return inv.cancelledAt ? "paid-after-cancel" : "paid";
  if (inv.status === "cancelled") return "cancelled";
  return today > inv.dueOn ? "overdue" : "waiting";
}

/** Whether an invoice in this state can still be paid from its page. */
export function isPayable(state: DisplayState): boolean {
  return state === "waiting" || state === "overdue";
}
