import type { PoolClient } from "pg";
import { pool } from "./pool";
import { insertAudit } from "./donations";
import { ACCESS } from "../events/model";
import {
  approveProblem,
  BOOKINGS,
  finishTimeProblem,
  hasPage,
  meter,
  organiserNameFor,
  socialLinkFor,
  wallEntries,
  wallStepVerdict,
  type AdminPatch,
  type FundraiserEdit,
  type FundraiserRecord,
  type FundraiserSplit,
  type GiftForSession,
  type Meter,
  type SignUp,
  type WallEntry,
  type WallMessage,
  type WallSourceRow,
  type WallStepVerdict,
} from "../fundraising/model";
import { freeSlugFrom, initialsSlug } from "../fundraising/slugs";
import { SETUP_BY } from "../fundraising/in-memory";

// TASK-493: the SQL behind community fundraising. The rules live in src/fundraising/model.ts; this
// file only moves rows. Every write a person makes (staff, an organiser, the public form, Stripe)
// writes its audit_log row in the SAME transaction, against entity "fundraiser" and the
// fundraiser's id, so the admin's History for a fundraiser is one query.

export type FundraiserErrorReason =
  | "not_found"
  | "bad_status"
  | "slug_taken"
  | "not_waiting"
  | "replaced"
  | "bad_times"
  // Event pages: an event cannot be approved until staff have set its short name (approveProblem).
  | "needs_short_name"
  // Jaimie, 2026-10-03: the split cannot change once a fundraiser has had a gift.
  | "has_gifts"
  // Team pages: a member page's whole team split is the team's to change, never one member's.
  | "team_split"
  // Team pages: a team, or a page still on one, raises money: it can never be made an event.
  | "team_path"
  // Team pages: a team that shares must say whose split it is.
  | "team_mode_missing";

export class FundraiserError extends Error {
  constructor(
    public readonly reason: FundraiserErrorReason,
    /** For bad_times: the time the change would leave wrong (startTime or endTime). */
    public readonly field?: string,
  ) {
    super(`fundraiser: ${reason}`);
    this.name = "FundraiserError";
  }
}

// A change of one time is checked against the other as the row holds it (TASK-499 review), so the
// finish never ends up before the start. Run under the row's lock, before anything is written.
function checkTimes(before: FundraiserRecord, change: Record<string, unknown>): void {
  const field = finishTimeProblem(before, change);
  if (field) throw new FundraiserError("bad_times", field);
}

export interface FundraisingSettings {
  pageOn: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

// Field -> column, written out so a field reaches SQL only by being named here.
const COLUMNS = {
  path: "path",
  kind: "kind",
  title: "title",
  description: "description",
  eventDate: "event_date",
  startTime: "start_time",
  venue: "venue",
  town: "town",
  targetPence: "target_pence",
  public: "public",
  name: "organiser_name",
  email: "organiser_email",
  phone: "organiser_phone",
  socialLink: "social_link",
  socialOk: "social_ok",
  wants: "wants",
  postAddress: "post_address",
  newsletterOk: "newsletter_ok",
  imageSrc: "image_src",
  slug: "slug",
  // TASK-499
  postLine1: "post_line1",
  postLine2: "post_line2",
  postTown: "post_town",
  postPostcode: "post_postcode",
  cardLine: "card_line",
  endTime: "end_time",
  timeTbc: "time_tbc",
  venueAddress: "venue_address",
  venuePostcode: "venue_postcode",
  access: "access",
  price: "price",
  booking: "booking",
  ticketUrl: "ticket_url",
  ageLimit: "age_limit",
  dressCode: "dress_code",
  included: "included",
  creditName: "credit_name",
  // TASK-511
  firstName: "first_name",
  lastName: "last_name",
  kindOther: "kind_other",
  instagram: "instagram",
  facebook: "facebook",
} as const;
type PatchField = keyof typeof COLUMNS;

const RECORD_COLUMNS = `f.id, f.slug, f.path, f.kind, f.title, f.description,
         to_char(f.event_date, 'YYYY-MM-DD') AS event_date,
         to_char(f.start_time, 'HH24:MI') AS start_time,
         f.venue, f.town, f.target_pence, f.public, f.status,
         f.organiser_name, f.organiser_email, f.organiser_phone, f.social_link, f.social_ok,
         f.wants, f.post_address, f.newsletter_ok, f.image_src, f.declined_reason,
         f.created_at, f.approved_at, f.approved_by, f.updated_at, f.updated_by,
         f.post_line1, f.post_line2, f.post_town, f.post_postcode, f.card_line,
         to_char(f.end_time, 'HH24:MI') AS end_time,
         f.time_tbc, f.venue_address, f.venue_postcode, f.access, f.price, f.booking, f.ticket_url,
         f.age_limit, f.dress_code, f.included, f.credit_name, f.finished_requested_at,
         f.off_list_at, f.off_list_by,
         f.first_name, f.last_name, f.kind_other, f.instagram, f.facebook,
         f.over_18, f.shares_with_other, f.nbcc_share_percent, f.other_cause_name,
         f.slug_set_at,
         f.is_team, f.team_id, f.team_share_mode, f.team_left_at, f.team_nudge_1_at, f.team_nudge_2_at,
         f.in_memory, f.memory_name, f.memory_dates, f.memory_setup_by, f.memory_permission, f.memory_show_target,
         f.memory_reminder_done_at, f.memory_reminder_done_by,
         (SELECT c.label FROM fundraising_categories c WHERE c.key = f.kind) AS kind_label`;
const SELECT = `
  SELECT ${RECORD_COLUMNS}
    FROM fundraisers f`;
/** Team pages: the same select, for reads in src/db/fundraising-teams.ts (toRecord reads it). */
export const FUNDRAISER_SELECT = SELECT;

// Online: paid gifts less refunds. Cash: what staff recorded as paid in. Summed per fundraiser.
const ONLINE_SQL = `(SELECT COALESCE(SUM(GREATEST(d.amount_pence - d.refunded_amount_pence, 0))
                       FILTER (WHERE d.payment_status = 'paid'), 0)
                       FROM donations d WHERE d.fundraiser_id = f.id)`;
const CASH_SQL = `(SELECT COALESCE(SUM(c.amount_pence), 0) FROM fundraiser_cash c WHERE c.fundraiser_id = f.id)`;
// TASK-502: the Gift Aid shown under the meter, never added to it: a quarter of each paid gift that
// claimed it, on what is left after any refund, rounded down per gift (integer division), never on
// money the organiser paid in. The same sum as giftAidOnGifts in src/fundraising/model.ts.
const GIFT_AID_SQL = `(SELECT COALESCE(SUM(GREATEST(d.amount_pence - d.refunded_amount_pence, 0) / 4)
                       FILTER (WHERE d.payment_status = 'paid' AND d.gift_aid AND NOT d.paid_in_by_organiser), 0)
                       FROM donations d WHERE d.fundraiser_id = f.id)`;
const WAITING_SQL = `EXISTS (SELECT 1 FROM fundraiser_edits e WHERE e.fundraiser_id = f.id AND e.status = 'waiting')`;

type Row = Record<string, unknown>;
const iso = (v: unknown): string | null => (v == null ? null : new Date(v as string).toISOString());
const textOrNull = (v: unknown): string | null => (v == null ? null : String(v));
const num = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);

export function toRecord(r: Row): FundraiserRecord {
  const wants = (r.wants ?? {}) as Record<string, unknown>;
  return {
    id: Number(r.id),
    slug: String(r.slug),
    path: r.path as FundraiserRecord["path"],
    kind: String(r.kind),
    // The category's name now (it may have been renamed); an old category keeps its old name.
    kindLabel: textOrNull(r.kind_label) ?? undefined,
    title: String(r.title),
    description: String(r.description ?? ""),
    eventDate: (r.event_date as string | null) ?? null,
    startTime: (r.start_time as string | null) ?? null,
    venue: String(r.venue ?? ""),
    town: String(r.town ?? ""),
    targetPence: r.target_pence == null ? null : Number(r.target_pence),
    public: Boolean(r.public),
    status: r.status as FundraiserRecord["status"],
    name: String(r.organiser_name),
    email: String(r.organiser_email),
    phone: String(r.organiser_phone),
    socialLink: (r.social_link as string | null) ?? null,
    socialOk: Boolean(r.social_ok),
    // TASK-499: the four split requests, and the two combined ones a sign up from before carries.
    wants: {
      posterCount: num(wants.posterCount ?? 0),
      leafletCount: num(wants.leafletCount ?? 0),
      bucketCount: num(wants.bucketCount ?? 0),
      tinCount: num(wants.tinCount ?? 0),
      leaflets: num(wants.leaflets ?? 0),
      buckets: num(wants.buckets ?? 0),
      // TASK-511: printed QR codes; none on a sign up from before.
      qrCount: num(wants.qrCount ?? 0),
      shoutOut: Boolean(wants.shoutOut),
      attend: Boolean(wants.attend),
    },
    postAddress: (r.post_address as string | null) ?? null,
    postLine1: textOrNull(r.post_line1),
    postLine2: textOrNull(r.post_line2),
    postTown: textOrNull(r.post_town),
    postPostcode: textOrNull(r.post_postcode),
    newsletterOk: Boolean(r.newsletter_ok),
    imageSrc: (r.image_src as string | null) ?? null,
    declinedReason: (r.declined_reason as string | null) ?? null,
    createdAt: iso(r.created_at) as string,
    approvedAt: iso(r.approved_at),
    approvedBy: (r.approved_by as string | null) ?? null,
    updatedAt: iso(r.updated_at) as string,
    updatedBy: (r.updated_by as string | null) ?? null,
    cardLine: textOrNull(r.card_line),
    endTime: textOrNull(r.end_time),
    timeTbc: Boolean(r.time_tbc),
    venueAddress: textOrNull(r.venue_address),
    venuePostcode: textOrNull(r.venue_postcode),
    // Only what the code knows, in the card's order, whatever the row holds.
    access: ACCESS.filter((a) => Array.isArray(r.access) && (r.access as unknown[]).includes(a)),
    price: textOrNull(r.price),
    booking: (BOOKINGS as readonly string[]).includes(String(r.booking)) ? (r.booking as FundraiserRecord["booking"]) : null,
    ticketUrl: textOrNull(r.ticket_url),
    ageLimit: textOrNull(r.age_limit),
    dressCode: textOrNull(r.dress_code),
    included: textOrNull(r.included),
    creditName: textOrNull(r.credit_name),
    finishedRequestedAt: iso(r.finished_requested_at),
    // TASK-503: taken off the Get involved list by staff (its page still works).
    offListAt: iso(r.off_list_at),
    offListBy: textOrNull(r.off_list_by),
    // TASK-511: empty on a sign up from before.
    firstName: textOrNull(r.first_name),
    lastName: textOrNull(r.last_name),
    kindOther: textOrNull(r.kind_other),
    instagram: textOrNull(r.instagram),
    facebook: textOrNull(r.facebook),
    // Jaimie, 2026-10-03: null on a sign up from before they were asked.
    over18: r.over_18 == null ? null : Boolean(r.over_18),
    sharesWithOther: r.shares_with_other == null ? null : Boolean(r.shares_with_other),
    nbccSharePercent: r.nbcc_share_percent == null ? null : Number(r.nbcc_share_percent),
    otherCauseName: textOrNull(r.other_cause_name),
    // Event pages: when staff last set its short name; null before then.
    slugSetAt: iso(r.slug_set_at),
    // Team pages: false and null on everything that is not a team or a member of one.
    isTeam: r.is_team === true,
    teamId: r.team_id == null ? null : Number(r.team_id),
    teamShareMode: r.team_share_mode === "team" || r.team_share_mode === "organiser" ? r.team_share_mode : null,
    teamLeftAt: iso(r.team_left_at),
    teamNudge1At: iso(r.team_nudge_1_at),
    teamNudge2At: iso(r.team_nudge_2_at),
    // In memory (Jaimie, 2026-10-03): false on every other row, and on one from before.
    inMemory: r.in_memory === true,
    memoryName: textOrNull(r.memory_name),
    memoryDates: textOrNull(r.memory_dates),
    memorySetupBy: (SETUP_BY as readonly string[]).includes(String(r.memory_setup_by)) ? (r.memory_setup_by as FundraiserRecord["memorySetupBy"]) : null,
    memoryPermission: r.memory_permission == null ? null : Boolean(r.memory_permission),
    memoryShowTarget: r.memory_show_target == null ? null : Boolean(r.memory_show_target),
    memoryReminderDoneAt: iso(r.memory_reminder_done_at),
    memoryReminderDoneBy: textOrNull(r.memory_reminder_done_by),
  };
}

const meterOf = (r: Row): Meter =>
  meter({
    onlinePence: Number(r.online_pence ?? 0),
    cashPence: Number(r.cash_pence ?? 0),
    targetPence: r.target_pence == null ? null : Number(r.target_pence),
    giftAidPence: Number(r.gift_aid_pence ?? 0),
  });

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

/**
 * The SET list and values for a partial change. Pure apart from its types: a field reaches SQL only
 * through COLUMNS, and wants goes in as JSON. Placeholders start at $start.
 */
export function patchAssignments(patch: Partial<Record<PatchField, unknown>>, start = 1): { sets: string[]; values: unknown[]; fields: PatchField[] } {
  const fields = (Object.keys(patch) as PatchField[]).filter((f) => f in COLUMNS && patch[f] !== undefined);
  const sets = fields.map((f, i) => `${COLUMNS[f]} = $${start + i}`);
  const values = fields.map((f) => (f === "wants" ? JSON.stringify(patch[f]) : patch[f]));
  return { sets, values, fields };
}

async function lockFundraiser(client: PoolClient, id: number): Promise<FundraiserRecord> {
  const found = await client.query(`${SELECT} WHERE f.id = $1 FOR UPDATE`, [id]);
  if (!found.rows[0]) throw new FundraiserError("not_found");
  return toRecord(found.rows[0]);
}

async function reread(client: PoolClient, id: number): Promise<FundraiserRecord> {
  return toRecord((await client.query(`${SELECT} WHERE f.id = $1`, [id])).rows[0]);
}

async function applyPatch(
  client: PoolClient,
  id: number,
  patch: Partial<Record<PatchField, unknown>>,
  actor: string,
): Promise<PatchField[]> {
  if (typeof patch.slug === "string") {
    const taken = await client.query("SELECT 1 FROM fundraisers WHERE slug = $1 AND id <> $2", [patch.slug, id]);
    if (taken.rows.length > 0) throw new FundraiserError("slug_taken");
  }
  const { sets, values, fields } = patchAssignments(patch, 1);
  if (fields.length === 0) return [];
  await client.query(
    `UPDATE fundraisers SET ${sets.join(", ")}, updated_at = now(), updated_by = $${fields.length + 1} WHERE id = $${fields.length + 2}`,
    [...values, actor, id],
  );
  return fields;
}

// --- the switch ----------------------------------------------------------------------------------

export async function getFundraisingSettings(): Promise<FundraisingSettings> {
  const r = await pool.query<{ page_on: boolean; updated_at: string; updated_by: string | null }>(
    "SELECT page_on, updated_at, updated_by FROM fundraising_settings WHERE id = 1",
  );
  const row = r.rows[0];
  if (!row) return { pageOn: false, updatedAt: null, updatedBy: null };
  return { pageOn: row.page_on, updatedAt: iso(row.updated_at), updatedBy: row.updated_by };
}

/** Is fundraising switched on? Any failure reads as OFF, so nothing shows that should not. */
export async function fundraisingIsOn(): Promise<boolean> {
  try {
    return (await getFundraisingSettings()).pageOn;
  } catch {
    return false;
  }
}

export async function setFundraisingOn(pageOn: boolean, actor: string): Promise<FundraisingSettings> {
  return inTransaction(async (client) => {
    const before = await client.query<{ page_on: boolean }>("SELECT page_on FROM fundraising_settings WHERE id = 1 FOR UPDATE");
    await client.query(
      `INSERT INTO fundraising_settings (id, page_on, updated_at, updated_by) VALUES (1, $1, now(), $2)
       ON CONFLICT (id) DO UPDATE SET page_on = $1, updated_at = now(), updated_by = $2`,
      [pageOn, actor],
    );
    await insertAudit(client, {
      actor,
      action: "fundraising.switched",
      entity: "fundraising_settings",
      entityId: 1,
      data: { pageOn, wasOn: before.rows[0]?.page_on ?? false },
    });
    const r = await client.query<{ page_on: boolean; updated_at: string; updated_by: string | null }>(
      "SELECT page_on, updated_at, updated_by FROM fundraising_settings WHERE id = 1",
    );
    const row = r.rows[0];
    return { pageOn: row.page_on, updatedAt: iso(row.updated_at), updatedBy: row.updated_by };
  });
}

// --- signing up ----------------------------------------------------------------------------------

// TASK-511: a short address nobody has, or has ever had: the initials of the title (ssd), then ssd2,
// ssd3... (src/fundraising/slugs.ts). Every address a page used to have counts as taken, so an old
// link can never lead to someone else's page. Staff may change it before approving.
// TASK-511 review: who may take which address is decided one at a time across the whole site, with
// a lock held to the end of the transaction. Without it a sign up could read the addresses in use a
// moment before staff move a page off one (into the history), and then take that old address.
const SLUG_LOCK = "SELECT pg_advisory_xact_lock(hashtext('fundraiser_slugs'))";

async function freeSlug(client: PoolClient, title: string): Promise<string> {
  await client.query(SLUG_LOCK);
  const base = initialsSlug(title);
  // The base is only letters and numbers, so it is safe in the pattern as it is.
  const taken = new Set(
    (
      await client.query<{ slug: string }>(
        `SELECT slug FROM fundraisers WHERE slug ~ $1
         UNION SELECT old_slug FROM fundraiser_slug_history WHERE old_slug ~ $1`,
        [`^${base}[0-9]*$`],
      )
    ).rows.map((r) => r.slug),
  );
  return freeSlugFrom(base, taken);
}

const isSlugClash = (err: unknown): boolean =>
  typeof err === "object" && err !== null && (err as { code?: string }).code === "23505" &&
  /slug/.test(String((err as { constraint?: string }).constraint ?? "fundraisers_slug_key"));

/**
 * Something more a sign up does in its own transaction, after it is inserted and before it is read
 * back (team pages: a team's held invites, a member page's link to its team). If it throws, nothing
 * of the sign up is kept.
 */
export type SignUpExtra = (client: PoolClient, id: number) => Promise<void>;

export async function createFundraiser(s: SignUp, extra?: SignUpExtra): Promise<FundraiserRecord> {
  return inTransaction(async (client) => {
    // Two sign ups with the same name at the same moment can both pick the same free address; the
    // second then clashes on the unique slug. A savepoint lets it look again and take the next one.
    for (let attempt = 1; ; attempt += 1) {
      const slug = await freeSlug(client, s.title);
      await client.query("SAVEPOINT fundraiser_slug");
      try {
        return await insertSignUp(client, s, slug, extra);
      } catch (err) {
        if (!isSlugClash(err) || attempt >= 5) throw err;
        await client.query("ROLLBACK TO SAVEPOINT fundraiser_slug");
      }
    }
  });
}

async function insertSignUp(client: PoolClient, s: SignUp, slug: string, extra?: SignUpExtra): Promise<FundraiserRecord> {
  const inserted = await client.query<{ id: number }>(
    // TASK-499: the address goes in its separate boxes; the old single box is left empty.
    `INSERT INTO fundraisers
       (slug, path, kind, title, description, event_date, start_time, venue, town, target_pence, public,
        organiser_name, organiser_email, organiser_phone, social_link, social_ok, wants,
        newsletter_ok, updated_by,
        post_line1, post_line2, post_town, post_postcode, card_line, end_time, time_tbc, venue_address,
        venue_postcode, access, price, booking, ticket_url, age_limit, dress_code, included, credit_name,
        first_name, last_name, kind_other, instagram, facebook,
        over_18, shares_with_other, nbcc_share_percent, other_cause_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, 'public',
             $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35,
             $36, $37, $38, $39, $40,
             $41, $42, $43, $44)
     RETURNING id`,
    [
      slug, s.path, s.kind, s.title, s.description, s.eventDate, s.startTime, s.venue, s.town, s.targetPence, s.public,
      s.name, s.email, s.phone, s.socialLink, s.socialOk, JSON.stringify(s.wants), s.newsletterOk,
      s.postLine1, s.postLine2, s.postTown, s.postPostcode, s.cardLine, s.endTime, s.timeTbc, s.venueAddress,
      s.venuePostcode, s.access, s.price, s.booking, s.ticketUrl, s.ageLimit, s.dressCode, s.included, s.creditName,
      // TASK-511: the name in two parts (name above is the whole), Other, and the two links.
      s.firstName ?? null, s.lastName ?? null, s.kindOther ?? null, s.instagram ?? null, s.facebook ?? null,
      // Jaimie, 2026-10-03: 18 or over (always Yes: the form refuses No), and the split.
      s.over18, s.sharesWithOther, s.nbccSharePercent, s.otherCauseName,
    ],
  );
  const id = Number(inserted.rows[0].id);
  // In memory (Jaimie, 2026-10-03): who it remembers, in its own statement in the same transaction.
  if (s.inMemory) await saveMemory(client, id, s);
  await insertAudit(client, {
    actor: "public",
    action: "fundraiser.signed_up",
    entity: "fundraiser",
    entityId: id,
    data: { slug, path: s.path, kind: s.kind, title: s.title, public: s.public, sharesWithOther: s.sharesWithOther, ...(s.inMemory ? { inMemory: true } : {}) },
  });
  if (extra) await extra(client, id);
  return reread(client, id);
}

async function saveMemory(client: PoolClient, id: number, s: SignUp): Promise<void> {
  await client.query(
    `UPDATE fundraisers SET in_memory = true, memory_name = $1, memory_dates = $2, memory_setup_by = $3,
            memory_permission = $4, memory_show_target = $5
      WHERE id = $6`,
    [s.memoryName, s.memoryDates, s.memorySetupBy, s.memoryPermission, s.memoryShowTarget, id],
  );
}

// --- reading -------------------------------------------------------------------------------------

const WITH_SUMS = SELECT.replace(
  "FROM fundraisers f",
  `, ${ONLINE_SQL} AS online_pence, ${CASH_SQL} AS cash_pence, ${GIFT_AID_SQL} AS gift_aid_pence, ${WAITING_SQL} AS edit_waiting FROM fundraisers f`,
);

export async function getFundraiser(id: number): Promise<(FundraiserRecord & { meter: Meter; editWaiting: boolean }) | null> {
  const r = await pool.query(`${WITH_SUMS} WHERE f.id = $1`, [id]);
  const row = r.rows[0];
  return row ? { ...toRecord(row), meter: meterOf(row), editWaiting: Boolean(row.edit_waiting) } : null;
}

export interface FundraiserSummary extends FundraiserRecord {
  meter: Meter;
  editWaiting: boolean;
}

/** Every sign up, newest first, for the admin's list. */
export async function listAllFundraisers(): Promise<FundraiserSummary[]> {
  const r = await pool.query(`${WITH_SUMS} ORDER BY f.created_at DESC, f.id DESC`);
  return r.rows.map((row) => ({ ...toRecord(row), meter: meterOf(row), editWaiting: Boolean(row.edit_waiting) }));
}

/**
 * Team pages: the sign ups matching a WHERE clause of the caller's (written in code, never from
 * input; values only ever as parameters), each with its meter, oldest first. For a team's members.
 */
export async function listFundraisersWhere(where: string, params: unknown[]): Promise<FundraiserSummary[]> {
  const r = await pool.query(`${WITH_SUMS} WHERE ${where} ORDER BY f.created_at, f.id`, params);
  return r.rows.map((row) => ({ ...toRecord(row), meter: meterOf(row), editWaiting: Boolean(row.edit_waiting) }));
}

/** Approved and public, for Get involved. The caller applies isListed for the date rule. */
export async function listApprovedPublic(): Promise<Array<FundraiserRecord & { meter: Meter }>> {
  const r = await pool.query(
    `${WITH_SUMS} WHERE f.status = 'approved' AND f.public = true ORDER BY f.event_date NULLS LAST, f.approved_at DESC, f.id DESC`,
  );
  return r.rows.map((row) => ({ ...toRecord(row), meter: meterOf(row) }));
}

export async function getBySlug(slug: string): Promise<(FundraiserRecord & { meter: Meter }) | null> {
  const r = await pool.query(`${WITH_SUMS} WHERE f.slug = $1`, [slug]);
  const row = r.rows[0];
  return row ? { ...toRecord(row), meter: meterOf(row) } : null;
}

/** The gifts made on a fundraiser's page, for its wall. Hidden ones too; the caller decides. */
export async function wallRows(fundraiserId: number): Promise<WallSourceRow[]> {
  // In memory: a message staff have not yet approved is held (wallEntries leaves it off), and the
  // giver's "Let the family know I gave" tick is read for the organiser's list.
  const r = await pool.query(
    `SELECT d.id, dn.full_name, dn.anonymous, d.show_name, d.show_amount, d.amount_pence,
            d.refunded_amount_pence, d.supporter_message, d.message_hidden, d.created_at, d.paid_in_by_organiser,
            d.gift_aid, (f.in_memory AND d.message_approved_at IS NULL) AS message_held, d.family_notify
       FROM donations d JOIN donors dn ON dn.id = d.donor_id JOIN fundraisers f ON f.id = d.fundraiser_id
      WHERE d.fundraiser_id = $1 AND d.payment_status = 'paid'
      ORDER BY d.created_at DESC, d.id DESC
      LIMIT 1000`,
    [fundraiserId],
  );
  return r.rows.map((row) => ({
    donationId: Number(row.id),
    fullName: String(row.full_name ?? ""),
    anonymous: Boolean(row.anonymous),
    showName: Boolean(row.show_name),
    showAmount: Boolean(row.show_amount),
    amountPence: Number(row.amount_pence),
    refundedPence: Number(row.refunded_amount_pence ?? 0),
    message: (row.supporter_message as string | null) ?? null,
    hidden: Boolean(row.message_hidden),
    createdAt: iso(row.created_at) as string,
    paidIn: Boolean(row.paid_in_by_organiser),
    giftAid: Boolean(row.gift_aid),
    held: row.message_held === true,
    familyNotify: row.family_notify === true,
  }));
}

export interface EditRow {
  id: number;
  changes: FundraiserEdit;
  status: "waiting" | "approved" | "rejected" | "replaced";
  createdAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
}

export async function listEdits(fundraiserId: number): Promise<EditRow[]> {
  const r = await pool.query(
    `SELECT id, changes, status, created_at, decided_at, decided_by FROM fundraiser_edits
      WHERE fundraiser_id = $1 ORDER BY (status = 'waiting') DESC, created_at DESC, id DESC`,
    [fundraiserId],
  );
  return r.rows.map((row) => ({
    id: Number(row.id),
    changes: row.changes as FundraiserEdit,
    status: row.status,
    createdAt: iso(row.created_at) as string,
    decidedAt: iso(row.decided_at),
    decidedBy: row.decided_by ?? null,
  }));
}

export interface CashRow {
  id: number;
  amountPence: number;
  paidInOn: string;
  note: string;
  createdBy: string;
  createdAt: string;
}

export async function listCash(fundraiserId: number): Promise<CashRow[]> {
  const r = await pool.query(
    `SELECT id, amount_pence, to_char(paid_in_on, 'YYYY-MM-DD') AS paid_in_on, note, created_by, created_at
       FROM fundraiser_cash WHERE fundraiser_id = $1 ORDER BY paid_in_on DESC, id DESC`,
    [fundraiserId],
  );
  return r.rows.map((row) => ({
    id: Number(row.id),
    amountPence: Number(row.amount_pence),
    paidInOn: row.paid_in_on,
    note: row.note,
    createdBy: row.created_by,
    createdAt: iso(row.created_at) as string,
  }));
}

export interface HistoryRow {
  id: number;
  actor: string;
  action: string;
  data: Record<string, unknown>;
  createdAt: string;
}

export async function fundraiserHistory(fundraiserId: number): Promise<HistoryRow[]> {
  const r = await pool.query(
    `SELECT id, actor, action, data, created_at FROM audit_log
      WHERE entity = 'fundraiser' AND entity_id = $1 ORDER BY id DESC LIMIT 500`,
    [fundraiserId],
  );
  return r.rows.map((row) => ({
    id: Number(row.id),
    actor: row.actor,
    action: row.action,
    data: row.data ?? {},
    createdAt: iso(row.created_at) as string,
  }));
}

// --- staff changes -------------------------------------------------------------------------------

/**
 * TASK-511: may this page take `slug`? Never an address another page used to have. One this page had
 * before it may take back: it then comes out of the history, as it is in use again.
 */
async function claimOldSlug(client: PoolClient, id: number, slug: string): Promise<void> {
  const r = await client.query<{ fundraiser_id: number }>("SELECT fundraiser_id FROM fundraiser_slug_history WHERE old_slug = $1", [slug]);
  const owner = r.rows[0];
  if (!owner) return;
  if (Number(owner.fundraiser_id) !== id) throw new FundraiserError("slug_taken");
  await client.query("DELETE FROM fundraiser_slug_history WHERE old_slug = $1 AND fundraiser_id = $2", [slug, id]);
}

export async function patchFundraiser(id: number, patch: AdminPatch, actor: string): Promise<FundraiserRecord> {
  return inTransaction(async (client) => {
    const before = await lockFundraiser(client, id);
    checkTimes(before, patch);
    // Team pages: a team, or a page still on one, raises money (the table's check holds it too).
    if (patch.path === "event" && (before.isTeam || (before.teamId && !before.teamLeftAt))) throw new FundraiserError("team_path");
    const newSlug = typeof patch.slug === "string" && patch.slug !== before.slug ? patch.slug : null;
    if (newSlug) {
      await client.query(SLUG_LOCK);
      await claimOldSlug(client, id, newSlug);
    }
    // TASK-511: the whole name follows a change to its first name or surname.
    const name = organiserNameFor(before, patch);
    const full: AdminPatch = name ? { ...patch, name } : { ...patch };
    // TASK-511 review: the old single link follows Instagram and Facebook.
    const link = socialLinkFor(before, full);
    if (link !== undefined) full.socialLink = link;
    // TASK-511: what they would like is saved whole; printed QR codes not sent are kept as stored.
    if (full.wants && full.wants.qrCount === undefined) full.wants = { ...full.wants, qrCount: before.wants.qrCount ?? 0 };
    const changed = await applyPatch(client, id, full, actor);
    // Event pages: staff saving a short name, new or the suggested one kept, is what lets an event
    // be approved (approveProblem).
    if (typeof patch.slug === "string") await client.query("UPDATE fundraisers SET slug_set_at = now() WHERE id = $1", [id]);
    // TASK-511: the old address keeps working, with a 301 to the new one, and is never reused.
    if (newSlug) {
      await client.query(
        "INSERT INTO fundraiser_slug_history (old_slug, fundraiser_id, created_by) VALUES ($1, $2, $3) ON CONFLICT (old_slug) DO NOTHING",
        [before.slug, id, actor],
      );
    }
    await insertAudit(client, {
      actor,
      action: "fundraiser.updated",
      entity: "fundraiser",
      entityId: id,
      data: { changed, slug: patch.slug ?? before.slug, wasSlug: before.slug },
    });
    return reread(client, id);
  });
}

/**
 * Jaimie, 2026-10-03: staff (an admin) correcting the split with another cause. Only while the
 * fundraiser has no gifts: once anyone has given, they gave on the statement as it stood, so it is
 * never changed after that. Online gifts of any state and cash paid in both count. Counted under the
 * row's lock, so a gift recorded at the same moment cannot slip past. Organisers can never change it
 * (their changes, editSchema, do not take it).
 */
export async function setFundraiserSplit(
  id: number,
  split: FundraiserSplit,
  actor: string,
  /** Team pages: whose split it is, for a team that shares. Kept as it was when not given. */
  teamShareMode?: "team" | "organiser" | null,
): Promise<FundraiserRecord> {
  return inTransaction(async (client) => {
    const before = await lockFundraiser(client, id);
    // Team pages: a member page of a whole team split has the team's split; only the team's changes.
    if (before.teamId && !before.teamLeftAt) {
      const t = await client.query<{ team_share_mode: string | null }>("SELECT team_share_mode FROM fundraisers WHERE id = $1", [before.teamId]);
      if (t.rows[0]?.team_share_mode === "team") throw new FundraiserError("team_split");
    }
    // A whole team split is the team's and every current member's: all of them have no gifts, or
    // none of them changes. Read under the team's lock, so a member joining at the same moment waits.
    // Team pages: a team that shares says whose split it is. Turning sharing (back) on asks; a
    // correction of a team already sharing keeps the mode it has unless a new one is given.
    const isTeam = before.isTeam === true;
    const newMode = !isTeam || !split.sharesWithOther ? null : teamShareMode ?? (before.sharesWithOther === true ? before.teamShareMode ?? null : null);
    if (isTeam && split.sharesWithOther && !newMode) throw new FundraiserError("team_mode_missing");
    const wasWholeTeam = isTeam && before.teamShareMode === "team";
    const wholeTeam = wasWholeTeam || newMode === "team";
    const members = wholeTeam
      ? (await client.query<{ id: number }>("SELECT id FROM fundraisers WHERE team_id = $1 AND team_left_at IS NULL FOR UPDATE", [id])).rows.map((r) => Number(r.id))
      : [];
    const all = [id, ...members];
    const gifts = await client.query<{ n: string }>("SELECT count(*) AS n FROM donations WHERE fundraiser_id = ANY($1)", [all]);
    const cash = await client.query<{ n: string }>("SELECT count(*) AS n FROM fundraiser_cash WHERE fundraiser_id = ANY($1)", [all]);
    if (Number(gifts.rows[0]?.n ?? 0) > 0 || Number(cash.rows[0]?.n ?? 0) > 0) throw new FundraiserError("has_gifts");
    // A team that stops sharing has no split mode any more (the table's check holds them together).
    await client.query(
      `UPDATE fundraisers SET shares_with_other = $1, nbcc_share_percent = $2, other_cause_name = $3,
              team_share_mode = CASE WHEN $1::boolean THEN team_share_mode ELSE NULL END, updated_at = now(), updated_by = $4 WHERE id = $5`,
      [split.sharesWithOther, split.nbccSharePercent, split.otherCauseName, actor, id],
    );
    if (isTeam && newMode) await client.query("UPDATE fundraisers SET team_share_mode = $2 WHERE id = $1", [id, newMode]);
    // Every current member gets a whole team split; one that was the whole team's and is no longer
    // (not sharing now) is cleared with it. Just the organiser's leaves the members as they are.
    if (newMode === "team" || (wasWholeTeam && !split.sharesWithOther)) {
      await client.query(
        `UPDATE fundraisers SET shares_with_other = $1, nbcc_share_percent = $2, other_cause_name = $3, updated_at = now(), updated_by = $4
          WHERE team_id = $5 AND team_left_at IS NULL`,
        [split.sharesWithOther, split.nbccSharePercent, split.otherCauseName, actor, id],
      );
    }
    await insertAudit(client, {
      actor,
      action: "fundraiser.split_changed",
      entity: "fundraiser",
      entityId: id,
      data: {
        slug: before.slug,
        was: { sharesWithOther: before.sharesWithOther ?? null, nbccSharePercent: before.nbccSharePercent ?? null, otherCauseName: before.otherCauseName ?? null },
        now: split,
        ...(wholeTeam ? { members } : {}),
      },
    });
    return reread(client, id);
  });
}

const ALLOWED_FROM: Record<"approve" | "decline" | "finish", ReadonlyArray<FundraiserRecord["status"]>> = {
  approve: ["new", "declined"],
  decline: ["new", "approved"],
  finish: ["approved"],
};

/** Approve, decline or finish. Refuses a move that makes no sense (finishing a new sign up). */
export async function moveFundraiser(
  id: number,
  move: "approve" | "decline" | "finish",
  actor: string,
  reason: string | null = null,
): Promise<{ before: FundraiserRecord; after: FundraiserRecord; livePending: boolean }> {
  return inTransaction(async (client) => {
    const before = await lockFundraiser(client, id);
    if (!ALLOWED_FROM[move].includes(before.status)) throw new FundraiserError("bad_status");
    // Event pages: checked under the row's lock, so a short name cleared a moment ago is seen.
    if (move === "approve" && approveProblem(before)) throw new FundraiserError("needs_short_name");
    let livePending = false;
    if (move === "approve") {
      // TASK-497: a page holder approved while fundraising is off waits for "Your page is live",
      // sent when an admin switches it on. The switch is read under a share lock, so an approval and
      // a switch on at the same moment cannot both miss each other: whichever commits second sees
      // the first, and the email goes exactly once (now, or at the switch).
      const settings = await client.query<{ page_on: boolean }>("SELECT page_on FROM fundraising_settings WHERE id = 1 FOR SHARE");
      const pageOn = settings.rows[0]?.page_on ?? false;
      // Team pages: a team's emails (its live email and the invites) always wait for the switch.
      livePending = !pageOn && (before.isTeam === true || hasPage({ ...before, status: "approved" }));
      await client.query(
        `UPDATE fundraisers SET status = 'approved', approved_at = now(), approved_by = $1, declined_reason = NULL,
                live_email_pending = $2, updated_at = now(), updated_by = $1 WHERE id = $3`,
        [actor, livePending, id],
      );
    } else if (move === "decline") {
      await client.query(
        `UPDATE fundraisers SET status = 'declined', declined_reason = $1, live_email_pending = false, updated_at = now(), updated_by = $2 WHERE id = $3`,
        [reason, actor, id],
      );
    } else {
      await client.query(
        `UPDATE fundraisers SET status = 'finished', live_email_pending = false, updated_at = now(), updated_by = $1 WHERE id = $2`,
        [actor, id],
      );
    }
    const action = { approve: "fundraiser.approved", decline: "fundraiser.declined", finish: "fundraiser.finished" }[move];
    await insertAudit(client, {
      actor,
      action,
      entity: "fundraiser",
      entityId: id,
      data: {
        slug: before.slug,
        wasStatus: before.status,
        ...(move === "decline" ? { reason } : {}),
        ...(livePending ? { liveEmailWaiting: true } : {}),
      },
    });
    return { before, after: await reread(client, id), livePending };
  });
}

// An approved page holder still waiting for "Your page is live".
// Event pages: an event's page is live too, so an event approved while it is off waits as well.
// Team pages: a team waits too, page or not.
const WAITING_LIVE = "live_email_pending AND status = 'approved' AND (is_team OR (public AND path IN ('raising', 'event')))";

/**
 * Claim ONE approved page holder still waiting for "Your page is live", past `afterId`, clearing its
 * mark in the same statement. One at a time, so a restart in the middle of a run loses at most the
 * one in flight; SKIP LOCKED, so two runs at once never take the same row. A failed send marks it
 * again (markLiveEmailWaiting), and looking only past the last id tried keeps a run from looping on it.
 */
export async function claimNextWaitingLiveEmail(afterId: number): Promise<FundraiserRecord | null> {
  const r = await pool.query(
    `UPDATE fundraisers f SET live_email_pending = false
      WHERE f.id = (
        SELECT id FROM fundraisers
         WHERE ${WAITING_LIVE} AND id > $1
         ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED
      )
      RETURNING ${RECORD_COLUMNS}`,
    [afterId],
  );
  return r.rows[0] ? toRecord(r.rows[0]) : null;
}

/** How many approved page holders are waiting for "Your page is live". */
export async function countWaitingLiveEmails(): Promise<number> {
  const r = await pool.query<{ n: string }>(`SELECT count(*) AS n FROM fundraisers WHERE ${WAITING_LIVE}`);
  return Number(r.rows[0]?.n ?? 0);
}

/** Mark one approved fundraiser as waiting for its live email again, after a send that failed. */
export async function markLiveEmailWaiting(id: number): Promise<void> {
  await pool.query("UPDATE fundraisers SET live_email_pending = true WHERE id = $1 AND status = 'approved'", [id]);
}

// --- changes from the organiser ------------------------------------------------------------------

const sameEmail = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

// TASK-501: under the row's lock, the fundraiser must be the signed in organiser's own. Someone
// else's reads as not there at all, so the answer never says whose it is.
// A finished fundraiser stays its organiser's (TASK-501 review), but takes no changes.
async function lockOwn(client: PoolClient, fundraiserId: number, email: string): Promise<FundraiserRecord> {
  const f = await lockFundraiser(client, fundraiserId);
  if (!sameEmail(f.email, email)) throw new FundraiserError("not_found");
  if (f.status !== "approved") throw new FundraiserError("bad_status");
  return f;
}

/**
 * Store an organiser's change as waiting. A change of theirs already waiting is marked replaced.
 * TASK-501: sent from the private area by the signed in organiser (`email`), and only for their own
 * approved fundraiser.
 */
export async function requestEdit(fundraiserId: number, changes: FundraiserEdit, email: string): Promise<EditRow> {
  return inTransaction(async (client) => {
    await lockOwn(client, fundraiserId, email);
    const waiting = await client.query<{ id: number }>(
      "SELECT id FROM fundraiser_edits WHERE fundraiser_id = $1 AND status = 'waiting' FOR UPDATE",
      [fundraiserId],
    );
    // Never rewritten in place: a change staff are reading cannot be swapped under them. The one
    // waiting is marked replaced and the new one added, so approving the old one is refused (409).
    for (const row of waiting.rows) {
      await client.query("UPDATE fundraiser_edits SET status = 'replaced', decided_at = now(), decided_by = 'organiser' WHERE id = $1", [Number(row.id)]);
    }
    const ins = await client.query<{ id: number }>(
      "INSERT INTO fundraiser_edits (fundraiser_id, changes) VALUES ($1, $2) RETURNING id",
      [fundraiserId, JSON.stringify(changes)],
    );
    const editId = Number(ins.rows[0].id);
    await insertAudit(client, {
      actor: "organiser",
      action: "fundraiser.edit_requested",
      entity: "fundraiser",
      entityId: fundraiserId,
      data: { editId, fields: Object.keys(changes), replaced: waiting.rows.map((r) => Number(r.id)), via: "private area" },
    });
    const r = await client.query(
      "SELECT id, changes, status, created_at, decided_at, decided_by FROM fundraiser_edits WHERE id = $1",
      [editId],
    );
    const row = r.rows[0];
    return {
      id: Number(row.id),
      changes: row.changes,
      status: row.status,
      createdAt: iso(row.created_at) as string,
      decidedAt: null,
      decidedBy: null,
    };
  });
}

/** Approve (apply it to the live page) or reject a waiting change. */
export async function decideEdit(
  fundraiserId: number,
  editId: number,
  approve: boolean,
  actor: string,
): Promise<FundraiserRecord> {
  return inTransaction(async (client) => {
    const live = await lockFundraiser(client, fundraiserId);
    const r = await client.query<{ changes: FundraiserEdit; status: string }>(
      "SELECT changes, status FROM fundraiser_edits WHERE id = $1 AND fundraiser_id = $2 FOR UPDATE",
      [editId, fundraiserId],
    );
    const edit = r.rows[0];
    if (!edit) throw new FundraiserError("not_found");
    if (edit.status === "replaced") throw new FundraiserError("replaced");
    if (edit.status !== "waiting") throw new FundraiserError("not_waiting");
    let changed: string[] = [];
    if (approve) checkTimes(live, (edit.changes ?? {}) as Record<string, unknown>);
    if (approve) {
      const changes = { ...(edit.changes ?? {}) } as FundraiserEdit;
      // TASK-511 review: the old single link follows an approved change to Instagram or Facebook.
      const link = socialLinkFor(live, changes);
      if (link !== undefined) changes.socialLink = link;
      changed = await applyPatch(client, fundraiserId, changes as Partial<Record<PatchField, unknown>>, actor);
    }
    await client.query(
      "UPDATE fundraiser_edits SET status = $1, decided_at = now(), decided_by = $2 WHERE id = $3",
      [approve ? "approved" : "rejected", actor, editId],
    );
    await insertAudit(client, {
      actor,
      action: approve ? "fundraiser.edit_approved" : "fundraiser.edit_rejected",
      entity: "fundraiser",
      entityId: fundraiserId,
      data: { editId, fields: approve ? changed : Object.keys(edit.changes ?? {}) },
    });
    return reread(client, fundraiserId);
  });
}

// --- cash paid in --------------------------------------------------------------------------------

export async function addCash(
  fundraiserId: number,
  cash: { amountPence: number; paidInOn: string; note: string },
  actor: string,
): Promise<CashRow> {
  return inTransaction(async (client) => {
    await lockFundraiser(client, fundraiserId);
    const r = await client.query(
      `INSERT INTO fundraiser_cash (fundraiser_id, amount_pence, paid_in_on, note, created_by) VALUES ($1, $2, $3, $4, $5)
       RETURNING id, amount_pence, to_char(paid_in_on, 'YYYY-MM-DD') AS paid_in_on, note, created_by, created_at`,
      [fundraiserId, cash.amountPence, cash.paidInOn, cash.note, actor],
    );
    const row = r.rows[0];
    await insertAudit(client, {
      actor,
      action: "fundraiser.cash_added",
      entity: "fundraiser",
      entityId: fundraiserId,
      data: { cashId: Number(row.id), amountPence: cash.amountPence, paidInOn: cash.paidInOn, note: cash.note },
    });
    return {
      id: Number(row.id),
      amountPence: Number(row.amount_pence),
      paidInOn: row.paid_in_on,
      note: row.note,
      createdBy: row.created_by,
      createdAt: iso(row.created_at) as string,
    };
  });
}

export async function removeCash(fundraiserId: number, cashId: number, actor: string): Promise<void> {
  await inTransaction(async (client) => {
    const r = await client.query<{ amount_pence: number; paid_in_on: string; note: string }>(
      `DELETE FROM fundraiser_cash WHERE id = $1 AND fundraiser_id = $2
       RETURNING amount_pence, to_char(paid_in_on, 'YYYY-MM-DD') AS paid_in_on, note`,
      [cashId, fundraiserId],
    );
    const row = r.rows[0];
    if (!row) throw new FundraiserError("not_found");
    await insertAudit(client, {
      actor,
      action: "fundraiser.cash_removed",
      entity: "fundraiser",
      entityId: fundraiserId,
      data: { cashId, amountPence: Number(row.amount_pence), paidInOn: row.paid_in_on, note: row.note },
    });
  });
}

// --- the supporter wall --------------------------------------------------------------------------

export async function setMessageHidden(fundraiserId: number, donationId: number, hidden: boolean, actor: string): Promise<void> {
  await inTransaction(async (client) => {
    const r = await client.query(
      "UPDATE donations SET message_hidden = $1 WHERE id = $2 AND fundraiser_id = $3 RETURNING id",
      [hidden, donationId, fundraiserId],
    );
    if (!r.rows[0]) throw new FundraiserError("not_found");
    await insertAudit(client, {
      actor,
      action: hidden ? "fundraiser.message_hidden" : "fundraiser.message_shown",
      entity: "fundraiser",
      entityId: fundraiserId,
      data: { donationId },
    });
  });
}

// --- "I've finished" (TASK-501) -----------------------------------------------------------------

/**
 * The organiser pressed "I've finished" in their private area. It records when (the first press is
 * kept) and finishes nothing: staff do that. `first` says whether this press was the first, so staff
 * are emailed once.
 */
export async function markFinishedRequested(
  fundraiserId: number,
  email: string,
): Promise<{ record: FundraiserRecord; first: boolean }> {
  return inTransaction(async (client) => {
    const before = await lockOwn(client, fundraiserId, email);
    const first = !before.finishedRequestedAt;
    await client.query(
      "UPDATE fundraisers SET finished_requested_at = COALESCE(finished_requested_at, now()) WHERE id = $1",
      [fundraiserId],
    );
    if (first) {
      await insertAudit(client, {
        actor: "organiser",
        action: "fundraiser.finish_requested",
        entity: "fundraiser",
        entityId: fundraiserId,
        data: { slug: before.slug },
      });
    }
    return { record: await reread(client, fundraiserId), first };
  });
}

// --- the private area (TASK-501) ----------------------------------------------------------------

/**
 * Every fundraiser of this organiser's they may sign in to, newest first, with its meter: approved
 * ones, and finished ones too (Jaimie's decision, TASK-501 review: finishing never locks an
 * organiser out; they can still see it and pay in late money). Never one that is new or declined.
 */
export async function listForOrganiser(email: string): Promise<Array<FundraiserRecord & { meter: Meter; editWaiting: boolean }>> {
  const r = await pool.query(
    `${WITH_SUMS} WHERE lower(f.organiser_email) = lower($1) AND f.status IN ('approved', 'finished') ORDER BY f.created_at DESC, f.id DESC LIMIT 20`,
    [email],
  );
  return r.rows.map((row) => ({ ...toRecord(row), meter: meterOf(row), editWaiting: Boolean(row.edit_waiting) }));
}

export async function waitingEditFor(fundraiserId: number): Promise<EditRow | null> {
  return (await listEdits(fundraiserId)).find((e) => e.status === "waiting") ?? null;
}

// --- gifts from the Stripe webhook ---------------------------------------------------------------

export interface FundraiserGift {
  fundraiserId: number;
  message: string | null;
  showName: boolean;
  showAmount: boolean;
  /** TASK-501: money the organiser collected and paid in from their private area. */
  paidIn?: boolean;
}

/**
 * Inside the webhook's transaction: put a gift on its fundraiser's page, but only when the id names
 * an APPROVED or FINISHED fundraiser. Anything else (new, declined, or not there) stays an ordinary
 * donation (no link, no message), and the audit row says so. Returns whether it was linked.
 *
 * TASK-501 review: money an organiser pays in is linked to an approved OR finished fundraiser, so
 * late money still reaches the meter (Jaimie's decision). And it keeps its paid in mark whatever
 * happens to the link, so it can never pass as a gift of the organiser's own.
 * TASK-502: a supporter's gift too, as a finished fundraiser keeps its page and its give form for
 * good ("the link for giving works indefinitely").
 */
export async function linkFundraiserGift(
  client: PoolClient,
  donationId: number,
  gift: FundraiserGift,
  eventId: string,
): Promise<boolean> {
  const found = await client.query<{ id: number; status: string }>("SELECT id, status FROM fundraisers WHERE id = $1", [
    gift.fundraiserId,
  ]);
  const status = found.rows[0]?.status;
  const linkable = status === "approved" || status === "finished";
  if (!linkable) {
    if (gift.paidIn) await client.query("UPDATE donations SET paid_in_by_organiser = true WHERE id = $1", [donationId]);
    await insertAudit(client, {
      actor: "stripe",
      action: "fundraiser.gift_not_linked",
      entity: "donation",
      entityId: donationId,
      data: { eventId, fundraiserId: gift.fundraiserId },
    });
    return false;
  }
  if (gift.paidIn) {
    // TASK-501: on the meter like any gift; never on the wall, so no message and nothing shown.
    await client.query(
      "UPDATE donations SET fundraiser_id = $1, supporter_message = $2, show_name = $3, show_amount = $4, paid_in_by_organiser = $5 WHERE id = $6",
      [gift.fundraiserId, null, false, false, true, donationId],
    );
  } else {
    await client.query(
      "UPDATE donations SET fundraiser_id = $1, supporter_message = $2, show_name = $3, show_amount = $4 WHERE id = $5",
      [gift.fundraiserId, gift.message, gift.showName, gift.showAmount, donationId],
    );
  }
  await insertAudit(client, {
    actor: "stripe",
    action: gift.paidIn ? "fundraiser.paid_in" : "fundraiser.gift_received",
    entity: "fundraiser",
    entityId: gift.fundraiserId,
    data: { eventId, donationId },
  });
  return true;
}

// --- the message after paying (TASK-502) ---------------------------------------------------------

const GIFT_FOR_SESSION = `SELECT id, fundraiser_id, paid_in_by_organiser, payment_status, supporter_message, wall_added_at
  FROM donations WHERE stripe_session_id = $1 ORDER BY id DESC LIMIT 1`;

function toGiftForSession(row: Row): GiftForSession {
  return {
    donationId: Number(row.id),
    fundraiserId: row.fundraiser_id == null ? null : Number(row.fundraiser_id),
    paidIn: Boolean(row.paid_in_by_organiser),
    paymentStatus: String(row.payment_status ?? ""),
    message: textOrNull(row.supporter_message),
    wallAddedAt: iso(row.wall_added_at),
  };
}

/**
 * The gift a Stripe checkout session paid for, as the thank you's wall step needs to judge it, or
 * null while the webhook has not recorded it. Nothing about the giver is read.
 */
export async function giftForSession(sessionId: string): Promise<GiftForSession | null> {
  const r = await pool.query(GIFT_FOR_SESSION, [sessionId]);
  return r.rows[0] ? toGiftForSession(r.rows[0]) : null;
}

/**
 * The giver's message and wall choices, added from the thank you after paying. Under the gift's row
 * lock it must be a gift on THIS fundraiser that has gone through (or a Direct Debit settling), not
 * money paid in, and never added to before (wallStepVerdict). Saved once: wall_added_at marks it, and
 * the update is held to rows not yet marked as well, so two sends at once save one. Staff can still
 * hide the message as before. Returns the verdict and, once saved and paid, what the wall now shows.
 */
export async function addWallMessage(
  sessionId: string,
  fundraiserId: number,
  input: Pick<WallMessage, "message" | "showName" | "showAmount"> & { familyNotify?: boolean },
): Promise<{ verdict: WallStepVerdict; entry: WallEntry | null }> {
  return inTransaction(async (client) => {
    const r = await client.query(
      `SELECT d.id, d.fundraiser_id, d.paid_in_by_organiser, d.payment_status, d.supporter_message, d.wall_added_at,
              dn.full_name, dn.anonymous, d.amount_pence, d.refunded_amount_pence, d.gift_aid, d.created_at,
              COALESCE((SELECT f.in_memory FROM fundraisers f WHERE f.id = d.fundraiser_id), false) AS in_memory
         FROM donations d JOIN donors dn ON dn.id = d.donor_id
        WHERE d.stripe_session_id = $1
        ORDER BY d.id DESC LIMIT 1
          FOR UPDATE OF d`,
      [sessionId],
    );
    const row = r.rows[0];
    const verdict = wallStepVerdict(row ? toGiftForSession(row) : null, fundraiserId);
    if (verdict !== "ok") return { verdict, entry: null };
    const message = input.message.trim() === "" ? null : input.message.trim();
    // In memory: "Let the family know I gave" (the caller passes it only for an in memory page).
    const familyNotify = input.familyNotify === true;
    await client.query(
      `UPDATE donations SET supporter_message = $1, show_name = $2, show_amount = $3, wall_added_at = now()
        WHERE id = $4 AND wall_added_at IS NULL`,
      [message, input.showName, input.showAmount, Number(row.id)],
    );
    if (familyNotify) await client.query("UPDATE donations SET family_notify = true WHERE id = $1", [Number(row.id)]);
    await insertAudit(client, {
      actor: "giver",
      action: "fundraiser.wall_message_added",
      entity: "fundraiser",
      entityId: fundraiserId,
      data: {
        donationId: Number(row.id),
        withMessage: message !== null,
        showName: input.showName,
        showAmount: input.showAmount,
        ...(familyNotify ? { familyNotify } : {}),
      },
    });
    const [entry] =
      row.payment_status === "paid"
        ? wallEntries([
            {
              donationId: Number(row.id),
              fullName: String(row.full_name ?? ""),
              anonymous: Boolean(row.anonymous),
              showName: input.showName,
              showAmount: input.showAmount,
              amountPence: Number(row.amount_pence),
              refundedPence: Number(row.refunded_amount_pence ?? 0),
              message,
              hidden: false,
              // In memory: the message waits for staff, so the wall does not show it yet.
              held: row.in_memory === true,
              createdAt: iso(row.created_at) as string,
              giftAid: Boolean(row.gift_aid),
            },
          ])
        : [];
    return { verdict, entry: entry ?? null };
  });
}
