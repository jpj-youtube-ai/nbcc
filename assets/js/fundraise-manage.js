// Change your fundraising page, /fundraise/manage (TASK-494).
//
// Without ?token= in the address: a box for the organiser's email, which asks
// POST /api/fundraise/manage/request for a link (the server always gives the same answer, so this
// never tells anyone who is signed up). With a token: GET /api/fundraise/manage/:token, the editable
// fields filled in (with any change still waiting shown in their place), and saving sends
// POST /api/fundraise/manage/:token with only what differs from the page as approved. A change
// always waits for staff; the page says so plainly. A link that has run out or matches nothing
// leads back to asking for a new one.
//
// A classic <script defer>, exported under a CommonJS guard so it can be unit tested in jsdom.
(function () {
  "use strict";

  var FIELDS = [
    { key: "description", id: "editDescription" },
    { key: "targetPence", id: "editTarget", pence: true },
    { key: "eventDate", id: "editDate" },
    { key: "startTime", id: "editTime" },
    { key: "venue", id: "editVenue" },
    { key: "town", id: "editTown" },
    { key: "socialLink", id: "editSocial" },
  ];
  // Fields the API clears with null rather than an empty string.
  var NULLABLE = { targetPence: true, eventDate: true, startTime: true, socialLink: true };

  var MSG = {
    notFound: "This link does not work. Ask for a new one below.",
    trouble: "We could not open your link just now. Please try again in a few minutes.",
    requestFailed: "We could not send that just now. Please try again in a few minutes.",
    sending: "Sending…",
    nothing: "You have not changed anything yet.",
    saveFailed: "We could not send your changes just now. Please try again in a few minutes.",
    check: "Please check the highlighted answers below and try again.",
  };

  var LONG_DATE = (function () {
    try {
      return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "long", year: "numeric" });
    } catch (e) {
      return null;
    }
  })();

  function initManage(doc, win) {
    var requestPanel = doc.querySelector("[data-manage-request]");
    var editPanel = doc.querySelector("[data-manage-edit]");
    if (!requestPanel || !editPanel) return null;
    var loading = doc.querySelector("[data-manage-loading]");
    var problem = doc.querySelector("[data-manage-problem]");
    var sentPanel = doc.querySelector("[data-manage-sent]");
    var waiting = doc.querySelector("[data-manage-waiting]");
    var waitingWhen = doc.querySelector("[data-waiting-when]");
    var requestForm = doc.getElementById("manageRequestForm");
    var requestStatus = doc.querySelector("[data-request-status]");
    var editForm = doc.getElementById("manageEditForm");
    var editStatus = doc.querySelector("[data-edit-status]");
    var editSummary = doc.querySelector("[data-edit-error]");
    var editSubmit = doc.querySelector("[data-edit-submit]");
    var approved = null;

    function el(id) {
      return doc.getElementById(id);
    }
    function say(node, text, kind) {
      if (!node) return;
      node.textContent = text;
      node.className = "form-status" + (kind ? " is-" + kind : "");
    }
    function validate(form, summary, serverChecks) {
      var shared = win.NBCCFormValidation;
      if (shared && typeof shared.validateForm === "function") {
        if (summary) summary.textContent = MSG.check;
        return shared.validateForm(form, {
          summary: summary || undefined,
          extraChecks: function () {
            return serverChecks || [];
          },
        }).valid;
      }
      return !serverChecks && (typeof form.checkValidity !== "function" || form.checkValidity());
    }
    function readJson(res) {
      return res.json().then(
        function (data) {
          return { status: res.status, data: data || {} };
        },
        function () {
          return { status: res.status, data: {} };
        },
      );
    }
    function showOnly(panel) {
      [requestPanel, editPanel, sentPanel, loading].forEach(function (p) {
        if (p) p.hidden = p !== panel;
      });
    }
    function backToRequest(text) {
      showOnly(requestPanel);
      if (problem) {
        problem.textContent = text;
        problem.hidden = false;
      }
    }

    // --- asking for a link ------------------------------------------------------------------------
    if (requestForm) {
      requestForm.addEventListener("submit", function (e) {
        e.preventDefault();
        if (!validate(requestForm, null, null)) return;
        say(requestStatus, MSG.sending, "pending");
        win
          .fetch("/api/fundraise/manage/request", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: String(el("manageEmail").value || "").trim() }),
          })
          .then(readJson)
          .then(function (r) {
            if (r.status === 200) say(requestStatus, r.data.message || "", "success");
            else if (r.status === 400) validate(requestForm, null, [{ control: el("manageEmail"), message: "Please give a valid email address." }]);
            else say(requestStatus, MSG.requestFailed, "error");
          })
          .catch(function () {
            say(requestStatus, MSG.requestFailed, "error");
          });
      });
    }

    // --- opening a link ---------------------------------------------------------------------------
    var token = "";
    try {
      token = new URLSearchParams(win.location.search || "").get("token") || "";
    } catch (e) {
      token = "";
    }
    if (!token) return { token: null };
    if (token.length > 100 || !/^[A-Za-z0-9_-]+$/.test(token)) {
      backToRequest(MSG.notFound);
      return { token: null };
    }
    var base = "/api/fundraise/manage/" + encodeURIComponent(token);

    function fieldValue(f, value) {
      if (value === null || value === undefined) return "";
      if (f.pence) return String(Math.round(Number(value)) / 100);
      return String(value);
    }

    function fill(data) {
      var f = data.fundraiser;
      approved = f.editable || {};
      var shown = {};
      FIELDS.forEach(function (x) {
        shown[x.key] = approved[x.key];
      });
      var w = data.waitingEdit;
      if (w && w.changes) {
        Object.keys(w.changes).forEach(function (k) {
          shown[k] = w.changes[k];
        });
      }
      FIELDS.forEach(function (x) {
        var input = el(x.id);
        if (input) input.value = fieldValue(x, shown[x.key]);
      });
      var title = doc.querySelector("[data-manage-title]");
      if (title) title.textContent = f.title;
      var target = doc.querySelector("[data-edit-target]");
      if (target) target.hidden = f.path !== "raising";
      var pageLink = doc.querySelector("[data-manage-page-link]");
      var pageUrl = doc.querySelector("[data-manage-page-url]");
      if (pageLink) pageLink.hidden = !f.pageUrl;
      if (pageUrl && f.pageUrl) pageUrl.setAttribute("href", f.pageUrl);
      setWaiting(w);
    }

    function setWaiting(w) {
      if (!waiting) return;
      waiting.hidden = !w;
      if (w && waitingWhen) {
        var when = LONG_DATE && w.createdAt ? LONG_DATE.format(new Date(w.createdAt)) : "";
        waitingWhen.textContent = when ? "You sent it on " + when + "." : "";
      }
    }

    showOnly(loading);
    if (loading) loading.hidden = false;
    win
      .fetch(base)
      .then(readJson)
      .then(function (r) {
        if (r.status === 200 && r.data.fundraiser) {
          fill(r.data);
          showOnly(editPanel);
          return;
        }
        if (r.status === 404) return backToRequest(MSG.notFound);
        if (r.status === 410) return backToRequest(r.data.error || MSG.notFound);
        backToRequest(MSG.trouble);
      })
      .catch(function () {
        backToRequest(MSG.trouble);
      });

    // --- saving a change --------------------------------------------------------------------------
    function current(x) {
      var raw = String((el(x.id) || {}).value || "").trim();
      if (x.pence) {
        if (!raw) return null;
        var p = parseFloat(raw);
        return isFinite(p) ? Math.round(p * 100) : raw;
      }
      if (!raw && NULLABLE[x.key]) return null;
      return raw;
    }
    function same(a, b) {
      var blank = function (v) {
        return v === null || v === undefined || v === "";
      };
      if (blank(a) && blank(b)) return true;
      return String(a) === String(b);
    }

    if (editForm) {
      editForm.addEventListener("submit", function (e) {
        e.preventDefault();
        say(editStatus, "", null);
        if (!approved || !validate(editForm, editSummary, null)) return;
        var targetHidden = (doc.querySelector("[data-edit-target]") || {}).hidden;
        var changes = {};
        FIELDS.forEach(function (x) {
          if (x.pence && targetHidden) return;
          var now = current(x);
          if (!same(now, approved[x.key])) changes[x.key] = now;
        });
        if (!Object.keys(changes).length) return say(editStatus, MSG.nothing, "error");
        if (editSubmit) editSubmit.disabled = true;
        say(editStatus, MSG.sending, "pending");
        win
          .fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(changes) })
          .then(readJson)
          .then(function (r) {
            if (editSubmit) editSubmit.disabled = false;
            if (r.status === 202) {
              say(editStatus, "", null);
              setWaiting(r.data.edit || { createdAt: new Date().toISOString() });
              showOnly(sentPanel);
              if (sentPanel) {
                try {
                  sentPanel.focus();
                } catch (err) {
                  /* focus unavailable */
                }
              }
              return;
            }
            if (r.status === 400 && r.data.fields) {
              say(editStatus, "", null);
              var checks = [];
              FIELDS.forEach(function (x) {
                if (r.data.fields[x.key]) checks.push({ control: el(x.id), message: r.data.fields[x.key] });
              });
              if (checks.length) validate(editForm, editSummary, checks);
              else say(editStatus, r.data.fields.form || r.data.error || MSG.saveFailed, "error");
              return;
            }
            if (r.status === 404) return backToRequest(MSG.notFound);
            if (r.status === 410) return backToRequest(r.data.error || MSG.notFound);
            say(editStatus, MSG.saveFailed, "error");
          })
          .catch(function () {
            if (editSubmit) editSubmit.disabled = false;
            say(editStatus, MSG.saveFailed, "error");
          });
      });
    }

    var again = doc.querySelector("[data-manage-again]");
    if (again) {
      again.addEventListener("click", function () {
        showOnly(editPanel);
        var first = el("editDescription");
        if (first) first.focus();
      });
    }

    return { token: token };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { initManage: initManage };
  } else {
    initManage(document, window);
  }
})();
