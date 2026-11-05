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
      if (id === "families" && data) loadFamilies();
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

    function drawMoney(box, withLink, note) {
      var n = data.numbers || {};
      var total = (n.entryPence || 0) + (n.giftPence || 0);
      box.appendChild(el("h2", { class: "hq-h2", text: "Raised so far" }));
      if (!total) {
        box.appendChild(el("p", { class: "hq-words hq-soft", text: "No payments yet." }));
        return;
      }
      box.appendChild(el("p", { class: "hq-money__total" }, [el("b", { text: pounds(total) }), el("span", { class: "hq-note", text: note || "and counting" })]));
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

    // ---- Families: pick a family from the list, and its sheet opens beside it ----
    var FAMILY_KEY = "nbcc_elf_hq_family";
    var FILTER_NAMES = [["all", "All"], ["check", "Names to check"], ["week", "This week"], ["removed", "Removed"]];
    var fam = { list: null, total: 0, counts: null, sheet: null, surnames: [], q: "", timer: null, built: false, asked: 0 };
    var famBox, famSearch, famChips, famList, famMore, famSheet;

    function shortDay(iso) {
      var d = new Date(iso);
      return isNaN(d.getTime()) ? "" : new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" }).format(d);
    }
    function longDay(iso) {
      var d = new Date(iso);
      return isNaN(d.getTime()) ? "" : new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/London" }).format(d).replace(/,/g, "");
    }
    /** "admin:sam@example.org" as the person it names. */
    function who(actor) {
      return String(actor || "").replace(/^admin:/, "");
    }

    function buildFamilies() {
      if (fam.built) return;
      fam.built = true;
      var part = parts.families;
      part.textContent = "";
      famSearch = el("input", { type: "search", id: "hqFind", class: "hq-find", placeholder: "A name, an email or a badge number", autocomplete: "off" });
      famSearch.addEventListener("input", function () {
        if (fam.timer) win.clearTimeout(fam.timer);
        fam.timer = win.setTimeout(function () {
          fam.timer = null;
          fam.q = famSearch.value.trim();
          loadFamilies();
        }, 300);
      });
      famChips = el("div", { class: "hq-filters", role: "group", "aria-label": "Show" });
      famList = el("ul", { class: "hq-flist", "aria-label": "Families" });
      famMore = el("button", { class: "hq-btn hq-btn--small hq-more", type: "button", text: "Show more families", hidden: true });
      famMore.addEventListener("click", function () {
        loadFamilies(true);
      });
      famSheet = el("section", { class: "hq-panel hq-sheet", "aria-label": "The family", "aria-live": "polite" }, [el("p", { class: "hq-words hq-soft", text: "Pick a family to see its detectives and payments here." })]);
      famBox = el("div", { class: "hq-families" }, [
        el("div", { class: "hq-search" }, [el("label", { class: "hq-sr", for: "hqFind", text: "Find a family" }), famSearch, famChips, famList, famMore]),
        famSheet,
      ]);
      part.appendChild(famBox);
    }

    function familiesUrl(offset) {
      return "/api/admin/elf/families?filter=" + familyFilter + (fam.q ? "&q=" + encodeURIComponent(fam.q) : "") + (offset ? "&offset=" + offset : "");
    }

    /** Reads the list for the filter and search, or the next page of it. */
    function loadFamilies(more) {
      buildFamilies();
      var asked = ++fam.asked;
      return ask("GET", familiesUrl(more && fam.list ? fam.list.length : 0))
        .then(function (d) {
          if (asked !== fam.asked) return; // a later search has gone out since
          fam.list = more && fam.list ? fam.list.concat(d.families || []) : d.families || [];
          fam.total = d.total || 0;
          fam.counts = d.counts || null;
          drawChips();
          drawList();
        })
        .catch(function (e) {
          say(status, e.message, false);
        });
    }

    function drawChips() {
      famChips.textContent = "";
      FILTER_NAMES.forEach(function (f) {
        var count = fam.counts ? fam.counts[f[0]] || 0 : "";
        var chip = el("button", { class: "hq-filter", type: "button", "aria-pressed": String(familyFilter === f[0]) }, [f[1] + " ", el("span", { text: String(count) })]);
        chip.addEventListener("click", function () {
          familyFilter = f[0];
          loadFamilies();
        });
        famChips.appendChild(chip);
      });
    }

    function drawList() {
      famList.textContent = "";
      if (!fam.list.length) {
        famList.appendChild(el("li", { class: "hq-words hq-soft", text: fam.q ? "No family matches that." : familyFilter === "removed" ? "No family has been removed." : familyFilter === "check" ? "Every name has been ticked." : "No families yet." }));
      }
      fam.list.forEach(function (f) {
        var waiting = f.namesToCheck || 0;
        var chip = f.removed
          ? el("span", { class: "hq-chip hq-chip--crimson", text: "Removed" })
          : waiting
            ? el("span", { class: "hq-chip", text: waiting + plural(waiting, " name to check", " names to check") })
            : el("span", { class: "hq-chip hq-chip--holly", text: "All names ticked" });
        var faces = el("span", { class: "hq-stack", "aria-hidden": "true" });
        f.detectives.slice(0, 4).forEach(function (d) {
          faces.appendChild(el("img", { src: d.tile, alt: "", width: 46, height: 46, loading: "lazy" }));
        });
        var names = f.detectives.map(function (d) { return d.firstName; }).join(", ");
        var badges = f.detectives.map(function (d) { return d.badge; }).filter(Boolean).join(", ");
        var card = el("button", { class: "hq-fam", type: "button", "data-family": f.id, "aria-current": String(!!(fam.sheet && fam.sheet.id === f.id)) }, [
          faces,
          el("span", { class: "hq-fam__words" }, [el("b", { text: f.grownUpName }), el("small", { text: names + (badges ? " · " + badges : "") }), chip]),
        ]);
        card.addEventListener("click", function () {
          openFamily(f.id);
        });
        famList.appendChild(el("li", {}, [card]));
      });
      famMore.hidden = !(fam.list.length < fam.total);
    }

    /** Opens a family's sheet beside the list (in its place on a phone). */
    function openFamily(id) {
      buildFamilies();
      return ask("GET", "/api/admin/elf/families/" + id)
        .then(function (d) {
          fam.sheet = d.family;
          if (d.surnames) fam.surnames = d.surnames;
          drawSheet();
          if (fam.list) drawList();
          famBox.classList.add("is-open");
        })
        .catch(function (e) {
          say(status, e.message, false);
        });
    }

    /** One change to the open family, then the sheet and the list drawn again from the answer. */
    function changeFamily(method, url, body, done) {
      return ask(method, url, body).then(function (d) {
        if (d.family) fam.sheet = d.family;
        drawSheet();
        if (done) done(d);
        loadFamilies();
        return d;
      });
    }

    function drawSheet() {
      var f = fam.sheet;
      famSheet.textContent = "";
      if (!f) return;
      var said = el("p", { class: "hq-status", role: "status" });
      var back = el("button", { class: "hq-btn hq-btn--small hq-back", type: "button", text: "Back to families" });
      back.addEventListener("click", function () {
        famBox.classList.remove("is-open");
        var card = famList.querySelector('[data-family="' + f.id + '"]');
        if (card) card.focus();
      });
      famSheet.appendChild(back);

      // The grown up, and what can be done for them.
      var details = el("div", { class: "hq-sheet__details" });
      var facts = [f.email, "enrolled " + longDay(f.enrolledAt)];
      if (f.newsletter) facts.push("gets the newsletter");
      details.appendChild(el("h2", { class: "hq-h2", text: f.grownUpName }));
      details.appendChild(el("p", { class: "hq-words hq-soft", text: facts.join(" · ") }));
      if (f.removedAt) details.appendChild(el("p", { class: "hq-words hq-removed", text: "Removed on " + longDay(f.removedAt) + (f.removedBy ? " by " + who(f.removedBy) : "") + ". They cannot sign in, and they are left out of the counts and the money." }));
      var actions = el("div", { class: "hq-actions" });
      if (!f.removedAt) {
        var code = el("button", { class: "hq-btn hq-btn--small", type: "button", text: "Send a sign in code" });
        code.addEventListener("click", function () {
          code.disabled = true;
          ask("POST", "/api/admin/elf/families/" + f.id + "/sign-in-code")
            .then(function (d) {
              say(said, "We sent a sign in code to " + d.email + ".", true);
            })
            .catch(function (e) {
              say(said, e.message, false);
            })
            .then(function () {
              code.disabled = false;
            });
        });
        actions.appendChild(code);
      }
      var change = el("button", { class: "hq-btn hq-btn--small", type: "button", text: "Change details" });
      actions.appendChild(change);
      details.appendChild(actions);
      var detailsSaid = el("p", { class: "hq-status", role: "status" });
      details.appendChild(detailsSaid);
      change.addEventListener("click", function () {
        if (details.querySelector("form")) return;
        var name = el("input", { name: "grownUpName", id: "hqGrownUp", type: "text", maxlength: 80, autocomplete: "off" });
        name.value = f.grownUpName;
        var email = el("input", { name: "email", id: "hqEmail", type: "email", maxlength: 200, autocomplete: "off" });
        email.value = f.email;
        var cancel = el("button", { class: "hq-btn hq-btn--small", type: "button", text: "Cancel" });
        var form = el("form", { class: "hq-form" }, [
          el("label", { class: "hq-field", for: "hqGrownUp" }, [el("span", { text: "The grown up's name" }), name]),
          el("label", { class: "hq-field", for: "hqEmail" }, [el("span", { text: "Their email" }), email]),
          el("p", { class: "hq-words hq-soft", text: "A new email signs the family out everywhere: they sign in again with a code sent to the new one." }),
          el("div", { class: "hq-actions" }, [el("button", { class: "hq-btn hq-btn--small hq-btn--go", type: "submit", text: "Save" }), cancel]),
        ]);
        cancel.addEventListener("click", function () {
          form.remove();
          change.focus();
        });
        form.addEventListener("submit", function (e) {
          e.preventDefault();
          var sent = {};
          if (name.value.trim() !== f.grownUpName) sent.grownUpName = name.value;
          if (email.value.trim().toLowerCase() !== f.email) sent.email = email.value;
          if (!sent.grownUpName && !sent.email) {
            form.remove();
            return;
          }
          changeFamily("PATCH", "/api/admin/elf/families/" + f.id, sent, function () {
            var now = famSheet.querySelector(".hq-sheet__details .hq-status");
            if (now) say(now, "Saved.", true);
          }).catch(function (err) {
            say(detailsSaid, err.message, false);
          });
        });
        details.insertBefore(form, detailsSaid);
        name.focus();
      });
      famSheet.appendChild(details);
      famSheet.appendChild(said);

      // The detectives, as character cards with their name switch.
      var dets = el("div", { class: "hq-dets" });
      f.detectives.forEach(function (d) {
        dets.appendChild(detectiveCard(f, d));
      });
      famSheet.appendChild(dets);

      // Every payment the family started.
      famSheet.appendChild(el("h3", { class: "hq-h3", text: "Payments" }));
      var paid = el("ul", { class: "hq-paid" });
      if (!f.payments.length) paid.appendChild(el("li", { class: "hq-soft", text: "No payments." }));
      f.payments.forEach(function (p) {
        var bits = [el("b", { text: pounds(p.entryPence + p.giftPence) }), el("span", { text: "entry " + pounds(p.entryPence) + (p.giftPence ? ", gift " + pounds(p.giftPence) : "") })];
        if (p.giftAid && p.giftPence) bits.push(el("span", { class: "hq-chip hq-chip--holly", text: "Gift Aid on the gift" }));
        if (p.status === "pending") bits.push(el("span", { class: "hq-chip", text: "Not finished" }));
        if (p.status === "expired") bits.push(el("span", { class: "hq-chip hq-chip--crimson", text: "Never paid" }));
        bits.push(el("span", { class: "hq-soft", text: (p.paidAt ? shortDay(p.paidAt) + " · " : "") + p.reference }));
        paid.appendChild(el("li", {}, bits));
      });
      famSheet.appendChild(paid);

      // Removing (asked twice) or putting back.
      var end = el("div", { class: "hq-actions hq-sheet__end" });
      if (f.removedAt) {
        var restore = el("button", { class: "hq-btn hq-btn--small hq-btn--go", type: "button", text: "Put back" });
        restore.addEventListener("click", function () {
          restore.disabled = true;
          changeFamily("POST", "/api/admin/elf/families/" + f.id + "/restore").catch(function (e) {
            say(said, e.message, false);
            restore.disabled = false;
          });
        });
        end.appendChild(restore);
      } else {
        var remove = el("button", { class: "hq-btn hq-btn--small hq-btn--danger", type: "button", text: "Remove this family" });
        remove.addEventListener("click", function () {
          if (end.querySelector(".hq-confirm")) return;
          var yes = el("button", { class: "hq-btn hq-btn--small hq-btn--danger", type: "button", text: "Yes, remove them" });
          var no = el("button", { class: "hq-btn hq-btn--small", type: "button", text: "Keep them" });
          var sure = el("div", { class: "hq-confirm", role: "group", "aria-label": "Are you sure?" }, [
            el("p", { class: "hq-words", text: "Remove " + f.grownUpName + "'s family? They cannot sign in, and they leave the counts and the money. If they paid, refund them in Stripe first." }),
            yes,
            no,
          ]);
          no.addEventListener("click", function () {
            sure.remove();
            remove.focus();
          });
          yes.addEventListener("click", function () {
            yes.disabled = true;
            changeFamily("POST", "/api/admin/elf/families/" + f.id + "/remove").catch(function (e) {
              sure.remove();
              say(said, e.message, false);
            });
          });
          end.appendChild(sure);
          yes.focus();
        });
        end.appendChild(remove);
      }
      famSheet.appendChild(end);
    }

    function detectiveCard(f, d) {
      var card = el("div", { class: "hq-det", "data-detective": d.id });
      var said = el("p", { class: "hq-status", role: "status" });
      card.appendChild(
        el("div", { class: "hq-det__top" }, [
          el("span", { class: "hq-avatar" }, [el("img", { src: d.tile, alt: "", width: 84, height: 84, loading: "lazy" })]),
          el("div", {}, [el("b", { text: "Detective " + d.firstName + " " + d.surname }), d.badge ? el("small", { class: "hq-soft", text: d.badge }) : null]),
        ]),
      );
      var toggle = el("button", { class: "hq-toggle", type: "button", role: "switch", "aria-checked": String(!!d.approved), "data-detective": d.id, disabled: !!f.removedAt }, [
        el("span", { text: d.approved ? d.firstName + " shows in public" : "Show " + d.firstName + " in public? Until then it is " + d.firstName.charAt(0) + "." }),
        el("i", { "aria-hidden": "true" }),
      ]);
      toggle.addEventListener("click", function () {
        toggle.disabled = true;
        ask("PATCH", "/api/admin/elf/detectives/" + d.id, { approved: !d.approved })
          .then(function (r) {
            var was = d.approved;
            d.approved = r.detective.approved;
            if (was !== d.approved && data && data.numbers) {
              data.numbers.namesToCheck = Math.max(0, (data.numbers.namesToCheck || 0) + (d.approved ? -1 : 1));
              tileCount("families", data.numbers.namesToCheck);
            }
            card.replaceWith(detectiveCard(f, d));
            loadFamilies();
          })
          .catch(function (e) {
            say(said, e.message, false);
            toggle.disabled = false;
          });
      });
      card.appendChild(toggle);
      var rename = el("button", { class: "hq-btn hq-btn--small hq-rename", type: "button", text: "Change name", disabled: !!f.removedAt });
      rename.addEventListener("click", function () {
        if (card.querySelector("form")) return;
        var first = el("input", { name: "firstName", id: "hqFirst-" + d.id, type: "text", maxlength: 20, autocomplete: "off" });
        first.value = d.firstName;
        var surname = el("select", { name: "surname", id: "hqSurname-" + d.id });
        (fam.surnames.length ? fam.surnames : [d.surname]).forEach(function (s) {
          var o = el("option", { value: s, text: s });
          if (s === d.surname) o.selected = true;
          surname.appendChild(o);
        });
        var cancel = el("button", { class: "hq-btn hq-btn--small", type: "button", text: "Cancel" });
        var form = el("form", { class: "hq-form" }, [
          el("label", { class: "hq-field", for: "hqFirst-" + d.id }, [el("span", { text: "First name" }), first]),
          el("label", { class: "hq-field", for: "hqSurname-" + d.id }, [el("span", { text: "Festive surname" }), surname]),
          el("p", { class: "hq-words hq-soft", text: "A new name waits for a tick before it shows in public." }),
          el("div", { class: "hq-actions" }, [el("button", { class: "hq-btn hq-btn--small hq-btn--go", type: "submit", text: "Save" }), cancel]),
        ]);
        cancel.addEventListener("click", function () {
          form.remove();
          rename.focus();
        });
        form.addEventListener("submit", function (e) {
          e.preventDefault();
          ask("PATCH", "/api/admin/elf/detectives/" + d.id, { firstName: first.value, surname: surname.value })
            .then(function (r) {
              var was = d.approved;
              d.firstName = r.detective.firstName;
              d.surname = r.detective.surname;
              d.approved = r.detective.approved;
              if (was && !d.approved && data && data.numbers) {
                data.numbers.namesToCheck = (data.numbers.namesToCheck || 0) + 1;
                tileCount("families", data.numbers.namesToCheck);
              }
              var fresh = detectiveCard(f, d);
              card.replaceWith(fresh);
              say(fresh.querySelector(".hq-status"), "Saved. The new name waits for a tick.", true);
              loadFamilies();
            })
            .catch(function (err) {
              say(said, err.message, false);
            });
        });
        card.insertBefore(form, said);
        first.focus();
      });
      card.appendChild(rename);
      card.appendChild(said);
      return card;
    }

    // ---- Money: what the school has made, and the way to every payment in Donations ----
    function drawMoneyPart() {
      var part = parts.money;
      part.textContent = "";
      var n = data.numbers || {};
      var box = el("section", { class: "hq-panel hq-money", "aria-label": "Raised so far" });
      drawMoney(box, false, "from " + (n.families || 0) + " " + plural(n.families, "family", "families"));
      box.appendChild(el("p", { class: "hq-words", text: "Entries are a payment to take part, so they are never claimed for Gift Aid. A gift on top can be, when the grown up says yes." }));
      var go = el("button", { class: "hq-btn hq-btn--go", type: "button", text: "Every payment, in Donations" });
      go.addEventListener("click", function () {
        // Donations, showing only the school's payments: its own filter (Admin > Donations) is ticked
        // the way a person would tick it, so app.js reads the list for it as it always does.
        var filter = doc.getElementById("donationsElfFilter");
        if (filter && !filter.checked) {
          filter.checked = true;
          filter.dispatchEvent(new win.Event("change", { bubbles: true }));
        }
        var nav = doc.querySelector('.admin-nav-link[data-view="donations"]');
        if (nav) nav.click();
      });
      box.appendChild(el("div", { class: "hq-actions" }, [go]));
      part.appendChild(box);
    }

    // ---- Settings: the pay what you can amounts and the private preview link ----
    var PRICE_LIMITS = { from: [1, 10], suggested: [1, 50] };
    var shownLink = null; // a preview link just made, shown once

    function stepper(label, value, onStep) {
      var out = el("output", { text: pounds(value * 100) });
      var less = el("button", { type: "button", class: "hq-step", "data-step": "less", "aria-label": "Less for " + label, text: "−" });
      var more = el("button", { type: "button", class: "hq-step", "data-step": "more", "aria-label": "More for " + label, text: "+" });
      less.addEventListener("click", function () {
        onStep(-1);
      });
      more.addEventListener("click", function () {
        onStep(1);
      });
      return { box: el("div", { class: "hq-stepper", role: "group", "aria-label": label }, [less, out, more]), out: out };
    }

    function drawSettingsPart() {
      var part = parts.settings;
      part.textContent = "";
      var s = data.settings || {};
      var admin = !!data.canSwitch;
      var grid = el("div", { class: "hq-settings" });

      // The prices.
      var prices = el("section", { class: "hq-panel hq-prices", "aria-label": "Pay what you can" });
      prices.appendChild(el("h2", { class: "hq-h2", text: "Pay what you can" }));
      var from = Math.round((s.entryFromPence || 100) / 100);
      var suggested = Math.round((s.entrySuggestedPence || 500) / 100);
      if (!admin) {
        prices.appendChild(el("p", { class: "hq-words", text: "The least anyone pays is " + pounds(from * 100) + " for each detective, and we suggest " + pounds(suggested * 100) + "." }));
      } else {
        prices.appendChild(el("p", { class: "hq-words hq-soft", text: "For each detective, when a grown up enrols." }));
        var least, hint;
        var draw = function () {
          least.out.textContent = pounds(from * 100);
          hint.out.textContent = pounds(suggested * 100);
        };
        least = stepper("the least anyone pays", from, function (by) {
          from = Math.min(PRICE_LIMITS.from[1], Math.max(PRICE_LIMITS.from[0], from + by));
          if (suggested < from) suggested = from;
          draw();
        });
        hint = stepper("what we suggest", suggested, function (by) {
          suggested = Math.min(PRICE_LIMITS.suggested[1], Math.max(from, PRICE_LIMITS.suggested[0], suggested + by));
          draw();
        });
        prices.appendChild(el("div", { class: "hq-field" }, [el("span", { text: "The least anyone pays" }), least.box]));
        prices.appendChild(el("div", { class: "hq-field" }, [el("span", { text: "What we suggest" }), hint.box]));
        var said = el("p", { class: "hq-status", role: "status" });
        var save = el("button", { class: "hq-btn hq-btn--go", type: "button", text: "Save the prices" });
        save.addEventListener("click", function () {
          save.disabled = true;
          ask("PATCH", "/api/admin/elf/settings", { entryFromPence: from * 100, entrySuggestedPence: suggested * 100 })
            .then(function (d) {
              data.settings = d.settings;
              drawSettingsPart();
              var now = parts.settings.querySelector(".hq-prices .hq-status");
              if (now) say(now, "Saved.", true);
            })
            .catch(function (e) {
              say(said, e.message, false);
              save.disabled = false;
            });
        });
        prices.appendChild(el("div", { class: "hq-actions" }, [save]));
        prices.appendChild(said);
      }
      grid.appendChild(prices);

      // The private preview link.
      var preview = el("section", { class: "hq-panel hq-preview", "aria-label": "Your private preview" });
      preview.appendChild(el("h2", { class: "hq-h2", text: "Your private preview" }));
      preview.appendChild(el("p", { class: "hq-words", text: s.previewOn ? "A preview link is open. Anyone who has it can see the school." : "There is no preview link." }));
      preview.appendChild(el("p", { class: "hq-words hq-soft", text: "A preview link shows every page of the school while it is switched off, in the browser that opens it. Payments in the preview are real." }));
      if (shownLink) {
        var link = el("input", { id: "hqPreviewLink", class: "hq-find", type: "text", readonly: true });
        link.value = shownLink;
        preview.appendChild(el("div", { class: "hq-field" }, [el("label", { for: "hqPreviewLink", text: "Copy it now: it is shown only once" }), link]));
      }
      var linkSaid = el("p", { class: "hq-status", role: "status" });
      if (admin) {
        var actions = el("div", { class: "hq-actions" });
        var make = el("button", { class: "hq-btn hq-btn--go", type: "button", text: s.previewOn ? "Make a new link" : "Make a preview link" });
        make.addEventListener("click", function () {
          make.disabled = true;
          ask("POST", "/api/admin/elf/preview")
            .then(function (d) {
              shownLink = d.url;
              data.settings.previewOn = true;
              drawSettingsPart();
              var box = doc.getElementById("hqPreviewLink");
              if (box) box.select();
            })
            .catch(function (e) {
              say(linkSaid, e.message, false);
              make.disabled = false;
            });
        });
        actions.appendChild(make);
        if (s.previewOn) {
          var end = el("button", { class: "hq-btn hq-btn--danger", type: "button", text: "End the link" });
          end.addEventListener("click", function () {
            end.disabled = true;
            ask("DELETE", "/api/admin/elf/preview")
              .then(function () {
                shownLink = null;
                data.settings.previewOn = false;
                drawSettingsPart();
                var now = parts.settings.querySelector(".hq-preview .hq-status");
                if (now) say(now, "Preview link ended.", true);
              })
              .catch(function (e) {
                say(linkSaid, e.message, false);
                end.disabled = false;
              });
          });
          actions.appendChild(end);
        }
        preview.appendChild(actions);
      }
      preview.appendChild(linkSaid);
      grid.appendChild(preview);
      part.appendChild(grid);
      if (!admin) part.appendChild(el("p", { class: "hq-words hq-soft", text: "Only an admin can change these." }));
    }

    /** Draws everything from the latest answer. Each part's drawing arrives with its task. */
    function draw() {
      if (!data) return;
      var on = !!(data.settings && data.settings.schoolOn);
      stateChip.textContent = on ? "Live" : "Switched off";
      stateChip.classList.toggle("is-live", on);
      tileCount("families", data.numbers ? data.numbers.namesToCheck : 0);
      drawHq();
      drawMoneyPart();
      drawSettingsPart();
    }

    /** Reads HQ afresh: called by app.js whenever the section is opened. */
    function open() {
      say(status, WORDS.loading, null);
      return ask("GET", "/api/admin/elf/hq")
        .then(function (d) {
          data = d;
          say(status, "", null);
          draw();
          var asked = remembered(FAMILY_KEY);
          if (asked && /^[1-9]d{0,9}$/.test(asked)) {
            remember(FAMILY_KEY, null);
            show("families");
            return openFamily(asked);
          }
          if (!parts.families.hidden) return loadFamilies();
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
