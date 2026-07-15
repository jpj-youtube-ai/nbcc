import { describe, it, expect } from "vitest";
import { resolvePublicSupporter, type SupporterSourceRow } from "../../src/db/donations-model";

// TASK-240 (supporters-wall accuracy): a supporter is shown via the OPT-IN monthly path only while
// their monthly support is current. Once their monthly subscription has ended (voluntarily cancelled
// or lapsed) beyond the grace window, listPublicSupporters flags the row monthlySupportEnded=true and
// the opt-in path no longer qualifies them — so they drop off, UNLESS they are grandfathered (TASK-228),
// who are kept regardless. resolvePublicSupporter is pure, so the drop decision is unit-tested DB-free
// with the flag the SQL computes (the grace window itself is applied in the listPublicSupporters read).

const individualOptIn = (over: Partial<SupporterSourceRow> = {}): SupporterSourceRow => ({
  donorType: "individual",
  fullName: "Ada Lovelace",
  monthlyAmountPence: 2500, // silver band
  individualListOptIn: true,
  ...over,
});

describe("supporters wall grace: opt-in supporters drop once their monthly support has ended (TASK-240)", () => {
  it("shows an opted-in monthly supporter whose support is still current", () => {
    const r = resolvePublicSupporter(individualOptIn({ monthlySupportEnded: false }));
    expect(r).not.toBeNull();
    expect(r?.band).toBe("silver");
    expect(r?.name).toBe("Ada Lovelace");
  });

  it("drops an opted-in monthly supporter once their support has ended beyond the grace window", () => {
    const r = resolvePublicSupporter(individualOptIn({ monthlySupportEnded: true }));
    expect(r).toBeNull();
  });

  it("keeps a GRANDFATHERED donor on the wall even after their monthly support has ended", () => {
    // Grandfathered supporters (TASK-228) are kept regardless of subscription state — the grace drop
    // gates the opt-in path only, and the grandfather path bands by their greatest paid gift.
    const r = resolvePublicSupporter(
      individualOptIn({ monthlySupportEnded: true, grandfathered: true, maxPaidAmountPence: 5000 }),
    );
    expect(r).not.toBeNull();
    expect(r?.band).toBe("gold"); // banded by max paid (£50), not the ended monthly opt-in
  });

  it("drops an opted-in BUSINESS supporter once its monthly support has ended (same grace rule)", () => {
    const r = resolvePublicSupporter({
      donorType: "business",
      fullName: "Acme contact",
      businessName: "Acme Ltd",
      monthlyAmountPence: 5000,
      businessListOptIn: true,
      monthlySupportEnded: true,
    });
    expect(r).toBeNull();
  });

  it("treats a missing monthlySupportEnded flag as still-current (backward-compatible default)", () => {
    const r = resolvePublicSupporter(individualOptIn({}));
    expect(r).not.toBeNull();
    expect(r?.band).toBe("silver");
  });
});
