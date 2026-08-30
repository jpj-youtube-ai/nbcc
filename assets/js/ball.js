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
  var STRIPE_PERCENT = 0.015;
  var STRIPE_FIXED_PENCE = 20;

  var form = document.getElementById("ballForm");
  if (!form) return;

  var quantity = document.getElementById("ballQuantity");
  var totalOut = document.getElementById("ballTotal");
  var feeOut = document.getElementById("ballFee");
  var addDonation = document.getElementById("ballAddDonation");
  var donationFields = document.getElementById("ballDonationFields");
  var errorBox = document.getElementById("ballError");
  var submit = document.getElementById("ballSubmit");
  var availability = document.querySelector('[data-region="availability"]');

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

  // Rounded UP, mirroring stripeFeePence server-side: a rounded-down penny would
  // leave the charity fractionally short on every fee-covered order.
  function feePence(amount) {
    return Math.ceil(amount * STRIPE_PERCENT) + STRIPE_FIXED_PENCE;
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
  }

  function recalculate() {
    var qty = parseInt(quantity && quantity.value, 10) || 1;
    var tickets = (kind() === "table" ? TABLE_PENCE : SEAT_PENCE) * qty;
    var donation = donationPence();
    var fee = feePence(tickets + donation);
    var coverFee = form.elements.coverFee && form.elements.coverFee.checked;

    if (feeOut) feeOut.textContent = money(fee);
    if (totalOut) totalOut.textContent = money(tickets + donation + (coverFee ? fee : 0));
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
        if (!data.salesOpen) {
          availability.textContent = data.soldOut
            ? "The ball is now sold out. Email events@nbcc.scot to join the waiting list."
            : "Ticket sales are now closed.";
          availability.hidden = false;
          if (submit) submit.disabled = true;
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

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    clearError();

    var name = (form.elements.buyerName.value || "").trim();
    var email = (form.elements.buyerEmail.value || "").trim();
    if (!name) return showError("Please tell us your name so we know who the booking is for.");
    if (!email || email.indexOf("@") === -1) {
      return showError("Please give us an email address — your booking confirmation goes there.");
    }
    var donation = donationPence();
    if (form.elements.giftAid && form.elements.giftAid.checked && donation <= 0) {
      return showError("Gift Aid applies to a donation, so please enter a donation amount, or untick Gift Aid.");
    }

    var body = {
      kind: kind(),
      quantity: parseInt(quantity.value, 10) || 1,
      buyerName: name,
      buyerEmail: email,
      donationPence: donation,
      coverFee: !!(form.elements.coverFee && form.elements.coverFee.checked),
      giftAid: !!(form.elements.giftAid && form.elements.giftAid.checked && donation > 0),
      newsletterOptIn: !!(form.elements.newsletterOptIn && form.elements.newsletterOptIn.checked),
      uiMode: "hosted",
    };

    submit.disabled = true;
    var original = submit.innerHTML;
    submit.textContent = "Taking you to payment…";

    fetch("/api/ball/checkout-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { status: res.status, data: data };
        });
      })
      .then(function (result) {
        if (result.status === 201 && result.data.url) {
          window.location.assign(result.data.url);
          return;
        }
        submit.disabled = false;
        submit.innerHTML = original;
        showError(
          result.data && result.data.error
            ? result.data.error
            : "Something went wrong starting your payment. Please try again, or email events@nbcc.scot.",
        );
        loadAvailability();
      })
      .catch(function () {
        submit.disabled = false;
        submit.innerHTML = original;
        showError(
          "We couldn't reach the payment page. Check your connection and try again, or email events@nbcc.scot.",
        );
      });
  });

  fillQuantities();
  recalculate();
  loadAvailability();
})();
