/* NBCC Elf Detective School: the wardrobe page, where a detective dresses their elf.
 *
 * The page (src/elf/pages/wardrobe.ts) already works with no script: it is one form of choices and
 * a Save button. This makes it a wardrobe:
 *
 *   1. The elf on the stage changes the moment something is picked. Its pictures are the ones the
 *      wardrobe file the server uses names (window.NBCCElf.lookPictures, assets/js/elf-wardrobe.js),
 *      so the picture here is the picture everywhere. The costume tiles follow the skin chosen.
 *   2. The look saves itself once the changes settle, without leaving the page. If it cannot, the
 *      page says so plainly and offers the Save button.
 *   3. The sections become tabs, so one shows at a time under the mirror.
 *   4. "New" comes off a thing once it has been tried on, and the server is told.
 *
 * Nothing here decides what may be worn. A locked choice cannot be picked in the page, the stage
 * leaves out anything not unlocked, and the server checks the look again when it is saved
 * (normaliseLook in the wardrobe file does all three).
 *
 * Tested in test/unit/elf-js-wardrobe.test.ts against the real page.
 */
(function () {
  "use strict";

  var NOT_SAVED = "We could not save this look. Check your signal and try again.";
  // How long the choices must sit still before the look is saved, in milliseconds.
  var SETTLE = 700;
  // The pictures on the stage, bottom to top, and where the paper pictures are.
  var PARTS = ["scene", "body", "glasses", "bow", "friend"];
  var PAPER = "/assets/img/elf/paper/";

  // The doors this detective has done, as whole numbers from 1 to 24: the wardrobe counts anything
  // else as no door at all, so nothing in the page can open a costume.
  function doorsOf(text) {
    var out = [];
    var parts = String(text || "").split(",");
    for (var i = 0; i < parts.length; i++) {
      var n = Number(parts[i]);
      if (parts[i] !== "" && n % 1 === 0 && n >= 1 && n <= 24) out.push(n);
    }
    return out;
  }

  function initWardrobe(doc, win, opts) {
    var elf = (opts && opts.elf) || win.NBCCElf;
    var form = doc.querySelector("form.elf-wd");
    // With no wardrobe file or no fetch the page is left as it is: a form with a Save button.
    if (!form || !elf || typeof win.fetch !== "function") return null;

    var stage = form.querySelector(".elf-wd-stage");
    var wearing = form.querySelector(".elf-wd-wearing");
    var status = form.querySelector(".elf-wd-status");
    var button = form.querySelector('button[type="submit"]');
    var detective = form.querySelector('input[name="detective"]');
    var state = { doors: doorsOf(form.getAttribute("data-doors")) };

    // ---- reading the choices ---------------------------------------------------------------

    function picked(name) {
      var input = form.querySelector('input[name="' + name + '"]:checked');
      return input ? input.value : "";
    }

    function readLook() {
      return {
        sibling: picked("sibling"),
        skin: picked("skin"),
        hair: picked("hair"),
        hairStyle: picked("hairStyle"),
        costume: picked("costume") || null,
        scene: picked("scene"),
        friend: picked("friend") || null,
        frame: picked("frame") || null,
        glasses: picked("glasses") || null,
        bow: picked("bow") || null
      };
    }

    // ---- the stage -------------------------------------------------------------------------

    // The first picture already on the stage that goes above the part at `i`, so a picture put back
    // keeps its place in the order.
    function above(i) {
      for (var j = i + 1; j < PARTS.length; j++) {
        var img = stage.querySelector('img[data-picture="' + PARTS[j] + '"]');
        if (img) return img;
      }
      return null;
    }

    // The pictures come from the wardrobe file, which looks every id up in its own lists, so nothing
    // from the page reaches an address it writes.
    function place(pictures) {
      for (var i = 0; i < PARTS.length; i++) {
        var part = PARTS[i];
        var img = stage.querySelector('img[data-picture="' + part + '"]');
        if (!pictures[part]) {
          if (img) img.parentNode.removeChild(img);
          continue;
        }
        if (!img) {
          img = doc.createElement("img");
          img.className = "elf-wd-pic";
          img.setAttribute("data-picture", part);
          // The elf, glasses, bow tie and scene are each the whole canvas; a friend is fitted in a square.
          img.setAttribute("width", part === "friend" ? "240" : "640");
          img.setAttribute("height", part === "friend" ? "240" : "960");
          img.setAttribute("alt", "");
          img.setAttribute("decoding", "async");
          stage.insertBefore(img, above(i));
        }
        if (img.getAttribute("src") !== PAPER + pictures[part]) img.setAttribute("src", PAPER + pictures[part]);
      }
    }

    function frame(id) {
      var old = [];
      for (var i = 0; i < stage.classList.length; i++) {
        if (stage.classList[i].indexOf("elf-frame--") === 0) old.push(stage.classList[i]);
      }
      for (var j = 0; j < old.length; j++) stage.classList.remove(old[j]);
      if (id) stage.classList.add("elf-frame--" + id);
    }

    function draw() {
      var look = elf.normaliseLook(readLook(), state);
      if (stage) {
        place(elf.lookPictures(look, state));
        frame(look.frame);
        // Start the small change again, even if the last one is still running.
        stage.classList.remove("is-changed");
        void stage.offsetWidth;
        stage.classList.add("is-changed");
      }
      if (wearing) wearing.textContent = elf.lookWords(look, state);
    }

    function known(list, id) {
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === id) return true;
      }
      return false;
    }

    // The costume tiles show each costume in the detective's own skin, so they follow the skin.
    function drawTiles() {
      var skin = elf.normaliseLook(readLook(), state).skin;
      var tiles = form.querySelectorAll("img[data-costume]");
      for (var i = 0; i < tiles.length; i++) {
        var id = tiles[i].getAttribute("data-costume");
        var src = PAPER + "tiles/costumes/" + id + "-" + skin + ".webp";
        if (known(elf.COSTUMES, id) && tiles[i].getAttribute("src") !== src) tiles[i].setAttribute("src", src);
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

    // A page brought back by the Back button may hold choices the stage has not shown.
    function shown(event) {
      if (event && event.persisted) {
        draw();
        drawTiles();
      }
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
      triedOn(input);
      draw();
      if (input.name === "skin") drawTiles();
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

    // A browser can put back the choices from before a reload. If they are not what the stage
    // shows, show them and save them, so the picture, the choices and the server agree.
    if (wearing && wearing.textContent !== elf.lookWords(readLook(), state)) {
      draw();
      drawTiles();
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
