import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";

// Event tickets (Jaimie, points 23 and 24): NBCC sells an event's tickets for its organiser. One
// additive migration: a fourth answer to "How do people get in?" ('nbcc'), and six new tables for
// the ticket types staff approve, each event's sales limit and switch, the orders and their lines,
// the refunds staff made and the refunds organisers asked for. Numbered 1791200000215, so it sorts
// after 1791200000210 (built alongside it): node-pg-migrate refuses on production to run one that
// sorts before a migration already run.

const ROOT = resolve(__dirname, "../..");
const NAME = "1791200000215_event-tickets.js";

type Call = { op: string; args: unknown[] };
function fakePgm() {
  const calls: Call[] = [];
  const rec = (op: string) => (...args: unknown[]) => {
    calls.push({ op, args });
  };
  return {
    calls,
    pgm: {
      createTable: rec("createTable"),
      dropTable: rec("dropTable"),
      addConstraint: rec("addConstraint"),
      dropConstraint: rec("dropConstraint"),
      createIndex: rec("createIndex"),
      dropIndex: rec("dropIndex"),
      sql: rec("sql"),
      func: (s: string) => ({ func: s }),
    },
  };
}

const migration = createRequire(import.meta.url)(resolve(ROOT, "migrations", NAME)) as {
  up: (pgm: unknown) => void;
  down: (pgm: unknown) => void;
};

const TABLES = [
  "event_ticket_settings",
  "event_ticket_types",
  "event_ticket_orders",
  "event_ticket_order_lines",
  "event_ticket_refunds",
  "event_ticket_refund_requests",
];

type Column = { type: string; notNull?: boolean; default?: unknown; references?: string; onDelete?: string; primaryKey?: boolean; unique?: boolean };

function tableColumns(calls: Call[], table: string): Record<string, Column> {
  const c = calls.find((x) => x.op === "createTable" && x.args[0] === table);
  expect(c, `no createTable for ${table}`).toBeTruthy();
  return c?.args[1] as Record<string, Column>;
}

const sqlOf = (calls: Call[]) => calls.filter((c) => c.op === "sql").map((c) => String(c.args[0])).join("\n");
const checks = (calls: Call[]) =>
  calls
    .filter((c) => c.op === "addConstraint")
    .map((c) => `${String(c.args[0])} ${String(c.args[1])} ${JSON.stringify(c.args[2])}`)
    .join("\n");

describe("the event tickets migration", () => {
  it("creates the six ticket tables", () => {
    const { calls, pgm } = fakePgm();
    migration.up(pgm);
    const created = calls.filter((c) => c.op === "createTable").map((c) => c.args[0]);
    expect([...created].sort()).toEqual([...TABLES].sort());
  });

  it("widens How do people get in? to take 'nbcc', dropping the old check before adding the new", () => {
    const { calls, pgm } = fakePgm();
    migration.up(pgm);
    const sql = sqlOf(calls);
    expect(sql).toContain("DROP CONSTRAINT IF EXISTS fundraisers_booking_check");
    expect(sql).toMatch(/booking IN \('away', 'door', 'free', 'nbcc'\)/);
    expect(sql.indexOf("DROP CONSTRAINT")).toBeLessThan(sql.indexOf("ADD CONSTRAINT"));
  });

  it("ties every table to its event, and never lets a financial record be deleted with it", () => {
    const { calls, pgm } = fakePgm();
    migration.up(pgm);
    for (const t of ["event_ticket_settings", "event_ticket_types"]) {
      const col = tableColumns(calls, t).fundraiser_id;
      expect(col.references).toBe("fundraisers");
      expect(col.onDelete).toBe("CASCADE");
      expect(col.notNull).toBe(true);
    }
    // Orders (and so their lines, refunds and refund requests) stop an event being deleted, and a
    // ticket type that has been sold cannot be deleted either.
    const order = tableColumns(calls, "event_ticket_orders").fundraiser_id;
    expect(order.references).toBe("fundraisers");
    expect(order.onDelete).toBe("RESTRICT");
    expect(tableColumns(calls, "event_ticket_refund_requests").fundraiser_id.onDelete).toBe("RESTRICT");
    expect(tableColumns(calls, "event_ticket_order_lines").ticket_type_id.onDelete).toBe("RESTRICT");
  });

  it("writes a refund down before Stripe is asked: pending with its own key, then done or failed", () => {
    const { calls, pgm } = fakePgm();
    migration.up(pgm);
    const refunds = tableColumns(calls, "event_ticket_refunds");
    expect(refunds.status).toMatchObject({ type: "text", notNull: true });
    expect(refunds.idempotency_key).toMatchObject({ type: "text", notNull: true, unique: true });
    expect(refunds.request_id.references).toBe("event_ticket_refund_requests");
    expect(refunds.request_id.onDelete).toBe("SET NULL");
    expect(checks(calls)).toContain("status IN ('pending', 'done', 'failed')");
    // The requests table has to exist before the refunds that point at it.
    const order = calls.filter((c) => c.op === "createTable").map((c) => c.args[0]);
    expect(order.indexOf("event_ticket_refund_requests")).toBeLessThan(order.indexOf("event_ticket_refunds"));
  });

  it("allows one open refund request a booking", () => {
    const { calls, pgm } = fakePgm();
    migration.up(pgm);
    const idx = calls.find((c) => c.op === "createIndex" && c.args[0] === "event_ticket_refund_requests" && (c.args[2] as { unique?: boolean })?.unique);
    expect(idx?.args[1]).toBe("order_id");
    expect((idx?.args[2] as { where?: string }).where).toBe("status = 'open'");
  });

  it("keeps what staff are told about an order, and what the daily task needs", () => {
    const { calls, pgm } = fakePgm();
    migration.up(pgm);
    const orders = tableColumns(calls, "event_ticket_orders");
    expect(orders.flags).toMatchObject({ type: "jsonb", notNull: true });
    for (const k of ["disputed_at", "phone_deleted_at", "confirmation_sent_at", "confirmation_claimed_at"]) expect(orders[k].type).toBe("timestamptz");
    expect(orders.ip_hash.type).toBe("text");
    // How many times the daily task has tried a tickets email that will not go (it stops at three).
    expect(orders.confirmation_attempts).toMatchObject({ type: "integer", notNull: true, default: 0 });
  });

  it("keeps money in whole pence, never below nothing, and never refunds more than was paid", () => {
    const { calls, pgm } = fakePgm();
    migration.up(pgm);
    const orders = tableColumns(calls, "event_ticket_orders");
    for (const k of ["tickets_pence", "fee_cover_pence", "total_pence", "refunded_pence"]) {
      expect(orders[k].type).toBe("integer");
      expect(orders[k].notNull).toBe(true);
    }
    const all = checks(calls);
    expect(all).toContain("total_pence = tickets_pence + fee_cover_pence");
    expect(all).toContain("refunded_pence >= 0 AND refunded_pence <= total_pence");
    expect(all).toContain("price_pence >= 100 AND price_pence <= 50000");
    expect(all).toContain("refunded_quantity >= 0 AND refunded_quantity <= quantity");
  });

  it("allows a free ticket (£0) or a price from £1 to £500, and an order with nothing to pay", () => {
    const { calls, pgm } = fakePgm();
    migration.up(pgm);
    expect(checks(calls)).toContain("price_pence = 0 OR (price_pence >= 100 AND price_pence <= 50000)");
    expect(checks(calls)).toContain("tickets_pence >= 0 AND fee_cover_pence >= 0");
  });

  it("keeps when sales close, as the host chose and as they have proposed", () => {
    const { calls, pgm } = fakePgm();
    migration.up(pgm);
    const settings = tableColumns(calls, "event_ticket_settings");
    for (const k of ["sales_close_mode", "proposed_close_mode"]) expect(settings[k].type).toBe("text");
    for (const k of ["sales_close_at", "proposed_close_at"]) expect(settings[k].type).toBe("timestamptz");
    expect(checks(calls)).toContain("sales_close_mode IS NULL OR sales_close_mode IN ('start', 'day_before', 'custom')");
  });

  it("knows only the order statuses the code uses", () => {
    const { calls, pgm } = fakePgm();
    migration.up(pgm);
    expect(checks(calls)).toContain("status IN ('pending', 'paid', 'expired', 'cancelled')");
    expect(checks(calls)).toContain("status IN ('proposed', 'approved', 'withdrawn')");
    expect(checks(calls)).toContain("status IN ('open', 'refunded', 'declined')");
  });

  it("makes a reference and a Stripe session unique to one order, and a Stripe refund to one row", () => {
    const { calls, pgm } = fakePgm();
    migration.up(pgm);
    const orders = tableColumns(calls, "event_ticket_orders");
    expect(orders.reference.unique).toBe(true);
    expect(orders.stripe_session_id.unique).toBe(true);
    expect(tableColumns(calls, "event_ticket_refunds").stripe_refund_id.unique).toBe(true);
  });

  it("finds the places held by live orders quickly, by event", () => {
    const { calls, pgm } = fakePgm();
    migration.up(pgm);
    const idx = calls.filter((c) => c.op === "createIndex").map((c) => `${String(c.args[0])}:${JSON.stringify(c.args[1])}`);
    expect(idx).toContain('event_ticket_orders:"fundraiser_id"');
    expect(idx).toContain('event_ticket_orders:"stripe_payment_intent_id"');
    expect(idx).toContain('event_ticket_order_lines:"order_id"');
  });

  it("drops what it made on the way down, and puts the old check back NOT VALID", () => {
    const { calls, pgm } = fakePgm();
    migration.down(pgm);
    const dropped = calls.filter((c) => c.op === "dropTable").map((c) => c.args[0]);
    expect([...dropped].sort()).toEqual([...TABLES].sort());
    const sql = sqlOf(calls);
    expect(sql).toMatch(/booking IN \('away', 'door', 'free'\)\) NOT VALID/);
  });

  it("sorts after 1791200000210, the migration built alongside it", () => {
    const names = readdirSync(resolve(ROOT, "migrations")).filter((n) => n.endsWith(".js"));
    expect(names).toContain(NAME);
    expect(NAME > "1791200000210").toBe(true);
    expect(NAME.localeCompare("1791200000210_zzz.js")).toBeGreaterThan(0);
  });
});
