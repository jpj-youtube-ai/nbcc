// Admin dashboard app wiring (REQ-066 · TASK-115). Progressive: a token-authed SPA-lite over the
// /api/admin/* JSON API. Sign in -> store a bearer session token in sessionStorage (cleared on tab
// close; 8h TTL) -> reveal the app. Any 401 clears the token and returns to sign-in. Views: Overview
// (the three operational queues + recent donations) and Search (donors/declarations/donations). The
// pure rendering/decoding helpers live in helpers.js (window.AdminHelpers); this file is the DOM glue
// and is exercised by hand / the browser, not the unit suite.
(function () {
  "use strict";
  var H = window.AdminHelpers;
  var doc = document;
  var TOKEN_KEY = "nbcc_admin_token";
  var currentRole = "viewer"; // decoded from the session token; gates the write actions (server still enforces)
  var donationsOffset = 0; // Donations view paging cursor
  var currentDonorId = null; // the donor open in the detail view
  var currentStoryId = null; // the story open in the detail view
  var storiesStatusFilter = ""; // Stories view status filter ("" = all)

  function token() {
    return sessionStorage.getItem(TOKEN_KEY);
  }
  function setToken(t) {
    sessionStorage.setItem(TOKEN_KEY, t);
  }
  function clearToken() {
    sessionStorage.removeItem(TOKEN_KEY);
  }
  function el(id) {
    return doc.getElementById(id);
  }
  function j(res) {
    return res.json();
  }

  function showLogin() {
    el("appView").hidden = true;
    el("loginView").hidden = false;
    var email = el("adminEmail");
    if (email && email.focus) email.focus();
  }

  function showApp(claims) {
    el("loginView").hidden = true;
    el("appView").hidden = false;
    currentRole = claims.role || "viewer";
    el("userEmail").textContent = claims.email || "";
    el("userRole").textContent = claims.role || "";
    selectView("overview");
    loadOverview();
  }

  // Fetch an admin API path with the bearer token; a 401 means the session is gone -> back to login.
  function authFetch(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({}, opts.headers, { Authorization: "Bearer " + token() });
    return fetch(path, opts).then(function (res) {
      if (res.status === 401) {
        clearToken();
        showLogin();
        throw new Error("unauthorized");
      }
      return res;
    });
  }

  // ---- sign in / out ----
  var loginForm = el("loginForm");
  if (loginForm) {
    loginForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var err = el("loginError");
      err.hidden = true;
      var email = el("adminEmail").value.trim();
      var password = el("adminPassword").value;
      fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email, password: password }),
      })
        .then(function (res) {
          return res.ok
            ? res.json()
            : res.json().then(function (b) {
                throw new Error((b && b.error) || "Sign in failed");
              });
        })
        .then(function (data) {
          setToken(data.token);
          var claims = H.parseClaims(data.token) || {
            email: (data.user || {}).email,
            role: (data.user || {}).role,
          };
          showApp(claims);
          loginForm.reset();
        })
        .catch(function (e2) {
          err.textContent = e2.message || "Sign in failed";
          err.hidden = false;
        });
    });
  }

  var logout = el("logoutBtn");
  if (logout) {
    logout.addEventListener("click", function () {
      clearToken();
      showLogin();
    });
  }

  // ---- view switching ----
  function showOnly(viewId) {
    Array.prototype.forEach.call(doc.querySelectorAll(".admin-view"), function (v) {
      v.hidden = v.id !== viewId;
    });
  }
  function selectView(name) {
    Array.prototype.forEach.call(doc.querySelectorAll(".admin-nav-link"), function (b) {
      b.classList.toggle("is-active", b.getAttribute("data-view") === name);
    });
    showOnly("view-" + name);
    if (name === "search") {
      var q = el("searchQuery");
      if (q && q.focus) q.focus();
    } else if (name === "donations") {
      donationsOffset = 0;
      loadDonations();
    } else if (name === "claims") loadClaims();
    else if (name === "gasds") loadGasds();
    else if (name === "subscriptions") loadSubs();
    else if (name === "stories") loadStories();
    else if (name === "newsletter") loadNewsletters();
    else if (name === "thank-you") loadThankYou();
    else if (name === "audit") loadAudit();
  }
  Array.prototype.forEach.call(doc.querySelectorAll(".admin-nav-link"), function (b) {
    b.addEventListener("click", function () {
      selectView(b.getAttribute("data-view"));
    });
  });

  // ---- overview ----
  function statCard(n, label, warn) {
    return (
      '<div class="admin-stat' + (warn && n > 0 ? " warn" : "") + '">' +
      '<div class="n">' + n + '</div><div class="l">' + H.escapeHtml(label) + "</div></div>"
    );
  }
  function donationsTable(rows) {
    if (!rows.length) return '<p class="admin-empty">No donations yet.</p>';
    var body = rows
      .map(function (d) {
        var gift = d.plan ? H.escapeHtml(d.mode) + " · " + H.escapeHtml(d.plan) : H.escapeHtml(d.mode);
        return (
          "<tr><td>" + d.id + "</td><td>" + H.escapeHtml(d.donor_name) + "</td><td>" + gift +
          '</td><td class="admin-num">' + H.formatPence(d.amount_pence) + "</td><td>" +
          (d.gift_aid ? '<span class="admin-pill">Gift Aid</span>' : "") + "</td><td>" +
          H.escapeHtml(d.claim_status) + "</td><td>" + H.fmtDate(d.created_at) +
          '</td><td><button class="admin-link" type="button" data-donor="' + d.donor_id + '">View</button></td></tr>'
        );
      })
      .join("");
    return (
      '<table class="admin-table"><thead><tr><th>ID</th><th>Donor</th><th>Gift</th>' +
      "<th>Amount</th><th>Gift Aid</th><th>Claim</th><th>Date</th><th></th></tr></thead><tbody>" +
      body + "</tbody></table>"
    );
  }
  function loadOverview() {
    var stats = el("overviewStats");
    Promise.all([
      authFetch("/api/admin/claims/adjustment-due").then(j),
      authFetch("/api/admin/queues/retention-expiry").then(j),
      authFetch("/api/admin/queues/awaiting-declaration").then(j),
      authFetch("/api/admin/queues/gasds-deadline").then(j),
      authFetch("/api/admin/queues/declaration-review").then(j),
    ])
      .then(function (r) {
        stats.innerHTML =
          statCard((r[0].results || []).length, "Adjustments due", true) +
          statCard((r[1].results || []).length, "Retention expiring", true) +
          statCard((r[2].results || []).length, "Awaiting declaration", false) +
          statCard((r[3].results || []).length, "GASDS deadline near", true) +
          statCard((r[4].results || []).length, "Declaration review due", false);
      })
      .catch(function () {});
    authFetch("/api/admin/donations?limit=10")
      .then(j)
      .then(function (d) {
        el("overviewRecent").innerHTML = donationsTable(d.results || []);
      })
      .catch(function () {});
  }

  // ---- search ----
  var searchKind = "donors";
  Array.prototype.forEach.call(doc.querySelectorAll(".admin-seg"), function (b) {
    b.addEventListener("click", function () {
      searchKind = b.getAttribute("data-kind");
      Array.prototype.forEach.call(doc.querySelectorAll(".admin-seg"), function (x) {
        x.classList.toggle("is-active", x === b);
      });
    });
  });
  function genericTable(rows) {
    if (!rows.length) return '<p class="admin-empty">No results.</p>';
    var cols = Object.keys(rows[0]);
    var head = cols.map(function (c) { return "<th>" + H.escapeHtml(c) + "</th>"; }).join("");
    var body = rows
      .map(function (r) {
        return "<tr>" + cols.map(function (c) { return "<td>" + H.escapeHtml(r[c]) + "</td>"; }).join("") + "</tr>";
      })
      .join("");
    return '<table class="admin-table"><thead><tr>' + head + "</tr></thead><tbody>" + body + "</tbody></table>";
  }
  var searchForm = el("searchForm");
  if (searchForm) {
    searchForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var q = el("searchQuery").value.trim();
      if (!q) return;
      var out = el("searchResults");
      out.innerHTML = '<p class="admin-loading">Searching…</p>';
      authFetch("/api/admin/search/" + searchKind + "?q=" + encodeURIComponent(q))
        .then(j)
        .then(function (data) {
          var rows = data.results || [];
          if (searchKind === "donors") out.innerHTML = donorsSearchTable(rows);
          else if (searchKind === "donations") out.innerHTML = donationsTable(rows);
          else out.innerHTML = genericTable(rows);
        })
        .catch(function () {
          out.innerHTML = '<p class="admin-empty">Search is unavailable.</p>';
        });
    });
  }

  function bindClick(id, fn) {
    var e = el(id);
    if (e) e.addEventListener("click", fn);
  }
  function cap(s) {
    s = String(s || "");
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
  }

  // ---- donations (browse all, paged) ----
  function loadDonations() {
    var wrap = el("donationsTable");
    wrap.innerHTML = '<p class="admin-loading">Loading…</p>';
    authFetch("/api/admin/donations?limit=25&offset=" + donationsOffset)
      .then(j)
      .then(function (d) {
        wrap.innerHTML = donationsTable(d.results || []);
        var total = d.total || 0;
        el("donationsPager").hidden = total <= 25;
        el("donationsInfo").textContent = total
          ? donationsOffset + 1 + "–" + Math.min(donationsOffset + 25, total) + " of " + total
          : "";
        el("donationsPrev").disabled = donationsOffset <= 0;
        el("donationsNext").disabled = donationsOffset + 25 >= total;
      })
      .catch(function () {
        wrap.innerHTML = '<p class="admin-empty">Unavailable.</p>';
      });
  }
  bindClick("donationsPrev", function () {
    donationsOffset = Math.max(0, donationsOffset - 25);
    loadDonations();
  });
  bindClick("donationsNext", function () {
    donationsOffset += 25;
    loadDonations();
  });
  bindClick("assignBtn", assignSelected);
  bindClick("markGasdsBtn", markGasdsSelected);

  // ---- GASDS deadline: small gifts near the 2-year cliff → mark claimed (editor+) ----
  function loadGasds() {
    var canWrite = H.roleCan(currentRole, "editor");
    var actions = el("gasdsActions");
    authFetch("/api/admin/queues/gasds-deadline")
      .then(j)
      .then(function (d) {
        el("gasdsTable").innerHTML = gasdsTable(d.results || [], canWrite);
        if (actions) actions.hidden = !(canWrite && (d.results || []).length);
      })
      .catch(function () {});
    // This year's pool report (REQ-050): three separately-read figures, never conflated.
    var poolEl = el("gasdsPool");
    if (poolEl) {
      authFetch("/api/admin/queues/gasds-pool")
        .then(j)
        .then(function (p) {
          poolEl.innerHTML =
            statCard(H.formatPence(p.gasdsPoolTotalPence), "Small donations pool (" + p.year + ")", false) +
            statCard(H.formatPence(p.giftAidClaimedPence), "Gift Aid claimed this year", false) +
            statCard(H.formatPence(p.remainingHeadroomPence), "Remaining GASDS headroom", false);
        })
        .catch(function () {});
    }
  }
  function gasdsTable(rows, canWrite) {
    if (!rows.length) return '<p class="admin-empty">No GASDS gifts are approaching the claim deadline.</p>';
    var body = rows
      .map(function (r) {
        var box = canWrite ? '<td><input type="checkbox" class="gasds-check" value="' + r.id + '" aria-label="Select donation ' + r.id + '"></td>' : "";
        return (
          "<tr>" + box + "<td>" + r.id + "</td><td>" + H.escapeHtml(r.full_name) +
          '</td><td class="admin-num">' + H.formatPence(r.amountPence) + "</td><td>" +
          H.fmtDate(r.collectedAt) + "</td><td>" + H.fmtDate(r.gasdsDeadline) +
          '</td><td>' + H.escapeHtml(r.flag) + "</td></tr>"
        );
      })
      .join("");
    var head = (canWrite ? "<th></th>" : "") + "<th>ID</th><th>Donor</th><th>Amount</th><th>Collected</th><th>Deadline</th><th>Status</th>";
    return '<table class="admin-table"><thead><tr>' + head + "</tr></thead><tbody>" + body + "</tbody></table>";
  }
  function markGasdsSelected() {
    var ids = Array.prototype.slice
      .call(doc.querySelectorAll(".gasds-check:checked"))
      .map(function (c) { return Number(c.value); });
    if (!ids.length) { window.alert("Tick at least one gift first."); return; }
    authFetch("/api/admin/queues/gasds-deadline/mark-claimed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ donationIds: ids }),
    })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (out) {
        if (out) loadGasds();
        else window.alert("Could not mark those gifts as claimed.");
      })
      .catch(function () { window.alert("Could not mark those gifts as claimed."); });
  }

  // ---- claims: eligible → batch → export → submit (writes are editor+) ----
  function loadClaims() {
    var canWrite = H.roleCan(currentRole, "editor");
    var actions = el("eligibleActions");
    if (actions) actions.hidden = !canWrite;
    authFetch("/api/admin/claims/eligible")
      .then(j)
      .then(function (d) {
        el("eligibleTable").innerHTML = eligibleTable(d.results || [], canWrite);
      })
      .catch(function () {});
    authFetch("/api/admin/claim-batches")
      .then(j)
      .then(function (d) {
        var rows = d.results || [];
        el("batchesTable").innerHTML = batchesTable(rows);
        var sel = el("assignBatchSelect");
        if (sel) {
          var opts = '<option value="new">New batch</option>';
          rows.forEach(function (b) {
            if (b.status === "open") opts += '<option value="' + b.id + '">Batch ' + b.id + "</option>";
          });
          sel.innerHTML = opts;
        }
      })
      .catch(function () {});
    authFetch("/api/admin/claims/adjustment-due")
      .then(j)
      .then(function (d) {
        el("adjustmentTable").innerHTML = adjustmentTable(d.results || []);
      })
      .catch(function () {});
  }
  function eligibleTable(rows, canWrite) {
    if (!rows.length) return '<p class="admin-empty">No donations are waiting to be claimed.</p>';
    var body = rows
      .map(function (r) {
        var box = canWrite ? '<td><input type="checkbox" class="elig-check" value="' + r.id + '" aria-label="Select donation ' + r.id + '"></td>' : "";
        return (
          "<tr>" + box + "<td>" + r.id + "</td><td>" + H.escapeHtml(r.donor_name) +
          '</td><td class="admin-num">' + H.formatPence(r.amount_pence) + "</td><td>" +
          H.escapeHtml(r.postcode || "") + "</td><td>" + H.fmtDate(r.created_at) + "</td></tr>"
        );
      })
      .join("");
    var head = (canWrite ? "<th></th>" : "") + "<th>ID</th><th>Donor</th><th>Amount</th><th>Postcode</th><th>Date</th>";
    return '<table class="admin-table"><thead><tr>' + head + "</tr></thead><tbody>" + body + "</tbody></table>";
  }
  function assignSelected() {
    var ids = Array.prototype.slice
      .call(doc.querySelectorAll(".elig-check:checked"))
      .map(function (c) { return Number(c.value); });
    if (!ids.length) { window.alert("Tick at least one donation first."); return; }
    var target = el("assignBatchSelect").value;
    function post(batchId) {
      authFetch("/api/admin/claim-batches/" + batchId + "/donations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ donationIds: ids }),
      })
        .then(function (res) { return res.ok ? res.json() : null; })
        .then(function (out) {
          if (out && out.failed && out.failed.length) {
            window.alert("Added " + out.assigned.length + ", " + out.failed.length + " could not be added.");
          }
          loadClaims();
        })
        .catch(function () {});
    }
    if (target === "new") {
      authFetch("/api/admin/claim-batches", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
        .then(function (res) { return res.json(); })
        .then(function (d) { post(d.batchId); })
        .catch(function () {});
    } else {
      post(target);
    }
  }
  function adjustmentTable(rows) {
    if (!rows.length) return '<p class="admin-empty">No adjustments due.</p>';
    var body = rows
      .map(function (r) {
        return (
          "<tr><td>" + r.id + "</td><td>" + H.escapeHtml(r.donor_name) + '</td><td class="admin-num">' +
          H.formatPence(r.amount_pence) + '</td><td class="admin-num">' + H.formatPence(r.adjustment_pence || 0) +
          "</td><td>" + H.escapeHtml(r.adjustment_reason || "") + "</td></tr>"
        );
      })
      .join("");
    return '<table class="admin-table"><thead><tr><th>ID</th><th>Donor</th><th>Amount</th><th>Adjustment</th><th>Reason</th></tr></thead><tbody>' + body + "</tbody></table>";
  }
  function batchesTable(rows) {
    if (!rows.length) return '<p class="admin-empty">No claim batches.</p>';
    var canWrite = H.roleCan(currentRole, "editor");
    var body = rows
      .map(function (b) {
        var actions = "";
        if (canWrite) {
          if (b.status === "open") actions += '<button class="admin-link" type="button" data-submit-batch="' + b.id + '">Submit</button> ';
          actions += '<button class="admin-link" type="button" data-export-batch="' + b.id + '">Export CSV</button>';
        }
        return (
          "<tr><td>" + b.id + '</td><td><span class="admin-pill">' + H.escapeHtml(b.status) + "</span></td><td>" +
          b.donation_count + '</td><td class="admin-num">' + H.formatPence(b.total_pence) + "</td><td>" +
          H.fmtDate(b.submitted_at) + "</td><td>" + actions + "</td></tr>"
        );
      })
      .join("");
    return '<table class="admin-table"><thead><tr><th>ID</th><th>Status</th><th>Donations</th><th>Total</th><th>Submitted</th><th></th></tr></thead><tbody>' + body + "</tbody></table>";
  }
  function submitBatch(id) {
    if (!window.confirm("Submit claim batch " + id + " to HMRC?")) return;
    authFetch("/api/admin/claim-batches/" + id + "/submit", { method: "POST" })
      .then(function (res) {
        if (res.ok) loadClaims();
      })
      .catch(function () {});
  }
  function exportBatch(id) {
    authFetch("/api/admin/claim-batches/" + id + "/export")
      .then(function (res) {
        return res.text();
      })
      .then(function (csv) {
        var blob = new Blob([csv], { type: "text/csv" });
        var url = URL.createObjectURL(blob);
        var a = doc.createElement("a");
        a.href = url;
        a.download = "claim-batch-" + id + ".csv";
        doc.body.appendChild(a);
        a.click();
        doc.body.removeChild(a);
        URL.revokeObjectURL(url);
      })
      .catch(function () {});
  }

  // ---- subscriptions (dunning) ----
  function loadSubs() {
    var wrap = el("subsTable");
    wrap.innerHTML = '<p class="admin-loading">Loading…</p>';
    authFetch("/api/admin/subscriptions/dunning")
      .then(j)
      .then(function (d) {
        var rows = d.results || [];
        if (!rows.length) {
          wrap.innerHTML = '<p class="admin-empty">No at-risk subscriptions.</p>';
          return;
        }
        var body = rows
          .map(function (s) {
            return (
              "<tr><td>" + s.id + "</td><td>" + H.escapeHtml(s.donor_name) + '</td><td><span class="admin-pill">' +
              H.escapeHtml(s.status) + "</span></td><td>" + s.failed_attempts + "</td><td>" + H.fmtDate(s.lapsed_at) + "</td></tr>"
            );
          })
          .join("");
        wrap.innerHTML = '<table class="admin-table"><thead><tr><th>ID</th><th>Donor</th><th>Status</th><th>Failed</th><th>Lapsed</th></tr></thead><tbody>' + body + "</tbody></table>";
      })
      .catch(function () {
        wrap.innerHTML = '<p class="admin-empty">Unavailable.</p>';
      });
  }

  // ---- stories (Task C): list + filter, detail, status/tags/notes edit (editor+) ----
  Array.prototype.forEach.call(doc.querySelectorAll("#storiesStatusFilter .admin-seg"), function (b) {
    b.addEventListener("click", function () {
      storiesStatusFilter = b.getAttribute("data-status") || "";
      Array.prototype.forEach.call(doc.querySelectorAll("#storiesStatusFilter .admin-seg"), function (x) {
        x.classList.toggle("is-active", x === b);
      });
      loadStories();
    });
  });
  function scopeConsentBadges(r) {
    var badges = '<span class="admin-pill">' + H.escapeHtml(H.storyLabel("useScope", r.use_scope)) + "</span>";
    if (r.consent_share_first_name) badges += ' <span class="admin-pill">First name</span>';
    if (r.consent_share_town) badges += ' <span class="admin-pill">Town</span>';
    if (r.third_party_consent) badges += ' <span class="admin-pill">3rd-party OK</span>';
    return badges;
  }
  function storiesTable(rows) {
    if (!rows.length) return '<p class="admin-empty">No stories yet.</p>';
    var body = rows
      .map(function (r) {
        return (
          "<tr><td>" + r.id + "</td><td>" + H.escapeHtml(H.storyLabel("submitterRole", r.submitter_role)) +
          "</td><td>" + scopeConsentBadges(r) + '</td><td><span class="admin-pill">' +
          H.escapeHtml(H.storyLabel("status", r.status)) + "</span></td><td>" +
          H.escapeHtml(H.consentAge(r.consent_captured_at)) + "</td><td>" + H.fmtDate(r.created_at) +
          '</td><td><button class="admin-link" type="button" data-story="' + r.id + '">View</button></td></tr>'
        );
      })
      .join("");
    return (
      '<table class="admin-table"><thead><tr><th>ID</th><th>Role</th><th>Scope / consent</th>' +
      "<th>Status</th><th>Consent age</th><th>Submitted</th><th></th></tr></thead><tbody>" +
      body + "</tbody></table>"
    );
  }
  function loadStories() {
    var wrap = el("storiesTable");
    wrap.innerHTML = '<p class="admin-loading">Loading…</p>';
    var path = "/api/admin/stories" + (storiesStatusFilter ? "?status=" + encodeURIComponent(storiesStatusFilter) : "");
    authFetch(path)
      .then(j)
      .then(function (d) {
        wrap.innerHTML = storiesTable(d.results || []);
      })
      .catch(function () {
        wrap.innerHTML = '<p class="admin-empty">Unavailable.</p>';
      });
  }
  function storyStatus(msg) {
    el("storyActionStatus").textContent = msg || "";
  }
  function openStory(id) {
    currentStoryId = id;
    showOnly("view-story");
    Array.prototype.forEach.call(doc.querySelectorAll(".admin-nav-link"), function (b) {
      b.classList.remove("is-active");
    });
    storyStatus("");
    var wrap = el("storyDetail");
    wrap.innerHTML = '<p class="admin-loading">Loading…</p>';
    authFetch("/api/admin/stories/" + id)
      .then(function (res) {
        if (res.status === 404) {
          wrap.innerHTML = '<p class="admin-empty">Story not found.</p>';
          throw new Error("not found");
        }
        return res.json();
      })
      .then(renderStory)
      .catch(function () {});
  }
  function renderStory(s) {
    var canWrite = H.roleCan(currentRole, "editor");
    var info =
      '<dl class="admin-dl">' +
      dl("Role", H.storyLabel("submitterRole", s.submitter_role)) +
      dl("Use scope", H.storyLabel("useScope", s.use_scope)) +
      dl("Share first name", s.consent_share_first_name ? "Yes" : "No") +
      dl("Share town", s.consent_share_town ? "Yes" : "No") +
      dl("Third-party consent", s.third_party_consent ? "Yes" : "No") +
      dl("Contact for more", s.contact_for_more ? "Yes" : "No") +
      dl("Status", H.storyLabel("status", s.status)) +
      dl("Consent captured", H.fmtDate(s.consent_captured_at) + " (" + H.consentAge(s.consent_captured_at) + ")") +
      dl("Submitted", H.fmtDate(s.created_at)) +
      dl("First name", s.submitter_first_name || "Not given") +
      dl("Email", s.submitter_email || "Not given") +
      dl("Phone", s.submitter_phone || "Not given") +
      dl("Town", s.submitter_town || "Not given") +
      dl("Age band", H.storyLabel("ageBand", s.age_band)) +
      dl("Gender", s.gender || "Not given") +
      dl("Recipient type", H.storyLabel("recipientType", s.recipient_type)) +
      dl("Heard about us via", s.heard_about || "Not given") +
      dl("Confirmed 16+", s.confirmed_over_16 ? "Yes" : "No") +
      "</dl>" +
      '<h3 class="admin-subhead">Story</h3><p class="admin-story-text">' + H.escapeHtml(s.story_text || "") + "</p>" +
      (s.short_quote ? '<h3 class="admin-subhead">Short quote</h3><p class="admin-story-text">' + H.escapeHtml(s.short_quote) + "</p>" : "");
    var actions = "";
    if (canWrite) {
      var statusOptions = ["new", "reviewed", "used", "withdrawn"]
        .map(function (st) {
          return '<option value="' + st + '"' + (s.status === st ? " selected" : "") + ">" + H.escapeHtml(H.storyLabel("status", st)) + "</option>";
        })
        .join("");
      actions =
        '<form class="admin-edit" id="storyEditForm"><h3 class="admin-subhead">Manage story</h3>' +
        '<div class="admin-field"><label for="edit-storyStatus">Status</label>' +
        '<select id="edit-storyStatus" name="status">' + statusOptions + "</select></div>" +
        editField("storyTags", "Tags (comma-separated)", "text", (s.admin_tags || []).join(", ")) +
        '<div class="admin-field"><label for="edit-storyNotes">Notes</label>' +
        '<textarea id="edit-storyNotes" name="adminNotes" rows="4">' + H.escapeHtml(s.admin_notes || "") + "</textarea></div>" +
        '<button class="btn btn-primary" type="submit">Save changes</button> ' +
        '<button class="btn btn-ghost" type="button" id="withdrawStoryBtn">Withdraw</button>' +
        "</form>" +
        // Permanent erasure (G2 item 6): visually distinct from the reversible Withdraw
        // above (its own danger zone, a destructive btn style) and gated by an
        // irreversible-erasure confirm() guard (see deleteStory below) — never the same
        // click surface as the Save/Withdraw form.
        '<div class="admin-danger-zone">' +
        '<h3 class="admin-subhead">Delete permanently</h3>' +
        '<p class="admin-danger-copy">This permanently erases the story and every detail the submitter gave us. There is no way to undo this, and it is different from Withdraw, which only stops the story being used.</p>' +
        '<button class="btn btn-danger" type="button" id="deleteStoryBtn">Delete permanently</button>' +
        "</div>";
    }
    el("storyDetail").innerHTML = info + actions;
    if (canWrite) wireStoryActions(s);
  }
  function patchStory(body, okMsg, errMsg) {
    return authFetch("/api/admin/stories/" + currentStoryId, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then(function (res) {
        return res.ok ? res.json() : null;
      })
      .then(function (updated) {
        if (updated) {
          renderStory(updated);
          storyStatus(okMsg);
        } else storyStatus(errMsg);
      })
      .catch(function () {
        storyStatus(errMsg);
      });
  }
  function wireStoryActions(s) {
    var form = el("storyEditForm");
    if (form) {
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var tagsRaw = (el("edit-storyTags").value || "").trim();
        var body = {
          status: el("edit-storyStatus").value,
          adminTags: tagsRaw ? tagsRaw.split(",").map(function (t) { return t.trim(); }).filter(Boolean) : [],
          adminNotes: el("edit-storyNotes").value || "",
        };
        patchStory(body, "Saved.", "Could not save the changes.");
      });
    }
    bindClick("withdrawStoryBtn", function () {
      if (!window.confirm("Withdraw this story? It will no longer be treated as usable.")) return;
      patchStory({ status: "withdrawn" }, "Story withdrawn.", "Could not withdraw the story.");
    });
    bindClick("deleteStoryBtn", deleteStory);
  }
  // Permanent erasure (G2 item 6): a stronger, explicit confirm() than Withdraw's, naming the
  // action as permanent erasure rather than a generic "are you sure", since this cannot be
  // undone (DELETE /api/admin/stories/:id, not a status flag). On success, returns to the
  // Stories list and refreshes it, since the detail view has nothing left to show.
  function deleteStory() {
    if (
      !window.confirm(
        "Permanently delete this story? This erases the story and the submitter's details for good. This cannot be undone.",
      )
    ) {
      return;
    }
    authFetch("/api/admin/stories/" + currentStoryId, { method: "DELETE" })
      .then(function (res) {
        if (res.ok) {
          selectView("stories");
        } else {
          storyStatus("Could not delete the story.");
        }
      })
      .catch(function () {
        storyStatus("Could not delete the story.");
      });
  }
  bindClick("storyBack", function () {
    selectView("stories");
  });

  // ---- audit ----
  function loadAudit() {
    var wrap = el("auditTable");
    wrap.innerHTML = '<p class="admin-loading">Loading…</p>';
    authFetch("/api/admin/audit?limit=50")
      .then(j)
      .then(function (d) {
        var rows = d.results || [];
        if (!rows.length) {
          wrap.innerHTML = '<p class="admin-empty">No audit entries.</p>';
          return;
        }
        var body = rows
          .map(function (r) {
            return (
              "<tr><td>" + r.id + "</td><td>" + H.fmtDate(r.created_at) + "</td><td>" + H.escapeHtml(r.actor) +
              "</td><td>" + H.escapeHtml(r.action) + "</td><td>" + H.escapeHtml(r.entity) + " " + (r.entity_id || "") + "</td></tr>"
            );
          })
          .join("");
        wrap.innerHTML = '<table class="admin-table"><thead><tr><th>ID</th><th>When</th><th>Actor</th><th>Action</th><th>Entity</th></tr></thead><tbody>' + body + "</tbody></table>";
      })
      .catch(function () {
        wrap.innerHTML = '<p class="admin-empty">Unavailable.</p>';
      });
  }

  // ---- newsletter ----
  function renderNewsletterList(rows) {
    if (!rows.length) return '<p class="admin-loading">No newsletters yet.</p>';
    var html = '<table class="admin-table"><thead><tr><th>Subject</th><th>Status</th><th>Sent</th><th>Recipients</th><th></th></tr></thead><tbody>';
    rows.forEach(function (n) {
      html +=
        "<tr><td>" + H.escapeHtml(n.subject) + "</td><td>" + n.status + "</td><td>" +
        (n.sentAt ? new Date(n.sentAt).toLocaleString() : "—") + "</td><td>" +
        (n.recipientCount == null ? "—" : n.recipientCount) +
        '</td><td><button class="admin-link" type="button" data-edit-newsletter="' + n.id + '">Open</button></td></tr>';
    });
    return html + "</tbody></table>";
  }

  function loadNewsletterInto(id) {
    authFetch("/api/admin/newsletters/" + id)
      .then(j)
      .then(function (n) {
        el("newsletterId").value = n.id;
        el("newsletterSubject").value = n.subject;
        el("newsletterBody").value = n.bodyHtml;
        var sent = n.status === "sent";
        // Send is Admin-only and only for an unsent newsletter.
        el("newsletterSend").hidden = !(currentRole === "admin" && !sent);
        el("newsletterSave").disabled = sent;
        el("newsletterMsg").textContent = sent ? "This newsletter has been sent and is read-only." : "";
      })
      .catch(function () {});
  }

  function loadNewsletters() {
    authFetch("/api/admin/newsletters")
      .then(j)
      .then(function (rows) {
        el("newsletterList").innerHTML = renderNewsletterList(rows);
        Array.prototype.forEach.call(doc.querySelectorAll("[data-edit-newsletter]"), function (b) {
          b.addEventListener("click", function () {
            loadNewsletterInto(b.getAttribute("data-edit-newsletter"));
          });
        });
        // Open the first newsletter by default so the editor is never empty.
        if (rows.length) loadNewsletterInto(rows[0].id);
      })
      .catch(function () {});
  }

  var nlForm = el("newsletterForm");
  if (nlForm) {
    el("newsletterNew").addEventListener("click", function () {
      el("newsletterId").value = "";
      el("newsletterSubject").value = "";
      el("newsletterBody").value = "";
      el("newsletterSend").hidden = true; // save first to get an id
      el("newsletterSave").disabled = false;
      el("newsletterMsg").textContent = "";
    });

    nlForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var id = el("newsletterId").value;
      var payload = { subject: el("newsletterSubject").value, bodyHtml: el("newsletterBody").value };
      var req = id
        ? authFetch("/api/admin/newsletters/" + id, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : authFetch("/api/admin/newsletters", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
      req
        .then(function (res) {
          if (!res.ok) throw new Error("save failed: " + res.status);
          return res.json();
        })
        .then(function (n) {
          el("newsletterMsg").textContent = "Saved.";
          loadNewsletters();
          loadNewsletterInto(n.id);
        })
        .catch(function () {
          el("newsletterMsg").textContent = "Save failed.";
        });
    });

    el("newsletterSend").addEventListener("click", function () {
      var id = el("newsletterId").value;
      if (!id) return;
      var sendBtn = el("newsletterSend");
      sendBtn.disabled = true;
      el("newsletterMsg").textContent = "Sending…";
      authFetch("/api/admin/newsletters/" + id + "/send", { method: "POST" })
        .then(function (res) {
          if (!res.ok) throw new Error("send failed: " + res.status);
          return res.json();
        })
        .then(function (r) {
          el("newsletterMsg").textContent = "Sent to " + r.recipientCount + " subscriber(s).";
          loadNewsletters();
          loadNewsletterInto(id);
        })
        .catch(function () {
          sendBtn.disabled = false;
          el("newsletterMsg").textContent = "Send failed (already sent, or not permitted).";
        });
    });
  }

  // ---- donor search results (with a View action) ----
  function donorsSearchTable(rows) {
    if (!rows.length) return '<p class="admin-empty">No results.</p>';
    var body = rows
      .map(function (r) {
        return (
          "<tr><td>" + r.id + "</td><td>" + H.escapeHtml(r.full_name) + "</td><td>" + H.escapeHtml(r.email || "") +
          "</td><td>" + H.escapeHtml(r.donor_type) + "</td><td>" + (r.anonymous ? '<span class="admin-pill">Anon</span>' : "") +
          '</td><td><button class="admin-link" type="button" data-donor="' + r.id + '">View</button></td></tr>'
        );
      })
      .join("");
    return '<table class="admin-table"><thead><tr><th>ID</th><th>Name</th><th>Email</th><th>Type</th><th></th><th></th></tr></thead><tbody>' + body + "</tbody></table>";
  }

  // ---- donor detail + role-gated actions ----
  function dl(k, v) {
    return "<dt>" + H.escapeHtml(k) + "</dt><dd>" + H.escapeHtml(v) + "</dd>";
  }
  function editField(id, label, type, val) {
    return (
      '<div class="admin-field"><label for="edit-' + id + '">' + H.escapeHtml(label) + "</label>" +
      '<input id="edit-' + id + '" name="' + id + '" type="' + type + '" value="' + H.escapeHtml(val) + '" /></div>'
    );
  }
  function editCheck(id, label, on) {
    return '<label class="admin-check"><input type="checkbox" id="edit-' + id + '"' + (on ? " checked" : "") + " /> " + H.escapeHtml(label) + "</label>";
  }
  function donorStatus(msg) {
    el("donorActionStatus").textContent = msg || "";
  }
  function openDonor(id) {
    currentDonorId = id;
    showOnly("view-donor");
    Array.prototype.forEach.call(doc.querySelectorAll(".admin-nav-link"), function (b) {
      b.classList.remove("is-active");
    });
    donorStatus("");
    var wrap = el("donorDetail");
    wrap.innerHTML = '<p class="admin-loading">Loading…</p>';
    authFetch("/api/admin/donors/" + id)
      .then(function (res) {
        if (res.status === 404) {
          wrap.innerHTML = '<p class="admin-empty">Donor not found.</p>';
          throw new Error("not found");
        }
        return res.json();
      })
      .then(renderDonor)
      .catch(function () {});
  }
  // Join the donor's house name/number + address line into one string for display; "None on file"
  // when neither is set. Postcode is shown as its own row (d.postcode).
  function donorAddress(d) {
    var parts = [d.houseNameNumber, d.address].filter(function (p) { return p && String(p).trim(); });
    return parts.length ? parts.join(", ") : "None on file";
  }
  function renderDonor(d) {
    var canWrite = H.roleCan(currentRole, "editor");
    var info =
      '<dl class="admin-dl">' +
      dl("Name", d.fullName) +
      dl("Email", d.email || "None on file") +
      dl("Email consent", d.emailConsent ? "Yes" : "No") +
      dl("Anonymous", d.anonymous ? "Yes" : "No") +
      dl("Address", donorAddress(d)) +
      dl("Postcode", d.postcode || "None on file") +
      dl("Monthly plan", d.subscriptionPlan ? cap(d.subscriptionPlan) : "None") +
      dl("Gift Aid", d.giftAid ? "Active" : "Not active") +
      "</dl>";
    var actions = "";
    if (canWrite) {
      actions =
        '<form class="admin-edit" id="donorEditForm"><h3 class="admin-subhead">Edit donor</h3>' +
        editField("fullName", "Name", "text", d.fullName || "") +
        editField("email", "Email", "email", d.email || "") +
        editCheck("emailConsent", "Email consent", d.emailConsent) +
        editCheck("anonymous", "Anonymous on the public page", d.anonymous) +
        '<button class="btn btn-primary" type="submit">Save changes</button></form>';
      // Gift Aid declaration details (TASK-130): correct identity/address on the active declaration.
      if (d.declaration) {
        var dec = d.declaration;
        actions +=
          '<form class="admin-edit" id="donorDeclForm"><h3 class="admin-subhead">Gift Aid declaration details</h3>' +
          editField("declTitle", "Title", "text", dec.title || "") +
          editField("declFirstName", "First name", "text", dec.firstName || "") +
          editField("declLastName", "Last name", "text", dec.lastName || "") +
          editField("declHouse", "House name or number", "text", dec.houseNameNumber || "") +
          editField("declAddress", "Home address", "text", dec.address || "") +
          editField("declPostcode", "Postcode", "text", dec.postcode || "") +
          editCheck("declNonUk", "No UK postcode (overseas address)", dec.nonUk) +
          '<button class="btn btn-primary" type="submit">Save declaration details</button></form>';
      }
      actions += '<div class="admin-donor-actions">';
      if (d.subscriptionPlan && d.subscriptionId) actions += '<button class="btn btn-ghost" type="button" id="cancelSubBtn">Cancel monthly gift</button>';
      if (d.giftAid) actions += '<button class="btn btn-ghost" type="button" id="cancelGaBtn">Cancel Gift Aid</button>';
      actions += "</div>";
    }
    el("donorDetail").innerHTML = info + actions;
    if (canWrite) wireDonorActions(d);
  }
  function wireDonorActions(d) {
    var form = el("donorEditForm");
    if (form) {
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var body = {
          fullName: (el("edit-fullName").value || "").trim(),
          email: (el("edit-email").value || "").trim(),
          emailConsent: el("edit-emailConsent").checked,
          anonymous: el("edit-anonymous").checked,
        };
        if (!body.email) delete body.email; // email optional; PATCH rejects an empty string
        authFetch("/api/admin/donors/" + currentDonorId, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
          .then(function (res) {
            return res.ok ? res.json() : null;
          })
          .then(function (snap) {
            if (snap) {
              renderDonor(snap);
              donorStatus("Saved.");
            } else donorStatus("Could not save the changes.");
          })
          .catch(function () {
            donorStatus("Could not save the changes.");
          });
      });
    }
    var declForm = el("donorDeclForm");
    if (declForm) {
      declForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var nonUk = el("edit-declNonUk").checked;
        var declBody = {
          title: (el("edit-declTitle").value || "").trim() || undefined,
          firstName: (el("edit-declFirstName").value || "").trim(),
          lastName: (el("edit-declLastName").value || "").trim(),
          houseNameNumber: (el("edit-declHouse").value || "").trim() || undefined,
          address: (el("edit-declAddress").value || "").trim(),
          nonUk: nonUk,
        };
        if (!nonUk) declBody.postcode = (el("edit-declPostcode").value || "").trim();
        authFetch("/api/admin/donors/" + currentDonorId + "/declaration", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(declBody),
        })
          .then(function (res) {
            return res.ok ? res.json() : null;
          })
          .then(function (snap) {
            if (snap) {
              renderDonor(snap);
              donorStatus("Declaration details saved.");
            } else donorStatus("Could not save the declaration details.");
          })
          .catch(function () {
            donorStatus("Could not save the declaration details.");
          });
      });
    }
    bindClick("cancelSubBtn", function () {
      if (!window.confirm("Cancel this donor's monthly gift?")) return;
      authFetch("/api/admin/donors/" + currentDonorId + "/subscription/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscriptionId: d.subscriptionId, accepted: "cancel" }),
      })
        .then(function (res) {
          donorStatus(res.ok ? "Monthly gift cancelled." : "Could not cancel the monthly gift.");
          if (res.ok) openDonor(currentDonorId);
        })
        .catch(function () {
          donorStatus("Could not cancel the monthly gift.");
        });
    });
    bindClick("cancelGaBtn", function () {
      if (!window.confirm("Cancel this donor's Gift Aid declaration?")) return;
      authFetch("/api/admin/donors/" + currentDonorId + "/gift-aid/cancel", { method: "POST" })
        .then(function (res) {
          donorStatus(res.ok ? "Gift Aid cancelled." : "Could not cancel Gift Aid.");
          if (res.ok) openDonor(currentDonorId);
        })
        .catch(function () {
          donorStatus("Could not cancel Gift Aid.");
        });
    });
  }

  // Back from donor detail, and delegated actions on any table (view donor / submit / export).
  bindClick("donorBack", function () {
    selectView("donations");
  });
  var content = doc.querySelector(".admin-content");
  if (content) {
    content.addEventListener("click", function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var donor = t.closest("[data-donor]");
      if (donor) return openDonor(donor.getAttribute("data-donor"));
      var story = t.closest("[data-story]");
      if (story) return openStory(story.getAttribute("data-story"));
      var sub = t.closest("[data-submit-batch]");
      if (sub) return submitBatch(sub.getAttribute("data-submit-batch"));
      var exp = t.closest("[data-export-batch]");
      if (exp) return exportBatch(exp.getAttribute("data-export-batch"));
    });
  }

  // ---- thank-you letters (REQ-069 · TASK-163) ----
  // Three panels: the eligible-donor list (GET /thank-you/eligible), a compose form with a LIVE A4
  // letter preview (the letter the donor is emailed), and the sent history (GET /thank-you/sent).
  // "Write" prefills the form from a listed donor; submitting POSTs /thank-you/send (Editor+, the
  // server enforces). Bindings are wired once (tyWired); the preview mirrors src/thank-you/letter.ts.
  var tyWired = false;
  var tyEligibleById = {};
  var TY_A4W = 794; // 210mm @96dpi
  var TY_A4H = 1123; // 297mm @96dpi

  function tyMoney(v) {
    var n = typeof v === "number" ? v : parseFloat(String(v).replace(/[^0-9.]/g, "")) || 0;
    return "£" + n.toLocaleString("en-GB");
  }
  function tyTodayLong() {
    try {
      return new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
    } catch (e) {
      return "";
    }
  }
  // Scale the A4 letter to fit the preview column.
  function tyFit() {
    var wrap = el("tyPaperWrap"), paper = el("tyPaper");
    if (!wrap || !paper) return;
    var w = wrap.clientWidth;
    if (!w) return;
    var s = Math.min(1, w / TY_A4W);
    paper.style.transform = "scale(" + s + ")";
    wrap.style.height = TY_A4H * s + "px";
  }

  function tyUpdateTitle() {
    el("tyPTitle").textContent = "Thank you, " + (el("tyName").value || "friend") + ".";
    tyFit();
  }
  function tyUpdateDear() {
    el("tyPSalutation").textContent = "Dear " + (el("tyDear").value || "friend") + ",";
  }
  function tyUpdateDate() {
    el("tyPDate").textContent = el("tyDate").value;
  }
  function tyUpdatePersonal() {
    var v = el("tyPersonal").value;
    var p = el("tyPPersonal");
    p.textContent = v; // textContent auto-escapes
    p.hidden = !v;
    tyFit();
  }
  function tyUpdateSigner() {
    var opt = el("tySigner").selectedOptions[0];
    el("tyPSigName").textContent = opt.value;
    el("tyPSigRole").textContent = opt.getAttribute("data-role");
  }
  function tyRenderGift() {
    var kind = el("tyGtKind").getAttribute("aria-pressed") === "true";
    var callout = el("tyPCallout");
    if (kind) {
      var items = el("tyInKind").value || "your kind donation";
      callout.innerHTML = "With heartfelt thanks for your donation of <b>" + H.escapeHtml(items) + "</b>.";
    } else {
      var n = parseFloat(String(el("tyAmount").value).replace(/[^0-9.]/g, "")) || 0;
      var html = "With heartfelt thanks for your gift of <b>" + tyMoney(n) + "</b>.";
      if (el("tyGiftAid").checked) {
        html +=
          '<span class="ty-ganote">Because you Gift Aided it, HMRC adds 25%, making your gift worth <b>' +
          tyMoney(n * 1.25) +
          "</b> to our work, at no extra cost to you.</span>";
      }
      callout.innerHTML = html;
    }
    tyFit();
  }
  function tySetMode(kind) {
    el("tyGtMoney").setAttribute("aria-pressed", kind ? "false" : "true");
    el("tyGtKind").setAttribute("aria-pressed", kind ? "true" : "false");
    el("tyWrapAmount").hidden = kind;
    el("tyWrapInKind").hidden = !kind;
    tyRenderGift();
  }

  function tyEligibleTable(rows, canWrite) {
    if (!rows.length) return '<p class="admin-empty">No donors over the threshold yet.</p>';
    var body = rows
      .map(function (r) {
        var ga = r.giftAided ? '<span class="ty-pill ty-pill-ga">Gift Aided</span>' : "";
        var status;
        if (r.sendState === "no_email") status = '<span class="ty-pill ty-pill-blocked">No email</span>';
        else if (r.sendState === "opted_out") status = '<span class="ty-pill ty-pill-blocked">Opted out</span>';
        else if (r.alreadyThanked) status = '<span class="ty-pill ty-pill-thanked">Thanked ' + H.fmtDate(r.lastThankedAt) + "</span>";
        else status = '<span class="ty-pill ty-pill-ready">Ready</span>';
        var canEmail = r.sendState === "ready";
        var action =
          canWrite && canEmail
            ? '<button class="admin-link" type="button" data-ty-donor="' + r.donorId + '">' + (r.alreadyThanked ? "Thank again" : "Write") + "</button>"
            : "";
        return (
          "<tr><td>" + H.escapeHtml(r.name) + '<span class="admin-sub">' + H.escapeHtml(r.email || "no email") + "</span></td>" +
          '<td class="admin-num">' + H.formatPence(r.maxGiftPence) + "</td><td>" + ga + "</td><td>" + status + "</td><td>" + action + "</td></tr>"
        );
      })
      .join("");
    return (
      '<table class="admin-table"><thead><tr><th>Donor</th><th>Largest gift</th><th>Gift Aid</th><th>Status</th><th></th></tr></thead><tbody>' +
      body +
      "</tbody></table>"
    );
  }
  function tySentTable(rows) {
    if (!rows.length) return '<p class="admin-empty">No thank-you letters sent yet.</p>';
    var body = rows
      .map(function (r) {
        var gift =
          r.giftType === "in_kind"
            ? "Gift in kind" + (r.giftInKind ? ': <span class="admin-sub">' + H.escapeHtml(r.giftInKind) + "</span>" : "")
            : H.formatPence(r.giftAmountPence) + (r.giftAided ? ' <span class="ty-pill ty-pill-ga">Gift Aided</span>' : "");
        return (
          "<tr><td>" + H.fmtDate(r.sentAt) + "</td><td>" + H.escapeHtml(r.thankYouName) + '<span class="admin-sub">' + H.escapeHtml(r.recipientEmail) +
          "</span></td><td>" + gift + "</td><td>" + H.escapeHtml(r.signedByName) + "</td><td>" + H.escapeHtml(r.sentBy) + "</td></tr>"
        );
      })
      .join("");
    return (
      '<table class="admin-table"><thead><tr><th>Sent</th><th>Recipient</th><th>Gift</th><th>Signed by</th><th>By</th></tr></thead><tbody>' +
      body +
      "</tbody></table>"
    );
  }

  function loadThankYouEligible() {
    var canWrite = H.roleCan(currentRole, "editor");
    var thr = parseFloat(String(el("tyThreshold").value).replace(/[^0-9.]/g, "")) || 1000;
    var pence = Math.round(thr * 100);
    el("tyEligibleTable").innerHTML = '<p class="admin-loading">Loading…</p>';
    authFetch("/api/admin/thank-you/eligible?threshold=" + pence)
      .then(j)
      .then(function (d) {
        var rows = d.results || [];
        tyEligibleById = {};
        rows.forEach(function (r) {
          tyEligibleById[r.donorId] = r;
        });
        el("tyEligibleTable").innerHTML = tyEligibleTable(rows, canWrite);
        var ready = rows.filter(function (r) {
          return r.sendState === "ready" && !r.alreadyThanked;
        }).length;
        el("tyEligibleCount").textContent = rows.length + " listed · " + ready + " ready";
      })
      .catch(function () {
        el("tyEligibleTable").innerHTML = '<p class="admin-empty">Could not load donors.</p>';
      });
  }
  function loadThankYouSent() {
    el("tySentTable").innerHTML = '<p class="admin-loading">Loading…</p>';
    authFetch("/api/admin/thank-you/sent")
      .then(j)
      .then(function (d) {
        el("tySentTable").innerHTML = tySentTable(d.results || []);
      })
      .catch(function () {
        el("tySentTable").innerHTML = '<p class="admin-empty">Could not load the sent history.</p>';
      });
  }

  function tyPrefill(r) {
    el("tyDonorId").value = r.donorId;
    el("tyName").value = r.name;
    el("tyDear").value = r.name;
    el("tyEmail").value = r.email || "";
    tySetMode(false);
    el("tyAmount").value = String(r.maxGiftPence / 100);
    el("tyGiftAid").checked = !!r.giftAided;
    tyUpdateTitle();
    tyUpdateDear();
    tyRenderGift();
    el("tyForm").scrollIntoView({ block: "nearest" });
  }
  function tyNewLetter() {
    el("tyDonorId").value = "";
    el("tyName").value = "friend";
    el("tyDear").value = "friend";
    el("tyEmail").value = "";
    el("tyPersonal").value = "";
    el("tyInKind").value = "";
    el("tyAmount").value = "1000";
    el("tyGiftAid").checked = true;
    tySetMode(false);
    tyUpdateTitle();
    tyUpdateDear();
    tyUpdatePersonal();
  }
  function tySubmit(e) {
    e.preventDefault();
    var kind = el("tyGtKind").getAttribute("aria-pressed") === "true";
    var status = el("tyStatus");
    var donorIdRaw = el("tyDonorId").value;
    var amount = parseFloat(String(el("tyAmount").value).replace(/[^0-9.]/g, "")) || 0;
    var payload = {
      donorId: donorIdRaw ? Number(donorIdRaw) : null,
      thankYouName: (el("tyName").value || "").trim(),
      addressedTo: (el("tyDear").value || "").trim(),
      recipientEmail: (el("tyEmail").value || "").trim(),
      giftType: kind ? "in_kind" : "money",
      giftAmountPence: kind ? null : Math.round(amount * 100),
      giftInKind: kind ? (el("tyInKind").value || "").trim() || null : null,
      giftAided: kind ? false : el("tyGiftAid").checked,
      personalMessage: (el("tyPersonal").value || "").trim() || null,
      signedByName: el("tySigner").value,
      signedByRole: el("tySigner").selectedOptions[0].getAttribute("data-role"),
      letterDate: (el("tyDate").value || "").trim(),
    };
    var btn = el("tySend");
    btn.disabled = true;
    status.className = "ty-status";
    status.textContent = "Sending…";
    authFetch("/api/admin/thank-you/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(function (res) {
        return res.json().then(function (b) {
          return { ok: res.ok, code: res.status, body: b };
        });
      })
      .then(function (r) {
        btn.disabled = false;
        if (r.ok) {
          status.className = "ty-status is-ok";
          status.textContent = "Sent and logged — the donor has been emailed this letter.";
          loadThankYouSent();
          loadThankYouEligible();
        } else {
          status.className = "ty-status is-error";
          status.textContent = (r.body && r.body.error) || "Could not send (" + r.code + ").";
        }
      })
      .catch(function () {
        btn.disabled = false;
        status.className = "ty-status is-error";
        status.textContent = "Could not send the letter.";
      });
  }

  function tyBindInput(id, fn) {
    var e = el(id);
    if (e) e.addEventListener("input", fn);
  }
  function tyWire() {
    if (tyWired) return;
    tyWired = true;
    el("tySend").hidden = !H.roleCan(currentRole, "editor");
    tyBindInput("tyName", tyUpdateTitle);
    tyBindInput("tyDear", tyUpdateDear);
    tyBindInput("tyDate", tyUpdateDate);
    tyBindInput("tyPersonal", tyUpdatePersonal);
    tyBindInput("tyAmount", tyRenderGift);
    tyBindInput("tyInKind", tyRenderGift);
    el("tyGiftAid").addEventListener("change", tyRenderGift);
    el("tySigner").addEventListener("change", tyUpdateSigner);
    el("tyGtMoney").addEventListener("click", function () {
      tySetMode(false);
    });
    el("tyGtKind").addEventListener("click", function () {
      tySetMode(true);
    });
    el("tyRefresh").addEventListener("click", loadThankYouEligible);
    el("tyThreshold").addEventListener("change", loadThankYouEligible);
    el("tyNew").addEventListener("click", tyNewLetter);
    el("tyEligibleTable").addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest("[data-ty-donor]");
      if (!b) return;
      var r = tyEligibleById[b.getAttribute("data-ty-donor")];
      if (r) tyPrefill(r);
    });
    el("tyForm").addEventListener("submit", tySubmit);
    window.addEventListener("resize", tyFit);
  }
  function loadThankYou() {
    if (!el("tyForm")) return;
    tyWire();
    if (!el("tyDate").value) el("tyDate").value = tyTodayLong();
    tyUpdateDate();
    tyUpdateSigner();
    tyRenderGift();
    loadThankYouEligible();
    loadThankYouSent();
    tyFit();
    setTimeout(tyFit, 200); // after webfonts settle
  }

  // ---- boot: restore an in-tab session ----
  var claims = H.parseClaims(token());
  if (claims && typeof claims.exp === "number" && claims.exp > Date.now()) showApp(claims);
  else {
    clearToken();
    showLogin();
  }
})();
