import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-252: deleting a newsletter. Two genuinely different things wear the same button:
//
//   DRAFT  — never went anywhere. Really deleted, row and all.
//   SENT   — went to real donors. Deleting the row would destroy the record of what was emailed;
//            keeping it forever means holding donor addresses (failed_emails) indefinitely. So it is
//            REDACTED: content + bounced addresses go, and a permanent stub stays (subject, sent_at,
//            recipient_count, sent_count, failed_count) so "what did we send, when, to how many?"
//            stays answerable.
//
// The pool is mocked at the boundary (same approach as newsletter-templates.test.ts), so these assert
// the SQL contract: that a redaction clears exactly the right columns and keeps exactly the right
// ones, and — the one that really matters — that a sent newsletter can never be hard-deleted.

// Both writes go through writeWithAudit, which takes a CLIENT off the pool and wraps the change and
// its audit_log row in one transaction — so the pool is mocked at connect(), the same shape as
// donations-batch.test.ts, rather than at query().
const { queryMock, connect } = vi.hoisted(() => {
  const queryMock = vi.fn();
  const connect = vi.fn(async () => ({ query: queryMock, release: vi.fn() }));
  return { queryMock, connect };
});
vi.mock("../../src/db/pool", () => ({ pool: { query: queryMock, connect } }));

import { deleteDraftNewsletter, redactSentNewsletter } from "../../src/db/newsletters";

// Transaction bookkeeping and the audit insert are noise for these assertions — the interesting SQL is
// the change itself.
const realSql = (): string[] =>
  queryMock.mock.calls
    .map((c) => String(c[0]))
    .filter((s) => !/^\s*(begin|commit|rollback)/i.test(s) && !/insert into audit_log/i.test(s));
const lastSql = (): string => realSql()[realSql().length - 1];
const allSql = (): string => realSql().join("\n---\n");
const auditSql = (): string =>
  queryMock.mock.calls.map((c) => String(c[0])).filter((s) => /insert into audit_log/i.test(s)).join("\n");
// The params of the statement that actually did the work — NOT the last call, which is now COMMIT.
const paramsOf = (re: RegExp): unknown[] =>
  (queryMock.mock.calls.find((c) => re.test(String(c[0]))) || [])[1] as unknown[];

// How many rows each statement claims to have touched. Keyed on the SQL rather than call order,
// because inside a transaction the first call is BEGIN — a mockResolvedValueOnce would land there.
let deleteRows = 1;
let updateRows = 1;

beforeEach(() => {
  queryMock.mockReset();
  deleteRows = 1;
  updateRows = 1;
  queryMock.mockImplementation(async (sql: string) => {
    if (/^\s*(begin|commit|rollback)/i.test(sql)) return {};
    if (/insert into audit_log/i.test(sql)) return { rows: [], rowCount: 1 };
    if (/delete\s+from\s+newsletter_attachments/i.test(sql)) return { rows: [], rowCount: 0 };
    if (/delete\s+from\s+newsletters/i.test(sql)) return { rows: [], rowCount: deleteRows };
    if (/update\s+newsletters/i.test(sql)) return { rows: [], rowCount: updateRows };
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

describe("redactSentNewsletter (a sent newsletter keeps its audit stub)", () => {
  it("clears the content and the bounced donor addresses", async () => {
    await redactSentNewsletter(41, 3, "admin@nbcc", "July round-up");
    const sql = allSql();
    // body_html is NOT NULL, so it is BLANKED, never nulled — nulling it would violate the column and
    // relaxing the constraint would break older code on a rollback.
    expect(sql).toMatch(/body_html\s*=\s*''/i);
    expect(sql).not.toMatch(/body_html\s*=\s*null/i);
    expect(sql).toMatch(/body_json\s*=\s*null/i);
    expect(sql).toMatch(/failed_emails\s*=\s*null/i); // donor addresses: the reason to redact at all
    expect(sql).toMatch(/redacted_at\s*=\s*now\(\)/i);
  });

  it("KEEPS the stub that answers 'what did we send, when, to how many?'", async () => {
    await redactSentNewsletter(41, 3, "admin@nbcc", "July round-up");
    // Only what the UPDATE *assigns* counts: `status = 'sent'` also appears as a WHERE guard, and that
    // guard is a feature, so look at the SET clause alone rather than the whole statement.
    const update = queryMock.mock.calls.map((c) => String(c[0])).find((s) => /update\s+newsletters/i.test(s))!;
    const setClause = (update.match(/SET([\s\S]*?)WHERE/i) || ["", ""])[1];
    expect(setClause).toBeTruthy();
    // None of these may be assigned — they are the record the charity has to be able to produce.
    for (const col of ["subject", "sent_at", "recipient_count", "sent_count", "failed_count", "status"]) {
      expect(setClause, `${col} must survive a redaction`).not.toMatch(new RegExp(`\\b${col}\\s*=`, "i"));
    }
  });

  it("only ever touches a SENT newsletter, and records who did it", async () => {
    await redactSentNewsletter(41, 3, "admin@nbcc", "July round-up");
    expect(allSql()).toMatch(/status\s*=\s*'sent'/i);
    expect(allSql()).toMatch(/redacted_by/i);
  });

  it("never DELETEs the newsletter row itself — that is the whole point", async () => {
    await redactSentNewsletter(41, 3, "admin@nbcc", "July round-up");
    expect(allSql()).not.toMatch(/delete\s+from\s+newsletters/i);
  });

  it("writes the audit row in the SAME transaction as the redaction", async () => {
    // The audit IS the feature: a redaction that landed while its audit failed would destroy content
    // with no record of who did it. writeWithAudit commits both or neither.
    await redactSentNewsletter(41, 3, "admin@nbcc", "July round-up");
    const order = queryMock.mock.calls.map((c) => String(c[0]));
    expect(auditSql()).toMatch(/insert into audit_log/i);
    expect(order.some((s) => /^\s*begin/i.test(s))).toBe(true);
    expect(order.some((s) => /^\s*commit/i.test(s))).toBe(true);
    // The audit lands after the change and before the commit — i.e. inside the transaction.
    const iUpdate = order.findIndex((s) => /update\s+newsletters/i.test(s));
    const iAudit = order.findIndex((s) => /insert into audit_log/i.test(s));
    const iCommit = order.findIndex((s) => /^\s*commit/i.test(s));
    expect(iUpdate).toBeLessThan(iAudit);
    expect(iAudit).toBeLessThan(iCommit);
  });

  it("removes the attachments too — they are content, and they are the donor-facing files", async () => {
    await redactSentNewsletter(41, 3, "admin@nbcc", "July round-up");
    expect(allSql()).toMatch(/delete\s+from\s+newsletter_attachments/i);
  });

  it("clears the delivery-tracking rows too — donor addresses, same class as failed_emails (TASK-255)", async () => {
    // The redaction promise is "the donor addresses go". newsletter_sends and newsletter_email_events
    // are keyed BY address, so leaving them behind would keep exactly what redaction exists to remove.
    // Inside the same transaction: a partial redaction is not a redaction.
    await redactSentNewsletter(41, 3, "admin@nbcc", "July round-up");
    expect(allSql()).toMatch(/delete\s+from\s+newsletter_email_events/i);
    expect(allSql()).toMatch(/delete\s+from\s+newsletter_sends/i);
  });

  it("reports whether it redacted anything, so a second attempt 404s rather than lying", async () => {
    updateRows = 1;
    await expect(redactSentNewsletter(41, 3, "admin@nbcc", "July round-up")).resolves.toBe(true);
    updateRows = 0; // e.g. the id is a draft, or no such newsletter — the status guard matched nothing
    await expect(redactSentNewsletter(41, 3, "admin@nbcc", "July round-up")).resolves.toBe(false);
  });
});
