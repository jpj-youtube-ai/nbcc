/* NBCC Elf Detective School: Head Elf HQ, its own admin section (Admin > Content > Elf Detective School,
 * #view-elf in admin.html). Design: docs/superpowers/specs/2026-11-05-elf-admin-design.md.
 *
 * The school runs itself; this is where head elves (Jodie, the Head Elf, and whoever is given the "elf"
 * section in the Team matrix) see that it is going right and step in. A game's menu screen: big tiles
 * for HQ, Families, Money and Settings, each opening its part below. The open part is remembered for
 * the browser tab, as the admin remembers its open section.
 *
 * Its own file beside app.js, as assets/js/admin/red-bag-list.js is: it fills #elfHq, reads the signed
 * in person's token the way app.js keeps it, and asks /api/admin/elf/* (src/routes/admin-elf.ts).
 * app.js only shows the view and calls open(). Everything from the server is put on the page as text,
 * never as markup. Status words use is-ok and is-error, never .err, which the public stylesheet hides.
 *
 * A classic <script defer>, exported under a CommonJS guard so it can be unit tested in jsdom
 * (test/unit/admin-elf-hq-js.test.ts).
 */
(function () {
  "use strict";

  var TOKEN_KEY = "nbcc_admin_token";
  var TAB_KEY = "nbcc_elf_hq_tab";
  var PAPER = "/assets/img/elf/paper/";
  var LOGO = "/assets/img/elf-detective-school.webp";
  var TABS = [
    { id: "hq", name: "HQ", icon: PAPER + "icons/icon-bell.webp" },
    { id: "families", name: "Families", icon: PAPER + "icons/icon-friend.webp" },
    { id: "money", name: "Money", coin: true },
    { id: "settings", name: "Settings", icon: PAPER + "icons/icon-paint.webp" },
  ];
  var WORDS = {
    loading: "Loading…",
    didNotWork: "That did not work. Please try again.",
    signedOut: "Your session has ended. Please sign in again.",
  };

  function initElfHq(doc, win, opts) {
    opts = opts || {};
    var mount = doc.getElementById("elfHq");
    var view = doc.getElementById("view-elf");
    if (!mount) return { open: function () { return Promise.resolve(); }, show: function () {} };

    var data = null;

    // ---- small helpers ----
    function el(tag, attrs, kids) {
      var n = doc.createElement(tag);
      Object.keys(attrs || {}).forEach(function (k) {
        if (k === "text") n.textContent = attrs[k];
        else if (attrs[k] === true) n.setAttribute(k, "");
        else if (attrs[k] !== false && attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, String(attrs[k]));
      });
      (kids || []).forEach(function (kid) {
        if (kid === null || kid === undefined || kid === false) return;
        n.appendChild(typeof kid === "string" ? doc.createTextNode(kid) : kid);
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
    function remembered(key) {
      try {
        return win.sessionStorage.getItem(key);
      } catch (e) {
        return null;
      }
    }
    function remember(key, value) {
      try {
        if (value === null) win.sessionStorage.removeItem(key);
        else win.sessionStorage.setItem(key, value);
      } catch (e) {
        /* a private window: nothing is remembered, and nothing breaks */
      }
    }
    /** A request to the admin's API: resolves with the answer, or rejects with the server's own words. */
    function ask(method, url, body) {
      var init = { method: method, headers: { Authorization: "Bearer " + token() } };
      if (body !== undefined) {
        init.headers["Content-Type"] = "application/json";
        init.body = JSON.stringify(body);
      }
      return win.fetch(url, init).then(function (res) {
        if (res.status === 401) {
          // The session has gone: back to the sign in, as app.js does for its own requests.
          remember(TOKEN_KEY, null);
          if (win.location && typeof win.location.reload === "function") win.location.reload();
          throw new Error(WORDS.signedOut);
        }
        return Promise.resolve(res.json())
          .catch(function () {
            return {};
          })
          .then(function (d) {
            if (!res.ok) throw new Error((d && d.error) || WORDS.didNotWork);
            return d || {};
          });
      });
    }
    /** Words in a status line: good news (true), an error (false), or just news (null). */
    function say(target, words, ok) {
      target.textContent = words;
      target.classList.toggle("is-ok", ok === true && !!words);
      target.classList.toggle("is-error", ok === false && !!words);
    }

    // ---- the frame: title, status line, the menu and a part for each tile ----
    var stateChip = el("span", { class: "hq-state", "aria-live": "polite" });
    var status = el("p", { class: "hq-status", role: "status" });
    var menu = el("ul", { class: "hq-menu", role: "tablist", "aria-label": "Elf Detective School" });
    var tabs = {};
    var counts = {};
    var parts = {};
    TABS.forEach(function (t) {
      // The coin's pound sign is drawn by the stylesheet, so the tile's name stays just "Money".
      var art = t.coin ? el("span", { class: "hq-coin", "aria-hidden": "true" }) : el("img", { src: t.icon, alt: "", width: 40, height: 40 });
      var count = el("span", { class: "hq-count", hidden: true });
      var tab = el("button", { class: "hq-tab", type: "button", role: "tab", id: "hqTab-" + t.id, "aria-selected": "false", "aria-controls": "hqPart-" + t.id, "data-tab": t.id }, [art, t.name, count]);
      tab.addEventListener("click", function () {
        show(t.id);
      });
      tabs[t.id] = tab;
      counts[t.id] = count;
      parts[t.id] = el("section", { class: "hq-part", role: "tabpanel", id: "hqPart-" + t.id, "aria-labelledby": "hqTab-" + t.id, "data-tab": t.id, hidden: true }, [el("p", { class: "hq-loading", text: WORDS.loading })]);
      menu.appendChild(el("li", { role: "presentation" }, [tab]));
    });
    var root = el("div", { class: "hq-root" }, [
      el("div", { class: "hq-title" }, [
        el("img", { src: LOGO, alt: "", width: 72, height: 72 }),
        el("div", {}, [el("h1", { text: "Elf Detective School" }), el("p", { text: "Head Elf HQ" })]),
        stateChip,
      ]),
      menu,
      status,
    ]);
    TABS.forEach(function (t) {
      root.appendChild(parts[t.id]);
    });
    mount.textContent = "";
    mount.appendChild(root);

    /** A count on a tile (the names waiting for a tick on Families), or none. */
    function tileCount(id, n) {
      var c = counts[id];
      if (!c) return;
      var name = TABS.filter(function (t) { return t.id === id; })[0].name;
      c.hidden = !(n > 0);
      c.textContent = n > 0 ? String(n) : "";
      if (n > 0) tabs[id].setAttribute("aria-label", name + ", " + n + " waiting");
      else tabs[id].removeAttribute("aria-label");
    }

    /** Opens one tile's part and remembers it for the browser tab. */
    function show(id) {
      if (!parts[id]) id = "hq";
      TABS.forEach(function (t) {
        tabs[t.id].setAttribute("aria-selected", String(t.id === id));
        tabs[t.id].tabIndex = t.id === id ? 0 : -1;
        parts[t.id].hidden = t.id !== id;
      });
      remember(TAB_KEY, id);
    }

    // Arrow keys move along the tiles, as a tab list's keys do.
    menu.addEventListener("keydown", function (e) {
      var order = TABS.map(function (t) { return t.id; });
      var at = order.indexOf(e.target && e.target.getAttribute ? e.target.getAttribute("data-tab") : "");
      if (at < 0) return;
      var next = e.key === "ArrowRight" ? at + 1 : e.key === "ArrowLeft" ? at - 1 : e.key === "Home" ? 0 : e.key === "End" ? order.length - 1 : null;
      if (next === null) return;
      e.preventDefault();
      next = (next + order.length) % order.length;
      show(order[next]);
      tabs[order[next]].focus();
    });

    /** Draws everything from the latest answer. Each part's drawing arrives with its task. */
    function draw() {
      if (!data) return;
      var on = !!(data.settings && data.settings.schoolOn);
      stateChip.textContent = on ? "Live" : "Switched off";
      stateChip.classList.toggle("is-live", on);
      tileCount("families", data.numbers ? data.numbers.namesToCheck : 0);
    }

    /** Reads HQ afresh: called by app.js whenever the section is opened. */
    function open() {
      say(status, WORDS.loading, null);
      return ask("GET", "/api/admin/elf/hq")
        .then(function (d) {
          data = d;
          say(status, "", null);
          draw();
        })
        .catch(function (e) {
          say(status, e.message, false);
        });
    }

    show(remembered(TAB_KEY) || "hq");

    // Shown already (app.js opened this section before this file had run): read it now.
    var app = doc.getElementById("appView");
    if (view && !view.hidden && (!app || !app.hidden)) open();

    return { open: open, show: show, ask: ask, say: say, tileCount: tileCount };
  }

  if (typeof module !== "undefined" && module.exports) module.exports = { initElfHq: initElfHq };
  else window.AdminElfHq = initElfHq(document, window);
})();
