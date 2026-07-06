import { describe, it, expect } from "vitest";
import { gasdsClaimDeadline, GASDS_CLAIM_YEARS } from "../../src/gasds/deadline";

// TASK-135: GASDS small-donation claims must be made within TWO years of the end of the tax year of
// collection (shorter than Gift Aid's four years). The deadline is 2 years after the 5 April that
// ends the collection tax year.

describe("gasdsClaimDeadline (TASK-135)", () => {
  it("is two years after the tax-year-end of the collection date", () => {
    // Collected 5 Nov 2023 → tax year ends 5 Apr 2024 → deadline 5 Apr 2026.
    expect(gasdsClaimDeadline("2023-11-05T00:00:00Z").getTime()).toBe(Date.UTC(2026, 3, 5));
    // Collected 20 Apr 2021 (after 5 Apr) → tax year ends 5 Apr 2022 → deadline 5 Apr 2024.
    expect(gasdsClaimDeadline("2021-04-20T00:00:00Z").getTime()).toBe(Date.UTC(2024, 3, 5));
    // Collected 5 Apr 2022 (on the boundary) → that tax year ends 5 Apr 2022 → deadline 5 Apr 2024.
    expect(gasdsClaimDeadline("2022-04-05T00:00:00Z").getTime()).toBe(Date.UTC(2024, 3, 5));
  });

  it("accepts a Date instance", () => {
    expect(gasdsClaimDeadline(new Date("2023-11-05T00:00:00Z")).getTime()).toBe(Date.UTC(2026, 3, 5));
  });

  it("uses a two-year window", () => {
    expect(GASDS_CLAIM_YEARS).toBe(2);
  });
});
