// Contact form spam check (TASK-490): Cloudflare Turnstile, on the contact page only.
//
// Asks the server whether the check is on (GET /api/contact/captcha). Only when it gets a site key,
// and only once the visitor starts on the form (or presses Send), does it load Cloudflare's script
// and draw the box: someone who only reads the contact page never contacts Cloudflare, and no other
// page, and no page in development or CI, loads anything from it. It is its own file, not part of
// main.js, because main.js counts towards donate.html's page-weight budget, which has almost no room
// left.
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
  var STILL_WAITING = "Still checking you're not a robot. If this keeps happening, please email info@nbcc.scot.";
  var TICK = "Please tick the box above Send to show you're not a robot.";
  var BROKEN = "The spam check could not load. Please try again in a moment, or email info@nbcc.scot.";
  var READY = "Thank you for waiting. Please press Send again to send your message.";
  // Flexible and Normal need 300px. A narrower form gets Compact, so nothing scrolls sideways.
  var FLEXIBLE_MIN = 300;

  function initContactCaptcha(doc, win) {
    var form = doc.getElementById("contactForm");
    var box = doc.getElementById("contactCaptcha");
    var field = doc.getElementById("captchaToken");
    if (!form || !box || !field || typeof win.fetch !== "function") return null;
    var status = doc.getElementById("formStatus");
    var state = { on: false, loading: false, scriptFailed: false, broken: false, interactive: false, widgetId: null, size: null, held: 0 };
    var siteKey = null;
    var said = null;

    // Only a failure is styled as an error; waiting and the prompts are plain, like main.js's "Sending…".
    function say(text, isError) {
      if (!status) return;
      status.textContent = text;
      status.className = isError ? "form-status is-error" : "form-status";
      said = text;
    }

    // Whether the status still shows this script's message (main.js may have written over it).
    function showing(text) {
      return Boolean(status) && said !== null && status.textContent === said && (text === undefined || said === text);
    }

    // Takes back only its own message, never main.js's "Sending…" or "Thank you".
    function unsay() {
      if (showing()) {
        status.textContent = "";
        status.className = "form-status";
      }
      said = null;
    }

    // A pass that has gone (expired, timed out, failed or redrawn): clear it, and take back any
    // "press Send again" that relied on it.
    function passLost() {
      field.value = "";
      if (showing(READY)) unsay();
    }

    // The same check main.js makes before it sends (it puts it on window), so the two never disagree
    // about whether this send will happen. The browser's own check stands in without main.js.
    function formIsValid() {
      var shared = win.NBCCFormValidation;
      if (shared && typeof shared.validateForm === "function") return shared.validateForm(form).valid;
      return typeof form.checkValidity !== "function" || form.checkValidity();
    }

    // Fetches Cloudflare's script, once. Only Send tries again after a failed fetch, so typing
    // never fires a request per key.
    function load(retry) {
      if (!state.on) return;
      if (state.loading && !(retry && state.scriptFailed)) return;
      state.loading = true;
      state.scriptFailed = false;
      win.nbccTurnstileReady = render;
      var script = doc.createElement("script");
      script.src = SCRIPT_URL;
      script.async = true;
      script.defer = true;
      script.onerror = function () {
        state.broken = true;
        state.scriptFailed = true;
        if (script.parentNode) script.parentNode.removeChild(script);
      };
      doc.head.appendChild(script);
    }

    // On the document in the capture phase, so it always runs before main.js's own submit handler
    // on the form, whatever order the two were set up in. Only a form that is otherwise valid is
    // held: an invalid one is left to main.js, which flags its fields.
    doc.addEventListener(
      "submit",
      function (e) {
        if (e.target !== form || !state.on) return;
        if (!formIsValid()) return;
        if (!field.value) {
          e.preventDefault();
          e.stopImmediatePropagation();
          load(true);
          state.held += 1;
          say(state.broken ? BROKEN : state.interactive ? TICK : state.held > 1 ? STILL_WAITING : WAITING, state.broken);
          return;
        }
        state.held = 0;
        // main.js reads the pass during this same submit, so reset straight after, ready for the next.
        win.setTimeout(function () {
          field.value = "";
          if (win.turnstile && state.widgetId !== null) win.turnstile.reset(state.widgetId);
        }, 0);
      },
      true,
    );

    // The room the box has, measured with the box out of the layout: a Flexible box is never
    // narrower than 300px, so while it is drawn it can widen the form it sits in.
    function room() {
      var shown = box.style.display;
      box.style.display = "none";
      var style = win.getComputedStyle(form);
      var width = form.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);
      box.style.display = shown;
      return width;
    }

    function sizeThatFits() {
      return room() >= FLEXIBLE_MIN ? "flexible" : "compact";
    }

    function render() {
      if (state.widgetId !== null || !win.turnstile) return;
      box.hidden = false;
      state.size = sizeThatFits();
      state.widgetId = win.turnstile.render(box, {
        sitekey: siteKey,
        size: state.size,
        callback: function (token) {
          field.value = token;
          state.broken = false;
          state.interactive = false;
          state.held = 0;
          // A Send held while there was no pass sent nothing, so never leave a blank that reads as
          // sent: ask for the press again.
          if (showing()) say(READY, false);
        },
        "expired-callback": passLost,
        "timeout-callback": passLost,
        "error-callback": function () {
          passLost();
          state.broken = true;
        },
        "before-interactive-callback": function () {
          state.interactive = true;
        },
        "after-interactive-callback": function () {
          state.interactive = false;
        },
      });
    }

    // A phone turned upright, or a window made narrower, can leave the box too little room for the
    // size it was drawn at, so it is drawn again at the size that fits. Only a change of width
    // counts: a phone's address bar showing or hiding changes just the height.
    var width = doc.documentElement.clientWidth;
    win.addEventListener("resize", function () {
      if (doc.documentElement.clientWidth === width) return;
      width = doc.documentElement.clientWidth;
      if (state.widgetId === null || !win.turnstile || sizeThatFits() === state.size) return;
      win.turnstile.remove(state.widgetId);
      state.widgetId = null;
      state.interactive = false;
      state.broken = false;
      passLost();
      render();
    });

    // Starting on the form (a tap or a key in any field) is what fetches Cloudflare's script.
    form.addEventListener("focusin", function () {
      load(false);
    });
    form.addEventListener("input", function () {
      load(false);
    });

    win
      .fetch("/api/contact/captcha")
      .then(function (res) {
        return res && res.ok ? res.json() : null;
      })
      .then(function (data) {
        if (!data || !data.siteKey) return;
        siteKey = data.siteKey;
        state.on = true;
        // Already in the form before the answer came: start now.
        if (form.contains(doc.activeElement)) load(false);
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
