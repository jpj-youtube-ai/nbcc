import { describe, it, expect, vi } from "vitest";
import { retireReplacedCheckout } from "../../src/ball/replace-checkout";

// TASK-484: the Ball page's fallback to Stripe's own page names the inline checkout it replaces, and
// the server retires that one so it stops holding seats. Only the buyer's own checkout may be retired,
// and never one that has been paid: Stripe refuses to expire a completed session, so expiring comes first.

const SID = "cs_test_abc";
const own = { reference: "BALL-AAAAAA", clientSecret: `${SID}_secret_xyz` };

function deps(over: Partial<Parameters<typeof retireReplacedCheckout>[1]> = {}) {
  return {
    pendingCardSession: vi.fn(async () => SID as string | null),
    expire: vi.fn(async () => ({})),
    cancel: vi.fn(async () => {}),
    ...over,
  };
}

describe("retiring the checkout a fallback replaces", () => {
  it("expires it at Stripe, then cancels the booking", async () => {
    const d = deps();
    expect(await retireReplacedCheckout(own, d)).toBe("retired");
    expect(d.expire).toHaveBeenCalledWith(SID);
    expect(d.cancel).toHaveBeenCalledWith(SID);
    expect(d.expire.mock.invocationCallOrder[0]).toBeLessThan(d.cancel.mock.invocationCallOrder[0]);
  });

  it("touches nothing when the client secret belongs to another checkout", async () => {
    const d = deps();
    expect(await retireReplacedCheckout({ ...own, clientSecret: "cs_test_other_secret_xyz" }, d)).toBe("not_theirs");
    expect(d.expire).not.toHaveBeenCalled();
    expect(d.cancel).not.toHaveBeenCalled();
  });

  // A shared prefix is not ownership: cs_test_abc is not cs_test_abcd.
  it("is not fooled by a session id that merely starts the same way", async () => {
    const d = deps();
    expect(await retireReplacedCheckout({ ...own, clientSecret: "cs_test_abcd_secret_xyz" }, d)).toBe("not_theirs");
    expect(d.expire).not.toHaveBeenCalled();
  });

  it("touches nothing when there is no pending card booking with that reference", async () => {
    const d = deps({ pendingCardSession: vi.fn(async () => null) });
    expect(await retireReplacedCheckout(own, d)).toBe("not_found");
    expect(d.expire).not.toHaveBeenCalled();
  });

  // Stripe refuses to expire a paid session, so a booking somebody did pay is never cancelled.
  it("leaves the booking alone when Stripe will not expire the session", async () => {
    const d = deps({ expire: vi.fn(async () => { throw new Error("session is complete"); }) });
    expect(await retireReplacedCheckout(own, d)).toBe("stripe_refused");
    expect(d.cancel).not.toHaveBeenCalled();
  });

  // Expired at Stripe, so its own expired event, or the one-hour cap, gives the seats back anyway.
  // The buyer's new checkout must still go ahead.
  it("does not throw when the cancel fails after Stripe expired it", async () => {
    const d = deps({ cancel: vi.fn(async () => { throw new Error("db down"); }) });
    expect(await retireReplacedCheckout(own, d)).toBe("expired_only");
  });
});
