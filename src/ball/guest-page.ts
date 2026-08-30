import { escapeHtml } from "./page";

// TASK-313 (plan 5): the "tell us about your table" form. Pure render — no pool, no config —
// so it is unit-tested DB-free, mirroring src/thank-you/letter-page.ts.
//
// Design constraints that shaped this, all of them about the reader rather than the code:
//
//  * It arrives by email and is opened on a phone, often by someone older than a typical web
//    user, sometimes on poor signal. So it is a PLAIN FORM POST with no JavaScript: nothing to
//    fail to load, nothing to lose if the page is restored from cache.
//  * It asks for allergies and access needs — special category data. The honest thing is to say
//    who sees it and when it is deleted NEXT TO the fields, not behind a privacy link nobody
//    opens.
//  * People rarely know all ten names at once. Partial saves are expected and the copy says so,
//    because otherwise they wait until they know everything and we get nothing.

export interface GuestRow {
  fullName: string;
  dietary: string | null;
  accessNeeds: string | null;
}

export interface GuestPageBooking {
  reference: string;
  kind: "seat" | "table";
  quantity: number;
  seats: number;
  buyerName: string;
  tableName: string | null;
}

export interface GuestPageInput {
  booking: GuestPageBooking;
  guests: GuestRow[];
  token: string;
  saved?: boolean;
  error?: string | null;
}

function describeBooking(b: GuestPageBooking): string {
  if (b.kind === "table") {
    return b.quantity === 1 ? "a table of 10" : `${b.quantity} tables (${b.seats} seats)`;
  }
  return b.quantity === 1 ? "1 ticket" : `${b.quantity} tickets`;
}

function guestFieldset(index: number, guest: GuestRow | undefined, isBooker: boolean): string {
  const n = index + 1;
  const name = guest ? escapeHtml(guest.fullName) : "";
  const dietary = guest?.dietary ? escapeHtml(guest.dietary) : "";
  const access = guest?.accessNeeds ? escapeHtml(guest.accessNeeds) : "";
  const legend = isBooker ? `Guest ${n} (that's probably you)` : `Guest ${n}`;
  return `<fieldset class="ball-guest">
  <legend>${legend}</legend>
  <label class="ball-field">
    <span>Full name</span>
    <input type="text" name="fullName${n}" value="${name}" maxlength="120" autocomplete="off" />
  </label>
  <label class="ball-field">
    <span>Anything they can't eat?</span>
    <input type="text" name="dietary${n}" value="${dietary}" maxlength="500" placeholder="e.g. coeliac, no shellfish, vegetarian" />
  </label>
  <label class="ball-field">
    <span>Anything they need to get around comfortably?</span>
    <input type="text" name="accessNeeds${n}" value="${access}" maxlength="500" placeholder="e.g. step-free access, a seat near the door" />
  </label>
</fieldset>`;
}

export function renderGuestPage(input: GuestPageInput): string {
  const { booking, guests, token, saved, error } = input;
  const filled = guests.filter((g) => g.fullName.trim().length > 0).length;

  const notice = error
    ? `<p class="ball-error" role="alert">${escapeHtml(error)}</p>`
    : saved
      ? `<p class="ball-saved" role="status">Saved, thank you. You can come back to this page any time before the night and change anything.</p>`
      : "";

  const progress =
    filled === 0
      ? "You haven't added anyone yet."
      : filled === booking.seats
        ? `All ${booking.seats} guests added.`
        : `${filled} of ${booking.seats} added so far.`;

  const fieldsets = Array.from({ length: booking.seats }, (_, i) =>
    guestFieldset(i, guests[i], i === 0),
  ).join("\n");

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
      <p class="ball-progress">${progress} <b>You don't have to do it all at once</b> — save what you know and come back later.</p>

      <form method="post" action="/ball/guests/${escapeHtml(token)}" class="ball-form ball-guest-form">
        <label class="ball-field">
          <span>Table name (optional)</span>
          <input type="text" name="tableName" value="${booking.tableName ? escapeHtml(booking.tableName) : ""}" maxlength="120" placeholder="e.g. Ayrshire Bakery, or the Smith family" />
          <small>We'll use this on the table plan. Leave it blank if you'd rather we didn't.</small>
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
