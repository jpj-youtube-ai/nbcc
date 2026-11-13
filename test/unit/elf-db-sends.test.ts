import { describe, it, expect, vi, beforeEach } from "vitest";

// NBCC Elf Detective School wave 2: every timed send claimed once in elf_sends (src/db/elf-sends.ts), and (Plan
// 2c-2, Task 7) the family's own switch for the emails that are not essential (src/db/elf.ts). There is no local
// database, so these read the SQL and parameters each function sends; the BDD proves them against Postgres in CI.
// Every family and token here is invented.

const { query, clientQuery, release } = vi.hoisted(() => ({ query: vi.fn(), clientQuery: vi.fn(), release: vi.fn() }));
vi.mock("../../src/db/pool", () => ({ pool: { query, connect: async () => ({ query: clientQuery, release }) } }));

import { claimSend, familiesStillToEmail, familiesToSweep, markSendFailed, markSent } from "../../src/db/elf-sends";
import { familyByEmailsToken, familyWithDetectives, setEmailsStopped } from "../../src/db/elf";

const sql = (n = 0) => String(query.mock.calls[n][0]).replace(/\s+/g, " ");
/** A family's own token, as the database makes them: 32 lower case hex letters. */
const TOKEN = "0123456789abcdef0123456789abcdef";

beforeEach(() => {
  query.mockReset();
  clientQuery.mockReset();
  release.mockReset();
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
        { id: 11, email: "sam.example@example.org", grown_up_name: "Sam Example", emails_token: TOKEN },
        { id: 12, email: "alex.example@example.org", grown_up_name: "Alex Example", emails_token: "fedcba9876543210fedcba9876543210" },
      ],
    });
    expect(await familiesStillToEmail(2026, 7, 25)).toEqual([
      { familyId: 11, email: "sam.example@example.org", grownUpName: "Sam Example", emailsToken: TOKEN },
      { familyId: 12, email: "alex.example@example.org", grownUpName: "Alex Example", emailsToken: "fedcba9876543210fedcba9876543210" },
    ]);
    const s = sql();
    expect(s).toContain("FROM elf_families f");
    expect(s).toContain("f.active");
    expect(s).toContain("f.removed_at IS NULL");
    // Plan 2c-2: each with its own token for the link that stops the emails, and none that has stopped them.
    expect(s).toContain("SELECT f.id, f.email, f.grown_up_name, f.emails_token FROM elf_families f");
    expect(s).toContain("f.emails_stopped_at IS NULL");
    expect(s).toContain("s.kind = 'clue'");
    expect(s).toContain("s.key = $1::text || ':' || f.id");
    expect(s).toContain("sent_at IS NOT NULL OR s.attempts >= 3 OR s.claimed_at > now() - interval '10 minutes'");
    expect(s).toContain("ORDER BY f.id");
    expect(s).toContain("LIMIT $2");
    expect(query.mock.calls[0][1]).toEqual(["2026-7", 25]);
  });
});

describe("the families the sweep looks at", () => {
  // A family that has stopped the emails stays in the sweep, so its proud moments are claimed without an email and
  // starting them again never sends old news (src/elf/worker.ts).
  it("are the active families not removed, by id, whether or not they have stopped the emails", async () => {
    query.mockResolvedValue({ rows: [{ id: 3 }, { id: 9 }] });
    expect(await familiesToSweep()).toEqual([3, 9]);
    expect(sql()).toContain("FROM elf_families WHERE active AND removed_at IS NULL ORDER BY id");
    expect(sql()).not.toContain("emails_stopped_at");
  });
});

// ---- the family's switch for the emails that are not essential (Plan 2c-2, Task 7; src/db/elf.ts) ----------

describe("a family found by the token in its link to stop the emails", () => {
  it("is read only for 32 lower case hex letters: anything else is no family, with nothing read", async () => {
    for (const token of ["", "0123", `${TOKEN}0`, TOKEN.slice(1), TOKEN.toUpperCase(), "0123456789abcdef-123456789abcdef", "0123456789abcdeg0123456789abcdef", " 0123456789abcdef0123456789abcde", undefined, 42]) {
      expect(await familyByEmailsToken(token as string), String(token)).toBeNull();
    }
    expect(query).not.toHaveBeenCalled();
  });

  it("is the active family, not removed, whose token it is, with whether it has stopped the emails", async () => {
    query.mockResolvedValue({ rows: [{ id: 3, stopped: true }] });
    expect(await familyByEmailsToken(TOKEN)).toEqual({ id: 3, stopped: true });
    const s = sql();
    expect(s).toContain("SELECT id, emails_stopped_at IS NOT NULL AS stopped FROM elf_families");
    expect(s).toContain("WHERE emails_token = $1 AND active AND removed_at IS NULL");
    expect(query.mock.calls[0][1]).toEqual([TOKEN]);
    query.mockResolvedValue({ rows: [{ id: 3, stopped: false }] });
    expect(await familyByEmailsToken(TOKEN)).toEqual({ id: 3, stopped: false });
  });

  it("is null when no family has that token, or it is removed", async () => {
    query.mockResolvedValue({ rows: [] });
    expect(await familyByEmailsToken(TOKEN)).toBeNull();
  });
});

describe("stopping the emails, and starting them again", () => {
  const writes = () => clientQuery.mock.calls.map((c) => [String(c[0]).replace(/\s+/g, " "), c[1]]);
  const audits = () => writes().filter(([s]) => String(s).startsWith("INSERT INTO audit_log")).map(([, params]) => params);
  const audit = () => writes().find(([s]) => String(s).startsWith("INSERT INTO audit_log"));
  beforeEach(() => clientQuery.mockResolvedValue({ rows: [], rowCount: 1 }));

  // Fix round 1 (the review's Minor 2): the row changes only when the switch does, so a press that changes nothing
  // writes no audit line.
  it("stops them in one transaction, only while they are on, and says so in the audit log with the family's id alone", async () => {
    await setEmailsStopped(3, true);
    const all = writes();
    expect(all[0][0]).toBe("BEGIN");
    expect(all[1][0]).toBe("UPDATE elf_families SET emails_stopped_at = CASE WHEN $2::boolean THEN now() ELSE NULL END WHERE id = $1 AND (emails_stopped_at IS NOT NULL) <> $2::boolean");
    expect(all[1][1]).toEqual([3, true]);
    expect(audit()![1]).toEqual(["family", "elf.emails.stopped", "elf_family", 3, { familyId: 3 }]);
    expect(all.at(-1)![0]).toBe("COMMIT");
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("writes no second audit line for a second stop, nor for a start while they are on", async () => {
    // elf_families as the UPDATE's WHERE keeps it: the row changes only when it is not already as asked.
    let stoppedNow = false;
    clientQuery.mockImplementation(async (s: string, params: unknown[] = []) => {
      if (!String(s).startsWith("UPDATE elf_families")) return { rows: [], rowCount: 1 };
      if (stoppedNow === params[1]) return { rows: [], rowCount: 0 };
      stoppedNow = params[1] === true;
      return { rows: [], rowCount: 1 };
    });
    await setEmailsStopped(3, true);
    await setEmailsStopped(3, true);
    expect(audits()).toEqual([["family", "elf.emails.stopped", "elf_family", 3, { familyId: 3 }]]);
    await setEmailsStopped(3, false);
    await setEmailsStopped(3, false);
    expect(audits()).toEqual([
      ["family", "elf.emails.stopped", "elf_family", 3, { familyId: 3 }],
      ["family", "elf.emails.started", "elf_family", 3, { familyId: 3 }],
    ]);
    // Each press is still its own transaction, committed, with nothing left open.
    expect(writes().filter(([s]) => s === "COMMIT")).toHaveLength(4);
    expect(release).toHaveBeenCalledTimes(4);
  });

  it("starts them again: emails_stopped_at back to none, audited as started", async () => {
    await setEmailsStopped(3, false);
    expect(writes()[1][1]).toEqual([3, false]);
    expect(audit()![1]).toEqual(["family", "elf.emails.started", "elf_family", 3, { familyId: 3 }]);
  });

  it("changes nothing when the audit log cannot be written", async () => {
    clientQuery.mockImplementation(async (s: string) => {
      if (String(s).startsWith("INSERT INTO audit_log")) throw new Error("the audit log went away");
      return { rows: [], rowCount: 1 };
    });
    await expect(setEmailsStopped(3, true)).rejects.toThrow("the audit log went away");
    expect(writes().at(-1)![0]).toBe("ROLLBACK");
    expect(release).toHaveBeenCalledTimes(1);
  });
});

describe("a signed in family and its detectives", () => {
  it("carries whether it has stopped the emails and its own token, never more of the family than before", async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 3, grown_up_name: "Sam Example", email: "sam@example.org", emails_stopped: true, emails_token: TOKEN }] })
      .mockResolvedValueOnce({ rows: [] });
    expect(await familyWithDetectives(3)).toEqual({ id: 3, grownUpName: "Sam Example", email: "sam@example.org", emailsStopped: true, emailsToken: TOKEN, detectives: [] });
    expect(sql()).toContain("SELECT id, grown_up_name, email, emails_stopped_at IS NOT NULL AS emails_stopped, emails_token FROM elf_families WHERE id = $1 AND active");
  });
});
