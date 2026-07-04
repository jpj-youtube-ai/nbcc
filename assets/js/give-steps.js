// Donate step wizard (donate.html only). Progressive disclosure: the full gift
// form is split into three steps — 1) choose an amount, 2) your details + Gift
// Aid opt-in, 3) Gift Aid declaration + confirm — so a donor is never faced with
// the whole form at once. All field ids and the checkout payload are unchanged;
// main.js still wires the once/monthly toggle, donor-type, contact and
// declaration logic. This file only handles step navigation, tier selection, and
// triggering window.startCheckout (exposed by main.js) at the final step.
// Progressive enhancement: without JS the fields are all present and usable.
(function () {
  "use strict";
  var root = document.querySelector("[data-give-steps]");
  if (!root) return;

  var reduce =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
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
    var el = document.getElementById("customAmount");
    var v = el ? parseFloat(el.value) : NaN;
    return isFinite(v) && v > 0 ? Math.round(v * 100) : 0;
  }
  function select(btn) { clearSelection(); btn.classList.add("is-selected"); selected = btn; hideErr(1); }

  choosers.forEach(function (btn) {
    btn.addEventListener("click", function () {
      if (btn.classList.contains("give-custom-go")) {
        if (!customPence()) { showErr(1); var ci = document.getElementById("customAmount"); if (ci) ci.focus(); return; }
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
    var dl = document.getElementById("giveReview");
    if (!dl || !selected) return;
    var mode = selected.getAttribute("data-mode") || "once";
    var plan = selected.getAttribute("data-plan") || "";
    var pence = parseInt(selected.getAttribute("data-amount"), 10) || customPence();
    var pounds = pence / 100;
    var amountStr = "£" + (pounds % 1 === 0 ? pounds.toFixed(0) : pounds.toFixed(2));
    var giftAidEl = document.getElementById("giftAid");
    var rows = [
      ["Your gift", amountStr + (mode === "monthly" ? " a month" : ", one off") +
        (plan ? ", " + plan.charAt(0).toUpperCase() + plan.slice(1) : "")],
      ["Gift Aid", giftAidEl && giftAidEl.checked ? "Yes, add 25%" : "Not added"],
    ];
    dl.innerHTML = "";
    rows.forEach(function (r) {
      var dt = document.createElement("dt"); dt.textContent = r[0];
      var dd = document.createElement("dd"); dd.textContent = r[1];
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
      if (el.focus) el.focus();
      var top = root.getBoundingClientRect().top + window.scrollY - 90;
      window.scrollTo({ top: top, behavior: reduce ? "auto" : "smooth" });
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
    if (typeof window.startCheckout === "function") window.startCheckout(selected);
  }

  Array.prototype.forEach.call(root.querySelectorAll("[data-give-next]"), function (b) { b.addEventListener("click", next); });
  Array.prototype.forEach.call(root.querySelectorAll("[data-give-prev]"), function (b) { b.addEventListener("click", prev); });
  var payBtn = root.querySelector("[data-give-pay]");
  if (payBtn) payBtn.addEventListener("click", pay);

  go(1, 0, true); // initial state, no scroll/focus
})();
