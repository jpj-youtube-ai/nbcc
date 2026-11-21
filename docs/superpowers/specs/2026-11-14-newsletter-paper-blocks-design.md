# Newsletter: the paper look blocks (design)

Jaimie, 14 November 2026: "add features to the newsletter area... newer stuff that we can add into the
newsletter... make it look like the more modern approach we have with the website. So the stuff we've
been doing with Fill a Bag and the kind of creative, nice stuff. So we have more templated things we can
put in there. Don't take anything away and don't break anything."

Scoping audit: the code map, the email clients' limits and the candidate blocks were written up before
this design (the admin refresh's newsletter blocks audit). This file is what was decided and built.

## The one rule above all

Every newsletter already written, and every existing block and variant, renders byte for byte as it
did. `test/unit/newsletter-golden.test.ts` was added FIRST, on the untouched code: the fifteen original
block types at variants 0 to 3, filled, empty and at each size step, whole documents, the welcome
email, the frame, the button and the prose merge, each pinned as a SHA-256. No existing renderer,
`brandButton`, `renderFrame`, `applyMerge`, `proseHtml`, colour, font, `SIZE_LADDER`, `eventBadge` or
`SCRIPT` is changed. The variant cap stays at 3, so every new look is a NEW block type.

## What an email can and cannot do

Inline styles and tables only. No media queries (columns never stack on a phone, so every column is a
percentage), no web fonts (Caveat cannot load: the handwriting is a stack of faces already on the
reader's machine), no SVG, no `position`, `transform`, `clip-path`, gradients or shadows. So:

- Art is hosted PNG or JPG, flattened onto the colour it sits on, in `assets/img/email/`, built from
  art already in the repo by `scripts/build-email-art.mjs`. No file name is ever reused.
- Tape is two small pictures: its top half above a card, its bottom half as the first thing inside the
  card, so the card's own top border shows between them like the paper's edge through the tape. With
  pictures off, it is simply a card.
- The chunky button of the newer pages is a table cell with a thick darker bottom border
  (`stickerButton`), never `brandButton`.
- Words are always live text, never part of a picture, so everything reads with pictures off and in the
  plain-text version (which is made from the finished HTML and drops pictures and their descriptions).
- A link is only written when it is one we would send (`http`, `https`, `mailto`, `tel`: the same rule
  the checks before sending already use, now in `src/newsletter/link-safety.ts`). A picture is only
  written from an `http` or `https` address.

## Where the code is

| Part | File |
|---|---|
| The new renderers, their own colours and helpers | `src/newsletter/paper-blocks.ts` |
| The link rule | `src/newsletter/link-safety.ts` |
| Registered in (three additive lines) | `src/newsletter/blocks.ts`: `BLOCK_TYPES`, `RENDERERS`, `NO_SIZE_STEP` |
| The checks before sending | `src/newsletter/preflight.ts`, `src/newsletter/paper-preflight.ts` |
| The composer's side: labels, icons, fields, starting words | `assets/js/admin/app.js` (`NL_PAPER_DEFS`) |
| The composer's styles for it | `assets/css/admin-newsletter-blocks.css` |
| The art, and how it is made | `assets/img/email/`, `scripts/build-email-art.mjs` |

## The blocks

Every block degrades to nothing, or to its words, when a field is empty. Limits are characters and are
applied by the renderer (a longer value is cut, never rejected, so an old draft always opens).

### Stage 1: the still blocks

| Type | Name in the composer | Styles 0 / 1 / 2 / 3 | Fields |
|---|---|---|---|
| `hero` | Picture header | Picture, then words / Words on a maroon band / Night (holly band, gold eyebrow) / Art beside the words | imageUrl, alt (140), eyebrow (40), headline (80), subline (160) |
| `photoRow` | Photo row | Two photos / Three photos / Two prints / Three prints | items of url, alt (140), caption (60) |
| `note` | Handwritten note | Paper with a margin line / Taped paper / Handwriting, no card / Kraft card | text (600, prose), from (60), role (60) |
| `eventCard` | Event card | Picture on top / Picture left / Ticket / Two cards | imageUrl, alt, date, day, month, name (80), when (60), location (80), body (240), label (30), href; items of the same for Two cards |
| `logoStrip` | Partner logos | One row of four / Two rows of three / One partner with words / On a white band | heading (60), showNames, items of url, name (60), href |
| `giftTags` | Gift tags | Three / Two / Stacked / One large | items of title (30), body (90), label (24), href, colour (card, crimson, holly, tan) |
| `bagList` | What goes in a bag | With paintings / Words only / With a button / Two columns | title (40), items of name (40), price (10), pic; footnote (120), label, href |
| `trim` | Festive divider | Gold ribbon and bow / Snow / Torn paper / Star, snowflake, twinkle | none; never resized |
| `paperStory` | Story, paper look | Taped print above the words / Print left, words right / Paper card with the print inside / No photo, handwritten kicker | imageUrl, alt, kicker (40), title (80), body (600, prose), label (30), href |

Notes on the calls made:

- **Photo row** keeps its photos side by side on a phone (there is no way to stack them). Prints are a
  white frame with tape and a handwritten caption. No tilt.
- **Event card**'s badge takes its day and month from the date when they are left blank, so one date
  field is enough; the two words can still be typed for a run of nights ("1 to 24", "DEC").
- **Partner logos** prints the partners' names in a small line under the logos (on by default), because
  the plain-text version and a reader with pictures off see no logo. The names carry the links; a logo
  is only itself a link when the names are switched off.
- **What goes in a bag** only draws a painting whose key is one of the Red Bag paintings we hold.
- **Festive divider** has no words, so nothing in the plain text.

### Stage 2: the two live blocks (built in TASK-646, `src/newsletter/live-blocks.ts`)

**`countdown`, Sleeps to go.** Fields: date, label (60), unit (sleeps or days), afterText (80). Styles:
big number on a tan card / crimson band / one sentence / holly band with a gold number. Counted in UK
days from `ctx.today` (the send worker passes the UK date of the moment it is sending; left out, it is
today in the UK). It ALWAYS prints the real date beside the count ("40 sleeps until Christmas Eve
(Thursday 24 December)"), because emails are opened days late. On or after the day it shows the after
words, or nothing. A date that is not a date renders nothing and the checks block it.

**`liveTotal`, Live total.** Fields: source, typed, before (60), after (60), fallbackText (120),
hideBelow (default 1), target, label, href. Sources: Fill a Red Bag (bags filled: one for every £50
since 1 November 2026, exactly as the Workshop's sign counts them), the Santa Sleigh (pounds raised:
online, card machine and bucket cash, as /sleigh shows), and "a number I type". There is no appeal
total: it has never been defined. Styles: big number over words / Workshop sign / progress to a target /
one sentence.

- The renderer stays pure. `RenderCtx` gains an optional `live` map and `today`. The block shows the
  number frozen into it (`data.sent.value`), else `ctx.live[source]`, else the fallback.
- **Never "0 bags" or "£0".** Below `hideBelow`, or with no number, it shows the fallback words, or
  nothing.
- **Frozen once per send.** A send is not one moment: the worker renders per recipient, tick after
  tick, sometimes over days. On the job's first tick (before it is marked running) the worker reads
  each source the newsletter uses with the UNCACHED reader inside try/catch, and writes
  `data.sent = { value, at }` into each live total block of that newsletter through
  `freezeNewsletterLiveTotals` (src/db/newsletters.ts), the one new write: it sets that one field, only
  on a block that is a live total, only on a newsletter being sent whose own send job has not started,
  and only if the stored document is still the one it read. A
  failed read freezes "no number", so every reader of that send gets the fallback words; a failed
  write is logged and the send carries on, with the fallback words. So everyone gets the same number,
  and re-opening the sent newsletter shows what went out.
- **A frozen number never leaks into a new draft.** Saving a draft or a template strips `data.sent`
  (`withoutFrozenTotals`), and the first tick of a send always writes it afresh.
- **Preview and test send** show today's number (the cached readers: one read a minute at most, never
  a throw). The preview's answer also carries `live`, which the composer uses to say, in the block's
  form, "Right now: 312 bags filled. It is read again when the newsletter is sent."

### Stage 3: starting points (built in TASK-646, `NL_STARTERS` in `assets/js/admin/app.js`)

Four built-in starters in code beside "Start from example" (which, with `NL_TEMPLATE`, is untouched):
Christmas appeal, Fill a Red Bag, Santa Sleigh, and Thank you for this year. (The fourth was first planned
for a game that is now cancelled, so Jaimie chose a general thank-you instead, 21 November 2026.)
As built: the start screen lists the four, each with one line, before the example; beside "Start from
example" a list of the four and "Start from this starter" (asks first when it would replace unsaved work). Anything Jaimie must fill in or check is in [square brackets].

## The checks before sending

For the new types only: a picture with no description (warn); a picture header with no headline
(warn); a photo row with fewer than two photos (warn); an empty note (warn); an event card with no
working link (block), a date that has passed (warn); a partner logo with no name (block), names
switched off (warn); a gift tag with no working link (block); a bag list button with no working link
(block), or words that say what a gift "will buy" (warn: it must say "could"); a paper story link that
is not a link (block); a countdown with no date or a bad one (block), on or after its day (warn); a
live total that is hidden right now (warn). TASK-646 added a countdown whose day comes before the
time a "Send later" is set for (warn): the composer now tells the checks that time (`sendAt`).

For every newsletter, as warnings only: the finished email passing 80 KB ("Gmail may cut this email
short": Gmail clips near 102 KB and link tracking lengthens every link), and any words left in
[square brackets] ("This still has a note to yourself in square brackets").

## The composer

The palette is two labelled groups, "The classic blocks" and "The paper look (new)", so fourteen
buttons do not become twenty-five in one heap. Each new block arrives filled with real, sendable NBCC
wording and, where it needs a picture, one of the email pictures, so a new block never shows a broken
image. New kinds of field: a choice from a list, a tick box, a date, a number. Each has a label, is at
least 44px tall and 16px, and says what it does in a line beneath where that helps.

## Left out, and why

- **Cropping photos square on upload** (photo rows look best with photos of one shape): the upload is
  shared by every block; the form says so in a hint instead.
- **"Copy from What's on" and "Copy from the Red Bag list"**: niceties, both need new read routes.
- **(Since built, TASK-646.)** A countdown warning for "before the time this is scheduled to send": the checks were not told the
  schedule; the real date is always printed, which is the safeguard that matters.
- **An appeal total**: not defined; "a number I type" covers it until it is.
- **Outlook desktop's rounded corners and stacked columns**: tolerated, as the existing blocks are.
