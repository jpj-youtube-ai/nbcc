# Newsletter platform — status and pickup notes

Written 2026-08-20. Point a fresh session at this file to continue.

## State: LIVE and send-ready

Everything below is merged and in production unless marked otherwise. The system can send a
newsletter safely today.

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
| 279 | Newsletter tab as four switchable panels (55% shorter) |
| 280 | **Scheduled sends** — OPEN as PR #446, green, not yet merged |

### Verified live
- Production app healthy; four-panel newsletter tab live
- Resend webhook returns 401 to unsigned requests (secret configured correctly)
- Click tracking ON; open tracking deliberately OFF (unreliable + more invasive)
- DNS: exactly one apex SPF (`v=spf1 include:_spf.google.com ~all`), DMARC with
  `rua=mailto:newsletter@nbcc.scot`, propagated across Google/Cloudflare/Quad9. MX, A records,
  Google verification, Resend DKIM/SPF all intact.

## Outstanding

**Immediate:** merge PR #446 (scheduled sends), then promote to production.

**Not built** (approved by the user, deliberately deferred — none block sending):
- **K** Segments — filtered slices ("donors who gave this year"). Needs a query builder + storage.
- **L** A/B testing + drip sequences. Biggest build; least likely to earn its place at this size.
- **O** Newsletter roles + send-approval workflow. Permissions model change + state machine.
- **Q** Preference centre — choose which emails rather than all-or-nothing.

**Deferred by design:**
- **D** Move newsletters to a `news.nbcc.scot` subdomain so a bad campaign can't damage receipts and
  admin login codes. **Recommended.** Blocked on adding the domain in Resend first, then repointing
  `NEWSLETTER_FROM_EMAIL`.
- **B** Tighten DMARC `p=none` -> `quarantine` -> `reject`. Needs a few weeks of the reports that
  started arriving 2026-08-20. Do NOT skip straight to reject.

**Idea, not built:** a "recommended send time" hint (general evidence favours Tue-Thu 9-11am). Would
be honest as a *hint*, not a recommendation — there is no open-tracking data to personalise it.

## Gotchas that will bite (learned the hard way)

1. **Migrations must sort LAST.** `ls migrations | sort | tail`. Highest is `1785500000000`. CI can't
   catch a bad order (its DB is empty); staging/production can.
2. **Squash-merge orphans stacked PRs.** Merging one PR makes the next conflict. Rebase with
   `git rebase --onto origin/main <last-commit-of-the-merged-branch>`.
3. **`donate.html` is at ~99.8% of its 255KB page-weight budget.** Any addition to
   `assets/css/styles.css` or `assets/js/main.js` can turn CI red.
4. **`perf-budget` fails LOCALLY on Windows only** — `core.autocrlf` adds ~3.8KB of CR bytes. Compute
   the LF total before believing a regression.
5. **npm registry is blocked on the owner's machine** by IT policy, so `exceljs` won't install:
   `tsc` and `subscriber-import-parse.test.ts` run in CI only. Do not try to bypass the block.
6. **`app.js` binds by element id.** When restructuring `admin.html`, never remove or rename an id —
   wrap and restyle instead, then verify the id set before/after.

## Before the first real send
1. Seed test to your own Gmail / Outlook / Yahoo — check WHERE each lands, not just that it renders
2. Read the confirmation (it names the audience and the count)
3. Tick **"Ease this one out gradually"**
4. Next day: check delivery stats and the **Blocked addresses** panel
