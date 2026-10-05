# Fill a Red Bag: design (half 1, the public page)

Agreed with Jaimie (NBCC) on 3 and 4 October 2026, one question at a time. Half 1 is the public
page, shipped switched off. Half 2 (staff editing in the admin, the Red Bag receipt email, a report
column) waits for the admin and email work other sessions are doing.

## What it is

A new, playful way to give money. The donor fills a list of example items, sees a red bag fill up,
and gives the total. Nothing is bought item by item: the items are examples of what a gift could do.

## The rules it must keep

- "Could", never "will" (Code of Fundraising Practice; OSCR). An appeal that reads as collecting for
  one named thing risks creating a restricted fund, so every gift is plainly for general funds.
- The line near the Donate button, word for word (Jaimie's choice): "Our elves use your gift wherever
  it's needed most, so the items are a taste of what it could do, not a shopping list."
- Who it is for, word for word: "children, young people and vulnerable adults".
- All year round. It is not a Santa's list. Christmas is the focus, not the only moment.
- Consistent with /donate: around £50 is the value of one Red Bag Full of Joy.
- No inner scrollbars. Phone width works. The repo is public: invented fixtures only.

## The page

Address: `/fill` (Jaimie, 4 October 2026). Name: "Fill a Red Bag". The thank you is a page of its
own under it, `/fill/thank-you`. The address the page first had, `/fill-a-red-bag`, and the other
way people type it, `/fill-a-bag`, forward to `/fill` for good (301), keeping any query string, in
any case and with or without a trailing slash, and only exactly; an old return from paying
(`/fill-a-red-bag?thanks=1&session_id=...`) goes to `/fill/thank-you` instead, so that donor still
lands on a thank you. `/fill` is exact too: it takes nothing else that begins "fill". The forwards
are fixed in code like `/getinvolved` and `/involved`, not rows in the spare address table; all
three addresses are reserved so a spare address cannot take them. Everything follows the switch:
switched off, all of them are the site's ordinary 404 to the public.

Layout as the signed-off chat mock-up:

1. Intro: eyebrow, heading, one short lede.
2. The list, drawn as lined paper (handwriting only on the paper and, since the feel good layer,
   on the gift tag of a full bag, like NBCC's printed Donation
   ideas sheet: Caveat, self hosted with its licence, loaded by this page alone; Jaimie approved it
   on 4 October 2026). Items grouped under the sheet's own headings. Each row: name, price, a big minus
   button, a number box you can also type in, a big plus button. Typing updates the total at once;
   no Enter needed. Quantities 0 to 99.
3. The bag panel: the bags, a status line, the total, the round-up button (below), a small label
   "How often?" over two buttons side by side, "Give once" (chosen to begin with) and "Give
   monthly", then the Donate button, the nudge line, and the elves line. The two buttons replaced a
   tick on 4 October 2026 and follow the donate page's once or monthly buttons (a named group, each
   button saying whether it is pressed, the chosen one in holly green with a tick). Donate reads
   "Donate £31" for once and "Donate £31 every month" for monthly ("Donate" while the bag is
   empty). Everything after it is what the tick did. A monthly amount is worded "£31 every
   month" wherever the donor reads it on this page, never "a month" (4 October 2026): the total,
   Donate, the details step's summary, the pay button ("Donate £31 every month") and the thank
   you. The choice is kept when coming back from the details step.
   The bottom bar: the total and Donate scroll out of sight down a long list, so a slim bar fixed
   to the foot of the screen shows "Your bag £18" and a Donate button. At EVERY width, computers
   included (4 October 2026). It hides once the real total and Donate are on screen (nothing is
   doubled), over the footer, on the details step and the thank you, and while the total is £0.
   Its Donate does exactly what the main Donate does (under £2 it shows the nudge and brings it
   into view). The strip spans the screen, but what is in it stays within the page's width, in
   line with the page; on a computer the total sits beside its button at the right, under the
   bag's column. While it shows the page is longer by its height, so it never covers the end of
   the page. A keyboard tabbing down the list never has the control it is on brought to rest under
   the bar (the stylesheet's scroll padding), and pressing the bar's Donate under £2 hands the
   focus to the real Donate button. Not a live region.
4. "Whenever the need comes", introduced word for word: "Christmas is our big night, and the need
   comes all year round. Tap an example to add it to your bag, and tap it again to take it out."
   Three themes, three examples each. Tapping an example adds it to the
   same list as a line under "Also in your bag", with a remove control; tapping again takes it off.

   Where things sit (4 October 2026, so the themes are less hidden). The page's own order is the
   phone's: the list, then the themes, then the bag panel with Donate, then the real items note.
   On a desktop (from 861px) the stylesheet places the bag panel at the top of the right hand
   column and the themes directly under it, stacked one under another at the column's full width,
   beside the long paper. Nothing is moved by script, nothing sticks, nothing scrolls inside a box.
   A keyboard therefore goes list, themes, bag panel, in both layouts.
5. A small note, word for word: "Prefer to give the real thing? We would love that. Find a
   drop-off point near you." with "Find a drop-off point near you" linking to https://drop.nbcc.scot
   (opening as the site's other outside links do). That address did not resolve on 3 October 2026;
   Jaimie confirmed it live on 4 October 2026. The link is kept in one constant with a switch
   beside it: switched off, the note shows the phone number the site already prints and no link.
6. After Donate: a short "your details" step, the same asks as the fundraiser page give form (name,
   email, Gift Aid declaration, cover the card fee for one-off gifts, email consent). Then Stripe.
7. Back from Stripe: the thank you, which is a PAGE OF ITS OWN at `/fill/thank-you` (Jaimie, 4
   October 2026: "surely there should be a thank you page"). The site's header and footer; the
   eyebrow "Thank you"; the page's one big heading IS "Thank you for filling a Red Bag", and the
   focus lands on it. Nothing of the giving page: no list, no bag panel, no themes, no "A new way
   to give", no bottom bar. Then, in this order, in a calm centred column (a moment, not a card):
   the tied red bag; "Your donation of £54.10 is on its way to NBCC." (monthly: "£31 every
   month"); the Gift Aid line when they added Gift Aid; the elves line word for word; word for
   word "Your receipt is on its way to your inbox. Thank you for being part of this."; "Share: I
   filled a Red Bag", a picture with no amount and the share controls, all pointing at
   https://nbcc.scot/fill; and a "Fill another bag" button back to `/fill`, quieter than the share.
   The total and the Gift Aid figure come across in the browser tab's memory, for show only;
   missing or odd, or opened without paying, it is the plain "Your donation is on its way to
   NBCC." The same rules as the giving page (the switch, the staff preview), except that it is
   never indexed, on no site map and linked from nowhere but Stripe's return.
   No itemised list anywhere (it would read as a shopping receipt).

### The thank you's feel good pieces (agreed with Jaimie, 5 October 2026)

Rules over everything: never imply the items were bought or go to a particular person; no pressure,
guilt or upsell; nobody is ranked or given a title (donor titles were dropped); dignity for the
people NBCC helps. Nothing typed is sent anywhere; no new endpoint, table, library or sound.

1. **Watch it leave the Workshop.** The top of the thank you is a little scene instead of a still
   bag: an elf lifts the tied bag onto the shelf beside the others, the Workshop light goes down to
   a glow (dusk, not dark), and a line appears in the paper's hand, word for word: "Bag packed. The
   elves will take it from here." One inline drawing, for the eye only; it plays once on arrival
   after a gift (about four seconds, transform and opacity only), then rests. Less motion asked
   for, or no remembered gift: shown at rest, no lift. The elf is a small figure seen from behind
   (pointed red hat, ears, green tunic), in the catalogue drawings' style; not the logo's artwork.
   The donor's bags on the shelf: one for each full £50 of the remembered total, one to five. No
   "Play again". The line is the page's one "will": it is about the elves, and promises nothing
   about what the money buys.
   Bigger and richer (Jaimie, after the first screenshots, 5 October 2026): the scene is the
   page's centrepiece, the column's width (about 620px on a desktop, 16 to 10). In it, as she chose:
   shelves full of bags and gifts (two long shelves and a short one: tied Red Bags, a teddy, a stack
   of books, a folded blanket, wrapped presents, a toy train), with the gap for the donor's bag on
   the reaching shelf; a window with snow falling (a night blue, #26355C, a few stars; the snow
   drifts down once and settles); and a Christmas tree with fairy lights that STAY softly lit when
   the lamp goes down, twinkling once as it does. No clock. Simpler at phone width, not smaller
   and muddier.
2. **A share picture with their name.** An optional box above the picture, "Add a name to your
   picture (optional)", hint "A first name, a family, a class or a workplace. It goes on your
   certificate too, and it never leaves this page." The picture reads "<Name> filled a Red Bag" (or
   "<Name> filled 2 Red Bags" for £100 and up); empty, "I filled a Red Bag". 30 characters, trimmed;
   a long name shrinks or takes its own line. Screened in the browser against the supporter wall's
   own word list, drawn into the page by the server; refused: "Please choose a different name." and
   the plain picture. The share controls are unchanged and share the picture as shown. The sentence
   over the picture is honest about it: "It shows no amount, only that you filled a Red Bag.", or
   only while the picture itself counts the bags (a name, and two bags or more) "It shows no
   amount, only how many bags you filled." Nothing made from the
   name may reach the site's visit counter either: "Save the picture" points at a blob, never at
   the picture's own bytes.
3. **A certificate to print.** "Print your certificate": one upright A4 page, printed by the
   browser from a hidden part of the page. The NBCC logo; "Certificate of thanks"; "This certificate
   is presented to"; the name; "for filling a Red Bag Full of Joy" (or "for filling N Red Bags Full
   of Joy"); a tied bag; "Thank you for being part of this." in the handwriting; two
   signatures in that hand, "The Elves" over "The Elves' Workshop" and "NBCC Team" over "Night
   Before Christmas Campaign" (the second added by Jaimie); the date ("5 October 2026"); the charity's
   statement as on every printed piece. No amount. No name yet: "Add a name above first, and it goes
   on your certificate." One page whatever the browser: it sizes itself to the printable page, and
   no clock ends the print (a phone's preview may be open for a long time).

Order on the page: eyebrow and heading; the Workshop and its line; the donation, Gift Aid, elves
and receipt lines; the share (name box, picture, controls); "Print your certificate"; "Fill another
bag".

### The bags

Draw NBCC's real Red Bag: a red paper gift bag with cord handles (see
`assets/img/home-red-bags-handover.jpg`), not a sack. One bag fills towards £50. Each full bag stays
on screen and the next starts beside it; draw at most five, then say "and N more". Motion is gentle
and off under `prefers-reduced-motion`.

Status line: empty ("Your bag is empty. Pop something in."), under £2 (the nudge), then "starting to
fill", "about a quarter full", "about half full", "about three quarters full", "nearly full", then
"That's around the value of a whole Red Bag Full of Joy." (or "N Red Bags"), plus "Another one is
filling." when there is a remainder.

### The round-up (Jaimie's idea, 4 October 2026)

ONE button in the bag panel, under the total and above "How often?", offering the NEXT milestone
only, with the amount it adds, for example "+ £7 Round up to half a bag" at £18:

- above £0 and under £25: "Round up to half a bag";
- from £25 and under £50: "Round up to a full bag";
- from £50: "Round up to 2 full bags", then 3, 4 and so on: always the next whole bag;
- at £0 there is no button. The milestone offered is always above the total shown, so a total
  sitting exactly on one is offered the next.

Pressing it adds a line under "Also in your bag": "A little extra to round up", its amount, and a
Remove. It is simply extra money: it is never described as buying anything.

The round-up keeps its TARGET, not an amount. If the donor adds items or examples the extra shrinks
so the total stays at the target; if they take things out it grows back. When their own items reach
or pass the target the line goes, the button offers the next step, and the target is FORGOTTEN
(Jaimie: "if their items pass £25 on their own, the top-up disappears and the button offers the
next step"): taking things out afterwards does not bring the old round-up back. After rounding
up, the button offers the step after it, and pressing that REPLACES the round-up: two are never
stacked. Remove clears it for good.

A round-up never stands alone (4 October 2026). When the donor's own choices (list items plus
tapped examples) come to £0 the round-up is cleared and the total is £0; it does not come back when
something goes in again, and the button is not offered on an empty bag.

Both lettings go (emptied, and passed) happen on a FINISHED change only: a plus or minus, an arrow
key, a number box left, an example, Remove. While a number is still being typed the sums follow
what is in the box, but the target is kept, so emptying a box on the way to a new number, or a
number half typed, does not throw the round-up away. Leaving the box empty clears it.

The bags, the status line, the Donate button, the phone bar and the amount sent to the checkout
all follow the total including the round-up. The sums are whole pence, pure functions in the one
catalogue module (`nextMilestone`, `roundUpOffer`, `roundUpPence`).

### The feel good layer (4 October 2026)

Agreed with Jaimie idea by idea. The aim, in her words: "make people feel great for giving". The
rules that override everything: never imply the items are actually bought or go to a particular
person; no pressure, guilt or urgency; nobody is ranked or given a title; dignity for the people
NBCC helps. It is ALL decoration: no price, total, round-up sum, minimum, checkout field or existing
word changes, and it makes no network request and loads no file of its own.

1. The item drops into the bag. When a quantity goes up, a small drawing of that item hops from its
   row and drops into the bag that is filling. One drop for a typed jump (0 to 10 is one, played
   when the typing stops or the box is left). Three in the air at most: a tap beyond that plays no
   drop, so nothing queues. While the bag is off screen (a phone part way down the list) the drop
   heads into the bottom bar's total instead, which gives a small nod. Examples and the round-up
   drop no picture: they are money, not items. Things then peek out of the top of the bag that is
   filling: only things that are in the bag, one under a quarter full, two under half, three from
   half. They are drawn behind the bag's front so they look inside it.
   Changed 5 October 2026 (Jaimie: "the prizes at the top of the bag should be the last (latest)
   item(s) to be added, not the first"): the peeks are the MOST RECENTLY added things. The newest
   is in the front place (the left hand one, a touch taller, and drawn on top), then the one before
   it, then the one before that. "Added" is a quantity going up: a plus, an arrow key, or a typed
   number once the typing has stopped or the box is left. Adding more of an item already in the bag
   makes it the latest again. Taking one out of an item that still has some left changes nothing;
   taking the last one out removes its peek and the next most recent takes the free place. Each
   item peeks once at most. The bags are one bag: when a new one starts filling after a full one,
   it shows the latest things overall. When a new thing arrives it pops up in the front place, the
   ones that stay slide along one place, and the oldest sinks back into the bag (transform and
   opacity, under 300ms; at once under reduced motion).
   Bigger, the same day (Jaimie: "make items a bit bigger and stand out a bit more"): each peek is
   drawn about a third bigger than the 28 units it was (the newest about 40, the others about 37
   and 36, in a bag 120 wide) and stands higher out of the bag (the newest 28 units above the rim,
   the others 23 and 22; it was 16), with a heavier outline (2, where the drawings elsewhere have
   1.5) so cream pyjamas or a white page still show against the pale panel. No shadow, glow or
   gradient. They are still drawn behind the bag's front, and stay inside the bag's own picture, so
   they cannot reach a neighbouring bag's ribbon or tag, the status line or the panel's edge, and
   the panel is the same height with or without them (measured at 320, 390, 860, 861, 1024 and
   1280). The blanket was redrawn too (Jaimie did not like two rolled red shapes): a neatly folded
   blanket, three soft folds with their rounded edges down the left, in a simple check (thin cream
   lines both ways and a gold one), a bound edge and a fringe down the right, which is the side that
   shows when it peeks. No other drawing changed.
2. An elf scribbles on the paper: a short handwritten note (Caveat, holly green, a slight tilt) on
   the ruled line above the row just changed (below it for the first row under a heading), or beside
   the new line under "Also in your bag" for an example. One at a time; it fades after about three
   seconds or when the next one appears; it lies over empty paper only, takes no tap and shifts
   nothing. Quick taps on one row keep the note that is there. It never lies over an item's name,
   a price, a heading or a control (5 October 2026, after measuring in a real browser showed a long
   note could touch a neighbouring row's words where a name wraps, an example's line runs to two
   lines, or the rows are tight on a small phone): the script measures the real ink of the words on
   the paper and the boxes of the buttons, and tries the note across the rule above the row, then
   the one below, then smaller (0.94rem), then smallest and level (0.86rem), keeping 2px clear; the
   first row of a group only ever has it below. If nowhere is clear, no note is written that time. ALL the notes are one list, `NOTES`
   in the catalogue: at least two per item, general ones, the first thing in, several of one thing
   ("10 pencils? You legend."), taking something out (kind, never guilt), and an example. They never
   say anything is bought or that anyone receives it, never "will", never press, have no dashes or
   hyphens, are British, and are 32 characters at most (so each fits on one line at 320px).
3. The bag reacts: a small wobble when something goes in, and the handles pull a touch tighter when
   it is nearly full (from 88%, as the status line says "nearly full").
4. At a full bag: a gold ribbon ties the handles and a gift tag swings out reading "Packed with
   love" (Caveat). Every full bag keeps its ribbon and tag; the words are on the newest full bag
   only, and on none once four or five bags are drawn (too small to read). Below a full bag they
   come off.
5. A burst of snow and stars at half a bag and at each full bag, then removed. Only when a
   milestone is newly crossed on the way up (so again only after the total has dropped below it),
   one at a time, taking no tap.
   Changed 5 October 2026 (Jaimie: "make the star moment across the entire page: a bigger
   moment"): it falls over the WHOLE screen, not the bag's panel. One layer on the page's body,
   fixed to the screen above the page, the site's header and the bottom bar (and under the payment
   window), `pointer-events: none`, `aria-hidden`, taken out of the page when it ends. So it is
   seen on a phone too, where the bag is usually off screen, and it can never block a tap, a scroll
   or Donate. Paper white snowflakes and gold stars fall from the top of the screen to the bottom,
   spread across the full width, each with its own size, drift, turn and short wait, with a few
   larger stars. A FULL bag (and each further full bag) is the big moment: 56 pieces, the last gone
   by about 2.9 seconds, 5 larger stars. HALF a bag is a lighter one of the same kind: 24 pieces,
   about 2 seconds, 2 larger stars. On a screen under 600px wide: 34 and 16, a little smaller.
   Never more than sixty. A full bag reached while half a bag's snow is still falling takes its
   place; otherwise a second one never starts while one is falling. A cooldown: the same milestone
   cannot snow again within 20 seconds (someone stepping back and forth across £25), though a
   different milestone still can. Each piece is one CSS animation of transform and opacity, easing
   out with no bounce; no canvas, no loop, no sound. It stops at once if the donor moves on to
   their details. Under reduced motion there is none at all.

A small icon sits in each of the nine example buttons (Jaimie: "an icon next to each of the after
crisis/clothing/rock bottom items: teddy bear, bed, shoes, coat etc"), drawn into the page by the
server, and again at the start of the example's line under "Also in your bag": a teddy bear, a bed,
a cooking pot; a pair of shoes, a coat, a school jumper with a collar and tie; soap and a
toothbrush, a toolbox, a cooker. Pressed, its lines turn light on the green. The button's words and
name are unchanged.

How it is built. The 22 drawings (13 items, 9 examples) are inline SVG in ONE place, `ART` in the
catalogue, with no colour of their own (the stylesheet gives them the site's tokens; the gold is
`--gold-ink`). The choices are pure functions in the catalogue (`peekOrder`, `latestPeeks`,
`peekCount`, `milestoneCrossed`, `flurryKind`, `flurryDue`, `flurryPlan`, `strains`, `noteKind`,
`noteFor`, `allNotes`, `notePlacements`, `quadTouches`); the page script only applies them. (`peekSlots`, which kept the earliest
things peeking, went on 5 October 2026.) Everything decorative is `aria-hidden`, out of the tab order, and never takes the focus; the
one live region is untouched. Motion is transform and opacity only, nothing loops, every animated
thing is removed by a timer, and under `prefers-reduced-motion` nothing moves: no drop, wobble,
flurry or swing, while the peeks, the ribbon and tag and the note still appear at once. Nothing
plays on the details step. The thank you page is untouched.

It can never stop the page working. The whole layer is switched off unless the catalogue has every
part of it (during a deploy a donor can be handed the new page script with the old catalogue), and
every way into it from the page's own code is wrapped: anything that goes wrong in it is swallowed
and said once in the console, and the total, the status line, Donate and the checkout carry on. A
note on one row keeps its moment (0.9 seconds) whatever its kind, and the newest change is written
when that is up. The drop into the bottom bar flies inside the bar, so it is seen to land.
The drawings Jaimie chose (4 October 2026): the soft toy is a bear, the toy a little train, the
toiletry set a perfume bottle with its spray, and the winter coat a child's hooded puffer.

### Money rules

- One running total: items plus tapped examples plus the round-up. One Donate button.
- £2 minimum. Below it the button stays enabled and pressing it shows the friendly nudge:
  "Add a little more to reach £2. Maybe some socks?"
- One-off by default. "Give monthly" turns the total into a monthly gift (no fee cover on monthly,
  as on /donate).
- Gift Aid as on the other give forms.

## The list (prices, agreed)

Home comforts: Blanket £8; Insulated cup £7; Toiletry & fragrance gift set £5.
Play & downtime: Toy £15; Soft toy £4; Headphones £9.
Books & creativity: Book £3; Colouring book £2; Pencil 10p; Notebook £1.
Clothing: Pyjamas (ages 13 & under) £5; Socks (pair) £1; Hat & gloves £4.

One of everything is £64.10. (The Toy started at £5 and became £15 on 5 October 2026; every other
price is as first agreed.)

## The themes (agreed)

Three, in this order. A fourth, "Red Bags Full of Joy" (£10, £25, £50), was taken out on 4 October
2026: the donor is already filling a bag from the list, so its examples said the same thing twice.

- After a crisis, "Helping families start again": £15 could help replace a child's favourite cuddly
  toy; £30 could help with fresh bedding for a child; £60 could help a family with kitchen basics
  to start again.
- Clothing & school, "When families can't stretch to it": £25 could help with a pair of school
  shoes; £35 could help keep a child warm with a winter coat; £40 could help a child start school
  in a uniform that fits.
- A hand at rock bottom, "When it matters most": £20 could help with toiletries and warm clothes in
  a hard moment; £75 could help a young person take their first step into their own business; £150
  could help towards a bed or cooker for someone moving into a home with nothing.

## The switch, and what search engines see

One constant in code, `RED_BAG_LIVE`. It is ON (4 October 2026: "make it public but don't link
anywhere to it right now").

Search engines may list the giving page from the day it is live (Jaimie, 4 October 2026: "once it's
pushed and live I don't mind if Google crawls it"). So `/fill` is in the site's page list (on the
site map page and in `sitemap.xml`, with staff's usual per page search visibility choice), carries
no `noindex`, and has what the site's other listed pages have: a title ("Fill a Red Bag | Night
Before Christmas Campaign"), a description (Jaimie's choice: "Pop a few things in a Red Bag and watch it
fill. A new way to give to NBCC, showing what your donation could do for children, young people and
vulnerable adults, all year round."), a canonical link to
https://nbcc.scot/fill, and the share card with the site's one share picture. The thank you page is
never indexed and on no site map. The forwards stay 301s.

It is still LINKED from nowhere: not /donate, not the menu, not the footer, not any page. What is
left for when Jaimie says: add the link from /donate and the menu. Nothing else.

Setting the constant back to off takes it down again: the public gets the site's normal 404 at
every one of its addresses, the page leaves the site map, a signed-in member of staff sees either
page with a plain "Staff preview: not public yet" strip (never indexed), and the checkout refuses a
Red Bag gift from the public.

## What half 1 must NOT touch (other sessions are working there)

- No migration. No database table or column.
- Nothing in `admin.html`, `assets/css/admin.css`, `assets/js/admin/**`, or any admin route.
- No email file: not `src/fundraising/emails.ts`, not the receipt or thank-you emails.
- No new config value, no infra.
- No behaviour change for /donate, fundraiser pages, the Ball, or the Stripe webhook's handling of
  any existing gift.

## The one shared change: the checkout

`POST /api/checkout-session` gains one optional marker, `redBag: true`:

- only then: amount at least 200 pence; never together with `fundraiserId`;
- the session's metadata gains `redBag: "true"` (a /donate session gains no keys at all);
- the return addresses are worked out by the server (success, and the embedded checkout's return,
  to `/fill/thank-you` with the session id; cancel returns to `/fill`), never taken from the
  browser;
- while switched off, accepted only from a signed-in member of staff.

The webhook records the gift exactly as a normal donation and sends the normal receipt. Half 2 adds
the Red Bag receipt wording and a "came from Fill a Red Bag" figure in the admin.

## Recording where a gift came from (5 October 2026)

The record keeping for that figure, built ahead of it. No admin screen, report, email or page change.

- **One additive column**: `donations.source`, nullable text, no default, no check constraint
  (migration `1791200000250_donation-source.js`). `'red_bag'` for a gift started on Fill a Red Bag;
  empty for every other gift and for every gift recorded before. The allowed values are one list in
  the code (`DONATION_SOURCES`), for the figure to share.
- **Saving a donation does not change.** The donation's `INSERT`, its transaction, the idempotency
  ledger, Gift Aid, the fundraiser logic and the emails are as they were, and do not name the
  column. After the transaction has committed and the emails have gone, and only when the
  session's metadata has `redBag: "true"`, one separate statement marks the row by its Stripe
  session id, and only if it has no source yet.
- **Best effort, always.** Any failure writing the source is caught and logged once (the Stripe
  event id and the database's error code, nothing personal), and never changes the webhook's
  answer, so Stripe never retries because of it and no donation can be lost to it. The cost of a
  failure is one gift without a source.
- **Two seconds at most.** A source statement still waiting after 2 seconds is given up: logged
  once, Stripe answered as normal, and that one database connection closed rather than reused
  (the statement may still be running on it).
- **Redelivery**: nothing is saved twice; the source is tried once more, which heals a first
  delivery that stopped between saving and marking, and changes nothing otherwise.
- **Monthly gifts**: the first donation is marked from its checkout. When a later charge is
  recorded, every donation of that subscription still without a source takes `'red_bag'`, if the
  subscription's first donation has it. A report that wants to be certain can also join on
  `stripe_subscription_id`.
- **Earlier gifts** (4 October 2026 onwards) are not marked: Stripe's payloads are not stored, so
  they can only be listed from Stripe (Checkout Sessions with metadata `redBag: "true"`) and
  marked by session id with the same statement. Written up in the README; not run.

## Where the list lives

One module holding the items, groups, themes and the £50 bag value, with pure functions for the
total, the bag count and fill, and the status line, so the page script and the tests share one
source of truth and half 2 can move the data to the admin without touching the page's behaviour.

## Staff editing of the list (5 October 2026)

Agreed with Jaimie point by point, and built as half 2's first piece. The README section "Fill a
Red Bag: staff edit the list" is the full account of how it works; this is what was decided.

**What staff can change.** An item's price, name, order under its heading, which of the four
headings it sits under, its picture, and whether it shows. New items: a name, a price, a heading and
a picture chosen from the drawings there already are or a plain wrapped present (one new drawing,
`present`; no uploading). Under each of the three themes, each example's amount and words, its
order, its picture, whether it shows, and new examples. The page always writes the amount and
"could help" itself: staff type only what follows, so nothing can be published that does not read
"£X could help ...".

**What they cannot.** The £50 bag, the £2 minimum, the four headings, the three themes and their
descriptions, the elf's notes, the drawings themselves, and any other wording on the page.

**Draft, preview, publish, history.**

- Every change is saved to ONE shared draft. Nothing changes for the public until someone presses
  Publish.
- The editor says plainly what differs between the draft and the website, and how many changes
  there are.
- Preview the page opens the real `/fill`, drawn from the draft, for signed in staff with view of
  this section only. It carries a strip, "Draft preview: not on the website yet", is never cached
  and never indexed, and GIVING IS SWITCHED OFF in it: Donate does nothing but say "This is a
  preview. Giving is switched off here.", so a preview can never take money for a list the public
  cannot see.
- Publish makes the draft the website's list, after a confirm that repeats the changes. Throw away
  changes drops the draft, after a confirm.
- Every publish is kept, with who, when and what changed. Any earlier list can be looked at and put
  back AS A DRAFT, so it is still previewed and published like any change. The list written in the
  code is always at the foot of the history as "The original list", and can be put back too.
- Two people at once: the draft carries a stamp. A save against a stale stamp is refused with
  "Someone else has changed the draft. Reload to see their changes." and nothing is lost on the
  server.

**Who.** A new access section, "Fill a Red Bag", on Team > Manage access: view to see the editor,
the differences, the history and the preview; edit to save, publish, throw away or put back. Admins
have it. Nobody else does until it is given to them, and nobody's other access changes.

**Guard rails**, on the server on every save and again on publish, and in the browser as it is
typed. A price is whole pence from 10p to £500; an example's amount from £1 to £1,000. A name is 1
to 40 characters; what follows "could help" up to 90. Plain text only. Never "will", never "buy",
"buys" or "bought", no en or em dash. At least one item showing; no two items showing with the same
name; 30 items at most and 6 examples in a theme. Keys are unique and never change. A heading with
nothing showing is not drawn on the page, nor is a theme.

**Storage, and the safety of the public page.** One additive migration: a table of list versions
(one draft at most; every published list kept). No row is seeded: until someone publishes, the page
uses the list in the code exactly as before. The page's read of the list is kept for a minute, is
read again at once after a publish, and never throws: if the database cannot answer, or what is
stored fails the rules, the page uses the last good list, or the list in the code. The server
draws the list into the page as rows, as before, and beside them a small block of data that the
catalogue script reads as it starts; with no block, or a wrong one, the script keeps its own list.
The checkout is not changed: it still checks only the total. Publish, throw away and put back are
each written to the audit log; saving the draft is not.

**Chosen along the way** (each for Jaimie to overrule):

- The section's key is `red-bag` (the other keys use hyphens), and it is admins only by role, like
  Analytics: editors and viewers do not get it with their role.
- An item or example on the website can be hidden but not deleted, so its key and its history are
  never lost. Something added and not yet published can be removed. The server enforces it on every
  save and on publish ("An item that is on the website can be hidden, not removed."); putting an
  earlier list back is the one way anything leaves the website's list.
- Every item, not only a new one, can be given another picture.
- An item staff have renamed gets the elf's general notes only, not the ones written about its old
  name.
- The 90 characters are counted on what staff type, after "could help".
- A draft is never started from a website list that someone has replaced since the screen was
  opened: that save is refused as stale too.
- The preview's own address, `/fill?preview=draft`, is never cached or indexed even on a plain
  visit, because one address answers two ways.

## Testing

- Unit: totals in pence (no float drift: 10p pencils), bag count and fill at the edges (0, 199, 200,
  4999, 5000, 5410, 25000+), the round-up at its edges (1p, 199, 200, 2499, 2500, 2501, 4999, 5000,
  5001, 9999, 10000; shrink, grow, go, replace, cleared by an emptied bag; what is sent equals what
  is shown), the short addresses (301, query kept, exact, following the switch), status wording, the checkout schema rules, the off/on/staff gate, the
  server-built return addresses, the wording rules (no "will", the elves line and the audience
  phrase present word for word). The feel good layer: its pure functions, every note against the
  wording rules, and the script in jsdom (`test/unit/red-bag-delight.test.ts`,
  `test/unit/red-bag-delight-script.test.ts`).
- BDD: the page is a 404 to the public while off; a Red Bag checkout under £2 is refused.
- By hand in a real browser: phone (390 and 320) and desktop, keyboard only, reduced motion, no
  inner scrollbars. Screenshots for Jaimie before anything ships.
