import { describe, it, expect, vi } from "vitest";

// Team pages (Jaimie, 2026-10-03): the daily team pass, part of the automatic emails. The names and
// emails of the people a team organiser added are deleted on time EVERY day, whatever the switches.
// The emails go only while Automatic emails and fundraising are both on: the team organiser's nudge
// on day 3 (and day 10 if still nobody has joined), and ONE gentle reminder to an invite 5 days on.
// Never to an address that asked us to stop; each claimed before it is sent, so once each; a failed
// send is given back. Every name and address here is invented.

vi.mock("../../src/config", () => ({ config: { NODE_ENV: "test", PORTAL_BASE_URL: "https://nbcc.scot", BALL_FROM_EMAIL: "events@nbcc.scot" } }));
vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));

import { runTeamEmails, type TeamRunDeps } from "../../src/fundraising/team-runner";
import type { FundraiserRecord } from "../../src/fundraising/model";

const NOW = new Date("2026-10-20T08:00:00Z");

const team = (over: Partial<FundraiserRecord> = {}) =>
  ({
    id: 40, slug: "ej", path: "raising", kind: "santa_dash", kindLabel: "Santa dash", title: "Exampleton Juniors", eventDate: "2026-12-05",
    status: "approved", public: true, name: "Robin Organiser", email: "robin@example.com", isTeam: true,
    approvedAt: "2026-10-17T10:00:00Z", teamNudge1At: null, teamNudge2At: null, ...over,
  }) as FundraiserRecord;

const invite = (over: Record<string, unknown> = {}) => ({
  id: 7, teamId: 40, firstName: "Jack", lastName: "Sample", email: "parent@example.com", createdAt: "2026-10-10T10:00:00Z",
  sentAt: "2026-10-14T10:00:00Z", remindedAt: null, joinedAt: null, deletedAt: null, joinedFundraiserId: null, team: team(), ...over,
});

function deps(over: Partial<TeamRunDeps> = {}) {
  const sent: Array<{ kind: string; to: string; subject: string; text: string }> = [];
  const d: TeamRunDeps = {
    touchOn: vi.fn(async () => true),
    fundraisingOn: vi.fn(async () => true),
    deleteDue: vi.fn(async () => 2),
    clearHandovers: vi.fn(async () => 1),
    readState: vi.fn(async () => ({ teams: [{ team: team() as never, joined: 0 }], invites: [invite() as never] })),
    blocked: vi.fn(async () => false),
    claimNudge: vi.fn(async () => true),
    releaseNudge: vi.fn(async () => undefined),
    claimReminder: vi.fn(async () => true),
    releaseReminder: vi.fn(async () => undefined),
    newToken: vi.fn(() => "r".repeat(43)),
    send: vi.fn(async (kind, _n, m) => {
      sent.push({ kind, to: m.email, subject: m.subject, text: m.text });
    }),
    ...over,
  };
  return { d, sent };
}

describe("the daily team pass", () => {
  it("deletes on time, nudges on day 3, and reminds an invite once after 5 days", async () => {
    const { d, sent } = deps();
    const r = await runTeamEmails(NOW, d);
    expect(d.deleteDue).toHaveBeenCalledWith("2026-10-20");
    expect(r).toMatchObject({ deleted: 2, nudges: 1, reminders: 1, failed: 0 });
    expect(sent.map((s) => [s.kind, s.to])).toEqual([
      ["fundraiseTeamNudge", "robin@example.com"],
      ["fundraiseTeamInviteReminder", "parent@example.com"],
    ]);
    expect(d.claimNudge).toHaveBeenCalledWith(40, 1);
    expect(sent[0].subject).toBe("Did you send the invite to your team?");
    expect(sent[1].text).toContain(`https://nbcc.scot/fundraise/ej/join?invite=${"r".repeat(43)}`);
    expect(d.claimReminder).toHaveBeenCalledWith(7, expect.stringMatching(/^[0-9a-f]{64}$/));
  });

  it("reminds the parent or guardian when the team organiser ticked under 18", async () => {
    const { d, sent } = deps({ readState: vi.fn(async () => ({ teams: [], invites: [invite({ under18: true }) as never] })) });
    await runTeamEmails(NOW, d);
    expect(sent[0].subject).toBe("A gentle reminder: Jack is invited to join Exampleton Juniors");
  });

  it("still deletes, and sends nothing, while Automatic emails is off", async () => {
    const { d, sent } = deps({ touchOn: vi.fn(async () => false) });
    const r = await runTeamEmails(NOW, d);
    expect(d.deleteDue).toHaveBeenCalled();
    expect(r).toMatchObject({ deleted: 2, skipped: "switched off" });
    expect(sent).toEqual([]);
    expect(d.readState).not.toHaveBeenCalled();
  });

  it("sends nothing while fundraising is off", async () => {
    const { d, sent } = deps({ fundraisingOn: vi.fn(async () => false) });
    expect((await runTeamEmails(NOW, d)).skipped).toBe("fundraising off");
    expect(sent).toEqual([]);
  });

  it("never emails an address that asked us to stop", async () => {
    const { d, sent } = deps({ blocked: vi.fn(async () => true) });
    await runTeamEmails(NOW, d);
    expect(sent).toEqual([]);
    expect(d.claimNudge).not.toHaveBeenCalled();
    expect(d.claimReminder).not.toHaveBeenCalled();
  });

  it("sends nothing claimed already, and gives back one whose send failed", async () => {
    const { d } = deps({
      claimNudge: vi.fn(async () => false),
      send: vi.fn(async () => Promise.reject(new Error("SES down"))),
    });
    const r = await runTeamEmails(NOW, d);
    expect(r.nudges).toBe(0);
    expect(r.failed).toBe(1);
    expect(d.releaseReminder).toHaveBeenCalledWith(7);
  });

  it("does not nudge once someone has joined, or remind a team no longer approved", async () => {
    const { d, sent } = deps({
      readState: vi.fn(async () => ({ teams: [{ team: team() as never, joined: 1 }], invites: [invite({ team: team({ status: "finished" }) }) as never] })),
    });
    await runTeamEmails(NOW, d);
    expect(sent).toEqual([]);
  });

  it("still sends the rest when one read of the opt out lists fails", async () => {
    const { d, sent } = deps({ blocked: vi.fn(async (e: string) => (e === "robin@example.com" ? Promise.reject(new Error("db")) : false)) });
    await runTeamEmails(NOW, d);
    expect(sent.map((s) => s.to)).toEqual(["parent@example.com"]);
  });

  it("never throws", async () => {
    const { d } = deps({ deleteDue: vi.fn(async () => Promise.reject(new Error("db"))), readState: vi.fn(async () => Promise.reject(new Error("db"))) });
    await expect(runTeamEmails(NOW, d)).resolves.toMatchObject({ deleted: 0, skipped: "could not read" });
  });
});

// The daily 8am job (src/scripts/send-reminders.ts) only runs when started directly, so its wiring
// is read from the source, as fundraising-touch-runner.test.ts does.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("the daily 8am job", () => {
  const source = readFileSync(resolve(__dirname, "../../src/scripts/send-reminders.ts"), "utf8");

  it("runs the team pass inside its own try/catch, before the pool is closed", () => {
    const at = source.indexOf("runTeamEmails(");
    expect(at, "send-reminders.ts never runs the team pass").toBeGreaterThan(-1);
    const before = source.lastIndexOf("try {", at);
    const catchAt = source.indexOf("} catch (err) {", at);
    expect(source.slice(before, catchAt).match(/await import\(/g)).toHaveLength(1);
    expect(source.slice(catchAt, catchAt + 120)).toContain("fundraising team emails");
    expect(at).toBeLessThan(source.indexOf("await pool.end();"));
  });
});

describe("the daily team pass, after review", () => {
  it("clears old handovers every day, whatever the switches", async () => {
    const { d } = deps({ touchOn: vi.fn(async () => false) });
    const r = await runTeamEmails(NOW, d);
    expect(d.clearHandovers).toHaveBeenCalled();
    expect(r.handoversCleared).toBe(1);
  });

  it("names nobody in the email log for a reminder", async () => {
    const { d } = deps();
    await runTeamEmails(NOW, d);
    const reminder = (d.send as ReturnType<typeof vi.fn>).mock.calls.find((c) => c[0] === "fundraiseTeamInviteReminder")!;
    expect(reminder[1]).toBeNull();
  });
});
