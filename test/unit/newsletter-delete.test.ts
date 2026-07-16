import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-252 introduced deletion; TASK-258 hardened it: a DRAFT (never went anywhere) is really
// deleted; a SENT newsletter is IMMUTABLE — the permanent record of what was said to donors. The pool
// is mocked at the boundary to pin the one SQL contract that matters: draft deletion is guarded to
// drafts in the statement itself.

// The draft delete goes through writeWithAudit, which takes a CLIENT off the pool and wraps the change and
// its audit_log row in one transaction — so the pool is mocked at connect(), the same shape as
// donations-batch.test.ts, rather than at query().
const { queryMock, connect } = vi.hoisted(() => {
  const queryMock = vi.fn();
  const connect = vi.fn(async () => ({ query: queryMock, release: vi.fn() }));
  return { queryMock, connect };
});
vi.mock("../../src/db/pool", () => ({ pool: { query: queryMock, connect } }));

import { deleteDraftNewsletter } from "../../src/db/newsletters";

// Transaction bookkeeping and the audit insert are noise for these assertions — the interesting SQL is
// the change itself.
const realSql = (): string[] =>
  queryMock.mock.calls
    .map((c) => String(c[0]))
    .filter((s) => !/^\s*(begin|commit|rollback)/i.test(s) && !/insert into audit_log/i.test(s));
const lastSql = (): string => realSql()[realSql().length - 1];
// The params of the statement that actually did the work — NOT the last call, which is now COMMIT.
const paramsOf = (re: RegExp): unknown[] =>
  (queryMock.mock.calls.find((c) => re.test(String(c[0]))) || [])[1] as unknown[];

// How many rows each statement claims to have touched. Keyed on the SQL rather than call order,
// because inside a transaction the first call is BEGIN — a mockResolvedValueOnce would land there.
let deleteRows = 1;

beforeEach(() => {
  queryMock.mockReset();
  deleteRows = 1;
  queryMock.mockImplementation(async (sql: string) => {
    if (/^\s*(begin|commit|rollback)/i.test(sql)) return {};
    if (/insert into audit_log/i.test(sql)) return { rows: [], rowCount: 1 };
    if (/delete\s+from\s+newsletter_attachments/i.test(sql)) return { rows: [], rowCount: 0 };
    if (/delete\s+from\s+newsletters/i.test(sql)) return { rows: [], rowCount: deleteRows };
    return { rows: [], rowCount: 0 };
  });
});

describe("deleteDraftNewsletter (a draft never went anywhere)", () => {
  it("really deletes the row, and ONLY ever a draft", async () => {
    await deleteDraftNewsletter(41, "admin@nbcc", "Autumn draft");
    const sql = lastSql();
    expect(sql).toMatch(/delete\s+from\s+newsletters/i);
    // The status guard is the safety catch: even if a caller got the id of a SENT newsletter wrong,
    // this can never destroy the record of something that reached real donors.
    expect(sql).toMatch(/status\s*=\s*'draft'/i);
    expect(paramsOf(/delete\s+from\s+newsletters/i)).toEqual([41]);
  });

  it("reports whether anything was removed, so the route can 404 rather than pretend", async () => {
    deleteRows = 1;
    await expect(deleteDraftNewsletter(41, "admin@nbcc", "Autumn draft")).resolves.toBe(true);
    deleteRows = 0;
    await expect(deleteDraftNewsletter(999, "admin@nbcc", "Autumn draft")).resolves.toBe(false);
  });
});

describe("sent newsletters are IMMUTABLE (TASK-258 — supersedes TASK-252's redaction)", () => {
  // The user's call, reversing the earlier redact option: a sent campaign is the charity's permanent
  // record of what was said to donors — trustees, complaints and the Fundraising Regulator all ask
  // "what exactly did you send?", and the stored content carries NO donor data (names merge per
  // recipient at send time), so there was never a privacy reason to delete it. There is deliberately
  // NO function in this module that can touch a sent newsletter's content: immutability enforced by
  // absence, not by a guard someone could forget.
  it("exposes no way to redact or delete a sent newsletter", async () => {
    const mod = await import("../../src/db/newsletters");
    expect((mod as Record<string, unknown>).redactSentNewsletter).toBeUndefined();
    // The one deletion that exists is draft-only, guarded in SQL.
    await deleteDraftNewsletter(41, "admin@nbcc", "Autumn draft");
    expect(lastSql()).toMatch(/status\s*=\s*'draft'/i);
  });
});
