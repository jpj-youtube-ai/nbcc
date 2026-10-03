// Your photos in the fundraising private area, /fundraise/manage (profile pictures, Jaimie,
// 2026-10-03).
//
// The private area's own script (fundraise-manage.js) draws one card per fundraiser once the
// organiser has signed in. This one watches for those cards and, for each fundraiser running with
// its own page, adds a "Your photos" part from the <template data-pictures-pattern> in the page, just
// before "Change your details":
//
//   - a live preview of the top of their page: its title, "Organised by Robin O." with their round
//     photo, and the main photo, showing what they have just chosen at once;
//   - a round photo of them: chosen, shown in a circle they can drag it around in (or move with the
//     arrow keys), then cut square in the browser from where they put it;
//   - their main photo: chosen, shown in the preview, made smaller in the browser.
//
// Each is sent to POST /api/fundraise/manage/fundraisers/:id/pictures and waits for staff; the
// server makes it again (the right way up, smaller, nothing from the camera kept) before storing it.
// Where each is up to shows above its form: "Waiting for us to check", "On your page", or "Not used"
// with our note. Kept apart from fundraise-manage.js so each can change without the other.
//
// A classic <script defer>, exported under a CommonJS guard so it can be unit tested in jsdom (where
// pictures never load, so reading and making a picture can be handed in).
(function () {
  "use strict";

  var API = "/api/fundraise/manage";
  var TYPES = ["image/jpeg", "image/png", "image/webp"];
  var MAX_BYTES = 2 * 1024 * 1024;
  var PROFILE_PX = 400;
  var MAIN_PX = 1600;
  var QUALITY = 0.86;
  var STEP = 0.05;

  var MSG = {
    reading: "Getting your photo ready…",
    sending: "Sending…",
    thanks: "Thank you. We will check your photo soon, and it goes on your page once we have.",
    choose: "Choose a photo first.",
    photoType: "That picture is not one we can use. Try a JPG, PNG or WebP photo.",
    photoSize: "That picture is too big. Try a smaller one.",
    photoRead: "That photo could not be opened. Please try another.",
    failed: "We could not send your photo just now. Please try again in a few minutes.",
    signIn: "Please sign in again: refresh this page and we will send you a new code.",
    waitingNote: "Your page keeps showing your last approved photo until then.",
    declinedNote: "You can choose another one below.",
    profileHelp: "A JPG, PNG or WebP of just you, with your face clear. It shows small and round beside your name on your page",
    // In memory of someone: the main photo is of the person remembered, and there is no round photo.
    memoryTitle: "A photo of them",
    memoryHelp: "A photo of the person you are remembering. It shows at the top of the page.",
  };

  var PERSON =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>';

  function clamp(n) {
    return Math.max(0, Math.min(1, n));
  }
  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  /** Where the square is cut from: the whole short side, slid along the long one to where they put it. */
  function cropFor(width, height, pos) {
    var side = Math.min(width, height);
    return {
      sx: Math.round((width - side) * clamp(pos ? pos.x : 0.5)),
      sy: Math.round((height - side) * clamp(pos ? pos.y : 0.5)),
      side: side,
    };
  }

  // --- reading and making pictures, in a real browser ----------------------------------------------
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

  // Draws the picture again on a canvas: a square from where they put it for a round photo, or the
  // whole picture made smaller for a main photo. A fresh JPEG, so nothing from the camera goes with it.
  function browserMake(doc) {
    return function (kind, pic, pos) {
      return new Promise(function (done) {
        try {
          var canvas = doc.createElement("canvas");
          if (!canvas.getContext || !pic || !pic.img) return done(null);
          var ctx;
          if (kind === "profile") {
            var c = cropFor(pic.width, pic.height, pos);
            var out = Math.min(PROFILE_PX, c.side);
            canvas.width = out;
            canvas.height = out;
            ctx = canvas.getContext("2d");
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, out, out);
            ctx.drawImage(pic.img, c.sx, c.sy, c.side, c.side, 0, 0, out, out);
          } else {
            var scale = Math.min(1, MAIN_PX / Math.max(pic.width, pic.height));
            canvas.width = Math.max(1, Math.round(pic.width * scale));
            canvas.height = Math.max(1, Math.round(pic.height * scale));
            ctx = canvas.getContext("2d");
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(pic.img, 0, 0, canvas.width, canvas.height);
          }
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

  // --- the part on each card -------------------------------------------------------------------------
  function initPictures(doc, win, opts) {
    var pattern = doc.querySelector("template[data-pictures-pattern]");
    var list = doc.querySelector("[data-manage-list]");
    if (!pattern || !list) return null;
    var read = (opts && opts.read) || browserRead(win);
    var make = (opts && opts.make) || browserMake(doc);
    var queued = false;

    function say(node, text, kind) {
      if (!node) return;
      node.textContent = text;
      node.className = "form-status" + (kind ? " is-" + kind : "");
    }
    function readJson(res) {
      return res.json().then(
        function (data) {
          return { status: res.status, data: data || {} };
        },
        function () {
          return { status: res.status, data: {} };
        },
      );
    }

    function giveOwnIds(part, fid) {
      var suffix = "-pics-" + fid;
      var ids = {};
      Array.prototype.forEach.call(part.querySelectorAll("[id]"), function (n) {
        ids[n.id] = true;
        n.id = n.id + suffix;
      });
      var all = [part].concat(Array.prototype.slice.call(part.querySelectorAll("[for], [aria-labelledby], [aria-describedby]")));
      all.forEach(function (n) {
        ["for", "aria-labelledby", "aria-describedby"].forEach(function (attr) {
          var v = n.getAttribute(attr);
          if (!v) return;
          n.setAttribute(
            attr,
            v
              .split(/\s+/)
              .map(function (t) {
                return ids[t] ? t + suffix : t;
              })
              .join(" "),
          );
        });
      });
    }

    function addPart(card, f) {
      var source = pattern.content ? pattern.content.firstElementChild : pattern.firstElementChild;
      if (!source) return;
      var part = source.cloneNode(true);
      giveOwnIds(part, f.id);
      var edit = card.querySelector("[data-f-edit]");
      var before = edit && edit.closest ? edit.closest(".fr-mine__part") : null;
      if (before && before.parentNode) before.parentNode.insertBefore(part, before);
      else card.appendChild(part);

      var state = {
        main: { inUse: f.main && f.main.inUse, latest: f.main && f.main.latest, chosen: null },
        profile: { inUse: f.profile && f.profile.inUse, latest: f.profile && f.profile.latest, chosen: null, pos: { x: 0.5, y: 0.5 } },
      };

      var title = part.querySelector("[data-pic-title]");
      if (title) title.textContent = f.title || "";
      var by = part.querySelector("[data-pic-by]");
      if (by) by.textContent = (f.isTeam ? "Team organiser: " : "Organised by ") + (f.name || "");
      var avatar = part.querySelector("[data-pic-avatar]");
      var profileForm = part.querySelector('form[data-pic-form="profile"]');
      if (!f.profileAllowed) {
        if (profileForm) profileForm.hidden = true;
        if (avatar) avatar.hidden = true;
      }
      if (f.inMemory) {
        var mainTitle = part.querySelector("[data-pic-main-title]");
        var mainHelp = part.querySelector("[data-pic-main-help]");
        if (mainTitle) mainTitle.textContent = MSG.memoryTitle;
        if (mainHelp) mainHelp.textContent = MSG.memoryHelp;
      }
      var help = part.querySelector("[data-pic-profile-help]");
      if (help) help.textContent = MSG.profileHelp + (f.inTeam ? " and on your team’s page." : ".");

      function paintPreview() {
        // The round photo: the one just chosen, else the one waiting, else the one in use.
        if (avatar && f.profileAllowed) {
          var p = state.profile;
          var src = p.chosen ? p.chosen.src : p.latest && p.latest.status === "pending" ? p.latest.photoUrl : p.inUse ? p.inUse.photoUrl : "";
          avatar.innerHTML = "";
          // A round frame the photo fills: one just chosen sits where they put it in the circle; one
          // from us is already square.
          avatar.classList.toggle("has-photo", Boolean(src));
          if (src) {
            var img = doc.createElement("img");
            img.setAttribute("src", src);
            img.setAttribute("alt", "Your round photo");
            positionImage(img, p.chosen || { width: 1, height: 1 }, p.chosen ? p.pos : { x: 0.5, y: 0.5 });
            avatar.appendChild(img);
          } else {
            avatar.innerHTML = PERSON;
          }
        }
        var m = state.main;
        var mainImg = part.querySelector("[data-pic-main-img]");
        var empty = part.querySelector("[data-pic-main-empty]");
        var mainSrc = m.chosen ? m.chosen.src : m.latest && m.latest.status === "pending" ? m.latest.photoUrl : f.pageImageSrc || "";
        if (mainImg) {
          mainImg.setAttribute("src", mainSrc || "data:,");
          mainImg.hidden = !mainSrc;
        }
        if (empty) empty.hidden = Boolean(mainSrc);
      }

      // Shows the chosen picture as the circle will cut it: covering the frame, shifted to the spot.
      function positionImage(img, pic, pos) {
        var wide = pic.width >= pic.height;
        var ratio = (wide ? pic.width / pic.height : pic.height / pic.width) * 100;
        img.style.width = wide ? ratio + "%" : "100%";
        img.style.height = wide ? "100%" : ratio + "%";
        img.style.maxWidth = "none";
        img.style.objectFit = "fill";
        img.style.left = wide ? -(ratio - 100) * pos.x + "%" : "0";
        img.style.top = wide ? "0" : -(ratio - 100) * pos.y + "%";
        img.style.position = "absolute";
      }

      function paintNow(kind) {
        var form = part.querySelector('form[data-pic-form="' + kind + '"]');
        var box = form && form.querySelector("[data-pic-now]");
        if (!box) return;
        var s = state[kind];
        box.innerHTML = "";
        var shown = s.latest || s.inUse;
        if (!shown) return;
        var pill = doc.createElement("p");
        pill.className = "fr-mynews__status is-" + String(shown.status || "").replace(/[^a-z]/g, "");
        pill.textContent = shown.statusWords || "";
        box.appendChild(pill);
        var words = "";
        if (shown.status === "pending" && (s.inUse || (kind === "main" && f.pageImageSrc))) words = MSG.waitingNote;
        if (shown.status === "declined") words = (shown.note ? "Our note: " + shown.note + " " : "") + MSG.declinedNote;
        if (words) {
          var p = doc.createElement("p");
          p.className = "fr-pic__note";
          p.textContent = words;
          box.appendChild(p);
        }
      }

      wireForm(part, "profile", state, paintPreview, paintNow, positionImage);
      wireForm(part, "main", state, paintPreview, paintNow, positionImage);
      paintPreview();
      paintNow("profile");
      paintNow("main");

      function wireForm(part, kind, state, paintPreview, paintNow, positionImage) {
        var form = part.querySelector('form[data-pic-form="' + kind + '"]');
        if (!form) return;
        var file = form.querySelector('input[type="file"]');
        var status = form.querySelector("[data-pic-status]");
        var submit = form.querySelector("[data-pic-submit]");
        var cropBox = form.querySelector("[data-pic-crop]");
        var crop = form.querySelector("[data-crop]");
        var cropImg = form.querySelector("[data-crop-img]");
        var s = state[kind];
        var reading = null;

        function paintCrop() {
          if (!crop || !s.chosen) return;
          crop.setAttribute("data-x", String(round2(s.pos.x)));
          crop.setAttribute("data-y", String(round2(s.pos.y)));
          positionImage(cropImg, s.chosen, s.pos);
          paintPreview();
        }
        function move(dx, dy) {
          if (!s.chosen) return;
          var wide = s.chosen.width > s.chosen.height;
          var tall = s.chosen.height > s.chosen.width;
          s.pos = { x: wide ? clamp(s.pos.x + dx) : 0.5, y: tall ? clamp(s.pos.y + dy) : 0.5 };
          paintCrop();
        }

        function drop() {
          s.chosen = null;
          reading = null;
          try {
            file.value = "";
          } catch (e) {
            /* some browsers will not clear it */
          }
          if (cropBox) cropBox.hidden = true;
          paintPreview();
        }

        if (crop) {
          crop.addEventListener("keydown", function (e) {
            var keys = { ArrowLeft: [-STEP, 0], ArrowRight: [STEP, 0], ArrowUp: [0, -STEP], ArrowDown: [0, STEP] };
            if (keys[e.key]) {
              e.preventDefault();
              move(keys[e.key][0], keys[e.key][1]);
            } else if (e.key === "Home" || e.key === "End") {
              e.preventDefault();
              var to = e.key === "Home" ? 0 : 1;
              s.pos = { x: s.chosen && s.chosen.width > s.chosen.height ? to : 0.5, y: s.chosen && s.chosen.height > s.chosen.width ? to : 0.5 };
              paintCrop();
            }
          });
          // Dragging: the photo follows the pointer, so pulling it right shows more of its left.
          var drag = null;
          crop.addEventListener("pointerdown", function (e) {
            if (!s.chosen) return;
            var rect = crop.getBoundingClientRect();
            drag = { x: e.clientX, y: e.clientY, pos: { x: s.pos.x, y: s.pos.y }, size: rect.width || 1 };
            try {
              crop.setPointerCapture(e.pointerId);
            } catch (err) {
              /* not every browser */
            }
            crop.classList.add("is-dragging");
            e.preventDefault();
          });
          crop.addEventListener("pointermove", function (e) {
            if (!drag || !s.chosen) return;
            var long = Math.max(s.chosen.width, s.chosen.height) / Math.min(s.chosen.width, s.chosen.height);
            var travel = drag.size * (long - 1) || 1;
            var wide = s.chosen.width > s.chosen.height;
            s.pos = {
              x: wide ? clamp(drag.pos.x - (e.clientX - drag.x) / travel) : 0.5,
              y: wide ? 0.5 : clamp(drag.pos.y - (e.clientY - drag.y) / travel),
            };
            paintCrop();
          });
          var end = function () {
            drag = null;
            crop.classList.remove("is-dragging");
          };
          crop.addEventListener("pointerup", end);
          crop.addEventListener("pointercancel", end);
        }

        file.addEventListener("change", function () {
          var picked = file.files && file.files[0];
          if (!picked) return drop();
          if (TYPES.indexOf(picked.type) === -1) {
            drop();
            return say(status, MSG.photoType, "error");
          }
          say(status, MSG.reading, "pending");
          var run = Promise.resolve()
            .then(function () {
              return read(picked);
            })
            .catch(function () {
              return null;
            })
            .then(function (pic) {
              if (reading !== run) return;
              reading = null;
              if (!pic || !pic.width || !pic.height) {
                drop();
                return say(status, MSG.photoRead, "error");
              }
              s.chosen = pic;
              s.pos = { x: 0.5, y: 0.5 };
              if (cropBox) cropBox.hidden = false;
              if (cropImg) cropImg.setAttribute("src", pic.src);
              paintCrop();
              paintPreview();
              say(status, "", null);
            });
          reading = run;
        });

        form.addEventListener("submit", function (e) {
          e.preventDefault();
          if (submit && submit.disabled) return;
          Promise.resolve(reading).then(function () {
            if (!s.chosen) return say(status, MSG.choose, "error");
            if (submit) submit.disabled = true;
            say(status, MSG.sending, "pending");
            Promise.resolve()
              .then(function () {
                return make(kind, s.chosen, kind === "profile" ? { x: s.pos.x, y: s.pos.y } : null);
              })
              .then(function (made) {
                if (!made || !made.base64) throw new Error("unreadable");
                if (base64Bytes(made.base64) > MAX_BYTES) throw new Error("size");
                return win.fetch(API + "/fundraisers/" + encodeURIComponent(f.id) + "/pictures", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  credentials: "same-origin",
                  body: JSON.stringify({ kind: kind, mime: made.mime, dataBase64: made.base64 }),
                });
              })
              .then(readJson)
              .then(function (r) {
                if (submit) submit.disabled = false;
                if (r.status === 202 && r.data.picture) {
                  s.latest = r.data.picture;
                  paintNow(kind);
                  return say(status, MSG.thanks, "success");
                }
                if (r.data.fields && r.data.fields.photo) return say(status, r.data.fields.photo, "error");
                if (r.status === 413) return say(status, MSG.photoSize, "error");
                if (r.status === 401) return say(status, MSG.signIn, "error");
                say(status, r.data.error || MSG.failed, "error");
              })
              .catch(function (err) {
                if (submit) submit.disabled = false;
                var why = err && err.message;
                say(status, why === "size" ? MSG.photoSize : why === "unreadable" ? MSG.photoRead : MSG.failed, "error");
              });
          });
        });
      }
    }

    // --- finding the cards ------------------------------------------------------------------------
    function waiting() {
      return Array.prototype.filter.call(list.querySelectorAll("[data-fundraiser]"), function (card) {
        return !card.hasAttribute("data-pictures-seen");
      });
    }

    function load() {
      queued = false;
      var cards = waiting();
      if (!cards.length) return null;
      cards.forEach(function (card) {
        card.setAttribute("data-pictures-seen", "");
      });
      return win
        .fetch(API + "/pictures", { credentials: "same-origin" })
        .then(readJson)
        .then(function (r) {
          if (r.status !== 200 || !r.data || !Array.isArray(r.data.fundraisers)) return;
          var byId = {};
          r.data.fundraisers.forEach(function (f) {
            byId[String(f.id)] = f;
          });
          cards.forEach(function (card) {
            var f = byId[card.getAttribute("data-fundraiser")];
            if (!f || !f.canSend) return;
            if (!list.contains(card) || card.querySelector("[data-pictures-part]")) return;
            addPart(card, f);
          });
        })
        .catch(function () {
          /* the rest of the private area works without it */
        });
    }

    function schedule() {
      if (queued) return;
      queued = true;
      Promise.resolve().then(load);
    }

    var Observer = win.MutationObserver || (typeof MutationObserver !== "undefined" ? MutationObserver : null);
    if (Observer) new Observer(schedule).observe(list, { childList: true });
    schedule();
    return { refresh: schedule };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { initPictures: initPictures, cropFor: cropFor };
  } else {
    initPictures(document, window);
  }
})();
