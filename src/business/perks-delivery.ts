// TASK-441: when a business supporter's badge and certificate actually go out.
//
// They used to ride the confirmation email, arriving seconds after the business submitted the form.
// That is fast, and it reads like a machine — which is what it was. A business giving £100 a month
// deserves their recognition to arrive looking like somebody put it together, so it now comes the
// NEXT WEEKDAY MORNING as its own email.
//
// The confirmation still goes immediately, because it is a receipt: somebody who fills in a form and
// hears nothing for a day reasonably assumes it broke. What is delayed is the delivery, not the
// acknowledgement.
//
// Pure - no pool, no config, no clock of its own - so the rules are unit-tested without a database
// or a mail account (golden rule 5). The runner wires the real seams, the same shape as
// src/business/auto-thank-you.ts.

/** What a supporter is owed, and whether it has been sent. */
export interface PerksAwaitingDelivery {
  fulfilmentId: number;
  token: string;
  email: string | null;
  /** business_name, falling back to full_name - the same greeting the invite and letter use. */
  name: string;
  wantBadge: boolean;
  wantCertificate: boolean;
  /** When they told us what they wanted. Null means they have not, so nothing is owed. */
  capturedAt: Date | null;
  /** When their badge/certificate email went. Non-null means never again. */
  perksSentAt: Date | null;
}

const isWeekend = (d: Date) => d.getUTCDay() === 0 || d.getUTCDay() === 6;
const dayNumber = (d: Date) => Math.floor(d.getTime() / 86_400_000);

/**
 * Should this supporter's badge and certificate go out at `now`?
 *
 * Four things have to hold, and each is a real case rather than defensive padding:
 *
 *   - They have asked for something. A supporter who wanted neither a badge nor a certificate is
 *     owed no delivery email, and sending one would be a message about nothing.
 *   - They have filled in the form. Until then we do not know what they want.
 *   - It has not already gone. perksSentAt is the guard that makes a second daily pass a no-op.
 *   - It is a WEEKDAY, and at least one calendar day after they submitted.
 *
 * That last rule is the whole point. "A few hours later" still lands at 3am on a Sunday for somebody
 * who signed up on Saturday night, and a 3am Sunday email is unmistakably automatic. Waiting for the
 * next weekday morning means Friday afternoon becomes Monday, and Saturday becomes Monday, which is
 * when a person would have got round to it.
 */
export function shouldSendPerksNow(s: PerksAwaitingDelivery, now: Date): boolean {
  if (!s.wantBadge && !s.wantCertificate) return false;
  if (!s.email) return false;
  if (!s.capturedAt) return false;
  if (s.perksSentAt) return false;
  if (isWeekend(now)) return false;
  // Strictly a later calendar day, so a morning submission is never answered the same morning.
  return dayNumber(now) > dayNumber(s.capturedAt);
}

export interface PerksPassResult {
  due: number;
  sent: number;
  failed: number;
}

export interface PerksPassDeps {
  listAwaiting: () => Promise<PerksAwaitingDelivery[]>;
  send: (s: PerksAwaitingDelivery) => Promise<void>;
  /** Stamps perks_sent_at, so tomorrow's pass leaves this supporter alone. */
  markSent: (fulfilmentId: number) => Promise<unknown>;
  now: Date;
}

/**
 * One pass. Sends to everybody due, stamping each ONLY after its send succeeds — so a supporter
 * whose email failed is picked up tomorrow rather than silently never receiving anything.
 *
 * Sequential and best-effort, matching runBusinessInviteBackfill: a handful of supporters at most,
 * and one failure must not abort the rest.
 */
export async function runPerksDelivery(deps: PerksPassDeps): Promise<PerksPassResult> {
  const awaiting = await deps.listAwaiting();
  const due = awaiting.filter((s) => shouldSendPerksNow(s, deps.now));
  let sent = 0;
  let failed = 0;

  for (const supporter of due) {
    try {
      await deps.send(supporter);
      await deps.markSent(supporter.fulfilmentId);
      sent += 1;
    } catch {
      failed += 1;
    }
  }

  return { due: due.length, sent, failed };
}
