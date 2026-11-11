import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// NBCC Elf Detective School in the admin, Head Elf HQ: the switch, the pay what you can amounts, HQ's
// numbers and the families. Every family here is invented.

const { getUserAuthRowMock, db, dbAdmin, signIn, dbDoors, dbPractice, dbGame, pictureOf, dbAlerts, dbPhotos, sms, mailer, worker } = vi.hoisted(() => ({
  worker: { runElfTick: vi.fn(), realElfDeps: vi.fn() },
  dbPhotos: { countPhotosWaiting: vi.fn() },
  dbAlerts: { listHeadElves: vi.fn(), setMyAlerts: vi.fn(), lastAlert: vi.fn(), recordAlert: vi.fn() },
  sms: { sendText: vi.fn(), on: true },
  mailer: { sendElfTestAlert: vi.fn() },
  getUserAuthRowMock: vi.fn(),
  db: { getElfSettings: vi.fn(), setElfSettings: vi.fn(), setElfPreview: vi.fn() },
  dbAdmin: {
    elfHqNumbers: vi.fn(),
    elfRecruits: vi.fn(),
    listElfFamilies: vi.fn(),
    elfFamilySheet: vi.fn(),
    changeElfDetective: vi.fn(),
    changeElfFamily: vi.fn(),
    removeElfFamily: vi.fn(),
    restoreElfFamily: vi.fn(),
    noteSignInCodeSent: vi.fn(),
  },
  signIn: { sendSignInCodeTo: vi.fn() },
  dbDoors: { ensureElfDoors: vi.fn(), listElfDoors: vi.fn() },
  dbPractice: { startPractice: vi.fn(), getPractice: vi.fn(), clearPractice: vi.fn() },
  dbGame: { onDoorsSwitchedOn: vi.fn(), familyWordTries: vi.fn(), clearWordTries: vi.fn() },
  pictureOf: vi.fn(),
}));
vi.mock("../../src/db/admin-users", () => ({ getUserAuthRow: getUserAuthRowMock }));
vi.mock("../../src/db/elf", () => db);
vi.mock("../../src/db/elf-admin", () => dbAdmin);
vi.mock("../../src/elf/sign-in-code", () => signIn);
vi.mock("../../src/db/elf-doors", () => dbDoors);
vi.mock("../../src/db/elf-practice", () => dbPractice);
vi.mock("../../src/db/elf-game", () => dbGame);
vi.mock("../../src/db/elf-alerts", () => dbAlerts);
vi.mock("../../src/db/elf-photos", () => dbPhotos);
vi.mock("../../src/clients/sms", () => ({ sendText: sms.sendText, get smsConfigured() { return sms.on; } }));
vi.mock("../../src/clients/email", () => mailer);
// The elf worker's tick hook runs the worker's own tick; here it is watched, never run.
vi.mock("../../src/elf/worker", () => worker);
// No door has a picture on disk in a test; one test gives door 1 its picture.
vi.mock("../../src/elf/door-setup", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../src/elf/door-setup")>()), doorPicture: pictureOf }));
vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));
vi.mock("../../src/config", () => ({
  config: {
    NODE_ENV: "development",
    ADMIN_SESSION_SECRET: "test-admin-secret",
    STRIPE_SECRET_KEY: "sk_test_aaaaaaaaaaaaaaaaaaaa",
    STRIPE_WEBHOOK_SECRET: "whsec_x",
    PORTAL_BASE_URL: "https://www.example.org/",
    BALL_FROM_EMAIL: "events@example.org",
    SMS_SENDER_ID: "NBCC",
  },
}));

import {
  deleteAdminElfPractice,
  getAdminElfFamilies,
  getAdminElfFamily,
  getAdminElfHq,
  getAdminElfPractice,
  getAdminElfSettings,
  patchAdminElfDetective,
  patchAdminElfFamily,
  patchAdminElfSettings,
  postAdminElfFamilyRemove,
  postAdminElfFamilyRestore,
  postAdminElfPractice,
  postAdminElfSignInCode,
  postAdminElfWordTriesClear,
  getAdminElfAlerts,
  patchAdminElfAlertsMe,
  postAdminElfAlertsTest,
  postAdminElfWorkerTick,
  resetTestAlertLimit,
} from "../../src/routes/admin-elf";
import { signAdminSession } from "../../src/admin/session";
import { FESTIVE_SURNAMES } from "../../src/elf/names";
import { config } from "../../src/config";

const ON = { schoolOn: true, year: 2026, entryFromPence: 100, entrySuggestedPence: 500 };

// `permissions` is a saved Team matrix: {} means the role's own defaults.
const tokenFor = (role: string, permissions: object = {}) => {
  getUserAuthRowMock.mockResolvedValue({ id: 1, email: "staff@example.org", status: "active", role, permissions });
  return signAdminSession({ sub: 1, email: "staff@example.org", role, now: new Date(), secret: "test-admin-secret" }).token;
};

function mockRes() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    status(c: number) { res.statusCode = c; return res; },
    json(b: unknown) { res.body = b; return res; },
    setHeader(k: string, v: string) { res.headers[k] = v; return res; },
  };
  return res;
}
const req = (role: string | null, body: unknown = {}, permissions: object = {}) => ({ headers: role ? { authorization: `Bearer ${tokenFor(role, permissions)}` } : {}, body, params: {}, query: {} });
/** A head elf: a viewer whom an admin has given the Elf Detective School in the Team matrix. */
const HEAD_ELF = { elf: "view" };
/** A request with its params and query, for the families routes. */
const ask = (role: string, o: { body?: unknown; params?: object; query?: object; permissions?: object } = {}) => ({
  headers: { authorization: `Bearer ${tokenFor(role, o.permissions ?? {})}` },
  body: o.body ?? {},
  params: o.params ?? {},
  query: o.query ?? {},
});
/* eslint-disable @typescript-eslint/no-explicit-any */
const run = async (h: (req: any, res: any) => Promise<unknown>, r: unknown) => {
  const res = mockRes();
  await h(r as any, res as any);
  return res;
};
/* eslint-enable @typescript-eslint/no-explicit-any */

beforeEach(() => {
  getUserAuthRowMock.mockReset();
  for (const f of [...Object.values(db), ...Object.values(dbAdmin), ...Object.values(signIn), ...Object.values(dbDoors), ...Object.values(dbPractice), ...Object.values(dbGame), ...Object.values(dbAlerts), ...Object.values(dbPhotos), sms.sendText, ...Object.values(mailer), ...Object.values(worker)]) f.mockReset();
  sms.on = true;
  pictureOf.mockReset();
  pictureOf.mockReturnValue(null);
  dbGame.familyWordTries.mockResolvedValue([]);
  dbPhotos.countPhotosWaiting.mockResolvedValue(0);
  db.getElfSettings.mockResolvedValue(ON);
  dbDoors.ensureElfDoors.mockResolvedValue(undefined);
  dbDoors.listElfDoors.mockResolvedValue([]);
  db.setElfSettings.mockImplementation(async (patch: object) => ({ ...ON, ...patch }));
});

describe("the school's settings in the admin", () => {
  it("can be read by anyone given the Elf Detective School, but nobody signed out", async () => {
    expect((await run(getAdminElfSettings, req(null))).statusCode).toBe(401);
    const res = await run(getAdminElfSettings, req("viewer", {}, HEAD_ELF));
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ settings: ON });
  });

  it("is not for an editor or a viewer who has not been given the section", async () => {
    expect((await run(getAdminElfSettings, req("editor"))).statusCode).toBe(403);
    expect((await run(getAdminElfSettings, req("viewer"))).statusCode).toBe(403);
    expect((await run(getAdminElfSettings, req("editor", {}, { fundraising: "edit" }))).statusCode).toBe(403);
  });

  it("can only be changed by an admin", async () => {
    expect((await run(patchAdminElfSettings, req("viewer", { schoolOn: true }))).statusCode).toBe(403);
    expect((await run(patchAdminElfSettings, req("editor", { schoolOn: true }))).statusCode).toBe(403);
    const res = await run(patchAdminElfSettings, req("admin", { schoolOn: true }));
    expect(res.statusCode).toBe(200);
    expect(db.setElfSettings).toHaveBeenCalledWith({ schoolOn: true }, "admin:staff@example.org");
  });

  it("takes the phone number printed on the list of places from an admin, or nothing, and refuses words", async () => {
    expect((await run(patchAdminElfSettings, req("editor", { placePhone: "01632 960 123" }))).statusCode).toBe(403);
    const res = await run(patchAdminElfSettings, req("admin", { placePhone: "01632 960 123" }));
    expect(res.statusCode).toBe(200);
    expect(db.setElfSettings).toHaveBeenCalledWith({ placePhone: "01632 960 123" }, "admin:staff@example.org");
    expect((await run(patchAdminElfSettings, req("admin", { placePhone: "" }))).statusCode).toBe(200);
    expect(db.setElfSettings).toHaveBeenLastCalledWith({ placePhone: null }, "admin:staff@example.org");
    expect((await run(patchAdminElfSettings, req("admin", { placePhone: "call me" }))).statusCode).toBe(400);
  });

  it("refuses amounts that do not make sense, in plain words, and saves nothing", async () => {
    for (const body of [{ entryFromPence: 50 }, { entryFromPence: 1100 }, { entrySuggestedPence: 99 }, { entrySuggestedPence: 6000 }, { entryFromPence: 300, entrySuggestedPence: 200 }, { schoolOn: "yes" }]) {
      const res = await run(patchAdminElfSettings, req("admin", body));
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(String((res.body as { error: string }).error)).toMatch(/^[A-Z]/);
    }
    // The suggested amount is checked against the "from" amount already saved, too.
    db.getElfSettings.mockResolvedValue({ ...ON, entryFromPence: 300 });
    expect((await run(patchAdminElfSettings, req("admin", { entrySuggestedPence: 200 }))).statusCode).toBe(400);
    expect(db.setElfSettings).not.toHaveBeenCalled();
  });
});

describe("HQ in the admin", () => {
  const NUMBERS = { families: 2, detectives: 3, namesToCheck: 1, waitingPayments: 0, entryPence: 1500, giftPence: 500, giftAidPence: 500 };
  const RUBY = { detectiveId: 7, familyId: 3, firstName: "Ruby", surname: "Tinselfoot", badgeNumber: 427, approved: false, look: { costume: "reindeer", skin: "s3" } };
  beforeEach(() => {
    dbAdmin.elfHqNumbers.mockResolvedValue(NUMBERS);
    dbAdmin.elfRecruits.mockResolvedValue([RUBY]);
  });

  it("answers with its numbers, quests and newest recruits", async () => {
    // Pinned: every door is still to come, so the doors quest is there whatever today's date is.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-20T12:00:00Z"));
    let res;
    try {
      res = await run(getAdminElfHq, req("admin"));
    } finally {
      vi.useRealTimers();
    }
    expect(res.statusCode).toBe(200);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = res.body as any;
    expect(body.numbers).toEqual(NUMBERS);
    expect(body.quests.map((q: { id: string }) => q.id)).toEqual(["names", "doors"]);
    expect(body.recruits).toEqual([{ detectiveId: 7, familyId: 3, name: "Ruby Tinselfoot", badge: "EDS 0427", approved: false, tile: "/assets/img/elf/paper/tiles/costumes/reindeer-s3.webp" }]);
    expect(body.settings).toMatchObject({ schoolOn: true, previewOn: false });
    expect(body.settings.previewHash).toBeUndefined();
    expect(body.firstClueAt).toBe("2026-12-01T17:30:00.000Z");
    expect(typeof body.daysToFirstClue).toBe("number");
    expect(body.canSwitch).toBe(true);
    expect(dbAdmin.elfRecruits).toHaveBeenCalledWith(8);
  });

  it("says how many photos are waiting for a head elf", async () => {
    dbPhotos.countPhotosWaiting.mockResolvedValue(3);
    const res = await run(getAdminElfHq, req("viewer", {}, HEAD_ELF));
    expect((res.body as { photosWaiting: number }).photosWaiting).toBe(3);
  });

  it("counts the doors still to come that are not ready, from the clock", async () => {
    const { emptyDoor } = await import("../../src/elf/door-setup");
    const all = Array.from({ length: 24 }, (_, i) => emptyDoor((i + 1) as never, `code${i + 1}`));
    dbDoors.listElfDoors.mockResolvedValue(all);
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-11-30T12:00:00Z"));
      let body = (await run(getAdminElfHq, req("admin"))).body as { doorsNotReady: number; quests: { id: string; words: string }[] };
      expect(body.doorsNotReady).toBe(24);
      expect(body.quests.find((q) => q.id === "doors")!.words).toBe("Door 1 is next: 6 to do.");
      vi.setSystemTime(new Date("2026-12-08T12:00:00Z"));
      body = (await run(getAdminElfHq, req("admin"))).body as typeof body;
      expect(body.doorsNotReady).toBe(17);
      expect(body.quests.find((q) => q.id === "doors")!.words).toContain("Door 8 is next");
    } finally {
      vi.useRealTimers();
    }
  });

  it("never writes doors, and counts a door with no row as an empty one", async () => {
    dbDoors.listElfDoors.mockResolvedValue([]);
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-11-30T12:00:00Z"));
      const body = (await run(getAdminElfHq, req("admin"))).body as { doorsNotReady: number; quests: { id: string; words: string }[] };
      expect(body.doorsNotReady).toBe(24);
      expect(body.quests.find((q) => q.id === "doors")!.words).toBe("Door 1 is next: 6 to do.");
      expect(dbDoors.ensureElfDoors).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("still answers when the doors cannot be read", async () => {
    dbDoors.listElfDoors.mockRejectedValue(new Error("no table"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await run(getAdminElfHq, req("admin"));
    expect(res.statusCode).toBe(200);
    const body = res.body as { doorsNotReady: number; numbers: unknown; quests: { id: string }[] };
    expect(body.doorsNotReady).toBe(0);
    expect(body.numbers).toEqual(NUMBERS);
    expect(body.quests.map((q) => q.id)).not.toContain("doors");
    expect(spy.mock.calls[0][0]).toBe("admin elf doors failed:");
    spy.mockRestore();
  });

  it("stops counting a door at exactly its clue 1 time", async () => {
    dbDoors.listElfDoors.mockResolvedValue([]);
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-12-08T17:29:59Z"));
      let body = (await run(getAdminElfHq, req("admin"))).body as { doorsNotReady: number };
      expect(body.doorsNotReady).toBe(17);
      vi.setSystemTime(new Date("2026-12-08T17:30:00Z"));
      body = (await run(getAdminElfHq, req("admin"))).body as typeof body;
      expect(body.doorsNotReady).toBe(16);
    } finally {
      vi.useRealTimers();
    }
  });

  it("lets a head elf look, but only an admin may pull the switch", async () => {
    const res = await run(getAdminElfHq, req("viewer", {}, HEAD_ELF));
    expect(res.statusCode).toBe(200);
    expect((res.body as { canSwitch: boolean }).canSwitch).toBe(false);
  });

  it("tells the screen whether this person may change families, from their access as it is now", async () => {
    const canEdit = async (role: string, permissions: object) => ((await run(getAdminElfHq, req(role, {}, permissions))).body as { canEdit: boolean }).canEdit;
    expect(await canEdit("admin", {})).toBe(true);
    expect(await canEdit("viewer", { elf: "edit" })).toBe(true);
    expect(await canEdit("viewer", HEAD_ELF)).toBe(false);
  });

  it("is not for an editor", async () => {
    expect((await run(getAdminElfHq, req("editor"))).statusCode).toBe(403);
  });

  it("says so in words when the numbers cannot be read", async () => {
    dbAdmin.elfHqNumbers.mockRejectedValue(new Error("down"));
    const res = await run(getAdminElfHq, req("admin"));
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: "Admin is temporarily unavailable" });
  });
});

// Head Elf HQ (5 November 2026): its own section under Content, after the Festive Ball; the old card
// in Get involved > Settings, and its script, are gone.
describe("the Elf Detective School in the admin's menu", () => {
  const html = readFileSync(resolve(__dirname, "../../admin.html"), "utf8");
  const content = html.slice(html.indexOf('id="adminNavContent"'), html.indexOf("</ul>", html.indexOf('id="adminNavContent"')));

  it("is in Content, right after the Festive Ball", () => {
    const views = [...content.matchAll(/data-view="([a-z-]+)"/g)].map((m) => m[1]);
    expect(views.indexOf("elf")).toBe(views.indexOf("ball") + 1);
    expect(content).toContain('data-view="elf">Elf Detective School</button>');
  });

  it("has a section of its own for Head Elf HQ to draw into", () => {
    expect(html).toMatch(/<section class="admin-view" id="view-elf"[^>]*hidden>/);
    expect(html).toContain('<div id="elfHq"></div>');
  });

  it("is no longer a card in Get involved", () => {
    expect(html).not.toContain('id="elfAdmin"');
    expect(html).not.toContain("/assets/js/admin/elf.js");
  });
});

describe("the private preview link", () => {
  it("is made by an admin only, and hands back a link with a long random code", async () => {
    const { postAdminElfPreview } = await import("../../src/routes/admin-elf");
    expect((await run(postAdminElfPreview, req("editor"))).statusCode).toBe(403);
    const res = await run(postAdminElfPreview, req("admin"));
    expect(res.statusCode).toBe(200);
    const url = String((res.body as { url: string }).url);
    expect(url).toMatch(/\/elf\/preview\/[0-9a-f]{64}$/);
  });
});

// ---- Families (Task 5) ----

const PAID_AT = new Date("2026-11-13T19:04:00.000Z");
const FAMILY_ROW = {
  id: 3,
  grownUpName: "Sam Example",
  email: "sam@example.org",
  enrolledAt: PAID_AT,
  removed: false,
  detectives: [{ id: 7, firstName: "Ruby", badgeNumber: 427, approved: false, look: { costume: "reindeer", skin: "s3" } }],
};
const SHEET_ROW = {
  id: 3,
  grownUpName: "Sam Example",
  email: "sam@example.org",
  newsletter: true,
  enrolledAt: PAID_AT,
  removedAt: null,
  removedBy: null,
  detectives: [{ id: 7, firstName: "Ruby", surname: "Tinselfoot", badgeNumber: 427, approved: false, look: null }],
  payments: [{ reference: "EDS-K4F9Q2", status: "paid", paidAt: PAID_AT, entryPence: 1000, giftPence: 500, giftAid: true }],
};

describe("the families in the admin", () => {
  it("lists families for someone with the section, and keeps an editor out", async () => {
    dbAdmin.listElfFamilies.mockResolvedValue({ rows: [FAMILY_ROW], total: 1, counts: { all: 1, check: 1, week: 1, removed: 0 } });
    const res = await run(getAdminElfFamilies, ask("viewer", { permissions: HEAD_ELF, query: { q: " ruby ", filter: "check", offset: "50" } }));
    expect(res.statusCode).toBe(200);
    expect(dbAdmin.listElfFamilies).toHaveBeenCalledWith({ q: "ruby", filter: "check", offset: 50, limit: 50, now: expect.any(Date) });
    expect(res.body).toEqual({
      families: [
        {
          id: 3,
          grownUpName: "Sam Example",
          email: "sam@example.org",
          enrolledAt: PAID_AT.toISOString(),
          removed: false,
          namesToCheck: 1,
          detectives: [{ id: 7, firstName: "Ruby", badge: "EDS 0427", approved: false, tile: "/assets/img/elf/paper/tiles/costumes/reindeer-s3.webp" }],
        },
      ],
      total: 1,
      counts: { all: 1, check: 1, week: 1, removed: 0 },
    });
    expect((await run(getAdminElfFamilies, ask("editor"))).statusCode).toBe(403);
  });

  it("reads a junk filter as all and a junk page as the first", async () => {
    dbAdmin.listElfFamilies.mockResolvedValue({ rows: [], total: 0, counts: { all: 0, check: 0, week: 0, removed: 0 } });
    await run(getAdminElfFamilies, ask("admin", { query: { filter: "everything", offset: "-9" } }));
    expect(dbAdmin.listElfFamilies).toHaveBeenCalledWith(expect.objectContaining({ q: "", filter: "all", offset: 0 }));
  });

  it("opens a family's sheet, and says so when there is no such family", async () => {
    dbAdmin.elfFamilySheet.mockResolvedValue(SHEET_ROW);
    const res = await run(getAdminElfFamily, ask("viewer", { permissions: HEAD_ELF, params: { id: "3" } }));
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      family: {
        id: 3,
        grownUpName: "Sam Example",
        email: "sam@example.org",
        newsletter: true,
        enrolledAt: PAID_AT.toISOString(),
        removedAt: null,
        removedBy: null,
        detectives: [{ id: 7, firstName: "Ruby", surname: "Tinselfoot", badge: "EDS 0427", approved: false, tile: "/assets/img/elf/paper/tiles/costumes/detective-s1.webp" }],
        payments: [{ reference: "EDS-K4F9Q2", status: "paid", paidAt: PAID_AT.toISOString(), entryPence: 1000, giftPence: 500, giftAid: true }],
      },
      wordTries: [],
      // The festive surnames, for the rename form.
      surnames: [...FESTIVE_SURNAMES],
    });
    dbAdmin.elfFamilySheet.mockResolvedValue(null);
    const missing = await run(getAdminElfFamily, ask("admin", { params: { id: "99" } }));
    expect(missing.statusCode).toBe(404);
    expect(missing.body).toEqual({ error: "We could not find that family." });
  });

  it("refuses an id that is not a whole number above 0", async () => {
    for (const id of ["abc", "0", "-3", "3.5", "1e3"]) {
      const res = await run(getAdminElfFamily, ask("admin", { params: { id } }));
      expect(res.statusCode, id).toBe(400);
    }
    expect(dbAdmin.elfFamilySheet).not.toHaveBeenCalled();
  });
});

describe("a head elf changing a family", () => {
  const RUBY = { id: 7, familyId: 3, firstName: "Ruby", surname: "Tinselfoot", badgeNumber: 427, approved: true, look: null };

  it("ticks a detective's name for someone who may edit, and not for someone who may only look", async () => {
    dbAdmin.changeElfDetective.mockResolvedValue(RUBY);
    const res = await run(patchAdminElfDetective, ask("admin", { params: { id: "7" }, body: { approved: true } }));
    expect(res.statusCode).toBe(200);
    expect(dbAdmin.changeElfDetective).toHaveBeenCalledWith(7, { approved: true }, "admin:staff@example.org");
    expect((res.body as { detective: { badge: string; approved: boolean } }).detective).toMatchObject({ id: 7, badge: "EDS 0427", approved: true });
    expect((await run(patchAdminElfDetective, ask("viewer", { permissions: HEAD_ELF, params: { id: "7" }, body: { approved: true } }))).statusCode).toBe(403);
    expect((await run(patchAdminElfDetective, ask("viewer", { permissions: { elf: "edit" }, params: { id: "7" }, body: { approved: true } }))).statusCode).toBe(200);
  });

  it("refuses a name enrolling refuses, and saves nothing", async () => {
    const res = await run(patchAdminElfDetective, ask("admin", { params: { id: "7" }, body: { firstName: "Ruby Mae" } }));
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: "Please give just one first name: the festive surname comes from the list." });
    expect(dbAdmin.changeElfDetective).not.toHaveBeenCalled();
  });

  it("answers 404 for a detective that is not there", async () => {
    dbAdmin.changeElfDetective.mockResolvedValue(null);
    const res = await run(patchAdminElfDetective, ask("admin", { params: { id: "70" }, body: { approved: true } }));
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: "We could not find that detective." });
  });

  it("changes the grown up's details, and says when another family has the email", async () => {
    dbAdmin.changeElfFamily.mockResolvedValue({ ...SHEET_ROW, email: "sam.new@example.org" });
    const res = await run(patchAdminElfFamily, ask("admin", { params: { id: "3" }, body: { email: " Sam.New@Example.org" } }));
    expect(res.statusCode).toBe(200);
    expect(dbAdmin.changeElfFamily).toHaveBeenCalledWith(3, { email: "sam.new@example.org" }, "admin:staff@example.org");
    expect((res.body as { family: { email: string } }).family.email).toBe("sam.new@example.org");
    dbAdmin.changeElfFamily.mockResolvedValue("email-taken");
    const taken = await run(patchAdminElfFamily, ask("admin", { params: { id: "3" }, body: { email: "alex@example.org" } }));
    expect(taken.statusCode).toBe(409);
    expect(taken.body).toEqual({ error: "Another family already uses that email." });
  });

  it("sends a sign in code to the family's own email, and notes who asked", async () => {
    dbAdmin.elfFamilySheet.mockResolvedValue(SHEET_ROW);
    signIn.sendSignInCodeTo.mockResolvedValueOnce(true);
    const res = await run(postAdminElfSignInCode, ask("viewer", { permissions: { elf: "edit" }, params: { id: "3" } }));
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ sent: true, email: "sam@example.org" });
    expect(signIn.sendSignInCodeTo).toHaveBeenCalledWith("sam@example.org");
    expect(dbAdmin.noteSignInCodeSent).toHaveBeenCalledWith(3, "admin:staff@example.org");
  });

  it("says so when the code could not be sent, and notes nothing", async () => {
    dbAdmin.elfFamilySheet.mockResolvedValue(SHEET_ROW);
    signIn.sendSignInCodeTo.mockResolvedValueOnce(false);
    const res = await run(postAdminElfSignInCode, ask("admin", { params: { id: "3" } }));
    expect(res.statusCode).toBe(502);
    expect(res.body).toEqual({ error: "We could not send the code just now. Please try again in a minute." });
    expect(dbAdmin.noteSignInCodeSent).not.toHaveBeenCalled();
  });

  it("will not send a code to a removed family", async () => {
    dbAdmin.elfFamilySheet.mockResolvedValue({ ...SHEET_ROW, removedAt: PAID_AT, removedBy: "admin:boss@example.org" });
    const res = await run(postAdminElfSignInCode, ask("admin", { params: { id: "3" } }));
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: "This family is removed. Put it back first." });
    expect(signIn.sendSignInCodeTo).not.toHaveBeenCalled();
  });

  it("removes a family and puts it back, as the person who did it", async () => {
    dbAdmin.removeElfFamily.mockResolvedValue({ ...SHEET_ROW, removedAt: PAID_AT, removedBy: "admin:staff@example.org" });
    const gone = await run(postAdminElfFamilyRemove, ask("admin", { params: { id: "3" } }));
    expect(gone.statusCode).toBe(200);
    expect(dbAdmin.removeElfFamily).toHaveBeenCalledWith(3, "admin:staff@example.org");
    expect((gone.body as { family: { removedAt: string } }).family.removedAt).toBe(PAID_AT.toISOString());
    dbAdmin.restoreElfFamily.mockResolvedValue(SHEET_ROW);
    const back = await run(postAdminElfFamilyRestore, ask("admin", { params: { id: "3" } }));
    expect(back.statusCode).toBe(200);
    expect(dbAdmin.restoreElfFamily).toHaveBeenCalledWith(3, "admin:staff@example.org");
    dbAdmin.removeElfFamily.mockResolvedValue(null);
    expect((await run(postAdminElfFamilyRemove, ask("admin", { params: { id: "9" } }))).statusCode).toBe(404);
    expect((await run(postAdminElfFamilyRemove, ask("viewer", { permissions: HEAD_ELF, params: { id: "3" } }))).statusCode).toBe(403);
  });
});

// ---- The practice door (wave 2, Task 8): a pretend evening played through the preview link ----

describe("the practice door in the admin", () => {
  const ROW = {
    startedAt: new Date("2026-11-11T15:00:00.000Z"),
    startedBy: "admin:staff@example.org",
    placeName: "The Example Office",
    placeTown: "Snowford",
    elfName: "Tinsel",
    tagWord: "SNOWBALL 472",
    posterCode: "abcdefghjkmn",
    clue1At: new Date("2026-11-11T15:01:00.000Z"),
    clue2At: new Date("2026-11-11T15:04:00.000Z"),
    clue3At: new Date("2026-11-11T15:07:00.000Z"),
    revealAt: new Date("2026-11-11T15:10:00.000Z"),
    foundAt: null,
    foundFamilyId: null,
  };
  // The answer a head elf gets: the times as written, the tag word so they can type it, and the poster
  // page on the site's own address (its trailing slash dropped).
  const RUNNING = {
    placeName: "The Example Office",
    placeTown: "Snowford",
    elfName: "Tinsel",
    tagWord: "SNOWBALL 472",
    clue1At: "2026-11-11T15:01:00.000Z",
    clue2At: "2026-11-11T15:04:00.000Z",
    clue3At: "2026-11-11T15:07:00.000Z",
    revealAt: "2026-11-11T15:10:00.000Z",
    found: false,
    posterUrl: "https://www.example.org/elf/p/abcdefghjkmn",
  };
  const WITH_LINK = { ...ON, previewHash: "a".repeat(64) };
  const NO_LINK = "Make a preview link in Settings first: the practice door is played through it.";
  const GOOD = { placeName: "The Example Office", placeTown: "Snowford" };
  const EDIT = { elf: "edit" };

  it("shows a head elf the practice with its tag word and poster page, and is never cached", async () => {
    dbPractice.getPractice.mockResolvedValue(ROW);
    db.getElfSettings.mockResolvedValue(WITH_LINK);
    const res = await run(getAdminElfPractice, req("viewer", {}, HEAD_ELF));
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ practice: RUNNING, previewOn: true });
    expect(res.headers["Cache-Control"]).toBe("no-store");
  });

  it("says when its elf has been found", async () => {
    dbPractice.getPractice.mockResolvedValue({ ...ROW, foundAt: new Date("2026-11-11T15:02:00.000Z"), foundFamilyId: 3 });
    db.getElfSettings.mockResolvedValue(WITH_LINK);
    const res = await run(getAdminElfPractice, req("admin"));
    expect((res.body as { practice: { found: boolean } }).practice.found).toBe(true);
  });

  it("says when no practice is set, and whether there is a preview link", async () => {
    dbPractice.getPractice.mockResolvedValue(null);
    const res = await run(getAdminElfPractice, req("admin"));
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ practice: null, previewOn: false });
  });

  it("is not for anyone signed out, or an editor who has not been given the section", async () => {
    for (const h of [getAdminElfPractice, postAdminElfPractice, deleteAdminElfPractice]) {
      expect((await run(h, req(null, GOOD))).statusCode).toBe(401);
      expect((await run(h, req("editor", GOOD))).statusCode).toBe(403);
    }
    expect(dbPractice.getPractice).not.toHaveBeenCalled();
    expect(dbPractice.startPractice).not.toHaveBeenCalled();
    expect(dbPractice.clearPractice).not.toHaveBeenCalled();
  });

  it("lets a head elf who may only look see it, but not start or clear it", async () => {
    const start = await run(postAdminElfPractice, req("viewer", GOOD, HEAD_ELF));
    expect(start.statusCode).toBe(403);
    expect(start.headers["Cache-Control"]).toBe("no-store");
    expect((await run(deleteAdminElfPractice, req("viewer", {}, HEAD_ELF))).statusCode).toBe(403);
    expect(dbPractice.startPractice).not.toHaveBeenCalled();
    expect(dbPractice.clearPractice).not.toHaveBeenCalled();
  });

  it("will not start one without a preview link, since the practice door is played through it", async () => {
    db.getElfSettings.mockResolvedValue({ ...ON, previewHash: null });
    const res = await run(postAdminElfPractice, req("admin", GOOD));
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: NO_LINK });
    expect(dbPractice.startPractice).not.toHaveBeenCalled();
  });

  it("starts one with a preview link, for a head elf who may edit, as the person who did it", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-11T15:00:00.000Z"));
    let res;
    try {
      db.getElfSettings.mockResolvedValue(WITH_LINK);
      dbPractice.startPractice.mockResolvedValue(ROW);
      res = await run(postAdminElfPractice, req("viewer", { placeName: "  The Example Office ", placeTown: " Snowford" }, EDIT));
    } finally {
      vi.useRealTimers();
    }
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ practice: RUNNING, previewOn: true });
    expect(res.headers["Cache-Control"]).toBe("no-store");
    // The practice elf and three minutes between clues, unless the head elf says otherwise.
    expect(dbPractice.startPractice).toHaveBeenCalledWith({
      placeName: "The Example Office",
      placeTown: "Snowford",
      elfName: "Tinsel",
      minutesApart: 3,
      startedBy: "admin:staff@example.org",
      now: new Date("2026-11-11T15:00:00.000Z"),
    });
  });

  it("takes the elf's name and the minutes between clues when given, and reads an empty name as the practice elf", async () => {
    db.getElfSettings.mockResolvedValue(WITH_LINK);
    dbPractice.startPractice.mockResolvedValue(ROW);
    await run(postAdminElfPractice, req("admin", { ...GOOD, elfName: " Pip ", minutesApart: 1 }));
    expect(dbPractice.startPractice).toHaveBeenLastCalledWith(expect.objectContaining({ elfName: "Pip", minutesApart: 1 }));
    await run(postAdminElfPractice, req("admin", { ...GOOD, elfName: "   " }));
    expect(dbPractice.startPractice).toHaveBeenLastCalledWith(expect.objectContaining({ elfName: "Tinsel", minutesApart: 3 }));
  });

  it("takes the longest names and both ends of the minutes allowed", async () => {
    db.getElfSettings.mockResolvedValue(WITH_LINK);
    dbPractice.startPractice.mockResolvedValue(ROW);
    for (const body of [
      { placeName: "p".repeat(80), placeTown: "t".repeat(60), elfName: "e".repeat(30), minutesApart: 1 },
      { placeName: "P", placeTown: "T", elfName: "E", minutesApart: 30 },
    ]) {
      expect((await run(postAdminElfPractice, req("admin", body))).statusCode, JSON.stringify(body)).toBe(200);
    }
    expect(dbPractice.startPractice).toHaveBeenCalledTimes(2);
  });

  it("refuses what it cannot use, in plain words, and starts nothing", async () => {
    db.getElfSettings.mockResolvedValue(WITH_LINK);
    const said = async (body: unknown) => {
      const res = await run(postAdminElfPractice, req("admin", body));
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      return (res.body as { error: string }).error;
    };
    expect(await said({ placeTown: "Snowford" })).toBe("Type the name of the pretend place.");
    expect(await said({ placeName: "  ", placeTown: "Snowford" })).toBe("Type the name of the pretend place.");
    expect(await said({ placeName: "p".repeat(81), placeTown: "Snowford" })).toBe("The place name can be up to 80 characters.");
    expect(await said({ placeName: "The Example Office" })).toBe("Type the town the pretend place is in.");
    expect(await said({ placeName: "The Example Office", placeTown: "t".repeat(61) })).toBe("The town can be up to 60 characters.");
    expect(await said({ ...GOOD, elfName: "e".repeat(31) })).toBe("The elf's name can be up to 30 characters.");
    for (const minutesApart of [0, 31, 2.5]) {
      expect(await said({ ...GOOD, minutesApart })).toBe("The minutes between clues must be a whole number from 1 to 30.");
    }
    // Anything else gets the plain sentence, never the checker's own words.
    for (const body of [{ ...GOOD, minutesApart: "3" }, { ...GOOD, minutesApart: null }, { ...GOOD, where: "the kettle" }, { placeName: 7, placeTown: "Snowford" }, "nonsense"]) {
      expect(await said(body)).toBe("That did not look right. Reload the page and try again.");
    }
    expect(dbPractice.startPractice).not.toHaveBeenCalled();
  });

  it("clears the practice as the person who did it, and answers as reading it does", async () => {
    db.getElfSettings.mockResolvedValue(WITH_LINK);
    dbPractice.clearPractice.mockResolvedValue(undefined);
    const res = await run(deleteAdminElfPractice, req("viewer", {}, EDIT));
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ practice: null, previewOn: true });
    expect(res.headers["Cache-Control"]).toBe("no-store");
    expect(dbPractice.clearPractice).toHaveBeenCalledWith("admin:staff@example.org");
  });

  it("says so in words when the practice cannot be read, started or cleared", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      db.getElfSettings.mockResolvedValue(WITH_LINK);
      dbPractice.getPractice.mockRejectedValue(new Error("down"));
      dbPractice.startPractice.mockRejectedValue(new Error("down"));
      dbPractice.clearPractice.mockRejectedValue(new Error("down"));
      for (const [h, body] of [[getAdminElfPractice, {}], [postAdminElfPractice, GOOD], [deleteAdminElfPractice, {}]] as const) {
        const res = await run(h, req("admin", body));
        expect(res.statusCode).toBe(500);
        expect(res.body).toEqual({ error: "Admin is temporarily unavailable" });
      }
      // The log names what failed, never the place or the word.
      for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toMatch(/Example Office|Snowford|SNOWBALL/);
    } finally {
      spy.mockRestore();
    }
  });
});

// ---- December's doors, the doors soon, and wrong tries (wave 2, Task 10) ----

describe("December's doors switch", () => {
  const NOT_READY = "Door 1 is not ready yet, so December's doors cannot be switched on.";
  const NUMBERS_NONE = { families: 0, detectives: 0, namesToCheck: 0, waitingPayments: 0, entryPence: 0, giftPence: 0, giftAidPence: 0 };
  async function readyDoor1() {
    const { emptyDoor } = await import("../../src/elf/door-setup");
    pictureOf.mockImplementation((_year: number, door: number) => (door === 1 ? "door-1.webp" : null));
    return {
      ...emptyDoor(1, "abcdefghjkmn"),
      placeName: "Pine Cone Cafe",
      placeTown: "Exampleton",
      placeAddress: "1 Example Street",
      prize: "A cake",
      elfName: "Pip",
      tagWord: "SNOWBALL 472",
      droppedOffAt: new Date("2026-11-20T10:00:00Z"),
      clues: [1, 2, 3].map((n) => ({ n: n as 1 | 2 | 3, words: "Practice clue", hasPicture: false, pictureAlt: null })),
    };
  }

  it("is refused, with the sentence, when door 1 is not ready, and nothing is saved", async () => {
    const res = await run(patchAdminElfSettings, req("admin", { doorsOn: true }));
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: NOT_READY });
    expect(db.setElfSettings).not.toHaveBeenCalled();
    expect(dbGame.onDoorsSwitchedOn).not.toHaveBeenCalled();
  });

  it("switches on once door 1 is ready, makes the doors for the year, and saves through the settings", async () => {
    dbDoors.listElfDoors.mockResolvedValue([await readyDoor1()]);
    const res = await run(patchAdminElfSettings, req("admin", { doorsOn: true }));
    expect(res.statusCode).toBe(200);
    expect(db.setElfSettings).toHaveBeenCalledWith({ doorsOn: true }, "admin:staff@example.org");
    expect(dbGame.onDoorsSwitchedOn).toHaveBeenCalledTimes(1);
    expect(dbGame.onDoorsSwitchedOn).toHaveBeenCalledWith(2026);
  });

  it("makes the doors before it saves the switch, and saves nothing if making them fails", async () => {
    dbDoors.listElfDoors.mockResolvedValue([await readyDoor1()]);
    const order: string[] = [];
    dbGame.onDoorsSwitchedOn.mockImplementation(async () => {
      order.push("doors");
    });
    db.setElfSettings.mockImplementation(async (patch: object) => {
      order.push("switch");
      return { ...ON, ...patch };
    });
    expect((await run(patchAdminElfSettings, req("admin", { doorsOn: true }))).statusCode).toBe(200);
    expect(order).toEqual(["doors", "switch"]);
    db.setElfSettings.mockClear();
    dbGame.onDoorsSwitchedOn.mockRejectedValue(new Error("no table"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await run(patchAdminElfSettings, req("admin", { doorsOn: true }));
    spy.mockRestore();
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: "Admin is temporarily unavailable" });
    expect(db.setElfSettings).not.toHaveBeenCalled();
  });

  it("switches off without asking about door 1, and without the switch on work", async () => {
    const res = await run(patchAdminElfSettings, req("admin", { doorsOn: false }));
    expect(res.statusCode).toBe(200);
    expect(db.setElfSettings).toHaveBeenCalledWith({ doorsOn: false }, "admin:staff@example.org");
    expect(dbGame.onDoorsSwitchedOn).not.toHaveBeenCalled();
  });

  it("is for admins only: an editor with Elf edit is forbidden", async () => {
    const res = await run(patchAdminElfSettings, req("editor", { doorsOn: true }, { elf: "edit" }));
    expect(res.statusCode).toBe(403);
    expect(db.setElfSettings).not.toHaveBeenCalled();
    expect(dbGame.onDoorsSwitchedOn).not.toHaveBeenCalled();
  });

  it("says in words when door 1 cannot be read", async () => {
    dbDoors.listElfDoors.mockRejectedValue(new Error("no table"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await run(patchAdminElfSettings, req("admin", { doorsOn: true }));
    spy.mockRestore();
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: "Admin is temporarily unavailable" });
    expect(db.setElfSettings).not.toHaveBeenCalled();
  });

  it("is told to HQ, with the doors whose first clue is within three days and that are not ready", async () => {
    db.getElfSettings.mockResolvedValue({ ...ON, doorsOn: true });
    dbAdmin.elfHqNumbers.mockResolvedValue(NUMBERS_NONE);
    dbAdmin.elfRecruits.mockResolvedValue([]);
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-12-07T12:00:00Z")); // door 7's clue 1 is at 5:30pm today
      const body = (await run(getAdminElfHq, req("admin"))).body as { doorsOn: boolean; doorsSoonNotReady: unknown[]; quests: { id: string; title: string; words: string; go: string; button: string }[] };
      expect(body.doorsOn).toBe(true);
      expect(body.doorsSoonNotReady).toEqual([
        { door: 7, day: "Monday", toDo: 6 },
        { door: 8, day: "Tuesday", toDo: 6 },
        { door: 9, day: "Wednesday", toDo: 6 },
      ]);
      expect(body.quests[0]).toMatchObject({ id: "doors-soon", title: "Door 7 is on Monday and is not ready", words: "6 to do.", go: "doors", button: "Open Doors" });
      expect(body.quests.map((q) => q.id)).toEqual(["doors-soon", "doors-soon", "doors-soon", "doors"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("has no doors soon when HQ is looked at long before December", async () => {
    dbAdmin.elfHqNumbers.mockResolvedValue(NUMBERS_NONE);
    dbAdmin.elfRecruits.mockResolvedValue([]);
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-11-20T12:00:00Z"));
      const body = (await run(getAdminElfHq, req("admin"))).body as { doorsOn: boolean; doorsSoonNotReady: unknown[] };
      expect(body.doorsOn).toBe(false);
      expect(body.doorsSoonNotReady).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("a family's wrong tries in the admin", () => {
  const SHEET = {
    id: 42,
    grownUpName: "Sam Example",
    email: "sam@example.org",
    newsletter: false,
    enrolledAt: new Date("2026-11-01T10:00:00Z"),
    removedAt: null,
    removedBy: null,
    detectives: [],
    payments: [],
  };
  const EDIT = { elf: "edit" };
  beforeEach(() => {
    dbAdmin.elfFamilySheet.mockResolvedValue(SHEET);
  });

  it("are on the family's sheet, door by door", async () => {
    dbGame.familyWordTries.mockResolvedValue([{ door: 7, wrong: 6 }, { door: 9, wrong: 0 }]);
    const res = await run(getAdminElfFamily, ask("viewer", { permissions: HEAD_ELF, params: { id: "42" } }));
    expect(res.statusCode).toBe(200);
    // A door whose tries were cleared (wrong back to 0) is not listed.
    expect((res.body as { wordTries: unknown }).wordTries).toEqual([{ door: 7, wrong: 6 }]);
    expect(dbGame.familyWordTries).toHaveBeenCalledWith(2026, 42);
  });

  it("are cleared by a head elf who may edit, as the person who did it", async () => {
    dbGame.clearWordTries.mockResolvedValue(undefined);
    const res = await run(postAdminElfWordTriesClear, ask("viewer", { permissions: EDIT, params: { id: "42" }, body: { door: 7 } }));
    expect(res.statusCode).toBe(200);
    expect(res.headers["Cache-Control"]).toBe("no-store");
    expect(dbGame.clearWordTries).toHaveBeenCalledWith(2026, 7, 42, "admin:staff@example.org");
    expect((res.body as { family: { id: number } }).family.id).toBe(42);
  });

  it("are not cleared by a head elf who may only look", async () => {
    const res = await run(postAdminElfWordTriesClear, ask("viewer", { permissions: HEAD_ELF, params: { id: "42" }, body: { door: 7 } }));
    expect(res.statusCode).toBe(403);
    expect(dbGame.clearWordTries).not.toHaveBeenCalled();
  });

  it("are not cleared for a door that is not one, a family that is not there, or an id that is not a number", async () => {
    for (const door of [0, 25, 1.5, "7", null]) {
      const res = await run(postAdminElfWordTriesClear, ask("viewer", { permissions: EDIT, params: { id: "42" }, body: { door } }));
      expect(res.statusCode, String(door)).toBe(400);
    }
    const bad = await run(postAdminElfWordTriesClear, ask("viewer", { permissions: EDIT, params: { id: "42" }, body: { door: 25 } }));
    expect(bad.body).toEqual({ error: "Choose a door from 1 to 24." });
    expect((await run(postAdminElfWordTriesClear, ask("viewer", { permissions: EDIT, params: { id: "abc" }, body: { door: 7 } }))).statusCode).toBe(400);
    dbAdmin.elfFamilySheet.mockResolvedValue(null);
    expect((await run(postAdminElfWordTriesClear, ask("viewer", { permissions: EDIT, params: { id: "99" }, body: { door: 7 } }))).statusCode).toBe(404);
    expect(dbGame.clearWordTries).not.toHaveBeenCalled();
  });
});

// ---- Settings > Alerts (wave 2, Task 3) ----

describe("the alerts in Settings", () => {
  const ALEX = { userId: 1, name: "Alex Example", email: "staff@example.org", mobile: "+447700900123", alertsOn: true };
  const SAM = { userId: 2, name: "Sam Example", email: "sam@example.org", mobile: null, alertsOn: false };
  const PREVIEW = {
    text: "Elf Detective School: a photo is waiting for a head elf to check. nbcc.scot/admin",
    emailSubject: "A photo is waiting to be checked",
    emailLine: "A family has sent a photo from door 7 of Elf Detective School. Nobody sees it until a head elf approves it.",
  };

  it("lists the head elves, with me true for the one asking", async () => {
    dbAlerts.listHeadElves.mockResolvedValue([ALEX, SAM]);
    dbAlerts.lastAlert.mockResolvedValue({ at: new Date("2026-12-07T18:04:00Z"), textsFailed: ["Sam Example"] });
    const res = await run(getAdminElfAlerts, req("viewer", {}, HEAD_ELF));
    expect(res.statusCode).toBe(200);
    expect(res.headers["Cache-Control"]).toBe("no-store");
    expect(res.body).toEqual({
      people: [{ ...ALEX, me: true }, { ...SAM, me: false }],
      textsOn: true,
      lastAlert: { at: new Date("2026-12-07T18:04:00Z"), textsFailed: ["Sam Example"] },
      preview: PREVIEW,
    });
    expect(dbAlerts.lastAlert).toHaveBeenCalledWith("photo");
  });

  it("is for those given the section, and says so when texts are off", async () => {
    expect((await run(getAdminElfAlerts, req("viewer"))).statusCode).toBe(403);
    expect((await run(getAdminElfAlerts, req(null))).statusCode).toBe(401);
    dbAlerts.listHeadElves.mockResolvedValue([]);
    dbAlerts.lastAlert.mockResolvedValue(null);
    sms.on = false;
    const res = await run(getAdminElfAlerts, req("viewer", {}, HEAD_ELF));
    expect(res.body).toEqual({ people: [], textsOn: false, lastAlert: null, preview: PREVIEW });
  });

  it("answers the preview words from the real builders, so the screen keeps no copy of its own", async () => {
    dbAlerts.listHeadElves.mockResolvedValue([]);
    dbAlerts.lastAlert.mockResolvedValue(null);
    const { ELF_PHOTO_TEXT, buildElfPhotoAlertEmail } = await import("../../src/elf/emails");
    const built = buildElfPhotoAlertEmail({ door: 7, adminUrl: "https://www.example.org/admin" });
    const res = await run(getAdminElfAlerts, req("viewer", {}, HEAD_ELF));
    const preview = (res.body as { preview: { text: string; emailSubject: string; emailLine: string } }).preview;
    expect(preview.text).toBe(ELF_PHOTO_TEXT);
    expect(preview.emailSubject).toBe(built.subject);
    expect(preview.emailLine).toBe(built.text.split("\n")[0]);
    expect(preview.emailLine).toContain("door 7");
  });

  it("answers 500 in words when the database fails", async () => {
    dbAlerts.listHeadElves.mockRejectedValue(new Error("boom"));
    const res = await run(getAdminElfAlerts, req("viewer", {}, HEAD_ELF));
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: "Admin is temporarily unavailable" });
  });

  it("saves only my own mobile and tick, the mobile kept as +44", async () => {
    dbAlerts.setMyAlerts.mockResolvedValue(undefined);
    dbAlerts.listHeadElves.mockResolvedValue([ALEX]);
    dbAlerts.lastAlert.mockResolvedValue(null);
    const res = await run(patchAdminElfAlertsMe, req("viewer", { mobile: "07700 900 123", alertsOn: false }, HEAD_ELF));
    expect(res.statusCode).toBe(200);
    expect(dbAlerts.setMyAlerts).toHaveBeenCalledWith(1, { mobile: "+447700900123", alertsOn: false }, "admin:staff@example.org");
    expect((res.body as { people: unknown[] }).people).toHaveLength(1);
  });

  it("can clear the mobile with an empty box", async () => {
    dbAlerts.setMyAlerts.mockResolvedValue(undefined);
    dbAlerts.listHeadElves.mockResolvedValue([ALEX]);
    dbAlerts.lastAlert.mockResolvedValue(null);
    await run(patchAdminElfAlertsMe, req("viewer", { mobile: "  " }, HEAD_ELF));
    expect(dbAlerts.setMyAlerts).toHaveBeenCalledWith(1, { mobile: null }, "admin:staff@example.org");
  });

  it("refuses a mobile that is not a UK mobile, and anything else in the body", async () => {
    const res = await run(patchAdminElfAlertsMe, req("viewer", { mobile: "call me" }, HEAD_ELF));
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: "That does not look like a UK mobile number." });
    expect((await run(patchAdminElfAlertsMe, req("viewer", { alertsOn: "yes" }, HEAD_ELF))).statusCode).toBe(400);
    expect((await run(patchAdminElfAlertsMe, req("viewer", { userId: 9 }, HEAD_ELF))).statusCode).toBe(400);
    expect(dbAlerts.setMyAlerts).not.toHaveBeenCalled();
    expect((await run(patchAdminElfAlertsMe, req("viewer", { alertsOn: true }))).statusCode).toBe(403);
  });

  describe("the test alert", () => {
    beforeEach(() => {
      resetTestAlertLimit();
      dbAlerts.listHeadElves.mockResolvedValue([ALEX, SAM]);
      dbAlerts.recordAlert.mockResolvedValue(undefined);
      mailer.sendElfTestAlert.mockResolvedValue(undefined);
    });

    it("sends the email and the text to the caller and says so", async () => {
      sms.sendText.mockResolvedValue("sent");
      const res = await run(postAdminElfAlertsTest, req("viewer", {}, HEAD_ELF));
      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ email: true, text: "sent" });
      expect(mailer.sendElfTestAlert).toHaveBeenCalledTimes(1);
      expect(mailer.sendElfTestAlert.mock.calls[0][0]).toBe("Alex Example");
      expect(mailer.sendElfTestAlert.mock.calls[0][1]).toMatchObject({ email: "staff@example.org", from: "events@example.org" });
      expect(sms.sendText).toHaveBeenCalledTimes(1);
      expect(sms.sendText).toHaveBeenCalledWith(expect.objectContaining({ to: "+447700900123", senderId: "NBCC" }));
      expect(dbAlerts.recordAlert).toHaveBeenCalledWith(expect.objectContaining({ kind: "test", emails: 1, texts: 1, textsFailed: [] }));
    });

    it("answers text: failed when the text throws, and the email still went", async () => {
      sms.sendText.mockRejectedValue(new Error("SNS publish responded 400"));
      const res = await run(postAdminElfAlertsTest, req("viewer", {}, HEAD_ELF));
      expect(res.body).toEqual({ email: true, text: "failed" });
      expect(dbAlerts.recordAlert).toHaveBeenCalledWith(expect.objectContaining({ kind: "test", emails: 1, texts: 0, textsFailed: ["Alex Example"] }));
    });

    it("answers text: stubbed outside production", async () => {
      sms.sendText.mockResolvedValue("stubbed");
      expect((await run(postAdminElfAlertsTest, req("viewer", {}, HEAD_ELF))).body).toEqual({ email: true, text: "stubbed" });
    });

    it("answers no-mobile when the caller has none", async () => {
      dbAlerts.listHeadElves.mockResolvedValue([{ ...ALEX, mobile: null }]);
      expect((await run(postAdminElfAlertsTest, req("viewer", {}, HEAD_ELF))).body).toEqual({ email: true, text: "no-mobile" });
      expect(sms.sendText).not.toHaveBeenCalled();
    });

    // The test alert decides whether to try the text exactly as the worker's photo alert does (elfTextsOn):
    // once texts are switched on, and outside production, where the text client sends nothing.
    describe("decides whether texts are on as the photo alert does", () => {
      const inProduction = async (work: () => Promise<void>) => {
        const was = config.NODE_ENV;
        (config as { NODE_ENV: string }).NODE_ENV = "production";
        try {
          await work();
        } finally {
          (config as { NODE_ENV: string }).NODE_ENV = was;
        }
      };

      it("tries the text through the stub outside production, though texts are not switched on", async () => {
        sms.on = false;
        sms.sendText.mockResolvedValue("stubbed");
        expect((await run(postAdminElfAlertsTest, req("viewer", {}, HEAD_ELF))).body).toEqual({ email: true, text: "stubbed" });
        expect(sms.sendText).toHaveBeenCalledWith(expect.objectContaining({ to: "+447700900123" }));
        expect(dbAlerts.recordAlert).toHaveBeenCalledWith(expect.objectContaining({ kind: "test", texts: 1 }));
      });

      it("answers off in production while texts are not switched on, and tries no text", async () => {
        sms.on = false;
        await inProduction(async () => {
          expect((await run(postAdminElfAlertsTest, req("viewer", {}, HEAD_ELF))).body).toEqual({ email: true, text: "off" });
        });
        expect(sms.sendText).not.toHaveBeenCalled();
        expect(mailer.sendElfTestAlert).toHaveBeenCalledTimes(1);
      });

      it("sends the text in production once texts are switched on", async () => {
        sms.on = true;
        sms.sendText.mockResolvedValue("sent");
        await inProduction(async () => {
          expect((await run(postAdminElfAlertsTest, req("viewer", {}, HEAD_ELF))).body).toEqual({ email: true, text: "sent" });
        });
        expect(sms.sendText).toHaveBeenCalledTimes(1);
      });
    });

    it("is for those given the section", async () => {
      expect((await run(postAdminElfAlertsTest, req("viewer"))).statusCode).toBe(403);
    });

    // Each press can be a paid text, to a number nobody has confirmed: one test a minute for each head elf.
    it("allows one test a minute for each head elf, and answers a second press inside the minute with 429 in words", async () => {
      const asHeadElf = (sub: number, email: string) => {
        getUserAuthRowMock.mockResolvedValue({ id: sub, email, status: "active", role: "viewer", permissions: HEAD_ELF });
        const token = signAdminSession({ sub, email, role: "viewer", now: new Date(), secret: "test-admin-secret" }).token;
        return { headers: { authorization: `Bearer ${token}` }, body: {}, params: {}, query: {} };
      };
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        sms.sendText.mockResolvedValue("sent");
        vi.setSystemTime(new Date("2026-12-07T12:00:00Z"));
        expect((await run(postAdminElfAlertsTest, asHeadElf(1, "staff@example.org"))).statusCode).toBe(200);
        vi.setSystemTime(new Date("2026-12-07T12:00:59Z"));
        const again = await run(postAdminElfAlertsTest, asHeadElf(1, "staff@example.org"));
        expect(again.statusCode).toBe(429);
        expect(again.body).toEqual({ error: "You sent a test a moment ago. Try again in a minute." });
        expect(again.headers["Cache-Control"]).toBe("no-store");
        expect(mailer.sendElfTestAlert).toHaveBeenCalledTimes(1);
        expect(sms.sendText).toHaveBeenCalledTimes(1);
        expect(dbAlerts.recordAlert).toHaveBeenCalledTimes(1);
        // Another head elf has a minute of their own.
        const sam = await run(postAdminElfAlertsTest, asHeadElf(2, "sam@example.org"));
        expect(sam.statusCode).toBe(200);
        expect(sam.body).toEqual({ email: true, text: "no-mobile" });
        // A minute after the first press, the first head elf may test again.
        vi.setSystemTime(new Date("2026-12-07T12:01:00Z"));
        expect((await run(postAdminElfAlertsTest, asHeadElf(1, "staff@example.org"))).statusCode).toBe(200);
        expect(mailer.sendElfTestAlert).toHaveBeenCalledTimes(3);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

// ---- the elf worker's tick, for the BDD -----------------------------------------------------------
//
// Outside production a head elf who may change the Elf Detective School can run the worker's tick once, at
// a time they give: it is how the BDD moves the worker to midday, so quiet hours never bite.

describe("the elf worker's tick hook", () => {
  const DEPS = { the: "real outside calls" };
  const AT = "2026-12-07T12:00:00.000Z";
  beforeEach(() => {
    worker.realElfDeps.mockReturnValue(DEPS);
    worker.runElfTick.mockResolvedValue(undefined);
  });

  it("runs one tick at the time it is given, with the real outside calls, never cached", async () => {
    const res = await run(postAdminElfWorkerTick, req("admin", { at: AT }));
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(worker.runElfTick).toHaveBeenCalledTimes(1);
    expect(worker.runElfTick).toHaveBeenCalledWith(new Date(AT), DEPS);
    expect(res.headers["Cache-Control"]).toBe("no-store");
  });

  it("is not there in production, for anyone", async () => {
    const was = config.NODE_ENV;
    (config as { NODE_ENV: string }).NODE_ENV = "production";
    try {
      const res = await run(postAdminElfWorkerTick, req("admin", { at: AT }));
      expect(res.statusCode).toBe(404);
      expect(worker.runElfTick).not.toHaveBeenCalled();
    } finally {
      (config as { NODE_ENV: string }).NODE_ENV = was;
    }
  });

  it("is only for those who may change the Elf Detective School", async () => {
    expect((await run(postAdminElfWorkerTick, req(null, { at: AT }))).statusCode).toBe(401);
    expect((await run(postAdminElfWorkerTick, req("viewer", { at: AT }, HEAD_ELF))).statusCode).toBe(403);
    expect(worker.runElfTick).not.toHaveBeenCalled();
    expect((await run(postAdminElfWorkerTick, req("viewer", { at: AT }, { elf: "edit" }))).statusCode).toBe(200);
  });

  it("needs a real moment, and nothing else", async () => {
    for (const body of [{}, { at: "tomorrow" }, { at: 1796664660000 }, { at: AT, door: 7 }]) {
      const res = await run(postAdminElfWorkerTick, req("admin", body));
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
    }
    expect(worker.runElfTick).not.toHaveBeenCalled();
  });

  it("answers 500 when the tick fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    worker.runElfTick.mockRejectedValue(new Error("the tick failed"));
    const res = await run(postAdminElfWorkerTick, req("admin", { at: AT }));
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: "Admin is temporarily unavailable" });
    vi.mocked(console.error).mockRestore();
  });
});
