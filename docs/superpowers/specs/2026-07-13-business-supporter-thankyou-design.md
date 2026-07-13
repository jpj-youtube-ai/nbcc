# Business supporter thank-you & fulfilment + donate-form redesign

Status: **design agreed, not yet built.** Written 2026-07-13 as the durable record of a long
design session so the conversation can be compacted without losing decisions. This is the
sign-off document and the to-do list.

## Mockups (live, private Artifacts)

- Donate-form redesign: https://claude.ai/code/artifact/337b8809-d147-4165-8427-6493792218e0
- Platinum donor certificate: https://claude.ai/code/artifact/40d6dcf9-4e81-4d5f-9a05-13a6b98c4ac0

---

## 1. Already shipped this session (live on prod unless noted)

1. Donations fixed — the four monthly `STRIPE_PRICE_*` values were `prod_…` (product ids) not `price_…`; corrected in prod SSM. (Ops fix, no code.)
2. Gift Aid declaration only shows when the Gift Aid box is ticked (`initDonorType` gates `.give-declaration`/`.give-partners` on `#giftAid`). [TASK-198]
3. Admin-authz test de-rotted (signed at current time, not a fixed past date) + login rate limiter exempts loopback so the BDD suite (86 logins from one IP) stops 429-ing. [TASK-199] — this un-broke `main`, which TASK-188 had left red.
4. 18+ confirmation is `required` for monthly, so the wizard blocks "Continue" instead of failing at Stripe. [TASK-201]
5. "impact update" perk reframed to "our donor newsletter" (donate page + test + README). [TASK-202, #368] — **on staging; needs a prod promote.**
6. TASK-188 mandatory admin **2FA** is now on prod (rode along with the TASK-198 deploy). Email relay (`EMAIL_SEND_URL`) is a real Cloudflare worker URL, so codes can send.

## 2. Donate-form redesign — decisions (restyle only, preserve all behaviour/tests)

- Frequency toggle: **monthly on the LEFT (default), one-off on the right**, obvious selected state (filled holly-green).
- Amounts in a **row** (4 tiers), selected tier filled green; one-off amounts centred in their boxes.
- **"Most popular"** pill on both £25 tiers.
- Live **impact summary** card updates on tier/frequency change (illustration + copy).
- **Prominent custom-amount** entry (big serif £ field).
- **"Donate" not "give"** everywhere; heading "How much would you like to donate?"; CTA "Donate now".
- Page 2 opens with a **"You are donating £X / Change"** summary.
- Business-vs-individual = its **own clear section** ("Who is this gift from?") above Gift Aid; colour the business option so it draws the eye.
- Gift Aid section **sells the uplift** (headline "Make your £50 worth £62.50", £50 → £62.50, +£12.50 badge); removed the address-explainer popup.
- **No em dashes** (repo rule). All impact copy is **non-definitive** ("could help provide") per the Code of Fundraising Practice — see memory `impact-language-non-definitive`.
- OPEN: default monthly vs one-off (I recommend one-off to avoid accidental recurring); optional pointer from selected amount to impact card.

## 3. Business supporter thank-you & fulfilment — the big feature

**Eligibility (monthly only).** Reuses existing `benefit_types` recognition perks (all £0-value so the HMRC Gift-Aid benefit cap is safe). Perk map (already defined in donor-benefits copy):
- All monthly donors (not anonymous): Supporters-page listing + the donor newsletter.
- **Platinum only**: also social thank-you, digital badge, personalised certificate.
- One-off gifts: NOT eligible for perks and NOT offered the Supporters listing.

**Supporters page banding (changes existing `groupPublicSupporters`/`listPublicSupporters`).** Monthly donors only, banded by monthly amount, **default anonymous (opt in to be shown)**:
- £10–24.99 → Bronze · £25–49.99 → Silver · £50–99.99 → Gold · £100+ → **Platinum** (add a real Platinum band; today platinum folds into Gold).

**Two flows.** Platinum → full thank-you page (which perks, credit wording, logo upload, website, social handles, badge email, certificate digital-or-post→address, consent to be featured). Bronze/Silver/Gold → lighter (credit + logo + newsletter).

**Certificate (decisions).** Auto-generated per Platinum business from Jodie's artwork by overlaying the business name. Built as an HTML→PDF template. Business-appropriate: business name is the hero ("Proudly presented to …"), **metallic silver "Platinum Donor" badge** (no diamond), "Night Before Christmas Campaign" (no year, no "The"), "**Supporting since [Month Year]**" (first-donation month/year), body references "children, young people and vulnerable adults … across South West Scotland", quote kept, signature in the **thank-you-letter script font** (`.ty-signame` stack: Snell Roundhand …), "Jodie McFarlane / Head Elf (Trustee)", charity number "Scottish Charity No. SC047995", real `nbcc-logo.png`, site fonts (Playfair + Poppins), **no gold** (maroon/crimson/holly only). If a business chooses "post it", admin/volunteer also gets a **print-ready download** to print + post by hand.

**Emails + reminders (full flow).** Business donates → business thank-you page (questions + instant downloads) → usual donation email → a **second supporter email** confirming choices + re-linking downloads → **reminders at 5 and 14 days** if the form isn't completed.

**Admin.** A supporter view: each business's captured choices + uploaded logo + generated assets, and one-click **fulfilment status buttons** (Certificate sent · Posted · Badge sent · Social post made · Added to Supporters page), each stamped who/when.

**Backfill existing supporters.** One-time, admin-triggered: for each existing monthly business supporter, create their fulfilment record (not completed) + send the catch-up email with a personal link to their thank-you page (reuses the nudge email). The 5/14-day reminders then chase stragglers. Respect email consent; frame as a service email about their existing support (GDPR / fundraising code). **Depends on the webhook actually recording** — if donations aren't in admin, use a Stripe dashboard export instead. I cannot read Stripe or prod DB directly.

**Reused, not rebuilt:** `benefit_types` + Gift-Aid cap, Supporters page + anonymous exclusion, the newsletter/subscriber system, the email client, the admin panel, the thank-you-letter print template + signature font.

**New:** a fulfilment-preferences table, the two thank-you page variants, the certificate name-overlay + badge generator/serving, the two follow-up emails + reminder scheduling, admin capture/fulfilment UI, the Supporters banding change, the backfill batch.

## 4. Open decisions still needed from Jodie

1. Donate default: monthly or one-off? (rec: one-off)
2. Digital badge — is there a design, or should I create one?
3. Add the Direct Debit "advance notice" line to the thank-you email? (email currently omits it; Stripe sends the real advance notice on mandate setup)
4. Optional: pointer from selected amount to impact card; "Platinum Business Donor" vs "Platinum Donor"; keep the quote.

## 5. Assets/info needed from Jodie

1. Certificate artwork file + badge design (if any).
2. A scan of Jodie's real signature (optional — script font stand-in works).
3. Confirm existing donations show in admin (decides DB vs Stripe export for the backfill).

## 6. Build order (each its own green PR, staged onto the test site)

1. Donate-form redesign (real `donate.html` + `main.js`, preserve all ids/tests).
2. Supporters page: monthly-only, 4-band by amount, default anonymous.
3. Fulfilment-preferences data model + capture on the thank-you page(s).
4. Certificate + badge generation and download/print-to-post delivery.
5. Second email + 5/14-day reminders.
6. Admin capture + fulfilment buttons.
7. Backfill existing supporters.

## 7. Housekeeping

- Pending prod promote: the newsletter reframe (#368) is on staging, waiting to go live.
- Verify the Stripe **webhook is recording** (donations appear in admin) — affects both the donation records generally and the backfill source.
