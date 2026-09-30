# Bringing the old website's My Story submissions into the admin

Date: 2026-09-30. Approved by Jaimie in chat ("yes build it").

## Why

The old website had its own My Story form. Its submissions come out as a CSV, one row per
submission, and they belong in Admin → Stories beside the ones the new form collects. The rows
hold names, emails and phone numbers, and this repository is public, so the stories can never
travel through code, a migration or a workflow input. They reach the stories database only through
the running app, over HTTPS, from someone signed in with `stories:edit`.

## What staff see

On Admin → Stories, a closed panel, **Add stories from the old website**, for editors and admins
only:

1. Choose the CSV exported from the old form.
2. The page lists every story it will add (the date it was sent, first name, town, the start of the
   story, and its consents) and every row it will not add, with the reason in a plain sentence.
3. **Add N stories** saves them. Nothing is saved before that press. The list reloads and they
   appear as New.

Choosing the same file again adds nothing: those rows show as already added.

## How each old answer maps

| Old form | Stories database |
|---|---|
| Submission date | `created_at` and `consent_captured_at`: consent was given when they sent it |
| Your story | `story_text`, exactly as written |
| Short quote | `short_quote`, exactly as written, however long |
| Share your story publicly? Yes | `use_scope = public` |
| No, but internal use Yes | `use_scope = internal_only` |
| Share first name / town? Yes | `consent_share_first_name` / `consent_share_town` (public stories only) |
| Anything else you'd like to share | added to `admin_notes`, quoted |
| First name, Your Town/Area, gender, How did you hear | the matching columns, trimmed, as written |
| Email, Phone | `submitter_email` (only if it is a real address), `submitter_phone` |
| Email or phone given | `contact_for_more = true`: the old form asked for them "just in case you're happy for us to contact you about your story", and the notes say so |
| Your age ("45 to 64") | `age_band` (`45_64`); anything unrecognised is left empty |
| The Red Bag went to a (Child) | `recipient_type` (`child`, `young_person`, `vulnerable_adult`) |
| I confirm that I am over 16 (Checked) | `confirmed_over_16 = true` |
| (not asked by the old form) | `submitter_role` empty, `third_party_consent` false |
| (every imported story) | `status = new`; `admin_notes` starts "Brought in from the old website's My Story form on …" |

Nobody's words are corrected: a typo, a surname in the first-name box, or a sentence in the quote
box comes across as written. Staff can add notes.

The notes always fit the admin's own limit on notes (`MAX_ADMIN_NOTES_LENGTH`, 2,000 characters,
shared with `PATCH /api/admin/stories/:id`): past it, staff could never save that story's status or
tags again. Anything quoted that cannot fit is shortened and says so.

## Rows that are not added, and why

- **Sent again**: the same email, compared exactly as typed, sent another row within an hour. The
  earlier one is left out ("They sent it again 2 minutes later, so this earlier one is left out").
  Their later go is their last word and counts even when it takes the story back: it is then left
  out for its own reason, and the earlier one still is. A kept story's notes say an earlier version
  existed, because the words can differ between goes.
- **Already added**: a story with the same sent date and the same words is already in the database.
- **No consent to use it**: they said no to public use and no to internal use.
- **Not confirmed as over 16.**
- **No story.**
- **A date that could mean anything else**: not a full date and time with its time zone, before
  2000, or after the day of the import. "05/07/2026" could be July or May, and a time with no zone
  could be an hour out in summer, so neither is guessed.
- **Damaged**: a row with more or fewer answers than the form has questions. An answer with an
  unquoted comma shifts every answer after it, so such a row is never read.
- **Too long**: over 20,000 characters, far beyond anything the old form produced.

A file that is not the old form's export (the required columns are missing) is refused as a whole
with a sentence saying which column is missing, and so is a file with a quotation mark that is never
closed, which would otherwise lose every row after it. The admin refuses a file over 2 MB before
sending it; the route's own limit is 3 MB, room for the JSON around it.

## Pieces

- `src/stories/old-site-import.ts`: pure and DB-free. `parseCsv` (quoted fields, doubled quotes,
  line breaks inside quotes, a byte order mark), `readOldSiteExport` (header row → fields, or a
  refusal), `planImport(rows, alreadyHere, importedOn)` → stories to add and rows to skip with
  reasons, and the preview shape the admin shows.
- `src/db/stories.ts`: `storiesAlreadyHere(candidates)` and `insertImportedStories(records)`: one
  transaction under an advisory lock, re-checking what is already there inside it, so a double
  click or two editors at once cannot add a story twice.
- `src/routes/admin-stories-import.ts`: `POST /api/admin/stories/import` with `{ csv, commit }`.
  `stories:edit` only. Without `commit` it only plans; with it, it plans again on the server and
  saves. Mounted with its own 3 MB JSON limit. No `audit_log` row (the stories feature is
  deliberately self-contained); the server logs counts only, never content.
- `admin.html`, `assets/js/admin/app.js`, `assets/css/admin.css`: the panel. It grows the page; it
  never scrolls inside itself.

## Privacy

- The real CSV is never committed. Tests use invented people at example.com.
- The server keeps nothing from the file except the mapped rows, and logs nothing from it.
- The preview (names, towns, story starts) goes only to the signed-in editor who chose the file.
- The server's log line says who ran an import and how many stories it added: nothing from the file.

## Tests

- Unit: the parser, the header check, every mapping, every skip reason, and the preview, all on
  invented data.
- Admin shell: the panel exists, is closed, and is for editors only.
- BDD in CI against the stories database: a dry run saves nothing; a commit adds the stories with
  their original dates and consents; the same file again adds nothing; a viewer is refused; a file
  that is not the export is refused.

## Not doing

- No new database columns: the original date and words are the duplicate check.
- No editing of the stories' words after import; notes are the place for staff.
- No general "type a story in by hand" form.
- No memory of erased stories. A story erased from here would come back if the same file were
  added again, so the panel says to delete the file once the stories are in. Remembering erasures
  needs a new table in the stories database and a change to erasing: a follow-up, if wanted.
