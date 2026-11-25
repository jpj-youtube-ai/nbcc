// Freddie's film at the top of the home page. What it does, and why, is in README.md ("Freddie's film
// at the very top of the home page"). Kept short: every byte here counts against the home page's budget.
(function () {
  "use strict";
  var SEEN = "nbcc-freddie-film-seen";

  function initHomeFilm(doc, win) {
    var root = doc.querySelector("[data-home-film]");
    var video = root && root.querySelector("[data-hf-video]");
    if (!root || !video) return null;
    var q = function (s) { return root.querySelector(s); };
    var sound = q("[data-hf-sound]"), pause = q("[data-hf-pause]"), play = q("[data-hf-play]");
    var cc = q("[data-hf-captions]"), end = q("[data-hf-end]"), fill = q("[data-hf-fill]"), again = q("[data-hf-again]");
    video.removeAttribute("controls");
    root.classList.add("hf--js");

    // idle (not started, or refused), muted, playing, paused, ended
    var state = "idle";
    function show(el, on) { if (el) el.hidden = !on; }
    function set(s) {
      state = s;
      root.setAttribute("data-hf-state", s);
      show(sound, s === "muted");
      show(pause, s === "muted" || s === "playing");
      show(play, s === "paused" || s === "idle");
      show(end, s === "ended");
      show(cc, s !== "ended");
    }
    function captions(on) {
      var t = video.textTracks && video.textTracks[0];
      if (t) t.mode = on ? "showing" : "hidden";
      if (cc) cc.setAttribute("aria-pressed", on ? "true" : "false");
    }
    // Focus moves only for someone using the film, never scrolling the page. After a press focus may
    // have dropped to the page, the pressed button having hidden itself; that still counts.
    function focusOn(el, afterPress) {
      var a = doc.activeElement;
      if (!el || !(root.contains(a) || (afterPress && (!a || a === doc.body)))) return;
      try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
    }
    // A refusal from an older start (a play cancelled by Pause, say) must not undo what came since.
    var run = 0;
    function refused(mine, pressed) {
      if (mine !== run) return;
      set("idle");
      if (pressed) focusOn(play, true);
    }
    function start(withSound, fromStart, pressed) {
      var mine = ++run;
      if (fromStart) { try { video.currentTime = 0; } catch (e) { /* not loaded yet */ } }
      video.muted = !withSound;
      set(withSound ? "playing" : "muted");
      if (pressed) focusOn(pause, true);
      var p = null;
      try { p = video.play(); } catch (e) { refused(mine, pressed); }
      if (p && typeof p.then === "function") p.then(null, function () { refused(mine, pressed); });
    }
    function store() { try { return win.localStorage || null; } catch (e) { return null; } }
    function seen() { try { var s = store(); return !!(s && s.getItem(SEEN)); } catch (e) { return false; } }
    function remember() { try { var s = store(); if (s) s.setItem(SEEN, "1"); } catch (e) { /* none */ } }
    function asks(m) { try { return !!(win.matchMedia && win.matchMedia(m).matches); } catch (e) { return false; } }
    function on(el, fn) { if (el) el.addEventListener("click", fn); }

    on(sound, function () { start(true, true, true); });
    on(pause, function () { run++; video.pause(); set("paused"); focusOn(play, true); });
    on(play, function () { if (state === "idle") start(true, true, true); else start(!video.muted, false, true); });
    on(cc, function () { captions(cc.getAttribute("aria-pressed") !== "true"); });
    on(again, function () { start(true, true, true); });
    video.addEventListener("ended", function () { set("ended"); focusOn(fill); });
    // The phone pausing or playing it itself (another app, the lock screen, a media key). Browsers
    // also fire a pause just before the end; that is not one.
    video.addEventListener("pause", function () {
      if (!video.ended && state !== "idle" && state !== "ended") set("paused");
    });
    video.addEventListener("play", function () { set(video.muted ? "muted" : "playing"); });

    captions(true);
    set("idle");
    var saveData = !!(win.navigator && win.navigator.connection && win.navigator.connection.saveData);
    if (!asks("(prefers-reduced-motion: reduce)") && !saveData && !seen()) {
      remember();
      start(false, false);
    }
    return { state: function () { return state; } };
  }

  if (typeof module !== "undefined" && module.exports) module.exports = { initHomeFilm: initHomeFilm };
  else if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { initHomeFilm(document, window); });
  else initHomeFilm(document, window);
})();
