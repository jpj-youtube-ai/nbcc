import { containsBlockedWord } from "../donors/display-name-filter";

// NBCC Elf Detective School: the names children appear by. The design is
// docs/superpowers/specs/2026-10-04-elf-detective-school-design.md (decision 11).
//
// A child is shown on the public calendar only as a detective name: their first name plus a festive
// surname they pick from this list. Never a real surname, a school or an age. The surname comes from
// a fixed list so nothing typed by a member of the public is shown except a checked first name.
//
// A detective name goes on the public calendar the moment an elf is found, before any member of
// staff has looked. So the first name is held to one word (a surname typed after it is refused, not
// shown), and it is checked against the blocked words however it is hyphenated or accented.
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
 *  of a secret word. This list is public, so a tag also needs three numbers (`secretWordFrom` adds
 *  them), and no idea is the same as an elf's name, which everyone can see. */
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

/** A whole number wrapped into 0 up to, but not including, `size`. Anything that is not a number counts as 0. */
function wrap(n: number, size: number): number {
  const whole = Number.isFinite(n) ? Math.trunc(n) : 0;
  return ((whole % size) + size) % size;
}

/** A secret word for a tag: an idea and a three digit number from 100 to 999, like "SNOWBALL 472".
 *  The caller picks both numbers AT RANDOM, and they are wrapped into range, so the answer always
 *  passes isUsableSecretWord in src/elf/claim.ts. Never a nought in front, which a child would drop. */
export function secretWordFrom(pick: number, number: number): string {
  return `${SECRET_WORD_IDEAS[wrap(pick, SECRET_WORD_IDEAS.length)]} ${100 + wrap(number, 900)}`;
}

export type FirstNameRefusal = "empty" | "too-long" | "one-word" | "letters-only" | "blocked";
export type FirstNameResult = { ok: true; name: string } | { ok: false; reason: FirstNameRefusal };

const FIRST_NAME_MAX = 20;
// One word. It starts and ends with a letter, with letters, hyphens and apostrophes between. Letters
// in any alphabet.
const FIRST_NAME = /^\p{L}(?:[\p{L}'-]*\p{L})?$/u;

// What a phone keyboard types in place of a plain apostrophe or hyphen. Built from their numbers so
// that no odd character sits in this file.
const PHONE_APOSTROPHES = new RegExp(`[${String.fromCharCode(0x2018, 0x2019, 0x02bc, 0x0060, 0x00b4)}]`, "g");
const PHONE_HYPHENS = new RegExp(`[${String.fromCharCode(0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2212)}]`, "g");

/** What was typed, made plain: accents joined to their letters, a phone's apostrophes and hyphens
 *  turned into the plain ones, and the spaces tidied. */
function plain(typed: string): string {
  return typed.normalize("NFC").replace(PHONE_APOSTROPHES, "'").replace(PHONE_HYPHENS, "-").replace(/\s+/g, " ").trim();
}

/** The name's letters alone, with accents folded away. The blocked word check looks at this too. */
function lettersOnly(name: string): string {
  return name.normalize("NFD").replace(/\p{M}/gu, "").replace(/[^\p{L}]/gu, "");
}

/** A first name as it will be shown: one word of at most 20 characters, made of letters with hyphens
 *  and apostrophes inside it, and not a blocked word however it is hyphenated or accented. */
export function cleanFirstName(input: unknown): FirstNameResult {
  const name = typeof input === "string" ? plain(input) : "";
  if (name === "") return { ok: false, reason: "empty" };
  if ([...name].length > FIRST_NAME_MAX) return { ok: false, reason: "too-long" };
  if (name.includes(" ")) return { ok: false, reason: "one-word" };
  if (!FIRST_NAME.test(name)) return { ok: false, reason: "letters-only" };
  if (containsBlockedWord(name) || containsBlockedWord(lettersOnly(name))) return { ok: false, reason: "blocked" };
  return { ok: true, name };
}

/** Is this one of the festive surnames, exactly as listed? */
export function isFestiveSurname(surname: string): boolean {
  return (FESTIVE_SURNAMES as readonly string[]).includes(surname);
}

/** How one detective appears in public: "Detective Ruby Tinselfoot". */
export function detectiveName(firstName: string, surname: string): string {
  return `Detective ${firstName} ${surname}`;
}

/** How a family's detectives appear together: "Detectives Ruby Tinselfoot and Sam Snowsleuth". */
export function detectiveNames(detectives: readonly { firstName: string; surname: string }[]): string {
  const names = detectives.map((d) => `${d.firstName} ${d.surname}`);
  if (names.length === 0) return "";
  if (names.length === 1) return `Detective ${names[0]}`;
  return `Detectives ${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
