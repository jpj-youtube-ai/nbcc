// A community fundraiser's page, /fundraise/<slug> (TASK-494).
//
// The page itself is drawn by the server and reads fine without this file. This adds:
//   - the give form: an amount (presets or your own, the smallest set by the server), the donate
//     page's Gift Aid and card fee offers, then the donate page's checkout: POST /api/checkout-session
//     with the same body the donate page sends for a one off gift, plus fundraiserId. Stripe opens on
//     the page when it can and on Stripe's own page when it cannot, exactly as on the donate page
//     (assets/js/main.js startCheckout);
//   - TASK-502: the thank you after paying: the payment's id comes out of the address bar at once,
//     and the optional step to add a message and the wall choices is sent to
//     POST /api/fundraisers/<slug>/wall-message (the message and choices left the give form);
//   - the supporter wall: the newest ten, then Show all grows the page with the rest;
//   - the copy link button, shown only where copying works.
//
// Its own file rather than main.js, which counts towards donate.html's page weight budget. It uses
// main.js's shared field highlighting (window.NBCCFormValidation) when it is there. A classic
// <script defer>, exported under a CommonJS guard so it can be unit tested in jsdom.
(function () {
  "use strict";

  // The card fee shown beside the offer, as the donate page shows it (main.js). The server works out
  // the real figure from the rate it holds; this is only the words.
  var CARD_FEE_BP = 120;
  var CARD_FEE_FIXED_PENCE = 20;

  var MSG = {
    noAmount: "Please choose an amount, or type your own.",
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

  // A text box grows with what is typed, so nothing ever scrolls inside it (Jaimie's rule). CSS
  // field-sizing does this where the browser supports it; this does it everywhere else.
  function growTextareas(root) {
    Array.prototype.forEach.call(root.querySelectorAll("textarea"), function (t) {
      function grow() {
        if (!t.scrollHeight) return;
        t.style.height = "auto";
        t.style.height = t.scrollHeight + 4 + "px";
        t.style.overflowY = "hidden";
      }
      t.addEventListener("input", grow);
      t.__frGrow = grow;
      grow();
    });
  }

  // The forms ship hidden (without JavaScript the browser would send them as a web address, names
  // and all); the script that can send them properly shows them and hides the line saying so.
  function showForms(doc, root) {
    Array.prototype.forEach.call((root || doc).querySelectorAll("form[data-needs-js]"), function (f) {
      f.hidden = false;
    });
    Array.prototype.forEach.call(doc.querySelectorAll("[data-nojs]"), function (n) {
      n.hidden = true;
    });
  }

  function initGiveForm(doc, win, nav) {
    var form = doc.getElementById("frGiveForm");
    if (!form) return null;
    showForms(doc, form.parentNode);
    nav = nav || { assign: function (u) { win.location.href = u; } };

    var fundraiserId = parseInt(form.getAttribute("data-fundraiser-id"), 10);
    var minimum = parseInt(form.getAttribute("data-minimum-pence"), 10) || 200;
    var own = doc.getElementById("frOwnAmount");
    var submitBtn = form.querySelector("[data-give-submit]");
    var summary = form.querySelector("[data-give-error]");
    var giftAid = doc.getElementById("frGiftAid");
    var declaration = doc.getElementById("frDeclaration");
    var nonUk = doc.getElementById("frNonUk");
    var postcodeField = doc.getElementById("frPostcodeField");
    var postcode = doc.getElementById("frPostcode");
    var headline = form.querySelector("[data-giftaid-headline]");
    var feeText = form.querySelector("[data-cover-fee-amount]");
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
      return Array.prototype.slice.call(form.querySelectorAll('input[name="frAmount"]'));
    }

    /** The gift in pence: what they typed, or the preset they chose, or null. */
    function amount() {
      var typed = own ? String(own.value || "").trim() : "";
      if (typed) {
        var p = parseFloat(typed);
        return isFinite(p) && p > 0 ? Math.round(p * 100) : null;
      }
      var r = form.querySelector('input[name="frAmount"]:checked');
      return r ? parseInt(r.value, 10) : null;
    }

    function refresh() {
      var a = amount();
      if (submitBtn && !busy) submitBtn.textContent = a ? "Give " + pounds(a) + " now" : "Give now";
      if (headline) headline.textContent = a ? "Make your " + pounds(a) + " worth " + pounds(Math.round(a * 1.25)) : "Make your donation worth 25% more";
      if (feeText) feeText.textContent = a ? pounds(Math.ceil((a * CARD_FEE_BP) / 10000) + CARD_FEE_FIXED_PENCE) : "a little";
      if (declaration && giftAid) declaration.hidden = !giftAid.checked;
      var abroad = !!(nonUk && nonUk.checked);
      if (postcodeField) postcodeField.hidden = abroad;
      if (postcode) {
        postcode.disabled = abroad;
        postcode.required = !abroad;
      }
    }

    // A preset and your own amount are one choice: picking one clears the other.
    presets().forEach(function (r) {
      r.addEventListener("change", function () {
        if (r.checked && own) own.value = "";
      });
    });
    if (own) {
      own.addEventListener("input", function () {
        if (own.value) presets().forEach(function (r) { r.checked = false; });
      });
    }
    form.addEventListener("input", refresh);
    form.addEventListener("change", refresh);
    refresh();

    // Stripe.js comes from Stripe only once someone starts on the form, not on every visit.
    form.addEventListener("focusin", function () {
      ensureStripeJs(doc, win);
    });

    function validate(serverChecks) {
      var shared = win.NBCCFormValidation;
      var extra = function () {
        if (serverChecks) return serverChecks;
        var a = amount();
        if (!a) return [{ control: own, message: MSG.noAmount }];
        if (a < minimum) return [{ control: own, message: "The smallest donation here is " + pounds(minimum) + "." }];
        return [];
      };
      if (shared && typeof shared.validateForm === "function") {
        if (summary) summary.textContent = MSG.check;
        return shared.validateForm(form, { summary: summary, extraChecks: extra }).valid;
      }
      var problems = extra();
      if (problems.length) {
        showError(problems[0].message);
        return false;
      }
      return typeof form.checkValidity !== "function" || form.checkValidity();
    }

    function showError(text) {
      if (!summary) return;
      summary.textContent = text;
      summary.hidden = false;
      summary.setAttribute("tabindex", "-1");
      try {
        summary.focus();
      } catch (e) {
        /* focus unavailable */
      }
    }

    function payload() {
      var body = {
        mode: "once",
        plan: null,
        amount: amount(),
        giftAid: checked("frGiftAid"),
        coverFee: checked("frCoverFee"),
        donorType: "individual",
        fullName: (val("frFirstName") + " " + val("frSurname")).trim(),
        email: val("frEmail"),
        emailConsent: checked("frEmailConsent"),
        fundraiserId: fundraiserId,
      };
      if (body.giftAid) {
        var abroad = checked("frNonUk");
        body.declaration = {
          firstName: val("frFirstName"),
          lastName: val("frSurname"),
          houseNameNumber: val("frHouse"),
          address: val("frAddress"),
          nonUk: abroad,
          scope: "this_donation",
        };
        if (!abroad) body.declaration.postcode = val("frPostcode");
      }
      // Keys in the order the donate page sends them, then the fundraiser's; tidy for anyone reading.
      var ordered = {};
      ["mode", "plan", "amount", "giftAid", "coverFee", "donorType", "fullName", "email", "emailConsent", "declaration", "fundraiserId"].forEach(function (k) {
        if (Object.prototype.hasOwnProperty.call(body, k)) ordered[k] = body[k];
      });
      return ordered;
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

    var mount = doc.getElementById("frEmbeddedCheckout");
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
      if (!validate(null)) return;
      if (typeof win.fetch !== "function") return showError(MSG.down);
      setBusy(true);
      embeddedThenHosted(payload());
    });

    growTextareas(form);
    wireModal(doc);
    return { payload: payload, amount: amount };
  }

  // --- Stripe on the page: the donate page's modal, driven from here -------------------------------
  var embedded = { instance: null, wired: false };

  function ensureStripeJs(doc, win) {
    if (typeof win.Stripe === "function" || doc.getElementById("stripe-js-sdk")) return;
    if (!doc.getElementById("frEmbeddedCheckout")) return;
    var s = doc.createElement("script");
    s.id = "stripe-js-sdk";
    s.src = "https://js.stripe.com/v3/";
    s.async = true;
    (doc.head || doc.documentElement).appendChild(s);
  }

  function openModal(doc) {
    var modal = doc.getElementById("embeddedCheckoutModal");
    if (modal) {
      modal.hidden = false;
      modal.setAttribute("aria-hidden", "false");
    }
    if (doc.body) doc.body.classList.add("give-embedded-open");
    var close = doc.getElementById("embeddedCheckoutClose");
    if (close) {
      try {
        close.focus();
      } catch (e) {
        /* focus unavailable */
      }
    }
  }

  function closeModal(doc) {
    var modal = doc.getElementById("embeddedCheckoutModal");
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
    var mount = doc.getElementById("frEmbeddedCheckout");
    if (mount) mount.innerHTML = "";
    var give = doc.querySelector("[data-give-submit]");
    if (give) {
      try {
        give.focus();
      } catch (e) {
        /* focus unavailable */
      }
    }
  }

  function wireModal(doc) {
    var close = doc.getElementById("embeddedCheckoutClose");
    var modal = doc.getElementById("embeddedCheckoutModal");
    if (!close || !modal || close.__frWired) return;
    close.__frWired = true;
    close.addEventListener("click", function () {
      closeModal(doc);
    });
    doc.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !modal.hidden) closeModal(doc);
    });
  }

  // --- the supporter wall: ten, then Show all ---------------------------------------------------
  function initWall(doc) {
    var more = doc.querySelector("[data-wall-show-all]");
    var extra = Array.prototype.slice.call(doc.querySelectorAll(".fr-wall__item[data-wall-more]"));
    if (!more || !extra.length) return null;
    extra.forEach(function (li) {
      li.hidden = true;
    });
    more.hidden = false;
    more.addEventListener("click", function () {
      extra.forEach(function (li) {
        li.hidden = false;
      });
      more.hidden = true;
      try {
        extra[0].focus();
      } catch (e) {
        /* focus unavailable */
      }
    });
    return { more: more };
  }

  // --- the news updates (TASK-506): the newest few, then Show all -------------------------------
  // The server marks those after the first few; without this script they all show, and the page is
  // simply longer. Nothing scrolls inside a box: Show all grows the page.
  function initNews(doc) {
    var more = doc.querySelector("[data-news-show-all]");
    var extra = Array.prototype.slice.call(doc.querySelectorAll(".fr-news__item[data-news-more]"));
    if (!more || !extra.length) return null;
    extra.forEach(function (li) {
      li.hidden = true;
    });
    more.hidden = false;
    more.addEventListener("click", function () {
      extra.forEach(function (li) {
        li.hidden = false;
      });
      more.hidden = true;
      try {
        extra[0].focus();
      } catch (e) {
        /* focus unavailable */
      }
    });
    return { more: more };
  }

  // --- copy the link ----------------------------------------------------------------------------
  // Every copy button on the page (the share card's, and the thank you's after paying), each saying
  // so in the status line beside it.
  function initShare(doc, win) {
    var buttons = Array.prototype.slice.call(doc.querySelectorAll("[data-copy-link]"));
    var clip = win && win.navigator && win.navigator.clipboard;
    if (!buttons.length || !clip || typeof clip.writeText !== "function") return null;
    buttons.forEach(function (btn) {
      var scope = btn.closest("[data-copy-scope]") || doc;
      var status = scope.querySelector("[data-copy-status]");
      btn.hidden = false;
      btn.addEventListener("click", function () {
        var url = btn.getAttribute("data-copy-link");
        clip.writeText(url).then(
          function () {
            if (status) status.textContent = "Link copied. You can paste it anywhere.";
          },
          function () {
            if (status) status.textContent = "Copying did not work here. The link is " + url;
          },
        );
      });
    });
    return { buttons: buttons };
  }

  // Back from paying: the thank you takes focus, so a screen reader hears it first. TASK-502: the
  // payment's id (session_id, which Stripe filled in) comes straight out of the address bar, so it is
  // never copied, shared, bookmarked or kept in the history. The page keeps it for the wall step, and
  // a reload is the plain thank you.
  function initThanks(doc, win) {
    var loc = win && win.location;
    if (loc && /[?&]session_id=/.test(String(loc.search || "")) && win.history && typeof win.history.replaceState === "function") {
      try {
        win.history.replaceState(null, "", loc.pathname + "?thanks=1");
      } catch (e) {
        /* the address stays as it is */
      }
    }
    var panel = doc.querySelector("[data-thanks-panel]");
    if (!panel) return null;
    try {
      panel.focus({ preventScroll: true });
    } catch (e) {
      /* focus unavailable */
    }
    return panel;
  }

  // --- the optional step after paying (TASK-502) ---------------------------------------------------
  // A message for the wall, and whether to show their name and the amount, tied to the payment by its
  // checkout session id. The server checks everything again; this only sends it and says what it says.
  var WALL_MSG = {
    sending: "Adding…",
    down: "We could not reach the wall just now. Please try again in a moment.",
    refused: "Please check your message and try again.",
  };

  function initWallStep(doc, win, nav) {
    var step = doc.querySelector("[data-wall-step]");
    var form = doc.getElementById("frWallForm");
    if (!step || !form) return null;
    nav = nav || { assign: function (u) { win.location.href = u; } };
    var slug = step.getAttribute("data-slug") || "";
    // Event pages: an event's page says its own address (/event/<short name>); a fundraiser's is
    // /fundraise/<slug>, as it always was.
    var pagePath = step.getAttribute("data-page") || "/fundraise/" + encodeURIComponent(slug);
    var sessionId = step.getAttribute("data-session-id") || "";
    var message = doc.getElementById("frMessage");
    var count = form.querySelector("[data-message-count]");
    var error = form.querySelector("[data-wall-error]");
    var submit = form.querySelector("[data-wall-submit]");
    var skip = form.querySelector("[data-wall-skip]");
    var busy = false;
    step.hidden = false;

    function counted() {
      if (!count || !message) return;
      var left = 200 - message.value.length;
      count.textContent = message.value ? (left === 1 ? "1 character left." : left + " characters left.") : "Up to 200 characters.";
    }
    if (message) message.addEventListener("input", counted);
    counted();
    growTextareas(form);

    function showError(text) {
      if (!error) return;
      error.textContent = text;
      error.hidden = false;
      error.setAttribute("tabindex", "-1");
      try {
        error.focus();
      } catch (e) {
        /* focus unavailable */
      }
    }

    function setBusy(on) {
      busy = on;
      if (!submit) return;
      submit.disabled = on;
      submit.textContent = on ? WALL_MSG.sending : "Add to the wall";
    }

    function checked(id) {
      var e = doc.getElementById(id);
      return !!(e && e.checked);
    }

    // The server's word on the message itself goes beside the box, the donate page's way when its
    // shared field highlighting is there; anything else is the line at the top of the step.
    function refusal(data) {
      var text = data && data.fields && data.fields.message;
      var shared = win.NBCCFormValidation;
      if (text && message && shared && typeof shared.validateForm === "function") {
        shared.validateForm(form, {
          summary: error,
          extraChecks: function () {
            return [{ control: message, message: text }];
          },
        });
        return;
      }
      showError(text || (data && data.error) || WALL_MSG.refused);
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (busy) return;
      if (error) error.hidden = true;
      if (typeof win.fetch !== "function") return showError(WALL_MSG.down);
      setBusy(true);
      var body = {
        sessionId: sessionId,
        message: message ? String(message.value || "").trim() : "",
        showName: !checked("frShowNameNo"),
        showAmount: checked("frShowAmount"),
      };
      win
        .fetch("/api/fundraisers/" + encodeURIComponent(slug) + "/wall-message", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
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
          if (r.status === 200) {
            // Saved: the page again, with the thank you and the wall as it now is.
            nav.assign(pagePath + "?thanks=1&added=1");
            return;
          }
          setBusy(false);
          if (r.status === 400) return refusal(r.data);
          showError((r.data && r.data.error) || WALL_MSG.down);
        })
        .catch(function () {
          setBusy(false);
          showError(WALL_MSG.down);
        });
    });

    // No thanks: the step simply closes, and the thank you keeps the focus.
    if (skip) {
      skip.addEventListener("click", function () {
        step.hidden = true;
        var panel = doc.querySelector("[data-thanks-panel]");
        if (panel) {
          try {
            panel.focus({ preventScroll: true });
          } catch (e) {
            /* focus unavailable */
          }
        }
      });
    }
    return { step: step };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      initGiveForm: initGiveForm,
      initWall: initWall,
      initNews: initNews,
      initShare: initShare,
      initThanks: initThanks,
      initWallStep: initWallStep,
    };
  } else {
    initGiveForm(document, window);
    initWall(document);
    initNews(document);
    initShare(document, window);
    initThanks(document, window);
    initWallStep(document, window);
  }
})();
