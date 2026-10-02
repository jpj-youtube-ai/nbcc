// The fundraising sign up form at /fundraise (TASK-494).
//
// Two paths: raising money (asks for a target) or holding an event (needs a date). The address boxes
// appear only when posters, leaflets, buckets or tins are to be posted. Holding an event also asks
// the event questions (TASK-499), worded like the admin's events editor, whose answers make the
// event's card on Get involved; the ticket link is asked only when tickets are sold elsewhere. Sending goes to POST /api/fundraise as
// JSON; a 400 puts each of the server's plain English messages next to its own field, a 404 means
// fundraising has been switched off meanwhile (the gentle "not open yet" panel shows), and success
// swaps the form for a thank you that says what happens next.
//
// The spam check is the contact form's (TASK-490): GET /api/fundraise/captcha, and only when that
// gives a site key AND someone starts on the form is Cloudflare's script loaded. Without a pass, a
// send is held with a message. The server is the real check.
//
// Its own file, never main.js: main.js counts towards donate.html's page weight budget. It uses
// main.js's shared field highlighting (window.NBCCFormValidation) when it is there. A classic
// <script defer>, exported under a CommonJS guard so it can be unit tested in jsdom.
(function () {
  "use strict";

  var SCRIPT_URL =
    "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=nbccFundraiseTurnstileReady";
  var MSG = {
    sending: "Sending your sign up…",
    waiting: "One moment, we're still checking you're not a robot. Please press Send again in a second.",
    tick: "Please tick the box above Send my sign up to show you're not a robot.",
    captcha: "The check that you're not a robot did not go through. Please try it again, then press Send.",
    broken: "The spam check could not load. Please try again in a moment, or email events@nbcc.scot.",
    busy: "Too many sign ups from here just now. Please try again in a few minutes.",
    failed: "We could not send your sign up just now. Please try again in a moment, or email events@nbcc.scot.",
    check: "Please check the highlighted answers below and try again.",
  };

  // The API's field names, and the control each one's message belongs beside.
  var FIELD_CONTROL = {
    path: "pathRaising",
    kind: "kind-run_walk",
    title: "title",
    description: "description",
    eventDate: "eventDate",
    startTime: "startTime",
    venue: "venue",
    town: "town",
    targetPence: "target",
    public: "publicYes",
    name: "name",
    email: "email",
    phone: "phone",
    socialLink: "socialLink",
    socialOk: "socialOk",
    "wants.posterCount": "posters",
    "wants.leafletCount": "leaflets",
    "wants.bucketCount": "buckets",
    "wants.tinCount": "tins",
    // The combined numbers of a sign up from before the split, if the server ever names them.
    "wants.leaflets": "leaflets",
    "wants.buckets": "buckets",
    wants: "posters",
    postLine1: "postLine1",
    postLine2: "postLine2",
    postTown: "postTown",
    postPostcode: "postPostcode",
    newsletterOk: "newsletterOk",
    cardLine: "cardLine",
    endTime: "endTime",
    timeTbc: "timeTbc",
    venueAddress: "venueAddress",
    venuePostcode: "venuePostcode",
    access: "access-0",
    price: "price",
    booking: "booking-away",
    ticketUrl: "ticketUrl",
    ageLimit: "ageLimit",
    dressCode: "dressCode",
    included: "included",
    creditName: "creditName",
  };
  // The answers only an event is asked: what is sent for one, and blanks for raising money.
  var EVENT_TEXT = ["cardLine", "endTime", "venueAddress", "venuePostcode", "price", "ageLimit", "dressCode", "included", "creditName"];

  // The server names a field inside a list or an object with dots ("access.0", "wants.tinCount"):
  // the control it belongs beside, or the nearest one that stands for the whole.
  function controlFor(key) {
    if (FIELD_CONTROL[key]) return FIELD_CONTROL[key];
    var top = String(key).split(".")[0];
    return FIELD_CONTROL[top] || key;
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

  function initFundraiseForm(doc, win) {
    var form = doc.getElementById("fundraiseForm");
    var openPanel = doc.querySelector("[data-fundraise-open]");
    if (!form || !openPanel || openPanel.hidden) return null;
    showForms(doc, openPanel);

    var closedPanel = doc.querySelector("[data-fundraise-closed]");
    var thanks = doc.querySelector("[data-fundraise-thanks]");
    var status = doc.getElementById("formStatus");
    var summary = form.querySelector("[data-form-error]");
    var submitBtn = form.querySelector("[data-submit]");
    var tokenField = doc.getElementById("captchaToken");
    var captchaBox = doc.getElementById("fundraiseCaptcha");
    var sending = false;

    function el(id) {
      return doc.getElementById(id);
    }
    function val(id) {
      var e = el(id);
      return e ? String(e.value || "").trim() : "";
    }
    function checked(id) {
      var e = el(id);
      return !!(e && e.checked);
    }
    function whole(id) {
      var n = parseInt(val(id), 10);
      return isFinite(n) && n > 0 ? n : 0;
    }
    function radio(name) {
      var r = form.querySelector('input[name="' + name + '"]:checked');
      return r ? r.value : "";
    }
    function say(text, kind) {
      if (!status) return;
      status.textContent = text;
      status.className = "form-status" + (kind ? " is-" + kind : "");
    }

    // --- the two paths --------------------------------------------------------------------------
    var targetQ = form.querySelector("[data-target-question]");
    var date = el("eventDate");
    var dateRequired = form.querySelector("[data-date-required]");
    var dateOptional = form.querySelector("[data-date-optional]");
    var venue = el("venue");
    var venueRequired = form.querySelector("[data-venue-required]");
    var venueOptional = form.querySelector("[data-venue-optional]");
    var eventQuestions = form.querySelector("[data-event-questions]");
    var eventTimes = form.querySelector("[data-event-times]");
    function need(control, required) {
      if (!control) return;
      control.required = required;
      if (required) control.setAttribute("aria-required", "true");
      else control.removeAttribute("aria-required");
    }
    function applyPath() {
      var path = radio("path");
      var event = path === "event";
      if (targetQ) targetQ.hidden = event;
      need(date, event);
      if (dateRequired) dateRequired.hidden = !event;
      if (dateOptional) dateOptional.hidden = event;
      // An event's card needs somewhere to say it is.
      need(venue, event);
      if (venueRequired) venueRequired.hidden = !event;
      if (venueOptional) venueOptional.hidden = event;
      if (eventQuestions) eventQuestions.hidden = !event;
      if (eventTimes) eventTimes.hidden = !event;
    }

    // --- the ticket link, only for tickets sold on another website ------------------------------
    var ticketField = form.querySelector("[data-ticket-field]");
    function applyBooking() {
      if (ticketField) ticketField.hidden = radio("booking") !== "away";
    }

    // --- the address, only for something posted ------------------------------------------------
    var addressField = form.querySelector("[data-address-field]");
    function applyAddress() {
      if (addressField) addressField.hidden = !(whole("posters") + whole("leaflets") + whole("buckets") + whole("tins") > 0);
    }

    // --- characters left -----------------------------------------------------------------------
    var counters = Array.prototype.slice.call(form.querySelectorAll("[data-count-for]"));
    function applyCounts() {
      counters.forEach(function (c) {
        var box = el(c.getAttribute("data-count-for"));
        var max = parseInt(c.getAttribute("data-count-max"), 10) || (box && box.maxLength) || 0;
        if (!box || !max || !box.value) return;
        var left = Math.max(0, max - box.value.length);
        c.textContent = left === 1 ? "1 character left." : left + " characters left.";
      });
    }

    form.addEventListener("change", function () {
      applyPath();
      applyBooking();
      applyAddress();
    });
    form.addEventListener("input", function () {
      applyAddress();
      applyCounts();
    });
    applyPath();
    applyBooking();
    applyAddress();

    // --- the spam check, loaded only when needed ------------------------------------------------
    var captcha = { on: false, siteKey: null, loading: false, widgetId: null, broken: false, interactive: false };

    function renderCaptcha() {
      if (captcha.widgetId !== null || !win.turnstile || !captchaBox) return;
      captchaBox.hidden = false;
      var room = form.clientWidth || 400;
      captcha.widgetId = win.turnstile.render(captchaBox, {
        sitekey: captcha.siteKey,
        size: room >= 340 ? "flexible" : "compact",
        callback: function (token) {
          tokenField.value = token;
          captcha.broken = false;
          captcha.interactive = false;
        },
        "expired-callback": function () {
          tokenField.value = "";
        },
        "timeout-callback": function () {
          tokenField.value = "";
        },
        "error-callback": function () {
          tokenField.value = "";
          captcha.broken = true;
        },
        "before-interactive-callback": function () {
          captcha.interactive = true;
        },
      });
    }

    function loadCaptcha() {
      if (!captcha.on || captcha.loading) return;
      captcha.loading = true;
      win.nbccFundraiseTurnstileReady = renderCaptcha;
      var s = doc.createElement("script");
      s.src = SCRIPT_URL;
      s.async = true;
      s.defer = true;
      s.onerror = function () {
        captcha.broken = true;
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
    form.addEventListener("input", loadCaptcha);

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

    // --- checking and sending -------------------------------------------------------------------
    // The rule the browser cannot check on its own: an event's finish is after its start.
    function finishBeforeStart() {
      if (radio("path") !== "event") return null;
      var start = val("startTime");
      var end = val("endTime");
      return start && end && end <= start ? el("endTime") : null;
    }

    function validate(serverFields) {
      var shared = win.NBCCFormValidation;
      var extra = function () {
        var out = [];
        var end = finishBeforeStart();
        if (end) out.push({ control: end, message: "The finish time is before the start." });
        if (serverFields) {
          Object.keys(serverFields).forEach(function (key) {
            var control = el(controlFor(key));
            if (control) out.push({ control: control, message: serverFields[key] });
          });
        }
        return out;
      };
      if (shared && typeof shared.validateForm === "function") {
        if (summary) summary.textContent = MSG.check;
        return shared.validateForm(form, { summary: summary, extraChecks: extra }).valid;
      }
      // Without main.js: the browser's own check, and the server's messages in the status line.
      if (!serverFields && finishBeforeStart()) {
        say("The finish time is before the start.", "error");
        return false;
      }
      if (serverFields) {
        say(Object.keys(serverFields).map(function (k) { return serverFields[k]; }).join(" "), "error");
        return false;
      }
      return typeof form.checkValidity !== "function" || form.checkValidity();
    }

    function payload() {
      var path = radio("path");
      var event = path === "event";
      var pounds = parseFloat(val("target"));
      var posted = addressField && !addressField.hidden;
      var booking = event ? radio("booking") : "";
      var access = event
        ? Array.prototype.filter
            .call(form.querySelectorAll('input[name="access"]'), function (b) {
              return b.checked;
            })
            .map(function (b) {
              return b.value;
            })
        : [];
      var body = {
        path: path,
        kind: radio("kind"),
        title: val("title"),
        description: val("description"),
        eventDate: val("eventDate"),
        startTime: val("startTime"),
        venue: val("venue"),
        town: val("town"),
        targetPence: path === "raising" && isFinite(pounds) && pounds > 0 ? Math.round(pounds * 100) : null,
        public: radio("public") === "yes",
        name: val("name"),
        email: val("email"),
        phone: val("phone"),
        socialLink: val("socialLink"),
        socialOk: checked("socialOk"),
        wants: {
          posterCount: whole("posters"),
          leafletCount: whole("leaflets"),
          bucketCount: whole("buckets"),
          tinCount: whole("tins"),
          shoutOut: checked("shoutOut"),
          attend: checked("attend"),
        },
        postLine1: posted ? val("postLine1") : "",
        postLine2: posted ? val("postLine2") : "",
        postTown: posted ? val("postTown") : "",
        postPostcode: posted ? val("postPostcode") : "",
        newsletterOk: checked("newsletterOk"),
      };
      EVENT_TEXT.forEach(function (k) {
        body[k] = event ? val(k) : "";
      });
      body.timeTbc = event && checked("timeTbc");
      body.access = access;
      body.booking = booking;
      body.ticketUrl = booking === "away" ? val("ticketUrl") : "";
      body.company = val("company");
      body.captchaToken = tokenField ? tokenField.value : "";
      return body;
    }

    function done(body) {
      var first = body.name.split(/\s+/)[0] || "";
      var nameSlot = doc.querySelector("[data-thanks-name]");
      if (nameSlot) nameSlot.textContent = first ? ", " + first : "";
      var raising = doc.querySelector("[data-thanks-raising]");
      var event = doc.querySelector("[data-thanks-event]");
      if (raising) raising.hidden = body.path !== "raising";
      if (event) event.hidden = body.path === "raising";
      openPanel.hidden = true;
      if (thanks) {
        thanks.hidden = false;
        try {
          thanks.focus();
          if (thanks.scrollIntoView) thanks.scrollIntoView({ block: "start" });
        } catch (e) {
          /* focus unavailable */
        }
      }
    }

    function closed() {
      openPanel.hidden = true;
      if (closedPanel) {
        closedPanel.hidden = false;
        closedPanel.setAttribute("tabindex", "-1");
        try {
          closedPanel.focus();
        } catch (e) {
          /* focus unavailable */
        }
      }
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (sending) return;
      say("", null);
      if (!validate(null)) return;
      if (captcha.on && !tokenField.value) {
        loadCaptcha();
        say(captcha.broken ? MSG.broken : captcha.interactive ? MSG.tick : MSG.waiting, captcha.broken ? "error" : "pending");
        return;
      }
      if (typeof win.fetch !== "function") {
        say(MSG.failed, "error");
        return;
      }
      var body = payload();
      sending = true;
      if (submitBtn) submitBtn.disabled = true;
      say(MSG.sending, "pending");
      win
        .fetch("/api/fundraise", {
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
          sending = false;
          if (submitBtn) submitBtn.disabled = false;
          if (r.status === 200) {
            say("", null);
            done(body);
            return;
          }
          if (r.status === 404) {
            say("", null);
            closed();
            return;
          }
          resetCaptcha();
          if (r.status === 400 && r.data.error === "captcha") return say(MSG.captcha, "error");
          if (r.status === 400 && r.data.fields) {
            say("", null);
            validate(r.data.fields);
            return;
          }
          say(r.status === 429 ? MSG.busy : MSG.failed, "error");
        })
        .catch(function () {
          sending = false;
          if (submitBtn) submitBtn.disabled = false;
          say(MSG.failed, "error");
        });
    });

    growTextareas(form);
    return { payload: payload };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { initFundraiseForm: initFundraiseForm };
  } else {
    initFundraiseForm(document, window);
  }
})();
