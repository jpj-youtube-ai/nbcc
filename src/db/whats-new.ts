import { pool } from "./pool";
import { contactPool } from "./contact-pool";
import { storiesPool } from "./stories-pool";
import { arrivalLine, type Area, type ArrivalItem } from "../admin/whats-new";

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
    sql: `SELECT at, count(*) OVER () AS total FROM (
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
  // Elf Detective School: a photo a family sent that is still waiting for a head elf, when it was
  // sent. The same condition as the photo check (src/db/elf-photos.ts photosWaiting): waiting, and
  // the family not removed. The practice door's photos (door 0) count too.
  elf: {
    db: "main",
    sql: `SELECT max(p.sent_at) AS at FROM elf_photos p JOIN elf_families f ON f.id = p.family_id
           WHERE p.status = 'waiting' AND f.removed_at IS NULL AND p.sent_at > $1`,
  },
};

// ---- The same arrivals, itemised, for phone notifications (TASK-619) ----
//
// A New pill only needs the latest time. A notification has to say what each arrival WAS, so
// these are the sibling queries that return the rows rather than a max(). Same tables, same
// conditions, same databases as LATEST above — deliberately, so the phone and the screen can
// never disagree about what counts as new. When one is changed, change its twin.
//
// Only the nine areas that have a LATEST entry appear here. The others carry a pill when the
// SCREEN is new and have no arrivals at all.
const DETAILS: Record<keyof typeof LATEST, { db: "main" | "contact" | "stories"; sql: string }> = {
  contact: {
    db: "contact",
    sql: `SELECT created_at AS at, count(*) OVER () AS total FROM contact_enquiries
            WHERE created_at > $1::timestamptz AND created_at <= $2 ORDER BY created_at LIMIT $3`,
  },
  stories: {
    db: "stories",
    sql: `SELECT created_at AS at, count(*) OVER () AS total FROM stories
            WHERE created_at > $1::timestamptz AND created_at <= $2 ORDER BY created_at LIMIT $3`,
  },
  donations: {
    db: "main",
    sql: `SELECT created_at AS at, amount_pence AS "amountPence", payment_channel AS channel,
                 count(*) OVER () AS total
            FROM donations
           WHERE payment_status = 'paid' AND created_at > $1::timestamptz AND created_at <= $2
           ORDER BY created_at LIMIT $3`,
  },
  monthly: {
    db: "main",
    // DISTINCT ON, not GROUP BY with min(): the amount wanted is the one on the FIRST gift, and
    // min(amount_pence) would report the smallest gift that donor has ever made instead.
    sql: `SELECT at, "amountPence", count(*) OVER () AS total FROM (
            SELECT DISTINCT ON (d.donor_id) d.created_at AS at, d.amount_pence AS "amountPence"
              FROM donations d JOIN donors dn ON dn.id = d.donor_id
             WHERE d.mode = 'monthly' AND d.payment_status = 'paid' AND dn.donor_type = 'individual'
             ORDER BY d.donor_id, d.created_at
          ) firsts WHERE at > $1::timestamptz AND at <= $2 ORDER BY at LIMIT $3`,
  },
  fulfilments: {
    db: "main",
    sql: `SELECT created_at AS at, count(*) OVER () AS total FROM business_supporter_fulfilment
            WHERE created_at > $1::timestamptz AND created_at <= $2 ORDER BY created_at LIMIT $3`,
  },
  ball: {
    db: "main",
    sql: `SELECT at, count(*) OVER () AS total FROM (
            SELECT paid_at AS at FROM ball_bookings
             WHERE status = 'paid' AND paid_at > $1::timestamptz AND paid_at <= $2
               -- The ONE place a notification deliberately differs from its pill. A member of
               -- staff ticking a bank transfer as received sets paid_at AND marked_paid_by, so
               -- without this that click buzzes every phone in the charity — and the booking
               -- would buzz twice, once when it was made and again when the money was marked in.
               -- Jaimie, 12 Nov: "nothing a staff member does should buzz." A card payment sets
               -- paid_at with no marked_paid_by, so the public paying still counts.
               AND marked_paid_by IS NULL
            UNION ALL
            SELECT created_at FROM ball_bookings
             WHERE payment_method = 'transfer' AND status = 'pending'
               AND created_at > $1::timestamptz AND created_at <= $2
          ) arrivals ORDER BY at LIMIT $3`,
  },
  newsletter: {
    db: "main",
    sql: `SELECT consented_at AS at, count(*) OVER () AS total FROM list_subscribers
           WHERE consent_source IN ('footer', 'fundraise') AND unsubscribed_at IS NULL
             AND consented_at > $1::timestamptz AND consented_at <= $2
           ORDER BY consented_at LIMIT $3`,
  },
  fundraising: {
    db: "main",
    sql: `SELECT created_at AS at, count(*) OVER () AS total FROM fundraisers
            WHERE created_at > $1::timestamptz AND created_at <= $2 ORDER BY created_at LIMIT $3`,
  },
  // Only the time: nothing that names a family, a child, a detective or a place is selected.
  //
  // BOTH ends of the window are shifted back two minutes. The upload stamps sent_at at the start of
  // the request, before the slow work (a phone upload, then the picture's encode passes) and the
  // commit, so a sweep can run while a photo's row is not yet visible. Looking two minutes behind
  // the sweep covers that; shifting both ends keeps the windows tiling exactly, so nothing is sent
  // twice. (The New mark's twin above needs no shift: it has no window.)
  elf: {
    db: "main",
    sql: `SELECT p.sent_at AS at, count(*) OVER () AS total
            FROM elf_photos p JOIN elf_families f ON f.id = p.family_id
           WHERE p.status = 'waiting' AND f.removed_at IS NULL
             AND p.sent_at > $1::timestamptz - interval '2 minutes'
             AND p.sent_at <= $2::timestamptz - interval '2 minutes'
           ORDER BY p.sent_at LIMIT $3`,
  },
};

export type { ArrivalItem };

/**
 * Everything that arrived in a section in the window `(since, until]`, as lines ready to send.
 *
 * `since` is a STRING, deliberately, and must be the exact text the cursor was stored as.
 * Postgres keeps timestamps to the microsecond; node-postgres hands JavaScript a Date, which
 * holds only milliseconds, and it truncates rather than rounds. A cursor written back from one of
 * those Dates lands a fraction BEFORE the row it came from, so that row satisfies
 * `created_at > cursor` for ever and is sent again on every later sweep. Carrying the
 * full-precision text is what keeps the window exact.
 *
 * `until` closes the window, so the caller can claim it before reading rather than after.
 *
 * `limit` bounds a burst: a CSV import or a webhook replay can put hundreds of rows in at once,
 * and there is no point reading them all when the caller collapses anything over twenty into a
 * single "N new things" anyway.
 */
export async function arrivalDetails(
  area: Area,
  since: string,
  until: Date,
  limit = 21,
): Promise<{ items: ArrivalItem[]; total: number }> {
  const q = (DETAILS as Partial<Record<Area, { db: "main" | "contact" | "stories"; sql: string }>>)[area];
  if (!q) return { items: [], total: 0 };
  const db = q.db === "contact" ? contactPool : q.db === "stories" ? storiesPool : pool;
  const res = await db.query<{ at: Date; total: string } & Record<string, unknown>>(q.sql, [since, until, limit]);
  const items = res.rows.flatMap((row) => {
    const line = arrivalLine(area, row);
    return line ? [{ at: row.at, area, line }] : [];
  });
  // count(*) OVER () is the size of the WHOLE window, not of the page we read. The caller claimed
  // this window before reading it, so anything past the limit will never be offered again — and
  // since everything over the burst cap collapses into one "N new things" anyway, the exact count
  // is all that is needed beyond the first few rows.
  return { items, total: res.rows.length > 0 ? Number(res.rows[0].total) : 0 };
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
