import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { escapeHtml } from "../events/render";

// NBCC Elf Detective School: the school's own logo, the elf in the detective's hat peeping over
// the line with its magnifying glass (Jaimie, 4 October 2026).
//
// Three files, all with the pale background cut away so the logo sits on any light page:
//   assets/img/elf-detective-school.webp        640 square, for the screens
//   assets/img/elf-detective-school-print.webp  full size, for paper
//   assets/img/elf-detective-school-card.png    400 square, for the share card: a picture made
//                                               on the server reads PNG, and may not read WebP
//
// Its lettering is dark red and green, so it goes on cream, white or tan and never on the dark
// red band. It already says the school's name: beside a heading with the same words, give it an
// empty alt.
//
// Unit tested in test/unit/elf-logo.test.ts.

/** The name the logo spells out. */
export const SCHOOL_NAME = "NBCC Elf Detective School";

/** Where the screens fetch the logo from. */
export const SCHOOL_LOGO_SRC = "/assets/img/elf-detective-school.webp";

/** The logo on a screen, `size` CSS pixels square. */
export function schoolLogo(size: number, alt: string = SCHOOL_NAME, className = "elf-logo"): string {
  const px = Math.max(16, Math.min(640, Math.floor(Number(size)) || 0));
  return `<img class="${escapeHtml(className)}" src="${SCHOOL_LOGO_SRC}" alt="${escapeHtml(alt)}" width="${px}" height="${px}" decoding="async" />`;
}

const REPO_ROOT = resolve(__dirname, "../..");
const FILES = {
  print: { path: "assets/img/elf-detective-school-print.webp", type: "image/webp" },
  card: { path: "assets/img/elf-detective-school-card.png", type: "image/png" },
} as const;
const cached: Partial<Record<keyof typeof FILES, string>> = {};

/** The logo as an address that holds the whole picture, for a page that must print or be turned
 *  into a picture with nothing left to fetch. Read once and kept. */
export function schoolLogoData(kind: keyof typeof FILES): string {
  const file = FILES[kind];
  return (cached[kind] ??= `data:${file.type};base64,${readFileSync(resolve(REPO_ROOT, file.path)).toString("base64")}`);
}
