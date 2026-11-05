/* NBCC Elf Detective School: the enrol page (src/elf/pages/join.ts).
 *
 * The page works without this script: the form posts to /api/elf/join, which sends the browser on
 * to Stripe. This only makes it nicer:
 *   - one detective row to start, and "Add another detective" for the next, up to eight;
 *   - a "Spin" button beside each festive surname;
 *   - the suggested amount kept in step with the number of detectives, until someone types their own;
 *   - the Gift Aid declaration shown only when Gift Aid is ticked;
 *   - the form sent as JSON, with the server's own words shown when something needs another look;
 *   - the robot check's script loaded only when the page has one.
 *
 * Unit tested in test/unit/elf-js-join.test.ts.
 */
(function () {
  "use strict";

  function initJoin(doc, win, opts) {
    opts = opts || {};
    var go = opts.go || function (url) { win.location.assign(url); };
    var random = opts.random || Math.random;
    var form = doc.querySelector("form.elf-join-form");
    if (!form) return null;

    var rows = [].slice.call(form.querySelectorAll(".elf-join-detective"));
    var entry = form.querySelector('input[name="entry"]');
    var suggestedEach = Number(form.getAttribute("data-suggested-pence")) || 500;
    var typedOwn = false;

    function pounds(p) {
      return p % 100 === 0 ? String(p / 100) : (p / 100).toFixed(2);
    }
    function pence(typed) {
      var m = /^£?\s*(\d{1,7})(?:\.(\d{1,2}))?$/.exec(String(typed || "").trim());
      if (!String(typed || "").trim()) return 0;
      if (!m) return NaN;
      return Number(m[1]) * 100 + Number((m[2] || "0") + "0".repeat(2 - (m[2] || "0").length));
    }
    function shown() {
      return rows.filter(function (r) { return !r.hidden; });
    }
    function keepAmountInStep() {
      if (!typedOwn && entry) entry.value = pounds(suggestedEach * shown().length);
    }

    // ---- the detective rows --------------------------------------------------------------
    rows.forEach(function (row, i) {
      if (i > 0 && row.classList.contains("elf-join-detective--extra")) row.hidden = true;
      var select = row.querySelector("select");
      if (!select) return;
      var spin = doc.createElement("button");
      spin.type = "button";
      spin.className = "elf-btn elf-btn--s elf-join-spin";
      spin.textContent = "Spin";
      spin.setAttribute("aria-label", "Spin a festive surname for detective " + (i + 1));
      spin.addEventListener("click", function () {
        select.selectedIndex = Math.floor(random() * select.options.length);
        select.dispatchEvent(new win.Event("change", { bubbles: true }));
      });
      select.parentNode.appendChild(spin);
    });

    var add = doc.createElement("button");
    add.type = "button";
    add.className = "elf-btn elf-btn--s elf-join-add";
    add.textContent = "Add another detective";
    add.addEventListener("click", function () {
      var next = rows.filter(function (r) { return r.hidden; })[0];
      if (next) {
        next.hidden = false;
        var first = next.querySelector("input");
        if (first && first.focus) first.focus();
      }
      add.hidden = rows.every(function (r) { return !r.hidden; });
      keepAmountInStep();
    });
    var fieldset = form.querySelector(".elf-join-detectives");
    if (fieldset) fieldset.appendChild(add);
    add.hidden = rows.every(function (r) { return !r.hidden; });

    if (entry) {
      entry.addEventListener("input", function () { typedOwn = true; });
      keepAmountInStep();
    }

    // ---- Gift Aid ------------------------------------------------------------------------
    var giftAid = form.querySelector('input[name="giftAid"]');
    var declaration = form.querySelector(".elf-join-declaration");
    function showDeclaration() {
      if (declaration) declaration.hidden = !(giftAid && giftAid.checked);
    }
    if (giftAid) giftAid.addEventListener("change", showDeclaration);
    showDeclaration();

    // ---- the robot check -----------------------------------------------------------------
    if (doc.querySelector(".cf-turnstile") && !doc.querySelector('script[src*="challenges.cloudflare.com"]')) {
      var s = doc.createElement("script");
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
      s.async = true;
      s.defer = true;
      doc.head.appendChild(s);
    }

    // ---- sending -------------------------------------------------------------------------
    function field(name) {
      var el = form.querySelector('[name="' + name + '"]');
      if (!el) return "";
      if (el.type === "checkbox") return el.checked;
      return el.value;
    }
    function body() {
      var detectives = [];
      rows.forEach(function (row) {
        var first = row.querySelector("input");
        var select = row.querySelector("select");
        var name = first ? first.value.trim() : "";
        if (!row.hidden && name) detectives.push({ firstName: name, surname: select ? select.value : "" });
      });
      var b = {
        grownUpName: field("grownUpName"),
        email: field("email"),
        detectives: detectives,
        entryPence: pence(field("entry")),
        donationPence: pence(field("donation")),
        giftAid: !!field("giftAid"),
        coverFee: !!field("coverFee"),
        newsletter: !!field("newsletter"),
        agreed: !!field("agreed"),
        website: field("website") || ""
      };
      var token = field("cf-turnstile-response");
      if (token) b.captchaToken = token;
      if (b.giftAid) {
        b.declaration = {
          firstName: field("decl-firstName").trim() || undefined,
          lastName: field("decl-lastName").trim() || undefined,
          houseNameNumber: field("decl-houseNameNumber").trim() || undefined,
          address: field("decl-address").trim() || undefined,
          postcode: field("decl-postcode").trim() || undefined,
          nonUk: !!field("decl-nonUk")
        };
      }
      return b;
    }
    function showErrors(list) {
      var box = doc.querySelector(".elf-join-errors");
      if (!box) {
        box = doc.createElement("div");
        box.className = "elf-join-errors";
        box.setAttribute("role", "alert");
        box.tabIndex = -1;
        form.parentNode.insertBefore(box, form);
      }
      box.innerHTML = "";
      var h = doc.createElement("h2");
      h.className = "h-sm";
      h.textContent = "Please check these";
      var ul = doc.createElement("ul");
      list.forEach(function (words) {
        var li = doc.createElement("li");
        li.textContent = words;
        ul.appendChild(li);
      });
      box.appendChild(h);
      box.appendChild(ul);
      if (box.focus) box.focus();
    }

    var sending = false;
    var button = form.querySelector('button[type="submit"]');
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (sending) return;
      sending = true;
      if (button) button.disabled = true;
      win.fetch(form.getAttribute("data-api") || "/api/elf/join", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(body())
      })
        .then(function (r) {
          return r.json().then(function (data) { return { ok: r.ok, data: data || {} }; });
        })
        .then(function (res) {
          if (res.ok && res.data.url) return go(res.data.url);
          showErrors(res.data.errors && res.data.errors.length ? res.data.errors : ["Something went wrong. Please try again."]);
        })
        .catch(function () {
          showErrors(["We could not reach the website. Please check your connection and try again."]);
        })
        .then(function () {
          sending = false;
          if (button) button.disabled = false;
        });
    });

    return { form: form };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { initJoin: initJoin };
  } else {
    initJoin(document, window);
  }
})();
