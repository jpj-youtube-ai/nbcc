// Red bags at the Festive Ball: the page each table card's QR code opens, /bag, and its thank you,
// /bag/thank-you (src/ball/bags-page.ts draws both; docs/superpowers/specs/2026-11-02-ball-table-bags-design.md).
//
// On /bag this moves from the welcome to "how many bags", keeps the count (1 to 20), the row of bags,
// the words, the total and the button in step, opens Gift Aid's questions when it is ticked, and
// sends the gift to the donate page's checkout (src/routes/api.ts) with the marker ballBags: the
// number of bags. It sends NO amount: the server prices the bags itself. Paid on Stripe's own page,
// the guest comes back to /bag/thank-you; Back from Stripe comes back here.
//
// On the thank you it takes the payment's id out of the address bar and lands the focus on the
// heading. The celebration there is the stylesheet's alone.
//
// Every move is the stylesheet's (assets/css/ball-bags.css), with transform and opacity only, and
// none of it plays for someone who asked for less motion. Nothing here waits for an animation.
//
// Small and on its own, so the page loads quickly on a hotel's mobile signal. A classic
// <script defer>, exported under a CommonJS guard so it can be unit tested in jsdom.
(function () {
  "use strict";

  // Kept in step with the server: BALL_BAG_PENCE and BALL_BAGS_MAX (src/ball/bags.ts), and
  // BAGS_DRAWN_MAX (src/ball/bags-page.ts).
  var BAG_PENCE = 5000;
  var MAX_BAGS = 20;
  var DRAWN_MAX = 10;

  var MSG = {
    check: "Please check the highlighted answers above and try again.",
    opening: "Opening secure payment…",
    refused: "Something in the form needs another look. Please check it and try again.",
    down: "Payment is not working just now. Please try again in a moment.",
  };

  function pounds(pence) {
    var whole = Math.floor(pence / 100);
    var rest = pence % 100;
    var shown = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return rest ? "£" + shown + "." + (rest < 10 ? "0" : "") + rest : "£" + shown;
  }

  function bagWords(n) {
    return n === 1 ? "1 full red bag" : n + " full red bags";
  }

  function lessMotion(win) {
    try {
      return !win || typeof win.matchMedia !== "function" || !!win.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch (e) {
      return true;
    }
  }

  function focusOn(el) {
    if (!el) return;
    try {
      el.focus();
    } catch (e) {
      /* focus unavailable */
    }
  }

  // Plays a one off class again from the start: off, a read of the layout, on.
  function replay(el, cls, win) {
    if (!el || lessMotion(win)) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }

  // --- the thank you ----------------------------------------------------------------------

  function initThanks(doc, win) {
    var loc = (win && win.location) || {};
    // The payment's id never stays in the address bar, the history or a shared link.
    if (/[?&]session_id=/.test(String(loc.search || "")) && win.history && typeof win.history.replaceState === "function") {
      try {
        win.history.replaceState(null, "", loc.pathname);
      } catch (e) {
        /* the address stays as it is */
      }
    }
    focusOn(doc.getElementById("bbThanksTitle"));
    return { thanks: true };
  }

  // --- the page ---------------------------------------------------------------------------

  function initBallBags(doc, win, nav) {
    win = win || {};
    if (doc.querySelector("[data-bb-thanks]")) return initThanks(doc, win);
    nav = nav || win.location;

    var welcome = doc.getElementById("bbWelcome");
    var howMany = doc.getElementById("bbHowMany");
    var form = doc.getElementById("bbForm");
    if (!welcome || !howMany || !form) return null;

    var countEl = doc.getElementById("bbCount");
    var wordsEl = doc.getElementById("bbWords");
    var totalEl = doc.getElementById("bbTotal");
    var row = doc.getElementById("bbRow");
    var rowMore = doc.getElementById("bbRowMore");
    var art = doc.getElementById("bbBagArt");
    var less = doc.getElementById("bbLess");
    var more = doc.getElementById("bbMore");
    var giveBtn = doc.getElementById("bbGive");
    var status = doc.getElementById("bbStatus");
    var giftAid = doc.getElementById("bbGiftAid");
    var declaration = doc.getElementById("bbDeclaration");
    var aidAdds = doc.getElementById("bbGiftAidAdds");
    var nonUk = doc.getElementById("bbNonUk");
    var postcodeField = doc.getElementById("bbPostcodeField");
    var postcode = doc.getElementById("bbPostcode");

    var count = 1;
    var busy = false;

    function val(id) {
      var e = doc.getElementById(id);
      return e ? String(e.value || "").trim() : "";
    }
    function checked(id) {
      var e = doc.getElementById(id);
      return !!(e && e.checked);
    }

    // --- the screens -----------------------------------------------------------------------
    function show(screen) {
      var toHowMany = screen === "how-many";
      welcome.hidden = toHowMany;
      howMany.hidden = !toHowMany;
      var shown = toHowMany ? howMany : welcome;
      replay(shown, "is-entering", win);
      if (doc.body) doc.body.setAttribute("data-bb-at", screen);
      focusOn(doc.getElementById(toHowMany ? "bbHowManyTitle" : "bbWelcomeTitle"));
    }

    var start = doc.getElementById("bbStart");
    if (start) {
      start.addEventListener("click", function () {
        // A step in the phone's history, so its Back button returns to the welcome, not away.
        if (win.history && typeof win.history.pushState === "function") {
          try {
            win.history.pushState({ bb: "how-many" }, "", "#how-many");
          } catch (e) {
            /* no history step */
          }
        }
        show("how-many");
      });
    }
    var back = doc.getElementById("bbBack");
    if (back) {
      back.addEventListener("click", function () {
        if (win.history && typeof win.history.back === "function" && String((win.location || {}).hash || "") === "#how-many") {
          win.history.back();
          return;
        }
        show("welcome");
      });
    }
    if (typeof win.addEventListener === "function") {
      win.addEventListener("popstate", function () {
        show(String((win.location || {}).hash || "") === "#how-many" ? "how-many" : "welcome");
      });
    }

    // --- the count -------------------------------------------------------------------------
    function drawRow(grew) {
      if (!row) return;
      var drawn = row.querySelectorAll(".bb-bag");
      var want = Math.min(count, DRAWN_MAX);
      var i;
      for (i = drawn.length - 1; i >= want; i -= 1) drawn[i].parentNode.removeChild(drawn[i]);
      for (i = drawn.length; i < want; i += 1) {
        var bag = art && art.content ? art.content.firstElementChild.cloneNode(true) : null;
        if (!bag) break;
        bag.style.setProperty("--i", "0");
        if (grew && !lessMotion(win)) bag.classList.add("is-new");
        row.insertBefore(bag, rowMore || null);
      }
      if (rowMore) {
        var extra = count - want;
        rowMore.hidden = extra <= 0;
        rowMore.textContent = "+" + Math.max(0, extra);
        if (grew && extra > 0) replay(rowMore, "is-bumped", win);
      }
    }

    function refresh() {
      var pence = count * BAG_PENCE;
      if (countEl) countEl.textContent = String(count);
      if (wordsEl) wordsEl.textContent = bagWords(count);
      if (totalEl) totalEl.textContent = pounds(pence);
      if (giveBtn && !busy) giveBtn.textContent = "Give " + pounds(pence);
      if (aidAdds) aidAdds.textContent = "Gift Aid adds " + pounds(pence / 4) + " to your " + pounds(pence) + ".";
      if (less) less.setAttribute("aria-disabled", String(count <= 1));
      if (more) more.setAttribute("aria-disabled", String(count >= MAX_BAGS));
    }

    function setCount(n) {
      var next = Math.max(1, Math.min(MAX_BAGS, Math.floor(n) || 1));
      if (next === count) {
        replay(next >= MAX_BAGS ? more : less, "is-stuck", win);
        return;
      }
      var grew = next > count;
      count = next;
      drawRow(grew);
      refresh();
      replay(countEl, "is-bumped", win);
    }

    // Never disabled: a disabled button drops the focus. At the end it gives a small shake instead.
    if (less) less.addEventListener("click", function () { setCount(count - 1); });
    if (more) more.addEventListener("click", function () { setCount(count + 1); });

    // --- Gift Aid ---------------------------------------------------------------------------
    function refreshGiftAid() {
      var on = !!(giftAid && giftAid.checked);
      if (declaration) {
        var opening = declaration.hidden && on;
        declaration.hidden = !on;
        // A hidden question is never asked or sent.
        Array.prototype.forEach.call(declaration.querySelectorAll("input"), function (c) {
          c.disabled = !on;
        });
        if (opening) replay(declaration, "is-entering", win);
      }
      var abroad = on && !!(nonUk && nonUk.checked);
      if (postcodeField) postcodeField.hidden = abroad;
      if (postcode) postcode.disabled = !on || abroad;
    }
    form.addEventListener("change", refreshGiftAid);

    // --- checking and sending --------------------------------------------------------------
    function say(text, isError) {
      if (!status) return;
      status.textContent = text;
      status.hidden = !text;
      status.classList.toggle("is-error", !!isError);
      if (isError) replay(status, "is-entering", win);
    }

    function markField(input, message) {
      var err = doc.getElementById(input.id + "Error");
      if (message) input.setAttribute("aria-invalid", "true");
      else input.removeAttribute("aria-invalid");
      if (err) {
        err.textContent = message || "";
        err.hidden = !message;
      }
      if (message && err) input.setAttribute("aria-describedby", err.id);
      else input.removeAttribute("aria-describedby");
    }

    function validate() {
      var first = null;
      Array.prototype.forEach.call(form.querySelectorAll("input[required], input[pattern]"), function (input) {
        if (input.disabled) return markField(input, "");
        var bad = typeof input.checkValidity === "function" && !input.checkValidity();
        markField(input, bad ? input.getAttribute("data-invalid-message") || MSG.check : "");
        if (bad && !first) first = input;
      });
      if (first) {
        say(MSG.check, true);
        focusOn(first);
        return false;
      }
      return true;
    }

    // A field put right clears its own message as soon as it is.
    form.addEventListener("input", function (e) {
      var t = e.target;
      if (t && t.getAttribute && t.getAttribute("aria-invalid") === "true" && typeof t.checkValidity === "function" && t.checkValidity()) markField(t, "");
    });

    function payload() {
      var body = {
        mode: "once",
        plan: null,
        ballBags: count,
        giftAid: checked("bbGiftAid"),
        donorType: "individual",
        fullName: (val("bbFirstName") + " " + val("bbSurname")).trim(),
        email: val("bbEmail"),
      };
      if (body.giftAid) {
        var abroad = checked("bbNonUk");
        body.declaration = {
          firstName: val("bbFirstName"),
          lastName: val("bbSurname"),
          houseNameNumber: val("bbHouse"),
          address: val("bbAddress"),
          nonUk: abroad,
          scope: "this_donation",
        };
        if (!abroad) body.declaration.postcode = val("bbPostcode");
      }
      return body;
    }

    function setBusy(on) {
      busy = on;
      if (giveBtn) {
        giveBtn.disabled = on;
        giveBtn.classList.toggle("is-busy", on);
        if (on) giveBtn.textContent = MSG.opening;
      }
      if (!on) refresh();
    }

    function failed(text) {
      setBusy(false);
      say(text, true);
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (busy) return;
      say("", false);
      if (!validate()) return;
      if (typeof win.fetch !== "function") return failed(MSG.down);
      setBusy(true);
      win
        .fetch("/api/checkout-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload()),
        })
        .then(function (res) {
          return res.json().then(
            function (data) {
              return { status: res.status, data: data || {} };
            },
            function () {
              return { status: res.status, data: {} };
            },
          );
        })
        .then(function (r) {
          if (r.status !== 200) return failed(r.status === 400 ? MSG.refused : MSG.down);
          if (!r.data.url) return failed(MSG.down);
          nav.assign(r.data.url);
        })
        .catch(function () {
          failed(MSG.down);
        });
    });

    // Back from Stripe's own page: the browser may bring this page back exactly as it was left, the
    // button still saying "Opening secure payment". Make it ready again.
    if (typeof win.addEventListener === "function") {
      win.addEventListener("pageshow", function (e) {
        if (e && e.persisted) setBusy(false);
      });
    }

    refresh();
    refreshGiftAid();
    // Opened at #how-many (a reload part way through): straight to the count.
    if (String((win.location || {}).hash || "") === "#how-many") show("how-many");

    return {
      count: function () {
        return count;
      },
      payload: payload,
    };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { initBallBags: initBallBags };
  } else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      initBallBags(document, window);
    });
  } else {
    initBallBags(document, window);
  }
})();
