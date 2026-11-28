import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Workshop drop-offs (docs/superpowers/specs/2026-11-28-workshop-dropoffs-design.md): the table, its
// storage, and the newsletter's new consent source. Every name and address here is invented.

const query = vi.fn();
vi.mock("../../src/db/pool", () => ({ pool: { query: (...a: unknown[]) => query(...a) } }));

import { insertDropOff, listDropOffs, removeDropOff } from "../../src/db/workshop-dropoffs";
import { shouldSendWelcome } from "../../src/newsletter/welcome";

const ROOT = resolve(__dirname, "../..");
const migration = readFileSync(resolve(ROOT, "migrations/1791200000500_workshop-dropoffs.js"), "utf8");
const up = migration.slice(migration.indexOf("exports.up"), migration.indexOf("exports.down"));
const down = migration.slice(migration.indexOf("exports.down"));

beforeEach(() => query.mockReset());

describe("the workshop drop-offs migration", () => {
  it("creates workshop_dropoffs with every field the form sends", () => {
    expect(up).toContain('createTable(\n    "workshop_dropoffs"');
    for (const col of ["name", "email", "brought", "group_name", "phone", "newsletter", "created_at"]) expect(up).toContain(`${col}:`);
  });

  it("widens the consent source check to take 'workshop', and down puts the elf list back", () => {
    expect(up).toContain("consent_source IN ('footer', 'import', 'admin', 'fundraise', 'elf', 'workshop')");
    expect(down).toContain("consent_source IN ('footer', 'import', 'admin', 'fundraise', 'elf')");
  });

  it("is additive: nothing dropped or renamed in the up apart from the check it widens", () => {
    expect(up).not.toMatch(/dropColumn|dropTable|renameColumn|alterColumn/);
  });

  it("sorts last among the migrations", async () => {
    const { readdirSync } = await import("node:fs");
    const all = readdirSync(resolve(ROOT, "migrations")).filter((f) => f.endsWith(".js")).sort();
    expect(all[all.length - 1]).toBe("1791200000500_workshop-dropoffs.js");
  });
});

describe("storage", () => {
  it("saves the six values in order and gives back the new id", async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 7 }] });
    const id = await insertDropOff({ name: "Robin Example", email: "robin@example.com", brought: "Selection boxes", groupName: "Church group", phone: null, newsletter: true });
    expect(id).toBe(7);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("INSERT INTO workshop_dropoffs");
    expect(params).toEqual(["Robin Example", "robin@example.com", "Selection boxes", "Church group", null, true]);
  });

  it("lists newest first, with the latest gift in kind letter sent to the same email since", async () => {
    query.mockResolvedValueOnce({
      rows: [{ id: 2, name: "Robin Example", email: "robin@example.com", brought: "Hats", group_name: null, phone: null, newsletter: false, created_at: new Date("2026-11-28T10:00:00Z"), letter_sent_at: null }],
    });
    const rows = await listDropOffs();
    const [sql] = query.mock.calls[0];
    expect(sql).toContain("ORDER BY d.created_at DESC");
    expect(sql).toContain("lower(t.recipient_email) = lower(d.email)");
    expect(sql).toContain("t.gift_type = 'in_kind'");
    expect(sql).toContain("t.sent_at >= d.created_at");
    expect(rows[0]).toEqual({ id: 2, name: "Robin Example", email: "robin@example.com", brought: "Hats", groupName: null, phone: null, newsletter: false, createdAt: new Date("2026-11-28T10:00:00Z"), letterSentAt: null });
  });

  it("removes one by id, and says whether there was one", async () => {
    query.mockResolvedValueOnce({ rowCount: 1 });
    expect(await removeDropOff(2)).toBe(true);
    query.mockResolvedValueOnce({ rowCount: 0 });
    expect(await removeDropOff(99)).toBe(false);
  });
});

describe("the newsletter", () => {
  it("sends no separate welcome to someone who joined at the workshop: their thank you says so", () => {
    expect(shouldSendWelcome("workshop")).toBe(false);
  });
});
