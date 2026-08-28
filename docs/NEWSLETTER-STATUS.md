# Newsletter platform — status and pickup notes

Written 2026-08-20, refreshed after TASK-311 on 2026-08-28. Point a fresh session at this file.

## ⚠️ START HERE: a real send is IN FLIGHT

A newsletter went to the **Newsletter** audience (376 people) on **2026-08-27 at 10:00**. It is not
finished. It is throttled to **70/day** and should complete around **30–31 August**.

**First thing to do: open the newsletter → "Who got it" and read the counts.**

- **"Still to send"** is the remaining queue. It should fall by ~70 a day.
- **If it has NOT moved since yesterday, something is wrong** — that is the signal to investigate,
  and the most useful single fact a fresh session can gather.
- **"We gave up on"** should be **zero**. TASK-302 revives those automatically on each tick; anything
  sitting there means the revive is not running.

**Do not start another send until this one drains.** They share the same daily allowance.

### What was actually going on (needed to read the numbers)

The provider is **Resend on the free tier: 100 emails/day**, and that allowance is shared with
donation receipts, Gift Aid confirmations, welcome emails and admin login codes.

The send was configured for the gentle rollout (200 day one, doubling), which is far over that. Two
faults followed, both fixed on 2026-08-27:

1. A capacity refusal spent one of a recipient's three attempts, so people could be — and may have
   been — **dropped permanently and silently**. Fixed in TASK-302, which also puts back anyone
   already dropped.
2. The **"Accepted" figure counted rows, not people**. Fixed in TASK-303.

**RESOLVED 2026-08-27 by a provider export** (`emails-sent-1787866411082.csv`, 200 rows): Resend
sent **all 200**, to **200 distinct people, zero duplicates** - 158 delivered, 24 clicked, 13
bounced, 5 delayed. So **182 arrived**. The 100/day worry was unfounded; nobody was missing.

What WAS wrong was our reporting: the screen said 95 delivered and 0 clicks. The provider confirms
delivery in under half a second, and the row recording who we sent to was written up to twenty
seconds later, so confirmations arriving in that gap were discarded. Fixed in TASK-305. **Any
delivery figure from before 2026-08-27 evening under-reports by roughly half.**

The verified chain: worker → relay → Resend. The relay calls Resend once per email, checks the reply
and returns 502 on refusal, which makes the send throw — and the "sent" mark only happens *after*
success. So **nobody can be marked sent without Resend accepting them**, and the queue can be trusted
even where the headline could not.

## State: LIVE, with the above send in progress

Everything below is merged and in production (task revision **79**, deployed 2026-08-27).

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
| 301 | Subject-line sentinel written as an escape, not a raw NUL byte, + a repo-wide guard |
| 302 | **Everyone gets it once**: a standing daily ceiling, and a capacity refusal no longer drops anybody |
| 303 | **What actually arrived**: per-person mailbox outcome, and Accepted counts people not rows |
| 304 | Status doc handover for the in-flight send |
| 305 | **Delivery stats under-counted by half** - the send record was written after the confirmation arrived |
| 306 | Reverted the unmatched-event retry from 305 - it would have stormed our own webhook |
| 307 | Status doc: corrected bounce count (13 not 9) + recorded the revive blind spot |
| 308 | Read-only stories storage diagnostic |
| 309 | That diagnostic behind a button rather than a terminal |
| 310 | **Were there EVER stories here** - the id high-water mark, which answered it: 3 created, 0 remain |
| 311 | **Archive instead of delete** on Stories + Contact, an erasure log, and 35-day backups |

### The tab as it is now
Three destinations — **Overview · Audiences & people · All newsletters** — and composing is a
takeover: **Write → Who → Send**, with the actions pinned to a bottom bar.

- **Overview** is the front door: reach, sends this year, typical delivery, blocked count; recent
  sends with their outcomes inline; anything in flight; what needs a look.
- **Who** is audience **cards, multi-select**. Several audiences fold into one deduplicated list.
- **Send** shows the pre-send checks, two explicit "when" choices, the gentle rollout, and a summary
  carrying the Send button.
- **Results** is its own destination — one click from any sent row.

### Verified live (re-checked 2026-08-27, after TASK-303)
- Production healthy (HTTP 200); unsubscribe rejects a bogus token (400)
- **Sending domain is now `news.nbcc.scot`** — From `newsletter@news.nbcc.scot`, Reply-To
  `newsletter@nbcc.scot` (the subdomain is send-only: **no MX, no A record**, so a reply addressed
  there would bounce — these are two separate config values and must stay that way)
- **DNS:** apex MX still `smtp.google.com` (**Gmail untouched**); DMARC now
  `p=quarantine; pct=25; rua=mailto:newsletter@nbcc.scot; fo=1`; apex SPF
  `v=spf1 include:_spf.google.com ~all`; Resend DKIM at `resend._domainkey` and
  `resend._domainkey.news`; `send.news.nbcc.scot` MX + SPF → amazonses; click tracking
  `links.nbcc.scot` (apex) and `links.news.nbcc.scot` (newsletter), both → `links1.resend-dns.com`
- **Webhook** `POST /api/webhooks/resend` returns **401** to an unsigned request — signature
  verification is on
- **Unsubscribe** rejects a bogus token (400)
- **Send worker** starts on boot (`src/index.ts` → `startSendWorker()`), on an interval with a
  re-entrancy guard. Safe across multiple Fargate tasks: the queue claim uses
  `FOR UPDATE SKIP LOCKED` plus a `sending` status and a stall sweep (TASK-274/276)
- Click tracking ON; open tracking deliberately OFF (unreliable + more invasive)

## Outstanding

**Decisions waiting on Jaimie** (raised 2026-08-27, neither is blocking today):

- **The mail plan, before December.** The 70/day ceiling protects receipts from the *newsletter*, but
  not from a busy donation day — 70 newsletters plus 40 donations exceeds a 100/day allowance and
  something fails. Options, in the order recommended:
  1. **Ask Resend for charity pricing** (quote SC047995). Costs one email; may be free.
  2. **Amazon SES** — ~4p/month at this volume, and the natural home: they are already on AWS, and
     Resend is itself a wrapper around SES (the DNS already points at `amazonses.com`). Needs real
     work though — bounce/complaint handling via SNS, click tracking via configuration sets. **A
     January job, not a Christmas one.**
  3. Resend Pro (~$20/month) for Nov–Jan only, if the above are not ready in time.
  Jaimie explicitly does not want any provider change until the current send has finished. Swapping
  mid-campaign would also throw away the sending-domain reputation built on 2026-08-26.
- **Prune the list.** **13** hard bounces in the first 200 (6.5%) — per the provider export, which is
  providers watch that number closely. They are auto-suppressed, so nothing is broken; the imported
  spreadsheet just carries dead addresses. Worth clearing before the Christmas campaign.

**Not built** (approved, deliberately deferred — none block sending):
- **K** Segments — filtered slices ("donors who gave this year"). Needs a query builder + storage.
- **L** A/B testing + drip sequences. Biggest build; least likely to earn its place at this size.
- **O** Newsletter roles + send-approval workflow. Permissions model change + state machine.
- **Q** Preference centre — choose which emails rather than all-or-nothing.

**Deferred by design:**
- ~~**D** Move newsletters to a `news.nbcc.scot` subdomain~~ — **DONE**, TASK-296/298/299.
- **B** Tighten DMARC further: now `p=quarantine; pct=25` (TASK-294). Next steps are `pct=100`, then
  eventually `p=reject`. Needs a few more weeks of clean aggregate reports first. Do NOT skip
  straight to reject.

## Gotchas that will bite (learned the hard way)

- **`npm run test:unit` on this machine silently runs ~290 FEWER tests than CI.** The npm registry
  is blocked, so `exceljs` is not installed - and 13 test files fail to LOAD rather than fail
  loudly. Vitest reports them as failed FILES while the headline test count looks healthy, so a
  broken test can pass locally and only surface in CI. That is exactly how TASK-311 reached a red
  PR. Writing a minimal stub at `node_modules/exceljs/index.js` (gitignored, local only) takes the
  suite from 2460 to 2759 passing. **Check the failed-FILE count, not just the test count.**

- **Sizes cannot tell you whether a table has data.** An empty Postgres database is ~7.7 MB, and
  the contact database holds four real messages at 7935 kB against an EMPTY stories database at
  7959 kB. TASK-308/309 built a diagnostic around that signal and it could not distinguish
  anything. The id sequence high-water mark (TASK-310) is the number that actually answers
  "was there ever data here" - it does not go backwards when rows are deleted.

- **The auto-revive only runs while the job is LIVE.** TASK-302 puts back anyone wrongly given up
  on, but it runs inside the send tick, and `listRunnableJobs` only returns jobs in `queued` or
  `running`. If every remaining row went to `failed`, `finishJobIfDrained` marks the job `done` and
  the revive never fires. **If a send shows people in "we gave up on" AND the job is finished or
  paused, the revive cannot reach them** - that needs a deliberate requeue, which is not built.

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
