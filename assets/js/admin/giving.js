/* NBCC admin: Giving > Claims, GASDS and Subscriptions (#view-claims, #view-gasds and
 * #view-subscriptions in admin.html), in the kit's look (assets/css/admin-kit.css, with
 * assets/css/admin-giving.css for what only these three need).
 * Design: docs/superpowers/specs/2026-11-14-admin-refresh-giving.md.
 *
 * Its own file beside app.js, as the gift log and Santa Sleigh are. app.js makes it once, handing
 * over its own authFetch (which signs a request and goes back to sign in on a 401), canView and
 * canEdit, and calls openClaims(), openGasds() or openSubs() when that screen is chosen. A donor's
 * name is a [data-donor] button and the way across to Monthly givers a [data-goto-section] one;
 * app.js already answers both for every screen.
 *
 * Every message is said in the page, beside the button that was pressed, with is-ok or is-error
 * (never the class the public stylesheet hides). Nothing here calls alert(). Everything from the
 * server goes onto the page escaped. Words the database uses (open, submitted, adjustment_due,
 * expired, expiring, past_due) are never shown: each has a plain phrase.
 *
 * A classic <script defer> after kit.js and before app.js, exported under a CommonJS guard so it is
 * unit tested in jsdom (test/unit/admin-giving-*.test.ts).
 */
(function () {
  "use strict";

  var UK = "Europe/London";
  // The guide on the Claims screen: "One batch is one HMRC claim (up to 1,000 donations; above that
  // HMRC needs claiming software)".
  var BATCH_LIMIT = 1000;

  /** "3 November 2026", as people say it; "" for nothing or not a date. */
  function dayWords(value) {
    if (!value) return "";
    var d = new Date(value);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: UK });
  }
  /** 1001 as "1,001". */
  function count(n) {
    return (Number(n) || 0).toLocaleString("en-GB");
  }
  /** "1 donation", "12 donations", "1,001 donations". */
  function some(n, one, many) {
    return count(n) + " " + ((Number(n) || 0) === 1 ? one : many);
  }
  /** About what HMRC pays back on a gift: 25p for every pound, as the Claims screen opens by saying. */
  function claimBack(pence) {
    return Math.round((Number(pence) || 0) / 4);
  }
  function sum(rows, field) {
    return rows.reduce(function (total, r) { return total + (Number(r[field]) || 0); }, 0);
  }

  // A claim batch's state, and what goes in its pill (.ak-mark--…).
  var BATCH_STATES = {
    open: { words: "Being put together", mark: "wait" },
    submitted: { words: "Sent to HMRC", mark: "ok" },
    adjustment_due: { words: "To repay", mark: "bad" },
  };
  function batchState(status) {
    return BATCH_STATES[status] || { words: "Not known", mark: "quiet" };
  }
  // Why a donation could not go into a batch (src/db/donations-model.ts, batchAssignmentBlock).
  var ADD_REFUSALS = {
    already_batched: "already in a batch",
    not_eligible: "no longer ready to claim",
    not_found: "no longer there",
  };
  /** "1 already in a batch, 1 no longer ready to claim", in the order they first came. */
  function refusalWords(failed) {
    var order = [];
    var counts = {};
    (failed || []).forEach(function (f) {
      var words = ADD_REFUSALS[f && f.reason] || "could not be saved";
      if (!counts[words]) { counts[words] = 0; order.push(words); }
      counts[words] += 1;
    });
    return order.map(function (words) { return count(counts[words]) + " " + words; }).join(", ");
  }
  /** The webhook writes "refund via charge.refunded"; a person reads that the donation was refunded. */
  function adjustmentReason(reason) {
    var r = String(reason || "");
    return /^refund via /i.test(r) ? "The donation was refunded" : r;
  }
  // ---- GASDS: the tax year a small donation belongs to ----
  // The claim deadline is two years after the 5 April that ends the tax year of collection
  // (src/gasds/deadline.ts), so a row's deadline says which tax year the server put it in.
  var GASDS_CLAIM_YEARS = 2;
  /** The tax year a small donation was collected in, as the year its 5 April falls in. */
  function taxYearEnd(row) {
    var deadline = new Date(row && row.gasdsDeadline ? row.gasdsDeadline : NaN);
    if (!isNaN(deadline.getTime())) return deadline.getUTCFullYear() - GASDS_CLAIM_YEARS;
    var at = new Date(row && row.collectedAt ? row.collectedAt : NaN);
    if (isNaN(at.getTime())) return 0;
    var onOrBefore5April = at.getUTCMonth() < 3 || (at.getUTCMonth() === 3 && at.getUTCDate() <= 5);
    return onOrBefore5April ? at.getUTCFullYear() : at.getUTCFullYear() + 1;
  }
  /** "6 April 2024 to 5 April 2025". */
  function taxYearWords(endYear) {
    return "6 April " + (endYear - 1) + " to 5 April " + endYear;
  }
  /**
   * Small donations by tax year: [{ endYear, rows, count, totalPence, deadline, flag }]. The years
   * that can still be claimed come first, nearest deadline first; the ones too late come last.
   */
  function groupByTaxYear(rows) {
    var byYear = {};
    var groups = [];
    (rows || []).forEach(function (r) {
      var y = taxYearEnd(r);
      if (!byYear[y]) {
        byYear[y] = { endYear: y, rows: [], count: 0, totalPence: 0, deadline: r.gasdsDeadline, flag: r.flag };
        groups.push(byYear[y]);
      }
      byYear[y].rows.push(r);
      byYear[y].count += 1;
      byYear[y].totalPence += Number(r.amountPence) || 0;
    });
    return groups.sort(byDeadline);
  }
  function byDeadline(a, b) {
    var lateA = a.flag === "expired";
    var lateB = b.flag === "expired";
    if (lateA !== lateB) return lateA ? 1 : -1;
    var ta = new Date(a.deadline).getTime() || 0;
    var tb = new Date(b.deadline).getTime() || 0;
    return lateA ? tb - ta : ta - tb;
  }
  var GASDS_STATES = { expired: "Too late to claim", expiring: "Deadline within six months", later: "In good time" };
  /** The list as a spreadsheet: the headings, then a row for each small donation. */
  function gasdsSheet(rows) {
    return [["Donation", "Name", "Amount (£)", "Collected", "Tax year", "Claim by", "Where it stands"]].concat(
      (rows || []).map(function (r) {
        return [
          Number(r.id), r.full_name, (Number(r.amountPence) || 0) / 100, dayWords(r.collectedAt),
          taxYearWords(taxYearEnd(r)), dayWords(r.gasdsDeadline), GASDS_STATES[r.flag] || "",
        ];
      })
    );
  }

  // ---- Subscriptions: what has happened to a monthly gift ----
  /** "March 2024". */
  function monthWords(value) {
    if (!value) return "";
    var d = new Date(value);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: UK });
  }
  /**
   * Which of the four groups a monthly gift is in. Someone cancelling is stamped in cancelled_at
   * while the payment state may stay as it was, so cancelled comes first (as the pill has it:
   * AdminHelpers.subscriptionStateLabel).
   */
  function subscriptionGroup(row) {
    if (row && row.cancelled_at) return "cancelled";
    var status = row && row.status;
    if (status === "lapsed") return "stopped";
    if (status === "past_due") return "failing";
    return "normal";
  }
  /** "Card failed twice. Stripe is still trying." and its like: what the Failed and Ended columns said. */
  function subscriptionWords(row) {
    var group = subscriptionGroup(row);
    var tries = Number(row && row.failed_attempts) || 0;
    if (group === "cancelled") return "They cancelled on " + dayWords(row.cancelled_at) + ".";
    if (group === "stopped") {
      return (
        "Stopped" + (row.lapsed_at ? " on " + dayWords(row.lapsed_at) : "") +
        (tries ? " after " + (tries === 1 ? "1 try" : count(tries) + " tries") : "") + "."
      );
    }
    if (group === "failing") {
      var times = tries === 1 ? " once" : tries === 2 ? " twice" : tries ? " " + count(tries) + " times" : "";
      return "Card failed" + times + ". Stripe is still trying.";
    }
    return "Paying as normal.";
  }

  var AWAITING_STATES = { sent: "Sent, not yet confirmed", undelivered: "Could not be delivered" };
  var KEEP_STATES = { expired: "Keep date has passed", expiring: "Within six months" };
  var SCOPES = { all_donations: "Every donation they make", this_donation: "One donation" };

  function createGiving(doc, win, host) {
    var H = win.AdminHelpers;
    var Kit = win.AdminKit;
    var esc = H.escapeHtml;
    var money = H.formatPence;

    function $(id) {
      return doc.getElementById(id);
    }
    /** A list, but only when the server said it was fine: anything else is a failure, never "empty". */
    function getJson(path) {
      return host.authFetch(path).then(function (res) {
        if (!res.ok) {
          var err = new Error("status " + res.status);
          err.status = res.status;
          throw err;
        }
        return res.json();
      });
    }
    /** A change: resolves { ok, status, body } whatever the server answered, so the caller can say which. */
    function send(path, body) {
      return host
        .authFetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) })
        .then(function (res) {
          return res.json().then(
            function (b) { return { ok: res.ok, status: res.status, body: b || {} }; },
            function () { return { ok: res.ok, status: res.status, body: {} }; }
          );
        });
    }
    /** What happened, beside the button. bad true is a failure, false a success, left out neither. */
    function say(node, words, bad) {
      if (!node) return;
      node.textContent = words || "";
      node.classList.toggle("is-error", bad === true && !!words);
      node.classList.toggle("is-ok", bad === false && !!words);
    }
    function emptyHtml(words) {
      return '<p class="admin-empty">' + esc(words) + "</p>";
    }
    function unavailableHtml(words) {
      return '<p class="admin-empty admin-unavailable">' + esc(words) + "</p>";
    }
    /** Someone's name: a button that opens their page for a person who may open Donations. */
    function donorName(name, donorId) {
      if (donorId && host.canView("donations")) {
        return '<button class="admin-link gv-name" type="button" data-donor="' + Number(donorId) + '">' + esc(name) + "</button>";
      }
      return '<span class="gv-name">' + esc(name) + "</span>";
    }
    /**
     * Donations as rows, the same on every size: a tick where one can be ticked, who, the small
     * print, the amount. A phone has no room for a six column table and a card for each of a
     * hundred donations is a very long page; a row is two lines there and one on a laptop.
     * opts: { tick: the tick box's class or "", heads: [who, ...small print] }.
     * items: [{ id, name, donorId, pence, meta: [words, ...] }].
     */
    function rowsHtml(items, opts) {
      var head =
        '<li class="gv-row gv-row--head" aria-hidden="true">' +
        (opts.tick ? '<span class="gv-row__tick"></span>' : "") +
        '<span class="gv-row__who">' + esc(opts.heads[0]) + "</span>" +
        '<span class="gv-row__meta">' +
        opts.heads.slice(1).map(function (h) { return "<span>" + esc(h) + "</span>"; }).join("") +
        '</span><span class="gv-row__amount">Amount</span></li>';
      var body = items
        .map(function (it) {
          var id = Number(it.id);
          var tick = opts.tick
            ? '<label class="gv-row__tick"><input type="checkbox" class="' + opts.tick + '" value="' + id + '" data-pence="' +
              (Number(it.pence) || 0) + '" aria-label="' + esc("Select donation " + id + ", " + it.name + ", " + money(Number(it.pence) || 0)) + '"></label>'
            : "";
          return (
            '<li class="gv-row">' + tick +
            '<span class="gv-row__who">' + donorName(it.name, it.donorId) + "</span>" +
            '<span class="gv-row__meta">' +
            it.meta.map(function (m) { return "<span>" + esc(m) + "</span>"; }).join("") +
            '</span><span class="gv-row__amount">' + esc(money(Number(it.pence) || 0)) + "</span></li>"
          );
        })
        .join("");
      return '<ul class="gv-rows' + (opts.tick ? " gv-rows--tick" : "") + '">' + head + body + "</ul>";
    }
    /** A table that is a card per row on a phone, its cells named from its headings. */
    function drawTable(wrap, heads, rows) {
      wrap.innerHTML =
        '<div class="admin-table-wrap"><table class="admin-table ak-cards"><thead><tr>' +
        heads.map(function (h) { return "<th>" + esc(h) + "</th>"; }).join("") +
        "</tr></thead><tbody>" + rows.join("") + "</tbody></table></div>";
      Kit.labelCells(wrap.querySelector("table"));
    }
    function ticked(selector) {
      return Array.prototype.filter.call(doc.querySelectorAll(selector), function (box) { return box.checked; });
    }
    /** Hands the person a file. False where the browser cannot, so the caller can say so. */
    function saveFile(name, contents) {
      if (!win.Blob || !win.URL || !win.URL.createObjectURL) return false;
      var url = win.URL.createObjectURL(new win.Blob([contents], { type: "text/csv" }));
      var a = doc.createElement("a");
      a.href = url;
      a.download = name;
      a.hidden = true;
      doc.body.appendChild(a);
      a.click();
      doc.body.removeChild(a);
      if (win.URL.revokeObjectURL) win.setTimeout(function () { win.URL.revokeObjectURL(url); }, 1000);
      return true;
    }

    // ================================ Claims ================================
    // Each list is null while it is being fetched, false when it could not be, else its rows.
    var claims = {
      wired: false, parts: null,
      ready: null, batches: null, repay: null, awaiting: null, review: null, keep: null,
      said: null, // { batch, words, bad }: what last happened to a batch, said in its card
      openBatches: {}, // batch id -> its donations are showing
      batchDonations: {}, // batch id -> its donations, once fetched
    };
    var CLAIMS_LISTS = {
      ready: "/api/admin/claims/eligible",
      batches: "/api/admin/claim-batches",
      repay: "/api/admin/claims/adjustment-due",
      awaiting: "/api/admin/queues/awaiting-declaration",
      review: "/api/admin/queues/declaration-review",
      keep: "/api/admin/queues/retention-expiry",
    };
    // One tile each: the count, its name, and the part (and the heading in it) it opens.
    var CLAIMS_TILES = [
      { key: "ready", part: "ready", name: "Ready to claim" },
      { key: "open", part: "batches", name: "Being put together", says: "Batches not yet sent to HMRC" },
      { key: "sent", part: "batches", name: "Sent to HMRC", says: "Batches marked as sent" },
      { key: "repay", part: "repay", name: "To repay", says: "Refunded after they were claimed" },
      { key: "awaiting", part: "declarations", head: "claimsAwaitingHead", name: "Declarations not come back", says: "Sent to the donor, not yet confirmed" },
      { key: "review", part: "declarations", head: "claimsReviewHead", name: "Declarations due a review", says: "Made more than two years ago" },
      { key: "keep", part: "declarations", head: "claimsKeepHead", name: "Records near their keep date", says: "Past it, or within six months" },
    ];

    function batchesIn(status) {
      if (!Array.isArray(claims.batches)) return claims.batches;
      return claims.batches.filter(function (b) { return b.status === status; });
    }
    /** The rows behind a tile: null still fetching, false could not be fetched. */
    function tileRows(key) {
      if (key === "open") return batchesIn("open");
      if (key === "sent") return batchesIn("submitted");
      return claims[key];
    }
    function drawClaimsTiles() {
      var wrap = $("claimsTiles");
      if (!wrap) return;
      wrap.innerHTML = CLAIMS_TILES.map(function (t) {
        var rows = tileRows(t.key);
        var n = rows === null ? "…" : rows === false ? "?" : count(rows.length);
        var says = t.says || "";
        if (rows === false) says = "Could not be loaded";
        else if (t.key === "ready" && Array.isArray(rows)) {
          var total = sum(rows, "amount_pence");
          says = rows.length ? money(total) + " given, about " + money(claimBack(total)) + " to claim back" : "Nothing waiting";
        }
        var none = Array.isArray(rows) && !rows.length;
        return (
          '<li><button type="button" class="ak-tile' + (none ? " is-none" : "") + '" data-claims-tile="' + t.key + '">' +
          '<span class="ak-tile__n">' + esc(n) + '</span><span class="ak-tile__name">' + esc(t.name) +
          '</span><span class="ak-tile__says">' + esc(says) + "</span></button></li>"
        );
      }).join("");
      var has = function (key) { var rows = tileRows(key); return Array.isArray(rows) && rows.length > 0; };
      dot("claimsDotReady", has("ready"));
      dot("claimsDotBatches", has("open"));
      dot("claimsDotRepay", has("repay"));
      dot("claimsDotDeclarations", has("awaiting") || has("review") || has("keep"));
    }
    /** The dot on a part's button, and the words after it that say the same to a screen reader. */
    function dot(id, on) {
      var d = $(id);
      if (!d) return;
      d.hidden = !on;
      var words = d.nextElementSibling;
      if (words && words.classList.contains("gv-sr")) words.hidden = !on;
    }

    function drawReady() {
      var wrap = $("eligibleTable");
      var bar = $("eligibleActions");
      var rows = claims.ready;
      if (rows === null) return;
      if (rows === false) {
        wrap.innerHTML = unavailableHtml("Donations waiting to be claimed are unavailable.");
        bar.hidden = true;
        return;
      }
      if (!rows.length) {
        wrap.innerHTML = emptyHtml("No donations are waiting to be claimed.");
        bar.hidden = true;
        return;
      }
      var canWrite = host.canEdit("claims");
      bar.hidden = !canWrite;
      wrap.innerHTML = rowsHtml(
        rows.map(function (r) {
          return {
            id: r.id, name: r.donor_name, donorId: r.donor_id, pence: r.amount_pence,
            meta: [r.postcode || "", dayWords(r.created_at), "Donation " + Number(r.id)],
          };
        }),
        { tick: canWrite ? "elig-check" : "", heads: ["Donor", "Postcode", "Date", "Number"] }
      );
      tallyReady();
    }
    /** The running line under Tick all, and the warning past 1,000 in one batch. */
    function tallyReady() {
      var boxes = Array.prototype.slice.call(doc.querySelectorAll("#eligibleTable .elig-check"));
      var on = boxes.filter(function (b) { return b.checked; });
      var pence = on.reduce(function (total, b) { return total + (Number(b.getAttribute("data-pence")) || 0); }, 0);
      $("eligTally").textContent = on.length
        ? count(on.length) + " ticked, " + money(pence) + " given, about " + money(claimBack(pence)) + " to claim back"
        : "None ticked yet.";
      $("eligTickAll").textContent = boxes.length && on.length === boxes.length ? "Untick all" : "Tick all";
      var target = $("assignBatchSelect").value;
      var already = 0;
      if (target !== "new" && Array.isArray(claims.batches)) {
        claims.batches.forEach(function (b) { if (String(b.id) === target) already = Number(b.donation_count) || 0; });
      }
      var would = already + on.length;
      var limit = $("eligLimit");
      if (on.length && would > BATCH_LIMIT) {
        limit.textContent =
          (already ? "That would put " + count(would) + " donations in batch " + target + ". " : "You have ticked " + count(would) + " donations. ") +
          "One batch is one HMRC claim, and HMRC’s spreadsheet takes up to " + count(BATCH_LIMIT) +
          " donations. Untick some and put the rest in another batch.";
        limit.hidden = false;
      } else {
        limit.hidden = true;
        limit.textContent = "";
      }
    }
    function tickAllReady() {
      var boxes = Array.prototype.slice.call(doc.querySelectorAll("#eligibleTable .elig-check"));
      var all = boxes.length && boxes.every(function (b) { return b.checked; });
      boxes.forEach(function (b) { b.checked = !all; });
      tallyReady();
    }
    function addTicked() {
      var status = $("eligStatus");
      var ids = ticked("#eligibleTable .elig-check").map(function (b) { return Number(b.value); });
      if (!ids.length) return say(status, "Tick at least one donation first.", true);
      var target = $("assignBatchSelect").value;
      var btn = $("assignBtn");
      btn.disabled = true;
      say(status, "Adding…");
      var done = function () { btn.disabled = false; };

      function add(batchId, started) {
        return send("/api/admin/claim-batches/" + batchId + "/donations", { donationIds: ids })
          .then(function (out) {
            if (!out.ok) throw new Error("status " + out.status);
            var added = (out.body.assigned || []).length;
            var failed = out.body.failed || [];
            var words = "Added " + some(added, "donation", "donations") + " to batch " + batchId + ".";
            if (failed.length && added) words += " " + count(failed.length) + " could not be added (" + refusalWords(failed) + ").";
            else if (failed.length) words = "None of those could be added to batch " + batchId + " (" + refusalWords(failed) + ").";
            return reloadClaims().then(function () { say(status, words, failed.length > 0); });
          })
          .catch(function () {
            if (!started) return say(status, "Those donations could not be added to batch " + batchId + ". Nothing was changed.", true);
            // The batch exists now, empty: say which, and list it so it can be chosen.
            return reloadClaims().then(function () {
              say(status, "Batch " + batchId + " was started, but the donations could not be added to it. Choose Batch " + batchId + " above and try again.", true);
            });
          });
      }

      if (target !== "new") return add(target, false).then(done);
      return send("/api/admin/claim-batches", {})
        .then(function (out) {
          if (!out.ok || !out.body.batchId) throw new Error("status " + out.status);
          return out.body.batchId;
        })
        .then(
          function (batchId) { return add(batchId, true); },
          function () { say(status, "A new batch could not be started, so nothing was added.", true); }
        )
        .then(done);
    }

    /** The batches still being put together, in the box that says which one to add to. */
    function fillBatchSelect() {
      var pick = $("assignBatchSelect");
      if (!pick) return;
      var was = pick.value;
      var html = '<option value="new">New batch</option>';
      (Array.isArray(claims.batches) ? claims.batches : []).forEach(function (b) {
        if (b.status === "open") html += '<option value="' + Number(b.id) + '">Batch ' + Number(b.id) + "</option>";
      });
      pick.innerHTML = html;
      // Keep what was chosen when it is still there to choose.
      if (Array.prototype.some.call(pick.options, function (o) { return o.value === was; })) pick.value = was;
    }
    function batchById(id) {
      var found = null;
      (Array.isArray(claims.batches) ? claims.batches : []).forEach(function (b) { if (Number(b.id) === Number(id)) found = b; });
      return found;
    }
    function batchHtml(b) {
      var id = Number(b.id);
      var state = batchState(b.status);
      var n = Number(b.donation_count) || 0;
      var total = Number(b.total_pence) || 0;
      var canWrite = host.canEdit("claims");
      var open = !!claims.openBatches[id] && n > 0;
      var sumWords = n
        ? some(n, "donation", "donations") + ", " + money(total) + " given" +
          (b.status === "open" ? ", about " + money(claimBack(total)) + " to claim back" : "")
        : "No donations in it yet";
      var facts =
        "<dt>Started</dt><dd>" + esc(dayWords(b.created_at) || "Not recorded") + "</dd>" +
        "<dt>Sent to HMRC</dt><dd>" + esc(b.submitted_at ? dayWords(b.submitted_at) : "Not yet") + "</dd>" +
        (b.hmrc_reference ? "<dt>HMRC reference</dt><dd>" + esc(b.hmrc_reference) + "</dd>" : "");
      var canMark = canWrite && b.status === "open";
      var buttons = "";
      // The next thing to do with a batch being put together is to download it; one already sent
      // has nothing left that must be done, so its buttons are all the plain kind.
      if (canWrite) buttons += '<button class="admin-btn' + (canMark ? "" : " ak-btn--plain") + '" type="button" data-export-batch="' + id + '">Download for HMRC</button>';
      if (canMark) buttons += '<button class="admin-btn ak-btn--plain" type="button" data-submit-batch="' + id + '">Mark as sent to HMRC</button>';
      if (n) {
        buttons +=
          '<button class="admin-btn ak-btn--plain" type="button" data-batch-open="' + id + '" aria-expanded="' + open +
          '" aria-controls="claimsBatch' + id + 'Donations">' + esc(open ? "Hide the donations" : "See the " + some(n, "donation", "donations")) + "</button>";
      }
      var said = claims.said && Number(claims.said.batch) === id ? claims.said : null;
      return (
        '<li class="ak-card gv-batch" data-batch="' + id + '">' +
        '<div class="gv-batch__head"><h4 class="gv-batch__name">Batch ' + id + '</h4><span class="admin-pill ak-mark--' + state.mark + '">' + esc(state.words) + "</span></div>" +
        '<p class="gv-batch__sum">' + esc(sumWords) + "</p>" +
        '<dl class="ak-facts">' + facts + "</dl>" +
        (buttons ? '<div class="ak-actions">' + buttons + "</div>" : "") +
        (canMark
          ? '<small class="ak-says">Mark as sent to HMRC only records here that this claim has gone. It sends nothing to HMRC, so send the claim on Charities Online first. It cannot be undone from here.</small>'
          : "") +
        '<p class="admin-action-status' + (said ? (said.bad === true ? " is-error" : said.bad === false ? " is-ok" : "") : "") +
        '" role="status" data-batch-status="' + id + '">' + esc(said ? said.words : "") + "</p>" +
        (n ? '<div class="gv-batch__inside" id="claimsBatch' + id + 'Donations"' + (open ? "" : " hidden") + "></div>" : "") +
        "</li>"
      );
    }
    function drawBatches() {
      var wrap = $("batchesTable");
      var rows = claims.batches;
      if (rows === null) return;
      fillBatchSelect();
      if (rows === false) {
        wrap.innerHTML = unavailableHtml("Claim batches are unavailable.");
        return;
      }
      if (!rows.length) {
        wrap.innerHTML = emptyHtml("No claim batches.");
        return;
      }
      wrap.innerHTML = '<ul class="ak-list">' + rows.map(batchHtml).join("") + "</ul>";
      rows.forEach(function (b) { if (claims.openBatches[Number(b.id)]) drawBatchDonations(Number(b.id)); });
      if ($("eligibleTable").querySelector(".elig-check")) tallyReady();
    }
    /** What happened to a batch, in its own card; kept so it is still there once the list is redrawn. */
    function sayBatch(id, words, bad) {
      claims.said = { batch: Number(id), words: words, bad: bad };
      say(doc.querySelector('#batchesTable [data-batch-status="' + Number(id) + '"]'), words, bad);
    }
    function markBatchSent(id) {
      var question =
        "Have you sent batch " + id + " to HMRC on Charities Online? This only records that it has gone. " +
        "It sends nothing to HMRC, and it cannot be undone from here.";
      if (!win.confirm(question)) return;
      var failed = "Batch " + id + " could not be marked as sent. Nothing was changed.";
      sayBatch(id, "Saving…");
      send("/api/admin/claim-batches/" + id + "/submit")
        .then(function (out) {
          if (out.ok) {
            claims.said = { batch: Number(id), words: "Batch " + id + " is marked as sent to HMRC.", bad: false };
            return loadClaimsList("batches");
          }
          if (out.status === 409) return sayBatch(id, "Batch " + id + " has already been marked as sent.", true);
          if (out.status === 404) return sayBatch(id, "Batch " + id + " could not be found.", true);
          return sayBatch(id, failed, true);
        })
        .catch(function () { sayBatch(id, failed, true); });
    }
    function downloadBatch(id) {
      var noFile = "Batch " + id + " could not be downloaded, so no file was made.";
      sayBatch(id, "Getting the file…");
      host
        .authFetch("/api/admin/claim-batches/" + id + "/export")
        .then(function (res) {
          // The answer is checked before anything is handed over: a refusal used to arrive as a
          // file called claim-batch-7.csv with the error inside it.
          if (res.status === 403) {
            sayBatch(id, "Downloading a claim is not part of your access, so no file was made.", true);
            return null;
          }
          if (!res.ok) {
            sayBatch(id, noFile + " The usual cause is a donor’s declaration with no house name or number, or no postcode. Check the donors in this batch and try again.", true);
            return null;
          }
          return res.text();
        })
        .then(function (csv) {
          if (csv === null) return;
          var lines = String(csv).split(/\r\n|\n/).filter(function (line) { return line.length > 0; });
          var inFile = Math.max(0, lines.length - 1); // less the headings
          if (!inFile) return sayBatch(id, "Batch " + id + " has no donations that can go in the file, so no file was made.", true);
          var name = "claim-batch-" + id + ".csv";
          if (!saveFile(name, csv)) return sayBatch(id, "This browser could not save the file.", true);
          var batch = batchById(id);
          var held = batch ? Number(batch.donation_count) || 0 : inFile;
          sayBatch(
            id,
            inFile < held
              ? "Downloaded " + name + " with " + count(inFile) + " of this batch’s " + some(held, "donation", "donations") +
                ". Donations from outside the UK and ones refunded in full are left out of the file."
              : "Downloaded " + name + " with " + some(inFile, "donation", "donations") + ".",
            false
          );
        })
        .catch(function () { sayBatch(id, noFile + " Check your connection and try again.", true); });
    }
    function toggleBatch(id) {
      id = Number(id);
      claims.openBatches[id] = !claims.openBatches[id];
      var open = claims.openBatches[id];
      var btn = doc.querySelector('#batchesTable [data-batch-open="' + id + '"]');
      var box = $("claimsBatch" + id + "Donations");
      var batch = batchById(id);
      if (btn) {
        btn.setAttribute("aria-expanded", String(open));
        btn.textContent = open ? "Hide the donations" : "See the " + some(batch ? batch.donation_count : 0, "donation", "donations");
      }
      if (box) box.hidden = !open;
      if (open) drawBatchDonations(id);
    }
    function drawBatchDonations(id) {
      var box = $("claimsBatch" + id + "Donations");
      if (!box) return;
      var known = claims.batchDonations[id];
      var draw = function (rows) {
        if (rows === false) {
          box.innerHTML = unavailableHtml("The donations in this batch could not be loaded.");
          return;
        }
        if (!rows.length) {
          box.innerHTML = emptyHtml("This batch has no donations in it yet.");
          return;
        }
        box.innerHTML = rowsHtml(
          rows.map(function (r) {
            var refunded = Number(r.refunded_amount_pence) || 0;
            return {
              id: r.id, name: r.donor_name, donorId: r.donor_id, pence: r.amount_pence,
              meta: [r.postcode || "", dayWords(r.created_at), "Donation " + Number(r.id) + (refunded ? ", " + money(refunded) + " of it refunded" : "")],
            };
          }),
          { tick: "", heads: ["Donor", "Postcode", "Date", "Number"] }
        );
      };
      if (Array.isArray(known)) return draw(known);
      box.innerHTML = '<p class="admin-loading">Loading…</p>';
      getJson("/api/admin/claim-batches/" + id + "/donations")
        .then(
          function (d) { claims.batchDonations[id] = d.results || []; return claims.batchDonations[id]; },
          function () { return false; }
        )
        .then(function (rows) {
          var still = $("claimsBatch" + id + "Donations");
          if (still) { box = still; draw(rows); }
        });
    }

    function drawRepay() {
      var wrap = $("adjustmentTable");
      var rows = claims.repay;
      if (rows === null) return;
      if (rows === false) { wrap.innerHTML = unavailableHtml("Adjustments are unavailable."); return; }
      if (!rows.length) { wrap.innerHTML = emptyHtml("No adjustments due."); return; }
      drawTable(wrap, ["Donor", "Amount", "Adjustment", "Reason", "Claimed in", "Donation"], rows.map(function (r) {
        return (
          '<tr><td class="ak-cards__lead">' + donorName(r.donor_name, r.donor_id) + "</td><td>" + esc(money(Number(r.amount_pence) || 0)) +
          "</td><td>" + esc(money(Number(r.adjustment_pence) || 0)) + "</td><td>" + esc(adjustmentReason(r.adjustment_reason)) +
          "</td><td>" + (r.claim_batch_id ? "Batch " + Number(r.claim_batch_id) : "") + "</td><td>" + Number(r.id) + "</td></tr>"
        );
      }));
    }
    function fullName(r) {
      return [r.first_name, r.last_name].filter(Boolean).join(" ");
    }
    function drawAwaiting() {
      var wrap = $("claimsAwaiting");
      var rows = claims.awaiting;
      if (rows === null) return;
      if (rows === false) { wrap.innerHTML = unavailableHtml("Declarations that have not come back are unavailable."); return; }
      if (!rows.length) { wrap.innerHTML = emptyHtml("No declarations are waiting to come back."); return; }
      // The link's token comes with each row and is never put on the page.
      drawTable(wrap, ["Donor", "Email", "Where it stands", "Donation", "Given"], rows.map(function (r) {
        return (
          '<tr><td class="ak-cards__lead">' + donorName(r.donor_name, r.donor_id) + "</td><td>" + esc(r.donor_email || "") +
          "</td><td>" + esc(AWAITING_STATES[r.declaration_status] || "Not known") + "</td><td>" + esc(money(Number(r.amount_pence) || 0)) +
          "</td><td>" + esc(dayWords(r.created_at)) + "</td></tr>"
        );
      }));
    }
    function drawReview() {
      var wrap = $("claimsReview");
      var rows = claims.review;
      if (rows === null) return;
      if (rows === false) { wrap.innerHTML = unavailableHtml("Declarations due a review are unavailable."); return; }
      if (!rows.length) { wrap.innerHTML = emptyHtml("No declarations are due a review."); return; }
      drawTable(wrap, ["Donor", "Declaration made", "Due a review since"], rows.map(function (r) {
        return (
          '<tr><td class="ak-cards__lead">' + donorName(fullName(r), r.donor_id) + "</td><td>" + esc(dayWords(r.createdAt)) +
          "</td><td>" + esc(dayWords(r.reviewDueSince)) + "</td></tr>"
        );
      }));
    }
    function drawKeep() {
      var wrap = $("claimsKeep");
      var rows = claims.keep;
      if (rows === null) return;
      if (rows === false) { wrap.innerHTML = unavailableHtml("Records near the end of their keep date are unavailable."); return; }
      if (!rows.length) { wrap.innerHTML = emptyHtml("No records are near the end of their keep date."); return; }
      drawTable(wrap, ["Donor", "Keep until", "Where it stands", "Covers"], rows.map(function (r) {
        return (
          '<tr><td class="ak-cards__lead">' + donorName(fullName(r), r.donor_id) + "</td><td>" + esc(dayWords(r.retentionExpiry)) +
          '</td><td><span class="admin-pill ak-mark--' + (r.flag === "expired" ? "bad" : "wait") + '">' + esc(KEEP_STATES[r.flag] || "Not known") +
          "</span></td><td>" + esc(SCOPES[r.scope] || "") + "</td></tr>"
        );
      }));
    }

    var CLAIMS_DRAW = { ready: drawReady, batches: drawBatches, repay: drawRepay, awaiting: drawAwaiting, review: drawReview, keep: drawKeep };
    function loadClaimsList(key) {
      return getJson(CLAIMS_LISTS[key])
        .then(function (d) { claims[key] = d.results || []; }, function () { claims[key] = false; })
        .then(function () {
          CLAIMS_DRAW[key]();
          drawClaimsTiles();
        });
    }
    /** Every list read again. What is on the screen stays until its new answer arrives. */
    function reloadClaims() {
      claims.batchDonations = {};
      return Promise.all(Object.keys(CLAIMS_LISTS).map(loadClaimsList));
    }
    function wireClaims() {
      if (claims.wired) return;
      claims.wired = true;
      claims.parts = Kit.wireParts($("claimsParts"));
      $("claimsTiles").addEventListener("click", function (e) {
        var tile = e.target && e.target.closest ? e.target.closest("[data-claims-tile]") : null;
        if (!tile) return;
        var key = tile.getAttribute("data-claims-tile");
        CLAIMS_TILES.forEach(function (t) {
          if (t.key !== key) return;
          claims.parts.show(t.part, true);
          var head = t.head ? $(t.head) : null;
          if (head) {
            if (head.scrollIntoView) head.scrollIntoView({ block: "start" });
            if (head.focus) head.focus({ preventScroll: true });
          }
        });
      });
      $("eligTickAll").addEventListener("click", tickAllReady);
      $("assignBtn").addEventListener("click", addTicked);
      $("assignBatchSelect").addEventListener("change", tallyReady);
      $("eligibleTable").addEventListener("change", tallyReady);
      $("batchesTable").addEventListener("click", function (e) {
        var t = e.target && e.target.closest ? e.target : null;
        if (!t) return;
        var mark = t.closest("[data-submit-batch]");
        if (mark) return markBatchSent(mark.getAttribute("data-submit-batch"));
        var down = t.closest("[data-export-batch]");
        if (down) return downloadBatch(down.getAttribute("data-export-batch"));
        var open = t.closest("[data-batch-open]");
        if (open) return toggleBatch(open.getAttribute("data-batch-open"));
      });
    }
    function openClaims() {
      if (!$("view-claims") || !Kit) return;
      wireClaims();
      // A fresh visit: what was said last time is about last time.
      claims.said = null;
      say($("eligStatus"), "");
      drawClaimsTiles();
      reloadClaims();
    }

    // ================================ GASDS ================================
    var GASDS_QUEUE = "/api/admin/queues/gasds-deadline";
    var gasds = {
      wired: false,
      rows: null, // every small donation not yet marked: null fetching, false could not be fetched
      lately: null, // the latest marks, the same way
      filter: "all",
      openYear: null, // the one tax year whose donations are showing
      said: null, // { year, words, bad, deadline, flag }: what last happened to a year, said in its card
      saidMark: null, // { auditId, words, bad }: the same for a mark under "Marked as claimed lately"
    };
    var GASDS_FILTERS = [
      { key: "all", name: "Not yet claimed", none: "No small donations are waiting to be marked as claimed." },
      { key: "soon", flag: "expiring", name: "Deadline within six months", none: "No small donations have a deadline within six months." },
      { key: "late", flag: "expired", name: "Too late to claim", none: "No small donations are too late to claim." },
    ];
    function gasdsFilter(key) {
      var found = GASDS_FILTERS[0];
      GASDS_FILTERS.forEach(function (f) { if (f.key === key) found = f; });
      return found;
    }
    function gasdsRowsFor(f) {
      if (!Array.isArray(gasds.rows)) return gasds.rows;
      return f.flag ? gasds.rows.filter(function (r) { return r.flag === f.flag; }) : gasds.rows;
    }
    /** The years showing, as cards are drawn: a year just marked in full keeps its place, with no rows. */
    function gasdsGroups() {
      var f = gasdsFilter(gasds.filter);
      var groups = groupByTaxYear(gasdsRowsFor(f) || []);
      var said = gasds.said;
      if (said && said.keep && !groups.some(function (g) { return g.endYear === said.year; })) {
        groups.push({ endYear: said.year, rows: [], count: 0, totalPence: 0, deadline: said.deadline, flag: said.flag });
        groups.sort(byDeadline);
      }
      return groups;
    }
    function gasdsGroup(year) {
      var found = null;
      gasdsGroups().forEach(function (g) { if (g.endYear === Number(year)) found = g; });
      return found;
    }
    function drawGasdsFilters() {
      var wrap = $("gasdsFilters");
      if (!wrap) return;
      wrap.innerHTML = GASDS_FILTERS.map(function (f) {
        var rows = gasdsRowsFor(f);
        var n = rows === null ? "…" : rows === false ? "?" : count(rows.length);
        var says = "";
        if (rows === false) says = "Could not be loaded";
        else if (Array.isArray(rows)) {
          var total = money(sum(rows, "amountPence"));
          says = !rows.length ? "None" : f.key === "late" ? total + ". The two years have passed." : total + " in all";
        }
        var on = gasds.filter === f.key;
        var cls =
          "ak-tile" + (on ? " is-active" : "") + (Array.isArray(rows) && !rows.length ? " is-none" : "") +
          (f.key === "late" ? " gv-tile--quiet" : "") + (f.key === "soon" && Array.isArray(rows) && rows.length ? " ak-tile--urgent" : "");
        return (
          '<li><button type="button" class="' + cls + '" data-gasds-filter="' + f.key + '" aria-pressed="' + on + '">' +
          '<span class="ak-tile__n">' + esc(n) + '</span><span class="ak-tile__name">' + esc(f.name) +
          '</span><span class="ak-tile__says">' + esc(says) + "</span></button></li>"
        );
      }).join("");
    }
    function yearHtml(g) {
      var y = g.endYear;
      var canWrite = host.canEdit("gasds");
      var late = g.flag === "expired";
      var said = gasds.said && gasds.said.year === y ? gasds.said : null;
      var status =
        '<p class="admin-action-status' + (said ? (said.bad === true ? " is-error" : said.bad === false ? " is-ok" : "") : "") +
        '" data-gasds-status="' + y + '">' + esc(said ? said.words : "") + "</p>";
      var name = '<h4 class="gv-year__name">' + esc(taxYearWords(y)) + "</h4>";
      if (!g.count) {
        // Every donation in it has just been marked: the card stays where it was, saying so.
        return (
          '<li class="ak-card gv-year gv-year--done" data-gasds-year="' + y + '"><div class="gv-year__head">' + name +
          '<span class="admin-pill ak-mark--ok">All marked as claimed</span></div>' + status + "</li>"
        );
      }
      var open = gasds.openYear === y;
      var pill = late
        ? '<span class="admin-pill ak-mark--quiet">' + GASDS_STATES.expired + "</span>"
        : g.flag === "expiring" ? '<span class="admin-pill ak-mark--bad">' + GASDS_STATES.expiring + "</span>" : "";
      var sumWords =
        some(g.count, "small donation", "small donations") + ", " + money(g.totalPence) + " in all. " +
        (late ? "The deadline was " + dayWords(g.deadline) + "." : "Claim by " + dayWords(g.deadline) + ".");
      var buttons = '<button class="admin-btn ak-btn--plain" type="button" data-gasds-copy="' + y + '">Copy the total</button>';
      if (canWrite) {
        buttons += '<button class="admin-btn' + (late ? " ak-btn--plain" : "") + '" type="button" data-gasds-mark-all="' + y + '">Mark all ' + count(g.count) + " as claimed</button>";
      }
      buttons +=
        '<button class="admin-btn ak-btn--plain" type="button" data-gasds-open="' + y + '" aria-expanded="' + open +
        '" aria-controls="gasdsYear' + y + 'Rows">' +
        esc(open ? "Hide the donations" : canWrite ? "Tick them off one by one" : "See the " + some(g.count, "donation", "donations")) + "</button>";
      var says = canWrite
        ? '<small class="ak-says">' +
          (late ? "The deadline for these has passed. If they were in a claim sent before it, mark them as claimed so they leave this list. " : "") +
          "Marking as claimed only records here that these were counted in a small donations claim to HMRC. It claims nothing. " +
          "If it was a mistake, undo it under Marked as claimed lately, below.</small>"
        : "";
      var inside = "";
      if (open) {
        inside = rowsHtml(
          g.rows.map(function (r) {
            return { id: r.id, name: r.full_name, donorId: r.donor_id, pence: r.amountPence, meta: [dayWords(r.collectedAt), "Donation " + Number(r.id)] };
          }),
          { tick: canWrite ? "gasds-check" : "", heads: ["Name", "Collected", "Number"] }
        );
        if (canWrite) {
          inside +=
            '<div class="gv-pickbar__tally"><p class="gv-tally" id="gasdsTally">None ticked yet.</p>' +
            '<button class="admin-btn" type="button" id="markGasdsBtn">Mark the ticked ones as claimed</button></div>';
        }
      }
      return (
        '<li class="ak-card gv-year' + (late ? " gv-year--late" : "") + '" data-gasds-year="' + y + '">' +
        '<div class="gv-year__head">' + name + pill + "</div>" +
        '<p class="gv-year__sum">' + esc(sumWords) + "</p>" +
        '<div class="ak-actions">' + buttons + "</div>" + says + status +
        '<div class="gv-year__inside" id="gasdsYear' + y + 'Rows"' + (open ? "" : " hidden") + ">" + inside + "</div></li>"
      );
    }
    function drawGasds() {
      var wrap = $("gasdsTable");
      var bar = $("gasdsActions");
      if (gasds.rows === null) return;
      if (gasds.rows === false) {
        wrap.innerHTML = unavailableHtml("GASDS donations are unavailable.");
        bar.hidden = true;
        return;
      }
      bar.hidden = !gasds.rows.length;
      var groups = gasdsGroups();
      if (!groups.some(function (g) { return g.endYear === gasds.openYear && g.count; })) gasds.openYear = null;
      wrap.innerHTML = groups.length
        ? '<ul class="ak-list">' + groups.map(yearHtml).join("") + "</ul>"
        : emptyHtml(gasdsFilter(gasds.filter).none);
    }
    /** One year's card drawn again where it is, so opening it does not redraw (and re-announce) the rest. */
    function redrawYear(year) {
      var card = doc.querySelector('#gasdsTable [data-gasds-year="' + Number(year) + '"]');
      var group = gasdsGroup(year);
      if (card && group) card.outerHTML = yearHtml(group);
    }
    function sayYear(year, words, bad) {
      var was = gasds.said && gasds.said.year === Number(year) ? gasds.said : {};
      gasds.said = { year: Number(year), words: words, bad: bad, keep: was.keep, deadline: was.deadline, flag: was.flag };
      say(doc.querySelector('#gasdsTable [data-gasds-status="' + Number(year) + '"]'), words, bad);
    }
    function tallyGasds() {
      var line = $("gasdsTally");
      if (!line) return;
      var on = ticked("#gasdsTable .gasds-check");
      var pence = on.reduce(function (total, b) { return total + (Number(b.getAttribute("data-pence")) || 0); }, 0);
      line.textContent = on.length ? count(on.length) + " ticked, " + money(pence) + " in all" : "None ticked yet.";
    }
    function toggleYear(year) {
      year = Number(year);
      var was = gasds.openYear;
      gasds.openYear = was === year ? null : year;
      if (was !== null && was !== year) redrawYear(was);
      redrawYear(year);
      var btn = doc.querySelector('#gasdsTable [data-gasds-open="' + year + '"]');
      if (btn && btn.focus) btn.focus();
    }
    function copyYearTotal(year) {
      var group = gasdsGroup(year);
      if (!group) return;
      var figure = (group.totalPence / 100).toFixed(2);
      Kit.copyText(figure, win).then(function (ok) {
        sayYear(year, ok ? "Copied " + figure + ", the total for " + taxYearWords(group.endYear) + "." : "Could not copy it. The total is " + figure + ".", !ok);
      });
    }
    /** Marks these donations of one tax year as claimed; the question has been asked by the caller. */
    function markGasds(year, ids) {
      var group = gasdsGroup(year);
      var failed = function () { sayYear(year, "Could not mark those donations as claimed. Nothing was changed.", true); };
      sayYear(year, "Saving…");
      send(GASDS_QUEUE + "/mark-claimed", { donationIds: ids }).then(function (out) {
        if (!out.ok) return failed();
        var done = (out.body.claimedIds || []).length;
        var words =
          (done === ids.length
            ? "Marked " + some(done, "small donation", "small donations") + " as claimed."
            : "Marked " + count(done) + " of the " + count(ids.length) + " as claimed. The rest had already been marked.") +
          " If that was a mistake, undo it under Marked as claimed lately.";
        // Off the list at once, whatever the next read says.
        var gone = {};
        ids.forEach(function (id) { gone[id] = true; });
        gasds.rows = (gasds.rows || []).filter(function (r) { return !gone[r.id]; });
        gasds.said = { year: Number(year), words: words, bad: false, keep: true, deadline: group && group.deadline, flag: group && group.flag };
        drawGasds();
        drawGasdsFilters();
        loadGasdsLately();
        return getJson(GASDS_QUEUE + "?all=1").then(
          function (d) { gasds.rows = d.results || []; drawGasds(); drawGasdsFilters(); },
          function () { /* what is on the screen is already right */ }
        );
      }, failed);
    }
    function markYear(year) {
      var group = gasdsGroup(year);
      if (!group || !group.count) return;
      var question =
        "Mark all " + some(group.count, "small donation", "small donations") + " from " + taxYearWords(group.endYear) +
        " as claimed? Do this once their " + money(group.totalPence) + " total has gone into a small donations claim to HMRC. " +
        "You can undo it afterwards under Marked as claimed lately.";
      if (!win.confirm(question)) return;
      markGasds(year, group.rows.map(function (r) { return Number(r.id); }));
    }
    function markTicked() {
      var year = gasds.openYear;
      if (year === null) return;
      var ids = ticked("#gasdsTable .gasds-check").map(function (b) { return Number(b.value); });
      if (!ids.length) return sayYear(year, "Tick at least one donation first.", true);
      var question =
        "Mark the " + count(ids.length) + " ticked small " + (ids.length === 1 ? "donation" : "donations") +
        " as claimed? Do this once they have gone into a small donations claim to HMRC. You can undo it afterwards under Marked as claimed lately.";
      if (!win.confirm(question)) return;
      markGasds(year, ids);
    }
    function downloadGasds() {
      var status = $("gasdsStatus");
      var rows = [];
      gasdsGroups().forEach(function (g) { rows = rows.concat(g.rows); });
      if (!rows.length) return say(status, "There is nothing in this list to download.", true);
      var name = "small-donations-not-yet-claimed.csv";
      var ok = Kit.downloadCsv(name, gasdsSheet(rows), win);
      say(status, ok ? "Downloaded " + name + " with " + some(rows.length, "small donation", "small donations") + "." : "This browser could not make the file.", !ok);
    }

    function drawGasdsLately() {
      var wrap = $("gasdsRecent");
      var marks = gasds.lately;
      if (!wrap || marks === null) return;
      if (marks === false) { wrap.innerHTML = unavailableHtml("What was marked lately could not be loaded."); return; }
      if (!marks.length) { wrap.innerHTML = emptyHtml("Nothing has been marked as claimed yet."); return; }
      var canWrite = host.canEdit("gasds");
      wrap.innerHTML = '<ul class="ak-list">' + marks.map(function (m) {
        var id = Number(m.auditId);
        var n = Number(m.count) || 0;
        var still = (m.stillClaimedIds || []).length;
        var who = String(m.actor || "").replace(/^admin:/, "") || "someone";
        var said = gasds.saidMark && gasds.saidMark.auditId === id ? gasds.saidMark : null;
        var undo = canWrite && still
          ? '<button class="admin-btn ak-btn--plain" type="button" data-gasds-undo="' + id + '">' +
            esc(still === n ? "Undo" : "Undo the " + count(still) + " still marked") + "</button>"
          : "";
        return (
          '<li class="ak-card gv-mark" data-gasds-mark="' + id + '"><div class="gv-mark__main">' +
          '<p class="gv-mark__what">' + esc(some(n, "small donation", "small donations") + ", " + money(Number(m.totalPence) || 0)) + "</p>" +
          '<p class="gv-mark__who">' + esc("Marked by " + who + " on " + dayWords(m.at) + "." + (still ? "" : " Undone since.")) + "</p></div>" + undo +
          '<p class="admin-action-status' + (said ? (said.bad ? " is-error" : " is-ok") : "") + '" role="status" data-gasds-mark-status="' + id + '">' +
          esc(said ? said.words : "") + "</p></li>"
        );
      }).join("") + "</ul>";
    }
    function undoMark(auditId) {
      auditId = Number(auditId);
      var mark = null;
      (Array.isArray(gasds.lately) ? gasds.lately : []).forEach(function (m) { if (Number(m.auditId) === auditId) mark = m; });
      var ids = mark ? mark.stillClaimedIds || [] : [];
      if (!ids.length) return;
      var sayMark = function (words, bad) {
        gasds.saidMark = { auditId: auditId, words: words, bad: bad };
        say(doc.querySelector('#gasdsRecent [data-gasds-mark-status="' + auditId + '"]'), words, bad);
      };
      var failed = function () { sayMark("Could not undo that. Nothing was changed.", true); };
      var question =
        "Undo this mark? " + (ids.length === 1 ? "1 small donation goes" : count(ids.length) + " small donations go") +
        " back into the list as not yet claimed. Only undo it if they were not in a claim already sent to HMRC, or they could be claimed twice.";
      if (!win.confirm(question)) return;
      send(GASDS_QUEUE + "/unmark-claimed", { donationIds: ids }).then(function (out) {
        if (!out.ok) return failed();
        var back = (out.body.unclaimedIds || []).length;
        gasds.saidMark = { auditId: auditId, words: "Put " + some(back, "small donation", "small donations") + " back in the list.", bad: false };
        gasds.said = null; // they are back, so "all marked" is no longer so
        return Promise.all([loadGasdsQueue(), loadGasdsLately()]);
      }, failed);
    }

    function loadGasdsQueue() {
      return getJson(GASDS_QUEUE + "?all=1")
        .then(function (d) { gasds.rows = d.results || []; }, function () { gasds.rows = false; })
        .then(function () {
          drawGasds();
          drawGasdsFilters();
        });
    }
    function loadGasdsLately() {
      return getJson("/api/admin/queues/gasds-claimed")
        .then(function (d) { gasds.lately = d.results || []; }, function () { gasds.lately = false; })
        .then(drawGasdsLately);
    }
    // This year's pool report (REQ-050): three figures read apart and never added together. The sums
    // are the server's; the line under each only says what the figure is.
    function loadGasdsPool() {
      var wrap = $("gasdsPool");
      if (!wrap) return;
      var tile = function (figure, name, says) {
        return (
          '<div class="ak-tile"><span class="ak-tile__n">' + esc(figure) + '</span><span class="ak-tile__name">' + esc(name) +
          '</span><span class="ak-tile__says">' + esc(says) + "</span></div>"
        );
      };
      getJson("/api/admin/queues/gasds-pool").then(
        function (p) {
          var year = Number(p.year);
          wrap.innerHTML =
            tile(money(p.gasdsPoolTotalPence), "Small donations pool (" + year + ")", "Small donations collected from January to December " + year + ".") +
            tile(money(p.giftAidClaimedPence), "Gift Aid claimed this year", "Gift Aided donations given in " + year + " that are in a batch, sent or not. Not the tax claimed back.") +
            tile(money(p.remainingHeadroomPence), "Remaining GASDS headroom", "Room left under the scheme’s yearly limits, as this site works it out. Check it with the treasurer before relying on it.");
        },
        function () { wrap.innerHTML = unavailableHtml("The small donations pool is unavailable."); }
      );
    }
    function wireGasds() {
      if (gasds.wired) return;
      gasds.wired = true;
      $("gasdsFilters").addEventListener("click", function (e) {
        var tile = e.target && e.target.closest ? e.target.closest("[data-gasds-filter]") : null;
        if (!tile) return;
        gasds.filter = tile.getAttribute("data-gasds-filter");
        drawGasdsFilters();
        drawGasds();
        var again = doc.querySelector('#gasdsFilters [data-gasds-filter="' + gasds.filter + '"]');
        if (again && again.focus) again.focus();
      });
      $("gasdsDownload").addEventListener("click", downloadGasds);
      $("gasdsTable").addEventListener("change", tallyGasds);
      $("gasdsTable").addEventListener("click", function (e) {
        var t = e.target && e.target.closest ? e.target : null;
        if (!t) return;
        if (t.closest("#markGasdsBtn")) return markTicked();
        var copy = t.closest("[data-gasds-copy]");
        if (copy) return copyYearTotal(copy.getAttribute("data-gasds-copy"));
        var all = t.closest("[data-gasds-mark-all]");
        if (all) return markYear(all.getAttribute("data-gasds-mark-all"));
        var open = t.closest("[data-gasds-open]");
        if (open) return toggleYear(open.getAttribute("data-gasds-open"));
      });
      $("gasdsRecent").addEventListener("click", function (e) {
        var undo = e.target && e.target.closest ? e.target.closest("[data-gasds-undo]") : null;
        if (undo) undoMark(undo.getAttribute("data-gasds-undo"));
      });
    }
    function openGasds() {
      if (!$("view-gasds") || !Kit) return;
      wireGasds();
      // A fresh visit: what was said last time is about last time.
      gasds.said = null;
      gasds.saidMark = null;
      say($("gasdsStatus"), "");
      drawGasdsFilters();
      loadGasdsQueue();
      loadGasdsLately();
      loadGasdsPool();
    }

    // ================================ Subscriptions ================================
    // One name for the thing on this screen: a monthly gift.
    var subs = {
      wired: false,
      rows: null, // null fetching, false could not be fetched
      showing: { failing: true, stopped: true, cancelled: false, normal: false }, // it opens on the two that need someone
      said: null, // { id, words, bad }: what last happened on a person's card
    };
    var SUBS_GROUPS = [
      { key: "failing", name: "Card failing", says: "Stripe is still trying" },
      { key: "stopped", name: "Stopped", says: "Stripe has given up trying" },
      { key: "cancelled", name: "Cancelled", says: "They chose to stop" },
      { key: "normal", name: "Back to normal", says: "Paying as they should" },
    ];
    function subsIn(key) {
      if (!Array.isArray(subs.rows)) return subs.rows;
      return subs.rows.filter(function (s) { return subscriptionGroup(s) === key; });
    }
    function drawSubsTiles() {
      var wrap = $("subsFilters");
      if (!wrap) return;
      wrap.innerHTML = SUBS_GROUPS.map(function (g) {
        var rows = subsIn(g.key);
        var n = rows === null ? "…" : rows === false ? "?" : count(rows.length);
        var on = !!subs.showing[g.key];
        var urgent = (g.key === "failing" || g.key === "stopped") && Array.isArray(rows) && rows.length;
        return (
          '<li><button type="button" class="ak-tile' + (on ? " is-active" : "") + (Array.isArray(rows) && !rows.length ? " is-none" : "") +
          (urgent ? " ak-tile--urgent" : "") + '" data-subs-filter="' + g.key + '" aria-pressed="' + on + '">' +
          '<span class="ak-tile__n">' + esc(n) + '</span><span class="ak-tile__name">' + esc(g.name) +
          '</span><span class="ak-tile__says">' + esc(rows === false ? "Could not be loaded" : g.says) + "</span></button></li>"
        );
      }).join("");
    }
    function subHtml(s) {
      var id = Number(s.id);
      var pill = H.subscriptionStateLabel(s);
      var email = s.donor_email ? String(s.donor_email) : "";
      var gives = "";
      if (typeof s.monthly_pence === "number" && s.monthly_pence > 0) {
        gives = money(s.monthly_pence) + " a month" + (s.first_paid_at ? " since " + monthWords(s.first_paid_at) : "") + ". ";
      }
      var buttons = "";
      if (email) {
        buttons +=
          '<a class="admin-btn" href="' + esc("mailto:" + encodeURI(email)) + '">Email them</a>' +
          '<button class="admin-btn ak-btn--plain" type="button" data-sub-copy="' + id + '">Copy email</button>';
      }
      var digits = s.phone ? String(s.phone).replace(/[^0-9+]/g, "") : "";
      if (digits) buttons += '<a class="admin-btn ak-btn--plain" href="tel:' + esc(digits) + '">' + esc("Call " + s.phone) + "</a>";
      if (s.donor_id && host.canView("donations")) {
        buttons += '<button class="admin-btn ak-btn--plain" type="button" data-donor="' + Number(s.donor_id) + '">Open their page</button>';
      }
      var said = subs.said && subs.said.id === id ? subs.said : null;
      return (
        '<li class="ak-card gv-sub" data-sub="' + id + '">' +
        '<div class="gv-sub__head"><h4 class="gv-sub__name">' + esc(s.donor_name) + '</h4><span class="admin-pill admin-pill--' + esc(pill.state) + '">' + esc(pill.label) + "</span></div>" +
        '<p class="gv-sub__what">' + esc(subscriptionWords(s)) + "</p>" +
        '<p class="gv-sub__meta">' + esc(gives + "Last changed " + dayWords(s.updated_at) + ". Monthly gift number " + id + ".") + "</p>" +
        '<p class="gv-sub__email">' + esc(email || "No email address on record.") + "</p>" +
        (buttons ? '<div class="ak-actions">' + buttons + "</div>" : "") +
        '<p class="admin-action-status' + (said ? (said.bad ? " is-error" : " is-ok") : "") + '" data-sub-status="' + id + '">' + esc(said ? said.words : "") + "</p></li>"
      );
    }
    function drawSubs() {
      var wrap = $("subsTable");
      if (subs.rows === null) return;
      if (subs.rows === false) {
        wrap.innerHTML = unavailableHtml("Monthly gifts that need attention are unavailable.");
        return;
      }
      var chosen = SUBS_GROUPS.filter(function (g) { return subs.showing[g.key]; });
      if (!chosen.length) {
        wrap.innerHTML = emptyHtml("Choose a tile above to see its monthly gifts.");
        return;
      }
      var html = chosen
        .map(function (g) {
          var rows = subsIn(g.key);
          if (!rows.length) return "";
          return '<h3 class="ak-group">' + esc(g.name) + '</h3><ul class="ak-list">' + rows.map(subHtml).join("") + "</ul>";
        })
        .join("");
      // Only the two it opens on are "needing attention"; with another tile pressed, say what is true.
      var onlyNeeding = chosen.every(function (g) { return g.key === "failing" || g.key === "stopped"; });
      wrap.innerHTML = html || emptyHtml(onlyNeeding ? "No monthly gifts need attention." : "No monthly gifts to show for the tiles chosen.");
    }
    function copySubEmail(id) {
      id = Number(id);
      var row = null;
      (Array.isArray(subs.rows) ? subs.rows : []).forEach(function (s) { if (Number(s.id) === id) row = s; });
      if (!row || !row.donor_email) return;
      Kit.copyText(row.donor_email, win).then(function (ok) {
        var words = ok ? "Copied " + row.donor_email + "." : "Could not copy it. Their email is " + row.donor_email + ".";
        subs.said = { id: id, words: words, bad: !ok };
        say(doc.querySelector('#subsTable [data-sub-status="' + id + '"]'), words, !ok);
      });
    }
    function wireSubs() {
      if (subs.wired) return;
      subs.wired = true;
      $("subsFilters").addEventListener("click", function (e) {
        var tile = e.target && e.target.closest ? e.target.closest("[data-subs-filter]") : null;
        if (!tile) return;
        var key = tile.getAttribute("data-subs-filter");
        subs.showing[key] = !subs.showing[key];
        drawSubsTiles();
        drawSubs();
        var again = doc.querySelector('#subsFilters [data-subs-filter="' + key + '"]');
        if (again && again.focus) again.focus();
      });
      $("subsTable").addEventListener("click", function (e) {
        var copy = e.target && e.target.closest ? e.target.closest("[data-sub-copy]") : null;
        if (copy) copySubEmail(copy.getAttribute("data-sub-copy"));
      });
    }
    function openSubs() {
      var wrap = $("subsTable");
      if (!wrap || !Kit) return;
      wireSubs();
      var across = $("subsAcross");
      // Monthly givers is opened with Donations (its menu link's data-view-gate).
      if (across) across.hidden = !host.canView("donations");
      subs.said = null;
      subs.rows = null;
      wrap.innerHTML = '<p class="admin-loading">Loading…</p>';
      drawSubsTiles();
      getJson("/api/admin/subscriptions/dunning")
        .then(function (d) { subs.rows = d.results || []; }, function () { subs.rows = false; })
        .then(function () {
          drawSubsTiles();
          drawSubs();
        });
    }

    return { openClaims: openClaims, openGasds: openGasds, openSubs: openSubs };
  }

  var api = {
    create: createGiving,
    dayWords: dayWords,
    count: count,
    some: some,
    claimBack: claimBack,
    batchState: batchState,
    refusalWords: refusalWords,
    adjustmentReason: adjustmentReason,
    taxYearEnd: taxYearEnd,
    taxYearWords: taxYearWords,
    groupByTaxYear: groupByTaxYear,
    gasdsSheet: gasdsSheet,
    subscriptionGroup: subscriptionGroup,
    subscriptionWords: subscriptionWords,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else window.AdminGiving = api;
})();
