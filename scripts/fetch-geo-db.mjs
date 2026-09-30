// Fetches DB-IP's free "IP to City Lite" location database for the Docker image (TASK-481).
//
//   node scripts/fetch-geo-db.mjs <dir> [YYYY-MM-DD | YYYY-MM]
//
// Downloads this month's dbip-city-lite-YYYY-MM.mmdb.gz from download.db-ip.com (the month of the
// day given, which the production build passes as GEO_DAY), falling back to the month before, with
// a time limit on each attempt so a stalled server cannot hang the build, and unpacks it to
// <dir>/dbip-city-lite.mmdb, and checks it really is a MaxMind DB file. If both months fail it
// prints a warning and exits 0 anyway: the image then ships without it and the app records visits
// without places (src/analytics/geo-db.ts) rather than the deploy failing.
//
// Uses only Node (fetch, zlib), so the Docker stage that runs it needs no curl or apt step.
// The database is CC BY 4.0: "IP geolocation by DB-IP" (https://db-ip.com), credited in README.md.

import { createWriteStream } from "node:fs";
import { mkdir, open, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import { createGunzip } from "node:zlib";

export const GEO_FILE = "dbip-city-lite.mmdb";

const MARKER = Buffer.from([0xab, 0xcd, 0xef, ...Buffer.from("MaxMind.com", "latin1")]);
const METADATA_MAX = 128 * 1024;
/** How long one download may take, from asking to the last byte. */
export const DOWNLOAD_TIMEOUT_MS = 120_000;

const pad = (n) => String(n).padStart(2, "0");

/**
 * The month to try first and the one before it, as "YYYY-MM": the month of `override` (a
 * "YYYY-MM-DD" day or a "YYYY-MM" month) when it is valid, else of `now` in UTC.
 */
export function geoMonths(now, override) {
  let year = now.getUTCFullYear();
  let month = now.getUTCMonth() + 1;
  const m = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(override ?? "");
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) {
    year = Number(m[1]);
    month = Number(m[2]);
  }
  const prevYear = month === 1 ? year - 1 : year;
  const prevMonth = month === 1 ? 12 : month - 1;
  return [`${year}-${pad(month)}`, `${prevYear}-${pad(prevMonth)}`];
}

/** DB-IP's free download address for a month's City Lite file. */
export function geoUrl(month) {
  return `https://download.db-ip.com/free/dbip-city-lite-${month}.mmdb.gz`;
}

/** True when the file ends with a MaxMind DB metadata section. */
async function looksLikeMmdb(path) {
  const fh = await open(path, "r");
  try {
    const { size } = await fh.stat();
    const len = Math.min(size, METADATA_MAX);
    const tail = Buffer.alloc(len);
    await fh.read(tail, 0, len, size - len);
    return tail.lastIndexOf(MARKER) >= 0;
  } finally {
    await fh.close();
  }
}

/**
 * Tries each month in turn; installs the first good file as <dir>/dbip-city-lite.mmdb and answers
 * its month, or answers null (with a warning) when none worked. Never throws for a failed download.
 */
export async function installGeoDb({
  dir,
  months,
  fetch = globalThis.fetch,
  log = console.log,
  timeoutMs = DOWNLOAD_TIMEOUT_MS,
}) {
  await mkdir(dir, { recursive: true });
  const target = join(dir, GEO_FILE);
  const partial = `${target}.partial`;
  for (const month of months) {
    const url = geoUrl(month);
    try {
      // One time limit covers the whole attempt: the answer AND reading the body to the end.
      const signal = AbortSignal.timeout(timeoutMs);
      const res = await fetch(url, { signal });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      await pipeline(Readable.fromWeb(res.body), createGunzip(), createWriteStream(partial), { signal });
      if (!(await looksLikeMmdb(partial))) throw new Error("not a MaxMind DB file");
      await rename(partial, target);
      log(`geo: installed ${url} as ${target}`);
      return month;
    } catch (err) {
      await rm(partial, { force: true });
      const why = err instanceof Error ? `${err.name === "Error" ? "" : `${err.name}: `}${err.message}` : String(err);
      log(`geo: could not use ${url}: ${why}`);
    }
  }
  log(`geo: WARNING: no location database for ${months.join(" or ")}; building without it (visits will have no places)`);
  return null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [dir, day] = process.argv.slice(2);
  if (!dir) {
    console.log("usage: node fetch-geo-db.mjs <dir> [YYYY-MM-DD | YYYY-MM]");
    process.exit(0);
  }
  await installGeoDb({ dir, months: geoMonths(new Date(), day) });
}
