import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import type Stripe from "stripe";
import {
  DONATION_SOURCES,
  sourceFromCheckoutSession,
  donationFromCheckoutSession,
} from "../../src/db/stripe-webhook-model";

// Where a gift was started on the website. The checkout stamps metadata.redBag = "true" on a Fill a
// Red Bag session and on no other (src/routes/api.ts); this is only the reading of that mark. It
// must never change what is saved as the donation itself.

const session = (metadata: unknown): Stripe.Checkout.Session =>
  ({
    id: "cs_test_source",
    object: "checkout.session",
    amount_total: 5410,
    currency: "gbp",
    payment_status: "paid",
    payment_intent: "pi_test_source",
    subscription: null,
    customer_details: { name: "Robin Example", email: "robin@example.com" },
    metadata,
  }) as unknown as Stripe.Checkout.Session;

const base = { mode: "once", plan: "", giftAid: "false", donorType: "individual", fullName: "Robin Example", email: "robin@example.com" };

describe("the allowed sources", () => {
  it("is one list, holding red_bag", () => {
    expect(DONATION_SOURCES).toEqual(["red_bag"]);
  });
});

describe("where a checkout session's gift came from", () => {
  it('is red_bag when the checkout marked it "true"', () => {
    expect(sourceFromCheckoutSession(session({ ...base, redBag: "true" }))).toBe("red_bag");
  });

  it.each([
    ["no mark at all", { ...base }],
    ['a mark of "false"', { ...base, redBag: "false" }],
    ["an empty mark", { ...base, redBag: "" }],
    ['"TRUE" in capitals', { ...base, redBag: "TRUE" }],
    ['"1"', { ...base, redBag: "1" }],
    ["a real boolean true (Stripe only ever sends strings)", { ...base, redBag: true }],
    ["a number", { ...base, redBag: 1 }],
    ["null metadata", null],
    ["no metadata", undefined],
    ["metadata that is not an object", "redBag=true"],
  ])("is not recorded for %s", (_what, md) => {
    expect(sourceFromCheckoutSession(session(md))).toBeNull();
  });

  it("is not recorded for a session that is missing altogether", () => {
    expect(sourceFromCheckoutSession(null as unknown as Stripe.Checkout.Session)).toBeNull();
    expect(sourceFromCheckoutSession(undefined as unknown as Stripe.Checkout.Session)).toBeNull();
  });

  it("only ever answers with a value from the list", () => {
    const got = sourceFromCheckoutSession(session({ ...base, redBag: "true" }));
    expect(DONATION_SOURCES).toContain(got);
  });

  it("leaves the donation and the donor exactly as they are without the mark", () => {
    expect(donationFromCheckoutSession(session({ ...base, redBag: "true" }))).toEqual(
      donationFromCheckoutSession(session({ ...base })),
    );
  });
});

// The migration that adds the column. Additive only (golden rule 2). It must sort after everything
// production had already run when it was written: one that sorts before stops the whole deploy, and
// CI cannot see it. Later migrations rightly come after it.
describe("the donation source migration", () => {
  const dir = join(__dirname, "..", "..", "migrations");
  const name = "1791200000250_donation-source.js";
  const load = () => createRequire(__filename)(join(dir, name)) as { up: (pgm: unknown) => void; down: (pgm: unknown) => void };

  const recorder = () => {
    const calls: Array<[string, ...unknown[]]> = [];
    const pgm = new Proxy(
      {},
      {
        get:
          (_t, method: string) =>
          (...args: unknown[]) => {
            calls.push([method, ...args]);
          },
      },
    );
    return { pgm, calls };
  };

  it("sorts after everything production had already run, so production never sees it run out of order", () => {
    const all = readdirSync(dir).filter((f) => f.endsWith(".js")).sort();
    expect(all.indexOf(name)).toBeGreaterThan(all.indexOf("1791200000240_team-invite-under-18.js"));
  });

  it("adds one nullable text column with no default, and a small index over the rows that have one", () => {
    const { pgm, calls } = recorder();
    load().up(pgm);
    expect(calls.map((c) => c[0])).toEqual(["addColumns", "createIndex"]);
    const [, table, columns] = calls[0] as [string, string, Record<string, Record<string, unknown>>];
    expect(table).toBe("donations");
    expect(Object.keys(columns)).toEqual(["source"]);
    expect(columns.source.type).toBe("text");
    expect(columns.source).not.toHaveProperty("notNull");
    expect(columns.source).not.toHaveProperty("default");
    expect(columns.source).not.toHaveProperty("check");
    expect(String(columns.source.comment)).toMatch(/red_bag/);
    expect(calls[1]).toEqual(["createIndex", "donations", "source", { where: "source IS NOT NULL" }]);
  });

  it("is undone by taking the index and the column away again", () => {
    const { pgm, calls } = recorder();
    load().down(pgm);
    expect(calls).toEqual([
      ["dropIndex", "donations", "source", { ifExists: true }],
      ["dropColumns", "donations", ["source"], { ifExists: true }],
    ]);
  });
});
