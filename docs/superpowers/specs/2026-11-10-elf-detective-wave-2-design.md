# Elf Detective School, wave 2: the doors in December

Written on 10 November 2026 from the wave 2 brainstorm with Jaimie (9 and 10 November 2026). For
Jaimie's approval before anything is built.

This builds on four earlier designs. Where they differ, this one wins:

- `docs/superpowers/specs/2026-10-04-elf-detective-school-design.md` ("October")
- `docs/superpowers/specs/2026-11-03-elf-detective-secret-places-design.md` ("secret places")
- `docs/superpowers/specs/2026-11-04-elf-paper-design.md` ("the paper look")
- `docs/superpowers/specs/2026-11-05-elf-admin-design.md` ("Head Elf HQ")

The three screens Jaimie agreed are kept for the builder in `.superpowers/sdd/2026-11-10-elf-wave-2/mockups/`
(not in git): `doors-admin.html`, `door-scrapbook-v2.html` and `photo-check.html`, with their
pictures. Paintings and hatched boxes stand in for photos, and every person, place, number and clue
in them is pretend.

## Why

Elf Detective School opens for sign ups on Friday 13 November 2026 (wave 1: sign up, paying,
Detective HQ, the wardrobe and the calendar counting down, already live and switched off). Wave 2 is
the game itself. The first clue comes out on Tuesday 1 December at 5:30pm.

Each of the 24 doors is a real hiding place in NBCC's area. An elf sits there from its door's first
clue, three clues come out across the evening, and families race to find it. The first to type the
word on the elf's tag wins that door's prize, and every family who visits afterwards can add a
picture behind the door. By Christmas the calendar is a scrapbook of everyone who took part.

NBCC's staff, the head elves, have to set all of this up and run December from Head Elf HQ without
a developer.

Success looks like this: every door opens on its day with its clues, its place and its prize; head
elves type in the places, paste in the clues, print and drop off without help; the doors fill up
with families' pictures through December; and none of the anti-goals below ever happens.

## Decisions

### Jaimie's, in the order they were made

1. **The elf stays at its place all December** (9 November; replaces October decision 6's hand
   over). It sits beside its QR poster from its door's first clue to the end of December. The finder
   does not take the elf: the finder gets the prize, which is the shape cut out of the front of the
   door.
2. **Pictures behind every door** (9 and 10 November). Every family who finds a door's elf, the
   finder and everyone after, can put pictures behind that door: a photo of themselves, or their
   elves. The two choices look the same, so neither is pushed, and a family can skip. Tapping an
   open door opens it up across the calendar into a scrapbook: the finder first with a "Found
   first!" rosette, then everyone else in the order they visited. Each detective's elf gets a
   polaroid of its own, standing properly on its plinth; several elves are never squeezed into one
   picture. A photo has no name with it; an elf carries its detective name. Where and when a photo
   was taken is taken out of it. A photo shows only after a head elf approves it, and the site keeps
   who approved it and when. Elves go up straight away, and a family's elves show until their photo
   is approved. Every photo comes down at the end of January. (Mockup: `door-scrapbook-v2.html`.)
   Decision 11 changes how the photos and the elves sit together.
3. **A visit is proved by typing the word on the elf's tag** (10 November; replaces October decision
   7's location check and photo proof). The site never asks for a location. A family who arrives
   after the find types the same word the finder typed. Accepted, and told to Jaimie: a word posted
   online gives that door's stamp from home; stamps only unlock costumes and ranks, and the grand
   prize is judged.
4. **How a hiding place gets ready** (10 November). Someone from NBCC asks a place, usually one of
   NBCC's drop off points, to host an elf. They agree its day, and NBCC provides the prize and tells
   the office what it is. A head elf types the place and the prize into Head Elf HQ. NBCC takes the
   elf and the poster to the place, explains how it works, and checks the place is open at the times
   it needs to be. At the end NBCC thanks the place for helping. The drop off points live on the
   separate drop.nbcc.scot site, not in this website's database, so each place is typed in by hand.
5. **Door pictures come from Claude** (10 November; replaces October decision 12's upload). Once
   every prize is known, Jaimie sends Claude the prize list and Claude makes the 24 door pictures,
   which are committed with the rest of the elf art. Staff never upload shapes.
6. **Clues come from Claude** (10 November; replaces secret places decision 3's "staff write
   them"). Claude drafts all three clues for every door from Jaimie's list of places, in a private
   file that never goes in the repo (the repo is public and the clues give the places away), and head
   elves paste them in.
7. **The Doors page** (10 November, agreed with no changes). Head Elf HQ gets a Doors part: the 24
   doors as a level select, with the chosen door's sheet beside it. (Mockup: `doors-admin.html`;
   details under "Head Elf HQ: Doors".)
8. **Photo alerts by text and email** (10 November). When a family sends a photo, head elves get a
   text and an email. A head elf approves it, and the log keeps who approved it and when.
9. **The photo check as played back** (10 November: "that all sounds right"). Everything under
   "Head Elf HQ: the photo check" and "Alerts" below, including the parts that began as Claude's
   guesses. (Mockup: `photo-check.html`.)
10. **On a door's evening, head elves see who found it and when** (10 November).
11. **Photos in their own row** (10 November, after the builder check; replaces decision 2's choice
    of a photo or the elves). Every visiting detective's elf goes on the door with its name, the
    finder first. Photos go in a separate row with no names, in the order they were approved, so
    nobody can match a face to a name. A family can add a photo as well as their elves. The mockup
    `door-scrapbook-v2.html` still shows the earlier choice, with photos mixed in among the elves:
    build to these words instead.

### Claude's calls (for Jaimie to check while reading)

- **C1. One paste box for all the clues** (told to Jaimie on 10 November). It takes every door's
  clues at once and shows each door's clues beside its place for a check before anything is saved.
- **C2. Texts go through Amazon's own text service**, because Amazon already runs the website: no
  new company, no key for anyone to type in, a few pence a text. (Told, and Jaimie agreed.)
- **C3. A second switch, "December's doors"**, off until an admin turns it on. Wave 2 can then go
  live in parts without families seeing anything half finished, and the doors only start once the
  places and clues are in.
- **C4. A practice door**, so head elves can rehearse a whole evening before 1 December (see
  "The practice door").
- **C5. October's planning map is left out.** It needs every place's position typed in, and the
  places are drop off points NBCC already knows. It can come back later if wanted.
- **C6. One prize per family a year** (October's "one elf per family", now that elves stay put). If
  a family who has already won types a door's word first, it counts as their visit and the race
  goes on for everyone else.
- **C7. The alert when an elf is found** (October decision 18) is an email only, to the same people
  as the photo alerts. Texts are for photos, as Jaimie said.
- **C8. Declined and taken down photos are deleted at once.** The log keeps the line, never the
  picture.
- **C9. Prizes get their own short design in early December**: the Graduates' entries and the
  judge's pick on Christmas Eve. Nobody can graduate before door 24 opens on 24 December, so it is
  not needed for 1 December.
- **C10. Two drops.** The Doors page live by Friday 20 November so head elves can start typing
  places in; everything else live, with December's doors still off, by Friday 27 November; a
  practice evening that weekend; December's doors switched on by Monday 30 November.
- **C11. A snow day when a door cannot run.** If a door still has no place, no word or no first
  clue when its first clue is due, or a head elf calls it off from Doors before then, the door does
  not run: it says its elf got snowed in, and every detective gets that door done, so nobody misses
  out on graduating. December's doors can only be switched on once door 1 is ready, and Head Elf
  HQ warns about any door in the next three days that is not. A head elf can still change a door's
  place at short notice and print a new poster.
- **C12. Photos never go into the backups.** The nightly backups keep everything for seven years,
  and copies go to Google Drive, so the photos are left out of them (out of the database copy and
  the spreadsheet copies alike). Deleting a photo then really deletes it. A restore from a backup
  comes back without photos, which is fine because they only stay up until January.
- **C13. At most one alert every half hour.** On a busy evening a quick head elf could clear the
  photos after every one, so each new photo would start a new alert. After an alert goes, the next
  one waits at least 30 minutes.
- **C14. The morning email's social posts are words and a door picture.** Two a day: tonight's door
  (its number, the first clue's time and how to join) and yesterday's find (who found it, when, and
  the place, now that it is shown, inviting visits), each with its door's picture. No new pictures
  are drawn for them.

## Goals

1. Head elves can set up all 24 doors, see what each still needs, and print what goes to each place.
2. Everything that runs each day in December works by itself: the clues, the daily clue email, the
   typed guesses, the claim, the stamps, the place being shown, the reminder to the place, and the
   other emails listed under "Emails in wave 2".
3. Families who visit after the find get their stamp and their elves on the door, and can add a
   photo.
4. A head elf checks every photo before anyone else sees it, and the log shows who did what and when.
5. Head elves hear about waiting photos by text and email without being flooded.
6. Head elves can see who found each door's elf and when.

## Non-goals

- Any location check, map pin or distance rule (decision 3).
- Staff writing clues from scratch, or uploading door shapes (decisions 5 and 6). A head elf can
  still change any clue that is not out yet.
- Replying to a text, approving anything from a text or an email, or a photo inside an alert.
- Prizes and the Christmas Eve judging (C9); refunds and Gift Aid (separate pieces, fitted around
  the doors); the planning map (C5).
- Deleting children's details at the end of January (October decision 11). That is built in
  January as its own piece, which also has to settle what the seven years of backups keep. This
  design deletes the photos.

## Anti-goals: wave 2 has failed if

- a place, a clue or a clue picture can be found out before its time, through a page, a photo, an
  email, a cache, a print or the code;
- a child's name ever sits next to a face;
- head elves' phones buzz all evening;
- running December needs a developer;
- a real place, a clue or the prize list ends up in the public repo, a test, a commit message or a
  pull request.

## How it works

### Before December: getting a door ready

1. A place agrees. A head elf opens its door in Doors and types in the place, then the prize.
2. Once every prize is in, a head elf presses **Copy the prize list** and sends it to Claude, who
   makes the door pictures. They arrive in a website update; until then a door shows October's
   mystery star.
3. Jaimie sends Claude the list of places. Claude sends back a private file with three clues for
   every door, and a head elf pastes it into **Paste all the clues** (C1).
4. A head elf names each door's elf and gives its tag a word (the site suggests one, like
   SNOWBALL 472), then prints the poster, the staff card and the tag.
5. NBCC drops off the elf, the poster, the prize and the staff card, and ticks **Dropped off**.
6. A door is **Ready** once its place, prize, door picture, elf and tag, three clues and drop off
   are all done. Doors shows how many things each door still has to do, and Head Elf HQ's front
   page lists the doors that are not ready, the soonest first.

### On a door's day

- **9am:** the place gets its reminder email. Tonight, at the first clue's time, put the elf and the
  poster out together.
- **From the first clue** (5:30pm, 6pm and 6:30pm on school days and 10am, 10:30am and 11am at
  weekends and in the holidays, unless a head elf changed them): the clues come out in Detective HQ
  and clue 1 in the daily email, and families type their guesses, all as the secret places design
  says.
- **At the place:** the elf sits beside its poster with its tag. Scanning the poster opens the door's
  page; someone who has not signed up gets the Join page (October decision 7).
- **The find:** the first signed in family to type the tag's word, choosing which detectives are
  there, wins (October's claim rules, with C6). They get the gold "You're first!" screen, show it to
  the staff, and are given the prize. Their detectives get the door's stamp.
- **Between the find and the place being shown** (7pm or 11:30am by default): the calendar says
  "Found by Detective R. at 5:47pm!" and shows no place (secret places decision 11). The door
  cannot be opened up yet.
- **Head elves** see in Finds who found it and when, and get the find alert by email (C7).

### When a door cannot run (C11)

- At its first clue's time, a door with no place, no word or no first clue becomes a snow day by
  itself. A head elf can also call one from Doors at any time before the first clue.
- A snow day door shows that its elf got snowed in. No clue, guess, word or picture belongs to it,
  and every detective gets it done, towards ranks, presents and graduating.
- If a place stops hosting its elf after its day, a head elf ticks **Gone home** on its door. The
  scrapbook stays, the door says its elf has gone home so nobody makes a wasted trip, and its word
  stops giving stamps.

### After the find, all December

- Any signed in family who types the right word gets a stamp for each detective they choose: one
  stamp per detective per door. Wrong words follow October's rules: the same answer at every place,
  and six wrong tries per family per place.
- A word typed after the find but before the place is shown is saved, and counts as that family's
  visit from the moment the place is shown (secret places: candy cane visits count from then). The
  page tells them so.
- **Their elves go on the door** straight away (decision 11): each chosen detective's elf, one
  polaroid each, with its detective name, in the elf's look at that moment.
- Then the page offers **Add a photo to door 7**, or **Not this time**.
- **A photo:** the grown up takes or picks one, ticks "Yes, show this photo on door 7" (unticked to
  start), and presses **Send it to the head elves**. The site makes the picture again, so nothing
  from the camera survives: not where, not when, not the phone. The photo waits for a head elf.
- A family can take their photo down at any time from the door's page. Their elves stay either way.
- A declined photo never shows. The door's page tells the family kindly, and they can send another.
  No email about it.
- One photo per family per door at a time: a new photo replaces one that is still waiting.
- **The scrapbook** has two parts. First the elves, each with its name: the finder's first with the
  "Found first!" rosette, then everyone else's in the order they visited. Then the photos, with no
  names, in the order they were approved. An open door on the calendar shows the first few pictures
  behind it and how many there are.

### Head Elf HQ: the photo check (in Finds)

Match `photo-check.html`.

- **Photos to check**, oldest first, with a count on the Finds tile. The photo being checked shows
  big, with its door, its place, when it was sent, and the family (head elves only).
- A short checklist beside it: only the family in it; no school uniform or badge; nothing that shows
  where anyone lives, like a house number or a car number plate; nothing unkind.
- **Approve**, or **Decline** with a short reason only head elves see. Both put the head elf's name
  and the time in the log.
- A photo sent before its door's place is shown waits until then, even once approved, so it can
  never give the place away.
- Whoever gets to a photo first decides. Anyone else who opens it sees "Approved by Jodie at
  6:13pm" in place of the buttons.
- **The photo log**, newest first: every photo's steps, each with who and when: sent; approved or
  declined, with the reason; taken down by the family or by a head elf. Photos that are up have
  **Take it down**.
- On **Sunday 31 January 2027** every photo is deleted. The log keeps its lines without the
  pictures. Photos are never in the backups (C12), so deleted means gone.

### Alerts

- **Head Elf HQ > Settings > Alerts** lists every head elf (everyone with the elf permission): their
  email, a mobile number if they have given one, and alerts on or off. With no mobile number, a head
  elf gets the emails only. **Send me a test alert** sends one of each to whoever presses it.
- One text and one email go to everyone with alerts on when photos start waiting. No more go until
  every waiting photo has been checked, and never sooner than 30 minutes after the last one (C13).
  Nothing goes between 9pm and 8am; at 8am, one alert goes if any photos are waiting.
- The text, from NBCC: "Elf Detective School: a photo is waiting for a head elf to check.
  nbcc.scot/admin". The email: "A photo is waiting to be checked", the door's number, and a button
  to Head Elf HQ. Neither shows the photo or the family's name.
- Following a link never changes anything: approving is a button on the page (October's standing
  rule).
- If a text fails, the email still goes, and Head Elf HQ says the text did not go.

### Head Elf HQ: Finds on the evening

- Each door from today backwards: who found its elf (the detective's full name and their grown up)
  and when, or "Not found yet" with which clues are out.
- Once its place is shown: how many families have visited, and how many cracked it with a guess
  (counts only, because guesses are private, as the secret places design says).
- From a door in Finds, a head elf can add another name that counts, until midnight at the end of
  its day (the secret places design's "names added late").

### Head Elf HQ: Doors

Match `doors-admin.html`.

- **The level select:** 24 tiles, each with its number, its weekday, its place or "No place yet",
  and Ready or "N to do"; chips for places agreed, prizes chosen and doors ready; **Print the list
  of places** (every place and its day, for staff only) and **Copy the prize list** (each door's
  number and prize, for Claude).
- **The door's sheet**, beside the level select (below it on a phone), with its ready list at the
  top:
  - **The place:** its name; its town; other names that also count; its address; who to talk to;
    their phone; their email (the reminder goes there); the time it closes on its day, warning when
    that is less than an hour after clue 3; where the elf sits; who agreed it.
  - **Its evening:** the three clue times and the time the place is shown (the secret places
    defaults, each changeable), and the reminder's time (9am).
  - **The prize:** in words; the Show it off tick (October decision 19); the door picture (made by
    Claude); the reminder that a prize must not point at the place giving it.
  - **The elf and its tag:** the elf's name; the tag's word; **Make a new word**, with a warning
    once the tag has been printed.
  - **The three clues:** each with words (up to about 500 characters), a picture, or both, and words
    describing any picture.
  - **Print and drop off:** the poster, the staff card and the tag; **Dropped off** and **Thank you
    sent**, each keeping who ticked it and when. The thank you itself is sent by hand.
- **Paste all the clues** (C1): takes the whole file Claude sends, shows each door's three clues
  beside its place, marks any problem (a missing clue, one that is too long, a door that does not
  exist), and saves only when the head elf says yes. It never changes a clue that is already out.

### Words on paper

- **Staff card:** put the elf and the poster out together at the first clue's time, and keep both
  out of sight until then; when a family shows the gold "You're first!" screen, give them the prize;
  the elf and the poster stay out for the rest of December; later visitors only need to type the
  word on the tag. It no longer says to hand over the elf.
- **Poster:** asks people to visit all month, type the word on the elf's tag for a stamp, and add
  their picture. It no longer says it stays up all month so nobody can tell from the window.
- **Tag:** the first detective to type this word wins this door's prize, and everyone after gets a
  stamp. It no longer says "The first detective to type it wins me."
- The share card and the certificate do not change.
- Jaimie approves every word, on screen, on paper and in emails, before December's doors are
  switched on.

### Emails in wave 2

From October and the secret places design unless said otherwise:

- the daily clue email to families at clue 1 (secret places decision 6);
- the place's reminder at 9am on its day (October decision 6, secret places decision 10);
- the morning Elf HQ email to everyone with alerts on, at 8am (October decision 18): today's door
  and whether it is ready, yesterday's finder, any photos waiting, and the day's two social posts
  ready to copy (C14), which never name a place before it is shown;
- the find alert (October decision 18, C7);
- the photo alert (decision 8);
- the proud moments (October decision 16): a thank you with a gentle ask when a family wins a prize,
  when a detective is promoted, and when one graduates.

Every one is listed in Admin > All emails with invented examples, like every other email.

### The December's doors switch (C3)

A switch in Head Elf HQ > Settings, for admins only, beside the school's own switch. While it is
off, nothing in this design reaches a family: every door stays shut with its countdown, and no
clue, guess, word, stamp, picture or email goes anywhere. Head elves can still use Doors, Finds and
the practice door.

### The practice door (C4)

From Settings, a head elf starts a practice evening for today at a pretend place they type in (the
office, say), with its clues a few minutes apart. Using the preview link, they play it as a family:
the clues, a guess, the word, "You're first!", a visit, a photo, the photo check and the alerts.
Nothing from it is seen by families, counts towards any detective's progress, or lasts: a head elf
can clear it at any time, and it clears itself when December's doors are switched on.

## Constraints

- **The repository is public.** No real place, clue, prize list, person or phone number in code,
  tests, fixtures, docs, commit messages or pull requests. Invented names only, 01632 960 123 for a
  phone number, and example.org or example.com for email. The clues file and the list of places stay
  outside the repo.
- **Ships switched off** (C3); only an admin switches anything on.
- **The look:** Head Elf HQ's look (the Head Elf HQ design, decision 11) on every admin screen; the
  paper look on every family screen; no inner scrollbars; every screen works at 390 pixels wide and
  at 360.
- **Children's safety** (October decision 11): detective names only; a first name in full only once
  staff have ticked it; never a name with a photo.
- **Words:** plain English, no dashes in public words, "Elf Detective School" always in full, and
  "could" for money.
- **Database changes** only add things (expand and contract), and each new migration sorts after the
  newest one on main.
- **Tests first:** jsdom tests for admin scripts, BDD for routes. CI runs the BDD and the migrations,
  because there is no local database.
- **Config** goes through the schema, `.env.example`, SSM and the task definition (CLAUDE.md golden
  rule 3). Texts need no secret: the app's own Amazon role sends them.
- **README** is updated with each change.
- **Painting budget:** Jaimie agreed £23 for paintings. Any door picture cost past that needs Jaimie's
  yes first.
- **Email allowance:** emails share the daily Amazon allowance with receipts and sign in codes;
  check it before December (October).
- Times are Europe/London.

## Dependencies and dates

- **From Jaimie:** the 24 places with their towns, and each door's prize. Claude then drafts 72 clues
  and makes 24 door pictures.
- **In NBCC's Amazon account**, by Jaimie in the console, because the command line on this computer
  is a different account: lift the starter allowance for texts (Amazon's text "sandbox"), set a
  monthly spend limit, and register NBCC as the sender name if Amazon asks. Ask by Friday 20 November,
  because Amazon can take a day or two.
- **Drops** (C10): Doors by Friday 20 November; everything else by Friday 27 November; a practice
  evening that weekend; December's doors on by Monday 30 November; the first clue on Tuesday
  1 December at 5:30pm.

## For the builder

### What is there now

- **Pure rules** from Stage A in `src/elf/`: `calendar.ts` (one clue time a door), `doors.ts` (shut,
  hunting, found, revealed), `guess.ts` (a pick from a list; becomes typed, as the secret places design
  says), `claim.ts` (the word and six wrong tries), `stamps.ts` (location or photo; becomes the word),
  `progress.ts`, `print.ts` (the words above), `emails.ts`. `distance.ts` and `map.ts` are no longer
  needed once location and the planning map are out.
- **Tables:** `elf_settings`, `elf_families`, `elf_detectives`, `elf_orders`, and the sign in codes
  and sessions (migration `1791200000310_elf-school.js` and after). There is nothing yet for doors,
  places, clues, guesses, claims, stamps, pictures or alerts.
- **Head Elf HQ:** `src/routes/admin-elf.ts`, `assets/js/admin/elf-hq.js`,
  `assets/css/admin-elf-hq.css`, and the elf permission in `src/admin/permissions.ts`.
- **Pictures:** `src/fundraising/picture-process.ts` already makes every uploaded picture again with
  sharp: turned upright, made smaller, nothing from the camera kept, size limits, one at a time.
  Use it for photos and clue pictures. Fundraiser pictures are stored in the database
  (`src/db/fundraiser-pictures.ts`), and the nightly backups copy the whole database
  (`infra/modules/app/backups.tf`, `src/scripts/run-backup.ts`), so photos need leaving out of
  them (C12).
- **Emails:** `src/email/catalogue.ts` has an "elf" group; every new email goes in it.
- **Timed work:** there is an in-app worker that ticks (`src/newsletter/send-worker.ts`, started
  from `src/app.ts`, safe across tasks with `FOR UPDATE SKIP LOCKED`) and a daily scheduled one-off
  task (`infra/modules/app/scheduler.tf`). The clue email, the 9am reminders, the 8am email and the
  photo alerts need timing to the minute, so Claude's call is an elf worker in the app on the
  newsletter worker's pattern, with every send claimed in the database so it goes only once.
- **Texts:** Amazon End User Messaging SMS (or SNS) sent with the app task's own role: a permission
  in `infra/modules/app/ecs.tf`, a config value to turn texts on and name the sender, and a pretend
  sender in tests and on this computer. Check Amazon's current rules for UK texts (sender names, the
  sandbox) before building.

### Left to the builder

- Table and column shapes, and whether "found, place still hidden" is its own door state (the
  secret places design leaves this to the builder too).
- The clue file's format: plain text, door by door, readable by a person, that Claude can write to
  match.
- Exact wording within the house rules, for Jaimie to approve.
- How many pictures an open door's mini collage shows; size limits for photos; how many photos a
  family can send in a day.
- How the practice door is kept apart from the real doors.
- How Finds and Doors lay out on a phone, within the mockups.
