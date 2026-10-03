// Event tickets in the fundraising private area, /fundraise/manage (Jaimie, points 23 and 24).
//
// The private area's own script (fundraise-manage.js) draws one card per fundraiser once the
// organiser has signed in. This one watches for those cards and asks
// GET /api/fundraise/manage/fundraisers/:id/tickets for each (anything that is not an event selling
// tickets through NBCC answers 404, and gets nothing). An event's card gets "Your tickets", before
// "All done?":
//   - the money, ticket money apart from gifts, and how many tickets are sold;
//   - each kind of ticket and where it is up to (on sale, or waiting for us to approve);
//   - the guest list for the door, to print;
//   - a form to propose more kinds of ticket or a limit (POST .../tickets/propose): staff approve
//     every ticket before it goes on sale;
//   - the bookings, by name and tickets only, each with "Ask for a refund" (POST
//     .../tickets/refund-request). An organiser can only ASK: NBCC makes the refund.
//
// Kept apart from fundraise-manage.js so each can change without the other. Built with the DOM (never
// innerHTML), so nothing a buyer typed can be read as markup. A classic <script defer>, exported
// under a CommonJS guard so it can be unit tested in jsdom.
(function () {
  "use strict";

  var API = "/api/fundraise/manage/fundraisers/";
  var ALL_MONEY =
    "Choose this only if all the ticket money is going to NBCC. If you’re sharing ticket money with another cause or keeping some for costs, sell them your own way and pay NBCC its share afterwards.";
  var COSTS = "If you have costs, like the hall, talk to us: we can repay agreed costs against receipts.";
  var STATE_WORDS = {
    open: "Tickets are on sale on your event’s page.",
    soon: "Nothing is on sale yet: we are checking your tickets.",
    sold_out: "Sold out.",
    closed: "Ticket sales are closed.",
    started: "Ticket sales have closed, as the event has started.",
    finished: "Your event has finished.",
    off: "Tickets are not on sale just now.",
  };

  function money(pence) {
    var p = Math.max(0, Math.round(Number(pence) || 0));
    var pounds = Math.floor(p / 100);
    var rest = p % 100;
    return "£" + pounds.toLocaleString("en-GB") + (rest ? "." + String(rest).padStart(2, "0") : "");
  }

  function initTicketsManage(doc, win) {
    var list = doc.querySelector("[data-manage-list]");
    var asked = {};

    function el(tag, cls, text) {
      var n = doc.createElement(tag);
      if (cls) n.className = cls;
      if (text != null) n.textContent = text;
      return n;
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
    function post(url, body) {
      return win
        .fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify(body) })
        .then(readJson);
    }
    function say(node, text, kind) {
      node.textContent = text || "";
      node.className = "form-status" + (text && kind ? " is-" + kind : "");
    }
    function firstField(data) {
      var f = data && data.fields;
      if (!f) return data && data.error;
      var keys = Object.keys(f);
      return keys.length ? f[keys[0]] : data.error;
    }

    function typesList(d) {
      var ul = el("ul", "et-list");
      ul.setAttribute("role", "list");
      ul.setAttribute("data-et-types", "");
      (d.types || []).forEach(function (t) {
        var li = el("li");
        li.appendChild(el("span", "et-list__what", t.name + ", " + (t.pricePence === 0 ? "free" : money(t.pricePence))));
        var of = t.quantity ? t.taken + " of " + t.quantity + " taken" : t.taken + " taken";
        var state = el("span", "et-list__state" + (t.status === "proposed" ? " is-waiting" : ""), t.statusWords + (t.status === "approved" ? ", " + of : ""));
        li.appendChild(state);
        ul.appendChild(li);
      });
      return ul;
    }

    function proposeForm(fid, reload) {
      var form = el("form", "fr-form fr-form--plain");
      form.setAttribute("novalidate", "");
      form.setAttribute("data-et-propose", "");
      form.setAttribute("data-nbcc-tickets", "");
      var help = el("div", "et-help");
      help.appendChild(el("p", null, ALL_MONEY));
      help.appendChild(el("p", null, COSTS));
      form.appendChild(help);
      var rows = el("div", "et-rows");
      rows.setAttribute("data-et-rows", "");
      form.appendChild(rows);
      var addP = el("p");
      var add = el("button", "fr-link-btn", "Add another kind of ticket");
      add.type = "button";
      add.setAttribute("data-et-add", "");
      addP.appendChild(add);
      form.appendChild(addP);
      var actions = el("div", "et-actions");
      var send = el("button", "btn btn-primary", "Send for checking");
      send.type = "submit";
      actions.appendChild(send);
      form.appendChild(actions);
      var status = el("p", "form-status");
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");
      form.appendChild(status);
      if (win.NBCCTicketEditor) win.NBCCTicketEditor.mount(form, "etMine" + fid + "Type");
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        if (!win.NBCCTicketEditor) return;
        var plan = win.NBCCTicketEditor.read(form);
        send.disabled = true;
        say(status, "Sending…", "pending");
        post(API + fid + "/tickets/propose", { ticketTypes: plan.types })
          .then(function (r) {
            send.disabled = false;
            if (r.status === 202) {
              say(status, r.data.message || "Thank you. We will check your tickets and put them on sale.", "success");
              reload();
              return;
            }
            say(status, firstField(r.data) || "We could not send that just now. Please try again in a few minutes.", "error");
          })
          .catch(function () {
            send.disabled = false;
            say(status, "We could not send that just now. Please try again in a few minutes.", "error");
          });
      });
      return form;
    }

    // "When should ticket sales close?": the organiser's choice, for staff to approve.
    function closeForm(fid, d, reload) {
      var form = el("form", "fr-form fr-form--plain");
      form.setAttribute("novalidate", "");
      form.setAttribute("data-et-close-form", "");
      var now = (d.proposedClose || d.close || { mode: "start" }).mode;
      var options = el("div", "fr-options fr-options--stack");
      var atField = el("div", "give-field");
      [["start", "When the event starts"], ["day_before", "The day before (midnight)"], ["custom", "A date and time I choose"]].forEach(function (o) {
        var id = "etClose" + fid + o[0];
        var label = el("label", "fr-option fr-option--small");
        label.setAttribute("for", id);
        var radio = el("input");
        radio.type = "radio";
        radio.name = "etClose" + fid;
        radio.id = id;
        radio.value = o[0];
        radio.checked = now === o[0];
        radio.addEventListener("change", function () {
          atField.hidden = form.querySelector('input[value="custom"]:checked') === null;
        });
        label.appendChild(radio);
        label.appendChild(el("span", null, o[1]));
        options.appendChild(label);
      });
      form.appendChild(options);
      var atLabel = el("label", null, "Close ticket sales on");
      var at = el("input", "give-field-input");
      at.type = "datetime-local";
      at.id = "etCloseAt" + fid;
      atLabel.setAttribute("for", at.id);
      atField.appendChild(atLabel);
      atField.appendChild(at);
      atField.hidden = now !== "custom";
      form.appendChild(atField);
      var actions = el("div", "et-actions");
      var send = el("button", "btn btn-ghost", "Send for checking");
      send.type = "submit";
      actions.appendChild(send);
      form.appendChild(actions);
      var status = el("p", "form-status");
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");
      form.appendChild(status);
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var chosen = form.querySelector("input[type=radio]:checked");
        var body = { ticketClose: chosen ? chosen.value : "start" };
        if (body.ticketClose === "custom") body.ticketCloseAt = String(at.value || "").trim();
        send.disabled = true;
        say(status, "Sending…", "pending");
        post(API + fid + "/tickets/propose", body)
          .then(function (r) {
            send.disabled = false;
            if (r.status === 202) {
              say(status, "Thank you. We will check that and let it take effect.", "success");
              reload();
              return;
            }
            say(status, firstField(r.data) || "We could not send that just now. Please try again in a few minutes.", "error");
          })
          .catch(function () {
            send.disabled = false;
            say(status, "We could not send that just now. Please try again in a few minutes.", "error");
          });
      });
      return form;
    }

    function bookings(fid, d, reload) {
      var wrap = el("div");
      var ul = el("ul", "et-list");
      ul.setAttribute("role", "list");
      ul.setAttribute("data-et-bookings", "");
      var form = el("form", "fr-form fr-form--plain");
      form.setAttribute("novalidate", "");
      form.setAttribute("data-et-refund-form", "");
      form.hidden = true;
      var which = el("p", "et-mine__money");
      form.appendChild(which);
      var field = el("div", "give-field");
      var label = el("label", null, "Why should this booking be refunded?");
      var reasonId = "etRefundReason" + fid;
      label.setAttribute("for", reasonId);
      var reason = el("textarea", "give-field-input");
      reason.id = reasonId;
      reason.rows = 3;
      reason.maxLength = 500;
      field.appendChild(label);
      field.appendChild(reason);
      form.appendChild(field);
      var actions = el("div", "et-actions");
      var send = el("button", "btn btn-primary", "Ask for this refund");
      send.type = "submit";
      var cancel = el("button", "fr-link-btn", "Never mind");
      cancel.type = "button";
      actions.appendChild(send);
      actions.appendChild(cancel);
      form.appendChild(actions);
      var status = el("p", "form-status");
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");
      status.setAttribute("data-et-refund-status", "");
      var chosen = null;

      (d.bookings || []).forEach(function (b) {
        var li = el("li");
        li.appendChild(el("span", "et-list__what", b.name + ": " + (b.tickets || "no tickets left") + " (" + b.reference + ")"));
        if (b.free) {
          // Nothing was paid: the organiser cancels it themselves, after a second press.
          var cancelFree = el("button", "fr-link-btn", "Cancel this booking");
          cancelFree.type = "button";
          cancelFree.setAttribute("data-et-cancel", String(b.id));
          var armed = false;
          cancelFree.addEventListener("click", function () {
            if (!armed) {
              armed = true;
              cancelFree.textContent = "Yes, cancel it and email them";
              return;
            }
            cancelFree.disabled = true;
            post(API + fid + "/tickets/bookings/" + b.id + "/cancel", {})
              .then(function (r) {
                if (r.status === 200) {
                  say(status, r.data.message || "That booking is cancelled.", "success");
                  reload();
                  return;
                }
                cancelFree.disabled = false;
                say(status, (r.data && r.data.error) || "We could not cancel that just now. Please try again in a few minutes.", "error");
              })
              .catch(function () {
                cancelFree.disabled = false;
                say(status, "We could not cancel that just now. Please try again in a few minutes.", "error");
              });
          });
          li.appendChild(cancelFree);
        } else if (b.refunded) {
          li.appendChild(el("span", "et-list__state", "Refunded"));
        } else if (b.requested) {
          li.appendChild(el("span", "et-list__state is-waiting", "Refund asked for"));
        } else {
          var ask = el("button", "fr-link-btn", "Ask for a refund");
          ask.type = "button";
          ask.setAttribute("data-et-ask", String(b.id));
          ask.addEventListener("click", function () {
            chosen = b;
            which.textContent = "Refund for " + b.name + ", " + b.tickets + " (" + b.reference + ")";
            form.hidden = false;
            say(status, "", null);
            try {
              reason.focus();
            } catch (e) {
              /* focus unavailable */
            }
          });
          li.appendChild(ask);
        }
        ul.appendChild(li);
      });
      cancel.addEventListener("click", function () {
        form.hidden = true;
        chosen = null;
      });
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        if (!chosen) return;
        var why = String(reason.value || "").trim();
        if (!why) return say(status, "Tell us why, in a few words.", "error");
        send.disabled = true;
        say(status, "Sending…", "pending");
        post(API + fid + "/tickets/refund-request", { orderId: chosen.id, reason: why })
          .then(function (r) {
            send.disabled = false;
            if (r.status === 202) {
              form.hidden = true;
              reason.value = "";
              say(status, r.data.message || "Thank you. We have asked our team to look at this refund.", "success");
              reload();
              return;
            }
            say(status, firstField(r.data) || "We could not send that just now. Please try again in a few minutes.", "error");
          })
          .catch(function () {
            send.disabled = false;
            say(status, "We could not send that just now. Please try again in a few minutes.", "error");
          });
      });
      if (!(d.bookings || []).length) wrap.appendChild(el("p", null, "No tickets sold yet."));
      else wrap.appendChild(ul);
      wrap.appendChild(form);
      wrap.appendChild(status);
      return wrap;
    }

    function draw(part, fid, d, reload) {
      while (part.firstChild) part.removeChild(part.firstChild);
      var heading = el("h3", null, "Your tickets");
      heading.id = "mineTickets" + fid;
      part.setAttribute("aria-labelledby", heading.id);
      part.appendChild(heading);
      part.appendChild(el("p", null, (STATE_WORDS[d.state] || "") + " NBCC sells them for you, and all the ticket money comes to NBCC."));
      var m = el("p", "et-mine__money", d.money ? d.money.words : "");
      m.setAttribute("data-et-money", "");
      part.appendChild(m);
      var limit = d.salesLimit ? "At most " + d.salesLimit + " tickets in all." : "No limit on tickets in all.";
      if (d.proposedSalesLimit) limit += " You asked for at most " + d.proposedSalesLimit + ": we are checking that.";
      part.appendChild(el("p", null, (d.sold === 1 ? "1 ticket sold. " : (d.sold || 0) + " tickets sold. ") + limit));
      part.appendChild(typesList(d));
      // When sales close: as approved, and their own choice still waiting for us.
      if (d.close) {
        part.appendChild(el("p", null, d.close.words + (d.proposedClose ? " You asked for: " + d.proposedClose.words + " We are checking that." : "")));
      }
      var g = el("p");
      var a = el("a", "btn btn-ghost fr-mat-btn", "Open the guest list to print");
      a.href = d.guestListUrl;
      a.target = "_blank";
      a.rel = "noopener";
      a.setAttribute("data-et-guest-list", "");
      var sr = el("span", "sr-only", " (opens in a new tab)");
      a.appendChild(sr);
      g.appendChild(a);
      part.appendChild(g);

      part.appendChild(el("h4", null, "Bookings"));
      part.appendChild(el("p", null, "Only NBCC can make a refund. If someone cannot come, ask us here and we will look at it and email the buyer."));
      part.appendChild(bookings(fid, d, reload));

      if (d.selling && d.state !== "finished") {
        part.appendChild(el("h4", null, "When should ticket sales close?"));
        part.appendChild(closeForm(fid, d, reload));
        part.appendChild(el("h4", null, "Add another kind of ticket"));
        part.appendChild(el("p", null, "We check every ticket before it goes on sale. To change or stop one already on sale, email events@nbcc.scot."));
        part.appendChild(proposeForm(fid, reload));
      }
    }

    function load(card, fid) {
      return win
        .fetch(API + fid + "/tickets", { credentials: "same-origin" })
        .then(function (res) {
          return res.status === 200 ? res.json() : null;
        })
        .then(function (d) {
          if (!d || !list.contains(card)) return;
          var part = card.querySelector("[data-et-part]");
          if (!part) {
            part = el("section", "fr-mine__part");
            part.setAttribute("data-et-part", "");
            var done = card.querySelector("[data-f-done-part]");
            if (done && done.parentNode) done.parentNode.insertBefore(part, done);
            else card.appendChild(part);
          }
          draw(part, fid, d, function () {
            load(card, fid);
          });
        })
        .catch(function () {
          /* the rest of the private area still works */
        });
    }

    function scan() {
      if (!list) return;
      Array.prototype.forEach.call(list.querySelectorAll("[data-fundraiser]"), function (card) {
        var fid = card.getAttribute("data-fundraiser");
        if (!fid || asked[fid] === card) return;
        asked[fid] = card;
        load(card, fid);
      });
    }

    if (list) {
      scan();
      var Observer = win.MutationObserver || (typeof MutationObserver !== "undefined" ? MutationObserver : null);
      if (Observer) new Observer(scan).observe(list, { childList: true });
    }
    return { scan: scan };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { initTicketsManage: initTicketsManage };
  } else {
    initTicketsManage(document, window);
  }
})();
