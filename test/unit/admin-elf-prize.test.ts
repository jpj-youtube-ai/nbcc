import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// NBCC Elf Detective School in the admin, Head Elf HQ's side of the grand prize (Plan 2c-2): Settings > The
// grand prize, when the entries close on Christmas Eve and the graduates' video; and the Grand prize part,
// every picture sent in and the one winner. Every name, number and link here is invented.

const { getUserAuthRowMock, game, settingsDb, prizeDb } = vi.hoisted(() => ({
  getUserAuthRowMock: vi.fn(),
  game: { loadDoorRun: vi.fn() },
  settingsDb: { getElfSettings: vi.fn(), setElfSettings: vi.fn() },
  prizeDb: { listEntries: vi.fn(), staffEntryPicture: vi.fn(), markWinner: vi.fn() },
}));
vi.mock("../../src/db/admin-users", () => ({ getUserAuthRow: getUserAuthRowMock }));
vi.mock("../../src/db/elf-game", async (orig) => ({ ...(await orig<object>()), ...game }));
vi.mock("../../src/db/elf", () => settingsDb);
// The store's reads and its marking are watched; its WinnerTaken stays the real one, so the route can know it.
vi.mock("../../src/db/elf-grand-prize", async (orig) => ({ ...(await orig<object>()), ...prizeDb }));
vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));
vi.mock("../../src/config", () => ({
  config: {
    NODE_ENV: "development",
    ADMIN_SESSION_SECRET: "test-admin-secret",
    STRIPE_SECRET_KEY: "sk_test_aaaaaaaaaaaaaaaaaaaa",
    STRIPE_WEBHOOK_SECRET: "whsec_x",
    PORTAL_BASE_URL: "https://example.org/",
  },
}));

import * as routes from "../../src/routes/admin-elf-prize";
import { signAdminSession } from "../../src/admin/session";
import { runOf } from "../../src/db/elf-game";
import { WinnerTaken } from "../../src/db/elf-grand-prize";
import { emptyDoor, type DoorSetup } from "../../src/elf/door-setup";

const ACTOR = "admin:staff@example.org";
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
    send(b: unknown) { res.body = b; return res; },
    setHeader(k: string, v: string) { res.headers[k] = v; return res; },
  };
  return res;
}
const ask = (role: string, o: { body?: unknown; permissions?: object; params?: object } = {}) => ({
  headers: { authorization: `Bearer ${tokenFor(role, o.permissions ?? {})}` },
  body: o.body ?? {},
  params: o.params ?? {},
  query: {},
});
const VIEW = { elf: "view" };
const EDIT = { elf: "edit" };
/* eslint-disable @typescript-eslint/no-explicit-any */
type Handler = (req: any, res: any) => Promise<unknown>;
const run = async (h: Handler, r: unknown) => {
  const res = mockRes();
  await h(r as any, res as any);
  return res;
};
const body = (res: { body: unknown }) => res.body as any;
/* eslint-enable @typescript-eslint/no-explicit-any */

const NOW = new Date("2026-12-01T12:00:00Z"); // noon in London on Tuesday 1 December: December has no clock change
const ON = {
  schoolOn: true,
  year: 2026,
  entryFromPence: 100,
  entrySuggestedPence: 500,
  previewHash: null,
  placePhone: null,
  doorsOn: false,
  grandPrizeClosesAt: null as Date | null,
  graduateVideoUrl: null as string | null,
};
/** Door 24 as it runs: a morning door, its place shown at 11:30am, closing at 4pm unless a time is typed. */
const door24 = (over: Partial<DoorSetup> = {}) =>
  runOf(2026, { ...emptyDoor(24, "abcdefghijkx"), placeName: "Corner Bakehouse", placeTown: "Snowford", ...over }, NOW);

const TIME_WORDS = "Type a time like 17:00.";
const VIDEO_WORDS = "The video link must start with https:// and be no longer than 300 letters.";
const FOUR_PM_REFUSAL = "Door 24's hiding place closes at 4pm, so grand prize entries can close at 5pm at the earliest.";
const FIVE_PM_WARNING = "Grand prize entries close at 5pm, so door 24's place must close by 4pm.";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  getUserAuthRowMock.mockReset();
  for (const f of [...Object.values(game), ...Object.values(settingsDb), ...Object.values(prizeDb)]) f.mockReset();
  settingsDb.getElfSettings.mockResolvedValue(ON);
  settingsDb.setElfSettings.mockImplementation(async (patch: object) => ({ ...ON, ...patch }));
  game.loadDoorRun.mockResolvedValue(door24());
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const get = (permissions: object = VIEW) => run(routes.getAdminElfPrizeSettings, ask("viewer", { permissions }));
const put = (b: unknown, permissions: object = EDIT) => run(routes.putAdminElfPrizeSettings, ask("viewer", { permissions, body: b }));

describe("reading when the entries close", () => {
  // Ruling F3: door 24 closes at 4pm when no time is typed, so the default 5pm fits and nothing warns.
  it("answers 5pm on Christmas Eve, the default, with no warning, when nothing is stored and door 24 has no closing time", async () => {
    const res = await get();
    expect(res.statusCode).toBe(200);
    expect(res.headers["Cache-Control"]).toBe("no-store");
    expect(body(res)).toEqual({ closesAt: "2026-12-24T17:00:00.000Z", time: "17:00", isDefault: true, warning: null, videoUrl: null, canEdit: false });
    expect(game.loadDoorRun).toHaveBeenCalledWith(2026, 24, NOW);
  });

  it("says whether the caller may change it", async () => {
    expect(body(await get(EDIT)).canEdit).toBe(true);
  });

  it("warns when door 24's place closes later than an hour before the entries close", async () => {
    game.loadDoorRun.mockResolvedValue(door24({ closesAt: "16:30:00" }));
    const b = body(await get());
    expect(b.warning).toBe(FIVE_PM_WARNING);
    expect(b.time).toBe("17:00");
  });

  it("answers a time a head elf saved, and the video link", async () => {
    settingsDb.getElfSettings.mockResolvedValue({ ...ON, grandPrizeClosesAt: new Date("2026-12-24T17:30:00.000Z"), graduateVideoUrl: "https://example.org/graduates" });
    game.loadDoorRun.mockResolvedValue(door24({ closesAt: "16:30:00" }));
    expect(body(await get())).toEqual({
      closesAt: "2026-12-24T17:30:00.000Z",
      time: "17:30",
      isDefault: false,
      warning: null,
      videoUrl: "https://example.org/graduates",
      canEdit: false,
    });
  });

  // Ruling F7: a moment saved for last year reads as this year's 5pm.
  it("reads a closing saved for an earlier year as the default", async () => {
    settingsDb.getElfSettings.mockResolvedValue({ ...ON, grandPrizeClosesAt: new Date("2025-12-24T17:30:00.000Z") });
    const b = body(await get());
    expect(b).toMatchObject({ closesAt: "2026-12-24T17:00:00.000Z", time: "17:00", isDefault: true });
  });

  it("is for the elf section only, and 401 signed out", async () => {
    expect((await run(routes.getAdminElfPrizeSettings, ask("viewer"))).statusCode).toBe(403);
    expect((await run(routes.getAdminElfPrizeSettings, { headers: {}, body: {}, params: {}, query: {} })).statusCode).toBe(401);
    expect(game.loadDoorRun).not.toHaveBeenCalled();
  });

  it("answers 500 in words when the database fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    game.loadDoorRun.mockRejectedValue(new Error("boom"));
    const res = await get();
    expect(res.statusCode).toBe(500);
    expect(body(res)).toEqual({ error: "Admin is temporarily unavailable" });
  });
});

describe("changing when the entries close", () => {
  it("is 403 for a head elf who may only look, and saves nothing", async () => {
    const res = await put({ time: "17:30" }, VIEW);
    expect(res.statusCode).toBe(403);
    expect(settingsDb.setElfSettings).not.toHaveBeenCalled();
  });

  it("refuses 4:30pm while door 24's place closes at 4pm, with the sentence, and saves nothing", async () => {
    game.loadDoorRun.mockResolvedValue(door24({ closesAt: "16:00:00" }));
    const res = await put({ time: "16:30" });
    expect(res.statusCode).toBe(409);
    expect(res.headers["Cache-Control"]).toBe("no-store");
    expect(body(res)).toEqual({ error: FOUR_PM_REFUSAL });
    expect(settingsDb.setElfSettings).not.toHaveBeenCalled();
  });

  // Ruling F3: with no closing time typed door 24 closes at 4pm, so the same sentence refuses 4:30pm.
  it("refuses 4:30pm while door 24 has no closing time, as it closes at 4pm", async () => {
    const res = await put({ time: "16:30" });
    expect(res.statusCode).toBe(409);
    expect(body(res)).toEqual({ error: FOUR_PM_REFUSAL });
    expect(settingsDb.setElfSettings).not.toHaveBeenCalled();
  });

  it("saves 5pm while door 24 has no closing time", async () => {
    const res = await put({ time: "17:00" });
    expect(res.statusCode).toBe(200);
    expect(settingsDb.setElfSettings).toHaveBeenCalledWith({ grandPrizeClosesAt: new Date("2026-12-24T17:00:00.000Z") }, ACTOR);
  });

  it("saves 5:30pm on Christmas Eve as the caller, and answers as the read does", async () => {
    game.loadDoorRun.mockResolvedValue(door24({ closesAt: "16:00:00" }));
    const res = await put({ time: "17:30" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["Cache-Control"]).toBe("no-store");
    expect(settingsDb.setElfSettings).toHaveBeenCalledTimes(1);
    expect(settingsDb.setElfSettings).toHaveBeenCalledWith({ grandPrizeClosesAt: new Date("2026-12-24T17:30:00.000Z") }, ACTOR);
    expect(body(res)).toEqual({ closesAt: "2026-12-24T17:30:00.000Z", time: "17:30", isDefault: false, warning: null, videoUrl: null, canEdit: true });
  });

  it.each([["5pm"], [""], ["24:00"], ["17.30"], ["7:30"], [1730], [null], [true]])("refuses the time %j with the sentence", async (time) => {
    const res = await put({ time });
    expect(res.statusCode).toBe(400);
    expect(body(res)).toEqual({ error: TIME_WORDS });
    expect(settingsDb.setElfSettings).not.toHaveBeenCalled();
    expect(game.loadDoorRun).not.toHaveBeenCalled();
  });

  it("refuses anything else in the body, and saves nothing", async () => {
    const res = await put({ time: "17:30", year: 2027 });
    expect(res.statusCode).toBe(400);
    expect(body(res)).toEqual({ error: "That did not look right. Reload the page and try again." });
    expect(settingsDb.setElfSettings).not.toHaveBeenCalled();
  });

  it("saves nothing and answers as the read does when nothing is sent", async () => {
    const res = await put({});
    expect(res.statusCode).toBe(200);
    expect(settingsDb.setElfSettings).not.toHaveBeenCalled();
    expect(body(res)).toMatchObject({ time: "17:00", isDefault: true, warning: null, canEdit: true });
  });

  it("answers 500 in words when the save fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    settingsDb.setElfSettings.mockRejectedValue(new Error("boom"));
    const res = await put({ time: "17:30" });
    expect(res.statusCode).toBe(500);
    expect(body(res)).toEqual({ error: "Admin is temporarily unavailable" });
  });
});

describe("the graduates' video", () => {
  it("saves an https link", async () => {
    const res = await put({ videoUrl: "https://example.org/graduates" });
    expect(res.statusCode).toBe(200);
    expect(settingsDb.setElfSettings).toHaveBeenCalledWith({ graduateVideoUrl: "https://example.org/graduates" }, ACTOR);
    expect(body(res).videoUrl).toBe("https://example.org/graduates");
  });

  // Ruling F6: saving the link never touches the closing time, and only a time sent is checked against door 24.
  it("saves the link alone, without the closing time, even while door 24 would refuse 5pm", async () => {
    game.loadDoorRun.mockResolvedValue(door24({ closesAt: "16:30:00" }));
    const res = await put({ videoUrl: "https://example.org/graduates" });
    expect(res.statusCode).toBe(200);
    const [patch, actor] = settingsDb.setElfSettings.mock.calls[0];
    expect(patch).toEqual({ graduateVideoUrl: "https://example.org/graduates" });
    expect(patch).not.toHaveProperty("grandPrizeClosesAt");
    expect(actor).toBe(ACTOR);
    expect(body(res).warning).toBe(FIVE_PM_WARNING);
  });

  it("saves the time and the link together when both are sent", async () => {
    const res = await put({ time: "17:30", videoUrl: "https://example.org/graduates" });
    expect(res.statusCode).toBe(200);
    expect(settingsDb.setElfSettings).toHaveBeenCalledWith(
      { grandPrizeClosesAt: new Date("2026-12-24T17:30:00.000Z"), graduateVideoUrl: "https://example.org/graduates" },
      ACTOR,
    );
  });

  it("saves an empty link, or none, as no video", async () => {
    settingsDb.getElfSettings.mockResolvedValue({ ...ON, graduateVideoUrl: "https://example.org/graduates" });
    for (const videoUrl of ["", "   ", null]) {
      settingsDb.setElfSettings.mockClear();
      const res = await put({ videoUrl });
      expect(res.statusCode, JSON.stringify(videoUrl)).toBe(200);
      expect(settingsDb.setElfSettings).toHaveBeenCalledWith({ graduateVideoUrl: null }, ACTOR);
      expect(body(res).videoUrl).toBeNull();
    }
  });

  it("takes a link of 300 letters, the most the database keeps", async () => {
    const longest = "https://example.org/" + "g".repeat(280);
    expect(longest).toHaveLength(300);
    const res = await put({ videoUrl: longest });
    expect(res.statusCode).toBe(200);
    expect(settingsDb.setElfSettings).toHaveBeenCalledWith({ graduateVideoUrl: longest }, ACTOR);
  });

  it.each([
    ["http://example.org/v"],
    ["example.org/graduates"],
    ["HTTPS://example.org/graduates"],
    ["https://example.org/" + "g".repeat(281)],
    [5],
    // Links that start right but go nowhere: a link a browser cannot read, a host with no dot, a space or a
    // control character inside (Task 4's review, Minor 1).
    ["https://"],
    ["https://exa mple.org/v"],
    ["https:///graduates"],
    ["https://example.org/a\tb"],
    ["https://example.org/a\u0000b"],
  ])(
    "refuses the link %j with the sentence, and saves nothing",
    async (videoUrl) => {
      const res = await put({ videoUrl });
      expect(res.statusCode).toBe(400);
      expect(body(res)).toEqual({ error: VIDEO_WORDS });
      expect(settingsDb.setElfSettings).not.toHaveBeenCalled();
    },
  );

  it("saves nothing when the time is refused, even with a good link", async () => {
    const res = await put({ time: "16:30", videoUrl: "https://example.org/graduates" });
    expect(res.statusCode).toBe(409);
    expect(settingsDb.setElfSettings).not.toHaveBeenCalled();
  });
});

// Task 4's review, Minor 2: planner's call 6 marks a winner only once the entries have closed, so a picture
// never changes under the judge. A later time saved after the close would open them again.
describe("once the entries have closed", () => {
  const CLOSED = "The entries have closed, so their closing time cannot change.";

  it("refuses a new closing time from the moment they close, and saves nothing", async () => {
    for (const at of ["2026-12-24T17:00:00Z", "2026-12-24T18:30:00Z", "2026-12-27T09:00:00Z"]) {
      vi.setSystemTime(new Date(at));
      settingsDb.setElfSettings.mockClear();
      const res = await put({ time: "17:30" });
      expect(res.statusCode, at).toBe(409);
      expect(res.headers["Cache-Control"]).toBe("no-store");
      expect(body(res)).toEqual({ error: CLOSED });
      expect(settingsDb.setElfSettings).not.toHaveBeenCalled();
    }
  });

  it("still takes a new time a second before they close", async () => {
    vi.setSystemTime(new Date("2026-12-24T16:59:59Z"));
    const res = await put({ time: "17:30" });
    expect(res.statusCode).toBe(200);
    expect(settingsDb.setElfSettings).toHaveBeenCalledWith({ grandPrizeClosesAt: new Date("2026-12-24T17:30:00.000Z") }, ACTOR);
  });

  it("goes by the closing a head elf saved", async () => {
    settingsDb.getElfSettings.mockResolvedValue({ ...ON, grandPrizeClosesAt: new Date("2026-12-24T17:30:00.000Z") });
    vi.setSystemTime(new Date("2026-12-24T17:15:00Z"));
    expect((await put({ time: "18:00" })).statusCode).toBe(200);
    vi.setSystemTime(new Date("2026-12-24T17:30:00Z"));
    const res = await put({ time: "18:00" });
    expect(res.statusCode).toBe(409);
    expect(body(res)).toEqual({ error: CLOSED });
  });

  it("still saves the video link alone, but nothing when a time comes with it", async () => {
    vi.setSystemTime(new Date("2026-12-24T18:30:00Z"));
    const res = await put({ videoUrl: "https://example.org/graduates" });
    expect(res.statusCode).toBe(200);
    expect(settingsDb.setElfSettings).toHaveBeenCalledWith({ graduateVideoUrl: "https://example.org/graduates" }, ACTOR);
    settingsDb.setElfSettings.mockClear();
    const both = await put({ time: "18:00", videoUrl: "https://example.org/graduates" });
    expect(both.statusCode).toBe(409);
    expect(settingsDb.setElfSettings).not.toHaveBeenCalled();
  });
});

// ---- the Grand prize part: every picture sent in, and the one winner (Task 5) ----

/** Two entries as the store lists them, oldest first: Ruby's family has a mobile, Leo's has none. */
const RUBY = { id: 12, detective: "Ruby Tinselfoot", grownUpName: "Alex Example", mobile: "+447700900123", sentAt: new Date("2026-12-24T10:45:00.000Z"), winner: false };
const LEO = { id: 13, detective: "Leo Frostwhistle", grownUpName: "Sam Example", mobile: null, sentAt: new Date("2026-12-24T15:12:00.000Z"), winner: false };
/** The same two as the routes answer them, with the times as ISO. */
const RUBY_SENT = { ...RUBY, sentAt: "2026-12-24T10:45:00.000Z" };
const LEO_SENT = { ...LEO, sentAt: "2026-12-24T15:12:00.000Z" };
const NOT_THERE = { error: "That picture is not there." };
const STILL_OPEN = { error: "The entries are still open, so the winner can be marked once they close." };
const WINNER_TAKEN = { error: "Someone has just marked a winner. Reload to see it." };
/** 4pm, 5pm and 6pm on Christmas Eve 2026 in London (GMT in December, so UTC). */
const FOUR_PM = new Date("2026-12-24T16:00:00.000Z");
const FIVE_PM = new Date("2026-12-24T17:00:00.000Z");
const SIX_PM = new Date("2026-12-24T18:00:00.000Z");

const entriesOf = (permissions: object = VIEW) => run(routes.getAdminElfGrandPrize, ask("viewer", { permissions }));
const pictureOf = (id: unknown, permissions: object = VIEW) => run(routes.getAdminElfGrandPrizePicture, ask("viewer", { permissions, params: { id } }));
const markAs = (id: unknown, permissions: object = EDIT) => run(routes.postAdminElfGrandPrizeWinner, ask("viewer", { permissions, params: { id } }));

describe("the grand prize entries", () => {
  beforeEach(() => {
    prizeDb.listEntries.mockResolvedValue([RUBY, LEO]);
  });

  it("lists every entry for a head elf who may look, oldest first, still open at 4pm on Christmas Eve", async () => {
    vi.setSystemTime(FOUR_PM);
    const res = await entriesOf();
    expect(res.statusCode).toBe(200);
    expect(body(res)).toEqual({ closesAt: "2026-12-24T17:00:00.000Z", closed: false, entries: [RUBY_SENT, LEO_SENT], canEdit: false });
    expect(prizeDb.listEntries).toHaveBeenCalledWith(2026);
  });

  it("says the entries have closed from 5pm", async () => {
    vi.setSystemTime(FIVE_PM);
    expect(body(await entriesOf())).toMatchObject({ closesAt: "2026-12-24T17:00:00.000Z", closed: true });
  });

  it("goes by the closing a head elf saved", async () => {
    settingsDb.getElfSettings.mockResolvedValue({ ...ON, grandPrizeClosesAt: new Date("2026-12-24T17:30:00.000Z") });
    vi.setSystemTime(new Date("2026-12-24T17:15:00.000Z"));
    expect(body(await entriesOf())).toMatchObject({ closesAt: "2026-12-24T17:30:00.000Z", closed: false });
    vi.setSystemTime(new Date("2026-12-24T17:30:00.000Z"));
    expect(body(await entriesOf())).toMatchObject({ closed: true });
  });

  it("says whether the caller may mark the winner", async () => {
    expect(body(await entriesOf(EDIT)).canEdit).toBe(true);
  });

  it("answers no entries as an empty list", async () => {
    prizeDb.listEntries.mockResolvedValue([]);
    expect(body(await entriesOf()).entries).toEqual([]);
  });

  // The answer carries a family's mobile: no cache, shared or private, keeps it.
  it("is kept by no cache", async () => {
    expect((await entriesOf()).headers["Cache-Control"]).toBe("private, no-store");
  });

  it("is for the elf section only, and 401 signed out", async () => {
    expect((await run(routes.getAdminElfGrandPrize, ask("viewer"))).statusCode).toBe(403);
    expect((await run(routes.getAdminElfGrandPrize, { headers: {}, body: {}, params: {}, query: {} })).statusCode).toBe(401);
    expect(prizeDb.listEntries).not.toHaveBeenCalled();
  });

  it("answers 500 in words when the entries cannot be read, never with an entry", async () => {
    const said = vi.spyOn(console, "error").mockImplementation(() => undefined);
    prizeDb.listEntries.mockRejectedValue(new Error("boom"));
    const res = await entriesOf();
    expect(res.statusCode).toBe(500);
    expect(body(res)).toEqual({ error: "Admin is temporarily unavailable" });
    expect(said).toHaveBeenCalledWith("admin elf grand prize entries failed:", "boom");
  });
});

describe("an entry's picture", () => {
  const BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

  it("answers its bytes to a head elf who may look, kept by no cache, never sniffed and never indexed", async () => {
    prizeDb.staffEntryPicture.mockResolvedValue({ mime: "image/jpeg", bytes: BYTES });
    const res = await pictureOf("12");
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(BYTES);
    expect(res.headers["Content-Type"]).toBe("image/jpeg");
    expect(res.headers["Cache-Control"]).toBe("private, no-store");
    expect(res.headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(res.headers["X-Robots-Tag"]).toBe("noindex, nofollow");
    expect(prizeDb.staffEntryPicture).toHaveBeenCalledWith(2026, 12);
  });

  it("is 404 in words for an entry that is not there", async () => {
    prizeDb.staffEntryPicture.mockResolvedValue(null);
    const res = await pictureOf("99");
    expect(res.statusCode).toBe(404);
    expect(body(res)).toEqual(NOT_THERE);
    expect(res.headers["Cache-Control"]).toBe("no-store");
  });

  it.each([["abc"], ["0"], ["12.5"], ["-3"], ["12345678901"]])("refuses the id %j without reading", async (id) => {
    const res = await pictureOf(id);
    expect(res.statusCode).toBe(400);
    expect(body(res)).toEqual({ error: "That did not look right. Reload the page and try again." });
    expect(prizeDb.staffEntryPicture).not.toHaveBeenCalled();
  });

  it("is for the elf section only", async () => {
    expect((await pictureOf("12", {})).statusCode).toBe(403);
    expect(prizeDb.staffEntryPicture).not.toHaveBeenCalled();
  });

  it("answers 500 in words when the picture cannot be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    prizeDb.staffEntryPicture.mockRejectedValue(new Error("boom"));
    const res = await pictureOf("12");
    expect(res.statusCode).toBe(500);
    expect(body(res)).toEqual({ error: "Admin is temporarily unavailable" });
  });
});

describe("marking the winner", () => {
  beforeEach(() => {
    prizeDb.markWinner.mockResolvedValue(true);
    prizeDb.listEntries.mockResolvedValue([RUBY, { ...LEO, winner: true }]);
  });

  // Planner's call 6: a picture never changes under the judge.
  it("is 409 in words while the entries are open, and marks nothing", async () => {
    vi.setSystemTime(FOUR_PM);
    const res = await markAs("13");
    expect(res.statusCode).toBe(409);
    expect(res.headers["Cache-Control"]).toBe("no-store");
    expect(body(res)).toEqual(STILL_OPEN);
    expect(prizeDb.markWinner).not.toHaveBeenCalled();
  });

  it("is still 409 a second before they close", async () => {
    vi.setSystemTime(new Date("2026-12-24T16:59:59.000Z"));
    expect((await markAs("13")).statusCode).toBe(409);
    expect(prizeDb.markWinner).not.toHaveBeenCalled();
  });

  it("marks the entry as the caller once they have closed, and answers as the read does", async () => {
    vi.setSystemTime(SIX_PM);
    const res = await markAs("13");
    expect(res.statusCode).toBe(200);
    expect(prizeDb.markWinner).toHaveBeenCalledTimes(1);
    expect(prizeDb.markWinner).toHaveBeenCalledWith(2026, 13, ACTOR);
    expect(body(res)).toEqual({ closesAt: "2026-12-24T17:00:00.000Z", closed: true, entries: [RUBY_SENT, { ...LEO_SENT, winner: true }], canEdit: true });
    expect(res.headers["Cache-Control"]).toBe("private, no-store");
  });

  it("marks from the very moment they close", async () => {
    vi.setSystemTime(FIVE_PM);
    expect((await markAs("12")).statusCode).toBe(200);
    expect(prizeDb.markWinner).toHaveBeenCalledWith(2026, 12, ACTOR);
  });

  it("goes by the closing a head elf saved", async () => {
    settingsDb.getElfSettings.mockResolvedValue({ ...ON, grandPrizeClosesAt: new Date("2026-12-24T17:30:00.000Z") });
    vi.setSystemTime(new Date("2026-12-24T17:15:00.000Z"));
    expect(body(await markAs("12"))).toEqual(STILL_OPEN);
    vi.setSystemTime(new Date("2026-12-24T17:30:00.000Z"));
    expect((await markAs("12")).statusCode).toBe(200);
  });

  it("is 404 in words when the store finds no such entry this year", async () => {
    vi.setSystemTime(SIX_PM);
    prizeDb.markWinner.mockResolvedValue(false);
    const res = await markAs("99");
    expect(res.statusCode).toBe(404);
    expect(body(res)).toEqual(NOT_THERE);
    expect(prizeDb.listEntries).not.toHaveBeenCalled();
  });

  // Task 2's report: the one winner index can still refuse a marking made at the same moment as another.
  it("is 409 in words, never 500, when another head elf marks a winner at the same moment", async () => {
    vi.setSystemTime(SIX_PM);
    const said = vi.spyOn(console, "error").mockImplementation(() => undefined);
    prizeDb.markWinner.mockRejectedValue(new WinnerTaken());
    const res = await markAs("12");
    expect(res.statusCode).toBe(409);
    expect(res.headers["Cache-Control"]).toBe("no-store");
    expect(body(res)).toEqual(WINNER_TAKEN);
    expect(said).not.toHaveBeenCalled();
  });

  it("is 403 for a head elf who may only look, and marks nothing", async () => {
    vi.setSystemTime(SIX_PM);
    const res = await markAs("12", VIEW);
    expect(res.statusCode).toBe(403);
    expect(prizeDb.markWinner).not.toHaveBeenCalled();
  });

  it.each([["abc"], ["0"], ["1e3"]])("refuses the id %j without marking", async (id) => {
    vi.setSystemTime(SIX_PM);
    const res = await markAs(id);
    expect(res.statusCode).toBe(400);
    expect(body(res)).toEqual({ error: "That did not look right. Reload the page and try again." });
    expect(prizeDb.markWinner).not.toHaveBeenCalled();
  });

  it("answers 500 in words when the marking fails", async () => {
    vi.setSystemTime(SIX_PM);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    prizeDb.markWinner.mockRejectedValue(new Error("boom"));
    const res = await markAs("12");
    expect(res.statusCode).toBe(500);
    expect(body(res)).toEqual({ error: "Admin is temporarily unavailable" });
  });
});

describe("the router", () => {
  it("mounts the settings, the entries, a picture and the marking", () => {
    const paths = (routes.adminElfPrizeRouter as unknown as { stack: { route?: { path: string; methods: Record<string, boolean> } }[] }).stack
      .filter((l) => l.route)
      .map((l) => `${Object.keys(l.route!.methods)[0].toUpperCase()} ${l.route!.path}`);
    expect(paths).toEqual([
      "GET /api/admin/elf/grand-prize/settings",
      "PUT /api/admin/elf/grand-prize/settings",
      "GET /api/admin/elf/grand-prize",
      "GET /api/admin/elf/grand-prize/:id/picture",
      "POST /api/admin/elf/grand-prize/:id/winner",
    ]);
  });
});
