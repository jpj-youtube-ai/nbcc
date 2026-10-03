// Joining a team at /fundraise/<team>/join (team pages, Jaimie, 2026-10-03).
//
// A short form: who is joining (first name, surname, email; a parent's email for someone under 18),
// "Are you 18 or over?" (nothing chosen; a No stops the form with the sign up form's kind note), an
// optional target and a line about why, and the sharing question only when the team's split is just
// the team organiser's (the server draws it hidden otherwise). Sending goes to
// POST /api/fundraise/teams/<team>/join as JSON; a 400 puts each of the server's messages beside its
// box, a 404 means the team stopped taking members (the closed panel shows), and success swaps the
// form for a thank you.
//
// An invite's link (?invite=<token>) asks POST /api/fundraise/team-invite for the first name, surname
// and email, fills in only empty boxes and only for this team, takes the token out of the address bar
// at once, and carries it back with the join so the invite is marked joined.
//
// The spam check is the sign up form's (GET /api/fundraise/captcha, Cloudflare loaded only once
// someone starts on the form). Its own file, never main.js (donate.html's page weight budget). A
// classic <script defer>, exported under a CommonJS guard so it can be unit tested in jsdom.
(function () {
  "use strict";

  var SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=nbccJoinTurnstileReady";
  var UNDER_18 =
    "You need to be 18 or over to set up a page. Ask a parent, guardian or another grown up you trust to set it up for you: they can name you on the page (for example, 'for Ella's 10th birthday'). Any questions, call 01292 811 015 or email events@nbcc.scot.";
  var MSG = {
    sending: "Sending…",
    waiting: "One moment, we're still checking you're not a robot. Please press Join the team again in a second.",
    tick: "Please tick the box above Join the team to show you're not a robot.",
    captcha: "The check that you're not a robot did not go through. Please try it again, then press Join the team.",
    busy: "Too many sign ups from here just now. Please try again in a few minutes.",
    failed: "We could not send that just now. Please try again in a moment, or email events@nbcc.scot.",
    check: "Please check the highlighted answers below and try again.",
  };
  var FIELD_CONTROL = {
    firstName: "firstName",
    lastName: "lastName",
    email: "email",
    over18: "over18Yes",
    targetPence: "target",
    why: "why",
    sharesWithOther: "sharesYes",
    nbccSharePercent: "nbccSharePercent",
    otherCauseName: "otherCauseName",
  };

  function initJoinForm(doc, win) {
    var form = doc.getElementById("joinForm");
    var openPanel = doc.querySelector("[data-join-open]");
    if (!form || !openPanel || openPanel.hidden) return null;
    form.hidden = false;
    Array.prototype.forEach.call(doc.querySelectorAll("[data-nojs]"), function (n) {
      n.hidden = true;
    });
    var slug = form.getAttribute("data-team-slug") || "";
    var summary = form.querySelector("[data-form-error]");
    var status = doc.getElementById("formStatus");
    var submitBtn = form.querySelector("[data-submit]");
    var tokenField = doc.getElementById("captchaToken");
    var captchaBox = doc.getElementById("joinCaptcha");
    var shareStep = form.querySelector("[data-join-share]");
    var splitFields = form.querySelector("[data-split-fields]");
    var ageNote = form.querySelector("[data-age-note]");
    var sending = false;

    function el(id) {
      return doc.getElementById(id);
    }
    function val(id) {
      var e = el(id);
      return e ? String(e.value || "").trim() : "";
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
    function need(control, on) {
      if (!control) return;
      control.required = on;
      if (on) control.setAttribute("aria-required", "true");
      else control.removeAttribute("aria-required");
    }
    function asked() {
      return !!(shareStep && !shareStep.hidden);
    }
    function under18() {
      return radio("over18") === "no";
    }

    function applyAll() {
      var no = under18();
      var words = no ? UNDER_18 : "";
      if (ageNote && ageNote.textContent !== words) ageNote.textContent = words;
      form.classList.toggle("fr-under-18", no);
      var yes = asked() && radio("sharesWithOther") === "yes";
      if (splitFields) splitFields.hidden = !yes;
      Array.prototype.forEach.call(form.querySelectorAll('input[name="sharesWithOther"]'), function (r) {
        need(r, asked());
      });
      ["nbccSharePercent", "otherCauseName"].forEach(function (id) {
        need(el(id), yes);
      });
    }
    form.addEventListener("change", applyAll);
    applyAll();

    // A text box grows with what is typed, so nothing scrolls inside it (Jaimie's rule).
    Array.prototype.forEach.call(form.querySelectorAll("textarea"), function (t) {
      t.addEventListener("input", function () {
        if (!t.scrollHeight) return;
        t.style.height = "auto";
        t.style.height = t.scrollHeight + 4 + "px";
        t.style.overflowY = "hidden";
      });
    });

    // --- the spam check, loaded only when needed --------------------------------------------------
    var captcha = { on: false, siteKey: null, loading: false, widgetId: null, broken: false, interactive: false };
    function renderCaptcha() {
      if (captcha.widgetId !== null || !win.turnstile || !captchaBox) return;
      captchaBox.hidden = false;
      captcha.widgetId = win.turnstile.render(captchaBox, {
        sitekey: captcha.siteKey,
        size: (form.clientWidth || 400) >= 340 ? "flexible" : "compact",
        callback: function (token) {
          tokenField.value = token;
          captcha.broken = false;
          captcha.interactive = false;
        },
        "expired-callback": function () {
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
      win.nbccJoinTurnstileReady = renderCaptcha;
      var s = doc.createElement("script");
      s.src = SCRIPT_URL;
      s.async = true;
      s.defer = true;
      s.onerror = function () {
        captcha.broken = true;
        captcha.loading = false;
      };
      doc.head.appendChild(s);
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
          /* The server still checks. */
        });
    }

    // --- an invite's link ---------------------------------------------------------------------------
    var inviteToken = null;
    var match = /[?&]invite=([A-Za-z0-9_-]{43})(?:&|$)/.exec((win.location && win.location.search) || "");
    if (match && typeof win.fetch === "function") {
      var asking = win.fetch("/api/fundraise/team-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: match[1] }),
      });
      if (win.history && typeof win.history.replaceState === "function") {
        try {
          var rest = String(win.location.search || "")
            .replace(/^\?/, "")
            .split("&")
            .filter(function (part) {
              return part && !/^invite=/.test(part);
            })
            .join("&");
          win.history.replaceState(win.history.state, "", (win.location.pathname || "") + (rest ? "?" + rest : "") + (win.location.hash || ""));
        } catch (e) {
          /* The address stays as it was. */
        }
      }
      asking
        .then(function (res) {
          return res && res.ok ? res.json() : null;
        })
        .then(function (data) {
          if (!data || data.teamSlug !== slug) return;
          inviteToken = match[1];
          [["firstName", data.firstName], ["lastName", data.lastName], ["email", data.email]].forEach(function (pair) {
            var box = el(pair[0]);
            if (box && !String(box.value || "").trim() && typeof pair[1] === "string" && pair[1]) box.value = pair[1];
          });
        })
        .catch(function () {
          /* The form works the same without it. */
        });
    }

    // --- checking and sending -----------------------------------------------------------------------
    function validate(serverFields) {
      var shared = win.NBCCFormValidation;
      var extra = function () {
        var out = [];
        if (serverFields) {
          Object.keys(serverFields).forEach(function (key) {
            var control = el(FIELD_CONTROL[key] || key);
            if (control) out.push({ control: control, message: serverFields[key] });
          });
        }
        return out;
      };
      if (shared && typeof shared.validateForm === "function") {
        if (summary) summary.textContent = MSG.check;
        return shared.validateForm(form, { summary: summary, extraChecks: extra }).valid;
      }
      if (serverFields) {
        say(
          Object.keys(serverFields)
            .map(function (k) {
              return serverFields[k];
            })
            .join(" "),
          "error",
        );
        return false;
      }
      return typeof form.checkValidity !== "function" || form.checkValidity();
    }

    function payload() {
      var pounds = parseFloat(val("target"));
      var body = {
        firstName: val("firstName"),
        lastName: val("lastName"),
        email: val("email"),
        over18: radio("over18") === "yes" ? true : radio("over18") === "no" ? false : null,
        targetPence: isFinite(pounds) && pounds > 0 ? Math.round(pounds * 100) : null,
        why: val("why"),
        company: val("company"),
        captchaToken: tokenField ? tokenField.value : "",
      };
      if (asked()) {
        var share = radio("sharesWithOther");
        body.sharesWithOther = share === "yes" ? true : share === "no" ? false : null;
        body.nbccSharePercent = share === "yes" ? val("nbccSharePercent") : null;
        body.otherCauseName = share === "yes" ? val("otherCauseName") : "";
      }
      if (inviteToken) body.invite = inviteToken;
      return body;
    }

    function show(panel) {
      if (!panel) return;
      panel.hidden = false;
      try {
        panel.focus();
        if (panel.scrollIntoView) panel.scrollIntoView({ block: "start" });
      } catch (e) {
        /* focus unavailable */
      }
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (sending) return;
      say("", null);
      if (under18()) {
        applyAll();
        return;
      }
      if (!validate(null)) return;
      if (captcha.on && !tokenField.value) {
        loadCaptcha();
        say(captcha.interactive ? MSG.tick : MSG.waiting, "pending");
        return;
      }
      var body = payload();
      sending = true;
      if (submitBtn) submitBtn.disabled = true;
      say(MSG.sending, "pending");
      win
        .fetch("/api/fundraise/teams/" + encodeURIComponent(slug) + "/join", {
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
            var nameSlot = doc.querySelector("[data-thanks-name]");
            if (nameSlot) nameSlot.textContent = body.firstName ? ", " + body.firstName.split(/\s+/)[0] : "";
            openPanel.hidden = true;
            show(doc.querySelector("[data-join-thanks]"));
            return;
          }
          if (r.status === 404) {
            say("", null);
            openPanel.hidden = true;
            show(doc.querySelector("[data-join-closed]"));
            return;
          }
          if (tokenField) tokenField.value = "";
          if (win.turnstile && captcha.widgetId !== null) win.turnstile.reset(captcha.widgetId);
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

    return { payload: payload };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { initJoinForm: initJoinForm };
  } else {
    initJoinForm(document, window);
  }
})();
