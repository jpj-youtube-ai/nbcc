import { describe, it, expect } from "vitest";
import {
  unmatchedDisposition,
  UNMATCHED_RETRY_WINDOW_MS,
} from "../../src/newsletter/webhook-retry";

// TASK-305: the delivery stats under-counted by roughly half, and a provider export showed why.
//
//   sent      09:00:15.013
//   delivered 09:00:15.483
//
// Under half a second. But the row saying WHO we sent to was written once per batch, at the end of a
// tick - up to twenty seconds later. A confirmation arriving in that gap found no matching send,
// was classed "unmatched", and was thrown away. The webhook then answered 200, which tells Svix not
// to bother retrying, so the event was gone for good.
//
// Fast providers confirm quickest, so Gmail, Yahoo and Outlook were exactly the ones being lost:
// 182 people had actually received it while the screen said 95, and 24 clicks showed as none.
//
// Two changes. The send is recorded the instant it succeeds, which closes the gap. And an unmatched
// event that is still RECENT is now answered with a retry rather than a shrug, because at that age
// it is far more likely to be this race than a genuinely foreign message.

const AT = new Date("2026-08-27T09:00:15.483Z");

describe("an unmatched delivery event (TASK-305)", () => {
  it("asks for a retry when the event is fresh, because it may just have overtaken our own record", () => {
    expect(unmatchedDisposition(AT, new Date(AT.getTime() + 1_000))).toBe("retry");
  });

  it("still asks for a retry at the very edge of the window", () => {
    expect(unmatchedDisposition(AT, new Date(AT.getTime() + UNMATCHED_RETRY_WINDOW_MS - 1))).toBe("retry");
  });

  it("gives up once the event is old, because by then it is genuinely not one of ours", () => {
    // Receipts, Gift Aid confirmations and login codes all raise events on the same account. Asking
    // Svix to retry those forever would be a self-inflicted flood.
    expect(unmatchedDisposition(AT, new Date(AT.getTime() + UNMATCHED_RETRY_WINDOW_MS + 1))).toBe("ignore");
    expect(unmatchedDisposition(AT, new Date(AT.getTime() + 86_400_000))).toBe("ignore");
  });

  it("retries an event stamped slightly in the future rather than discarding it", () => {
    // Clock skew between the provider and us is normal and must not cost a delivery record.
    expect(unmatchedDisposition(AT, new Date(AT.getTime() - 30_000))).toBe("retry");
  });

  it("keeps the window short enough to be a race, not a policy", () => {
    // Long enough to outlast a redeploy or a slow batch; short enough that a foreign event is not
    // retried for hours.
    expect(UNMATCHED_RETRY_WINDOW_MS).toBeGreaterThanOrEqual(60_000);
    expect(UNMATCHED_RETRY_WINDOW_MS).toBeLessThanOrEqual(15 * 60_000);
  });
});

describe("the send is recorded the moment it succeeds (TASK-305)", () => {
  it("no longer defers recording to the end of the batch", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(
      resolve(__dirname, "../../src/newsletter/send-worker.ts"),
      "utf8",
    );
    // The batch write was the whole bug: twenty seconds during which a confirmation had nothing to
    // match against. Recording inside the loop is what closes it.
    const loopStart = src.indexOf("for (const r of batch)");
    const loopEnd = src.indexOf("if (await finishJobIfDrained");
    expect(loopStart).toBeGreaterThan(-1);
    expect(src.slice(loopStart, loopEnd)).toContain("recordNewsletterSends");
  });
});
