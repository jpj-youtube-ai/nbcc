import { z } from "zod";
import { containsBlockedWord } from "../donors/display-name-filter";
import { giftNetPence, wallEntries, type WallEntry, type WallSourceRow } from "./model";

// TASK-507: "Thank your supporters". The organiser picks gifts on their fundraiser and writes a short
// thank you in their private area; staff check every one first; NBCC then emails it to each chosen
// giver (email 20, ./thanks-email.ts), from and replying to the events inbox. The organiser never
// sees a giver's email address, and nothing about a giver ever goes back to them: only the safe
// fields their gifts list already shows, and how many the thank you reached.
//
// Pure: no pool, no config, no clock. Unit tested in test/unit/fundraising-thanks.test.ts. The SQL is
// in src/db/fundraiser-thanks.ts, the sending in ./thanks-send.ts and the routes in
// src/routes/fundraiser-thanks.ts. Words people read are plain, friendly English, with no dashes.

export const THANKS_MAX = 600;
/** Thank yous one fundraiser may send for checking in any 24 hours. */
export const THANKS_PER_DAY = 3;
/** The most gifts one thank you may pick: the gifts list reads at most 1,000. */
export const THANKS_MAX_GIFTS = 1000;
export const THANKS_STATUSES = ["pending", "approved", "rejected"] as const;
export type ThanksStatus = (typeof THANKS_STATUSES)[number];

export const THANKS_REFUSED = "Please choose different words for your thank you.";
const WRITE_SOMETHING = "Write a few words to say thank you.";
const PICK_ONE = "Tick at least one gift to thank.";

const giftId = z.number().int().positive().max(2147483647);

/** What the form sends: the words, and the ids of the gifts they ticked (repeats dropped). */
export const thanksPostSchema = z.object({
  message: z.preprocess(
    (v) => (typeof v === "string" ? v.trim() : v),
    z
      .string({ required_error: WRITE_SOMETHING, invalid_type_error: WRITE_SOMETHING })
      .min(1, WRITE_SOMETHING)
      .max(THANKS_MAX, `Keep your thank you to ${THANKS_MAX} characters or fewer.`)
      .refine((v) => !containsBlockedWord(v), THANKS_REFUSED),
  ),
  donationIds: z
    .array(giftId, { required_error: PICK_ONE, invalid_type_error: PICK_ONE })
    .min(1, PICK_ONE)
    .max(THANKS_MAX_GIFTS, "That is more gifts than one thank you can take. Please pick fewer.")
    .transform((ids) => [...new Set(ids)]),
});
export type ThanksPost = z.infer<typeof thanksPostSchema>;

export function thanksLimitReached(sentInLastDay: number): boolean {
  return sentInLastDay >= THANKS_PER_DAY;
}

// --- the gifts to pick from -------------------------------------------------------------------------

/** A gift as the organiser picks it: exactly the gifts list's safe fields, its id, and whether it is taken. */
export type ThankableGift = WallEntry & { donationId: number; thanked: boolean };

/**
 * The gifts an organiser may thank, newest first: as the gifts list shows them (a name or Anonymous,
 * the amount unless the giver hid it, the message unless staff hid it, the date), never money they
 * paid in themselves, never a gift refunded in full. `held` are the gifts already in a thank you
 * (waiting, sent or skipped): each is marked thanked, as a gift is thanked at most once.
 */
export function thankableGifts(rows: WallSourceRow[], held: Set<number>): ThankableGift[] {
  return rows
    .filter((r) => !r.paidIn && giftNetPence(r.amountPence, r.refundedPence) > 0)
    .map((r) => ({ donationId: r.donationId, ...wallEntries([r])[0], thanked: held.has(r.donationId) }))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : b.donationId - a.donationId));
}

// --- a thank you, as stored and as the organiser reads it ---------------------------------------------

export interface ThanksRow {
  id: number;
  fundraiserId: number;
  message: string;
  status: ThanksStatus;
  createdAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  rejectReason: string | null;
  /** When the last of its emails was dealt with (sent, skipped or failed). */
  deliveredAt: string | null;
  /** How many gifts it picked. */
  gifts: number;
  /** Approved, and still to send. */
  waiting: number;
  sent: number;
  skipped: number;
  failed: number;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Where a thank you is up to, in the organiser's words. Counts only: never who, or why not. */
export function thanksStatusWords(t: Pick<ThanksRow, "status" | "waiting" | "deliveredAt" | "sent">): string {
  if (t.status === "pending") return "Waiting for us to check";
  if (t.status === "rejected") return "Not sent";
  if (t.waiting > 0 || !t.deliveredAt) return "Sending now";
  return t.sent > 0 ? `Sent to ${plural(t.sent, "supporter", "supporters")}` : "Not sent";
}

/** A thank you as its organiser sees it: never staff's reason, who decided, or what happened to whom. */
export function forOrganiser(t: ThanksRow) {
  return {
    id: t.id,
    message: t.message,
    status: t.status,
    statusWords: thanksStatusWords(t),
    createdAt: t.createdAt,
    gifts: t.gifts,
  };
}

// --- who NBCC may email -----------------------------------------------------------------------------

export type SkipReason = "no_email" | "suppressed" | "opted_out" | "duplicate";

/** Why a giver was not emailed, for staff only. */
export const SKIP_WORDS: Record<SkipReason, string> = {
  no_email: "No email address",
  suppressed: "On the do not email list (a bounce, a complaint, or stopped by staff)",
  opted_out: "Thank you emails are off for them",
  duplicate: "Already sent this thank you for another gift",
};

/**
 * Whether NBCC may email this giver the thank you. Not when there is no address; not when the address
 * is on the suppression list (a hard bounce, a spam complaint, or stopped by staff), checked at send
 * time as the newsletter does; and not when their thank you consent is off, exactly as NBCC's own
 * thank you letters (src/db/thank-you.ts). That consent is written from the newsletter tick box when
 * someone gives, and "Stop all emails" in the preference centre turns it off; the two cannot be told
 * apart, so off always means no email.
 */
export function recipientVerdict(
  giver: { email: string | null; emailConsent: boolean; thankyouConsent: boolean },
  suppressed: boolean,
): { send: true } | { send: false; reason: SkipReason } {
  if (!giver.email || giver.email.trim() === "") return { send: false, reason: "no_email" };
  if (suppressed) return { send: false, reason: "suppressed" };
  if (!giver.thankyouConsent) return { send: false, reason: "opted_out" };
  return { send: true };
}
