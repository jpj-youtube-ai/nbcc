import { pool } from "./pool";

// TASK-259: audiences ("subscriber lists"). The charity mails more than donors — volunteers,
// partners, referrers — and each audience is its own list with its own membership and its own
// unsubscribes. The 'newsletter' list is special: consenting donors are automatically part of that
// audience on top of its own rows (resolved at send time in src/db/newsletters.ts, not stored).
//
// The load-bearing rule in here: an unsubscribe is a TOMBSTONE (unsubscribed_at), never a delete.
// "This person opted out on this date" is consent history a regulator can ask for, and the tombstone
// is what stops a later spreadsheet import silently re-subscribing someone who opted out.

export interface SubscriberList {
  id: number;
  slug: string;
  name: string;
  memberCount: number; // active members (tombstoned rows excluded); donors are NOT counted here
}

export interface ListMember {
  id: number;
  name: string | null;
  email: string;
  phone: string | null;
  consentSource: "footer" | "import" | "admin";
  consentedAt: string;
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

export async function listSubscriberLists(): Promise<SubscriberList[]> {
  const { rows } = await pool.query(
    `SELECT l.id, l.slug, l.name,
            (SELECT count(*) FROM list_subscribers s
              WHERE s.list_id = l.id AND s.unsubscribed_at IS NULL) AS member_count
       FROM subscriber_lists l
      ORDER BY l.id`,
  );
  return rows.map((r) => ({ id: r.id, slug: r.slug, name: r.name, memberCount: Number(r.member_count) }));
}

export async function getSubscriberList(id: number): Promise<{ id: number; slug: string; name: string } | null> {
  const { rows } = await pool.query(`SELECT id, slug, name FROM subscriber_lists WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function getSubscriberListBySlug(slug: string): Promise<{ id: number; slug: string; name: string } | null> {
  const { rows } = await pool.query(`SELECT id, slug, name FROM subscriber_lists WHERE slug = $1`, [slug]);
  return rows[0] ?? null;
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
  opts: { revive: boolean },
): Promise<AddSubscriberOutcome> {
  const email = person.email.trim().toLowerCase();
  const existing = await pool.query(
    `SELECT id, unsubscribed_at FROM list_subscribers WHERE list_id = $1 AND lower(email) = $2`,
    [listId, email],
  );
  const row = existing.rows[0];
  if (!row) {
    await pool.query(
      `INSERT INTO list_subscribers (list_id, name, email, phone, consent_source) VALUES ($1, $2, $3, $4, $5)`,
      [listId, person.name, email, person.phone, source],
    );
    return "added";
  }
  if (!row.unsubscribed_at) return "exists";
  if (!opts.revive) return "previously_unsubscribed";
  // A revive is fresh consent: clear the tombstone and stamp when/how consent arrived this time.
  await pool.query(
    `UPDATE list_subscribers
        SET unsubscribed_at = NULL, consented_at = now(), consent_source = $2,
            name = COALESCE($3, name), phone = COALESCE($4, phone)
      WHERE id = $1`,
    [row.id, source, person.name, person.phone],
  );
  return "resubscribed";
}

export async function listListMembers(listId: number): Promise<ListMember[]> {
  const { rows } = await pool.query(
    `SELECT id, name, email, phone, consent_source, consented_at
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
