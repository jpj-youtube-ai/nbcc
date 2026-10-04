/* NBCC Elf Detective School: the page a poster's QR code opens.
 *
 * The page (src/elf/pages/poster.ts) already works with no script: both of its forms post to the
 * server like any form. This makes three things nicer:
 *
 *   1. A claim is sent without leaving the page, and the gold "You're first!" card is shown at
 *      once, with a clock that ticks, so the staff can tell the card from a picture of one.
 *   2. A check in can use the phone's location. It is read once, sent once and kept nowhere. A
 *      photo is sent the same way for anyone who would rather not share where they are.
 *   3. When the answer is no, the page says why.
 *
 * Nothing here decides anything. The server says who was first and whether a visit counts
 * (decideClaim and decideStamp in src/elf/), and it writes the words and the cards too: this only
 * shows them. A card arrives as the server's own markup, drawn by the same code that draws the
 * page; a refusal arrives as words and is shown as words.
 *
 * Tested in test/unit/elf-js-poster.test.ts against the real page.
 */
(function () {
  "use strict";

  var NO_SIGNAL = "We could not reach NBCC. Check your signal and try again.";
  var PROBLEM = "Something went wrong. Refresh the page and try again.";
  var NO_LOCATION = "We could not find where your phone is. You can take a photo here instead.";

  /** The time in London with its seconds: "5:47:13pm". */
  function clockWords(ms) {
    var parts;
    try {
      parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hourCycle: "h23", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(ms));
    } catch (err) {
      return "";
    }
    var got = {};
    for (var i = 0; i < parts.length; i++) got[parts[i].type] = parts[i].value;
    var hour = Number(got.hour) % 24;
    var twelve = hour % 12 === 0 ? 12 : hour % 12;
    return twelve + ":" + got.minute + ":" + got.second + (hour < 12 ? "am" : "pm");
  }

  function initPoster(doc, win, opts) {
    var clock = opts && opts.now ? opts.now : function () { return Date.now(); };
    var geo = opts && "geolocation" in opts ? opts.geolocation : win.navigator && win.navigator.geolocation;
    var result = doc.getElementById("elf-result");
    var claim = doc.querySelector("form.elf-claim");
    var stamp = doc.querySelector("form.elf-stamp");
    var busy = false;
    var ticker = null;
    // With no fetch both forms are left alone, and post like any form.
    var canSend = typeof win.fetch === "function";
    // How long to wait for the phone to say where it is, in milliseconds.
    var patience = opts && typeof opts.patience === "number" ? opts.patience : 20000;

    // ---- small helpers ---------------------------------------------------------------------

    function say(form, words, isError) {
      var status = form.querySelector(".elf-form-status");
      if (!status) return;
      status.textContent = words;
      if (isError) status.classList.add("is-error");
      else status.classList.remove("is-error");
    }

    function hold(form, on) {
      busy = on;
      var buttons = form.querySelectorAll("button");
      for (var i = 0; i < buttons.length; i++) buttons[i].disabled = on;
    }

    function chosen(form) {
      var boxes = form.querySelectorAll('input[name="detective"]');
      var ids = [];
      for (var i = 0; i < boxes.length; i++) {
        if (boxes[i].checked) ids.push(boxes[i].value);
      }
      return ids;
    }

    function code(form) {
      var input = form.querySelector('input[name="code"]');
      return input ? input.value : "";
    }

    function cardOf(form) {
      var el = form;
      while (el && el !== doc.body) {
        if (el.classList && el.classList.contains("elf-case")) return el;
        el = el.parentNode;
      }
      return form;
    }

    // ---- the clock on the gold card -----------------------------------------------------------

    // The card carries the server's time as it was drawn. The clock runs on from there by this
    // device's ticking, so a phone whose own clock is wrong still shows the right time.
    function tick() {
      var clocks = doc.querySelectorAll(".elf-clock[data-now]");
      for (var i = 0; i < clocks.length; i++) {
        var el = clocks[i];
        if (!el.getAttribute("data-skew")) {
          var served = Date.parse(el.getAttribute("data-now"));
          el.setAttribute("data-skew", String(isNaN(served) ? 0 : served - clock()));
        }
        var words = clockWords(clock() + Number(el.getAttribute("data-skew")));
        el.textContent = words;
        if (words && el.parentNode) el.parentNode.hidden = false;
      }
      if (clocks.length && !ticker) ticker = win.setInterval(tick, 1000);
    }

    // ---- sending, and showing the answer ------------------------------------------------------

    function show(html, form) {
      if (!result) return;
      // The server's own card, drawn by src/elf/pages/poster.ts, which makes everything in it safe.
      // A candy cane card goes under a gold card, never over it: the staff may still need to see it.
      if (form === stamp && result.querySelector(".elf-win")) result.insertAdjacentHTML("beforeend", html);
      else result.innerHTML = html;
      cardOf(form).hidden = true;
      var later = doc.querySelector(".elf-poster__later");
      if (later) later.hidden = true;
      result.focus();
      if (result.scrollIntoView) result.scrollIntoView({ block: "start" });
      tick();
    }

    function send(form, init) {
      hold(form, true);
      init.method = "POST";
      init.credentials = "same-origin";
      return win
        .fetch(form.getAttribute("data-api"), init)
        .then(function (res) {
          return res
            .json()
            .catch(function () {
              return null;
            })
            .then(function (body) {
              var answer = body && typeof body === "object" ? body : {};
              if (res.ok && answer.ok === true && typeof answer.html === "string" && answer.html) return { html: answer.html };
              return { words: answer.ok === false && typeof answer.message === "string" && answer.message ? answer.message : PROBLEM };
            });
        })
        .catch(function () {
          return { words: NO_SIGNAL };
        })
        .then(function (answer) {
          hold(form, false);
          if (answer.html) show(answer.html, form);
          else say(form, answer.words, true);
        });
    }

    function json(payload) {
      return { headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) };
    }

    // ---- claiming the elf ---------------------------------------------------------------------

    if (claim && canSend) {
      claim.addEventListener("submit", function (event) {
        event.preventDefault();
        if (busy) return;
        var who = chosen(claim);
        var word = claim.querySelector('input[name="word"]');
        var typed = word ? word.value : "";
        if (!who.length) return say(claim, "Tick who found the elf.", true);
        if (!typed.replace(/\s/g, "")) return say(claim, "Type the secret word on the elf's tag.", true);
        say(claim, "", false);
        send(claim, json({ code: code(claim), detectiveIds: who, word: typed }));
      });
    }

    // ---- checking in ----------------------------------------------------------------------------

    if (stamp && canSend) {
      var locate = stamp.querySelector(".elf-stamp__location");
      var here = locate ? locate.querySelector("button") : null;
      var photo = stamp.querySelector('input[type="file"]');
      // While the phone is being asked where it is, this calls the asking off.
      var callOff = null;

      if (locate && here && geo && typeof geo.getCurrentPosition === "function") {
        locate.hidden = false;
        here.addEventListener("click", function () {
          if (busy) return;
          var who = chosen(stamp);
          if (!who.length) return say(stamp, "Tick who is here.", true);
          // Only this button waits. The photo stays on offer: a phone can leave its question
          // about sharing a location unanswered for ever, and call neither answer below.
          busy = true;
          here.disabled = true;
          say(stamp, "Finding where you are", false);
          var answered = false;
          var giveUp = function () {
            if (answered) return;
            answered = true;
            busy = false;
            here.disabled = false;
            say(stamp, NO_LOCATION, true);
          };
          var watchdog = win.setTimeout(giveUp, patience);
          callOff = function () {
            answered = true;
            win.clearTimeout(watchdog);
            busy = false;
            here.disabled = false;
          };
          // Asked once, used once. The position goes to the server and is kept nowhere here.
          geo.getCurrentPosition(
            function (position) {
              if (answered) return;
              answered = true;
              win.clearTimeout(watchdog);
              busy = false;
              here.disabled = false;
              say(stamp, "", false);
              send(stamp, json({ code: code(stamp), detectiveIds: who, location: { lat: position.coords.latitude, lng: position.coords.longitude } }));
            },
            function () {
              win.clearTimeout(watchdog);
              giveUp();
            },
            { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
          );
        });
      }

      stamp.addEventListener("submit", function (event) {
        event.preventDefault();
        // A photo may be sent while the phone is still being asked where it is: the photo wins.
        if (callOff && here && here.disabled) callOff();
        if (busy) return;
        var who = chosen(stamp);
        var file = photo && photo.files && photo.files.length ? photo.files[0] : null;
        if (!who.length) return say(stamp, "Tick who is here.", true);
        if (!file) return say(stamp, "Choose a photo first.", true);
        var data = new win.FormData();
        data.append("code", code(stamp));
        for (var i = 0; i < who.length; i++) data.append("detective", who[i]);
        data.append("photo", file);
        say(stamp, "Sending your photo", false);
        send(stamp, { body: data });
      });
    }

    // A card the server drew into the page (a form posted before this script ran) gets its clock.
    tick();

    return {
      tick: tick,
      stop: function () {
        if (ticker) win.clearInterval(ticker);
        ticker = null;
      }
    };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { initPoster: initPoster };
  } else {
    initPoster(document, window);
  }
})();
