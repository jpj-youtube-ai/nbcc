// The Festive Ball's "Can't make it? Donate" page, /ball/donate (Jaimie, 14 October 2026).
//
// The give form is drawn by the server (src/ball/donate-page.ts); this makes it work. It is the
// fundraiser pages' give script (assets/js/fundraiser.js) cut down to what this page needs: once
// only, no fundraiser, and the marker ball: true, which the checkout (src/routes/api.ts) turns into
// the source "ball" on the donation, so it shows in Admin > Donations as Festive Ball.
//
// Stripe's own checkout opens on the page in a panel, as on the donate page; when it cannot, the
// giver goes to Stripe's page instead, and Back from there returns here. Paid, they land on the
// donate page's own thank you.
(function () {
  "use strict";

  // Kept in step with the server: BALL_GIFT_MIN_PENCE (src/routes/api.ts), and the card fee the
  // donate page shows (NBCC's Stripe charity rate, src/ball/pricing.ts).
  var MIN_PENCE = 200;
  var CARD_FEE_BP = 120;
  var CARD_FEE_FIXED_PENCE = 20;

  var MSG = {
    noAmount: "Please choose an amount, or type your own.",
    tooSmall: "The smallest donation here is £2.",
    check: "Please check the highlighted answers below and try again.",
    opening: "Opening secure payment…",
    refused: "Something in the form needs another look. Please check it and try again.",
    down: "Payment is not working just now. Please try again in a few minutes, or give on our donate page.",
  };

  function pounds(pence) {
    var whole = Math.floor(pence / 100);
    var rest = pence % 100;
    var shown = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return rest ? "£" + shown + "." + (rest < 10 ? "0" : "") + rest : "£" + shown;
  }

  function focusOn(el) {
    if (!el) return;
    try {
      el.focus();
    } catch (e) {
      /* focus unavailable */
    }
  }

  // Stripe.js comes from Stripe only once someone starts on the form, not on every visit.
  function ensureStripeJs(doc, win) {
    if (typeof win.Stripe === "function" || doc.getElementById("stripe-js-sdk")) return;
    var s = doc.createElement("script");
    s.id = "stripe-js-sdk";
    s.src = "https://js.stripe.com/v3/";
    s.async = true;
    (doc.head || doc.documentElement).appendChild(s);
  }

  var embedded = { instance: null };

  function openModal(doc) {
    var modal = doc.getElementById("bdCheckoutModal");
    if (modal) {
      modal.hidden = false;
      modal.setAttribute("aria-hidden", "false");
    }
    if (doc.body) doc.body.classList.add("give-embedded-open");
    focusOn(doc.getElementById("bdCheckoutClose"));
  }

  function closeModal(doc) {
    var modal = doc.getElementById("bdCheckoutModal");
    if (modal) {
      modal.hidden = true;
      modal.setAttribute("aria-hidden", "true");
    }
    if (doc.body) doc.body.classList.remove("give-embedded-open");
    if (embedded.instance) {
      try {
        embedded.instance.destroy();
      } catch (e) {
        /* already gone */
      }
      embedded.instance = null;
    }
    var mount = doc.getElementById("bdEmbeddedCheckout");
    if (mount) mount.innerHTML = "";
    focusOn(doc.querySelector("[data-give-submit]"));
  }

  function initBallDonate(doc, win, nav) {
    nav = nav || win.location;
    var form = doc.getElementById("bdGiveForm");
    if (!form) return null;
    // The form needs this script, so it shows only once the script is running.
    form.hidden = false;
    Array.prototype.forEach.call(doc.querySelectorAll("[data-nojs]"), function (n) {
      n.hidden = true;
    });

    var own = doc.getElementById("bdOwnAmount");
    var summary = form.querySelector("[data-give-error]");
    var submitBtn = form.querySelector("[data-give-submit]");
    var headline = form.querySelector("[data-giftaid-headline]");
    var feeText = form.querySelector("[data-cover-fee-amount]");
    var giftAid = doc.getElementById("bdGiftAid");
    var declaration = doc.getElementById("bdDeclaration");
    var nonUk = doc.getElementById("bdNonUk");
    var postcodeField = doc.getElementById("bdPostcodeField");
    var postcode = doc.getElementById("bdPostcode");
    var busy = false;

    function val(id) {
      var e = doc.getElementById(id);
      return e ? String(e.value || "").trim() : "";
    }
    function checked(id) {
      var e = doc.getElementById(id);
      return !!(e && e.checked);
    }
    function presets() {
      return Array.prototype.slice.call(form.querySelectorAll('input[name="bdAmount"]'));
    }

    /** The gift in pence: what they typed, or the preset they chose, or null. */
    function amount() {
      var typed = own ? String(own.value || "").trim() : "";
      if (typed) {
        var p = parseFloat(typed);
        return isFinite(p) && p > 0 ? Math.round(p * 100) : null;
      }
      var r = form.querySelector('input[name="bdAmount"]:checked');
      return r ? parseInt(r.value, 10) : null;
    }

    function refresh() {
      var a = amount();
      if (submitBtn && !busy) submitBtn.textContent = a ? "Give " + pounds(a) + " now" : "Give now";
      if (headline) {
        headline.textContent = a ? "Make your " + pounds(a) + " worth " + pounds(Math.round(a * 1.25)) : "Make your donation worth 25% more";
      }
      if (feeText) feeText.textContent = a ? pounds(Math.ceil((a * CARD_FEE_BP) / 10000) + CARD_FEE_FIXED_PENCE) : "a little";
      var on = !!(giftAid && giftAid.checked);
      if (declaration) {
        declaration.hidden = !on;
        // A hidden question is never asked or sent.
        Array.prototype.forEach.call(declaration.querySelectorAll("input"), function (c) {
          c.disabled = !on;
        });
      }
      var abroad = on && !!(nonUk && nonUk.checked);
      if (postcodeField) postcodeField.hidden = abroad;
      if (postcode) postcode.disabled = !on || abroad;
    }

    // A preset and your own amount are one choice: picking one clears the other.
    presets().forEach(function (r) {
      r.addEventListener("change", function () {
        if (r.checked && own) own.value = "";
      });
    });
    if (own) {
      own.addEventListener("input", function () {
        if (own.value) {
          presets().forEach(function (r) {
            r.checked = false;
          });
        }
      });
    }
    form.addEventListener("input", refresh);
    form.addEventListener("change", refresh);
    form.addEventListener("focusin", function () {
      ensureStripeJs(doc, win);
    });
    refresh();

    function showError(text) {
      if (!summary) return;
      summary.textContent = text;
      summary.hidden = false;
      summary.setAttribute("tabindex", "-1");
      focusOn(summary);
    }

    function validate() {
      var a = amount();
      var problems = !a ? [{ control: own, message: MSG.noAmount }] : a < MIN_PENCE ? [{ control: own, message: MSG.tooSmall }] : [];
      var shared = win.NBCCFormValidation;
      if (shared && typeof shared.validateForm === "function") {
        if (summary) summary.textContent = MSG.check;
        return shared.validateForm(form, {
          summary: summary,
          extraChecks: function () {
            return problems;
          },
        }).valid;
      }
      if (problems.length) {
        showError(problems[0].message);
        return false;
      }
      if (typeof form.checkValidity === "function" && !form.checkValidity()) {
        showError(MSG.check);
        return false;
      }
      return true;
    }

    function payload() {
      var body = {
        mode: "once",
        plan: null,
        amount: amount(),
        giftAid: checked("bdGiftAid"),
        coverFee: checked("bdCoverFee"),
        donorType: "individual",
        fullName: (val("bdFirstName") + " " + val("bdSurname")).trim(),
        email: val("bdEmail"),
        emailConsent: checked("bdEmailConsent"),
      };
      if (body.giftAid) {
        var abroad = checked("bdNonUk");
        body.declaration = {
          firstName: val("bdFirstName"),
          lastName: val("bdSurname"),
          houseNameNumber: val("bdHouse"),
          address: val("bdAddress"),
          nonUk: abroad,
          scope: "this_donation",
        };
        if (!abroad) body.declaration.postcode = val("bdPostcode");
      }
      body.ball = true;
      return body;
    }

    function setBusy(on) {
      busy = on;
      if (submitBtn) {
        submitBtn.disabled = on;
        if (on) submitBtn.textContent = MSG.opening;
      }
      if (!on) refresh();
    }

    function post(body, uiMode) {
      var out = {};
      for (var k in body) if (Object.prototype.hasOwnProperty.call(body, k)) out[k] = body[k];
      if (uiMode) out.uiMode = uiMode;
      return win
        .fetch("/api/checkout-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(out),
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
        });
    }

    function handle(r) {
      if (r.status === 200) return true;
      setBusy(false);
      showError(r.status === 400 ? MSG.refused : MSG.down);
      return false;
    }

    function hosted(body) {
      post(body)
        .then(function (r) {
          if (!handle(r)) return;
          if (r.data.url) nav.assign(r.data.url);
          else {
            setBusy(false);
            showError(MSG.down);
          }
        })
        .catch(function () {
          setBusy(false);
          showError(MSG.down);
        });
    }

    var mount = doc.getElementById("bdEmbeddedCheckout");
    function embeddedThenHosted(body) {
      if (typeof win.Stripe !== "function" || !mount) return hosted(body);
      post(body, "embedded")
        .then(function (r) {
          if (!handle(r)) return;
          if (!r.data.clientSecret || !r.data.publishableKey) return hosted(body);
          var stripe;
          try {
            stripe = win.Stripe(r.data.publishableKey);
          } catch (e) {
            return hosted(body);
          }
          return stripe
            .initEmbeddedCheckout({ clientSecret: r.data.clientSecret })
            .then(function (checkout) {
              embedded.instance = checkout;
              openModal(doc);
              checkout.mount(mount);
              setBusy(false);
            })
            .catch(function () {
              closeModal(doc);
              hosted(body);
            });
        })
        .catch(function () {
          hosted(body);
        });
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (busy) return;
      if (summary) summary.hidden = true;
      if (!validate()) return;
      if (typeof win.fetch !== "function") return showError(MSG.down);
      setBusy(true);
      embeddedThenHosted(payload());
    });

    var close = doc.getElementById("bdCheckoutClose");
    var modal = doc.getElementById("bdCheckoutModal");
    if (close && modal) {
      close.addEventListener("click", function () {
        closeModal(doc);
      });
      doc.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && !modal.hidden) closeModal(doc);
      });
    }
    // Back from Stripe's own page: the browser may bring this page back exactly as it was left, the
    // button still saying "Opening secure payment". Make it ready again.
    if (typeof win.addEventListener === "function") {
      win.addEventListener("pageshow", function (e) {
        if (e && e.persisted) setBusy(false);
      });
    }

    return { amount: amount, payload: payload };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { initBallDonate: initBallDonate };
  } else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      initBallDonate(document, window);
    });
  } else {
    initBallDonate(document, window);
  }
})();
