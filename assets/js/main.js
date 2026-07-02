// Charity Site — shared page script (REQ-001 scaffold; nav behaviour REQ-002).
//
// Progressive enhancement only: the pages work without JS. `initNav` wires the
// sticky nav's scroll state and the mobile burger menu. It is written as a
// classic <script defer> that runs in the browser, but is also exported under a
// CommonJS guard so it can be unit-tested in jsdom (see test/unit/nav.test.ts).
(function () {
  "use strict";

  function initNav(doc, win) {
    doc.documentElement.dataset.js = "ready";

    var nav = doc.getElementById("nav");
    if (!nav) return;

    // Scroll state: transparent over-hero by default, cream/hairline/shadow once
    // scrolled past 24px. passive listener + rAF throttle keeps scrolling smooth.
    var ticking = false;
    function apply() {
      nav.classList.toggle("scrolled", (win.scrollY || 0) > 24);
      ticking = false;
    }
    function onScroll() {
      if (!ticking) {
        ticking = true;
        win.requestAnimationFrame(apply);
      }
    }
    apply();
    win.addEventListener("scroll", onScroll, { passive: true });

    // Mobile burger: toggle the link panel and reflect state on the button.
    var burger = doc.getElementById("burger");
    if (!burger) return;
    burger.addEventListener("click", function () {
      var open = nav.classList.toggle("open");
      burger.setAttribute("aria-expanded", String(open));
    });
    // Focus management: Escape closes the menu and returns focus to the burger.
    doc.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && nav.classList.contains("open")) {
        nav.classList.remove("open");
        burger.setAttribute("aria-expanded", "false");
        burger.focus();
      }
    });
  }

  // Scroll reveal (REQ-008): add .is-visible to .reveal elements as they enter
  // the viewport. Falls back to revealing everything immediately when reduced
  // motion is requested or IntersectionObserver is unavailable (REQ-032), so
  // content is never left hidden.
  function initReveal(doc, win) {
    var reveals = doc.querySelectorAll(".reveal");
    var reduced =
      typeof win.matchMedia === "function" &&
      win.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || !win.IntersectionObserver) {
      reveals.forEach(function (el) {
        el.classList.add("is-visible");
      });
      return;
    }
    var io = new win.IntersectionObserver(
      function (entries, obs) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            obs.unobserve(entry.target);
          }
        });
      },
      { rootMargin: "0px 0px -10% 0px" },
    );
    reveals.forEach(function (el) {
      io.observe(el);
    });
  }

  // Give widget once/monthly toggle (REQ-020): the segmented control switches
  // which tier group is visible. Progressive enhancement — the markup ships
  // with "give monthly" pressed and #tiersOnce hidden, so it works without JS;
  // this just wires the buttons. Native <button>s give keyboard activation for
  // free, and no animation is required (reduced-motion safe).
  // Declaration scope default from the give mode (REQ-044): a monthly gift defaults to
  // an enduring all-donations declaration, a one-off to this donation only. Front-end
  // only — mirrors declarationScopeForMode in src/declarations/wording.ts but yields the
  // declarations.scope column values ('all_donations' / 'this_donation').
  function scopeForGiveMode(mode) {
    return mode === "monthly" ? "all_donations" : "this_donation";
  }

  // Check the declaration-scope radio matching the give mode's default — UNLESS the donor
  // has already picked a scope (the field is marked data-touched), in which case their
  // choice sticks through later mode switches. No-op if the scope control is absent.
  function syncDeclScope(doc, mode) {
    var field = doc.getElementById("declScopeField");
    if (!field || field.dataset.touched === "true") return;
    var scope = scopeForGiveMode(mode);
    Array.prototype.forEach.call(doc.querySelectorAll('input[name="declScope"]'), function (r) {
      r.checked = r.value === scope;
    });
  }

  function initGiveToggle(doc) {
    var toggle = doc.querySelector(".give-toggle");
    if (!toggle) return;
    var buttons = Array.prototype.slice.call(toggle.querySelectorAll(".give-mode"));
    if (!buttons.length) return;

    function activate(mode) {
      buttons.forEach(function (btn) {
        var on = btn.getAttribute("data-mode") === mode;
        btn.setAttribute("aria-pressed", String(on));
        btn.classList.toggle("is-active", on);
        var panel = doc.getElementById(btn.getAttribute("aria-controls"));
        if (panel) panel.hidden = !on;
      });
      // Gift Aid declaration (REQ-042): the visible verbatim HMRC statement the
      // opt-in tick agrees to tracks the give mode — the single-donation wording
      // for once, the all-donations wording for monthly. No-op if the callout was
      // removed via the gating switch (empty NodeList).
      Array.prototype.forEach.call(doc.querySelectorAll(".giftaid-statement"), function (el) {
        el.hidden = el.getAttribute("data-mode") !== mode;
      });
      // Age confirmation (REQ-039): monthly giving is set up by adults 18 or over, so
      // the 18+ confirmation shows only in give-monthly mode (its .give-age[hidden]
      // rule collapses the flex row). No-op if the field is absent.
      var ageField = doc.getElementById("ageConfirmField");
      if (ageField) ageField.hidden = mode !== "monthly";
      // Declaration scope (REQ-044): re-sync the scope default to the new mode (unless
      // the donor has already picked one).
      syncDeclScope(doc, mode);
    }

    buttons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        activate(btn.getAttribute("data-mode"));
      });
    });

    // Sync visible state to the button marked pressed in the markup (monthly).
    var start =
      buttons.filter(function (b) {
        return b.getAttribute("aria-pressed") === "true";
      })[0] || buttons[0];
    activate(start.getAttribute("data-mode"));
  }

  // Donor-type routing (REQ-038): the individual/business question at the top of
  // the give widget. Native radios, progressive enhancement — individual is the
  // default in the markup, so the Gift Aid path works without JS. Choosing "A
  // business" hides and unticks the #giftAid callout (an incorporated company
  // cannot claim Gift Aid) and reveals the optional business-name field;
  // "Individual" restores the callout and hides the field. The business-name field
  // is a Donors Page display label ONLY and never switches the path — the path is
  // driven solely by this choice. On wiring, the control is marked data-ready so
  // startCheckout knows the enhancement is active and folds donorType into the
  // REQ-028 payload (without JS it emits the base { mode, plan, amount, giftAid }).
  // The donor path drives Gift Aid and which declaration capture applies (REQ-038/REQ-051):
  // an individual (single declaration, Gift Aid), an incorporated company (no Gift Aid) or a
  // business partnership (one declaration per partner, Gift Aid kept). Derived from the
  // donor-type + business-type radios; defaults to individual when the control is absent.
  function currentDonorPath(doc) {
    var donorRadio = doc.querySelector('input[name="donorType"]:checked');
    if (!donorRadio || donorRadio.value !== "business") return "individual";
    var typeRadio = doc.querySelector('input[name="businessType"]:checked');
    return typeRadio && typeRadio.value === "partnership" ? "partnership" : "company";
  }

  function initDonorType(doc) {
    var control = doc.querySelector(".give-donor");
    if (!control) return;
    var radios = Array.prototype.slice.call(
      control.querySelectorAll('input[name="donorType"], input[name="businessType"]'),
    );
    if (!radios.length) return;

    var giftAidRegion = doc.querySelector(".giftaid");
    var giftAidBox = doc.getElementById("giftAid");
    var businessField = doc.getElementById("businessNameField");
    var businessTypeField = doc.getElementById("businessTypeField");
    var declaration = doc.querySelector(".give-declaration");
    var partners = doc.querySelector(".give-partners");

    function apply() {
      var donorRadio = control.querySelector('input[name="donorType"]:checked');
      var isBusiness = !!(donorRadio && donorRadio.value === "business");
      var path = currentDonorPath(doc);
      // The business-name field and the company/partnership sub-type question are only
      // relevant to a business donor.
      if (businessField) businessField.hidden = !isBusiness;
      if (businessTypeField) businessTypeField.hidden = !isBusiness;
      // Gift Aid is available to individuals and to partnerships (partners are
      // individuals in law); only an incorporated company takes the no Gift Aid path,
      // so hide and clear the callout there.
      var noGiftAid = path === "company";
      if (giftAidRegion) giftAidRegion.hidden = noGiftAid;
      if (noGiftAid && giftAidBox) giftAidBox.checked = false;
      // The single declaration is the individual path; the partnership captures one
      // declaration per partner in .give-partners instead.
      if (declaration) declaration.hidden = path !== "individual";
      if (partners) partners.hidden = path !== "partnership";
    }

    radios.forEach(function (btn) {
      btn.addEventListener("change", function () {
        if (btn.checked) apply();
      });
    });

    // Sync to the radios marked checked in the markup (individual by default).
    apply();

    // Signal the enhancement is wired; startCheckout only folds donorType in then.
    control.dataset.ready = "true";
  }

  // Contact capture (REQ-039): the consent-based contact fieldset below the donor-type
  // question. Progressive enhancement — the fields are plain inputs that work without
  // JS; this only marks the fieldset data-ready so startCheckout knows the enhancement
  // is active and folds fullName, email, emailConsent, anonymous and (monthly)
  // ageConfirmed into the REQ-028 payload (without JS the base { mode, plan, amount,
  // giftAid } contract is emitted unchanged). The 18+ row's monthly-only visibility is
  // owned by initGiveToggle, which tracks the give mode.
  function initContactCapture(doc) {
    var control = doc.querySelector(".give-contact");
    if (!control) return;
    control.dataset.ready = "true";
  }

  // Gift Aid declaration capture (REQ-043): the HMRC declaration fieldset below the Gift
  // Aid callout. Progressive enhancement — the fields are plain inputs that work without
  // JS. This wires the non-UK checkbox (a donor outside the UK has no UK postcode, so it
  // hides, disables and un-requires the postcode) and marks the fieldset data-ready, so
  // startCheckout folds a `declaration` object into the payload — but ONLY when Gift Aid
  // is opted in, since that is the only time a declaration is made. Without JS the base
  // { mode, plan, amount, giftAid } contract is unchanged.
  function initDeclarationCapture(doc) {
    var control = doc.querySelector(".give-declaration");
    if (!control) return;

    var nonUkBox = doc.getElementById("declNonUk");
    var postcodeField = doc.getElementById("declPostcodeField");
    var postcodeInput = doc.getElementById("declPostcode");

    function applyNonUk() {
      var nonUk = !!(nonUkBox && nonUkBox.checked);
      if (postcodeField) postcodeField.hidden = nonUk;
      if (postcodeInput) {
        postcodeInput.disabled = nonUk;
        if (nonUk) {
          postcodeInput.removeAttribute("required");
          postcodeInput.removeAttribute("aria-required");
        } else {
          postcodeInput.setAttribute("required", "");
          postcodeInput.setAttribute("aria-required", "true");
        }
      }
    }

    if (nonUkBox) nonUkBox.addEventListener("change", applyNonUk);
    applyNonUk(); // sync to the shipped state (UK by default)

    // Declaration scope (REQ-044): default the radio from the current give mode, and mark
    // the control touched once the donor picks a scope so later mode switches stop
    // re-syncing it (initGiveToggle honours the same flag).
    var scopeField = doc.getElementById("declScopeField");
    if (scopeField) {
      var pressed = doc.querySelector('.give-mode[aria-pressed="true"]');
      syncDeclScope(doc, pressed ? pressed.getAttribute("data-mode") : "monthly");
      Array.prototype.forEach.call(doc.querySelectorAll('input[name="declScope"]'), function (r) {
        r.addEventListener("change", function () {
          scopeField.dataset.touched = "true";
        });
      });
    }

    control.dataset.ready = "true";
  }

  // Partnership declaration capture (REQ-051): the repeatable .give-partners fieldset on the
  // partnership path. Clones #partnerRowTemplate into one row on load, wires add/remove, gives
  // each row a unique id base so every label[for]/input id stays matched (REQ-032), and mirrors
  // the declaration's non-UK postcode toggle. Marks data-ready so startCheckout folds a
  // `partners` array only on the partnership path with Gift Aid.
  function initPartnershipCapture(doc) {
    var control = doc.querySelector(".give-partners");
    if (!control) return;
    var list = doc.getElementById("partnersList");
    var tpl = doc.getElementById("partnerRowTemplate");
    var addBtn = doc.getElementById("addPartner");
    if (!list || !tpl) return;

    // A monotonic counter keeps every row's ids unique even after removals; the visible
    // "Partner N" numbers are re-derived from position on each change.
    var counter = 0;

    function rows() {
      return list.querySelectorAll(".give-partner");
    }

    function renumber() {
      var all = rows();
      Array.prototype.forEach.call(all, function (row, i) {
        var num = row.querySelector(".give-partner-num");
        if (num) num.textContent = String(i + 1);
        // Hide the remove control when only one partner remains (at least one is required).
        var rm = row.querySelector("[data-remove-partner]");
        if (rm) rm.hidden = all.length <= 1;
      });
    }

    function wireRow(row) {
      var nonUkBox = row.querySelector('[data-field="nonUk"]');
      var postcodeField = row.querySelector("[data-postcode-field]");
      var postcodeInput = row.querySelector('[data-field="postcode"]');
      function applyNonUk() {
        var nonUk = !!(nonUkBox && nonUkBox.checked);
        if (postcodeField) postcodeField.hidden = nonUk;
        if (postcodeInput) {
          postcodeInput.disabled = nonUk;
          if (nonUk) {
            postcodeInput.removeAttribute("required");
            postcodeInput.removeAttribute("aria-required");
          } else {
            postcodeInput.setAttribute("required", "");
            postcodeInput.setAttribute("aria-required", "true");
          }
        }
      }
      if (nonUkBox) nonUkBox.addEventListener("change", applyNonUk);
      applyNonUk();

      var removeBtn = row.querySelector("[data-remove-partner]");
      if (removeBtn) {
        removeBtn.addEventListener("click", function () {
          if (rows().length <= 1) return; // keep at least one partner
          if (row.parentNode) row.parentNode.removeChild(row);
          renumber();
        });
      }
    }

    function addRow() {
      var base = "partner-" + counter;
      counter += 1;
      var markup = tpl.innerHTML.replace(/__ID__/g, base);
      var holder = doc.createElement("div");
      holder.innerHTML = markup;
      var row = holder.firstElementChild;
      if (!row) return null;
      list.appendChild(row);
      wireRow(row);
      renumber();
      return row;
    }

    if (addBtn) {
      addBtn.addEventListener("click", function () {
        addRow();
      });
    }

    // Ship one partner row so the partnership path is usable immediately.
    if (!list.querySelector(".give-partner")) addRow();

    control.dataset.ready = "true";
  }

  // Contact form (REQ-027): client-side validation + submit handling for the
  // enquiry form. Progressive enhancement — without JS the form posts to
  // /api/contact (REQ-030). With JS this validates the required fields and the
  // email format, surfaces inline errors (aria-invalid + aria-describedby), and
  // on a valid submit shows the success message (the preview behaviour). It then
  // best-effort POSTs {firstName,lastName,email,message} to /api/contact and, if
  // that endpoint is absent or unavailable, falls back to the visitor's mail
  // client (mailto). The endpoint itself is REQ-030 and out of scope here.
  function initContactForm(doc, win) {
    var form = doc.getElementById("contactForm");
    if (!form) return;
    var status = doc.getElementById("formStatus");

    // The required fields and how each is validated. Last name is optional.
    var fields = [
      { id: "firstName", required: true },
      { id: "email", required: true, email: true },
      { id: "message", required: true },
    ];

    function emailValid(value) {
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    }

    function validateField(f) {
      var el = doc.getElementById(f.id);
      if (!el) return true;
      var value = (el.value || "").trim();
      var ok = true;
      if (f.required && !value) ok = false;
      else if (f.email && !emailValid(value)) ok = false;
      el.setAttribute("aria-invalid", String(!ok));
      var err = doc.getElementById(f.id + "-error");
      if (err) err.hidden = ok;
      var wrap = el.closest ? el.closest(".field") : null;
      if (wrap) wrap.classList.toggle("invalid", !ok);
      return ok;
    }

    function clearErrors() {
      fields.forEach(function (f) {
        var el = doc.getElementById(f.id);
        if (!el) return;
        el.setAttribute("aria-invalid", "false");
        var err = doc.getElementById(f.id + "-error");
        if (err) err.hidden = true;
        var wrap = el.closest ? el.closest(".field") : null;
        if (wrap) wrap.classList.remove("invalid");
      });
    }

    function value(id) {
      var el = doc.getElementById(id);
      return el ? (el.value || "").trim() : "";
    }

    // Best-effort delivery (production). Preview/local has no working backend, so
    // this only runs in a real browser with fetch; a 501/error/absent endpoint
    // falls back to opening the visitor's mail client.
    function deliver(payload) {
      if (typeof win.fetch !== "function") return;
      function mailFallback() {
        try {
          var subject = "Website enquiry from " + payload.firstName;
          var body =
            "Name: " + payload.firstName + " " + payload.lastName + "\n" +
            "Email: " + payload.email + "\n\n" + payload.message;
          win.location.href =
            "mailto:info@nightbeforechristmas.co.uk?subject=" +
            encodeURIComponent(subject) +
            "&body=" +
            encodeURIComponent(body);
        } catch (e) {
          /* navigation unavailable (e.g. tests); the success message already shows */
        }
      }
      win
        .fetch("/api/contact", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
        .then(function (res) {
          if (!res || !res.ok) mailFallback();
        })
        .catch(mailFallback);
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();

      var firstBad = null;
      var allOk = true;
      fields.forEach(function (f) {
        var ok = validateField(f);
        if (!ok) {
          allOk = false;
          if (!firstBad) firstBad = doc.getElementById(f.id);
        }
      });

      if (!allOk) {
        if (status) {
          status.textContent = "";
          status.className = "form-status";
        }
        if (firstBad && firstBad.focus) firstBad.focus();
        return;
      }

      var payload = {
        firstName: value("firstName"),
        lastName: value("lastName"),
        email: value("email"),
        message: value("message"),
      };

      // Preview behaviour: show the success message.
      if (status) {
        status.textContent =
          "Thank you " +
          payload.firstName +
          ", your message is on its way to the NBCC inbox. We will be in touch soon.";
        status.className = "form-status is-success";
      }

      form.reset();
      clearErrors();
      deliver(payload);
    });
  }

  // Donate checkout contract (REQ-028): each tier/amount control carries
  // data-mode (once/monthly), data-plan (bronze/silver/gold/platinum, empty for
  // one-off) and data-amount (pence, empty for choose-your-own). startCheckout
  // reads those plus the #giftAid checkbox (REQ-023) into one
  // { mode, plan, amount, giftAid } payload and returns it. In production it
  // POSTs to /api/checkout-session (REQ-029) and redirects to the returned Stripe
  // { url }; with no working backend it degrades to showing the payload (the
  // preview), mirroring initContactForm's best-effort approach. Amount is in
  // pence; the choose-your-own control builds it from the #customAmount input.
  function startCheckout(button, win) {
    if (!button) return null;
    var doc = button.ownerDocument;
    win = win || (doc && doc.defaultView) || window;

    var amount = parseInt(button.getAttribute("data-amount"), 10);
    if (!amount) {
      // Choose your own amount: build pence from the linked number input.
      var custom = button.closest ? button.closest(".give-tier-custom") : null;
      var input = custom ? custom.querySelector("input") : doc.getElementById("customAmount");
      var pounds = input ? parseFloat(input.value) : NaN;
      amount = isFinite(pounds) && pounds > 0 ? Math.round(pounds * 100) : null;
    }

    var giftAidEl = doc.getElementById("giftAid");
    var payload = {
      mode: button.getAttribute("data-mode") || null,
      plan: button.getAttribute("data-plan") || null,
      amount: amount || null,
      giftAid: !!(giftAidEl && giftAidEl.checked),
    };

    // Donor-type routing (REQ-038): once initDonorType has wired the control
    // (data-ready), fold the selected donorType in, plus the optional business
    // name when the donor filled it. The business name is a Donors Page display
    // label only and never affects the Gift Aid path.
    var donorControl = doc.querySelector(".give-donor[data-ready]");
    if (donorControl) {
      var donorRadio = donorControl.querySelector('input[name="donorType"]:checked');
      if (donorRadio) payload.donorType = donorRadio.value;
    }
    var businessNameEl = doc.getElementById("businessName");
    var businessName = businessNameEl ? (businessNameEl.value || "").trim() : "";
    if (businessName) payload.businessName = businessName;

    // Contact capture (REQ-039): once initContactCapture has wired the fieldset
    // (data-ready), fold the donor's contact details in — the required full name, the
    // optional email and its consent tick (never assumed), the anonymous choice, and
    // (monthly only) the 18+ confirmation. Without JS these are omitted, so the base
    // { mode, plan, amount, giftAid } contract is unchanged.
    var contactControl = doc.querySelector(".give-contact[data-ready]");
    if (contactControl) {
      var fullNameEl = doc.getElementById("donorName");
      payload.fullName = fullNameEl ? (fullNameEl.value || "").trim() : "";
      var emailEl = doc.getElementById("donorEmail");
      payload.email = emailEl ? (emailEl.value || "").trim() : "";
      var consentEl = doc.getElementById("emailConsent");
      payload.emailConsent = !!(consentEl && consentEl.checked);
      var anonEl = doc.getElementById("anonymousDonor");
      payload.anonymous = !!(anonEl && anonEl.checked);
      // The 18 or over confirmation applies to monthly giving only.
      if (payload.mode === "monthly") {
        var ageEl = doc.getElementById("ageConfirmed");
        payload.ageConfirmed = !!(ageEl && ageEl.checked);
      }
    }

    // Gift Aid declaration (REQ-043): once initDeclarationCapture has wired the fieldset
    // (data-ready), fold the captured HMRC declaration in — but ONLY when the donor opted
    // into Gift Aid, since a declaration is made only then (mirrors the donorType gate). A
    // non-UK donor omits the postcode; the optional title is folded in only when filled.
    var declControl = doc.querySelector(".give-declaration[data-ready]");
    if (declControl && payload.giftAid && currentDonorPath(doc) !== "partnership") {
      var declVal = function (id) {
        var el = doc.getElementById(id);
        return el ? (el.value || "").trim() : "";
      };
      var declNonUk = !!(doc.getElementById("declNonUk") && doc.getElementById("declNonUk").checked);
      var declaration = {
        firstName: declVal("declFirstName"),
        lastName: declVal("declLastName"),
        houseNameNumber: declVal("declHouse"),
        address: declVal("declAddress"),
        nonUk: declNonUk,
      };
      var declTitle = declVal("declTitle");
      if (declTitle) declaration.title = declTitle;
      if (!declNonUk) declaration.postcode = declVal("declPostcode");
      // Declaration scope (REQ-044): the donor's selected radio (defaulting from the give
      // mode). The backend still derives the persisted scope from the mode for now.
      var declScope = doc.querySelector('input[name="declScope"]:checked');
      if (declScope) declaration.scope = declScope.value;
      payload.declaration = declaration;
    }

    // Partnership declarations (REQ-051): on the partnership path, once initPartnershipCapture
    // has wired the fieldset (data-ready) and the donor opted into Gift Aid, fold a `partners`
    // array — one { ...declaration fields, sharePence } per partner — INSTEAD of the single
    // declaration object. Each per-partner share is captured in pounds and stored as pence; a
    // non-UK partner omits the postcode and the optional title is folded in only when filled.
    // The partners' shares must sum to the donation total; the backend enforces the exact sum.
    var partnersControl = doc.querySelector(".give-partners[data-ready]");
    if (partnersControl && payload.giftAid && currentDonorPath(doc) === "partnership") {
      var partners = [];
      Array.prototype.forEach.call(partnersControl.querySelectorAll(".give-partner"), function (row) {
        var rowVal = function (field) {
          var el = row.querySelector('[data-field="' + field + '"]');
          return el ? (el.value || "").trim() : "";
        };
        var nonUkEl = row.querySelector('[data-field="nonUk"]');
        var partnerNonUk = !!(nonUkEl && nonUkEl.checked);
        var pounds = parseFloat(rowVal("share"));
        var partner = {
          firstName: rowVal("firstName"),
          lastName: rowVal("lastName"),
          houseNameNumber: rowVal("houseNameNumber"),
          address: rowVal("address"),
          nonUk: partnerNonUk,
          sharePence: isFinite(pounds) && pounds > 0 ? Math.round(pounds * 100) : null,
        };
        var partnerTitle = rowVal("title");
        if (partnerTitle) partner.title = partnerTitle;
        if (!partnerNonUk) partner.postcode = rowVal("postcode");
        partners.push(partner);
      });
      payload.partners = partners;
      // The partnership path uses partners, not the single declaration object.
      delete payload.declaration;
    }

    // Preview: show the payload a live checkout would send to the backend.
    function preview() {
      try {
        win.alert(
          "This is where Stripe Checkout opens.\n\nPayload for your backend:\n" +
            JSON.stringify(payload, null, 2),
        );
      } catch (e) {
        /* alert unavailable (e.g. tests) */
      }
    }

    // Production: POST to the checkout endpoint (REQ-029) and redirect to the
    // returned Stripe URL; degrade to the preview if it is absent/unavailable.
    if (typeof win.fetch === "function") {
      win
        .fetch("/api/checkout-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
        .then(function (res) {
          return res && res.ok ? res.json() : null;
        })
        .then(function (data) {
          if (data && data.url) win.location.href = data.url;
          else preview();
        })
        .catch(preview);
    } else {
      preview();
    }

    return payload;
  }

  // Wire every checkout control (the tier buttons and the choose-your-own button,
  // all carrying data-amount) to startCheckout. The once/monthly toggle buttons
  // carry data-mode but NOT data-amount, so they stay with initGiveToggle.
  function initCheckout(doc, win) {
    var controls = doc.querySelectorAll("[data-amount]");
    if (!controls.length) return;
    Array.prototype.forEach.call(controls, function (btn) {
      btn.addEventListener("click", function () {
        startCheckout(btn, win);
      });
    });
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      initNav,
      initReveal,
      initGiveToggle,
      initDonorType,
      initContactCapture,
      initDeclarationCapture,
      initPartnershipCapture,
      initContactForm,
      startCheckout,
      initCheckout,
    };
  } else {
    initNav(document, window);
    initReveal(document, window);
    initGiveToggle(document);
    initDeclarationCapture(document);
    initPartnershipCapture(document);
    initDonorType(document);
    initContactCapture(document);
    initContactForm(document, window);
    initCheckout(document, window);
  }
})();
