/* NBCC admin: the Donations gift log (Admin > Giving > Donations, #view-donations in admin.html).
 * Design: docs/superpowers/specs/2026-11-05-donations-screen-design.md; Task 4 of
 * docs/superpowers/plans/2026-11-05-donations-screen.md. The look is Head Elf HQ's
 * (assets/css/admin-donations.css, every class .gl-).
 *
 * app.js still owns the screen's wiring: it reads the filters, asks /api/admin/donations for a page,
 * keeps the pager and says when the list cannot load. This file only draws what it is handed:
 *   - the scoreboard's figures, into the tiles admin.html already holds (each tile is a source tick
 *     box, so Head Elf HQ's "Every payment, in Donations" still ticks #donationsElfFilter);
 *   - a chip for each filter that is on, with a cross, and Clear all;
 *   - the log, day by day, one card per gift or Elf Detective School payment;
 *   - each card's click down, which asks for the gift's details once
 *     (GET /api/admin/donations/:kind/:id/details, src/db/donation-details.ts documents the shape).
 * The words for where a gift was given and how it was paid come ready made from the server
 * (given_on_label, paid_by_label: src/donations/labels.ts). Everything from the server is put on the
 * page as text, never as markup. Status words use is-ok and is-error, never .err, which the public
 * stylesheet hides.
 *
 * A classic <script defer>, exported under a CommonJS guard so it can be unit tested in jsdom
 * (test/unit/admin-gift-log.test.ts).
 */
(function () {
  "use strict";

  var UK = "Europe/London";
  // What brought someone to give has been noted since 6 November 2026; a gift before then shows why
  // it has nothing to say.
  var NOTED_FROM = "2026-11-06";
  var NOTED_FROM_WORDS = "Not noted (we started noting this on 6 November 2026)";
  var NOT_NOTED = "Not noted";
  var DAY_MS = 86400000;

  // The filters on the bar, in the order their chips read. A tile's chip comes first ("Given on").
  var FILTERS = [
    { id: "donationsSearch", name: "Name or email" },
    { id: "donationsFrom", name: "From", date: true },
    { id: "donationsTo", name: "To", date: true },
    { id: "donationsModeFilter", name: "Type" },
    { id: "donationsMethodFilter", name: "Paid by" },
    { id: "donationsCameFilter", name: "Came from" },
    { id: "donationsGiftAidFilter", name: "Gift Aid" },
    { id: "donationsPaymentFilter", name: "Payment" },
    { id: "donationsClaimFilter", name: "Claim" },
  ];
  // The scoreboard's tick boxes (app.js keeps them one at a time: oneSourceFilter).
  var PLACES = [
    "donationsRedBagFilter", "donationsBallFilter", "donationsBallBagsFilter", "donationsInvoiceFilter",
    "donationsElfFilter", "donationsDonatePageFilter", "donationsFundraiserFilter", "donationsCardReaderFilter",
  ];
  var CLAIM_WORDS = {
    eligible: "Ready to claim",
    batched: "In a claim batch",
    claimed: "Claimed",
    not_eligible: "Not eligible",
    adjustment_due: "Adjustment due",
  };

  // ---- pure helpers: dates, times and money in the words staff read ----

  function when(value) {
    var d = value instanceof Date ? value : new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  function ukParts(value, opts) {
    var d = when(value);
    if (!d) return null;
    var out = {};
    var o = { timeZone: UK };
    Object.keys(opts).forEach(function (k) {
      o[k] = opts[k];
    });
    new Intl.DateTimeFormat("en-GB", o).formatToParts(d).forEach(function (p) {
      out[p.type] = p.value;
    });
    return out;
  }
  /** The UK calendar day a moment fell on, as YYYY-MM-DD ("" for no date). */
  function dayKey(value) {
    var p = ukParts(value, { year: "numeric", month: "2-digit", day: "2-digit" });
    return p ? p.year + "-" + p.month + "-" + p.day : "";
  }
  /** "2:34pm", in UK time. */
  function timeLabel(value) {
    var p = ukParts(value, { hour: "numeric", minute: "2-digit", hour12: true });
    if (!p) return "";
    var hour = p.hour === "0" ? "12" : String(Number(p.hour));
    return hour + ":" + p.minute + String(p.dayPeriod || "").toLowerCase().replace(/[^a-z]/g, "");
  }
  // "Thursday 5 November", with the year when it is not this year's.
  function longDay(value, now) {
    var p = ukParts(value, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    if (!p) return "";
    var thisYear = dayKey(now || new Date()).slice(0, 4);
    return p.weekday + " " + p.day + " " + p.month + (p.year === thisYear ? "" : " " + p.year);
  }
  /** A day's heading: "Today", "Yesterday", or "Thursday 5 November". */
  function dayLabel(value, now) {
    now = now || new Date();
    var key = dayKey(value);
    if (!key) return "";
    var today = dayKey(now);
    if (key === today) return "Today";
    // Midday on the day before, so a change of the clocks never skips or repeats a day.
    var t = today.split("-").map(Number);
    if (key === dayKey(new Date(Date.UTC(t[0], t[1] - 1, t[2] - 1, 12)))) return "Yesterday";
    return longDay(value, now);
  }
  // "5 November 2026".
  function dateWords(value) {
    var p = ukParts(value, { day: "numeric", month: "long", year: "numeric" });
    return p ? p.day + " " + p.month + " " + p.year : "";
  }
  // A YYYY-MM-DD from a date box, as "1 November 2026" (it is a calendar day, not a moment).
  function calendarWords(ymd) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd;
    var p = ymd.split("-").map(Number);
    var d = new Date(Date.UTC(p[0], p[1] - 1, p[2], 12));
    return isNaN(d.getTime()) ? ymd : dateWords(d);
  }
  // "Thursday 5 November 2026 at 2:34pm".
  function momentWords(value) {
    var p = ukParts(value, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    return p ? p.weekday + " " + p.day + " " + p.month + " " + p.year + " at " + timeLabel(value) : "";
  }
  /** "£25", "£10.50", "£1,250". */
  function money(pence) {
    if (typeof pence !== "number" || !isFinite(pence)) return "";
    var pounds = pence / 100;
    var whole = pounds % 1 === 0;
    return "£" + pounds.toLocaleString("en-GB", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
  }
  /** Whole pounds, as the totals read: "£412". */
  function wholePounds(pence) {
    return "£" + Math.round(Math.max(0, Number(pence) || 0) / 100).toLocaleString("en-GB");
  }
  function claimWords(status) {
    if (!status) return "";
    if (CLAIM_WORDS[status]) return CLAIM_WORDS[status];
    var words = String(status).replace(/_/g, " ");
    return words.charAt(0).toUpperCase() + words.slice(1);
  }
  function cap(s) {
    s = String(s || "");
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
  }
  function countryName(code) {
    if (!code) return "";
    try {
      return new Intl.DisplayNames(["en-GB"], { type: "region" }).of(String(code).toUpperCase()) || code;
    } catch (e) {
      return code;
    }
  }
  function plural(n, one, many) {
    return Number(n).toLocaleString("en-GB") + " " + (n === 1 ? one : many);
  }
  // A link only to our own pages or to a secure address: never javascript: or the like.
  function safeHref(url) {
    var s = String(url || "");
    return /^\/(?!\/)/.test(s) || /^https:\/\//.test(s) ? s : null;
  }

  function createGiftLog(doc, win) {
    var seq = 0;

    function el(tag, attrs, kids) {
      var n = doc.createElement(tag);
      Object.keys(attrs || {}).forEach(function (k) {
        if (k === "text") n.textContent = attrs[k];
        else if (attrs[k] === true) n.setAttribute(k, "");
        else if (attrs[k] !== false && attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, String(attrs[k]));
      });
      (kids || []).forEach(function (kid) {
        if (kid === null || kid === undefined || kid === false || kid === "") return;
        n.appendChild(typeof kid === "string" ? doc.createTextNode(kid) : kid);
      });
      return n;
    }
    // The Payment words the admin uses everywhere (helpers.js paymentLabel): Paid, Pending, Failed,
    // Refunded, Partly refunded.
    function payment(row) {
      var H = win.AdminHelpers;
      return H && H.paymentLabel ? H.paymentLabel(row) : { label: "Paid", state: "paid" };
    }
    function dot() {
      return el("span", { class: "gl-dot", "aria-hidden": "true", text: "·" });
    }

    // ---- the scoreboard ----

    /** Fills each tile's figures from GET /api/admin/donations/source-totals. False when it has no lines. */
    function drawScores(data) {
      var lines = data && Array.isArray(data.lines) ? data.lines : [];
      if (!lines.length) return false;
      var totals = (data && data.totals) || {};
      lines.forEach(function (l) {
        var key = String((l && l.key) || "").replace(/[^\w]/g, "");
        var slot = key && doc.querySelector('[data-gl-score="' + key + '"]');
        if (!slot) return;
        slot.textContent = "";
        var t = totals[key];
        // The Elf Detective School's entries and every monthly gift's payments are counted as payments.
        var payments = key === "elfSchool" || key === "monthly";
        if (t && t.month && typeof t.month.pence === "number") {
          slot.appendChild(el("b", { class: "gl-tile__sum", text: wholePounds(t.month.pence) }));
          slot.appendChild(el("span", { class: "gl-tile__count", text: plural(Number(t.month.gifts) || 0, payments ? "payment" : "gift", payments ? "payments" : "gifts") + " this month" }));
        } else {
          slot.appendChild(el("span", { class: "gl-tile__count", text: String(l.month || "") + " this month" }));
        }
        slot.appendChild(el("span", { class: "gl-tile__all", text: String(l.all || "") + " in all" }));
      });
      return true;
    }
    /** Empties every tile's figures, so the last visit's are never shown as current. */
    function clearScores() {
      Array.prototype.forEach.call(doc.querySelectorAll("[data-gl-score]"), function (s) {
        s.textContent = "";
      });
    }

    // ---- the chips ----

    function control(id) {
      return doc.getElementById(id);
    }
    function activeFilters() {
      var out = [];
      PLACES.forEach(function (id) {
        var box = control(id);
        if (!box || !box.checked) return;
        var tile = box.closest ? box.closest(".gl-tile") : null;
        var name = tile && tile.querySelector(".gl-tile__name");
        out.push({ id: id, words: "Given on: " + (name ? name.textContent : "one place") });
      });
      FILTERS.forEach(function (f) {
        var c = control(f.id);
        var value = c ? String(c.value || "").trim() : "";
        if (!value) return;
        var words;
        if (f.date) words = f.name + " " + calendarWords(value);
        else if (c.tagName === "SELECT") words = f.name + ": " + (c.options[c.selectedIndex] ? c.options[c.selectedIndex].textContent : value);
        else words = f.name + ": " + value;
        out.push({ id: f.id, words: words });
      });
      return out;
    }
    function clearControl(c) {
      if (c.type === "checkbox") c.checked = false;
      else c.value = "";
    }
    // A change, as a person makes one, so app.js reads the list again its own way.
    function changed(c) {
      c.dispatchEvent(new win.Event("change", { bubbles: true }));
    }
    function focusAfter(box) {
      var next = box.querySelector(".gl-chip__x") || control("donationsSearch");
      if (next && next.focus) next.focus();
    }
    /** A chip with a cross for each filter that is on, and Clear all; hidden when none is. */
    function drawChips(box) {
      if (!box) return;
      box.textContent = "";
      var chips = activeFilters();
      box.hidden = !chips.length;
      if (!chips.length) return;
      var list = el("ul", { class: "gl-chips__list", "aria-label": "Filters in use" });
      chips.forEach(function (chip) {
        var x = el("button", { class: "gl-chip__x", type: "button", "aria-label": "Remove " + chip.words }, [el("span", { "aria-hidden": "true", text: "×" })]);
        x.addEventListener("click", function () {
          var c = control(chip.id);
          if (!c) return;
          clearControl(c);
          changed(c);
          focusAfter(box);
        });
        list.appendChild(el("li", { class: "gl-chip" }, [el("span", { class: "gl-chip__words", text: chip.words }), x]));
      });
      var clear = el("button", { class: "gl-clear", type: "button", text: "Clear all" });
      clear.addEventListener("click", function () {
        var first = null;
        chips.forEach(function (chip) {
          var c = control(chip.id);
          if (!c) return;
          clearControl(c);
          first = first || c;
        });
        // One change for them all: the list is read once.
        if (first) changed(first);
        var search = control("donationsSearch");
        if (search && search.focus) search.focus();
      });
      box.appendChild(list);
      box.appendChild(clear);
    }

    // ---- the log ----

    function badge(kind, words) {
      return words ? el("span", { class: "gl-badge gl-badge--" + kind, text: words }) : null;
    }
    function marks(row, opts) {
      var out = [];
      var elf = row.kind === "elf";
      if (elf) {
        var entry = "Entry " + money(row.entry_pence) + (row.gift_pence > 0 ? ", gift " + money(row.gift_pence) : "");
        out.push(el("span", { class: "gl-note", text: entry }));
      }
      if (row.mode === "monthly") out.push(el("span", { class: "gl-mark gl-mark--monthly", text: "Monthly" }));
      if (row.gift_aid) out.push(el("span", { class: "gl-mark gl-mark--aid", text: "Gift Aid" }));
      var pay = payment(row);
      if (pay.state !== "paid") {
        var bad = pay.state === "failed" || pay.state === "refunded" || pay.state === "partial";
        out.push(el("span", { class: "gl-mark gl-mark--state " + (bad ? "is-error" : "is-waiting"), text: pay.label }));
      }
      if (opts.isNew && opts.isNew(row)) {
        out.push(el("span", { class: "admin-new-pill" }, [el("span", { class: "sr-only", text: ", " }), "New"]));
      }
      return out;
    }
    function card(row, opts) {
      var elf = row.kind === "elf";
      var moreId = "gl-more-" + ++seq;
      var meta = [el("time", { datetime: row.created_at, text: timeLabel(row.created_at) })];
      if (elf && row.elf_reference) meta.push(dot(), el("span", { text: row.elf_reference }));
      if (!elf && row.business_name) meta.push(dot(), el("span", { text: row.business_name }));
      // Stripe's own reference for the payment, to find it in Stripe (TASK-596).
      if (!elf && row.stripe_ref) meta.push(dot(), el("span", { class: "gl-gift__ref", text: row.stripe_ref }));
      var tags = [badge("place", row.given_on_label), badge("pay", row.paid_by_label)].concat(marks(row, opts));
      var face = el("button", { class: "gl-gift__face", type: "button", "aria-expanded": "false", "aria-controls": moreId }, [
        el("span", { class: "gl-gift__amount", text: money(row.amount_pence) }),
        el("span", { class: "gl-gift__who" }, [
          el("span", { class: "gl-gift__name", text: row.donor_name || "Someone" }),
          el("span", { class: "gl-gift__meta" }, meta),
        ]),
        el("span", { class: "gl-gift__tags" }, tags),
        el("span", { class: "gl-gift__chev", "aria-hidden": "true" }),
      ]);
      var more = el("div", { class: "gl-more", id: moreId, hidden: true });
      var li = el("li", { class: "gl-gift" + (elf ? " gl-gift--elf" : ""), "data-kind": elf ? "elf" : "donation", "data-id": row.id }, [face, more]);
      var state = { loaded: false, loading: false };
      face.addEventListener("click", function () {
        var open = face.getAttribute("aria-expanded") !== "true";
        face.setAttribute("aria-expanded", open ? "true" : "false");
        more.hidden = !open;
        li.classList.toggle("is-open", open);
        if (open && !state.loaded && !state.loading) loadMore(row, more, state, opts);
      });
      return li;
    }

    /** The log: a heading for each UK day, and a card for each row under it, in the order given. */
    function drawLog(wrap, rows, opts) {
      opts = opts || {};
      wrap.textContent = "";
      if (!rows || !rows.length) {
        wrap.appendChild(el("p", { class: "admin-empty", text: opts.empty || "No donations yet." }));
        return;
      }
      var now = opts.now || new Date();
      var log = el("div", { class: "gl-log" });
      var day = null;
      var list = null;
      rows.forEach(function (row) {
        var key = dayKey(row.created_at);
        if (key !== day || !list) {
          day = key;
          var headId = "gl-day-" + ++seq;
          list = el("ol", { class: "gl-gifts", "aria-labelledby": headId });
          log.appendChild(el("section", { class: "gl-day" }, [el("h3", { class: "gl-day__head", id: headId, text: dayLabel(row.created_at, now) || "No date" }), list]));
        }
        list.appendChild(card(row, opts));
      });
      wrap.appendChild(log);
    }

    // ---- the click down ----

    function fact(name, value) {
      if (value === null || value === undefined || value === "") return null;
      return el("div", { class: "gl-fact" }, [el("dt", { text: name }), el("dd", { text: String(value) })]);
    }
    function group(title, facts) {
      var shown = facts
        .map(function (f) {
          return fact(f[0], f[1]);
        })
        .filter(Boolean);
      if (!shown.length) return null;
      return el("section", { class: "gl-group" }, [el("h4", { class: "gl-group__head", text: title }), el("dl", { class: "gl-facts" }, shown)]);
    }
    function declarationWords(decl) {
      if (!decl) return null;
      var made = decl.madeAt ? "Made " + dateWords(decl.madeAt) : "Made";
      return decl.revoked ? made + ", withdrawn" + (decl.revokedAt ? " " + dateWords(decl.revokedAt) : "") : made;
    }
    function giftGroups(row, d) {
      var g = d.gift || {};
      var p = d.payment || {};
      var stripe = p.stripe || {};
      var a = d.arrival || {};
      var ga = d.giftAid || {};
      var rf = d.refunds || {};
      var dn = d.donor || {};
      var lb = d.labels || {};
      var ln = d.links || {};
      var at = d.createdAt || row.created_at;
      var amount = typeof g.amountPence === "number" ? g.amountPence : row.amount_pence;
      var before = dayKey(at) && dayKey(at) < NOTED_FROM;
      var batch = ga.batch;
      var other = dn.otherGifts;
      var paidBy = lb.paidByLabel || row.paid_by_label || (p.checkedAt ? NOT_NOTED : "Not checked with Stripe yet");
      var refunds = null;
      if (rf.refundedPence > 0) {
        refunds = group(
          "Refunds",
          [["Refunded", money(rf.refundedPence) + " of " + money(amount)]].concat(
            (rf.events || []).map(function (e) {
              return [dateWords(e.at), (e.dispute ? "A dispute: " : "") + money(e.totalRefundedPence) + " refunded in all by then"];
            }),
          ),
        );
      }
      return [
        group("The gift", [
          ["Amount", money(amount)],
          ["Card fee cover", g.feeCoverPence > 0 ? money(g.feeCoverPence) + " on top" : d.gift ? "None" : null],
          ["Total charged", money(g.totalChargedPence)],
          ["Type", (g.mode || row.mode) === "monthly" ? "Monthly" + (g.plan || row.plan ? ", " + cap(g.plan || row.plan) + " level" : "") : "One off"],
          ["Payment", payment(row).label],
          ["Recorded", momentWords(at)],
          ["Stripe reference", stripe.reference],
          ["Our receipt number", d.reference ? d.reference + ", on their thank you email" : null],
        ]),
        group("How it was paid", [
          ["Paid by", paidBy],
          ["Card from", countryName(p.cardCountry)],
          ["Taken", (g.paymentChannel || row.payment_channel) === "in_person" ? "In person" : "Online"],
          ["Monthly plan in Stripe", stripe.subscriptionId],
        ]),
        group("Where it came from", [
          ["Given on", lb.givenOnLabel || row.given_on_label],
          ["Came from", lb.arrivalLabel || (before ? NOTED_FROM_WORDS : NOT_NOTED)],
          ["Giving page", a.givenOn],
          ["Sponsor pledge", ln.pledgeId ? "Pledge " + ln.pledgeId : null],
        ]),
        group("Gift Aid", [
          ["Gift Aid", (d.giftAid ? ga.giftAid : row.gift_aid) ? "Yes, declared" : "No"],
          ["Declaration", declarationWords(ga.declaration)],
          ["Claim", claimWords(ga.claimStatus || row.claim_status)],
          ["Claim batch", batch ? "Batch " + batch.id + ", " + String(batch.status || "").replace(/_/g, " ") + (batch.submittedAt ? " " + dateWords(batch.submittedAt) : "") : null],
        ]),
        refunds,
        group("The donor", [
          ["Name", dn.name || row.donor_name],
          ["Business", dn.businessName],
          ["Email", dn.email || row.donor_email],
          ["Emails from us", d.donor ? (dn.emailConsent ? "Yes" : "No") : null],
          ["Billing address", [dn.billingAddress, dn.billingPostcode].filter(Boolean).join(", ")],
          ["Other gifts", other ? (other.count > 0 ? plural(other.count, "more gift", "more gifts") + " from this email address, " + money(other.totalPence) + " in all" : "None from this email address") : null],
        ]),
      ];
    }
    function elfGroups(row, d) {
      var g = d.gift || {};
      var ga = d.giftAid || {};
      var fam = d.family || {};
      var entry = typeof g.entryPence === "number" ? g.entryPence : row.entry_pence;
      var extra = typeof g.giftPence === "number" ? g.giftPence : row.gift_pence;
      return [
        group("The payment", [
          ["Entry", money(entry)],
          ["Gift on top", extra > 0 ? money(extra) : "None"],
          ["Card fee cover", g.feeCoverPence > 0 ? money(g.feeCoverPence) + " on top" : null],
          ["Total charged", money(g.totalChargedPence)],
          ["Detectives", g.detectives],
          ["Paid", momentWords(d.createdAt || row.created_at)],
          ["Reference", d.reference || row.elf_reference],
          ["Given on", "Elf Detective School"],
        ]),
        group("Gift Aid", [
          ["On the gift", (d.giftAid ? ga.giftAid : row.gift_aid) ? "Yes, declared" : "No"],
          ["Declaration", declarationWords(ga.declaration)],
          ["Entries", "Never claimed: an entry is a payment to take part"],
        ]),
        group("The family", [
          ["Grown up", fam.name || row.donor_name],
          ["Email", fam.email || row.donor_email],
        ]),
      ];
    }
    function link(words, href) {
      var safe = safeHref(href);
      if (!safe) return null;
      var away = /^https:/.test(safe);
      return el("a", { class: "gl-btn", href: safe, target: away ? "_blank" : null, rel: away ? "noopener noreferrer" : null, text: words });
    }
    // What a card leads to. The donor and Head Elf HQ come from the row, so they are there at once;
    // the rest come with the details. app.js's click handler on .admin-content opens data-donor and
    // data-elf-family, as it did for the old table.
    function actions(row, opts, d) {
      var elf = row.kind === "elf";
      var ln = (d && d.links) || {};
      var stripe = (d && d.payment && d.payment.stripe) || {};
      var kids = [];
      if (!elf && row.donor_id) kids.push(el("button", { class: "gl-btn gl-btn--go", type: "button", "data-donor": row.donor_id, text: "Open the donor" }));
      if (elf && opts.canOpenElf && row.elf_family_id) {
        kids.push(el("button", { class: "gl-btn gl-btn--go", type: "button", "data-elf-family": Number(row.elf_family_id), text: "Open in Head Elf HQ" }));
      }
      if (ln.fundraiser && ln.fundraiser.pagePath) kids.push(link("The fundraiser's page", ln.fundraiser.pagePath));
      if (ln.invoice) kids.push(link("The invoice", ln.invoice.url));
      kids.push(link("See it in Stripe", stripe.dashboardUrl));
      kids.push(link("The monthly plan in Stripe", stripe.subscriptionUrl));
      var shown = kids.filter(Boolean);
      return shown.length ? el("div", { class: "gl-actions" }, shown) : null;
    }
    function loadMore(row, more, state, opts) {
      more.textContent = "";
      var body = el("div", { class: "gl-more__body" }, [el("p", { class: "gl-loading", role: "status", text: "Loading…" })]);
      more.appendChild(body);
      var first = actions(row, opts, null);
      if (first) more.appendChild(first);
      if (!opts.details) {
        body.textContent = "";
        return;
      }
      state.loading = true;
      var kind = row.kind === "elf" ? "elf" : "donation";
      Promise.resolve()
        .then(function () {
          return opts.details(kind, row.id);
        })
        .then(function (d) {
          d = d && typeof d === "object" ? d : {};
          state.loading = false;
          state.loaded = true;
          more.textContent = "";
          var groups = (kind === "elf" ? elfGroups(row, d) : giftGroups(row, d)).filter(Boolean);
          more.appendChild(el("div", { class: "gl-groups" }, groups));
          var all = actions(row, opts, d);
          if (all) more.appendChild(all);
        })
        .catch(function () {
          state.loading = false;
          body.textContent = "";
          body.appendChild(el("p", { class: "gl-status is-error", role: "status", text: "These details could not load. Close the gift and open it again to try once more." }));
        });
    }

    return { drawLog: drawLog, drawScores: drawScores, clearScores: clearScores, drawChips: drawChips, activeFilters: activeFilters };
  }

  var api = {
    createGiftLog: createGiftLog,
    dayKey: dayKey,
    dayLabel: dayLabel,
    timeLabel: timeLabel,
    money: money,
    wholePounds: wholePounds,
    claimWords: claimWords,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else window.AdminGiftLog = createGiftLog(document, window);
})();
