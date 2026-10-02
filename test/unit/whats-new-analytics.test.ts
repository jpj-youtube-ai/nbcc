import { describe, it, expect, vi } from "vitest";

// TASK-482: Admin > Analytics carries a New pill for its launch only. Nothing "arrives" there for
// staff to see, so it never asks a database for the latest arrival.

const { mainQuery, contactQuery, storiesQuery } = vi.hoisted(() => ({
  mainQuery: vi.fn(),
  contactQuery: vi.fn(),
  storiesQuery: vi.fn(),
}));
vi.mock("../../src/db/pool", () => ({ pool: { query: mainQuery } }));
vi.mock("../../src/db/contact-pool", () => ({ contactPool: { query: contactQuery } }));
vi.mock("../../src/db/stories-pool", () => ({ storiesPool: { query: storiesQuery } }));

import { latestArrival } from "../../src/db/whats-new";

// TASK-492: the QR codes screen likewise: new as a screen, with nothing arriving.
describe("the QR codes section's arrivals", () => {
  it("has none, and asks no database", async () => {
    expect(await latestArrival("qr", new Date("2026-10-02T00:00:00Z"))).toBeNull();
    expect(mainQuery).not.toHaveBeenCalled();
  });
});

describe("the analytics section's arrivals", () => {
  it("has none, and asks no database", async () => {
    expect(await latestArrival("analytics", new Date("2026-10-01T00:00:00Z"))).toBeNull();
    expect(mainQuery).not.toHaveBeenCalled();
    expect(contactQuery).not.toHaveBeenCalled();
    expect(storiesQuery).not.toHaveBeenCalled();
  });
});
