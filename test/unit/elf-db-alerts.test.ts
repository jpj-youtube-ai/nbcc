import { describe, it, expect, vi, beforeEach } from "vitest";

// NBCC Elf Detective School wave 2: the alerts data layer. There is no local database, so these read
// the SQL and parameters each function sends; the BDD proves them in CI.

const { query, clientQuery, release } = vi.hoisted(() => ({
  query: vi.fn(),
  clientQuery: vi.fn(),
  release: vi.fn(),
}));
vi.mock("../../src/db/pool", () => ({
  pool: { query, connect: async () => ({ query: clientQuery, release }) },
}));
vi.mock("../../src/db/admin-users", () => ({ listUsers: vi.fn() }));

import { headElfNamesOf, lastAlert, listHeadElves, oldestWaitingPhotoAt, recordAlert, setMyAlerts } from "../../src/db/elf-alerts";
import { listUsers } from "../../src/db/admin-users";

const ACTOR = "admin:alex@example.org";

beforeEach(() => {
  query.mockReset();
  clientQuery.mockReset();
  release.mockReset();
  clientQuery.mockResolvedValue({ rows: [], rowCount: 0 });
});

describe("the head elves", () => {
  it("joins the users who may see the school to their mobile and tick", async () => {
    vi.mocked(listUsers).mockResolvedValue([
      { id: 4, email: "alex@example.org", full_name: "Alex Example", role: "admin", status: "active", invited_at: null, last_login_at: null, permissions: {} },
    ]);
    query.mockResolvedValue({ rows: [{ user_id: 4, mobile: "+447700900123", alerts_on: false }] });
    const elves = await listHeadElves();
    expect(String(query.mock.calls[0][0])).toContain("FROM elf_head_elves");
    expect(elves).toEqual([{ userId: 4, name: "Alex Example", email: "alex@example.org", mobile: "+447700900123", alertsOn: false }]);
  });

  it("leaves out an admin who has been invited but has not yet signed in, so the alerts never reach them", async () => {
    vi.mocked(listUsers).mockResolvedValue([
      { id: 4, email: "alex@example.org", full_name: "Alex Example", role: "admin", status: "active", invited_at: null, last_login_at: new Date("2026-11-01T10:00:00Z"), permissions: {} },
      { id: 5, email: "jo@example.org", full_name: "Jo Example", role: "admin", status: "invited", invited_at: new Date("2026-11-10T10:00:00Z"), last_login_at: null, permissions: {} },
    ]);
    query.mockResolvedValue({ rows: [] });
    expect((await listHeadElves()).map((e) => e.email)).toEqual(["alex@example.org"]);
  });
});

// Who did something, by name: the photo log's steps and Doors' snow day and gone home lines both read it.
describe("a head elf's name, from the actor a change was made under", () => {
  it("is their full name, or their email when that is blank or there is no users row, read once for them all", async () => {
    query.mockResolvedValue({ rows: [{ full_name: "Alex Example", email: "Alex@Example.org" }, { full_name: " ", email: "jo@example.org" }] });
    const name = await headElfNamesOf(["admin:alex@example.org", "admin:JO@example.org", "admin:gone@example.org", null, "admin:alex@example.org"]);
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    expect(String(sql)).toContain("SELECT full_name, email FROM users WHERE lower(email) = ANY($1::text[])");
    expect(params).toEqual([["alex@example.org", "jo@example.org", "gone@example.org"]]);
    expect(name("admin:alex@example.org")).toBe("Alex Example");
    expect(name("admin:JO@example.org")).toBe("jo@example.org");
    expect(name("admin:gone@example.org")).toBe("gone@example.org");
  });

  it("reads nothing when no one but the system did it, and gives other actors back as they are", async () => {
    const name = await headElfNamesOf(["automatic", null, undefined]);
    expect(query).not.toHaveBeenCalled();
    expect(name("automatic")).toBe("automatic");
    expect(name(null)).toBe("");
  });
});

describe("setMyAlerts", () => {
  it("upserts the mobile and the tick, and notes the field names only", async () => {
    await setMyAlerts(4, { mobile: "+447700900123", alertsOn: false }, ACTOR);
    const calls = clientQuery.mock.calls.map((c) => [String(c[0]), c[1] as unknown[]]);
    const upsert = calls.find(([s]) => /INSERT INTO elf_head_elves/.test(s))!;
    expect(upsert[0]).toContain("ON CONFLICT (user_id) DO UPDATE");
    expect(upsert[1]).toEqual(expect.arrayContaining([4, "+447700900123", false, ACTOR]));
    const audit = calls.find(([s]) => /INSERT INTO audit_log/.test(s))!;
    expect(audit[1]).toEqual([ACTOR, "elf.alerts.changed", "elf_head_elves", 4, { fields: ["mobile", "alertsOn"] }]);
    expect(JSON.stringify(audit[1])).not.toContain("7700900123");
    expect(calls.map(([s]) => s)).toContain("COMMIT");
  });

  it("leaves a field alone when it is not in the change", async () => {
    await setMyAlerts(4, { alertsOn: true }, ACTOR);
    const calls = clientQuery.mock.calls.map((c) => [String(c[0]), c[1] as unknown[]]);
    const upsert = calls.find(([s]) => /INSERT INTO elf_head_elves/.test(s))!;
    expect(upsert[1]).toEqual([4, null, true, false, true, ACTOR]);
    const audit = calls.find(([s]) => /INSERT INTO audit_log/.test(s))!;
    expect((audit[1] as unknown[])[4]).toEqual({ fields: ["alertsOn"] });
  });

  it("can clear the mobile with null", async () => {
    await setMyAlerts(4, { mobile: null }, ACTOR);
    const upsert = clientQuery.mock.calls.find((c) => /INSERT INTO elf_head_elves/.test(String(c[0])))!;
    expect(upsert[1]).toEqual([4, null, true, true, false, ACTOR]);
  });
});

describe("alerts sent", () => {
  it("reads the last alert of a kind", async () => {
    query.mockResolvedValueOnce({ rows: [{ sent_at: new Date("2026-12-07T18:04:00Z"), texts_failed: ["Alex Example"] }] });
    expect(await lastAlert("photo")).toEqual({ at: new Date("2026-12-07T18:04:00Z"), textsFailed: ["Alex Example"] });
    expect(query.mock.calls[0][1]).toEqual(["photo"]);
    query.mockResolvedValueOnce({ rows: [] });
    expect(await lastAlert("test")).toBeNull();
  });

  it("records an alert with the names whose text did not go, never a number", async () => {
    query.mockResolvedValue({ rows: [] });
    await recordAlert({ kind: "photo", year: 2026, door: 7, emails: 3, texts: 2, textsFailed: ["Alex Example"] });
    const [sql, params] = query.mock.calls[0];
    expect(String(sql)).toContain("INSERT INTO elf_alerts");
    expect(params).toEqual(["photo", 2026, 7, 3, 2, ["Alex Example"]]);
  });
});

describe("the oldest waiting photo", () => {
  it("is the earliest sent time among waiting photos, or null", async () => {
    query.mockResolvedValueOnce({ rows: [{ at: new Date("2026-12-07T18:00:00Z") }] });
    expect(await oldestWaitingPhotoAt()).toEqual(new Date("2026-12-07T18:00:00Z"));
    expect(String(query.mock.calls[0][0])).toMatch(/min\(p\.sent_at\)[\s\S]*status = 'waiting'/i);
    // A removed family's waiting photo is never counted, or it would hold the alerts off for the season.
    expect(String(query.mock.calls[0][0])).toContain("JOIN elf_families");
    expect(String(query.mock.calls[0][0])).toContain("removed_at IS NULL");
    query.mockResolvedValueOnce({ rows: [{ at: null }] });
    expect(await oldestWaitingPhotoAt()).toBeNull();
  });
});
