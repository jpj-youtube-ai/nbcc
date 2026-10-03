import { describe, it, expect, vi, beforeEach } from "vitest";

// Profile pictures (Jaimie, 2026-10-03): the SQL, against a mocked pool (no database). A picture is
// only ever sent by the fundraiser's own organiser while its page is up, waits for staff, and a newer
// one replaces the one waiting; its bytes never leave in a list; each answers only to its owner, to
// staff, or (an approved profile photo, on a page that is up) to the public. Approving a main photo
// makes it the page's photo exactly as a staff upload is. Every decision writes its audit row in the
// same transaction. Every name and address is invented.

const { query, connect } = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn() }));
vi.mock("../../src/db/pool", () => ({ pool: { query, connect } }));
vi.mock("../../src/config", () => ({ config: { NODE_ENV: "test" } }));

import {
  approvedProfilePhotos,
  countPendingPictures,
  countSentToday,
  decidePicture,
  deletePicture,
  purgePictureBytes,
  listPictures,
  pendingPicturesByFundraiser,
  pictureForOwner,
  pictureForStaff,
  publicProfilePhoto,
  sendPicture,
  PictureError,
} from "../../src/db/fundraiser-pictures";

type Calls = Array<[string, unknown[]]>;
type Answer = (sql: string, params: unknown[]) => unknown;
function useClient(answer: Answer) {
  const calls: Calls = [];
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
const sqlIn = (calls: Calls, re: RegExp) => calls.find((c) => re.test(c[0]));
const indexOf = (calls: Calls, re: RegExp) => calls.findIndex((c) => re.test(c[0]));
const audits = (calls: Calls) => calls.filter((c) => /INSERT INTO audit_log/.test(c[0])).map((c) => c[1]);

beforeEach(() => {
  query.mockReset().mockResolvedValue({ rows: [] });
  connect.mockReset();
});

const owner = (over: Record<string, unknown> = {}) => ({
  id: 7,
  organiser_email: "Sam@Example.com",
  status: "approved",
  public: true,
  path: "raising",
  ...over,
});
const pictureRow = (over: Record<string, unknown> = {}) => ({
  id: 41,
  fundraiser_id: 7,
  kind: "profile",
  status: "pending",
  photo_id: "0b5c1d2e-3f40-4a5b-8c6d-7e8f9a0b1c2d",
  has_bytes: true,
  width: 400,
  height: 400,
  created_at: new Date("2026-11-20T10:00:00Z"),
  decided_at: null,
  decided_by: null,
  decline_reason: null,
  ...over,
});
const PHOTO = { mime: "image/jpeg" as const, bytes: Buffer.from([0xff, 0xd8, 0xff, 1, 2]), width: 400, height: 400 };

describe("sending a picture", () => {
  function answer(f: Record<string, unknown> | null, sentToday = 0, replaced: number[] = []) {
    return useClient((sql) => {
      if (/FROM fundraisers WHERE id = \$1 FOR UPDATE/.test(sql)) return { rows: f ? [f] : [] };
      if (/count\(\*\)/i.test(sql)) return { rows: [{ n: sentToday }] };
      if (/SET status = 'replaced'/.test(sql)) return { rows: replaced.map((id) => ({ id })) };
      if (/INSERT INTO fundraiser_pictures/.test(sql)) return { rows: [pictureRow()] };
      return undefined;
    });
  }

  it("stores it waiting, made by the server, under the fundraiser's lock, with an audit row", async () => {
    const { calls } = answer(owner());
    const out = await sendPicture(7, "sam@example.com", "profile", PHOTO);
    expect(out).toMatchObject({ verdict: "ok", picture: { id: 41, status: "pending", kind: "profile" } });
    const ins = sqlIn(calls, /INSERT INTO fundraiser_pictures/)!;
    expect(ins[1]).toEqual([7, "profile", expect.stringMatching(/^[0-9a-f-]{36}$/), "image/jpeg", PHOTO.bytes, 5, 400, 400]);
    expect(audits(calls)).toEqual([["organiser", "fundraiser.picture_sent", "fundraiser", 7, { pictureId: 41, kind: "profile", replaced: [] }]]);
    expect(calls.map((c) => c[0])).toContain("COMMIT");
  });

  it("replaces the one of that kind still waiting, before adding the new one", async () => {
    const { calls } = answer(owner(), 0, [40]);
    await sendPicture(7, "sam@example.com", "main", PHOTO);
    const replace = sqlIn(calls, /SET status = 'replaced'/)!;
    expect(replace[0]).toMatch(/status = 'pending'/);
    // Review: a picture nobody will look at again keeps none of its bytes.
    expect(replace[0]).toMatch(/bytes = NULL/);
    expect(replace[1]).toEqual([7, "main"]);
    expect(indexOf(calls, /SET status = 'replaced'/)).toBeLessThan(indexOf(calls, /INSERT INTO fundraiser_pictures/));
    expect(audits(calls)[0][4]).toMatchObject({ replaced: [40] });
  });

  it("someone else's fundraiser reads as not there", async () => {
    answer(owner({ organiser_email: "someone.else@example.com" }));
    await expect(sendPicture(7, "sam@example.com", "profile", PHOTO)).rejects.toMatchObject({ reason: "not_found" });
  });

  it("a fundraiser with no page, or finished, takes no pictures", async () => {
    answer(owner({ public: false }));
    await expect(sendPicture(7, "sam@example.com", "profile", PHOTO)).rejects.toBeInstanceOf(PictureError);
    answer(owner({ status: "finished" }));
    await expect(sendPicture(7, "sam@example.com", "profile", PHOTO)).rejects.toMatchObject({ reason: "bad_status" });
  });

  it("stores nothing once ten were sent in a day", async () => {
    const { calls } = answer(owner(), 10);
    expect(await sendPicture(7, "sam@example.com", "profile", PHOTO)).toEqual({ verdict: "limit" });
    expect(sqlIn(calls, /INSERT INTO fundraiser_pictures/)).toBeUndefined();
  });
});

describe("reading pictures", () => {
  it("lists them without their bytes", async () => {
    query.mockResolvedValueOnce({ rows: [pictureRow()] });
    const rows = await listPictures([7]);
    expect(rows[0]).toEqual({
      id: 41,
      fundraiserId: 7,
      kind: "profile",
      status: "pending",
      photoId: "0b5c1d2e-3f40-4a5b-8c6d-7e8f9a0b1c2d",
      hasPhoto: true,
      width: 400,
      height: 400,
      createdAt: "2026-11-20T10:00:00.000Z",
      decidedAt: null,
      decidedBy: null,
      declineReason: null,
    });
    expect(String(query.mock.calls[0][0])).not.toMatch(/(?<!\()\bbytes\b(?! IS NOT NULL)/);
  });

  it("asks nothing for no fundraisers", async () => {
    expect(await listPictures([])).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it("gives the owner their own picture whatever its status, by their email", async () => {
    query.mockResolvedValueOnce({ rows: [{ mime: "image/jpeg", bytes: Buffer.from([1]) }] });
    expect(await pictureForOwner(41, " Sam@Example.com ")).toEqual({ mime: "image/jpeg", bytes: Buffer.from([1]) });
    expect(query.mock.calls[0][1]).toEqual([41, "sam@example.com"]);
    expect(String(query.mock.calls[0][0])).toMatch(/p\.bytes IS NOT NULL/);
  });

  it("gives staff a picture by the fundraiser it belongs to", async () => {
    await pictureForStaff(7, 41);
    expect(query.mock.calls[0][1]).toEqual([41, 7]);
  });

  it("gives the public only an approved profile photo, on a page that is up", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    expect(await publicProfilePhoto("0b5c1d2e-3f40-4a5b-8c6d-7e8f9a0b1c2d")).toBeNull();
    const sql = String(query.mock.calls[0][0]);
    expect(sql).toMatch(/p\.status = 'approved'/);
    expect(sql).toMatch(/p\.kind = 'profile'/);
    expect(sql).toMatch(/f\.public = true/);
    expect(sql).toMatch(/f\.status IN \('approved', 'finished'\)/);
    // A page in memory of someone shows their photo, never a round one of its organiser.
    expect(sql).toMatch(/NOT f\.in_memory/);
  });

  it("finds the approved profile photo of each fundraiser in one query", async () => {
    query.mockResolvedValueOnce({ rows: [{ fundraiser_id: 7, photo_id: "0b5c1d2e-3f40-4a5b-8c6d-7e8f9a0b1c2d" }] });
    const map = await approvedProfilePhotos([7, 8]);
    expect(map.get(7)).toBe("0b5c1d2e-3f40-4a5b-8c6d-7e8f9a0b1c2d");
    expect(map.has(8)).toBe(false);
    expect(query.mock.calls[0][1]).toEqual([[7, 8]]);
    expect(String(query.mock.calls[0][0])).toMatch(/NOT f\.in_memory/);
    expect(await approvedProfilePhotos([])).toEqual(new Map());
  });

  it("counts what a fundraiser sent in the last day, before anything is decoded", async () => {
    query.mockResolvedValueOnce({ rows: [{ n: "4" }] });
    expect(await countSentToday(7)).toBe(4);
    expect(String(query.mock.calls[0][0])).toMatch(/interval '24 hours'/);
  });

  it("counts what waits on each fundraiser", async () => {
    query.mockResolvedValueOnce({ rows: [{ fundraiser_id: 7, n: "2" }] });
    expect(await pendingPicturesByFundraiser()).toEqual({ 7: 2 });
  });
});

describe("staff deciding", () => {
  function answer(status: string, kind = "profile", over: Record<string, unknown> = {}, inUse: Array<{ id: number; event_image_id: string | null }> = []) {
    return useClient((sql) => {
      if (/SELECT p\.status, p\.kind/.test(sql)) return { rows: status ? [{ status, kind, event_image_id: null, in_memory: false, ...over }] : [] };
      if (/SELECT id, event_image_id FROM fundraiser_pictures/.test(sql)) return { rows: inUse };
      if (/UPDATE fundraiser_pictures SET status = \$1/.test(sql)) return { rows: [pictureRow({ kind, status: "approved" })] };
      return undefined;
    });
  }
  const COPY = "1b5c1d2e-3f40-4a5b-8c6d-7e8f9a0b1c2d";

  it("approving a profile photo puts it in use, the old one replaced first, its bytes gone", async () => {
    const { calls } = answer("pending", "profile", {}, [{ id: 40, event_image_id: null }]);
    const out = await decidePicture(7, 41, "approve", "admin:fern@example.com", { adminId: 3 });
    expect(out.status).toBe("approved");
    const old = indexOf(calls, /SET status = 'replaced'/);
    expect(old).toBeGreaterThan(-1);
    expect(calls[old][0]).toMatch(/bytes = NULL/);
    expect(calls[old][1]).toEqual([[40], "admin:fern@example.com"]);
    expect(old).toBeLessThan(indexOf(calls, /UPDATE fundraiser_pictures SET status = \$1/));
    expect(sqlIn(calls, /INSERT INTO event_images/)).toBeUndefined();
    expect(audits(calls)).toEqual([["admin:fern@example.com", "fundraiser.picture_approved", "fundraiser", 7, { pictureId: 41, kind: "profile" }]]);
  });

  it("approving a main photo makes it the page's photo, stored as a staff upload is, and remembers the copy", async () => {
    const { calls } = answer("pending", "main");
    await decidePicture(7, 41, "approve", "admin:fern@example.com", { adminId: 3 });
    const copy = sqlIn(calls, /INSERT INTO event_images/)!;
    expect(copy[0]).toMatch(/SELECT \$1, mime, bytes, byte_size, \$2 FROM fundraiser_pictures WHERE id = \$3/);
    const imageId = copy[1][0] as string;
    expect(copy[1]).toEqual([imageId, 3, 41]);
    const page = sqlIn(calls, /UPDATE fundraisers SET image_src = \$1/)!;
    expect(page[1]).toEqual([`/media/events/${imageId}`, "admin:fern@example.com", 7]);
    const done = sqlIn(calls, /UPDATE fundraiser_pictures SET status = \$1/)!;
    expect(done[1]).toEqual(["approved", "admin:fern@example.com", null, 41, true, imageId]);
  });

  it("approving a new main photo deletes the copy of the one it replaces, so its address answers nothing", async () => {
    const { calls } = answer("pending", "main", {}, [{ id: 40, event_image_id: COPY }]);
    await decidePicture(7, 41, "approve", "admin:fern@example.com", { adminId: 3 });
    expect(sqlIn(calls, /DELETE FROM event_images/)![1]).toEqual([[COPY]]);
  });

  it("declining keeps the optional note for the organiser, and lets the bytes go", async () => {
    const { calls } = answer("pending");
    await decidePicture(7, 41, "decline", "admin:fern@example.com", { reason: "One without other people in it, please." });
    const upd = sqlIn(calls, /UPDATE fundraiser_pictures SET status = \$1/)!;
    expect(upd[0]).toMatch(/bytes = CASE WHEN \$5 THEN bytes ELSE NULL END/);
    expect(upd[1]).toEqual(["declined", "admin:fern@example.com", "One without other people in it, please.", 41, false, null]);
    expect(audits(calls)[0][1]).toBe("fundraiser.picture_declined");
  });

  it("taking a profile photo off is only for one in use, and lets the bytes go", async () => {
    const { calls } = answer("approved");
    await expect(decidePicture(7, 41, "remove", "admin:fern@example.com")).resolves.toBeTruthy();
    expect(sqlIn(calls, /UPDATE fundraiser_pictures SET status = \$1/)![1]).toEqual(["removed", "admin:fern@example.com", null, 41, false, null]);
    answer("pending");
    await expect(decidePicture(7, 41, "remove", "admin:fern@example.com")).rejects.toMatchObject({ reason: "not_waiting" });
  });

  it("taking a main photo off clears it from the page and deletes its copy", async () => {
    const { calls } = answer("approved", "main", { event_image_id: COPY });
    await decidePicture(7, 41, "remove", "admin:fern@example.com");
    const page = sqlIn(calls, /UPDATE fundraisers SET image_src = NULL/)!;
    expect(page[1]).toEqual([7, [`/media/events/${COPY}`], "admin:fern@example.com"]);
    expect(sqlIn(calls, /DELETE FROM event_images/)![1]).toEqual([[COPY]]);
    expect(audits(calls)[0][1]).toBe("fundraiser.picture_removed");
  });

  it("will not approve a round photo for a page in memory of someone", async () => {
    answer("pending", "profile", { in_memory: true });
    await expect(decidePicture(7, 41, "approve", "admin:fern@example.com")).rejects.toMatchObject({ reason: "not_allowed" });
  });

  it("one decided already, or replaced, is refused; one not there is not found", async () => {
    answer("replaced");
    await expect(decidePicture(7, 41, "approve", "admin:fern@example.com")).rejects.toMatchObject({ reason: "not_waiting" });
    answer("");
    await expect(decidePicture(7, 41, "approve", "admin:fern@example.com")).rejects.toMatchObject({ reason: "not_found" });
  });
});

describe("deleting a picture for good", () => {
  it("deletes the row and any copy on the page, with an audit row saying so", async () => {
    const { calls } = useClient((sql) => {
      if (/SELECT status, kind, event_image_id FROM fundraiser_pictures/.test(sql)) return { rows: [{ status: "approved", kind: "main", event_image_id: "1b5c1d2e-3f40-4a5b-8c6d-7e8f9a0b1c2d" }] };
      return undefined;
    });
    await deletePicture(7, 41, "admin:fern@example.com");
    expect(sqlIn(calls, /UPDATE fundraisers SET image_src = NULL/)).toBeTruthy();
    expect(sqlIn(calls, /DELETE FROM event_images/)![1]).toEqual([["1b5c1d2e-3f40-4a5b-8c6d-7e8f9a0b1c2d"]]);
    expect(sqlIn(calls, /DELETE FROM fundraiser_pictures WHERE id = \$1/)![1]).toEqual([41]);
    expect(audits(calls)).toEqual([["admin:fern@example.com", "fundraiser.picture_deleted", "fundraiser", 7, { pictureId: 41, kind: "main", status: "approved" }]]);
  });

  it("one not there is not found", async () => {
    useClient(() => ({ rows: [] }));
    await expect(deletePicture(7, 41, "admin:fern@example.com")).rejects.toMatchObject({ reason: "not_found" });
  });
});

describe("the daily clear out", () => {
  it("lets go of the bytes of anything not used, replaced or taken off after 30 days, and of copies no longer on a page", async () => {
    const { calls } = useClient((sql) => {
      if (/SET bytes = NULL/.test(sql)) return { rows: [], rowCount: 2 };
      return undefined;
    });
    const out = await purgePictureBytes();
    expect(out).toEqual({ cleared: 2, swapped: 0 });
    const clear = sqlIn(calls, /SET bytes = NULL\s+WHERE/)!;
    expect(clear[0]).toMatch(/status NOT IN \('pending', 'approved'\)/);
    expect(clear[0]).toMatch(/interval '30 days'/);
    // A main photo staff swapped for another under "Photo for its page" is no longer on the page.
    expect(sqlIn(calls, /image_src IS DISTINCT FROM/)).toBeTruthy();
    expect(calls.map((c) => c[0])).toContain("COMMIT");
  });

  it("never touches a photo still waiting for staff, however long it has waited", async () => {
    const { calls } = useClient(() => undefined);
    await purgePictureBytes();
    const writes = calls.filter((c) => /UPDATE fundraiser_pictures/.test(c[0]));
    expect(writes.length).toBeGreaterThan(0);
    for (const [sql] of writes) {
      expect(sql).not.toMatch(/WHERE[^;]*status = 'pending'/s);
      expect(sql).not.toMatch(/'declined'/);
    }
  });

  it("counts the photos waiting, for the Monday summary", async () => {
    query.mockResolvedValueOnce({ rows: [{ n: "3" }] });
    expect(await countPendingPictures()).toBe(3);
    expect(String(query.mock.calls[0][0])).toMatch(/FROM fundraiser_pictures WHERE status = 'pending'/);
  });
});
