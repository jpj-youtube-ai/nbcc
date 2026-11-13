# The admin as a phone app, with notifications

Design, 12 November 2026. Written for Jaimie to approve and for a builder to work from.

**Revised the same day.** The first version of this document said the admin had only two "New"
pills and that this project would have to build the rest. That was wrong — it was written against
a checkout 157 commits behind `main`. The New pills already exist across the whole admin
(TASK-478). The correction makes this project smaller and the result more consistent; what
changed is recorded under "What already exists" below.

## What this is for

Jaimie runs the charity from her phone as much as from a desk. Today, finding out that a
donation came in, someone signed up to fundraise, or a message arrived means opening the admin
and looking. Nothing reaches her phone at all.

She asked for two things: the admin pinned to her iPhone home screen with NBCC's own icon, and a
notification whenever something new happens — "I want to keep up to date with everything."

## What success looks like

Jaimie taps the maroon NBCC icon on her home screen and the admin opens like an app. When a
donation lands at an event, or a school signs up to fundraise, or somebody sends a message, her
phone buzzes within seconds and the notification says what it was. She taps it and lands on that
thing in the admin.

## Goals

1. The admin installs on an iPhone home screen as a proper app — its own icon, its own name,
   opening in its own window rather than a Safari tab.
2. A notification for **every** new arrival, immediately, at any hour of the day or night.
3. What buzzes her phone is **exactly** what would raise a New pill in the admin — same areas,
   same permission rules, same idea of "new to you". One concept, two places.

## Non-goals

- **The public site's icon is not part of this.** Pull request #699 already does that work and
  should ship as it is. This is the admin only.
- **Not a new pill system.** One already exists and is good. This uses it.
- Not a native app from the App Store, and not notifications by email or text.
- Android will work, but iPhone is what is being designed for.

## Anti-goals — what would make this a failure even if it technically works

- **Jaimie switching it off within a fortnight because it is too noisy.** This is the real risk.
  She has asked for a buzz every single time and that is what gets built as the default, but the
  setting to calm it down ships on day one so she never has to come back and ask.
- A notification putting a donor's name on a lock screen where somebody else can read it.
- Somebody seeing, in a notification, something their admin permissions would not let them see
  on screen.
- A notification and the admin disagreeing about what is new.
- Notifications still arriving on the phone of somebody who has left the charity.

## What Jaimie decided

- **The icon** is the supplied `NBCC_LOGO_DARK_BG_.svg` (full-colour elf, white outline, NBCC in
  white) on **maroon `#800000`**, using the whole logo rather than the elf alone. Shown to her as
  option A on 12 November and chosen.
- **Buzz every time.** No bundling several arrivals into one notification, and no quiet hours
  overnight. Asked directly about 2am donations; her answer was "nah, just buzz every time".
- **Everything counts.** Her words: "donations, new Get involved, it all."

## What already exists, and must be used rather than rebuilt

**The New pills (TASK-478)** — `src/admin/whats-new.ts`, `src/db/whats-new.ts`,
`src/routes/admin-whats-new.ts`, spec at
`docs/superpowers/specs/2026-09-30-admin-new-pills-design.md`. It already provides:

- **13 areas**, including donations, monthly, fundraising (Get involved), contact, stories, ball,
  newsletter, business supporters, events, analytics, QR, Fill a Red Bag and invoices.
- **Arrival queries** per area (`ARRIVALS` in `src/db/whats-new.ts`) answering "what is the latest
  thing to arrive after this moment".
- **Per-person "last seen"**, so new means new *to you*, and opening a section clears it.
- **Permission filtering** (`reachableAreas`), so a pill never appears on a section somebody
  cannot open.
- `GET /api/admin/whats-new` and `POST /api/admin/whats-new/seen`.

This is the right source for notifications, and using it is what keeps the phone and the screen
telling the same story. The only gap is that `latestArrival` returns a time, not a description —
notifications need enough detail to say "£25 donation — card reader", so the arrival queries gain
a sibling that returns the item, not just its timestamp.

**What is in the way:** pull request #699 sets the site manifest to `display: "browser"`, which
makes a pinned page a bookmark. iPhones only deliver notifications to a page added to the Home
Screen as a web app, which needs `display: "standalone"`. #699 should still ship unchanged for the
public site; the admin needs a manifest of its own. #699 also edits `admin.html`'s head, so
whichever lands second will need its head lines reconciled rather than duplicated.

## The calls the builder is making, not Jaimie

Flagged so she can overrule any of them.

1. **Notifications follow the pills' existing permission rules.** Somebody who cannot see
   Donations does not get donation notifications.
2. **No personal names in the notification text.** "£25 donation — card reader", not "£25 from
   Sarah McBride". A phone on a table at an event shows its lock screen to the room. The name is
   there the moment she taps through.
3. **The admin gets its own manifest and its own icon**, separate from the public site's. Two
   different icons on the home screen is a benefit, not a compromise.
4. **A Notifications settings screen** carrying the calm-it-down switches (bundle arrivals, quiet
   hours), both off by default, so her stated preference is what she gets and changing her mind
   costs her a tap rather than another piece of work.
5. **Per-area choice.** The settings screen lets each person turn individual areas off, because
   "everything" is Jaimie's answer and will not be everybody's.

## Constraints the builder must respect

- **iPhone reality.** Notifications only work once the admin is added to the Home Screen. The
  permission prompt must come from a deliberate tap, and iOS will only ask once — if it is
  refused, the icon has to be deleted and re-added. The setup screen has to say so plainly
  *before* it asks.
- **Per device, per person.** Jaimie's phone and Jodie's phone each need pinning and allowing.
- **A new dependency.** `web-push` is not in `package.json` today.
- **Golden rule 3.** The signing keys are new config, so they go through `src/config/schema.ts`,
  `.env.example`, the SSM parameter in `infra/modules/app/main.tf`, the task definition's
  `secrets` in `ecs.tf`, and that parameter's ARN in the `exec_secrets` IAM policy.
- **Golden rule 2.** The subscriptions table is an additive migration, and it must sort last
  against `main` immediately before merging.
- Unit tests stay database-free; anything user-visible gets a Cucumber scenario. There is no
  local database, so migrations and BDD only prove themselves in CI.
- README updated in the same pull request.

## What is left to the builder

- How the service worker is scoped and served so it controls the admin's pages.
- Whether a failed send retries, and when a dead subscription is dropped.
- The exact wording of each notification, within the no-names rule above.
- Whether notifications are sent at the moment of arrival or by a short poll over the same
  arrival queries the pills use.
- Whether the first version covers all 13 areas or ships donations, Get involved and contact
  first with the rest following.
