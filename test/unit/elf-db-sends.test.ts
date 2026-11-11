import { describe, it, expect, vi, beforeEach } from "vitest";

// NBCC Elf Detective School wave 2: every timed send claimed once in elf_sends (src/db/elf-sends.ts).
// There is no local database, so these read the SQL and parameters each function sends; the BDD proves
// them against Postgres in CI. Every family here is invented.

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../../src/db/pool", () => ({ pool: { query } }));

import { claimSend, familiesStillToEmail, familiesToSweep, markSendFailed, markSent } from "../../src/db/elf-sends";

const sql = (n = 0) => String(query.mock.calls[n][0]).replace(/\s+/g, " ");

beforeEach(() => {
  query.mockReset();
});

describe("claiming a send", () => {
  it("inserts the claim, or retakes a failed one only when it is unsent, tried fewer than three times and ten minutes old", async () => {
    query.mockResolvedValue({ rows: [{ key: "2026-7:11" }], rowCount: 1 });
    expect(await claimSend("clue", "2026-7:11")).toBe(true);
    expect(sql()).toContain("INSERT INTO elf_sends (kind, key) VALUES ($1, $2)");
    expect(sql()).toContain("ON CONFLICT (kind, key) DO UPDATE SET claimed_at = now(), attempts = elf_sends.attempts + 1");
    expect(sql()).toContain("WHERE elf_sends.sent_at IS NULL AND elf_sends.attempts < 3 AND elf_sends.claimed_at < now() - interval '10 minutes'");
    expect(sql()).toContain("RETURNING key");
    expect(query.mock.calls[0][1]).toEqual(["clue", "2026-7:11"]);
  });

  // Two tasks ticking at the same second both ask; the database answers a row to only one of them.
  it("answers false when no row comes back: sent, given up, or another task's claim in flight", async () => {
    query.mockResolvedValue({ rows: [], rowCount: 0 });
    expect(await claimSend("clue", "2026-7:11")).toBe(false);
  });
});

describe("after a send", () => {
  it("marks it sent", async () => {
    query.mockResolvedValue({ rows: [], rowCount: 1 });
    await markSent("morning", "2026-12-07");
    expect(sql()).toContain("UPDATE elf_sends SET sent_at = now()");
    expect(sql()).toContain("WHERE kind = $1 AND key = $2");
    expect(query.mock.calls[0][1]).toEqual(["morning", "2026-12-07"]);
  });

  it("keeps a failure's message, cut short, and leaves the claim to be retried ten minutes on", async () => {
    query.mockResolvedValue({ rows: [], rowCount: 1 });
    await markSendFailed("clue", "2026-7:12", "SES refused: " + "x".repeat(2000));
    expect(sql()).toContain("UPDATE elf_sends SET last_error = $3");
    expect(sql()).not.toContain("sent_at");
    const params = query.mock.calls[0][1] as string[];
    expect(params.slice(0, 2)).toEqual(["clue", "2026-7:12"]);
    expect(params[2].startsWith("SES refused: ")).toBe(true);
    expect(params[2].length).toBeLessThanOrEqual(500);
  });
});

describe("the families still to get a door's clue email", () => {
  it("are the active families not removed, by id, skipping any whose send went, was given up or is in flight", async () => {
    query.mockResolvedValue({
      rows: [
        { id: 11, email: "sam.example@example.org", grown_up_name: "Sam Example" },
        { id: 12, email: "alex.example@example.org", grown_up_name: "Alex Example" },
      ],
    });
    expect(await familiesStillToEmail(2026, 7, 25)).toEqual([
      { familyId: 11, email: "sam.example@example.org", grownUpName: "Sam Example" },
      { familyId: 12, email: "alex.example@example.org", grownUpName: "Alex Example" },
    ]);
    const s = sql();
    expect(s).toContain("FROM elf_families f");
    expect(s).toContain("f.active");
    expect(s).toContain("f.removed_at IS NULL");
    expect(s).toContain("s.kind = 'clue'");
    expect(s).toContain("s.key = $1::text || ':' || f.id");
    expect(s).toContain("sent_at IS NOT NULL OR s.attempts >= 3 OR s.claimed_at > now() - interval '10 minutes'");
    expect(s).toContain("ORDER BY f.id");
    expect(s).toContain("LIMIT $2");
    expect(query.mock.calls[0][1]).toEqual(["2026-7", 25]);
  });
});

describe("the families the sweep looks at", () => {
  it("are the active families not removed, by id", async () => {
    query.mockResolvedValue({ rows: [{ id: 3 }, { id: 9 }] });
    expect(await familiesToSweep()).toEqual([3, 9]);
    expect(sql()).toContain("FROM elf_families WHERE active AND removed_at IS NULL ORDER BY id");
  });
});
