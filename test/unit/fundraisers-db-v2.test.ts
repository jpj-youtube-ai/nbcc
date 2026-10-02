import { describe, it, expect, vi } from "vitest";

// TASK-511: the SQL side of the sign up form, round two, and short page links, against a fake client
// that answers by statement (no database). A new sign up gets its initials as its address, the next
// number on a clash, and never an address a page has had before; a staff change of address keeps the
// old one, so it can answer with a 301; and the whole name follows its two parts. Every name and
// address here is invented.

vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));
vi.mock("../../src/config", () => ({ config: { NODE_ENV: "test" } }));

import { pool } from "../../src/db/pool";
import { createFundraiser, patchAssignments, patchFundraiser, toRecord } from "../../src/db/fundraisers";
import { currentSlugFor } from "../../src/db/fundraiser-slugs";
import { signUpSchema } from "../../src/fundraising/model";

const fundraiserRow = (over: Record<string, unknown> = {}) => ({
  id: 9, slug: "sams-walk", path: "raising", kind: "run_walk", title: "Sam's Walk", description: "", event_date: null,
  start_time: null, venue: "", town: "", target_pence: 50000, public: true, status: "approved", organiser_name: "Sam Sample",
  organiser_email: "sam@example.com", organiser_phone: "07700 900456", social_link: null, social_ok: false, wants: {},
  post_address: null, newsletter_ok: false, image_src: null, declined_reason: null, created_at: "2026-10-02T10:00:00Z",
  approved_at: null, approved_by: null, updated_at: "2026-10-02T10:00:00Z", updated_by: null, ...over,
});

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

const newSignUp = () => {
  const r = signUpSchema.safeParse({
    path: "raising", kind: "other", kindOther: "A sponsored silence", title: "Sam's Santa Dash", description: "Five kilometres.",
    eventDate: "", startTime: "", venue: "", town: "Exampleton", targetPence: 20000, public: true, firstName: "Sam",
    lastName: "Sample", email: "sam@example.com", phone: "07700 900456", instagram: "@sam.runs", facebook: "",
    socialOk: true, wants: { qrCount: 25, shoutOut: true, attend: false }, postLine1: "1 Example Road", postTown: "Exampleton",
    postPostcode: "EX1 1EX", newsletterOk: false,
  });
  if (!r.success) throw new Error(JSON.stringify(r.error.issues));
  return r.data;
};

describe("a new sign up's address", () => {
  it("is the initials of its name, with every new answer stored in its own column", async () => {
    let inserted: { sql: string; params: unknown[] } | null = null;
    const calls = useClient((sql, params) => {
      if (sql.startsWith("SELECT slug FROM fundraisers")) return { rows: [] };
      if (sql.includes("INSERT INTO fundraisers")) {
        inserted = { sql, params };
        return { rows: [{ id: 21 }] };
      }
      if (sql.includes("FROM fundraisers f WHERE f.id = $1")) return { rows: [fundraiserRow({ id: 21, slug: "ssd", status: "new" })] };
      return { rows: [] };
    });
    const made = await createFundraiser(newSignUp());
    expect(made.slug).toBe("ssd");
    const got = inserted as unknown as { sql: string; params: unknown[] };
    expect(got.params[0]).toBe("ssd");
    for (const col of ["first_name", "last_name", "kind_other", "instagram", "facebook"]) expect(got.sql).toContain(col);
    for (const v of ["Sam", "Sample", "A sponsored silence", "https://www.instagram.com/sam.runs", "Sam Sample"]) expect(got.params).toContain(v);
    expect(got.params).toContain(JSON.stringify({ ...newSignUp().wants }));
    // What is taken includes every address a page has ever had.
    const look = calls.find(([s]) => s.startsWith("SELECT slug FROM fundraisers"));
    expect(look?.[0]).toContain("fundraiser_slug_history");
    expect(look?.[1]).toEqual(["^ssd[0-9]*$"]);
  });

  it("takes the next number when the initials are taken now, or were ever a page's", async () => {
    const calls = useClient((sql) => {
      if (sql.startsWith("SELECT slug FROM fundraisers")) return { rows: [{ slug: "ssd" }, { slug: "ssd2" }] };
      if (sql.includes("INSERT INTO fundraisers")) return { rows: [{ id: 22 }] };
      if (sql.includes("FROM fundraisers f WHERE f.id = $1")) return { rows: [fundraiserRow({ id: 22, slug: "ssd3" })] };
      return { rows: [] };
    });
    await createFundraiser(newSignUp());
    const insert = calls.find(([s]) => s.includes("INSERT INTO fundraisers"));
    expect(insert?.[1][0]).toBe("ssd3");
  });
});

describe("staff changing a page's address", () => {
  const lockAnd = (row: Record<string, unknown>, extra: Answer = () => undefined) =>
    useClient((sql, params) => {
      if (sql.includes("FOR UPDATE") && sql.includes("FROM fundraisers f")) return { rows: [row] };
      if (sql.includes("FROM fundraisers f WHERE f.id = $1")) return { rows: [row] };
      return extra(sql, params);
    });

  it("keeps the old address, so it can send people on to the new one", async () => {
    const calls = lockAnd(fundraiserRow());
    await patchFundraiser(9, { slug: "sw" }, "admin:kim@example.com");
    const kept = calls.find(([s]) => s.startsWith("INSERT INTO fundraiser_slug_history"));
    expect(kept?.[1]).toEqual(["sams-walk", 9, "admin:kim@example.com"]);
    const update = calls.findIndex(([s]) => s.startsWith("UPDATE fundraisers"));
    expect(update).toBeGreaterThan(-1);
  });

  it("refuses an address another page used to have, changing nothing", async () => {
    const calls = lockAnd(fundraiserRow(), (sql) => {
      if (sql.startsWith("SELECT fundraiser_id FROM fundraiser_slug_history")) return { rows: [{ fundraiser_id: 4 }] };
      return undefined;
    });
    await expect(patchFundraiser(9, { slug: "old-one" }, "admin:kim@example.com")).rejects.toMatchObject({ reason: "slug_taken" });
    expect(calls.some(([s]) => s.startsWith("UPDATE fundraisers"))).toBe(false);
    expect(calls.some(([s]) => s.startsWith("INSERT INTO fundraiser_slug_history"))).toBe(false);
  });

  it("lets a page take back an address it had before", async () => {
    const calls = lockAnd(fundraiserRow({ slug: "sw" }), (sql) => {
      if (sql.startsWith("SELECT fundraiser_id FROM fundraiser_slug_history")) return { rows: [{ fundraiser_id: 9 }] };
      return undefined;
    });
    await patchFundraiser(9, { slug: "sams-walk" }, "admin:kim@example.com");
    expect(calls.find(([s]) => s.startsWith("DELETE FROM fundraiser_slug_history"))?.[1]).toEqual(["sams-walk", 9]);
    expect(calls.find(([s]) => s.startsWith("INSERT INTO fundraiser_slug_history"))?.[1]).toEqual(["sw", 9, "admin:kim@example.com"]);
  });

  it("keeps no history when the address is saved unchanged, or not changed at all", async () => {
    const calls = lockAnd(fundraiserRow());
    await patchFundraiser(9, { slug: "sams-walk", title: "Sam's Long Walk" }, "admin:kim@example.com");
    expect(calls.some(([s]) => s.includes("fundraiser_slug_history"))).toBe(false);
  });
});

describe("the whole name, after a staff change", () => {
  it("follows a new first name, for everything that reads it", async () => {
    const row = fundraiserRow({ first_name: "Sam", last_name: "Sample" });
    const calls = useClient((sql) => {
      if (sql.includes("FROM fundraisers f WHERE f.id = $1")) return { rows: [row] };
      return undefined;
    });
    await patchFundraiser(9, { firstName: "Samantha" }, "admin:kim@example.com");
    const update = calls.find(([s]) => s.startsWith("UPDATE fundraisers"));
    expect(update?.[0]).toContain("first_name = $1");
    expect(update?.[0]).toContain("organiser_name = $2");
    expect(update?.[1].slice(0, 2)).toEqual(["Samantha", "Samantha Sample"]);
  });
});

describe("printed QR codes, after a staff change", () => {
  it("are kept as stored when a change to what they would like does not send them", async () => {
    const row = fundraiserRow({ wants: { posterCount: 1, qrCount: 30 } });
    const calls = useClient((sql) => (sql.includes("FROM fundraisers f WHERE f.id = $1") ? { rows: [row] } : undefined));
    await patchFundraiser(
      9,
      { wants: { posterCount: 2, leafletCount: 0, bucketCount: 0, tinCount: 0, leaflets: 0, buckets: 0, shoutOut: false, attend: false } },
      "admin:kim@example.com",
    );
    const update = calls.find(([s]) => s.startsWith("UPDATE fundraisers"));
    expect(JSON.parse(String(update?.[1][0]))).toMatchObject({ posterCount: 2, qrCount: 30 });
  });
});

describe("the new columns", () => {
  it("are read, and empty on a sign up from before", () => {
    const r = toRecord(fundraiserRow({ first_name: "Sam", last_name: "Sample", kind_other: "A silence", instagram: "https://www.instagram.com/s", facebook: null }));
    expect(r).toMatchObject({ firstName: "Sam", lastName: "Sample", kindOther: "A silence", instagram: "https://www.instagram.com/s", facebook: null });
    expect(toRecord(fundraiserRow())).toMatchObject({ firstName: null, lastName: null, kindOther: null, instagram: null, facebook: null });
    expect(toRecord(fundraiserRow({ wants: { qrCount: 12 } })).wants.qrCount).toBe(12);
    expect(toRecord(fundraiserRow()).wants.qrCount).toBe(0);
  });

  it("are changed through their own columns", () => {
    const { sets } = patchAssignments({ firstName: "A", lastName: "B", kindOther: "C", instagram: null, facebook: "https://www.facebook.com/x" });
    expect(sets).toEqual(["first_name = $1", "last_name = $2", "kind_other = $3", "instagram = $4", "facebook = $5"]);
  });
});

describe("an old address", () => {
  it("is looked up to the page's address now", async () => {
    const query = pool.query as unknown as ReturnType<typeof vi.fn>;
    query.mockResolvedValueOnce({ rows: [{ slug: "ssd" }] });
    expect(await currentSlugFor("sams-santa-dash")).toBe("ssd");
    expect(String(query.mock.calls.at(-1)?.[0])).toContain("fundraiser_slug_history");
    expect(query.mock.calls.at(-1)?.[1]).toEqual(["sams-santa-dash"]);
    query.mockResolvedValueOnce({ rows: [] });
    expect(await currentSlugFor("nobody")).toBeNull();
  });
});
