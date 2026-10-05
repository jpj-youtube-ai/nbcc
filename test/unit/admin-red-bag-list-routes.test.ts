import { describe, it, expect, vi, beforeEach } from "vitest";

// Admin > Fill a Red Bag: the API behind the list's editor. View of the "red-bag" section sees the
// editor, the differences, the history and any earlier version; only edit saves the draft,
// publishes, throws away or puts back. The server checks the list on every save, refuses a save
// against a stale stamp in plain words, and says who did what. The database is mocked. Every name
// and address here is invented.

const db = vi.hoisted(() => ({
  readRedBagEditor: vi.fn(),
  readRedBagVersion: vi.fn(),
  saveRedBagDraft: vi.fn(),
  publishRedBagDraft: vi.fn(),
  discardRedBagDraft: vi.fn(),
  restoreRedBagList: vi.fn(),
  redBagStaffName: vi.fn(),
}));
const { getUserAuthRowMock } = vi.hoisted(() => ({ getUserAuthRowMock: vi.fn() }));

vi.mock("../../src/db/red-bag-lists", () => {
  class RedBagListError extends Error {
    constructor(
      public readonly reason: string,
      public readonly problems: unknown[] = [],
    ) {
      super(reason);
    }
  }
  return { ...db, RedBagListError };
});
vi.mock("../../src/db/admin-users", () => ({ getUserAuthRow: getUserAuthRowMock }));
vi.mock("../../src/config", () => ({
  config: {
    NODE_ENV: "development",
    DATABASE_URL: "postgres://localhost:5432/test",
    ADMIN_SESSION_SECRET: "test-admin-secret",
    STRIPE_SECRET_KEY: "sk_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    STRIPE_WEBHOOK_SECRET: "whsec_placeholder",
    PORTAL_BASE_URL: "https://nbcc.test",
  },
}));
vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));

import * as routes from "../../src/routes/admin-red-bag-list";
import { signAdminSession } from "../../src/admin/session";
import { RedBagListError } from "../../src/db/red-bag-lists";
import { SECTIONS } from "../../src/admin/permissions";
import { redBagList, type RedBagList } from "../../src/red-bag/list";

const L = redBagList();
const SECRET = "test-admin-secret";
const EMAIL = "jodie.lists@nbcc.test";
const everythingBut = (level: string) => Object.fromEntries(SECTIONS.filter((s) => s !== "red-bag").map((s) => [s, level]));
/** Someone signed in. `access`: their level for this section, or "role" to leave it to their role. */
function tokenFor(role: string, access: "none" | "view" | "edit" | "role" = "role") {
  const permissions = access === "role" ? {} : { ...everythingBut("edit"), "red-bag": access };
  getUserAuthRowMock.mockResolvedValue({ id: 1, email: EMAIL, status: "active", role, permissions });
  return signAdminSession({ sub: 1, email: EMAIL, role, now: new Date(), secret: SECRET }).token;
}

type MockRes = { statusCode: number; body: unknown; status: (c: number) => MockRes; json: (b: unknown) => MockRes };
function mockRes(): MockRes {
  const res = { statusCode: 200, body: undefined as unknown } as MockRes;
  res.status = (c) => {
    res.statusCode = c;
    return res;
  };
  res.json = (b) => {
    res.body = b;
    return res;
  };
  return res;
}
type Opts = { token?: string | null; body?: unknown; params?: Record<string, string> };
/* eslint-disable @typescript-eslint/no-explicit-any */
type Handler = (req: any, res: any) => Promise<unknown>;
async function run(handler: Handler, o: Opts = {}) {
  const res = mockRes();
  const headers: Record<string, string> = {};
  if (o.token) headers.authorization = `Bearer ${o.token}`;
  await handler({ headers, body: o.body ?? {}, params: o.params ?? {} } as any, res as any);
  return res;
}
const bodyOf = (res: MockRes) => res.body as any;
/* eslint-enable @typescript-eslint/no-explicit-any */
const errorOf = (res: MockRes) => (res.body as { error: string }).error;

const edited = (): RedBagList => {
  const l = L.builtIn();
  l.items.find((i) => i.key === "toy")!.pence = 1200;
  return l;
};
const version = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  publishedAt: "2026-10-05T10:00:00.000Z",
  publishedByName: "Jodie Example",
  summary: "Toy £15 to £12",
  changes: ["Toy £15 to £12"],
  restoredFrom: null,
  restoredOriginal: false,
  ...over,
});
const state = (over: Record<string, unknown> = {}) => ({
  website: L.builtIn(),
  publishedId: null,
  draft: { data: edited(), version: 3, updatedAt: "2026-10-05T09:00:00.000Z", updatedByName: "Jodie Example", restoredFrom: null },
  history: [],
  ...over,
});

beforeEach(() => {
  for (const fn of Object.values(db)) fn.mockReset();
  getUserAuthRowMock.mockReset();
  db.readRedBagEditor.mockResolvedValue(state());
  db.redBagStaffName.mockResolvedValue("Jodie Example");
  db.saveRedBagDraft.mockResolvedValue(state().draft);
  db.publishRedBagDraft.mockResolvedValue(version(9));
  db.discardRedBagDraft.mockResolvedValue(undefined);
  db.restoreRedBagList.mockResolvedValue(state().draft);
  db.readRedBagVersion.mockResolvedValue({ ...version(2), data: edited() });
});

const SAVE: Opts = { body: { data: edited(), version: 3, publishedId: null } };
const PUBLISH: Opts = { body: { version: 3 } };
const DISCARD: Opts = { body: { version: 3 } };
const RESTORE: Opts = { body: { from: "original", version: 3, publishedId: null } };
const VERSION: Opts = { params: { id: "2" } };
const READS: Array<[string, Handler, Opts]> = [
  ["the editor", routes.getAdminRedBagList, {}],
  ["an earlier version", routes.getAdminRedBagVersion, VERSION],
];
const WRITES: Array<[string, Handler, Opts]> = [
  ["saving the draft", routes.putAdminRedBagDraft, SAVE],
  ["publishing", routes.postAdminRedBagPublish, PUBLISH],
  ["throwing the draft away", routes.postAdminRedBagDiscard, DISCARD],
  ["putting a list back", routes.postAdminRedBagRestore, RESTORE],
];
const noWrites = () => {
  expect(db.saveRedBagDraft).not.toHaveBeenCalled();
  expect(db.publishRedBagDraft).not.toHaveBeenCalled();
  expect(db.discardRedBagDraft).not.toHaveBeenCalled();
  expect(db.restoreRedBagList).not.toHaveBeenCalled();
};

describe("who may do what", () => {
  it.each([...READS, ...WRITES])("%s needs a session", async (_w, handler, o) => {
    const res = await run(handler, { ...o, token: null });
    expect(res.statusCode).toBe(401);
    expect(db.readRedBagEditor).not.toHaveBeenCalled();
    noWrites();
  });

  it.each([...READS, ...WRITES])("%s is refused to a session that is not ours", async (_w, handler, o) => {
    expect((await run(handler, { ...o, token: "not.a.token" })).statusCode).toBe(401);
    noWrites();
  });

  it.each([...READS, ...WRITES])("%s is refused to someone signed in without the section", async (_w, handler, o) => {
    for (const token of [tokenFor("editor"), tokenFor("viewer"), tokenFor("editor", "none"), tokenFor("admin", "none")]) {
      expect((await run(handler, { ...o, token })).statusCode).toBe(403);
    }
    expect(db.readRedBagEditor).not.toHaveBeenCalled();
    expect(db.readRedBagVersion).not.toHaveBeenCalled();
    noWrites();
  });

  it.each(READS)("%s is open to someone with view only", async (_w, handler, o) => {
    expect((await run(handler, { ...o, token: tokenFor("viewer", "view") })).statusCode).toBe(200);
  });

  it.each(WRITES)("%s is refused to someone with view only", async (_w, handler, o) => {
    expect((await run(handler, { ...o, token: tokenFor("viewer", "view") })).statusCode).toBe(403);
    noWrites();
  });

  it.each(WRITES)("%s is open to someone given edit, whatever their role", async (_w, handler, o) => {
    expect((await run(handler, { ...o, token: tokenFor("viewer", "edit") })).statusCode).toBe(200);
  });

  it.each([...READS, ...WRITES])("%s is open to an admin by role", async (_w, handler, o) => {
    expect((await run(handler, { ...o, token: tokenFor("admin") })).statusCode).toBe(200);
  });
});

describe("the editor's state", () => {
  it("is the website's list, the draft and its stamp, the differences between them, and the history", async () => {
    db.readRedBagEditor.mockResolvedValue(state({ publishedId: 4, history: [version(4), version(2, { publishedByName: "Kim Example" })] }));
    const res = await run(routes.getAdminRedBagList, { token: tokenFor("admin") });
    const b = bodyOf(res);
    expect(b.publishedId).toBe(4);
    expect(b.website.items.length).toBe(13);
    expect(b.draft.version).toBe(3);
    expect(b.draft.data.items.find((i: { key: string }) => i.key === "toy").pence).toBe(1200);
    expect(b.changes).toEqual(["Toy £15 \u2192 £12"]);
    expect(b.history.map((h: { id: number }) => h.id)).toEqual([4, 2]);
  });

  it("says whether this person may change things, so the screen can leave the buttons out", async () => {
    expect(bodyOf(await run(routes.getAdminRedBagList, { token: tokenFor("viewer", "view") })).mayEdit).toBe(false);
    expect(bodyOf(await run(routes.getAdminRedBagList, { token: tokenFor("viewer", "edit") })).mayEdit).toBe(true);
    expect(bodyOf(await run(routes.getAdminRedBagList, { token: tokenFor("admin") })).mayEdit).toBe(true);
  });

  it("has no draft and no differences when there is none", async () => {
    db.readRedBagEditor.mockResolvedValue(state({ draft: null }));
    const b = bodyOf(await run(routes.getAdminRedBagList, { token: tokenFor("admin") }));
    expect(b.draft).toBeNull();
    expect(b.changes).toEqual([]);
  });

  it("answers plainly when the database cannot", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    db.readRedBagEditor.mockRejectedValueOnce(new Error("down"));
    const res = await run(routes.getAdminRedBagList, { token: tokenFor("admin") });
    expect(res.statusCode).toBe(500);
    expect(errorOf(res)).toBe("Admin is temporarily unavailable");
    log.mockRestore();
  });
});

describe("looking at an earlier version", () => {
  it("gives a published version with its list", async () => {
    const res = await run(routes.getAdminRedBagVersion, { ...VERSION, token: tokenFor("viewer", "view") });
    expect(db.readRedBagVersion).toHaveBeenCalledWith(2);
    expect(bodyOf(res).version.data.items.find((i: { key: string }) => i.key === "toy").pence).toBe(1200);
  });

  it("gives the original list, which is in the code", async () => {
    const res = await run(routes.getAdminRedBagVersion, { params: { id: "original" }, token: tokenFor("viewer", "view") });
    expect(res.statusCode).toBe(200);
    expect(L.same(bodyOf(res).version.data, L.builtIn())).toBe(true);
    expect(db.readRedBagVersion).not.toHaveBeenCalled();
  });

  it("says so when there is no such version, or the id is not one", async () => {
    db.readRedBagVersion.mockResolvedValue(null);
    expect((await run(routes.getAdminRedBagVersion, { params: { id: "77" }, token: tokenFor("admin") })).statusCode).toBe(404);
    for (const id of ["abc", "-1", "0", "1.5", "99999999999999"]) {
      expect((await run(routes.getAdminRedBagVersion, { params: { id }, token: tokenFor("admin") })).statusCode, id).toBe(400);
    }
  });
});

describe("saving the draft", () => {
  it("saves what was sent against the stamp sent, as this person, and answers with the editor's state", async () => {
    const res = await run(routes.putAdminRedBagDraft, { ...SAVE, token: tokenFor("admin") });
    expect(res.statusCode).toBe(200);
    expect(db.saveRedBagDraft).toHaveBeenCalledWith(SAVE.body && (SAVE.body as { data: unknown }).data, { version: 3, publishedId: null }, { actor: `admin:${EMAIL}`, name: "Jodie Example" });
    expect(bodyOf(res).draft.version).toBe(3);
    expect(bodyOf(res).changes).toEqual(["Toy £15 \u2192 £12"]);
    expect(bodyOf(res).mayEdit).toBe(true);
  });

  it("refuses a stale stamp in plain words, with 409", async () => {
    db.saveRedBagDraft.mockRejectedValueOnce(new RedBagListError("stale"));
    const res = await run(routes.putAdminRedBagDraft, { ...SAVE, token: tokenFor("admin") });
    expect(res.statusCode).toBe(409);
    expect(errorOf(res)).toBe("Someone else has changed the draft. Reload to see their changes.");
    expect(bodyOf(res).code).toBe("stale");
  });

  it("refuses a bad price with the rule's own words, and says where", async () => {
    const problems = [{ kind: "item", key: "toy", field: "pence", message: "A price must be between 10p and £500." }];
    db.saveRedBagDraft.mockRejectedValueOnce(new RedBagListError("invalid", problems));
    const res = await run(routes.putAdminRedBagDraft, { ...SAVE, token: tokenFor("admin") });
    expect(res.statusCode).toBe(400);
    expect(errorOf(res)).toBe("A price must be between 10p and £500.");
    expect(bodyOf(res).problems).toEqual(problems);
  });

  it.each([
    ["no list", { version: 3, publishedId: null }],
    ["a list that is text", { data: "list", version: 3, publishedId: null }],
    ["no stamp", { data: edited(), publishedId: null }],
    ["a stamp below nothing", { data: edited(), version: -1, publishedId: null }],
    ["a stamp that is text", { data: edited(), version: "3", publishedId: null }],
    ["a website list that is text", { data: edited(), version: 3, publishedId: "4" }],
    ["something extra", { data: edited(), version: 3, publishedId: null, publish: true }],
  ])("refuses a save with %s, before the database is touched", async (_what, body) => {
    const res = await run(routes.putAdminRedBagDraft, { body, token: tokenFor("admin") });
    expect(res.statusCode).toBe(400);
    expect(db.saveRedBagDraft).not.toHaveBeenCalled();
  });

  it("answers plainly when the database cannot, and never hangs", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    db.saveRedBagDraft.mockRejectedValueOnce(new Error("down"));
    const res = await run(routes.putAdminRedBagDraft, { ...SAVE, token: tokenFor("admin") });
    expect(res.statusCode).toBe(500);
    expect(errorOf(res)).toBe("Admin is temporarily unavailable");
    log.mockRestore();
  });
});

describe("publishing", () => {
  it("publishes the draft at the stamp sent, as this person by name", async () => {
    db.readRedBagEditor.mockResolvedValue(state({ draft: null, publishedId: 9, website: edited(), history: [version(9)] }));
    const res = await run(routes.postAdminRedBagPublish, { ...PUBLISH, token: tokenFor("admin") });
    expect(db.publishRedBagDraft).toHaveBeenCalledWith(3, { actor: `admin:${EMAIL}`, name: "Jodie Example" });
    expect(db.redBagStaffName).toHaveBeenCalledWith(1, EMAIL);
    expect(bodyOf(res).draft).toBeNull();
    expect(bodyOf(res).publishedId).toBe(9);
    expect(bodyOf(res).history[0].id).toBe(9);
  });

  it("refuses a stale stamp, a draft with nothing new, and a draft that fails the rules", async () => {
    db.publishRedBagDraft.mockRejectedValueOnce(new RedBagListError("stale"));
    let res = await run(routes.postAdminRedBagPublish, { ...PUBLISH, token: tokenFor("admin") });
    expect([res.statusCode, errorOf(res)]).toEqual([409, "Someone else has changed the draft. Reload to see their changes."]);
    db.publishRedBagDraft.mockRejectedValueOnce(new RedBagListError("nothing"));
    res = await run(routes.postAdminRedBagPublish, { ...PUBLISH, token: tokenFor("admin") });
    expect([res.statusCode, errorOf(res)]).toEqual([400, "There is nothing to publish: the draft says what the website already says."]);
    db.publishRedBagDraft.mockRejectedValueOnce(new RedBagListError("invalid", [{ kind: "list", key: "", field: "items", message: "At least one item must be showing." }]));
    res = await run(routes.postAdminRedBagPublish, { ...PUBLISH, token: tokenFor("admin") });
    expect([res.statusCode, errorOf(res)]).toEqual([400, "At least one item must be showing."]);
  });

  it("refuses a publish with no stamp", async () => {
    expect((await run(routes.postAdminRedBagPublish, { body: {}, token: tokenFor("admin") })).statusCode).toBe(400);
    expect(db.publishRedBagDraft).not.toHaveBeenCalled();
  });
});

describe("throwing the draft away", () => {
  it("throws away the draft at the stamp sent", async () => {
    db.readRedBagEditor.mockResolvedValue(state({ draft: null }));
    const res = await run(routes.postAdminRedBagDiscard, { ...DISCARD, token: tokenFor("admin") });
    expect(db.discardRedBagDraft).toHaveBeenCalledWith(3, { actor: `admin:${EMAIL}`, name: "Jodie Example" });
    expect(bodyOf(res).draft).toBeNull();
  });

  it("refuses a stale stamp", async () => {
    db.discardRedBagDraft.mockRejectedValueOnce(new RedBagListError("stale"));
    expect((await run(routes.postAdminRedBagDiscard, { ...DISCARD, token: tokenFor("admin") })).statusCode).toBe(409);
  });
});

describe("putting an earlier list back as a draft", () => {
  it("puts back the original list, or a version by its id", async () => {
    await run(routes.postAdminRedBagRestore, { ...RESTORE, token: tokenFor("admin") });
    expect(db.restoreRedBagList).toHaveBeenLastCalledWith("original", { version: 3, publishedId: null }, { actor: `admin:${EMAIL}`, name: "Jodie Example" });
    await run(routes.postAdminRedBagRestore, { body: { from: 2, version: 0, publishedId: 4 }, token: tokenFor("admin") });
    expect(db.restoreRedBagList).toHaveBeenLastCalledWith(2, { version: 0, publishedId: 4 }, { actor: `admin:${EMAIL}`, name: "Jodie Example" });
  });

  it("says so when the version is not there, and refuses a stale stamp", async () => {
    db.restoreRedBagList.mockRejectedValueOnce(new RedBagListError("not_found"));
    let res = await run(routes.postAdminRedBagRestore, { body: { from: 77, version: 0, publishedId: null }, token: tokenFor("admin") });
    expect([res.statusCode, errorOf(res)]).toEqual([404, "That version is not there any more."]);
    db.restoreRedBagList.mockRejectedValueOnce(new RedBagListError("stale"));
    res = await run(routes.postAdminRedBagRestore, { ...RESTORE, token: tokenFor("admin") });
    expect(res.statusCode).toBe(409);
  });

  it.each([{ from: "latest", version: 0, publishedId: null }, { from: 0, version: 0, publishedId: null }, { from: 1.5, version: 0, publishedId: null }, { version: 0, publishedId: null }])(
    "refuses %j",
    async (body) => {
      expect((await run(routes.postAdminRedBagRestore, { body, token: tokenFor("admin") })).statusCode).toBe(400);
      expect(db.restoreRedBagList).not.toHaveBeenCalled();
    },
  );
});

describe("the routes", () => {
  it("are mounted where the screen asks for them", () => {
    const stack = (routes.adminRedBagListRouter as unknown as { stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }> }).stack;
    const mounted = stack.filter((l) => l.route).map((l) => `${Object.keys(l.route!.methods)[0].toUpperCase()} ${l.route!.path}`);
    expect(mounted).toEqual([
      "GET /api/admin/red-bag-list",
      "GET /api/admin/red-bag-list/versions/:id",
      "PUT /api/admin/red-bag-list/draft",
      "POST /api/admin/red-bag-list/publish",
      "POST /api/admin/red-bag-list/discard",
      "POST /api/admin/red-bag-list/restore",
    ]);
  });
});
