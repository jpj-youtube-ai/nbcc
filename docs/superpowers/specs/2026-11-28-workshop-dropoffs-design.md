# Workshop drop-offs: design

Approved by Jaimie, 28 November 2026 (design in chat, then the tablet mockup).

## Why

People bring things to the Elves' Workshop all day: selection boxes, hats, toys. Today nobody gets a
proper thank you, and nobody joins the newsletter. A tablet left open on one page lets each person
leave their details in a few seconds, get a thank you at once, and leaves staff a list to send
proper thank-you letters from later.

## What

- **The page, nbcc.scot/workshop.** Unlisted (not in the menu, the sitemap or the site map page) and
  `noindex`. The site's own banner and footer. Heading "Thank you for bringing something in", line
  "Leave your details and we'll say a proper thank you." Boxes: Your name, Email, What did you bring
  today?, Who are you with? (optional; free text, with tap suggestions Individual, Church group,
  Business that fill the box), Mobile (optional). A tick box "Send me the NBCC newsletter (a few
  emails a year)", **unticked** to start (PECR: consent is a positive act). Big Send button. Afterwards
  "Thank you, [first name]!" and "We've sent you a little thank you by email." for about six seconds,
  then the form is empty again for the next person (a tap brings it back sooner).
- **The email.** Sent at once, from and replying to the giving inbox, naming what they brought. A
  line saying they are on the mailing list when they ticked it. No separate newsletter welcome
  email (one email is kinder than two, as for Elf Detective School). Wording shown to Jaimie
  before it goes live. Listed in Admin > All emails, in a new group "Workshop drop-offs".
- **The newsletter.** Ticked: `subscribeSelf(..., "workshop")`, a new consent source `workshop`.
  Counts as a public sign up for the Newsletter New pill.
- **The admin.** Admin > Giving > Workshop drop-offs (gated like Invoices: view of Donations sees
  it). Newest first: when, name, email, what they brought, who they're with, mobile, newsletter yes
  or no, and "Letter sent" once an in-kind thank-you letter has gone to that email since. Each row:
  **Write a thank you letter** (for those who can edit Thank you) opens Admin > Thank you with the
  letter already set to a gift in kind, their name, email and what they brought; and **Remove**
  (edit of Donations, asks first) for a test or nonsense entry. A New pill on the menu item when
  someone has dropped something off since you last looked, and a phone notification line that names
  nobody: "Someone dropped something off at the workshop".
- **Protection.** A hidden honeypot field (filled: a cheerful OK and nothing saved), and a per
  address rate limit set high enough for one busy tablet: 60 an hour.

## Approaches

1. **This one: a page on the site, a table, an email and an admin list.** Everything stays in the
   site: the newsletter list, the thank-you letters, the New pills. Chosen.
2. A Google Form. Quick, but the details live outside the site and the newsletter list, and there is
   no instant branded thank you.
3. A paper sheet typed up later. What this replaces; slow and the thank you comes late.

## Left to the builder

Names in code (`drop-offs`, table `workshop_dropoffs`; "workshop" alone is already used by Fill a
Red Bag's workshop pictures), the exact admin layout within the kit, and the test details.
