# Elf Detective School in paper: every page, and a costume wardrobe

Written 4 November 2026. This design amends three earlier ones, and wins where they disagree:

- `docs/superpowers/specs/2026-11-03-elf-painted-wardrobe-design.md` (the painted, layered wardrobe): its layers, its
  pieces and outfits, and its unlock list are replaced.
- `docs/superpowers/specs/2026-10-04-elf-detective-school-design.md`, decisions 14 and 15 and the unlock rule (lines
  143 to 145, "a piece colour unlocks at a number of doors done ... an outfit ... for the Gold seal, or for a race
  win"): replaced by the per door costume rule below. The rest of that design stands.
- `docs/superpowers/specs/2026-11-03-elf-detective-secret-places-design.md` (lines 33 to 34, "no change to the
  wardrobe or outfits"): overtaken here. The rest stands, including the typed guess, the three clue times and "no gold,
  silver or bronze" (line 36).

The wave 1 plan (`docs/superpowers/plans/2026-11-03-elf-detective-wave1-sign-up.md`) is built (tasks 1 to 11, a final
review, draft PR #711). This design is the work that turns wave 1 into paper and replaces its wardrobe before the
switch goes on.

## Why

The dress up elf was to be built from painted layers: a painted elf, and painted hats, tops, shoes and gadgets laid on
top. Three ways of painting those layers failed Jaimie's checks (2 to 4 November 2026: edges that did not meet, backs of
hats and scarves showing, jumpers not over the arms). A research report (`reports/Dress up elf layering methods.md`,
outside the repo, in the folder that holds it) found the root cause: separately painted pictures never
share outlines, so no piece fits every elf. Games that do layering draw every piece on one locked body. The practical
route this year is whole costumes, each painted on one elf, plus extras that never touch the elf.

Along the way Jaimie rejected the look of the wardrobe mockups as "an Office 365 program", then "40% fun", then "very
ChatGPT", and chose a paper cut art direction: everything looks cut from coloured card, with torn edges, layered sheets
and soft shadows between them. After six mockups Jaimie said of the sixth: "Yes, this is it."

Then: "make sure that this same paper ... cover the rest of this section ... All of the elf detective [pages] should look
like this, including where you go to sign up and then like where the clues are and the calendar itself. Everything should
look like this paper cutout type style, but try and use as many of the existing stuff that you've created as possible."

## What Jaimie decided

All on 4 November 2026 unless dated otherwise.

1. **Costumes and extras, not layers.** Whole hooded costumes, plus glasses and bow ties, plus extras that never touch
   the elf: a scene behind, a friend beside, a frame round the picture.
2. **51 costumes:** 3 from the start, then 2 new costumes for each of the 24 doors. All hooded: the hood covers the
   hair and ears, so only the face shows.
3. **Costumes are not prizes.** Winning a race and visiting all 24 places win physical prizes only. Every child who
   takes part in a door gets that door's two costumes.
4. **A door's two costumes unlock for a right answer** to that door, whichever clue it came after, **or for visiting
   the place later** (catching up). A wrong answer alone unlocks nothing. Jaimie's words: "Everyone gets a costume when
   the door opens ... for everyone that takes part in that day's door and answers the question, whether they answer it
   at the gold, silver, or bronze level." The secret places design has no gold, silver or bronze; "any level" here means
   "after any of the three clues". So: a door is done for a detective when it is cracked or visited, exactly as
   `progressOf` already defines.
5. **All extras from sign up:** every scene, friend, frame, pair of glasses and bow tie is available from the start.
6. **Locked costumes show faint with a padlock.** Newly unlocked costumes arrive as wrapped presents to tap open (the
   approved mockup).
7. **Page shape:** step 1 (boy or girl, skin, hair) folds away once made; step 2, dress up, shows one section at a time
   under gift tag tabs.
8. **Paper cut look** for the wardrobe (mockup 6, "Yes, this is it"), **then for every Elf Detective School page**,
   reusing the pieces already made.
9. **The art, every piece approved after a close up check:**
   - the paper girl and boy masters ("Yes, both");
   - all 150 elves ("Yes, all good"), later corrected so the whole neck is toned and the jumper is untouched;
   - all 51 costumes in all five skin tones ("Yes, all good");
   - glasses and bow ties ("the accessories are all good");
   - 16 scenes. Six came first. Ten Ayrshire landmarks followed ("choose locations from around Ayrshire ... iconic
     landmarks"; "Just add more. More is better"). Ayr was painted three times and its name became River Ayr ("Yes,
     River Ayr is good");
   - six friends, facing forward and sitting just in front of the elf on the plinth ("The pets look all good").
10. **Spend cap £23** for the painting ("Raise to £23"). Spent so far: $22.82 on the ledger plus about $2.50 of early
    tests, about £19.30.
11. **Open all together.** Every page is in paper before sign ups open. If the work slips, sign ups open later than
    Friday 13 November, rather than opening with some pages still to come.
12. **Pictures, then live.** Jaimie approves every restyled page from pictures at phone and laptop size. Then the whole
    build (wave 1 and this work, one pull request, PR #711) merges switched off, around Tuesday 10 November and never
    before Sunday 8 November. Then Jaimie clicks through it on the live site with the hidden preview link
    (`/elf/preview/:token`, made in the admin) before staff switch it on. Small fixes go in as further merges.
13. **The calendar looks like an advent calendar.** Jaimie, approving the plan: "when you say calendar, it looks like an
    advent calendar." So the 24 doors are set into one calendar board, as little doors that open, not laid out as a
    grid of separate cards.

## What is already made

Every picture is in git ignored folders of the worktree and backed up to
the folder `elf-paintings-backup-2026-11-03/paper-2026-11-04` beside the repository (the paid for paintings, the
scripts and a README). Nothing below is in the repo yet. Sizes are of the preview cut outs.

| What | Where (preview cut outs) | Count | Notes |
|---|---|---|---|
| Elves | `.superpowers/sdd/2026-11-03-elf-detective-wave1-sign-up/preview/paper/elves/elf-<sibling>-<skin>-<style>-<hair>.webp` | 150 | 640 by 960, the master's whole canvas (1024 by 1536 scaled), magenta keyed out |
| Costumes | `.../preview/paper/costumes/<id>-<skin>.webp` and `tile-<id>-<skin>.webp` | 51 by 5 | the same canvas; tiles cut to the box that holds all 51 whole |
| Glasses and bow ties | `.../preview/paper/pieces/<id>.webp` | 9 | layers on the same canvas, over the elf |
| Friends | `.../preview/paper/friend-<id>.webp` | 6 | cut out, facing forward |
| Scenes | `.../preview/paper/stage.webp` (Snowy village window) and `scene-<id>.webp` | 16 | 720 wide, 2 by 3 |
| Decorations | `.../preview/paper/{present-crimson,present-holly,present-cream,candy-cane,holly,bauble,bow-gold}.webp` | 7 | cut out |
| Icons | `.../preview/paper/icon-{costume,scene,friend,frame,glasses,paint,lock,surprise,camera,bell}.webp` | 10 | cut out |
| Paper grain | `.../preview/paper/grain.webp` (grey, soft light over strong colours), `grain-light.webp` (near white, multiplied over cream) | 2 | seamless tiles |
| Paper look | `.../preview/wardrobe-paper2.html` (mockup 6) and its builder `make6.mjs`, `paper6.css`, `paper6.js` in this session's scratchpad `costume-mockup/` | | the approved look |

The raw paintings (1024 by 1536 PNG) are in `.elf-paint/deco/paper/`, with the scripts that made them in
`.elf-paint/deco/`. The skin of every elf and costume was set by code, not painting
(`paper-skin-tones.mjs`, `paper-costume-tones.mjs`, sharing `skin-tone-core.mjs`).

Names (public words, approved on the sheets): the 51 costumes are listed with their doors in
`.elf-paint/deco/paper-costumes.json`. Scenes: Snowy village window, Elves' Workshop, Snowy forest, Highland loch,
Cosy fireside, Rooftops at midnight, River Ayr, Prestwick beach, Girvan harbour, The Pencil, Largs, Dumfries House,
Cumnock, Culzean Castle, Burns Cottage, Alloway, Troon harbour, Crocodile Rock, Millport, Dean Castle, Kilmarnock.
Friends: Robin, Reindeer calf, Penguin chick, Scottie puppy, Highland calf, Wee snowman. Frames: Candy cane, Gold, Holly,
Tartan, Starry. Glasses: Black glasses, Gold glasses, Red glasses, Gold stars, Red stars, Blue stars. Bow ties: Red, Green,
Gold.

## The paper look

The look is the sixth mockup's, built in `assets/css/elf.css` under the house rules the section already has (the
house rules test: `test/unit/elf-pages-house-rules.test.ts:301-337`). The mockup broke those rules (plain class names,
`!important`, a "reduce" override block, 214 KB of torn shapes inlined as data addresses); the real stylesheet must not.

**The pieces** (each reused across pages):

| Piece | What it is | Made of |
|---|---|---|
| Paper page | cream with a fine paper grain | `grain-light.webp`, multiplied |
| Torn bands | holly over crimson, torn along their foot, each with the white core of the tear, under the nav | an inline SVG drawn once (it slices to the screen width, so its teeth stay the same size) |
| Cut paper hills | holly hills with cream paper trees, crimson and maroon hills in front, running into the maroon footer | an inline SVG |
| Title strip | a page's title on a torn strip of card laid over a torn strip of colour, with scraps of torn paper behind and the painted candy cane and holly | two torn SVG strips, scraps, two decorations |
| Heading strip | the same, smaller, for section headings | the same |
| Card sheet | a torn sheet of card on a torn coloured backing sheet, with a shadow under both | CSS masks of torn edges that tile round a box of any size |
| Torn button | torn paper on a darker torn edge; tap it and it presses down onto its edge | torn shape pictures in a few sizes and colours |
| Chip | a small torn label (Done, Today, Missed, a date) | small torn shapes |
| Rosette | a scalloped paper rosette, for numbers and counts, with tails for the big one | inline SVG |
| Gift tags | tabs that hang from a gold paper ribbon with a bow, two sheets each | inline SVG |
| Candy cane progress | a torn candy cane strip in a torn paper slot | CSS |
| Note | torn kraft or cream paper, most with a strip of tape | torn shapes |
| Paper circles | colour choices cut as circles of paper on a cream mount, a crimson mat under the one picked | inline SVG |
| Decorations and icons | the painted presents, holly, candy cane, bauble, gold bow and the ten icons | the pictures above |

**Rules for building it:**

- **Never drift from the paper look.** Jaimie, 4 November 2026: "make sure when you're doing any assets or creating any
  assets, you don't start drifting from that really paper look. Keep referring back to the paper." Every new piece,
  painted or drawn in CSS or SVG, is checked side by side against the approved references before it is used or shown:
  the paper sample `.elf-paint/deco/sheets/style-paper.png`, mockup 6 (`wardrobe-paper2.html`) and the approved
  pictures. A new painting always passes the paper sample as its first picture ("use only as the guide to the style").
  Anything glossy, 3D, flat vector, outlined like a cartoon, or outside the brand colours is redone, not shown.
- Every selector starts `.elf-`, nothing uses `!important`, nothing scrolls inside a box, and every animation and
  transition sits inside `@media (prefers-reduced-motion: no-preference)`; keyframes move only `transform` and
  `opacity` (house rules test). Nothing waits for an animation.
- The torn shapes are files, not data addresses: a handful of small SVG files under `assets/img/elf/paper/ui/` (torn
  edge strips for card masks, torn button and chip shapes in each colour, tape, the paper grain), drawn once by a
  script and committed. The mockup's generator (`make6.mjs`) has the drawing code; its seeded random numbers keep the
  shapes the same on every visit.
- The calendar page keeps exactly two stylesheets (`elf-page-calendar.test.ts:36-37`), so the paper look stays inside
  `elf.css`; `elf.css` stays out of `styles.css` (donate.html is at its budget).
- Fonts stay the house faces: Playfair Display for titles, Poppins for text, Caveat (already in `elf.css`) for the
  handwritten labels. All headings and words are real text.
- Light comes from the top left: every shadow falls down the page. Colours are the brand's six and the tints the site
  already uses.
- Sounds (in the wardrobe) are off until switched on.

## Page by page

Wave 1 pages (switch on Friday 13 November):

| Page | Route, renderer | Paper pieces |
|---|---|---|
| Every page (shell) | `src/elf/pages/shell.ts` | paper page, torn bands under the nav, cut paper hills above the footer, a few drifting paper stars and snow |
| Calendar | `GET /elf`, `src/elf/pages/calendar.ts`, `door.ts` | the school logo heading stays (Stage A rule) with a torn strip under it; the countdown on a candy cane strip; an advent calendar (decision 13): one big card board with a painted paper scene across its face and the 24 doors cut into it as hinged card doors, each with a cut line round it, a shadow under it, a little paper pull tab and its number printed large, door 24 the big double doors; an open door stands open on its hinge. A shut door is closed but bright, never faint (the padlock is only for locked costumes), with its date on a chip and its prize shape (main design decision 12, kept by the secret places design) as a paper cut out of the same shape, or the mystery star as a paper star until staff add a shape. Today's door glows gold with the painted bow. Open doors (found or revealed) show for everyone; the signed in family's own done doors (cracked or visited, added by the calendar's script from `/api/elf/me`, as now) get the painted holly. The door detail is a taped note; status pills are chips. In wave 1 every door is shut and shows the mystery star |
| Rules | `GET /elf/rules`, `rules.ts` | a sheet torn off a notepad with tape; headings on heading strips; list bullets as small paper circles |
| Enrol and pay what you can | `GET /elf/join`, `join.ts`, `gift.ts` | the present hero becomes the painted paper present with a paper gift tag ("Top secret") and a rosette ("24 prizes"); the form on a card sheet; amount choices as torn buttons; the pay button a crimson torn button; ticks as paper boxes |
| Sign in, welcome | `sign-in.ts` | the form on a card sheet, torn buttons; the welcome with the painted presents and a fall of paper stars |
| Detective HQ | `GET /elf/hq`, `hq.ts` | title strip; each detective on a card sheet with their elf's picture in its chosen frame; the day's case on a taped note; links as gift tags or torn buttons |
| Wardrobe | `GET /elf/hq/wardrobe/:detective`, `wardrobe.ts` | as mockup 6, with the real data below |

Wave 2 pages (before Tuesday 1 December), when they are built, use the same pieces: the clue and guess screens on HQ,
the places, the poster page (claim, "You're first!", the candy cane check in), and the print pages (poster, staff card,
elf tag, certificate, share card), the print ones without the grain and shadows that printers smear.

For wave 2's own design, Jaimie's ideas of 4 November 2026: Jaimie will give the list of prizes (each door's prize and
the shape cut out of its door) and the secret places (from which the clues are written). At the place, the finder
scans the poster's QR code beside the elf, takes a photo of themselves with it, and can upload it to show behind that
door on the calendar when it opens; if they would rather not, their dressed up elf shows instead. Jaimie would like
families encouraged to share the photo. This sits under the main design's decision 11 (a photo goes public only with
the grown up's yes for that photo and a staff check, location data removed, every photo down at the end of January),
and the ICO Children's Code's rule against nudging (standard 13) means the photo and the elf are offered as equally
happy choices.

Not restyled: the emails (mail apps cannot show masks or blend modes; they keep NBCC's email look, with only their
words updated), and the admin screens.

## The wardrobe

**What there is.** A catalogue in `assets/js/elf-wardrobe.js`, still shared by the browser and the server:
`SIBLINGS`, `SKIN_TONES`, `HAIR_COLOURS`, `HAIR_STYLES` (unchanged), and new `COSTUMES` (51: `{ id, name, door }`,
door 0 for the three starters, from `paper-costumes.json`), `SCENES` (16, `village` first and the default),
`FRIENDS` (6), `FRAMES` (5), `GLASSES` (6) and `BOWS` (3). The old `SLOTS`, `STYLES`, `OUTFITS`, the piece lists and
`newlyUnlocked` go.

**A look.** `ElfLook` becomes
`{ sibling, skin, hair, hairStyle, costume: string | null, scene: string, friend: string | null, frame: string | null, glasses: string | null, bow: string | null }`.
`normaliseLook(look, state)` keeps its contract: it always returns a whole, safe look; anything unknown, or a costume
not yet unlocked, falls back (costume to `null`, scene to `village`, the others to `null`); the starting look is a
sister, skin 3, red bunches, no costume, the village window, no friend, frame, glasses or bow tie. Nothing typed
reaches the drawing. A stored look in the old shape (none exist on the live site, as the elf code has never merged;
confirm with a fresh fetch of `origin/main`) simply normalises to the starting look plus its skin and hair.

**Unlocking.** `WardrobeState` becomes `{ doors: number[] }`: the doors done for this detective, which is the cracked
doors of the family plus this detective's visits (`progressOf` in `src/elf/progress.ts` already takes exactly those two
lists). A costume is unlocked when its door is 0 or in `doors`. Extras are always unlocked. Gold seal and race win
no longer unlock anything in the wardrobe. In wave 1 `doors` is always empty (there are no door tables yet), so every
child has the three starters and every extra, and sees the other 48 costumes faint with a padlock, each saying which
door opens it.

**New costumes as presents.** `elf_detectives.fresh` (already a `text[]`) holds the costume ids a detective has
unlocked but not yet opened. When wave 2 records a door done, both of its costume ids are added. On the wardrobe they
show as wrapped presents; tapping one opens it, puts it on and saves, and the save removes it from `fresh`. In wave 1
nothing is fresh.

**Drawing the elf.** Pictures, not layers, in this order on the stage: the scene; then the costume picture for the
detective's skin (`costumes/<id>-<skin>`) or, with no costume, the elf picture
(`elves/elf-<sibling>-<skin>-<style>-<hair>`); then the glasses layer; then the bow tie layer, only with no costume
(the costume covers the collar); then the friend; the frame goes round the stage. Under a hood the boy or girl, hair
colour and style do not show; only the skin does.

Placing, as fractions of the stage (2 by 3): the elf picture (the whole 1024 by 1536 canvas) is drawn 53.7% of the
stage wide, 23.1% in from the left and 33% down (the mockup's 62% box at 19%, the picture 86.63% of it, 6.68% in). The
friend sits in a box 21% of the stage wide, centred 63% in, with its feet at 82% down, drawn over the elf: just in front
of her and a little over her side, on the front of the plinth top (which runs from 72% to 84% down and 14% to 86%
across in every scene). An earlier box, 27% wide at 68% in, hung off the plinth.

**The page** is mockup 6 with real data: step 1 (fold) on a card sheet with the paper circles for skin and hair;
step 2 with the five gift tags (Costumes, Scenes, Friends, Frames, Glasses and bow ties); the costumes grouped by door
on card sheets with a rosette and a chip (From the start, Door 1 to Door 24, Done, Today, Missed, a date, or Two
presents); the stage with the fairy lights glowing, the elf talking back, snow on a tap, Surprise me, Snap a photo with
up to three favourite looks pegged on a string (tap one to wear it again), and the sounds switch. Saving stays as it
is: every change saves, through `POST /api/elf/look`, which locks the row, normalises and stores.

**Favourite looks** are saved with the detective, so they follow the child to another device: up to three, newest
first, each normalised like the look.

**Pictures outside the wardrobe.** The Detective HQ picture and the emails keep using a PNG from
`src/elf/elf-png.ts`, keeping its care with memory (sharp loaded on first use, one at a time, a short queue, the most
recent kept). It now stacks the same pictures as the stage (scene, elf or costume, glasses, bow tie, friend) instead of
layers. The certificate and share card (`print.ts`) show the same picture.

**Weight.** A phone loads only what it shows: the stage (one scene, one elf or costume, any layers, one friend),
step 1's circles, and the open tab's tiles, with every other tile `loading="lazy"`. Tiles for the costumes are the
detective's skin only, small enough that the 51 come to under 600 KB (today's tile budget test). Stage pictures are
640 wide (two pixels for each one on a phone).

**The old layers go:** `assets/img/elf/{lg,sm,tile}/` (322 files each, about 20 MB), the layer list
`assets/js/elf-paint.js` and every use of them (the full list is in the code map below), along with the tests that pin
them. The painting tool's layer parts (`scripts/elf-paint/jobs.mjs`, `manifest.mjs`, `run.mjs`, `run-items.mjs`,
`sheet.mjs`, `fit.mjs`, `designs.json`, `items.json`) go with their tests; `openai.mjs` (with the £23 guard) and
`cutout.mjs` stay.

## Words that need Jaimie's yes before the switch

Staff approve all public words (main design, lines 198 to 203). New or changed: the wardrobe lede and hints, the tab
names, the locked tile notes ("Opens with door 7", "Crack today's door to open it", "Visit the place to catch up"), the
chips, Surprise me, Snap a photo, Sounds on and off, the elf's speech lines (So cosy, I love it, Ho ho ho, Look at me,
Snug as a bug, Ta da, Just my size, Jingle jingle, Hello, Say cheese, Back again), the welcome email's line about what
unlocks (`src/elf/emails.ts:58`, "More clothes unlock" becomes costumes), and every page's words as restyled. The names
of the costumes, scenes and friends were approved on the sheets.

## Goals, non-goals, anti-goals

Goals: every wave 1 page in the paper look before sign ups open (planned for Friday 13 November; the date moves if the
work slips, decision 11); a wardrobe a child finds fun to click round, fast on
a phone; costumes that always fit (one painting each, per skin); unlocks that follow the per door rule; nothing
painted on the live site; everything switched off until staff switch it on.

Non-goals: new paintings (beyond the small icons below, if a page needs one); layered clothes; restyling emails or
admin screens; wave 2's door tables, clues, places and print routes (they come later, in the same look).

Anti-goals: a wardrobe that is slow on a phone; anything that looks like clip art or a generic AI page; a costume
that covers a child's face; words that have not had Jaimie's yes; a look that breaks because of something typed.

## Constraints

Everything in the wave 1 plan's Global Constraints still holds (switched off until Friday 13 November, nothing merged
before Sunday 8 November because of the Ball, no dashes or hyphenated words in public copy, "could" for money,
"Elves' Workshop", never "Elf on the Shelf", no inner scrollbars, 390px wide works, the public repo rules, the
worktree rules). Also:

- The site never calls OpenAI. All pictures are files made in advance.
- The house rules test applies to the whole new `elf.css`; the scripts stay the site's no build step style (an IIFE,
  `"use strict"`, `var`, no arrows or template literals, the `module.exports` check). The test that names the seven
  `elf-*.js` files changes only if a file is added or removed, with the reason in the commit.
- `normaliseLook` stays the single gate for every look, on the page, on save, in the PNG and on the certificate.
- Tests rewritten where they pin the old catalogue or layers: `elf-wardrobe.test.ts`, `elf-page-wardrobe.test.ts`,
  `elf-js-wardrobe.test.ts`, `elf-png.test.ts`, `elf-hq-picture`, `elf-routes-look`, `elf-views`, `elf-print`,
  `elf-look.test.ts`, `elf-logo.test.ts` where the logo CSS moves, the BDD look step (`features/steps/elf-join.steps.js`
  saves and checks a pieces look), and the painting tool's layer tests.

## Left to the builder

- How the torn shapes are cut into files, how many sizes and colours of button, and whether a shape is a mask or a
  background.
- Exact tile and picture sizes and WebP quality within the weight rule above.
- Whether favourite looks live inside the `look` column or in a new nullable `favourites` column (additive), and the
  exact shape, as long as each is normalised.
- The markup of each restyled page, as long as the existing page tests keep their meaning (words, labels, states).
- Where the paper pictures live in `assets/img/elf/paper/` and their names.
- New paper icons, at most six at about 2p each, only where a page needs one; Jaimie sees each before it is used.
- Whether the painting scripts in `.elf-paint/deco/` are copied into the repo for the record (no secrets in them).

## Calls I made (for Jaimie to check)

- Emails keep NBCC's email look; only their words change.
- Glasses can be worn with a costume; a bow tie only with no costume.
- The HQ and email picture shows the whole look on its scene with the friend, like a photo, without the frame.
- Favourite looks are saved with the detective, not only on one device.
- On the calendar the carved prize shapes become paper cut outs of the same shapes, the mystery star stays as a paper
  star, and shut doors are bright, not faint. The public line about the carving (`src/elf/pages/door.ts:29`, "Look at
  the carving. Can you guess the prize?") gets new words for Jaimie's yes, for example "Look at the shape cut out of the
  door. Can you guess the prize?". Wave 2's admin keeps the prize shape upload.
- The advent calendar's doors run in order, 1 to 24, so today's door is easy to find on a phone and a screen reader
  reads them in order; a shop calendar scatters them. The scene on the board is one of the approved 16, chosen by eye
  behind the doors.
