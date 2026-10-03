import { describe, it, expect, vi } from "vitest";

// In memory pages and team pages (Jaimie, 2026-10-03): an in memory page is always just the one
// page, never a team or on one. The sign up refuses it, the database refuses it, and should a row
// ever say otherwise, the daily team pass never emails about it and a team's member cards never show
// an in memory page's target. Every name and address here is invented.

vi.mock("../../src/config", () => ({ config: { NODE_ENV: "test", PORTAL_BASE_URL: "https://nbcc.scot", BALL_FROM_EMAIL: "events@nbcc.scot" } }));
vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));

import { runTeamEmails, type TeamRunDeps } from "../../src/fundraising/team-runner";
import { teamMemberList } from "../../src/fundraising/teams";
import { meter, type FundraiserRecord } from "../../src/fundraising/model";

const NOW = new Date("2026-10-20T08:00:00Z");
const team = (over: Partial<FundraiserRecord> = {}) =>
  ({
    id: 40, slug: "ime", path: "raising", kind: "other", title: "In memory of Margaret Exampleton", eventDate: "2026-12-05", status: "approved",
    public: true, name: "Robin Organiser", email: "robin@example.com", isTeam: true, approvedAt: "2026-10-17T10:00:00Z", teamNudge1At: null,
    teamNudge2At: null, inMemory: true, memoryName: "Margaret Exampleton", ...over,
  }) as FundraiserRecord;

function deps() {
  const send = vi.fn(async () => undefined);
  const d: TeamRunDeps = {
    touchOn: vi.fn(async () => true),
    fundraisingOn: vi.fn(async () => true),
    deleteDue: vi.fn(async () => 0),
    clearHandovers: vi.fn(async () => 0),
    readState: vi.fn(async () => ({
      teams: [{ team: team() as never, joined: 0 }],
      invites: [{ id: 7, teamId: 40, firstName: "Jack", lastName: "Sample", email: "parent@example.com", createdAt: "2026-10-10T10:00:00Z",
        sentAt: "2026-10-14T10:00:00Z", remindedAt: null, joinedAt: null, deletedAt: null, joinedFundraiserId: null, team: team() } as never],
    })),
    blocked: vi.fn(async () => false),
    claimNudge: vi.fn(async () => true),
    releaseNudge: vi.fn(async () => undefined),
    claimReminder: vi.fn(async () => true),
    releaseReminder: vi.fn(async () => undefined),
    newToken: vi.fn(() => "r".repeat(43)),
    send,
  };
  return { d, send };
}

describe("an in memory page and teams", () => {
  it("is never nudged or reminded about by the daily team pass", async () => {
    const { d, send } = deps();
    const r = await runTeamEmails(NOW, d);
    expect(send).not.toHaveBeenCalled();
    expect(r).toMatchObject({ nudges: 0, reminders: 0 });
  });

  it("never shows its target on a team's member cards", () => {
    const cards = teamMemberList([
      { id: 1, slug: "ime", name: "Robin Organiser", status: "approved", public: true, path: "raising", inMemory: true, memoryShowTarget: false,
        meter: meter({ onlinePence: 2000, cashPence: 0, targetPence: 50000 }) } as never,
    ]);
    expect(cards[0].meter.targetPence).toBeNull();
    expect(cards[0].meter.percent).toBeNull();
  });

  it("is refused as a team, and as a team's member, by the database", async () => {
    const { createRequire } = await import("node:module");
    const { resolve } = await import("node:path");
    const migration = createRequire(import.meta.url)(resolve(__dirname, "../../migrations/1791200000195_in-memory.js"));
    const checks: string[] = [];
    migration.up({
      addColumns: () => undefined,
      createIndex: () => undefined,
      addConstraint: (_t: string, _n: string, o: { check: string }) => checks.push(o.check),
      sql: () => undefined,
    });
    expect(checks.join(" ")).toContain("in_memory IS NOT TRUE OR (is_team IS NOT TRUE AND team_id IS NULL)");
  });
});
