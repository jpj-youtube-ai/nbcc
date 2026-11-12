import { createHash } from "node:crypto";
import type { DoorRun } from "../../src/db/elf-game";
import type { Door } from "../../src/elf/calendar";
import { emptyDoor, type DoorClue, type DoorSetup } from "../../src/elf/door-setup";
import { doorState } from "../../src/elf/doors";
import { ELF_DEFAULTS } from "../../src/elf/settings";

// NBCC Elf Detective School: what the family's route tests share (test/unit/elf-routes-game.test.ts and
// test/unit/elf-routes-catch-up.test.ts): the pretend settings, cookies, family and doors, and the helper
// that asks the real router over HTTP. Each test file keeps its own vi.mock calls and its own server, as
// Vitest hoists the mocks file by file. Door 7's clues come out at 5:30pm, 6pm and 6:30pm on Monday
// 7 December 2026, and its place is shown at 7pm. Every family, place, clue and word here is invented:
// the repository is public.

export const at = (iso: string) => new Date(iso);
export const THREE = at("2026-12-07T15:00:00.000Z");
export const FIVE_47 = at("2026-12-07T17:47:00.000Z");
export const SIX_10 = at("2026-12-07T18:10:00.000Z");
export const SEVEN = at("2026-12-07T19:00:00.000Z");
export const SEVEN_05 = at("2026-12-07T19:05:00.000Z");

export const PREVIEW_TOKEN = "c".repeat(64);
export const ON = {
  ...ELF_DEFAULTS,
  schoolOn: true,
  year: 2026,
  previewHash: createHash("sha256").update(`elf:${PREVIEW_TOKEN}`).digest("hex"),
  doorsOn: true,
};
/** December's doors switched off: Elf Detective School is live, and the doors are wave 1's. */
export const OFF = { ...ON, doorsOn: false };

export const SESSION = `nbcc_elf_session=${"a".repeat(40)}`;
export const PRACTICE_PASS = `${SESSION}; nbcc_elf_preview=${PREVIEW_TOKEN}`;

export const FAMILY = {
  id: 3,
  grownUpName: "Sam Example",
  email: "sam.example@example.com",
  detectives: [
    { id: 100, firstName: "Ruby", surname: "Tinselfoot", nameApproved: true, badgeNumber: 427, look: null, fresh: [], favourites: [] },
    { id: 101, firstName: "Leo", surname: "Frostwhistle", nameApproved: false, badgeNumber: 428, look: null, fresh: [], favourites: [] },
  ],
};

export const CODE = "abcdefghijkm"; // door 7's poster
export const PRACTICE_CODE = "pqrstuvwxyz2";
export const TOKEN = "q2w3e4r5t6y7"; // a photo's address
export const TYPED_ELF = "Wigglepop"; // a name a head elf typed for door 7

export const clue = (n: 1 | 2 | 3, words: string, hasPicture = false): DoorClue => ({ n, words, hasPicture, pictureAlt: hasPicture ? "A pretend picture" : null });

export function door7(over: Partial<DoorSetup> = {}): DoorSetup {
  return {
    ...emptyDoor(7, CODE),
    placeName: "The Example Bakehouse",
    placeTown: "Exampleton",
    closesAt: "20:30",
    prize: "A pretend sledge",
    elfName: TYPED_ELF,
    tagWord: "SNOWBALL 472",
    names: [{ id: 1, name: "Example Bakes" }],
    clues: [clue(1, "Pretend clue one"), clue(2, "Pretend clue two", true), clue(3, "Pretend clue three")],
    ...over,
  };
}

/** Door 6, found on Sunday morning and open since. */
export const door6 = (): DoorSetup => ({
  ...emptyDoor(6, "c3d4e5f6g7h8"),
  placeName: "The Example Mill",
  placeTown: "Exampleton",
  tagWord: "PUDDING 316",
  clues: [clue(1, "Pretend clue one"), clue(2, "Pretend clue two"), clue(3, "Pretend clue three")],
  foundAt: at("2026-12-06T10:20:00.000Z"),
  foundFamilyId: 9,
});

/** Door 3, found last Thursday: its place is open, by both its names. */
export const door3 = (): DoorSetup => ({
  ...emptyDoor(3, "zyxwvutsrqpn"),
  placeName: "The Old Example Mill",
  placeTown: "Exampleton",
  tagWord: "TINSEL 828",
  names: [{ id: 2, name: "Example Mill" }],
  clues: [clue(1, "Pretend clue one"), clue(2, "Pretend clue two"), clue(3, "Pretend clue three")],
  foundAt: at("2026-12-03T17:50:00.000Z"),
  foundFamilyId: 9,
});

/** The given doors (1 to 6), snowed in on their days: every door has its row once December's doors are
 *  on, and one that could not run is snowed in at its first clue. Doors 1 to 5 unless told otherwise. */
export const snowedIn = (snowed: readonly Door[] = [1, 2, 3, 4, 5]): DoorSetup[] =>
  snowed.map((d) => ({ ...emptyDoor(d, "bcdfgh"[d - 1].repeat(12)), snowDayAt: at(`2026-12-0${d}T10:00:00.000Z`), snowDayBy: "automatic" }));

/** A practice evening a head elf started at 5:58pm, its clues three minutes apart. */
export const practiceRow = (over: Record<string, unknown> = {}) => ({
  startedAt: at("2026-12-07T17:58:00.000Z"),
  startedBy: "admin:staff@example.org",
  placeName: "The Example Office",
  placeTown: "Exampleton",
  elfName: "Tinsel",
  tagWord: "TINSEL 314",
  posterCode: PRACTICE_CODE,
  clue1At: at("2026-12-07T17:59:00.000Z"),
  clue2At: at("2026-12-07T18:02:00.000Z"),
  clue3At: at("2026-12-07T18:05:00.000Z"),
  revealAt: at("2026-12-07T18:20:00.000Z"),
  foundAt: null,
  foundFamilyId: null,
  ...over,
});

/** familyDoorsDone as the database would answer it: no cracks or visits, and the snowed in doors of
 *  the runs it is given (as the real one works them out). */
export async function doorsDoneFromRuns(_year: number, _familyId: number, runs: DoorRun[], now: Date) {
  const snow = runs.filter((r) => r.door > 0 && doorState(r.facts, now) === "snow").map((r) => r.door);
  return new Map(FAMILY.detectives.map((d) => [d.id, { cracked: [], visited: [], snow }]));
}

export interface Ask {
  json?: unknown;
  form?: Record<string, string | string[]>;
  /** The cookie header: signed in unless told otherwise; null for none. */
  cookie?: string | null;
  headers?: Record<string, string>;
}

/** The helper a route test asks the real router with, over HTTP, at the address `baseUrl` gives once the
 *  file's server is listening. Every request is signed in unless told otherwise, and comes from our own
 *  pages: its Origin is the server's own. */
export function callerAt(baseUrl: () => string) {
  return async function call(method: string, path: string, o: Ask = {}) {
    const base = baseUrl();
    const headers: Record<string, string> = { Origin: base, ...o.headers };
    const cookie = o.cookie === undefined ? SESSION : o.cookie;
    if (cookie) headers.Cookie = cookie;
    let body: string | undefined;
    if (o.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(o.json);
    } else if (o.form) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      body = new URLSearchParams(Object.entries(o.form).flatMap(([k, v]) => [v].flat().map((x) => [k, x]))).toString();
    }
    const res = await fetch(`${base}${path}`, { method, headers, body, redirect: "manual" });
    const bytes = Buffer.from(await res.arrayBuffer());
    const text = bytes.toString("utf8");
    const data = (res.headers.get("content-type") ?? "").includes("application/json") ? (JSON.parse(text) as Record<string, unknown>) : {};
    return { status: res.status, headers: res.headers, text, bytes, data };
  };
}
