/* NBCC Elf Detective School: the film on the front page (src/elf/pages/film.ts).
 *
 * The page already works with no script: the browser plays the film by itself without sound and its
 * own controls turn the sound on. This makes it better, in four ways:
 *
 *   1. It plays by itself when people arrive (muted: no browser allows anything else), once.
 *   2. A "Turn the sound on" button shows while it plays without sound; pressing it unmutes, and it
 *      goes away. The browser's own sound control does the same.
 *   3. Anyone who has asked for less motion, or to save data, gets the poster and a play button
 *      instead (a few lines straight after the video take autoplay off before it can start).
 *   4. While it plays it waits when scrolled fully out of view and carries on when it is back. It
 *      never starts again once it has ended or once the person has paused it.
 *
 * There are no captions yet: when the charity sends the words, a captions file (.vtt) goes in the
 * video as a <track>, as on the Get involved film (see src/elf/pages/film.ts and the README).
 *
 * Tested in test/unit/elf-film-js.test.ts against the real page.
 */
(function () {
  "use strict";

  function initElfFilm(doc, win) {
    var root = doc.querySelector("[data-elf-film]");
    var video = root && root.querySelector("[data-elf-film-video]");
    if (!root || !video) return null;
    var sound = root.querySelector("[data-elf-film-sound]");

    var connection = win.navigator && win.navigator.connection;
    var calm =
      (typeof win.matchMedia === "function" && win.matchMedia("(prefers-reduced-motion: reduce)").matches) ||
      !!(connection && connection.saveData);

    // "Waiting" is our own pause, for a film that is scrolled out of view. Only that is ever undone.
    var waiting = false;
    var inView = true;

    function showSound() {
      if (sound) sound.hidden = !(video.muted && !video.ended && !video.paused);
    }

    function wait() {
      if (video.paused || video.ended) return;
      waiting = true;
      video.pause();
    }

    function carryOn() {
      if (!waiting) return;
      waiting = false;
      if (video.ended) return;
      try {
        var started = video.play();
        if (started && started.catch) started.catch(function () {});
      } catch (e) {
        /* the browser would not: the person has the controls */
      }
    }

    video.addEventListener("play", function () {
      waiting = false;
      showSound();
      // Started (by the browser, or by the person) while out of view: hold it until it is seen.
      if (!inView) wait();
    });
    video.addEventListener("pause", showSound);
    video.addEventListener("ended", function () {
      waiting = false;
      showSound();
    });
    video.addEventListener("volumechange", showSound);

    if (sound) {
      sound.addEventListener("click", function () {
        video.muted = false;
        sound.hidden = true;
      });
    }

    if (calm) {
      // The poster and the browser's play button, and nothing downloaded until it is pressed.
      video.removeAttribute("autoplay");
      video.setAttribute("preload", "none");
      if (!video.paused) video.pause();
      showSound();
      return { video: video, calm: true };
    }

    if (typeof win.IntersectionObserver === "function") {
      var observer = new win.IntersectionObserver(function (entries) {
        var entry = entries[entries.length - 1];
        inView = !!entry && (entry.isIntersecting || entry.intersectionRatio > 0);
        if (inView) carryOn();
        else wait();
      });
      observer.observe(video);
    }

    showSound();
    if (video.paused && !video.ended) {
      try {
        var asked = video.play();
        if (asked && asked.catch) asked.catch(function () {});
      } catch (e) {
        /* the poster and the browser's play button stay */
      }
    }
    return { video: video, calm: false };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { initElfFilm: initElfFilm };
  } else {
    initElfFilm(document, window);
  }
})();
