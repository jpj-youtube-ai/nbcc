import { describe, it, expect, vi, beforeEach } from "vitest";

// The email send audit log (email-audit feature). The pool is mocked at the boundary (the
// established approach — newsletter-events-db.test.ts) to pin the SQL contracts that carry the
// feature's promises:
//   - every attempt is one row, address lowercased, error truncated, never a body;
//   - a delivery event stamps the NEWEST matching un-stamped send, windowed (SES reports per
//     address, not per message — same correlation discipline as the newsletter stats);
//   - the list filters map 'failed'/'sent' to OUR attempt and 'delivered'/'bounced'/'complained'
//     to the mailbox verdict, and the search covers recipient, name and subject;
//   - retention prunes on the six-tax-years cutoff, and erasure removes every row for an address.

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock("../../src/db/pool", () => ({ pool: { query: queryMock, connect: vi.fn() } }));

import {
  recordEmailSend,
  markEmailDelivery,
  listEmailLog,
  listRecentEmailFailures,
  pruneEmailLog,
  eraseEmailLogFor,
} from "../../src/db/email-log";
import { emailLogPruneCutoff } from "../../src/email/log-retention";

const sqlOf = (re: RegExp): string => queryMock.mock.calls.map((c) => String(c[0])).find((s) => re.test(s)) ?? "";
const paramsOf = (re: RegExp): unknown[] =>
  (queryMock.mock.calls.find((c) => re.test(String(c[0]))) || [])[1] as unknown[];

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockResolvedValue({ rows: [], rowCount: 0 });
});

describe("recordEmailSend", () => {
  it("stores one metadata row with the address lowercased in SQL", async () => {
    await recordEmailSend({ kind: "receipt", recipient: "Corp@Example.COM", subject: "S", status: "sent" });
    const sql = sqlOf(/insert into email_log/i);
    expect(sql).toMatch(/lower\(\$2\)/i);
    const params = paramsOf(/insert into email_log/i);
    expect(params[0]).toBe("receipt");
    expect(params[4]).toBe("sent");
    expect(params[5]).toBeNull();
  });

  it("truncates a long error — the row says WHY, it does not warehouse payloads", async () => {
    await recordEmailSend({
      kind: "newsletter",
      recipient: "a@b.c",
      subject: "S",
      status: "failed",
      error: "x".repeat(2000),
    });
    const params = paramsOf(/insert into email_log/i);
    expect(String(params[5]).length).toBe(500);
  });
});

describe("markEmailDelivery", () => {
  it("stamps only the NEWEST un-stamped, successfully-sent row within the window", async () => {
    await markEmailDelivery("Dora@Example.com", "bounced", new Date("2026-09-01T10:00:00Z"), "no such user");
    const sql = sqlOf(/update email_log/i);
    expect(sql).toMatch(/delivery_status is null/i);
    expect(sql).toMatch(/status = 'sent'/i);
    expect(sql).toMatch(/order by created_at desc/i);
    expect(sql).toMatch(/limit 1/i);
    expect(sql).toMatch(/interval/i); // windowed, not forever
    expect(paramsOf(/update email_log/i)[1]).toBe("bounced");
  });
});

describe("listEmailLog", () => {
  it("maps 'failed' to OUR attempt column and 'bounced' to the mailbox verdict column", async () => {
    await listEmailLog({ status: "failed", limit: 50, offset: 0 });
    expect(sqlOf(/from email_log/i)).toMatch(/\bstatus = \$1/i);

    queryMock.mockReset();
    queryMock.mockResolvedValue({ rows: [], rowCount: 0 });
    await listEmailLog({ status: "bounced", limit: 50, offset: 0 });
    expect(sqlOf(/from email_log/i)).toMatch(/delivery_status = \$1/i);
  });

  it("searches recipient, name and subject with one lowercased term", async () => {
    await listEmailLog({ q: "  MarGaret ", limit: 50, offset: 0 });
    const sql = sqlOf(/select id, kind/i);
    expect(sql).toMatch(/recipient like/i);
    expect(sql).toMatch(/recipient_name.*like/i);
    expect(sql).toMatch(/subject\) like/i);
    expect(paramsOf(/select id, kind/i)[0]).toBe("%margaret%");
  });

  it("orders newest first and returns the filtered total for the pager", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ n: "123" }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const out = await listEmailLog({ kind: "thankYou", limit: 50, offset: 100 });
    expect(out.total).toBe(123);
    expect(sqlOf(/order by created_at desc/i)).toBeTruthy();
    // the kind filter applies to BOTH the count and the page, so they can never disagree
    const countParams = paramsOf(/select count/i);
    expect(countParams[0]).toBe("thankYou");
  });
});

describe("listRecentEmailFailures (the red band)", () => {
  it("covers our failures AND the mailbox's verdicts, windowed and capped", async () => {
    await listRecentEmailFailures();
    const sql = sqlOf(/from email_log/i);
    expect(sql).toMatch(/status = 'failed'/i);
    expect(sql).toMatch(/delivery_status in \('bounced', 'complained'\)/i);
    expect(sql).toMatch(/interval/i);
    expect(sql).toMatch(/limit/i);
  });
});

describe("retention + erasure", () => {
  it("prunes on the six-tax-years cutoff", async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 7 });
    const pruned = await pruneEmailLog(new Date("2026-09-01T12:00:00Z"));
    expect(pruned).toBe(7);
    expect(paramsOf(/delete from email_log where created_at/i)[0]).toBe(
      emailLogPruneCutoff(new Date("2026-09-01T12:00:00Z")).toISOString(),
    );
  });

  it("erases every row for an address, lowercased", async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 3 });
    expect(await eraseEmailLogFor("Gone@Example.com")).toBe(3);
    expect(sqlOf(/delete from email_log where recipient/i)).toMatch(/lower\(\$1\)/i);
  });
});

// The pure cutoff rule (src/email/log-retention.ts): a row expires only once the 5 April ending
// ITS tax year is six full years past — conservative, tax-year anchored, HMRC's window.
describe("emailLogPruneCutoff", () => {
  it("on 2026-09-01, everything up to 5 April 2020 is out of retention", () => {
    expect(emailLogPruneCutoff(new Date("2026-09-01T12:00:00Z")).toISOString()).toBe(
      new Date(Date.UTC(2020, 3, 5)).toISOString(),
    );
  });

  it("a window closes exactly ON its six-year anniversary, not a day before", () => {
    // 2020-04-05 + 6y = 2026-04-05: expired at that instant…
    expect(emailLogPruneCutoff(new Date(Date.UTC(2026, 3, 5))).getUTCFullYear()).toBe(2020);
    // …but the day before, the newest expired boundary is still 2019's.
    expect(emailLogPruneCutoff(new Date(Date.UTC(2026, 3, 4))).getUTCFullYear()).toBe(2019);
  });
});
