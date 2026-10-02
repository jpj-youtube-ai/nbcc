import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-507: staff adding a newsletter subscriber by hand ("all our emails back on") is an explicit
// choice to turn everything back on, so it lifts the address's opt out too, as well as turning both
// consents on. The pool is mocked. Every address here is invented.

const { query, liftOptOut } = vi.hoisted(() => ({ query: vi.fn(), liftOptOut: vi.fn() }));
vi.mock("../../src/db/pool", () => ({ pool: { query, connect: vi.fn() } }));
vi.mock("../../src/db/email-opt-outs", () => ({ liftOptOut, addOptOut: vi.fn(), optedOutAmong: vi.fn() }));
vi.mock("../../src/config", () => ({ config: { NODE_ENV: "test" } }));

import { addNewsletterSubscriber } from "../../src/db/newsletters";

beforeEach(() => {
  query.mockReset();
  liftOptOut.mockReset().mockResolvedValue(true);
});

describe("adding a newsletter subscriber by hand", () => {
  it("turns a known address's emails back on, and lifts its opt out, recorded as by that member of staff", async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 5 }] }).mockResolvedValueOnce({ rowCount: 1 });
    expect(await addNewsletterSubscriber(" Robin@Example.com ", undefined, "admin:fern@example.com")).toEqual({ email: "robin@example.com", status: "resubscribed" });
    expect(liftOptOut).toHaveBeenCalledWith("robin@example.com", "admin:fern@example.com");
  });

  it("lifts any opt out for a new address too", async () => {
    query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rowCount: 1 });
    await addNewsletterSubscriber("jo@example.com", "Jo", "admin:fern@example.com");
    expect(liftOptOut).toHaveBeenCalledWith("jo@example.com", "admin:fern@example.com");
  });
});
