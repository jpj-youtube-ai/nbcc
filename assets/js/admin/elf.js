/* NBCC Elf Detective School in the admin: Get involved > Settings (admin.html, #elfAdmin).
 *
 * The switch (admins only: switching it on puts the school live), the pay what you can amounts for
 * each detective, and the paid sign ups so far. Talks to /api/admin/elf/* (src/routes/admin-elf.ts).
 * Status words use is-ok and is-error, never .err, which the public stylesheet hides.
 *
 * Unit tested in test/unit/admin-elf-js.test.ts.
 */
(function () {
  "use strict";

  var TOKEN_KEY = "nbcc_admin_token";

  function initElfAdmin(doc, win, opts) {
    opts = opts || {};
    var confirmIt = opts.confirm || function (q) { return win.confirm(q); };
    var box = doc.getElementById("elfAdmin");
    if (!box) return null;
    var state = doc.getElementById("elfAdminState");
    var settings = null;

    function token() {
      try {
        return win.sessionStorage.getItem(TOKEN_KEY);
      } catch (e) {
        return null;
      }
    }
    function ask(method, path, body) {
      var o = { method: method, headers: { Authorization: "Bearer " + token() } };
      if (body !== undefined) {
        o.headers["Content-Type"] = "application/json";
        o.body = JSON.stringify(body);
      }
      return win.fetch(path, o).then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok) throw new Error((data && data.error) || "Something went wrong. Please try again.");
          return data;
        });
      });
    }
    function pounds(p) {
      return "£" + (p % 100 === 0 ? String(p / 100) : (p / 100).toFixed(2));
    }
    function pence(typed) {
      var m = /^£?\s*(\d{1,4})(?:\.(\d{1,2}))?$/.exec(String(typed || "").trim());
      if (!m) return NaN;
      var p = m[2] || "0";
      return Number(m[1]) * 100 + Number(p.length === 1 ? p + "0" : p);
    }
    function el(tag, attrs, text) {
      var e = doc.createElement(tag);
      Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
      if (text !== undefined) e.textContent = text;
      return e;
    }
    function say(words, ok) {
      if (!state) return;
      state.textContent = words;
      state.className = "elf-admin-state " + (ok ? "is-ok" : "is-error");
    }

    var parts = el("div", { class: "elf-admin-parts" });
    box.appendChild(parts);

    function draw(signups) {
      parts.innerHTML = "";
      var on = settings.schoolOn;
      var switchLine = el("p", { class: "elf-admin-switch" });
      switchLine.appendChild(el("b", {}, on ? "Switched on: " : "Switched off: "));
      switchLine.appendChild(doc.createTextNode(on ? "nbcc.scot/elf is live, and families can enrol." : "nothing is on the website yet."));
      parts.appendChild(switchLine);
      var btn = el("button", { class: "btn", type: "button", id: "elfAdminSwitch" }, on ? "Switch the school off" : "Switch the school on");
      btn.addEventListener("click", function () {
        var q = on ? "Switch Elf Detective School off? nbcc.scot/elf will disappear." : "Switch Elf Detective School on? nbcc.scot/elf goes live and families can enrol and pay.";
        if (!confirmIt(q)) return;
        btn.disabled = true;
        ask("PATCH", "/api/admin/elf/settings", { schoolOn: !on })
          .then(function (d) {
            settings = d.settings;
            say(settings.schoolOn ? "Switched on." : "Switched off.", true);
            draw(signups);
          })
          .catch(function (e) { say(e.message, false); btn.disabled = false; });
      });
      parts.appendChild(btn);

      // The private preview link (Jaimie, 3 November 2026): click through the real pages while the
      // school is switched off. Making a new link ends the old one.
      if (!on) {
        var preview = el("div", { class: "elf-admin-preview" });
        preview.appendChild(el("h4", {}, "Private preview"));
        preview.appendChild(
          el("p", {}, settings.previewOn
            ? "A preview link is open. Anyone who has it can see the school. Payments in the preview are real."
            : "Make a link to click through the real pages while the school is switched off. Payments in the preview are real.")
        );
        var make = el("button", { class: "btn", type: "button", id: "elfAdminPreview" }, settings.previewOn ? "Make a new preview link" : "Make a preview link");
        make.addEventListener("click", function () {
          make.disabled = true;
          ask("POST", "/api/admin/elf/preview")
            .then(function (d) {
              settings.previewOn = true;
              draw(signups);
              var row = el("p", {});
              row.appendChild(el("label", { for: "elfAdminPreviewLink" }, "Your preview link (shown once: copy it now)"));
              var link = el("input", { id: "elfAdminPreviewLink", type: "text", readonly: "readonly" });
              link.value = d.url;
              row.appendChild(link);
              var box2 = doc.querySelector(".elf-admin-preview");
              if (box2) box2.appendChild(row);
              say("Preview link made. Making another ends this one.", true);
            })
            .catch(function (e) { say(e.message, false); make.disabled = false; });
        });
        preview.appendChild(make);
        if (settings.previewOn) {
          var end = el("button", { class: "btn", type: "button", id: "elfAdminPreviewEnd" }, "End the preview link");
          end.addEventListener("click", function () {
            ask("DELETE", "/api/admin/elf/preview")
              .then(function () {
                settings.previewOn = false;
                say("Preview link ended.", true);
                draw(signups);
              })
              .catch(function (e) { say(e.message, false); });
          });
          preview.appendChild(end);
        }
        parts.appendChild(preview);
      }

      var form = el("form", { id: "elfAdminPrices", class: "elf-admin-prices" });
      form.appendChild(el("h4", {}, "Pay what you can, for each detective"));
      [["elfAdminFrom", "The least a family pays", settings.entryFromPence], ["elfAdminSuggested", "What we suggest", settings.entrySuggestedPence]].forEach(function (f) {
        var row = el("p", {});
        row.appendChild(el("label", { for: f[0] }, f[1] + " (now " + pounds(f[2]) + ")"));
        var input = el("input", { id: f[0], type: "text", inputmode: "decimal", maxlength: "7" });
        input.value = pounds(f[2]).slice(1);
        row.appendChild(input);
        form.appendChild(row);
      });
      form.appendChild(el("button", { class: "btn", type: "submit" }, "Save the amounts"));
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var from = pence(doc.getElementById("elfAdminFrom").value);
        var suggested = pence(doc.getElementById("elfAdminSuggested").value);
        if (isNaN(from) || isNaN(suggested)) return say("Please put the amounts in pounds, like 5 or 2.50.", false);
        ask("PATCH", "/api/admin/elf/settings", { entryFromPence: from, entrySuggestedPence: suggested })
          .then(function (d) {
            settings = d.settings;
            say("Saved.", true);
            draw(signups);
          })
          .catch(function (er) { say(er.message, false); });
      });
      parts.appendChild(form);

      if (signups) {
        parts.appendChild(el("h4", {}, "Sign ups so far"));
        parts.appendChild(
          el(
            "p",
            {},
            signups.families + (signups.families === 1 ? " family, " : " families, ") +
              signups.detectives + (signups.detectives === 1 ? " detective. " : " detectives. ") +
              "Entries " + pounds(signups.entryPence) + ", gifts " + pounds(signups.donationPence) +
              " (" + pounds(signups.giftAidPence) + " of it with Gift Aid)."
          )
        );
        if (signups.recent.length) {
          var ul = el("ul", { class: "elf-admin-recent" });
          signups.recent.forEach(function (r) {
            ul.appendChild(el("li", {}, r.grownUpName + ": " + r.detectives.join(", ") + " (" + r.reference + ")"));
          });
          parts.appendChild(ul);
        }
      }
    }

    function load() {
      return Promise.all([ask("GET", "/api/admin/elf/settings"), ask("GET", "/api/admin/elf/signups").catch(function () { return null; })])
        .then(function (r) {
          settings = r[0].settings;
          say(settings.schoolOn ? "Switched on." : "Switched off.", true);
          draw(r[1]);
        })
        .catch(function (e) { say(e.message, false); });
    }

    // Read afresh each time Get involved > Settings is opened.
    doc.addEventListener("click", function (e) {
      var t = e.target && e.target.closest ? e.target.closest('[data-gi-section="settings"]') : null;
      if (t) load();
    });

    return { load: load };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { initElfAdmin: initElfAdmin };
  } else {
    document.addEventListener("DOMContentLoaded", function () { initElfAdmin(document, window); });
  }
})();
