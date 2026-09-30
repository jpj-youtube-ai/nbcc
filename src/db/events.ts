import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "./pool";
import { insertAudit } from "./donations";
import { isOnPage, slugify, sortForPage, type EventInput, type EventRecord } from "../events/model";

// TASK-453: the SQL behind the /events page and the admin's Events section. The rules (what may be
// saved, what is on the page, in what order) live in src/events/model.ts; this file only moves rows.
//
// Every change a person makes writes its audit_log row in the SAME transaction as the change, so
// there is never an event edit without a record of who made it, or a record of one that did not
// happen.

export interface EventRow extends EventRecord {
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
  updatedBy: string | null;
}

export interface EventsSettings {
  pageOn: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

// Field -> column. Written out rather than generated from the object's keys, so a field can only
// reach SQL by being named here.
const COLUMNS: Record<keyof EventInput, string> = {
  name: "name",
  subtitle: "subtitle",
  gist: "gist",
  date: "event_date",
  start: "start_time",
  end: "end_time",
  timeTbc: "time_tbc",
  venue: "venue",
  town: "town",
  address: "address",
  access: "access",
  imageSrc: "image_src",
  imageFit: "image_fit",
  imageGround: "image_ground",
  imageAlt: "image_alt",
  cover: "cover",
  costFront: "cost_front",
  costBack: "cost_back",
  flag: "flag",
  listHeading: "list_heading",
  whatsOn: "whats_on",
  note: "note",
  runBy: "run_by",
  partnerName: "partner_name",
  partnerFront: "partner_front",
  partnerCredit: "partner_credit",
  partnerLogoSrc: "partner_logo_src",
  partnerLine: "partner_line",
  bookingHow: "booking_how",
  bookingUrl: "booking_url",
  bookingLabel: "booking_label",
  bookingNote: "booking_note",
  status: "status",
  showFrom: "show_from",
};
const FIELDS = Object.keys(COLUMNS) as (keyof EventInput)[];

// Dates and times come back as text in a fixed shape. node-postgres would otherwise turn a DATE
// into a JavaScript Date at local midnight, which is a day out whenever the server is not on UK
// time - and the date is what decides whether an event is on the page at all.
const SELECT = `
  SELECT id, slug, name, subtitle, gist,
         to_char(event_date, 'YYYY-MM-DD') AS event_date,
         to_char(start_time, 'HH24:MI') AS start_time,
         to_char(end_time, 'HH24:MI') AS end_time,
         time_tbc, venue, town, address, access,
         image_src, image_fit, image_ground, image_alt, cover,
         cost_front, cost_back, flag, list_heading, whats_on, note,
         run_by, partner_name, partner_front, partner_credit, partner_logo_src, partner_line,
         booking_how, booking_url, booking_label, booking_note,
         status, to_char(show_from, 'YYYY-MM-DD') AS show_from,
         created_at, created_by, updated_at, updated_by
    FROM events`;

const ORDER = "ORDER BY event_date, start_time NULLS LAST, name";

type Row = Record<string, unknown>;

function toRow(r: Row): EventRow {
  const out: Record<string, unknown> = { id: Number(r.id), slug: r.slug };
  for (const field of FIELDS) out[field] = r[COLUMNS[field]];
  out.access = (r.access as string[] | null) ?? [];
  out.createdAt = new Date(r.created_at as string).toISOString();
  out.createdBy = r.created_by ?? null;
  out.updatedAt = new Date(r.updated_at as string).toISOString();
  out.updatedBy = r.updated_by ?? null;
  return out as unknown as EventRow;
}

async function inTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// --- the page switch -----------------------------------------------------------------------------

export async function getEventsSettings(): Promise<EventsSettings> {
  const r = await pool.query<{ page_on: boolean; updated_at: string; updated_by: string | null }>(
    "SELECT page_on, updated_at, updated_by FROM events_settings WHERE id = 1",
  );
  const row = r.rows[0];
  if (!row) return { pageOn: false, updatedAt: null, updatedBy: null };
  return { pageOn: row.page_on, updatedAt: new Date(row.updated_at).toISOString(), updatedBy: row.updated_by };
}

/** Is the page switched on? Any failure reads as OFF: never a menu link to a page that is not there. */
export async function eventsPageIsOn(): Promise<boolean> {
  try {
    return (await getEventsSettings()).pageOn;
  } catch {
    return false;
  }
}

/** Turn the whole page on or off. Recorded with who did it, including a switch to the same state. */
export async function setEventsPageOn(pageOn: boolean, actor: string): Promise<EventsSettings> {
  return inTransaction(async (client) => {
    const before = await client.query<{ page_on: boolean }>(
      "SELECT page_on FROM events_settings WHERE id = 1 FOR UPDATE",
    );
    await client.query(
      `INSERT INTO events_settings (id, page_on, updated_at, updated_by) VALUES (1, $1, now(), $2)
       ON CONFLICT (id) DO UPDATE SET page_on = $1, updated_at = now(), updated_by = $2`,
      [pageOn, actor],
    );
    await insertAudit(client, {
      actor,
      action: "events.page_switched",
      entity: "events_settings",
      entityId: 1,
      data: { pageOn, wasOn: before.rows[0]?.page_on ?? false },
    });
    const r = await client.query<{ page_on: boolean; updated_at: string; updated_by: string | null }>(
      "SELECT page_on, updated_at, updated_by FROM events_settings WHERE id = 1",
    );
    const row = r.rows[0];
    return { pageOn: row.page_on, updatedAt: new Date(row.updated_at).toISOString(), updatedBy: row.updated_by };
  });
}

// --- events --------------------------------------------------------------------------------------

export async function listAllEvents(): Promise<EventRow[]> {
  const r = await pool.query(`${SELECT} ${ORDER}`);
  return r.rows.map(toRow);
}

export async function getEvent(id: number): Promise<EventRow | null> {
  const r = await pool.query(`${SELECT} WHERE id = $1`, [id]);
  return r.rows[0] ? toRow(r.rows[0]) : null;
}

/** What is on the page today, soonest first. The rule itself is isOnPage, shared with the admin. */
export async function listPageEvents(today: string): Promise<EventRow[]> {
  const r = await pool.query(`${SELECT} WHERE status <> 'draft' AND event_date >= $1 ${ORDER}`, [today]);
  return sortForPage(r.rows.map(toRow).filter((ev) => isOnPage(ev, today)));
}

// A slug nobody else has: the name's, then -2, -3... Fixed once made, so a shared link to a card
// keeps working when the event is renamed.
async function freeSlug(client: PoolClient, name: string): Promise<string> {
  const base = slugify(name);
  const taken = new Set(
    (
      await client.query<{ slug: string }>("SELECT slug FROM events WHERE slug = $1 OR slug LIKE $2", [
        base,
        `${base}-%`,
      ])
    ).rows.map((r) => r.slug),
  );
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

function values(input: EventInput): unknown[] {
  return FIELDS.map((f) => input[f]);
}

export async function createEvent(input: EventInput, actor: string): Promise<EventRow> {
  return inTransaction(async (client) => {
    const slug = await freeSlug(client, input.name);
    const cols = FIELDS.map((f) => COLUMNS[f]);
    const params = [slug, ...values(input), actor, actor];
    const placeholders = params.map((_, i) => `$${i + 1}`).join(", ");
    const inserted = await client.query<{ id: number }>(
      `INSERT INTO events (slug, ${cols.join(", ")}, created_by, updated_by) VALUES (${placeholders}) RETURNING id`,
      params,
    );
    const id = Number(inserted.rows[0].id);
    await insertAudit(client, {
      actor,
      action: "events.created",
      entity: "event",
      entityId: id,
      data: { slug, name: input.name, date: input.date, status: input.status },
    });
    const r = await client.query(`${SELECT} WHERE id = $1`, [id]);
    return toRow(r.rows[0]);
  });
}

/** Save a new version of an event. Null when it no longer exists. The audit row names what changed. */
export async function updateEvent(id: number, input: EventInput, actor: string): Promise<EventRow | null> {
  return inTransaction(async (client) => {
    const found = await client.query(`${SELECT} WHERE id = $1 FOR UPDATE`, [id]);
    if (!found.rows[0]) return null;
    const before = toRow(found.rows[0]);

    const sets = FIELDS.map((f, i) => `${COLUMNS[f]} = $${i + 1}`).join(", ");
    const params = [...values(input), actor, id];
    await client.query(
      `UPDATE events SET ${sets}, updated_at = now(), updated_by = $${FIELDS.length + 1} WHERE id = $${FIELDS.length + 2}`,
      params,
    );

    const changed = FIELDS.filter((f) => JSON.stringify(before[f]) !== JSON.stringify(input[f]));
    await insertAudit(client, {
      actor,
      action: "events.updated",
      entity: "event",
      entityId: id,
      data: { slug: before.slug, name: input.name, changed, status: input.status, wasStatus: before.status },
    });
    const r = await client.query(`${SELECT} WHERE id = $1`, [id]);
    return toRow(r.rows[0]);
  });
}

/** Remove an event for good. The audit row keeps what it was. Null when it did not exist. */
export async function deleteEvent(id: number, actor: string): Promise<{ id: number; name: string } | null> {
  return inTransaction(async (client) => {
    const found = await client.query(`${SELECT} WHERE id = $1 FOR UPDATE`, [id]);
    if (!found.rows[0]) return null;
    const ev = toRow(found.rows[0]);
    await client.query("DELETE FROM events WHERE id = $1", [id]);
    await insertAudit(client, {
      actor,
      action: "events.deleted",
      entity: "event",
      entityId: id,
      data: { slug: ev.slug, name: ev.name, date: ev.date, status: ev.status },
    });
    return { id, name: ev.name };
  });
}

// --- pictures ------------------------------------------------------------------------------------

export async function insertEventImage(mime: string, bytes: Buffer, uploadedBy: number | null): Promise<{ id: string }> {
  const id = randomUUID();
  await pool.query(
    "INSERT INTO event_images (id, mime, bytes, byte_size, uploaded_by) VALUES ($1, $2, $3, $4, $5)",
    [id, mime, bytes, bytes.length, uploadedBy],
  );
  return { id };
}

export async function getEventImage(id: string): Promise<{ mime: string; bytes: Buffer } | null> {
  const r = await pool.query<{ mime: string; bytes: Buffer }>("SELECT mime, bytes FROM event_images WHERE id = $1", [id]);
  return r.rows[0] ?? null;
}
