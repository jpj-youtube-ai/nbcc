# Email audit: remove the addresses that are dead

Date: 2026-10-05. Asked for by Jaimie ("on the email audit, I would like to be able to go through
and remove the emails from there that are bouncing or have failed, since they clearly aren't live
anymore"). Approved in chat the same day: "Tidy away and stop emailing them", then "Looks right,
build it", with pictures before it is live.

## Why

Admin > Email audit pins everything that went wrong in the last 14 days in a red band, "Needs a
look", and the Overview counts the same rows ("N emails failed or bounced in the last 2 weeks").
Nothing can be done about a row once it has been looked at. A dead address stays in the band for
two weeks, comes back every time something is sent to it, and the count never reaches nought, so
the band stops meaning "look at this".

## What staff see

**The red band** lists the problems by address: one block for each address, its problems under it
(what happened, which email, when). A decision is about an address, not about one email, so that
is how the band is laid out. Each block has two things to press, for someone who may edit the
Email audit:

- **Remove and stop emails** (the button). Every problem for that address leaves the band and the
  Overview's count, and the address is blocked: newsletters and fundraising emails no longer go to
  it. It shows under Newsletter > Blocked addresses as "Blocked by staff". Later failures for it
  stay out of the band for as long as it is blocked. It asks first.
- **Just tidy away** (the link). The problems leave the band and the count, and nothing else
  changes. If the address fails again, it comes back.

One of the charity's own addresses (@nbcc.scot) can be tidied away and is never blocked: blocking
it would stop the charity's own notes to itself.

**Nothing is deleted.** The full list below keeps every row for its six years. A row that was
removed says so under its status ("Removed, emails stopped, by ... on ..." or "Tidied away by ...
on ...") with **Put back**, which undoes it: the problems return to the band and, if Remove and
stop emails was what blocked the address, it is unblocked. An address that was already blocked for
its own reason (its mail bounced, or it marked us as spam) stays blocked, and the message says so.
Straight after either press, the line that says what was done has Put back too.

**What does not change.** Receipts, booking confirmations and sign in codes still go to a blocked
address, as they do today for an address blocked for bouncing. Changing that would change the
path every email takes, the Festive Ball's included, and nothing Ball related changes before 8
November. Someone who can only view the Email audit sees the band as blocks and no buttons.

## How

**One new table and no change to any existing one.** `email_log` is written by every send (the
Ball's too) and `email_suppressions` is read by every newsletter send, so neither is altered.

`email_audit_removals`: `email` (lowercased), `kind` (`stop` or `tidy`), `blocked` (true when this
removal is what blocked the address), `removed_at`, `removed_by`, `put_back_at`, `put_back_by`.
A removal is never deleted: putting back stamps it.

**Hiding is decided when the band is read, never when an email is sent.** A problem row (our send
failed, or the mailbox bounced it or marked it as spam) is hidden when its address has a removal
that has not been put back, and either:

- the row is older than that removal, or
- the removal is a `stop` and the address is still blocked.

So unblocking an address under Newsletter makes its later failures show again, with no code there
knowing about this. `listRecentEmailFailures` (`src/db/email-log.ts`) carries the rule, and both the
band and the Overview's count read through it. `listEmailLog` marks the rows the rule hides, with
who and when.

**`email_suppressions` allows one active row an address.** So an address already blocked for a
bounce cannot also get a "Blocked by staff" row. Remove and stop emails calls
`suppressEmail(email, "manual", ...)`, which then does nothing, and the removal itself is the record
of the staff decision (`blocked` false). Put back unblocks only when `blocked` is true and the
active block is still that manual one.

**Two routes**, both needing email-audit edit:

- `POST /api/admin/email-log/remove` `{ email, stop }`. 400 for a bad address, and for `stop` on one
  of the charity's own addresses.
- `POST /api/admin/email-log/put-back` `{ email }`.

**The screen** (`loadEmailAudit` in `assets/js/admin/app.js`): the band's rows are grouped by
address into blocks; the two controls and the status line; the mark and Put back in the full list.

## Tests

- **Rules** (`src/email/audit-removals.ts`, pure): which addresses are the charity's own.
- **Database modules**, with the pool mocked: the band's rule in SQL, the mark in the list, a
  removal, a put back.
- **Routes**, with the modules mocked: who may, what is refused, what each press does, that an
  own address is never blocked, that Put back unblocks only what Remove blocked.
- **The screen, in jsdom**: blocks by address, the two controls, the confirmation, the own
  address, a viewer, the mark and Put back, what is said when it could not be done.
- **BDD**: tidy away and it leaves the band; fail again and it is back; remove and stop, and a
  later failure stays out and the address is blocked; put back; a person who can only view cannot
  remove.
- **Real browser**: the band and the list at 1280px and 390px, nothing scrolling sideways. Pictures
  to Jaimie before it is live.

## Not doing

- Stopping receipts or booking confirmations to a blocked address (see above).
- Removing rows from the six year record.
- A screen of everything removed. The full list, filtered to Bounced or Failed, shows them.
