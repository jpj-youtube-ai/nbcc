/* NBCC Elf Detective School: the wardrobe page, where a detective dresses their elf.
 *
 * The page (src/elf/pages/wardrobe.ts) already works with no script: it is one form of choices and
 * a Save button. This makes it the paper wardrobe of mockup 6 (approved by Jaimie, 4 November 2026):
 *
 *   1. The elf on the stage changes the moment something is picked. Its pictures are the ones the
 *      wardrobe file the server uses names (window.NBCCElf.lookPictures, assets/js/elf-wardrobe.js),
 *      so the picture here is the picture everywhere. The costume tiles follow the skin chosen.
 *   2. The look saves itself once the changes settle, without leaving the page. If it cannot, the
 *      page says so plainly and offers the Save button.
 *   3. Step 1, Your elf, folds away once the elf is made; Change opens it again.
 *   4. The gift tags become tabs, so one section shows at a time.
 *   5. A costume that has just arrived is a wrapped present: picking it opens it and puts it on, and
 *      the server is told it has been opened. A locked one says why on its note.
 *   6. The elf talks back, it snows when the stage is tapped, Surprise me picks a new look, Snap a
 *      photo pegs up to three favourite looks on a string (tap one to wear it again), and the sounds
 *      stay off until switched on. Bursts and snow are only for a visitor happy with motion.
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
  // What the elf says when a costume goes on (draft words for Jaimie, in the design).
  var LINES = ["So cosy", "I love it", "Ho ho ho", "Look at me", "Snug as a bug", "Ta da", "Just my size", "Jingle jingle"];
  var FAVOURITES_KEPT = 3;
  var LOOK_KEYS = ["sibling", "skin", "hair", "hairStyle", "costume", "scene", "friend", "frame", "glasses", "bow"];
  var STAR = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m12 2 2.9 6.6 7.1.8-5.3 4.8 1.5 7-6.2-3.6-6.2 3.6 1.5-7L2 9.4l7.1-.8z"/></svg>';
  var COLOURS = ["#E9C46A", "#C02238", "#D9A93E", "#E9C46A", "#B8862B", "#C02238"];

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
    var frameBox = form.querySelector(".elf-wd-frame");
    var wearing = form.querySelector(".elf-wd-wearing");
    var status = form.querySelector(".elf-wd-status");
    var button = form.querySelector('button[type="submit"]');
    var detective = form.querySelector('input[name="detective"]');
    var state = { doors: doorsOf(form.getAttribute("data-doors")) };
    var timers = [];

    // A visitor who has asked for less motion gets no bursts, snow or spins, asked each time.
    function calm() {
      if (opts && typeof opts.reduce === "boolean") return opts.reduce;
      return !!(win.matchMedia && win.matchMedia("(prefers-reduced-motion: reduce)").matches);
    }

    function later(fn, ms) {
      var id = win.setTimeout(fn, ms);
      timers.push(id);
      return id;
    }

    // Start a class's little movement again, even if the last one is still running.
    function again(el, cls) {
      if (!el) return;
      el.classList.remove(cls);
      void el.offsetWidth;
      el.classList.add(cls);
    }

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

    function nameOf(list, id) {
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === id) return list[i].name;
      }
      return "";
    }

    function known(list, id) {
      return nameOf(list, id) !== "";
    }

    // ---- sounds: little tones made in the browser, off until the switch turns them on ---------

    var AudioKind = win.AudioContext || win.webkitAudioContext;
    var audio = null;
    var soundOn = false;

    function tone(freq, at, dur, type, gain) {
      var t = audio.currentTime + at;
      var o = audio.createOscillator();
      var g = audio.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g);
      g.connect(audio.destination);
      o.start(t);
      o.stop(t + dur + 0.03);
    }

    var SOUNDS = {
      pick: function () { tone(784, 0, 0.18, "sine", 0.12); tone(1175, 0.07, 0.22, "sine", 0.09); },
      big: function () { tone(523, 0, 0.14, "triangle", 0.1); tone(659, 0.07, 0.14, "triangle", 0.1); tone(784, 0.14, 0.14, "triangle", 0.1); tone(1047, 0.21, 0.34, "sine", 0.09); },
      open: function () { tone(523, 0, 0.1, "triangle", 0.1); tone(784, 0.08, 0.1, "triangle", 0.1); tone(1047, 0.16, 0.12, "triangle", 0.1); tone(1568, 0.26, 0.45, "sine", 0.08); },
      no: function () { tone(233, 0, 0.13, "triangle", 0.12); tone(175, 0.09, 0.2, "triangle", 0.1); },
      tab: function () { tone(988, 0, 0.12, "sine", 0.06); },
      snap: function () { tone(1800, 0, 0.05, "square", 0.03); tone(900, 0.03, 0.08, "triangle", 0.05); },
      snow: function () { tone(1760, 0, 0.3, "sine", 0.03); tone(2093, 0.12, 0.3, "sine", 0.025); tone(2637, 0.24, 0.4, "sine", 0.02); }
    };

    function play(name) {
      if (!soundOn || !audio) return;
      try {
        SOUNDS[name]();
      } catch (err) {
        // A browser that will not play just stays quiet.
      }
    }

    var soundButton = form.querySelector(".elf-wd-sound");
    if (soundButton && AudioKind) {
      soundButton.hidden = false;
      soundButton.addEventListener("click", function () {
        soundOn = !soundOn;
        if (soundOn && !audio) {
          try {
            audio = new AudioKind();
          } catch (err) {
            audio = null;
          }
        }
        soundButton.setAttribute("aria-pressed", soundOn ? "true" : "false");
        soundButton.classList.toggle("is-on", soundOn);
        var said = soundButton.querySelector("span");
        if (said) said.textContent = soundOn ? "Sounds on" : "Sounds off";
        play("pick");
      });
    }

    // ---- bursts of gold paper stars, and the elf talking back ---------------------------------

    var layer = doc.createElement("div");
    layer.className = "elf-wd-bursts";
    layer.setAttribute("aria-hidden", "true");
    form.appendChild(layer);

    function burst(near, n, spread) {
      if (calm() || !near) return;
      var box = near.getBoundingClientRect();
      for (var i = 0; i < n; i++) {
        var s = doc.createElement("span");
        var a = (Math.PI * 2 * i) / n + Math.random() * 0.6;
        var d = (spread || 70) * (0.7 + Math.random() * 0.6);
        s.className = "elf-wd-spark";
        s.style.cssText =
          "left:" + (box.left + box.width / 2).toFixed(0) + "px;top:" + (box.top + box.height / 2).toFixed(0) + "px;" +
          "--dx:" + (Math.cos(a) * d).toFixed(0) + "px;--dy:" + (Math.sin(a) * d).toFixed(0) + "px;" +
          "--r:" + (Math.random() * 240 - 120).toFixed(0) + "deg;--z:" + (10 + Math.random() * 10).toFixed(0) + "px;--c:" + COLOURS[i % COLOURS.length];
        s.innerHTML = STAR;
        layer.appendChild(s);
        later(s.remove.bind(s), 900);
      }
    }

    var sayBox = form.querySelector(".elf-wd-say");
    var lineAt = 0;
    var sayTimer = null;
    function elfSays(text) {
      if (!sayBox) return;
      sayBox.textContent = text || LINES[lineAt++ % LINES.length];
      again(sayBox, "is-on");
      if (sayTimer) win.clearTimeout(sayTimer);
      sayTimer = later(function () { sayBox.classList.remove("is-on"); }, 1700);
    }

    // ---- the stage -------------------------------------------------------------------------

    // The first picture already on the stage that goes above the part at `i`, so a picture put back
    // keeps its place in the order.
    function above(i) {
      for (var j = i + 1; j < PARTS.length; j++) {
        var img = stage.querySelector('img[data-picture="' + PARTS[j] + '"]');
        if (img) return img;
      }
      // Above every picture come the lights, the snow and the flash.
      return stage.querySelector(".elf-wd-glows");
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

    // The frame is paper round the stage: a plain mount, or the pattern chosen.
    function frame(id) {
      if (!frameBox) return;
      var old = [];
      for (var i = 0; i < frameBox.classList.length; i++) {
        if (frameBox.classList[i].indexOf("elf-frame--") === 0) old.push(frameBox.classList[i]);
      }
      for (var j = 0; j < old.length; j++) frameBox.classList.remove(old[j]);
      if (id) frameBox.classList.add("elf-frame--" + id);
    }

    var meSaid = form.querySelector(".elf-wd-me__said");
    function draw() {
      var look = elf.normaliseLook(readLook(), state);
      if (stage) {
        place(elf.lookPictures(look, state));
        stage.setAttribute("data-scene", look.scene);
        again(stage, "is-changed");
      }
      frame(look.frame);
      if (wearing) wearing.textContent = elf.lookWords(look, state);
      var face = form.querySelector(".elf-wd-me__face");
      var body = elf.lookPictures(look, state).body;
      if (face && body && face.getAttribute("src") !== PAPER + body) face.setAttribute("src", PAPER + body);
      if (meSaid) {
        meSaid.textContent =
          nameOf(elf.SIBLINGS, look.sibling) + ", " + (nameOf(elf.HAIR_COLOURS, look.hair) + " " + nameOf(elf.HAIR_STYLES, look.hairStyle)).toLowerCase();
      }
      return look;
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

    // ---- favourite looks: up to three, newest first, pegged on a string -----------------------

    var looksRow = form.querySelector(".elf-wd-looks__row");
    var favourites = [];
    var favouritesTouched = false;

    function readFavourites() {
      if (!looksRow) return;
      var photos = looksRow.querySelectorAll(".elf-wd-polaroid");
      for (var i = 0; i < photos.length && favourites.length < FAVOURITES_KEPT; i++) {
        try {
          favourites.push(elf.normaliseLook(JSON.parse(photos[i].getAttribute("data-look") || "{}"), state));
        } catch (err) {
          // A photo that cannot be read is left off.
        }
      }
    }

    function same(a, b) {
      for (var i = 0; i < LOOK_KEYS.length; i++) {
        if ((a[LOOK_KEYS[i]] || null) !== (b[LOOK_KEYS[i]] || null)) return false;
      }
      return true;
    }

    function photo(look) {
      var pictures = elf.lookPictures(look, state);
      var caption = nameOf(elf.COSTUMES, look.costume) || "My elf";
      var b = doc.createElement("button");
      b.type = "button";
      b.className = "elf-wd-polaroid";
      b.setAttribute("aria-label", "Wear this look again: " + caption);
      var pic = doc.createElement("span");
      pic.className = "elf-wd-polaroid__pic";
      pic.setAttribute("aria-hidden", "true");
      ["scene", "body"].forEach(function (part) {
        if (!pictures[part]) return;
        var img = doc.createElement("img");
        img.className = part === "scene" ? "elf-wd-polaroid__scene" : "elf-wd-polaroid__elf";
        img.setAttribute("src", PAPER + pictures[part]);
        img.setAttribute("width", "640");
        img.setAttribute("height", "960");
        img.setAttribute("alt", "");
        pic.appendChild(img);
      });
      var cap = doc.createElement("span");
      cap.className = "elf-wd-polaroid__cap";
      cap.setAttribute("aria-hidden", "true");
      cap.textContent = caption;
      b.appendChild(pic);
      b.appendChild(cap);
      return b;
    }

    function drawLooks() {
      if (!looksRow) return;
      looksRow.textContent = "";
      if (!favourites.length) {
        var empty = doc.createElement("p");
        empty.className = "elf-wd-looks__empty";
        empty.textContent = "Snap a photo to peg your look here";
        looksRow.appendChild(empty);
        return;
      }
      for (var i = 0; i < favourites.length; i++) looksRow.appendChild(photo(favourites[i]));
    }

    // ---- saving ----------------------------------------------------------------------------

    var timer = null;
    var sending = false;
    var saveAgain = false;
    // What has been tried on and not yet told to the server.
    var tried = [];

    function request(told) {
      var body = { detectiveId: detective ? detective.value : "", look: readLook(), tried: told };
      if (favouritesTouched) body.favourites = favourites.slice();
      return win.fetch(form.getAttribute("data-api"), {
        method: "POST",
        credentials: "same-origin",
        // So that a save sent as the page is left still arrives.
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
    }

    function save() {
      if (timer) {
        win.clearTimeout(timer);
        timer = null;
      }
      if (sending) {
        saveAgain = true;
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
          if (saveAgain) {
            saveAgain = false;
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
      if (!timer && !saveAgain) return;
      if (timer) win.clearTimeout(timer);
      timer = null;
      saveAgain = false;
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

    // ---- step 1 folds away once the elf is made ----------------------------------------------

    var fold = form.querySelector(".elf-wd-fold");
    var change = form.querySelector(".elf-wd-change");
    var done = form.querySelector(".elf-wd-done");

    function setFold(open) {
      if (!fold || !change) return;
      fold.classList.toggle("is-folded", !open);
      change.setAttribute("aria-expanded", open ? "true" : "false");
      change.textContent = open ? "Close" : "Change";
    }

    if (fold && change) {
      change.hidden = false;
      setFold(form.getAttribute("data-made") !== "true");
      change.addEventListener("click", function () {
        setFold(fold.classList.contains("is-folded"));
        play("tab");
      });
    }
    if (done && fold && change) {
      done.hidden = false;
      done.addEventListener("click", function () {
        setFold(false);
        play("big");
        again(stage, "is-hop");
        burst(stage, 14, 100);
        elfSays("Hello");
        var next = form.querySelector(".elf-wd-step--dress");
        if (next && next.scrollIntoView) next.scrollIntoView({ behavior: calm() ? "auto" : "smooth", block: "start" });
        // The button has just folded away with step 1: the keyboard goes on to the open gift tag, so
        // nobody is left on a button that is no longer there.
        var open = form.querySelector('.elf-wd-tab[aria-selected="true"]') || form.querySelector(".elf-wd-tab");
        if (open && open.focus) open.focus({ preventScroll: true });
      });
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
        if (on && !calm()) again(tabs[i], "is-swing");
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
        play("tab");
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

    // ---- presents and what is new --------------------------------------------------------------

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

    // The presents wiggle until they are opened.
    var wrapped = form.querySelectorAll(".elf-wd-tile.is-new");
    for (var w = 0; w < wrapped.length; w++) wrapped[w].classList.add("is-wrapped");

    // How many costumes are out of their presents, on the rosette and the candy cane strip.
    function countOpened() {
      var seal = form.querySelector(".elf-wd-seal b");
      var haul = form.querySelector(".elf-wd-haul b");
      var bar = form.querySelector(".elf-wd-haul__bar");
      var n = (seal ? Number(seal.textContent) : 0) + 1;
      if (seal) seal.textContent = String(n);
      if (haul) haul.textContent = String(n);
      if (bar) {
        bar.setAttribute("value", String(n));
        bar.setAttribute("aria-label", n + " of " + elf.COSTUMES.length + " costumes are yours");
      }
      again(form.querySelector(".elf-wd-seal"), "is-bump");
    }

    // A present, picked: the wrapping comes off with a burst, and the door's chip says Done once
    // every present in it is open.
    function unwrap(tile) {
      tile.classList.remove("is-wrapped");
      tile.classList.add("is-opened");
      play("open");
      burst(tile, 18, 120);
      countOpened();
      var present = tile.querySelector(".elf-wd-present");
      if (present) later(function () { if (present.parentNode) present.parentNode.removeChild(present); }, calm() ? 0 : 700);
      var door = closest(tile, ".elf-wd-door");
      if (door && !door.querySelector(".elf-wd-tile.is-wrapped")) {
        var chip = door.querySelector(".elf-wd-door__chip");
        if (chip) {
          chip.className = "elf-chip elf-chip--done elf-wd-door__chip";
          chip.textContent = "Done";
        }
      }
    }

    // A thing that has been tried on is no longer new: its present comes off, the server is told
    // with the next save, and the mark comes off its section's tab once nothing there is new.
    function triedOn(input) {
      var tile = closest(input, ".elf-wd-tile");
      if (!tile || !tile.classList.contains("is-new")) return;
      if (tile.classList.contains("is-wrapped")) unwrap(tile);
      tile.classList.remove("is-new");
      var said = tile.querySelector(".sr-only");
      if (said) said.textContent = said.textContent.replace(/, a present to open$/, "");
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
      var tile = closest(input, ".elf-wd-tile");
      if (tile) again(tile, "is-pop");
      burst(tile, 8, 60);
      play(input.name === "costume" ? "big" : "pick");
      if (input.name === "costume" && input.value) {
        again(stage, "is-hop");
        elfSays();
      }
      if (input.name === "friend" && input.value) elfSays("Hello " + nameOf(elf.FRIENDS, input.value).toLowerCase());
      saveSoon();
    }

    // A locked thing, tapped: it rattles, stays locked, and its note and the page say what unlocks it.
    function tapped(event) {
      var tile = closest(event.target, ".elf-wd-tile.is-locked");
      if (!tile) return;
      var said = tile.querySelector(".sr-only");
      // A failed save keeps its warning: this must not paint over it.
      if (said && !(status && status.classList.contains("is-error"))) say(said.textContent + ".", false);
      again(tile, "is-rattled");
      tile.classList.add("is-telling");
      later(function () { tile.classList.remove("is-telling"); }, 2200);
      play("no");
    }

    function submitted(event) {
      event.preventDefault();
      save();
    }

    // Pick a choice as a person would, so everything that follows a pick follows this one too.
    function choose(input) {
      if (!input || input.disabled) return;
      input.checked = true;
      input.dispatchEvent(new win.Event("change", { bubbles: true }));
    }

    // ---- Surprise me: a whole new look, from what is unlocked ----------------------------------

    function open(name) {
      var out = [];
      var list = form.querySelectorAll('input[name="' + name + '"]');
      for (var i = 0; i < list.length; i++) {
        if (!list[i].disabled) out.push(list[i]);
      }
      return out;
    }

    function any(list) {
      return list[Math.floor(Math.random() * list.length)];
    }

    var surprise = form.querySelector(".elf-wd-surprise");
    function land() {
      var costumes = open("costume").filter(function (i) { return i.value && !i.checked; });
      choose(any(costumes.length ? costumes : open("costume")));
      choose(any(open("friend")));
      choose(any(open("frame")));
      elfSays("Ta da");
      play("big");
      if (surprise) surprise.classList.remove("is-spinning");
    }
    if (surprise) {
      surprise.addEventListener("click", function () {
        if (surprise.classList.contains("is-spinning")) return;
        surprise.classList.add("is-spinning");
        if (calm()) return land();
        // A quick spin through the costumes first, slowing as it goes.
        var k = 0;
        (function spin() {
          if (k >= 9) return land();
          var all = open("costume").filter(function (i) { return i.value; });
          var shown = any(all);
          if (shown) {
            shown.checked = true;
            draw();
          }
          k += 1;
          later(spin, 60 + k * 22);
        })();
      });
    }

    // ---- Snap a photo: the look pegged on the string, to wear again ----------------------------

    var snap = form.querySelector(".elf-wd-snap");
    var flash = form.querySelector(".elf-wd-flash");
    if (snap) {
      snap.addEventListener("click", function () {
        var look = elf.normaliseLook(readLook(), state);
        favourites = favourites.filter(function (f) { return !same(f, look); });
        favourites.unshift(look);
        if (favourites.length > FAVOURITES_KEPT) favourites.length = FAVOURITES_KEPT;
        favouritesTouched = true;
        drawLooks();
        if (!calm()) again(flash, "is-on");
        play("snap");
        elfSays("Say cheese");
        saveSoon();
      });
    }

    function wearAgain(look) {
      for (var i = 0; i < LOOK_KEYS.length; i++) {
        var key = LOOK_KEYS[i];
        var value = look[key] || "";
        var input = form.querySelector('input[name="' + key + '"][value="' + String(value).replace(/["\\]/g, "") + '"]');
        if (input && !input.disabled) input.checked = true;
      }
      draw();
      drawTiles();
      elfSays("Back again");
      play("pick");
      saveSoon();
    }

    if (looksRow) {
      looksRow.addEventListener("click", function (event) {
        var b = closest(event.target, ".elf-wd-polaroid");
        if (!b || !looksRow.contains(b)) return;
        var photos = looksRow.querySelectorAll(".elf-wd-polaroid");
        for (var i = 0; i < photos.length; i++) {
          if (photos[i] === b && favourites[i]) return wearAgain(favourites[i]);
        }
      });
    }

    // ---- snow, when the stage is tapped ---------------------------------------------------------

    var snowBox = form.querySelector(".elf-wd-snow");
    function letItSnow() {
      play("snow");
      if (calm() || !snowBox) return;
      for (var i = 0; i < 36; i++) {
        var f = doc.createElement("i");
        f.className = "is-flurry";
        f.style.cssText =
          "--x:" + (Math.random() * 100).toFixed(1) + "%;--s:" + (3 + Math.random() * 5).toFixed(1) + "px;--d:" + (1.6 + Math.random() * 1.4).toFixed(2) +
          "s;--delay:" + (Math.random() * 0.6).toFixed(2) + "s;--drift:" + (Math.random() * 60 - 30).toFixed(0) + "px";
        snowBox.appendChild(f);
        later(f.remove.bind(f), 3400);
      }
      again(stage, "is-wiggle");
    }
    if (stage) stage.addEventListener("click", letItSnow);

    // ---- on a phone, a bubble brings the elf back when the stage scrolls away -------------------

    var peek = doc.querySelector(".elf-wd-peek");
    if (peek && stage && typeof win.IntersectionObserver === "function") {
      peek.hidden = false;
      var watcher = new win.IntersectionObserver(function (seen) {
        peek.classList.toggle("is-on", !seen[0].isIntersecting);
      }, { threshold: 0.12 });
      watcher.observe(stage);
      peek.addEventListener("click", function () {
        if (stage.scrollIntoView) stage.scrollIntoView({ behavior: calm() ? "auto" : "smooth", block: "center" });
      });
    }

    form.addEventListener("change", changed);
    form.addEventListener("click", tapped);
    form.addEventListener("submit", submitted);
    win.addEventListener("pagehide", leaving);
    win.addEventListener("pageshow", shown);
    doc.addEventListener("visibilitychange", hidden);

    readFavourites();

    // A browser can put back the choices from before a reload. If they are not what the stage
    // shows, show them and save them, so the picture, the choices and the server agree.
    if (wearing && wearing.textContent !== elf.lookWords(readLook(), state)) {
      draw();
      drawTiles();
      saveSoon();
    }

    // The look saves itself from here on, so the button is only wanted when a save has failed.
    if (button) button.hidden = true;
    var tools = form.querySelector(".elf-wd-tools");
    if (tools) tools.hidden = false;
    var hint = form.querySelector(".elf-wd-taphint");
    if (hint) hint.hidden = false;
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
        for (var i = 0; i < timers.length; i++) win.clearTimeout(timers[i]);
        timers = [];
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
