# Santa Sleigh page — design

Agreed with Jaimie (NBCC) on 10 Nov 2026, in chat. To be built and live the same evening.

## Why

Every December NBCC runs the **Kilmarnock Santa Sleigh**: a sleigh goes round a
different set of streets each night while volunteers collect with buckets and card machines.
For many families it is the first, or the only, time they hear of NBCC. QR cards handed out on
the night, and the poster, point to one page. That page is for people who want to **give in
advance, cannot come out, or want to see when the sleigh is near them**, and it should leave a
first-time visitor knowing who NBCC is.

Like `/ball`, it is its own page with its own look, not a fundraiser or an event page, because
it needs things neither has: a list of nights and areas now, maps and live tracking later, a
year total that includes the buckets, and a switch-off date.

## Goals (tonight)

1. A standalone page at **`/santa-sleigh`** (`/sleigh` redirects there), fun, premium,
   inviting, on NBCC brand, heavy on motion like Fill a Red Bag and Elf Detective School.
2. Give online: £5 / £10 / £20 / £50 / own amount, through the existing Stripe checkout,
   each gift tagged Santa Sleigh. Anyone giving what they like (no business sponsorship).
3. The year's **total raised by the sleigh**, shown on the page, made of three parts:
   - online gifts made from the page (tagged at checkout);
   - **card machine** gifts (Stripe Terminal, `card_present`) taken on a sleigh night between
     an hour before the start and an hour after the finish, tagged automatically with the
     night; while a night's times are TBC its window is 16:00–22:00 UK time (Jaimie: card
     machines are only used on the sleigh, so time-tagging is safe);
   - **bucket cash** typed in by staff, one figure per night.
4. The seven nights for 2026, each with date and areas, "Timings TBC" until staff add times.
5. A short, clear "who's behind the sleigh" part for first-time visitors, then other ways in
   (Fill a Red Bag, volunteer, newsletter).
6. **Admin:** a new **Santa Sleigh** pill on Donations (online + card machine gifts), and a
   **Santa Sleigh** admin section: one row per night (date, areas, start/finish times, bucket
   cash, card machine total, online total), the year's grand total, and the switch-off date.
7. **Switch-off:** after the last night the page shows a thank-you with the final total; from
   the switch-off date staff set, `/santa-sleigh` redirects to the home page.

## Non-goals (tonight) — later, as their own pieces

- Route maps with the streets drawn on (staff will add routes later).
- Live sleigh tracking on the night.
- Business sponsorship, named sponsors.
- More than one sleigh/town a year.

## Anti-goals

- Repetition and wordiness. Jaimie: as little text as possible, clear and impactful.
- Wrong charity words. Always NBCC's exact phrasing: "children, young people and vulnerable
  adults", "South West Scotland", "volunteer led", "a full red bag". Never "Ayrshire" as the
  reach, never "children" alone.
- Anything that breaks the Ball, Fill a Red Bag, Donations, or the money path.
- Bucket cash appearing in the Donations figures (it is not individual donations, so it stays
  in the Santa Sleigh section only, as Uniform stays out of donation figures).
- A generic AI look. It must sit with the elf: bold thick maroon outlines, flat brand colours.

## The 2026 nights (from the poster, "Kilmarnock Santa Sleigh 2026")

| Date | Areas |
|---|---|
| Tue 15 Dec | New Farm |
| Wed 16 Dec | Wardneuk, Onthank & Altonhill |
| Thu 17 Dec | Bellfield & Shortlees |
| Fri 18 Dec | Fardalehill, Margaret Parker, Whisky |
| Sun 20 Dec | Southcraig & surrounding |
| Mon 21 Dec | Gargieston & Moorfield |
| Tue 22 Dec | Caprington & Grange |

Seeded by migration; editable in the admin. "Whisky" is as the poster has it (flagged to Jaimie).

## Look and feel

- Brand per `.impeccable.md`: Playfair Display + Poppins, the six brand colours, cream nav
  bar from the first pixel (the red logo sits on cream), own stylesheet.
- A night-sky top band in brand maroon pushed dark, falling snow at two depths, a moon,
  Kilmarnock rooftops with lit windows; the sleigh picture (ChatGPT, in the elf's thick-outline
  style, Santa with the NBCC elf, elf logo on the sleigh side) glides in and bobs.
- The total sits over a snowy road with **one house per night** (Jaimie, 10 Nov: no money
  target). The little sleigh drives along to the house for tonight (or the next night; before
  the first night it waits at the start, after the last it reaches the end) while the total
  counts up on arrival. Each house is labelled with its date and area, so the road doubles as
  the date list on a phone.
- Chunky outlined buttons that press in; amount buttons like real keys; a bell jingle wiggle on
  hover; the night cards as outlined tickets with a crimson date block.
- `prefers-reduced-motion` turns all motion off. Phone first (most arrive from a QR).

## Wording (draft, kept short)

- Heading: "Santa's coming down your street."
- One line: "Give now, even if you can't make it out on the night."
- Give: "Put something in Santa's bucket" + the gift line per amount.
- Nights: "Where's the sleigh?" / "Timings TBC".
- Who: NBCC's short description, verbatim, plus one line on the red bags; link to About.
- After the last night: "Thank you, Kilmarnock" + final total.

## The picture

`santa-sleigh-nbcc.png` (made in ChatGPT, Jaimie approved the style): Santa and the NBCC elf in
the sleigh, transparent background. Jaimie's correction: no elf face on the sleigh side;
instead "NBCC" in white **in the logo's own lettering** (cut from `nbcc-logo-white.svg`,
groups `Layer1_4..7`) on a sleigh body snapped to exactly Deep Crimson `#C02238`. Ships as
WebP at two widths (about 1600 and 840) with width/height set.

## How it is built (Claude's calls, following the `/bag` precedent)

`/bag` (red bags at the Ball) is a standalone page drawn in TS with its own checkout marker,
source, admin tile, thank-you page and date switch; the sleigh copies it file for file.

**Page.** Drawn in TS (`src/sleigh/`), not a root `.html`, so the root-page scans
(page-shell, footer-master, Dockerfile COPY list) are untouched. Own `assets/css/sleigh.css`
and `assets/js/sleigh.js`; nothing added to `styles.css` (perf budget). Router mounted before
the site router. `/sleigh` 301 → `/santa-sleigh`. Added to `SITE_PAGES` and
`RESERVED_PREFIXES` so staff can make a named QR code for it in Admin > QR codes, and so
analytics counts it. `/santa-sleigh/thank-you` is a private page (like `/bag/thank-you`).

**Online gifts.** A new checkout marker `sleigh: true` → Stripe metadata `sleigh="true"` →
`donations.source = 'santa_sleigh'` (added to `DONATION_SOURCES`, tagged after commit exactly
as `red_bag` is). One-off only, individuals or companies as the normal donate path allows,
minimum £2, Gift Aid offered as on `/bag`. Success → `/santa-sleigh/thank-you`, cancel →
`/santa-sleigh`.

**Card machine gifts.** In `handleChargeSucceeded`, after commit, a `card_present` gift whose
time falls inside a sleigh night's window is tagged `source = 'santa_sleigh'`. Saving a
night's times in the admin re-sorts that date's card-reader gifts (tag those now inside,
untag sleigh-tagged card gifts now outside). Sleigh-tagged card gifts move out of the "Card
reader" tile into the Santa Sleigh tile, so nothing is counted twice.

**Data.** Two additive tables:
- `sleigh_nights` (id, `night_on` date unique, `areas` text, `starts_at`/`ends_at` time
  nullable, `bucket_pence` int ≥ 0 default 0, timestamps). Seeded with the seven 2026 nights.
- `sleigh_settings` (one row): `season_from` date (2026-11-01, the start of the year's count),
  `off_on` date (2027-01-31). No target (Jaimie chose the houses road instead).

**Total.** Net paid `santa_sleigh` gifts since `season_from` + sum of `bucket_pence`, cached
60 s with last-good-value on error (the `redBagWorkshopTotals` pattern). Public page shows the
total only; the admin shows the parts.

**Admin.** No new permission section (that is costly): the Santa Sleigh admin view is gated
by the existing `donations` section (view to see, edit to change). A new "Santa Sleigh" tile
on Donations (source filter `santa_sleigh`) and a pill in the gift list. The Santa Sleigh view:
one row per night (date, areas, start, finish, bucket cash, card machine total), online total,
grand total, switch-off date; Save per row.

**Switch.** By UK date: before and during the nights, the giving page; after the last night,
a thank-you with the final total (giving still open); from `off_on`, 302 to `/`.
`?at=after` previews the thank-you state (noindex, no-store), the after-ball way.

**Tests.** Unit tests for the page render (house copy rules as `ball-bags-page.test.ts`:
NBCC's exact words, no "Ayrshire" as the reach, reduced motion), the switch, the window
classifier, the checkout marker refines, the source lists and tile; BDD for the routes
(page, redirect, thank-you, admin endpoints). Existing tests that list the sources exactly
are updated.

## Decisions that are the builder's call (marked)

- Page address `/santa-sleigh` (+ `/sleigh` redirect). *Claude's call.*
- Default card-machine window 16:00–22:00 while times are TBC; ±60 min once set. *Claude's
  call, Jaimie can change the times.*
- Switch-off default 31 Jan 2027. *Claude's call.*
- Card machine gifts are tagged when stored (`source = 'santa_sleigh'`) and re-sorted when a
  night's times are saved, as in "How it is built". *Claude's call.*
- Companies may give (the normal donate rules), unlike `/bag`. The card-fee top-up is left out
  of the total, as existing totals do. *Claude's call.*

## Layout

The layout is the mockup Jaimie saw on 10 Nov
(`sleigh-mockups/.superpowers/brainstorm/9934-1794339514/content/sleigh-page.html`), in that
order: cream nav, night-sky hero with the picture, the total on the road, give, "Where's the
sleigh?" nights, "Who's behind the sleigh?", other ways in, last give band, footer. Jaimie:
"Functionally, this looks great"; the changes asked for were less, sharper wording, the real
picture, and the motion turned up to premium.
