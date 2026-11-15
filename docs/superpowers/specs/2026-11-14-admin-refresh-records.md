# The records, in the Donations look (2026-11-14)

One area of the whole-admin refresh (`2026-11-14-admin-refresh-design.md`): **Audit**, **Email audit**,
**Analytics** and **Notifications**. Built from the kit (`assets/css/admin-kit.css`,
`assets/js/admin/kit.js`); what only these four screens need is in `assets/css/admin-records.css`, every
rule named through its view or the prefix `rc-`. Written from the inventory in the area's audit, so
nothing on the screens today is lost.

## What each screen is for

| Screen | Who opens it, and why |
|---|---|
| Audit (Governance) | An admin or trustee finding out who did what to a record, and when, after something looks wrong. A few times a month, and at year end. |
| Email audit (Governance) | An admin checking whether an email reached someone, and clearing dead addresses out of the red band. Weekly. |
| Analytics (Admin) | An admin seeing how many people visit the website, where from and what they look at. After a newsletter, and monthly for trustees. |
| Notifications (Monitor) | Each member of staff, once for each phone, turning notifications on and choosing what buzzes. |

## Audit

**Before:** one table of the newest 50 rows, every column a code (`admin:jo@…`, `donation.flagged_for_trustees`,
`business_supporter_fulfilment 7`), a date with no time, no way to older rows, and what changed never shown.

**Now:**

- One plain sentence under the title, then tiles for the parts of the admin (All, Donations, Get involved,
  Festive Ball, Elf Detective School, Businesses, Fill a Red Bag, Newsletter, Team, Website), each with its
  count for the filters in force.
- Filters in one card: a word, who did it, from and to, and **Staff only** (hides what Stripe, visitors to
  the website and automatic jobs wrote). Each applies as it is changed.
- Each line is a sentence: "Jo Example changed Sam Example's role to Editor". The words come from a map of
  action code to words in `app.js` (`AUDIT_WORDS`); a sentence may take a detail from what the line
  recorded (`{role}`, `{reference}`, `{amountPence:money}`) and falls back to its plain form when the
  detail is not there. A code with no words yet reads as a tidy version of the code, never blank.
  `test/unit/admin-audit-words.test.ts` reads every action code out of `src/` and fails when one has no words.
- Lines are cards under day headings ("Today", "Yesterday", "Thursday 5 November") with the time in UK time.
- A line opens where it is: when, who, what part of the admin, every fact it recorded in plain words, and
  the codes it is stored under (the old ID, Actor, Action and Entity columns). A line about a donor has
  "Open this donor"; one about a sign up has "Open this sign up".
- **Show older** adds the next 50 under what is showing (`offset`, `total`), and says how many of how many.
- **Download what is shown** gives a spreadsheet of the lines on screen (`AdminKit.downloadCsv`).

**The server** (`GET /api/admin/audit`, same guard): new optional `entities`, `actor`, `staff`, `from`, `to`,
`q` and `summary`. All are plain `WHERE` clauses with bound parameters; no migration. Each row also carries
`actor_name` (the member of staff's own name) and, for a line about one of the team, `about_name` and
`about_email`, so a sentence can name both. `summary=1` adds `counts` (lines by entity, for the tiles) and
`people` (the staff in the log, for the list).

## Email audit

**Before:** a five-column table pinned wider than a phone, no time of day, about 80 types in the order they
were coded, Apply to search, and a band that vanished whenever a filter was used.

**Now:**

- Status tiles as the filter, with counts: All, Problems, Delivered, Sent. The finer choice (Failed to
  send, Bounced, Marked as spam) is still in the Status list.
- Search as you type; Type grouped (Donations, Festive Ball, Get involved, Elf Detective School, Newsletter,
  Signing in, Businesses, Behind the scenes) and A to Z inside each; From and To.
- The red band is unchanged in what it does, and now stays while filters are on. Its heading counts every
  problem, as the Overview does, and says when it is showing only the newest.
- A card per email under day headings, with the time. A card opens in place: to, name, type, subject, sent
  at, what the mailbox said and when, and who removed it from the band. Put back is a real button there.
- The address on an opened card is a button: "Everything sent to this address" fills the search with it.
- **Download what is shown.**

**The server** (`GET /api/admin/email-log`, same guard): `status=problems`, `from`, `to`; `band=1` sends the
band whatever the filters; the answer gains `counts` (all, problems, delivered, sent, for the filters in
force bar status) and `failureCount` (the Overview's own count).

## Analytics

**Before:** nine cards down one long page in the old look, figures never told apart, phone rules from 700px.

**Now:**

- A summary in words first, from the same answer: how many people, set against the period before only
  when there is one to set it against, where most came from, and the page looked at most. "About" wherever
  a figure is rounded.
- A bar of parts (At a glance, Where from, Where, Pages, Clicks, Devices): one part at a time on a phone
  (`AdminKit.wireParts`), all of them down the page on a laptop, where the bar jumps to a part.
- A line under each figure saying what it counts; "Up 1 point" now says the two shares.
- **Download the numbers** as a spreadsheet for trustees.
- The days chosen are remembered for the session. "QR codes scanned" links to QR codes and "Newsletter
  issues" to Newsletter, for someone who may open them.
- Phone rules from 860px; every button 44px.

## Notifications

**Before:** no way to turn a phone off, no way to tell whether this phone is on, one Save for eleven settings,
a quiet time with one end thrown away while the screen said "Saved.".

**Now:**

- "This phone is on" with **Turn off for this phone** (the browser's own subscription and
  `DELETE /api/admin/push/subscription`, which already existed), or the steps and **Turn on**.
- Each tick saves as it is pressed and says so beside it. **Save these settings** stays, for the quiet time.
- Only the areas this person can open are offered; an "off" stored for any other area is kept.
- The quiet time needs both ends, and is said back: "Quiet from 10pm until 7am".

Nothing about subscriptions, the service worker or sending changes.

## Left out, and why

- **Send me a test notification**: needs a new endpoint that sends. Worth doing next.
- **Audit: names for donors and sign ups in the sentence.** The line links to them instead. Joining them
  in would show a donor's name to someone given the Audit but not Donations.
- **Analytics: "this month" or chosen dates**: needs the report itself to change.
