import { containsBlockedWord } from "../donors/display-name-filter";

// NBCC Elf Detective School: the names children appear by. The design is
// docs/superpowers/specs/2026-10-04-elf-detective-school-design.md (decision 11).
//
// A child is shown on the public calendar only as a detective name: their first name plus a festive
// surname they pick from this list. Never a real surname, a school or an age. The surname comes from
// a fixed list so nothing typed by a member of the public is shown except a checked first name.
//
// A detective name goes on the public calendar the moment an elf is found. Two things keep that
// safe. The first name is held to one word in the letters A to Z (a surname typed after it is
// refused, not shown) and checked against rude words however it is hyphenated, accented or dressed
// up in look alike letters. And because no list of words can catch everything, a first name is shown
// in full only once a member of staff has ticked it: until then the public sees its first letter,
// "Detective R. Tinselfoot". Staff approve everything the public sees; this is how that holds for a
// name that appears the second an elf is found.
//
// Also here: a name for each day's elf, and ideas for the secret word on each elf's tag, so staff
// have something to start from.
//
// Pure: no pool, no config, no clock. Unit tested in test/unit/elf-names.test.ts.

export const FESTIVE_SURNAMES = [
  "Tinselfoot",
  "Snowsleuth",
  "Jinglesnoop",
  "Frostwhistle",
  "Sparkleboots",
  "Hollyhunt",
  "Gingersnap",
  "Twinkletoes",
  "Berrybright",
  "Candycane",
  "Puddingpaws",
  "Bellringer",
  "Snowdrift",
  "Starcatcher",
  "Cocoacup",
  "Sleighbell",
  "Merrymittens",
  "Snugglescarf",
  "Glitterglove",
  "Peppermint",
  "Sugarplum",
  "Ivywink",
  "Wintersleuth",
  "Cluecatcher",
  "Frostyprint",
  "Lanternlight",
  "Tartantrail",
  "Thistledown",
  "Robinwatch",
  "Shortbread",
  "Snowpaw",
  "Baublespy",
  "Crackersnap",
  "Marzipan",
  "Nutmegnose",
  "Icicletrail",
  "Stockingspy",
  "Garlandgaze",
  "Hushfoot",
  "Ribboncurl",
] as const;

/** One name for each day's elf, door 1 first. */
export const ELF_NAMES = [
  "Twinkle",
  "Jingle",
  "Tinsel",
  "Pudding",
  "Sprout",
  "Holly",
  "Bauble",
  "Cracker",
  "Snowdrop",
  "Pip",
  "Nutmeg",
  "Cocoa",
  "Glitter",
  "Fizz",
  "Bramble",
  "Biscuit",
  "Sparkle",
  "Pickle",
  "Muddle",
  "Tumble",
  "Wobble",
  "Giggle",
  "Fidget",
  "Mischief",
] as const;

/** Ideas for the word on an elf's tag: easy for a child to read, spell and type. An idea is only half
 *  of a secret word. This list is public, so a tag also needs three numbers (`secretWord` adds them),
 *  and no idea is the same as an elf's name, which everyone can see. */
export const SECRET_WORD_IDEAS = [
  "SNOWBALL",
  "SLEDGE",
  "CHESTNUT",
  "MUFFIN",
  "MITTENS",
  "SLEIGH",
  "REINDEER",
  "STOCKING",
  "WINTER",
  "SCARF",
  "GINGERBREAD",
  "SNOWFLAKE",
  "CHIMNEY",
  "LANTERN",
  "IGLOO",
  "CAROL",
  "ICICLE",
  "MARZIPAN",
  "SHORTBREAD",
  "STARLIGHT",
  "ROBIN",
  "SNOWMAN",
  "PRESENT",
  "RIBBON",
  "CANDLE",
  "BELLS",
  "ANGEL",
  "TOFFEE",
  "CINNAMON",
  "PENGUIN",
] as const;

/** A whole number from 0 up to, but not including, `size`, from a source of chance that answers from
 *  0 up to, but not including, 1, the way Math.random does. Null if it answers anything else. */
function pick(random: () => number, size: number): number | null {
  const r = random();
  return typeof r === "number" && r >= 0 && r < 1 ? Math.floor(r * size) : null;
}

/** A secret word for a tag: an idea and a three digit number from 100 to 999, like "SNOWBALL 472".
 *  There is never a nought in front, which a child would drop.
 *
 *  It takes a SOURCE of chance, not numbers, so that a caller cannot hand it the door number, the
 *  date or anything else a detective could work out. The ideas are public: the number is all that
 *  keeps a tag's word secret, and it must be different for every tag. Null, never a made up word,
 *  if the source does not answer the way Math.random does. */
export function secretWord(random: () => number): string | null {
  const idea = pick(random, SECRET_WORD_IDEAS.length);
  const number = pick(random, 900);
  return idea === null || number === null ? null : `${SECRET_WORD_IDEAS[idea]} ${100 + number}`;
}

export type FirstNameRefusal = "empty" | "too-long" | "one-word" | "letters-only" | "a-to-z" | "blocked";
export type FirstNameResult = { ok: true; name: string } | { ok: false; reason: FirstNameRefusal };

const FIRST_NAME_MAX = 20;
// One word: letters, with at most one hyphen or apostrophe, which must sit between letters. One, so
// that words cannot be strung together into a sentence.
const FIRST_NAME = /^\p{L}+(?:['-]\p{L}+)?$/u;
const A_TO_Z = /^[a-z]+(?:['-][a-z]+)?$/;

// What a phone keyboard types in place of a plain apostrophe or hyphen. Built from their numbers so
// that no odd character sits in this file.
const PHONE_APOSTROPHES = new RegExp(`[${String.fromCharCode(0x2018, 0x2019, 0x02bc, 0x0060, 0x00b4)}]`, "g");
const PHONE_HYPHENS = new RegExp(`[${String.fromCharCode(0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2212)}]`, "g");

// Letters that do not come apart into a plain letter and an accent, with the plain letters they
// stand for. Without these a Polish or Danish name would be refused, and a dotless i would hide a
// rude word from the check.
const PLAIN_LETTERS: Record<string, string> = { ł: "l", ø: "o", æ: "ae", œ: "oe", ß: "ss", đ: "d", ð: "d", þ: "th", ı: "i" };

// Rude words that are refused wherever they sit in a name, on top of the site's own filter, which
// only matches a whole name. Kept to words that no real first name holds: "shit" is not here,
// because Harshit, Akshita and Ishita are real names.
const ROUGH = ["fuck", "cunt", "wank", "twat", "bitch", "slut", "whore", "pussy", "hitler", "nigg"];

/** What was typed, made plain: wide and fancy letters turned into ordinary ones, accents joined to
 *  their letters, a phone's apostrophes and hyphens turned into the plain ones, the spaces tidied. */
function plain(typed: string): string {
  return typed.normalize("NFKC").replace(PHONE_APOSTROPHES, "'").replace(PHONE_HYPHENS, "-").replace(/\s+/g, " ").trim();
}

/** The name as the checks read it: lower case, accents folded away, down to the letters a to z
 *  wherever that can be done. A letter from another alphabet is left as it is. */
function fold(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[łøæœßđðþı]/g, (letter) => PLAIN_LETTERS[letter] ?? letter);
}

/** A first name as it will be shown: one word of at most 20 characters, in the letters A to Z with
 *  accents, with at most one hyphen or apostrophe inside it, and not a rude word however it is
 *  dressed up.
 *
 *  This is a first check, not the last word. No list of words can stop every rude or revealing name,
 *  so a first name is only shown in public once a member of staff has ticked it: see detectiveName. */
export function cleanFirstName(input: unknown): FirstNameResult {
  const name = typeof input === "string" ? plain(input) : "";
  if (name === "") return { ok: false, reason: "empty" };
  if ([...name].length > FIRST_NAME_MAX) return { ok: false, reason: "too-long" };
  if (name.includes(" ")) return { ok: false, reason: "one-word" };
  if (!FIRST_NAME.test(name)) return { ok: false, reason: "letters-only" };
  // A name the checks below cannot read is not let through unread: another alphabet, or a letter
  // made to look like one of ours.
  const folded = fold(name);
  if (!A_TO_Z.test(folded)) return { ok: false, reason: "a-to-z" };
  const letters = folded.replace(/['-]/g, "");
  const rude = containsBlockedWord(folded) || containsBlockedWord(letters) || ROUGH.some((word) => letters.includes(word));
  if (rude) return { ok: false, reason: "blocked" };
  return { ok: true, name };
}

/** Is this one of the festive surnames, exactly as listed? */
export function isFestiveSurname(surname: string): boolean {
  return (FESTIVE_SURNAMES as readonly string[]).includes(surname);
}

export interface DetectiveNameParts {
  /** As the grown up typed it. It is checked again here, whatever was checked when it was saved. */
  firstName: string;
  /** One of the festive surnames. */
  surname: string;
  /** Has a member of staff ticked this first name? Only a plain true shows it in full. */
  approved: boolean;
}

/** The parts of a name that may be shown: nothing of a first name that fails the checks, and no
 *  surname that is not on the list. */
function shownParts(d: DetectiveNameParts): { first: string | null; surname: string | null } {
  const first = cleanFirstName(d.firstName);
  return { first: first.ok ? first.name : null, surname: isFestiveSurname(d.surname) ? d.surname : null };
}

/** The name without the word Detective, or nothing at all. */
function bareName(d: DetectiveNameParts, inFull: boolean): string {
  const { first, surname } = shownParts(d);
  const shownFirst = first === null ? null : inFull ? first : `${[...first][0].toLocaleUpperCase("en-GB")}.`;
  return [shownFirst, surname].filter((part): part is string => part !== null).join(" ");
}

const titled = (names: readonly string[]): string =>
  names.length === 0
    ? "A detective"
    : names.length === 1
      ? `Detective ${names[0]}`
      : `Detectives ${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

/** How one detective appears IN PUBLIC: "Detective Ruby Tinselfoot" once a member of staff has
 *  ticked the first name, and "Detective R. Tinselfoot" until then.
 *
 *  A name goes on the public calendar the moment an elf is found. Staff approve everything the
 *  public sees, and no list of rude words can stop "Mike-Hunt" or a surname and a village. So until
 *  a name is ticked, the public sees its first letter and the festive surname, both of which are
 *  always safe. The answer is text, not HTML: escape it. */
export function detectiveName(d: DetectiveNameParts): string {
  const name = bareName(d, d.approved === true);
  return titled(name ? [name] : []);
}

/** How a family's detectives appear together in public: "Detectives Ruby Tinselfoot and
 *  S. Snowsleuth". Nothing for no detectives. Text, not HTML. */
export function detectiveNames(detectives: readonly DetectiveNameParts[]): string {
  if (detectives.length === 0) return "";
  return titled(detectives.map((d) => bareName(d, d.approved === true)).filter((name) => name !== ""));
}

/** How a detective appears to their OWN family, on screens only they can see: the whole name, ticked
 *  or not, because they typed it. Still nothing of a first name that fails the checks. Text, not HTML. */
export function familyDetectiveName(d: DetectiveNameParts): string {
  const name = bareName(d, true);
  return titled(name ? [name] : []);
}
