# Admin refresh: one donor's page and Search (2026-11-14)

Part of `2026-11-14-admin-refresh-design.md`. Both screens take the kit (`class="admin-view ak"`) and
an area sheet of their own, `assets/css/admin-people.css` (every rule through `#view-donor`,
`#view-search` or `.pp-`).

## What each screen is for

- **One donor's page** (`#view-donor`): where every "can you check my donation" question ends up. Who
  they are, what they have given, their monthly gift and Gift Aid; change their details or cancel
  either when they ask.
- **Search** (`#view-search`): find a person, a gift or a Gift Aid declaration when somebody rings or
  writes in.

## Faults put right first (each with a test that failed on the old code)

1. Search said **Paid** on every gift: `searchDonations` did not return `payment_status` or
   `refunded_amount_pence`, and `H.paymentLabel` reads a missing status as Paid. It returns both now.
2. Saving a donor lost the address and the Gift Aid form: the page was drawn from the PATCH's answer
   (the snapshot alone). The page is now read again after every change, and the answer is laid over
   what is held, never drawn in its place.
3. The cancel messages were wiped as they were written (the reload cleared the one status line). Each
   button has its own line beside it, kept with the page and cleared only when another donor opens.
4. Gift Aid and the monthly plan still showed as live after cancelling. Gift Aid is "On" only while a
   declaration is in force; the monthly gift's state comes from a new read (below), and a cancel the
   server confirmed stays true on the page even if the next read fails.

## Layout now

**Donor page.** Back says where it goes ("Back to Search") and goes there. Their name is the title,
with marks (Monthly, Gift Aid, Anonymous). One plain sentence. Four tiles: given in all, gifts paid,
first and latest gift. Then two columns on a laptop, one on a phone: *Who they are* (every old fact,
plainer words, tap to email, Copy email, Copy address), *Monthly gift* (amount, since when, state in
plain words, Cancel with a sentence under it, asked in the page), *Gift Aid* (On or Off, what the
declaration covers, Cancel likewise), the two forms folded; *Their gifts* as cards (12 shown, then
"Show all"), *What has changed* from the audit trail. Someone without Donations is told it is not
part of their access, not to try again.

**Search.** One box asks the three routes together. Three tiles (People, Gifts, Gift Aid
declarations) say what each looks in, carry the count ("50+" when cut off, a dash when that part
failed) and jump to the heading. People and declarations are cards that open the donor; gifts stay
the donations table (pinned by tests), which is a card per gift on a phone. "Showing the first 50,
type more to narrow it." The last search and its results are kept for Back. Your last five searches
are buttons, kept in sessionStorage for this tab only and cleared at sign out. Someone with Search but
not Donations gets no button that would only say no.

## Server additions (read only, guarded as the donor read is: Donations, view)

- `GET /api/admin/donors/:id/giving`: totals, gifts (by email address, as the donor's own portal
  counts them; organiser pay-ins left out), and `monthly` (state as Monthly givers works it out, plus
  the team's own cancellation from the audit row written in the same request).
- `GET /api/admin/donors/:id/history`: the donor's audit lines; only who, what, when and which fields
  changed leave the server (a sign in link's row holds its secret).
- The donor search also looks at postcodes and a business supporter's phone number; a run of digits
  too long for an id is no longer cast to one (that made the whole query fail).

## Left out, and why

- A private note on a donor: needs a migration. Worth doing next.
- Search as you type: three reads a key press; the button is kept.
- Words for the gift table's Claim column (`eligible`) and its dates (`14/11/2026`): the table is
  shared and its cells are pinned by several tests; worth a change of its own.
- A Business mark on the donor page: the snapshot has no `donor_type`.
