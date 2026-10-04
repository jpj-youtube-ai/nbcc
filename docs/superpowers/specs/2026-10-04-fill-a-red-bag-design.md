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

Address: `/fill-a-red-bag`. Name: "Fill a Red Bag". Layout as the signed-off chat mock-up:

1. Intro: eyebrow, heading, one short lede.
2. The list, drawn as lined paper (handwriting only on the paper, like NBCC's printed Donation
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
   empty). Everything after it is what the tick did: the pay button still reads "Donate £31 a
   month". The choice is kept when coming back from the details step.
   On a phone the bag is below a long list, so a slim bar fixed to the foot of the screen shows
   "Your bag £18" and a Donate button while the list is scrolled. It hides once the real total and
   Donate are on screen (nothing is doubled), over the footer, on the details step and the thank
   you, and while the total is £0. Its Donate does exactly what the main Donate does (under £2 it
   shows the nudge and brings it into view). Never at desktop widths; not a live region.
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
7. Back from Stripe: "Thank you for filling a Red Bag" with the total, a Gift Aid line when they
   added Gift Aid, the reassurance line (the elves line), then word for word "Your receipt is on
   its way to your inbox. Thank you for being part of this.", and a "Share: I filled a Red Bag"
   picture with no amount.
   No itemised list anywhere (it would read as a shopping receipt).

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
or pass the target the line goes and the button offers the next step; if they then take that item
out again the line comes back (a plus followed by a minus leaves the bag as it was). After rounding
up, the button offers the step after it, and pressing that REPLACES the round-up: two are never
stacked. Remove clears it for good.

The bags, the status line, the Donate button, the phone bar and the amount sent to the checkout
all follow the total including the round-up. The sums are whole pence, pure functions in the one
catalogue module (`nextMilestone`, `roundUpOffer`, `roundUpPence`).

### Money rules

- One running total: items plus tapped examples plus the round-up. One Donate button.
- £2 minimum. Below it the button stays enabled and pressing it shows the friendly nudge:
  "Add a little more to reach £2. Maybe some socks?"
- One-off by default. "Give monthly" turns the total into a monthly gift (no fee cover on monthly,
  as on /donate).
- Gift Aid as on the other give forms.

## The list (starting prices, agreed)

Home comforts: Blanket £8; Insulated cup £7; Toiletry & fragrance gift set £5.
Play & downtime: Toy £5; Soft toy £4; Headphones £9.
Books & creativity: Book £3; Colouring book £2; Pencil 10p; Notebook £1.
Clothing: Pyjamas (ages 13 & under) £5; Socks (pair) £1; Hat & gloves £4.

One of everything is £54.10.

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

## Switched off until Jaimie says

**4 October 2026: made public but unlinked, at Jaimie's request** ("make it public but don't link
anywhere to it right now"). The constant is now ON: anyone with the address gets the page and can
give. It is still linked from nowhere (not /donate, not the menu or footer), on no site map, and
`noindex`. What is left for when Jaimie says: add the /donate link, then list the page and take the
`noindex` out. Setting the constant back to off takes it down again exactly as described below.

As first shipped: one constant in code (default off). While off: the public gets the site's normal 404; a signed-in
member of staff sees the page with a plain "Staff preview: not public yet" strip. Not linked from
/donate or the menu, not in the sitemap, `noindex`. The checkout refuses a Red Bag gift from the
public while off. Going live later is one small change: flip the constant, add the /donate link,
list the page.

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
- the return addresses are worked out by the server (back to `/fill-a-red-bag` with a thank-you
  flag and the session id; cancel returns to the page), never taken from the browser;
- while switched off, accepted only from a signed-in member of staff.

The webhook records the gift exactly as a normal donation and sends the normal receipt. Half 2 adds
the Red Bag receipt wording and a "came from Fill a Red Bag" figure in the admin.

## Where the list lives

One module holding the items, groups, themes and the £50 bag value, with pure functions for the
total, the bag count and fill, and the status line, so the page script and the tests share one
source of truth and half 2 can move the data to the admin without touching the page's behaviour.

## Testing

- Unit: totals in pence (no float drift: 10p pencils), bag count and fill at the edges (0, 199, 200,
  4999, 5000, 5410, 25000+), the round-up at its edges (1p, 199, 200, 2499, 2500, 2501, 4999, 5000,
  5001, 9999, 10000; shrink, grow, go, replace; what is sent equals what is shown), status wording, the checkout schema rules, the off/on/staff gate, the
  server-built return addresses, the wording rules (no "will", the elves line and the audience
  phrase present word for word).
- BDD: the page is a 404 to the public while off; a Red Bag checkout under £2 is refused.
- By hand in a real browser: phone (390 and 320) and desktop, keyboard only, reduced motion, no
  inner scrollbars. Screenshots for Jaimie before anything ships.
