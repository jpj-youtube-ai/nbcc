import { pool } from "./pool";
import { insertAudit } from "./donations";
import { inTransaction } from "./elf-practice";
import { listUsers } from "./admin-users";
import { headElvesOf, type HeadElf } from "../elf/alerts";

// NBCC Elf Detective School wave 2: head elves' mobiles and alert ticks, and the alerts that went
// (migrations/1791200000450_elf-alerts.js). A mobile is kept as E.164 and never written to the audit
// log: a change is noted by who and the field names only. The SQL is proved against a real database
// in CI; test/unit/elf-db-alerts.test.ts reads what is sent.

interface HeadElfSql {
  user_id: number;
  mobile: string | null;
  alerts_on: boolean;
}

/** Every head elf (a user whose account is active, so has accepted their invite, and who may see the school),
 *  with their mobile and tick. */
export async function listHeadElves(): Promise<HeadElf[]> {
  const [users, res] = await Promise.all([
    listUsers(),
    pool.query<HeadElfSql>("SELECT user_id, mobile, alerts_on FROM elf_head_elves"),
  ]);
  return headElvesOf(
    users,
    res.rows.map((r) => ({ userId: r.user_id, mobile: r.mobile, alertsOn: r.alerts_on })),
  );
}

/** A head elf changes their own mobile and tick: an upsert that touches only the fields given. */
export async function setMyAlerts(
  userId: number,
  change: { mobile?: string | null; alertsOn?: boolean },
  actor: string,
): Promise<void> {
  const hasMobile = change.mobile !== undefined;
  const hasTick = change.alertsOn !== undefined;
  const fields = [...(hasMobile ? ["mobile"] : []), ...(hasTick ? ["alertsOn"] : [])];
  await inTransaction(async (client) => {
    await client.query(
      `INSERT INTO elf_head_elves (user_id, mobile, alerts_on, updated_by)
       VALUES ($1, $2, $3, $6)
       ON CONFLICT (user_id) DO UPDATE SET
         mobile = CASE WHEN $4 THEN EXCLUDED.mobile ELSE elf_head_elves.mobile END,
         alerts_on = CASE WHEN $5 THEN EXCLUDED.alerts_on ELSE elf_head_elves.alerts_on END,
         updated_at = now(),
         updated_by = EXCLUDED.updated_by`,
      [userId, hasMobile ? change.mobile : null, hasTick ? change.alertsOn : true, hasMobile, hasTick, actor],
    );
    await insertAudit(client, { actor, action: "elf.alerts.changed", entity: "elf_head_elves", entityId: userId, data: { fields } });
  });
}

/** The last alert of a kind: when it went and whose text did not. */
export async function lastAlert(kind: "photo" | "test"): Promise<{ at: Date; textsFailed: string[] } | null> {
  const res = await pool.query<{ sent_at: Date; texts_failed: string[] }>(
    "SELECT sent_at, texts_failed FROM elf_alerts WHERE kind = $1 ORDER BY sent_at DESC, id DESC LIMIT 1",
    [kind],
  );
  const r = res.rows[0];
  return r ? { at: r.sent_at, textsFailed: r.texts_failed ?? [] } : null;
}

/** Notes an alert that went. Names only for the texts that failed: never a number. */
export async function recordAlert(o: {
  kind: "photo" | "test";
  year: number;
  door: number | null;
  emails: number;
  texts: number;
  textsFailed: string[];
}): Promise<void> {
  await pool.query(
    "INSERT INTO elf_alerts (kind, year, door, emails, texts, texts_failed) VALUES ($1, $2, $3, $4, $5, $6)",
    [o.kind, o.year, o.door, o.emails, o.texts, o.textsFailed],
  );
}

/** When the oldest photo still waiting for a head elf was sent, or null when none is waiting. */
export async function oldestWaitingPhotoAt(): Promise<Date | null> {
  const res = await pool.query<{ at: Date | null }>(`SELECT min(p.sent_at) AS at FROM elf_photos p JOIN elf_families f ON f.id = p.family_id
      WHERE p.status = 'waiting' AND f.removed_at IS NULL`);
  return res.rows[0]?.at ?? null;
}
