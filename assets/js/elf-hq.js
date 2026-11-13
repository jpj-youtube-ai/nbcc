/* NBCC Elf Detective School: Detective HQ, a family's own page.
 *
 * The page (src/elf/pages/hq.ts) already works with no script: the guess is an ordinary form. This
 * only makes two things nicer:
 *
 *   1. The guess is saved without leaving the page, and the page says so, or says plainly why not.
 *      Once the place is shown the server sends the family on instead (Plan 2c-1): back to Detective
 *      HQ when it has its guess, or to the door's page for its one go. The page goes there, and only
 *      ever to an address on this site.
 *   2. The countdown to the clue ticks, by the SERVER's clock, and when it reaches nought the page
 *      is fetched again a few seconds later, because the clue itself is never in the page before it
 *      is out. Each page waits a different while, so every family's HQ does not ask in one second.
 *
 * Nothing here decides anything: the server says whether a guess is allowed (decideGuess in
 * src/elf/guess.ts), and when it says no, its own words are shown.
 *
 * Tested in test/unit/elf-js-hq.test.ts against the real page.
 */
(function () {
  "use strict";

  var NOT_SAVED = "We could not save your guess. Check your signal and try again.";
  // When a clue comes out, each page waits a second and up to five more before it is fetched again.
  var RELOAD_AFTER_MS = 1000;
  var RELOAD_SPREAD_MS = 5000;
  // An address on this site: one slash, then only what the site's own paths hold (sitePath in
  // src/elf/pages/shell.ts), so never another site, nor a slash and a backslash.
  var SITE_PATH = /^\/(?!\/)[A-Za-z0-9\/_.~%?=&-]*$/;

  /** How long is left: "2:14:09", "14:09", "0:05", and "0:00" once the time has come. The same
   *  words as countdownWords in src/elf/words.ts. */
  function countdownWords(ms) {
    var left = isFinite(ms) && ms > 0 ? Math.ceil(ms / 1000) : 0;
    var hours = Math.floor(left / 3600);
    var minutes = Math.floor((left % 3600) / 60);
    var seconds = left % 60;
    var ss = (seconds < 10 ? "0" : "") + seconds;
    if (hours > 0) return hours + ":" + (minutes < 10 ? "0" : "") + minutes + ":" + ss;
    return minutes + ":" + ss;
  }

  function initHq(doc, win, opts) {
    var clock = opts && opts.now ? opts.now : function () { return Date.now(); };
    var reload = opts && opts.reload ? opts.reload : function () { win.location.reload(); };
    // A wrapper, as reload is: location.assign taken on its own throws "Illegal invocation".
    var go = opts && opts.go ? opts.go : function (url) { win.location.assign(url); };
    var random = opts && opts.random ? opts.random : Math.random;
    var card = doc.querySelector(".elf-case");
    var served = card ? Date.parse(card.getAttribute("data-now")) : NaN;
    var skew = isNaN(served) ? 0 : served - clock();
    var fetched = false;
    var reloading = null;

    // ---- the countdown -------------------------------------------------------------------

    function tick() {
      var list = doc.querySelectorAll(".elf-cd[data-until]");
      var due = false;
      for (var i = 0; i < list.length; i++) {
        var until = Date.parse(list[i].getAttribute("data-until"));
        var left = until - (clock() + skew);
        list[i].textContent = countdownWords(left);
        // A time that had already passed when the page was drawn is not a reason to fetch the page
        // again: it would be drawn the same way, and fetched again, for ever.
        if (!(left > 0) && !(until <= served)) due = true;
      }
      // The clue is out. It was never in this page, so fetch the page again, once, after a different
      // short while on each page, so every family's HQ does not ask in the same second.
      if (due && !fetched) {
        fetched = true;
        reloading = win.setTimeout(reload, RELOAD_AFTER_MS + Math.floor(random() * RELOAD_SPREAD_MS));
      }
    }

    // ---- the guess -----------------------------------------------------------------------

    var form = doc.querySelector("form.elf-guess");
    var sending = false;

    function say(words, isError) {
      var status = form.querySelector(".elf-guess__status");
      if (!status) return;
      status.textContent = words;
      if (isError) status.classList.add("is-error");
      else status.classList.remove("is-error");
    }

    // With no fetch the form is left alone, and posts like any form.
    if (form && typeof win.fetch === "function") {
      form.addEventListener("submit", function (event) {
        event.preventDefault();
        if (sending) return;
        var box = form.querySelector('input[name="text"]');
        var place = box ? box.value.trim() : "";
        if (!place) {
          say("Type a place first.", true);
          return;
        }
        var door = form.querySelector('input[name="door"]');
        var button = form.querySelector("button");
        sending = true;
        if (button) button.disabled = true;
        win
          .fetch(form.getAttribute("data-api"), {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ door: Number(door ? door.value : 0), text: place })
          })
          .then(function (res) {
            return res
              .json()
              .catch(function () {
                return {};
              })
              .then(function (body) {
                var said = body && typeof body === "object" ? body : {};
                return {
                  saved: res.ok && said.ok === true,
                  text: typeof said.text === "string" && said.text ? said.text : place,
                  message: typeof said.message === "string" ? said.message : "",
                  goUrl: typeof said.goUrl === "string" && SITE_PATH.test(said.goUrl) ? said.goUrl : ""
                };
              });
          })
          .then(function (answer) {
            if (answer.saved) {
              say("Your guess: " + answer.text + ". You can change it until the hiding place is shown.", false);
              if (button) button.textContent = "Change my guess";
            } else if (answer.goUrl) {
              // The place is shown now: the server's words while the page goes where it says.
              say(answer.message, false);
              go(answer.goUrl);
            } else {
              say(answer.message || NOT_SAVED, true);
            }
          })
          .catch(function () {
            say(NOT_SAVED, true);
          })
          .then(function () {
            sending = false;
            if (button) button.disabled = false;
          });
      });
    }

    // ---- start ---------------------------------------------------------------------------

    var ticker = doc.querySelector(".elf-cd[data-until]") ? win.setInterval(tick, 1000) : null;

    return {
      tick: tick,
      stop: function () {
        if (ticker) win.clearInterval(ticker);
        if (reloading) win.clearTimeout(reloading);
      }
    };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { initHq: initHq };
  } else {
    initHq(document, window);
  }
})();
