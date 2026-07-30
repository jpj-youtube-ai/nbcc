import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-272: the suppression list. A hard bounce or a spam complaint used to be recorded and then
// ignored — the recipient queries filtered on consent alone, so a dead mailbox and someone who
// pressed "report spam" were mailed again on every subsequent send, forever. That is the single
// strongest signal a mailbox provider uses to judge a sender careless, and nbcc.scot also carries the
// admin sign-in codes and donation receipts.
//
// The promises under test:
//   - a complaint always suppresses; a PERMANENT bounce suppresses; a transient one must NOT
//     (a full inbox is temporary, and dropping a real supporter over it is its own failure);
//   - suppression is idempotent and keeps the FIRST reason — a later bounce cannot quietly rewrite
//     the record of a complaint;
//   - lifting one is a tombstone, never a delete.

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock("../../src/db/pool", () => ({ pool: { query: queryMock, connect: vi.fn() } }));

import { suppressEmail, unsuppressEmail, suppressedAmong } from "../../src/db/email-suppressions";
import { suppressionFor, type ParsedResendEvent } from "../../src/newsletter/resend-events";

const sqlOf = (re: RegExp): string =>
  queryMock.mock.calls.map((c) => String(c[0])).find((s) => re.test(s)) ?? "";
const paramsOf = (re: RegExp): unknown[] =>
  (queryMock.mock.calls.find((c) => re.test(String(c[0]))) || [])[1] as unknown[];

const event = (over: Partial<ParsedResendEvent>): ParsedResendEvent => ({
  eventType: "bounced",
  email: "x@example.com",
  occurredAt: new Date("2026-07-30T00:00:00Z"),
  detail: null,
  linkUrl: null,
  ...over,
});

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockResolvedValue({ rows: [], rowCount: 0 });
});

describe("suppressionFor — which events stop future sending (pure)", () => {
  it("always suppresses a spam complaint", () => {
    expect(suppressionFor(event({ eventType: "complained" }))).toEqual({ reason: "complained", detail: null });
  });

  it("suppresses a PERMANENT bounce, and keeps the provider's reason", () => {
    const out = suppressionFor(event({ detail: { type: "Permanent", message: "mailbox does not exist" } }));
    expect(out).toEqual({ reason: "bounced", detail: "mailbox does not exist" });
  });

  it("does NOT suppress a transient bounce — a full inbox is temporary", () => {
    expect(suppressionFor(event({ detail: { type: "Transient", message: "mailbox full" } }))).toBeNull();
  });

  it("does not suppress a bounce whose type is unknown, or any other event", () => {
    expect(suppressionFor(event({ detail: null }))).toBeNull();
    expect(suppressionFor(event({ eventType: "delivered" }))).toBeNull();
    expect(suppressionFor(event({ eventType: "opened" }))).toBeNull();
  });

  it("matches the permanent type case-insensitively", () => {
    expect(suppressionFor(event({ detail: { type: "PERMANENT" } }))?.reason).toBe("bounced");
  });
});

describe("suppression store (TASK-272)", () => {
  it("lowercases the address and refuses to duplicate an active suppression", async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    expect(await suppressEmail("  Dead@Example.COM ", "bounced", "no such user")).toBe(true);
    expect(paramsOf(/insert into email_suppressions/i)[0]).toBe("dead@example.com");
    // the guard that makes it idempotent — the first reason on record wins
    expect(sqlOf(/insert into email_suppressions/i)).toMatch(/where not exists/i);
  });

  it("reports false when the address was already suppressed", async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    expect(await suppressEmail("dead@example.com", "complained")).toBe(false);
  });

  it("ignores a blank address rather than writing a junk row", async () => {
    expect(await suppressEmail("   ", "manual")).toBe(false);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("lifts a suppression as a TOMBSTONE, recording who did it — never a delete", async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    expect(await unsuppressEmail("Dead@example.com", "kenny@nbcc.test")).toBe(true);
    const sql = sqlOf(/update email_suppressions/i);
    expect(sql).toMatch(/set removed_at = now\(\)/i);
    expect(sql).toMatch(/removed_by/i);
    expect(sqlOf(/delete from email_suppressions/i)).toBe("");
    expect(paramsOf(/update email_suppressions/i)).toEqual(["dead@example.com", "kenny@nbcc.test"]);
  });

  it("looks up a whole batch in ONE query and returns the blocked set", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ email: "dead@example.com" }] });
    const blocked = await suppressedAmong(["Live@example.com", "DEAD@example.com"]);
    expect(blocked.has("dead@example.com")).toBe(true);
    expect(blocked.has("live@example.com")).toBe(false);
    expect(queryMock).toHaveBeenCalledTimes(1); // never per-recipient
    expect(paramsOf(/from email_suppressions/i)[0]).toEqual(["live@example.com", "dead@example.com"]);
    expect(sqlOf(/from email_suppressions/i)).toMatch(/removed_at is null/i); // lifted ones don't block
  });

  it("does not query at all for an empty audience", async () => {
    expect((await suppressedAmong([])).size).toBe(0);
    expect(queryMock).not.toHaveBeenCalled();
  });
});
