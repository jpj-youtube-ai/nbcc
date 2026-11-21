// Freddie's film at the top of the home page (Jaimie, 21 November 2026;
// docs/superpowers/specs/2026-11-21-home-freddie-film-design.md).
//
// Without this script the film is a plain player with the browser's own controls and captions. With
// it, on a first visit the film starts by itself with the sound off (no browser allows anything
// else) and captions on, with a big "Tap for sound" that starts it again from the beginning with
// sound, and a pause button (anything that moves by itself must be stoppable). It never starts by
// itself for someone whose device asks for less motion or to save data, nor on a later visit: they
// get its still and a big play button, which plays it with sound. It plays once. At the end, Fill a
// bag and Watch again appear under it, and Fill a bag takes the focus.
//
// "Seen" is one note in the visitor's own browser (local storage), never sent anywhere, as the Get
// involved film's is (privacy.html says so).
(function () {
  "use strict";

  var SEEN = "nbcc-freddie-film-seen";

  function initHomeFilm(doc, win) {
    var root = doc.querySelector("[data-home-film]");
    var video = root && root.querySelector("[data-hf-video]");
    if (!root || !video) return null;
    var q = function (sel) {
      return root.querySelector(sel);
    };
    var sound = q("[data-hf-sound]");
    var pause = q("[data-hf-pause]");
    var play = q("[data-hf-play]");
    var cc = q("[data-hf-captions]");
    var end = q("[data-hf-end]");
    var fill = q("[data-hf-fill]");
    var again = q("[data-hf-again]");

    // The script drives it from here: its own buttons, not the browser's.
    video.removeAttribute("controls");
    root.classList.add("hf--js");

    function show(el, on) {
      if (el) el.hidden = !on;
    }

    // muted: playing silently; playing: with sound; paused; idle: not started (or refused); ended.
    var state = "idle";
    function set(s) {
      state = s;
      root.setAttribute("data-hf-state", s);
      show(sound, s === "muted");
      show(pause, s === "muted" || s === "playing");
      show(play, s === "paused" || s === "idle");
      show(end, s === "ended");
      if (cc) cc.hidden = s === "ended";
    }

    function captions(on) {
      var t = video.textTracks && video.textTracks[0];
      if (t) t.mode = on ? "showing" : "hidden";
      if (cc) cc.setAttribute("aria-pressed", on ? "true" : "false");
    }

    // Focus moves only for someone using the film, and never scrolls the page: someone reading further
    // down while the silent film plays is left where they are. After a press, focus may already have
    // dropped to the page because the pressed button has just hidden itself; that still counts.
    function focusOn(el, afterPress) {
      var a = doc.activeElement;
      var using = root.contains(a) || (afterPress && (!a || a === doc.body));
      if (!el || !using) return;
      try {
        el.focus({ preventScroll: true });
      } catch (e) {
        el.focus();
      }
    }

    // Each start has a number. A refusal from an older one (a play cancelled by pressing Pause, say)
    // must not undo what has happened since.
    var run = 0;
    function refused(mine, pressed) {
      if (mine !== run) return;
      set("idle");
      if (pressed) focusOn(play, true);
    }

    function start(withSound, fromStart, pressed) {
      run += 1;
      var mine = run;
      if (fromStart) {
        try {
          video.currentTime = 0;
        } catch (e) {
          /* not yet loaded: it starts at the beginning anyway */
        }
      }
      video.muted = !withSound;
      set(withSound ? "playing" : "muted");
      // The button pressed has just hidden itself: keep the keyboard in the film, on Pause.
      if (pressed) focusOn(pause, true);
      var p;
      try {
        p = video.play();
      } catch (e) {
        p = null;
        refused(mine, pressed);
      }
      // A phone that will not play it (low power mode, say): its still and the big play button.
      if (p && typeof p.then === "function") {
        p.then(null, function () {
          refused(mine, pressed);
        });
      }
    }

    function storage() {
      try {
        return win.localStorage || null;
      } catch (e) {
        return null;
      }
    }
    function seenBefore() {
      var s = storage();
      try {
        return !!(s && s.getItem(SEEN));
      } catch (e) {
        return false;
      }
    }
    function remember() {
      var s = storage();
      try {
        if (s) s.setItem(SEEN, "1");
      } catch (e) {
        /* nothing to remember with */
      }
    }
    function asks(query) {
      try {
        return !!(win.matchMedia && win.matchMedia(query).matches);
      } catch (e) {
        return false;
      }
    }
    var saveData = !!(win.navigator && win.navigator.connection && win.navigator.connection.saveData);
    var reduce = asks("(prefers-reduced-motion: reduce)");

    if (sound) {
      sound.addEventListener("click", function () {
        start(true, true, true);
      });
    }
    if (pause) {
      pause.addEventListener("click", function () {
        run += 1; // any play still starting is cancelled by this
        video.pause();
        set("paused");
        focusOn(play, true);
      });
    }
    if (play) {
      play.addEventListener("click", function () {
        if (state === "idle") return start(true, true, true);
        start(!video.muted, false, true);
      });
    }
    if (cc) {
      cc.addEventListener("click", function () {
        captions(cc.getAttribute("aria-pressed") !== "true");
      });
    }
    if (again) {
      again.addEventListener("click", function () {
        start(true, true, true);
      });
    }
    video.addEventListener("ended", function () {
      set("ended");
      focusOn(fill);
    });
    // The phone or browser pausing or playing it itself (another app, the lock screen, headphones
    // out, a media key): the buttons follow. Browsers fire a pause just before the end; that is not one.
    video.addEventListener("pause", function () {
      if (video.ended || state === "idle" || state === "ended") return;
      set("paused");
    });
    video.addEventListener("play", function () {
      set(video.muted ? "muted" : "playing");
    });

    captions(true);
    set("idle");
    if (!reduce && !saveData && !seenBefore()) {
      remember();
      start(false, false);
    }
    return { state: function () {
      return state;
    } };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { initHomeFilm: initHomeFilm };
  } else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      initHomeFilm(document, window);
    });
  } else {
    initHomeFilm(document, window);
  }
})();
