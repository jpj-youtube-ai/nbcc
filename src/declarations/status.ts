// The pure, DB-free Gift Aid declaration-confirmation state machine (TASK-074/REQ-057).
// A declaration captured without a wet/online signature (in-person, telephone) must be
// confirmed by the donor before the gift is claimable. This module owns ONLY the legal
// transitions between donations.declaration_status values — no pool/config/clock — so it
// is unit-tested DB-free like src/db/donations-model.ts and src/declarations/retention.ts.
// The code that sends confirmation letters/links and persists the new status (through the
// declaration_token) is a LATER task; it calls this to decide whether a change is allowed.

// The lifecycle values, matching the CHECK on donations.declaration_status
// (migration 1783010739790_declaration-status-and-token.js).
export const DECLARATION_STATUSES = [
  "not_required",
  "pending",
  "sent",
  "undelivered",
  "completed",
] as const;
export type DeclarationStatus = (typeof DECLARATION_STATUSES)[number];

// The events that drive the lifecycle. Crucially these are DELIBERATE actions, not page
// views: `confirm` is the donor's explicit confirmation of their declaration, never a bare
// GET of the confirmation link — so viewing the link can NEVER mark a declaration completed.
export const DECLARATION_STATUS_EVENTS = [
  "require", // a confirmation is now owed for this declaration
  "send", // the confirmation letter/link was dispatched
  "confirm", // the donor confirmed their declaration (the only path to `completed`)
  "mark_undelivered", // the letter/link bounced / could not be delivered
  "resend", // dispatch again after a bounce
] as const;
export type DeclarationStatusEvent = (typeof DECLARATION_STATUS_EVENTS)[number];

// The single source of truth for legal transitions: current status → event → next status.
// Any (status, event) pair absent here is illegal. Note `completed` is terminal, and it is
// reachable ONLY via `confirm` from `sent` — a `send`/`resend`/`require`/GET can never land
// there. `undelivered` recovers via `resend`.
const TRANSITIONS: Partial<Record<DeclarationStatus, Partial<Record<DeclarationStatusEvent, DeclarationStatus>>>> = {
  not_required: { require: "pending" },
  // `mark_undelivered` from `pending` covers a confirmation whose dispatch FAILED before
  // it was ever sent (TASK-075): the auto-email throws, so the confirmation is undelivered
  // without passing through `sent`.
  pending: { send: "sent", mark_undelivered: "undelivered" },
  sent: { confirm: "completed", mark_undelivered: "undelivered" },
  undelivered: { resend: "sent" },
  // `completed` is terminal — no outgoing transitions.
};

// The next status for a (current, event) pair, or null when the transition is illegal.
// Pure and total: an unknown status or event simply yields null.
export function nextDeclarationStatus(
  current: DeclarationStatus,
  event: DeclarationStatusEvent,
): DeclarationStatus | null {
  return TRANSITIONS[current]?.[event] ?? null;
}

// Whether a (current, event) transition is legal.
export function canApplyDeclarationEvent(
  current: DeclarationStatus,
  event: DeclarationStatusEvent,
): boolean {
  return nextDeclarationStatus(current, event) !== null;
}

// A typed error so a caller/route can distinguish an illegal declaration transition (e.g.
// a 409) from a generic failure — mirrors SamePlanError / BatchAssignmentError.
export class DeclarationTransitionError extends Error {
  constructor(
    public readonly from: DeclarationStatus,
    public readonly event: DeclarationStatusEvent,
  ) {
    super(`illegal declaration transition: ${event} from ${from}`);
    this.name = "DeclarationTransitionError";
  }
}

// Apply an event, returning the new status or throwing DeclarationTransitionError when the
// transition is illegal — the enforcement point the persistence layer wraps in its
// transaction, so an illegal change rolls back rather than corrupting the lifecycle.
export function applyDeclarationEvent(
  current: DeclarationStatus,
  event: DeclarationStatusEvent,
): DeclarationStatus {
  const next = nextDeclarationStatus(current, event);
  if (next === null) throw new DeclarationTransitionError(current, event);
  return next;
}
