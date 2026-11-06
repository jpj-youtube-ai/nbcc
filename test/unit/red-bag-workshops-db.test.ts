import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn() } }));
vi.mock("../../src/config", () => ({ config: { NODE_ENV: "test" } }));

import { pool } from "../../src/db/pool";
import { createRedBagWorkshop, findRedBagWorkshop, forgetRedBagWorkshops, redBagWorkshopTotals, RESERVED_WORKSHOP_SLUGS, WORKSHOP_SEASON_FROM, WORKSHOP_TOTALS_SQL, slugAllowed, slugFromName, sizeOf, totalsFromRows } from "../../src/db/red-bag-workshops";

// Companies' own Workshops (Jaimie, 6 November 2026): /fill/<slug>. The pure parts here; the queries
// run against Postgres in the BDD suite. Every company name below is invented.
const ROOT = resolve(__dirname, "../..");

describe("a company's link", () => {
  it("is made from its name: small letters, numbers and single hyphens", () => {
    expect(slugFromName("Brightwater Engineering")).toBe("brightwater-engineering");
    expect(slugFromName("  Fern & Thistle Ltd.  ")).toBe("fern-and-thistle-ltd");
    expect(slugFromName("Café Ölm")).toBe("cafe-olm");
    expect(slugFromName("***")).toBe("");
    expect(slugFromName("a".repeat(90)).length).toBeLessThanOrEqual(60);
  });

  it("may not take one of the page's own addresses, or anything of the wrong shape", () => {
    for (const s of RESERVED_WORKSHOP_SLUGS) expect(slugAllowed(s), s).toBe(false);
    expect(RESERVED_WORKSHOP_SLUGS).toContain("thank-you");
    for (const bad of ["", "-start", "end-", "two--hyphens", "Capitals", "with space", "slash/no", "a".repeat(61)]) expect(slugAllowed(bad), bad).toBe(false);
    expect(slugAllowed("brightwater-engineering")).toBe(true);
  });

  it("has one of three private sizes", () => {
    expect(sizeOf("small")).toBe("small");
    expect(sizeOf("large")).toBe("large");
    expect(sizeOf("huge")).toBeNull();
    expect(sizeOf(undefined)).toBeNull();
  });
});

describe("the totals", () => {
  it("counts paid Fill a Red Bag gifts less refunds, from the season's start, overall and per company", () => {
    expect(WORKSHOP_SEASON_FROM).toBe("2026-11-01T00:00:00Z");
    expect(WORKSHOP_TOTALS_SQL).toMatch(/payment_status = 'paid'/);
    expect(WORKSHOP_TOTALS_SQL).toMatch(/source = 'red_bag'/);
    expect(WORKSHOP_TOTALS_SQL).toMatch(/GREATEST\(amount_pence - refunded_amount_pence, 0\)/);
    expect(WORKSHOP_TOTALS_SQL).toMatch(/created_at >= \$1/);
    expect(WORKSHOP_TOTALS_SQL).toMatch(/ROLLUP \(red_bag_workshop_id\)/);
  });

  it("reads the grand total from the last row, and each company's from its own", () => {
    const t = totalsFromRows([
      { workshop_id: 3, pence: "15000" },
      { workshop_id: null, pence: "4000" },
      { workshop_id: null, pence: "19000" },
    ]);
    expect(t.everyonePence).toBe(19000);
    expect([...t.byWorkshopPence]).toEqual([[3, 15000]]);
    expect(totalsFromRows([]).everyonePence).toBe(0);
  });
});

describe("the migration", () => {
  const file = readdirSync(resolve(ROOT, "migrations")).find((f) => f.endsWith("_red-bag-workshops.js"))!;
  const text = readFileSync(resolve(ROOT, "migrations", file), "utf8");

  it("is additive: a new table and a nullable column, no default, nothing dropped on the way up", () => {
    const up = text.slice(text.indexOf("exports.up"), text.indexOf("exports.down"));
    expect(up).toMatch(/createTable\("red_bag_workshops"/);
    expect(up).toMatch(/addColumns\("donations"/);
    expect(up).not.toMatch(/drop|notNull: true,\s*\n?\s*references/i);
    expect(up).toMatch(/onDelete: "SET NULL"/);
  });

  it("sorts after the donations work it follows", () => {
    expect(file > "1791200000370_donation-arrival-and-payment.js").toBe(true);
  });
});

describe("the public page's reads", () => {
  const query = pool.query as unknown as ReturnType<typeof vi.fn>;
  beforeEach(() => {
    query.mockReset();
    forgetRedBagWorkshops();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  const row = { id: 7, slug: "brightwater-engineering", name: "Brightwater Engineering", size: "small", created_at: "2026-11-02T10:00:00Z", archived_at: null };

  it("finds a live company by its link, and reads once a minute, not every visit", async () => {
    query.mockResolvedValue({ rows: [row] });
    expect((await findRedBagWorkshop("brightwater-engineering"))?.name).toBe("Brightwater Engineering");
    expect(await findRedBagWorkshop("someone-else")).toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("never reads for a link of the wrong shape or one of the page's own", async () => {
    expect(await findRedBagWorkshop("Thank You")).toBeNull();
    expect(await findRedBagWorkshop("thank-you")).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });

  it("never throws: on trouble, no company and nothing counted", async () => {
    query.mockRejectedValue(new Error("the database is away"));
    expect(await findRedBagWorkshop("brightwater-engineering")).toBeNull();
    expect((await redBagWorkshopTotals()).everyonePence).toBe(0);
  });

  it("reads the totals from the season's start", async () => {
    query.mockResolvedValueOnce({ rows: [{ workshop_id: null, pence: "25000" }] });
    expect((await redBagWorkshopTotals()).everyonePence).toBe(25000);
    expect(query.mock.calls[0][1]).toEqual(["2026-11-01T00:00:00Z"]);
  });
});

describe("making a company's Workshop", () => {
  const query = pool.query as unknown as ReturnType<typeof vi.fn>;
  beforeEach(() => query.mockReset());

  it("refuses a missing name, a bad size, one of the page's own links, and a link already taken", async () => {
    expect(await createRedBagWorkshop({ name: "  ", size: "small", by: "staff" })).toEqual({ ok: false, reason: "name" });
    expect(await createRedBagWorkshop({ name: "Fern & Thistle", size: "huge", by: "staff" })).toEqual({ ok: false, reason: "size" });
    expect(await createRedBagWorkshop({ name: "Fern & Thistle", slug: "thank-you", size: "small", by: "staff" })).toEqual({ ok: false, reason: "slug" });
    query.mockResolvedValueOnce({ rows: [] });
    expect(await createRedBagWorkshop({ name: "Fern & Thistle", size: "small", by: "staff" })).toEqual({ ok: false, reason: "taken" });
    expect(query.mock.calls[0][1]).toEqual(["fern-and-thistle", "Fern & Thistle", "small", "staff"]);
  });
});
