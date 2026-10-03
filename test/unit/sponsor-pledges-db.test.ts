import { describe, it, expect, vi, beforeEach } from "vitest";

// Sponsor pledges: the SQL, against a mocked pool (no database). A pledge is made unconfirmed with
// its Gift Aid declaration; confirming makes it open; each email is claimed once; a pledge is only
// ever cancelled or marked while open; the webhook marks it paid inside the donation's own
// transaction, flags one paid twice, and keeps when the declaration was made where nothing can
// delete it; and removing a sponsor's details removes their email log rows too. Every name here is
// invented.

const { query, connect, eraseEmailLogFor } = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn(), eraseEmailLogFor: vi.fn() }));
vi.mock("../../src/db/pool", () => ({ pool: { query, connect } }));
vi.mock("../../src/config", () => ({ config: { NODE_ENV: "test" } }));
vi.mock("../../src/db/email-log", () => ({ eraseEmailLogFor }));

import {
  anonymisePledge,
  cancelPledge,
  claimPayLinkResend,
  claimPledgeEmail,
  confirmPledge,
  createPledge,
  deleteUnconfirmedPledge,
  guardPledgePayment,
  markDoublePaidChecked,
  markPledgeCash,
  markPledgeEmailSent,
  pledgeFromSession,
  releasePledgeEmail,
  saveCheckoutSession,
  setPledgeHiddenByOrganiser,
  setPledgeMessageHidden,
  settlePledge,
  settlePledgeSafely,
  toPledge,
  trimPaidPledge,
} from "../../src/db/pledges";
import { pledgeDeclarationWording, pledgeSchema } from "../../src/pledges/model";

type Answer = (sql: string, params: unknown[]) => unknown;
function useClient(answer: Answer = () => undefined) {
  const calls: Array<[string, unknown[]]> = [];
  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push([sql, params]);
      return answer(sql, params) ?? { rows: [] };
    }),
    release: vi.fn(),
  };
  connect.mockResolvedValue(client);
  return { calls, client };
}
const sqlIn = (calls: Array<[string, unknown[]]>, re: RegExp) => calls.find((c) => re.test(c[0]));
const audits = (calls: Array<[string, unknown[]]>) => calls.filter((c) => /INSERT INTO audit_log/.test(c[0])).map((c) => c[1]);

const row = (over: Record<string, unknown> = {}) => ({
  id: 5,
  fundraiser_id: 7,
  first_name: "Alex",
  surname: "Example",
  email: "alex@example.com",
  amount_pence: 1000,
  message: null,
  message_hidden: false,
  show_name: true,
  show_amount: true,
  gift_aid: false,
  ga_house: null,
  ga_address: null,
  ga_postcode: null,
  ga_non_uk: false,
  ga_wording_version: null,
  ga_wording_snapshot: null,
  ga_declared_at: null,
  status: "open",
  token_nonce: "nonce-a",
  created_at: new Date("2026-11-01T10:00:00Z"),
  confirmed_at: new Date("2026-11-01T10:05:00Z"),
  pay_email_claimed_at: null,
  pay_email_sent_at: null,
  reminder_claimed_at: null,
  reminder_sent_at: null,
  paid_at: null,
  paid_amount_pence: null,
  donation_id: null,
  declaration_id: null,
  cash_marked_at: null,
  cancelled_at: null,
  anonymised_at: null,
  refunded: false,
  ...over,
});

const parsed = (over: Record<string, unknown> = {}) => {
  const r = pledgeSchema.safeParse({ amountPence: 1000, firstName: "Alex", surname: "Example", email: "alex@example.com", showName: true, ...over });
  if (!r.success) throw new Error("bad fixture");
  return r.data;
};

beforeEach(() => {
  query.mockReset().mockResolvedValue({ rows: [] });
  connect.mockReset();
  eraseEmailLogFor.mockReset().mockResolvedValue(0);
});

describe("reading a row", () => {
  it("maps the columns, with ISO times", () => {
    const p = toPledge(row({ pay_email_sent_at: new Date("2026-12-06T08:00:00Z"), checkout_session_id: "cs_test_9", hidden_at: new Date("2026-11-02T08:00:00Z") }));
    expect(p).toMatchObject({ id: 5, fundraiserId: 7, firstName: "Alex", amountPence: 1000, status: "open", tokenNonce: "nonce-a", refunded: false, checkoutSessionId: "cs_test_9" });
    expect(p.createdAt).toBe("2026-11-01T10:00:00.000Z");
    expect(p.payEmailSentAt).toBe("2026-12-06T08:00:00.000Z");
    expect(p.confirmedAt).toBe("2026-11-01T10:05:00.000Z");
    expect(p.confirmEmailSentAt).toBeNull();
    expect(toPledge(row({ confirm_email_sent_at: new Date("2026-11-01T10:00:02Z") })).confirmEmailSentAt).toBe("2026-11-01T10:00:02.000Z");
    expect(p.hiddenAt).toBe("2026-11-02T08:00:00.000Z");
  });
});

describe("making a pledge", () => {
  it("stores it UNCONFIRMED with a nonce for its links, and writes its History row, in one transaction", async () => {
    const { calls } = useClient((sql) => (/INSERT INTO sponsor_pledges/.test(sql) ? { rows: [row({ status: "unconfirmed" })] } : undefined));
    const out = await createPledge(7, parsed(), "nonce-a");
    expect(out.duplicate).toBe(false);
    expect(out.pledge.status).toBe("unconfirmed");
    expect(calls[0][0]).toBe("BEGIN");
    const insert = sqlIn(calls, /INSERT INTO sponsor_pledges/)!;
    expect(insert[0]).toMatch(/'unconfirmed'/);
    expect(insert[1]).toContain("nonce-a");
    expect(insert[1]).toContain("alex@example.com");
    expect(audits(calls)[0]).toEqual(["public", "pledge.created", "sponsor_pledge", 5, { fundraiserId: 7, amountPence: 1000, giftAid: false }]);
    expect(calls[calls.length - 1][0]).toBe("COMMIT");
  });

  it("keeps the Gift Aid declaration exactly as worded for that amount, dated now", async () => {
    const { calls } = useClient((sql) => (/INSERT INTO sponsor_pledges/.test(sql) ? { rows: [row({ gift_aid: true })] } : undefined));
    await createPledge(7, parsed({ giftAid: true, house: "12", address: "Example Street, Exampleton", postcode: "KA1 1AA" }), "n");
    const insert = sqlIn(calls, /INSERT INTO sponsor_pledges/)!;
    const w = pledgeDeclarationWording(1000);
    expect(insert[1]).toContain(w.wording_version);
    expect(insert[1]).toContain(w.wording_snapshot);
    expect(insert[0]).toMatch(/CASE WHEN \$\d+ THEN now\(\) END/);
  });

  it("keeps no declaration and no address without Gift Aid", async () => {
    const { calls } = useClient((sql) => (/INSERT INTO sponsor_pledges/.test(sql) ? { rows: [row()] } : undefined));
    await createPledge(7, parsed({ house: "12", address: "Example Street", postcode: "KA1 1AA" }), "n");
    const params = sqlIn(calls, /INSERT INTO sponsor_pledges/)![1];
    expect(params).not.toContain("12");
    expect(params.filter((v) => typeof v === "string" && v.startsWith("I want to Gift Aid"))).toEqual([]);
  });

  it("takes a lock for that sponsor on that page first, so two posts at once never make two pledges", async () => {
    const { calls } = useClient((sql) => (/INSERT INTO sponsor_pledges/.test(sql) ? { rows: [row({ status: "unconfirmed" })] } : undefined));
    await createPledge(7, parsed(), "n");
    expect(calls[1][0]).toBe("SELECT pg_advisory_xact_lock(hashtext($1))");
    expect(calls[1][1]).toEqual(["sponsor_pledge:7:alex@example.com"]);
    expect(calls.findIndex((c) => /pg_advisory_xact_lock/.test(c[0]))).toBeLessThan(calls.findIndex((c) => /interval '10 minutes'/.test(c[0])));
  });

  it("refuses a fourth unconfirmed pledge from one address in a day, on any page, storing nothing", async () => {
    const { calls } = useClient((sql) => (/count\(\*\)/.test(sql) ? { rows: [{ n: 3 }] } : undefined));
    const out = await createPledge(7, parsed(), "n");
    expect(out).toEqual({ pledge: null, duplicate: false, capped: true });
    const cap = sqlIn(calls, /count\(\*\)/)!;
    expect(cap[0]).toMatch(/status = 'unconfirmed' AND created_at > now\(\) - interval '24 hours'/);
    expect(cap[0]).not.toMatch(/fundraiser_id/);
    expect(cap[1]).toEqual(["alex@example.com"]);
    expect(sqlIn(calls, /INSERT INTO sponsor_pledges/)).toBeUndefined();
    expect(audits(calls)).toEqual([]);
  });

  it("a second press of the button makes no second pledge, confirmed yet or not", async () => {
    const { calls } = useClient((sql) => (/SELECT[\s\S]*FROM sponsor_pledges/.test(sql) && /interval '10 minutes'/.test(sql) ? { rows: [row()] } : undefined));
    const out = await createPledge(7, parsed(), "n");
    expect(out.duplicate).toBe(true);
    expect(sqlIn(calls, /interval '10 minutes'/)![0]).toMatch(/status IN \('unconfirmed', 'open'\)/);
    expect(sqlIn(calls, /INSERT INTO sponsor_pledges/)).toBeUndefined();
  });
});

describe("confirming by email", () => {
  it("makes an unconfirmed pledge open, once", async () => {
    const { calls } = useClient((sql) => (/UPDATE sponsor_pledges SET status = 'open'/.test(sql) ? { rows: [{ fundraiser_id: 7 }] } : undefined));
    expect(await confirmPledge(5)).toBe(true);
    const update = sqlIn(calls, /UPDATE sponsor_pledges SET status = 'open'/)!;
    expect(update[0]).toMatch(/confirmed_at = now\(\)/);
    expect(update[0]).toMatch(/WHERE id = \$1 AND status = 'unconfirmed'/);
    expect(audits(calls)[0]).toEqual(["sponsor", "pledge.confirmed", "sponsor_pledge", 5, { fundraiserId: 7 }]);
  });

  it("says no when there was nothing to confirm", async () => {
    const { calls } = useClient();
    expect(await confirmPledge(5)).toBe(false);
    expect(audits(calls)).toEqual([]);
  });

  it("one never confirmed is deleted outright, with the log rows of its emails", async () => {
    const { calls } = useClient((sql) => (/DELETE FROM sponsor_pledges/.test(sql) ? { rows: [{ fundraiser_id: 7, email: "alex@example.com" }] } : undefined));
    expect(await deleteUnconfirmedPledge(5)).toBe(true);
    expect(sqlIn(calls, /DELETE FROM sponsor_pledges/)![0]).toMatch(/WHERE id = \$1 AND status = 'unconfirmed'/);
    // In the SAME transaction: the pledge and its email log rows go together or not at all.
    const log = sqlIn(calls, /DELETE FROM email_log/)!;
    expect(log[1]).toEqual(["alex@example.com", ["fundraisePledgeConfirm", "fundraisePledgePay", "fundraisePledgeReminder"]]);
    expect(calls.findIndex((c) => /DELETE FROM email_log/.test(c[0]))).toBeLessThan(calls.findIndex((c) => c[0] === "COMMIT"));
    expect(eraseEmailLogFor).not.toHaveBeenCalled();
    expect(audits(calls)[0]).toEqual(["system:schedule", "pledge.unconfirmed_deleted", "sponsor_pledge", 5, { fundraiserId: 7 }]);
  });
});

describe("claiming each email once", () => {
  it("claims the pay email only for an open pledge nobody has claimed, or whose claim went stale", async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 5 }] });
    expect(await claimPledgeEmail(5, "pledge_pay")).toBe(true);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/UPDATE sponsor_pledges SET pay_email_claimed_at = now\(\)/);
    expect(sql).toMatch(/pay_email_claimed_at IS NULL OR \(pay_email_sent_at IS NULL AND pay_email_claimed_at < now\(\) - interval '1 hour'\)/);
    expect(sql).toMatch(/status = 'open'/);
    expect(params).toEqual([5]);
  });

  it("says no when it was claimed already", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    expect(await claimPledgeEmail(5, "pledge_reminder")).toBe(false);
    expect(query.mock.calls[0][0]).toMatch(/reminder_claimed_at IS NULL/);
    // The reminder only ever follows a pay email that went.
    expect(query.mock.calls[0][0]).toMatch(/pay_email_sent_at IS NOT NULL/);
  });

  it("gives a claim back after a failed send, never one that went", async () => {
    await releasePledgeEmail(5, "pledge_pay");
    expect(query.mock.calls[0][0]).toMatch(/SET pay_email_claimed_at = NULL WHERE id = \$1 AND pay_email_sent_at IS NULL/);
  });

  it("marks it sent, keeping the FIRST time it went, with a History row that carries no address", async () => {
    const { calls } = useClient();
    await markPledgeEmailSent(5, 7, "pledge_pay", "system:schedule");
    const update = sqlIn(calls, /UPDATE sponsor_pledges SET pay_email_sent_at/)!;
    expect(update[0]).toMatch(/pay_email_sent_at = COALESCE\(pay_email_sent_at, now\(\)\)/);
    expect(update[0]).toMatch(/pay_email_last_sent_at = now\(\)/);
    expect(audits(calls)[0]).toEqual(["system:schedule", "pledge.email_sent", "sponsor_pledge", 5, { fundraiserId: 7, kind: "pledge_pay" }]);
  });

  it("a pay link sent by hand is held for ten minutes, and counted apart", async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 5 }] });
    expect(await claimPayLinkResend(5)).toBe(true);
    const [sql] = query.mock.calls[0];
    expect(sql).toMatch(/pay_email_last_sent_at = now\(\), pay_email_resends = pay_email_resends \+ 1/);
    expect(sql).toMatch(/pay_email_last_sent_at IS NULL OR pay_email_last_sent_at < now\(\) - interval '10 minutes'/);
    expect(sql).toMatch(/status = 'open'/);
    expect(sql).not.toMatch(/pay_email_sent_at =/);
    query.mockResolvedValueOnce({ rows: [] });
    expect(await claimPayLinkResend(5)).toBe(false);
  });
});

describe("cancelling, cash, and hiding", () => {
  it("cancels only a pledge that is still open, and its links stop working", async () => {
    const { calls } = useClient((sql) => (/UPDATE sponsor_pledges SET status = 'cancelled'/.test(sql) ? { rows: [row({ status: "cancelled" })] } : undefined));
    expect(await cancelPledge(5, "sponsor")).toBe(true);
    const update = sqlIn(calls, /UPDATE sponsor_pledges SET status = 'cancelled'/)!;
    expect(update[0]).toMatch(/WHERE id = \$1 AND status = 'open'/);
    expect(update[0]).toMatch(/token_nonce = md5\(/);
    expect(audits(calls)[0]).toEqual(["sponsor", "pledge.cancelled", "sponsor_pledge", 5, { fundraiserId: 7 }]);
  });

  it("says no, and writes nothing, when it was not open", async () => {
    const { calls } = useClient();
    expect(await cancelPledge(5, "sponsor")).toBe(false);
    expect(audits(calls)).toEqual([]);
  });

  it("the organiser marks one of THEIR fundraiser's open pledges as paid in cash, and its home address goes at once", async () => {
    const { calls } = useClient((sql) => (/UPDATE sponsor_pledges AS p SET status = 'cash'/.test(sql) ? { rows: [row({ status: "cash" })] } : undefined));
    const p = await markPledgeCash(7, 5, true, "organiser:robin@example.com");
    expect(p?.status).toBe("cash");
    const update = sqlIn(calls, /UPDATE sponsor_pledges AS p SET status = 'cash'/)!;
    expect(update[0]).toMatch(/WHERE id = \$1 AND fundraiser_id = \$2 AND status = 'open'/);
    expect(update[0]).toMatch(/ga_house = NULL, ga_address = NULL, ga_postcode = NULL/);
    expect(update[1].slice(0, 2)).toEqual([5, 7]);
    expect(audits(calls)[0][1]).toBe("pledge.cash_marked");
  });

  it("and can undo it, back to open with fresh links, unless the details have gone", async () => {
    const { calls } = useClient((sql) => (/UPDATE sponsor_pledges AS p SET status = 'open'/.test(sql) ? { rows: [row()] } : undefined));
    await markPledgeCash(7, 5, false, "organiser:robin@example.com");
    const update = sqlIn(calls, /UPDATE sponsor_pledges AS p SET status = 'open'/)!;
    expect(update[0]).toMatch(/status = 'cash' AND anonymised_at IS NULL/);
    expect(update[0]).toMatch(/token_nonce = md5\(/);
    expect(audits(calls)[0][1]).toBe("pledge.cash_unmarked");
  });

  it("the organiser hides a pledge on THEIR fundraiser from the page, and can show it again", async () => {
    const { calls } = useClient((sql) => (/UPDATE sponsor_pledges AS p SET hidden_at/.test(sql) ? { rows: [row({ hidden_at: new Date() })] } : undefined));
    const p = await setPledgeHiddenByOrganiser(7, 5, true, "organiser:robin@example.com");
    expect(p?.hiddenAt).toBeTruthy();
    const update = sqlIn(calls, /UPDATE sponsor_pledges AS p SET hidden_at/)!;
    expect(update[0]).toMatch(/WHERE id = \$1 AND fundraiser_id = \$2 AND status <> 'unconfirmed'/);
    expect(audits(calls)[0]).toEqual(["organiser:robin@example.com", "pledge.hidden_by_organiser", "sponsor_pledge", 5, { fundraiserId: 7 }]);
  });

  it("staff hide a message, as they do a gift's", async () => {
    const { calls } = useClient((sql) => (/UPDATE sponsor_pledges SET message_hidden/.test(sql) ? { rows: [row({ message_hidden: true })] } : undefined));
    expect(await setPledgeMessageHidden(7, 5, true, "admin:fern@example.com")).toBe(true);
    expect(audits(calls)[0]).toEqual(["admin:fern@example.com", "pledge.message_hidden", "sponsor_pledge", 5, { fundraiserId: 7 }]);
  });

  it("remembers the checkout it opened, only if nobody else opened one since it was read", async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 5 }] });
    expect(await saveCheckoutSession(5, "cs_test_2", "cs_test_1")).toBe(true);
    expect(query.mock.calls[0]).toEqual([
      "UPDATE sponsor_pledges SET checkout_session_id = $2 WHERE id = $1 AND status = 'open' AND checkout_session_id IS NOT DISTINCT FROM $3 RETURNING id",
      [5, "cs_test_2", "cs_test_1"],
    ]);
    query.mockResolvedValueOnce({ rows: [] });
    expect(await saveCheckoutSession(5, "cs_test_3", null)).toBe(false);
  });
});

describe("the webhook marking a pledge paid", () => {
  const session = (metadata: Record<string, string>, amount = 1000) => ({ id: "cs_test_1", metadata, amount_total: amount }) as never;
  const made = { donationId: 90, declarationId: 31, eventId: "evt_1" };
  const found = (status: string, over: Record<string, unknown> = {}) => ({
    rows: [{ status, fundraiser_id: 7, gift_aid: true, ga_declared_at: new Date("2026-11-01T10:00:00Z"), ga_wording_version: "nbcc-pledge-single-2026-10", ga_wording_snapshot: "I want to Gift Aid…", ...over }],
  });

  it("reads the pledge a checkout session paid for, and nothing from any other session", () => {
    expect(pledgeFromSession(session({ pledgeId: "5", feeCoverPence: "40", pledgeDeclaredAt: "2026-11-01T10:00:00.000Z" }, 1040))).toEqual({
      pledgeId: 5,
      paidPence: 1000,
      declaredAt: "2026-11-01T10:00:00.000Z",
    });
    expect(pledgeFromSession(session({ pledgeId: "5", pledgeDeclaredAt: "not a date" }))).toEqual({ pledgeId: 5, paidPence: 1000, declaredAt: null });
    expect(pledgeFromSession(session({}))).toBeNull();
    expect(pledgeFromSession(session({ pledgeId: "abc" }))).toBeNull();
    expect(pledgeFromSession(session({ pledgeId: "0" }))).toBeNull();
  });

  it("marks it paid with the donation and its declaration, drops the address, kills its links, and writes History", async () => {
    const { calls, client } = useClient((sql) => (/SELECT status[\s\S]*FOR UPDATE/.test(sql) ? found("open") : undefined));
    await settlePledge(client as never, { pledgeId: 5, paidPence: 1500, declaredAt: "2026-11-01T10:00:00.000Z" }, made);
    const update = sqlIn(calls, /UPDATE sponsor_pledges SET status = 'paid'/)!;
    expect(update[0]).toMatch(/ga_house = NULL, ga_address = NULL, ga_postcode = NULL/);
    expect(update[0]).toMatch(/token_nonce = md5\(/);
    expect(update[0]).toMatch(/checkout_session_id = NULL/);
    expect(update[1]).toEqual([5, 1500, 90, 31]);
    expect(audits(calls)[0]).toEqual([
      "stripe",
      "pledge.paid",
      "sponsor_pledge",
      5,
      { eventId: "evt_1", fundraiserId: 7, donationId: 90, declarationId: 31, paidPence: 1500, giftAidDeclaredAt: "2026-11-01T10:00:00.000Z" },
    ]);
  });

  it("keeps when the declaration was made, and its words, in the table nothing can delete from under it", async () => {
    const { calls, client } = useClient((sql) => (/SELECT status[\s\S]*FOR UPDATE/.test(sql) ? found("open") : undefined));
    await settlePledge(client as never, { pledgeId: 5, paidPence: 1000, declaredAt: "2026-11-01T10:00:00.000Z" }, made);
    const kept = sqlIn(calls, /INSERT INTO sponsor_pledge_declarations/)!;
    expect(kept[1]).toEqual([5, 90, 31, "2026-11-01T10:00:00.000Z", "nbcc-pledge-single-2026-10", "I want to Gift Aid…"]);
  });

  it("keeps no declaration date for a payment with no Gift Aid", async () => {
    const { calls, client } = useClient((sql) => (/SELECT status[\s\S]*FOR UPDATE/.test(sql) ? found("open") : undefined));
    await settlePledge(client as never, { pledgeId: 5, paidPence: 1000, declaredAt: null }, { ...made, declarationId: null });
    expect(sqlIn(calls, /INSERT INTO sponsor_pledge_declarations/)).toBeUndefined();
  });

  it("a second payment for the same pledge is flagged for staff to check and refund, and changes nothing else", async () => {
    const { calls, client } = useClient((sql) => (/SELECT status[\s\S]*FOR UPDATE/.test(sql) ? found("paid") : undefined));
    await settlePledge(client as never, { pledgeId: 5, paidPence: 1000, declaredAt: null }, { donationId: 91, declarationId: null, eventId: "evt_2" });
    expect(sqlIn(calls, /UPDATE sponsor_pledges SET status = 'paid'/)).toBeUndefined();
    const flag = sqlIn(calls, /UPDATE sponsor_pledges SET double_paid_at = now\(\)/)!;
    expect(flag[1]).toEqual([5, 91]);
    // A further payment is told to staff again.
    expect(flag[0]).toMatch(/double_paid_alerted_at = NULL/);
    expect(audits(calls)[0]).toEqual(["stripe", "pledge.paid_again", "sponsor_pledge", 5, { eventId: "evt_2", fundraiserId: 7, donationId: 91, paidPence: 1000 }]);
  });

  it("one marked as paid in cash and then paid online is paid, and flagged too", async () => {
    const { calls, client } = useClient((sql) => (/SELECT status[\s\S]*FOR UPDATE/.test(sql) ? found("cash") : undefined));
    await settlePledge(client as never, { pledgeId: 5, paidPence: 1000, declaredAt: null }, { donationId: 92, declarationId: null, eventId: "evt_3" });
    expect(sqlIn(calls, /UPDATE sponsor_pledges SET status = 'paid'/)).toBeDefined();
    expect(sqlIn(calls, /UPDATE sponsor_pledges SET double_paid_at = now\(\)/)![1]).toEqual([5, 92]);
    expect((audits(calls)[0][4] as { paidAfter: string }).paidAfter).toBe("cash");
  });

  it("a payment for a pledge that is no longer there says so in History, and still keeps the declaration date", async () => {
    const { calls, client } = useClient();
    await settlePledge(client as never, { pledgeId: 5, paidPence: 1000, declaredAt: "2026-11-01T10:00:00.000Z" }, made);
    expect(audits(calls)[0]).toEqual(["stripe", "pledge.paid_missing", "sponsor_pledge", 5, { eventId: "evt_1", donationId: 90, paidPence: 1000 }]);
    expect(sqlIn(calls, /INSERT INTO sponsor_pledge_declarations/)![1]).toEqual([5, 90, 31, "2026-11-01T10:00:00.000Z", null, null]);
  });

  it("is fenced off: an error marking the pledge never rolls back the donation", async () => {
    const { calls, client } = useClient((sql) => {
      if (/SELECT status[\s\S]*FOR UPDATE/.test(sql)) throw new Error("boom");
      return undefined;
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(settlePledgeSafely(client as never, { pledgeId: 5, paidPence: 1000, declaredAt: null }, made)).resolves.toBeUndefined();
    expect(calls[0][0]).toBe("SAVEPOINT sponsor_pledge");
    expect(calls[calls.length - 1][0]).toBe("ROLLBACK TO SAVEPOINT sponsor_pledge");
  });

  it("takes Gift Aid off a second payment before it is recorded: one declaration covers one donation", async () => {
    const { client } = useClient((sql) => (/SELECT status FROM sponsor_pledges/.test(sql) ? { rows: [{ status: "paid" }] } : undefined));
    const s = { id: "cs_2", amount_total: 1000, metadata: { pledgeId: "5", giftAid: "true", declFirstName: "Alex", declAddress: "x", giftAidWording: "w", giftAidWordingVersion: "v", fundraiserId: "7" } };
    await guardPledgePayment(client as never, s as never);
    expect(s.metadata).toEqual({ pledgeId: "5", giftAid: "false", fundraiserId: "7" });
  });

  it("leaves a first payment, and every other gift, exactly as it came", async () => {
    const { client, calls } = useClient((sql) => (/SELECT status FROM sponsor_pledges/.test(sql) ? { rows: [{ status: "open" }] } : undefined));
    const first = { id: "cs_1", amount_total: 1000, metadata: { pledgeId: "5", giftAid: "true", declFirstName: "Alex" } };
    await guardPledgePayment(client as never, first as never);
    expect(first.metadata.giftAid).toBe("true");
    const before = calls.length;
    const gift = { id: "cs_3", amount_total: 1000, metadata: { giftAid: "true" } };
    await guardPledgePayment(client as never, gift as never);
    expect(calls.length).toBe(before);
  });

  it("staff mark one paid twice as checked", async () => {
    const { calls } = useClient((sql) => (/UPDATE sponsor_pledges SET double_paid_checked_at/.test(sql) ? { rows: [{ fundraiser_id: 7 }] } : undefined));
    expect(await markDoublePaidChecked(5, "admin:fern@example.com")).toBe(true);
    expect(audits(calls)[0]).toEqual(["admin:fern@example.com", "pledge.double_paid_checked", "sponsor_pledge", 5, { fundraiserId: 7 }]);
  });
});

describe("removing personal details", () => {
  it("empties the name, email, message and address, keeps the amount, an open one becomes expired, and the email log forgets them", async () => {
    const { calls } = useClient((sql) => {
      if (/SELECT email FROM sponsor_pledges/.test(sql)) return { rows: [{ email: "alex@example.com" }] };
      if (/UPDATE sponsor_pledges/.test(sql)) return { rows: [{ fundraiser_id: 7, status: "expired" }] };
      return undefined;
    });
    await anonymisePledge(5);
    const [sql] = sqlIn(calls, /UPDATE sponsor_pledges/)!;
    for (const col of ["first_name", "surname", "email", "message", "ga_house", "ga_address", "ga_postcode"]) expect(sql).toContain(`${col} = NULL`);
    expect(sql).not.toMatch(/amount_pence\s*=/);
    expect(sql).toMatch(/status = CASE WHEN status = 'open' THEN 'expired' ELSE status END/);
    expect(sql).toMatch(/anonymised_at IS NULL AND status NOT IN \('paid', 'unconfirmed'\)/);
    expect(sqlIn(calls, /DELETE FROM email_log/)![1]).toEqual(["alex@example.com", ["fundraisePledgeConfirm", "fundraisePledgePay", "fundraisePledgeReminder"]]);
    expect(audits(calls)[0]).toEqual(["system:schedule", "pledge.anonymised", "sponsor_pledge", 5, { fundraiserId: 7, status: "expired" }]);
  });

  it("a paid pledge only loses its email, and its log rows", async () => {
    const { calls } = useClient((sql) => (/SELECT email FROM sponsor_pledges/.test(sql) ? { rows: [{ email: "alex@example.com" }] } : undefined));
    await trimPaidPledge(5);
    expect(sqlIn(calls, /DELETE FROM email_log/)![1][0]).toBe("alex@example.com");
    expect(sqlIn(calls, /UPDATE sponsor_pledges SET email = NULL WHERE id = \$1 AND status = 'paid'/)).toBeDefined();
    expect(calls[calls.length - 1][0]).toBe("COMMIT");
  });
});
