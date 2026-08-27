# Newsletter platform — status and pickup notes

Written 2026-08-20, refreshed after TASK-302. Point a fresh session at this file to continue.

## State: LIVE and send-ready

Everything below is merged and in production. Nothing is in flight — no open PRs, clean tree.

### Shipped
| Task | What |
|---|---|
| 269 | Import name capitalisation, footer signup layout + invisible consent label, email divider contrast |
| 270 | Donors as a real (live, auto-updating) audience; archive an audience |
| 271 | Newsletter tab restructured into stages; audience named at every action |
| 272 | **Suppression list** (hard bounces + complaints), RFC 8058 one-click unsubscribe, unsubscribe that sticks, honest "Accepted" counts, Viewer role fixed |
| 273 | Root SPF + DMARC `rua` reporting (**DNS applied and verified live**) |
| 274 | **Background sending**: queue, pacing, retry, resume, pause/cancel, gentle rollout (200/day doubling) |
| 275 | Plain-text part on every newsletter |
| 276 | Welcome email on website signup (never on import) + **double-send fix** |
| 277 | Pre-send checks, seed test (up to 5 addresses), repeat-bounce suppression |
| 278 | Audit trail: who sent it, who got it, who added each person |
| 279 | Newsletter tab as four switchable panels |
| 280 | **Scheduled sends** — date and time, plus a send-time hint with quick-picks |
| 281 | Status doc refresh + README pointer |
| 282 | **Add a person or a spreadsheet to several audiences at once** (API) |
| 283 | **Newsletter Studio**: three destinations + composing as a full-screen takeover |
| 284 | The panel interiors — 10 unstyled controls, a 639px checkbox, the maroon-slab preview |
| 285 | Audience cards, visible pre-send checks, the results destination, 5 dead elements wired |
| 286 | Four layout faults from measuring against the wrong width |
| 287 | **The blank newsletter tab**, and every table made to fit its card |
| 288 | **Send one newsletter to several audiences at once**, deduplicated |
| 289 | Collapsible blocks |
| 290 | Status doc refreshed through TASK-289 |
| 291 | **Email preferences centre** (pick individual lists) + private vs public audiences |
| 292 | What a reader with **no name** sees — name and greeting fallbacks |
| 293 | **Registered postal address** in every email footer and the site footer |
| 294 | DMARC tightened to `p=quarantine; pct=25` (**DNS applied and verified live**) |
| 295 | Click tracking served from **links.nbcc.scot** (**DNS applied and verified live**) |
| 296 | DNS for **news.nbcc.scot**, a dedicated newsletter sending domain (**applied and verified live**) |
| 297 | **Unsubscribe: the GET asks, the POST acts** — mail-security scanners no longer unsubscribe people silently |
| 298 | **Newsletter sends from news.nbcc.scot**, with Reply-To split out to the real inbox |
| 299 | Click tracking for the new sender: `links.news.nbcc.scot` |
| 300 | **Image upload actually works**: shrink in the browser, and never fail silently |
| 302 | **Everyone gets it once**: a standing daily ceiling, and a capacity refusal no longer drops anybody |

### The tab as it is now
Three destinations — **Overview · Audiences & people · All newsletters** — and composing is a
takeover: **Write → Who → Send**, with the actions pinned to a bottom bar.

- **Overview** is the front door: reach, sends this year, typical delivery, blocked count; recent
  sends with their outcomes inline; anything in flight; what needs a look.
- **Who** is audience **cards, multi-select**. Several audiences fold into one deduplicated list.
- **Send** shows the pre-send checks, two explicit "when" choices, the gentle rollout, and a summary
  carrying the Send button.
- **Results** is its own destination — one click from any sent row.

### Verified live (re-checked after TASK-289)
- Production healthy (`/health` 200); every feature marker present in the served HTML/JS/CSS
- **DNS:** exactly one apex SPF (`v=spf1 include:_spf.google.com ~all`), DMARC
  `p=none; rua=mailto:newsletter@nbcc.scot; fo=1`, MX still `smtp.google.com` (Gmail untouched),
  Resend DKIM present at `resend._domainkey`, `send.nbcc.scot` SPF → amazonses
- **Webhook** `POST /api/webhooks/resend` returns **401** to an unsigned request — signature
  verification is on
- **Unsubscribe** rejects a bogus token (400)
- **Send worker** starts on boot (`src/index.ts` → `startSendWorker()`), on an interval with a
  re-entrancy guard. Safe across multiple Fargate tasks: the queue claim uses
  `FOR UPDATE SKIP LOCKED` plus a `sending` status and a stall sweep (TASK-274/276)
- Click tracking ON; open tracking deliberately OFF (unreliable + more invasive)

## Outstanding

Nothing blocking. The system can send a newsletter safely today.

**Not built** (approved, deliberately deferred — none block sending):
- **K** Segments — filtered slices ("donors who gave this year"). Needs a query builder + storage.
- **L** A/B testing + drip sequences. Biggest build; least likely to earn its place at this size.
- **O** Newsletter roles + send-approval workflow. Permissions model change + state machine.
- **Q** Preference centre — choose which emails rather than all-or-nothing.

**Deferred by design:**
- **D** Move newsletters to a `news.nbcc.scot` subdomain so a bad campaign can't damage receipts and
  admin login codes. **Recommended.** Blocked on adding the domain in Resend first, then repointing
  `NEWSLETTER_FROM_EMAIL`.
- **B** Tighten DMARC `p=none` → `quarantine` → `reject`. Needs a few weeks of the reports that
  started arriving 2026-08-20. Do NOT skip straight to reject.

## Gotchas that will bite (learned the hard way)

- **The mail provider allowance is SHARED.** Donation receipts, Gift Aid confirmations, welcome
  emails and admin login codes come out of the same daily pot as the newsletter. A newsletter that
  spends the lot does not just delay itself - it silently costs a donor their receipt. That is what
  `NEWSLETTER_DAILY_SEND_CAP` (default 70) exists to prevent, and why it beats `dailyCap: 0`.
- **A retry limit must know WHY it failed.** Three strikes is right for a dead mailbox and wrong for
  "come back later": TASK-302 found real people permanently dropped from a send because the provider
  was full when their turn came around three times. Classify before you count.

- **A base64 upload needs a parser cap a third bigger than the file cap.** This has now bitten
  twice - hosted documents in TASK-265, images in TASK-300. The browser sends files base64-encoded,
  which costs four bytes for every three, so a 2 MB file is 2.7 MB on the wire. If express rejects
  the body first it answers with an HTML page, `r.json()` throws, and an uncaught chain swallows it
  - the upload vanishes with no message anywhere. Keep the parser limit NEXT TO the file cap
  (`IMAGE_JSON_BODY_LIMIT` in `src/newsletter/image-validation.ts`) so they cannot drift.

- **No GET in an email may change anything.** Microsoft Defender Safe Links, Proofpoint URL
  Defense, Mimecast and Barracuda fetch every link in an incoming email to sandbox it *before*
  the recipient sees the message — and click tracking means that fetch follows the
  `links.nbcc.scot` redirect all the way to us. `GET /unsubscribe/:token` used to unsubscribe on
  sight, so a scanner could silently remove someone who never clicked, and the data looked
  exactly like a real unsubscribe. Fixed in TASK-297 (GET renders a confirm form, POST writes).
  **If you ever add another link to an email, the route behind it must be safe to fetch twice by
  a robot.** RFC 8058 one-click is unaffected — it was always a POST.

1. **Migrations must sort LAST.** `ls migrations | sort | tail`. Highest is `1785600000000`. CI can't
   catch a bad order (its DB is empty); staging/production can.
2. **Squash-merge orphans stacked PRs.** Merging one makes the next conflict. Rebase with
   `git rebase --onto origin/main <last-commit-of-the-merged-branch>`.
3. **`donate.html` is at ~99.8% of its 255KB page-weight budget.** Any addition to
   `assets/css/styles.css` or `assets/js/main.js` can turn CI red. `admin.html` is **not** in the
   budget, so admin work is unconstrained by it.
4. **`perf-budget` fails LOCALLY on Windows only** — `core.autocrlf` adds ~3.8KB of CR bytes. Compute
   the LF total before believing a regression.
5. **npm registry is blocked on the owner's machine** by IT policy, so `exceljs` won't install:
   `tsc` and 13 admin suites run in CI only. Do not try to bypass the block.
6. **`app.js` binds by element id, and fails SILENTLY.** Never remove or rename an id — wrap and
   restyle. Pinned by `test/unit/newsletter-studio-ui.test.ts`, which also asserts every container
   the tab renders into is actually referenced by `app.js` (TASK-283 shipped five dead elements).
7. **No `.nl-panel` may start visible.** `app.js` chooses which one shows; markup that picked a
   winner made the whole tab open blank (TASK-287). Pinned by the same test.
8. **`.admin-table` sets `white-space: nowrap` on every cell**, so any table grows to its longest
   value and scrolls its card sideways. Newsletter tables override it and use `table-layout: fixed`.
9. **Measure against the REAL width.** Content is ~1006px (1280 max-width − 210px nav − padding), and
   the Overview's main column ~620px of that. Four layout faults came from a CSS harness that
   rendered full-bleed and so measured a page that does not exist.

## Before the first real send
1. **Seed test** to your own Gmail / Outlook / Yahoo — check WHERE each lands, not just that it renders
2. Read the confirmation — it names every chosen audience and the deduplicated count
3. Tick **"Ease this one out gradually"**
4. Next day: check the delivery figures on the Overview and the **Blocked addresses** panel
