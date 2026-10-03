import { describe, it, expect, vi } from "vitest";

// Welcome packs in the Monday summary: "N welcome packs to send" (a page approved more than 2 days
// ago whose pack is not yet sent), "N welcome packs waiting for a T-shirt size" (never a sign up
// still new) and "N in memory pages with things to send", all in "Waiting on us", and read with
// everything else the summary reads. Every name is invented.

const { query, connect } = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn() }));
vi.mock("../../src/db/pool", () => ({ pool: { query, connect } }));
vi.mock("../../src/config", () => ({ config: { NODE_ENV: "test" } }));

import { summaryCounts, summaryLines, type SummaryFundraiser, type SummaryInputs } from "../../src/fundraising/summary";
import { readSummaryInputs } from "../../src/db/fundraising-team";

const NOW = new Date("2026-12-07T08:00:00Z"); // a Monday
const NONE = { posterCount: 0, leafletCount: 0, bucketCount: 0, tinCount: 0, leaflets: 0, buckets: 0, shoutOut: false, attend: false };
const fundraiser = (id: number, over: Record<string, unknown> = {}) =>
  ({
    id, slug: `f-${id}`, path: "raising", kind: "walk", title: `Walk ${id}`, description: "", eventDate: null, startTime: null, venue: "", town: "",
    targetPence: null, public: true, status: "approved", name: "Robin Example", email: "robin@example.com", phone: "", socialLink: null,
    socialOk: false, wants: { ...NONE }, postAddress: null, postLine1: "1 Example Road", postLine2: null, postTown: "Exampleton",
    postPostcode: "EX1 1EX", newsletterOk: false, imageSrc: null, declinedReason: null, createdAt: "2026-11-01T10:00:00.000Z",
    approvedAt: "2026-11-02T10:00:00.000Z", approvedBy: "admin:fern@example.com", updatedAt: "2026-11-02T10:00:00.000Z", updatedBy: null,
    meter: { raisedPence: 0 }, editWaiting: false, isSporting: false, tshirtSize: null, inMemory: false, teamId: null,
    ...over,
  }) as unknown as SummaryFundraiser;
const inputs = (over: Partial<SummaryInputs> = {}): SummaryInputs => ({ now: NOW, fundraisers: [], gifts: [], cash: [], calls: [], invites: [], ...over });

describe("welcome packs in the Monday summary", () => {
  it("counts packs to send and who is waiting for a T-shirt size, in what is waiting", () => {
    const c = summaryCounts(
      inputs({
        fundraisers: [
          fundraiser(1),
          fundraiser(2, { isSporting: true }),
          fundraiser(3), // sent
          fundraiser(4, { approvedAt: "2026-12-06T10:00:00.000Z" }), // approved yesterday: not yet
          fundraiser(5, { status: "new", approvedAt: null, isSporting: true }), // still new: not counted
          fundraiser(6, { isSporting: true }),
          fundraiser(7, { inMemory: true, memoryName: "Margaret Exampleton", wants: { ...NONE, envelopeCount: 30 } }),
          fundraiser(8, { inMemory: true, memoryName: "Kit Example" }), // asked for nothing: nothing to send
        ],
        packsSent: [3],
      }),
    );
    expect(c.packsToSend).toBe(3);
    expect(c.tshirtWaiting).toBe(2);
    expect(c.memoryToSend).toBe(1);
    expect(c.waiting).toBe(6 + c.toApprove);
    const lines = summaryLines(c);
    expect(lines.waiting).toContain("3 welcome packs to send");
    expect(lines.waiting).toContain("2 welcome packs waiting for a T-shirt size");
    expect(lines.waiting).toContain("1 in memory page with things to send");
  });

  it("says in memory pages in the plural", () => {
    const two = [7, 8].map((id) => fundraiser(id, { inMemory: true, memoryName: "Margaret Exampleton", wants: { ...NONE, envelopeCount: 30 } }));
    expect(summaryLines(summaryCounts(inputs({ fundraisers: two, packsSent: [] }))).waiting).toContain("2 in memory pages with things to send");
  });

  it("says one in the singular", () => {
    const lines = summaryLines(summaryCounts(inputs({ fundraisers: [fundraiser(1, { isSporting: true })], packsSent: [] })));
    expect(lines.waiting).toContain("1 welcome pack to send");
    expect(lines.waiting).toContain("1 welcome pack waiting for a T-shirt size");
  });

  it("says nothing of packs when none is waiting, or when the sent ones could not be read", () => {
    const c = summaryCounts(inputs({ fundraisers: [fundraiser(1)], packsSent: [1] }));
    expect(c.packsToSend).toBe(0);
    expect(summaryLines(c).waiting.join(" ")).not.toMatch(/welcome pack|T-shirt|things to send/);
    // Not read: no line, rather than every pack ever sent counted as waiting.
    const unread = summaryCounts(inputs({ fundraisers: [fundraiser(1, { isSporting: true }), fundraiser(7, { inMemory: true, memoryName: "Kit Example", wants: { ...NONE, envelopeCount: 3 } })], packsSent: null }));
    expect([unread.packsToSend, unread.tshirtWaiting, unread.memoryToSend, unread.waiting]).toEqual([0, 0, 0, 0]);
  });

  it("is read with the rest of the summary's inputs", async () => {
    query.mockImplementation(async (sql: string) => (/FROM welcome_packs WHERE sent_at IS NOT NULL/.test(sql) ? { rows: [{ fundraiser_id: 7 }] } : { rows: [] }));
    expect((await readSummaryInputs(NOW)).packsSent).toEqual([7]);
  });

  it("still sends the summary when the packs cannot be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    query.mockImplementation(async (sql: string) => {
      if (/FROM welcome_packs/.test(sql)) throw new Error("down");
      return { rows: [] };
    });
    expect((await readSummaryInputs(NOW)).packsSent).toBeNull();
  });
});
