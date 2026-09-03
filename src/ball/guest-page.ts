import { escapeHtml } from "./page";
import { choosableCourses, parseChoice, parseMenu, type MenuCourse } from "./menu";

// TASK-313 (plan 5): the "tell us about your table" form. Pure render — no pool, no config —
// so it is unit-tested DB-free, mirroring src/thank-you/letter-page.ts.
//
// Design constraints that shaped this, all of them about the reader rather than the code:
//
//  * It arrives by email and is opened on a phone, often by someone older than a typical web
//    user, sometimes on poor signal. So it is a PLAIN FORM POST with essentially no JavaScript:
//    nothing to fail to load, nothing to lose if the page is restored from cache. The one small
//    script on the page reveals a convenience button and is not needed for anything to work.
//  * It asks for allergies and access needs — special category data. The honest thing is to say
//    who sees it and when it is deleted NEXT TO the fields, not behind a privacy link nobody
//    opens.
//  * People rarely know all ten names at once. Partial saves are expected and the copy says so,
//    because otherwise they wait until they know everything and we get nothing.
//
// TASK-409 changed four things, each reported by someone using it:
//
//  * A name is asked for in TWO boxes. This was the last single-name field on the site, and the
//    reasons are in the migration: there is no reliable way back out of one box, and the door
//    list is read by surname.
//  * The hints are LABELS, not placeholders. Placeholder text is low contrast by design, is
//    thrown away the moment somebody types, and is announced inconsistently by screen readers.
//    On a field asking about a disability that is the wrong control.
//  * The booker is filled in as the first guest, with a way to clear it. They reached this page
//    from their own booking; asking them to type their own name back in is a poor greeting.
//  * "Table name" became a GROUP name, with the instruction that makes it work. The case it has
//    to solve is people who booked separately wanting to sit together, and one agreed name sorts
//    a spreadsheet where four partial "who I want to sit with" lists have to be reconciled by
//    hand.

export interface GuestRow {
  fullName: string;
  /** TASK-409. NULL on rows saved before the split; the page derives a best-effort prefill. */
  firstName?: string | null;
  surname?: string | null;
  dietary: string | null;
  accessNeeds: string | null;
  // TASK-345: null until the venue confirms a menu and this guest picks from it.
  menuChoice?: string | null;
}

export interface GuestPageBooking {
  reference: string;
  kind: "seat" | "table";
  quantity: number;
  seats: number;
  buyerName: string;
  // TASK-338: carried for the read-back email sent on save, not rendered on the page. The page
  // is reached by a link in the buyer's inbox and shows their guests' names, so it deliberately
  // does NOT print the buyer's own address back at them.
  buyerFirstName: string | null;
  /** TASK-409: used with buyerFirstName to fill the booker in as the first guest. */
  buyerSurname?: string | null;
  buyerEmail: string;
  tableName: string | null;
}

export interface GuestPageInput {
  /** TASK-345: the raw menu from admin. Null or absent renders no menu section at all. */
  menuOptions?: string | null;
  booking: GuestPageBooking;
  guests: GuestRow[];
  token: string;
  saved?: boolean;
  error?: string | null;
  /**
   * TASK-409: when the guest list closes, agreed with the venue. NULL until it is agreed, and
   * the copy then says so rather than implying the form is open until the night.
   */
  lockAt?: Date | null;
}

function describeBooking(b: GuestPageBooking): string {
  if (b.kind === "table") {
    return b.quantity === 1 ? "a table of 10" : `${b.quantity} tables (${b.seats} seats)`;
  }
  return b.quantity === 1 ? "1 ticket" : `${b.quantity} tickets`;
}

// "Friday 24 October", the date a person would say. London, because a deadline rendered in the
// server's timezone can land a day out.
function readableDate(value: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Europe/London",
  }).format(value);
}

/**
 * What goes in the two name boxes for one seat.
 *
 * A row saved since TASK-409 has both halves and they are used as typed. A row saved BEFORE it
 * has only the joined name, and the last space is the best guess available. That guess is wrong
 * for "Ali van der Berg", which is exactly why the halves are stored now — but it is only ever
 * used to fill a form the booker is looking at and can correct, never to derive anything we
 * keep. Putting the whole name in the first-name box instead would be wrong for every legacy
 * row rather than a few.
 */
function nameParts(guest: GuestRow | undefined): { first: string; last: string } {
  if (!guest) return { first: "", last: "" };
  if (guest.firstName != null || guest.surname != null) {
    return { first: guest.firstName ?? "", last: guest.surname ?? "" };
  }
  const whole = guest.fullName.trim();
  const at = whole.lastIndexOf(" ");
  if (at === -1) return { first: whole, last: "" };
  return { first: whole.slice(0, at), last: whole.slice(at + 1) };
}

// TASK-345: the menu section, which does not exist until the venue confirms a menu.
//
// Returns "" while there is nothing to choose from — deliberately. A picker headed "choose your
// main course" above an empty list is worse than no picker: it looks broken, and it invites an
// email asking what the options are.
function menuFields(index: number, guest: GuestRow | undefined, menu: MenuCourse[]): string {
  const asked = choosableCourses(menu);
  if (asked.length === 0) return "";
  const n = index + 1;
  const chosen = parseChoice(guest?.menuChoice ?? null);
  return asked
    .map((course, c) => {
      const answer = chosen[course.name] ?? "";
      const options = course.options
        .map((o) => {
          // An option the guest picked before the venue changed the menu is not offered again,
          // so their select falls back to the blank — which is the truthful state, and the
          // chase list counts them as outstanding until they pick something that exists.
          const selected = o === answer ? " selected" : "";
          return `<option value="${escapeHtml(o)}"${selected}>${escapeHtml(o)}</option>`;
        })
        .join("\n    ");
      return `<label class="ball-field">
      <span>${escapeHtml(course.name)}</span>
      <select name="menu${n}_${c}" data-course="${escapeHtml(course.name)}">
        <option value="">Please choose</option>
        ${options}
      </select>
    </label>`;
    })
    .join("\n    ");
}

function guestFieldset(
  index: number,
  guest: GuestRow | undefined,
  isBooker: boolean,
  menu: MenuCourse[],
): string {
  const n = index + 1;
  const { first, last } = nameParts(guest);
  const dietary = guest?.dietary ? escapeHtml(guest.dietary) : "";
  const access = guest?.accessNeeds ? escapeHtml(guest.accessNeeds) : "";
  const legend = isBooker ? `Guest ${n} (that's you, unless you say otherwise)` : `Guest ${n}`;
  // Rendered hidden and revealed by the small script at the foot of the page. A button that does
  // nothing is worse than no button, so nobody without JavaScript is shown one; they can clear
  // the two boxes the ordinary way.
  const clear = isBooker
    ? `<p class="ball-guest-clear" data-guest-clear hidden><button type="button" class="btn btn-ghost btn-small" data-clear-guest="1">Not you? Clear this guest</button></p>`
    : "";
  return `<fieldset class="ball-guest">
  <legend>${legend}</legend>
  <div class="ball-row ball-row-fields">
    <label class="ball-field">
      <span>First name</span>
      <input type="text" name="firstName${n}" value="${escapeHtml(first)}" maxlength="60" autocomplete="off" />
    </label>
    <label class="ball-field">
      <span>Surname</span>
      <input type="text" name="surname${n}" value="${escapeHtml(last)}" maxlength="60" autocomplete="off" />
    </label>
  </div>
  ${clear}
  <label class="ball-field">
    <span>Anything they can't eat?</span>
    <small class="ball-hint" id="dietaryHint${n}">For example: coeliac, no shellfish, vegetarian. Leave it blank if there's nothing.</small>
    <input type="text" name="dietary${n}" value="${dietary}" maxlength="500" aria-describedby="dietaryHint${n}" />
  </label>
  <label class="ball-field">
    <span>Anything they need to get around comfortably?</span>
    <small class="ball-hint" id="accessHint${n}">For example: step-free access, a seat near the door, room for a wheelchair. Leave it blank if there's nothing.</small>
    <input type="text" name="accessNeeds${n}" value="${access}" maxlength="500" aria-describedby="accessHint${n}" />
  </label>
  ${menuFields(index, guest, menu)}
</fieldset>`;
}

export function renderGuestPage(input: GuestPageInput): string {
  const { booking, guests, token, saved, error } = input;
  const filled = guests.filter((g) => g.fullName.trim().length > 0).length;

  // When to say it closes. NULL is the state this ships in, and the honest answer then is that
  // the date is not settled, not that there is no date.
  const closes = input.lockAt
    ? `We need everyone's details by <b>${escapeHtml(readableDate(input.lockAt))}</b>, which is when the venue takes the final list.`
    : // No date invented, and no promise about when it will fall. "It won't be the week of the
      // ball" was in an earlier draft of this line and is exactly the kind of reassurance a
      // charity cannot actually give: the venue sets the deadline, not us.
      `We'll confirm the date the guest list closes once it's agreed with the venue, and we'll email you in good time.`;

  const notice = error
    ? `<p class="ball-error" role="alert">${escapeHtml(error)}</p>`
    : saved
      ? `<p class="ball-saved" role="status">Saved, thank you. You can come back to this page and change anything until the guest list closes.</p>`
      : "";

  const progress =
    filled === 0
      ? "You haven't added anyone yet."
      : filled === booking.seats
        ? `All ${booking.seats} guests added.`
        : `${filled} of ${booking.seats} added so far.`;

  // Empty until the venue confirms a menu, which is the state this ships in: the form renders
  // exactly as it does today, with no menu section at all.
  const menu = parseMenu(input.menuOptions ?? null);

  // The booker as guest 1, but ONLY on a table nothing has been saved to yet. Once anything is
  // stored, what is stored wins: overwriting a booker's own correction with a guess from the
  // booking would be worse than never guessing.
  //
  // `saved` is part of the condition and has to be. A PA who clears the booker out and saves an
  // empty table lands back here with nothing stored, and without this guard they would watch the
  // name they just deleted reappear in the box, which reads as the page refusing to do as it is
  // told. After any save the page shows exactly what is held, including nothing.
  const seeded: GuestRow[] =
    guests.length === 0 && !saved && (booking.buyerFirstName || booking.buyerSurname)
      ? [
          {
            firstName: booking.buyerFirstName ?? "",
            surname: booking.buyerSurname ?? "",
            fullName: booking.buyerName,
            dietary: null,
            accessNeeds: null,
          },
        ]
      : guests;

  const fieldsets = Array.from({ length: booking.seats }, (_, i) =>
    guestFieldset(i, seeded[i], i === 0, menu),
  ).join("\n");

  // The group name, and the instruction is the mechanism rather than a nicety.
  //
  // One hint for both kinds of booking, deliberately. The obvious version branches on kind and
  // tells only seat bookers to agree a name, on the reasoning that a table booker already has
  // their own table. But a table booker whose friends bought separate tickets needs exactly the
  // same coordination, and they are the party most likely to want it. One sentence covers both
  // and cannot be the wrong one.
  //
  // What it replaces: an open "who would you like to sit with?" box. Four people each naming
  // three friends produces a contradictory partial list that somebody has to reverse-engineer
  // into groupings by hand. One agreed name is a column you sort.
  const groupHint =
    `We'll use this on the table plan. If anyone in your party booked separately, agree ` +
    `<b>one</b> name between you and make sure everyone types it exactly the same way: that's ` +
    `how we seat you together. Leave it blank if you'd rather we didn't use one.`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>Your table at the Festive Ball | Night Before Christmas Campaign</title>
<link rel="stylesheet" href="/assets/css/styles.css" />
<link rel="stylesheet" href="/assets/css/ball.css" />
</head>
<body class="ball-page">
<a class="skip-link" href="#main">Skip to content</a>
<header class="nav" id="nav" data-region="nav">
  <div class="wrap">
    <a class="brand" href="/"><img src="/assets/img/nbcc-logo.png" alt="Night Before Christmas Campaign" width="50" height="50" loading="lazy" /></a>
    <a class="nav-cta" href="/ball">The ball</a>
  </div>
</header>

<main class="site-main" id="main" tabindex="-1">
  <section class="page-top" aria-labelledby="guests-heading">
    <div class="wrap">
      <span class="eyebrow">Festive Ball 2026</span>
      <h1 id="guests-heading">Who's coming with you?</h1>
      <p class="lede">
        Thank you, ${escapeHtml(booking.buyerName)}. You booked ${describeBooking(booking)},
        reference <b>${escapeHtml(booking.reference)}</b>. Tell us who's coming so we can put the
        right names on the door and make sure everyone's looked after at dinner.
      </p>
    </div>
  </section>

  <section class="section" aria-label="Your guests">
    <div class="wrap">
      ${notice}
      <p class="ball-progress">${progress} <b>You don't have to do it all at once.</b> Save what you know and come back later.</p>
      <p class="ball-progress ball-closes">${closes}</p>

      <form method="post" action="/ball/guests/${escapeHtml(token)}" class="ball-form ball-guest-form">
        <label class="ball-field ball-group-field">
          <span>Group name (optional)</span>
          <small class="ball-hint" id="groupHint">${groupHint}</small>
          <input type="text" name="tableName" value="${booking.tableName ? escapeHtml(booking.tableName) : ""}" maxlength="120" aria-describedby="groupHint" />
        </label>

        ${fieldsets}

        <div class="ball-privacy">
          <h2>What happens to this</h2>
          <p>
            Names go on the door list. We pass the food and access notes to The Park Hotel so
            they can cater and seat everyone properly, and we tell them nothing else about you.
            We delete all of it 90 days after the ball.
          </p>
          <p>
            If you'd rather tell us something privately, email
            <a href="mailto:events@nbcc.scot">events@nbcc.scot</a> instead and we'll handle it
            from there.
          </p>
        </div>

        <button class="btn btn-primary" type="submit">Save guest details</button>
      </form>

      <p class="ball-smallprint">
        Something not right with your booking? Email
        <a href="mailto:events@nbcc.scot">events@nbcc.scot</a> or call
        <a href="tel:+441292811015">01292 811 015</a>, Monday to Friday.
      </p>
    </div>
  </section>
</main>

<footer class="site-footer" data-region="footer">
  <div class="legal">
    <div class="wrap">
      <span>Night Before Christmas Campaign, known as NBCC, is a Scottish Charitable Incorporated Organisation.</span>
      <span>Scottish Charity Number SC047995. Regulated by the Scottish Charity Regulator, OSCR.</span>
    </div>
  </div>
</footer>
<!-- The page's only script, and nothing depends on it. It reveals the "clear this guest" button
     and wires it to empty the two name boxes, for a PA who booked on somebody else's behalf.
     Without JavaScript the button is never shown and the boxes are cleared the ordinary way, so
     the form keeps working exactly as it did. -->
<script>
(function () {
  var wrap = document.querySelector("[data-guest-clear]");
  if (!wrap) return;
  wrap.hidden = false;
  var button = wrap.querySelector("[data-clear-guest]");
  if (!button) return;
  button.addEventListener("click", function () {
    var form = button.form || document.querySelector(".ball-guest-form");
    if (!form) return;
    ["firstName1", "surname1"].forEach(function (name) {
      var field = form.elements[name];
      if (field) field.value = "";
    });
    var first = form.elements["firstName1"];
    if (first && first.focus) first.focus();
  });
})();
</script>
</body>
</html>`;
}

// Shown when a token does not resolve. Deliberately vague about WHY — an unknown token and an
// expired one look identical, so the page cannot be used to probe which references exist.
export function renderGuestNotFound(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>Link not found | Night Before Christmas Campaign</title>
<link rel="stylesheet" href="/assets/css/styles.css" />
</head>
<body>
<main class="site-main" id="main" tabindex="-1">
  <section class="page-top">
    <div class="wrap">
      <h1>We couldn't find that link</h1>
      <p class="lede">
        It may have expired, or the address may have been copied incompletely. Email
        <a href="mailto:events@nbcc.scot">events@nbcc.scot</a> with your booking reference and
        we'll send you a new one.
      </p>
      <a class="btn btn-primary" href="/ball">Back to the ball</a>
    </div>
  </section>
</main>
</body>
</html>`;
}
