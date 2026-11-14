import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";
import { elfPng } from "../elf/elf-png";
import { detectiveName, type DetectiveNameParts } from "../elf/names";
import { shareCardSvg } from "../elf/print";
import { defaultLook, type ElfLook } from "../elf/wardrobe";

// NBCC Elf Detective School (Plan 2c-2): proves, inside the built image, that a share card's name ends clear of the
// card's red frame.
//
// A graduate's share card is drawn on the server, in the fonts the server has (DejaVu in the image: pr.yml checks
// it), not the Georgia the card asks for, and those letters run wider. shareCardSvg sets a name smaller the more
// letters it has, and the wider they are (fit in src/elf/print.ts weighs each letter), and a card made to be shared
// must never cut a child's name off. So this draws the name line of four cards through the real shareCardSvg and
// sharp, finds where each name's ink ends, and fails unless every one ends clear of the frame's inside edge:
//   - the widest name the name rules allow: a ticked first name of 20 letters, all m and w, the widest letters, and
//     the longest surname, 12 letters: "Detective Mwmwmwmwmwmwmwmwmwmw Merrymittens";
//   - a short name with wide letters, which is set biggest: "Detective W. Snowpaw";
//   - a ticked name with a long surname of wide letters: "Detective Ruby Merrymittens";
//   - the longest name the name rules allow: a first name of 20 characters and a 12 letter surname, 43 letters.
// Given a folder, it first draws whole cards into it, so people can see them: two for the operator to approve (a
// name staff have ticked, and one they have not, which shows its first letter) and the four it checks. pr.yml's
// image job runs it in the built image and keeps the folder as the run's "share-cards".
//
//   node dist/scripts/check-share-card.js [folder]
//
// It needs no database and no config: only the card, sharp, and the paper pictures for the elves. Every name is
// invented.

/** The inside edge of the card's red frame: a line 6 units wide drawn on x 1176 (shareCardSvg). */
export const FRAME_INSIDE = 1173;

/** Where a name's line starts on the card, so ink that ends here or before is no name at all. */
const NAME_STARTS = 510;

/** Every door done, so every costume can be worn. */
const EVERY_DOOR = { doors: Array.from({ length: 24 }, (_, i) => i + 1) };

/** The names the check draws: the widest the rules let through, and the other kinds of name most likely to run long. */
export const NAMES_TO_CHECK: readonly DetectiveNameParts[] = [
  { firstName: "Mwmwmwmwmwmwmwmwmwmw", surname: "Merrymittens", approved: true },
  { firstName: "Willow", surname: "Snowpaw", approved: false },
  { firstName: "Ruby", surname: "Merrymittens", approved: true },
  { firstName: "Maximiliano-Wolfgang", surname: "Merrymittens", approved: true },
  // œ and æ are the widest letters outside a to z that the rules let through, and a family may type in capitals.
  { firstName: "Œœœœœœœœœœœœœœœœœœœœ", surname: "Merrymittens", approved: true },
  { firstName: "HUMPHREY-MAXIMILIANO", surname: "Merrymittens", approved: true },
];

/** The two whole cards for people to look at: a graduate whose first name staff have ticked, and one whose name
 *  they have not, each with an elf dressed from the wardrobe. */
const CARDS_FOR_PEOPLE: readonly { file: string; detective: DetectiveNameParts; look: ElfLook }[] = [
  {
    file: "share-card-ruby.png",
    detective: { firstName: "Ruby", surname: "Tinselfoot", approved: true },
    look: { sibling: "sister", skin: "s3", hair: "ginger", hairStyle: "bunches", costume: "graduation", scene: "fireside", friend: "robin", frame: null, glasses: "specs-gold", bow: null },
  },
  {
    file: "share-card-leo-unticked-name.png",
    detective: { firstName: "Leo", surname: "Frostwhistle", approved: false },
    look: { sibling: "brother", skin: "s2", hair: "brown", hairStyle: "short", costume: "detective", scene: "village", friend: null, frame: null, glasses: null, bow: "bow-red" },
  },
];

/** A graduate's share card, as the route draws it. */
const cardOf = (detective: DetectiveNameParts, elfPicture = ""): string =>
  shareCardSvg({ detective, rank: "Graduate", doorsDone: 24, year: 2026 }, elfPicture);

/** One name's line, as checked: its words, the size the card sets them at, where their ink ends, and whether that
 *  is clear of the frame. */
export interface NameLine {
  name: string;
  size: number;
  right: number;
  clear: boolean;
}

/** The name's line from a card, alone on a clear card of the same size, so that only the name's ink is measured;
 *  null for a card with no name line. The name is the card's one text in maroon (#800000). */
export function nameLineSvg(card: string): string | null {
  const line = /<text\b[^>]*\bfill="#800000"[^>]*>[^<]*<\/text>/.exec(card)?.[0];
  return line ? `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">${line}</svg>` : null;
}

/** Where ink ends in a picture's raw RGBA pixels: one past the rightmost column with anything drawn in it, however
 *  faint, so a name that only just touches the frame has touched it. 0 when nothing is drawn. */
export function inkRight(pixels: Buffer, width: number, height: number): number {
  for (let x = width - 1; x >= 0; x -= 1) {
    for (let y = 0; y < height; y += 1) if (pixels[(y * width + x) * 4 + 3] > 0) return x + 1;
  }
  return 0;
}

/** Where a card's name ends, drawn by sharp in this machine's fonts. */
export async function measureName(card: string): Promise<number> {
  const line = nameLineSvg(card);
  if (!line) return 0;
  const { data, info } = await sharp(Buffer.from(line)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return inkRight(data, info.width, info.height);
}

/** Every name's line, measured by `measure` (the real one, or a test's), and whether all end clear of the frame. A
 *  name with no ink past where its line starts was not drawn at all, which fails too. */
export async function checkNames(
  measure: (card: string) => Promise<number>,
  names: readonly DetectiveNameParts[] = NAMES_TO_CHECK,
): Promise<{ ok: boolean; lines: NameLine[] }> {
  const lines: NameLine[] = [];
  for (const detective of names) {
    const card = cardOf(detective);
    const size = Number(/font-size="(\d+)" fill="#800000"/.exec(card)?.[1]);
    const right = await measure(card);
    lines.push({ name: detectiveName(detective), size, right, clear: Number.isFinite(right) && right > NAME_STARTS && right < FRAME_INSIDE });
  }
  return { ok: lines.every((l) => l.clear), lines };
}

/** A file name from a detective's name: "Detective W. Snowpaw" is "detective-w-snowpaw". */
const slug = (words: string): string => words.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** A whole card as a PNG, with its elf drawn from the paper pictures. */
async function wholeCard(detective: DetectiveNameParts, look: ElfLook): Promise<Buffer> {
  const elf = await elfPng(look, EVERY_DOOR, 340);
  return sharp(Buffer.from(cardOf(detective, elf ? `data:image/png;base64,${elf.toString("base64")}` : ""))).png().toBuffer();
}

/** Draws the cards into `folder`, when one is given, then checks the names. Answers the exit code: 0 when every name
 *  ends clear of the frame, 1 otherwise. */
export async function main(folder?: string, measure: (card: string) => Promise<number> = measureName): Promise<number> {
  if (folder) {
    mkdirSync(folder, { recursive: true });
    for (const c of CARDS_FOR_PEOPLE) writeFileSync(resolve(folder, c.file), await wholeCard(c.detective, c.look));
    for (const [i, detective] of NAMES_TO_CHECK.entries()) {
      writeFileSync(resolve(folder, `check-${i + 1}-${slug(detectiveName(detective))}.png`), await wholeCard(detective, defaultLook()));
    }
  }
  const { ok, lines } = await checkNames(measure);
  for (const l of lines) {
    console.log(`${l.name}: ${l.size}px, ends at x ${l.right}, ${l.clear ? "clear of" : "NOT clear of"} the frame's inside edge at x ${FRAME_INSIDE}`);
  }
  if (!ok) {
    console.error(
      "A share card's name runs onto or past the red frame in this machine's fonts (or was not drawn at all). Set names smaller: fit in src/elf/print.ts weighs each letter as a share of the size, m and w 1.1 of the size, M and W 1.25, other capitals 0.8, everything else 0.64, down to 16 at the smallest.",
    );
    return 1;
  }
  console.log("Every name ends clear of the frame.");
  return 0;
}

// Only when run (node dist/scripts/check-share-card.js), not when a test imports it.
if (require.main === module) {
  main(process.argv[2]).then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      console.error("check-share-card failed:", err instanceof Error ? err.message : err);
      process.exitCode = 1;
    },
  );
}
