// Fill a Red Bag, /fill-a-red-bag (docs/superpowers/specs/2026-10-04-fill-a-red-bag-design.md).
//
// The page is drawn by the server and its list reads fine without this file. This makes it work:
//   - the steppers on the paper (minus, a number box you can type in, plus; 0 to 99) and the
//     examples under "Whenever the need comes" (tap to add, tap again or Remove to take out), all
//     adding up to ONE running total;
//   - the bags, the status line and the total, kept in step. The sums and the words come from the
//     one catalogue (assets/js/red-bag-catalogue.js, window.NBCCRedBag), never from here;
//   - Donate: under £2 it shows the friendly nudge; from £2 it opens the details step, the same asks
//     as the give form on a fundraiser's page (assets/js/fundraiser.js), then the donate page's
//     checkout: POST /api/checkout-session with the donate page's body plus redBag: true. Stripe
//     opens on the page when it can and on Stripe's own page when it cannot;
//   - the thank you on the way back (?thanks=1), with the total this tab remembered (for show only;
//     the server never trusts it) and a picture to share that names no amount.
//
// Only the total is ever sent: no list of items leaves the page, because the items are examples of
// what a donation could do, not things being bought.
//
// Its own file rather than main.js, which counts towards donate.html's page weight budget. It uses
// main.js's shared field highlighting (window.NBCCFormValidation) when it is there. A classic
// <script defer>, exported under a CommonJS guard so it can be unit tested in jsdom.
(function () {
  "use strict";

  // The card fee shown beside the offer, as the donate page shows it (main.js). The server works out
  // the real figure from the rate it holds; this is only the words.
  var CARD_FEE_BP = 120;
  var CARD_FEE_FIXED_PENCE = 20;

  // What this tab remembers across the trip to Stripe, for the thank you: the total, and whether
  // Gift Aid and monthly were chosen. Display only.
  var GIFT_KEY = "nbcc_red_bag_gift";
  // The admin's session, kept by admin.html for the tab. Read ONLY on a staff preview.
  var ADMIN_TOKEN_KEY = "nbcc_admin_token";
  // The page's public address, for sharing.
  var PAGE_URL = "https://nbcc.scot/fill-a-red-bag";

  var MSG = {
    check: "Please check the highlighted answers below and try again.",
    opening: "Opening secure payment…",
    refused: "Something in the form needs another look. Please check it and try again.",
    // Only ever met by staff: while the page is switched off the checkout takes a Red Bag donation
    // from a signed in member of staff alone, and says this when their session has run out.
    notOpen: "Fill a Red Bag is not open yet. If you are staff, please sign in again at /admin, then come back to this page.",
    down: "Payment is not working just now. Please try again in a few minutes, or give on our donate page.",
  };

  function each(list, fn) {
    Array.prototype.forEach.call(list, fn);
  }

  function setText(el, words) {
    // Written only when the words change, so a live region is heard once for each new line.
    if (el && el.textContent !== words) el.textContent = words;
  }

  function focusOn(el) {
    if (!el) return;
    try {
      el.focus({ preventScroll: false });
    } catch (e) {
      /* focus unavailable */
    }
  }

  function storage(win) {
    try {
      return win.sessionStorage || null;
    } catch (e) {
      return null;
    }
  }

  function initRedBag(doc, win, nav) {
    var rb = win && win.NBCCRedBag;
    var builder = doc.querySelector("[data-rb-builder]");
    if (!rb || !builder) return null;
    nav = nav || { assign: function (u) { win.location.href = u; } };

    var need = doc.querySelector("[data-rb-need]");
    var details = doc.querySelector("[data-rb-details]");
    var thanks = doc.querySelector("[data-rb-thanks]");
    var bagsBox = doc.querySelector("[data-rb-bags]");
    var bagTemplate = doc.getElementById("rbBagTemplate");
    var more = doc.querySelector("[data-rb-more]");
    var status = doc.querySelector("[data-rb-status]");
    var totalEl = doc.querySelector("[data-rb-total]");
    var perMonth = doc.querySelector("[data-rb-per-month]");
    var monthly = doc.getElementById("rbMonthly");
    var donateBtn = doc.querySelector("[data-rb-donate]");
    var nudge = doc.querySelector("[data-rb-nudge]");
    var also = doc.querySelector("[data-rb-also]");
    var alsoList = doc.querySelector("[data-rb-also-list]");
    var form = doc.getElementById("rbDetailsForm");
    var summary = form ? form.querySelector("[data-rb-error]") : null;
    var payBtn = form ? form.querySelector("[data-rb-pay]") : null;
    var preview = !!(doc.body && doc.body.getAttribute("data-rb-preview") === "true");

    var quantities = {};
    var tapped = []; // example keys, in the order they were tapped
    var busy = false;

    // The working parts ship hidden; the script that can work them shows them.
    each(doc.querySelectorAll("[data-needs-js]"), function (n) {
      n.hidden = false;
    });
    each(doc.querySelectorAll("[data-nojs]"), function (n) {
      n.hidden = true;
    });

    function total() {
      return rb.totalPence(quantities, tapped);
    }
    function isMonthly() {
      return !!(monthly && monthly.checked);
    }
    function exampleOf(key) {
      var found = null;
      rb.examples().forEach(function (e) {
        if (e.key === key) found = e;
      });
      return found;
    }

    // --- the bags -------------------------------------------------------------------------------
    function newBag() {
      var svg = null;
      if (bagTemplate && bagTemplate.content && bagTemplate.content.firstElementChild) {
        svg = bagTemplate.content.firstElementChild.cloneNode(true);
      } else if (bagsBox && bagsBox.firstElementChild) {
        svg = bagsBox.firstElementChild.cloneNode(true);
        svg.classList.remove("is-full", "is-new");
      }
      return svg;
    }

    function drawBags(pence) {
      if (!bagsBox) return;
      var state = rb.bags(pence);
      var have = bagsBox.querySelectorAll(".rb-bag");
      // Bags are only ever added at the end or taken from the end, so a full one stays where it is.
      for (var i = have.length; i < state.drawn.length; i += 1) {
        var bag = newBag();
        if (!bag) break;
        bag.classList.add("is-new");
        bagsBox.appendChild(bag);
      }
      have = bagsBox.querySelectorAll(".rb-bag");
      for (var j = have.length - 1; j >= state.drawn.length; j -= 1) bagsBox.removeChild(have[j]);
      each(bagsBox.querySelectorAll(".rb-bag"), function (svg, n) {
        var f = state.drawn[n] || 0;
        // Anything in the bag at all shows, even a 10p pencil.
        var shown = f > 0 && f < 0.07 ? 0.07 : f;
        svg.style.setProperty("--rb-fill", String(Math.round(shown * 1000) / 1000));
        if (f >= 1) svg.classList.add("is-full");
        else svg.classList.remove("is-full");
      });
      bagsBox.setAttribute("data-count", String(state.drawn.length));
      if (more) {
        more.hidden = state.more === 0;
        setText(more, state.more ? "and " + state.more + " more" : "");
      }
    }

    // --- everything that follows the total ------------------------------------------------------
    function refresh() {
      var pence = total();
      drawBags(pence);
      setText(status, rb.statusLine(pence));
      setText(totalEl, rb.pounds(pence));
      if (perMonth) perMonth.hidden = !isMonthly();
      if (nudge && pence >= rb.MIN_PENCE) nudge.hidden = true;
      refreshDetails();
    }

    // --- the steppers ---------------------------------------------------------------------------
    each(builder.querySelectorAll("[data-rb-item]"), function (row) {
      var key = row.getAttribute("data-rb-item");
      var box = row.querySelector("input");
      var minus = row.querySelector("[data-rb-minus]");
      var plus = row.querySelector("[data-rb-plus]");
      if (!box) return;

      function set(n, write) {
        var q = rb.clampQuantity(n);
        quantities[key] = q;
        if (write) box.value = String(q);
        // They SAY they are off, and stay focusable: a button that switched itself off while it
        // held the focus would drop a keyboard user out of the list.
        if (minus) minus.setAttribute("aria-disabled", q <= 0 ? "true" : "false");
        if (plus) plus.setAttribute("aria-disabled", q >= rb.MAX_QUANTITY ? "true" : "false");
        if (q > 0) row.classList.add("is-in");
        else row.classList.remove("is-in");
        refresh();
      }

      // Typing counts at once, with no Enter; the box is only tidied when it is left, so a number
      // half typed is never rewritten under the fingers.
      box.addEventListener("input", function () {
        set(box.value, false);
      });
      box.addEventListener("blur", function () {
        set(box.value, true);
      });
      // Up and down arrows step it, as a number box would.
      box.addEventListener("keydown", function (e) {
        var step = e.key === "ArrowUp" ? 1 : e.key === "ArrowDown" ? -1 : 0;
        if (!step) return;
        e.preventDefault();
        set(rb.clampQuantity(box.value) + step, true);
      });
      box.addEventListener("focus", function () {
        if (typeof box.select === "function") {
          try {
            box.select();
          } catch (e) {
            /* selecting unavailable */
          }
        }
      });
      if (minus) {
        minus.addEventListener("click", function () {
          if (minus.getAttribute("aria-disabled") === "true") return;
          set(rb.clampQuantity(box.value) - 1, true);
        });
      }
      if (plus) {
        plus.addEventListener("click", function () {
          if (plus.getAttribute("aria-disabled") === "true") return;
          set(rb.clampQuantity(box.value) + 1, true);
        });
      }
      set(box.value, true);
    });

    // --- the examples: tap to add, tap again (or Remove) to take out ------------------------------
    function exampleButton(key) {
      return doc.querySelector('[data-rb-example="' + key + '"]');
    }

    function drawAlso() {
      if (!also || !alsoList) return;
      while (alsoList.firstChild) alsoList.removeChild(alsoList.firstChild);
      tapped.forEach(function (key) {
        var e = exampleOf(key);
        if (!e) return;
        var words = rb.pounds(e.pence) + " " + e.words;
        var li = doc.createElement("li");
        li.className = "rb-item";
        var span = doc.createElement("span");
        span.className = "rb-also__words";
        span.textContent = words;
        var remove = doc.createElement("button");
        remove.type = "button";
        remove.className = "rb-remove";
        remove.setAttribute("data-rb-remove", key);
        remove.setAttribute("aria-label", "Remove from your bag: " + words);
        remove.textContent = "Remove";
        remove.addEventListener("click", function () {
          setExample(key, false);
          focusOn(exampleButton(key));
        });
        li.appendChild(span);
        li.appendChild(remove);
        alsoList.appendChild(li);
      });
      also.hidden = tapped.length === 0;
    }

    function setExample(key, on) {
      var at = tapped.indexOf(key);
      if (on && at === -1) tapped.push(key);
      if (!on && at !== -1) tapped.splice(at, 1);
      var btn = exampleButton(key);
      if (btn) btn.setAttribute("aria-pressed", on ? "true" : "false");
      drawAlso();
      refresh();
    }

    each(doc.querySelectorAll("[data-rb-example]"), function (btn) {
      btn.addEventListener("click", function () {
        setExample(btn.getAttribute("data-rb-example"), btn.getAttribute("aria-pressed") !== "true");
      });
    });

    if (monthly) monthly.addEventListener("change", refresh);

    // --- Donate: the nudge, or on to the details step ----------------------------------------------
    function showStep(step) {
      builder.hidden = step !== "bag";
      if (need) need.hidden = step !== "bag";
      if (details) details.hidden = step !== "details";
      if (thanks) thanks.hidden = step !== "thanks";
      // "Pop a few things in the bag" is no thing to say to someone who has just filled one. Only
      // the line goes: the heading stays, and its section still clears the fixed header.
      var lede = doc.querySelector("[data-rb-lede]");
      if (lede) lede.hidden = step === "thanks";
    }

    if (donateBtn) {
      donateBtn.addEventListener("click", function () {
        if (total() < rb.MIN_PENCE) {
          if (nudge) nudge.hidden = false;
          return;
        }
        if (!details) return;
        showStep("details");
        refreshDetails();
        ensureStripeJs(doc, win);
        focusOn(doc.getElementById("rb-details-title"));
      });
    }
    var back = doc.querySelector("[data-rb-back]");
    if (back) {
      back.addEventListener("click", function () {
        showStep("bag");
        focusOn(donateBtn);
      });
    }

    // --- the details step ---------------------------------------------------------------------------
    function byId(id) {
      return doc.getElementById(id);
    }
    function val(id) {
      var e = byId(id);
      return e ? String(e.value || "").trim() : "";
    }
    function checked(id) {
      var e = byId(id);
      return !!(e && e.checked);
    }
    /** Hide a block and switch its controls off, so a hidden question is never asked or sent. */
    function showBlock(block, on) {
      if (!block) return;
      block.hidden = !on;
      each(block.querySelectorAll("input, select, textarea"), function (c) {
        c.disabled = !on;
      });
    }

    function refreshDetails() {
      if (!form) return;
      var pence = total();
      var month = isMonthly();
      var a = rb.pounds(pence);
      setText(doc.querySelector("[data-rb-details-total]"), a);
      var dm = doc.querySelector("[data-rb-details-monthly]");
      if (dm) dm.hidden = !month;
      // One off only: the card fee. Monthly only: 18 or over, and the all donations declaration.
      showBlock(form.querySelector("[data-rb-fee]"), !month);
      showBlock(form.querySelector("[data-rb-age]"), month);
      each(form.querySelectorAll("[data-rb-wording]"), function (w) {
        w.hidden = w.getAttribute("data-rb-wording") !== (month ? "monthly" : "once");
      });
      setText(form.querySelector("[data-rb-fee-amount]"), pence ? rb.pounds(Math.ceil((pence * CARD_FEE_BP) / 10000) + CARD_FEE_FIXED_PENCE) : "a little");
      setText(
        form.querySelector("[data-rb-giftaid-headline]"),
        pence ? "Make your " + a + " worth " + rb.pounds(Math.round(pence * 1.25)) : "Make your donation worth 25% more",
      );
      var giftAid = checked("rbGiftAid");
      var declaration = byId("rbDeclaration");
      if (declaration) {
        declaration.hidden = !giftAid;
        each(declaration.querySelectorAll("input"), function (c) {
          c.disabled = !giftAid;
        });
      }
      var abroad = giftAid && checked("rbNonUk");
      var postcodeField = byId("rbPostcodeField");
      var postcode = byId("rbPostcode");
      if (postcodeField) postcodeField.hidden = abroad;
      if (postcode) postcode.disabled = !giftAid || abroad;
      if (payBtn && !busy) payBtn.textContent = pence ? "Donate " + a + (month ? " a month" : "") : "Donate";
    }

    function payload() {
      var month = isMonthly();
      var body = {
        mode: month ? "monthly" : "once",
        plan: null,
        amount: total(),
        giftAid: checked("rbGiftAid"),
        coverFee: !month && checked("rbCoverFee"),
        donorType: "individual",
        fullName: (val("rbFirstName") + " " + val("rbSurname")).trim(),
        email: val("rbEmail"),
        emailConsent: checked("rbEmailConsent"),
      };
      if (month) body.ageConfirmed = checked("rbAgeConfirmed");
      if (body.giftAid) {
        var abroad = checked("rbNonUk");
        body.declaration = {
          firstName: val("rbFirstName"),
          lastName: val("rbSurname"),
          houseNameNumber: val("rbHouse"),
          address: val("rbAddress"),
          nonUk: abroad,
        };
        // A one off covers this donation; a monthly one is enduring, which the server sets itself.
        if (!month) body.declaration.scope = "this_donation";
        if (!abroad) body.declaration.postcode = val("rbPostcode");
      }
      body.redBag = true;
      return body;
    }

    function showError(words) {
      if (!summary) return;
      summary.textContent = words;
      summary.hidden = false;
      summary.setAttribute("tabindex", "-1");
      focusOn(summary);
    }

    function validate() {
      var shared = win.NBCCFormValidation;
      if (shared && typeof shared.validateForm === "function") {
        if (summary) summary.textContent = MSG.check;
        return shared.validateForm(form, { summary: summary }).valid;
      }
      if (typeof form.checkValidity === "function" && !form.checkValidity()) {
        showError(MSG.check);
        return false;
      }
      return true;
    }

    function setBusy(on) {
      busy = on;
      if (payBtn) {
        payBtn.disabled = on;
        if (on) payBtn.textContent = MSG.opening;
      }
      if (!on) refreshDetails();
    }

    function remember(body) {
      var s = storage(win);
      if (!s) return;
      try {
        s.setItem(GIFT_KEY, JSON.stringify({ pence: body.amount, giftAid: !!body.giftAid, monthly: body.mode === "monthly" }));
      } catch (e) {
        /* the thank you is simply the plain one */
      }
    }

    function post(body, uiMode) {
      var out = {};
      for (var k in body) if (Object.prototype.hasOwnProperty.call(body, k)) out[k] = body[k];
      if (uiMode) out.uiMode = uiMode;
      var headers = { "Content-Type": "application/json" };
      // While the page is switched off, the checkout takes a Red Bag gift only from signed in staff.
      // The session goes with it ONLY on the preview the server marked, never on the public page.
      if (preview) {
        var s = storage(win);
        var token = null;
        try {
          token = s ? s.getItem(ADMIN_TOKEN_KEY) : null;
        } catch (e) {
          token = null;
        }
        if (token) headers.Authorization = "Bearer " + token;
      }
      return win
        .fetch("/api/checkout-session", { method: "POST", headers: headers, body: JSON.stringify(out) })
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

    function handle(r) {
      if (r.status === 200) return true;
      setBusy(false);
      showError(r.status === 400 ? MSG.refused : r.status === 403 ? MSG.notOpen : MSG.down);
      return false;
    }

    function hosted(body) {
      post(body)
        .then(function (r) {
          if (!handle(r)) return;
          if (r.data.url) {
            remember(body);
            nav.assign(r.data.url);
          } else {
            setBusy(false);
            showError(MSG.down);
          }
        })
        .catch(function () {
          setBusy(false);
          showError(MSG.down);
        });
    }

    var mount = doc.getElementById("rbEmbeddedCheckout");
    function embeddedThenHosted(body) {
      if (typeof win.Stripe !== "function" || !mount) return hosted(body);
      post(body, "embedded")
        .then(function (r) {
          if (!handle(r)) return;
          if (!r.data.clientSecret || !r.data.publishableKey) return hosted(body);
          var stripe;
          try {
            stripe = win.Stripe(r.data.publishableKey);
          } catch (e) {
            return hosted(body);
          }
          return stripe
            .initEmbeddedCheckout({ clientSecret: r.data.clientSecret })
            .then(function (checkout) {
              embedded.instance = checkout;
              remember(body);
              openModal(doc);
              checkout.mount(mount);
              setBusy(false);
            })
            .catch(function () {
              closeModal(doc);
              hosted(body);
            });
        })
        .catch(function () {
          hosted(body);
        });
    }

    if (form) {
      form.addEventListener("input", refreshDetails);
      form.addEventListener("change", refreshDetails);
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        if (busy) return;
        if (summary) summary.hidden = true;
        if (total() < rb.MIN_PENCE) return showError(rb.WORDS.nudge);
        if (!validate()) return;
        if (typeof win.fetch !== "function") return showError(MSG.down);
        setBusy(true);
        embeddedThenHosted(payload());
      });
      wireModal(doc);
      // Back from Stripe's own page with the Back button: the browser brings this page out of its
      // back and forward cache exactly as it was left, the pay button still switched off and
      // saying "Opening secure payment". Make it ready again.
      if (typeof win.addEventListener === "function") {
        win.addEventListener("pageshow", function (e) {
          if (e && e.persisted) setBusy(false);
        });
      }
    }

    refresh();
    // The first bag was on the page already: it does not "arrive".
    each(doc.querySelectorAll("[data-rb-bags] .rb-bag"), function (b) {
      b.classList.remove("is-new");
    });

    // --- back from paying ---------------------------------------------------------------------------
    var search = String((win.location && win.location.search) || "");
    if (thanks && /[?&]thanks=1(&|$)/.test(search)) {
      showStep("thanks");
      initThanks(doc, win, rb, thanks);
    }

    return { total: total, payload: payload };
  }

  // The thank you. The payment's id (session_id, which Stripe filled in) comes straight out of the
  // address bar, so it is never copied, shared, bookmarked or kept in the history. The total is what
  // this tab remembered before leaving for Stripe; missing or odd, the plain thank you stays.
  function initThanks(doc, win, rb, thanks) {
    var loc = win.location;
    if (/[?&]session_id=/.test(String(loc.search || "")) && win.history && typeof win.history.replaceState === "function") {
      try {
        win.history.replaceState(null, "", loc.pathname + "?thanks=1");
      } catch (e) {
        /* the address stays as it is */
      }
    }
    var gift = null;
    var s = storage(win);
    if (s) {
      try {
        gift = JSON.parse(s.getItem(GIFT_KEY) || "null");
        s.removeItem(GIFT_KEY);
      } catch (e) {
        gift = null;
      }
    }
    var ok = gift && typeof gift.pence === "number" && isFinite(gift.pence) && gift.pence >= rb.MIN_PENCE && Math.floor(gift.pence) === gift.pence;
    var totalLine = thanks.querySelector("[data-rb-thanks-total]");
    var plain = thanks.querySelector("[data-rb-thanks-plain]");
    var aid = thanks.querySelector("[data-rb-thanks-giftaid]");
    if (ok && totalLine) {
      setText(thanks.querySelector("[data-rb-thanks-amount]"), rb.pounds(gift.pence) + (gift.monthly ? " a month" : ""));
      totalLine.hidden = false;
      if (plain) plain.hidden = true;
      if (aid && gift.giftAid === true) {
        setText(thanks.querySelector("[data-rb-thanks-giftaid-amount]"), rb.pounds(Math.round(gift.pence * 0.25)));
        aid.hidden = false;
      }
    }
    each(thanks.querySelectorAll(".rb-bag"), function (b) {
      b.classList.add("is-full");
    });
    focusOn(thanks.querySelector("[data-rb-thanks-panel]"));
    initShare(doc, win, thanks);
  }

  // --- the picture to share: "I filled a Red Bag", and never an amount -----------------------------
  // Drawn on a canvas in the browser, the way the fundraisers' social pictures are
  // (assets/js/fundraise-social.js): no image library on the server, and nothing leaves the page
  // until the giver chooses to share or save it.
  var C = { cream: "#F8F5EE", crimson: "#C02238", maroon: "#800000", tan: "#D29C8A", tanSoft: "#F3E4DD", slate: "#333333", holly: "#1A531A" };

  function drawPicture(canvas, win) {
    var ctx = null;
    try {
      ctx = canvas.getContext("2d");
    } catch (e) {
      ctx = null;
    }
    if (!ctx || typeof win.Path2D !== "function") return false;
    var W = canvas.width;
    var H = canvas.height;
    ctx.fillStyle = C.cream;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = C.maroon;
    ctx.lineWidth = 6;
    ctx.strokeRect(36, 36, W - 72, H - 72);

    // The bag: the page's own drawing (src/red-bag/render.ts), full, four times the size.
    var k = 4.3;
    ctx.save();
    ctx.translate((W - 120 * k) / 2, 96);
    ctx.scale(k, k);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = C.maroon;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 3.4;
    ctx.stroke(new win.Path2D("M44 36C44 10 88 10 88 36"));
    ctx.globalAlpha = 1;
    ctx.fillStyle = C.cream;
    ctx.strokeStyle = C.tan;
    ctx.lineWidth = 1.2;
    var tissue = new win.Path2D("M22 38l9-13 8 9 9-14 9 13 9-12 8 11 9-9 7 15z");
    ctx.fill(tissue);
    ctx.stroke(tissue);
    var body = new win.Path2D("M12 36h96v88a4 4 0 0 1-4 4H16a4 4 0 0 1-4-4z");
    ctx.fillStyle = C.crimson;
    ctx.fill(body);
    ctx.fillStyle = C.maroon;
    ctx.globalAlpha = 0.16;
    ctx.fill(new win.Path2D("M92 36h16v88a4 4 0 0 1-4 4H92z"));
    ctx.globalAlpha = 0.12;
    ctx.fill(new win.Path2D("M12 36h96v10H12z"));
    ctx.globalAlpha = 0.4;
    ctx.strokeStyle = C.maroon;
    ctx.lineWidth = 1;
    ctx.stroke(new win.Path2D("M12 46h96M92 46v82"));
    ctx.globalAlpha = 1;
    ctx.strokeStyle = C.crimson;
    ctx.lineWidth = 3.4;
    ctx.stroke(new win.Path2D("M32 40C32 12 76 12 76 40"));
    ctx.fillStyle = C.maroon;
    ctx.beginPath();
    ctx.arc(32, 41, 2.2, 0, Math.PI * 2);
    ctx.arc(76, 41, 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.textAlign = "center";
    ctx.fillStyle = C.crimson;
    ctx.font = '800 96px "Playfair Display", Georgia, serif';
    ctx.fillText("I filled a Red Bag", W / 2, 800);
    ctx.fillStyle = C.holly;
    ctx.fillRect(W / 2 - 150, 838, 300, 4);
    ctx.fillStyle = C.slate;
    ctx.font = '400 40px "Poppins", system-ui, sans-serif';
    ctx.fillText("Fill one too at nbcc.scot/fill-a-red-bag", W / 2, 912);
    ctx.font = '400 26px "Poppins", system-ui, sans-serif';
    ctx.fillText("Night Before Christmas Campaign (NBCC). Scottish Charity SC047995.", W / 2, 984);
    return true;
  }

  function initShare(doc, win, thanks) {
    var box = thanks.querySelector("[data-rb-share]");
    var canvas = box ? box.querySelector("[data-rb-share-picture]") : null;
    if (!box || !canvas) return null;
    var status = box.querySelector("[data-rb-share-status]");
    var save = box.querySelector("[data-rb-share-save]");
    var send = box.querySelector("[data-rb-share-send]");
    var words = "I filled a Red Bag with NBCC. You can fill one too: " + PAGE_URL;

    function finish() {
      if (!drawPicture(canvas, win)) {
        canvas.hidden = true;
        return;
      }
      var url = "";
      try {
        url = canvas.toDataURL("image/png");
      } catch (e) {
        url = "";
      }
      if (save && url) {
        save.href = url;
        save.hidden = false;
      }
      var nav = win.navigator || {};
      if (send && typeof nav.share === "function" && typeof canvas.toBlob === "function" && typeof win.File === "function") {
        send.hidden = false;
        send.addEventListener("click", function () {
          canvas.toBlob(function (blob) {
            if (!blob) return;
            var file = new win.File([blob], "i-filled-a-red-bag.png", { type: "image/png" });
            var data = { text: words };
            if (typeof nav.canShare === "function" && nav.canShare({ files: [file] })) data.files = [file];
            nav.share(data).then(
              function () {
                setText(status, "Thank you for sharing.");
              },
              function () {
                /* they closed the share sheet: nothing to say */
              },
            );
          }, "image/png");
        });
      }
    }

    // The words are drawn in the page's own faces, so wait for them where the browser can say.
    var fonts = doc.fonts;
    if (fonts && typeof fonts.load === "function") {
      Promise.all([fonts.load('800 96px "Playfair Display"'), fonts.load('400 40px "Poppins"')]).then(finish, finish);
    } else {
      finish();
    }

    // Copy the link, shown only where copying works (as on a fundraiser's page).
    var copy = box.querySelector("[data-rb-copy-link]");
    var clip = win.navigator && win.navigator.clipboard;
    if (copy && clip && typeof clip.writeText === "function") {
      copy.hidden = false;
      copy.addEventListener("click", function () {
        clip.writeText(PAGE_URL).then(
          function () {
            setText(status, "Link copied. You can paste it anywhere.");
          },
          function () {
            setText(status, "Copying did not work here. The link is " + PAGE_URL);
          },
        );
      });
    }
    return box;
  }

  // --- Stripe on the page: the donate page's modal, driven from here ---------------------------------
  var embedded = { instance: null };

  function ensureStripeJs(doc, win) {
    if (typeof win.Stripe === "function" || doc.getElementById("stripe-js-sdk")) return;
    if (!doc.getElementById("rbEmbeddedCheckout") || !doc.head) return;
    var s = doc.createElement("script");
    s.id = "stripe-js-sdk";
    s.src = "https://js.stripe.com/v3/";
    s.async = true;
    doc.head.appendChild(s);
  }

  function openModal(doc) {
    var modal = doc.getElementById("rbCheckoutModal");
    if (modal) {
      modal.hidden = false;
      modal.setAttribute("aria-hidden", "false");
    }
    if (doc.body) doc.body.classList.add("give-embedded-open");
    focusOn(doc.getElementById("rbCheckoutClose"));
  }

  function closeModal(doc) {
    var modal = doc.getElementById("rbCheckoutModal");
    if (modal) {
      modal.hidden = true;
      modal.setAttribute("aria-hidden", "true");
    }
    if (doc.body) doc.body.classList.remove("give-embedded-open");
    if (embedded.instance) {
      try {
        embedded.instance.destroy();
      } catch (e) {
        /* already gone */
      }
      embedded.instance = null;
    }
    var mount = doc.getElementById("rbEmbeddedCheckout");
    if (mount) mount.innerHTML = "";
    focusOn(doc.querySelector("[data-rb-pay]"));
  }

  function wireModal(doc) {
    var close = doc.getElementById("rbCheckoutClose");
    var modal = doc.getElementById("rbCheckoutModal");
    if (!close || !modal || close.__rbWired) return;
    close.__rbWired = true;
    close.addEventListener("click", function () {
      closeModal(doc);
    });
    doc.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !modal.hidden) closeModal(doc);
    });
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { initRedBag: initRedBag };
  } else {
    initRedBag(document, window);
  }
})();
