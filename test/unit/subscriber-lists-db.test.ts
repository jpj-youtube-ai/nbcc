import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-259: the audiences store. Pool mocked at the boundary (the house style). The contracts that
// carry the feature's promises:
//   - membership is one-per-address-per-list, case-insensitively;
//   - an unsubscribe is a TOMBSTONE (unsubscribed_at), never a delete — it is consent history, and it
//     is what stops an import silently re-subscribing someone who opted out;
//   - reviving a tombstone is an explicit, per-source decision: the person themselves (footer) may;
//     a spreadsheet (import) may NOT.

const { queryMock, connect } = vi.hoisted(() => ({ queryMock: vi.fn(), connect: vi.fn() }));
vi.mock("../../src/db/pool", () => ({ pool: { query: queryMock, connect } }));

import {
  slugifyListName,
  createSubscriberList,
  DuplicateListError,
  addListSubscriber,
  removeListMember,
  unsubscribeListMember,
  listSubscriberLists,
  listArchivedSubscriberLists,
  archiveSubscriberList,
  restoreSubscriberList,
  BuiltInListError,
} from "../../src/db/subscriber-lists";

const sqlOf = (re: RegExp): string => queryMock.mock.calls.map((c) => String(c[0])).find((s) => re.test(s)) ?? "";
const paramsOf = (re: RegExp): unknown[] => (queryMock.mock.calls.find((c) => re.test(String(c[0]))) || [])[1] as unknown[];

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockResolvedValue({ rows: [], rowCount: 0 });
});

describe("slugifyListName (pure)", () => {
  it("makes a stable programmatic handle from a human name", () => {
    expect(slugifyListName("Street Team")).toBe("street-team");
    expect(slugifyListName("  Referrers & Partners!  ")).toBe("referrers-partners");
  });
  it("rejects a name that slugifies to nothing", () => {
    expect(() => slugifyListName("!!!")).toThrow();
  });
});

describe("createSubscriberList", () => {
  it("turns a duplicate slug into a domain error the route can 409", async () => {
    queryMock.mockRejectedValueOnce(Object.assign(new Error("dupe"), { code: "23505" }));
    await expect(createSubscriberList("Volunteers")).rejects.toBeInstanceOf(DuplicateListError);
  });
});

describe("addListSubscriber", () => {
  const person = { name: "Ann", email: "Ann@Example.com", phone: null };

  it("adds a new member, storing the address lowercased", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // no existing membership
      .mockResolvedValueOnce({ rows: [{ id: 9 }], rowCount: 1 }); // insert
    const outcome = await addListSubscriber(2, person, "admin", { revive: true });
    expect(outcome).toBe("added");
    expect(paramsOf(/insert\s+into\s+list_subscribers/i)).toContain("ann@example.com");
  });

  it("reports an already-active member instead of duplicating them", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: 9, unsubscribed_at: null }], rowCount: 1 });
    await expect(addListSubscriber(2, person, "admin", { revive: true })).resolves.toBe("exists");
  });

  it("revives a tombstoned member ONLY when the source may (footer/admin), stamping fresh consent", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ id: 9, unsubscribed_at: "2026-01-01" }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // the revive update
    const outcome = await addListSubscriber(2, person, "footer", { revive: true });
    expect(outcome).toBe("resubscribed");
    const revive = sqlOf(/update\s+list_subscribers/i);
    expect(revive).toMatch(/unsubscribed_at\s*=\s*null/i);
    expect(revive).toMatch(/consented_at\s*=\s*now\(\)/i);
  });

  it("NEVER revives from an import — a spreadsheet cannot overrule someone's opt-out", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: 9, unsubscribed_at: "2026-01-01" }], rowCount: 1 });
    const outcome = await addListSubscriber(2, person, "import", { revive: false });
    expect(outcome).toBe("previously_unsubscribed");
    expect(sqlOf(/update\s+list_subscribers/i)).toBe(""); // no revive statement at all
  });
});

describe("tombstones, not deletes", () => {
  it("removing a member sets unsubscribed_at — the row and its consent history survive", async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    await expect(removeListMember(2, 9)).resolves.toBe(true);
    const sql = sqlOf(/update\s+list_subscribers/i);
    expect(sql).toMatch(/unsubscribed_at\s*=\s*now\(\)/i);
    expect(sqlOf(/delete\s+from\s+list_subscribers/i)).toBe("");
  });

  it("a public unsubscribe keeps the FIRST opt-out date on a repeat click", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ email: "ann@example.com" }], rowCount: 1 });
    const row = await unsubscribeListMember(9);
    expect(row).toEqual({ email: "ann@example.com" });
    expect(sqlOf(/update\s+list_subscribers/i)).toMatch(/coalesce\(unsubscribed_at,\s*now\(\)\)/i);
  });
});

// TASK-270: audiences gained a KIND and an archive tombstone. The promises under test:
//   - the member count tells the TRUTH for the dynamic audiences (it used to count stored rows only,
//     so the picker said "Newsletter (3)" while the send reached every consenting donor);
//   - archiving hides an audience from the pickers but never deletes it — consent history survives;
//   - the built-in audiences (Newsletter, Donors) cannot be archived out from under the send model.
describe("audience kinds and archiving (TASK-270)", () => {
  it("counts the LIVE donor audience for donors/everyone, not just stored rows", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ id: 1, slug: "newsletter", name: "Newsletter", kind: "everyone", member_count: "412" }],
    });
    const lists = await listSubscriberLists();
    expect(lists).toEqual([
      { id: 1, slug: "newsletter", name: "Newsletter", kind: "everyone", memberCount: 412 },
    ]);
    const sql = sqlOf(/from\s+subscriber_lists/i);
    // the count must consult donors for the dynamic kinds, and union them for 'everyone'
    expect(sql).toMatch(/email_consent\s*=\s*true/i);
    expect(sql).toMatch(/union/i);
  });

  it("hides archived audiences from the pickers, and lists them separately", async () => {
    await listSubscriberLists();
    expect(sqlOf(/where\s+l\.archived_at\s+is\s+null/i)).toBeTruthy();
    queryMock.mockReset();
    queryMock.mockResolvedValue({ rows: [], rowCount: 0 });
    await listArchivedSubscriberLists();
    expect(sqlOf(/where\s+l\.archived_at\s+is\s+not\s+null/i)).toBeTruthy();
  });

  it("archives as a TOMBSTONE — it stamps archived_at, it never deletes the audience", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ id: 4, slug: "volunteers", name: "Volunteers", kind: "manual", archived_at: null }],
    });
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    expect(await archiveSubscriberList(4)).toBe(true);
    expect(sqlOf(/update\s+subscriber_lists\s+set\s+archived_at\s*=\s*now\(\)/i)).toBeTruthy();
    expect(sqlOf(/delete\s+from\s+subscriber_lists/i)).toBe(""); // never a delete
  });

  it("refuses to archive a built-in audience — the send model is built on them", async () => {
    for (const kind of ["everyone", "donors"] as const) {
      queryMock.mockReset();
      queryMock.mockResolvedValueOnce({ rows: [{ id: 1, slug: kind, name: "X", kind, archived_at: null }] });
      await expect(archiveSubscriberList(1)).rejects.toBeInstanceOf(BuiltInListError);
      expect(sqlOf(/set\s+archived_at/i)).toBe(""); // nothing was written
    }
  });

  it("returns false for an unknown audience rather than pretending it archived one", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    expect(await archiveSubscriberList(999)).toBe(false);
  });

  it("restores an archived audience by clearing the tombstone", async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    expect(await restoreSubscriberList(4)).toBe(true);
    expect(sqlOf(/set\s+archived_at\s*=\s*null/i)).toMatch(/archived_at\s+is\s+not\s+null/i);
  });
});
