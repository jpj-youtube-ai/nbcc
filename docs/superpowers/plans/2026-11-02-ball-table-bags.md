# Festive Ball table bags Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** nbcc.scot/bag, an animated phone page for the Festive Ball tables: £50 a red bag, 1 to 20 bags, optional Gift Aid, Stripe with Apple Pay and Google Pay, the usual receipt, and its own thank you.

**Architecture:** A new optional `ballBags` marker on the existing `/api/checkout-session` (server prices bags x 5000p, card only, hosted Checkout, its own return URLs, metadata `ballBags`, source `ball_bags`); a fourth admin source line; the page and thank-you as Festive Ball pages in `src/ball/` and `src/routes/ball.ts`, reusing Fill a Red Bag's drawings and snow.

**Tech Stack:** TypeScript, Express, Stripe Checkout, Zod, vanilla JS and CSS for the page, Vitest (jsdom for the page script), Cucumber in CI.

**Spec:** `docs/superpowers/specs/2026-11-02-ball-table-bags-design.md` (read it, including "Settled after the builder check").

## Global Constraints

- £50 a bag: `5000` pence. Bags 1 to 20. One-off only. The server sets the amount from the bag count; a browser amount is ignored for this marker.
- Source value `ball_bags`, admin label "Red bags at the Ball", never added into the "Festive Ball" line.
- /bag is public (no Ball gate), noindex, open until the end of Sunday 8 November 2026 UK time, then 302 to /fill. /bag/thank-you the same window, noindex, never cached.
- Hosted Stripe Checkout only for this marker, `payment_method_types: ["card"]`.
- The page asks first name, surname and email (autocomplete given-name, family-name, email); Gift Aid is optional and closed by default, with the same declaration wording and fields as the Ball's donate page (`SINGLE_DONATION_WORDING`, house name or number, address, postcode, not in the UK).
- The look is Fill a Red Bag's: reuse `NBCCRedBagWorkshop.tiedBag` (assets/js/red-bag-workshop.js), `NBCCRedBag.flurryPlan` and the snow and stars (assets/js/red-bag-catalogue.js, assets/css/red-bag.css `.rb-flurry`), brand colours and fonts. Every animation stops under prefers-reduced-motion. 44px touch targets; nothing scrolls sideways at 360px; no box with its own scrollbar.
- Copy rules: no en or em dashes, no new hyphenated words, sentence case. No real names, emails or addresses in code or tests (example.com, invented names).
- The existing donate page, Ball donate page, Fill a Red Bag and the webhook behave exactly as before: every existing test stays green unchanged.
- README updated. Tests with every task.

## Review Focus

1. A posted body with `ballBags` and a forged `amount` (say 1p or £5,000) still charges bags x £50.
2. `ballBags` combined with `redBag`, `ball`, a fundraiser, `monthly` or a company is refused (400).
3. The page in a phone at 360px, and with reduced motion: nothing moves, everything still works.
4. Gift Aid ticked without postcode or house number is refused by the server (the shared declaration rules), and the page says so beside the field.
5. Someone scanning after Sunday lands on /fill, not an error.

---

### Task 1: The checkout marker and the gift source

**Files:**
- Modify: `src/routes/api.ts` (schema, refines, metadata, payment methods, return URLs, pricing)
- Modify: `src/db/stripe-webhook-model.ts` (`DONATION_SOURCES` gains `ball_bags`; `sourceFromCheckoutSession` maps `metadata.ballBags === "true"`)
- Test: a new `test/unit/ball-bags-checkout.test.ts` on `buildSessionParams` / the schema (follow how existing tests import them, e.g. grep `buildSessionParams` in test/unit); extend the source mapping tests.
- BDD: `features/ball-bags.feature` + steps: POST /api/checkout-session with `ballBags` works with the Stripe test double the other checkout scenarios use (grep features for `checkout-session`).

**Interfaces:**
- Produces: body field `ballBags: z.number().int().min(1).max(20).optional()`; `export const BALL_BAG_PENCE = 5000` and `export const BALL_BAGS_MAX = 20` (put them in a small pure `src/ball/bags.ts`, also exporting `BALL_BAGS_PATH = "/bag"` and `BALL_BAGS_THANKS_PATH = "/bag/thank-you"`); metadata `ballBags = String(count)`; the source `ball_bags`.
- Refines when `ballBags` is present: mode once, donorType individual, no `redBag`, no `ball`, no `fundraiserId`. The amount used for the line item is `ballBags * 5000` whatever `amount` says (set it in one place before the session is built, and make the schema accept a missing `amount` only for this marker).
- Return URLs: hosted only (ignore any embedded request): success `${PORTAL_BASE_URL}/bag/thank-you?session_id={CHECKOUT_SESSION_ID}`, cancel `${PORTAL_BASE_URL}/bag`.
- `payment_method_types: ["card"]` for this marker only.
- The line item's name: "Red bags at the Festive Ball" (quantity 1, the total amount), so Stripe's page reads sensibly.

- [ ] Step 1: failing tests: forged amount priced as bags x 5000; 0 and 21 bags refused; each forbidden combination refused; card only; hosted URLs as above; metadata `ballBags`; source mapping `ball_bags`; a session WITHOUT the marker byte for byte as before (compare `buildSessionParams` output for an ordinary body and a Ball donate body before and after).
- [ ] Step 2: run them, see them fail.
- [ ] Step 3: implement.
- [ ] Step 4: run them and the existing checkout and webhook unit tests (grep test/unit for api.ts / stripe-webhook), tsc, lint, build, cucumber dry run.
- [ ] Step 5: commit "Ball bags: the checkout marker, server pricing and the gift source".

### Task 2: The admin line

**Files:**
- Modify: `src/db/overview-numbers.ts` (`sumGiftsBySource` gains the `ball_bags` bucket), `src/admin/gift-sources.ts` (`SourceTotals`, `sourceTotalsFrom`, `sourceLines`: a line "Red bags at the Ball" after "Festive Ball", with a note "Gifts from the table cards at the Festive Ball."), `assets/js/admin/app.js` (the pill "Red bags at the Ball" for `d.source==="ball_bags"`, and a filter tick box like the Festive Ball one), `admin.html` (that tick box).
- Test: extend the existing gift-sources and admin donations tests (grep test/unit for `sourceLines`, `donationsRedBagFilter`).

- [ ] Step 1: failing tests (the fourth line, its total, never added into Festive Ball; the pill; the filter sends `source=ball_bags`).
- [ ] Step 2: see them fail. Step 3: implement. Step 4: run affected tests, tsc, lint, build. Step 5: commit "Ball bags: the admin line, pill and filter".

### Task 3: The page and the thank you

**Files:**
- Create: `src/ball/bags-page.ts` (pure: `ballBagsOpen(now: Date): boolean`, open while the London date <= "2026-11-08"; `renderBallBagsPage(): string`; `renderBallBagsThanks(bags: number): string`), `ball-bags.html` if the Ball pages use HTML templates (follow `ball-donate.html` and `renderBallDonatePage`), `assets/js/ball-bags.js` (the flow), `assets/css/ball-bags.css`.
- Modify: `src/routes/ball.ts` (GET /bag and GET /bag/thank-you, NO gate; after the window 302 to /fill; thank-you reads the bag count from the Stripe session the way /fill/thank-you does, falls back to a plain thank you when the session cannot be read; `Cache-Control` as /ball/donate for the page, `private, no-store` for the thank you), `src/site/pages.ts` (`/bag` in `RESERVED_PREFIXES`; both in `PRIVATE_PAGES`).
- Test: `test/unit/ball-bags-page.test.ts` (window boundaries in London time; the rendered page carries noindex, the Gift Aid wording, the fields with autocomplete, no dashes), `test/unit/ball-bags-script.test.ts` (jsdom: plus and minus clamp 1 to 20; the total and "3 children get a red bag" update; Gift Aid opens its fields; the POST body has `ballBags`, `mode:"once"`, `donorType:"individual"`, names, email, `giftAid` and `declaration` only when ticked, and no `amount`; the page goes to the returned URL; an error message shows beside the button on failure, with `is-error`); BDD in `features/ball-bags.feature` for GET /bag 200 and noindex without any Ball gate cookie, and /bag/thank-you 200.

The screens (copy approved in the mockup, in NBCC's own wording: Jaimie, 2 November 2026, "stick with our usual wording ... young person or vulnerable adult". Never "a child" alone; the charity's phrase is "children, young people and vulnerable adults across South West Scotland" and "a full red bag for those who would otherwise wake up on Christmas morning with nothing to open"):
1. Welcome: eyebrow "NBCC Festive Ball"; the tied bag (`tiedBag({ words: true })`) drops in with a small bounce and a round "£50" tag; snow and stars drift (flurryPlan, light); heading "Thank you for being here tonight"; "£50 fills a full red bag for children, young people and vulnerable adults across South West Scotland who would otherwise wake up on Christmas morning with nothing to open."; four short lines of what is in a bag ("A cosy blanket and pyjamas", "Hat, gloves and socks", "A toy and a book", "A few treats to unwrap"); button "Fill a bag".
2. How many: plus and minus (48px round buttons) around a big number; a row of small tied bags that grows with a pop as bags are added (cap the drawn row at 10 and show "+N"); "1 full red bag" / "3 full red bags"; the total; first name, surname, email; "Add Gift Aid (25% more, at no cost to you)" opening the declaration and address fields; one button "Give £150".
3. Hosted Stripe Checkout (not part of the page).
4. Thank you: a celebration (the bags tie their bows one after another, stars), "You've filled 3 red bags" (or "a red bag"), "Thank you. Someone who would otherwise have nothing to open will wake up to it on Christmas morning. Enjoy the rest of your night.", and a quiet link "Fill another" back to /bag.

- [ ] Step 1: failing unit and jsdom tests; BDD scenarios (dry run resolves).
- [ ] Step 2: see them fail. Step 3: implement. Step 4: affected tests, tsc, lint, build, dry run. Step 5: commit "Ball bags: the page and the thank you".

### Task 4: README and finish

- [ ] README: a section beside the Ball's donate page (what /bag is, the window, the marker and server pricing, card only and hosted, the source line, the card PDF made by a one-off script, Jaimie's words); full unit suite; lint; build; dry run; commit "Ball bags: README". Then /ship.
