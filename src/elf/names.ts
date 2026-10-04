import { containsBlockedWord } from "../donors/display-name-filter";

// NBCC Elf Detective School: the names children appear by. The design is
// docs/superpowers/specs/2026-10-04-elf-detective-school-design.md (decision 11).
//
// A child is shown on the public calendar only as a detective name: their first name plus a festive
// surname they pick from this list. Never a real surname, a school or an age. The surname comes from
// a fixed list so nothing typed by a member of the public is shown except a checked first name.
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
  "Cluefinder",
  "Frostyprint",
  "Lanternlight",
  "Tartantrail",
  "Thistledown",
  "Robinwatch",
  "Shortbread",
  "Snowpaw",
  "Baublespy",
  "Crackerjack",
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

/** Ideas for the word on an elf's tag: easy for a child to read, spell and type. */
export const SECRET_WORD_IDEAS = [
  "SNOWBALL",
  "TINSEL",
  "JINGLE",
  "COCOA",
  "MITTENS",
  "SLEIGH",
  "REINDEER",
  "STOCKING",
  "BAUBLE",
  "CRACKER",
  "GINGERBREAD",
  "SNOWFLAKE",
  "CHIMNEY",
  "LANTERN",
  "PUDDING",
  "CAROL",
  "ICICLE",
  "MARZIPAN",
  "SHORTBREAD",
  "HOLLY",
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

export type FirstNameRefusal = "empty" | "too-long" | "letters-only" | "blocked";
export type FirstNameResult = { ok: true; name: string } | { ok: false; reason: FirstNameRefusal };

const FIRST_NAME_MAX = 20;
// Starts with a letter; then letters, spaces, hyphens and apostrophes. Letters in any alphabet.
const FIRST_NAME = /^\p{L}[\p{L}' -]*$/u;

/** A first name as it will be shown: trimmed, single spaces, at most 20 characters, letters only, not blocked. */
export function cleanFirstName(input: unknown): FirstNameResult {
  const name = typeof input === "string" ? input.trim().replace(/\s+/g, " ") : "";
  if (name === "") return { ok: false, reason: "empty" };
  if ([...name].length > FIRST_NAME_MAX) return { ok: false, reason: "too-long" };
  if (!FIRST_NAME.test(name)) return { ok: false, reason: "letters-only" };
  if (containsBlockedWord(name)) return { ok: false, reason: "blocked" };
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
