/* The Kilmarnock Santa Sleigh page, /sleigh (src/sleigh/page.ts draws it).

   - the amount keys and an amount of your own, with the Give button saying the amount
   - Gift Aid: the home address asked only when it is ticked
   - the gift goes to the site's checkout as a one off Santa Sleigh gift, and on to Stripe
   - the year's total counts up when the road comes into view
   - the little sleigh drives along the road to tonight's house (or the next one)

   Nothing waits for motion, and none of it moves for anyone who asks for less. */
(function () {
  "use strict";

  var MIN_PENCE = 200;
  var MSG = {
    check: "Please check the boxes marked in red.",
    small: "Please give £2 or more",
    opening: "Opening secure payment",
    refused: "Something in the form was not accepted. Please check it and try again.",
    down: "We could not open the payment just now. Please try again in a moment.",
  };

  function pounds(pence) {
    var whole = Math.floor(pence / 100);
    var rest = Math.round(pence % 100);
    return "£" + whole.toLocaleString("en-GB") + (rest ? "." + String(rest).padStart(2, "0") : "");
  }

  /** "12", "12.5", "£12.50" typed in the box, in pence; NaN for anything else. */
  function typedPence(text) {
    var t = String(text || "").replace(/[£,\s]/g, "");
    if (!/^\d{1,6}(\.\d{1,2})?$/.test(t)) return NaN;
    return Math.round(parseFloat(t) * 100);
  }

  function initSleigh(doc, win) {
    var still = !!(win.matchMedia && win.matchMedia("(prefers-reduced-motion: reduce)").matches);
    var form = doc.getElementById("slGive");
    var payBtn = doc.getElementById("slPay");
    var payWords = doc.getElementById("slPayWords");
    var status = doc.getElementById("slStatus");
    var other = doc.getElementById("slOther");
    var keys = form ? Array.prototype.slice.call(form.querySelectorAll(".sl-key")) : [];
    var amount = 1000;
    var busy = false;
    var nav = win.location;

    function val(id) {
      var el = doc.getElementById(id);
      return el ? String(el.value || "").trim() : "";
    }
    function checked(id) {
      var el = doc.getElementById(id);
      return !!(el && el.checked);
    }
    function say(text, isError) {
      if (!status) return;
      status.textContent = text || "";
      status.classList.toggle("is-error", !!isError);
      status.setAttribute("role", isError ? "alert" : "status");
    }
    function refresh() {
      if (payWords && !busy) payWords.textContent = amount >= MIN_PENCE ? "Give " + pounds(amount) : "Give to the sleigh";
    }

    // --- the amount -------------------------------------------------------------------------
    function choose(btn) {
      keys.forEach(function (k) {
        var on = k === btn;
        k.classList.toggle("is-on", on);
        k.setAttribute("aria-pressed", String(on));
        if (on && !still) {
          k.classList.remove("is-pop");
          void k.offsetWidth;
          k.classList.add("is-pop");
        }
      });
    }
    keys.forEach(function (k) {
      k.addEventListener("click", function () {
        amount = Number(k.getAttribute("data-amount"));
        if (other) other.value = "";
        markField(other, "");
        choose(k);
        refresh();
      });
    });
    if (other) {
      other.addEventListener("input", function () {
        var p = typedPence(other.value);
        if (other.value.trim() === "") {
          var on = keys.filter(function (k) { return k.classList.contains("is-on"); })[0];
          amount = on ? Number(on.getAttribute("data-amount")) : 0;
        } else {
          choose(null);
          amount = isNaN(p) ? 0 : p;
        }
        if (amount >= MIN_PENCE) markField(other, "");
        refresh();
      });
    }

    // --- Gift Aid ---------------------------------------------------------------------------
    var giftAid = doc.getElementById("slGiftAid");
    var decl = doc.getElementById("slDeclaration");
    var nonUk = doc.getElementById("slNonUk");
    function refreshGiftAid() {
      var on = checked("slGiftAid");
      if (decl) decl.hidden = !on;
      ["slHouse", "slAddress", "slPostcode", "slNonUk"].forEach(function (id) {
        var el = doc.getElementById(id);
        if (el) el.disabled = !on;
      });
      var pc = doc.getElementById("slPostcode");
      if (pc && on) pc.disabled = checked("slNonUk");
    }
    if (giftAid) giftAid.addEventListener("change", refreshGiftAid);
    if (nonUk) nonUk.addEventListener("change", refreshGiftAid);

    // --- checking the form ------------------------------------------------------------------
    function markField(input, message) {
      if (!input) return;
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
      if (amount < MIN_PENCE) {
        markField(other, MSG.small);
        first = other;
      }
      Array.prototype.forEach.call(form.querySelectorAll("input[required], input[pattern]"), function (input) {
        if (input.disabled || input === other) return;
        var bad = typeof input.checkValidity === "function" && !input.checkValidity();
        markField(input, bad ? input.getAttribute("data-invalid-message") || MSG.check : "");
        if (bad && !first) first = input;
      });
      if (first) {
        say(MSG.check, true);
        if (typeof first.focus === "function") first.focus();
        return false;
      }
      return true;
    }
    if (form) {
      form.addEventListener("input", function (e) {
        var t = e.target;
        if (t && t !== other && t.getAttribute && t.getAttribute("aria-invalid") === "true" && typeof t.checkValidity === "function" && t.checkValidity()) markField(t, "");
      });
    }

    function payload() {
      var body = {
        mode: "once",
        plan: null,
        amount: amount,
        sleigh: true,
        giftAid: checked("slGiftAid"),
        donorType: "individual",
        fullName: (val("slFirstName") + " " + val("slSurname")).trim(),
        email: val("slEmail"),
        // The page before this one, so the checkout can note what brought the giver (never kept here).
        cameFrom: doc.referrer,
      };
      if (body.giftAid) {
        var abroad = checked("slNonUk");
        body.declaration = {
          firstName: val("slFirstName"),
          lastName: val("slSurname"),
          houseNameNumber: val("slHouse"),
          address: val("slAddress"),
          nonUk: abroad,
          scope: "this_donation",
        };
        if (!abroad) body.declaration.postcode = val("slPostcode");
      }
      return body;
    }

    // Busy is said with aria-disabled, never `disabled`, so the focus stays and a failure is heard.
    function setBusy(on) {
      busy = on;
      if (payBtn) payBtn.setAttribute("aria-disabled", String(on));
      if (on && payWords) payWords.textContent = MSG.opening;
      if (!on) refresh();
    }
    function failed(text) {
      setBusy(false);
      say(text, true);
    }

    if (form) {
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
              function (data) { return { status: res.status, data: data || {} }; },
              function () { return { status: res.status, data: {} }; },
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
    }
    // Back from Stripe's page, the browser may bring the page back as it was left: make it ready.
    if (typeof win.addEventListener === "function") {
      win.addEventListener("pageshow", function (e) {
        if (e && e.persisted) setBusy(false);
      });
    }

    // --- the total and the little sleigh ----------------------------------------------------
    var totalEl = doc.querySelector("[data-total]");
    var num = doc.getElementById("slTotal");
    var houses = doc.querySelector(".sl-houses");
    var mini = doc.getElementById("slMini");
    var card = doc.querySelector(".sl-card");

    function countUp() {
      if (!totalEl || !num || still || typeof win.requestAnimationFrame !== "function") return;
      var to = Number(totalEl.getAttribute("data-total")) || 0;
      if (to <= 0) return;
      var start = null;
      var ms = 1600;
      num.textContent = pounds(0);
      function frame(t) {
        if (start === null) start = t;
        var k = Math.min(1, (t - start) / ms);
        var eased = 1 - Math.pow(1 - k, 4);
        num.textContent = pounds(k < 1 ? Math.round((to * eased) / 100) * 100 : to);
        if (k < 1) win.requestAnimationFrame(frame);
      }
      win.requestAnimationFrame(frame);
    }

    /** Where the little sleigh sits for house `i`: over its rooftop, or just past the last house. */
    function spot(i) {
      var items = houses ? houses.querySelectorAll(".sl-house") : [];
      if (!items.length || !card) return null;
      var c = card.getBoundingClientRect();
      var last = i >= items.length;
      var li = items[Math.min(i, items.length - 1)];
      var art = li.querySelector(".sl-house__art") || li;
      var a = art.getBoundingClientRect();
      // Flying just over the rooftop: on a phone, where the road runs down the page, over the house's
      // left side; past the last house afterwards.
      var down = houses.getBoundingClientRect().width < 500;
      var box = mini.getBoundingClientRect();
      var w = box.width || 80;
      var h = box.height || 56;
      var x = down ? a.left - c.left - w * 0.35 : a.left - c.left + a.width / 2 - w / 2 + (last ? a.width * 1.6 : 0);
      var y = down ? a.top - c.top - h * 0.7 + (last ? a.height + 40 : 0) : a.top - c.top - h + 2;
      return "translate(" + Math.round(x) + "px," + Math.round(y) + "px)";
    }
    function place(to, animate) {
      if (!mini) return;
      var at = spot(to);
      if (!at) return;
      mini.style.setProperty("--at", at);
      if (!animate) mini.style.transition = "none";
      mini.style.transform = at;
      if (!animate) {
        void mini.offsetWidth;
        mini.style.transition = "";
      }
    }
    var stop = houses ? Number(houses.getAttribute("data-stop")) || 0 : 0;
    var driven = false;
    function drive() {
      if (driven || !mini) return;
      driven = true;
      if (still) {
        place(stop, false);
        mini.classList.add("is-ready", "is-there");
        return;
      }
      place(0, false);
      mini.classList.add("is-ready");
      win.setTimeout(function () {
        place(stop, true);
        win.setTimeout(function () { mini.classList.add("is-there"); }, 1900);
      }, 250);
    }
    if (mini) {
      if (typeof win.addEventListener === "function") {
        win.addEventListener("resize", function () {
          if (driven) place(stop, false);
        });
      }
    }

    var road = doc.getElementById("nights");
    if (road && typeof win.IntersectionObserver === "function") {
      var seen = new win.IntersectionObserver(
        function (entries) {
          if (!entries.some(function (e) { return e.isIntersecting; })) return;
          seen.disconnect();
          countUp();
          drive();
        },
        { threshold: 0.25 },
      );
      seen.observe(road);
    } else {
      drive();
    }

    if (payBtn) payBtn.setAttribute("aria-disabled", "false");
    refresh();
    refreshGiftAid();

    return {
      amount: function () { return amount; },
      payload: payload,
      typedPence: typedPence,
    };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { initSleigh: initSleigh, typedPence: typedPence };
  } else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      initSleigh(document, window);
    });
  } else {
    initSleigh(document, window);
  }
})();
