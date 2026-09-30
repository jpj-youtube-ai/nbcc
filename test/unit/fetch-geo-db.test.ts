import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync, readdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { geoMonths, geoUrl, installGeoDb, GEO_FILE } from "../../scripts/fetch-geo-db.mjs";
import { openGeoDb, GEO_DB_PATH } from "../../src/analytics/geo-db";
import { MmdbWriter, dbipRecord } from "./helpers/mmdb-writer";

// TASK-481: the Docker build fetches DB-IP's free City Lite database with scripts/fetch-geo-db.mjs:
// this month's file, else last month's, else none at all (the build carries on without it).

describe("geoMonths", () => {
  it("is this month then last month, in UTC", () => {
    expect(geoMonths(new Date("2026-10-01T00:30:00Z"))).toEqual(["2026-10", "2026-09"]);
    expect(geoMonths(new Date("2026-03-31T23:59:00Z"))).toEqual(["2026-03", "2026-02"]);
  });

  it("goes back across a new year", () => {
    expect(geoMonths(new Date("2027-01-02T12:00:00Z"))).toEqual(["2027-01", "2026-12"]);
  });

  it("starts from the month the build asks for, when it asks for a real one", () => {
    expect(geoMonths(new Date("2026-10-01T00:00:00Z"), "2026-01")).toEqual(["2026-01", "2025-12"]);
    expect(geoMonths(new Date("2026-10-01T00:00:00Z"), "")).toEqual(["2026-10", "2026-09"]);
    expect(geoMonths(new Date("2026-10-01T00:00:00Z"), "2026-13")).toEqual(["2026-10", "2026-09"]);
    expect(geoMonths(new Date("2026-10-01T00:00:00Z"), "latest")).toEqual(["2026-10", "2026-09"]);
  });
});

describe("geoUrl", () => {
  it("is DB-IP's free download for that month", () => {
    expect(geoUrl("2026-09")).toBe("https://download.db-ip.com/free/dbip-city-lite-2026-09.mmdb.gz");
  });
});

describe("installGeoDb", () => {
  const dirs: string[] = [];
  const tmp = () => {
    const d = mkdtempSync(join(tmpdir(), "fetch-geo-db-test-"));
    dirs.push(d);
    return d;
  };
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  const mmdb = new MmdbWriter({ ipVersion: 6, recordSize: 28 })
    .insert("192.0.2.0/24", dbipRecord({ country: "GB", region: "Inventshire", city: "Madeupton" }))
    .build();
  const ok = () => new Response(gzipSync(mmdb), { status: 200 });
  const notFound = () => new Response("Not Found", { status: 404 });
  const quiet = () => {};

  it("writes this month's file where the app looks for it", async () => {
    const dir = tmp();
    const fetch = vi.fn(async () => ok());
    const got = await installGeoDb({ dir, months: ["2026-10", "2026-09"], fetch, log: quiet });
    expect(got).toBe("2026-10");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(geoUrl("2026-10"));
    expect(openGeoDb(join(dir, GEO_FILE)).lookup("192.0.2.9")?.city).toBe("Madeupton");
    expect(readdirSync(dir)).toEqual([GEO_FILE]); // no half-written temporary file left behind
  });

  it("falls back to last month's file when this month's is not published yet", async () => {
    const dir = tmp();
    const fetch = vi.fn(async (url: string) => (url.includes("2026-10") ? notFound() : ok()));
    expect(await installGeoDb({ dir, months: ["2026-10", "2026-09"], fetch, log: quiet })).toBe("2026-09");
    expect(existsSync(join(dir, GEO_FILE))).toBe(true);
  });

  it("falls back when the download is not gzip, or not a location database", async () => {
    const dir = tmp();
    const answers = [
      new Response("<html>busy</html>", { status: 200 }),
      new Response(gzipSync(Buffer.from("not a database")), { status: 200 }),
      ok(),
    ];
    const fetch = vi.fn(async () => answers.shift() as Response);
    expect(await installGeoDb({ dir, months: ["2026-10", "2026-09", "2026-08"], fetch, log: quiet })).toBe("2026-08");
  });

  it("carries on without a file, and says so, when every month fails", async () => {
    const dir = tmp();
    const log = vi.fn();
    const fetch = vi.fn(async (url: string) => {
      if (url.includes("2026-10")) throw new Error("network down");
      return notFound();
    });
    expect(await installGeoDb({ dir, months: ["2026-10", "2026-09"], fetch, log })).toBeNull();
    expect(readdirSync(dir)).toEqual([]);
    expect(log.mock.calls.flat().join("\n")).toMatch(/WARNING.*without/i);
  });
});

describe("the app and the build agree on the file", () => {
  it("names the same file", () => {
    expect(GEO_DB_PATH.replace(/\\/g, "/")).toMatch(new RegExp(`/geo/${GEO_FILE.replace(".", "\\.")}$`));
  });
});
