import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

// GET /media/events/:id serves pictures staff uploaded, and (profile pictures) the copy of a main
// photo an organiser sent once staff approved it. Review: an organiser's main photo must come off
// when it is taken off, replaced or swapped, so its copy is served only while it is still that page's
// photo, and kept by browsers for five minutes rather than for ever. A staff upload is as before.

const db = vi.hoisted(() => ({ getEventImage: vi.fn(), fails: false }));
vi.mock("../../src/db/events", () => ({
  getEventImage: async (id: string) => {
    if (db.fails) throw new Error("database down");
    return db.getEventImage(id);
  },
}));

import { eventImagesRouter } from "../../src/routes/event-images";

const ID = "0b5c1d2e-3f40-4a5b-8c6d-7e8f9a0b1c2d";
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]);
let server: Server;
let base = "";
beforeAll(async () => {
  const app = express();
  app.use(eventImagesRouter);
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());
beforeEach(() => {
  db.getEventImage.mockReset();
  db.fails = false;
});

describe("serving an event picture", () => {
  // Every picture staff uploaded (an event's picture, an organiser's logo, a fundraiser's photo added
  // under "Photo for its page") has no organiser's picture behind it, and is served exactly as it was
  // before profile pictures: the same 200, the same bytes and type, kept for good.
  it.each([
    ["image/jpeg", JPEG],
    ["image/png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])],
    ["image/webp", Buffer.from("RIFFxxxxWEBP")],
  ])("serves a staff upload (%s) for good, exactly as before", async (mime, bytes) => {
    db.getEventImage.mockResolvedValue({ mime, bytes, organiser: false, live: false });
    const res = await fetch(`${base}/media/events/${ID}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(mime);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(Buffer.compare(Buffer.from(await res.arrayBuffer()), bytes)).toBe(0);
    expect(db.getEventImage).toHaveBeenCalledWith(ID);
  });

  it("still answers 404 for a picture that is not there, and for an address that is not a uuid without asking", async () => {
    db.getEventImage.mockResolvedValue(null);
    expect((await fetch(`${base}/media/events/${ID}`)).status).toBe(404);
    db.getEventImage.mockClear();
    expect((await fetch(`${base}/media/events/not-a-uuid`)).status).toBe(404);
    expect(db.getEventImage).not.toHaveBeenCalled();
  });

  it("still answers 500 when the picture cannot be read", async () => {
    db.fails = true;
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await fetch(`${base}/media/events/${ID}`);
    err.mockRestore();
    expect(res.status).toBe(500);
  });

  it("serves an organiser's approved main photo only for a few minutes at a time", async () => {
    db.getEventImage.mockResolvedValue({ mime: "image/jpeg", bytes: JPEG, organiser: true, live: true });
    const res = await fetch(`${base}/media/events/${ID}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("answers nothing for an organiser's main photo that is no longer the page's photo", async () => {
    db.getEventImage.mockResolvedValue({ mime: "image/jpeg", bytes: JPEG, organiser: true, live: false });
    expect((await fetch(`${base}/media/events/${ID}`)).status).toBe(404);
  });
});

describe("reading an event picture", () => {
  it("says whether it is an organiser's main photo, and whether it is still on its page", async () => {
    vi.resetModules();
    vi.doUnmock("../../src/db/events");
    const query = vi.fn().mockResolvedValue({ rows: [{ mime: "image/jpeg", bytes: JPEG, organiser: true, live: true }] });
    vi.doMock("../../src/db/pool", () => ({ pool: { query } }));
    vi.doMock("../../src/config", () => ({ config: { NODE_ENV: "test" } }));
    const { getEventImage } = await import("../../src/db/events");
    expect(await getEventImage(ID)).toEqual({ mime: "image/jpeg", bytes: JPEG, organiser: true, live: true });
    const sql = String(query.mock.calls[0][0]);
    expect(sql).toMatch(/LEFT JOIN fundraiser_pictures p ON p\.event_image_id = e\.id/);
    expect(sql).toMatch(/p\.status = 'approved'/);
    expect(sql).toMatch(/f\.image_src = '\/media\/events\/' \|\| e\.id::text/);
  });

  it("reads a staff upload, which has no organiser's picture behind it, as not an organiser's", async () => {
    vi.resetModules();
    vi.doUnmock("../../src/db/events");
    // What Postgres answers for a row with nothing joined to it: no picture, so both are false.
    const query = vi.fn().mockResolvedValue({ rows: [{ mime: "image/png", bytes: JPEG, organiser: false, live: false }] });
    vi.doMock("../../src/db/pool", () => ({ pool: { query } }));
    vi.doMock("../../src/config", () => ({ config: { NODE_ENV: "test" } }));
    const { getEventImage } = await import("../../src/db/events");
    expect(await getEventImage(ID)).toEqual({ mime: "image/png", bytes: JPEG, organiser: false, live: false });
    const sql = String(query.mock.calls[0][0]);
    // A LEFT join: the picture is found whether or not anything is linked to it, by its id alone.
    expect(sql).toMatch(/FROM event_images e LEFT JOIN/);
    expect(sql).not.toMatch(/(?<!LEFT )JOIN fundraiser_pictures/);
    expect(sql).toMatch(/\(p\.id IS NOT NULL\) AS organiser/);
    expect(sql).toMatch(/COALESCE\(/);
    expect(sql).toMatch(/WHERE e\.id = \$1/);
    expect(query.mock.calls[0][1]).toEqual([ID]);
    query.mockResolvedValueOnce({ rows: [] });
    expect(await getEventImage(ID)).toBeNull();
  });
});
