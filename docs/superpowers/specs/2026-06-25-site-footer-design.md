# TASK-008 — Maroon three-column site footer (REQ-003)

**Task:** TASK-008 — fill the empty footer slot in all four pages with the NBCC
footer, ported from the baseline (`nbcc-preview.html`). Approved scope: footer
only; the brand-mark image is REQ-034 (text + inline-SVG icons only here).

## Markup (identical in all four pages)

Fills `<footer class="site-footer" data-region="footer">` with three columns +
a legal strip. **Byte-identical across pages** (no page-specific state), unlike
the nav's per-page active link.

- **Col 1 — brand + socials:** name "Night Before Christmas Campaign" + tagline;
  `.socials` links to the real NBCC accounts (from the baseline) — Instagram
  `instagram.com/nightbeforechristmascampaign`, Facebook
  `facebook.com/nightbeforechristmascampaign`, X `x.com/Nightbeforechr1` — each an
  `<a target="_blank" rel="noopener" aria-label="…">` wrapping an inline SVG icon
  (with `width`/`height`). Inline SVG is markup, not `<img>`, so it adds no
  request and is exempt from the perf-budget `<img>` rule.
- **Col 2 — Explore:** clean-URL links `/`, `/about-us`, `/donate`, `/contact`.
- **Col 3 — Ways to give:** "Donate money" → `/donate`, "Donate items" →
  `/contact`.
- **Legal strip** (`.legal`): `© 2026 Night Before Christmas Campaign. A Scottish
  Charitable Incorporated Organisation (SCIO).` and `Charity No. SC047995,
  regulated by OSCR`, where **SC047995** links to the OSCR register entry:
  `https://www.oscr.org.uk/about-charities/search-the-register/charity-details?number=SC047995`.

Clean URLs only (no raw `.html`) — keeps `clean-urls.test.ts`'s link guard green.
Year is **hardcoded `2026`** (fully static, no JS, keeps the markup identical).

## Styling (`assets/css/styles.css`)

Append a commented `FOOTER (REQ-003)` block, scoped to `.site-footer`, reusing the
token subset (`--maroon`, `--cream`, `--line`, `--maxw`); cream-on-maroon via the
same `rgba(248,245,238,α)` literals the nav uses for alpha tints:

- `.site-footer` maroon bg, cream text, top margin to clear sparse pages.
- `.site-footer .wrap` max-width grid `1.5fr 1fr 1fr`, gap, padding.
- `h4` headings (cream), `ul` lists, `a` (cream 82%, hover → full `--cream`),
  `.foot-brand`, `.socials` (rounded tinted squares).
- `.site-footer .legal` hairline top border; `.legal .wrap` flex row.
- `@media (max-width:680px)`: columns stack (`grid-template-columns:1fr`).

No inline styles, no new CSS file → `static-site.test.ts` stays green. No web
fonts, no `<img>` → `perf-budget.test.ts` stays green.

## Testing

`test/unit/footer.test.ts` (node env, mirrors `nav.test.ts`):

- Per page: footer exists; has the three columns (`.foot-brand` + `.socials`,
  `Explore`, `Ways to give`); the Explore column lists the four clean URLs; the
  legal strip contains the SCIO text and an OSCR link mentioning `SC047995`.
- The footer block is **identical across all four pages**.

## Out of scope

- Logo/brand-mark image + favicon (REQ-034); full design tokens + web fonts
  (REQ-004/006); the "Charity Site" → NBCC `<title>` rename.

## Files

- Edit: `index.html`, `about.html`, `donate.html`, `contact.html` (footer slot),
  `assets/css/styles.css` (footer block), `README.md` (Footer subsection).
- New: `test/unit/footer.test.ts`, this spec.
