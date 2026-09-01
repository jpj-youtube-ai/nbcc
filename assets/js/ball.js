/* Festive Ball 2026 booking form (TASK-313).
 *
 * Its own file, not part of assets/js/main.js: donate.html sits ~369 bytes under
 * its enforced first-paint budget and that page is the donation money path, so
 * the shared bundle must not grow.
 *
 * Money is mirrored from src/ball/pricing.ts. The server recalculates every total
 * before charging anything — these figures exist so the buyer can see what they
 * are agreeing to, never as the source of truth.
 */
(function () {
  "use strict";

  var SEAT_PENCE = 10000;
  var TABLE_PENCE = 100000;
  var MAX_SEATS = 9;
  var MAX_TABLES = 4;
  // NBCC's Stripe charity rate, in basis points to match src/ball/pricing.ts (120 = 1.20%).
  // These are only the fallback for the moment before /api/ball/availability answers; the
  // live values from ball_settings overwrite them, and the SERVER prices the actual charge,
  // so a stale page can misquote by a few pence but can never mis-charge.
  var cardFeeBp = 120;
  var cardFeeFixedPence = 20;

  var form = document.getElementById("ballForm");
  if (!form) return;

  var quantity = document.getElementById("ballQuantity");
  var totalOut = document.getElementById("ballTotal");
  var feeOut = document.getElementById("ballFee");
  var feeEachOut = document.getElementById("ballFeeEach");
  var addDonation = document.getElementById("ballAddDonation");
  var donationFields = document.getElementById("ballDonationFields");
  var errorBox = document.getElementById("ballError");
  var submit = document.getElementById("ballSubmit");
  var availability = document.querySelector('[data-region="availability"]');
  var waitingForm = document.getElementById("ballWaitingForm");

  function kind() {
    var checked = form.querySelector('input[name="kind"]:checked');
    return checked ? checked.value : "seat";
  }

  function money(pence) {
    // Whole pounds lose the ".00" — "£1,000" reads better than "£1,000.00" on a
    // headline total, and the pennies only ever appear on the fee line.
    var pounds = pence / 100;
    return "£" + pounds.toLocaleString("en-GB", {
      minimumFractionDigits: pence % 100 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    });
  }

  function donationPence() {
    if (!addDonation || !addDonation.checked) return 0;
    var input = form.elements.donation;
    var value = parseFloat(input && input.value ? input.value : "0");
    if (!isFinite(value) || value <= 0) return 0;
    return Math.round(value * 100);
  }

  // What Stripe takes on an amount it processes. Used only to CHECK the gross-up below.
  function stripeTakes(charged) {
    return Math.ceil((charged * cardFeeBp) / 10000) + cardFeeFixedPence;
  }

  // TASK-348: mirrors grossedUpFeePence in src/ball/pricing.ts and must stay identical to it —
  // this figure is shown on the page while the server charges its own, so any disagreement is a
  // number the buyer was quoted and then not charged.
  //
  // The fee is grossed UP rather than being "1.2% of the tickets + 20p": Stripe's percentage
  // applies to the total it processes, and that total includes the fee itself. Covering the
  // naive figure left the charity 2p short on a seat and 15p on a table, which quietly made
  // the page's own promise untrue.
  //
  // The fixed part is still added ONCE, because Stripe bills per transaction rather than per
  // ticket, so the fee per ticket still falls as the order grows.
  function feePence(amount) {
    if (!amount) return 0;
    var charged = Math.ceil(((amount + cardFeeFixedPence) * 10000) / (10000 - cardFeeBp));
    for (var i = 0; i < 4 && charged - stripeTakes(charged) < amount; i += 1) charged += 1;
    return charged - amount;
  }

  function fillQuantities() {
    if (!quantity) return;
    var max = kind() === "table" ? MAX_TABLES : MAX_SEATS;
    var current = parseInt(quantity.value, 10) || 1;
    quantity.innerHTML = "";
    for (var i = 1; i <= max; i += 1) {
      var opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent =
        kind() === "table"
          ? i + (i === 1 ? " table (10 seats)" : " tables (" + i * 10 + " seats)")
          : i + (i === 1 ? " ticket" : " tickets");
      quantity.appendChild(opt);
    }
    quantity.value = String(Math.min(current, max));

    // Say the per-order limit HERE, next to the control it applies to. Discovering it by
    // running out of options and hunting for why is the version people email us about.
    var note = document.getElementById("ballQuantityNote");
    if (note) {
      note.textContent =
        kind() === "table"
          ? "Up to " + MAX_TABLES + " tables in one booking — for more, see below."
          : "Up to " + MAX_SEATS + " tickets in one booking — for ten or more, book a table.";
    }
  }

  function recalculate() {
    var qty = parseInt(quantity && quantity.value, 10) || 1;
    var isTable = kind() === "table";
    var tickets = (isTable ? TABLE_PENCE : SEAT_PENCE) * qty;
    var donation = donationPence();
    // TICKETS only. NBCC absorbs the fee on any donation added here, the same way it does
    // everywhere else on the site — a gift is not something we ask people to pay a surcharge
    // on. Mirrors orderTotalPence server-side, which is what actually gets charged.
    var fee = feePence(tickets);
    // TASK-335: `form` is null on a ball page with no booking form - the thank-you page now
    // shares this script so it can have the hero's snow. Every other read in here was already
    // guarded; this one threw, and since recalculate() runs before startSnow() at the foot of
    // the file, the throw showed up as no snow rather than as an obvious error.
    var coverFee = form && form.elements.coverFee && form.elements.coverFee.checked;

    if (feeOut) feeOut.textContent = money(fee);
    // The 20p is per ORDER, so the fee per ticket falls as the order grows. Worth saying:
    // it turns a number that looks like a surcharge into one that visibly gets better.
    if (feeEachOut) {
      var seatCount = isTable ? qty * 10 : qty;
      if (seatCount > 1) {
        feeEachOut.textContent = "That is about " + money(Math.round(fee / seatCount)) + " a ticket.";
        feeEachOut.hidden = false;
      } else {
        feeEachOut.textContent = "";
        feeEachOut.hidden = true;
      }
    }
    if (totalOut) {
      var next = money(tickets + donation + (coverFee ? fee : 0));
      if (totalOut.textContent !== next) {
        totalOut.textContent = next;
        // Restart the pulse: remove, force a reflow read, re-add. Without the
        // reflow the class swap is coalesced and the animation never replays.
        totalOut.classList.remove("is-changed");
        void totalOut.offsetWidth;
        totalOut.classList.add("is-changed");
      }
    }
    if (donationFields) donationFields.hidden = !(addDonation && addDonation.checked);
  }

  function showError(message) {
    if (!errorBox) return;
    errorBox.textContent = message;
    errorBox.hidden = false;
    errorBox.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  function clearError() {
    if (errorBox) errorBox.hidden = true;
  }

  // Availability is advisory on the page — the server re-checks under a lock before
  // taking any money — so a failed fetch stays silent rather than alarming a buyer
  // about something that may be fine.
  function loadAvailability() {
    if (!availability || !window.fetch) return;
    fetch("/api/ball/availability")
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (data) {
        if (!data) return;
        // Adopt the live card rate before anything is priced on screen (TASK-317).
        if (typeof data.cardFeePercentBp === "number") cardFeeBp = data.cardFeePercentBp;
        if (typeof data.cardFeeFixedPence === "number") cardFeeFixedPence = data.cardFeeFixedPence;
        recalculate();
        if (!data.salesOpen) {
          availability.textContent = data.soldOut
            ? "The ball is sold out."
            : "Ticket sales are now closed.";
          availability.hidden = false;
          // Sold out is not a dead end: swap the booking form for the waiting list, because a
          // place released in October is only worth something if someone is waiting for it.
          if (data.soldOut && waitingForm) {
            form.hidden = true;
            waitingForm.hidden = false;
          } else if (submit) {
            submit.disabled = true;
          }
          return;
        }
        // Only surface scarcity when it is real and close. Showing "392 of 400 left"
        // in week one does the opposite of encouraging, and invented urgency would
        // breach the Code of Fundraising Practice.
        if (data.tablesRemaining > 0 && data.tablesRemaining <= 5) {
          availability.textContent =
            data.tablesRemaining === 1
              ? "Only one table left."
              : "Only " + data.tablesRemaining + " tables left.";
          availability.hidden = false;
        } else if (data.seatsRemaining > 0 && data.seatsRemaining <= 20) {
          availability.textContent =
            data.seatsRemaining === 1
              ? "Only one ticket left."
              : "Only " + data.seatsRemaining + " tickets left.";
          availability.hidden = false;
        }
      })
      .catch(function () {
        /* advisory only */
      });
  }

  form.addEventListener("change", function (event) {
    if (event.target && event.target.name === "kind") fillQuantities();
    recalculate();
  });
  form.addEventListener("input", recalculate);

  /* ---- inline payment (TASK-319) ---------------------------------------------
   *
   * Buyers pay WITHOUT leaving nbcc.scot, the same way donors already do. The page a
   * stranger reaches from a printed advert is not the place to bounce someone to a
   * different domain at the exact moment they are deciding whether to trust it.
   *
   * The server side already supported this (ui_mode "embedded_page" returns a client
   * secret instead of a URL); only the page still redirected.
   *
   * It reuses the shared .give-embedded-* styles from styles.css and the same
   * "stripe-js-sdk" script id as the donate page, so Stripe.js is fetched once at most.
   * It deliberately does NOT reuse main.js's donate controller: that keeps its mounted
   * instance in a variable this file cannot see, so a shared Close button would hide the
   * modal without destroying the iframe and the next attempt would mount twice.
   *
   * Every failure path falls back to the hosted redirect. Nobody is left with a button
   * that does nothing.
   */
  var checkoutInstance = null;

  function ensureStripeJs() {
    if (typeof window.Stripe === "function") return;
    if (document.getElementById("stripe-js-sdk")) return;
    var script = document.createElement("script");
    script.id = "stripe-js-sdk";
    script.src = "https://js.stripe.com/v3/";
    script.async = true;
    (document.head || document.documentElement).appendChild(script);
  }

  function openCheckout() {
    var modal = document.getElementById("ballCheckoutModal");
    if (modal) {
      modal.hidden = false;
      modal.setAttribute("aria-hidden", "false");
    }
    if (document.body) document.body.classList.add("give-embedded-open");
    var close = document.getElementById("ballCheckoutClose");
    if (close && close.focus) {
      try { close.focus(); } catch (e) { /* focus unavailable */ }
    }
  }

  function closeCheckout() {
    var modal = document.getElementById("ballCheckoutModal");
    if (modal) {
      modal.hidden = true;
      modal.setAttribute("aria-hidden", "true");
    }
    if (document.body) document.body.classList.remove("give-embedded-open");
    // Destroy before clearing the mount: Stripe keeps an iframe alive otherwise, and the
    // next attempt would mount a second one into the same node.
    if (checkoutInstance) {
      try { checkoutInstance.destroy(); } catch (e) { /* already gone */ }
      checkoutInstance = null;
    }
    var mount = document.getElementById("ballCheckout");
    if (mount) mount.innerHTML = "";
  }

  // Fetch Stripe.js as soon as the page is interactive, not at submit time: waiting until
  // someone presses the button adds a network round trip to the most impatient moment.
  ensureStripeJs();

  var closeButton = document.getElementById("ballCheckoutClose");
  if (closeButton) {
    closeButton.addEventListener("click", function () { closeCheckout(); });
  }
  document.addEventListener("keydown", function (e) {
    var modal = document.getElementById("ballCheckoutModal");
    if (!modal || modal.hidden) return;
    if (e.key === "Escape" || e.keyCode === 27) closeCheckout();
  });

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    clearError();

    var firstName = (form.elements.buyerFirstName.value || "").trim();
    var surname = (form.elements.buyerSurname.value || "").trim();
    var email = (form.elements.buyerEmail.value || "").trim();
    // Named separately so the message points at the box that is empty, rather than making
    // someone work out which half of "your name" we mean.
    if (!firstName) return showError("Please give your first name, so we know who the booking is for.");
    if (!surname) return showError("Please give your surname, so we can find you on the door list.");
    if (!email || email.indexOf("@") === -1) {
      return showError("Please give us an email address — your booking confirmation goes there.");
    }
    if (!form.elements.termsAccepted || !form.elements.termsAccepted.checked) {
      return showError("Please tick to confirm you agree to the ticket terms.");
    }
    var donation = donationPence();
    if (form.elements.giftAid && form.elements.giftAid.checked && donation <= 0) {
      return showError("Gift Aid applies to a donation, so please enter a donation amount, or untick Gift Aid.");
    }

    var body = {
      kind: kind(),
      quantity: parseInt(quantity.value, 10) || 1,
      buyerFirstName: firstName,
      buyerSurname: surname,
      buyerEmail: email,
      donationPence: donation,
      coverFee: !!(form.elements.coverFee && form.elements.coverFee.checked),
      giftAid: !!(form.elements.giftAid && form.elements.giftAid.checked && donation > 0),
      newsletterOptIn: !!(form.elements.newsletterOptIn && form.elements.newsletterOptIn.checked),
      termsAccepted: true,
      uiMode: "hosted",
    };

    submit.disabled = true;
    var original = submit.innerHTML;
    submit.textContent = "Taking you to payment…";

    function restore() {
      submit.disabled = false;
      submit.innerHTML = original;
    }

    function post(mode) {
      body.uiMode = mode;
      return fetch("/api/ball/checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then(function (res) {
        return res.json().then(function (data) {
          return { status: res.status, data: data };
        });
      });
    }

    function failed(result) {
      restore();
      showError(
        result && result.data && result.data.error
          ? result.data.error
          : "Something went wrong starting your payment. Please try again, or email events@nbcc.scot.",
      );
      // The refusal is usually "those seats just went", so re-read what is actually left
      // rather than leaving the page insisting the order is still possible.
      loadAvailability();
    }

    // The hosted Stripe page, in its own tab-less redirect. This is the fallback, not the
    // plan: it is what happens if Stripe.js is blocked, the mount is missing, or the embed
    // throws — so a buyer is never left holding a dead button.
    function hostedRedirect() {
      post("hosted")
        .then(function (result) {
          if (result.status === 201 && result.data.url) {
            window.location.assign(result.data.url);
            return;
          }
          failed(result);
        })
        .catch(function () {
          restore();
          showError(
            "We couldn't reach the payment page. Check your connection and try again, or email events@nbcc.scot.",
          );
        });
    }

    var mount = document.getElementById("ballCheckout");
    if (typeof window.Stripe !== "function" || !mount) {
      hostedRedirect();
      return;
    }

    post("embedded")
      .then(function (result) {
        if (result.status !== 201) {
          // A real refusal — sold out, validation, a closed sale. Say so; do NOT retry as a
          // hosted redirect, which would just fail again and look like a broken button.
          failed(result);
          return;
        }
        var data = result.data;
        if (!data.clientSecret || !data.publishableKey) {
          hostedRedirect();
          return;
        }
        var stripe;
        try {
          stripe = window.Stripe(data.publishableKey);
        } catch (e) {
          hostedRedirect();
          return;
        }
        stripe
          .initEmbeddedCheckout({ clientSecret: data.clientSecret })
          .then(function (checkout) {
            checkoutInstance = checkout;
            openCheckout();
            checkout.mount(mount);
            restore();
          })
          .catch(function () {
            closeCheckout();
            hostedRedirect();
          });
      })
      .catch(hostedRedirect);
  });

  /* ---- snow ----------------------------------------------------------------
   *
   * The one piece of pure delight on the page, and it earns its place: this is the
   * Night Before Christmas Campaign, the printed poster has snowflakes on it, and
   * the ball is in November. A generic particle effect would be decoration; this is
   * the subject.
   *
   * Kept cheap and well-behaved: one canvas, ~180 flakes, sized to the hero only,
   * paused whenever the hero is off-screen or the tab is hidden, and not started at
   * all under prefers-reduced-motion.
   */
  function startSnow() {
    var hero = document.querySelector(".ball-hero");
    if (!hero || !window.requestAnimationFrame) return;
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    var canvas = document.createElement("canvas");
    canvas.className = "ball-snow";
    canvas.setAttribute("aria-hidden", "true");
    hero.insertBefore(canvas, hero.firstChild);
    var ctx = canvas.getContext("2d");
    if (!ctx) return;

    var flakes = [];
    var running = false;
    var visible = true;
    var frame = null;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);

    function size() {
      var w = hero.clientWidth;
      var h = hero.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Fewer flakes on a narrow screen: the same count on a phone reads as a
      // blizzard, and costs battery for the privilege.
      var count = w < 600 ? 95 : 180;
      flakes = [];
      for (var i = 0; i < count; i += 1) {
        // DEPTH is what makes this read as snow rather than as dots moving. One random
        // number decides how near a flake is, and then everything about it follows from
        // that: near flakes are bigger, faster and brighter, far ones smaller, slower and
        // fainter. Flakes at different distances separate as they fall, which is the
        // parallax the eye reads as three dimensions.
        var depth = Math.random();
        flakes.push({
          x: Math.random() * w,
          y: Math.random() * h,
          r: 0.5 + depth * 2.1,
          speed: 0.34 + depth * 1.15,
          drift: Math.random() * 0.5 - 0.25,
          phase: Math.random() * Math.PI * 2,
          // Sway is per-flake, so they do not all wander in step like a single sheet.
          sway: 0.18 + Math.random() * 0.42,
          alpha: 0.14 + depth * 0.5,
        });
      }
    }

    function tick() {
      if (!running || !visible) { frame = null; return; }
      var w = canvas.width / dpr;
      var h = canvas.height / dpr;
      ctx.clearRect(0, 0, w, h);
      for (var i = 0; i < flakes.length; i += 1) {
        var f = flakes[i];
        f.y += f.speed;
        f.phase += 0.012;
        f.x += Math.sin(f.phase) * f.sway + f.drift * 0.1;
        if (f.y > h + 4) { f.y = -4; f.x = Math.random() * w; }
        if (f.x > w + 4) f.x = -4;
        if (f.x < -4) f.x = w + 4;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(242, 238, 228, " + f.alpha + ")";
        ctx.fill();
      }
      frame = window.requestAnimationFrame(tick);
    }

    function play() {
      if (frame === null && running && visible) frame = window.requestAnimationFrame(tick);
    }

    size();
    running = true;
    play();

    // Stop entirely once the hero scrolls away — no point painting 60 circles a
    // frame for a band nobody can see.
    if (window.IntersectionObserver) {
      new IntersectionObserver(function (entries) {
        running = entries[0].isIntersecting;
        play();
      }, { threshold: 0 }).observe(hero);
    }
    document.addEventListener("visibilitychange", function () {
      visible = !document.hidden;
      play();
    });

    var resizeTimer;
    window.addEventListener("resize", function () {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(size, 200);
    });
  }

  if (waitingForm) {
    waitingForm.addEventListener("submit", function (event) {
      event.preventDefault();
      var errorNode = document.getElementById("ballWaitingError");
      var doneNode = document.getElementById("ballWaitingDone");
      var btn = document.getElementById("ballWaitingSubmit");
      errorNode.hidden = true;
      doneNode.hidden = true;

      var wlFirstName = (waitingForm.elements.firstName.value || "").trim();
      var wlSurname = (waitingForm.elements.surname.value || "").trim();
      var email = (waitingForm.elements.email.value || "").trim();
      if (!wlFirstName || !wlSurname || !email || email.indexOf("@") === -1) {
        errorNode.textContent = "Please give us your name and an email address we can reach you on.";
        errorNode.hidden = false;
        return;
      }

      btn.disabled = true;
      fetch("/api/ball/waiting-list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: wlFirstName,
          surname: wlSurname,
          email: email,
          seatsWanted: waitingForm.elements.seatsWanted.value,
          note: waitingForm.elements.note.value,
          newsletterOptIn: waitingForm.elements.newsletterOptIn.checked ? "on" : "",
        }),
      })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
        .then(function (result) {
          btn.disabled = false;
          if (!result.ok) {
            errorNode.textContent = result.data.error || "Could not add you. Please try again.";
            errorNode.hidden = false;
            return;
          }
          doneNode.textContent = result.data.message;
          doneNode.hidden = false;
          btn.hidden = true;
        })
        .catch(function () {
          btn.disabled = false;
          errorNode.textContent = "We couldn't reach the server. Please try again, or email events@nbcc.scot.";
          errorNode.hidden = false;
        });
    });
  }

  fillQuantities();
  recalculate();
  loadAvailability();
  startSnow();
})();
