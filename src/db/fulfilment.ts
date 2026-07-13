import type { PoolClient } from "pg";
import { pool } from "./pool";
import type { SupporterBand } from "../donors/fulfilment";

// The DB-access layer for the business_supporter_fulfilment table (TASK-205 migration 1783961442118
// + the token column, TASK-206 migration 1783964039569). Small, typed accessors over the pool: the
// band/eligibility DECISION is the pure fulfilmentBandFor in src/donors/fulfilment.ts, and the
// transactional call site is handleCheckoutCompleted in ./stripe-webhook.ts. Mirrors the
// insert-with-the-caller's-client + read-only-pool.query split used across ./donations.ts.

// One fulfilment row as stored (snake_case columns). One row per donor; band is the recognition band
// the supporter's monthly gift earned; token is the unguessable secure-thank-you-link token (nullable
// until set on insert). The captured-preferences + admin-flag columns are filled by later tasks.
export interface FulfilmentRow {
  id: number;
  donor_id: number;
  band: SupporterBand;
  token: string | null;
  credit_name: string | null;
  website: string | null;
  socials: string | null;
  list_on_supporters: boolean;
  want_social: boolean;
  want_badge: boolean;
  want_certificate: boolean;
  certificate_delivery: string | null;
  certificate_address: string | null;
  consent_featured: boolean;
  captured_at: Date | null;
  certificate_sent: boolean;
  certificate_posted: boolean;
  badge_sent: boolean;
  social_done: boolean;
  added_to_supporters: boolean;
  reminder_5_at: Date | null;
  reminder_14_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

// Ensure exactly one fulfilment record exists for a business supporter (idempotent). INSERTs the
// (donor_id, band, token) row — every other column carries a DB default — and ON CONFLICT (donor_id)
// DO NOTHING, so a record that ALREADY exists is left untouched (a redelivered/reprocessed gift never
// overwrites captured preferences or admin fulfilment flags). Returns the row id, whether newly
// inserted or pre-existing. Takes the caller's client so it JOINS their transaction (the webhook
// processor's BEGIN…COMMIT) — the record and its audit row then commit or roll back together.
export async function ensureFulfilmentRecord(
  client: PoolClient,
  input: { donorId: number; band: SupporterBand; token: string },
): Promise<number> {
  const inserted = await client.query<{ id: number }>(
    `INSERT INTO business_supporter_fulfilment (donor_id, band, token)
     VALUES ($1, $2, $3)
     ON CONFLICT (donor_id) DO NOTHING
     RETURNING id`,
    [input.donorId, input.band, input.token],
  );
  if (inserted.rows[0]) return inserted.rows[0].id;
  // Conflict: a fulfilment record already exists for this donor — read back its id (idempotent no-op).
  const existing = await client.query<{ id: number }>(
    `SELECT id FROM business_supporter_fulfilment WHERE donor_id = $1`,
    [input.donorId],
  );
  return existing.rows[0].id;
}

// Read the fulfilment record addressed by a secure-thank-you-link token, or null when the token
// matches none. Read-only (pool.query, no transaction/audit — mirrors getGiftAidDeclarationContext);
// the later secure thank-you page / admin loads the business's record from their link with this.
export async function getFulfilmentByToken(token: string): Promise<FulfilmentRow | null> {
  const res = await pool.query<FulfilmentRow>(
    `SELECT * FROM business_supporter_fulfilment WHERE token = $1`,
    [token],
  );
  return res.rows[0] ?? null;
}
