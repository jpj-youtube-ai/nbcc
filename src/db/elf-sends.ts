import { pool } from "./pool";

// NBCC Elf Detective School wave 2: every timed send the elf worker makes, claimed once in elf_sends
// (migrations/1791200000450_elf-alerts.js) before it goes, so it goes once however many tasks tick. A
// claim is a row keyed (kind, key): the clue email to a family is ("clue", "2026-7:<family id>"), the
// morning email ("morning", "2026-12-07"), a promotion ("proud", "2026:rank:<detective>:<rank>"). A send
// that throws keeps its row with its message, and is taken again once ten minutes have passed, three tries
// in all; a row that is sent, given up or still in flight never blocks the rows after it. The worker is
// src/elf/worker.ts. The SQL is proved against a real database in CI; test/unit/elf-db-sends.test.ts reads
// what is sent.

/** How much of a failure's message is kept. */
const ERROR_KEPT = 500;

/** Claims a send for this task: true when this task should send it. A row comes back for a new claim, and
 *  for a failed one that is unsent, tried fewer than three times and ten minutes old; none for a send that
 *  went, was given up, or is another task's claim in flight. */
export async function claimSend(kind: string, key: string): Promise<boolean> {
  const r = await pool.query<{ key: string }>(
    `INSERT INTO elf_sends (kind, key) VALUES ($1, $2)
     ON CONFLICT (kind, key) DO UPDATE SET claimed_at = now(), attempts = elf_sends.attempts + 1
       WHERE elf_sends.sent_at IS NULL AND elf_sends.attempts < 3 AND elf_sends.claimed_at < now() - interval '10 minutes'
     RETURNING key`,
    [kind, key],
  );
  return r.rows.length > 0;
}

/** The claimed send went. */
export async function markSent(kind: string, key: string): Promise<void> {
  await pool.query("UPDATE elf_sends SET sent_at = now(), last_error = NULL WHERE kind = $1 AND key = $2", [kind, key]);
}

/** The claimed send threw: its message is kept, and the claim's own time lets it be taken again ten
 *  minutes on (claimSend). */
export async function markSendFailed(kind: string, key: string, error: string): Promise<void> {
  await pool.query("UPDATE elf_sends SET last_error = $3 WHERE kind = $1 AND key = $2", [kind, key, error.slice(0, ERROR_KEPT)]);
}

export interface ClueFamily {
  familyId: number;
  email: string;
  grownUpName: string;
  /** The family's own token for the link that ends its email, to stop the emails (Plan 2c-2). */
  emailsToken: string;
}

/** The families still to get a door's clue email, oldest first, at most `limit`: active, not removed, with the
 *  emails not stopped (Plan 2c-2), and with no claim for this door that went, was given up or is in flight. A
 *  failed claim old enough to try again is listed; claimSend then takes it. A family that has stopped the emails
 *  is never listed, so nothing is claimed for it: one that starts them again while a clue's email is still going
 *  out (six hours from clue 1) gets that clue's email. */
export async function familiesStillToEmail(year: number, door: number, limit: number): Promise<ClueFamily[]> {
  const r = await pool.query<{ id: number; email: string; grown_up_name: string; emails_token: string }>(
    `SELECT f.id, f.email, f.grown_up_name, f.emails_token FROM elf_families f
      WHERE f.active AND f.removed_at IS NULL AND f.emails_stopped_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM elf_sends s
           WHERE s.kind = 'clue' AND s.key = $1::text || ':' || f.id
             AND (s.sent_at IS NOT NULL OR s.attempts >= 3 OR s.claimed_at > now() - interval '10 minutes'))
      ORDER BY f.id
      LIMIT $2`,
    [`${year}-${door}`, limit],
  );
  return r.rows.map((row) => ({ familyId: Number(row.id), email: row.email, grownUpName: row.grown_up_name, emailsToken: row.emails_token }));
}

/** The families the sweep looks at for proud moments: active and not removed, by id. A family that has stopped the
 *  emails is still swept: its proud moments are claimed and marked without an email (src/elf/worker.ts), so
 *  starting the emails again never sends old news. */
export async function familiesToSweep(): Promise<number[]> {
  const r = await pool.query<{ id: number }>("SELECT id FROM elf_families WHERE active AND removed_at IS NULL ORDER BY id");
  return r.rows.map((row) => Number(row.id));
}
