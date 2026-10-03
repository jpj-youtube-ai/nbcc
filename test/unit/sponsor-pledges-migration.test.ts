import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";

// Sponsor pledges (Jaimie, 2026-10-03): "Sponsor now, pay after". Two new tables: sponsor_pledges (a
// promise, never money) and sponsor_pledge_declarations (when each Gift Aid declaration was made,
// kept apart so it outlives the pledge). Additive only. Against a fake pgm. It must sort after every
// migration already run on production (node-pg-migrate refuses one that sorts before a migration
// already run), so it is checked by name against 215, never as "the last one".

const ROOT = resolve(__dirname, "../..");
const NAME = "1791200000220_sponsor-pledges.js";
const migration = createRequire(import.meta.url)(resolve(ROOT, "migrations", NAME)) as {
  up: (pgm: unknown) => void;
  down: (pgm: unknown) => void;
};

function fakePgm() {
  const calls: Array<{ op: string; args: unknown[] }> = [];
  const record = (op: string) => (...args: unknown[]) => {
    calls.push({ op, args });
  };
  return {
    calls,
    pgm: {
      createTable: record("createTable"),
      dropTable: record("dropTable"),
      createIndex: record("createIndex"),
      addColumns: record("addColumns"),
      dropColumns: record("dropColumns"),
      sql: record("sql"),
      func: (s: string) => ({ func: s }),
    },
  };
}

type Cols = Record<string, Record<string, unknown> | string>;

describe("the sponsor pledges migration", () => {
  const f = fakePgm();
  migration.up(f.pgm);
  const create = f.calls.find((c) => c.op === "createTable" && c.args[0] === "sponsor_pledges")!;
  const kept = f.calls.find((c) => c.op === "createTable" && c.args[0] === "sponsor_pledge_declarations")!;
  const cols = create.args[1] as Cols;
  const col = (name: string) => cols[name] as Record<string, unknown>;

  it("only adds: two new tables and their indexes, nothing changed or dropped", () => {
    expect(f.calls.map((c) => c.op).filter((op) => op !== "createIndex")).toEqual(["createTable", "createTable"]);
  });

  it("belongs to a fundraiser, and goes with it", () => {
    expect(col("fundraiser_id")).toMatchObject({ type: "integer", notNull: true, references: "fundraisers", onDelete: "CASCADE" });
  });

  it("holds an amount from £2 to £1,000", () => {
    expect(col("amount_pence")).toMatchObject({ type: "integer", notNull: true });
    expect(String(col("amount_pence").check)).toContain("amount_pence >= 200");
    expect(String(col("amount_pence").check)).toContain("amount_pence <= 100000");
  });

  it("lets the personal details be emptied, so an unpaid pledge can be anonymised", () => {
    for (const name of ["first_name", "surname", "email", "message", "ga_house", "ga_address", "ga_postcode"]) {
      expect(col(name).notNull, name).not.toBe(true);
    }
    expect(col("anonymised_at")).toMatchObject({ type: "timestamptz" });
  });

  it("keeps the Gift Aid declaration made with the pledge: the exact words, their version and when", () => {
    expect(col("gift_aid")).toMatchObject({ type: "boolean", notNull: true, default: false });
    for (const name of ["ga_wording_version", "ga_wording_snapshot", "ga_declared_at"]) expect(cols[name], name).toBeDefined();
    // A pledge with Gift Aid always carries its declaration.
    const constraints = JSON.stringify(create.args[2]);
    expect(constraints).toContain("ga_wording_snapshot IS NOT NULL");
  });

  it("has the six states a pledge can be in, starting unconfirmed until the sponsor confirms by email", () => {
    expect(col("status")).toMatchObject({ type: "text", notNull: true, default: "unconfirmed" });
    for (const s of ["unconfirmed", "open", "paid", "cash", "cancelled", "expired"]) expect(String(col("status").check)).toContain(`'${s}'`);
    expect(col("confirmed_at")).toMatchObject({ type: "timestamptz" });
    expect(col("confirm_email_sent_at")).toMatchObject({ type: "timestamptz" });
  });

  it("claims each of the two later emails once, and records what paid it", () => {
    for (const name of ["pay_email_claimed_at", "pay_email_sent_at", "reminder_claimed_at", "reminder_sent_at", "paid_at", "paid_amount_pence"]) {
      expect(cols[name], name).toBeDefined();
    }
    expect(col("donation_id")).toMatchObject({ references: "donations", onDelete: "SET NULL" });
    expect(col("declaration_id")).toMatchObject({ references: "declarations", onDelete: "SET NULL" });
    expect(col("token_nonce")).toMatchObject({ type: "text", notNull: true });
  });

  it("remembers the checkout it last opened, a pay link sent by hand, a pledge its organiser hid and one paid twice", () => {
    for (const name of [
      "checkout_session_id",
      "pay_email_last_sent_at",
      "pay_email_resends",
      "hidden_at",
      "hidden_by",
      "double_paid_at",
      "double_paid_donation_id",
      "double_paid_alerted_at",
      "double_paid_checked_at",
      "double_paid_checked_by",
    ]) {
      expect(cols[name], name).toBeDefined();
    }
  });

  it("keeps when each Gift Aid declaration was made in a table of its own, tied to nothing that can be deleted from under it", () => {
    const k = kept.args[1] as Cols;
    expect(k.declared_at).toMatchObject({ type: "timestamptz", notNull: true });
    for (const name of ["pledge_id", "donation_id", "declaration_id"]) {
      expect(k[name], name).toBeDefined();
      expect((k[name] as Record<string, unknown>).references, name).toBeUndefined();
    }
    expect(k.wording_snapshot).toBeDefined();
    expect(k.wording_version).toBeDefined();
  });

  it("is indexed by fundraiser", () => {
    const index = f.calls.find((c) => c.op === "createIndex")!;
    expect(index.args[0]).toBe("sponsor_pledges");
    expect(JSON.stringify(index.args[1])).toContain("fundraiser_id");
  });

  it("drops only its own tables on the way down", () => {
    const d = fakePgm();
    migration.down(d.pgm);
    expect(d.calls.map((c) => [c.op, c.args[0]])).toEqual([
      ["dropTable", "sponsor_pledge_declarations"],
      ["dropTable", "sponsor_pledges"],
    ]);
  });

  it("sorts after 215 by name", () => {
    expect(NAME > "1791200000215").toBe(true);
    const names = readdirSync(resolve(ROOT, "migrations")).filter((n) => n.endsWith(".js")).sort();
    expect(names.indexOf(NAME)).toBeGreaterThan(names.indexOf("1791200000197_touch-wording-approvals.js"));
  });
});
