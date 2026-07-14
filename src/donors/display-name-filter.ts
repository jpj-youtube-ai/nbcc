// TASK-223: a first-line bad-word filter for PUBLIC display names on the supporters wall. NO pool, NO
// config, NO clock — a pure function on a string, unit-tested DB-free (CLAUDE.md golden rule 5).
//
// It is applied in two places:
//   1. at CAPTURE — a business's custom credit_name is rejected at source if it trips the filter
//      (src/routes/business.ts), with a plain, dash-free error; and
//   2. at RENDER — a safety net that omits any wall entry whose FINAL display name trips it
//      (src/db/donations-model.ts groupPublicSupporters), so a name that slipped in before this
//      existed, or one derived from a legacy business_name, is never shown.
//
// It is INTENTIONALLY CONSERVATIVE: a short, curated blocklist rather than an exhaustive one. Most
// terms are matched as WHOLE WORDS (tokens split on non-letters), which avoids the classic
// "Scunthorpe problem" — an innocent word like "Scunthorpe" or the surname "Cockburn" merely contains
// a shorter blocked word as a substring and must NOT be flagged. Only a tiny set of slurs that have no
// benign use are additionally blocked as substrings. This is a net, not a guarantee: the admin
// business-supporter fulfilment list is still reviewed by a human before anyone is marked as added to
// the wall.

// Whole-word blocklist: common profanity + slurs. Matched against the lower-cased name's tokens, so
// each of these only trips when it appears as a standalone word (surrounded by spaces / punctuation /
// string edges), never as a fragment of a longer, innocent word.
const BLOCKED_WORDS: readonly string[] = [
  // Profanity.
  "arse",
  "arsehole",
  "ass",
  "asshole",
  "bastard",
  "bitch",
  "bollocks",
  "bugger",
  "cock",
  "cocksucker",
  "crap",
  "cunt",
  "dick",
  "dickhead",
  "fuck",
  "fucker",
  "fucking",
  "motherfucker",
  "piss",
  "prick",
  "shit",
  "shite",
  "slut",
  "twat",
  "wank",
  "wanker",
  "whore",
  // Slurs (racial, homophobic, ableist). Blocked as whole words so real surnames / place names that
  // merely contain them are not caught.
  "chink",
  "coon",
  "faggot",
  "fag",
  "kike",
  "paki",
  "raghead",
  "retard",
  "spastic",
  "spic",
  "tranny",
  "wetback",
];

// A very small set of slurs blocked even as a SUBSTRING — these have no benign embedding in ordinary
// English or in place / business names, so catching them inside a token (e.g. "best4nigger") closes an
// obvious evasion without risking the Scunthorpe problem. Kept deliberately minimal and reviewed.
const BLOCKED_SUBSTRINGS: readonly string[] = ["nigger", "nigga"];

// True when `name` contains a blocked word (case-insensitive). Empty / whitespace-only input is never
// blocked. Whole-word matching for the main list; a tiny substring list for no-benign-use slurs.
export function containsBlockedWord(name: string): boolean {
  if (!name) return false;
  const lower = name.toLowerCase();

  // Whole-word pass: split on any run of non-letters, so "fuck off ltd" → {fuck, off, ltd} but
  // "scunthorpe" stays one token that does not equal "cunt".
  const tokens = new Set(lower.split(/[^a-z]+/).filter(Boolean));
  for (const word of BLOCKED_WORDS) {
    if (tokens.has(word)) return true;
  }

  // Substring pass over the letters-only collapse of the name (so digits / separators used to smuggle
  // a slur do not hide it), for the tiny no-benign-use list only.
  const collapsed = lower.replace(/[^a-z]/g, "");
  for (const bad of BLOCKED_SUBSTRINGS) {
    if (collapsed.includes(bad)) return true;
  }

  return false;
}
