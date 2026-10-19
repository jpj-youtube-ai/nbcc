# Admin > Festive Ball: a new look, the same screen underneath

Date: 2026-10-19. Asked for by Jaimie: "give that like a huge visual overhaul ... make it look
almost like a website ... it's just one big list of everything at the moment. And it's really
hard to scroll through and it's not very clear what anything does ... drop downs ... really
easy to see the data that we need to see." And, twice: "don't lose any functionality and don't
change any of the functionality of the system just a visual and UI upgrade for Admins". She
skipped the design questions ("get started") and asked to see a preview before the live screen
changes. Her explicit yes to touch the Ball admin before the Ball (7 November).

## What it is now

One scroll of twenty sub-sections under three bands (Set up, Where things stand, Send
something), with a sticky row of three jump links. Seven equal number tiles at the top. Every
setting is open and every note is on screen at once.

## What it becomes

**The Ball's own band at the top**, in the colours of the public /ball page (its night blue
and gold, `assets/css/ball.css`): "Festive Ball", the night, the venue, the two prices, how many
days are left and whether the ticket page is public. The handshake with the poster, as on the
public page (`.impeccable.md`), then the admin's cream for everything below.

**Six sections, one on screen at a time**, chosen with the same row of buttons the Get involved
tab uses: Overview, Bookings, Awaiting transfer, Guests and menu, Emails, Set up. The screen
remembers the section you were on, as Get involved does. Two names are kept on purpose: the
server tells staff to "enter the bank details under Set up first", and the email to events@
says an admin "marks it paid under Festive Ball, Awaiting transfer". Changing either name would
change an email or a server message, which is not this job.

- **Overview**: the numbers at a glance (seats sold against what was on sale, with a bar; money
  taken, donations and Gift Aid; newsletter sign ups) and "Needs you": bank transfers waiting,
  bookings with no phone number, guests still to be named, dinners still to choose. Each line
  has a button to the section that deals with it. Never "nothing needs you" while a part of it
  could not be checked.
- **Bookings**: the three downloads as three labelled cards (door list, catering list, every
  booking), the phone number check, and the bookings list.
- **Awaiting transfer**: the search, "Add a bank transfer booking" and the list.
- **Guests and menu**: guest details still to come (with "Email everyone outstanding"), then who
  has chosen their dinner.
- **Emails**: the week-before reminder and the menu email, each in its own card saying who it
  goes to, with its button.
- **Set up**: seven drop downs, each showing what it is set to now on its closed line: the
  ticket page, seats and sales (with seats held back), card fee, bank transfer, details the venue
  confirms later, the menu, when guest details close.

The two "Needs you" lines on the main Overview that are about the Ball open their own section:
bank transfers open Awaiting transfer, missing guest details open Guests and menu.

## What does not change

Every form, field, button, link and list keeps its element id, its type and its code. The same
requests are made when the screen opens, in the same order; every save, send, confirm and prompt
is the same code with the same words. Nothing on the server changes, no email changes, nothing
under `src/ball`. The prices stay fixed. Someone with view-only access sees the same things
hidden as today.

## Rules it keeps

- Nothing scrolls sideways and no box has its own scrollbar; on a phone the lists are cards.
- 44px targets on a phone; visible keyboard focus; the section buttons work with the arrow keys.
- The brand's own fonts and colours (`.impeccable.md`); gold only in the band.
- Visible wording: no en or em dashes added; the dashes in the notes that move are taken out.
- Motion is small (a section fades in), and none under reduced motion.

## Proof it lost nothing

`test/unit/admin-ball-layout.test.ts` already lists every id the screen had (TASK-422). It is
extended to all 100 ids on the screen today, each with the element and type it must still be,
and the ten forms. The jsdom tests drive the new screen: the sections, the remembered section,
the keyboard, Needs you (including the could not check case), the drop downs' current values,
and the Overview's two Ball buttons. Every existing Ball admin test must pass unchanged, and
the BDD scenarios, which drive the routes, are untouched.

## After the first pictures (my calls, before the preview Jaimie saw)

Real browser pictures at 1280 and 390px, and a sweep from 320 to 1366px, found these, each fixed
test first:

- The seats card lists what is left the way the money card lists the rest, so the two balance.
- On a phone the band is compact and the section buttons sit two by two.
- On a payment's phone card the amount stays over what it bought and "Overdue" stays whole.
- Inside Set up the forms are drawn flat (the site wide form card rule made a box in a box), the
  menu boxes are full width with Save the menu under them, and a date box is as wide as a date.
- The two chase lists become labelled cards when narrow, and give "Who booked" the room an email
  needs on a laptop. An empty list draws no empty card.
- Tick boxes are 20px with a 44px target.
- Awaiting transfer is cards up to 819px, not 599px: "Mark as paid" needs 182px, which its column
  only has from 808px, so the list scrolled sideways on a 900 to 1080px laptop. The one existing
  test changed is that threshold in `admin-fits-a-phone.test.ts`.
