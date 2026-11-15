# Admin refresh: Site pages, QR codes, Team, Manage access, My account (2026-11-14)

One area of `2026-11-14-admin-refresh-design.md`. Five screens take the kit's look (the class `ak`), every
fault in their audit is fixed, and each gains the features below. Nothing on them is taken away. Their
own rules are in `assets/css/admin-settings.css`, every one named through its view; the new classes
start `set-` (the `qr-` and `sa-` rules stay in `admin.css`, where two tests read them).

No route, permission, invite, password or sign-in rule changes. The server is untouched: every feature
here is drawn from answers the screens were already sent.

## Shared by the five

- **Ask first, in the page.** Anything big or permanent opens a short question beside the button that
  was pressed (`askFirst` in app.js): what will happen, a button that does it and one that leaves things
  as they are. No browser question boxes and no `alert()`.
- **Said where you are looking.** Each card has its own status line; a message about a card that has
  gone (a person removed, a code hidden) is said at the head of its list.
- **Dates as people say them**, in UK time: "today", "3 days ago", "12 November", with the year when it
  is not this one.

## Site pages (`#view-site`)

For: keeping track of every page on the website, the spare addresses that lead to each, and which pages
search engines list.

Before: three tables down the page, the public pages listed twice, "Saved." far from the tick pressed,
Remove acting at once, "Added by seed".

Now:
- Six tiles with counts that filter the list (All, On the site map, Not listed, Personal link only, Staff
  only, Hidden from search), and a search box over names, addresses, what a page is and its spare
  addresses.
- One card a page in `#siteAllTable`: its name, who can reach it (a mark), its address (a link, new tab),
  what it is, the spare addresses that lead to it, and its search engine switch, which says "Saved." in
  the card. `#siteSeoTable` is gone: the switch it held is on each card.
- "Copy the address" on every card, and "Make a QR code" on every public page, which opens QR codes with
  that page chosen.
- Spare addresses keeps its form and its complete list (`#siteAliasTable`, the only place a forward to a
  subdomain shows). Remove asks first and says what stops working. "Added by" reads "Jo on 3 November";
  `seed` reads "Set up with the website".
- The long introduction is one sentence; what it explained now sits beside the thing it explains.

## QR codes (`#view-qr`)

For: making a named code for each place one is printed, downloading it, and seeing which get scanned.

Now:
- Three tiles: named codes, scans in the last 7 days, scans in all (hidden codes count too, as they
  still work).
- Sort the named codes: Newest (the order the server sends), Most scanned, A to Z.
- "A quick code for every page" is folded shut, with a search box inside.
- Under the two downloads on every card: "SVG for anything printed. PNG for slides, posts and
  documents." The buttons keep their words.
- "Copy the link" on every card, and "Share" where the browser can hand a picture to another app
  (`navigator.share` with files): it sends the PNG. Hidden where the browser cannot.
- A failed download is said in the card, never a browser alert. Hide it says where the code went.
  Rename and Hide are full-size buttons.

## Team (`#view-team`)

For: deciding who can sign in.

Now:
- Tiles that filter: Everyone, Can sign in, Invited, Disabled.
- A card a person that opens in place: name, "(you)", email, role, status, "Last signed in 3 days ago"
  or "Invited 12 November, not signed in yet", and what they can open in words: "Everything", "The
  Editor's usual access", or "Their own access: can change 12 areas, can look at 3".
- "What each role can do", a line a role, worked out from `rolePresetPermissions` so it cannot go out of
  date; the same line shows under the Role list when inviting.
- Role, Disable, Reset password and Remove each say what they do and ask first.
- **The role fault.** Once someone has saved access of their own, the server uses that and ignores the
  role for what they can open (`effectivePermissions`). The screen now says so before and after: "Sam has
  their own access, so changing the role does not change what they can open. Use Manage access.", with
  the button beside it. The role does still decide the few jobs only an Admin may do.
- "Send the invite again" for someone still Invited. It uses the reset route, which works for an invited
  person (their link sets the password and makes them Active); the email it sends is the reset email,
  and its link lasts one hour, which the button says.

## Manage access (`#view-team-permissions`)

For: choosing, area by area, what one person can look at and change.

Now:
- The heading names the person. Three tiles count what they can change, look at and not open, live.
- Rows grouped under the menu's own headings (read from the menu), each with a line saying what it
  covers and the screens that ride on it (also read from the menu). "Events", "Fundraising" and
  "Business-supporters" have their real names.
- None, View and Edit explained once above the rows. The buttons and `data-perm-level` are unchanged.
- The three role buttons sit under "Fill every row from a role's usual access", and say they do not
  change the role.
- Rows that differ from the person's role are marked, with "Put back to the Editor's usual access".
- "Copy access from" another person.
- Save at the top and the foot. Beside each, what saving will change ("Sam will lose Donations and gain
  Stories"), and, for someone on their role's access, that saving gives them access of their own.
- **Faults.** A failed save is red (`is-error`). Back with unsaved changes asks first.

## My account (`#view-account`)

For: your own name and password.

Now:
- The email sentence is right: "ask an Admin to remove you and invite your new address".
- "What you can open": your role, and each area under its menu heading with "can look" or "can change",
  from the access loaded at sign in; what is not part of your access is named too.
- The password rule shown before typing, "Show what I typed", and a tick when the two new ones match.
- The server's own words when it says to wait (429).
- Cards through to Notifications and to Sign out.
- A refresh on this screen comes back to it.

## Left out, and why

- Changing where a spare address goes, how often one is used, scans day by day, changing someone's
  email: each needs a new endpoint, field or migration (the audit marks them), outside this change.
- Leaving Manage access by the menu, the bottom bar or a refresh still discards unsaved changes without
  a word: only Back asks. Catching every way out means changing the shared `selectView`, which other
  builders are in.
