# The whole admin, in the Donations look (2026-11-14)

## Why

Jaimie, 14 Nov 2026: "Look at what we've done with the overview, with donations... and bring everything
up to that level. I want you to have a full UI refresh... don't take any features away and don't break
anything... think really smart about it. Would you add any features in there that are going to make life
easier for that particular section? How would you tidy up so that it's really nice on mobile?" And for the
newsletter: "I would love you to add features... more templated things we can put in there", in the look
of the newer public pages (Fill a Red Bag).

They asked not to be asked questions, so every call here is mine. The four I put to them first, with my
choice on each (they could change any by 7:15pm that evening):

1. Menu names stay as they are (Claims, GASDS, Subscriptions and so on). Each screen gains one plain
   sentence under its title saying what it is for.
2. The newsletter gains new blocks beside the old ones. Every block and every newsletter already written
   renders exactly as before.
3. Each area ships on its own as soon as its checks pass.
4. "All the other pages" is read as the other admin screens, not the public website.

## What is already at the standard, and is left alone

Overview, Contact form, the phone menu and bottom bar (`admin-overview.css`), Donations
(`admin-donations.css`), Get involved (`admin-get-involved.css`), Head Elf HQ, Fill a Red Bag, Santa
Sleigh and the Festive Ball. The Ball's ticket report and its emails are their own after-the-Ball items.

## Goals

- Every other screen looks and behaves like those: a title with one plain sentence, counts as tiles, cards
  that press in, cards and not tables on a phone, 44px for anything pressed, plain words.
- Each screen answers "what needs me here?" before anything else.
- Each screen gains the features that save this team of four real time, where they need no new
  infrastructure, config or secrets.
- The newsletter gains new blocks and starting templates in the newer public look.
- Elf Detective School no longer freezes on a phone.

## Non goals

- No feature, control, column or piece of information is taken away. No wording is changed except to
  explain.
- Nothing that needs Terraform, a new config value or a new secret.
- The public website's pages.

## Anti goals

- A scrollbar inside any box, or a page that scrolls sideways (house rule).
- A message that appears somewhere the person is not looking.
- Anything that moves without the person being happy with motion.
- A newsletter already written rendering differently by one byte.

## Approaches considered

1. **One shared kit, opted into per screen (chosen).** `assets/css/admin-kit.css` holds the Donations look
   once, as parts. A screen takes it by adding the class `ak` to its `<section class="admin-view">`; inside
   it the admin's old shared pieces (`.admin-btn`, `.admin-seg`, `.admin-table`, `.admin-pill`, fields, the
   pager) are redrawn, and new `.ak-` parts are there to build with. A screen without the class is
   untouched. Twenty screens then share one look and cannot drift, and each is a small change.
2. **Restyle the old shared classes for the whole admin at once.** Fewer lines, but it would reach into the
   screens that already have a design of their own, and one PR would change every screen with no way to
   look at each properly.
3. **A stylesheet of its own per screen, by value**, as Overview, Donations and Get involved were done.
   Right for three screens with their own designs; for twenty it is twenty copies of the same rules to keep
   in step.

## The kit

`assets/css/admin-kit.css`, loaded after `admin.css` and `admin-overview.css` (whose `--ov-` colours it
uses), and `assets/js/admin/kit.js` (`window.AdminKit`), loaded before `app.js`.

| Part | What it is |
|---|---|
| the title | `h2`, then `.admin-view-intro`: one plain sentence saying what the screen is for |
| `.ak-tiles`, `.ak-tile` | a count, its name, a line saying what it means; a `button.ak-tile` filters or goes somewhere, `.is-active` is the one chosen, `.is-none` steps back at 0 |
| `.admin-btn` | the main thing to press (holly); `.ak-btn--plain` the others; `.ak-btn--danger` what cannot be undone; `.ak-says` the line under a button saying what it does |
| `.admin-segmented`, `.admin-seg` | a choice of one, as pills; `.ak-filters`, `.ak-filter-group`, `.ak-filter-label` put them in labelled groups |
| `.ak-card`, `.ak-panel`, `.ak-card--flat` | a card, the big card for a form, a card inside a card |
| `.ak-row` | a card that is the button, with a chevron: it opens something |
| `.ak-item` | a card that opens where it is: `.ak-item__face` (the button, `aria-expanded`), `.ak-item__more` |
| `.admin-table` with `.ak-cards` | a framed ledger on a laptop; a card per row on a phone, each cell named from its column (`AdminKit.labelCells`), `.ak-cards__lead` on the cell that names the row |
| `.admin-pill`, `.ak-mark` | a word in a pill: `--ok`, `--wait`, `--bad`, `--quiet` |
| `.ak-facts`, `.admin-dl` | a name and its value |
| fields | every input, select and textarea: 46px, 16px words (an iPhone zooms in on anything smaller) |
| `.ak-notice`, `.admin-empty`, `.admin-action-status` | something to know first; nothing here yet; what just happened |
| `.ak-fold`, `.admin-fold`, `.admin-guide` | something folded away, as a card whose heading opens it |
| `.ak-parts`, `.ak-part-btn`, `.ak-part` | a long screen in parts, one showing at a time (`AdminKit.wireParts`); pinned on a laptop, in the page on a phone; `.ak-part-dot` says something in a part is waiting |
| `.ak-group` | a heading inside a list, with a dashed rule to the edge |

`AdminKit`: `labelCells(table)`, `wireParts(root, opts)`, `toCsv(rows)` and `downloadCsv(name, rows)` (a
cell that would run as a formula in Excel is kept as words), `copyText(text)`, `plural(n, one, many)`.

Each area has a sheet of its own on top of the kit, for what only it needs: `admin-giving.css`,
`admin-supporters.css`, `admin-records.css`, `admin-content.css`, `admin-outreach.css`,
`admin-settings.css`, `admin-newsletter.css`.

## The areas

Each is its own change, with its own short design beside this one
(`docs/superpowers/specs/2026-11-14-admin-refresh-<area>.md`), written from an inventory of everything on
the screen today so nothing is lost:

- **Giving**: Claims, GASDS, Subscriptions, Business supporters, Monthly givers, Invoices, one donor.
- **The records**: Audit, Email audit, Search, Notifications, Analytics.
- **Content**: Stories, Partners, Thank you, Contact businesses.
- **Admin**: Site pages, QR codes, Team, My account.
- **Newsletter**: its screens; then new blocks and starting templates for the email itself.

## Left to the builder

Which kit part suits each piece of a screen; the area's own features, from its inventory; exact spacing.
