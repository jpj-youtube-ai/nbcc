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
import { runOf, type DoorRun } from "../../src/db/elf-game";
import type { Door } from "../../src/elf/calendar";
import type { FamilyKnowledge } from "../../src/elf/catch-up";
import type { DoorFacts } from "../../src/elf/doors";
import type { SavedGuess } from "../../src/elf/guess";
import type { DoorsDone } from "../../src/elf/progress";
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

/** Door 7's setup in Doors: everything done, so it is ready (no door needs a picture of its own). */
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

/** Each family's own token for the link that stops its emails (Plan 2c-2), as the database makes them: invented. */
const TOKEN_3 = "0123456789abcdef0123456789abcd03";
const TOKEN_4 = "0123456789abcdef0123456789abcd04";
/** A family's own page for stopping the emails, as the worker links it. */
const stopPage = (token: string) => `https://nbcc.example.org/elf/emails/${token}`;

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
    familyKnowledge: vi.fn(async () => ({ guesses: new Map(), typed: new Set<number>() })),
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

  // Plan 2c-2, Task 7: each clue email ends with the link to that family's own page for stopping the emails. A family
  // that has stopped them is never listed (familiesStillToEmail's SQL, test/unit/elf-db-sends.test.ts).
  it("ends each family's email with the link to its own page for stopping the emails", async () => {
    const tokens = ["0123456789abcdef0123456789abcd11", "0123456789abcdef0123456789abcd12", "0123456789abcdef0123456789abcd13"];
    const { sent, tick } = fakeDeps({ loadDoorRuns: vi.fn(async () => [door7()]) }, { clueFamilies: families.map((f, i) => ({ ...f, emailsToken: tokens[i] })) });
    await tick(FIVE_31);
    const clues = sentOf(sent, "clue");
    expect(clues).toHaveLength(3);
    clues.forEach((c, i) => {
      expect(c.text).toContain(`Stop these emails: ${stopPage(tokens[i])}`);
      expect(c.html).toContain(`href="${stopPage(tokens[i])}"`);
      for (const other of tokens.filter((t) => t !== tokens[i])) expect(c.text + c.html).not.toContain(other);
    });
  });

  it("makes no link from a token that is not one", async () => {
    const { sent, tick } = fakeDeps({ loadDoorRuns: vi.fn(async () => [door7()]) }, { clueFamilies: [{ ...families[0], emailsToken: "../admin?x=1" }] });
    await tick(FIVE_31);
    const [mail] = sentOf(sent, "clue");
    expect(mail.text).toContain("Pretend clue one");
    expect(mail.text + mail.html).not.toContain("Stop these emails");
    expect(mail.text + mail.html).not.toContain("/elf/emails/");
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

  // Plan 2c-1, Task 9: the email says when the place closes on its day (closingShown), only when a closing time
  // is typed in Doors, or on Christmas Eve, whose door 24 closes at 4pm unless a head elf types a time (Plan 2c-2,
  // ruling F4, pinned below); it never says when the place is shown, and says a missed hunt can be cracked later.
  it("tells each family when the place closes when a closing time is typed, and nothing of closing when none is", async () => {
    const typed = withClue({ loadDoorRuns: vi.fn(async () => [door7({ closesAt: "20:00", facts: { closesAt: at("2026-12-07T20:00:00Z") } })]) });
    await typed.tick(FIVE_31);
    const closing = sentOf(typed.sent, "clue")[0].text;
    expect(closing).toContain("The hiding place closes at 8pm today.");
    expect(closing).toContain("You find out whether you cracked it at 7pm, or later if the elf is still hiding then.");
    expect(closing).toContain("If you miss tonight's hunt, you can still crack this case later in Detective HQ, with one guess.");
    expect(closing).not.toContain("is shown at");
    const none = withClue({ loadDoorRuns: vi.fn(async () => [door7({ closesAt: null })]) });
    await none.tick(FIVE_31);
    const plain = sentOf(none.sent, "clue")[0].text;
    expect(plain).not.toContain("closes at");
    expect(plain).toContain("You find out whether you cracked it at 7pm, or later if the elf is still hiding then.");
  });
});

// ---- the week before Christmas Eve ------------------------------------------------------------------

// Plan 2c-2, Task 8: the clue emails of doors 17 to 23 end with the grand prize lines for each family, worked out from
// its doors done and the doors it can still crack from home, read once its send is claimed (ruling F17); door 23's also
// says when door 24's first clue comes out. December 2026 as the doors read with nothing changed in Doors: doors 16 to
// 18 and 21 to 23 are school days, their first clue at 5:30pm and their place closing at 8pm; 19 and 20 a weekend, at
// 10am; door 24, Christmas Eve, at 10am, its place closing at 4pm. So by 5:31pm on Friday 18 December, when door 18's
// email goes, doors 1 to 17 are done for everyone.
describe("the clue email in the week before Christmas Eve", () => {
  const FRI_18 = at("2026-12-18T17:31:00Z");
  const WED_16 = at("2026-12-16T17:31:00Z");
  const WED_23 = at("2026-12-23T17:31:00Z");
  const THU_24 = at("2026-12-24T10:01:00Z");
  const READY = "Have you got your picture ready?";
  const BEHIND = "Catching up for the grand prize";
  const TOMORROW = "Tomorrow is Christmas Eve";
  const doorsUpTo = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
  /** A door set up in Doors with its place, the word on its tag and its three clues, at the default times. */
  const setupOf = (door: number, over: Partial<DoorSetup> = {}): DoorSetup => ({
    ...emptyDoor(door as Door, `code${door}`),
    placeName: "Corner Bakehouse",
    placeTown: "Snowford",
    tagWord: "SNOWBALL 472",
    elfName: "Twinkle",
    clues: [
      { n: 1, words: "Pretend clue one", hasPicture: false, pictureAlt: null },
      { n: 2, words: "Pretend clue two", hasPicture: false, pictureAlt: null },
      { n: 3, words: "Pretend clue three", hasPicture: false, pictureAlt: null },
    ],
    ...over,
  });
  /** The 24 doors as a tick reads them, with whatever a head elf changed. */
  const december = (now: Date, over: Record<number, Partial<DoorSetup>> = {}): DoorRun[] => doorsUpTo(24).map((door) => runOf(2026, setupOf(door, over[door]), now));
  /** Detective 100's doors done. Every detective in a family has the same doors done. */
  const doneOf = (doors: number[]): Map<number, DoorsDone> => new Map([[100, { cracked: doors, visited: [], family: [], snow: [] }]]);
  const GUESS: SavedGuess = { text: "Corner Bakehouse", norm: "corner bakehouse", at: at("2026-12-01T18:00:00Z"), late: false };
  /** A family that has a guess at these doors, right or wrong, and has typed no tag's word. */
  const guessed = (doors: number[]): FamilyKnowledge => ({ guesses: new Map(doors.map((d) => [d, GUESS])), typed: new Set<number>() });
  const FAMILY_3: ClueFamily = { familyId: 3, email: "sam@example.org", grownUpName: "Sam Example", emailsToken: TOKEN_3 };
  const FAMILY_4: ClueFamily = { familyId: 4, email: "alex@example.org", grownUpName: "Alex Example", emailsToken: TOKEN_4 };

  /** A tick's fakes: the doors at the tick's own moment, the families to email (3 and 4 unless said), and each family's
   *  doors done (none: no detective) and what it has done door by door (nothing). */
  function week(
    o: { doors?: Record<number, Partial<DoorSetup>>; done?: Record<number, Map<number, DoorsDone>>; knowledge?: Record<number, FamilyKnowledge>; families?: ClueFamily[]; over?: Partial<ElfWorkerDeps> } = {},
  ) {
    return fakeDeps(
      {
        loadDoorRuns: vi.fn(async (_year: number, now: Date) => december(now, o.doors)),
        familyDoorsDone: vi.fn(async (_year: number, familyId: number) => o.done?.[familyId] ?? new Map<number, DoorsDone>()),
        familyKnowledge: vi.fn(async (_year: number, familyId: number) => o.knowledge?.[familyId] ?? guessed([])),
        ...o.over,
      },
      { clueFamilies: o.families ?? [FAMILY_3, FAMILY_4] },
    );
  }
  /** The one clue email sent to an address. */
  function mailTo(sent: Sent[], to: string): Sent {
    const found = sentOf(sent, "clue").filter((s) => s.to === to);
    expect(found, to).toHaveLength(1);
    return found[0];
  }

  it("asks a family that has done every door so far whether its picture is ready, and tells one that is behind how many doors it can still crack from home", async () => {
    const { deps, sent, tick } = week({
      done: { 3: doneOf(doorsUpTo(17)), 4: doneOf(doorsUpTo(15)) },
      knowledge: { 3: guessed(doorsUpTo(17)), 4: guessed(doorsUpTo(15)) },
    });
    await tick(FRI_18);
    const ready = mailTo(sent, "sam@example.org");
    expect(ready.subject).toBe("Door 18: the first clue is out");
    expect(ready.text).toContain(READY);
    expect(ready.text).toContain("Every detective who does all 24 doors can send in a drawing, or a photo of their naughtiest elf at home, for the grand prize.");
    expect(ready.text).toContain("You can send it in Detective HQ from the morning of Christmas Eve until 5pm that day.");
    expect(ready.text).not.toContain(BEHIND);
    const behind = mailTo(sent, "alex@example.org");
    expect(behind.text).toContain(BEHIND);
    expect(behind.text).toContain("You can still crack 2 doors from home, with one guess each. They are in Detective HQ, under Doors you can still crack.");
    expect(behind.text).toContain("Every detective who does all 24 doors can send in a picture for the grand prize on Christmas Eve.");
    expect(behind.text).not.toContain(READY);
    for (const mail of [ready, behind]) expect(mail.text).not.toContain(TOMORROW);
    // Each family's own, read at the tick, with the doors the tick read; and each still ends with its own link.
    expect(deps.familyDoorsDone).toHaveBeenCalledWith(2026, 3, expect.any(Array), FRI_18);
    expect(deps.familyDoorsDone).toHaveBeenCalledWith(2026, 4, expect.any(Array), FRI_18);
    expect(deps.familyKnowledge).toHaveBeenCalledWith(2026, 3);
    expect(deps.familyKnowledge).toHaveBeenCalledWith(2026, 4);
    expect(ready.text).toContain(`Stop these emails: ${stopPage(TOKEN_3)}`);
    expect(behind.text).toContain(`Stop these emails: ${stopPage(TOKEN_4)}`);
  });

  it("says when the entries close as a head elf set them", async () => {
    const { sent, tick } = week({
      over: { getSettings: vi.fn(async () => ({ ...ON, grandPrizeClosesAt: at("2026-12-24T17:30:00Z") })) },
      done: { 3: doneOf(doorsUpTo(17)) },
      families: [FAMILY_3],
    });
    await tick(FRI_18);
    expect(mailTo(sent, "sam@example.org").text).toContain("You can send it in Detective HQ from the morning of Christmas Eve until 5:30pm that day.");
  });

  it("tells a family that is behind with nothing left to crack from home to visit the places it has not done", async () => {
    // Doors 16 and 17 guessed wrong: neither is done, and neither has a go left.
    const { sent, tick } = week({ done: { 3: doneOf(doorsUpTo(15)) }, knowledge: { 3: guessed(doorsUpTo(17)) }, families: [FAMILY_3] });
    await tick(FRI_18);
    const { text } = mailTo(sent, "sam@example.org");
    expect(text).toContain(BEHIND);
    expect(text).toContain("To catch up, visit the hiding places of the doors you have not done yet, and type the word on each elf's tag.");
    expect(text).not.toContain("You can still crack");
  });

  it("says in door 23's email when door 24's first clue comes out, at the time a head elf set, before the clue 2 line", async () => {
    const { sent, tick } = week({ doors: { 24: { clue1Time: "09:30" } }, done: { 3: doneOf(doorsUpTo(22)) }, families: [FAMILY_3] });
    await tick(WED_23);
    const { subject, text } = mailTo(sent, "sam@example.org");
    expect(subject).toBe("Door 23: the first clue is out");
    const line = "Tomorrow is Christmas Eve, so door 24's first clue comes out at 9:30am, and hiding places close early.";
    expect(text).toContain(line);
    expect(text.indexOf(line)).toBeLessThan(text.indexOf("Clue 2 comes out at"));
    expect(text).toContain(READY);
  });

  // Ruling F17: a head elf can call door 24 off before its first clue, and then no clue comes out.
  it("says nothing of door 24 in door 23's email when door 24 is snowed in", async () => {
    const { sent, tick } = week({ doors: { 24: { snowDayAt: at("2026-12-23T12:00:00Z") } }, done: { 3: doneOf(doorsUpTo(22)) }, families: [FAMILY_3] });
    await tick(WED_23);
    const { text } = mailTo(sent, "sam@example.org");
    expect(text).not.toContain(TOMORROW);
    expect(text).toContain(READY);
  });

  // The spec puts no condition on door 23's line: every family is told when Christmas Eve starts, and only a family
  // with a detective is told how it stands for the grand prize.
  it("gives a family with no detective door 23's Christmas Eve line, and no line for the grand prize", async () => {
    const { sent, tick } = week({ families: [FAMILY_3] });
    await tick(WED_23);
    const { text } = mailTo(sent, "sam@example.org");
    expect(text).toContain("Pretend clue one");
    expect(text).toContain("Tomorrow is Christmas Eve, so door 24's first clue comes out at 10am, and hiding places close early.");
    for (const words of [READY, BEHIND]) expect(text).not.toContain(words);
  });

  it("gives door 16's and door 24's emails neither line, and reads nothing of the family's for them", async () => {
    for (const [moment, subject] of [
      [WED_16, "Door 16: the first clue is out"],
      [THU_24, "Door 24: the first clue is out"],
    ] as const) {
      const { deps, sent, tick } = week({ done: { 3: doneOf(doorsUpTo(23)) }, knowledge: { 3: guessed(doorsUpTo(23)) }, families: [FAMILY_3] });
      await tick(moment);
      const mail = mailTo(sent, "sam@example.org");
      expect(mail.subject).toBe(subject);
      for (const words of [TOMORROW, READY, BEHIND]) expect(mail.text, subject).not.toContain(words);
      expect(deps.familyDoorsDone, subject).not.toHaveBeenCalled();
      expect(deps.familyKnowledge, subject).not.toHaveBeenCalled();
    }
  });

  // Ruling F4: door 24's place closes at 4pm unless a head elf types a time, and its clues say so.
  it("tells each family on Christmas Eve that door 24's place closes at 4pm when no time is typed", async () => {
    const { sent, tick } = week({ families: [FAMILY_3] });
    await tick(THU_24);
    expect(mailTo(sent, "sam@example.org").text).toContain("The hiding place closes at 4pm today.");
  });

  // Ruling F17: each family's doors are read inside its own claimed send.
  it("reads nothing for a family whose send another task has claimed", async () => {
    const { deps, sent, tick } = week({
      over: { claimSend: vi.fn(async (kind: string, key: string) => !(kind === "clue" && key === "2026-18:4")) },
      done: { 3: doneOf(doorsUpTo(17)), 4: doneOf(doorsUpTo(17)) },
    });
    await tick(FRI_18);
    expect(sentOf(sent, "clue").map((s) => s.to)).toEqual(["sam@example.org"]);
    expect((deps.familyDoorsDone as Mock).mock.calls.map((c) => c[1])).toEqual([3]);
    expect((deps.familyKnowledge as Mock).mock.calls.map((c) => c[1])).toEqual([3]);
  });

  it("tries a family whose doors cannot be read again on its own ten minutes on, while the others go", async () => {
    let broken = true;
    const { deps, sent, tick } = week({
      done: { 3: doneOf(doorsUpTo(17)), 4: doneOf(doorsUpTo(15)) },
      knowledge: { 3: guessed(doorsUpTo(17)), 4: guessed(doorsUpTo(15)) },
    });
    const read = (deps.familyDoorsDone as Mock).getMockImplementation()!;
    (deps.familyDoorsDone as Mock).mockImplementation(async (year: number, familyId: number, runs: DoorRun[], now: Date) => {
      if (familyId === 4 && broken) throw new Error("the doors could not be read");
      return read(year, familyId, runs, now);
    });
    await tick(FRI_18);
    expect(sentOf(sent, "clue").map((s) => s.to)).toEqual(["sam@example.org"]);
    expect(deps.markSendFailed).toHaveBeenCalledWith("clue", "2026-18:4", "the doors could not be read");
    broken = false;
    await tick(at("2026-12-18T17:42:00Z"));
    expect(sentOf(sent, "clue").map((s) => s.to)).toEqual(["sam@example.org", "alex@example.org"]);
    expect(mailTo(sent, "alex@example.org").text).toContain("You can still crack 2 doors from home, with one guess each.");
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

  it("goes once to every head elf with alerts on: today's door and whether it is ready, yesterday's finder by the public name, the photos and the posts", async () => {
    const { deps, sent, tick } = morning();
    await tick(EIGHT);
    expect(claimsOf(deps, "morning")).toEqual(["2026-12-07"]);
    const mails = sentOf(sent, "morning");
    expect(mails.map((m) => m.to)).toEqual(["alex@example.org", "jo@example.org"]);
    const text = mails[0].text;
    expect(mails[0].subject).toBe("Elf HQ: Monday 7 December");
    // Everything is in for door 7, and a door needs no picture of its own: every door has the same present.
    expect(text).toContain("Door 7 is ready. The first clue comes out at 5:30pm.");
    expect(text).not.toContain("door picture");
    expect(text).toContain("Detective R. Tinselfoot found door 6's elf at 10:20am.");
    expect(text).toContain("3 photos waiting to be checked");
    expect(text).toContain("Door 7 of NBCC Elf Detective School opens tonight!");
    expect(text).toContain("Door 6 is open! Detective R. Tinselfoot found Pip at 10:20am. Missed it? You can still crack the case in Detective HQ, with one guess.");
    expect(text).toContain("https://nbcc.example.org/admin");
    // Today's place is never named before it is shown, and (Plan 2c-1) the posts never name yesterday's either.
    expect(text).not.toContain("The Example Bakehouse");
    expect(text).not.toContain("The Example Mill");
    expect(deps.finderParts).toHaveBeenCalledWith(2026, 6);
    expect(deps.markSent).toHaveBeenCalledWith("morning", "2026-12-07");
  });

  it("says what today's door still needs when it is not ready", async () => {
    const { sent, tick } = morning({ listDoors: vi.fn(async () => [door7Setup({ droppedOffAt: null })]) });
    await tick(EIGHT);
    const text = sentOf(sent, "morning")[0].text;
    // Door 7 has its place, the word on its tag and its first clue, so it opens: what it still needs is a to do.
    expect(text).toContain("Door 7 is NOT ready: dropped off. Fix it in Doors before 5:30pm.");
    expect(text).not.toContain("becomes a snow day");
  });

  // From the present PR's review: only a door that cannot open is snowed in at its first clue (canRun).
  it("says today's door becomes a snow day only when it cannot open as it stands", async () => {
    const { sent, tick } = morning({ listDoors: vi.fn(async () => [door7Setup({ tagWord: null })]) });
    await tick(EIGHT);
    expect(sentOf(sent, "morning")[0].text).toContain(
      "Door 7 is NOT ready: the elf and its tag. Fix it in Doors before 5:30pm. Without its place, the word on its tag or its first clue, it becomes a snow day.",
    );
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

  // Ruling F6: on Christmas Day the morning email still posts door 24, but having a go closed at midnight.
  it("no longer offers a go in door 24's post on Christmas Day, and never names its place", async () => {
    const facts: DoorFacts = {
      clue1At: at("2026-12-24T10:00:00Z"),
      clue2At: at("2026-12-24T10:30:00Z"),
      clue3At: at("2026-12-24T11:00:00Z"),
      revealAt: at("2026-12-24T11:30:00Z"),
      closesAt: at("2026-12-24T16:00:00Z"),
      foundAt: at("2026-12-24T10:20:00Z"),
      snowDay: false,
      goneHome: false,
    };
    const door24: DoorRun = { ...door6(), door: 24, facts, calendarAt: facts.clue1At };
    const { sent, tick } = morning({ loadDoorRuns: vi.fn(async () => [door24]) });
    await tick(at("2026-12-25T08:00:00Z"));
    const text = sentOf(sent, "morning")[0].text;
    expect(text).toContain("Door 24 is open! Detective R. Tinselfoot found Pip at 10:20am.");
    expect(text).not.toContain("Missed it?");
    expect(text).not.toContain("crack the case");
    expect(text).not.toContain("The Example Mill");
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

  // An alert that would reach nobody is neither claimed nor recorded: a record would read in Finds as "One
  // alert went", and would hold back the alert for these photos once someone turns alerts on.
  it("claims and records nothing while no head elf has alerts on, and alerts once someone turns them on", async () => {
    const { deps, sent, tick } = waiting({ listHeadElves: vi.fn(async () => [QUIET]) });
    await tick(SIX_05);
    expect(claimsOf(deps, "photo-alert")).toEqual([]);
    expect(deps.recordAlert).not.toHaveBeenCalled();
    expect(sentOf(sent, "photo")).toEqual([]);
    expect(deps.sendText).not.toHaveBeenCalled();
    // Kim turns alerts on: the photos still waiting alert on the next tick, once.
    (deps.listHeadElves as Mock).mockResolvedValue([{ ...QUIET, alertsOn: true }]);
    await tick(at("2026-12-07T18:05:30Z"));
    expect(claimsOf(deps, "photo-alert")).toEqual(["first:2026-12-07"]);
    expect(sentOf(sent, "photo").map((m) => m.to)).toEqual(["kim@example.org"]);
    expect(deps.sendText).toHaveBeenCalledWith({ to: "+447700900124", text: ELF_PHOTO_TEXT, senderId: "NBCC" });
    expect(deps.recordAlert).toHaveBeenCalledWith({ kind: "photo", year: 2026, door: 7, emails: 1, texts: 1, textsFailed: [] });
    expect(deps.markSent).toHaveBeenCalledWith("photo-alert", "first:2026-12-07");
  });

  it("claims and records nothing when there are no head elves at all", async () => {
    const { deps, tick } = waiting({ listHeadElves: vi.fn(async () => []) });
    await tick(SIX_05);
    expect(deps.claimSend).not.toHaveBeenCalledWith("photo-alert", expect.anything());
    expect(deps.recordAlert).not.toHaveBeenCalled();
    expect(deps.markSent).not.toHaveBeenCalled();
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

  // Plan 2c-2, Task 7 (Review Focus 3, ruling F17): a family that has stopped the emails gets no promotion and no
  // graduation. Each moment is claimed and marked sent with no email, so starting the emails again never sends one it
  // missed. The control: the same moment, on the same sweeps, for a family that never stopped them is emailed, ending
  // with the link to its own page for stopping them.
  describe("for a family that has stopped the emails", () => {
    const SIX_DOORS = { cracked: [1, 2, 3, 4, 5, 6], visited: [], snow: [] };
    const LEO = { id: 200, firstName: "Leo", surname: "Frostwhistle", nameApproved: true, badgeNumber: 428, look: null, fresh: [], favourites: [] };
    const ALEX_FAMILY = { id: 4, grownUpName: "Alex Example", email: "alex@example.org", detectives: [LEO], emailsStopped: false, emailsToken: TOKEN_4 };
    /** Family 3 with the emails stopped while `stopped.now` says so, and family 4, which never stopped them. */
    const twoFamilies = (done: { cracked: number[]; visited: number[]; snow: number[] }) => {
      const stopped = { now: true };
      const made = sweeping(new Map(), {
        familiesToSweep: vi.fn(async () => [3, 4]),
        familyWithDetectives: vi.fn(async (id: number) => (id === 3 ? { ...SAM_FAMILY, emailsStopped: stopped.now, emailsToken: TOKEN_3 } : id === 4 ? ALEX_FAMILY : null)),
        familyDoorsDone: vi.fn(async (_year: number, id: number) => new Map([[id === 3 ? 100 : 200, done]])),
      });
      return { ...made, stopped };
    };

    it("claims its promotion and marks it sent with no email, never sends it once the emails start again, and emails it to a family that never stopped them", async () => {
      const { deps, sent, sends, stopped, tick } = twoFamilies(SIX_DOORS);
      await tick(FIVE_31);
      expect(claimsOf(deps, "proud")).toEqual(["2026:rank:100:Junior Detective", "2026:rank:200:Junior Detective"]);
      expect(sends.row("proud", "2026:rank:100:Junior Detective")!.sentAt).not.toBeNull();
      const proud = sentOf(sent, "proud");
      expect(proud.map((m) => [m.to, m.subject])).toEqual([["alex@example.org", "Detective Leo Frostwhistle is now a Junior Detective"]]);
      expect(proud[0].text).toContain(`Stop these emails: ${stopPage(TOKEN_4)}`);
      expect(proud[0].html).toContain(`href="${stopPage(TOKEN_4)}"`);
      // The family starts the emails again. The next sweep, eleven minutes on, when a claim that was never marked
      // could be taken again, sends nothing for the moment it missed.
      stopped.now = false;
      await tick(at("2026-12-07T17:42:00Z"));
      expect(claimsOf(deps, "sweep")).toEqual(["2026:2994441", "2026:2994442"]);
      expect(claimsOf(deps, "proud").filter((k) => k === "2026:rank:100:Junior Detective")).toHaveLength(2);
      expect(sentOf(sent, "proud")).toHaveLength(1);
      expect(sent.map((m) => m.to)).not.toContain("sam@example.org");
    });

    it("claims every new rank and the graduation, each marked sent with no email, while a family that never stopped them hears of the graduation", async () => {
      const ALL = Array.from({ length: 24 }, (_, i) => i + 1);
      const { deps, sent, sends, tick } = twoFamilies({ cracked: [], visited: [], snow: ALL });
      await tick(FIVE_31);
      const sams = ["2026:rank:100:Junior Detective", "2026:rank:100:Detective", "2026:rank:100:Senior Detective", "2026:grad:100"];
      expect(claimsOf(deps, "proud").filter((k) => k.includes(":100"))).toEqual(sams);
      for (const key of sams) expect(sends.row("proud", key)!.sentAt, key).not.toBeNull();
      expect(sentOf(sent, "proud").map((m) => [m.to, m.subject])).toEqual([["alex@example.org", "Detective Leo Frostwhistle has graduated!"]]);
      expect(sentOf(sent, "proud")[0].text).toContain(`Stop these emails: ${stopPage(TOKEN_4)}`);
    });
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
    family: { id: 3, grownUpName: "Sam Example", email: "sam@example.org", emailsStopped: false, emailsToken: TOKEN_3 },
    won: true,
    stamped: [{ id: 100, name: "Detective Ruby Tinselfoot", doorsDone: { cracked: [], visited: [7], snow: [] } }],
    ...over,
  });
  /** Ruby's sixth door, the word at door 7: a promotion to Junior Detective. */
  const SIXTH: WordMoment["stamped"] = [{ id: 100, name: "Detective Ruby Tinselfoot", doorsDone: { cracked: [1, 2, 3], visited: [4, 5, 7], snow: [] } }];

  // Plan 2c-2, Task 7: the won email always goes, and has no link to stop the emails; a promotion ends with one.
  it("ends a promotion with the link to the family's own page for stopping the emails, and the won email with none", async () => {
    const { deps, sent } = fakeDeps();
    await sendProudMoments(moment({ stamped: SIXTH }), deps);
    const [won, promoted] = sentOf(sent, "proud");
    expect([won.subject, promoted.subject]).toEqual(["You found Pip!", "Detective Ruby Tinselfoot is now a Junior Detective"]);
    expect(won.text + won.html).not.toContain("Stop these emails");
    expect(promoted.text).toContain(`Stop these emails: ${stopPage(TOKEN_3)}`);
    expect(promoted.html).toContain(`href="${stopPage(TOKEN_3)}"`);
  });

  it("still sends the won email to a family that has stopped the emails, and claims its promotion with no email", async () => {
    const { deps, sent, sends } = fakeDeps();
    await sendProudMoments(moment({ family: { ...moment().family, emailsStopped: true }, stamped: SIXTH }), deps);
    expect(claimsOf(deps, "proud")).toEqual(["2026:won:3:7", "2026:rank:100:Junior Detective"]);
    expect(sentOf(sent, "proud").map((m) => [m.to, m.subject])).toEqual([["sam@example.org", "You found Pip!"]]);
    expect(sends.row("proud", "2026:won:3:7")!.sentAt).not.toBeNull();
    expect(sends.row("proud", "2026:rank:100:Junior Detective")!.sentAt).not.toBeNull();
  });

  it("sends a promotion from a word with no link when the family has no token to link", async () => {
    const { deps, sent } = fakeDeps();
    await sendProudMoments(moment({ won: false, family: { ...moment().family, emailsToken: null }, stamped: SIXTH }), deps);
    const [promoted] = sentOf(sent, "proud");
    expect(promoted.subject).toBe("Detective Ruby Tinselfoot is now a Junior Detective");
    expect(promoted.text + promoted.html).not.toContain("Stop these emails");
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
