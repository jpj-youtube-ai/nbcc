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
