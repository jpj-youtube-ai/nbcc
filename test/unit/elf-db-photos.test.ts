import { describe, it, expect, vi, beforeEach } from "vitest";

// NBCC Elf Detective School wave 2: the photo check's data layer. There is no local database, so
// these read the SQL and parameters each function sends; the BDD proves the SQL in CI. Every name
// here is invented.

const { query, clientQuery, release, game } = vi.hoisted(() => ({
  query: vi.fn(),
  clientQuery: vi.fn(),
  release: vi.fn(),
  game: { loadDoorRun: vi.fn(), loadPractice: vi.fn() },
}));
vi.mock("../../src/db/pool", () => ({
  pool: { query, connect: async () => ({ query: clientQuery, release }) },
}));
vi.mock("../../src/db/elf-game", () => game);

import {
  countPhotosWaiting,
  decidePhoto,
  deleteExpiredPhotoFiles,
  oldestWaitingPhotoDoor,
  photoForStaff,
  photoLog,
  photoStep,
  photosWaiting,
  takeDownPhoto,
} from "../../src/db/elf-photos";

const ACTOR = "admin:alex@example.org";
const at = (iso: string) => new Date(iso);
const NOW = at("2026-12-07T18:12:00Z");

const calls = () => clientQuery.mock.calls.map((c) => [String(c[0]), c[1] as unknown[]] as [string, unknown[]]);
const sqls = () => calls().map(([s]) => s);
const find = (re: RegExp) => calls().find(([s]) => re.test(s));

/** A database where photo 41 (family 3) is in `status`, the family lock answers, and every write counts. */
function tx(status: string | null, o: { replaced?: number[] } = {}) {
  clientQuery.mockImplementation(async (sql: string) => {
    const s = String(sql);
    if (/FROM elf_photos WHERE id = \$1$/.test(s.trim()) || /SELECT family_id FROM elf_photos/.test(s)) {
      return { rows: status === null ? [] : [{ family_id: 3 }], rowCount: status === null ? 0 : 1 };
    }
    if (/FROM elf_photos[\s\S]*FOR UPDATE/.test(s)) {
      return { rows: status === null ? [] : [{ id: 41, status, year: 2026, door: 7, family_id: 3 }], rowCount: status === null ? 0 : 1 };
    }
    if (/UPDATE elf_photos SET status = 'replaced'/.test(s)) {
      const ids = o.replaced ?? [];
      return { rows: ids.map((id) => ({ id })), rowCount: ids.length };
    }
    if (/UPDATE elf_photos SET status = 'taken-down'/.test(s)) return { rows: status === "approved" || status === "waiting" ? [{ id: 41 }] : [], rowCount: status === "approved" || status === "waiting" ? 1 : 0 };
    return { rows: [], rowCount: 1 };
  });
}

beforeEach(() => {
  query.mockReset();
  clientQuery.mockReset();
  release.mockReset();
  game.loadDoorRun.mockReset();
  game.loadPractice.mockReset();
  clientQuery.mockResolvedValue({ rows: [], rowCount: 0 });
});

describe("decidePhoto", () => {
  it("answers null for a photo that is not there, and writes nothing", async () => {
    tx(null);
    expect(await decidePhoto(41, "approved", ACTOR, null)).toBeNull();
    expect(find(/UPDATE elf_photos/)).toBeUndefined();
  });

  it("answers already when the photo is not waiting, and writes nothing", async () => {
    tx("approved");
    expect(await decidePhoto(41, "declined", ACTOR, "someone else in it")).toBe("already");
    expect(find(/UPDATE elf_photos/)).toBeUndefined();
    expect(find(/DELETE FROM elf_photo_files/)).toBeUndefined();
    expect(find(/INSERT INTO audit_log/)).toBeUndefined();
    expect(sqls()[0]).toBe("BEGIN");
  });

  it("takes the family row first and then the photo row, both FOR UPDATE", async () => {
    tx("waiting");
    await decidePhoto(41, "approved", ACTOR, null);
    const s = sqls();
    const family = s.findIndex((q) => /FROM elf_families[\s\S]*FOR UPDATE/.test(q));
    const photo = s.findIndex((q) => /FROM elf_photos[\s\S]*FOR UPDATE/.test(q));
    expect(s[0]).toBe("BEGIN");
    expect(family).toBeGreaterThan(0);
    expect(photo).toBeGreaterThan(family);
  });

  it("approves a waiting photo, notes who and when, and audits the decision only", async () => {
    tx("waiting");
    expect(await decidePhoto(41, "approved", ACTOR, null)).toBe("done");
    const up = find(/UPDATE elf_photos SET status = 'approved'/)!;
    expect(up).toBeTruthy();
    expect(up[0]).toContain("decided_by");
    expect(up[1]).toEqual(expect.arrayContaining([41, ACTOR]));
    expect(find(/DELETE FROM elf_photo_files/)).toBeUndefined();
    const audit = find(/INSERT INTO audit_log/)!;
    expect(audit[1]).toEqual([ACTOR, "elf.photo.decided", "elf_photo", 41, { decision: "approved" }]);
    expect(sqls()).toContain("COMMIT");
  });

  it("replaces the family's other approved photo at the same door, and deletes its bytes, in the same transaction", async () => {
    tx("waiting", { replaced: [30] });
    await decidePhoto(41, "approved", ACTOR, null);
    const replace = find(/UPDATE elf_photos SET status = 'replaced'/)!;
    expect(replace[0]).toContain("status = 'approved'");
    expect(replace[0]).toContain("family_id");
    expect(replace[0]).toContain("door");
    expect(replace[0]).toContain("id <> $");
    expect(replace[1]).toEqual(expect.arrayContaining([2026, 7, 3, 41]));
    const del = calls().find(([s, p]) => /DELETE FROM elf_photo_files/.test(s) && JSON.stringify(p).includes("30"))!;
    expect(del).toBeTruthy();
    const s = sqls();
    expect(s.findIndex((q) => /UPDATE elf_photos SET status = 'replaced'/.test(q))).toBeLessThan(s.indexOf("COMMIT"));
    expect(s.findIndex((q) => /DELETE FROM elf_photo_files/.test(q))).toBeLessThan(s.indexOf("COMMIT"));
  });

  it("declines with the reason, deletes the bytes in the transaction, and never replaces anything", async () => {
    tx("waiting");
    expect(await decidePhoto(41, "declined", ACTOR, "someone else in it")).toBe("done");
    const up = find(/UPDATE elf_photos SET status = 'declined'/)!;
    expect(up[1]).toEqual(expect.arrayContaining([41, ACTOR, "someone else in it"]));
    const s = sqls();
    const del = s.findIndex((q) => /DELETE FROM elf_photo_files/.test(q));
    expect(del).toBeGreaterThan(s.findIndex((q) => /UPDATE elf_photos SET status = 'declined'/.test(q)));
    expect(del).toBeLessThan(s.indexOf("COMMIT"));
    expect(find(/status = 'replaced'/)).toBeUndefined();
    const audit = find(/INSERT INTO audit_log/)!;
    expect(audit[1][4]).toEqual({ decision: "declined" });
    expect(JSON.stringify(audit[1])).not.toContain("someone else");
  });

  it("rolls back when something throws", async () => {
    clientQuery.mockImplementation(async (sql: string) => {
      if (/SELECT family_id/.test(String(sql))) throw new Error("boom");
      return { rows: [], rowCount: 0 };
    });
    await expect(decidePhoto(41, "approved", ACTOR, null)).rejects.toThrow("boom");
    expect(sqls()).toContain("ROLLBACK");
  });
});

describe("takeDownPhoto", () => {
  it("takes down an approved or waiting photo, deletes its bytes, and notes who", async () => {
    tx("approved");
    expect(await takeDownPhoto(41, ACTOR, "the family asked by phone")).toBe(true);
    const up = find(/UPDATE elf_photos SET status = 'taken-down'/)!;
    expect(up[0]).toContain("status IN ('approved', 'waiting')");
    expect(up[0]).toContain("taken_down_by");
    expect(up[1]).toEqual(expect.arrayContaining([41, ACTOR, "the family asked by phone"]));
    expect(find(/DELETE FROM elf_photo_files/)).toBeTruthy();
    expect(find(/INSERT INTO audit_log/)![1][1]).toBe("elf.photo.taken_down");
    expect(sqls()).toContain("COMMIT");
  });

  it("answers false and deletes nothing when there is nothing to take down", async () => {
    tx("declined");
    expect(await takeDownPhoto(41, ACTOR, null)).toBe(false);
    expect(find(/DELETE FROM elf_photo_files/)).toBeUndefined();
    expect(find(/INSERT INTO audit_log/)).toBeUndefined();
  });

  it("answers null for a photo that is not there", async () => {
    tx(null);
    expect(await takeDownPhoto(41, ACTOR, null)).toBeNull();
    expect(find(/UPDATE elf_photos/)).toBeUndefined();
  });

  it("takes the family row before the photo row", async () => {
    tx("approved");
    await takeDownPhoto(41, ACTOR, null);
    const s = sqls();
    expect(s.findIndex((q) => /FROM elf_families[\s\S]*FOR UPDATE/.test(q))).toBeLessThan(s.findIndex((q) => /UPDATE elf_photos SET status = 'taken-down'/.test(q)));
  });
});

describe("photosWaiting", () => {
  const row = (over: object = {}) => ({
    id: 41,
    token: "aaaaaaaaaaaa",
    year: 2026,
    door: 7,
    sent_at: at("2026-12-07T18:04:00Z"),
    family_id: 3,
    grown_up_name: "Alex Example",
    detectives: 2,
    first_family: false,
    ...over,
  });
  const run = (over: object = {}) => ({
    placeName: "Pine Cone Café",
    facts: {
      clue1At: at("2026-12-07T17:30:00Z"),
      clue2At: at("2026-12-07T18:00:00Z"),
      clue3At: at("2026-12-07T18:30:00Z"),
      revealAt: at("2026-12-07T19:00:00Z"),
      closesAt: at("2026-12-07T18:45:00Z"),
      foundAt: null,
      snowDay: false,
      goneHome: false,
    },
    ...over,
  });

  it("reads the waiting photos oldest first, without removed families, with each door's place and when it is shown", async () => {
    query.mockResolvedValueOnce({ rows: [row(), row({ id: 42, token: "bbbbbbbbbbbb", door: 6, sent_at: at("2026-12-07T18:07:00Z"), first_family: true })] });
    game.loadDoorRun.mockResolvedValue(run());
    const list = await photosWaiting(NOW);
    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain("status = 'waiting'");
    expect(sql).toContain("removed_at IS NULL");
    expect(sql).toMatch(/ORDER BY p\.sent_at, p\.id/);
    expect(game.loadDoorRun).toHaveBeenCalledWith(2026, 7, NOW);
    expect(list[0]).toEqual({
      id: 41,
      token: "aaaaaaaaaaaa",
      year: 2026,
      door: 7,
      practice: false,
      sentAt: at("2026-12-07T18:04:00Z"),
      family: { id: 3, grownUpName: "Alex Example", detectives: 2 },
      placeName: "Pine Cone Café",
      placeShownAt: at("2026-12-07T19:00:00Z"),
      firstFamily: false,
    });
    expect(list[1].firstFamily).toBe(true);
  });

  it("gives no shown time once the place is already shown", async () => {
    query.mockResolvedValueOnce({ rows: [row()] });
    game.loadDoorRun.mockResolvedValue(run());
    const list = await photosWaiting(at("2026-12-07T19:05:00Z"));
    expect(list[0].placeShownAt).toBeNull();
  });

  it("reads the practice door through loadPractice", async () => {
    query.mockResolvedValueOnce({ rows: [row({ year: 0, door: 0 })] });
    game.loadPractice.mockResolvedValue(run({ placeName: "The Pretend Place" }));
    const list = await photosWaiting(NOW);
    expect(game.loadPractice).toHaveBeenCalledWith(NOW);
    expect(game.loadDoorRun).not.toHaveBeenCalled();
    expect(list[0]).toMatchObject({ door: 0, practice: true, placeName: "The Pretend Place" });
  });

  it("has no place and no shown time when the door cannot be loaded", async () => {
    query.mockResolvedValueOnce({ rows: [row({ year: 0, door: 0 })] });
    game.loadPractice.mockResolvedValue(null);
    const list = await photosWaiting(NOW);
    expect(list[0].placeName).toBeNull();
    expect(list[0].placeShownAt).toBeNull();
  });

  it("counts the photos waiting, without removed families", async () => {
    query.mockResolvedValueOnce({ rows: [{ n: "3" }] });
    expect(await countPhotosWaiting()).toBe(3);
    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain("'waiting'");
    expect(sql).toContain("removed_at IS NULL");
  });
});

describe("photoForStaff", () => {
  it("gives the bytes of a photo in any status, or null", async () => {
    query.mockResolvedValueOnce({ rows: [{ mime: "image/jpeg", bytes: Buffer.from("x") }] });
    expect(await photoForStaff(41)).toEqual({ mime: "image/jpeg", bytes: Buffer.from("x") });
    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain("elf_photo_files");
    expect(sql).not.toContain("status");
    query.mockResolvedValueOnce({ rows: [] });
    expect(await photoForStaff(42)).toBeNull();
  });
});

describe("photoLog", () => {
  const base = {
    id: 41,
    year: 2026,
    door: 7,
    grown_up_name: "Sam Example",
    status: "declined",
    sent_at: at("2026-12-07T17:20:00Z"),
    decided_at: at("2026-12-07T17:31:00Z"),
    decided_by: ACTOR,
    decline_reason: "someone else in it",
    taken_down_at: null,
    taken_down_by: null,
    deleted_at: null,
  };

  it("turns a declined photo into Sent then Declined by the head elf's whole name, with the reason", async () => {
    query.mockImplementation(async (sql: string) => {
      if (/FROM users/.test(String(sql))) return { rows: [{ full_name: "Alex Example", email: "alex@example.org" }] };
      return { rows: [base] };
    });
    const log = await photoLog(200);
    expect(log).toEqual([
      {
        id: 41,
        door: 7,
        practice: false,
        family: { grownUpName: "Sam Example" },
        status: "declined",
        held: false,
        steps: [
          { at: at("2026-12-07T17:20:00Z"), words: "Sent" },
          { at: at("2026-12-07T17:31:00Z"), words: "Declined by Alex Example: someone else in it" },
        ],
      },
    ]);
    const photoSql = String(query.mock.calls.find((c) => /FROM elf_photos/.test(String(c[0])))![0]);
    expect(photoSql).toMatch(/ORDER BY p\.sent_at DESC, p\.id DESC/);
    expect(query.mock.calls.find((c) => /FROM elf_photos/.test(String(c[0])))![1]).toEqual([200]);
  });

  it("falls back to the email when there is no users row, and a blank name uses the email too", async () => {
    query.mockImplementation(async (sql: string) => {
      if (/FROM users/.test(String(sql))) return { rows: [{ full_name: "  ", email: "sam@example.org" }] };
      return { rows: [{ ...base, status: "approved", decline_reason: null, decided_by: "admin:nobody@example.org" }, { ...base, id: 40, status: "approved", decline_reason: null, decided_by: "admin:sam@example.org" }] };
    });
    const log = await photoLog(200);
    expect(log[0].steps[1].words).toBe("Approved by nobody@example.org");
    expect(log[1].steps[1].words).toBe("Approved by sam@example.org");
  });

  it("writes every step: approved, taken down by the family, taken down by a head elf with a reason, and deleted", async () => {
    query.mockImplementation(async (sql: string) => {
      if (/FROM users/.test(String(sql))) return { rows: [{ full_name: "Alex Example", email: "alex@example.org" }] };
      return {
        rows: [
          { ...base, id: 3, status: "taken-down", decline_reason: null, taken_down_at: at("2026-12-08T09:00:00Z"), taken_down_by: "family" },
          { ...base, id: 2, status: "taken-down", decline_reason: "the family asked by phone", taken_down_at: at("2026-12-08T09:00:00Z"), taken_down_by: ACTOR },
          { ...base, id: 1, status: "deleted", decline_reason: null, deleted_at: at("2027-01-31T00:05:00Z") },
          { ...base, id: 0, status: "waiting", decided_at: null, decided_by: null, decline_reason: null },
        ],
      };
    });
    const log = await photoLog(200);
    expect(log[0].steps.map((s) => s.words)).toEqual(["Sent", "Approved by Alex Example", "Taken down by the family"]);
    expect(log[1].steps.map((s) => s.words)).toEqual(["Sent", "Approved by Alex Example", "Taken down by Alex Example: the family asked by phone"]);
    expect(log[2].steps.map((s) => s.words)).toEqual(["Sent", "Approved by Alex Example", "Deleted"]);
    expect(log[3].steps.map((s) => s.words)).toEqual(["Sent"]);
  });

  it("keeps a declined photo's lines after the January clear out, when its status reads deleted", async () => {
    query.mockImplementation(async (sql: string) => {
      if (/FROM users/.test(String(sql))) return { rows: [{ full_name: "Alex Example", email: "alex@example.org" }] };
      return { rows: [{ ...base, status: "deleted", deleted_at: at("2027-01-31T00:05:00Z") }] };
    });
    const log = await photoLog(200);
    expect(log[0].steps.map((s) => s.words)).toEqual(["Sent", "Declined by Alex Example: someone else in it", "Deleted"]);
  });

  it("keeps an approved then taken down photo as approved, though a take down's reason shares decline_reason", async () => {
    query.mockImplementation(async (sql: string) => {
      if (/FROM users/.test(String(sql))) return { rows: [{ full_name: "Alex Example", email: "alex@example.org" }] };
      return { rows: [{ ...base, status: "deleted", decline_reason: "the family asked by phone", taken_down_at: at("2026-12-08T09:00:00Z"), taken_down_by: ACTOR, deleted_at: at("2027-01-31T00:05:00Z") }] };
    });
    const log = await photoLog(200);
    expect(log[0].steps.map((s) => s.words)).toEqual(["Sent", "Approved by Alex Example", "Taken down by Alex Example: the family asked by phone", "Deleted"]);
  });

  it("says an approved photo is held while no second family's photo is approved on its door", async () => {
    query.mockImplementation(async (sql: string) => {
      if (/FROM users/.test(String(sql))) return { rows: [] };
      return { rows: [{ ...base, status: "approved", decline_reason: null, held: true }, { ...base, id: 2, status: "approved", decline_reason: null, held: false }] };
    });
    const log = await photoLog(200);
    expect(log.map((r) => r.held)).toEqual([true, false]);
    const sql = String(query.mock.calls.find((c) => /FROM elf_photos/.test(String(c[0])))![0]);
    expect(sql).toContain("count(DISTINCT");
  });

  it("marks the practice door and never needs a users row when nobody decided", async () => {
    query.mockResolvedValue({ rows: [{ ...base, year: 0, door: 0, status: "waiting", decided_at: null, decided_by: null, decline_reason: null }] });
    const log = await photoLog(200);
    expect(log[0]).toMatchObject({ door: 0, practice: true });
    expect(query.mock.calls.some((c) => /FROM users/.test(String(c[0])))).toBe(false);
  });

  it("gives the newest step of one photo as words with its time", async () => {
    query.mockImplementation(async (sql: string) => {
      if (/FROM users/.test(String(sql))) return { rows: [{ full_name: "Alex Example", email: "alex@example.org" }] };
      return { rows: [{ ...base, status: "approved", decline_reason: null, decided_at: at("2026-12-07T18:13:00Z") }] };
    });
    expect(await photoStep(41)).toBe("Approved by Alex Example at 6:13pm");
    query.mockReset();
    query.mockResolvedValue({ rows: [] });
    expect(await photoStep(99)).toBeNull();
  });

  it("says in words that a photo the family replaced was replaced, and writes a time on the hour as 7pm", async () => {
    query.mockImplementation(async (sql: string) => {
      if (/FROM users/.test(String(sql))) return { rows: [{ full_name: "Alex Example", email: "alex@example.org" }] };
      return { rows: [{ ...base, status: "replaced", decided_at: null, decided_by: null, decline_reason: null }] };
    });
    expect(await photoStep(41)).toBe("Replaced by a newer photo from the family");
    query.mockImplementation(async (sql: string) => {
      if (/FROM users/.test(String(sql))) return { rows: [{ full_name: "Alex Example", email: "alex@example.org" }] };
      return { rows: [{ ...base, status: "approved", decline_reason: null, decided_at: at("2026-12-07T19:00:00Z") }] };
    });
    expect(await photoStep(41)).toBe("Approved by Alex Example at 7pm");
  });

  it("counts the other families already up on a door from the same shared SQL as the family side", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await photosWaiting(NOW);
    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain("count(DISTINCT a.family_id)");
    expect(sql).toContain("a.family_id <> p.family_id");
  });
});

describe("deleteExpiredPhotoFiles", () => {
  const photos = (rows: { id: number; year: number; sent_at: Date }[]) =>
    clientQuery.mockImplementation(async (sql: string) => {
      const s = String(sql);
      if (/SELECT id, year, sent_at FROM elf_photos/.test(s)) return { rows, rowCount: rows.length };
      if (/UPDATE elf_photos/.test(s)) return { rows: (clientQuery.mock.calls.at(-1)?.[1] as number[][])[0].map((id) => ({ id })), rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });
  const ROWS = [
    { id: 1, year: 2026, sent_at: at("2026-12-07T18:00:00Z") },
    { id: 2, year: 0, sent_at: at("2026-12-05T10:00:00Z") },
    { id: 3, year: 2027, sent_at: at("2027-12-07T18:00:00Z") },
  ];

  it("at noon on 31 January 2027 deletes year 2026 and year 0 files, and none of year 2027", async () => {
    photos(ROWS);
    const n = await deleteExpiredPhotoFiles(at("2027-01-31T12:00:00Z"));
    expect(n).toBe(2);
    const del = find(/DELETE FROM elf_photo_files/)!;
    expect(del[1]).toEqual([[1, 2]]);
    // The photo rows first and then their bytes, as every other photo writer does.
    const s = sqls();
    expect(s.findIndex((q) => /UPDATE elf_photos/.test(q))).toBeLessThan(s.findIndex((q) => /DELETE FROM elf_photo_files/.test(q)));
    expect(find(/UPDATE elf_photos/)![0]).toContain("RETURNING id");
    const up = find(/UPDATE elf_photos/)!;
    expect(up[0]).toContain("status = 'deleted'");
    expect(up[0]).toContain("deleted_at");
    expect(up[0]).toContain("status <> 'deleted'");
    expect(up[1]).toEqual([[1, 2], at("2027-01-31T12:00:00Z")]);
  });

  it("at 11:59pm on 30 January deletes nothing", async () => {
    photos(ROWS);
    expect(await deleteExpiredPhotoFiles(at("2027-01-30T23:59:00Z"))).toBe(0);
    expect(find(/DELETE FROM elf_photo_files/)).toBeUndefined();
    expect(find(/UPDATE elf_photos/)).toBeUndefined();
  });

  it("counts a year 0 photo sent in January against the December before it", async () => {
    photos([{ id: 9, year: 0, sent_at: at("2027-01-15T10:00:00Z") }]);
    expect(await deleteExpiredPhotoFiles(at("2027-01-31T12:00:00Z"))).toBe(1);
  });

  it("keeps a year 0 photo from this December until the next 31 January", async () => {
    photos([{ id: 9, year: 0, sent_at: at("2026-11-20T10:00:00Z") }]);
    expect(await deleteExpiredPhotoFiles(at("2026-12-20T12:00:00Z"))).toBe(0);
  });

  // A practice photo sent on or after 31 January belongs to the coming December, so it is never past its
  // clear out the moment it is sent (January in London is on GMT, so midnight is midnight UTC).
  it("keeps a year 0 photo sent on 31 January at that moment, and deletes one sent on 30 January from 31 January", async () => {
    photos([{ id: 9, year: 0, sent_at: at("2027-01-31T00:00:00Z") }]);
    expect(await deleteExpiredPhotoFiles(at("2027-01-31T00:00:00Z"))).toBe(0);
    photos([{ id: 8, year: 0, sent_at: at("2027-01-30T23:59:00Z") }]);
    expect(await deleteExpiredPhotoFiles(at("2027-01-30T23:59:30Z"))).toBe(0);
    expect(await deleteExpiredPhotoFiles(at("2027-01-31T00:00:00Z"))).toBe(1);
  });

  it("only looks at photos not already deleted", async () => {
    photos([]);
    await deleteExpiredPhotoFiles(at("2027-02-01T12:00:00Z"));
    expect(find(/SELECT id, year, sent_at FROM elf_photos/)![0]).toContain("status <> 'deleted'");
  });
});

describe("oldestWaitingPhotoDoor", () => {
  it("reads the door of the oldest photo waiting in one small query, leaving removed families out", async () => {
    query.mockResolvedValueOnce({ rows: [{ door: 7 }] });
    expect(await oldestWaitingPhotoDoor()).toBe(7);
    const s = String(query.mock.calls[0][0]).replace(/\s+/g, " ");
    expect(s).toContain("FROM elf_photos p JOIN elf_families f ON f.id = p.family_id");
    expect(s).toContain("WHERE p.status = 'waiting' AND f.removed_at IS NULL");
    expect(s).toContain("ORDER BY p.sent_at, p.id LIMIT 1");
    expect(query).toHaveBeenCalledTimes(1);
    expect(game.loadDoorRun).not.toHaveBeenCalled();
    expect(game.loadPractice).not.toHaveBeenCalled();
  });

  it("answers 0 for the practice door, and null when nothing waits", async () => {
    query.mockResolvedValueOnce({ rows: [{ door: 0 }] });
    expect(await oldestWaitingPhotoDoor()).toBe(0);
    query.mockResolvedValueOnce({ rows: [] });
    expect(await oldestWaitingPhotoDoor()).toBeNull();
  });
});
