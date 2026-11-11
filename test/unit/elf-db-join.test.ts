import { describe, it, expect, vi, beforeEach } from "vitest";

// NBCC Elf Detective School: saving an enrolment before the payment. Every family here is invented.

const { clientQuery, release } = vi.hoisted(() => ({ clientQuery: vi.fn(), release: vi.fn() }));
vi.mock("../../src/db/pool", () => ({
  pool: { query: vi.fn(), connect: async () => ({ query: clientQuery, release }) },
}));

import { createPendingJoin } from "../../src/db/elf";
import type { JoinBody } from "../../src/elf/join";

const BODY: JoinBody = {
  grownUpName: "Sam Example",
  email: "sam@example.com",
  mobile: "+447700900123",
  detectives: [
    { firstName: "Ruby", surname: "Tinselfoot" },
    { firstName: "Leo", surname: "Frostwhistle" },
  ],
  entryPence: 1000,
  donationPence: 0,
  giftAid: false,
  coverFee: false,
  newsletter: false,
  agreed: true,
};

/** A pretend database: one family table keyed by email, ids counting up. */
function fakeDb(existing: { email: string; active: boolean }[] = []) {
  const families = new Map(existing.map((f, i) => [f.email, { id: i + 1, active: f.active }]));
  let nextFamily = existing.length + 1;
  let nextDetective = 100;
  clientQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (/INSERT INTO elf_families/.test(sql)) {
      const email = String(params[0]);
      if (!families.has(email)) families.set(email, { id: nextFamily++, active: false });
      const f = families.get(email)!;
      return { rows: [{ id: f.id, active: f.active }] };
    }
    if (/INSERT INTO elf_detectives/.test(sql)) return { rows: [{ id: nextDetective++ }] };
    if (/INSERT INTO elf_orders/.test(sql)) return { rows: [{ id: 9 }] };
    return { rows: [] };
  });
  return families;
}

beforeEach(() => {
  clientQuery.mockReset();
  release.mockReset();
});

describe("saving an enrolment before it is paid", () => {
  it("keeps one family per email, however it is typed", async () => {
    fakeDb();
    const a = await createPendingJoin({ body: BODY, browserTokenHash: "a".repeat(64), feeCoverPence: 0 });
    const b = await createPendingJoin({ body: { ...BODY, email: "sam@example.com" }, browserTokenHash: "b".repeat(64), feeCoverPence: 0 });
    expect(a !== "sign-in-first" && b !== "sign-in-first" && a.familyId === b.familyId).toBe(true);
  });

  it("adds the detectives, not yet active, and a pending order for them", async () => {
    fakeDb();
    const r = await createPendingJoin({ body: BODY, browserTokenHash: "a".repeat(64), feeCoverPence: 39 });
    if (r === "sign-in-first") throw new Error("unexpected");
    expect(r.detectiveIds).toEqual([100, 101]);
    expect(r.reference).toMatch(/^EDS-[A-Z0-9]{6}$/);
    const order = clientQuery.mock.calls.find((c) => /INSERT INTO elf_orders/.test(String(c[0])))!;
    expect(order[1]).toEqual(expect.arrayContaining([r.reference, r.familyId, [100, 101], 1000, 0, 39, false, null, "a".repeat(64)]));
    const sqls = clientQuery.mock.calls.map((c) => String(c[0]));
    expect(sqls[0]).toBe("BEGIN");
    expect(sqls).toContain("COMMIT");
    expect(release).toHaveBeenCalled();
  });

  it("asks a family that already has detectives to sign in first, and saves nothing", async () => {
    fakeDb([{ email: "sam@example.com", active: true }]);
    expect(await createPendingJoin({ body: BODY, browserTokenHash: "a".repeat(64), feeCoverPence: 0 })).toBe("sign-in-first");
    const sqls = clientQuery.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => /INSERT INTO elf_detectives|INSERT INTO elf_orders/.test(s))).toBe(false);
    expect(sqls).toContain("ROLLBACK");
  });

  it("lets a signed in family add detectives to itself", async () => {
    fakeDb([{ email: "sam@example.com", active: true }]);
    const r = await createPendingJoin({ body: BODY, browserTokenHash: "a".repeat(64), feeCoverPence: 0, familyId: 1 });
    expect(r !== "sign-in-first" && r.familyId).toBe(1);
  });

  it("keeps the Gift Aid declaration with the order only when there is Gift Aid", async () => {
    fakeDb();
    const declaration = { firstName: "Sam", lastName: "Example", houseNameNumber: "12", address: "Holly Lane, Troon", postcode: "KA10 6AA", nonUk: false };
    await createPendingJoin({ body: { ...BODY, donationPence: 500, giftAid: true, declaration }, browserTokenHash: "a".repeat(64), feeCoverPence: 0 });
    const order = clientQuery.mock.calls.find((c) => /INSERT INTO elf_orders/.test(String(c[0])))!;
    expect(order[1]).toContain(JSON.stringify(declaration));
  });
});

// TASK-613: the grown up's mobile, kept with the family so a head elf can ring the grand prize winner.
describe("the grown up's mobile number", () => {
  const familyWrite = () => clientQuery.mock.calls.find((c) => /elf_families/.test(String(c[0])) && !/SELECT/.test(String(c[0])))!;

  it("is kept with a new family, as parseJoin gives it", async () => {
    fakeDb();
    await createPendingJoin({ body: BODY, browserTokenHash: "a".repeat(64), feeCoverPence: 0 });
    const [sql, params] = familyWrite();
    expect(String(sql)).toMatch(/INSERT INTO elf_families \(email, grown_up_name, newsletter, mobile\)/);
    expect(params).toEqual(["sam@example.com", "Sam Example", false, "+447700900123"]);
  });

  it("is the newest one typed while the family has not paid yet, and stays as it was once it has", async () => {
    fakeDb();
    await createPendingJoin({ body: BODY, browserTokenHash: "a".repeat(64), feeCoverPence: 0 });
    expect(String(familyWrite()[0])).toMatch(/mobile = CASE WHEN elf_families\.active THEN elf_families\.mobile ELSE EXCLUDED\.mobile END/);
  });

  it("is kept for a signed in family adding detectives: a family from before it was asked gets one", async () => {
    fakeDb([{ email: "sam@example.com", active: true }]);
    await createPendingJoin({ body: { ...BODY, mobile: "+447700900045" }, browserTokenHash: "a".repeat(64), feeCoverPence: 0, familyId: 1 });
    const update = clientQuery.mock.calls.find((c) => /UPDATE elf_families SET mobile/.test(String(c[0])))!;
    expect(update[1]).toEqual([1, "+447700900045"]);
    const sqls = clientQuery.mock.calls.map((c) => String(c[0]));
    expect(sqls.indexOf(String(update[0]))).toBeLessThan(sqls.indexOf("COMMIT"));
  });
});
