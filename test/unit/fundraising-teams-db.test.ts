import { describe, it, expect, vi, beforeEach } from "vitest";

// Team pages (Jaimie, 2026-10-03): the SQL behind teams (src/db/fundraising-teams.ts), against a
// mocked pool (no database). Held invites stored with the team's sign up; invites claimed before
// they are sent and given back if the send fails; reminded once; names and email deleted on time; a
// member taken off by the team organiser only; and the staff handover, confirmed by a code whose
// tries are counted before it is compared. Every name and address here is invented.

const { query, connect } = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn() }));
vi.mock("../../src/db/pool", () => ({ pool: { query, connect } }));
vi.mock("../../src/config", () => ({ config: { NODE_ENV: "test" } }));

import {
  markTeam,
  insertHeldInvites,
  linkMember,
  claimInviteSend,
  releaseInviteSend,
  findTeamInviteByHash,
  claimInviteReminder,
  releaseInviteReminder,
  deleteDueInvites,
  claimTeamNudge,
  releaseTeamNudge,
  removeTeamMember,
  startHandover,
  cancelHandover,
  confirmHandover,
  listTeamInvites,
  TeamError,
} from "../../src/db/fundraising-teams";

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
  return { calls, client };
}
const audits = (calls: Array<[string, unknown[]]>) => calls.filter((c) => /INSERT INTO audit_log/.test(c[0])).map((c) => c[1]);

beforeEach(() => {
  query.mockReset().mockResolvedValue({ rows: [] });
  connect.mockReset();
});

const teamRow = (over: Record<string, unknown> = {}) => ({
  id: 40, slug: "ej", path: "raising", kind: "santa_dash", title: "Exampleton Juniors", description: "", event_date: "2026-12-05",
  start_time: null, venue: "", town: "", target_pence: 200000, public: true, status: "approved", organiser_name: "Robin Organiser",
  organiser_email: "robin@example.com", organiser_phone: "07700 900111", social_link: null, social_ok: false, wants: {},
  post_address: null, newsletter_ok: false, image_src: null, declined_reason: null, created_at: "2026-10-02T10:00:00Z",
  approved_at: "2026-10-03T10:00:00Z", approved_by: null, updated_at: "2026-10-02T10:00:00Z", updated_by: null, is_team: true, ...over,
});

describe("a team's sign up, in its own transaction", () => {
  it("marks it a team, with its split mode", async () => {
    const { client, calls } = useClient(() => undefined);
    await markTeam(client as never, 40, "team");
    expect(calls[0][0]).toContain("UPDATE fundraisers SET is_team = true, team_share_mode = $2 WHERE id = $1");
    expect(calls[0][1]).toEqual([40, "team"]);
  });

  it("holds the people added, nothing sent", async () => {
    const { client, calls } = useClient(() => undefined);
    await insertHeldInvites(client as never, 40, [
      { firstName: "Ava", lastName: "Example", email: "ava@example.com" },
      { firstName: "Jack", lastName: "Sample", email: "parent@example.com" },
    ]);
    const insert = calls.find(([s]) => s.includes("INSERT INTO team_invites"))!;
    expect(insert[0]).not.toContain("sent_at");
    expect(insert[1]).toEqual([40, ["Ava", "Jack"], ["Example", "Sample"], ["ava@example.com", "parent@example.com"]]);
  });

  it("adds nobody when nobody was added", async () => {
    const { client, calls } = useClient(() => undefined);
    await insertHeldInvites(client as never, 40, []);
    expect(calls).toEqual([]);
  });
});

describe("a member joining", () => {
  it("links the page to the team only while the team is an approved team, and marks the invite joined", async () => {
    const { client, calls } = useClient((sql) => (sql.includes("FOR SHARE") ? { rows: [{ is_team: true, status: "approved" }] } : undefined));
    await linkMember(client as never, 41, 40, "h".repeat(64));
    const lock = calls.findIndex(([s]) => s.includes("FOR SHARE"));
    const link = calls.find(([s]) => s.includes("UPDATE fundraisers SET team_id = $2"))!;
    expect(lock).toBe(0);
    expect(link[1]).toEqual([41, 40]);
    const joined = calls.find(([s]) => s.includes("UPDATE team_invites SET joined_at = now()"))!;
    expect(joined[0]).toContain("team_id = $2");
    expect(joined[0]).toContain("deleted_at IS NULL");
    expect(joined[1]).toEqual(["h".repeat(64), 40, 41]);
    expect(audits(calls).some((a) => a[1] === "fundraiser.joined_team")).toBe(true);
  });

  it("is refused when the team is no longer an approved team", async () => {
    const { client } = useClient((sql) => (sql.includes("FOR SHARE") ? { rows: [{ is_team: true, status: "finished" }] } : undefined));
    await expect(linkMember(client as never, 41, 40, null)).rejects.toMatchObject({ reason: "team_closed" });
  });
});

describe("sending the invites", () => {
  it("claims one before it is sent, with its token's hash, once", async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 7 }] });
    expect(await claimInviteSend(7, "a".repeat(64))).toBe(true);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("SET sent_at = now(), token_hash = $2");
    expect(sql).toContain("sent_at IS NULL AND deleted_at IS NULL");
    expect(params).toEqual([7, "a".repeat(64)]);
    query.mockResolvedValueOnce({ rows: [] });
    expect(await claimInviteSend(7, "b".repeat(64))).toBe(false);
  });

  it("gives the claim back when the send fails", async () => {
    await releaseInviteSend(7);
    expect(query.mock.calls[0][0]).toContain("SET sent_at = NULL, token_hash = NULL");
  });

  it("finds an invite by its token's hash, with its team", async () => {
    query.mockResolvedValueOnce({
      rows: [{ id: 7, team_id: 40, first_name: "Jack", last_name: "Sample", email: "parent@example.com", created_at: "2026-10-03T10:00:00Z", sent_at: "2026-10-03T10:00:00Z", reminded_at: null, joined_at: null, deleted_at: null, team_slug: "ej" }],
    });
    const inv = await findTeamInviteByHash("c".repeat(64));
    expect(inv).toMatchObject({ id: 7, teamId: 40, teamSlug: "ej", firstName: "Jack", email: "parent@example.com" });
    expect(query.mock.calls[0][1]).toEqual(["c".repeat(64)]);
  });
});

describe("the one reminder", () => {
  it("is claimed once, only for an invite still waiting", async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 7 }] });
    expect(await claimInviteReminder(7, "d".repeat(64))).toBe(true);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("reminded_at IS NULL AND joined_at IS NULL AND deleted_at IS NULL AND sent_at IS NOT NULL");
    expect(params).toEqual([7, "d".repeat(64)]);
    query.mockResolvedValueOnce({ rows: [] });
    expect(await claimInviteReminder(7, "e".repeat(64))).toBe(false);
  });
});

describe("the nudges to the team organiser", () => {
  it("are claimed once each before they are sent", async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 40 }] });
    expect(await claimTeamNudge(40, 1)).toBe(true);
    expect(query.mock.calls[0][0]).toContain("SET team_nudge_1_at = now() WHERE id = $1 AND team_nudge_1_at IS NULL");
    query.mockResolvedValueOnce({ rows: [] });
    expect(await claimTeamNudge(40, 2)).toBe(false);
    expect(query.mock.calls[1][0]).toContain("team_nudge_2_at");
    await releaseTeamNudge(40, 2);
    expect(query.mock.calls[2][0]).toContain("SET team_nudge_2_at = NULL");
  });
});

describe("the team organiser taking someone off the team", () => {
  function answering(o: { team?: Record<string, unknown> | null; member?: Record<string, unknown> | null }) {
    return useClient((sql) => {
      if (sql.includes("WHERE f.id = $1 FOR UPDATE")) return { rows: o.team === null ? [] : [teamRow(o.team)] };
      if (sql.includes("AND f.team_id = $2") && sql.includes("FOR UPDATE")) return { rows: o.member === null ? [] : [teamRow({ id: 41, is_team: false, team_id: 40, organiser_name: "Jack Sample", ...o.member })] };
      return undefined;
    }).calls;
  }

  it("takes them off, records who and when, on both pages' History", async () => {
    const calls = answering({});
    const r = await removeTeamMember(40, 41, "robin@example.com");
    expect(r.member.name).toBe("Jack Sample");
    const update = calls.find(([s]) => s.includes("SET team_left_at = now(), team_left_by = 'organiser'"))!;
    expect(update[1]).toEqual([41]);
    const a = audits(calls).map((x) => [x[1], x[3]]);
    expect(a).toContainEqual(["fundraiser.member_removed", 40]);
    expect(a).toContainEqual(["fundraiser.removed_from_team", 41]);
  });

  it("is only for the team's own organiser", async () => {
    answering({ team: { organiser_email: "someone@example.com" } });
    await expect(removeTeamMember(40, 41, "robin@example.com")).rejects.toMatchObject({ reason: "not_found" });
  });

  it("is only for someone still on that team", async () => {
    answering({ member: null });
    await expect(removeTeamMember(40, 41, "robin@example.com")).rejects.toBeInstanceOf(TeamError);
  });
});

describe("handing the team organiser role over", () => {
  it("cancels any handover still open, then starts a new one, its code kept only as a hash", async () => {
    const { calls } = useClient((sql) => {
      if (sql.includes("FOR UPDATE")) return { rows: [teamRow()] };
      if (sql.includes("INSERT INTO team_handovers")) return { rows: [{ id: 3 }] };
      return undefined;
    });
    const id = await startHandover(40, { firstName: "Sam", lastName: "New", email: "sam@example.com", phone: "07700 900123" }, "hash-of-code", new Date("2026-10-06T10:00:00Z"), "admin:fern@example.com");
    expect(id).toBe(3);
    const cancel = calls.findIndex(([s]) => s.includes("UPDATE team_handovers SET cancelled_at = now()"));
    const insert = calls.findIndex(([s]) => s.includes("INSERT INTO team_handovers"));
    expect(cancel).toBeGreaterThan(-1);
    expect(insert).toBeGreaterThan(cancel);
    expect(calls[insert][1]).toEqual([40, "Sam", "New", "sam@example.com", "07700 900123", "hash-of-code", new Date("2026-10-06T10:00:00Z"), "admin:fern@example.com"]);
    expect(JSON.stringify(audits(calls))).not.toContain("hash-of-code");
  });

  it("is only for a team", async () => {
    useClient((sql) => (sql.includes("FOR UPDATE") ? { rows: [teamRow({ is_team: false })] } : undefined));
    await expect(startHandover(40, { firstName: "Sam", lastName: "New", email: "sam@example.com", phone: "07700 900123" }, "h", new Date(), "admin:x")).rejects.toMatchObject({ reason: "not_a_team" });
  });

  it("can be cancelled by staff", async () => {
    const { calls } = useClient((sql) => (sql.includes("UPDATE team_handovers SET cancelled_at") ? { rows: [{ id: 3 }] } : undefined));
    expect(await cancelHandover(40, "admin:fern@example.com")).toBe(true);
    expect(audits(calls)[0][1]).toBe("fundraiser.handover_cancelled");
  });

  const open = (over: Record<string, unknown> = {}) => ({
    id: 3, team_id: 40, to_first_name: "Sam", to_last_name: "New", to_email: "sam@example.com", to_phone: "07700 900123",
    code_hash: "right", expires_at: "2099-01-01T00:00:00Z", attempts: 1, ...over,
  });

  it("counts the try before the code is compared, and a wrong code changes nothing", async () => {
    const { calls } = useClient((sql) => (sql.includes("UPDATE team_handovers SET attempts = attempts + 1") ? { rows: [open()] } : undefined));
    const seen: string[] = [];
    const r = await confirmHandover("Sam@Example.com", (h) => (seen.push(h.codeHash), false), new Date("2026-10-04T10:00:00Z"));
    expect(r).toEqual({ status: "wrong" });
    expect(calls.find(([s]) => s.includes("attempts = attempts + 1"))![1]).toEqual(["sam@example.com"]);
    expect(seen).toEqual(["right"]);
    expect(calls.some(([s]) => s.includes("UPDATE fundraisers"))).toBe(false);
  });

  it("with the right code, makes them the team organiser, closes it, and records it", async () => {
    const { calls } = useClient((sql) => {
      if (sql.includes("attempts = attempts + 1")) return { rows: [open()] };
      if (sql.includes("SELECT organiser_email FROM fundraisers")) return { rows: [{ organiser_email: "robin@example.com" }] };
      if (sql.includes("WHERE f.id = $1")) return { rows: [teamRow({ organiser_name: "Sam New", organiser_email: "sam@example.com" })] };
      return undefined;
    });
    const r = await confirmHandover("sam@example.com", (h) => h.codeHash === "right", new Date("2026-10-04T10:00:00Z"));
    expect(r.status).toBe("ok");
    const update = calls.find(([s]) => s.startsWith("UPDATE fundraisers SET organiser_name"))!;
    expect(update[0]).toContain("first_name = $2, last_name = $3, organiser_email = $4, organiser_phone = $5");
    expect(update[1]).toEqual(["Sam New", "Sam", "New", "sam@example.com", "07700 900123", "team handover", 40]);
    expect(calls.some(([s]) => s.includes("SET confirmed_at = now()"))).toBe(true);
    const a = audits(calls)[0];
    expect(a[1]).toBe("fundraiser.organiser_handed_over");
    expect(a[4]).toMatchObject({ from: "robin@example.com", to: "sam@example.com" });
  });

  it("refuses an expired code, or one tried too often", async () => {
    useClient((sql) => (sql.includes("attempts = attempts + 1") ? { rows: [open({ expires_at: "2026-10-01T00:00:00Z" })] } : undefined));
    expect(await confirmHandover("sam@example.com", () => true, new Date("2026-10-04T10:00:00Z"))).toEqual({ status: "wrong" });
    useClient((sql) => (sql.includes("attempts = attempts + 1") ? { rows: [open({ attempts: 6 })] } : undefined));
    expect(await confirmHandover("sam@example.com", () => true, new Date("2026-10-04T10:00:00Z"))).toEqual({ status: "wrong" });
  });
});

describe("the invites list, for staff", () => {
  it("reads every invite of a team, newest last, details and all", async () => {
    query.mockResolvedValueOnce({
      rows: [{ id: 7, team_id: 40, first_name: null, last_name: null, email: null, created_at: "2026-10-01T10:00:00Z", sent_at: "2026-10-01T10:00:00Z", reminded_at: null, joined_at: "2026-10-02T10:00:00Z", deleted_at: "2026-10-30T10:00:00Z", joined_fundraiser_id: 41 }],
    });
    const list = await listTeamInvites(40);
    expect(list[0]).toMatchObject({ id: 7, firstName: null, joinedAt: "2026-10-02T10:00:00.000Z", joinedFundraiserId: 41 });
    expect(query.mock.calls[0][1]).toEqual([40]);
  });
});

import { memberMetersFor } from "../../src/db/fundraising-teams";

describe("the money on a team's member pages", () => {
  it("is read in one query for every team, only current approved or finished member pages", async () => {
    query.mockResolvedValueOnce({ rows: [teamRow({ id: 41, is_team: false, team_id: 40, online_pence: 2000, cash_pence: 500, gift_aid_pence: 250 })] });
    const by = await memberMetersFor([40, 60]);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("f.team_id = ANY($1) AND f.team_left_at IS NULL AND f.status IN ('approved', 'finished')");
    expect(params).toEqual([[40, 60]]);
    expect(by.get(40)).toEqual([{ onlinePence: 2000, cashPence: 500, giftAidPence: 250 }]);
  });

  it("asks nothing for no teams", async () => {
    expect((await memberMetersFor([])).size).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });
});

import { removeTeamMemberByStaff } from "../../src/db/fundraising-teams";

describe("staff taking someone off a team", () => {
  function answering(o: { team?: Record<string, unknown>; member?: Record<string, unknown> | null } = {}) {
    return useClient((sql) => {
      if (sql.includes("WHERE f.id = $1 FOR UPDATE")) return { rows: [teamRow(o.team)] };
      if (sql.includes("AND f.team_id = $2") && sql.includes("FOR UPDATE")) return o.member === null ? { rows: [] } : { rows: [teamRow({ id: 41, is_team: false, team_id: 40, organiser_name: "Jack Sample", ...o.member })] };
      return undefined;
    }).calls;
  }

  it("has the same effect as the team organiser's, recorded as staff, whoever organises the team", async () => {
    const calls = answering({ team: { organiser_email: "someone.else@example.com" } });
    const r = await removeTeamMemberByStaff(40, 41, "admin:fern@example.com");
    expect(r.member.name).toBe("Jack Sample");
    const update = calls.find(([s]) => s.includes("SET team_left_at = now(), team_left_by = $2"))!;
    expect(update[1]).toEqual([41, "admin:fern@example.com"]);
    const a = audits(calls).map((x) => [x[0], x[1], x[3], x[4]]);
    expect(a).toContainEqual(["admin:fern@example.com", "fundraiser.member_removed", 40, { memberId: 41, by: "staff" }]);
    expect(a).toContainEqual(["admin:fern@example.com", "fundraiser.removed_from_team", 41, { teamId: 40, by: "staff" }]);
  });

  it("is only for someone still on that team", async () => {
    answering({ member: null });
    await expect(removeTeamMemberByStaff(40, 41, "admin:fern@example.com")).rejects.toMatchObject({ reason: "not_found" });
  });
});

// ---- after the independent review ----
import { deleteTeamInvites, clearOldHandovers, readTeamRunState, openHandoverFor } from "../../src/db/fundraising-teams";

describe("a member joining, after review", () => {
  it("takes the team's whole team split under the team's lock, whatever the route worked out", async () => {
    const { client, calls } = useClient((sql) =>
      sql.includes("FOR SHARE")
        ? { rows: [{ is_team: true, status: "approved", team_share_mode: "team", shares_with_other: true, nbcc_share_percent: 60, other_cause_name: "Exampleton Food Larder" }] }
        : undefined,
    );
    await linkMember(client as never, 41, 40, null);
    const copy = calls.find(([s]) => s.includes("SET shares_with_other = $2, nbcc_share_percent = $3, other_cause_name = $4"))!;
    expect(copy[1]).toEqual([41, true, 60, "Exampleton Food Larder"]);
  });

  it("leaves the member's own split when it is just the team organiser's", async () => {
    const { client, calls } = useClient((sql) => (sql.includes("FOR SHARE") ? { rows: [{ is_team: true, status: "approved", team_share_mode: "organiser" }] } : undefined));
    await linkMember(client as never, 41, 40, null);
    expect(calls.some(([s]) => s.includes("SET shares_with_other"))).toBe(false);
  });

  it("marks an invite joined by either of its links, or, without one, by the member's email", async () => {
    const { client, calls } = useClient((sql) => (sql.includes("FOR SHARE") ? { rows: [{ is_team: true, status: "approved" }] } : undefined));
    await linkMember(client as never, 41, 40, "h".repeat(64));
    expect(calls.find(([s]) => s.includes("UPDATE team_invites SET joined_at = now()"))![0]).toContain("(token_hash = $1 OR reminder_token_hash = $1)");
    const byEmail = calls.find(([s]) => s.includes("lower(i.email) = lower(m.organiser_email)"));
    expect(byEmail?.[1]).toEqual([40, 41]);
  });
});

describe("the one reminder, after review", () => {
  it("has a link of its own, so the first email's link still works", async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 7 }] });
    await claimInviteReminder(7, "d".repeat(64));
    expect(query.mock.calls[0][0]).toContain("SET reminded_at = now(), reminder_token_hash = $2");
    expect(query.mock.calls[0][0]).not.toContain("SET reminded_at = now(), token_hash");
    await releaseInviteReminder(7);
    expect(query.mock.calls[1][0]).toContain("SET reminded_at = NULL, reminder_token_hash = NULL");
  });

  it("is found by either link, with its team's status", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await findTeamInviteByHash("c".repeat(64));
    expect(query.mock.calls[0][0]).toContain("i.token_hash = $1 OR i.reminder_token_hash = $1");
    expect(query.mock.calls[0][0]).toContain("f.status AS team_status");
  });
});

describe("deleting names and emails, after review", () => {
  it("clears both links, and anonymises the invites' rows in the email log, leaving only the team in the subject", async () => {
    const { calls } = useClient((sql) =>
      sql.includes("UPDATE team_invites") ? { rows: [{ id: 7, email: "parent@example.com", title: "Exampleton Juniors" }, { id: 8, email: "ava@example.com", title: "Exampleton Juniors" }] } : undefined,
    );
    expect(await deleteDueInvites("2026-12-06")).toBe(2);
    const del = calls.find(([s]) => s.includes("UPDATE team_invites"))!;
    expect(del[0]).toContain("reminder_token_hash = NULL");
    expect(del[0]).toContain("COALESCE(i.sent_at, i.created_at) <= now() - interval '30 days'");
    expect(del[0]).toContain("FOR UPDATE");
    const log = calls.find(([s]) => s.includes("UPDATE email_log"))!;
    expect(log[0]).toContain("recipient = 'deleted team invitee'");
    expect(log[0]).toContain("recipient_name = NULL");
    expect(log[0]).toContain("subject = 'Team invite: ' || d.title");
    expect(log[0]).toContain("kind IN ('fundraiseTeamInvite', 'fundraiseTeamInviteReminder')");
    expect(log[1]).toEqual([["parent@example.com", "ava@example.com"], ["Exampleton Juniors", "Exampleton Juniors"]]);
    expect(calls.findIndex(([s]) => s.includes("UPDATE email_log"))).toBeGreaterThan(calls.findIndex(([s]) => s.includes("UPDATE team_invites")));
  });

  it("deletes every invite of a declined team at once, the same way", async () => {
    const { calls } = useClient((sql) => (sql.includes("UPDATE team_invites") ? { rows: [{ id: 7, email: "parent@example.com", title: "Exampleton Juniors" }] } : undefined));
    expect(await deleteTeamInvites(40)).toBe(1);
    const del = calls.find(([s]) => s.includes("UPDATE team_invites"))!;
    expect(del[0]).toContain("i.team_id = $1");
    expect(del[1]).toEqual([40]);
    expect(calls.some(([s]) => s.includes("UPDATE email_log"))).toBe(true);
  });

  it("touches the email log not at all when nothing was due", async () => {
    const { calls } = useClient(() => undefined);
    expect(await deleteDueInvites("2026-12-06")).toBe(0);
    expect(calls.some(([s]) => s.includes("UPDATE email_log"))).toBe(false);
  });
});

describe("handovers, after review", () => {
  it("are cleared 30 days after they are confirmed, cancelled or run out", async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 3 }] });
    expect(await clearOldHandovers()).toBe(1);
    const [sql] = query.mock.calls[0];
    expect(sql).toContain("to_first_name = NULL, to_last_name = NULL, to_email = NULL, to_phone = NULL, code_hash = NULL, cleared_at = now()");
    expect(sql).toContain("COALESCE(confirmed_at, cancelled_at, expires_at) <= now() - interval '30 days'");
    expect(sql).toContain("cleared_at IS NULL");
  });

  it("an open one is never one already cleared", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await openHandoverFor(40);
    expect(query.mock.calls[0][0]).toContain("cleared_at IS NULL");
  });
});

describe("the daily pass's reading, after review", () => {
  it("first marks joined any invite whose email is on a current member page of that team", async () => {
    query.mockResolvedValue({ rows: [] });
    await readTeamRunState();
    const sqls = query.mock.calls.map((c) => String(c[0]));
    const mark = sqls.findIndex((s) => s.includes("UPDATE team_invites i SET joined_at = now()") && s.includes("lower(m.organiser_email) = lower(i.email)"));
    expect(mark).toBe(0);
    expect(sqls[mark]).toContain("m.team_left_at IS NULL AND m.status <> 'declined'");
  });
});
