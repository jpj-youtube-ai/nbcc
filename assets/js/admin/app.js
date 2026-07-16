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
  var currentRole = "viewer"; // decoded from the session token; used for display (the badge) only -
  // write gating now runs on myPermissions (Admin Phase 2, Task 6) since a person's real access can
  // differ from their role once they carry per-section overrides.
  var myPermissions = null; // this user's EFFECTIVE per-section permissions, from GET /api/admin/me
  var donationsOffset = 0; // Donations view paging cursor
  var currentDonorId = null; // the donor open in the detail view
  var currentStoryId = null; // the story open in the detail view
  var storiesStatusFilter = ""; // Stories view status filter ("" = all)
  var currentContactId = null; // the contact enquiry open in the detail view
  var contactStatusFilter = ""; // Contact form view status filter ("" = all)
  var teamRows = []; // last-loaded Team rows, cached so "Manage access" doesn't need a single-user GET
  var currentTeamPermUserId = null; // the user id open in the Manage access (matrix) view

  // ---- permission model (Admin Phase 2 · TASK-186) ----
  // A small client-side mirror of src/admin/permissions.ts. The server is the real gate on every
  // route (authorizeSection) - this only drives nav filtering and write-control visibility, plus the
  // Team matrix editor's presets/pre-fill, all of which are UX conveniences, not security.
  var SECTIONS = [
    "overview", "search", "donations", "claims", "gasds", "subscriptions", "stories",
    "ticker", "contact", "newsletter", "thank-you", "audit", "team",
  ];
  var OPERATIONAL_EDITOR_SECTIONS = [
    "donations", "claims", "gasds", "subscriptions", "stories", "ticker", "contact", "newsletter", "thank-you", "search",
  ];
  var LEVEL_RANK = { none: 0, view: 1, edit: 2 };
  // Mirrors can() in src/admin/permissions.ts: edit satisfies a view requirement; missing/none fails.
  function permCan(perms, section, level) {
    var actual = (perms && perms[section]) || "none";
    return (LEVEL_RANK[actual] || 0) >= LEVEL_RANK[level];
  }
  function canView(section) {
    return permCan(myPermissions, section, "view");
  }
  function canEdit(section) {
    return permCan(myPermissions, section, "edit");
  }
  // A few actions are ADMIN-only regardless of the section matrix — sending a newsletter, and
  // (TASK-252) deleting one. The server enforces it; this only decides whether to offer the control.
  function isAdmin() {
    return currentRole === "admin";
  }
  // Mirrors roleToPermissions in src/admin/permissions.ts - a role's default matrix, used to pre-fill
  // the Team matrix editor for a person with no per-section overrides, and by its preset buttons.
  function rolePresetPermissions(role) {
    var perms = {};
    if (role === "admin") {
      SECTIONS.forEach(function (s) { perms[s] = "edit"; });
      return perms;
    }
    if (role === "editor") {
      perms = { overview: "view", audit: "view", team: "none" };
      OPERATIONAL_EDITOR_SECTIONS.forEach(function (s) { perms[s] = "edit"; });
      return perms;
    }
    SECTIONS.forEach(function (s) { perms[s] = s === "team" ? "none" : "view"; });
    return perms;
  }
  // Mirrors effectivePermissions in src/admin/permissions.ts: a team member's stored map if it has
  // any keys, else their role's preset.
  function effectiveTeamPermissions(u) {
    if (u.permissions && Object.keys(u.permissions).length > 0) return u.permissions;
    return rolePresetPermissions(u.role);
  }

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
    loadMyPermissions();
  }

  // Admin Phase 2 (TASK-186): fetch this user's EFFECTIVE per-section permissions and use them to
  // filter the nav before showing any view. /me already returns effective permissions (stored
  // overrides, else the role default), so no client-side fallback is needed here.
  function loadMyPermissions() {
    function proceed(perms) {
      myPermissions = perms;
      applyNavFiltering();
      // The newsletter palette is built at script-eval time (before permissions are known); re-render
      // it now so a user without newsletter:edit sees the read-only note, not the add-block buttons.
      nlRenderPalette();
      // Manual add-subscriber + test-send are edit actions → hidden for read-only (Viewer) users.
      var subCard = el("nlSubscriberCard");
      if (subCard) subCard.hidden = !canEdit("newsletter");
      var testBtn0 = el("newsletterTest");
      if (testBtn0) testBtn0.hidden = !canEdit("newsletter");
      var tmplBtn0 = el("newsletterTemplate");
      if (tmplBtn0) tmplBtn0.disabled = !canEdit("newsletter");
      nlRefreshAttachments();
      // TASK-249: load the shared template library here, once permissions are known (the picker's
      // buttons are gated by canEdit) and regardless of whether any newsletter exists — a brand-new
      // draft is exactly when you most want to start from a template.
      nlRefreshTemplates();
      selectView("overview");
      loadOverview();
    }
    authFetch("/api/admin/me")
      .then(j)
      .then(function (d) {
        proceed(d.permissions || {});
      })
      .catch(function () {
        // authFetch already sent an expired/invalid session back to login on 401; any other failure
        // falls back to "nothing granted" so the nav hides everything but Overview rather than
        // showing tabs that would just 403.
        proceed({});
      });
  }

  // Hide every nav link (and the Team-only group label) for a section the signed-in user cannot even
  // view. Overview always stays visible - it has no gated route of its own; its widgets call section
  // routes that enforce their own gate. UX only: the server is the real enforcement on every route.
  function applyNavFiltering() {
    Array.prototype.forEach.call(doc.querySelectorAll(".admin-nav-link"), function (b) {
      var section = b.getAttribute("data-view");
      if (section === "overview") return;
      // A tab may gate on EDIT of another permission section (data-edit-gate) rather than on its own
      // data-view - e.g. Business supporters is an Editor+ area gated on donations:edit, matching its
      // server route (authorizeSection "donations" "edit"). Everything else gates on view of its own
      // section, as before.
      var editGate = b.getAttribute("data-edit-gate");
      b.hidden = editGate ? !canEdit(editGate) : !canView(section);
    });
    var teamNavGroup = el("teamNavGroup");
    if (teamNavGroup) teamNavGroup.hidden = !canView("team");
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
  var DEVICE_KEY = "nbcc_admin_device"; // 30-day trusted-device token (Admin Phase 3); persists
  // across sign-out, since it only skips the second factor - the password is always still required.
  var pendingTwoFactorEmail = null; // email carried from step 1 into the 2FA panel

  function deviceToken() {
    return localStorage.getItem(DEVICE_KEY);
  }
  function setDeviceToken(t) {
    localStorage.setItem(DEVICE_KEY, t);
  }

  function completeLogin(data) {
    setToken(data.token);
    var claims = H.parseClaims(data.token) || {
      email: (data.user || {}).email,
      role: (data.user || {}).role,
    };
    if (data.deviceToken) setDeviceToken(data.deviceToken);
    showApp(claims);
  }

  function showTwoFactorPanel(email, devCode) {
    pendingTwoFactorEmail = email;
    el("loginForm").hidden = true;
    var panel = el("twoFactorPanel");
    panel.hidden = false;
    var codeInput = el("twoFactorCode");
    codeInput.value = "";
    el("twoFactorRemember").checked = false;
    var err = el("twoFactorError");
    err.hidden = true;
    var note = el("twoFactorDevNote");
    if (devCode) {
      note.textContent = "Email delivery is off in this environment. Your code is " + devCode + ".";
      note.hidden = false;
    } else {
      note.textContent = "";
      note.hidden = true;
    }
    if (codeInput.focus) codeInput.focus();
  }

  function showLoginPasswordStep() {
    pendingTwoFactorEmail = null;
    el("twoFactorPanel").hidden = true;
    el("loginForm").hidden = false;
  }

  var loginForm = el("loginForm");
  if (loginForm) {
    loginForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var err = el("loginError");
      err.hidden = true;
      var email = el("adminEmail").value.trim();
      var password = el("adminPassword").value;
      var body = { email: email, password: password };
      var dt = deviceToken();
      if (dt) body.deviceToken = dt;
      fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
        .then(function (res) {
          return res.ok
            ? res.json()
            : res.json().then(function (b) {
                throw new Error((b && b.error) || "Sign in failed");
              });
        })
        .then(function (data) {
          if (data && data.step === "2fa") {
            showTwoFactorPanel(data.email || email, data.devCode);
            return;
          }
          completeLogin(data);
          loginForm.reset();
        })
        .catch(function (e2) {
          err.textContent = e2.message || "Sign in failed";
          err.hidden = false;
        });
    });
  }

  var twoFactorForm = el("twoFactorPanel");
  if (twoFactorForm) {
    twoFactorForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var err = el("twoFactorError");
      err.hidden = true;
      var code = el("twoFactorCode").value.trim();
      var remember = el("twoFactorRemember").checked;
      fetch("/api/admin/login/2fa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: pendingTwoFactorEmail, code: code, remember: remember }),
      })
        .then(function (res) {
          return res.ok
            ? res.json()
            : res.json().then(function (b) {
                throw new Error((b && b.error) || "Verification failed");
              });
        })
        .then(function (data) {
          completeLogin(data);
          twoFactorForm.reset();
          showLoginPasswordStep();
          loginForm.reset();
        })
        .catch(function (e2) {
          err.textContent = e2.message || "Verification failed";
          err.hidden = false;
        });
    });
  }

  var logout = el("logoutBtn");
  if (logout) {
    logout.addEventListener("click", function () {
      clearToken();
      showLoginPasswordStep();
      showLogin();
    });
  }

  // My account (Admin Phase 4, TASK-197): topbar entry point, reachable by every signed-in user
  // regardless of section permissions - not a nav-link, so it isn't part of applyNavFiltering.
  bindClick("accountBtn", function () {
    selectView("account");
  });

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
    else if (name === "fulfilments") loadFulfilments();
    else if (name === "stories") loadStories();
    else if (name === "contact") loadContact();
    else if (name === "newsletter") loadNewsletters();
    else if (name === "thank-you") loadThankYou();
    else if (name === "ticker") loadTicker();
    else if (name === "audit") loadAudit();
    else if (name === "team") loadTeam();
    else if (name === "account") loadAccount();
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
        // TASK-241: one Payment pill combining payment_status + any refund (see helpers.paymentLabel).
        var pay = H.paymentLabel(d);
        return (
          "<tr><td>" + d.id + "</td><td>" + H.escapeHtml(d.donor_name) + "</td><td>" + gift +
          '</td><td class="admin-num">' + H.formatPence(d.amount_pence) + "</td><td>" +
          (d.gift_aid ? '<span class="admin-pill">Gift Aid</span>' : "") + "</td><td>" +
          H.escapeHtml(d.claim_status) + '</td><td><span class="admin-pill admin-pill--' + pay.state +
          '">' + H.escapeHtml(pay.label) + "</span></td><td>" + H.fmtDate(d.created_at) +
          '</td><td><button class="admin-link" type="button" data-donor="' + d.donor_id + '">View</button></td></tr>'
        );
      })
      .join("");
    return (
      '<table class="admin-table"><thead><tr><th>ID</th><th>Donor</th><th>Donation</th>' +
      "<th>Amount</th><th>Gift Aid</th><th>Claim</th><th>Payment</th><th>Date</th><th></th></tr></thead><tbody>" +
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
    // TASK-241: optional payment-status filter (paid/pending/failed/refunded); empty = all.
    var payFilter = el("donationsPaymentFilter");
    var pay = payFilter ? payFilter.value : "";
    authFetch("/api/admin/donations?limit=25&offset=" + donationsOffset + (pay ? "&paymentStatus=" + encodeURIComponent(pay) : ""))
      .then(j)
      .then(function (d) {
        wrap.innerHTML = donationsTable(d.results || []);
        var total = d.total || 0;
        el("donationsPager").hidden = total <= 25;
        el("donationsInfo").textContent = total
          ? donationsOffset + 1 + "-" + Math.min(donationsOffset + 25, total) + " of " + total
          : "";
        el("donationsPrev").disabled = donationsOffset <= 0;
        el("donationsNext").disabled = donationsOffset + 25 >= total;
      })
      .catch(function () {
        wrap.innerHTML = '<p class="admin-empty">Unavailable.</p>';
      });
  }
  var donationsPayFilter = el("donationsPaymentFilter");
  if (donationsPayFilter)
    donationsPayFilter.addEventListener("change", function () {
      donationsOffset = 0; // a new filter resets to the first page
      loadDonations();
    });
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

  // ---- GASDS deadline: small donations near the 2-year cliff → mark claimed (editor+) ----
  function loadGasds() {
    var canWrite = canEdit("gasds");
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
    if (!rows.length) return '<p class="admin-empty">No GASDS donations are approaching the claim deadline.</p>';
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
    if (!ids.length) { window.alert("Tick at least one donation first."); return; }
    authFetch("/api/admin/queues/gasds-deadline/mark-claimed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ donationIds: ids }),
    })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (out) {
        if (out) loadGasds();
        else window.alert("Could not mark those donations as claimed.");
      })
      .catch(function () { window.alert("Could not mark those donations as claimed."); });
  }

  // ---- claims: eligible → batch → export → submit (writes are editor+) ----
  function loadClaims() {
    var canWrite = canEdit("claims");
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
    var canWrite = canEdit("claims");
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
          wrap.innerHTML = '<p class="admin-empty">No flagged subscriptions.</p>';
          return;
        }
        var body = rows
          .map(function (s) {
            // TASK-245: a state pill that surfaces a Cancelled subscription (cancelled_at) as well as the
            // dunning statuses; the Ended column shows whichever terminal date applies.
            var st = H.subscriptionStateLabel(s);
            var ended = s.cancelled_at || s.lapsed_at;
            return (
              "<tr><td>" + s.id + "</td><td>" + H.escapeHtml(s.donor_name) +
              '</td><td><span class="admin-pill admin-pill--' + st.state + '">' + H.escapeHtml(st.label) +
              "</span></td><td>" + s.failed_attempts + "</td><td>" + H.fmtDate(ended) + "</td></tr>"
            );
          })
          .join("");
        wrap.innerHTML = '<table class="admin-table"><thead><tr><th>ID</th><th>Donor</th><th>Status</th><th>Failed</th><th>Ended</th></tr></thead><tbody>' + body + "</tbody></table>";
      })
      .catch(function () {
        wrap.innerHTML = '<p class="admin-empty">Unavailable.</p>';
      });
  }

  // ---- business supporters: fulfilment list + mark-done actions (TASK-208, over TASK-207's API) ----
  // Editor+ area (the whole tab is gated on donations:edit in the nav via data-edit-gate, matching the
  // server's authorizeSection("donations","edit") on both endpoints). Lists each business supporter's
  // fulfilment record (GET /api/admin/fulfilments), showing the recognition band, whether they have
  // submitted their thank-you preferences and a compact view of those prefs, and the five recognition
  // status flags. Each not-yet-done flag is a button that marks it done
  // (POST /api/admin/fulfilments/:id/mark) and then refetches the list — mirroring the refetch-after-
  // write pattern of the GASDS / Claims list actions (the mark is audited server-side).
  var FULFILMENT_FLAGS = [
    { key: "certificate_sent", label: "Certificate sent" },
    { key: "certificate_posted", label: "Posted" },
    { key: "badge_sent", label: "Badge sent" },
    { key: "social_done", label: "Social done" },
    { key: "added_to_supporters", label: "Added to Supporters" },
  ];
  function fulfilmentStatus(msg) {
    var s = el("fulfilmentActionStatus");
    if (s) s.textContent = msg || "";
  }
  function fulfilmentBandPill(band) {
    // band is always set on a fulfilment record (NOT NULL, set at insert); the empty fallback is
    // purely defensive.
    return band ? '<span class="admin-pill">' + H.escapeHtml(cap(band)) + "</span>" : "";
  }
  function fulfilmentBusinessCell(r) {
    var primary = r.business_name || r.donor_name || "Donor " + r.donor_id;
    var out = '<span class="admin-fulfil-biz">' + H.escapeHtml(primary) + "</span>";
    if (r.business_name && r.donor_name && r.donor_name !== r.business_name) {
      out += '<span class="admin-fulfil-sub">' + H.escapeHtml(r.donor_name) + "</span>";
    }
    return out;
  }
  function fulfilmentPrefsCell(r) {
    if (!r.captured_at) return '<span class="admin-pill is-internal">Awaiting preferences</span>';
    var wants = [];
    if (r.list_on_supporters) wants.push("Listing");
    if (r.want_social) wants.push("Social");
    if (r.want_badge) wants.push("Badge");
    if (r.want_certificate) {
      wants.push("Certificate" + (r.certificate_delivery ? " (" + cap(r.certificate_delivery) + ")" : ""));
    }
    var pills = wants.length
      ? wants
          .map(function (w) {
            return '<span class="admin-pill">' + H.escapeHtml(w) + "</span>";
          })
          .join(" ")
      : '<span class="admin-fulfil-sub">No extras requested</span>';
    var credit = r.credit_name
      ? '<span class="admin-fulfil-credit">Credit as: ' + H.escapeHtml(r.credit_name) + "</span>"
      : "";
    return (
      '<div class="admin-fulfil-prefs"><span class="admin-pill is-replied">Submitted ' + H.fmtDate(r.captured_at) +
      "</span>" + credit + '<span class="admin-fulfil-wants">' + pills + "</span></div>"
    );
  }
  function fulfilmentFlagsCell(r) {
    var canWrite = canEdit("donations");
    var items = FULFILMENT_FLAGS.map(function (f) {
      if (r[f.key]) return '<span class="admin-pill is-replied" title="Done">' + f.label + "</span>";
      if (!canWrite) return '<span class="admin-pill is-internal" title="Not done">' + f.label + "</span>";
      return (
        '<button class="admin-link" type="button" data-fulfil-id="' + r.id + '" data-fulfil-mark="' + f.key +
        '" title="Mark as done" aria-label="Mark done: ' + f.label + '">' + f.label + "</button>"
      );
    }).join(" ");
    return '<div class="admin-fulfil-flags">' + items + "</div>";
  }
  function fulfilmentsTable(rows) {
    if (!rows.length) return '<p class="admin-empty">No business supporters yet.</p>';
    var body = rows
      .map(function (r) {
        return (
          "<tr><td>" + fulfilmentBusinessCell(r) + "</td><td>" + fulfilmentBandPill(r.band) + "</td><td>" +
          fulfilmentPrefsCell(r) + "</td><td>" + fulfilmentFlagsCell(r) + "</td></tr>"
        );
      })
      .join("");
    return (
      '<table class="admin-table"><thead><tr><th>Business</th><th>Band</th><th>Preferences</th>' +
      "<th>Fulfilment</th></tr></thead><tbody>" + body + "</tbody></table>"
    );
  }
  function loadFulfilments() {
    var wrap = el("fulfilmentsTable");
    if (!wrap) return;
    fulfilmentStatus("");
    wrap.innerHTML = '<p class="admin-loading">Loading…</p>';
    authFetch("/api/admin/fulfilments")
      .then(j)
      .then(function (d) {
        wrap.innerHTML = fulfilmentsTable(d.results || []);
      })
      .catch(function () {
        wrap.innerHTML = '<p class="admin-empty">Business supporters are unavailable.</p>';
      });
  }
  function markFulfilment(id, flag) {
    fulfilmentStatus("");
    authFetch("/api/admin/fulfilments/" + id + "/mark", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ flag: flag }),
    })
      .then(function (res) {
        return res.ok ? res.json() : null;
      })
      .then(function (out) {
        if (out) loadFulfilments();
        else fulfilmentStatus("Could not update that supporter. Please try again.");
      })
      .catch(function () {
        fulfilmentStatus("Could not update that supporter. Please try again.");
      });
  }
  // ---- catch up invites (TASK-214): email the thank-you invite to supporters who never got it ----
  // One click POSTs the backfill endpoint (server-side Editor+), then shows how many went out. Safe to
  // click again: the server only emails supporters who have not been invited yet, so a repeat run
  // reports "Sent 0". Refetches the list afterwards, mirroring the mark-done refetch pattern above.
  function backfillStatus(msg) {
    var s = el("backfillInvitesStatus");
    if (s) s.textContent = msg || "";
  }
  function backfillInvites() {
    var btn = el("backfillInvitesBtn");
    if (btn) btn.disabled = true;
    backfillStatus("Sending…");
    authFetch("/api/admin/business-supporters/backfill-invites", { method: "POST" })
      .then(function (res) {
        return res.ok ? res.json() : null;
      })
      .then(function (out) {
        if (!out) {
          backfillStatus("Could not send the invites. Please try again.");
        } else if (!out.pending) {
          backfillStatus("No supporters were waiting for an invite.");
        } else {
          backfillStatus("Sent " + (out.sent || 0) + ", failed " + (out.failed || 0) + ".");
        }
        loadFulfilments();
      })
      .catch(function () {
        backfillStatus("Could not send the invites. Please try again.");
      })
      .then(function () {
        if (btn) btn.disabled = false;
      });
  }
  bindClick("backfillInvitesBtn", backfillInvites);

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
    var scopeClass = r.use_scope === "public" ? "is-public" : "is-internal";
    var badges = '<span class="admin-pill ' + scopeClass + '">' + H.escapeHtml(H.storyLabel("useScope", r.use_scope)) + "</span>";
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
    var canWrite = canEdit("stories");
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

  // ---- contact form (2026-07-10 spec): list + filter, detail, reply-in-Gmail/mark-new/delete
  // (editor+). Reads/writes go to the isolated contact DB via /api/admin/contact*. Mirrors the
  // Stories view controller above (loadStories/storiesTable/openStory/renderStory).
  Array.prototype.forEach.call(doc.querySelectorAll("#contactStatusFilter .admin-seg"), function (b) {
    b.addEventListener("click", function () {
      contactStatusFilter = b.getAttribute("data-status") || "";
      Array.prototype.forEach.call(doc.querySelectorAll("#contactStatusFilter .admin-seg"), function (x) {
        x.classList.toggle("is-active", x === b);
      });
      loadContact();
    });
  });
  function contactSnippet(message) {
    var s = String(message || "");
    return s.length > 80 ? s.slice(0, 80) + "…" : s;
  }
  function contactStatusBadge(status) {
    return status === "replied"
      ? '<span class="admin-pill is-replied">Replied</span>'
      : '<span class="admin-pill is-new">New</span>';
  }
  function contactTable(rows) {
    if (!rows.length) return '<p class="admin-empty">No enquiries yet.</p>';
    var body = rows
      .map(function (r) {
        return (
          "<tr><td>" + window.formatReceived(r.created_at) + "</td><td>" +
          H.escapeHtml(((r.first_name || "") + " " + (r.last_name || "")).trim()) + "</td><td>" +
          H.escapeHtml(r.email) + "</td><td>" + contactStatusBadge(r.status) + "</td><td>" +
          H.escapeHtml(contactSnippet(r.message)) +
          '</td><td><button class="admin-link" type="button" data-contact="' + r.id + '">View</button></td></tr>'
        );
      })
      .join("");
    return (
      '<table class="admin-table"><thead><tr><th>Received</th><th>Name</th><th>Email</th>' +
      "<th>Status</th><th>Message</th><th></th></tr></thead><tbody>" +
      body + "</tbody></table>"
    );
  }
  function loadContact() {
    var wrap = el("contactTable");
    wrap.innerHTML = '<p class="admin-loading">Loading…</p>';
    var path = "/api/admin/contact" + (contactStatusFilter ? "?status=" + encodeURIComponent(contactStatusFilter) : "");
    authFetch(path)
      .then(j)
      .then(function (d) {
        wrap.innerHTML = contactTable(d.results || []);
      })
      .catch(function () {
        wrap.innerHTML = '<p class="admin-empty">Unavailable.</p>';
      });
  }
  function contactStatus(msg) {
    el("contactActionStatus").textContent = msg || "";
  }
  function openContact(id) {
    currentContactId = id;
    showOnly("view-contact-detail");
    Array.prototype.forEach.call(doc.querySelectorAll(".admin-nav-link"), function (b) {
      b.classList.remove("is-active");
    });
    contactStatus("");
    var wrap = el("contactDetail");
    wrap.innerHTML = '<p class="admin-loading">Loading…</p>';
    authFetch("/api/admin/contact/" + id)
      .then(function (res) {
        if (res.status === 404) {
          wrap.innerHTML = '<p class="admin-empty">Enquiry not found.</p>';
          throw new Error("not found");
        }
        return res.json();
      })
      .then(renderContact)
      .catch(function () {});
  }
  function renderContact(c) {
    var canWrite = canEdit("contact");
    var info =
      '<dl class="admin-dl">' +
      dl("Name", ((c.first_name || "") + " " + (c.last_name || "")).trim()) +
      dl("Email", c.email) +
      dl("Received", window.formatReceived(c.created_at)) +
      dl("Status", c.status === "replied" ? "Replied" : "New") +
      (c.status === "replied"
        ? dl("Replied by", (c.replied_by || "") + " · " + window.formatReceived(c.replied_at))
        : "") +
      "</dl>" +
      '<h3 class="admin-subhead">Message</h3><p class="admin-story-text">' + H.escapeHtml(c.message || "") + "</p>";
    var actions = "";
    if (canWrite) {
      actions =
        '<div class="admin-donor-actions">' +
        '<button class="btn btn-primary" type="button" id="contactReplyBtn">Reply in Gmail</button> ' +
        (c.status === "replied"
          ? '<button class="btn btn-ghost" type="button" id="contactMarkNewBtn">Mark as new</button> '
          : '<button class="btn btn-ghost" type="button" id="contactMarkRepliedBtn">Mark as replied</button> ') +
        '<button class="btn btn-danger" type="button" id="contactDeleteBtn">Delete</button>' +
        "</div>";
    }
    el("contactDetail").innerHTML = info + actions;
    if (canWrite) wireContactActions(c);
  }
  function patchContact(body, okMsg, errMsg) {
    return authFetch("/api/admin/contact/" + currentContactId, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then(function (res) {
        return res.ok ? res.json() : null;
      })
      .then(function (updated) {
        if (updated) {
          renderContact(updated);
          contactStatus(okMsg);
        } else contactStatus(errMsg);
      })
      .catch(function () {
        contactStatus(errMsg);
      });
  }
  function wireContactActions(c) {
    bindClick("contactReplyBtn", function () {
      // Opening a Gmail draft is not the same as having replied, so this only opens
      // the draft. The user records it via the Mark as replied button (which stamps
      // who replied and when).
      window.open(window.buildGmailReplyUrl(c), "_blank", "noopener");
    });
    bindClick("contactMarkRepliedBtn", function () {
      patchContact({ status: "replied" }, "Marked as replied", "Could not mark the enquiry as replied.");
    });
    bindClick("contactMarkNewBtn", function () {
      patchContact({ status: "new" }, "Marked as new", "Could not mark the enquiry as new.");
    });
    bindClick("contactDeleteBtn", deleteContact);
  }
  function deleteContact() {
    if (!window.confirm("Delete this enquiry? This cannot be undone.")) return;
    authFetch("/api/admin/contact/" + currentContactId, { method: "DELETE" })
      .then(function (res) {
        if (res.ok) {
          selectView("contact");
        } else {
          contactStatus("Could not delete the enquiry.");
        }
      })
      .catch(function () {
        contactStatus("Could not delete the enquiry.");
      });
  }
  bindClick("contactBack", function () {
    selectView("contact");
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

  // ---- team (admin-management Phase 1, Task 8; per-section matrix Admin Phase 2, Task 6) ----
  // Who can sign in to this dashboard: invite, change role, disable/enable, or remove; and manage
  // each person's per-section view/edit matrix (teamPerm* below). The whole surface
  // (GET/POST/PATCH/DELETE /api/admin/users*) requires team:edit on the server, so every write
  // control here is also gated behind canEdit("team") - a person without it never reaches this view
  // at all (applyNavFiltering hides the nav entry), but the gating stays defence in depth.
  var teamWired = false;
  function teamStatus(msg, cls) {
    var s = el("teamStatus");
    if (!s) return;
    s.className = "ty-status" + (cls ? " " + cls : "");
    s.textContent = msg || "";
  }
  function teamStatusPill(status) {
    if (status === "active") return '<span class="ty-pill ty-pill-ready">Active</span>';
    if (status === "disabled") return '<span class="ty-pill ty-pill-blocked">Disabled</span>';
    return '<span class="ty-pill ty-pill-thanked">Invited</span>';
  }
  var TEAM_ROLES = ["viewer", "editor", "admin"];
  function teamRoleCell(u, canWrite) {
    if (!canWrite) return H.escapeHtml(cap(u.role));
    var opts = TEAM_ROLES.map(function (r) {
      return '<option value="' + r + '"' + (r === u.role ? " selected" : "") + ">" + cap(r) + "</option>";
    }).join("");
    return '<select data-team-role="' + u.id + '" aria-label="Role for ' + H.escapeHtml(u.email) + '">' + opts + "</select>";
  }
  function teamActionsCell(u, canWrite) {
    if (!canWrite) return "";
    var toggle =
      u.status === "disabled"
        ? '<button class="admin-link" type="button" data-team-enable="' + u.id + '">Enable</button>'
        : '<button class="admin-link" type="button" data-team-disable="' + u.id + '">Disable</button>';
    return (
      '<button class="admin-link" type="button" data-team-perms="' + u.id + '">Manage access</button> · ' +
      '<button class="admin-link" type="button" data-team-reset="' + u.id + '">Reset password</button> · ' +
      toggle +
      " · " +
      '<button class="admin-link ty-del" type="button" data-team-remove="' + u.id + '" data-team-email="' +
      H.escapeHtml(u.email) + '">Remove</button>'
    );
  }
  function teamTable(rows, canWrite) {
    if (!rows.length) return '<p class="admin-empty">No team members yet. Invite one above.</p>';
    var body = rows
      .map(function (u) {
        return (
          "<tr><td>" + H.escapeHtml(u.full_name) + "</td><td>" + H.escapeHtml(u.email) + "</td><td>" +
          teamRoleCell(u, canWrite) + "</td><td>" + teamStatusPill(u.status) + "</td><td>" +
          (H.fmtDate(u.last_login_at) || "Never") + "</td><td>" + teamActionsCell(u, canWrite) + "</td></tr>"
        );
      })
      .join("");
    return (
      '<table class="admin-table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th>' +
      "<th>Last login</th><th></th></tr></thead><tbody>" + body + "</tbody></table>"
    );
  }
  function loadTeam() {
    teamWire();
    teamPermWire();
    var canWrite = canEdit("team");
    var form = el("teamInviteForm");
    if (form) form.hidden = !canWrite;
    el("teamTable").innerHTML = '<p class="admin-loading">Loading…</p>';
    authFetch("/api/admin/users")
      .then(j)
      .then(function (d) {
        teamRows = d.results || [];
        el("teamTable").innerHTML = teamTable(teamRows, canWrite);
      })
      .catch(function () {
        el("teamTable").innerHTML = '<p class="admin-empty">Could not load the team.</p>';
      });
  }
  function teamLastAdminMessage() {
    return "That is the last admin. Promote someone else first.";
  }
  function teamWire() {
    if (teamWired) return;
    teamWired = true;
    var form = el("teamInviteForm");
    if (form) {
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var email = (el("teamInviteEmail").value || "").trim();
        var fullName = (el("teamInviteName").value || "").trim();
        var role = el("teamInviteRole").value;
        if (!email || !fullName) return;
        teamStatus("Inviting…");
        authFetch("/api/admin/users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email, fullName: fullName, role: role }),
        })
          .then(function (res) {
            return res.ok
              ? res.json()
              : res.json().then(function (b) {
                  throw new Error((b && b.error) || "Invite failed");
                });
          })
          .then(function () {
            el("teamInviteEmail").value = "";
            el("teamInviteName").value = "";
            teamStatus("Invited. They will get an email with a link to set a password.", "is-ok");
            loadTeam();
          })
          .catch(function (e2) {
            teamStatus(e2.message || "Could not send that invite.", "is-error");
          });
      });
    }

    var table = el("teamTable");
    if (!table) return;
    table.addEventListener("change", function (e) {
      var t = e.target;
      if (!t || !t.matches || !t.matches("[data-team-role]")) return;
      var id = t.getAttribute("data-team-role");
      authFetch("/api/admin/users/" + id, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: t.value }),
      })
        .then(function (res) {
          if (res.status === 409) {
            teamStatus(teamLastAdminMessage(), "is-error");
            loadTeam();
            return;
          }
          if (!res.ok) {
            teamStatus("Could not change that role.", "is-error");
            loadTeam();
            return;
          }
          teamStatus("Role updated.", "is-ok");
          loadTeam();
        })
        .catch(function () {
          teamStatus("Could not change that role.", "is-error");
        });
    });
    table.addEventListener("click", function (e) {
      var t = e.target;
      if (!t || !t.closest) return;

      var manage = t.closest("[data-team-perms]");
      if (manage) {
        openTeamPermissions(Number(manage.getAttribute("data-team-perms")));
        return;
      }
      var reset = t.closest("[data-team-reset]");
      if (reset) {
        authFetch("/api/admin/users/" + reset.getAttribute("data-team-reset") + "/reset", { method: "POST" })
          .then(function (res) {
            teamStatus(res.ok ? "Password reset email sent." : "Could not send the reset email.", res.ok ? "is-ok" : "is-error");
          })
          .catch(function () {
            teamStatus("Could not send the reset email.", "is-error");
          });
        return;
      }
      var disable = t.closest("[data-team-disable]");
      if (disable) {
        authFetch("/api/admin/users/" + disable.getAttribute("data-team-disable"), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "disabled" }),
        })
          .then(function (res) {
            if (res.status === 409) {
              teamStatus(teamLastAdminMessage(), "is-error");
              return;
            }
            if (!res.ok) {
              teamStatus("Could not disable that person.", "is-error");
              return;
            }
            teamStatus("Disabled.", "is-ok");
            loadTeam();
          })
          .catch(function () {
            teamStatus("Could not disable that person.", "is-error");
          });
        return;
      }
      var enable = t.closest("[data-team-enable]");
      if (enable) {
        authFetch("/api/admin/users/" + enable.getAttribute("data-team-enable"), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "active" }),
        })
          .then(function (res) {
            if (!res.ok) {
              teamStatus("Could not enable that person.", "is-error");
              return;
            }
            teamStatus("Enabled.", "is-ok");
            loadTeam();
          })
          .catch(function () {
            teamStatus("Could not enable that person.", "is-error");
          });
        return;
      }
      var remove = t.closest("[data-team-remove]");
      if (remove) {
        var name = remove.getAttribute("data-team-email") || "this person";
        if (!window.confirm('Remove "' + name + '" from the team? This cannot be undone.')) return;
        authFetch("/api/admin/users/" + remove.getAttribute("data-team-remove"), { method: "DELETE" })
          .then(function (res) {
            if (res.status === 409) {
              teamStatus(teamLastAdminMessage(), "is-error");
              return;
            }
            if (!res.ok) {
              teamStatus("Could not remove that person.", "is-error");
              return;
            }
            teamStatus("Removed.", "is-ok");
            loadTeam();
          })
          .catch(function () {
            teamStatus("Could not remove that person.", "is-error");
          });
        return;
      }
    });
  }

  // ---- team access matrix (Admin Phase 2 · TASK-186) ----
  // The 13-section none/view/edit grid for one team member, reached via "Manage access" on a Team
  // row (gated to team:edit - see teamActionsCell). Mirrors the Story/Contact/Donor detail pattern
  // (its own admin-view + Back button + aria-live container) rather than an inline expander, since
  // the matrix is 13 rows and would make the Team table unreadably tall inline.
  var teamPermWorking = {}; // the matrix being edited for currentTeamPermUserId
  function sectionLabel(section) {
    // Reuse the nav link's own text (e.g. "GASDS", "Partners" for ticker, "Thank you" for
    // thank-you) rather than duplicating labels that could drift out of sync with the nav.
    var btn = doc.querySelector('.admin-nav-link[data-view="' + section + '"]');
    return btn ? btn.textContent : cap(section);
  }
  function teamPermMatrixHtml(perms) {
    return SECTIONS.map(function (section) {
      var level = perms[section] || "none";
      var seg = ["none", "view", "edit"]
        .map(function (lvl) {
          return (
            '<button class="admin-seg' + (level === lvl ? " is-active" : "") + '" type="button" data-perm-level="' +
            lvl + '">' + cap(lvl) + "</button>"
          );
        })
        .join("");
      return (
        '<div class="admin-perm-row"><span class="admin-perm-label">' + H.escapeHtml(sectionLabel(section)) + "</span>" +
        '<div class="admin-segmented" role="group" aria-label="' + H.escapeHtml(sectionLabel(section)) +
        ' access" data-perm-section="' + section + '">' + seg + "</div></div>"
      );
    }).join("");
  }
  function renderTeamPermMatrix(u) {
    el("teamPermDetail").innerHTML =
      '<p class="admin-view-intro">' + H.escapeHtml(u.full_name) + " (" + H.escapeHtml(u.email) + "). Role: " +
      H.escapeHtml(cap(u.role)) + "</p>" +
      '<div class="admin-perm-presets">' +
      '<button class="btn btn-ghost" type="button" data-perm-preset="viewer">Viewer</button>' +
      '<button class="btn btn-ghost" type="button" data-perm-preset="editor">Editor</button>' +
      '<button class="btn btn-ghost" type="button" data-perm-preset="admin">Admin</button>' +
      "</div>" +
      '<div id="teamPermMatrix">' + teamPermMatrixHtml(teamPermWorking) + "</div>" +
      '<button class="btn btn-primary" type="button" id="teamPermSave" style="margin-top:16px">Save access</button>';
  }
  function openTeamPermissions(id) {
    var u = teamRows.filter(function (r) { return r.id === id; })[0];
    if (!u) return;
    currentTeamPermUserId = id;
    teamPermWorking = Object.assign({}, effectiveTeamPermissions(u));
    // A stored map is always the full 13-section shape (the PATCH schema requires it), but fill any
    // gap defensively so the matrix always renders all 13 rows.
    SECTIONS.forEach(function (s) {
      if (!teamPermWorking[s]) teamPermWorking[s] = "none";
    });
    showOnly("view-team-permissions");
    Array.prototype.forEach.call(doc.querySelectorAll(".admin-nav-link"), function (b) {
      b.classList.remove("is-active");
    });
    el("teamPermStatus").textContent = "";
    renderTeamPermMatrix(u);
  }
  bindClick("teamPermBack", function () {
    selectView("team");
  });
  function saveTeamPermissions() {
    if (currentTeamPermUserId == null) return;
    el("teamPermStatus").textContent = "Saving…";
    authFetch("/api/admin/users/" + currentTeamPermUserId + "/permissions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ permissions: teamPermWorking }),
    })
      .then(function (res) {
        if (res.status === 409) {
          el("teamPermStatus").textContent = teamLastAdminMessage();
          return null;
        }
        if (!res.ok) {
          el("teamPermStatus").textContent = "Could not save that access.";
          return null;
        }
        return res.json();
      })
      .then(function (updated) {
        if (!updated) return;
        teamRows = teamRows.map(function (r) {
          return r.id === updated.id ? updated : r;
        });
        el("teamPermStatus").textContent = "Access updated.";
      })
      .catch(function () {
        el("teamPermStatus").textContent = "Could not save that access.";
      });
  }
  var teamPermWired = false;
  function teamPermWire() {
    if (teamPermWired) return;
    teamPermWired = true;
    var detail = el("teamPermDetail");
    if (!detail) return;
    detail.addEventListener("click", function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var levelBtn = t.closest("[data-perm-level]");
      if (levelBtn) {
        var group = levelBtn.closest("[data-perm-section]");
        if (!group) return;
        teamPermWorking[group.getAttribute("data-perm-section")] = levelBtn.getAttribute("data-perm-level");
        el("teamPermMatrix").innerHTML = teamPermMatrixHtml(teamPermWorking);
        return;
      }
      var presetBtn = t.closest("[data-perm-preset]");
      if (presetBtn) {
        teamPermWorking = rolePresetPermissions(presetBtn.getAttribute("data-perm-preset"));
        el("teamPermMatrix").innerHTML = teamPermMatrixHtml(teamPermWorking);
        return;
      }
      if (t.closest("#teamPermSave")) {
        saveTeamPermissions();
      }
    });
  }

  // ---- newsletter ----

  // Text size step range + the block types that never take one (TASK-248). MUST match NO_SIZE_STEP in
  // src/newsletter/blocks.ts, which is the authority: the server ignores a step on these, so a drift
  // here only ever shows a dead button, never a wrong render. rawHtml is the author's own HTML;
  // masthead is the brand signature (its variants already span 16→26px); divider/image carry no text.
  var NL_SIZE_MIN = -2;
  var NL_SIZE_MAX = 2;
  var NL_NO_SIZE = ["rawHtml", "masthead", "divider", "image"];
  function nlCanSize(block) {
    return NL_NO_SIZE.indexOf(block.type) === -1;
  }

  // Block builder model (TASK-168). Each def: label, default data, and how many of the 4 variants
  // are meaningful (all 4 unless noted). The renderer server-side owns the visual variants; the UI
  // just carries type/variant/data.
  // Each block def carries: label, a line icon, default data, and a `variants` array. Every variant
  // names the style the admin is choosing (not "Style 1"), a one-line hint describing it, and the
  // EXACT set of fields that variant actually renders — so the field editor only shows inputs that
  // will appear in the email (progressive disclosure). This is the source of truth that keeps the
  // builder's fields in lock-step with the server renderer in src/newsletter/blocks.ts; a field the
  // chosen variant ignores is never shown, so "I typed it but it didn't show" can't happen.
  // A list-shaped variant uses `items:{fields, firstOnly?, note?}` instead of `fields`.
  var TXT = { k: "text", label: "Text", kind: "textarea", hint: "Use {{firstName}} to personalise" };
  var nlBlockDefs = {
    masthead: {
      label: "Masthead", icon: "masthead",
      data: { issueTitle: "July Newsletter" },
      variants: [
        { name: "Centered", hint: "Logo and title centred, with an optional hero below.",
          fields: [{ k: "issueTitle", label: "Issue title" }, { k: "heroUrl", label: "Hero image", kind: "image" }] },
        { name: "Logo + title", hint: "Logo left; title and date on the right.",
          fields: [{ k: "issueTitle", label: "Issue title" }, { k: "date", label: "Date", hint: "e.g. July 2026" }] },
        { name: "Hero banner", hint: "Title sits over a full-width hero image.",
          fields: [{ k: "issueTitle", label: "Issue title" }, { k: "heroUrl", label: "Hero image", kind: "image" }] },
        { name: "Slim strip", hint: "Compact small logo and title on one line.",
          fields: [{ k: "issueTitle", label: "Issue title" }] },
      ],
    },
    // TASK-251: the letter-style close a newsletter ends on. The NAME is signed in NBCC's own hand —
    // the same script stack the thank-you email signs with (imported server-side, never copied) — and
    // is picked from AdminHelpers.SIGNERS, the same list the thank-you letter's signer picker uses.
    // The role line is free text because a newsletter signs off "On behalf of everyone at NBCC"
    // rather than with a formal job title.
    signoff: {
      label: "Sign-off", icon: "signoff",
      data: {
        closing: "With love and gratitude,",
        name: (H.SIGNERS && H.SIGNERS[0] && H.SIGNERS[0].name) || "",
        role: "On behalf of everyone at NBCC",
        email: "info@nbcc.scot",
      },
      variants: [
        { name: "Left", hint: "Signed off against the left margin, like a letter.",
          fields: [
            { k: "closing", label: "Closing line" },
            { k: "name", label: "Signed by", kind: "signer", hint: "Signed in NBCC's hand, as on the thank-you emails." },
            { k: "role", label: "Line under the name" },
            { k: "email", label: "Contact email", hint: "Left blank, no email line is shown." },
          ] },
        { name: "Centred", hint: "The same sign-off, centred under the newsletter.",
          fields: [
            { k: "closing", label: "Closing line" },
            { k: "name", label: "Signed by", kind: "signer", hint: "Signed in NBCC's hand, as on the thank-you emails." },
            { k: "role", label: "Line under the name" },
            { k: "email", label: "Contact email", hint: "Left blank, no email line is shown." },
          ] },
      ],
    },
    greeting: {
      label: "Greeting", icon: "greeting",
      data: { heading: "", lead: "" },
      variants: [
        { name: "Dear …", hint: "Personalised automatically as “Dear {{firstName}},”.", fields: [] },
        { name: "With intro", hint: "The greeting plus a short intro paragraph.",
          fields: [{ k: "lead", label: "Intro paragraph", kind: "textarea" }] },
        { name: "With heading", hint: "A heading above the greeting line.",
          fields: [{ k: "heading", label: "Heading" }] },
        { name: "Casual", hint: "Personalised automatically as “Hi {{firstName}} 👋”.", fields: [] },
      ],
    },
    text: {
      label: "Text", icon: "text",
      data: { text: "Your text here." },
      variants: [
        { name: "Paragraph", hint: "A standard body paragraph.", fields: [TXT] },
        { name: "Lead", hint: "A larger opening paragraph.", fields: [TXT] },
        { name: "Pull-quote", hint: "Centred italic serif quote.", fields: [TXT] },
        { name: "Callout", hint: "Tinted box with an accent bar.", fields: [TXT] },
      ],
    },
    heading: {
      label: "Heading", icon: "heading",
      data: { kicker: "", title: "Section title" },
      variants: [
        { name: "Centered", hint: "Crimson serif title, centred.", fields: [{ k: "title", label: "Title" }] },
        { name: "With kicker", hint: "A small kicker line above the title.",
          fields: [{ k: "kicker", label: "Kicker" }, { k: "title", label: "Title" }] },
        { name: "Maroon band", hint: "Title on a full-width maroon band.", fields: [{ k: "title", label: "Title" }] },
        { name: "Eyebrow", hint: "Small uppercase label only.", fields: [{ k: "title", label: "Title" }] },
      ],
    },
    image: {
      label: "Image", icon: "image",
      data: { url: "", alt: "", caption: "" },
      variants: [
        { name: "Full width", hint: "Edge-to-edge image.",
          fields: [{ k: "url", label: "Image", kind: "image" }, { k: "alt", label: "Alt text", hint: "Describes the image for screen readers" }] },
        { name: "Rounded", hint: "Full width with rounded corners.",
          fields: [{ k: "url", label: "Image", kind: "image" }, { k: "alt", label: "Alt text", hint: "Describes the image for screen readers" }] },
        { name: "With caption", hint: "Image with a caption underneath.",
          fields: [{ k: "url", label: "Image", kind: "image" }, { k: "alt", label: "Alt text", hint: "Describes the image for screen readers" }, { k: "caption", label: "Caption" }] },
        { name: "Framed", hint: "Thin border around the image.",
          fields: [{ k: "url", label: "Image", kind: "image" }, { k: "alt", label: "Alt text", hint: "Describes the image for screen readers" }] },
      ],
    },
    story: {
      label: "Story", icon: "story",
      data: { imageUrl: "", title: "Story title", body: "Story text.", label: "Read more", href: "" },
      variants: [
        { name: "Image top", hint: "Image above the title and body.",
          fields: [{ k: "imageUrl", label: "Image", kind: "image" }, { k: "title", label: "Title" }, { k: "body", label: "Body", kind: "textarea" }, { k: "label", label: "Link label" }, { k: "href", label: "Link", kind: "url" }] },
        { name: "Image left", hint: "Image on the left, text on the right.",
          fields: [{ k: "imageUrl", label: "Image", kind: "image" }, { k: "title", label: "Title" }, { k: "body", label: "Body", kind: "textarea" }, { k: "label", label: "Link label" }, { k: "href", label: "Link", kind: "url" }] },
        { name: "Two-up cards", hint: "Two (or more) stories side by side.",
          items: { fields: [{ k: "imageUrl", label: "Image" }, { k: "title", label: "Title" }, { k: "body", label: "Body" }, { k: "label", label: "Link label" }, { k: "href", label: "Link" }] } },
        { name: "Text only", hint: "No image; a top rule then title and body.",
          fields: [{ k: "title", label: "Title" }, { k: "body", label: "Body", kind: "textarea" }, { k: "label", label: "Link label" }, { k: "href", label: "Link", kind: "url" }] },
      ],
    },
    spotlight: {
      label: "Spotlight", icon: "spotlight",
      data: { photoUrl: "", name: "Name", quote: "Quote", role: "" },
      variants: [
        { name: "Photo left", hint: "Photo on the left, quote on the right.",
          fields: [{ k: "photoUrl", label: "Photo", kind: "image" }, { k: "name", label: "Name" }, { k: "quote", label: "Quote", kind: "textarea" }, { k: "role", label: "Role" }] },
        { name: "Avatar centered", hint: "Round avatar above a centred quote.",
          fields: [{ k: "photoUrl", label: "Photo", kind: "image" }, { k: "name", label: "Name" }, { k: "quote", label: "Quote", kind: "textarea" }, { k: "role", label: "Role" }] },
        { name: "Big quote", hint: "Large quote with attribution, no photo.",
          fields: [{ k: "name", label: "Name" }, { k: "quote", label: "Quote", kind: "textarea" }, { k: "role", label: "Role" }] },
        { name: "Tinted card", hint: "Photo and quote inside a tinted card.",
          fields: [{ k: "photoUrl", label: "Photo", kind: "image" }, { k: "name", label: "Name" }, { k: "quote", label: "Quote", kind: "textarea" }, { k: "role", label: "Role" }] },
      ],
    },
    stats: {
      label: "Impact stats", icon: "stats",
      data: { items: [{ number: "7,657", label: "Red Bags delivered" }] },
      variants: [
        { name: "One big number", hint: "A single large figure.",
          items: { firstOnly: true, note: "Only the first figure is shown in this style.", fields: [{ k: "number", label: "Number" }, { k: "label", label: "Label" }] } },
        { name: "Three across", hint: "Every figure in a row.",
          items: { fields: [{ k: "number", label: "Number" }, { k: "label", label: "Label" }] } },
        { name: "Number + caption", hint: "One figure with a caption line.",
          items: { firstOnly: true, note: "Only the first figure is shown in this style.", fields: [{ k: "number", label: "Number" }, { k: "label", label: "Label" }, { k: "caption", label: "Caption" }] } },
        { name: "Inline pills", hint: "Every figure as a tinted pill.",
          items: { fields: [{ k: "number", label: "Number" }, { k: "label", label: "Label" }] } },
      ],
    },
    waysToHelp: {
      label: "Ways to help", icon: "waysToHelp",
      data: { items: [{ icon: "🎁", title: "Donate", body: "", label: "Donate", href: "https://nbcc.scot/donate" }] },
      variants: [
        { name: "Three columns", hint: "Icon columns side by side.",
          items: { fields: [{ k: "icon", label: "Icon", hint: "An emoji, e.g. 🎁" }, { k: "title", label: "Title" }, { k: "body", label: "Body" }, { k: "label", label: "Button label" }, { k: "href", label: "Button link" }] } },
        { name: "Stacked list", hint: "Each way stacked vertically.",
          items: { fields: [{ k: "icon", label: "Icon", hint: "An emoji, e.g. 🎁" }, { k: "title", label: "Title" }, { k: "body", label: "Body" }, { k: "label", label: "Button label" }, { k: "href", label: "Button link" }] } },
        { name: "Two-up", hint: "A two-column grid.",
          items: { fields: [{ k: "icon", label: "Icon", hint: "An emoji, e.g. 🎁" }, { k: "title", label: "Title" }, { k: "body", label: "Body" }, { k: "label", label: "Button label" }, { k: "href", label: "Button link" }] } },
        { name: "Single CTA", hint: "One button only.",
          items: { firstOnly: true, note: "Only the first item is used, as a single button.", fields: [{ k: "label", label: "Button label" }, { k: "href", label: "Button link" }] } },
      ],
    },
    events: {
      label: "Events", icon: "events",
      data: { items: [{ day: "15", month: "JUL", name: "Event name", location: "", label: "Register", href: "" }] },
      variants: [
        { name: "Date badges", hint: "Date badge beside each event.",
          items: { fields: [{ k: "day", label: "Day" }, { k: "month", label: "Month" }, { k: "name", label: "Name" }, { k: "location", label: "Location" }, { k: "label", label: "Button label" }, { k: "href", label: "Button link" }] } },
        { name: "Simple list", hint: "Date and name inline, no button.",
          items: { fields: [{ k: "day", label: "Day" }, { k: "month", label: "Month" }, { k: "name", label: "Name" }] } },
        { name: "Cards", hint: "Each event in its own card.",
          items: { fields: [{ k: "day", label: "Day" }, { k: "month", label: "Month" }, { k: "name", label: "Name" }, { k: "location", label: "Location" }, { k: "label", label: "Button label" }, { k: "href", label: "Button link" }] } },
        { name: "Featured", hint: "One event, shown large.",
          items: { firstOnly: true, note: "Only the first event is shown in this style.", fields: [{ k: "day", label: "Day" }, { k: "month", label: "Month" }, { k: "name", label: "Name" }, { k: "location", label: "Location" }, { k: "label", label: "Button label" }, { k: "href", label: "Button link" }] } },
      ],
    },
    donationCta: {
      label: "Donation CTA", icon: "donationCta",
      data: { imageUrl: "", heading: "Support our work", label: "Make a donation today", href: "https://nbcc.scot/donate" },
      variants: [
        { name: "Image + CTA", hint: "Image, heading and button, centred.",
          fields: [{ k: "imageUrl", label: "Image", kind: "image" }, { k: "heading", label: "Heading" }, { k: "label", label: "Button label" }, { k: "href", label: "Button link", kind: "url" }] },
        { name: "Tinted band", hint: "Heading and button on a tinted band.",
          fields: [{ k: "heading", label: "Heading" }, { k: "label", label: "Button label" }, { k: "href", label: "Button link", kind: "url" }] },
        { name: "Split", hint: "Heading left, button right.",
          fields: [{ k: "heading", label: "Heading" }, { k: "label", label: "Button label" }, { k: "href", label: "Button link", kind: "url" }] },
        { name: "Centered", hint: "Heading and button, centred.",
          fields: [{ k: "heading", label: "Heading" }, { k: "label", label: "Button label" }, { k: "href", label: "Button link", kind: "url" }] },
      ],
    },
    button: {
      label: "Button", icon: "button",
      data: { label: "Learn more", href: "" },
      variants: [
        { name: "Primary", hint: "Solid crimson button.", fields: [{ k: "label", label: "Label" }, { k: "href", label: "Link", kind: "url" }] },
        { name: "Outline", hint: "Outlined button.", fields: [{ k: "label", label: "Label" }, { k: "href", label: "Link", kind: "url" }] },
        { name: "Full width", hint: "Full-width solid button.", fields: [{ k: "label", label: "Label" }, { k: "href", label: "Link", kind: "url" }] },
        { name: "Text link", hint: "A plain text link with an arrow.", fields: [{ k: "label", label: "Label" }, { k: "href", label: "Link", kind: "url" }] },
      ],
    },
    divider: {
      label: "Divider", icon: "divider",
      data: {},
      variants: [
        { name: "Hairline", hint: "A thin full-width rule.", fields: [] },
        { name: "Short rule", hint: "A short crimson rule, centred.", fields: [] },
        { name: "Spacer", hint: "Blank vertical space.", fields: [] },
        { name: "Dot", hint: "A small centred dot.", fields: [] },
      ],
    },
  };

  // Inline line icons (16px, currentColor) for the palette + block headers and controls. SVG, not
  // emoji, so they inherit theme colour and stay crisp — the admin chrome standard.
  var NL_ICONS = {
    masthead: '<rect x="3" y="4" width="18" height="4" rx="1"/><line x1="3" y1="12" x2="15" y2="12"/><line x1="3" y1="16" x2="12" y2="16"/>',
    greeting: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    text: '<line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="14" y2="18"/>',
    heading: '<path d="M6 4v16M18 4v16M6 12h12"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
    story: '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="7" y1="8" x2="17" y2="8"/><line x1="7" y1="12" x2="17" y2="12"/><line x1="7" y1="16" x2="13" y2="16"/>',
    spotlight: '<circle cx="12" cy="8" r="4"/><path d="M4 20a8 8 0 0 1 16 0"/>',
    stats: '<line x1="5" y1="20" x2="5" y2="12"/><line x1="10" y1="20" x2="10" y2="6"/><line x1="15" y1="20" x2="15" y2="14"/><line x1="20" y1="20" x2="20" y2="9"/>',
    waysToHelp: '<path d="M12 21s-8-5-8-11a4 4 0 0 1 8-1 4 4 0 0 1 8 1c0 6-8 11-8 11z"/>',
    events: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="16" y1="2" x2="16" y2="6"/>',
    donationCta: '<polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/>',
    button: '<rect x="3" y="8" width="18" height="8" rx="4"/><line x1="8" y1="12" x2="14" y2="12"/>',
    divider: '<line x1="3" y1="12" x2="21" y2="12"/>',
    // A signed hand over a ruled line (TASK-251). Same stroke-only line-art as its neighbours —
    // without an entry here nlIcon falls back to "" and the palette button sits there iconless.
    signoff: '<path d="M3 16c2.5 0 3.5-7 5.5-7s1.5 7 3.5 7 3-9 5-9 1.5 5 4 5"/><line x1="3" y1="20" x2="21" y2="20"/>',
    up: '<line x1="12" y1="19" x2="12" y2="5"/><polyline points="6 11 12 5 18 11"/>',
    down: '<line x1="12" y1="5" x2="12" y2="19"/><polyline points="6 13 12 19 18 13"/>',
    dup: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
    del: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
    plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  };
  function nlIcon(name) {
    return '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" ' +
      'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      (NL_ICONS[name] || "") + "</svg>";
  }
  function nlVariants(block) {
    var def = nlBlockDefs[block.type];
    return (def && def.variants) || [];
  }
  function nlActiveVariant(block) {
    var vs = nlVariants(block);
    return vs[block.variant] || vs[0] || { name: "", hint: "", fields: [] };
  }

  var nlDoc = { blocks: [] };
  var nlTemplates = []; // TASK-249: the shared saved-template library (id/name/createdAt only)
  var nlSent = false; // the open newsletter has been sent → its blocks are read-only

  // Read mode: no newsletter:edit permission, or an already-sent newsletter. In read mode the builder is
  // view-only — no adding, removing, reordering or editing of components.
  function nlReadOnly() {
    return !canEdit("newsletter") || nlSent;
  }

  function nlRenderPalette() {
    var host = el("nlPalette");
    if (!host) return;
    host.innerHTML = "";
    if (nlReadOnly()) {
      var note = doc.createElement("p");
      note.className = "nl-readonly-note";
      note.textContent = nlSent
        ? "This newsletter has been sent — it is read-only."
        : "You have read-only access — you cannot add or edit blocks.";
      host.appendChild(note);
      return;
    }
    Object.keys(nlBlockDefs).forEach(function (type) {
      var def = nlBlockDefs[type];
      var b = doc.createElement("button");
      b.type = "button";
      b.className = "nl-add";
      b.innerHTML = '<span class="nl-add-ic">' + nlIcon(def.icon) + "</span>" +
        '<span class="nl-add-label">' + def.label + "</span>";
      b.setAttribute("aria-label", "Add " + def.label + " block");
      b.addEventListener("click", function () { nlAddBlock(type); });
      host.appendChild(b);
    });
  }

  function nlAddBlock(type) {
    if (nlReadOnly()) return;
    nlDoc.blocks.push({ type: type, variant: 0, data: JSON.parse(JSON.stringify(nlBlockDefs[type].data)) });
    nlRenderCanvas();
    nlSchedulePreview();
  }

  function nlCtrlBtn(icon, label, disabled, onClick) {
    var b = doc.createElement("button");
    b.type = "button";
    b.className = "nl-ctrl" + (icon === "del" ? " nl-ctrl-danger" : "");
    b.setAttribute("data-nl", icon);
    b.innerHTML = nlIcon(icon);
    b.setAttribute("aria-label", label);
    b.title = label;
    if (disabled) b.disabled = true;
    else b.addEventListener("click", onClick);
    return b;
  }

  function nlRenderCanvas() {
    var host = el("nlCanvas");
    host.innerHTML = "";
    var readOnly = nlReadOnly();
    if (nlDoc.blocks.length === 0) {
      var empty = doc.createElement("li");
      empty.className = "nl-empty";
      empty.innerHTML = readOnly
        ? "<p><strong>No blocks</strong></p><p>This newsletter has no content blocks.</p>"
        : '<div class="nl-empty-ic">' + nlIcon("plus") + "</div>" +
          "<p><strong>No blocks yet</strong></p>" +
          "<p>Add a block from the palette to start building your newsletter.</p>";
      host.appendChild(empty);
      return;
    }
    nlDoc.blocks.forEach(function (block, i) {
      var li = doc.createElement("li");
      li.className = "nl-block";
      var def = nlBlockDefs[block.type] || { label: "Raw HTML", icon: "text" };

      var head = doc.createElement("div");
      head.className = "nl-block-head";
      head.innerHTML =
        '<span class="nl-block-ic">' + nlIcon(def.icon) + "</span>" +
        '<span class="nl-block-title">' + def.label + "</span>";
      // In read mode the mutation controls (move / duplicate / delete) are omitted entirely.
      if (!readOnly) {
        var ctrls = doc.createElement("span");
        ctrls.className = "nl-block-ctrls";
        ctrls.appendChild(nlCtrlBtn("up", "Move up", i === 0, function () { nlMove(i, -1); }));
        ctrls.appendChild(nlCtrlBtn("down", "Move down", i === nlDoc.blocks.length - 1, function () { nlMove(i, 1); }));
        ctrls.appendChild(nlCtrlBtn("dup", "Duplicate", false, function () { nlDup(i); }));
        ctrls.appendChild(nlCtrlBtn("del", "Delete", false, function () { nlDoc.blocks.splice(i, 1); nlRenderCanvas(); nlSchedulePreview(); }));
        head.appendChild(ctrls);
      }
      li.appendChild(head);

      // Named style picker (segmented control) — replaces the meaningless "Style 1..4". Disabled in
      // read mode (switching style is an edit), but still shows which style is active.
      var variants = nlVariants(block);
      if (variants.length > 1) {
        var seg = doc.createElement("div");
        seg.className = "nl-variants admin-segmented";
        seg.setAttribute("role", "group");
        seg.setAttribute("aria-label", "Style");
        variants.forEach(function (vdef, v) {
          var vb = doc.createElement("button");
          vb.type = "button";
          vb.className = "admin-seg" + (block.variant === v ? " is-active" : "");
          vb.textContent = vdef.name;
          vb.setAttribute("aria-pressed", String(block.variant === v));
          if (readOnly) vb.disabled = true;
          else vb.addEventListener("click", function () { block.variant = v; nlRenderCanvas(); nlSchedulePreview(); });
          seg.appendChild(vb);
        });
        li.appendChild(seg);
      }

      // Text size step (TASK-248). A- / A+ nudge this block's text one notch along the newsletter's
      // own size ladder; the SERVER owns the ladder maths (src/newsletter/blocks.ts applySizeStep) and
      // this only carries the step on the block, exactly like variant above. Disabled at the ends of
      // the range and in read mode (changing size is an edit), but still shown so a viewer sees state.
      if (nlCanSize(block)) {
        var sizeWrap = doc.createElement("div");
        sizeWrap.className = "nl-size admin-segmented";
        sizeWrap.setAttribute("role", "group");
        sizeWrap.setAttribute("aria-label", "Text size");
        [
          { d: -1, label: "A−", title: "Smaller text" },
          { d: 1, label: "A+", title: "Larger text" },
        ].forEach(function (step) {
          var sb = doc.createElement("button");
          sb.type = "button";
          sb.className = "admin-seg nl-size-btn";
          sb.textContent = step.label;
          sb.title = step.title;
          sb.setAttribute("aria-label", step.title);
          var current = block.size || 0;
          var next = current + step.d;
          sb.disabled = readOnly || next < NL_SIZE_MIN || next > NL_SIZE_MAX;
          if (!readOnly) {
            sb.addEventListener("click", function () {
              block.size = Math.max(NL_SIZE_MIN, Math.min(NL_SIZE_MAX, (block.size || 0) + step.d));
              nlRenderCanvas();
              nlSchedulePreview();
            });
          }
          sizeWrap.appendChild(sb);
        });
        li.appendChild(sizeWrap);
      }

      var fields = doc.createElement("div");
      fields.className = "nl-fields";
      nlRenderFields(fields, block);
      li.appendChild(fields);

      host.appendChild(li);
    });
  }

  function nlMove(i, delta) {
    var j = i + delta;
    if (j < 0 || j >= nlDoc.blocks.length) return;
    var tmp = nlDoc.blocks[i];
    nlDoc.blocks[i] = nlDoc.blocks[j];
    nlDoc.blocks[j] = tmp;
    nlRenderCanvas();
    nlSchedulePreview();
  }

  function nlDup(i) {
    nlDoc.blocks.splice(i + 1, 0, JSON.parse(JSON.stringify(nlDoc.blocks[i])));
    nlRenderCanvas();
    nlSchedulePreview();
  }

  // Quick-pick library of real nbcc.scot assets, offered alongside the URL field and upload button
  // (TASK-168 / Task 24).
  var NBCC_IMAGE_LIBRARY = [
    { label: "Logo", url: "https://nbcc.scot/assets/img/nbcc-logo.png" },
    { label: "Elf", url: "https://nbcc.scot/assets/img/nbcc-elf.png" },
    { label: "Red bags handover", url: "https://nbcc.scot/assets/img/home-red-bags-handover.jpg" },
    { label: "Why packing", url: "https://nbcc.scot/assets/img/why-packing.jpg" },
    { label: "Story: Tygan", url: "https://nbcc.scot/assets/img/story-tygan.jpg" },
  ];

  // A labelled text input (or textarea) bound to obj[key] (obj is a block's data or a repeater item).
  // opts: { multiline, hint, type } — hint renders muted helper text under the input; type sets the
  // input type (e.g. "url") for the right mobile keyboard.
  // TASK-253: is this selection already wrapped in `marker`?
  // The subtlety: `**bold**` ends with a `*`, so a naive check would say italic-wrapped, strip one
  // asterisk, and silently turn the author's bold into italic. A single `*` adjacent to another `*`
  // belongs to a BOLD marker and is not ours to remove.
  function nlWrappedIn(before, after, marker) {
    var m = marker.length;
    if (before.slice(-m) !== marker || after.slice(0, m) !== marker) return false;
    if (marker === "*" && (before.slice(-2) === "**" || after.slice(0, 2) === "**")) return false;
    return true;
  }

  // Wrap (or unwrap) the current selection in a plain-text marker the SERVER renders — the block's
  // data stays a plain string, so templates, the size step and the merge all keep working untouched.
  // Clicking with nothing selected does nothing: silently dropping `**` into someone's copy at the
  // caret would be worse than no-op.
  function nlWrapSelection(input, obj, key, marker) {
    var start = input.selectionStart;
    var end = input.selectionEnd;
    if (start == null || start === end) return;
    var value = input.value;
    var before = value.slice(0, start);
    var sel = value.slice(start, end);
    var after = value.slice(end);
    var m = marker.length;
    var next, caret;
    if (nlWrappedIn(before, after, marker)) {
      next = before.slice(0, -m) + sel + after.slice(m); // toggle off
      caret = start - m;
    } else {
      next = before + marker + sel + marker + after;
      caret = start + m;
    }
    input.value = next;
    obj[key] = next;
    // Keep the same words selected, so a second click toggles the same thing rather than the author
    // having to re-select after every press.
    input.setSelectionRange(caret, caret + sel.length);
    input.focus();
    nlSchedulePreview();
  }

  // The B / I pair above a prose field. Not on titles or button labels — emphasis belongs in prose.
  function nlEmphasisBar(input, obj, key) {
    var bar = doc.createElement("div");
    bar.className = "nl-emphasis";
    bar.setAttribute("role", "group");
    bar.setAttribute("aria-label", "Emphasis");
    [
      { marker: "**", label: "B", title: "Bold the selected text" },
      { marker: "*", label: "I", title: "Italicise the selected text" },
    ].forEach(function (spec) {
      var btn = doc.createElement("button");
      btn.type = "button";
      btn.className = "nl-emph";
      btn.textContent = spec.label;
      btn.title = spec.title;
      btn.setAttribute("aria-label", spec.title);
      if (nlReadOnly()) btn.disabled = true;
      else {
        // mousedown would steal focus from the textarea and collapse the selection before the click
        // lands — preventDefault here keeps the author's selection intact.
        btn.addEventListener("mousedown", function (e) { e.preventDefault(); });
        btn.addEventListener("click", function () { nlWrapSelection(input, obj, key, spec.marker); });
      }
      bar.appendChild(btn);
    });
    return bar;
  }

  function nlText(host, obj, key, label, opts) {
    opts = opts || {};
    var wrap = doc.createElement("label");
    wrap.className = "nl-field";
    var lab = doc.createElement("span");
    lab.className = "nl-field-label";
    lab.textContent = label;
    wrap.appendChild(lab);
    var input = doc.createElement(opts.multiline ? "textarea" : "input");
    if (opts.multiline) input.rows = 3;
    else if (opts.type) input.type = opts.type;
    input.value = obj[key] != null ? obj[key] : "";
    if (nlReadOnly()) input.disabled = true;
    else input.addEventListener("input", function () { obj[key] = input.value; nlSchedulePreview(); });
    // TASK-253: a multiline field IS a prose field — the four of them (text, greeting intro, story
    // body, spotlight quote) are exactly the ones the server renders emphasis in, so the buttons and
    // the renderer can't disagree about where **bold** works.
    if (opts.multiline) wrap.appendChild(nlEmphasisBar(input, obj, key));
    wrap.appendChild(input);
    if (opts.hint) {
      var h = doc.createElement("span");
      h.className = "nl-field-hint";
      h.textContent = opts.hint;
      wrap.appendChild(h);
    }
    host.appendChild(wrap);
  }

  // An image field: URL input + "NBCC library" quick-pick + Upload (POSTs base64 to the endpoint).
  function nlImageField(host, block, key, label) {
    nlText(host, block.data, key, label, { type: "url", hint: "Paste a URL, choose from the NBCC library, or upload." });
    if (nlReadOnly()) return; // read mode: the disabled URL field is shown, but no library/upload tools
    var row = doc.createElement("div");
    row.className = "nl-img-tools";

    var lib = doc.createElement("select");
    lib.innerHTML = '<option value="">NBCC library…</option>' +
      NBCC_IMAGE_LIBRARY.map(function (i) { return '<option value="' + i.url + '">' + i.label + "</option>"; }).join("");
    lib.addEventListener("change", function () {
      if (lib.value) { block.data[key] = lib.value; nlRenderCanvas(); nlSchedulePreview(); }
    });
    row.appendChild(lib);

    var file = doc.createElement("input");
    file.type = "file";
    file.accept = "image/png,image/jpeg,image/webp,image/gif";
    file.addEventListener("change", function () {
      var f = file.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        var base64 = String(reader.result).split(",")[1];
        authFetch("/api/admin/newsletter-images", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mime: f.type, dataBase64: base64, filename: f.name }),
        })
          .then(function (r) { return r.json(); })
          .then(function (j2) {
            if (j2.url) { block.data[key] = j2.url; nlRenderCanvas(); nlSchedulePreview(); }
            else el("newsletterMsg").textContent = j2.error || "Upload failed.";
          });
      };
      reader.readAsDataURL(f);
    });
    row.appendChild(file);
    host.appendChild(row);
  }

  // Repeater for the list-shaped variants (stats/waysToHelp/events, and story "two-up"). `spec` is
  // the active variant's items descriptor: { fields:[{k,label,hint?}], firstOnly?, note? }. Only the
  // fields the variant actually renders are shown, so what you type always maps to what appears.
  function nlRenderItems(host, block, spec) {
    var fields = spec.fields || [];
    // Ensure items exists. For story switching into two-up, seed one item from the top-level fields
    // so any copy already written carries over instead of vanishing.
    if (!Array.isArray(block.data.items)) {
      if (block.type === "story") {
        block.data.items = [{
          imageUrl: block.data.imageUrl || "", title: block.data.title || "",
          body: block.data.body || "", label: block.data.label || "", href: block.data.href || "",
        }];
      } else {
        block.data.items = [];
      }
    }
    if (spec.note) {
      var note = doc.createElement("p");
      note.className = "nl-note";
      note.textContent = spec.note;
      host.appendChild(note);
    }
    var readOnly = nlReadOnly();
    block.data.items.forEach(function (item, idx) {
      var fs = doc.createElement("fieldset");
      fs.className = "nl-item";
      var lg = doc.createElement("legend");
      lg.textContent = "Item " + (idx + 1);
      fs.appendChild(lg);
      fields.forEach(function (f) {
        nlText(fs, item, f.k, f.label, { hint: f.hint });
      });
      if (!readOnly) {
        var rm = doc.createElement("button");
        rm.type = "button";
        rm.className = "nl-item-remove";
        rm.textContent = "Remove item";
        rm.addEventListener("click", function () { block.data.items.splice(idx, 1); nlRenderCanvas(); nlSchedulePreview(); });
        fs.appendChild(rm);
      }
      host.appendChild(fs);
    });
    if (readOnly) return; // no "Add item" control in read mode
    var add = doc.createElement("button");
    add.type = "button";
    add.className = "nl-item-add";
    add.innerHTML = nlIcon("plus") + "<span>Add item</span>";
    add.addEventListener("click", function () {
      var blank = {};
      fields.forEach(function (f) { blank[f.k] = ""; });
      block.data.items = block.data.items.concat([blank]);
      nlRenderCanvas();
      nlSchedulePreview();
    });
    host.appendChild(add);
  }

  // Editable fields for the block's ACTIVE variant, driven by nlBlockDefs. Only the fields that the
  // chosen style renders are shown (progressive disclosure) — so a value the style ignores is never
  // offered, and every value you enter appears in the preview.
  // A "signer" field: pick who signs, from AdminHelpers.SIGNERS — the same list the thank-you letter's
  // picker is built from (TASK-251), so the two can't drift. A name saved before that person left the
  // list is kept as an extra option rather than silently swapped to someone else: an old newsletter
  // must keep saying who actually signed it.
  function nlSignerField(host, block, key, label, hint) {
    var wrap = doc.createElement("label");
    wrap.className = "nl-field";
    var lab = doc.createElement("span");
    lab.className = "nl-field-label";
    lab.textContent = label;
    wrap.appendChild(lab);

    var select = doc.createElement("select");
    var current = block.data[key] != null ? String(block.data[key]) : "";
    var names = (H.SIGNERS || []).map(function (s) { return s.name; });
    if (current && names.indexOf(current) === -1) names = [current].concat(names);
    names.forEach(function (n) {
      var o = doc.createElement("option");
      o.value = n;
      o.textContent = n;
      select.appendChild(o);
    });
    select.value = current || (names[0] || "");
    if (nlReadOnly()) select.disabled = true;
    else select.addEventListener("change", function () { block.data[key] = select.value; nlSchedulePreview(); });
    wrap.appendChild(select);

    if (hint) {
      var h = doc.createElement("span");
      h.className = "nl-field-hint";
      h.textContent = hint;
      wrap.appendChild(h);
    }
    host.appendChild(wrap);
  }

  function nlRenderFields(host, block) {
    host.innerHTML = "";
    var def = nlBlockDefs[block.type];
    if (!def) { // legacy rawHtml draft — offer the raw HTML directly
      nlText(host, block.data, "html", "HTML", { multiline: true });
      return;
    }
    var vdef = nlActiveVariant(block);
    if (vdef.hint) {
      var h = doc.createElement("p");
      h.className = "nl-vhint";
      h.textContent = vdef.hint;
      host.appendChild(h);
    }
    if (vdef.items) {
      nlRenderItems(host, block, vdef.items);
      return;
    }
    var fields = vdef.fields || [];
    if (fields.length === 0) {
      var none = doc.createElement("p");
      none.className = "nl-note";
      none.textContent = "This style has no fields to fill.";
      host.appendChild(none);
      return;
    }
    fields.forEach(function (f) {
      if (f.kind === "image") nlImageField(host, block, f.k, f.label);
      else if (f.kind === "signer") nlSignerField(host, block, f.k, f.label, f.hint);
      else nlText(host, block.data, f.k, f.label, {
        multiline: f.kind === "textarea",
        type: f.kind === "url" ? "url" : undefined,
        hint: f.hint,
      });
    });
  }

  // Debounced live preview: renders the current nlDoc server-side and streams it into the iframe.
  var nlPreviewTimer = null;
  function nlSchedulePreview() {
    if (nlPreviewTimer) clearTimeout(nlPreviewTimer);
    nlPreviewTimer = setTimeout(nlRefreshPreview, 300);
  }
  // Fit the true 660px-wide email into the (narrower) preview column: zoom the iframe down so it fits
  // horizontally (no left/right scroll) and size it to its full content height so all blocks show and
  // vertical scrolling happens on the wrapper. `zoom` (unlike transform) shrinks the layout box too,
  // so the wrapper width matches and there is no horizontal overflow.
  var EMAIL_W = 660;
  function nlFitPreview() {
    var iframe = el("nlPreview"), wrap = el("nlPreviewWrap");
    if (!iframe || !wrap) return;
    var cdoc = iframe.contentDocument;
    if (!cdoc || !cdoc.body) return;
    var scale = Math.min(1, wrap.clientWidth / EMAIL_W);
    iframe.style.width = EMAIL_W + "px";
    iframe.style.height = "0px"; // reset so scrollHeight reflects content, not the old height
    var h = Math.max(cdoc.body.scrollHeight, cdoc.documentElement.scrollHeight);
    iframe.style.height = h + "px";
    iframe.style.zoom = scale; // shrinks the layout box (Chrome/Edge/Firefox/Safari)
  }
  // The preview reloads on every edit; keep the wrapper's scroll position so editing a low block does
  // not snap the preview back to the top, and re-fit once the new content has loaded.
  function nlPreviewOnLoad() {
    var wrap = el("nlPreviewWrap");
    var prevTop = wrap ? wrap.scrollTop : 0;
    function apply() { nlFitPreview(); if (wrap) wrap.scrollTop = prevTop; }
    apply();
    // Re-fit on the next frame too: on first load the grid column may not have its final width yet,
    // which would otherwise leave the zoom at 1 and a sliver of horizontal overflow.
    if (window.requestAnimationFrame) window.requestAnimationFrame(apply);
  }
  function nlRefreshPreview() {
    authFetch("/api/admin/newsletters/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bodyJson: nlDoc }),
    })
      .then(function (r) { return r.json(); })
      .then(function (j2) { if (j2.html != null) el("nlPreview").srcdoc = j2.html; })
      .catch(function () {});
  }
  if (el("nlPreview")) {
    el("nlPreview").addEventListener("load", nlPreviewOnLoad);
    window.addEventListener("resize", nlFitPreview);
  }

  if (el("nlPalette")) nlRenderPalette();

  function nlDeliveryCell(n) {
    if (n.recipientCount == null) return "-";
    // Sent newsletters carry a delivery summary; show delivered/total and flag any failures.
    if (n.sentCount == null) return String(n.recipientCount);
    var cell = n.sentCount + " / " + n.recipientCount;
    if (n.failedCount) cell += ' <span class="nl-fail-badge">' + n.failedCount + " failed</span>";
    return cell;
  }

  function renderNewsletterList(rows) {
    if (!rows.length) return '<p class="admin-loading">No newsletters yet.</p>';
    var html = '<table class="admin-table"><thead><tr><th>Subject</th><th>Status</th><th>Sent</th><th>Delivered</th><th></th></tr></thead><tbody>';
    rows.forEach(function (n) {
      html +=
        "<tr><td>" + H.escapeHtml(n.subject) + "</td><td>" + n.status + "</td><td>" +
        (n.sentAt ? new Date(n.sentAt).toLocaleString() : "-") + "</td><td>" +
        nlDeliveryCell(n) +
        '</td><td><button class="admin-link" type="button" data-edit-newsletter="' + n.id + '">Open</button>' +
        nlDeleteCell(n) + "</td></tr>";
    });
    return html + "</tbody></table>";
  }

  // TASK-258 (superseding TASK-252): a SENT newsletter is a permanent record — no delete of any kind
  // is offered on it, and the server refuses one anyway. Only a draft (never went anywhere) can go.
  // Rows redacted before the reversal keep their label so history reads honestly.
  function nlDeleteCell(n) {
    if (!isAdmin()) return "";
    if (n.redactedAt) return ' <span class="admin-muted">Content deleted</span>';
    if (n.status === "sent") return "";
    return ' <button class="admin-link admin-link-danger" type="button" data-delete-newsletter="' + n.id +
      '" data-newsletter-status="' + n.status + '">Delete</button>';
  }

  // TASK-252: delete a newsletter. The confirm says exactly what will happen, because the two cases
  // differ in a way the user has to understand BEFORE clicking: a draft is really gone, while a sent
  // newsletter only loses its content — the record that you sent it stays, on purpose. Saying "this
  // cannot be undone" for a draft and being honest about the stub for a sent one is the difference
  // between an informed decision and a nasty surprise.
  function nlDelete(id, status) {
    if (!isAdmin()) return;
    var sent = status === "sent";
    var message = sent
      ? "Delete the content of this sent newsletter?\n\nThe newsletter itself, and the record of when " +
        "you sent it and to how many people, is kept. What goes is the content, any attachments, and " +
        "the addresses that bounced.\n\nThis cannot be undone."
      : "Delete this draft?\n\nIt was never sent to anyone. This cannot be undone.";
    if (!window.confirm(message)) return;
    authFetch("/api/admin/newsletters/" + encodeURIComponent(id), { method: "DELETE" })
      .then(function (res) { return res.json().then(function (b) { return { ok: res.ok, b: b }; }); })
      .then(function (r) {
        if (!r.ok) {
          el("newsletterMsg").textContent = (r.b && r.b.error) || "Could not delete that newsletter.";
          return;
        }
        el("newsletterMsg").textContent = "Draft deleted.";
        // The open editor may be showing what we just removed — reset it rather than leave a ghost.
        if (String(el("newsletterId").value) === String(id)) {
          el("newsletterId").value = "";
          nlDoc = { blocks: [] };
          nlRenderCanvas();
        }
        loadNewsletters();
      })
      .catch(function () { el("newsletterMsg").textContent = "Could not delete that newsletter."; });
  }

  function loadNewsletterInto(id) {
    authFetch("/api/admin/newsletters/" + id)
      .then(j)
      .then(function (n) {
        el("newsletterId").value = n.id;
        el("newsletterSubject").value = n.subject;
        // A block-doc newsletter hydrates its blocks; a legacy raw-HTML draft becomes one rawHtml block.
        if (n.bodyJson && Array.isArray(n.bodyJson.blocks)) {
          nlDoc = n.bodyJson;
        } else {
          nlDoc = { blocks: [{ type: "rawHtml", variant: 0, data: { html: n.bodyHtml || "" } }] };
        }
        var sent = n.status === "sent";
        nlSent = sent;
        // TASK-256: delivery truth for a SENT newsletter; a draft has no delivery to report.
        if (sent) nlRefreshStats(n.id, n.redactedAt);
        else nlHideStats();
        // Read mode = no newsletter:edit permission OR an already-sent newsletter. Send/Save/New are
        // all gated to newsletter:edit (the server's authorizeSection level for these routes).
        var canWrite = canEdit("newsletter");
        el("newsletterSend").hidden = !(canWrite && !sent);
        el("newsletterSave").hidden = !canWrite;
        el("newsletterSave").disabled = sent || !canWrite;
        el("newsletterTest").hidden = !canWrite;
        el("newsletterNew").disabled = !canWrite;
        var tmplBtn = el("newsletterTemplate");
        if (tmplBtn) tmplBtn.disabled = !canWrite;
        el("newsletterMsg").textContent = sent
          ? "This newsletter has been sent and is read-only."
          : (!canWrite ? "You have read-only access to newsletters." : "");
        nlRenderPalette();
        nlRenderCanvas();
        nlRefreshPreview();
        nlRefreshAttachments();
        nlRefreshTemplates(); // TASK-249: fill the shared library picker when the tab opens
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
        Array.prototype.forEach.call(doc.querySelectorAll("[data-delete-newsletter]"), function (b) {
          b.addEventListener("click", function () {
            nlDelete(b.getAttribute("data-delete-newsletter"), b.getAttribute("data-newsletter-status"));
          });
        });
        // Open the first newsletter by default so the editor is never empty.
        if (rows.length) loadNewsletterInto(rows[0].id);
      })
      .catch(function () {});
  }

  // Manual "add a subscriber" form: create/re-consent a donor by email (Editor+). The card is hidden
  // in read mode (see updateNewsletterSubscriberCard, called once permissions load).
  var subscriberForm = el("subscriberForm");
  if (subscriberForm) {
    subscriberForm.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!canEdit("newsletter")) return;
      var email = el("subEmail").value.trim();
      var name = el("subName").value.trim();
      if (!email) return;
      var btn = el("subAddBtn");
      btn.disabled = true;
      el("subMsg").textContent = "Adding…";
      authFetch("/api/admin/newsletters/subscribers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(name ? { email: email, name: name } : { email: email }),
      })
        .then(function (res) { return res.json().then(function (b) { return { ok: res.ok, b: b }; }); })
        .then(function (r) {
          if (!r.ok) {
            el("subMsg").textContent = (r.b && r.b.error) || "Could not add that email.";
            return;
          }
          el("subMsg").textContent = r.b.status === "resubscribed"
            ? r.b.email + " was already on file — their consent is now on."
            : "Added " + r.b.email + " to the newsletter.";
          el("subEmail").value = "";
          el("subName").value = "";
          if (el("subManage") && el("subManage").open) nlLoadSubscribers();
        })
        .catch(function () { el("subMsg").textContent = "Could not add that email."; })
        .finally(function () { btn.disabled = false; });
    });
  }

  // Subscriber management: list (with search), remove, and CSV export. Loaded on first panel open.
  function nlRenderSubscribers(subs) {
    var host = el("subList");
    if (!subs.length) { host.innerHTML = '<p class="admin-empty">No subscribers found.</p>'; return; }
    var rows = subs.map(function (s) {
      return '<tr><td>' + H.escapeHtml(s.email) + "</td><td>" + H.escapeHtml(s.name || "") +
        '</td><td><button class="admin-link nl-sub-remove" type="button" data-remove-sub="' + H.escapeHtml(s.email) +
        '">Remove</button></td></tr>';
    }).join("");
    host.innerHTML = '<p class="nl-sub-count">' + subs.length + ' subscriber' + (subs.length === 1 ? "" : "s") + '</p>' +
      '<table class="admin-table"><thead><tr><th>Email</th><th>Name</th><th></th></tr></thead><tbody>' + rows + "</tbody></table>";
    Array.prototype.forEach.call(host.querySelectorAll("[data-remove-sub]"), function (b) {
      b.addEventListener("click", function () { nlRemoveSubscriber(b.getAttribute("data-remove-sub")); });
    });
  }
  function nlLoadSubscribers() {
    var host = el("subList");
    if (!host) return;
    var q = el("subSearch") ? el("subSearch").value.trim() : "";
    host.innerHTML = '<p class="admin-loading">Loading…</p>';
    authFetch("/api/admin/newsletters/subscribers" + (q ? "?q=" + encodeURIComponent(q) : ""))
      .then(j)
      .then(function (d) { nlRenderSubscribers(d.subscribers || []); })
      .catch(function () { host.innerHTML = '<p class="admin-empty">Could not load subscribers.</p>'; });
  }
  function nlRemoveSubscriber(email) {
    if (!canEdit("newsletter")) return;
    authFetch("/api/admin/newsletters/subscribers/remove", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email }),
    })
      .then(function (res) { if (!res.ok) throw new Error(String(res.status)); return res.json(); })
      .then(function () { nlLoadSubscribers(); })
      .catch(function () { el("subMsg").textContent = "Could not remove " + email + "."; });
  }
  if (el("subManage")) {
    var subLoaded = false;
    el("subManage").addEventListener("toggle", function () {
      if (el("subManage").open && !subLoaded) { subLoaded = true; nlLoadSubscribers(); }
    });
    var subSearchTimer = null;
    if (el("subSearch")) {
      el("subSearch").addEventListener("input", function () {
        if (subSearchTimer) clearTimeout(subSearchTimer);
        subSearchTimer = setTimeout(nlLoadSubscribers, 250);
      });
    }
    if (el("subExport")) {
      el("subExport").addEventListener("click", function () {
        authFetch("/api/admin/newsletters/subscribers.csv")
          .then(function (res) { return res.text(); })
          .then(function (csv) {
            var blob = new Blob([csv], { type: "text/csv" });
            var url = URL.createObjectURL(blob);
            var a = doc.createElement("a");
            a.href = url;
            a.download = "newsletter-subscribers.csv";
            doc.body.appendChild(a);
            a.click();
            doc.body.removeChild(a);
            URL.revokeObjectURL(url);
          })
          .catch(function () { el("subMsg").textContent = "Could not export subscribers."; });
      });
    }
  }

  // Newsletter attachments: only available once the newsletter is saved (has an id) and the user can
  // edit. Renders the current list with remove buttons and wires the file input to upload as base64.
  function nlAttachHumanSize(bytes) {
    if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
    if (bytes >= 1024) return Math.round(bytes / 1024) + " KB";
    return bytes + " B";
  }
  function nlRenderAttachments(list) {
    var host = el("nlAttachList");
    if (!host) return;
    if (!list.length) { host.innerHTML = '<p class="admin-empty">No attachments yet.</p>'; return; }
    var rows = list.map(function (a) {
      return '<li class="nl-attach-item"><span class="nl-attach-name">' + H.escapeHtml(a.filename) +
        '</span><span class="nl-attach-size">' + nlAttachHumanSize(a.byteSize) + "</span>" +
        '<button type="button" class="admin-link nl-attach-remove" data-att-remove="' + H.escapeHtml(a.id) + '">Remove</button></li>';
    }).join("");
    host.innerHTML = '<ul class="nl-attach-list">' + rows + "</ul>";
    Array.prototype.forEach.call(host.querySelectorAll("[data-att-remove]"), function (b) {
      b.addEventListener("click", function () { nlRemoveAttachment(b.getAttribute("data-att-remove")); });
    });
  }
  // Reflect the current newsletter id + edit permission: hint (no id yet), tools + list (saved), or
  // the whole section hidden in read mode.
  function nlRefreshAttachments() {
    var section = el("nlAttachments");
    if (!section) return;
    if (!canEdit("newsletter")) { section.hidden = true; return; }
    section.hidden = false;
    var id = el("newsletterId").value;
    var saved = !!id && !nlSent;
    el("nlAttachHint").hidden = saved;
    el("nlAttachTools").hidden = !saved;
    if (!saved) { el("nlAttachList").innerHTML = ""; return; }
    authFetch("/api/admin/newsletters/" + id + "/attachments")
      .then(j)
      .then(function (d) { nlRenderAttachments(d.attachments || []); })
      .catch(function () { el("nlAttachList").innerHTML = '<p class="admin-empty">Could not load attachments.</p>'; });
  }
  function nlRemoveAttachment(attId) {
    var id = el("newsletterId").value;
    if (!id) return;
    authFetch("/api/admin/newsletters/" + id + "/attachments/" + encodeURIComponent(attId), { method: "DELETE" })
      .then(function (res) { if (!res.ok) throw new Error(String(res.status)); return res.json(); })
      .then(function () { nlRefreshAttachments(); })
      .catch(function () { el("nlAttachMsg").textContent = "Could not remove that attachment."; });
  }

  // --- Delivery stats panel (TASK-256, email stats Phase 1) -----------------------------------------
  // Declared at the IIFE top level beside nlRefreshAttachments (the TASK-249 lesson: these are called
  // from loadNewsletterInto, outside any if-block that might otherwise scope them away).
  function nlHideStats() {
    var host = el("nlStats");
    if (host) host.hidden = true;
  }

  // Aggregates only, and honest about absence: a sent newsletter with NO send rows either predates
  // tracking or was redacted — both get a sentence, never a grid of fake zeros.
  function nlRenderStats(stats, redactedAt) {
    var host = el("nlStats");
    var grid = el("nlStatsGrid");
    var note = el("nlStatsNote");
    if (!host || !grid || !note) return;
    grid.innerHTML = "";
    note.textContent = "";
    host.hidden = false;

    if (!stats.sends) {
      note.textContent = redactedAt
        ? "The content was deleted, and its per-address delivery detail went with it. The send record above is kept."
        : "Sent before delivery tracking was switched on — no delivery data for this one.";
      return;
    }

    // Engagement tiles (TASK-257) appear only when there IS engagement: a send with tracking off has
    // opened=0/clicked=0, and "0 Opened" would read as "nobody opened it" — a lie of presentation.
    var tiles = [
      { label: "Accepted", n: stats.sends, rate: "" },
      { label: "Delivered", n: stats.delivered, rate: H.rateOf(stats.delivered, stats.sends) },
      { label: "Bounced", n: stats.bounced, rate: H.rateOf(stats.bounced, stats.sends) },
      { label: "Spam", n: stats.complained, rate: H.rateOf(stats.complained, stats.sends) },
      { label: "Unsubscribed", n: stats.unsubscribed, rate: H.rateOf(stats.unsubscribed, stats.sends) },
    ];
    if (stats.opened > 0) tiles.push({ label: "Opened (approx.)", n: stats.opened, rate: H.rateOf(stats.opened, stats.sends) });
    if (stats.clicked > 0) tiles.push({ label: "Clicked", n: stats.clicked, rate: H.rateOf(stats.clicked, stats.sends) });
    tiles.forEach(function (tile) {
      var d = doc.createElement("div");
      d.className = "nl-stat";
      d.innerHTML =
        '<span class="nl-stat-n">' + tile.n + "</span>" +
        (tile.rate ? '<span class="nl-stat-rate">' + tile.rate + "</span>" : "") +
        '<span class="nl-stat-label">' + tile.label + "</span>";
      grid.appendChild(d);
    });

    // Per-link clicks (TASK-257): unique people lead — one keen reader can click five times.
    var oldLinks = host.querySelector(".nl-links");
    if (oldLinks) oldLinks.remove();
    if (stats.links && stats.links.length) {
      var tbl = doc.createElement("table");
      tbl.className = "nl-links admin-table";
      tbl.innerHTML =
        "<thead><tr><th>Link</th><th>People</th><th>Clicks</th></tr></thead><tbody>" +
        stats.links.map(function (l) {
          return "<tr><td class=\"nl-link-url\">" + H.escapeHtml(l.link) + "</td><td class=\"admin-num\">" +
            l.uniqueClicks + "</td><td class=\"admin-num\">" + l.totalClicks + "</td></tr>";
        }).join("") + "</tbody>";
      note.parentNode.insertBefore(tbl, note);
    }

    var noteBits = [];
    if (stats.opened > 0) {
      noteBits.push("Opens are approximate — some mail apps open images automatically, others block them.");
    }
    if (stats.bouncedEmails && stats.bouncedEmails.length) {
      noteBits.push(
        "Bounced (dead addresses, worth removing): " +
        stats.bouncedEmails.map(function (e) { return "<code>" + H.escapeHtml(e) + "</code>"; }).join(", "),
      );
    }
    if (noteBits.length) note.innerHTML = noteBits.join("<br>");
  }

  // Best-effort by design: stats are decoration on the builder, so any failure just keeps the panel
  // hidden — the builder must never care.
  function nlRefreshStats(id, redactedAt) {
    authFetch("/api/admin/newsletters/" + id + "/stats")
      .then(function (res) { if (!res.ok) throw new Error(String(res.status)); return res.json(); })
      .then(function (stats) { nlRenderStats(stats, redactedAt); })
      .catch(function () { nlHideStats(); });
  }

  // --- The SHARED saved-template library: helpers (TASK-249) ---------------------------------------
  // Declared HERE, at the IIFE's top level beside nlRefreshAttachments, NOT inside the if (nlForm)
  // block that holds the listeners: the tab-open flow calls nlRefreshTemplates from outside that
  // block, and a function declared inside it is block-scoped, so the call would throw and take the
  // whole Newsletter tab down with it.
  function nlTemplateMsg(text) {
    var m = el("nlTemplateMsg");
    if (m) m.textContent = text || "";
  }

  function nlSelectedTemplate() {
    var pick = el("newsletterTemplatePick");
    if (!pick || !pick.value) return null;
    for (var i = 0; i < nlTemplates.length; i++) {
      if (String(nlTemplates[i].id) === String(pick.value)) return nlTemplates[i];
    }
    return null;
  }

  function nlRenderTemplates() {
    var wrap = el("nlTemplates");
    var pick = el("newsletterTemplatePick");
    if (!wrap || !pick) return;
    // An empty picker is noise on a fresh install — show the library only once it has something.
    wrap.hidden = nlTemplates.length === 0;
    var keep = pick.value;
    pick.innerHTML = "";
    nlTemplates.forEach(function (t) {
      var o = doc.createElement("option");
      o.value = String(t.id);
      o.textContent = t.name;
      pick.appendChild(o);
    });
    if (keep) pick.value = keep;
    var canWrite = canEdit("newsletter");
    ["newsletterTemplateUse", "newsletterTemplateDelete", "newsletterTemplateSave"].forEach(function (id) {
      if (el(id)) el(id).disabled = !canWrite;
    });
  }

  function nlRefreshTemplates() {
    return authFetch("/api/admin/newsletter-templates")
      .then(function (res) { return res.ok ? res.json() : []; })
      .then(function (rows) {
        nlTemplates = Array.isArray(rows) ? rows : [];
        nlRenderTemplates();
      })
      .catch(function () { /* the library is a convenience — never block the builder on it */ });
  }

  function nlShowTemplateName(show) {
    ["newsletterTemplateName", "newsletterTemplateSaveConfirm", "newsletterTemplateSaveCancel"].forEach(
      function (id) { if (el(id)) el(id).hidden = !show; },
    );
    if (el("newsletterTemplateSave")) el("newsletterTemplateSave").hidden = show;
    if (show && el("newsletterTemplateName")) el("newsletterTemplateName").focus();
  }
  if (el("nlAttachFile")) {
    el("nlAttachFile").addEventListener("change", function () {
      var f = el("nlAttachFile").files[0];
      var id = el("newsletterId").value;
      if (!f || !id) return;
      el("nlAttachMsg").textContent = "Uploading " + f.name + "…";
      var reader = new FileReader();
      reader.onload = function () {
        var base64 = String(reader.result).split(",")[1];
        authFetch("/api/admin/newsletters/" + id + "/attachments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename: f.name, mime: f.type || "application/octet-stream", dataBase64: base64 }),
        })
          .then(function (res) { return res.json().then(function (b) { return { ok: res.ok, b: b }; }); })
          .then(function (r) {
            el("nlAttachMsg").textContent = r.ok ? "Attached " + f.name + "." : (r.b && r.b.error) || "Upload failed.";
            el("nlAttachFile").value = "";
            if (r.ok) nlRefreshAttachments();
          })
          .catch(function () { el("nlAttachMsg").textContent = "Upload failed."; });
      };
      reader.readAsDataURL(f);
    });
  }

  // A ready-made starter newsletter that shows off the full range of blocks (every type, varied
  // styles) with real NBCC content. "Start from template" loads it into the builder so an admin can
  // tweak the copy and send, rather than starting from a blank canvas.
  var NL_TEMPLATE = { blocks: [
    { type: "masthead", variant: 0, data: { issueTitle: "The Night Before Christmas — Winter Update" } },
    { type: "greeting", variant: 1, data: { lead: "Thank you for being part of the Night Before Christmas Campaign. Here is what your kindness has made possible across South West Scotland this year." } },
    { type: "heading", variant: 1, data: { kicker: "Our impact", title: "What your donation made possible" } },
    { type: "stats", variant: 1, data: { items: [
      { number: "7,657", label: "Red Bags delivered" },
      { number: "£128k", label: "Raised together" },
      { number: "420", label: "Volunteers" },
    ] } },
    { type: "story", variant: 0, data: {
      imageUrl: "https://nbcc.scot/assets/img/why-packing.jpg",
      title: "Packing night",
      body: "In a single evening our volunteers filled thousands of Red Bags Full of Joy — thoughtful gifts that bring dignity, comfort and a moment of joy to children, young people and vulnerable adults.",
      label: "Read more", href: "https://nbcc.scot",
    } },
    { type: "divider", variant: 1, data: {} },
    { type: "spotlight", variant: 1, data: {
      photoUrl: "https://nbcc.scot/assets/img/nbcc-elf.png",
      name: "A volunteer", role: "Red Bag packer",
      quote: "Seeing the bags come together, knowing each one reaches someone who needs it — that is what Christmas is about.",
    } },
    { type: "text", variant: 3, data: { text: "Every donation matters. £10 fills a Red Bag; £25 brightens a whole family's Christmas morning." } },
    { type: "heading", variant: 2, data: { title: "Ways you can help" } },
    { type: "waysToHelp", variant: 0, data: { items: [
      { icon: "🎁", title: "Donate", body: "Fund a Red Bag Full of Joy.", label: "Donate", href: "https://nbcc.scot/donate" },
      { icon: "🤝", title: "Volunteer", body: "Give a little time this season.", label: "Join us", href: "https://nbcc.scot" },
      { icon: "📣", title: "Spread the word", body: "Share our story with a friend.", label: "Share", href: "https://nbcc.scot" },
    ] } },
    { type: "events", variant: 0, data: { items: [
      { day: "14", month: "DEC", name: "Community packing night", location: "Ayr", label: "Register", href: "https://nbcc.scot" },
      { day: "20", month: "DEC", name: "Red Bag delivery day", location: "South West Scotland", label: "Register", href: "https://nbcc.scot" },
    ] } },
    { type: "image", variant: 2, data: {
      url: "https://nbcc.scot/assets/img/home-red-bags-handover.jpg",
      alt: "Volunteers handing over Red Bags", caption: "Red Bags on their way to families across the region.",
    } },
    { type: "donationCta", variant: 1, data: { heading: "Help us reach even more this Christmas", label: "Make a donation today", href: "https://nbcc.scot/donate" } },
    { type: "button", variant: 3, data: { label: "Read more stories", href: "https://nbcc.scot" } },
    { type: "divider", variant: 3, data: {} },
    { type: "text", variant: 2, data: { text: "How do we change the world? One random act of kindness at a time." } },
    // The example is meant to show every block, and a newsletter ends by signing off (TASK-251).
    { type: "signoff", variant: 0, data: {
      closing: "With love and gratitude,",
      name: (H.SIGNERS && H.SIGNERS[0] && H.SIGNERS[0].name) || "",
      role: "On behalf of everyone at NBCC",
      email: "info@nbcc.scot",
    } },
  ] };

  var nlForm = el("newsletterForm");
  if (nlForm) {
    el("newsletterNew").addEventListener("click", function () {
      if (!canEdit("newsletter")) return; // read mode: no new drafts
      nlHideStats(); // a fresh draft has no delivery stats (TASK-256)
      el("newsletterId").value = "";
      el("newsletterSubject").value = "";
      nlDoc = { blocks: [] };
      nlSent = false;
      el("newsletterSend").hidden = true; // save first to get an id
      el("newsletterSave").disabled = false;
      el("newsletterMsg").textContent = "";
      nlRenderPalette();
      nlRenderCanvas();
      nlRefreshPreview();
      nlRefreshAttachments();
    });

    // Start a fresh (unsaved) newsletter pre-filled with the showcase template.
    if (el("newsletterTemplate")) {
      el("newsletterTemplate").addEventListener("click", function () {
        if (!canEdit("newsletter")) return;
        el("newsletterId").value = "";
        el("newsletterSubject").value = "Winter Update";
        nlDoc = JSON.parse(JSON.stringify(NL_TEMPLATE));
        nlSent = false;
        el("newsletterSend").hidden = true; // save first to get an id
        el("newsletterSave").disabled = false;
        el("newsletterMsg").textContent = "Loaded the example — edit the copy, then Save.";
        nlRenderPalette();
        nlRenderCanvas();
        nlRefreshPreview();
        nlRefreshAttachments();
        nlRefreshTemplates();
      });
    }

    // --- The SHARED saved-template library (TASK-249) ---------------------------------------------
    // Whatever anyone saves here, the whole team can start from — so the destructive bits (replacing
    // your work, deleting someone else's template) are confirm()-guarded, matching how this admin
    // already guards irreversible actions. The helpers these listeners use live at the top of the
    // IIFE beside nlRefreshAttachments, because the tab-open flow calls nlRefreshTemplates from
    // OUTSIDE this if (nlForm) block — a function declared in here would be block-scoped and invisible
    // there, and opening the tab would throw.
    if (el("newsletterTemplateSave")) {
      el("newsletterTemplateSave").addEventListener("click", function () {
        if (!canEdit("newsletter")) return;
        if (!nlDoc.blocks.length) {
          nlTemplateMsg("Add some blocks first — an empty template is no use to anyone.");
          return;
        }
        // Default the name to the subject: it is almost always what you'd type anyway.
        var name = el("newsletterTemplateName");
        if (name && !name.value) name.value = (el("newsletterSubject").value || "").trim();
        nlTemplateMsg("");
        nlShowTemplateName(true);
      });
    }

    if (el("newsletterTemplateSaveCancel")) {
      el("newsletterTemplateSaveCancel").addEventListener("click", function () {
        nlShowTemplateName(false);
        nlTemplateMsg("");
      });
    }

    if (el("newsletterTemplateSaveConfirm")) {
      el("newsletterTemplateSaveConfirm").addEventListener("click", function () {
        if (!canEdit("newsletter")) return;
        var name = (el("newsletterTemplateName").value || "").trim();
        if (!name) {
          nlTemplateMsg("Give the template a name so the team can recognise it.");
          return;
        }
        var btn = el("newsletterTemplateSaveConfirm");
        btn.disabled = true;
        nlTemplateMsg("Saving…");
        authFetch("/api/admin/newsletter-templates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name, bodyJson: nlDoc }),
        })
          .then(function (res) { return res.json().then(function (b) { return { ok: res.ok, status: res.status, b: b }; }); })
          .then(function (r) {
            btn.disabled = false;
            if (r.ok) {
              el("newsletterTemplateName").value = "";
              nlShowTemplateName(false);
              nlTemplateMsg("Saved to the shared library.");
              return nlRefreshTemplates();
            }
            // A name clash is routine in a shared library — say so plainly, don't dump an error.
            nlTemplateMsg(r.status === 409 ? "That name is already taken — try another." : (r.b && r.b.error) || "Could not save the template.");
          })
          .catch(function () {
            btn.disabled = false;
            nlTemplateMsg("Could not save the template.");
          });
      });
    }

    if (el("newsletterTemplateUse")) {
      el("newsletterTemplateUse").addEventListener("click", function () {
        if (!canEdit("newsletter")) return;
        var t = nlSelectedTemplate();
        if (!t) return;
        // Starting from a template REPLACES what is on the canvas — that is worth asking about.
        if (nlDoc.blocks.length && !window.confirm('Start from "' + t.name + '"? This replaces what you have here.')) return;
        nlTemplateMsg("Loading…");
        authFetch("/api/admin/newsletter-templates/" + encodeURIComponent(t.id))
          .then(function (res) { return res.json().then(function (b) { return { ok: res.ok, b: b }; }); })
          .then(function (r) {
            if (!r.ok || !r.b || !r.b.bodyJson) {
              nlTemplateMsg("Could not open that template.");
              return;
            }
            // A NEW newsletter seeded from the template — never an edit of the template itself.
            el("newsletterId").value = "";
            nlDoc = JSON.parse(JSON.stringify(r.b.bodyJson));
            nlSent = false;
            el("newsletterSend").hidden = true; // save first to get an id
            el("newsletterSave").disabled = false;
            nlTemplateMsg("");
            el("newsletterMsg").textContent = 'Started from "' + t.name + '" — edit the copy, then Save.';
            nlRenderPalette();
            nlRenderCanvas();
            nlRefreshPreview();
            nlRefreshAttachments();
          })
          .catch(function () { nlTemplateMsg("Could not open that template."); });
      });
    }

    if (el("newsletterTemplateDelete")) {
      el("newsletterTemplateDelete").addEventListener("click", function () {
        if (!canEdit("newsletter")) return;
        var t = nlSelectedTemplate();
        if (!t) return;
        // Shared library: this removes it for everyone, not just you.
        if (!window.confirm('Delete "' + t.name + '" from the shared template library? Everyone loses it.')) return;
        nlTemplateMsg("Deleting…");
        authFetch("/api/admin/newsletter-templates/" + encodeURIComponent(t.id), { method: "DELETE" })
          .then(function (res) {
            nlTemplateMsg(res.ok ? "Deleted." : "Could not delete that template.");
            return nlRefreshTemplates();
          })
          .catch(function () { nlTemplateMsg("Could not delete that template."); });
      });
    }

    // Send a single test copy to the signed-in admin's own inbox — the current builder doc, unsaved
    // changes and all (mirrors the preview payload). Lets you check real-inbox rendering before a blast.
    el("newsletterTest").addEventListener("click", function () {
      if (!canEdit("newsletter")) return;
      var testBtn = el("newsletterTest");
      testBtn.disabled = true;
      el("newsletterMsg").textContent = "Sending test…";
      authFetch("/api/admin/newsletters/test-send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: el("newsletterSubject").value || "Newsletter", bodyJson: nlDoc }),
      })
        .then(function (res) { return res.json().then(function (b) { return { ok: res.ok, b: b }; }); })
        .then(function (r) {
          el("newsletterMsg").textContent = r.ok
            ? "Test sent to " + r.b.sentTo + "."
            : (r.b && r.b.error) || "Could not send the test.";
        })
        .catch(function () { el("newsletterMsg").textContent = "Could not send the test."; })
        .finally(function () { testBtn.disabled = false; });
    });

    nlForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var id = el("newsletterId").value;
      var payload = { subject: el("newsletterSubject").value, bodyJson: nlDoc };
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
        .then(function (r) { return r.json().then(function (body) { return { ok: r.ok, body: body }; }); })
        .then(function (res) {
          if (!res.ok) { el("newsletterMsg").textContent = res.body.error || "Save failed."; return; }
          el("newsletterMsg").textContent = "Saved.";
          loadNewsletters();
          loadNewsletterInto(res.body.id);
        })
        .catch(function () {
          el("newsletterMsg").textContent = "Save failed.";
        });
    });

    el("newsletterSend").addEventListener("click", function () {
      var id = el("newsletterId").value;
      if (!id) return;
      nlShowSendConfirm(id, el("newsletterSend"));
    });
  }

  // The actual send POST, run only after the admin confirms in the dialog.
  function nlDoSend(id, sendBtn, closeModal) {
    sendBtn.disabled = true;
    el("newsletterMsg").textContent = "Sending…";
    authFetch("/api/admin/newsletters/" + id + "/send", { method: "POST" })
      .then(function (res) {
        if (!res.ok) throw new Error("send failed: " + res.status);
        return res.json();
      })
      .then(function (r) {
        var msg = "Sent to " + (r.sentCount != null ? r.sentCount : r.recipientCount) + " of " + r.recipientCount + " subscriber(s).";
        if (r.failedCount) msg += " " + r.failedCount + " failed: " + (r.failedEmails || []).join(", ");
        el("newsletterMsg").textContent = msg;
        loadNewsletters();
        loadNewsletterInto(id);
      })
      .catch(function () {
        sendBtn.disabled = false;
        el("newsletterMsg").textContent = "Send failed (already sent, or not permitted).";
      })
      .finally(function () { if (closeModal) closeModal(); });
  }

  // Centered confirmation dialog for sending. Shows the recipient count and an info tooltip listing
  // the consenting donor emails the send will reach (fetched from the admin-only recipients endpoint,
  // the same list the server sends to). Cancel / Esc / backdrop click dismiss without sending; "Yes,
  // send" runs nlDoSend. Focus moves into the dialog on open and returns to the Send button on close.
  function nlShowSendConfirm(id, sendBtn) {
    var prevFocus = doc.activeElement;
    var overlay = doc.createElement("div");
    overlay.className = "nl-modal-overlay";
    overlay.innerHTML =
      '<div class="nl-modal" role="dialog" aria-modal="true" aria-labelledby="nlModalTitle">' +
      '<h3 class="nl-modal-title" id="nlModalTitle">Send this newsletter?</h3>' +
      '<p class="nl-modal-text">Are you sure you want to send this newsletter?' +
      '<span class="nl-recipients"><button type="button" class="nl-info" aria-label="Who will receive this?">' +
      '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>' +
      '</button><span class="nl-tooltip" role="tooltip"><span class="nl-tooltip-head">Loading recipients…</span></span></span></p>' +
      '<p class="nl-modal-count" aria-live="polite">Loading recipient list…</p>' +
      '<div class="nl-modal-actions">' +
      '<button type="button" class="nl-modal-cancel">Cancel</button>' +
      '<button type="button" class="nl-modal-confirm">Yes, send</button>' +
      "</div></div>";
    doc.body.appendChild(overlay);

    var confirmBtn = overlay.querySelector(".nl-modal-confirm");
    var cancelBtn = overlay.querySelector(".nl-modal-cancel");
    var tooltip = overlay.querySelector(".nl-tooltip");
    var countEl = overlay.querySelector(".nl-modal-count");
    var closed = false;

    function close() {
      if (closed) return;
      closed = true;
      doc.removeEventListener("keydown", onKey);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      if (prevFocus && prevFocus.focus) prevFocus.focus();
    }
    function onKey(e) {
      if (e.key === "Escape") { e.preventDefault(); close(); }
    }
    doc.addEventListener("keydown", onKey);
    overlay.addEventListener("mousedown", function (e) { if (e.target === overlay) close(); });
    cancelBtn.addEventListener("click", close);
    confirmBtn.addEventListener("click", function () {
      confirmBtn.disabled = true;
      cancelBtn.disabled = true;
      confirmBtn.textContent = "Sending…";
      nlDoSend(id, sendBtn, close);
    });
    confirmBtn.focus();

    // Populate the recipient count + email list. Send stays available even if this lookup fails —
    // the server recomputes the authoritative list at send time.
    authFetch("/api/admin/newsletters/recipients")
      .then(function (res) { if (!res.ok) throw new Error(String(res.status)); return res.json(); })
      .then(function (r) {
        var emails = r.emails || [];
        var n = typeof r.count === "number" ? r.count : emails.length;
        countEl.textContent = "This will be sent to " + n + " consenting subscriber" + (n === 1 ? "" : "s") + ".";
        var list = emails.map(function (e) { return '<span class="nl-tooltip-email">' + H.escapeHtml(e) + "</span>"; }).join("");
        tooltip.innerHTML = '<span class="nl-tooltip-head">Recipients (' + n + ')</span>' +
          (list || '<span class="nl-tooltip-email">No consenting subscribers.</span>');
      })
      .catch(function () {
        countEl.textContent = "Recipient count unavailable — the send will still reach all consenting subscribers.";
        tooltip.innerHTML = '<span class="nl-tooltip-head">Could not load the recipient list.</span>';
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
    var canWrite = canEdit("donations");
    var info =
      '<dl class="admin-dl">' +
      dl("Name", d.fullName) +
      dl("Email", d.email || "None on file") +
      dl("Email consent", d.emailConsent ? "Yes" : "No") +
      dl("Anonymous", d.anonymous ? "Yes" : "No") +
      dl("Hidden from supporters wall", d.hiddenFromSupporters ? "Yes" : "No") +
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
        editCheck("hiddenFromSupporters", "Hide from supporters wall", d.hiddenFromSupporters) +
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
      if (d.subscriptionPlan && d.subscriptionId) actions += '<button class="btn btn-ghost" type="button" id="cancelSubBtn">Cancel monthly donation</button>';
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
          hiddenFromSupporters: el("edit-hiddenFromSupporters").checked,
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
      if (!window.confirm("Cancel this donor's monthly donation?")) return;
      authFetch("/api/admin/donors/" + currentDonorId + "/subscription/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscriptionId: d.subscriptionId, accepted: "cancel" }),
      })
        .then(function (res) {
          donorStatus(res.ok ? "Monthly donation cancelled." : "Could not cancel the monthly donation.");
          if (res.ok) openDonor(currentDonorId);
        })
        .catch(function () {
          donorStatus("Could not cancel the monthly donation.");
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
      var contact = t.closest("[data-contact]");
      if (contact) return openContact(contact.getAttribute("data-contact"));
      var sub = t.closest("[data-submit-batch]");
      if (sub) return submitBatch(sub.getAttribute("data-submit-batch"));
      var exp = t.closest("[data-export-batch]");
      if (exp) return exportBatch(exp.getAttribute("data-export-batch"));
      var fulfil = t.closest("[data-fulfil-mark]");
      if (fulfil) return markFulfilment(fulfil.getAttribute("data-fulfil-id"), fulfil.getAttribute("data-fulfil-mark"));
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
  // Fill a <select> with AdminHelpers.SIGNERS — the ONE list of who can sign for NBCC (TASK-251).
  // Both the thank-you letter's picker and the newsletter sign-off block are built from it, so a
  // signer joining or leaving updates both. Built at script-eval, before anything reads .value, since
  // tyUpdateSigner below dereferences selectedOptions[0] and an empty select would throw.
  function fillSignerSelect(select) {
    if (!select) return;
    select.innerHTML = "";
    (H.SIGNERS || []).forEach(function (s) {
      var o = doc.createElement("option");
      o.value = s.name;
      o.textContent = s.name;
      o.setAttribute("data-role", s.role);
      select.appendChild(o);
    });
  }
  fillSignerSelect(el("tySigner"));

  function tyUpdateSigner() {
    var opt = el("tySigner").selectedOptions[0];
    if (!opt) return; // defensive: never let a missing signer take the whole letter form down
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
      var html = "With heartfelt thanks for your donation of <b>" + tyMoney(n) + "</b>.";
      if (el("tyGiftAid").checked) {
        html +=
          '<span class="ty-ganote">Because you Gift Aided it, HMRC adds 25%, making your donation worth <b>' +
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
      '<table class="admin-table"><thead><tr><th>Donor</th><th>Largest donation</th><th>Gift Aid</th><th>Status</th><th></th></tr></thead><tbody>' +
      body +
      "</tbody></table>"
    );
  }
  function tySentTable(rows, canWrite) {
    if (!rows.length) return '<p class="admin-empty">No thank-you letters sent yet.</p>';
    var body = rows
      .map(function (r) {
        var gift =
          r.giftType === "in_kind"
            ? "Gift in kind" + (r.giftInKind ? ': <span class="admin-sub">' + H.escapeHtml(r.giftInKind) + "</span>" : "")
            : H.formatPence(r.giftAmountPence) + (r.giftAided ? ' <span class="ty-pill ty-pill-ga">Gift Aided</span>' : "");
        var view = r.printUrl
          ? '<a class="admin-link" href="' + H.escapeHtml(r.printUrl) + '" target="_blank" rel="noopener">View letter</a>'
          : "";
        var del = canWrite
          ? '<button class="admin-link ty-del" type="button" data-ty-delete="' + r.id + '" data-ty-name="' + H.escapeHtml(r.thankYouName) + '">Delete</button>'
          : "";
        var actions = view + (view && del ? " · " : "") + del;
        return (
          "<tr><td>" + H.fmtDate(r.sentAt) + "</td><td>" + H.escapeHtml(r.thankYouName) + '<span class="admin-sub">' + H.escapeHtml(r.recipientEmail) +
          "</span></td><td>" + gift + "</td><td>" + H.escapeHtml(r.signedByName) + "</td><td>" + H.escapeHtml(r.sentBy) + "</td><td>" + actions + "</td></tr>"
        );
      })
      .join("");
    return (
      '<table class="admin-table"><thead><tr><th>Sent</th><th>Recipient</th><th>Gift</th><th>Signed by</th><th>By</th><th></th></tr></thead><tbody>' +
      body +
      "</tbody></table>"
    );
  }

  function loadThankYouEligible() {
    var canWrite = canEdit("thank-you");
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
    var canWrite = canEdit("thank-you");
    el("tySentTable").innerHTML = '<p class="admin-loading">Loading…</p>';
    authFetch("/api/admin/thank-you/sent")
      .then(j)
      .then(function (d) {
        el("tySentTable").innerHTML = tySentTable(d.results || [], canWrite);
      })
      .catch(function () {
        el("tySentTable").innerHTML = '<p class="admin-empty">Could not load the sent history.</p>';
      });
  }
  // Delete a sent-letter row (Editor+; server enforces), after a confirm. Then refresh the history.
  function tyDeleteSent(id, name) {
    if (!window.confirm('Delete the thank-you letter to "' + name + '" from the history? This cannot be undone.')) return;
    authFetch("/api/admin/thank-you/sent/" + encodeURIComponent(id), { method: "DELETE" })
      .then(function (res) {
        if (!res.ok) throw new Error("delete failed: " + res.status);
        loadThankYouSent();
      })
      .catch(function () {
        el("tySentTable").innerHTML = '<p class="admin-empty">Could not delete that letter. Please try again.</p>';
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
      ccEmail: (el("tyCc").value || "").trim() || null,
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
          status.textContent = "Sent and logged: the donor has been emailed this letter.";
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
    el("tySend").hidden = !canEdit("thank-you");
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
    el("tySentTable").addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest("[data-ty-delete]");
      if (!b) return;
      tyDeleteSent(b.getAttribute("data-ty-delete"), b.getAttribute("data-ty-name") || "this donor");
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

  // ---- supporters ticker (REQ-003 · TASK-178) ----
  // Admin-curated list shown scrolling under the site nav. List (Viewer+) + add/toggle/delete
  // (Editor+, server-enforced). Wired once (tickerWired); the table's actions are delegated.
  var tickerWired = false;
  function tickerStatus(msg, cls) {
    var s = el("tickerStatus");
    if (!s) return;
    s.className = "ty-status" + (cls ? " " + cls : "");
    s.textContent = msg || "";
  }
  function tickerTable(rows, canWrite) {
    if (!rows.length) return '<p class="admin-empty">No partners yet. Add one above.</p>';
    var body = rows
      .map(function (r) {
        var state = r.active
          ? '<span class="ty-pill ty-pill-ready">Showing</span>'
          : '<span class="ty-pill ty-pill-blocked">Hidden</span>';
        var actions = canWrite
          ? '<button class="admin-link" type="button" data-ticker-toggle="' + r.id + '" data-active="' + (r.active ? "1" : "0") + '">' +
            (r.active ? "Hide" : "Show") + "</button>" +
            ' · <button class="admin-link ty-del" type="button" data-ticker-delete="' + r.id + '" data-ticker-name="' + H.escapeHtml(r.name) + '">Delete</button>'
          : "";
        return "<tr><td>" + H.escapeHtml(r.name) + "</td><td>" + state + "</td><td>" + actions + "</td></tr>";
      })
      .join("");
    return (
      '<table class="admin-table"><thead><tr><th>Partner</th><th>Status</th><th></th></tr></thead><tbody>' +
      body +
      "</tbody></table>"
    );
  }
  function loadTicker() {
    tickerWire();
    var canWrite = canEdit("ticker");
    el("tickerTable").innerHTML = '<p class="admin-loading">Loading…</p>';
    authFetch("/api/admin/ticker")
      .then(j)
      .then(function (d) {
        var rows = d.results || [];
        el("tickerTable").innerHTML = tickerTable(rows, canWrite);
        var showing = rows.filter(function (r) { return r.active; }).length;
        el("tickerCount").textContent = rows.length + " total · " + showing + " showing";
      })
      .catch(function () {
        el("tickerTable").innerHTML = '<p class="admin-empty">Could not load supporters.</p>';
      });
  }
  function tickerWire() {
    if (tickerWired) return;
    tickerWired = true;
    var canWrite = canEdit("ticker");
    el("tickerAdd").hidden = !canWrite;
    el("tickerForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var name = (el("tickerName").value || "").trim();
      if (!name) return;
      tickerStatus("Adding…");
      authFetch("/api/admin/ticker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name }),
      })
        .then(function (res) {
          if (!res.ok) throw new Error("add failed");
          el("tickerName").value = "";
          tickerStatus("Added.", "is-ok");
          loadTicker();
        })
        .catch(function () {
          tickerStatus("Could not add that supporter.", "is-error");
        });
    });
    el("tickerTable").addEventListener("click", function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var toggle = t.closest("[data-ticker-toggle]");
      if (toggle) {
        var makeActive = toggle.getAttribute("data-active") === "0";
        authFetch("/api/admin/ticker/" + toggle.getAttribute("data-ticker-toggle"), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ active: makeActive }),
        })
          .then(function (res) { if (res.ok) loadTicker(); })
          .catch(function () {});
        return;
      }
      var del = t.closest("[data-ticker-delete]");
      if (del) {
        if (!window.confirm('Remove "' + (del.getAttribute("data-ticker-name") || "this partner") + '" from the partners list?')) return;
        authFetch("/api/admin/ticker/" + del.getAttribute("data-ticker-delete"), { method: "DELETE" })
          .then(function (res) { if (res.ok) loadTicker(); })
          .catch(function () {});
      }
    });
  }

  // ---- My account (Admin Phase 4, TASK-197): self-service name + password change. Reached only
  // from the topbar accountBtn (see bindClick("accountBtn", ...) above) - every signed-in user may
  // manage their OWN account here, so there is no permission gate (mirrors authorizeAny server-side:
  // the write endpoints always act on claims.sub, never an id from the form). ----
  var accountWired = false;
  function accountStatus(id, msg, cls) {
    var s = el(id);
    if (!s) return;
    s.className = "ty-status" + (cls ? " " + cls : "");
    s.textContent = msg || "";
  }
  function loadAccount() {
    accountWire();
    accountStatus("accountNameStatus", "");
    accountStatus("accountPasswordStatus", "");
    authFetch("/api/admin/me")
      .then(j)
      .then(function (d) {
        el("accountEmail").value = d.email || "";
        el("accountName").value = d.fullName || "";
      })
      .catch(function () {
        accountStatus("accountNameStatus", "Could not load your account.", "is-error");
      });
  }
  function accountWire() {
    if (accountWired) return;
    accountWired = true;

    var nameForm = el("accountNameForm");
    if (nameForm) {
      nameForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var fullName = (el("accountName").value || "").trim();
        if (!fullName) return;
        accountStatus("accountNameStatus", "Saving…");
        authFetch("/api/admin/me", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fullName: fullName }),
        })
          .then(function (res) {
            // Honest-save: only ever report success on a 200.
            return res.ok
              ? res.json()
              : res.json().then(function (b) {
                  throw new Error((b && b.error) || "Could not save your name.");
                });
          })
          .then(function (d) {
            el("accountName").value = d.fullName || fullName;
            accountStatus("accountNameStatus", "Saved.", "is-ok");
          })
          .catch(function (e2) {
            accountStatus("accountNameStatus", e2.message || "Could not save your name.", "is-error");
          });
      });
    }

    var passwordForm = el("accountPasswordForm");
    if (passwordForm) {
      passwordForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var current = el("accountCurrentPassword").value;
        var next = el("accountNewPassword").value;
        var confirm = el("accountConfirmPassword").value;
        // Client-side checks first - matches the invite/reset rule (10-char minimum); the server
        // re-validates via mePasswordSchema regardless.
        if (next.length < 10) {
          accountStatus("accountPasswordStatus", "New password must be at least 10 characters.", "is-error");
          return;
        }
        if (next !== confirm) {
          accountStatus("accountPasswordStatus", "New password and confirmation do not match.", "is-error");
          return;
        }
        accountStatus("accountPasswordStatus", "Saving…");
        authFetch("/api/admin/me/password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ currentPassword: current, newPassword: next }),
        })
          .then(function (res) {
            if (res.status === 400) {
              return res.json().then(function (b) {
                accountStatus(
                  "accountPasswordStatus",
                  b && b.error === "wrong_password" ? "That current password is not right." : "Could not change your password.",
                  "is-error"
                );
              });
            }
            // Honest-save: fields only clear and "Password changed" only shows on a real 200.
            if (!res.ok) {
              accountStatus("accountPasswordStatus", "Could not change your password.", "is-error");
              return null;
            }
            return res.json().then(function () {
              el("accountCurrentPassword").value = "";
              el("accountNewPassword").value = "";
              el("accountConfirmPassword").value = "";
              accountStatus("accountPasswordStatus", "Password changed.", "is-ok");
            });
          })
          .catch(function () {
            accountStatus("accountPasswordStatus", "Could not change your password.", "is-error");
          });
      });
    }
  }

  // ---- boot: restore an in-tab session ----
  var claims = H.parseClaims(token());
  if (claims && typeof claims.exp === "number" && claims.exp > Date.now()) showApp(claims);
  else {
    clearToken();
    showLogin();
  }
})();
