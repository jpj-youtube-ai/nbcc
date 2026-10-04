/* NBCC Elf Detective School: the wardrobe page, where a detective dresses their elf.
 *
 * The page (src/elf/pages/wardrobe.ts) already works with no script: it is one form of choices and
 * a Save button. This makes it a wardrobe:
 *
 *   1. The elf in the mirror changes the moment something is picked. It is drawn by the same
 *      wardrobe file the server uses (window.NBCCElf, assets/js/elf-wardrobe.js), so the picture
 *      here is the picture everywhere.
 *   2. The look saves itself once the changes settle, without leaving the page. If it cannot, the
 *      page says so plainly and offers the Save button.
 *   3. The sections become tabs, so one shows at a time under the mirror.
 *   4. "New" comes off a thing once it has been tried on, and the server is told.
 *
 * Nothing here decides what may be worn. A locked choice cannot be picked in the page, the drawing
 * leaves out anything that has not been earned, and the server checks the look again when it is
 * saved (normaliseLook in the wardrobe file does all three).
 *
 * Tested in test/unit/elf-js-wardrobe.test.ts against the real page.
 */
(function () {
  "use strict";

  var NOT_SAVED = "We could not save this look. Check your signal and try again.";
  // How long the choices must sit still before the look is saved, in milliseconds.
  var SETTLE = 700;

  function initWardrobe(doc, win, opts) {
    var elf = (opts && opts.elf) || win.NBCCElf;
    var form = doc.querySelector("form.elf-wd");
    // With no wardrobe file or no fetch the page is left as it is: a form with a Save button.
    if (!form || !elf || typeof win.fetch !== "function") return null;

    var mirror = form.querySelector(".elf-wd-mirror");
    var wearing = form.querySelector(".elf-wd-wearing span");
    var status = form.querySelector(".elf-wd-status");
    var button = form.querySelector('button[type="submit"]');
    var detective = form.querySelector('input[name="detective"]');
    var drawing = mirror ? mirror.querySelector("svg") : null;
    var label = (drawing && drawing.getAttribute("aria-label")) || "";
    // What the detective has earned. A NUMBER of doors: the wardrobe counts text as no doors.
    var state = {
      doorsDone: Number(form.getAttribute("data-doors")) || 0,
      goldSeal: form.getAttribute("data-gold") === "1",
      wonRace: form.getAttribute("data-race") === "1"
    };

    // ---- reading the choices ---------------------------------------------------------------

    function picked(name) {
      var input = form.querySelector('input[name="' + name + '"]:checked');
      return input ? input.value : "";
    }

    function readLook() {
      var pieces = {};
      for (var i = 0; i < elf.SLOTS.length; i++) {
        var value = picked("piece-" + elf.SLOTS[i].id);
        pieces[elf.SLOTS[i].id] = value ? value.split(":") : null;
      }
      return { skin: picked("skin"), hair: picked("hair"), hairStyle: picked("hairStyle"), outfit: picked("outfit") || null, pieces: pieces };
    }

    // ---- the mirror ------------------------------------------------------------------------

    // The drawing comes from the wardrobe file, which looks every id up in its own lists and makes
    // the label safe, so nothing from the page reaches the markup it writes.
    function draw() {
      var look = readLook();
      if (mirror) {
        mirror.innerHTML = elf.drawElf(look, state, { size: 260, backdrop: false, key: "preview", label: label });
        // Start the small change of clothes again, even if the last one is still running.
        mirror.classList.remove("is-changed");
        void mirror.offsetWidth;
        mirror.classList.add("is-changed");
      }
      if (wearing) wearing.textContent = elf.lookWords(look, state);
    }

    // The outfit tiles show the outfit on this elf's own face, so they follow the skin and hair.
    function drawOutfits() {
      var look = readLook();
      var list = form.querySelectorAll('input[name="outfit"]');
      for (var i = 0; i < list.length; i++) {
        var art = list[i].value ? list[i].parentNode.querySelector(".elf-wd-art") : null;
        if (art) art.innerHTML = elf.drawOutfit(list[i].value, look, 72);
      }
    }

    function say(words, isError) {
      if (!status) return;
      status.textContent = words;
      if (isError) status.classList.add("is-error");
      else status.classList.remove("is-error");
    }

    // ---- saving ----------------------------------------------------------------------------

    var timer = null;
    var sending = false;
    var again = false;
    // What has been tried on and not yet told to the server.
    var tried = [];

    function request(told) {
      return win.fetch(form.getAttribute("data-api"), {
        method: "POST",
        credentials: "same-origin",
        // So that a save sent as the page is left still arrives.
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ detectiveId: detective ? detective.value : "", look: readLook(), tried: told })
      });
    }

    function save() {
      if (timer) {
        win.clearTimeout(timer);
        timer = null;
      }
      if (sending) {
        again = true;
        return;
      }
      sending = true;
      var told = tried.slice();
      request(told)
        .then(function (res) {
          return res
            .json()
            .catch(function () {
              return {};
            })
            .then(function (body) {
              return res.ok && !!body && body.ok === true;
            });
        })
        .catch(function () {
          return false;
        })
        .then(function (saved) {
          sending = false;
          if (saved) {
            tried = tried.filter(function (key) {
              return told.indexOf(key) < 0;
            });
            say("Saved", false);
            if (button) button.hidden = true;
          } else {
            say(NOT_SAVED, true);
            if (button) button.hidden = false;
          }
          if (again) {
            again = false;
            save();
          }
        });
    }

    function saveSoon() {
      if (timer) win.clearTimeout(timer);
      timer = win.setTimeout(save, opts && typeof opts.settle === "number" ? opts.settle : SETTLE);
    }

    // The page is going. Anything not yet sent goes now, straight to the server: a save already
    // on its way cannot be waited for, because nothing runs once the page has gone.
    function leaving() {
      if (!timer && !again) return;
      if (timer) win.clearTimeout(timer);
      timer = null;
      again = false;
      try {
        request(tried.slice()).catch(function () {});
      } catch (err) {
        // Nothing more can be done from a page that is closing.
      }
    }

    // A phone app swiped away never says "pagehide": being hidden is the last sure sign.
    function hidden() {
      if (doc.visibilityState === "hidden") leaving();
    }

    // A page brought back by the Back button may hold choices the mirror has not drawn.
    function shown(event) {
      if (event && event.persisted) draw();
    }

    // ---- the sections, as tabs ---------------------------------------------------------------

    var tabList = form.querySelector(".elf-wd-tabs");
    var tabs = form.querySelectorAll(".elf-wd-tab");
    var panels = form.querySelectorAll(".elf-wd-panel");

    function panelOf(tab) {
      return (tab.getAttribute("href") || "").slice(1);
    }

    function show(id, focus) {
      for (var i = 0; i < tabs.length; i++) {
        var on = panelOf(tabs[i]) === id;
        tabs[i].setAttribute("aria-selected", on ? "true" : "false");
        tabs[i].setAttribute("tabindex", on ? "0" : "-1");
        if (on && focus) tabs[i].focus();
      }
      for (var j = 0; j < panels.length; j++) panels[j].hidden = panels[j].id !== id;
    }

    function step(from, by) {
      var next = (from + by + tabs.length) % tabs.length;
      show(panelOf(tabs[next]), true);
    }

    function wireTab(tab, index) {
      var panel = doc.getElementById(panelOf(tab));
      tab.id = "tab-" + panelOf(tab);
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-controls", panelOf(tab));
      if (tab.parentNode) tab.parentNode.setAttribute("role", "presentation");
      if (panel) {
        panel.setAttribute("role", "tabpanel");
        panel.setAttribute("aria-labelledby", tab.id);
      }
      tab.addEventListener("click", function (event) {
        event.preventDefault();
        show(panelOf(tab), false);
      });
      tab.addEventListener("keydown", function (event) {
        var key = event.key;
        // Left and right only: up and down stay free to scroll the page.
        if (key === "ArrowRight") step(index, 1);
        else if (key === "ArrowLeft") step(index, -1);
        else if (key === "Home") step(0, 0);
        else if (key === "End") step(tabs.length - 1, 0);
        else if (key === " " || key === "Spacebar") show(panelOf(tab), false);
        else return;
        event.preventDefault();
      });
    }

    // Where to start: the section named in the address, else the first with something new in it,
    // else the first.
    function firstSection() {
      var asked = (win.location && win.location.hash ? win.location.hash : "").slice(1);
      var i;
      for (i = 0; i < panels.length; i++) {
        if (asked && panels[i].id === asked) return asked;
      }
      for (i = 0; i < panels.length; i++) {
        if (panels[i].querySelector(".elf-wd-tile.is-new")) return panels[i].id;
      }
      return panels.length ? panels[0].id : "";
    }

    if (tabList && tabs.length && panels.length) {
      tabList.setAttribute("role", "tablist");
      tabList.setAttribute("aria-label", "Wardrobe sections");
      for (var t = 0; t < tabs.length; t++) wireTab(tabs[t], t);
      show(firstSection(), false);
    }

    // ---- what is new -------------------------------------------------------------------------

    function closest(el, selector) {
      while (el && el !== form) {
        if (el.matches && el.matches(selector)) return el;
        el = el.parentNode;
      }
      return null;
    }

    function tabFor(panel) {
      for (var i = 0; i < tabs.length; i++) {
        if (panelOf(tabs[i]) === panel.id) return tabs[i];
      }
      return null;
    }

    // A thing that has been tried on is no longer new: its tag comes off, the server is told with
    // the next save, and the mark comes off its section's tab once nothing there is new.
    function triedOn(input) {
      var tile = closest(input, ".elf-wd-tile");
      if (!tile || !tile.classList.contains("is-new")) return;
      tile.classList.remove("is-new");
      var tag = tile.querySelector(".elf-wd-new");
      if (tag) tag.parentNode.removeChild(tag);
      var said = tile.querySelector(".sr-only");
      if (said) said.textContent = said.textContent.replace(/, new$/, "");
      tried.push(input.value);
      var panel = closest(tile, ".elf-wd-panel");
      var tab = panel && !panel.querySelector(".elf-wd-tile.is-new") ? tabFor(panel) : null;
      var mark = tab ? tab.querySelector(".elf-wd-tab__new") : null;
      if (mark) mark.parentNode.removeChild(mark);
    }

    // ---- trying things on ----------------------------------------------------------------------

    function changed(event) {
      var input = event.target;
      if (!input || input.type !== "radio") return;
      // A piece picked while a whole outfit is on would not show: the outfit comes off.
      if (input.name.indexOf("piece-") === 0 && input.value) {
        var none = form.querySelector('input[name="outfit"][value=""]');
        if (none) none.checked = true;
      }
      triedOn(input);
      draw();
      if (input.name === "skin" || input.name === "hair" || input.name === "hairStyle") drawOutfits();
      saveSoon();
    }

    // A locked thing, tapped: it rattles, stays locked, and the page says what unlocks it.
    function tapped(event) {
      var tile = closest(event.target, ".elf-wd-tile.is-locked");
      if (!tile) return;
      var said = tile.querySelector(".sr-only");
      // A failed save keeps its warning: this must not paint over it.
      if (said && !(status && status.classList.contains("is-error"))) say(said.textContent + ".", false);
      tile.classList.remove("is-rattled");
      void tile.offsetWidth;
      tile.classList.add("is-rattled");
    }

    function submitted(event) {
      event.preventDefault();
      save();
    }

    form.addEventListener("change", changed);
    form.addEventListener("click", tapped);
    form.addEventListener("submit", submitted);
    win.addEventListener("pagehide", leaving);
    win.addEventListener("pageshow", shown);
    doc.addEventListener("visibilitychange", hidden);

    // A browser can put back the choices from before a reload. If they are not what the mirror
    // shows, draw them and save them, so the picture, the choices and the server agree.
    if (wearing && wearing.textContent !== elf.lookWords(readLook(), state)) {
      draw();
      drawOutfits();
      saveSoon();
    }

    // The look saves itself from here on, so the button is only wanted when a save has failed.
    if (button) button.hidden = true;
    form.classList.add("is-live");

    return {
      look: readLook,
      save: save,
      show: function (id) {
        show(id, false);
      },
      stop: function () {
        if (timer) win.clearTimeout(timer);
        timer = null;
        win.removeEventListener("pagehide", leaving);
        win.removeEventListener("pageshow", shown);
        doc.removeEventListener("visibilitychange", hidden);
      }
    };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { initWardrobe: initWardrobe };
  } else {
    initWardrobe(document, window);
  }
})();
