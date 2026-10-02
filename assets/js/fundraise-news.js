// News updates in the fundraising private area, /fundraise/manage (TASK-506).
//
// The private area's own script (fundraise-manage.js) draws one card per fundraiser once the
// organiser has signed in. This one watches for those cards and, for each fundraiser running with
// its own page, adds a "News updates" part from the <template data-news-pattern> in the page, just
// before "All done?": a short update (500 characters at most) and an optional photo, sent to
// POST /api/fundraise/manage/fundraisers/:id/news to wait for staff; and the updates sent so far,
// newest first, each saying where it is up to ("Waiting for us to check", "On your page", "Not
// used"). A finished fundraiser keeps its list, with no form. Kept apart from fundraise-manage.js
// so each can change without the other.
//
// A photo is shrunk in the browser before it is sent, exactly as a photo staff upload in the admin
// is (nlShrinkImage in assets/js/admin/app.js: at most 1200 pixels on its longest side, at 0.82
// quality, and only when it is bigger than that or over 1 MB), as phone photos are bigger than the
// 2 MB the server takes. Only a JPG, PNG or WebP.
//
// A classic <script defer>, exported under a CommonJS guard so it can be unit tested in jsdom.
(function () {
  "use strict";

  var API = "/api/fundraise/manage";
  var MAX = 500;
  var FIRST = 5;
  var TYPES = ["image/jpeg", "image/png", "image/webp"];
  var MAX_BYTES = 2 * 1024 * 1024;
  var MAX_PX = 1200;
  var QUALITY = 0.82;
  var SHRINK_ABOVE = 1024 * 1024;

  var MSG = {
    sending: "Sending…",
    reading: "Getting your photo ready…",
    thanks: "Thank you. We will check your update soon, and email you once it is on your page.",
    photoType: "That photo is not one we can use. Try a JPG or PNG.",
    photoSize: "That photo is too big. Try a smaller one.",
    photoRead: "That photo could not be read. Please try another.",
    failed: "We could not send your update just now. Please try again in a few minutes.",
    signIn: "Please sign in again: refresh this page and we will send you a new code.",
    check: "Please check the highlighted answers below and try again.",
  };

  var LONG_DATE = (function () {
    try {
      return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "long", year: "numeric" });
    } catch (e) {
      return null;
    }
  })();
  function longDate(iso) {
    try {
      return LONG_DATE ? LONG_DATE.format(new Date(iso)) : String(iso).slice(0, 10);
    } catch (e) {
      return "";
    }
  }

  // --- the photo -----------------------------------------------------------------------------------
  function fitWithin(w, h, max) {
    var scale = Math.min(1, max / Math.max(w, h));
    return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
  }

  // Resolves with { mime, base64 } when it shrank it, or null when it could not or need not (the
  // caller then sends the photo as it is). The same type back: a PNG made into a JPEG loses its
  // see through parts.
  function canvasShrink(doc, win) {
    return function (file) {
      return new Promise(function (done) {
        var URLs = win.URL;
        var canvasOk = doc.createElement("canvas").getContext;
        if (!URLs || !URLs.createObjectURL || !canvasOk || typeof win.Image !== "function") return done(null);
        var url = URLs.createObjectURL(file);
        var img = new win.Image();
        var finish = function (out) {
          try {
            URLs.revokeObjectURL(url);
          } catch (e) {
            /* nothing to free */
          }
          done(out);
        };
        img.onerror = function () {
          finish(null);
        };
        img.onload = function () {
          try {
            var w = img.naturalWidth;
            var h = img.naturalHeight;
            if (w <= MAX_PX && h <= MAX_PX && file.size <= SHRINK_ABOVE) return finish(null);
            var box = fitWithin(w, h, MAX_PX);
            var canvas = doc.createElement("canvas");
            canvas.width = box.width;
            canvas.height = box.height;
            canvas.getContext("2d").drawImage(img, 0, 0, box.width, box.height);
            var mime = file.type === "image/png" || file.type === "image/webp" ? file.type : "image/jpeg";
            var dataUrl = canvas.toDataURL(mime, QUALITY);
            var comma = dataUrl.indexOf(",");
            if (comma === -1) return finish(null);
            // toDataURL falls back to PNG for a type it does not know: trust what it says it made.
            var made = dataUrl.slice(5, dataUrl.indexOf(";"));
            finish(TYPES.indexOf(made) === -1 ? null : { mime: made, base64: dataUrl.slice(comma + 1) });
          } catch (e) {
            finish(null);
          }
        };
        img.src = url;
      });
    };
  }

  function readWhole(win, file) {
    return new Promise(function (done) {
      var Reader = win.FileReader || (typeof FileReader !== "undefined" ? FileReader : null);
      if (!Reader) return done(null);
      var reader = new Reader();
      reader.onload = function () {
        var url = String(reader.result || "");
        var comma = url.indexOf(",");
        done(comma === -1 ? null : { mime: file.type, base64: url.slice(comma + 1) });
      };
      reader.onerror = function () {
        done(null);
      };
      reader.readAsDataURL(file);
    });
  }

  function base64Bytes(b64) {
    var pad = /==$/.test(b64) ? 2 : /=$/.test(b64) ? 1 : 0;
    return Math.floor((b64.length * 3) / 4) - pad;
  }

  // --- the part on each card -------------------------------------------------------------------------
  function initNews(doc, win, opts) {
    var pattern = doc.querySelector("template[data-news-pattern]");
    var list = doc.querySelector("[data-manage-list]");
    if (!pattern || !list) return null;
    var shrink = (opts && opts.shrink) || canvasShrink(doc, win);
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
    function validate(form, summary, extra) {
      var shared = win.NBCCFormValidation;
      if (shared && typeof shared.validateForm === "function") {
        if (summary) summary.textContent = MSG.check;
        return shared.validateForm(form, {
          summary: summary || undefined,
          extraChecks: function () {
            return extra || [];
          },
        }).valid;
      }
      return !(extra && extra.length) && (typeof form.checkValidity !== "function" || form.checkValidity());
    }

    // Every id in the copy gets the fundraiser's id on the end, and every reference with it.
    function giveOwnIds(part, fid) {
      var suffix = "-news-" + fid;
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

    function item(u) {
      var li = doc.createElement("li");
      li.className = "fr-wall__item";
      var status = doc.createElement("p");
      status.className = "fr-mynews__status is-" + String(u.status || "pending").replace(/[^a-z]/g, "");
      status.textContent = u.statusWords || "";
      li.appendChild(status);
      if (u.photoUrl) {
        var fig = doc.createElement("figure");
        fig.className = "fr-news__photo";
        var img = doc.createElement("img");
        img.setAttribute("src", u.photoUrl);
        img.setAttribute("alt", "Your photo with this update");
        img.setAttribute("loading", "lazy");
        img.setAttribute("decoding", "async");
        fig.appendChild(img);
        li.appendChild(fig);
      }
      var text = doc.createElement("p");
      text.className = "fr-wall__msg";
      text.textContent = u.text || "";
      li.appendChild(text);
      var when = doc.createElement("p");
      when.className = "fr-wall__when";
      when.textContent = longDate(u.createdAt);
      li.appendChild(when);
      return li;
    }

    function fillList(part, updates) {
      var ol = part.querySelector("[data-news-list]");
      var more = part.querySelector("[data-news-more]");
      ol.innerHTML = "";
      updates.forEach(function (u, i) {
        var li = item(u);
        if (i >= FIRST && !part.__newsAll) li.hidden = true;
        ol.appendChild(li);
      });
      ol.hidden = updates.length === 0;
      if (more) {
        more.hidden = part.__newsAll || updates.length <= FIRST;
        more.textContent = "Show all " + updates.length;
      }
    }

    function addPart(card, f) {
      var source = pattern.content ? pattern.content.firstElementChild : pattern.firstElementChild;
      if (!source) return;
      var part = source.cloneNode(true);
      giveOwnIds(part, f.id);
      var before = card.querySelector("[data-f-done-part]");
      if (before && before.parentNode) before.parentNode.insertBefore(part, before);
      else card.appendChild(part);
      var updates = (f.updates || []).slice();
      fillList(part, updates);
      var more = part.querySelector("[data-news-more]");
      if (more) {
        more.addEventListener("click", function () {
          part.__newsAll = true;
          fillList(part, updates);
        });
      }
      var form = part.querySelector("form[data-news-form]");
      var closed = part.querySelector("[data-news-closed]");
      if (!f.canPost) {
        if (form) form.hidden = true;
        if (closed) closed.hidden = false;
        return;
      }
      wireForm(part, form, f, updates);
    }

    function wireForm(part, form, f, updates) {
      var box = form.querySelector('textarea[name="text"]');
      var count = form.querySelector("[data-news-count]");
      var file = form.querySelector('input[type="file"]');
      var preview = form.querySelector("[data-news-preview]");
      var previewImg = form.querySelector("[data-news-preview-img]");
      var clear = form.querySelector("[data-news-photo-clear]");
      var status = form.querySelector("[data-news-status]");
      var summary = form.querySelector("[data-news-error]");
      var submit = form.querySelector("[data-news-submit]");
      var chosen = null;
      var reading = null;

      function counted() {
        var left = MAX - String(box.value || "").length;
        count.textContent = left === MAX ? "Up to 500 characters." : left === 1 ? "1 character left." : left + " characters left.";
      }
      box.addEventListener("input", counted);

      // A box grows with what is typed, so nothing scrolls inside it.
      function grow() {
        if (!box.scrollHeight) return;
        box.style.height = "auto";
        box.style.height = box.scrollHeight + 4 + "px";
        box.style.overflowY = "hidden";
      }
      box.addEventListener("input", grow);

      function dropPhoto() {
        chosen = null;
        reading = null;
        try {
          file.value = "";
        } catch (e) {
          /* some browsers will not clear it */
        }
        if (preview) preview.hidden = true;
        if (previewImg) previewImg.setAttribute("src", "data:,");
      }
      if (clear) {
        clear.addEventListener("click", function () {
          dropPhoto();
          say(status, "", null);
        });
      }

      file.addEventListener("change", function () {
        var picked = file.files && file.files[0];
        chosen = null;
        if (!picked) return dropPhoto();
        if (TYPES.indexOf(picked.type) === -1) {
          dropPhoto();
          return say(status, MSG.photoType, "error");
        }
        say(status, MSG.reading, "pending");
        var run = Promise.resolve()
          .then(function () {
            return shrink(picked);
          })
          .catch(function () {
            return null;
          })
          .then(function (out) {
            return out || readWhole(win, picked);
          })
          .then(function (photo) {
            if (reading !== run) return; // another photo was chosen meanwhile
            reading = null;
            if (!photo || !photo.base64) {
              dropPhoto();
              return say(status, MSG.photoRead, "error");
            }
            if (base64Bytes(photo.base64) > MAX_BYTES) {
              dropPhoto();
              return say(status, MSG.photoSize, "error");
            }
            chosen = photo;
            if (previewImg) previewImg.setAttribute("src", "data:" + photo.mime + ";base64," + photo.base64);
            if (preview) preview.hidden = false;
            say(status, "", null);
          });
        reading = run;
      });

      form.addEventListener("submit", function (e) {
        e.preventDefault();
        if (submit && submit.disabled) return;
        say(status, "", null);
        if (!validate(form, summary, null)) return;
        if (submit) submit.disabled = true;
        say(status, MSG.sending, "pending");
        Promise.resolve(reading)
          .then(function () {
            var body = {
              text: String(box.value || "").trim(),
              photo: chosen ? { mime: chosen.mime, dataBase64: chosen.base64 } : null,
            };
            return win.fetch(API + "/fundraisers/" + encodeURIComponent(f.id) + "/news", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "same-origin",
              body: JSON.stringify(body),
            });
          })
          .then(readJson)
          .then(function (r) {
            if (submit) submit.disabled = false;
            if (r.status === 202 && r.data.update) {
              updates.unshift(r.data.update);
              fillList(part, updates);
              box.value = "";
              counted();
              box.style.height = "";
              dropPhoto();
              return say(status, MSG.thanks, "success");
            }
            if (r.status === 400 && r.data.fields) {
              say(status, "", null);
              var checks = [];
              if (r.data.fields.text) checks.push({ control: box, message: r.data.fields.text });
              if (r.data.fields.photo) checks.push({ control: file, message: r.data.fields.photo });
              if (checks.length) return validate(form, summary, checks);
            }
            if (r.status === 413) return say(status, (r.data.fields && r.data.fields.photo) || MSG.photoSize, "error");
            if (r.status === 401) return say(status, MSG.signIn, "error");
            say(status, r.data.error || MSG.failed, "error");
          })
          .catch(function () {
            if (submit) submit.disabled = false;
            say(status, MSG.failed, "error");
          });
      });
    }

    // --- finding the cards ------------------------------------------------------------------------
    function waiting() {
      return Array.prototype.filter.call(list.querySelectorAll("[data-fundraiser]"), function (card) {
        return !card.hasAttribute("data-news-seen");
      });
    }

    function load() {
      queued = false;
      var cards = waiting();
      if (!cards.length) return null;
      cards.forEach(function (card) {
        card.setAttribute("data-news-seen", "");
      });
      return win
        .fetch(API + "/news", { credentials: "same-origin" })
        .then(readJson)
        .then(function (r) {
          if (r.status !== 200 || !r.data || !Array.isArray(r.data.fundraisers)) return;
          var byId = {};
          r.data.fundraisers.forEach(function (f) {
            byId[String(f.id)] = f;
          });
          cards.forEach(function (card) {
            var f = byId[card.getAttribute("data-fundraiser")];
            // Only where it can be used now, or where there are updates to look back on.
            if (!f || (!f.canPost && !(f.updates && f.updates.length))) return;
            if (!list.contains(card) || card.querySelector("[data-news-part]")) return;
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
    module.exports = { initNews: initNews };
  } else {
    initNews(document, window);
  }
})();
