import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";

// NBCC Elf Detective School wave 2: the elf worker (src/elf/worker.ts), which sends the December emails,
// the alerts and the proud moments on time and clears the photos away from 31 January. Every outside call
// is a fake handed to runElfTick, so these read what a tick asks for and sends. The claims fake keeps
// elf_sends as the real SQL does, against the moment of the tick being run: a key is claimed once; a row
// not yet sent is claimable again once ten minutes old, three tries in all; a sent one never again; and the
// clue email's families are listed as the SQL lists them. December has no clock change, so London is UTC:
// door 7 is Monday 7 December 2026 (clues at 5:30pm, 6pm and 6:30pm, place shown at 7pm) and door 6 is
// Sunday 6 December, found at 10:20am. Every family, head elf and place here is invented.

const { settingsDb, sms } = vi.hoisted(() => ({
  settingsDb: { getElfSettings: vi.fn(), familyWithDetectives: vi.fn() },
  sms: { on: false },
}));
vi.mock("../../src/config", () => ({
  config: { NODE_ENV: "development", PORTAL_BASE_URL: "https://nbcc.example.org/", BALL_FROM_EMAIL: "events@example.org", SMS_SENDER_ID: "NBCC", SMS_PROVIDER: "stub" },
}));
// No database in a unit test: only the real outside calls' tests use them, and those fail here.
vi.mock("../../src/db/pool", () => ({
  pool: {
    query: vi.fn(async () => {
      throw new Error("no database in a unit test");
    }),
    connect: vi.fn(async () => {
      throw new Error("no database in a unit test");
    }),
  },
}));
vi.mock("../../src/db/elf", () => settingsDb);
vi.mock("../../src/clients/sms", () => ({
  sendText: vi.fn(),
  get smsConfigured() {
    return sms.on;
  },
}));

import { realElfDeps, runElfTick, sendProudMoments, startElfWorker, stopElfWorker, type ElfWorkerDeps, type WordMoment } from "../../src/elf/worker";
import { CLUE_EMAILS_A_TICK } from "../../src/elf/schedule";
import { ELF_PHOTO_TEXT } from "../../src/elf/emails";
import { emptyDoor, type DoorSetup } from "../../src/elf/door-setup";
import { config } from "../../src/config";
import type { ClueFamily } from "../../src/db/elf-sends";
import type { DoorRun } from "../../src/db/elf-game";
import type { DoorFacts } from "../../src/elf/doors";
import type { HeadElf } from "../../src/elf/alerts";
import type { ElfSettings } from "../../src/elf/settings";

const at = (iso: string) => new Date(iso);
const MINUTE = 60_000;
const EIGHT = at("2026-12-07T08:00:00Z");
const NINE_05 = at("2026-12-07T09:05:00Z");
const FIVE_31 = at("2026-12-07T17:31:00Z");
const SIX_05 = at("2026-12-07T18:05:00Z");

const ON: ElfSettings = { schoolOn: true, year: 2026, entryFromPence: 100, entrySuggestedPence: 500, previewHash: null, placePhone: "01632 960 123", doorsOn: true };
const OFF: ElfSettings = { ...ON, doorsOn: false };

const CODE = "abcdefghijkm";

function door7(over: { facts?: Partial<DoorFacts>; contactEmail?: string | null; closesAt?: string | null; words?: string | null; hasPicture?: boolean } = {}): DoorRun {
  const facts: DoorFacts = {
    clue1At: at("2026-12-07T17:30:00Z"),
    clue2At: at("2026-12-07T18:00:00Z"),
    clue3At: at("2026-12-07T18:30:00Z"),
    revealAt: at("2026-12-07T19:00:00Z"),
    closesAt: at("2026-12-07T20:30:00Z"),
    foundAt: null,
    snowDay: false,
    goneHome: false,
    ...over.facts,
  };
  return {
    year: 2026,
    door: 7,
    facts,
    calendarAt: facts.clue1At,
    state: "hunting",
    placeName: "The Example Bakehouse",
    placeTown: "Snowford",
    names: ["The Example Bakehouse"],
    contactEmail: over.contactEmail === undefined ? "bakehouse@example.org" : over.contactEmail,
    closesAt: over.closesAt === undefined ? "20:30" : over.closesAt,
    tagWord: "SNOWBALL 472",
    elfName: "Pip",
    prize: "A pretend sledge",
    prizeShowOff: false,
    posterCode: CODE,
    clues: [
      { n: 1, words: over.words === undefined ? "Pretend clue one" : over.words, hasPicture: over.hasPicture ?? false, pictureAlt: over.hasPicture ? "A pretend picture" : null, at: facts.clue1At },
      { n: 2, words: "Pretend clue two", hasPicture: false, pictureAlt: null, at: facts.clue2At },
      { n: 3, words: "Pretend clue three", hasPicture: false, pictureAlt: null, at: facts.clue3At },
    ],
    foundFamilyId: null,
  };
}

/** Door 6, found by family 9 on Sunday morning, its place shown since. */
function door6(over: { facts?: Partial<DoorFacts> } = {}): DoorRun {
  const facts: DoorFacts = {
    clue1At: at("2026-12-06T10:00:00Z"),
    clue2At: at("2026-12-06T10:30:00Z"),
    clue3At: at("2026-12-06T11:00:00Z"),
    revealAt: at("2026-12-06T11:30:00Z"),
    closesAt: at("2026-12-06T17:00:00Z"),
    foundAt: at("2026-12-06T10:20:00Z"),
    snowDay: false,
    goneHome: false,
    ...over.facts,
  };
  return {
    ...door7(),
    door: 6,
    facts,
    calendarAt: facts.clue1At,
    state: "found",
    placeName: "The Example Mill",
    placeTown: "Snowford",
    names: ["The Example Mill"],
    contactEmail: "mill@example.org",
    posterCode: "c3d4e5f6g7h8",
    foundFamilyId: 9,
  };
}

/** Door 7's setup in Doors: everything done except its door picture, which none has in a test. */
const door7Setup = (over: Partial<DoorSetup> = {}): DoorSetup => ({
  ...emptyDoor(7, CODE),
  placeName: "The Example Bakehouse",
  placeTown: "Snowford",
  placeAddress: "1 Example Street",
  contactName: "Alex Example",
  contactEmail: "bakehouse@example.org",
  closesAt: "20:30",
  prize: "A pretend sledge",
  elfName: "Pip",
  tagWord: "SNOWBALL 472",
  droppedOffAt: at("2026-12-05T12:00:00Z"),
  clues: [
    { n: 1, words: "Pretend clue one", hasPicture: false, pictureAlt: null },
    { n: 2, words: "Pretend clue two", hasPicture: false, pictureAlt: null },
    { n: 3, words: "Pretend clue three", hasPicture: false, pictureAlt: null },
  ],
  ...over,
});

const ALEX: HeadElf = { userId: 1, name: "Alex Example", email: "alex@example.org", mobile: "+447700900123", alertsOn: true };
const JO: HeadElf = { userId: 2, name: "Jo Example", email: "jo@example.org", mobile: null, alertsOn: true };
const QUIET: HeadElf = { userId: 3, name: "Kim Example", email: "kim@example.org", mobile: "+447700900124", alertsOn: false };

const RUBY = { id: 100, firstName: "Ruby", surname: "Tinselfoot", nameApproved: false, badgeNumber: 427, look: null, fresh: [], favourites: [] };
const SAM_FAMILY = { id: 3, grownUpName: "Sam Example", email: "sam@example.org", detectives: [RUBY] };

interface Sent {
  kind: string;
  name: string | null;
  to: string;
  from: string;
  subject: string;
  text: string;
  html: string;
}

interface Row {
  claimedAt: number;
  sentAt: number | null;
  attempts: number;
  lastError: string | null;
}

/** elf_sends as src/db/elf-sends.ts keeps it, read against the clock of the tick being run. */
function fakeSends(clock: { now: Date }) {
  const rows = new Map<string, Row>();
  const idOf = (kind: string, key: string) => `${kind} ${key}`;
  const now = () => clock.now.getTime();
  const listed = (row: Row | undefined) => !row || !(row.sentAt !== null || row.attempts >= 3 || row.claimedAt > now() - 10 * MINUTE);
  return {
    rows,
    row: (kind: string, key: string) => rows.get(idOf(kind, key)),
    /** A send that went before the test began. */
    alreadySent: (kind: string, key: string) => rows.set(idOf(kind, key), { claimedAt: 0, sentAt: 0, attempts: 1, lastError: null }),
    claimSend: vi.fn(async (kind: string, key: string) => {
      const row = rows.get(idOf(kind, key));
      if (!row) {
        rows.set(idOf(kind, key), { claimedAt: now(), sentAt: null, attempts: 1, lastError: null });
        return true;
      }
      if (row.sentAt === null && row.attempts < 3 && row.claimedAt < now() - 10 * MINUTE) {
        row.claimedAt = now();
        row.attempts += 1;
        return true;
      }
      return false;
    }),
    markSent: vi.fn(async (kind: string, key: string) => {
      const row = rows.get(idOf(kind, key));
      if (row) {
        row.sentAt = now();
        row.lastError = null;
      }
    }),
    markSendFailed: vi.fn(async (kind: string, key: string, error: string) => {
      const row = rows.get(idOf(kind, key));
      if (row) row.lastError = error;
    }),
    /** As familiesStillToEmail's SQL lists them: a family whose row went, was given up or is in flight is
     *  left out. */
    stillToEmail: (doorKey: string, families: ClueFamily[]) => families.filter((f) => listed(rows.get(idOf("clue", `${doorKey}:${f.familyId}`)))),
  };
}

/** Fake outside calls: nothing waiting, nothing due, the claims kept as elf_sends keeps them, and `tick`,
 *  which runs one tick with the claims reading the same moment. `clueFamilies` are the families a door's
 *  clue email could go to. */
function fakeDeps(over: Partial<ElfWorkerDeps> = {}, o: { clueFamilies?: ClueFamily[] } = {}) {
  const clock = { now: new Date(0) };
  const sends = fakeSends(clock);
  const sent: Sent[] = [];
  const sender = (kind: string) =>
    vi.fn(async (name: string | null, m: { email: string; from: string; subject: string; text: string; html: string }) => {
      sent.push({ kind, name, to: m.email, from: m.from, subject: m.subject, text: m.text, html: m.html });
    });
  const deps: ElfWorkerDeps = {
    siteOrigin: "https://nbcc.example.org",
    from: "events@example.org",
    smsSenderId: "NBCC",
    textsOn: true,
    unmarked: new Map(),
    getSettings: vi.fn(async () => ON),
    loadDoorRuns: vi.fn(async () => []),
    listDoors: vi.fn(async () => []),
    markAutomaticSnowDays: vi.fn(async () => []),
    familiesStillToEmail: vi.fn(async (year: number, door: number, limit: number) => sends.stillToEmail(`${year}-${door}`, o.clueFamilies ?? []).slice(0, limit)),
    familiesToSweep: vi.fn(async () => []),
    familyWithDetectives: vi.fn(async () => null),
    familyDoorsDone: vi.fn(async () => new Map()),
    finderOf: vi.fn(async () => null),
    finderParts: vi.fn(async () => []),
    countPhotosWaiting: vi.fn(async () => 0),
    oldestWaitingPhotoAt: vi.fn(async () => null),
    oldestWaitingPhotoDoor: vi.fn(async () => null),
    listHeadElves: vi.fn(async () => []),
    lastAlert: vi.fn(async () => null),
    recordAlert: vi.fn(async () => undefined),
    claimSend: sends.claimSend,
    markSent: sends.markSent,
    markSendFailed: sends.markSendFailed,
    sendText: vi.fn(async () => "stubbed" as const),
    deleteExpiredPhotoFiles: vi.fn(async () => 0),
    send: { clue: sender("clue"), reminder: sender("reminder"), morning: sender("morning"), findAlert: sender("find"), photoAlert: sender("photo"), proud: sender("proud") },
    ...over,
  };
  const tick = (moment: Date) => {
    clock.now = moment;
    return runElfTick(moment, deps);
  };
  return { deps, sent, sends, tick };
}

/** The keys a tick claimed of one kind, in order. */
const claimsOf = (deps: ElfWorkerDeps, kind: string): string[] => (deps.claimSend as Mock).mock.calls.filter((c) => c[0] === kind).map((c) => String(c[1]));
const sentOf = (sent: Sent[], kind: string) => sent.filter((s) => s.kind === kind);

/** A sender that fails, with a message, for the moments a test says, and sends otherwise. */
function failWhen(sender: Sender, fails: (to: string) => boolean, message: string) {
  const real = (sender as Mock).getMockImplementation()!;
  (sender as Mock).mockImplementation(async (name: string | null, m: { email: string }) => {
    if (fails(m.email)) throw new Error(message);
    return real(name, m);
  });
}
type Sender = ElfWorkerDeps["send"]["clue"];

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

// ---- the clue email ---------------------------------------------------------------------------------

describe("the clue email, at 5:31pm on 7 December", () => {
  const families = [11, 12, 13].map((id) => ({ familyId: id, email: `family${id}@example.org`, grownUpName: "Sam Example" }));
  const withClue = (over: Partial<ElfWorkerDeps> = {}) => fakeDeps({ loadDoorRuns: vi.fn(async () => [door7()]), ...over }, { clueFamilies: families });

  it("claims each family's key and sends each family one email", async () => {
    const { deps, sent, tick } = withClue();
    await tick(FIVE_31);
    expect(deps.familiesStillToEmail).toHaveBeenCalledWith(2026, 7, CLUE_EMAILS_A_TICK);
    expect(claimsOf(deps, "clue")).toEqual(["2026-7:11", "2026-7:12", "2026-7:13"]);
    const clues = sentOf(sent, "clue");
    expect(clues.map((s) => s.to)).toEqual(["family11@example.org", "family12@example.org", "family13@example.org"]);
    expect(clues[0]).toMatchObject({ name: "Sam Example", from: "events@example.org", subject: "Door 7: the first clue is out" });
    expect(clues[0].text).toContain("Pretend clue one");
    expect(clues[0].text).toContain("Clue 2 comes out at 6pm and clue 3 at 6:30pm");
    expect(clues[0].text).toContain("https://nbcc.example.org/elf/hq");
    expect(deps.markSent).toHaveBeenCalledWith("clue", "2026-7:11");
    expect(deps.markSent).toHaveBeenCalledWith("clue", "2026-7:13");
  });

  // Two tasks ticking at once with the same families: the database gives each family's key to only one.
  it("sends two when claimSend answers false for the second", async () => {
    const claimSend = vi.fn(async (_kind: string, key: string) => key !== "2026-7:12");
    const { deps, sent, tick } = withClue({ claimSend });
    await tick(FIVE_31);
    expect(sentOf(sent, "clue").map((s) => s.to)).toEqual(["family11@example.org", "family13@example.org"]);
    expect(deps.markSent).not.toHaveBeenCalledWith("clue", "2026-7:12");
  });

  it("notes a send that throws with its message, goes on to the next family, and tries it again ten minutes on", async () => {
    const { deps, sent, tick } = withClue();
    failWhen(deps.send.clue, (to) => to === "family12@example.org", "SES refused the message");
    await tick(FIVE_31);
    expect(deps.markSendFailed).toHaveBeenCalledWith("clue", "2026-7:12", "SES refused the message");
    expect(deps.markSent).not.toHaveBeenCalledWith("clue", "2026-7:12");
    expect(sentOf(sent, "clue").map((s) => s.to)).toEqual(["family11@example.org", "family13@example.org"]);
    // Still in flight five minutes on; listed and claimed again after ten, and sent.
    (deps.send.clue as Mock).mockImplementation(async (name: string | null, m: { email: string; from: string; subject: string; text: string; html: string }) => {
      sent.push({ kind: "clue", name, to: m.email, from: m.from, subject: m.subject, text: m.text, html: m.html });
    });
    await tick(at("2026-12-07T17:36:00Z"));
    expect(sentOf(sent, "clue")).toHaveLength(2);
    await tick(at("2026-12-07T17:42:00Z"));
    expect(sentOf(sent, "clue").map((s) => s.to)).toEqual(["family11@example.org", "family13@example.org", "family12@example.org"]);
  });

  // The send went, but the database failed as it was being marked sent: from this task it never goes again.
  it("never sends again a clue email that went but could not be marked sent, and marks it at the start of the next tick", async () => {
    const { deps, sent, sends, tick } = withClue();
    (deps.markSent as Mock).mockRejectedValueOnce(new Error("the database went away"));
    await tick(FIVE_31);
    expect(sentOf(sent, "clue")).toHaveLength(3);
    expect(sends.row("clue", "2026-7:11")!.sentAt).toBeNull();
    // Eleven minutes on, the SQL would list family 11 again: the note lands first, so nothing goes twice.
    await tick(at("2026-12-07T17:42:00Z"));
    expect(sends.row("clue", "2026-7:11")!.sentAt).toBe(at("2026-12-07T17:42:00Z").getTime());
    expect(claimsOf(deps, "clue").filter((k) => k === "2026-7:11")).toHaveLength(1);
    expect(sentOf(sent, "clue")).toHaveLength(3);
  });

  it("never sends it again from this task while the note keeps failing, though the SQL lists it once ten minutes have passed", async () => {
    const { deps, sent, sends, tick } = withClue();
    const land = (deps.markSent as Mock).getMockImplementation()!;
    (deps.markSent as Mock).mockImplementation(async (kind: string, key: string) => {
      if (kind === "clue" && key === "2026-7:11") throw new Error("the database went away");
      return land(kind, key);
    });
    for (const t of ["2026-12-07T17:31:00Z", "2026-12-07T17:42:00Z", "2026-12-07T17:53:00Z"]) await tick(at(t));
    expect(sends.stillToEmail("2026-7", families)).toEqual([families[0]]);
    expect(sentOf(sent, "clue").filter((s) => s.to === "family11@example.org")).toHaveLength(1);
    expect(claimsOf(deps, "clue").filter((k) => k === "2026-7:11")).toHaveLength(1);
    // The note was tried at the start of every tick after the first.
    expect((deps.markSent as Mock).mock.calls.filter((c) => c[0] === "clue" && c[1] === "2026-7:11")).toHaveLength(3);
  });

  it("never sends a first clue that has neither words nor a picture", async () => {
    const { deps, sent, tick } = withClue({ loadDoorRuns: vi.fn(async () => [door7({ words: null })]) });
    await tick(FIVE_31);
    expect(claimsOf(deps, "clue")).toEqual([]);
    expect(sentOf(sent, "clue")).toEqual([]);
  });

  it("tells a family a picture only clue is in Detective HQ, never sending the picture", async () => {
    const { sent, tick } = withClue({ loadDoorRuns: vi.fn(async () => [door7({ words: null, hasPicture: true })]) });
    await tick(FIVE_31);
    const first = sentOf(sent, "clue")[0];
    expect(first.text).toContain("Clue 1 is a picture: A pretend picture. See it in Detective HQ.");
    expect(first.html).not.toContain("/elf/hq/clue/");
  });
});

// ---- snow days, and the order of a tick -------------------------------------------------------------

describe("each tick", () => {
  it("snows in what cannot run with the tick's own time, only while December's doors are on, before reading the doors", async () => {
    const on = fakeDeps();
    await on.tick(FIVE_31);
    expect(on.deps.markAutomaticSnowDays).toHaveBeenCalledWith(2026, FIVE_31);
    const snowOrder = (on.deps.markAutomaticSnowDays as Mock).mock.invocationCallOrder[0];
    expect(snowOrder).toBeLessThan((on.deps.loadDoorRuns as Mock).mock.invocationCallOrder[0]);

    const off = fakeDeps({ getSettings: vi.fn(async () => OFF) });
    await off.tick(FIVE_31);
    expect(off.deps.markAutomaticSnowDays).not.toHaveBeenCalled();
    expect(off.deps.loadDoorRuns).not.toHaveBeenCalled();

    // Elf Detective School switched off sends nothing to families either, whatever December's doors say.
    const dark = fakeDeps({ getSettings: vi.fn(async () => ({ ...ON, schoolOn: false })) });
    await dark.tick(FIVE_31);
    expect(dark.deps.markAutomaticSnowDays).not.toHaveBeenCalled();
  });

  it("clears expired photos away on every tick, with the tick's own time, doors on or off", async () => {
    for (const settings of [ON, OFF]) {
      const { deps, tick } = fakeDeps({ getSettings: vi.fn(async () => settings) });
      await tick(SIX_05);
      expect(deps.deleteExpiredPhotoFiles).toHaveBeenCalledWith(SIX_05);
    }
  });

  it("never lets one part's failure stop the rest", async () => {
    const { deps, sent, tick } = fakeDeps({
      markAutomaticSnowDays: vi.fn(async () => {
        throw new Error("the doors could not be read");
      }),
      loadDoorRuns: vi.fn(async () => [door7()]),
      familiesStillToEmail: vi.fn(async () => {
        throw new Error("the families could not be read");
      }),
      oldestWaitingPhotoAt: vi.fn(async () => at("2026-12-07T17:30:00Z")),
      oldestWaitingPhotoDoor: vi.fn(async () => 7 as const),
      listHeadElves: vi.fn(async () => [JO]),
    });
    await tick(FIVE_31);
    expect(sentOf(sent, "photo").map((s) => s.to)).toEqual(["jo@example.org"]);
    expect(deps.deleteExpiredPhotoFiles).toHaveBeenCalledWith(FIVE_31);
    expect(console.error).toHaveBeenCalled();
  });

  it("reads the doors as switched off when the settings cannot be read, and still clears photos away", async () => {
    const { deps, tick } = fakeDeps({
      getSettings: vi.fn(async () => {
        throw new Error("no settings");
      }),
    });
    await tick(FIVE_31);
    expect(deps.markAutomaticSnowDays).not.toHaveBeenCalled();
    expect(deps.deleteExpiredPhotoFiles).toHaveBeenCalledWith(FIVE_31);
  });
});

// ---- the place's reminder -------------------------------------------------------------------------------

describe("the place's reminder, at 9:05am on its day", () => {
  it("goes to the place's email with its contact's name, its closing time in words and the place phone", async () => {
    const { deps, sent, tick } = fakeDeps({ loadDoorRuns: vi.fn(async () => [door7()]), listDoors: vi.fn(async () => [door7Setup()]) });
    await tick(NINE_05);
    expect(claimsOf(deps, "reminder")).toEqual(["2026-7"]);
    const [mail] = sentOf(sent, "reminder");
    expect(mail).toMatchObject({ to: "bakehouse@example.org", from: "events@example.org", subject: "Today is your Elf Detective School day" });
    expect(mail.text).toContain("Hi Alex,");
    expect(mail.text).toContain("Tonight at 5:30pm, please put Pip and the poster out together");
    expect(mail.text).toContain("Our list says you close at 8:30pm.");
    expect(mail.text).toContain("ring NBCC on 01632 960 123.");
    expect(deps.markSent).toHaveBeenCalledWith("reminder", "2026-7");
  });

  it("goes without the ring line when Settings has no phone number for places", async () => {
    const { deps, sent, tick } = fakeDeps({
      getSettings: vi.fn(async () => ({ ...ON, placePhone: null })),
      loadDoorRuns: vi.fn(async () => [door7()]),
      listDoors: vi.fn(async () => [door7Setup()]),
    });
    await tick(NINE_05);
    const [mail] = sentOf(sent, "reminder");
    expect(mail.to).toBe("bakehouse@example.org");
    expect(mail.text).toContain("Tonight at 5:30pm, please put Pip");
    expect(mail.text).not.toContain("ring NBCC");
    expect(deps.markSendFailed).not.toHaveBeenCalled();
  });

  it("never goes for a snow day", async () => {
    const { deps, sent, tick } = fakeDeps({ loadDoorRuns: vi.fn(async () => [door7({ facts: { snowDay: true } })]), listDoors: vi.fn(async () => [door7Setup()]) });
    await tick(NINE_05);
    expect(claimsOf(deps, "reminder")).toEqual([]);
    expect(sentOf(sent, "reminder")).toEqual([]);
  });
});

// ---- the morning email ---------------------------------------------------------------------------------

describe("the morning email, at 8am on 7 December", () => {
  const morning = (over: Partial<ElfWorkerDeps> = {}) =>
    fakeDeps({
      loadDoorRuns: vi.fn(async () => [door6(), door7()]),
      listDoors: vi.fn(async () => [door7Setup()]),
      finderParts: vi.fn(async () => [{ firstName: "Ruby", surname: "Tinselfoot", approved: false }]),
      countPhotosWaiting: vi.fn(async () => 3),
      listHeadElves: vi.fn(async () => [ALEX, JO, QUIET]),
      ...over,
    });

  it("goes once to every head elf with alerts on: today's door and what it still needs, yesterday's finder by the public name, the photos and the posts", async () => {
    const { deps, sent, tick } = morning();
    await tick(EIGHT);
    expect(claimsOf(deps, "morning")).toEqual(["2026-12-07"]);
    const mails = sentOf(sent, "morning");
    expect(mails.map((m) => m.to)).toEqual(["alex@example.org", "jo@example.org"]);
    const text = mails[0].text;
    expect(mails[0].subject).toBe("Elf HQ: Monday 7 December");
    expect(text).toContain("Door 7 is NOT ready: the door picture. Fix it in Doors before 5:30pm, or it becomes a snow day.");
    expect(text).toContain("Detective R. Tinselfoot found door 6's elf at 10:20am.");
    expect(text).toContain("3 photos waiting to be checked");
    expect(text).toContain("Door 7 of NBCC Elf Detective School opens tonight!");
    expect(text).toContain("Door 6 is open! Detective R. Tinselfoot found Pip at The Example Mill, Snowford at 10:20am.");
    expect(text).toContain("https://nbcc.example.org/admin");
    // Today's place is never named before it is shown.
    expect(text).not.toContain("The Example Bakehouse");
    expect(deps.finderParts).toHaveBeenCalledWith(2026, 6);
    expect(deps.markSent).toHaveBeenCalledWith("morning", "2026-12-07");
  });

  it("calls a snowed in door a snow day, today and yesterday, with no post for either", async () => {
    const { sent, tick } = morning({
      loadDoorRuns: vi.fn(async () => [door6({ facts: { snowDay: true, foundAt: null } }), door7({ facts: { snowDay: true } })]),
      finderParts: vi.fn(async () => []),
    });
    await tick(EIGHT);
    const text = sentOf(sent, "morning")[0].text;
    expect(text).toContain("Door 7 is a snow day.");
    expect(text).toContain("Door 6 was a snow day.");
    expect(text).not.toContain("opens tonight");
    expect(text).not.toContain("The Example Mill");
  });

  it("is not sent again by a second tick that morning", async () => {
    const { sent, tick } = morning();
    await tick(EIGHT);
    await tick(at("2026-12-07T08:00:30Z"));
    // The two head elves with alerts on, once each.
    expect(sentOf(sent, "morning").map((m) => m.to)).toEqual(["alex@example.org", "jo@example.org"]);
  });
});

// ---- the find alert -----------------------------------------------------------------------------------

describe("the find alert", () => {
  it("emails the head elves with alerts on who found the elf, by full name, once", async () => {
    const { deps, sent, tick } = fakeDeps({
      loadDoorRuns: vi.fn(async () => [door6(), door7()]),
      finderOf: vi.fn(async () => ({ detectives: ["Ruby Tinselfoot"], grownUpName: "Sam Example", email: "sam@example.org", at: at("2026-12-06T10:20:00Z") })),
      listHeadElves: vi.fn(async () => [ALEX, QUIET]),
    });
    await tick(FIVE_31);
    await tick(at("2026-12-07T17:31:30Z"));
    expect(deps.finderOf).toHaveBeenCalledWith(2026, 6);
    const finds = sentOf(sent, "find");
    expect(finds.map((m) => m.to)).toEqual(["alex@example.org"]);
    expect(finds[0].subject).toBe("Door 6's elf has been found");
    expect(finds[0].text).toContain("Ruby Tinselfoot (Sam Example's family) found Pip at The Example Mill at 10:20am.");
  });

  it("says nothing of a find whose family has been removed", async () => {
    const { deps, sent, tick } = fakeDeps({ loadDoorRuns: vi.fn(async () => [door6()]), listHeadElves: vi.fn(async () => [ALEX]) });
    await tick(FIVE_31);
    expect(sentOf(sent, "find")).toEqual([]);
    expect(deps.markSent).toHaveBeenCalledWith("find", "2026-6");
  });
});

// ---- photo alerts ---------------------------------------------------------------------------------------

describe("the photo alert", () => {
  const waiting = (over: Partial<ElfWorkerDeps> = {}) =>
    fakeDeps({
      getSettings: vi.fn(async () => OFF),
      oldestWaitingPhotoAt: vi.fn(async () => at("2026-12-07T18:00:00Z")),
      oldestWaitingPhotoDoor: vi.fn(async () => 7 as const),
      listHeadElves: vi.fn(async () => [ALEX, JO, QUIET]),
      ...over,
    });

  it("with two head elves, one with a mobile, sends two emails and one text, and records texts: 1", async () => {
    const { deps, sent, tick } = waiting();
    await tick(SIX_05);
    expect(claimsOf(deps, "photo-alert")).toEqual(["first:2026-12-07"]);
    const mails = sentOf(sent, "photo");
    expect(mails.map((m) => m.to)).toEqual(["alex@example.org", "jo@example.org"]);
    expect(mails[0].subject).toBe("A photo is waiting to be checked");
    expect(mails[0].text).toContain("A family has sent a photo from door 7 of Elf Detective School.");
    expect(deps.sendText).toHaveBeenCalledTimes(1);
    expect(deps.sendText).toHaveBeenCalledWith({ to: "+447700900123", text: ELF_PHOTO_TEXT, senderId: "NBCC" });
    expect(deps.recordAlert).toHaveBeenCalledWith({ kind: "photo", year: 2026, door: 7, emails: 2, texts: 1, textsFailed: [] });
    expect(deps.markSent).toHaveBeenCalledWith("photo-alert", "first:2026-12-07");
  });

  // A text Amazon refuses never stops the email, and Settings > Alerts says whose text did not go.
  it("when sendText throws, names that head elf in textsFailed and still sends both emails", async () => {
    const { deps, sent, tick } = waiting({
      sendText: vi.fn(async () => {
        throw new Error("SNS publish responded 400: …123");
      }),
    });
    await tick(SIX_05);
    expect(sentOf(sent, "photo").map((m) => m.to)).toEqual(["alex@example.org", "jo@example.org"]);
    expect(deps.recordAlert).toHaveBeenCalledWith({ kind: "photo", year: 2026, door: 7, emails: 2, texts: 0, textsFailed: ["Alex Example"] });
  });

  it("tries no text while texts are switched off, and counts none as failed", async () => {
    const { deps, tick } = waiting({ textsOn: false });
    await tick(SIX_05);
    expect(deps.sendText).not.toHaveBeenCalled();
    expect(deps.recordAlert).toHaveBeenCalledWith({ kind: "photo", year: 2026, door: 7, emails: 2, texts: 0, textsFailed: [] });
  });

  it("names the practice door when the photo waiting is the practice door's", async () => {
    const { deps, sent, tick } = waiting({ oldestWaitingPhotoDoor: vi.fn(async () => 0 as const) });
    await tick(SIX_05);
    expect(sentOf(sent, "photo")[0].text).toContain("A family has sent a photo from the practice door of Elf Detective School.");
    expect(deps.recordAlert).toHaveBeenCalledWith(expect.objectContaining({ door: 0 }));
  });

  it("sends nothing when claimSend answers false for the alert", async () => {
    const { deps, sent, tick } = waiting({ claimSend: vi.fn(async () => false) });
    await tick(SIX_05);
    expect(sentOf(sent, "photo")).toEqual([]);
    expect(deps.sendText).not.toHaveBeenCalled();
    expect(deps.recordAlert).not.toHaveBeenCalled();
  });

  it("claims the next alert by the last one's time, once every photo waiting then has been checked and half an hour has passed", async () => {
    const { deps, tick } = waiting({
      lastAlert: vi.fn(async () => ({ at: at("2026-12-07T18:04:00Z"), textsFailed: [] })),
      oldestWaitingPhotoAt: vi.fn(async () => at("2026-12-07T18:10:00Z")),
    });
    await tick(at("2026-12-07T18:20:00Z"));
    expect(claimsOf(deps, "photo-alert")).toEqual([]);
    await tick(at("2026-12-07T18:34:00Z"));
    expect(claimsOf(deps, "photo-alert")).toEqual(["2026-12-07T18:04:00.000Z:2026-12-07"]);
  });

  it("waits for 8am in quiet hours", async () => {
    const { deps, sent, tick } = waiting();
    await tick(at("2026-12-07T21:30:00Z"));
    expect(claimsOf(deps, "photo-alert")).toEqual([]);
    expect(sentOf(sent, "photo")).toEqual([]);
  });

  it("is tried again when not one email or text went, and recorded only once something has", async () => {
    const { deps, tick } = waiting({ listHeadElves: vi.fn(async () => [JO]) });
    (deps.send.photoAlert as Mock).mockRejectedValue(new Error("SES is down"));
    await tick(SIX_05);
    expect(deps.recordAlert).not.toHaveBeenCalled();
    expect(deps.markSendFailed).toHaveBeenCalledWith("photo-alert", "first:2026-12-07", "SES is down");
  });

  // The key carries the London date, which changes at midnight, inside quiet hours: so an alert given up after
  // three failed tries is tried again from 8am the next day, never stopped for good.
  it("tries an alert given up after three failed tries again from 8am the next day, with a new key", async () => {
    const { deps, sent, tick } = waiting({ listHeadElves: vi.fn(async () => [JO]) });
    const real = (deps.send.photoAlert as Mock).getMockImplementation()!;
    (deps.send.photoAlert as Mock).mockRejectedValue(new Error("SES is down"));
    for (const t of ["2026-12-07T18:05:00Z", "2026-12-07T18:16:00Z", "2026-12-07T18:27:00Z", "2026-12-07T18:38:00Z", "2026-12-07T20:50:00Z"]) await tick(at(t));
    expect(deps.markSendFailed).toHaveBeenCalledTimes(3);
    expect(sentOf(sent, "photo")).toEqual([]);
    (deps.send.photoAlert as Mock).mockImplementation(real);
    await tick(at("2026-12-08T08:00:00Z"));
    expect(claimsOf(deps, "photo-alert").at(-1)).toBe("first:2026-12-08");
    expect(sentOf(sent, "photo").map((m) => m.to)).toEqual(["jo@example.org"]);
    expect(deps.recordAlert).toHaveBeenCalledTimes(1);
  });

  // The emails went but the database failed as the alert was being recorded: no failure is noted, so it is
  // never sent again, though with no record an alert still reads as due.
  it("is never sent again when it went but its record could not be written", async () => {
    const { deps, sent, tick } = waiting({
      recordAlert: vi.fn(async () => {
        throw new Error("the database went away");
      }),
    });
    await tick(SIX_05);
    expect(sentOf(sent, "photo")).toHaveLength(2);
    expect(deps.markSendFailed).not.toHaveBeenCalled();
    expect(deps.markSent).toHaveBeenCalledWith("photo-alert", "first:2026-12-07");
    await tick(at("2026-12-07T18:16:00Z"));
    await tick(at("2026-12-07T18:40:00Z"));
    expect(sentOf(sent, "photo")).toHaveLength(2);
    expect(deps.sendText).toHaveBeenCalledTimes(1);
  });
});

// ---- the sweep: proud moments earned any way -------------------------------------------------------------

describe("the sweep", () => {
  const sweeping = (doorsDone: Map<number, { cracked: number[]; visited: number[]; snow: number[] }>, over: Partial<ElfWorkerDeps> = {}) =>
    fakeDeps({
      loadDoorRuns: vi.fn(async () => [door7()]),
      familiesToSweep: vi.fn(async () => [3]),
      familyWithDetectives: vi.fn(async (id: number) => (id === 3 ? SAM_FAMILY : null)),
      familyDoorsDone: vi.fn(async () => doorsDone),
      ...over,
    });
  const ALL = Array.from({ length: 24 }, (_, i) => i + 1);

  it("claims a promotion earned with a snow day and sends one promoted email, and ten minutes on sends nothing more", async () => {
    const { deps, sent, tick } = sweeping(new Map([[100, { cracked: [1, 2, 3], visited: [4, 5], snow: [6] }]]));
    await tick(FIVE_31);
    expect(claimsOf(deps, "sweep")).toEqual(["2026:2994441"]);
    expect(claimsOf(deps, "proud")).toEqual(["2026:rank:100:Junior Detective"]);
    expect(deps.familyDoorsDone).toHaveBeenCalledWith(2026, 3, [door7()], FIVE_31);
    const proud = sentOf(sent, "proud");
    expect(proud).toHaveLength(1);
    expect(proud[0]).toMatchObject({ to: "sam@example.org", name: "Sam Example", subject: "Detective Ruby Tinselfoot is now a Junior Detective" });

    await tick(at("2026-12-07T17:41:00Z"));
    expect(claimsOf(deps, "sweep")).toEqual(["2026:2994441", "2026:2994442"]);
    expect(sentOf(sent, "proud")).toHaveLength(1);
  });

  it("runs once in ten minutes however many ticks there are", async () => {
    const { deps, tick } = sweeping(new Map());
    await tick(FIVE_31);
    await tick(at("2026-12-07T17:31:30Z"));
    expect(deps.familiesToSweep).toHaveBeenCalledTimes(1);
  });

  // A run of snow days can bring several ranks at once: the family hears once, about the newest.
  it("sends one email for the highest new rank, claiming the lower ranks without an email", async () => {
    const { deps, sent, sends, tick } = sweeping(new Map([[100, { cracked: [1, 2, 3], visited: [4, 5], snow: [6, 7, 8, 9, 10, 11, 12] }]]));
    await tick(FIVE_31);
    expect(claimsOf(deps, "proud")).toEqual(["2026:rank:100:Junior Detective", "2026:rank:100:Detective"]);
    expect(sentOf(sent, "proud").map((m) => m.subject)).toEqual(["Detective Ruby Tinselfoot is now a Detective"]);
    expect(sends.row("proud", "2026:rank:100:Junior Detective")!.sentAt).not.toBeNull();
    await tick(at("2026-12-07T17:41:00Z"));
    expect(sentOf(sent, "proud")).toHaveLength(1);
  });

  it("gives a detective who has done every door at once the graduation alone", async () => {
    const { sent, tick } = sweeping(new Map([[100, { cracked: [], visited: [], snow: ALL }]]));
    await tick(FIVE_31);
    expect(sentOf(sent, "proud").map((m) => m.subject)).toEqual(["Detective Ruby Tinselfoot has graduated!"]);
  });

  it("gives a detective who reaches the last door the graduation, once", async () => {
    const { sent, sends, tick } = sweeping(new Map([[100, { cracked: [], visited: [], snow: ALL }]]));
    for (const k of ["2026:rank:100:Junior Detective", "2026:rank:100:Detective", "2026:rank:100:Senior Detective"]) sends.alreadySent("proud", k);
    await tick(FIVE_31);
    await tick(at("2026-12-07T17:41:00Z"));
    expect(sentOf(sent, "proud").map((m) => m.subject)).toEqual(["Detective Ruby Tinselfoot has graduated!"]);
  });

  it("tries a promotion whose email failed again on a sweep ten minutes on, and never sends the lower ranks", async () => {
    const { deps, sent, tick } = sweeping(new Map([[100, { cracked: [1, 2, 3], visited: [4, 5], snow: [6, 7, 8, 9, 10, 11, 12] }]]));
    failWhen(deps.send.proud, () => true, "SES refused the message");
    await tick(FIVE_31);
    expect(deps.markSendFailed).toHaveBeenCalledWith("proud", "2026:rank:100:Detective", "SES refused the message");
    (deps.send.proud as Mock).mockImplementation(async (name: string | null, m: { email: string; from: string; subject: string; text: string; html: string }) => {
      sent.push({ kind: "proud", name, to: m.email, from: m.from, subject: m.subject, text: m.text, html: m.html });
    });
    await tick(at("2026-12-07T17:42:00Z"));
    expect(sentOf(sent, "proud").map((m) => m.subject)).toEqual(["Detective Ruby Tinselfoot is now a Detective"]);
  });

  // The word's own won email may have failed: the sweep sends it later, from the finding family, by the same key.
  it("sends a found door's won email whose first try failed, and never twice", async () => {
    const { sent, sends, tick } = sweeping(new Map(), {
      loadDoorRuns: vi.fn(async () => [door6(), door7()]),
      familiesToSweep: vi.fn(async () => []),
      finderOf: vi.fn(async (_year: number, door: number) =>
        door === 6 ? { detectives: ["Ruby Tinselfoot", "Leo Frostwhistle"], grownUpName: "Sam Example", email: "sam@example.org", at: at("2026-12-06T10:20:00Z") } : null,
      ),
      finderParts: vi.fn(async (_year: number, door: number) =>
        door === 6
          ? [
              { firstName: "Ruby", surname: "Tinselfoot", approved: false },
              { firstName: "Leo", surname: "Frostwhistle", approved: false },
            ]
          : [],
      ),
    });
    sends.rows.set("proud 2026:won:9:6", { claimedAt: at("2026-12-06T10:20:00Z").getTime(), sentAt: null, attempts: 1, lastError: "SES refused the message" });
    await tick(FIVE_31);
    await tick(at("2026-12-07T17:41:00Z"));
    const won = sentOf(sent, "proud");
    expect(won.map((m) => m.subject)).toEqual(["You found Pip!"]);
    expect(won[0]).toMatchObject({ to: "sam@example.org", name: "Sam Example" });
    expect(won[0].text).toContain("Detective Ruby Tinselfoot and Detective Leo Frostwhistle were the first to find Pip on door 6");
  });

  // Task 6's re-review: the sweep's won email named the finders raw. It names them as the word's own won email
  // does, through the name checks (familyDetectiveName), so a name that fails them is never shown: here a
  // surname that is not one of the festive ones, and a first name with a second word typed after it.
  it("names the finders in the won email it sends through the name checks, as their own family sees them", async () => {
    const { sent, sends, tick } = sweeping(new Map(), {
      loadDoorRuns: vi.fn(async () => [door6()]),
      familiesToSweep: vi.fn(async () => []),
      finderOf: vi.fn(async () => ({
        detectives: ["Ruby Examplesurname", "Leo Exampleton Frostwhistle"],
        grownUpName: "Sam Example",
        email: "sam@example.org",
        at: at("2026-12-06T10:20:00Z"),
      })),
      finderParts: vi.fn(async () => [
        { firstName: "Ruby", surname: "Examplesurname", approved: false },
        { firstName: "Leo Exampleton", surname: "Frostwhistle", approved: true },
      ]),
    });
    sends.rows.set("proud 2026:won:9:6", { claimedAt: at("2026-12-06T10:20:00Z").getTime(), sentAt: null, attempts: 1, lastError: "SES refused the message" });
    await tick(FIVE_31);
    const won = sentOf(sent, "proud");
    expect(won.map((m) => m.subject)).toEqual(["You found Pip!"]);
    expect(won[0].text).toContain("Detective Ruby and Detective Frostwhistle were the first to find Pip on door 6");
    expect(won[0].text + won[0].html).not.toContain("Examplesurname");
    expect(won[0].text + won[0].html).not.toContain("Exampleton");
  });

  it("never sends a won email the word has sent already", async () => {
    const { sent, sends, tick } = sweeping(new Map(), {
      loadDoorRuns: vi.fn(async () => [door6()]),
      familiesToSweep: vi.fn(async () => []),
      finderOf: vi.fn(async () => ({ detectives: ["Ruby Tinselfoot"], grownUpName: "Sam Example", email: "sam@example.org", at: at("2026-12-06T10:20:00Z") })),
    });
    sends.alreadySent("proud", "2026:won:9:6");
    await tick(FIVE_31);
    expect(sentOf(sent, "proud")).toEqual([]);
  });

  it("goes on to the next family when one cannot be read", async () => {
    const { sent, tick } = sweeping(new Map([[100, { cracked: [1, 2, 3, 4, 5, 6], visited: [], snow: [] }]]), {
      familiesToSweep: vi.fn(async () => [2, 3]),
      familyWithDetectives: vi.fn(async (id: number) => {
        if (id === 2) throw new Error("that family could not be read");
        return SAM_FAMILY;
      }),
    });
    await tick(FIVE_31);
    expect(sentOf(sent, "proud")).toHaveLength(1);
  });
});

// ---- the proud moments after a word ------------------------------------------------------------------

describe("the proud moments after a word", () => {
  const moment = (over: Partial<WordMoment> = {}): WordMoment => ({
    year: 2026,
    door: 7,
    elfName: "Pip",
    family: { id: 3, grownUpName: "Sam Example", email: "sam@example.org" },
    won: true,
    stamped: [{ id: 100, name: "Detective Ruby Tinselfoot", doorsDone: { cracked: [], visited: [7], snow: [] } }],
    ...over,
  });

  it("claims the won key for a win and sends the won email, naming every detective stamped", async () => {
    const { deps, sent } = fakeDeps();
    await sendProudMoments(
      moment({
        stamped: [
          { id: 100, name: "Detective Ruby Tinselfoot", doorsDone: { cracked: [], visited: [7], snow: [] } },
          { id: 101, name: "Detective Leo Frostwhistle", doorsDone: { cracked: [], visited: [7], snow: [] } },
        ],
      }),
      deps,
    );
    expect(claimsOf(deps, "proud")).toEqual(["2026:won:3:7"]);
    const [won] = sentOf(sent, "proud");
    expect(won).toMatchObject({ to: "sam@example.org", name: "Sam Example", subject: "You found Pip!" });
    expect(won.text).toContain("Detective Ruby Tinselfoot and Detective Leo Frostwhistle were the first to find Pip on door 7");
    expect(deps.markSent).toHaveBeenCalledWith("proud", "2026:won:3:7");
  });

  it("claims each stamped detective's proud keys as the sweep does", async () => {
    const { deps, sent } = fakeDeps();
    await sendProudMoments(moment({ won: false, stamped: [{ id: 100, name: "Detective Ruby Tinselfoot", doorsDone: { cracked: [1, 2, 3], visited: [4, 5, 7], snow: [] } }] }), deps);
    expect(claimsOf(deps, "proud")).toEqual(["2026:rank:100:Junior Detective"]);
    expect(sentOf(sent, "proud").map((m) => m.subject)).toEqual(["Detective Ruby Tinselfoot is now a Junior Detective"]);
  });

  it("sends nothing for a moment already claimed, by the sweep or another tap", async () => {
    const { deps, sent, sends } = fakeDeps();
    sends.alreadySent("proud", "2026:won:3:7");
    await sendProudMoments(moment(), deps);
    expect(sentOf(sent, "proud")).toEqual([]);
  });

  it("sends nothing for the practice door", async () => {
    const { deps, sent } = fakeDeps();
    await sendProudMoments(moment({ year: 0, door: 0, stamped: [{ id: 100, name: "Detective Ruby Tinselfoot", doorsDone: { cracked: [1, 2, 3, 4, 5, 6], visited: [], snow: [] } }] }), deps);
    expect(deps.claimSend).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
  });

  it("sends nothing when the word stamped nobody", async () => {
    const { deps, sent } = fakeDeps();
    await sendProudMoments(moment({ stamped: [] }), deps);
    expect(deps.claimSend).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
  });
});

// ---- the real outside calls -------------------------------------------------------------------------------

describe("the real outside calls", () => {
  // Outside production the text client sends nothing (it stubs), so the BDD plays the text path too;
  // production texts only once texts are switched on.
  it("text head elves when texts are switched on, and outside production", () => {
    const settings = config as { NODE_ENV: string };
    try {
      expect(realElfDeps().textsOn).toBe(true);
      settings.NODE_ENV = "production";
      expect(realElfDeps().textsOn).toBe(false);
      sms.on = true;
      expect(realElfDeps().textsOn).toBe(true);
    } finally {
      settings.NODE_ENV = "development";
      sms.on = false;
    }
  });

  it("keep one memory of sends that went but were not marked, for the timer's ticks and the tick hook's alike", () => {
    const memory = realElfDeps().unmarked;
    expect(memory).toBeInstanceOf(Map);
    expect(realElfDeps().unmarked).toBe(memory);
  });
});

// ---- the timer ------------------------------------------------------------------------------------------

describe("the timer", () => {
  afterEach(() => {
    stopElfWorker();
    vi.useRealTimers();
  });

  it("ticks every interval with the real outside calls, never two ticks at once, and stops when told", async () => {
    vi.useFakeTimers();
    const pending: ((s: ElfSettings) => void)[] = [];
    settingsDb.getElfSettings.mockReset();
    settingsDb.getElfSettings.mockImplementation(() => new Promise<ElfSettings>((resolve) => pending.push(resolve)));
    startElfWorker(1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(settingsDb.getElfSettings).toHaveBeenCalledTimes(1);
    // The first tick is still waiting for the settings: the next intervals start no other.
    await vi.advanceTimersByTimeAsync(3000);
    expect(settingsDb.getElfSettings).toHaveBeenCalledTimes(1);
    pending[0](OFF);
    await vi.advanceTimersByTimeAsync(1000);
    expect(settingsDb.getElfSettings).toHaveBeenCalledTimes(2);
    stopElfWorker();
    pending[1](OFF);
    await vi.advanceTimersByTimeAsync(5000);
    expect(settingsDb.getElfSettings).toHaveBeenCalledTimes(2);
  });

  it("never holds the process open", () => {
    const timer = startElfWorker(60_000);
    expect(timer.hasRef()).toBe(false);
  });
});
