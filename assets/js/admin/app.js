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
  var storiesArchiveView = "live"; // TASK-311: "live" or "archived" - archived is never the default
  var currentContactId = null; // the contact enquiry open in the detail view
  var contactStatusFilter = ""; // Contact form view status filter ("" = all)
  var teamRows = []; // last-loaded Team rows, cached so "Manage access" doesn't need a single-user GET
  var currentTeamPermUserId = null; // the user id open in the Manage access (matrix) view

  // ---- permission model (Admin Phase 2 · TASK-186) ----
  // A small client-side mirror of src/admin/permissions.ts. The server is the real gate on every
  // route (authorizeSection) - this only drives nav filtering and write-control visibility, plus the
  // Team matrix editor's presets/pre-fill, all of which are UX conveniences, not security.
  // KEEP IN SYNC with SECTIONS in src/admin/permissions.ts. The permissions PATCH validates a
  // COMPLETE, .strict() matrix built from the server's list, so a section missing here makes
  // every permissions save fail with a 400 — not a cosmetic drift.
  var SECTIONS = [
    "overview", "search", "donations", "claims", "gasds", "subscriptions", "stories",
    "ticker", "ball", "contact", "newsletter", "thank-you", "audit", "team",
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
      nlRefreshAudiences(); // TASK-259: fill the audience pickers once permissions are known
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
  Array.prototype.forEach.call(doc.querySelectorAll("#storiesViewFilter .admin-seg"), function (b) {
    b.addEventListener("click", function () {
      storiesArchiveView = b.getAttribute("data-view") || "live";
      Array.prototype.forEach.call(doc.querySelectorAll("#storiesViewFilter .admin-seg"), function (x) {
        x.classList.toggle("is-active", x === b);
      });
      loadStories();
    });
  });
  if (el("storiesDiagnosticsRun")) {
    el("storiesDiagnosticsRun").addEventListener("click", runStoriesDiagnostics);
  }
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
    // TASK-311: two independent filters - where a story is in the workflow, and whether it is
    // archived. Both travel to the API; the server decides what each view means.
    var query = [];
    if (storiesStatusFilter) query.push("status=" + encodeURIComponent(storiesStatusFilter));
    if (storiesArchiveView) query.push("view=" + encodeURIComponent(storiesArchiveView));
    var path = "/api/admin/stories" + (query.length ? "?" + query.join("&") : "");
    authFetch(path)
      .then(j)
      .then(function (d) {
        wrap.innerHTML = storiesTable(d.results || []);
      })
      .catch(function () {
        wrap.innerHTML = '<p class="admin-empty">Unavailable.</p>';
      });
  }
  // TASK-309: read the storage diagnostic and lay it out plainly. Deliberately shows SIZES: an
  // empty database sits near the Postgres minimum, so a much larger one that nothing is connected to
  // is the strongest available sign that the original data is still there and simply orphaned.
  function runStoriesDiagnostics() {
    var out = el("storiesDiagnosticsOut");
    if (!out) return;
    out.innerHTML = '<p class="admin-loading">Checking…</p>';
    authFetch("/api/admin/diagnostics/stories")
      .then(j)
      .then(function (d) {
        var dbs = d.databasesOnInstance || [];
        var connected = d.connectedDatabase || "(unknown)";
        var rows = dbs
          .map(function (db) {
            var isConnected = db.name === connected;
            return "<tr><td>" + H.escapeHtml(db.name) + (isConnected ? " <b>(in use)</b>" : "") +
              "</td><td>" + H.escapeHtml(db.size || "") + "</td></tr>";
          })
          .join("");
        // TASK-310: the sentence that decides whether this is a recovery job at all. The id counter
        // never goes backwards, so it separates "none was ever submitted" from "some were removed".
        var ever = d.storiesEverCreated;
        var verdict;
        if (ever === null || ever === undefined) {
          verdict = '<p class="admin-muted">Could not read the creation counter.</p>';
        } else if (ever === 0) {
          verdict =
            "<p><b>No story has ever been submitted to this database.</b> Nothing has been deleted —" +
            " there was never anything here to lose.</p>";
        } else {
          verdict =
            "<p><b>" + H.escapeHtml(String(ever)) + " stories have been created here at some point</b>," +
            " and " + H.escapeHtml(String(d.storiesRowCount)) + " remain. The rest were deleted, and" +
            " are recoverable from a backup.</p>";
        }
        out.innerHTML =
          "<p>Reading from <b>" + H.escapeHtml(connected) + "</b> — it holds <b>" +
          H.escapeHtml(String(d.storiesRowCount)) + "</b> stories.</p>" + verdict +
          '<table class="admin-table"><thead><tr><th>Database on this server</th><th>Size</th></tr></thead><tbody>' +
          rows + "</tbody></table>" +
          '<p class="admin-muted">If a database you are NOT reading from is much larger, that is very' +
          " likely where the stories are. Nothing here can change or delete anything.</p>";
      })
      .catch(function () {
        out.innerHTML = '<p class="admin-empty">Could not read the storage details.</p>';
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
        // TASK-311: archiving is now the everyday way to clear a story off the working list, and it
        // is reversible. Three stories were permanently deleted from production and nothing could say
        // what had gone - so the irreversible action no longer sits where the routine one belongs.
        //
        // Erasure is still here, because a charity must be able to honour a GDPR erasure request. It
        // appears ONLY once a story is archived, and asks for a reason that is recorded.
        (s.archived_at
          ? '<div class="admin-danger-zone">' +
            '<h3 class="admin-subhead">Archived</h3>' +
            '<p class="admin-danger-copy">This story is archived and hidden from the main list. Restore it to bring it back, or erase it permanently — erasing cannot be undone, and asks you to say why so there is a record of what was removed.</p>' +
            '<button class="btn" type="button" id="restoreStoryBtn">Restore</button> ' +
            '<button class="btn btn-danger" type="button" id="eraseStoryBtn">Erase permanently</button>' +
            "</div>"
          : '<div class="admin-danger-zone">' +
            '<h3 class="admin-subhead">Archive</h3>' +
            '<p class="admin-danger-copy">Archiving hides this story from the main list and keeps it safe — you can bring it back at any time. It is different from Withdraw, which only stops the story being used.</p>' +
            '<button class="btn" type="button" id="archiveStoryBtn">Archive</button>' +
            "</div>");
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
    bindClick("archiveStoryBtn", archiveStory);
    bindClick("restoreStoryBtn", restoreStory);
    bindClick("eraseStoryBtn", eraseStory);
  }
  // TASK-311: a stronger, explicit prompt than Withdraw's, naming the action as permanent erasure
  // rather than a generic "are you sure", since this cannot be
  // undone (DELETE /api/admin/stories/:id, not a status flag). On success, returns to the
  // Stories list and refreshes it, since the detail view has nothing left to show.
  // TASK-311: the everyday action. Reversible, so it asks nothing and explains where the story went.
  function archiveStory() {
    authFetch("/api/admin/stories/" + currentStoryId + "/archive", { method: "POST" })
      .then(function (res) {
        if (res.ok) selectView("stories");
        else storyStatus("Could not archive the story.");
      })
      .catch(function () { storyStatus("Could not archive the story."); });
  }

  function restoreStory() {
    authFetch("/api/admin/stories/" + currentStoryId + "/restore", { method: "POST" })
      .then(function (res) {
        if (res.ok) selectView("stories");
        else storyStatus("Could not restore the story.");
      })
      .catch(function () { storyStatus("Could not restore the story."); });
  }

  // TASK-311: permanent erasure. Kept because a charity must be able to honour a GDPR erasure
  // request - but it asks for a reason, and the server refuses unless the story is archived first.
  // The reason is recorded so that what was erased stays knowable after the story itself is gone.
  function eraseStory() {
    var reason = window.prompt(
      "Erase this story permanently?\n\nThis cannot be undone. Say why — it is recorded so there is a" +
        " record of what was removed, even though the story itself will be gone.\n\nReason:",
    );
    if (reason === null) return;
    if (!reason.trim()) { storyStatus("A reason is needed to erase a story."); return; }
    authFetch("/api/admin/stories/" + currentStoryId, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: reason.trim() }),
    })
      .then(function (res) {
        if (res.ok) selectView("stories");
        else res.json().then(function (b) { storyStatus(b.error || "Could not erase the story."); })
          .catch(function () { storyStatus("Could not erase the story."); });
      })
      .catch(function () { storyStatus("Could not erase the story."); });
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
        '<button class="btn" type="button" id="contactArchiveBtn">Archive</button>' +
        '<button class="btn" type="button" id="contactRestoreBtn" hidden>Restore</button>' +
        '<button class="btn btn-danger" type="button" id="contactEraseBtn" hidden>Erase permanently</button>' +
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
    // TASK-311: an archived message offers Restore and Erase; a live one offers only Archive. The
    // permanent action is never on screen beside the everyday one.
    bindClick("contactArchiveBtn", archiveContact);
    bindClick("contactRestoreBtn", restoreContact);
    bindClick("contactEraseBtn", eraseContact);
    if (c && c.archived_at) {
      if (el("contactArchiveBtn")) el("contactArchiveBtn").hidden = true;
      if (el("contactRestoreBtn")) el("contactRestoreBtn").hidden = false;
      if (el("contactEraseBtn")) el("contactEraseBtn").hidden = false;
    }
  }
  // TASK-311: archiving is the everyday action for a message from a real person.
  function archiveContact() {
    authFetch("/api/admin/contact/" + currentContactId + "/archive", { method: "POST" })
      .then(function (res) {
        if (res.ok) selectView("contact");
        else contactStatus("Could not archive the message.");
      })
      .catch(function () { contactStatus("Could not archive the message."); });
  }

  function restoreContact() {
    authFetch("/api/admin/contact/" + currentContactId + "/restore", { method: "POST" })
      .then(function (res) {
        if (res.ok) selectView("contact");
        else contactStatus("Could not restore the message.");
      })
      .catch(function () { contactStatus("Could not restore the message."); });
  }

  function eraseContact() {
    var reason = window.prompt(
      "Erase this message permanently?\n\nThis cannot be undone. Say why — it is recorded so there is" +
        " a record of what was removed, even though the message itself will be gone.\n\nReason:",
    );
    if (reason === null) return;
    if (!reason.trim()) { contactStatus("A reason is needed to erase a message."); return; }
    authFetch("/api/admin/contact/" + currentContactId, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: reason.trim() }),
    })
      .then(function (res) {
        if (res.ok) selectView("contact");
        else res.json().then(function (b) { contactStatus(b.error || "Could not erase the message."); })
          .catch(function () { contactStatus("Could not erase the message."); });
      })
      .catch(function () { contactStatus("Could not erase the message."); });
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
          items: { fields: [{ k: "imageUrl", label: "Image", kind: "image" }, { k: "title", label: "Title" }, { k: "body", label: "Body", kind: "textarea" }, { k: "label", label: "Link label" }, { k: "href", label: "Link", kind: "url" }] } },
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
  // TASK-291: a padlock and a globe, on the same grid and stroke weight as every other icon here.
  var NL_VIS_ICONS = {
    lock:
      '<rect x="4.5" y="10.5" width="15" height="10" rx="2"/>' +
      '<path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
    globe:
      '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17"/>' +
      '<path d="M12 3.5a13 13 0 0 1 0 17 13 13 0 0 1 0-17"/>',
  };
  function nlVisIcon(name) {
    return '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" ' +
      'stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      (NL_VIS_ICONS[name] || "") + "</svg>";
  }

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

  // TASK-289: which blocks are collapsed, keyed by the block OBJECT rather than its index.
  // nlRenderCanvas rebuilds everything on every change, and an index-keyed set would follow the
  // position instead of the block — so moving block 3 up would collapse whatever landed in its
  // place. A WeakMap also keeps the key off the object itself, so nothing extra is ever saved.
  var nlBlockKeys = new WeakMap();
  var nlNextBlockKey = 1;
  var nlCollapsed = new Set();

  // Set when a whole document arrives, applied on the next render. Doing it here rather than at the
  // call sites means every path that loads a newsletter gets the same behaviour.
  var nlCollapseAllOnNextRender = false;

  function nlKeyFor(block) {
    if (!nlBlockKeys.has(block)) nlBlockKeys.set(block, nlNextBlockKey++);
    return nlBlockKeys.get(block);
  }

  function nlToggleBlock(key) {
    if (nlCollapsed.has(key)) nlCollapsed.delete(key);
    else nlCollapsed.add(key);
    nlRenderCanvas();
  }

  function nlSetAllCollapsed(on) {
    nlCollapsed.clear();
    if (on) (nlDoc.blocks || []).forEach(function (b) { nlCollapsed.add(nlKeyFor(b)); });
    nlRenderCanvas();
  }

  /**
   * A one-line hint of what a collapsed block contains. Takes the first piece of real text in
   * the block's data, so a Text block shows its opening words and a Button shows its label —
   * without this a long newsletter collapses into a stack of indistinguishable bars.
   */
  function nlBlockSummary(block) {
    var data = block && block.data;
    if (!data) return "";
    var preferred = ["heading", "title", "label", "text", "lead", "name", "caption", "href", "src"];
    for (var i = 0; i < preferred.length; i++) {
      var v = data[preferred[i]];
      if (typeof v === "string" && v.trim()) return nlTrim(v);
    }
    for (var k in data) {
      if (typeof data[k] === "string" && data[k].trim()) return nlTrim(data[k]);
    }
    return "";
  }

  function nlTrim(v) {
    var t = String(v).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    return t.length > 64 ? t.slice(0, 63) + "\u2026" : t;
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
    var countEl = el("nlCanvasCount");
    if (countEl) {
      var n = (nlDoc.blocks || []).length;
      countEl.textContent = n === 1 ? "1 block" : n + " blocks";
    }
    if (nlCollapseAllOnNextRender) {
      nlCollapseAllOnNextRender = false;
      nlCollapsed.clear();
      nlDoc.blocks.forEach(function (b) { nlCollapsed.add(nlKeyFor(b)); });
    }
    nlDoc.blocks.forEach(function (block, i) {
      var li = doc.createElement("li");
      var key = nlKeyFor(block);
      var collapsed = nlCollapsed.has(key);
      li.className = "nl-block" + (collapsed ? " is-collapsed" : "");
      var def = nlBlockDefs[block.type] || { label: "Raw HTML", icon: "text" };

      var head = doc.createElement("div");
      head.className = "nl-block-head";
      // The head is the toggle. A collapsed block still says WHAT it holds — a stack of
      // identical "Text" bars you have to open one by one to find the right one is worse than
      // the scrolling it replaced.
      head.innerHTML =
        '<button type="button" class="nl-block-toggle" aria-expanded="' + (collapsed ? "false" : "true") +
        '" aria-label="' + (collapsed ? "Expand" : "Collapse") + ' ' + def.label + '"></button>' +
        '<span class="nl-block-ic">' + nlIcon(def.icon) + "</span>" +
        '<span class="nl-block-title">' + def.label + "</span>" +
        '<span class="nl-block-sum">' + H.escapeHtml(nlBlockSummary(block)) + "</span>";
      head.querySelector(".nl-block-toggle").addEventListener("click", function (e) {
        e.stopPropagation();
        nlToggleBlock(key);
      });
      // Clicking the bar itself toggles too, but never when the click was meant for one of the
      // move/duplicate/delete controls sitting in the same row.
      head.addEventListener("click", function (e) {
        if (e.target.closest(".nl-block-ctrls")) return;
        nlToggleBlock(key);
      });
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

  // TASK-300: fit a picture inside a square bound, keeping its shape. Pure arithmetic, kept as its
  // own function so it can be unit-tested directly (test/unit/newsletter-image-upload.test.ts).
  function nlFitWithin(w, h, max) {
    if (!(w > 0) || !(h > 0)) return { width: max, height: max };
    var scale = Math.min(1, max / Math.max(w, h));
    return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
  }

  // A newsletter image is displayed at most 580px wide, so 1200px is already twice what any screen
  // needs. Anything beyond that is weight nobody sees - and it was the reason uploads vanished.
  var NL_IMAGE_MAX_PX = 1200;
  var NL_IMAGE_QUALITY = 0.82;
  var NL_SHRINK_ABOVE_BYTES = 1024 * 1024; // leave genuinely small pictures untouched

  // Re-encode as the SAME format where it matters: a PNG turned into a JPEG loses transparency and
  // fills it black, which would quietly wreck a logo.
  function nlShrinkMime(mime) {
    if (mime === "image/png") return "image/png";
    if (mime === "image/webp") return "image/webp";
    return "image/jpeg";
  }

  // TASK-300: shrink a photo in the browser BEFORE uploading. Phone photos are 3-12 MB; the upload
  // cap is 2 MB, and base64 adds a third on top. Calls back with null when shrinking is not possible
  // or not wanted, and the caller then sends the original bytes - so nothing regresses, we just stop
  // failing on the common case. Animated GIFs are never touched: a canvas would flatten them to one
  // frame.
  function nlShrinkImage(f, done) {
    var canMeasure = window.URL && window.URL.createObjectURL && doc.createElement("canvas").getContext;
    if (!canMeasure || f.type === "image/gif") return done(null);
    var url = window.URL.createObjectURL(f);
    var img = new window.Image();
    var finish = function (out) { try { window.URL.revokeObjectURL(url); } catch (e) {} done(out); };
    img.onerror = function () { finish(null); };
    img.onload = function () {
      try {
        var w = img.naturalWidth, h = img.naturalHeight;
        var tooWide = w > NL_IMAGE_MAX_PX || h > NL_IMAGE_MAX_PX;
        if (!tooWide && f.size <= NL_SHRINK_ABOVE_BYTES) return finish(null); // already fine as-is
        var box = nlFitWithin(w, h, NL_IMAGE_MAX_PX);
        var canvas = doc.createElement("canvas");
        canvas.width = box.width;
        canvas.height = box.height;
        canvas.getContext("2d").drawImage(img, 0, 0, box.width, box.height);
        var mime = nlShrinkMime(f.type);
        var dataUrl = canvas.toDataURL(mime, NL_IMAGE_QUALITY);
        var comma = dataUrl.indexOf(",");
        if (comma === -1) return finish(null);
        // toDataURL falls back to PNG when it does not know the type, so trust the URL, not our guess.
        var actual = dataUrl.slice(5, dataUrl.indexOf(";"));
        finish({ mime: actual || mime, base64: dataUrl.slice(comma + 1) });
      } catch (e) {
        finish(null);
      }
    };
    img.src = url;
  }

  // What to say when the server answered but not with something we can use. The old code read every
  // response as JSON; a body refused by the parser comes back as HTML and threw into a chain with no
  // catch, so the upload vanished without a word.
  function nlUploadHttpMessage(status) {
    if (status === 413) return "That picture is too large to upload. Try a smaller one.";
    if (status === 400) return "That file type is not supported. Use a JPG, PNG, GIF or WebP.";
    if (status === 403) return "You do not have permission to upload images.";
    return "Upload failed. Please try again.";
  }

  // An image field: URL input + "NBCC library" quick-pick + Upload (shrinks, then POSTs base64).
  function nlImageField(host, block, key, label) {
    nlText(host, block.data, key, label, { type: "url", hint: "Paste a URL, choose from the NBCC library, or upload." });
    if (nlReadOnly()) return; // read mode: the disabled URL field is shown, but no library/upload tools
    var row = doc.createElement("div");
    row.className = "nl-img-tools";

    var lib = doc.createElement("select");
    lib.innerHTML = "<option value=\"\">NBCC library…</option>" +
      NBCC_IMAGE_LIBRARY.map(function (i) { return "<option value=\"" + i.url + "\">" + i.label + "</option>"; }).join("");
    lib.addEventListener("change", function () {
      if (lib.value) { block.data[key] = lib.value; nlRenderCanvas(); nlSchedulePreview(); }
    });
    row.appendChild(lib);

    var file = doc.createElement("input");
    file.type = "file";
    file.accept = "image/png,image/jpeg,image/webp,image/gif";
    row.appendChild(file);

    // TASK-300: the upload speaks HERE, beside the button that started it. It used to write into
    // #newsletterMsg, which lives in the Send panel - hidden while you are writing - so every
    // failure was invisible and the picture just never appeared.
    var msg = doc.createElement("p");
    msg.className = "nl-img-msg";
    msg.setAttribute("aria-live", "polite");
    function say(text, bad) {
      msg.textContent = text || "";
      if (bad) msg.classList.add("is-bad");
      else msg.classList.remove("is-bad");
    }

    file.addEventListener("change", function () {
      var f = file.files[0];
      if (!f) return;
      say("Preparing picture…", false);
      nlShrinkImage(f, function (shrunk) {
        var body;
        var post = function () {
          say("Uploading…", false);
          authFetch("/api/admin/newsletter-images", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
            .then(function (r) {
              return r.json().then(
                function (j2) { return { ok: r.ok, body: j2 }; },
                function () { return { ok: false, body: { error: nlUploadHttpMessage(r.status) } }; }
              );
            })
            .then(function (res) {
              if (res.ok && res.body && res.body.url) {
                block.data[key] = res.body.url;
                nlRenderCanvas();
                nlSchedulePreview();
                return;
              }
              say((res.body && res.body.error) || nlUploadHttpMessage(0), true);
            })
            .catch(function () {
              say("Could not upload that picture. Check your connection and try again.", true);
            });
        };
        if (shrunk) { body = { mime: shrunk.mime, dataBase64: shrunk.base64, filename: f.name }; return post(); }
        var reader = new FileReader();
        reader.onerror = function () { say("That file could not be read. Try another picture.", true); };
        reader.onload = function () {
          body = { mime: f.type, dataBase64: String(reader.result).split(",")[1], filename: f.name };
          post();
        };
        reader.readAsDataURL(f);
      });
    });

    host.appendChild(row);
    host.appendChild(msg);
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
      // TASK-300: honour kind here too. This loop used to call nlText for every field whatever its
      // kind, so the two-up story style offered a bare text box where every other style offered an
      // upload button - even though the renderer draws a per-item image.
      fields.forEach(function (f) {
        if (f.kind === "image") nlImageField(fs, { data: item }, f.k, f.label);
        else nlText(fs, item, f.k, f.label, { multiline: f.kind === "textarea", type: f.kind === "url" ? "url" : undefined, hint: f.hint });
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
    // TASK-284: bail while the panel is hidden. Since TASK-283 the tab opens on the Overview and
    // prefills the editor in the background, so the preview's load event fires with the Write panel
    // still hidden — clientWidth 0, scale 0, zoom 0, and the iframe collapses to nothing. What you
    // then saw was the wrapper's own background filling its fixed height, which read as a solid
    // block rather than a broken preview. nlShowPanel re-fits when the panel becomes visible.
    if (!wrap.clientWidth) return;
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

  // TASK-272: this is ACCEPTED, not delivered — sentCount is "the relay took it", which is a promise
  // to try, not an arrival. A send where every address hard-bounced still showed "150 / 150" under a
  // column headed Delivered. Real delivery is a webhook fact and lives in the stats panel; the column
  // is now labelled honestly rather than quietly overstating every send.
  function nlDeliveryCell(n) {
    if (n.recipientCount == null) return "-";
    if (n.sentCount == null) return String(n.recipientCount);
    var cell = n.sentCount + " / " + n.recipientCount;
    if (n.failedCount) cell += ' <span class="nl-fail-badge">' + n.failedCount + " failed</span>";
    return cell;
  }

  function renderNewsletterList(rows) {
    if (!rows.length) return '<p class="admin-loading">No newsletters yet.</p>';
    // TASK-271: WHO each one went to. The audience was stamped at send time but never read back, so
    // the history couldn't tell you whether a message reached volunteers or every donor. Older sends
    // predate audiences and were always the newsletter audience.
    // TASK-287: four columns, not seven. The audience and the sender move into the meta line under
    // the subject — they describe the send, they are not things you scan a column of. TASK-278's
    // sent_by is still shown; it just lives with the date it belongs to.
    var html = '<table class="admin-table nl-archive"><thead><tr><th>Newsletter</th><th>Status</th>' +
      '<th class="nl-r">Accepted</th><th></th></tr></thead><tbody>';
    rows.forEach(function (n) {
      var meta = [
        n.sentAt ? new Date(n.sentAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : null,
        n.sentBy || null,
        n.audience || (n.status === "sent" ? "Newsletter" : null),
      ].filter(Boolean).map(H.escapeHtml);
      html +=
        '<tr><td><span class="nl-subj">' + H.escapeHtml(n.subject) + "</span>" +
        '<span class="nl-meta">' + (meta.length ? meta.join(" · ") : "Not sent yet") + "</span></td>" +
        '<td><span class="nl-pill nl-pill-' + H.escapeHtml(n.status) + '">' + H.escapeHtml(n.status) + "</span></td>" +
        '<td class="nl-r">' + nlDeliveryCell(n) + "</td>" +
        '<td class="nl-r nl-archive-acts"><button class="admin-link" type="button" data-edit-newsletter="' + n.id + '">Open</button>' +
        (n.status === "sent" ? '<button class="admin-link" type="button" data-who-got="' + n.id + '">Results</button>' : "") +
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
        "you sent it and to how many people, is kept. What goes is the content, any documents, and " +
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

  // TASK-279: the four stages as switchable panels instead of one long scroll. The tab was ~19,000
  // characters of markup end to end, so reaching the composer meant scrolling past all the audience
  // and people management every time. Everything still exists and every element keeps its id — only
  // what is ON SCREEN at once changed.
  // TASK-283: three DESTINATIONS (Overview, Audiences & people, All newsletters) plus a three-step
  // COMPOSE takeover (Write, Who, Send). The switch below is still one generic mechanism driven by
  // data-nl-panel — the change is what the panels mean, not how they swap.
  var NL_PANELS = [
    "nlPanelOverview",
    "nlPanelAudience",
    "nlPanelWrite",
    "nlPanelWho",
    "nlPanelSend",
    "nlPanelHistory",
    "nlPanelResults",
  ];
  // The three that make up composing. While one of these is live the section wears .is-composing,
  // which is what lifts the composer over the rest of the admin.
  var NL_COMPOSE_PANELS = ["nlPanelWrite", "nlPanelWho", "nlPanelSend"];

  function nlShowPanel(panelId) {
    NL_PANELS.forEach(function (id) {
      var panel = el(id);
      if (panel) panel.hidden = id !== panelId;
    });
    Array.prototype.forEach.call(doc.querySelectorAll("[data-nl-panel]"), function (b) {
      var on = b.getAttribute("data-nl-panel") === panelId;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-current", on ? "true" : "false");
    });
    var composing = NL_COMPOSE_PANELS.indexOf(panelId) !== -1;
    var view = el("view-newsletter");
    if (view) view.classList.toggle("is-composing", composing);
    // Mark the steps already passed, so the rail reads as progress rather than three equal tabs.
    var at = NL_COMPOSE_PANELS.indexOf(panelId);
    Array.prototype.forEach.call(doc.querySelectorAll(".nl-cp-step"), function (b, i) {
      b.classList.toggle("is-done", at > -1 && i < at);
    });
    if (composing) nlPaintComposeFoot(panelId);
    // The preview cannot size itself while hidden (see nlFitPreview), so re-fit the moment the
    // Write panel is on screen and has a real width.
    if (panelId === "nlPanelWrite" && typeof nlFitPreview === "function") nlFitPreview();
    if (panelId === "nlPanelWho") nlRenderAudienceCards();
    if (panelId === "nlPanelSend") { nlPaintSendSummary(); nlRunChecks(); }
    // Coming back to a destination should start at the top of it, not wherever the composer was
    // scrolled to. Only when the page can actually scroll: jsdom has no layout, so calling it there
    // just prints "Not implemented" noise into the test output for no behaviour.
    if (window.pageYOffset > 0 && typeof window.scrollTo === "function") {
      try {
        window.scrollTo({ top: 0, behavior: "smooth" });
      } catch (err) {
        window.scrollTo(0, 0);
      }
    }
  }

  // --- TASK-285: the pre-send checks, on the panel ------------------------------------------------
  // The /preflight endpoint already existed but only ran inside the send confirmation, where it
  // could do nothing except stop you at the last moment. Shown here it becomes something you can
  // act on while there is still time: a dead button link or a missing test send is one click away.
  var nlChecksTimer = null;
  function nlScheduleChecks() {
    if (nlChecksTimer) clearTimeout(nlChecksTimer);
    nlChecksTimer = setTimeout(nlRunChecks, 400);
  }

  function nlRunChecks() {
    var host = el("nlChecks");
    if (!host) return;
    authFetch("/api/admin/newsletters/preflight", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bodyJson: nlDoc,
        subject: (el("newsletterSubject") || {}).value || "",
        // Same flag the confirmation dialog passes, so the panel and the dialog agree about
        // whether a test has gone out for THIS draft.
        testSent: nlTestSent,
      }),
    })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (b) {
        var findings = (b && b.findings) || [];
        // Nothing wrong is itself worth SAYING. A silent empty list reads as "the checks did not
        // run", which is the opposite of the reassurance this panel exists to give.
        if (!findings.length) {
          host.innerHTML =
            '<li><span class="nl-check-mk is-ok" aria-hidden="true"></span><div>' +
            '<b>Everything checks out</b><span>Subject set, every button links somewhere real, and the ' +
            'plain-text version is ready.</span></div></li>';
          return;
        }
        // Blocking findings first: a warning you can live with should never sit above the thing
        // that will actually refuse to send.
        var ordered = findings.slice().sort(function (x, y) {
          return (x.level === "block" ? 0 : 1) - (y.level === "block" ? 0 : 1);
        });
        host.innerHTML = ordered
          .map(function (f) {
            var blocking = f.level === "block";
            return (
              '<li><span class="nl-check-mk is-' + (blocking ? "no" : "warn") + '" aria-hidden="true"></span>' +
              "<div><b>" + H.escapeHtml(f.message) + "</b>" +
              '<span>' + (blocking ? "This one stops a send." : "Worth a look, but it will not stop you.") +
              "</span></div></li>"
            );
          })
          .join("");
      })
      .catch(function () {
        // A failed check must never read like a failed newsletter.
        host.innerHTML =
          '<li><span class="nl-check-mk is-warn" aria-hidden="true"></span><div><b>Could not run the ' +
          'checks</b><span>The send itself still checks before it goes, so nothing unsafe can slip ' +
          'through.</span></div></li>';
      });
  }

  // --- TASK-285: two explicit choices for WHEN ----------------------------------------------------
  // It used to be "fill in a date, or press the button that clears it". Empty-means-now was
  // invisible: nothing on screen told you which you had chosen.
  function nlSetWhen(later) {
    var now = el("nlWhenNow"), lat = el("nlWhenLater"), wrap = el("sendScheduleWrap");
    if (!now || !lat) return;
    now.setAttribute("aria-checked", later ? "false" : "true");
    lat.setAttribute("aria-checked", later ? "true" : "false");
    now.classList.toggle("is-on", !later);
    lat.classList.toggle("is-on", later);
    if (wrap) wrap.hidden = !later;
    // Choosing "now" clears the field, so the two can never disagree about what will happen.
    if (!later && el("sendScheduleAt")) el("sendScheduleAt").value = "";
    nlPaintSendSummary();
  }

  // --- TASK-285: where it landed, as its own destination ------------------------------------------
  function nlShowResults(id) {
    nlShowPanel("nlPanelResults");
    var row = nlLastNewsletters.filter(function (n) { return String(n.id) === String(id); })[0];
    el("nlResultsTitle").textContent = row ? row.subject || "Untitled newsletter" : "Newsletter";
    el("nlResultsMeta").textContent = row
      ? "Sent " + nlWhen(row.sentAt) + (row.sentBy ? " by " + row.sentBy : "") +
        (row.audience ? " to " + row.audience : "")
      : "";
    el("nlResultsWho").onclick = function () { nlShowRecipients(id); };
    el("nlResultsTiles").innerHTML = '<p class="admin-loading">Loading…</p>';
    el("nlResultsLinks").innerHTML = "";
    el("nlResultsRecord").innerHTML = "";
    authFetch("/api/admin/newsletters/" + id + "/stats")
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (st) { nlPaintResults(st, row); })
      .catch(function () {
        el("nlResultsTiles").innerHTML = "";
        el("nlResultsNote").textContent = "Could not load the figures for this send.";
      });
  }

  function nlPaintResults(st, row) {
    var note = el("nlResultsNote");
    if (!st) {
      el("nlResultsTiles").innerHTML = "";
      note.textContent = "No figures for this send.";
      return;
    }
    var acc = st.sends || 0;
    // Accepted is what the relay TOOK, delivered is what a mailbox confirmed. Keeping them apart
    // is the difference between a promise and a fact (TASK-272).
    var tiles = [
      ["Accepted", acc, "Handed to the mail service"],
      ["Delivered", st.delivered, acc ? nlPct(st.delivered, acc) + " of accepted" : ""],
      ["Clicked", st.clicked, acc ? nlPct(st.clicked, acc) + " of accepted" : ""],
      ["Bounced", st.bounced, acc ? nlPct(st.bounced, acc) + " — now blocked" : ""],
      ["Unsubscribed", st.unsubscribed, acc ? nlPct(st.unsubscribed, acc) : ""],
    ];
    el("nlResultsTiles").innerHTML = tiles
      .map(function (t) {
        return (
          '<div class="nl-tile"><span class="nl-tile-k">' + t[0] + '</span>' +
          '<span class="nl-tile-v">' + (t[1] == null ? "—" : t[1]) + '</span>' +
          '<span class="nl-tile-m">' + H.escapeHtml(t[2] || "") + "</span></div>"
        );
      })
      .join("");

    var links = st.links || [];
    el("nlResultsLinks").innerHTML = links.length
      ? '<ul class="nl-attn">' +
        links
          .slice(0, 8)
          .map(function (l) {
            return (
              "<li><div><b>" + H.escapeHtml(l.link) + "</b><span>" + l.uniqueClicks +
              (l.uniqueClicks === 1 ? " person" : " people") +
              (acc ? " · " + nlPct(l.uniqueClicks, acc) : "") + "</span></div></li>"
            );
          })
          .join("") +
        "</ul>"
      : '<p class="admin-empty">No clicks recorded. Click tracking only counts links inside the ' +
        "newsletter, and unsubscribe links are deliberately left out.</p>";

    el("nlResultsRecord").innerHTML =
      nlPair("Sent by", row && row.sentBy ? H.escapeHtml(row.sentBy) : "—") +
      nlPair("Audience", row && row.audience ? H.escapeHtml(row.audience) : "—") +
      nlPair("Accepted", String(acc), true) +
      nlPair("Marked us as spam", String(st.complained == null ? "—" : st.complained), true);
    note.textContent = acc
      ? ""
      : "This send predates delivery tracking, so only the accepted count is on file.";
  }

  // The rows the overview and archive last rendered, so the results view can label itself without
  // a second request for something already in hand.
  var nlLastNewsletters = [];
  // --- TASK-285: the audience as CARDS on step 2 -------------------------------------------------
  // A <select> made the most consequential decision in the flow look like a formality, and hid both
  // what each audience means and how big it is until you opened it. The cards say all of it up
  // front. #sendListPick is kept in sync as the hidden mirror, so the send request, the confirmation
  // and sendAudienceNote all keep reading exactly what they always did.
  // Which audiences are chosen. The hidden #sendListPick still mirrors the FIRST, so anything
  // that has always read it keeps working.
  var nlChosenAudiences = [];

  function nlRenderAudienceCards() {
    var host = el("nlAudienceCards");
    if (!host) return;
    var pick = el("sendListPick");
    // Seed from the mirror the first time, so the audience already selected stays selected.
    if (!nlChosenAudiences.length && pick && pick.value) nlChosenAudiences = [Number(pick.value)];
    if (!nlAudiences.length) {
      host.innerHTML = '<p class="admin-empty">No audiences yet — add one under Audiences &amp; people.</p>';
      return;
    }
    host.innerHTML = nlAudiences
      .map(function (a) {
        var what =
          a.kind === "everyone"
            ? "Donors who agreed to email, plus everyone on the sign-up list. Use this for anything meant for all your supporters."
            : a.kind === "donors"
              ? "Every donor who agreed to email. Nobody adds or removes them by hand — it updates itself as donations come in."
              : "Exactly the people you have put on this list, nobody else.";
        var tag =
          a.kind === "everyone" ? "Everyone" : a.kind === "donors" ? "Automatic" : "";
        var on = nlChosenAudiences.indexOf(a.id) !== -1;
        return (
          '<button type="button" class="nl-aud-card' + (on ? " is-on" : "") + '" role="checkbox"' +
          ' aria-checked="' + (on ? "true" : "false") + '" data-aud-card="' + a.id + '">' +
          '<span class="nl-aud-tick" aria-hidden="true"></span>' +
          '<span class="nl-aud-info"><b>' + H.escapeHtml(a.name) +
          (tag ? ' <span class="nl-pill">' + tag + "</span>" : "") + "</b>" +
          "<span>" + H.escapeHtml(what) + "</span></span>" +
          '<span class="nl-aud-count"><b>' +
          (typeof a.memberCount === "number" ? a.memberCount : "—") +
          "</b><span>people</span></span></button>"
        );
      })
      .join("");
    Array.prototype.forEach.call(host.querySelectorAll("[data-aud-card]"), function (b) {
      b.addEventListener("click", function () {
        var id = Number(b.getAttribute("data-aud-card"));
        var at = nlChosenAudiences.indexOf(id);
        if (at === -1) nlChosenAudiences.push(id);
        else nlChosenAudiences.splice(at, 1);
        // The mirror follows the first choice, so the send request, the confirmation and
        // sendAudienceNote keep reading exactly what they always have.
        if (pick && nlChosenAudiences.length) {
          pick.value = String(nlChosenAudiences[0]);
          pick.dispatchEvent(new Event("change", { bubbles: true }));
        }
        nlRenderAudienceCards();
        nlRefreshReach();
      });
    });
    nlRefreshReach();
  }

  // TASK-288: the reach figure comes from the SERVER, never from adding the audience counts up.
  // Somebody on Volunteers AND Donors is one person and one email; a sum would promise two, and
  // the number shown here is the number the confirmation repeats.
  var nlReachTimer = null;
  function nlRefreshReach() {
    var box = el("nlReach");
    if (!box) return;
    if (!nlChosenAudiences.length) {
      box.hidden = true;
      nlPaintSendSummary();
      return;
    }
    if (nlReachTimer) clearTimeout(nlReachTimer);
    nlReachTimer = setTimeout(function () {
      var ids = nlChosenAudiences.slice();
      authFetch("/api/admin/newsletters/recipients?listIds=" + ids.join(","))
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (b) {
          // A slower earlier request must not overwrite a newer selection.
          if (ids.join(",") !== nlChosenAudiences.join(",")) return;
          nlPaintReachFrom(b, ids);
        })
        .catch(function () { /* the panel is guidance; never block the send on it */ });
    }, 180);
  }

  function nlPaintReachFrom(b, ids) {
    var box = el("nlReach");
    if (!box || !b) return;
    var names = (b.audiences || []).map(function (a) { return a.name; });
    var onLists = ids.reduce(function (sum, id) {
      var a = nlAudienceById(id);
      return sum + (a && typeof a.memberCount === "number" ? a.memberCount : 0);
    }, 0);
    // The gap between the audiences added up and the people actually mailed IS the story when
    // more than one is chosen: it is the people who would otherwise have been mailed twice.
    var overlap = Math.max(0, onLists - b.count);
    nlReachTotal = nlReachTotal == null ? b.count : nlReachTotal;
    box.hidden = false;
    box.innerHTML =
      '<span class="admin-help" style="text-transform:uppercase;letter-spacing:.1em;font-size:.72rem">This newsletter will reach</span>' +
      '<div class="nl-reach-big">' + b.count + "</div>" +
      '<p class="nl-reach-who">people on <b>' + H.escapeHtml(names.join(" + ") || "the chosen audience") + "</b></p>" +
      "<ul>" +
      (names.length > 1
        ? "<li><span>Across " + names.length + " audiences</span><b>" + onLists + "</b></li>" +
          "<li><span>On more than one</span><b>" + overlap + "</b></li>"
        : "<li><span>On the audience</span><b>" + onLists + "</b></li>") +
      "</ul>" +
      '<p class="nl-reach-note">' +
      (names.length > 1
        ? "Anyone on more than one of these gets the newsletter <b>once</b>. Unsubscribed and blocked people are left out automatically."
        : "Anyone who unsubscribed, bounced permanently or reported us as spam is left out automatically. Emailing them is what gets NBCC sent to junk.") +
      "</p>";
    nlPaintSendSummary();
  }

  // TASK-284: the summary beside the Send button. It restates the decisions made on the previous two
  // steps, because the button that mails several hundred people should not be the only thing on
  // screen that has no idea what it is about to do. Every figure is read back from the live controls
  // rather than remembered, so it cannot drift from what will actually happen.
  function nlPaintSendSummary() {
    var box = el("nlSendSummaryList");
    if (!box) return;
    var pick = el("sendListPick");
    var a = pick ? nlAudienceById(pick.value) : null;
    var when = el("sendScheduleAt") && el("sendScheduleAt").value;
    var gradual = el("sendRollout") && el("sendRollout").checked;
    var subject = (el("newsletterSubject") && el("newsletterSubject").value) || "Untitled newsletter";
    var whenText = "Straight away";
    if (when) {
      var d = new Date(when);
      whenText = isNaN(d.getTime())
        ? "Straight away"
        : d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) +
          ", " + d.toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit" });
    }
    box.innerHTML =
      nlPair("Subject", H.escapeHtml(subject)) +
      nlPair("Audience", a ? H.escapeHtml(a.name) : "Not chosen yet") +
      nlPair("Will reach", a ? a.memberCount + (a.memberCount === 1 ? " person" : " people") : "—", true) +
      '<div class="nl-summary-rule"></div>' +
      nlPair("Goes out", H.escapeHtml(whenText)) +
      nlPair("Pace", gradual ? "Gradual, over a few days" : "All at once");
  }

  function nlPair(k, v, num) {
    return (
      '<div class="nl-pair"><dt>' + H.escapeHtml(k) + '</dt><dd' + (num ? ' class="num"' : "") + ">" +
      v + "</dd></div>"
    );
  }

  // --- TASK-285: elements TASK-283 shipped with nothing driving them ------------------------------

  // The compose header echoes the subject, so the takeover always says WHICH newsletter you are in.
  // With the destination rail hidden there is otherwise nothing on screen naming it.
  function nlSyncComposeTitle() {
    var out = el("nlComposeSubject");
    if (!out) return;
    var v = (el("newsletterSubject") && el("newsletterSubject").value || "").trim();
    out.textContent = v || "Untitled newsletter";
  }

  // "Saved" has to be earned: it says nothing until a save actually succeeds, because a label that
  // claims your work is safe when it is not is worse than no label.
  function nlMarkSaved(text) {
    var out = el("nlComposeSaved");
    if (out) out.textContent = text || "";
  }

  // The in-flight strip: a send that is queued, scheduled or running, surfaced on the Overview so
  // it cannot be forgotten about. Reads the same job endpoint the progress bar uses.
  function nlRefreshInflight() {
    var strip = el("nlInflight");
    if (!strip) return;
    authFetch("/api/admin/newsletters/send-jobs/inflight")
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (job) { nlPaintInflight(job); })
      .catch(function () { nlPaintInflight(null); });
  }

  function nlPaintInflight(job) {
    var strip = el("nlInflight");
    var txt = el("nlInflightTxt");
    var open = el("nlInflightOpen");
    if (!strip || !txt) return;
    if (!job || !job.newsletterId) { strip.hidden = true; return; }
    var when = job.scheduledAt ? new Date(job.scheduledAt) : null;
    var whenText = when && !isNaN(when.getTime())
      ? "scheduled for " + when.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }) +
        ", " + when.toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit" })
      : "sending now";
    txt.innerHTML =
      "<b>" + H.escapeHtml(job.subject || "A newsletter") + "</b> is " + H.escapeHtml(whenText) +
      ". <span>You can still change or cancel it.</span>";
    if (open) open.onclick = function () { loadNewsletterInto(job.newsletterId); nlShowPanel("nlPanelSend"); };
    strip.hidden = false;
  }

  // --- TASK-292: what a reader with no name against them sees ------------------------------------
  // The hint EXPLAINS the rule rather than re-implementing it. A browser copy of
  // src/newsletter/name-fallback.ts would be a second version of the thing that decides what
  // actually goes out, free to drift from the one that does — and the author's own subject is on
  // screen directly above, so echoing it back buys very little.
  function nlSyncFallbackHint() {
    var hint = el("nlNameFallbackHint");
    if (!hint) return;
    var subject = (el("newsletterSubject") && el("newsletterSubject").value) || "";
    if (subject.indexOf("{{firstName}}") === -1) {
      hint.textContent = "This subject does not use {{firstName}}, so everyone sees it the same way.";
      return;
    }
    var fb = (el("nlNameFallback") && el("nlNameFallback").value || "").trim();
    hint.textContent = fb
      ? "They will see \u201C" + fb + "\u201D where the name would go."
      : "The name is taken out neatly \u2014 \u201CHey, {{firstName}}!\u201D becomes \u201CHey!\u201D. " +
        "Put a word here instead if your subject would not read properly without one.";
  }

  // Both settings live on the DOC, so they save with the newsletter and the server reads them at
  // send time. No separate save, and nothing to forget.
  function nlReadFallbacksIntoDoc() {
    var name = (el("nlNameFallback") && el("nlNameFallback").value) || "";
    var greeting = (el("nlGreetingFallback") && el("nlGreetingFallback").value) || "";
    if (!name.trim() && !greeting.trim()) { delete nlDoc.merge; return; }
    nlDoc.merge = { nameFallback: name.trim(), greetingFallback: greeting.trim() };
  }

  function nlFillFallbacksFromDoc() {
    var m = nlDoc.merge || {};
    if (el("nlNameFallback")) el("nlNameFallback").value = m.nameFallback || "";
    if (el("nlGreetingFallback")) el("nlGreetingFallback").value = m.greetingFallback || "";
    nlSyncFallbackHint();
  }

  /** Which panel is on screen right now. Read from the DOM so it cannot drift from what is shown. */
  function nlLivePanel() {
    for (var i = 0; i < NL_PANELS.length; i++) {
      var p = el(NL_PANELS[i]);
      if (p && !p.hidden) return NL_PANELS[i];
    }
    return "nlPanelOverview";
  }

  // The footer action always names what pressing it will do, and is the only thing that advances
  // the flow — the step rail is there to jump back, not to be the primary path forward.
  function nlPaintComposeFoot(panelId) {
    var next = el("nlComposeNext");
    var back = el("nlComposeBack");
    var hint = el("nlComposeHint");
    if (!next || !back || !hint) return;
    back.hidden = panelId === "nlPanelWrite";
    if (panelId === "nlPanelWrite") {
      next.textContent = "Choose who gets it";
      hint.textContent = "Everything saves as you go. You can leave and come back.";
    } else if (panelId === "nlPanelWho") {
      next.textContent = "Check and send";
      hint.textContent = "Unsubscribed and blocked people are left out automatically.";
    } else {
      next.textContent = "Go to send";
      hint.textContent = "Nothing goes out until you press Send.";
    }
    // On the last step the footer must not look like it sends — the real Send button, with its
    // confirmation, is the only thing that mails anybody.
    next.hidden = panelId === "nlPanelSend";
  }

  // opts.stay keeps the current panel — used on tab open, where the editor is prefilled in the
  // background but the Overview is what you should be looking at (TASK-283).
  function loadNewsletterInto(id, opts) {
    if (!opts || !opts.stay) nlShowPanel("nlPanelWrite"); // open the one you clicked, where you write it
    authFetch("/api/admin/newsletters/" + id)
      .then(j)
      .then(function (n) {
        el("newsletterId").value = n.id;
        el("newsletterSubject").value = n.subject;
        nlSyncComposeTitle();
        // A block-doc newsletter hydrates its blocks; a legacy raw-HTML draft becomes one rawHtml block.
        if (n.bodyJson && Array.isArray(n.bodyJson.blocks)) {
          nlDoc = n.bodyJson;
          // TASK-289: open a newsletter and every block is collapsed. You are orienting, not
          // editing - and a ten-block newsletter of fully-expanded forms was the whole complaint.
          nlCollapseAllOnNextRender = true;
        } else {
          nlDoc = { blocks: [{ type: "rawHtml", variant: 0, data: { html: n.bodyHtml || "" } }] };
          nlCollapseAllOnNextRender = true;
        }
        // TASK-292: AFTER nlDoc is assigned - these fields read from it, so filling them any earlier
        // reads the PREVIOUS newsletter's settings (or none at all).
        nlFillFallbacksFromDoc();
        var sent = n.status === "sent";
        nlSent = sent;
        // TASK-256: delivery truth for a SENT newsletter; a draft has no delivery to report.
        if (sent) nlRefreshStats(n.id, n.redactedAt);
        else nlHideStats();
        // Read mode = no newsletter:edit permission OR an already-sent newsletter. Send/Save/New are
        // all gated to newsletter:edit (the server's authorizeSection level for these routes).
        var canWrite = canEdit("newsletter");
        el("newsletterSend").hidden = !(canWrite && !sent);
        if (el("sendListWrap")) el("sendListWrap").hidden = !(canWrite && !sent); // TASK-259
        if (el("sendRolloutWrap")) el("sendRolloutWrap").hidden = !(canWrite && !sent); // TASK-274
        if (el("sendScheduleWrap")) el("sendScheduleWrap").hidden = !(canWrite && !sent); // TASK-280
        nlTestSent = false; // TASK-277: a different newsletter has not been tested
        nlSyncSendAudience(); // TASK-271: the "who this reaches" line follows the send controls
        nlRenderSendJob(el("newsletterId").value); // TASK-274: resume the progress view after a reload
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

  // --- TASK-283: the Overview -------------------------------------------------------------------
  // The front door. Every figure here comes from endpoints that already existed — the work was
  // deciding WHICH questions the page should answer, not fetching anything new. Rendered from the
  // same `rows` the archive uses, so the two can never disagree.

  /** A percentage as a string, or an em dash when the denominator is zero. */
  function nlPct(n, of) {
    if (!of) return "—";
    return (Math.round((n / of) * 1000) / 10).toFixed(1) + "%";
  }

  /** A rate as a bar plus a figure: a number alone makes you read every row to spot the odd one. */
  function nlRateCell(n, of) {
    if (!of || n == null) return '<span class="nl-meta">—</span>';
    var pct = (n / of) * 100;
    var band = pct >= 90 ? "" : pct >= 70 ? " is-mid" : " is-low";
    return (
      '<span class="nl-rate' + band + '"><span class="nl-rate-bar"><i style="width:' +
      Math.max(2, Math.min(100, Math.round(pct))) + '%"></i></span><span class="nl-rate-n">' +
      nlPct(n, of) + "</span></span>"
    );
  }

  function nlRenderOverview(rows) {
    var sent = rows.filter(function (r) { return r.status === "sent"; });
    var accepted = sent.reduce(function (a, r) { return a + (r.recipientCount || 0); }, 0);
    var delivered = sent.reduce(function (a, r) { return a + (r.deliveredCount || 0); }, 0);
    var thisYear = sent.filter(function (r) {
      return r.sentAt && new Date(r.sentAt).getFullYear() === new Date().getFullYear();
    }).length;

    var tiles = el("nlOverviewTiles");
    if (tiles) {
      // "Delivered" is only shown once there is something to divide by. A confident 0.0% on a
      // charity that has not sent yet reads as a broken system rather than an empty one.
      tiles.innerHTML =
        nlTile("People you can reach", nlReachTotal == null ? "—" : H.escapeHtml(String(nlReachTotal)), "Across every audience", true) +
        nlTile("Sent this year", String(thisYear), sent.length ? "Last one " + H.escapeHtml(nlAgo(sent[0].sentAt)) : "Nothing sent yet") +
        nlTile("Usually delivered", accepted ? nlPct(delivered, accepted) : "—", accepted ? "Across your last " + sent.length + " sends" : "No sends to measure yet") +
        nlTile("Blocked", nlBlockedCount == null ? "—" : String(nlBlockedCount), "Bounced or marked us as spam");
    }

    var recent = el("nlRecentSends");
    if (recent) {
      if (!sent.length) {
        recent.innerHTML =
          '<p class="admin-help">Nothing has gone out yet. When it has, this is where you will see ' +
          "how it landed — delivered, bounced, clicked and unsubscribed, for every send.</p>";
      } else {
        // TASK-286: THREE columns, not four. The overview's main column is ~620px in the real
        // shell (1280 max-width minus the 210px nav and padding), and four columns needed ~750 —
        // so the table scrolled sideways inside its own card. The audience moves into the meta
        // line, where it reads better anyway: "9 June · Jaimie · Newsletter" is one fact about the
        // send, not a column you scan.
        var html =
          '<table class="admin-table nl-sends"><thead><tr><th>Newsletter</th>' +
          '<th class="nl-r">Delivered</th><th class="nl-r">Clicked</th></tr></thead><tbody>';
        sent.slice(0, 6).forEach(function (r) {
          var n = r.recipientCount || 0;
          var meta = [nlWhen(r.sentAt), r.sentBy, r.audience].filter(Boolean).map(H.escapeHtml);
          html +=
            '<tr class="nl-click" data-who-got="' + r.id + '">' +
            '<td><span class="nl-subj">' + H.escapeHtml(r.subject || "Untitled") + "</span>" +
            '<span class="nl-meta">' + meta.join(" · ") + "</span></td>" +
            '<td class="nl-r">' + nlRateCell(r.deliveredCount, n) + "</td>" +
            '<td class="nl-r">' + nlRateCell(r.clickedCount, n) + "</td></tr>";
        });
        recent.innerHTML = html + "</tbody></table>";
        Array.prototype.forEach.call(recent.querySelectorAll("[data-who-got]"), function (tr) {
          tr.addEventListener("click", function () { nlShowResults(tr.getAttribute("data-who-got")); });
        });
      }
    }
    nlRenderAttention(sent);
  }

  function nlTile(k, v, meta, lead) {
    return (
      '<div class="nl-tile' + (lead ? " is-lead" : "") + '"><span class="nl-tile-k">' + H.escapeHtml(k) +
      '</span><span class="nl-tile-v">' + v + '</span><span class="nl-tile-m">' + H.escapeHtml(meta) + "</span></div>"
    );
  }

  /** Short, human relative time. "11 weeks ago" beats a date you have to subtract from today. */
  function nlAgo(iso) {
    if (!iso) return "";
    var days = Math.round((Date.now() - new Date(iso).getTime()) / 86400000);
    if (days <= 0) return "today";
    if (days === 1) return "yesterday";
    if (days < 14) return days + " days ago";
    if (days < 70) return Math.round(days / 7) + " weeks ago";
    return Math.round(days / 30) + " months ago";
  }

  function nlWhen(iso) {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
    } catch (err) {
      return String(iso).slice(0, 10);
    }
  }

  // Counts the Overview needs that do not come from the newsletter list. Held here and filled by
  // the audience/suppression loads that already run on tab open, so the Overview never fires a
  // request of its own.
  var nlReachTotal = null;
  var nlBlockedCount = null;

  function nlRenderAttention(sent) {
    var box = el("nlAttention");
    if (!box) return;
    var items = [];
    if (nlBlockedCount) {
      items.push(
        nlAttn("b", nlBlockedCount + " addresses are blocked",
          "Dead mailboxes and spam complaints, taken out of every send automatically. Nothing to do unless you recognise one.")
      );
    }
    if (!sent.length) {
      items.push(nlAttn("g", "Nothing has been sent yet",
        "Send a test to your own Gmail and Outlook first, and tick “Ease this one out gradually” on the first real one."));
    }
    box.innerHTML = items.length
      ? items.join("")
      : '<li class="nl-attn-ok"><b>Nothing needs your attention</b><span>No bounces, no complaints, nothing waiting.</span></li>';
  }

  function nlAttn(kind, title, body) {
    return (
      '<li><span class="nl-attn-ic is-' + kind + '" aria-hidden="true"></span>' +
      "<div><b>" + H.escapeHtml(title) + "</b><span>" + H.escapeHtml(body) + "</span></div></li>"
    );
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
        // TASK-278: exactly who a send reached, and who it did not and why. newsletter_send_queue has
        // held this per-recipient record since TASK-274; nothing ever read it back, so "did Margaret
        // get it?" was unanswerable despite the answer being on file.
        Array.prototype.forEach.call(doc.querySelectorAll("[data-who-got]"), function (b) {
          b.addEventListener("click", function () {
            nlShowResults(b.getAttribute("data-who-got"));
          });
        });
        Array.prototype.forEach.call(doc.querySelectorAll("[data-delete-newsletter]"), function (b) {
          b.addEventListener("click", function () {
            nlDelete(b.getAttribute("data-delete-newsletter"), b.getAttribute("data-newsletter-status"));
          });
        });
        // TASK-283: still prefill the editor from the most recent newsletter so it is never empty,
        // but do NOT jump to it. Opening the tab used to drop you into the composer mid-task; you
        // now land on the Overview, which answers the questions you actually arrive with.
        if (rows.length) loadNewsletterInto(rows[0].id, { stay: true });
        nlLastNewsletters = rows;
        nlRenderOverview(rows);
        nlRefreshInflight();
        // Land on the Overview unless the user is already mid-compose. The old guard compared
        // against nlLivePanel(), which reported the one panel that started un-hidden - so it never
        // fired and nothing was shown at all.
        if (NL_COMPOSE_PANELS.indexOf(nlLivePanel()) === -1) nlShowPanel("nlPanelOverview");
      })
      .catch(function () {});
  }

  // TASK-271: "someone asked us to email them again" — switching a donor's email consent back ON is
  // now a deliberate action with its own button and a confirm that spells out the blast radius. It
  // used to be a silent side effect of the plain "add a subscriber" box, so simply typing an address
  // could undo an opt-out across EVERY email the charity sends. Same endpoint, stated intent.
  var reconsentForm = el("reconsentForm");
  if (reconsentForm) {
    reconsentForm.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!canEdit("newsletter")) return;
      var email = (el("reEmail").value || "").trim();
      var name = (el("reName").value || "").trim();
      if (!email) return;
      if (!window.confirm(
        "Turn emails back on for " + email + "?\n\nOnly do this if they have asked us to. It switches " +
        "ALL our emails back on for them — receipts and appeals too, not just the newsletter.",
      )) return;
      var btn = el("reAddBtn");
      btn.disabled = true;
      el("reMsg").textContent = "Saving…";
      authFetch("/api/admin/newsletters/subscribers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(name ? { email: email, name: name } : { email: email }),
      })
        .then(function (res) { return res.json().then(function (b) { return { ok: res.ok, b: b }; }); })
        .then(function (r) {
          if (!r.ok) { el("reMsg").textContent = (r.b && r.b.error) || "Could not do that."; return; }
          el("reMsg").textContent = r.b.status === "resubscribed"
            ? r.b.email + " — their emails are back on."
            : "Added " + r.b.email + ", with emails on.";
          el("reEmail").value = "";
          el("reName").value = "";
          if (el("subManage") && el("subManage").open) nlLoadSubscribers();
        })
        .catch(function () { el("reMsg").textContent = "Could not do that."; })
        .finally(function () { btn.disabled = false; });
    });
  }

  // The old standalone "add a subscriber" form is gone. There were two add forms twenty lines
  // apart writing to DIFFERENT tables — that one created a donors row with no audience choice, the
  // other added a list membership — which is exactly the confusion this restructure removes. Adding
  // someone is now one form that names the audience it puts them on (POST .../subscriber-lists/:id/
  // members). The donor-row endpoint is untouched and still served for any other caller.

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
        // TASK-272: export what you are LOOKING AT. The button ignored the search box, so filtering to
        // a dozen people and exporting handed you the whole list.
        var q = (el("subSearch") && el("subSearch").value ? el("subSearch").value : "").trim();
        authFetch("/api/admin/newsletters/subscribers.csv" + (q ? "?q=" + encodeURIComponent(q) : ""))
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
    if (!list.length) { host.innerHTML = '<p class="admin-empty">No documents yet.</p>'; return; }
    var rows = list.map(function (a) {
      return '<li class="nl-attach-item"><span class="nl-attach-name">' + H.escapeHtml(a.filename) +
        '</span><span class="nl-attach-size">' + nlAttachHumanSize(a.byteSize) + "</span>" +
        '<button type="button" class="admin-link" data-att-insert="' + H.escapeHtml(a.id) +
        '" data-att-filename="' + H.escapeHtml(a.filename) + '">Insert button</button>' +
        '<button type="button" class="admin-link nl-attach-remove" data-att-remove="' + H.escapeHtml(a.id) + '">Remove</button></li>';
    }).join("");
    host.innerHTML = '<ul class="nl-attach-list">' + rows + "</ul>";
    Array.prototype.forEach.call(host.querySelectorAll("[data-att-remove]"), function (b) {
      b.addEventListener("click", function () { nlRemoveAttachment(b.getAttribute("data-att-remove")); });
    });
    // "Insert button": append a ready-made button block linking this document's hosted viewer page
    // (H.documentButtonBlock pins the href/label shape). The admin then edits the label like any
    // other button.
    Array.prototype.forEach.call(host.querySelectorAll("[data-att-insert]"), function (b) {
      b.addEventListener("click", function () {
        if (nlReadOnly()) return;
        nlDoc.blocks.push(H.documentButtonBlock(location.origin, b.getAttribute("data-att-insert"), b.getAttribute("data-att-filename")));
        nlRenderCanvas();
        nlSchedulePreview();
        el("nlAttachMsg").textContent = "Button added at the end of the newsletter — drag it into place and edit its label there.";
      });
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
      .catch(function () { el("nlAttachList").innerHTML = '<p class="admin-empty">Could not load documents.</p>'; });
  }
  function nlRemoveAttachment(attId) {
    var id = el("newsletterId").value;
    if (!id) return;
    authFetch("/api/admin/newsletters/" + id + "/attachments/" + encodeURIComponent(attId), { method: "DELETE" })
      .then(function (res) { if (!res.ok) throw new Error(String(res.status)); return res.json(); })
      .then(function () { nlRefreshAttachments(); })
      .catch(function () { el("nlAttachMsg").textContent = "Could not remove that document."; });
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

  // --- Audiences (TASK-259): separate mailing lists ------------------------------------------------
  var nlAudiences = []; // {id, slug, name, memberCount}

  function nlAudienceMsg(text) {
    var m = el("audienceMsg");
    if (m) m.textContent = text || "";
  }

  function nlAudienceById(id) {
    for (var i = 0; i < nlAudiences.length; i++) {
      if (String(nlAudiences[i].id) === String(id)) return nlAudiences[i];
    }
    return null;
  }

  // TASK-271: the picker you BROWSE with, the one an import TARGETS and the one a send GOES TO are
  // deliberately separate controls. They used to be one, which is how a spreadsheet previewed against
  // Volunteers could be committed into Newsletter.
  // `manageableOnly` drops the Donors audience: it follows donor consent, so there is nothing to add
  // to by hand — leaving it out of those pickers beats letting someone pick it and get an error.
  function nlFillAudienceSelect(select, keepValue, opts) {
    if (!select) return;
    var manageableOnly = !!(opts && opts.manageableOnly);
    var keep = keepValue != null ? keepValue : select.value;
    select.innerHTML = "";
    nlAudiences.forEach(function (l) {
      if (manageableOnly && l.kind === "donors") return;
      var o = doc.createElement("option");
      o.value = String(l.id);
      o.textContent = l.name + (typeof l.memberCount === "number" ? " (" + l.memberCount + ")" : "");
      select.appendChild(o);
    });
    if (keep) select.value = keep;
    if (!select.value && select.options.length) select.value = select.options[0].value;
  }

  // What the selected audience MEANS, in plain words — the counts alone never explained why Donors
  // has no Add form, or that Newsletter quietly includes every consenting donor.
  function nlAudienceKindText(a) {
    if (!a) return "";
    if (a.kind === "donors") {
      return "Donors looks after itself: every donor who agreed to email is in it. People can't be added or removed here — it follows their consent.";
    }
    if (a.kind === "everyone") {
      return "Newsletter is everyone: the people on this list plus every donor who agreed to email.";
    }
    return "This audience is exactly the people on it. Donors are not included.";
  }

  // Keep stage 1's explanation and its Archive button in step with the audience being browsed.
  function nlSyncAudienceContext() {
    var pick = el("audiencePick");
    var a = pick ? nlAudienceById(pick.value) : null;
    var note = el("audienceKindNote");
    if (note) note.textContent = nlAudienceKindText(a);
    // Only a hand-managed audience can be archived — Newsletter and Donors are what the send model
    // is built on, so the server refuses them and the button should not pretend otherwise.
    var arch = el("audienceArchive");
    if (arch) arch.hidden = !(a && a.kind === "manual" && canEdit("newsletter"));
    nlSyncVisibility(a);
  }

  // TASK-291: the padlock / globe. Only a MANUAL audience can change: Newsletter is publicly
  // joinable by definition (the website footer) and Donors follows donor consent, so offering to
  // flip either would promise something the code does not do.
  function nlSyncVisibility(a) {
    var btn = el("audienceVisibility");
    if (!btn) return;
    if (!a || a.kind !== "manual" || !canEdit("newsletter")) { btn.hidden = true; return; }
    var isPublic = a.visibility === "public";
    btn.hidden = false;
    btn.setAttribute("aria-pressed", String(isPublic));
    btn.classList.toggle("is-public", isPublic);
    btn.title = isPublic
      ? "Public — people can add themselves from the email preferences page. Click to make it private."
      : "Private — only you can add people, and nobody outside knows it exists. Click to make it public.";
    // The word does the work; the symbol is a reinforcement, never the only signal.
    btn.innerHTML =
      nlVisIcon(isPublic ? "globe" : "lock") + " " + (isPublic ? "Public" : "Private");
  }

  // TASK-271: name the audience and its size next to the Send button, before the confirmation repeats
  // it. The send controls used to say only "Send to subscribers", whoever that was.
  function nlSyncSendAudience() {
    var note = el("sendAudienceNote");
    if (!note) return;
    var wrap = el("sendListWrap");
    var pick = el("sendListPick");
    var a = pick ? nlAudienceById(pick.value) : null;
    if (!a || (wrap && wrap.hidden)) { note.hidden = true; note.textContent = ""; return; }
    var extra = a.kind === "everyone" ? " That includes every donor who agreed to email."
      : a.kind === "donors" ? " Donors only — no volunteers or other audiences." : "";
    note.hidden = false;
    note.textContent = "This will go to " + a.name + " — " +
      a.memberCount + (a.memberCount === 1 ? " person." : " people.") + extra;
    nlPaintReach(a);
  }

  // TASK-283: the reach panel on step 2. The count alone is not enough — showing its WORKING is what
  // stops the number on the confirmation being a surprise, and it is the only place the admin ever
  // sees that unsubscribed and blocked people are dropped for them.
  function nlPaintReach(a) {
    var box = el("nlReach");
    if (!box) return;
    if (!a) { box.hidden = true; box.innerHTML = ""; return; }
    var blocked = nlBlockedCount || 0;
    box.hidden = false;
    box.innerHTML =
      '<span class="admin-help" style="text-transform:uppercase;letter-spacing:.1em;font-size:.72rem">This newsletter will reach</span>' +
      '<div class="nl-reach-big">' + a.memberCount + "</div>" +
      '<p class="nl-reach-who">people on <b>' + H.escapeHtml(a.name) + "</b></p>" +
      "<ul><li><span>On the audience</span><b>" + a.memberCount + "</b></li>" +
      "<li><span>Blocked (bounced or spam)</span><b>" + blocked + "</b></li></ul>" +
      '<p class="nl-reach-note">Anyone who unsubscribed, bounced permanently or reported us as spam is left ' +
      "out automatically. Emailing them is what gets NBCC sent to junk.</p>";
  }

  // Blocked addresses (TASK-272): hard bounces and spam complaints, dropped from every future send.
  // Rendered so the blocking is never silent — and liftable, because a real supporter whose mailbox
  // bounced during an outage must have a way back.
  function nlRefreshSuppressions() {
    var host = el("suppressionList");
    if (!host) return;
    authFetch("/api/admin/newsletters/suppressions")
      .then(function (res) { return res.ok ? res.json() : []; })
      .then(function (rows) {
        var list = Array.isArray(rows) ? rows : [];
        // TASK-283: the Overview needs this number too. Taken from the load that already runs on tab
        // open rather than a second request, so the tile and this panel can never disagree.
        nlBlockedCount = list.length;
        if (!list.length) {
          host.innerHTML = '<p class="admin-empty">Nothing blocked — no permanent bounces or spam reports.</p>';
          return;
        }
        var canWrite = canEdit("newsletter");
        var why = { bounced: "Mailbox doesn’t exist", complained: "Marked us as spam", manual: "Blocked by staff" };
        var html = '<table class="admin-table"><thead><tr><th>Email</th><th>Why</th><th>Since</th><th></th></tr></thead><tbody>';
        list.forEach(function (s) {
          html += "<tr><td>" + H.escapeHtml(s.email) + "</td><td>" + H.escapeHtml(why[s.reason] || s.reason) +
            (s.detail ? '<span class="admin-sub">' + H.escapeHtml(s.detail) + "</span>" : "") +
            "</td><td>" + H.fmtDate(s.createdAt) + "</td><td>" +
            (canWrite ? '<button class="admin-link" type="button" data-unblock="' + H.escapeHtml(s.email) + '">Unblock</button>' : "") +
            "</td></tr>";
        });
        host.innerHTML = html + "</tbody></table>";
        Array.prototype.forEach.call(host.querySelectorAll("[data-unblock]"), function (b) {
          b.addEventListener("click", function () {
            var email = b.getAttribute("data-unblock");
            if (!window.confirm(
              "Start emailing " + email + " again?\n\nWe stopped because their mail bounced permanently or they " +
              "marked us as spam. Only do this if you know the address works and they want to hear from us — " +
              "emailing dead or complaining addresses is what sends our emails to junk.",
            )) return;
            authFetch("/api/admin/newsletters/suppressions/lift", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ email: email }),
            })
              .then(function (res) {
                el("suppressionMsg").textContent = res.ok ? "Unblocked " + email + "." : "Could not unblock that address.";
                return nlRefreshSuppressions();
              })
              .catch(function () { el("suppressionMsg").textContent = "Could not unblock that address."; });
          });
        });
      })
      .catch(function () { /* a convenience panel — never block the tab */ });
  }

  // Archived audiences (TASK-270): retired, not deleted. Hidden entirely until there are some.
  function nlRefreshArchivedAudiences() {
    var box = el("audienceArchived");
    if (!box) return;
    authFetch("/api/admin/subscriber-lists/archived")
      .then(function (res) { return res.ok ? res.json() : []; })
      .then(function (rows) {
        var list = Array.isArray(rows) ? rows : [];
        box.hidden = list.length === 0;
        var host = el("audienceArchivedList");
        if (!host) return;
        var canWrite = canEdit("newsletter");
        var html = "";
        list.forEach(function (a) {
          html += '<p class="nl-archived-row">' + H.escapeHtml(a.name) +
            ' <span class="admin-sub">' + a.memberCount + " kept on file</span> " +
            (canWrite ? '<button class="admin-link" type="button" data-restore-list="' + a.id + '">Restore</button>' : "") +
            "</p>";
        });
        host.innerHTML = html;
        Array.prototype.forEach.call(host.querySelectorAll("[data-restore-list]"), function (b) {
          b.addEventListener("click", function () {
            authFetch("/api/admin/subscriber-lists/" + b.getAttribute("data-restore-list") + "/restore", { method: "POST" })
              .then(function (res) {
                nlAudienceMsg(res.ok ? "Audience restored." : "Could not restore it.");
                return nlRefreshAudiences();
              })
              .catch(function () { nlAudienceMsg("Could not restore it."); });
          });
        });
      })
      .catch(function () { /* the archive box is a convenience — never block the tab */ });
  }

  function nlRenderAudienceMembers(members) {
    var host = el("audienceMembers");
    if (!host) return;
    if (!members.length) {
      host.innerHTML = '<p class="admin-loading">No one on this audience yet.</p>';
      return;
    }
    var canWrite = canEdit("newsletter");
    // TASK-278: the full provenance of a membership — when they joined, how consent arrived, and
    // which of us added them. "Who put this person on the list?" is the first question asked when an
    // address turns out to be wrong, or when someone says they never signed up.
    var howLabel = { footer: "Signed up on the website", import: "Imported", admin: "Added by staff" };
    // TASK-287: three columns, not seven. Seven never fitted the card, and .admin-table sets
    // white-space:nowrap on every cell, so the table grew to its longest email address and the card
    // scrolled sideways with Remove pushed off the edge. Nothing is lost — the same six facts are
    // here, grouped as the two questions people actually ask: "who is this?" and "how did they get
    // here?".
    var html = '<table class="admin-table nl-people"><thead><tr><th>Person</th><th>Added</th>' +
      "<th></th></tr></thead><tbody>";
    members.forEach(function (m) {
      var contact = [m.email, m.phone].filter(Boolean).map(H.escapeHtml).join(" · ");
      var by = m.addedBy
        ? H.escapeHtml(m.addedBy)
        : m.consentSource === "footer" ? "themselves" : "not recorded";
      var how = [H.escapeHtml(howLabel[m.consentSource] || m.consentSource), "by " + by].join(" · ");
      html +=
        '<tr><td><span class="nl-person-nm">' + (H.escapeHtml(m.name || "") || '<span class="admin-muted">No name</span>') +
        '</span><span class="nl-meta">' + contact + "</span></td>" +
        '<td><span class="nl-person-nm">' + (m.consentedAt ? H.fmtDate(m.consentedAt) : "-") +
        '</span><span class="nl-meta">' + how + "</span></td>" +
        '<td class="nl-r">' +
        (canWrite ? '<button class="admin-link admin-link-danger" type="button" data-remove-member="' + m.id + '">Remove</button>' : "") +
        "</td></tr>";
    });
    host.innerHTML = html + "</tbody></table>";
    Array.prototype.forEach.call(host.querySelectorAll("[data-remove-member]"), function (b) {
      b.addEventListener("click", function () {
        var listId = el("audiencePick").value;
        if (!window.confirm("Remove this person from the audience? Their consent history is kept.")) return;
        authFetch("/api/admin/subscriber-lists/" + listId + "/members/" + b.getAttribute("data-remove-member"), { method: "DELETE" })
          .then(function (res) {
            nlAudienceMsg(res.ok ? "Removed." : "Could not remove them.");
            return nlRefreshAudiences();
          })
          .catch(function () { nlAudienceMsg("Could not remove them."); });
      });
    });
  }

  function nlLoadAudienceMembers() {
    var pick = el("audiencePick");
    if (!pick || !pick.value) return;
    authFetch("/api/admin/subscriber-lists/" + pick.value + "/members")
      .then(function (res) { return res.ok ? res.json() : []; })
      .then(function (rows) { nlRenderAudienceMembers(Array.isArray(rows) ? rows : []); })
      .catch(function () { /* the card is a convenience — never block the tab */ });
  }

  // --- TASK-283: multi-audience tick lists -------------------------------------------------------
  // Built from the same nlAudiences the pickers use. Donors is rendered but NOT tickable: it follows
  // donor consent, so there is nothing to add to by hand, and the server refuses it. A dropdown can
  // silently omit it; a tick list reads as "here are all your audiences", so a gap looks like a bug.
  // Shown greyed with the reason instead.
  function nlFillAudienceTicks(host, mirrorSelect) {
    if (!host) return;
    host.innerHTML = nlAudiences
      .map(function (a) {
        var manageable = a.kind !== "donors";
        var count = typeof a.memberCount === "number" ? a.memberCount : "";
        if (!manageable) {
          return (
            '<span class="nl-tick is-off"><span class="nl-tick-bx" aria-hidden="true"></span>' +
            '<span class="nl-tick-l">' + H.escapeHtml(a.name) +
            "<em>Looks after itself — follows donor consent</em></span></span>"
          );
        }
        return (
          '<label class="nl-tick"><input type="checkbox" value="' + a.id + '" data-aud-tick>' +
          '<span class="nl-tick-bx" aria-hidden="true"></span>' +
          '<span class="nl-tick-l">' + H.escapeHtml(a.name) + "</span>" +
          '<span class="nl-tick-n">' + count + "</span></label>"
        );
      })
      .join("");
    Array.prototype.forEach.call(host.querySelectorAll("[data-aud-tick]"), function (cb) {
      cb.addEventListener("change", function () {
        cb.parentNode.classList.toggle("is-on", cb.checked);
        nlSyncTickMirror(host, mirrorSelect);
      });
    });
    nlSyncTickMirror(host, mirrorSelect);
  }

  /**
   * Did the tick list actually render? Distinguishes "nothing ticked" (a refusal) from "the list
   * never built" (fall back to the legacy select). Without this the fallback silently sends the
   * person to whichever audience the hidden select happened to default to — the exact
   * silent-wrong-destination bug the whole screen exists to prevent.
   */
  function nlTicksReady(host) {
    return !!(host && host.querySelector("[data-aud-tick]"));
  }

  /** The ticked audience ids, as numbers, in the order they appear. */
  function nlTickedIds(host) {
    if (!host) return [];
    return Array.prototype.slice
      .call(host.querySelectorAll("[data-aud-tick]"))
      .filter(function (cb) { return cb.checked; })
      .map(function (cb) { return Number(cb.value); });
  }

  /** Keep the hidden legacy <select> pointing at the first ticked audience. */
  function nlSyncTickMirror(host, mirrorSelect) {
    var sel = el(mirrorSelect);
    var ids = nlTickedIds(host);
    if (sel && ids.length) sel.value = String(ids[0]);
    nlPaintTickButtons();
  }

  /** Buttons name what they will do, and refuse to be pressed with nothing chosen. */
  function nlPaintTickButtons() {
    var addIds = nlTickedIds(el("amAudiences"));
    var addBtn = el("amAddBtn");
    if (addBtn) {
      var label = addBtn.querySelector("span") || addBtn;
      label.textContent =
        addIds.length === 0 ? "Pick at least one audience"
          : addIds.length === 1 ? "Add to audience"
            : "Add to " + addIds.length + " audiences";
      addBtn.disabled = addIds.length === 0;
    }
    var impIds = nlTickedIds(el("importAudiences"));
    var impBtn = el("importPreviewBtn");
    if (impBtn) impBtn.disabled = impIds.length === 0;
    // A preview belongs to the audiences it was previewed against. Changing them invalidates it,
    // because committing a checked sheet into an unchecked audience is exactly the mistake this
    // whole screen exists to prevent.
    if (nlImportPreviewFor !== null && nlImportPreviewFor !== impIds.join(",")) {
      nlInvalidateImportPreview();
    }
  }

  var nlImportPreviewFor = null;

  // Says back exactly what happened, naming the audiences. A resubscribe is called out separately
  // from an add: somebody who once asked us to stop has been switched back on, and that should never
  // be buried inside a routine-looking "Added."
  function nlAddOutcomeText(b) {
    if (!b) return "Added.";
    var bits = [];
    if (b.addedTo && b.addedTo.length) bits.push("Added to " + nlAndList(b.addedTo) + ".");
    if (b.resubscribedTo && b.resubscribedTo.length) {
      bits.push("Emails switched back on for " + nlAndList(b.resubscribedTo) + " — they had opted out.");
    }
    if (b.alreadyOnList) bits.push(b.alreadyOnList + " already had them.");
    if (b.previouslyUnsubscribed) {
      bits.push(b.previouslyUnsubscribed + " skipped — they opted out and an import cannot overrule that.");
    }
    return bits.length ? bits.join(" ") : "Nothing to do — they were already on every audience you picked.";
  }

  /** "a", "a and b", "a, b and c" — reads as a sentence, not a debug array. */
  function nlAndList(names) {
    if (!names.length) return "";
    if (names.length === 1) return names[0];
    return names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
  }

  function nlInvalidateImportPreview() {
    nlImportPreviewFor = null;
    var pv = el("importPreview");
    if (pv) pv.hidden = true;
    var commit = el("importCommitBtn");
    if (commit) commit.disabled = true;
    var attest = el("importAttest");
    if (attest) attest.checked = false;
    var msg = el("importMsg");
    if (msg) msg.textContent = "You changed the audiences — preview the file again before importing.";
  }

  // TASK-283: who you could write to today, on the Overview. Also the source of the "People you can
  // reach" tile — the widest audience, which is Newsletter (everyone) unless someone has retired it.
  function nlRenderAudienceSnapshot() {
    var box = el("nlAudienceSnapshot");
    var widest = 0;
    nlAudiences.forEach(function (a) {
      if (typeof a.memberCount === "number" && a.memberCount > widest) widest = a.memberCount;
    });
    nlReachTotal = nlAudiences.length ? widest : null;
    if (!box) return;
    if (!nlAudiences.length) {
      box.innerHTML = '<p class="admin-empty">No audiences yet.</p>';
      return;
    }
    box.innerHTML = nlAudiences
      .map(function (a) {
        var what =
          a.kind === "everyone" ? "Everyone — donors plus the sign-up list"
            : a.kind === "donors" ? "Looks after itself"
              : "";
        return (
          '<div class="nl-aud-snap-row"><span class="nl-aud-snap-nm">' + H.escapeHtml(a.name) +
          (what ? "<em>" + H.escapeHtml(what) + "</em>" : "") +
          '</span><span class="nl-aud-snap-ct">' +
          (typeof a.memberCount === "number" ? a.memberCount : "—") + "</span></div>"
        );
      })
      .join("");
  }

  function nlRefreshAudiences() {
    return authFetch("/api/admin/subscriber-lists")
      .then(function (res) { return res.ok ? res.json() : []; })
      .then(function (rows) {
        nlAudiences = Array.isArray(rows) ? rows : [];
        nlFillAudienceSelect(el("audiencePick"));
        nlFillAudienceSelect(el("sendListPick"));
        // Adding and importing can't target Donors — it follows consent (TASK-271). The hidden
        // selects stay filled as the legacy single-audience mirror; the tick lists are what the
        // admin actually uses (TASK-283).
        nlFillAudienceSelect(el("amList"), null, { manageableOnly: true });
        nlFillAudienceSelect(el("importListPick"), null, { manageableOnly: true });
        nlFillAudienceTicks(el("amAudiences"), "amList");
        nlFillAudienceTicks(el("importAudiences"), "importListPick");
        nlSyncAudienceContext();
        nlSyncSendAudience();
        nlLoadAudienceMembers();
        nlRefreshArchivedAudiences();
        nlRefreshSuppressions();
        nlRenderAudienceSnapshot();
        nlRenderAudienceCards();
      })
      .catch(function () { /* never block the builder on the audience card */ });
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
            el("nlAttachMsg").textContent = r.ok ? "Uploaded " + f.name + ". Use Insert button to link it in the newsletter." : (r.b && r.b.error) || "Upload failed.";
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

    // --- Audiences card wiring (TASK-259) ---------------------------------------------------------
    if (el("audienceVisibility")) {
      el("audienceVisibility").addEventListener("click", function () {
        if (!canEdit("newsletter")) return;
        var a = nlAudienceById(el("audiencePick").value);
        if (!a) return;
        var next = a.visibility === "public" ? "private" : "public";
        if (next === "public" && !window.confirm(
          "Make \"" + a.name + "\" public?\n\nAnyone with one of our emails will be able to add " +
          "themselves to it from the preferences page. Private audiences are never shown to anyone."
        )) return;
        authFetch("/api/admin/subscriber-lists/" + a.id + "/visibility", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ visibility: next }),
        })
          .then(function (res) { return res.json().then(function (b) { return { ok: res.ok, b: b }; }); })
          .then(function (r) {
            nlAudienceMsg(r.ok
              ? (next === "public" ? "Anyone can now join this audience." : "This audience is private again.")
              : (r.b && r.b.error) || "Could not change that.");
            return nlRefreshAudiences();
          })
          .catch(function () { nlAudienceMsg("Could not change that."); });
      });
    }
    if (el("audiencePick")) {
      el("audiencePick").addEventListener("change", function () {
        nlLoadAudienceMembers();
        nlSyncAudienceContext();
      });
    }
    Array.prototype.forEach.call(doc.querySelectorAll("[data-nl-panel]"), function (b) {
      b.addEventListener("click", function () { nlShowPanel(b.getAttribute("data-nl-panel")); });
    });
    // TASK-283: the footer walks the three compose steps in order. Kept separate from the rail
    // above so the primary path forward is one button in one place.
    var cpNext = el("nlComposeNext");
    var cpBack = el("nlComposeBack");
    if (cpNext) {
      cpNext.addEventListener("click", function () {
        var at = NL_COMPOSE_PANELS.indexOf(nlLivePanel());
        if (at > -1 && at < NL_COMPOSE_PANELS.length - 1) nlShowPanel(NL_COMPOSE_PANELS[at + 1]);
      });
    }
    // TASK-285: the two explicit "when" choices, the results back button, and a subject that keeps
    // the compose header and the pre-send checks honest as you type.
    if (el("nlWhenNow")) el("nlWhenNow").addEventListener("click", function () { nlSetWhen(false); });
    if (el("nlWhenLater")) el("nlWhenLater").addEventListener("click", function () { nlSetWhen(true); });
    if (el("nlResultsBack")) {
      el("nlResultsBack").addEventListener("click", function () { nlShowPanel("nlPanelOverview"); });
    }
    if (el("newsletterSubject")) {
      el("newsletterSubject").addEventListener("input", function () {
        nlSyncComposeTitle();
        nlSyncFallbackHint();
        // A subject change can clear the "no subject" finding, so re-check - debounced, because
        // this fires on every keystroke.
        nlScheduleChecks();
        // Typing after a save means the header must stop claiming the work is saved.
        nlMarkSaved("");
      });
    }
    // "Send now" is the default, so the schedule field starts hidden and the two agree from the
    // outset rather than after the first click.
    nlSetWhen(false);
    ["nlNameFallback", "nlGreetingFallback"].forEach(function (id) {
      if (!el(id)) return;
      el(id).addEventListener("input", function () {
        nlReadFallbacksIntoDoc();
        nlSyncFallbackHint();
        nlSchedulePreview();
      });
    });
    if (el("nlCollapseAll")) {
      el("nlCollapseAll").addEventListener("click", function () { nlSetAllCollapsed(true); });
    }
    if (el("nlExpandAll")) {
      el("nlExpandAll").addEventListener("click", function () { nlSetAllCollapsed(false); });
    }
    if (cpBack) {
      cpBack.addEventListener("click", function () {
        var at = NL_COMPOSE_PANELS.indexOf(nlLivePanel());
        if (at > 0) nlShowPanel(NL_COMPOSE_PANELS[at - 1]);
      });
    }
    if (el("sendListPick")) {
      el("sendListPick").addEventListener("change", nlSyncSendAudience);
    }
    // TASK-274: a send in flight can now be paused or stopped — there was previously no way at all,
    // and closing the browser did not stop the server.
    // TASK-280: quick picks for the times charity newsletters generally do best. Deliberately framed
    // as GUIDANCE, not a recommendation: with open tracking off and no send history there is nothing
    // to personalise from, and dressing a rule of thumb up as intelligence would be dishonest. Once
    // real click data exists, that is what should drive this.
    Array.prototype.forEach.call(doc.querySelectorAll("[data-schedule-pick]"), function (b) {
      b.addEventListener("click", function () {
        var parts = b.getAttribute("data-schedule-pick").split(",");
        var wantDay = Number(parts[0]); // 0=Sun .. 6=Sat
        var wantHour = Number(parts[1]);
        var d = new Date();
        d.setSeconds(0, 0);
        d.setHours(wantHour, 0);
        // Always land on the NEXT such day: if today matches but the time has gone, skip a week
        // rather than offering a moment in the past, which the server would refuse anyway.
        var delta = (wantDay - d.getDay() + 7) % 7;
        if (delta === 0 && d.getTime() <= Date.now()) delta = 7;
        d.setDate(d.getDate() + delta);
        // datetime-local wants LOCAL wall-clock, so format by hand — toISOString would shift the zone.
        var pad = function (n) { return String(n).padStart(2, "0"); };
        if (el("sendScheduleAt")) {
          el("sendScheduleAt").value =
            d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
            "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
        }
      });
    });

    if (el("sendScheduleClear")) {
      el("sendScheduleClear").addEventListener("click", function () {
        if (el("sendScheduleAt")) el("sendScheduleAt").value = "";
      });
    }
    if (el("sendPause")) el("sendPause").addEventListener("click", function () { nlSendJobAction("pause"); });
    if (el("sendResume")) el("sendResume").addEventListener("click", function () { nlSendJobAction("resume"); });
    if (el("sendCancel")) el("sendCancel").addEventListener("click", function () { nlSendJobAction("cancel"); });
    // Archiving is a tombstone, not a delete — say so in the confirm, because "archive" invites the
    // question "does this lose the people?" and the answer is no.
    if (el("audienceArchive")) {
      el("audienceArchive").addEventListener("click", function () {
        if (!canEdit("newsletter")) return;
        var pick = el("audiencePick");
        var a = pick ? nlAudienceById(pick.value) : null;
        if (!a) return;
        if (!window.confirm(
          "Archive “" + a.name + "”?\n\nIt disappears from the audience lists so nothing can be sent to it. " +
          "Nobody is deleted — who was on it, and every newsletter already sent to it, are kept. You can restore it later.",
        )) return;
        authFetch("/api/admin/subscriber-lists/" + a.id, { method: "DELETE" })
          .then(function (res) {
            if (res.status === 204) { nlAudienceMsg("“" + a.name + "” archived."); return nlRefreshAudiences(); }
            return res.json().then(function (b) { nlAudienceMsg((b && b.error) || "Could not archive it."); });
          })
          .catch(function () { nlAudienceMsg("Could not archive it."); });
      });
    }
    if (el("audienceNew")) {
      el("audienceNew").addEventListener("click", function () {
        ["audienceName", "audienceCreate", "audienceCancel"].forEach(function (i) { el(i).hidden = false; });
        el("audienceNew").hidden = true;
        el("audienceName").focus();
      });
      el("audienceCancel").addEventListener("click", function () {
        ["audienceName", "audienceCreate", "audienceCancel"].forEach(function (i) { el(i).hidden = true; });
        el("audienceNew").hidden = false;
        nlAudienceMsg("");
      });
      el("audienceCreate").addEventListener("click", function () {
        var name = (el("audienceName").value || "").trim();
        if (!name) { nlAudienceMsg("Give the audience a name."); return; }
        authFetch("/api/admin/subscriber-lists", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name }),
        })
          .then(function (res) { return res.json().then(function (b) { return { ok: res.ok, status: res.status, b: b }; }); })
          .then(function (r) {
            if (!r.ok) {
              nlAudienceMsg(r.status === 409 ? "An audience with that name already exists." : (r.b && r.b.error) || "Could not create it.");
              return;
            }
            el("audienceName").value = "";
            ["audienceName", "audienceCreate", "audienceCancel"].forEach(function (i) { el(i).hidden = true; });
            el("audienceNew").hidden = false;
            nlAudienceMsg("Audience created.");
            return nlRefreshAudiences().then(function () {
              if (el("audiencePick")) el("audiencePick").value = String(r.b.id);
              nlLoadAudienceMembers();
            });
          })
          .catch(function () { nlAudienceMsg("Could not create it."); });
      });
    }
    var audienceMemberForm = el("audienceMemberForm");
    if (audienceMemberForm) {
      audienceMemberForm.addEventListener("submit", function (e) {
        e.preventDefault();
        if (!canEdit("newsletter")) return;
        // TASK-271: the destination is this form's OWN picker, so what you add and where it lands
        // are stated together — it used to silently borrow the browse picker further up.
        // TASK-283: that picker is now a tick list, and one add can reach several audiences. Falls
        // back to the hidden legacy select if the tick list has not rendered.
        var amTicks = el("amAudiences");
        var listIds = nlTickedIds(amTicks);
        // Only fall back when the tick list never rendered. If it DID render and nothing is ticked,
        // that is a refusal, not a reason to guess a destination.
        if (!listIds.length && !nlTicksReady(amTicks) && el("amList") && el("amList").value) {
          listIds = [Number(el("amList").value)];
        }
        if (!listIds.length) { nlAudienceMsg("Choose at least one audience to add them to."); return; }
        var email = (el("amEmail").value || "").trim();
        if (!email) return;
        nlAudienceMsg("Adding…");
        authFetch("/api/admin/subscriber-list-members", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            listIds: listIds,
            name: (el("amName").value || "").trim() || undefined,
            email: email,
            phone: (el("amPhone").value || "").trim() || undefined,
          }),
        })
          .then(function (res) { return res.json().then(function (b) { return { ok: res.ok, b: b }; }); })
          .then(function (r) {
            if (!r.ok) { nlAudienceMsg((r.b && r.b.error) || "Could not add them."); return; }
            el("amEmail").value = ""; el("amName").value = ""; el("amPhone").value = "";
            nlAudienceMsg(nlAddOutcomeText(r.b));
            return nlRefreshAudiences();
          })
          .catch(function () { nlAudienceMsg("Could not add them."); });
      });
    }

    // --- Spreadsheet import (TASK-260) ------------------------------------------------------------
    // { rows, listId } from the last preview. TASK-271: the preview now REMEMBERS which audience it
    // was taken against, and the commit refuses if that no longer matches the picker. Previously the
    // preview was only cleared by a successful import, so previewing against Volunteers, changing the
    // picker and clicking Import put the Volunteers rows into Newsletter.
    var importState = null;
    function importMsg(t) { var m = el("importMsg"); if (m) m.textContent = t || ""; }

    // Any change of destination or file invalidates a preview taken against the old one.
    function importReset() {
      importState = null;
      nlImportPreviewFor = null;
      if (el("importPreview")) el("importPreview").hidden = true;
      if (el("importAttest")) el("importAttest").checked = false;
      if (el("importCommitBtn")) el("importCommitBtn").disabled = true;
    }
    if (el("importListPick")) {
      el("importListPick").addEventListener("change", function () {
        if (importState) importMsg("Destination changed — preview the file again.");
        importReset();
      });
    }
    if (el("importFile")) el("importFile").addEventListener("change", importReset);

    if (el("importPreviewBtn")) {
      el("importPreviewBtn").addEventListener("click", function () {
        if (!canEdit("newsletter")) return;
        var f = el("importFile").files && el("importFile").files[0];
        if (!f) { importMsg("Choose a CSV or Excel file first."); return; }
        // TASK-283: several audiences at once. Falls back to the hidden legacy select if the tick
        // list has not rendered.
        var impTicks = el("importAudiences");
        var listIds = nlTickedIds(impTicks);
        if (!listIds.length && !nlTicksReady(impTicks) && el("importListPick") && el("importListPick").value) {
          listIds = [Number(el("importListPick").value)];
        }
        if (!listIds.length) { importMsg("Choose at least one audience to import into."); return; }
        importMsg("Reading…");
        var reader = new FileReader();
        reader.onload = function () {
          var base64 = String(reader.result).split(",")[1] || "";
          authFetch("/api/admin/subscriber-list-import/preview", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ listIds: listIds, filename: f.name, dataBase64: base64 }),
          })
            .then(function (res) { return res.json().then(function (b) { return { ok: res.ok, b: b }; }); })
            .then(function (r) {
              if (!r.ok) { importMsg((r.b && r.b.error) || "Could not read that file."); return; }
              importState = { rows: r.b.rows, listIds: listIds };
              // The preview belongs to the audiences it was taken against. nlPaintTickButtons
              // compares this on every tick change and tears the preview down if they diverge.
              nlImportPreviewFor = listIds.join(",");
              var names = (r.b.audiences || []).map(function (x) { return x.listName; });
              var where = names.length ? " into " + nlAndList(names) : "";
              // The destination is repeated ON the button you press, so the last thing you read
              // before importing is where these people are going.
              if (el("importCommitBtn")) {
                el("importCommitBtn").textContent = "Import " + r.b.readyCount + where;
              }
              var bits = [r.b.readyCount + " ready to import" + where];
              // "Already on EVERY one you picked" — with several audiences in play, "already on the
              // list" would say nothing needed doing when hundreds of additions did.
              if (r.b.alreadyOnEvery && r.b.alreadyOnEvery.length) {
                bits.push(r.b.alreadyOnEvery.length + " already on every audience you picked");
              }
              if (r.b.previouslyUnsubscribed.length) {
                bits.push(r.b.previouslyUnsubscribed.length + " previously opted out (they will NOT be re-added)");
              }
              el("importSummary").textContent = bits.join(" · ");
              var issues = el("importIssues");
              issues.innerHTML = "";
              (r.b.issues || []).forEach(function (i) {
                var li = doc.createElement("li");
                li.textContent = "Row " + i.line + ": " + i.reason + (i.value ? " — " + i.value : "");
                issues.appendChild(li);
              });
              el("importAttest").checked = false;
              el("importCommitBtn").disabled = true;
              el("importPreview").hidden = false;
              importMsg("");
            })
            .catch(function () { importMsg("Could not read that file."); });
        };
        reader.readAsDataURL(f);
      });

      // The attestation is the gate: the import button only exists behind that tick.
      el("importAttest").addEventListener("change", function () {
        el("importCommitBtn").disabled = !el("importAttest").checked;
      });

      el("importCommitBtn").addEventListener("click", function () {
        if (!canEdit("newsletter") || !importState || !el("importAttest").checked) return;
        var ct = el("importAudiences");
        var listIds = nlTickedIds(ct);
        if (!listIds.length && !nlTicksReady(ct) && el("importListPick") && el("importListPick").value) {
          listIds = [Number(el("importListPick").value)];
        }
        // Last line of defence: never import rows into audiences they were not previewed against.
        // The tick handler already tears the preview down, but this is the check that actually
        // guards the write, and it compares the ids rather than trusting the UI to have kept up.
        if (listIds.join(",") !== (importState.listIds || []).join(",")) {
          importMsg("Audiences changed since the preview — preview the file again.");
          importReset();
          return;
        }
        importMsg("Importing…");
        authFetch("/api/admin/subscriber-list-import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ listIds: listIds, rows: importState.rows, attestation: true }),
        })
          .then(function (res) { return res.json().then(function (b) { return { ok: res.ok, b: b }; }); })
          .then(function (r) {
            if (!r.ok) { importMsg((r.b && r.b.error) || "Import failed."); return; }
            var into = (r.b.audiences || []).map(function (x) { return x.listName; });
            var bits = [r.b.added + " added" + (into.length ? " across " + nlAndList(into) : "")];
            if (r.b.alreadyOnList) bits.push(r.b.alreadyOnList + " already there");
            if (r.b.previouslyUnsubscribed) bits.push(r.b.previouslyUnsubscribed + " kept out (previously opted out)");
            importMsg(bits.join(" · "));
            el("importPreview").hidden = true;
            el("importFile").value = "";
            importState = null;
            return nlRefreshAudiences();
          })
          .catch(function () { importMsg("Import failed."); });
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
          nlTestSent = true; // TASK-277: the pre-send check stops nagging once a test has gone
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
          // TASK-285: "Saved" has to be earned - said only where a save genuinely succeeded, so
          // the header can never claim your work is safe when it is not.
          nlMarkSaved("Saved just now");
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
    el("newsletterMsg").textContent = "Queueing…";
    var pickedList = el("sendListPick") && el("sendListPick").value ? Number(el("sendListPick").value) : null;
    var body = pickedList ? { listId: pickedList } : {};
    // TASK-288: every chosen audience rides along. The server resolves them into ONE
    // deduplicated recipient list, so somebody on two of them is mailed once. listId stays for
    // the single-audience case and for anything older that still sends it.
    if (nlChosenAudiences.length) body.listIds = nlChosenAudiences.slice();
    // TASK-274: the gentle rollout. A quiet domain that suddenly emits thousands of messages looks
    // like a compromised account to Gmail; easing out over a few days builds the record that earns
    // the next day's larger allowance.
    if (el("sendRollout") && el("sendRollout").checked) body.rollout = "gentle";
    // TASK-280: <input type="datetime-local"> yields local wall-clock with no zone ("2026-08-25T09:00").
    // new Date() reads that as LOCAL time, which is what the person meant, and toISOString sends the
    // real instant — so a 9am schedule is 9am where they are, not 9am UTC.
    var when = el("sendScheduleAt") && el("sendScheduleAt").value;
    if (when) body.scheduledAt = new Date(when).toISOString();
    authFetch("/api/admin/newsletters/" + id + "/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then(function (res) {
        if (!res.ok) return res.json().then(function (b) { throw new Error((b && b.error) || "send failed"); });
        return res.json();
      })
      .then(function (r) {
        // Sending now happens in the background, so the honest message is "started", not "sent" —
        // and the progress panel below is what says how far it has got.
        if (r.status === "scheduled") {
          el("newsletterMsg").textContent =
            "Scheduled — " + r.recipientCount + " people will get it at " +
            new Date(r.scheduledAt).toLocaleString() + ". Nothing sends until then.";
        } else {
          el("newsletterMsg").textContent = r.rollout === "gentle"
            ? "Sending started, easing out gradually to " + r.recipientCount + " people."
            : "Sending started — " + r.recipientCount + " people queued.";
        }
        nlShowPanel("nlPanelSend"); // TASK-279: watch it go, rather than leaving you on the editor
        nlWatchSendJob(id);
        loadNewsletters();
      })
      .catch(function (err) {
        sendBtn.disabled = false;
        el("newsletterMsg").textContent = (err && err.message) || "Send failed (already sent, or not permitted).";
      })
      .finally(function () { if (closeModal) closeModal(); });
  }

  // TASK-274: live progress for a background send. Polls while the job is alive, and keeps working
  // after a page reload — the send is server-side now, so closing the browser does not stop it.
  // TASK-277: whether a test copy of the CURRENT draft has been sent. Reset whenever a different
  // newsletter is opened, so "you have tested this" can never be inherited from the last one.
  var nlTestSent = false;
  var nlSendPoll = null;
  function nlWatchSendJob(id) {
    if (nlSendPoll) clearInterval(nlSendPoll);
    nlRenderSendJob(id);
    nlSendPoll = setInterval(function () { nlRenderSendJob(id); }, 5000);
  }

  function nlRenderSendJob(id) {
    var box = el("sendProgress");
    if (!box) return;
    authFetch("/api/admin/newsletters/" + id + "/send-job")
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (job) {
        if (!job) { box.hidden = true; return; }
        box.hidden = false;
        var done = job.sent + job.failed;
        var pct = job.total > 0 ? Math.round((done / job.total) * 100) : 0;
        el("sendProgressFill").style.width = pct + "%";
        var text = job.sent + " of " + job.total + " sent";
        if (job.failed) text += " · " + job.failed + " failed";
        if (job.status === "paused") text += " · paused";
        else if (job.status === "cancelled") text += " · stopped";
        else if (job.status === "done") text = "All " + job.sent + " sent.";
        else if (job.scheduledAt && job.sent === 0) text = job.scheduleSummary || text;
        else if (job.summary) text += " — " + job.summary;
        el("sendProgressText").textContent = text;
        var live = job.status === "queued" || job.status === "running" || job.status === "paused";
        el("sendPause").hidden = job.status !== "running" && job.status !== "queued";
        el("sendResume").hidden = job.status !== "paused";
        el("sendCancel").hidden = !live;
        if (!live && nlSendPoll) { clearInterval(nlSendPoll); nlSendPoll = null; }
      })
      .catch(function () { /* progress is a convenience — the send continues regardless */ });
  }

  // A plain, scannable list: who it reached, who it did not, and the reason. Reuses the modal shell
  // the send confirmation uses so it looks like the rest of the admin rather than a bolted-on report.
  function nlShowRecipients(newsletterId) {
    var overlay = doc.createElement("div");
    overlay.className = "nl-modal-overlay";
    overlay.innerHTML =
      '<div class="nl-modal nl-modal-wide" role="dialog" aria-modal="true" aria-labelledby="nlWhoTitle">' +
      '<h3 class="nl-modal-title" id="nlWhoTitle">Who got this newsletter</h3>' +
      '<div class="nl-who-body">Loading…</div>' +
      '<div class="nl-modal-actions"><button type="button" class="nl-modal-cancel">Close</button></div>' +
      "</div>";
    doc.body.appendChild(overlay);
    function close() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }
    overlay.querySelector(".nl-modal-cancel").addEventListener("click", close);
    overlay.addEventListener("mousedown", function (e) { if (e.target === overlay) close(); });

    authFetch("/api/admin/newsletters/" + newsletterId + "/send-job/recipients")
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (rows) {
        var host = overlay.querySelector(".nl-who-body");
        if (!rows || !rows.length) {
          host.innerHTML = '<p class="admin-empty">No per-person record for this send. Newsletters sent before the send queue existed only have totals.</p>';
          return;
        }
        // TASK-303: the server decides each outcome (src/newsletter/recipient-outcome.ts) so there is
        // one definition of "arrived". This used to call anything we had handed over "Received",
        // which is a claim we were never in a position to make.
        var counts = {};
        rows.forEach(function (r) { counts[r.outcome] = (counts[r.outcome] || 0) + 1; });
        var ORDER = ["arrived", "sent-unconfirmed", "bounced", "waiting", "sending", "given-up"];
        var WORDS = {
          arrived: "arrived",
          "sent-unconfirmed": "sent, not yet confirmed",
          bounced: "blocked or bounced",
          waiting: "still to send",
          sending: "sending now",
          "given-up": "we gave up on",
        };
        var parts = ORDER.filter(function (k) { return counts[k]; }).map(function (k) {
          return "<b>" + counts[k] + "</b> " + WORDS[k];
        });
        host.innerHTML =
          '<p class="nl-who-summary">' + rows.length + " people: " + parts.join(" &middot; ") + "</p>" +
          '<p class="nl-note">Only <b>arrived</b> means a mailbox confirmed it. "Sent, not yet confirmed" is' +
          " normal for a while after a send - confirmations trickle in, and a young sending domain is" +
          " often held back briefly by the receiving server.</p>" +
          '<table class="admin-table"><thead><tr><th>Email</th><th>What happened</th><th>When</th><th>Problem</th></tr></thead><tbody>' +
          rows.map(function (r) {
            return "<tr><td>" + H.escapeHtml(r.email) + '</td><td class="nl-who-' + H.escapeHtml(r.outcome || "") + '">' +
              H.escapeHtml(r.outcomeLabel || r.status) +
              "</td><td>" + (r.sentAt ? H.fmtDate(r.sentAt) : "-") + "</td><td>" +
              (r.lastError ? '<span class="admin-muted">' + H.escapeHtml(r.lastError) + "</span>" : "") + "</td></tr>";
          }).join("") + "</tbody></table>";
      })
      .catch(function () {
        overlay.querySelector(".nl-who-body").textContent = "Could not load the recipient list.";
      });
  }

  function nlSendJobAction(action) {
    var id = el("newsletterId") && el("newsletterId").value;
    if (!id) return;
    if (action === "cancel" && !window.confirm(
      "Stop this send?\n\nAnyone already emailed keeps their copy — this only stops the rest going out. It cannot be restarted.",
    )) return;
    authFetch("/api/admin/newsletters/" + id + "/send-job/" + action, { method: "POST" })
      .then(function () { nlWatchSendJob(id); })
      .catch(function () { /* the panel refresh will show the real state */ });
  }

  // Centered confirmation dialog for sending. Shows the recipient count and an info tooltip listing
  // the consenting donor emails the send will reach (fetched from the admin-only recipients endpoint,
  // the same list the server sends to). Cancel / Esc / backdrop click dismiss without sending; "Yes,
  // send" runs nlDoSend. Focus moves into the dialog on open and returns to the Send button on close.
  function nlShowSendConfirm(id, sendBtn) {
    var prevFocus = doc.activeElement;
    // TASK-271: the confirmation NAMES the audience. It used to say "N consenting subscribers"
    // whoever they were, which read identically whether you were about to mail the volunteers or
    // every donor the charity has — the one check standing between the two.
    // TASK-288: name EVERY chosen audience, not just the first. This dialog is the last thing
    // between a draft and several hundred inboxes; saying "Volunteers" when it is going to
    // Volunteers AND Donors would make the one check that matters actively misleading.
    var chosenNames = nlChosenAudiences
      .map(function (cid) { var a = nlAudienceById(cid); return a ? a.name : null; })
      .filter(Boolean);
    if (!chosenNames.length) {
      var single = el("sendListPick") ? nlAudienceById(el("sendListPick").value) : null;
      if (single) chosenNames = [single.name];
    }
    var audienceName = chosenNames.length ? nlAndList(chosenNames) : "the newsletter audience";
    var overlay = doc.createElement("div");
    overlay.className = "nl-modal-overlay";
    overlay.innerHTML =
      '<div class="nl-modal" role="dialog" aria-modal="true" aria-labelledby="nlModalTitle">' +
      '<h3 class="nl-modal-title" id="nlModalTitle">Send to ' + H.escapeHtml(audienceName) + "?</h3>" +
      '<p class="nl-modal-text">This newsletter is about to go to <b>' + H.escapeHtml(audienceName) + "</b>." +
      '<span class="nl-recipients"><button type="button" class="nl-info" aria-label="Who will receive this?">' +
      '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>' +
      '</button><span class="nl-tooltip" role="tooltip"><span class="nl-tooltip-head">Loading recipients…</span></span></span></p>' +
      '<p class="nl-modal-count" aria-live="polite">Loading recipient list…</p>' +
      '<div class="nl-preflight" hidden></div>' +
      '<div class="nl-modal-actions">' +
      '<button type="button" class="nl-modal-cancel">Cancel</button>' +
      '<button type="button" class="nl-modal-confirm">Yes, send to ' + H.escapeHtml(audienceName) + "</button>" +
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

    // TASK-277: the pre-send checks. A send cannot be undone, so the mistakes that are obvious in
    // hindsight and invisible while writing — a button that goes nowhere, a mistyped merge tag that
    // reaches every reader as literal text — are surfaced HERE, where someone can still act.
    // A blocking finding requires a deliberate override rather than refusing outright: it is the
    // charity's newsletter, and a tool that flatly blocks invites people to work around it.
    (function runPreflight() {
      var host = overlay.querySelector(".nl-preflight");
      if (!host) return;
      authFetch("/api/admin/newsletters/preflight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: el("newsletterSubject") ? el("newsletterSubject").value : "",
          bodyJson: nlDoc,
          testSent: nlTestSent,
        }),
      })
        .then(function (res) { return res.ok ? res.json() : { findings: [] }; })
        .then(function (r) {
          var findings = (r && r.findings) || [];
          if (!findings.length) { host.hidden = true; return; }
          var blocking = findings.some(function (f) { return f.level === "block"; });
          host.hidden = false;
          host.innerHTML =
            '<p class="nl-preflight-head">' + (blocking ? "Worth fixing before you send" : "A couple of things to check") + "</p>" +
            "<ul>" + findings.map(function (f) {
              return '<li class="nl-preflight-' + f.level + '">' + H.escapeHtml(f.message) + "</li>";
            }).join("") + "</ul>" +
            (blocking
              ? '<label class="nl-preflight-ack"><input type="checkbox" class="nl-preflight-ok" /> <span>Send anyway — I know about the above</span></label>'
              : "");
          if (blocking) {
            confirmBtn.disabled = true;
            var ack = host.querySelector(".nl-preflight-ok");
            ack.addEventListener("change", function () { confirmBtn.disabled = !ack.checked; });
          }
        })
        .catch(function () { /* checks are advisory — never block a send on their failure */ });
    })();

    // Populate the recipient count + email list. Send stays available even if this lookup fails —
    // the server recomputes the authoritative list at send time.
    // TASK-288: ask for the DEDUPLICATED union of every chosen audience, so the count in the
    // confirmation is the count that will actually be mailed - not a sum that double-counts anyone
    // on two lists.
    authFetch("/api/admin/newsletters/recipients" +
      (nlChosenAudiences.length
        ? "?listIds=" + nlChosenAudiences.join(",")
        : el("sendListPick") && el("sendListPick").value
          ? "?listId=" + el("sendListPick").value
          : ""))
      .then(function (res) { if (!res.ok) throw new Error(String(res.status)); return res.json(); })
      .then(function (r) {
        var emails = r.emails || [];
        var n = typeof r.count === "number" ? r.count : emails.length;
        // The server's own name for the audience wins over the client's copy — it is the one that
        // will actually be mailed.
        var named = r.audience || audienceName;
        countEl.textContent = "That is " + n + " " + (n === 1 ? "person" : "people") + " on " + named +
          (r.kind === "everyone" ? ", including every donor who agreed to email." : ".");
        var list = emails.map(function (e) { return '<span class="nl-tooltip-email">' + H.escapeHtml(e) + "</span>"; }).join("");
        tooltip.innerHTML = '<span class="nl-tooltip-head">Recipients (' + n + ')</span>' +
          (list || '<span class="nl-tooltip-email">No one on this audience.</span>');
      })
      .catch(function () {
        // Never claim a reach we could not confirm — the old copy said the send "will still reach all
        // consenting subscribers" even for a volunteers-only send.
        countEl.textContent = "Could not load the recipient list. The send will go to " + audienceName + ".";
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
          ? '<button class="admin-link" type="button" data-ticker-edit="' + r.id + '" data-ticker-name="' + H.escapeHtml(r.name) + '">Edit</button>' +
            ' · <button class="admin-link" type="button" data-ticker-toggle="' + r.id + '" data-active="' + (r.active ? "1" : "0") + '">' +
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
      // Rename (TASK-262): PATCH accepts a name (supporterUpdateSchema), so this fixes a typo in
      // place instead of delete-and-re-add, which would lose the row's sort_order and audit trail.
      // prompt() pre-fills the current name and matches the confirm() used by Delete below.
      var edit = t.closest("[data-ticker-edit]");
      if (edit) {
        var current = edit.getAttribute("data-ticker-name") || "";
        var next = window.prompt("Partner name", current);
        if (next === null) return; // cancelled
        next = next.trim();
        if (!next || next === current) return; // empty or unchanged — nothing to do
        tickerStatus("Saving…");
        authFetch("/api/admin/ticker/" + edit.getAttribute("data-ticker-edit"), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: next }),
        })
          .then(function (res) {
            if (!res.ok) throw new Error("rename failed");
            tickerStatus("Saved.", "is-ok");
            loadTicker();
          })
          .catch(function () {
            tickerStatus("Could not rename that partner.", "is-error");
          });
        return;
      }
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
