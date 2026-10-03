// One question at a time, with Next and Back and a cheerful progress bar (the sign up tidy, Jaimie,
// 2026-10-03). Shared by the sign up form (/fundraise, fundraise.js) and the team join form
// (fundraise-join.js), each passing its own steps, stage names and checks.
//
//   - Steps are the form's [data-step] blocks. Only one shows at a time; a step with the hidden
//     attribute (not on their path) is skipped. They come in the order of their stage, then the page.
//   - The progress bar shows stages, not questions (questions branch): each one done is ticked, the
//     one they are on is marked aria-current="step", and its words say "Step 2 of 5" in text, never
//     by colour alone. Near the end the words lift ("Nearly there!", "Last step!") where the form
//     says so.
//   - Next checks only the step showing: nothing goes red while they type, and on Next anything
//     missing gets its own short, warm prompt (the form's data-invalid-message words, through
//     main.js's shared highlighting) with the focus moved to it. Back keeps every answer.
//   - Each new step is said in a polite live region, and the focus moves to the step, so a keyboard
//     or screen reader user always knows where they are.
//
// Its own file, never main.js (donate.html's page weight budget). A classic <script defer>, exported
// under a CommonJS guard so it can be unit tested in jsdom.
(function () {
  "use strict";

  function create(form, opts) {
    var doc = opts.doc;
    var win = opts.win;
    var steps = opts.steps.slice();
    var nav = opts.nav;
    var backBtn = nav ? nav.querySelector("[data-back]") : null;
    var nextBtn = nav ? nav.querySelector("[data-next]") : null;
    var progress = opts.progress;
    var news = opts.news;
    var current = null;

    function stageOf(step) {
      var n = opts.stageOf ? Number(opts.stageOf(step)) : Number(step.getAttribute("data-stage"));
      return isFinite(n) && n > 0 ? n : 1;
    }

    /** The steps in play, in the order they come: by stage, then as the page has them. */
    function inPlay() {
      return steps
        .map(function (s, i) {
          return { s: s, i: i, stage: stageOf(s) };
        })
        .filter(function (x) {
          return !x.s.hidden;
        })
        .sort(function (a, b) {
          return a.stage - b.stage || a.i - b.i;
        })
        .map(function (x) {
          return x.s;
        });
    }

    function titleOf(step) {
      if (step.getAttribute("data-step-title")) return step.getAttribute("data-step-title");
      var t = step.querySelector("legend, h2, label");
      return t ? String(t.textContent || "").replace(/\s+/g, " ").replace(/\*/g, "").trim() : "";
    }

    function names() {
      return opts.stages ? opts.stages() : [];
    }

    function renderProgress() {
      if (!progress || !current) return;
      var list = names();
      var at = stageOf(current);
      var count = list.length;
      var stepWords = progress.querySelector("[data-progress-step]");
      var liftWords = progress.querySelector("[data-progress-lift]");
      var ol = progress.querySelector("[data-progress-list]");
      if (stepWords) stepWords.textContent = "Step " + at + " of " + count + ": " + (list[at - 1] || "");
      var lift = opts.lift ? opts.lift(at, count) || "" : "";
      if (liftWords) {
        liftWords.textContent = lift ? " " + lift : "";
        liftWords.hidden = !lift;
      }
      if (!ol) return;
      ol.style.setProperty("--stages", String(count));
      while (ol.firstChild) ol.removeChild(ol.firstChild);
      list.forEach(function (name, i) {
        var n = i + 1;
        var li = doc.createElement("li");
        li.className = "fr-progress__stage" + (n < at ? " is-done" : n === at ? " is-current" : "");
        if (n === at) li.setAttribute("aria-current", "step");
        var dot = doc.createElement("span");
        dot.className = "fr-progress__dot";
        dot.setAttribute("aria-hidden", "true");
        dot.textContent = n < at ? "✓" : String(n);
        var label = doc.createElement("span");
        label.className = "fr-progress__label";
        label.textContent = name;
        var state = doc.createElement("span");
        state.className = "sr-only";
        state.textContent = n < at ? ", done" : n === at ? ", you are here" : "";
        li.appendChild(dot);
        li.appendChild(label);
        li.appendChild(state);
        ol.appendChild(li);
      });
    }

    function renderNav() {
      if (!nav || !current) return;
      var list = inPlay();
      var i = list.indexOf(current);
      if (backBtn) backBtn.hidden = i <= 0;
      if (nextBtn) nextBtn.hidden = i === list.length - 1;
      nav.classList.toggle("is-first", i <= 0);
    }

    function show(step, o) {
      o = o || {};
      if (!step) return;
      current = step;
      steps.forEach(function (s) {
        var on = s === step;
        s.classList.toggle("is-off", !on);
        s.classList.toggle("is-current", on);
        if (!on) s.classList.remove("is-arriving");
      });
      if (o.animate) {
        step.classList.remove("is-arriving");
        // Restart the short rise and fade (none for anyone who asks for less motion, by CSS).
        void step.offsetWidth;
        step.classList.add("is-arriving");
      }
      if (opts.onShow) opts.onShow(step);
      renderProgress();
      renderNav();
      if (o.announce && news) {
        var list = names();
        var at = stageOf(step);
        news.textContent = "Step " + at + " of " + list.length + ", " + (list[at - 1] || "") + ": " + titleOf(step);
      }
      if (o.focus) {
        if (!step.hasAttribute("tabindex")) step.setAttribute("tabindex", "-1");
        try {
          step.focus({ preventScroll: true });
        } catch (e) {
          /* focus unavailable */
        }
        var top = progress && !progress.hidden ? progress : form;
        if (top && typeof top.scrollIntoView === "function") {
          try {
            top.scrollIntoView({ block: "start", behavior: "smooth" });
          } catch (e) {
            /* scrolling unavailable */
          }
        }
      }
    }

    function next() {
      if (!current) return false;
      if (opts.validate && !opts.validate(current)) return false;
      if (opts.canLeave && !opts.canLeave(current)) return false;
      var list = inPlay();
      var i = list.indexOf(current);
      if (i < 0 || i >= list.length - 1) return false;
      show(list[i + 1], { focus: true, announce: true, animate: true });
      return true;
    }

    function back() {
      if (!current) return false;
      var list = inPlay();
      var i = list.indexOf(current);
      if (i <= 0) return false;
      if (opts.clear) opts.clear(current);
      show(list[i - 1], { focus: true, announce: true, animate: true });
      return true;
    }

    /**
     * After an answer changes which steps are in play: keep the step showing, or if it has just gone,
     * the next one in play after where it was. The progress bar and buttons follow.
     */
    function refresh() {
      if (!current) return;
      if (current.hidden) {
        var all = steps.slice();
        var from = all.indexOf(current);
        var list = inPlay();
        var after = list.filter(function (s) {
          return all.indexOf(s) > from;
        })[0];
        show(after || list[list.length - 1]);
        return;
      }
      renderProgress();
      renderNav();
    }

    /** Go straight to a step (a problem found on Send, or a server message), without checking. */
    function goTo(step) {
      if (!step || step.hidden) return;
      show(step, { announce: true });
    }

    function stepOf(control) {
      for (var n = control; n && n !== form; n = n.parentElement) if (steps.indexOf(n) !== -1) return n;
      return null;
    }

    if (backBtn) backBtn.addEventListener("click", back);
    if (nextBtn) nextBtn.addEventListener("click", next);
    form.classList.add("fr-wizard");
    if (nav) nav.hidden = false;
    if (progress) progress.hidden = false;
    show(inPlay()[0]);
    if (news) news.textContent = "";

    return {
      next: next,
      back: back,
      refresh: refresh,
      goTo: goTo,
      stepOf: stepOf,
      inPlay: inPlay,
      current: function () {
        return current;
      },
      isLast: function () {
        var list = inPlay();
        return list.indexOf(current) === list.length - 1;
      },
    };
  }

  /**
   * Check just one step with main.js's shared highlighting, if it is there: every control in play in
   * the step, plus any extra problems. Returns true when all is well. The summary at the top of the
   * form is left alone: the warm prompt sits by each box, and the focus goes to the first.
   */
  function checkStep(win, step, extra) {
    var shared = win.NBCCFormValidation;
    if (shared && typeof shared.validateForm === "function") {
      var quiet = step.ownerDocument.createElement("p");
      return shared.validateForm(step, { summary: quiet, extraChecks: extra }).valid;
    }
    // Without main.js: the browser's own check, step by step.
    var controls = step.querySelectorAll("input, select, textarea");
    for (var i = 0; i < controls.length; i++) {
      var c = controls[i];
      var hidden = false;
      for (var n = c; n && n !== step; n = n.parentElement) if (n.hidden) hidden = true;
      if (hidden || c.disabled || !c.willValidate) continue;
      if (c.validity && !c.validity.valid) {
        try {
          c.focus();
        } catch (e) {
          /* focus unavailable */
        }
        return false;
      }
    }
    var more = extra ? extra() : [];
    return !more.length;
  }

  var api = { create: create, checkStep: checkStep };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    window.NBCCFormSteps = api;
  }
})();
