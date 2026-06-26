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

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { initNav, initReveal, initGiveToggle, initContactForm };
  } else {
    initNav(document, window);
    initReveal(document, window);
    initGiveToggle(document);
    initContactForm(document, window);
  }
})();
