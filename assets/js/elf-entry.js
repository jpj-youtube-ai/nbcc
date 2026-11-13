/* NBCC Elf Detective School: the page where a family sends in a graduate's picture for the grand prize.
 *
 * The page (src/elf/pages/entry.ts) draws the form. Sending it needs this script, as a door's photo does: the
 * chosen picture is made smaller in the browser (at most 1600 pixels on its longest side, a fresh JPEG under
 * 2 MB, as the photo sheet makes a photo), sent as JSON { mime, dataBase64 } with the mobile number when the
 * page asks for one, and the server's answer is shown in the form's status line: its thank you, or why not.
 * The button stays off while a picture is on its way. While the picture maker is busy (a 503, when too many
 * pictures are arriving at once, as in the rush before the entries close) the same picture is sent again by
 * itself, still "Sending your picture": five sends in all, each 2 to 3 seconds after the busy answer, and only
 * then the busy words. The server gives back the try a busy answer took. Once a picture is in, the page shows
 * it as the server draws it then, with no reload: the picture, fetched fresh from its own address, and the
 * button that sends a new one.
 *
 * Nothing here decides anything. The server says whether the picture is taken, makes it again so nothing from
 * the camera is kept, and writes the words: this only shows them.
 *
 * Tested in test/unit/elf-js-entry.test.ts against the real page.
 */
(function () {
  "use strict";

  var NO_SIGNAL = "We could not reach NBCC. Check your signal and try again.";
  var PROBLEM = "Something went wrong. Refresh the page and try again.";
  var CHOOSE = "Choose a picture first.";
  var SENDING = "Sending your picture";
  var PICTURE_TYPE = "That picture is not one we can use. Try a JPG, PNG or WebP photo.";
  var PICTURE_SIZE = "That picture is too big. Try a smaller one.";
  var PICTURE_READ = "That picture could not be opened. Please try another.";
  // The button's words once a picture is in, as the page draws them (src/elf/pages/entry.ts).
  var SEND_NEW = "Send a new picture";

  // An address on this site: one slash, then only what the site's own paths hold (sitePath in
  // src/elf/pages/shell.ts), so never another site, nor a slash and a backslash.
  var SITE_PATH = /^\/(?!\/)[A-Za-z0-9/_.~%?=&-]*$/;

  var TYPES = ["image/jpeg", "image/png", "image/webp"];
  var MAX_BYTES = 2 * 1024 * 1024;
  var MAX_PX = 1600;
  var QUALITY = 0.86;
  // Tried once more if the first drawing is over 2 MB.
  var LOWER_QUALITY = 0.7;

  // The picture maker's answer while too many pictures are waiting, and how often the same picture is sent while
  // it lasts: five sends in all, each 2 to 3 seconds after the busy answer, spread so pictures sent at the same
  // moment do not all come back at the same moment.
  var BUSY = 503;
  var SENDS_WHILE_BUSY = 5;
  var BUSY_WAIT_MS = 2000;
  var BUSY_SPREAD_MS = 1000;

  // --- reading and making pictures, in a real browser ----------------------------------------------
  // Copied from assets/js/elf-poster.js (browserRead, browserMake, base64Bytes and rawBase64), keeping its limits.

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
    return function (pic, quality) {
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
          var url = canvas.toDataURL("image/jpeg", quality || QUALITY);
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

  function initEntry(doc, win, opts) {
    var clock = opts && opts.now ? opts.now : function () { return Date.now(); };
    var read = (opts && opts.read) || browserRead(win);
    var make = (opts && opts.make) || browserMake(doc);
    var form = doc.querySelector("form.elf-entry");
    // With no form (the entries have closed) there is nothing to do; with no fetch the form is left alone.
    if (!form || typeof win.fetch !== "function") return { stop: function () {} };
    var input = form.querySelector('input[type="file"]');
    var send = form.querySelector('button[type="submit"]');
    var status = form.querySelector(".elf-form-status");
    var sending = false;

    function say(words, isError) {
      if (!status) return;
      status.textContent = words;
      if (isError) status.classList.add("is-error");
      else status.classList.remove("is-error");
    }

    function hold(on) {
      sending = on;
      if (send) send.disabled = on;
    }

    /** Once a picture is in, the page shows it as the server draws it then, with no reload: the button that sends
     *  a new one, and the picture from its own address (the form's data-picture), fetched fresh so the new one
     *  shows. After a first send there is no picture yet, so one is made, first in the note under its tape, as the
     *  page draws it. Only an address on this site is shown. */
    function showPicture() {
      if (send) send.textContent = SEND_NEW;
      var src = form.getAttribute("data-picture") || "";
      if (!SITE_PATH.test(src)) return;
      var img = doc.querySelector("img.elf-entry__pic");
      if (!img) {
        var note = form.closest ? form.closest(".elf-entry-note") : null;
        if (!note) return;
        img = doc.createElement("img");
        img.className = "elf-entry__pic";
        img.setAttribute("alt", form.getAttribute("data-picture-alt") || "");
        img.setAttribute("width", "800");
        img.setAttribute("height", "600");
        img.setAttribute("decoding", "async");
        var tape = note.querySelector(".elf-tape");
        note.insertBefore(img, tape ? tape.nextSibling : note.firstChild);
      }
      img.setAttribute("src", src + (src.indexOf("?") === -1 ? "?" : "&") + "v=" + clock());
    }

    /** Why a picture was not taken: the sentence for the picture when the server names one, else its error. */
    function refusal(body) {
      var fields = body && body.fields && typeof body.fields === "object" ? body.fields : null;
      if (fields && typeof fields.photo === "string" && fields.photo) return fields.photo;
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

    function pause(ms) {
      return new Promise(function (done) {
        win.setTimeout(done, ms);
      });
    }

    /** Sends the picture (`json`), and the same again while the picture maker is busy: five sends in all, each 2 to 3
     *  seconds after its busy answer. Any other answer, or the fifth busy one, is the answer. Never rejects. */
    function sendPicture(json) {
      function attempt(n) {
        return request(form.getAttribute("data-api"), { method: "POST", headers: { "Content-Type": "application/json" }, body: json }).then(function (res) {
          if (res.status !== BUSY || n >= SENDS_WHILE_BUSY) return res;
          return pause(BUSY_WAIT_MS + Math.floor(Math.random() * BUSY_SPREAD_MS)).then(function () {
            return attempt(n + 1);
          });
        });
      }
      return attempt(1);
    }

    // The picture to send: drawn again smaller if the browser can, the file as it came if it cannot.
    function prepare(file) {
      return read(file).then(function (pic) {
        var made = pic ? make(pic) : Promise.resolve(null);
        return made
          .then(function (small) {
            // Over 2 MB: draw it once more at a lower quality before giving up on it.
            if (small && small.base64 && base64Bytes(small.base64) > MAX_BYTES) {
              return make(pic, LOWER_QUALITY).then(function (lower) {
                return lower && lower.base64 ? lower : small;
              });
            }
            return small;
          })
          .then(function (small) {
            if (small && small.base64) return small;
            if (TYPES.indexOf(file.type) === -1) return { error: PICTURE_TYPE };
            if (file.size > MAX_BYTES) return { error: PICTURE_SIZE };
            return rawBase64(win, file).then(function (b64) {
              return b64 ? { mime: file.type, base64: b64 } : { error: PICTURE_READ };
            });
          });
      });
    }

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      // A second press while a picture is on its way sends nothing.
      if (sending) return;
      var file = input && input.files && input.files.length ? input.files[0] : null;
      if (!file) return say(CHOOSE, true);
      hold(true);
      say(SENDING, false);
      prepare(file)
        .then(function (made) {
          if (made.error) return { words: made.error };
          if (base64Bytes(made.base64) > MAX_BYTES) return { words: PICTURE_SIZE };
          var body = { mime: made.mime, dataBase64: made.base64 };
          var mobile = form.querySelector('input[name="mobile"]');
          if (mobile) body.mobile = mobile.value;
          return sendPicture(JSON.stringify(body)).then(function (res) {
            return res.ok ? { thanks: typeof res.body.message === "string" ? res.body.message : "" } : { words: refusal(res.body) };
          });
        })
        .catch(function () {
          // Whatever went wrong on the way, the button comes back so the family can try again.
          return { words: PROBLEM };
        })
        .then(function (done) {
          hold(false);
          if (typeof done.thanks !== "string") return say(done.words, true);
          showPicture();
          say(done.thanks, false);
        });
    });

    return { stop: function () {} };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { initEntry: initEntry };
  } else {
    initEntry(document, window);
  }
})();
