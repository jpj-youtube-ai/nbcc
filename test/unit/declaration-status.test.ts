import { describe, it, expect } from "vitest";
import {
  DECLARATION_STATUSES,
  nextDeclarationStatus,
  canApplyDeclarationEvent,
  applyDeclarationEvent,
  DeclarationTransitionError,
  type DeclarationStatusEvent,
} from "../../src/declarations/status";

// TASK-074 (REQ-057): the pure Gift Aid declaration-confirmation state machine. DB-free
// (no pool/config/clock) per CLAUDE.md — mirrors test/unit/donations-model.test.ts.

describe("declaration status values", () => {
  it("matches the migration's CHECK set", () => {
    expect([...DECLARATION_STATUSES]).toEqual([
      "not_required",
      "pending",
      "sent",
      "undelivered",
      "completed",
    ]);
  });
});

describe("nextDeclarationStatus — legal transitions", () => {
  it("walks the full happy path: not_required → pending → sent → completed", () => {
    expect(nextDeclarationStatus("not_required", "require")).toBe("pending");
    expect(nextDeclarationStatus("pending", "send")).toBe("sent");
    expect(nextDeclarationStatus("sent", "confirm")).toBe("completed");
  });

  it("marks a bounced confirmation undelivered, and resends it", () => {
    expect(nextDeclarationStatus("sent", "mark_undelivered")).toBe("undelivered");
    expect(nextDeclarationStatus("undelivered", "resend")).toBe("sent");
  });

  it("marks a pending confirmation undelivered when its auto-email never dispatches (TASK-075)", () => {
    expect(nextDeclarationStatus("pending", "mark_undelivered")).toBe("undelivered");
  });
});

describe("nextDeclarationStatus — illegal transitions return null", () => {
  it("NEVER reaches completed except by an explicit confirm from sent (no bare GET/send)", () => {
    // A GET of the confirmation link is not modelled as an event, and no non-confirm
    // event yields completed from any state.
    for (const from of DECLARATION_STATUSES) {
      for (const event of ["require", "send", "mark_undelivered", "resend"] as DeclarationStatusEvent[]) {
        expect(nextDeclarationStatus(from, event)).not.toBe("completed");
      }
    }
    // Even a confirm only works from sent — not from pending / not_required / undelivered.
    expect(nextDeclarationStatus("pending", "confirm")).toBeNull();
    expect(nextDeclarationStatus("not_required", "confirm")).toBeNull();
    expect(nextDeclarationStatus("undelivered", "confirm")).toBeNull();
  });

  it("treats completed as terminal (no outgoing transition)", () => {
    for (const event of ["require", "send", "confirm", "mark_undelivered", "resend"] as DeclarationStatusEvent[]) {
      expect(nextDeclarationStatus("completed", event)).toBeNull();
    }
  });

  it("rejects skipping a step (e.g. pending → completed, not_required → sent)", () => {
    expect(nextDeclarationStatus("pending", "confirm")).toBeNull();
    expect(nextDeclarationStatus("not_required", "send")).toBeNull();
    expect(nextDeclarationStatus("sent", "send")).toBeNull(); // already sent
  });
});

describe("canApplyDeclarationEvent", () => {
  it("is true for a legal transition and false otherwise", () => {
    expect(canApplyDeclarationEvent("sent", "confirm")).toBe(true);
    expect(canApplyDeclarationEvent("pending", "confirm")).toBe(false);
  });
});

describe("applyDeclarationEvent", () => {
  it("returns the next status for a legal transition", () => {
    expect(applyDeclarationEvent("sent", "confirm")).toBe("completed");
  });

  it("throws DeclarationTransitionError carrying from/event for an illegal transition", () => {
    try {
      applyDeclarationEvent("pending", "confirm");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(DeclarationTransitionError);
      expect((err as DeclarationTransitionError).from).toBe("pending");
      expect((err as DeclarationTransitionError).event).toBe("confirm");
    }
  });
});
