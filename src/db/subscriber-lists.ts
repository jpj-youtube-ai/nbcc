import { pool } from "./pool";

// TASK-259: audiences ("subscriber lists"). The charity mails more than donors — volunteers,
// partners, referrers — and each audience is its own list with its own membership and its own
// unsubscribes. The 'newsletter' list is special: consenting donors are automatically part of that
// audience on top of its own rows (resolved at send time in src/db/newsletters.ts, not stored).
//
// The load-bearing rule in here: an unsubscribe is a TOMBSTONE (unsubscribed_at), never a delete.
// "This person opted out on this date" is consent history a regulator can ask for, and the tombstone
// is what stops a later spreadsheet import silently re-subscribing someone who opted out.

// TASK-270: what an audience MEANS. This replaced a slug-string special case ("if the slug is
// literally 'newsletter', add the donors"), which no screen could show and a rename would break.
//   manual   — exactly the people on it (Volunteers, Partners, Referrers)
//   donors   — every donor with email consent, resolved live; nobody adds or removes them by hand
//   everyone — that list's own members PLUS the donors (the 'Newsletter' audience)
export type ListKind = "manual" | "donors" | "everyone";

export interface SubscriberList {
  id: number;
  slug: string;
  name: string;
  kind: ListKind;
  // TASK-270: the TRUE reach — for donors/everyone this counts the live donor audience too. It used
  // to count stored rows only, so the picker said "Newsletter (3)" while the send reached every
  // consenting donor; the number the admin confirms now matches the number that gets mailed.
  memberCount: number;
}

export interface ListMember {
  id: number;
  name: string | null;
  email: string;
  phone: string | null;
  consentSource: "footer" | "import" | "admin";
  consentedAt: string;
  // TASK-278: the staff member who added them. NULL for a self-signup (the person is the actor) and
  // for memberships predating this — a blank means "we didn't record it", not "added by nobody".
  addedBy: string | null;
}

export class DuplicateListError extends Error {
  constructor(public readonly slug: string) {
    super(`a subscriber list with slug ${slug} already exists`);
    this.name = "DuplicateListError";
  }
}

// node-postgres throws a plain Error with the SQLSTATE attached as `code` (same one-line guard as the
// sibling modules — deliberately not shared).
function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}

// The stable programmatic handle for a list. Pure and exported for tests; throws on a name with no
// usable characters — a list the UI cannot address is worse than an error at creation time.
export function slugifyListName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) throw new Error("List name has no usable characters");
  return slug;
}

// The live donor audience, as SQL — every donor with email consent, deduped case-insensitively.
// Shared by the count and the send so the two can never disagree.
const DONOR_EMAILS = `SELECT lower(email) AS email FROM donors
                       WHERE email_consent = true AND email IS NOT NULL`;
const ACTIVE_MEMBERS = `SELECT lower(email) AS email FROM list_subscribers
                         WHERE list_id = l.id AND unsubscribed_at IS NULL`;
// One expression, three meanings — see ListKind.
const MEMBER_COUNT = `CASE l.kind
        WHEN 'donors' THEN (SELECT count(DISTINCT email) FROM (${DONOR_EMAILS}) d)
        WHEN 'everyone' THEN (SELECT count(*) FROM (${ACTIVE_MEMBERS} UNION ${DONOR_EMAILS}) u)
        ELSE (SELECT count(*) FROM (${ACTIVE_MEMBERS}) m)
      END`;

const LIST_COLUMNS = `l.id, l.slug, l.name, l.kind, ${MEMBER_COUNT} AS member_count`;

function toList(r: {
  id: number;
  slug: string;
  name: string;
  kind: ListKind;
  member_count: string | number;
}): SubscriberList {
  return { id: r.id, slug: r.slug, name: r.name, kind: r.kind, memberCount: Number(r.member_count) };
}

// Archived audiences are excluded — they must not be sendable or pickable (TASK-270).
export async function listSubscriberLists(): Promise<SubscriberList[]> {
  const { rows } = await pool.query(
    `SELECT ${LIST_COLUMNS} FROM subscriber_lists l WHERE l.archived_at IS NULL ORDER BY l.id`,
  );
  return rows.map(toList);
}

// The retired ones, so the admin can see what was archived and put it back.
export async function listArchivedSubscriberLists(): Promise<SubscriberList[]> {
  const { rows } = await pool.query(
    `SELECT ${LIST_COLUMNS} FROM subscriber_lists l WHERE l.archived_at IS NOT NULL ORDER BY l.id`,
  );
  return rows.map(toList);
}

export interface SubscriberListRef {
  id: number;
  slug: string;
  name: string;
  kind: ListKind;
  archivedAt: string | null;
}

function toRef(r: Record<string, unknown> | undefined): SubscriberListRef | null {
  if (!r) return null;
  return {
    id: r.id as number,
    slug: r.slug as string,
    name: r.name as string,
    kind: r.kind as ListKind,
    archivedAt: (r.archived_at as string) ?? null,
  };
}

export async function getSubscriberList(id: number): Promise<SubscriberListRef | null> {
  const { rows } = await pool.query(
    `SELECT id, slug, name, kind, archived_at FROM subscriber_lists WHERE id = $1`,
    [id],
  );
  return toRef(rows[0]);
}

export async function getSubscriberListBySlug(slug: string): Promise<SubscriberListRef | null> {
  const { rows } = await pool.query(
    `SELECT id, slug, name, kind, archived_at FROM subscriber_lists WHERE slug = $1`,
    [slug],
  );
  return toRef(rows[0]);
}

export class BuiltInListError extends Error {
  constructor(public readonly slug: string) {
    super(`the ${slug} audience is built in and cannot be archived`);
    this.name = "BuiltInListError";
  }
}

// TASK-270: retiring an audience is a TOMBSTONE, never a delete — the same rule as an unsubscribe.
// It leaves the pickers so nothing can be sent to it, while past sends keep their audience label and
// the membership rows survive as consent history. Built-in audiences (Newsletter, Donors) can't go:
// they are what the send model is built on, and losing them would strand the donor promise.
export async function archiveSubscriberList(id: number): Promise<boolean> {
  const list = await getSubscriberList(id);
  if (!list) return false;
  if (list.kind !== "manual") throw new BuiltInListError(list.slug);
  const { rowCount } = await pool.query(
    `UPDATE subscriber_lists SET archived_at = now() WHERE id = $1 AND archived_at IS NULL`,
    [id],
  );
  return (rowCount ?? 0) > 0;
}

export async function restoreSubscriberList(id: number): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE subscriber_lists SET archived_at = NULL WHERE id = $1 AND archived_at IS NOT NULL`,
    [id],
  );
  return (rowCount ?? 0) > 0;
}

export async function createSubscriberList(name: string): Promise<{ id: number; slug: string; name: string }> {
  const slug = slugifyListName(name);
  try {
    const { rows } = await pool.query(
      `INSERT INTO subscriber_lists (slug, name) VALUES ($1, $2) RETURNING id, slug, name`,
      [slug, name.trim()],
    );
    return rows[0];
  } catch (err) {
    if (isUniqueViolation(err)) throw new DuplicateListError(slug);
    throw err;
  }
}

export type AddSubscriberOutcome = "added" | "exists" | "resubscribed" | "previously_unsubscribed";

// Add someone to a list. The tombstone decides the interesting case: an existing OPTED-OUT membership
// is revived ONLY when the source is allowed to (`revive`) — the person themselves via the footer, or
// staff deliberately typing them in. An import may NOT: a spreadsheet cannot overrule an opt-out, so
// it reports 'previously_unsubscribed' and the import screen shows exactly who was skipped and why.
export async function addListSubscriber(
  listId: number,
  person: { name: string | null; email: string; phone: string | null },
  source: "footer" | "import" | "admin",
  // TASK-278: the staff member behind a manual add or an import. NULL for a self-signup, where the
  // person themselves is the actor — the first question when an address turns out to be wrong is
  // "who added them?", and consent_source alone could not answer it.
  opts: { revive: boolean; addedBy?: string | null },
): Promise<AddSubscriberOutcome> {
  const email = person.email.trim().toLowerCase();
  const existing = await pool.query(
    `SELECT id, unsubscribed_at FROM list_subscribers WHERE list_id = $1 AND lower(email) = $2`,
    [listId, email],
  );
  const row = existing.rows[0];
  if (!row) {
    await pool.query(
      `INSERT INTO list_subscribers (list_id, name, email, phone, consent_source, added_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [listId, person.name, email, person.phone, source, opts.addedBy ?? null],
    );
    return "added";
  }
  if (!row.unsubscribed_at) return "exists";
  if (!opts.revive) return "previously_unsubscribed";
  // A revive is fresh consent: clear the tombstone and stamp when/how consent arrived this time.
  await pool.query(
    `UPDATE list_subscribers
        SET unsubscribed_at = NULL, consented_at = now(), consent_source = $2,
            name = COALESCE($3, name), phone = COALESCE($4, phone), added_by = $5
      WHERE id = $1`,
    [row.id, source, person.name, person.phone, opts.addedBy ?? null],
  );
  return "resubscribed";
}

export async function listListMembers(listId: number): Promise<ListMember[]> {
  const { rows } = await pool.query(
    `SELECT id, name, email, phone, consent_source, consented_at, added_by
       FROM list_subscribers
      WHERE list_id = $1 AND unsubscribed_at IS NULL
      ORDER BY email`,
    [listId],
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    phone: r.phone,
    addedBy: r.added_by ?? null,
    consentSource: r.consent_source,
    consentedAt: r.consented_at,
  }));
}

// Staff removing someone: same tombstone as a self-unsubscribe — the consent history survives.
export async function removeListMember(listId: number, memberId: number): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE list_subscribers SET unsubscribed_at = now()
      WHERE id = $1 AND list_id = $2 AND unsubscribed_at IS NULL`,
    [memberId, listId],
  );
  return (rowCount ?? 0) > 0;
}

// TASK-260: the import preview's compare — for a batch of addresses, which are already ACTIVE on
// this list and which are TOMBSTONED (an import may never revive those). One query however big the
// spreadsheet.
export async function getMembershipStates(
  listId: number,
  emails: string[],
): Promise<{ email: string; unsubscribed: boolean }[]> {
  if (emails.length === 0) return [];
  const { rows } = await pool.query(
    `SELECT lower(email) AS email, (unsubscribed_at IS NOT NULL) AS unsubscribed
       FROM list_subscribers
      WHERE list_id = $1 AND lower(email) = ANY($2)`,
    [listId, emails.map((e) => e.toLowerCase())],
  );
  return rows.map((r) => ({ email: r.email, unsubscribed: r.unsubscribed }));
}

// The public unsubscribe link's write. Idempotent, and a repeat click keeps the FIRST opt-out date —
// the tombstone records when they left, not when they last pressed the link. Returns the address so
// the caller can attribute a stats event, or null for an unknown id.
export async function unsubscribeListMember(memberId: number): Promise<{ email: string } | null> {
  const { rows } = await pool.query(
    `UPDATE list_subscribers SET unsubscribed_at = COALESCE(unsubscribed_at, now())
      WHERE id = $1 RETURNING email`,
    [memberId],
  );
  return rows[0] ? { email: rows[0].email } : null;
}

// The membership row for one address on one list. TASK-276 needs its id to sign the recipient's own
// unsubscribe token for the welcome email — addListSubscriber reports only what it did, not who.
export async function getListMemberByEmail(
  listId: number,
  email: string,
): Promise<{ id: number; name: string | null } | null> {
  const { rows } = await pool.query(
    `SELECT id, name FROM list_subscribers WHERE list_id = $1 AND lower(email) = $2`,
    [listId, email.trim().toLowerCase()],
  );
  return rows[0] ? { id: rows[0].id, name: rows[0].name } : null;
}
