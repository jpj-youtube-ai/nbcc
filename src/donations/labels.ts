// The plain words the Donations gift log shows staff (docs/superpowers/specs/2026-11-05-donations-screen-design.md):
// where a gift was given, what brought the giver, and how they paid. PURE: no pool, no config, no
// clock. One set of rules, used by the list (src/db/admin.ts listDonations) and by a gift's details
// (src/db/donation-details.ts), so the screen's cards need no rules of their own.

import { invoiceNumber } from "../invoices/model";
import { labelQrScans } from "../site/qr";
import { ALL_PAGES, SITE_PAGES } from "../site/pages";

export interface GivenOnFacts {
  kind: "donation" | "elf";
  source: string | null;
  paymentChannel: string;
  invoiceId: number | null;
  fundraiserTitle: string | null;
  pledgeId: number | null;
}

/** Where on the site (or off it) the gift was given: "Donate page", "Fill a Red Bag", "Invoice INV-0012" ... */
export function givenOnLabel(g: GivenOnFacts): string {
  if (g.kind === "elf") return "Elf Detective School";
  // An invoice first: one can be paid by card, and it is the invoice staff look for.
  if (g.invoiceId !== null && g.invoiceId !== undefined) return `Invoice ${invoiceNumber(g.invoiceId)}`;
  if (g.source === "invoice") return "Invoice";
  if (g.source === "red_bag") return "Fill a Red Bag";
  if (g.source === "ball") return "Festive Ball";
  if (g.source === "ball_bags") return "Red bags at the Ball";
  if (g.paymentChannel === "in_person") return "Card reader";
  if (g.fundraiserTitle) return g.pledgeId ? `Sponsor pledge for ${g.fundraiserTitle}` : g.fundraiserTitle;
  return "Donate page";
}

export interface PaidByFacts {
  kind: "donation" | "elf";
  paymentChannel: string;
  payMethod: string | null;
  payWallet: string | null;
  cardBrand: string | null;
  cardLast4: string | null;
}

const BRANDS: Record<string, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "Amex",
  american_express: "Amex",
  discover: "Discover",
  diners: "Diners Club",
  jcb: "JCB",
  unionpay: "UnionPay",
  maestro: "Maestro",
};

const WALLETS: Record<string, string> = {
  apple_pay: "Apple Pay",
  google_pay: "Google Pay",
  link: "Link",
  samsung_pay: "Samsung Pay",
};

// "visa" -> "Visa"; a brand not listed is tidied ("cartes_bancaires" -> "Cartes bancaires").
function brandName(brand: string): string {
  const known = BRANDS[brand];
  if (known) return known;
  const words = brand.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// "Visa ending 4242", "Card ending 4242", "Visa card", or null when nothing is known of the card.
function cardWords(brand: string | null, last4: string | null): string | null {
  const name = brand && brand !== "unknown" ? brandName(brand) : null;
  if (last4) return `${name ?? "Card"} ending ${last4}`;
  return name ? `${name} card` : null;
}

/** How it was paid: "Apple Pay (Visa ending 4242)", "Direct Debit", "Bank transfer" ...; null when not known. */
export function paidByLabel(p: PaidByFacts): string | null {
  if (p.kind === "elf") return null;
  const cardPart = cardWords(p.cardBrand, p.cardLast4);
  switch (p.payMethod) {
    case "bank_transfer":
      return "Bank transfer";
    case "bacs_debit":
      return "Direct Debit";
    case "card_present":
      return cardPart ? `Card reader (${cardPart})` : "Card reader";
    case "card": {
      const wallet = p.payWallet ? WALLETS[p.payWallet] : undefined;
      if (wallet) return cardPart ? `${wallet} (${cardPart})` : wallet;
      return cardPart ?? "Card";
    }
    case "other":
      return "Another way";
    default:
      // Not checked with Stripe yet: an in person gift can only have come through the card reader.
      return p.paymentChannel === "in_person" ? "Card reader" : null;
  }
}

/** A QR code's tag, named: by a name looked up for it (a named code, a fundraiser's piece), else by its page. */
export function qrArrivalName(campaign: string | null, named: ReadonlyMap<string, string>): { name: string; page: boolean } | null {
  if (!campaign) return null;
  const name = named.get(campaign);
  if (name) return { name, page: false };
  const [{ label }] = labelQrScans([{ campaign, visits: 0 }], SITE_PAGES);
  // labelQrScans shows a tag that is no page as an address ("/zz"): that names nothing.
  return label.startsWith("/") ? null : { name: label, page: true };
}

export interface ArrivalFacts {
  channel: string | null;
  source: string | null;
  campaign: string | null;
  /** The QR code by name, when the channel is qr and the tag could be named (qrArrivalName). */
  qr: { name: string; page: boolean } | null;
}

function ourPage(path: string | null): string {
  if (!path) return "From another page of ours";
  if (path === "/") return "From our home page";
  const page = ALL_PAGES.find((p) => p.path === path);
  return page ? `From our ${page.title} page` : `From another page of ours (${path})`;
}

/** What brought them: "QR code: Donate billboard, High Street", "Search: Google" ...; null when nothing was noted. */
export function arrivalLabel(a: ArrivalFacts): string | null {
  const named = (words: string) => (a.source ? `${words}: ${a.source}` : words);
  switch (a.channel) {
    case "qr":
      if (!a.qr) return "QR code";
      return a.qr.page ? `QR code for the ${a.qr.name} page` : `QR code: ${a.qr.name}`;
    case "email":
      return "Email";
    case "newsletter":
      return "The newsletter";
    case "search":
      return named("Search");
    case "social":
      return named("Social media");
    case "other_websites":
      return named("Another website");
    case "direct":
      return "Typed in or a bookmark";
    case "site":
      return ourPage(a.source);
    default:
      return null;
  }
}
