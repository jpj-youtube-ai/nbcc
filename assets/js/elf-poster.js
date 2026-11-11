/* NBCC Elf Detective School: the page a poster's QR code opens.
 *
 * The page (src/elf/pages/poster.ts) already works with no script: its forms post to the server like
 * any form. This makes three things nicer:
 *
 *   1. The word on the elf's tag is sent without leaving the page, and the card that comes back (the
 *      gold "You're first!" card, or the candy cane card of a visit) is shown at once, with a clock
 *      that ticks on the gold one, so the staff can tell the card from a picture of one.
 *   2. After a visit, the photo sheet works: the chosen picture is shown, made smaller in the browser
 *      (at most 1600 pixels on its longest side, a fresh JPEG under 2 MB, as the fundraisers' pictures
 *      are), and sent for a head elf to look at. The family's own photo can be taken down again.
 *   3. When the answer is no, the page says why.
 *
 * Nothing here decides anything. The server says who was first and whether a visit counts, and it
 * writes the words and the cards too: this only shows them. A card arrives as the server's own markup,
 * drawn by the same code that draws the page; a refusal arrives as words and is shown as words.
 *
 * Tested in test/unit/elf-js-poster.test.ts against the real page.
 */
(function () {
  "use strict";

  var NO_SIGNAL = "We could not reach NBCC. Check your signal and try again.";
  var PROBLEM = "Something went wrong. Refresh the page and try again.";
  var PHOTO_TYPE = "That picture is not one we can use. Try a JPG, PNG or WebP photo.";
  var PHOTO_SIZE = "That picture is too big. Try a smaller one.";
  var PHOTO_READ = "That photo could not be opened. Please try another.";
  var WAITING = "Thank you! A head elf will look at your photo soon.";
  var TAKEN_DOWN = "Your photo has been taken down.";

  var TYPES = ["image/jpeg", "image/png", "image/webp"];
  var MAX_BYTES = 2 * 1024 * 1024;
  var MAX_PX = 1600;
  var QUALITY = 0.86;

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

  // --- reading and making pictures, in a real browser ----------------------------------------------
  // Copied from assets/js/fundraise-pictures.js (browserRead and browserMake), keeping its limits.

  // Reads a chosen file into a picture the page can show: { src, width, height, img }, or null.
  function browserRead(win) {
    return function (file) {
      return new Promise(function (done) {
        var URLs = win.URL;
        if (!URLs || !URLs.createObjectURL || typeof win.Image !== "function") return done(null);
        var src = URLs.createObjectURL(file);
        var img = new win.Image();
        img.onload = function () {
          done({ src: src, width: img.naturalWidth, height: img.naturalHeight, img: img });
        };
        img.onerror = function () {
          done(null);
        };
        img.src = src;
      });
    };
  }

  // Draws the picture again on a canvas, the whole of it made smaller if it is big: a fresh JPEG, so
  // nothing from the camera goes with it.
  function browserMake(doc) {
    return function (pic) {
      return new Promise(function (done) {
        try {
          var canvas = doc.createElement("canvas");
          if (!canvas.getContext || !pic || !pic.img) return done(null);
          var scale = Math.min(1, MAX_PX / Math.max(pic.width, pic.height));
          canvas.width = Math.max(1, Math.round(pic.width * scale));
          canvas.height = Math.max(1, Math.round(pic.height * scale));
          var ctx = canvas.getContext("2d");
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(pic.img, 0, 0, canvas.width, canvas.height);
          var url = canvas.toDataURL("image/jpeg", QUALITY);
          var comma = url.indexOf(",");
          if (comma === -1 || url.indexOf("data:image/jpeg") !== 0) return done(null);
          done({ mime: "image/jpeg", base64: url.slice(comma + 1) });
        } catch (e) {
          done(null);
        }
      });
    };
  }

  function base64Bytes(b64) {
    var pad = /==$/.test(b64) ? 2 : /=$/.test(b64) ? 1 : 0;
    return Math.floor((b64.length * 3) / 4) - pad;
  }

  /** A file as it is, in base64, for a phone that cannot draw the picture again. */
  function rawBase64(win, file) {
    return new Promise(function (done) {
      if (typeof win.FileReader !== "function") return done(null);
      var reader = new win.FileReader();
      reader.onload = function () {
        var url = String(reader.result || "");
        var comma = url.indexOf(",");
        done(comma === -1 ? null : url.slice(comma + 1));
      };
      reader.onerror = function () {
        done(null);
      };
      reader.readAsDataURL(file);
    });
  }

  function initPoster(doc, win, opts) {
    var clock = opts && opts.now ? opts.now : function () { return Date.now(); };
    var read = (opts && opts.read) || browserRead(win);
    var make = (opts && opts.make) || browserMake(doc);
    var result = doc.getElementById("elf-result");
    var claim = doc.querySelector("form.elf-word");
    var busy = false;
    var ticker = null;
    // With no fetch the forms are left alone, and post like any form.
    var canSend = typeof win.fetch === "function";

    // ---- small helpers ---------------------------------------------------------------------

    function say(form, words, isError) {
      var status = form.querySelector(".elf-form-status");
      if (!status) return;
      status.textContent = words;
      if (isError) status.classList.add("is-error");
      else status.classList.remove("is-error");
    }

    function chosen(form) {
      var boxes = form.querySelectorAll('input[name="detective"]');
      var ids = [];
      for (var i = 0; i < boxes.length; i++) {
        if (boxes[i].checked) ids.push(boxes[i].value);
      }
      return ids;
    }

    function cardOf(form) {
      var el = form;
      while (el && el !== doc.body) {
        if (el.classList && el.classList.contains("elf-case")) return el;
        el = el.parentNode;
      }
      return form;
    }

    function json(payload) {
      return { headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) };
    }

    /** What a server answer says in words: its message (a refusal) or its error, or a plain problem. */
    function wordsOf(body) {
      if (body && typeof body.message === "string" && body.message) return body.message;
      if (body && typeof body.error === "string" && body.error) return body.error;
      return PROBLEM;
    }

    /** Sends a request and gives back { ok, status, body } however it went; never rejects. */
    function request(url, init) {
      init.credentials = "same-origin";
      return win
        .fetch(url, init)
        .then(function (res) {
          return res
            .json()
            .catch(function () {
              return null;
            })
            .then(function (body) {
              return { ok: res.ok, status: res.status, body: body && typeof body === "object" ? body : {} };
            });
        })
        .catch(function () {
          return { ok: false, status: 0, body: { error: NO_SIGNAL } };
        });
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

    // ---- the poster's code, and where its photo goes ----------------------------------------------

    function photoUrl() {
      var input = doc.querySelector('form.elf-word input[name="code"]');
      var code = input ? input.value : "";
      if (!code) {
        var sheet = doc.querySelector(".elf-photo-sheet__form[data-api]");
        var found = sheet ? /\/api\/elf\/p\/([^/]+)\/photo/.exec(sheet.getAttribute("data-api")) : null;
        if (found) return found[0];
      }
      if (!code) {
        var path = /\/p\/([^/?#]+)/.exec((win.location && win.location.pathname) || "");
        code = path ? decodeURIComponent(path[1]) : "";
      }
      return "/api/elf/p/" + encodeURIComponent(code) + "/photo";
    }

    // ---- the photo sheet --------------------------------------------------------------------------

    function wireSheet(form) {
      if (form.getAttribute("data-wired")) return;
      form.setAttribute("data-wired", "1");
      var input = form.querySelector('input[type="file"]');
      var consent = form.querySelector('input[name="consent"]');
      var send = form.querySelector('button[type="submit"]');
      var preview = form.querySelector(".elf-photo-sheet__preview");
      var sending = false;
      var picture = null;
      var picturing = Promise.resolve();

      // Send it to the head elves waits for the tick, and for any send still on its way.
      function sync() {
        if (send) send.disabled = sending || !(consent && consent.checked);
      }
      sync();
      if (consent) consent.addEventListener("change", sync);

      if (input) {
        input.addEventListener("change", function () {
          var file = input.files && input.files.length ? input.files[0] : null;
          picture = null;
          if (!file) {
            if (preview) preview.hidden = true;
            return;
          }
          picturing = read(file).then(function (pic) {
            picture = pic;
            var shot = preview ? preview.querySelector(".elf-pol__shot") : null;
            if (shot) {
              shot.textContent = "";
              if (pic && pic.src) {
                var img = doc.createElement("img");
                img.src = pic.src;
                img.alt = "";
                shot.appendChild(img);
              }
            }
          });
          if (preview) preview.hidden = false;
        });
      }

      // The picture to send: drawn again smaller if the browser can, the file as it came if it cannot.
      function prepare(file) {
        return picturing.then(function () {
          var made = picture ? make(picture) : Promise.resolve(null);
          return made.then(function (small) {
            if (small && small.base64) return small;
            if (TYPES.indexOf(file.type) === -1) return { error: PHOTO_TYPE };
            if (file.size > MAX_BYTES) return { error: PHOTO_SIZE };
            return rawBase64(win, file).then(function (b64) {
              return b64 ? { mime: file.type, base64: b64 } : { error: PHOTO_READ };
            });
          });
        });
      }

      function thanks() {
        var sheet = form.closest ? form.closest(".elf-photo-sheet") : null;
        if (!sheet) return;
        sheet.textContent = "";
        var p = doc.createElement("p");
        p.className = "elf-photo-sheet__thanks";
        p.setAttribute("role", "status");
        p.textContent = WAITING;
        var actions = doc.createElement("p");
        var down = doc.createElement("button");
        down.type = "button";
        down.className = "elf-btn elf-btn--s elf-photo-down";
        down.textContent = "Take it down";
        actions.appendChild(down);
        sheet.appendChild(p);
        sheet.appendChild(actions);
      }

      form.addEventListener("submit", function (event) {
        event.preventDefault();
        if (sending) return;
        var file = input && input.files && input.files.length ? input.files[0] : null;
        if (!file) return say(form, "Choose a photo first.", true);
        if (!(consent && consent.checked)) return say(form, "Tick the box to say we can show this photo.", true);
        sending = true;
        sync();
        say(form, "Sending your photo", false);
        prepare(file)
          .then(function (made) {
            if (made.error) return { words: made.error };
            if (base64Bytes(made.base64) > MAX_BYTES) return { words: PHOTO_SIZE };
            return request(form.getAttribute("data-api") || photoUrl(), Object.assign({ method: "POST" }, json({ mime: made.mime, dataBase64: made.base64, consent: true }))).then(function (res) {
              return res.status === 202 ? { sent: true } : { words: wordsOf(res.body) };
            });
          })
          .then(function (done) {
            sending = false;
            if (done.sent) return thanks();
            sync();
            say(form, done.words, true);
          });
      });
    }

    function wireSheets() {
      if (!canSend) return;
      var forms = doc.querySelectorAll(".elf-photo-sheet__form");
      for (var i = 0; i < forms.length; i++) wireSheet(forms[i]);
    }

    // Take it down, from the card for the family's photo or from the waiting words after sending.
    function takeDown(button) {
      if (button.disabled) return;
      var holder = button.closest(".elf-your-photo, .elf-photo-sheet") || button.parentNode;
      button.disabled = true;
      request(photoUrl(), { method: "DELETE" }).then(function (res) {
        if (res.ok && res.body.ok === true) {
          var said = holder.querySelector(".elf-your-photo__said, .elf-photo-sheet__thanks");
          if (said) {
            said.textContent = TAKEN_DOWN;
            said.classList.remove("is-ok", "is-error");
          } else {
            var p = doc.createElement("p");
            p.setAttribute("role", "status");
            p.textContent = TAKEN_DOWN;
            holder.insertBefore(p, holder.firstChild);
          }
          var oops = holder.querySelector(".elf-photo-down-status");
          if (oops) oops.parentNode.removeChild(oops);
          var row = button.parentNode;
          row.parentNode.removeChild(row);
          return;
        }
        button.disabled = false;
        var status = holder.querySelector(".elf-photo-down-status");
        if (!status) {
          status = doc.createElement("p");
          status.className = "elf-form-status elf-photo-down-status";
          status.setAttribute("role", "status");
          holder.appendChild(status);
        }
        status.textContent = wordsOf(res.body);
        status.classList.add("is-error");
      });
    }

    var onClick = function (event) {
        var target = event.target && event.target.closest ? event.target : null;
        if (!target) return;
        var down = target.closest(".elf-your-photo__down, .elf-photo-down");
        if (down) {
          event.preventDefault();
          takeDown(down);
          return;
        }
        // Not this time puts the sheet away, and stays on the page.
        var skip = target.closest(".elf-photo-sheet__skip");
        if (skip) {
          event.preventDefault();
          var sheet = skip.closest(".elf-photo-sheet");
          if (sheet) sheet.hidden = true;
        }
    };
    if (canSend) doc.addEventListener("click", onClick);

    // ---- sending the word, and showing the answer ----------------------------------------------

    function show(html, form) {
      if (!result) return;
      // The server's own card, drawn by src/elf/pages/poster.ts, which makes everything in it safe.
      result.innerHTML = html;
      cardOf(form).hidden = true;
      var later = doc.querySelector(".elf-poster__later");
      if (later) later.hidden = true;
      result.focus();
      if (result.scrollIntoView) result.scrollIntoView({ block: "start" });
      tick();
      wireSheets();
    }

    function hold(form, on) {
      busy = on;
      var buttons = form.querySelectorAll("button");
      for (var i = 0; i < buttons.length; i++) buttons[i].disabled = on;
    }

    if (claim && canSend) {
      claim.addEventListener("submit", function (event) {
        event.preventDefault();
        // A second tap while the first is on its way sends nothing.
        if (busy) return;
        var who = chosen(claim);
        var word = claim.querySelector('input[name="word"]');
        var typed = word ? word.value : "";
        var code = claim.querySelector('input[name="code"]');
        if (!who.length) return say(claim, "Tick who is here.", true);
        if (!typed.replace(/\s/g, "")) return say(claim, "Type the secret word on the elf's tag.", true);
        say(claim, "", false);
        hold(claim, true);
        request(claim.getAttribute("data-api"), Object.assign({ method: "POST" }, json({ code: code ? code.value : "", detectiveIds: who, word: typed }))).then(function (res) {
          hold(claim, false);
          if (res.ok && typeof res.body.html === "string" && res.body.html) show(res.body.html, claim);
          else say(claim, wordsOf(res.body), true);
        });
      });
    }

    // A card the server drew into the page (a form posted before this script ran) gets its clock, and
    // a photo sheet in the page works.
    tick();
    wireSheets();

    return {
      tick: tick,
      stop: function () {
        if (ticker) win.clearInterval(ticker);
        ticker = null;
        doc.removeEventListener("click", onClick);
      }
    };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { initPoster: initPoster };
  } else {
    initPoster(document, window);
  }
})();
