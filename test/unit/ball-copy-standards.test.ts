import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { renderHomePromo } from "../../src/ball/home-promo";
import { renderBallThankYou } from "../../src/ball/thank-you-page";
import { buildBallConfirmationEmail } from "../../src/ball/confirmation-email";
import { buildBallReminderEmail } from "../../src/ball/reminder-email";
import { renderGuestPage, renderGuestNotFound } from "../../src/ball/guest-page";

// TASK-325: two house rules the rest of the site already followed and the ball surfaces did
// not. Both are asserted on what a reader actually SEES — the rendered output, and the HTML
// with its source comments stripped — because a comment explaining a rule is not a breach of
// it, and testing the raw source would fail on its own documentation.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (f: string) => readFileSync(resolve(ROOT, f), "utf8");

// Source comments are not published copy: HTML comments, and the CSS comments inside the
// promo's injected <style> block.
const stripComments = (html: string) =>
  html.replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

const booking = {
  reference: "BALL-K7M2PQ",
  kind: "table" as const,
  quantity: 1,
  seats: 10,
  buyerName: "Jo Smith",
  buyerFirstName: "Jo",
  buyerEmail: "jo@example.com",
  totalPence: 100_000,
  guestToken: "tok",
  ticketsPence: 100_000,
  donationPence: 0,
  feeCoverPence: 0,
  giftAid: false,
  newsletterOptIn: false,
  tableName: null,
};
const details = { arrivalTime: null, includedNote: null, guestLink: "https://nbcc.scot/ball/guests/tok" };

// Every ball surface a member of the public can read, as they read it.
const SURFACES: Array<[string, string]> = [
  ["ball.html", stripComments(read("ball.html"))],
  ["ball-terms.html", stripComments(read("ball-terms.html"))],
  ["home page promo", stripComments(renderHomePromo(read("index.html"), { gateOpen: true }))],
  ["thank-you page", renderBallThankYou(booking)],
  ["thank-you page (no booking)", renderBallThankYou(null)],
  ["confirmation email (html)", buildBallConfirmationEmail(booking, details).html],
  ["confirmation email (text)", buildBallConfirmationEmail(booking, details).text],
  ["reminder email (html)", buildBallReminderEmail(booking, [], details).html],
  ["reminder email (text)", buildBallReminderEmail(booking, [], details).text],
  ["reminder subject", buildBallReminderEmail(booking, [], details).subject],
  ["guest page", renderGuestPage({ token: "tok", booking, guests: [], saved: false, error: null })],
  ["guest not found", renderGuestNotFound()],
];

describe("no long dashes anywhere a reader can see them", () => {
  // NBCC's house style, already applied to the business emails. Hyphens inside words
  // ("line-up", "step-free") are fine and deliberately not caught here.
  it.each(SURFACES)("%s", (_name, content) => {
    const found = [...content.matchAll(/.{0,45}(—|–|&mdash;|&ndash;).{0,45}/g)].map((m) => m[0].trim());
    expect(found, `long dash in copy:\n  ${found.join("\n  ")}`).toEqual([]);
  });
});

describe("impact is never stated as a fact", () => {
  // Code of Fundraising Practice: "could help provide ...", never "£X provides Y". Every
  // other amount-to-outcome line on the site already reads this way; the ball page did not.
  const withAmounts = SURFACES.filter(([, c]) => /£|&pound;/.test(c));

  it.each(withAmounts)("%s makes no definitive claim", (_name, content) => {
    // An amount within a short reach of a definitive outcome verb.
    const claims = [...content.matchAll(/(£|&pound;)[\d,]+[^.<]{0,70}\b(helps|provides|pays for|buys|gives|feeds|funds)\b/gi)]
      .map((m) => m[0].replace(/\s+/g, " ").trim());
    expect(claims, `state this as "could help":\n  ${claims.join("\n  ")}`).toEqual([]);
  });

  it("the ticket's impact line says COULD help", () => {
    expect(read("ball.html")).toMatch(/A &pound;100 ticket could help/);
  });
});
