// TASK-288: one newsletter, several audiences.
//
// The rule that matters is DEDUPLICATION. A volunteer who is also a donor sits on two audiences, and
// sending them the newsletter twice is not a cosmetic bug: it is the single fastest way to get marked
// as spam, and the person who reports it is one of your most engaged supporters.
//
// Kept pure and DB-free so that rule is pinned by tests that need no database. The resolver in
// src/db/newsletters.ts fetches each audience with the existing, already-trusted query and hands the
// lists here to be folded into one.

export interface MergeableRecipient {
  email: string;
  donorId: number | null;
  subscriberId: number | null;
  fullName: string | null;
}

/**
 * How much a record actually knows about the person. When the same address appears on two
 * audiences we keep the better-informed row: a donor record carries the donor id the unsubscribe
 * token is built from and usually the full name, so letting a bare subscriber row overwrite it
 * would cost the greeting and the correct unsubscribe link.
 */
function knownness(r: MergeableRecipient): number {
  return (r.donorId != null ? 2 : 0) + (r.fullName ? 1 : 0);
}

/**
 * Fold several audiences into the one list that will actually be mailed: deduplicated by email
 * (case-insensitively — mailboxes are), richest record wins, sorted so the queue order is stable
 * and a person reviewing it sees the same thing twice.
 */
export function mergeRecipients(audiences: MergeableRecipient[][]): MergeableRecipient[] {
  const byEmail = new Map<string, MergeableRecipient>();
  for (const audience of audiences) {
    for (const r of audience) {
      const email = r.email.trim().toLowerCase();
      if (!email) continue;
      const normalised = { ...r, email };
      const existing = byEmail.get(email);
      if (!existing || knownness(normalised) > knownness(existing)) byEmail.set(email, normalised);
    }
  }
  return Array.from(byEmail.values()).sort((a, b) => a.email.localeCompare(b.email));
}
