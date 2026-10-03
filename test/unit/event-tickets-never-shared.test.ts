import { describe, it, expect, vi } from "vitest";

// Event tickets: NBCC never sells the tickets of an event that shares with another cause, on the
// staff paths too. A staff change of "How do people get in?" to NBCC is refused for a sharing event,
// and a staff change of the split to sharing is refused once NBCC sells the event's tickets (or any
// ticket order exists). Both under the row's lock, against a fake client. Every name is invented.

vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));
vi.mock("../../src/config", () => ({ config: { NODE_ENV: "test" } }));

import { pool } from "../../src/db/pool";
import { FundraiserError, decideEdit, patchFundraiser, setFundraiserSplit } from "../../src/db/fundraisers";

const row = (over: Record<string, unknown> = {}) => ({
  id: 9, slug: "example-quiz", path: "event", kind: "quiz", title: "Example Quiz", description: "", event_date: "2099-12-05",
  start_time: "19:30", venue: "Hall", town: "", target_pence: null, public: true, status: "approved", organiser_name: "Kim Example",
  organiser_email: "kim@example.com", organiser_phone: "07700 900456", social_link: null, social_ok: false, wants: {},
  post_address: null, newsletter_ok: false, image_src: null, declined_reason: null, created_at: "2026-10-02T10:00:00Z",
  approved_at: null, approved_by: null, updated_at: "2026-10-02T10:00:00Z", updated_by: null, booking: "door", shares_with_other: false, ...over,
});

function useClient(stored: Record<string, unknown>, orders = 0) {
  const calls: string[] = [];
  const client = {
    query: vi.fn(async (sql: string) => {
      calls.push(sql);
      if (sql.includes("FROM fundraisers f WHERE f.id = $1")) return { rows: [stored] };
      if (sql.includes("FROM fundraiser_edits")) return { rows: [{ changes: { booking: "nbcc" }, status: "waiting" }] };
      if (sql.includes("FROM event_ticket_orders")) return { rows: orders ? [{ "?column?": 1 }] : [], rowCount: orders };
      if (sql.includes("count(*)")) return { rows: [{ n: "0" }] };
      return { rows: [], rowCount: 0 };
    }),
    release: vi.fn(),
  };
  (pool.connect as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(client);
  return calls;
}

const reason = async (work: Promise<unknown>) => {
  try {
    await work;
    return null;
  } catch (err) {
    return err instanceof FundraiserError ? err.reason : String(err);
  }
};

const SHARING = { sharesWithOther: true, nbccSharePercent: 50, otherCauseName: "Exampleton Food Larder" };

describe("a staff change of how people get in", () => {
  it("is refused when it makes NBCC sell the tickets of an event that shares", async () => {
    const calls = useClient(row({ shares_with_other: true, nbcc_share_percent: 50, other_cause_name: "Exampleton Food Larder" }));
    expect(await reason(patchFundraiser(9, { booking: "nbcc" }, "admin:a@example.com"))).toBe("tickets_shared");
    expect(calls.some((s) => /UPDATE fundraisers/.test(s))).toBe(false);
  });

  it("is allowed when the event does not share", async () => {
    useClient(row());
    expect(await reason(patchFundraiser(9, { booking: "nbcc" }, "admin:a@example.com"))).toBeNull();
  });
});

describe("a staff change of the split", () => {
  it("is refused when NBCC sells the event's tickets", async () => {
    const calls = useClient(row({ booking: "nbcc" }));
    expect(await reason(setFundraiserSplit(9, SHARING, "admin:a@example.com"))).toBe("tickets_no_split");
    expect(calls.some((s) => /UPDATE fundraisers SET shares_with_other/.test(s))).toBe(false);
  });

  it("is refused when the event has ever taken a ticket order, whatever it says now", async () => {
    useClient(row({ booking: "door" }), 1);
    expect(await reason(setFundraiserSplit(9, SHARING, "admin:a@example.com"))).toBe("tickets_no_split");
  });

  it("is allowed for an event with no tickets, and to stop sharing", async () => {
    useClient(row());
    expect(await reason(setFundraiserSplit(9, SHARING, "admin:a@example.com"))).toBeNull();
    useClient(row({ booking: "nbcc" }));
    expect(await reason(setFundraiserSplit(9, { sharesWithOther: false, nbccSharePercent: null, otherCauseName: null }, "admin:a@example.com"))).toBeNull();
  });
});

describe("approving an organiser's change of how people get in", () => {
  it("is refused when it would make NBCC sell the tickets of an event that shares", async () => {
    const calls = useClient(row({ shares_with_other: true, nbcc_share_percent: 50, other_cause_name: "Exampleton Food Larder" }));
    expect(await reason(decideEdit(9, 3, true, "admin:a@example.com"))).toBe("tickets_shared");
    expect(calls.some((s) => /UPDATE fundraisers/.test(s))).toBe(false);
  });

  it("can still be rejected", async () => {
    useClient(row({ shares_with_other: true }));
    expect(await reason(decideEdit(9, 3, false, "admin:a@example.com"))).toBeNull();
  });
});

describe("the split and a checkout at the same moment", () => {
  it("waits behind the event's ticket lock, so neither can slip past the other", async () => {
    const calls = useClient(row());
    await setFundraiserSplit(9, SHARING, "admin:a@example.com");
    const lock = calls.findIndex((s) => /FROM event_ticket_settings WHERE fundraiser_id = \$1 FOR UPDATE/.test(s));
    const look = calls.findIndex((s) => /FROM event_ticket_orders/.test(s));
    expect(lock).toBeGreaterThan(-1);
    expect(lock).toBeLessThan(look);
  });
});
