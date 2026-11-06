# Fill a Red Bag: the Workshop and company links (plan, 6 November 2026)

Builds on 2026-11-05-red-bag-premium-art.md (the paintings, the bag, the buttons, the night look's
Workshop, already on this branch). Jaimie's decisions, 5 and 6 November 2026:

- The night look's background is the elves' Workshop aisle (12 painted stages, s00 to s12). It always
  opens stocked (stage 3 at least); the sign gives the real count.
- One bag on the shelves = every £50 given through Fill a Red Bag this season.
- The everyday /fill shows everyone's bags. A company's own link, **/fill/<slug>** (e.g.
  /fill/ge-aviation), shows only that company's bags, with its name on the sign; its gifts also count
  for everyone's.
- No goal: the shelves keep stacking. Pacing is "quick start, scaled": staff choose a private size per
  company (about 20, 100 or 500 people), never shown, which sets the bag counts for the 12 stages. As the
  Workshop now opens at stage 3 (stocked), the rungs move stages 4 to 12: for about 100 people 1, 3, 6,
  10, 16, 25, 40, 65, 100 bags. The everyday page uses the everyone ladder.
- The elf is only ever the logo's own elf (assets/img/nbcc-elf.png), peeking over the workbench, with
  a speech bubble by stage. Never a new painted elf.
- All of it goes live in one go, **not before Sunday 8 November 2026** (the Ball and Stage 2).
- The Ball's own /bag page is untouched (it keeps the hand drawings: rb.drawing()).

## Tasks

1. **The ladder (pure, tested).** `src/red-bag/workshop.ts`: `LADDERS` for small / medium / large and
   everyone; `workshopView(pence, size, name?)` returns `{ stage, bags, nextIn, name }` (bags =
   floor(pence / 5000); stage = how many rungs reached, never below WORKSHOP_FIRST_STAGE; nextIn = bags to
   the next rung, 0 past the last). Unit tests for every rung edge, 0, huge numbers, bad input.
2. **The companies (migration + db, additive).** `red_bag_workshops`: id, slug (unique, lower case,
   letters, numbers and hyphens), name, size ('small' | 'medium' | 'large'), created_at, archived_at
   (null). `donations.red_bag_workshop_id` (nullable, no default, a foreign key, an index). Migration
   numbered after the last on origin/main AND other sessions' open PRs, checked again right before merge.
   `src/db/red-bag-workshops.ts`: list, create, rename, archive, findBySlug (60s never-throws cache, like
   red-bag-lists.ts), totals (one query: SUM(amount) of source = 'red_bag' since the season start, overall
   and per workshop; 60s cache; on any error the last good value, else 0).
3. **The gift carries its company.** The /fill page posts `workshop: <slug>` with the gift; api.ts
   checks it against findBySlug and sets `metadata.redBagWorkshop` (only with redBag). The webhook's
   existing after-commit source statement also fills `red_bag_workshop_id` when that mark names a live
   workshop: the same best-effort, separate, fill-only-if-empty statement, so the donation's own INSERT
   is unchanged. Tests on the pure parts (the mark, the statement), BDD for the post.
4. **The routes.** GET /fill/:slug (a live workshop, else 404, the ordinary /fill otherwise unchanged);
   reserve the slug list against existing /fill/* paths (thank-you) and the page list. The night look
   gets `workshop: workshopView(...)`. Before the Ball's moment the day page is byte for byte as now.
   A company page is noindex.
5. **Admin.** Under Admin > Get involved > Fill a Red Bag (the red-bag permission): a "Company
   Workshops" list (name, link, bags, total), "Add a company" (name, size; the slug made from the name,
   editable once, never reused), archive, and a QR code (PNG and SVG) for each link via src/site/qr.ts.
6. **Finish.** Update the 9 pinned tests (baselines, the elf's markup, the panel) with the new hashes
   after checking each diff is the one meant; README (routes, the table, the admin); tidy the floor
   smudges in stages 10 and 11; a full stand-in walk on desktop and phone; code review; PR; CI green;
   merge only with Jaimie's go-ahead and from Sunday 8 November.

## Season

- The shelves count Fill a Red Bag gifts from **1 November 2026** (Jaimie, 6 November 2026).
