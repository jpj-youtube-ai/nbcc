import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Fill a Red Bag: the list's versions in the red_bag_lists table, against a fake pool (no database).
// Two halves. The public page's read: kept for a minute, read again at once after a publish, and
// NEVER throwing, whatever the database does. And the admin's writes: one shared draft with a
// stamp, publish, throw away, put back, each of the last three written to audit_log in the same
// transaction. Every name and address here is invented.

vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));
vi.mock("../../src/config", () => ({ config: { NODE_ENV: "test" } }));

import { pool } from "../../src/db/pool";
import {
  RED_BAG_LIST_CACHE_MS,
  RED_BAG_LIST_RETRY_MS,
  RedBagListError,
  discardRedBagDraft,
  forgetPublishedRedBagList,
  loadPublishedRedBagList,
  publishRedBagDraft,
  readRedBagDraft,
  readRedBagEditor,
  readRedBagVersion,
  restoreRedBagList,
  saveRedBagDraft,
} from "../../src/db/red-bag-lists";
import { redBagList, type RedBagList } from "../../src/red-bag/list";

const L = redBagList();
const query = pool.query as unknown as ReturnType<typeof vi.fn>;
const connect = pool.connect as unknown as ReturnType<typeof vi.fn>;

const edited = (change: (l: RedBagList) => void = (l) => (l.items.find((i) => i.key === "toy")!.pence = 1200)): RedBagList => {
  const list = L.builtIn();
  change(list);
  return list;
};
const publishedRow = (id: number, data: unknown, over: Record<string, unknown> = {}) => ({
  id,
  status: "published",
  data,
  version: 3,
  summary: "Toy £15 \u2192 £12",
  changes: ["Toy £15 \u2192 £12"],
  restored_from: null,
  restored_original: false,
  updated_at: "2026-10-05T09:00:00Z",
  updated_by: "admin:jodie@nbcc.test",
  updated_by_name: "Jodie Example",
  published_at: "2026-10-05T10:00:00Z",
  published_by: "admin:jodie@nbcc.test",
  published_by_name: "Jodie Example",
  ...over,
});
const draftRow = (data: unknown, version = 4, over: Record<string, unknown> = {}) => ({
  ...publishedRow(9, data),
  status: "draft",
  version,
  summary: null,
  changes: [],
  published_at: null,
  published_by: null,
  published_by_name: null,
  ...over,
});

type Answer = (sql: string, params: unknown[]) => unknown;
function useClient(answer: Answer) {
  const calls: Array<[string, unknown[]]> = [];
  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push([sql, params]);
      const out = answer(sql, params);
      if (out instanceof Error) throw out;
      return out ?? { rows: [] };
    }),
    release: vi.fn(),
  };
  connect.mockResolvedValue(client);
  return { calls, client };
}
/** A database holding this draft and this published list (either may be null). */
function holding(draft: Record<string, unknown> | null, published: Record<string, unknown> | null, more: Answer = () => undefined): Answer {
  return (sql, params) => {
    const extra = more(sql, params);
    if (extra !== undefined) return extra;
    if (/status = 'draft'/.test(sql) && /^\s*SELECT/.test(sql)) return { rows: draft ? [draft] : [] };
    if (/status = 'published'/.test(sql) && /^\s*SELECT/.test(sql) && /LIMIT 1/.test(sql)) return { rows: published ? [published] : [] };
    if (/^\s*(INSERT INTO red_bag_lists|UPDATE red_bag_lists)/.test(sql)) return { rows: [{ ...(draft ?? draftRow(params[0], 1)), id: draft?.id ?? 12 }] };
    return { rows: [] };
  };
}
const sqls = (calls: Array<[string, unknown[]]>) => calls.map(([sql]) => sql.replace(/\s+/g, " ").trim());
const audits = (calls: Array<[string, unknown[]]>) => calls.filter(([sql]) => /INSERT INTO audit_log/.test(sql)).map(([, p]) => p);
const committed = (calls: Array<[string, unknown[]]>) => sqls(calls).includes("COMMIT");
const rolledBack = (calls: Array<[string, unknown[]]>) => sqls(calls).includes("ROLLBACK");

let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  query.mockReset();
  connect.mockReset();
  forgetPublishedRedBagList();
  errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  errors.mockRestore();
  vi.useRealTimers();
});

describe("the public page's read", () => {
  it("is nothing when nothing has ever been published: the page uses its built-in list", async () => {
    query.mockResolvedValue({ rows: [] });
    expect(await loadPublishedRedBagList({ now: 1000 })).toBeNull();
    expect(String(query.mock.calls[0][0])).toMatch(/FROM red_bag_lists/);
    expect(String(query.mock.calls[0][0])).toMatch(/status = 'published'/);
    expect(String(query.mock.calls[0][0])).toMatch(/ORDER BY published_at DESC, id DESC\s+LIMIT 1/);
  });

  it("is the latest published list", async () => {
    query.mockResolvedValue({ rows: [publishedRow(4, edited())] });
    const list = await loadPublishedRedBagList({ now: 1000 });
    expect(list!.items.find((i) => i.key === "toy")!.pence).toBe(1200);
  });

  it("is kept for a minute: page views inside it ask the database nothing", async () => {
    query.mockResolvedValue({ rows: [publishedRow(4, edited())] });
    await loadPublishedRedBagList({ now: 1000 });
    await loadPublishedRedBagList({ now: 1000 + RED_BAG_LIST_CACHE_MS - 1 });
    expect(query).toHaveBeenCalledTimes(1);
    await loadPublishedRedBagList({ now: 1000 + RED_BAG_LIST_CACHE_MS });
    expect(query).toHaveBeenCalledTimes(2);
    expect(RED_BAG_LIST_CACHE_MS).toBe(60_000);
  });

  it("remembers that nothing is published for the minute too", async () => {
    query.mockResolvedValue({ rows: [] });
    await loadPublishedRedBagList({ now: 1000 });
    await loadPublishedRedBagList({ now: 2000 });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("reads again at once when asked for it fresh", async () => {
    query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [publishedRow(4, edited())] });
    expect(await loadPublishedRedBagList({ now: 1000 })).toBeNull();
    expect((await loadPublishedRedBagList({ now: 1001, fresh: true }))!.items.find((i) => i.key === "toy")!.pence).toBe(1200);
  });

  it("never throws when the database cannot answer before anything was read: the built-in list, said once", async () => {
    query.mockRejectedValue(new Error("connection refused"));
    await expect(loadPublishedRedBagList({ now: 1000 })).resolves.toBeNull();
    await expect(loadPublishedRedBagList({ now: 1000 + RED_BAG_LIST_RETRY_MS })).resolves.toBeNull();
    await expect(loadPublishedRedBagList({ now: 1000 + 2 * RED_BAG_LIST_RETRY_MS })).resolves.toBeNull();
    expect(errors).toHaveBeenCalledTimes(1);
    expect(String(errors.mock.calls[0][0])).toMatch(/fill a red bag list/i);
  });

  it("keeps the last good list when the database stops answering, and does not ask on every page view", async () => {
    query.mockResolvedValueOnce({ rows: [publishedRow(4, edited())] });
    await loadPublishedRedBagList({ now: 1000 });
    query.mockRejectedValue(new Error("timeout"));
    const later = 1000 + RED_BAG_LIST_CACHE_MS;
    expect((await loadPublishedRedBagList({ now: later }))!.items.find((i) => i.key === "toy")!.pence).toBe(1200);
    expect(query).toHaveBeenCalledTimes(2);
    // Not asked again until a short while has passed.
    await loadPublishedRedBagList({ now: later + RED_BAG_LIST_RETRY_MS - 1 });
    expect(query).toHaveBeenCalledTimes(2);
    await loadPublishedRedBagList({ now: later + RED_BAG_LIST_RETRY_MS });
    expect(query).toHaveBeenCalledTimes(3);
    expect(errors).toHaveBeenCalledTimes(1);
  });

  it("says so again after it has recovered and failed afresh", async () => {
    query.mockRejectedValueOnce(new Error("down"));
    await loadPublishedRedBagList({ now: 0 });
    query.mockResolvedValueOnce({ rows: [] });
    await loadPublishedRedBagList({ now: RED_BAG_LIST_RETRY_MS });
    query.mockRejectedValueOnce(new Error("down again"));
    await loadPublishedRedBagList({ now: RED_BAG_LIST_RETRY_MS + RED_BAG_LIST_CACHE_MS });
    expect(errors).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["a price below 10p", edited((l) => (l.items[0].pence = 1))],
    ["a name with markup", edited((l) => (l.items[0].name = "<script>alert(1)</script>"))],
    ["no item showing", edited((l) => l.items.forEach((i) => (i.hidden = true)))],
    ["not a list", { hello: "world" }],
    ["text", "oops"],
    ["nothing", null],
  ])("does not use a stored list that fails the rules (%s): the built-in list, said once", async (_what, data) => {
    query.mockResolvedValue({ rows: [publishedRow(4, data)] });
    expect(await loadPublishedRedBagList({ now: 1000 })).toBeNull();
    expect(errors).toHaveBeenCalledTimes(1);
  });

  it("keeps the last good list when a later one fails the rules", async () => {
    query.mockResolvedValueOnce({ rows: [publishedRow(4, edited())] });
    await loadPublishedRedBagList({ now: 0 });
    query.mockResolvedValueOnce({ rows: [publishedRow(5, edited((l) => (l.items[0].pence = 0)))] });
    expect((await loadPublishedRedBagList({ now: 1, fresh: true }))!.items.find((i) => i.key === "toy")!.pence).toBe(1200);
  });

  it("does not wait on a database that hangs: the built-in list after a moment", async () => {
    vi.useFakeTimers();
    query.mockReturnValue(new Promise(() => undefined));
    const reading = loadPublishedRedBagList({ now: 1000 });
    await vi.advanceTimersByTimeAsync(1600);
    await expect(reading).resolves.toBeNull();
  });

  it("shares one read between page views that arrive together", async () => {
    let answer: (v: unknown) => void = () => undefined;
    query.mockReturnValue(new Promise((r) => (answer = r)));
    const a = loadPublishedRedBagList({ now: 1000 });
    const b = loadPublishedRedBagList({ now: 1000 });
    answer({ rows: [publishedRow(4, edited())] });
    expect((await a)!.items.length).toBe(13);
    expect((await b)!.items.length).toBe(13);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("a slow older read never overwrites a newer one: only the newest read started may set the list", async () => {
    let answerOld: (v: unknown) => void = () => undefined;
    query.mockReturnValueOnce(new Promise((r) => (answerOld = r)));
    const older = loadPublishedRedBagList({ now: 1000 });
    // A publish happens meanwhile: its fresh read starts later and answers first.
    query.mockResolvedValueOnce({ rows: [publishedRow(9, edited((l) => (l.items.find((i) => i.key === "toy")!.pence = 1000)))] });
    const newer = await loadPublishedRedBagList({ now: 1001, fresh: true });
    expect(newer!.items.find((i) => i.key === "toy")!.pence).toBe(1000);
    // Now the old read comes back, with the list as it was before the publish.
    answerOld({ rows: [publishedRow(4, edited())] });
    expect((await older)!.items.find((i) => i.key === "toy")!.pence).toBe(1000);
    const asked = query.mock.calls.length;
    expect((await loadPublishedRedBagList({ now: 1002 }))!.items.find((i) => i.key === "toy")!.pence).toBe(1000);
    expect((await loadPublishedRedBagList({ now: 1000 + RED_BAG_LIST_CACHE_MS - 1 }))!.items.find((i) => i.key === "toy")!.pence).toBe(1000);
    expect(query.mock.calls.length).toBe(asked);
  });

  it("a slow older read that FAILS does not disturb a newer one either", async () => {
    let failOld: (e: unknown) => void = () => undefined;
    query.mockReturnValueOnce(new Promise((_r, no) => (failOld = no)));
    const older = loadPublishedRedBagList({ now: 1000 });
    query.mockResolvedValueOnce({ rows: [publishedRow(9, edited())] });
    await loadPublishedRedBagList({ now: 1001, fresh: true });
    failOld(new Error("gone away"));
    expect((await older)!.items.find((i) => i.key === "toy")!.pence).toBe(1200);
    const asked = query.mock.calls.length;
    // Still the full minute from the good read: the old failure did not bring the next read forward.
    await loadPublishedRedBagList({ now: 1001 + RED_BAG_LIST_CACHE_MS - 1 });
    expect(query.mock.calls.length).toBe(asked);
  });

  it("hands each caller its own copy: nothing a page does to it reaches the next", async () => {
    query.mockResolvedValue({ rows: [publishedRow(4, edited())] });
    const a = await loadPublishedRedBagList({ now: 1000 });
    a!.items[0].name = "Scribbled on";
    expect((await loadPublishedRedBagList({ now: 1001 }))!.items[0].name).toBe("Blanket");
  });
});

describe("what the editor shows", () => {
  it("is the website's list, the draft with its stamp, and the history, newest first", async () => {
    const draft = draftRow(edited((l) => (l.items[0].pence = 900)), 4);
    query.mockImplementation(async (sql: string) => {
      if (/status = 'draft'/.test(sql)) return { rows: [draft] };
      if (/LIMIT 1s*$/.test(sql)) return { rows: [publishedRow(4, edited())] };
      return { rows: [publishedRow(4, undefined), publishedRow(2, undefined, { published_at: "2026-10-01T10:00:00Z", published_by_name: "Kim Example", summary: "Hidden: Socks (pair)", changes: ["Hidden: Socks (pair)"], restored_original: true })] };
    });
    const e = await readRedBagEditor();
    expect(e.publishedId).toBe(4);
    expect(e.website.items.find((i) => i.key === "toy")!.pence).toBe(1200);
    expect(e.draft).toMatchObject({ version: 4, updatedByName: "Jodie Example", updatedAt: "2026-10-05T09:00:00.000Z" });
    expect(e.draft!.data.items[0].pence).toBe(900);
    expect(e.history.map((h) => [h.id, h.publishedByName, h.changes.length, h.restoredOriginal])).toEqual([
      [4, "Jodie Example", 1, false],
      [2, "Kim Example", 1, true],
    ]);
    const history = query.mock.calls.map((c) => String(c[0])).find((sql) => /LIMIT 100/.test(sql))!;
    expect(history).toMatch(/ORDER BY published_at DESC, id DESC/);
    // The history carries no lists: each is fetched when it is looked at.
    expect(history).not.toMatch(/\bdata\b/);
  });

  it("is the built-in list, no draft and no history before anything is published", async () => {
    query.mockResolvedValue({ rows: [] });
    const e = await readRedBagEditor();
    expect(e.publishedId).toBeNull();
    expect(L.same(e.website, L.builtIn())).toBe(true);
    expect(e.draft).toBeNull();
    expect(e.history).toEqual([]);
  });

  it("throws when the database cannot answer, so the screen says it could not load", async () => {
    query.mockRejectedValue(new Error("down"));
    await expect(readRedBagEditor()).rejects.toThrow("down");
    await expect(readRedBagDraft()).rejects.toThrow("down");
  });

  it("reads one earlier version with its list, or nothing if it is not a published one", async () => {
    query.mockResolvedValueOnce({ rows: [publishedRow(2, edited())] });
    const v = await readRedBagVersion(2);
    expect(v!.data.items.find((i) => i.key === "toy")!.pence).toBe(1200);
    expect(String(query.mock.calls[0][0])).toMatch(/status = 'published'/);
    query.mockResolvedValueOnce({ rows: [] });
    expect(await readRedBagVersion(77)).toBeNull();
  });

  it("reads the draft for the preview, or nothing when there is none", async () => {
    query.mockResolvedValueOnce({ rows: [draftRow(edited())] });
    expect((await readRedBagDraft())!.data.items.find((i) => i.key === "toy")!.pence).toBe(1200);
    query.mockResolvedValueOnce({ rows: [] });
    expect(await readRedBagDraft()).toBeNull();
  });
});

const WHO = { actor: "admin:jodie@nbcc.test", name: "Jodie Example" };

describe("saving the draft", () => {
  it("starts a draft when there is none, stamped 1, and writes no audit row", async () => {
    const { calls } = useClient(holding(null, null));
    const saved = await saveRedBagDraft(edited(), { version: 0, publishedId: null }, WHO);
    expect(saved.version).toBe(1);
    const insert = calls.find(([sql]) => /INSERT INTO red_bag_lists/.test(sql))!;
    expect(insert[0]).toMatch(/'draft'/);
    expect(JSON.parse(String(insert[1][0])).items.find((i: { key: string }) => i.key === "toy").pence).toBe(1200);
    expect(insert[1]).toContain("admin:jodie@nbcc.test");
    expect(insert[1]).toContain("Jodie Example");
    expect(audits(calls)).toEqual([]);
    expect(committed(calls)).toBe(true);
  });

  it("locks the draft and moves its stamp on by one", async () => {
    const { calls } = useClient(holding(draftRow(L.builtIn(), 4), null, (sql) => (/^\s*UPDATE red_bag_lists/.test(sql) ? { rows: [draftRow(edited(), 5)] } : undefined)));
    const saved = await saveRedBagDraft(edited(), { version: 4, publishedId: null }, WHO);
    expect(saved.version).toBe(5);
    expect(sqls(calls).find((s) => /status = 'draft'/.test(s) && /^SELECT/.test(s))).toMatch(/FOR UPDATE/);
    expect(sqls(calls).find((s) => /^UPDATE red_bag_lists/.test(s))).toMatch(/version = version \+ 1/);
  });

  it("refuses a save against a stale stamp, and changes nothing", async () => {
    const { calls } = useClient(holding(draftRow(L.builtIn(), 5), null));
    await expect(saveRedBagDraft(edited(), { version: 4, publishedId: null }, WHO)).rejects.toMatchObject({ reason: "stale" });
    expect(sqls(calls).some((s) => /^(UPDATE|INSERT INTO|DELETE FROM) red_bag_lists/.test(s))).toBe(false);
    expect(rolledBack(calls)).toBe(true);
  });

  it("refuses a save for a draft that has since been published or thrown away", async () => {
    const { calls } = useClient(holding(null, publishedRow(4, edited())));
    await expect(saveRedBagDraft(edited(), { version: 4, publishedId: 3 }, WHO)).rejects.toMatchObject({ reason: "stale" });
    expect(sqls(calls).some((s) => /^INSERT INTO red_bag_lists/.test(s))).toBe(false);
  });

  it("refuses to start a draft from a website list that has changed since the screen was opened", async () => {
    const { calls } = useClient(holding(null, publishedRow(4, edited())));
    await expect(saveRedBagDraft(edited(), { version: 0, publishedId: 3 }, WHO)).rejects.toMatchObject({ reason: "stale" });
    await expect(saveRedBagDraft(edited(), { version: 0, publishedId: null }, WHO)).rejects.toMatchObject({ reason: "stale" });
    expect(sqls(calls).some((s) => /^INSERT INTO red_bag_lists/.test(s))).toBe(false);
    // Opened on the list that is still the website's: fine.
    await expect(saveRedBagDraft(edited(), { version: 0, publishedId: 4 }, WHO)).resolves.toMatchObject({ version: 1 });
  });

  it("refuses when someone else starts a draft in the same instant (the table allows only one)", async () => {
    useClient(holding(null, null, (sql) => (/^\s*INSERT INTO red_bag_lists/.test(sql) ? Object.assign(new Error("duplicate key"), { code: "23505" }) : undefined)));
    await expect(saveRedBagDraft(edited(), { version: 0, publishedId: null }, WHO)).rejects.toMatchObject({ reason: "stale" });
  });

  it("checks the list on every save, and stores nothing that fails", async () => {
    const { calls } = useClient(holding(null, null));
    const bad = edited((l) => (l.items[0].pence = 5));
    const err = await saveRedBagDraft(bad, { version: 0, publishedId: null }, WHO).catch((e) => e);
    expect(err).toBeInstanceOf(RedBagListError);
    expect(err.reason).toBe("invalid");
    expect(err.problems[0]).toMatchObject({ key: "blanket", field: "pence", message: "A price must be between 10p and £500." });
    expect(calls).toEqual([]);
  });

  it("stores only what a list holds, tidied", async () => {
    const { calls } = useClient(holding(null, null));
    const raw = edited() as unknown as Record<string, unknown>;
    raw.extra = "<script>";
    (raw.items as Array<Record<string, unknown>>)[0].name = "  Warm   blanket ";
    (raw.items as Array<Record<string, unknown>>)[0].onclick = "x";
    await saveRedBagDraft(raw, { version: 0, publishedId: null }, WHO);
    const stored = JSON.parse(String(calls.find(([sql]) => /INSERT INTO red_bag_lists/.test(sql))![1][0]));
    expect(Object.keys(stored)).toEqual(["v", "items", "examples"]);
    expect(stored.items[0]).toEqual({ key: "blanket", name: "Warm blanket", pence: 800, group: "home", art: "blanket", hidden: false });
  });
});

describe("what is on the website can be hidden, never removed: checked on the server", () => {
  const boxed = (): RedBagList => edited((l) => l.items.push({ key: "n-selection-box-a1b2c", name: "Selection box", pence: 300, group: "play", art: "present", hidden: false }));
  const lacking = (l: RedBagList, key: string): RedBagList => ({ ...l, items: l.items.filter((i) => i.key !== key) });
  const REMOVED = "An item that is on the website can be hidden, not removed.";
  const stored = (calls: Array<[string, unknown[]]>) => sqls(calls).some((s) => /^(UPDATE|INSERT INTO) red_bag_lists/.test(s));
  /** A version to be found by its id (the list a draft was put back from). */
  const versions = (found: Record<number, unknown>): Answer => (sql, params) =>
    /WHERE id = \$1/.test(sql) && /^\s*SELECT/.test(sql) ? { rows: found[Number(params[0])] ? [{ id: params[0], data: found[Number(params[0])] }] : [] } : undefined;

  it("a save that drops an item the published list has is refused, and nothing is stored", async () => {
    const { calls } = useClient(holding(null, publishedRow(4, boxed())));
    const err = await saveRedBagDraft(lacking(boxed(), "toy"), { version: 0, publishedId: 4 }, WHO).catch((e) => e);
    expect(err).toBeInstanceOf(RedBagListError);
    expect(err.reason).toBe("invalid");
    expect(err.problems).toEqual([{ kind: "item", key: "toy", field: "", message: REMOVED }]);
    expect(stored(calls)).toBe(false);
    expect(rolledBack(calls)).toBe(true);
  });

  it("with nothing published, a save that drops a built-in item is refused", async () => {
    const { calls } = useClient(holding(null, null));
    const err = await saveRedBagDraft(lacking(L.builtIn(), "socks"), { version: 0, publishedId: null }, WHO).catch((e) => e);
    expect(err.problems[0]).toMatchObject({ key: "socks", message: REMOVED });
    expect(stored(calls)).toBe(false);
  });

  it("hiding it instead is fine, and so is removing something that was never published", async () => {
    useClient(holding(null, publishedRow(4, edited())));
    const hidden = edited((l) => (l.items.find((i) => i.key === "toy")!.hidden = true));
    await expect(saveRedBagDraft(hidden, { version: 0, publishedId: 4 }, WHO)).resolves.toMatchObject({ version: 1 });
    // The draft had a new item; this save takes it out again. The website never had it.
    useClient(holding(draftRow(boxed(), 2), publishedRow(4, edited()), (sql) => (/^\s*UPDATE red_bag_lists/.test(sql) ? { rows: [draftRow(edited(), 3)] } : undefined)));
    await expect(saveRedBagDraft(edited(), { version: 2, publishedId: 4 }, WHO)).resolves.toMatchObject({ version: 3 });
  });

  it("a draft that was put back from an earlier list can be saved and published without what that list lacked", async () => {
    // The website (4) has the box; version 2, put back, did not.
    const putBack = draftRow(edited(), 3, { restored_from: 2 });
    const first = useClient(holding(putBack, publishedRow(4, boxed()), (sql, params) => versions({ 2: edited() })(sql, params) ?? (/^\s*UPDATE red_bag_lists/.test(sql) ? { rows: [draftRow(edited(), 4, { restored_from: 2 })] } : undefined)));
    await expect(saveRedBagDraft(edited((l) => (l.items[0].pence = 900)), { version: 3, publishedId: 4 }, WHO)).resolves.toMatchObject({ version: 4 });
    // A plain save keeps the note of where the draft came from, so the next save is let through too.
    expect(sqls(first.calls).find((s) => /^UPDATE red_bag_lists/.test(s))).not.toMatch(/restored_from =/);

    query.mockResolvedValue({ rows: [] });
    const second = useClient(
      holding(putBack, publishedRow(4, boxed()), (sql, params) =>
        versions({ 2: edited() })(sql, params) ?? (/^\s*UPDATE red_bag_lists/.test(sql) ? { rows: [publishedRow(9, edited(), { summary: params[3], changes: JSON.parse(String(params[4])) })] } : undefined),
      ),
    );
    const v = await publishRedBagDraft(3, WHO);
    expect(v.changes).toContain("Removed: Selection box");
    expect(committed(second.calls)).toBe(true);
  });

  it("the original list put back may lack everything added since, and nothing the original has", async () => {
    const fromOriginal = draftRow(L.builtIn(), 3, { restored_original: true });
    useClient(holding(fromOriginal, publishedRow(4, boxed()), (sql) => (/^\s*UPDATE red_bag_lists/.test(sql) ? { rows: [draftRow(L.builtIn(), 4, { restored_original: true })] } : undefined)));
    await expect(saveRedBagDraft(L.builtIn(), { version: 3, publishedId: 4 }, WHO)).resolves.toMatchObject({ version: 4 });
    const { calls } = useClient(holding(fromOriginal, publishedRow(4, boxed())));
    const err = await saveRedBagDraft(lacking(L.builtIn(), "toy"), { version: 3, publishedId: 4 }, WHO).catch((e) => e);
    expect(err.problems).toEqual([{ kind: "item", key: "toy", field: "", message: REMOVED }]);
    expect(stored(calls)).toBe(false);
  });

  it("a put back draft may not drop something the list it came from has", async () => {
    const { calls } = useClient(holding(draftRow(edited(), 3, { restored_from: 2 }), publishedRow(4, boxed()), versions({ 2: edited() })));
    const err = await saveRedBagDraft(lacking(edited(), "book"), { version: 3, publishedId: 4 }, WHO).catch((e) => e);
    expect(err.problems.map((p: { key: string }) => p.key)).toEqual(["book"]);
    expect(stored(calls)).toBe(false);
  });

  it("an ordinary draft gets no exception: put back is the only way a draft may lack what the website has", async () => {
    const { calls } = useClient(holding(draftRow(boxed(), 3), publishedRow(4, boxed()), versions({ 2: edited() })));
    const err = await saveRedBagDraft(edited(), { version: 3, publishedId: 4 }, WHO).catch((e) => e);
    expect(err.problems.map((p: { key: string }) => p.key)).toEqual(["n-selection-box-a1b2c"]);
    expect(stored(calls)).toBe(false);
  });

  it("publish checks it again: a stored draft that drops what the website has is never published", async () => {
    const { calls } = useClient(holding(draftRow(lacking(boxed(), "toy"), 4), publishedRow(4, boxed())));
    const err = await publishRedBagDraft(4, WHO).catch((e) => e);
    expect(err.reason).toBe("invalid");
    expect(err.problems[0]).toMatchObject({ key: "toy", message: REMOVED });
    expect(sqls(calls).some((s) => /^UPDATE red_bag_lists/.test(s))).toBe(false);
    expect(audits(calls)).toEqual([]);
  });

  it("putting a list back is itself never refused for what it lacks", async () => {
    const { calls } = useClient(holding(null, publishedRow(4, boxed())));
    await expect(restoreRedBagList("original", { version: 0, publishedId: 4 }, WHO)).resolves.toMatchObject({ version: 1 });
    expect(sqls(calls).some((s) => /^INSERT INTO red_bag_lists/.test(s))).toBe(true);
  });
});

describe("publishing", () => {
  const publishing = (draft: Record<string, unknown> | null, published: Record<string, unknown> | null) =>
    useClient(
      holding(draft, published, (sql, params) =>
        /^\s*UPDATE red_bag_lists/.test(sql) ? { rows: [publishedRow(9, draft?.data, { summary: params[3], changes: JSON.parse(String(params[4])), published_at: "2026-10-05T11:00:00Z" })] } : undefined,
      ),
    );

  it("makes the draft the website's list, with who, when and what changed, and audits it", async () => {
    const { calls } = publishing(draftRow(edited((l) => {
      l.items.find((i) => i.key === "toy")!.pence = 1200;
      l.items.find((i) => i.key === "hat-gloves")!.hidden = true;
    }), 4), null);
    query.mockResolvedValue({ rows: [] });
    const v = await publishRedBagDraft(4, WHO);
    const update = calls.find(([sql]) => /^\s*UPDATE red_bag_lists/.test(sql))!;
    expect(update[0]).toMatch(/status = 'published'/);
    expect(update[0]).toMatch(/published_at = now\(\)/);
    expect(update[1]).toEqual([9, "admin:jodie@nbcc.test", "Jodie Example", "Toy £15 \u2192 £12; Hidden: Hat & gloves", JSON.stringify(["Toy £15 \u2192 £12", "Hidden: Hat & gloves"])]);
    expect(v).toMatchObject({ id: 9, publishedByName: "Jodie Example", changes: ["Toy £15 \u2192 £12", "Hidden: Hat & gloves"] });
    expect(audits(calls)).toEqual([
      ["admin:jodie@nbcc.test", "red_bag.list_published", "red_bag_list", 9, { summary: "Toy £15 \u2192 £12; Hidden: Hat & gloves", changes: ["Toy £15 \u2192 £12", "Hidden: Hat & gloves"], replaced: null }],
    ]);
    expect(committed(calls)).toBe(true);
  });

  it("says what changed against the list that was on the website, not the built-in one", async () => {
    const { calls } = publishing(draftRow(edited((l) => (l.items.find((i) => i.key === "toy")!.pence = 1000)), 2), publishedRow(4, edited()));
    query.mockResolvedValue({ rows: [] });
    await publishRedBagDraft(2, WHO);
    expect(audits(calls)[0][4]).toMatchObject({ changes: ["Toy £12 \u2192 £10"], replaced: 4 });
  });

  it("has this server read the list again at once, so the page shows it", async () => {
    publishing(draftRow(edited(), 4), null);
    query.mockResolvedValueOnce({ rows: [] });
    expect(await loadPublishedRedBagList({ now: 1000 })).toBeNull();
    query.mockResolvedValue({ rows: [publishedRow(9, edited())] });
    await publishRedBagDraft(4, WHO);
    // Inside the minute, and the page already has it.
    const asked = query.mock.calls.length;
    expect((await loadPublishedRedBagList({ now: 1001 }))!.items.find((i) => i.key === "toy")!.pence).toBe(1200);
    expect(query.mock.calls.length).toBe(asked);
  });

  it("keeps the last good list if the database blips as it reads again after a publish, and tries again soon", async () => {
    publishing(draftRow(edited((l) => (l.items.find((i) => i.key === "toy")!.pence = 1000)), 4), publishedRow(4, edited()));
    query.mockResolvedValueOnce({ rows: [publishedRow(4, edited())] });
    expect((await loadPublishedRedBagList({ now: Date.now() }))!.items.find((i) => i.key === "toy")!.pence).toBe(1200);
    query.mockRejectedValueOnce(new Error("blip"));
    await publishRedBagDraft(4, WHO);
    // Not the built-in list (£15): the list that was good a moment ago.
    const now = Date.now();
    expect((await loadPublishedRedBagList({ now }))!.items.find((i) => i.key === "toy")!.pence).toBe(1200);
    // And asked again after the short wait, when it has the published one.
    query.mockResolvedValue({ rows: [publishedRow(9, edited((l) => (l.items.find((i) => i.key === "toy")!.pence = 1000)))] });
    expect((await loadPublishedRedBagList({ now: now + RED_BAG_LIST_RETRY_MS + 50 }))!.items.find((i) => i.key === "toy")!.pence).toBe(1000);
  });

  it("refuses a stale stamp, and publishes nothing", async () => {
    const { calls } = publishing(draftRow(edited(), 5), null);
    await expect(publishRedBagDraft(4, WHO)).rejects.toMatchObject({ reason: "stale" });
    expect(sqls(calls).some((s) => /^UPDATE red_bag_lists/.test(s))).toBe(false);
    expect(audits(calls)).toEqual([]);
    expect(rolledBack(calls)).toBe(true);
  });

  it("refuses when there is no draft any more", async () => {
    publishing(null, publishedRow(4, edited()));
    await expect(publishRedBagDraft(4, WHO)).rejects.toMatchObject({ reason: "stale" });
  });

  it("refuses a draft that says what the website already says", async () => {
    const { calls } = publishing(draftRow(edited(), 2), publishedRow(4, edited()));
    await expect(publishRedBagDraft(2, WHO)).rejects.toMatchObject({ reason: "nothing" });
    expect(audits(calls)).toEqual([]);
  });

  it("checks the list again as it publishes: a stored draft that fails the rules is never published", async () => {
    const { calls } = publishing(draftRow(edited((l) => (l.items[0].pence = 2)), 4), null);
    const err = await publishRedBagDraft(4, WHO).catch((e) => e);
    expect(err.reason).toBe("invalid");
    expect(err.problems[0].message).toBe("A price must be between 10p and £500.");
    expect(sqls(calls).some((s) => /^UPDATE red_bag_lists/.test(s))).toBe(false);
    expect(audits(calls)).toEqual([]);
  });

  it("publishes nothing if the audit row cannot be written", async () => {
    const { calls } = useClient(
      holding(draftRow(edited(), 4), null, (sql) => {
        if (/^\s*UPDATE red_bag_lists/.test(sql)) return { rows: [publishedRow(9, edited())] };
        if (/INSERT INTO audit_log/.test(sql)) return new Error("audit down");
        return undefined;
      }),
    );
    await expect(publishRedBagDraft(4, WHO)).rejects.toThrow("audit down");
    expect(rolledBack(calls)).toBe(true);
    expect(committed(calls)).toBe(false);
  });
});

describe("throwing the draft away", () => {
  it("removes the draft and audits it with what was dropped", async () => {
    const { calls } = useClient(holding(draftRow(edited(), 4), null));
    await discardRedBagDraft(4, WHO);
    const del = calls.find(([sql]) => /^\s*DELETE FROM red_bag_lists/.test(sql))!;
    expect(del[0]).toMatch(/status = 'draft'/);
    expect(del[1]).toEqual([9]);
    expect(audits(calls)).toEqual([["admin:jodie@nbcc.test", "red_bag.draft_thrown_away", "red_bag_list", 9, { summary: "Toy £15 \u2192 £12", changes: ["Toy £15 \u2192 £12"] }]]);
    expect(committed(calls)).toBe(true);
  });

  it("refuses a stale stamp, and keeps the draft", async () => {
    const { calls } = useClient(holding(draftRow(edited(), 5), null));
    await expect(discardRedBagDraft(4, WHO)).rejects.toMatchObject({ reason: "stale" });
    expect(sqls(calls).some((s) => /^DELETE/.test(s))).toBe(false);
    expect(audits(calls)).toEqual([]);
  });

  it("refuses when there is no draft", async () => {
    useClient(holding(null, null));
    await expect(discardRedBagDraft(0, WHO)).rejects.toMatchObject({ reason: "stale" });
  });

  it("never touches a published list", async () => {
    const { calls } = useClient(holding(draftRow(edited(), 4), publishedRow(4, edited())));
    await discardRedBagDraft(4, WHO);
    for (const s of sqls(calls).filter((x) => /^(DELETE|UPDATE)/.test(x))) expect(s).toMatch(/status = 'draft'/);
  });
});

describe("putting an earlier list back as a draft", () => {
  it("copies an earlier published list into a new draft, and audits it", async () => {
    const old = publishedRow(2, edited((l) => (l.items[0].pence = 900)));
    const { calls } = useClient(holding(null, publishedRow(4, edited()), (sql, params) => (/WHERE id = \$1/.test(sql) && /^\s*SELECT/.test(sql) ? { rows: params[0] === 2 ? [old] : [] } : undefined)));
    const draft = await restoreRedBagList(2, { version: 0, publishedId: 4 }, WHO);
    expect(draft.version).toBe(1);
    const insert = calls.find(([sql]) => /INSERT INTO red_bag_lists/.test(sql))!;
    expect(JSON.parse(String(insert[1][0])).items[0].pence).toBe(900);
    expect(insert[1]).toContain(2);
    expect(audits(calls)).toEqual([["admin:jodie@nbcc.test", "red_bag.list_put_back", "red_bag_list", 12, { from: 2 }]]);
    // The website is untouched: it is a draft like any other.
    expect(sqls(calls).some((s) => /status = 'published'/.test(s) && /^(UPDATE|DELETE)/.test(s))).toBe(false);
  });

  it("copies the original list, which is in the code and not the table", async () => {
    const { calls } = useClient(holding(null, publishedRow(4, edited())));
    await restoreRedBagList("original", { version: 0, publishedId: 4 }, WHO);
    const insert = calls.find(([sql]) => /INSERT INTO red_bag_lists/.test(sql))!;
    expect(L.same(JSON.parse(String(insert[1][0])), L.builtIn())).toBe(true);
    expect(insert[1]).toContain(true);
    expect(audits(calls)[0][4]).toEqual({ from: "original" });
  });

  it("replaces the draft there is, when the stamp is right", async () => {
    const { calls } = useClient(holding(draftRow(edited(), 4), publishedRow(4, edited()), (sql) => (/^\s*UPDATE red_bag_lists/.test(sql) ? { rows: [draftRow(L.builtIn(), 5)] } : undefined)));
    const draft = await restoreRedBagList("original", { version: 4, publishedId: 4 }, WHO);
    expect(draft.version).toBe(5);
    expect(sqls(calls).find((s) => /^UPDATE red_bag_lists/.test(s))).toMatch(/status = 'draft'/);
  });

  it("refuses a stale stamp, and leaves the draft as it was", async () => {
    const { calls } = useClient(holding(draftRow(edited(), 5), null));
    await expect(restoreRedBagList("original", { version: 4, publishedId: null }, WHO)).rejects.toMatchObject({ reason: "stale" });
    expect(sqls(calls).some((s) => /^(UPDATE|INSERT INTO) red_bag_lists/.test(s))).toBe(false);
  });

  it("refuses a version that is not there, or is only a draft", async () => {
    useClient(holding(null, null, (sql) => (/WHERE id = \$1/.test(sql) ? { rows: [] } : undefined)));
    await expect(restoreRedBagList(77, { version: 0, publishedId: null }, WHO)).rejects.toMatchObject({ reason: "not_found" });
  });
});
