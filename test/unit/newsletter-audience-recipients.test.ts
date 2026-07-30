import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-270: who a send actually reaches. This is the load-bearing decision in the whole newsletter
// feature — get it wrong and volunteer comms go to donors — and it had NO unit coverage before.
//
// It used to key off the literal slug string 'newsletter'; it now keys off the audience's KIND, so
// renaming a row cannot silently drop every donor from a send. The promises under test:
//   manual   — exactly its members, and the donors table is never consulted;
//   donors   — the live donor audience only, and the list's own rows are never consulted;
//   everyone — both, deduped by address with the DONOR identity winning (their unsubscribe token
//              revokes global consent; a subscriber's only leaves one list — so on a tie the token
//              with the wider blast radius must be the one issued).

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock("../../src/db/pool", () => ({ pool: { query: queryMock, connect: vi.fn() } }));

import { listRecipientsForList } from "../../src/db/newsletters";

const MEMBERS = /from\s+list_subscribers/i;
const DONORS = /from\s+donors/i;
const SUPPRESSED = /from\s+email_suppressions/i;

// Answer each query by what it asks for, so a test states its world once.
function world(
  members: { id: number; name: string | null; email: string }[],
  donors: { email: string; donor_id: number; full_name: string | null }[],
  suppressed: string[] = [],
) {
  queryMock.mockImplementation((sql: string) => {
    // order matters: the suppression query also mentions no other table, so test it first
    if (SUPPRESSED.test(String(sql))) return Promise.resolve({ rows: suppressed.map((email) => ({ email })) });
    if (MEMBERS.test(String(sql))) return Promise.resolve({ rows: members });
    if (DONORS.test(String(sql))) return Promise.resolve({ rows: donors });
    return Promise.resolve({ rows: [] });
  });
}

const asked = (re: RegExp) => queryMock.mock.calls.some((c) => re.test(String(c[0])));

beforeEach(() => {
  queryMock.mockReset();
});

describe("listRecipientsForList — audience kinds (TASK-270)", () => {
  it("manual: exactly its own members, and never touches the donors table", async () => {
    world([{ id: 7, name: "Casey", email: "Casey@Street.example" }], [{ email: "d@x.example", donor_id: 1, full_name: "Dee" }]);
    const out = await listRecipientsForList({ id: 4, kind: "manual" });
    expect(out).toEqual([{ email: "casey@street.example", donorId: null, subscriberId: 7, fullName: "Casey" }]);
    expect(asked(DONORS)).toBe(false); // a volunteer send must not reach donors
  });

  it("donors: the live donor audience only, and never reads the list's own rows", async () => {
    world([{ id: 7, name: "Casey", email: "casey@street.example" }], [{ email: "dee@x.example", donor_id: 3, full_name: "Dee" }]);
    const out = await listRecipientsForList({ id: 2, kind: "donors" });
    expect(out).toEqual([{ email: "dee@x.example", donorId: 3, subscriberId: null, fullName: "Dee" }]);
    expect(asked(MEMBERS)).toBe(false);
  });

  it("everyone: members plus donors, sorted by address", async () => {
    world(
      [{ id: 7, name: "Casey", email: "casey@street.example" }],
      [{ email: "dee@x.example", donor_id: 3, full_name: "Dee" }],
    );
    const out = await listRecipientsForList({ id: 1, kind: "everyone" });
    expect(out.map((r) => r.email)).toEqual(["casey@street.example", "dee@x.example"]);
    expect(asked(MEMBERS)).toBe(true);
    expect(asked(DONORS)).toBe(true);
  });

  it("everyone: someone on both sides is mailed ONCE, as the donor", async () => {
    world(
      [{ id: 7, name: "Sub Name", email: "both@x.example" }],
      [{ email: "both@x.example", donor_id: 9, full_name: "Donor Name" }],
    );
    const out = await listRecipientsForList({ id: 1, kind: "everyone" });
    expect(out).toHaveLength(1);
    // donor identity wins: their token revokes global consent, the wider of the two
    expect(out[0]).toEqual({ email: "both@x.example", donorId: 9, subscriberId: null, fullName: "Donor Name" });
  });

  // TASK-272: the whole point of the suppression list. Mailing a dead address or someone who pressed
  // "report spam" is what gets a sending domain junked — and this resolver is the ONE place both the
  // send loop and the recipient preview go through, so the count confirmed is the count mailed.
  it("drops hard-bounced and complained addresses from every audience kind", async () => {
    for (const kind of ["manual", "everyone", "donors"] as const) {
      world(
        [{ id: 7, name: "Casey", email: "casey@street.example" }],
        [{ email: "dead@x.example", donor_id: 3, full_name: "Dee" }],
        ["dead@x.example", "casey@street.example"],
      );
      const out = await listRecipientsForList({ id: 1, kind });
      expect(out, `kind=${kind}`).toEqual([]);
    }
  });

  it("leaves everyone else alone, and asks about suppression ONCE per send", async () => {
    world(
      [{ id: 7, name: "Casey", email: "casey@street.example" }],
      [{ email: "dead@x.example", donor_id: 3, full_name: "Dee" }],
      ["dead@x.example"],
    );
    const out = await listRecipientsForList({ id: 1, kind: "everyone" });
    expect(out.map((r) => r.email)).toEqual(["casey@street.example"]);
    const lookups = queryMock.mock.calls.filter((c) => SUPPRESSED.test(String(c[0])));
    expect(lookups).toHaveLength(1); // batched, never per-recipient
  });

  it("only ACTIVE members count — the tombstone filter stays in the query", async () => {
    world([], []);
    await listRecipientsForList({ id: 4, kind: "manual" });
    const sql = String(queryMock.mock.calls.find((c) => MEMBERS.test(String(c[0])))?.[0] ?? "");
    expect(sql).toMatch(/unsubscribed_at\s+is\s+null/i);
  });
});
