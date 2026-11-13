import { describe, it, expect, vi, beforeEach } from "vitest";

// Elf Detective School photos waiting to be checked, as a New mark and as phone notifications.
// The "waiting" rule is the one the photo check itself uses (src/db/elf-photos.ts photosWaiting):
// status 'waiting', and the family not removed. Practice door photos (door 0) count too.

const { mainQuery, contactQuery, storiesQuery } = vi.hoisted(() => ({
  mainQuery: vi.fn(),
  contactQuery: vi.fn(),
  storiesQuery: vi.fn(),
}));
vi.mock("../../src/db/pool", () => ({ pool: { query: mainQuery } }));
vi.mock("../../src/db/contact-pool", () => ({ contactPool: { query: contactQuery } }));
vi.mock("../../src/db/stories-pool", () => ({ storiesPool: { query: storiesQuery } }));

import { arrivalDetails, latestArrival } from "../../src/db/whats-new";

beforeEach(() => {
  mainQuery.mockReset();
  contactQuery.mockReset();
  storiesQuery.mockReset();
});

describe("the New mark beside Elf Detective School", () => {
  it("is the latest photo sent that is still waiting, on the main database", async () => {
    const at = new Date("2026-12-03T16:00:00Z");
    mainQuery.mockResolvedValue({ rows: [{ at }] });
    const since = new Date("2026-12-01T00:00:00Z");
    expect(await latestArrival("elf", since)).toEqual(at);
    const [sql, params] = mainQuery.mock.calls[0];
    expect(sql).toContain("FROM elf_photos p JOIN elf_families f ON f.id = p.family_id");
    expect(sql).toContain("p.status = 'waiting'");
    expect(sql).toContain("f.removed_at IS NULL");
    expect(sql).toContain("p.sent_at > $1");
    expect(sql).not.toMatch(/p\.door\s*(<>|!=|>|=)/); // the practice door (0) counts too
    expect(params).toEqual([since]);
    expect(contactQuery).not.toHaveBeenCalled();
    expect(storiesQuery).not.toHaveBeenCalled();
  });
});

describe("the photos a notification lists", () => {
  it("reads the same waiting photos, in the window, and selects nothing that names anyone", async () => {
    const at = new Date("2026-12-03T16:00:00Z");
    mainQuery.mockResolvedValue({ rows: [{ at, total: "1", grown_up_name: "Alex Example" }] });
    const until = new Date("2026-12-03T16:01:00Z");
    const out = await arrivalDetails("elf", "2026-12-01 00:00:00+00", until);
    expect(out).toEqual({ items: [{ at, area: "elf", line: "A photo is waiting to be checked" }], total: 1 });
    const [sql, params] = mainQuery.mock.calls[0];
    expect(sql).toContain("p.status = 'waiting'");
    expect(sql).toContain("f.removed_at IS NULL");
    // Both ends are shifted back two minutes (the upload stamps sent_at before the slow work), so the
    // windows still tile exactly while a photo still being saved is never skipped over.
    expect(sql.replace(/\s+/g, " ")).toContain(
      "p.sent_at > $1::timestamptz - interval '2 minutes' AND p.sent_at <= $2::timestamptz - interval '2 minutes'",
    );
    expect(sql).toContain("LIMIT $3");
    // Only the time and the count leave the database: no family, child, detective or place.
    const selected = sql.slice(sql.indexOf("SELECT"), sql.indexOf("FROM"));
    expect(selected).not.toMatch(/name|email|mobile|token|door|place|detective|family/i);
    expect(params).toEqual(["2026-12-01 00:00:00+00", until, 21]);
  });
});
