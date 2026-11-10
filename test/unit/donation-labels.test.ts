import { describe, it, expect } from "vitest";
import { arrivalLabel, givenOnLabel, paidByLabel, qrArrivalName } from "../../src/donations/labels";

// The plain words the Donations gift log shows staff for where a gift was given, what brought the
// giver and how they paid (docs/superpowers/specs/2026-11-05-donations-screen-design.md). One set of
// rules, shared by the list and a gift's details, so the cards need none of their own. Invented data.

const gift = {
  kind: "donation" as const,
  source: null as string | null,
  paymentChannel: "online",
  invoiceId: null as number | null,
  fundraiserTitle: null as string | null,
  pledgeId: null as number | null,
};

describe("where a gift was given", () => {
  it.each([
    ["an online gift with nothing else known", {}, "Donate page"],
    ["Fill a Red Bag", { source: "red_bag" }, "Fill a Red Bag"],
    ["the Festive Ball's donate page", { source: "ball" }, "Festive Ball"],
    ["the Ball's table cards", { source: "ball_bags" }, "Red bags at the Ball"],
    ["an invoice, by its number", { source: "invoice", invoiceId: 12 }, "Invoice INV-0012"],
    ["an invoice whose number is lost", { source: "invoice" }, "Invoice"],
    ["the card reader at an event", { paymentChannel: "in_person" }, "Card reader"],
    ["a gift on the Santa Sleigh page", { source: "santa_sleigh" }, "Santa Sleigh"],
    ["a card machine tap on a sleigh night", { source: "santa_sleigh", paymentChannel: "in_person" }, "Santa Sleigh"],
    ["a fundraiser's page, by its title", { fundraiserTitle: "Sam's Santa Dash" }, "Sam's Santa Dash"],
    ["a sponsor pledge, with its fundraiser", { fundraiserTitle: "Sam's Santa Dash", pledgeId: 4 }, "Sponsor pledge for Sam's Santa Dash"],
  ])("names %s", (_name, over, words) => {
    expect(givenOnLabel({ ...gift, ...over })).toBe(words);
  });

  it("names an Elf Detective School payment, whatever else it carries", () => {
    expect(givenOnLabel({ ...gift, kind: "elf", source: "elf_school" })).toBe("Elf Detective School");
  });

  it("puts the invoice before anything else: an invoice can be paid by card", () => {
    expect(givenOnLabel({ ...gift, invoiceId: 7, fundraiserTitle: "Sam's Santa Dash" })).toBe("Invoice INV-0007");
  });
});

const card = { kind: "donation" as const, paymentChannel: "online", payMethod: "card" as string | null, payWallet: null as string | null, cardBrand: "visa" as string | null, cardLast4: "4242" as string | null };

describe("how a gift was paid", () => {
  it.each([
    ["a card", {}, "Visa ending 4242"],
    ["Apple Pay, with the card behind it", { payWallet: "apple_pay" }, "Apple Pay (Visa ending 4242)"],
    ["Google Pay", { payWallet: "google_pay", cardBrand: "mastercard", cardLast4: "4444" }, "Google Pay (Mastercard ending 4444)"],
    ["Link", { payWallet: "link" }, "Link (Visa ending 4242)"],
    ["Samsung Pay", { payWallet: "samsung_pay" }, "Samsung Pay (Visa ending 4242)"],
    ["a wallet we do not name, as the card alone", { payWallet: "other" }, "Visa ending 4242"],
    ["an Amex", { cardBrand: "amex", cardLast4: "0005" }, "Amex ending 0005"],
    ["a brand we do not list, tidied", { cardBrand: "cartes_bancaires" }, "Cartes bancaires ending 4242"],
    ["a card with no brand", { cardBrand: null }, "Card ending 4242"],
    ["a card with no last four", { cardLast4: null }, "Visa card"],
    ["a card with nothing known", { cardBrand: null, cardLast4: null }, "Card"],
    ["Apple Pay with nothing known of the card", { payWallet: "apple_pay", cardBrand: null, cardLast4: null }, "Apple Pay"],
    ["a Direct Debit", { payMethod: "bacs_debit", cardBrand: null, cardLast4: null }, "Direct Debit"],
    ["a bank transfer", { payMethod: "bank_transfer", cardBrand: null, cardLast4: null }, "Bank transfer"],
    ["the card reader, with the card", { payMethod: "card_present", paymentChannel: "in_person" }, "Card reader (Visa ending 4242)"],
    ["the card reader, card unknown", { payMethod: "card_present", cardBrand: null, cardLast4: null }, "Card reader"],
    ["another way", { payMethod: "other", cardBrand: null, cardLast4: null }, "Another way"],
  ])("names %s", (_name, over, words) => {
    expect(paidByLabel({ ...card, ...over })).toBe(words);
  });

  it("says the card reader for an in person gift not yet checked with Stripe", () => {
    expect(paidByLabel({ ...card, payMethod: null, cardBrand: null, cardLast4: null, paymentChannel: "in_person" })).toBe("Card reader");
  });

  it("says nothing for an online gift not yet checked, rather than guess", () => {
    expect(paidByLabel({ ...card, payMethod: null, cardBrand: null, cardLast4: null })).toBeNull();
  });

  it("says nothing for an Elf Detective School payment: how it was paid is not kept", () => {
    expect(paidByLabel({ ...card, kind: "elf", payMethod: null })).toBeNull();
  });
});

describe("what brought them", () => {
  const came = (channel: string | null, source: string | null = null, campaign: string | null = null, qr: { name: string; page: boolean } | null = null) =>
    arrivalLabel({ channel, source, campaign, qr });

  it("names a named QR code by the name staff gave it", () => {
    expect(came("qr", null, "c12", { name: "Donate billboard, High Street", page: false })).toBe("QR code: Donate billboard, High Street");
  });

  it("names a page's own QR code by its page", () => {
    expect(came("qr", null, "get-involved", { name: "Get involved", page: true })).toBe("QR code for the Get involved page");
  });

  it("says just QR code when the code cannot be named", () => {
    expect(came("qr", null, "zz-unknown")).toBe("QR code");
  });

  it.each([
    ["email", null, "Email"],
    ["newsletter", null, "The newsletter"],
    ["search", "Google", "Search: Google"],
    ["search", null, "Search"],
    ["social", "Facebook", "Social media: Facebook"],
    ["social", null, "Social media"],
    ["other_websites", "example.org", "Another website: example.org"],
    ["other_websites", null, "Another website"],
    ["direct", null, "Typed in or a bookmark"],
    ["site", "/get-involved", "From our Get involved page"],
    ["site", "/", "From our home page"],
    ["site", "/get-involved/volunteer", "From our Volunteer page"],
    ["site", "/somewhere-new", "From another page of ours (/somewhere-new)"],
    ["site", null, "From another page of ours"],
  ])("names %s from %j", (channel, source, words) => {
    expect(came(channel, source)).toBe(words);
  });

  it("says nothing when nothing was noted, so the screen can say why", () => {
    expect(came(null)).toBeNull();
  });

  it("says nothing for a channel it does not know, rather than show a code", () => {
    expect(came("carrier_pigeon")).toBeNull();
  });
});

describe("naming a QR code's tag", () => {
  it("prefers a name looked up for it", () => {
    expect(qrArrivalName("c12", new Map([["c12", "Donate billboard, High Street"]]))).toEqual({ name: "Donate billboard, High Street", page: false });
  });

  it("names a page's code by the page's title", () => {
    expect(qrArrivalName("get-involved", new Map())).toEqual({ name: "Get involved", page: true });
    expect(qrArrivalName("home", new Map())).toEqual({ name: "Home", page: true });
  });

  it("names nothing for a tag that is no page and was not looked up", () => {
    expect(qrArrivalName("zz-unknown", new Map())).toBeNull();
    expect(qrArrivalName(null, new Map())).toBeNull();
  });
});
