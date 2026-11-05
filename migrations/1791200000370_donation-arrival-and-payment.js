/* eslint-disable camelcase */

// The Donations gift log (docs/superpowers/specs/2026-11-05-donations-screen-design.md): two things
// recorded for new gifts from now on. What brought the giver (written after the gift is saved, from
// what the checkout stamped on the Stripe session), and how they paid (read from Stripe after the gift
// is saved, or the first time an older gift's details are opened). Both are best effort and never in
// the way of a gift. Additive: empty columns only, so a code rollback is safe (golden rule 2).

const COLUMNS = {
  arrival_channel: {
    type: "text",
    comment:
      "What brought the giver: qr, email, newsletter, search, social, other_websites, direct or site (another page of ours). Null when not noted (before 6 November 2026, Do Not Track, or not a website gift).",
  },
  arrival_source: {
    type: "text",
    comment:
      "With arrival_channel: the search engine or social site by name, another website's host, or for site the path of our page they came from (e.g. /get-involved). At most 100 characters.",
  },
  arrival_campaign: {
    type: "text",
    comment: "The link's utm_campaign tag, e.g. c12 for named QR code 12, donate for the page QR, or an email kind. At most 100 characters.",
  },
  given_on: {
    type: "text",
    comment: "The path of the page the gift was made on, e.g. /donate, /fill, /fundraise/<slug>. At most 100 characters.",
  },
  pay_method: {
    type: "text",
    comment: "How it was paid, from Stripe: card, bacs_debit, card_present, bank_transfer or other. Null until checked.",
  },
  pay_wallet: {
    type: "text",
    comment: "For a card: the wallet it was paid with (apple_pay, google_pay, link, samsung_pay, other), null for none.",
  },
  card_brand: { type: "text", comment: "For a card: its brand as Stripe names it (visa, mastercard, amex ...)." },
  card_last4: { type: "text", comment: "For a card: its last four digits, and nothing more of the number." },
  card_country: { type: "text", comment: "For a card: the two letter country it was issued in." },
  pay_checked_at: {
    type: "timestamptz",
    comment: "When Stripe was last asked how this gift was paid, so it is asked once, even when nothing was found.",
  },
};

exports.up = (pgm) => {
  pgm.addColumns("donations", COLUMNS);
  pgm.createIndex("donations", "arrival_channel", { where: "arrival_channel IS NOT NULL" });
  pgm.createIndex("donations", "pay_method", { where: "pay_method IS NOT NULL" });
};

exports.down = (pgm) => {
  pgm.dropIndex("donations", "pay_method");
  pgm.dropIndex("donations", "arrival_channel");
  pgm.dropColumns("donations", Object.keys(COLUMNS));
};
