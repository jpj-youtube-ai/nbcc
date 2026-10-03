import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-515: the SQL behind keeping in touch, against a mocked pool (no database): the Automatic
// emails switch (off unless the row says on, and off when it cannot be read), claiming an email
// once per fundraiser, giving it back after a failed send, the calls about a prompt, and the facts
// the rules read. Every name and address is invented.

const { query, connect } = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn() }));
const { listAllFundraisers, getFundraiser, listFundraisersWhere } = vi.hoisted(() => ({
  listAllFundraisers: vi.fn(),
  getFundraiser: vi.fn(),
  listFundraisersWhere: vi.fn(),
}));
vi.mock("../../src/db/pool", () => ({ pool: { query, connect } }));
vi.mock("../../src/config", () => ({ config: { NODE_ENV: "test" } }));
vi.mock("../../src/db/fundraisers", () => ({ listAllFundraisers, getFundraiser, listFundraisersWhere }));

import {
  clearFinishedPending,
  markFinishedPending,
  touchFundraiser,
  approveWording,
  approvedWordingKeys,
  listWordingApprovals,
  withdrawWording,
  claimTouch,
  getTouchSettings,
  readTouchState,
  recordPromptCall,
  recordTouchSent,
  releaseTouch,
  setTouchEmailsOn,
  touchEmailsOn,
} from "../../src/db/fundraising-touch";
import { listFundraiserCalls } from "../../src/db/fundraising-team";

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
  listAllFundraisers.mockReset().mockResolvedValue([]);
  getFundraiser.mockReset();
  listFundraisersWhere.mockReset().mockResolvedValue([]);
});

describe("the Automatic emails switch", () => {
  it("reads it, off when there is no row", async () => {
    query.mockResolvedValueOnce({ rows: [{ touch_emails_on: true, touch_emails_updated_at: new Date("2026-10-03T09:00:00Z"), touch_emails_updated_by: "admin:fern@example.com" }] });
    expect(await getTouchSettings()).toEqual({ on: true, updatedAt: "2026-10-03T09:00:00.000Z", updatedBy: "admin:fern@example.com" });
    query.mockResolvedValueOnce({ rows: [] });
    expect(await getTouchSettings()).toEqual({ on: false, updatedAt: null, updatedBy: null });
  });

  it("reads as off when it cannot be read, so nothing is sent", async () => {
    query.mockRejectedValueOnce(new Error("connection lost"));
    expect(await touchEmailsOn()).toBe(false);
  });

  it("is switched with who did it, and a History row", async () => {
    const calls = useClient((sql) =>
      /SELECT touch_emails_on/.test(sql) ? { rows: [{ touch_emails_on: true, touch_emails_updated_at: new Date("2026-10-03T09:00:00Z"), touch_emails_updated_by: "admin:fern@example.com" }] } : undefined,
    );
    const s = await setTouchEmailsOn(true, "admin:fern@example.com");
    const write = sqlIn(calls, /INSERT INTO fundraising_settings/)!;
    expect(write[0]).toMatch(/ON CONFLICT \(id\) DO UPDATE SET touch_emails_on = \$1/);
    expect(write[1]).toEqual([true, "admin:fern@example.com"]);
    expect(audits(calls)[0]).toEqual(["admin:fern@example.com", "fundraising.touch_emails_switched", "fundraising_settings", 1, { on: true }]);
    expect(s.on).toBe(true);
    expect(calls.map((c) => c[0])).toContain("COMMIT");
  });
});

describe("once per fundraiser", () => {
  it("claims an email before it is sent, and only if it has never been claimed", async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 3 }] });
    expect(await claimTouch(9, "halfway", "system:schedule")).toBe(true);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO fundraiser_touchpoints \(fundraiser_id, kind, sent_by\)/);
    expect(sql).toMatch(/ON CONFLICT \(fundraiser_id, kind\) DO NOTHING/);
    expect(params).toEqual([9, "halfway", "system:schedule"]);
    query.mockResolvedValueOnce({ rows: [] });
    expect(await claimTouch(9, "halfway", "system:schedule")).toBe(false);
  });

  it("gives a claim back after a failed send", async () => {
    await releaseTouch(9, "halfway");
    expect(String(query.mock.calls[0][0])).toMatch(/DELETE FROM fundraiser_touchpoints WHERE fundraiser_id = \$1 AND kind = \$2/);
    expect(query.mock.calls[0][1]).toEqual([9, "halfway"]);
  });

  it("records a sent email in the fundraiser's History", async () => {
    const calls = useClient(() => undefined);
    await recordTouchSent(9, "halfway", "system:schedule");
    expect(audits(calls)[0]).toEqual(["system:schedule", "fundraiser.touch_sent", "fundraiser", 9, { kind: "halfway" }]);
  });
});

describe("calls about a prompt", () => {
  it("records the call in TASK-503's calls, as a prompt, with its History row", async () => {
    const calls = useClient((sql) =>
      /INSERT INTO fundraiser_calls/.test(sql)
        ? { rows: [{ prompt: "behind", called_at: new Date("2026-11-28T10:00:00Z"), called_by: "fern@example.com", note: "Posters on the way" }] }
        : undefined,
    );
    const call = await recordPromptCall(9, "behind", "Posters on the way", "fern@example.com", "admin:fern@example.com");
    const insert = sqlIn(calls, /INSERT INTO fundraiser_calls/)!;
    expect(insert[0]).toMatch(/\(fundraiser_id, which, prompt, called_by, note\)/);
    expect(insert[0]).toMatch(/SELECT f\.id, 'prompt', \$2, \$3, \$4 FROM fundraisers f WHERE f\.id = \$1/);
    expect(insert[1]).toEqual([9, "behind", "fern@example.com", "Posters on the way"]);
    expect(audits(calls)[0]).toEqual(["admin:fern@example.com", "fundraiser.prompt_called", "fundraiser", 9, { prompt: "behind", note: "Posters on the way" }]);
    expect(call).toEqual({ prompt: "behind", calledAt: "2026-11-28T10:00:00.000Z", calledBy: "fern@example.com", note: "Posters on the way" });
  });

  it("keeps them out of TASK-503's calls before and after a date", async () => {
    await listFundraiserCalls();
    expect(String(query.mock.calls[0][0])).toMatch(/WHERE which IN \('before', 'after'\)/);
  });

  it("refuses a fundraiser that is not there", async () => {
    useClient(() => undefined);
    await expect(recordPromptCall(9, "quiet", null, "fern@example.com", "admin:fern@example.com")).rejects.toMatchObject({ reason: "not_found" });
  });
});

describe("the facts the rules read", () => {
  it("gathers gifts (never money paid in), when it finished, what has been sent, and the prompt calls", async () => {
    listAllFundraisers.mockResolvedValue([{ id: 9, title: "Robin's Walk" }, { id: 10, title: "Jo's Quiz" }]);
    query.mockImplementation(async (sql: string) => {
      if (/FROM donations/.test(sql)) {
        return { rows: [{ fundraiser_id: 9, first_at: new Date("2026-10-19T21:00:00Z"), last_at: new Date("2026-11-02T08:00:00Z") }] };
      }
      if (/fundraiser\.finished/.test(sql)) return { rows: [{ fundraiser_id: 10, finished_at: new Date("2026-12-07T10:00:00Z") }] };
      if (/touch_finished_pending IS NOT NULL/.test(sql)) return { rows: [{ id: 10, touch_finished_pending: "held" }] };
      if (/FROM fundraiser_touchpoints/.test(sql)) return { rows: [{ fundraiser_id: 9, kind: "first_gift", sent_at: new Date("2026-10-20T07:00:00Z") }] };
      if (/FROM fundraiser_calls/.test(sql)) {
        return { rows: [{ fundraiser_id: 10, prompt: "tin", called_at: new Date("2026-11-01T10:00:00Z"), called_by: "fern@example.com", note: null }] };
      }
      return { rows: [] };
    });
    const state = await readTouchState();
    const gifts = String(query.mock.calls.find((c) => /FROM donations/.test(String(c[0])))![0]);
    expect(gifts).toMatch(/NOT d\.paid_in_by_organiser/);
    expect(gifts).toMatch(/payment_status = 'paid'/);
    expect(gifts).toMatch(/donation\.payment_succeeded/);
    expect(String(query.mock.calls.find((c) => /FROM fundraiser_calls/.test(String(c[0])))![0])).toMatch(/which = 'prompt'/);
    expect(state).toEqual([
      {
        f: { id: 9, title: "Robin's Walk" },
        touch: {
          firstOnlineGiftAt: "2026-10-19T21:00:00.000Z",
          lastOnlineGiftAt: "2026-11-02T08:00:00.000Z",
          finishedAt: null,
          finishedPending: null,
          sent: [{ kind: "first_gift", sentAt: "2026-10-20T07:00:00.000Z" }],
        },
        prompt: { lastOnlineGiftAt: "2026-11-02T08:00:00.000Z", calls: [] },
      },
      {
        f: { id: 10, title: "Jo's Quiz" },
        touch: { firstOnlineGiftAt: null, lastOnlineGiftAt: null, finishedAt: "2026-12-07T10:00:00.000Z", finishedPending: "held", sent: [] },
        prompt: {
          lastOnlineGiftAt: null,
          calls: [{ prompt: "tin", calledAt: "2026-11-01T10:00:00.000Z", calledBy: "fern@example.com", note: null }],
        },
      },
    ]);
  });
});

// Team pages (Jaimie, 2026-10-03): the automatic emails (halfway, target reached and the rest) read
// a team's whole total against the team's target; its members keep their own.
import { meter as teamMeterOf } from "../../src/fundraising/model";

describe("a team, for the automatic emails", () => {
  it("is judged on the whole team's total and the team's target", async () => {
    const m = (raised: number, target: number | null) => teamMeterOf({ onlinePence: raised, cashPence: 0, targetPence: target });
    listAllFundraisers.mockResolvedValue([
      { id: 40, status: "approved", isTeam: true, targetPence: 10000, meter: m(1000, 10000) },
      { id: 41, status: "approved", teamId: 40, targetPence: 5000, meter: m(4500, 5000) },
    ]);
    const state = await readTouchState();
    expect(state.find((s) => s.f.id === 40)!.f.meter).toMatchObject({ raisedPence: 5500, targetPence: 10000, percent: 55 });
    expect(state.find((s) => s.f.id === 41)!.f.meter.raisedPence).toBe(4500);
  });
});

describe("a team's gifts, for first gift and gone quiet (review)", () => {
  it("are its own and its current members' together; members keep their own", async () => {
    listAllFundraisers.mockResolvedValue([
      { id: 40, status: "approved", isTeam: true, targetPence: 10000, meter: teamMeterOf({ onlinePence: 0, cashPence: 0, targetPence: 10000 }) },
      { id: 41, status: "approved", teamId: 40, targetPence: 5000, meter: teamMeterOf({ onlinePence: 2000, cashPence: 0, targetPence: 5000 }) },
      { id: 42, status: "approved", teamId: 40, teamLeftAt: "2026-10-01T00:00:00Z", targetPence: 5000, meter: teamMeterOf({ onlinePence: 0, cashPence: 0, targetPence: 5000 }) },
    ]);
    query.mockImplementation(async (sql: string) =>
      /FROM donations/.test(sql)
        ? {
            rows: [
              { fundraiser_id: 41, first_at: new Date("2026-10-10T10:00:00Z"), last_at: new Date("2026-10-20T10:00:00Z") },
              { fundraiser_id: 42, first_at: new Date("2026-09-01T10:00:00Z"), last_at: new Date("2026-11-01T10:00:00Z") },
            ],
          }
        : { rows: [] },
    );
    const state = await readTouchState();
    const team = state.find((s) => s.f.id === 40)!;
    expect(team.touch.firstOnlineGiftAt).toBe("2026-10-10T10:00:00.000Z");
    expect(team.touch.lastOnlineGiftAt).toBe("2026-10-20T10:00:00.000Z");
    expect(team.prompt.lastOnlineGiftAt).toBe("2026-10-20T10:00:00.000Z");
    expect(state.find((s) => s.f.id === 41)!.touch.firstOnlineGiftAt).toBe("2026-10-10T10:00:00.000Z");
  });
});

describe("signing off the new wording (Jaimie, 2026-10-03)", () => {
  it("lists the approvals, with who and when", async () => {
    query.mockResolvedValueOnce({ rows: [{ key: "target", approved_at: new Date("2026-10-03T11:00:00Z"), approved_by: "Jaimie" }] });
    expect(await listWordingApprovals()).toEqual([{ key: "target", approvedAt: "2026-10-03T11:00:00.000Z", approvedBy: "Jaimie" }]);
    expect(query.mock.calls[0][0]).toMatch(/FROM touch_wording_approvals/);
  });

  it("reads the approved keys, and none when they cannot be read, so no new wording is sent by mistake", async () => {
    query.mockResolvedValueOnce({ rows: [{ key: "target", approved_at: new Date(), approved_by: "Jaimie" }, { key: "on_track", approved_at: new Date(), approved_by: "Jaimie" }] });
    expect([...(await approvedWordingKeys())].sort()).toEqual(["on_track", "target"]);
    query.mockRejectedValueOnce(new Error("connection lost"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await approvedWordingKeys()).size).toBe(0);
  });

  it("approves a wording with who did it, and a History row, in one transaction", async () => {
    const calls = useClient((sql) =>
      /INSERT INTO touch_wording_approvals/.test(sql) ? { rows: [{ key: "finished", approved_at: new Date("2026-10-04T09:00:00Z"), approved_by: "admin:fern@example.com" }] } : undefined,
    );
    const a = await approveWording("finished", "admin:fern@example.com");
    expect(a).toEqual({ key: "finished", approvedAt: "2026-10-04T09:00:00.000Z", approvedBy: "admin:fern@example.com" });
    const write = sqlIn(calls, /INSERT INTO touch_wording_approvals/)!;
    expect(write[0]).toMatch(/ON CONFLICT \(key\) DO NOTHING/);
    expect(write[1]).toEqual(["finished", "admin:fern@example.com"]);
    expect(audits(calls)[0]).toEqual(["admin:fern@example.com", "fundraising.touch_wording_approved", "fundraising_settings", 1, { key: "finished" }]);
    expect(calls.map((c) => c[0])).toContain("COMMIT");
  });

  it("approving one already approved keeps the first approval, and writes no second History row", async () => {
    const calls = useClient((sql) =>
      /SELECT key, approved_at/.test(sql) ? { rows: [{ key: "target", approved_at: new Date("2026-10-03T11:00:00Z"), approved_by: "Jaimie" }] } : undefined,
    );
    const a = await approveWording("target", "admin:fern@example.com");
    expect(a).toEqual({ key: "target", approvedAt: "2026-10-03T11:00:00.000Z", approvedBy: "Jaimie" });
    expect(audits(calls)).toEqual([]);
  });

  it("withdraws an approval with a History row saying whose approval it was", async () => {
    const calls = useClient((sql) =>
      /DELETE FROM touch_wording_approvals/.test(sql) ? { rows: [{ key: "on_track", approved_at: new Date("2026-10-03T11:00:00Z"), approved_by: "Jaimie" }] } : undefined,
    );
    expect(await withdrawWording("on_track", "admin:fern@example.com")).toBe(true);
    expect(sqlIn(calls, /DELETE FROM touch_wording_approvals/)![1]).toEqual(["on_track"]);
    expect(audits(calls)[0]).toEqual([
      "admin:fern@example.com",
      "fundraising.touch_wording_withdrawn",
      "fundraising_settings",
      1,
      { key: "on_track", approvedAt: "2026-10-03T11:00:00.000Z", approvedBy: "Jaimie" },
    ]);
  });

  // Invite types: the in memory invite's sign off is kept in the same table, with its own History
  // actions, so History says it was invite wording and not an automatic email's.
  it("records an approval or a withdrawal under the action it is given", async () => {
    let calls = useClient((sql) =>
      /INSERT INTO touch_wording_approvals/.test(sql) ? { rows: [{ key: "invite_memory", approved_at: new Date("2026-10-04T09:00:00Z"), approved_by: "admin:fern@example.com" }] } : undefined,
    );
    await approveWording("invite_memory", "admin:fern@example.com", "fundraising.invite_wording_approved");
    expect(audits(calls)[0]).toEqual(["admin:fern@example.com", "fundraising.invite_wording_approved", "fundraising_settings", 1, { key: "invite_memory" }]);
    calls = useClient((sql) =>
      /DELETE FROM touch_wording_approvals/.test(sql) ? { rows: [{ key: "invite_memory", approved_at: new Date("2026-10-04T09:00:00Z"), approved_by: "admin:fern@example.com" }] } : undefined,
    );
    expect(await withdrawWording("invite_memory", "admin:fern@example.com", "fundraising.invite_wording_withdrawn")).toBe(true);
    expect(audits(calls)[0].slice(0, 2)).toEqual(["admin:fern@example.com", "fundraising.invite_wording_withdrawn"]);
  });

  it("withdrawing one not approved changes nothing and writes no History row", async () => {
    const calls = useClient(() => undefined);
    expect(await withdrawWording("finished_zero", "admin:fern@example.com")).toBe(false);
    expect(audits(calls)).toEqual([]);
  });
});

describe("the thank you to catch up (review)", () => {
  it("marks one held for sign off, or whose send failed, with when", async () => {
    await markFinishedPending(9, "held");
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/UPDATE fundraisers SET touch_finished_pending = \$2, touch_finished_pending_at = now\(\) WHERE id = \$1/);
    expect(params).toEqual([9, "held"]);
  });

  it("clears the mark once it has gone", async () => {
    await clearFinishedPending(9);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/UPDATE fundraisers SET touch_finished_pending = NULL, touch_finished_pending_at = NULL WHERE id = \$1/);
    expect(params).toEqual([9]);
  });
});

describe("one fundraiser, as the automatic emails see it (review: team pages)", () => {
  const m = (raised: number, target: number | null) => teamMeterOf({ onlinePence: raised, cashPence: 0, targetPence: target });

  it("gives a team page the whole team's total, as the daily run does: members £500, the team page £0", async () => {
    getFundraiser.mockResolvedValue({ id: 40, status: "finished", isTeam: true, targetPence: 100000, meter: m(0, 100000) });
    listFundraisersWhere.mockResolvedValue([
      { id: 41, status: "approved", teamId: 40, targetPence: 30000, meter: m(30000, 30000) },
      { id: 42, status: "finished", teamId: 40, targetPence: 30000, meter: m(20000, 30000) },
      { id: 43, status: "approved", teamId: 40, teamLeftAt: "2026-10-01T00:00:00Z", targetPence: 30000, meter: m(9900, 30000) },
      { id: 44, status: "new", teamId: 40, targetPence: 30000, meter: m(7700, 30000) },
    ]);
    const f = await touchFundraiser(40);
    expect(f!.meter).toMatchObject({ raisedPence: 50000, targetPence: 100000 });
    expect(listFundraisersWhere).toHaveBeenCalledWith("f.team_id = $1", [40]);
  });

  it("gives everyone else their own, and null for one not there", async () => {
    getFundraiser.mockResolvedValue({ id: 41, status: "approved", teamId: 40, targetPence: 30000, meter: m(30000, 30000) });
    expect((await touchFundraiser(41))!.meter.raisedPence).toBe(30000);
    expect(listFundraisersWhere).not.toHaveBeenCalled();
    getFundraiser.mockResolvedValue(null);
    expect(await touchFundraiser(99)).toBeNull();
  });
});
