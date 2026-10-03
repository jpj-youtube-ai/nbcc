import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Review of PR #650: the booker's phone number is deleted 90 days after the event, in the same purge
// and on the same date as guests' dietary and access details (src/ball/guests.ts, retentionDate),
// and the ticket terms say so. The database is mocked; the SQL is what is checked here.

const q = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../../src/db/pool", () => ({ pool: { query: q.query, connect: vi.fn() } }));

import { purgeExpiredGuests } from "../../src/db/ball";
import { retentionDate } from "../../src/ball/guests";

const ROOT = resolve(__dirname, "../..");

beforeEach(() => {
  q.query.mockReset();
  q.query.mockResolvedValue({ rowCount: 0, rows: [] });
});

describe("the post-event purge", () => {
  it("still deletes guest details past their date", async () => {
    await purgeExpiredGuests();
    const sql = q.query.mock.calls.map((c) => String(c[0]));
    expect(sql.some((s) => /DELETE FROM ball_guests WHERE expires_at <= now\(\)/.test(s))).toBe(true);
  });

  it("takes away every booker's phone number once the guest details' date has passed", async () => {
    await purgeExpiredGuests();
    const call = q.query.mock.calls.find((c) => /UPDATE ball_bookings/.test(String(c[0])));
    expect(call, "an UPDATE of ball_bookings").toBeTruthy();
    const sql = String(call![0]).replace(/\s+/g, " ");
    expect(sql).toContain("SET buyer_phone = NULL");
    expect(sql).toContain("buyer_phone IS NOT NULL");
    expect(sql).toMatch(/now\(\) >= \$1/);
    expect(call![1]).toEqual([retentionDate()]);
  });

  it("is ninety days after the event", () => {
    expect(retentionDate().toISOString().slice(0, 10)).toBe("2027-02-05");
  });
});

describe("the ticket terms", () => {
  it("say when the phone number is deleted", () => {
    const terms = readFileSync(resolve(ROOT, "ball-terms.html"), "utf8").replace(/\s+/g, " ");
    expect(terms).toContain("We delete your phone number 90 days after the event.");
  });
});
