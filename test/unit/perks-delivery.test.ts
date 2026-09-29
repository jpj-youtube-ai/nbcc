import { describe, it, expect, vi } from "vitest";
import {
  shouldSendPerksNow,
  runPerksDelivery,
  type PerksAwaitingDelivery,
} from "../../src/business/perks-delivery";

// TASK-441. A business supporter's badge and certificate used to ride the confirmation email,
// arriving seconds after they submitted the form. Fast, and unmistakably a machine. A business
// giving £100 a month should get their recognition looking like somebody put it together, so it now
// comes the next WEEKDAY MORNING as its own email.

const supporter = (over: Partial<PerksAwaitingDelivery> = {}): PerksAwaitingDelivery => ({
  fulfilmentId: 5,
  token: "tok-rmc",
  email: "stephanie@rmc.test",
  name: "RMC Double Glazing (Ayr) Ltd",
  wantBadge: true,
  wantCertificate: true,
  capturedAt: new Date("2026-09-28T14:00:00Z"), // a Monday afternoon
  perksSentAt: null,
  ...over,
});

// 2026-09-28 is a Monday, so the week runs Mon 28th → Sun 4th Oct.
const MON = new Date("2026-09-28T08:00:00Z");
const TUE = new Date("2026-09-29T08:00:00Z");
const FRI = new Date("2026-10-02T08:00:00Z");
const SAT = new Date("2026-10-03T08:00:00Z");
const SUN = new Date("2026-10-04T08:00:00Z");

describe("waiting for the next weekday morning", () => {
  it("does not send on the same day they submitted", () => {
    // They filled it in at 2pm Monday; the 8am Monday pass already ran, and an instant reply is
    // exactly the machine-like thing this exists to avoid.
    expect(shouldSendPerksNow(supporter(), MON)).toBe(false);
  });

  it("sends the next morning", () => {
    expect(shouldSendPerksNow(supporter(), TUE)).toBe(true);
  });

  // THE case. A 3am Sunday email is unmistakably automatic, and "a few hours later" produces
  // exactly that for somebody who signs up on a Saturday night.
  it("never sends at the weekend", () => {
    const fridayAfternoon = supporter({ capturedAt: new Date("2026-10-02T15:00:00Z") });
    expect(shouldSendPerksNow(fridayAfternoon, SAT)).toBe(false);
    expect(shouldSendPerksNow(fridayAfternoon, SUN)).toBe(false);
  });

  it("picks a Friday submission up on the Monday", () => {
    const fridayAfternoon = supporter({ capturedAt: new Date("2026-10-02T15:00:00Z") });
    const monday = new Date("2026-10-05T08:00:00Z");
    expect(shouldSendPerksNow(fridayAfternoon, monday)).toBe(true);
  });

  it("picks a weekend submission up on the Monday, not the Sunday", () => {
    const saturday = supporter({ capturedAt: new Date("2026-10-03T20:00:00Z") });
    expect(shouldSendPerksNow(saturday, SUN)).toBe(false);
    expect(shouldSendPerksNow(saturday, new Date("2026-10-05T08:00:00Z"))).toBe(true);
  });
});

describe("who is owed anything at all", () => {
  it("sends nothing to a supporter who asked for neither", () => {
    expect(shouldSendPerksNow(supporter({ wantBadge: false, wantCertificate: false }), TUE)).toBe(false);
  });

  it("sends to a supporter who asked for only a badge", () => {
    expect(shouldSendPerksNow(supporter({ wantCertificate: false }), TUE)).toBe(true);
  });

  it("sends to a supporter who asked for only a certificate", () => {
    expect(shouldSendPerksNow(supporter({ wantBadge: false }), TUE)).toBe(true);
  });

  it("waits for the form, because until then we do not know what they want", () => {
    expect(shouldSendPerksNow(supporter({ capturedAt: null }), TUE)).toBe(false);
  });

  it("sends nothing when there is no address to send to", () => {
    expect(shouldSendPerksNow(supporter({ email: null }), TUE)).toBe(false);
  });

  // The guard that makes a second daily pass a no-op rather than a second email.
  it("never sends twice", () => {
    expect(shouldSendPerksNow(supporter({ perksSentAt: new Date("2026-09-29T08:00:00Z") }), FRI)).toBe(false);
  });
});

describe("the daily pass", () => {
  const deps = (over: Partial<Parameters<typeof runPerksDelivery>[0]> = {}) => ({
    listAwaiting: async () => [supporter()],
    send: vi.fn(async () => {}),
    markSent: vi.fn(async () => true),
    now: TUE,
    ...over,
  });

  it("sends and stamps, so tomorrow leaves them alone", async () => {
    const d = deps();
    expect(await runPerksDelivery(d)).toEqual({ due: 1, sent: 1, failed: 0 });
    expect(d.markSent).toHaveBeenCalledWith(5);
  });

  // Stamping first would lose a supporter for good the one time the relay hiccuped.
  it("does not stamp when the send fails, so tomorrow tries again", async () => {
    const d = deps({ send: vi.fn(async () => { throw new Error("relay down"); }) });
    expect(await runPerksDelivery(d)).toEqual({ due: 1, sent: 0, failed: 1 });
    expect(d.markSent).not.toHaveBeenCalled();
  });

  it("one failure never stops the rest", async () => {
    const send = vi.fn(async (s: PerksAwaitingDelivery) => {
      if (s.fulfilmentId === 5) throw new Error("relay down");
    });
    const d = deps({
      listAwaiting: async () => [supporter(), supporter({ fulfilmentId: 6, email: "b@x.test" })],
      send,
    });
    expect(await runPerksDelivery(d)).toEqual({ due: 2, sent: 1, failed: 1 });
  });

  it("does nothing at all at the weekend", async () => {
    const d = deps({ now: SAT });
    expect(await runPerksDelivery(d)).toEqual({ due: 0, sent: 0, failed: 0 });
    expect(d.send).not.toHaveBeenCalled();
  });
});
