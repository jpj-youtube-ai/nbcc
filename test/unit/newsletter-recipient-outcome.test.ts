import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { recipientOutcome, OUTCOME_LABELS } from "../../src/newsletter/recipient-outcome";

// TASK-303: "which ones actually arrived, and which were blocked?"
//
// The per-person view answered a narrower question than it appeared to. It showed OUR record - did
// we hand this address to the mail service - and labelled that "Received". But handing a message
// over is not the same as it arriving, and the two diverge exactly when it matters: when the
// provider is refusing, when an address is dead, or when a receiving server is holding mail back.
//
// So each person now carries two facts, kept apart on purpose:
//
//   what we did      - sent it, still to send, or gave up
//   what the mailbox said - delivered, bounced, or nothing yet
//
// The mailbox wins where they disagree. It is the only one of the two that knows.

describe("what happened to one recipient (TASK-303)", () => {
  it("says arrived only when a mailbox actually confirmed it", () => {
    expect(recipientOutcome("sent", "delivered")).toBe("arrived");
  });

  it("does not call a handed-over message arrived", () => {
    // The old view called this "Received". It means the provider took it and nothing has come back.
    expect(recipientOutcome("sent", null)).toBe("sent-unconfirmed");
  });

  it("reports a bounce as blocked, whatever our own record says", () => {
    expect(recipientOutcome("sent", "bounced")).toBe("bounced");
    expect(recipientOutcome("sent", "complained")).toBe("bounced");
  });

  it("lets the mailbox overrule our record, because only it knows", () => {
    // Our row can lag or be wrong; a delivery event is first-hand evidence that it landed.
    expect(recipientOutcome("failed", "delivered")).toBe("arrived");
    expect(recipientOutcome("pending", "delivered")).toBe("arrived");
  });

  it("separates still-to-send from given-up-on", () => {
    // These looked identical before, and they are opposites: one still gets the newsletter.
    expect(recipientOutcome("pending", null)).toBe("waiting");
    expect(recipientOutcome("failed", null)).toBe("given-up");
    expect(recipientOutcome("sending", null)).toBe("sending");
  });

  it("treats an unknown state as still to send rather than quietly writing somebody off", () => {
    expect(recipientOutcome("something-new", null)).toBe("waiting");
  });

  it("gives every outcome a label a person can read", () => {
    for (const state of ["arrived", "bounced", "sent-unconfirmed", "waiting", "given-up", "sending"] as const) {
      expect(OUTCOME_LABELS[state]).toBeTruthy();
      expect(OUTCOME_LABELS[state]).not.toMatch(/unconfirmed|given-up/); // plain English, not our jargon
    }
  });
});

// TASK-303: "Accepted" is a count of PEOPLE. It counted rows, so a duplicated record inflated the
// headline and made a send look larger than the number of addresses it actually reached - which is
// exactly the discrepancy that started this task. The events beside it always used DISTINCT; the two
// queries should not disagree about what they are counting.
describe("the accepted figure counts people (TASK-303)", () => {
  it("counts distinct addresses, not queue rows", () => {
    const src = readFileSync(resolve(__dirname, "../../src/db/newsletter-events.ts"), "utf8");
    expect(src).toContain("count(DISTINCT email) AS sends");
    expect(src).not.toContain("count(*) AS sends");
  });
});
