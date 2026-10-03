// "Sponsor now, pay after" on a fundraiser's page (sponsor pledges, Jaimie 2026-10-03).
//
// The page's server (src/pledges/render.ts) draws the pledge form hidden; this shows it and:
//   - keeps the Gift Aid declaration in step with the amount typed, so what they read is exactly what
//     is kept ("I want to Gift Aid my donation of £10 when I pay it, ...");
//   - shows the home address only once Gift Aid is ticked, and no postcode for a home outside the UK;
//   - sends the pledge as JSON to POST /api/fundraisers/<slug>/pledges, with the spam check the sign
//     up form uses (Turnstile, only when GET /api/fundraise/captcha says it is on);
//   - says "nearly done" in place: the sponsor is emailed a link to confirm, and only a confirmed
//     pledge shows on the page. A pledge is a promise: nothing is paid here, and no payment page opens.
// Kept apart from fundraiser.js (the give form) so each can change without the other.
//
// A classic <script defer>, exported under a CommonJS guard so it can be unit tested in jsdom.
(function () {
  "use strict";

  var SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=nbccPledgeTurnstileReady";
  var MSG = {
    check: "Please check the highlighted answers below and try again.",
    noAmount: "Tell us how much you would like to pledge.",
    sending: "Sending your pledge…",
    failed: "We could not take your pledge just now. Please try again in a few minutes.",
    tooMuch: "For a pledge over £1,000, please call us on 01292 811 015.",
    captcha: "The check that you're not a robot did not go through. Please try it again, then press Make my pledge.",
  };
  // What the server calls each answer, and the field it belongs to.
  var FIELDS = {
    amountPence: "plAmount",
    firstName: "plFirstName",
    surname: "plSurname",
    email: "plEmail",
    message: "plMessage",
    house: "plHouse",
    address: "plAddress",
    postcode: "plPostcode",
  };

  function pounds(pence) {
    var n = Number(pence) || 0;
    var whole = n % 100 === 0;
    try {
      return "£" + (n / 100).toLocaleString("en-GB", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
    } catch (e) {
      return "£" + (whole ? String(n / 100) : (n / 100).toFixed(2));
    }
  }

  function initPledgeForm(doc, win) {
    var form = doc.getElementById("pledgeForm");
    if (!form) return null;
    var section = doc.getElementById("pledge") || form.parentNode;
    form.hidden = false;
    Array.prototype.forEach.call(section.querySelectorAll("[data-nojs]"), function (n) {
      n.hidden = true;
    });

    var slug = form.getAttribute("data-slug") || "";
    var minimum = parseInt(form.getAttribute("data-minimum-pence"), 10) || 200;
    var MAXIMUM = 100000; // £1,000: more than that is a phone call
    var amountBox = doc.getElementById("plAmount");
    var summary = form.querySelector("[data-pledge-error]");
    var status = form.querySelector("[data-pledge-status]");
    var submitBtn = form.querySelector("[data-pledge-submit]");
    var done = section.querySelector("[data-pledge-done]");
    var giftAid = doc.getElementById("plGiftAid");
    var declaration = doc.getElementById("plDeclaration");
    var nonUk = doc.getElementById("plNonUk");
    var postcodeField = doc.getElementById("plPostcodeField");
    var postcode = doc.getElementById("plPostcode");
    var gaAmount = form.querySelector("[data-pledge-ga-amount]");
    var gaDefault = gaAmount ? gaAmount.textContent : "";
    var message = doc.getElementById("plMessage");
    var count = form.querySelector("[data-pledge-count]");
    var tokenField = doc.getElementById("pledgeCaptchaToken");
    var captchaBox = doc.getElementById("pledgeCaptcha");
    var busy = false;

    function val(id) {
      var e = doc.getElementById(id);
      return e ? String(e.value || "").trim() : "";
    }
    function checked(id) {
      var e = doc.getElementById(id);
      return !!(e && e.checked);
    }

    /** The pledge in pence, or null when nothing usable is typed. */
    function amount() {
      var typed = amountBox ? String(amountBox.value || "").trim() : "";
      if (!typed) return null;
      var p = parseFloat(typed);
      return isFinite(p) && p > 0 ? Math.round(p * 100) : null;
    }

    function refresh() {
      var a = amount();
      if (gaAmount) gaAmount.textContent = a ? pounds(a) : gaDefault;
      if (submitBtn && !busy) submitBtn.textContent = a ? "Pledge " + pounds(a) : "Make my pledge";
      var aided = !!(giftAid && giftAid.checked);
      if (declaration) {
        declaration.hidden = !aided;
        // Switched off while hidden, so an address nobody was asked for is never required or sent.
        declaration.disabled = !aided;
      }
      var abroad = !!(nonUk && nonUk.checked);
      if (postcodeField) postcodeField.hidden = abroad;
      if (postcode) {
        postcode.disabled = abroad;
        postcode.required = !abroad;
      }
      if (message && count) {
        var left = 200 - String(message.value || "").length;
        count.textContent = message.value ? left + (left === 1 ? " character left." : " characters left.") : "Up to 200 characters.";
      }
    }
    form.addEventListener("input", refresh);
    form.addEventListener("change", refresh);
    refresh();

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
    function clearError() {
      if (summary) {
        summary.textContent = "";
        summary.hidden = true;
      }
    }
    function say(text) {
      if (status) status.textContent = text;
    }

    function validate(serverChecks) {
      var shared = win.NBCCFormValidation;
      var extra = function () {
        if (serverChecks) return serverChecks;
        var a = amount();
        if (!a) return [{ control: amountBox, message: MSG.noAmount }];
        if (a < minimum) return [{ control: amountBox, message: "The smallest pledge is " + pounds(minimum) + "." }];
        if (a > MAXIMUM) return [{ control: amountBox, message: MSG.tooMuch }];
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
      if (typeof form.checkValidity === "function" && !form.checkValidity()) {
        showError(MSG.check);
        return false;
      }
      return true;
    }

    // --- the spam check, loaded only when needed (as on the sign up form) --------------------------
    var captcha = { on: false, siteKey: null, loading: false, widgetId: null };
    function renderCaptcha() {
      if (captcha.widgetId !== null || !win.turnstile || !captchaBox) return;
      captchaBox.hidden = false;
      captcha.widgetId = win.turnstile.render(captchaBox, {
        sitekey: captcha.siteKey,
        size: (form.clientWidth || 400) >= 340 ? "flexible" : "compact",
        callback: function (token) {
          if (tokenField) tokenField.value = token;
        },
        "expired-callback": function () {
          if (tokenField) tokenField.value = "";
        },
        "error-callback": function () {
          if (tokenField) tokenField.value = "";
        },
      });
    }
    function loadCaptcha() {
      if (!captcha.on || captcha.loading) return;
      captcha.loading = true;
      win.nbccPledgeTurnstileReady = renderCaptcha;
      var s = doc.createElement("script");
      s.src = SCRIPT_URL;
      s.async = true;
      s.defer = true;
      s.onerror = function () {
        captcha.loading = false;
        if (s.parentNode) s.parentNode.removeChild(s);
      };
      doc.head.appendChild(s);
    }
    function resetCaptcha() {
      if (tokenField) tokenField.value = "";
      if (win.turnstile && captcha.widgetId !== null) win.turnstile.reset(captcha.widgetId);
    }
    form.addEventListener("focusin", loadCaptcha);
    if (typeof win.fetch === "function") {
      win
        .fetch("/api/fundraise/captcha")
        .then(function (res) {
          return res && res.ok ? res.json() : null;
        })
        .then(function (data) {
          if (!data || !data.siteKey) return;
          captcha.siteKey = data.siteKey;
          captcha.on = true;
          if (form.contains(doc.activeElement)) loadCaptcha();
        })
        .catch(function () {
          /* Could not ask: the server still checks if the check is on. */
        });
    }

    function setBusy(on) {
      busy = on;
      if (submitBtn) submitBtn.disabled = on;
      say(on ? MSG.sending : "");
      if (!on) refresh();
    }

    // What they see next, built from text nodes with nothing they typed in it. It is not a pledge
    // yet: it counts once they press the button in the email.
    function thank(pence) {
      if (!done) return;
      while (done.firstChild) done.removeChild(done.firstChild);
      var h = doc.createElement("h3");
      h.className = "fr-pledge__done-title";
      h.textContent = "Nearly done: we've emailed you a link to confirm your pledge.";
      var p1 = doc.createElement("p");
      p1.textContent = "Please press the button in that email, and your " + pounds(pence) + " pledge will show on this page. There is nothing to pay today.";
      var p2 = doc.createElement("p");
      p2.textContent = "No email in a few minutes? Check your junk folder. A pledge that isn't confirmed is deleted after 7 days.";
      done.appendChild(h);
      done.appendChild(p1);
      done.appendChild(p2);
      form.hidden = true;
      done.hidden = false;
      try {
        done.focus();
      } catch (e) {
        /* focus unavailable */
      }
    }

    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      if (busy) return;
      clearError();
      refresh();
      if (!validate()) return;
      var pence = amount();
      var body = {
        amountPence: pence,
        firstName: val("plFirstName"),
        surname: val("plSurname"),
        email: val("plEmail"),
        message: val("plMessage"),
        showName: checked("plShowNameYes"),
        showAmount: checked("plShowAmount"),
        giftAid: checked("plGiftAid"),
        company: val("plCompany"),
        captchaToken: tokenField ? tokenField.value : "",
      };
      if (body.giftAid) {
        body.nonUk = checked("plNonUk");
        body.house = val("plHouse");
        body.address = val("plAddress");
        if (!body.nonUk) body.postcode = val("plPostcode");
      }
      setBusy(true);
      win
        .fetch("/api/fundraisers/" + encodeURIComponent(slug) + "/pledges", {
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
          setBusy(false);
          if (r.status === 201) return thank(r.data.amountPence || pence);
          resetCaptcha();
          if (r.status === 400 && r.data.error === "captcha") return showError(MSG.captcha);
          if (r.status === 400 && r.data.fields) {
            var checks = [];
            Object.keys(r.data.fields).forEach(function (key) {
              var control = FIELDS[key] ? doc.getElementById(FIELDS[key]) : null;
              if (control) checks.push({ control: control, message: r.data.fields[key] });
            });
            if (checks.length && validate(checks) === false) {
              // Without the shared highlighter, say the first one plainly.
              if (!win.NBCCFormValidation) showError(checks[0].message);
              return;
            }
          }
          showError(r.data.error || MSG.failed);
        })
        .catch(function () {
          setBusy(false);
          showError(MSG.failed);
        });
    });

    return { form: form };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { initPledgeForm: initPledgeForm };
  } else if (typeof document !== "undefined") {
    initPledgeForm(document, window);
  }
})();
