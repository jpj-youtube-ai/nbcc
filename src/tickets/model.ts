import { z } from "zod";
import { grossedUpFeePence, type CardFeeRate } from "../ball/pricing";
import { csvRows } from "../ball/exports";

// Event tickets (Jaimie, points 23 and 24): NBCC sells an event's tickets for its organiser.
// Pure: no pool, no config, no clock (the time is always passed in), so every rule here is unit
// tested without a database (test/unit/event-tickets-model.test.ts). The SQL is in
// src/db/event-tickets.ts, the routes in src/routes/event-tickets.ts and admin-event-tickets.ts.
//
// The rules, in short:
//   - "NBCC sells the tickets for me" is a fourth answer to "How do people get in?" (booking
//     'nbcc'), only when ALL the ticket money comes to NBCC: never with a split to another cause;
//   - ticket types (a name, a price of £0 for a free ticket that still needs booking or from £1 to
//     £500, an optional number on sale) are proposed by the
//     organiser at sign up or in their private area, and only go on sale once staff approve them;
//   - an event may have an overall limit; a type or the event is "Sold out" when it is reached;
//   - tickets are sold only for an approved, public event while fundraising is on, and sales close
//     when it starts (at the start of its day when it has no start time) or when staff close them;
//   - ticket money is never a gift: never Gift Aid, and shown apart from gifts everywhere;
//   - a checkout holds its places for an hour (Stripe closes it at 31 minutes); a refund puts the
//     refunded places back on sale.
//
// Words people read are plain, friendly English, with no dashes.

export const TICKETS_BOOKING = "nbcc";
export const TICKET_NAME_MAX = 60;
/** The least a paid ticket costs (£1). A ticket may also be free (£0): it still needs booking. */
export const TICKET_PRICE_MIN_PENCE = 100;
const PRICE_RANGE = "the price needs to be £0 for a free ticket, or from £1 to £500.";
const isPrice = (v: unknown): v is number => v === 0 || (typeof v === "number" && Number.isInteger(v) && v >= TICKET_PRICE_MIN_PENCE && v <= 50_000);
export const TICKET_PRICE_MAX_PENCE = 50_000; // £500
export const TICKET_QUANTITY_MAX = 5000;
export const SALES_LIMIT_MAX = 5000;
export const MAX_TICKET_TYPES = 10;
export const MAX_TICKETS_PER_ORDER = 20;
/** The most FREE tickets one order may book, and the most standing free bookings one buyer may have. */
export const FREE_TICKETS_MAX = 10;
export const FREE_BOOKINGS_MAX = 2;
/** By address the cap is higher than by email: a household, a school or an office shares one address. */
export const FREE_BOOKINGS_IP_MAX = 6;
export const FREE_TICKETS_MESSAGE = `You can book up to ${FREE_TICKETS_MAX} free tickets at a time. Need more? Email events@nbcc.scot.`;
/** A pending order holds its places this long. Stripe's expired event releases them sooner. */
export const HOLD_MINUTES = 60;
/** Stripe's shortest checkout is 30 minutes from when it is made; the extra minute covers the clocks. */
export const CHECKOUT_MINUTES = 31;
/** Until Stripe's checkout is attached, an order holds its places only this long. */
export const UNATTACHED_HOLD_MINUTES = 5;
/** The most checkouts one buyer (by email, or by address) may have open for one event at once. */
export const LIVE_HOLDS_MAX = 2;
export const REFUND_REASON_MAX = 500;

// --- the words on the sign up form and the private area -------------------------------------------

export const NBCC_SELLS_LABEL = "NBCC sells the tickets for me";
export const ALL_MONEY_NOTE =
  "Choose this only if all the ticket money is going to NBCC. If you're sharing ticket money with another cause or keeping some for costs, sell them your own way and pay NBCC its share afterwards.";
export const COSTS_NOTE = "If you have costs, like the hall, talk to us: we can repay agreed costs against receipts.";
export const NBCC_TICKETS_SHARED =
  "NBCC can only sell the tickets when all the ticket money comes to NBCC. As you're sharing with another cause, please sell them your own way and pay NBCC its share afterwards.";

const TYPES_NEEDED = "Add at least one kind of ticket, like Adult at £10.";
const TOO_MANY_TYPES = `You can have up to ${MAX_TICKET_TYPES} kinds of ticket.`;
const LIMIT_RANGE = "The most tickets to sell needs to be a whole number from 1 to 5,000, or left empty for no limit.";

// --- ticket types ----------------------------------------------------------------------------------

export type TicketTypeStatus = "proposed" | "approved" | "withdrawn";

export interface TicketTypeRow {
  id: number;
  name: string;
  pricePence: number;
  /** How many of this type are on sale; null for no limit of its own. */
  quantity: number | null;
  status: TicketTypeStatus;
  position: number;
}

export interface ProposedType {
  name: string;
  pricePence: number;
  quantity: number | null;
}

const isWhole = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

/** A number as sent: a number, or digits typed in a box. Anything else stays as it was. */
function readNumber(v: unknown): unknown {
  if (typeof v === "string" && /^\s*\d+\s*$/.test(v)) return Number(v);
  return v;
}

const isBlank = (v: unknown) => v == null || (typeof v === "string" && v.trim() === "");

/**
 * The ticket types an organiser (or staff) proposes, checked: each a name (1 to 60 characters, no
 * two the same), a price in whole pence from £1 to £500, and an optional number on sale (1 to
 * 5,000). The first problem is named, with the ticket's place in the list.
 */
export function checkTicketTypes(raw: unknown, existingNames: readonly string[] = []): { types: ProposedType[]; fields: Record<string, string> } {
  if (!Array.isArray(raw) || raw.length === 0) return { types: [], fields: { ticketTypes: TYPES_NEEDED } };
  if (raw.length > MAX_TICKET_TYPES) return { types: [], fields: { ticketTypes: TOO_MANY_TYPES } };
  const types: ProposedType[] = [];
  const seen = new Map(existingNames.map((n) => [n.trim().toLowerCase(), n.trim()]));
  for (let i = 0; i < raw.length; i += 1) {
    const at = `Ticket ${i + 1}: `;
    const t = (raw[i] ?? {}) as Record<string, unknown>;
    const name = typeof t.name === "string" ? t.name.trim().replace(/\s+/g, " ") : "";
    if (!name) return { types: [], fields: { ticketTypes: `${at}give it a name, like Adult.` } };
    if (name.length > TICKET_NAME_MAX) return { types: [], fields: { ticketTypes: `${at}keep the name to ${TICKET_NAME_MAX} characters or fewer.` } };
    const price = readNumber(t.pricePence);
    if (!isPrice(price)) return { types: [], fields: { ticketTypes: `${at}${PRICE_RANGE}` } };
    const q = isBlank(t.quantity) ? null : readNumber(t.quantity);
    if (q !== null && !isWhole(q, 1, TICKET_QUANTITY_MAX)) {
      return { types: [], fields: { ticketTypes: `${at}the number on sale needs to be a whole number from 1 to 5,000, or left empty.` } };
    }
    const key = name.toLowerCase();
    if (seen.has(key)) return { types: [], fields: { ticketTypes: `${at}you already have a ticket called ${seen.get(key)}.` } };
    seen.set(key, name);
    types.push({ name, pricePence: price, quantity: q as number | null });
  }
  return { types, fields: {} };
}

/** An overall limit as sent: null when left empty, a whole number from 1 to 5,000, or "bad". */
export function readSalesLimit(v: unknown): number | null | "bad" {
  if (isBlank(v)) return null;
  const n = readNumber(v);
  return isWhole(n, 1, SALES_LIMIT_MAX) ? n : "bad";
}

// --- when sales close (the host chooses; staff approve it with the tickets) ----------------------------

export const CLOSE_MODES = ["start", "day_before", "custom"] as const;
export type CloseMode = (typeof CLOSE_MODES)[number];
export const CLOSE_LABELS: Record<CloseMode, string> = {
  start: "When the event starts",
  day_before: "The day before (midnight)",
  custom: "A date and time I choose",
};

export interface CloseChoice {
  mode: CloseMode;
  /** For "custom": the moment sales close, as an ISO instant; null otherwise. */
  at: string | null;
}

/** "2026-12-03T18:00" on a clock in London, as the moment it is ("2026-12-03T18:00:00.000Z"); null if it is not one. */
export function londonToInstant(local: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d)/.exec(String(local ?? "").trim());
  if (!m) return null;
  const asUtc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  if (Number.isNaN(asUtc)) return null;
  const want = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}`;
  // London is on UTC or an hour ahead: try both, and take the one whose London clock reads as asked.
  for (const offset of [0, 60]) {
    const t = new Date(asUtc - offset * 60_000);
    if (londonMinute(t) === want) return t.toISOString();
  }
  // A time in the hour the clocks skip in spring (01:00 to 01:59 never happens that night): the first
  // minute that does exist after it, 02:00 summer time, which is the top of that hour in UTC.
  return new Date(Math.floor(asUtc / 3_600_000) * 3_600_000).toISOString();
}

/**
 * The host's answer to "When should ticket sales close?": when the event starts (also when it was
 * never asked), midnight the day before, or a date and time they choose (London time), which must
 * be before the event starts.
 */
export function checkCloseChoice(
  body: { ticketClose?: unknown; ticketCloseAt?: unknown },
  e: { eventDate?: string | null; startTime?: string | null },
  /** The time now, when the choice is being made: a chosen time must not have passed already. */
  now?: Date,
): { close: CloseChoice } | { error: string } {
  const mode = isBlank(body.ticketClose) ? "start" : body.ticketClose;
  if (mode === "start" || mode === "day_before") return { close: { mode, at: null } };
  if (mode !== "custom") return { error: "Choose when ticket sales should close." };
  const at = typeof body.ticketCloseAt === "string" ? londonToInstant(body.ticketCloseAt) : null;
  if (!at) return { error: "Choose the date and time ticket sales should close." };
  if (now && new Date(at).getTime() <= now.getTime()) return { error: "Choose a time that hasn't passed yet." };
  if (e.eventDate) {
    const start = londonToInstant(`${String(e.eventDate).slice(0, 10)}T${e.startTime ? String(e.startTime).slice(0, 5) : "00:00"}`);
    if (start && at >= start) return { error: "Ticket sales need to close before the event starts." };
  }
  return { close: { mode: "custom", at } };
}

const CLOSE_WHEN = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "long", day: "numeric", month: "long", year: "numeric" });
const CLOSE_TIME = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "numeric", minute: "2-digit", hourCycle: "h23" });

/** When sales close, in words for the page and the private area. */
export function closeWords(c: { mode?: string | null; at?: string | null } | null | undefined): string {
  if (c?.mode === "day_before") return "Sales close at midnight the day before.";
  if (c?.mode === "custom" && c.at) {
    const d = new Date(c.at);
    const [h, min] = CLOSE_TIME.format(d).split(":").map(Number);
    const time = h === 12 && min === 0 ? "12 noon" : h === 0 && min === 0 ? "midnight" : `${h % 12 || 12}${min ? `.${String(min).padStart(2, "0")}` : ""}${h >= 12 ? "pm" : "am"}`;
    return `Sales close on ${CLOSE_WHEN.format(d).replace(",", "")} at ${time}.`;
  }
  return "Sales close when the event starts.";
}

export interface TicketPlan {
  types: ProposedType[];
  salesLimit: number | null;
  close: CloseChoice;
}

/**
 * The sign up's tickets, beside the rest of the form (like the team pages' checkTeamSignUp). Only
 * an event where NBCC sells the tickets has any; for anything else what was sent is ignored. Never
 * with a split to another cause: all the ticket money must come to NBCC.
 */
export function checkTicketSignUp(body: unknown): { fields: Record<string, string>; plan: TicketPlan | null } {
  const b = (body ?? {}) as Record<string, unknown>;
  if (b.path !== "event" || b.booking !== TICKETS_BOOKING) return { fields: {}, plan: null };
  const fields: Record<string, string> = {};
  if (b.sharesWithOther === true) fields.booking = NBCC_TICKETS_SHARED;
  const checked = checkTicketTypes(b.ticketTypes);
  Object.assign(fields, checked.fields);
  const limit = readSalesLimit(b.ticketLimit);
  if (limit === "bad") fields.ticketLimit = LIMIT_RANGE;
  const close = checkCloseChoice(b, { eventDate: typeof b.eventDate === "string" ? b.eventDate : null, startTime: typeof b.startTime === "string" ? b.startTime : null });
  if ("error" in close) fields.ticketClose = close.error;
  if (Object.keys(fields).length > 0 || "error" in close) return { fields, plan: null };
  return { fields, plan: { types: checked.types, salesLimit: limit as number | null, close: close.close } };
}

/** An organiser's proposal from the private area: new types, a new limit, or both. */
export function checkTicketProposal(
  body: unknown,
  existingNames: readonly string[],
  e: { eventDate?: string | null; startTime?: string | null } = {},
  now?: Date,
): { fields: Record<string, string>; types: ProposedType[]; salesLimit: number | null | undefined; close: CloseChoice | undefined } {
  const b = (body ?? {}) as Record<string, unknown>;
  const fields: Record<string, string> = {};
  const wantsTypes = Array.isArray(b.ticketTypes) && b.ticketTypes.length > 0;
  const wantsLimit = Object.prototype.hasOwnProperty.call(b, "ticketLimit");
  const wantsClose = Object.prototype.hasOwnProperty.call(b, "ticketClose");
  let close: CloseChoice | undefined;
  if (wantsClose) {
    const c = checkCloseChoice(b, e, now);
    if ("error" in c) fields.ticketClose = c.error;
    else close = c.close;
  }
  if (!wantsTypes && !wantsLimit && !wantsClose) return { fields: { ticketTypes: TYPES_NEEDED }, types: [], salesLimit: undefined, close: undefined };
  const checked = wantsTypes ? checkTicketTypes(b.ticketTypes, existingNames) : { types: [], fields: {} };
  Object.assign(fields, checked.fields);
  const limit = wantsLimit ? readSalesLimit(b.ticketLimit) : undefined;
  if (limit === "bad") fields.ticketLimit = LIMIT_RANGE;
  return { fields, types: checked.types, salesLimit: limit === "bad" ? undefined : limit, close };
}

/** A staff change to one type: any of the name, price and number on sale. */
export const typeEditSchema = z
  .object({
    name: z.string().trim().min(1, "Give it a name.").max(TICKET_NAME_MAX, `Keep the name to ${TICKET_NAME_MAX} characters or fewer.`).optional(),
    pricePence: z
      .number()
      .refine(isPrice, "The price needs to be £0 for a free ticket, or from £1 to £500.")
      .optional(),
    quantity: z
      .number()
      .int("The number on sale needs to be a whole number from 1 to 5,000, or left empty.")
      .min(1, "The number on sale needs to be a whole number from 1 to 5,000, or left empty.")
      .max(TICKET_QUANTITY_MAX, "The number on sale needs to be a whole number from 1 to 5,000, or left empty.")
      .nullable()
      .optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: "There is nothing to change." });

// --- what is left to sell --------------------------------------------------------------------------

export interface TypeAvailability {
  id: number;
  name: string;
  pricePence: number;
  /** How many more can be bought; null when neither the type nor the event has a limit. */
  remaining: number | null;
  soldOut: boolean;
}

export interface Availability {
  types: TypeAvailability[];
  /** Places left for the whole event; null with no overall limit. */
  overallRemaining: number | null;
  /** Every type on sale is sold out, or the event's limit is reached. */
  soldOut: boolean;
  /** At least one approved type. */
  onSale: boolean;
}

/**
 * What is left, from the types, the overall limit and the places taken per type (sold, or held by a
 * checkout still open). Only approved types are offered; a withdrawn type's places still count
 * towards the overall limit. Never negative, whatever the counts say.
 */
export function availability(input: { types: TicketTypeRow[]; salesLimit: number | null; taken: Record<number, number> }): Availability {
  const taken = (id: number) => Math.max(0, input.taken[id] ?? 0);
  const totalTaken = Object.values(input.taken).reduce((n, v) => n + Math.max(0, v), 0);
  const overallRemaining = input.salesLimit === null ? null : Math.max(0, input.salesLimit - totalTaken);
  const types = input.types
    .filter((t) => t.status === "approved")
    .sort((a, b) => a.position - b.position || a.id - b.id)
    .map((t) => {
      const own = t.quantity === null ? null : Math.max(0, t.quantity - taken(t.id));
      const remaining = own === null ? overallRemaining : overallRemaining === null ? own : Math.min(own, overallRemaining);
      return { id: t.id, name: t.name, pricePence: t.pricePence, remaining, soldOut: remaining === 0 };
    });
  const onSale = types.length > 0;
  return { types, overallRemaining, soldOut: onSale && (overallRemaining === 0 || types.every((t) => t.soldOut)), onSale };
}

export interface OrderLineIn {
  typeId: number;
  quantity: number;
  /** The price the buyer's page showed, in pence: the order is refused if it has changed since. */
  pricePence?: number;
}

export const PRICE_CHANGED = "The price of this ticket has changed. Please refresh the page.";

const ticketWord = (n: number) => (n === 1 ? "ticket" : "tickets");

/** Can this order be met from what is left? Null when it can; otherwise what to tell the buyer. */
export function checkOrder(lines: OrderLineIn[], a: Availability): string | null {
  const ids = new Set(lines.map((l) => l.typeId));
  if (lines.length === 0 || ids.size !== lines.length || lines.some((l) => !Number.isInteger(l.quantity) || l.quantity < 1)) {
    return "Choose how many tickets you would like.";
  }
  if (a.soldOut) return "Sorry, these tickets have sold out.";
  const count = lines.reduce((n, l) => n + l.quantity, 0);
  if (count > MAX_TICKETS_PER_ORDER) return `You can buy up to ${MAX_TICKETS_PER_ORDER} tickets at a time.`;
  let freeCount = 0;
  for (const l of lines) {
    const t = a.types.find((x) => x.id === l.typeId);
    if (!t) return "That ticket is no longer on sale. Please refresh the page.";
    if (t.pricePence === 0) freeCount += l.quantity;
    if (l.pricePence !== undefined && l.pricePence !== t.pricePence) return PRICE_CHANGED;
    if (t.remaining !== null && l.quantity > t.remaining) {
      return t.remaining === 0 ? `Sorry, the ${t.name} tickets have sold out.` : `Sorry, there ${t.remaining === 1 ? "is" : "are"} only ${t.remaining} ${t.name} ${ticketWord(t.remaining)} left.`;
    }
  }
  // Free tickets cost nothing to take, so one order may only take so many.
  if (freeCount > FREE_TICKETS_MAX) return FREE_TICKETS_MESSAGE;
  if (a.overallRemaining !== null && count > a.overallRemaining) {
    return `Sorry, there ${a.overallRemaining === 1 ? "is" : "are"} only ${a.overallRemaining} ${ticketWord(a.overallRemaining)} left.`;
  }
  return null;
}

// --- the money ---------------------------------------------------------------------------------------

export interface OrderMoney {
  ticketsPence: number;
  feeCoverPence: number;
  totalPence: number;
}

/**
 * The single place an order's money is decided, so the page, the Stripe session and the stored order
 * can never disagree. The card fee cover is grossed up on the tickets, as the Festive Ball's is
 * (src/ball/pricing.ts), so NBCC nets the full ticket money when it is ticked.
 */
export function orderMoney(lines: Array<{ unitPence: number; quantity: number }>, coverFee: boolean, rate: CardFeeRate): OrderMoney {
  const ticketsPence = lines.reduce((n, l) => n + l.unitPence * l.quantity, 0);
  const feeCoverPence = coverFee ? grossedUpFeePence(ticketsPence, rate) : 0;
  return { ticketsPence, feeCoverPence, totalPence: ticketsPence + feeCoverPence };
}

/** Nothing to pay: every ticket on it is free. It is booked at once and never goes to Stripe. */
export function isFreeOrder(m: Pick<OrderMoney, "totalPence">): boolean {
  return m.totalPence === 0;
}

// --- the checkout form ---------------------------------------------------------------------------------

const blankable = (v: unknown) => (v == null ? "" : typeof v === "string" ? v.trim() : v);

export const checkoutSchema = z.object({
  lines: z
    .array(z.object({ typeId: z.number().int().positive(), quantity: z.number().int().min(0).max(MAX_TICKETS_PER_ORDER), pricePence: z.number().int().min(0) }), {
      errorMap: () => ({ message: "Choose how many tickets you would like." }),
    })
    .max(MAX_TICKET_TYPES)
    .transform((list) => list.filter((l) => l.quantity > 0)),
  firstName: z.preprocess(blankable, z.string().min(1, "Please tell us your first name.").max(50, "Keep your first name to 50 characters or fewer.")),
  lastName: z.preprocess(blankable, z.string().min(1, "Please tell us your surname.").max(50, "Keep your surname to 50 characters or fewer.")),
  email: z.preprocess(blankable, z.string().email("Please check your email address.").max(254)),
  phone: z
    .preprocess(
      blankable,
      z.union([
        z.literal(""),
        z
          .string()
          .max(20, "That phone number is too long.")
          .refine((v) => /^[+0-9 ()-]+$/.test(v) && v.replace(/\D/g, "").length >= 7, "That does not look like a phone number."),
      ]),
    )
    .transform((v) => (v === "" ? null : v)),
  coverFee: z.boolean().default(false),
  /** The spam check's token (Turnstile), when the check is on. */
  captchaToken: z.string().max(4096).optional(),
});

export type CheckoutBody = z.infer<typeof checkoutSchema>;

// --- when sales are open -----------------------------------------------------------------------------

export type SalesState = "open" | "soon" | "sold_out" | "closed" | "started" | "finished" | "off";

export interface SalesEvent {
  status: string;
  public: boolean;
  path: string;
  booking: string | null;
  inMemory?: boolean | null;
  /** Shares what it raises with another cause: NBCC never sells its tickets. */
  sharesWithOther?: boolean | null;
  salesClosedAt: string | null;
  eventDate: string | null;
  startTime: string | null;
  /** When sales close, as the host chose and staff approved: null (never asked) is when it starts. */
  salesCloseMode?: string | null;
  salesCloseAt?: string | null;
}

const LONDON = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** The minute it is in London, "2026-12-05T19:30", to compare with an event's date and time. */
export function londonMinute(now: Date): string {
  const p = Object.fromEntries(LONDON.formatToParts(now).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** Has the event started? At its start time in London, or the start of its day with no time. */
export function hasStarted(eventDate: string, startTime: string | null, now: Date): boolean {
  const start = `${eventDate.slice(0, 10)}T${startTime ? startTime.slice(0, 5) : "00:00"}`;
  return londonMinute(now) >= start;
}

/**
 * Where an event's ticket sales are up to. Off unless it is an approved (or finished), public event
 * selling through NBCC while fundraising is on, never in memory of someone; then finished, closed by
 * staff, started, waiting for staff to approve a ticket, sold out, or open.
 */
export function salesState(e: SalesEvent, ctx: { fundraisingOn: boolean; now: Date; onSale: boolean; soldOut: boolean }): SalesState {
  if (!ctx.fundraisingOn || e.path !== "event" || e.booking !== TICKETS_BOOKING || e.inMemory || !e.public || !e.eventDate) return "off";
  // The one place every path meets: all the ticket money must come to NBCC, so never when sharing.
  if (e.sharesWithOther === true) return "off";
  if (e.status === "finished") return "finished";
  if (e.status !== "approved") return "off";
  if (e.salesClosedAt) return "closed";
  if (hasStarted(e.eventDate, e.startTime, ctx.now)) return "started";
  // The host's own closing time: midnight the day before, or a moment they chose. Never after the start.
  if (e.salesCloseMode === "day_before" && hasStarted(e.eventDate, null, ctx.now)) return "closed";
  if (e.salesCloseMode === "custom" && e.salesCloseAt && ctx.now.getTime() >= new Date(e.salesCloseAt).getTime()) return "closed";
  if (!ctx.onSale) return "soon";
  if (ctx.soldOut) return "sold_out";
  return "open";
}

// --- references --------------------------------------------------------------------------------------

// As the ball's: no O/0, I/1 or L, so a reference read down the phone or at the door is never misread.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** "TIX-7K3QPA". Pure: the caller passes the random bytes (crypto.randomBytes). */
export function makeTicketReference(bytes: Buffer): string {
  let out = "";
  for (let i = 0; i < 6; i += 1) out += ALPHABET[bytes[i % bytes.length] % ALPHABET.length];
  return `TIX-${out}`;
}

// --- orders, as staff and the organiser see them -------------------------------------------------------

export interface OrderLine {
  id: number;
  /** The ticket type it was sold as. */
  typeId?: number;
  typeName: string;
  unitPence: number;
  quantity: number;
  refundedQuantity: number;
}

export interface OrderForList {
  id: number;
  reference: string;
  status: "pending" | "paid" | "expired" | "cancelled";
  firstName: string;
  surname: string;
  email: string;
  phone: string | null;
  ticketsPence: number;
  feeCoverPence: number;
  totalPence: number;
  refundedPence: number;
  paidAt: string | null;
  lines: OrderLine[];
  /** What staff are told about it (flagWords): paid late, a wrong amount, a dispute. */
  flags?: OrderFlags | null;
  /** The bank has taken the money back while a dispute is open: not counted as ticket money. */
  disputed?: boolean;
  /** The buyer's tickets email went (null or false: it did not, and staff can send it again). */
  emailSent?: boolean;
  /** The daily task has tried the tickets email three times and it still will not go. */
  emailFailing?: boolean;
}

export interface OrderFlags {
  /**
   * A refund Stripe accepted later failed at the bank: the money did not go back. `released`: tickets
   * had been put back on sale for it (they are NOT taken back). `overBy`: how far over its limit the
   * event is if the buyer, who has not been paid back, still comes.
   */
  refundFailed?: boolean | { released: boolean; overBy: number };
  paidLate?: { was?: string; overBy: number };
  amountMismatch?: { expected: number; paid: number };
  sessionMismatch?: boolean;
  currencyMismatch?: string;
  disputed?: boolean;
}

/** A refund that failed at the bank, in words for staff: what happened, and what to do about it. */
export function refundFailedWords(f: boolean | { released: boolean; overBy: number }): string {
  const start = "Refund failed at the bank: the buyer has not been paid back.";
  if (typeof f !== "object" || !f.released) return `${start} Refund again.`;
  const over = f.overBy > 0 ? ` Counting their tickets, this event is now ${f.overBy} over its limit.` : "";
  return `${start} Their tickets were released: contact them and refund them in Stripe.${over}`;
}

/** A booking's flags, in words for staff. A late payment is only a worry when it took the event over. */
export function flagWords(flags: OrderFlags | null | undefined): string[] {
  if (!flags) return [];
  const out: string[] = [];
  if (flags.paidLate && flags.paidLate.overBy > 0) out.push(`Paid late: this event is now ${flags.paidLate.overBy} over its limit`);
  if (flags.amountMismatch) out.push("Amount paid doesn't match: check this booking");
  if (flags.sessionMismatch) out.push("Paid on a different checkout: check this booking");
  if (flags.currencyMismatch) out.push("Not paid in pounds: check this booking");
  if (flags.disputed) out.push("Disputed with the bank: this money is not counted");
  if (flags.refundFailed) out.push(refundFailedWords(flags.refundFailed));
  return out;
}

/**
 * The ticket money an event has raised: each paid order's tickets, less what was refunded on it.
 * The card fee cover is never counted (it pays the card fee), and a refund comes off the tickets
 * first, so an order refunded in full counts nothing.
 */
export function ticketMoneyPence(orders: Array<Pick<OrderForList, "status" | "ticketsPence" | "refundedPence" | "disputed">>): number {
  return orders.filter((o) => o.status === "paid" && !o.disputed).reduce((n, o) => n + Math.max(0, o.ticketsPence - Math.max(0, o.refundedPence)), 0);
}

/** £60, £25.50, £1,234.56. */
export function pounds(pence: number): string {
  const p = Math.max(0, Math.round(pence));
  const rest = p % 100;
  return `£${Math.floor(p / 100).toLocaleString("en-GB")}${rest ? `.${String(rest).padStart(2, "0")}` : ""}`;
}

/** "£40 from tickets, £25 in gifts": ticket money and gifts, always apart, and the two together. */
export function moneySplit(ticketsPence: number, giftsPence: number): { ticketsPence: number; giftsPence: number; totalPence: number; words: string } {
  const t = Math.max(0, ticketsPence);
  const g = Math.max(0, giftsPence);
  return { ticketsPence: t, giftsPence: g, totalPence: t + g, words: `${pounds(t)} from tickets, ${pounds(g)} in gifts` };
}

const left = (l: OrderLine) => Math.max(0, l.quantity - l.refundedQuantity);

/** "2 Adult, 1 Child": the tickets still standing on an order. */
export function ticketsWords(lines: OrderLine[]): string {
  return lines
    .filter((l) => left(l) > 0)
    .map((l) => `${left(l)} ${l.typeName}`)
    .join(", ");
}

export type RefundPlan = { ok: true; amountPence: number; lines: Array<{ lineId: number; quantity: number }>; full: boolean } | { ok: false; error: string };

/**
 * What a refund of these tickets comes to: their price as sold. When it leaves no ticket standing,
 * it is the rest of what was paid, card fee cover and all. Never more than is left of the payment
 * (money may have been refunded in Stripe by hand), never a ticket already refunded.
 */
export function refundPlan(o: Pick<OrderForList, "status" | "totalPence" | "refundedPence" | "lines">, wanted: Array<{ lineId: number; quantity: number }>): RefundPlan {
  if (o.status !== "paid") return { ok: false, error: "Only a paid booking can be refunded." };
  if (o.totalPence === 0) return { ok: false, error: "A free booking has no money to refund. Cancel the booking instead." };
  const leftToRefund = o.totalPence - o.refundedPence;
  if (leftToRefund <= 0) return { ok: false, error: "This booking has been refunded in full already." };
  const chosen = wanted.filter((w) => w.quantity > 0);
  if (chosen.length === 0 || new Set(chosen.map((w) => w.lineId)).size !== chosen.length) return { ok: false, error: "Choose which tickets to refund." };
  let sum = 0;
  for (const w of chosen) {
    const line = o.lines.find((l) => l.id === w.lineId);
    if (!line) return { ok: false, error: "That ticket is not on this booking." };
    if (!Number.isInteger(w.quantity) || w.quantity > left(line)) {
      const n = left(line);
      return { ok: false, error: `Only ${n} ${line.typeName} ${ticketWord(n)} ${n === 1 ? "is" : "are"} left to refund on this booking.` };
    }
    sum += w.quantity * line.unitPence;
  }
  const standing = o.lines.reduce((n, l) => n + left(l), 0) - chosen.reduce((n, w) => n + w.quantity, 0);
  const full = standing === 0;
  const amountPence = full ? leftToRefund : Math.min(sum, leftToRefund);
  if (amountPence <= 0) return { ok: false, error: "Those tickets were free, so there is nothing to refund. Choose a paid ticket, or the whole booking." };
  return { ok: true, amountPence, lines: chosen.map((w) => ({ lineId: w.lineId, quantity: w.quantity })), full };
}

export type ReleasePlan = { ok: true; lines: Array<{ lineId: number; quantity: number }>; tickets: string } | { ok: false; error: string };

/**
 * Releasing tickets with no money moving (an admin): the places go back on sale and the buyer is
 * told those tickets are cancelled. For free tickets on a paid booking, and for paid tickets whose
 * money was already refunded outside the admin (in Stripe itself): only as many as that money covers
 * beyond the tickets already released. Anything else is refunded first.
 */
export function releasePlan(o: Pick<OrderForList, "status" | "refundedPence" | "lines">, wanted: Array<{ lineId: number; quantity: number }>): ReleasePlan {
  if (o.status !== "paid") return { ok: false, error: "Only a paid booking has tickets to release." };
  const chosen = wanted.filter((w) => w.quantity > 0);
  if (chosen.length === 0 || new Set(chosen.map((w) => w.lineId)).size !== chosen.length) return { ok: false, error: "Choose which tickets to release." };
  // The money refunded that no released ticket yet accounts for.
  let uncovered = o.refundedPence - o.lines.reduce((n, l) => n + l.refundedQuantity * l.unitPence, 0);
  const words: string[] = [];
  for (const w of chosen) {
    const line = o.lines.find((l) => l.id === w.lineId);
    if (!line) return { ok: false, error: "That ticket is not on this booking." };
    const n = left(line);
    if (!Number.isInteger(w.quantity) || w.quantity > n) return { ok: false, error: `Only ${n} ${line.typeName} ${ticketWord(n)} ${n === 1 ? "is" : "are"} left on this booking.` };
    const value = w.quantity * line.unitPence;
    if (value > uncovered && value > 0) return { ok: false, error: "Refund the money for those tickets first: nothing has been refunded for them." };
    uncovered -= value;
    words.push(`${w.quantity} ${line.typeName}`);
  }
  return { ok: true, lines: chosen.map((w) => ({ lineId: w.lineId, quantity: w.quantity })), tickets: words.join(", ") };
}

export const BOOKING_CHANGED = "This booking has changed. Refresh and check before refunding.";

/**
 * Is the booking no longer as the admin saw it? They send, with the tickets chosen, how many of each
 * line were already refunded and how much money: any difference (another admin, a refund made in
 * Stripe, the same click twice) and nothing is refunded until they have looked again.
 */
export function refundIsStale(
  o: Pick<OrderForList, "refundedPence" | "lines">,
  wanted: Array<{ lineId: number; refundedQuantity: number }>,
  refundedPence: number,
): boolean {
  if (o.refundedPence !== refundedPence) return true;
  return wanted.some((w) => {
    const line = o.lines.find((l) => l.id === w.lineId);
    return !!line && line.refundedQuantity !== w.refundedQuantity;
  });
}

// --- the guest list and the CSV -------------------------------------------------------------------------

export interface GuestRow {
  name: string;
  reference: string;
  tickets: string;
  count: number;
}

/**
 * The door list: every paid booking with a ticket still standing, by surname then first name, with
 * what it has, and the totals for each type. Names, tickets and references only: no email, phone or
 * money, as the organiser prints it too.
 */
export function guestList(orders: OrderForList[]): { rows: GuestRow[]; totalTickets: number; byType: Array<{ name: string; count: number }> } {
  const standing = orders.filter((o) => o.status === "paid" && o.lines.some((l) => left(l) > 0));
  const byName = (a: OrderForList, b: OrderForList) =>
    a.surname.localeCompare(b.surname, "en-GB", { sensitivity: "base" }) ||
    a.firstName.localeCompare(b.firstName, "en-GB", { sensitivity: "base" }) ||
    a.reference.localeCompare(b.reference);
  const rows = [...standing].sort(byName).map((o) => ({
    name: `${o.firstName} ${o.surname}`.trim(),
    reference: o.reference,
    tickets: ticketsWords(o.lines),
    count: o.lines.reduce((n, l) => n + left(l), 0),
  }));
  const types = new Map<string, number>();
  for (const o of standing) for (const l of o.lines) if (left(l) > 0) types.set(l.typeName, (types.get(l.typeName) ?? 0) + left(l));
  return {
    rows,
    totalTickets: rows.reduce((n, r) => n + r.count, 0),
    byType: [...types.entries()].map(([name, count]) => ({ name, count })),
  };
}

const twoPlaces = (pence: number) => (pence / 100).toFixed(2);

const LONDON_DATE = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Every order for staff, newest first as given: the buyer's details and the money. A formula is defused. */
export function ticketsCsv(orders: OrderForList[], opts: { contact?: boolean } = {}): string {
  const contact = opts.contact !== false;
  const keep = <T>(row: T[]): T[] => (contact ? row : row.filter((_, i) => i !== 5 && i !== 6));
  const head = [
    "Reference",
    "Status",
    "Paid",
    "First name",
    "Surname",
    "Email",
    "Phone",
    "Tickets",
    "Number of tickets",
    "Tickets £",
    "Card fee cover £",
    "Total £",
    "Refunded £",
  ];
  const rows = orders.map((o) => [
    o.reference,
    o.status === "paid" && o.refundedPence >= o.totalPence ? "refunded" : o.status,
    o.paidAt ? LONDON_DATE.format(new Date(o.paidAt)) : "",
    o.firstName,
    o.surname,
    o.email,
    o.phone ?? "",
    ticketsWords(o.lines),
    o.lines.reduce((n, l) => n + left(l), 0),
    twoPlaces(o.ticketsPence),
    twoPlaces(o.feeCoverPence),
    twoPlaces(o.totalPence),
    twoPlaces(o.refundedPence),
  ]);
  return csvRows([keep(head), ...rows.map(keep)]);
}

// --- refunds -------------------------------------------------------------------------------------------

/** An organiser asking for a refund: which booking, and why. */
export const refundRequestSchema = z.object({
  orderId: z.number().int().positive({ message: "Choose the booking to refund." }),
  reason: z.preprocess(
    blankable,
    z.string().min(1, "Tell us why, in a few words.").max(REFUND_REASON_MAX, `Keep this to ${REFUND_REASON_MAX} characters or fewer.`),
  ),
});

/** An admin making a refund: which tickets, from which request if any, and a note for the record. */
export const adminRefundSchema = z.object({
  lines: z
    .array(
      z.object({
        lineId: z.number().int().positive(),
        quantity: z.number().int().min(0).max(MAX_TICKETS_PER_ORDER),
        // How many of this line were already refunded when the admin looked (refundIsStale).
        refundedQuantity: z.number().int().min(0).max(MAX_TICKETS_PER_ORDER),
      }),
    )
    .min(1)
    .max(MAX_TICKET_TYPES),
  /** How much of the booking was already refunded when the admin looked. */
  refundedPence: z.number().int().min(0),
  requestId: z.number().int().positive().nullable().optional(),
  note: z.preprocess(blankable, z.string().max(REFUND_REASON_MAX)).optional(),
});
