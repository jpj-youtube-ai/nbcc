import { describe, it, expect } from "vitest";
import {
  DUNNING_STATUSES,
  nextDunningStatus,
  canApplyDunningEvent,
  applyDunningEvent,
  nextFailedAttempts,
  DunningTransitionError,
  type DunningEvent,
} from "../../src/subscriptions/dunning";

// TASK-091 (REQ-065): the pure subscription dunning state machine. DB-free (no pool/config/clock)
// per CLAUDE.md — mirrors test/unit/declaration-status.test.ts.

describe("dunning status values", () => {
  it("matches the migration's CHECK set", () => {
    expect([...DUNNING_STATUSES]).toEqual(["active", "past_due", "lapsed"]);
  });
});

describe("nextDunningStatus — legal transitions", () => {
  it("walks the full lapse path only via the three named events in order: active → past_due → lapsed", () => {
    expect(nextDunningStatus("active", "payment_failed")).toBe("past_due");
    expect(nextDunningStatus("past_due", "retries_exhausted")).toBe("lapsed");
  });

  it("stays past_due on a further failure (a 2nd/3rd retry attempt fails)", () => {
    expect(nextDunningStatus("past_due", "payment_failed")).toBe("past_due");
  });

  it("recovers an in-flight past_due back to active on a successful payment", () => {
    expect(nextDunningStatus("past_due", "payment_succeeded")).toBe("active");
  });

  it("treats a payment_succeeded on a healthy active subscription as a no-op (stays active)", () => {
    expect(nextDunningStatus("active", "payment_succeeded")).toBe("active");
  });
});

describe("nextDunningStatus — illegal transitions return null", () => {
  it("NEVER reaches lapsed except by an explicit retries_exhausted from past_due", () => {
    for (const from of DUNNING_STATUSES) {
      for (const event of ["payment_failed", "payment_succeeded"] as DunningEvent[]) {
        expect(nextDunningStatus(from, event)).not.toBe("lapsed");
      }
    }
    // retries_exhausted only lapses from past_due — never straight from active.
    expect(nextDunningStatus("active", "retries_exhausted")).toBeNull();
    expect(nextDunningStatus("past_due", "retries_exhausted")).toBe("lapsed");
  });

  it("treats lapsed as terminal — any further event is illegal", () => {
    for (const event of ["payment_failed", "payment_succeeded", "retries_exhausted"] as DunningEvent[]) {
      expect(nextDunningStatus("lapsed", event)).toBeNull();
    }
  });
});

describe("canApplyDunningEvent", () => {
  it("is true for a legal transition and false otherwise", () => {
    expect(canApplyDunningEvent("past_due", "retries_exhausted")).toBe(true);
    expect(canApplyDunningEvent("active", "retries_exhausted")).toBe(false);
    expect(canApplyDunningEvent("lapsed", "payment_succeeded")).toBe(false);
  });
});

describe("applyDunningEvent", () => {
  it("walks active → past_due → lapsed via the three named events", () => {
    const pastDue = applyDunningEvent("active", "payment_failed");
    expect(pastDue).toBe("past_due");
    const lapsed = applyDunningEvent(pastDue, "retries_exhausted");
    expect(lapsed).toBe("lapsed");
  });

  it("throws DunningTransitionError carrying from/event for an illegal transition (lapsed is terminal)", () => {
    for (const event of ["payment_failed", "payment_succeeded", "retries_exhausted"] as DunningEvent[]) {
      try {
        applyDunningEvent("lapsed", event);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(DunningTransitionError);
        expect((err as DunningTransitionError).from).toBe("lapsed");
        expect((err as DunningTransitionError).event).toBe(event);
      }
    }
  });

  it("rejects skipping a step (active → lapsed directly)", () => {
    expect(() => applyDunningEvent("active", "retries_exhausted")).toThrow(DunningTransitionError);
  });

  it("resets an in-flight past_due back to active on payment_succeeded", () => {
    expect(applyDunningEvent("past_due", "payment_succeeded")).toBe("active");
  });
});

describe("nextFailedAttempts — the counter alongside the status", () => {
  it("increments on each payment_failed", () => {
    expect(nextFailedAttempts("payment_failed", 0)).toBe(1);
    expect(nextFailedAttempts("payment_failed", 2)).toBe(3);
  });

  it("resets to 0 on payment_succeeded", () => {
    expect(nextFailedAttempts("payment_succeeded", 3)).toBe(0);
  });

  it("preserves the count on retries_exhausted (the final tally on the lapsed row)", () => {
    expect(nextFailedAttempts("retries_exhausted", 3)).toBe(3);
  });
});
