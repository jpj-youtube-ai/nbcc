// All emails in Admin > Fundraising. Its own file beside app.js, so each can change without the
// other: it finds its card (#frAllEmails in admin.html), reads the signed in person's token the same
// way app.js keeps it, and asks its own API (src/routes/admin-fundraising-emails.ts), which is drawn
// from the one catalogue of emails (src/email/catalogue.ts).
//
//   - the bar: "2 waiting for sign off" when anything needs an admin, otherwise "69 emails";
//   - inside: the groups, each folded; in a group, a row for each email with its name, its subject
//     line, who gets it and when, and "Approved" or "Waiting for sign off" where that applies;
//   - a row opens the email underneath exactly as it would arrive, in a sandboxed frame as tall as
//     the email is. Opening another closes nothing: the page grows, and nothing scrolls inside a box;
//   - a Version drop-down where an email has more than one version, and on the automatic emails to
//     organisers "Show it for", to see one as it would go today to a real fundraiser;
//   - for an admin who can edit Fundraising, on the few emails that are approval gated: Approve this wording and Withdraw
//     approval. They call the endpoints that already did this (the list gives each one's path), so
//     nothing new is gated here and nothing that is gated is changed.
// Nothing is fetched until it is wanted: the count when Fundraising is shown, the list when the card
// is first opened, an email when its row is first opened.
//
// Other cards link here with a button carrying data-allemails-open="<group id>" (and optionally
// data-allemails-email, data-allemails-touch, data-allemails-fundraiser). After a sign off changes,
// "nbcc:wording-changed" bubbles up from this card so those cards can read their state again.
// The server enforces every rule; app.js (an admin who can edit Fundraising) only decides which
// buttons are offered.
// Everything from the server is written as text, never as markup.
//
// A classic <script defer>, exported under a CommonJS guard so it can be unit tested in jsdom.
(function () {
  "use strict";

  var TOKEN_KEY = "nbcc_admin_token";
  var EMAIL_W = 660;
  var MSG = {
    failed: "The emails could not load just now. Try again in a moment.",
    one: "That email could not load just now. Try again in a moment.",
    did: "That did not work. Please try again.",
    unchecked: "Couldn't check sign-offs just now, so wording that needs approval is held.",
  };
  // What an admin is asked before a sign off changes, by which endpoint signs it off.
  var ASK = [
    ["/touch/approvals/", "Approve this wording? Once approved, it goes to organisers by itself when it is due, while automatic emails are on.", "Withdraw approval? This email stops going until it is approved again."],
    ["/pledges/approvals/", "Approve this wording? From then on it is sent to sponsors while Automatic emails are on.", "Withdraw approval? This email stops going until it is approved again."],
    ["/invite-wording/", "Approve this wording? Once approved, in memory invites can be sent with it.", "Withdraw approval? In memory invites cannot be sent until it is approved again."],
  ];

  function initAdminAllEmails(doc, win) {
    var card = doc.getElementById("frAllEmails");
    if (!card) return null;
    var H = win.AdminHelpers || {};
    var data = null; // GET /api/admin/fundraising/emails
    var listState = "idle"; // idle, loading, ok or failed
    var listWait = null; // the list being fetched, so two openers share one request
    var rows = {}; // email id -> { email, version, shown, seq, real, els... }
    var showFor = ""; // "" for the example, or a fundraiser's id: one choice for every automatic email
    var busy = false;

    function el(id) {
      return doc.getElementById(id);
    }
    function make(tag, cls, text) {
      var n = doc.createElement(tag);
      if (cls) n.className = cls;
      if (text !== undefined && text !== null) n.textContent = text;
      return n;
    }
    function clear(n) {
      while (n && n.firstChild) n.removeChild(n.firstChild);
    }
    function token() {
      try {
        return win.sessionStorage.getItem(TOKEN_KEY);
      } catch (e) {
        return null;
      }
    }
    // Approve and Withdraw are offered to an admin who can also edit Fundraising: what the server
    // asks (authorizeSectionAsAdmin). app.js knows the person's live permissions and says so here;
    // only if it is not on the page does the role in the token decide. The server always has the
    // last word.
    function canApprove() {
      var src = win.AdminFundraising;
      if (src && typeof src.canApprove === "function") return !!src.canApprove();
      var claims = H.parseClaims ? H.parseClaims(token()) : null;
      return !!claims && claims.role === "admin";
    }
    function day(iso) {
      if (!iso) return "";
      return H.fmtDate ? H.fmtDate(iso) : String(iso).slice(0, 10);
    }
    function who(actor) {
      var a = String(actor || "");
      return a.indexOf("admin:") === 0 ? a.slice(6) : a || "unknown";
    }
    function plural(n, one, many) {
      return n + " " + (n === 1 ? one : many);
    }
    function say(line, text, error) {
      if (!line) return;
      line.textContent = text;
      line.className = "ty-status" + (error ? " is-error" : text ? " is-ok" : "");
    }

    function call(method, path) {
      var t = token();
      if (!t) return Promise.reject(new Error("signed out"));
      return win.fetch(path, { method: method, headers: { Authorization: "Bearer " + t } }).then(function (res) {
        return res.json().then(
          function (d) {
            return { status: res.status, data: d || {} };
          },
          function () {
            return { status: res.status, data: {} };
          },
        );
      });
    }

    // --- the bar -----------------------------------------------------------------------------------
    function barWords(s) {
      var waiting = Number(s.waiting) || 0;
      return waiting ? waiting + " waiting for sign off" : plural(Number(s.count) || 0, "email", "emails");
    }

    function loadSummary() {
      if (!token()) return Promise.resolve(null);
      return call("GET", "/api/admin/fundraising/emails/summary")
        .then(function (r) {
          if (r.status === 403) {
            card.hidden = true;
            return null;
          }
          if (r.status !== 200) throw new Error("failed");
          card.hidden = false;
          el("frAllEmailsState").textContent = barWords(r.data);
          return r.data;
        })
        .catch(function () {
          card.hidden = false;
          el("frAllEmailsState").textContent = MSG.failed;
        });
    }

    // --- the list ----------------------------------------------------------------------------------
    function allEmails() {
      var out = [];
      ((data && data.groups) || []).forEach(function (g) {
        (g.emails || []).forEach(function (e) {
          out.push(e);
        });
      });
      return out;
    }
    function versionOf(email, id) {
      var list = email.versions || [];
      for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
      return null;
    }
    function versionByKey(email, key) {
      var list = email.versions || [];
      for (var i = 0; i < list.length; i++) if (list[i].approval && list[i].approval.key === key) return list[i];
      return null;
    }

    function statePill(email) {
      if (!email.state) return null;
      var approved = email.state === "approved";
      var pill = make("span", "admin-pill " + (approved ? "admin-pill--paid" : "is-call-due"), approved ? "Approved" : "Waiting for sign off");
      pill.setAttribute("data-emails-state", email.state);
      return pill;
    }

    // The row's own words: name and label, subject, who gets it and when.
    function drawRowWords(r) {
      var e = r.email;
      clear(r.btn);
      var top = make("span", "fr-emails-row-top");
      top.appendChild(make("span", "fr-emails-row-name", e.name));
      var pill = statePill(e);
      if (pill) top.appendChild(pill);
      // When the version waiting is not the usual one, say which: the row opens on it.
      if (e.state === "waiting" && e.waitingVersion && e.versions.length && e.waitingVersion !== e.versions[0].id) {
        var v = versionOf(e, e.waitingVersion);
        if (v) {
          var which = make("span", "fr-emails-row-version", "Version: " + v.label);
          which.setAttribute("data-emails-waiting-version", v.id);
          top.appendChild(which);
        }
      }
      r.btn.appendChild(top);
      if (e.subject) {
        var subject = make("span", "fr-emails-row-subject");
        subject.appendChild(make("span", "", "Subject"));
        subject.appendChild(doc.createTextNode(" " + e.subject));
        r.btn.appendChild(subject);
      }
      r.btn.appendChild(make("span", "fr-emails-row-who", e.who));
    }

    function buildRow(e) {
      var li = make("li", "fr-emails-item");
      li.setAttribute("data-email", e.id);
      var btn = make("button", "fr-emails-row");
      btn.type = "button";
      btn.id = "frEmailRow-" + e.id;
      btn.setAttribute("aria-expanded", "false");
      btn.setAttribute("aria-controls", "frEmail-" + e.id);
      var panel = make("div", "fr-emails-panel");
      panel.id = "frEmail-" + e.id;
      panel.hidden = true;
      panel.setAttribute("role", "region");
      panel.setAttribute("aria-labelledby", btn.id);
      li.appendChild(btn);
      li.appendChild(panel);
      var r = { email: e, li: li, btn: btn, panel: panel, built: false, version: null, shown: "", seq: 0, real: null };
      rows[e.id] = r;
      drawRowWords(r);
      return li;
    }

    function drawGroupBar(g, details) {
      var bar = details.querySelector("summary");
      clear(bar);
      bar.appendChild(make("span", "fr-emails-group-name", g.name));
      bar.appendChild(make("span", "fr-emails-group-count", plural((g.emails || []).length, "email", "emails")));
      var waiting = (g.emails || []).filter(function (e) {
        return e.state === "waiting";
      }).length;
      if (waiting) {
        var pill = make("span", "admin-pill is-call-due", waiting + " waiting for sign off");
        pill.setAttribute("data-emails-group-waiting", String(waiting));
        bar.appendChild(pill);
      }
    }

    function drawList() {
      var box = el("frAllEmailsGroups");
      clear(box);
      rows = {};
      (data.groups || []).forEach(function (g) {
        var details = make("details", "fr-fold fr-emails-group");
        details.setAttribute("data-emails-group", g.id);
        details.appendChild(make("summary", "fr-fold-bar fr-emails-group-bar"));
        drawGroupBar(g, details);
        var ul = make("ul", "fr-emails-rows");
        ul.setAttribute("role", "list");
        (g.emails || []).forEach(function (e) {
          ul.appendChild(buildRow(e));
        });
        details.appendChild(ul);
        box.appendChild(details);
      });
    }

    // The list again after a sign off changed: every label, and each open email's sign off, redrawn
    // in place. Nothing is closed and no email is fetched again.
    function redraw() {
      el("frAllEmailsState").textContent = barWords(data);
      (data.groups || []).forEach(function (g) {
        var details = card.querySelector('[data-emails-group="' + g.id + '"]');
        if (details) drawGroupBar(g, details);
        (g.emails || []).forEach(function (e) {
          var r = rows[e.id];
          if (!r) return;
          r.email = e;
          drawRowWords(r);
          if (r.built && !r.panel.hidden) drawSignOff(r);
        });
      });
      say(el("frAllEmailsStatus"), data.approvalsUnavailable ? MSG.unchecked : "", false);
    }

    function fetchList() {
      return call("GET", "/api/admin/fundraising/emails").then(function (r) {
        if (r.status !== 200 || !r.data || !Array.isArray(r.data.groups)) throw new Error("failed");
        data = r.data;
        return data;
      });
    }

    function loadList() {
      if (listState === "ok") return Promise.resolve(data);
      if (listWait) return listWait;
      listState = "loading";
      listWait = fetchList()
        .then(function () {
          listState = "ok";
          listWait = null;
          drawList();
          redraw();
          return data;
        })
        .catch(function () {
          listState = "failed";
          listWait = null;
          say(el("frAllEmailsStatus"), MSG.failed, true);
          return null;
        });
      return listWait;
    }

    // --- one email, open ----------------------------------------------------------------------------
    function raisingPages() {
      var src = win.AdminFundraising;
      var list = src && typeof src.raisingPages === "function" ? src.raisingPages() : [];
      return Array.isArray(list) ? list : [];
    }

    function field(cls, labelText, select) {
      var wrap = make("div", "fr-field " + cls);
      var label = make("label", "fx-call-label", labelText);
      label.setAttribute("for", select.id);
      wrap.appendChild(label);
      wrap.appendChild(select);
      return wrap;
    }

    function fillFor(r) {
      if (!r.forPick) return;
      var pages = raisingPages();
      if (showFor && !pages.some(function (p) { return String(p.id) === showFor; })) showFor = "";
      clear(r.forPick);
      var first = make("option", "", "An example: Sam's Santa Dash");
      first.value = "";
      r.forPick.appendChild(first);
      pages.forEach(function (p) {
        var o = make("option", "", p.title + ", " + p.name);
        o.value = String(p.id);
        r.forPick.appendChild(o);
      });
      r.forPick.value = showFor;
      if (r.versionField) r.versionField.hidden = !!showFor;
    }

    function buildPanel(r) {
      var e = r.email;
      r.built = true;
      r.version = (e.state === "waiting" && versionOf(e, e.waitingVersion) ? e.waitingVersion : e.versions[0].id);
      var controls = make("div", "fr-emails-controls");
      if (e.versions.length > 1) {
        var pick = make("select", "fx-call-input");
        pick.id = "frEmailVersion-" + e.id;
        pick.setAttribute("data-emails-version", e.id);
        e.versions.forEach(function (v) {
          var o = make("option", "", v.label);
          o.value = v.id;
          pick.appendChild(o);
        });
        pick.value = r.version;
        r.versionPick = pick;
        r.versionField = field("fr-emails-version-field", "Version", pick);
        controls.appendChild(r.versionField);
      }
      if (e.touchKind) {
        var forPick = make("select", "fx-call-input");
        forPick.id = "frEmailFor-" + e.id;
        forPick.setAttribute("data-emails-for", e.id);
        r.forPick = forPick;
        controls.appendChild(field("fr-emails-for-field", "Show it for", forPick));
        fillFor(r);
      }
      if (controls.firstChild) r.panel.appendChild(controls);
      r.meta = make("div", "fr-touch-meta");
      r.panel.appendChild(r.meta);
      r.wrap = make("div", "fr-touch-preview-wrap");
      r.frame = make("iframe", "fr-touch-preview");
      r.frame.setAttribute("title", e.name + ", as it would arrive");
      r.frame.setAttribute("sandbox", "allow-same-origin");
      r.frame.setAttribute("scrolling", "no");
      r.frame.addEventListener("load", function () {
        fit(r);
        if (win.requestAnimationFrame) win.requestAnimationFrame(function () { fit(r); });
      });
      r.wrap.hidden = true;
      r.wrap.appendChild(r.frame);
      r.panel.appendChild(r.wrap);
      r.status = make("p", "ty-status");
      r.status.setAttribute("role", "status");
      r.status.setAttribute("aria-live", "polite");
      r.status.setAttribute("data-emails-status", "");
      r.panel.appendChild(r.status);
    }

    // The real 660px email, zoomed down to fit, and as tall as it is: the page grows. On a phone it
    // is drawn at the phone's own width instead, as their phone would show it, so it can be read.
    function fit(r) {
      var frame = r.frame, wrap = r.wrap;
      if (!frame || !wrap || !wrap.clientWidth) return;
      var cdoc = frame.contentDocument;
      if (!cdoc || !cdoc.body) return;
      var emailW = wrap.clientWidth >= 480 ? EMAIL_W : Math.max(wrap.clientWidth, 300);
      frame.style.width = emailW + "px";
      frame.style.height = "0px";
      frame.style.height = Math.max(cdoc.body.scrollHeight, cdoc.documentElement.scrollHeight) + "px";
      frame.style.zoom = Math.min(1, wrap.clientWidth / emailW);
    }

    function actionRow(label, attr, quiet) {
      var row = make("div", "fx-call-row");
      var b = make("button", "admin-btn admin-btn--small" + (quiet ? " fr-btn-quiet" : ""), label);
      b.type = "button";
      b.setAttribute(attr, "");
      b.disabled = busy;
      row.appendChild(b);
      return row;
    }

    // Which sign off the email on screen answers to: the version chosen, or for a real fundraiser
    // the version the server says would go to them today.
    function shownApproval(r) {
      if (r.real) return r.real.wordingKey ? (versionByKey(r.email, r.real.wordingKey) || {}).approval || null : null;
      var v = versionOf(r.email, r.version);
      return v ? v.approval : null;
    }

    function drawSignOff(r) {
      var e = r.email;
      clear(r.meta);
      var a = shownApproval(r);
      if (a) {
        var line;
        if (data.approvalsUnavailable) {
          line = make("p", "fr-touch-signoff", "Couldn't check sign-offs just now, so this wording is held.");
        } else if (!a.approvedAt) {
          line = make("p", "fr-touch-signoff", "Waiting for sign off. It won't send until an admin approves it.");
        } else {
          line = make("p", "fr-touch-approved", "Approved by " + who(a.approvedBy) + " on " + day(a.approvedAt) + ".");
        }
        line.setAttribute("data-emails-signoff", a.key);
        r.meta.appendChild(line);
        if (canApprove() && !data.approvalsUnavailable) {
          r.meta.appendChild(a.approvedAt ? actionRow("Withdraw approval", "data-emails-withdraw", true) : actionRow("Approve this wording", "data-emails-approve", false));
        }
      }
      // The label on the row covers every version. When another version is the one waiting, say
      // which, with a button that shows it.
      if (!r.real && !data.approvalsUnavailable) {
        var other = null;
        e.versions.forEach(function (v) {
          if (!other && v.approval && !v.approval.approvedAt && (!a || v.approval.key !== a.key)) other = v;
        });
        if (other) {
          var note = make("p", "fr-touch-signoff", "Another version is still waiting for sign off: " + other.label + ".");
          note.setAttribute("data-emails-other", other.id);
          r.meta.appendChild(note);
          var show = actionRow("Show that version", "data-emails-show-version", true);
          show.firstChild.setAttribute("data-emails-show-version", other.id);
          show.firstChild.disabled = false;
          r.meta.appendChild(show);
        }
      }
      if (e.note) r.meta.appendChild(make("p", "fr-field-hint fr-emails-note", e.note));
      if (r.real) {
        var hint = make("p", "fr-field-hint", "For " + (r.real.title || "this fundraiser") + ", as it would go today.");
        hint.setAttribute("data-emails-for-hint", "");
        r.meta.appendChild(hint);
      }
      if (r.subject) {
        var subject = make("p", "fr-touch-subject");
        subject.appendChild(make("span", "", "Subject"));
        subject.appendChild(doc.createTextNode(" " + r.subject));
        r.meta.appendChild(subject);
      }
    }

    function loadEmail(r) {
      var e = r.email;
      var real = e.touchKind && showFor ? showFor : "";
      var want = real ? "for:" + real : "version:" + r.version;
      if (r.shown === want) return Promise.resolve();
      var mine = ++r.seq;
      say(r.status, "", false);
      // The sign off on screen belongs to the email on screen. While another loads (or if it cannot),
      // it is put away, so Approve is never offered beside wording that is not the one it approves.
      r.shown = "";
      r.real = null;
      r.subject = "";
      clear(r.meta);
      var path = real
        ? "/api/admin/fundraising/touch/preview/" + encodeURIComponent(e.touchKind) + "?fundraiserId=" + encodeURIComponent(real)
        : "/api/admin/fundraising/emails/" + encodeURIComponent(e.id) + "/" + encodeURIComponent(r.version);
      return call("GET", path)
        .then(function (res) {
          if (mine !== r.seq) return;
          if (res.status !== 200 || typeof res.data.html !== "string") {
            putAway(r);
            say(r.status, res.data.error || MSG.one, true);
            return;
          }
          r.shown = want;
          r.real = real ? res.data : null;
          r.subject = res.data.subject || "";
          drawSignOff(r);
          r.wrap.hidden = false;
          r.frame.setAttribute("srcdoc", res.data.html);
          fit(r);
        })
        .catch(function () {
          if (mine !== r.seq) return;
          putAway(r);
          say(r.status, MSG.one, true);
        });
    }

    // An email that could not load: the one shown before is put away too, so a stale email is never
    // left under a drop-down that names another version.
    function putAway(r) {
      r.wrap.hidden = true;
      r.frame.removeAttribute("srcdoc");
    }

    function openRow(r) {
      if (!r.built) buildPanel(r);
      else fillFor(r);
      r.panel.hidden = false;
      r.btn.setAttribute("aria-expanded", "true");
      return loadEmail(r).then(function () {
        fit(r);
      });
    }
    function closeRow(r) {
      r.panel.hidden = true;
      r.btn.setAttribute("aria-expanded", "false");
    }

    function setVersion(r, id) {
      if (!versionOf(r.email, id)) return Promise.resolve();
      r.version = id;
      if (r.versionPick) r.versionPick.value = id;
      return loadEmail(r);
    }

    // One fundraiser for every automatic email: each one that is open is shown again for them.
    function setShowFor(id) {
      showFor = String(id || "");
      var waits = [];
      Object.keys(rows).forEach(function (key) {
        var r = rows[key];
        if (!r.built || !r.email.touchKind) return;
        fillFor(r);
        if (!r.panel.hidden) waits.push(loadEmail(r));
      });
      return Promise.all(waits);
    }

    // --- signing off --------------------------------------------------------------------------------
    function ask(path, approve) {
      for (var i = 0; i < ASK.length; i++) if (path.indexOf(ASK[i][0]) !== -1) return ASK[i][approve ? 1 : 2];
      return approve ? "Approve this wording?" : "Withdraw approval?";
    }

    function signOff(r, approve) {
      var a = shownApproval(r);
      if (busy || !a || !canApprove()) return Promise.resolve();
      if (win.confirm && !win.confirm(ask(a.path, approve))) return Promise.resolve();
      busy = true;
      say(r.status, "Saving…", false);
      return call(approve ? "POST" : "DELETE", a.path)
        .then(function (res) {
          if (res.status !== 200) {
            busy = false;
            drawSignOff(r);
            say(r.status, res.data.error || MSG.did, true);
            return;
          }
          // Read it all again: every label here, and the bar.
          return fetchList()
            .catch(function () {
              return null;
            })
            .then(function () {
              busy = false;
              redraw();
              say(r.status, approve ? "Wording approved." : "Approval withdrawn.", false);
              if (win.CustomEvent) card.dispatchEvent(new win.CustomEvent("nbcc:wording-changed", { bubbles: true, detail: { key: a.key } }));
            });
        })
        .catch(function () {
          busy = false;
          drawSignOff(r);
          say(r.status, MSG.did, true);
        });
    }

    // --- opening from another card -------------------------------------------------------------------
    function open(groupId, o) {
      o = o || {};
      var fold = el("frAllEmailsFold");
      card.hidden = false;
      if (fold) fold.open = true;
      return loadList().then(function () {
        if (listState !== "ok") return;
        var details = card.querySelector('[data-emails-group="' + groupId + '"]');
        if (!details) return;
        details.open = true;
        var target = null;
        if (o.fundraiserId !== undefined && o.fundraiserId !== null && o.fundraiserId !== "") {
          showFor = String(o.fundraiserId);
          // The email due next for them, or the first automatic one.
          var all = allEmails().filter(function (e) { return e.touchKind; });
          target = all.filter(function (e) { return e.touchKind === o.touchKind; })[0] || all[0] || null;
        }
        if (o.emailId && rows[o.emailId]) target = rows[o.emailId].email;
        var focusOn = details.querySelector("summary");
        var wait = Promise.resolve();
        if (target && rows[target.id]) {
          var r = rows[target.id];
          var home = r.li.parentNode && r.li.parentNode.parentNode;
          if (home && home.tagName === "DETAILS") home.open = true;
          focusOn = r.btn;
          // Every open automatic email is shown again for the fundraiser chosen, then this one opens.
          wait = setShowFor(showFor).then(function () {
            return openRow(r);
          });
        }
        if (focusOn && focusOn.focus) focusOn.focus();
        if (focusOn && focusOn.scrollIntoView) focusOn.scrollIntoView({ block: "start" });
        return wait;
      });
    }

    // --- wiring -------------------------------------------------------------------------------------
    card.addEventListener("click", function (ev) {
      var t = ev.target && ev.target.closest ? ev.target.closest("button") : null;
      if (!t || !card.contains(t)) return;
      var li = t.closest("[data-email]");
      var r = li ? rows[li.getAttribute("data-email")] : null;
      if (!r) return;
      if (t === r.btn) return r.panel.hidden ? openRow(r) : closeRow(r);
      if (t.hasAttribute("data-emails-show-version")) {
        return setVersion(r, t.getAttribute("data-emails-show-version")).then(function () {
          if (r.versionPick && r.versionPick.focus) r.versionPick.focus();
        });
      }
      if (t.hasAttribute("data-emails-approve")) return signOff(r, true);
      if (t.hasAttribute("data-emails-withdraw")) return signOff(r, false);
    });

    card.addEventListener("change", function (ev) {
      var t = ev.target;
      if (!t || !t.getAttribute) return;
      var id = t.getAttribute("data-emails-version");
      if (id && rows[id]) return setVersion(rows[id], String(t.value || ""));
      if (t.getAttribute("data-emails-for")) return setShowFor(String(t.value || ""));
    });

    // A link on another card: data-allemails-open="<group id>".
    var view = doc.getElementById("view-fundraising");
    (view || doc).addEventListener("click", function (ev) {
      var t = ev.target && ev.target.closest ? ev.target.closest("[data-allemails-open]") : null;
      if (!t) return;
      open(t.getAttribute("data-allemails-open"), {
        emailId: t.getAttribute("data-allemails-email") || undefined,
        touchKind: t.getAttribute("data-allemails-touch") || undefined,
        fundraiserId: t.getAttribute("data-allemails-fundraiser") || undefined,
      });
    });

    // The list is fetched when the card is first opened; every open email is fitted again when the
    // card or one of its groups opens, or the window changes width.
    function fitAll() {
      Object.keys(rows).forEach(function (key) {
        if (rows[key].built && !rows[key].panel.hidden) fit(rows[key]);
      });
    }
    var fold = el("frAllEmailsFold");
    if (fold) {
      fold.addEventListener("toggle", function () {
        if (!fold.open) return;
        if (listState === "ok") return fitAll();
        say(el("frAllEmailsStatus"), "", false);
        loadList();
      });
    }
    // A group's own toggle does not bubble, so it is caught on the way down.
    card.addEventListener("toggle", fitAll, true);
    if (win.addEventListener) win.addEventListener("resize", fitAll);

    // The count whenever the Fundraising section is shown (app.js un-hides it).
    var Observer = win.MutationObserver;
    if (view && Observer) {
      new Observer(function () {
        if (!view.hidden) loadSummary();
      }).observe(view, { attributes: true, attributeFilter: ["hidden"] });
    }
    return { loadSummary: loadSummary, open: open };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { initAdminAllEmails: initAdminAllEmails };
  } else if (typeof document !== "undefined") {
    var api = initAdminAllEmails(document, window);
    window.AdminAllEmails = api;
    var view = document.getElementById("view-fundraising");
    if (api && view && !view.hidden) api.loadSummary();
  }
})();
