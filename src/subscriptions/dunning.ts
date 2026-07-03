// The pure, DB-free subscription DUNNING state machine (TASK-091/REQ-065). A monthly (subscription)
// donor's card renewal can fail; Stripe Smart Retries re-attempts it before giving up, and this
// module owns ONLY the legal transitions between subscription_dunning.status values plus the
// failed-attempt counter — no pool/config/clock — so it is unit-tested DB-free like
// src/declarations/status.ts and src/db/donations-model.ts. The webhook code that reads Stripe's
// invoice/subscription events and persists the new status (through subscription_dunning) is a
// LATER task; it calls this to decide whether a change is allowed.
//
// NOTE: the retry CADENCE itself — ~3 attempts over ~2 weeks — is a Stripe Dashboard "Smart
// Retries" setting, NOT an API/config value this service sets. This module models only the
// resulting lifecycle: a failure moves active → past_due, further failures stay past_due, a
// success recovers to active, and only Stripe reporting the retries EXHAUSTED (e.g.
// invoice.payment_failed with next_payment_attempt: null, or the subscription reaching
// unpaid/canceled) lapses it — never a bare webhook replay.

// The lifecycle values, matching the CHECK on subscription_dunning.status
// (migration 1783063189615_subscription-dunning.js).
export const DUNNING_STATUSES = ["active", "past_due", "lapsed"] as const;
export type DunningStatus = (typeof DUNNING_STATUSES)[number];

// The events that drive the lifecycle, mapped from Stripe's subscription payment webhooks:
//  - payment_failed: a renewal attempt failed (invoice.payment_failed with a further retry due).
//  - payment_succeeded: a renewal (or a retry) succeeded (invoice.paid) — clears the dunning.
//  - retries_exhausted: Stripe gave up (invoice.payment_failed with next_payment_attempt: null,
//    or subscription → unpaid/canceled). This is the ONLY path to the terminal `lapsed` state.
export const DUNNING_EVENTS = ["payment_failed", "payment_succeeded", "retries_exhausted"] as const;
export type DunningEvent = (typeof DUNNING_EVENTS)[number];

// The single source of truth for legal transitions: current status → event → next status. Any
// (status, event) pair absent here is illegal. `lapsed` is terminal (no outgoing transitions) and
// reachable ONLY via `retries_exhausted` from `past_due`. A `payment_succeeded` on a healthy
// `active` subscription is a legal no-op (a normal renewal), and on `past_due` it recovers to
// `active`; a `payment_failed` moves active → past_due and then stays past_due on further failures.
const TRANSITIONS: Partial<Record<DunningStatus, Partial<Record<DunningEvent, DunningStatus>>>> = {
  active: { payment_failed: "past_due", payment_succeeded: "active" },
  past_due: {
    payment_failed: "past_due",
    payment_succeeded: "active",
    retries_exhausted: "lapsed",
  },
  // `lapsed` is terminal — no outgoing transitions.
};

// The next status for a (current, event) pair, or null when the transition is illegal. Pure and
// total: an unknown status or event simply yields null.
export function nextDunningStatus(current: DunningStatus, event: DunningEvent): DunningStatus | null {
  return TRANSITIONS[current]?.[event] ?? null;
}

// Whether a (current, event) transition is legal.
export function canApplyDunningEvent(current: DunningStatus, event: DunningEvent): boolean {
  return nextDunningStatus(current, event) !== null;
}

// A typed error so a caller/route can distinguish an illegal dunning transition from a generic
// failure — mirrors DeclarationTransitionError / BatchAssignmentError.
export class DunningTransitionError extends Error {
  constructor(
    public readonly from: DunningStatus,
    public readonly event: DunningEvent,
  ) {
    super(`illegal dunning transition: ${event} from ${from}`);
    this.name = "DunningTransitionError";
  }
}

// Apply an event, returning the new status or throwing DunningTransitionError when the transition
// is illegal — the enforcement point the persistence layer wraps in its transaction, so an illegal
// change (e.g. any event on a `lapsed` subscription) rolls back rather than corrupting the lifecycle.
export function applyDunningEvent(current: DunningStatus, event: DunningEvent): DunningStatus {
  const next = nextDunningStatus(current, event);
  if (next === null) throw new DunningTransitionError(current, event);
  return next;
}

// The failed-attempt counter alongside the status (subscription_dunning.failed_attempts). Pure:
// a `payment_failed` increments it, a `payment_succeeded` resets it to 0, and `retries_exhausted`
// leaves it as-is (the final attempt count is preserved on the lapsed row). Assumes the (status,
// event) transition is legal — the caller applies it via applyDunningEvent.
export function nextFailedAttempts(event: DunningEvent, currentAttempts: number): number {
  if (event === "payment_failed") return currentAttempts + 1;
  if (event === "payment_succeeded") return 0;
  return currentAttempts; // retries_exhausted: preserve the count on the lapsed row
}
