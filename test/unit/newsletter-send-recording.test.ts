// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// TASK-305/306: the delivery stats under-counted by roughly half, and a provider export showed why.
//
//   sent      09:00:15.013
//   delivered 09:00:15.483
//
// Under half a second. But the row recording WHO we sent to was written once per batch, at the END
// of a tick - up to twenty seconds later. A confirmation arriving in that gap matched no send, was
// classed unmatched, and thrown away. Fast providers confirm quickest, so Gmail, Yahoo and Outlook
// were exactly the ones being lost: 182 people had the newsletter while the screen said 95.
//
// Recording inside the loop is the whole fix, and this pins it.
//
// TASK-306 removed the other half of TASK-305 - answering 409 to a recent unmatched event so Svix
// would retry it. That looked like cheap insurance and was not: a donation receipt's delivery event
// legitimately matches no newsletter, and a 409 would have had Svix retrying every receipt, Gift Aid
// confirmation and login code for five minutes each. The original 200-to-everything existed for
// exactly that reason. The in-loop write closes the race on its own; the retry only added risk.

const src = readFileSync(
  resolve(__dirname, "../../src/newsletter/send-worker.ts"),
  "utf8",
);

describe("when a send is recorded (TASK-305)", () => {
  it("records each recipient inside the send loop, not after the batch", () => {
    const loopStart = src.indexOf("for (const r of batch)");
    const afterLoop = src.indexOf("if (await finishJobIfDrained");
    expect(loopStart).toBeGreaterThan(-1);
    expect(afterLoop).toBeGreaterThan(loopStart);
    expect(src.slice(loopStart, afterLoop)).toContain("recordNewsletterSends");
  });

  it("keeps the end-of-batch sweep filtered, because the insert has no unique index", () => {
    // newsletter_sends is a plain INSERT: writing the same person twice really does create two rows,
    // which is how the "Accepted" figure came to overstate a send in the first place.
    expect(src).toContain("recorded.has(a.email)");
  });
});

describe("the webhook still answers 200 to a foreign event (TASK-306)", () => {
  it("does not ask Svix to retry an unmatched event", () => {
    // Receipts, Gift Aid confirmations and admin login codes share the provider account and match no
    // newsletter. Any non-2xx here turns each of them into a retry storm against our own webhook.
    const route = readFileSync(
      resolve(__dirname, "../../src/routes/resend-webhook.ts"),
      "utf8",
    );
    expect(route).not.toContain("409");
    expect(route).not.toContain("unmatchedDisposition");
  });
});
