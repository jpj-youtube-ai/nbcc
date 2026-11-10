import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));
vi.mock("../../src/config", () => ({ config: { NODE_ENV: "test" } }));

import { pool } from "../../src/db/pool";
import {
  SLEIGH_WINDOW_SQL,
  TAG_CARD_SLEIGH_SQL,
  RESORT_TAG_SQL,
  RESORT_UNTAG_SQL,
  LIST_NIGHTS_SQL,
  SLEIGH_TOTALS_SQL,
  sleighWindow,
  inSleighWindow,
  listNights,
  getSleighSettings,
  saveNight,
  saveSleighSettings,
  sleighTotals,
  readSleighTotalsNow,
  forgetSleighTotals,
  findOrCreateSleighCode,
  PUBLIC_NIGHTS_SQL,
  publicNights,
  publicSettings,
} from "../../src/db/sleigh";
import type { SleighNight } from "../../src/sleigh/model";

// The Kilmarnock Santa Sleigh's data (src/db/sleigh.ts). DB-free: the SQL is checked as text and the
// pool is a stand-in; the statements themselves run against Postgres in features/admin-sleigh.feature.

const night = (nightOn: string, startsAt: string | null = null, endsAt: string | null = null): SleighNight => ({ id: 1, nightOn, areas: "New Farm", startsAt, endsAt });
const flat = (sql: string) => sql.replace(/\s+/g, " ").trim();
const query = pool.query as unknown as ReturnType<typeof vi.fn>;
const connect = pool.connect as unknown as ReturnType<typeof vi.fn>;

describe("a night's card machine window", () => {
  it("runs from 4pm to 10pm UK time while the night's times are to be confirmed", () => {
    expect(sleighWindow(night("2026-12-15"))).toEqual({ from: "2026-12-15 16:00", to: "2026-12-15 22:00" });
  });

  it("runs from an hour before the start to an hour after the finish once both are set", () => {
    expect(sleighWindow(night("2026-12-15", "18:00", "20:30"))).toEqual({ from: "2026-12-15 17:00", to: "2026-12-15 21:30" });
  });

  it("goes past midnight into the next day when the finish is late", () => {
    expect(sleighWindow(night("2026-12-31", "22:00", "23:30"))).toEqual({ from: "2026-12-31 21:00", to: "2027-01-01 00:30" });
  });

  // Review focus 1: a tap at 23:30 on a night whose times are TBC is not a sleigh gift.
  it("does not hold a tap at 23:30 on a night whose times are to be confirmed", () => {
    const nights = [night("2026-12-15")];
    expect(inSleighWindow("2026-12-15 23:30", nights)).toBe(false);
    expect(inSleighWindow("2026-12-15 22:00", nights)).toBe(true);
    expect(inSleighWindow("2026-12-15 16:00", nights)).toBe(true);
    expect(inSleighWindow("2026-12-15 15:59", nights)).toBe(false);
    expect(inSleighWindow("2026-12-16 18:00", nights)).toBe(false);
  });

  it("is the same window in the SQL: 5pm and 9pm when TBC, an hour either side, in UK time", () => {
    expect(SLEIGH_WINDOW_SQL).toContain("'17:00'");
    expect(SLEIGH_WINDOW_SQL).toContain("'21:00'");
    expect(SLEIGH_WINDOW_SQL).toContain("interval '1 hour'");
    expect(SLEIGH_WINDOW_SQL).toContain("d.created_at AT TIME ZONE 'Europe/London'");
    expect(flat(SLEIGH_WINDOW_SQL)).toContain("COALESCE(n.starts_at, time '17:00') - interval '1 hour'");
    expect(flat(SLEIGH_WINDOW_SQL)).toContain("COALESCE(n.ends_at, time '21:00') + interval '1 hour'");
    expect(flat(SLEIGH_WINDOW_SQL)).toMatch(/^EXISTS \(SELECT 1 FROM sleigh_nights n WHERE /);
  });
});

describe("tagging a card machine tap", () => {
  it("tags the one charge, only when it has no source, only in person, only inside a night's window", () => {
    const sql = flat(TAG_CARD_SLEIGH_SQL);
    expect(sql).toMatch(/^UPDATE donations d SET source = 'santa_sleigh' WHERE /);
    expect(sql).toContain("d.stripe_charge_id = $1");
    expect(sql).toContain("d.source IS NULL");
    expect(sql).toContain("d.payment_channel = 'in_person'");
    expect(sql).toContain(flat(SLEIGH_WINDOW_SQL));
  });
});

// Review focus 2: a night's times edited after gifts came in re-sorts them both ways.
describe("re-sorting card machine taps after a night is saved", () => {
  it("untags sleigh card taps now outside every window, and never an online gift", () => {
    const sql = flat(RESORT_UNTAG_SQL);
    expect(sql).toMatch(/^UPDATE donations d SET source = NULL WHERE /);
    expect(sql).toContain("d.source = 'santa_sleigh'");
    expect(sql).toContain("d.payment_channel = 'in_person'");
    expect(sql).toContain(`NOT ${flat(SLEIGH_WINDOW_SQL)}`);
  });

  it("tags untagged card taps now inside a window, only from the start of the year's count", () => {
    const sql = flat(RESORT_TAG_SQL);
    expect(sql).toMatch(/^UPDATE donations d SET source = 'santa_sleigh' WHERE /);
    expect(sql).toContain("d.source IS NULL");
    expect(sql).toContain("d.payment_channel = 'in_person'");
    expect(sql).toContain("season_from");
    expect(sql).toContain(`AND ${flat(SLEIGH_WINDOW_SQL)}`);
  });

  it("runs both, in the same transaction as the night and its audit row", async () => {
    const said: Array<[string, unknown[] | undefined]> = [];
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        said.push([sql, params]);
        if (/UPDATE sleigh_nights/.test(sql)) return { rows: [{ id: 3, night_on: "2026-12-17", areas: "Bellfield & Shortlees", starts_at: "18:00", ends_at: "20:30", bucket_pence: 4500 }] };
        return { rows: [], rowCount: 2 };
      }),
      release: vi.fn(),
    };
    connect.mockResolvedValue(client);
    const saved = await saveNight(3, { startsAt: "18:00", endsAt: "20:30" }, "staff@example.com");
    expect(saved).toEqual({ id: 3, nightOn: "2026-12-17", areas: "Bellfield & Shortlees", startsAt: "18:00", endsAt: "20:30", bucketPence: 4500 });
    const kinds = said.map(([sql]) => (sql === RESORT_UNTAG_SQL ? "untag" : sql === RESORT_TAG_SQL ? "tag" : /audit_log/.test(sql) ? "audit" : sql.trim().split(/\s+/).slice(0, 2).join(" ")));
    expect(kinds).toEqual(["BEGIN", "UPDATE sleigh_nights", "untag", "tag", "audit", "COMMIT"]);
    const update = said[1];
    expect(flat(update[0])).toContain("SET starts_at = $2, ends_at = $3, updated_at = now() WHERE id = $1");
    expect(update[1]).toEqual([3, "18:00", "20:30"]);
    const audit = said.find(([sql]) => /audit_log/.test(sql))!;
    expect(JSON.stringify(audit[1])).toContain("sleigh_night.saved");
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});

describe("saving a night", () => {
  beforeEach(() => connect.mockReset());

  it("writes only what it is given, areas tidied, and times may be cleared", async () => {
    const said: Array<[string, unknown[] | undefined]> = [];
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        said.push([sql, params]);
        return /UPDATE sleigh_nights/.test(sql) ? { rows: [{ id: 1, night_on: "2026-12-15", areas: "New Farm Loch", starts_at: null, ends_at: null, bucket_pence: 12345 }] } : { rows: [] };
      }),
      release: vi.fn(),
    };
    connect.mockResolvedValue(client);
    await saveNight(1, { areas: "  New Farm   Loch ", startsAt: null, endsAt: null, bucketPence: 12345 }, "staff@example.com");
    const update = said.find(([sql]) => /UPDATE sleigh_nights/.test(sql))!;
    expect(flat(update[0])).toContain("SET areas = $2, starts_at = $3, ends_at = $4, bucket_pence = $5, updated_at = now() WHERE id = $1");
    expect(update[1]).toEqual([1, "New Farm Loch", null, null, 12345]);
  });

  it("answers null, writes no audit row and re-sorts nothing, for a night that is not there", async () => {
    const said: string[] = [];
    const client = { query: vi.fn(async (sql: string) => (said.push(sql), { rows: [] })), release: vi.fn() };
    connect.mockResolvedValue(client);
    expect(await saveNight(99, { areas: "Nowhere" }, "staff@example.com")).toBeNull();
    expect(said.some((s) => /audit_log/.test(s))).toBe(false);
    expect(said).not.toContain(RESORT_TAG_SQL);
    expect(said.some((s) => /ROLLBACK/.test(s))).toBe(true);
  });

  it("forgets the cached total, so a new bucket figure shows within the minute", async () => {
    query.mockReset();
    forgetSleighTotals();
    query.mockResolvedValueOnce({ rows: [{ online_pence: "1000", card_pence: "0", bucket_pence: "0", gifts: "1" }] });
    expect((await sleighTotals())?.totalPence).toBe(1000);
    const client = {
      query: vi.fn(async (sql: string) => (/UPDATE sleigh_nights/.test(sql) ? { rows: [{ id: 1, night_on: "2026-12-15", areas: "New Farm", starts_at: null, ends_at: null, bucket_pence: 5000 }] } : { rows: [] })),
      release: vi.fn(),
    };
    connect.mockResolvedValue(client);
    await saveNight(1, { bucketPence: 5000 }, "staff@example.com");
    query.mockResolvedValueOnce({ rows: [{ online_pence: "1000", card_pence: "0", bucket_pence: "5000", gifts: "1" }] });
    expect((await sleighTotals())?.totalPence).toBe(6000);
  });
});

describe("the list of nights", () => {
  beforeEach(() => query.mockReset());

  it("reads each night in date order with its card machine total, using the same window", async () => {
    expect(flat(LIST_NIGHTS_SQL)).toContain("ORDER BY n.night_on");
    expect(flat(LIST_NIGHTS_SQL)).toContain("d.source = 'santa_sleigh'");
    expect(flat(LIST_NIGHTS_SQL)).toContain("d.payment_channel = 'in_person'");
    expect(flat(LIST_NIGHTS_SQL)).toContain("d.payment_status = 'paid'");
    expect(flat(LIST_NIGHTS_SQL)).toContain("GREATEST(d.amount_pence - d.refunded_amount_pence, 0)");
    expect(flat(LIST_NIGHTS_SQL)).toContain("COALESCE(n.starts_at, time '17:00') - interval '1 hour'");
    query.mockResolvedValueOnce({
      rows: [{ id: 2, night_on: "2026-12-16", areas: "Wardneuk, Onthank & Altonhill", starts_at: "18:00", ends_at: "20:30", bucket_pence: 7000, card_pence: "2500", card_gifts: "3" }],
    });
    expect(await listNights()).toEqual([
      {
        id: 2,
        nightOn: "2026-12-16",
        areas: "Wardneuk, Onthank & Altonhill",
        startsAt: "18:00",
        endsAt: "20:30",
        bucketPence: 7000,
        cardPence: 2500,
        cardGifts: 3,
        window: { from: "2026-12-16 17:00", to: "2026-12-16 21:30" },
      },
    ]);
  });
});

describe("the settings", () => {
  beforeEach(() => {
    query.mockReset();
    connect.mockReset();
  });

  it("are read from the one row", async () => {
    query.mockResolvedValueOnce({ rows: [{ season_from: "2026-11-01", off_on: "2027-01-31" }] });
    expect(await getSleighSettings()).toEqual({ seasonFrom: "2026-11-01", offOn: "2027-01-31" });
  });

  it("save the switch off day with an audit row", async () => {
    const said: Array<[string, unknown[] | undefined]> = [];
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        said.push([sql, params]);
        return /UPDATE sleigh_settings/.test(sql) ? { rows: [{ season_from: "2026-11-01", off_on: "2027-02-14" }] } : { rows: [] };
      }),
      release: vi.fn(),
    };
    connect.mockResolvedValue(client);
    expect(await saveSleighSettings({ offOn: "2027-02-14" }, "staff@example.com")).toEqual({ seasonFrom: "2026-11-01", offOn: "2027-02-14" });
    expect(said.find(([sql]) => /UPDATE sleigh_settings/.test(sql))?.[1]).toEqual(["2027-02-14"]);
    expect(JSON.stringify(said.find(([sql]) => /audit_log/.test(sql))?.[1])).toContain("sleigh_settings.saved");
  });
});

describe("the year's total", () => {
  beforeEach(() => {
    query.mockReset();
    forgetSleighTotals();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("is net paid santa_sleigh gifts since the start of the year's count, online and card apart, plus the bucket cash", () => {
    const sql = flat(SLEIGH_TOTALS_SQL);
    expect(sql).toContain("d.source = 'santa_sleigh'");
    expect(sql).toContain("d.payment_status = 'paid'");
    expect(sql).toContain("GREATEST(d.amount_pence - d.refunded_amount_pence, 0)");
    expect(sql).toContain("season_from");
    expect(sql).toContain("bucket_pence");
    expect(sql).toContain("d.payment_channel = 'in_person'");
  });

  it("adds the three parts together", async () => {
    query.mockResolvedValueOnce({ rows: [{ online_pence: "5000", card_pence: "2500", bucket_pence: "10000", gifts: "6" }] });
    expect(await sleighTotals()).toEqual({ onlinePence: 5000, cardPence: 2500, bucketPence: 10000, totalPence: 17500, gifts: 6 });
  });

  it("is read once a minute for the page, not on every visit", async () => {
    query.mockResolvedValue({ rows: [{ online_pence: "100", card_pence: "0", bucket_pence: "0", gifts: "1" }] });
    await sleighTotals();
    await sleighTotals();
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("is null when it has never been read and the database is away, and never throws", async () => {
    query.mockRejectedValue(new Error("the database is away"));
    expect(await sleighTotals()).toBeNull();
  });

  it("keeps the last good total when a later read fails", async () => {
    vi.useFakeTimers();
    try {
      query.mockResolvedValueOnce({ rows: [{ online_pence: "100", card_pence: "200", bucket_pence: "300", gifts: "2" }] });
      expect((await sleighTotals())?.totalPence).toBe(600);
      vi.advanceTimersByTime(61_000);
      query.mockRejectedValueOnce(new Error("the database is away"));
      expect((await sleighTotals())?.totalPence).toBe(600);
    } finally {
      vi.useRealTimers();
    }
  });

  it("is read afresh for the admin, which may throw, and leaves the page's cached total alone", async () => {
    query.mockResolvedValueOnce({ rows: [{ online_pence: "100", card_pence: "0", bucket_pence: "0", gifts: "1" }] });
    expect((await sleighTotals())?.totalPence).toBe(100);
    query.mockResolvedValueOnce({ rows: [{ online_pence: "900", card_pence: "0", bucket_pence: "0", gifts: "2" }] });
    expect((await readSleighTotalsNow()).totalPence).toBe(900);
    expect((await sleighTotals())?.totalPence).toBe(100);
    query.mockRejectedValueOnce(new Error("the database is away"));
    await expect(readSleighTotalsNow()).rejects.toThrow();
  });
});

// The public page's nights and settings: a QR scan on a sleigh night must never wait on a slow or
// unreachable database (final review, 10 November 2026). A light read, cached a minute, given up on
// after a moment, the last good value kept.
describe("the public page's reads", () => {
  beforeEach(() => {
    query.mockReset();
    forgetSleighTotals();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("reads the nights without the donations join the admin needs", () => {
    const sql = flat(PUBLIC_NIGHTS_SQL);
    expect(sql).not.toMatch(/donations/i);
    expect(sql).toContain("ORDER BY night_on");
  });

  it("reads the nights and the settings once a minute, not on every visit", async () => {
    query.mockImplementation(async (sql: string) =>
      /sleigh_settings/.test(sql)
        ? { rows: [{ season_from: "2026-11-01", off_on: "2027-01-31" }] }
        : { rows: [{ id: 1, night_on: "2026-12-15", areas: "New Farm", starts_at: null, ends_at: null, bucket_pence: 0 }] },
    );
    expect(await publicNights()).toEqual([{ id: 1, nightOn: "2026-12-15", areas: "New Farm", startsAt: null, endsAt: null }]);
    await publicNights();
    expect(await publicSettings()).toEqual({ seasonFrom: "2026-11-01", offOn: "2027-01-31" });
    await publicSettings();
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("gives up after a moment on a database that does not answer: no nights, and the page never switched off", async () => {
    vi.useFakeTimers();
    try {
      query.mockImplementation(() => new Promise(() => {}));
      const nights = publicNights();
      const settings = publicSettings();
      await vi.advanceTimersByTimeAsync(1600);
      expect(await nights).toEqual([]);
      expect(await settings).toEqual({ seasonFrom: "2026-11-01", offOn: "2027-01-31" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("is read afresh after a save", async () => {
    query.mockResolvedValue({ rows: [] });
    await publicNights();
    forgetSleighTotals();
    await publicNights();
    expect(query).toHaveBeenCalledTimes(2);
  });
});

// The named QR codes the sleigh hands out and prints (Admin > QR codes counts their scans). One code per
// name, found again each time, so a code printed once keeps working and keeps counting.
describe("the sleigh's named QR codes", () => {
  beforeEach(() => {
    query.mockReset();
    connect.mockReset();
  });
  const record = (id: number, name: string) => ({ id, name, target: "/sleigh", hidden: false, created_at: "2026-11-10T20:00:00Z", updated_by: "admin:staff@example.com", updated_at: "2026-11-10T20:00:00Z" });

  it("finds the code by its name and the page, and makes nothing new", async () => {
    query.mockResolvedValueOnce({ rows: [record(42, "Santa Sleigh hand-outs")] });
    expect(await findOrCreateSleighCode("Santa Sleigh hand-outs", "admin:staff@example.com")).toBe(42);
    const [sql, params] = query.mock.calls[0];
    expect(flat(String(sql))).toContain("FROM qr_codes WHERE name = $1 AND target = $2 ORDER BY id ASC LIMIT 1");
    expect(params).toEqual(["Santa Sleigh hand-outs", "/sleigh"]);
    expect(connect).not.toHaveBeenCalled();
  });

  it("makes it, going to /sleigh, with who asked, when there is none yet", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const said: Array<[string, unknown[] | undefined]> = [];
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => (said.push([sql, params]), /INSERT INTO qr_codes/.test(sql) ? { rows: [record(43, String(params?.[0]))] } : { rows: [] })),
      release: vi.fn(),
    };
    connect.mockResolvedValue(client);
    expect(await findOrCreateSleighCode("Santa Sleigh poster: every night", "admin:staff@example.com")).toBe(43);
    expect(said.find(([sql]) => /INSERT INTO qr_codes/.test(sql))?.[1]).toEqual(["Santa Sleigh poster: every night", "/sleigh", "admin:staff@example.com"]);
  });

  it("cuts a long name to what a code's name may hold, tidied", async () => {
    query.mockResolvedValueOnce({ rows: [record(44, "x")] });
    await findOrCreateSleighCode(`  Santa Sleigh poster:   ${"Wardneuk, Onthank & Altonhill ".repeat(4)}`, "admin:staff@example.com");
    const name = String(query.mock.calls[0][1][0]);
    expect(name.length).toBeLessThanOrEqual(80);
    expect(name.startsWith("Santa Sleigh poster: Wardneuk")).toBe(true);
    expect(name).not.toMatch(/\s{2}|\s$/);
  });
});
