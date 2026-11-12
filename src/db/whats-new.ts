import { pool } from "./pool";
import { contactPool } from "./contact-pool";
import { storiesPool } from "./stories-pool";
import { arrivalLine, type Area } from "../admin/whats-new";

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
const LATEST: Record<Exclude<Area, "events" | "analytics" | "qr" | "red-bag" | "invoices">, { db: "main" | "contact" | "stories"; sql: string }> = {
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
  // A paid booking, when it was paid; and (TASK-487) a bank transfer booking still waiting for its
  // money, when it was made, so the team knows to look out for it. Matches the row pills on Festive
  // Ball: one cancelled since has no row to carry a pill, so it does not light the section either.
  ball: {
    db: "main",
    sql: `SELECT max(at) AS at FROM (
            SELECT paid_at AS at FROM ball_bookings WHERE status = 'paid' AND paid_at > $1
            UNION ALL
            SELECT created_at FROM ball_bookings
             WHERE payment_method = 'transfer' AND status = 'pending' AND created_at > $1
          ) arrivals`,
  },
  // Public sign-ups only: somebody staff added or imported is not news to staff.
  newsletter: {
    db: "main",
    sql: `SELECT max(consented_at) AS at FROM list_subscribers
           WHERE consent_source IN ('footer', 'fundraise') AND unsubscribed_at IS NULL AND consented_at > $1`,
  },
  // TASK-493: a new sign up at /fundraise, when it was made.
  fundraising: { db: "main", sql: "SELECT max(created_at) AS at FROM fundraisers WHERE created_at > $1" },
};

// ---- The same arrivals, itemised, for phone notifications (TASK-NNN) ----
//
// A New pill only needs the latest time. A notification has to say what each arrival WAS, so
// these are the sibling queries that return the rows rather than a max(). Same tables, same
// conditions, same databases as LATEST above — deliberately, so the phone and the screen can
// never disagree about what counts as new. When one is changed, change its twin.
//
// Only the eight areas that have a LATEST entry appear here. The others carry a pill when the
// SCREEN is new and have no arrivals at all.
const DETAILS: Record<keyof typeof LATEST, { db: "main" | "contact" | "stories"; sql: string }> = {
  contact: {
    db: "contact",
    sql: "SELECT created_at AS at FROM contact_enquiries WHERE created_at > $1 ORDER BY created_at LIMIT $2",
  },
  stories: {
    db: "stories",
    sql: "SELECT created_at AS at FROM stories WHERE created_at > $1 ORDER BY created_at LIMIT $2",
  },
  donations: {
    db: "main",
    sql: `SELECT created_at AS at, amount_pence AS "amountPence", payment_channel AS channel
            FROM donations WHERE payment_status = 'paid' AND created_at > $1
           ORDER BY created_at LIMIT $2`,
  },
  monthly: {
    db: "main",
    sql: `SELECT first_paid_at AS at, amount_pence AS "amountPence" FROM (
            SELECT min(d.created_at) AS first_paid_at,
                   min(d.amount_pence) AS amount_pence
              FROM donations d JOIN donors dn ON dn.id = d.donor_id
             WHERE d.mode = 'monthly' AND d.payment_status = 'paid' AND dn.donor_type = 'individual'
             GROUP BY d.donor_id
          ) firsts WHERE first_paid_at > $1 ORDER BY first_paid_at LIMIT $2`,
  },
  fulfilments: {
    db: "main",
    sql: "SELECT created_at AS at FROM business_supporter_fulfilment WHERE created_at > $1 ORDER BY created_at LIMIT $2",
  },
  ball: {
    db: "main",
    sql: `SELECT at FROM (
            SELECT paid_at AS at FROM ball_bookings WHERE status = 'paid' AND paid_at > $1
            UNION ALL
            SELECT created_at FROM ball_bookings
             WHERE payment_method = 'transfer' AND status = 'pending' AND created_at > $1
          ) arrivals ORDER BY at LIMIT $2`,
  },
  newsletter: {
    db: "main",
    sql: `SELECT consented_at AS at FROM list_subscribers
           WHERE consent_source IN ('footer', 'fundraise') AND unsubscribed_at IS NULL AND consented_at > $1
           ORDER BY consented_at LIMIT $2`,
  },
  fundraising: {
    db: "main",
    sql: "SELECT created_at AS at FROM fundraisers WHERE created_at > $1 ORDER BY created_at LIMIT $2",
  },
};

export interface ArrivalItem {
  at: Date;
  area: Area;
  /** The line a notification shows, already stripped of anything identifying. */
  line: string;
}

/**
 * Everything that arrived in a section after `since`, as lines ready to send.
 *
 * `limit` bounds a burst: a CSV import or a webhook replay can put hundreds of rows in at once,
 * and there is no point reading them all when the caller collapses anything over twenty into a
 * single "N new things" anyway.
 */
export async function arrivalDetails(area: Area, since: Date, limit = 50): Promise<ArrivalItem[]> {
  const q = (DETAILS as Partial<Record<Area, { db: "main" | "contact" | "stories"; sql: string }>>)[area];
  if (!q) return [];
  const db = q.db === "contact" ? contactPool : q.db === "stories" ? storiesPool : pool;
  const res = await db.query<{ at: Date } & Record<string, unknown>>(q.sql, [since, limit]);
  return res.rows.flatMap((row) => {
    const line = arrivalLine(area, row);
    return line ? [{ at: row.at, area, line }] : [];
  });
}

/** The latest arrival in a section after `since`, or null when nothing has arrived since. */
export async function latestArrival(area: Area, since: Date): Promise<Date | null> {
  // The Events page and Admin > Analytics have new features, not arrivals.
  // TASK-492: nor does QR codes.
  // Nor does the Fill a Red Bag list's editor.
  if (area === "events" || area === "analytics" || area === "qr" || area === "red-bag" || area === "invoices") return null;
  const q = LATEST[area];
  const db = q.db === "contact" ? contactPool : q.db === "stories" ? storiesPool : pool;
  const res = await db.query<{ at: Date | null }>(q.sql, [since]);
  return res.rows[0]?.at ?? null;
}
