import { describe, it, expect, vi } from "vitest";
import {
  shouldThankNow,
  buildAutoThankYouView,
  runAutoThankYouPass,
  THANK_YOU_FALLBACK_DAYS,
  type SupporterAwaitingThanks,
} from "../../src/business/auto-thank-you";

// TASK-407: the thank-you letter that goes out on its own when a business becomes a supporter.
//
// It waits for them to say HOW they would like to be thanked, because a Platinum letter cannot be
// written properly until you know whether they want a certificate and where it should be posted.
// If they never say, the standard letter goes anyway rather than nobody ever being thanked.

const NOW = new Date("2026-09-03T09:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

const base: SupporterAwaitingThanks = {
  fulfilmentId: 1,
  donorId: 42,
  creditName: "Ayr Joinery Ltd",
  contactName: "Jane Baxter",
  email: "jane@ayrjoinery.co.uk",
  band: "gold",
  monthlyPence: 5000,
  giftAided: false,
  invitedAt: daysAgo(3),
  capturedAt: null,
};
const when = (over: Partial<SupporterAwaitingThanks> = {}) => shouldThankNow({ ...base, ...over }, NOW);

describe("when the letter goes", () => {
  // The whole reason for waiting: a Platinum letter cannot be written properly until you know
  // whether they want a certificate, and where it should be posted.
  it("goes as soon as they have said how they would like to be thanked", () => {
    expect(when({ capturedAt: daysAgo(1) })).toBe("captured");
  });

  it("waits while they have not, and it is early days", () => {
    expect(when({ capturedAt: null, invitedAt: daysAgo(3) })).toBeNull();
  });

  // Somebody who never fills the form in must still be thanked. Silence is not a reason to say
  // nothing.
  it("goes anyway once the wait is up", () => {
    expect(when({ capturedAt: null, invitedAt: daysAgo(THANK_YOU_FALLBACK_DAYS) })).toBe("fallback");
  });

  it("waits one more day when the wait is one day short", () => {
    expect(when({ capturedAt: null, invitedAt: daysAgo(THANK_YOU_FALLBACK_DAYS - 1) })).toBeNull();
  });

  // A supporter who was never invited has no clock to run down. Sending on the strength of a
  // missing date would thank somebody the moment the row appeared.
  it("does not start the clock on a supporter who was never invited", () => {
    expect(when({ capturedAt: null, invitedAt: null })).toBeNull();
  });

  it("still thanks one who chose without ever being invited", () => {
    expect(when({ capturedAt: daysAgo(1), invitedAt: null })).toBe("captured");
  });

  // The letter is worthless without somewhere to send it, and a blank address would fail the send
  // over and over on every daily pass.
  it("says nothing about a supporter with no email address", () => {
    expect(when({ capturedAt: daysAgo(1), email: null })).toBeNull();
  });

  it("waits a fortnight, not a month", () => {
    expect(THANK_YOU_FALLBACK_DAYS).toBe(14);
  });
});

describe("the letter itself", () => {
  const view = buildAutoThankYouView({ ...base, capturedAt: daysAgo(1) }, NOW);

  it("is addressed to the person and thanks the business", () => {
    expect(view.addressedTo).toBe("Jane Baxter");
    expect(view.thankYouName).toBe("Ayr Joinery Ltd");
  });

  it("falls back to the business name when nobody's name is known", () => {
    const v = buildAutoThankYouView({ ...base, contactName: null }, NOW);
    expect(v.addressedTo).toBe("Ayr Joinery Ltd");
  });

  it("carries the monthly amount as a money gift", () => {
    expect(view.giftType).toBe("money");
    expect(view.giftAmountPence).toBe(5000);
  });

  // Gift Aid follows the DONATION, never an assumption about the kind of supporter. A company
  // cannot Gift Aid at all (it claims Corporation Tax relief instead), but a sole trader giving
  // personally can, and putting the 25% line on the wrong letter tells somebody something untrue
  // about their own tax.
  it("takes Gift Aid from the donation rather than guessing", () => {
    expect(view.giftAided).toBe(false);
    expect(buildAutoThankYouView({ ...base, giftAided: true }, NOW).giftAided).toBe(true);
  });

  // Nobody read this letter before it went. Signing it in a volunteer's name would put their
  // signature on something they never saw, so it comes from the charity instead.
  it("is signed by the charity, not by a person who never saw it", () => {
    expect(view.signedByName).toBe("The Night Before Christmas Campaign");
    expect(view.signedByRole).toMatch(/volunteer/i);
  });

  it("carries no personal message, because nobody wrote one", () => {
    expect(view.personalMessage).toBeNull();
  });

  it("dates the letter the day it is sent, the way a letter is dated", () => {
    expect(view.letterDate).toBe("3 September 2026");
  });
});

describe("the daily pass", () => {
  const supporters = [
    { ...base, fulfilmentId: 1, donorId: 42, capturedAt: daysAgo(1) },
    { ...base, fulfilmentId: 2, donorId: 43, capturedAt: null, invitedAt: daysAgo(20) },
  ];

  it("sends to everyone due and records each one", async () => {
    const sendLetter = vi.fn().mockResolvedValue(undefined);
    const markSent = vi.fn().mockResolvedValue(undefined);
    const result = await runAutoThankYouPass({
      listDue: async () => supporters,
      sendLetter,
      markSent,
      now: NOW,
    });
    expect(result).toEqual({ due: 2, sent: 2, failed: 0 });
    expect(sendLetter).toHaveBeenCalledTimes(2);
    expect(markSent).toHaveBeenCalledTimes(2);
  });

  // Recorded only AFTER the send succeeds, so a provider wobble leaves the supporter due
  // tomorrow rather than marked thanked when nothing arrived.
  it("does not record a letter that failed to send", async () => {
    const markSent = vi.fn().mockResolvedValue(undefined);
    const result = await runAutoThankYouPass({
      listDue: async () => [supporters[0]],
      sendLetter: vi.fn().mockRejectedValue(new Error("SES said no")),
      markSent,
      now: NOW,
    });
    expect(result).toEqual({ due: 1, sent: 0, failed: 1 });
    expect(markSent).not.toHaveBeenCalled();
  });

  // One bad address must not stop everybody else being thanked.
  it("keeps going after a failure", async () => {
    const sendLetter = vi
      .fn()
      .mockRejectedValueOnce(new Error("bounced"))
      .mockResolvedValue(undefined);
    const result = await runAutoThankYouPass({
      listDue: async () => supporters,
      sendLetter,
      markSent: vi.fn().mockResolvedValue(undefined),
      now: NOW,
    });
    expect(result).toEqual({ due: 2, sent: 1, failed: 1 });
  });

  // The query does the filtering, but the rule is checked again here: a row that slips through
  // without an address would otherwise fail its send on every daily pass for ever.
  it("skips a supporter the rule says is not due", async () => {
    const sendLetter = vi.fn().mockResolvedValue(undefined);
    const result = await runAutoThankYouPass({
      listDue: async () => [{ ...base, capturedAt: null, invitedAt: daysAgo(1) }],
      sendLetter,
      markSent: vi.fn().mockResolvedValue(undefined),
      now: NOW,
    });
    expect(result).toEqual({ due: 1, sent: 0, failed: 0 });
    expect(sendLetter).not.toHaveBeenCalled();
  });
});
