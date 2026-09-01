// TASK-351: is this business one we already know about?
//
// The heart of business outreach, and used three ways: before sending ("have we contacted them
// already?"), on the nudge list ("have they since started donating?"), and forever after ("did
// they tell us no?"). Building it once and using it three ways is also what lets attribution work
// without tracking links.
//
// Pure — no pool, no clock — so every rule below is unit-tested DB-free.
//
// It SUGGESTS, never decides. Every match carries a human-readable reason and a volunteer
// confirms. That matters because the failure modes run both ways: "Ayr Joinery" and "Ayr Joinery
// Ltd" are almost certainly one business, while "Ayrshire Motors" and "Ayrshire Roofing" are
// certainly two, and no threshold separates those reliably.

/** Legal forms and noise words that carry no identity. "Ltd" vs "Limited" is not a difference. */
const NOISE = new Set([
  "ltd",
  "limited",
  "plc",
  "llp",
  "lp",
  "cic",
  "co",
  "company",
  "holdings",
  "group",
  "uk",
  "scotland",
  "the",
  "and",
]);

/**
 * A business name reduced to the words that identify it.
 *
 * "The Designer Rooms Ltd." and "designer rooms limited" both become "designer rooms", which is
 * the whole point: a volunteer typing a name from a business card will not match the spelling
 * somebody else used eighteen months ago.
 */
export function normaliseBusinessName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((word) => word.length > 0 && !NOISE.has(word))
    .join(" ");
}

/** The domain of an email address, lowercased. Null when it is not an address we can read. */
export function emailDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return null;
  return email.slice(at + 1).trim().toLowerCase() || null;
}

// Free mailbox providers. Two businesses sharing gmail.com tells you nothing at all, whereas two
// sharing ayrjoinery.co.uk is almost certainly the same firm — so the domain rule has to know the
// difference or it will flag half the list as duplicates of each other.
const PUBLIC_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "hotmail.com",
  "hotmail.co.uk",
  "outlook.com",
  "live.co.uk",
  "yahoo.com",
  "yahoo.co.uk",
  "btinternet.com",
  "sky.com",
  "icloud.com",
  "me.com",
  "aol.com",
]);

export function isPublicDomain(domain: string): boolean {
  return PUBLIC_DOMAINS.has(domain);
}

/**
 * How alike two normalised names are, 0 to 1, by shared word bigrams (Dice coefficient).
 *
 * Bigrams rather than whole words because they survive typos and short forms: "joinery" and
 * "joinerys" score high, while "motors" and "roofing" score near zero. Whole-word overlap alone
 * would call "Ayr Motors" and "Ayr Roofing" a 50% match on the strength of "ayr".
 */
export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const bigrams = (s: string): string[] => {
    const out: string[] = [];
    const padded = ` ${s} `;
    for (let i = 0; i < padded.length - 1; i += 1) out.push(padded.slice(i, i + 2));
    return out;
  };
  const first = bigrams(a);
  const second = bigrams(b);
  const pool = new Map<string, number>();
  for (const g of first) pool.set(g, (pool.get(g) ?? 0) + 1);
  let shared = 0;
  for (const g of second) {
    const left = pool.get(g) ?? 0;
    if (left > 0) {
      shared += 1;
      pool.set(g, left - 1);
    }
  }
  return (2 * shared) / (first.length + second.length);
}

/** Anything the matcher can compare against: past outreach, a donor, a decline. */
export interface Known {
  id: number;
  businessName: string;
  contactEmail: string | null;
  /** What this record IS, so the reason can say so. */
  source: "outreach" | "donor" | "declined";
  /** Free text the reason can quote — "contacted 12 August by Sarah", "monthly donor since June". */
  detail?: string | null;
}

export interface Match {
  id: number;
  source: Known["source"];
  /** Why the volunteer is being shown this. Written for a person, not a log. */
  reason: string;
  /** exact and domain are near-certain; similar wants a human. */
  confidence: "exact" | "domain" | "similar";
}

/**
 * Names this close are shown. Chosen deliberately low: a false positive costs a volunteer two
 * seconds to dismiss, and a false negative costs a business being asked for money twice by the
 * same charity.
 */
export const SIMILAR_THRESHOLD = 0.6;

export function findMatches(
  candidate: { businessName: string; contactEmail?: string | null },
  known: Known[],
): Match[] {
  const name = normaliseBusinessName(candidate.businessName);
  const domain = candidate.contactEmail ? emailDomain(candidate.contactEmail) : null;
  const matches: Match[] = [];

  for (const other of known) {
    const otherName = normaliseBusinessName(other.businessName);
    const otherDomain = other.contactEmail ? emailDomain(other.contactEmail) : null;
    const where = other.detail ? ` (${other.detail})` : "";

    if (name && otherName && name === otherName) {
      matches.push({
        id: other.id,
        source: other.source,
        reason: `Same name as ${other.businessName}${where}`,
        confidence: "exact",
      });
      continue;
    }

    // A shared private domain is stronger evidence than a similar name: two people at one firm
    // have different names on their cards but the same address after the @.
    if (domain && otherDomain && domain === otherDomain && !isPublicDomain(domain)) {
      matches.push({
        id: other.id,
        source: other.source,
        reason: `Same email domain as ${other.businessName}${where}`,
        confidence: "domain",
      });
      continue;
    }

    if (name && otherName && similarity(name, otherName) >= SIMILAR_THRESHOLD) {
      matches.push({
        id: other.id,
        source: other.source,
        reason: `Similar name to ${other.businessName}${where}`,
        confidence: "similar",
      });
    }
  }

  // Most certain first, so the one that matters is not below a fold.
  const order = { exact: 0, domain: 1, similar: 2 } as const;
  return matches.sort((a, b) => order[a.confidence] - order[b.confidence]);
}

/**
 * A decline is not advice, it is an instruction. Separated from findMatches so the caller cannot
 * accidentally treat "they told us no" as one more suggestion to weigh up.
 */
export function isDoNotContact(matches: Match[]): boolean {
  return matches.some((m) => m.source === "declined");
}
