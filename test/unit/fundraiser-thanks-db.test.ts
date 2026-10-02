import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-507: the SQL behind "Thank your supporters", against a mocked pool (no database). Sending one
// for checking locks the fundraiser, checks it is the organiser's own and running, counts the day's
// thank yous, checks every gift picked is a real gift on THIS fundraiser, skips gifts already thanked,
// and records it in audit_log, all in one transaction. Every name and number is invented.

const { query, connect } = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn() }));
vi.mock("../../src/db/pool", () => ({ pool: { query, connect } }));
vi.mock("../../src/config", () => ({ config: { NODE_ENV: "test" } }));

import {
  createThanks,
  decideThanks,
  claimNextQueuedThanksGift,
  finishThanksGift,
  markThanksDeliveredIfDone,
  failStaleSending,
  hasQueuedThanks,
  undeliveredDoneThanks,
  heldDonationIds,
  listThanks,
  listThanksForStaff,
  pendingThanksByFundraiser,
  countPendingThanks,
  ThanksError,
} from "../../src/db/fundraiser-thanks";

type Answer = (sql: string, params: unknown[]) => unknown;
function useClient(answer: Answer) {
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

const thanksRow = (over: Record<string, unknown> = {}) => ({
  id: 3,
  fundraiser_id: 9,
  message: "Thank you all!",
  status: "pending",
  created_at: new Date("2026-10-02T10:00:00Z"),
  decided_at: null,
  decided_by: null,
  reject_reason: null,
  delivered_at: null,
  gifts: "2",
  waiting: "0",
  sent: "0",
  skipped: "0",
  failed: "0",
  ...over,
});

// The organiser's fundraiser, the day's count, which picked gifts are real and which are taken.
function creating(o: { owner?: string; status?: string; today?: number; real?: number[]; held?: number[] } = {}) {
  return useClient((sql, params) => {
    if (/FROM fundraisers WHERE id = \$1 FOR UPDATE/.test(sql)) {
      return { rows: [{ id: 9, organiser_email: o.owner ?? "Sam@Example.com", status: o.status ?? "approved" }] };
    }
    if (/count\(\*\) AS n FROM fundraiser_thanks/.test(sql)) return { rows: [{ n: String(o.today ?? 0) }] };
    if (/SELECT d\.id FROM donations d/.test(sql)) {
      const asked = params[0] as number[];
      return { rows: asked.filter((id) => (o.real ?? [41, 42]).includes(id)).map((id) => ({ id })) };
    }
    if (/SELECT g\.donation_id FROM fundraiser_thank_gifts g/.test(sql)) return { rows: (o.held ?? []).map((id) => ({ donation_id: id })) };
    if (/INSERT INTO fundraiser_thanks/.test(sql)) return { rows: [thanksRow({ message: params[1] })] };
    return { rows: [] };
  });
}

beforeEach(() => {
  query.mockReset().mockResolvedValue({ rows: [] });
  connect.mockReset();
});

describe("sending a thank you for checking", () => {
  it("locks the fundraiser, keeps the words and the gifts picked, and records it", async () => {
    const { calls, client } = creating();
    const out = await createThanks(9, "sam@example.com", "Thank you all!", [41, 42]);
    expect(out).toMatchObject({ verdict: "ok", alreadyThanked: 0, thanks: { id: 3, status: "pending", gifts: 2, message: "Thank you all!" } });
    const insert = sqlIn(calls, /INSERT INTO fundraiser_thank_gifts/)!;
    expect(insert[1]).toEqual([3, [41, 42]]);
    expect(audits(calls)[0]).toEqual(["organiser", "fundraiser.thanks_posted", "fundraiser", 9, { thanksId: 3, gifts: 2, alreadyThanked: 0 }]);
    expect(calls[0][0]).toBe("BEGIN");
    expect(calls[calls.length - 1][0]).toBe("COMMIT");
    expect(client.release).toHaveBeenCalled();
  });

  it("only checks gifts that are paid, on this fundraiser, not paid in, and not refunded in full", async () => {
    const { calls } = creating();
    await createThanks(9, "sam@example.com", "Thanks", [41]);
    const check = sqlIn(calls, /SELECT d\.id FROM donations d/)!;
    expect(check[0]).toMatch(/d\.fundraiser_id = \$2/);
    expect(check[0]).toMatch(/d\.payment_status = 'paid'/);
    expect(check[0]).toMatch(/NOT d\.paid_in_by_organiser/);
    expect(check[0]).toMatch(/d\.amount_pence - d\.refunded_amount_pence > 0/);
    expect(check[1]).toEqual([[41], 9]);
  });

  it("refuses the lot when any gift picked is not a gift on this fundraiser (another's, a pay in, made up)", async () => {
    const { calls } = creating({ real: [41] });
    expect(await createThanks(9, "sam@example.com", "Thanks", [41, 777])).toEqual({ verdict: "bad_gift" });
    expect(sqlIn(calls, /INSERT INTO fundraiser_thanks/)).toBeUndefined();
    expect(sqlIn(calls, /INSERT INTO fundraiser_thank_gifts/)).toBeUndefined();
  });

  it("skips gifts already thanked, and says how many", async () => {
    const { calls } = creating({ held: [41] });
    const out = await createThanks(9, "sam@example.com", "Thanks", [41, 42]);
    expect(out).toMatchObject({ verdict: "ok", alreadyThanked: 1, thanks: { gifts: 1 } });
    expect(sqlIn(calls, /INSERT INTO fundraiser_thank_gifts/)![1]).toEqual([3, [42]]);
    expect(sqlIn(calls, /SELECT g\.donation_id FROM fundraiser_thank_gifts g/)![0]).toMatch(/outcome <> 'cancelled'/);
  });

  it("stores nothing when every gift picked is thanked already", async () => {
    const { calls } = creating({ held: [41, 42] });
    expect(await createThanks(9, "sam@example.com", "Thanks", [41, 42])).toEqual({ verdict: "none" });
    expect(sqlIn(calls, /INSERT INTO fundraiser_thanks/)).toBeUndefined();
  });

  it("allows three in a day for one fundraiser, and stores nothing past that", async () => {
    const { calls } = creating({ today: 3 });
    expect(await createThanks(9, "sam@example.com", "Thanks", [41])).toEqual({ verdict: "limit" });
    expect(sqlIn(calls, /INSERT INTO fundraiser_thanks/)).toBeUndefined();
    expect(sqlIn(calls, /count\(\*\) AS n FROM fundraiser_thanks/)![0]).toMatch(/created_at > now\(\) - interval '24 hours'/);
  });

  it("reads someone else's fundraiser as not there", async () => {
    const { calls } = creating({ owner: "other@example.com" });
    await expect(createThanks(9, "sam@example.com", "Thanks", [41])).rejects.toEqual(new ThanksError("not_found"));
    expect(calls[calls.length - 1][0]).toBe("ROLLBACK");
  });

  it("refuses a fundraiser that is not running or finished", async () => {
    creating({ status: "new" });
    await expect(createThanks(9, "sam@example.com", "Thanks", [41])).rejects.toEqual(new ThanksError("bad_status"));
  });
});

describe("reading", () => {
  it("reads the gifts already in a thank you, on these fundraisers", async () => {
    query.mockResolvedValue({ rows: [{ donation_id: 41 }, { donation_id: 42 }] });
    expect(await heldDonationIds([9])).toEqual(new Set([41, 42]));
    expect(query.mock.calls[0][0]).toMatch(/outcome <> 'cancelled'/);
    expect(await heldDonationIds([])).toEqual(new Set());
  });

  it("reads the thank yous with their counts", async () => {
    query.mockResolvedValue({ rows: [thanksRow({ status: "approved", sent: "1", skipped: "1", delivered_at: new Date("2026-10-02T11:00:00Z") })] });
    expect(await listThanks([9])).toEqual([
      {
        id: 3,
        fundraiserId: 9,
        message: "Thank you all!",
        status: "approved",
        createdAt: "2026-10-02T10:00:00.000Z",
        decidedAt: null,
        decidedBy: null,
        rejectReason: null,
        deliveredAt: "2026-10-02T11:00:00.000Z",
        gifts: 2,
        waiting: 0,
        sent: 1,
        skipped: 1,
        failed: 0,
      },
    ]);
  });

  it("gives staff each gift's name, amount and what happened, never an address", async () => {
    query
      .mockResolvedValueOnce({ rows: [thanksRow()] })
      .mockResolvedValueOnce({
        rows: [{ thanks_id: 3, donation_id: 41, outcome: "skipped", skip_reason: "suppressed", sent_at: null, full_name: "Alex Example", amount_pence: 2000, refunded_amount_pence: 0 }],
      });
    const [t] = await listThanksForStaff(9);
    expect(t.recipients).toEqual([{ donationId: 41, name: "Alex Example", amountPence: 2000, outcome: "skipped", skipReason: "suppressed", sentAt: null }]);
    expect(query.mock.calls[1][0]).not.toMatch(/email/);
  });

  it("counts the thank yous waiting for staff, all together and for each fundraiser", async () => {
    query.mockResolvedValueOnce({ rows: [{ n: "4" }] });
    expect(await countPendingThanks()).toBe(4);
    query.mockResolvedValueOnce({ rows: [{ fundraiser_id: 9, n: "2" }] });
    expect(await pendingThanksByFundraiser()).toEqual({ 9: 2 });
  });
});

describe("staff deciding", () => {
  function deciding(status: string) {
    return useClient((sql) => {
      if (/SELECT status FROM fundraiser_thanks/.test(sql)) return { rows: status ? [{ status }] : [] };
      if (/count\(g\.id\) AS gifts/.test(sql)) return { rows: [thanksRow({ status: "approved", waiting: "2" })] };
      return { rows: [] };
    });
  }

  it("approves: every gift is queued to send, and it is recorded", async () => {
    const { calls } = deciding("pending");
    const out = await decideThanks(9, 3, "approve", "admin:fern@example.com");
    expect(out).toMatchObject({ id: 3, status: "approved", waiting: 2 });
    expect(sqlIn(calls, /UPDATE fundraiser_thank_gifts SET outcome = 'queued'/)).toBeTruthy();
    expect(audits(calls)[0]).toEqual(["admin:fern@example.com", "fundraiser.thanks_approved", "fundraiser", 9, { thanksId: 3 }]);
  });

  it("does not send: its gifts are freed to thank again, and the reason stays with staff", async () => {
    const { calls } = deciding("pending");
    await decideThanks(9, 3, "reject", "admin:fern@example.com", "Names a giver");
    expect(sqlIn(calls, /UPDATE fundraiser_thank_gifts SET outcome = 'cancelled'/)).toBeTruthy();
    expect(sqlIn(calls, /UPDATE fundraiser_thanks SET status = \$1/)![1]).toEqual(["rejected", "admin:fern@example.com", "Names a giver", 3]);
    expect(audits(calls)[0]).toEqual(["admin:fern@example.com", "fundraiser.thanks_rejected", "fundraiser", 9, { thanksId: 3, reason: "Names a giver" }]);
  });

  it("refuses one already decided, or not on this fundraiser", async () => {
    deciding("approved");
    await expect(decideThanks(9, 3, "approve", "admin:fern@example.com")).rejects.toEqual(new ThanksError("not_waiting"));
    deciding("");
    await expect(decideThanks(9, 3, "approve", "admin:fern@example.com")).rejects.toEqual(new ThanksError("not_found"));
  });
});

describe("sending, one at a time", () => {
  it("claims the next queued gift so no other sender can take it, with what the email needs", async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 70, thanks_id: 3, donation_id: 41 }] }).mockResolvedValueOnce({
      rows: [
        {
          thanks_id: 3,
          fundraiser_id: 9,
          message: "Thank you all!",
          title: "Sam's Walk",
          organiser_name: "Sam Sample",
          full_name: "Alex Example",
          email: "alex@example.com",
          email_consent: false,
          thankyou_consent: false,
          already_sent: false,
        },
      ],
    });
    const g = await claimNextQueuedThanksGift();
    expect(query.mock.calls[0][0]).toMatch(/SET outcome = 'sending'/);
    expect(query.mock.calls[0][0]).toMatch(/FOR UPDATE SKIP LOCKED/);
    expect(g).toEqual({
      id: 70,
      thanksId: 3,
      fundraiserId: 9,
      donationId: 41,
      message: "Thank you all!",
      title: "Sam's Walk",
      organiserName: "Sam Sample",
      donorName: "Alex Example",
      email: "alex@example.com",
      emailConsent: false,
      thankyouConsent: false,
      alreadySent: false,
    });
  });

  it("has nothing to claim when nothing is queued", async () => {
    expect(await claimNextQueuedThanksGift()).toBeNull();
  });

  it("records each gift's outcome, with the reason for a skip", async () => {
    await finishThanksGift(70, "skipped", "suppressed");
    expect(query.mock.calls[0][1]).toEqual([70, "skipped", "suppressed"]);
    expect(query.mock.calls[0][0]).toMatch(/WHERE id = \$1 AND outcome = 'sending'/);
  });

  it("marks a thank you delivered once the last gift is dealt with, and records the counts once", async () => {
    const { calls } = useClient((sql) => {
      if (/UPDATE fundraiser_thanks t SET delivered_at = now\(\)/.test(sql)) return { rows: [{ fundraiser_id: 9 }] };
      if (/count\(\*\) FILTER/.test(sql)) return { rows: [{ sent: "1", skipped: "1", failed: "0" }] };
      return { rows: [] };
    });
    expect(await markThanksDeliveredIfDone(3)).toBe(true);
    expect(sqlIn(calls, /SET delivered_at/)![0]).toMatch(/delivered_at IS NULL/);
    expect(audits(calls)[0]).toEqual(["system", "fundraiser.thanks_delivered", "fundraiser", 9, { thanksId: 3, sent: 1, skipped: 1, failed: 0 }]);
  });

  it("does nothing while gifts are still to send", async () => {
    const { calls } = useClient(() => ({ rows: [] }));
    expect(await markThanksDeliveredIfDone(3)).toBe(false);
    expect(audits(calls)).toEqual([]);
  });

  it("gives up on a gift left sending by a restart, rather than risk emailing twice", async () => {
    query.mockResolvedValue({ rows: [{ thanks_id: 3 }, { thanks_id: 3 }] });
    expect(await failStaleSending()).toEqual([3]);
    expect(query.mock.calls[0][0]).toMatch(/SET outcome = 'failed'/);
    expect(query.mock.calls[0][0]).toMatch(/outcome = 'sending' AND updated_at < now\(\) - interval '15 minutes'/);
  });

  it("finds approved thank yous with nothing left to send that were never marked delivered", async () => {
    query.mockResolvedValue({ rows: [{ id: 6 }, { id: 8 }] });
    expect(await undeliveredDoneThanks()).toEqual([6, 8]);
    const sql = query.mock.calls[0][0];
    expect(sql).toMatch(/status = 'approved' AND t\.delivered_at IS NULL/);
    expect(sql).toMatch(/NOT EXISTS/);
  });

  it("has work to resume when a gift is queued, left sending, or a thank you is left unmarked", async () => {
    query.mockResolvedValue({ rows: [{ queued: true }] });
    expect(await hasQueuedThanks()).toBe(true);
    const sql = query.mock.calls[0][0];
    expect(sql).toMatch(/outcome = 'queued'/);
    expect(sql).toMatch(/outcome = 'sending' AND updated_at < now\(\) - interval '15 minutes'/);
    expect(sql).toMatch(/delivered_at IS NULL/);
  });
});
