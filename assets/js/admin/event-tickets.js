// Event tickets in Admin > Fundraising: the Event tickets card (Jaimie, points 23 and 24).
//
// Its own script beside app.js, so each can change without the other. It draws into the card in
// admin.html (#etAdmin) whenever the Fundraising section is shown:
//   - every event selling tickets through NBCC, with what is waiting (tickets to approve, refunds
//     asked for), soonest first (GET /api/admin/event-tickets);
//   - one event, opened below its row (GET /api/admin/event-tickets/:id): the money (tickets apart
//     from gifts), each kind of ticket (approve, change, take off sale, add), the limit, sales open
//     or closed, the guest list to print and the CSV, the refunds asked for, and the bookings.
//   - a refund is made by an ADMIN only, on a booking: choose the tickets, read what goes back to the
//     buyer's card, then confirm a second time. The server checks it all again and asks Stripe.
//
// Signed with the same session app.js keeps (sessionStorage nbcc_admin_token). Built with the DOM
// (never innerHTML), so nothing an organiser or buyer typed can be read as markup. Nothing scrolls
// inside a box: rows wrap and the page grows. A classic <script defer>, exported under a CommonJS
// guard so it can be unit tested in jsdom.
(function () {
  "use strict";

  var TOKEN_KEY = "nbcc_admin_token";
  var API = "/api/admin/event-tickets";
  var STATE_WORDS = {
    open: "On sale",
    soon: "Nothing on sale yet",
    sold_out: "Sold out",
    closed: "Sales closed by staff",
    started: "Sales closed: the event has started",
    finished: "Event finished",
    off: "Not on sale (the event is not approved and public, or fundraising is off)",
  };
  var TYPE_WORDS = { proposed: "Waiting for you to approve", approved: "On sale", withdrawn: "Not on sale" };

  function money(pence) {
    var p = Math.max(0, Math.round(Number(pence) || 0));
    var pounds = Math.floor(p / 100);
    var rest = p % 100;
    return "£" + pounds.toLocaleString("en-GB") + (rest ? "." + String(rest).padStart(2, "0") : "");
  }
  function niceDate(iso) {
    if (!iso) return "No date";
    var d = new Date(iso + "T12:00:00Z");
    return isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  }
  function count(n, one, many) {
    return n + " " + (n === 1 ? one : many);
  }

  function initAdminEventTickets(doc, win) {
    var card = doc.getElementById("etAdmin");
    var listBox = doc.getElementById("etAdminList");
    var status = doc.getElementById("etAdminStatus");
    var view = doc.getElementById("view-fundraising");
    var openId = null;
    var events = [];

    function el(tag, cls, text) {
      var n = doc.createElement(tag);
      if (cls) n.className = cls;
      if (text != null) n.textContent = text;
      return n;
    }
    function btn(cls, text, attr, value) {
      var b = el("button", cls, text);
      b.type = "button";
      if (attr) b.setAttribute(attr, value == null ? "" : String(value));
      return b;
    }
    function token() {
      try {
        return win.sessionStorage.getItem(TOKEN_KEY) || "";
      } catch (e) {
        return "";
      }
    }
    function role() {
      try {
        var part = token().split(".")[0].replace(/-/g, "+").replace(/_/g, "/");
        return JSON.parse(win.atob(part)).role || "";
      } catch (e) {
        return "";
      }
    }
    function call(path, method, body) {
      var opts = { method: method || "GET", headers: { Authorization: "Bearer " + token() } };
      if (body !== undefined) {
        opts.headers["Content-Type"] = "application/json";
        opts.body = JSON.stringify(body);
      }
      return win.fetch(path, opts);
    }
    function say(text, isError) {
      if (!status) return;
      status.textContent = text || "";
      status.className = "ty-status" + (text ? (isError ? " is-error" : " is-ok") : "");
    }
    // An action: say what is happening, do it, say how it went (the server's own words if it refused),
    // then read the event again so the screen is what the database has.
    function act(path, method, body, doing, done) {
      say(doing, false);
      return call(path, method, body)
        .then(function (res) {
          return res.json().then(
            function (data) {
              return { ok: res.ok, data: data || {} };
            },
            function () {
              return { ok: res.ok, data: {} };
            },
          );
        })
        .then(function (r) {
          if (!r.ok) {
            var why = r.data.error === "forbidden" ? "Your access does not let you do that." : r.data.error || "That did not work. Please try again.";
            // The booking has changed since it was drawn: show it as it is now, and keep the reason up.
            if (r.data.refresh) {
              return reload().then(function () {
                say(why, true);
                return false;
              });
            }
            say(why, true);
            return false;
          }
          say(typeof done === "function" ? done(r.data) : done, false);
          return reload().then(function () {
            return true;
          });
        })
        .catch(function () {
          say("That did not work. Please try again.", true);
          return false;
        });
    }

    // --- the list -------------------------------------------------------------------------------
    function waitingWords(e) {
      var out = [];
      if (e.proposedTypes) out.push(count(e.proposedTypes, "ticket to approve", "tickets to approve"));
      if (e.proposedLimit) out.push("a limit to approve");
      if (e.openRequests) out.push(count(e.openRequests, "refund asked for", "refunds asked for"));
      return out.join(", ");
    }

    function drawList() {
      while (listBox.firstChild) listBox.removeChild(listBox.firstChild);
      if (!events.length) {
        listBox.appendChild(el("p", "admin-loading", "No event is selling tickets through NBCC yet. An organiser chooses it on the sign up form, under How do people get in?"));
        return;
      }
      var ul = el("ul", "et-events");
      ul.setAttribute("role", "list");
      events.forEach(function (e) {
        var li = el("li", "et-event" + (openId === e.id ? " is-open" : ""));
        li.setAttribute("data-et-event", String(e.id));
        var head = btn("et-event__head", null, "data-et-open", e.id);
        head.setAttribute("aria-expanded", openId === e.id ? "true" : "false");
        var name = el("span", "et-event__name", e.title);
        var meta = el("span", "et-event__meta", niceDate(e.eventDate) + " · " + count(e.sold, "sold", "sold") + " · " + money(e.ticketPence));
        head.appendChild(name);
        head.appendChild(meta);
        var waiting = waitingWords(e);
        if (waiting) head.appendChild(el("span", "admin-pill admin-pill--pending et-event__waiting", waiting));
        if (e.salesClosed) head.appendChild(el("span", "admin-pill", "Sales closed"));
        if (e.status !== "approved") head.appendChild(el("span", "admin-pill", e.status === "new" ? "Event not approved yet" : e.status === "finished" ? "Finished" : "Declined"));
        li.appendChild(head);
        if (openId === e.id) {
          var detail = el("div", "et-detail");
          detail.setAttribute("data-et-detail", String(e.id));
          detail.appendChild(el("p", "admin-loading", "Loading…"));
          li.appendChild(detail);
        }
        ul.appendChild(li);
      });
      listBox.appendChild(ul);
    }

    // --- one event ------------------------------------------------------------------------------
    function section(title) {
      var s = el("section", "et-block");
      s.appendChild(el("h4", "fr-card-subhead", title));
      return s;
    }
    function numberBox(cls, attrs) {
      var i = el("input", cls);
      i.type = "number";
      Object.keys(attrs).forEach(function (k) {
        i.setAttribute(k, attrs[k]);
      });
      return i;
    }
    function labelled(text, input, id) {
      var w = el("div", "et-field");
      var l = el("label", "fx-call-label", text);
      input.id = id;
      l.setAttribute("for", id);
      w.appendChild(l);
      w.appendChild(input);
      return w;
    }
    function pence(text) {
      var t = String(text || "").trim();
      return /^\d+(\.\d{1,2})?$/.test(t) ? Math.round(parseFloat(t) * 100) : NaN;
    }

    function typesBlock(id, d) {
      var s = section("Tickets");
      if (!d.types.length) s.appendChild(el("p", null, "No tickets yet. Add one below, or ask the organiser to add theirs in their private area."));
      var ul = el("ul", "et-rows");
      ul.setAttribute("role", "list");
      d.types.forEach(function (t) {
        var li = el("li", "et-row et-row--" + t.status);
        li.setAttribute("data-et-type-row", String(t.id));
        var what = el("div", "et-row__what");
        what.appendChild(el("strong", null, t.name));
        what.appendChild(el("span", "et-row__price", t.pricePence === 0 ? "Free" : money(t.pricePence)));
        what.appendChild(el("span", "et-row__count", t.quantity ? t.taken + " of " + t.quantity + " taken" : t.taken + " taken, no limit of its own"));
        what.appendChild(el("span", "admin-pill" + (t.status === "proposed" ? " admin-pill--pending" : ""), TYPE_WORDS[t.status] || t.status));
        li.appendChild(what);
        var acts = el("div", "et-row__acts");
        if (t.status !== "approved") {
          var approve = btn("admin-btn", t.status === "proposed" ? "Approve" : "Put back on sale", "data-et-approve", t.id);
          approve.addEventListener("click", function () {
            act(API + "/" + id + "/types/" + t.id + "/approve", "POST", undefined, "Saving…", t.name + " is on sale.");
          });
          acts.appendChild(approve);
        }
        if (t.status !== "withdrawn") {
          var off = btn("admin-btn fr-btn-quiet", t.status === "proposed" ? "Decline" : "Take off sale", "data-et-withdraw", t.id);
          off.addEventListener("click", function () {
            act(API + "/" + id + "/types/" + t.id + "/withdraw", "POST", undefined, "Saving…", t.name + " is not on sale.");
          });
          acts.appendChild(off);
        }
        var change = btn("admin-btn fr-btn-quiet", "Change", "data-et-change", t.id);
        acts.appendChild(change);
        li.appendChild(acts);
        var form = el("form", "et-edit");
        form.hidden = true;
        form.setAttribute("novalidate", "");
        var name = el("input", "fx-call-input");
        name.type = "text";
        name.maxLength = 60;
        name.value = t.name;
        var price = numberBox("fx-call-input", { min: "0", max: "500", step: "0.01", inputmode: "decimal" });
        price.value = (t.pricePence / 100).toFixed(2);
        var qty = numberBox("fx-call-input", { min: "1", max: "5000", step: "1", inputmode: "numeric", placeholder: "No limit" });
        qty.value = t.quantity ? String(t.quantity) : "";
        form.appendChild(labelled("Name", name, "etName" + t.id));
        form.appendChild(labelled("Price, in pounds (0 for free)", price, "etPrice" + t.id));
        form.appendChild(labelled("How many on sale (empty for no limit)", qty, "etQty" + t.id));
        var save = el("button", "admin-btn", "Save");
        save.type = "submit";
        form.appendChild(save);
        form.addEventListener("submit", function (e) {
          e.preventDefault();
          var body = { name: String(name.value || "").trim(), pricePence: pence(price.value), quantity: String(qty.value).trim() === "" ? null : Number(qty.value) };
          if (!isFinite(body.pricePence)) return say("Give the price in pounds, like 10 or 7.50.", true);
          act(API + "/" + id + "/types/" + t.id, "PATCH", body, "Saving…", "Saved.");
        });
        change.addEventListener("click", function () {
          form.hidden = !form.hidden;
        });
        li.appendChild(form);
        ul.appendChild(li);
      });
      s.appendChild(ul);

      var add = el("form", "et-edit et-add");
      add.setAttribute("novalidate", "");
      var aName = el("input", "fx-call-input");
      aName.type = "text";
      aName.maxLength = 60;
      aName.placeholder = "Like Adult";
      var aPrice = numberBox("fx-call-input", { min: "0", max: "500", step: "0.01", inputmode: "decimal", placeholder: "10" });
      var aQty = numberBox("fx-call-input", { min: "1", max: "5000", step: "1", inputmode: "numeric", placeholder: "No limit" });
      add.appendChild(labelled("Add a ticket", aName, "etAddName" + id));
      add.appendChild(labelled("Price, in pounds (0 for free)", aPrice, "etAddPrice" + id));
      add.appendChild(labelled("How many on sale", aQty, "etAddQty" + id));
      var addBtn = el("button", "admin-btn fr-btn-quiet", "Add, on sale now");
      addBtn.type = "submit";
      add.appendChild(addBtn);
      add.addEventListener("submit", function (e) {
        e.preventDefault();
        var p = pence(aPrice.value);
        if (!String(aName.value || "").trim() || !isFinite(p)) return say("Give the ticket a name and a price in pounds.", true);
        act(API + "/" + id + "/types", "POST", { name: String(aName.value).trim(), pricePence: p, quantity: String(aQty.value).trim() === "" ? null : Number(aQty.value) }, "Adding…", "Added, and on sale.");
      });
      s.appendChild(add);
      return s;
    }

    function limitBlock(id, d) {
      var s = section("Limit and sales");
      var left = d.overallRemaining === null || d.overallRemaining === undefined ? "" : " " + count(d.overallRemaining, "place", "places") + " left.";
      s.appendChild(el("p", null, (d.salesLimit ? "At most " + d.salesLimit + " tickets in all." : "No limit on tickets in all.") + left));
      if (d.proposedSalesLimit) {
        var p = el("p", "et-proposed", "The organiser asked for at most " + d.proposedSalesLimit + ". ");
        var yes = btn("admin-btn", "Approve " + d.proposedSalesLimit, "data-et-limit-approve");
        yes.addEventListener("click", function () {
          act(API + "/" + id + "/limit/approve", "POST", undefined, "Saving…", "The limit is " + d.proposedSalesLimit + ".");
        });
        var no = btn("admin-btn fr-btn-quiet", "Decline", "data-et-limit-decline");
        no.addEventListener("click", function () {
          act(API + "/" + id + "/limit/decline", "POST", undefined, "Saving…", "Declined.");
        });
        p.appendChild(yes);
        p.appendChild(no);
        s.appendChild(p);
      }
      var form = el("form", "et-edit");
      form.setAttribute("novalidate", "");
      var box = numberBox("fx-call-input", { min: "1", max: "5000", step: "1", inputmode: "numeric", placeholder: "No limit" });
      box.value = d.salesLimit ? String(d.salesLimit) : "";
      form.appendChild(labelled("The most tickets to sell in all (empty for no limit)", box, "etLimit" + id));
      var save = el("button", "admin-btn fr-btn-quiet", "Save the limit");
      save.type = "submit";
      form.appendChild(save);
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        act(API + "/" + id + "/limit", "PUT", { limit: String(box.value).trim() === "" ? null : Number(box.value) }, "Saving…", "Saved.");
      });
      s.appendChild(form);
      // When sales close: the host's choice (approved here with the tickets), or set by staff.
      if (d.close) s.appendChild(el("p", null, d.close.words));
      if (d.proposedClose) {
        var pc = el("p", "et-proposed", "The organiser asked: " + d.proposedClose.words + " ");
        var okClose = btn("admin-btn", "Approve", "data-et-close-approve");
        okClose.addEventListener("click", function () {
          act(API + "/" + id + "/close/approve", "POST", undefined, "Saving…", "Saved: " + d.proposedClose.words);
        });
        var noClose = btn("admin-btn fr-btn-quiet", "Decline", "data-et-close-decline");
        noClose.addEventListener("click", function () {
          act(API + "/" + id + "/close/decline", "POST", undefined, "Saving…", "Declined.");
        });
        pc.appendChild(okClose);
        pc.appendChild(noClose);
        s.appendChild(pc);
      }
      var closeForm = el("form", "et-edit");
      closeForm.setAttribute("novalidate", "");
      closeForm.setAttribute("data-et-close-form", "");
      var mode = el("select", "fx-call-input");
      [["start", "When the event starts"], ["day_before", "The day before (midnight)"], ["custom", "A date and time"]].forEach(function (o) {
        var opt = el("option", null, o[1]);
        opt.value = o[0];
        mode.appendChild(opt);
      });
      mode.value = (d.close && d.close.mode) || "start";
      var when = el("input", "fx-call-input");
      when.type = "datetime-local";
      closeForm.appendChild(labelled("Ticket sales close", mode, "etCloseMode" + id));
      closeForm.appendChild(labelled("On (for a date and time)", when, "etCloseAt" + id));
      var saveClose = el("button", "admin-btn fr-btn-quiet", "Save when sales close");
      saveClose.type = "submit";
      closeForm.appendChild(saveClose);
      closeForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var body = { ticketClose: mode.value };
        if (mode.value === "custom") body.ticketCloseAt = String(when.value || "").trim();
        act(API + "/" + id + "/close", "PUT", body, "Saving…", "Saved.");
      });
      s.appendChild(closeForm);
      var closed = !!d.salesClosedAt;
      var sales = btn("admin-btn" + (closed ? "" : " fr-btn-quiet"), closed ? "Open sales again" : "Close sales now", "data-et-sales");
      sales.addEventListener("click", function () {
        act(API + "/" + id + "/sales", "POST", { open: closed }, "Saving…", closed ? "Sales are open again." : "Sales are closed.");
      });
      var row = el("p", "et-actions");
      row.appendChild(sales);
      row.appendChild(el("span", "fr-field-hint", "Closing them here closes them now, whatever the time above."));
      s.appendChild(row);
      return s;
    }

    function openGuestList(id) {
      say("Opening the guest list…", false);
      call(API + "/" + id + "/guest-list")
        .then(function (res) {
          if (!res.ok) throw new Error("status " + res.status);
          return res.text();
        })
        .then(function (page) {
          var w = win.open("", "_blank");
          if (!w) return say("Your browser stopped the guest list opening. Allow pop ups for this site and try again.", true);
          w.document.open();
          w.document.write(page);
          w.document.close();
          say("", false);
        })
        .catch(function () {
          say("The guest list could not open just now. Try again in a moment.", true);
        });
    }
    function downloadCsv(id, slug) {
      say("Getting the CSV…", false);
      call(API + "/" + id + "/orders.csv")
        .then(function (res) {
          if (!res.ok) throw new Error("status " + res.status);
          return res.blob();
        })
        .then(function (blob) {
          var url = win.URL.createObjectURL(blob);
          var a = el("a");
          a.href = url;
          a.download = "tickets-" + slug + ".csv";
          doc.body.appendChild(a);
          a.click();
          doc.body.removeChild(a);
          win.URL.revokeObjectURL(url);
          say("", false);
        })
        .catch(function () {
          say("The CSV could not download just now. Try again in a moment.", true);
        });
    }

    function refundForm(id, o, requestId) {
      var form = el("form", "et-refund");
      form.setAttribute("novalidate", "");
      form.setAttribute("data-et-refund-form", String(o.id));
      form.hidden = true;
      form.appendChild(el("p", "et-refund__lead", "Choose the tickets to refund. The money goes back to the card the buyer paid with, they are emailed, and the tickets go back on sale."));
      var boxes = [];
      o.lines.forEach(function (l) {
        var left = Math.max(0, l.quantity - l.refundedQuantity);
        if (!left) return;
        var box = numberBox("fx-call-input", { min: "0", max: String(left), step: "1", inputmode: "numeric", "data-et-refund-qty": String(l.id) });
        box.value = "0";
        form.appendChild(labelled(l.typeName + " at " + money(l.unitPence) + " (" + left + " to refund)", box, "etRefund" + l.id));
        boxes.push({ line: l, left: left, box: box });
      });
      var note = el("input", "fx-call-input");
      note.type = "text";
      note.maxLength = 500;
      form.appendChild(labelled("A note for the record (optional)", note, "etRefundNote" + o.id));
      var amount = el("p", "et-refund__amount");
      amount.setAttribute("data-et-refund-amount", "");
      amount.setAttribute("aria-live", "polite");
      form.appendChild(amount);
      var go = btn("admin-btn et-refund__go", "Refund", "data-et-refund-go");
      var cancel = btn("admin-btn fr-btn-quiet", "Cancel");
      var acts = el("p", "et-actions");
      acts.appendChild(go);
      acts.appendChild(cancel);
      form.appendChild(acts);
      var armed = false;

      // The server's own sum (src/tickets/model.ts refundPlan): the tickets' price; the whole of what
      // is left, card fee cover and all, when no ticket is left standing.
      function plan() {
        var lines = [];
        var sum = 0;
        var standing = 0;
        boxes.forEach(function (b) {
          var n = Math.max(0, Math.min(b.left, Math.floor(Number(b.box.value) || 0)));
          if (String(n) !== b.box.value) b.box.value = String(n);
          // With how many were already refunded when this was drawn: the server refuses a stale one.
          if (n > 0) lines.push({ lineId: b.line.id, quantity: n, refundedQuantity: b.line.refundedQuantity });
          sum += n * b.line.unitPence;
          standing += b.left - n;
        });
        var leftToRefund = o.totalPence - o.refundedPence;
        var full = lines.length > 0 && standing === 0;
        return { lines: lines, full: full, amount: full ? leftToRefund : Math.min(sum, leftToRefund) };
      }
      function update() {
        armed = false;
        var p = plan();
        go.disabled = p.lines.length === 0;
        go.textContent = p.lines.length ? "Refund " + money(p.amount) : "Refund";
        amount.textContent = !p.lines.length
          ? "Nothing chosen yet."
          : money(p.amount) + " will go back to the buyer’s card" + (p.full && o.feeCoverPence > 0 ? ", with the card fee cover, as it is the whole booking." : ".");
      }
      form.addEventListener("input", update);
      cancel.addEventListener("click", function () {
        form.hidden = true;
      });
      go.addEventListener("click", function () {
        var p = plan();
        if (!p.lines.length) return;
        if (!armed) {
          armed = true;
          go.textContent = "Yes, refund " + money(p.amount) + " now";
          return;
        }
        go.disabled = true;
        act(API + "/" + id + "/orders/" + o.id + "/refund", "POST", { lines: p.lines, refundedPence: o.refundedPence, requestId: requestId || null, note: String(note.value || "").trim() }, "Refunding…", function (data) {
          if (data.status === "processing") return data.message || "Stripe is still processing the refund. The booking will update when it confirms it.";
          return money(data.amountPence) + " refunded to the buyer’s card. They have been emailed.";
        }).then(function (ok) {
          if (!ok) update();
        });
      });
      update();
      return form;
    }

    // "Release these tickets (no money)": an admin puts tickets back on sale with no money moving.
    // Only free tickets, and paid ones whose money was already refunded in Stripe itself (as many as
    // that money covers). The server checks it all again (src/tickets/model.ts releasePlan).
    function releasable(o) {
      var uncovered = o.refundedPence;
      o.lines.forEach(function (l) {
        uncovered -= l.refundedQuantity * l.unitPence;
      });
      return o.lines
        .map(function (l) {
          var left = Math.max(0, l.quantity - l.refundedQuantity);
          var can = l.unitPence === 0 ? left : Math.min(left, Math.floor(Math.max(0, uncovered) / l.unitPence));
          return { line: l, can: can };
        })
        .filter(function (x) {
          return x.can > 0;
        });
    }
    function releaseForm(id, o, lines) {
      var form = el("form", "et-refund");
      form.setAttribute("novalidate", "");
      form.setAttribute("data-et-release-form", String(o.id));
      form.hidden = true;
      form.appendChild(el("p", "et-refund__lead", "Release these tickets (no money): they go back on sale and the buyer is emailed that they are cancelled. No money moves. For free tickets, or ones already refunded in Stripe."));
      var boxes = lines.map(function (x) {
        var box = numberBox("fx-call-input", { min: "0", max: String(x.can), step: "1", inputmode: "numeric", "data-et-release-qty": String(x.line.id) });
        box.value = "0";
        form.appendChild(labelled(x.line.typeName + " (" + x.can + " can be released)", box, "etRelease" + x.line.id));
        return { line: x.line, can: x.can, box: box };
      });
      var go = btn("admin-btn et-refund__go", "Release", "data-et-release-go");
      var cancel = btn("admin-btn fr-btn-quiet", "Cancel");
      var acts = el("p", "et-actions");
      acts.appendChild(go);
      acts.appendChild(cancel);
      form.appendChild(acts);
      var armed = false;
      function chosen() {
        var out = [];
        var n = 0;
        boxes.forEach(function (b) {
          var q = Math.max(0, Math.min(b.can, Math.floor(Number(b.box.value) || 0)));
          if (String(q) !== b.box.value) b.box.value = String(q);
          if (q > 0) out.push({ lineId: b.line.id, quantity: q, refundedQuantity: b.line.refundedQuantity });
          n += q;
        });
        return { lines: out, count: n };
      }
      function update() {
        armed = false;
        var c = chosen();
        go.disabled = c.count === 0;
        go.textContent = c.count ? "Release " + count(c.count, "ticket", "tickets") : "Release";
      }
      form.addEventListener("input", update);
      cancel.addEventListener("click", function () {
        form.hidden = true;
      });
      go.addEventListener("click", function () {
        var c = chosen();
        if (!c.count) return;
        if (!armed) {
          armed = true;
          go.textContent = "Yes, cancel " + count(c.count, "ticket", "tickets") + " and email them";
          return;
        }
        go.disabled = true;
        act(API + "/" + id + "/orders/" + o.id + "/release", "POST", { lines: c.lines, refundedPence: o.refundedPence }, "Releasing…", "Released. The buyer has been emailed and the tickets are back on sale.").then(function (ok) {
          if (!ok) update();
        });
      });
      update();
      return form;
    }

    function requestsBlock(id, d, isAdmin) {
      var open = d.requests.filter(function (q) {
        return q.status === "open";
      });
      var s = section("Refunds asked for");
      if (!open.length) {
        s.appendChild(el("p", null, "None waiting."));
        return s;
      }
      var ul = el("ul", "et-rows");
      ul.setAttribute("role", "list");
      open.forEach(function (q) {
        var li = el("li", "et-row et-row--proposed");
        li.setAttribute("data-et-request", String(q.id));
        var what = el("div", "et-row__what");
        what.appendChild(el("strong", null, q.reference + ", " + q.buyerName));
        what.appendChild(el("span", "et-row__reason", "“" + q.reason + "”"));
        what.appendChild(el("span", "et-row__count", "Asked by " + String(q.requestedBy).replace(/^organiser:/, "")));
        li.appendChild(what);
        if (isAdmin) {
          var acts = el("div", "et-row__acts");
          acts.appendChild(el("span", "fr-field-hint", "Refund it from the booking below, or"));
          var no = btn("admin-btn fr-btn-quiet", "Decline", "data-et-request-decline", q.id);
          no.addEventListener("click", function () {
            act(API + "/" + id + "/requests/" + q.id + "/decline", "POST", {}, "Saving…", "Declined. Let the organiser know why.");
          });
          acts.appendChild(no);
          li.appendChild(acts);
        }
        ul.appendChild(li);
      });
      s.appendChild(ul);
      return s;
    }

    function bookingsBlock(id, d, isAdmin) {
      var s = section("Bookings");
      var top = el("p", "et-actions");
      var guest = btn("admin-btn fr-btn-quiet", "Guest list to print", "data-et-guest-list");
      guest.addEventListener("click", function () {
        openGuestList(id);
      });
      var csv = btn("admin-btn fr-btn-quiet", "Download CSV", "data-et-csv");
      csv.addEventListener("click", function () {
        downloadCsv(id, d.event.slug);
      });
      top.appendChild(guest);
      top.appendChild(csv);
      s.appendChild(top);
      if (!isAdmin) s.appendChild(el("p", "fr-field-hint", "Only an admin can make a refund."));
      if (d.contact === false) s.appendChild(el("p", "fr-field-hint", "Buyers’ emails and phone numbers are shown only to people who can edit Fundraising."));
      var paid = d.orders.filter(function (o) {
        return o.status === "paid";
      });
      var holding = d.orders.length - paid.length;
      if (holding) s.appendChild(el("p", "fr-field-hint", count(holding, "checkout is", "checkouts are") + " open now, holding places for up to an hour."));
      if (!paid.length) {
        s.appendChild(el("p", null, "No tickets sold yet."));
        return s;
      }
      var ul = el("ul", "et-rows");
      ul.setAttribute("role", "list");
      paid.forEach(function (o) {
        var li = el("li", "et-row");
        li.setAttribute("data-et-order", String(o.id));
        var what = el("div", "et-row__what");
        what.appendChild(el("strong", null, o.firstName + " " + o.surname));
        what.appendChild(el("span", "et-row__ref", o.reference));
        what.appendChild(el("span", "et-row__count", o.tickets || "No tickets left"));
        if (o.email) what.appendChild(el("span", "et-row__contact", o.email + (o.phone ? ", " + o.phone : "")));
        var paidWords = o.free ? "Free booking: nothing paid" : "Paid " + money(o.totalPence) + (o.feeCoverPence ? " (with " + money(o.feeCoverPence) + " card fee cover)" : "");
        what.appendChild(el("span", "et-row__count", paidWords + (o.refundedPence ? ", " + money(o.refundedPence) + " refunded" : "")));
        li.appendChild(what);
        var fully = !o.free && o.refundedPence >= o.totalPence;
        if (fully) li.appendChild(el("span", "admin-pill admin-pill--refunded", "Refunded"));
        // What staff should check (paid late and over the limit, a wrong amount, a dispute).
        (o.flagWords || []).forEach(function (w) {
          li.appendChild(el("span", "admin-pill admin-pill--failed et-flag", w));
        });
        // A refund failed at the bank. The flag stays until an admin says the buyer has their money
        // (it never clears by itself), after a second press.
        if (o.refundFailed && isAdmin) {
          var sorted = btn("admin-btn fr-btn-quiet", "Mark as sorted", "data-et-refund-sorted", o.id);
          var armedSorted = false;
          sorted.addEventListener("click", function () {
            if (!armedSorted) {
              armedSorted = true;
              sorted.textContent = "Yes, the buyer has their money";
              return;
            }
            act(API + "/" + id + "/orders/" + o.id + "/refund-failed-sorted", "POST", {}, "Saving…", "Marked as sorted.");
          });
          var sortedActs = el("div", "et-row__acts");
          sortedActs.appendChild(sorted);
          li.appendChild(sortedActs);
        }
        // The tickets email did not go when the payment landed: say so, with a way to send it again.
        if (o.emailSent === false && !fully) {
          var unsent = el("div", "et-row__acts et-unsent");
          unsent.appendChild(
            el("span", "admin-pill " + (o.emailFailing ? "admin-pill--failed" : "admin-pill--pending"), o.emailFailing ? "Tickets email keeps failing: check the address" : "Tickets email not sent"),
          );
          var again = btn("admin-btn fr-btn-quiet", "Send tickets email again", "data-et-resend", o.id);
          again.addEventListener("click", function () {
            act(API + "/" + id + "/orders/" + o.id + "/resend", "POST", {}, "Sending…", "Sent to the buyer.");
          });
          unsent.appendChild(again);
          li.appendChild(unsent);
        }
        if (o.free) {
          // Nothing was paid, so there is nothing to refund: staff cancel it, after a second press.
          var cancelFree = btn("admin-btn fr-btn-quiet", "Cancel this booking", "data-et-cancel-free", o.id);
          var armedFree = false;
          cancelFree.addEventListener("click", function () {
            if (!armedFree) {
              armedFree = true;
              cancelFree.textContent = "Yes, cancel it and email them";
              return;
            }
            act(API + "/" + id + "/orders/" + o.id + "/cancel", "POST", {}, "Cancelling…", "Cancelled. The buyer has been emailed and the tickets are back on sale.");
          });
          var freeActs = el("div", "et-row__acts");
          freeActs.appendChild(cancelFree);
          li.appendChild(freeActs);
        } else if (isAdmin && !fully) {
          var request = null;
          d.requests.forEach(function (q) {
            if (q.orderId === o.id && q.status === "open") request = q.id;
          });
          var form = refundForm(id, o, request);
          var openBtn = btn("admin-btn fr-btn-quiet", "Refund", "data-et-refund-open", o.id);
          openBtn.addEventListener("click", function () {
            form.hidden = !form.hidden;
          });
          var acts = el("div", "et-row__acts");
          acts.appendChild(openBtn);
          li.appendChild(acts);
          li.appendChild(form);
        }
        // Tickets that can go back on sale with no money moving (free ones on a paid booking, or
        // ones already refunded in Stripe itself): an admin releases them.
        var canRelease = isAdmin && !o.free ? releasable(o) : [];
        if (canRelease.length) {
          var rForm = releaseForm(id, o, canRelease);
          var rOpen = btn("admin-btn fr-btn-quiet", "Release tickets (no money)", "data-et-release-open", o.id);
          rOpen.addEventListener("click", function () {
            rForm.hidden = !rForm.hidden;
          });
          var rActs = el("div", "et-row__acts");
          rActs.appendChild(rOpen);
          li.appendChild(rActs);
          li.appendChild(rForm);
        }
        ul.appendChild(li);
      });
      s.appendChild(ul);
      if (d.refunds.length) {
        s.appendChild(el("h4", "fr-card-subhead", "Refunds made"));
        var done = el("ul", "et-rows");
        done.setAttribute("role", "list");
        d.refunds.forEach(function (r) {
          var li = el("li", "et-row");
          var what = el("div", "et-row__what");
          what.appendChild(el("strong", null, money(r.amountPence) + " on " + r.reference));
          if (r.pending) what.appendChild(el("span", "admin-pill admin-pill--pending", "Not confirmed by Stripe yet: make the same refund again to finish it"));
          what.appendChild(el("span", "et-row__count", "By " + String(r.refundedBy).replace(/^admin:/, "") + (r.note ? ": " + r.note : "")));
          li.appendChild(what);
          done.appendChild(li);
        });
        s.appendChild(done);
      }
      return s;
    }

    function drawDetail(id, d) {
      var box = doc.querySelector('[data-et-detail="' + id + '"]');
      if (!box) return;
      while (box.firstChild) box.removeChild(box.firstChild);
      var isAdmin = role() === "admin";
      var head = el("div", "et-detail__head");
      head.appendChild(el("span", "admin-pill" + (d.state === "open" ? " et-pill--on" : ""), STATE_WORDS[d.state] || d.state));
      var m = el("p", "et-detail__money", d.money.words);
      m.setAttribute("data-et-money", "");
      head.appendChild(m);
      box.appendChild(head);
      box.appendChild(typesBlock(id, d));
      box.appendChild(limitBlock(id, d));
      box.appendChild(requestsBlock(id, d, isAdmin));
      box.appendChild(bookingsBlock(id, d, isAdmin));
    }

    function loadDetail(id) {
      return call(API + "/" + id)
        .then(function (res) {
          if (!res.ok) throw new Error("status " + res.status);
          return res.json();
        })
        .then(function (d) {
          if (openId === id) drawDetail(id, d);
        })
        .catch(function () {
          var box = doc.querySelector('[data-et-detail="' + id + '"]');
          if (!box) return;
          while (box.firstChild) box.removeChild(box.firstChild);
          box.appendChild(el("p", "ty-status is-error", "This event’s tickets could not load just now. Close it and open it again in a moment."));
        });
    }

    function load() {
      if (!card || !listBox) return Promise.resolve();
      return call(API)
        .then(function (res) {
          if (res.status === 401 || res.status === 403) {
            card.hidden = true;
            return null;
          }
          if (!res.ok) throw new Error("status " + res.status);
          return res.json();
        })
        .then(function (d) {
          if (!d) return;
          card.hidden = false;
          events = d.events || [];
          drawList();
          if (openId != null) return loadDetail(openId);
        })
        .catch(function () {
          card.hidden = false;
          while (listBox.firstChild) listBox.removeChild(listBox.firstChild);
          listBox.appendChild(el("p", "ty-status is-error", "The event tickets could not load just now. Try again in a moment."));
        });
    }
    function reload() {
      return load();
    }

    if (listBox) {
      listBox.addEventListener("click", function (e) {
        var b = e.target && e.target.closest ? e.target.closest("[data-et-open]") : null;
        if (!b) return;
        var id = Number(b.getAttribute("data-et-open"));
        openId = openId === id ? null : id;
        say("", false);
        drawList();
        if (openId != null) loadDetail(openId);
      });
    }

    // Read afresh whenever the Fundraising section is shown (app.js shows it by taking off `hidden`).
    if (view && card) {
      var Observer = win.MutationObserver || (typeof MutationObserver !== "undefined" ? MutationObserver : null);
      if (Observer) {
        new Observer(function () {
          if (!view.hidden) load();
        }).observe(view, { attributes: true, attributeFilter: ["hidden"] });
      }
      if (!view.hidden && token()) load();
    }
    return { load: load };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { initAdminEventTickets: initAdminEventTickets };
  } else {
    initAdminEventTickets(document, window);
  }
})();
