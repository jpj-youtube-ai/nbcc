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
// One line, one space between words, none just inside brackets: the SQL is laid out over many.
const flat = (sql: string): string => sql.replace(/\s+/g, " ").replace(/\( /g, "(").replace(/ \)/g, ")").trim();

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

// TASK-346 matched an outcome to its send by SES message id. TASK-464 sends one email to several
// people (the Ball's ticket report): each has a row under the same id, so the outcome must land on
// the row for the address SES named, and only that one.
describe("markEmailDelivery with a message id", () => {
  const ID = "0100018f-aaaa-bbbb-cccc-000000000002";
  const updates = () => queryMock.mock.calls.filter((c) => /update email_log/i.test(String(c[0])));

  it("stamps the row for the person SES named on that message, and nothing else", async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    await markEmailDelivery("Bo@Example.com", "bounced", new Date("2026-09-01T10:00:00Z"), "550 no such user", ID);
    expect(updates()).toHaveLength(1);
    const [sql, params] = updates()[0] as [string, unknown[]];
    expect(sql).toMatch(/ses_message_id = \$1 and recipient = lower\(\$5\)/i);
    expect(params[0]).toBe(ID);
    expect(params[1]).toBe("bounced");
    expect(params[4]).toBe("Bo@Example.com");
  });

  it("on an email to one person, still finds it by id alone if the address was written differently", async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 }).mockResolvedValueOnce({ rows: [], rowCount: 1 });
    await markEmailDelivery("Dora@Example.com", "delivered", new Date("2026-09-01T10:00:00Z"), null, ID);
    expect(updates()).toHaveLength(2);
    const second = String(updates()[1][0]);
    expect(second).toMatch(/ses_message_id = \$1/i);
    expect(second).toMatch(/count\(\*\) from email_log where ses_message_id = \$1\) = 1/i);
    expect(second).not.toMatch(/recipient/i);
  });

  it("falls back to the address and recency only when the id matched nothing", async () => {
    await markEmailDelivery("Dora@Example.com", "delivered", new Date("2026-09-01T10:00:00Z"), null, ID);
    expect(updates()).toHaveLength(3);
    expect(String(updates()[2][0])).toMatch(/order by created_at desc/i);
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

  // TASK-562: staff can remove an address from the band. Hiding is decided here, when the band is
  // read, and never when an email is sent: a problem is left out when its address has a removal
  // still in force and the problem is older than it, or the removal is a "stop" and the address
  // is still blocked. Unblocking an address therefore brings its later failures back by itself.
  it("leaves out a problem whose address staff removed, while that removal is in force", async () => {
    await listRecentEmailFailures();
    const sql = flat(sqlOf(/from email_log/i));
    expect(sql).toMatch(/from email_log l where/i);
    expect(sql).toMatch(
      /and not exists \( ?select 1 from email_audit_removals r where r\.email = l\.recipient and r\.put_back_at is null and \(/i,
    );
  });

  it("hides what is older than the removal, and what came later only for a stop on an address still blocked", async () => {
    await listRecentEmailFailures();
    const sql = flat(sqlOf(/from email_log/i));
    expect(sql).toMatch(
      /l\.created_at <= r\.removed_at or \( ?r\.kind = 'stop' and exists \( ?select 1 from email_suppressions s where lower\(s\.email\) = l\.recipient and s\.removed_at is null ?\) ?\)/i,
    );
  });

  // The Overview counts this same list (14 days, up to 200), so its number drops with the band's.
  it("still takes the days and the cap as its two parameters", async () => {
    await listRecentEmailFailures(14, 200);
    expect(paramsOf(/from email_log/i)).toEqual([14, 200]);
  });
});

// TASK-562: nothing is deleted when an address is removed from the band. The full list keeps every
// row and says, on the ones the band is hiding, who removed them and when.
describe("listEmailLog marks what staff removed from the band", () => {
  it("joins the newest removal that hides the row, for problem rows only", async () => {
    await listEmailLog({ limit: 50, offset: 0 });
    const sql = flat(sqlOf(/select id, kind/i));
    expect(sql).toMatch(/from email_log l left join lateral \( ?select r\.removed_at, r\.removed_by, r\.kind as removed_kind from email_audit_removals r where/i);
    expect(sql).toMatch(/and \(l\.status = 'failed' or l\.delivery_status in \('bounced', 'complained'\)\)/i);
    expect(sql).toMatch(/order by r\.removed_at desc limit 1 ?\) rm on true/i);
    expect(sql).toMatch(/delivery_detail, created_at, removed_at, removed_by, removed_kind from email_log l/i);
  });

  it("uses the band's own rule, so the mark and the band can never disagree", async () => {
    await listRecentEmailFailures();
    const band = flat(sqlOf(/from email_log/i));
    queryMock.mockClear();
    await listEmailLog({ limit: 50, offset: 0 });
    const list = flat(sqlOf(/select id, kind/i));
    const rule = /r\.email = l\.recipient and r\.put_back_at is null and \(l\.created_at <= r\.removed_at or \(r\.kind = 'stop' and exists \(select 1 from email_suppressions s where lower\(s\.email\) = l\.recipient and s\.removed_at is null\)\)\)/i;
    expect(band).toMatch(rule);
    expect(list).toMatch(rule);
  });

  it("hands each row who removed it, when and how, or nulls", async () => {
    const row = { id: 1, kind: "newsletter", recipient: "ada@example.org", recipient_name: null, subject: "S", status: "sent",
      error: null, delivery_status: "bounced", delivery_at: null, delivery_detail: null, created_at: "2026-10-01T09:00:00Z" };
    queryMock
      .mockResolvedValueOnce({ rows: [{ n: "2" }], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [
          { ...row, removed_at: "2026-10-05T10:00:00Z", removed_by: "staff@nbcc.scot", removed_kind: "stop" },
          { ...row, id: 2, delivery_status: "delivered", removed_at: null, removed_by: null, removed_kind: null },
        ],
        rowCount: 2,
      });
    const out = await listEmailLog({ limit: 50, offset: 0 });
    expect(out.rows[0]).toMatchObject({ id: 1, removedAt: "2026-10-05T10:00:00Z", removedBy: "staff@nbcc.scot", removedKind: "stop" });
    expect(out.rows[1]).toMatchObject({ id: 2, removedAt: null, removedBy: null, removedKind: null });
  });

  // The count needs no join, and the filters name their columns plainly: the join exposes only
  // removed_at, removed_by and removed_kind, so "kind", "status" and the rest still mean the log's.
  it("keeps the count free of the join, and the filters unambiguous", async () => {
    await listEmailLog({ kind: "newsletter", status: "bounced", q: "ada", limit: 50, offset: 0 });
    expect(flat(sqlOf(/select count/i))).not.toMatch(/email_audit_removals/i);
    const sql = flat(sqlOf(/select id, kind/i));
    expect(sql).toMatch(/rm on true where kind = \$1 and delivery_status = \$2 and \(recipient like \$3/i);
    expect(sql).not.toMatch(/r\.kind(?! as removed_kind| = 'stop')/i);
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

  // TASK-562: a removal from the band names an address too, so it follows the log's own rules: it
  // does not outlive the rows it was about, and it goes when the address is erased.
  it("prunes the removals made on or before the same cutoff, after the log's own rows", async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 7 });
    const now = new Date("2026-09-01T12:00:00Z");
    expect(await pruneEmailLog(now)).toBe(7);
    const order = queryMock.mock.calls.map((c) => String(c[0]));
    expect(order[0]).toMatch(/delete from email_log where created_at/i);
    expect(order[1]).toMatch(/delete from email_audit_removals where removed_at <= \$1::timestamptz/i);
    expect(paramsOf(/delete from email_audit_removals/i)).toEqual([emailLogPruneCutoff(now).toISOString()]);
  });

  // Two older paths forget a person in the log without coming through eraseEmailLogFor: a
  // sponsor's unpaid pledge (src/db/pledges.ts deletes the rows about it) and a team invite that
  // is cleared (src/db/fundraising-teams.ts puts "deleted team invitee" in place of the address).
  // Neither knows about removals. So the same daily run clears any removal whose address no longer
  // has a single row in the log: it is then about nothing, and would be the last place the address
  // was kept.
  it("prunes a removal whose address no longer appears in the log at all", async () => {
    await pruneEmailLog(new Date("2026-09-01T12:00:00Z"));
    const last = flat(String(queryMock.mock.calls[2][0]));
    expect(last).toMatch(
      /^delete from email_audit_removals r where not exists \(select 1 from email_log l where l\.recipient = r\.email\)$/i,
    );
    expect(queryMock).toHaveBeenCalledTimes(3);
  });

  it("erases an address's removals with its rows", async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 3 });
    expect(await eraseEmailLogFor("Gone@Example.com")).toBe(3);
    expect(sqlOf(/delete from email_audit_removals/i)).toMatch(/where email = lower\(\$1\)/i);
    expect(paramsOf(/delete from email_audit_removals/i)).toEqual(["Gone@Example.com"]);
  });

  // A sponsor's pledge erases only the emails about that pledge: the address still has other rows,
  // so what staff decided about the address stays.
  it("keeps the removals when only some kinds of an address's emails are erased", async () => {
    await eraseEmailLogFor("Gone@Example.com", ["fundraisePledgePay"]);
    expect(sqlOf(/delete from email_audit_removals/i)).toBe("");
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
