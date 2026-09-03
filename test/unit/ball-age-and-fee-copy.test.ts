import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { renderBallThankYou } from "../../src/ball/thank-you-page";

// Three pieces of copy a buyer reads at the moment it matters, each reported as wrong:
//
//   1. The fee checkbox promised to "cover the card fee". It cannot promise that. The amount is
//      grossed up against a 1.2% + 20p rate and Amex is 2.9%, so on an Amex the charity is still
//      short. The word the sentence was missing is "help".
//   2. Nothing at the point of purchase said an under-18 will be turned away and not refunded.
//      "Over 18s only" sat in a facts list several screens up, which is where a buyer does not
//      look when they are entering a card.
//   3. The thank-you page told someone whose email had not arrived to "check your junk folder
//      before booking again", which reads as an instruction to book again.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (f: string) => readFileSync(resolve(ROOT, f), "utf8");
const collapse = (s: string) => s.replace(/\s+/g, " ");

const ballHtml = read("ball.html");
const terms = collapse(read("ball-terms.html"));

// The booking form only. An assertion against the whole page passes on copy sitting three
// screens above the card field, which is exactly the failure being fixed.
const form = collapse(
  ballHtml.slice(ballHtml.indexOf('id="ballForm"'), ballHtml.indexOf("</form>")),
);

const booking = {
  reference: "BALL-K7M2PQ",
  kind: "table" as const,
  quantity: 1,
  seats: 10,
  buyerEmail: "jo@example.com",
  totalPence: 100_000,
  guestToken: "tok",
};

describe("the card fee ask promises only what it can deliver", () => {
  it("asks the buyer to HELP cover the fee", () => {
    expect(collapse(ballHtml)).toMatch(/help<\/b> cover the card fee|help cover the card fee/i);
  });

  // The bare claim, which is the one that is not quite true on every card.
  it("no longer claims the fee is simply covered", () => {
    expect(collapse(ballHtml)).not.toMatch(/to <b>cover the card fee<\/b>/i);
  });
});

describe("over 18s is said where it changes a decision", () => {
  it("the terms say what happens at the door", () => {
    expect(terms).toMatch(/will not be admitted/i);
  });

  it("the terms say what happens to the money", () => {
    expect(terms).toMatch(/no refund is given|not be refunded/i);
  });

  // Refusing entry and keeping the money is an onerous term. It is fair only because there is a
  // way out, and the way out has to be offered in the same breath as the refusal.
  it("the terms offer the transfer instead of only refusing", () => {
    const age = terms.slice(terms.indexOf("<h2>Age</h2>"));
    expect(age.slice(0, 700)).toMatch(/transfer/i);
  });

  it("the booking form says it before payment, not only behind the terms link", () => {
    expect(form).toMatch(/over 18/i);
    expect(form).toMatch(/not be admitted/i);
  });
});

describe("the thank-you page when the confirmation has not arrived", () => {
  // Collapsed: the copy is wrapped in the source, so a sentence assertion would otherwise fail
  // on a line break rather than on the wording.
  const html = collapse(renderBallThankYou(booking));

  it("still says to check the junk folder", () => {
    expect(html).toMatch(/junk folder/i);
  });

  it("names the address to write to, and says we will fix it", () => {
    expect(html).toMatch(/events@nbcc\.scot/);
    expect(html).toMatch(/we'll (sort|get) (it|that)/i);
  });

  // The whole problem with the old sentence: it put "booking again" in front of someone who has
  // already paid, in the same breath as a missing receipt.
  it("never suggests booking again", () => {
    expect(html).not.toMatch(/booking again/i);
    expect(collapse(renderBallThankYou(null))).not.toMatch(/trying again/i);
  });
});
