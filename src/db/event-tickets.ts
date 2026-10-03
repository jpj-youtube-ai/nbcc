import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "./pool";
import { insertAudit } from "./donations";
import {
  BOOKING_CHANGED,
  FREE_BOOKINGS_IP_MAX,
  FREE_BOOKINGS_MAX,
  HOLD_MINUTES,
  LIVE_HOLDS_MAX,
  UNATTACHED_HOLD_MINUTES,
  availability,
  checkOrder,
  orderMoney,
  pounds,
  refundFailedWords,
  refundIsStale,
  refundPlan,
  releasePlan,
  salesState,
  type CloseChoice,
  type OrderFlags,
  type Availability,
  type OrderForList,
  type OrderLine,
  type OrderLineIn,
  type OrderMoney,
  type ProposedType,
  type TicketPlan,
  type TicketTypeRow,
} from "../tickets/model";
import type { CardFeeRate } from "../ball/pricing";

// Event tickets: the SQL. The rules are in src/tickets/model.ts; only reading and writing is here,
// as src/db/ball.ts pairs with src/ball/. Every staff or organiser change is audited in its own
// transaction (audit_log), and money only ever moves under a lock on the order or the event.
//
// Oversell protection, the ball's way (src/db/ball.ts claimReservation):
//   - a checkout locks its event's settings row (FOR UPDATE), so buyers of one event queue one
//     behind the other: the second sees the first one's places as taken and is refused;
//   - the order is written 'pending' with hold_expires_at an hour on, and holds its places until
//     then. Stripe closes the checkout at 31 minutes, and its expired event releases them at once;
//     the hour is the backstop if that event were ever lost (nothing has to run for it to work);
//   - the webhook marks it paid. A payment that lands after its hold ran out is still recorded (the
//     money is taken) and the audit log says so, with whether the event is now over its limit.

export type Querier = Pick<PoolClient, "query">;

type Row = Record<string, unknown>;
const num = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);
const iso = (v: unknown): string | null => (v == null ? null : new Date(v as string).toISOString());

export interface TicketSettings {
  salesLimit: number | null;
  proposedSalesLimit: number | null;
  salesClosedAt: string | null;
  salesClosedBy: string | null;
  /** When sales close, as the host chose and staff approved; null (never asked) is when it starts. */
  salesCloseMode: string | null;
  salesCloseAt: string | null;
  /** The host's choice still waiting for staff. */
  proposedCloseMode: string | null;
  proposedCloseAt: string | null;
}

/** What salesState needs from an event's ticket settings: closed by staff, and the host's closing time. */
export function closeFields(s: TicketSettings): { salesClosedAt: string | null; salesCloseMode: string | null; salesCloseAt: string | null } {
  return { salesClosedAt: s.salesClosedAt, salesCloseMode: s.salesCloseMode, salesCloseAt: s.salesCloseAt };
}

export interface TicketTypeFull extends TicketTypeRow {
  proposedBy: string;
  proposedAt: string;
  approvedAt: string | null;
  approvedBy: string | null;
}

function toType(r: Row): TicketTypeFull {
  return {
    id: num(r.id),
    name: String(r.name),
    pricePence: num(r.price_pence),
    quantity: r.quantity == null ? null : num(r.quantity),
    status: r.status as TicketTypeRow["status"],
    position: num(r.sort_order),
    proposedBy: String(r.proposed_by ?? ""),
    proposedAt: iso(r.proposed_at) ?? "",
    approvedAt: iso(r.approved_at),
    approvedBy: (r.approved_by as string | null) ?? null,
  };
}

function toSettings(r: Row | undefined): TicketSettings {
  return {
    salesLimit: r?.sales_limit == null ? null : num(r.sales_limit),
    proposedSalesLimit: r?.proposed_sales_limit == null ? null : num(r.proposed_sales_limit),
    salesClosedAt: iso(r?.sales_closed_at),
    salesClosedBy: (r?.sales_closed_by as string | null) ?? null,
    salesCloseMode: (r?.sales_close_mode as string | null) ?? null,
    salesCloseAt: iso(r?.sales_close_at),
    proposedCloseMode: (r?.proposed_close_mode as string | null) ?? null,
    proposedCloseAt: iso(r?.proposed_close_at),
  };
}

const TYPES_SQL = `SELECT id, name, price_pence, quantity, status, sort_order, proposed_by, proposed_at, approved_at, approved_by
                     FROM event_ticket_types WHERE fundraiser_id = $1 ORDER BY sort_order, id`;
const SETTINGS_SQL = `SELECT sales_limit, proposed_sales_limit, sales_closed_at, sales_closed_by,
                             sales_close_mode, sales_close_at, proposed_close_mode, proposed_close_at
                        FROM event_ticket_settings WHERE fundraiser_id = $1`;
// Places taken per type: paid, or held by a checkout still inside its hour. Refunded places are back.
const TAKEN_SQL = `SELECT l.ticket_type_id, COALESCE(SUM(l.quantity - l.refunded_quantity), 0) AS taken
                     FROM event_ticket_order_lines l
                     JOIN event_ticket_orders o ON o.id = l.order_id
                    WHERE o.fundraiser_id = $1
                      AND (o.status = 'paid' OR (o.status = 'pending' AND o.hold_expires_at > now()))
                    GROUP BY l.ticket_type_id`;

export interface TicketState {
  types: TicketTypeFull[];
  settings: TicketSettings;
  taken: Record<number, number>;
}

export async function readTicketState(db: Querier, fundraiserId: number): Promise<TicketState> {
  // One after the other: db may be a single client inside a transaction.
  const types = await db.query(TYPES_SQL, [fundraiserId]);
  const settings = await db.query(SETTINGS_SQL, [fundraiserId]);
  const taken = await db.query(TAKEN_SQL, [fundraiserId]);
  const t: Record<number, number> = {};
  for (const r of taken.rows as Row[]) t[num(r.ticket_type_id)] = num(r.taken);
  return { types: (types.rows as Row[]).map(toType), settings: toSettings((settings.rows as Row[])[0]), taken: t };
}

export async function getTicketState(fundraiserId: number): Promise<TicketState> {
  return readTicketState(pool, fundraiserId);
}

export function availabilityOf(s: TicketState): Availability {
  return availability({ types: s.types, salesLimit: s.settings.salesLimit, taken: s.taken });
}

/** Ticket money raised: paid orders' tickets less refunds (never the card fee cover). */
export async function ticketMoneyFor(fundraiserId: number): Promise<number> {
  const r = await pool.query(
    `SELECT COALESCE(SUM(GREATEST(tickets_pence - refunded_pence, 0)), 0) AS pence
       FROM event_ticket_orders WHERE fundraiser_id = $1 AND status = 'paid' AND disputed_at IS NULL`,
    [fundraiserId],
  );
  return num((r.rows as Row[])[0]?.pence);
}

// --- proposals (the sign up, the private area, staff) --------------------------------------------------

async function ensureSettings(db: Querier, fundraiserId: number): Promise<void> {
  await db.query(`INSERT INTO event_ticket_settings (fundraiser_id) VALUES ($1) ON CONFLICT (fundraiser_id) DO NOTHING`, [fundraiserId]);
}

async function insertTypes(db: Querier, fundraiserId: number, types: ProposedType[], by: string, status: "proposed" | "approved"): Promise<number[]> {
  const start = num(((await db.query(`SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM event_ticket_types WHERE fundraiser_id = $1`, [fundraiserId])).rows as Row[])[0]?.next);
  const ids: number[] = [];
  for (let i = 0; i < types.length; i += 1) {
    const t = types[i];
    const r = await db.query(
      `INSERT INTO event_ticket_types (fundraiser_id, name, price_pence, quantity, sort_order, status, proposed_by, approved_at, approved_by)
       VALUES ($1, $2, $3, $4, $5, $6::text, $7::text, CASE WHEN $6::text = 'approved' THEN now() END, CASE WHEN $6::text = 'approved' THEN $7::text END)
       RETURNING id`,
      [fundraiserId, t.name, t.pricePence, t.quantity, start + i, status, by],
    );
    ids.push(num((r.rows as Row[])[0].id));
  }
  return ids;
}

/** The sign up's tickets, in the sign up's own transaction: every type proposed, the limit proposed. */
export async function insertSignUpTickets(client: PoolClient, fundraiserId: number, plan: TicketPlan, email: string): Promise<void> {
  await client.query(
    `INSERT INTO event_ticket_settings (fundraiser_id, proposed_sales_limit, proposed_at, updated_by, proposed_close_mode, proposed_close_at)
     VALUES ($1, $2::integer, CASE WHEN $2::integer IS NULL THEN NULL ELSE now() END, $3, $4::text, $5::timestamptz)
     ON CONFLICT (fundraiser_id) DO NOTHING`,
    // "When the event starts" is what happens anyway, so only another choice waits for staff.
    [fundraiserId, plan.salesLimit, `organiser:${email}`, plan.close.mode === "start" ? null : plan.close.mode, plan.close.mode === "custom" ? plan.close.at : null],
  );
  const ids = await insertTypes(client, fundraiserId, plan.types, `organiser:${email}`, "proposed");
  await insertAudit(client, {
    actor: `organiser:${email}`,
    action: "tickets.proposed",
    entity: "fundraiser",
    entityId: fundraiserId,
    data: { typeIds: ids, types: plan.types, salesLimit: plan.salesLimit, close: plan.close, from: "sign up" },
  });
}

async function inTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await work(client);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** An organiser's proposal from the private area: new types (proposed), and a limit for staff to approve. */
export async function proposeTickets(
  fundraiserId: number,
  types: ProposedType[],
  salesLimit: number | null | undefined,
  email: string,
  close?: CloseChoice,
): Promise<void> {
  await inTransaction(async (client) => {
    await ensureSettings(client, fundraiserId);
    const ids = types.length ? await insertTypes(client, fundraiserId, types, `organiser:${email}`, "proposed") : [];
    if (salesLimit !== undefined) {
      await client.query(
        `UPDATE event_ticket_settings SET proposed_sales_limit = $2::integer, proposed_at = now(), updated_at = now(), updated_by = $3 WHERE fundraiser_id = $1`,
        [fundraiserId, salesLimit, `organiser:${email}`],
      );
    }
    if (close) {
      await client.query(
        `UPDATE event_ticket_settings SET proposed_close_mode = $2, proposed_close_at = $3::timestamptz, updated_at = now(), updated_by = $4 WHERE fundraiser_id = $1`,
        [fundraiserId, close.mode, close.mode === "custom" ? close.at : null, `organiser:${email}`],
      );
    }
    await insertAudit(client, {
      actor: `organiser:${email}`,
      action: "tickets.proposed",
      entity: "fundraiser",
      entityId: fundraiserId,
      data: { typeIds: ids, types, ...(salesLimit !== undefined ? { salesLimit } : {}), ...(close ? { close } : {}), from: "private area" },
    });
  });
}

export class TicketError extends Error {
  constructor(public readonly reason: "not_found" | "bad_state" | "refused" | "stale" | "too_many", message: string) {
    super(message);
  }
}

/** Staff: approve a proposed type, withdraw one (declined, or taken off sale), or put one back. */
export async function setTypeStatus(fundraiserId: number, typeId: number, status: "approved" | "withdrawn", actor: string): Promise<TicketTypeFull> {
  return inTransaction(async (client) => {
    const found = await client.query(`SELECT status FROM event_ticket_types WHERE id = $1 AND fundraiser_id = $2 FOR UPDATE`, [typeId, fundraiserId]);
    const was = (found.rows as Row[])[0]?.status as string | undefined;
    if (!was) throw new TicketError("not_found", "That ticket no longer exists.");
    if (was === status) throw new TicketError("bad_state", status === "approved" ? "That ticket is on sale already." : "That ticket is off sale already.");
    const r = await client.query(
      status === "approved"
        ? `UPDATE event_ticket_types SET status = 'approved', approved_at = now(), approved_by = $2, withdrawn_at = NULL, withdrawn_by = NULL
            WHERE id = $1 RETURNING id, name, price_pence, quantity, status, sort_order, proposed_by, proposed_at, approved_at, approved_by`
        : `UPDATE event_ticket_types SET status = 'withdrawn', withdrawn_at = now(), withdrawn_by = $2
            WHERE id = $1 RETURNING id, name, price_pence, quantity, status, sort_order, proposed_by, proposed_at, approved_at, approved_by`,
      [typeId, actor],
    );
    await ensureSettings(client, fundraiserId);
    await insertAudit(client, {
      actor,
      action: status === "approved" ? "tickets.type_approved" : "tickets.type_withdrawn",
      entity: "event_ticket_type",
      entityId: typeId,
      data: { fundraiserId, was },
    });
    return toType((r.rows as Row[])[0]);
  });
}

/** Staff: change a type's name, price or number on sale. Never below what is already taken. */
export async function editType(
  fundraiserId: number,
  typeId: number,
  patch: { name?: string; pricePence?: number; quantity?: number | null },
  actor: string,
): Promise<TicketTypeFull> {
  return inTransaction(async (client) => {
    await ensureSettings(client, fundraiserId);
    await client.query(`SELECT 1 FROM event_ticket_settings WHERE fundraiser_id = $1 FOR UPDATE`, [fundraiserId]);
    const found = await client.query(`SELECT name, price_pence, quantity FROM event_ticket_types WHERE id = $1 AND fundraiser_id = $2 FOR UPDATE`, [typeId, fundraiserId]);
    const before = (found.rows as Row[])[0];
    if (!before) throw new TicketError("not_found", "That ticket no longer exists.");
    if (patch.name !== undefined) {
      const clash = await client.query(
        `SELECT 1 FROM event_ticket_types WHERE fundraiser_id = $1 AND id <> $2 AND lower(name) = lower($3) AND status <> 'withdrawn'`,
        [fundraiserId, typeId, patch.name],
      );
      if (clash.rowCount) throw new TicketError("refused", `There is already a ticket called ${patch.name}.`);
    }
    if (patch.quantity !== undefined && patch.quantity !== null) {
      const state = await readTicketState(client, fundraiserId);
      const taken = state.taken[typeId] ?? 0;
      if (patch.quantity < taken) throw new TicketError("refused", `${taken} of these are already sold or being bought, so the number on sale cannot be less than that.`);
    }
    const sets: string[] = [];
    const values: unknown[] = [typeId];
    if (patch.name !== undefined) sets.push(`name = $${values.push(patch.name)}`);
    if (patch.pricePence !== undefined) sets.push(`price_pence = $${values.push(patch.pricePence)}`);
    if (patch.quantity !== undefined) sets.push(`quantity = $${values.push(patch.quantity)}`);
    const r = await client.query(
      `UPDATE event_ticket_types SET ${sets.join(", ")} WHERE id = $1
       RETURNING id, name, price_pence, quantity, status, sort_order, proposed_by, proposed_at, approved_at, approved_by`,
      values,
    );
    await insertAudit(client, {
      actor,
      action: "tickets.type_changed",
      entity: "event_ticket_type",
      entityId: typeId,
      data: { fundraiserId, before: { name: before.name, pricePence: num(before.price_pence), quantity: before.quantity }, after: patch },
    });
    return toType((r.rows as Row[])[0]);
  });
}

/** Staff: add a type straight on sale (staff approve what staff add). */
export async function addTypeByStaff(fundraiserId: number, type: ProposedType, actor: string): Promise<void> {
  await inTransaction(async (client) => {
    await ensureSettings(client, fundraiserId);
    const clash = await client.query(
      `SELECT 1 FROM event_ticket_types WHERE fundraiser_id = $1 AND lower(name) = lower($2) AND status <> 'withdrawn'`,
      [fundraiserId, type.name],
    );
    if (clash.rowCount) throw new TicketError("refused", `There is already a ticket called ${type.name}.`);
    const [id] = await insertTypes(client, fundraiserId, [type], actor, "approved");
    await insertAudit(client, { actor, action: "tickets.type_added", entity: "event_ticket_type", entityId: id, data: { fundraiserId, type } });
  });
}

/** Staff: set the overall limit (null for none), or approve the one the organiser proposed. Never below what is taken. */
export async function setSalesLimit(fundraiserId: number, limit: number | null, actor: string, fromProposal = false): Promise<void> {
  await inTransaction(async (client) => {
    await ensureSettings(client, fundraiserId);
    await client.query(`SELECT 1 FROM event_ticket_settings WHERE fundraiser_id = $1 FOR UPDATE`, [fundraiserId]);
    if (limit !== null) {
      const state = await readTicketState(client, fundraiserId);
      const taken = Object.values(state.taken).reduce((n, v) => n + v, 0);
      if (limit < taken) throw new TicketError("refused", `${taken} tickets are already sold or being bought, so the limit cannot be less than that.`);
    }
    await client.query(
      `UPDATE event_ticket_settings
          SET sales_limit = $2::integer, updated_at = now(), updated_by = $3,
              proposed_sales_limit = CASE WHEN $4::boolean THEN NULL ELSE proposed_sales_limit END,
              proposed_at = CASE WHEN $4::boolean THEN NULL ELSE proposed_at END
        WHERE fundraiser_id = $1`,
      [fundraiserId, limit, actor, fromProposal],
    );
    await insertAudit(client, { actor, action: "tickets.limit_set", entity: "fundraiser", entityId: fundraiserId, data: { limit, fromProposal } });
  });
}

/** Staff: decline the organiser's proposed limit. */
export async function declineProposedLimit(fundraiserId: number, actor: string): Promise<void> {
  await inTransaction(async (client) => {
    await client.query(
      `UPDATE event_ticket_settings SET proposed_sales_limit = NULL, proposed_at = NULL, updated_at = now(), updated_by = $2 WHERE fundraiser_id = $1`,
      [fundraiserId, actor],
    );
    await insertAudit(client, { actor, action: "tickets.limit_declined", entity: "fundraiser", entityId: fundraiserId, data: {} });
  });
}

/**
 * Staff: set when sales close (when the event starts, midnight the day before, or a moment), or
 * approve the host's proposed choice (fromProposal: the stored proposal is what is applied).
 */
export async function setSalesClose(fundraiserId: number, close: CloseChoice | null, actor: string, fromProposal = false): Promise<void> {
  await inTransaction(async (client) => {
    await ensureSettings(client, fundraiserId);
    const r = await client.query(`SELECT proposed_close_mode, proposed_close_at FROM event_ticket_settings WHERE fundraiser_id = $1 FOR UPDATE`, [fundraiserId]);
    const row = (r.rows as Row[])[0];
    const apply: CloseChoice | null = fromProposal
      ? row?.proposed_close_mode
        ? { mode: row.proposed_close_mode as CloseChoice["mode"], at: iso(row.proposed_close_at) }
        : null
      : close;
    if (!apply) throw new TicketError("bad_state", "There is no closing time waiting to be approved.");
    await client.query(
      `UPDATE event_ticket_settings
          SET sales_close_mode = $2, sales_close_at = $3::timestamptz, updated_at = now(), updated_by = $4,
              proposed_close_mode = CASE WHEN $5::boolean THEN NULL ELSE proposed_close_mode END,
              proposed_close_at = CASE WHEN $5::boolean THEN NULL ELSE proposed_close_at END
        WHERE fundraiser_id = $1`,
      [fundraiserId, apply.mode, apply.mode === "custom" ? apply.at : null, actor, fromProposal],
    );
    await insertAudit(client, { actor, action: "tickets.close_set", entity: "fundraiser", entityId: fundraiserId, data: { close: apply, fromProposal } });
  });
}

/** Staff: decline the host's proposed closing time. */
export async function declineProposedClose(fundraiserId: number, actor: string): Promise<void> {
  await inTransaction(async (client) => {
    await client.query(
      `UPDATE event_ticket_settings SET proposed_close_mode = NULL, proposed_close_at = NULL, updated_at = now(), updated_by = $2 WHERE fundraiser_id = $1`,
      [fundraiserId, actor],
    );
    await insertAudit(client, { actor, action: "tickets.close_declined", entity: "fundraiser", entityId: fundraiserId, data: {} });
  });
}

/** Staff: close sales by hand, or open them again. */
export async function setSalesClosed(fundraiserId: number, closed: boolean, actor: string): Promise<void> {
  await inTransaction(async (client) => {
    await ensureSettings(client, fundraiserId);
    await client.query(
      `UPDATE event_ticket_settings
          SET sales_closed_at = CASE WHEN $2::boolean THEN now() ELSE NULL END,
              sales_closed_by = CASE WHEN $2::boolean THEN $3::text ELSE NULL END,
              updated_at = now(), updated_by = $3::text
        WHERE fundraiser_id = $1`,
      [fundraiserId, closed, actor],
    );
    await insertAudit(client, { actor, action: closed ? "tickets.sales_closed" : "tickets.sales_opened", entity: "fundraiser", entityId: fundraiserId, data: {} });
  });
}

// --- buying --------------------------------------------------------------------------------------------

export interface ReserveInput {
  fundraiserId: number;
  fundraisingOn: boolean;
  lines: OrderLineIn[];
  buyer: { firstName: string; lastName: string; email: string; phone: string | null };
  coverFee: boolean;
  cardFee: CardFeeRate;
  /** Makes a booking reference; called again if one is already taken. */
  newReference: () => string;
  /** A hash of the buyer's address, to cap their open checkouts; null when it is not capped (the box itself). */
  ipHash: string | null;
  now: Date;
}

export interface ReservedOrder {
  id: number;
  reference: string;
  money: OrderMoney;
  lines: Array<{ typeId: number; name: string; unitPence: number; quantity: number }>;
}

export const TOO_MANY_OPEN =
  "There are already two checkouts open for these tickets from you. Finish paying in one of them, or wait about half an hour for them to close, then try again.";
export const TOO_MANY_FREE = `You already have ${FREE_BOOKINGS_MAX} free bookings for this event. Need more? Email events@nbcc.scot.`;
export const TOO_MANY_FREE_HERE = "We've had several free bookings from this connection. If that isn't you, email events@nbcc.scot and we'll book you in.";

const isUniqueViolation = (err: unknown, on: string): boolean =>
  typeof err === "object" && err !== null && (err as { code?: string }).code === "23505" && String((err as { constraint?: string }).constraint ?? "").includes(on);

/**
 * Take the places for a checkout, or say why not. Under the event's lock: the event is read again
 * (still approved, public, selling through NBCC, not sharing with another cause, not closed or
 * started), what is left is worked out with every other open checkout counted, the prices are the
 * stored ones (and must be the ones the buyer's page showed), and one buyer (by email, or by
 * address) may only have two checkouts open at once. The order holds its places for five minutes;
 * attaching Stripe's checkout (attachSession) makes that the hour.
 */
export async function reserveOrder(
  input: ReserveInput,
): Promise<{ ok: true; order: ReservedOrder } | { ok: false; problem: string; tooMany?: boolean }> {
  return inTransaction(async (client) => {
    await ensureSettings(client, input.fundraiserId);
    await client.query(`SELECT 1 FROM event_ticket_settings WHERE fundraiser_id = $1 FOR UPDATE`, [input.fundraiserId]);
    const ev = (
      await client.query(
        `SELECT status, public, path, booking, in_memory, shares_with_other,
                to_char(event_date, 'YYYY-MM-DD') AS event_date, to_char(start_time, 'HH24:MI') AS start_time
           FROM fundraisers WHERE id = $1`,
        [input.fundraiserId],
      )
    ).rows[0] as Row | undefined;
    if (!ev) return { ok: false, problem: "These tickets are not on sale." };
    const state = await readTicketState(client, input.fundraiserId);
    const a = availabilityOf(state);
    const sales = salesState(
      {
        status: String(ev.status),
        public: Boolean(ev.public),
        path: String(ev.path),
        booking: (ev.booking as string | null) ?? null,
        inMemory: Boolean(ev.in_memory),
        sharesWithOther: ev.shares_with_other === true,
        ...closeFields(state.settings),
        eventDate: (ev.event_date as string | null) ?? null,
        startTime: (ev.start_time as string | null) ?? null,
      },
      { fundraisingOn: input.fundraisingOn, now: input.now, onSale: a.onSale, soldOut: a.soldOut },
    );
    if (sales === "sold_out") return { ok: false, problem: "Sorry, these tickets have sold out." };
    if (sales === "soon") return { ok: false, problem: "These tickets are not on sale yet." };
    if (sales !== "open") return { ok: false, problem: "Ticket sales have closed." };
    const problem = checkOrder(input.lines, a);
    if (problem) return { ok: false, problem };

    // Open checkouts this buyer already has for this event: no one holds the room by asking again.
    const open = (
      await client.query(
        `SELECT COUNT(*) FILTER (WHERE lower(buyer_email) = lower($2::text)) AS by_email,
                COUNT(*) FILTER (WHERE $3::text IS NOT NULL AND ip_hash = $3::text) AS by_ip
           FROM event_ticket_orders
          WHERE fundraiser_id = $1 AND status = 'pending' AND hold_expires_at > now()`,
        [input.fundraiserId, input.buyer.email, input.ipHash],
      )
    ).rows[0] as Row;
    if (num(open.by_email) >= LIVE_HOLDS_MAX || num(open.by_ip) >= LIVE_HOLDS_MAX) return { ok: false, problem: TOO_MANY_OPEN, tooMany: true };

    const lines = input.lines.map((l) => {
      const t = a.types.find((x) => x.id === l.typeId) as Availability["types"][number];
      return { typeId: t.id, name: t.name, unitPence: t.pricePence, quantity: l.quantity };
    });
    const money = orderMoney(lines, input.coverFee, input.cardFee);
    // Free bookings cost nothing to make, so one buyer may only have so many standing for an event:
    // two by email, six by address (a household or a school shares one). One still on its way (a
    // pending order with nothing to pay) counts too, so two at the same moment cannot both slip under.
    if (money.totalPence === 0) {
      const standing = (
        await client.query(
          `SELECT COUNT(*) FILTER (WHERE lower(buyer_email) = lower($2::text)) AS by_email,
                  COUNT(*) FILTER (WHERE $3::text IS NOT NULL AND ip_hash = $3::text) AS by_ip
             FROM event_ticket_orders o
            WHERE fundraiser_id = $1 AND total_pence = 0
              AND (status = 'paid' OR (status = 'pending' AND hold_expires_at > now()))
              AND EXISTS (SELECT 1 FROM event_ticket_order_lines l WHERE l.order_id = o.id AND l.quantity > l.refunded_quantity)`,
          [input.fundraiserId, input.buyer.email, input.ipHash],
        )
      ).rows[0] as Row;
      if (num(standing.by_email) >= FREE_BOOKINGS_MAX) return { ok: false, problem: TOO_MANY_FREE, tooMany: true };
      if (num(standing.by_ip) >= FREE_BOOKINGS_IP_MAX) return { ok: false, problem: TOO_MANY_FREE_HERE, tooMany: true };
    }
    // A reference already taken (one in about 900 million) is simply made again.
    let id = 0;
    let reference = "";
    for (let tries = 0; id === 0; tries += 1) {
      reference = input.newReference();
      await client.query("SAVEPOINT ticket_reference");
      try {
        const o = await client.query(
          `INSERT INTO event_ticket_orders
             (reference, fundraiser_id, status, buyer_first_name, buyer_surname, buyer_email, buyer_phone,
              tickets_pence, fee_cover_pence, total_pence, hold_expires_at, ip_hash)
           VALUES ($1, $2, 'pending', $3, $4, $5, $6, $7, $8, $9, now() + ($10 || ' minutes')::interval, $11)
           RETURNING id`,
          [
            reference,
            input.fundraiserId,
            input.buyer.firstName,
            input.buyer.lastName,
            input.buyer.email,
            input.buyer.phone,
            money.ticketsPence,
            money.feeCoverPence,
            money.totalPence,
            String(UNATTACHED_HOLD_MINUTES),
            input.ipHash,
          ],
        );
        id = num((o.rows as Row[])[0].id);
        await client.query("RELEASE SAVEPOINT ticket_reference");
      } catch (err) {
        if (tries >= 5 || !isUniqueViolation(err, "reference")) throw err;
        await client.query("ROLLBACK TO SAVEPOINT ticket_reference");
      }
    }
    for (const l of lines) {
      await client.query(
        `INSERT INTO event_ticket_order_lines (order_id, ticket_type_id, type_name, unit_pence, quantity) VALUES ($1, $2, $3, $4, $5)`,
        [id, l.typeId, l.name, l.unitPence, l.quantity],
      );
    }
    return { ok: true, order: { id, reference, money, lines } };
  });
}

/**
 * Stripe's checkout is open for this order: it now holds its places for the hour. Only while its
 * first five minutes have not run out: a hold already released is NOT brought back (someone else may
 * have its places by now). False then, and the caller closes the checkout and says so.
 */
export async function attachSession(orderId: number, sessionId: string): Promise<boolean> {
  const r = await pool.query(
    `UPDATE event_ticket_orders SET stripe_session_id = $2, hold_expires_at = now() + ($3 || ' minutes')::interval
      WHERE id = $1 AND status = 'pending' AND hold_expires_at > now()`,
    [orderId, sessionId, String(HOLD_MINUTES)],
  );
  return Boolean(r.rowCount);
}

/**
 * The same buyer (the same email from the same address) starting again: their older checkouts for
 * this event that are still open. The caller closes each at Stripe and cancels it (supersedeOrder),
 * so an honest buyer who went back and changed their mind is never refused for their own checkout.
 */
export async function openOrdersOfBuyer(fundraiserId: number, email: string, ipHash: string | null): Promise<Array<{ id: number; sessionId: string | null }>> {
  const r = await pool.query(
    `SELECT id, stripe_session_id FROM event_ticket_orders
      WHERE fundraiser_id = $1 AND status = 'pending' AND hold_expires_at > now()
        AND lower(buyer_email) = lower($2::text) AND ip_hash IS NOT DISTINCT FROM $3::text
      ORDER BY id`,
    [fundraiserId, email, ipHash],
  );
  return (r.rows as Row[]).map((x) => ({ id: num(x.id), sessionId: (x.stripe_session_id as string | null) ?? null }));
}

/**
 * An older checkout of the same buyer: cancelled here, its places back on sale. ONLY if its Stripe
 * checkout is still the one the caller read (and closed at Stripe): if another request has opened a
 * checkout for it since, it is left alone (false), so an order is never cancelled while a checkout
 * nobody closed can still be paid. One with no checkout yet is cancelled as it stands; whoever then
 * tries to attach a checkout to it is refused (attachSession) and closes that checkout itself.
 */
export async function supersedeOrder(orderId: number, sessionId: string | null): Promise<boolean> {
  const r = await pool.query(
    `UPDATE event_ticket_orders SET status = 'cancelled'
      WHERE id = $1 AND status = 'pending' AND stripe_session_id IS NOT DISTINCT FROM $2::text`,
    [orderId, sessionId],
  );
  return Boolean(r.rowCount);
}

/**
 * A free booking (every ticket on it is £0): nothing to pay, so it never goes to Stripe. It was
 * reserved under the same lock, limits and caps as any order; this books it at once. Its "session"
 * is our own token (cs_free_...), only so the thank you can find it as it finds a paid one.
 */
export async function confirmFreeOrder(orderId: number, token: string): Promise<boolean> {
  return inTransaction(async (client) => {
    const r = await client.query(
      `UPDATE event_ticket_orders SET status = 'paid', paid_at = now(), stripe_session_id = $2
        WHERE id = $1 AND status = 'pending' AND total_pence = 0 RETURNING reference`,
      [orderId, token],
    );
    const row = (r.rows as Row[])[0];
    if (!row) return false;
    await insertAudit(client, { actor: "system:tickets", action: "tickets.booked_free", entity: "event_ticket_order", entityId: orderId, data: { reference: row.reference } });
    return true;
  });
}

/**
 * Cancel a free booking (the organiser, or staff): its places go back on sale and the buyer is told.
 * Only a booking with nothing paid: one with money on it is refunded, by an admin.
 */
export async function cancelFreeBooking(fundraiserId: number, orderId: number, actor: string): Promise<OrderFull> {
  return inTransaction(async (client) => {
    await client.query(`SELECT 1 FROM event_ticket_orders WHERE id = $1 FOR UPDATE`, [orderId]);
    const order = await getOrder(client, orderId);
    if (!order || order.fundraiserId !== fundraiserId || order.status !== "paid") throw new TicketError("not_found", "We could not find that booking.");
    if (order.totalPence !== 0) throw new TicketError("refused", "Only a free booking can be cancelled here. A booking that was paid for is refunded instead.");
    await client.query(`UPDATE event_ticket_orders SET status = 'cancelled' WHERE id = $1`, [orderId]);
    await insertAudit(client, { actor, action: "tickets.free_booking_cancelled", entity: "event_ticket_order", entityId: orderId, data: { reference: order.reference } });
    return order;
  });
}

/** Stripe could not start the checkout: give the places straight back. */
export async function cancelPendingOrder(orderId: number): Promise<void> {
  await pool.query(`UPDATE event_ticket_orders SET status = 'cancelled' WHERE id = $1 AND status = 'pending'`, [orderId]);
}

/** The order a checkout paid for, for the thank you after paying: its reference and where it is up to. */
export async function orderForSession(sessionId: string): Promise<{ reference: string; status: string; fundraiserId: number } | null> {
  const r = await pool.query(`SELECT reference, status, fundraiser_id FROM event_ticket_orders WHERE stripe_session_id = $1`, [sessionId]);
  const row = (r.rows as Row[])[0];
  return row ? { reference: String(row.reference), status: String(row.status), fundraiserId: num(row.fundraiser_id) } : null;
}

// --- the webhook (each on the webhook's own transaction, so it commits with the event id) ----------------

/** How far over its limit (or a type's own number on sale) an event is: 0 when it is not. */
function overBy(state: TicketState): number {
  const total = Object.values(state.taken).reduce((n, v) => n + v, 0);
  const overall = state.settings.salesLimit !== null ? total - state.settings.salesLimit : 0;
  const perType = state.types.map((t) => (t.quantity !== null ? (state.taken[t.id] ?? 0) - t.quantity : 0));
  return Math.max(0, overall, ...perType);
}

export interface PaidOutcome {
  action: string;
  orderId: number | null;
  /** A payment for a reference we have no order for: staff are emailed what Stripe said. */
  unknown?: { reference: string; sessionId: string; amountTotal: number | null };
  /** What staff should be told about it (src/tickets/model.ts flagWords), or null. */
  flags: OrderFlags | null;
}

/**
 * checkout.session.completed: the order is paid. Found by its reference (in the session's metadata)
 * and locked. Recorded whatever its state, as the money is taken; but anything odd is kept on the
 * order as a flag for staff (and they are emailed): paid after its hold ran out with the event now
 * over its limit, a different amount than it was made for, a different checkout than the one we
 * opened, or not in pounds.
 */
export async function markOrderPaid(
  client: Querier,
  s: { reference: string; sessionId: string; paymentIntentId: string | null; amountTotal: number | null; currency: string | null; eventId: string },
): Promise<PaidOutcome> {
  const found = await client.query(
    `SELECT id, status, total_pence, fundraiser_id, stripe_session_id, hold_expires_at <= now() AS late FROM event_ticket_orders WHERE reference = $1 FOR UPDATE`,
    [s.reference],
  );
  const row = (found.rows as Row[])[0];
  if (!row) {
    console.error(`event tickets: a payment for ${s.reference} has no order`);
    await client.query(`INSERT INTO audit_log (actor, action, entity, entity_id, data) VALUES ($1, $2, $3, $4, $5)`, [
      "system:stripe",
      "tickets.paid_unknown_order",
      "event_ticket_order",
      null,
      { reference: s.reference, sessionId: s.sessionId, eventId: s.eventId },
    ]);
    return { action: "tickets.unknown_order", orderId: null, flags: null, unknown: { reference: s.reference, sessionId: s.sessionId, amountTotal: s.amountTotal } };
  }
  const id = num(row.id);
  if (row.status === "paid") return { action: "tickets.already_paid", orderId: id, flags: null };
  await client.query(
    `UPDATE event_ticket_orders
        SET status = 'paid', paid_at = now(), stripe_session_id = COALESCE(stripe_session_id, $2::text),
            stripe_payment_intent_id = COALESCE($3::text, stripe_payment_intent_id)
      WHERE id = $1`,
    [id, s.sessionId, s.paymentIntentId],
  );
  const flags: OrderFlags = {};
  if (row.status !== "pending" || row.late) {
    // Its places had been given back: now it is paid, is the event over its limit?
    const over = overBy(await readTicketState(client, num(row.fundraiser_id)));
    flags.paidLate = { was: String(row.status), overBy: over };
    if (over > 0) console.error(`event tickets: ${s.reference} was paid after its places were released, and the event is now ${over} over its limit`);
  }
  if (s.amountTotal !== null && s.amountTotal !== num(row.total_pence)) {
    flags.amountMismatch = { expected: num(row.total_pence), paid: s.amountTotal };
    console.error(`event tickets: ${s.reference} was paid ${s.amountTotal} pence, not ${num(row.total_pence)}`);
  }
  if (row.stripe_session_id && row.stripe_session_id !== s.sessionId) {
    flags.sessionMismatch = true;
    console.error(`event tickets: ${s.reference} was paid on checkout ${s.sessionId}, not the one opened for it`);
  }
  if (s.currency && s.currency.toLowerCase() !== "gbp") flags.currencyMismatch = s.currency.toLowerCase();
  const flagged = Object.keys(flags).length > 0;
  if (flagged) await client.query(`UPDATE event_ticket_orders SET flags = flags || $2::jsonb WHERE id = $1`, [id, JSON.stringify(flags)]);
  await insertAudit(client as PoolClient, {
    actor: "stripe",
    action: "tickets.paid",
    entity: "event_ticket_order",
    entityId: id,
    data: { reference: s.reference, eventId: s.eventId, ...flags },
  });
  return { action: flagged ? "tickets.paid_flagged" : "tickets.paid", orderId: id, flags: flagged ? flags : null };
}

/** checkout.session.expired: an abandoned checkout gives its places back. */
export async function markOrderExpired(client: Querier, sessionId: string, reference: string | null): Promise<string> {
  const r = await client.query(
    `UPDATE event_ticket_orders SET status = 'expired' WHERE (stripe_session_id = $1::text OR reference = $2::text) AND status = 'pending'`,
    [sessionId, reference],
  );
  return r.rowCount ? "tickets.expired" : "tickets.expired_noop";
}

/** The order a payment intent paid for, if it is a ticket order. */
export async function orderIdForPaymentIntent(client: Querier, paymentIntentId: string): Promise<number | null> {
  const r = await client.query(`SELECT id FROM event_ticket_orders WHERE stripe_payment_intent_id = $1 ORDER BY id LIMIT 1`, [paymentIntentId]);
  const row = (r.rows as Row[])[0];
  return row ? num(row.id) : null;
}

/** A refund as Stripe lists it: its id, amount, status, and (metadata.refundIntent) the intent it was made for. */
export interface StripeRefundLite {
  id: string;
  amount: number;
  status: string | null;
  intentId: number | null;
}

/** Asks Stripe for every refund on a payment (src/tickets/refunds.ts). It throws if Stripe cannot be reached. */
export type RefundLister = (paymentIntentId: string) => Promise<StripeRefundLite[]>;

export interface Reconciled {
  action: string;
  /** Refunds an admin made here, finished by this run (the buyer is emailed for these, once). */
  completedPence: number;
  /** Refunds made in Stripe itself, first recorded by this run. */
  stripePence: number;
  /** Both together: what the buyer is told has just been refunded. */
  refundedNowPence: number;
  /** No ticket on the booking still stands. */
  full: boolean;
  /** A refund failed at the bank, found by this run: what staff are told (never the buyer). */
  failedWords: string[];
}

type IntentLine = { lineId: number; quantity: number };

/**
 * THE ONE RULE FOR REFUNDED MONEY: Stripe is the source of truth. Under the order's lock, Stripe is
 * asked for every refund on the payment, and this side is made to agree:
 *
 *   - refunded_pence is the sum of Stripe's SUCCEEDED refunds (never more than was paid);
 *   - a refund of ours still waiting (an intent) whose refund has succeeded is finished: its tickets
 *     released, its request closed, audited, and the buyer emailed by the caller;
 *   - an intent whose refund failed or was cancelled, or that Stripe never made and whose key is now
 *     too old to use again, is closed as failed;
 *   - a succeeded refund that is not one of ours was made in Stripe itself: its MONEY is recorded,
 *     and no ticket is released (an admin says which, "Release these tickets"), unless the booking is
 *     now refunded in full, when every ticket is released;
 *   - a refund already applied here that has since failed at the bank: the money goes back to what
 *     Stripe says, the tickets are NOT taken back (their places may be sold again by now), the order
 *     is flagged and the caller tells staff. The buyer gets no automatic email.
 *
 * No event's own amount or status is ever used, so events arriving late, twice or out of order
 * cannot do harm: running this again changes nothing and returns nothing to send.
 */
export async function reconcileRefunds(client: Querier, orderId: number, list: RefundLister): Promise<Reconciled> {
  const out: Reconciled = { action: "tickets.refunds_unchanged", completedPence: 0, stripePence: 0, refundedNowPence: 0, full: false, failedWords: [] };
  const found = await client.query(`SELECT total_pence, refunded_pence, stripe_payment_intent_id, fundraiser_id FROM event_ticket_orders WHERE id = $1 FOR UPDATE`, [orderId]);
  const o = (found.rows as Row[])[0];
  if (!o || !o.stripe_payment_intent_id) return out;
  const total = num(o.total_pence);
  const atStripe = await list(String(o.stripe_payment_intent_id));
  const rows = (
    await client.query(
      `SELECT id, amount_pence, lines, status, request_id, refunded_by, note, stripe_refund_id,
              created_at < now() - ($2 || ' hours')::interval AS old
         FROM event_ticket_refunds WHERE order_id = $1 ORDER BY id FOR UPDATE`,
      [orderId, String(INTENT_HOURS)],
    )
  ).rows as Row[];
  // A Stripe refund's row here: by Stripe's refund id, or (one of ours not yet given its id) by the
  // intent id in the refund's own metadata. Never by amount.
  const rowOf = (r: StripeRefundLite): Row | undefined =>
    rows.find((x) => x.stripe_refund_id === r.id) ??
    (r.intentId === null ? undefined : rows.find((x) => num(x.id) === r.intentId && x.refunded_by !== "stripe" && x.stripe_refund_id == null));
  const succeeded = atStripe.filter((r) => r.status === "succeeded");
  const refunded = Math.min(total, succeeded.reduce((n, r) => n + Math.max(0, r.amount), 0));
  const matched = new Set<number>();

  // 1. Our own refunds that Stripe has made.
  for (const r of succeeded) {
    const row = rowOf(r);
    if (!row) continue;
    matched.add(num(row.id));
    if (row.status === "done" && row.stripe_refund_id == null) {
      await client.query(`UPDATE event_ticket_refunds SET stripe_refund_id = COALESCE(stripe_refund_id, $2::text) WHERE id = $1`, [num(row.id), r.id]);
    }
    if (row.status !== "pending") continue;
    const lines = (row.lines as IntentLine[]) ?? [];
    for (const l of lines) {
      await client.query(`UPDATE event_ticket_order_lines SET refunded_quantity = LEAST(quantity, refunded_quantity + $2) WHERE id = $1 AND order_id = $3`, [l.lineId, l.quantity, orderId]);
    }
    await client.query(`UPDATE event_ticket_refunds SET status = 'done', completed_at = now(), stripe_refund_id = COALESCE(stripe_refund_id, $2::text) WHERE id = $1`, [num(row.id), r.id]);
    if (row.request_id != null) {
      await client.query(
        `UPDATE event_ticket_refund_requests SET status = 'refunded', dealt_at = now(), dealt_by = $2, dealt_note = $3 WHERE id = $1 AND status = 'open'`,
        [row.request_id, row.refunded_by, row.note],
      );
    }
    await insertAudit(client as PoolClient, {
      actor: String(row.refunded_by),
      action: "tickets.refunded",
      entity: "event_ticket_order",
      entityId: orderId,
      data: { intentId: num(row.id), amountPence: num(row.amount_pence), lines, stripeRefundId: r.id, requestId: row.request_id, note: row.note },
    });
    out.completedPence += num(row.amount_pence);
  }

  // 2. Refunds made in Stripe itself: the money only, unless the booking is now refunded in full.
  const fresh = succeeded.filter((r) => !rowOf(r));
  const releaseAll = fresh.length > 0 && total > 0 && refunded >= total;
  let released: IntentLine[] = [];
  if (releaseAll) {
    const standing = (await client.query(`SELECT id, ticket_type_id, quantity, refunded_quantity FROM event_ticket_order_lines WHERE order_id = $1 ORDER BY id`, [orderId])).rows as Row[];
    released = standing.map((l) => ({ lineId: num(l.id), quantity: num(l.quantity) - num(l.refunded_quantity) })).filter((l) => l.quantity > 0);
    await client.query(`UPDATE event_ticket_order_lines SET refunded_quantity = quantity WHERE order_id = $1`, [orderId]);
  }
  for (const [i, r] of fresh.entries()) {
    // The tickets a refund in full released are kept on its last row, so that if it later fails at
    // the bank staff are told tickets were released for it.
    const mine = releaseAll && i === fresh.length - 1 ? released : [];
    await client.query(
      `INSERT INTO event_ticket_refunds (order_id, amount_pence, note, stripe_refund_id, lines, refunded_by, status, idempotency_key, completed_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, 'stripe', 'done', $6, now())
       ON CONFLICT DO NOTHING RETURNING id`,
      [
        orderId,
        Math.max(0, r.amount),
        releaseAll ? "Refunded in Stripe, in full: every ticket is back on sale." : "Refunded in Stripe, not in the admin: no tickets were put back on sale. Release them in the admin if they should be.",
        r.id,
        JSON.stringify(mine),
        `stripe-refund-${r.id}`,
      ],
    );
    await insertAudit(client as PoolClient, {
      actor: "stripe",
      action: "tickets.refunded_in_stripe",
      entity: "event_ticket_order",
      entityId: orderId,
      data: { stripeRefundId: r.id, amountPence: r.amount, full: releaseAll },
    });
    out.stripePence += Math.max(0, r.amount);
  }

  // 3. Refunds that failed at the bank (or were cancelled). The tickets are never taken back.
  let failures = 0;
  const releasedForFailed: IntentLine[] = [];
  for (const r of atStripe.filter((x) => x.status === "failed" || x.status === "canceled")) {
    const row = rowOf(r);
    if (!row) continue;
    matched.add(num(row.id));
    if (row.status === "failed") continue;
    const wasApplied = row.status === "done";
    await client.query(
      `UPDATE event_ticket_refunds SET status = 'failed', completed_at = now(), stripe_refund_id = COALESCE(stripe_refund_id, $2::text),
              note = COALESCE(note || ' ', '') || '(the refund failed at the bank)' WHERE id = $1`,
      [num(row.id), r.id],
    );
    if (wasApplied) releasedForFailed.push(...((row.lines as IntentLine[]) ?? []));
    await insertAudit(client as PoolClient, {
      actor: "stripe",
      action: "tickets.refund_failed",
      entity: "event_ticket_order",
      entityId: orderId,
      data: { refundRowId: num(row.id), stripeRefundId: r.id, status: r.status, wasApplied },
    });
    failures += 1;
  }

  // 4. Ours still waiting that Stripe does not have: kept while its key can still be used again
  //    (the same refund asked again finishes it), let go once it cannot.
  for (const row of rows) {
    if (row.status !== "pending" || matched.has(num(row.id)) || !row.old) continue;
    if (atStripe.some((r) => r.intentId === num(row.id))) continue; // Stripe has it, still on its way
    await client.query(
      `UPDATE event_ticket_refunds SET status = 'failed', completed_at = now(), note = COALESCE(note || ' ', '') || '(Stripe never made this refund)' WHERE id = $1`,
      [num(row.id)],
    );
    await insertAudit(client as PoolClient, { actor: "system:tickets", action: "tickets.refund_let_go", entity: "event_ticket_order", entityId: orderId, data: { intentId: num(row.id) } });
  }

  // 5. The money: what Stripe says, whatever was recorded here before.
  const moneyChanged = refunded !== num(o.refunded_pence);
  if (moneyChanged) await client.query(`UPDATE event_ticket_orders SET refunded_pence = $2 WHERE id = $1`, [orderId, refunded]);

  // 6. The flag. A failure is flagged, with how far over its limit the event is if the buyer (who
  //    has not been paid back) still comes with the tickets that were released. A refund that then
  //    goes through clears it.
  if (failures > 0) {
    let over = 0;
    if (releasedForFailed.length > 0) {
      const typeOf = new Map<number, number>();
      for (const l of (await client.query(`SELECT id, ticket_type_id, quantity, refunded_quantity FROM event_ticket_order_lines WHERE order_id = $1 ORDER BY id`, [orderId])).rows as Row[]) {
        typeOf.set(num(l.id), num(l.ticket_type_id));
      }
      const state = await readTicketState(client, num(o.fundraiser_id));
      for (const l of releasedForFailed) {
        const type = typeOf.get(l.lineId);
        if (type !== undefined) state.taken[type] = (state.taken[type] ?? 0) + l.quantity;
      }
      over = overBy(state);
    }
    const flag = { released: releasedForFailed.length > 0, overBy: over };
    await client.query(`UPDATE event_ticket_orders SET flags = flags || $2::jsonb WHERE id = $1`, [orderId, JSON.stringify({ refundFailed: flag })]);
    out.failedWords = [refundFailedWords(flag)];
  } else if (out.completedPence + out.stripePence > 0) {
    await client.query(`UPDATE event_ticket_orders SET flags = flags - 'refundFailed' WHERE id = $1`, [orderId]);
  }

  out.refundedNowPence = out.completedPence + out.stripePence;
  if (out.refundedNowPence > 0) {
    const left = await client.query(`SELECT COALESCE(SUM(quantity - refunded_quantity), 0) AS n FROM event_ticket_order_lines WHERE order_id = $1`, [orderId]);
    out.full = num((left.rows as Row[])[0]?.n) === 0;
  }
  out.action =
    failures > 0
      ? "tickets.refund_failed"
      : out.stripePence > 0
        ? "tickets.refunded_in_stripe"
        : out.completedPence > 0
          ? "tickets.refund_completed"
          : moneyChanged
            ? "tickets.refunds_reconciled"
            : "tickets.refunds_unchanged";
  return out;
}

/** reconcileRefunds in its own transaction, for the admin: with the booking as it now is. */
export async function reconcileOrderRefunds(orderId: number, list: RefundLister): Promise<Reconciled & { order: OrderFull | null }> {
  return inTransaction(async (client) => {
    const r = await reconcileRefunds(client, orderId, list);
    return { ...r, order: await getOrder(client, orderId) };
  });
}

/**
 * charge.dispute.*: the buyer has disputed the payment with their bank. Always noted in the audit
 * log. Once the bank takes the money back (funds_withdrawn) the order is flagged, its money stops
 * counting as ticket money, and staff are emailed; if the dispute is won (funds reinstated, or closed
 * as won) it counts again.
 */
export async function noteDispute(
  client: Querier,
  orderId: number,
  eventType: string,
  eventId: string,
  status: string | null,
): Promise<{ action: string; tellStaff: boolean }> {
  await insertAudit(client as PoolClient, { actor: "stripe", action: "tickets.disputed", entity: "event_ticket_order", entityId: orderId, data: { eventType, eventId, status } });
  if (eventType === "charge.dispute.funds_withdrawn") {
    const r = await client.query(
      `UPDATE event_ticket_orders SET disputed_at = now(), flags = flags || '{"disputed": true}'::jsonb WHERE id = $1 AND disputed_at IS NULL`,
      [orderId],
    );
    return { action: "tickets.dispute_funds_withdrawn", tellStaff: Boolean(r.rowCount) };
  }
  if (eventType === "charge.dispute.funds_reinstated" || (eventType === "charge.dispute.closed" && status === "won")) {
    await client.query(`UPDATE event_ticket_orders SET disputed_at = NULL, flags = flags - 'disputed' WHERE id = $1`, [orderId]);
    return { action: "tickets.dispute_won", tellStaff: false };
  }
  return { action: "tickets.disputed", tellStaff: false };
}

// --- orders, for staff and the organiser --------------------------------------------------------------------

const ORDER_SQL = `SELECT o.id, o.reference, o.status, o.buyer_first_name, o.buyer_surname, o.buyer_email, o.buyer_phone,
                          o.tickets_pence, o.fee_cover_pence, o.total_pence, o.refunded_pence, o.paid_at, o.created_at,
                          o.stripe_payment_intent_id, o.fundraiser_id, o.flags, o.disputed_at, o.confirmation_sent_at, o.confirmation_attempts,
                          COALESCE((SELECT json_agg(json_build_object('id', l.id, 'typeId', l.ticket_type_id, 'typeName', l.type_name, 'unitPence', l.unit_pence,
                                                                        'quantity', l.quantity, 'refundedQuantity', l.refunded_quantity) ORDER BY l.id)
                                      FROM event_ticket_order_lines l WHERE l.order_id = o.id), '[]'::json) AS lines
                     FROM event_ticket_orders o`;

export interface OrderFull extends OrderForList {
  createdAt: string;
  paymentIntentId: string | null;
  fundraiserId: number;
}

function toOrder(r: Row): OrderFull {
  return {
    id: num(r.id),
    reference: String(r.reference),
    status: r.status as OrderForList["status"],
    firstName: String(r.buyer_first_name),
    surname: String(r.buyer_surname),
    email: String(r.buyer_email),
    phone: (r.buyer_phone as string | null) ?? null,
    ticketsPence: num(r.tickets_pence),
    feeCoverPence: num(r.fee_cover_pence),
    totalPence: num(r.total_pence),
    refundedPence: num(r.refunded_pence),
    paidAt: iso(r.paid_at),
    createdAt: iso(r.created_at) ?? "",
    paymentIntentId: (r.stripe_payment_intent_id as string | null) ?? null,
    fundraiserId: num(r.fundraiser_id),
    flags: (r.flags as OrderFlags | null) ?? null,
    disputed: r.disputed_at != null,
    emailSent: r.confirmation_sent_at != null,
    emailFailing: r.confirmation_sent_at == null && num(r.confirmation_attempts) >= EMAIL_ATTEMPTS_MAX,
    lines: ((r.lines as Row[]) ?? []).map((l) => ({
      id: num(l.id),
      typeId: num(l.typeId),
      typeName: String(l.typeName),
      unitPence: num(l.unitPence),
      quantity: num(l.quantity),
      refundedQuantity: num(l.refundedQuantity),
    })) as OrderLine[],
  };
}

/** An event's paid orders (and, for staff, the rest), newest first. */
export async function listOrders(fundraiserId: number, opts: { paidOnly?: boolean } = {}): Promise<OrderFull[]> {
  const r = await pool.query(
    `${ORDER_SQL} WHERE o.fundraiser_id = $1 ${opts.paidOnly ? "AND o.status = 'paid'" : "AND (o.status = 'paid' OR (o.status = 'pending' AND o.hold_expires_at > now()))"} ORDER BY o.id DESC`,
    [fundraiserId],
  );
  return (r.rows as Row[]).map(toOrder);
}

export async function getOrder(db: Querier, orderId: number): Promise<OrderFull | null> {
  const r = await db.query(`${ORDER_SQL} WHERE o.id = $1`, [orderId]);
  const row = (r.rows as Row[])[0];
  return row ? toOrder(row) : null;
}

export async function markConfirmationSent(orderId: number): Promise<void> {
  await pool.query(`UPDATE event_ticket_orders SET confirmation_sent_at = now() WHERE id = $1`, [orderId]);
}

// --- refund requests and refunds ------------------------------------------------------------------------------

export interface RefundRequestRow {
  id: number;
  orderId: number;
  reference: string;
  buyerName: string;
  reason: string;
  requestedBy: string;
  requestedAt: string;
  status: "open" | "refunded" | "declined";
  dealtAt: string | null;
  dealtBy: string | null;
  dealtNote: string | null;
}

export async function listRefundRequests(fundraiserId: number): Promise<RefundRequestRow[]> {
  const r = await pool.query(
    `SELECT q.id, q.order_id, o.reference, o.buyer_first_name || ' ' || o.buyer_surname AS buyer_name, q.reason, q.requested_by,
            q.requested_at, q.status, q.dealt_at, q.dealt_by, q.dealt_note
       FROM event_ticket_refund_requests q JOIN event_ticket_orders o ON o.id = q.order_id
      WHERE q.fundraiser_id = $1 ORDER BY q.id DESC`,
    [fundraiserId],
  );
  return (r.rows as Row[]).map((q) => ({
    id: num(q.id),
    orderId: num(q.order_id),
    reference: String(q.reference),
    buyerName: String(q.buyer_name),
    reason: String(q.reason),
    requestedBy: String(q.requested_by),
    requestedAt: iso(q.requested_at) ?? "",
    status: q.status as RefundRequestRow["status"],
    dealtAt: iso(q.dealt_at),
    dealtBy: (q.dealt_by as string | null) ?? null,
    dealtNote: (q.dealt_note as string | null) ?? null,
  }));
}

export interface RefundRow {
  id: number;
  orderId: number;
  reference: string;
  /** Written down but not yet confirmed by Stripe: make the same refund again to finish it. */
  pending: boolean;
  amountPence: number;
  refundedBy: string;
  note: string | null;
  createdAt: string;
}

export async function listRefunds(fundraiserId: number): Promise<RefundRow[]> {
  const r = await pool.query(
    `SELECT f.id, f.order_id, o.reference, f.amount_pence, f.refunded_by, f.note, f.created_at, f.status
       FROM event_ticket_refunds f JOIN event_ticket_orders o ON o.id = f.order_id
      WHERE o.fundraiser_id = $1 AND f.status IN ('done', 'pending') ORDER BY f.id DESC`,
    [fundraiserId],
  );
  return (r.rows as Row[]).map((f) => ({
    id: num(f.id),
    orderId: num(f.order_id),
    reference: String(f.reference),
    pending: f.status === "pending",
    amountPence: num(f.amount_pence),
    refundedBy: String(f.refunded_by),
    note: (f.note as string | null) ?? null,
    createdAt: iso(f.created_at) ?? "",
  }));
}

/**
 * An organiser asks for a refund of one of their event's bookings. Under the order's lock: only a
 * paid booking with money left on it, and one open request a booking at a time (the database holds
 * that too). Staff are told by email after it commits.
 */
export async function createRefundRequest(fundraiserId: number, orderId: number, reason: string, email: string): Promise<{ id: number; order: OrderFull }> {
  return inTransaction(async (client) => {
    await client.query(`SELECT 1 FROM event_ticket_orders WHERE id = $1 FOR UPDATE`, [orderId]);
    const order = await getOrder(client, orderId);
    if (!order || order.fundraiserId !== fundraiserId || order.status !== "paid") throw new TicketError("not_found", "We could not find that booking.");
    if (order.refundedPence >= order.totalPence) throw new TicketError("refused", "That booking has been refunded in full already.");
    const already = "You have already asked for a refund of that booking. We'll be in touch.";
    const open = await client.query(`SELECT 1 FROM event_ticket_refund_requests WHERE order_id = $1 AND status = 'open'`, [orderId]);
    if (open.rowCount) throw new TicketError("refused", already);
    let id = 0;
    try {
      const r = await client.query(
        `INSERT INTO event_ticket_refund_requests (order_id, fundraiser_id, reason, requested_by) VALUES ($1, $2, $3, $4) RETURNING id`,
        [orderId, fundraiserId, reason, `organiser:${email}`],
      );
      id = num((r.rows as Row[])[0].id);
    } catch (err) {
      if (isUniqueViolation(err, "one_open")) throw new TicketError("refused", already);
      throw err;
    }
    await insertAudit(client, { actor: `organiser:${email}`, action: "tickets.refund_requested", entity: "event_ticket_order", entityId: orderId, data: { requestId: id, reason } });
    return { id, order };
  });
}

export async function declineRefundRequest(fundraiserId: number, requestId: number, actor: string, note: string | null): Promise<void> {
  await inTransaction(async (client) => {
    const r = await client.query(
      `UPDATE event_ticket_refund_requests SET status = 'declined', dealt_at = now(), dealt_by = $3, dealt_note = $4
        WHERE id = $1 AND fundraiser_id = $2 AND status = 'open' RETURNING order_id`,
      [requestId, fundraiserId, actor, note],
    );
    if (!r.rowCount) throw new TicketError("bad_state", "That request has been dealt with already.");
    await insertAudit(client, { actor, action: "tickets.refund_declined", entity: "event_ticket_order", entityId: num((r.rows as Row[])[0].order_id), data: { requestId, note } });
  });
}

// A refund in three steps, so a timed out or half written refund can never be paid twice and never
// leaves the wrong tickets standing:
//
//   1. beginRefund: under the order's lock, the booking must be exactly as the admin saw it, and any
//      request still open. The refund is written down 'pending' (an INTENT: the tickets, the amount
//      and its own idempotency key) and COMMITTED, before Stripe is asked for anything.
//   2. Stripe is asked, with that key (src/routes/admin-event-tickets.ts). The same intent asked
//      again uses the same key, so Stripe never pays it twice.
//   3. reconcileRefunds: Stripe is asked what it has refunded on the payment, and the intent Stripe
//      made is applied: the tickets released, the request closed, the audit row, and the order's
//      refunded money set to Stripe's own total; all in one commit. If that never happens here (the
//      answer was lost, the commit failed), any of Stripe's refund events runs the same reconcile
//      and finishes it, with the same tickets; or the admin makes the same refund again.
//
// Stripe saying a definite no marks the intent 'failed' (failRefund) and changes nothing else.

/**
 * Stripe keeps an idempotency key for 24 hours. Past 23, an intent's key is never used again: Stripe
 * is asked whether it made that refund (by the intent's id in the refund's metadata), and the intent
 * is completed if it did, and only let go if it did not.
 */
const INTENT_HOURS = 23;

export interface RefundIntent {
  id: number;
  key: string;
  amountPence: number;
  paymentIntentId: string;
  reference: string;
  /** This is the same refund asked again (still unconfirmed), not a new one. */
  retry: boolean;
}

const sameLines = (a: Array<{ lineId: number; quantity: number }>, b: Array<{ lineId: number; quantity: number }>): boolean => {
  const key = (l: Array<{ lineId: number; quantity: number }>) =>
    l
      .map((x) => `${x.lineId}x${x.quantity}`)
      .sort()
      .join(",");
  return key(a) === key(b);
};

export async function beginRefund(
  fundraiserId: number,
  orderId: number,
  wanted: Array<{ lineId: number; quantity: number; refundedQuantity: number }>,
  seen: { refundedPence: number },
  opts: { actor: string; requestId: number | null; note: string | null },
): Promise<RefundIntent> {
  return inTransaction(async (client) => {
    await client.query(`SELECT 1 FROM event_ticket_orders WHERE id = $1 FOR UPDATE`, [orderId]);
    const order = await getOrder(client, orderId);
    if (!order || order.fundraiserId !== fundraiserId) throw new TicketError("not_found", "We could not find that booking.");
    if (refundIsStale(order, wanted, seen.refundedPence)) throw new TicketError("stale", BOOKING_CHANGED);
    if (opts.requestId) {
      const q = await client.query(`SELECT status FROM event_ticket_refund_requests WHERE id = $1 AND order_id = $2 FOR UPDATE`, [opts.requestId, orderId]);
      const status = (q.rows as Row[])[0]?.status;
      if (!status) throw new TicketError("not_found", "That refund request is not for this booking.");
      if (status !== "open") throw new TicketError("stale", "That refund request has been dealt with already. Refresh and check before refunding.");
    }
    const plan = refundPlan(order, wanted);
    if (!plan.ok) throw new TicketError("refused", plan.error);
    if (!order.paymentIntentId) throw new TicketError("refused", "This booking has no card payment to refund. Refund it in Stripe.");

    // A pending intent is never let go here, and an old one's key is never reused: Stripe is asked
    // first what became of it (reconcileRefunds, which the caller runs before this).
    const pending = (
      await client.query(
        `SELECT id, amount_pence, lines, idempotency_key, created_at < now() - ($2 || ' hours')::interval AS old
           FROM event_ticket_refunds WHERE order_id = $1 AND status = 'pending' ORDER BY id`,
        [orderId, String(INTENT_HOURS)],
      )
    ).rows as Row[];
    if (pending.some((i) => i.old)) {
      throw new TicketError("refused", "An earlier refund on this booking is still being checked with Stripe. Please try again in a few minutes.");
    }
    const same = pending.find((i) => num(i.amount_pence) === plan.amountPence && sameLines((i.lines as Array<{ lineId: number; quantity: number }>) ?? [], plan.lines));
    if (same) {
      return { id: num(same.id), key: String(same.idempotency_key), amountPence: plan.amountPence, paymentIntentId: order.paymentIntentId, reference: order.reference, retry: true };
    }
    if (pending.length) {
      throw new TicketError(
        "refused",
        `A refund of ${pounds(num(pending[0].amount_pence))} on this booking has not been confirmed by Stripe yet. Make that same refund again to finish it (it will not be paid twice), then make this one.`,
      );
    }
    const key = `event-tickets-refund-${orderId}-${randomUUID()}`;
    const r = await client.query(
      `INSERT INTO event_ticket_refunds (order_id, amount_pence, lines, request_id, note, refunded_by, status, idempotency_key)
       VALUES ($1, $2, $3::jsonb, $4, $5, $6, 'pending', $7) RETURNING id`,
      [orderId, plan.amountPence, JSON.stringify(plan.lines), opts.requestId, opts.note, opts.actor, key],
    );
    const id = num((r.rows as Row[])[0].id);
    await insertAudit(client, {
      actor: opts.actor,
      action: "tickets.refund_started",
      entity: "event_ticket_order",
      entityId: orderId,
      data: { reference: order.reference, intentId: id, amountPence: plan.amountPence, lines: plan.lines, requestId: opts.requestId },
    });
    return { id, key, amountPence: plan.amountPence, paymentIntentId: order.paymentIntentId, reference: order.reference, retry: false };
  });
}

/**
 * An admin releases tickets with no money moving (src/tickets/model.ts releasePlan): free tickets on
 * a paid booking, or tickets whose money was refunded in Stripe itself. Under the order's lock, with
 * the booking as the admin saw it; the places go back on sale; audited. Returns the order as it is
 * now and the tickets released, in words, for the buyer's email.
 */
export async function releaseTickets(
  fundraiserId: number,
  orderId: number,
  wanted: Array<{ lineId: number; quantity: number; refundedQuantity: number }>,
  seen: { refundedPence: number },
  actor: string,
): Promise<{ order: OrderFull; tickets: string }> {
  return inTransaction(async (client) => {
    await client.query(`SELECT 1 FROM event_ticket_orders WHERE id = $1 FOR UPDATE`, [orderId]);
    const order = await getOrder(client, orderId);
    if (!order || order.fundraiserId !== fundraiserId) throw new TicketError("not_found", "We could not find that booking.");
    if (refundIsStale(order, wanted, seen.refundedPence)) throw new TicketError("stale", BOOKING_CHANGED);
    const plan = releasePlan(order, wanted);
    if (!plan.ok) throw new TicketError("refused", plan.error);
    for (const l of plan.lines) {
      await client.query(`UPDATE event_ticket_order_lines SET refunded_quantity = LEAST(quantity, refunded_quantity + $2) WHERE id = $1 AND order_id = $3`, [l.lineId, l.quantity, orderId]);
    }
    await insertAudit(client, { actor, action: "tickets.released_no_money", entity: "event_ticket_order", entityId: orderId, data: { reference: order.reference, lines: plan.lines, tickets: plan.tickets } });
    return { order: (await getOrder(client, orderId)) as OrderFull, tickets: plan.tickets };
  });
}

/** Stripe said a definite no: the intent is closed as failed, and nothing else changes. */
export async function failRefund(intentId: number, why: string): Promise<void> {
  await inTransaction(async (client) => {
    const r = await client.query(
      `UPDATE event_ticket_refunds SET status = 'failed', completed_at = now(), note = COALESCE(note || ' ', '') || $2 WHERE id = $1 AND status = 'pending' RETURNING order_id, refunded_by`,
      [intentId, `(Stripe refused: ${why.slice(0, 200)})`],
    );
    const row = (r.rows as Row[])[0];
    if (row) await insertAudit(client, { actor: String(row.refunded_by), action: "tickets.refund_failed", entity: "event_ticket_order", entityId: num(row.order_id), data: { intentId, why } });
  });
}

// --- emails that did not go, and phone numbers past their time (the daily task) -----------------------------

/** Staff sent the tickets email again: who and when, for the record. */
export async function auditEmailResent(orderId: number, actor: string, sent: boolean): Promise<void> {
  await inTransaction((client) => insertAudit(client, { actor, action: "tickets.email_resent", entity: "event_ticket_order", entityId: orderId, data: { sent } }));
}

/** After this many tries by the daily task a tickets email is left alone, and flagged for staff. */
export const EMAIL_ATTEMPTS_MAX = 3;

/**
 * Paid orders whose tickets email never went (the provider was down when the webhook landed), claimed
 * so two runs never send the same one together: paid (or booked free) a quarter of an hour ago or
 * more, with tickets still to show for it (a free booking, or one not refunded in full), not claimed
 * in the last six hours, and not tried three times already (then it is flagged in the admin
 * instead: "Tickets email keeps failing: check the address"). Newest first. Each claim counts a try.
 */
export async function claimUnsentConfirmations(limit = 50): Promise<number[]> {
  const r = await pool.query(
    `UPDATE event_ticket_orders SET confirmation_claimed_at = now(), confirmation_attempts = confirmation_attempts + 1
      WHERE id IN (SELECT id FROM event_ticket_orders
                    WHERE status = 'paid' AND confirmation_sent_at IS NULL AND (total_pence = 0 OR refunded_pence < total_pence)
                      AND paid_at < now() - interval '15 minutes'
                      AND confirmation_attempts < $2
                      AND (confirmation_claimed_at IS NULL OR confirmation_claimed_at < now() - interval '6 hours')
                    ORDER BY id DESC LIMIT $1 FOR UPDATE SKIP LOCKED)
      RETURNING id`,
    [limit, EMAIL_ATTEMPTS_MAX],
  );
  return (r.rows as Row[]).map((x) => num(x.id)).sort((a, b) => b - a);
}

/** A buyer's phone number is only for reaching them about the event: gone 90 days after it. */
export async function deleteOldBuyerPhones(): Promise<number> {
  const r = await pool.query(
    `UPDATE event_ticket_orders o SET buyer_phone = NULL, phone_deleted_at = now()
       FROM fundraisers f
      WHERE f.id = o.fundraiser_id AND o.buyer_phone IS NOT NULL AND f.event_date IS NOT NULL AND f.event_date < current_date - 90`,
  );
  return r.rowCount ?? 0;
}

/** Has this event ever taken a ticket order? Then it can never be shared with another cause. */
export async function hasTicketOrders(db: Querier, fundraiserId: number): Promise<boolean> {
  const r = await db.query(`SELECT 1 FROM event_ticket_orders WHERE fundraiser_id = $1 AND status IN ('pending', 'paid') LIMIT 1`, [fundraiserId]);
  return Boolean(r.rowCount);
}

// --- the admin's list --------------------------------------------------------------------------------------------

export interface TicketedEventSummary {
  id: number;
  title: string;
  slug: string;
  status: string;
  eventDate: string | null;
  proposedTypes: number;
  proposedLimit: boolean;
  sold: number;
  ticketPence: number;
  openRequests: number;
  salesClosed: boolean;
}

/** Every event selling tickets through NBCC (or that has sold some), soonest first. */
export async function listTicketedEvents(): Promise<TicketedEventSummary[]> {
  const r = await pool.query(
    `SELECT f.id, f.title, f.slug, f.status, to_char(f.event_date, 'YYYY-MM-DD') AS event_date,
            (SELECT COUNT(*) FROM event_ticket_types t WHERE t.fundraiser_id = f.id AND t.status = 'proposed') AS proposed_types,
            (SELECT proposed_sales_limit IS NOT NULL FROM event_ticket_settings s WHERE s.fundraiser_id = f.id) AS proposed_limit,
            (SELECT sales_closed_at IS NOT NULL FROM event_ticket_settings s WHERE s.fundraiser_id = f.id) AS sales_closed,
            (SELECT COALESCE(SUM(l.quantity - l.refunded_quantity), 0) FROM event_ticket_order_lines l
               JOIN event_ticket_orders o ON o.id = l.order_id WHERE o.fundraiser_id = f.id AND o.status = 'paid') AS sold,
            (SELECT COALESCE(SUM(GREATEST(o.tickets_pence - o.refunded_pence, 0)), 0) FROM event_ticket_orders o
              WHERE o.fundraiser_id = f.id AND o.status = 'paid' AND o.disputed_at IS NULL) AS ticket_pence,
            (SELECT COUNT(*) FROM event_ticket_refund_requests q WHERE q.fundraiser_id = f.id AND q.status = 'open') AS open_requests
       FROM fundraisers f
      WHERE f.path = 'event'
        AND (f.booking = 'nbcc' OR EXISTS (SELECT 1 FROM event_ticket_orders o WHERE o.fundraiser_id = f.id))
      ORDER BY f.event_date NULLS LAST, f.id`,
  );
  return (r.rows as Row[]).map((x) => ({
    id: num(x.id),
    title: String(x.title),
    slug: String(x.slug),
    status: String(x.status),
    eventDate: (x.event_date as string | null) ?? null,
    proposedTypes: num(x.proposed_types),
    proposedLimit: Boolean(x.proposed_limit),
    sold: num(x.sold),
    ticketPence: num(x.ticket_pence),
    openRequests: num(x.open_requests),
    salesClosed: Boolean(x.sales_closed),
  }));
}
