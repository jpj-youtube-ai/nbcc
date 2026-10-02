// "Thank your supporters" in the fundraising private area, /fundraise/manage (TASK-507).
//
// The private area's own script (fundraise-manage.js) draws one card per fundraiser once the
// organiser has signed in. This one watches for those cards and, for each with gifts to thank or
// thank yous to show, adds a part from the <template data-thanks-pattern> in the page, just after
// "Latest gifts and messages":
//   - their gifts, as the gifts list shows them (a name or Anonymous, the amount unless hidden, the
//     message, the date), each with a tick box; one already in a thank you is marked and closed, as a
//     gift is thanked at most once. Ten show, then the rest on asking;
//   - "Select all not yet thanked", which ticks every one still open, the hidden ones too;
//   - a short message (600 characters at most), and Send for checking, to
//     POST /api/fundraise/manage/fundraisers/:id/thanks, where it waits for staff;
//   - the thank yous sent so far, each saying where it is up to ("Waiting for us to check", "Sent to
//     3 supporters", "Not sent").
// NBCC emails each thank you, so no address is ever shown here or sent here. Kept apart from
// fundraise-manage.js so each can change without the other.
//
// A classic <script defer>, exported under a CommonJS guard so it can be unit tested in jsdom.
(function () {
  "use strict";

  var API = "/api/fundraise/manage";
  var MAX = 600;
  var FIRST = 10;

  var MSG = {
    sending: "Sending…",
    thanks: "Thank you. We will check it soon, then email it to the supporters you picked.",
    some: " Some you picked had been thanked already, so we left those out.",
    pick: "Tick at least one gift to thank",
    failed: "We could not send your thank you just now. Please try again in a few minutes.",
    signIn: "Please sign in again: refresh this page and we will send you a new code.",
    check: "Please check the highlighted answers below and try again.",
  };

  var LONG_DATE = (function () {
    try {
      return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "long", year: "numeric" });
    } catch (e) {
      return null;
    }
  })();
  function longDate(iso) {
    try {
      return LONG_DATE ? LONG_DATE.format(new Date(iso)) : String(iso).slice(0, 10);
    } catch (e) {
      return "";
    }
  }
  function money(pence) {
    var n = Number(pence) || 0;
    var whole = n % 100 === 0;
    try {
      return "£" + (n / 100).toLocaleString("en-GB", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
    } catch (e) {
      return "£" + (whole ? String(n / 100) : (n / 100).toFixed(2));
    }
  }
  function plural(n, one, many) {
    return n + " " + (n === 1 ? one : many);
  }

  function initThanks(doc, win) {
    var pattern = doc.querySelector("template[data-thanks-pattern]");
    var list = doc.querySelector("[data-manage-list]");
    if (!pattern || !list) return null;
    var queued = false;

    function say(node, text, kind) {
      if (!node) return;
      node.textContent = text;
      node.className = "form-status" + (kind ? " is-" + kind : "");
    }
    function readJson(res) {
      return res.json().then(
        function (data) {
          return { status: res.status, data: data || {} };
        },
        function () {
          return { status: res.status, data: {} };
        },
      );
    }
    function validate(form, summary, extra) {
      var shared = win.NBCCFormValidation;
      if (shared && typeof shared.validateForm === "function") {
        if (summary) summary.textContent = MSG.check;
        return shared.validateForm(form, {
          summary: summary || undefined,
          extraChecks: function () {
            return extra || [];
          },
        }).valid;
      }
      return !(extra && extra.length) && (typeof form.checkValidity !== "function" || form.checkValidity());
    }
    function el(tag, cls, text) {
      var n = doc.createElement(tag);
      if (cls) n.className = cls;
      if (text !== undefined && text !== null) n.textContent = text;
      return n;
    }

    // Every id in the copy gets the fundraiser's id on the end, and every reference with it.
    function giveOwnIds(part, fid) {
      var suffix = "-thanks-" + fid;
      var ids = {};
      Array.prototype.forEach.call(part.querySelectorAll("[id]"), function (n) {
        ids[n.id] = true;
        n.id = n.id + suffix;
      });
      var all = [part].concat(Array.prototype.slice.call(part.querySelectorAll("[for], [aria-labelledby], [aria-describedby]")));
      all.forEach(function (n) {
        ["for", "aria-labelledby", "aria-describedby"].forEach(function (attr) {
          var v = n.getAttribute(attr);
          if (!v) return;
          n.setAttribute(
            attr,
            v
              .split(/\s+/)
              .map(function (t) {
                return ids[t] ? t + suffix : t;
              })
              .join(" "),
          );
        });
      });
    }

    // --- the gifts to pick ---------------------------------------------------------------------------
    function giftItem(fid, g) {
      var li = el("li", "fr-thanks__gift" + (g.thanked ? " is-thanked" : ""));
      var id = "thanksGift-" + fid + "-" + Number(g.donationId);
      var label = el("label", "give-check fr-thanks__check");
      label.setAttribute("for", id);
      var box = el("input", "give-check-box");
      box.type = "checkbox";
      box.id = id;
      box.value = String(Number(g.donationId));
      box.setAttribute("data-thanks-gift", "");
      box.disabled = !!g.thanked;
      label.appendChild(box);
      var words = el("span", "give-check-text fr-thanks__words");
      // Spaces between the parts, so a screen reader reads the label as words, not one run.
      var head = el("span", "fr-wall__head");
      head.appendChild(el("span", "fr-wall__who", g.name || "Anonymous"));
      if (g.amountPence !== null && g.amountPence !== undefined) {
        head.appendChild(doc.createTextNode(" "));
        head.appendChild(el("span", "fr-wall__amount", money(g.amountPence)));
      }
      words.appendChild(head);
      if (g.message) {
        words.appendChild(doc.createTextNode(" "));
        words.appendChild(el("span", "fr-wall__msg fr-thanks__msg", g.message));
      }
      words.appendChild(doc.createTextNode(" "));
      words.appendChild(el("span", "fr-wall__when", longDate(g.createdAt)));
      if (g.thanked) {
        words.appendChild(doc.createTextNode(" "));
        words.appendChild(el("span", "fr-thanks__done", "Thanked"));
      }
      label.appendChild(words);
      li.appendChild(label);
      return li;
    }

    function openBoxes(part) {
      return Array.prototype.filter.call(part.querySelectorAll("input[data-thanks-gift]"), function (b) {
        return !b.disabled;
      });
    }
    function picked(part) {
      return openBoxes(part).filter(function (b) {
        return b.checked;
      });
    }
    function showPicked(part) {
      var n = picked(part).length;
      var line = part.querySelector("[data-thanks-picked]");
      if (line) line.textContent = n ? n + " picked" : "";
      var all = part.querySelector("[data-thanks-all]");
      if (all) all.hidden = openBoxes(part).length === 0;
    }

    // --- the thank yous so far ------------------------------------------------------------------------
    function pastItem(t) {
      var li = el("li", "fr-wall__item fr-thanks__sent");
      var status = el("p", "fr-thanks__status is-" + String(t.status || "pending").replace(/[^a-z]/g, ""), t.statusWords || "");
      li.appendChild(status);
      li.appendChild(doc.createTextNode(" "));
      li.appendChild(el("p", "fr-wall__msg", t.message || ""));
      li.appendChild(doc.createTextNode(" "));
      var n = Number(t.gifts) || 0;
      li.appendChild(el("p", "fr-wall__when", "Sent for checking on " + longDate(t.createdAt) + ", for " + plural(n, "gift", "gifts")));
      return li;
    }
    function fillPast(part, thanks) {
      var wrap = part.querySelector("[data-thanks-past]");
      var ol = part.querySelector("[data-thanks-list]");
      ol.innerHTML = "";
      thanks.forEach(function (t) {
        ol.appendChild(pastItem(t));
      });
      wrap.hidden = thanks.length === 0;
    }

    function addPart(card, f) {
      var source = pattern.content ? pattern.content.firstElementChild : pattern.firstElementChild;
      if (!source) return;
      var part = source.cloneNode(true);
      giveOwnIds(part, f.id);
      var after = card.querySelector("[data-f-gifts-part]");
      if (after && after.parentNode) after.parentNode.insertBefore(part, after.nextSibling);
      else card.appendChild(part);

      var gifts = Array.isArray(f.gifts) ? f.gifts : [];
      var thanks = Array.isArray(f.thanks) ? f.thanks.slice() : [];
      var ol = part.querySelector("[data-thanks-gifts]");
      gifts.forEach(function (g, i) {
        var li = giftItem(f.id, g);
        if (i >= FIRST) li.hidden = true;
        ol.appendChild(li);
      });
      var more = part.querySelector("[data-thanks-more]");
      more.hidden = gifts.length <= FIRST;
      more.textContent = "Show all " + gifts.length;
      more.addEventListener("click", function () {
        Array.prototype.forEach.call(ol.querySelectorAll("li"), function (li) {
          li.hidden = false;
        });
        more.hidden = true;
      });
      fillPast(part, thanks);

      var form = part.querySelector("form[data-thanks-form]");
      // Nothing left to pick and nothing to write: only the thank yous so far.
      if (!f.canThank || gifts.length === 0) {
        form.hidden = true;
        return;
      }
      part.querySelector("[data-thanks-all]").addEventListener("click", function () {
        openBoxes(part).forEach(function (b) {
          b.checked = true;
        });
        showPicked(part);
      });
      ol.addEventListener("change", function () {
        showPicked(part);
      });
      showPicked(part);
      wireForm(part, form, f, thanks);
    }

    function wireForm(part, form, f, thanks) {
      var box = form.querySelector('textarea[name="message"]');
      var count = form.querySelector("[data-thanks-count]");
      var status = form.querySelector("[data-thanks-status]");
      var summary = form.querySelector("[data-thanks-error]");
      var submit = form.querySelector("[data-thanks-submit]");

      function counted() {
        var left = MAX - String(box.value || "").length;
        count.textContent = left === MAX ? "Up to 600 characters." : left === 1 ? "1 character left." : left + " characters left.";
      }
      // A box grows with what is typed, so nothing scrolls inside it.
      function grow() {
        if (!box.scrollHeight) return;
        box.style.height = "auto";
        box.style.height = box.scrollHeight + 4 + "px";
        box.style.overflowY = "hidden";
      }
      box.addEventListener("input", function () {
        counted();
        grow();
      });

      // "Tick at least one gift" is said once, above the list, rather than inside the first gift's
      // label: the shared checker reuses a message line that already has the control's id + "-error".
      function pickMessageFor(first) {
        var id = first.id + "-error";
        if (!doc.getElementById(id)) {
          var line = el("p", "validation-msg fr-thanks__pick-msg");
          line.id = id;
          line.hidden = true;
          var tools = part.querySelector(".fr-thanks__tools");
          tools.parentNode.insertBefore(line, tools.nextSibling);
        }
      }
      function pickCheck() {
        var first = openBoxes(part)[0];
        if (picked(part).length > 0 || !first) return [];
        pickMessageFor(first);
        return [{ control: first, message: MSG.pick }];
      }
      part.querySelector("[data-thanks-gifts]").addEventListener("change", function () {
        if (picked(part).length === 0) return;
        Array.prototype.forEach.call(part.querySelectorAll(".fr-thanks__pick-msg"), function (line) {
          line.hidden = true;
        });
      });

      form.addEventListener("submit", function (e) {
        e.preventDefault();
        if (submit && submit.disabled) return;
        say(status, "", null);
        if (!validate(form, summary, pickCheck())) return;
        var chosen = picked(part);
        if (submit) submit.disabled = true;
        say(status, MSG.sending, "pending");
        var body = {
          message: String(box.value || "").trim(),
          donationIds: chosen.map(function (b) {
            return Number(b.value);
          }),
        };
        win
          .fetch(API + "/fundraisers/" + encodeURIComponent(f.id) + "/thanks", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify(body),
          })
          .then(readJson)
          .then(function (r) {
            if (submit) submit.disabled = false;
            if (r.status === 202 && r.data.thanks) {
              thanks.unshift(r.data.thanks);
              fillPast(part, thanks);
              chosen.forEach(function (b) {
                b.checked = false;
                b.disabled = true;
                var li = b.closest ? b.closest("li") : null;
                if (li) {
                  li.classList.add("is-thanked");
                  var words = li.querySelector(".fr-thanks__words");
                  if (words && !words.querySelector(".fr-thanks__done")) {
                    words.appendChild(doc.createTextNode(" "));
                    words.appendChild(el("span", "fr-thanks__done", "Thanked"));
                  }
                }
              });
              showPicked(part);
              box.value = "";
              counted();
              box.style.height = "";
              return say(status, MSG.thanks + (Number(r.data.alreadyThanked) > 0 ? MSG.some : ""), "success");
            }
            if (r.status === 400 && r.data.fields) {
              say(status, "", null);
              var checks = [];
              if (r.data.fields.message) checks.push({ control: box, message: r.data.fields.message });
              var first = openBoxes(part)[0];
              if (r.data.fields.donationIds && first) {
                pickMessageFor(first);
                checks.push({ control: first, message: r.data.fields.donationIds });
              }
              if (checks.length) return validate(form, summary, checks);
            }
            if (r.status === 401) return say(status, MSG.signIn, "error");
            say(status, r.data.error || MSG.failed, "error");
          })
          .catch(function () {
            if (submit) submit.disabled = false;
            say(status, MSG.failed, "error");
          });
      });
    }

    // --- finding the cards --------------------------------------------------------------------------
    function waiting() {
      return Array.prototype.filter.call(list.querySelectorAll("[data-fundraiser]"), function (card) {
        return !card.hasAttribute("data-thanks-seen");
      });
    }

    function load() {
      queued = false;
      var cards = waiting();
      if (!cards.length) return null;
      cards.forEach(function (card) {
        card.setAttribute("data-thanks-seen", "");
      });
      return win
        .fetch(API + "/thanks", { credentials: "same-origin" })
        .then(readJson)
        .then(function (r) {
          if (r.status !== 200 || !r.data || !Array.isArray(r.data.fundraisers)) return;
          var byId = {};
          r.data.fundraisers.forEach(function (f) {
            if (f && f.id !== undefined) byId[String(f.id)] = f;
          });
          cards.forEach(function (card) {
            var f = byId[card.getAttribute("data-fundraiser")];
            // Only where there is something to thank, or thank yous to look back on.
            if (!f) return;
            var gifts = Array.isArray(f.gifts) ? f.gifts : [];
            var thanks = Array.isArray(f.thanks) ? f.thanks : [];
            if (!(f.canThank && gifts.length) && !thanks.length) return;
            if (!list.contains(card) || card.querySelector("[data-thanks-part]")) return;
            addPart(card, f);
          });
        })
        .catch(function () {
          /* the rest of the private area works without it */
        });
    }

    function schedule() {
      if (queued) return;
      queued = true;
      Promise.resolve().then(load);
    }

    var Observer = win.MutationObserver || (typeof MutationObserver !== "undefined" ? MutationObserver : null);
    if (Observer) new Observer(schedule).observe(list, { childList: true });
    schedule();
    return { refresh: schedule };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { initThanks: initThanks };
  } else if (typeof document !== "undefined") {
    initThanks(document, window);
  }
})();
