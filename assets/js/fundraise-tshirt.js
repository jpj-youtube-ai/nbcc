// Choosing a T-shirt size at /fundraise/t-shirt (the sign up tidy, Jaimie, 2026-10-03).
//
// Opened from the email staff send from Admin > Fundraising when a sporting event's sign up has no
// size yet. The link is /fundraise/t-shirt#<token>: after the #, so the token is never sent to a
// server as part of an address. This script takes it out of the address bar at once, asks
// POST /api/fundraise/tshirt/look who it is for (their first name, the fundraiser's name and the
// sizes), offers the sizes with nothing chosen, and saves the choice with POST /api/fundraise/tshirt.
// A link that is not there, used or more than 60 days old shows a kind panel instead.
//
// Its own file, never main.js (donate.html's page weight budget). A classic <script defer>, exported
// under a CommonJS guard so it can be unit tested in jsdom.
(function () {
  "use strict";

  var FAILED = "We could not save that just now. Please try again in a moment, or email events@nbcc.scot.";

  function initTshirtPage(doc, win) {
    var form = doc.getElementById("tshirtForm");
    if (!form) return null;
    var select = doc.getElementById("tshirtSize");
    var gone = doc.querySelector("[data-tshirt-gone]");
    var loading = doc.querySelector("[data-tshirt-loading]");
    var thanks = doc.querySelector("[data-tshirt-thanks]");
    var status = doc.getElementById("formStatus");
    var submitBtn = form.querySelector("[data-submit]");
    var labels = {};
    var sending = false;

    Array.prototype.forEach.call(doc.querySelectorAll("[data-nojs]"), function (n) {
      n.hidden = true;
    });

    function say(text, kind) {
      if (!status) return;
      status.textContent = text;
      status.className = "form-status" + (kind ? " is-" + kind : "");
    }
    function show(panel) {
      [form, gone, thanks, loading].forEach(function (p) {
        if (p) p.hidden = p !== panel;
      });
      if (panel && panel !== form && panel !== loading) {
        try {
          panel.focus();
        } catch (e) {
          /* focus unavailable */
        }
      }
    }

    // The token, from after the #, and out of the address bar and the history at once.
    var match = /^#([A-Za-z0-9_-]{43})$/.exec((win.location && win.location.hash) || "");
    var token = match ? match[1] : null;
    if (win.location && win.location.hash && win.history && typeof win.history.replaceState === "function") {
      try {
        win.history.replaceState(win.history.state, "", (win.location.pathname || "/fundraise/t-shirt") + (win.location.search || ""));
      } catch (e) {
        /* The address stays as it was. */
      }
    }
    if (!token || typeof win.fetch !== "function") {
      show(gone);
      return { token: null };
    }

    function post(url, body) {
      return win
        .fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
        .then(function (res) {
          return res.json().then(
            function (data) {
              return { status: res.status, data: data || {} };
            },
            function () {
              return { status: res.status, data: {} };
            },
          );
        });
    }

    function offer(sizes) {
      var groups = { kids: null, adult: null };
      var names = { kids: "Kids", adult: "Adults" };
      (sizes || []).forEach(function (s) {
        if (!s || typeof s.key !== "string" || typeof s.label !== "string") return;
        var which = s.key.indexOf("kids_") === 0 ? "kids" : "adult";
        if (!groups[which]) {
          groups[which] = doc.createElement("optgroup");
          groups[which].label = names[which];
          select.appendChild(groups[which]);
        }
        var o = doc.createElement("option");
        o.value = s.key;
        o.textContent = s.label;
        groups[which].appendChild(o);
        labels[s.key] = s.label;
      });
    }

    show(loading);
    post("/api/fundraise/tshirt/look", { token: token })
      .then(function (r) {
        if (r.status !== 200) return show(gone);
        offer(r.data.sizes);
        var first = typeof r.data.firstName === "string" ? r.data.firstName.trim() : "";
        var nameSlot = doc.querySelector("[data-tshirt-name]");
        if (nameSlot) nameSlot.textContent = first ? ", " + first : "";
        var thanksName = doc.querySelector("[data-thanks-name]");
        if (thanksName) thanksName.textContent = first ? ", " + first : "";
        var lede = doc.querySelector("[data-tshirt-lede]");
        if (lede && typeof r.data.title === "string" && r.data.title) {
          lede.textContent = "As " + r.data.title + " is a sporting event, we’d love to send you an NBCC T-shirt with your welcome pack.";
        }
        show(form);
      })
      .catch(function () {
        show(gone);
      });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (sending) return;
      say("", null);
      var shared = win.NBCCFormValidation;
      if (shared && typeof shared.validateForm === "function") {
        if (!shared.validateForm(form, { summary: doc.createElement("p") }).valid) return;
      } else if (!select.value) {
        say("Please choose a T-shirt size.", "error");
        return;
      }
      sending = true;
      if (submitBtn) submitBtn.disabled = true;
      say("Saving…", "pending");
      var size = select.value;
      post("/api/fundraise/tshirt", { token: token, tshirtSize: size })
        .then(function (r) {
          sending = false;
          if (submitBtn) submitBtn.disabled = false;
          if (r.status === 200) {
            say("", null);
            var slot = doc.querySelector("[data-thanks-size]");
            if (slot) slot.textContent = labels[size] || "";
            return show(thanks);
          }
          if (r.status === 404) return show(gone);
          var message = r.status === 400 && r.data.fields && r.data.fields.tshirtSize ? r.data.fields.tshirtSize : r.data.error || FAILED;
          say(message, "error");
        })
        .catch(function () {
          sending = false;
          if (submitBtn) submitBtn.disabled = false;
          say(FAILED, "error");
        });
    });

    return { token: token };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { initTshirtPage: initTshirtPage };
  } else {
    initTshirtPage(document, window);
  }
})();
