import { describe, it, expect, vi, beforeEach } from "vitest";

// Welcome packs, the SQL side, against a mocked pool (no database). A change locks its fundraiser,
// reads the pack as stored, applies the pure rules (src/fundraising/welcome-pack.ts), writes the
// pack and its item, and records it in audit_log, all in one transaction. Every name is invented.

const { query, connect } = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn() }));
vi.mock("../../src/db/pool", () => ({ pool: { query, connect } }));
vi.mock("../../src/config", () => ({ config: { NODE_ENV: "test" } }));

import { PackError, changePack, lastSignerFor, listPacks, listPosterSizes, sentPackIds } from "../../src/db/welcome-packs";

const fundraiserRow = (over: Record<string, unknown> = {}) => ({
  id: 9, slug: "rw", path: "raising", kind: "walk", title: "Robin's Walk", description: "", event_date: null,
  start_time: null, venue: "", town: "", target_pence: 50000, public: true, status: "approved", organiser_name: "Robin Example",
  organiser_email: "robin@example.com", organiser_phone: "07700 900456", social_link: null, social_ok: false,
  wants: { posterCount: 12 }, post_address: null, post_line1: "1 Example Road", post_town: "Exampleton", post_postcode: "EX1 1EX",
  newsletter_ok: false, image_src: null, declined_reason: null, created_at: "2026-10-01T10:00:00Z",
  approved_at: "2026-10-02T10:00:00Z", approved_by: "admin:fern@example.com", updated_at: "2026-10-02T10:00:00Z", updated_by: null,
  first_name: "Robin", last_name: "Example", is_sporting: false, tshirt_size: null, in_memory: false, team_id: null,
  ...over,
});
const packRow = (over: Record<string, unknown> = {}) => ({ id: 4, fundraiser_id: 9, sent_at: null, sent_by: null, signer: null, signer_role: null, ...over });
const itemRow = (key: string, over: Record<string, unknown> = {}) => ({
  pack_id: 4, fundraiser_id: 9, key, label: key, quantity: null, ticked_at: new Date("2026-10-03T10:00:00Z"), ticked_by: "admin:fern@example.com", skipped_reason: null, ...over,
});

type Answer = (sql: string, params: unknown[]) => unknown;
function useClient(answer: Answer) {
  const calls: Array<[string, unknown[]]> = [];
  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push([sql, params]);
      return answer(sql, params) ?? { rows: [] };
    }),
    release: vi.fn(),
  };
  connect.mockResolvedValue(client);
  return { calls, client };
}
const find = (calls: Array<[string, unknown[]]>, re: RegExp) => calls.find((c) => re.test(c[0]));
const audits = (calls: Array<[string, unknown[]]>) => calls.filter((c) => /INSERT INTO audit_log/.test(c[0])).map((c) => c[1]);

/** A fake database holding one fundraiser, and its pack and items if any. */
function db(o: { fundraiser?: Record<string, unknown> | null; pack?: Record<string, unknown> | null; items?: Record<string, unknown>[]; sizes?: Record<string, unknown> | null } = {}) {
  return useClient((sql) => {
    if (/FROM fundraisers f\s+WHERE f.id = \$1 FOR UPDATE/.test(sql)) return { rows: o.fundraiser === null ? [] : [o.fundraiser ?? fundraiserRow()] };
    if (/INSERT INTO welcome_packs/.test(sql)) return { rows: [{ id: 4 }] };
    if (/FROM welcome_packs WHERE fundraiser_id = \$1/.test(sql)) return { rows: o.pack ? [o.pack] : [] };
    if (/FROM welcome_pack_items/.test(sql)) return { rows: o.items ?? [] };
    if (/fundraiser.print_requested/.test(sql)) return { rows: o.sizes ? [o.sizes] : [] };
    return { rows: [] };
  });
}

beforeEach(() => {
  query.mockReset().mockResolvedValue({ rows: [] });
  connect.mockReset();
});

describe("reading", () => {
  it("reads every pack with its items, by fundraiser", async () => {
    query.mockImplementation(async (sql: string) => {
      if (/FROM welcome_pack_items/.test(sql)) return { rows: [itemRow("letter", { label: "Welcome letter" })] };
      return { rows: [packRow({ sent_at: new Date("2026-10-04T09:00:00Z"), sent_by: "admin:fern@example.com", signer: "Fern Example", signer_role: "Volunteer" })] };
    });
    const packs = await listPacks();
    expect(packs.get(9)).toEqual({
      sentAt: "2026-10-04T09:00:00.000Z",
      sentBy: "admin:fern@example.com",
      signer: "Fern Example",
      signerRole: "Volunteer",
      items: [{ key: "letter", label: "Welcome letter", quantity: null, tickedAt: "2026-10-03T10:00:00.000Z", tickedBy: "admin:fern@example.com", skippedReason: null }],
    });
  });

  it("reads the poster sizes of each fundraiser's last ask to print", async () => {
    query.mockResolvedValue({ rows: [{ fundraiser_id: 9, a4: "10", a3: "2" }, { fundraiser_id: 11, a4: null, a3: "x" }] });
    const sizes = await listPosterSizes();
    expect(query.mock.calls[0][0]).toMatch(/DISTINCT ON \(entity_id\)/);
    expect(query.mock.calls[0][0]).toMatch(/fundraiser.print_requested/);
    expect(sizes.get(9)).toEqual({ a4: 10, a3: 2 });
    expect(sizes.get(11)).toEqual({ a4: 0, a3: 0 });
  });

  it("reads which fundraisers' packs are sent", async () => {
    query.mockResolvedValue({ rows: [{ fundraiser_id: 9 }, { fundraiser_id: 12 }] });
    expect(await sentPackIds()).toEqual(new Set([9, 12]));
    expect(query.mock.calls[0][0]).toMatch(/sent_at IS NOT NULL/);
  });

  it("remembers who a staff member last chose to sign a letter", async () => {
    query.mockResolvedValue({ rows: [{ signer: "Fern Example", signer_role: null }] });
    expect(await lastSignerFor("admin:fern@example.com")).toEqual({ name: "Fern Example", role: null });
    expect(query.mock.calls[0][0]).toMatch(/signer_by = \$1/);
    expect(query.mock.calls[0][0]).toMatch(/ORDER BY updated_at DESC/);
    query.mockResolvedValue({ rows: [] });
    expect(await lastSignerFor("admin:new@example.com")).toBeNull();
  });
});

describe("changing", () => {
  it("ticks a thing: the pack is made, the item kept with what it was called and how many, and it is in audit_log", async () => {
    const { calls } = db({ sizes: { a4: "10", a3: "2" } });
    const out = await changePack(9, { action: "tick", key: "posters_a4" }, "admin:fern@example.com");
    expect(calls[0][0]).toBe("BEGIN");
    expect(find(calls, /FROM fundraisers f\s+WHERE f.id = \$1 FOR UPDATE/)).toBeTruthy();
    expect(find(calls, /INSERT INTO welcome_packs/)![1]).toEqual([9]);
    const item = find(calls, /INSERT INTO welcome_pack_items/)!;
    expect(item[0]).toMatch(/ON CONFLICT \(pack_id, key\) DO UPDATE/);
    expect(item[1]).toEqual([4, "posters_a4", "A4 posters", 10, true, "admin:fern@example.com", null]);
    const [audit] = audits(calls);
    expect(audit.slice(0, 4)).toEqual(["admin:fern@example.com", "fundraiser.pack_updated", "fundraiser", 9]);
    expect(audit[4]).toMatchObject({ action: "tick", key: "posters_a4", words: "Welcome pack: 10 A4 posters ticked" });
    expect(calls[calls.length - 1][0]).toBe("COMMIT");
    expect(out.words).toBe("Welcome pack: 10 A4 posters ticked");
  });

  it("leaves a thing out with its reason, and no tick", async () => {
    const { calls } = db();
    await changePack(9, { action: "skip", key: "sponsor_form", reason: "They have one" }, "admin:fern@example.com");
    expect(find(calls, /INSERT INTO welcome_pack_items/)![1]).toEqual([4, "sponsor_form", "Sponsor form", null, false, "admin:fern@example.com", "They have one"]);
  });

  it("unticks by removing the item's row", async () => {
    const { calls } = db({ pack: packRow(), items: [itemRow("letter")] });
    await changePack(9, { action: "untick", key: "letter" }, "admin:fern@example.com");
    expect(find(calls, /DELETE FROM welcome_pack_items WHERE pack_id = \$1 AND key = \$2/)![1]).toEqual([4, "letter"]);
  });

  it("marks the pack sent, with who, once everything is ticked", async () => {
    const { calls } = db({ pack: packRow(), items: [itemRow("letter"), itemRow("posters_a4", { quantity: 12 }), itemRow("sponsor_form")] });
    const out = await changePack(9, { action: "send" }, "admin:fern@example.com");
    const sent = find(calls, /UPDATE welcome_packs SET sent_at = now\(\), sent_by = \$2/)!;
    expect(sent[1]).toEqual([4, "admin:fern@example.com"]);
    expect(audits(calls)[0][4]).toMatchObject({ action: "send", words: "Welcome pack sent" });
    expect(out.words).toBe("Welcome pack sent");
  });

  it("refuses Pack sent before everything is ticked, writing nothing", async () => {
    const { calls } = db({ pack: packRow(), items: [itemRow("letter")] });
    await expect(changePack(9, { action: "send" }, "admin:fern@example.com")).rejects.toMatchObject({ reason: "conflict" });
    expect(find(calls, /UPDATE welcome_packs|INSERT INTO/)).toBeUndefined();
    expect(calls[calls.length - 1][0]).toBe("ROLLBACK");
  });

  it("undoes Sent", async () => {
    const { calls } = db({ pack: packRow({ sent_at: new Date("2026-10-04T09:00:00Z"), sent_by: "admin:fern@example.com" }), items: [itemRow("letter"), itemRow("posters_a4", { quantity: 12 }), itemRow("sponsor_form")] });
    await changePack(9, { action: "undo" }, "admin:ash@example.com");
    expect(find(calls, /UPDATE welcome_packs SET sent_at = NULL, sent_by = NULL/)![1]).toEqual([4]);
    expect(audits(calls)[0][4]).toMatchObject({ action: "undo", was: { sentAt: "2026-10-04T09:00:00.000Z", sentBy: "admin:fern@example.com" } });
  });

  it("keeps who signs the letter, and which staff member chose them", async () => {
    const { calls } = db();
    await changePack(9, { action: "signer", name: "Fern Example", role: "Volunteer" }, "admin:ash@example.com");
    expect(find(calls, /UPDATE welcome_packs SET signer = \$2, signer_role = \$3, signer_by = \$4/)![1]).toEqual([4, "Fern Example", "Volunteer", "admin:ash@example.com"]);
  });

  it("says when the fundraiser is gone, or has no pack", async () => {
    db({ fundraiser: null });
    await expect(changePack(9, { action: "send" }, "admin:fern@example.com")).rejects.toMatchObject({ reason: "not_found" });
    db({ fundraiser: fundraiserRow({ status: "new" }) });
    const err = await changePack(9, { action: "tick", key: "letter" }, "admin:fern@example.com").catch((e) => e);
    expect(err).toBeInstanceOf(PackError);
    expect(err.reason).toBe("no_pack");
  });
});
