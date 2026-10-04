# Elf Detective School A2: the elf wardrobe: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Everything a detective's elf can wear (25 styles in three colours, and 11 whole outfits), drawn as SVG, with the rule for what each door unlocks, and a PNG of any elf for emails.

**Architecture:** One classic script, `assets/js/elf-wardrobe.js`, holds the catalogue, the unlock rules and every drawing. It exports through `module.exports` on the server and `window.NBCCElf` in the browser. `src/elf/wardrobe.ts` loads that same file with `createRequire` and adds the types, the way `src/fundraising/signers.ts` reads `assets/js/admin/helpers.js`. `src/elf/elf-png.ts` turns a drawing into a PNG with `sharp`, loaded lazily the way `src/fundraising/picture-process.ts` loads it.

**Tech Stack:** a browser script with no build step (an IIFE, `"use strict"`, `var`, string building), a TypeScript wrapper, Vitest, `sharp`.

**The design:** `docs/superpowers/specs/2026-10-04-elf-detective-school-design.md`, decisions 14 and 15 and the "Wardrobe" rule.

**Stage A rules (same as plan A1):** new files only; nothing mounted, nothing reachable; local commits on `elf-detective-school`; no push, no pull request. The repository is public: tests use invented data only. No dashes and no hyphenated words in anything people read.

---

## Changed since this plan was written (read this first)

The code and its tests are the last word. Since this plan: `src/elf/wardrobe.ts` also has `wardrobeState(progress, wonRace)`; `elfPng` takes a background ("clear" or "cream") and answers null when it is busy; `drawElf` takes `key` and `label`, and every drawing carries only its own patterns under ids of its own (give each elf a `key` when several share a page, or elves with the same look would share ids); the wardrobe file has the words too (`pieceWords`, `outfitWords`, `inSentence`, `lookWords`) and a name for each hair colour. The test counts given below have grown.

## Why one file for the browser and the server

The wardrobe screen draws the elf in the browser as a child tries things on. The server draws the same elf for the public calendar, the certificate and the picture in an email, and it is the server that decides what a detective has earned. Two copies of the catalogue would drift, and then a child could be shown a hat the server refuses to save. So there is one file. The server never trusts a look sent by a browser: `normaliseLook` puts the starter kit back for anything unknown or not yet earned, and `drawElf` always calls it first. Only ids from the catalogue ever reach a drawing, so nothing typed can carry markup into the SVG.

## Changed since this plan was written (read this first)

The code and its tests are the last word. Since this plan: `src/elf/wardrobe.ts` also has `wardrobeState(progress, wonRace)`; `elfPng` takes a background ("clear" or "cream") and answers null when it is busy; `drawElf` takes `key` and `label`, and every drawing carries only its own patterns under ids of its own (give each elf a `key` when several share a page, or elves with the same look would share ids); the wardrobe file has the words too (`pieceWords`, `outfitWords`, `inSentence`, `lookWords`) and a name for each hair colour. The test counts given below have grown.

## How this was built

The drawings were made first and judged by eye: every outfit, every piece in every colour, the tiles at their small size, and all five skin tones, on contact sheets rendered with `sharp`. Jaimie saw three of the sheets. The tests were written afterwards, to hold the catalogue and the safety rules still. That is not test first, and it is said here plainly: a drawing has no failing test to write before it exists. The rules (what unlocks when, what a look may wear) are the part the tests pin.

The tests still caught one real thing the eye had missed. The Workshop elf outfit drew exactly the same picture as the starter pieces, so putting it on would have seemed to do nothing. It was redrawn as the starter kit dressed for work: a tool apron with a pencil in the pocket, a toy mallet and a bell on the hat. The test "draws every outfit, worn and as a tile" keeps every outfit different from the starter look.

An independent review then found a second thing of the same kind. A hat is always worn, and it hid short hair completely, so choosing a hair colour seemed to do nothing. Short hair now comes down beside the face. A test draws every hat with every hair style in two hair colours and counts the pixels that change, so the colour a child picks always shows.

The same review tightened three rules: a count of doors that is not a number counts as none (before, it locked even the starter kit); the gold seal and the race win count only as a plain `true`; and each part of a look is read once, so a look that answers differently the second time it is asked cannot get past the check. `elf-png.ts` now treats `sharp` as carefully as the photo code does: cache off, one thread, one picture at a time.

## Changed since this plan was written (read this first)

The code and its tests are the last word. Since this plan: `src/elf/wardrobe.ts` also has `wardrobeState(progress, wonRace)`; `elfPng` takes a background ("clear" or "cream") and answers null when it is busy; `drawElf` takes `key` and `label`, and every drawing carries only its own patterns under ids of its own (give each elf a `key` when several share a page, or elves with the same look would share ids); the wardrobe file has the words too (`pieceWords`, `outfitWords`, `inSentence`, `lookWords`) and a name for each hair colour. The test counts given below have grown.

## The catalogue

Seven slots. A hat, a top and shoes are always worn; the rest can be left off.

| Slot | Style (id) | Colours, each with the number of doors done that unlocks it |
|---|---|---|
| Hats | Elf hat (`elf`) | Red 0, Green 1, Blue 3 |
| Hats | Detective's hat (`deer`) | Tan 4, Grey 5, Green 11 |
| Hats | Bobble hat (`bobble`) | Red 7, Green 7, Blue 9 |
| Hats | Santa hat (`santa`) | Red 11, Green 12, Blue 16 |
| Hats | Tammy (`tammy`) | Red 19, Green 19, Blue 21 |
| Hats | Cracker crown (`crown`) | Red 22, Green 22, Gold 24 |
| Glasses | Round glasses (`specs`) | Black 3, Red 5, Gold 10 |
| Glasses | Star glasses (`stars`) | Gold 16, Red 19, Blue 23 |
| Scarves and ties | Striped scarf (`stripe`) | Red 2, Green 2, Blue 4 |
| Scarves and ties | Tartan scarf (`tartan`) | Red 9, Green 10, Blue 14 |
| Scarves and ties | Tinsel (`tinsel`) | Gold 15, Silver 15, Red 23 |
| Scarves and ties | Bow tie (`bow`) | Red 21, Green 22, Gold 24 |
| Tops | Elf tunic (`tunic`) | Green 0, Red 2, Blue 4 |
| Tops | Christmas jumper (`jumper`) | Red 6, Green 6, Blue 9 |
| Tops | Puffer jacket (`puffer`) | Red 17, Green 17, Blue 20 |
| Tops | Detective's coat (`coat`) | Tan 18, Grey 18, Navy 21 |
| Shoes | Curly shoes (`curly`) | Maroon 0, Green 1, Gold 7 |
| Shoes | Snow boots (`boots`) | Brown 5, Red 6, Blue 8 |
| Shoes | Wellies (`wellies`) | Green 13, Red 13, Yellow 15 |
| Gadgets | Magnifying glass (`mag`) | Brass 1, Silver 3, Gold 11 |
| Gadgets | Torch (`torch`) | Red 8, Green 8, Blue 13 |
| Gadgets | Notebook (`notebook`) | Red 14, Green 14, Blue 17 |
| Gadgets | Lantern (`lantern`) | Gold 20, Red 20, Green 24 |
| Extras | Clue satchel (`satchel`) | Brown 10, Red 12, Green 18 |
| Extras | Star badge (`badge`) | Gold 12, Silver 16, Bronze 23 |

That is 75 things. Three are the starter kit (door 0) and exactly three more come with every door from 1 to 24. The big ones arrive with each promotion: the Christmas jumper at 6, the star badge at 12, the detective's coat at 18.

| Outfit (id) | Unlocks at |
|---|---|
| Workshop elf (`workshop`) | sign up |
| Present (`present`) | 3 doors |
| Christmas tree (`tree`) | 6 doors |
| Christmas pudding (`pudding`) | 9 doors |
| Snowman (`snowman`) | 12 doors |
| Gingerbread elf (`ginger`) | 15 doors |
| Reindeer (`reindeer`) | 18 doors |
| Highland piper (`piper`) | 21 doors |
| Graduation robes (`grad`) | 24 doors |
| Golden detective (`golden`) | the gold seal (all 24 visited) |
| Nessie (`nessie`) | winning a race |

An outfit is one whole costume that replaces the pieces while it is worn. The pieces stay chosen underneath, so taking the outfit off puts them back.

Also: five skin tones (`s1` to `s5`), five hair colours (`dark`, `brown`, `ginger`, `blonde`, `black`) and three hair styles (`short`, `bunches`, `curly`). These are free from the start.

## Changed since this plan was written (read this first)

The code and its tests are the last word. Since this plan: `src/elf/wardrobe.ts` also has `wardrobeState(progress, wonRace)`; `elfPng` takes a background ("clear" or "cream") and answers null when it is busy; `drawElf` takes `key` and `label`, and every drawing carries only its own patterns under ids of its own (give each elf a `key` when several share a page, or elves with the same look would share ids); the wardrobe file has the words too (`pieceWords`, `outfitWords`, `inSentence`, `lookWords`) and a name for each hair colour. The test counts given below have grown.

## Rules, precisely

- `doorsDone` is read as a whole number from 0 to 24. Anything missing, or that is not a real number, counts as 0; more than 24 counts as 24.
- A colour of a style is unlocked when `doorsDone` is at least its door number.
- An outfit is unlocked by its number of doors, or by `goldSeal`, or by `wonRace`, each of which counts only as a plain `true`. The golden detective and Nessie cannot be had any other way.
- A look is `{ skin, hair, hairStyle, outfit, pieces }` with one entry per slot. `normaliseLook(look, state)` returns a look that is safe to keep and to draw: an unknown, locked or wrong slot piece becomes the starter piece in a slot that is always worn and nothing in a slot that can be left off; an outfit that is unknown or not earned comes off; an unknown skin, hair colour or hair style becomes the default.
- `newlyUnlocked(before, after)` lists the pieces and outfits that the change brings, in catalogue order. It is what the "you unlocked" moment and the email read.
- `drawElf(look, state, opts)` returns one `<svg viewBox="0 0 200 260">` string, 1.3 times as tall as it is wide, `size` pixels wide (kept between 16 and 2000). `drawPiece` and `drawOutfit` draw the small tiles for the wardrobe screen.

## Changed since this plan was written (read this first)

The code and its tests are the last word. Since this plan: `src/elf/wardrobe.ts` also has `wardrobeState(progress, wonRace)`; `elfPng` takes a background ("clear" or "cream") and answers null when it is busy; `drawElf` takes `key` and `label`, and every drawing carries only its own patterns under ids of its own (give each elf a `key` when several share a page, or elves with the same look would share ids); the wardrobe file has the words too (`pieceWords`, `outfitWords`, `inSentence`, `lookWords`) and a name for each hair colour. The test counts given below have grown.

## File structure

| File | What it is |
|---|---|
| `assets/js/elf-wardrobe.js` | The catalogue, the rules and the drawings. The only place any of them live. |
| `src/elf/wardrobe.ts` | Loads that file for the server and gives it types. Adds nothing else. |
| `test/unit/elf-wardrobe.test.ts` | 37 tests, through the wrapper, so they hold the real file. |
| `src/elf/elf-png.ts` | `elfPngWidth(asked)` and `elfPng(look, state, width)`: the elf as a PNG on a see through background, made one at a time (`inTurn`). |
| `test/unit/elf-png.test.ts` | 9 tests, with the real `sharp`, including the one that holds the hair colour in view. |

`assets/` is copied into the image whole (`COPY assets ./assets` in the `Dockerfile`), so the new script ships without touching the `Dockerfile`.

---

### Task 1: The wardrobe file, its typed wrapper and their tests

**Files:**
- Create: `assets/js/elf-wardrobe.js`
- Create: `src/elf/wardrobe.ts`
- Test: `test/unit/elf-wardrobe.test.ts`

- [ ] **Step 1: Add the three files**

- [ ] **Step 2: Run the tests**

Run: `npm run test:unit -- test/unit/elf-wardrobe.test.ts`
Expected: PASS, 37 tests.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add assets/js/elf-wardrobe.js src/elf/wardrobe.ts test/unit/elf-wardrobe.test.ts
git commit -m "Elf Detective School: the elf wardrobe, one file for the browser and the server"
```

### Task 2: An elf as a PNG, for emails

**Files:**
- Create: `src/elf/elf-png.ts`
- Test: `test/unit/elf-png.test.ts`

- [ ] **Step 1: Add the two files**

- [ ] **Step 2: Run the tests**

Run: `npm run test:unit -- test/unit/elf-png.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/elf/elf-png.ts test/unit/elf-png.test.ts
git commit -m "Elf Detective School: an elf as a PNG, for emails"
```

### Task 3: Check it all

- [ ] **Step 1: Every elf test**

Run: `npm run test:unit -- test/unit/elf-`
Expected: PASS, every elf test file.

- [ ] **Step 2: The guards that read the whole repository**

Run: `npm run test:unit -- test/unit/elves-workshop-name.test.ts test/unit/dockerfile-site-assets.test.ts test/unit/page-shell.test.ts`
Expected: PASS.

- [ ] **Step 3: Lint and build**

Run: `npm run lint` then `npm run build`
Expected: both exit 0.

- [ ] **Step 4: Only new files**

Run: `git diff --stat origin/main...HEAD`
Expected: only `docs/superpowers/`, `src/elf/`, `test/unit/elf-*` and `assets/js/elf-wardrobe.js`.

## Changed since this plan was written (read this first)

The code and its tests are the last word. Since this plan: `src/elf/wardrobe.ts` also has `wardrobeState(progress, wonRace)`; `elfPng` takes a background ("clear" or "cream") and answers null when it is busy; `drawElf` takes `key` and `label`, and every drawing carries only its own patterns under ids of its own (give each elf a `key` when several share a page, or elves with the same look would share ids); the wardrobe file has the words too (`pieceWords`, `outfitWords`, `inSentence`, `lookWords`) and a name for each hair colour. The test counts given below have grown.

## Not in this plan

The wardrobe screen and the "you unlocked" moment (plan A3). Saving a look, and sending the picture in an email (Stage B).
