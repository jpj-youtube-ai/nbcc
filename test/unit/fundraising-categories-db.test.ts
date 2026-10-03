import { describe, it, expect, vi, beforeEach } from "vitest";

// Fundraising categories, the SQL side, against a fake pool that answers by statement (no database):
// reading the list (kept for a minute, read afresh after any change here), adding one (its key made
// from its name, never a key used before, never a name already there), renaming and hiding one, and
// every change written to audit_log in the same transaction. Every name here is invented.

vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));
vi.mock("../../src/config", () => ({ config: { NODE_ENV: "test" } }));

import { pool } from "../../src/db/pool";
import {
  CATEGORY_CACHE_MS,
  CategoryError,
  addCategory,
  forgetCategories,
  listCategories,
  loadCategories,
  updateCategory,
} from "../../src/db/fundraising-categories";
import {
  BUILT_IN_CATEGORIES,
  categoryLabel,
  formCategories,
  isActiveCategory,
  rememberCategories,
} from "../../src/fundraising/categories";

const row = (key: string, label: string, active = true, used = 0) => ({
  key,
  label,
  active,
  created_at: "2026-10-03T09:00:00Z",
  created_by: "migration",
  retired_at: active ? null : "2026-10-03T09:00:00Z",
  used: String(used),
});
const seedRows = () => BUILT_IN_CATEGORIES.map((c) => row(c.key, c.label, c.active));

const query = pool.query as unknown as ReturnType<typeof vi.fn>;

type Answer = (sql: string, params: unknown[]) => unknown;
function useClient(answer: Answer) {
  const calls: Array<[string, unknown[]]> = [];
  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push([sql, params]);
      const out = answer(sql, params);
      if (out instanceof Error) throw out;
      return out ?? { rows: [] };
    }),
    release: vi.fn(),
  };
  (pool.connect as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(client);
  return calls;
}

beforeEach(() => {
  query.mockReset();
  (pool.connect as unknown as ReturnType<typeof vi.fn>).mockReset();
  forgetCategories();
  rememberCategories(BUILT_IN_CATEGORIES);
});

describe("reading the list", () => {
  it("is every category, A to Z with Other last, with how many sign ups have each", async () => {
    query.mockResolvedValue({ rows: [row("other", "Other"), row("walk", "Walk", true, 3), row("run_walk", "Run or walk", false, 2)] });
    const list = await listCategories({ used: true });
    expect(list.map((c) => c.key)).toEqual(["run_walk", "walk", "other"]);
    expect(list[0]).toMatchObject({ label: "Run or walk", active: false, used: 2, retiredAt: "2026-10-03T09:00:00.000Z" });
    expect(String(query.mock.calls[0][0])).toMatch(/FROM fundraising_categories/);
  });

  it("is kept for a minute, then read again", async () => {
    query.mockResolvedValue({ rows: seedRows() });
    const t = 1_000_000;
    await loadCategories({ now: t });
    await loadCategories({ now: t + CATEGORY_CACHE_MS - 1 });
    expect(query).toHaveBeenCalledTimes(1);
    await loadCategories({ now: t + CATEGORY_CACHE_MS + 1 });
    expect(query).toHaveBeenCalledTimes(2);
    expect(CATEGORY_CACHE_MS).toBeLessThanOrEqual(60_000);
  });

  it("is read afresh when asked, as a sign up with a category this server has not seen yet is", async () => {
    query.mockResolvedValueOnce({ rows: seedRows() });
    await loadCategories();
    expect(isActiveCategory("sponsored_silence")).toBe(false);
    query.mockResolvedValueOnce({ rows: [...seedRows(), row("sponsored_silence", "Sponsored silence")] });
    await loadCategories({ fresh: true });
    expect(isActiveCategory("sponsored_silence")).toBe(true);
    expect(categoryLabel("sponsored_silence")).toBe("Sponsored silence");
  });

  it("when the database cannot answer, keeps what it had (or the built in list) and never throws", async () => {
    query.mockRejectedValue(new Error("database down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const list = await loadCategories();
    expect(list.map((c) => c.key)).toEqual(expect.arrayContaining(["bake_sale_2", "run_walk", "other"]));
    expect(formCategories().at(-1)?.key).toBe("other");
    err.mockRestore();
  });
});

describe("adding a category", () => {
  it("makes its key from its name, stores who added it, and records it in audit_log, in one transaction", async () => {
    const calls = useClient((sql, params) => {
      if (sql.startsWith("SELECT key, label FROM fundraising_categories")) return { rows: seedRows() };
      if (sql.startsWith("INSERT INTO fundraising_categories")) return { rows: [row(String(params[0]), String(params[1]))] };
      return undefined;
    });
    query.mockResolvedValue({ rows: [...seedRows(), row("sponsored_silence", "Sponsored silence")] });
    const added = await addCategory("Sponsored silence", "admin:kim@example.com");
    expect(added).toMatchObject({ key: "sponsored_silence", label: "Sponsored silence", active: true });
    const sqls = calls.map(([s]) => s);
    expect(sqls[0]).toBe("BEGIN");
    expect(sqls).toContain("COMMIT");
    expect(sqls.some((s) => /LOCK TABLE fundraising_categories/.test(s))).toBe(true);
    const insert = calls.find(([s]) => s.startsWith("INSERT INTO fundraising_categories"));
    expect(insert?.[1]).toEqual(["sponsored_silence", "Sponsored silence", "admin:kim@example.com"]);
    const audit = calls.find(([s]) => s.includes("INSERT INTO audit_log"));
    expect(audit?.[1]).toEqual(["admin:kim@example.com", "fundraising.category_added", "fundraising_category", null, { key: "sponsored_silence", label: "Sponsored silence" }]);
    expect(sqls.indexOf("COMMIT")).toBeGreaterThan(sqls.findIndex((s) => s.includes("INSERT INTO audit_log")));
    // The list on this server is read again at once, so the form offers it straight away.
    expect(isActiveCategory("sponsored_silence")).toBe(true);
  });

  it("never takes a key used before, an old category's included", async () => {
    const calls = useClient((sql, params) => {
      if (sql.startsWith("SELECT key, label FROM fundraising_categories")) return { rows: [row("bake_sale", "Bake sale or coffee morning", false)] };
      if (sql.startsWith("INSERT INTO fundraising_categories")) return { rows: [row(String(params[0]), String(params[1]))] };
      return undefined;
    });
    query.mockResolvedValue({ rows: seedRows() });
    await addCategory("Bake Sale", "admin:kim@example.com");
    expect(calls.find(([s]) => s.startsWith("INSERT INTO fundraising_categories"))?.[1][0]).toBe("bake_sale_2");
  });

  it("refuses a name already there, whatever the case, hidden ones included, and writes nothing", async () => {
    const calls = useClient((sql) => {
      if (sql.startsWith("SELECT key, label FROM fundraising_categories")) return { rows: [row("walk", "Walk", false)] };
      return undefined;
    });
    await expect(addCategory("WALK", "admin:kim@example.com")).rejects.toMatchObject({ reason: "label_taken", key: "walk" });
    expect(calls.some(([s]) => s.startsWith("INSERT"))).toBe(false);
    expect(calls.map(([s]) => s)).toContain("ROLLBACK");
  });
});

describe("changing a category", () => {
  it("renames it, keeping its key, and records the old and new names", async () => {
    const calls = useClient((sql, params) => {
      if (sql.startsWith("SELECT key, label, active FROM fundraising_categories WHERE key")) return { rows: [row("quiz", "Quiz")] };
      if (sql.startsWith("SELECT key FROM fundraising_categories WHERE lower(label)")) return { rows: [] };
      if (sql.startsWith("UPDATE fundraising_categories")) return { rows: [row("quiz", String(params[1]))] };
      return undefined;
    });
    query.mockResolvedValue({ rows: seedRows() });
    const after = await updateCategory("quiz", { label: "Quiz night" }, "admin:kim@example.com");
    expect(after).toMatchObject({ key: "quiz", label: "Quiz night" });
    const audit = calls.find(([s]) => s.includes("INSERT INTO audit_log"));
    expect(audit?.[1]).toEqual([
      "admin:kim@example.com",
      "fundraising.category_changed",
      "fundraising_category",
      null,
      { key: "quiz", label: "Quiz night", was: { label: "Quiz", active: true } },
    ]);
  });

  it("hides it from the form, noting when, and brings it back", async () => {
    const calls = useClient((sql, params) => {
      if (sql.startsWith("SELECT key, label, active FROM fundraising_categories WHERE key")) return { rows: [row("party", "Party")] };
      if (sql.startsWith("UPDATE fundraising_categories")) return { rows: [row("party", "Party", Boolean(params[2]))] };
      return undefined;
    });
    query.mockResolvedValue({ rows: seedRows() });
    const after = await updateCategory("party", { active: false }, "admin:kim@example.com");
    expect(after.active).toBe(false);
    const update = calls.find(([s]) => s.startsWith("UPDATE fundraising_categories"));
    expect(update?.[0]).toMatch(/retired_at = CASE WHEN \$3 THEN NULL ELSE COALESCE\(retired_at, now\(\)\) END/);
    expect(update?.[0]).not.toMatch(/DELETE/);
  });

  it("never hides Other", async () => {
    useClient((sql) => {
      if (sql.startsWith("SELECT key, label, active FROM fundraising_categories WHERE key")) return { rows: [row("other", "Other")] };
      return undefined;
    });
    await expect(updateCategory("other", { active: false }, "admin:kim@example.com")).rejects.toMatchObject({ reason: "other_always_on" });
  });

  it("refuses a name another category has, and one that is not there", async () => {
    useClient((sql) => {
      if (sql.startsWith("SELECT key, label, active FROM fundraising_categories WHERE key")) return { rows: [row("quiz", "Quiz")] };
      if (sql.startsWith("SELECT key FROM fundraising_categories WHERE lower(label)")) return { rows: [{ key: "party" }] };
      return undefined;
    });
    await expect(updateCategory("quiz", { label: "Party" }, "admin:kim@example.com")).rejects.toBeInstanceOf(CategoryError);
    useClient(() => undefined);
    await expect(updateCategory("nope", { label: "Nope" }, "admin:kim@example.com")).rejects.toMatchObject({ reason: "not_found" });
  });
});

// Review fixes for PR #637.
describe("two admins at once", () => {
  it("a rename that loses a race for the name is 'already taken', not a failure", async () => {
    useClient((sql) => {
      if (sql.startsWith("SELECT key, label, active FROM fundraising_categories WHERE key")) return { rows: [row("quiz", "Quiz")] };
      if (sql.startsWith("SELECT key FROM fundraising_categories WHERE lower(label)")) return { rows: [] };
      if (sql.startsWith("UPDATE fundraising_categories")) return Object.assign(new Error("duplicate key value"), { code: "23505" });
      return undefined;
    });
    await expect(updateCategory("quiz", { label: "Party" }, "admin:kim@example.com")).rejects.toMatchObject({ reason: "label_taken" });
  });

  it("so is an add that loses one", async () => {
    useClient((sql) => {
      if (sql.startsWith("SELECT key, label FROM fundraising_categories")) return { rows: seedRows() };
      if (sql.startsWith("INSERT INTO fundraising_categories")) return Object.assign(new Error("duplicate key value"), { code: "23505" });
      return undefined;
    });
    await expect(addCategory("Abseil", "admin:kim@example.com")).rejects.toMatchObject({ reason: "label_taken" });
  });
});

describe("what each read counts", () => {
  it("the list kept for the form never counts the sign ups in each", async () => {
    query.mockResolvedValue({ rows: seedRows() });
    await loadCategories({ fresh: true });
    expect(String(query.mock.calls[0][0])).not.toMatch(/count\(/i);
  });

  it("the admin's list does, when asked", async () => {
    query.mockResolvedValue({ rows: seedRows() });
    await listCategories({ used: true });
    expect(String(query.mock.calls[0][0])).toMatch(/count\(\*\)/);
    query.mockClear();
    await listCategories();
    expect(String(query.mock.calls[0][0])).not.toMatch(/count\(/i);
  });
});
