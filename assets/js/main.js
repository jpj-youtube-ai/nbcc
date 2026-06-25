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

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { initNav, initReveal };
  } else {
    initNav(document, window);
    initReveal(document, window);
  }
})();
