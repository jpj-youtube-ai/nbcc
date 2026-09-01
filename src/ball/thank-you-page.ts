import { escapeHtml } from "./page";

// TASK-313: where Stripe sends a buyer the instant their payment succeeds.
//
// This page existing at all is the point: the checkout's success_url pointed here from the
// start, but nothing served it, so a real payment ended on a 404. The money was taken, the
// booking recorded and the receipt sent — and the buyer saw "page not found" and had no way to
// know any of that. Caught by walking the live path rather than by any test, because every test
// asserted the URL was BUILT correctly and none asserted it RESOLVED.
//
// Two rules follow from when this page is seen:
//
//  1. It is NOT behind the launch gate. Someone who has just paid must see confirmation whatever
//     the public page is doing.
//  2. It must never look like a failure. Stripe only redirects here on success, so even if the
//     booking cannot be read back — the webhook may be seconds behind the redirect — the answer
//     is "your payment went through", not an error.

export interface ThankYouBooking {
  reference: string;
  kind: "seat" | "table";
  quantity: number;
  seats: number;
  buyerEmail: string;
  totalPence: number;
  guestToken: string | null;
}

function describe(b: ThankYouBooking): string {
  if (b.kind === "table") {
    return b.quantity === 1 ? "a table of 10" : `${b.quantity} tables (${b.seats} seats)`;
  }
  return b.quantity === 1 ? "1 ticket" : `${b.quantity} tickets`;
}

const money = (pence: number): string =>
  "£" + (pence / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function renderBallThankYou(booking: ThankYouBooking | null): string {
  // The known-booking case: name the reference and what they bought, so the page itself is
  // proof rather than a promise.
  const detail = booking
    ? `<dl class="ball-facts ball-facts-light">
        <div><dt>Booking</dt><dd><b>${escapeHtml(booking.reference)}</b><span>Keep this for your records</span></dd></div>
        <div><dt>You booked</dt><dd><b>${describe(booking)}</b><span>Saturday 7<sup class="ord">th</sup> November 2026</span></dd></div>
        <div><dt>Paid</dt><dd><b>${money(booking.totalPence)}</b><span>Receipt on its way</span></dd></div>
      </dl>
      <p>We've emailed your confirmation to <b>${escapeHtml(booking.buyerEmail)}</b>. If it hasn't
      arrived in a few minutes, check your junk folder before booking again, and email us
      either way, so we can make sure it reaches you.</p>`
    : // The webhook can lag the redirect by a second or two. Say the true thing rather than
      // inventing detail we cannot see yet.
      `<p>Your payment went through. Your confirmation email is on its way and will carry your
      booking reference. If it hasn't arrived within ten minutes, email
      <a href="mailto:events@nbcc.scot">events@nbcc.scot</a> before trying again. We'll
      find your booking.</p>`;

  const guestPrompt =
    booking && booking.guestToken
      ? `<h2>Next: tell us who's coming</h2>
      <p>So the venue can look after everyone properly, let us know your guests' names and
      anything they can't eat. You don't have to do it all at once.</p>
      <p><a class="btn btn-primary" href="/ball/guests/${escapeHtml(booking.guestToken)}">Add your guests</a></p>`
      : `<h2>Next: tell us who's coming</h2>
      <p>We'll email you a link to add your guests' names and any dietary or access needs, so the
      venue can look after everyone properly.</p>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>Thank you for your Festive Ball booking | Night Before Christmas Campaign</title>
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
  <!-- TASK-335: the ball page's OWN hero class, not a copy of it. Reusing .ball-hero means this
       page cannot drift away from the one it follows, and it inherits two things for free: the
       night ground with its overhead light shaft, and the snow, which ball.js starts by looking
       for exactly this selector. -->
  <section class="ball-hero" aria-labelledby="ty-heading">
    <div class="wrap">
      <!-- No kicker. It read "Your seat is booked", which is wrong for the buyer this page
           matters most to: someone who has just taken a table of ten has not booked A seat.
           Removing it also promotes the headline into :nth-child(2), the child the stagger in
           ball.css gives the scale-in entrance to - so the biggest thing on the page is now
           also the one that arrives with the flourish. -->
      <img class="ball-lockup ball-ty-lockup" src="/assets/img/ball-lockup.svg"
        alt="A Night to Remember, Festive Ball 2026" width="1306" height="491"
        fetchpriority="high" decoding="async" />
      <h1 id="ty-heading" class="ball-ty-title">You're coming to the Festive Ball</h1>
      <p class="ball-ty-lede">Thank you for supporting NBCC.</p>
    </div>
  </section>

  <section class="section" aria-label="Your booking">
    <div class="wrap ball-ty">
      ${detail}
      ${guestPrompt}

      <h2>On the night</h2>
      <p>
        Saturday 7<sup class="ord">th</sup> November 2026 at The Park Hotel, Rugby Park, Kilmarnock. Dress to impress,
        over 18s only. Give your name at the welcome desk. There's no ticket to print.
        We'll email you the timings and menu once the venue confirms them.
      </p>

      <p class="ball-ty-calendar">
        <a class="btn btn-ghost" href="/ball/calendar.ics" download>Add it to your calendar</a>
      </p>

      <p class="ball-smallprint">
        Questions? Email <a href="mailto:events@nbcc.scot">events@nbcc.scot</a> or call
        <a href="tel:+441292811015">01292 811 015</a>, Monday to Friday.
        See the <a href="/ball/terms">ticket terms</a>.
      </p>

    </div>
  </section>

  <!-- The moment someone has just paid is the right moment to say who made the evening possible.
       Same band, same classes, same size as the foot of the ball page, so the two pages end the
       same way - and on the night ground it takes the cream wordmark, not the dark one. -->
  <section class="ball-sponsor" aria-labelledby="ty-sponsor-heading">
    <div class="wrap">
      <span class="eyebrow on-dark" id="ty-sponsor-heading">Event organised and sponsored by</span>
      <p class="ball-sponsor-name">
        <a href="https://thedesignerrooms.com/" target="_blank" rel="noopener">
          <img
            src="/assets/img/the-designer-rooms-cream.png"
            alt="The Designer Rooms"
            width="486"
            height="63"
            loading="lazy"
            decoding="async"
          />
        </a>
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
<script defer src="/assets/js/ball.js"></script>
</body>
</html>`;
}
