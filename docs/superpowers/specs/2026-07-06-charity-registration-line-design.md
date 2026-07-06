# TASK-126 — Canonical charity-registration line everywhere

## Goal

One exact, verbatim charity-registration statement must appear in the footer of
**every page** and in **every donor-facing receipt and thank-you letter**:

> Night Before Christmas Campaign, known as NBCC, is a Scottish Charitable Incorporated Organisation.
> Scottish Charity Number SC047995. Regulated by the Scottish Charity Regulator, OSCR.

Existing *variant* wordings (footer's `© 2026 … a Scottish Charitable
Incorporated Organisation. Charity No. SC047995, regulated by OSCR.`; receipts'
`Registered Scottish charity, OSCR number SC047995`) are **replaced** by this
canonical block so the wording is uniform and legally exact.

## Single source of truth

New module `src/legal/registration.ts` — the one place the wording lives:

- `CHARITY_NAME` = `"Night Before Christmas Campaign"`, `CHARITY_SHORT_NAME` =
  `"NBCC"`, `OSCR_NUMBER` = `"SC047995"` (moved here; `receipt.ts` and
  `confirmation.ts` re-import instead of re-declaring — dedupe the copies).
- `REGISTRATION_LINES: readonly [string, string]` — the two exact lines.
- `REGISTRATION_TEXT` — the two lines joined by `\n` (plain-text letters).
- `REGISTRATION_HTML` — an HTML fragment (`<p class="charity-registration">…</p>`
  with a `<br />` between the lines) for HTML letters/receipts.
- `OSCR_REGISTER_URL` — the existing register deep link
  (`https://www.oscr.org.uk/…?number=SC047995`), reused by the page footer.

Pure, DB-free, no clock — matches the existing wording-constant modules
(`src/donors/receipt.ts`, `src/declarations/wording.ts`).

## Receipts + thank-you letters (4 builders)

The letter/receipt bodies are built by pure content builders; the email client
(`src/clients/email.ts`) only ships their `text`/`html`. So the line is added in
the builders:

| Builder | File | Change |
|---|---|---|
| `buildCorporationTaxReceipt` | `src/donors/receipt.ts` | replace the `Registered Scottish charity, OSCR number …` identity line with the canonical block, appended as the letter footer |
| `buildCompanyRefundNotice` | `src/donors/receipt.ts` | same |
| `buildDonationConfirmation` | `src/donors/confirmation.ts` | append canonical block as the email footer |
| `buildRefundConfirmation` | `src/donors/confirmation.ts` | same |

Both `text` and `html` renderings carry it. The `text` gets `REGISTRATION_TEXT`
as a trailing block; the `html` gets `REGISTRATION_HTML`.

**Out of scope (no body content here to attach to):** the bare-payload emails in
`email.ts` — magic-link, in-person declaration, subscription-lapsed. Their body
is templated by the provider, not built in this repo, so there is no letter body
to carry the line. Noted, not touched.

## Page footers (9 HTML files)

`index, about, donate, contact, supporters, thank-you, portal, privacy,
gift-aid`. In each `.legal` strip:

- Drop the `© 2026 …` variant line.
- Show the two exact mandated lines.
- Keep the OSCR register link, wrapped **invisibly** around `SC047995` so the
  visible text is exactly the mandated wording while the footer link test
  (`href="…oscr.org.uk…SC047995"`) still passes.

Resulting strip (identical in every page):

```html
<div class="legal">
  <div class="wrap">
    <span>Night Before Christmas Campaign, known as NBCC, is a Scottish Charitable Incorporated Organisation.</span>
    <span>Scottish Charity Number <a href="https://www.oscr.org.uk/about-charities/search-the-register/charity-details?number=SC047995" target="_blank" rel="noopener">SC047995</a>. Regulated by the Scottish Charity Regulator, OSCR.</span>
  </div>
</div>
```

All footers edited identically → `test/unit/footer.test.ts` byte-identical
assertion stays green. Edits CRLF-normalised (repo `autocrlf=true`; `Write`
emits LF and would break the byte-identical footer test locally).

## Tests (TDD — test first, then code)

- `test/unit/footer.test.ts` — update the legal-strip assertions to the exact
  wording; keep the OSCR-link + SCIO assertions.
- `test/unit/corporation-tax-receipt.test.ts`,
  `test/unit/company-receipt-webhook.test.ts` — assert the canonical block in the
  CT receipt / refund notice, drop the old `Registered Scottish charity…` string.
- confirmation / refund-confirmation unit tests — assert the block in both.
- New `test/unit/registration.test.ts` — the module exposes the exact lines /
  text / html.
- Run **full BDD** locally (`site.feature` footer markers + copy-rules/seo/
  accessibility guards), not just `test:unit` — page-text edits trip feature
  markers.

## Process

One PR, title `[TASK-126] …`, branch `task-126-charity-registration-line`.
Lint + build + unit + BDD green before self-merge. README footer/section note
updated in the same PR (golden rule 7).

## Non-goals

- No new config/secret, no migration, no infra change.
- No change to the provider-templated notification emails' bodies.
- No visual redesign of the footer beyond the legal strip text.
