# Head Elf HQ: the Elf Detective School's own admin section

Design, 5 November 2026. Asked for by Jaimie on Jaimie's live preview click through. Jaimie skipped the
design questions: *"just go ahead with it and skip questions it will be for head elves to go in and just
tweak things that you think might need intervention."* Only the lines quoted from Jaimie are theirs;
everything else here is my call and is marked so where it matters.

## Intent

The Elf Detective School runs itself: families enrol and pay, the calendar counts down, doors open on
time, and in December the clues, guesses, finds and stamps follow the rules in
`docs/superpowers/specs/2026-10-04-elf-detective-school-design.md` and
`docs/superpowers/specs/2026-11-03-elf-detective-secret-places-design.md`. Head elves (Jodie, the Head
Elf, and the staff Jaimie gives it to) need one place to see that it is going right and to step in
where a person has to: a child's name to check before it shows in public, a typo, a family who cannot
sign in, a test or refunded sign up to take out, the money it is making, the switch, the prices.

Jaimie's words for how it should feel: its own section, *"just what the festive ball did"*, *"really
nice looking"*, *"really easy to navigate, like almost like a video game would do its UI"*, *"not just
lists and lists and lists of things to fill in numbers"*. And for the money: *"it'd be cool to see it
come through"* the Donations panel *"so we can also filter by"* the elf school *"and we can see how much
it's making"*.

## Goals

- A section of its own: Admin > Content > Elf Detective School, under the Festive Ball. The elf card in
  Get involved > Settings goes (Jaimie: *"don't put it in the get involved section"*).
- A game's menu screen, not a form: big tiles to move between parts, a quest log of what needs a
  person, families as character cards with their own elves, the season as a level select.
- Everything a head elf needs to step in, as each part of the game ships (the phases below).
- Elf money in Admin > Donations, newest first among the gifts, with an Elf Detective School filter and
  a line in the panel's money summary.
- Works on a phone (390 pixels wide) and a laptop, with a keyboard, with motion turned off.

## Non goals

- Running the game by hand. Nothing here replaces the automatic doors, emails or marking.
- A second sign in. The section lives inside the admin and uses its sign in, roles and Team matrix.
- Turning families into donors. Elf payments are shown in Donations, never copied into `donations`.

## Anti goals (it fails if)

- A head elf has to read a table of numbers to find what needs them.
- A child's details reach anyone the Team matrix has not given the section to.
- An entry fee is ever claimed for Gift Aid.
- It looks like a different website from the elf school, or like a generic dashboard template.

## Decisions (all mine unless quoted)

1. **Where.** `admin.html` gets a Content menu entry, *Elf Detective School*, `data-view="elf"`, after
   Festive Ball, and a `view-elf` section. The Get involved > Settings card (`#elfAdmin`) is removed.
2. **Who.** A new permission section `elf` in `src/admin/permissions.ts`. Admins edit it by role.
   Editors and viewers get none, like `email-audit` and `business-supporters`, because it holds
   children's first names and families' emails; anyone else is given view or edit per person from the
   Team matrix (that is how Jodie gets in). Switching the school on or off stays admins only in the
   route, whatever the matrix says, as the Events and Fundraising switches do, and so do the prices and
   the preview link, as today. `/api/admin/elf/*` move from the `fundraising` section to `elf`. Like
   every new section it ships with a migration that writes `elf` into every saved access matrix (admins
   edit, everyone else none), or anyone whose access was ever edited, the admins included, would be
   locked out (the pattern of `migrations/1788100000000_permissions-business-supporters.js`).
3. **The menu.** Tiles for HQ, Families, Doors, Finds, Prizes, Money and Settings. A tile shows only once
   its part is built (phase 1 shows HQ, Families, Money and Settings). A tile can carry a count, as
   Families carries the names waiting for a tick. The open part is remembered for the browser tab, the
   way the admin remembers its open section (it keeps that in the session, not in the address).
4. **HQ.** The school's switch as a big lever (a bauble for a knob) that asks a second time either way;
   two rosettes, the days to the first clue and the detectives enrolled (sign ups open when the switch
   is pulled, so there is no date to count down to); *Needs you*, a quest log of things waiting for a
   person, each with one button that goes straight there, and *Nothing needs you* when it is empty;
   *Raised so far*, entries and gifts as one bar, with the Gift Aid part and what claiming it could add;
   the newest recruits as character cards.
   Phase 1's quests: first names waiting for a tick; the private preview link still open; payments
   started over an hour ago and never finished (shown, nothing to do).
5. **Families.** Search by grown up, email, detective's name or badge number; filters for *Names to
   check*, *This week* and *Removed*. A family's sheet shows the grown up, their email, when they enrolled,
   the newsletter box, each detective as a card (their elf, badge, the name switch: *Show Ruby in
   public? Until then it is R.*; their rank and doors done join the card with wave 2, when there are
   doors to count), their payments, and the actions: send a sign in
   code, change the grown up's name or email, change a detective's names, remove the family (or put a
   removed one back). A detective's picture is the tile of the costume their look wears in their skin
   (`assets/img/elf/paper/tiles/costumes/<costume>-<skin>.webp`), so the cards need no picture making.
6. **Removing a family** is a mark, not a delete: `elf_families.removed_at` and `removed_by` (an additive
   migration). A removed family cannot sign in (their sessions end), is left out of the counts, the money
   and the calendar, and keeps its badge numbers unused. *Put back* clears the mark. The sheet says to
   refund in Stripe first when they paid. Every change a head elf makes goes in the admin audit log.
7. **Names.** Changing a detective's first name or festive surname uses the same rules as enrolling
   (`src/elf/join.ts`); changing a name sets its tick off again, so a new name is checked too. Changing
   the grown up's email keeps emails unique and ends the family's sessions.
8. **Money in Donations.** `listDonations` returns elf payments (paid `elf_orders`) beside the gifts, one
   row per payment: the grown up, entry plus gift, paid date, *Elf Detective School* as its source, its
   reference, and Gift Aid shown only for the gift part. A *Elf Detective School only* filter joins the
   three source filters; the other filters apply as far as they mean anything (an elf payment is paid,
   one off, and never in a claim). `loadDonationSources` gets an Elf Detective School line. An elf row
   links to the family's sheet in Head Elf HQ, not to a donor. The list is ordered newest first by when
   each was given or paid, not by record number, so the two kinds interleave; the only rows that move
   are the five gifts TASK-430 recorded with their past dates, which now sit at those dates.
9. **Settings.** The pay what you can amounts as two steppers (the least and the suggestion, within the
   limits the database already checks), and the private preview link, as the Get involved card had them.
10. **The enrol limit** rises from 10 an hour to 10 every 10 minutes for each address, as the event
    ticket checkout allows, because parents on one mobile network can share an address (to do before
    Friday 13 November in the open list).
11. **The look** (the "sticker game menu"): NBCC's own colours (maroon `#800000`, crimson, holly, gold,
    cream) and fonts (Playfair Display and Poppins, with the elf school's Caveat for short notes); chunky
    panels and buttons with a deep maroon ink edge (`#3A0B0B`, never black) and a hard offset shadow that
    presses in when clicked; the paper grain; the elf school's own pictures as the game art (its paper
    icons, the costume tiles, a bauble, rosettes). Its own stylesheet, `assets/css/admin-elf-hq.css`, every
    selector starting `.hq-`, and its own script, `assets/js/admin/elf-hq.js`. Motion only when the visitor
    is happy with it. No inner scrollbars. Status words use `is-ok` and `is-error`, never `.err`. The
    approved mockup is the guide (kept in the build's workspace, pictures sent to Jaimie on 5 November).

## Phases

1. **By Friday 13 November** (sign ups open): the section, the permission, HQ, Families, Money (with
   Donations) and Settings; the Get involved card gone; the enrol limit.
2. **Before Tuesday 1 December**, with wave 2's game: *Doors*, the 24 doors as a level select (each door's
   hiding place, its elf, three clues, the word on its tag, its clue time, posters and tags to print, and
   what each door still needs), and HQ's quests for doors not ready.
3. **In December**: *Finds* (each day's finder, every guess, the photos from visits to check, putting a
   wrong mark right) and *Prizes* (every detective who has done all 24 doors, their naughty elf drawings
   and photos, choosing the winner for Jodie to phone on Christmas Eve).

Phases 2 and 3 get their own designs when wave 2 is planned; this document fixes only the menu and the
look they slot into.

## Constraints

- The repository is public: invented names only in tests and pictures, 01632 960 123 for any phone
  number, no folder on this computer named in committed files.
- Expand and contract migrations only, sorting after the newest migration on main.
- Tests first; jsdom tests for the admin script, BDD for the routes (CI runs BDD and migrations).
- README.md is updated in the same change.

## Left to the builder

The exact wording of the help lines (plain, no dashes or hyphenated words), how the menu wraps on a
phone, the order of the quests, and which costume tile stands in for a detective with no look yet.
