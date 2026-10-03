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
// TASK-511, round two: the questions come one after another, each once the one before is answered
// (a step with nothing it needs comes along with the one before), and a step once shown is never
// taken away. Each new question is said in a polite live region for screen readers, focus stays
// where they are, and "Show all the questions at once" (or pressing Send) shows every one. The words
// of each question follow the answer to the first (data-say-raising, data-say-event). Without this
// script every question is in the page as it is. The name is in two boxes, Other says what,
// social media is a step of its own, every yes or no is a pair of choices with nothing chosen, and
// someone raising money can ask for printed QR codes.
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
    // kind: the first category on the form, whichever it is (controlEl, below).
    title: "title",
    description: "description",
    eventDate: "eventDate",
    startTime: "startTime",
    venue: "venue",
    town: "town",
    targetPence: "target",
    public: "publicYes",
    // TASK-511
    kindOther: "kindOther",
    firstName: "firstName",
    lastName: "lastName",
    name: "firstName",
    email: "email",
    phone: "phone",
    instagram: "instagram",
    facebook: "facebook",
    socialLink: "facebook",
    socialOk: "socialOkYes",
    "wants.shoutOut": "shoutOutYes",
    "wants.attend": "attendYes",
    "wants.qrCount": "qrCodes",
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
    // The control a server message belongs beside. The categories come from the database, so the
    // category message goes by the first one on the form, whichever it is.
    function controlEl(key) {
      if (key === "kind") return form.querySelector('input[name="kind"]');
      return el(controlFor(key));
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
    // TASK-511: the words of each question follow the first answer. Before it is given, the words
    // in the page stand.
    var sayings = Array.prototype.slice.call(form.querySelectorAll("[data-say-raising]"));
    var raisingOnly = Array.prototype.slice.call(form.querySelectorAll("[data-raising-only]"));
    function applyWords(path) {
      if (path !== "raising" && path !== "event") return;
      sayings.forEach(function (n) {
        var words = n.getAttribute("data-say-" + path);
        if (words && n.textContent !== words) n.textContent = words;
      });
      Array.prototype.forEach.call(form.querySelectorAll("[data-invalid-" + path + "]"), function (n) {
        n.setAttribute("data-invalid-message", n.getAttribute("data-invalid-" + path));
      });
    }
    function applyPath() {
      var path = radio("path");
      var event = path === "event";
      applyWords(path);
      // Printed QR codes carry a page's QR code, and an event has no page.
      raisingOnly.forEach(function (n) {
        n.hidden = event;
      });
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

    // --- TASK-511: what Other is, only when it is chosen -------------------------------
    var kindOtherField = form.querySelector("[data-kind-other]");
    function applyKind() {
      var other = radio("kind") === "other";
      if (kindOtherField) kindOtherField.hidden = !other;
      need(el("kindOther"), other);
    }

    // --- TASK-511: a shout out needs their OK to post ------------------------------------------
    var shoutNote = form.querySelector("[data-shout-note]");
    var SHOUT_NEEDS_OK = "We can only give you a shout out if we can post about it. If that\u2019s OK, choose Yes above.";
    function applyShoutOut() {
      if (!shoutNote) return;
      var words = radio("shoutOut") === "yes" && radio("socialOk") === "no" ? SHOUT_NEEDS_OK : "";
      if (shoutNote.textContent !== words) shoutNote.textContent = words;
    }

    // --- the ticket link, only for tickets sold on another website ------------------------------
    var ticketField = form.querySelector("[data-ticket-field]");
    function applyBooking() {
      if (ticketField) ticketField.hidden = radio("booking") !== "away";
    }

    // --- the address, only for something posted ------------------------------------------------
    var addressField = form.querySelector("[data-address-field]");
    function applyAddress() {
      var qr = radio("path") === "event" ? 0 : whole("qrCodes");
      if (addressField) addressField.hidden = !(whole("posters") + whole("leaflets") + whole("buckets") + whole("tins") + qr > 0);
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

    // --- TASK-511: one question after another --------------------------------------------------
    // Every step starts waiting but the first. A step is answered when every question in it that
    // needs an answer, and is in play for their path, has a good one (read from validity, so no
    // field is flagged while they are still on their way). Steps are revealed in order up to and
    // including the first one not yet answered; one with nothing it needs comes along with the one
    // before. Once shown, a step stays shown.
    var steps = Array.prototype.slice.call(form.querySelectorAll("[data-step]"));
    var news = form.querySelector("[data-step-news]");
    var showAllRow = form.querySelector("[data-show-all-row]");
    var stepped = steps.length > 1;
    function inPlay(c) {
      if (c.disabled || c.type === "hidden" || c.type === "submit" || c.type === "button") return false;
      for (var n = c; n && n !== form; n = n.parentElement) if (n.hidden) return false;
      return true;
    }
    function answered(step) {
      var controls = step.querySelectorAll("input, select, textarea");
      for (var i = 0; i < controls.length; i++) {
        var c = controls[i];
        if (!inPlay(c) || !c.willValidate) continue;
        if (c.validity && !c.validity.valid) return false;
      }
      return true;
    }
    function titleOf(step) {
      if (step.getAttribute("data-step-title")) return step.getAttribute("data-step-title");
      var t = step.querySelector("legend, label");
      return t ? String(t.textContent || "").replace(/\s+/g, " ").replace(/\*/g, "").trim() : "";
    }
    function show(step) {
      step.classList.remove("is-waiting");
      step.classList.add("is-arriving");
    }
    // Stepping ends once every question for their path is showing. Any still waiting belong to the
    // other path (hidden): they are let go too, so a change of path shows them straight away.
    function finishStepping() {
      stepped = false;
      steps.forEach(function (step) {
        if (step.classList.contains("is-waiting")) show(step);
      });
      if (showAllRow) showAllRow.hidden = true;
    }
    function reveal() {
      if (!stepped) return;
      var open = true;
      var first = null;
      steps.forEach(function (step) {
        if (step.hidden || !open) return;
        if (step.classList.contains("is-waiting")) {
          show(step);
          if (!first) first = step;
        }
        if (!answered(step)) open = false;
      });
      if (first && news) news.textContent = "Next question: " + titleOf(first);
      var left = steps.some(function (step) {
        return !step.hidden && step.classList.contains("is-waiting");
      });
      if (!left) finishStepping();
    }
    // Every question at once: from the button, or when they press Send.
    function revealAll() {
      var first = null;
      steps.forEach(function (step) {
        if (step.classList.contains("is-waiting")) {
          show(step);
          if (!first && !step.hidden) first = step;
        }
      });
      finishStepping();
      return first;
    }
    if (stepped) {
      form.classList.add("fr-stepped");
      steps.forEach(function (step, i) {
        if (i > 0) step.classList.add("is-waiting");
      });
      if (showAllRow) showAllRow.hidden = false;
      var showAll = form.querySelector("[data-show-all]");
      if (showAll) {
        showAll.addEventListener("click", function () {
          revealAll();
          if (news) news.textContent = "Every question is showing.";
          // On to the first question still to answer, as the button they pressed has gone.
          var next = steps.filter(function (s) {
            return !s.hidden && !answered(s);
          })[0];
          var to = next && Array.prototype.filter.call(next.querySelectorAll("input, select, textarea"), function (c) {
            return inPlay(c) && c.willValidate && c.validity && !c.validity.valid;
          })[0];
          if (to && to.focus) {
            try {
              to.focus();
            } catch (e) {
              /* focus unavailable */
            }
          }
        });
      }
    }

    // --- Review fix: Instagram and Facebook, checked as they leave the box -------------------------
    // The same rules as the server (assets/js/social-handles.js): the help line under the box says
    // what is wrong, and Send is held with the box flagged. The server still checks.
    var SOCIAL = { instagram: "instagramLink", facebook: "facebookLink" };
    var socialHelp = {};
    function socialProblem(id) {
      var rules = win.NBCCSocialHandles;
      var box = el(id);
      if (!rules || !box || !SOCIAL[id]) return null;
      var r = rules[SOCIAL[id]](box.value);
      return r && r.ok === false ? r.message : null;
    }
    function checkSocial(target) {
      var id = target && target.id;
      if (!SOCIAL[id]) return;
      var help = el(id + "Help");
      if (help && socialHelp[id] === undefined) socialHelp[id] = help.textContent;
      var problem = socialProblem(id);
      if (help) help.textContent = problem || socialHelp[id];
      if (problem) target.setAttribute("aria-invalid", "true");
      else target.removeAttribute("aria-invalid");
    }

    function applyAll() {
      applyPath();
      applyKind();
      applyBooking();
      applyAddress();
      applyShoutOut();
    }
    // Review fix: whatever goes wrong in tidying the form, the next question still comes.
    function safely(work) {
      try {
        work();
      } catch (err) {
        if (win.console && win.console.error) win.console.error("fundraise form:", err);
      }
    }
    // Review fix: while they type, the next question waits until they leave the box (change) or
    // pause, rather than arriving on the first key.
    var PAUSE_MS = 600;
    var pause = null;
    function revealSoon() {
      if (pause) win.clearTimeout(pause);
      pause = win.setTimeout(function () {
        pause = null;
        reveal();
      }, PAUSE_MS);
    }
    form.addEventListener("change", function (e) {
      safely(applyAll);
      safely(function () {
        checkSocial(e && e.target);
      });
      if (pause) win.clearTimeout(pause);
      pause = null;
      reveal();
    });
    form.addEventListener("input", function () {
      safely(applyAddress);
      safely(applyCounts);
      revealSoon();
    });
    applyAll();
    reveal();
    // The first step is there as the page loads: nothing to announce yet.
    if (news) news.textContent = "";

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

    // --- an invite from the team (TASK-503) ---------------------------------------------------------
    // Opened from a staff invite's link (/fundraise?invite=...): ask the server for it, by POST so
    // the token never sits in an address, and fill in the name and email, nothing else, leaving
    // anything already typed. The sign up carries it back so the invite is marked used. A link that
    // no longer works changes nothing.
    var inviteToken = null;
    var inviteMatch = /[?&]invite=([A-Za-z0-9_-]{43})(?:&|$)/.exec((win.location && win.location.search) || "");
    if (inviteMatch && typeof win.fetch === "function") {
      var asked = win.fetch("/api/fundraise/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: inviteMatch[1] }),
      });
      // Asked: now take the token out of the address bar and the history (as the private area
      // does), keeping anything else in the address. The sign up still carries it back.
      if (win.history && typeof win.history.replaceState === "function") {
        try {
          var rest = String(win.location.search || "")
            .replace(/^\?/, "")
            .split("&")
            .filter(function (part) { return part && !/^invite=/.test(part); })
            .join("&");
          win.history.replaceState(win.history.state, "", (win.location.pathname || "/fundraise") + (rest ? "?" + rest : "") + (win.location.hash || ""));
        } catch (e) {
          /* The address stays as it was; nothing else changes. */
        }
      }
      asked
        .then(function (res) {
          return res && res.ok ? res.json() : null;
        })
        .then(function (data) {
          if (!data) return;
          inviteToken = inviteMatch[1];
          // TASK-511: the name in two boxes: the first word, and the rest as the surname.
          var parts = typeof data.name === "string" ? data.name.trim().split(/\s+/) : [];
          var firstWord = parts.length ? parts[0] : "";
          var rest = parts.slice(1).join(" ");
          [["firstName", firstWord], ["lastName", rest], ["email", data.email]].forEach(function (pair) {
            var box = el(pair[0]);
            if (box && !String(box.value || "").trim() && typeof pair[1] === "string" && pair[1]) box.value = pair[1];
          });
          applyAll();
          reveal();
        })
        .catch(function () {
          /* Could not ask: the form works the same without it. */
        });
    }

    // --- Do it again, from the year on email (TASK-515) ---------------------------------------------
    // Opened from email 18's link (/fundraise?again=...): ask the server for last year's details, by
    // POST, take the token out of the address at once, and fill in only the boxes still empty (and a
    // choice not yet made). Never the date or the address: those are this year's. The sign up carries
    // the token back so the link is used once. A link that no longer works changes nothing.
    var againToken = null;
    var againMatch = /[?&]again=([A-Za-z0-9_-]{43})(?:&|$)/.exec((win.location && win.location.search) || "");
    if (againMatch && typeof win.fetch === "function") {
      var againAsked = win.fetch("/api/fundraise/again", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: againMatch[1] }),
      });
      if (win.history && typeof win.history.replaceState === "function") {
        try {
          var againRest = String(win.location.search || "")
            .replace(/^\?/, "")
            .split("&")
            .filter(function (part) { return part && !/^again=/.test(part); })
            .join("&");
          win.history.replaceState(win.history.state, "", (win.location.pathname || "/fundraise") + (againRest ? "?" + againRest : "") + (win.location.hash || ""));
        } catch (e) {
          /* The address stays as it was; nothing else changes. */
        }
      }
      againAsked
        .then(function (res) {
          return res && res.ok ? res.json() : null;
        })
        .then(function (data) {
          if (!data) return;
          againToken = againMatch[1];
          // A choice, only when none is made yet, and only one the form offers.
          ["path", "kind"].forEach(function (name) {
            if (radio(name) || typeof data[name] !== "string") return;
            var pick = form.querySelector('input[name="' + name + '"][value="' + String(data[name]).replace(/[^a-z0-9_]/gi, "") + '"]');
            if (pick) pick.checked = true;
          });
          var target = typeof data.targetPence === "number" && data.targetPence > 0 ? String(data.targetPence % 100 === 0 ? data.targetPence / 100 : (data.targetPence / 100).toFixed(2)) : "";
          [
            ["title", data.title], ["description", data.description], ["target", target], ["venue", data.venue], ["town", data.town],
            ["kindOther", data.kindOther], ["instagram", data.instagram], ["facebook", data.facebook], ["firstName", data.firstName],
            ["lastName", data.lastName], ["email", data.email], ["phone", data.phone],
          ].forEach(function (pair) {
            var box = el(pair[0]);
            if (box && !String(box.value || "").trim() && typeof pair[1] === "string" && pair[1]) box.value = pair[1];
          });
          applyAll();
          // Most of the questions are answered: show them all, to check and change.
          if (stepped) revealAll();
        })
        .catch(function () {
          /* Could not ask: the form works the same without it. */
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
        Object.keys(SOCIAL).forEach(function (id) {
          var problem = socialProblem(id);
          if (problem) out.push({ control: el(id), message: problem });
        });
        if (serverFields) {
          Object.keys(serverFields).forEach(function (key) {
            var control = controlEl(key);
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

    // TASK-511: a yes or no: true, false, or null when not answered (the server asks for it).
    function yesNo(name) {
      var v = radio(name);
      return v === "yes" ? true : v === "no" ? false : null;
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
        kindOther: radio("kind") === "other" ? val("kindOther") : "",
        title: val("title"),
        description: val("description"),
        eventDate: val("eventDate"),
        startTime: val("startTime"),
        venue: val("venue"),
        town: val("town"),
        targetPence: path === "raising" && isFinite(pounds) && pounds > 0 ? Math.round(pounds * 100) : null,
        public: radio("public") === "yes",
        firstName: val("firstName"),
        lastName: val("lastName"),
        email: val("email"),
        phone: val("phone"),
        instagram: val("instagram"),
        facebook: val("facebook"),
        socialOk: yesNo("socialOk"),
        wants: {
          posterCount: whole("posters"),
          leafletCount: whole("leaflets"),
          bucketCount: whole("buckets"),
          tinCount: whole("tins"),
          qrCount: event ? 0 : whole("qrCodes"),
          shoutOut: yesNo("shoutOut"),
          attend: yesNo("attend"),
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
      if (inviteToken) body.invite = inviteToken;
      if (againToken) body.again = againToken; // TASK-515
      return body;
    }

    function done(body) {
      var first = String(body.firstName || "").split(/\s+/)[0] || "";
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
      // Every question shows before anything is checked, so nothing that needs an answer is hidden.
      revealAll();
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
            revealAll();
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
