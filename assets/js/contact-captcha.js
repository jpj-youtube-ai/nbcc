// Contact form spam check (TASK-NNN): Cloudflare Turnstile, on the contact page only.
//
// Asks the server whether the check is on (GET /api/contact/captcha). Only when it gets a site key
// does it load Cloudflare's script and draw the box, so no other page, and no page in development
// or CI, loads anything from Cloudflare. It is its own file, not part of main.js, because main.js
// counts towards donate.html's page-weight budget, which has almost no room left.
//
// The pass goes into the form's hidden captchaToken field, which main.js's initContactForm sends
// with the message. Send is held, with a message, while there is no pass yet; after each send the
// box is reset, because a pass works once. A classic <script defer>, exported under a CommonJS
// guard so it can be unit-tested in jsdom, like main.js.
(function () {
  "use strict";

  var SCRIPT_URL =
    "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=nbccTurnstileReady";
  var WAITING = "One moment, we're still checking you're not a robot.";
  var BROKEN = "The spam check could not load. Please try again in a moment, or email info@nbcc.scot.";

  function initContactCaptcha(doc, win) {
    var form = doc.getElementById("contactForm");
    var box = doc.getElementById("contactCaptcha");
    var field = doc.getElementById("captchaToken");
    if (!form || !box || !field || typeof win.fetch !== "function") return null;
    var status = doc.getElementById("formStatus");
    var state = { on: false, broken: false, widgetId: null };

    function say(text) {
      if (!status) return;
      status.textContent = text;
      status.className = "form-status is-error";
    }

    // On the document in the capture phase, so it always runs before main.js's own submit handler
    // on the form, whatever order the two were set up in. Only a form that is otherwise valid is
    // held: an invalid one is left to main.js, which flags its fields.
    doc.addEventListener(
      "submit",
      function (e) {
        if (e.target !== form || !state.on) return;
        if (typeof form.checkValidity === "function" && !form.checkValidity()) return;
        if (!field.value) {
          e.preventDefault();
          e.stopImmediatePropagation();
          say(state.broken ? BROKEN : WAITING);
          return;
        }
        // main.js reads the pass during this same submit, so reset straight after, ready for the next.
        win.setTimeout(function () {
          field.value = "";
          if (win.turnstile && state.widgetId !== null) win.turnstile.reset(state.widgetId);
        }, 0);
      },
      true,
    );

    function render(siteKey) {
      box.hidden = false;
      // Flexible and Normal need 300px. A narrower form gets Compact, so nothing scrolls sideways.
      var wide = box.getBoundingClientRect().width >= 300;
      state.widgetId = win.turnstile.render(box, {
        sitekey: siteKey,
        size: wide ? "flexible" : "compact",
        callback: function (token) {
          field.value = token;
          state.broken = false;
        },
        "expired-callback": function () {
          field.value = "";
        },
        "timeout-callback": function () {
          field.value = "";
        },
        "error-callback": function () {
          field.value = "";
          state.broken = true;
        },
      });
    }

    win
      .fetch("/api/contact/captcha")
      .then(function (res) {
        return res && res.ok ? res.json() : null;
      })
      .then(function (data) {
        if (!data || !data.siteKey) return;
        state.on = true;
        win.nbccTurnstileReady = function () {
          render(data.siteKey);
        };
        var script = doc.createElement("script");
        script.src = SCRIPT_URL;
        script.async = true;
        script.defer = true;
        script.onerror = function () {
          state.broken = true;
        };
        doc.head.appendChild(script);
      })
      .catch(function () {
        // Could not ask: the form stays as it was. The server still checks if the check is on.
      });

    return state;
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { initContactCaptcha: initContactCaptcha };
  } else {
    initContactCaptcha(document, window);
  }
})();
