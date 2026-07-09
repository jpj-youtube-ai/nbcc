import { storiesPool } from "./stories-pool";
import type { StoryRecord } from "../stories/schema";

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
       contact_for_more, photo_interest,
       submitter_first_name, submitter_email, submitter_phone, submitter_town,
       age_band, gender, recipient_type, heard_about, confirmed_over_16
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
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
      record.photo_interest,
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
  photo_interest: boolean;
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
}

// GET /api/admin/stories: newest-first, optionally filtered by status and/or use_scope. Deliberately
// projects a REDUCED column set (no story_text, no email/phone) — the full record is a separate call
// (getStory) so the list view never leaks more PII than the badges need.
export async function listStories(filter: ListStoriesFilter): Promise<StoryListRow[]> {
  const conditions: string[] = [];
  const params: string[] = [];
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
