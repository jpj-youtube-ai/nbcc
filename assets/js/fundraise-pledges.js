// "Sponsor pledges" in the fundraising private area, /fundraise/manage (Jaimie, 2026-10-03).
//
// The private area's own script (fundraise-manage.js) draws one card per fundraiser once the
// organiser has signed in. This one watches for those cards and, for each whose page has pledges,
// adds a part from the <template data-pledges-pattern> in the page, just after "Latest gifts":
//   - the totals ("£35 pledged, £25 paid");
//   - each sponsor by name (never an email: none is ever sent here), the amount, and where it is up
//     to: not paid yet, paid online, paid in cash, cancelled. Ten show, then the rest on asking;
//   - "Paid me in cash" on a pledge still to be paid, to
//     POST /api/fundraise/manage/fundraisers/:id/pledges/:pledgeId/cash, and Undo after it;
//   - "Hide from my page" on a pledge still to be paid (.../hide): it comes off the page, the NBCC
//     team are told, and it is still a pledge. Only pledges their sponsor confirmed by email are here.
// A pledge is a promise: it is never part of what they have raised until it is paid. Kept apart from
// fundraise-manage.js so each can change without the other.
//
// A classic <script defer>, exported under a CommonJS guard so it can be unit tested in jsdom.
(function () {
  "use strict";

  var API = "/api/fundraise/manage";
  var FIRST = 10;
  var MSG = {
    saving: "Saving…",
    cash: "Saved. Remember to add it to the cash you pay in.",
    undone: "Saved. It is back to not paid yet.",
    hidden: "Hidden from your page. We have let the NBCC team know. It is still a pledge.",
    shown: "Saved. It is back on your page.",
    failed: "We could not save that just now. Please try again in a few minutes.",
    signIn: "Please sign in again: refresh this page and we will send you a new code.",
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

  function initPledges(doc, win) {
    var pattern = doc.querySelector("template[data-pledges-pattern]");
    var list = doc.querySelector("[data-manage-list]");
    if (!pattern || !list) return null;
    var queued = false;

    function el(tag, cls, text) {
      var n = doc.createElement(tag);
      if (cls) n.className = cls;
      if (text !== undefined && text !== null) n.textContent = text;
      return n;
    }
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

    // Every id in the copy gets the fundraiser's id on the end, and every reference with it.
    function giveOwnIds(part, fid) {
      var suffix = "-pledges-" + fid;
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

    function totalsWords(t) {
      var words = money(t.pledgedPence) + " pledged, " + money(t.paidPence) + " paid";
      if (t.cashCount) words += ", " + money(t.cashPence) + " paid to you in cash";
      words += ".";
      var gone = (Number(t.cancelledCount) || 0);
      if (gone) words += " " + gone + " cancelled.";
      if (t.expiredCount) words += " " + t.expiredCount + " not paid.";
      return words;
    }

    // What changed on one pledge, kept in step with the totals without asking the server again.
    function recount(pledges) {
      var t = { openCount: 0, openPence: 0, paidCount: 0, paidPence: 0, cashCount: 0, cashPence: 0, cancelledCount: 0, expiredCount: 0, pledgedPence: 0 };
      pledges.forEach(function (p) {
        var a = Number(p.amountPence) || 0;
        if (p.status === "open") {
          t.openCount += 1;
          t.openPence += a;
        } else if (p.status === "paid") {
          t.paidCount += 1;
          t.paidPence += p.paidAmountPence == null ? a : Number(p.paidAmountPence);
        } else if (p.status === "cash") {
          t.cashCount += 1;
          t.cashPence += a;
        } else if (p.status === "cancelled") t.cancelledCount += 1;
        else t.expiredCount += 1;
        if (p.status === "open" || p.status === "paid" || p.status === "cash") t.pledgedPence += a;
      });
      return t;
    }

    function addPart(card, f) {
      var source = pattern.content ? pattern.content.firstElementChild : pattern.firstElementChild;
      if (!source) return;
      var part = source.cloneNode(true);
      giveOwnIds(part, f.id);
      var after = card.querySelector("[data-f-gifts-part]");
      if (after && after.parentNode) after.parentNode.insertBefore(part, after.nextSibling);
      else card.appendChild(part);

      var pledges = f.pledges.slice();
      var ol = part.querySelector("[data-pledges-list]");
      var totals = part.querySelector("[data-pledges-totals]");
      var status = part.querySelector("[data-pledges-status]");
      var more = part.querySelector("[data-pledges-more]");
      var showAll = false;

      function item(p, i) {
        var li = el("li", "fr-pledges__row is-" + p.status);
        if (!showAll && i >= FIRST) li.hidden = true;
        var head = el("p", "fr-wall__head");
        head.appendChild(el("span", "fr-wall__who", p.name));
        head.appendChild(el("span", "fr-wall__amount", money(p.amountPence)));
        li.appendChild(head);
        var paidMore = p.status === "paid" && p.paidAmountPence != null && Number(p.paidAmountPence) !== Number(p.amountPence);
        var state = el("p", "fr-pledges__state", p.statusWords + (paidMore ? ", " + money(p.paidAmountPence) : ""));
        li.appendChild(state);
        var when = "Pledged on " + longDate(p.createdAt) + (p.giftAid ? ", with Gift Aid" : "");
        li.appendChild(el("p", "fr-wall__when", when));
        if (p.hidden) li.appendChild(el("p", "fr-pledges__hidden", "Hidden from your page"));
        if (p.canMarkCash || p.canUnmarkCash) {
          var btn = el("button", "fr-link-btn fr-pledges__cash", p.canMarkCash ? "Paid me in cash" : "Undo");
          btn.type = "button";
          btn.setAttribute("aria-label", (p.canMarkCash ? "Paid me in cash: " : "Undo paid in cash: ") + p.name);
          btn.addEventListener("click", function () {
            send(p, "cash", { paid: !!p.canMarkCash }, btn, p.canMarkCash ? MSG.cash : MSG.undone);
          });
          li.appendChild(btn);
        }
        if (p.canHide) {
          var hide = el("button", "fr-link-btn fr-pledges__cash", p.hidden ? "Show on my page" : "Hide from my page");
          hide.type = "button";
          hide.setAttribute("aria-label", (p.hidden ? "Show on my page: " : "Hide from my page: ") + p.name);
          hide.addEventListener("click", function () {
            send(p, "hide", { hidden: !p.hidden }, hide, p.hidden ? MSG.shown : MSG.hidden);
          });
          li.appendChild(hide);
        }
        return li;
      }

      function draw() {
        while (ol.firstChild) ol.removeChild(ol.firstChild);
        pledges.forEach(function (p, i) {
          ol.appendChild(item(p, i));
        });
        if (totals) totals.textContent = totalsWords(recount(pledges));
        if (more) {
          more.hidden = showAll || pledges.length <= FIRST;
          more.textContent = "Show all " + pledges.length + " pledges";
        }
      }
      if (more) {
        more.addEventListener("click", function () {
          showAll = true;
          draw();
        });
      }

      function send(p, what, body, btn, done) {
        btn.disabled = true;
        say(status, MSG.saving, null);
        win
          .fetch(API + "/fundraisers/" + encodeURIComponent(f.id) + "/pledges/" + encodeURIComponent(p.id) + "/" + what, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify(body),
          })
          .then(readJson)
          .then(function (r) {
            if (r.status === 200 && r.data.pledge) {
              pledges = pledges.map(function (x) {
                return x.id === p.id ? r.data.pledge : x;
              });
              draw();
              return say(status, done, "success");
            }
            btn.disabled = false;
            if (r.status === 401) return say(status, MSG.signIn, "error");
            say(status, r.data.error || MSG.failed, "error");
          })
          .catch(function () {
            btn.disabled = false;
            say(status, MSG.failed, "error");
          });
      }

      draw();
    }

    // --- finding the cards --------------------------------------------------------------------------
    function waiting() {
      return Array.prototype.filter.call(list.querySelectorAll("[data-fundraiser]"), function (card) {
        return !card.hasAttribute("data-pledges-seen");
      });
    }

    function load() {
      queued = false;
      var cards = waiting();
      if (!cards.length) return null;
      cards.forEach(function (card) {
        card.setAttribute("data-pledges-seen", "");
      });
      return win
        .fetch(API + "/pledges", { credentials: "same-origin" })
        .then(readJson)
        .then(function (r) {
          if (r.status !== 200 || !r.data || !Array.isArray(r.data.fundraisers)) return;
          var byId = {};
          r.data.fundraisers.forEach(function (f) {
            if (f && f.id !== undefined) byId[String(f.id)] = f;
          });
          cards.forEach(function (card) {
            var f = byId[card.getAttribute("data-fundraiser")];
            if (!f || !Array.isArray(f.pledges) || !f.pledges.length) return;
            if (!list.contains(card) || card.querySelector("[data-pledges-part]")) return;
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
    module.exports = { initPledges: initPledges };
  } else if (typeof document !== "undefined") {
    initPledges(document, window);
  }
})();
