// Type-aware post-checkout thank-you page (TASK-221). Progressive enhancement, like main.js: a classic
// <script defer> that runs in the browser, and also exported under a CommonJS guard so the pure variant
// selection + the reveal logic are unit tested in jsdom (see test/unit/thank-you-page.test.ts).
//
// Stripe returns the donor here (/donate/thank-you) with mode+donor+session_id on the query string
// (src/routes/api.ts thankYouReturnUrl). The page ships FOUR variants plus a generic default, all
// hidden, and reveals exactly one:
//   1. individual one-off  (mode=once,    donor!=company)  — warm thanks, receipt on its way, nothing to do.
//   2. individual monthly  (mode=monthly, by-session=none) — thanks, it is set up, one reassurance line.
//   3. business one-off     (mode=once,    donor=company)   — thanks to the business, receipt on its way.
//   4. business monthly     (mode=monthly, by-session=ready|captured|pending) — the recognition form inline.
// An OLD link (no params) or an un-substituted session template falls back to the generic thanks, so a
// pre-TASK-221 link still works. The business-monthly variant calls the READ-ONLY by-session endpoint,
// renders the SHARED business form (assets/js/business-thankyou.js mountBusinessForm) on ready/captured,
// polls briefly on pending, and shows a "we emailed you a link" fallback if it never lands.
(function () {
  "use strict";

  // Pure variant selection from the query params. Kept pure (no DOM) so it is exhaustively unit tested.
  //   params: { mode, donor, hasSession }
  //   → "generic" | "individual-once" | "business-once" | "individual-monthly" | "business-monthly"
  // A one-off keys purely on donor (company → business). A monthly gift only asks the READ-ONLY
  // by-session lookup when the donor MIGHT be a business (company or partnership) and we actually have a
  // session id; a plain individual monthly is the individual-monthly variant directly (no needless
  // Stripe call). The by-session lookup then decides business-monthly (a fulfilment) vs individual
  // (none), so a company/partnership below the band still lands on individual-monthly.
  function thankYouVariant(params) {
    var mode = params && params.mode;
    var donor = params && params.donor;
    if (mode !== "once" && mode !== "monthly") return "generic";
    if (mode === "once") return donor === "company" ? "business-once" : "individual-once";
    var maybeBusiness = donor === "company" || donor === "partnership";
    if (maybeBusiness && params && params.hasSession) return "business-monthly";
    return "individual-monthly";
  }

  // Read mode / donor / session_id from the query string. A session id is only usable when present and
  // actually substituted by Stripe (a literal "{CHECKOUT_SESSION_ID}" that slipped through is ignored).
  function readParams(win) {
    var search = (win.location && win.location.search) || "";
    function get(name) {
      var m = search.match(new RegExp("[?&]" + name + "=([^&]*)"));
      return m ? decodeURIComponent(m[1]) : "";
    }
    var sessionId = get("session_id");
    return {
      mode: get("mode"),
      donor: get("donor"),
      sessionId: sessionId,
      hasSession: !!sessionId && sessionId.indexOf("{") === -1,
    };
  }

  function show(doc, id) {
    var el = doc.getElementById(id);
    if (el) el.hidden = false;
  }

  var VARIANT_SECTION = {
    "generic": "tyGeneric",
    "individual-once": "tyIndividualOnce",
    "business-once": "tyBusinessOnce",
    "individual-monthly": "tyIndividualMonthly",
    "business-monthly": "tyBusinessMonthly",
  };

  // Drive the business-monthly variant: the READ-ONLY by-session lookup, the shared inline form on
  // ready/captured, a brief poll on pending, and the emailed-link fallback if it never lands or errors.
  function loadBusinessMonthly(doc, win, sessionId) {
    var statusEl = doc.getElementById("tyBizStatus");
    var cardEl = doc.getElementById("tyBizCard");
    var fallbackEl = doc.getElementById("tyBizFallback");
    var bizSection = doc.getElementById("tyBusinessMonthly");

    function setStatus(msg) {
      if (statusEl) {
        statusEl.textContent = msg;
        statusEl.hidden = false;
      }
    }
    function showFallback() {
      if (statusEl) statusEl.hidden = true;
      if (cardEl) cardEl.hidden = true;
      if (fallbackEl) fallbackEl.hidden = false;
    }
    // ready / captured: render the SHARED business form (or read only confirmation) into the inline card.
    function showForm(data) {
      if (statusEl) statusEl.hidden = true;
      if (fallbackEl) fallbackEl.hidden = true;
      if (cardEl) cardEl.hidden = false;
      var core = win.NBCCBusinessThankYou;
      if (core && typeof core.mountBusinessForm === "function" && data && data.token) {
        core.mountBusinessForm(doc, win, { token: data.token, data: data });
      } else {
        showFallback();
      }
    }
    // none: no recognition applies → swap to the individual-monthly variant.
    function showIndividualMonthly() {
      if (bizSection) bizSection.hidden = true;
      show(doc, "tyIndividualMonthly");
    }

    if (typeof win.fetch !== "function") {
      showFallback();
      return;
    }

    var apiBase = "/api/business/fulfilment/by-session/" + encodeURIComponent(sessionId);
    var POLL_MS = 3000;
    var MAX_ATTEMPTS = 7; // ~21s of polling before the emailed-link fallback

    function attempt(n) {
      win
        .fetch(apiBase)
        .then(function (res) {
          return res && res.ok ? res.json() : null;
        })
        .then(function (data) {
          if (!data) {
            showFallback();
            return;
          }
          if (data.status === "ready" || data.status === "captured") {
            showForm(data);
          } else if (data.status === "none") {
            showIndividualMonthly();
          } else if (data.status === "pending") {
            if (n >= MAX_ATTEMPTS) {
              showFallback();
              return;
            }
            setStatus("Setting up your recognition options, one moment…");
            win.setTimeout(function () {
              attempt(n + 1);
            }, POLL_MS);
          } else {
            showFallback();
          }
        })
        .catch(function () {
          showFallback();
        });
    }

    attempt(1);
  }

  function initThankYou(doc, win) {
    if (!doc.getElementById("tyGeneric")) return; // not the type-aware thank-you page
    win = win || (doc && doc.defaultView) || window;

    var params = readParams(win);
    var variant = thankYouVariant({ mode: params.mode, donor: params.donor, hasSession: params.hasSession });

    show(doc, VARIANT_SECTION[variant] || "tyGeneric");

    if (variant === "business-monthly") {
      loadBusinessMonthly(doc, win, params.sessionId);
    }
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { thankYouVariant: thankYouVariant, initThankYou: initThankYou };
  } else {
    initThankYou(document, window);
  }
})();
