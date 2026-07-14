// Business thank you page behaviour (TASK-212). Progressive enhancement, like main.js: a classic
// <script defer> that runs in the browser, and also exported under a CommonJS guard so it can be unit
// tested in jsdom (see test/unit/business-thank-you.test.ts).
//
// The page is private, token gated and SUBMIT ONCE. initBusinessThankYou reads the token from the URL
// (?token=…), GETs /api/business/fulfilment/:token and then either:
//   - shows the friendly error card (no token, or the link is not valid);
//   - renders the read only confirmation (the record was ALREADY submitted, so there is no edit form);
//   - reveals the capture form, hiding whichever recognition sections the supporter's band does not
//     earn, wiring the toggles that reveal each detail, and blocking submit until every shown question
//     is answered. On submit it POSTs ONCE and replaces the form with the confirmation.
(function () {
  "use strict";

  // Escape user sourced values (business name, credit name, handles) before they go into innerHTML.
  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // Title case a band name for the pill / lede ("platinum" -> "Platinum").
  function titleCase(s) {
    s = String(s || "");
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  }

  // The reveal value for each top level question (the answer that opens its detail).
  var REVEAL = { listOnSupporters: "yes", wantSocial: "yes", wantBadge: "yes", wantCertificate: "yes" };

  function initBusinessThankYou(doc, win) {
    var content = doc.getElementById("btyContent");
    if (!content) return; // not the business thank you page
    win = win || (doc && doc.defaultView) || window;

    var statusEl = doc.getElementById("btyStatus");
    var errorEl = doc.getElementById("btyError");
    var form = doc.getElementById("btyForm");
    var confirmEl = doc.getElementById("btyConfirm");

    function setStatus(msg) {
      if (statusEl) statusEl.textContent = msg || "";
    }
    function showError() {
      if (statusEl) statusEl.hidden = true;
      content.hidden = true;
      if (errorEl) errorEl.hidden = false;
    }

    // The token from the query string; no token means the link is unusable.
    var search = (win.location && win.location.search) || "";
    var m = search.match(/[?&]token=([^&]+)/);
    var token = m ? decodeURIComponent(m[1]) : "";
    if (!token) {
      showError();
      return;
    }

    var apiBase = "/api/business/fulfilment/" + encodeURIComponent(token);
    var state = { token: token, perks: null };

    // --- helpers over the form --------------------------------------------------------------------
    function radioValue(name) {
      var el = form.querySelector('input[name="' + name + '"]:checked');
      return el ? el.value : "";
    }
    function inputValue(id) {
      var el = doc.getElementById(id);
      return el && el.value ? el.value.trim() : "";
    }
    function detailFor(name) {
      // The detail block a top level question reveals shares the question's short key.
      var key = { listOnSupporters: "supporters", wantSocial: "social", wantBadge: "badge", wantCertificate: "certificate" }[name];
      return form.querySelector('[data-detail="' + key + '"]');
    }
    // Enable/disable every control inside a container (disabled controls are excluded from submit and
    // from validation). Clearing on hide keeps stale answers out of a later submit.
    function setDetailEnabled(detail, on) {
      if (!detail) return;
      detail.hidden = !on;
      var controls = detail.querySelectorAll("input, textarea, select");
      for (var i = 0; i < controls.length; i++) {
        controls[i].disabled = !on;
        if (!on) {
          if (controls[i].type === "radio" || controls[i].type === "checkbox") controls[i].checked = false;
          else controls[i].value = "";
        }
      }
      // Hiding a detail also hides any detail nested inside it.
      if (!on) {
        var nested = detail.querySelectorAll(".bty-detail");
        for (var j = 0; j < nested.length; j++) setDetailEnabled(nested[j], false);
      }
    }

    // Wire one top level question: revealing its detail on the reveal answer, hiding it otherwise.
    function wireQuestion(name) {
      var radios = form.querySelectorAll('input[name="' + name + '"]');
      var detail = detailFor(name);
      setDetailEnabled(detail, false);
      for (var i = 0; i < radios.length; i++) {
        radios[i].addEventListener("change", function () {
          setDetailEnabled(detail, radioValue(name) === REVEAL[name]);
        });
      }
    }

    // The certificate delivery sub question reveals the address only for "Post it to me".
    function wireCertificateDelivery() {
      var radios = form.querySelectorAll('input[name="certificateDelivery"]');
      var addr = form.querySelector('[data-detail="certificateAddress"]');
      setDetailEnabled(addr, false);
      for (var i = 0; i < radios.length; i++) {
        radios[i].addEventListener("change", function () {
          setDetailEnabled(addr, radioValue("certificateDelivery") === "post");
        });
      }
    }

    // Hide a whole recognition section the band does not earn: disabling the fieldset removes its
    // radios from validation and submission entirely.
    function hideSection(id) {
      var fs = doc.getElementById(id);
      if (!fs) return;
      fs.hidden = true;
      fs.disabled = true;
    }

    // --- validation (explicit, not reliant on native constraint validation) ----------------------
    // Returns the first unanswered/blocked field's message, or "" when every shown question is done.
    function firstError() {
      if (!radioValue("listOnSupporters")) return "Please answer the Supporters page question.";
      if (radioValue("listOnSupporters") === "yes" && !inputValue("btyCreditName")) {
        return "Please tell us how your business name should appear.";
      }
      if (state.perks && state.perks.socialThankYou && !radioValue("wantSocial")) {
        return "Please answer the social media thank you question.";
      }
      if (state.perks && state.perks.digitalBadge && !radioValue("wantBadge")) {
        return "Please answer the digital badge question.";
      }
      if (state.perks && state.perks.certificate) {
        if (!radioValue("wantCertificate")) return "Please answer the certificate question.";
        if (radioValue("wantCertificate") === "yes") {
          if (!radioValue("certificateDelivery")) return "Please choose how to receive your certificate.";
          if (radioValue("certificateDelivery") === "post") {
            if (!inputValue("btyAddr1")) return "Please add the first line of your address.";
            if (!inputValue("btyTown")) return "Please add your town or city.";
            if (!inputValue("btyPostcode")) return "Please add your postcode.";
          }
        }
      }
      return "";
    }

    // Assemble the POST body from the answered questions, sending only what each Yes needs.
    function buildBody() {
      var listed = radioValue("listOnSupporters") === "yes";
      var body = { listOnSupporters: listed };
      if (listed) {
        body.creditName = inputValue("btyCreditName");
        if (inputValue("btyWebsite")) body.website = inputValue("btyWebsite");
      }
      if (state.perks && state.perks.socialThankYou) {
        body.wantSocial = radioValue("wantSocial") === "yes";
        if (body.wantSocial && inputValue("btySocials")) body.socials = inputValue("btySocials");
      }
      if (state.perks && state.perks.digitalBadge) {
        body.wantBadge = radioValue("wantBadge") === "yes";
      }
      if (state.perks && state.perks.certificate) {
        body.wantCertificate = radioValue("wantCertificate") === "yes";
        if (body.wantCertificate) {
          body.certificateDelivery = radioValue("certificateDelivery");
          if (body.certificateDelivery === "post") {
            body.addressLine1 = inputValue("btyAddr1");
            if (inputValue("btyAddr2")) body.addressLine2 = inputValue("btyAddr2");
            body.town = inputValue("btyTown");
            body.postcode = inputValue("btyPostcode");
          }
        }
      }
      return body;
    }

    // --- rendering ---------------------------------------------------------------------------------
    // Fill the greeting header from the record.
    function renderHead(data) {
      var nameEl = doc.getElementById("btyName");
      if (nameEl) nameEl.textContent = data.businessName || "friend";
      var band = titleCase(data.band);
      var bandWrap = doc.getElementById("btyBand");
      var bandLabel = doc.getElementById("btyBandLabel");
      if (band && bandWrap && bandLabel) {
        bandLabel.textContent = band + " business supporter";
        bandWrap.hidden = false;
      }
      var lede = doc.getElementById("btyLede");
      if (lede && band) {
        lede.textContent =
          "Your monthly donation makes you a " + band +
          " supporter of the Night Before Christmas Campaign. Here is how we would like to say thank you.";
      }
    }

    // Prepare the form for the band: hide the sections it does not earn, wire the toggles, reveal it.
    function renderForm(data) {
      state.perks = data.perks || {};
      if (!state.perks.socialThankYou) hideSection("btyRecSocial");
      if (!state.perks.digitalBadge) hideSection("btyRecBadge");
      if (!state.perks.certificate) hideSection("btyRecCertificate");

      wireQuestion("listOnSupporters");
      if (state.perks.socialThankYou) wireQuestion("wantSocial");
      if (state.perks.digitalBadge) wireQuestion("wantBadge");
      if (state.perks.certificate) {
        wireQuestion("wantCertificate");
        wireCertificateDelivery();
      }

      var statusMsg = doc.getElementById("btyFormStatus");
      var submitting = false;
      form.addEventListener("submit", function (ev) {
        if (ev && ev.preventDefault) ev.preventDefault();
        if (submitting) return;
        var err = firstError();
        if (err) {
          if (statusMsg) statusMsg.textContent = err;
          return;
        }
        if (statusMsg) statusMsg.textContent = "";
        if (typeof win.fetch !== "function") return;
        submitting = true;
        var submitBtn = doc.getElementById("btySubmit");
        if (submitBtn) submitBtn.disabled = true;
        return win
          .fetch(apiBase, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(buildBody()),
          })
          .then(function (res) {
            if (res && res.ok) {
              return res.json().then(function (saved) {
                renderConfirmation(saved);
              });
            }
            if (res && res.status === 409) {
              // Already submitted (a second submit or a race): show the saved confirmation.
              return win
                .fetch(apiBase)
                .then(function (r) { return r.ok ? r.json() : null; })
                .then(function (fresh) {
                  if (fresh) renderConfirmation(fresh);
                  else if (statusMsg) statusMsg.textContent = "You have already sent us your choices. Thank you.";
                });
            }
            submitting = false;
            if (submitBtn) submitBtn.disabled = false;
            if (statusMsg) statusMsg.textContent = "We could not save your choices just now. Please try again.";
          })
          .catch(function () {
            submitting = false;
            if (submitBtn) submitBtn.disabled = false;
            if (statusMsg) statusMsg.textContent = "We could not save your choices just now. Please try again.";
          });
      });

      if (form) form.hidden = false;
      if (confirmEl) confirmEl.hidden = true;
    }

    // Build the read only confirmation from the saved preferences + perks, including the download
    // links the supporter is entitled to.
    function renderConfirmation(data) {
      var perks = data.perks || {};
      var prefs = data.preferences || {};
      var items = [];

      if (prefs.listOnSupporters) {
        items.push(
          prefs.creditName
            ? "We will show your business on our Supporters page as " + escapeHtml(prefs.creditName) + "."
            : "We will show your business on our Supporters page.",
        );
      } else {
        items.push("We will keep your business details private.");
      }

      if (perks.socialThankYou) {
        if (prefs.wantSocial) {
          items.push(
            prefs.socials
              ? "We will post a public thank you on Facebook and Instagram and tag " + escapeHtml(prefs.socials) + "."
              : "We will post a public thank you on Facebook and Instagram.",
          );
        } else {
          items.push("No social media thank you, just as you asked.");
        }
      }
      if (perks.digitalBadge) {
        items.push(prefs.wantBadge ? "Your digital supporter badge is ready." : "No digital badge, just as you asked.");
      }
      if (perks.certificate) {
        if (prefs.wantCertificate) {
          items.push(
            prefs.certificateDelivery === "post"
              ? "We will post your certificate to you, and you can download it here too."
              : "Your certificate is ready to download.",
          );
        } else {
          items.push("No certificate, just as you asked.");
        }
      }

      var links = [];
      if (perks.digitalBadge && prefs.wantBadge) {
        links.push('<a class="btn btn-primary" href="/assets/img/nbcc-supporter-badge.svg" download>Download your badge</a>');
      }
      if (perks.certificate && prefs.wantCertificate) {
        links.push(
          '<a class="btn btn-primary" href="/business/certificate/' +
            encodeURIComponent(state.token) +
            '" target="_blank" rel="noopener">Download your certificate</a>',
        );
      }

      var html =
        '<h2 class="bty-confirm-title">You are all set. Thank you, ' + escapeHtml(data.businessName || "friend") + ".</h2>" +
        '<p class="bty-confirm-lede">Here is what you chose. We get straight to work now.</p>' +
        '<ul class="bty-confirm-list">' +
        items.map(function (t) { return "<li>" + t + "</li>"; }).join("") +
        "</ul>" +
        (links.length ? '<div class="bty-actions bty-confirm-links">' + links.join("") + "</div>" : "") +
        (links.length
          ? '<p class="bty-confirm-note">We have also emailed these links to you, so you can come back to them any time.</p>'
          : "") +
        '<p class="bty-confirm-note">You will also receive our supporter newsletter. If anything changes later, just email giving@nbcc.scot.</p>';

      if (confirmEl) {
        confirmEl.innerHTML = html;
        confirmEl.hidden = false;
      }
      if (form) form.hidden = true;
      var heading = confirmEl && confirmEl.querySelector("h2");
      if (heading && heading.focus) {
        heading.setAttribute("tabindex", "-1");
        heading.focus();
      }
    }

    function reveal() {
      if (statusEl) statusEl.hidden = true;
      if (errorEl) errorEl.hidden = true;
      content.hidden = false;
    }

    // --- load --------------------------------------------------------------------------------------
    setStatus("Loading your thank you page…");
    if (typeof win.fetch !== "function") {
      showError();
      return;
    }
    win
      .fetch(apiBase)
      .then(function (res) {
        if (!res || !res.ok) {
          showError();
          return null;
        }
        return res.json();
      })
      .then(function (data) {
        if (!data) return;
        renderHead(data);
        if (data.captured) {
          state.perks = data.perks || {};
          reveal();
          renderConfirmation(data);
        } else {
          reveal();
          renderForm(data);
        }
      })
      .catch(function () {
        showError();
      });
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { initBusinessThankYou: initBusinessThankYou };
  } else {
    initBusinessThankYou(document, window);
  }
})();
