import { describe, it, expect, vi } from "vitest";

// The sign up tidy, the SQL side, against a fake client that answers by statement (no database): a
// sign up stores its new answers and, for "No, only people you send the link to", is kept off the
// Get involved list; staff correct sport and the T-shirt under the row's lock; staff send a private
// link to choose a size; and the organiser's choice is saved once. Every change is in audit_log.
// Every name here is invented.

vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));
vi.mock("../../src/config", () => ({ config: { NODE_ENV: "test" } }));

import { pool } from "../../src/db/pool";
import { createFundraiser, toRecord } from "../../src/db/fundraisers";
import { chooseTshirtSize, readTshirtLink, saveTshirtLink, setWelcomePack } from "../../src/db/fundraiser-signup-tidy";
import { signUpSchema } from "../../src/fundraising/model";

const fundraiserRow = (over: Record<string, unknown> = {}) => ({
  id: 9, slug: "sw", path: "raising", kind: "walk", title: "Sam's Walk", description: "", event_date: null,
  start_time: null, venue: "", town: "", target_pence: 50000, public: true, status: "new", organiser_name: "Sam Sample",
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

const signUp = (over: Record<string, unknown>) => {
  const r = signUpSchema.safeParse({
    path: "raising", kind: "walk", title: "Sam's Walk", description: "Five miles.", eventDate: "", startTime: "", venue: "",
    town: "", targetPence: 20000, public: true, firstName: "Sam", lastName: "Sample", email: "sam@example.com",
    phone: "07700 900456", instagram: "", facebook: "", socialOk: true, over18: true, sharesWithOther: false,
    wants: { shoutOut: false }, newsletterOk: false,
    postLine1: "1 Example Road", postTown: "Exampleton", postPostcode: "EX1 1EX", ...over,
  });
  if (!r.success) throw new Error(JSON.stringify(r.error.issues));
  return r.data;
};

const audits = (calls: Array<[string, unknown[]]>) => calls.filter(([sql]) => /INSERT INTO audit_log/.test(sql)).map(([, p]) => JSON.stringify(p));

describe("a sign up's new answers", () => {
  function signingUp() {
    return useClient((sql) => {
      if (sql.includes("INSERT INTO fundraisers")) return { rows: [{ id: 21 }] };
      if (sql.includes("FROM fundraisers f WHERE f.id = $1")) return { rows: [fundraiserRow({ id: 21 })] };
      return { rows: [] };
    });
  }

  it("are stored in the sign up's own transaction", async () => {
    const calls = signingUp();
    await createFundraiser(
      signUp({ isSporting: true, tshirtSize: "adult_m", forOrganisation: true, orgName: "Exampleton Bakery", employerMatch: "yes", callTime: "Evenings", childFundraiser: "child", childFirstName: "Ella", childConsent: true }),
    );
    const save = calls.find(([sql]) => /UPDATE fundraisers SET is_sporting/.test(sql))!;
    expect(save).toBeTruthy();
    expect(save[1]).toEqual([true, "adult_m", "Ella", true, "Exampleton Bakery", "yes", null, null, null, "Evenings", false, null, false, 21]);
    const insertAt = calls.findIndex(([sql]) => sql.includes("INSERT INTO fundraisers"));
    const saveAt = calls.findIndex(([sql]) => /UPDATE fundraisers SET is_sporting/.test(sql));
    expect(saveAt).toBeGreaterThan(insertAt);
    expect(calls.some(([sql]) => sql === "COMMIT")).toBe(true);
  });

  it("keeps a page off the Get involved list when they asked", async () => {
    const calls = signingUp();
    await createFundraiser(signUp({ listed: false }));
    const save = calls.find(([sql]) => /UPDATE fundraisers SET is_sporting/.test(sql))!;
    expect(save[0]).toMatch(/off_list_at = CASE WHEN \$13 THEN now\(\) ELSE off_list_at END/);
    expect(save[0]).toMatch(/off_list_by = CASE WHEN \$13 THEN 'organiser' ELSE off_list_by END/);
    expect(save[1][12]).toBe(true);
  });

  it("keeps a date not decided yet", async () => {
    const calls = signingUp();
    await createFundraiser(signUp({ dateTbc: true }));
    const save = calls.find(([sql]) => /UPDATE fundraisers SET is_sporting/.test(sql))!;
    expect(save[0]).toMatch(/date_tbc = \$11, guardian_first_name = \$12/);
    expect(save[1][10]).toBe(true);
    expect(toRecord(fundraiserRow({ date_tbc: true, guardian_first_name: "Sarah" }))).toMatchObject({ dateTbc: true, guardianFirstName: "Sarah" });
    expect(toRecord(fundraiserRow())).toMatchObject({ dateTbc: false, guardianFirstName: null });
  });

  it("records the split check in the sign up's history", async () => {
    const calls = signingUp();
    await createFundraiser(signUp({ sharesWithOther: true, nbccSharePercent: 50, otherCauseName: "Exampleton Food Bank", splitConfirmed: true }));
    expect(audits(calls).some((a) => a.includes('"splitConfirmed":true'))).toBe(true);
  });

  it("are read back, and a row from before reads them as never asked", () => {
    const r = toRecord(
      fundraiser({
        is_sporting: true, tshirt_size: "kids_9_10", tshirt_asked_at: "2026-10-03T09:00:00Z", tshirt_asked_by: "admin:kim@nbcc.test",
        child_first_name: "Ella", child_consent: true, org_name: "Exampleton Bakery", employer_match: "not_sure",
        memory_director_business: "Exampleton Funeral Care", memory_family_contact_name: "Alex", memory_family_contact_email: "alex@example.com", call_time: "Evenings",
      }),
    );
    expect(r).toMatchObject({
      isSporting: true, tshirtSize: "kids_9_10", tshirtAskedAt: "2026-10-03T09:00:00.000Z", tshirtAskedBy: "admin:kim@nbcc.test",
      childFirstName: "Ella", childConsent: true, orgName: "Exampleton Bakery", employerMatch: "not_sure",
      memoryDirectorBusiness: "Exampleton Funeral Care", memoryFamilyContactName: "Alex", memoryFamilyContactEmail: "alex@example.com", callTime: "Evenings",
    });
    expect(toRecord(fundraiserRow())).toMatchObject({ isSporting: null, tshirtSize: null, childFirstName: null, orgName: null, employerMatch: null });
  });
});

function fundraiser(over: Record<string, unknown>) {
  return fundraiserRow(over);
}

describe("staff correcting sport and the t-shirt", () => {
  it("saves both under the row's lock, with what it was in audit_log", async () => {
    const calls = useClient((sql) => {
      if (sql.includes("FOR UPDATE")) return { rows: [fundraiserRow({ is_sporting: false, tshirt_size: null })] };
      if (sql.includes("FROM fundraisers f WHERE f.id = $1")) return { rows: [fundraiserRow({ is_sporting: true, tshirt_size: "adult_l" })] };
      return { rows: [] };
    });
    const after = await setWelcomePack(9, { isSporting: true, tshirtSize: "adult_l" }, "editor:jo@nbcc.test");
    expect(after.tshirtSize).toBe("adult_l");
    const update = calls.find(([sql]) => /UPDATE fundraisers SET is_sporting = \$1, tshirt_size = \$2/.test(sql))!;
    expect(update[1]).toEqual([true, "adult_l", "editor:jo@nbcc.test", 9]);
    const audit = audits(calls)[0];
    expect(audit).toContain("fundraiser.welcome_pack_changed");
    expect(audit).toContain('"was":{"isSporting":false,"tshirtSize":null}');
  });

  it("says when the sign up is not there", async () => {
    useClient(() => ({ rows: [] }));
    await expect(setWelcomePack(404, { isSporting: false, tshirtSize: null }, "admin:kim@nbcc.test")).rejects.toMatchObject({ reason: "not_found" });
  });
});

describe("the private link to choose a T-shirt size", () => {
  it("is kept only as its hash, with when and who sent it", async () => {
    const calls = useClient((sql) => {
      if (sql.includes("FOR UPDATE")) return { rows: [fundraiserRow({ is_sporting: true })] };
      if (sql.includes("FROM fundraisers f WHERE f.id = $1")) return { rows: [fundraiserRow({ is_sporting: true })] };
      return { rows: [] };
    });
    await saveTshirtLink(9, "a".repeat(64), "admin:kim@nbcc.test");
    const update = calls.find(([sql]) => /SET tshirt_token_hash = \$1, tshirt_asked_at = now\(\), tshirt_asked_by = \$2/.test(sql))!;
    expect(update[1]).toEqual(["a".repeat(64), "admin:kim@nbcc.test", 9]);
    expect(audits(calls)[0]).toContain("fundraiser.tshirt_asked");
    expect(audits(calls)[0]).not.toContain("a".repeat(64));
  });

  it("is refused for a sign up that is not a sporting event, or already has a size", async () => {
    useClient((sql) => (sql.includes("FOR UPDATE") ? { rows: [fundraiserRow({ is_sporting: false })] } : { rows: [] }));
    await expect(saveTshirtLink(9, "b".repeat(64), "admin:kim@nbcc.test")).rejects.toMatchObject({ reason: "not_sporting" });
    useClient((sql) => (sql.includes("FOR UPDATE") ? { rows: [fundraiserRow({ is_sporting: true, tshirt_size: "adult_s" })] } : { rows: [] }));
    await expect(saveTshirtLink(9, "b".repeat(64), "admin:kim@nbcc.test")).rejects.toMatchObject({ reason: "has_size" });
  });

  it("is read by its hash, only while it waits for a size", async () => {
    const query = pool.query as unknown as ReturnType<typeof vi.fn>;
    query.mockResolvedValueOnce({ rows: [fundraiserRow({ is_sporting: true, first_name: "Sam", tshirt_asked_at: "2026-10-03T09:00:00Z" })] });
    const found = await readTshirtLink("c".repeat(64));
    expect(found?.firstName).toBe("Sam");
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/tshirt_token_hash = \$1/);
    expect(sql).toMatch(/status <> 'declined'/);
    expect(params).toEqual(["c".repeat(64)]);
  });

  it("saves their choice once, and the link stops working", async () => {
    const calls = useClient((sql) => {
      if (sql.includes("FOR UPDATE")) return { rows: [fundraiserRow({ is_sporting: true, tshirt_asked_at: "2026-10-03T09:00:00Z" })] };
      return { rows: [] };
    });
    expect(await chooseTshirtSize("d".repeat(64), "adult_xl", new Date("2026-10-10T09:00:00Z"))).toBe(true);
    const update = calls.find(([sql]) => /SET tshirt_size = \$1, tshirt_token_hash = NULL/.test(sql))!;
    expect(update[1]).toEqual(["adult_xl", 9]);
    expect(audits(calls)[0]).toContain("fundraiser.tshirt_chosen");
  });

  it("says no to a link not found, or one more than 60 days old", async () => {
    useClient(() => ({ rows: [] }));
    expect(await chooseTshirtSize("e".repeat(64), "adult_xl", new Date())).toBe(false);
    useClient((sql) => (sql.includes("FOR UPDATE") ? { rows: [fundraiserRow({ is_sporting: true, tshirt_asked_at: "2026-07-01T09:00:00Z" })] } : { rows: [] }));
    expect(await chooseTshirtSize("e".repeat(64), "adult_xl", new Date("2026-10-10T09:00:00Z"))).toBe(false);
  });
});

describe("sport and the T-shirt, only for a page of someone's own raising money", () => {
  it.each([
    ["an event", { path: "event" }],
    ["a page in memory of someone", { in_memory: true }],
    ["a team member's page", { team_id: 4 }],
  ])("refuses %s", async (_w, over) => {
    useClient((sql) => (sql.includes("FOR UPDATE") ? { rows: [fundraiserRow({ is_sporting: true, ...over })] } : { rows: [] }));
    await expect(setWelcomePack(9, { isSporting: true, tshirtSize: null }, "admin:kim@nbcc.test")).rejects.toMatchObject({ reason: "not_sporting" });
    await expect(saveTshirtLink(9, "f".repeat(64), "admin:kim@nbcc.test")).rejects.toMatchObject({ reason: "not_sporting" });
  });

  it("never writes the organiser's email into audit_log when asking for a size", async () => {
    const calls = useClient((sql) => (sql.includes("FROM fundraisers f") ? { rows: [fundraiserRow({ is_sporting: true })] } : { rows: [] }));
    await saveTshirtLink(9, "a".repeat(64), "admin:kim@nbcc.test");
    expect(audits(calls)[0]).not.toContain("sam@example.com");
  });
});
