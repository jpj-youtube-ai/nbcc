import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { renderHomePromo } from "../../src/ball/home-promo";
import { buildBallConfirmationEmail } from "../../src/ball/confirmation-email";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (f: string) => readFileSync(resolve(ROOT, f), "utf8");

// TASK-313: the Code of Fundraising Practice requires fundraising claims to be accurate and
// substantiated. "Every penny of your ticket goes to NBCC" is NOT accurate: Stripe deducts
// roughly 1.5% + 20p from every card payment, so unless the buyer opts to cover that fee, NBCC
// receives less than the ticket price.
//
// What IS true, and is the genuinely remarkable thing, is that The Designer Rooms is paying for
// the evening — so no part of a ticket buys the venue, the catering or the acts. That is the
// claim these surfaces are allowed to make.
//
// This guard exists because the absolute wording is an easy and tempting thing to write back in.

const BANNED = [
  /every penny (of|goes|stays|raised)/i,
  /every pound (raised|goes|reaches)/i,
  /100% of your ticket/i,
];

// The fee-cover control is the ONE place a full-value claim is correct, because covering the
// fee is precisely what makes it true. Phrased around the option, never as a blanket promise.
const ALLOWED_FULL_VALUE =
  /so the full\s+ticket price reaches NBCC|so the full\s+.100 reaches NBCC/i;

function assertNoAbsoluteClaim(surface: string, text: string): void {
  for (const pattern of BANNED) {
    const match = pattern.exec(text);
    expect(
      match,
      `${surface} makes an absolute money claim that card fees make untrue: "${match?.[0]}"`,
    ).toBeNull();
  }
}

describe("ball surfaces make no money claim that card fees contradict", () => {
  it("the ticket page", () => {
    assertNoAbsoluteClaim("ball.html", read("ball.html"));
  });

  it("the ticket terms", () => {
    assertNoAbsoluteClaim("ball-terms.html", read("ball-terms.html"));
  });

  it("the home page promotion", () => {
    const html = renderHomePromo(read("index.html"), { gateOpen: true });
    assertNoAbsoluteClaim("the home page promotion", html);
  });

  it("the confirmation email, in both html and plain text", () => {
    const mail = buildBallConfirmationEmail(
      {
        reference: "BALL-ABC234",
        kind: "seat",
        quantity: 1,
        seats: 1,
        buyerName: "Jo Smith",
        buyerEmail: "jo@example.com",
        ticketsPence: 10_000,
        donationPence: 0,
        feeCoverPence: 0,
        totalPence: 10_000,
        giftAid: false,
        newsletterOptIn: false,
        stripeSessionId: "cs_1",
      },
      { arrivalTime: null, includedNote: null },
    );
    assertNoAbsoluteClaim("the confirmation email (html)", mail.html);
    assertNoAbsoluteClaim("the confirmation email (text)", mail.text);
  });

  it("still keeps the claim that IS true: the sponsor is paying for the evening", () => {
    const page = read("ball.html");
    // Whitespace-tolerant: this asserts a claim, not where the line happens to wrap.
    expect(page).toMatch(/covering the full\s+cost of the evening/i);
    expect(page).toMatch(/funds NBCC's work/i);
  });

  it("keeps the full-value wording exactly where it is earned — the fee-cover option", () => {
    expect(read("ball.html")).toMatch(ALLOWED_FULL_VALUE);
  });

  it("tells buyers in the terms that the fee is deducted if they do not cover it", () => {
    const terms = read("ball-terms.html");
    expect(terms).toMatch(/card processing fee/i);
    // Match a phrase that does not span a source line break — the sentence wraps in the file.
    expect(terms).toMatch(/receives slightly less/i);
    expect(terms).toMatch(/no part\s+of your ticket pays for the venue/i);
  });
});
