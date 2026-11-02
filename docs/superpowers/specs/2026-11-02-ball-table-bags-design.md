# Festive Ball: a table QR code to fill red bags on the night

Status: approved by Jaimie, 2 November 2026 ("This is exactly what I'm looking for ... go ahead and
build all this"). The Ball is Saturday 7 November 2026 at The Park Hotel.

## Why

The event organisers asked for a QR code card on each table, next to the red bags full of joy, that
guests scan to buy a red bag. Jaimie: "it's just a one-off £50 donation. They can make as many of
them as possible ... it's almost like a disposable thing that we use on the night ... when people are
looking at the bags, sitting there in person, they go, oh, that's really nice. I would like to donate a
bag or two or three. So it's just something really nice and cute that appears on the screen and tells
them what it's for. And then they can click pay." It is NOT Fill a Red Bag (nobody builds a bag).

Success: on the night, guests scan, are delighted, and give £50 bags in under a minute on their phone,
with Apple Pay or Google Pay where they have it, and get an email receipt.

## What Jaimie decided

- £50 a bag, a one-off gift, as many bags as they like.
- "Give people the option of adding gift aid if they want."
- "make it as like animated and as cool as possible ... use some of the assets you created from Fill a
  Bag ... make it feel like it's really like a really nice experience for them."
- Pay through Stripe, with Apple Pay and Google Pay ("using the Stripe thing").
- "obviously getting an email receipt to them."
- She approved the clickable mockup's flow: welcome with the bag and £50 tag, what £50 puts in a bag,
  "Fill a bag", choose how many with plus and minus, the total updating, give, Stripe, a thank you.

## The design

**Address: nbcc.scot/bag** (Claude's call: short, so the QR code is clean and quick to scan). It is
a page of the Festive Ball (src/ball and src/routes/ball.ts), so the site's 8pm after-the-Ball switch
(src/site/after-ball.ts) never touches it; it works all evening. It is live from the day it ships (so
the card can be printed and the page tested) until the end of Sunday 8 November UK time (Claude's
call: a guest scanning a photo of the card the next morning still can), then it forwards to /fill.
It carries noindex: it is for people at the tables, not for Google.

**The screens** (one page; light enough to load quickly on a hotel's mobile signal):

1. **Welcome.** The red bag drops in with a little bounce and a "£50" tag, snow drifts, in the look of
   Fill a Red Bag (reuse its bag drawing, ribbon, "Packed with love" tag, snow and stars, colours and
   fonts). Words, in NBCC's own wording (Jaimie: "stick with our usual wording"; "children, young people and vulnerable adults across South West Scotland", never "a child" alone): thank you for being here tonight; £50 fills a full red bag for those who would otherwise wake up on Christmas morning with nothing to open;
   what is in a bag (from the Fill a Red Bag list: blanket, pyjamas, hat and gloves, socks, a toy, a
   book and a few treats; Claude's wording, Jaimie may change it); a big "Fill a bag" button.
2. **How many bags.** Plus and minus, 1 to 20 bags (Claude's call: 20 is £1,000). Each extra bag
   visibly joins the row of bags with a pop; the total updates ("3 children get a red bag", "£150").
   An optional "Add Gift Aid" choice, closed by default: opening it explains the 25% (£12.50 a bag at
   no cost to them), asks for what HMRC needs (name, home address, postcode) and the declaration in
   the same words the Ball's donate page uses. Then one button, "Give £150".
3. **Stripe's own checkout** for the total, where Apple Pay or Google Pay is one tap and a card is
   always there. Stripe collects their email for the receipt.
4. **Thank you** (back on the site after paying): a celebration with their bags (ribbon tied, "Packed
   with love", stars), "You've filled 3 red bags", and a line to enjoy the rest of the night.

Every animation honours prefers-reduced-motion. Buttons at least 44px. Nothing scrolls sideways. No
box gets its own scrollbar. No en or em dashes, no new hyphenated words.

**The money path reuses the existing donation checkout** that the Ball's donate page uses (one-off,
Stripe Checkout, the webhook records the gift, the existing donor receipt email goes out, Gift Aid
recorded when declared). The amount is the server's own sum (bags × £50); the browser only sends a
number of bags. Gifts are labelled with a new source **"Red bags at the Ball"** (Claude's call) so
they show apart in the admin's donation totals, and also count as Festive Ball money wherever the
Ball's totals are shown. No card fee option on this page (Claude's call: tap and pay).

**The receipt** is the existing donor receipt for a one-off gift, with Gift Aid when declared. If it
can carry a line per source, it says how many red bags; otherwise unchanged.

**Apple Pay and Google Pay** show on Stripe's page when they are switched on in the charity's Stripe
account; the page needs no code for them. Check the account before Saturday.

**The table card** (Claude's call on the format): an A6 portrait card with the QR code for
https://nbcc.scot/bag, a red bag drawing, "Fill a red bag this Christmas", "£50 a bag",
"Scan with your phone camera", and NBCC's name and charity number. Delivered as a print-ready PDF,
one card per page plus four to an A4 sheet, ready before the page itself so printing can start.

## Settled after the builder check (Claude's calls)

- **Name and email on the "how many bags" screen.** The existing checkout needs our own email for the
  receipt (the webhook reads it from our metadata, never from Stripe), so the page asks for first
  name, surname and email, with autocomplete so a phone fills them in one tap. This keeps the shared
  money path and webhook untouched in Ball week, and guarantees a receipt. It replaces "Stripe
  collects their email" above.
- **The admin shows a fourth line, "Red bags at the Ball",** apart from "Festive Ball" and never added
  into it (no double count). New source value `ball_bags`, its own marker in the checkout metadata,
  added to `DONATION_SOURCES`, `sumGiftsBySource`, `sourceTotalsFrom`, `sourceLines`, the admin pill
  and filter. This replaces "also count as Festive Ball money" above. No migration
  (`donations.source` is free text).
- **Not behind the Ball's launch gate.** /bag is public: guests at the tables never see a password.
- **Card only on Stripe's page** for this marker (card covers Apple Pay and Google Pay); no Direct
  Debit, which would record as pending and is not tap and pay.
- **Server-side pricing.** The browser sends a number of bags (1 to 20); the server sets the amount to
  bags x £5,000 pence. Any amount sent is ignored for this marker.
- **Hosted Stripe Checkout, not embedded,** so Apple Pay and Google Pay work without registering the
  site's domain with Stripe.
- **Its own thank-you, /bag/thank-you,** reading the bag count from the session (as /fill/thank-you
  does); Stripe's Back goes to /bag.
- **The receipt is the existing donor receipt, unchanged** (no bag count): adding one would thread new
  data through the shared webhook in Ball week.
- **The card** was made with a one-off script (Chrome prints it to PDF); nothing is added to the app.

## Goals, non-goals, anti-goals

Goals: delightful, fast, one-handed on a phone; money and Gift Aid recorded exactly like any other
gift; a receipt for every gift; the card printable today.

Non-goals: monthly giving; custom amounts; building a bag; an account or login; a live total screen.

Anti-goals: the page going down during the Ball; anything breaking booking, the Ball's donate page,
the donate page or Fill a Red Bag; a Gift Aid claim without the details HMRC needs; a slow or heavy
page; real names, emails or addresses in code or tests.

## Constraints

Jaimie's Ball rule is met: she asked for this and approved it. Golden rules: tests with every change
(Vitest for the pure parts, Cucumber for the routes in CI), README updated, additive migration only
if one is needed, config through the schema. Finish with /ship before Saturday.

## Left to the builder

How the page reuses the Fill a Red Bag assets; the exact endpoint wiring within the existing checkout;
whether a migration is needed for the new source; the card's layout within the brief above.
