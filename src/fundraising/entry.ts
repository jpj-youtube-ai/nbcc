import type { FundraiserBooking } from "./model";

// Jaimie, 2026-10-03: an event's page shows its entry price at the top and a give box below, so a
// visitor could take giving for paying to get in, and NBCC must never claim Gift Aid on entry or
// ticket money. This is how an event says, in a few words, how people DO get in: "Entry: £5, paid on
// the door", "Tickets: from tickets.example.com" (with the seller's link), or "Entry: free". A sign up
// from before the question was asked says nothing at all. Words only: the caller escapes them.

export interface EntryFacts {
  booking?: FundraiserBooking | null;
  price?: string | null;
  ticketUrl?: string | null;
}

export interface EntryLine {
  /** "Entry: £5, paid on the door", or for tickets the words before the seller: "Tickets: £10, from ". */
  lead: string;
  /** For tickets: the seller's website as people would read it ("tickets.example.com"); "" otherwise. */
  seller: string;
  /** For tickets: the seller's https link, when we have one; null otherwise. */
  url: string | null;
}

/** The seller's link, only when it is a real https address: never anything else in a link. */
export function safeTicketUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname ? url : null;
  } catch {
    return null;
  }
}

/** The seller's website as people read it: its host, without the www. "" for no https link. */
export function sellerName(url: string | null | undefined): string {
  const safe = safeTicketUrl(url);
  return safe ? new URL(safe).hostname.replace(/^www\./i, "") : "";
}

/** A price that is only the word free ("Free", "free."): said as "free". */
const JUST_FREE = /^free[.!]?$/i;

/** How people get in, in a few words, or null when the event was never asked. */
export function entryLine(f: EntryFacts): EntryLine | null {
  const typed = (f.price ?? "").trim();
  const price = JUST_FREE.test(typed) ? "free" : typed;
  if (f.booking === "free") return { lead: "Entry: free", seller: "", url: null };
  if (f.booking === "door") {
    // Never "Free, paid on the door", or "on the door" twice: a price that says either stands alone.
    if (!price) return { lead: "Entry: paid on the door", seller: "", url: null };
    return { lead: /\bfree\b|\bdoor\b/i.test(price) ? `Entry: ${price}` : `Entry: ${price}, paid on the door`, seller: "", url: null };
  }
  if (f.booking === "away") {
    const url = safeTicketUrl(f.ticketUrl);
    const from = price ? `Tickets: ${price}, from ` : "Tickets: from ";
    return url ? { lead: from, seller: sellerName(url), url } : { lead: `${from}another website`, seller: "", url: null };
  }
  return null;
}

/** The same line as plain words, for print: "Tickets: from tickets.example.com". */
export function entryWords(f: EntryFacts): string | null {
  const line = entryLine(f);
  return line ? line.lead + line.seller : null;
}
