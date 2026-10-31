# New home page, Get involved, What's on, and the 8pm Fill a Red Bag switch

Date: 31 October 2026. Owner: Jaimie (NBCC). Status: Jaimie said go ahead once the reviewer reported. The calls she has not seen yet are listed at the end.

## Why

Today nbcc.scot/get-involved is really the events page. People who want to help have no single place
that says how, and Fill a Red Bag, the new way to give, is hidden. Jaimie has clicked through a
prototype, loves it, and has set out how it goes live.

Fundraising is the biggest way people get involved, so Get involved leads with it. There are a lot of
events on, so they get a proper home of their own. Fill a Red Bag is the thing NBCC most wants to push,
and it takes over from the Festive Ball the moment the Ball is under way.

## The two stages

Jaimie's words, 31 October: "on the 7th of November at 8 p.m., automatically the ball stuff will come
down off the website and fill a bag will appear" and "everything else ... will launch as soon as it's
built. So we can get them up tomorrow probably."

**Stage 1, as soon as it is built (aiming for 1 November):** the new top of the home page with "Where
would you like to start?", the new Get involved, What's on, and the short pages. No Fill a Red Bag
section anywhere yet, and the Ball's promotion stays exactly as it is.

**Stage 2, by itself at 20:00 UK time on Saturday 7 November 2026 (20:00 UTC, the clocks have gone
back):** the Ball's promotion comes down and Fill a Red Bag appears. Nobody presses anything. The code
for this ships days before and does nothing until the moment comes.

## Goals

- Stage 1 live quickly without disturbing a single Ball booking.
- Stage 2 happens on the dot, with no deploy, no merge and nobody at a computer on Ball night.
- Fundraising is the first thing Get involved offers.
- Events are easy to find from the menu, from Get involved, and at their old address.
- A bag filled on the home page carries through to the real page with nothing lost.

## Non-goals

- No change to booking, payment, tables, guests, menus, transfers, invoices or emails for the Ball.
- No change to the newsletter system.
- No new "Fill a Red Bag" pieces from the earlier list (gifts for others, the shelf, group bags).
- The rest of the home page, below the new sections, stays as it is today.

## What would make this a failure, even if it technically worked

- Anything Ball related breaking before or on the night. It is the charity's one live ticketed event
  with real bookings and money.
- A placeholder, a yellow mark or a "Photo to come" reaching the public.
- A price on the home page that differs from the real page.
- The bag carrying through wrongly: the wrong things, or the wrong amount, on a page that takes money.
- Fill a Red Bag's money path changing. Its checkout, its Gift Aid step and its receipts stay as they are.

## Rules that stay in force

- Ball pages (`ball.html`, `ball-terms.html`, `ball-donate.html`, everything under `src/ball` except what
  is named below) are not touched before 8 November. They keep their old menu and their old footer.
- `partials/footer.html` is not changed before the Ball, because it is copied to every page, Ball pages
  included. New footer links go in the way the fundraising link does (`src/fundraising/footer-link.ts`):
  added as a page goes out, on non-Ball pages only.
- Wording: never "families" in our words; NBCC helps "children, young people and vulnerable adults";
  "could", never "will" or "buys"; the proper name is "Red Bag Full of Joy".
- The repo is public: invented fixtures only. Nothing inner-scrolling. Works at 320px wide. Respects
  less motion.
- Anything visible: screenshots to Jaimie and a yes before it goes live.

## Stage 1 in detail

The prototype is the visual reference for everything below: folder `get-involved-prototype` beside this
repo, `content/*.html`, `proto.css`, `proto.js`, built by `proto_build_v3.py`. Its design is the site's own
pieces pushed further: the quilted card back, snow drift edges, taped photos, lined paper, gift tags on a
gold ribbon, and Caveat handwriting.

### Home

- The two-column top keeps the words "You know us at Christmas. We're here all year.", the sentence
  about NBCC, and the two buttons already there ("Donate now" and "What we do all year"). The prototype
  dropped them, but "Donate now" is the main first-screen route to giving just before Christmas.
  The right side is the logo, big, on plain cream with nothing behind it.
- The logo is the vector `nbcc-logo-full.svg` in the prototype: the site's `nbcc-logo-white.svg` with its
  letters turned to the logo's maroon and its white outline removed. Checked against the master.
- Directly under it, "Where would you like to start?" with the four gift tags on the gold ribbon:
  Donate, Drop-off points, Referrals, Volunteer. Wording as the prototype.
- **The Ball's promotion must keep working.** `src/ball/home-promo.ts` finds two exact strings in
  `index.html`: `MAIN_ANCHOR` and `AFTER_HERO_ANCHOR` (the "What we do" section). Both stay byte for byte.
  The tags go before `AFTER_HERO_ANCHOR`, so until 8pm on the 7th the order is: hero, four tags, the
  Ball feature, then the rest of the page. The banner stays at the top of the page.
- `index.html` has a page weight budget and other tests. Styles go in their own file.

### What's on

- Today's page moves to a new address, `/whats-on`, as it is: our events, supporters' fundraisers, the All /
  Events / Fundraisers chips, today's flip cards with their meters and ticket buttons, the "Got an idea?"
  film, and the "Raise money your way" panel. The heading stays "Join in, or raise money your way." The
  prototype's green band and stub cards are NOT used: today's cards do more, and this keeps the step small.
- Not `/events`: that address has answered 301 since TASK-494, browsers keep a 301 for good, and anyone who
  followed it would never reach the page. `/events` now forwards to `/whats-on`, query string kept. So
  do nothing else: `/getinvolved` and `/involved` keep going to `/get-involved`.
- `/whats-on` joins `RESERVED_PREFIXES` and the site map.
- A line at the bottom: "Looking for other ways to help? See everything you can do", to Get involved.
- The admin's events switch governs both pages exactly as it governs Get involved today: off, both are 404
  and neither is in the menu. Its wording in the admin says so.

### The menu

- "What's on" joins the menu after "Get involved" on every page except Ball pages, and the menu item
  appears only while the events switch is on. This reverses the earlier "keep the menu" because Jaimie said
  events need a place, and it fills the slot the Festive Ball item leaves. Add it with a new helper, not
  inside `addEventsNavLink`, because `decorateBallPage` calls that one and Ball pages keep their old menu.
- The footer does not change at Stage 1. The prototype's bigger footer waits until after the Ball.

### Get involved

`/get-involved`, in this order. The four ways do not appear here. It is a new page and template; the old
template moves with What's on.

1. The "What can I do?" top, with the 7,657 line and the photo. "Who we are, in one minute" is left out
   for now: that film is not in the repo and has no captions.
2. Fundraise: the crimson section, "Raise money your way, and we will help.", the live wording and four
   points, the live "Got an idea?" film (the existing file, captions and first-visit behaviour), "Fundraise for
   us", and "Already fundraising? Change your page". While fundraising is switched off this section is left
   out and the page reads on from What's on.
3. What's on: the real cards from the same renderer as `/whats-on`, the first six in the usual order, with
   the chips, and "See everything that's on". It can never disagree with `/whats-on`.
4. (From Stage 2 only: Fill a Red Bag.)
5. "Coming as a business, school or group?" with its three links.
6. "More ways to help": Volunteer, Drop-off points, Referrals, Share your story, so nobody is stranded now the
   four ways have gone.
7. "Not ready yet? Stay close." and the closing lines.

The film plays on one page only, so it never autoplays in two places: it moves to Get involved, and What's on
keeps its page without the film, since the fundraising story now leads Get involved. (TASK-567's tests move with it.)

Things that already point to `/get-involved` keep working and need checking, because the page's job has
changed: `src/fundraising/film.ts`, `thanks-email.ts`, `materials.ts`, `material-codes.ts`, the admin's
wording at `assets/js/admin/app.js` ("The page is at nbcc.scot/get-involved"), the site map
(`src/site/pages.ts`), the QR pages, and any email saying an event is "on the Get involved page". Where the
words promise an event is listed, they should point to What's on. About 25 test files mention the address.

### The short pages

New pages, built from the prototype, all under `/get-involved/` (already reserved):
`/get-involved/drop-off-points`, `/get-involved/referrals`, `/get-involved/volunteer`,
`/get-involved/business`, `/get-involved/schools`, `/get-involved/groups`.

`nbcc.scot/volunteer` and `nbcc.scot/referrals` are live forwards to the volunteer and referral sites, set up
because the client asked for them (migration `1791200000290_site-alias-subdomains.js`). They stay exactly as
they are. A real page there would silently replace them.

**Decision: no gap reaches the public.** Jaimie still owes some details. Until they arrive:

- Drop-off points: the "What to bring" and "What we can't take" note is left out.
- Referrals: the "Christmas referrals close" line is left out.
- Volunteer: the quote card is left out.
- Your business: the payroll giving line is left out, and it comes off the "Tell us" list too.
- Pictures: the "Photo to come" frames are replaced by a drawn picture or a crop of the one real photo.
- Films: the five films in the prototype are not in the repo and have no captions, so they do not ship now.
  Each "New to ...? Here's how it works" section is its words and a picture.
- "Fill Red Bags as a team", "Fill a Red Bag as a class" and "Fill Red Bags together", and their tick boxes,
  are left out: online group bags are not built, and nothing about Fill a Red Bag shows before Stage 2.

Each goes in when she sends it, as a small change. Page order, buttons and wording as the prototype.

The "Tell us" forms on the three "together" pages send through the site's existing contact path, with its spam
check, rather than a new system. If that path cannot carry them cleanly, the section becomes a button to
`/contact` and says so in the pull request.

## Stage 2 in detail

One function, one moment:

```
AFTER_BALL_AT = 2026-11-07T20:00:00Z
afterBall(now) = now >= AFTER_BALL_AT
```

Every page in question is drawn per visit, so this needs no deploy. It takes the time as an argument, so
tests can stand either side of the moment.

### What comes down

- The "Festive Ball" menu item, on every non-Ball page.
- The banner and the feature on the home page.
- The Festive Ball card on `/events` and on Get involved, even though the 7th is still "today".

**What stays:** `/ball`, its terms, its donate page, guest links and thank you pages all keep working at
their addresses. Claude's call: taking those down could break a link in somebody's email, and nothing
needs them gone at 8pm. The admin's Ball switch is not flipped: this is a separate check placed where the
promotion is decided (`src/routes/site.ts`: the home route and `decorateNav`), so the Ball's own code stays
as it is. Because Ball pages draw their own menu, they keep the Ball item.

### What appears

- The Fill a Red Bag stage on the home page, between the hero and the four tags.
- The same stage on Get involved, after What's on.
- "Fill a Red Bag" links: in the footer ("Ways to give"), added as the page goes out, non-Ball pages only;
  and on Drop-off points, in "Can't get to a drop-off point?". Never on a page in memory of someone, or on
  the sign up or the organiser's area, where a family may be and the page cannot tell as it is drawn (a
  decision from the final review: those pages stay quiet).
- The night treatment on `/fill` itself.
- On the Donate tag nothing changes: the bag has its own stage.

### The stage

As the prototype (`fill_band()`, `proto-fill.js`, the end of `proto.css`): the night sky, falling snow, ten
fairy lights (one for every £5 of the first £50), the big bag, eight tappable items, the elf's notes, the
bow, the "Packed with love" tag and the gold shower at £50, the cream snow ground with the status line, the
elves line and the main button.

- It plays itself until the first tap, then it is the visitor's, and they can fill more than one bag.
  There is a Pause button. With less motion asked for, nothing moves and tapping still works.
- **It reads the published list**, the one `/fill` uses (`rb-list-data`, loaded through the catalogue and
  `loadPublishedRedBagList`), so a price here is always the price on the real page. Staff edit this list in
  the admin, so: an item staff have hidden is left out, the demonstration keeps going round until the bag
  is full whatever the prices are, and the page must work with any list the admin allows.
- Wording comes from the catalogue and the live page. The only new words are "Go on, tap something.",
  "Carry on with this bag", "Start again" and "Pause". The elves line stays beside the prices.

### Carrying the bag through

- Until they tap, the button reads "Fill a Red Bag" and goes to `/fill`. The demonstration never carries.
- After a tap it reads "Carry on with this bag" and goes to `/fill?bag=toy:2,socks:1`. An address, not
  browser storage, so it survives a new tab and blocked storage. It holds no personal details.
- On `/fill` this lives inside `assets/js/red-bag.js`. Each key is checked against the list on the page,
  each number goes through `clampQuantity`, and anything else is ignored. Things drop in one at a time;
  with less motion they all appear at once. The address is then tidied so a refresh does not add them again.
- It only ever sets quantities on the list, exactly as tapping plus would. The checkout, the £2 minimum and
  the money path are not touched. A `?bag=` that makes no sense gives the ordinary empty page.

### The night treatment on /fill

As the prototype's `fill.html`, which is the live page with `fill-night.css` and `fill-night.js` on top. The
paper list, the examples, the steppers, the once-or-monthly choice, the round-up, the details step, the
bottom bar and the thank you all stay as they are. The look changes: the night sky, snow, lights, the bag
standing in the snow on top of the panel, a red bag from the start with the brighter red rising inside it,
the sum on the bag, and "Pause the snow".

- Claude's call: before 8pm `/fill` looks as it does today, even though it can be reached.
- A staff draft preview (`/fill?preview=draft`) keeps working.
- `/fill/thank-you` is left as it is.

### Checking Stage 2 before the night

Claude's call: visiting any of these pages with `?at=after-ball` shows the 8pm state, so Jaimie can check it
on her own phone and we can check the real pages. Nothing in it is secret: Fill a Red Bag is already public.
It changes that one page view and nothing else, and carries no search listing.

## Order of work

Each is its own task and pull request, reviewed independently, stacked in this order, and none merges without
Jaimie's yes on screenshots.

1. What's on at `/whats-on`, the menu item, and the new Get involved (without the stage).
2. The short pages.
3. The new top of the home page and the four tags.
4. Stage 2, dormant until the moment. It should be live by Thursday 5 November so there is time to check it.

Another session is working on the Ball (PR 701, task 577) and the site's icon (PR 699, task 575). Re-check for
overlap before each merge.

## After the Ball

The Festive Ball wording and footer tidy-ups already on the after-the-Ball list stay there. Once the Ball has
passed, the time check and the things it hides can be removed in a tidy-up, and Ball pages can take the new
menu and footer.

## Left to the builder

File layout, how the shared event cards are drawn for two pages, how the stage's styles are split for the page
weight budget, test structure, and which of the many tests naming `/get-involved` need to change.

## Calls made while Jaimie was asleep

The reviewer raised these and she had said to go ahead, so Claude took the safer choice each time. Any can change.

1. What's on keeps today's flip cards, not the prototype's stub cards. Get involved shows the first six.
2. Short pages live under `/get-involved/`, so the forwards at `/volunteer` and `/referrals` are untouched.
3. What's on lives at `/whats-on`, not `/events`, because browsers have kept the old redirect.
4. The five extra films do not ship yet: no captions, and not in the repo.
5. "Donate now" and "What we do all year" stay on the home page.
6. The events switch governs What's on and Get involved together. Fundraising off drops only that section.
7. The footer stays as it is, except "Fill a Red Bag" at Stage 2.
8. The "Fill Red Bags together" lines are out until group bags exist.
