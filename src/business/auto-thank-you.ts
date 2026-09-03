import type { ThankYouLetterView } from "../thank-you/letter";

// TASK-407: the thank-you letter that goes out on its own when a business becomes a supporter.
//
// Pure - no pool, no config, no clock of its own - so the rules are unit-tested without a database
// or a mail account (golden rule 5). The runner wires the real seams, the same shape as
// src/business/reminders.ts, and rides the daily task that already exists.
//
// The sequence, and why it is that way round:
//
//   they sign up -> the invite email goes (already automatic, TASK-212/214)
//   -> they say how they would like to be thanked
//   -> THIS sends the letter
//
// Waiting is not caution. A Platinum letter cannot be written properly until you know whether they
// want a certificate and where it should be posted, so sending before they answer would mean
// thanking somebody with the wrong letter. But silence is not a reason to say nothing either, so
// after a fortnight the standard letter goes anyway.

/** A fortnight. Long enough for a business to get round to the form, short enough that a
 *  thank-you still reads as a thank-you rather than an afterthought. */
export const THANK_YOU_FALLBACK_DAYS = 14;

/**
 * Who signs an automatic letter.
 *
 * Nobody read this one before it went, so it is signed by the charity rather than by a volunteer.
 * Putting a person's name on a letter they never saw is a small dishonesty, and it would be the
 * one thing in this letter that was not true.
 */
export const AUTO_SIGNER_NAME = "The Night Before Christmas Campaign";
export const AUTO_SIGNER_ROLE = "From all of us, and every volunteer";

export interface SupporterAwaitingThanks {
  fulfilmentId: number;
  donorId: number;
  /** How they asked to be credited, or their business name. */
  creditName: string;
  contactName: string | null;
  email: string | null;
  band: string;
  monthlyPence: number;
  /** Straight from the donation. Never inferred - see buildAutoThankYouView. */
  giftAided: boolean;
  invitedAt: Date | null;
  capturedAt: Date | null;
}

/** Why the letter is going now, or null when it is not. */
export type ThankReason = "captured" | "fallback";

const DAY = 86_400_000;

export function shouldThankNow(s: SupporterAwaitingThanks, now: Date): ThankReason | null {
  // No address, no letter. Without this the send would fail on every daily pass for ever.
  if (!s.email) return null;

  // They have told us how they would like to be thanked, so the letter can be written properly.
  if (s.capturedAt) return "captured";

  // A supporter who was never invited has no clock to run down; sending on the strength of a
  // missing date would thank somebody the moment their row appeared.
  if (!s.invitedAt) return null;

  const waited = Math.floor((now.getTime() - s.invitedAt.getTime()) / DAY);
  return waited >= THANK_YOU_FALLBACK_DAYS ? "fallback" : null;
}

/** "3 September 2026" — the way a letter is dated, not the way a database is. */
function letterDate(now: Date): string {
  return now.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

export function buildAutoThankYouView(s: SupporterAwaitingThanks, now: Date): ThankYouLetterView {
  return {
    thankYouName: s.creditName,
    // Address the person where we know one: "Dear Jane" reads like a letter, "Dear Ayr Joinery
    // Ltd" reads like a statement.
    addressedTo: s.contactName ?? s.creditName,
    giftType: "money",
    giftAmountPence: s.monthlyPence,
    giftInKind: null,
    // Taken from the DONATION, never from the kind of supporter. A company cannot Gift Aid at all
    // (it claims Corporation Tax relief instead), but a sole trader giving personally can, and the
    // 25% line on the wrong letter tells somebody something untrue about their own tax.
    giftAided: s.giftAided,
    // Nobody wrote one. An invented "personal" line would be worse than none.
    personalMessage: null,
    signedByName: AUTO_SIGNER_NAME,
    signedByRole: AUTO_SIGNER_ROLE,
    letterDate: letterDate(now),
  };
}

export interface AutoThankYouPassResult {
  due: number;
  sent: number;
  failed: number;
}

export interface AutoThankYouPassDeps {
  listDue: () => Promise<SupporterAwaitingThanks[]>;
  sendLetter: (s: SupporterAwaitingThanks, view: ThankYouLetterView) => Promise<void>;
  /** Records the letter so tomorrow's pass leaves this supporter alone. */
  markSent: (s: SupporterAwaitingThanks, view: ThankYouLetterView, reason: ThankReason) => Promise<unknown>;
  now: Date;
}

/**
 * One pass over everybody awaiting a thank-you.
 *
 * Best-effort per supporter: one bad address must not stop everybody else being thanked, and a
 * letter is recorded only AFTER its send succeeds, so a provider wobble leaves the supporter due
 * again tomorrow rather than marked thanked when nothing arrived.
 */
export async function runAutoThankYouPass(
  deps: AutoThankYouPassDeps,
): Promise<AutoThankYouPassResult> {
  const due = await deps.listDue();
  let sent = 0;
  let failed = 0;

  for (const supporter of due) {
    // The query already filters, but the rule is checked again here: a row that slipped through
    // without an address would otherwise fail its send on every pass, for ever.
    const reason = shouldThankNow(supporter, deps.now);
    if (!reason) continue;

    const view = buildAutoThankYouView(supporter, deps.now);
    try {
      await deps.sendLetter(supporter, view);
      await deps.markSent(supporter, view, reason);
      sent += 1;
    } catch (err) {
      failed += 1;
      console.error(
        `auto thank-you failed for fulfilment ${supporter.fulfilmentId}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return { due: due.length, sent, failed };
}
