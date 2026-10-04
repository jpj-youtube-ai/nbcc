// Joining the mailing list: the form on /newsletter (newsletter.html).
//
// It is the footer's "Keep in touch" form (initFooterSignup in main.js) given a page of its own. It
// sends exactly what that form sends, to the same existing POST /api/subscribe, which joins the
// person at once and sends the usual welcome email. The difference is only in how it looks: visible
// labels, and what is missing said beside each box (never an alert box).
//
// The consent box is never ticked for them, and nothing is sent until it is: typing an address is
// not consent. The hidden "website" box is the same one the footer form has: people never see it,
// robots fill it, and the server quietly drops those.
//
// Its own file, not part of main.js, because main.js counts towards donate.html's page weight
// budget. A classic <script defer>, exported under a CommonJS guard so it is unit tested in jsdom.
(function () {
  "use strict";

  var MSG = {
    firstName: "Please enter your first name.",
    surname: "Please enter your surname.",
    email: "Please enter a valid email address.",
    consent: "Please tick the box to confirm you'd like to hear from us.",
    sending: "Sending…",
    failed: "Something went wrong and we could not sign you up. Please try again in a few minutes.",
    cannotSend: "This form could not be sent from your browser. Please email us at info@nbcc.scot and ask to join instead.",
  };
  // The same loose shape the browser's own email check uses: something@something.something.
  var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  // In the order they are on the page, so the cursor goes to the first one that needs a look.
  var CHECKS = [
    { key: "firstName", id: "nlFirstName" },
    { key: "surname", id: "nlSurname" },
    { key: "email", id: "nlEmail" },
    { key: "consent", id: "nlConsent" },
  ];

  function initNewsletterSignup(doc, win) {
    var form = doc.getElementById("nlForm");
    var done = doc.getElementById("nlDone");
    if (!form || !done) return null;
    var canSend = typeof win.fetch === "function";
    var status = doc.getElementById("nlStatus");
    var button = doc.getElementById("nlSubmit");
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

    // One box's message, beside the box, with the same classes the contact form uses.
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
      var consent = doc.getElementById("nlConsent");
      var out = {};
      if (!val("nlFirstName")) out.firstName = MSG.firstName;
      if (!val("nlSurname")) out.surname = MSG.surname;
      if (!EMAIL.test(val("nlEmail"))) out.email = MSG.email;
      if (!consent || !consent.checked) out.consent = MSG.consent;
      return out;
    }

    // Marks everything that needs another look and puts the cursor in the first. True when all is well.
    function show(found) {
      var first = null;
      CHECKS.forEach(function (c) {
        mark(c.id, found[c.key] || "");
        if (found[c.key] && !first) first = doc.getElementById(c.id);
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

    // An error goes as soon as it is put right.
    CHECKS.forEach(function (c) {
      var input = doc.getElementById(c.id);
      if (!input) return;
      var recheck = function () {
        if (input.getAttribute("aria-invalid") === "true" && !problems()[c.key]) mark(c.id, "");
      };
      input.addEventListener("input", recheck);
      input.addEventListener("change", recheck);
    });

    // Something went wrong: said in the message area, which takes the focus so it is heard.
    function fail(text) {
      say(text, "error");
      if (!status) return;
      try {
        status.focus();
      } catch (e) {
        /* focus unavailable */
      }
    }

    function setBusy(on) {
      busy = on;
      if (button) button.disabled = on;
      say(on ? MSG.sending : "", on ? "pending" : "");
    }

    function thank() {
      form.hidden = true;
      done.hidden = false;
      // The heading takes the focus, so a screen reader says "You're signed up".
      var title = doc.getElementById("nlDoneTitle") || done;
      try {
        title.focus();
      } catch (e) {
        /* focus unavailable */
      }
    }

    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      if (busy) return;
      say("", "");
      // A browser that cannot send it: never let the form post itself (that lands on a page of raw
      // code). The no script line on the page covers a browser with no JavaScript at all.
      if (!canSend) return fail(MSG.cannotSend);
      if (!show(problems())) return;
      setBusy(true);
      win
        .fetch("/api/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // The footer form's own payload: an empty mobile or hidden box is left out.
          body: JSON.stringify({
            firstName: val("nlFirstName"),
            surname: val("nlSurname"),
            email: val("nlEmail"),
            phone: val("nlPhone") || undefined,
            consent: true,
            website: val("nlWebsite") || undefined,
          }),
        })
        .then(function (res) {
          return res.json().then(
            function (data) {
              return { ok: res.ok, status: res.status, data: data || {} };
            },
            function () {
              return { ok: res.ok, status: res.status, data: {} };
            },
          );
        })
        .then(function (r) {
          setBusy(false);
          if (r.ok) return thank();
          // A refusal (the boxes need another look, or too many tries) is said in the server's own
          // words, as the footer form shows them. Anything else gets this page's own message.
          var refused = r.status === 400 || r.status === 429;
          fail(refused && typeof r.data.error === "string" && r.data.error ? r.data.error : MSG.failed);
        })
        .catch(function () {
          setBusy(false);
          fail(MSG.failed);
        });
    });

    return form;
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { initNewsletterSignup: initNewsletterSignup };
  } else {
    initNewsletterSignup(document, window);
  }
})();
