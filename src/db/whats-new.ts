import { pool } from "./pool";
import { contactPool } from "./contact-pool";
import { storiesPool } from "./stories-pool";
import type { Area } from "../admin/whats-new";

// TASK-478: the reads and writes behind the New pills. The rules are in src/admin/whats-new.ts.

/** When this person last opened each section they have ever opened. */
export async function getSeen(userId: number): Promise<Map<string, Date>> {
  const res = await pool.query<{ area: string; seen_at: Date }>(
    "SELECT area, seen_at FROM admin_seen WHERE user_id = $1",
    [userId],
  );
  return new Map(res.rows.map((r) => [r.area, r.seen_at]));
}

/** Records that this person has just opened a section, and returns the moment recorded. */
export async function markSeen(userId: number, area: Area): Promise<Date> {
  const res = await pool.query<{ seen_at: Date }>(
    `INSERT INTO admin_seen (user_id, area, seen_at) VALUES ($1, $2, now())
     ON CONFLICT (user_id, area) DO UPDATE SET seen_at = now()
     RETURNING seen_at`,
    [userId, area],
  );
  return res.rows[0].seen_at;
}

export async function getAccountCreatedAt(userId: number): Promise<Date | null> {
  const res = await pool.query<{ created_at: Date }>("SELECT created_at FROM users WHERE id = $1", [userId]);
  return res.rows[0]?.created_at ?? null;
}

// One "the latest thing to arrive after $1" query per section, each on the database that holds it.
// These are the same times the row pills in the admin compare against.
const LATEST: Record<Exclude<Area, "events">, { db: "main" | "contact" | "stories"; sql: string }> = {
  contact: { db: "contact", sql: "SELECT max(created_at) AS at FROM contact_enquiries WHERE created_at > $1" },
  stories: { db: "stories", sql: "SELECT max(created_at) AS at FROM stories WHERE created_at > $1" },
  donations: {
    db: "main",
    sql: "SELECT max(created_at) AS at FROM donations WHERE payment_status = 'paid' AND created_at > $1",
  },
  // A monthly giver is new when their FIRST paid monthly gift is, matching "Since" on that screen.
  monthly: {
    db: "main",
    sql: `SELECT max(first_paid_at) AS at FROM (
            SELECT min(d.created_at) AS first_paid_at
              FROM donations d JOIN donors dn ON dn.id = d.donor_id
             WHERE d.mode = 'monthly' AND d.payment_status = 'paid' AND dn.donor_type = 'individual'
             GROUP BY d.donor_id
          ) firsts WHERE first_paid_at > $1`,
  },
  fulfilments: { db: "main", sql: "SELECT max(created_at) AS at FROM business_supporter_fulfilment WHERE created_at > $1" },
  ball: { db: "main", sql: "SELECT max(paid_at) AS at FROM ball_bookings WHERE status = 'paid' AND paid_at > $1" },
  // Public sign-ups only: somebody staff added or imported is not news to staff.
  newsletter: {
    db: "main",
    sql: `SELECT max(consented_at) AS at FROM list_subscribers
           WHERE consent_source = 'footer' AND unsubscribed_at IS NULL AND consented_at > $1`,
  },
};

/** The latest arrival in a section after `since`, or null when nothing has arrived since. */
export async function latestArrival(area: Area, since: Date): Promise<Date | null> {
  if (area === "events") return null; // the Events page has new features, not arrivals
  const q = LATEST[area];
  const db = q.db === "contact" ? contactPool : q.db === "stories" ? storiesPool : pool;
  const res = await db.query<{ at: Date | null }>(q.sql, [since]);
  return res.rows[0]?.at ?? null;
}
