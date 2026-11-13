# Admin Get involved: a clearer layout (2026-11-13)

## Why

Jaimie, 13 Nov 2026: the Get involved tab, and above all a sign up once it is opened, is "one big long
scrolling list with lots of boxes and lots of buttons". Someone who does not know the system cannot
tell what each part is for. They asked for a UI refresh only: no information changes, plain English,
explanations on the buttons, and "a banner at the top that takes you through sections". They asked
not to be asked questions, so every call below is mine.

What I measured on a stand in with invented data: an opened sign up is 20 boxes one under another,
5,364px tall on a laptop, with 19 buttons spread through it. The Sign ups list has two rows of
filters, 14 buttons, with nothing marking which ones mean "this needs you".

## Goals

- An opened sign up shows one part at a time, chosen from a bar of six at its top, each part opening
  with one plain sentence saying what it is for.
- A part with something waiting for you carries a dot on its button (and says so to a screen reader).
- The Sign ups filters in labelled groups: what needs you (as tiles, each with a short explanation),
  which to show, and what kind.
- (Dropped while building: a short line under each of the five section buttons. The line under the bar
  already says what the section is for, and a second one inside each button made the bar twice as tall.)
- The event editor gets a bar of its eight steps that takes you to each one.
- Approve and Mark finished each say what pressing them does.

## Non goals

- No information added or taken away, no wording changed except the new explanations.
- Nothing on the server. No change to what any button does.
- The Festive Ball ticket report stays where it is (moving it is its own item, after the Ball).
- Tickets and pledges, Emails and Settings keep their layout; they are short.

## Anti goals

- A scrollbar inside any box, or a page that scrolls sideways (house rule).
- Hiding a field with an error in a part you cannot see: errors only ever appear in the part you are
  working in, because every action re-draws the part it was pressed in.
- Anything that moves or blinks without the person asking for motion.

## Approaches considered

1. **Tabs inside the opened sign up (chosen).** The existing panels, untouched, grouped into six parts;
   a bar shows one part at a time, the pattern the Festive Ball tab already uses
   (`#view-ball .ball-sections`, `data-ball-part`). Smallest change to the 19,000 line admin script, every
   panel keeps its markup, ids and wiring, and staff already know the pattern from the Ball.
2. **Open a sign up as its own screen**, like a donor. Cleaner page, but every panel's wiring, the focus
   memory and the list's redraw assume the detail sits under its row; a far larger and riskier change for
   the same result on screen.
3. **A pinned "jump to" bar over the same long page.** Keeps the scroll Jaimie dislikes; used only for the
   event editor, where the steps are one form saved as a whole and must all stay in the page.

## The design

### An opened sign up

A bar of six buttons, pinned under the menu on a laptop (top 60px, as the Ball's), three by two and not
pinned on a phone (pinned, two rows would take a third of the screen):

| Part | Holds (the existing panels) | Its sentence |
|---|---|---|
| At a glance | Where it is up to; Changes to check; Take it off Get involved | Where this sign up is up to, and the big decisions: approve it, check a change they asked for, or mark it finished. |
| Keeping in touch | Calls; Keeping in touch; Requests; Welcome pack | Calls to make, things they asked us for, and their welcome pack. |
| Their page | Photo for its page; News updates; Photos from the organiser; Supporter wall; Thank yous to supporters; the team; In memory | What people see on the website, and what the organiser has sent in for it. |
| Money | Money raised; Cash paid in; Sharing with another cause | How much they have raised, online and in cash. Add cash here when they pay it in, so their total is right. |
| Their details | What they told us; Sport and the T-shirt; The organiser; What they would like; Change the details | Everything they told us when they signed up, and how to get in touch. Change the details to correct anything. |
| History | History | Everything that has happened to this sign up, and who did it. |

- It opens on At a glance. The part chosen is kept while the same sign up stays open (every save
  re-draws the list), and goes back to At a glance when another opens.
- Dots: At a glance when it is New, has a change to check, says they have finished, or is due the
  question about coming off Get involved; Keeping in touch when a call is due, a request is to do,
  buckets are due back or a pack is to send, or a keeping in touch prompt is showing; Their page when news,
  photos, a thank you or an in memory message is waiting.
- Left and right arrows move along the bar, as on the Ball's.
- A part with nothing in it for this sign up is not offered (for example Keeping in touch for a declined
  one with no panels).
- Approve: "Says yes and emails them. Their page goes on the website if it is meant to be shown there."
  Mark finished: "For when everything is in. You are asked to make sure first." (Both checked against
  README, "Community fundraising"; the question only mentions the thank you email for a sign up with a
  page, so the hint does not promise it.)
- Every message appears in the part its button is in. The supporter wall has its own status line
  (`frWallStatus`), and the in memory envelopes report in the In memory box, as the sign up's main line
  is in At a glance.

### The Sign ups filters

- **Needs you**: New, Calls due, Requests to do, Buckets not back, Packs to send, as tiles in the
  Donations look: the count large, the name, and a short line (New: "waiting for a yes or no"; Calls due:
  "time to ring them"; Requests to do: "things they asked us for"; Buckets not back: "collection buckets or
  tins still out"; Packs to send: "welcome packs to post"). A tile at 0 is quiet.
- **Show**: All, Approved, Finished, Declined.
- **What kind**: the five kind buttons as today.
- The filters behave exactly as now; only their arrangement and the new lines change.

### The section buttons

Unchanged. The line under the bar (`data-gi-intro`) already says what each section is for.

### The event editor

A bar of the eight step names above the form, pinned under the menu on a laptop, wrapping on a phone;
pressing one takes you to that step. Every step stays in the page, as the form is saved as a whole.

## Left to the builder

Exact spacing and colours within the existing admin palette; the icons, if any (none planned).
