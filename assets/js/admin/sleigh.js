/* NBCC Santa Sleigh: its own admin section (Admin > Giving > Santa Sleigh, #view-sleigh in admin.html).
 * Design: docs/superpowers/specs/2026-11-10-santa-sleigh-design.md.
 *
 * One row per night (the date, the areas, the start and finish times, the bucket cash staff count,
 * and the card machine taps counted for it), the year's total in its parts, the day the page switches
 * off, and the posters and hand-out QR code to print. No permission of its own: view of Donations sees
 * it, edit of Donations changes it (the server says which as mayEdit, and checks every save itself).
 *
 * Its own file beside app.js, as assets/js/admin/elf-hq.js is: it fills #sleighAdmin, reads the signed
 * in person's token the way app.js keeps it, and asks /api/admin/sleigh (src/routes/admin-sleigh.ts).
 * app.js only shows the view and calls open(). Everything from the server is put on the page as text,
 * never as markup. Status words use is-ok and is-error, never the class the public stylesheet hides.
 *
 * A classic <script defer>, exported under a CommonJS guard so it can be unit tested in jsdom
 * (test/unit/admin-sleigh-js.test.ts).
 */
(function () {
  "use strict";

  var TOKEN_KEY = "nbcc_admin_token";
  var API = "/api/admin/sleigh";
  var DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var WORDS = {
    loading: "Loading…",
    didNotWork: "That did not work. Please try again.",
    signedOut: "Your session has ended. Please sign in again.",
    notAllowed: "You do not have access to do that. An admin can give it in Team.",
    bucket: "Write the bucket cash in pounds and pence, like 152.40.",
    poster: "That poster could not be made. Please try again.",
    qr: "That QR code could not be made. Please try again.",
  };

  /** "Tue 15 Dec" from "2026-12-15". */
  function dayWords(nightOn) {
    var p = String(nightOn).split("-").map(Number);
    var d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    return DAYS[d.getUTCDay()] + " " + p[2] + " " + MONTHS[p[1] - 1];
  }
  /** "£50", "£1,234", "£12.50": pence shown only when there are some. */
  function pounds(pence) {
    var n = Math.max(0, Math.round(Number(pence) || 0));
    var whole = Math.floor(n / 100);
    var rest = n % 100;
    return "£" + whole.toLocaleString("en-GB") + (rest ? "." + String(rest).padStart(2, "0") : "");
  }
  /** "152.40" for a box staff type pounds into. */
  function poundsBox(pence) {
    var n = Math.max(0, Math.round(Number(pence) || 0));
    return Math.floor(n / 100) + "." + String(n % 100).padStart(2, "0");
  }
  /** Pence from what staff typed ("152.40", "£1,234.5", "20"), or null when it is not an amount. */
  function penceFrom(typed) {
    var t = String(typed || "").replace(/[£,\s]/g, "");
    if (t === "") return 0;
    if (!/^\d{1,6}(\.\d{1,2})?$/.test(t)) return null;
    var parts = t.split(".");
    return Number(parts[0]) * 100 + (parts[1] ? Number((parts[1] + "0").slice(0, 2)) : 0);
  }
  /** "4pm", "9.30pm" from the time part of "2026-12-15 16:00". */
  function spoken(at) {
    var hm = String(at).slice(-5).split(":").map(Number);
    var hour = hm[0] % 12 === 0 ? 12 : hm[0] % 12;
    return hour + (hm[1] ? "." + String(hm[1]).padStart(2, "0") : "") + (hm[0] < 12 ? "am" : "pm");
  }

  function initAdminSleigh(doc, win) {
    var mount = doc.getElementById("sleighAdmin");
    var view = doc.getElementById("view-sleigh");
    if (!mount) return { open: function () { return Promise.resolve(); } };

    var data = null;

    function el(tag, attrs, kids) {
      var n = doc.createElement(tag);
      Object.keys(attrs || {}).forEach(function (k) {
        if (k === "text") n.textContent = attrs[k];
        else if (attrs[k] === true) n.setAttribute(k, "");
        else if (attrs[k] !== false && attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, String(attrs[k]));
      });
      (kids || []).forEach(function (kid) {
        if (kid === null || kid === undefined || kid === false) return;
        n.appendChild(typeof kid === "string" ? doc.createTextNode(kid) : kid);
      });
      return n;
    }
    function token() {
      try {
        return win.sessionStorage.getItem(TOKEN_KEY);
      } catch (e) {
        return null;
      }
    }
    function signedOut() {
      try {
        win.sessionStorage.removeItem(TOKEN_KEY);
      } catch (e) {
        /* a private window: nothing to forget */
      }
      if (win.location && typeof win.location.reload === "function") win.location.reload();
      return new Error(WORDS.signedOut);
    }
    function ask(method, url, body) {
      var init = { method: method, headers: { Authorization: "Bearer " + token() } };
      if (body !== undefined) {
        init.headers["Content-Type"] = "application/json";
        init.body = JSON.stringify(body);
      }
      return win.fetch(url, init).then(function (res) {
        if (res.status === 401) throw signedOut();
        return Promise.resolve(res.json())
          .catch(function () {
            return {};
          })
          .then(function (d) {
            if (res.status === 403 && d && d.error === "forbidden") throw new Error(WORDS.notAllowed);
            if (!res.ok) throw new Error((d && d.error) || WORDS.didNotWork);
            return d || {};
          });
      });
    }
    /** A file behind the admin session: fetched with the token. */
    function fetchFile(url) {
      return win.fetch(url, { headers: { Authorization: "Bearer " + token() } }).then(function (res) {
        if (res.status === 401) throw signedOut();
        if (!res.ok) throw new Error("not made");
        return res;
      });
    }
    /** Words in the status line: good news (true), an error (false), or just news (null). */
    function say(words, ok) {
      status.textContent = words;
      status.classList.toggle("is-ok", ok === true && !!words);
      status.classList.toggle("is-error", ok === false && !!words);
    }

    // ---- the frame ----
    var status = el("p", { class: "sl-status", role: "status", "aria-live": "polite" });
    var totalsBox = el("div", { class: "sl-totals" });
    var nightsBox = el("div", { class: "sl-nights" });
    var settingsBox = el("div", { class: "sl-settings" });
    var postersBox = el("div", { class: "sl-posters" });
    mount.appendChild(
      el("div", { class: "sl-root" }, [
        el("p", { class: "sl-lede", text: "The year's nights, the bucket cash counted for each, and the total. Card machine taps on a sleigh night are counted here and in Donations; bucket cash only here." }),
        status,
        totalsBox,
        el("h3", { class: "sl-h3", text: "Nights" }),
        nightsBox,
        el("h3", { class: "sl-h3", text: "Posters and QR code" }),
        postersBox,
        el("h3", { class: "sl-h3", text: "Switch off" }),
        settingsBox,
      ]),
    );

    function clear(node) {
      while (node.firstChild) node.removeChild(node.firstChild);
    }

    function drawTotals() {
      clear(totalsBox);
      var t = data.totals || {};
      [
        ["online", "Online gifts", t.onlinePence],
        ["card", "Card machine", t.cardPence],
        ["bucket", "Bucket cash", t.bucketPence],
        ["total", "Total", t.totalPence],
      ].forEach(function (part) {
        totalsBox.appendChild(
          el("div", { class: "sl-total" + (part[0] === "total" ? " sl-total--grand" : "") }, [
            el("span", { class: "sl-total__name", text: part[1] }),
            el("span", { class: "sl-total__sum", "data-sl-total": part[0], text: pounds(part[2]) }),
          ]),
        );
      });
    }

    function posterButtons(night) {
      return ["a4", "a3"].map(function (size) {
        var b = el("button", { class: "admin-btn sl-btn--ghost sl-poster", type: "button", "data-sl-poster": size, text: "Poster " + size.toUpperCase() });
        b.addEventListener("click", function () {
          openPoster(String(night.id), size);
        });
        return b;
      });
    }

    function drawNights() {
      clear(nightsBox);
      var mayEdit = !!data.mayEdit;
      var table = el("table", { class: "sl-table" });
      table.appendChild(
        el("thead", {}, [
          el("tr", {}, ["Date", "Areas", "Starts", "Finishes", "Bucket cash (£)", "Card machine", ""].map(function (h) {
            return el("th", { scope: "col", text: h });
          })),
        ]),
      );
      var body = el("tbody");
      (data.nights || []).forEach(function (n) {
        var label = dayWords(n.nightOn);
        var areas = el("input", { class: "sl-input", type: "text", name: "areas", maxlength: "120", "aria-label": "Areas on " + label, disabled: !mayEdit });
        areas.value = n.areas || "";
        var starts = el("input", { class: "sl-input", type: "time", name: "startsAt", "aria-label": "Start time on " + label, disabled: !mayEdit });
        starts.value = n.startsAt || "";
        var ends = el("input", { class: "sl-input", type: "time", name: "endsAt", "aria-label": "Finish time on " + label, disabled: !mayEdit });
        ends.value = n.endsAt || "";
        var bucket = el("input", { class: "sl-input", type: "text", inputmode: "decimal", name: "bucket", "aria-label": "Bucket cash on " + label + ", in pounds", disabled: !mayEdit });
        bucket.value = poundsBox(n.bucketPence);
        var save = null;
        if (mayEdit) {
          save = el("button", { class: "admin-btn", type: "button", "data-sl-save": "", text: "Save" });
          save.addEventListener("click", function () {
            saveNight(n, { areas: areas, starts: starts, ends: ends, bucket: bucket }, save);
          });
        }
        var taps = Number(n.cardGifts) || 0;
        body.appendChild(
          el("tr", { "data-night": n.id }, [
            el("td", { "data-label": "Date" }, [el("span", { class: "sl-date", "data-sl-date": "", text: label })]),
            el("td", { "data-label": "Areas" }, [areas]),
            el("td", { "data-label": "Starts" }, [starts]),
            el("td", { "data-label": "Finishes" }, [ends]),
            el("td", { "data-label": "Bucket cash (£)" }, [bucket]),
            el("td", { "data-label": "Card machine" }, [
              el("span", { class: "sl-card", "data-sl-card": "", text: pounds(n.cardPence) + " from " + taps + (taps === 1 ? " tap" : " taps") }),
              el("span", { class: "sl-window", "data-sl-window": "", text: n.window ? "Taps counted " + spoken(n.window.from) + " to " + spoken(n.window.to) : "" }),
            ]),
            el("td", { class: "sl-actions" }, [save].concat(posterButtons(n))),
          ]),
        );
      });
      table.appendChild(body);
      nightsBox.appendChild(table);
      nightsBox.appendChild(el("p", { class: "sl-hint", text: "Leave a time empty while it is to be confirmed: the page shows Timings TBC and card machine taps are counted from 4pm to 10pm." }));
    }

    function drawPosters() {
      clear(postersBox);
      var row = el("div", { class: "sl-poster-row" });
      ["a4", "a3"].forEach(function (size) {
        var b = el("button", { class: "admin-btn", type: "button", "data-sl-poster-all": size, text: "All nights " + size.toUpperCase() });
        b.addEventListener("click", function () {
          openPoster("all", size);
        });
        row.appendChild(b);
      });
      var qr = el("button", { class: "admin-btn sl-btn--ghost", type: "button", "data-sl-qr": "", text: "QR code for hand-outs" });
      qr.addEventListener("click", downloadQr);
      row.appendChild(qr);
      postersBox.appendChild(row);
      postersBox.appendChild(el("p", { class: "sl-hint", text: "Each night's own poster is on its row above. Every poster and the hand-out code go to nbcc.scot/sleigh, and their scans show in QR codes." }));
    }

    function drawSettings() {
      clear(settingsBox);
      var day = el("input", { class: "sl-input", type: "date", name: "offOn", id: "sleighOffOn", disabled: !data.mayEdit });
      day.value = (data.settings && data.settings.offOn) || "";
      var kids = [el("label", { class: "sl-label", for: "sleighOffOn", text: "From this day the page goes to the home page" }), day];
      if (data.mayEdit) {
        var save = el("button", { class: "admin-btn", type: "button", "data-sl-save-settings": "", text: "Save" });
        save.addEventListener("click", function () {
          save.disabled = true;
          ask("PATCH", API + "/settings", { offOn: day.value })
            .then(function (d) {
              data = d;
              draw();
              say("Saved the switch off day.", true);
            })
            .catch(function (e) {
              save.disabled = false;
              say(e.message, false);
            });
        });
        kids.push(save);
      }
      settingsBox.appendChild(el("div", { class: "sl-settings-row" }, kids));
    }

    function draw() {
      drawTotals();
      drawNights();
      drawPosters();
      drawSettings();
    }

    function saveNight(n, f, button) {
      var pence = penceFrom(f.bucket.value);
      if (pence === null) {
        say(WORDS.bucket, false);
        return Promise.resolve();
      }
      button.disabled = true;
      var body = { areas: f.areas.value.trim(), startsAt: f.starts.value || null, endsAt: f.ends.value || null, bucketPence: pence };
      return ask("PATCH", API + "/nights/" + encodeURIComponent(n.id), body)
        .then(function (d) {
          data = d;
          draw();
          say("Saved " + dayWords(n.nightOn) + ".", true);
        })
        .catch(function (e) {
          button.disabled = false;
          say(e.message, false);
        });
    }

    // A poster is a page behind the admin session, so it is fetched with the token and shown from
    // memory. The tab is opened at once, while the click still counts, so no pop up blocker stops it
    // (as app.js opens a fundraiser's materials).
    function openPoster(night, size) {
      var tab = win.open("", "_blank");
      try {
        if (tab) {
          tab.document.title = "Opening";
          tab.document.body.textContent = "Opening, one moment.";
        }
      } catch (e) {
        /* a tab we cannot write to still navigates */
      }
      return fetchFile(API + "/poster?night=" + encodeURIComponent(night) + "&size=" + size)
        .then(function (res) {
          return res.text();
        })
        .then(function (page) {
          var url = win.URL.createObjectURL(new win.Blob([page], { type: "text/html" }));
          if (tab && !tab.closed) tab.location.href = url;
          else win.open(url, "_blank");
          win.setTimeout(function () {
            win.URL.revokeObjectURL(url);
          }, 120000);
        })
        .catch(function () {
          if (tab && !tab.closed) tab.close();
          say(WORDS.poster, false);
        });
    }

    // The hand-out code is a file behind the admin session too, saved from here.
    function downloadQr() {
      return fetchFile(API + "/qr-handout")
        .then(function (res) {
          return res.blob();
        })
        .then(function (blob) {
          var url = win.URL.createObjectURL(blob);
          var a = doc.createElement("a");
          a.href = url;
          a.download = "santa-sleigh-qr.png";
          doc.body.appendChild(a);
          a.click();
          a.parentNode.removeChild(a);
          win.setTimeout(function () {
            win.URL.revokeObjectURL(url);
          }, 1000);
        })
        .catch(function () {
          say(WORDS.qr, false);
        });
    }

    /** Reads the section afresh: called by app.js whenever it is opened. */
    function open() {
      say(WORDS.loading, null);
      return ask("GET", API)
        .then(function (d) {
          data = d;
          say("", null);
          draw();
        })
        .catch(function (e) {
          say(e.message, false);
        });
    }

    // Shown already (app.js opened this section before this file had run): read it now.
    var app = doc.getElementById("appView");
    if (view && !view.hidden && (!app || !app.hidden)) open();

    return { open: open, say: say };
  }

  if (typeof module !== "undefined" && module.exports) module.exports = { initAdminSleigh: initAdminSleigh };
  else window.AdminSleigh = initAdminSleigh(document, window);
})();
