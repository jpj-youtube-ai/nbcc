import { describe, it, expect, vi, beforeEach } from "vitest";

// In memory pages (Jaimie, 2026-10-03): the SQL side, against a fake client that answers by
// statement (no database). A sign up in memory stores who it remembers; the wall reads which
// messages still wait for staff and who asked to let the family know; a giver's tick is kept; and
// staff approve a message, and mark the year on reminder dealt with, each with its audit row. Every
// name here is invented.

vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));
vi.mock("../../src/config", () => ({ config: { NODE_ENV: "test" } }));

import { pool } from "../../src/db/pool";
import { addWallMessage, createFundraiser, toRecord, wallRows } from "../../src/db/fundraisers";
import { approveMemoryMessage, heldMessageCounts, markMemoryYearOnDone, MemoryError } from "../../src/db/fundraiser-memory";
import { signUpSchema } from "../../src/fundraising/model";

const fundraiserRow = (over: Record<string, unknown> = {}) => ({
  id: 9, slug: "ime", path: "raising", kind: "other", title: "In memory of Margaret Exampleton", description: "", event_date: null,
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

beforeEach(() => {
  (pool.query as unknown as ReturnType<typeof vi.fn>).mockReset();
  (pool.connect as unknown as ReturnType<typeof vi.fn>).mockReset();
});

const signUp = (over: Record<string, unknown> = {}) => {
  const r = signUpSchema.safeParse({
    path: "raising", kind: "other", kindOther: "A collection", title: "", description: "Remembering Margaret.", eventDate: "",
    startTime: "", venue: "", town: "Exampleton", targetPence: 20000, public: true, firstName: "Sam", lastName: "Sample",
    email: "sam@example.com", phone: "07700 900456", instagram: "", facebook: "", socialOk: false, over18: true, sharesWithOther: false,
    wants: { shoutOut: false, attend: false }, newsletterOk: false, inMemory: true, memoryName: "Margaret Exampleton",
    memoryDates: "1948 to 2026", memorySetupBy: "friend", memoryPermission: true, memoryShowTarget: false, ...over,
  });
  if (!r.success) throw new Error(JSON.stringify(r.error.issues));
  return r.data;
};

describe("a sign up in memory of someone", () => {
  it("stores who it remembers, the dates, who set it up, the permission and the target choice, in the same transaction", async () => {
    const calls = useClient((sql) => {
      if (sql.includes("INSERT INTO fundraisers")) return { rows: [{ id: 21 }] };
      if (sql.includes("FROM fundraisers f WHERE f.id = $1")) return { rows: [fundraiserRow({ id: 21 })] };
      return { rows: [] };
    });
    await createFundraiser(signUp());
    const update = calls.find(([sql]) => sql.includes("UPDATE fundraisers SET in_memory = true"));
    expect(update).toBeTruthy();
    expect(update?.[1]).toEqual(["Margaret Exampleton", "1948 to 2026", "friend", true, false, 21]);
    const audit = calls.find(([sql]) => sql.includes("INSERT INTO audit_log"));
    expect(JSON.stringify(audit?.[1])).toContain('"inMemory":true');
    const sqls = calls.map(([sql]) => sql);
    expect(sqls.indexOf("COMMIT")).toBeGreaterThan(sqls.findIndex((s) => s.includes("in_memory = true")));
  });

  it("stores nothing more for any other sign up", async () => {
    const calls = useClient((sql) => {
      if (sql.includes("INSERT INTO fundraisers")) return { rows: [{ id: 22 }] };
      if (sql.includes("FROM fundraisers f WHERE f.id = $1")) return { rows: [fundraiserRow({ id: 22 })] };
      return { rows: [] };
    });
    await createFundraiser(signUp({ inMemory: false, title: "Sam's Walk" }));
    expect(calls.some(([sql]) => sql.includes("in_memory = true"))).toBe(false);
  });

  it("is read back, and every row from before reads as not in memory", () => {
    const r = toRecord(
      fundraiserRow({
        in_memory: true, memory_name: "Margaret Exampleton", memory_dates: "1948 to 2026", memory_setup_by: "funeral_director",
        memory_permission: true, memory_show_target: true, memory_reminder_done_at: "2027-10-02T10:00:00Z", memory_reminder_done_by: "admin:kim@example.com",
      }),
    );
    expect(r).toMatchObject({
      inMemory: true, memoryName: "Margaret Exampleton", memoryDates: "1948 to 2026", memorySetupBy: "funeral_director",
      memoryPermission: true, memoryShowTarget: true, memoryReminderDoneAt: "2027-10-02T10:00:00.000Z", memoryReminderDoneBy: "admin:kim@example.com",
    });
    expect(toRecord(fundraiserRow())).toMatchObject({ inMemory: false, memoryName: null, memorySetupBy: null, memoryShowTarget: null });
  });
});

describe("the wall of an in memory page", () => {
  it("reads which messages still wait for staff, and who asked to let the family know", async () => {
    (pool.query as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      rows: [
        { id: 3, full_name: "Alex Example", anonymous: false, show_name: true, show_amount: true, amount_pence: 2000, refunded_amount_pence: 0,
          supporter_message: "Thinking of you.", message_hidden: false, created_at: "2026-10-02T10:00:00Z", paid_in_by_organiser: false,
          gift_aid: false, message_held: true, family_notify: true },
      ],
    });
    const rows = await wallRows(9);
    const sql = String((pool.query as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(sql).toContain("f.in_memory AND d.message_approved_at IS NULL");
    expect(sql).toContain("d.family_notify");
    expect(rows[0]).toMatchObject({ held: true, familyNotify: true });
  });

  it("keeps a giver's Let the family know tick with their message, in the same transaction", async () => {
    const calls = useClient((sql) => {
      if (sql.includes("WHERE d.stripe_session_id = $1")) {
        return {
          rows: [{ id: 5, fundraiser_id: 9, paid_in_by_organiser: false, payment_status: "paid", supporter_message: null, wall_added_at: null,
            full_name: "Alex Example", anonymous: false, amount_pence: 2000, refunded_amount_pence: 0, gift_aid: false, created_at: "2026-10-02T10:00:00Z" }],
        };
      }
      return { rows: [] };
    });
    await addWallMessage("cs_test_1", 9, { message: "Thinking of you.", showName: true, showAmount: false, familyNotify: true });
    const update = calls.find(([sql]) => sql.startsWith("UPDATE donations SET supporter_message"));
    expect(update?.[1]).toEqual(["Thinking of you.", true, false, 5]);
    const tick = calls.find(([sql]) => sql.startsWith("UPDATE donations SET family_notify = true"));
    expect(tick?.[1]).toEqual([5]);
    const sqls = calls.map(([sql]) => sql);
    expect(sqls.indexOf("COMMIT")).toBeGreaterThan(sqls.indexOf(tick?.[0] as string));
  });
});

describe("staff on an in memory page", () => {
  it("approve a message: it shows, and the audit says who", async () => {
    const calls = useClient((sql) => (sql.startsWith("UPDATE donations SET message_approved_at") ? { rows: [{ id: 5 }] } : { rows: [] }));
    await approveMemoryMessage(9, 5, "admin:kim@example.com");
    const update = calls.find(([sql]) => sql.startsWith("UPDATE donations SET message_approved_at"));
    expect(update?.[0]).toContain("message_hidden = false");
    expect(update?.[0]).toContain("fundraiser_id = $3");
    expect(update?.[1]).toEqual(["admin:kim@example.com", 5, 9]);
    expect(calls.find(([sql]) => sql.includes("INSERT INTO audit_log"))?.[1]).toEqual([
      "admin:kim@example.com", "fundraiser.message_approved", "fundraiser", 9, { donationId: 5 },
    ]);
  });

  it("cannot approve a message on another page", async () => {
    useClient(() => ({ rows: [] }));
    await expect(approveMemoryMessage(9, 6, "admin:kim@example.com")).rejects.toBeInstanceOf(MemoryError);
  });

  it("count the messages still to check on each in memory page", async () => {
    (pool.query as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ rows: [{ fundraiser_id: 9, n: "2" }] });
    expect(await heldMessageCounts()).toEqual({ 9: 2 });
    const sql = String((pool.query as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(sql).toContain("f.in_memory");
    expect(sql).toContain("d.message_approved_at IS NULL");
    expect(sql).toContain("NOT d.message_hidden");
  });

  it("mark the year on reminder dealt with, once, with its audit row", async () => {
    const calls = useClient((sql) => (sql.startsWith("UPDATE fundraisers SET memory_reminder_done_at") ? { rows: [{ id: 9 }] } : { rows: [] }));
    await markMemoryYearOnDone(9, "admin:kim@example.com", "Rang the family, they are well.");
    const update = calls.find(([sql]) => sql.startsWith("UPDATE fundraisers SET memory_reminder_done_at"));
    expect(update?.[0]).toContain("in_memory");
    expect(update?.[0]).toContain("memory_reminder_done_at IS NULL");
    expect(calls.find(([sql]) => sql.includes("INSERT INTO audit_log"))?.[1]).toEqual([
      "admin:kim@example.com", "fundraiser.memory_year_on_done", "fundraiser", 9, { note: "Rang the family, they are well." },
    ]);
  });

  it("refuses the reminder on a page that is not in memory, or one already dealt with", async () => {
    useClient(() => ({ rows: [] }));
    await expect(markMemoryYearOnDone(9, "admin:kim@example.com", "")).rejects.toBeInstanceOf(MemoryError);
  });
});

describe("thanking givers on an in memory page", () => {
  it("only those who asked to let the family know: any other gift picked is refused, and nothing is stored", async () => {
    const { createThanks } = await import("../../src/db/fundraiser-thanks");
    const calls = useClient((sql) => {
      if (sql.startsWith("SELECT id, organiser_email, status FROM fundraisers")) return { rows: [{ id: 9, organiser_email: "sam@example.com", status: "approved" }] };
      if (sql.includes("count(*) AS n FROM fundraiser_thanks")) return { rows: [{ n: "0" }] };
      if (sql.includes("AND d.amount_pence - d.refunded_amount_pence > 0")) return { rows: [{ id: 5 }, { id: 6 }] };
      if (sql.includes("NOT d.family_notify")) return { rows: [{ id: 6 }] };
      return { rows: [] };
    });
    expect(await createThanks(9, "sam@example.com", "Thank you.", [5, 6])).toEqual({ verdict: "bad_gift" });
    const check = calls.find(([sql]) => sql.includes("NOT d.family_notify"));
    expect(check?.[0]).toContain("f.in_memory");
    expect(calls.some(([sql]) => sql.includes("INSERT INTO fundraiser_thanks"))).toBe(false);
  });
});

describe("staff correcting the in memory details", () => {
  it("are saved under the row's lock with what they were and are now in the audit", async () => {
    const { setFundraiserMemory } = await import("../../src/db/fundraiser-memory");
    const calls = useClient((sql) => {
      if (sql.startsWith("SELECT memory_name")) {
        return { rows: [{ in_memory: true, memory_name: "Margret Exampleton", memory_dates: null, memory_setup_by: "friend", memory_show_target: false }] };
      }
      return { rows: [] };
    });
    await setFundraiserMemory(9, { memoryName: "Margaret Exampleton", memoryDates: "1948 to 2026", memorySetupBy: "family", memoryShowTarget: true }, "admin:kim@example.com");
    expect(calls.find(([sql]) => sql.startsWith("SELECT memory_name"))?.[0]).toContain("FOR UPDATE");
    const update = calls.find(([sql]) => sql.startsWith("UPDATE fundraisers SET memory_name"));
    expect(update?.[1]).toEqual(["Margaret Exampleton", "1948 to 2026", "family", true, "admin:kim@example.com", 9]);
    const audit = calls.find(([sql]) => sql.includes("INSERT INTO audit_log"))?.[1] as unknown[];
    expect(audit.slice(0, 4)).toEqual(["admin:kim@example.com", "fundraiser.memory_changed", "fundraiser", 9]);
    expect(audit[4]).toMatchObject({ was: { memoryName: "Margret Exampleton" }, now: { memoryName: "Margaret Exampleton", memorySetupBy: "family" } });
  });

  it("are refused on a page that is not in memory", async () => {
    const { setFundraiserMemory } = await import("../../src/db/fundraiser-memory");
    useClient((sql) => (sql.startsWith("SELECT memory_name") ? { rows: [{ in_memory: false }] } : { rows: [] }));
    await expect(
      setFundraiserMemory(9, { memoryName: "Jean", memoryDates: null, memorySetupBy: "friend", memoryShowTarget: null }, "admin:kim@example.com"),
    ).rejects.toBeInstanceOf(MemoryError);
  });
});

describe("review: following a name correction through", () => {
  it("renames a page still called In memory of the old name, in the same transaction, and audits it", async () => {
    const { setFundraiserMemory } = await import("../../src/db/fundraiser-memory");
    const calls = useClient((sql) =>
      sql.startsWith("SELECT memory_name")
        ? { rows: [{ in_memory: true, memory_name: "Margret Exampleton", title: "In memory of Margret Exampleton", memory_dates: null, memory_setup_by: "friend", memory_show_target: null }] }
        : { rows: [] },
    );
    await setFundraiserMemory(9, { memoryName: "Margaret Exampleton", memoryDates: null, memorySetupBy: "friend", memoryShowTarget: null }, "admin:kim@example.com");
    const rename = calls.find(([sql]) => sql.startsWith("UPDATE fundraisers SET title"));
    expect(rename?.[1]).toEqual(["In memory of Margaret Exampleton", 9]);
    const audit = calls.find(([sql]) => sql.includes("INSERT INTO audit_log"))?.[1] as unknown[];
    expect(audit[4]).toMatchObject({ title: { was: "In memory of Margret Exampleton", now: "In memory of Margaret Exampleton" } });
    const sqls = calls.map(([sql]) => sql);
    expect(sqls.indexOf("COMMIT")).toBeGreaterThan(sqls.indexOf(rename?.[0] as string));
  });

  it("leaves a name the family gave the page themselves", async () => {
    const { setFundraiserMemory } = await import("../../src/db/fundraiser-memory");
    const calls = useClient((sql) =>
      sql.startsWith("SELECT memory_name") ? { rows: [{ in_memory: true, memory_name: "Margret Exampleton", title: "Margaret's Christmas Fund" }] } : { rows: [] },
    );
    await setFundraiserMemory(9, { memoryName: "Margaret Exampleton", memoryDates: null, memorySetupBy: "friend", memoryShowTarget: null }, "admin:kim@example.com");
    expect(calls.some(([sql]) => sql.startsWith("UPDATE fundraisers SET title"))).toBe(false);
  });
});

describe("review: approving a message", () => {
  it("works only on an in memory page", async () => {
    const calls = useClient((sql) => (sql.startsWith("UPDATE donations SET message_approved_at") ? { rows: [{ id: 5 }] } : { rows: [] }));
    await approveMemoryMessage(9, 5, "admin:kim@example.com");
    expect(calls.find(([sql]) => sql.startsWith("UPDATE donations SET message_approved_at"))?.[0]).toContain(
      "fundraiser_id IN (SELECT id FROM fundraisers WHERE in_memory)",
    );
  });
});
