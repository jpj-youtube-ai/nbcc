# Admin refresh: the newsletter composer (Write, Who, Send), TASK-645

Part of `2026-11-14-admin-refresh-design.md`, after the paper blocks (TASK-632) and the newsletter's
other screens (TASK-639). Jaimie: "I don't want you to take any features away, but I would love you to
add features to the newsletter area." These are the steps that email real supporters, so the faults
that could send wrongly or lose someone's writing came first, each with a failing test.

## What each step is for

| Step | The question it answers |
|---|---|
| Write | What does it say, and how will it look in an inbox, on a laptop and on a phone? |
| Who | Which audiences get it, and how many people is that, counted once each? |
| Send | Is it right, when does it go, how fast, and am I sure? |

## The faults, and what was done

1. **"It saves as you go" was untrue.** Only Save wrote. Now a draft is saved 1.5 seconds after the
   last change: a draft only, never a sent one, never beside a save already on its way (what changed
   meanwhile goes in the next), created on its first save and updated after. The bar says "Changes not
   saved yet", "Saving…", "Saved just now", "Saved 2 minutes ago", "Not saved yet: give it a subject
   line and it will save itself." or "Could not save. Your changes are still here: press Save to try
   again." Close saves first and asks only when it cannot; leaving the page with changes not saved
   makes the browser ask; opening the tab again never reads a newsletter over the one being written.
   Save is the same save, and no longer reads the newsletter back over the editor.
2. **The step button on a phone** was already above the bottom bar (TASK-639's CSS); measured at 390px.
3. **New newsletter** is in the composer's top bar and clears the subject, the bar's title, both name
   fallbacks, the preview text and the blocks (as do the example and a saved template).
4. **Who**: "Choose one audience or more", the cards are a group of tick boxes (and look like them),
   the old "Send to" box never shows, nothing is chosen for you (it used to tick Newsletter, the
   biggest), and one number: the people who will get it, counted once each, from the server.
5. **Before you send** names every audience chosen and gives that same number.
6. **Send later with no time**, or Send with nobody chosen, is refused beside the button and says why
   (both used to send: straight away, or to the server's default audience). The date box no longer
   shows while "Send now" is chosen. The confirmation says who, how many, when (the day and time as
   people say it) and how fast (all at once at about 60 a minute, or gradually).

Nothing on the server about who can be mailed, consent, unsubscribing, blocking, the send worker,
pacing or scheduling was changed.

## Features added

1. **Preview, laptop or phone**: a switch beside the canvas; the phone at a phone's true width (an
   email that lays out wider is shrunk to fit, as a phone's mail app does). "Preview it for" takes a
   name, or none. The inbox line (subject and preview text) sits over the preview. The preview is whole
   in the page at every width; on a phone a "Preview" button opens it full screen in the page, with
   "Back to writing".
2. **Undo**: removing, moving, duplicating, adding or restyling a block (or removing an item) can be
   undone ten steps deep while the newsletter is open: a "Removed Text. Undo" line where it was, the
   Undo button in the canvas bar, and Ctrl+Z outside a text box.
3. **Add a block where you are**: a "+" in each gap opens the palette there.
4. **Start screen** for a new newsletter: blank, carry on your latest draft, use one of the last three
   sent newsletters again, a saved template, or the example, each with one line.
5. **Subject helper**: its length and what a phone shows of a long one; how it reads for the name
   previewed and for someone with no name (read by the server, by the send's own rule). **Preview
   text**: an optional `preheader` on the document (no migration), drawn as a hidden first line of the
   email only when it holds words, so every newsletter already written is unchanged (the golden test
   is untouched and green). It greets by name as the subject does, and is the plain text's first line.
6. **Send a test to up to five people**, yours filled in, checked before sending, the result named per
   address beside the button.
7. Every new control 44px, every new field 16px.

## Server

`POST /api/admin/newsletters/preview` (same guard) takes an optional `firstName` (empty is no name) and
`subject`; with a subject it answers `subjects: { named, unnamed }` from `mergeSubject`. The document
schema gains `preheader` (150 characters at most). Real-server contract tests in
`test/unit/admin-newsletter-contract.test.ts`, a BDD scenario in `features/newsletter.feature`.

## Left out, and why

- **Moving a scheduled send's time** (the "should"): a new way to change data, with its own guard,
  audit row and scenario; left for its own change.
- The recipient list in the confirmation is still a tooltip that scrolls inside itself: showing
  hundreds of addresses in the page wants its own design.
- The built-in Christmas starters designed in TASK-632 (stage 3) were never built; the start screen
  offers the example in their place.
