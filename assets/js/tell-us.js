// The Tell us forms on Your business, Your school and Your club or group.
//
// They send through the contact form's own path, POST /api/contact, so main.js's initContactForm does
// the checking, the sending and the thank you, and contact-captcha.js does the spam check. That path
// takes a name, an email, a phone number and one message, so all this does is write the message: the
// page it came from, the business or school, the ticks and anything else, each on a line of its own,
// which is how staff read it in the admin's inbox.
//
// On the document in the capture phase, like the spam check, so the message is written before
// main.js reads it during the same submit. A classic <script defer>, exported under a CommonJS guard
// so it can be unit-tested in jsdom, like main.js.
(function () {
  "use strict";

  function answer(el) {
    if (el.tagName !== "FIELDSET") return (el.value || "").trim();
    return Array.prototype.map
      .call(el.querySelectorAll("input:checked"), function (box) {
        return box.value;
      })
      .join(", ");
  }

  function tellUsMessage(form) {
    var lines = ["Sent from the " + form.getAttribute("data-tell-page") + " page."];
    Array.prototype.forEach.call(form.querySelectorAll("[data-tell]"), function (el) {
      var said = answer(el);
      if (said) lines.push(el.getAttribute("data-tell") + ": " + said);
    });
    return lines.join("\n");
  }

  function initTellUs(doc) {
    var form = doc.getElementById("contactForm");
    var message = doc.getElementById("message");
    if (!form || !message || !form.hasAttribute("data-tell-page")) return;
    doc.addEventListener(
      "submit",
      function (e) {
        if (e.target === form) message.value = tellUsMessage(form);
      },
      true,
    );
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { initTellUs: initTellUs, tellUsMessage: tellUsMessage };
  } else {
    initTellUs(document);
  }
})();
