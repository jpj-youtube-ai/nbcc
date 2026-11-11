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
    { id: "doors", name: "Doors", icon: PAPER + "icons/icon-frame.webp" },
    { id: "money", name: "Money", coin: true },
    { id: "settings", name: "Settings", icon: PAPER + "icons/icon-paint.webp" },
  ];
  var WORDS = {
    loading: "Loading…",
    didNotWork: "That did not work. Please try again.",
    signedOut: "Your session has ended. Please sign in again.",
    notAllowed: "You do not have access to do that. An admin can give it in Team.",
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
            // The section gate answers a bare "forbidden"; a person is told it in words.
            if (res.status === 403 && d && d.error === "forbidden") throw new Error(WORDS.notAllowed);
            if (!res.ok) {
              var failure = new Error((d && d.error) || WORDS.didNotWork);
              failure.status = res.status;
              failure.problems = (d && d.problems) || null; // a paste that has problems says which
              failure.fields = (d && d.fields) || null; // a picture the server would not take says which part and why
              failure.printed = !!(d && d.printed); // a tag word asked for again after its tag was printed
              throw failure;
            }
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
      if (id === "doors" && !doors.list && !doors.asking) loadDoors();
      if (id === "doors") fitFields(); // boxes drawn while this tab was hidden had no height to measure
      if (id === "settings" && data) loadPractice();
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
    /** A moment's time in London as people say it: "5:30pm". */
    function timeWords(iso) {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return "";
      return new Intl.DateTimeFormat("en-GB", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Europe/London" }).format(d).replace(/\s/g, "").toLowerCase();
    }
    function whenWords(iso) {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return "";
      var day = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/London" }).format(d).replace(/,/g, "");
      return day + ", " + timeWords(iso);
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
    var QUEST_ICONS = { names: PAPER + "icons/icon-friend.webp", doors: PAPER + "icons/icon-frame.webp", "doors-soon": PAPER + "icons/icon-frame.webp", preview: PAPER + "icons/icon-lock.webp", waiting: PAPER + "icons/icon-bell.webp" };
    var familyFilter = "all";
    var confirming = null; // the lever's second ask, while it is showing

    function drawSwitch(box) {
      var s = data.settings || {};
      var on = !!s.schoolOn;
      var lever = el("button", { class: "hq-lever", type: "button", role: "switch", id: "hqLever", "aria-checked": String(on), "aria-label": "Elf Detective School's switch", disabled: !data.canSwitch }, [
        el("span", { class: "hq-lever__words", "aria-hidden": "true", text: on ? "ON" : "OFF" }),
        el("span", { class: "hq-lever__knob" }, [el("img", { src: PAPER + "deco/bauble.webp", alt: "", width: 52, height: 52 })]),
      ]);
      var words = el("div", {}, [
        el("h2", { class: "hq-h2", text: on ? "Elf Detective School is live" : "Elf Detective School is switched off" }),
        el("p", { class: "hq-words hq-soft", text: on ? "Anyone can find it and enrol." : s.previewOn ? "Families cannot see it yet. Your private preview link can." : "Families cannot see it yet." }),
      ]);
      box.appendChild(lever);
      box.appendChild(words);
      if (!data.canSwitch) box.appendChild(el("p", { class: "hq-words hq-soft hq-switchbox__who", text: "Only an admin can switch Elf Detective School on or off." }));
      lever.addEventListener("click", function () {
        pullLever(box, lever, {
          turnOn: !on,
          field: "schoolOn",
          question: [
            "Switch it on for everyone? Sign ups open straight away and anyone can find Elf Detective School.",
            "Switch it off? Families cannot see Elf Detective School or sign in while it is off.",
          ],
          yes: ["Yes, switch it on", "Yes, switch it off"],
          no: ["Not yet", "Keep it on"],
          done: ["Elf Detective School is live.", "Elf Detective School is switched off."],
          id: "hqLever",
        });
      });
    }

    /** December's doors: a second lever, on the same panel, for admins; words for anyone else. */
    function drawDoorsSwitch(box) {
      var on = !!(data.settings && data.settings.doorsOn);
      var line = "Switched on, every door runs by itself from its first clue. Switched off, the doors stay shut with their countdowns.";
      if (!data.canSwitch) {
        box.appendChild(el("div", { class: "hq-switchbox__who" }, [el("p", { class: "hq-words", text: "December's doors: " + (on ? "On" : "Off") }), el("p", { class: "hq-words hq-soft", text: line })]));
        return;
      }
      var lever = el("button", { class: "hq-lever hq-lever--doors", type: "button", role: "switch", id: "hqDoorsLever", "aria-checked": String(on), "aria-label": "December's doors switch" }, [
        el("span", { class: "hq-lever__words", "aria-hidden": "true", text: on ? "ON" : "OFF" }),
        el("span", { class: "hq-lever__knob" }, [el("img", { src: PAPER + "deco/bauble.webp", alt: "", width: 52, height: 52 })]),
      ]);
      box.appendChild(lever);
      box.appendChild(
        el("div", {}, [
          el("h2", { class: "hq-h2", text: on ? "December's doors are switched on" : "December's doors are switched off" }),
          el("p", { class: "hq-words hq-soft", text: line }),
        ]),
      );
      lever.addEventListener("click", function () {
        pullLever(box, lever, {
          turnOn: !on,
          field: "doorsOn",
          question: [
            "Switch December's doors on? Families will see the clues, guess, type the word and send photos from door 1's first clue.",
            "Switch December's doors off? The doors go back to being shut, with their countdowns.",
          ],
          yes: ["Yes, switch them on", "Yes, switch them off"],
          no: ["Not yet", "Keep them on"],
          done: ["December's doors are switched on.", "December's doors are switched off."],
          id: "hqDoorsLever",
        });
      });
    }

    /** A lever pulled: the second ask, then the change. `o` holds the words for on (0) and off (1). */
    function pullLever(box, lever, o) {
      if (confirming) return;
      var turnOn = o.turnOn;
      var at = turnOn ? 0 : 1;
      var yes = el("button", { class: "hq-btn hq-btn--small " + (turnOn ? "hq-btn--go" : "hq-btn--danger"), type: "button", text: o.yes[at] });
      var no = el("button", { class: "hq-btn hq-btn--small", type: "button", text: o.no[at] });
      confirming = el("div", { class: "hq-confirm", role: "group", "aria-label": "Are you sure?" }, [el("p", { class: "hq-words", text: o.question[at] }), yes, no]);
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
        var sent = {};
        sent[o.field] = turnOn;
        ask("PATCH", "/api/admin/elf/settings", sent)
          .then(function (d) {
            data.settings = d.settings;
            confirming = null;
            draw();
            say(status, o.done[at], true);
            var again = doc.getElementById(o.id);
            if (again) again.focus();
          })
          .catch(function (e) {
            if (confirming) confirming.remove();
            confirming = null;
            say(status, e.message, false);
          });
      });
    }

    function drawQuests(box) {
      box.appendChild(el("h2", { class: "hq-h2", text: "Needs you" }));
      var quests = data.quests || [];
      if (!quests.length) {
        box.appendChild(el("p", { class: "hq-words hq-quiet" }, [el("span", { class: "hq-tick", "aria-hidden": "true" }), "Nothing needs you. Elf Detective School is running itself."]));
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
      // A rosette is only a picture to a screen reader, so each heading says its number too, unseen.
      if (days > 0) {
        clue.appendChild(rosette("#C02238", "#800000", String(days)));
        clue.appendChild(el("h3", { class: "hq-h3" }, [el("span", { class: "hq-sr", text: days + " " }), plural(days, "day to the first clue", "days to the first clue")]));
      } else {
        var before = Date.now() < new Date(data.firstClueAt).getTime();
        clue.appendChild(rosette("#C02238", "#800000", before ? "Today" : "Open"));
        clue.appendChild(el("h3", { class: "hq-h3", text: before ? "The first clue is today" : "The doors are open" }));
      }
      clue.appendChild(el("p", { class: "hq-soft", text: whenWords(data.firstClueAt) }));
      var n = data.numbers || {};
      var who = el("div", { class: "hq-panel hq-clock" }, [
        rosette("#D9A93E", "#1A531A", String(n.detectives || 0)),
        el("h3", { class: "hq-h3" }, [el("span", { class: "hq-sr", text: (n.detectives || 0) + " " }), plural(n.detectives, "detective enrolled", "detectives enrolled")]),
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
      drawDoorsSwitch(switchBox);
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
    var fam = { list: null, total: 0, counts: null, sheet: null, tries: [], surnames: [], q: "", timer: null, built: false, asked: 0 };
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
          fam.tries = d.wordTries || [];
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
      if (f.removedAt) {
        details.appendChild(
          el("p", {
            class: "hq-words hq-removed",
            text: "Removed on " + longDay(f.removedAt) + (f.removedBy ? " by " + who(f.removedBy) : "") + ". They cannot sign in or enrol again with this email until they are put back, and they are left out of the counts and the money.",
          }),
        );
      }
      // Someone who may only look (Head Elf HQ at view, from Team) is shown the family, with nothing to press.
      var mayChange = !!(data && data.canEdit);
      if (!mayChange) {
        details.appendChild(el("p", { class: "hq-words hq-soft", text: "You can look at this family. Changing it needs edit access to Head Elf HQ, which an admin can give in Team." }));
        famSheet.appendChild(details);
        famSheet.appendChild(said);
        drawSheetRest(f, false);
        return;
      }
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
      drawSheetRest(f, true);

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
            el("p", {
              class: "hq-words",
              text: "Remove " + f.grownUpName + "'s family? They cannot sign in or enrol again with this email until they are put back, and they leave the counts and the money. If they paid, refund them in Stripe first.",
            }),
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

    // The detectives and the payments, for a head elf who may change the family and one who may only look.
    function drawSheetRest(f, mayChange) {
      // The detectives, as character cards with their name switch.
      var dets = el("div", { class: "hq-dets" });
      f.detectives.forEach(function (d) {
        dets.appendChild(detectiveCard(f, d, mayChange));
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
      famSheet.appendChild(triesBox(f, mayChange));
    }

    /** The doors this family has typed wrong words at, each with Clear them (for someone who may edit). */
    function triesBox(f, mayChange) {
      var box = el("section", { class: "hq-tries", "aria-label": "Wrong words typed" }, [el("h3", { class: "hq-h3", text: "Wrong words typed" })]);
      var said = el("p", { class: "hq-status", role: "status" });
      var tries = (fam.tries || []).filter(function (t) {
        return t && t.wrong > 0;
      });
      if (!tries.length) {
        box.appendChild(el("p", { class: "hq-words hq-soft", text: "No wrong words typed." }));
      } else {
        var list = el("ul", { class: "hq-tries__list" });
        tries.forEach(function (t) {
          var item = el("li", {}, [el("span", { text: "Door " + t.door + ": " + t.wrong + (t.wrong === 1 ? " wrong try" : " wrong tries") })]);
          if (mayChange) {
            var clear = el("button", { class: "hq-btn hq-btn--small", type: "button", text: "Clear them", "aria-label": "Clear door " + t.door + "'s wrong tries" });
            clear.addEventListener("click", function () {
              clear.disabled = true;
              ask("POST", "/api/admin/elf/families/" + f.id + "/word-tries/clear", { door: t.door })
                .then(function (d) {
                  if (!fam.sheet || fam.sheet.id !== f.id) return; // another family has been opened since
                  fam.tries = d.wordTries || fam.tries.filter(function (x) { return x.door !== t.door; });
                  if (d.family) fam.sheet = d.family;
                  drawSheet();
                  var now = famSheet.querySelector(".hq-tries .hq-status");
                  if (now) say(now, "Cleared. They can try again.", true);
                })
                .catch(function (e) {
                  say(said, e.message, false);
                  clear.disabled = false;
                });
            });
            item.appendChild(clear);
          }
          list.appendChild(item);
        });
        box.appendChild(list);
      }
      box.appendChild(said);
      return box;
    }

    function detectiveCard(f, d, mayChange) {
      var card = el("div", { class: "hq-det", "data-detective": d.id });
      var said = el("p", { class: "hq-status", role: "status" });
      card.appendChild(
        el("div", { class: "hq-det__top" }, [
          el("span", { class: "hq-avatar" }, [el("img", { src: d.tile, alt: "", width: 84, height: 84, loading: "lazy" })]),
          el("div", {}, [el("b", { text: "Detective " + d.firstName + " " + d.surname }), d.badge ? el("small", { class: "hq-soft", text: d.badge }) : null]),
        ]),
      );
      // Someone who may only look sees the name's state as words, with no switch and no Change name.
      if (mayChange === false) {
        card.appendChild(el("p", { class: "hq-words", text: d.approved ? d.firstName + " shows in public." : d.firstName + " waits for a tick. Until then it is " + d.firstName.charAt(0) + "." }));
        return card;
      }
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

    // ---- Doors: the 24 doors as a level select, and the open door's sheet beside it ----
    var READY_WORDS = { place: "The place", prize: "The prize", picture: "The door picture", elf: "The elf and its tag", clues: "The three clues", droppedOff: "Dropped off" };
    var doors = { list: null, counts: null, canEdit: false, open: null, sheet: null, known: {}, asking: false, asked: 0 };
    var doorsGrid, doorsChips, doorsTools, doorsSheet, doorTiles = {}, sheetHead, sheetReady;

    /** "17:30" as "5:30pm", and "19:00" as "7pm". */
    function clockWords(hhmm) {
      var m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm || ""));
      if (!m) return "";
      var h = Number(m[1]);
      var h12 = h % 12 === 0 ? 12 : h % 12;
      return h12 + (m[2] === "00" ? "" : ":" + m[2]) + (h >= 12 ? "pm" : "am");
    }
    /** The time an hour after "18:30", in words: "7:30pm". */
    function hourAfter(hhmm) {
      var m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm || ""));
      if (!m) return "";
      return clockWords(String((Number(m[1]) + 1) % 24).padStart(2, "0") + ":" + m[2]);
    }
    function clock5(v) {
      return typeof v === "string" && /^\d{2}:\d{2}/.test(v) ? v.slice(0, 5) : "";
    }
    /** A long field grows to fit its words, so nothing ever scrolls inside it. */
    function fitField(t) {
      t.style.height = "auto";
      var h = t.scrollHeight;
      if (h) t.style.height = h + (t.offsetHeight - t.clientHeight) + "px";
    }
    function fitFields() {
      [doorsSheet, doorsTools].forEach(function (root) {
        if (root) Array.prototype.forEach.call(root.querySelectorAll("textarea"), fitField);
      });
    }
    win.addEventListener("resize", fitFields);

    function buildDoors() {
      if (doorsGrid) return;
      var part = parts.doors;
      part.textContent = "";
      doorsChips = el("div", { class: "hq-sums" });
      doorsGrid = el("ul", { class: "hq-door-grid", "aria-label": "The 24 doors" });
      doorsTools = el("div", { class: "hq-door-tools" });
      doorsSheet = el("section", { class: "hq-panel hq-door-sheet", "aria-label": "The door", "aria-live": "polite" }, [el("p", { class: "hq-words hq-soft", text: "Pick a door to see what it has and what it still needs." })]);
      part.appendChild(
        el("div", { class: "hq-doors" }, [
          el("section", { class: "hq-panel hq-level", "aria-label": "The 24 doors" }, [el("h2", { class: "hq-h2", text: "The 24 doors" }), doorsChips, doorsGrid, doorsTools]),
          doorsSheet,
        ]),
      );
    }

    /** Reads the 24 doors, once: the first time the tab opens (and again if that failed). */
    function loadDoors() {
      buildDoors();
      doors.asking = true;
      return ask("GET", "/api/admin/elf/doors")
        .then(function (d) {
          doors.list = d.doors || [];
          doors.counts = d.counts || { placesAgreed: 0, prizesChosen: 0, ready: 0 };
          doors.canEdit = !!d.canEdit;
          drawDoorList();
          if (doors.sheet) drawDoorSheet();
        })
        .catch(function (e) {
          say(status, e.message, false);
        })
        .then(function () {
          doors.asking = false;
        });
    }

    /** The tiles are built once and then updated where they stand, so a tapped tile keeps its focus. */
    function drawDoorList() {
      var c = doors.counts || {};
      if (doors.toolsEdit !== doors.canEdit) {
        doors.toolsEdit = doors.canEdit;
        drawDoorTools();
      }
      doorsChips.textContent = "";
      doorsChips.appendChild(el("span", { class: "hq-chip", text: (c.placesAgreed || 0) + " places agreed" }));
      doorsChips.appendChild(el("span", { class: "hq-chip", text: (c.prizesChosen || 0) + " prizes chosen" }));
      doorsChips.appendChild(el("span", { class: "hq-chip hq-chip--holly", text: (c.ready || 0) + " ready for their day" }));
      doors.list.forEach(function (t) {
        var b = doorTiles[t.door];
        if (!b) {
          b = el("button", { type: "button", "data-door": t.door });
          b.addEventListener("click", function () {
            openDoor(t.door, true);
          });
          doorTiles[t.door] = b;
          doorsGrid.appendChild(el("li", {}, [b]));
        }
        var on = doors.open === t.door;
        b.className = "hq-door " + (!t.placeName ? "is-empty" : t.ready ? "is-ready" : "is-needs") + (on ? " is-on" : "");
        b.setAttribute("aria-pressed", String(on));
        b.textContent = "";
        b.appendChild(el("b", { class: "hq-door__n", text: String(t.door) }));
        b.appendChild(el("span", { class: "hq-door__day", text: t.weekday }));
        b.appendChild(el("span", { class: "hq-door__where", text: t.placeName || "No place yet" }));
        if (t.placeName) b.appendChild(el("span", { class: "hq-door__st", text: t.ready ? "Ready" : t.toDo + " to do" }));
      });
      tileCount("doors", doors.list.filter(function (t) { return !t.ready && !t.started; }).length);
    }

    /** Opens a door's sheet beside the level select (below it on a narrow screen). */
    function openDoor(n, scroll) {
      buildDoors();
      var asked = ++doors.asked;
      return ask("GET", "/api/admin/elf/doors/" + n)
        .then(function (d) {
          if (asked !== doors.asked) return; // a later door has been asked for since
          doors.open = n;
          doors.sheet = d.door;
          doors.known[n] = d.door.readiness;
          if (typeof d.canEdit === "boolean") doors.canEdit = d.canEdit;
          if (doors.list) drawDoorList();
          drawDoorSheet();
          if (scroll && doorsSheet.scrollIntoView) doorsSheet.scrollIntoView({ block: "nearest" });
        })
        .catch(function (e) {
          say(status, e.message, false);
        });
    }

    /**
     * A saved door. Its tile and the sums always move on; the sheet is touched only when that door is
     * still the open one, and then only the head, the ready list and the parts named in `o.rebuild`, so
     * what was typed in the other parts stays. `o` can also say: names (the list of names changed),
     * say (a part and its words) and focus (a part whose Save button takes focus, or an id).
     */
    function takeDoor(door, o) {
      o = o || {};
      var prev = doors.known[door.door];
      doors.known[door.door] = door.readiness;
      if (prev && doors.counts) {
        var was = {};
        prev.items.forEach(function (i) { was[i.key] = i.done; });
        var c = doors.counts;
        door.readiness.items.forEach(function (i) {
          if (i.key === "place" && i.done !== was.place) c.placesAgreed += i.done ? 1 : -1;
          if (i.key === "prize" && i.done !== was.prize) c.prizesChosen += i.done ? 1 : -1;
        });
        if (door.readiness.ready !== prev.ready) c.ready += door.readiness.ready ? 1 : -1;
      }
      (doors.list || []).forEach(function (t) {
        if (t.door !== door.door) return;
        t.placeName = door.placeName || null;
        t.ready = door.readiness.ready;
        t.toDo = door.readiness.toDo;
      });
      if (doors.list) drawDoorList();
      if (doors.open !== door.door || !doors.sheet || doors.sheet.door !== door.door) return false;
      doors.sheet = door;
      fillSheetHead();
      fillSheetReady();
      (o.rebuild || []).forEach(function (key) {
        var old = doorsSheet.querySelector('[data-part="' + key + '"]');
        if (old) old.replaceWith(buildPart(key));
      });
      if (o.names) fillNames(doorsSheet.querySelector(".hq-names"));
      var word = doorsSheet.querySelector(".hq-tagword b");
      if (word) word.textContent = door.tagWord || "No word yet";
      [1, 2, 3].forEach(function (n) {
        var name = doorsSheet.querySelector('label[for="hqDoor-clue' + n + '"]');
        if (name) name.textContent = clueName(n, door);
      });
      var where = doorsSheet.querySelector("[data-prints-place]");
      if (where) where.textContent = printsWords(door);
      updateCloseHint();
      fitFields();
      if (o.say) say(partLine(o.say[0]), o.say[1], true);
      var target = o.focusId ? doorsSheet.querySelector("#" + o.focusId) : o.focus ? doorsSheet.querySelector('[data-part="' + o.focus + '"] .hq-btn--go') || partLine(o.focus) : null;
      if (target && target.focus) target.focus();
      return true;
    }
    function partLine(key) {
      return doorsSheet.querySelector('[data-part="' + key + '"] .hq-status');
    }

    function doorField(key, label, input, hint, wide) {
      return el("div", { class: "hq-field" + (wide ? " is-wide" : "") }, [el("label", { for: "hqDoor-" + key, text: label }), input, hint || null]);
    }
    /** A box for one line, a time, or (kind "area") words that can run long. */
    function doorInput(key, value, max, kind, readonly) {
      var edit = doors.canEdit;
      var i =
        kind === "area"
          ? el("textarea", { id: "hqDoor-" + key, name: key, maxlength: max || null, class: "hq-grow", disabled: !edit, readonly: !!readonly })
          : el("input", { type: kind || "text", id: "hqDoor-" + key, name: key, maxlength: max || null, autocomplete: "off", disabled: !edit, readonly: !!readonly });
      i.value = value || "";
      if (kind === "area") i.addEventListener("input", function () { fitField(i); });
      return i;
    }

    function fillSheetHead() {
      var d = doors.sheet;
      var place = [d.placeName, d.placeTown].filter(Boolean).join(", ");
      sheetHead.textContent = "";
      sheetHead.appendChild(el("span", { class: "hq-mini-door", "aria-hidden": "true", text: String(d.door) }));
      sheetHead.appendChild(
        el("div", {}, [
          el("h2", { class: "hq-h2", text: "Door " + d.door + " · " + d.day }),
          el("p", { class: "hq-note", text: place || "No place yet" }),
          el("div", { class: "hq-sums" }, [el("span", { class: "hq-chip" + (d.readiness.ready ? " hq-chip--holly" : ""), text: d.readiness.ready ? "Ready" : d.readiness.toDo + " to do" })]),
        ]),
      );
    }
    function fillSheetReady() {
      var d = doors.sheet;
      var list = el("ul", { class: "hq-ready-list" });
      d.readiness.items.forEach(function (i) {
        list.appendChild(el("li", { class: i.done ? "is-done" : "" }, [READY_WORDS[i.key] || i.key, el("span", { class: "hq-sr", text: i.done ? " done" : " to do" })]));
      });
      sheetReady.textContent = "";
      sheetReady.appendChild(el("h3", { class: "hq-h3", text: "Ready for its day when all of these are done" }));
      sheetReady.appendChild(list);
    }
    function updateCloseHint() {
      var h = doorsSheet.querySelector("[data-close]");
      if (!h) return;
      var d = doors.sheet;
      h.className = "hq-hint " + (d.closesTooSoon ? "is-error" : "is-ok");
      h.textContent = d.closesTooSoon ? "It closes less than an hour after the last clue." : "Open past " + hourAfter(d.evening.clue3) + ", an hour after the last clue.";
    }

    /** The names that also count, as chips, each with its remove button (for someone who may edit). */
    function fillNames(box) {
      var d = doors.sheet;
      box.textContent = "";
      d.names.forEach(function (nm) {
        var chip = el("span", { class: "hq-chip" }, [nm.name]);
        if (doors.canEdit) {
          var x = el("button", { class: "hq-chip__x", type: "button", "aria-label": "Remove " + nm.name, text: "×" });
          x.addEventListener("click", function () {
            x.disabled = true;
            ask("DELETE", "/api/admin/elf/doors/" + d.door + "/names/" + nm.id)
              .then(function (r) {
                takeDoor(r.door, { names: true, say: ["place", "Name taken off."], focusId: "hqDoor-newName" });
              })
              .catch(function (e) {
                say(partLine("place"), e.message, false);
                x.disabled = false;
              });
          });
          chip.appendChild(x);
        }
        box.appendChild(chip);
      });
    }

    /** One part: a heading, its fields, its own Save and its own status line. `send` gives only this
     *  part's own fields (null when nothing changed), and is left out when there is nothing to save. */
    function makePart(key, title, soft, body, send) {
      var d = doors.sheet;
      var said = el("p", { class: "hq-status", role: "status", tabindex: "-1" });
      var kids = [el("header", {}, [el("h3", { class: "hq-h3", text: title }), soft ? el("span", { class: "hq-soft", text: soft }) : null])].concat(body);
      if (doors.canEdit && send) {
        var save = el("button", { class: "hq-btn hq-btn--small hq-btn--go", type: "button", text: "Save", "aria-label": "Save " + title.toLowerCase() });
        save.addEventListener("click", function () {
          var sent = send();
          if (!sent) {
            say(said, "Nothing has changed.", null);
            return;
          }
          // Focus goes to the new Save button only if it was in this part when Save was pressed.
          var held = !!(part && doc.activeElement && part.contains(doc.activeElement));
          save.disabled = true;
          ask("PATCH", "/api/admin/elf/doors/" + d.door, sent)
            .then(function (r) {
              takeDoor(r.door, { rebuild: [key], say: [key, "Saved."], focus: held ? key : null });
            })
            .catch(function (e) {
              say(said, e.message, false);
              save.disabled = false;
            });
        });
        kids.push(el("div", { class: "hq-actions" }, [save]));
      }
      kids.push(said);
      var part = el("section", { class: "hq-dpart", "data-part": key }, kids);
      return part;
    }

    function buildPart(key) {
      if (/^clue[123]$/.test(key)) return clueItem(Number(key.slice(4)));
      return { place: placePart, evening: eveningPart, prize: prizePart, elf: elfPart, clues: cluesPart, prints: printsPart, snow: snowPart }[key]();
    }

    // ---- the three clues ----
    var CLUE_MAX = 500;
    var CLUE_LEVEL = ["Hardest", "Easier", "Nearly a giveaway"];

    /** The three clues. Each has its own Save and its own status line, so saving one touches only it. */
    function cluesPart() {
      var list = el("ol", { class: "hq-clues" });
      [1, 2, 3].forEach(function (n) {
        list.appendChild(clueItem(n));
      });
      return el("section", { class: "hq-dpart", "data-part": "clues" }, [
        el("header", {}, [el("h3", { class: "hq-h3", text: "The three clues" }), el("span", { class: "hq-soft", text: "From hardest to nearly a giveaway" })]),
        list,
      ]);
    }

    function clueName(n, d) {
      var time = clockWords(d.evening && d.evening["clue" + n]);
      return "Clue " + n + (time ? " · " + time : "");
    }
    function printsWords(d) {
      return "The staff card names the day and the tag carries the word, so both are for " + (d.placeName || "this place") + " only.";
    }

    // ---- a clue's picture ----
    var PIC_TYPES = ["image/jpeg", "image/png", "image/webp"];
    var PIC_MAX_BYTES = 2 * 1024 * 1024;
    var PIC_MAX_PX = 1600;
    var PIC_QUALITY = 0.86;
    var PIC_LOWER_QUALITY = 0.7; // one more try if the first drawing is over 2 MB
    var PIC_WORDS = {
      type: "That picture is not one we can use. Try a JPG, PNG or WebP photo.",
      size: "That picture is too big. Try a smaller one.",
      read: "That picture could not be opened. Please try another.",
      choose: "Choose a picture first.",
      alt: "Describe the picture in a few words, for anyone who cannot see it.",
    };
    // The browser addresses made for each clue's pictures: the stored picture fetched for the sheet and the
    // one just chosen. Each is let go of when it is replaced or when the clue is drawn again.
    var clueBlobs = { 1: [], 2: [], 3: [] };
    var clueDraws = { 1: 0, 2: 0, 3: 0 };

    function freeAddress(url) {
      if (url && win.URL && typeof win.URL.revokeObjectURL === "function") win.URL.revokeObjectURL(url);
    }
    /** Lets go of every address made for one clue's picture. */
    function freeClueBlobs(n) {
      clueBlobs[n].forEach(freeAddress);
      clueBlobs[n] = [];
    }
    function keepAddress(n, url) {
      clueBlobs[n].push(url);
    }
    function dropAddress(n, url) {
      clueBlobs[n] = clueBlobs[n].filter(function (u) { return u !== url; });
      freeAddress(url);
    }

    // The chosen file read into something the page can show, and drawn again smaller as a fresh JPEG.
    // Both can be replaced through opts.read and opts.make (the unit tests have no canvas).
    var readPicture =
      opts.read ||
      function (file) {
        return new Promise(function (done) {
          if (!win.URL || !win.URL.createObjectURL || typeof win.Image !== "function") return done(null);
          var src = win.URL.createObjectURL(file);
          var img = new win.Image();
          img.onload = function () {
            done({ src: src, width: img.naturalWidth, height: img.naturalHeight, img: img });
          };
          img.onerror = function () {
            freeAddress(src);
            done(null);
          };
          img.src = src;
        });
      };
    var makePicture =
      opts.make ||
      function (pic, quality) {
        return new Promise(function (done) {
          try {
            var canvas = doc.createElement("canvas");
            if (!canvas.getContext || !pic || !pic.img) return done(null);
            var scale = Math.min(1, PIC_MAX_PX / Math.max(pic.width, pic.height));
            canvas.width = Math.max(1, Math.round(pic.width * scale));
            canvas.height = Math.max(1, Math.round(pic.height * scale));
            var ctx = canvas.getContext("2d");
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(pic.img, 0, 0, canvas.width, canvas.height);
            var url = canvas.toDataURL("image/jpeg", quality || PIC_QUALITY);
            var comma = url.indexOf(",");
            if (comma === -1 || url.indexOf("data:image/jpeg") !== 0) return done(null);
            done({ mime: "image/jpeg", base64: url.slice(comma + 1) });
          } catch (e) {
            done(null);
          }
        });
      };
    function base64Bytes(b64) {
      var pad = /==$/.test(b64) ? 2 : /=$/.test(b64) ? 1 : 0;
      return Math.floor((b64.length * 3) / 4) - pad;
    }
    /** A file as it is, in base64, for a browser that cannot draw the picture again. */
    function rawBase64(file) {
      return new Promise(function (done) {
        if (typeof win.FileReader !== "function") return done(null);
        var reader = new win.FileReader();
        reader.onload = function () {
          var url = String(reader.result || "");
          var comma = url.indexOf(",");
          done(comma === -1 ? null : url.slice(comma + 1));
        };
        reader.onerror = function () {
          done(null);
        };
        reader.readAsDataURL(file);
      });
    }
    /** The picture to send: { mime, base64 } drawn again smaller, the file as it came if it cannot be, or { error }. */
    function preparePicture(file, pic) {
      var made = pic ? makePicture(pic) : Promise.resolve(null);
      return made
        .then(function (small) {
          if (small && small.base64 && base64Bytes(small.base64) > PIC_MAX_BYTES) {
            return makePicture(pic, PIC_LOWER_QUALITY).then(function (lower) {
              return lower && lower.base64 ? lower : small;
            });
          }
          return small;
        })
        .then(function (small) {
          if (small && small.base64) return small;
          if (PIC_TYPES.indexOf(file.type) === -1) return { error: PIC_WORDS.type };
          if (file.size > PIC_MAX_BYTES) return { error: PIC_WORDS.size };
          return rawBase64(file).then(function (b64) {
            return b64 ? { mime: file.type, base64: b64 } : { error: PIC_WORDS.read };
          });
        });
    }

    /** The picture on a clue, fetched with the bearer token into a Blob address, as the prints are. */
    function cluePictureView(n, d, alt) {
      var draw = clueDraws[n];
      var img = el("img", { class: "hq-clue-pic__img", alt: alt || "A picture for this clue", width: 480, height: 360 });
      win
        .fetch("/api/admin/elf/doors/" + d.door + "/clues/" + n + "/picture", { headers: { Authorization: "Bearer " + token() } })
        .then(function (res) {
          if (!res.ok) throw new Error("no picture");
          return res.blob();
        })
        .then(function (blob) {
          if (!win.URL || typeof win.URL.createObjectURL !== "function") return;
          var url = win.URL.createObjectURL(blob);
          if (draw !== clueDraws[n]) return freeAddress(url); // the clue was drawn again while this was on its way
          keepAddress(n, url);
          img.setAttribute("src", url);
        })
        .catch(function () { /* the words say there is a picture; the image stays empty */ });
      return el("figure", { class: "hq-clue-pic" }, [img, el("figcaption", { class: "hq-hint", text: alt ? "Described as: " + alt : "No description" })]);
    }

    /** Add a picture, and Take the picture off, for a clue that is not out. */
    function cluePictureEditor(n, d, stored, said, key) {
      var chosen = null; // the picture read from the chosen file
      var picturing = Promise.resolve();
      var previewUrl = null;
      var draw = clueDraws[n];
      var file = el("input", { type: "file", id: "hqDoor-" + key + "-picture", accept: PIC_TYPES.join(","), "aria-describedby": "hqDoor-" + key + "-alt-hint" });
      var preview = el("div", { class: "hq-pic-preview", hidden: true });
      var alt = el("input", { type: "text", id: "hqDoor-" + key + "-alt", maxlength: 200, autocomplete: "off", "aria-describedby": "hqDoor-" + key + "-alt-hint" });
      if (stored && stored.pictureAlt) alt.value = stored.pictureAlt;
      var send = el("button", { class: "hq-btn hq-btn--small hq-btn--go", type: "button", text: "Save the picture", "aria-label": "Save the picture for clue " + n });
      var take = stored && stored.hasPicture ? el("button", { class: "hq-btn hq-btn--small", type: "button", text: "Take the picture off", "aria-label": "Take the picture off clue " + n }) : null;

      function letGoOfPreview() {
        if (previewUrl) dropAddress(n, previewUrl);
        previewUrl = null;
        preview.textContent = "";
        preview.hidden = true;
      }
      file.addEventListener("change", function () {
        var f = file.files && file.files.length ? file.files[0] : null;
        chosen = null;
        letGoOfPreview();
        if (!f) return;
        picturing = Promise.resolve(readPicture(f)).then(function (pic) {
          if (draw !== clueDraws[n]) {
            if (pic && pic.src) freeAddress(pic.src);
            return;
          }
          chosen = pic;
          if (pic && pic.src) {
            previewUrl = pic.src;
            keepAddress(n, pic.src);
            preview.appendChild(el("img", { src: pic.src, alt: "", width: 240, height: 180 }));
            preview.hidden = false;
          }
        });
      });
      send.addEventListener("click", function () {
        var f = file.files && file.files.length ? file.files[0] : null;
        if (!f) return say(said, PIC_WORDS.choose, false);
        var words = alt.value.trim();
        if (words === "" || words.length > 200) return say(said, PIC_WORDS.alt, false);
        send.disabled = true;
        say(said, "Sending the picture…", null);
        picturing
          .then(function () { return preparePicture(f, chosen); })
          .then(function (out) {
            if (out.error) throw new Error(out.error);
            return ask("PUT", "/api/admin/elf/doors/" + d.door + "/clues/" + n + "/picture", { mime: out.mime, dataBase64: out.base64, alt: words });
          })
          .then(function (r) {
            takeDoor(r.door, { rebuild: [key], say: [key, "Picture saved."], focus: key });
          })
          .catch(function (e) {
            say(said, (e.fields && e.fields.photo) || e.message, false);
            send.disabled = false;
            if (e.status === 409) reopenAfterClueOut(d.door, key, e.message);
          });
      });
      if (take) {
        take.addEventListener("click", function () {
          take.disabled = true;
          ask("DELETE", "/api/admin/elf/doors/" + d.door + "/clues/" + n + "/picture")
            .then(function (r) {
              takeDoor(r.door, { rebuild: [key], say: [key, "Picture taken off."], focus: key });
            })
            .catch(function (e) {
              say(said, e.message, false);
              take.disabled = false;
              if (e.status === 409) reopenAfterClueOut(d.door, key, e.message);
            });
        });
      }
      var buttons = el("div", { class: "hq-actions" }, [send, take]);
      return el("div", { class: "hq-clue-pic-edit" }, [
        el("div", { class: "hq-field" }, [el("label", { for: "hqDoor-" + key + "-picture", text: "Add a picture" }), file]),
        preview,
        el("div", { class: "hq-field" }, [
          el("label", { for: "hqDoor-" + key + "-alt", text: "What is in the picture" }),
          alt,
          el("span", { class: "hq-hint", id: "hqDoor-" + key + "-alt-hint", text: "Say what is in it, for anyone who cannot see it." }),
        ]),
        buttons,
      ]);
    }

    /** The clue went out while it was being worked on: the door is read again, so it shows read only. */
    function reopenAfterClueOut(door, key, words) {
      openDoor(door, false).then(function () {
        if (doors.open === door && partLine(key)) say(partLine(key), words, false);
      });
    }

    function clueItem(n) {
      var d = doors.sheet;
      var key = "clue" + n;
      var out = !!(d.clueOut && d.clueOut[n - 1]);
      var time = clockWords(d.evening && d.evening[key]);
      var stored = (d.clues || []).filter(function (c) { return c.n === n; })[0];
      // Drawn again: the addresses made for the last drawing of this clue's picture are let go of.
      freeClueBlobs(n);
      clueDraws[n]++;
      var was = stored && stored.words ? stored.words : "";
      var box = doorInput(key, was, null, "area", out);
      box.setAttribute("placeholder", "Not written yet");
      var count = el("span", { class: "hq-hint hq-count-words" });
      var said = el("p", { class: "hq-status", role: "status", tabindex: "-1" });
      var drawCount = function () {
        var len = box.value.length;
        count.textContent = len + " of " + CLUE_MAX;
        count.classList.toggle("is-error", len > CLUE_MAX);
      };
      drawCount();
      box.addEventListener("input", drawCount);
      var kids = [
        el("header", {}, [el("label", { class: "hq-clue__name", for: "hqDoor-" + key, text: clueName(n, d) }), el("span", { class: "hq-soft", text: CLUE_LEVEL[n - 1] })]),
        box,
      ];
      if (out) {
        kids.push(el("p", { class: "hq-words hq-soft", text: "Out since " + time + "." }));
      } else {
        var row = el("div", { class: "hq-actions" }, [count]);
        if (doors.canEdit) {
          var save = el("button", { class: "hq-btn hq-btn--small hq-btn--go", type: "button", text: "Save", "aria-label": "Save clue " + n });
          save.addEventListener("click", function () {
            if (box.value.length > CLUE_MAX) {
              say(said, "A clue can be up to " + CLUE_MAX + " characters.", false);
              return;
            }
            var words = box.value.trim() === "" ? null : box.value;
            if (words === (was || null)) {
              say(said, "Nothing has changed.", null);
              return;
            }
            save.disabled = true;
            ask("PUT", "/api/admin/elf/doors/" + d.door + "/clues/" + n, { words: words })
              .then(function (r) {
                takeDoor(r.door, { rebuild: [key], say: [key, "Saved."], focus: key });
              })
              .catch(function (e) {
                say(said, e.message, false);
                save.disabled = false;
                if (e.status === 409) {
                  // The clue went out while it was being typed: the door is read again, so it shows read only.
                  openDoor(d.door, false).then(function () {
                    if (doors.open === d.door && partLine(key)) say(partLine(key), e.message, false);
                  });
                }
              });
          });
          row.insertBefore(save, count);
        }
        kids.push(row);
      }
      if (stored && stored.hasPicture) kids.push(cluePictureView(n, d, stored.pictureAlt));
      if (!out && doors.canEdit) kids.push(cluePictureEditor(n, d, stored, said, key));
      kids.push(said);
      return el("li", { class: "hq-clue hq-clue--" + n, "data-part": key }, [el("span", { class: "hq-clue__n", "aria-hidden": "true", text: String(n) }), el("div", { class: "hq-clue__body" }, kids)]);
    }

    // ---- prints and the drop off ticks ----
    /** "2026-11-20T10:00:00Z" as "20 November", on the London calendar. */
    function dayWords(iso) {
      try {
        return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "Europe/London" });
      } catch (e) {
        return "";
      }
    }

    /**
     * A print, in a new tab. The tab opens on the click itself (so no pop up blocker stops it), the page
     * is fetched with the bearer token, and shown from memory through a Blob address that is let go of
     * after two minutes. A JSON error answer is shown in `target` instead; a whole HTML page, even one
     * saying what a door still needs, is shown in the tab.
     */
    function openPrint(url, target) {
      var tab = win.open("", "_blank");
      if (!tab) {
        say(target, "Your browser stopped the new tab. Let this site open new tabs, then try again.", false);
        return Promise.resolve();
      }
      try {
        tab.opener = null; // the blob page is this site's own, so it must not reach back into this tab
      } catch (e) { /* a tab that will not let go still opens */ }
      try {
        tab.document.title = "Opening";
        tab.document.body.textContent = "Opening, one moment.";
      } catch (e) { /* a tab we cannot write to still navigates */ }
      var fail = function (words) {
        if (tab && !tab.closed) tab.close();
        say(target, words, false);
      };
      return win
        .fetch(url, { headers: { Authorization: "Bearer " + token() } })
        .then(function (res) {
          return Promise.resolve(res.text()).then(function (page) {
            var asJson = null;
            try {
              asJson = JSON.parse(page);
            } catch (e) { /* an HTML page */ }
            if (res.status === 401) return fail(WORDS.signedOut);
            if (asJson && typeof asJson === "object") {
              if (res.status === 403 && asJson.error === "forbidden") return fail(WORDS.notAllowed);
              if (!res.ok) return fail(asJson.error || WORDS.didNotWork);
            }
            var blob = win.URL.createObjectURL(new win.Blob([page], { type: "text/html" }));
            if (tab && !tab.closed) tab.location.href = blob;
            else win.open(blob, "_blank");
            win.setTimeout(function () {
              win.URL.revokeObjectURL(blob);
            }, 120000);
            say(target, "", null);
          });
        })
        .catch(function () {
          fail(WORDS.didNotWork);
        });
    }

    function printsPart() {
      var d = doors.sheet;
      var said = el("p", { class: "hq-status", role: "status", tabindex: "-1" });
      var row = el("div", { class: "hq-actions hq-prints" });
      [["Print the poster", "poster"], ["Print the staff card", "staff-card"], ["Print the tag", "tag"]].forEach(function (p) {
        var b = el("button", { class: "hq-btn", type: "button", text: p[0] });
        b.addEventListener("click", function () {
          if (b.disabled) return;
          b.disabled = true; // one tab for one click
          openPrint("/api/admin/elf/doors/" + d.door + "/" + p[1], said).then(function () {
            b.disabled = false;
          });
        });
        row.appendChild(b);
      });
      var tickRow = function (path, id, words, at, by) {
        var box = el("input", { type: "checkbox", id: id, name: id, disabled: !doors.canEdit });
        box.checked = !!at;
        box.addEventListener("change", function () {
          var on = box.checked;
          box.disabled = true;
          ask(on ? "POST" : "DELETE", "/api/admin/elf/doors/" + d.door + "/" + path)
            .then(function (r) {
              takeDoor(r.door, { rebuild: ["prints"], say: ["prints", "Saved."], focusId: id });
            })
            .catch(function (e) {
              box.checked = !on;
              box.disabled = false;
              say(said, e.message, false);
            });
        });
        var who = at ? "Ticked by " + (by || "staff") + " on " + dayWords(at) : "";
        return el("div", { class: "hq-dtick" }, [el("label", { class: "hq-tickbox", for: id }, [box, el("span", { text: words })]), who ? el("span", { class: "hq-hint", text: who }) : null]);
      };
      return el("section", { class: "hq-dpart", "data-part": "prints" }, [
        el("header", {}, [el("h3", { class: "hq-h3", text: "Print and drop off" })]),
        row,
        el("p", { class: "hq-words hq-soft", "data-prints-place": "", text: printsWords(d) }),
        el("div", { class: "hq-handover" }, [
          tickRow("dropped-off", "hqDoor-droppedOff", "Elf, poster, prize and staff card dropped off", d.droppedOffAt, d.droppedOffBy),
          el("p", { class: "hq-words hq-soft", text: "Ticking it keeps who did it and when." }),
          tickRow("thanked", "hqDoor-thanked", "Thank you sent", d.thankedAt, d.thankedBy),
        ]),
        said,
      ]);
    }

    /** If the door cannot run: a snow day (before its first clue) and, after its day, gone home. */
    function snowPart() {
      var d = doors.sheet;
      var n = d.door;
      var edit = doors.canEdit;
      var said = el("p", { class: "hq-status", role: "status", tabindex: "-1" });
      var kids = [el("header", {}, [el("h3", { class: "hq-h3", text: "If the door cannot run" })])];
      var rebuilt = function (r, words) {
        takeDoor(r.door, { rebuild: ["snow"], say: ["snow", words], focusId: "hqDoor-snowAction" });
      };
      if (d.snowDay) {
        var automatic = d.snowDay.by === "automatic";
        kids.push(
          el("p", {
            class: "hq-words",
            text: automatic ? "Snow day: the door was not ready at its first clue" : "Snow day called by " + who(d.snowDay.by) + " on " + dayWords(d.snowDay.at),
          }),
        );
        if (edit && !d.started) {
          var cancel = el("button", { class: "hq-btn hq-btn--small", type: "button", id: "hqDoor-snowAction", text: "Cancel the snow day" });
          cancel.addEventListener("click", function () {
            cancel.disabled = true;
            ask("DELETE", "/api/admin/elf/doors/" + n + "/snow-day")
              .then(function (r) {
                rebuilt(r, "The snow day is cancelled.");
              })
              .catch(function (e) {
                say(said, e.message, false);
                cancel.disabled = false;
              });
          });
          kids.push(el("div", { class: "hq-actions" }, [cancel]));
        }
      } else {
        kids.push(el("p", { class: "hq-words hq-soft", text: d.started ? "No snow day was called." : "A snow day can be called until the first clue is out." }));
        if (edit && !d.started) {
          var call = el("button", { class: "hq-btn hq-btn--small", type: "button", id: "hqDoor-snowAction", text: "Call a snow day" });
          var slot = el("div", {});
          call.addEventListener("click", function () {
            if (slot.querySelector(".hq-confirm")) return;
            var yes = el("button", { class: "hq-btn hq-btn--small hq-btn--danger", type: "button", text: "Yes, call a snow day" });
            var no = el("button", { class: "hq-btn hq-btn--small", type: "button", text: "Not yet" });
            var sure = el("div", { class: "hq-confirm", role: "group", "aria-label": "Are you sure?" }, [
              el("p", { class: "hq-words", text: "Call a snow day for door " + n + "? Its elf will be snowed in, and every detective gets the door done." }),
              yes,
              no,
            ]);
            no.addEventListener("click", function () {
              sure.remove();
              call.focus();
            });
            yes.addEventListener("click", function () {
              yes.disabled = true;
              no.disabled = true;
              ask("POST", "/api/admin/elf/doors/" + n + "/snow-day")
                .then(function (r) {
                  rebuilt(r, "Snow day called.");
                })
                .catch(function (e) {
                  sure.remove();
                  say(said, e.message, false);
                });
            });
            slot.appendChild(sure);
            yes.focus();
          });
          kids.push(el("div", { class: "hq-actions" }, [call]));
          kids.push(slot);
        }
      }
      if (d.dayOver) {
        var box = el("input", { type: "checkbox", id: "hqDoor-goneHome", name: "goneHome", disabled: !edit });
        box.checked = !!d.goneHome;
        box.addEventListener("change", function () {
          var on = box.checked;
          box.disabled = true;
          ask(on ? "POST" : "DELETE", "/api/admin/elf/doors/" + n + "/gone-home")
            .then(function (r) {
              takeDoor(r.door, { rebuild: ["snow"], say: ["snow", "Saved."], focusId: "hqDoor-goneHome" });
            })
            .catch(function (e) {
              box.checked = !on;
              box.disabled = false;
              say(said, e.message, false);
            });
        });
        kids.push(
          el("div", { class: "hq-dtick" }, [
            el("label", { class: "hq-tickbox", for: "hqDoor-goneHome" }, [box, el("span", { text: "Gone home: the place has stopped hosting the elf" })]),
            d.goneHome ? el("span", { class: "hq-hint", text: "Ticked by " + (who(d.goneHome.by) || "staff") + " on " + dayWords(d.goneHome.at) }) : null,
          ]),
        );
      }
      kids.push(said);
      return el("section", { class: "hq-dpart hq-snow", "data-part": "snow" }, kids);
    }

    // ---- the tools under the level select: the list of places, the prize list, paste all the clues ----
    var PASTE_EXAMPLE = [
      "Door 7: anything after the number is a note for people and is ignored",
      "Clue 1: the words of clue 1",
      "Clue 2: the words of clue 2,",
      "which can run on to more lines",
      "Clue 3: the words of clue 3",
    ].join("\n");

    function drawDoorTools() {
      doorsTools.textContent = "";
      var line = el("p", { class: "hq-status", role: "status", tabindex: "-1" });
      var slot = el("div", { class: "hq-tool-slot" });
      var places = el("button", { class: "hq-btn hq-btn--small", type: "button", text: "Print the list of places" });
      places.addEventListener("click", function () {
        if (places.disabled) return;
        places.disabled = true;
        openPrint("/api/admin/elf/places-list", line).then(function () {
          places.disabled = false;
        });
      });
      var copy = el("button", { class: "hq-btn hq-btn--small", type: "button", text: "Copy the prize list" });
      copy.addEventListener("click", function () {
        copy.disabled = true;
        var copied = function () {
          slot.textContent = "";
          say(line, "Copied. Send it to Claude for the door pictures.", true);
        };
        var byHand = function (text) {
          say(line, "Your browser would not copy it. Copy it from the box.", false);
          slot.textContent = "";
          var box = el("textarea", { id: "hqPrizeList", class: "hq-grow hq-find", readonly: true, "aria-label": "The prize list" });
          box.value = text;
          slot.appendChild(box);
          fitField(box);
          box.focus();
          box.select();
        };
        var viaText = function (text) {
          var clip = win.navigator && win.navigator.clipboard;
          if (!clip || !clip.writeText) return byHand(text);
          return Promise.resolve()
            .then(function () {
              return clip.writeText(text);
            })
            .then(copied, function () {
              byHand(text);
            });
        };
        var list = ask("GET", "/api/admin/elf/doors").then(function (d) {
          return d.prizeList || "";
        });
        var run;
        var clip = win.navigator && win.navigator.clipboard;
        if (clip && clip.write && win.ClipboardItem) {
          // Safari allows a clipboard write only inside the click itself, so it is made now, with the
          // words still on their way: the item takes a promise for them.
          try {
            var item = new win.ClipboardItem({
              "text/plain": list.then(function (text) {
                return new win.Blob([text], { type: "text/plain" });
              }),
            });
            run = Promise.resolve(clip.write([item])).then(copied, function () {
              return list.then(viaText);
            });
          } catch (e) {
            run = list.then(viaText);
          }
        } else {
          run = list.then(viaText);
        }
        run
          .catch(function (e) {
            say(line, e.message, false);
          })
          .then(function () {
            copy.disabled = false;
          });
      });
      var kids = [places, copy];
      if (doors.canEdit) {
        var paste = el("button", { class: "hq-btn hq-btn--small", type: "button", text: "Paste all the clues", "aria-expanded": "false" });
        paste.addEventListener("click", function () {
          var open = !!doorsTools.querySelector(".hq-paste");
          paste.setAttribute("aria-expanded", String(!open));
          if (open) {
            doorsTools.querySelector(".hq-paste").remove();
            return;
          }
          doorsTools.appendChild(pastePanel());
          var box = doorsTools.querySelector("#hqPasteText");
          if (box) box.focus();
        });
        kids.push(paste);
      }
      doorsTools.appendChild(el("div", { class: "hq-actions" }, kids));
      doorsTools.appendChild(line);
      doorsTools.appendChild(slot);
      doorsTools.appendChild(el("p", { class: "hq-hint", text: "The prize list is the one you send to Claude for the door pictures. The list of places is for staff only: it names every place and its day." }));
    }

    function pastePanel() {
      var box = el("textarea", { id: "hqPasteText", class: "hq-grow", name: "pasted", "aria-describedby": "hqPasteHelp" });
      box.addEventListener("input", function () {
        fitField(box);
        result.textContent = ""; // what was checked is no longer what is in the box
      });
      var result = el("div", { class: "hq-paste-result" });
      var said = el("p", { class: "hq-status", role: "status", tabindex: "-1" });
      var check = el("button", { class: "hq-btn hq-btn--go", type: "button", text: "Check these clues" });
      check.addEventListener("click", function () {
        var text = box.value;
        check.disabled = true;
        say(said, "", null);
        ask("POST", "/api/admin/elf/clues/check", { text: text })
          .then(function (r) {
            drawPasteResult(result, r, function () {
              return savePaste(text, result, said, (r.doors || []).map(function (p) { return p.door; }));
            });
          })
          .catch(function (e) {
            result.textContent = "";
            say(said, e.message, false);
          })
          .then(function () {
            check.disabled = false;
          });
      });
      return el("section", { class: "hq-paste", "aria-label": "Paste all the clues" }, [
        el("h3", { class: "hq-h3", text: "Paste all the clues" }),
        el("p", { class: "hq-words", id: "hqPasteHelp", text: "Paste every clue in one go. Each door starts with its number, then its three clues, like this:" }),
        el("pre", { class: "hq-example", text: PASTE_EXAMPLE }),
        el("div", { class: "hq-field" }, [el("label", { for: "hqPasteText", text: "The clues" }), box]),
        el("div", { class: "hq-actions" }, [check]),
        said,
        result,
      ]);
    }

    function drawPasteResult(result, r, onSave) {
      result.textContent = "";
      var found = el("ul", { class: "hq-paste-found" });
      (r.doors || []).forEach(function (p) {
        var clues = el("ol", { class: "hq-paste-clues" });
        (p.clues || []).forEach(function (c) {
          clues.appendChild(el("li", { text: "Clue " + c.n + ": " + c.words }));
        });
        found.appendChild(el("li", {}, [el("b", { text: "Door " + p.door + " · " + (p.placeName || "No place yet") }), clues]));
      });
      if (found.children.length) result.appendChild(found);
      var problems = r.problems || [];
      if (problems.length) {
        var bad = el("ul", { class: "hq-paste-problems" });
        problems.forEach(function (p, i) {
          bad.appendChild(el("li", { class: "is-error", tabindex: i === 0 ? "-1" : null, text: p.message }));
        });
        result.appendChild(bad);
        bad.firstChild.focus();
        return;
      }
      var save = el("button", { class: "hq-btn hq-btn--go", type: "button", text: "Save these clues" });
      save.addEventListener("click", function () {
        save.disabled = true;
        onSave().then(function (ok) {
          if (!ok) save.disabled = false;
        });
      });
      result.appendChild(el("div", { class: "hq-actions" }, [save]));
      save.focus();
    }

    /**
     * Saves the checked text, then brings the tiles up to date, and the open door's clues too when that
     * door was one of `pasted`. Any other open door keeps whatever is typed in it.
     */
    function savePaste(text, result, said, pasted) {
      return ask("POST", "/api/admin/elf/clues/save", { text: text })
        .then(function (r) {
          result.textContent = "";
          say(said, "Saved " + r.clues + " " + plural(r.clues, "clue", "clues") + " for " + r.doors + " " + plural(r.doors, "door", "doors") + ".", true);
          said.focus();
          var open = doors.open;
          var refresh = open && pasted.indexOf(open) >= 0;
          return ask("GET", "/api/admin/elf/doors")
            .then(function (d) {
              doors.list = d.doors || doors.list;
              doors.counts = d.counts || doors.counts;
              // The counts are new, so no door's old readiness may be compared with them again.
              var keep = open ? doors.known[open] : null;
              doors.known = {};
              if (keep) doors.known[open] = keep;
              drawDoorList();
              return refresh ? ask("GET", "/api/admin/elf/doors/" + open) : null;
            })
            .then(function (d) {
              if (!d || !d.door) return;
              doors.known[d.door.door] = d.door.readiness;
              takeDoor(d.door, { rebuild: ["clue1", "clue2", "clue3"] });
            })
            .catch(function () { /* the clues are saved; the tiles stay as they were until the page is loaded again */ })
            .then(function () {
              return true;
            });
        })
        .catch(function (e) {
          if (e.problems && e.problems.length) {
            drawPasteResult(result, { doors: [], problems: e.problems }, null);
            say(said, e.message, false);
            return true; // nothing to save again until the text is fixed and checked
          }
          say(said, e.message, false);
          return false;
        });
    }

    function placePart() {
      var d = doors.sheet;
      var edit = doors.canEdit;
      var placeIn = {
        placeName: doorInput("placeName", d.placeName, 80, "area"),
        placeTown: doorInput("placeTown", d.placeTown, 60),
        placeAddress: doorInput("placeAddress", d.placeAddress, 200, "area"),
        contactName: doorInput("contactName", d.contactName, 80),
        contactPhone: doorInput("contactPhone", d.contactPhone, 40),
        contactEmail: doorInput("contactEmail", d.contactEmail, 254, "email"),
        elfSpot: doorInput("elfSpot", d.elfSpot, 200, "area"),
        agreedBy: doorInput("agreedBy", d.agreedBy, 80),
      };
      // One name, however long: it wraps instead of running past its box, and never holds a line break.
      placeIn.placeName.addEventListener("keydown", function (e) {
        if (e.key === "Enter") e.preventDefault();
      });
      placeIn.placeName.addEventListener("input", function () {
        if (/[\r\n]/.test(placeIn.placeName.value)) {
          placeIn.placeName.value = placeIn.placeName.value.replace(/\s*[\r\n]+\s*/g, " ");
          fitField(placeIn.placeName);
        }
      });
      var names = el("div", { class: "hq-names" });
      fillNames(names);
      var newName = doorInput("newName", "", 80);
      var nameRow = el("div", { class: "hq-addname" }, [newName]);
      if (edit) {
        var add = el("button", { class: "hq-btn hq-btn--small", type: "button", text: "Add a name" });
        add.addEventListener("click", function () {
          if (!newName.value.trim()) return;
          add.disabled = true;
          ask("POST", "/api/admin/elf/doors/" + d.door + "/names", { name: newName.value })
            .then(function (r) {
              add.disabled = false;
              newName.value = "";
              takeDoor(r.door, { names: true, say: ["place", "Name added."], focusId: "hqDoor-newName" });
            })
            .catch(function (e) {
              say(partLine("place"), e.message, false);
              add.disabled = false;
            });
        });
        nameRow.appendChild(add);
      }
      var closes = doorInput("closesAt", clock5(d.closesAt), null, "time");
      var closeHint = el("span", { "data-close": "" });
      return makePart(
        "place",
        "The place",
        "Typed in once the place says yes",
        [
          el("div", { class: "hq-dfields" }, [
            doorField("placeName", "Name of the place", placeIn.placeName),
            doorField("placeTown", "Town", placeIn.placeTown),
            el("div", { class: "hq-field is-wide" }, [
              el("label", { for: "hqDoor-newName", text: "Other names that also count" }),
              names,
              nameRow,
              el("span", { class: "hq-hint", text: "Families type where they think the elf is. Any of these names counts as right." }),
            ]),
            doorField("placeAddress", "Address", placeIn.placeAddress, null, true),
            doorField("contactName", "Who to talk to", placeIn.contactName),
            doorField("contactPhone", "Phone", placeIn.contactPhone),
            doorField("contactEmail", "Email", placeIn.contactEmail, el("span", { class: "hq-hint", text: "The reminder on its day goes here." })),
            doorField("closesAt", "Open on its day until", closes, closeHint),
            doorField("elfSpot", "Where the elf sits", placeIn.elfSpot, null, true),
            doorField("agreedBy", "Agreed by", placeIn.agreedBy),
          ]),
        ],
        function () {
          // The place's own fields, and never a time of the evening.
          var sent = {};
          Object.keys(placeIn).forEach(function (k) {
            sent[k] = placeIn[k].value;
          });
          sent.closesAt = closes.value;
          return sent;
        },
      );
    }

    function eveningPart() {
      var d = doors.sheet;
      var TIMES = [["clue1Time", "clue1", "Elf and poster out, clue 1"], ["clue2Time", "clue2", "Clue 2"], ["clue3Time", "clue3", "Clue 3"], ["revealTime", "reveal", "Place shown on the door"]];
      var timeIn = {};
      var timeBox = el("div", { class: "hq-times" });
      TIMES.forEach(function (t) {
        timeIn[t[0]] = doorInput(t[0], clock5(d.evening[t[1]]), null, "time", d.started);
        timeBox.appendChild(el("div", { class: "hq-field hq-time" }, [el("label", { for: "hqDoor-" + t[0], text: t[2] }), timeIn[t[0]]]));
      });
      return makePart(
        "evening",
        "Its evening",
        "Usual weekday times. Staff can change any of them.",
        [
          timeBox,
          d.started ? el("p", { class: "hq-words hq-soft", text: "This door's evening has started." }) : null,
          el("p", { class: "hq-words hq-soft", text: "The place gets its reminder email at 9am." }),
          el("p", { class: "hq-words hq-soft", text: "On a school holiday, set clue 1 to the morning." }),
        ],
        d.started
          ? null
          : function () {
              // Only the times the head elf changed: the server's lock after clue 1 compares what is stored.
              var sent = null;
              TIMES.forEach(function (t) {
                if (timeIn[t[0]].value !== clock5(d.evening[t[1]])) {
                  sent = sent || {};
                  sent[t[0]] = timeIn[t[0]].value;
                }
              });
              return sent;
            },
      );
    }

    function prizePart() {
      var d = doors.sheet;
      var prize = doorInput("prize", d.prize, 200, "area");
      var showOff = el("input", { type: "checkbox", id: "hqDoor-prizeShowOff", name: "prizeShowOff", disabled: !doors.canEdit });
      showOff.checked = !!d.prizeShowOff;
      var pic = d.picture
        ? el("div", { class: "hq-door-pic" }, [el("img", { src: d.picture, alt: "The picture for door " + d.door, width: 112, height: 140 })])
        : el("div", { class: "hq-door-pic" }, [el("span", { class: "hq-door-pic__frame", "aria-hidden": "true", text: String(d.door) }), el("p", { class: "hq-soft", text: "Not made yet. It is made from the prize list." })]);
      return makePart(
        "prize",
        "The prize",
        "NBCC provides it. The finder gets it.",
        [
          el("div", { class: "hq-prize" }, [
            el("div", { class: "hq-dfields" }, [
              doorField("prize", "What the prize is", prize, el("span", { class: "hq-hint", text: "A prize must not point at the place giving it." }), true),
              el("label", { class: "hq-tickbox is-wide", for: "hqDoor-prizeShowOff" }, [showOff, el("span", { text: "Show it off on the calendar (a Big prize ribbon)" })]),
            ]),
            pic,
          ]),
        ],
        function () {
          return { prize: prize.value, prizeShowOff: showOff.checked };
        },
      );
    }

    function elfPart() {
      var d = doors.sheet;
      var n = d.door;
      var elfName = doorInput("elfName", d.elfName, 30);
      var tag = el("div", { class: "hq-tagword" }, [el("span", { text: "Word on " + (d.elfName || "the elf") + "'s tag" }), el("b", { text: d.tagWord || "No word yet" })]);
      var wordBox = el("div", { class: "hq-field" });
      var box = makePart(
        "elf",
        "The elf and its tag",
        null,
        [
          el("div", { class: "hq-delf" }, [doorField("elfName", "The elf's name", elfName), el("div", { class: "hq-field" }, [tag]), wordBox]),
          el("p", { class: "hq-words hq-soft", text: "The finder types this word to win the prize. Every family after types it for their candy cane stamp and to add their picture to door " + n + "." }),
        ],
        function () {
          return { elfName: elfName.value };
        },
      );
      if (doors.canEdit) {
        var fresh = el("button", { class: "hq-btn hq-btn--small", type: "button", text: "Make a new word" });
        var line = function () {
          return box.querySelector(".hq-status");
        };
        var makeWord = function (confirm, sure) {
          fresh.disabled = true;
          return ask("POST", "/api/admin/elf/doors/" + n + "/word", confirm ? { confirm: true } : {})
            .then(function (r) {
              if (sure) sure.remove();
              fresh.disabled = false;
              if (!takeDoor(r.door, { say: ["elf", "A new word is ready."] }) || !box.isConnected) return;
              fresh.focus();
            })
            .catch(function (e) {
              fresh.disabled = false;
              if (sure) sure.remove();
              if (!e.printed) {
                say(line(), e.message, false);
                return;
              }
              if (wordBox.querySelector(".hq-confirm")) return; // one question at a time
              var yes = el("button", { class: "hq-btn hq-btn--small hq-btn--danger", type: "button", text: "Yes" });
              var no = el("button", { class: "hq-btn hq-btn--small", type: "button", text: "No" });
              var ask2 = el("div", { class: "hq-confirm", role: "group", "aria-label": "Are you sure?" }, [el("p", { class: "hq-words", text: "This door's tag has been printed. Make a new word anyway?" }), yes, no]);
              no.addEventListener("click", function () {
                ask2.remove();
                fresh.focus();
              });
              yes.addEventListener("click", function () {
                if (yes.disabled) return;
                yes.disabled = true;
                no.disabled = true;
                makeWord(true, ask2);
              });
              wordBox.appendChild(ask2);
              yes.focus();
            });
        };
        fresh.addEventListener("click", function () {
          makeWord(false, null);
        });
        wordBox.appendChild(fresh);
      }
      return box;
    }

    /** The whole sheet, drawn when a door is opened. */
    function drawDoorSheet() {
      var d = doors.sheet;
      doorsSheet.textContent = "";
      if (!d) return;
      sheetHead = el("div", { class: "hq-door-head" });
      sheetReady = el("div", { class: "hq-todo" });
      doorsSheet.appendChild(sheetHead);
      doorsSheet.appendChild(sheetReady);
      fillSheetHead();
      fillSheetReady();
      if (!doors.canEdit) doorsSheet.appendChild(el("p", { class: "hq-words hq-soft", text: "You can look at this door. Changing it needs edit access to Head Elf HQ, which an admin can give in Team." }));
      ["place", "evening", "prize", "elf"].forEach(function (key) {
        doorsSheet.appendChild(buildPart(key));
      });
      doorsSheet.appendChild(buildPart("clues"));
      doorsSheet.appendChild(buildPart("prints"));
      doorsSheet.appendChild(buildPart("snow"));
      updateCloseHint();
      fitFields();
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

      // The phone number that goes on every staff card.
      var phone = el("section", { class: "hq-panel hq-place-phone", "aria-label": "NBCC's phone number for places" });
      phone.appendChild(el("h2", { class: "hq-h2", text: "Phone number for places" }));
      if (!admin) {
        phone.appendChild(el("p", { class: "hq-words", text: "NBCC's phone number for places: " + (s.placePhone || "not set yet") }));
      } else {
        var phoneBox = el("input", { id: "hqPlacePhone", class: "hq-find", type: "tel", autocomplete: "off", maxlength: 40 });
        phoneBox.value = s.placePhone || "";
        phone.appendChild(el("div", { class: "hq-field" }, [el("label", { for: "hqPlacePhone", text: "NBCC's phone number for places" }), phoneBox]));
        phone.appendChild(el("p", { class: "hq-words hq-soft", text: "It goes on every staff card." }));
        var phoneSaid = el("p", { class: "hq-status", role: "status" });
        var phoneSave = el("button", { class: "hq-btn hq-btn--go", type: "button", text: "Save the number" });
        phoneSave.addEventListener("click", function () {
          phoneSave.disabled = true;
          ask("PATCH", "/api/admin/elf/settings", { placePhone: phoneBox.value.trim() })
            .then(function (d) {
              data.settings = d.settings;
              drawSettingsPart();
              var now = parts.settings.querySelector(".hq-place-phone .hq-status");
              if (now) say(now, "Saved.", true);
            })
            .catch(function (e) {
              say(phoneSaid, e.message, false);
              phoneSave.disabled = false;
            });
        });
        phone.appendChild(el("div", { class: "hq-actions" }, [phoneSave]));
        phone.appendChild(phoneSaid);
      }
      grid.appendChild(phone);

      // The private preview link.
      var preview = el("section", { class: "hq-panel hq-preview", "aria-label": "Your private preview" });
      preview.appendChild(el("h2", { class: "hq-h2", text: "Your private preview" }));
      preview.appendChild(el("p", { class: "hq-words", text: s.previewOn ? "A preview link is open. Anyone who has it can see Elf Detective School." : "There is no preview link." }));
      preview.appendChild(el("p", { class: "hq-words hq-soft", text: "A preview link shows every page of Elf Detective School while it is switched off, in the browser that opens it. Payments in the preview are real." }));
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
      // Its own panel after the admin only ones: anyone who may edit can start a practice evening.
      part.appendChild(practicePanel());
    }

    // ---- Settings: the practice door, a pretend evening played through the preview link ----
    // Door 0 of year 0 (src/db/elf-practice.ts), read afresh each time Settings opens. A reading takes a
    // number, and a reading that comes back after anything newer was sent (or came back) is ignored. A start
    // or a clear is not a reading: its answer is always applied, and it bumps the number so that no older
    // reading can land on top of it.
    var NO_PREVIEW_WORDS = "Make a preview link in Settings first: the practice door is played through it.";
    var practice = { loaded: false, answer: null, error: null, asking: false, seq: 0 };

    /** Takes an answer from the practice door's routes. True when it shows the preview link has come or
     *  gone since HQ was read, so all of Settings is drawn again rather than only this panel. */
    function takePractice(d) {
      practice.answer = d && d.practice ? d.practice : null;
      practice.error = null;
      practice.loaded = true;
      var s = data && data.settings;
      if (!s || !d || typeof d.previewOn !== "boolean" || d.previewOn === !!s.previewOn) return false;
      s.previewOn = d.previewOn;
      return true;
    }

    /** Draws the practice door's panel again in its place, or all of Settings when `everything`. */
    function redrawPractice(everything) {
      if (everything) {
        drawSettingsPart();
        return;
      }
      var old = parts.settings.querySelector(".hq-practice");
      if (old && old.parentNode) old.parentNode.replaceChild(practicePanel(), old);
    }

    /** Says something in the practice panel's status line as it is drawn now (it may have been drawn
     *  again while a request was on its way). */
    function practiceSay(words, ok) {
      var now = parts.settings.querySelector(".hq-practice .hq-status");
      if (now) say(now, words, ok);
    }

    function loadPractice() {
      if (practice.asking) return;
      practice.asking = true;
      var mine = ++practice.seq;
      ask("GET", "/api/admin/elf/practice")
        .then(function (d) {
          practice.asking = false;
          if (mine === practice.seq) redrawPractice(takePractice(d));
        })
        .catch(function (e) {
          practice.asking = false;
          if (mine !== practice.seq) return;
          practice.error = e.message;
          practice.loaded = true;
          redrawPractice(false);
        });
    }

    /** Only the site's own kind of link goes in an href: http(s), or a path on this site. */
    function linkable(url) {
      return typeof url === "string" && /^(https?:\/\/|\/(?!\/))/.test(url);
    }

    /** A field: its label, its box, and a hint in small words (never a span, which the label's own style
     *  for ".hq-field > span" would make bold). */
    function practiceField(input, label, hint) {
      return el("div", { class: "hq-field" }, [el("label", { for: input.id, text: label }), input, hint ? el("small", { class: "hq-hint", text: hint }) : null]);
    }

    /** The form that starts a practice evening. The server checks every field and says what is wrong. */
    function practiceForm() {
      var place = el("input", { id: "hqPracticePlace", name: "placeName", type: "text", maxlength: 80, autocomplete: "off", required: true });
      var town = el("input", { id: "hqPracticeTown", name: "placeTown", type: "text", maxlength: 60, autocomplete: "off", required: true });
      var elf = el("input", { id: "hqPracticeElf", name: "elfName", type: "text", maxlength: 30, autocomplete: "off" });
      var gap = el("input", { id: "hqPracticeGap", name: "minutesApart", type: "number", min: 1, max: 30, step: 1, inputmode: "numeric", required: true });
      gap.value = "3";
      var start = el("button", { class: "hq-btn hq-btn--go", type: "submit", text: "Start a practice evening" });
      var form = el("form", { class: "hq-practice__form", novalidate: true }, [
        el("div", { class: "hq-practice__fields" }, [
          practiceField(place, "The pretend place", "The office, say."),
          practiceField(town, "Its town"),
          practiceField(elf, "The elf's name", "Leave it empty for the usual practice elf."),
          practiceField(gap, "Minutes between clues"),
        ]),
        el("div", { class: "hq-actions" }, [start]),
      ]);
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        if (start.disabled) return;
        var sent = { placeName: place.value.trim(), placeTown: town.value.trim() };
        if (elf.value.trim()) sent.elfName = elf.value.trim();
        if (gap.value.trim()) sent.minutesApart = Number(gap.value);
        start.disabled = true;
        practice.seq++;
        ask("POST", "/api/admin/elf/practice", sent)
          .then(function (d) {
            practice.seq++;
            redrawPractice(takePractice(d));
            practiceSay("Started. Clue 1 comes out in a minute.", true);
          })
          .catch(function (err) {
            practiceSay(err.message, false);
            start.disabled = false;
            if (!practice.loaded) loadPractice();
          });
      });
      return form;
    }

    /** A practice evening as it runs: where, the times, whether its elf is found, the word on its tag, the
     *  poster page, and (for someone who may edit) Clear the practice. */
    function practiceRunning(box, p, mayChange) {
      box.appendChild(el("p", { class: "hq-words", text: p.elfName + " is hiding at " + p.placeName + ", " + p.placeTown + "." }));
      box.appendChild(
        el("ul", { class: "hq-practice__times" }, [
          el("li", { text: "Clue 1 comes out at " + timeWords(p.clue1At) }),
          el("li", { text: "Clue 2 comes out at " + timeWords(p.clue2At) }),
          el("li", { text: "Clue 3 comes out at " + timeWords(p.clue3At) }),
          el("li", { text: "The place is shown at " + timeWords(p.revealAt) }),
        ]),
      );
      box.appendChild(el("p", { class: "hq-words", text: p.found ? p.elfName + " has been found." : p.elfName + " is still hiding." }));
      box.appendChild(el("div", { class: "hq-tagword" }, [el("span", { text: "The word on its tag:" }), " ", el("b", { text: p.tagWord })]));
      var actions = el("div", { class: "hq-actions" });
      if (linkable(p.posterUrl)) actions.appendChild(el("a", { class: "hq-btn hq-btn--go", href: p.posterUrl, target: "_blank", rel: "noopener noreferrer", text: "Open the poster page" }));
      if (mayChange) {
        var clear = el("button", { class: "hq-btn hq-btn--danger", type: "button", text: "Clear the practice" });
        clear.addEventListener("click", function () {
          if (clear.disabled) return;
          clear.disabled = true;
          practice.seq++;
          ask("DELETE", "/api/admin/elf/practice")
            .then(function (d) {
              practice.seq++;
              redrawPractice(takePractice(d));
              practiceSay("The practice is cleared.", true);
            })
            .catch(function (err) {
              practiceSay(err.message, false);
              clear.disabled = false;
              if (!practice.loaded) loadPractice();
            });
        });
        actions.appendChild(clear);
      }
      if (actions.childNodes.length) box.appendChild(actions);
    }

    /** The practice door's panel, drawn from what the server last said. */
    function practicePanel() {
      var box = el("section", { class: "hq-panel hq-practice", "aria-label": "The practice door" });
      box.appendChild(el("h2", { class: "hq-h2", text: "The practice door" }));
      if (!practice.loaded) {
        box.appendChild(el("p", { class: "hq-loading", text: WORDS.loading }));
        return box;
      }
      var mayChange = !!(data && data.canEdit);
      var previewOn = !!(data && data.settings && data.settings.previewOn);
      var said = el("p", { class: "hq-status", role: "status" });
      box.appendChild(
        el("p", {
          class: "hq-words hq-soft",
          text: "Play a whole evening at a pretend place before December: three clues a few minutes apart, the word on the elf's tag, and the place shown at the end. Families never see it, and nothing from it counts.",
        }),
      );
      if (practice.error) say(said, practice.error, false);
      else if (practice.answer) practiceRunning(box, practice.answer, mayChange);
      else if (!mayChange) box.appendChild(el("p", { class: "hq-words", text: "No practice evening is running." }));
      else if (!previewOn) box.appendChild(el("p", { class: "hq-words", text: NO_PREVIEW_WORDS }));
      else box.appendChild(practiceForm());
      box.appendChild(said);
      if (!mayChange) box.appendChild(el("p", { class: "hq-words hq-soft", text: "Starting or clearing a practice evening needs edit access to Head Elf HQ, which an admin can give in Team." }));
      box.appendChild(el("p", { class: "hq-words hq-soft", text: "Open the preview link first in the browser you will play on." }));
      box.appendChild(el("p", { class: "hq-words hq-soft", text: "Make a new preview link if anyone outside the team still has the old one." }));
      return box;
    }

    /** Draws everything from the latest answer. Each part's drawing arrives with its task. */
    function draw() {
      if (!data) return;
      var on = !!(data.settings && data.settings.schoolOn);
      stateChip.textContent = on ? "Live" : "Switched off";
      stateChip.classList.toggle("is-live", on);
      tileCount("families", data.numbers ? data.numbers.namesToCheck : 0);
      tileCount("doors", data.doorsNotReady || 0);
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
          if (!parts.settings.hidden) loadPractice();
          // A sheet already open was drawn before anyone knew whether this person may change it.
          if (fam.sheet) drawSheet();
          var asked = remembered(FAMILY_KEY);
          if (asked && /^[1-9]\d{0,9}$/.test(asked)) {
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
