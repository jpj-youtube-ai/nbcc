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
  <section class="page-top" aria-labelledby="ty-heading">
    <div class="wrap">
      <span class="eyebrow">A Night to Remember</span>
      <h1 id="ty-heading">You're coming to the Festive Ball</h1>
      <p class="lede">Thank you, and thank you for supporting NBCC.</p>
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

      <p class="ball-smallprint">
        Questions? Email <a href="mailto:events@nbcc.scot">events@nbcc.scot</a> or call
        <a href="tel:+441292811015">01292 811 015</a>, Monday to Friday.
        See the <a href="/ball/terms">ticket terms</a>.
      </p>

      <!-- The moment someone has just paid is the right moment to say who made the evening
           possible, and this page is cream, so it takes the dark version of the wordmark. -->
      <aside class="ball-ty-sponsor">
        <span>Organised and sponsored by</span>
        <a href="https://thedesignerrooms.com/" target="_blank" rel="noopener">
          <img
            src="/assets/img/the-designer-rooms.png"
            alt="The Designer Rooms"
            width="486"
            height="63"
            loading="lazy"
            decoding="async"
          />
        </a>
      </aside>
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
