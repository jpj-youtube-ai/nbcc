/* NBCC Elf Detective School: the public calendar comes alive.
 *
 * The calendar page (src/elf/pages/calendar.ts) already works with no script: every door is a link
 * to its own detail. This only makes it nicer, in five ways:
 *
 *   1. A tap opens a door's detail in place, under the door's own row, and a second tap shuts it.
 *   2. Countdowns tick, by the SERVER's clock: a phone with the wrong time still counts down right.
 *   3. Every few seconds it asks a small feed whether any door has changed, and fetches only the
 *      doors that have. The server draws them, with the same code that drew the page, so this file
 *      never builds a door itself and the two can never show a door differently.
 *   4. For a family that is signed in, it lays their own marks over the board, and marks the
 *      family's own photo in an open door's scrapbook, with a button to take it down.
 *   5. "Close door n" in a scrapbook shuts it and puts focus back on the door.
 *
 * Nothing here decides anything. If every request fails, the page stays exactly as it was served.
 *
 * Tested in test/unit/elf-js-calendar.test.ts against the real page.
 */
(function () {
  "use strict";

  var POLL_MS = 15000;
  // While an elf is being hunted, or a clue is about to come out, news matters more.
  var POLL_BUSY_MS = 5000;
  var POLL_MAX_MS = 60000;
  var SOON_MS = 2 * 60 * 1000;

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

  function initCalendar(doc, win, opts) {
    var board = doc.getElementById("elf-board");
    if (!board) return null;

    var clock = opts && opts.now ? opts.now : function () { return Date.now(); };
    var feedUrl = board.getAttribute("data-feed");
    var doorApi = board.getAttribute("data-door-api");
    var meUrl = board.getAttribute("data-me");
    var skew = 0;
    var marks = {};
    // The family's own photo at each door: its token.
    var photos = {};
    var signedIn = false;
    var failures = 0;
    var stopped = false;
    var ticker = null;
    var pollTimer = null;

    function setSkew(iso) {
      var t = Date.parse(iso);
      if (!isNaN(t)) skew = t - clock();
    }
    function now() {
      return clock() + skew;
    }
    function doorOf(n) {
      return doc.getElementById("door-" + n);
    }
    function detailOf(n) {
      return doc.getElementById("case-" + n);
    }
    function eachDoor(fn) {
      var list = board.querySelectorAll(".elf-door");
      for (var i = 0; i < list.length; i++) fn(list[i]);
    }

    // ---- opening and shutting a detail ---------------------------------------------------

    // A door is a link in the page as served. With this script it acts as a button that opens and
    // shuts its detail, so it says so to a screen reader.
    function dress(door) {
      var n = door.getAttribute("data-door");
      var detail = detailOf(n);
      door.setAttribute("role", "button");
      door.setAttribute("aria-controls", "case-" + n);
      door.setAttribute("aria-expanded", detail && detail.classList.contains("is-open") ? "true" : "false");
    }

    function shutAll() {
      var open = board.querySelectorAll(".elf-detail.is-open");
      for (var i = 0; i < open.length; i++) open[i].classList.remove("is-open");
      eachDoor(function (door) {
        door.setAttribute("aria-expanded", "false");
      });
    }

    function rattle(door) {
      door.classList.add("is-rattled");
      win.setTimeout(function () {
        door.classList.remove("is-rattled");
      }, 500);
    }

    function toggle(door) {
      var detail = detailOf(door.getAttribute("data-door"));
      if (!detail) return;
      var wasOpen = detail.classList.contains("is-open");
      // Shutting another door's detail higher up the board moves this door up the screen. Measure
      // it before and after, and scroll by the difference, so it stays under the finger.
      var before = door.getBoundingClientRect().top;
      shutAll();
      if (!wasOpen) {
        detail.classList.add("is-open");
        door.setAttribute("aria-expanded", "true");
        var kind = door.getAttribute("data-kind");
        if (kind === "later" || kind === "tomorrow") rattle(door);
      }
      var moved = door.getBoundingClientRect().top - before;
      if (moved && win.scrollBy) win.scrollBy(0, moved);
    }

    function doorFrom(target) {
      var door = target && target.closest ? target.closest(".elf-door") : null;
      return door && board.contains(door) ? door : null;
    }

    // The scrapbook's own "Close door n": shut the detail and give focus back to the door.
    function closeFrom(target) {
      var link = target && target.closest ? target.closest(".elf-book__close a") : null;
      var detail = link && link.closest ? link.closest(".elf-detail") : null;
      var n = detail ? /^case-(\d+)$/.exec(detail.id || "") : null;
      return n ? n[1] : null;
    }
    function shut(n) {
      var detail = detailOf(n);
      var door = doorOf(n);
      if (detail) detail.classList.remove("is-open");
      if (door) {
        door.setAttribute("aria-expanded", "false");
        if (door.focus) door.focus();
      }
    }

    board.addEventListener("click", function (event) {
      var closing = closeFrom(event.target);
      if (closing) {
        event.preventDefault();
        shut(closing);
        return;
      }
      var door = doorFrom(event.target);
      if (!door) return;
      event.preventDefault();
      toggle(door);
    });
    board.addEventListener("keydown", function (event) {
      if (event.key !== " " && event.key !== "Enter") return;
      var door = doorFrom(event.target);
      if (!door) return;
      // Stopping the key here also stops Enter turning into a click, so it toggles once.
      event.preventDefault();
      toggle(door);
    });

    // ---- countdowns ----------------------------------------------------------------------

    function tick() {
      var due = false;
      var list = doc.querySelectorAll(".elf-cd[data-until]");
      for (var i = 0; i < list.length; i++) {
        var left = Date.parse(list[i].getAttribute("data-until")) - now();
        list[i].textContent = countdownWords(left);
        if (!(left > 0) && !list[i].getAttribute("data-done")) {
          list[i].setAttribute("data-done", "1");
          due = true;
        }
      }
      // The moment a clue is due, ask for news once instead of waiting for the next turn.
      if (due) poll();
    }

    // ---- a family's own marks ------------------------------------------------------------

    function markTemplate(cracked) {
      var all = doc.querySelectorAll(".elf-legend .elf-mark");
      for (var i = 0; i < all.length; i++) {
        if (all[i].classList.contains("elf-mark--cracked") === cracked) return all[i];
      }
      return null;
    }

    function mineWords(mark) {
      if (mark.cracked && mark.visited) return "Your family cracked this case and has been there. Both marks collected.";
      if (mark.cracked) return "Your family cracked this case. Visit before the Night Before Christmas for your candy cane too.";
      if (mark.visited) return "Your family has been there. Candy cane collected.";
      return "Not done yet. Visit before the Night Before Christmas for your candy cane.";
    }

    function applyMarks(n) {
      if (!signedIn) return;
      var door = doorOf(n);
      var detail = detailOf(n);
      if (!door || !detail) return;
      applyPhoto(n);
      var mark = marks[n] || { cracked: false, visited: false };
      // A door the family has done, cracked or visited, wears the painted holly.
      door.classList.toggle("is-done", mark.cracked || mark.visited);
      var holder = door.querySelector(".elf-door__marks");
      if (holder) {
        holder.textContent = "";
        [true, false].forEach(function (cracked) {
          var template = markTemplate(cracked);
          if (template && (cracked ? mark.cracked : mark.visited)) holder.appendChild(template.cloneNode(true));
        });
      }
      if (!door.getAttribute("data-label")) door.setAttribute("data-label", door.getAttribute("aria-label") || "");
      door.setAttribute(
        "aria-label",
        door.getAttribute("data-label") + (mark.cracked ? " You cracked it." : "") + (mark.visited ? " You have been there." : "")
      );
      var mine = detail.querySelector(".elf-detail__mine");
      var kind = door.getAttribute("data-kind");
      if (mine && (kind === "found" || kind === "revealed")) {
        mine.textContent = mineWords(mark);
        mine.hidden = false;
        // The family's own line says what is left to do, so the general hint would only repeat it.
        var hint = detail.querySelector(".elf-detail__hint");
        if (hint) hint.hidden = true;
      }
    }

    // The family's own photo in an open door's scrapbook wears "Your photo" and a way to take it down.
    function applyPhoto(n) {
      var token = photos[n];
      var detail = detailOf(n);
      if (!token || !detail) return;
      var list = detail.querySelectorAll("figure[data-token]");
      var figure = null;
      for (var i = 0; i < list.length; i++) {
        if (list[i].getAttribute("data-token") === token) figure = list[i];
      }
      if (!figure || figure.querySelector(".elf-photo-down")) return;
      figure.classList.add("elf-pol--mine");
      var caption = doc.createElement("figcaption");
      caption.textContent = "Your photo";
      figure.appendChild(caption);
      var button = doc.createElement("button");
      button.type = "button";
      button.className = "elf-btn elf-btn--s elf-photo-down";
      button.textContent = "Take it down";
      figure.appendChild(button);
    }

    function takeDown(button) {
      var figure = button.closest ? button.closest("figure[data-token]") : null;
      var detail = button.closest ? button.closest(".elf-detail") : null;
      var n = detail ? /^case-(\d+)$/.exec(detail.id || "") : null;
      if (!figure || !n || button.disabled) return;
      var door = n[1];
      button.disabled = true;
      win
        .fetch(doorApi + door + "/photo", { method: "DELETE", credentials: "same-origin" })
        .then(function (res) {
          if (!res.ok) throw new Error("not taken down");
          delete photos[door];
          return refresh(door);
        })
        .catch(function () {
          button.disabled = false;
          var status = figure.querySelector(".elf-form-status");
          if (!status) {
            status = doc.createElement("p");
            status.className = "elf-form-status";
            status.setAttribute("role", "status");
            figure.appendChild(status);
          }
          status.textContent = "We could not take your photo down just now. Please try again.";
          status.classList.add("is-error");
        });
    }

    board.addEventListener("click", function (event) {
      var button = event.target && event.target.closest ? event.target.closest(".elf-photo-down") : null;
      if (!button || !board.contains(button)) return;
      event.preventDefault();
      event.stopPropagation();
      takeDown(button);
    });

    function loadMarks() {
      if (!meUrl) return Promise.resolve();
      return win
        .fetch(meUrl, { credentials: "same-origin" })
        .then(function (res) {
          return res.status === 200 ? res.json() : null;
        })
        .then(function (body) {
          if (!body || !body.doors) return;
          // Signed in, even with no marks yet: every open door then says what is left to do.
          signedIn = true;
          var mine = body.photos || [];
          for (var p = 0; p < mine.length; p++) {
            if (mine[p] && typeof mine[p].token === "string") photos[mine[p].door] = mine[p].token;
          }
          for (var i = 0; i < body.doors.length; i++) {
            marks[body.doors[i].door] = { cracked: body.doors[i].cracked === true, visited: body.doors[i].visited === true };
          }
          eachDoor(function (door) {
            applyMarks(door.getAttribute("data-door"));
          });
        })
        .catch(function () {
          // Not signed in, or no answer: the board stays as it was served.
        });
    }

    // ---- news from the live feed ---------------------------------------------------------

    function setTally(found) {
      var tally = doc.querySelector(".elf-tally b");
      if (tally && typeof found === "number") tally.textContent = String(found);
    }

    // Today's news at the top. The words come from the server, already safe to put in the page.
    function setStatus(status) {
      var card = doc.querySelector(".elf-status");
      if (!card || !status || typeof status.title !== "string" || typeof status.html !== "string") return;
      var stamp = status.kind + "|" + status.title + "|" + status.html;
      if (card.getAttribute("data-v") === stamp) return;
      var title = card.querySelector(".elf-status__title");
      var body = card.querySelector(".elf-status__body");
      if (!title || !body) return;
      card.setAttribute("data-v", stamp);
      card.className = "elf-status elf-card elf-status--" + String(status.kind).replace(/[^a-z]/g, "");
      title.innerHTML = status.title;
      body.innerHTML = status.html;
    }

    // Draw one door again. The HTML is the server's own, made by the code that drew the page.
    function refresh(n) {
      return win
        .fetch(doorApi + n)
        .then(function (res) {
          return res.ok ? res.json() : null;
        })
        .then(function (fresh) {
          var oldDoor = doorOf(n);
          var oldDetail = detailOf(n);
          if (!fresh || typeof fresh.tile !== "string" || typeof fresh.detail !== "string" || !oldDoor || !oldDetail) return;
          var box = doc.createElement("template");
          box.innerHTML = fresh.tile + fresh.detail;
          var door = box.content.querySelector(".elf-door");
          var detail = box.content.querySelector(".elf-detail");
          if (!door || !detail) return;
          var wasOpen = oldDetail.classList.contains("is-open");
          var wasFound = oldDoor.getAttribute("data-kind") === "found";
          oldDoor.parentNode.replaceChild(door, oldDoor);
          oldDetail.parentNode.replaceChild(detail, oldDetail);
          if (wasOpen) detail.classList.add("is-open");
          dress(door);
          if (!wasFound && door.getAttribute("data-kind") === "found") door.classList.add("is-opening");
          applyMarks(n);
        });
    }

    function poll() {
      if (stopped || doc.hidden || !feedUrl) return Promise.resolve();
      return win
        .fetch(feedUrl)
        .then(function (res) {
          if (!res.ok) throw new Error("no feed");
          return res.json();
        })
        .then(function (feed) {
          failures = 0;
          if (feed.now) setSkew(feed.now);
          setTally(feed.found);
          setStatus(feed.status);
          var changed = [];
          var list = feed.doors || [];
          for (var i = 0; i < list.length; i++) {
            var door = doorOf(list[i].door);
            if (door && door.getAttribute("data-v") !== list[i].v) changed.push(list[i].door);
          }
          // One at a time: the site is small, and a day's worth of changes is a handful of doors.
          return changed.reduce(function (chain, n) {
            return chain.then(function () {
              return refresh(n);
            });
          }, Promise.resolve());
        })
        .catch(function () {
          // No news is not an error anyone needs to see. Try again later, a little less often.
          failures += 1;
        });
    }

    function busy() {
      if (board.querySelector('.elf-door[data-kind="hunting"]')) return true;
      var list = doc.querySelectorAll(".elf-cd[data-until]");
      for (var i = 0; i < list.length; i++) {
        var left = Date.parse(list[i].getAttribute("data-until")) - now();
        if (left < SOON_MS && left > -SOON_MS) return true;
      }
      return false;
    }

    function loop() {
      if (stopped) return;
      var wait = Math.min(POLL_MAX_MS, (busy() ? POLL_BUSY_MS : POLL_MS) * Math.pow(2, Math.min(failures, 3)));
      pollTimer = win.setTimeout(function () {
        poll().then(loop, loop);
      }, wait);
    }

    function stop() {
      stopped = true;
      if (ticker) win.clearInterval(ticker);
      if (pollTimer) win.clearTimeout(pollTimer);
    }

    // ---- start ---------------------------------------------------------------------------

    board.classList.add("is-live");
    setSkew(board.getAttribute("data-now"));
    var asked = /^#case-(\d+)$/.exec(win.location.hash || "");
    if (asked && detailOf(asked[1])) detailOf(asked[1]).classList.add("is-open");
    eachDoor(dress);
    tick();
    ticker = win.setInterval(tick, 1000);
    doc.addEventListener("visibilitychange", function () {
      if (!doc.hidden) poll();
    });
    loop();

    return { tick: tick, poll: poll, ready: loadMarks(), stop: stop };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { initCalendar: initCalendar, countdownWords: countdownWords };
  } else {
    initCalendar(document, window);
  }
})();
