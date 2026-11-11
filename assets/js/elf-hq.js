/* NBCC Elf Detective School: Detective HQ, a family's own page.
 *
 * The page (src/elf/pages/hq.ts) already works with no script: the guess is an ordinary form. This
 * only makes two things nicer:
 *
 *   1. The guess is saved without leaving the page, and the page says so, or says plainly why not.
 *   2. The countdown to the clue ticks, by the SERVER's clock, and when it reaches nought the page
 *      is fetched again, because the clue itself is never in the page before it is out.
 *
 * Nothing here decides anything: the server says whether a guess is allowed (decideGuess in
 * src/elf/guess.ts).
 *
 * Tested in test/unit/elf-js-hq.test.ts against the real page.
 */
(function () {
  "use strict";

  var NOT_SAVED = "We could not save your guess. Check your signal and try again.";
  var REFUSED = {
    "not-hunting": "Too late: this door has just opened. Have a look at the calendar.",
    "place-already-open": "That place is no longer on the list. Pick another.",
    "unknown-place": "That place is no longer on the list. Pick another."
  };

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
    var card = doc.querySelector(".elf-case");
    var served = card ? Date.parse(card.getAttribute("data-now")) : NaN;
    var skew = isNaN(served) ? 0 : served - clock();
    var fetched = false;

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
      // The clue is out. It was never in this page, so fetch the page again, once.
      if (due && !fetched) {
        fetched = true;
        reload();
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
        // Task 9: the typed guess's box is name="text" since Task 6; Task 9 rewrites what is sent.
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
            body: JSON.stringify({ door: Number(door ? door.value : 0), guess: place })
          })
          .then(function (res) {
            return res
              .json()
              .catch(function () {
                return {};
              })
              .then(function (body) {
                return { saved: res.ok && !!body && body.ok === true, reason: body ? body.reason : null };
              });
          })
          .then(function (answer) {
            if (answer.saved) {
              say("Guess locked in: " + place + ". You can change it until the elf is found.", false);
              if (button) button.textContent = "Change my guess";
            } else {
              say(REFUSED[answer.reason] || NOT_SAVED, true);
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
      }
    };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { initHq: initHq };
  } else {
    initHq(document, window);
  }
})();
