/* NBCC Elf Detective School: the public calendar comes alive.
 *
 * The calendar page (src/elf/pages/calendar.ts) already works with no script: every door is a link
 * to its own detail. This only makes it nicer, in seven ways:
 *
 *   1. A tap opens a door's detail in place, under the door's own row, and a second tap shuts it.
 *   2. Countdowns tick, by the SERVER's clock: a phone with the wrong time still counts down right.
 *   3. Every few seconds it asks a small feed whether any door has changed, and fetches only the
 *      doors that have. The server draws them, with the same code that drew the page, so this file
 *      never builds a door itself and the two can never show a door differently.
 *   4. For a family that is signed in, it lays their own marks over the board, and marks the
 *      family's own photo in an open door's scrapbook, with a button to take it down.
 *   5. "Close door n" in a scrapbook shuts it and puts focus back on the door.
 *   6. An elf on a door that could not be drawn just now (the server was busy) is asked for again.
 *   7. While December's doors are on, the calendar everyone shares names no place before Christmas
 *      Day, so a door whose place the family can see is drawn from the family's own private answer,
 *      with its place and photos; a door it may still have a go at keeps the Have a go line.
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
    // Where a family's own doors are, one or all at once: on the board only while December's doors are on.
    var meDoorApi = board.getAttribute("data-me-door");
    var meDoorsUrl = board.getAttribute("data-me-doors");
    // From Christmas Day until 1 January the calendar everyone shares carries every place and photo itself.
    var placesFrom = Date.parse(board.getAttribute("data-places-from") || "");
    var placesUntil = Date.parse(board.getAttribute("data-places-until") || "");
    var skew = 0;
    var marks = {};
    // The family's own photo at each door: its token.
    var photos = {};
    var signedIn = false;
    // The doors whose place the family can see, from its answer while December's doors are on (null before it
    // answers, and always with the doors off), and the doors it may still have a go at.
    var known = null;
    var goes = [];
    // Each door the family can see that its own answer has not drawn yet, or that is opening while that answer
    // cannot be read: when it was first missed.
    var owed = {};
    // Settles once the family's answer has been taken in and its own doors drawn (loadMarks); polls draw after it,
    // or after READY_WAIT_MS if it hangs (settled).
    var ready = Promise.resolve();
    var settled = Promise.resolve();
    var READY_WAIT_MS = 10000;
    // How many of the family's answers have been taken in, so a return to the page can tell whether a poll has just
    // read one; and whether the page has been hidden since it was last shown.
    var reads = 0;
    var away = false;
    var failures = 0;
    var stopped = false;
    var ticker = null;
    var pollTimer = null;

    // The newest time the server has given. The browser may keep a copy of the feed for 15 seconds, and a
    // kept copy repeats an older time: setting the clock from it again would make every countdown jump
    // back, so only a newer time moves the clock.
    var serverTime = -Infinity;
    function setSkew(iso) {
      var t = Date.parse(iso);
      if (isNaN(t) || t <= serverTime) return;
      serverTime = t;
      skew = t - clock();
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

    // An open door can be visited any day in December, as the calendar's steps say. A door whose elf has
    // gone home has nothing left to find, as its scrapbook says, so its line never invites a visit: it
    // says only what the family collected there, and nothing at all when that is nothing.
    function mineWords(mark, goneHome) {
      if (mark.cracked && mark.visited) return "Your family cracked this case and has been there. Both marks collected.";
      if (mark.visited) return "Your family has been there. Candy cane collected.";
      if (goneHome) return mark.cracked ? "Your family cracked this case." : "";
      if (mark.cracked) return "Your family cracked this case. Visit any day in December for your candy cane too.";
      return "Not done yet. Visit any day in December for your candy cane.";
    }

    function applyMarks(n) {
      if (!signedIn) return;
      var door = doorOf(n);
      var detail = detailOf(n);
      if (!door || !detail) return;
      applyPhoto(n);
      var mark = marks[n] || { cracked: false, visited: false, snow: false };
      // A door the family has done, cracked or visited, wears the painted holly. So does a snow day,
      // which counts as done for every detective.
      door.classList.toggle("is-done", mark.cracked || mark.visited || mark.snow);
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
        var hint = detail.querySelector(".elf-detail__hint");
        // A door the family may still have a go at keeps the calendar's Have a go line, which is its hint: the
        // family cannot know the place, so a line of its own would only invite a visit there.
        if (goes.indexOf(Number(n)) !== -1) {
          mine.textContent = "";
          mine.hidden = true;
          if (hint) hint.hidden = false;
          return;
        }
        var said = mineWords(mark, !!detail.querySelector(".elf-book__gone"));
        mine.textContent = said;
        mine.hidden = said === "";
        // The family's own line says what is left to do, so the general hint would only repeat it.
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
      function note(words, isError) {
        var status = figure.querySelector(".elf-form-status");
        if (!status) {
          status = doc.createElement("p");
          status.className = "elf-form-status";
          status.setAttribute("role", "status");
          figure.appendChild(status);
        }
        status.textContent = words;
        if (isError) status.classList.add("is-error");
        else status.classList.remove("is-error");
      }
      // The photo is down once the server says so. If the door cannot be drawn again just now, the
      // page says so and leaves the door as it is; the next news from the feed will redraw it.
      function downButStillShown() {
        if (!doc.contains(figure)) return;
        if (button.parentNode) button.parentNode.removeChild(button);
        note("Your photo has been taken down.", false);
      }
      win
        .fetch(doorApi + door + "/photo", { method: "DELETE", credentials: "same-origin" })
        .then(
          function (res) {
            if (!res.ok) throw new Error("not taken down");
            delete photos[door];
            return redrawOne(door).then(downButStillShown, downButStillShown);
          },
          function () {
            throw new Error("not taken down");
          }
        )
        .catch(function () {
          button.disabled = false;
          note("We could not take your photo down just now. Please try again.", true);
        });
    }

    board.addEventListener("click", function (event) {
      var button = event.target && event.target.closest ? event.target.closest(".elf-photo-down") : null;
      if (!button || !board.contains(button)) return;
      event.preventDefault();
      event.stopPropagation();
      takeDown(button);
    });

    // ---- a door elf that could not be drawn just now ---------------------------------------

    // The server draws the elves on the doors one at a time, and says it is busy (503) when too many are
    // waiting. An elf picture that fails is asked for again a little later, twice at most. A photo is
    // never asked for again: it is there, or it is not.
    var ELF_PICTURE = /^\/elf\/door\/\d+\/elf\/\d+\.png$/;
    var AGAIN_MS = [2000, 5000];
    board.addEventListener(
      "error",
      function (event) {
        var img = event.target;
        if (!img || img.tagName !== "IMG") return;
        var src = String(img.getAttribute("src") || "").split("?")[0];
        var tries = Number(img.getAttribute("data-tries") || "0");
        if (!ELF_PICTURE.test(src) || !(tries < AGAIN_MS.length)) return;
        img.setAttribute("data-tries", String(tries + 1));
        win.setTimeout(function () {
          // A door drawn again since has pictures of its own.
          if (doc.contains(img)) img.setAttribute("src", src + "?try=" + (tries + 1));
        }, AGAIN_MS[tries]);
      },
      true
    );

    // The family's private answer, or null when it is not signed in or there is no answer.
    function readMe() {
      return win.fetch(meUrl, { credentials: "same-origin" }).then(function (res) {
        return res.status === 200 ? res.json() : null;
      });
    }

    // Door numbers from an answer, each once.
    function doorNumbers(list) {
      var out = [];
      for (var i = 0; i < list.length; i++) {
        var n = Number(list[i]);
        if (isFinite(n) && out.indexOf(n) === -1) out.push(n);
      }
      return out;
    }

    // Take in the family's answer: its marks, its own photos and, while December's doors are on, the doors whose
    // place it can see and the doors it may still have a go at. Answers whether there was one.
    function takeMe(body) {
      if (!body || !body.doors) return false;
      // Signed in, even with no marks yet: every open door then says what is left to do.
      signedIn = true;
      var mine = body.photos || [];
      for (var p = 0; p < mine.length; p++) {
        if (mine[p] && typeof mine[p].token === "string") photos[mine[p].door] = mine[p].token;
      }
      for (var i = 0; i < body.doors.length; i++) {
        marks[body.doors[i].door] = {
          cracked: body.doors[i].cracked === true,
          visited: body.doors[i].visited === true,
          snow: body.doors[i].snow === true
        };
      }
      // Only on a calendar drawn with December's doors on: drawn with them off, the page stays exactly as it was.
      known = meDoorApi && Array.isArray(body.known) ? doorNumbers(body.known) : null;
      goes = meDoorApi && Array.isArray(body.goes) ? doorNumbers(body.goes) : [];
      reads += 1;
      return true;
    }

    function loadMarks() {
      if (!meUrl) return Promise.resolve();
      return readMe()
        .then(function (body) {
          if (!takeMe(body)) return;
          eachDoor(function (door) {
            applyMarks(door.getAttribute("data-door"));
          });
          return loadMine();
        })
        .catch(function () {
          // Not signed in, or no answer: the board stays as it was served.
        });
    }

    // ---- a family's own places (Plan 2c-1) -----------------------------------------------------
    //
    // While December's doors are on, the calendar everyone shares names no place before Christmas Day. A door
    // whose place the family can see is drawn from the family's own answer instead, drawn by the server with the
    // same code: its place, its photos, and no Have a go. It keeps the shared calendar's fingerprint, so the feed
    // is still compared with the shared calendar. One door comes from its own route, more than one from the one
    // answer holding them all, never a request a door. From Christmas Day until 1 January the shared calendar
    // carries every place and photo itself, so nothing of the family's own is asked for then.

    // A door the family's own answer has not drawn is asked for again on each poll for up to a minute: the
    // calendar everyone shares is never more than 15 seconds old, so the family's door is never far behind it.
    var GIVE_UP_MS = 60 * 1000;

    function placesForEveryone() {
      var t = now();
      return placesFrom <= t && t < placesUntil;
    }

    // Are the family's own doors drawn from its own answers just now?
    function mineOn() {
      return !!meDoorApi && !!meDoorsUrl && known !== null && !placesForEveryone();
    }

    function isKnown(n) {
      return known !== null && known.indexOf(Number(n)) !== -1;
    }

    // Draw these doors from the family's own answer. `newer` holds the feed's newer fingerprint for a door it says
    // has changed; any other door keeps the one it has. Answers the doors it did not draw: an answer that fails,
    // or that has not got a door yet, leaves that door as it is, and nothing is said.
    function drawMine(doors, newer) {
      if (doors.length === 0) return Promise.resolve([]);
      var one = doors.length === 1;
      return win
        .fetch(one ? meDoorApi + doors[0] : meDoorsUrl, { credentials: "same-origin" })
        .then(function (res) {
          return res.status === 200 ? res.json() : null;
        })
        .then(
          function (body) {
            var drawn = {};
            var items = one ? (body ? [{ door: doors[0], tile: body.tile, detail: body.detail }] : []) : body && Array.isArray(body.doors) ? body.doors : [];
            for (var i = 0; i < items.length; i++) {
              var n = Number(items[i] && items[i].door);
              if (doors.indexOf(n) === -1 || drawn[n]) continue;
              var was = doorOf(n);
              if (put(n, parsed(items[i]), newer[n] || (was ? was.getAttribute("data-v") : null))) {
                drawn[n] = true;
                delete owed[n];
              }
            }
            return doors.filter(function (d) {
              return !drawn[d];
            });
          },
          function () {
            return doors.slice();
          }
        );
    }

    // Is door n, missed again at `t`, still worth asking for? Its first miss starts its minute; once the minute is
    // up it is owed no more.
    function stillOwed(n, t) {
      if (owed[n] === undefined) owed[n] = t;
      if (t - owed[n] < GIVE_UP_MS) return true;
      delete owed[n];
      return false;
    }

    // The doors the family's own answer did not draw are owed, and asked for again on the next poll. After a
    // minute a door is given up on: a door the feed says has changed is then drawn as the calendar everyone
    // shares draws it, and either way it is not asked for again until it changes again.
    function missed(doors, changed) {
      // A miss that lands once the family's own doors are no longer drawn (Christmas Day began while it was being
      // asked for) is owed nothing, as nothing is owed then (redraw).
      if (!mineOn()) return Promise.resolve();
      var t = now();
      var chain = Promise.resolve();
      doors.forEach(function (n) {
        if (stillOwed(n, t)) return;
        if (changed.indexOf(n) !== -1) {
          chain = chain.then(function () {
            return refresh(n);
          });
        }
      });
      return chain;
    }

    // As the page loads: every door the family can see, from its own answer.
    function loadMine() {
      if (!mineOn() || known.length === 0) return Promise.resolve();
      return drawMine(known.slice(), {}).then(function (left) {
        return missed(left, []);
      });
    }

    // Is a door of this kind standing open, its place shown? As isOpenKind in src/elf/pages/door.ts.
    function openKind(kind) {
      return kind === "found" || kind === "revealed";
    }

    // Does door n open with this fresh drawing: from a kind with no place shown to found or revealed?
    function opens(n, got) {
      var was = doorOf(n);
      return !!was && !!got && !openKind(was.getAttribute("data-kind")) && openKind(got.door.getAttribute("data-kind"));
    }

    // Doors the family cannot see that are opening now: tonight's door at its shown moment. A family that guessed can
    // see its place from now on, so the family's answer is read again, once a poll (ruling F5, narrowed to a door
    // turning open). Each door is then drawn from the family's own answer if it can see the place (it joins `mine`),
    // else from the shared drawing already fetched. If the answer cannot be read just now, each is left exactly as
    // it was, keeping its fingerprint, so the next poll sees it opening and asks again, for up to a minute; after
    // that it is drawn as the calendar everyone shares draws it.
    function opened(held, mine) {
      if (held.length === 0) return Promise.resolve();
      var before = known ? known.slice() : [];
      return readMe()
        .catch(function () {
          return null;
        })
        .then(function (body) {
          var read = takeMe(body);
          if (read) {
            eachDoor(function (door) {
              applyMarks(door.getAttribute("data-door"));
            });
          }
          // Every door the family has come to know since its last read is drawn from its own answer too, not only the
          // opening ones: a door cracked in Detective HQ, say, which everyone else still sees unchanged. So this read
          // does a return's work as well (backAgain), and nothing the family can now see is left to a reload.
          if (read && mineOn()) {
            for (var k = 0; k < known.length; k++) {
              if (before.indexOf(known[k]) === -1 && mine.indexOf(known[k]) === -1) mine.push(known[k]);
            }
          }
          var t = now();
          held.forEach(function (h) {
            if (read && mineOn() && isKnown(h.n)) {
              if (mine.indexOf(h.n) === -1) mine.push(h.n);
              return;
            }
            if (!read && stillOwed(h.n, t)) return;
            delete owed[h.n];
            put(h.n, h.got, null);
          });
        });
    }

    // Draw again the doors the feed says have changed: a door the family can see from the family's own answer,
    // together with any it still owes; every other door from the calendar everyone shares, one at a time, as
    // the site is small and a day's worth of changes is a handful of doors. A shared door that turns open is held
    // back until the family's answer has been read again (opened).
    function redraw(changed, newer) {
      var mine = [];
      if (mineOn()) {
        for (var i = 0; i < known.length; i++) {
          if (changed.indexOf(known[i]) !== -1 || owed[known[i]] !== undefined) mine.push(known[i]);
        }
      } else {
        // Nothing is owed while the family's own doors are not drawn (from Christmas Day, or with the doors off),
        // so a door owed before then gets its whole minute when they are drawn again.
        owed = {};
      }
      var shared = changed.filter(function (n) {
        return mine.indexOf(n) === -1;
      });
      var held = [];
      return shared
        .reduce(function (chain, n) {
          return chain.then(function () {
            return fetchShared(n).then(function (fresh) {
              // A door the family came to know while this drawing was on its way (its answer landing late, say) is
              // drawn from the family's own answer instead, with the feed's fingerprint (drawMine below).
              if (mineOn() && isKnown(n)) {
                if (mine.indexOf(n) === -1) mine.push(n);
                return;
              }
              var got = parsed(fresh);
              if (mineOn() && opens(n, got)) held.push({ n: n, got: got });
              else put(n, got, null);
            });
          });
        }, Promise.resolve())
        .then(function () {
          return opened(held, mine);
        })
        .then(function () {
          return drawMine(mine, newer);
        })
        .then(function (left) {
          return missed(left, changed);
        });
    }

    // Draw one door again: a door the family can see from its own answer, any other from the shared calendar.
    function redrawOne(n) {
      return mineOn() && isKnown(n) ? drawMine([Number(n)], {}) : refresh(n);
    }

    // Back on the page after being away: the family may have been to a place, or had a go, meanwhile (on its phone,
    // say, while this tab waited). Its answer is read again, the marks laid on afresh, and each door it can now see
    // that it could not before is drawn from its own answer. Only while its own doors are drawn: never with
    // December's doors off, nor from Christmas Day until 1 January.
    function backAgain() {
      if (stopped || !mineOn()) return Promise.resolve();
      var before = known.slice();
      return readMe()
        .catch(function () {
          return null;
        })
        .then(function (body) {
          if (!takeMe(body)) return undefined;
          eachDoor(function (door) {
            applyMarks(door.getAttribute("data-door"));
          });
          if (!mineOn()) return undefined;
          var newly = known.filter(function (n) {
            return before.indexOf(n) === -1;
          });
          return drawMine(newly, {}).then(function (left) {
            return missed(left, []);
          });
        })
        .catch(function () {
          // An answer that cannot be taken in just now: the board stays as it is, and nothing is said.
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

    // A door the server drew, { tile, detail } as HTML made by the code that drew the page, read into its door and
    // its detail; null when it is not one.
    function parsed(fresh) {
      if (!fresh || typeof fresh.tile !== "string" || typeof fresh.detail !== "string") return null;
      var box = doc.createElement("template");
      box.innerHTML = fresh.tile + fresh.detail;
      var door = box.content.querySelector(".elf-door");
      var detail = box.content.querySelector(".elf-detail");
      return door && detail ? { door: door, detail: detail } : null;
    }

    // Put a door the server drew (parsed) in place of the one on the page. `v`, when given, is the fingerprint the
    // door keeps: the shared calendar's, for a door drawn from the family's own answer. Answers whether it was put.
    function put(n, got, v) {
      var oldDoor = doorOf(n);
      var oldDetail = detailOf(n);
      if (!got || !oldDoor || !oldDetail) return false;
      var door = got.door;
      var detail = got.detail;
      if (v) door.setAttribute("data-v", v);
      var wasOpen = oldDetail.classList.contains("is-open");
      var wasFound = oldDoor.getAttribute("data-kind") === "found";
      oldDoor.parentNode.replaceChild(door, oldDoor);
      oldDetail.parentNode.replaceChild(detail, oldDetail);
      if (wasOpen) detail.classList.add("is-open");
      dress(door);
      if (!wasFound && door.getAttribute("data-kind") === "found") door.classList.add("is-opening");
      applyMarks(n);
      return true;
    }

    // One door as the calendar everyone shares draws it, or null.
    function fetchShared(n) {
      return win.fetch(doorApi + n).then(function (res) {
        return res.ok ? res.json() : null;
      });
    }

    // Draw one door again, as the calendar everyone shares draws it.
    function refresh(n) {
      return fetchShared(n).then(function (fresh) {
        put(n, parsed(fresh), null);
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
          // While December's doors are on, no door is drawn until the family's answer is in: a poll begun as the page
          // loads could otherwise put a shared door over one just drawn from the family's own answer. With them off
          // there is no family's door to keep, and a poll draws at once, as it always has.
          return (meDoorApi ? settled : Promise.resolve()).then(function () {
            var changed = [];
            var newer = {};
            var list = feed.doors || [];
            for (var i = 0; i < list.length; i++) {
              var door = doorOf(list[i].door);
              if (door && door.getAttribute("data-v") !== list[i].v) {
                changed.push(Number(list[i].door));
                newer[list[i].door] = list[i].v;
              }
            }
            return redraw(changed, newer);
          });
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
    // Shown again: news at once, as always. Back after being hidden, the family's answer is then read again once for
    // this return (backAgain), unless that poll has just read it as tonight's door opened.
    doc.addEventListener("visibilitychange", function () {
      if (doc.hidden) {
        away = true;
        return;
      }
      var back = away;
      away = false;
      var seen = reads;
      var polled = poll();
      if (back) {
        polled.then(function () {
          return reads === seen ? backAgain() : undefined;
        });
      }
    });
    loop();

    // Set before any poll's answer can come back, so every poll draws after the family's answer is in. If that answer
    // hangs, polls stop waiting for it 10 seconds after the page starts: the doors are drawn as the calendar everyone
    // shares draws them, and the family's own land when its answer comes.
    ready = loadMarks();
    if (meDoorApi) {
      settled = new Promise(function (resolve) {
        var late = win.setTimeout(resolve, READY_WAIT_MS);
        ready.then(function () {
          win.clearTimeout(late);
          resolve();
        });
      });
    }
    return { tick: tick, poll: poll, ready: ready, stop: stop };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { initCalendar: initCalendar, countdownWords: countdownWords };
  } else {
    initCalendar(document, window);
  }
})();
