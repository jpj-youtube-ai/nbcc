# The admin refresh: Stories and Partners (2026-11-14)

One area of the whole-admin refresh (`2026-11-14-admin-refresh-design.md`): the three screens under
Content that are Stories (the list `#view-stories`, one story `#view-story`) and Partners
(`#view-ticker`). Thank you and Contact businesses are another builder's. Built from the kit
(`assets/css/admin-kit.css`, `assets/js/admin/kit.js`); what only these screens need is in
`assets/css/admin-content.css`, every selector named through its view or the prefixes `st-` (Stories)
and `pt-` (Partners).

Stories are people's own accounts of hard times, given with consent. What each sender agreed to is
the most important thing on both Stories screens, and is said in a sentence wherever the words are.

## Stories: the list

**What it is for.** Whoever looks after stories reads what people sent through the My Story form,
ticks each as read, and finds the ones NBCC may quote.

**Before.** A table of eight columns that showed nothing of the story ("Story 40", a role and pills),
two rows of filters with no counts, and on a phone eight labelled lines a story.

**Now.**
- One sentence saying what the screen is for.
- Six tiles with counts, one chosen at a time: All, To read, Read, Used, Withdrawn (the live stories,
  fetched once and filtered in the browser) and Archived (the second fetch, `?view=archived`). They
  replace the status pills and the Live or Archived pair. "To read" is crimson while anything waits.
- The table stays on a laptop, framed in the kit's look, and stays a card a story below 760px (TASK-561,
  pinned by tests). Its columns are plain words now: Read, ID, Sent by, Agreed to (the pills, then **what they
  agreed to as one sentence**), Status, When agreed (with "Check before using" past a year), Sent, Open. The quote is
  not on the list (review, 14 Nov: the list is thin on purpose, and only Jaimie can decide to widen it);
  it is on the opened story. "Erased stories" shows only to someone who may edit Stories.
- The status pills still say New and Reviewed (many tests and the "It is now ..." sentences use them);
  the tiles say "To read" and "Read" with "New, not read yet" and "Marked as read" under them.
- Folds at the foot: "Add stories from the old website" (editors, unchanged), "Erased stories" (new:
  reads `/api/admin/erasures`), and "Stories look missing?" (the storage check, now only for someone
  who may run it).

**The server: not changed.** The search box and first name, town and opening words on the card were
"should" items, left out for the deadline (14 Nov). The plan for them: `listStories` gains exactly four columns, so a card can name its sender and the search
can find them: `submitter_first_name`, `submitter_town`, `admin_tags`, and `opening` (the first 160
characters of the story, cut in the database so the whole story never leaves it for a list). Still no
email, no phone and no full story.

## Stories: one story

**What it is for.** Read one story in full, see what its sender agreed to, mark it read, note it, and
withdraw, archive or erase it.

**Before.** Eighteen facts in a form before the words; three controls that change the status with
nothing to tell them apart; the message for every button at the foot of the page; the reason for an
erasure typed into a browser box.

**Now, top to bottom.**
1. Back to stories; "Story 40" and where it has got to; previous and next story (through the list as
   it was filtered).
2. **Their story**: the words, then the line they chose to be quoted.
3. "Copy the story" and "Copy the quote", with what they agreed to beside the buttons so nobody
   copies without seeing it.
4. Mark as read (unchanged in behaviour).
5. **What they agreed to**, in sentences: public or private to NBCC, first name, town, someone else's
   permission, whether we may contact them, and when they agreed (with "Check before using" past a
   year).
6. "About the sender", folded: who they are, first name, email, phone, town, age, gender, who the
   story is about, how they heard of us, whether they said they are 16 or over, when it was sent.
   Email and phone are links to tap only when they said we may contact them.
7. Editors: "Notes, tags and status" (the old "Manage story"), with the message under Save changes.
8. Editors: "Putting a story away": Withdraw, Archive (or, once archived, Restore and Erase
   permanently), each with a line saying what it does and whether it can be undone. Withdraw and
   Erase ask first, in the page; Erase asks for its reason in the page. Archive still does not ask:
   it can be undone, and a question there would teach people to press through the one that matters.

`view-story` stays a screen of its own.

## Partners

**What it is for.** Whoever keeps the website up to date adds ongoing partners and chooses which
names scroll under the menu on every public page and appear on the Supporters page. About 390 names.

**Before.** One table of every name with no search; Edit, Hide and Delete as three small links a
thumb apart; Hide, Show and Delete said nothing when they worked and nothing when they failed.

**Now.**
- One sentence, then three tiles that filter in the browser: Showing, Hidden, All. The old "N total ·
  M showing" line is kept, in the heading of "How it looks on the website".
- "Add a partner": the name, and "Already on the list" as you type (with "Show it" when the match is
  hidden). A name already there is not added twice. Folded under it, "Add several at once", one name
  a line.
- "How it looks on the website": the showing names in a strip, in the website's order, and a link to
  the Supporters page.
- The list: a search box, the order (website order or newest first), a line saying how many are
  listed, the first hundred with "Show more". A card a partner with one switch, Showing or Hidden.
  "Rename or remove" opens the rest in the card: Rename, Put first (the server's `sortOrder`),
  Remove. Each says what it does; Remove asks first, in the page.
- Every press answers in the card that was pressed, and the card stays where it is.
- The words say "partner" throughout (the old messages said "supporter").

## Left out, and why

- Opening a story in place, as a Contact message does: tests and the phone's notification link expect
  `view-story`, and a long story with its consent reads better on a screen of its own.
- A filter by status inside the archive: the Archived tile lists every archived story with its status
  on the card, and the search box takes a status word.
- A bulk "add partners" endpoint: several names are added one request at a time, which needs nothing
  new on the server.
- Dragging partners into an order: "Put first" covers what `sortOrder` is used for today.
