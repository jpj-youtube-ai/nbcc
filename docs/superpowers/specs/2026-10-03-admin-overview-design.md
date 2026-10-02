# Admin Overview, at a glance — design

Date: 2026-10-03. Asked for by Jaimie ("make the overview really useful… at a glance it should keep
us up to date"); designed in chat and approved.

## What it is for

Opening the admin should answer, in this order: **what needs us**, **how we are doing**, and **what
is coming up**. Today the Overview is five Gift Aid queue counts and the last ten donations; the
things that actually need someone are spread across a dozen screens.

## Decisions

| Question | Answer |
|---|---|
| First job | "Needs you": things waiting on a person, each one click from where it is dealt with. |
| Order | Most urgent first: money or overdue, then waiting on a reply, then slower deadlines. Anything at zero is left out; a quiet day says "Nothing needs you right now." |
| Numbers | All four, high level, one line each: money in, monthly givers, the Festive Ball, the website. |
| Coming up | The next 2 weeks, in date order. |
| Who sees what | Each line only for people who can see the screen it comes from, using the same access checks as that screen. |
| Build | Three stages, each live before the next: 1 Needs you, 2 the numbers, 3 Coming up. |

## Needs you (stage 1)

One line each, in plain words with the count, and a button to the screen that deals with it. Three
levels, shown by a coloured dot and kept in this order:

**1. Money or overdue**
- Bank transfers past their pay-by date (Festive Ball; ball: view).
- Monthly gifts that failed to take: individual monthly givers whose state is past due (donations: view).
- Gift Aid ready to claim: the eligible donations not yet claimed, with the amount (claims: view).
- Emails that failed, bounced or were marked spam in the last 14 days (email-audit: view).
- Fundraising items lent out and due back (fundraising: view).

**2. Waiting on a reply**
- Contact messages waiting for a reply (contact: view).
- Fundraising sign ups to approve, changes to check, and fundraisers who say they have finished (fundraising: view).
- New stories to read (stories: view).
- Businesses due a thank you call (business-supporters: edit). (Built in stage 1: the calls. The other
  business supporter to-dos are left to that screen's own "things to do" for now.)
- Fundraisers to call (fundraising: view).
- Your own outreach to-dos (outreach: view).
- Big gifts not yet thanked with a letter (thank-you: view).
- Bank transfers waiting for their money, not yet overdue (ball: view).

**3. Slower deadlines**
- Gift Aid: adjustments due, declarations not back yet, declarations due a review, records reaching
  the end of their keep date (claims: view); small donations scheme (GASDS) deadline near (gasds: view).
- Festive Ball guest details still missing, once guest details close within 3 weeks (ball: view).

Each line names its screen ("Festive Ball", "Contact form"…) on its button, which opens that screen.

## How it works

- **One request:** `GET /api/admin/overview` (any signed-in person) returns `{ updatedAt, needs: [...],
  failed: [...] }`. For each source it first checks the person may see that section (the same
  permission map `/api/admin/me` uses); a source they cannot see is skipped silently, never counted.
- **Sources are independent:** each reads its count with its own query, all at once. One that fails is
  listed in `failed` by name, and the screen says "Could not check: Festive Ball", while the rest show.
- **Pure rules:** turning counts into lines (the words, the singular and plural, the level, the order,
  leaving out zeros) is a pure function, `needsLines(counts)`, tested on its own.
- **The screen:** the "Needs you" card replaces the five Gift Aid cards (those counts become lines in
  level 3). The recent donations list stays underneath, cut to five. It refreshes each time Overview is
  opened and says when it was last updated. The contact bar at the top of every screen is unchanged.

## Stage 2: the numbers

One line each, for those who may see them:
- **Money in** (donations: view): this month so far against the same days last month, split into
  donations, the Festive Ball and fundraising pages.
- **Monthly givers** (donations: view): how many give, the monthly total, joined and stopped this month.
- **Festive Ball** (ball: view): seats sold of the room, money taken, seats held for transfers, days to go.
- **Website** (analytics: view): visitors in the last 7 days against the 7 before (the Analytics
  screen's 7 day view), people on now, the top channel. Left out while counting is switched off.

Built as TASK-509, a card titled "How we are doing" under Needs you. Money is in whole pounds; each
part of Money in carries its own screen's gate, and the button opens the first screen the person may
see. The card is hidden for someone who may see none of the numbers.

## Stage 3: Coming up

The next 14 days in date order: events (events: view), fundraisers' event days (fundraising: view),
scheduled newsletters (newsletter: view), the next ticket report (events and ball: view), and the
Festive Ball's key dates: sales close, guest details close, the night itself (ball: view).

## Errors

- A source that fails: its name in "Could not check", the rest shown.
- The whole request fails: "The overview could not load. Try again." with no false "Nothing needs you".

## Testing

- Unit: `needsLines` (words, plurals, levels, order, zeros left out); the route's access rules (a
  section the person cannot see is never asked for, and never shown); one failing source shows as
  failed while the rest answer; the screen in jsdom (lines, buttons open the right screen, the quiet
  day, a failed source, the whole thing failing).
- BDD: an admin sees a waiting contact message and a pending fundraising sign up; a viewer without
  contact access never sees the contact line.

## Out of scope

Assigning items to people, dismissing an item, and email or phone alerts.
