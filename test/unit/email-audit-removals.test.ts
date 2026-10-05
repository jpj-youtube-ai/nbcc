import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-562: the removals staff make from the Email audit's red band. The pool is mocked at the
// boundary, as email-log.test.ts does, to pin the SQL that carries the promises: a removal is one
// row with who and when; putting back stamps it and deletes nothing; and the question "why is this
// address blocked now" is asked of the block list, which this module never writes to. Every
// address here is invented.

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock("../../src/db/pool", () => ({ pool: { query: queryMock, connect: vi.fn() } }));

import { recordAuditRemoval, putBackAuditRemovals, blockedReason, hasEmailProblem } from "../../src/db/email-audit-removals";

const sqls = (): string[] => queryMock.mock.calls.map((c) => String(c[0]).replace(/\s+/g, " ").trim());

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockResolvedValue({ rows: [], rowCount: 0 });
});

describe("recordAuditRemoval", () => {
  it("stores one removal: the address lowercased in SQL, the kind, whether it blocked, and who", async () => {
    await recordAuditRemoval("Ada@Example.ORG", "stop", "staff@nbcc.test", true);
    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(sqls()[0]).toMatch(
      /^insert into email_audit_removals \(email, kind, blocked, removed_by\) values \(lower\(\$1\), \$2, \$3, \$4\)$/i,
    );
    expect(queryMock.mock.calls[0][1]).toEqual(["Ada@Example.ORG", "stop", true, "staff@nbcc.test"]);
  });

  it("stores a tidy the same way, not blocked", async () => {
    await recordAuditRemoval("ada@example.org", "tidy", "staff@nbcc.test", false);
    expect(queryMock.mock.calls[0][1]).toEqual(["ada@example.org", "tidy", false, "staff@nbcc.test"]);
  });
});

describe("putBackAuditRemovals", () => {
  it("stamps every removal still in force for the address, and deletes nothing", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ blocked: false }, { blocked: true }], rowCount: 2 });
    const out = await putBackAuditRemovals("Ada@Example.org", "staff@nbcc.test");
    expect(out).toEqual({ putBack: 2, blocked: true });
    expect(sqls()[0]).toMatch(
      /^update email_audit_removals set put_back_at = now\(\), put_back_by = \$2 where email = lower\(\$1\) and put_back_at is null returning blocked$/i,
    );
    expect(queryMock.mock.calls[0][1]).toEqual(["Ada@Example.org", "staff@nbcc.test"]);
    expect(sqls().some((s) => /delete/i.test(s))).toBe(false);
  });

  it("says nothing was put back when the address had no removal in force", async () => {
    expect(await putBackAuditRemovals("ada@example.org", "staff@nbcc.test")).toEqual({ putBack: 0, blocked: false });
  });

  // A tidy never blocks, and a stop on an address that was already blocked did not block it
  // either: putting those back must leave the block alone.
  it("says the block was not this removal's doing when none of them blocked", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ blocked: false }], rowCount: 1 });
    expect(await putBackAuditRemovals("ada@example.org", "staff@nbcc.test")).toEqual({ putBack: 1, blocked: false });
  });
});

describe("blockedReason", () => {
  it("answers why an address is blocked now", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ reason: "manual" }], rowCount: 1 });
    expect(await blockedReason("Ada@Example.org")).toBe("manual");
    expect(sqls()[0]).toMatch(
      /^select reason from email_suppressions where lower\(email\) = lower\(\$1\) and removed_at is null$/i,
    );
    expect(queryMock.mock.calls[0][1]).toEqual(["Ada@Example.org"]);
  });

  it("answers null when it is not blocked", async () => {
    expect(await blockedReason("ada@example.org")).toBeNull();
  });

  it("only ever reads the block list", async () => {
    await blockedReason("ada@example.org");
    expect(sqls().every((s) => /^select /i.test(s))).toBe(true);
  });
});

// The routes remove only an address the log has a problem for: what the red band offers. Without
// this the route would block any address handed to it.
describe("hasEmailProblem", () => {
  it("is true when the log holds a failed, bounced or complained email to the address", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ "?column?": 1 }], rowCount: 1 });
    expect(await hasEmailProblem("Ada@Example.org")).toBe(true);
    expect(sqls()[0]).toMatch(
      /^select 1 from email_log where recipient = lower\(\$1\) and \(status = 'failed' or delivery_status in \('bounced', 'complained'\)\) limit 1$/i,
    );
    expect(queryMock.mock.calls[0][1]).toEqual(["Ada@Example.org"]);
  });

  it("is false when every email to it arrived, or there are none", async () => {
    expect(await hasEmailProblem("ada@example.org")).toBe(false);
  });
});
