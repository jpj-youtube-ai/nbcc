/* NBCC Workshop drop-offs: Admin > Giving > Workshop drop-offs (#view-drop-offs in admin.html).
 * Design: docs/superpowers/specs/2026-11-28-workshop-dropoffs-design.md.
 *
 * Everyone who left their details on the workshop tablet at /workshop, newest first: who, when, what
 * they brought, who they are with, how to reach them, whether they joined the newsletter, and whether
 * a thank-you letter has gone since. Write a thank you letter opens Admin > Thank you with the letter
 * already filled in as a gift in kind (window.AdminThankYou, from app.js). Remove asks first, for a
 * test or nonsense entry. No permission of its own: view of Donations sees it; the server says what
 * else to offer (mayRemove, mayWriteLetter) and checks again when it is used.
 *
 * Its own file beside app.js, as sleigh.js is: app.js only shows the view and calls open().
 * Everything from the server goes on the page as text, never as markup.
 *
 * A classic <script defer>, exported under a CommonJS guard so it can be unit tested in jsdom
 * (test/unit/admin-drop-offs-js.test.ts).
 */
(function () {
  "use strict";

  var TOKEN_KEY = "nbcc_admin_token";
  var API = "/api/admin/drop-offs";
  var WORDS = {
    loading: "Loading…",
    failed: "The workshop drop-offs could not load. Please try again.",
    removeFailed: "That did not work. Please try again.",
    signedOut: "Your session has ended. Please sign in again.",
    none: "Nobody has left their details on the workshop tablet yet.",
  };
  var LONDON = "Europe/London";

  /** "Sat 28 Nov" in UK time. */
  function dayWords(iso) {
    return new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: LONDON }).replace(",", "");
  }
  /** "2.15pm" in UK time. */
  function timeWords(iso) {
    var parts = new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: LONDON }).split(":");
    var h = Number(parts[0]);
    var m = Number(parts[1]);
    return (h % 12 === 0 ? 12 : h % 12) + (m ? "." + String(m).padStart(2, "0") : "") + (h < 12 ? "am" : "pm");
  }

  function initAdminDropOffs(doc, win) {
    var mount = doc.getElementById("dropOffsAdmin");
    if (!mount) return { open: function () { return Promise.resolve(); } };

    var data = null;
    var asking = null; // the id whose Remove is being asked about

    function el(tag, attrs, kids) {
      var n = doc.createElement(tag);
      Object.keys(attrs || {}).forEach(function (k) {
        if (k === "text") n.textContent = attrs[k];
        else if (attrs[k] !== false && attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, String(attrs[k]));
      });
      (kids || []).forEach(function (c) {
        if (c) n.appendChild(c);
      });
      return n;
    }
    function token() {
      try {
        return win.sessionStorage.getItem(TOKEN_KEY);
      } catch (e) {
        return null;
      }
    }
    function api(url, method) {
      return win.fetch(url, { method: method || "GET", headers: { Authorization: "Bearer " + token() } }).then(function (res) {
        if (res.status === 401) throw new Error(WORDS.signedOut);
        return res.json().then(function (body) {
          if (!res.ok) throw new Error((body && body.error) || WORDS.failed);
          return body;
        });
      });
    }
    function say(text, kind) {
      var p = el("p", { class: "admin-action-status" + (kind ? " is-" + kind : ""), role: "status", text: text });
      mount.replaceChildren(p);
    }

    function fact(label, value) {
      if (!value) return null;
      return el("p", { class: "do-fact" }, [el("span", { class: "do-fact__label", text: label + " " }), doc.createTextNode(value)]);
    }

    function card(d) {
      var marks = el("p", { class: "do-marks" }, [
        d.newsletter ? el("span", { class: "ak-mark ak-mark--ok", text: "On the newsletter" }) : null,
        d.letterSentAt
          ? el("span", { class: "ak-mark ak-mark--ok", text: "Letter sent " + dayWords(d.letterSentAt) })
          : el("span", { class: "ak-mark ak-mark--wait", text: "No letter yet" }),
      ]);
      var actions = el("div", { class: "ak-actions" }, [
        data.mayWriteLetter ? el("button", { class: "admin-btn", type: "button", "data-do-letter": d.id, text: "Write a thank you letter" }) : null,
        data.mayRemove ? el("button", { class: "admin-btn ak-btn--danger", type: "button", "data-do-remove": d.id, text: "Remove" }) : null,
      ]);
      var ask =
        asking === d.id
          ? el("div", { class: "ak-notice ak-notice--bad do-ask", role: "alert" }, [
              el("p", { text: "Remove " + d.name + "'s drop-off? This cannot be undone." }),
              el("div", { class: "ak-actions" }, [
                el("button", { class: "admin-btn ak-btn--danger", type: "button", "data-do-yes": d.id, text: "Yes, remove it" }),
                el("button", { class: "admin-btn ak-btn--plain", type: "button", "data-do-no": d.id, text: "No, keep it" }),
              ]),
            ])
          : null;
      return el("li", { class: "ak-card do-card" }, [
        el("p", { class: "do-when", text: dayWords(d.createdAt) + ", " + timeWords(d.createdAt) }),
        el("h3", { class: "do-name", text: d.name }),
        el("p", { class: "do-brought", text: d.brought }),
        fact("With:", d.groupName),
        fact("Email:", d.email),
        fact("Mobile:", d.phone),
        marks,
        actions.childNodes.length ? actions : null,
        ask,
      ]);
    }

    function render() {
      var rows = (data && data.dropOffs) || [];
      if (!rows.length) {
        mount.replaceChildren(el("p", { class: "admin-empty", text: WORDS.none }));
        return;
      }
      mount.replaceChildren(el("ul", { class: "ak-list do-list" }, rows.map(card)));
    }

    function byId(id) {
      return ((data && data.dropOffs) || []).filter(function (d) {
        return String(d.id) === String(id);
      })[0];
    }

    function load() {
      say(WORDS.loading);
      return api(API)
        .then(function (body) {
          data = body;
          asking = null;
          render();
        })
        .catch(function (err) {
          say(err && err.message ? err.message : WORDS.failed, "error");
        });
    }

    mount.addEventListener("click", function (ev) {
      var b = ev.target && ev.target.closest ? ev.target.closest("button") : null;
      if (!b) return;
      var d;
      if (b.hasAttribute("data-do-letter")) {
        d = byId(b.getAttribute("data-do-letter"));
        if (d && win.AdminThankYou) win.AdminThankYou.writeInKind({ name: d.name, email: d.email, brought: d.brought });
      } else if (b.hasAttribute("data-do-remove")) {
        asking = Number(b.getAttribute("data-do-remove"));
        render();
      } else if (b.hasAttribute("data-do-no")) {
        asking = null;
        render();
      } else if (b.hasAttribute("data-do-yes")) {
        b.disabled = true;
        api(API + "/" + encodeURIComponent(b.getAttribute("data-do-yes")), "DELETE")
          .then(load)
          .catch(function (err) {
            say(err && err.message ? err.message : WORDS.removeFailed, "error");
          });
      }
    });

    return { open: load };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { initAdminDropOffs: initAdminDropOffs };
  } else {
    window.AdminDropOffs = initAdminDropOffs(document, window);
  }
})();
