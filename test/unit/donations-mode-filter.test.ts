import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-446: filtering the donations list by regular giving vs one-off.
//
// The list could already be narrowed by payment status, which answers "what failed". It could not
// answer "who gives monthly", which is the question behind almost everything else: who to thank, who
// to chase when a card expires, and how much of the income is dependable.

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock("../../src/db/pool", () => ({ pool: { query: queryMock, connect: vi.fn() } }));
vi.mock("../../src/config", () => ({
  config: { NODE_ENV: "development", DATABASE_URL: "postgres://localhost:5432/test" },
}));

import { listDonations } from "../../src/db/admin";

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockResolvedValue({ rows: [{ count: 0 }], rowCount: 1 });
});

/** The WHERE clause and parameters of the counting query, which carries the same filters. */
const lastFilter = () => {
  const [sql, params] = queryMock.mock.calls[0];
  return { sql: String(sql), params: params as unknown[] };
};

describe("filtering by how they gave", () => {
  it("narrows to monthly", async () => {
    await listDonations({ mode: "monthly" });
    const { sql, params } = lastFilter();
    expect(sql).toMatch(/d\.mode = \$1/);
    expect(params).toEqual(["monthly"]);
  });

  it("narrows to one-off", async () => {
    await listDonations({ mode: "once" });
    expect(lastFilter().params).toEqual(["once"]);
  });

  it("returns everything when no mode is asked for", async () => {
    await listDonations({});
    expect(lastFilter().sql).not.toMatch(/d\.mode/);
  });

  // An unrecognised mode returns everything, which reads as "no filter". Passing it through would
  // quietly return an empty list, which reads as "there are no donations" — a much worse answer to
  // give somebody looking at their own charity's income.
  it("ignores a mode that is not one the column allows", async () => {
    await listDonations({ mode: "subscription" });
    expect(lastFilter().sql).not.toMatch(/d\.mode/);
    expect(lastFilter().params).toEqual([]);
  });

  it("ignores an empty mode rather than matching nothing", async () => {
    await listDonations({ mode: "" });
    expect(lastFilter().sql).not.toMatch(/d\.mode/);
  });
});

describe("combining with the filters that already existed", () => {
  // "Monthly and failed" is the question worth asking: it is how you find a standing order that
  // has stopped without anybody noticing.
  it("narrows by mode and payment status together", async () => {
    await listDonations({ mode: "monthly", paymentStatus: "failed" });
    const { sql, params } = lastFilter();
    expect(sql).toMatch(/payment_status/);
    expect(sql).toMatch(/d\.mode/);
    expect(params).toEqual(["failed", "monthly"]);
  });

  it("keeps the placeholders in step with the values when several filters combine", async () => {
    await listDonations({ status: "eligible", channel: "online", mode: "monthly" });
    const { sql, params } = lastFilter();
    // Whatever the order, each placeholder must address its own value: an off-by-one here silently
    // filters by the wrong thing rather than failing.
    expect(params).toEqual(["eligible", "online", "monthly"]);
    expect(sql).toMatch(/claim_status = \$1/);
    expect(sql).toMatch(/payment_channel = \$2/);
    expect(sql).toMatch(/d\.mode = \$3/);
  });
});
