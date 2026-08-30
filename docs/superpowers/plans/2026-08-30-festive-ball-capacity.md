# Festive Ball — Plan 1: capacity engine and data model

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure capacity/pricing engine and the database tables that every other part of the Festive Ball feature depends on, so seats and tables can never be oversold.

**Architecture:** Pure, DB-free logic in `src/ball/` (Zod-validated, unit-tested without a database, mirroring `src/ticker/model.ts` and `src/benefits/caps.ts`). The transactional read/write layer lives in `src/db/ball.ts` and is exercised through Cucumber. One additive migration creates three tables. No HTTP surface beyond a single public read endpoint in this plan.

**Tech Stack:** TypeScript, Express, Postgres (node-pg-migrate), Zod, Vitest, Cucumber.

---

## Scope note: this is plan 1 of 5

The approved build spec covers several independent subsystems. Splitting them keeps each plan shippable on its own:

| Plan | Covers | Ships |
|---|---|---|
| **1 (this one)** | Capacity engine, pricing, DB tables, public availability endpoint | Foundation |
| 2 | Purchase flow + Stripe checkout + webhook → confirmed booking | Friday |
| 3 | `/ball` page, password gate, terms page, home-page promotion | Friday |
| 4 | Confirmation email + admin section (settings, dashboard, bookings) | Friday |
| 5 | Guest details, dietary/access, exports, reminders, waiting list | After Friday |

Plans 2–4 depend on this one. Plan 5 depends on 2.

---

## The capacity rules being encoded

Agreed with the client:

- **40 tables × 10 seats = 400 seats.** Both numbers are editable in admin later.
- A **table purchase** takes one whole, unbroken table (10 seats).
- **Individual seats are pooled** onto shared tables.
- **Sell down to the last individual seat** — a shared table may go out with 7 people on it.
- **Held-back seats** (comps, sponsor guests) never go on sale and sit in the shared pool.
- Order caps: **max 9 seats or 4 tables** per order; more requires a phone call.
- Price: **£100 per seat, £1,000 per table.** No discount. Stored in pence.

The subtle rule: whole tables can only be sold from tables not already broken into by loose or held seats. With 365 seats free you may still have fewer than 36 whole tables available, because pooled seats consume partial tables.

---

## File structure

| File | Responsibility |
|---|---|
| `src/ball/capacity.ts` (create) | Pure availability arithmetic. No DB, no clock, no config. |
| `src/ball/pricing.ts` (create) | Pure money arithmetic in pence: line totals, Stripe fee cover. |
| `migrations/1786100000000_festive-ball.js` (create) | `ball_settings`, `ball_bookings`, `ball_reservations`. Additive only. |
| `src/db/ball.ts` (create) | Settings read/write, availability snapshot, reservation claim/release. |
| `src/routes/ball.ts` (create) | `GET /api/ball/availability` — public, read-only. |
| `src/app.ts` (modify) | Mount `ballRouter` before the site catch-all. |
| `test/unit/ball-capacity.test.ts` (create) | Unit tests for capacity. |
| `test/unit/ball-pricing.test.ts` (create) | Unit tests for pricing. |
| `features/ball-availability.feature` (create) | BDD for the public endpoint. |
| `features/steps/ball.steps.js` (create) | Step definitions. |

---

## Task 1: The pure capacity model

**Files:**
- Create: `src/ball/capacity.ts`
- Test: `test/unit/ball-capacity.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/unit/ball-capacity.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  availability,
  canFulfil,
  SEATS_PER_TABLE,
  type CapacityState,
} from "../../src/ball/capacity";

const base: CapacityState = {
  totalTables: 40,
  seatsPerTable: 10,
  heldSeats: 0,
  tablesSold: 0,
  looseSeatsSold: 0,
  reservedSeats: 0,
};

describe("availability", () => {
  it("an untouched ball offers every seat and every table", () => {
    const a = availability(base);
    expect(a.totalSeats).toBe(400);
    expect(a.seatsRemaining).toBe(400);
    expect(a.tablesRemaining).toBe(40);
    expect(a.soldOut).toBe(false);
  });

  it("a whole table sold removes 10 seats and 1 table", () => {
    const a = availability({ ...base, tablesSold: 1 });
    expect(a.seatsRemaining).toBe(390);
    expect(a.tablesRemaining).toBe(39);
  });

  it("one loose seat breaks a table: 399 seats but only 39 whole tables", () => {
    const a = availability({ ...base, looseSeatsSold: 1 });
    expect(a.seatsRemaining).toBe(399);
    expect(a.tablesRemaining).toBe(39);
  });

  it("held seats consume capacity exactly like loose seats", () => {
    const a = availability({ ...base, heldSeats: 10 });
    expect(a.seatsRemaining).toBe(390);
    expect(a.tablesRemaining).toBe(39);
  });

  it("held and loose seats share the same pooled tables", () => {
    // 6 held + 4 loose = 10 seats = exactly one table consumed
    const a = availability({ ...base, heldSeats: 6, looseSeatsSold: 4 });
    expect(a.seatsRemaining).toBe(390);
    expect(a.tablesRemaining).toBe(39);
  });

  it("live reservations count against availability", () => {
    const a = availability({ ...base, reservedSeats: 10 });
    expect(a.seatsRemaining).toBe(390);
  });

  it("is sold out when the last seat goes", () => {
    const a = availability({ ...base, tablesSold: 39, looseSeatsSold: 10 });
    expect(a.seatsRemaining).toBe(0);
    expect(a.tablesRemaining).toBe(0);
    expect(a.soldOut).toBe(true);
  });

  it("never reports negative remaining if oversold data somehow appears", () => {
    const a = availability({ ...base, tablesSold: 41 });
    expect(a.seatsRemaining).toBe(0);
    expect(a.tablesRemaining).toBe(0);
  });
});

describe("canFulfil", () => {
  it("allows seats down to the very last one", () => {
    const state = { ...base, tablesSold: 39, looseSeatsSold: 9 };
    expect(canFulfil(state, { kind: "seat", quantity: 1 })).toBe(true);
    expect(canFulfil(state, { kind: "seat", quantity: 2 })).toBe(false);
  });

  it("refuses a table when no unbroken table is left, even with seats free", () => {
    // 39 tables sold, 1 loose seat: 9 seats free but the last table is broken
    const state = { ...base, tablesSold: 39, looseSeatsSold: 1 };
    expect(availability(state).seatsRemaining).toBe(9);
    expect(canFulfil(state, { kind: "table", quantity: 1 })).toBe(false);
    expect(canFulfil(state, { kind: "seat", quantity: 9 })).toBe(true);
  });

  it("enforces the per-order caps", () => {
    expect(canFulfil(base, { kind: "seat", quantity: 9 })).toBe(true);
    expect(canFulfil(base, { kind: "seat", quantity: 10 })).toBe(false);
    expect(canFulfil(base, { kind: "table", quantity: 4 })).toBe(true);
    expect(canFulfil(base, { kind: "table", quantity: 5 })).toBe(false);
  });

  it("rejects nonsense quantities", () => {
    expect(canFulfil(base, { kind: "seat", quantity: 0 })).toBe(false);
    expect(canFulfil(base, { kind: "seat", quantity: -1 })).toBe(false);
  });

  it("exports the seats-per-table default", () => {
    expect(SEATS_PER_TABLE).toBe(10);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/unit/ball-capacity.test.ts`
Expected: FAIL — "Failed to resolve import ../../src/ball/capacity".

- [ ] **Step 3: Write the implementation**

Create `src/ball/capacity.ts`:

```ts
import { z } from "zod";

// TASK-313: pure, DB-free availability arithmetic for the Festive Ball (7 Nov 2026).
// NO pool, NO config, NO clock — importing this file touches nothing external, so it is
// unit-tested DB-free like src/benefits/caps.ts. The transactional layer that reads these
// numbers out of Postgres lives in src/db/ball.ts.
//
// The room is 40 tables of 10. Two things can be bought:
//   - a whole TABLE, which must come from a table nobody has broken into; and
//   - individual SEATS, which are pooled onto shared tables.
// Held-back seats (comps, sponsor guests) sit in the same shared pool and never go on sale.
//
// The subtle rule the client agreed: we sell down to the very last individual seat, so a
// shared table may go out with 7 people on it. That means seats and tables run out at
// DIFFERENT times — 9 free seats spread across a broken table is not a sellable table.

export const SEATS_PER_TABLE = 10;
export const MAX_SEATS_PER_ORDER = 9;
export const MAX_TABLES_PER_ORDER = 4;

export const capacityStateSchema = z.object({
  totalTables: z.number().int().nonnegative(),
  seatsPerTable: z.number().int().positive(),
  heldSeats: z.number().int().nonnegative(),
  tablesSold: z.number().int().nonnegative(),
  looseSeatsSold: z.number().int().nonnegative(),
  reservedSeats: z.number().int().nonnegative(),
});
export type CapacityState = z.infer<typeof capacityStateSchema>;

export interface Availability {
  totalSeats: number;
  seatsRemaining: number;
  tablesRemaining: number;
  soldOut: boolean;
}

// Seats that are pooled rather than sold as whole tables: individual sales, live checkout
// reservations, and the comps held back. Together they decide how many tables are BROKEN.
function pooledSeats(s: CapacityState): number {
  return s.looseSeatsSold + s.reservedSeats + s.heldSeats;
}

export function availability(state: CapacityState): Availability {
  const s = capacityStateSchema.parse(state);
  const totalSeats = s.totalTables * s.seatsPerTable;
  const committed = s.tablesSold * s.seatsPerTable + pooledSeats(s);
  // clamp: bad data must never produce a negative that reads as "space available"
  const seatsRemaining = Math.max(0, totalSeats - committed);

  // A whole table is only sellable if no pooled seat has broken into it.
  const tablesBrokenByPool = Math.ceil(pooledSeats(s) / s.seatsPerTable);
  const tablesRemaining = Math.max(0, s.totalTables - s.tablesSold - tablesBrokenByPool);

  return { totalSeats, seatsRemaining, tablesRemaining, soldOut: seatsRemaining === 0 };
}

export const orderSchema = z.object({
  kind: z.enum(["seat", "table"]),
  quantity: z.number().int(),
});
export type Order = z.infer<typeof orderSchema>;

// Can this order be met right now? Checks the per-order cap first (a policy limit, so a
// fat-fingered 40 never becomes a £4,000 charge), then real availability.
export function canFulfil(state: CapacityState, order: Order): boolean {
  const o = orderSchema.parse(order);
  if (o.quantity < 1) return false;

  const a = availability(state);
  if (o.kind === "table") {
    if (o.quantity > MAX_TABLES_PER_ORDER) return false;
    return a.tablesRemaining >= o.quantity;
  }
  if (o.quantity > MAX_SEATS_PER_ORDER) return false;
  return a.seatsRemaining >= o.quantity;
}

// How many seats an order consumes — the single place that conversion lives, so the
// reservation writer and the booking writer can never disagree about it.
export function seatsFor(order: Order, seatsPerTable = SEATS_PER_TABLE): number {
  const o = orderSchema.parse(order);
  return o.kind === "table" ? o.quantity * seatsPerTable : o.quantity;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/unit/ball-capacity.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Lint and typecheck**

Run: `npm run lint && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/ball/capacity.ts test/unit/ball-capacity.test.ts
git commit -m "Add pure capacity model for the Festive Ball"
```

---

## Task 2: The pure pricing model

**Files:**
- Create: `src/ball/pricing.ts`
- Test: `test/unit/ball-pricing.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/unit/ball-pricing.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  SEAT_PRICE_PENCE,
  TABLE_PRICE_PENCE,
  lineTotalPence,
  stripeFeePence,
  orderTotalPence,
} from "../../src/ball/pricing";

describe("prices", () => {
  it("a seat is £100 and a table is £1,000", () => {
    expect(SEAT_PRICE_PENCE).toBe(10_000);
    expect(TABLE_PRICE_PENCE).toBe(100_000);
  });

  it("a table is exactly ten seats, no discount", () => {
    expect(TABLE_PRICE_PENCE).toBe(SEAT_PRICE_PENCE * 10);
  });
});

describe("lineTotalPence", () => {
  it("prices seats", () => {
    expect(lineTotalPence({ kind: "seat", quantity: 3 })).toBe(30_000);
  });
  it("prices tables", () => {
    expect(lineTotalPence({ kind: "table", quantity: 2 })).toBe(200_000);
  });
});

describe("stripeFeePence", () => {
  it("is 1.5% + 20p on a £100 seat, rounded up to the penny", () => {
    // 1.5% of 10000 = 150, + 20 = 170
    expect(stripeFeePence(10_000)).toBe(170);
  });
  it("is £15.20 on a £1,000 table", () => {
    expect(stripeFeePence(100_000)).toBe(1_520);
  });
  it("rounds up so NBCC is never left short a penny", () => {
    // 1.5% of 3333 = 49.995 -> 50, + 20 = 70
    expect(stripeFeePence(3_333)).toBe(70);
  });
});

describe("orderTotalPence", () => {
  it("is just the tickets when nothing is added", () => {
    const t = orderTotalPence({ order: { kind: "seat", quantity: 1 } });
    expect(t.ticketsPence).toBe(10_000);
    expect(t.feeCoverPence).toBe(0);
    expect(t.donationPence).toBe(0);
    expect(t.totalPence).toBe(10_000);
  });

  it("adds the fee cover when the buyer opts in", () => {
    const t = orderTotalPence({ order: { kind: "seat", quantity: 1 }, coverFee: true });
    expect(t.feeCoverPence).toBe(170);
    expect(t.totalPence).toBe(10_170);
  });

  it("adds an optional donation, and the fee cover is calculated on the whole amount", () => {
    const t = orderTotalPence({
      order: { kind: "seat", quantity: 1 },
      donationPence: 2_500,
      coverFee: true,
    });
    expect(t.ticketsPence).toBe(10_000);
    expect(t.donationPence).toBe(2_500);
    // fee on 12500 = 187.5 -> 188, + 20 = 208
    expect(t.feeCoverPence).toBe(208);
    expect(t.totalPence).toBe(12_708);
  });

  it("rejects a negative donation", () => {
    expect(() => orderTotalPence({ order: { kind: "seat", quantity: 1 }, donationPence: -1 }))
      .toThrow();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/unit/ball-pricing.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/ball/pricing.ts`:

```ts
import { z } from "zod";
import { orderSchema, type Order, SEATS_PER_TABLE } from "./capacity";

// TASK-313: pure money arithmetic for the Festive Ball, in integer pence throughout —
// matching src/benefits/caps.ts and the donations columns. No floats reach the database.
//
// The £100 seat price is PRINTED in a magazine, so it is a constant here rather than an
// admin-editable setting: a price field is one somebody eventually changes by accident,
// and the leaflet cannot be recalled.

export const SEAT_PRICE_PENCE = 10_000; // £100
export const TABLE_PRICE_PENCE = SEAT_PRICE_PENCE * SEATS_PER_TABLE; // £1,000, no discount

// Stripe UK standard card pricing. If NBCC is granted the nonprofit rate (1.2% + 20p) this
// is the one place to change — but note ticket sales do not count towards that scheme's
// donation-volume test, so the standard rate is the safe assumption.
export const STRIPE_PERCENT = 0.015;
export const STRIPE_FIXED_PENCE = 20;

export function lineTotalPence(order: Order): number {
  const o = orderSchema.parse(order);
  return o.kind === "table" ? o.quantity * TABLE_PRICE_PENCE : o.quantity * SEAT_PRICE_PENCE;
}

// Rounded UP: the buyer is offering to cover the fee, and a rounded-down penny would leave
// the charity fractionally short on every single order.
export function stripeFeePence(amountPence: number): number {
  const amount = z.number().int().nonnegative().parse(amountPence);
  return Math.ceil(amount * STRIPE_PERCENT) + STRIPE_FIXED_PENCE;
}

export const orderTotalInputSchema = z.object({
  order: orderSchema,
  donationPence: z.number().int().nonnegative().default(0),
  coverFee: z.boolean().default(false),
});
export type OrderTotalInput = z.input<typeof orderTotalInputSchema>;

export interface OrderTotal {
  ticketsPence: number;
  donationPence: number;
  feeCoverPence: number;
  totalPence: number;
}

export function orderTotalPence(input: OrderTotalInput): OrderTotal {
  const { order, donationPence, coverFee } = orderTotalInputSchema.parse(input);
  const ticketsPence = lineTotalPence(order);
  const subtotal = ticketsPence + donationPence;
  const feeCoverPence = coverFee ? stripeFeePence(subtotal) : 0;
  return {
    ticketsPence,
    donationPence,
    feeCoverPence,
    totalPence: subtotal + feeCoverPence,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/unit/ball-pricing.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Lint and typecheck**

Run: `npm run lint && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/ball/pricing.ts test/unit/ball-pricing.test.ts
git commit -m "Add pure pricing model for the Festive Ball"
```

---

## Task 3: The migration

**Files:**
- Create: `migrations/1786100000000_festive-ball.js`

Timestamp note: the highest existing migration is `1786000000000_erasure-log.js`. `1786100000000` sorts after it. **Before committing, run `ls migrations | sort | tail -3` and confirm this file is last** — node-pg-migrate aborts the whole run on production if a new migration sorts before an already-applied one, and CI cannot catch it because its database is empty.

- [ ] **Step 1: Write the migration**

Create `migrations/1786100000000_festive-ball.js`:

```js
/* eslint-disable camelcase */

// TASK-313: Festive Ball 2026 ticketing (7 Nov 2026, The Park Hotel, Kilmarnock).
//
// Three tables, all NEW — nothing existing is touched, so this is additive-only under the
// expand-contract rule and a code-level rollback stays safe.
//
//   ball_settings     — one row, the knobs staff control: capacity, held-back seats, the
//                       password gate, and when sales open and close.
//   ball_bookings     — one row per completed purchase. Money in integer pence, matching
//                       the donations columns.
//   ball_reservations — short-lived seat holds during checkout, so two people cannot buy
//                       the last table at once. Rows expire; a sweeper deletes them.

exports.up = (pgm) => {
  pgm.createTable("ball_settings", {
    id: { type: "integer", primaryKey: true, default: 1 },
    total_tables: { type: "integer", notNull: true, default: 40 },
    seats_per_table: { type: "integer", notNull: true, default: 10 },
    held_seats: {
      type: "integer",
      notNull: true,
      default: 0,
      comment: "Comps and sponsor guests. Never offered for sale.",
    },
    gate_open: {
      type: "boolean",
      notNull: true,
      default: false,
      comment:
        "FALSE = password-gated preview, and the home-page promotion is not rendered at all. " +
        "Staff flip this to launch. Defaults FALSE so the page can never go public by accident.",
    },
    gate_opens_at: {
      type: "timestamptz",
      comment: "Optional scheduled unlock, a safety net behind the manual toggle.",
    },
    sales_close_at: { type: "timestamptz" },
    sales_closed: { type: "boolean", notNull: true, default: false },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  // Exactly one settings row, ever.
  pgm.addConstraint("ball_settings", "ball_settings_singleton", { check: "id = 1" });
  pgm.sql("INSERT INTO ball_settings (id) VALUES (1) ON CONFLICT DO NOTHING");

  pgm.createTable("ball_bookings", {
    id: "id",
    reference: { type: "text", notNull: true, unique: true },
    kind: { type: "text", notNull: true },
    quantity: { type: "integer", notNull: true },
    seats: { type: "integer", notNull: true, comment: "Seats consumed: quantity, or quantity x seats_per_table." },
    buyer_name: { type: "text", notNull: true },
    buyer_email: { type: "text", notNull: true },
    tickets_pence: { type: "integer", notNull: true },
    donation_pence: { type: "integer", notNull: true, default: 0 },
    fee_cover_pence: { type: "integer", notNull: true, default: 0 },
    total_pence: { type: "integer", notNull: true },
    gift_aid: { type: "boolean", notNull: true, default: false },
    newsletter_opt_in: { type: "boolean", notNull: true, default: false },
    stripe_session_id: { type: "text", unique: true },
    status: { type: "text", notNull: true, default: "pending" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    paid_at: { type: "timestamptz" },
  });
  pgm.addConstraint("ball_bookings", "ball_bookings_kind_check", {
    check: "kind IN ('seat', 'table')",
  });
  pgm.addConstraint("ball_bookings", "ball_bookings_status_check", {
    check: "status IN ('pending', 'paid', 'refunded', 'cancelled')",
  });
  // The availability read filters on status, so index it.
  pgm.createIndex("ball_bookings", "status");

  pgm.createTable("ball_reservations", {
    id: "id",
    token: { type: "text", notNull: true, unique: true },
    kind: { type: "text", notNull: true },
    quantity: { type: "integer", notNull: true },
    seats: { type: "integer", notNull: true },
    expires_at: { type: "timestamptz", notNull: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.addConstraint("ball_reservations", "ball_reservations_kind_check", {
    check: "kind IN ('seat', 'table')",
  });
  pgm.createIndex("ball_reservations", "expires_at");
};

exports.down = (pgm) => {
  pgm.dropTable("ball_reservations");
  pgm.dropTable("ball_bookings");
  pgm.dropTable("ball_settings");
};
```

- [ ] **Step 2: Confirm it sorts last**

Run: `ls migrations | sort | tail -3`
Expected: `1786100000000_festive-ball.js` is the final line. If it is not, renumber it above the highest.

- [ ] **Step 3: Run the migration against local Postgres**

Run: `npm run migrate`
Expected: `### MIGRATION 1786100000000_festive-ball.js (UP) ###` then no errors.

- [ ] **Step 4: Verify the singleton row exists**

Run: `psql "$DATABASE_URL" -c "SELECT id, total_tables, seats_per_table, gate_open FROM ball_settings"`
Expected: one row — `1 | 40 | 10 | f`.

- [ ] **Step 5: Commit**

```bash
git add migrations/1786100000000_festive-ball.js
git commit -m "Add Festive Ball settings, bookings and reservations tables"
```

---

## Task 4: The database layer

**Files:**
- Create: `src/db/ball.ts`

- [ ] **Step 1: Write the implementation**

There is no unit test for this file: it is SQL, and this repo keeps unit tests DB-free and covers the database layer through Cucumber (Task 5 exercises it end to end).

Create `src/db/ball.ts`:

```ts
import { pool } from "./pool";
import {
  availability,
  seatsFor,
  type CapacityState,
  type Availability,
  type Order,
} from "../ball/capacity";

// TASK-313: the read/write layer for the Festive Ball. Pure decisions live in src/ball/;
// only SQL lives here, mirroring how src/db/ticker.ts pairs with src/ticker/model.ts.

export interface BallSettings {
  totalTables: number;
  seatsPerTable: number;
  heldSeats: number;
  gateOpen: boolean;
  gateOpensAt: string | null;
  salesCloseAt: string | null;
  salesClosed: boolean;
}

interface SettingsRow {
  total_tables: number;
  seats_per_table: number;
  held_seats: number;
  gate_open: boolean;
  gate_opens_at: string | null;
  sales_close_at: string | null;
  sales_closed: boolean;
}

export async function getSettings(): Promise<BallSettings> {
  const res = await pool.query<SettingsRow>(
    `SELECT total_tables, seats_per_table, held_seats, gate_open,
            gate_opens_at, sales_close_at, sales_closed
       FROM ball_settings WHERE id = 1`,
  );
  const r = res.rows[0];
  return {
    totalTables: r.total_tables,
    seatsPerTable: r.seats_per_table,
    heldSeats: r.held_seats,
    gateOpen: r.gate_open,
    gateOpensAt: r.gate_opens_at,
    salesCloseAt: r.sales_close_at,
    salesClosed: r.sales_closed,
  };
}

// The live capacity picture: settings, plus what has actually been sold, plus reservations
// that have not yet expired. Expired holds are ignored by the WHERE clause rather than
// deleted here, so a read never takes a write lock.
export async function getCapacityState(): Promise<CapacityState> {
  const settings = await getSettings();
  const sold = await pool.query<{ tables_sold: string; loose_seats_sold: string }>(
    `SELECT
       COALESCE(SUM(quantity) FILTER (WHERE kind = 'table'), 0) AS tables_sold,
       COALESCE(SUM(quantity) FILTER (WHERE kind = 'seat'),  0) AS loose_seats_sold
     FROM ball_bookings
     WHERE status IN ('pending', 'paid')`,
  );
  const held = await pool.query<{ reserved_seats: string }>(
    `SELECT COALESCE(SUM(seats), 0) AS reserved_seats
       FROM ball_reservations WHERE expires_at > now()`,
  );
  return {
    totalTables: settings.totalTables,
    seatsPerTable: settings.seatsPerTable,
    heldSeats: settings.heldSeats,
    tablesSold: Number(sold.rows[0].tables_sold),
    looseSeatsSold: Number(sold.rows[0].loose_seats_sold),
    reservedSeats: Number(held.rows[0].reserved_seats),
  };
}

export async function getAvailability(): Promise<Availability & { salesOpen: boolean }> {
  const [state, settings] = await Promise.all([getCapacityState(), getSettings()]);
  const a = availability(state);
  const closedByDate = settings.salesCloseAt !== null && new Date(settings.salesCloseAt) <= new Date();
  return { ...a, salesOpen: !settings.salesClosed && !closedByDate && !a.soldOut };
}

// Claim seats for a checkout. Runs inside a transaction that LOCKS the settings row, so two
// simultaneous buyers are serialised: the second one sees the first one's reservation and is
// refused rather than both being told yes. Returns null when the order cannot be met.
export async function claimReservation(
  order: Order,
  token: string,
  holdMs: number,
): Promise<{ token: string; expiresAt: string } | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Serialise every claim behind the single settings row.
    await client.query("SELECT id FROM ball_settings WHERE id = 1 FOR UPDATE");

    const state = await getCapacityStateWithin(client);
    const { canFulfil } = await import("../ball/capacity");
    if (!canFulfil(state, order)) {
      await client.query("ROLLBACK");
      return null;
    }

    const seats = seatsFor(order, state.seatsPerTable);
    const res = await client.query<{ expires_at: string }>(
      `INSERT INTO ball_reservations (token, kind, quantity, seats, expires_at)
       VALUES ($1, $2, $3, $4, now() + ($5 || ' milliseconds')::interval)
       RETURNING expires_at`,
      [token, order.kind, order.quantity, seats, String(holdMs)],
    );
    await client.query("COMMIT");
    return { token, expiresAt: res.rows[0].expires_at };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// The same read as getCapacityState, but on a caller-supplied client so it participates in
// that caller's transaction and its lock.
async function getCapacityStateWithin(client: {
  query: typeof pool.query;
}): Promise<CapacityState> {
  const s = await client.query<SettingsRow>(
    `SELECT total_tables, seats_per_table, held_seats, gate_open,
            gate_opens_at, sales_close_at, sales_closed
       FROM ball_settings WHERE id = 1`,
  );
  const sold = await client.query<{ tables_sold: string; loose_seats_sold: string }>(
    `SELECT
       COALESCE(SUM(quantity) FILTER (WHERE kind = 'table'), 0) AS tables_sold,
       COALESCE(SUM(quantity) FILTER (WHERE kind = 'seat'),  0) AS loose_seats_sold
     FROM ball_bookings WHERE status IN ('pending', 'paid')`,
  );
  const held = await client.query<{ reserved_seats: string }>(
    `SELECT COALESCE(SUM(seats), 0) AS reserved_seats
       FROM ball_reservations WHERE expires_at > now()`,
  );
  const r = s.rows[0];
  return {
    totalTables: r.total_tables,
    seatsPerTable: r.seats_per_table,
    heldSeats: r.held_seats,
    tablesSold: Number(sold.rows[0].tables_sold),
    looseSeatsSold: Number(sold.rows[0].loose_seats_sold),
    reservedSeats: Number(held.rows[0].reserved_seats),
  };
}

export async function releaseReservation(token: string): Promise<void> {
  await pool.query(`DELETE FROM ball_reservations WHERE token = $1`, [token]);
}
```

- [ ] **Step 2: Lint and typecheck**

Run: `npm run lint && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/db/ball.ts
git commit -m "Add Festive Ball database layer with locked reservation claims"
```

---

## Task 5: The public availability endpoint

**Files:**
- Create: `src/routes/ball.ts`
- Modify: `src/app.ts`
- Create: `features/ball-availability.feature`
- Create: `features/steps/ball.steps.js`

- [ ] **Step 1: Write the failing BDD scenario**

Create `features/ball-availability.feature`:

```gherkin
@ball @db
Feature: Festive Ball availability (TASK-313)
  The public ticket page reads live availability so it can show what is left and stop
  selling when the room is full.

  Scenario: a fresh ball offers every seat and every table
    Given the ball is reset to 40 tables of 10 with 0 held back
    When I request the ball availability
    Then the ball response status should be 200
    And the ball availability should show 400 seats remaining
    And the ball availability should show 40 tables remaining
    And the ball availability should say sales are open

  Scenario: held-back seats reduce what the public can buy
    Given the ball is reset to 40 tables of 10 with 10 held back
    When I request the ball availability
    Then the ball availability should show 390 seats remaining
    And the ball availability should show 39 tables remaining

  Scenario: the endpoint never exposes buyer details
    Given the ball is reset to 40 tables of 10 with 0 held back
    When I request the ball availability
    Then the ball availability should not contain buyer details
```

- [ ] **Step 2: Write the step definitions**

Create `features/steps/ball.steps.js`:

```js
const { Given, When, Then } = require("@cucumber/cucumber");
const assert = require("node:assert");
const { Client } = require("pg");

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

async function withDb(fn) {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

Given(
  "the ball is reset to {int} tables of {int} with {int} held back",
  async function (tables, seats, held) {
    await withDb(async (db) => {
      await db.query("DELETE FROM ball_reservations");
      await db.query("DELETE FROM ball_bookings");
      await db.query(
        `UPDATE ball_settings
            SET total_tables = $1, seats_per_table = $2, held_seats = $3,
                sales_closed = false, sales_close_at = NULL
          WHERE id = 1`,
        [tables, seats, held],
      );
    });
  },
);

When("I request the ball availability", async function () {
  const res = await fetch(`${BASE_URL}/api/ball/availability`);
  this.ballStatus = res.status;
  this.ballBody = await res.json();
});

Then("the ball response status should be {int}", function (expected) {
  assert.strictEqual(this.ballStatus, expected);
});

Then("the ball availability should show {int} seats remaining", function (n) {
  assert.strictEqual(this.ballBody.seatsRemaining, n);
});

Then("the ball availability should show {int} tables remaining", function (n) {
  assert.strictEqual(this.ballBody.tablesRemaining, n);
});

Then("the ball availability should say sales are open", function () {
  assert.strictEqual(this.ballBody.salesOpen, true);
});

Then("the ball availability should not contain buyer details", function () {
  const body = JSON.stringify(this.ballBody).toLowerCase();
  assert.ok(!body.includes("email"), "availability must not leak buyer emails");
  assert.ok(!body.includes("buyer"), "availability must not leak buyer names");
});
```

- [ ] **Step 3: Run the BDD to verify it fails**

Run: `npm run test:bdd -- --tags @ball`
Expected: FAIL — 404 from `/api/ball/availability`.

- [ ] **Step 4: Write the route**

Create `src/routes/ball.ts`:

```ts
import { Router } from "express";
import { getAvailability } from "../db/ball";

// TASK-313: the public, read-only availability feed for the Festive Ball page.
// Deliberately returns ONLY counts — never a buyer name, email or booking reference — because
// it is unauthenticated and cached by nothing. Mirrors the supporter ticker feed's shape.

export const ballRouter = Router();

ballRouter.get("/api/ball/availability", async (_req, res) => {
  try {
    const a = await getAvailability();
    res.json({
      totalSeats: a.totalSeats,
      seatsRemaining: a.seatsRemaining,
      tablesRemaining: a.tablesRemaining,
      soldOut: a.soldOut,
      salesOpen: a.salesOpen,
    });
  } catch (err) {
    console.error("ball availability failed:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "Could not read availability" });
  }
});
```

- [ ] **Step 5: Mount the router**

In `src/app.ts`, add the import beside the other route imports:

```ts
import { ballRouter } from "./routes/ball";
```

and mount it immediately after the `tickerRouter` line, so it sits before the site catch-all:

```ts
  // Public Festive Ball availability feed (TASK-313): GET /api/ball/availability.
  app.use(ballRouter);
```

- [ ] **Step 6: Run the BDD to verify it passes**

Run: `npm run test:bdd -- --tags @ball`
Expected: PASS, 3 scenarios.

- [ ] **Step 7: Run the whole suite**

Run: `npm run lint && npm run build && npm run test:unit && npm run test:bdd`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add src/routes/ball.ts src/app.ts features/ball-availability.feature features/steps/ball.steps.js
git commit -m "Add public Festive Ball availability endpoint"
```

---

## Task 6: README

**Files:**
- Modify: `README.md`

Golden rule 7: a change that leaves `README.md` stale is incomplete.

- [ ] **Step 1: Document the new route, tables and modules**

Add to the routes section: `GET /api/ball/availability` — public, returns seats and tables remaining plus whether sales are open.

Add to the project-structure section: `src/ball/` (pure capacity and pricing logic, DB-free), `src/db/ball.ts` (SQL layer), `src/routes/ball.ts`.

Add to the database section: `ball_settings` (singleton, staff-controlled knobs), `ball_bookings`, `ball_reservations` (expiring checkout holds).

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "Document the Festive Ball capacity layer"
```

---

## Self-review notes

**Spec coverage for plan 1.** Capacity (40×10, held-back seats, sell to the last seat), pricing (£100/£1,000, fee cover), order caps (9 seats / 4 tables), oversell protection (locked reservation claims), sales open/close, and the gate flag are all created here. The gate is stored but not yet *enforced* — that is plan 3, which owns the page.

**Deliberately deferred.** Guest details, dietary and access data, and the 90-day deletion rule are plan 5 — no columns for them exist yet, so nothing is half-built.

**Known follow-up.** `ball_reservations` rows expire logically via `expires_at > now()`, so a stale row never affects availability, but nothing deletes them. Plan 2 adds a sweeper on the checkout path. This is safe to leave: correctness does not depend on the delete, only tidiness does.
