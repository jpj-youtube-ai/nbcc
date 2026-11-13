# The Overview, the Contact form and the phone menu, in the Donations look

Design, 12 November 2026. Asked for by Jaimie: "making the overview page actually look and function
well. I love the elf detective and donations page. They also look and work great on mobile and I
would love you to do that for the overview and contact form. Also make the main menu etc and
navigation bars work for mobile too currently they are all over the place." She saw mockups of all
three, today beside new, on an iPhone and on a laptop, and said "look great go for it!"

## What is wrong today, measured on a 375px iPhone

| Screen | Today | Mockup |
|---|---|---|
| Overview | 4,331px, 5.3 screens. Each "Needs you" line is a sentence over a pale button on its own row (128px each); recent donations are a table reflowed to 1,534px for five gifts. | 2,620px, 3.2 screens |
| Contact form | 4,585px, 5.6 screens. A six-column table crushed into 375px breaks every word letter by letter ("REC/EIVE/D", "Vie/w"); 624px per message. Unreadable. | 1,510px, 1.9 screens |
| Phone menu | 27 plain-text links wrapping like a word cloud, none looking tappable. The top bar takes about 300px of the first screen before anything useful. | A two-column grid of tappable tiles; a one-line top bar |

## The look

Head Elf HQ's and the Donations gift log's, borrowed by value and not by class, exactly as
`assets/css/admin-donations.css` did: NBCC's colours and fonts, chunky pieces with a deep maroon ink
edge (2.5px `#3A0B0B`), a hard offset shadow (`3px 4px 0`) that presses in when tapped, roomy, plain
words, cards rather than tables. Playfair Display for headings and big figures, Poppins for words.

## What Jaimie decided

1. **The look**, as mocked up.
2. **A bar along the bottom on phones**: Overview, Donations, Get involved, Contact, Everything (the
   last opens the full menu).
3. **A message opens where it is** on the Contact form, the way a gift opens in Donations, rather
   than on a separate screen.
4. **The menu keeps today's order and groups.**
5. **On a laptop the Overview is two columns**: Needs you on the left, the rest on the right.

## The screens

**Overview.** *Needs you* is one card per line, the whole card the button, the count large on the
left (as Donations leads with the amount), the words beside it and the screen it opens beneath,
grouped under three headings: Urgent, Waiting on you, Coming due. *How we are doing* is the gift
log's scoreboard: a tile each, the figure large. *Coming up* is a ledger of slim cards under day
headings. *Recent donations* are five compact gift cards with "See them all". The quiet-day line,
"Could not check: …", the could-not-load message, and "not part of your access" all stay, word for
word.

**Contact form.** The three filters become pressable tiles showing their counts (All, Waiting,
Replied). Messages are cards under day headings: name, time, the first two lines, a mark for waiting
or "Replied by …". Tapping one opens it in place with its email, phone if given, when it came, the
whole message, and the same actions as today (Reply in Gmail, Mark as replied or new, Archive,
Restore, Erase permanently, each shown exactly when it is today). One open at a time.

**Phone menu (below 860px).** The top bar becomes one line: the logo, "NBCC Admin" and the Menu
button. Who is signed in, My account and Sign out move to the foot of the open menu. The open menu is
the same groups and screens in today's order, drawn as a two-column grid of tiles; where you are is
pressed in maroon; New pills sit on their tiles.

**The bottom bar (below 860px).** Five tabs, each an icon and a word. The tab for where you are is
marked. A tab shows a dot when its screen has a New pill. A tab whose screen this person may not open
is not there, by the same gate as its menu link.

## Goals, non-goals, anti-goals

**Goals:** the three screens above work and read well on a phone; the phone menu and bottom bar fix
navigation on every admin screen; nothing anyone uses goes away.

**Non-goals:**
- **The desktop banner is unchanged.** Its drop-downs, hover, keyboard and Escape behaviour
  (TASK-572, `test/unit/admin-top-banner.test.ts`) were built carefully and nobody has complained.
- **Search keeps its table.** The Overview's recent donations used the same `donationsTable()`; the
  Overview gets its own cards and Search is left alone.
- No change to what any screen shows, who may see it, or what any button does.
- Other screens' own contents are not restyled. They gain the new phone top bar, menu and bottom bar.

**Anti-goals:** a phone menu that scrolls inside a box; a bottom bar that covers the last thing on a
page; a tab that offers a screen the person cannot open; a card that looks tappable and is not; any
behaviour a test pins today quietly lost rather than deliberately kept.

## Constraints

- **The phone breakpoint is 860px**, which app.js and admin.css already agree on
  (`test/unit/admin-fits-a-phone.test.ts`). Every phone rule here uses it.
- The open menu stays in the page, so nothing scrolls inside it; the closed list is hidden without
  `display:none`, so a refresh still returns you to your section; every control at least 44px.
- The admin's house rules for the gift log apply: every new class prefixed (`ov-`, `ct-`, `pm-` for
  the phone menu and bar), no `!important`, no side stripes or gradient text, motion only for someone
  happy with it and only `transform` and `opacity`.
- Its own stylesheet, `assets/css/admin-overview.css`, linked only from `admin.html`. The public
  site's page-weight budget is not touched.
- Every existing test that pins these screens is kept or updated on purpose, its promise intact.

## Approaches considered

1. **Chosen: restyle in place.** A new stylesheet, and the Overview's and Contact form's renderers
   rewritten to draw cards; the phone menu restyled with CSS over its existing markup; the bottom bar
   added. Desktop behaviour untouched.
2. **A new admin shell.** Rejected: it would churn every screen and the desktop banner Jaimie is happy
   with, to fix three.
3. **CSS only, over today's markup.** Rejected: a table cannot become readable cards on a phone, nor
   can a count move in front of its sentence, without changing what is drawn.

## The one server change

Two additive fields, so a card can show the figure large: each Needs you line gains `count` and
`words` (it is already built as `${count} ${words}`), and each How we are doing line gains `figure`
and `rest` (its headline split at the first space after the figure). `text` and `headline` stay, for
anything that still reads them and for screen readers.

## What is left to the builder

- The exact icons, within "an icon and a word" and the mockups' line style.
- How the bottom bar leaves room for the last thing on a page.
- Wording of the day headings, matching the gift log's ("Today", "Yesterday", "Thursday 5 November").
