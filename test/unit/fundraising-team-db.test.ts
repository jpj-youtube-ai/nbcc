import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-503: the SQL behind the team's tools, checked against a mocked pool (no database): invites
// kept by their token's hash, used once and only in date; calls; taking a fundraiser off Get
// involved; and the Monday summary's list and its once a week mark. Every name and address is
// invented.

const { query, connect } = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn() }));
vi.mock("../../src/db/pool", () => ({ pool: { query, connect } }));
vi.mock("../../src/config", () => ({ config: { NODE_ENV: "test" } }));

import {
  claimSummaryWeek,
  countRecentInvites,
  createInvite,
  findInviteByHash,
  getSigner,
  getSummarySettings,
  listFundraiserCalls,
  listOpenInvites,
  listSigners,
  markInviteUsed,
  readSummaryInputs,
  recordFundraiserCall,
  releaseSummaryWeek,
  removeInvite,
  resendInvite,
  saveSummaryRecipients,
  setOffList,
  TeamError,
} from "../../src/db/fundraising-team";
import { toRecord } from "../../src/db/fundraisers";

// A client for the transactions: answers by statement, and records every one.
type Answer = (sql: string, params: unknown[]) => unknown;
function useClient(answer: Answer) {
  const calls: Array<[string, unknown[]]> = [];
  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push([sql, params]);
      return answer(sql, params) ?? { rows: [] };
    }),
    release: vi.fn(),
  };
  connect.mockResolvedValue(client);
  return calls;
}
const sqlIn = (calls: Array<[string, unknown[]]>, re: RegExp) => calls.find((c) => re.test(c[0]));
const audits = (calls: Array<[string, unknown[]]>) => calls.filter((c) => /INSERT INTO audit_log/.test(c[0])).map((c) => c[1]);

beforeEach(() => {
  query.mockReset().mockResolvedValue({ rows: [] });
  connect.mockReset();
});

const inviteRow = (over: Record<string, unknown> = {}) => ({
  id: 4,
  name: "Alex Example",
  email: "alex@example.com",
  note: "Lovely to chat",
  signed_by: "Fern",
  sent_by: "admin:fern@example.com",
  created_at: new Date("2026-10-01T09:00:00Z"),
  resent_at: null,
  used_at: null,
  used_by_fundraiser_id: null,
  ...over,
});

describe("invites", () => {
  it("stores a new invite with its token's hash, and records who sent it", async () => {
    const stored = inviteRow({ name: "Morag Ann Fyfe", first_name: "Morag Ann", last_name: "Fyfe", email: "morag@example.com" });
    const calls = useClient((sql) => (/INSERT INTO fundraiser_invites/.test(sql) ? { rows: [stored] } : undefined));
    const inv = await createInvite(
      { firstName: "Morag Ann", lastName: "Fyfe", email: "morag@example.com", note: "Lovely to chat", signedBy: "Fern", cc: "fern@example.com", tokenHash: "h".repeat(64) },
      "admin:fern@example.com",
    );
    const insert = sqlIn(calls, /INSERT INTO fundraiser_invites/)!;
    expect(insert[0]).toMatch(/token_hash/);
    // Jaimie 2026-10-03: the two boxes are kept as typed, and `name` still has the two joined.
    expect(insert[0]).toMatch(/\(name, first_name, last_name, email, note, signed_by, sent_by, token_hash, invite_type\)/);
    // No type given (an admin page loaded before the drop-down): none is kept.
    expect(insert[1]).toEqual(["Morag Ann Fyfe", "Morag Ann", "Fyfe", "morag@example.com", "Lovely to chat", "Fern", "admin:fern@example.com", "h".repeat(64), null]);
    // Who was copied in is on the record too.
    expect(audits(calls)[0]).toEqual([
      "admin:fern@example.com",
      "fundraiser_invite.sent",
      "fundraiser_invite",
      4,
      { email: "morag@example.com", signedBy: "Fern", cc: "fern@example.com" },
    ]);
    expect(inv).toMatchObject({ id: 4, name: "Morag Ann Fyfe", firstName: "Morag Ann", lastName: "Fyfe", signedBy: "Fern", createdAt: "2026-10-01T09:00:00.000Z" });
    expect(JSON.stringify(inv)).not.toContain("hhhh");
  });

  // Invite types (Jaimie, B1 + I1).
  it("keeps what they were invited to do, and gives it back", async () => {
    const calls = useClient((sql) =>
      /touch_wording_approvals/.test(sql) ? { rows: [{ "?column?": 1 }] } : /INSERT INTO fundraiser_invites/.test(sql) ? { rows: [inviteRow({ invite_type: "memory" })] } : undefined,
    );
    const inv = await createInvite(
      { firstName: "Alex", lastName: "Example", email: "alex@example.com", note: null, signedBy: "Fern", cc: null, tokenHash: "h".repeat(64), inviteType: "memory" },
      "admin:fern@example.com",
    );
    expect(sqlIn(calls, /INSERT INTO fundraiser_invites/)![1][8]).toBe("memory");
    expect(inv.type).toBe("memory");
    expect(audits(calls)[0][4]).toEqual({ email: "alex@example.com", signedBy: "Fern", cc: null, type: "memory" });
  });

  it("reads an invite from before, with no type, as none", async () => {
    query.mockResolvedValueOnce({ rows: [inviteRow(), inviteRow({ id: 5, invite_type: "team" })] });
    expect((await listOpenInvites()).map((i) => i.type)).toEqual([null, "team"]);
    query.mockResolvedValueOnce({ rows: [inviteRow({ invite_type: "event" })] });
    expect((await findInviteByHash("h".repeat(64)))!.inviteType).toBe("event");
    query.mockResolvedValueOnce({ rows: [inviteRow()] });
    expect((await findInviteByHash("h".repeat(64)))!.inviteType).toBeNull();
  });

  // The sign off is checked again inside the transaction, with a lock on its row, so a withdrawal
  // cannot slip in between the check and the send.
  const SIGN_OFF = /SELECT 1 FROM touch_wording_approvals WHERE key = \$1 FOR SHARE/;
  const memoryInvite = { firstName: "Alex", lastName: "Example", email: "alex@example.com", note: null, signedBy: "Fern", cc: null, tokenHash: "h".repeat(64), inviteType: "memory" as const };

  it("checks the in memory wording's sign off in the same transaction, before storing the invite", async () => {
    const calls = useClient((sql) =>
      SIGN_OFF.test(sql) ? { rows: [{ "?column?": 1 }] } : /INSERT INTO fundraiser_invites/.test(sql) ? { rows: [inviteRow({ invite_type: "memory" })] } : undefined,
    );
    await createInvite(memoryInvite, "admin:fern@example.com");
    const order = calls.map((c) => c[0]);
    const check = order.findIndex((q) => SIGN_OFF.test(q));
    expect(calls[check][1]).toEqual(["invite_memory"]);
    expect(order.indexOf("BEGIN")).toBeLessThan(check);
    expect(check).toBeLessThan(order.findIndex((q) => /INSERT INTO fundraiser_invites/.test(q)));
    expect(order).toContain("COMMIT");
  });

  it("stores nothing when that sign off has gone", async () => {
    const calls = useClient(() => undefined);
    await expect(createInvite(memoryInvite, "admin:fern@example.com")).rejects.toMatchObject({ reason: "wording_waiting" });
    expect(sqlIn(calls, /INSERT INTO fundraiser_invites/)).toBeUndefined();
    expect(audits(calls)).toHaveLength(0);
    expect(calls.some((c) => c[0] === "ROLLBACK")).toBe(true);
  });

  it("asks about no sign off for the other types", async () => {
    for (const inviteType of ["raising", "team", "event", null] as const) {
      const calls = useClient((sql) => (/INSERT INTO fundraiser_invites/.test(sql) ? { rows: [inviteRow({ invite_type: inviteType })] } : undefined));
      await createInvite({ ...memoryInvite, inviteType }, "admin:fern@example.com");
      expect(sqlIn(calls, SIGN_OFF)).toBeUndefined();
    }
  });

  it("keeps the type on a resend, checking an in memory one's sign off in the same transaction", async () => {
    const calls = useClient((sql) =>
      SIGN_OFF.test(sql) ? { rows: [{ "?column?": 1 }] } : /UPDATE fundraiser_invites/.test(sql) ? { rows: [inviteRow({ invite_type: "memory" })] } : undefined,
    );
    const inv = await resendInvite(4, "n".repeat(64), "admin:fern@example.com", "fern@example.com");
    expect(inv.type).toBe("memory");
    expect(sqlIn(calls, /UPDATE fundraiser_invites/)![0]).not.toMatch(/invite_type =/);
    expect(sqlIn(calls, SIGN_OFF)![1]).toEqual(["invite_memory"]);
    expect(calls.map((c) => c[0])).toContain("COMMIT");
  });

  it("holds a resend whose wording is waiting for sign off, changing nothing", async () => {
    const calls = useClient((sql) => (/UPDATE fundraiser_invites/.test(sql) ? { rows: [inviteRow({ invite_type: "memory" })] } : undefined));
    await expect(resendInvite(4, "n".repeat(64), "admin:fern@example.com", "fern@example.com")).rejects.toMatchObject({ reason: "wording_waiting" });
    // Rolled back: the old link still works, and nothing is recorded.
    expect(calls.some((c) => /ROLLBACK/.test(c[0]))).toBe(true);
    expect(calls.some((c) => /COMMIT/.test(c[0]))).toBe(false);
    expect(audits(calls)).toHaveLength(0);
  });

  it("asks about no sign off on a resend of another type", async () => {
    const calls = useClient((sql) => (/UPDATE fundraiser_invites/.test(sql) ? { rows: [inviteRow({ invite_type: "team" })] } : undefined));
    await resendInvite(4, "n".repeat(64), "admin:fern@example.com", "fern@example.com");
    expect(sqlIn(calls, SIGN_OFF)).toBeUndefined();
  });

  it("records no copy on an invite sent with none", async () => {
    const calls = useClient((sql) => (/INSERT INTO fundraiser_invites/.test(sql) ? { rows: [inviteRow()] } : undefined));
    await createInvite(
      { firstName: "Alex", lastName: "Example", email: "alex@example.com", note: null, signedBy: "Fern", cc: null, tokenHash: "h".repeat(64) },
      "admin:alex@example.com",
    );
    expect(audits(calls)[0][4]).toEqual({ email: "alex@example.com", signedBy: "Fern", cc: null });
  });

  // Jaimie 2026-10-04: a resend copies in whoever was copied in when it was sent (the address on its
  // `fundraiser_invite.sent` record): the signer for an invite sent since, and for one sent before,
  // whoever sent it. The record of the resend still names who pressed Resend as its actor.
  const KEPT = /SELECT data->>'cc' AS cc FROM audit_log/;
  const resendWith = (kept: unknown[]) =>
    useClient((sql) => (/UPDATE fundraiser_invites/.test(sql) ? { rows: [inviteRow()] } : KEPT.test(sql) ? { rows: kept } : undefined));

  it("copies in on a resend whoever was copied in when it was sent, whoever resends it", async () => {
    const calls = resendWith([{ cc: "fern@example.com" }]);
    const inv = await resendInvite(4, "n".repeat(64), "admin:rowan@example.com", "rowan@example.com");
    expect(inv.cc).toBe("fern@example.com");
    const read = sqlIn(calls, KEPT)!;
    expect(read[0]).toMatch(/action = 'fundraiser_invite\.sent'/);
    expect(read[0]).toMatch(/entity = 'fundraiser_invite' AND entity_id = \$1/);
    expect(read[1]).toEqual([4]);
    const audit = audits(calls)[0];
    expect(audit[0]).toBe("admin:rowan@example.com");
    expect(audit[4]).toEqual({ email: "alex@example.com", cc: "fern@example.com" });
  });

  it("falls back on a resend to the person resending when no address was kept, never the person invited", async () => {
    for (const kept of [[], [{ cc: null }], [{ cc: "fern@" }]]) {
      const calls = resendWith(kept);
      const inv = await resendInvite(4, "n".repeat(64), "admin:rowan@example.com", "Rowan@Example.com");
      expect(inv.cc).toBe("rowan@example.com");
      expect(audits(calls)[0][4]).toEqual({ email: "alex@example.com", cc: "rowan@example.com" });
    }
    const calls = resendWith([]);
    const inv = await resendInvite(4, "n".repeat(64), "admin:alex@example.com", "alex@example.com");
    expect(inv.cc).toBeNull();
    expect(audits(calls)[0][4]).toEqual({ email: "alex@example.com", cc: null });
  });

  it("gives a resent invite a new token and a new date, only while it is not used", async () => {
    const calls = useClient((sql) => (/UPDATE fundraiser_invites/.test(sql) ? { rows: [inviteRow({ resent_at: new Date("2026-10-08T09:00:00Z") })] } : undefined));
    const inv = await resendInvite(4, "n".repeat(64), "admin:fern@example.com", "fern@example.com");
    const update = sqlIn(calls, /UPDATE fundraiser_invites/)!;
    expect(update[0]).toMatch(/SET token_hash = \$2, resent_at = now\(\)/);
    expect(update[0]).toMatch(/used_at IS NULL/);
    expect(update[1]).toEqual([4, "n".repeat(64)]);
    expect(audits(calls)[0][1]).toBe("fundraiser_invite.resent");
    expect(inv.resentAt).toBe("2026-10-08T09:00:00.000Z");
  });

  it("will not resend or remove one that is used or gone", async () => {
    useClient(() => undefined);
    await expect(resendInvite(4, "n".repeat(64), "admin:fern@example.com")).rejects.toBeInstanceOf(TeamError);
    await expect(removeInvite(4, "admin:fern@example.com")).rejects.toBeInstanceOf(TeamError);
  });

  it("removes one not taken up, and records it", async () => {
    const calls = useClient((sql) => (/DELETE FROM fundraiser_invites/.test(sql) ? { rows: [inviteRow()] } : undefined));
    await removeInvite(4, "admin:fern@example.com");
    expect(sqlIn(calls, /DELETE FROM fundraiser_invites/)![0]).toMatch(/used_at IS NULL/);
    expect(audits(calls)[0]).toEqual(["admin:fern@example.com", "fundraiser_invite.removed", "fundraiser_invite", 4, { email: "alex@example.com" }]);
  });

  it("lists only the invites not taken up", async () => {
    query.mockResolvedValueOnce({ rows: [inviteRow()] });
    const list = await listOpenInvites();
    expect(String(query.mock.calls[0][0])).toMatch(/WHERE used_at IS NULL/);
    // An invite sent before the two boxes has only its one name: split at the first space.
    expect(list[0]).toEqual({
      id: 4,
      name: "Alex Example",
      firstName: "Alex",
      lastName: "Example",
      email: "alex@example.com",
      note: "Lovely to chat",
      signedBy: "Fern",
      sentBy: "admin:fern@example.com",
      createdAt: "2026-10-01T09:00:00.000Z",
      resentAt: null,
      type: null,
    });
  });

  it("finds an invite by its token's hash", async () => {
    query.mockResolvedValueOnce({ rows: [inviteRow()] });
    const found = await findInviteByHash("h".repeat(64));
    expect(String(query.mock.calls[0][0])).toMatch(/WHERE token_hash = \$1/);
    expect(found).toMatchObject({ name: "Alex Example", firstName: "Alex", lastName: "Example", email: "alex@example.com", usedAt: null });
    expect(found!.createdAt).toEqual(new Date("2026-10-01T09:00:00Z"));
  });

  it("reads the first name and surname kept with an invite exactly", async () => {
    query.mockResolvedValueOnce({ rows: [inviteRow({ name: "Mary Jane Smith", first_name: "Mary Jane", last_name: "Smith" })] });
    expect(String((await listOpenInvites())[0].firstName)).toBe("Mary Jane");
    expect(String(query.mock.calls[0][0])).toMatch(/first_name, last_name/);
    query.mockResolvedValueOnce({ rows: [inviteRow({ name: "Mary Jane Smith", first_name: "Mary Jane", last_name: "Smith" })] });
    expect(await findInviteByHash("h".repeat(64))).toMatchObject({ firstName: "Mary Jane", lastName: "Smith" });
  });

  it("marks an invite used once, only while it is in date, with its audit row in the same statement", async () => {
    query.mockResolvedValueOnce({ rows: [{ entity_id: 4 }] });
    expect(await markInviteUsed("h".repeat(64), 77)).toBe(4);
    const sql = String(query.mock.calls[0][0]);
    expect(sql).toMatch(/UPDATE fundraiser_invites SET used_at = now\(\), used_by_fundraiser_id = \$2/);
    expect(sql).toMatch(/used_at IS NULL/);
    expect(sql).toMatch(/COALESCE\(resent_at, created_at\) > now\(\) - interval '60 days'/);
    expect(sql).toMatch(/INSERT INTO audit_log/);
    expect(query.mock.calls[0][1]).toEqual(["h".repeat(64), 77]);
    query.mockResolvedValueOnce({ rows: [] });
    expect(await markInviteUsed("h".repeat(64), 78)).toBeNull();
  });

  it("counts the invites one person sent or resent in the last day", async () => {
    query.mockResolvedValueOnce({ rows: [{ n: "12" }] });
    expect(await countRecentInvites("admin:fern@example.com")).toBe(12);
    expect(String(query.mock.calls[0][0])).toMatch(/interval '24 hours'/);
    expect(query.mock.calls[0][1]).toEqual(["admin:fern@example.com"]);
  });

  it("lists the staff an invite can be signed by, by first name, never anyone disabled", async () => {
    query.mockResolvedValueOnce({
      rows: [
        { id: 3, full_name: "Fern Example", email: "fern@example.com" },
        { id: 5, full_name: "", email: "rowan.test@example.com" },
      ],
    });
    expect(await listSigners()).toEqual([
      { id: 3, firstName: "Fern" },
      { id: 5, firstName: "Rowan" },
    ]);
    expect(String(query.mock.calls[0][0])).toMatch(/status <> 'disabled'/);
  });

  // Their address is for the copy of the invite only: the list the page gets (above) never has it.
  it("finds one signer with their own email address, never anyone disabled", async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 5, full_name: "", email: "rowan.test@example.com" }] });
    expect(await getSigner(5)).toEqual({ id: 5, firstName: "Rowan", email: "rowan.test@example.com" });
    expect(String(query.mock.calls[0][0])).toMatch(/status <> 'disabled'/);
    expect(query.mock.calls[0][1]).toEqual([5]);
    query.mockResolvedValueOnce({ rows: [] });
    expect(await getSigner(6)).toBeNull();
  });
});

describe("calls", () => {
  it("records a call to a fundraiser with a date, and its History row", async () => {
    const calls = useClient((sql) =>
      /INSERT INTO fundraiser_calls/.test(sql)
        ? { rows: [{ id: 1, fundraiser_id: 9, which: "before", called_at: new Date("2026-11-30T10:00:00Z"), called_by: "fern@example.com", note: "All set" }] }
        : undefined,
    );
    const call = await recordFundraiserCall(9, "before", "All set", "fern@example.com", "admin:fern@example.com");
    const insert = sqlIn(calls, /INSERT INTO fundraiser_calls/)!;
    expect(insert[0]).toMatch(/FROM fundraisers f WHERE f\.id = \$1 AND f\.event_date IS NOT NULL/);
    expect(insert[1]).toEqual([9, "before", "fern@example.com", "All set"]);
    expect(audits(calls)[0]).toEqual(["admin:fern@example.com", "fundraiser.called", "fundraiser", 9, { which: "before", note: "All set" }]);
    expect(call).toEqual({ which: "before", calledAt: "2026-11-30T10:00:00.000Z", calledBy: "fern@example.com", note: "All set" });
  });

  it("refuses a call to a fundraiser that is not there or has no date", async () => {
    useClient(() => undefined);
    await expect(recordFundraiserCall(9, "after", null, "fern@example.com", "admin:fern@example.com")).rejects.toMatchObject({ reason: "not_found" });
  });

  it("lists every call", async () => {
    query.mockResolvedValueOnce({
      rows: [{ fundraiser_id: 9, which: "after", called_at: new Date("2026-12-14T10:00:00Z"), called_by: "fern@example.com", note: null }],
    });
    expect(await listFundraiserCalls()).toEqual([
      { fundraiserId: 9, which: "after", calledAt: "2026-12-14T10:00:00.000Z", calledBy: "fern@example.com", note: null },
    ]);
  });
});

describe("taking a fundraiser off Get involved", () => {
  it("reads when it was taken off", () => {
    const base = {
      id: 9, slug: "s", path: "raising", kind: "other", title: "T", description: "", event_date: null, start_time: null, venue: "", town: "",
      target_pence: null, public: true, status: "approved", organiser_name: "Sam Sample", organiser_email: "sam@example.com",
      organiser_phone: "07700 900456", social_link: null, social_ok: false, wants: {}, post_address: null, newsletter_ok: false,
      image_src: null, declined_reason: null, created_at: "2026-10-02T10:00:00Z", approved_at: null, approved_by: null,
      updated_at: "2026-10-02T10:00:00Z", updated_by: null,
    };
    expect(toRecord({ ...base, off_list_at: "2026-12-01T10:00:00Z", off_list_by: "admin:fern@example.com" })).toMatchObject({
      offListAt: "2026-12-01T10:00:00.000Z",
      offListBy: "admin:fern@example.com",
    });
    expect(toRecord(base).offListAt).toBeNull();
  });

  it("takes an approved one off, leaving its status alone, with a History row", async () => {
    const calls = useClient((sql) => {
      if (/SELECT status, slug, off_list_at FROM fundraisers/.test(sql)) return { rows: [{ status: "approved", slug: "sams-walk", off_list_at: null }] };
      if (/UPDATE fundraisers/.test(sql)) return { rows: [{ off_list_at: new Date("2026-12-01T10:00:00Z") }] };
      return undefined;
    });
    expect(await setOffList(9, true, "admin:fern@example.com")).toEqual({ offListAt: "2026-12-01T10:00:00.000Z" });
    const update = sqlIn(calls, /UPDATE fundraisers/)!;
    expect(update[0]).not.toMatch(/status\s*=/);
    expect(update[0]).toMatch(/off_list_at = now\(\), off_list_by = \$2/);
    expect(audits(calls)[0]).toEqual(["admin:fern@example.com", "fundraiser.taken_off_list", "fundraiser", 9, { slug: "sams-walk" }]);
  });

  it("puts one back", async () => {
    const calls = useClient((sql) => {
      if (/SELECT status, slug, off_list_at FROM fundraisers/.test(sql)) return { rows: [{ status: "approved", slug: "sams-walk", off_list_at: new Date() }] };
      if (/UPDATE fundraisers/.test(sql)) return { rows: [{ off_list_at: null }] };
      return undefined;
    });
    expect(await setOffList(9, false, "admin:fern@example.com")).toEqual({ offListAt: null });
    expect(sqlIn(calls, /UPDATE fundraisers/)![0]).toMatch(/off_list_at = NULL, off_list_by = NULL/);
    expect(audits(calls)[0][1]).toBe("fundraiser.put_back_on_list");
  });

  it("refuses one that is not approved, or not there", async () => {
    useClient((sql) => (/SELECT status/.test(sql) ? { rows: [{ status: "new", slug: "s", off_list_at: null }] } : undefined));
    await expect(setOffList(9, true, "admin:fern@example.com")).rejects.toMatchObject({ reason: "bad_status" });
    useClient(() => undefined);
    await expect(setOffList(9, true, "admin:fern@example.com")).rejects.toMatchObject({ reason: "not_found" });
  });
});

describe("the Monday summary's settings", () => {
  it("reads the list and the last week it went", async () => {
    query.mockResolvedValueOnce({ rows: [{ summary_recipients: ["rowan@example.com", "fern@example.com"], last_week: "2026-11-30" }] });
    expect(await getSummarySettings()).toEqual({ recipients: ["fern@example.com", "rowan@example.com"], lastWeek: "2026-11-30" });
  });

  it("reads an untidy or missing list as nobody", async () => {
    query.mockResolvedValueOnce({ rows: [{ summary_recipients: "nonsense", last_week: null }] });
    expect(await getSummarySettings()).toEqual({ recipients: [], lastWeek: null });
    query.mockResolvedValueOnce({ rows: [] });
    expect(await getSummarySettings()).toEqual({ recipients: [], lastWeek: null });
  });

  it("saves the list with a History row of who was added and removed", async () => {
    const calls = useClient((sql) => (/SELECT summary_recipients/.test(sql) ? { rows: [{ summary_recipients: ["fern@example.com"] }] } : undefined));
    await saveSummaryRecipients(["rowan@example.com"], "admin:fern@example.com");
    expect(sqlIn(calls, /UPDATE fundraising_settings SET summary_recipients/)![1]).toEqual([JSON.stringify(["rowan@example.com"])]);
    expect(audits(calls)[0]).toEqual([
      "admin:fern@example.com",
      "fundraising.summary_recipients_saved",
      "fundraising_settings",
      1,
      { recipients: 1, added: ["rowan@example.com"], removed: ["fern@example.com"] },
    ]);
  });

  it("claims a Monday once: a second claim for the same week gets nothing", async () => {
    let last: string | null = "2026-11-30";
    useClient((sql, params) => {
      if (/SELECT to_char\(summary_last_week/.test(sql)) return { rows: [{ last_week: last }] };
      if (/UPDATE fundraising_settings SET summary_last_week/.test(sql)) {
        last = params[0] as string;
        return { rows: [] };
      }
      return undefined;
    });
    expect(await claimSummaryWeek("2026-12-07")).toEqual({ previous: "2026-11-30" });
    expect(await claimSummaryWeek("2026-12-07")).toBeNull();
  });

  it("gives a week back when nothing went", async () => {
    await releaseSummaryWeek("2026-12-07", "2026-11-30");
    expect(String(query.mock.calls[0][0])).toMatch(/SET summary_last_week = \$2::date WHERE id = 1 AND summary_last_week = \$1::date/);
    expect(query.mock.calls[0][1]).toEqual(["2026-12-07", "2026-11-30"]);
  });
});

describe("what the summary reads", () => {
  it("reads gifts by when they were paid, cash by when it was recorded, calls and open invites, from a fortnight back", async () => {
    query.mockImplementation(async (sql: string) => {
      if (/AS paid_at/.test(sql)) {
        return { rows: [{ fundraiser_id: 1, amount_pence: 2000, refunded_amount_pence: 0, gift_aid: true, paid_in_by_organiser: false, paid_at: new Date("2026-12-01T10:00:00Z") }] };
      }
      if (/amount_pence, created_at FROM fundraiser_cash/.test(sql)) return { rows: [{ fundraiser_id: 1, amount_pence: 1000, created_at: new Date("2026-12-02T15:00:00Z") }] };
      if (/FROM fundraiser_invites/.test(sql)) return { rows: [inviteRow()] };
      return { rows: [] };
    });
    const now = new Date("2026-12-07T08:00:00Z");
    const i = await readSummaryInputs(now);
    expect(i.now).toBe(now);
    expect(i.gifts).toEqual([{ fundraiserId: 1, amountPence: 2000, refundedPence: 0, giftAid: true, paidIn: false, paidAt: "2026-12-01T10:00:00.000Z" }]);
    expect(i.cash).toEqual([{ fundraiserId: 1, amountPence: 1000, recordedAt: "2026-12-02T15:00:00.000Z" }]);
    expect(i.invites).toEqual([{ name: "Alex Example", firstName: "Alex", signedBy: "Fern", createdAt: "2026-10-01T09:00:00.000Z", resentAt: null, type: null }]);
    const giftSql = query.mock.calls.map((c) => String(c[0])).find((s) => /AS paid_at/.test(s))!;
    expect(giftSql).toMatch(/d\.payment_status = 'paid'/);
    expect(giftSql).toMatch(/d\.fundraiser_id IS NOT NULL/);
    // A Direct Debit gift is paid when Stripe says so: the audit row the webhook writes then. A card
    // gift has none, and was paid when it was made.
    expect(giftSql).toMatch(/action = 'donation\.payment_succeeded'/);
    expect(giftSql).toMatch(/COALESCE\(/);
    const cashSql = query.mock.calls.map((c) => String(c[0])).find((s) => /amount_pence, created_at FROM fundraiser_cash/.test(s))!;
    expect(cashSql).toMatch(/created_at >= \$1/);
    expect(cashSql).not.toMatch(/paid_in_on >=/);
  });

  // TASK-505: the requests staff have acted on, so the summary counts only what is still to do.
  it("reads the requests staff have acted on", async () => {
    query.mockImplementation(async (sql: string) => {
      if (/FROM fundraiser_requests/.test(sql)) {
        return {
          rows: [
            { fundraiser_id: 1, kind: "buckets", status: "with_them", quantity: 2, quantity_back: null, how: null, sent_on: "2026-12-01", back_on: null, done_on: null, handled_by: "Fern", going: null, note: null, back_note: null, link: null, updated_at: new Date("2026-12-01T10:00:00Z"), updated_by: "admin:fern@example.com" },
          ],
        };
      }
      return { rows: [] };
    });
    const i = await readSummaryInputs(new Date("2026-12-07T08:00:00Z"));
    expect(i.requests).toEqual([expect.objectContaining({ fundraiserId: 1, kind: "buckets", status: "with_them", quantity: 2, sentOn: "2026-12-01" })]);
  });
});
