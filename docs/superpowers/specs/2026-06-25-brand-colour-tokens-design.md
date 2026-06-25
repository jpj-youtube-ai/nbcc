# TASK-009 — NBCC brand colour token system (REQ-004)

**Task:** TASK-009 — collapse the two `:root` blocks in `assets/css/styles.css`
into one authoritative brand-colour token system and make every colour in the
stylesheet a `var(--…)` reference. Typography/web fonts are REQ-005/006; the logo
asset is REQ-034 — both out of scope.

## One canonical `:root`

Replaces the scaffold placeholder palette (`--color-text/-muted/-bg/-accent`) and
the TASK-007 NAV token subset with a single block:

- **Six official colours:** `--crimson #c02238`, `--maroon #800000`,
  `--cream #f8f5ee`, `--tan #d29c8a`, `--slate #333333`, `--holly #1a531a`.
- **Five derived surfaces:** `--card #fffdfa`, `--line #e9dfd2`,
  `--tan-soft #f3e4dd`, `--holly-soft #eaf0e7`, `--slate-soft #6f6a66`.
- **Cream alpha tints** (for dark surfaces/overlays, chosen approach):
  `--cream-90/-82/-24/-16/-12` as `rgba(248,245,238,α)` — rgba literals are
  allowed *inside* `:root`.
- **Kept:** `--shadow-sm`/`--shadow` (rgba in `:root`), and the non-colour layout
  tokens `--nav-h`, `--maxw`, `--content-width`, `--space`, `--font-body`
  (system stack; web fonts are REQ-005/006).

Existing names nav/footer reference (`--crimson/--maroon/--cream/--line/--slate/
--maxw/--nav-h/--shadow*`) are preserved, so `nav.test.ts`/`footer.test.ts`
(which assert markup/behaviour, not colour values) stay green.

## Every colour becomes a token

Remap the placeholder usages and tokenize the 8 body literals:

| Was | Now |
|---|---|
| `color: var(--color-text)` (body) | `var(--slate)` |
| `background-color: var(--color-bg)` (body) | `var(--cream)` |
| `color: var(--color-muted)` (p) | `var(--slate-soft)` |
| `color: var(--color-accent)` (a) | `var(--maroon)` |
| `outline: … var(--color-accent)` (focus) | `var(--holly)` |
| `.nav` `rgba(248,245,238,0)` | `transparent` (keyword, no hex/rgb) |
| `.nav.scrolled` `rgba(248,245,238,.9)` | `var(--cream-90)` |
| `.nav-cta` `color: #fff` | `var(--cream)` |
| `.site-footer`/`a` `rgba(…,.82)` | `var(--cream-82)` |
| `.socials a` `rgba(…,.12)` / hover `.24` | `var(--cream-12)` / `var(--cream-24)` |
| `.legal` border `rgba(…,.16)` | `var(--cream-16)` |

After this, the only hex/rgb literals in the file are inside the `:root` token
definitions. (The inline-SVG `#F8F5EE` fills are in the footer **markup**, out of
CSS scope.)

## Contrast rule

Body/long-form text is never set in `--tan` or `--holly` on cream/card surfaces.
The refactor uses slate/maroon/crimson/cream for text; `--holly` appears only as a
focus **outline** (not `color:`). No `color: var(--tan|--holly)` exists.

## Testing (TDD)

`test/unit/brand-colours.test.ts` (DB-free, mirrors `static-site.test.ts`):

1. Each of the six official + five derived tokens is declared with its hex value,
   and there is exactly **one** `:root` block.
2. With comments stripped and the `:root` block removed, the stylesheet contains
   **no** hex and **no** `rgb(`/`rgba(` literal.
3. No rule sets `color: var(--tan)`/`var(--holly)` without a dark background in
   the same block (the tan/holly-on-cream contrast guard).

README gets a "Brand colour system (REQ-004)" subsection.

## Files

- Edit: `assets/css/styles.css` (token block + every colour → `var()`),
  `README.md`. New: `test/unit/brand-colours.test.ts`, this spec.
