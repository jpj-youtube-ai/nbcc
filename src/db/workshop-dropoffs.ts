import { pool } from "./pool";

// Workshop drop-offs (docs/superpowers/specs/2026-11-28-workshop-dropoffs-design.md): somebody who
// brought something into the Elves' Workshop and left their details on the tablet page at /workshop.

export interface DropOffInput {
  name: string;
  email: string;
  brought: string;
  groupName: string | null;
  phone: string | null;
  newsletter: boolean;
}

export interface DropOffRow extends DropOffInput {
  id: number;
  createdAt: Date;
  /** The latest gift in kind thank-you letter sent to the same email since they dropped off, if any. */
  letterSentAt: Date | null;
}

export async function insertDropOff(d: DropOffInput): Promise<number> {
  const res = await pool.query<{ id: number }>(
    `INSERT INTO workshop_dropoffs (name, email, brought, group_name, phone, newsletter)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [d.name, d.email, d.brought, d.groupName, d.phone, d.newsletter],
  );
  return res.rows[0].id;
}

interface Row {
  id: number;
  name: string;
  email: string;
  brought: string;
  group_name: string | null;
  phone: string | null;
  newsletter: boolean;
  created_at: Date;
  letter_sent_at: Date | null;
}

/** Every drop-off, newest first. A few a day at most, so the whole list is small. */
export async function listDropOffs(): Promise<DropOffRow[]> {
  const res = await pool.query<Row>(
    `SELECT d.id, d.name, d.email, d.brought, d.group_name, d.phone, d.newsletter, d.created_at,
            (SELECT max(t.sent_at) FROM thank_you_sent t
              WHERE lower(t.recipient_email) = lower(d.email)
                AND t.gift_type = 'in_kind'
                AND t.sent_at >= d.created_at) AS letter_sent_at
       FROM workshop_dropoffs d
      ORDER BY d.created_at DESC, d.id DESC`,
  );
  return res.rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    brought: r.brought,
    groupName: r.group_name,
    phone: r.phone,
    newsletter: r.newsletter,
    createdAt: r.created_at,
    letterSentAt: r.letter_sent_at,
  }));
}

export async function removeDropOff(id: number): Promise<boolean> {
  const res = await pool.query("DELETE FROM workshop_dropoffs WHERE id = $1", [id]);
  return (res.rowCount ?? 0) > 0;
}
