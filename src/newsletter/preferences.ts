// TASK-291: the preference centre — choose which emails to stop, rather than all or nothing.
//
// Two rules decide everything here, and both are about what a person is allowed to see and change:
//
//   1. NEVER reveal a list the address is not on. An unsubscribe link is delivered by email and gets
//      forwarded, so anyone holding the message holds the token. If the page rendered the full
//      catalogue it would tell a stranger that "Volunteers" and every other private audience exists.
//      The view is built from actual memberships only — there is no code path here that takes a list
//      of all lists.
//
//   2. A submission may only act on what that view contained. The form comes back from a browser and
//      can say anything; a membership id the person does not hold must be ignored rather than
//      obeyed, or the page becomes a way to unsubscribe other people.
//
// Pure and DB-free so both rules are pinned by tests that need no database.

export interface Membership {
  /** list_subscribers.id — the membership, not the person and not the list. */
  id: number;
  listId: number;
  listName: string;
}

export interface DonorConsent {
  id: number;
  /** Gates the newsletter. Unchanged in meaning from before the split. */
  emailConsent: boolean;
  /** Gates thank-you letters only (TASK-291). */
  thankyouConsent: boolean;
}

export interface PreferenceView {
  email: string;
  /** Only the lists this address genuinely belongs to. */
  lists: Membership[];
  /** Null when the address has no donor row — a subscriber has no donor consent to offer. */
  donor: { newsletter: boolean; thankYou: boolean } | null;
}

export interface PreferenceSubmission {
  /** The list ids the person wants to KEEP. Anything they hold and did not keep is dropped. */
  keepListIds: number[];
  newsletter: boolean;
  thankYou: boolean;
}

export interface PreferencePlan {
  /** Membership ids to tombstone. Only ever ids that were in the view. */
  unsubscribeMemberIds: number[];
  /** Null when there is no donor row to write to. */
  setNewsletter: boolean | null;
  setThankYou: boolean | null;
  /** True when the result is that we no longer email this person at all. */
  leavesNothing: boolean;
}

export type ListVisibility = "private" | "public";

export interface OfferableList {
  id: number;
  name: string;
  kind: "manual" | "donors" | "everyone";
  visibility: ListVisibility;
}

/**
 * Which lists a person may be OFFERED — the ones they could choose to join.
 *
 * The disclosure boundary. A private list is staff-managed and its existence is not ours to reveal,
 * so it never appears in the output at all; there is no "greyed out" state, because a greyed-out row
 * still tells you the list exists.
 *
 * `donors` is excluded whatever its visibility says: it follows donor consent and cannot be joined
 * by hand, so offering it would be an invitation we could not honour.
 */
export function joinableLists(all: OfferableList[], alreadyOnListIds: number[]): OfferableList[] {
  const on = new Set(alreadyOnListIds);
  return all.filter(
    (l) => l.visibility === "public" && l.kind !== "donors" && !on.has(l.id),
  );
}

/**
 * What this address may see. Built from real memberships and a real donor row — nothing else is
 * accepted, so there is no way for a caller to widen it into a catalogue.
 */
export function buildPreferences(input: {
  email: string;
  memberships: Membership[];
  donor: DonorConsent | null;
}): PreferenceView {
  return {
    email: input.email,
    lists: input.memberships.map((m) => ({ id: m.id, listId: m.listId, listName: m.listName })),
    donor: input.donor
      ? { newsletter: input.donor.emailConsent, thankYou: input.donor.thankyouConsent }
      : null,
  };
}

/**
 * Turn a submission into the writes to make, bounded by what the view actually offered.
 *
 * `keepListIds` is a keep-list rather than a drop-list on purpose: a checkbox that is absent from a
 * POST body is indistinguishable from one that was unchecked, so "what did you tick" is the only
 * reading a browser form supports honestly.
 */
export function applyPreferences(
  view: PreferenceView,
  submission: PreferenceSubmission,
): PreferencePlan {
  const keep = new Set(submission.keepListIds);
  const unsubscribeMemberIds = view.lists.filter((l) => !keep.has(l.listId)).map((l) => l.id);

  // No donor row means no donor consent to set. A submission claiming otherwise is ignored rather
  // than trusted — it cannot conjure a consent record that does not exist.
  const setNewsletter = view.donor ? submission.newsletter : null;
  const setThankYou = view.donor ? submission.thankYou : null;

  const keptAnyList = view.lists.some((l) => keep.has(l.listId));
  const keptAnyDonorEmail = view.donor ? submission.newsletter || submission.thankYou : false;

  return {
    unsubscribeMemberIds,
    setNewsletter,
    setThankYou,
    leavesNothing: !keptAnyList && !keptAnyDonorEmail,
  };
}
