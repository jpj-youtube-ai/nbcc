// Workshop drop-offs: the form on /workshop (workshop.html), the tablet page in the Elves Workshop.
// docs/superpowers/specs/2026-11-28-workshop-dropoffs-design.md
//
// Each person who brings something in leaves their details. This sends them to POST /api/workshop,
// shows "Thank you, [first name]!" for a few seconds, then clears every box (and the newsletter
// tick) for the next person; Next person brings the form back sooner. The newsletter box is never
// ticked for them. What is missing is said beside each box, never in an alert box.
//
// A classic <script defer>, exported under a CommonJS guard so it is unit tested in jsdom.
(function () {
  "use strict";

  var RESET_MS = 7000;
  var MSG = {
    name: "Please tell us your name.",
    email: "Please check your email address.",
    brought: "Please tell us what you brought in.",
    sending: "Sending…",
    failed: "Sorry, that could not be sent. Please try again, or let one of the elves know.",
  };
  var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  var CHECKS = [
    { key: "name", id: "wsName" },
    { key: "email", id: "wsEmail" },
    { key: "brought", id: "wsBrought" },
  ];
  var BOXES = ["wsName", "wsEmail", "wsBrought", "wsGroup", "wsPhone", "wsWebsite"];

  function initWorkshop(doc, win) {
    var form = doc.getElementById("wsForm");
    var done = doc.getElementById("wsDone");
    if (!form || !done) return null;
    var status = doc.getElementById("wsStatus");
    var button = doc.getElementById("wsSend");
    var title = doc.getElementById("wsDoneTitle");
    var group = doc.getElementById("wsGroup");
    var chips = Array.prototype.slice.call(doc.querySelectorAll("[data-ws-group]"));
    var busy = false;
    var timer = null;

    function val(id) {
      var el = doc.getElementById(id);
      return el ? String(el.value || "").trim() : "";
    }
    function focus(el) {
      try {
        if (el) el.focus();
      } catch (e) {
        /* focus unavailable */
      }
    }
    function say(text, kind) {
      if (!status) return;
      status.textContent = text;
      status.className = "form-status" + (kind ? " is-" + kind : "");
    }
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
        if (err) {
          err.textContent = "";
          err.hidden = true;
        }
      }
    }
    function problems() {
      var out = {};
      if (!val("wsName")) out.name = MSG.name;
      if (!EMAIL.test(val("wsEmail"))) out.email = MSG.email;
      if (!val("wsBrought")) out.brought = MSG.brought;
      return out;
    }
    function show(found) {
      var first = null;
      CHECKS.forEach(function (c) {
        mark(c.id, found[c.key] || "");
        if (found[c.key] && !first) first = doc.getElementById(c.id);
      });
      focus(first);
      return !first;
    }
    CHECKS.forEach(function (c) {
      var input = doc.getElementById(c.id);
      if (!input) return;
      input.addEventListener("input", function () {
        if (input.getAttribute("aria-invalid") === "true" && !problems()[c.key]) mark(c.id, "");
      });
    });

    // The suggestions: the one matching the box is shown pressed.
    function pressChips() {
      var now = group ? String(group.value || "").trim().toLowerCase() : "";
      chips.forEach(function (b) {
        b.setAttribute("aria-pressed", String(b.getAttribute("data-ws-group")).toLowerCase() === now ? "true" : "false");
      });
    }
    chips.forEach(function (b) {
      b.addEventListener("click", function () {
        if (group) group.value = b.getAttribute("data-ws-group");
        pressChips();
      });
    });
    if (group) group.addEventListener("input", pressChips);

    function setBusy(on) {
      busy = on;
      if (button) button.disabled = on;
      say(on ? MSG.sending : "", on ? "pending" : "");
    }

    // Ready for the next person: every box empty, nothing ticked, nothing said.
    function reset() {
      if (timer !== null) {
        win.clearTimeout(timer);
        timer = null;
      }
      BOXES.forEach(function (id) {
        var el = doc.getElementById(id);
        if (el) el.value = "";
      });
      var tick = doc.getElementById("wsNewsletter");
      if (tick) tick.checked = false;
      CHECKS.forEach(function (c) {
        mark(c.id, "");
      });
      pressChips();
      say("", "");
      done.hidden = true;
      form.hidden = false;
      if (title) title.textContent = "Thank you!";
    }

    function thank(firstName) {
      if (title) title.textContent = firstName ? "Thank you, " + firstName + "!" : "Thank you!";
      form.hidden = true;
      done.hidden = false;
      focus(title);
      timer = win.setTimeout(reset, RESET_MS);
    }

    var next = doc.getElementById("wsNext");
    if (next) next.addEventListener("click", reset);

    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      if (busy) return;
      say("", "");
      if (typeof win.fetch !== "function") return say(MSG.failed, "error");
      if (!show(problems())) return;
      var tick = doc.getElementById("wsNewsletter");
      setBusy(true);
      win
        .fetch("/api/workshop", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: val("wsName"),
            email: val("wsEmail"),
            brought: val("wsBrought"),
            groupName: val("wsGroup") || undefined,
            phone: val("wsPhone") || undefined,
            newsletter: !!(tick && tick.checked),
            website: val("wsWebsite") || undefined,
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
          if (r.ok) return thank(typeof r.data.firstName === "string" ? r.data.firstName : null);
          var refused = (r.status === 400 || r.status === 429) && typeof r.data.error === "string" && r.data.error;
          if (r.status === 400 && typeof r.data.field === "string") {
            var match = CHECKS.filter(function (c) {
              return c.key === r.data.field;
            })[0];
            if (match) mark(match.id, r.data.error);
          }
          say(refused ? r.data.error : MSG.failed, "error");
          focus(status);
        })
        .catch(function () {
          setBusy(false);
          say(MSG.failed, "error");
          focus(status);
        });
    });

    return form;
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { initWorkshop: initWorkshop };
  } else {
    initWorkshop(document, window);
  }
})();
