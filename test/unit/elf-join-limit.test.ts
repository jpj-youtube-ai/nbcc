import { describe, it, expect, vi } from "vitest";

// NBCC Elf Detective School: enrolling is limited for each address, loosely enough that a family
// enrolling its children one at a time, or a busy shared connection, is not turned away.

vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));
vi.mock("../../src/routes/api", () => ({ currentCardFee: async () => ({ percentBp: 120, fixedPence: 20 }) }));
vi.mock("../../src/config", () => ({ config: { NODE_ENV: "test", ADMIN_SESSION_SECRET: "s", PORTAL_BASE_URL: "https://nbcc.scot", BALL_FROM_EMAIL: "events@nbcc.scot" } }));

import { JOIN_LIMIT } from "../../src/routes/elf";
import { createRateLimiter } from "../../src/portal/request-limiter";

describe("the enrol limit", () => {
  it("lets each address enrol 10 times every 10 minutes", () => {
    expect(JOIN_LIMIT).toEqual({ max: 10, windowMs: 600_000 });
    const limiter = createRateLimiter(JOIN_LIMIT);
    const start = Date.UTC(2026, 10, 13, 19, 0, 0);
    for (let i = 1; i <= 10; i++) expect(limiter.allow("203.0.113.7", start), `enrolment ${i}`).toBe(true);
    expect(limiter.allow("203.0.113.7", start), "the 11th").toBe(false);
    expect(limiter.allow("198.51.100.4", start), "another address").toBe(true);
    expect(limiter.allow("203.0.113.7", start + 10 * 60_000), "10 minutes later").toBe(true);
  });
});
