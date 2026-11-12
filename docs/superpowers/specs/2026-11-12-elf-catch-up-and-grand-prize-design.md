# Elf Detective School: catching up on missed doors, Christmas Eve and the grand prize

**Date:** 12 November 2026
**Status:** draft for Jaimie's approval.
- Part 1 was agreed in chat on 11 November.
- Part 2 is Jaimie's notes of 11 November with my playback; the points marked "my call" are mine.
- Some of part 2 is already live (see "Already done").

**Builds on:** the October design (2026-10-04-elf-detective-school-design.md), the secret places design (2026-11-03-elf-detective-secret-places-design.md) and the wave 2 design (2026-11-10-elf-detective-wave-2-design.md). Where this design differs from them, this one wins. Everything else in them stands.

## Why

Some children can't make every door's evening: a child has football every Tuesday, a family joins on the 10th, a grown up works late on Thursdays.

Today, once a door's hiding place is shown on the calendar, nobody can crack that case any more, because the answer is out for everyone. A family can still get that door done by visiting the place later in December. But a child who can't get to the places they missed can't reach all 24 doors, and so can't go for the grand prize.

This change keeps each door's hiding place secret from a family until that family has had its own guess at it. A child who missed an evening can then crack that door's case later, from home, with the same three clues.

Christmas Eve needs its own plan too. Places close early, the last door runs that morning, and the grand prize pictures come in that day and are judged before the winner's grown up is rung that evening.

## Already done (live since 11 November)

- Door 24 runs in the morning by default: clues at 10am, 10:30am and 11am, with the place shown at 11:30am. The rules and the calendar say so. (TASK-614)
- A grown up gives a mobile number when they enrol, "so we can ring you straight away if one of your detectives wins the grand prize on Christmas Eve". Head elves see it on the family's sheet. Families who enrolled before the evening of 11 November have none. (TASK-614)
- Elf Detective School's front page says the grand prize is judged by the Head Elf. (TASK-614)
- Every page wears the site's own banner, menu bar and footer, through src/site/chrome.ts, and a test enforces it. (TASK-615)

## Part 1: catching up on missed doors

### What Jaimie decided (in chat, 11 November 2026)

1. A family never sees where a door's elf was hiding until that family has had its guess at that door.
2. On the night, the hunt does not change:
   - three timed clues;
   - guesses that can be changed until the place would be shown;
   - the first detective to type the word on the elf's tag wins that door's prize.

   As soon as the elf is found, the door says who found it.
3. On any later day, a family that has not guessed a door can **have a go**:
   - it sees clue 1, and can ask for the next clue, up to all three;
   - then it makes **one** guess;
   - it is told straight away whether it was right, and where the elf was hiding.
4. A right guess when having a go cracks the case, so that door is done, exactly as with a right guess on the night.
5. Visiting still counts. Once a family knows a place, it can call in any day in December for the candy cane stamp.
6. A door's photos stay hidden from a family until it has had its guess, because a photo can show the inside of the place.
7. The daily social posts in the morning email stop naming the place.

The single guess in point 3, and points 6 and 7, were my suggestions. Jaimie accepted them: "i like this change from what youve said lets go with it".

### Goals

- Every family can crack every door, whichever evenings it misses and whenever it joins.
- No page, email, post, picture or refusal gives a door's place away to anyone who has not had their guess at that door (or been there).
- The live evening stays exactly as exciting, and as quick, as it is now.

### Non-goals

- No change to clue times, the find, the prize, the tag word, the six wrong words rule, snow days or gone home.
- No points for using fewer clues.
- No second guess when having a go.
- No change to what head elves see. Head Elf HQ still shows every place.
- No attempt to stop families telling each other. It is a children's game, played on trust.

### Anti-goals: this has failed if

- Anyone can learn a door's place in December from the site without having their guess at that door. That covers:
  - the calendar and its data;
  - a photo or a post;
  - an email or a refusal;
  - a page title or a cached copy;
  - anything worked out from the place, such as a fingerprint of its name.
- A family can have a second go at a door, by pressing twice, or from two phones or two tabs.
- A family loses a crack it earned on the night, or the live evening becomes slower or more confusing.
- Anything new shows while December's doors are switched off.

### How it works

**The one rule.** A family can see a door's place once either of these is true:
- the door's shown moment has passed **and** the family has a guess at that door, from the night or from having a go; or
- one of its detectives has typed the door's tag word (the find, or a visit).

Everyone else, including anyone not signed in, sees who found the elf, and never where it was.

**On the night.** Nothing changes until the shown moment, which is when the place would be shown today: by default 30 minutes after clue 3, or later if the elf is found later or not at all, up to the place's closing time. As now, the door says "Found by Detective R. Tinselfoot at 6:47pm!" as soon as the elf is found.

**At the shown moment.** Each family's door opens for that family.
- A family with a guess sees how it did and where the elf was, as now: "You cracked it!" or "Not this time".
- A family with no guess sees **Have a go** instead.
- Anyone not signed in sees who found the elf, or that nobody has yet, and never the place.

**Having a go.** This is open from the door's shown moment, for as long as December's doors are on.
- The door shows its elf's name and number, who found it, and **clue 1**, in words or as its picture, just as it came out on the night.
- **Show me the next clue** reveals clue 2, then clue 3. A family can see all three before it guesses.
- There is one guess box, with the night's rules: up to 80 characters, and the same matching against the place's names. It says "You get one guess at this door."
- **Lock in my guess** answers straight away:
  - Right: "You cracked it! Twinkle was hiding at Corner Bakehouse, Snowford."
  - Wrong: "Not this time. Twinkle was hiding at Corner Bakehouse, Snowford."

  Both then invite the family to visit for the candy cane, unless the elf has gone home.
- Having a go is offered on the open door on the calendar, and in a new **Doors you can still crack** list in Detective HQ, newest first.
- A family that has visited a door, or found its elf, already knows the place, so it is not offered a go.
- A snow day door has nothing to guess. It is already done for everyone.
- If nobody has found the elf yet, the first detective to reach it still wins, as now. A family that has had its go may go and look.

**Doors done.** A right guess when having a go counts exactly like a right guess on the night, towards:
- ranks, costumes and presents;
- the certificate and the proud emails;
- graduating and the grand prize;
- the door's "N families cracked this case" count.

**Photos.**
- A door's photos (the scrapbook's second row) show only to a family that can see that door's place.
- During December they never show to anyone who is not signed in.
- The two families rule, one photo per family per door, and the photo check all stay.
- The picture files are only ever sent to such a family, marked private and never stored by a browser or a shared cache. Today they are cached for five minutes in public.

**The calendar for everyone else.** The calendar everyone shares carries no place, and nothing worked out from one: not an open door's room, the words for screen readers, the status line ("found today's elf at …"), the calendar's data, or a door's fingerprint. A signed in family's own places and photos come separately, for that family only.

**Emails and posts.**
- The clue email no longer says "The hiding place is shown at 7pm". It says when the family will find out whether it cracked it, and that a missed door can be cracked later in Detective HQ.
- The morning email's post about yesterday's find no longer names the place. It says who found the elf, and that anyone who missed it can still crack the case in Detective HQ.
- The won email, the proud emails, the texts and the find alert to head elves stay as they are.

**Refusals.**
- "That elf was already found behind door 3. Try again!" is said only to a family that can already see door 3's place. Any other family's guess is taken as an ordinary guess, so the refusal never gives door 3's place away.
- A guess for tonight's door sent after its shown moment is no longer met with "Too late".
  - A family with a guess is told its guess is locked in.
  - A family without one is taken to have a go.

**The rules page** (with December's doors on):
- "How the hunt works" says that a door missed on the night can be cracked later in Detective HQ, with one guess.
- "The grand prize" says the same, in place of "Joined late? Visit the places from before you joined to do their doors."

**The practice door** works the same way, so a head elf can try having a go after the practice evening's shown moment.

**Head Elf HQ.** Nothing new for this part. Finds does not count late cracks (my call).

**Switched off.** All of this shows only while December's doors are on. With them off, every page is exactly what it is today.

### My calls in part 1 (for Jaimie to check while reading)

- One guess when having a go, and it is final. On the night a guess can still be changed until the shown moment, as now.
- Having a go stays open for as long as December's doors are on, not only until Christmas Eve. Only doors done before the grand prize closes count for the grand prize.
- A right guess when having a go counts the same as one on the night, including in the "N families cracked this case" count.
- Having a go is offered in two places: on the calendar's open door, and in Detective HQ's new list.
- A family that has visited a door is not offered a go.
- Places stay off the public calendar for the whole of December.

## Part 2: Christmas Eve and the grand prize

### What Jaimie asked for (in chat, 11 November 2026)

- Places close early on Christmas Eve, so door 24 starts at 10am. Families are told the day before. Once the clues are out, they can tell when the place closes. (The 10am start is already done.)
- The grand prize picture is sent in on the site from the morning of the 24th, once a family has done all the doors, so it can be judged and the prize delivered on Christmas Day.
- Every day for the week before, families who have done every door so far are asked "Have you got your picture ready?"

### How it works

**The day before** (23 December): that day's clue email adds a line saying tomorrow is Christmas Eve, so the clues start at 10am and places close early. Families give us only an email address, so this goes by email (my call, from the playback).

**The closing time.** On a door's own day, a family that can see the place is also told when it closes that day: "Corner Bakehouse closes at 2pm today." It is drawn from the door's own closing time. My call: this is on every door's own day, not only door 24's, because it is the same need every day.

**The entry.**
- It is for each detective, not each family, because the rules say "Every detective who does all 24 doors can send in a drawing or a photo".
- From the morning of 24 December, as soon as a detective has done all 24 doors, Detective HQ offers **Send in your picture** for that detective.
- The grown up uploads one picture: a drawing, or a photo of their naughtiest elf at home.
- Until the entries close, the grown up can replace it.
- The picture is made again, so nothing from the camera survives: not where, not when, not the phone. There is a size limit, as for door photos.
- It is never public. Head elves see it in Head Elf HQ.
- If the family has no mobile number (it enrolled before we asked for one), the entry asks for one, with the same words and the same check as the join form.

**The entries close** at a time a head elf sets in Head Elf HQ > Settings. After that, no entry can be sent or changed. Detective HQ says so plainly before and after.

**Judging, in Head Elf HQ.**
- A **Grand prize** part lists every entry.
- Each shows the picture, the detective name, the grown up's name and mobile, and the time it came in.
- A head elf can mark the winner. The rules say NBCC phones the winner's grown up on Christmas Eve and delivers the prize on Christmas Day; that stays a person's job, not the site's.

**The week before** (17 to 23 December, my call):
- The clue email to a family whose detectives have done every door so far asks "Have you got your picture ready?", with a line on what to send.
- A family that is behind is told how many doors it can still crack from home, and is pointed to Detective HQ's list.

**January:** entries and their pictures are deleted with everything else at the end of January, by the January clear out piece, which must include them.

## Carried from the earlier builds (do these here)

- The public photo route's five-minute public cache becomes private, as above.
- There is no way for a family to stop the daily clue email, and this change adds lines to it. My call: a **Stop these emails** link in each clue email, and a matching switch in Detective HQ. A family that stops them still sees everything in Detective HQ.
- Head Elf HQ > Doors names the head elf by name, not email, on the dropped off and thank you ticks, as it already does for snow days and gone home. (The rule: a head elf shows by `users.full_name`, and by email only when the name is blank.)

## Constraints

Every constraint in the wave 2 design binds this change:
- the public repository;
- shipping switched off;
- the paper look at 390 and 360 pixels, with no inner scrollbars;
- children's safety;
- the words rules ("Elf Detective School" in full, no dashes in public words);
- additive migrations that sort last;
- tests first;
- config through the schema;
- the README;
- the email allowance;
- Europe/London times.

Also:
- A family's own places, photos and entries never pass through a shared cache.
- The single guess when having a go is enforced by the database, not only by the page.
- Every new page takes its banner and footer from src/site/chrome.ts (test/unit/site-chrome-everywhere.test.ts).
- Any route that waits on something answers 500 rather than rejecting, as TASK-615's routes do.

## Left to the builder

- How a family's own places reach the calendar (for example through its own existing data, or a new private route).
- How the single guess and the entries are stored, as long as the change only adds.
- Whether the clues a family has opened are remembered between visits.
- The look of having a go, of the entry and of the Grand prize part of Head Elf HQ, in the paper look and in Head Elf HQ's look. Show them to Jaimie as pictures first.
- The new and changed words, added to the words file (2026-11-10-elf-wave-2-words.md) for Jaimie to approve.

## My calls in part 2 (for Jaimie to check while reading)

- **Door 24 keeps the hunt's own rule.** Families can finish door 24 only once its elf is found and the place is shown, or the place closes. So entries close at least an hour after door 24's place closes.
  - Head Elf HQ refuses an entries closing time earlier than that.
  - Doors warns while door 24 has no closing time typed in (otherwise it falls back to 8pm).
- **The Graduate's certificate is part of this build.** The October design promised it, the code can already draw it (`renderElfCertificate`, src/elf/print.ts), but nothing serves it yet. A detective first graduates on Christmas Eve.
  - Detective HQ offers each graduate their certificate to print or save.
  - It also offers the share card and the video link the October design describes.
  - The words and pictures go to Jaimie for approval with the rest.
- **"Stop these emails" stops every Elf Detective School email that is not essential:**
  - the daily clue email;
  - the reminders;
  - the "picture ready?" lines;
  - the proud emails, which carry a "Give a little more" button and so need a way to opt out.

  Sign in codes, payment receipts and the email to the family that found an elf still go. The link is in each of those non-essential emails, and the switch is in Detective HQ.

## Questions only Jaimie can answer (one at a time, most important first)

1. **Christmas Eve timings. ANSWERED (Jaimie, 12 November):** entries close at **5pm on Christmas Eve**. That is the default in Head Elf HQ > Settings, which a head elf can change. Door 24's place must therefore close by 4pm, and Head Elf HQ warns while door 24's closing time is later than an hour before the entries close.
2. **Brothers and sisters. ANSWERED (Jaimie, 12 November): yes.**
   - When any detective in a family visits a door's place (the find or a visit), that door is **done for every detective in the family**, towards ranks, costumes, presents, graduating and the grand prize.
   - The candy cane stamp, the gold seal and the elf on the door stay with the child who went.
   - So a detective's doors done = the family's cracks, plus the family's visits, plus snow days. The gold seal still counts only that detective's own visits.
3. **Age. ANSWERED (Jaimie, 12 November):** the entries are judged **without knowing ages**, and NBCC asks the age when it rings the parent.
   - The entry never asks for an age, and the site never stores one.
   - The rules' sentence about judging "taking age into account" stays as it is (my call), because age is still weighed on the call.
4. **Winners.** Is there one winner, or one in each age group, and any runners up? Is anyone told on the site, such as a line on the calendar on Christmas Day?
5. **The closing time with the clues.** Should families see the hiding place's closing time alongside the clues, so they know their deadline (a small hint), or only once they know the place? Today the site deliberately never tells a family how late a place is open.
6. **After Christmas.** Should the places, and the photos, appear on the calendar for everyone as a thank you to the businesses? If so, from Christmas Day or from 1 January? And should December's doors, and having a go, stay on into January, or switch off after Christmas?

## For the builder: where the place shows today

From a read of the code at 93e75c89 (paths under src/):

- **Guessing:**
  - canGuess (elf/doors.ts:95) and shownAt (doors.ts:42);
  - one guess per family per door, saved over (db/elf-game.ts:261);
  - cracked is worked out, not stored (elf/guess.ts:54; db/elf-game.ts:452 crackedBy). It needs the guess saved before the door opened, which a guess when having a go never is;
  - the refusal that names another door's place (guess.ts:32);
  - "Too late" (routes/elf.ts:1133).
- **The shared calendar:**
  - one build per process (elf/public-calendar.ts:20), cached publicly for 15 seconds (routes/elf.ts:637);
  - the open door's room (door.ts:166), the words for screen readers (door.ts:88), the detail (door.ts:392) and the status line (calendar.ts:42);
  - the per-door fingerprint made from the place (door.ts doorVersion);
  - GET /api/elf/door/:n (routes/elf.ts:712).
- **Photos:**
  - the bytes route (routes/elf.ts:1285), cached for 5 minutes (about line 1299);
  - SHOWN_PHOTO_SQL (db/elf-game.ts:509);
  - the scrapbook's photo row (door.ts:384).
- **Detective HQ:**
  - today's door only (elf/views.ts:135 todayRunOf);
  - the outcome words (elf/pages/hq.ts:101).
- **Emails and posts:**
  - the clue email's shown line (elf/emails.ts:117);
  - yesterday's post (elf/posts.ts:31).
- **Unchanged,** because the family is standing at the place: the poster page (pages/poster.ts:233) and the gold and visit cards (poster.ts:73 and 133).
- **Clue pictures:** /elf/hq/clue/:door/:n.jpg (routes/elf.ts:1364) already serves past doors to signed in families once a clue is out.
- **The mobile at sign up:** migration 1791200000460, and the family sheet in src/db/elf-admin.ts (readSheet).
