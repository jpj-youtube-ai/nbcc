/* Events page: turning the cards over.
 *
 * The page works without this file. Every card ships with both faces in the markup, and
 * without JavaScript they simply stack, front then back, so every detail and every booking
 * link is still there. This switches the deck into its card form and wires the turning.
 *
 * Turning a card over:
 *   - Click or tap anywhere on a card, or use its "See the full details" / "Turn back" button.
 *     The buttons are the real controls: they are what a keyboard or screen reader uses.
 *   - Links on the back go where they say. Selecting text (to copy an address, say) does
 *     not turn the card.
 *   - Escape turns a card back over.
 *
 * The face you cannot see is made inert, so it is out of the tab order and out of the
 * screen reader's reach. Focus follows the turn: to the back's heading on the way over, and
 * to the front's button on the way back, so a keyboard user never loses their place.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else if (typeof document !== "undefined") {
    // The admin's preview frames reach in through this to turn the card to the side staff asked for.
    root.nbccEvents = api;
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () {
        api.initDeck(document, window);
        api.initChips(document, window);
        api.initFilm(document, window);
      });
    } else {
      api.initDeck(document, window);
      api.initChips(document, window);
      api.initFilm(document, window);
    }
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function setFace(card, flipped, moveFocus) {
    var front = card.querySelector(".ev-front");
    var back = card.querySelector(".ev-back");
    if (!front || !back) return;

    // If focus is on the face being turned away, it has to go somewhere, or it falls to the
    // top of the page when that face goes inert.
    var active = card.ownerDocument.activeElement;
    if (active && (flipped ? front : back).contains(active)) moveFocus = true;

    card.classList.toggle("is-flipped", flipped);
    front.inert = flipped;
    back.inert = !flipped;
    // aria-hidden as well, for the few browsers still without inert.
    front.setAttribute("aria-hidden", flipped ? "true" : "false");
    back.setAttribute("aria-hidden", flipped ? "false" : "true");

    if (moveFocus) {
      var target = flipped
        ? back.querySelector(".ev-title[tabindex]") || back.querySelector(".ev-turn")
        : front.querySelector(".ev-turn");
      if (target) target.focus({ preventScroll: true });
    }
  }

  function isFlipped(card) {
    return card.classList.contains("is-flipped");
  }

  function selectedText(win) {
    var sel = win.getSelection ? win.getSelection() : null;
    return sel ? String(sel) : "";
  }

  function columnCount(deck, win) {
    var cols = win.getComputedStyle(deck).gridTemplateColumns || "";
    var n = cols.split(" ").filter(Boolean).length;
    return n > 0 ? n : 1;
  }

  /* Deal the cards onto the table as each comes into view, left to right across a row. */
  function dealIn(deck, cards, doc, win) {
    var reduced =
      typeof win.matchMedia === "function" && win.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // data-no-deal: the admin's previews redraw as staff type, and a deal on every redraw would be
    // a card jumping about under their hands.
    if (reduced || !win.IntersectionObserver || deck.hasAttribute("data-no-deal")) return;

    var cols = columnCount(deck, win);
    cards.forEach(function (card, i) {
      card.style.setProperty("--deal-delay", (i % cols) * 110 + "ms");
      card.classList.add("is-waiting");
    });

    function deal(card) {
      if (!card.classList.contains("is-waiting")) return;
      card.classList.add("is-dealt");
      card.classList.remove("is-waiting");
      // Hand the transform back to the hover and flip styles once the deal has landed.
      win.setTimeout(function () {
        card.classList.remove("is-dealt");
        card.style.removeProperty("--deal-delay");
      }, 1100);
    }

    var io = new win.IntersectionObserver(
      function (entries, obs) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          obs.unobserve(entry.target);
          deal(entry.target);
        });
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    cards.forEach(function (card) {
      io.observe(card);
    });

    // A card must never be left face down on the table. If the observer has not fired by now (a
    // background tab, a print preview, a browser that throttles it), deal whatever is still waiting.
    win.setTimeout(function () {
      io.disconnect();
      cards.forEach(deal);
    }, 2500);
  }

  function initDeck(doc, win) {
    var deck = doc.querySelector("[data-deck]");
    if (!deck) return null;

    var cards = Array.prototype.slice.call(deck.querySelectorAll(".ev-card"));
    deck.classList.add("deck--flip");
    var hint = doc.querySelector("[data-deck-hint]");
    if (hint) hint.hidden = false;

    cards.forEach(function (card) {
      setFace(card, false, false);

      card.addEventListener("click", function (e) {
        var target = e.target;
        if (target.closest && target.closest("a")) return; // links go where they say
        var viaButton = !!(target.closest && target.closest(".ev-turn"));
        // Selecting an address or a phone number to copy it must not turn the card over.
        if (!viaButton && selectedText(win)) return;
        setFace(card, !isFlipped(card), viaButton || e.detail === 0);
      });

      card.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && isFlipped(card)) {
          e.preventDefault();
          setFace(card, false, true);
        }
      });
    });

    dealIn(deck, cards, doc, win);
    return { deck: deck, cards: cards, setFace: setFace };
  }

  /* Get involved's chips (TASK-494): All, Events and Fundraisers filter the cards in place. They ship
   * hidden, so without this script every card simply shows. Each card carries data-kind ("event" or
   * "fundraiser"); the face down card counts as an event. A status line tells a screen reader what
   * is showing, and an empty Fundraisers view says so rather than leaving a blank table. */
  var STATUS = { all: "Showing everything", event: ["event", "events"], fundraiser: ["fundraiser", "fundraisers"] };

  function initChips(doc, win) {
    var group = doc.querySelector("[data-chips]");
    var deck = doc.querySelector("[data-deck]");
    if (!group || !deck) return null;
    var buttons = Array.prototype.slice.call(group.querySelectorAll("[data-show]"));
    var cards = Array.prototype.slice.call(deck.querySelectorAll(".ev-card"));
    var status = doc.querySelector("[data-chips-status]");

    function show(kind) {
      var count = 0;
      cards.forEach(function (card) {
        var match = kind === "all" || card.getAttribute("data-kind") === kind;
        card.hidden = !match;
        if (match && !card.classList.contains("ev-card--more")) count += 1;
      });
      buttons.forEach(function (b) {
        b.setAttribute("aria-pressed", b.getAttribute("data-show") === kind ? "true" : "false");
      });
      Array.prototype.forEach.call(doc.querySelectorAll("[data-chips-empty]"), function (el) {
        el.hidden = !(el.getAttribute("data-chips-empty") === kind && count === 0);
      });
      if (status) {
        var words = STATUS[kind];
        status.textContent = kind === "all" ? words : "Showing " + count + " " + (count === 1 ? words[0] : words[1]);
      }
    }

    buttons.forEach(function (b) {
      b.addEventListener("click", function () {
        show(b.getAttribute("data-show"));
      });
    });
    group.hidden = false;
    return { show: show, win: win };
  }

  /* The one minute film (src/fundraising/film.ts has the markup and what NBCC decided).
   *
   * Whether this is a first visit or a later one was settled in the head, before the page was
   * drawn, as a class on <html>. This reads that class once and never changes it, so the film
   * cannot fold away part way through a visit when the "seen" note is written.
   *
   *   film-first  Full size. Plays by itself with the sound off once it is on screen, pauses when
   *               scrolled well away or the tab is hidden, and wears a "Play with sound" button
   *               that starts it again from the beginning with sound and the browser's controls.
   *               The note is written when it is really playing. For anyone who has asked their
   *               device for less motion or to save data (or whose browser refuses to play), it
   *               shows the still and a "Play the film" button instead, and that counts as seen.
   *   film-later  A slim strip. Pressing it opens the film in place, with sound; "Close the film"
   *               folds it away again. Nothing of the film is fetched until then.
   *   neither     The plain player the markup is without this script. Left alone.
   */
  var FILM_SEEN_KEY = "nbcc-film-seen";

  function initFilm(doc, win) {
    var root = doc.querySelector("[data-film]");
    var video = root && root.querySelector("[data-film-video]");
    if (!root || !video) return null;
    var sound = root.querySelector("[data-film-sound]");
    var soundWords = root.querySelector("[data-film-sound-words]");
    var strip = root.querySelector("[data-film-open]");
    var close = root.querySelector("[data-film-close]");
    var player = root.querySelector("[data-film-player]");
    var html = doc.documentElement;
    var mode = html.classList.contains("film-first") ? "first" : html.classList.contains("film-later") ? "later" : "";
    if (!mode || !sound) return { mode: mode };

    var reduced = typeof win.matchMedia === "function" && win.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var connection = win.navigator && win.navigator.connection;
    var saveData = !!(connection && connection.saveData);
    // "auto": playing by itself, sound off. "still": the picture and a play button. "sound": the
    // visitor pressed play, and from then on the film is theirs to run with the controls.
    var state = "";
    var inView = false;
    var finished = false;
    var marked = false;
    var observer = null;

    function markSeen() {
      if (marked) return;
      marked = true;
      try {
        win.localStorage.setItem(FILM_SEEN_KEY, "1");
      } catch (e) {
        /* storage switched off: nothing to remember, and nothing to tell the visitor */
      }
    }

    function showStill() {
      // The frame already wears the still as its background; this is for the browsers that paint a
      // video with nothing loaded as a black box.
      var poster = video.getAttribute("data-poster");
      if (poster && !video.getAttribute("poster")) video.setAttribute("poster", poster);
    }

    function tryPlay() {
      var started;
      try {
        started = video.play();
      } catch (e) {
        return null;
      }
      return started && typeof started.then === "function" ? started : null;
    }

    function still() {
      state = "still";
      if (observer) observer.disconnect();
      video.controls = false;
      if (soundWords) soundWords.textContent = "Play the film";
      sound.classList.add("gi-film__sound--centre");
      sound.hidden = false;
      markSeen();
    }

    function withSound() {
      state = "sound";
      if (observer) observer.disconnect();
      sound.hidden = true;
      video.muted = false;
      video.controls = true;
      try {
        video.currentTime = 0;
      } catch (e) {
        /* nothing loaded yet: it starts from the beginning anyway */
      }
      var started = tryPlay();
      if (started) started.catch(function () {});
      // The button that was pressed has just gone, so focus goes to the player it started.
      video.focus({ preventScroll: true });
      // Not every browser lets a video take focus; the button after it is the next best place.
      if (doc.activeElement !== video && close && root.classList.contains("is-open")) {
        close.focus({ preventScroll: true });
      }
    }

    function auto() {
      state = "auto";
      video.muted = true;
      video.controls = false;
      sound.hidden = false;
      video.addEventListener("playing", function () {
        if (state === "auto") markSeen();
      });
      video.addEventListener("ended", function () {
        finished = true;
      });
      function resume() {
        if (state !== "auto" || finished || !inView || doc.visibilityState === "hidden") return;
        var started = tryPlay();
        if (started) {
          started.catch(function () {
            if (state === "auto") still();
          });
        }
      }
      observer = new win.IntersectionObserver(
        function (entries) {
          if (state !== "auto") return;
          entries.forEach(function (entry) {
            var ratio = entry.intersectionRatio;
            if (ratio >= 0.5 && !inView) {
              inView = true;
              resume();
            } else if (ratio < 0.25 && inView) {
              inView = false;
              video.pause();
            }
          });
        },
        { threshold: [0, 0.25, 0.5, 0.75] },
      );
      observer.observe(video);
      doc.addEventListener("visibilitychange", function () {
        if (state !== "auto" || !inView) return;
        if (doc.visibilityState === "hidden") video.pause();
        else resume();
      });
    }

    sound.addEventListener("click", withSound);

    if (mode === "first") {
      showStill();
      if (reduced || saveData || !win.IntersectionObserver) still();
      else auto();
    } else {
      if (strip) {
        strip.addEventListener("click", function () {
          showStill();
          root.classList.add("is-open");
          // Unfold from nothing, unless the visitor has asked for less motion.
          if (!reduced && player && typeof player.animate === "function") {
            var height = player.getBoundingClientRect().height;
            if (height > 0) {
              player.classList.add("is-opening");
              var unfold = player.animate(
                [
                  { height: "0px", opacity: 0 },
                  { height: height + "px", opacity: 1 },
                ],
                { duration: 380, easing: "cubic-bezier(0.25, 1, 0.5, 1)" },
              );
              var done = function () {
                player.classList.remove("is-opening");
              };
              unfold.onfinish = done;
              unfold.oncancel = done;
            }
          }
          withSound();
        });
      }
      if (close) {
        close.addEventListener("click", function () {
          video.pause();
          state = "";
          root.classList.remove("is-open");
          if (strip) strip.focus({ preventScroll: true });
        });
      }
    }

    return {
      mode: mode,
      state: function () {
        return state;
      },
    };
  }

  return { initDeck: initDeck, setFace: setFace, initChips: initChips, initFilm: initFilm, FILM_SEEN_KEY: FILM_SEEN_KEY };
});
