// Event tickets on an event's page, /event/<short name> (Jaimie, points 23 and 24).
//
// The server draws the Get tickets section (src/tickets/render.ts), with the form hidden. This shows
// it, adds up the total as tickets are chosen (the card fee cover by the server's own sum, which the
// server works out again: this is only for show), and sends the order to
// POST /api/event-tickets/:id/checkout, then goes on to Stripe's own checkout. If the tickets have
// gone in the meantime it says so and reads what is left (GET /api/event-tickets/:id).
// After paying, the buyer comes back to ?tickets=thanks&ticket_session=...: the thank you is drawn by the
// server, and this takes the payment's id out of the address bar.
//
// Kept apart from fundraiser.js (the give form), as tickets and gifts are never mixed. A classic
// <script defer>, exported under a CommonJS guard so it can be unit tested in jsdom.
(function () {
  "use strict";

  var MAX_PER_ORDER = 20;
  var CAPTCHA_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=nbccTicketsTurnstileReady";

  function money(pence) {
    var p = Math.max(0, Math.round(Number(pence) || 0));
    var pounds = Math.floor(p / 100);
    var rest = p % 100;
    return "£" + pounds.toLocaleString("en-GB") + (rest ? "." + String(rest).padStart(2, "0") : "");
  }

  // What Stripe takes on a charge: the percentage rounded up, plus the fixed part, once.
  function stripeFee(amount, bp, fixed) {
    return Math.ceil((amount * bp) / 10000) + fixed;
  }

  // The fee to add so NBCC nets the ticket money: src/ball/pricing.ts grossedUpFeePence, to the penny.
  function feeCoverPence(target, bp, fixed) {
    if (!(target > 0)) return 0;
    var charged = Math.ceil(((target + fixed) * 10000) / (10000 - bp));
    for (var i = 0; i < 4 && charged - stripeFee(charged, bp, fixed) < target; i += 1) charged += 1;
    return charged - target;
  }

  function initEventTickets(doc, win) {
    // The thank you: never leave the payment's id in the address bar.
    var thanks = doc.querySelector("[data-et-thanks]");
    try {
      if (/[?&]ticket_session=/.test(win.location.search || "")) win.history.replaceState(null, "", win.location.pathname);
      if (thanks) thanks.focus();
    } catch (e) {
      /* history or focus unavailable */
    }

    var form = doc.querySelector("form[data-et-form]");
    if (!form) return null;
    form.hidden = false;
    var section = form.closest ? form.closest(".et-tickets") : null;
    Array.prototype.forEach.call((section || doc).querySelectorAll("[data-nojs]"), function (n) {
      n.hidden = true;
    });

    var id = form.getAttribute("data-fundraiser-id");
    var bp = Number(form.getAttribute("data-fee-bp")) || 0;
    var fixed = Number(form.getAttribute("data-fee-fixed")) || 0;
    var errorBox = form.querySelector("[data-et-error]");
    var status = form.querySelector("[data-et-status]");
    var totalBox = form.querySelector("[data-et-total]");
    var feeBox = form.querySelector("[data-et-fee]");
    var cover = doc.getElementById("etCoverFee");
    var button = form.querySelector("[data-et-submit]");
    var sending = false;

    // The spam check (Cloudflare Turnstile), only when the server says it is on (data-captcha-key).
    // Loaded when the buyer first touches the form, as on the sign up form; the server checks the pass.
    var captchaBox = form.querySelector("[data-et-captcha]");
    var captcha = { key: form.getAttribute("data-captcha-key") || "", token: "", widget: null, loading: false };
    function renderCaptcha() {
      if (captcha.widget !== null || !win.turnstile || !captchaBox) return;
      captchaBox.hidden = false;
      captcha.widget = win.turnstile.render(captchaBox, {
        sitekey: captcha.key,
        size: (form.clientWidth || 400) >= 340 ? "flexible" : "compact",
        callback: function (token) {
          captcha.token = token;
        },
        "expired-callback": function () {
          captcha.token = "";
        },
        "error-callback": function () {
          captcha.token = "";
        },
      });
    }
    function loadCaptcha() {
      if (!captcha.key || captcha.loading) return;
      captcha.loading = true;
      win.nbccTicketsTurnstileReady = renderCaptcha;
      var s = doc.createElement("script");
      s.src = CAPTCHA_URL;
      s.async = true;
      s.onerror = function () {
        captcha.loading = false;
      };
      doc.head.appendChild(s);
    }
    function resetCaptcha() {
      captcha.token = "";
      try {
        if (win.turnstile && captcha.widget !== null) win.turnstile.reset(captcha.widget);
      } catch (e) {
        /* the widget has gone */
      }
    }
    if (captcha.key) {
      form.addEventListener("focusin", loadCaptcha);
      form.addEventListener("click", loadCaptcha);
    }

    function inputs() {
      return Array.prototype.slice.call(form.querySelectorAll("input[data-et-qty]"));
    }
    function qty(input) {
      var n = Math.floor(Number(input.value));
      var max = Number(input.max) || MAX_PER_ORDER;
      if (!isFinite(n) || n < 0) n = 0;
      return Math.min(n, max);
    }
    function val(elId) {
      var e = doc.getElementById(elId);
      return e ? String(e.value || "").trim() : "";
    }
    function sayError(text) {
      if (!errorBox) return;
      errorBox.textContent = text || "";
      errorBox.hidden = !text;
    }
    function say(text, kind) {
      if (!status) return;
      status.textContent = text || "";
      status.className = "form-status" + (text && kind ? " is-" + kind : "");
    }

    function update() {
      var tickets = 0;
      var count = 0;
      inputs().forEach(function (input) {
        var n = qty(input);
        if (String(n) !== input.value) input.value = String(n);
        tickets += n * Number(input.getAttribute("data-price"));
        count += n;
        var row = input.closest ? input.closest(".et-type") : null;
        if (row) row.classList.toggle("is-chosen", n > 0);
        var max = Number(input.max) || MAX_PER_ORDER;
        var steps = row ? row.querySelectorAll("[data-et-step]") : [];
        Array.prototype.forEach.call(steps, function (b) {
          b.disabled = b.getAttribute("data-et-step") === "1" ? n >= max : n <= 0;
        });
      });
      var fee = feeCoverPence(tickets, bp, fixed);
      var covering = !!(cover && cover.checked);
      if (feeBox) feeBox.textContent = tickets > 0 ? "£" + (fee / 100).toFixed(2) : "a little";
      // Free tickets that still need booking: nothing to pay, so it says Free and Book, not Buy.
      var free = count > 0 && tickets === 0;
      if (totalBox) totalBox.textContent = free ? "Free" : covering && tickets > 0 ? "£" + ((tickets + fee) / 100).toFixed(2) : money(tickets);
      if (button) {
        button.disabled = sending || count === 0;
        button.textContent = free ? "Book tickets" : "Buy tickets";
      }
      return count;
    }

    form.addEventListener("click", function (e) {
      var b = e.target && e.target.closest ? e.target.closest("[data-et-step]") : null;
      if (!b || b.disabled) return;
      var row = b.closest(".et-type");
      var input = row ? row.querySelector("input[data-et-qty]") : null;
      if (!input) return;
      var max = Number(input.max) || MAX_PER_ORDER;
      input.value = String(Math.max(0, Math.min(max, qty(input) + Number(b.getAttribute("data-et-step")))));
      sayError("");
      update();
    });
    form.addEventListener("input", function (e) {
      if (e.target && e.target.hasAttribute && e.target.hasAttribute("data-et-qty")) update();
    });
    form.addEventListener("change", update);

    // What is left now, after a refusal: new limits on each box, and Sold out where there are none.
    function refresh() {
      return win
        .fetch("/api/event-tickets/" + encodeURIComponent(id), { credentials: "same-origin" })
        .then(function (res) {
          return res.status === 200 ? res.json() : null;
        })
        .then(function (data) {
          if (!data) return;
          if (data.state !== "open") {
            win.location.assign(win.location.pathname + "#tickets");
            if (win.location.reload) win.location.reload();
            return;
          }
          (data.types || []).forEach(function (t) {
            var input = doc.getElementById("etQty-" + t.id);
            if (!input) return;
            var max = t.remaining === null ? MAX_PER_ORDER : Math.min(MAX_PER_ORDER, t.remaining);
            input.max = String(max);
            if (Number(input.value) > max) input.value = String(max);
            var row = input.closest ? input.closest(".et-type") : null;
            if (isFinite(Number(t.pricePence))) input.setAttribute("data-price", String(t.pricePence));
            var few = row ? row.querySelector(".et-type__few") : null;
            if (few) few.textContent = t.soldOut ? "Sold out" : "Only " + t.remaining + " left";
          });
          update();
        })
        .catch(function () {
          /* the message already says what happened */
        });
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (sending) return;
      sayError("");
      say("", null);
      if (update() === 0) return sayError("Choose how many tickets you would like.");
      var email = val("etEmail");
      if (!val("etFirstName") || !val("etSurname") || !/^\S+@\S+\.\S+$/.test(email)) {
        return sayError("Please tell us your first name, your surname and your email address.");
      }
      if (typeof win.fetch !== "function") return sayError("We could not start your booking. Please try again, or email events@nbcc.scot.");
      if (captcha.key && !captcha.token) {
        loadCaptcha();
        return sayError("One moment: we are checking you are not a robot. Then press Buy tickets again.");
      }
      var body = {
        lines: inputs()
          .map(function (input) {
            // The price this page showed: the server refuses the order if it has changed since.
            return { typeId: Number(input.getAttribute("data-type-id")), quantity: qty(input), pricePence: Number(input.getAttribute("data-price")) };
          })
          .filter(function (l) {
            return l.quantity > 0;
          }),
        firstName: val("etFirstName"),
        lastName: val("etSurname"),
        email: email,
        phone: val("etPhone"),
        coverFee: !!(cover && cover.checked),
        company: val("etCompany"),
        captchaToken: captcha.token,
      };
      sending = true;
      update();
      say(update() > 0 && totalBox && totalBox.textContent === "Free" ? "Booking your tickets…" : "Taking you to our secure payment page…", "pending");
      win
        .fetch("/api/event-tickets/" + encodeURIComponent(id) + "/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify(body),
        })
        .then(function (res) {
          return res.json().then(
            function (data) {
              return { status: res.status, data: data || {} };
            },
            function () {
              return { status: res.status, data: {} };
            },
          );
        })
        .then(function (r) {
          if (r.status === 200 && r.data.url) {
            win.location.assign(r.data.url);
            return;
          }
          sending = false;
          say("", null);
          resetCaptcha();
          if (r.status === 400 && r.data.error === "captcha") {
            sayError("We could not check you are not a robot. Please try again.");
          } else if (r.status === 400 && r.data.fields) {
            sayError(
              Object.keys(r.data.fields)
                .map(function (k) {
                  return r.data.fields[k];
                })
                .join(" "),
            );
          } else if (r.status === 409) {
            sayError(r.data.error || "Sorry, those tickets have gone.");
            update();
            return refresh();
          } else if (r.status === 429) {
            sayError(r.data.error || "Too many tries. Please wait a few minutes and try again.");
          } else {
            sayError(r.data.error && r.status !== 404 ? r.data.error : "We could not start your booking just now. Please try again in a few minutes.");
          }
          update();
        })
        .catch(function () {
          sending = false;
          say("", null);
          sayError("We could not start your booking just now. Please try again in a few minutes.");
          update();
        });
    });

    update();
    return { update: update };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { initEventTickets: initEventTickets, feeCoverPence: feeCoverPence };
  } else {
    initEventTickets(document, window);
  }
})();
