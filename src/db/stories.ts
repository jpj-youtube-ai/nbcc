import { storiesPool } from "./stories-pool";
import { archiveCondition, type ArchiveView } from "../admin/archive-filter";
import type { StoryRecord } from "../stories/schema";
import { erasedFingerprint, storyKey, type ImportedStory } from "../stories/old-site-import";

// Task B1: the ONLY write path for My Story submissions. Uses storiesPool exclusively —
// never src/db/pool.ts — so this feature can never reach the main `charity` DB. A single
// INSERT ... RETURNING id, with NO paired audit_log row: that table lives in the charity
// DB, and this feature must never reference it (spec: "no cross-DB audit table; keep it
// self-contained"). created_at / consent_captured_at are DB defaults (now()).
export async function insertStory(record: StoryRecord): Promise<{ id: number }> {
  const result = await storiesPool.query<{ id: number }>(
    `INSERT INTO stories (
       submitter_role, story_text, short_quote, use_scope,
       consent_share_first_name, consent_share_town, third_party_consent,
       contact_for_more,
       submitter_first_name, submitter_email, submitter_phone, submitter_town,
       age_band, gender, recipient_type, heard_about, confirmed_over_16
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
     RETURNING id`,
    [
      record.submitter_role,
      record.story_text,
      record.short_quote,
      record.use_scope,
      record.consent_share_first_name,
      record.consent_share_town,
      record.third_party_consent,
      record.contact_for_more,
      record.submitter_first_name,
      record.submitter_email,
      record.submitter_phone,
      record.submitter_town,
      record.age_band,
      record.gender,
      record.recipient_type,
      record.heard_about,
      record.confirmed_over_16,
    ],
  );
  return { id: result.rows[0].id };
}

// --- Task C: admin read/manage (all via storiesPool — never src/db/pool.ts) ---------------------
// Mirrors insertStory's audit-less, single-DB pattern: no cross-DB audit_log row (that table lives
// in the charity DB and this feature must never reference it).

// The list-row shape for GET /api/admin/stories: enough to show scope + consent badges, submitter
// role, status and consent age WITHOUT the full story text or contact PII (data minimisation — the
// full record is only returned by getStory for the detail view).
export interface StoryListRow {
  id: number;
  created_at: Date;
  consent_captured_at: Date;
  submitter_role: string | null;
  use_scope: string;
  consent_share_first_name: boolean;
  consent_share_town: boolean;
  third_party_consent: boolean;
  status: string;
  short_quote: string | null;
}

export interface StoryRow extends StoryListRow {
  story_text: string;
  contact_for_more: boolean;
  submitter_first_name: string | null;
  submitter_email: string | null;
  submitter_phone: string | null;
  submitter_town: string | null;
  age_band: string | null;
  gender: string | null;
  recipient_type: string | null;
  heard_about: string | null;
  confirmed_over_16: boolean;
  admin_tags: string[] | null;
  admin_notes: string | null;
}

export interface ListStoriesFilter {
  status?: string;
  useScope?: string;
  /** TASK-311: which of live / archived / all to show. Defaults to live - the working list. */
  view?: ArchiveView;
}

// GET /api/admin/stories: newest-first, optionally filtered by status and/or use_scope. Deliberately
// projects a REDUCED column set (no story_text, no email/phone) — the full record is a separate call
// (getStory) so the list view never leaks more PII than the badges need.
export async function listStories(filter: ListStoriesFilter): Promise<StoryListRow[]> {
  const conditions: string[] = [];
  const params: string[] = [];
  // TASK-311: archived stories are hidden from the working list by default and shown only behind the
  // Archived filter. The condition comes from one pure, unit-tested place rather than being written
  // out here, so the two views cannot disagree about what each of them means.
  const archived = archiveCondition(filter.view ?? "live");
  if (archived) conditions.push(archived);
  if (filter.status) {
    params.push(filter.status);
    conditions.push(`status = $${params.length}`);
  }
  if (filter.useScope) {
    params.push(filter.useScope);
    conditions.push(`use_scope = $${params.length}`);
  }
  const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
  const result = await storiesPool.query<StoryListRow>(
    `SELECT id, created_at, consent_captured_at, submitter_role, use_scope,
            consent_share_first_name, consent_share_town, third_party_consent,
            status, short_quote
     FROM stories${where}
     ORDER BY created_at DESC`,
    params,
  );
  return result.rows;
}

// GET /api/admin/stories/:id: the full record for the detail view. Null when no row matches.
export async function getStory(id: number): Promise<StoryRow | null> {
  const result = await storiesPool.query<StoryRow>(`SELECT * FROM stories WHERE id = $1`, [id]);
  return result.rows[0] ?? null;
}

export interface StoryPatch {
  status?: string;
  adminTags?: string[];
  adminNotes?: string;
}

// PATCH /api/admin/stories/:id: update status / admin_tags / admin_notes. Builds a dynamic SET list
// from only the provided fields (mirrors updateDonorPortal's partial-update style), so a status-only
// patch never touches admin_tags/admin_notes. Returns the updated row, or null when the id does not
// exist. No audit_log row (see insertStory's comment — this feature is deliberately self-contained).
// G2 item 6: real hard-delete (erasure). Distinct from updateStory's status='withdrawn'
// (which STOPS a story being used but keeps the row for the archive): this permanently
// removes the row and every field it carries — a submitter's actual right-to-erasure
// request, not a soft flag. Single DELETE via storiesPool, no paired audit_log row (see
// insertStory's comment — this feature is deliberately self-contained in its own DB).
// Returns true when a row was removed, false when the id did not exist (caller 404s).
// TASK-311: the everyday action. Reversible, and the reason the delete below is no longer the
// button anybody reaches for first.
export async function archiveStory(id: number): Promise<boolean> {
  const result = await storiesPool.query(
    `UPDATE stories SET archived_at = now() WHERE id = $1 AND archived_at IS NULL`,
    [id],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function restoreStory(id: number): Promise<boolean> {
  const result = await storiesPool.query(
    `UPDATE stories SET archived_at = NULL WHERE id = $1 AND archived_at IS NOT NULL`,
    [id],
  );
  return (result.rowCount ?? 0) > 0;
}

// Permanent, and deliberately still here: a charity must be able to honour a GDPR erasure request,
// and this page exists partly to withdraw a story if consent is revoked. The route above it now
// insists the story is archived first and that a reason is given, and writes an erasure_log
// tombstone before calling this - so what is gone is knowable even though it is gone.
//
// TASK-475: and it stays gone. In the same transaction as the delete, it remembers a one way
// fingerprint of the story (erasedFingerprint: a sha256 of when it was sent and its words) in
// erased_stories, so adding the old website's export again never brings it back. If the fingerprint
// cannot be written, nothing is deleted: an erased story that could quietly return is the failure
// this exists to prevent. The row is locked while it is read, so what is fingerprinted is what goes.
export async function deleteStory(id: number): Promise<boolean> {
  const client = await storiesPool.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query<{ created_at: Date; story_text: string }>(
      "SELECT created_at, story_text FROM stories WHERE id = $1 FOR UPDATE",
      [id],
    );
    const story = found.rows[0];
    if (!story) {
      await client.query("ROLLBACK");
      return false;
    }
    await client.query("INSERT INTO erased_stories (fingerprint) VALUES ($1) ON CONFLICT (fingerprint) DO NOTHING", [
      erasedFingerprint(story.created_at, story.story_text),
    ]);
    const result = await client.query("DELETE FROM stories WHERE id = $1", [id]);
    await client.query("COMMIT");
    return (result.rowCount ?? 0) > 0;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function updateStory(id: number, patch: StoryPatch): Promise<StoryRow | null> {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.status !== undefined) {
    params.push(patch.status);
    sets.push(`status = $${params.length}`);
  }
  if (patch.adminTags !== undefined) {
    params.push(patch.adminTags);
    sets.push(`admin_tags = $${params.length}`);
  }
  if (patch.adminNotes !== undefined) {
    params.push(patch.adminNotes);
    sets.push(`admin_notes = $${params.length}`);
  }
  params.push(id);
  const result = await storiesPool.query<StoryRow>(
    `UPDATE stories SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING *`,
    params,
  );
  return result.rows[0] ?? null;
}

// ---- TASK-461: stories from the old website -------------------------------------------------------

// Which of these stories (sent at that moment, in those words) are already here, archived or not.
export async function storiesAlreadyHere(
  lookups: Array<{ created_at: string; story_text: string }>,
): Promise<Set<string>> {
  if (lookups.length === 0) return new Set();
  const found = await storiesPool.query<{ created_at: Date; story_text: string }>(
    "SELECT created_at, story_text FROM stories WHERE created_at = ANY($1::timestamptz[])",
    [lookups.map((l) => l.created_at)],
  );
  return new Set(found.rows.map((r) => storyKey(r.created_at, r.story_text)));
}

// TASK-475: which of these stories were erased from the admin earlier, as storyKeys. Asks by
// fingerprint only, so no story's words are sent to find out.
export async function erasedStoriesAmong(
  lookups: Array<{ created_at: string; story_text: string }>,
): Promise<Set<string>> {
  if (lookups.length === 0) return new Set();
  const keyOf = new Map(lookups.map((l) => [erasedFingerprint(l.created_at, l.story_text), storyKey(l.created_at, l.story_text)]));
  const found = await storiesPool.query<{ fingerprint: string }>(
    "SELECT fingerprint FROM erased_stories WHERE fingerprint = ANY($1::text[])",
    [[...keyOf.keys()]],
  );
  return new Set(found.rows.flatMap((r) => keyOf.get(r.fingerprint) ?? []));
}

// Adds the stories in one transaction and returns how many went in. The lock, and the second look
// inside it, mean a double click or two people adding the same file at once cannot add a story
// twice: whichever arrives second finds it already here. The second look also leaves out a story
// erased since the preview (TASK-475). Status "new", so each is reviewed like any
// other. No audit_log row, for the same reason as insertStory.
export async function insertImportedStories(stories: ImportedStory[]): Promise<number> {
  if (stories.length === 0) return 0;
  const client = await storiesPool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('stories: old website import'))");
    const found = await client.query<{ created_at: Date; story_text: string }>(
      "SELECT created_at, story_text FROM stories WHERE created_at = ANY($1::timestamptz[])",
      [stories.map((s) => s.created_at)],
    );
    const here = new Set(found.rows.map((r) => storyKey(r.created_at, r.story_text)));
    // TASK-475: nor one erased in the meantime.
    const erased = await client.query<{ fingerprint: string }>(
      "SELECT fingerprint FROM erased_stories WHERE fingerprint = ANY($1::text[])",
      [stories.map((s) => erasedFingerprint(s.created_at, s.story_text))],
    );
    const gone = new Set(erased.rows.map((r) => r.fingerprint));
    let added = 0;
    for (const s of stories) {
      const key = storyKey(s.created_at, s.story_text);
      if (here.has(key) || gone.has(erasedFingerprint(s.created_at, s.story_text))) continue;
      await client.query(
        `INSERT INTO stories (
           created_at, consent_captured_at, story_text, short_quote, use_scope,
           consent_share_first_name, consent_share_town, contact_for_more,
           submitter_first_name, submitter_email, submitter_phone, submitter_town,
           age_band, gender, recipient_type, heard_about, confirmed_over_16,
           status, admin_notes
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, 'new', $18)`,
        [
          s.created_at,
          s.consent_captured_at,
          s.story_text,
          s.short_quote,
          s.use_scope,
          s.consent_share_first_name,
          s.consent_share_town,
          s.contact_for_more,
          s.submitter_first_name,
          s.submitter_email,
          s.submitter_phone,
          s.submitter_town,
          s.age_band,
          s.gender,
          s.recipient_type,
          s.heard_about,
          s.confirmed_over_16,
          s.admin_notes,
        ],
      );
      here.add(key);
      added++;
    }
    await client.query("COMMIT");
    return added;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
