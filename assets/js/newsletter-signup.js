// Joining the mailing list: the form on /newsletter (newsletter.html).
//
// Checks the two boxes and says what is missing beside each one (never an alert box), sends the
// request as JSON to POST /api/newsletter/signup, and shows "Check your email" in place of the form.
// That message is the same whoever the address belongs to, and never repeats the address back.
// Nobody is on the list yet: that happens when they press the button behind the link in the email.
//
// The spam check is the contact form's (Cloudflare Turnstile): GET /api/newsletter/captcha says
// whether it is on, and only then, and only once the visitor starts on the form, is Cloudflare's
// script loaded. Someone who only reads the page never contacts Cloudflare.
//
// Its own file, not part of main.js, because main.js counts towards donate.html's page weight
// budget. A classic <script defer>, exported under a CommonJS guard so it is unit tested in jsdom.
(function () {
  "use strict";

  var SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=nbccNewsletterTurnstileReady";
  var MSG = {
    firstName: "Please enter your first name.",
    email: "Please enter a valid email address.",
    sending: "Sending…",
    failed: "Something went wrong and we could not take your details. Please try again in a few minutes.",
    captcha: "The check that you're not a robot did not go through. Please try it again, then press Join our mailing list.",
    waiting: "One moment, we're still checking you're not a robot. Please press Join our mailing list again in a few seconds.",
  };
  // The same loose shape the browser's own email check uses: something@something.something.
  var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  var FIELDS = { firstName: "nlFirstName", email: "nlEmail" };

  function initNewsletterSignup(doc, win) {
    var form = doc.getElementById("nlForm");
    var done = doc.getElementById("nlDone");
    if (!form || !done || typeof win.fetch !== "function") return null;
    var status = doc.getElementById("nlStatus");
    var button = doc.getElementById("nlSubmit");
    var tokenField = doc.getElementById("nlCaptchaToken");
    var captchaBox = doc.getElementById("nlCaptcha");
    var busy = false;

    function val(id) {
      var el = doc.getElementById(id);
      return el ? String(el.value || "").trim() : "";
    }

    function say(text, kind) {
      if (!status) return;
      status.textContent = text;
      status.className = "form-status" + (kind ? " is-" + kind : "");
    }

    // One box's message, beside the box. Shown and hidden with the same classes the contact form uses.
    function mark(id, message) {
      var input = doc.getElementById(id);
      var err = doc.getElementById(id + "-error");
      if (!input) return;
      var field = input.closest ? input.closest(".field") : null;
      if (message) {
        input.setAttribute("aria-invalid", "true");
        if (field) field.classList.add("invalid");
        if (err) {
          err.textContent = message;
          err.hidden = false;
        }
      } else {
        input.removeAttribute("aria-invalid");
        if (field) field.classList.remove("invalid");
        if (err) err.hidden = true;
      }
    }

    function problems() {
      var out = {};
      if (!val("nlFirstName")) out.firstName = MSG.firstName;
      if (!EMAIL.test(val("nlEmail"))) out.email = MSG.email;
      return out;
    }

    // Marks every box that needs another look and puts the cursor in the first. True when all is well.
    function show(found) {
      var first = null;
      Object.keys(FIELDS).forEach(function (key) {
        mark(FIELDS[key], found[key] || "");
        if (found[key] && !first) first = doc.getElementById(FIELDS[key]);
      });
      if (first) {
        try {
          first.focus();
        } catch (e) {
          /* focus unavailable */
        }
      }
      return !first;
    }

    // An error goes as soon as its box is put right.
    Object.keys(FIELDS).forEach(function (key) {
      var input = doc.getElementById(FIELDS[key]);
      if (!input) return;
      input.addEventListener("input", function () {
        if (input.getAttribute("aria-invalid") === "true" && !problems()[key]) mark(FIELDS[key], "");
      });
    });

    // --- the spam check, loaded only when it is on and the visitor starts on the form --------------
    var captcha = { on: false, siteKey: null, loading: false, widgetId: null };
    function renderCaptcha() {
      if (captcha.widgetId !== null || !win.turnstile || !captchaBox) return;
      captchaBox.hidden = false;
      captcha.widgetId = win.turnstile.render(captchaBox, {
        sitekey: captcha.siteKey,
        // Flexible needs 300px of room. A narrower form gets Compact, so nothing scrolls sideways.
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
      win.nbccNewsletterTurnstileReady = renderCaptcha;
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
    win
      .fetch("/api/newsletter/captcha")
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

    function setBusy(on) {
      busy = on;
      if (button) button.disabled = on;
      say(on ? MSG.sending : "", on ? "pending" : "");
    }

    function thank() {
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
      say("", "");
      if (!show(problems())) return;
      // The check is on but has not passed yet: hold the form, and fetch the check if need be.
      if (captcha.on && tokenField && !tokenField.value) {
        loadCaptcha();
        say(MSG.waiting, "pending");
        return;
      }
      setBusy(true);
      win
        .fetch("/api/newsletter/signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            firstName: val("nlFirstName"),
            email: val("nlEmail"),
            company: val("nlCompany"),
            captchaToken: tokenField ? tokenField.value : "",
          }),
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
          if (r.status === 200) return thank();
          // A pass works once, so the box is made ready for the next try.
          resetCaptcha();
          if (r.status === 400 && r.data.error === "captcha") return say(MSG.captcha, "error");
          if (r.status === 400 && r.data.fields) {
            show(r.data.fields);
            return;
          }
          say(typeof r.data.error === "string" && r.data.error ? r.data.error : MSG.failed, "error");
        })
        .catch(function () {
          setBusy(false);
          resetCaptcha();
          say(MSG.failed, "error");
        });
    });

    return captcha;
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { initNewsletterSignup: initNewsletterSignup };
  } else {
    initNewsletterSignup(document, window);
  }
})();
