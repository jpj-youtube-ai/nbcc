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
    var company = doc.querySelector(".give-company");

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
      // The company-specific fields show ONLY on the company path; disable their inputs
      // otherwise so a hidden required field never blocks submission or leaks a value.
      if (company) {
        var isCompany = path === "company";
        company.hidden = !isCompany;
        Array.prototype.forEach.call(company.querySelectorAll("input"), function (el) {
          el.disabled = !isCompany;
        });
      }
      // REQ-039: the individual email is required on the individual/partnership paths, but a
      // company donates via its own contact email — un-require the individual field there so a
      // hidden/irrelevant required input never blocks submission (mirrors the company inputs above).
      var donorEmail = doc.getElementById("donorEmail");
      if (donorEmail) {
        if (path === "company") {
          donorEmail.removeAttribute("required");
          donorEmail.removeAttribute("aria-required");
        } else {
          donorEmail.setAttribute("required", "");
          donorEmail.setAttribute("aria-required", "true");
        }
      }
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
  // JS. This wires the overseas-address checkbox (a donor whose home address has no UK
  // postcode, e.g. Channel Islands / Isle of Man, so it hides, disables and un-requires the
  // postcode). That is only a matching detail — it does NOT affect Gift Aid eligibility,
  // which is the UK-taxpayer declaration the donor agrees to on submit. It marks the
  // fieldset data-ready, so
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

  // Contact form (REQ-027, honest-save 2026-07-10 contact-inbox spec): client-side
  // validation + submit handling for the enquiry form. Progressive enhancement —
  // without JS the form posts to /api/contact (REQ-030). With JS this validates the
  // required fields and the email format, surfaces inline errors (aria-invalid +
  // aria-describedby), and only on a genuine 200 from POST /api/contact shows the
  // success message and resets the form. A non-2xx response or a network failure
  // shows an error message and leaves the typed message in place (nothing is
  // discarded); the submit button is disabled only while the request is in flight.
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

      if (typeof win.fetch !== "function") return; // no-JS/preview: native POST handles it

      var submitBtn = form.querySelector('button[type="submit"]');
      if (submitBtn) submitBtn.disabled = true;
      if (status) {
        status.textContent = "Sending…";
        status.className = "form-status";
      }

      win
        .fetch("/api/contact", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
        .then(function (res) {
          if (res && res.ok) {
            if (status) {
              status.textContent =
                "Thank you " +
                payload.firstName +
                ", your message has reached the NBCC inbox. We will be in touch soon.";
              status.className = "form-status is-success";
            }
            form.reset();
            clearErrors();
          } else {
            if (status) {
              status.textContent =
                "Sorry, we could not send your message just now. Please try again, or email info@nbcc.scot.";
              status.className = "form-status is-error";
            }
          }
        })
        .catch(function () {
          if (status) {
            status.textContent =
              "Sorry, we could not send your message just now. Please try again, or email info@nbcc.scot.";
            status.className = "form-status is-error";
          }
        })
        .then(function () {
          if (submitBtn) submitBtn.disabled = false;
        });
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

    // Company capture (REQ-038): on the company path fold a `company` object with the
    // company-specific fields, and GUARANTEE giftAid is never sent true — an incorporated
    // company can never claim Gift Aid (its callout is already hidden/cleared by
    // initDonorType). The legal name reuses the existing #businessName field. Gated on the
    // donor control being wired so the no-JS base contract is unchanged.
    if (donorControl && currentDonorPath(doc) === "company") {
      payload.giftAid = false;
      var compVal = function (id) {
        var el = doc.getElementById(id);
        return el ? (el.value || "").trim() : "";
      };
      // Whether NBCC gave anything of value in return (REQ-053): the checked radio, default
      // "no" (a genuine donation). true only when the donor picked "yes".
      var considerationEl = doc.querySelector('input[name="companyConsideration"]:checked');
      payload.company = {
        legalName: businessName,
        registrationNumber: compVal("companyRegNumber"),
        contactName: compVal("companyContactName"),
        contactEmail: compVal("companyContactEmail"),
        billingAddress: compVal("companyBillingAddress"),
        billingPostcode: compVal("companyBillingPostcode"),
        considerationGiven: !!(considerationEl && considerationEl.value === "yes"),
      };
      // A company makes no Gift Aid declaration.
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
      // In the donate step wizard, a tier click SELECTS an amount (give-steps.js)
      // rather than opening checkout immediately; the wizard calls startCheckout
      // itself at its final step. Skip auto-wiring those tiers.
      if (btn.closest && btn.closest("[data-give-steps]")) return;
      btn.addEventListener("click", function () {
        startCheckout(btn, win);
      });
    });
  }

  // Self-serve donor portal (REQ-061): portal.html is reached via a one-time magic-link
  // token in the URL query string (?token=…). On load initPortal reads that token, calls
  // GET /api/portal/:token and renders the donor's details, monthly-gift plan and Gift Aid
  // state. Cancelling the monthly gift is gated behind a reduce-instead choice (REQ-055) —
  // the cancel action lives inside #reduceChoice, which is revealed only when the donor asks
  // to cancel, so reducing is always offered first. Cancelling Gift Aid posts to
  // /api/portal/:token/gift-aid/cancel (TASK-103). Best-effort, mirroring initContactForm /
  // startCheckout: it only runs where fetch exists, and no-ops on any page without #portalContent.
  // Self-serve magic-link request (REQ-061): the portal error card carries a small form
  // (#portalRequestForm) where a donor whose link is missing or expired enters their email to
  // get a fresh one. Wired independently of initPortal because it must work on the no-token /
  // failed-load path, where initPortal early-returns. Posts { email } to /api/portal/request,
  // which always returns the same generic 200 (no enumeration); we surface that reply verbatim
  // and never claim success or failure of the match. Best-effort, mirroring initContactForm.
  function initPortalRequest(doc, win) {
    var form = doc.getElementById("portalRequestForm");
    if (!form) return; // not the portal page
    win = win || (doc && doc.defaultView) || window;

    var input = doc.getElementById("portalRequestEmail");
    var statusEl = doc.getElementById("portalRequestStatus");
    var GENERIC = "If that email matches a supporter, we've sent a portal link.";

    form.addEventListener("submit", function (ev) {
      if (ev && ev.preventDefault) ev.preventDefault();
      var email = input && input.value ? input.value.trim() : "";
      // Let the native required/type=email validation surface an empty/invalid address rather
      // than posting it; the endpoint would 400 anyway.
      if (form.checkValidity && !form.checkValidity()) {
        if (form.reportValidity) form.reportValidity();
        return;
      }
      if (typeof win.fetch !== "function") return;
      return win
        .fetch("/api/portal/request", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email }),
        })
        .then(function () {
          // The endpoint returns the same generic reply for match / no-match / send failure, so
          // we always show the same reassuring line. A network error falls through to the catch.
          if (statusEl) statusEl.textContent = GENERIC;
        })
        .catch(function () {
          if (statusEl)
            statusEl.textContent =
              "We could not send a link just now. Please try again later, or get in touch.";
        });
    });
  }

  function initPortal(doc, win) {
    var content = doc.getElementById("portalContent");
    if (!content) return; // not the portal page
    win = win || (doc && doc.defaultView) || window;

    var statusEl = doc.getElementById("portalStatus");
    var errorEl = doc.getElementById("portalError");
    var actionStatus = doc.getElementById("portalActionStatus");

    function setStatus(el, msg) {
      if (el) el.textContent = msg || "";
    }
    function showError(msg) {
      if (statusEl) statusEl.hidden = true;
      content.hidden = true;
      if (errorEl) {
        errorEl.hidden = false;
        if (msg) {
          var p = errorEl.querySelector("p");
          if (p) p.textContent = msg;
        }
      }
    }

    // The magic-link token from the query string; no token means the link is unusable.
    var search = (win.location && win.location.search) || "";
    var match = search.match(/[?&]token=([^&]+)/);
    var token = match ? decodeURIComponent(match[1]) : "";
    if (!token) {
      showError();
      return;
    }

    var base = "/api/portal/" + encodeURIComponent(token);

    // Cancelling the monthly gift: the cancel action (#confirmCancelSub) lives inside the
    // reduce-instead choice, which stays hidden until the donor asks to cancel — so reducing is
    // always offered first (REQ-055). We remember the subscription id from the snapshot to send.
    var subscriptionId = null;

    var cancelSubStart = doc.getElementById("cancelSubStart");
    var reduceChoice = doc.getElementById("reduceChoice");
    if (cancelSubStart && reduceChoice) {
      cancelSubStart.addEventListener("click", function () {
        reduceChoice.hidden = false;
        var confirmBtn = doc.getElementById("confirmCancelSub");
        if (confirmBtn && confirmBtn.focus) confirmBtn.focus();
      });
    }

    // A best-effort POST that reports its outcome into the action-status region. Returns the
    // fetch promise so callers (and tests) can await it; no-ops without fetch.
    function post(path, body, okMsg, failMsg) {
      if (typeof win.fetch !== "function") return;
      return win
        .fetch(path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body || {}),
        })
        .then(function (res) {
          setStatus(actionStatus, res && res.ok ? okMsg : failMsg);
        })
        .catch(function () {
          setStatus(actionStatus, failMsg);
        });
    }

    var confirmCancelSub = doc.getElementById("confirmCancelSub");
    if (confirmCancelSub) {
      confirmCancelSub.addEventListener("click", function () {
        post(
          base + "/subscription/cancel",
          { subscriptionId: subscriptionId, accepted: "cancel" },
          "Your monthly gift has been cancelled. Thank you for all your support.",
          "We could not cancel your monthly gift just now. Please try again later.",
        );
      });
    }

    var cancelGiftAid = doc.getElementById("cancelGiftAid");
    if (cancelGiftAid) {
      cancelGiftAid.addEventListener("click", function () {
        post(
          base + "/gift-aid/cancel",
          {},
          "Your Gift Aid has been cancelled.",
          "We could not cancel your Gift Aid just now. Please try again later.",
        );
      });
    }

    // Gift Aid declaration edit (TASK-129): identity/address only. The card is shown + prefilled
    // only when the donor has an active declaration; the overseas checkbox hides/un-requires the
    // postcode (mirroring initDeclarationCapture); submit PATCHes the matching fields and reflects
    // the synced name back into "Your details".
    var declCard = doc.getElementById("portalDeclaration");
    var declForm = doc.getElementById("portalDeclForm");
    var pdPostcodeField = doc.getElementById("pdPostcodeField");
    var pdPostcode = doc.getElementById("pdPostcode");
    var pdNonUk = doc.getElementById("pdNonUk");

    function applyPdNonUk() {
      var off = !!(pdNonUk && pdNonUk.checked);
      if (pdPostcodeField) pdPostcodeField.hidden = off;
      if (pdPostcode) {
        pdPostcode.disabled = off;
        if (off) {
          pdPostcode.removeAttribute("required");
          pdPostcode.removeAttribute("aria-required");
        } else {
          pdPostcode.setAttribute("required", "");
          pdPostcode.setAttribute("aria-required", "true");
        }
      }
    }
    if (pdNonUk) pdNonUk.addEventListener("change", applyPdNonUk);

    function prefillDeclaration(decl) {
      if (!declCard || !decl) return;
      var set = function (id, v) {
        var el = doc.getElementById(id);
        if (el) el.value = v == null ? "" : v;
      };
      set("pdTitle", decl.title);
      set("pdFirstName", decl.firstName);
      set("pdLastName", decl.lastName);
      set("pdHouse", decl.houseNameNumber);
      set("pdAddress", decl.address);
      set("pdPostcode", decl.postcode);
      if (pdNonUk) pdNonUk.checked = !!decl.nonUk;
      applyPdNonUk();
      declCard.hidden = false;
    }

    if (declForm) {
      declForm.addEventListener("submit", function (ev) {
        ev.preventDefault();
        if (typeof win.fetch !== "function") return;
        var nonUk = !!(pdNonUk && pdNonUk.checked);
        var val = function (id) {
          var el = doc.getElementById(id);
          return el ? el.value.trim() : "";
        };
        var payload = {
          title: val("pdTitle") || undefined,
          firstName: val("pdFirstName"),
          lastName: val("pdLastName"),
          houseNameNumber: val("pdHouse") || undefined,
          address: val("pdAddress"),
          nonUk: nonUk,
        };
        if (!nonUk) payload.postcode = val("pdPostcode");
        win
          .fetch(base + "/declaration", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
          .then(function (r) {
            return r.json().then(function (b) {
              return { ok: r.ok, body: b };
            });
          })
          .then(function (res) {
            setStatus(
              actionStatus,
              res.ok
                ? "Your declaration details are updated."
                : (res.body && res.body.error) || "We could not update your declaration just now.",
            );
            if (res.ok && res.body && res.body.declaration) {
              prefillDeclaration(res.body.declaration);
              var nameEl = doc.getElementById("portalName");
              if (nameEl) {
                nameEl.textContent = res.body.declaration.firstName + " " + res.body.declaration.lastName;
              }
            }
          })
          .catch(function () {
            setStatus(actionStatus, "We could not update your declaration just now.");
          });
      });
    }

    // Self-edit the account details (REQ-061): name, email, marketing consent and the public
    // anonymity flag. Prefilled by render() from the snapshot; submit PATCHes the fields to the
    // bare /api/portal/:token and reflects the returned snapshot back into "Your details".
    var detailsForm = doc.getElementById("portalDetailsForm");
    var pdName = doc.getElementById("pdName");
    var pdEmail = doc.getElementById("pdEmail");
    var pdEmailConsent = doc.getElementById("pdEmailConsent");
    var pdAnonymous = doc.getElementById("pdAnonymous");
    var detailsStatus = doc.getElementById("portalDetailsStatus");

    function prefillDetails(data) {
      if (pdName) pdName.value = data.fullName || "";
      if (pdEmail) pdEmail.value = data.email || "";
      if (pdEmailConsent) pdEmailConsent.checked = !!data.emailConsent;
      if (pdAnonymous) pdAnonymous.checked = !!data.anonymous;
    }

    if (detailsForm) {
      detailsForm.addEventListener("submit", function (ev) {
        if (ev && ev.preventDefault) ev.preventDefault();
        if (detailsForm.checkValidity && !detailsForm.checkValidity()) {
          if (detailsForm.reportValidity) detailsForm.reportValidity();
          return;
        }
        if (typeof win.fetch !== "function") return;
        // Send name + the two flags always; email only when non-empty (the schema rejects an
        // empty string, and clearing an email is not an edit we expose here).
        var payload = {
          fullName: pdName ? pdName.value.trim() : "",
          emailConsent: !!(pdEmailConsent && pdEmailConsent.checked),
          anonymous: !!(pdAnonymous && pdAnonymous.checked),
        };
        var email = pdEmail ? pdEmail.value.trim() : "";
        if (email) payload.email = email;
        return win
          .fetch(base, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
          .then(function (r) {
            return r.json().then(function (b) {
              return { ok: r.ok, body: b };
            });
          })
          .then(function (res) {
            setStatus(
              detailsStatus,
              res.ok
                ? "Your details are updated."
                : (res.body && res.body.error) || "We could not update your details just now.",
            );
            // The bare PATCH returns the fresh snapshot; reflect it into the read-only display and
            // re-prefill the form so the shown values match what was saved.
            if (res.ok && res.body) {
              var nm = doc.getElementById("portalName");
              if (nm) nm.textContent = res.body.fullName || "Not on file";
              var em = doc.getElementById("portalEmail");
              if (em) em.textContent = res.body.email || "No email on file";
              prefillDetails(res.body);
            }
          })
          .catch(function () {
            setStatus(detailsStatus, "We could not update your details just now.");
          });
      });
    }

    // Render the donor snapshot returned by GET /api/portal/:token.
    function render(data) {
      subscriptionId = data.subscriptionId || null;

      var nameEl = doc.getElementById("portalName");
      if (nameEl) nameEl.textContent = data.fullName || "Not on file";
      var emailEl = doc.getElementById("portalEmail");
      if (emailEl) emailEl.textContent = data.email || "No email on file";
      prefillDetails(data);

      // Monthly gift: show the plan, or the no-subscription note (and hide the manage actions).
      var planEl = doc.getElementById("portalPlan");
      var noSub = doc.getElementById("portalNoSub");
      var subActions = doc.getElementById("portalSubActions");
      if (data.subscriptionPlan) {
        var plan = String(data.subscriptionPlan);
        if (planEl) planEl.textContent = plan.charAt(0).toUpperCase() + plan.slice(1);
        if (noSub) noSub.hidden = true;
      } else {
        if (planEl) planEl.textContent = "No monthly gift";
        if (noSub) noSub.hidden = false;
        if (subActions) subActions.hidden = true;
        if (reduceChoice) reduceChoice.hidden = true;
      }

      // Gift Aid: show the status and reveal the cancel control only when it is active.
      var giftAidEl = doc.getElementById("portalGiftAid");
      if (giftAidEl) giftAidEl.textContent = data.giftAid ? "Active" : "Not active";
      if (cancelGiftAid) cancelGiftAid.hidden = !data.giftAid;

      // Gift Aid declaration edit (TASK-129): prefill + show the form only with an active declaration.
      prefillDeclaration(data.declaration);

      // Donation history (REQ-061 revised): total, count, and a row per donation.
      var history = data.history || { totalPence: 0, count: 0, donations: [] };
      var totalEl = doc.getElementById("portalTotal");
      if (totalEl) totalEl.textContent = "£" + (history.totalPence / 100).toFixed(2);
      var countEl = doc.getElementById("portalCount");
      if (countEl) countEl.textContent = String(history.count);
      var noHistory = doc.getElementById("portalNoHistory");
      var historyTable = doc.getElementById("portalHistoryTable");
      var body = doc.getElementById("portalHistoryBody");
      if (body) {
        body.textContent = "";
        (history.donations || []).forEach(function (d) {
          var tr = doc.createElement("tr");
          var cells = [
            new Date(d.date).toLocaleDateString(),
            "£" + (d.amountPence / 100).toFixed(2),
            d.mode === "monthly" ? "Monthly" : "One-off",
            d.giftAid ? "Yes" : "No",
            d.status,
          ];
          cells.forEach(function (text) {
            var td = doc.createElement("td");
            td.textContent = text;
            tr.appendChild(td);
          });
          body.appendChild(tr);
        });
      }
      var hasHistory = (history.count || 0) > 0;
      if (noHistory) noHistory.hidden = hasHistory;
      if (historyTable) historyTable.hidden = !hasHistory;

      if (statusEl) statusEl.hidden = true;
      if (errorEl) errorEl.hidden = true;
      content.hidden = false;
    }

    // Load the donor snapshot. Best-effort: without fetch (e.g. a preview) the page shows its
    // loading state; a failed load shows the error panel.
    setStatus(statusEl, "Loading your details…");
    if (typeof win.fetch !== "function") return;
    win
      .fetch(base, { headers: { Accept: "application/json" } })
      .then(function (res) {
        return res && res.ok ? res.json() : null;
      })
      .then(function (data) {
        if (data) render(data);
        else showError();
      })
      .catch(function () {
        showError();
      });
  }

  // Donate step wizard (donate.html only): progressive disclosure that splits the full
  // gift form into three steps (1 choose amount, 2 your details + Gift Aid opt-in, 3
  // declaration + confirm) so a donor is never faced with the whole form at once. All
  // field ids and the REQ-028 checkout payload are unchanged — initGiveToggle/DonorType/
  // ContactCapture/DeclarationCapture still own the field logic; this only handles step
  // navigation, tier SELECTION (rather than immediate checkout), and calling startCheckout
  // at the final step. No-ops on any page without [data-give-steps]; progressive
  // enhancement means the fields all ship present and usable without JS.
  function initGiveSteps(doc, win) {
    var root = doc.querySelector("[data-give-steps]");
    if (!root) return;

    var reduce =
      typeof win.matchMedia === "function" &&
      win.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var steps = Array.prototype.slice.call(root.querySelectorAll(".give-step"));
    var progress = Array.prototype.slice.call(root.querySelectorAll(".give-progress li"));
    var current = 1;
    var selected = null;

    function stepEl(n) { return root.querySelector('.give-step[data-step="' + n + '"]'); }
    function showErr(n) { var e = root.querySelector('[data-err="' + n + '"]'); if (e) e.classList.add("show"); }
    function hideErr(n) { var e = root.querySelector('[data-err="' + n + '"]'); if (e) e.classList.remove("show"); }

    // ---- tier selection (step 1): select an amount rather than checking out ----
    var choosers = Array.prototype.slice.call(root.querySelectorAll(".give-tier, .give-custom-go"));
    function clearSelection() { choosers.forEach(function (b) { b.classList.remove("is-selected"); }); }
    function customPence() {
      // Read the custom-amount input in the currently visible tier set (once XOR monthly),
      // falling back to the once input by id for older markup.
      var el = root.querySelector(".give-tiers:not([hidden]) .give-custom-input") || doc.getElementById("customAmount");
      var v = el ? parseFloat(el.value) : NaN;
      return isFinite(v) && v > 0 ? Math.round(v * 100) : 0;
    }
    function select(btn) { clearSelection(); btn.classList.add("is-selected"); selected = btn; hideErr(1); }

    choosers.forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (btn.classList.contains("give-custom-go")) {
          if (!customPence()) {
            showErr(1);
            var cb = btn.closest ? btn.closest(".give-tier-custom") : null;
            var ci = cb ? cb.querySelector(".give-custom-input") : null;
            if (ci && ci.focus) ci.focus();
            return;
          }
        }
        select(btn);
        go(2, 1); // one tap picks the amount and moves on
      });
    });
    // switching once/monthly changes the visible tier set: clear any selection
    Array.prototype.forEach.call(root.querySelectorAll(".give-mode"), function (m) {
      m.addEventListener("click", function () { selected = null; clearSelection(); });
    });

    // ---- validation: required, visible, enabled controls in a step ----
    function visible(el) { return !!(el.offsetParent !== null || el.getClientRects().length); }
    function validate(el) {
      var ctrls = Array.prototype.slice.call(el.querySelectorAll("input, select, textarea"));
      var ok = true, firstBad = null;
      ctrls.forEach(function (c) {
        if (c.disabled || c.type === "hidden" || !c.hasAttribute("required") || !visible(c)) return;
        var val = (c.value || "").trim();
        var bad = !val;
        if (c.type === "email" && val && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) bad = true;
        var field = (c.closest && (c.closest(".give-field") || c.closest(".field"))) || null;
        if (field) field.classList.toggle("invalid", bad);
        c.setAttribute("aria-invalid", String(bad));
        if (bad) { ok = false; if (!firstBad) firstBad = c; }
      });
      if (firstBad && firstBad.focus) firstBad.focus();
      return ok;
    }

    // ---- review summary (step 3) ----
    function buildReview() {
      var dl = doc.getElementById("giveReview");
      if (!dl || !selected) return;
      var mode = selected.getAttribute("data-mode") || "once";
      var plan = selected.getAttribute("data-plan") || "";
      var pence = parseInt(selected.getAttribute("data-amount"), 10) || customPence();
      var pounds = pence / 100;
      var amountStr = "£" + (pounds % 1 === 0 ? pounds.toFixed(0) : pounds.toFixed(2));
      var giftAidEl = doc.getElementById("giftAid");
      var rows = [
        ["Your gift", amountStr + (mode === "monthly" ? " a month" : ", one off") +
          (plan ? ", " + plan.charAt(0).toUpperCase() + plan.slice(1) : "")],
        ["Gift Aid", giftAidEl && giftAidEl.checked ? "Yes, add 25%" : "Not added"],
      ];
      dl.innerHTML = "";
      rows.forEach(function (r) {
        var dt = doc.createElement("dt"); dt.textContent = r[0];
        var dd = doc.createElement("dd"); dd.textContent = r[1];
        dl.appendChild(dt); dl.appendChild(dd);
      });
    }

    // ---- navigation ----
    function go(n, dir, silent) {
      if (n < 1 || n > steps.length) return;
      steps.forEach(function (s) { s.hidden = parseInt(s.getAttribute("data-step"), 10) !== n; });
      progress.forEach(function (li) {
        var p = parseInt(li.getAttribute("data-pstep"), 10);
        li.classList.toggle("is-active", p === n);
        li.classList.toggle("is-done", p < n);
      });
      current = n;
      if (n === 3) buildReview();
      var el = stepEl(n);
      if (!silent && !reduce) {
        el.classList.remove("slide-in", "slide-back");
        void el.offsetWidth;
        el.classList.add(dir < 0 ? "slide-back" : "slide-in");
      }
      if (!silent) {
        if (el && el.focus) el.focus();
        var top = root.getBoundingClientRect().top + win.scrollY - 90;
        win.scrollTo({ top: top, behavior: reduce ? "auto" : "smooth" });
      }
    }

    function next() {
      if (current === 1 && (!selected || (selected.classList.contains("give-custom-go") && !customPence()))) {
        showErr(1); return;
      }
      if (current === 2 && !validate(stepEl(2))) { showErr(2); return; }
      hideErr(current);
      go(current + 1, 1);
    }
    function prev() { if (current > 1) go(current - 1, -1); }
    function pay() {
      if (!validate(stepEl(3))) { showErr(3); return; }
      if (!selected) { go(1, -1); showErr(1); return; }
      startCheckout(selected, win);
    }

    Array.prototype.forEach.call(root.querySelectorAll("[data-give-next]"), function (b) { b.addEventListener("click", next); });
    Array.prototype.forEach.call(root.querySelectorAll("[data-give-prev]"), function (b) { b.addEventListener("click", prev); });
    var payBtn = root.querySelector("[data-give-pay]");
    if (payBtn) payBtn.addEventListener("click", pay);

    go(1, 0, true); // initial state, no scroll/focus
  }

  // My Story step wizard (my-story.html only): progressive disclosure that splits the
  // 3-step story submission form (1 your story, 2 how we can use it, 3 about you) so a
  // submitter is never faced with the whole form at once. Mirrors initGiveSteps's
  // go()/validate()/next()/prev()/slide-in chrome, but generalised (no tier selection).
  // Adds conditional reveals (public identifier opt-ins, the professional-partner
  // confirm), a honeypot spam guard, and a preview-only final submit (the real
  // POST /api/my-story endpoint arrives in Task B; this best-effort delivers to it when
  // fetch is available, mirroring initContactForm's deliver()). No-ops on any page
  // without [data-story-steps]; progressive enhancement means the fields all ship
  // present and usable without JS.
  function initStorySteps(doc, win) {
    var root = doc.querySelector("[data-story-steps]");
    if (!root) return;
    var form = doc.getElementById("storyForm");
    if (!form) return;
    // No-JS: the form has no novalidate, so native `required` validation and a
    // real POST to /api/my-story work with JS off. Once JS runs it fully owns
    // validation instead, so native popups do not fire on required fields
    // inside JS-hidden steps.
    form.noValidate = true;
    var status = doc.getElementById("storyStatus");

    var reduce =
      typeof win.matchMedia === "function" &&
      win.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var steps = Array.prototype.slice.call(root.querySelectorAll(".give-step"));
    var current = 1;
    var stepAnnounce = doc.getElementById("storyStepAnnounce");

    function stepEl(n) { return root.querySelector('.give-step[data-step="' + n + '"]'); }
    function showErr(n) { var e = root.querySelector('[data-err="' + n + '"]'); if (e) e.classList.add("show"); }
    function hideErr(n) { var e = root.querySelector('[data-err="' + n + '"]'); if (e) e.classList.remove("show"); }

    // ---- validation: required, visible, enabled controls in a step. Walks
    // ancestors for a `hidden` attribute rather than measuring layout (offsetParent/
    // getClientRects), which jsdom cannot compute, so this validates the same way in
    // a real browser and under test. ----
    function visible(el) {
      var node = el;
      while (node && node.nodeType === 1) {
        if (node.hidden) return false;
        node = node.parentElement;
      }
      return true;
    }
    function validate(el) {
      var ctrls = Array.prototype.slice.call(el.querySelectorAll("input, select, textarea"));
      var ok = true, firstBad = null;
      ctrls.forEach(function (c) {
        if (c.disabled || c.type === "hidden" || !c.hasAttribute("required") || !visible(c)) return;
        var bad;
        if (c.type === "checkbox" || c.type === "radio") {
          var group = form.querySelectorAll('[name="' + c.name + '"]');
          bad = !Array.prototype.some.call(group, function (g) { return g.checked; });
        } else {
          var val = (c.value || "").trim();
          bad = !val;
          if (c.type === "email" && val && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) bad = true;
        }
        var field = (c.closest && (c.closest(".give-field") || c.closest("fieldset"))) || null;
        if (field) field.classList.toggle("invalid", bad);
        c.setAttribute("aria-invalid", String(bad));
        if (bad) { ok = false; if (!firstBad) firstBad = c; }
      });

      // G2 item 10: a professional partner must confirm third party permission before
      // this step can pass, mirroring the schema's authoritative refine
      // (src/stories/schema.ts). thirdPartyConsent has NO native `required` — it sits in a
      // conditionally hidden reveal ([data-reveal="professional"]), and a required field
      // inside a hidden ancestor blocks native form submission even off-step, which would
      // break the no-JS path — so this business rule is checked explicitly here instead.
      // Reads the CHECKED submitterRole radio directly (fieldValue() would only ever
      // return the first radio in the group, checked or not).
      var checkedRole = form.querySelector('[name="submitterRole"]:checked');
      var professionalConsent = form.querySelector('[name="thirdPartyConsent"]');
      if (el.contains(professionalConsent) && visible(professionalConsent) && checkedRole && checkedRole.value === "professional_partner" && !professionalConsent.checked) {
        var consentField = professionalConsent.closest(".give-field");
        if (consentField) consentField.classList.add("invalid");
        professionalConsent.setAttribute("aria-invalid", "true");
        ok = false;
        if (!firstBad) firstBad = professionalConsent;
      }

      if (firstBad && firstBad.focus) firstBad.focus();
      return ok;
    }

    // ---- navigation ----
    function go(n, dir, silent) {
      if (n < 1 || n > steps.length) return;
      steps.forEach(function (s) { s.hidden = parseInt(s.getAttribute("data-step"), 10) !== n; });
      Array.prototype.forEach.call(root.querySelectorAll(".give-progress li"), function (li) {
        var p = parseInt(li.getAttribute("data-pstep"), 10);
        li.classList.toggle("is-active", p === n);
        li.classList.toggle("is-done", p < n);
      });
      current = n;
      var el = stepEl(n);
      // Screen-reader step cue: the progress rail is aria-hidden (it is purely visual),
      // so this live region is the only announcement a screen reader user gets that the
      // step actually changed. Label is read straight off the step's own title so it
      // never drifts out of sync with what sighted users see.
      if (!silent && stepAnnounce && el) {
        var titleEl = el.querySelector(".give-step-title");
        var title = titleEl ? titleEl.textContent.trim() : "";
        stepAnnounce.textContent = "Step " + n + " of " + steps.length + (title ? ", " + title : "");
      }
      if (!silent && !reduce && el) {
        el.classList.remove("slide-in", "slide-back");
        void el.offsetWidth;
        el.classList.add(dir < 0 ? "slide-back" : "slide-in");
      }
      if (!silent) {
        if (el && el.focus) el.focus();
        var top = root.getBoundingClientRect().top + win.scrollY - 90;
        win.scrollTo({ top: top, behavior: reduce ? "auto" : "smooth" });
      }
    }

    function next() {
      if (!validate(stepEl(current))) { showErr(current); return; }
      hideErr(current);
      go(current + 1, 1);
    }
    function prev() { if (current > 1) go(current - 1, -1); }

    Array.prototype.forEach.call(root.querySelectorAll("[data-story-next]"), function (b) { b.addEventListener("click", next); });
    Array.prototype.forEach.call(root.querySelectorAll("[data-story-prev]"), function (b) { b.addEventListener("click", prev); });

    // ---- conditional reveals ----
    var useScopeRadios = Array.prototype.slice.call(form.querySelectorAll('[name="useScope"]'));
    var revealPublic = form.querySelector('[data-reveal="public"]');
    useScopeRadios.forEach(function (r) {
      r.addEventListener("change", function () {
        if (revealPublic) revealPublic.hidden = r.value !== "public" || !r.checked;
      });
    });

    var roleRadios = Array.prototype.slice.call(form.querySelectorAll('[name="submitterRole"]'));
    var revealProfessional = form.querySelector('[data-reveal="professional"]');
    roleRadios.forEach(function (r) {
      r.addEventListener("change", function () {
        if (revealProfessional) revealProfessional.hidden = r.value !== "professional_partner" || !r.checked;
      });
    });

    function fieldValue(name) {
      var el = form.querySelector('[name="' + name + '"]');
      return el ? (el.value || "").trim() : "";
    }
    function fieldChecked(name) {
      var el = form.querySelector('[name="' + name + '"]');
      return !!(el && el.checked);
    }

    // ---- FIX 5: contactForMore nudge — a gentle, non blocking note when the visitor
    // asks to be contacted but left both email and phone (step 2) blank, so the
    // request cannot actually be actioned. Client side only; never blocks submit. ----
    var contactForMoreBox = form.querySelector('[name="contactForMore"]');
    var contactNudge = doc.getElementById("contactForMoreNudge");
    function updateContactNudge() {
      if (!contactNudge) return;
      var wantsContact = fieldChecked("contactForMore");
      var hasWay = !!(fieldValue("email") || fieldValue("phone"));
      contactNudge.hidden = !(wantsContact && !hasWay);
    }
    if (contactForMoreBox) contactForMoreBox.addEventListener("change", updateContactNudge);
    ["email", "phone"].forEach(function (n) {
      var el = form.querySelector('[name="' + n + '"]');
      if (el) el.addEventListener("input", updateContactNudge);
    });

    var thirdPartyConsentErr = doc.getElementById("thirdPartyConsentErr");
    var submitBtn = form.querySelector("[data-story-submit]");

    function setStatus(text, kind) {
      if (!status) return;
      status.textContent = text;
      status.className = kind ? "form-status " + kind : "form-status";
    }

    // ---- FIX 1 (CRITICAL): the success message must reflect a REAL save. The old
    // deliver() was fire and forget — it showed success and reset the form BEFORE the
    // POST resolved, so a server side rejection (e.g. the 5000 char cap, or any other
    // Zod failure) still told the visitor their story had saved. This awaits the real
    // response and only then shows success/resets, or shows a kind error and leaves the
    // form untouched so nothing already typed is lost. ----
    form.addEventListener("submit", function (e) {
      // Honeypot: a filled hidden field means a bot filled every input. Silently
      // drop, no error, no submit, and no tell to the bot that anything happened. This
      // still prevents the native/no-JS submission, matching prior behaviour.
      if (fieldValue("website")) { e.preventDefault(); return; }

      // FIX 4: a professional partner who has not ticked third party permission gets a
      // specific, dedicated message next to the checkbox, not just the generic step
      // error — the server side Zod refine (src/stories/schema.ts) remains the backstop.
      // Computed up front (validate() already blocks on this same condition as part of
      // its generic required-field pass) so the specific message shows regardless of
      // which check is what stops the submit.
      var checkedRole = form.querySelector('[name="submitterRole"]:checked');
      var professionalConsent = form.querySelector('[name="thirdPartyConsent"]');
      var professionalGateFailed = !!(
        checkedRole && checkedRole.value === "professional_partner" && professionalConsent && !professionalConsent.checked
      );
      if (thirdPartyConsentErr) thirdPartyConsentErr.classList.toggle("show", professionalGateFailed);

      if (!validate(stepEl(3))) {
        e.preventDefault();
        showErr(3);
        return;
      }
      hideErr(3);

      // No fetch available (very old browser, or fetch stripped in a test environment):
      // let the native form submission proceed to the real /api/my-story POST + HTML
      // response instead of faking a success message.
      if (typeof win.fetch !== "function") return;

      e.preventDefault();

      var payload = {
        submitterRole: fieldValue("submitterRole"),
        storyText: fieldValue("storyText"),
        shortQuote: fieldValue("shortQuote"),
        useScope: fieldValue("useScope"),
        shareFirstName: fieldChecked("shareFirstName"),
        shareTown: fieldChecked("shareTown"),
        thirdPartyConsent: fieldChecked("thirdPartyConsent"),
        contactForMore: fieldChecked("contactForMore"),
        firstName: fieldValue("firstName"),
        email: fieldValue("email"),
        phone: fieldValue("phone"),
        ageBand: fieldValue("ageBand"),
        gender: fieldValue("gender"),
        town: fieldValue("town"),
        recipientType: fieldValue("recipientType"),
        heardAbout: fieldValue("heardAbout"),
        confirmOver16: fieldChecked("confirmOver16"),
      };

      if (submitBtn) submitBtn.disabled = true;
      setStatus("Sharing your story...", "is-pending");

      win
        .fetch("/api/my-story", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
        .then(function (res) {
          if (res.ok) {
            setStatus("Thank you, your story becomes part of ours.", "is-success");
            form.reset();
            if (revealPublic) revealPublic.hidden = true;
            if (revealProfessional) revealProfessional.hidden = true;
            if (submitBtn) submitBtn.disabled = false;
            go(1, -1, true);
            return;
          }
          if (submitBtn) submitBtn.disabled = false;
          if (res.status >= 400 && res.status < 500) {
            return res
              .json()
              .catch(function () { return {}; })
              .then(function (body) {
                setStatus(
                  (body && body.error) || "Please check your story and try again.",
                  "is-error",
                );
              });
          }
          setStatus("Sorry, we could not save your story just now. Please try again.", "is-error");
        })
        .catch(function () {
          if (submitBtn) submitBtn.disabled = false;
          setStatus("Sorry, we could not save your story just now. Please try again.", "is-error");
        });
    });

    go(1, 0, true); // initial state, no scroll/focus
  }

  // Supporter ticker (REQ-003 · TASK-178): fetch the admin-curated active supporters and, if any,
  // render a scrolling marquee fixed just under the nav on every marketing page. Progressive
  // enhancement — no supporters or no JS means no ticker, and nothing else on the page shifts.
  function tickerEscape(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function initSupporterTicker(doc, win) {
    var nav = doc.getElementById("nav");
    if (!nav || !win.fetch) return;
    win
      .fetch("/api/supporters/ticker")
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        var names = data && data.supporters ? data.supporters : [];
        if (!names.length) return;
        buildSupporterTicker(doc, win, nav, names);
      })
      .catch(function () {});
  }
  function buildSupporterTicker(doc, win, nav, names) {
    var sep = ' <span class="supporter-ticker__sep" aria-hidden="true">&#9670;</span> ';
    var items = names
      .map(function (n) { return '<span class="supporter-ticker__item">' + tickerEscape(n) + "</span>"; })
      .join(sep);
    var reduced = win.matchMedia && win.matchMedia("(prefers-reduced-motion: reduce)").matches;

    var bar = doc.createElement("div");
    bar.className = "supporter-ticker";
    bar.setAttribute("role", "complementary");
    bar.setAttribute("aria-label", "Our supporters");
    // Seamless loop: the animation shifts the track by exactly -50%, so the two halves must be
    // IDENTICAL. Each "run" therefore ends with a separator (items + sep), and we render run + run —
    // otherwise a middle-only separator makes the halves unequal and the marquee visibly jumps back.
    var run = items + sep;
    var trackHtml = reduced ? items : run + run;
    bar.innerHTML =
      '<span class="supporter-ticker__label">Our supporters</span>' +
      '<div class="supporter-ticker__viewport"><div class="supporter-ticker__track' +
      (reduced ? " is-static" : "") +
      '">' + trackHtml + "</div></div>";

    nav.parentNode.insertBefore(bar, nav.nextSibling);
    doc.body.classList.add("has-ticker");

    // Seamless + constant speed: measure ONE run's width as the gap between the first item of run 1
    // and the first item of run 2 (independent of the track's left padding), scroll exactly that far,
    // and set the duration for ~60px/second.
    if (!reduced) {
      var track = bar.querySelector(".supporter-ticker__track");
      var firstItems = track.querySelectorAll(".supporter-ticker__item");
      var half = firstItems.length / 2;
      var runWidth =
        firstItems.length >= 2 ? firstItems[half].offsetLeft - firstItems[0].offsetLeft : track.scrollWidth / 2;
      track.style.setProperty("--ticker-run", runWidth + "px");
      track.style.animationDuration = Math.max(16, Math.round(runWidth / 60)) + "s";
    }
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
      initGiveSteps,
      initStorySteps,
      initPortal,
      initPortalRequest,
    };
  } else {
    initNav(document, window);
    initSupporterTicker(document, window);
    initReveal(document, window);
    initGiveToggle(document);
    initDeclarationCapture(document);
    initPartnershipCapture(document);
    initDonorType(document);
    initContactCapture(document);
    initContactForm(document, window);
    initCheckout(document, window);
    initGiveSteps(document, window);
    initStorySteps(document, window);
    initPortal(document, window);
    initPortalRequest(document, window);
    // Also expose the checkout payload/redirect builder on window so any inline
    // handler (or the donate wizard) can trigger it with the selected tier.
    window.startCheckout = function (btn) {
      return startCheckout(btn, window);
    };
  }
})();
