// Sponsor pledges in Admin > Fundraising (Jaimie, 2026-10-03). Its own file beside app.js, so each
// can change without the other: it finds its card (#frPledges in admin.html), reads the signed in
// person's token the same way app.js keeps it, and asks its own API (src/routes/pledges.ts).
//
//   - the bar: "£X pledged, £Y paid", and how many are still unpaid two weeks after their event;
//   - each fundraiser with pledges: every pledge with the sponsor's name and email (staff only),
//     the amount, where it is up to, and for an editor: Send (or Resend) pay link, Cancel pledge,
//     Hide message, and Mark as checked on one that was paid twice;
//   - for an admin: "Send new pay links to everyone unpaid", for when the links already emailed have
//     stopped working (the signing secret was changed);
//   - whether the two emails to sponsors are being sent, with a link to read and approve them in the
//     All emails card (assets/js/admin/all-emails.js). Both are new wording: neither is sent until
//     an admin approves it there, as with the automatic emails to organisers.
// The server enforces every rule; the role in the token only decides which buttons are offered.
// Everything a person typed is written as text, never as markup.
//
// A classic <script defer>, exported under a CommonJS guard so it can be unit tested in jsdom.
(function () {
  "use strict";

  var TOKEN_KEY = "nbcc_admin_token";
  var MSG = {
    failed: "Sponsor pledges could not load just now. Try again in a moment.",
    did: "That did not work. Please try again.",
  };

  function initAdminPledges(doc, win) {
    var card = doc.getElementById("frPledges");
    if (!card) return null;
    var H = win.AdminHelpers || {};
    var data = null;
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
    function token() {
      try {
        return win.sessionStorage.getItem(TOKEN_KEY);
      } catch (e) {
        return null;
      }
    }
    function role() {
      var claims = H.parseClaims ? H.parseClaims(token()) : null;
      return claims && claims.role ? claims.role : "viewer";
    }
    function canEdit() {
      return role() === "admin" || role() === "editor";
    }
    function isAdmin() {
      return role() === "admin";
    }
    function money(pence) {
      var n = Number(pence) || 0;
      var whole = n % 100 === 0;
      return "£" + (n / 100).toLocaleString("en-GB", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
    }
    function day(iso) {
      if (!iso) return "";
      return H.fmtDate ? H.fmtDate(iso) : String(iso).slice(0, 10);
    }
    function who(actor) {
      var a = String(actor || "");
      return a.indexOf("admin:") === 0 ? a.slice(6) : a || "unknown";
    }
    function say(text, error) {
      var line = el("frPledgesStatus");
      if (!line) return;
      line.textContent = text;
      line.className = "ty-status" + (error ? " is-error" : text ? " is-ok" : "");
    }

    function call(method, path, body) {
      var t = token();
      if (!t) return Promise.reject(new Error("signed out"));
      var opts = { method: method, headers: { Authorization: "Bearer " + t } };
      if (body !== undefined) {
        opts.headers["Content-Type"] = "application/json";
        opts.body = JSON.stringify(body);
      }
      return win.fetch(path, opts).then(function (res) {
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

    // --- the bar and the list ----------------------------------------------------------------------
    function stateWords() {
      var t = data.totals || {};
      if (!data.fundraisers || !data.fundraisers.length) return "No pledges yet.";
      var words = money(t.pledgedPence) + " pledged, " + money(t.paidPence) + " paid.";
      var late = Number(data.unpaidTwoWeeks) || 0;
      if (late) words += " " + late + (late === 1 ? " pledge" : " pledges") + " unpaid 2 weeks after the event.";
      var twice = Number(data.paidTwice) || 0;
      if (twice) words += " " + twice + (twice === 1 ? " pledge" : " pledges") + " paid twice: check and refund.";
      return words;
    }

    function button(label, attr, id, quiet) {
      var b = make("button", "admin-btn admin-btn--small" + (quiet ? " fr-btn-quiet" : ""), label);
      b.type = "button";
      b.setAttribute(attr, String(id));
      b.disabled = busy;
      return b;
    }

    function pledgeRow(p) {
      var row = make("li", "fr-pledge-row is-" + p.status);
      row.setAttribute("data-pledge", String(p.id));
      var head = make("p", "fr-pledge-row__head");
      head.appendChild(make("b", "", p.name));
      head.appendChild(make("span", "fr-pledge-row__amount", money(p.amountPence)));
      row.appendChild(head);
      if (p.email) row.appendChild(make("p", "fr-pledge-row__email", p.email));
      var paidMore = p.status === "paid" && p.paidAmountPence != null && Number(p.paidAmountPence) !== Number(p.amountPence);
      var state = p.statusWords + (paidMore ? ", " + money(p.paidAmountPence) : "");
      var facts = [state, "Pledged " + day(p.createdAt)];
      if (p.giftAid) facts.push("Gift Aid declared");
      if (p.payEmailSentAt) facts.push("Pay link sent " + day(p.payEmailSentAt));
      if (p.reminderSentAt) facts.push("Reminder sent " + day(p.reminderSentAt));
      row.appendChild(make("p", "fr-pledge-row__facts", facts.join(". ") + "."));
      if (p.hidden) facts.push("Hidden from the page by the organiser");
      row.lastChild.textContent = facts.join(". ") + ".";
      if (p.message) row.appendChild(make("p", "fr-pledge-row__msg", (p.messageHidden ? "Hidden from the page: " : "") + "“" + p.message + "”"));
      if (p.paidTwice) row.appendChild(make("p", "fr-touch-signoff fr-pledge-row__twice", "Paid twice: check the payments and refund the extra one."));
      if (canEdit()) {
        var actions = make("div", "fx-call-row fr-pledge-row__actions");
        if (p.paidTwice) actions.appendChild(button("Mark as checked", "data-pledge-checked", p.id, false));
        if (p.canSend) actions.appendChild(button(p.payEmailSentAt ? "Resend pay link" : "Send pay link", "data-pledge-send", p.id, false));
        if (p.canCancel) actions.appendChild(button("Cancel pledge", "data-pledge-cancel", p.id, true));
        if (p.message) actions.appendChild(button(p.messageHidden ? "Show message" : "Hide message", p.messageHidden ? "data-pledge-show" : "data-pledge-hide", p.id, true));
        if (actions.firstChild) row.appendChild(actions);
      }
      return row;
    }

    function fundraiserGroup(f) {
      var group = make("div", "fr-pledge-group");
      group.setAttribute("data-pledge-fundraiser", String(f.id));
      var t = f.totals || {};
      group.appendChild(make("h4", "fr-card-subhead", f.title + ", " + f.organiser));
      var late = Number(f.unpaidTwoWeeks) || 0;
      group.appendChild(
        make(
          "p",
          "fr-touch-due",
          money(t.pledgedPence) + " pledged, " + money(t.paidPence) + " paid" +
            (t.cashCount ? ", " + money(t.cashPence) + " paid in cash" : "") +
            (t.openCount ? ", " + money(t.openPence) + " still to be paid" : "") +
            "." +
            (f.payDue ? " Pay link due " + day(f.payDue) + "." : " No date: the pay link goes when you mark it finished.") +
            (late ? " " + late + " unpaid 2 weeks after the event." : ""),
        ),
      );
      var ol = make("ol", "fr-pledge-rows");
      ol.setAttribute("role", "list");
      (f.pledges || []).forEach(function (p) {
        ol.appendChild(pledgeRow(p));
      });
      group.appendChild(ol);
      return group;
    }

    function drawList() {
      var list = el("frPledgesList");
      if (!list) return;
      while (list.firstChild) list.removeChild(list.firstChild);
      if (!data.fundraisers || !data.fundraisers.length) {
        list.appendChild(make("p", "fr-card-intro", "Nobody has pledged yet. Pledges will show here, by fundraiser."));
        return;
      }
      data.fundraisers.forEach(function (f) {
        list.appendChild(fundraiserGroup(f));
      });
    }

    // --- the two emails: are they going? Reading and approving them is in All emails. ---------------
    function drawEmailsState() {
      var state = el("frPledgesEmailsState");
      if (!state) return;
      var emails = data.emails || {};
      var waiting = (emails.kinds || []).filter(function (k) {
        return !k.approval;
      }).length;
      var words = emails.on
        ? "Automatic emails are switched on. The pay link and the reminder are each sent only once their wording is approved."
        : "Automatic emails are switched off, so the pay link and the reminder are not being sent.";
      if (emails.approvalsUnavailable) words += " Couldn't check sign-offs just now, so both are held.";
      else if (waiting) words += " " + (waiting === 1 ? "1 is" : "Both are") + " waiting for sign off.";
      state.textContent = words;
    }

    // --- loading -----------------------------------------------------------------------------------
    function load() {
      if (!token()) return Promise.resolve(null);
      return call("GET", "/api/admin/fundraising/pledges")
        .then(function (r) {
          if (r.status === 403) {
            card.hidden = true;
            return null;
          }
          if (r.status !== 200 || !r.data || !r.data.emails) throw new Error("failed");
          data = r.data;
          card.hidden = false;
          el("frPledgesState").textContent = stateWords();
          var tools = el("frPledgesTools");
          if (tools) tools.hidden = !isAdmin();
          drawList();
          drawEmailsState();
        })
        .catch(function () {
          data = null;
          card.hidden = false;
          var state = el("frPledgesState");
          if (state) state.textContent = MSG.failed;
        });
    }

    function sendAll() {
      if (busy) return Promise.resolve();
      busy = true;
      say("Sending…", false);
      return call("POST", "/api/admin/fundraising/pledges/send-pay-links")
        .then(function (r) {
          busy = false;
          if (r.status !== 200) return say(r.data.error || MSG.did, true);
          var n = Number(r.data.sent) || 0;
          var words = "New pay links sent to " + n + (n === 1 ? " sponsor." : " sponsors.");
          if (r.data.skipped) words += " " + r.data.skipped + " held back.";
          if (r.data.failed) words += " " + r.data.failed + " failed: try again in a few minutes.";
          return Promise.resolve(load()).then(function () {
            say(words, !!r.data.failed);
          });
        })
        .catch(function () {
          busy = false;
          say(MSG.did, true);
        });
    }

    function act(method, path, body, done) {
      if (busy) return Promise.resolve();
      busy = true;
      say("Saving…", false);
      return call(method, path, body)
        .then(function (r) {
          busy = false;
          if (r.status !== 200) {
            drawList();
            return say(r.data.error || MSG.did, true);
          }
          return Promise.resolve(load()).then(function () {
            say(done, false);
          });
        })
        .catch(function () {
          busy = false;
          say(MSG.did, true);
        });
    }

    card.addEventListener("click", function (ev) {
      var t = ev.target && ev.target.closest ? ev.target.closest("button") : null;
      if (!t || !card.contains(t)) return;
      var id;
      if ((id = t.getAttribute("data-pledge-send"))) return act("POST", "/api/admin/pledges/" + encodeURIComponent(id) + "/send-pay-link", undefined, "Pay link sent.");
      if ((id = t.getAttribute("data-pledge-cancel"))) {
        if (win.confirm && !win.confirm("Cancel this pledge? The sponsor will not be emailed about it again. No money has been taken.")) return;
        return act("POST", "/api/admin/pledges/" + encodeURIComponent(id) + "/cancel", undefined, "Pledge cancelled.");
      }
      if ((id = t.getAttribute("data-pledge-checked"))) return act("POST", "/api/admin/pledges/" + encodeURIComponent(id) + "/checked", undefined, "Marked as checked.");
      if (t.id === "frPledgesSendAll") {
        if (win.confirm && !win.confirm("Send a new pay link to every sponsor who has had one and has not paid? Use this after the links already sent have stopped working.")) return;
        return sendAll();
      }
      if ((id = t.getAttribute("data-pledge-hide"))) return act("POST", "/api/admin/pledges/" + encodeURIComponent(id) + "/message", { hidden: true }, "Message hidden from the page.");
      if ((id = t.getAttribute("data-pledge-show"))) return act("POST", "/api/admin/pledges/" + encodeURIComponent(id) + "/message", { hidden: false }, "Message showing on the page again.");
    });

    // Load whenever the Fundraising section is shown (app.js un-hides it), and now if it already is.
    var view = doc.getElementById("view-fundraising");
    // A sign off changed in All emails: say again whether the two emails are going.
    if (view) {
      view.addEventListener("nbcc:wording-changed", function () {
        if (data) load();
      });
    }
    var Observer = win.MutationObserver;
    if (view && Observer) {
      new Observer(function () {
        if (!view.hidden) load();
      }).observe(view, { attributes: true, attributeFilter: ["hidden"] });
    }
    return { load: load };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { initAdminPledges: initAdminPledges };
  } else if (typeof document !== "undefined") {
    var api = initAdminPledges(document, window);
    var view = document.getElementById("view-fundraising");
    if (api && view && !view.hidden) api.load();
  }
})();
