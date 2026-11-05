# Elf Detective School, plan A4: the print pages

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The five things NBCC prints or shares for the game: the poster for a hiding place, the card for its staff, the tag on the elf, the graduate's certificate and the share card.

**Architecture:** Pure functions in `src/elf/print.ts` that turn a small view into a whole page (or, for the share card, an SVG). They reuse the site's own print shell, fonts and QR code (`shell`, `materialAssets` in `src/fundraising/materials.ts`; `qrSvg` in `src/fundraising/qr.ts`) and change neither. Nothing is mounted: Stage B gives them routes behind staff or family sign in.

**Tech stack:** TypeScript, Vitest (jsdom for the pages). No new dependency.

The design is `docs/superpowers/specs/2026-10-04-elf-detective-school-design.md` (decisions 6, 8, 13, 16 and the stage list). Stage A rules still hold: new files only, local commits, nothing wired in.

---

## What each piece must do

| Piece | Paper | Who prints it | What it carries |
|---|---|---|---|
| Poster | A4 portrait | NBCC, one for each place | The place's name, a QR code to its poster page, how to claim and how to check in, the grown up line, the charity statement. It stays up all month, so it NEVER says when the elf is here. |
| Staff card | A4 portrait | NBCC, one for each place | The place's day and clue time (private to the shop), what to do that morning, how to tell the real gold screen (shop name, today's date, a clock that ticks), what to hand over, and NBCC's number for the "too many wrong words" case (Jaimie, 4 October: the staff phone NBCC). |
| Tag | A4 sheet of one tag, cut out | NBCC, one for each elf | The elf's name and its secret word, large, and one line telling the finder what to do. The word must pass `isUsableSecretWord`. |
| Certificate | A4 landscape | The family | "Graduate of NBCC Elf Detective School, Class of 2026", the detective's name as the family sees it, their badge number, their dressed elf, the gold seal if earned, the date. |
| Share card | 1200 by 630 SVG | The family (Stage B makes the PNG) | The elf and the rank. Never a child's photo, and the first name only when staff have ticked it (`detectiveName`). |

Wording rules as for the screens: plain English, no dashes, no hyphenated words, `Elves' Workshop`, "could" for money.

## Views (in `src/elf/print.ts`)

```ts
export interface PlacePrint { placeName: string; placeTown: string; siteOrigin: string /* from config: "https://nbcc.scot" */; posterUrl: string /* that site's /elf/p/<code> */ }
export interface StaffCardPrint { placeName: string; door: Door; elfName: string; clueAt: Date; phone: string }
export interface TagPrint { elfName: string; secretWord: string }
export interface CertificatePrint { name: string; badgeNumber: string; year: number; look: unknown; state: WardrobeState; awardedOn: Date }
export interface ShareCardPrint { detective: DetectiveNameParts; rank: Rank; doorsDone: number; look: unknown; state: WardrobeState; year: number }
```

## Changed after the final review (read this first)

- The poster is refused unless its address is a poster page on `siteOrigin`, which Stage B takes from config and never from a request. Any other host throws.
- The staff card throws unless the door is 1 to 24 and the clue comes out on that day of December in London, so no shop is told the wrong day. It no longer takes a poster address.
- The certificate throws unless `state.doorsDone` is 24, and takes the gold seal from `state.goldSeal === true` only. Its heading is "Graduate Elf Detective" under "Class of 2026". The year beside the date comes from the date.
- The share card takes the detective's name in parts and calls `detectiveName` itself, so a first name staff have not ticked cannot be shared in full by mistake.
- A long place name is set smaller on the poster, and a long name on the share card.
- For Stage B: the site's print shell adds NBCC's fundraising "Need something else" box on screen (never on paper); decide whether a family's certificate should show it. Stamp photos must be kept until judging (Jaimie, 4 October: staff check gold seal finishers' photos first).

## Tasks

### Task 1: the poster and the staff card
- [ ] Tests first (`test/unit/elf-print.test.ts`): the poster holds the place, one QR code whose text is the poster URL, the claim and check in lines, the grown up line and the charity statement; it has no door number, no date and no time; the staff card holds the door, the day, the clue time, the elf's name, the three checks for the gold screen and the phone number; a poster URL that is not https on this site's own host is refused (the function throws, so a bad QR is never printed); everything from data is escaped.
- [ ] Write `renderElfPoster`, `renderStaffCard`. Run. Commit.

### Task 2: the tag
- [ ] Tests first: the word is shown as written, in capitals; a word that fails `isUsableSecretWord` throws; the elf's name is escaped.
- [ ] Write `renderElfTag`. Run. Commit.

### Task 3: the certificate and the share card
- [ ] Tests first: the certificate names the detective, the year, the badge and the date in words, draws their elf from the look made safe, and shows the gold seal only for a plain true; the share card is one SVG of 1200 by 630 with the public name, the rank and the elf, and nothing else from the family.
- [ ] Write `renderElfCertificate`, `shareCardSvg`. Run. Commit.

### Task 4: checks
- [ ] House rules for the print pages in the same test file: no dashes or hyphenated words in anything read, the charity statement on every printed page, one `@page` rule each.
- [ ] Every elf test, lint, build; look at each piece in the stand-in (`/elf/print/poster` and so on); show Jaimie.

## Not in this plan

Routes, sign in, turning the share card into a PNG, and the emails that carry it (Stage B).
