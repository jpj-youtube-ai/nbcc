import { describe, it, expect, vi } from "vitest";

// Team pages (Jaimie, 2026-10-03): what src/db/fundraisers.ts does for teams, against a fake client
// that answers by statement (no database). A record carries its team columns; a sign up can do more
// in its own transaction (a team's held invites, a member's link); and a whole team split is
// corrected for the team and every member together, only while none of them has a gift, never one
// member page alone. Every name here is invented.

vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));
vi.mock("../../src/config", () => ({ config: { NODE_ENV: "test" } }));

import { pool } from "../../src/db/pool";
import { createFundraiser, setFundraiserSplit, toRecord } from "../../src/db/fundraisers";
import { signUpSchema } from "../../src/fundraising/model";

const row = (over: Record<string, unknown> = {}) => ({
  id: 40, slug: "ej", path: "raising", kind: "santa_dash", title: "Exampleton Juniors", description: "", event_date: null,
  start_time: null, venue: "", town: "", target_pence: 200000, public: true, status: "approved", organiser_name: "Robin Organiser",
  organiser_email: "robin@example.com", organiser_phone: "07700 900111", social_link: null, social_ok: false, wants: {},
  post_address: null, newsletter_ok: false, image_src: null, declined_reason: null, created_at: "2026-10-02T10:00:00Z",
  approved_at: null, approved_by: null, updated_at: "2026-10-02T10:00:00Z", updated_by: null, ...over,
});

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
  (pool.connect as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(client);
  return calls;
}

describe("a record's team columns", () => {
  it("are read: a team, a member, its split mode, when a member left, and the nudges", () => {
    expect(
      toRecord(row({ is_team: true, team_share_mode: "team", team_nudge_1_at: "2026-10-13T08:00:00Z", team_nudge_2_at: null })),
    ).toMatchObject({ isTeam: true, teamId: null, teamShareMode: "team", teamLeftAt: null, teamNudge1At: "2026-10-13T08:00:00.000Z", teamNudge2At: null });
    expect(toRecord(row({ id: 41, team_id: 40, team_left_at: "2026-10-20T09:00:00Z" }))).toMatchObject({
      isTeam: false,
      teamId: 40,
      teamLeftAt: "2026-10-20T09:00:00.000Z",
    });
  });

  it("read as no team on a row from before", () => {
    expect(toRecord(row())).toMatchObject({ isTeam: false, teamId: null, teamShareMode: null, teamLeftAt: null });
  });

  it("are in the columns every read selects", async () => {
    const calls = useClient((sql) => (sql.includes("INSERT INTO fundraisers") ? { rows: [{ id: 40 }] } : sql.includes("WHERE f.id = $1") ? { rows: [row()] } : undefined));
    const parsed = signUpSchema.parse({
      path: "raising", kind: "walk", title: "Exampleton Juniors", description: "Dashing.", eventDate: "", startTime: "", venue: "",
      town: "", targetPence: 200000, public: true, firstName: "Robin", lastName: "Organiser", email: "robin@example.com",
      phone: "07700 900111", instagram: "", facebook: "", socialOk: false, over18: true, sharesWithOther: false,
      wants: { shoutOut: false, attend: false }, newsletterOk: false,
      // The sign up tidy (Jaimie, 2026-10-03): every new sign up gives an address, for the welcome pack.
      postLine1: "1 Example Road", postTown: "Exampleton", postPostcode: "EX1 1EX",
    });
    await createFundraiser(parsed);
    const read = calls.find(([s]) => s.includes("WHERE f.id = $1"))![0];
    for (const c of ["f.is_team", "f.team_id", "f.team_share_mode", "f.team_left_at", "f.team_nudge_1_at", "f.team_nudge_2_at"]) expect(read).toContain(c);
  });
});

describe("a sign up that does more in its own transaction", () => {
  it("runs the extra step after the insert and before the record is read back, in the same transaction", async () => {
    const calls = useClient((sql) => (sql.includes("INSERT INTO fundraisers") ? { rows: [{ id: 40 }] } : sql.includes("WHERE f.id = $1") ? { rows: [row({ is_team: true })] } : undefined));
    const parsed = signUpSchema.parse({
      path: "raising", kind: "walk", title: "Exampleton Juniors", description: "Dashing.", eventDate: "", startTime: "", venue: "",
      town: "", targetPence: 200000, public: true, firstName: "Robin", lastName: "Organiser", email: "robin@example.com",
      phone: "07700 900111", instagram: "", facebook: "", socialOk: false, over18: true, sharesWithOther: false,
      wants: { shoutOut: false, attend: false }, newsletterOk: false,
      // The sign up tidy (Jaimie, 2026-10-03): every new sign up gives an address, for the welcome pack.
      postLine1: "1 Example Road", postTown: "Exampleton", postPostcode: "EX1 1EX",
    });
    const after = await createFundraiser(parsed, async (client, id) => {
      await client.query("UPDATE fundraisers SET is_team = true WHERE id = $1", [id]);
    });
    expect(after.isTeam).toBe(true);
    const insert = calls.findIndex(([s]) => s.includes("INSERT INTO fundraisers"));
    const extra = calls.findIndex(([s]) => s.includes("SET is_team = true"));
    const reread = calls.findIndex(([s]) => s.includes("WHERE f.id = $1"));
    const commit = calls.findIndex(([s]) => s === "COMMIT");
    expect(calls[extra][1]).toEqual([40]);
    expect(insert).toBeLessThan(extra);
    expect(extra).toBeLessThan(reread);
    expect(reread).toBeLessThan(commit);
  });
});

describe("correcting a whole team split", () => {
  const split = { sharesWithOther: true, nbccSharePercent: 70, otherCauseName: "Exampleton Food Larder" };

  function answering(o: { locked: Record<string, unknown>; gifts?: number; cash?: number; members?: number[] }) {
    return useClient((sql) => {
      if (sql.includes("FOR UPDATE") && sql.includes("FROM fundraisers f")) return { rows: [row(o.locked)] };
      if (sql.includes("SELECT id FROM fundraisers WHERE team_id")) return { rows: (o.members ?? []).map((id) => ({ id })) };
      if (sql.includes("FROM donations")) return { rows: [{ n: String(o.gifts ?? 0) }] };
      if (sql.includes("FROM fundraiser_cash")) return { rows: [{ n: String(o.cash ?? 0) }] };
      if (sql.includes("WHERE f.id = $1")) return { rows: [row(o.locked)] };
      return undefined;
    });
  }

  it("counts the gifts of the team and every member, and changes them all together", async () => {
    const calls = answering({ locked: { is_team: true, team_share_mode: "team", shares_with_other: true, nbcc_share_percent: 50, other_cause_name: "X" }, members: [41, 42] });
    await setFundraiserSplit(40, split, "admin:kim@example.com");
    const gifts = calls.find(([s]) => s.includes("FROM donations"))!;
    expect(gifts[0]).toContain("= ANY($1)");
    expect(gifts[1]).toEqual([[40, 41, 42]]);
    const members = calls.find(([s]) => s.startsWith("UPDATE fundraisers") && s.includes("team_id = $"));
    expect(members?.[1]).toEqual([true, 70, "Exampleton Food Larder", "admin:kim@example.com", 40]);
  });

  it("is refused once any member has had a gift", async () => {
    const calls = answering({ locked: { is_team: true, team_share_mode: "team", shares_with_other: true, nbcc_share_percent: 50, other_cause_name: "X" }, members: [41], gifts: 1 });
    await expect(setFundraiserSplit(40, split, "admin:kim@example.com")).rejects.toMatchObject({ reason: "has_gifts" });
    expect(calls.some(([s]) => s.startsWith("UPDATE fundraisers"))).toBe(false);
  });

  it("clears the team's split mode, and the members' split, when the team stops sharing", async () => {
    const calls = answering({ locked: { is_team: true, team_share_mode: "team", shares_with_other: true, nbcc_share_percent: 50, other_cause_name: "X" }, members: [41] });
    await setFundraiserSplit(40, { sharesWithOther: false, nbccSharePercent: null, otherCauseName: null }, "admin:kim@example.com");
    const own = calls.find(([s]) => s.startsWith("UPDATE fundraisers") && s.includes("WHERE id = $5"))!;
    expect(own[0]).toContain("team_share_mode = CASE WHEN $1::boolean THEN team_share_mode ELSE NULL END");
    expect(calls.some(([s]) => s.startsWith("UPDATE fundraisers") && s.includes("team_id = $"))).toBe(true);
  });

  it("leaves members alone when the split is just the team organiser's", async () => {
    const calls = answering({ locked: { is_team: true, team_share_mode: "organiser", shares_with_other: true, nbcc_share_percent: 50, other_cause_name: "X" }, members: [41] });
    await setFundraiserSplit(40, split, "admin:kim@example.com");
    expect(calls.find(([s]) => s.includes("FROM donations"))![1]).toEqual([[40]]);
    expect(calls.some(([s]) => s.startsWith("UPDATE fundraisers") && s.includes("team_id = $"))).toBe(false);
  });

  it("refuses one member page of a whole team split: it is the team's to change", async () => {
    const calls = useClient((sql) => {
      if (sql.includes("FOR UPDATE") && sql.includes("FROM fundraisers f")) return { rows: [row({ id: 41, team_id: 40 })] };
      if (sql.includes("SELECT team_share_mode FROM fundraisers")) return { rows: [{ team_share_mode: "team" }] };
      return undefined;
    });
    await expect(setFundraiserSplit(41, split, "admin:kim@example.com")).rejects.toMatchObject({ reason: "team_split" });
    expect(calls.some(([s]) => s.startsWith("UPDATE fundraisers"))).toBe(false);
  });
});

import { patchFundraiser } from "../../src/db/fundraisers";

describe("a team, or a page on one, is never made an event", () => {
  function answering(locked: Record<string, unknown>) {
    return useClient((sql) => (sql.includes("FOR UPDATE") ? { rows: [row(locked)] } : sql.includes("WHERE f.id = $1") ? { rows: [row(locked)] } : undefined));
  }

  it("refuses a team, changing nothing", async () => {
    const calls = answering({ is_team: true });
    await expect(patchFundraiser(40, { path: "event" }, "admin:kim@example.com")).rejects.toMatchObject({ reason: "team_path" });
    expect(calls.some(([s]) => s.startsWith("UPDATE fundraisers"))).toBe(false);
  });

  it("refuses a page still on a team, and lets one taken off it go", async () => {
    answering({ id: 41, team_id: 40 });
    await expect(patchFundraiser(41, { path: "event" }, "admin:kim@example.com")).rejects.toMatchObject({ reason: "team_path" });
    const calls = answering({ id: 41, team_id: 40, team_left_at: "2026-10-10T10:00:00Z" });
    await patchFundraiser(41, { path: "event" }, "admin:kim@example.com").catch(() => undefined);
    expect(calls.some(([s]) => s.startsWith("UPDATE fundraisers"))).toBe(true);
  });

  it("lets a team change anything else", async () => {
    const calls = answering({ is_team: true });
    await patchFundraiser(40, { title: "Exampleton Juniors Dashers" }, "admin:kim@example.com");
    expect(calls.some(([s]) => s.startsWith("UPDATE fundraisers"))).toBe(true);
  });
});

import { moveFundraiser, claimNextWaitingLiveEmail } from "../../src/db/fundraisers";

describe("approving a team while fundraising is off (review)", () => {
  it("always waits for the switch, page or not", async () => {
    const calls = useClient((sql) => {
      if (sql.includes("FOR UPDATE") && sql.includes("FROM fundraisers f")) return { rows: [row({ status: "new", is_team: true, public: false })] };
      if (sql.includes("FROM fundraising_settings")) return { rows: [{ page_on: false }] };
      if (sql.includes("WHERE f.id = $1")) return { rows: [row({ is_team: true })] };
      return undefined;
    });
    const r = await moveFundraiser(40, "approve", "admin:kim@example.com");
    expect(r.livePending).toBe(true);
    expect(calls.find(([s]) => s.includes("SET status = 'approved'"))![1][1]).toBe(true);
  });

  it("is among those waiting for their live email", async () => {
    (pool.query as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: [] });
    await claimNextWaitingLiveEmail(0);
    expect(String((pool.query as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0])).toContain("(is_team OR (public AND path IN ('raising', 'event')))");
  });
});

describe("correcting a team's split, with whose split it is (review)", () => {
  const sharing = { sharesWithOther: true, nbccSharePercent: 70, otherCauseName: "Exampleton Food Larder" };
  function answering(locked: Record<string, unknown>, members: number[] = [41]) {
    return useClient((sql) => {
      if (sql.includes("FOR UPDATE") && sql.includes("FROM fundraisers f")) return { rows: [row(locked)] };
      if (sql.includes("SELECT id FROM fundraisers WHERE team_id")) return { rows: members.map((id) => ({ id })) };
      if (sql.includes("FROM donations") || sql.includes("FROM fundraiser_cash")) return { rows: [{ n: "0" }] };
      if (sql.includes("WHERE f.id = $1")) return { rows: [row(locked)] };
      return undefined;
    });
  }

  it("asks whose split it is when a team shares", async () => {
    answering({ is_team: true, shares_with_other: false });
    await expect(setFundraiserSplit(40, sharing, "admin:kim@example.com")).rejects.toMatchObject({ reason: "team_mode_missing" });
  });

  it("turning sharing on for the whole team sets the mode and every member's split", async () => {
    const calls = answering({ is_team: true, shares_with_other: false });
    await setFundraiserSplit(40, sharing, "admin:kim@example.com", "team");
    expect(calls.find(([s]) => s.includes("SET team_share_mode = $2"))![1]).toEqual([40, "team"]);
    expect(calls.some(([s]) => s.startsWith("UPDATE fundraisers") && s.includes("team_id = $"))).toBe(true);
    expect(calls.find(([s]) => s.includes("FROM donations"))![1]).toEqual([[40, 41]]);
  });

  it("just the team organiser's leaves the members alone", async () => {
    const calls = answering({ is_team: true, shares_with_other: false });
    await setFundraiserSplit(40, sharing, "admin:kim@example.com", "organiser");
    expect(calls.find(([s]) => s.includes("SET team_share_mode = $2"))![1]).toEqual([40, "organiser"]);
    expect(calls.some(([s]) => s.startsWith("UPDATE fundraisers") && s.includes("team_id = $"))).toBe(false);
  });

  it("never sets a mode on a page that is not a team", async () => {
    const calls = answering({ is_team: false });
    await setFundraiserSplit(9, sharing, "admin:kim@example.com", "team");
    expect(calls.some(([s]) => s.includes("SET team_share_mode = $2"))).toBe(false);
  });
});
