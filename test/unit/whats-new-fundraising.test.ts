import { describe, it, expect, vi } from "vitest";

// TASK-493: Admin > Fundraising lights up when somebody signs up at /fundraise, from the time of
// their sign up, on the main database.

const { mainQuery, contactQuery, storiesQuery } = vi.hoisted(() => ({
  mainQuery: vi.fn(),
  contactQuery: vi.fn(),
  storiesQuery: vi.fn(),
}));
vi.mock("../../src/db/pool", () => ({ pool: { query: mainQuery } }));
vi.mock("../../src/db/contact-pool", () => ({ contactPool: { query: contactQuery } }));
vi.mock("../../src/db/stories-pool", () => ({ storiesPool: { query: storiesQuery } }));

import { latestArrival } from "../../src/db/whats-new";

describe("the fundraising section's arrivals", () => {
  it("is the latest sign up since the person last looked", async () => {
    const at = new Date("2026-10-02T09:00:00Z");
    mainQuery.mockResolvedValue({ rows: [{ at }] });
    const since = new Date("2026-10-01T00:00:00Z");
    expect(await latestArrival("fundraising", since)).toEqual(at);
    const [sql, params] = mainQuery.mock.calls[0];
    expect(sql).toMatch(/FROM fundraisers WHERE created_at > \$1/);
    expect(params).toEqual([since]);
    expect(contactQuery).not.toHaveBeenCalled();
    expect(storiesQuery).not.toHaveBeenCalled();
  });
});
