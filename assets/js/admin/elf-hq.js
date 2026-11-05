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

    // ---- words for numbers, money and days ----
    function pounds(pence) {
      var p = Math.max(0, Math.round(Number(pence) || 0));
      var whole = p % 100 === 0;
      return "£" + (p / 100).toLocaleString("en-GB", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 });
    }
    function plural(n, one, many) {
      return n === 1 ? one : many;
    }
    function whenWords(iso) {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return "";
      var day = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/London" }).format(d).replace(/,/g, "");
      var time = new Intl.DateTimeFormat("en-GB", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Europe/London" }).format(d).replace(/\s/g, "").toLowerCase();
      return day + ", " + time;
    }
    /** A paper rosette with a number or a word on it: the scallops in `ring`, the middle in `disc`. */
    function rosette(ring, disc, words) {
      var r = el("span", { class: "hq-rosette", "aria-hidden": "true" });
      r.innerHTML =
        '<svg viewBox="0 0 100 100"><path fill="' + ring + '" stroke="#3A0B0B" stroke-width="2.5" d="M50 3l7 9 11-4 3 11 11 2-2 11 9 7-6 9 6 9-9 7 2 11-11 2-3 11-11-4-7 9-7-9-11 4-3-11-11-2 2-11-9-7 6-9-6-9 9-7-2-11 11-2 3-11 11 4z"/>' +
        '<circle cx="50" cy="50" r="31" fill="' + disc + '" stroke="#FFF8EF" stroke-width="1.6" stroke-dasharray="3.2 2.6"/></svg>';
      // Three figures (or a word) need a smaller size to sit inside the disc.
      r.appendChild(el("b", { text: words, class: words.length >= 4 ? "is-longer" : words.length === 3 ? "is-long" : null }));
      return r;
    }

    // ---- HQ ----
    var QUEST_ICONS = { names: PAPER + "icons/icon-friend.webp", preview: PAPER + "icons/icon-lock.webp", waiting: PAPER + "icons/icon-bell.webp" };
    var familyFilter = "all";
    var confirming = null; // the lever's second ask, while it is showing

    function drawSwitch(box) {
      var s = data.settings || {};
      var on = !!s.schoolOn;
      var lever = el("button", { class: "hq-lever", type: "button", role: "switch", id: "hqLever", "aria-checked": String(on), "aria-label": "The school's switch", disabled: !data.canSwitch }, [
        el("span", { class: "hq-lever__words", "aria-hidden": "true", text: on ? "ON" : "OFF" }),
        el("span", { class: "hq-lever__knob" }, [el("img", { src: PAPER + "deco/bauble.webp", alt: "", width: 52, height: 52 })]),
      ]);
      var words = el("div", {}, [
        el("h2", { class: "hq-h2", text: on ? "The school is live" : "The school is switched off" }),
        el("p", { class: "hq-words hq-soft", text: on ? "Anyone can find it and enrol." : s.previewOn ? "Families cannot see it yet. Your private preview link can." : "Families cannot see it yet." }),
      ]);
      box.appendChild(lever);
      box.appendChild(words);
      if (!data.canSwitch) box.appendChild(el("p", { class: "hq-words hq-soft hq-switchbox__who", text: "Only an admin can switch the school on or off." }));
      lever.addEventListener("click", function () {
        if (confirming) return;
        var turnOn = !on;
        var yes = el("button", { class: "hq-btn hq-btn--small " + (turnOn ? "hq-btn--go" : "hq-btn--danger"), type: "button", text: turnOn ? "Yes, switch it on" : "Yes, switch it off" });
        var no = el("button", { class: "hq-btn hq-btn--small", type: "button", text: turnOn ? "Not yet" : "Keep it on" });
        confirming = el("div", { class: "hq-confirm", role: "group", "aria-label": "Are you sure?" }, [
          el("p", { class: "hq-words", text: turnOn ? "Switch it on for everyone? Sign ups open straight away and anyone can find the school." : "Switch it off? Families cannot see the school or sign in while it is off." }),
          yes,
          no,
        ]);
        box.appendChild(confirming);
        yes.focus();
        no.addEventListener("click", function () {
          confirming.remove();
          confirming = null;
          lever.focus();
        });
        yes.addEventListener("click", function () {
          yes.disabled = true;
          no.disabled = true;
          ask("PATCH", "/api/admin/elf/settings", { schoolOn: turnOn })
            .then(function (d) {
              data.settings = d.settings;
              confirming = null;
              draw();
              say(status, turnOn ? "The school is live." : "The school is switched off.", true);
              var again = doc.getElementById("hqLever");
              if (again) again.focus();
            })
            .catch(function (e) {
              if (confirming) confirming.remove();
              confirming = null;
              say(status, e.message, false);
            });
        });
      });
    }

    function drawQuests(box) {
      box.appendChild(el("h2", { class: "hq-h2", text: "Needs you" }));
      var quests = data.quests || [];
      if (!quests.length) {
        box.appendChild(el("p", { class: "hq-words hq-quiet" }, [el("span", { class: "hq-tick", "aria-hidden": "true" }), "Nothing needs you. The school is running itself."]));
        return;
      }
      var list = el("ul", { class: "hq-quests" });
      quests.forEach(function (q) {
        var icon = el("span", { class: "hq-quest__icon" }, [el("img", { src: QUEST_ICONS[q.id] || QUEST_ICONS.waiting, alt: "", width: 38, height: 38 })]);
        if (q.count) icon.appendChild(el("span", { class: "hq-count", text: String(q.count) }));
        var item = el("li", { class: "hq-quest" }, [icon, el("div", {}, [el("h3", { class: "hq-h3", text: q.title }), el("p", { class: "hq-words hq-soft", text: q.words })])]);
        if (q.button && q.go) {
          var go = el("button", { class: "hq-btn hq-btn--small", type: "button", text: q.button });
          go.addEventListener("click", function () {
            if (q.filter) familyFilter = q.filter;
            show(q.go);
            if (tabs[q.go]) tabs[q.go].focus();
          });
          item.appendChild(go);
        }
        list.appendChild(item);
      });
      box.appendChild(list);
    }

    function drawMoney(box, withLink) {
      var n = data.numbers || {};
      var total = (n.entryPence || 0) + (n.giftPence || 0);
      box.appendChild(el("h2", { class: "hq-h2", text: "Raised so far" }));
      if (!total) {
        box.appendChild(el("p", { class: "hq-words hq-soft", text: "No payments yet." }));
        return;
      }
      box.appendChild(el("p", { class: "hq-money__total" }, [el("b", { text: pounds(total) }), el("span", { class: "hq-note", text: "and counting" })]));
      var bar = el("div", { class: "hq-bar", role: "img", "aria-label": pounds(n.entryPence) + " from entries and " + pounds(n.giftPence) + " in gifts" });
      [["is-entries", n.entryPence], ["is-gifts", n.giftPence]].forEach(function (p) {
        if (!(p[1] > 0)) return;
        var part = el("span", { class: p[0] });
        part.style.flexGrow = String(p[1]);
        bar.appendChild(part);
      });
      box.appendChild(bar);
      box.appendChild(el("p", { class: "hq-legend" }, [el("span", { class: "hq-chip hq-chip--crimson", text: "Entries " + pounds(n.entryPence) }), " ", el("span", { class: "hq-chip hq-chip--holly", text: "Gifts " + pounds(n.giftPence) })]));
      if (n.giftAidPence > 0) {
        box.appendChild(el("p", { class: "hq-words", text: pounds(n.giftAidPence) + " of the gifts came with Gift Aid, which could add about " + pounds(Math.round(n.giftAidPence / 4)) + " when we claim it." }));
      }
      if (withLink) {
        var more = el("button", { class: "hq-link", type: "button", text: "See the money" });
        more.addEventListener("click", function () {
          show("money");
          tabs.money.focus();
        });
        box.appendChild(el("p", {}, [more]));
      }
    }

    function drawRecruits(box) {
      var n = data.numbers || {};
      box.appendChild(el("h2", { class: "hq-h2", text: "Newest recruits" }));
      var recruits = data.recruits || [];
      if (!recruits.length) {
        box.appendChild(el("p", { class: "hq-words hq-soft", text: "No detectives yet. The first ones appear here as soon as a family pays." }));
        return;
      }
      box.appendChild(el("p", { class: "hq-words hq-soft", text: (n.families || 0) + " " + plural(n.families, "family", "families") + " and " + (n.detectives || 0) + " " + plural(n.detectives, "detective", "detectives") + " so far." }));
      var list = el("ul", { class: "hq-recruits" });
      recruits.forEach(function (r) {
        list.appendChild(
          el("li", { class: "hq-char" }, [
            el("span", { class: "hq-avatar" }, [el("img", { src: r.tile, alt: "", width: 84, height: 84, loading: "lazy" })]),
            el("b", { text: r.name }),
            r.badge ? el("small", { text: r.badge }) : null,
            r.approved ? null : el("span", { class: "hq-chip", text: "Name to check" }),
          ]),
        );
      });
      box.appendChild(list);
    }

    function drawClocks(row) {
      var days = Number(data.daysToFirstClue) || 0;
      var clue = el("div", { class: "hq-panel hq-clock" });
      if (days > 0) {
        clue.appendChild(rosette("#C02238", "#800000", String(days)));
        clue.appendChild(el("h3", { class: "hq-h3", text: plural(days, "day to the first clue", "days to the first clue") }));
      } else {
        var before = Date.now() < new Date(data.firstClueAt).getTime();
        clue.appendChild(rosette("#C02238", "#800000", before ? "Today" : "Open"));
        clue.appendChild(el("h3", { class: "hq-h3", text: before ? "The first clue is today" : "The doors are open" }));
      }
      clue.appendChild(el("p", { class: "hq-soft", text: whenWords(data.firstClueAt) }));
      var n = data.numbers || {};
      var who = el("div", { class: "hq-panel hq-clock" }, [
        rosette("#D9A93E", "#1A531A", String(n.detectives || 0)),
        el("h3", { class: "hq-h3", text: plural(n.detectives, "detective enrolled", "detectives enrolled") }),
        el("p", { class: "hq-soft", text: (n.families || 0) + " " + plural(n.families, "family", "families") }),
      ]);
      row.appendChild(clue);
      row.appendChild(who);
    }

    function drawHq() {
      var part = parts.hq;
      part.textContent = "";
      var row = el("div", { class: "hq-status-row" });
      var switchBox = el("div", { class: "hq-panel hq-switchbox" });
      drawSwitch(switchBox);
      row.appendChild(switchBox);
      drawClocks(row);
      part.appendChild(row);
      var pair = el("div", { class: "hq-pair" });
      var quests = el("section", { class: "hq-panel", "aria-label": "Needs you" });
      drawQuests(quests);
      var money = el("section", { class: "hq-panel hq-money", "aria-label": "Raised so far" });
      drawMoney(money, true);
      pair.appendChild(quests);
      pair.appendChild(money);
      part.appendChild(pair);
      var recruits = el("section", { class: "hq-panel", "aria-label": "Newest recruits" });
      drawRecruits(recruits);
      part.appendChild(recruits);
    }

    /** Draws everything from the latest answer. Each part's drawing arrives with its task. */
    function draw() {
      if (!data) return;
      var on = !!(data.settings && data.settings.schoolOn);
      stateChip.textContent = on ? "Live" : "Switched off";
      stateChip.classList.toggle("is-live", on);
      tileCount("families", data.numbers ? data.numbers.namesToCheck : 0);
      drawHq();
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
