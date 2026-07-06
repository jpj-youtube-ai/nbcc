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
    else if (name === "subscriptions") loadSubs();
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
      var sub = t.closest("[data-submit-batch]");
      if (sub) return submitBatch(sub.getAttribute("data-submit-batch"));
      var exp = t.closest("[data-export-batch]");
      if (exp) return exportBatch(exp.getAttribute("data-export-batch"));
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
