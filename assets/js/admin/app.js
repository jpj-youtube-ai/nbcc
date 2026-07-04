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
  function selectView(name) {
    Array.prototype.forEach.call(doc.querySelectorAll(".admin-nav-link"), function (b) {
      b.classList.toggle("is-active", b.getAttribute("data-view") === name);
    });
    Array.prototype.forEach.call(doc.querySelectorAll(".admin-view"), function (v) {
      v.hidden = v.id !== "view-" + name;
    });
    if (name === "search") {
      var q = el("searchQuery");
      if (q && q.focus) q.focus();
    }
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
          H.escapeHtml(d.claim_status) + "</td><td>" + H.fmtDate(d.created_at) + "</td></tr>"
        );
      })
      .join("");
    return (
      '<table class="admin-table"><thead><tr><th>ID</th><th>Donor</th><th>Gift</th>' +
      "<th>Amount</th><th>Gift Aid</th><th>Claim</th><th>Date</th></tr></thead><tbody>" +
      body + "</tbody></table>"
    );
  }
  function loadOverview() {
    var stats = el("overviewStats");
    Promise.all([
      authFetch("/api/admin/claims/adjustment-due").then(j),
      authFetch("/api/admin/queues/retention-expiry").then(j),
      authFetch("/api/admin/queues/awaiting-declaration").then(j),
    ])
      .then(function (r) {
        stats.innerHTML =
          statCard((r[0].results || []).length, "Adjustments due", true) +
          statCard((r[1].results || []).length, "Retention expiring", true) +
          statCard((r[2].results || []).length, "Awaiting declaration", false);
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
          out.innerHTML = genericTable(data.results || []);
        })
        .catch(function () {
          out.innerHTML = '<p class="admin-empty">Search is unavailable.</p>';
        });
    });
  }

  // ---- boot: restore an in-tab session ----
  var claims = H.parseClaims(token());
  if (claims && typeof claims.exp === "number" && claims.exp > Date.now()) showApp(claims);
  else {
    clearToken();
    showLogin();
  }
})();
