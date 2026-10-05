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
  var donationsShownOffset = 0; // the page the pager last showed, to go back to if a page fails
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
    "ticker", "ball", "events", "fundraising", "contact", "newsletter", "thank-you", "audit", "email-audit", "site", "outreach",
    "business-supporters", "analytics", "team",
  ];
  // KEEP IN SYNC with OPERATIONAL_EDITOR_SECTIONS there as well. Not cosmetic either: Manage access
  // pre-fills from this copy and Save stores what it shows, so a section missing here is silently
  // taken from editors on save (TASK-459). admin-sections-in-sync.test.ts checks every role.
  var OPERATIONAL_EDITOR_SECTIONS = [
    "donations", "claims", "gasds", "subscriptions", "stories", "ticker", "contact", "newsletter", "thank-you", "search",
    "outreach", "events", "fundraising",
  ];
  // Get involved: one tab holding two of those sections. "events" and "fundraising" are still the
  // permission sections, and the server's names for the two old tabs (the Overview's buttons, the
  // New pills); here they are only where in the one tab each lands.
  var GI_VIEW = "get-involved";
  var GI_SECTIONS = ["signups", "events", "tickets", "emails", "settings"];
  var GI_OLD_VIEWS = { events: "events", fundraising: "signups" }; // old tab -> the section it opens
  var GI_AREA = { signups: "fundraising", events: "events" }; // section -> the New pill it is a visit to
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
      perms = { overview: "view", audit: "view", team: "none", ball: "view", site: "view" };
      OPERATIONAL_EDITOR_SECTIONS.forEach(function (s) { perms[s] = "edit"; });
      return perms;
    }
    // email-audit mirrors team: donor-identifying send data never arrives with a role below
    // admin — it is granted per person (matches roleToPermissions in src/admin/permissions.ts).
    SECTIONS.forEach(function (s) {
      perms[s] = s === "team" || s === "email-audit" || s === "business-supporters" || s === "analytics" ? "none" : "view";
    });
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
  // TASK-476: a panel's data, but only when the server said it was fine. authFetch stops only on a
  // 401; any other failure still answers in JSON, an { error } with no results in it, and read as
  // data that drew zeros, empty lists and "nothing due" as if all were well. Throwing sends the
  // failure to the loader's catch instead, which says the panel could not load.
  function okJson(res) {
    if (!res.ok) {
      var err = new Error("status " + res.status);
      err.status = res.status; // so a 403 (not in your access) can be told from a failure
      throw err;
    }
    return res.json();
  }
  // The same, for an action the server may refuse (a 4xx) with its own reason, such as "Those seats
  // have already been released.": that reason rides on the error as err.said. A 5xx has nothing
  // worth repeating ("Admin is temporarily unavailable"), so it is a plain failure.
  function okJsonOrSaid(res) {
    if (res.ok || res.status >= 500) return okJson(res);
    return res.json().then(
      function (b) {
        var err = new Error("status " + res.status);
        err.status = res.status;
        err.said = b && typeof b.error === "string" ? b.error : "";
        throw err;
      },
      function () { return okJson(res); },
    );
  }
  // What a panel shows in place of its data when that data could not be fetched.
  function unavailableHtml(message) {
    return '<p class="admin-empty admin-unavailable">' + H.escapeHtml(message) + "</p>";
  }

  function showLogin() {
    storiesImportReset("");
    brReset();
    frKindReset();
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
    // TASK-478: a fresh start for whoever has signed in, so nobody sees the last person's pills.
    resetWhatsNew();
    refreshWhatsNew();
    loadMyPermissions();
    refreshEnquiryNotice();
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
      // Back to where they were, or the overview on a fresh sign-in. TASK-508: opening the overview
      // loads it (selectView), so it is read once, and only when it is the screen being shown.
      var resume = restorableView();
      selectView(resume || "overview");
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
    bindClick("enquiryNoticeGo", function () {
    selectView("contact");
  });

  Array.prototype.forEach.call(doc.querySelectorAll(".admin-nav-link"), function (b) {
      var section = b.getAttribute("data-view");
      if (section === "overview") return;
      // A tab may gate on EDIT of another permission section (data-edit-gate) rather than on its own
      // data-view - e.g. Business supporters gates on business-supporters:edit, matching its server
      // route. Or on VIEW of another section (data-view-gate), when its screen has no permission of
      // its own: Monthly givers reads the donations list's data, so it shows to anyone who may see
      // donations (TASK-457). Everything else gates on view of its own section, as before.
      var editGate = b.getAttribute("data-edit-gate");
      var viewGate = b.getAttribute("data-view-gate");
      // Or on VIEW of any one of several sections (data-view-gate-any): Get involved holds the Events
      // and the Fundraising sections, and shows to anyone who may see either.
      var anyGate = b.getAttribute("data-view-gate-any");
      if (anyGate) {
        b.hidden = !anyGate.split(" ").some(canView);
        return;
      }
      b.hidden = editGate ? !canEdit(editGate) : !canView(viewGate || section);
    });
    var teamNavGroup = el("teamNavGroup");
    // The Admin group's label shows over any link in it that is shown: Analytics (TASK-482) can be
    // given to someone who cannot see Team.
    if (teamNavGroup) teamNavGroup.hidden = !canView("team") && !canView("analytics");
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
  // TASK-425: enquiries waiting for a reply, on every view.
  //
  // A contact enquiry used to be invisible unless you deliberately opened Content > Contact form,
  // so somebody could write to the charity and simply wait. The label is built by the server
  // (src/contact/enquiry-summary.ts) rather than here, so the rule that is tested is the rule
  // that ships.
  function refreshEnquiryNotice() {
    var bar = el("enquiryNotice");
    var text = el("enquiryNoticeText");
    if (!bar || !text) return;
    authFetch("/api/admin/contact/unanswered")
      .then(j)
      .then(function (d) {
        if (!d || !d.label) {
          bar.hidden = true;
          return;
        }
        text.textContent = d.label;
        bar.hidden = false;
      })
      .catch(function () {
        // Staying hidden is the honest failure. The bar appears only when we KNOW something is
        // waiting, so a failed count never becomes a confident all-clear, and someone without
        // permission to read enquiries simply never sees it.
        bar.hidden = true;
      });
  }

  // TASK-478: a New pill on each section holding something this person has not seen yet, and on
  // the things inside it that arrived since their last visit. Per person: the server remembers when
  // each of us last opened each section (src/routes/admin-whats-new.ts), so one person opening it
  // clears the pill for them alone.
  var whatsNew = null; // area -> { new, since }, from the server; null until it first answers
  var whatsNewLoad = null; // the latest request for it
  var seenHere = {}; // area -> when this tab recorded a visit, so a slower answer cannot undo it
  var visitSince = {}; // area -> the "since" this visit's row pills compare against
  var currentView = null;

  function resetWhatsNew() {
    whatsNew = null;
    whatsNewLoad = null;
    seenHere = {};
    visitSince = {};
    currentView = null;
    renderNewPills();
  }
  // The comma is for a screen reader, so the section reads as "Contact form, New".
  var NEW_PILL = '<span class="admin-new-pill"><span class="sr-only">, </span>New</span>';

  function refreshWhatsNew() {
    whatsNewLoad = authFetch("/api/admin/whats-new")
      .then(okJson)
      .then(function (d) {
        var next = {};
        ((d && d.areas) || []).forEach(function (a) {
          var mine = seenHere[a.area];
          // An answer worked out before this tab's own visit was recorded is out of date for that
          // section. Anything the server counted after the visit is trusted as it stands.
          next[a.area] = mine && mine > a.since ? { new: false, since: mine } : { new: !!a.new, since: a.since };
        });
        whatsNew = next;
      })
      .catch(function () {
        // No pills is the honest failure: a pill appears only when we know something is new.
        if (!whatsNew) whatsNew = {};
      })
      .then(renderNewPills);
    return whatsNewLoad;
  }

  function renderNewPills() {
    var any = false;
    Array.prototype.forEach.call(doc.querySelectorAll(".admin-nav-link[data-view]"), function (b) {
      var old = b.querySelector(".admin-new-pill");
      if (old) old.remove();
      var area = b.getAttribute("data-view");
      // Get involved is two of the server's areas, fundraising and events: either lights it.
      var areas = area === GI_VIEW ? ["fundraising", "events"] : [area];
      var isNew = !b.hidden && areas.some(function (a) {
        return !!(whatsNew && whatsNew[a] && whatsNew[a].new) && a !== currentView;
      });
      if (!isNew) return;
      b.insertAdjacentHTML("beforeend", NEW_PILL);
      any = true;
    });
    // Inside Get involved, the section holding what is new says so too: Sign ups or Our events.
    Array.prototype.forEach.call(doc.querySelectorAll("#giSections [data-gi-section]"), function (b) {
      var old = b.querySelector(".admin-new-pill");
      if (old) old.remove();
      var area = GI_AREA[b.getAttribute("data-gi-section")];
      if (area && !b.hidden && whatsNew && whatsNew[area] && whatsNew[area].new && area !== currentView) {
        b.insertAdjacentHTML("beforeend", NEW_PILL);
      }
    });
    var toggle = el("adminNavToggle");
    if (!toggle) return;
    var oldT = toggle.querySelector(".admin-new-pill");
    if (oldT) oldT.remove();
    if (any) toggle.insertAdjacentHTML("beforeend", NEW_PILL);
  }

  // Opening a section: keep what it was new since for this visit's row pills, then record the visit.
  function beginVisit(name) {
    delete visitSince[name];
    (whatsNewLoad || refreshWhatsNew()).then(function () {
      if (currentView !== name || !whatsNew || !whatsNew[name]) return;
      visitSince[name] = whatsNew[name].since;
      authFetch("/api/admin/whats-new/seen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ area: name }),
      })
        .then(okJson)
        .then(function (d) {
          if (!d || !d.seenAt) return;
          seenHere[name] = d.seenAt;
          whatsNew[name] = { new: false, since: d.seenAt };
          renderNewPills();
        })
        .catch(function () {
          // Not recorded: the pill comes back next time, which is the safe way round.
        });
    });
  }

  // A row's pill: it arrived after this person's last visit to the section. Before the server has
  // answered for this visit, its previous answer stands in (it is from before the visit).
  function rowNewPill(area, when) {
    if (currentView !== area) return ""; // the Overview and Search share some of these tables
    var since = visitSince[area];
    if (since === undefined && whatsNew && whatsNew[area]) since = whatsNew[area].since;
    if (!since || !when) return "";
    // At or after, matching the server: times reach us cut to milliseconds, so an arrival the database
    // found later than the visit can look like the same moment (src/admin/whats-new.ts, isNew).
    return new Date(when) >= new Date(since) ? " " + NEW_PILL : "";
  }

  // TASK-443: which section you were last on. A refresh used to drop you back on the overview,
  // which is maddening halfway through working a list: you lose your place and have to navigate
  // back every time. sessionStorage rather than localStorage, matching where the session token
  // lives — it survives a refresh, which is the complaint, and dies with the tab, so a shared
  // machine never reopens on somebody else's last screen.
  var VIEW_KEY = "nbccAdminView";
  function rememberView(name) {
    try {
      sessionStorage.setItem(VIEW_KEY, name);
    } catch {
      // Private mode, or storage disabled. Losing your place is an annoyance; throwing here would
      // break navigation outright.
    }
  }
  // The remembered section, but ONLY if this user can still see it. Permissions change, and a
  // viewer restored onto a section their role no longer reaches would land on a blank panel with
  // no way to tell why. The nav link is the authority: it is already gated by permission, so a
  // missing or hidden link means "not yours".
  function restorableView() {
    var name;
    try {
      name = sessionStorage.getItem(VIEW_KEY);
    } catch {
      return null;
    }
    if (!name) return null;
    // "events" or "fundraising", left by a browser tab from before they became Get involved: only
    // if this person may see that part of it.
    if (GI_OLD_VIEWS[name]) return canView(name) ? name : null;
    var link = doc.querySelector('.admin-nav-link[data-view="' + name.replace(/"/g, "") + '"]');
    if (!link || link.hidden || link.offsetParent === null) return null;
    return name;
  }

  function selectView(name) {
    // The old Events and Fundraising tabs are sections of Get involved now. Everything that still
    // asks for them by name (the Overview's buttons, whose names come from the server, and a browser
    // tab that remembers one) lands on the tab at the right section.
    var wanted = null;
    if (GI_OLD_VIEWS[name]) {
      wanted = GI_OLD_VIEWS[name];
      // Sent to the sign ups by name ("3 new sign ups" on the Overview): every kind shows, so a kind
      // filter left on from earlier never makes that list look empty. By the menu, or after a
      // refresh, the filter stays as it was left.
      if (wanted === "signups") frKindReset();
      name = GI_VIEW;
    }
    rememberView(name);
    Array.prototype.forEach.call(doc.querySelectorAll(".admin-nav-link"), function (b) {
      b.classList.toggle("is-active", b.getAttribute("data-view") === name);
    });
    // TASK-454: choosing a section from the phone menu closes it, so what you chose is what you see.
    closeNav("chosen");
    showOnly("view-" + name);
    refreshEnquiryNotice();
    // TASK-478: the section you open loses its pill at once; the rest are asked about afresh.
    currentView = name;
    refreshWhatsNew();
    beginVisit(name);
    renderNewPills();
    if (name === "overview") {
      // TASK-508: "Needs you" is read afresh every time, so coming back to it is how you refresh it.
      loadOverview();
    } else if (name === "search") {
      var q = el("searchQuery");
      if (q && q.focus) q.focus();
    } else if (name === "donations") {
      donationsOffset = 0;
      loadDonations();
      loadDonationSources();
    } else if (name === "claims") loadClaims();
    else if (name === "gasds") loadGasds();
    else if (name === "subscriptions") loadSubs();
    else if (name === "fulfilments") loadFulfilments();
    else if (name === "monthly") loadMonthly();
    else if (name === "stories") loadStories();
    else if (name === "contact") loadContact();
    else if (name === "newsletter") loadNewsletters();
    else if (name === "thank-you") loadThankYou();
    else if (name === "outreach") loadOutreach();
    else if (name === "ticker") loadTicker();
    else if (name === "ball") loadBall();
    else if (name === GI_VIEW) giOpen(wanted);
    else if (name === "audit") loadAudit();
    else if (name === "email-audit") loadEmailAudit();
    else if (name === "analytics") loadAnalytics();
    else if (name === "site") loadSite();
    else if (name === "qr") loadQr();
    else if (name === "team") loadTeam();
    else if (name === "account") loadAccount();
  }
  Array.prototype.forEach.call(doc.querySelectorAll(".admin-nav-link"), function (b) {
    b.addEventListener("click", function () {
      selectView(b.getAttribute("data-view"));
    });
  });

  // ---- Get involved: one tab, five sections ----
  // Sign ups, Our events, Tickets and pledges, Emails and Settings: one shows at a time. The cards
  // are the old Events and Fundraising tabs' own, with their ids and their code; this only decides
  // which are on screen, and loads a section when it is shown, so opening the tab does not fetch
  // all five at once. Who sees what is the same as before: Our events and the Get involved page
  // switch follow the "events" permission section, everything else follows "fundraising". The
  // server is the real gate on every route; this keeps the screen from offering what it would refuse.
  var GI_SECTION_KEY = "nbccAdminGiSection";
  var giSection = null; // the section on screen
  var giVisited = {}; // New pill area -> its visit has been recorded since the tab was last opened

  function giMaySee(section) {
    if (section === "events") return canView("events");
    if (section === "settings") return canView("events") || canView("fundraising");
    return canView("fundraising");
  }
  function giButtons() {
    return Array.prototype.slice.call(doc.querySelectorAll("#giSections [data-gi-section]"));
  }
  function giRemembered() {
    try {
      return sessionStorage.getItem(GI_SECTION_KEY);
    } catch {
      return null;
    }
  }
  // Opening the tab: the section asked for (an old tab's name), else the one this browser tab was
  // last on, else the first; always one this person may see.
  function giOpen(wanted) {
    el("view-events").hidden = !canView("events");
    el("view-fundraising").hidden = !canView("fundraising");
    giButtons().forEach(function (b) {
      b.hidden = !giMaySee(b.getAttribute("data-gi-section"));
    });
    var section = [wanted, giRemembered()].concat(GI_SECTIONS).filter(function (s) {
      return GI_SECTIONS.indexOf(s) !== -1 && giMaySee(s);
    })[0];
    if (section) giShow(section, true);
  }
  // fresh: the tab has just been opened, so the section is read again even if it was the one
  // showing when the tab was left, as the old tabs read themselves again each time they opened.
  function giShow(section, fresh) {
    if (GI_SECTIONS.indexOf(section) === -1 || !giMaySee(section)) return;
    if (!fresh && section === giSection) return;
    giSection = section;
    try {
      sessionStorage.setItem(GI_SECTION_KEY, section);
    } catch {
      // Private mode: the section is not remembered through a refresh, and nothing else is lost.
    }
    giButtons().forEach(function (b) {
      var on = b.getAttribute("data-gi-section") === section;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    Array.prototype.forEach.call(doc.querySelectorAll("#view-get-involved [data-gi-intro]"), function (p) {
      // Settings has two lines: one for someone who sees only the Get involved page switch
      // (data-gi-only="events"), one for everyone who sees the fundraising settings.
      var eventsOnly = p.getAttribute("data-gi-only") === "events";
      p.hidden = p.getAttribute("data-gi-intro") !== section || eventsOnly === canView("fundraising");
    });
    // The card scripts (event-tickets.js, pledges.js, all-emails.js) watch their own part's hidden
    // mark and load when it comes off. A fresh opening hides every part first, so the part showing
    // is un-hidden again and its cards read themselves afresh.
    var all = doc.querySelectorAll("#view-get-involved [data-gi-part]");
    if (fresh) Array.prototype.forEach.call(all, function (p) { p.hidden = true; });
    Array.prototype.forEach.call(all, function (p) {
      // A part in a box this person may not see stays hidden with it, so nothing in it loads.
      p.hidden = p.getAttribute("data-gi-part") !== section || p.parentNode.hidden;
    });
    giPlaceEventsStatus(section);
    // The New pills: Sign ups is the visit the Fundraising tab recorded, Our events the Events tab's.
    // The other sections are a visit to neither, so a pill waits until its list has been looked at.
    // A visit is recorded once each time the tab is opened, as the old tabs did, not each time a
    // section comes back: a second visit would take the New pills off the rows still being read.
    var area = GI_AREA[section];
    currentView = area || GI_VIEW;
    if (fresh) giVisited = {};
    if (area && !giVisited[area]) {
      giVisited[area] = true;
      beginVisit(area);
    }
    renderNewPills();
    giLoad(section);
  }
  // One status line serves both the page switch and the events under it ("Deleted." is said there).
  // It used to sit between the two; now they are in different sections, so it goes to whichever of
  // them is on screen: under the switch in Settings, above the list in Our events.
  function giPlaceEventsStatus(section) {
    var line = el("evSwitchStatus");
    var home = doc.querySelector('#view-events [data-gi-part="' + section + '"]');
    if (!line || !home || line.parentNode === home) return;
    // What it last said belongs to where it was ("Deleted." is not about the page switch).
    line.textContent = "";
    line.className = "ty-status";
    if (section === "settings") home.appendChild(line);
    else home.insertBefore(line, home.firstChild);
  }
  function giLoad(section) {
    if (section === "signups") loadFundraising();
    else if (section === "events") {
      loadEvents();
      loadBallReport();
      // The previews are not fitted while this section is off screen (a hidden frame measures
      // nothing), so an event already open is fitted again now that it can be measured.
      evFitCard();
      evFitPage();
    } else if (section === "emails") frLoadEmailsSection();
    else if (section === "settings") {
      if (canView("events")) evLoadSwitch();
      if (canView("fundraising")) frLoadSettingsSection();
    }
    // Tickets and pledges: its two cards load themselves when their part is shown.
  }
  (function giWire() {
    var row = el("giSections");
    var tab = el("view-get-involved");
    if (!row || !tab) return;
    row.addEventListener("click", function (e) {
      var b = e.target && e.target.closest ? e.target.closest("[data-gi-section]") : null;
      if (b) giShow(b.getAttribute("data-gi-section"));
    });
    // Arrow keys, Home and End move along the buttons that are offered, and show that section.
    row.addEventListener("keydown", function (e) {
      var keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1, Home: "first", End: "last" };
      var move = keys[e.key];
      var from = e.target && e.target.closest ? e.target.closest("[data-gi-section]") : null;
      if (!move || !from) return;
      var offered = giButtons().filter(function (b) { return !b.hidden; });
      var at = offered.indexOf(from);
      if (at === -1) return;
      e.preventDefault();
      var next = move === "first" ? offered[0] : move === "last" ? offered[offered.length - 1]
        : offered[(at + move + offered.length) % offered.length];
      next.focus();
      giShow(next.getAttribute("data-gi-section"));
    });
    // A link to the All emails card ("Read and approve these in All emails", "Read its automatic
    // emails") can sit in another section. Caught on the way down, so Emails is on screen before
    // all-emails.js opens the card and scrolls to it.
    tab.addEventListener("click", function (e) {
      var link = e.target && e.target.closest ? e.target.closest("[data-allemails-open]") : null;
      if (link) giShow("emails");
    }, true);
  })();

  // TASK-454: below 860px the sections sit behind one Menu button, because the line of twenty that
  // used to scroll sideways broke the client's standing rule that nothing in the admin does. The
  // button is only shown at that width (admin.css), so on a desktop none of this ever runs.
  var navToggle = el("adminNavToggle");
  var navBar = navToggle ? navToggle.closest(".admin-nav") : null;
  var navReturnY = null; // where you were when you opened the menu from further down a long page
  var navSeen = false; // the open list has been on screen, so scrolling past it means you are done
  function navIsOpen() {
    return !!navBar && navBar.classList.contains("is-open");
  }
  function markNav(open) {
    navBar.classList.toggle("is-open", open);
    navToggle.setAttribute("aria-expanded", open ? "true" : "false");
  }
  function openNav() {
    if (!navBar || navIsOpen()) return;
    // Read BEFORE the list opens. Opening adds its height to the page above you, and the browser
    // moves the scroll position to keep your place on screen, so read afterwards it was 614px out
    // and closing the menu put you that much further down the page.
    var y = window.pageYOffset;
    markNav(true);
    // Open, the list stops being pinned and takes its place in the page (admin.css), so it can be
    // as long as it needs to be without scrolling inside itself. Opened from further down a long
    // page that place is above you, so go up to it, remembering where you were. jsdom has no
    // layout, so its rect is all zeros and it never scrolls.
    var top = navBar.getBoundingClientRect().top;
    navReturnY = top < 0 ? y : null;
    navSeen = top >= 0;
    if (top < 0) window.scrollTo(0, window.pageYOffset + top);
  }
  // Where closing leaves you depends on why it closed:
  //   "back"   - Menu again, or Escape: back to where you were when you opened it
  //   "chosen" - you picked a section: the top of it, just under the pinned bar
  //   "passed" - you scrolled on past it: exactly where you are
  function closeNav(how) {
    if (!navIsOpen()) return;
    var content = navBar.nextElementSibling;
    var before = how === "passed" && content ? content.getBoundingClientRect().top : 0;
    markNav(false);
    if (how === "back" && navReturnY !== null) window.scrollTo(0, navReturnY);
    if (how === "chosen") {
      // A list taller than the screen has to be scrolled to reach its last sections, and choosing
      // one used to leave the top of the new section hidden under the pinned bar.
      var gridTop = navBar.parentNode.getBoundingClientRect().top;
      if (gridTop < 0) window.scrollTo(0, window.pageYOffset + gridTop);
    }
    if (how === "passed" && content) {
      // Closing takes the list's height out of the page above you. Chrome keeps your place by
      // itself; a browser that does not would jump by the height of the list, so put back whatever
      // moved. A whole pixel or more only: a fraction left over on a phone whose pixels are not
      // whole CSS pixels moves nothing you can see, and an instant scroll would stop your flick.
      var moved = content.getBoundingClientRect().top - before;
      if (Math.abs(moved) >= 1) window.scrollBy({ top: moved, behavior: "instant" });
    }
    navReturnY = null;
    navSeen = false;
    // A keyboard user was on a button in a list that has just vanished: put them back on Menu.
    if (navBar.contains(doc.activeElement)) navToggle.focus({ preventScroll: true });
  }
  if (navToggle) {
    navToggle.addEventListener("click", function () {
      if (navIsOpen()) closeNav("back");
      else openNav();
    });
    navBar.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeNav("back");
    });
    // The pinned button exists so changing section never means scrolling back up for it. An open
    // list you scroll on past without choosing has been dismissed, so close it and the pinned
    // button is back. Not on the way up to it, though: opened from further down, the list starts
    // above the screen while the page scrolls up to it.
    window.addEventListener("scroll", function () {
      if (!navIsOpen()) return;
      if (navBar.getBoundingClientRect().bottom > 0) navSeen = true;
      else if (navSeen) closeNav("passed");
    }, { passive: true });
    // A phone or tablet turned on its side can take the screen past the width where the menu is a
    // button (admin.css). Open means nothing there, and left behind it would leave aria-expanded
    // saying "true" on a button nobody can see.
    var phoneWidth = window.matchMedia ? window.matchMedia("(max-width:860px)") : null;
    if (phoneWidth && phoneWidth.addEventListener) {
      phoneWidth.addEventListener("change", function (e) {
        if (!e.matches) closeNav("passed");
      });
    }
  }

  // ---- overview ----
  function statCard(n, label, warn) {
    return (
      '<div class="admin-stat' + (warn && n > 0 ? " warn" : "") + '">' +
      '<div class="n">' + n + '</div><div class="l">' + H.escapeHtml(label) + "</div></div>"
    );
  }
  // opts.newPills: only the Donations screen marks new rows (TASK-478). The Overview and Search draw
  // this same table, and can load while Donations is the open section, straight after a refresh.
  //
  // TASK-483: where the list is narrow it becomes labelled cards (admin.css, .dn-list), so every cell
  // carries its column's name, and the wrapper is what the stylesheet measures. The cards move the
  // donor to the top by position, so admin-fits-a-phone.test.ts checks these columns and their order.
  function donationsTable(rows, opts) {
    opts = opts || {};
    if (!rows.length) return '<p class="admin-empty">' + H.escapeHtml(opts.empty || "No donations yet.") + "</p>";
    var body = rows
      .map(function (d) {
        var gift = d.plan ? H.escapeHtml(d.mode) + " · " + H.escapeHtml(d.plan) : H.escapeHtml(d.mode);
        // A gift started on Fill a Red Bag (donations.source) says so beside the gift, in all three lists.
        if (d.source === "red_bag") gift += ' <span class="admin-pill dn-source-pill">Red Bag</span>';
        // TASK-241: one Payment pill combining payment_status + any refund (see helpers.paymentLabel).
        var pay = H.paymentLabel(d);
        return (
          '<tr><td data-label="ID">' + d.id + '</td><td data-label="Donor">' + H.escapeHtml(d.donor_name) +
          '</td><td data-label="Donation">' + gift +
          '</td><td class="admin-num" data-label="Amount">' + H.formatPence(d.amount_pence) +
          '</td><td data-label="Gift Aid">' +
          (d.gift_aid ? '<span class="admin-pill">Gift Aid</span>' : "") + '</td><td data-label="Claim">' +
          H.escapeHtml(d.claim_status) + '</td><td data-label="Payment"><span class="admin-pill admin-pill--' +
          pay.state + '">' + H.escapeHtml(pay.label) + '</span></td><td data-label="Date">' + H.fmtDate(d.created_at) +
          (opts.newPills ? rowNewPill("donations", d.payment_status === "paid" ? d.created_at : null) : "") +
          '</td><td data-label=""><button class="admin-link" type="button" data-donor="' + d.donor_id +
          '">View</button></td></tr>'
        );
      })
      .join("");
    return (
      '<div class="dn-list"><table class="admin-table dn-table"><thead><tr><th>ID</th><th>Donor</th><th>Donation</th>' +
      "<th>Amount</th><th>Gift Aid</th><th>Claim</th><th>Payment</th><th>Date</th><th></th></tr></thead><tbody>" +
      body + "</tbody></table></div>"
    );
  }
  // TASK-508: "Needs you". GET /api/admin/overview counts what is waiting, within this person's access,
  // and words it (src/admin/overview.ts); this only draws it. The five Gift Aid figures that used to
  // sit here are lines in it now, in the slowest of the three groups.
  var NEED_LEVEL_WORDS = { 1: "Urgent: ", 2: "Waiting: ", 3: "Coming due: " };
  // A button is named after the tab it opens, and the server names it. Events and Fundraising are
  // sections of Get involved now, so a button to either says the tab it really opens; pressing it
  // still lands on the right section (selectView).
  function ovButtonWords(item) {
    return GI_OLD_VIEWS[item.view] ? "Get involved" : item.button;
  }
  function needsHtml(d) {
    var esc = H.escapeHtml;
    var needs = d.needs || [];
    var failed = d.failed || [];
    var list = needs.length
      ? '<ul class="ov-needs">' +
        needs
          .map(function (n) {
            return (
              '<li class="ov-need" data-level="' + Number(n.level) + '">' +
              '<span class="ov-dot" aria-hidden="true"></span>' +
              '<span class="ov-text"><span class="sr-only">' + (NEED_LEVEL_WORDS[n.level] || "") + "</span>" + esc(n.text) + "</span>" +
              '<button type="button" class="admin-btn admin-btn--small ov-go" data-ov-view="' + esc(n.view) + '">' + esc(ovButtonWords(n)) + "</button>" +
              "</li>"
            );
          })
          .join("") +
        "</ul>"
      : "";
    // Never "nothing needs you" when part of it could not be checked: that would be a guess.
    var quiet = !needs.length && !failed.length ? '<p class="ov-clear">Nothing needs you right now.</p>' : "";
    var gaps = failed.length
      ? '<p class="ov-failed">Could not check: ' + esc(failed.join(", ")) + ". Open Overview again in a moment.</p>"
      : "";
    return list + quiet + gaps;
  }
  // TASK-509: how we are doing, one line each, worded by src/admin/overview-numbers.ts. The card
  // stays hidden for someone who may see none of them.
  function numbersHtml(numbers) {
    var esc = H.escapeHtml;
    return (
      '<ul class="ov-numbers">' +
      numbers
        .map(function (n) {
          return (
            '<li class="ov-number">' +
            '<span class="ov-number-title">' + esc(n.title) + "</span>" +
            '<span class="ov-number-body">' +
            '<span class="ov-number-headline">' + esc(n.headline) + "</span>" +
            '<span class="ov-number-detail">' + esc(n.detail) + "</span>" +
            "</span>" +
            '<button type="button" class="admin-btn admin-btn--small ov-go" data-ov-view="' + esc(n.view) + '">' + esc(ovButtonWords(n)) + "</button>" +
            "</li>"
          );
        })
        .join("") +
      "</ul>"
    );
  }
  function showNumbers(numbers) {
    var list = numbers || [];
    el("overviewNumbers").innerHTML = list.length ? numbersHtml(list) : "";
    el("ovNumbersCard").hidden = !list.length;
  }
  // TASK-510: Coming up, the next 14 days by day, from src/admin/overview-coming-up.ts. Hidden when
  // nothing this person may see is coming.
  function comingHtml(days) {
    var esc = H.escapeHtml;
    return days
      .map(function (d) {
        return (
          '<section class="ov-day">' +
          '<h4 class="ov-day-label">' + esc(d.label) + "</h4>" +
          '<ul class="ov-events">' +
          (d.items || [])
            .map(function (i) {
              return (
                '<li class="ov-event">' +
                '<span class="ov-event-when">' + esc(i.when) + "</span>" +
                '<span class="ov-event-text">' + esc(i.text) + "</span>" +
                '<button type="button" class="admin-btn admin-btn--small ov-go" data-ov-view="' + esc(i.view) + '">' + esc(ovButtonWords(i)) + "</button>" +
                "</li>"
              );
            })
            .join("") +
          "</ul></section>"
        );
      })
      .join("");
  }
  function showComing(days) {
    var list = days || [];
    el("overviewComing").innerHTML = list.length ? comingHtml(list) : "";
    el("ovComingCard").hidden = !list.length;
  }
  function overviewTime(iso) {
    var t = new Date(iso);
    if (isNaN(t.getTime())) return "";
    return "Updated " + t.toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit" });
  }
  var overviewWired = false;
  function loadOverview() {
    if (!overviewWired) {
      overviewWired = true;
      // Delegated, and attached once: the list is drawn again on every visit.
      var openView = function (e) {
        var btn = e.target.closest && e.target.closest("[data-ov-view]");
        if (btn) selectView(btn.getAttribute("data-ov-view"));
      };
      el("overviewNeeds").addEventListener("click", openView);
      el("overviewNumbers").addEventListener("click", openView);
      el("overviewComing").addEventListener("click", openView);
    }
    authFetch("/api/admin/overview")
      .then(okJson)
      .then(function (d) {
        el("overviewNeeds").innerHTML = needsHtml(d);
        showNumbers(d.numbers);
        showComing(d.comingUp);
        el("overviewUpdated").textContent = overviewTime(d.updatedAt);
      })
      .catch(function (err) {
        if (err && err.message === "unauthorized") return;
        el("overviewNeeds").innerHTML = unavailableHtml("The overview could not load. Open it again in a moment.");
        // Never last visit's numbers under a message that says nothing could load.
        showNumbers([]);
        showComing([]);
        el("overviewUpdated").textContent = "";
      });
    authFetch("/api/admin/donations?limit=5")
      .then(okJson)
      .then(function (d) {
        el("overviewRecent").innerHTML = donationsTable(d.results || []);
      })
      .catch(function (err) {
        el("overviewRecent").innerHTML = unavailableHtml(
          err && err.status === 403
            ? "Recent donations are not part of your access."
            : "Recent donations are unavailable.",
        );
      });
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
        .then(okJson)
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
    // TASK-446: regular giving vs one-off. The two filters combine, so "monthly and failed" is a
    // question you can ask - which is the one worth asking when a standing order stops.
    var modeFilter = el("donationsModeFilter");
    var mode = modeFilter ? modeFilter.value : "";
    // Fill a Red Bag only: the server narrows the list (it pages it), together with the two above.
    var redBagFilter = el("donationsRedBagFilter");
    var redBag = !!(redBagFilter && redBagFilter.checked);
    authFetch(
      "/api/admin/donations?limit=25&offset=" + donationsOffset +
        (pay ? "&paymentStatus=" + encodeURIComponent(pay) : "") +
        (mode ? "&mode=" + encodeURIComponent(mode) : "") +
        (redBag ? "&source=red_bag" : ""),
    )
      .then(okJson)
      .then(function (d) {
        wrap.innerHTML = donationsTable(d.results || [], {
          newPills: true,
          empty: !redBag ? "" : pay || mode ? "No Fill a Red Bag gifts match these filters." : "No Fill a Red Bag gifts yet.",
        });
        var total = d.total || 0;
        el("donationsPager").hidden = total <= 25;
        el("donationsInfo").textContent = total
          ? donationsOffset + 1 + "-" + Math.min(donationsOffset + 25, total) + " of " + total
          : "";
        el("donationsPrev").disabled = donationsOffset <= 0;
        el("donationsNext").disabled = donationsOffset + 25 >= total;
        donationsShownOffset = donationsOffset;
      })
      .catch(function () {
        wrap.innerHTML = unavailableHtml("Donations are unavailable.");
        // The pager stays as it was, and so does its place: Previous and Next try that page again.
        donationsOffset = donationsShownOffset;
      });
  }
  // Fill a Red Bag against the Donate page, at the top of the Donations screen: this month and in
  // all, worded by the server (src/admin/gift-sources.ts). Read when the screen opens, on its own, so
  // the list works whatever happens here. A failure, or an answer with no lines in it, says it could
  // not load: never a zero, and never the last visit's figures.
  function loadDonationSources() {
    var box = el("donationsSources");
    if (!box) return;
    // Loading, as the list beside it says: the last visit's figures are never shown as current.
    box.innerHTML = '<p class="admin-loading">Loading…</p>';
    authFetch("/api/admin/donations/source-totals")
      .then(okJson)
      .then(function (d) {
        var lines = d && Array.isArray(d.lines) ? d.lines : [];
        if (!lines.length) throw new Error("no totals");
        var esc = H.escapeHtml;
        box.innerHTML =
          '<dl class="dn-sources-list">' +
          lines
            .map(function (l) {
              return (
                '<div class="dn-source"><dt>' + esc(l.name) + "</dt><dd>" +
                esc(l.month) + " this month, " + esc(l.all) + " in all</dd></div>"
              );
            })
            .join("") +
          "</dl>" +
          (d.note ? '<p class="dn-sources-note">' + esc(d.note) + "</p>" : "");
      })
      .catch(function (err) {
        if (err && err.message === "unauthorized") return;
        box.innerHTML = unavailableHtml("The Fill a Red Bag and Donate page totals could not load.");
      });
  }
  // Both filters behave the same way: change it, go back to page one. Staying on page 4 of a
  // different list shows you an empty table and looks like the filter found nothing.
  ["donationsPaymentFilter", "donationsModeFilter", "donationsRedBagFilter"].forEach(function (id) {
    var control = el(id);
    if (control)
      control.addEventListener("change", function () {
        donationsOffset = 0;
        loadDonations();
      });
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
      .then(okJson)
      .then(function (d) {
        el("gasdsTable").innerHTML = gasdsTable(d.results || [], canWrite);
        if (actions) actions.hidden = !(canWrite && (d.results || []).length);
      })
      .catch(function () {
        // Not "nothing is near its deadline": nobody knows, and a missed deadline is money lost.
        el("gasdsTable").innerHTML = unavailableHtml("GASDS donations are unavailable.");
        if (actions) actions.hidden = true;
      });
    // This year's pool report (REQ-050): three separately-read figures, never conflated.
    var poolEl = el("gasdsPool");
    if (poolEl) {
      authFetch("/api/admin/queues/gasds-pool")
        .then(okJson)
        .then(function (p) {
          poolEl.innerHTML =
            statCard(H.formatPence(p.gasdsPoolTotalPence), "Small donations pool (" + p.year + ")", false) +
            statCard(H.formatPence(p.giftAidClaimedPence), "Gift Aid claimed this year", false) +
            statCard(H.formatPence(p.remainingHeadroomPence), "Remaining GASDS headroom", false);
        })
        .catch(function () {
          poolEl.innerHTML = unavailableHtml("The small donations pool is unavailable.");
        });
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
      .then(okJson)
      .then(function (d) {
        el("eligibleTable").innerHTML = eligibleTable(d.results || [], canWrite);
      })
      .catch(function () {
        el("eligibleTable").innerHTML = unavailableHtml("Donations waiting to be claimed are unavailable.");
      });
    authFetch("/api/admin/claim-batches")
      .then(okJson)
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
      .catch(function () {
        el("batchesTable").innerHTML = unavailableHtml("Claim batches are unavailable.");
      });
    authFetch("/api/admin/claims/adjustment-due")
      .then(okJson)
      .then(function (d) {
        el("adjustmentTable").innerHTML = adjustmentTable(d.results || []);
      })
      .catch(function () {
        el("adjustmentTable").innerHTML = unavailableHtml("Adjustments are unavailable.");
      });
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
          H.fmtDate(b.submitted_at) + '</td><td data-label="">' + actions + "</td></tr>"
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
      .then(okJson)
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
        wrap.innerHTML = unavailableHtml("Flagged subscriptions are unavailable.");
      });
  }

  // ---- business supporters: fulfilment list + mark-done actions (TASK-208, over TASK-207's API) ----
  // Gated on business-supporters:edit since TASK-406, not donations:edit as it was before: the nav
  // link's data-edit-gate, matching authorizeSection("business-supporters","edit") on the server.
  // Admins hold it by role, anyone else only if granted it per person. Lists each business supporter's
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
  var fulfilOpenId = null;
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
    // TASK-491: due a thank you call. The server works this out (callDue), so the page only says it.
    if (r.callDue) out += '<span class="admin-pill is-call-due fx-call-pill">Time to call</span>';
    return out + rowNewPill("fulfilments", r.created_at);
  }

  // What the system does BY ITSELF the moment a business submits the form, and what a person still
  // has to do. Getting this wrong is worse than useless: the page used to present all five as jobs
  // waiting to be done, when three of them had already happened automatically minutes after the
  // business replied. Somebody could have sat there "sending" a badge that was already sent.
  //
  //   Listed on the supporters page - the public wall reads list_on_supporters + captured_at LIVE
  //     (resolvePublicSupporter). They appear the moment they submit. Nobody adds them.
  //   Badge + certificate link  - both are carried by the confirmation email the capture sends
  //     (buildCaptureConfirmationEmail, TASK-221), gated on the same perks as the on-page version.
  //
  // What is left is the work a machine genuinely cannot do: writing a social post, and putting a
  // printed certificate in an envelope.
  function fulfilAutomatic(r) {
    if (!r.captured_at) return [];
    var on = H.fmtDate(r.captured_at);
    var out = [];
    if (r.list_on_supporters) {
      out.push({
        label: "Listed on the supporters page",
        detail: "Live since " + on + ", the moment they submitted the form.",
      });
    }
    // TASK-441: the badge and certificate now go the next weekday morning as their own email, so
    // this reports when it ACTUALLY went rather than inferring it from the capture date. Older
    // records have no perks_sent_at, because they were sent the old way with their confirmation.
    if (r.want_badge || r.want_certificate) {
      var what = r.want_badge && r.want_certificate
        ? "Badge and certificate sent"
        : r.want_badge ? "Badge sent" : "Certificate sent";
      out.push({
        label: what,
        detail: r.perks_sent_at
          ? "Emailed to them on " + H.fmtDate(r.perks_sent_at) + "."
          : "Goes out automatically on the next weekday morning.",
        pending: !r.perks_sent_at,
      });
    }
    return out;
  }

  // The jobs a person still has to do. Only these.
  var FULFIL_TASKS = [
    { key: "social_done", label: "Social post done", needs: "want_social",
      help: "Write and post the thank-you. This is the one thing the system cannot do for you." },
    { key: "certificate_posted", label: "Certificate posted", needs: "want_certificate",
      help: "Put the printed certificate in the post. They asked for a posted one, not a download." }
  ];

  function fulfilTasksFor(r) {
    return FULFIL_TASKS.filter(function (t) {
      // A posted certificate is the only manual half of the certificate perk; a download went out
      // with their confirmation email and needs nobody.
      if (t.key === "certificate_posted") return !!r.want_certificate && r.certificate_delivery === "post";
      return t.needs ? !!r[t.needs] : true;
    });
  }

  function fulfilmentSummary(r) {
    if (!r.captured_at) {
      if (!r.invited_at) return '<span class="fx-state fx-state--todo">Invite not sent yet</span>';
      return '<span class="fx-state fx-state--waiting">Waiting for them to fill in the form</span>';
    }
    var tasks = fulfilTasksFor(r);
    var left = tasks.filter(function (t) { return !r[t.key]; }).length;
    if (!left) return '<span class="fx-state fx-state--done">All done</span>';
    return '<span class="fx-state fx-state--todo">' + left + (left === 1 ? " thing" : " things") + " to do</span>";
  }

  function fulfilRow(label, value) {
    if (!value) return "";
    return '<div class="fx-row"><dt>' + H.escapeHtml(label) + "</dt><dd>" + value + "</dd></div>";
  }
  function fulfilYesNo(v) {
    return v ? '<span class="fx-yes">Yes</span>' : '<span class="fx-no">No</span>';
  }

  // What the business actually told us on the thank-you form. Every one of these was already being
  // fetched and none of it was shown — including the postal address for a certificate they asked us
  // to POST, which made that job impossible to finish from the page that asks you to tick it off.
  function fulfilmentSubmission(r) {
    if (!r.captured_at) {
      return '<p class="fx-empty">They have not filled in the form yet, so we do not know how they would like ' +
        "to be thanked. " +
        (r.invited_at
          ? "Their invite was sent on " + H.fmtDate(r.invited_at) + "."
          : "They have not been sent their invite yet.") +
        "</p>";
    }
    var certificate = r.want_certificate
      ? (r.certificate_delivery === "post" ? "Yes — by post" : "Yes — to download")
      : fulfilYesNo(false);
    var rows =
      fulfilRow("Credit them as", r.credit_name ? H.escapeHtml(r.credit_name) : '<span class="fx-none">Not given</span>') +
      fulfilRow("List on the supporters page", fulfilYesNo(r.list_on_supporters)) +
      fulfilRow("Social media post", fulfilYesNo(r.want_social)) +
      fulfilRow("Supporter badge", fulfilYesNo(r.want_badge)) +
      fulfilRow("Certificate", certificate) +
      (r.want_certificate && r.certificate_delivery === "post"
        ? fulfilRow("Post the certificate to",
            r.certificate_address
              ? '<span class="fx-address">' + H.escapeHtml(r.certificate_address) + "</span>"
              : '<span class="fx-warn">No address given — ask them before posting</span>')
        : "") +
      fulfilRow("Website", r.website ? '<span class="fx-mono">' + H.escapeHtml(r.website) + "</span>" : "") +
      fulfilRow("Social accounts", r.socials ? '<span class="fx-mono">' + H.escapeHtml(r.socials) + "</span>" : "");
    // "Happy to be featured" is NOT shown, and is not a question anybody was asked: the server sets
    // consent_featured = listOnSupporters || wantSocial (src/routes/business.ts). Showing a derived
    // value beside the two answers it is derived FROM reads as a third, separate consent - which is
    // how it was read.
    return '<dl class="fx-dl">' + rows + "</dl>";
  }

  // What the system already did, so nobody goes looking for a job that does not exist.
  function fulfilmentAutomatic(r) {
    if (!r.captured_at) {
      return '<p class="fx-empty">Nothing happens automatically until they have filled in the form.</p>';
    }
    var items = fulfilAutomatic(r);
    if (!items.length) {
      return '<p class="fx-empty">They asked for none of the things that are sent automatically.</p>';
    }
    return (
      '<ul class="fx-auto">' +
      items
        .map(function (a) {
          return (
            '<li' + (a.pending ? ' class="is-pending"' : "") + '>' +
            '<span class="fx-auto-label">' + H.escapeHtml(a.label) + "</span>" +
            '<span class="fx-auto-detail">' + H.escapeHtml(a.detail) + "</span></li>"
          );
        })
        .join("") +
      "</ul>"
    );
  }

  // The jobs a PERSON still has to do. Only these - everything else already happened by itself.
  function fulfilmentTasks(r) {
    if (!r.captured_at) {
      return '<p class="fx-empty">Nothing to do until they have filled in the form and told us what they want.</p>';
    }
    var tasks = fulfilTasksFor(r);
    if (!tasks.length) {
      return '<p class="fx-empty">Nothing left for you to do. Everything they asked for is sent automatically.</p>';
    }
    var canWrite = canEdit("business-supporters");
    var items = tasks.map(function (t) {
      var done = !!r[t.key];
      var action = done
        ? '<span class="fx-task-done">Done</span>'
        : canWrite
          ? '<button class="admin-btn admin-btn--small" type="button" data-fulfil-id="' + r.id +
            '" data-fulfil-mark="' + t.key + '" data-fulfil-label="' + H.escapeHtml(t.label) +
            '">Mark done</button>'
          : '<span class="fx-task-todo">Not done</span>';
      return (
        '<li class="fx-task' + (done ? " is-done" : "") + '">' +
        '<span class="fx-task-text"><span class="fx-task-label">' + H.escapeHtml(t.label) + "</span>" +
        '<span class="fx-task-help">' + H.escapeHtml(t.help) + "</span></span>" +
        action + "</li>"
      );
    }).join("");
    return '<ul class="fx-tasks">' + items + "</ul>";
  }

  // The thank-you LETTER is a different thing from the invite, and it is written and sent on the
  // Thank you tab — which this page never said, so "Not yet" sat here with nothing you could do
  // about it and no clue where to go.
  function fulfilmentLetter(r) {
    if (r.thank_you_sent_at) {
      var who = r.thank_you_sent_by === "automatic"
        ? "sent automatically"
        : "sent by " + H.escapeHtml(r.thank_you_sent_by || "a volunteer");
      return '<p class="fx-letter"><span class="fx-state fx-state--done">Sent ' + H.fmtDate(r.thank_you_sent_at) +
        "</span> " + who + ".</p>";
    }
    // It sends ITSELF. The daily pass at 8am writes to any supporter who has filled in the form, or
    // who was invited a fortnight ago and never did. Calling that "not sent yet" made it read as a
    // job somebody had forgotten, which is how you end up with two letters to the same person.
    return (
      '<p class="fx-letter"><span class="fx-state fx-state--waiting">Goes out automatically</span></p>' +
      '<p class="fx-help">Nothing to do. The letter is written and sent by itself in the 8am run, once ' +
      "they have filled in the form, or a fortnight after their invite if they never do. " +
      'You can also write a personal one on the <button class="admin-link" type="button" ' +
      'data-goto-section="thank-you">Thank you</button> tab, but only one letter is ever sent, so ' +
      "doing that instead of waiting means yours is the one they get.</p>"
    );
  }

  function fulfilmentInvite(r) {
    if (r.captured_at) {
      return '<p class="fx-letter"><span class="fx-state fx-state--done">Form submitted ' +
        H.fmtDate(r.captured_at) + "</span> — they filled it in, so they plainly received their link.</p>";
    }
    if (r.invited_at) {
      return '<p class="fx-letter"><span class="fx-state fx-state--waiting">Invite sent ' +
        H.fmtDate(r.invited_at) + "</span> — waiting for them to fill in the form.</p>";
    }
    var canWrite = canEdit("business-supporters");
    return (
      '<p class="fx-letter"><span class="fx-state fx-state--todo">Not sent yet</span></p>' +
      '<p class="fx-help">This emails them a private link to a short form asking how they would like to be ' +
      "thanked — listing, badge, social post, certificate." +
      (canWrite
        ? ' <button class="admin-btn admin-btn--small" type="button" data-send-invite="' + r.id +
          '">Send the invite</button>'
        : "") +
      "</p>"
    );
  }

  // Who did what, and when. Every fulfilment write already appended an audit row; none of it was
  // ever shown, so "has somebody already posted that certificate?" had no answer on this page.
  function fulfilmentHistoryList(rows) {
    if (!rows.length) return '<p class="fx-empty">Nothing recorded yet.</p>';
    var LABELS = {
      "fulfilment.created": "Supporter record created",
      "fulfilment.send_invite": "Invite sent",
      "fulfilment.backfill_invites": "Invite sent (catch-up run)",
      "fulfilment.certificate_sent": "Certificate sent",
      "fulfilment.certificate_posted": "Certificate posted",
      "fulfilment.badge_sent": "Badge sent",
      "fulfilment.social_done": "Social post done",
      "fulfilment.added_to_supporters": "Added to the supporters list",
      "fulfilment.preferences": "They filled in the form",
      "fulfilment.called": "Called them"
    };
    return (
      '<ul class="fx-history-list">' +
      rows.map(function (a) {
        var what = LABELS[a.action] || a.action;
        var data = a.data || {};
        // TASK-491: a phone change says what it changed to, and where a copied number came from.
        if (a.action === "fulfilment.phone") {
          what = data.source === "outreach"
            ? "Phone number copied from Contact businesses"
            : data.phone ? "Phone number set to " + data.phone : "Phone number removed";
        }
        // Actors are stored as "admin:someone@example.com"; the system jobs as "script:<name>".
        var who = String(a.actor || "");
        who = who.indexOf("admin:") === 0 ? who.slice(6)
            : who.indexOf("script:") === 0 ? "an automatic job"
            : who || "unknown";
        var note = a.action === "fulfilment.called" && data.note
          ? '<span class="fx-hist-note">' + H.escapeHtml(data.note) + "</span>"
          : "";
        return '<li><span class="fx-hist-what">' + H.escapeHtml(what) + "</span>" +
          '<span class="fx-hist-who">' + H.fmtDate(a.created_at) + " · " + H.escapeHtml(who) + "</span>" +
          note + "</li>";
      }).join("") +
      "</ul>"
    );
  }

  function loadFulfilmentHistory(id) {
    var box = document.querySelector('[data-fulfil-history="' + id + '"]');
    if (!box) return;
    authFetch("/api/admin/fulfilments/" + encodeURIComponent(id) + "/history")
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (d) {
        var target = document.querySelector('[data-fulfil-history="' + id + '"]');
        if (!target) return;
        target.innerHTML = d
          ? fulfilmentHistoryList(d.results || [])
          : '<p class="fx-empty">Could not load the history.</p>';
      })
      .catch(function () {
        var target = document.querySelector('[data-fulfil-history="' + id + '"]');
        if (target) target.innerHTML = '<p class="fx-empty">Could not load the history.</p>';
      });
  }

  // ---- thank you calls (TASK-491) ----
  // Jaimie phones each business that gives monthly every three months while they are still giving,
  // to thank them and ask if there is anything we can do. The server decides who is due (callDue in
  // src/business/call-due.ts); this panel shows their number and the last call, and records the next.
  var callNotice = {}; // id -> { call?: message, phone?: message }, shown once after a save
  // id -> { note?, phone? }: what was typed but not saved in the OTHER box when one of them saved.
  // A save redraws the list, and without this it threw that text away (review of #614).
  var callDrafts = {};

  // Before a save redraws the panel, keep whatever is typed in the box that is not being saved.
  function keepUnsaved(id, saving) {
    var panel = document.querySelector('[data-call-panel="' + id + '"]');
    if (!panel) return;
    var draft = {};
    var note = panel.querySelector('textarea[name="note"]');
    var phone = panel.querySelector('input[name="phone"]');
    if (saving !== "note" && note && note.value) draft.note = note.value;
    if (saving !== "phone" && phone) draft.phone = phone.value;
    callDrafts[id] = draft;
  }

  // A number a phone can dial: digits and a leading +. "+44 (0)131" dials as +44131, so the (0) goes.
  function telHref(phone) {
    var s = String(phone || "").trim();
    if (s.charAt(0) === "+") s = s.replace(/\(0\)/g, "");
    return "tel:" + s.replace(/[^0-9+]/g, "");
  }

  function fulfilmentCallState(r) {
    if (!r.supporting) {
      return '<span class="fx-state fx-state--waiting">No calls needed</span> ' +
        (r.supporting_since
          ? "Their monthly gift has stopped, so there is no reminder to call."
          : "They have no paid monthly gift yet.");
    }
    if (r.callDue) {
      return '<span class="fx-state fx-state--todo">Time to call</span> ' +
        (r.callDueOn ? "Due since " + H.fmtDate(r.callDueOn) + "." : "");
    }
    return '<span class="fx-state fx-state--done">Next call due ' + H.fmtDate(r.callDueOn) + "</span>";
  }

  function fulfilmentCall(r) {
    var notice = callNotice[r.id] || {};
    var draft = callDrafts[r.id] || {};
    var phoneValue = draft.phone !== undefined ? draft.phone : r.phone || "";
    var phone = r.phone
      ? '<a class="fx-tel" href="' + H.escapeHtml(telHref(r.phone)) + '">' + H.escapeHtml(r.phone) + "</a>"
      : '<span class="fx-none">No phone number yet</span>';
    var last = r.last_called_at
      ? H.fmtDate(r.lastCalledOn || r.last_called_at) + (r.last_called_by ? " by " + H.escapeHtml(r.last_called_by) : "")
      : '<span class="fx-none">Not called yet</span>';
    var rows =
      fulfilRow("Phone", phone) +
      fulfilRow("Last called", last) +
      (r.last_called_at && r.last_call_note
        ? fulfilRow("Note from that call", '<span class="fx-address">' + H.escapeHtml(r.last_call_note) + "</span>")
        : "");
    var forms = "";
    if (canEdit("business-supporters")) {
      forms =
        '<div class="fx-call-forms">' +
          '<form class="fx-call-form" data-call-form="' + r.id + '" novalidate>' +
            '<label class="fx-call-label" for="fxNote' + r.id + '">Note about the call (optional)</label>' +
            '<textarea class="fx-call-input" id="fxNote' + r.id + '" name="note" rows="3" maxlength="500">' +
              H.escapeHtml(draft.note || "") + "</textarea>" +
            '<p class="fx-help">Up to 500 characters. Marking the call clears the reminder for 3 months.</p>' +
            '<div class="fx-call-row"><button class="admin-btn admin-btn--small" type="submit">Mark as called</button></div>' +
            '<p class="fx-call-status" data-call-status role="status" aria-live="polite">' +
              H.escapeHtml(notice.call || "") + "</p>" +
          "</form>" +
          '<form class="fx-call-form" data-phone-form="' + r.id + '" novalidate>' +
            '<label class="fx-call-label" for="fxPhone' + r.id + '">' +
              (r.phone ? "Change their number" : "Add their number") + "</label>" +
            '<div class="fx-call-row">' +
              '<input class="fx-call-input" id="fxPhone' + r.id + '" name="phone" type="tel" maxlength="40" ' +
                'autocomplete="off" value="' + H.escapeHtml(phoneValue) + '">' +
              '<button class="admin-btn admin-btn--small" type="submit">Save number</button>' +
            "</div>" +
            '<p class="fx-call-status" data-phone-status role="status" aria-live="polite">' +
              H.escapeHtml(notice.phone || "") + "</p>" +
          "</form>" +
        "</div>";
    }
    return (
      '<p class="fx-letter">' + fulfilmentCallState(r) + "</p>" +
      '<dl class="fx-dl">' + rows + "</dl>" +
      forms
    );
  }

  // The line above the list. null hides it: while the list has never loaded, or failed, it does not
  // know, and "No calls due" would be a guess dressed as a fact.
  function fulfilmentCallCount(rows) {
    var line = el("fulfilmentCallCount");
    if (!line) return;
    if (!rows) {
      line.hidden = true;
      line.textContent = "";
      return;
    }
    var n = rows.filter(function (r) { return r.callDue; }).length;
    line.textContent = n === 0 ? "No calls due"
      : n === 1 ? "1 business is due a call"
      : n + " businesses are due a call";
    line.classList.toggle("is-due", n > 0);
    line.hidden = false;
  }

  function callFormStatus(form, attr, msg, isError) {
    var s = form.querySelector("[" + attr + "]");
    if (!s) return;
    s.textContent = msg || "";
    s.classList.toggle("is-error", !!isError);
  }

  function markCalled(form) {
    var id = form.getAttribute("data-call-form");
    var box = form.querySelector('textarea[name="note"]');
    var note = box ? String(box.value || "").trim() : "";
    if (note.length > 500) {
      callFormStatus(form, "data-call-status", "A note can be up to 500 characters.", true);
      return;
    }
    var biz = document.querySelector(".fx-summary.is-open .admin-fulfil-biz");
    if (
      !window.confirm(
        "Record a call to " + (biz ? biz.textContent : "this business") + " today?\n\n" +
          "This is recorded against your name and clears the reminder for 3 months."
      )
    ) {
      return;
    }
    var btn = form.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;
    callFormStatus(form, "data-call-status", "Saving…", false);
    authFetch("/api/admin/fulfilments/" + encodeURIComponent(id) + "/calls", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(note ? { note: note } : {}),
    })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (out) {
        if (!out) throw new Error("not recorded");
        callNotice[id] = { call: "Call recorded against your name." };
        keepUnsaved(id, "note");
        loadFulfilments();
      })
      .catch(function () {
        if (btn) btn.disabled = false;
        callFormStatus(form, "data-call-status", "Could not record the call. Please try again.", true);
      });
  }

  function savePhone(form) {
    var id = form.getAttribute("data-phone-form");
    var input = form.querySelector('input[name="phone"]');
    var phone = input ? String(input.value || "") : "";
    var btn = form.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;
    callFormStatus(form, "data-phone-status", "Saving…", false);
    authFetch("/api/admin/fulfilments/" + encodeURIComponent(id) + "/phone", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: phone }),
    })
      .then(okJsonOrSaid)
      .then(function (out) {
        callNotice[id] = { phone: out && out.phone ? "Phone number saved." : "Phone number removed." };
        keepUnsaved(id, "phone");
        loadFulfilments();
      })
      .catch(function (err) {
        if (btn) btn.disabled = false;
        callFormStatus(
          form,
          "data-phone-status",
          (err && err.said) || "Could not save the number. Please try again.",
          true
        );
      });
  }

  function fulfilmentDetail(r) {
    return (
      '<div class="fx-detail">' +
        '<section class="fx-panel fx-panel--wide fx-call" data-call-panel="' + r.id + '">' +
          "<h4>Thank you call</h4>" + fulfilmentCall(r) + "</section>" +
        '<section class="fx-panel"><h4>Their invite</h4>' + fulfilmentInvite(r) + "</section>" +
        '<section class="fx-panel"><h4>Thank-you letter</h4>' + fulfilmentLetter(r) + "</section>" +
        '<section class="fx-panel"><h4>What they asked for</h4>' + fulfilmentSubmission(r) + "</section>" +
        '<section class="fx-panel"><h4>Already done for you</h4>' + fulfilmentAutomatic(r) + "</section>" +
        '<section class="fx-panel fx-panel--wide"><h4>What to do next</h4>' + fulfilmentTasks(r) + "</section>" +
        '<section class="fx-panel fx-panel--wide"><h4>History</h4>' +
          '<div class="fx-history" data-fulfil-history="' + r.id + '">' +
          '<p class="admin-loading">Loading…</p></div></section>' +
      "</div>"
    );
  }

  function fulfilmentsTable(rows) {
    if (!rows.length) return '<p class="admin-empty">No business supporters yet.</p>';
    var body = rows
      .map(function (r) {
        var open = fulfilOpenId === r.id;
        return (
          '<tr class="fx-summary' + (open ? " is-open" : "") + '" data-fulfil-toggle="' + r.id +
          '" tabindex="0" role="button" aria-expanded="' + (open ? "true" : "false") + '">' +
            '<td><span class="fx-caret" aria-hidden="true"></span>' +
            fulfilmentBusinessCell(r) + "</td>" +
            "<td>" + fulfilmentBandPill(r.band) + "</td>" +
            "<td>" + fulfilmentSummary(r) + "</td>" +
          "</tr>" +
          (open
            ? '<tr class="fx-detail-row"><td colspan="3">' + fulfilmentDetail(r) + "</td></tr>"
            : "")
        );
      })
      .join("");
    return (
      '<p class="fx-hint">Select a business to see what they asked for and what still needs doing.</p>' +
      '<table class="admin-table fx-table"><thead><tr><th>Business</th><th>Band</th>' +
      "<th>Where they are up to</th></tr></thead><tbody>" + body + "</tbody></table>"
    );
  }

  function toggleFulfilment(id) {
    var n = Number(id);
    fulfilOpenId = fulfilOpenId === n ? null : n;
    callNotice = {};
    callDrafts = {};
    fulfilmentStatus("");
    loadFulfilments();
  }

  function loadFulfilments() {
    var wrap = el("fulfilmentsTable");
    if (!wrap) return;
    wrap.innerHTML = '<p class="admin-loading">Loading…</p>';
    authFetch("/api/admin/fulfilments")
      .then(okJson)
      .then(function (d) {
        wrap.innerHTML = fulfilmentsTable(d.results || []);
        // A note put back after a save is sized to its words, so it never scrolls inside its box.
        nlFitBoxes(Array.prototype.slice.call(wrap.querySelectorAll("textarea.fx-call-input")));
        fulfilmentCallCount(d.results || []);
        // A save's message has now been shown once, in the panel it belongs to.
        callNotice = {};
        callDrafts = {};
        // The open row renders a placeholder for its history; fill it in.
        if (fulfilOpenId != null) loadFulfilmentHistory(fulfilOpenId);
      })
      .catch(function () {
        fulfilmentCallCount(null);
        wrap.innerHTML = '<p class="admin-empty">Business supporters are unavailable.</p>';
      });
  }
  function markFulfilment(id, flag, label, business) {
    if (
      !window.confirm(
        'Mark "' + (label || flag) + '" as done for ' + (business || "this supporter") + "?\n\n" +
          "This is recorded against your name and cannot be undone."
      )
    ) {
      return;
    }
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
        if (out) {
          fulfilmentStatus("Marked done, and recorded against your name.");
          loadFulfilments();
        } else {
          fulfilmentStatus("Could not update that supporter. Please try again.");
        }
      })
      .catch(function () {
        fulfilmentStatus("Could not update that supporter. Please try again.");
      });
  }
  // ---- monthly givers (TASK-447) ----
  // The people giving every month. Businesses have had a screen since TASK-208; these donors had
  // nothing, and were findable only by paging the whole donations list - which is how three of them
  // went four months without a thank-you and nobody noticed.
  var monthlyRows = null; // null until a list has loaded: no list is not the same as nobody giving

  // What is actually wrong, in the order it matters. A cancellation is settled and needs nothing; a
  // failing card is money leaving this month and is the reason to open this screen at all.
  function monthlyState(r) {
    if (r.state === "cancelled") return { label: "Cancelled", cls: "fx-state--waiting", attention: false };
    if (r.state === "lapsed") return { label: "Lapsed", cls: "fx-state--todo", attention: true };
    if (r.state === "past_due") {
      return {
        label: r.failedAttempts ? "Payment failing (" + r.failedAttempts + ")" : "Payment failing",
        cls: "fx-state--todo",
        attention: true,
      };
    }
    // No dunning row: an older or hand-imported supporter. Not a problem, and saying "unknown"
    // would send somebody looking for a fault that is not there.
    if (r.state === "unknown") return { label: "Giving", cls: "fx-state--done", attention: false };
    return { label: "Giving", cls: "fx-state--done", attention: false };
  }

  var monthlyGiving = function (r) {
    return r.state === "active" || r.state === "unknown";
  };

  function monthlyTable(rows) {
    if (!rows.length) return '<p class="admin-empty">Nobody matches that.</p>';
    var body = rows
      .map(function (r) {
        var st = monthlyState(r);
        // Gift Aid on a regular gift is worth 25% a month, for ever. It earns a column of its own
        // rather than a tick lost among the rest.
        var ga = r.giftAid
          ? '<span class="fx-yes">Yes</span>'
          : '<span class="fx-state fx-state--todo">No</span>';
        var thanked = r.thankedAt
          ? H.fmtDate(r.thankedAt)
          : '<span class="fx-state fx-state--todo">Not yet</span>';
        return (
          '<tr><td data-label="Name">' + H.escapeHtml(r.fullName) +
          '<span class="admin-sub">' + H.escapeHtml(r.email || "No email") + "</span>" +
          '</td><td data-label="Monthly">' + H.formatPence(r.monthlyPence) +
          '</td><td data-label="Since">' + H.fmtDate(r.firstPaidAt) + rowNewPill("monthly", r.firstPaidAt) +
          '</td><td data-label="Given so far">' + H.formatPence(r.totalPence) +
          '<span class="admin-sub">' + r.paymentCount + (r.paymentCount === 1 ? " payment" : " payments") + "</span>" +
          '</td><td data-label="Gift Aid">' + ga +
          '</td><td data-label="Thanked">' + thanked +
          '</td><td data-label="State"><span class="fx-state ' + st.cls + '">' + H.escapeHtml(st.label) + "</span>" +
          '</td><td data-label=""><button class="admin-link" type="button" data-donor="' + r.donorId + '">View</button></td></tr>'
        );
      })
      .join("");
    return (
      '<table class="admin-table monthly-table"><thead><tr><th>Name</th><th>Monthly</th><th>Since</th>' +
      "<th>Given so far</th><th>Gift Aid</th><th>Thanked</th><th>State</th><th></th>" +
      "</tr></thead><tbody>" + body + "</tbody></table>"
    );
  }

  function renderMonthly() {
    // "Show" can be changed when no list ever came (TASK-458). Counting nothing would put "0 giving,
    // £0 a month" back over the message saying the list is unavailable.
    if (!monthlyRows) return;
    var filter = el("monthlyStateFilter");
    var want = filter ? filter.value : "giving";
    var rows = monthlyRows.filter(function (r) {
      if (want === "giving") return monthlyGiving(r);
      if (want === "attention") return monthlyState(r).attention;
      return true;
    });
    el("monthlyTable").innerHTML = monthlyTable(rows);

    // The figure worth knowing: what is coming in every month from the people still giving. Taken
    // from the rows that are actually giving, never from the filtered view - a total that changed
    // when you changed a filter would be a number nobody could trust.
    var giving = monthlyRows.filter(monthlyGiving);
    var perMonth = giving.reduce(function (sum, r) { return sum + r.monthlyPence; }, 0);
    var needing = monthlyRows.filter(function (r) { return monthlyState(r).attention; }).length;
    var noGiftAid = giving.filter(function (r) { return !r.giftAid; }).length;
    el("monthlySummary").textContent =
      giving.length + " giving, " + H.formatPence(perMonth) + " a month" +
      (needing ? " · " + needing + " needing attention" : "") +
      (noGiftAid ? " · " + noGiftAid + " without Gift Aid" : "");
  }

  function loadMonthly() {
    var wrap = el("monthlyTable");
    if (!wrap) return;
    wrap.innerHTML = '<p class="admin-loading">Loading…</p>';
    authFetch("/api/admin/monthly-supporters")
      .then(function (res) {
        // A failure still answers in JSON, an { error } with no results. Read as a list, it showed
        // nobody giving and £0 a month on the screen whose job is to say what income is dependable.
        if (!res.ok) throw new Error("status " + res.status);
        return res.json();
      })
      .then(function (d) {
        monthlyRows = d.results || [];
        renderMonthly();
      })
      .catch(function () {
        // Whatever loaded before is not what is there now: nothing of it stays up to be taken as
        // current, or comes back when "Show" is changed.
        monthlyRows = null;
        el("monthlySummary").textContent = "";
        wrap.innerHTML = '<p class="admin-empty">Monthly givers are unavailable.</p>';
      });
  }
  var monthlyFilter = el("monthlyStateFilter");
  if (monthlyFilter) monthlyFilter.addEventListener("change", renderMonthly);

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

  // ---- send ONE supporter their invite (TASK-431) ----
  // Same endpoint shape as the backfill, scoped to one record. The server re-checks that they are
  // actually un-invited, so a double-click reports "already invited" rather than emailing twice.
  function sendSingleInvite(id) {
    if (!id) return;
    backfillStatus("Sending…");
    authFetch("/api/admin/business-supporters/" + encodeURIComponent(id) + "/send-invite", { method: "POST" })
      .then(function (res) {
        return res.ok ? res.json() : null;
      })
      .then(function (out) {
        if (!out) backfillStatus("Could not send that invite. Please try again.");
        else if (out.alreadyInvited) backfillStatus("That supporter had already been sent their invite.");
        else if (out.sent) backfillStatus("Invite sent.");
        else backfillStatus("The invite could not be delivered. Please try again.");
        loadFulfilments();
      })
      .catch(function () {
        backfillStatus("Could not send that invite. Please try again.");
      });
  }

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
  // TASK-560: one listener on the list's box, which stays while the table inside it is drawn again
  // on every load. A tick saves at once and the row stays where it is, so the next story does not
  // move under the pointer and the tick can come straight back off.
  if (el("storiesTable")) {
    el("storiesTable").addEventListener("change", function (e) {
      var box = e.target;
      if (box && box.hasAttribute && box.hasAttribute("data-story-read")) setStoryRead(box);
    });
  }
  var storiesSaving = {}; // story id -> true while its read or new is on its way to the server
  var STORY_NOT_SAVED = "Could not save. Please try again.";
  var STORY_GONE = "This story is no longer here.";
  var STORY_NOT_YOURS = "You can no longer change stories.";
  // The one request behind the list's tick and the open story's button: make this story `want`,
  // but only while it is still `was`, which is what the screen showed. A screen left open cannot
  // then undo what somebody else did in the meantime (Withdrawn above all: it records that consent
  // was taken back). Answers what to show: the server's word for what the story is now (status)
  // when it gave one; a sentence for the three answers that need one (note); whether the story can
  // no longer be changed from here (lock); or simply that it was not saved (unsaved), which the
  // person can put right by pressing again. Null when the session has ended, and the sign in
  // screen is already up.
  function saveStoryRead(id, want, was) {
    storiesSaving[id] = true;
    return authFetch("/api/admin/stories/" + id, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: want, ifStatus: was }),
    })
      .then(function (res) {
        if (res.ok) {
          return res.json().then(function (story) {
            return { status: story.status, note: "" };
          });
        }
        if (res.status === 409) {
          return res.json().then(function (b) {
            var now = b && b.story && b.story.status;
            if (!now) return { unsaved: true };
            // Somebody else got there first. If they made it what was asked for, there is nothing to say.
            if (now === want) return { status: now, note: "" };
            return { status: now, note: "Someone else changed this story. It is now " + H.storyLabel("status", now) + "." };
          });
        }
        if (res.status === 404) return { note: STORY_GONE, lock: STORY_GONE };
        if (res.status === 403) return { note: STORY_NOT_YOURS, lock: STORY_NOT_YOURS };
        return { unsaved: true };
      })
      .catch(function (err) {
        return err && err.message === "unauthorized" ? null : { unsaved: true };
      })
      .then(function (out) {
        delete storiesSaving[id];
        return out;
      });
  }
  function setStoryRead(box) {
    var id = box.getAttribute("data-story-read");
    // A second press while the first is on its way is put back, not sent: the first answer decides
    // what the row shows. The box is never disabled for the wait, which would drop the keyboard's
    // place in the list.
    if (storiesSaving[id]) {
      box.checked = !box.checked;
      return;
    }
    var want = box.checked ? "reviewed" : "new";
    var was = want === "reviewed" ? "new" : "reviewed";
    box.setAttribute("aria-busy", "true");
    storyRowShows(id, {}); // a new try: whatever the last one left in the row is cleared
    saveStoryRead(id, want, was).then(function (out) {
      box.removeAttribute("aria-busy");
      if (!out) return;
      // A list drawn again since the press already shows what the story is. "Not saved" belongs to
      // the list that was pressed, which is gone.
      if (out.unsaved && !box.isConnected) return;
      // No word on what the story is now, so the box that was pressed goes back to what it showed.
      if (!out.status && box.isConnected) box.checked = storyIsRead(was);
      storyRowShows(id, out);
    });
  }
  // What this story's row shows now, found by the story's id at the moment of asking: an answer
  // that arrives after the list was drawn again lands on the row that is on screen, or nowhere.
  function storyRowShows(id, out) {
    var boxes = doc.querySelectorAll("#storiesTable [data-story-read]");
    var box = null;
    for (var i = 0; i < boxes.length; i++) if (boxes[i].getAttribute("data-story-read") === String(id)) box = boxes[i];
    if (!box) return;
    var row = box.closest("tr");
    var label = box.closest("label");
    var pill = row.querySelector("[data-story-status]");
    if (out.status) {
      box.checked = storyIsRead(out.status);
      pill.textContent = H.storyLabel("status", out.status);
    }
    var why = out.lock || (out.status ? storyTickLocked(out.status) : "");
    if (why && !box.disabled) {
      // A locked box cannot hold the keyboard, so it is handed to the row's View, not dropped.
      var view = row.querySelector("[data-story]");
      if (doc.activeElement === box && view) view.focus({ preventScroll: true });
      box.disabled = true;
      label.classList.add("is-locked");
      label.title = box.title = why;
    }
    // A save that failed is two words in a pill, in the status pill's place for as long as it
    // stands, so the row keeps its height and no row beneath it moves under the next press.
    row.querySelector("[data-story-unsaved]").hidden = !out.unsaved;
    pill.hidden = !!out.unsaved;
    row.querySelector("[data-story-note]").textContent = out.note || "";
  }
  function scopeConsentBadges(r) {
    var scopeClass = r.use_scope === "public" ? "is-public" : "is-internal";
    var badges = '<span class="admin-pill ' + scopeClass + '">' + H.escapeHtml(H.storyLabel("useScope", r.use_scope)) + "</span>";
    if (r.consent_share_first_name) badges += ' <span class="admin-pill">First name</span>';
    if (r.consent_share_town) badges += ' <span class="admin-pill">Town</span>';
    if (r.third_party_consent) badges += ' <span class="admin-pill">3rd-party OK</span>';
    return badges;
  }
  // TASK-560: "read" is the status that already says so. New is unread. Reviewed is read and can be
  // unticked. Used and Withdrawn say more than read, so their tick is locked: a stray click must
  // never undo them. The attribute is data-story-read, never data-story, which opens the story.
  function storyIsRead(status) {
    return status !== "new";
  }
  // Why a story's tick cannot be pressed. Empty when it can. On the label for whoever hovers over
  // it, and on the box, where a screen reader reads it as the box's description.
  function storyTickLocked(status) {
    if (!canEdit("stories")) return "You can view stories but not change them.";
    if (status === "used") return "Used stories count as read.";
    if (status === "withdrawn") return "Withdrawn stories count as read.";
    return "";
  }
  function storyReadTick(r) {
    var why = storyTickLocked(r.status);
    var title = why ? ' title="' + H.escapeHtml(why) + '"' : "";
    return (
      '<label class="admin-read-tick' + (why ? " is-locked" : "") + '"' + title + ">" +
      '<input type="checkbox" data-story-read="' + r.id + '"' +
      (storyIsRead(r.status) ? " checked" : "") + (why ? " disabled" : "") + title +
      ' aria-label="Story ' + r.id + ' read" /></label>'
    );
  }
  function storiesTable(rows) {
    if (!rows.length) return '<p class="admin-empty">No stories yet.</p>';
    // Beside each status, hidden until it is needed, the pill that takes its place when a save
    // fails: "Not saved" to the eye, the whole of it to a screen reader, the sentence on hover.
    // Under it, room for the three answers that need a sentence (somebody else changed the story,
    // it has been erased, this person may no longer change stories). All in the story's own row,
    // beside the tick that was pressed however long the list is.
    var body = rows
      .map(function (r) {
        return (
          "<tr><td>" + storyReadTick(r) + "</td><td>" + r.id + "</td><td>" +
          H.escapeHtml(H.storyLabel("submitterRole", r.submitter_role)) +
          "</td><td>" + scopeConsentBadges(r) + '</td><td><span class="admin-pill" data-story-status>' +
          H.escapeHtml(H.storyLabel("status", r.status)) + "</span>" +
          '<span class="admin-pill admin-read-unsaved" data-story-unsaved hidden title="' + STORY_NOT_SAVED + '">' +
          '<span class="sr-only">Story ' + r.id + ": </span>Not saved" +
          '<span class="sr-only">. Please try again.</span></span>' +
          '<span class="admin-read-note" data-story-note></span></td><td>' +
          H.escapeHtml(H.consentAge(r.consent_captured_at)) + "</td><td>" + H.fmtDate(r.created_at) +
          '</td><td><button class="admin-link" type="button" data-story="' + r.id + '">View</button></td></tr>'
        );
      })
      .join("");
    return (
      '<table class="admin-table stories-table"><thead><tr><th>Read</th><th>ID</th><th>Role</th><th>Scope / consent</th>' +
      "<th>Status</th><th>Consent age</th><th>Submitted</th><th></th></tr></thead><tbody>" +
      body + "</tbody></table>"
    );
  }
  function loadStories() {
    var imp = el("storiesImport");
    if (imp) imp.hidden = !canEdit("stories");
    var wrap = el("storiesTable");
    wrap.innerHTML = '<p class="admin-loading">Loading…</p>';
    // TASK-311: two independent filters - where a story is in the workflow, and whether it is
    // archived. Both travel to the API; the server decides what each view means.
    var query = [];
    if (storiesStatusFilter) query.push("status=" + encodeURIComponent(storiesStatusFilter));
    if (storiesArchiveView) query.push("view=" + encodeURIComponent(storiesArchiveView));
    var path = "/api/admin/stories" + (query.length ? "?" + query.join("&") : "");
    authFetch(path)
      .then(okJson)
      .then(function (d) {
        wrap.innerHTML = storiesTable(d.results || []);
      })
      .catch(function () {
        wrap.innerHTML = unavailableHtml("Stories are unavailable.");
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
      .then(okJson)
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

  // ---- stories from the old website, from its CSV export (TASK-461) ----
  // Editors only (the server checks too). Choosing the file saves nothing: what would be added comes
  // first, and only "Add" writes. "Add" always sends the text that produced the list on screen, and a
  // slower reply for a file chosen earlier is ignored. A file that is not valid UTF-8 (one saved from
  // Excel, say) is read as Windows-1252 instead, rather than garbling people's names.
  var STORIES_IMPORT_MAX_BYTES = 2 * 1024 * 1024;
  var storiesImportSeq = 0;
  function storiesImportSay(msg) {
    var s = el("storiesImportStatus");
    if (s) s.textContent = msg || "";
  }
  // Clears the list and whatever the page still holds from the file, and outdates any reply on its way.
  function storiesImportReset(msg) {
    storiesImportSeq++;
    var plan = el("storiesImportPlan");
    if (plan) plan.innerHTML = "";
    storiesImportSay(msg);
  }
  function storiesImportPost(csv, commit) {
    return authFetch("/api/admin/stories/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(commit ? { csv: csv, commit: true } : { csv: csv }),
    }).then(function (res) {
      return res
        .json()
        .catch(function () {
          return {};
        })
        .then(function (b) {
          if (!res.ok) throw new Error(b.error || "That file could not be read. Nothing was saved.");
          return b;
        });
    });
  }
  function storiesImportWho(item) {
    return (
      "<b>" + H.escapeHtml(item.firstName || "No name given") + "</b>" +
      (item.town ? ", " + H.escapeHtml(item.town) : "") +
      (item.sentOn ? ' <span class="admin-muted">sent ' + H.escapeHtml(item.sentOn) + "</span>" : "")
    );
  }
  function storiesImportPills(a) {
    var pills =
      '<span class="admin-pill ' + (a.scope === "public" ? "is-public" : "is-internal") + '">' +
      H.escapeHtml(H.storyLabel("useScope", a.scope)) + "</span>";
    if (a.shareFirstName) pills += ' <span class="admin-pill">First name</span>';
    if (a.shareTown) pills += ' <span class="admin-pill">Town</span>';
    if (a.contact) pills += ' <span class="admin-pill">Happy to be contacted</span>';
    return pills;
  }
  function renderStoriesImportPlan(p, csv) {
    var adding = p.adding || [];
    var skipping = p.skipping || [];
    var html = adding.length
      ? '<h3 class="admin-subhead">' + (adding.length === 1 ? "1 story to add" : adding.length + " stories to add") + "</h3>" +
        '<ul class="admin-import-list">' +
        adding
          .map(function (a) {
            return (
              '<li><p class="admin-import-who">' + storiesImportWho(a) + "</p>" +
              '<p class="admin-import-opening">' + H.escapeHtml(a.opening) + "</p>" +
              '<p class="admin-import-pills">' + storiesImportPills(a) + "</p></li>"
            );
          })
          .join("") +
        "</ul>"
      : '<p class="admin-empty">Nothing new to add from this file.</p>';
    if (skipping.length) {
      html +=
        '<h3 class="admin-subhead">Not added</h3><ul class="admin-import-list">' +
        skipping
          .map(function (s) {
            return (
              '<li><p class="admin-import-who">' + storiesImportWho(s) + "</p>" +
              '<p class="admin-import-reason">' + H.escapeHtml(s.reason) + "</p></li>"
            );
          })
          .join("") +
        "</ul>";
    }
    if (adding.length) {
      html +=
        '<button class="btn btn-primary" type="button" id="storiesImportGo">' +
        (adding.length === 1 ? "Add this story" : "Add these " + adding.length + " stories") + "</button>";
    }
    el("storiesImportPlan").innerHTML = html;
    var go = el("storiesImportGo");
    if (go) {
      go.addEventListener("click", function () {
        addStoriesFromOldSite(csv);
      });
    }
  }
  function storiesImportText(file) {
    return file.arrayBuffer().then(function (buf) {
      try {
        return new TextDecoder("utf-8", { fatal: true }).decode(buf);
      } catch (e) {
        return new TextDecoder("windows-1252").decode(buf);
      }
    });
  }
  // Signed out (authFetch has already gone back to the sign-in screen): nothing from the file stays.
  function storiesImportFailed(err) {
    if (err && err.message === "unauthorized") storiesImportReset("");
    else storiesImportSay(err ? err.message : "");
  }
  function readStoriesImportFile() {
    var input = el("storiesImportFile");
    var file = input && input.files && input.files[0];
    storiesImportReset("");
    var seq = storiesImportSeq;
    if (!file) return;
    if (file.size > STORIES_IMPORT_MAX_BYTES) {
      storiesImportSay("That file is too big for this. The old form's export is far smaller, so please check it's the right file.");
      return;
    }
    storiesImportSay("Reading the file…");
    var csv = null;
    storiesImportText(file)
      .then(function (text) {
        csv = text;
        return seq === storiesImportSeq ? storiesImportPost(csv, false) : null;
      })
      .then(function (p) {
        if (!p || seq !== storiesImportSeq) return;
        storiesImportSay("");
        renderStoriesImportPlan(p, csv);
      })
      .catch(function (err) {
        if (seq === storiesImportSeq) storiesImportFailed(err);
      });
  }
  function addStoriesFromOldSite(csv) {
    var go = el("storiesImportGo");
    if (go) go.disabled = true;
    storiesImportSay("Adding…");
    storiesImportPost(csv, true)
      .then(function (p) {
        var n = p.added || 0;
        storiesImportReset(
          n === 0
            ? "Nothing was added: those stories are already here."
            : n === 1
              ? "Added 1 story. It's in the list below as New."
              : "Added " + n + " stories. They're in the list below as New.",
        );
        el("storiesImportFile").value = "";
        loadStories();
      })
      .catch(function (err) {
        if (go) go.disabled = false;
        storiesImportFailed(err);
      });
  }
  if (el("storiesImportFile")) el("storiesImportFile").addEventListener("change", readStoriesImportFile);

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
        return okJson(res);
      })
      .then(renderStory)
      .catch(function (err) {
        // TASK-476: a failure is not a record with nothing in it. "Not found" has said so already.
        if (err && err.message === "not found") return;
        wrap.innerHTML = unavailableHtml("Could not load this story. Please try again.");
      });
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
      // Named, so Mark as read can change this line without drawing the story again.
      '<dt>Status</dt><dd id="storyStatusNow">' + H.escapeHtml(H.storyLabel("status", s.status)) + "</dd>" +
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
    // TASK-560: where reading ends, under the story's words. Its own box, so pressing its button
    // draws this box again and nothing else: see showStoryReadBar.
    var readBar = canWrite ? '<div id="storyReadBar"></div>' : "";
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
    el("storyDetail").innerHTML = info + readBar + actions;
    if (canWrite) {
      showStoryReadBar(s, "");
      wireStoryActions(s);
    }
  }
  // TASK-560: Mark as read while the story is New, and the way back while it is Reviewed. Used and
  // Withdrawn say more than read, so they get no button. The admin's small button and its text
  // link: Save changes, below, stays the one loud button. Under them, room for what could not be
  // saved, right where the button was pressed and not at the foot of the page past the whole form.
  // No button either once the story can no longer be changed from here (gone): it has been erased,
  // or this person may no longer change stories, and pressing again could only say so again.
  function showStoryReadBar(s, note, gone) {
    var bar = el("storyReadBar");
    if (!bar) return;
    var controls = "";
    if (!gone && s.status === "new") {
      controls = '<p class="admin-read-bar"><button class="admin-btn" type="button" id="storyReadBtn">Mark as read</button></p>';
    } else if (!gone && s.status === "reviewed") {
      controls =
        '<p class="admin-read-bar"><span class="admin-read-done">Marked as read.</span> ' +
        '<button class="admin-link" type="button" id="storyUnreadBtn">Mark as new</button></p>';
    }
    bar.innerHTML = controls + '<p class="admin-read-note" id="storyReadNote" tabindex="-1">' + H.escapeHtml(note || "") + "</p>";
    bindClick("storyReadBtn", function () { markStoryRead(s, "reviewed"); });
    bindClick("storyUnreadBtn", function () { markStoryRead(s, "new"); });
  }
  // The same request as the list's tick. Only what the status changes is drawn again (the Status
  // line, this bar, and the form's Status when it had not been touched), so anything typed in Tags
  // or Notes and not yet saved stays exactly as it was, with the cursor where it was.
  function markStoryRead(s, want) {
    var id = s.id;
    if (storiesSaving[id]) return; // a double press sends one request
    var btn = el("storyReadBtn") || el("storyUnreadBtn");
    btn.setAttribute("aria-busy", "true");
    el("storyReadNote").textContent = "";
    saveStoryRead(id, want, s.status).then(function (out) {
      btn.removeAttribute("aria-busy");
      // Not this story's answer any more: a different story has been opened since.
      if (!out || String(currentStoryId) !== String(id) || !el("storyReadBar")) return;
      // Not saved, and it can be tried again: say so under the button, which stays. Here there is
      // room for the whole sentence, and nothing under the pointer moves when it appears.
      if (out.unsaved) {
        el("storyReadNote").textContent = STORY_NOT_SAVED;
        return;
      }
      if (out.status) {
        var now = el("storyStatusNow");
        if (now) now.textContent = H.storyLabel("status", out.status);
        // Save changes sends the form's Status too. Left on the old one it would quietly put the
        // story back the next time a note was saved; one the person picked themselves is theirs.
        var pick = el("edit-storyStatus");
        if (pick && pick.value === s.status) pick.value = out.status;
      }
      // The button that was pressed is about to go. The keyboard follows to what takes its place,
      // or to the words that say why there is nothing; never when the person has moved on to type.
      // Without scrolling: someone who has wheeled down to the form is not pulled back up.
      var active = doc.activeElement;
      var elsewhere = active && active !== doc.body && !el("storyReadBar").contains(active);
      showStoryReadBar(Object.assign({}, s, { status: out.status || s.status }), out.note, !!out.lock);
      if (!elsewhere) (el("storyUnreadBtn") || el("storyReadBtn") || el("storyReadNote")).focus({ preventScroll: true });
    });
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
  // TASK-425: the status pill, with who replied and when beneath it. replied_summary arrives
  // already formatted from the server, and is null whenever there is nothing honest to say.
  // Putting it in the existing cell rather than a new column keeps the table within the width
  // that TASK-422 fixed for phones.
  function contactStatusCell(r) {
    var badge = contactStatusBadge(r.status);
    if (!r.replied_summary) return badge;
    return badge + '<span class="admin-replied-by">' + H.escapeHtml(r.replied_summary) + "</span>";
  }

  function contactTable(rows) {
    if (!rows.length) return '<p class="admin-empty">No enquiries yet.</p>';
    var body = rows
      .map(function (r) {
        return (
          "<tr><td>" + window.formatReceived(r.created_at) + "</td><td>" +
          H.escapeHtml(((r.first_name || "") + " " + (r.last_name || "")).trim()) + "</td><td>" +
          H.escapeHtml(r.email) + "</td><td>" + contactStatusCell(r) + "</td><td>" +
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
      .then(okJson)
      .then(function (d) {
        wrap.innerHTML = contactTable(d.results || []);
      })
      .catch(function () {
        wrap.innerHTML = unavailableHtml("Enquiries are unavailable.");
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
        return okJson(res);
      })
      .then(renderContact)
      .catch(function (err) {
        // TASK-476: a failure is not a record with nothing in it. "Not found" has said so already.
        if (err && err.message === "not found") return;
        wrap.innerHTML = unavailableHtml("Could not load this enquiry. Please try again.");
      });
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
          refreshEnquiryNotice(); // one fewer waiting, or one more if it was un-marked
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
      .then(okJson)
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
        wrap.innerHTML = unavailableHtml("The audit log is unavailable.");
      });
  }

  // ---- email audit (email-audit feature) ----
  // Every email the system attempted to send, with its outcome and the mailbox side's verdict.
  // Reads GET /api/admin/email-log (email-audit:view on the server); recent failures ride the
  // same response and render as a red band above the list. Filters submit on Apply (not on each
  // keystroke) so the page makes one request per deliberate search.
  var EMAIL_KINDS = [
    ["donation", "Donation confirmation"], ["receipt", "Company receipt"], ["refund", "Refund confirmation"],
    ["declaration", "Gift Aid declaration"], ["portal", "Portal link"], ["adminInvite", "Admin invite"],
    ["adminReset", "Password reset"], ["loginCode", "Sign-in code"], ["lapsedDonor", "Lapsed (donor)"],
    ["lapsedAdmin", "Lapsed (admin)"], ["newsletter", "Newsletter"], ["thankYou", "Thank-you letter"],
    ["businessInvite", "Business invite"], ["businessCapture", "Business confirmation"],
    ["businessReminder", "Business reminder"], ["ballConfirmation", "Ball confirmation"],
    ["ballReminder", "Ball reminder"], ["ballRunUp", "Ball run-up"], ["ballReport", "Ball ticket report"],
    // TASK-487: every kind the server sends has a name here (test/unit/admin-email-kinds.test.ts).
    ["ballTransfer", "Ball bank transfer"], ["ballTransferStaff", "Ball bank transfer (to events@)"],
    ["outreach", "Business outreach"], ["backupAlert", "Backup alert"],
    // TASK-493: community fundraising.
    ["fundraiseThanks", "Fundraiser sign up thanks"], ["fundraiseStaff", "Fundraiser sign up (to events@)"],
    ["fundraiseApproved", "Fundraiser approved"], ["fundraiseManage", "Fundraiser manage link"],
    // TASK-497: a change the organiser asked for, approved or rejected by staff.
    ["fundraiseEditApproved", "Fundraiser update live"], ["fundraiseEditRejected", "Fundraiser update held back"],
    // TASK-501: the private area's sign in code, and "I've finished" to events@.
    ["fundraiseCode", "Fundraiser sign in code"], ["fundraiseFinishedStaff", "Fundraiser finished (to events@)"],
    // TASK-503: the invite staff send, and the Monday summary.
    ["fundraiseInvite", "Fundraising invite"], ["fundraiseSummary", "Fundraising Monday summary"],
    // TASK-506: a news update the organiser posted, approved or not used by staff.
    ["fundraiseNewsApproved", "Fundraiser news update live"], ["fundraiseNewsRejected", "Fundraiser news update not used"],
    // TASK-507: an organiser's thank you, passed on to a giver once staff have checked it.
    ["fundraiseSupporterThanks", "Fundraiser thank you to a supporter"],
    // The sign up tidy: the in memory receipt, and asking for a T-shirt size.
    ["fundraiseMemoryReceipt", "In memory sign up received"],
    ["fundraiseTshirtAsk", "Fundraiser T-shirt size asked for"],
    // TASK-515: the automatic emails to an organiser.
    ["fundraiseFirstGift", "Fundraiser automatic: first gift"], ["fundraiseHalfway", "Fundraiser automatic: halfway"],
    ["fundraiseTargetReached", "Fundraiser automatic: target reached"], ["fundraiseWeekBefore", "Fundraiser automatic: a week before"],
    ["fundraiseWeekAfter", "Fundraiser automatic: a week after"], ["fundraiseFinished", "Fundraiser automatic: thank you, finished"],
    ["fundraiseYearOn", "Fundraiser automatic: a year on"], ["fundraiseNeedAHand", "Fundraiser automatic: need a hand?"],
    ["fundraiseOnTrack", "Fundraiser automatic: doing great"],
    // Team pages: the team emails.
    ["fundraiseTeamLive", "Team page live (to the team organiser)"], ["fundraiseTeamInvite", "Team invite"],
    ["fundraiseTeamInviteReminder", "Team invite reminder"], ["fundraiseTeamNudge", "Team automatic: did you send the invite?"],
    ["fundraiseTeamJoined", "Team member joined (thank you)"], ["fundraiseTeamJoinStaff", "Team member to approve (to events@)"],
    ["fundraiseTeamMemberRemoved", "Team member taken off (to events@)"], ["fundraiseTeamHandoverCode", "Team organiser handover code"],
    ["fundraiseTeamMemberJoined", "Team member approved (to the team organiser)"],
    // Event tickets: the buyer's tickets and refund, and the two to events@.
    ["eventTickets", "Event tickets (to the buyer)"], ["eventTicketsRefund", "Event tickets refund (to the buyer)"],
    ["eventTicketsRefundAsked", "Event tickets refund asked for (to events@)"], ["eventTicketsToApprove", "Event tickets to approve (to events@)"],
    ["eventTicketsToCheck", "Event tickets booking to check (to events@)"],
    ["eventTicketsCancelled", "Event tickets free booking cancelled (to the buyer)"],
    // Sponsor pledges: the pay link and its one reminder, to a sponsor.
    ["fundraisePledgeConfirm", "Sponsor pledge: please confirm"], ["fundraisePledgePay", "Sponsor pledge: link to pay"],
    ["fundraisePledgeReminder", "Sponsor pledge: reminder"], ["fundraisePledgeStaff", "Sponsor pledge: note to events@"],
  ];
  function emailKindLabel(kind) {
    for (var i = 0; i < EMAIL_KINDS.length; i++) if (EMAIL_KINDS[i][0] === kind) return EMAIL_KINDS[i][1];
    return kind;
  }
  var EMAIL_AUDIT_PAGE = 50;
  var emailAuditOffset = 0;
  var emailAuditShownOffset = 0; // the page the pager last showed, to go back to if a page fails
  var emailAuditWired = false;
  function emailStatusPill(r) {
    // OUR attempt failing outranks everything; then the mailbox verdict; then plain Sent.
    if (r.status === "failed") return '<span class="ty-pill ty-pill-blocked">Failed</span>';
    if (r.deliveryStatus === "bounced") return '<span class="ty-pill ty-pill-blocked">Bounced</span>';
    if (r.deliveryStatus === "complained") return '<span class="ty-pill ty-pill-blocked">Marked as spam</span>';
    if (r.deliveryStatus === "delivered") return '<span class="ty-pill ty-pill-ready">Delivered</span>';
    return '<span class="ty-pill">Sent</span>';
  }
  function emailAuditRow(r) {
    var who = H.escapeHtml(r.recipient) + (r.recipientName ? "<br><small>" + H.escapeHtml(r.recipientName) + "</small>" : "");
    var detail = r.error || r.deliveryDetail;
    var status = emailStatusPill(r) + (detail ? "<br><small>" + H.escapeHtml(String(detail)) + "</small>" : "");
    // TASK-NNN: nothing leaves this list. A problem staff removed from the red band says so here,
    // with who and when, and the way to undo it for someone who may edit.
    if (r.removedAt) {
      status +=
        "<br><small>" +
        H.escapeHtml((r.removedKind === "stop" ? "Removed, emails stopped, by " : "Tidied away by ") + (r.removedBy || "staff") + " on " + H.fmtDate(r.removedAt)) +
        "</small>" +
        (canEdit("email-audit")
          ? ' <button class="admin-link" type="button" data-audit-putback="' + H.escapeHtml(r.recipient) + '">Put back</button>'
          : "");
    }
    return (
      "<tr><td>" + H.fmtDate(r.createdAt) + "</td><td>" + H.escapeHtml(emailKindLabel(r.kind)) +
      "</td><td>" + who + "</td><td>" + H.escapeHtml(r.subject) + "</td><td>" + status + "</td></tr>"
    );
  }
  // TASK-NNN: the red band, one block an address. What staff decide here is about an address (is
  // it dead?), not about one email, so its problems are listed under it and it is dealt with once:
  // "Remove and stop emails" (its problems leave the band and the address is blocked) or "Just tidy
  // away" (they leave the band and nothing else changes). One of the charity's own addresses can
  // only be tidied: blocking events@ would stop the charity's own notes to itself. The server
  // refuses that too. Blocks, not a table, so the band wraps to fit a phone.
  function emailIsCharitys(email) {
    return /@([a-z0-9-]+\.)*nbcc\.scot$/i.test(String(email || "").trim());
  }
  function emailFailBandHtml(failures) {
    if (!failures.length) return "";
    var canWrite = canEdit("email-audit");
    var groups = [];
    var at = {};
    failures.forEach(function (r) {
      if (!Object.prototype.hasOwnProperty.call(at, r.recipient)) {
        at[r.recipient] = groups.length;
        groups.push({ email: r.recipient, name: r.recipientName, rows: [] });
      }
      groups[at[r.recipient]].rows.push(r);
    });
    var items = groups
      .map(function (g) {
        var email = H.escapeHtml(g.email);
        var own = emailIsCharitys(g.email);
        var actions = "";
        if (canWrite) {
          actions =
            '<p class="email-fail-actions">' +
            (own ? "" : '<button class="admin-btn" type="button" data-audit-stop="' + email + '">Remove and stop emails</button>') +
            '<button class="admin-link" type="button" data-audit-tidy="' + email + '">' + (own ? "Tidy away" : "Just tidy away") + "</button></p>";
        }
        var problems = g.rows
          .map(function (r) {
            var detail = r.error || r.deliveryDetail;
            return (
              "<li>" + emailStatusPill(r) + " " + H.escapeHtml(emailKindLabel(r.kind)) + ": " + H.escapeHtml(r.subject) +
              ", " + H.fmtDate(r.createdAt) + (detail ? "<small>" + H.escapeHtml(String(detail)) + "</small>" : "") + "</li>"
            );
          })
          .join("");
        return (
          '<li class="email-fail-item" data-audit-address="' + email + '"><div class="email-fail-who">' +
          '<p class="email-fail-address">' + email + (g.name ? " <small>" + H.escapeHtml(g.name) + "</small>" : "") + "</p>" +
          actions + "</div>" +
          (own ? '<p class="email-fail-own">One of the charity\'s own addresses, so it is never blocked.</p>' : "") +
          '<ul class="email-fail-problems">' + problems + "</ul></li>"
        );
      })
      .join("");
    return (
      '<div class="email-fail-band"><h3>Needs a look: ' + failures.length + " problem" + (failures.length === 1 ? "" : "s") +
      ' in the last 14 days</h3><ul class="email-fail-list">' + items + "</ul></div>"
    );
  }
  // What was just done, said on one line above the band, with Put back beside it when the thing
  // done can be undone. The line is in the page from the start and keeps its room when empty
  // (.ty-status), so its words do not push the band down under the pointer.
  function emailAuditSay(text, cls, undoEmail) {
    var line = el("emailAuditSaid");
    if (!line) return;
    line.className = "ty-status" + (cls ? " " + cls : "");
    line.textContent = text || "";
    if (undoEmail) {
      var undo = doc.createElement("button");
      undo.type = "button";
      undo.className = "admin-link";
      undo.setAttribute("data-audit-putback", undoEmail);
      undo.textContent = "Put back";
      line.appendChild(doc.createTextNode(" "));
      line.appendChild(undo);
    }
  }
  var emailAuditSaving = false;
  // One press at a time: until the answer is in and the list drawn again, a second press (a double
  // click, or the next address, which is about to move up under the pointer) does nothing.
  function emailAuditPost(path, body, done) {
    if (emailAuditSaving) return;
    emailAuditSaving = true;
    var view = el("view-email-audit");
    view.setAttribute("aria-busy", "true");
    authFetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then(okJson)
      .then(function (d) {
        done(d);
        // The button that was pressed goes with the list. The keyboard goes to the line that says
        // what happened, which has Put back in it, without moving the page.
        el("emailAuditSaid").focus({ preventScroll: true });
        return loadEmailAudit(true);
      })
      .catch(function (err) {
        if (err && err.message === "unauthorized") return;
        emailAuditSay("Could not do that. Please try again.", "is-error");
      })
      .then(function () {
        emailAuditSaving = false;
        view.removeAttribute("aria-busy");
      });
  }
  function emailAuditRemove(email, stop, problems) {
    if (stop) {
      var asked = window.confirm(
        "Stop emailing " + email + "?\n\nNewsletters and fundraising emails will no longer go to this address. " +
          "Receipts, booking confirmations and sign in codes still will.\n\nIts " + problems + " problem" +
          (problems === 1 ? " leaves" : "s leave") + " this list. You can put it back from the full list below.",
      );
      if (!asked) return;
    }
    emailAuditPost("/api/admin/email-log/remove", { email: email, stop: stop }, function (d) {
      var words = !stop
        ? "Tidied away " + email + "."
        : d.blockedNow
          ? "Removed " + email + " and stopped emails to it."
          : "Removed " + email + ". Emails to it were already stopped.";
      emailAuditSay(words, "is-ok", email);
    });
  }
  function emailAuditPutBack(email) {
    emailAuditPost("/api/admin/email-log/put-back", { email: email }, function (d) {
      var words = "Put back " + email + ".";
      if (d.unblocked) words += " Emails to it are no longer stopped.";
      else if (d.stillBlocked) {
        words += " It is still blocked, because its mail bounced or it marked us as spam. To unblock it, go to Newsletter, Blocked addresses.";
      }
      emailAuditSay(words, "is-ok");
    });
  }
  function emailAuditTableHtml(rows) {
    return (
      '<table class="admin-table email-audit-table"><thead><tr><th>When</th><th>Type</th><th>To</th><th>Subject</th><th>Status</th></tr></thead><tbody>' +
      rows.map(emailAuditRow).join("") + "</tbody></table>"
    );
  }
  function wireEmailAudit() {
    if (emailAuditWired) return;
    emailAuditWired = true;
    var type = el("emailAuditType");
    if (type) {
      EMAIL_KINDS.forEach(function (k) {
        var o = doc.createElement("option");
        o.value = k[0];
        o.textContent = k[1];
        type.appendChild(o);
      });
    }
    var form = el("emailAuditFilters");
    if (form) form.addEventListener("submit", function (e) {
      e.preventDefault();
      emailAuditOffset = 0;
      loadEmailAudit();
    });
    bindClick("emailAuditClear", function () {
      el("emailAuditSearch").value = "";
      el("emailAuditType").value = "";
      el("emailAuditStatus").value = "";
      emailAuditOffset = 0;
      loadEmailAudit();
    });
    bindClick("emailAuditPrev", function () {
      emailAuditOffset = Math.max(0, emailAuditOffset - EMAIL_AUDIT_PAGE);
      loadEmailAudit();
    });
    bindClick("emailAuditNext", function () {
      emailAuditOffset += EMAIL_AUDIT_PAGE;
      loadEmailAudit();
    });
    // TASK-NNN: one listener for the band's two controls and every Put back, on the screen's own
    // box, which stays while the band and the list inside it are drawn again.
    el("view-email-audit").addEventListener("click", function (e) {
      var t = e.target && e.target.closest && e.target.closest("[data-audit-stop],[data-audit-tidy],[data-audit-putback]");
      if (!t) return;
      if (t.hasAttribute("data-audit-putback")) return emailAuditPutBack(t.getAttribute("data-audit-putback"));
      var stop = t.hasAttribute("data-audit-stop");
      var block = t.closest(".email-fail-item");
      emailAuditRemove(
        t.getAttribute(stop ? "data-audit-stop" : "data-audit-tidy"),
        stop,
        block ? block.querySelectorAll(".email-fail-problems > li").length : 0,
      );
    });
  }
  // keepSaid: the list is being drawn again because of a press here, so the line that says what
  // that press did stays. Any other load (opening the screen, a filter, a page) clears it.
  function loadEmailAudit(keepSaid) {
    wireEmailAudit();
    if (!keepSaid) emailAuditSay("");
    var wrap = el("emailAuditTable");
    var band = el("emailAuditFailures");
    wrap.innerHTML = '<p class="admin-loading">Loading…</p>';
    var params = "?limit=" + EMAIL_AUDIT_PAGE + "&offset=" + emailAuditOffset;
    var q = (el("emailAuditSearch").value || "").trim();
    var type = el("emailAuditType").value;
    var status = el("emailAuditStatus").value;
    if (q) params += "&q=" + encodeURIComponent(q);
    if (type) params += "&type=" + encodeURIComponent(type);
    if (status) params += "&status=" + encodeURIComponent(status);
    return authFetch("/api/admin/email-log" + params)
      .then(okJson)
      .then(function (d) {
        band.innerHTML = emailFailBandHtml(d.failures || []);
        var rows = d.results || [];
        wrap.innerHTML = rows.length
          ? emailAuditTableHtml(rows)
          : '<p class="admin-empty">' + (emailAuditOffset ? "No more entries." : "No emails recorded yet. The log starts from when this page was added.") + "</p>";
        var total = d.total || 0;
        var pager = el("emailAuditPager");
        pager.hidden = total <= EMAIL_AUDIT_PAGE;
        el("emailAuditPageInfo").textContent =
          total ? (emailAuditOffset + 1) + "–" + Math.min(emailAuditOffset + EMAIL_AUDIT_PAGE, total) + " of " + total : "";
        el("emailAuditPrev").disabled = emailAuditOffset === 0;
        el("emailAuditNext").disabled = emailAuditOffset + EMAIL_AUDIT_PAGE >= total;
        emailAuditShownOffset = emailAuditOffset;
      })
      .catch(function () {
        band.innerHTML = "";
        wrap.innerHTML = unavailableHtml("The email log is unavailable.");
        // The pager stays as it was, and so does its place: Newer and Older try that page again.
        emailAuditOffset = emailAuditShownOffset;
      });
  }

  // ---- site pages (site-pages feature) ----
  // Spare addresses (alias -> 301) and per-page search-engine visibility. Reads
  // GET /api/admin/site-pages; writes need site:edit - the controls are hidden for read-only
  // users here, and the server enforces regardless.
  var siteWired = false;
  function siteStatus(msg, cls) {
    var s = el("siteStatus");
    if (!s) return;
    s.className = "ty-status" + (cls ? " " + cls : "");
    s.textContent = msg || "";
  }
  function renderSiteAliases(aliases, canWrite) {
    var wrap = el("siteAliasTable");
    if (!aliases.length) {
      wrap.innerHTML = '<p class="admin-empty">No spare addresses yet.</p>';
      return;
    }
    var body = aliases
      .map(function (a) {
        var remove = canWrite
          ? '<button class="admin-link" type="button" data-site-alias-remove="' + a.id + '">Remove</button>'
          : "";
        return (
          "<tr><td>" + H.escapeHtml(a.fromPath) + "</td><td>" + H.escapeHtml(a.toPath) +
          "</td><td>" + H.escapeHtml(a.createdBy) + "</td><td>" + remove + "</td></tr>"
        );
      })
      .join("");
    wrap.innerHTML =
      '<table class="admin-table"><thead><tr><th>Spare address</th><th>Sends people to</th><th>Added by</th><th></th></tr></thead><tbody>' +
      body + "</tbody></table>";
    if (canWrite) {
      Array.prototype.forEach.call(wrap.querySelectorAll("[data-site-alias-remove]"), function (b) {
        b.addEventListener("click", function () {
          authFetch("/api/admin/site-aliases/" + b.getAttribute("data-site-alias-remove"), { method: "DELETE" })
            .then(function (res) {
              if (!res.ok) throw new Error();
              siteStatus("Spare address removed.", "ok");
              loadSite();
            })
            .catch(function () { siteStatus("Could not remove that address.", "err"); });
        });
      });
    }
  }
  // The whole website in one list (TASK-402). Two sources, on purpose: the public registry that
  // feeds /sitemap and sitemap.xml, and the private pages that must never appear in either. The
  // job here is memory, not navigation - a page nobody has opened in a year is still somebody's
  // to keep current, and you cannot keep current what you cannot see.
  var SITE_REACH = {
    "link-only": { label: "Personal link only", why: "Reached from a link we send. Not browsable." },
    unlisted: { label: "Not listed", why: "A real page, but nothing links to it." },
    staff: { label: "Staff only", why: "Behind a password and a code." },
  };
  function renderSiteAll(pages, privatePages) {
    var wrap = el("siteAllTable");
    if (!wrap) return;
    var rows = (pages || []).map(function (p) {
      var reach = p.listed ? "On the site map" : "Not listed";
      var why = p.ballGated
        ? "Hidden everywhere until the ball is published."
        : p.listed ? "Anyone can find this page." : "A real page, but nothing links to it.";
      return { title: p.title, path: p.path, reach: reach, why: why };
    });
    (privatePages || []).forEach(function (p) {
      var kind = SITE_REACH[p.reach] || { label: p.reach, why: "" };
      rows.push({ title: p.title, path: p.path, reach: kind.label, why: p.note || kind.why });
    });
    wrap.innerHTML =
      '<table class="admin-table"><thead><tr><th>Page</th><th>Address</th><th>Who can reach it</th>' +
      "<th>What it is</th></tr></thead><tbody>" +
      rows
        .map(function (r) {
          // The address is a real link: the quickest way to check a page is still right is to look.
          return "<tr><td>" + H.escapeHtml(r.title) + '</td><td><a href="' + H.escapeHtml(r.path) +
            '" target="_blank" rel="noopener">' + H.escapeHtml(r.path) + "</a></td><td>" +
            H.escapeHtml(r.reach) + "</td><td>" + H.escapeHtml(r.why) + "</td></tr>";
        })
        .join("") +
      "</tbody></table>";
  }

  function renderSiteSeo(pages, canWrite) {
    var wrap = el("siteSeoTable");
    var body = pages
      .map(function (p) {
        var note = p.ballGated ? " <small>(only while the ball is published)</small>" : "";
        var control = canWrite
          ? '<input type="checkbox" data-site-seo="' + H.escapeHtml(p.path) + '"' + (p.listed ? " checked" : "") +
            ' aria-label="Show ' + H.escapeHtml(p.title) + ' to search engines" />'
          : p.listed ? "Shown" : "Hidden";
        return (
          "<tr><td>" + H.escapeHtml(p.title) + note + "</td><td>" + H.escapeHtml(p.path) +
          "</td><td>" + control + "</td></tr>"
        );
      })
      .join("");
    wrap.innerHTML =
      '<table class="admin-table"><thead><tr><th>Page</th><th>Address</th><th>Show to search engines</th></tr></thead><tbody>' +
      body + "</tbody></table>";
    if (canWrite) {
      Array.prototype.forEach.call(wrap.querySelectorAll("[data-site-seo]"), function (box) {
        box.addEventListener("change", function () {
          authFetch("/api/admin/site-seo", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: box.getAttribute("data-site-seo"), listed: box.checked }),
          })
            .then(function (res) {
              if (!res.ok) throw new Error();
              siteStatus("Saved.", "ok");
            })
            .catch(function () {
              box.checked = !box.checked;
              siteStatus("Could not save that change.", "err");
            });
        });
      });
    }
  }
  function wireSite() {
    if (siteWired) return;
    siteWired = true;
    var form = el("siteAliasForm");
    if (form) form.addEventListener("submit", function (e) {
      e.preventDefault();
      siteStatus("");
      authFetch("/api/admin/site-aliases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: el("siteAliasFrom").value.trim(), to: el("siteAliasTo").value }),
      })
        .then(function (res) {
          return res.json().then(function (b) { return { ok: res.ok, body: b }; });
        })
        .then(function (r) {
          if (!r.ok) { siteStatus(r.body.error || "Could not add that address.", "err"); return; }
          el("siteAliasFrom").value = "";
          siteStatus("Spare address added. It works right away.", "ok");
          loadSite();
        })
        .catch(function () { siteStatus("Could not add that address.", "err"); });
    });
  }
  // ---- QR codes (TASK-492) ----
  // A code for every page, from GET /api/admin/qr-codes (site: view), which sends each page's code
  // as an SVG for its preview. The downloads come from /api/admin/qr-codes/image, fetched with the
  // session and handed to the browser to save, as the Festive Ball's CSVs are.
  var QR_BAD_PATH = "Give an address on nbcc.scot, starting with /";
  // The same rule as qrPath in src/site/qr.ts, so a bad address is refused before asking.
  var QR_PATH = /^\/(?:[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\/?)?$/;
  var qrWired = false;

  // "/ball/terms" as "ball-terms", "/" as "home": the name of the file, as the server names it.
  function qrSlug(path) {
    return path.replace(/^\/+|\/+$/g, "").replace(/\//g, "-").toLowerCase() || "home";
  }

  function qrCard(page) {
    var esc = H.escapeHtml;
    var src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(page.svg);
    return (
      '<article class="qr-card">' +
      '<img class="qr-img" src="' + src + '" alt="QR code for ' + esc(page.title) + '" width="132" height="132" />' +
      '<div class="qr-body">' +
      '<h3 class="qr-title">' + esc(page.title) + "</h3>" +
      '<p class="qr-path">nbcc.scot' + esc(page.path) + "</p>" +
      (page.live ? "" : '<p class="qr-note">Not live yet: the page is switched off for now.</p>') +
      '<p class="qr-actions">' +
      '<button type="button" class="admin-btn admin-btn--small" data-qr-path="' + esc(page.path) + '" data-qr-format="svg">Download SVG</button>' +
      '<button type="button" class="admin-btn admin-btn--small" data-qr-path="' + esc(page.path) + '" data-qr-format="png">Download PNG</button>' +
      "</p></div></article>"
    );
  }

  function qrImageUrl(path, format) {
    return "/api/admin/qr-codes/image?path=" + encodeURIComponent(path) + "&format=" + format;
  }

  function qrDownload(path, format) {
    authFetch(qrImageUrl(path, format))
      .then(function (r) { return r.ok ? r.blob() : Promise.reject(new Error("failed")); })
      .then(function (blob) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = "nbcc-qr-" + qrSlug(path) + "." + format;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      })
      .catch(function (err) {
        if (err && err.message === "unauthorized") return;
        window.alert("Could not download that QR code. Try again.");
      });
  }

  function wireQr() {
    if (qrWired) return;
    qrWired = true;
    // Delegated, and attached once: the list is drawn again on every visit.
    el("view-qr").addEventListener("click", function (e) {
      var btn = e.target.closest && e.target.closest("[data-qr-format]");
      if (!btn) return;
      qrDownload(btn.getAttribute("data-qr-path"), btn.getAttribute("data-qr-format"));
    });
    el("qrOtherForm").addEventListener("submit", function (e) {
      e.preventDefault();
      // A whole nbcc.scot address pasted from the browser becomes its path.
      var typed = (el("qrOtherPath").value || "").trim();
      var path = typed.replace(/^(https?:\/\/)?(www\.)?nbcc\.scot(?=\/|$)/i, "");
      if (typed && !path) path = "/"; // "nbcc.scot" alone is the home page; an empty box stays empty
      el("qrOther").innerHTML = "";
      if (!QR_PATH.test(path) || path.length > 200) {
        el("qrStatus").textContent = QR_BAD_PATH;
        return;
      }
      el("qrStatus").textContent = "Making the code…";
      authFetch(qrImageUrl(path, "svg"))
        .then(okJsonOrSaidText)
        .then(function (svg) {
          el("qrStatus").textContent = "";
          el("qrOther").innerHTML = qrCard({ path: path, title: "Another address", live: true, svg: svg });
        })
        .catch(function (err) {
          if (err && err.message === "unauthorized") return;
          el("qrStatus").textContent = (err && err.said) || "Could not make that QR code. Try again.";
        });
    });
  }

  // The SVG's text, or the server's own reason when it refuses.
  function okJsonOrSaidText(res) {
    if (res.ok) return res.text();
    return res.json().then(
      function (b) {
        var err = new Error("status " + res.status);
        err.said = b && typeof b.error === "string" ? b.error : "";
        throw err;
      },
      function () { throw new Error("status " + res.status); },
    );
  }

  function loadQr() {
    wireQr();
    authFetch("/api/admin/qr-codes")
      .then(okJson)
      .then(function (d) {
        var pages = d.pages || [];
        el("qrList").innerHTML = pages.length
          ? pages.map(qrCard).join("")
          : '<p class="admin-empty">There are no pages to make codes for.</p>';
      })
      .catch(function () {
        el("qrList").innerHTML = unavailableHtml("The QR codes could not load.");
      });
  }

  function loadSite() {
    wireSite();
    var canWrite = canEdit("site");
    el("siteAliasForm").hidden = !canWrite;
    authFetch("/api/admin/site-pages")
      .then(okJson)
      .then(function (d) {
        var sel = el("siteAliasTo");
        sel.innerHTML = (d.pages || [])
          .map(function (p) {
            return '<option value="' + H.escapeHtml(p.path) + '">' + H.escapeHtml(p.title) + " (" + H.escapeHtml(p.path) + ")</option>";
          })
          .join("");
        renderSiteAll(d.pages || [], d.privatePages || []);
        renderSiteAliases(d.aliases || [], canWrite);
        renderSiteSeo(d.pages || [], canWrite);
      })
      .catch(function () {
        el("siteAliasTable").innerHTML = unavailableHtml("Site pages are unavailable.");
        el("siteSeoTable").innerHTML = "";
        el("siteAllTable").innerHTML = "";
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
      .then(okJson)
      .then(function (d) {
        teamRows = d.results || [];
        el("teamTable").innerHTML = teamTable(teamRows, canWrite);
      })
      .catch(function () {
        teamRows = []; // as before a failure was caught: nothing left over to edit access against
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
    if (!btn) return cap(section);
    // Without its New pill (TASK-478), which is not part of the section's name.
    var copy = btn.cloneNode(true);
    var pillIn = copy.querySelector(".admin-new-pill");
    if (pillIn) pillIn.remove();
    return copy.textContent.trim();
  }
  // A copy of perms naming every section, "none" wherever perms is silent. The permissions PATCH takes
  // only a complete matrix, and the editor role's defaults, like a map saved before a section existed,
  // leave some out, so whatever fills the matrix goes through here (TASK-462: the Editor preset did
  // not, and could never be saved).
  function completePermissions(perms) {
    var full = Object.assign({}, perms);
    SECTIONS.forEach(function (s) {
      if (!full[s]) full[s] = "none";
    });
    return full;
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
    teamPermWorking = completePermissions(effectiveTeamPermissions(u));
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
        teamPermWorking = completePermissions(rolePresetPermissions(presetBtn.getAttribute("data-perm-preset")));
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
    nlFitAllBoxes(); // TASK-477: a draft opens with every prose box already tall enough for its words
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
    nlFitBox(input); // the markers can push the words onto another line
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

  // TASK-469: a paste into a prose box keeps the basics (paragraphs, line breaks, bold and italic),
  // written as the markers the B and I buttons write, so the preview and the email show them.
  // paste-prose.js does the converting and is unit-tested on its own; this reads the clipboard and
  // inserts the result where the author's cursor is. Without the converter, or with nothing to insert,
  // the browser's own paste goes ahead.
  function nlPasteProse(e, input) {
    var P = window.PasteProse;
    var clip = e.clipboardData;
    if (!P || !clip) return;
    var html = clip.getData("text/html");
    var text;
    if (html) text = P.htmlToProse(new DOMParser().parseFromString(html, "text/html").body);
    else {
      // Words moved within a box arrive as plain text. The line breaks at their ends are part of what
      // was copied, so they go back on after the Markdown tidy; and if the tidy changed nothing, the
      // browser's own paste is exactly right.
      var plain = clip.getData("text/plain").replace(/\r\n?/g, "\n");
      var body = P.markdownToProse(plain);
      if (body === plain) return;
      text = body ? /^\n*/.exec(plain)[0] + body + /\n*$/.exec(plain)[0] : "";
    }
    if (!text) return;
    e.preventDefault();
    // execCommand keeps Ctrl+Z working and fires "input", which saves the block and refreshes the
    // preview exactly as typing does. Chrome would fold the paste into the words typed just before it,
    // so one Ctrl+Z took both: setting the selection afresh first makes the paste its own undo step, as
    // an ordinary paste is (checked in headless Chrome). Where execCommand is unavailable, insert and
    // announce by hand.
    var start = input.selectionStart;
    var end = input.selectionEnd;
    input.setSelectionRange(0, 0);
    input.setSelectionRange(start, end);
    var inserted = false;
    try {
      inserted = typeof doc.execCommand === "function" && doc.execCommand("insertText", false, text);
    } catch (err) {
      inserted = false;
    }
    if (!inserted) {
      input.setRangeText(text, input.selectionStart, input.selectionEnd, "end");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  // TASK-477: a prose box grows to fit its words, so it never scrolls inside itself; the page grows
  // instead. Called on every edit (typing, a paste, Ctrl+Z all fire "input"), after the canvas is drawn
  // (so a saved draft opens at full height) and when the canvas changes width (words re-wrap). The
  // height is reset to "auto" first so the box can shrink as well as grow; its rows are the minimum.
  // A box not on screen (a folded block, a hidden panel) measures 0 and is left alone until it shows.
  // The height a box at "auto" needs for its words, or 0 when it is not on screen. Reads only.
  function nlBoxHeight(box) {
    var h = box.scrollHeight;
    if (!h) return 0;
    var cs = window.getComputedStyle(box);
    if (cs.boxSizing === "border-box") h += (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
    else h -= (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    return h;
  }
  // Every box is set to "auto" first, then all are measured, then all are sized: one layout for the
  // whole canvas however many boxes it has, rather than one per box.
  function nlFitBoxes(boxes) {
    boxes = boxes.filter(function (b) {
      return b && b.isConnected;
    });
    if (!boxes.length) return;
    var y = window.pageYOffset;
    boxes.forEach(function (b) {
      b.style.height = "auto";
    });
    var heights = boxes.map(nlBoxHeight);
    boxes.forEach(function (b, i) {
      b.style.height = heights[i] ? heights[i] + "px" : "";
    });
    // The moment at "auto" can shorten the page and nudge the scroll position; put it back.
    if (window.pageYOffset !== y && typeof window.scrollTo === "function") window.scrollTo(window.pageXOffset, y);
  }
  function nlFitBox(box) {
    nlFitBoxes([box]);
  }
  function nlFitAllBoxes() {
    var host = el("nlCanvas");
    if (host) nlFitBoxes(Array.prototype.slice.call(host.querySelectorAll("textarea")));
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
    else {
      input.addEventListener("input", function () {
        obj[key] = input.value;
        if (opts.multiline) nlFitBox(input);
        nlSchedulePreview();
      });
      // TASK-469: a prose box keeps what matters from a paste; a one-line box pastes plain text.
      // The legacy raw-HTML box (opts.raw) holds HTML source, not prose, so its paste stays the browser's.
      if (opts.multiline && !opts.raw) input.addEventListener("paste", function (e) { nlPasteProse(e, input); });
    }
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
      nlText(host, block.data, "html", "HTML", { multiline: true, raw: true });
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
  // TASK-477: a narrower or wider canvas re-wraps the words, so the prose boxes fit again. The window
  // resizing is the usual cause; the observer also catches the canvas changing width on its own (the
  // panel appearing, the layout switching at a breakpoint). Only a change of width refits, so the
  // boxes growing (which changes the canvas height) does not set it off again.
  // The observer alone covers a window resize; the resize event is only for a browser without one.
  if (el("nlCanvas") && typeof window.ResizeObserver === "function") {
    var nlCanvasWidth = 0;
    new window.ResizeObserver(function (entries) {
      var w = Math.round(entries[0].contentRect.width);
      if (w === nlCanvasWidth) return;
      nlCanvasWidth = w;
      nlFitAllBoxes();
    }).observe(el("nlCanvas"));
  } else {
    window.addEventListener("resize", nlFitAllBoxes);
  }
  // The web font arriving re-wraps the words without changing the canvas width, so fit again then:
  // with no inner scrolling, a box sized before the font could otherwise hide its last line.
  if (doc.fonts && doc.fonts.ready && typeof doc.fonts.ready.then === "function") doc.fonts.ready.then(nlFitAllBoxes);

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
    // Same for the prose boxes (TASK-477): drawn while the panel was hidden, they measured nothing.
    if (panelId === "nlPanelWrite") nlFitAllBoxes();
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
      .then(okJson)
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
          'checks</b><span>The checks could not run. Look over it yourself before sending.</span></div></li>';
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
      .then(okJson)
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
      .then(okJson)
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
      .catch(function () {
        // TASK-476: a failure used to be read as the newsletter, filling the editor with
        // "undefined". Leave the editor as it was and say the newsletter did not open.
        el("newsletterMsg").textContent = "Could not open that newsletter. Please try again.";
      });
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
      .then(okJson)
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
      .catch(function () {
        // TASK-476: say so where you land and in the history, rather than showing nothing at all
        // (or, from an earlier visit, figures that are no longer current).
        var msg = unavailableHtml("Newsletters are unavailable.");
        el("newsletterList").innerHTML = msg;
        if (el("nlRecentSends")) el("nlRecentSends").innerHTML = msg;
        if (el("nlOverviewTiles")) el("nlOverviewTiles").innerHTML = "";
        if (NL_COMPOSE_PANELS.indexOf(nlLivePanel()) === -1) nlShowPanel("nlPanelOverview");
      });
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
      .then(okJson)
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
      .then(okJson)
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
      .then(okJson)
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
      .catch(function () {
        // A convenience panel, so it never blocks the tab. But "nothing blocked" would be a claim
        // (TASK-476): unknown instead, which the Overview's Blocked tile already shows as unknown.
        nlBlockedCount = null;
        host.innerHTML = unavailableHtml("Blocked addresses are unavailable.");
      });
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
    var howLabel = { footer: "Signed up on the website", import: "Imported", admin: "Added by staff", fundraise: "Signed up while fundraising" };
    var selfSignup = function (m) { return m.consentSource === "footer" || m.consentSource === "fundraise"; };
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
        : selfSignup(m) ? "themselves" : "not recorded";
      var how = [H.escapeHtml(howLabel[m.consentSource] || m.consentSource), "by " + by].join(" · ");
      html +=
        '<tr><td><span class="nl-person-nm">' + (H.escapeHtml(m.name || "") || '<span class="admin-muted">No name</span>') +
        '</span><span class="nl-meta">' + contact + "</span></td>" +
        '<td><span class="nl-person-nm">' + (m.consentedAt ? H.fmtDate(m.consentedAt) : "-") +
        rowNewPill("newsletter", selfSignup(m) ? m.consentedAt : null) +
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
      .then(okJson)
      .then(function (rows) { nlRenderAudienceMembers(Array.isArray(rows) ? rows : []); })
      .catch(function () {
        // The card is a convenience and never blocks the tab, but it must not say nobody is on
        // the audience when nobody knows (TASK-476).
        var host = el("audienceMembers");
        if (host) host.innerHTML = unavailableHtml("Could not load who is on this audience.");
      });
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
      .then(okJson)
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
      .catch(function (err) {
        if (err && err.message === "unauthorized") return; // already back at the sign-in screen
        // Never block the builder on the audience card. But "No audiences yet, add one" is an
        // invitation to make one that already exists (TASK-476): say they could not be loaded,
        // and still load the blocked list, which does not depend on them.
        var cards = el("nlAudienceCards");
        if (cards) cards.innerHTML = unavailableHtml("Audiences are unavailable.");
        nlRefreshSuppressions();
      });
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
        // TASK-480: a saved newsletter's id, so the test's links carry the same words as the real send.
        body: JSON.stringify({
          subject: el("newsletterSubject").value || "Newsletter",
          bodyJson: nlDoc,
          newsletterId: Number(el("newsletterId").value) > 0 ? Number(el("newsletterId").value) : undefined,
        }),
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
      // A newsletter sent before the send queue existed has no per person record, and the server
      // says so with a 404: a true answer, shown as the message below, not as a failure.
      .then(function (res) { return res.status === 404 ? null : okJson(res); })
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
        .then(okJson)
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
        .catch(function () {
          // Advisory, so a failure never blocks a send. It used to look exactly like a clean
          // result, though (TASK-476), so say they did not run, as the Send panel does.
          host.hidden = false;
          host.innerHTML =
            '<p class="nl-preflight-head">Could not run the checks</p>' +
            '<ul><li class="nl-preflight-warn">The checks could not run. Look over it yourself before sending.</li></ul>';
        });
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
        return okJson(res);
      })
      .then(renderDonor)
      .catch(function (err) {
        // TASK-476: a failure is not a record with nothing in it. "Not found" has said so already.
        if (err && err.message === "not found") return;
        wrap.innerHTML = unavailableHtml("Could not load this donor. Please try again.");
      });
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
      if (fulfil) {
        // Name the business in the confirm, so an accidental click on the wrong row is caught by
        // reading the question rather than by noticing afterwards.
        var openRow = document.querySelector(".fx-summary.is-open .admin-fulfil-biz");
        return markFulfilment(
          fulfil.getAttribute("data-fulfil-id"),
          fulfil.getAttribute("data-fulfil-mark"),
          fulfil.getAttribute("data-fulfil-label"),
          openRow ? openRow.textContent : null
        );
      }
      var invite = t.closest("[data-send-invite]");
      if (invite) return sendSingleInvite(invite.getAttribute("data-send-invite"));
      var goto = t.closest("[data-goto-section]");
      if (goto) return selectView(goto.getAttribute("data-goto-section"));
      // The row toggle is last: the controls above sit INSIDE the detail panel, so testing them
      // first stops a button press also collapsing the row out from under itself.
      var toggle = t.closest("[data-fulfil-toggle]");
      if (toggle) return toggleFulfilment(toggle.getAttribute("data-fulfil-toggle"));
    });

    // TASK-491: the two forms in a business's Call panel. Delegated, because the panel is redrawn
    // with the list after every save.
    content.addEventListener("submit", function (e) {
      var form = e.target;
      if (!form || !form.hasAttribute) return;
      if (form.hasAttribute("data-call-form")) {
        e.preventDefault();
        markCalled(form);
      } else if (form.hasAttribute("data-phone-form")) {
        e.preventDefault();
        savePhone(form);
      }
    });
    // The note box grows with what is typed rather than scrolling inside itself (field-sizing does
    // this in the browsers that have it; this covers the rest).
    content.addEventListener("input", function (e) {
      var t = e.target;
      if (t && t.matches && t.matches("textarea.fx-call-input")) nlFitBox(t);
    });

    // The supporter rows are role="button" tabindex="0", so they have to answer Enter and Space
    // like a button does. Without this the whole page is unusable from the keyboard: the detail is
    // the only way to reach the preferences and the buttons, and it could only be opened by mouse.
    doc.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " " && e.key !== "Spacebar") return;
      var t = e.target;
      if (!t || !t.closest) return;
      // A real control inside the row handles its own keys; only the row itself needs this.
      if (t.closest("button, a, input, select, textarea")) return;
      var toggle = t.closest("[data-fulfil-toggle]");
      if (!toggle) return;
      e.preventDefault(); // Space would otherwise scroll the page.
      toggleFulfilment(toggle.getAttribute("data-fulfil-toggle"));
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
        // TASK-445: stacked, not separated by a middot. Side by side, "View letter · Delete" needs
        // about 160px; the column had 75px and broke the words themselves into "Vie w lett er".
        // One action per line reads at half the width.
        var actions = view || del ? '<span class="ty-actions">' + view + del + "</span>" : "";
        // TASK-444: one fact per column. The name and the email address used to be crammed into a
        // single cell, and "addressed to" - the name at the top of the letter, which is often a
        // person where the thank-you name is their company - was not shown at all despite being
        // stored since the feature shipped.
        var cc = r.ccEmail
          ? H.escapeHtml(r.ccEmail)
          : '<span class="admin-sub">None</span>';
        return (
          '<tr><td data-label="Sent">' + H.fmtDate(r.sentAt) +
          '</td><td data-label="Thank you to">' + H.escapeHtml(r.thankYouName) +
          '</td><td data-label="Addressed to">' + H.escapeHtml(r.addressedTo) +
          '</td><td data-label="Email">' + H.escapeHtml(r.recipientEmail) +
          '</td><td data-label="Copied to">' + cc +
          "</td><td>" + gift +
          '</td><td data-label="Signed by">' + H.escapeHtml(r.signedByName) +
          '</td><td data-label="Sent by">' + H.escapeHtml(r.sentBy) +
          "</td><td>" + actions + "</td></tr>"
        );
      })
      .join("");
    return (
      '<table class="admin-table ty-sent-table"><thead><tr><th>Sent</th><th>Thank you to</th>' +
      "<th>Addressed to</th><th>Email</th><th>Copied to</th><th>Gift</th><th>Signed by</th>" +
      "<th>Sent by</th><th></th></tr></thead><tbody>" +
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
      .then(okJson)
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
        el("tyEligibleCount").textContent = "";
      });
  }
  function loadThankYouSent() {
    var canWrite = canEdit("thank-you");
    el("tySentTable").innerHTML = '<p class="admin-loading">Loading…</p>';
    authFetch("/api/admin/thank-you/sent")
      .then(okJson)
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

  // ---- contact businesses (REQ-003 · TASK-401) ----
  // Cold outreach asking local firms to become monthly supporters. Modelled on the thank-you
  // screen deliberately: a form on the left, the real email on the right. The preview is rendered
  // by the SERVER through the same builder the send uses, so it cannot drift from what is posted.
  var outWired = false;
  var outRows = [];
  var outBlocked = false; // set once the matcher says this business has told us no
  var OUT_OUTCOMES = {
    signed_up: "Signed up",
    interested: "Interested",
    asked_for_info: "Asked for information",
    passed_on: "Passed on internally",
    not_this_year: "Not this year",
    declined: "Said no",
    no_reply: "No reply",
  };

  function outStatusOf(r) {
    if (r.outcome) return OUT_OUTCOMES[r.outcome] || r.outcome;
    if (r.sentAt) return "Emailed " + H.fmtDate(r.sentAt);
    return "Not emailed yet";
  }
  function outSay(id, msg, cls) {
    var e = el(id);
    if (!e) return;
    e.className = "ty-status" + (cls ? " " + cls : "");
    e.textContent = msg || "";
  }

  // Warnings appear while the volunteer types, not after they have committed. A decline is the
  // only one that blocks; everything else is information for a person to judge.
  function outRenderWarnings(data) {
    var box = el("outWarnings");
    if (!box) return;
    outBlocked = false;
    var matches = (data && data.matches) || [];
    if (!matches.length) {
      box.innerHTML = "";
      return;
    }
    var items = matches
      .map(function (m) {
        return "<li><strong>" + H.escapeHtml(m.businessName || "") + "</strong> — " +
          H.escapeHtml(m.reason || "") + "</li>";
      })
      .join("");
    outBlocked = !!data.doNotContact;
    box.innerHTML =
      '<div class="out-warn' + (outBlocked ? " out-warn--stop" : "") + '"><p><strong>' +
      (outBlocked
        ? "This business has asked us not to contact them again."
        : "We may already know this business.") +
      "</strong></p><ul>" + items + "</ul>" +
      (outBlocked
        ? '<p class="out-ack"><label><input type="checkbox" id="outAck" /> I have checked, and this is a different business.</label></p>'
        : '<p class="admin-help">Have a look before you add them. If it is the same firm, add a note to the one we already have instead.</p>') +
      "</div>";
  }

  function outToggleConsent() {
    var sole = el("outBusinessType").value === "sole_trader";
    el("outConsentField").hidden = !sole;
    if (!sole) el("outConsent").value = "";
  }

  var outCheckTimer = null;
  function outCheck() {
    var name = (el("outBusinessName").value || "").trim();
    if (name.length < 2) {
      el("outWarnings").innerHTML = "";
      return;
    }
    authFetch("/api/admin/outreach/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        businessName: name,
        contactEmail: (el("outContactEmail").value || "").trim(),
      }),
    })
      .then(function (r) { return r.json(); })
      .then(outRenderWarnings)
      .catch(function () { /* a failed check must never block someone typing */ });
  }
  function outCheckSoon() {
    if (outCheckTimer) clearTimeout(outCheckTimer);
    outCheckTimer = setTimeout(outCheck, 350);
  }

  function outAdd(e) {
    e.preventDefault();
    var payload = {
      businessName: (el("outBusinessName").value || "").trim(),
      contactName: (el("outContactName").value || "").trim() || null,
      contactEmail: (el("outContactEmail").value || "").trim() || null,
      contactPhone: (el("outContactPhone").value || "").trim() || null,
      businessType: el("outBusinessType").value,
      warmIntro: (el("outWarmIntro").value || "").trim() || null,
      tags: (el("outTags").value || "").trim() || null,
      detailsSource: el("outSource").value,
      consentBasis: (el("outConsent").value || "").trim() || null,
      note: (el("outNote").value || "").trim() || null,
      owner: outOwnerName(),
      ownerEmail: el("outOwner").value || null,
    };
    if (outBlocked && el("outAck") && el("outAck").checked) payload.acknowledgedMatches = true;
    var btn = el("outAdd");
    btn.disabled = true;
    outSay("outAddStatus", "Adding…");
    authFetch("/api/admin/outreach", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); })
      .then(function (res) {
        btn.disabled = false;
        if (!res.ok) {
          outSay("outAddStatus", res.body.error || "Could not add that business.", "is-error");
          if (res.body.matches) outRenderWarnings(res.body);
          return;
        }
        outSay("outAddStatus", "Added. They are in the list below, not emailed yet.", "is-ok");
        el("outAddForm").reset();
        outToggleConsent();
        el("outWarnings").innerHTML = "";
        outBlocked = false;
        loadOutreachList();
      })
      .catch(function () {
        btn.disabled = false;
        outSay("outAddStatus", "Could not add that business.", "is-error");
      });
  }

  var outPreviewTimer = null;
  function outPreview() {
    var frame = el("outPreview");
    if (!frame) return;
    var id = el("outSendTo").value;
    var r = outRows.filter(function (x) { return String(x.id) === id; })[0];
    var opt = el("outSigner").selectedOptions[0];
    authFetch("/api/admin/outreach/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        businessName: r ? r.businessName : "",
        contactName: r ? r.contactName : "",
        detailsSource: r ? r.detailsSource : null,
        personalMessage: (el("outPersonal").value || "").trim(),
        signerName: opt ? opt.value : "",
        signerRole: opt ? opt.getAttribute("data-role") : "",
      }),
    })
      .then(function (x) { return x.json(); })
      .then(function (b) { if (b.html) frame.srcdoc = b.html; })
      .catch(function () { /* leave the last good preview on screen */ });
  }
  function outPreviewSoon() {
    if (outPreviewTimer) clearTimeout(outPreviewTimer);
    outPreviewTimer = setTimeout(outPreview, 300);
  }

  function outSend(e) {
    e.preventDefault();
    var id = el("outSendTo").value;
    if (!id) {
      outSay("outSendStatus", "Choose a business first.", "is-error");
      return;
    }
    var r = outRows.filter(function (x) { return String(x.id) === id; })[0];
    var who = r ? r.businessName : "this business";
    // One deliberate pause. This lands in a stranger's inbox and cannot be taken back.
    if (!window.confirm("Send this to " + who + "? It goes straight to their inbox.")) return;
    var opt = el("outSigner").selectedOptions[0];
    var btn = el("outSend");
    btn.disabled = true;
    outSay("outSendStatus", "Sending…");
    authFetch("/api/admin/outreach/" + encodeURIComponent(id) + "/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        personalMessage: (el("outPersonal").value || "").trim(),
        signerName: opt ? opt.value : "",
        signerRole: opt ? opt.getAttribute("data-role") : "",
      }),
    })
      .then(function (x) { return x.json().then(function (b) { return { ok: x.ok, body: b }; }); })
      .then(function (res) {
        btn.disabled = false;
        if (!res.ok) {
          outSay("outSendStatus", res.body.error || "The email could not be sent.", "is-error");
          return;
        }
        outSay("outSendStatus", "Sent to " + who + ".", "is-ok");
        el("outPersonal").value = "";
        loadOutreachList();
      })
      .catch(function () {
        btn.disabled = false;
        outSay("outSendStatus", "The email could not be sent.", "is-error");
      });
  }

  function outRenderList() {
    var wrap = el("outList");
    if (!wrap) return;
    var shown = outRows.filter(outMatches);
    el("outSearchCount").textContent = outSearchTerm
      ? shown.length + " of " + outRows.length + " businesses"
      : "";
    if (!shown.length) {
      wrap.innerHTML = outSearchTerm
        ? '<p class="admin-empty">Nothing matches that. Try part of the name, or the email address.</p>'
        : '<p class="admin-empty">No businesses yet. Add the first one above.</p>';
    } else {
      wrap.innerHTML =
        '<table class="admin-table"><thead><tr><th>Business</th><th>Contact</th>' +
        "<th>Where it stands</th><th>Looked after by</th><th>Added</th></tr></thead><tbody>" +
        shown
          .map(function (r) {
            var contact = [r.contactName, r.contactEmail, r.contactPhone]
              .filter(Boolean)
              .map(H.escapeHtml)
              .join("<br />");
            // The name is the way in. Everything about this firm is one click away.
            return '<tr><td><button class="admin-linkish" type="button" data-out-open="' + r.id +
              '">' + H.escapeHtml(r.businessName) + "</button></td><td>" +
              (contact || "&mdash;") + "</td><td>" + H.escapeHtml(outStatusOf(r)) +
              "</td><td>" + H.escapeHtml(r.owner || "") + "</td><td>" +
              H.fmtDate(r.createdAt) + "</td></tr>";
          })
          .join("") +
        "</tbody></table>";
    }

    // Only businesses with an email address and nothing sent yet can be picked. Anything else in
    // this list would be a send that is going to fail, or a business emailed twice.
    var sel = el("outSendTo");
    var keep = sel.value;
    var sendable = outRows.filter(function (r) { return r.contactEmail && !r.sentAt; });
    sel.innerHTML = sendable.length
      ? sendable
          .map(function (r) {
            return '<option value="' + r.id + '">' + H.escapeHtml(r.businessName) +
              " — " + H.escapeHtml(r.contactEmail) + "</option>";
          })
          .join("")
      : '<option value="">Nobody is waiting to be emailed</option>';
    if (keep && sendable.some(function (r) { return String(r.id) === keep; })) sel.value = keep;

    // Built from the tags in use, so it never offers one that would find nothing.
    var tagSel = el("outTagFilter");
    var tags = {};
    outRows.forEach(function (r) { (r.tags || []).forEach(function (t) { tags[t] = 1; }); });
    var keepTag = tagSel.value;
    tagSel.innerHTML = '<option value="">Any</option>' +
      Object.keys(tags).sort().map(function (t) {
        return '<option value="' + H.escapeHtml(t) + '">' + H.escapeHtml(t) + "</option>";
      }).join("");
    if (keepTag && tags[keepTag]) tagSel.value = keepTag;

    var sent = outRows.filter(function (r) { return r.sentAt; }).length;
    var signed = outRows.filter(function (r) { return r.outcome === "signed_up"; }).length;
    el("outStats").innerHTML =
      statCard(outRows.length, "On the list") +
      statCard(outRows.length - sent, "Waiting to be emailed") +
      statCard(sent, "Emailed") +
      statCard(signed, "Signed up");
  }

  function loadOutreachList() {
    authFetch("/api/admin/outreach")
      .then(okJson)
      .then(function (b) {
        outRows = b.results || [];
        outRenderList();
        outPreview();
      })
      .catch(function () {
        el("outList").innerHTML = '<p class="admin-empty">Could not load the list.</p>';
        // The totals above it are counted from the same list: none rather than 0 (TASK-476).
        el("outStats").innerHTML = "";
        el("outSearchCount").textContent = "";
      });
  }

  function outWire() {
    if (outWired) return;
    outWired = true;
    el("outList").addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest("[data-out-open]");
      if (b) openBusiness(Number(b.getAttribute("data-out-open")));
    });
    var writable = canEdit("outreach");
    el("outAdd").hidden = !writable;
    // A plain download link sends no Authorization header, so the file is fetched with
    // the session and handed to the browser as a blob instead.
    bindClick("outExport", outDownloadCsv);
    el("outSend").hidden = !writable;
    fillSignerSelect(el("outSigner"));
    // The volunteers, not the letter-signers: signing a thank-you letter and chasing a
    // local business are different jobs, and the old picker could not offer someone who
    // only does the second. The option carries the email, which is what "mine" matches on.
    loadOutreachVolunteers();
    // The consent box exists only for a sole trader, because only a sole trader needs one.
    // Showing it always would ask every volunteer a question that does not apply to them.
    el("outBusinessType").addEventListener("change", outToggleConsent);
    outToggleConsent();
    tyBindInput("outBusinessName", outCheckSoon);
    tyBindInput("outContactEmail", outCheckSoon);
    tyBindInput("outPersonal", outPreviewSoon);
    el("outSendTo").addEventListener("change", outPreview);
    el("outSigner").addEventListener("change", outPreview);
    el("outTodoScope").addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest("[data-out-scope]");
      if (!b) return;
      outTodoScope = b.getAttribute("data-out-scope");
      Array.prototype.forEach.call(el("outTodoScope").querySelectorAll("[data-out-scope]"), function (x) {
        x.classList.toggle("is-active", x === b);
        x.setAttribute("aria-pressed", x === b ? "true" : "false");
      });
      loadOutreachTodo();
    });
    el("outTodo").addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest("[data-out-open]");
      if (b) openBusiness(Number(b.getAttribute("data-out-open")));
    });
    tyBindInput("outSearch", function () {
      outSearchTerm = (el("outSearch").value || "").trim().toLowerCase();
      outRenderList();
    });
    bindClick("outPasteCheck", outCheckPaste);
    bindClick("outPasteAdd", outAddPasted);
    el("outTagFilter").addEventListener("change", function () {
      outTagFilter = el("outTagFilter").value;
      outRenderList();
    });
    el("outAddForm").addEventListener("submit", outAdd);
    el("outSendForm").addEventListener("submit", outSend);
  }
  // The display name for whichever volunteer is picked. Stored alongside the email so the
  // list can show a person rather than an address.
  function outOwnerName() {
    var opt = el("outOwner").selectedOptions[0];
    return opt && opt.value ? opt.textContent : null;
  }

  function loadOutreachVolunteers() {
    var owner = el("outOwner");
    owner.innerHTML = '<option value="">Not assigned yet</option>';
    authFetch("/api/admin/outreach/volunteers")
      .then(j)
      .then(function (d) {
        (d.volunteers || []).forEach(function (v) {
          var o = doc.createElement("option");
          o.value = v.email;
          o.textContent = v.name;
          owner.appendChild(o);
        });
      })
      .catch(function () { /* the picker still offers 'not assigned yet' */ });
  }

  function loadOutreach() {
    if (!el("outAddForm")) return;
    outWire();
    loadOutreachTodo();
    loadOutreachList();
    loadOutreachReports();
  }

  // ---- needs you today (TASK-405) ----
  // One list, not three. Every row says WHY it is there and what to do about it, because a list of
  // names with no explanation gets skimmed once and then ignored. Clicking a row opens the
  // business, which is where all four of the actions actually happen.
  var outTodoScope = "mine";

  // The kinds, in the order they matter. A promise we made outranks a chase; a warm business
  // outranks a cold one. KEEP IN SYNC with RANK in src/outreach/todo.ts.
  var OUT_TODO_WORDS = {
    "ask-again": "Ask again",
    call: "Worth a call",
    nudge: "No reply",
    send: "Ready to send",
    "find-address": "No address",
  };

  function outRenderTodo(d) {
    var wrap = el("outTodo");
    if (!wrap) return;
    var todos = d.todos || [];

    el("outTodoCount").textContent =
      outTodoScope === "mine" && d.totalEverywhere > todos.length
        ? d.totalEverywhere + " altogether across everyone"
        : "";

    if (!todos.length) {
      // The screen will look like this until the first emails go out, so the empty state has to
      // say why rather than reading as something broken.
      wrap.innerHTML =
        '<p class="admin-empty">Nothing needs you right now. Businesses appear here when an ' +
        "email has gone unanswered for a fortnight, when someone was interested and has gone " +
        "quiet, or when a date you set has come round.</p>";
      return;
    }

    wrap.innerHTML =
      '<ul class="out-todo">' +
      todos
        .map(function (t) {
          var late = t.daysOverdue > 0
            ? '<span class="out-todo-late">' + t.daysOverdue +
              (t.daysOverdue === 1 ? " day over</span>" : " days over</span>")
            : "";
          var who = t.owner ? H.escapeHtml(t.owner) : "Nobody yet";
          return (
            '<li class="out-todo-row out-todo-row--' + t.kind + '">' +
            '<button class="out-todo-open" type="button" data-out-open="' + t.id + '">' +
            '<span class="out-todo-kind">' + H.escapeHtml(OUT_TODO_WORDS[t.kind] || t.kind) + "</span>" +
            '<span class="out-todo-name">' + H.escapeHtml(t.businessName) + "</span>" +
            '<span class="out-todo-why">' + H.escapeHtml(t.reason) + "</span>" +
            '<span class="out-todo-do">' + H.escapeHtml(t.action) + "</span>" +
            '<span class="out-todo-who">' + who + " " + late + "</span>" +
            "</button></li>"
          );
        })
        .join("") +
      "</ul>";
  }

  function loadOutreachTodo() {
    authFetch("/api/admin/outreach/todo?scope=" + encodeURIComponent(outTodoScope))
      .then(okJson)
      .then(outRenderTodo)
      .catch(function () {
        el("outTodo").innerHTML = '<p class="admin-empty">Could not load this list.</p>';
      });
  }

  // ---- search (TASK-405) ----
  // Filtered in the browser: the whole list is already here, and a round trip per keystroke would
  // be slower than the filter. Matches on the things somebody actually half-remembers.
  var outSearchTerm = "";
  var outTagFilter = "";
  function outMatches(r) {
    // The tag filter and the search box narrow together: somebody who has picked a tag
    // and then types is asking for both, not either.
    if (outTagFilter && (r.tags || []).indexOf(outTagFilter) === -1) return false;
    if (!outSearchTerm) return true;
    return [r.businessName, r.contactName, r.contactEmail, r.contactPhone, r.owner]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .indexOf(outSearchTerm) !== -1;
  }

  // The export is fetched rather than followed: an <a download> sends no Authorization header, so
  // a plain link would land on the login page instead of a spreadsheet.
  function outDownloadCsv(e) {
    if (e && e.preventDefault) e.preventDefault();
    authFetch("/api/admin/outreach/export")
      .then(function (r) {
        if (!r.ok) throw new Error();
        return r.blob();
      })
      .then(function (blob) {
        var url = URL.createObjectURL(blob);
        var a = doc.createElement("a");
        a.href = url;
        a.download = "nbcc-businesses.csv";
        doc.body.appendChild(a);
        a.click();
        doc.body.removeChild(a);
        URL.revokeObjectURL(url);
      })
      .catch(function () {
        el("outSearchCount").textContent = "Could not download that.";
      });
  }

  // ---- adding several at once (TASK-416) ----
  // Below the single-add form and behind a fold, because one at a time stays the front door. This
  // only ADDS drafts: it never sends, so there is no moment where somebody could wonder which
  // personal message went to whom.
  var outPasteRows = [];

  function outPasteSay(msg, cls) {
    var e = el("outPasteStatus");
    e.className = "ty-status" + (cls ? " " + cls : "");
    e.textContent = msg || "";
  }

  function outCheckPaste() {
    var text = el("outPasteText").value || "";
    if (!text.trim()) {
      outPasteSay("Paste a list first.", "is-error");
      return;
    }
    outPasteSay("Reading it…");
    authFetch("/api/admin/outreach/paste", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: text }),
    })
      .then(okJson)
      .then(function (d) {
        outPasteRows = d.usable || [];
        var problems = d.problems || [];
        var dupes = d.duplicatedInPaste || [];

        var html = "";
        if (outPasteRows.length) {
          html +=
            '<p class="out-paste-count">' + outPasteRows.length +
            (outPasteRows.length === 1 ? " business" : " businesses") + " ready to add:</p>" +
            '<table class="admin-table"><thead><tr><th>Business</th><th>Email</th><th>Phone</th>' +
            "</tr></thead><tbody>" +
            outPasteRows
              .map(function (r) {
                return "<tr><td>" + H.escapeHtml(r.businessName) + "</td><td>" +
                  H.escapeHtml(r.contactEmail || "—") + "</td><td>" +
                  H.escapeHtml(r.contactPhone || "—") + "</td></tr>";
              })
              .join("") +
            "</tbody></table>";
        }
        // Named, with their line number, so somebody can go and fix the paste rather than
        // guessing which of forty lines was wrong.
        if (problems.length) {
          html +=
            '<div class="out-warn out-warn--stop"><p><strong>' + problems.length +
            (problems.length === 1 ? " line cannot be used" : " lines cannot be used") +
            ", and will be left out.</strong></p><ul>" +
            problems
              .map(function (p) {
                return "<li>Line " + p.line + ": " + H.escapeHtml(p.problem) +
                  ' <span class="ty-muted">' + H.escapeHtml(p.raw) + "</span></li>";
              })
              .join("") +
            "</ul></div>";
        }
        if (dupes.length) {
          html +=
            '<div class="out-warn"><p><strong>Listed more than once in what you pasted.</strong></p><ul>' +
            dupes.map(function (n) { return "<li>" + H.escapeHtml(n) + "</li>"; }).join("") +
            '</ul><p class="admin-help">They will each be added once per line. Take the extras out above if that is not what you want.</p></div>';
        }
        el("outPastePreview").innerHTML = html;
        el("outPasteAdd").hidden = !(outPasteRows.length && canEdit("outreach"));
        outPasteSay("");
      })
      .catch(function () { outPasteSay("Could not read that.", "is-error"); });
  }

  // Added one at a time through the ordinary endpoint, so every business gets the same duplicate
  // check and the same do-not-contact refusal as one typed by hand. A bulk route that skipped
  // those would be a way round the rules rather than a shortcut through the typing.
  function outAddPasted() {
    var btn = el("outPasteAdd");
    btn.disabled = true;
    var added = 0;
    var refused = [];

    var next = function (i) {
      if (i >= outPasteRows.length) {
        btn.disabled = false;
        el("outPasteAdd").hidden = true;
        el("outPasteText").value = "";
        el("outPastePreview").innerHTML = refused.length
          ? '<div class="out-warn"><p><strong>' + refused.length +
            " were not added, because we already know them or they have asked us not to write:</strong></p><ul>" +
            refused.map(function (n) { return "<li>" + H.escapeHtml(n) + "</li>"; }).join("") +
            '</ul><p class="admin-help">Add any of them one at a time if you are sure they are different businesses.</p></div>'
          : "";
        outPasteSay("Added " + added + " of " + outPasteRows.length + ".", "is-ok");
        loadOutreachList();
        loadOutreachTodo();
        return;
      }
      var r = outPasteRows[i];
      authFetch("/api/admin/outreach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName: r.businessName,
          contactEmail: r.contactEmail,
          contactPhone: r.contactPhone,
          businessType: "company",
          detailsSource: el("outSource").value,
        }),
      })
        .then(function (x) {
          if (x.ok) added += 1;
          else refused.push(r.businessName);
          next(i + 1);
        })
        .catch(function () {
          refused.push(r.businessName);
          next(i + 1);
        });
    };
    outPasteSay("Adding…");
    next(0);
  }

  // ---- is it working? (TASK-413) ----
  // At the foot of the screen on purpose: interesting once a month, noise every day. Every figure
  // is worked out on the server in src/outreach/reports.ts, where it can be argued with in a test;
  // this only renders what comes back.
  function outMoney(pence) {
    return "£" + (Math.round(pence) / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  // A rate the server could not work out is shown as a dash, never as 0%. Nought per cent means
  // "we tried and nobody said yes"; a dash means "we have not tried yet", and on day one that is
  // the difference between a report that reads as failure and one that reads as early.
  function outRate(v) {
    return v === null || v === undefined ? "&mdash;" : v + "%";
  }

  function outRenderReports(d) {
    var wrap = el("outReports");
    if (!wrap) return;
    var f = d.funnel || {};
    var m = d.money || {};
    var pm = d.personalMessage || { withMessage: {}, without: {} };

    if (!f.added) {
      wrap.innerHTML =
        '<p class="admin-empty">Nothing to report yet. Once businesses have been added and ' +
        "emailed, this will show how many replied, how many signed up, and what they have given.</p>";
      return;
    }

    var funnel =
      '<div class="admin-stats">' +
      statCard(f.added, "Added") +
      statCard(f.emailed, "Emailed") +
      statCard(f.replied, "Replied") +
      statCard(f.signedUp, "Signed up") +
      "</div>" +
      '<p class="out-report-line">Of the ' + f.emailed + " we emailed, <strong>" + outRate(f.replyRate) +
      "</strong> replied and <strong>" + outRate(f.signUpRate) + "</strong> became supporters." +
      ' <span class="ty-muted">Both worked out of those emailed, not everyone on the list &mdash; a business we have not written to yet has not turned us down.</span></p>';

    var money = m.supporters
      ? '<p class="out-report-line"><strong>' + outMoney(m.totalPence) + "</strong> given by " +
        m.supporters + (m.supporters === 1 ? " business" : " businesses") + " that came from this," +
        " an average of " + outMoney(m.averagePence) + " each." +
        ' <span class="ty-muted">Only counts businesses somebody linked to their donor record when marking them signed up.</span></p>'
      : '<p class="out-report-line ty-muted">No money counted yet. A business only appears here once somebody has linked it to its donor record, which happens when you mark it as signed up.</p>';

    var byVol = (d.byVolunteer || []).length
      ? '<table class="admin-table"><thead><tr><th>Volunteer</th><th class="admin-num">Emailed</th>' +
        '<th class="admin-num">Signed up</th><th class="admin-num">Rate</th></tr></thead><tbody>' +
        d.byVolunteer
          .map(function (t) {
            return "<tr><td>" + H.escapeHtml(t.owner) + '</td><td class="admin-num">' + t.emailed +
              '</td><td class="admin-num">' + t.signedUp + '</td><td class="admin-num">' +
              outRate(t.signUpRate) + "</td></tr>";
          })
          .join("") +
        "</tbody></table>"
      : "";

    // The honest bit. Told outright when the numbers are too thin to act on, rather than left to
    // be read as a finding.
    var pmBlock = pm.worthReading
      ? '<p class="out-report-line">With a personal message: <strong>' + outRate(pm.withMessage.rate) +
        "</strong> signed up (" + pm.withMessage.signedUp + " of " + pm.withMessage.emailed + ")." +
        " Without one: <strong>" + outRate(pm.without.rate) + "</strong> (" + pm.without.signedUp +
        " of " + pm.without.emailed + ").</p>"
      : '<p class="out-report-line ty-muted">Not enough sent yet to say whether a personal message ' +
        "helps. It needs at least " + (pm.withMessage.emailed !== undefined ? "10" : "10") +
        " each way before the difference means anything rather than being luck.</p>";

    wrap.innerHTML =
      funnel + money +
      '<h4 class="out-report-head">How each of us has got on</h4>' + byVol +
      '<h4 class="out-report-head">Does a personal message help?</h4>' + pmBlock;
  }

  function loadOutreachReports() {
    authFetch("/api/admin/outreach/reports")
      .then(okJson)
      .then(outRenderReports)
      .catch(function () {
        el("outReports").innerHTML = '<p class="admin-empty">Could not load this.</p>';
      });
  }

  // ---- one business (TASK-404) ----
  // Reached by clicking a name in the list, not from the nav. Everything known about one firm in
  // one place: who they are, where the details came from, who knows them, what happened, and every
  // note anyone has written. Piecing that together from a list row is how a volunteer ends up
  // asking the same business twice.
  var businessWired = false;
  var businessId = null;
  var businessRow = null;

  // KEEP IN SYNC with OUTCOME_MEANINGS in src/outreach/outcomes.ts. The meanings are here rather
  // than fetched because they never change between one business and the next, and a volunteer
  // choosing between "Interested" and "Asked for information" should not wait on a round trip.
  var OUT_MEANINGS = {
    signed_up: "They are giving, or have promised to.",
    interested: "Warm, but nothing agreed yet.",
    asked_for_info: "They want to know more before deciding.",
    passed_on: "The person we wrote to has handed it to someone else there.",
    not_this_year: "A no for now, and worth asking again later.",
    declined: "A no, and they should not be asked again.",
    no_reply: "We heard nothing back.",
  };
  var OUT_ORDER = [
    "signed_up", "interested", "asked_for_info", "passed_on",
    "not_this_year", "declined", "no_reply",
  ];

  var OUT_SOURCE_WORDS = {
    website_or_listing: "Their website or a business listing",
    given_to_us: "They gave them to us",
    referred: "Someone we know passed them on",
    social: "Their social media page",
  };

  function businessSay(id, msg, cls) {
    var e = el(id);
    if (!e) return;
    e.className = "ty-status" + (cls ? " " + cls : "");
    e.textContent = msg || "";
  }

  function factRow(label, value) {
    if (!value) return "";
    return '<div class="out-fact"><dt>' + H.escapeHtml(label) + "</dt><dd>" + value + "</dd></div>";
  }

  // Calling a business on the Corporate TPS register is an offence, and screening in bulk needs a
  // paid licence nobody is buying at this volume. So the number stays hidden until a volunteer
  // says they have checked it on the free lookup, and their name and the date are kept. It is a
  // record rather than a lock - the point is that the check becomes a deliberate act with
  // evidence, not that the number is unobtainable.
  function businessPhoneCell(r) {
    if (!r.contactPhone) return "";
    if (r.ctpsCheckedAt) {
      return '<a href="tel:' + H.escapeHtml(r.contactPhone.replace(/\s/g, "")) + '">' +
        H.escapeHtml(r.contactPhone) + "</a>" +
        '<span class="out-tps-ok">Checked against the register' +
        (r.ctpsCheckedBy ? " by " + H.escapeHtml(r.ctpsCheckedBy) : "") +
        ", " + H.fmtDate(r.ctpsCheckedAt) + "</span>";
    }
    return (
      '<span class="out-tps-hidden">Number hidden until checked</span>' +
      '<span class="out-tps-why">Ringing a business on the Corporate TPS register is against the law. ' +
      'Check it on the <a href="https://www.tpsservices.co.uk/" target="_blank" rel="noopener">free TPS lookup</a>, then say so here.</span>' +
      (canEdit("outreach")
        ? '<button class="admin-btn out-tps-btn" type="button" id="businessCtps">I have checked this number</button>'
        : "")
    );
  }

  function renderBusiness(r, notes) {
    businessRow = r;
    el("business-heading").textContent = r.businessName;

    var contact = [
      r.contactName ? H.escapeHtml(r.contactName) : "",
      r.contactEmail ? '<a href="mailto:' + H.escapeHtml(r.contactEmail) + '">' + H.escapeHtml(r.contactEmail) + "</a>" : "",
      businessPhoneCell(r),
    ].filter(Boolean).join("<br />");

    var stands = r.outcome
      ? H.escapeHtml(OUT_OUTCOMES[r.outcome] || r.outcome) +
        (r.outcomeAt ? ' <span class="ty-muted">on ' + H.fmtDate(r.outcomeAt) + "</span>" : "")
      : r.sentAt
        ? "Emailed " + H.fmtDate(r.sentAt) + (r.sentBy ? ' <span class="ty-muted">by ' + H.escapeHtml(r.sentBy) + "</span>" : "")
        : "Not emailed yet";

    el("businessDetail").innerHTML =
      '<dl class="out-facts">' +
      factRow("Where it stands", stands) +
      factRow("Contact", contact) +
      factRow("Kind of business", r.businessType === "sole_trader" ? "Sole trader or partnership" : "Limited company or LLP") +
      // The reason this business is worth a call rather than another email.
      factRow("Who knows them", r.warmIntro ? H.escapeHtml(r.warmIntro) : "") +
      factRow("Looked after by", r.owner ? H.escapeHtml(r.owner) : "Nobody yet") +
      factRow("Where the details came from", H.escapeHtml(OUT_SOURCE_WORDS[r.detailsSource] || r.detailsSource)) +
      // Shown back rather than hidden: whoever emails a sole trader should be able to see why
      // they are allowed to.
      factRow("They agreed to hear from us", r.consentBasis
        ? H.escapeHtml(r.consentBasis) + (r.consentBasisRecordedBy ? ' <span class="ty-muted">recorded by ' + H.escapeHtml(r.consentBasisRecordedBy) + "</span>" : "")
        : "") +
      factRow("Ask again", r.askAgainOn ? H.fmtDate(r.askAgainOn) : "") +
      factRow("Follow-up sent", r.nudgeSentAt
        ? H.fmtDate(r.nudgeSentAt) + (r.nudgeSentBy ? ' <span class="ty-muted">by ' + H.escapeHtml(r.nudgeSentBy) + "</span>" : "")
        : "") +
      factRow("Why this business", r.note ? H.escapeHtml(r.note) : "") +
      factRow("Added", H.fmtDate(r.createdAt)) +
      "</dl>";

    // The outcome list. Each option carries its meaning, so nobody has to guess which of two
    // similar-sounding ones they want.
    el("businessOutcomes").innerHTML = OUT_ORDER.map(function (key) {
      var checked = r.outcome === key ? " checked" : "";
      return '<label class="out-outcome"><input type="radio" name="outOutcome" value="' + key + '"' + checked + ' />' +
        '<span class="out-outcome-label">' + H.escapeHtml(OUT_OUTCOMES[key]) + "</span>" +
        '<span class="out-outcome-why">' + H.escapeHtml(OUT_MEANINGS[key]) + "</span></label>";
    }).join("");

    // Due only when the first email went, nothing came back, and the one follow-up is unused.
    // The server refuses a second whatever this decides, but offering a button that will be
    // refused is its own small unkindness.
    var nudgeDue = !!r.sentAt && !r.nudgeSentAt && !r.outcome && !!r.contactEmail;
    el("businessNudge").hidden = !(nudgeDue && canEdit("outreach"));

    if (r.askAgainOn) el("businessAskAgain").value = String(r.askAgainOn).slice(0, 10);
    businessToggleAskAgain();
    renderBusinessNotes(notes);
  }

  function renderBusinessNotes(notes) {
    var wrap = el("businessNotes");
    if (!wrap) return;
    if (!notes || !notes.length) {
      wrap.innerHTML = '<p class="admin-empty">No notes yet. The first one is usually the most useful.</p>';
      return;
    }
    wrap.innerHTML = '<ol class="out-notes">' + notes.map(function (n) {
      return '<li class="out-note"><p class="out-note-meta">' + H.escapeHtml(n.author) + " &middot; " +
        H.fmtDate(n.createdAt) + '</p><p class="out-note-body">' + H.escapeHtml(n.body) + "</p></li>";
    }).join("") + "</ol>";
  }

  // The date only matters for "not this year", so it only appears for "not this year". A field
  // that does nothing is a field people fill in anyway.
  function businessToggleAskAgain() {
    var picked = doc.querySelector('input[name="outOutcome"]:checked');
    // Linking the donor only means anything on a sign-up.
    var signedUp = picked && picked.value === "signed_up";
    el("businessDonorField").hidden = !signedUp;
    if (signedUp && el("businessDonor").options.length <= 1) businessLoadDonors();
    var wants = picked && picked.value === "not_this_year";
    el("businessAskAgainField").hidden = !wants;
    if (wants && !el("businessAskAgain").value) {
      var d = new Date();
      d.setMonth(d.getMonth() + 11);
      el("businessAskAgain").value = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-01";
    }
  }

  // Ranked by the same matcher the duplicate check uses, so the likely one is at the top and
  // nobody has to scroll a list of every business that has ever given.
  function businessLoadDonors() {
    var sel = el("businessDonor");
    sel.innerHTML = '<option value="">Not sure yet</option>';
    authFetch("/api/admin/outreach/" + encodeURIComponent(businessId) + "/donors")
      .then(j)
      .then(function (d) {
        (d.donors || []).forEach(function (v) {
          var o = doc.createElement("option");
          o.value = v.id;
          o.textContent = v.name + " — " + outMoney(v.totalPence) + " given so far";
          sel.appendChild(o);
        });
        if (businessRow && businessRow.donorId) sel.value = String(businessRow.donorId);
      })
      .catch(function () { /* the picker still offers "not sure yet" */ });
  }

  function businessSaveOutcome(e) {
    e.preventDefault();
    var picked = doc.querySelector('input[name="outOutcome"]:checked');
    if (!picked) {
      businessSay("businessOutcomeStatus", "Pick what happened first.", "is-error");
      return;
    }
    if (picked.value === "declined" &&
        !window.confirm("Record that " + (businessRow ? businessRow.businessName : "this business") +
          " said no? They will not be contacted again.")) return;
    var btn = el("businessOutcomeSave");
    btn.disabled = true;
    businessSay("businessOutcomeStatus", "Saving…");
    authFetch("/api/admin/outreach/" + encodeURIComponent(businessId) + "/outcome", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        outcome: picked.value,
        askAgainOn: (el("businessAskAgain").value || "").trim() || null,
        donorId: Number(el("businessDonor").value) || null,
      }),
    })
      .then(function (x) { return x.json().then(function (b) { return { ok: x.ok, body: b }; }); })
      .then(function (res) {
        btn.disabled = false;
        if (!res.ok) {
          businessSay("businessOutcomeStatus", res.body.error || "Could not save that.", "is-error");
          return;
        }
        businessSay("businessOutcomeStatus", "Saved.", "is-ok");
        openBusiness(businessId);
        loadOutreachTodo();
        loadOutreachReports();
      })
      .catch(function () {
        btn.disabled = false;
        businessSay("businessOutcomeStatus", "Could not save that.", "is-error");
      });
  }

  function businessAddNote(e) {
    e.preventDefault();
    var body = (el("businessNote").value || "").trim();
    if (!body) {
      businessSay("businessNoteStatus", "Write something first.", "is-error");
      return;
    }
    var btn = el("businessNoteAdd");
    btn.disabled = true;
    businessSay("businessNoteStatus", "Saving…");
    authFetch("/api/admin/outreach/" + encodeURIComponent(businessId) + "/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: body }),
    })
      .then(function (x) { return x.json().then(function (b) { return { ok: x.ok, body: b }; }); })
      .then(function (res) {
        btn.disabled = false;
        if (!res.ok) {
          businessSay("businessNoteStatus", res.body.error || "Could not save that note.", "is-error");
          return;
        }
        el("businessNote").value = "";
        businessSay("businessNoteStatus", "Added.", "is-ok");
        renderBusinessNotes(res.body.notes);
      })
      .catch(function () {
        btn.disabled = false;
        businessSay("businessNoteStatus", "Could not save that note.", "is-error");
      });
  }

  function businessWire() {
    if (businessWired) return;
    businessWired = true;
    var writable = canEdit("outreach");
    el("businessOutcomeForm").hidden = !writable;
    el("businessNoteForm").hidden = !writable;
    el("businessOutcomeForm").addEventListener("submit", businessSaveOutcome);
    el("businessNoteForm").addEventListener("submit", businessAddNote);
    el("businessOutcomes").addEventListener("change", businessToggleAskAgain);
    bindClick("businessDisclose", businessShowDisclosure);
    bindClick("businessNudgeSend", businessSendNudge);
    bindClick("businessDiscloseCopy", businessCopyDisclosure);
    // The button only exists once a business has an unchecked number, so it is bound by
    // delegation from the panel that redraws around it.
    el("businessDetail").addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest("#businessCtps");
      if (b) businessConfirmCtps();
    });
    bindClick("businessBack", function () { selectView("outreach"); });
  }

  function businessSendNudge() {
    var who = businessRow ? businessRow.businessName : "this business";
    // The email promises to be the last one, so the pause says so too.
    if (!window.confirm("Send the one follow-up to " + who + "? It says it is the last they will hear from us, and it cannot be sent again.")) return;
    var opt = el("outSigner").selectedOptions[0];
    var btn = el("businessNudgeSend");
    btn.disabled = true;
    businessSay("businessNudgeStatus", "Sending…");
    authFetch("/api/admin/outreach/" + encodeURIComponent(businessId) + "/nudge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        signerName: opt ? opt.value : "",
        signerRole: opt ? opt.getAttribute("data-role") : "",
      }),
    })
      .then(function (x) { return x.json().then(function (b) { return { ok: x.ok, body: b }; }); })
      .then(function (res) {
        btn.disabled = false;
        if (!res.ok) {
          businessSay("businessNudgeStatus", res.body.error || "It could not be sent.", "is-error");
          return;
        }
        businessSay("businessNudgeStatus", "Sent. They will not be chased again.", "is-ok");
        openBusiness(businessId);
        loadOutreachTodo();
      })
      .catch(function () {
        btn.disabled = false;
        businessSay("businessNudgeStatus", "It could not be sent.", "is-error");
      });
  }

  function businessShowDisclosure() {
    var pre = el("businessDisclosure");
    businessSay("businessDiscloseStatus", "Gathering it…");
    authFetch("/api/admin/outreach/" + encodeURIComponent(businessId) + "/disclosure")
      .then(okJson)
      .then(function (d) {
        pre.textContent = d.text || "";
        pre.hidden = false;
        el("businessDiscloseCopy").hidden = false;
        businessSay("businessDiscloseStatus", "");
      })
      .catch(function () {
        businessSay("businessDiscloseStatus", "Could not gather that.", "is-error");
      });
  }

  function businessCopyDisclosure() {
    var text = el("businessDisclosure").textContent || "";
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () { businessSay("businessDiscloseStatus", "Copied. Paste it into your reply.", "is-ok"); },
        function () { businessSay("businessDiscloseStatus", "Could not copy. Select it and copy by hand.", "is-error"); },
      );
    } else {
      businessSay("businessDiscloseStatus", "Select it and copy by hand.", "is-error");
    }
  }

  function businessConfirmCtps() {
    if (!window.confirm("Confirm you have checked this number against the TPS register? Your name and today's date are kept with it.")) return;
    authFetch("/api/admin/outreach/" + encodeURIComponent(businessId) + "/ctps", { method: "POST" })
      .then(function (x) { if (!x.ok) throw new Error(); return x.json(); })
      .then(function () { openBusiness(businessId); })
      .catch(function () {
        businessSay("businessOutcomeStatus", "Could not record that check.", "is-error");
      });
  }

  function openBusiness(id) {
    businessWire();
    businessId = id;
    showOnly("view-business");
    Array.prototype.forEach.call(doc.querySelectorAll(".admin-nav-link"), function (b) {
      b.classList.remove("is-active");
    });
    businessSay("businessOutcomeStatus", "");
    businessSay("businessNoteStatus", "");
    el("businessDetail").innerHTML = '<p class="admin-loading">Loading…</p>';
    el("businessNudge").hidden = true;
    businessSay("businessNudgeStatus", "");
    el("businessDisclosure").hidden = true;
    el("businessDiscloseCopy").hidden = true;
    businessSay("businessDiscloseStatus", "");
    authFetch("/api/admin/outreach/" + encodeURIComponent(id))
      .then(okJson)
      .then(function (d) { renderBusiness(d.business, d.notes || []); })
      .catch(function () {
        el("businessDetail").innerHTML = '<p class="admin-empty">Could not load that business.</p>';
      });
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
      .then(okJson)
      .then(function (d) {
        var rows = d.results || [];
        el("tickerTable").innerHTML = tickerTable(rows, canWrite);
        var showing = rows.filter(function (r) { return r.active; }).length;
        el("tickerCount").textContent = rows.length + " total · " + showing + " showing";
      })
      .catch(function () {
        el("tickerTable").innerHTML = '<p class="admin-empty">Could not load supporters.</p>';
        el("tickerCount").textContent = "";
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
      .then(okJson)
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

  // ---- Admin > Fundraising (TASK-495) ----
  // Community fundraising, stage 1 (docs/superpowers/specs/2026-10-02-community-fundraising-design.md).
  // Everyone who signed up at /fundraise, and one sign up opening below its row with everything
  // staff need: approve or decline it, change its details, check a change the organiser asked for,
  // record cash paid in, and hide a message on the supporter wall. Built against the core's admin
  // API (README, "Community fundraising (TASK-493)"); the server is the real gate on every route.
  // Every stored string is escaped on the way in. Nothing scrolls inside a box: the list shows 25,
  // the wall and History 10, and "Show all" grows the page.
  // The categories as they start (src/fundraising/categories.ts), for when the list from the server
  // (frCats, GET /api/admin/fundraising/categories) has not come: A to Z, Other last, then
  // the old "this or that" ones, no longer offered, so an old sign up's still has its name.
  var FR_KINDS = [
    ["bake_sale_2", "Bake sale"], ["birthday", "Birthday"], ["coffee_morning", "Coffee morning"], ["party", "Party"],
    ["quiz", "Quiz"], ["run", "Run"], ["santa_dash", "Santa dash"], ["school_collection", "School collection"],
    ["walk", "Walk"], ["workplace_collection", "Workplace collection"], ["other", "Other"],
  ];
  var FR_OLD_KINDS = [
    ["run_walk", "Run or walk"], ["bake_sale", "Bake sale or coffee morning"], ["quiz_party", "Quiz or party"],
    ["collection", "Workplace or school collection"],
  ];
  var FR_STATUS = {
    new: { label: "New", cls: "is-new" },
    approved: { label: "Approved", cls: "admin-pill--active" },
    declined: { label: "Declined", cls: "admin-pill--cancelled" },
    finished: { label: "Finished", cls: "" },
  };
  // The fields an organiser can ask to change (EDITABLE_FIELDS in src/fundraising/model.ts), in order.
  // TASK-501: from their private area, the event details too.
  var FR_EDITABLE = [
    ["description", "Description"], ["targetPence", "Target"], ["eventDate", "Date"], ["startTime", "Start time"],
    ["venue", "Venue"], ["town", "Town"], ["socialLink", "Facebook or Instagram link"],
    // TASK-511 review: a sign up made since the form's second round changes these instead.
    ["instagram", "Instagram"], ["facebook", "Facebook"],
    ["cardLine", "Line for the front of the card"], ["endTime", "Finish time"], ["timeTbc", "Time still to be confirmed"],
    ["venueAddress", "Full address"], ["venuePostcode", "Venue postcode"], ["access", "Access"], ["price", "Price"],
    ["booking", "How people get in"], ["ticketUrl", "Ticket link"], ["ageLimit", "Age limit"], ["dressCode", "Dress code"],
    ["included", "What's included"],
  ];
  // TASK-499: the access ticks, stored in the events model's words, labelled as the events editor
  // labels them (ACCESS in src/events/model.ts, ACCESS_LABELS in src/fundraising/model.ts).
  var FR_ACCESS = [
    ["step free entry", "Step free entry"], ["accessible toilets", "Accessible toilets"],
    ["a hearing loop", "Hearing loop"], ["blue badge parking", "Blue badge parking"],
  ];
  // How people get in (BOOKING_LABELS in src/fundraising/model.ts).
  var FR_BOOKING = [
    ["away", "Tickets are sold on another website"], ["door", "Pay on the door, no booking needed"],
    ["free", "Free, just come along"], ["donations", "Free entry, donations welcome"],
    ["nbcc", "NBCC sells the tickets for me"], // event tickets
  ];
  var FR_LIST_FIRST = 25;
  var FR_WALL_FIRST = 10;
  var FR_HISTORY_FIRST = 10;

  var frData = null; // the last GET /api/admin/fundraisers
  var frSettings = null; // the last GET /api/admin/fundraising/settings
  var frFilter = ""; // "" is every status
  // The kind filter: "" is every kind, else raising, team, event or memory. Kept for the visit, in
  // the browser tab's own storage beside the session, so a refresh keeps it and signing out forgets it.
  var FR_KIND_KEY = "nbccAdminFrKind";
  var FR_KIND_NAMES = ["raising", "team", "event", "memory"];
  var frKind = "";
  try {
    frKind = sessionStorage.getItem(FR_KIND_KEY) || "";
  } catch {
    frKind = "";
  }
  if (FR_KIND_NAMES.indexOf(frKind) === -1) frKind = "";
  function frSetKind(kind) {
    frKind = FR_KIND_NAMES.indexOf(kind) === -1 ? "" : kind;
    try {
      if (frKind) sessionStorage.setItem(FR_KIND_KEY, frKind);
      else sessionStorage.removeItem(FR_KIND_KEY);
    } catch {
      // Private mode: it lasts until the page is refreshed.
    }
  }
  function frKindReset() {
    frSetKind("");
  }
  // What kind of sign up it is, from what the list already says about it: a page in memory of
  // someone; a team, or a member's own page while they are on one; an event; else raising money.
  // In memory comes first, as it changes how everything about the page is worded.
  function frKindOf(f) {
    if (f.inMemory) return "memory";
    if (f.isTeam || (f.teamId && !f.teamLeftAt)) return "team";
    return f.path === "event" ? "event" : "raising";
  }
  // The large pill on each row. The words are always on it (the invite types' own), so the colour
  // is never the only thing saying which kind it is.
  function frKindPill(f) {
    var kind = frKindOf(f);
    return '<span class="fr-kind" data-kind="' + kind + '">' + H.escapeHtml(FR_INVITE_TYPES[kind].label) + "</span>";
  }
  var frOpenId = null; // the sign up open below its row
  var frDetail = null; // GET /api/admin/fundraisers/:id for the open one
  var frDetailFailed = false;
  var frHistoryRows = null; // null loading, false failed, else the rows
  var frScans = null; // TASK-512: GET /api/admin/fundraisers/:id/scans; null loading, false failed
  var frMore = {}; // list, wall, history -> showing everything
  var frNotice = {}; // detail, edit, cash, photo -> { msg, error }: said once after an action
  var frEditDraft = null; // the edit form's boxes someone typed in (name -> value), so a redraw keeps them
  var frEditErrors = {};
  var frCashDraft = null;
  var frCashErrors = {};
  var frReasonDraft = "";
  var frWired = false;
  var frBusy = false; // a change is on its way: a second press waits rather than sending it twice
  // TASK-503: the team's tools (src/routes/admin-fundraising-team.ts): the calls and the "Take off
  // Get involved?" prompts for each fundraiser, the invites not taken up, and who can sign one.
  var frTeam = null; // GET /api/admin/fundraising/team: { today, me, calls, prompts, invites, signers }
  var frTeamState = "loading"; // loading, failed or ok
  var frTeamBusy = false; // an invite is on its way
  var frSummaryData = null; // GET /api/admin/fundraising/summary (admins only)
  var frCallDraft = ""; // the note typed for a call, kept across a redraw
  // The same rule the server checks addresses by (zod's), as the ticket report's card has it.
  var FR_EMAIL = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$/i;
  var FR_CALL_WORDS = { before: "The call a week before", after: "The call a week after" };
  // TASK-505: the Requests part of each sign up (src/routes/admin-fundraising-requests.ts).
  var frReq = null; // GET /api/admin/fundraising/requests: { today, requests, toDo, notBack, totals }
  var frReqState = "loading"; // loading, failed or ok
  var frReqForm = null; // { kind, action }: the one small form open, if any
  var frReqDraft = {}; // what was typed in it, so a redraw keeps it
  var frReqErrors = {}; // the server's words for a box in it

  function frCanWrite() {
    return canEdit("fundraising");
  }
  function frMoney(pence) {
    return H.formatPence(Number(pence) || 0);
  }
  // 25000 -> "250", 30050 -> "300.50", for a box that takes pounds.
  function frPounds(pence) {
    if (pence === null || pence === undefined || pence === "") return "";
    var n = Number(pence);
    return n % 100 === 0 ? String(n / 100) : (n / 100).toFixed(2);
  }
  // "12.50", "£1,250", "1,250.50" or "250" -> pence; "" -> null; anything else -> NaN. A comma only
  // counts between thousands: "12,50" is how some write twelve pounds fifty, and reading it as
  // £1,250 would put a hundred times the money on the meter.
  function frParsePounds(value) {
    var s = String(value || "").replace(/[£\s]/g, "");
    if (s === "") return null;
    if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(s)) s = s.replace(/,/g, "");
    if (!/^\d+(\.\d{1,2})?$/.test(s)) return NaN;
    return Math.round(parseFloat(s) * 100);
  }
  // What to say when frParsePounds could not read it; example is whole pounds, like "12".
  function frPoundsMessage(value, example) {
    return /,\d{1,2}$/.test(String(value || "").trim())
      ? "Use a full stop for the pence, like " + example + ".50."
      : "Give the amount in pounds, like " + example + ".50.";
  }
  function frWho(actor) {
    var a = String(actor || "");
    if (a.indexOf("admin:") === 0) return a.slice(6);
    if (a === "public") return "the sign up form";
    if (a === "organiser" || a.indexOf("organiser:") === 0) return "the organiser"; // TASK-512: "organiser:<email>"
    if (a === "stripe") return "a gift by card";
    return a || "unknown";
  }
  function frIsWebLink(v) {
    return typeof v === "string" && /^https?:\/\/[^\s]+$/i.test(v);
  }
  function frNone(words) {
    return '<span class="fx-none">' + H.escapeHtml(words) + "</span>";
  }
  function frStatusPill(status) {
    var s = FR_STATUS[status] || { label: String(status || ""), cls: "" };
    return '<span class="admin-pill fr-status' + (s.cls ? " " + s.cls : "") + '">' + H.escapeHtml(s.label) + "</span>";
  }
  function frPathWords(path) {
    return path === "event" ? "Hosting an event" : "Raising money";
  }
  // A message belongs to the sign up it is about (id), and only shows while that one is open.
  function frSay(key, msg, error, id) {
    frNotice[key] = { msg: msg, error: !!error, id: id === undefined ? frOpenId : id };
  }
  function frNoticeFor(key) {
    var n = frNotice[key];
    return n && n.id === frOpenId ? n : { msg: "", error: false };
  }
  var FR_NOTICE_IDS = {
    detail: "frDetailStatus", edit: "frEditStatus", cash: "frCashStatus", photo: "frPhotoStatus",
    // TASK-503
    call: "frCallStatus", list: "frListStatus",
    split: "frSplitStatus", // Jaimie, 2026-10-03
    // TASK-505
    req: "frReqStatus",
    // TASK-506
    news: "frNewsStatus",
    pics: "frPicsStatus", // profile pictures
    thanks: "frThanksStatus", // TASK-507
    touch: "frTouchCallStatus", // TASK-515
    group: "frTeamStatus", // team pages
    memory: "frMemoryStatus", // In memory
    pack: "frPackStatus", // welcome packs
  };
  // Says it now, in place, without a redraw: "Adding…" has to show while the request is out.
  function frPaintNotice(key) {
    var line = el(FR_NOTICE_IDS[key]);
    if (!line) return;
    var n = frNoticeFor(key);
    line.textContent = n.msg;
    line.className = "ty-status fr-status-line" + (n.error ? " is-error" : n.msg ? " is-ok" : "");
  }
  function frNoticeHtml(key, id) {
    var n = frNoticeFor(key);
    return '<p class="ty-status fr-status-line' + (n.error ? " is-error" : n.msg ? " is-ok" : "") + '" id="' + id +
      '" role="status" aria-live="polite">' + H.escapeHtml(n.msg) + "</p>";
  }
  function frMoreButton(key, shown, total) {
    if (frMore[key] || total <= shown) return "";
    return '<button class="fr-more" type="button" data-frmore="' + key + '" aria-expanded="false">Show all ' + total + "</button>";
  }

  // ---- loading ----
  // Sign ups: the list, the open sign up, and everything a row or an open sign up says or asks.
  // The other sections' own cards load when they are shown (giLoad).
  function loadFundraising() {
    frWire();
    frLoadSettings(); // approving a page asks differently while fundraising is switched off
    frLoadList();
    if (frOpenId != null) frLoadDetail(frOpenId);
    // TASK-503: the calls due and the prompts on the list. Each loads on its own, so the rest of
    // the screen never waits on it.
    frLoadTeam();
    frLoadCategories(); // the sign up editor's list
    // TASK-505: the requests, likewise on their own.
    frLoadRequests();
    frLoadNewsCounts(); // TASK-506
    frLoadPicsCounts(); // profile pictures
    frLoadThanksCounts(); // TASK-507
    frTouchLoad(); // TASK-515
    frMemoryLoadCounts(); // In memory
    frLoadPacks(); // welcome packs
  }
  // Emails: Invite someone with the invites not taken up, and the Automatic emails card. The All
  // emails card counts what is waiting by itself when its part is shown (all-emails.js).
  function frLoadEmailsSection() {
    frWire();
    // All emails offers the real fundraisers under "Show it for" (AdminFundraising.raisingPages).
    // Arriving here first, after a refresh, Sign ups has not loaded them, so they are asked for now.
    if (!frData) frLoadList();
    frRenderInvitePanel();
    frLoadTeam();
    frTouchLoad(); // TASK-515
  }
  // Settings: the Fundraising switch, Categories, What gifts could do and the Weekly summary.
  function frLoadSettingsSection() {
    frWire();
    frLoadSettings();
    frLoadCategories();
    frLoadImpact();
    frLoadSummary();
  }

  function frLoadSettings() {
    return authFetch("/api/admin/fundraising/settings")
      .then(okJson)
      .then(function (s) {
        frSettings = s;
        frRenderSwitch();
      })
      .catch(function (err) {
        if (err && err.message === "unauthorized") return;
        frSettings = null;
        el("frSwitch").classList.remove("is-on");
        el("frSwitchState").textContent = "Could not check whether fundraising is on. Try again in a moment.";
        el("frSwitchWho").textContent = "";
        el("frSwitchBtn").hidden = true;
        el("frSwitchNote").hidden = true;
      });
  }

  function frLoadList() {
    return authFetch("/api/admin/fundraisers")
      .then(okJson)
      .then(function (d) {
        frData = d;
        frRenderList();
        // All emails fills "Show it for" from this list: tell it, in case an email is already open.
        var view = el("view-fundraising");
        if (view && window.CustomEvent) view.dispatchEvent(new window.CustomEvent("nbcc:fundraisers-loaded"));
      })
      .catch(function (err) {
        if (err && err.message === "unauthorized") return;
        frData = null;
        frRenderCounts([]);
        el("frList").innerHTML = '<div role="alert">' +
          unavailableHtml("The sign ups could not load just now. Try again in a moment.") + "</div>";
      });
  }

  function frLoadDetail(id) {
    return authFetch("/api/admin/fundraisers/" + encodeURIComponent(id))
      .then(okJson)
      .then(function (d) {
        if (frOpenId !== id) return;
        frDetail = d;
        frDetailFailed = false;
        frRenderList();
        frLoadHistory(id);
        frLoadNews(id); // TASK-506
        frLoadPics(id); // profile pictures
        if (d && d.fundraiser && (d.fundraiser.isTeam || d.fundraiser.teamId)) frLoadGroup(id); // team pages
        if (d && d.fundraiser && (d.fundraiser.status === "approved" || d.fundraiser.status === "finished")) frLoadScans(id); // TASK-512
      })
      .catch(function (err) {
        if (err && err.message === "unauthorized") return;
        if (frOpenId !== id) return;
        frDetail = null;
        frDetailFailed = true;
        frRenderList();
      });
  }

  // TASK-512: how many times each printed piece's own QR code was scanned (the site's visit counter
  // counts them; src/fundraising/material-codes.ts). Best effort: the rest of the detail never waits.
  function frLoadScans(id) {
    return authFetch("/api/admin/fundraisers/" + encodeURIComponent(id) + "/scans")
      .then(okJson)
      .then(function (d) {
        if (frOpenId !== id) return;
        frScans = d && Array.isArray(d.scans) ? d.scans : false;
        frPaintScans();
      })
      .catch(function (err) {
        if (err && err.message === "unauthorized") return;
        if (frOpenId !== id) return;
        frScans = false;
        frPaintScans();
      });
  }

  function frPaintScans() {
    var box = el("frScans");
    if (!box) return;
    if (frScans === null) {
      box.innerHTML = '<span class="admin-loading">Loading…</span>';
      return;
    }
    if (frScans === false) {
      box.innerHTML = '<span class="fx-empty">The scans could not load just now.</span>';
      return;
    }
    box.innerHTML = '<ul class="fr-scans">' + frScans.map(function (s) {
      var n = Number(s.scans) || 0;
      var words = n === 0 ? "none yet" : n === 1 ? "1 scan" : n + " scans";
      return "<li>" + H.escapeHtml(String(s.label || "") + ": " + words) + "</li>";
    }).join("") + "</ul>";
  }

  function frLoadHistory(id) {
    return authFetch("/api/admin/fundraisers/" + encodeURIComponent(id) + "/history")
      .then(okJson)
      .then(function (d) {
        if (frOpenId !== id) return;
        frHistoryRows = (d && d.history) || [];
        frPaintHistory();
      })
      .catch(function (err) {
        if (err && err.message === "unauthorized") return;
        if (frOpenId !== id) return;
        frHistoryRows = false;
        frPaintHistory();
      });
  }

  // After a change: the list (status, pills, the raised column) and the open sign up, afresh.
  // TASK-503: and the team's tools, whose calls and prompts the list shows.
  function frReload() {
    var id = frOpenId;
    return Promise.all([frLoadList(), id != null ? frLoadDetail(id) : null, frLoadTeam(), frLoadNewsCounts(), frLoadPicsCounts(), frLoadRequests(), frLoadPacks()]); // welcome packs: a new T-shirt size changes one
  }

  // ---- the switch ----
  function frRenderSwitch() {
    var on = !!(frSettings && frSettings.pageOn);
    el("frSwitch").classList.toggle("is-on", on);
    el("frSwitchState").innerHTML = on
      ? "<b>Yes.</b> Sign ups are open and approved fundraisers are live."
      : "<b>No.</b> Sign ups are closed and nothing is on the website.";
    var by = frSettings && frSettings.updatedBy && String(frSettings.updatedBy).indexOf("admin:") === 0
      ? String(frSettings.updatedBy).slice(6) : "";
    el("frSwitchWho").textContent = by
      ? "Last " + (on ? "switched on" : "switched off") + " by " + by + " on " + H.fmtDate(frSettings.updatedAt) + "."
      : "";
    var mayFlip = isAdmin() && frCanWrite();
    var btn = el("frSwitchBtn");
    btn.hidden = !mayFlip;
    el("frSwitchNote").hidden = mayFlip;
    btn.textContent = on ? "Switch off" : "Switch on";
    btn.setAttribute("aria-label", on ? "Switch fundraising off" : "Switch fundraising on");
    btn.className = on ? "btn btn-ghost fr-switch-btn" : "btn btn-primary fr-switch-btn";
  }

  function frFlipSwitch() {
    var on = !!(frSettings && frSettings.pageOn);
    if (on) return frConfirmFlip(on, null);
    // TASK-497: switching on emails "Your page is live" to every page holder approved while it was
    // off. Approvals made since the screen opened add to that list, so ask the server how many are
    // waiting now, as the switch is pressed. If it cannot say, the question still goes, without a number.
    authFetch("/api/admin/fundraising/settings")
      .then(okJson)
      .then(function (s) {
        return s && typeof s.liveEmailsWaiting === "number" ? s.liveEmailsWaiting : null;
      })
      .catch(function () {
        return null;
      })
      .then(function (waitingCount) {
        frConfirmFlip(on, waitingCount);
      });
  }

  function frConfirmFlip(on, waitingCount) {
    var liveNote = waitingCount === null
      ? " “Your page is live” goes by email to everyone approved while it was off."
      : waitingCount > 0
        ? " “Your page is live” goes by email to the " + waitingCount + (waitingCount === 1 ? " fundraiser" : " fundraisers") + " approved while it was off."
        : "";
    var question = on
      ? "Switch fundraising off? The form stops taking sign ups, and every fundraiser comes off the website straight away."
      : "Switch fundraising on? The Fundraise for us form opens, and every approved public fundraiser goes on the website straight away." + liveNote;
    if (!window.confirm(question)) return;
    var btn = el("frSwitchBtn");
    var status = el("frSwitchStatus");
    btn.disabled = true;
    status.className = "ty-status";
    status.textContent = on ? "Switching off…" : "Switching on…";
    authFetch("/api/admin/fundraising/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pageOn: !on }),
    })
      .then(okJsonOrSaid)
      .then(function (s) {
        btn.disabled = false;
        frSettings = s;
        frRenderSwitch();
        status.className = "ty-status is-ok";
        status.textContent = s.pageOn ? "Fundraising is now on." : "Fundraising is now off.";
      })
      .catch(function (err) {
        btn.disabled = false;
        if (err && err.message === "unauthorized") return;
        status.className = "ty-status is-error";
        status.textContent = (err && err.said) || "That did not work. Please try again.";
      });
  }

  // ---- the list ----
  function frRenderCounts(list) {
    var counts = { all: list.length, new: 0, approved: 0, declined: 0, finished: 0 };
    list.forEach(function (f) {
      if (counts[f.status] !== undefined) counts[f.status] += 1;
    });
    Object.keys(counts).forEach(function (k) {
      var c = doc.querySelector('[data-frcount="' + k + '"]');
      if (c) c.textContent = counts[k];
    });
    // TASK-503: how many have a call due today.
    var calls = doc.querySelector('[data-frcount="calls"]');
    if (calls) calls.textContent = list.filter(frCallDue).length;
    // TASK-505: how many have requests to do, and how many have buckets or tins out.
    var toDo = doc.querySelector('[data-frcount="requests"]');
    if (toDo) toDo.textContent = list.filter(frReqToDo).length;
    var notBack = doc.querySelector('[data-frcount="notback"]');
    if (notBack) notBack.textContent = list.filter(frReqNotBack).length;
    var packs = doc.querySelector('[data-frcount="packs"]'); // welcome packs
    if (packs) packs.textContent = list.filter(frPackToSend).length;
    // How many of each kind, of every sign up, whichever filters are pressed.
    var kinds = { all: list.length, raising: 0, team: 0, event: 0, memory: 0 };
    list.forEach(function (f) {
      kinds[frKindOf(f)] += 1;
    });
    Object.keys(kinds).forEach(function (k) {
      var c = doc.querySelector('[data-frkindcount="' + k + '"]');
      if (c) c.textContent = kinds[k];
    });
  }

  function frRaisedCell(f) {
    var m = f.meter || {};
    var raised = frMoney(m.raisedPence);
    if (m.targetPence) {
      return '<span class="fr-raised">' + raised + " of " + frMoney(m.targetPence) + "</span>" +
        '<span class="fr-pct">' + (m.percent === null || m.percent === undefined ? 0 : m.percent) + "%</span>";
    }
    return '<span class="fr-raised">' + raised + " raised</span>";
  }

  function frSummaryRow(f) {
    var open = frOpenId === f.id;
    // No kind here: the large pill above the title says it, in the same words as the filter.
    var sub = [f.name, f.eventDate ? H.fmtDate(f.eventDate) : "No date"];
    var pills = (f.editWaiting ? '<span class="admin-pill admin-pill--pending fr-changes-pill">Changes to check</span>' : "") +
      // TASK-506: news updates the organiser posted, waiting for staff.
      frNewsPill(f) +
      frPicsPill(f) + // profile pictures: photos the organiser sent, waiting for staff
      // TASK-501: the organiser pressed "I've finished" in their private area (it finishes nothing).
      (f.finishedRequestedAt && f.status === "approved" ? '<span class="admin-pill admin-pill--pending fr-finished-pill">Says they\'ve finished</span>' : "") +
      // TASK-503: a call due, as Business supporters show it; and the finishing prompt.
      (frCallDue(f) ? '<span class="admin-pill is-call-due fx-call-pill">Time to call</span>' : "") +
      (frPrompt(f) ? '<span class="admin-pill admin-pill--pending fr-offlist-pill">Take off Get involved?</span>' : "") +
      (f.offListAt && f.status === "approved" ? '<span class="admin-pill fr-offlist-done">Off Get involved</span>' : "") +
      // TASK-505: something they asked for still to send or do; buckets or tins due back.
      (frReqToDo(f) ? '<span class="admin-pill admin-pill--pending fr-requests-pill">Requests to do</span>' : "") +
      (frReqDueBack(f) ? '<span class="admin-pill is-call-due fr-dueback-pill">Due back</span>' : "") +
      frPackPill(f) + // welcome packs
      frThanksPill(f) + // TASK-507
      frMemoryPills(f) + // In memory
      frTouchPills(f) + // TASK-515: the smart call prompts
      frGroupPills(f) + // team pages: Team, or Joining <team>
      rowNewPill("fundraising", f.createdAt);
    return (
      '<tr class="fx-summary' + (open ? " is-open" : "") + '" data-frtoggle="' + f.id +
      '" tabindex="0" role="button" aria-expanded="' + (open ? "true" : "false") + '">' +
        "<td>" + frKindPill(f) + '<span class="fx-caret" aria-hidden="true"></span><span class="fr-title">' + H.escapeHtml(f.title) + "</span>" +
          '<span class="fr-sub">' + sub.map(function (s) { return H.escapeHtml(s); }).join(" · ") + "</span>" +
          (pills ? '<span class="fr-pills">' + pills + "</span>" : "") + "</td>" +
        "<td>" + frStatusPill(f.status) + "</td>" +
        '<td class="fr-money">' + frRaisedCell(f) + "</td>" +
      "</tr>" +
      (open ? '<tr class="fx-detail-row"><td colspan="3">' + frDetailHtml(f) + "</td></tr>" : "")
    );
  }

  // Every change redraws the list, which used to drop keyboard focus to the top of the page. Where
  // focus was is remembered by the element's id or its data-fr* mark, and put back after the redraw;
  // if that control has gone (Approve, once approved), focus goes to the open sign up's row.
  var frFocusKey = null;
  function frRememberFocus(wrap) {
    var active = doc.activeElement;
    if (active && wrap.contains(active)) {
      frFocusKey = { sel: null };
      if (active.id) frFocusKey.sel = "#" + active.id;
      else {
        for (var i = 0; i < active.attributes.length; i++) {
          var a = active.attributes[i];
          if (a.name.indexOf("data-fr") === 0) {
            frFocusKey.sel = "[" + a.name + '="' + String(a.value).replace(/"/g, "") + '"]';
            break;
          }
        }
      }
    } else if (active && active !== doc.body) {
      frFocusKey = null; // focus moved somewhere else on purpose: leave it there
    }
  }
  function frRestoreFocus(wrap) {
    if (!frFocusKey) return;
    var target = (frFocusKey.sel && wrap.querySelector(frFocusKey.sel)) ||
      (frOpenId != null ? wrap.querySelector('[data-frtoggle="' + frOpenId + '"]') : null);
    if (target && target.focus) target.focus({ preventScroll: true });
  }

  function frRenderList() {
    var wrap = el("frList");
    if (!wrap || !frData) return;
    frRememberFocus(wrap);
    var all = frData.fundraisers || [];
    frRenderCounts(all);
    Array.prototype.forEach.call(doc.querySelectorAll("[data-frfilter]"), function (b) {
      var on = b.getAttribute("data-frfilter") === frFilter;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    Array.prototype.forEach.call(doc.querySelectorAll("[data-frkind]"), function (b) {
      var on = b.getAttribute("data-frkind") === frKind;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    if (!all.length) {
      wrap.innerHTML = '<p class="fx-empty fr-empty">Nobody has signed up yet. Sign ups from the Fundraise for us form arrive here, with a New pill.</p>';
      return;
    }
    var rows = all.filter(function (f) {
      if (frKind && frKindOf(f) !== frKind) return false; // the kind filter, alongside the one below
      if (!frFilter) return true;
      if (frFilter === "calls") return frCallDue(f);
      // TASK-505
      if (frFilter === "requests") return frReqToDo(f);
      if (frFilter === "notback") return frReqNotBack(f);
      if (frFilter === "packs") return frPackToSend(f); // welcome packs
      return f.status === frFilter;
    });
    if (!rows.length) {
      var none = {
        new: "No new sign ups are waiting.", approved: "None approved yet.", declined: "None declined.", finished: "None finished yet.",
        calls: "No calls due.", requests: "No requests to do.", notback: "No buckets or tins are out.", packs: "No packs to send.",
      };
      // With a kind chosen as well, the status filter's own words could be untrue of the whole list.
      wrap.innerHTML = '<p class="fx-empty fr-empty">' + H.escapeHtml((!frKind && none[frFilter]) || "None here.") + "</p>";
      return;
    }
    var openAt = -1;
    rows.forEach(function (f, i) { if (f.id === frOpenId) openAt = i; });
    var showAll = frMore.list || openAt >= FR_LIST_FIRST;
    var shown = showAll ? rows : rows.slice(0, FR_LIST_FIRST);
    wrap.innerHTML =
      '<p class="fx-hint">Select a sign up to see everything they told us, approve it and look after its page.</p>' +
      '<table class="admin-table fx-table fr-table"><thead><tr><th>Sign up</th><th>Status</th><th>Raised</th></tr></thead><tbody>' +
      shown.map(frSummaryRow).join("") + "</tbody></table>" +
      (showAll ? "" : '<div class="fr-more-row">' + frMoreButton("list", FR_LIST_FIRST, rows.length) + "</div>");
    nlFitBoxes(Array.prototype.slice.call(wrap.querySelectorAll("textarea.fr-input")));
    frPaintThanks(); // TASK-507
    frPaintHistory();
    frPaintNews(); // TASK-506
    frPaintPics(); // profile pictures
    frPaintGroup(); // team pages
    frPaintScans(); // TASK-512
    frRestDetail();
    frRestoreFocus(wrap);
  }

  function frToggle(id) {
    var n = Number(id);
    frOpenId = frOpenId === n ? null : n;
    frDetail = null;
    frDetailFailed = false;
    frHistoryRows = null;
    frScans = null;
    frMore = { list: frMore.list };
    frNotice = {};
    frEditDraft = null;
    frEditErrors = {};
    frCashDraft = null;
    frCashErrors = {};
    frReasonDraft = "";
    frCallDraft = "";
    frTouchNotes = {}; // TASK-515
    frGroupView = null; // team pages
    frGroupDraft = {};
    frReqClear();
    frPackClear(); // welcome packs
    frRenderList();
    if (frOpenId != null) frLoadDetail(frOpenId);
  }

  // ---- one sign up ----
  function frDetailHtml(listRow) {
    if (frDetailFailed) {
      return '<div class="fr-detail-msg" data-frdetail="' + listRow.id + '" role="alert">' +
        unavailableHtml("This sign up could not load just now. Close it and open it again in a moment.") + "</div>";
    }
    if (!frDetail || !frDetail.fundraiser || frDetail.fundraiser.id !== listRow.id) {
      return '<div class="fr-detail-msg" data-frdetail="' + listRow.id + '"><p class="admin-loading">Loading…</p></div>';
    }
    var f = frDetail.fundraiser;
    var write = frCanWrite();
    return (
      '<div class="fx-detail fr-detail" data-frdetail="' + f.id + '">' +
        '<section class="fx-panel fx-panel--wide"><h4>Where it is up to</h4>' + frStatePanel(f, write) + "</section>" +
        frGroupSection(f) + // team pages
        frMemorySection(f, write) + // In memory
        frOffListSection(f, write) +
        frCallsSection(f, write) +
        frTouchSection(f, write) + // TASK-515
        (frDetail.waitingEdit ? '<section class="fx-panel fx-panel--wide fr-change-panel"><h4>Changes to check</h4>' + frChangePanel(f, frDetail.waitingEdit, write) + "</section>" : "") +
        frRequestsSection(f, write) +
        frPackSection(f, write) + // welcome packs
        frNewsSection() + // TASK-506
        frPicsSection() + // profile pictures
        frThanksSection() + // TASK-507
        '<section class="fx-panel"><h4>What they told us</h4>' + frAboutPanel(f) + "</section>" +
        frSplitSection(f) +
        frWelcomeSection(f, write) + // the sign up tidy
        '<section class="fx-panel"><h4>The organiser</h4>' + frContactPanel(f) + "</section>" +
        '<section class="fx-panel"><h4>What they would like</h4>' + frWantsPanel(f) + "</section>" +
        '<section class="fx-panel"><h4>Photo for its page</h4>' + frPhotoPanel(f, write) + "</section>" +
        '<section class="fx-panel"><h4>Money raised</h4>' + frMeterHtml(frDetail.meter) + "</section>" +
        '<section class="fx-panel"><h4>Cash paid in</h4>' + frCashPanel(frDetail.cash || [], write) + "</section>" +
        (write ? '<section class="fx-panel fx-panel--wide"><h4>Change the details</h4>' + frEditForm(f) + "</section>" : "") +
        '<section class="fx-panel fx-panel--wide"><h4>Supporter wall</h4>' + frWallPanel(frDetail.wall || [], write) + "</section>" +
        '<section class="fx-panel fx-panel--wide"><h4>History</h4><div class="fx-history" id="frHistory"></div></section>' +
      "</div>"
    );
  }

  function frStateWords(f) {
    if (f.status === "new") return "New: waiting for you to approve or decline it. Nothing about it is public until it is approved.";
    if (f.status === "declined") return "Declined. Nothing about it is public.";
    if (f.status === "finished") return "Finished. It is off the Get involved list, but its page stays up with a thank you banner and can still take gifts. To take the page down, make it not public.";
    // TASK-503: still approved, but taken off the Get involved list by staff (off_list_at); a page
    // stays up and takes gifts, as a finished one does.
    if (f.offListAt && f.public) {
      // Event pages: an event's page stays up too.
      return (f.offListBy === "organiser" ? "Approved, and not on the Get involved list, as they asked." : "Approved, and taken off the Get involved list.") +
        (f.path === "raising" || f.path === "event" ? " Its page stays up and can still take gifts." : "");
    }
    if (!f.public) return "Approved. They only wanted to let us know, or wanted materials, so it is not on the website.";
    // Event pages: an approved public event has its own page as well as its card.
    if (f.path === "event") return "Approved. Its page is on the website, and it is listed on Get involved as an event, while fundraising is switched on.";
    return "Approved. Its page is on the website while fundraising is switched on.";
  }

  // Event pages: where its page is, or would be: /event/<short name> for an event, /fundraise/<slug>
  // for raising money. The server says (pagePath); worked out the same way if it does not.
  function frPagePath(f) {
    return f.pagePath || (f.path === "event" ? "/event/" : "/fundraise/") + encodeURIComponent(f.slug || "");
  }

  // Event pages: an event cannot be approved until staff have set its short name.
  function frNeedsShortName(f) {
    return f.path === "event" && !f.slugSetAt;
  }

  // Event pages: keep the suggested short name, which is what lets the event be approved.
  function frUseShortName() {
    if (frBusy) return;
    var f = frOpenRecord();
    if (!f) return;
    frRun("detail", "Saving…", function (run) {
      return frSend("PATCH", "/api/admin/fundraisers/" + f.id, { slug: f.slug }).then(function (r) {
        if (!r.ok) {
          run.say(frRefusal(r, "That did not work. Please try again."), true);
          return frReload();
        }
        run.say("Short name saved. You can approve it now.", false);
        return frReload();
      });
    });
  }

  function frStatePanel(f, write) {
    var rows = "";
    if (f.approvedAt) rows += fulfilRow("Approved", H.escapeHtml(H.fmtDate(f.approvedAt) + (f.approvedBy ? " by " + frWho(f.approvedBy) : "")));
    if (f.finishedRequestedAt && f.status === "approved") {
      rows += fulfilRow("Says they've finished", H.escapeHtml(H.fmtDate(f.finishedRequestedAt)) +
        '<span class="fr-field-hint">They pressed I\'ve finished in their private area. Give them a ring, then Mark finished when everything is in.</span>');
    }
    if (f.status === "declined" && f.declinedReason) {
      rows += fulfilRow("Why it was declined", '<span class="fx-address">' + H.escapeHtml(f.declinedReason) + "</span>" +
        '<span class="fr-field-hint">Kept inside NBCC, never shown to them.</span>');
    }
    var page;
    // Event pages: an event's page and QR codes are at /event/<short name> (the server's pagePath).
    var pageBase = frPagePath(f);
    if (f.pageUrl && frIsWebLink(f.pageUrl)) {
      page = '<a class="fx-tel" id="frPageLink" href="' + H.escapeHtml(f.pageUrl) + '" target="_blank" rel="noopener noreferrer">' +
        H.escapeHtml(f.pageUrl) + "</a>" +
        // TASK-501: the QR code itself, now it is no longer on the public page.
        '<img class="fr-qr-preview" src="' + H.escapeHtml(pageBase) + '/qr.svg" alt="' +
        H.escapeHtml("QR code for " + f.title) + '" width="120" height="120" loading="lazy" />' +
        '<a class="fr-qr-link" id="frQrLink" href="' + H.escapeHtml(pageBase) + '/qr.svg" download="' +
        H.escapeHtml("qr-" + f.slug + ".svg") + '">Download its QR code</a>' +
        // TASK-504: the same code as a print size PNG.
        '<a class="fr-qr-link" id="frQrPngLink" href="' + H.escapeHtml(pageBase) + '/qr.png" download="' +
        H.escapeHtml("qr-" + f.slug + ".png") + '">Print size PNG</a>' +
        // The code on one A4 page, with the name, the address and the charity statement (frOpenMaterial).
        (f.status === "approved" || f.status === "finished"
          ? '<button class="admin-btn admin-btn--small fr-btn-quiet" type="button" data-frmaterial="qr-code">Print the QR code</button>'
          : "");
    } else {
      page = frNone("No page on the website.");
    }
    rows += fulfilRow("Its page", page);
    // TASK-504: its materials, made from the approved details, once it is approved. Each opens in
    // its own tab (frOpenMaterial). The certificate is the organiser's once finished; before then
    // staff can preview it.
    if (f.status === "approved" || f.status === "finished") {
      // TASK-512: the A3 poster and the A5 leaflet, and Download everything first: every printed
      // piece on one page to print or save as one PDF, with every picture as a zip.
      var mats = [["poster", "Poster, A4"], ["poster-a3", "Poster, A3"], ["leaflet", "Leaflet, A5"], ["social", "Pictures to share"],
        ["sponsor-form", "Sponsor form"], ["certificate", f.status === "finished" ? "Certificate of thanks" : "Certificate (preview)"]]
        // In memory: no certificate of thanks.
        .filter(function (m) { return !(f.inMemory && m[0] === "certificate"); });
      rows += fulfilRow("Materials", '<span class="fr-materials-admin">' +
        '<button class="admin-btn admin-btn--small" type="button" data-frmaterial="everything">Download everything</button>' +
        mats.map(function (m) {
          return '<button class="admin-btn admin-btn--small fr-btn-quiet" type="button" data-frmaterial="' + m[0] + '">' + H.escapeHtml(m[1]) + "</button>";
        }).join("") + "</span>" +
        '<span class="fr-field-hint">Made from the approved details. Each opens in a new tab, ready to print. Download everything puts every printed piece on one page, to print or save as one PDF, with every picture to share as a zip.</span>');
      // TASK-512: each printed piece has its own QR code, so its scans are counted apart.
      rows += fulfilRow("QR code scans", '<div id="frScans" class="fr-scans-box"></div>' +
        '<span class="fr-field-hint">Each poster and leaflet has its own QR code. Counted once per person a day, by our visitor counter, so people who ask not to be counted are not.</span>');
    }
    var actions = "";
    if (write) {
      var buttons = "";
      var shortName = "";
      if ((f.status === "new" || f.status === "declined") && frNeedsShortName(f)) {
        // Event pages: an event's short name is its web address for good, so staff set it (or keep
        // the suggested one) before it can be approved. The server refuses it otherwise.
        shortName =
          '<div class="fr-decline" id="frShortName">' +
            '<p class="fx-help">Give this event a short name first, for its web address. It would be <span class="fx-mono">nbcc.scot' +
              H.escapeHtml(frPagePath(f)) + "</span>. Keep this one, or change it under Web address in Change the details.</p>" +
            '<div class="fx-call-row"><button class="admin-btn admin-btn--small" type="button" data-frshortname>Use this short name</button></div>' +
          "</div>";
      } else if (f.status === "new" || f.status === "declined") {
        buttons += '<button class="admin-btn admin-btn--small" type="button" data-fraction="approve">Approve</button>';
      }
      if (f.status === "approved") {
        buttons += '<button class="admin-btn admin-btn--small" type="button" data-fraction="finish">Mark finished</button>';
      }
      var decline = "";
      if (f.status === "new" || f.status === "approved") {
        decline =
          '<div class="fr-decline">' +
            '<label class="fx-call-label" for="frDeclineReason">Reason for declining (optional)</label>' +
            '<span class="fr-field-hint">Kept inside NBCC, never shown to them. They are not emailed.</span>' +
            '<textarea class="fx-call-input fr-input" id="frDeclineReason" rows="2" maxlength="500">' + H.escapeHtml(frReasonDraft) + "</textarea>" +
            '<div class="fx-call-row"><button class="admin-btn admin-btn--small fr-btn-quiet" type="button" data-fraction="decline">Decline</button></div>' +
          "</div>";
      }
      actions = shortName + (buttons ? '<div class="fx-call-row fr-actions">' + buttons + "</div>" : "") + decline;
    }
    return (
      '<p class="fx-letter"><span class="fx-state fx-state--' + (f.status === "new" ? "todo" : f.status === "approved" ? "done" : "waiting") + '">' +
        H.escapeHtml(frStateWords(f)) + "</span></p>" +
      '<dl class="fx-dl">' + rows + "</dl>" + actions + frNoticeHtml("detail", "frDetailStatus")
    );
  }

  function frShowValue(key, value) {
    // TASK-501: the event details an organiser can now ask to change, in words.
    if (key === "timeTbc") return value ? "Yes" : "No";
    if (key === "access") {
      var ticks = Array.isArray(value) ? value : [];
      return ticks.length ? H.escapeHtml(ticks.map(function (a) { return frLabelOf(FR_ACCESS, a) || a; }).join(", ")) : frNone("None ticked");
    }
    if (key === "booking" && value) return H.escapeHtml(frLabelOf(FR_BOOKING, value) || value);
    if (key === "endTime" && value) return H.escapeHtml(String(value).slice(0, 5));
    if (value === null || value === undefined || value === "") return frNone("Nothing");
    if (key === "targetPence") return H.escapeHtml(frMoney(value));
    if (key === "eventDate") return H.escapeHtml(H.fmtDate(value));
    if (key === "startTime") return H.escapeHtml(String(value).slice(0, 5));
    return '<span class="fx-address">' + H.escapeHtml(value) + "</span>";
  }

  function frChangePanel(f, edit, write) {
    var changes = edit.changes || {};
    var lines = FR_EDITABLE.filter(function (k) { return Object.prototype.hasOwnProperty.call(changes, k[0]); }).map(function (k) {
      return '<tr><th scope="row">' + H.escapeHtml(k[1]) + "</th>" +
        '<td data-label="Live now">' + frShowValue(k[0], f[k[0]]) + "</td>" +
        '<td data-label="Their change">' + frShowValue(k[0], changes[k[0]]) + "</td></tr>";
    });
    return (
      '<p class="fx-help">The organiser asked for this on ' + H.escapeHtml(H.fmtDate(edit.createdAt)) +
        ". The website keeps the live version until you approve it.</p>" +
      '<table class="admin-table fr-change" id="frChange"><thead><tr><th>What</th><th>Live now</th><th>Their change</th></tr></thead><tbody>' +
        lines.join("") + "</tbody></table>" +
      (write
        ? '<div class="fx-call-row fr-actions"><button class="admin-btn admin-btn--small" type="button" data-fredit="approve" data-freditid="' +
            Number(edit.id) + '">Approve change</button>' +
          '<button class="admin-btn admin-btn--small fr-btn-quiet" type="button" data-fredit="reject" data-freditid="' + Number(edit.id) +
            '">Reject change</button></div>'
        : "")
    );
  }

  function frAboutPanel(f) {
    var kind = f.kindLabel || frCatLabel(f.kind);
    // TASK-511: Other, in their words.
    if (f.kind === "other" && f.kindOther) kind += ": " + f.kindOther;
    var where = [f.venue, f.town].filter(Boolean).join(", ");
    return (
      '<dl class="fx-dl">' +
        fulfilRow("Name for it", H.escapeHtml(f.title)) +
        fulfilRow("They are", H.escapeHtml(frPathWords(f.path))) +
        fulfilRow("Category", H.escapeHtml(kind)) +
        fulfilRow("About it", f.description ? '<span class="fx-address">' + H.escapeHtml(f.description) + "</span>" : frNone("Nothing yet")) +
        // Jaimie, 2026-10-03: they ticked "Not decided yet" on the form.
        fulfilRow("Date", f.eventDate ? H.escapeHtml(H.fmtDate(f.eventDate)) : f.dateTbc ? "Date to be confirmed" : frNone("No date")) +
        fulfilRow("Start time", f.startTime ? H.escapeHtml(String(f.startTime).slice(0, 5)) : frNone("No time")) +
        fulfilRow("Where", where ? H.escapeHtml(where) : frNone("Not given")) +
        fulfilRow("Target", f.targetPence ? H.escapeHtml(frMoney(f.targetPence)) : frNone("No target")) +
        fulfilRow("On the NBCC website", frWebsiteWords(f)) +
        fulfilRow("Web address", '<span class="fx-mono">' + H.escapeHtml(frPagePath(f)) + "</span>") +
        fulfilRow("Signed up", H.escapeHtml(H.fmtDate(f.createdAt))) +
        frAgeAndSplitRows(f) +
        frTidyRows(f) + // the sign up tidy
        (f.path === "event" ? frEventRows(f) : "") +
      "</dl>"
    );
  }

  // Jaimie, 2026-10-03: 18 or over, and sharing with another cause. A sign up from before they were
  // asked has neither (null), and shows nothing.
  function frSplitWords(f) {
    if (f.sharesWithOther === true) {
      return "Yes: " + f.nbccSharePercent + "% to NBCC, the rest to " + (f.otherCauseName || "");
    }
    return "No, all of it comes to NBCC";
  }
  function frAgeAndSplitRows(f) {
    return (
      (f.over18 === true ? fulfilRow("18 or over", "Confirmed 18 or over") : "") +
      (f.sharesWithOther === true || f.sharesWithOther === false ? fulfilRow("Sharing with another cause", H.escapeHtml(frSplitWords(f))) : "")
    );
  }

  // Organisers can never change the split. An admin may correct it here, only before the first gift;
  // the server checks that again (409, its words shown). Editors and viewers see it in What they told us.
  function frHasGifts() {
    var m = (frDetail && frDetail.meter) || {};
    return (Number(m.onlinePence) || 0) > 0 || (Number(m.cashPence) || 0) > 0 ||
      ((frDetail && frDetail.cash) || []).length > 0 || ((frDetail && frDetail.wall) || []).length > 0;
  }
  function frSplitSection(f) {
    if (!(isAdmin() && frCanWrite())) return "";
    var body;
    if (frHasGifts()) {
      body = '<p class="fx-help">The split is locked: this fundraiser has had its first gift, and people gave on the split as it stood.</p>';
    } else {
      var yes = f.sharesWithOther === true;
      body =
        '<form id="frSplitForm" class="fr-split-form" novalidate>' +
          '<p class="fx-help">Only correct it if the organiser has told you it was wrong. Once anyone has given, it cannot be changed.</p>' +
          '<fieldset class="fr-split-choice"><legend class="fx-call-label">Sharing what they raise with another cause?</legend>' +
            '<label><input type="radio" name="sharesWithOther" id="frSplitYes" value="yes"' + (yes ? " checked" : "") + "> Yes</label> " +
            '<label><input type="radio" name="sharesWithOther" id="frSplitNo" value="no"' + (yes ? "" : " checked") + "> No</label>" +
          "</fieldset>" +
          // As the public form: the two boxes only for Yes, hidden and switched off for No.
          '<div class="fr-split-fields" data-frsplitfields' + (yes ? "" : " hidden") + ">" +
            '<label class="fx-call-label" for="frSplitPercent">Percentage to NBCC, 1 to 99</label>' +
            '<input class="fr-input fr-split-percent" id="frSplitPercent" name="nbccSharePercent" type="number" min="1" max="99" step="1" inputmode="numeric" value="' +
              (yes && f.nbccSharePercent ? H.escapeHtml(String(f.nbccSharePercent)) : "") + '"' + (yes ? "" : " disabled") + ">" +
            '<label class="fx-call-label" for="frSplitCause">The other cause’s name</label>' +
            '<input class="fr-input" id="frSplitCause" name="otherCauseName" type="text" maxlength="120" value="' +
              (yes && f.otherCauseName ? H.escapeHtml(f.otherCauseName) : "") + '"' + (yes ? "" : " disabled") + ">" +
            // Team pages: a team that shares says whose split it is; turning it on asks again.
            (f.isTeam
              ? '<fieldset class="fr-split-choice"><legend class="fx-call-label">Whose split is it?</legend>' +
                '<label><input type="radio" name="teamShareMode" value="team"' + (yes && f.teamShareMode === "team" ? " checked" : "") + (yes ? "" : " disabled") +
                  "> The whole team: every member page shares the same way</label><br>" +
                '<label><input type="radio" name="teamShareMode" value="organiser"' + (yes && f.teamShareMode === "organiser" ? " checked" : "") + (yes ? "" : " disabled") +
                  "> Just the team organiser: each member is asked when they join</label>" +
                "</fieldset>"
              : "") +
          "</div>" +
          '<div class="fx-call-row fr-actions"><button class="admin-btn admin-btn--small" type="submit">Save the split</button></div>' +
        "</form>";
    }
    return '<section class="fx-panel fx-panel--wide fr-split-panel" data-frsplit><h4>Sharing with another cause</h4>' + body +
      frNoticeHtml("split", "frSplitStatus") + "</section>";
  }
  // Yes or No in the split form: the two boxes show, and work, only for Yes.
  function frSplitChoice(form) {
    var yes = !!form.querySelector("#frSplitYes:checked");
    var fields = form.querySelector("[data-frsplitfields]");
    if (fields) fields.hidden = !yes;
    Array.prototype.forEach.call(form.querySelectorAll('#frSplitPercent, #frSplitCause, input[name="teamShareMode"]'), function (i) {
      i.disabled = !yes;
    });
  }
  function frSaveSplit(form) {
    if (frBusy) return;
    var f = frOpenRecord();
    if (!f) return;
    var yes = !!form.querySelector("#frSplitYes:checked");
    var percent = String((form.querySelector("#frSplitPercent") || {}).value || "").trim();
    var cause = String((form.querySelector("#frSplitCause") || {}).value || "").trim();
    var body = { sharesWithOther: yes, nbccSharePercent: yes ? percent : null, otherCauseName: yes ? cause : "" };
    // Team pages: whose split it is, when a team shares (the server asks if none is chosen).
    var mode = form.querySelector('input[name="teamShareMode"]:checked');
    if (f.isTeam && yes && mode) body.teamShareMode = mode.value;
    var question = yes
      ? "Change the split for " + f.title + " to " + percent + "% to NBCC, the rest to " + cause + "? The page and every material will say it."
      : "Change the split for " + f.title + " to all of it coming to NBCC?";
    if (!window.confirm(question)) return;
    frRun("split", "Saving…", function (run) {
      return frSend("PUT", "/api/admin/fundraisers/" + f.id + "/split", body).then(function (r) {
        if (!r.ok) {
          var fields = r.status === 400 && r.body && r.body.fields
            ? Object.keys(r.body.fields).map(function (k) { return r.body.fields[k]; }).join(" ")
            : "";
          run.say(fields || frRefusal(r, "The split was not saved. Please try again."), true);
          return;
        }
        run.say("Split saved. The page and every material now say it.", false);
        return frReload();
      });
    });
  }

  // TASK-499: the event questions, as they answered them. A sign up from before the questions has
  // none of them, and says so plainly.
  function frShortName(name) {
    var parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "Anonymous";
    var first = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
    return parts.length === 1 ? first : first + " " + parts[parts.length - 1].charAt(0).toUpperCase() + ".";
  }
  function frText(value, none) {
    return value ? '<span class="fx-address">' + H.escapeHtml(value) + "</span>" : frNone(none || "Not given");
  }
  function frLabelOf(list, value) {
    var hit = list.filter(function (o) { return o[0] === value; })[0];
    return hit ? hit[1] : "";
  }
  function frEventRows(f) {
    var access = (Array.isArray(f.access) ? f.access : []).map(function (a) { return frLabelOf(FR_ACCESS, a); }).filter(Boolean);
    var booking = frLabelOf(FR_BOOKING, f.booking);
    var ticket = f.booking === "away" && f.ticketUrl
      ? frIsWebLink(f.ticketUrl)
        ? '<a class="fx-tel" href="' + H.escapeHtml(f.ticketUrl) + '" target="_blank" rel="noopener noreferrer">' + H.escapeHtml(f.ticketUrl) + "</a>"
        : '<span class="fx-mono">' + H.escapeHtml(f.ticketUrl) + "</span>"
      : "";
    return (
      fulfilRow("Front of the card", frText(f.cardLine)) +
      fulfilRow("Finish time", f.endTime ? H.escapeHtml(String(f.endTime).slice(0, 5)) : frNone("No finish time")) +
      (f.timeTbc ? fulfilRow("Time", "The time is still to be confirmed") : "") +
      fulfilRow("Full address and how to get there", frText(f.venueAddress)) +
      fulfilRow("Venue postcode", frText(f.venuePostcode)) +
      fulfilRow("Access", access.length ? H.escapeHtml(access.join(", ")) : frNone("None ticked")) +
      fulfilRow("Price", frText(f.price)) +
      fulfilRow("How people get in", booking ? H.escapeHtml(booking) : frNone("Not given")) +
      (ticket ? fulfilRow("Ticket link", ticket) : "") +
      fulfilRow("Age limit", frText(f.ageLimit)) +
      fulfilRow("Dress code", frText(f.dressCode)) +
      fulfilRow("What\u2019s included", frText(f.included)) +
      fulfilRow("Credit it to", f.creditName ? H.escapeHtml(f.creditName) : frNone("Not given, so the card says " + frShortName(f.name)))
    );
  }

  // TASK-511: a sign up made since the form's second round has the name in two parts, and Instagram
  // and Facebook apart. One from before has one name and one link, and shows and edits as it did.
  function frSplit(f) {
    return f.firstName !== null && f.firstName !== undefined && f.firstName !== "";
  }
  function frLinkHtml(link) {
    if (!link) return frNone("Not given");
    return frIsWebLink(link)
      ? '<a class="fx-tel" href="' + H.escapeHtml(link) + '" target="_blank" rel="noopener noreferrer">' + H.escapeHtml(link) + "</a>"
      : '<span class="fx-mono">' + H.escapeHtml(link) + "</span>";
  }
  function frContactPanel(f) {
    var split = frSplit(f);
    var names = split
      ? fulfilRow("First name", H.escapeHtml(f.firstName)) + fulfilRow("Surname", f.lastName ? H.escapeHtml(f.lastName) : frNone("Not given"))
      : fulfilRow("Name", H.escapeHtml(f.name));
    var links = split || f.instagram || f.facebook
      ? fulfilRow("Instagram", frLinkHtml(f.instagram)) + fulfilRow("Facebook", frLinkHtml(f.facebook))
      : fulfilRow("Facebook or Instagram", frLinkHtml(f.socialLink));
    return (
      '<dl class="fx-dl">' +
        names +
        fulfilRow("Phone", f.phone ? '<a class="fx-tel" href="' + H.escapeHtml(telHref(f.phone)) + '">' + H.escapeHtml(f.phone) + "</a>" : frNone("Not given")) +
        fulfilRow("Email", f.email ? '<a class="fx-tel" href="mailto:' + H.escapeHtml(f.email) + '">' + H.escapeHtml(f.email) + "</a>" : frNone("Not given")) +
        links +
        fulfilRow("Post about it on NBCC's social media", fulfilYesNo(f.socialOk)) +
        fulfilRow("Newsletter", fulfilYesNo(f.newsletterOk)) +
      "</dl>"
    );
  }

  // TASK-499: what is in the post box of a sign up: the separate boxes, or the one old box.
  function frPostAddress(f) {
    var parts = [f.postLine1, f.postLine2, f.postTown, f.postPostcode].filter(function (p) { return p && String(p).trim(); });
    return parts.length ? parts.join("\n") : f.postAddress || "";
  }

  function frWantsPanel(f) {
    var w = f.wants || {};
    var items = [];
    var leaflets = Number(w.leaflets) || 0;
    var buckets = Number(w.buckets) || 0;
    // TASK-499: posters, leaflets, buckets and tins each on their own; a sign up from before asked
    // for "leaflets or posters" and "buckets or tins", and reads as it always did.
    [["posterCount", " poster", " posters"], ["leafletCount", " leaflet", " leaflets"],
      ["bucketCount", " collection bucket", " collection buckets"], ["tinCount", " collection tin", " collection tins"],
      ["qrCount", " printed QR code", " printed QR codes"],
      ["envelopeCount", " collection envelope", " collection envelopes"]].forEach(function (c) {
      var n = Number(w[c[0]]) || 0;
      if (n > 0) items.push(n + (n === 1 ? c[1] : c[2]));
    });
    var posted = items.length > 0 || leaflets > 0 || buckets > 0;
    if (leaflets > 0) items.push(leaflets + (leaflets === 1 ? " leaflet or poster" : " leaflets or posters"));
    if (buckets > 0) items.push(buckets + (buckets === 1 ? " bucket or tin" : " buckets or tins"));
    if (w.shoutOut) items.push(f.socialOk ? "A social media shout out" : "A social media shout out, but they have not said we can post about it yet");
    if (w.attend) items.push("Someone from NBCC to come along");
    var list = items.length
      ? '<ul class="fr-wants">' + items.map(function (s) { return "<li>" + H.escapeHtml(s) + "</li>"; }).join("") + "</ul>"
      : '<p class="fx-empty">Nothing asked for.</p>';
    var postTo = frPostAddress(f);
    var address = postTo
      ? '<dl class="fx-dl fr-gap">' + fulfilRow("Post them to", '<span class="fx-address">' + H.escapeHtml(postTo) + "</span>") + "</dl>"
      : posted ? '<p class="fx-warn fr-gap">No address given. Ask them before posting.</p>' : "";
    return list + address;
  }

  function frPhotoPanel(f, write) {
    var src = typeof f.imageSrc === "string" && /^\/media\/[A-Za-z0-9/_-]+$/.test(f.imageSrc) ? f.imageSrc : "";
    var shown = src
      ? '<img class="fr-photo" src="' + H.escapeHtml(src) + '" alt="The photo on its page">'
      : '<p class="fx-empty">No photo yet. ' + (write ? "Their page shows without one until you add it." : "") + "</p>";
    var upload = write
      ? '<label class="fx-call-label fr-gap" for="frPhotoInput">' + (src ? "Change the photo" : "Add a photo") + "</label>" +
        '<span class="fr-field-hint">A JPG or PNG. Big phone photos are made smaller first.</span>' +
        '<input class="fr-file" type="file" id="frPhotoInput" accept="image/*">' + frNoticeHtml("photo", "frPhotoStatus")
      : "";
    return shown + upload;
  }

  function frMeterHtml(m) {
    m = m || {};
    var head = "<b>" + H.escapeHtml(frMoney(m.raisedPence) + " raised") + "</b>" +
      (m.targetPence ? " of " + H.escapeHtml(frMoney(m.targetPence)) + ' <span class="fr-pct">' + (m.percent || 0) + "%</span>" : "");
    var bar = m.targetPence
      ? '<div class="fr-meter-bar" role="progressbar" aria-label="Raised so far, against the target" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' +
          (Number(m.barPercent) || 0) + '" aria-valuetext="' + (m.percent || 0) + '% of the target"><span class="fr-meter-fill" style="width:' +
          Math.max(0, Math.min(100, Number(m.barPercent) || 0)) + '%"></span></div>'
      : '<p class="fx-help">No target set.</p>';
    return (
      '<div class="fr-meter"><p class="fr-meter-head">' + head + "</p>" + bar +
        '<p class="fr-meter-split">' + H.escapeHtml(frMoney(m.onlinePence) + " online · " + frMoney(m.cashPence) + " cash") + "</p></div>"
    );
  }

  // The server names a field inside another with a dot ("wants.buckets"), which is no good in an id.
  function frErrId(key) {
    return "frErr-" + String(key).replace(/[^A-Za-z0-9]/g, "-");
  }
  function frFieldError(errors, key) {
    var msg = errors[key];
    return '<p class="fr-err" id="' + frErrId(key) + '" data-frerr="' + H.escapeHtml(key) + '"' + (msg ? "" : " hidden") + ">" +
      H.escapeHtml(msg || "") + "</p>";
  }
  function frInvalid(errors, key) {
    return errors[key] ? ' aria-invalid="true" aria-describedby="' + frErrId(key) + '"' : "";
  }

  function frCashPanel(rows, write) {
    var list = rows.length
      ? '<ul class="fr-cash">' + rows.map(function (c) {
          return '<li data-frcash="' + Number(c.id) + '"><span class="fr-cash-amount">' + H.escapeHtml(frMoney(c.amountPence)) + "</span>" +
            '<span class="fr-cash-text"><span>Paid in on ' + H.escapeHtml(H.fmtDate(c.paidInOn)) + "</span>" +
            (c.note ? '<span class="fr-cash-note">' + H.escapeHtml(c.note) + "</span>" : "") +
            '<span class="fx-hist-who">Added by ' + H.escapeHtml(frWho(c.createdBy)) + "</span></span>" +
            (write
              ? '<button class="fr-link-btn" type="button" data-frcashremove="' + Number(c.id) + '" aria-label="' +
                  H.escapeHtml("Remove " + frMoney(c.amountPence) + " paid in " + H.fmtDate(c.paidInOn)) + '">Remove</button>'
              : "") +
            "</li>";
        }).join("") + "</ul>"
      : '<p class="fx-empty">No cash recorded yet.</p>';
    if (!write) return list;
    var d = frCashDraft || { amount: "", paidInOn: evToday(), note: "" };
    var e = frCashErrors;
    return (
      list +
      '<form class="fx-call-form fr-form fr-cash-form" id="frCashForm" novalidate>' +
        '<div class="fr-field"><label class="fx-call-label" for="frCashAmount">Amount in pounds</label>' +
          '<input class="fx-call-input" id="frCashAmount" name="amount" type="text" inputmode="decimal" autocomplete="off" value="' +
          H.escapeHtml(d.amount) + '"' + frInvalid(e, "amountPence") + ">" + frFieldError(e, "amountPence") + "</div>" +
        '<div class="fr-field"><label class="fx-call-label" for="frCashDate">Paid in on</label>' +
          '<input class="fx-call-input" id="frCashDate" name="paidInOn" type="date" value="' + H.escapeHtml(d.paidInOn) + '"' +
          frInvalid(e, "paidInOn") + ">" + frFieldError(e, "paidInOn") + "</div>" +
        '<div class="fr-field fr-field--wide"><label class="fx-call-label" for="frCashNote">Note (optional)</label>' +
          '<input class="fx-call-input" id="frCashNote" name="note" type="text" maxlength="500" autocomplete="off" value="' +
          H.escapeHtml(d.note) + '"' + frInvalid(e, "note") + ">" + frFieldError(e, "note") + "</div>" +
        '<div class="fx-call-row fr-field--wide"><button class="admin-btn admin-btn--small" type="submit">Add the cash</button></div>' +
        frNoticeHtml("cash", "frCashStatus") +
      "</form>"
    );
  }

  // Every field staff may change (adminPatchSchema in src/fundraising/model.ts), as the form shows
  // them. Strings throughout, so what is typed compares straight with what is live.
  function frEditValues(f) {
    var w = f.wants || {};
    return {
      title: f.title || "", kind: f.kind || "other", path: f.path || "raising", description: f.description || "",
      eventDate: f.eventDate || "", startTime: f.startTime ? String(f.startTime).slice(0, 5) : "", venue: f.venue || "",
      town: f.town || "", target: frPounds(f.targetPence), public: !!f.public, slug: f.slug || "",
      name: f.name || "", email: f.email || "", phone: f.phone || "", socialLink: f.socialLink || "", socialOk: !!f.socialOk,
      // TASK-511
      firstName: f.firstName || "", lastName: f.lastName || "", kindOther: f.kindOther || "", instagram: f.instagram || "",
      facebook: f.facebook || "", qrCount: String(Number(w.qrCount) || 0),
      postAddress: f.postAddress || "", leaflets: String(Number(w.leaflets) || 0), buckets: String(Number(w.buckets) || 0),
      shoutOut: !!w.shoutOut, attend: !!w.attend,
      // TASK-499
      posterCount: String(Number(w.posterCount) || 0), leafletCount: String(Number(w.leafletCount) || 0),
      bucketCount: String(Number(w.bucketCount) || 0), tinCount: String(Number(w.tinCount) || 0),
      postLine1: f.postLine1 || "", postLine2: f.postLine2 || "", postTown: f.postTown || "", postPostcode: f.postPostcode || "",
      cardLine: f.cardLine || "", endTime: f.endTime ? String(f.endTime).slice(0, 5) : "", timeTbc: !!f.timeTbc,
      venueAddress: f.venueAddress || "", venuePostcode: f.venuePostcode || "", price: f.price || "", booking: f.booking || "",
      ticketUrl: f.ticketUrl || "", ageLimit: f.ageLimit || "", dressCode: f.dressCode || "", included: f.included || "",
      creditName: f.creditName || "",
      access0: frHas(f.access, 0), access1: frHas(f.access, 1), access2: frHas(f.access, 2), access3: frHas(f.access, 3),
    };
  }
  function frHas(access, i) {
    return Array.isArray(access) && access.indexOf(FR_ACCESS[i][0]) !== -1;
  }
  // A sign up from before TASK-499 asked for one number of "leaflets or posters" and one of "buckets
  // or tins", and gave its address in one box: those boxes show only while they hold something.
  function frHasOldRequests(f) {
    var w = f.wants || {};
    return (Number(w.leaflets) || 0) > 0 || (Number(w.buckets) || 0) > 0;
  }
  var FR_TEXT_FIELDS = ["title", "kind", "path", "description", "venue", "town", "slug", "name", "email", "phone", "socialLink", "postAddress",
    "firstName", "lastName", "kindOther", "instagram", "facebook",
    "postLine1", "postLine2", "postTown", "postPostcode", "cardLine", "venueAddress", "venuePostcode", "price", "booking", "ticketUrl",
    "ageLimit", "dressCode", "included", "creditName"];
  var FR_COUNTS = [["posterCount", "5"], ["leafletCount", "50"], ["bucketCount", "2"], ["tinCount", "2"], ["leaflets", "50"], ["buckets", "2"],
    ["qrCount", "20"]];

  function frEditForm(f) {
    // What is live, with only the boxes someone has typed in laid over it (frEditDraft).
    var v = frEditValues(f);
    var draft = frEditDraft || {};
    Object.keys(draft).forEach(function (k) { if (Object.prototype.hasOwnProperty.call(v, k)) v[k] = draft[k]; });
    var e = frEditErrors;
    function box(name, key, label, type, attrs, hint) {
      // A hint goes under its box, so the boxes in a row of fields stay level with each other.
      return '<div class="fr-field"><label class="fx-call-label" for="frf-' + name + '">' + H.escapeHtml(label) + "</label>" +
        '<input class="fx-call-input" id="frf-' + name + '" name="' + name + '" type="' + type + '" ' + (attrs || "") +
        ' value="' + H.escapeHtml(v[name]) + '"' + frInvalid(e, key) + ">" + frFieldError(e, key) +
        (hint ? '<span class="fr-field-hint">' + H.escapeHtml(hint) + "</span>" : "") + "</div>";
    }
    function area(name, key, label, rows, max) {
      return '<div class="fr-field fr-field--wide"><label class="fx-call-label" for="frf-' + name + '">' + H.escapeHtml(label) + "</label>" +
        '<textarea class="fx-call-input fr-input" id="frf-' + name + '" name="' + name + '" rows="' + rows + '" maxlength="' + max + '"' +
        frInvalid(e, key) + ">" + H.escapeHtml(v[name]) + "</textarea>" + frFieldError(e, key) + "</div>";
    }
    function pick(name, label, options) {
      return '<div class="fr-field"><label class="fx-call-label" for="frf-' + name + '">' + H.escapeHtml(label) + "</label>" +
        '<select class="fx-call-input" id="frf-' + name + '" name="' + name + '"' + frInvalid(e, name) + ">" +
        options.map(function (o) {
          return '<option value="' + o[0] + '"' + (v[name] === o[0] ? " selected" : "") + ">" + H.escapeHtml(o[1]) + "</option>";
        }).join("") + "</select>" + frFieldError(e, name) + "</div>";
    }
    function tick(name, key, label) {
      return '<div class="fr-field fr-field--wide"><label class="fr-check"><input type="checkbox" id="frf-' + name + '" name="' + name + '"' +
        (v[name] ? " checked" : "") + frInvalid(e, key) + "> " + H.escapeHtml(label) + "</label>" + frFieldError(e, key) + "</div>";
    }
    function head(words) {
      return '<p class="fr-form-head">' + H.escapeHtml(words) + "</p>";
    }
    return (
      '<p class="fx-help">Changes here go straight onto the website. Only what you change is saved, and it is recorded in History.</p>' +
      '<form class="fx-call-form fr-form" id="frEditForm" novalidate>' +
        head("The fundraiser") +
        box("title", "title", "Name for it", "text", 'maxlength="100" autocomplete="off"') +
        pick("kind", "Category", frKindOptions(f.kind)) +
        // TASK-511 review: always there, shown as soon as Other is chosen (keepTyping).
        box("kindOther", "kindOther", "What it is, in their words (optional)", "text", 'maxlength="80" autocomplete="off"', "For Other. Up to 80 characters.")
          .replace('<div class="fr-field">', '<div class="fr-field" data-frkindother' + (v.kind === "other" || v.kindOther ? "" : " hidden") + ">") +
        pick("path", "They are", [["raising", "Raising money"], ["event", "Hosting an event"]]) +
        area("description", "description", "About it", 4, 1000) +
        box("eventDate", "eventDate", "Date (optional)", "date", "") +
        box("startTime", "startTime", "Start time (optional)", "time", "") +
        box("venue", "venue", "Venue (optional)", "text", 'maxlength="120" autocomplete="off"') +
        box("town", "town", "Town (optional)", "text", 'maxlength="80" autocomplete="off"') +
        box("target", "targetPence", "Target in pounds (optional)", "text", 'inputmode="decimal" autocomplete="off"', "From £10 to £100,000. Leave it empty for no target.") +
        // Event pages: an event's web address is nbcc.scot/event/<short name>.
        box("slug", "slug", "Web address", "text", 'maxlength="60" autocomplete="off" spellcheck="false"', "The end of nbcc.scot/" + (f.path === "event" ? "event" : "fundraise") + "/ in small letters and numbers, with a hyphen between words. Change it and the old address still works, sending people on to the new one.") +
        tick("public", "public", "Show it on our website") +
        head("The organiser") +
        (frSplit(f)
          ? box("firstName", "firstName", "First name", "text", 'maxlength="50" autocomplete="off"') +
            box("lastName", "lastName", "Surname", "text", 'maxlength="50" autocomplete="off"')
          : box("name", "name", "Name", "text", 'maxlength="100" autocomplete="off"')) +
        box("email", "email", "Email", "email", 'maxlength="254" autocomplete="off" spellcheck="false"') +
        box("phone", "phone", "Phone", "tel", 'maxlength="20" autocomplete="off"') +
        (frSplit(f) || f.instagram || f.facebook
          ? box("instagram", "instagram", "Instagram (optional)", "text", 'maxlength="300" autocomplete="off" spellcheck="false"', "A name like @theirname, or the link to their profile.") +
            box("facebook", "facebook", "Facebook (optional)", "text", 'maxlength="300" autocomplete="off" spellcheck="false"', "A page name, or the link to their page, group or event.")
          : box("socialLink", "socialLink", "Facebook or Instagram link (optional)", "url", 'maxlength="300" autocomplete="off" spellcheck="false"')) +
        tick("socialOk", "socialOk", "They are happy for NBCC to post about it on social media") +
        (f.path === "event" ? frEventEditFields(box, area, tick, head, v, e) : "") +
        head("What they would like") +
        box("posterCount", "wants.posterCount", "Posters", "text", 'inputmode="numeric" autocomplete="off"', "How many. 0 for none, up to 1,000.") +
        box("leafletCount", "wants.leafletCount", "Leaflets", "text", 'inputmode="numeric" autocomplete="off"', "How many. 0 for none, up to 1,000.") +
        box("bucketCount", "wants.bucketCount", "Collection buckets", "text", 'inputmode="numeric" autocomplete="off"', "How many. 0 for none, up to 20.") +
        box("tinCount", "wants.tinCount", "Collection tins", "text", 'inputmode="numeric" autocomplete="off"', "How many. 0 for none, up to 20.") +
        // TASK-511 review: printed QR codes carry a page's QR code, and an event has none.
        (f.path !== "event" || Number(v.qrCount) > 0
          ? box("qrCount", "wants.qrCount", "Printed QR codes", "text", 'inputmode="numeric" autocomplete="off"', "Cards or stickers with their page\u2019s QR code. 0 for none, up to 200.")
          : "") +
        (frHasOldRequests(f)
          ? box("leaflets", "wants.leaflets", "Leaflets or posters", "text", 'inputmode="numeric" autocomplete="off"', "Asked for before posters and leaflets were split. 0 for none, up to 1,000.") +
            box("buckets", "wants.buckets", "Buckets or tins to borrow", "text", 'inputmode="numeric" autocomplete="off"', "Asked for before buckets and tins were split. 0 for none, up to 20.")
          : "") +
        tick("shoutOut", "wants.shoutOut", "A social media shout out") +
        tick("attend", "wants.attend", "Someone from NBCC to come along") +
        head("Where to post them") +
        box("postLine1", "postLine1", "Address line 1", "text", 'maxlength="120" autocomplete="off"') +
        box("postLine2", "postLine2", "Address line 2 (optional)", "text", 'maxlength="120" autocomplete="off"') +
        box("postTown", "postTown", "Town", "text", 'maxlength="80" autocomplete="off"') +
        box("postPostcode", "postPostcode", "Postcode", "text", 'maxlength="10" autocomplete="off" spellcheck="false"') +
        (f.postAddress ? area("postAddress", "postAddress", "Where to post leaflets or a bucket (optional)", 3, 500) : "") +
        '<div class="fx-call-row fr-field--wide"><button class="admin-btn admin-btn--small" type="submit">Save the changes</button></div>' +
        frNoticeHtml("edit", "frEditStatus") +
      "</form>"
    );
  }

  // TASK-499: the event questions, worded like the events editor, for an event's sign up.
  function frEventEditFields(box, area, tick, head, v, e) {
    var access = FR_ACCESS.map(function (a, i) {
      var name = "access" + i;
      return '<label class="fr-check"><input type="checkbox" id="frf-' + name + '" name="' + name + '"' + (v[name] ? " checked" : "") + "> " +
        H.escapeHtml(a[1]) + "</label>";
    }).join("");
    var booking = [["", "Not given"]].concat(FR_BOOKING);
    return (
      head("The event\u2019s card") +
      area("cardLine", "cardLine", "A line for the front of the card", 2, 140) +
      box("endTime", "endTime", "Finish time (optional)", "time", "") +
      tick("timeTbc", "timeTbc", "The time is still to be confirmed") +
      area("venueAddress", "venueAddress", "Full address and how to get there (optional)", 2, 300) +
      box("venuePostcode", "venuePostcode", "Venue postcode (optional)", "text", 'maxlength="10" autocomplete="off" spellcheck="false"') +
      '<fieldset class="fr-field fr-field--wide fr-checks-group"' + frInvalid(e, "access") + ">" +
        '<legend class="fx-call-label">Access: tick only what the venue has confirmed</legend>' +
        '<span class="fr-field-hint">Printed on the back, so a disabled guest can decide without having to ask.</span>' +
        '<div class="fr-checks-row">' + access + "</div>" + frFieldError(e, "access") + "</fieldset>" +
      box("price", "price", "Price (optional)", "text", 'maxlength="60" autocomplete="off"', "Short. For example: Free, or \u00a35 on the door.") +
      // Full width, so the longest way in is never cut short in its box.
      '<div class="fr-field fr-field--wide"><label class="fx-call-label" for="frf-booking">How people get in</label>' +
        '<select class="fx-call-input" id="frf-booking" name="booking"' + frInvalid(e, "booking") + ">" +
        booking.map(function (o) {
          return '<option value="' + o[0] + '"' + (v.booking === o[0] ? " selected" : "") + ">" + H.escapeHtml(o[1]) + "</option>";
        }).join("") + "</select>" + frFieldError(e, "booking") + "</div>" +
      box("ticketUrl", "ticketUrl", "Ticket link (optional)", "url", 'maxlength="500" autocomplete="off" spellcheck="false"', "Only for tickets sold on another website. Starts https://") +
      box("ageLimit", "ageLimit", "Age limit (optional)", "text", 'maxlength="60" autocomplete="off"') +
      box("dressCode", "dressCode", "Dress code (optional)", "text", 'maxlength="60" autocomplete="off"') +
      area("included", "included", "What\u2019s included (optional)", 2, 300) +
      box("creditName", "creditName", "Credit it to (optional)", "text", 'maxlength="80" autocomplete="off"', "Shown as the organiser on the card. Left empty, the card shows their first name and last initial.")
    );
  }

  // ---- In memory pages (Jaimie, 2026-10-03) ----
  // A page in memory of someone (src/fundraising/in-memory.ts). The list marks it "In memory", with
  // "Messages to check" while any giver's message waits for staff, and "A year on" when it is time to
  // decide whether to get in touch (there is no automatic anniversary email). The open sign up has an
  // In memory panel: who it remembers, who set it up with the family's permission, the target
  // choice, the funeral collection envelopes, and the year on reminder. On its wall each message
  // waits for Approve (src/routes/fundraise-memory.ts). Kept here, in one block, reached from the rest
  // of the screen by one line hooks marked "In memory".
  var frMemoryCounts = {}; // fundraiser id -> how many messages wait
  var frMemoryNote = "";

  function frMemoryLoadCounts() {
    return authFetch("/api/admin/fundraising/memory-waiting")
      .then(okJson)
      .then(function (d) {
        frMemoryCounts = d && d.counts && typeof d.counts === "object" ? d.counts : {};
        frRenderList();
      })
      .catch(function () {
        /* only a pill: the list works without it */
      });
  }

  function frMemoryPills(f) {
    if (!f.inMemory) return "";
    // The row's large kind pill says In memory; these are only what is waiting on it.
    return (frMemoryCounts[f.id] ? '<span class="admin-pill admin-pill--pending fr-memory-msgs-pill">Messages to check</span>' : "") +
      (f.memoryYearOnDue ? '<span class="admin-pill admin-pill--pending fr-memory-yearon-pill">A year on</span>' : "");
  }

  function frMemorySection(f, write) {
    if (!f.inMemory) return "";
    var who = H.escapeHtml(String(f.memoryName || "")) + (f.memoryDates ? " (" + H.escapeHtml(f.memoryDates) + ")" : "");
    var target = !f.targetPence
      ? frNone("No target")
      : f.memoryShowTarget
        ? "Shown on the page, as they chose"
        : "Hidden on the page, as they chose. The page shows only what has been given.";
    var waiting = Number(frMemoryCounts[f.id]) || 0;
    var rows =
      fulfilRow("In memory of", who) +
      fulfilRow("Set up by", H.escapeHtml(f.memorySetupWords || "")) +
      fulfilRow("The target", target) +
      fulfilRow("Messages", waiting
        ? H.escapeHtml(waiting === 1 ? "1 message waiting for you to check, on the wall below" : waiting + " messages waiting for you to check, on the wall below")
        : "Every message waits for you to check it before it shows on the page. None waiting.") +
      fulfilRow("Emails", f.public
        ? "No automatic emails, bar the gentle one when you approve it. Anything else, please write to them personally."
        : "No email goes for this one: please ring them.");
    if (f.memoryReminderDoneAt) {
      rows += fulfilRow("A year on", H.escapeHtml("Dealt with on " + H.fmtDate(f.memoryReminderDoneAt) + (f.memoryReminderDoneBy ? " by " + frWho(f.memoryReminderDoneBy) : "")));
    }
    var yearOn = "";
    if (f.memoryYearOnDue) {
      var first = String(f.name || "").trim().split(/\s+/)[0] || "them";
      yearOn =
        '<div class="fr-memory-yearon">' +
          '<p class="fx-help">It is a year since this page went live. Nothing goes by itself: decide whether to get in touch with ' + H.escapeHtml(first) + ", and how.</p>" +
          (write
            ? '<label class="fx-call-label" for="frMemoryNote">A note for the history (optional)</label>' +
              '<textarea class="fx-call-input fr-input" id="frMemoryNote" rows="2" maxlength="500">' + H.escapeHtml(frMemoryNote) + "</textarea>" +
              '<div class="fx-call-row"><button class="admin-btn admin-btn--small" type="button" data-frmemyearon>Done</button></div>'
            : "") +
        "</div>";
    }
    var envelopes = f.status === "approved" || f.status === "finished"
      ? '<div class="fx-call-row fr-actions"><button class="admin-btn admin-btn--small fr-btn-quiet" type="button" data-frmaterial="envelopes">Funeral collection envelopes</button></div>' +
        '<span class="fr-field-hint">DL envelopes, printed on the front: In memory of, the page&rsquo;s QR code and a Gift Aid declaration. The same as the organiser has.</span>'
      : "";
    return '<section class="fx-panel fx-panel--wide fr-memory-panel" data-frmemory><h4>In memory</h4>' +
      '<dl class="fx-dl">' + rows + "</dl>" + yearOn + envelopes + frMemoryForm(f, write) + frNoticeHtml("memory", "frMemoryStatus") + "</section>";
  }

  // An admin corrects the details (the organiser asks staff; there is no self service edit). The
  // permission stays as it was given, so it is not here. The server checks it all again.
  var FR_MEMORY_SETUP = [["family", "A family member"], ["friend", "A friend"], ["funeral_director", "A funeral director"],
    ["someone_else", "Someone else, like a colleague, club or church"]];
  function frMemoryForm(f, write) {
    if (!(write && isAdmin())) return "";
    var options = FR_MEMORY_SETUP.map(function (o) {
      return '<option value="' + o[0] + '"' + (f.memorySetupBy === o[0] ? " selected" : "") + ">" + H.escapeHtml(o[1]) + "</option>";
    }).join("");
    var show = f.memoryShowTarget === true;
    var hide = f.memoryShowTarget === false;
    return (
      '<details class="fr-memory-edit"><summary>Correct the in memory details</summary>' +
      '<div class="fr-memory-form" data-frmemform>' +
        '<span class="fr-field-hint">For when the organiser asks us. The family&rsquo;s permission stays as they gave it.</span>' +
        '<label class="fx-call-label" for="frMemName">Their name</label>' +
        '<input class="fr-input" id="frMemName" type="text" maxlength="100" value="' + H.escapeHtml(String(f.memoryName || "")) + '">' +
        '<label class="fx-call-label" for="frMemDates">Their dates (optional)</label>' +
        '<input class="fr-input" id="frMemDates" type="text" maxlength="60" value="' + H.escapeHtml(String(f.memoryDates || "")) + '">' +
        '<label class="fx-call-label" for="frMemSetupBy">Set up by</label>' +
        '<select class="fr-input" id="frMemSetupBy">' + options + "</select>" +
        '<fieldset class="fr-split-choice"><legend class="fx-call-label">Show the target on the page?</legend>' +
          '<label><input type="radio" name="frMemShow" id="frMemShowYes" value="yes"' + (show ? " checked" : "") + "> Yes</label> " +
          '<label><input type="radio" name="frMemShow" id="frMemShowNo" value="no"' + (hide ? " checked" : "") + "> No</label>" +
          (f.targetPence ? "" : '<span class="fr-field-hint">There is no target just now, so this only matters if one is added.</span>') +
        "</fieldset>" +
        '<div class="fx-call-row fr-actions"><button class="admin-btn admin-btn--small" type="button" data-frmemsave>Save the in memory details</button></div>' +
      "</div></details>"
    );
  }

  function frMemorySave() {
    if (frBusy) return;
    var f = frOpenRecord();
    if (!f) return;
    var val = function (id) { var e = el(id); return e ? String(e.value || "").trim() : ""; };
    var yes = el("frMemShowYes");
    var no = el("frMemShowNo");
    var body = {
      memoryName: val("frMemName"),
      memoryDates: val("frMemDates"),
      memorySetupBy: val("frMemSetupBy"),
      memoryShowTarget: yes && yes.checked ? true : no && no.checked ? false : null,
    };
    frRun("memory", "Saving…", function (run) {
      return frSend("PUT", "/api/admin/fundraisers/" + f.id + "/memory", body).then(function (r) {
        var fields = r.body && r.body.fields ? Object.keys(r.body.fields).map(function (k) { return r.body.fields[k]; }).join(" ") : "";
        run.say(r.ok ? "Saved. It is in the history." : fields || frRefusal(r, "That was not saved. Please try again."), !r.ok);
        return frReload();
      });
    });
  }

  // On the wall: a message waiting for staff, and whether the giver asked to let the family know.
  function frMemoryWallBits(g, write) {
    var bits = "";
    if (g.held && g.message && !g.hidden) bits += '<span class="admin-pill admin-pill--pending fr-memory-held-pill">Waiting for you to check</span>';
    if (g.familyNotify) bits += '<span class="admin-pill fr-memory-family-pill">Asked to let the family know</span>';
    var approve = write && g.held && g.message && !g.paidIn
      ? '<button class="fr-link-btn" type="button" data-frmemapprove="' + Number(g.donationId) + '">Approve for the page</button>'
      : "";
    return { pills: bits, approve: approve };
  }

  function frMemoryApprove(donationId) {
    if (frBusy) return;
    var f = frOpenRecord();
    if (!f) return;
    frRun("detail", null, function (run) {
      return frSend("POST", "/api/admin/fundraisers/" + f.id + "/wall/" + encodeURIComponent(donationId) + "/approve").then(function (r) {
        if (!r.ok) run.say(frRefusal(r, "That did not work. Please try again."), true);
        return Promise.all([frReload(), frMemoryLoadCounts()]);
      });
    });
  }

  function frMemoryYearOnDone() {
    if (frBusy) return;
    var f = frOpenRecord();
    if (!f) return;
    var box = el("frMemoryNote");
    frMemoryNote = box ? box.value : frMemoryNote;
    var note = frMemoryNote.trim();
    frRun("memory", "Saving…", function (run) {
      return frSend("POST", "/api/admin/fundraisers/" + f.id + "/memory/year-on-done", note ? { note: note } : {}).then(function (r) {
        if (r.ok) frMemoryNote = "";
        run.say(r.ok ? "Done. It is in the history." : frRefusal(r, "That was not saved. Please try again."), !r.ok);
        return frReload();
      });
    });
  }

  function frWallPanel(rows, write) {
    if (!rows.length) return '<div id="frWall"><p class="fx-empty">No gifts on this page yet.</p></div>';
    var shown = frMore.wall ? rows : rows.slice(0, FR_WALL_FIRST);
    return (
      '<div id="frWall"><p class="fx-help">Every gift made on its page, newest first, with the giver\'s full name for you. ' +
        "Hiding takes the gift and its message off the page; the money still counts.</p>" +
      '<ul class="fr-wall">' + shown.map(function (g) {
        var amount = frMoney(g.amountPence) +
          (Number(g.refundedPence) > 0 ? " (" + frMoney(g.refundedPence) + " refunded)" : "") +
          (g.showAmount === false ? ", amount hidden on the page" : "");
        var mem = frMemoryWallBits(g, write); // In memory
        return '<li data-frwall="' + Number(g.donationId) + '"' + (g.hidden ? ' class="is-hidden"' : "") + ">" +
          '<div class="fr-wall-head"><span class="fr-wall-who">' + H.escapeHtml(g.fullName) + "</span>" +
            '<span class="fx-hist-who">Shown as ' + H.escapeHtml(g.shortName) + " · " + H.escapeHtml(amount) + " · " +
            H.escapeHtml(H.fmtDate(g.createdAt)) + "</span>" +
            (g.hidden ? '<span class="admin-pill admin-pill--cancelled fr-hidden-pill">Hidden</span>' : "") +
            // TASK-501: money the organiser collected and paid in: on the meter, never on the page.
            (g.paidIn ? '<span class="admin-pill fr-paidin-pill">Paid in by the organiser</span>' : "") + mem.pills + "</div>" +
          (g.message ? '<p class="fr-wall-msg">' + H.escapeHtml(g.message) + "</p>" : '<p class="fx-empty">No message.</p>') +
          mem.approve +
          (write && !g.paidIn && !(g.held && g.hidden)
            ? g.hidden
              ? '<button class="fr-link-btn" type="button" data-frshow="' + Number(g.donationId) + '">Show on the page</button>'
              : '<button class="fr-link-btn" type="button" data-frhide="' + Number(g.donationId) + '">Hide from the page</button>'
            : "") +
          "</li>";
      }).join("") + "</ul>" + frMoreButton("wall", FR_WALL_FIRST, rows.length) + "</div>"
    );
  }

  var FR_HISTORY_WORDS = {
    "fundraiser.signed_up": "Signed up",
    "fundraiser.approved": "Approved",
    "fundraiser.declined": "Declined",
    "fundraiser.finished": "Marked finished",
    "fundraiser.wall_message_added": "A giver added to the wall",
    "fundraiser.updated": "Details changed",
    "fundraiser.edit_requested": "The organiser asked for a change",
    "fundraiser.edit_approved": "Change approved",
    "fundraiser.edit_rejected": "Change rejected",
    "fundraiser.cash_removed": "Cash removed",
    "fundraiser.message_hidden": "A message hidden from the page",
    "fundraiser.message_shown": "A message shown on the page again",
    "fundraiser.gift_received": "A gift on its page",
    "fundraiser.manage_link_sent": "A link to change the page emailed to the organiser",
    // TASK-501: from the organiser's private area.
    "fundraiser.finish_requested": "The organiser said they have finished",
    "fundraiser.paid_in": "The organiser paid in money they collected",
    // TASK-503: the team's tools.
    "fundraiser.called": "Called",
    "fundraiser.taken_off_list": "Taken off Get involved",
    "fundraiser.put_back_on_list": "Put back on Get involved",
    // TASK-515
    "fundraiser.touch_sent": "An automatic email went to the organiser",
    "fundraiser.prompt_called": "Called about a prompt",
    "fundraiser.again_used": "The organiser signed up to do it again",
    // TASK-505: the requests.
    "fundraiser.request_updated": "A request updated",
    // Jaimie, 2026-10-03: an admin corrected the split before the first gift.
    "fundraiser.split_changed": "Split with another cause changed",
    // Team pages
    "fundraiser.joined_team": "Someone asked to join the team",
    "fundraiser.handover_started": "Team organiser handover started: code emailed",
    "fundraiser.handover_cancelled": "Team organiser handover cancelled",
    "fundraiser.organiser_handed_over": "New team organiser confirmed with their code",
    // TASK-506
    "fundraiser.news_posted": "The organiser posted a news update",
    "fundraiser.news_approved": "News update approved",
    "fundraiser.news_rejected": "News update not used",
    "fundraiser.news_hidden": "News update hidden from the page",
    "fundraiser.news_shown": "News update shown on the page again",
    // TASK-512: "Ask us to print these" in their private area.
    "fundraiser.print_requested": "The organiser asked us to print some",
    // In memory
    "fundraiser.message_approved": "A message approved for the page",
    "fundraiser.memory_year_on_done": "A year on: dealt with",
    "fundraiser.memory_changed": "In memory details corrected",
  };

  function frPaintHistory() {
    var box = el("frHistory");
    if (!box) return;
    if (frHistoryRows === null) {
      box.innerHTML = '<p class="admin-loading">Loading…</p>';
      return;
    }
    if (frHistoryRows === false) {
      box.innerHTML = '<p class="fx-empty">The history could not load just now.</p>';
      return;
    }
    if (!frHistoryRows.length) {
      box.innerHTML = '<p class="fx-empty">Nothing recorded yet.</p>';
      return;
    }
    var shown = frMore.history ? frHistoryRows : frHistoryRows.slice(0, FR_HISTORY_FIRST);
    box.innerHTML =
      '<ul class="fx-history-list">' + shown.map(function (h) {
        var data = h.data || {};
        var what = FR_HISTORY_WORDS[h.action] || String(h.action || "");
        if (String(h.action).indexOf("fundraiser.thanks_") === 0) what = frThanksHistoryWhat(h.action, data); // TASK-507
        if (h.action === "fundraiser.cash_added") what = "Cash added: " + frMoney(data.amountPence);
        if (h.action === "fundraiser.cash_removed" && data.amountPence) what = "Cash removed: " + frMoney(data.amountPence);
        if (h.action === "fundraiser.called") what = data.which === "after" ? "Called, a week after its date" : "Called, a week before its date";
        // TASK-515
        if (h.action === "fundraiser.touch_sent" && frTouchKindInfo(data.kind)) what = "Automatic email sent: " + frTouchKindInfo(data.kind).label;
        if (h.action === "fundraiser.prompt_called" && typeof data.prompt === "string") what = "Called about a prompt: " + data.prompt.replace(/_/g, " ");
        if ((h.action === "fundraiser.request_updated" || h.action === "fundraiser.print_requested" || h.action === "fundraiser.pack_updated") && typeof data.words === "string" && data.words) what = data.words;
        // Team pages: who took a member off the team.
        if (h.action === "fundraiser.removed_from_team") what = data.by === "staff" ? "Taken off the team by NBCC" : "Taken off the team by the team organiser";
        if (h.action === "fundraiser.member_removed") what = data.by === "staff" ? "NBCC took someone off the team" : "The team organiser took someone off the team";
        var said = h.action === "fundraiser.declined" || h.action === "fundraiser.news_rejected" ? data.reason : h.action === "fundraiser.called" || h.action === "fundraiser.prompt_called" ? data.note : "";
        var note = said ? '<span class="fx-hist-note">' + H.escapeHtml(said) + "</span>" : "";
        return '<li><span class="fx-hist-what">' + H.escapeHtml(what) + "</span>" +
          '<span class="fx-hist-who">' + H.escapeHtml(H.fmtDate(h.createdAt) + " · " + frThanksWho(h)) + "</span>" + note + "</li>"; // TASK-507: frThanksWho
      }).join("") + "</ul>" + frMoreButton("history", FR_HISTORY_FIRST, frHistoryRows.length);
  }

  // ---- changing things ----
  // Every write: { ok, status, body }, so a refusal's own words (and a form's field messages) reach
  // the person. A 401 has already gone back to sign in, inside authFetch.
  function frSend(method, path, body) {
    return authFetch(path, {
      method: method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (b) {
        return { ok: res.ok, status: res.status, body: b || {} };
      });
    });
  }
  function frSetBusy(on) {
    frBusy = on;
    var view = el("view-fundraising");
    if (view) view.setAttribute("aria-busy", on ? "true" : "false");
    if (on) frRestDetail();
  }
  // While a change is on its way, every button and the photo picker in the open sign up rest, so a
  // second press cannot send it twice. frRenderList calls this too, as a redraw makes them afresh.
  function frRestDetail() {
    var wrap = el("frList");
    if (!wrap || !frBusy) return;
    Array.prototype.forEach.call(wrap.querySelectorAll("[data-frdetail] button, #frPhotoInput"), function (b) {
      b.disabled = true;
    });
  }
  function frRefusal(r, fallback) {
    return r.status < 500 && r.body && typeof r.body.error === "string" && r.body.error ? r.body.error : fallback;
  }

  function frOpenRecord() {
    return frDetail && frDetail.fundraiser;
  }

  // One change at a time, from the press to the redraw after it. Busy holds until the sign up has
  // been read again, not only until the server answers, because until then the old form (with the
  // amount still in it) is on screen and would send the same thing again. Each message belongs to
  // the sign up it was about, so a late answer never lands under another one opened meanwhile.
  //   key   which status line speaks (detail, edit, cash, photo)
  //   doing what it says at once ("Adding…"), or null for nothing
  //   work  given { id, open(), say(msg, isError) }; returns a promise
  function frRun(key, doing, work) {
    if (frBusy) return;
    var id = frOpenId;
    var run = {
      id: id,
      open: function () { return frOpenId === id; },
      say: function (msg, isError) { frSay(key, msg, isError, id); },
    };
    if (doing) {
      run.say(doing, false);
      frPaintNotice(key);
    }
    frSetBusy(true);
    return Promise.resolve()
      .then(function () { return work(run); })
      .catch(function (err) {
        if (err && err.message === "unauthorized") return;
        run.say("That did not work. Please try again.", true);
      })
      .then(function () {
        frSetBusy(false);
        frRenderList();
      });
  }

  function frMove(move) {
    if (frBusy) return;
    var f = frOpenRecord();
    if (!f) return;
    // Event pages: a public event has a page now too.
    var hasPage = (f.path === "raising" || f.path === "event") && f.public;
    var pageOn = !!(frSettings && frSettings.pageOn);
    // TASK-497: a page holder approved while fundraising is off is sent nothing yet; the server
    // emails them "Your page is live" when fundraising is switched on.
    var waitsForSwitch = hasPage && !pageOn;
    var question = {
      approve: "Approve " + f.title + "? " +
        (waitsForSwitch
          ? "Nothing is emailed yet: " + f.name + " gets “Your page is live” by email automatically when fundraising is switched on."
          : "We email " + f.name + " straight away: " +
            (!hasPage ? "a short note to say they are on our list." : "their page link, and the page goes on the website.")),
      decline: "Decline " + f.title + "?" + (f.status === "approved" ? " It comes off the website straight away." : "") +
        " They are not emailed, so tell them yourself if you need to.",
      finish: "Mark " + f.title + " as finished? It comes off the Get involved list. Its page stays up with a thank you banner and can still take gifts. What it raised stays in the records." +
        // TASK-515: the thank you (email 17) goes now, only while automatic emails are on.
        (hasPage
          ? !frTouch
            ? " If automatic emails are on, we email " + f.name + " their thank you. If its wording is still waiting for sign off, the thank you is held until you approve it."
            : frTouch.settings && frTouch.settings.on
            ? frTouchFinishedWaiting(f)
              ? " Automatic emails are on, but the thank you is held back: its new wording is waiting for your sign off. It goes once you approve it in Automatic emails, within a week."
              : " Automatic emails are on, so we email " + f.name + " their thank you, with their certificate."
            : " Automatic emails are off, so no thank you email goes."
          : ""),
    }[move];
    if (!window.confirm(question)) return;
    var body = {};
    if (move === "decline") {
      var reason = String(frReasonDraft || "").trim();
      if (reason) body.reason = reason;
    }
    frRun("detail", "Saving…", function (run) {
      return frSend("POST", "/api/admin/fundraisers/" + f.id + "/" + move, body).then(function (r) {
        if (!r.ok) {
          run.say(frRefusal(r, "That did not work. Please try again."), true);
          return frReload();
        }
        if (run.open()) frReasonDraft = "";
        // The server sends the email after the approval has saved, best effort, so this says it is
        // on its way rather than that it arrived. A page holder approved while fundraising is off
        // hears nothing until it is switched on.
        run.say({
          approve: waitsForSwitch
            ? "Approved. The organiser is emailed “Your page is live” when fundraising is switched on."
            : hasPage
              ? "Approved. An email with their page link is on its way to the organiser."
              : "Approved. An email to the organiser is on its way.",
          decline: "Declined.",
          finish: "Marked finished.",
        }[move], false);
        return frReload();
      });
    });
  }

  function frDecideEdit(btn) {
    if (frBusy) return;
    var f = frOpenRecord();
    if (!f) return;
    var approve = btn.getAttribute("data-fredit") === "approve";
    var editId = btn.getAttribute("data-freditid");
    // TASK-497: either way the organiser is emailed ("Your update is live" or "About your update").
    var live = (f.path === "raising" || f.path === "event") && f.public && f.status === "approved" && !!(frSettings && frSettings.pageOn);
    var question = approve
      ? (live ? "Approve this change? It goes on the website straight away" : "Approve this change? It is saved straight away") +
        ", and the organiser is emailed to say so."
      : "Reject this change? The page stays as it is, and the organiser is emailed a short, kind note to say we will be in touch.";
    if (!window.confirm(question)) return;
    frRun("detail", "Saving…", function (run) {
      return frSend("POST", "/api/admin/fundraisers/" + f.id + "/edits/" + encodeURIComponent(editId) + "/" + (approve ? "approve" : "reject"))
        .then(function (r) {
          // A 409 means the change was dealt with, or replaced by a newer one, while this was open:
          // the reload shows whatever is waiting now, with the server's words above it.
          if (!r.ok) run.say(frRefusal(r, "That did not work. Please try again."), true);
          else {
            // What was typed in the edit form was typed against the old version. Kept, it would show
            // the old words and Save would send them back over the change just approved.
            if (approve && run.open()) {
              frEditDraft = null;
              frEditErrors = {};
            }
            run.say(approve ? "Change approved. It is on the website now." : "Change rejected. The page stays as it was.", false);
          }
          return frReload();
        });
    });
  }

  function frReadEditForm(form) {
    var out = {};
    Array.prototype.forEach.call(form.querySelectorAll("[name]"), function (i) {
      out[i.name] = i.type === "checkbox" ? !!i.checked : String(i.value || "");
    });
    return out;
  }

  function frSaveEdit(form) {
    if (frBusy) return;
    var f = frOpenRecord();
    if (!f) return;
    var typed = frReadEditForm(form);
    var live = frEditValues(f);
    var patch = {};
    var errors = {};
    // Only what differs from the live version is sent.
    FR_TEXT_FIELDS.forEach(function (k) {
      if (typed[k] !== undefined && typed[k] !== live[k]) patch[k] = typed[k];
    });
    ["eventDate", "startTime", "endTime"].forEach(function (k) {
      if (typed[k] !== undefined && typed[k] !== live[k]) patch[k] = typed[k] === "" ? null : typed[k];
    });
    ["public", "socialOk", "timeTbc"].forEach(function (k) {
      if (typed[k] !== undefined && typed[k] !== live[k]) patch[k] = typed[k];
    });
    // TASK-499: the access ticks go as one list, in the card's order, when any of them changed.
    if (typed.access0 !== undefined && [0, 1, 2, 3].some(function (i) { return typed["access" + i] !== live["access" + i]; })) {
      patch.access = FR_ACCESS.filter(function (a, i) { return typed["access" + i]; }).map(function (a) { return a[0]; });
    }
    var target = frParsePounds(typed.target);
    if (typeof target === "number" && isNaN(target)) errors.targetPence = frPoundsMessage(typed.target, "250");
    else if (target !== (f.targetPence === undefined ? null : f.targetPence)) patch.targetPence = target;
    var counts = {};
    FR_COUNTS.forEach(function (c) {
      var raw = String(typed[c[0]] === undefined ? live[c[0]] : typed[c[0]]).trim();
      if (!/^\d+$/.test(raw)) errors["wants." + c[0]] = "Give a whole number, like " + c[1] + ", or 0 for none.";
      else counts[c[0]] = Number(raw);
    });
    if (Object.keys(errors).length) {
      frEditErrors = errors;
      frSay("edit", "Some of it needs another look", true);
      frRenderList();
      return;
    }
    var wants = {
      posterCount: counts.posterCount, leafletCount: counts.leafletCount, bucketCount: counts.bucketCount, tinCount: counts.tinCount,
      leaflets: counts.leaflets, buckets: counts.buckets, qrCount: counts.qrCount, shoutOut: !!typed.shoutOut, attend: !!typed.attend,
    };
    var countChanged = FR_COUNTS.some(function (c) { return String(wants[c[0]]) !== live[c[0]]; });
    if (countChanged || wants.shoutOut !== live.shoutOut || wants.attend !== live.attend) {
      patch.wants = wants; // the server takes what they would like as a whole
    }
    if (!Object.keys(patch).length) {
      frEditErrors = {};
      frSay("edit", "Nothing has changed, so there is nothing to save.", false);
      frRenderList();
      return;
    }
    frEditErrors = {};
    frRun("edit", "Saving…", function (run) {
      return frSend("PATCH", "/api/admin/fundraisers/" + f.id, patch).then(function (r) {
        if (!r.ok) {
          if (run.open()) {
            if (r.status === 400 && r.body && r.body.fields) frEditErrors = r.body.fields;
            else if (r.status === 409) frEditErrors = { slug: frRefusal(r, "Another fundraiser already uses that web address") };
          }
          run.say(frRefusal(r, "That did not save. Please try again."), true);
          return;
        }
        if (run.open()) {
          frEditDraft = null;
          frEditErrors = {};
        }
        run.say("Saved.", false);
        return frReload();
      });
    });
  }

  function frAddCash(form) {
    if (frBusy) return;
    var f = frOpenRecord();
    if (!f) return;
    function val(n) {
      var i = form.querySelector('[name="' + n + '"]');
      return i ? String(i.value || "") : "";
    }
    frCashDraft = { amount: val("amount"), paidInOn: val("paidInOn"), note: val("note") };
    var pence = frParsePounds(frCashDraft.amount);
    if (pence === null || isNaN(pence) || pence < 1) {
      frCashErrors = { amountPence: frPoundsMessage(frCashDraft.amount, "12") };
      frSay("cash", "", false);
      frRenderList();
      return;
    }
    frCashErrors = {};
    var body = { amountPence: pence, paidInOn: frCashDraft.paidInOn, note: frCashDraft.note.trim() };
    frRun("cash", "Adding…", function (run) {
      return frSend("POST", "/api/admin/fundraisers/" + f.id + "/cash", body).then(function (r) {
        if (!r.ok) {
          if (run.open() && r.status === 400 && r.body && r.body.fields) frCashErrors = r.body.fields;
          run.say(frRefusal(r, "That was not added. Please try again."), true);
          return;
        }
        // Added: the form empties, so the same amount is not sitting there ready to go twice.
        if (run.open()) frCashDraft = null;
        run.say(frMoney(pence) + " added. The meter now counts it.", false);
        return frReload();
      });
    });
  }

  function frRemoveCash(cashId) {
    if (frBusy) return;
    var f = frOpenRecord();
    if (!f) return;
    var row = (frDetail.cash || []).filter(function (c) { return String(c.id) === String(cashId); })[0];
    if (!row) return;
    if (!window.confirm("Remove " + frMoney(row.amountPence) + " paid in on " + H.fmtDate(row.paidInOn) + "? The meter comes down by the same.")) return;
    frRun("cash", "Removing…", function (run) {
      return frSend("DELETE", "/api/admin/fundraisers/" + f.id + "/cash/" + encodeURIComponent(cashId)).then(function (r) {
        run.say(r.ok ? frMoney(row.amountPence) + " removed." : frRefusal(r, "That was not removed. Please try again."), !r.ok);
        return frReload();
      });
    });
  }

  function frWallChoice(donationId, hide) {
    if (frBusy) return;
    var f = frOpenRecord();
    if (!f) return;
    frRun("detail", null, function (run) {
      return frSend("POST", "/api/admin/fundraisers/" + f.id + "/wall/" + encodeURIComponent(donationId) + "/" + (hide ? "hide" : "show"))
        .then(function (r) {
          if (!r.ok) run.say(frRefusal(r, "That did not work. Please try again."), true);
          return frReload();
        });
    });
  }

  function frUploadPhoto(input) {
    if (frBusy) return;
    var f = frOpenRecord();
    var file = input.files && input.files[0];
    if (!f || !file) return;
    frRun("photo", "Uploading…", function (run) {
      return new Promise(function (finish) {
        // evUpload writes its progress into this; what it says is kept in frNotice instead, so the
        // redraw after an upload cannot throw the message away.
        var sink = doc.createElement("p");
        evUpload(
          file,
          sink,
          function (src) {
            frSend("PATCH", "/api/admin/fundraisers/" + f.id, { imageSrc: src })
              .then(function (r) {
                run.say(r.ok ? "Uploaded. It is the photo on its page now." : frRefusal(r, "The photo did not save. Please try again."), !r.ok);
                return frReload();
              })
              .then(finish, function (err) {
                if (!(err && err.message === "unauthorized")) run.say("The photo did not save. Please try again.", true);
                finish();
              });
          },
          "/api/admin/fundraiser-images",
          function (message) {
            if (message) run.say(message, true);
            finish();
          }
        );
      });
    });
  }

  // TASK-504: open one of a fundraiser's materials in its own tab. The admin API needs the session,
  // which a plain link would not carry, so the page is fetched with it and shown from memory. The
  // tab is opened at once, while the click still counts, so no pop up blocker stops it.
  // Mind: a blob: page made here runs in the ADMIN's origin, beside the staff session, so every
  // stored field the server draws into it (src/fundraising/materials.ts) must stay escaped.
  function frOpenMaterial(piece) {
    var f = frDetail && frDetail.fundraiser;
    if (!f) return;
    var id = f.id;
    var tab = window.open("", "_blank");
    try {
      if (tab) {
        tab.document.title = "Opening";
        tab.document.body.textContent = "Opening, one moment.";
      }
    } catch (e) { /* a tab we cannot write to still navigates */ }
    authFetch("/api/admin/fundraisers/" + id + "/materials/" + encodeURIComponent(piece))
      .then(function (res) { return res.ok ? res.text() : Promise.reject(new Error("failed")); })
      .then(function (page) {
        var url = URL.createObjectURL(new Blob([page], { type: "text/html" }));
        if (tab && !tab.closed) tab.location.href = url;
        else window.open(url, "_blank");
        setTimeout(function () { URL.revokeObjectURL(url); }, 120000);
      })
      .catch(function () {
        if (tab && !tab.closed) tab.close();
        frSay("detail", "Could not open that. Try again.", true, id);
        frPaintNotice("detail");
      });
  }

  function frWire() {
    if (frWired) return;
    frWired = true;
    el("frSwitchBtn").addEventListener("click", frFlipSwitch);
    var view = el("view-fundraising");
    frNewsWire(view); // TASK-506
    frPicsWire(view); // profile pictures
    frGroupWire(view); // team pages
    frPackWire(view); // welcome packs
    view.addEventListener("click", function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var chip = t.closest("[data-frfilter]");
      if (chip) {
        frFilter = chip.getAttribute("data-frfilter") || "";
        frRenderList();
        return;
      }
      var kindChip = t.closest("[data-frkind]");
      if (kindChip) {
        frSetKind(kindChip.getAttribute("data-frkind") || "");
        frRenderList();
        return;
      }
      var more = t.closest("[data-frmore]");
      if (more) {
        var key = more.getAttribute("data-frmore");
        frMore[key] = true;
        if (key === "history") frPaintHistory();
        else frRenderList();
        return;
      }
      var action = t.closest("[data-fraction]");
      if (action) return frMove(action.getAttribute("data-fraction"));
      if (t.closest("[data-frshortname]")) return frUseShortName();
      var material = t.closest("[data-frmaterial]");
      if (material) return frOpenMaterial(material.getAttribute("data-frmaterial"));
      var decide = t.closest("[data-fredit]");
      if (decide) return frDecideEdit(decide);
      var remove = t.closest("[data-frcashremove]");
      if (remove) return frRemoveCash(remove.getAttribute("data-frcashremove"));
      var hide = t.closest("[data-frhide]");
      if (hide) return frWallChoice(hide.getAttribute("data-frhide"), true);
      // In memory
      var memApprove = t.closest("[data-frmemapprove]");
      if (memApprove) return frMemoryApprove(memApprove.getAttribute("data-frmemapprove"));
      if (t.closest("[data-frmemyearon]")) return frMemoryYearOnDone();
      if (t.closest("[data-frmemsave]")) return frMemorySave();
      // The sign up tidy
      if (t.closest("[data-frtshirtask]")) return frTshirtAsk();
      var show = t.closest("[data-frshow]");
      if (show) return frWallChoice(show.getAttribute("data-frshow"), false);
      // TASK-503: the team's tools.
      var callBtn = t.closest("[data-frcall]");
      if (callBtn) return frRecordCall(callBtn.getAttribute("data-frcall"));
      var listBtn = t.closest("[data-frlist]");
      if (listBtn) return frSetList(listBtn.getAttribute("data-frlist") === "off");
      // TASK-505: the Requests part.
      var reqBtn = t.closest("[data-frreqact]");
      if (reqBtn) return frReqAct(reqBtn.getAttribute("data-frreqkind"), reqBtn.getAttribute("data-frreqact"));
      if (t.closest("[data-frreqcancel]")) return frReqCancel();
      var resend = t.closest("[data-frinviteresend]");
      if (resend) return frResendInvite(resend.getAttribute("data-frinviteresend"));
      var removeInvite = t.closest("[data-frinviteremove]");
      if (removeInvite) return frRemoveInvite(removeInvite.getAttribute("data-frinviteremove"));
      var removeTo = t.closest("[data-frsummaryremove]");
      if (removeTo) return frSummaryRemove(removeTo.getAttribute("data-frsummaryremove"));
      if (t.closest("#frSummaryAdd")) return frSummaryAdd();
      // The Categories card (admins).
      if (t.closest("#frCatsAdd")) return frCatAdd();
      var catRename = t.closest("[data-frcatrename]");
      if (catRename) return frCatStartRename(catRename.getAttribute("data-frcatrename"));
      if (t.closest("[data-frcatsave]")) return frCatSaveRename();
      if (t.closest("[data-frcatcancel]")) return frCatCancelRename();
      var catHide = t.closest("[data-frcathide]");
      if (catHide) return frCatSetActive(catHide.getAttribute("data-frcathide"), false);
      var catShow = t.closest("[data-frcatshow]");
      if (catShow) return frCatSetActive(catShow.getAttribute("data-frcatshow"), true);
      if (t.closest("#frSummaryTest")) return frSummaryTest();
      // Last, so a control inside the open sign up never also closes it.
      var toggle = t.closest("[data-frtoggle]");
      if (toggle) frToggle(toggle.getAttribute("data-frtoggle"));
    });
    view.addEventListener("submit", function (e) {
      var form = e.target;
      if (!form || !form.id) return;
      if (form.id === "frEditForm") {
        e.preventDefault();
        frSaveEdit(form);
      } else if (form.id === "frCashForm") {
        e.preventDefault();
        frAddCash(form);
      } else if (form.id === "frInviteForm") {
        e.preventDefault();
        frSendInvite();
      } else if (form.id === "frReqForm") {
        e.preventDefault();
        frReqSubmit(form);
      } else if (form.id === "frSplitForm") {
        e.preventDefault();
        frSaveSplit(form);
      } else if (form.id === "frWelcomeForm") {
        e.preventDefault();
        frSaveWelcome(form); // the sign up tidy
      }
    });
    // What is typed is kept as it is typed, so a redraw (another action, a reload) never loses it.
    function keepTyping(e) {
      var t = e.target;
      if (!t || !t.closest) return;
      if (t.id === "frDeclineReason") frReasonDraft = t.value;
      if (t.id === "frCallNote") frCallDraft = t.value;
      if (t.id === "frCatRename") frCatDraft = t.value;
      // TASK-505: the open request's form; of the radios, the one chosen.
      if (t.closest("#frReqForm") && t.name && (t.type !== "radio" || t.checked)) frReqDraft[t.name] = String(t.value || "");
      // Only the boxes typed in are kept: the rest always show what is live now.
      if (t.closest("#frEditForm") && t.name) {
        frEditDraft = frEditDraft || {};
        frEditDraft[t.name] = t.type === "checkbox" ? !!t.checked : String(t.value || "");
        // TASK-511 review: what Other is, as soon as it is chosen.
        if (t.name === "kind") {
          var other = t.closest("#frEditForm").querySelector("[data-frkindother]");
          var said = other && other.querySelector("input");
          if (other) other.hidden = t.value !== "other" && !(said && String(said.value || "").trim());
        }
      }
      var cashForm = t.closest("#frCashForm");
      if (cashForm) {
        frCashDraft = {
          amount: cashForm.querySelector('[name="amount"]').value,
          paidInOn: cashForm.querySelector('[name="paidInOn"]').value,
          note: cashForm.querySelector('[name="note"]').value,
        };
      }
      if (t.matches && t.matches("textarea.fr-input")) nlFitBox(t);
    }
    view.addEventListener("input", keepTyping);
    view.addEventListener("change", function (e) {
      if (e.target && e.target.id === "frPhotoInput") return frUploadPhoto(e.target);
      if (e.target && e.target.name === "sharesWithOther" && e.target.closest && e.target.closest("#frSplitForm")) {
        return frSplitChoice(e.target.closest("#frSplitForm"));
      }
      // The sign up tidy: the size only for a sporting event; and a category's Sporting tick.
      if (e.target && e.target.name === "isSporting" && e.target.closest && e.target.closest("#frWelcomeForm")) {
        return frWelcomeChoice(e.target.closest("#frWelcomeForm"));
      }
      if (e.target && e.target.hasAttribute && e.target.hasAttribute("data-frcatsporty")) {
        return frCatSetSporty(e.target.getAttribute("data-frcatsporty"), !!e.target.checked);
      }
      // Invite types: what they are invited to do was chosen, so read that email.
      if (e.target && e.target.id === "frInviteType") return frInviteTypeChanged();
      // The signer changed: the email being read is signed by them, so read it again.
      if (e.target && e.target.id === "frInviteSigner") return frInviteType() ? frInviteTypeChanged(true) : undefined;
      keepTyping(e);
    });
    // The invite email being read is as tall as it is, whenever it loads, opens or the window changes.
    var inviteFrame = el("frInviteWordingFrame");
    if (inviteFrame) {
      inviteFrame.addEventListener("load", function () {
        frInviteFit();
        if (window.requestAnimationFrame) window.requestAnimationFrame(frInviteFit);
      });
      if (el("frInviteRead")) el("frInviteRead").addEventListener("toggle", frInviteFit);
      window.addEventListener("resize", frInviteFit);
    }
    // The rows are role="button", so they answer Enter and Space as a button does.
    view.addEventListener("keydown", function (e) {
      // TASK-503: Enter in the summary's address box adds it, as the button does.
      if (e.key === "Enter" && e.target && e.target.id === "frSummaryEmail") {
        e.preventDefault();
        frSummaryAdd();
        return;
      }
      // The Categories card: Enter adds or saves the name typed; Escape leaves a rename as it was.
      if (e.target && e.target.id === "frCatsNew" && e.key === "Enter") {
        e.preventDefault();
        frCatAdd();
        return;
      }
      if (e.target && e.target.id === "frCatRename" && (e.key === "Enter" || e.key === "Escape")) {
        e.preventDefault();
        if (e.key === "Enter") frCatSaveRename();
        else frCatCancelRename();
        return;
      }
      if (e.key !== "Enter" && e.key !== " " && e.key !== "Spacebar") return;
      var t = e.target;
      if (!t || !t.closest || t.closest("button, a, input, select, textarea")) return;
      var toggle = t.closest("[data-frtoggle]");
      if (!toggle) return;
      e.preventDefault();
      frToggle(toggle.getAttribute("data-frtoggle"));
    });
    frThanksWire(view); // TASK-507
    frTouchWire(view); // TASK-515
    frImpactWire(view); // What gifts could do
  }

  // ---- news updates (TASK-506) ----
  // The news updates organisers post from their private area (src/routes/fundraiser-news.ts). Every
  // one waits for staff. The list shows "Updates to check" on a sign up with any waiting, and the
  // open sign up has a News updates panel: the words, the photo (fetched with this sign in, as a
  // waiting photo has no public address, and shown small), Approve and Don't use (with an optional
  // reason that stays here, for staff only), and Hide for one on the page. Approving or not using
  // one emails the organiser: the server does that. Every stored string is escaped. Kept here, in
  // one block, apart from the rest of the screen.
  var FR_NEWS_FIRST = 10;
  var frNewsCounts = {}; // fundraiser id -> how many wait
  var frNewsRows = null; // { id, rows } or { id, failed } for the open sign up
  var frNewsReasons = {}; // update id -> the reason typed for not using it
  var frNewsPhotos = {}; // photo address -> its data: address, "loading" or "failed"
  var FR_NEWS_STATUS = {
    pending: { label: "Waiting for us to check", cls: "admin-pill--pending" },
    approved: { label: "On the page", cls: "admin-pill--active" },
    rejected: { label: "Not used", cls: "admin-pill--cancelled" },
    hidden: { label: "Hidden from the page", cls: "admin-pill--cancelled" },
  };

  function frNewsPill(f) {
    return frNewsCounts[f.id] ? '<span class="admin-pill admin-pill--pending fr-news-pill">Updates to check</span>' : "";
  }

  function frNewsSection() {
    return '<section class="fx-panel fx-panel--wide fr-news-panel"><h4>News updates</h4><div id="frNews"></div></section>';
  }

  function frLoadNewsCounts() {
    return authFetch("/api/admin/fundraising/news-waiting")
      .then(okJson)
      .then(function (d) {
        frNewsCounts = d && d.counts && typeof d.counts === "object" ? d.counts : {};
        frRenderList();
      })
      .catch(function () {
        /* only a pill: the list works without it */
      });
  }

  function frLoadNews(id) {
    return authFetch("/api/admin/fundraisers/" + encodeURIComponent(id) + "/news")
      .then(okJson)
      .then(function (d) {
        if (frOpenId !== id) return;
        frNewsRows = { id: id, rows: d && Array.isArray(d.updates) ? d.updates : [] };
        frPaintNews();
      })
      .catch(function (err) {
        if (err && err.message === "unauthorized") return;
        if (frOpenId !== id) return;
        frNewsRows = { id: id, failed: true };
        frPaintNews();
      });
  }

  function frNewsItem(u, write) {
    var st = FR_NEWS_STATUS[u.status] || { label: String(u.status || ""), cls: "" };
    var id = Number(u.id);
    var when = "Posted " + H.fmtDate(u.createdAt) + (u.decidedBy ? ", decided by " + frWho(u.decidedBy) : "");
    var photo = typeof u.photoUrl === "string" && /^\/api\/admin\/fundraisers\/\d+\/news\/\d+\/photo$/.test(u.photoUrl) ? u.photoUrl : "";
    var actions = "";
    if (write && u.status === "pending") {
      actions =
        '<label class="fx-call-label" for="frNewsReason' + id + '">Why not use it (optional, for staff only)</label>' +
        '<textarea class="fx-call-input fr-input" id="frNewsReason' + id + '" rows="1" maxlength="500" data-frnewsreason="' + id + '">' +
          H.escapeHtml(frNewsReasons[id] || "") + "</textarea>" +
        '<div class="fx-call-row fr-actions">' +
          '<button class="admin-btn admin-btn--small" type="button" data-frnews="approve" data-frnewsid="' + id + '">Approve update</button>' +
          '<button class="admin-btn admin-btn--small fr-btn-quiet" type="button" data-frnews="reject" data-frnewsid="' + id + '">Don\'t use it</button>' +
        "</div>";
    } else if (write && u.status === "approved") {
      actions = '<button class="fr-link-btn" type="button" data-frnews="hide" data-frnewsid="' + id + '">Hide from the page</button>';
    } else if (write && u.status === "hidden") {
      actions = '<button class="fr-link-btn" type="button" data-frnews="show" data-frnewsid="' + id + '">Show on the page again</button>';
    }
    return (
      '<li data-frnewsitem="' + id + '"' + (u.status === "hidden" || u.status === "rejected" ? ' class="is-hidden"' : "") + ">" +
        '<div class="fr-wall-head"><span class="admin-pill ' + st.cls + '">' + H.escapeHtml(st.label) + "</span>" +
          '<span class="fx-hist-who">' + H.escapeHtml(when) + "</span></div>" +
        (photo ? '<img class="fr-news-photo" data-frnewsphoto="' + H.escapeHtml(photo) + '" alt="The photo with this update" hidden>' : "") +
        '<p class="fr-wall-msg fr-news-text">' + H.escapeHtml(u.text || "") + "</p>" +
        (u.status === "rejected" && u.rejectReason
          ? '<p class="fx-help">Our reason, for staff only: ' + H.escapeHtml(u.rejectReason) + "</p>"
          : "") +
        actions +
      "</li>"
    );
  }

  function frPaintNews() {
    var box = el("frNews");
    if (!box || frOpenId == null) return;
    var s = frNewsRows && frNewsRows.id === frOpenId ? frNewsRows : null;
    var status = frNoticeHtml("news", "frNewsStatus");
    if (!s) {
      box.innerHTML = '<p class="admin-loading">Loading…</p>';
      return;
    }
    if (s.failed) {
      box.innerHTML = '<div role="alert">' +
        unavailableHtml("The news updates could not load just now. Close this sign up and open it again in a moment.") + "</div>";
      return;
    }
    if (!s.rows.length) {
      box.innerHTML = '<p class="fx-empty">No news updates yet. The organiser can post them from their private area while their page is up.</p>' + status;
      return;
    }
    var write = frCanWrite();
    var waitingRows = s.rows.filter(function (u) { return u.status === "pending"; });
    var rows = waitingRows.concat(s.rows.filter(function (u) { return u.status !== "pending"; }));
    // Every waiting one always shows; the rest, ten and then Show all.
    var shown = frMore.news ? rows : rows.slice(0, Math.max(FR_NEWS_FIRST, waitingRows.length));
    box.innerHTML =
      '<p class="fx-help">Each update waits for you, newest first. Approve it and it goes on their page; either way the organiser is emailed. ' +
        "On the page a photo shows small, beside the words.</p>" +
      '<ul class="fr-wall fr-news-list">' + shown.map(function (u) { return frNewsItem(u, write); }).join("") + "</ul>" +
      frMoreButton("news", shown.length, rows.length) + status;
    nlFitBoxes(Array.prototype.slice.call(box.querySelectorAll("textarea.fr-input")));
    Array.prototype.forEach.call(box.querySelectorAll("img[data-frnewsphoto]"), function (img) {
      frNewsPhoto(img.getAttribute("data-frnewsphoto"));
    });
    frRestDetail();
  }

  // A photo, with this sign in: a waiting one has no public address. Kept as a data: address, so a
  // redraw shows it again at once.
  function frNewsPhoto(url) {
    var have = frNewsPhotos[url];
    if (have === "loading") return;
    if (have) return frShowNewsPhoto(url);
    frNewsPhotos[url] = "loading";
    authFetch(url)
      .then(function (res) {
        if (!res.ok) throw new Error("status " + res.status);
        return res.blob();
      })
      .then(function (blob) {
        return new Promise(function (done, fail) {
          var reader = new window.FileReader();
          reader.onload = function () { done(String(reader.result || "")); };
          reader.onerror = fail;
          reader.readAsDataURL(blob);
        });
      })
      .then(function (dataUrl) {
        frNewsPhotos[url] = /^data:image\/(jpeg|png|webp);base64,/.test(dataUrl) ? dataUrl : "failed";
        frShowNewsPhoto(url);
      })
      .catch(function () {
        frNewsPhotos[url] = "failed";
        frShowNewsPhoto(url);
      });
  }
  function frShowNewsPhoto(url) {
    var v = frNewsPhotos[url];
    Array.prototype.forEach.call(doc.querySelectorAll("#frNews img[data-frnewsphoto]"), function (img) {
      if (img.getAttribute("data-frnewsphoto") !== url) return;
      if (v && v.indexOf("data:") === 0) {
        img.src = v;
        img.hidden = false;
      } else if (v === "failed") {
        var p = doc.createElement("p");
        p.className = "fx-empty";
        p.textContent = "The photo could not load. Close this sign up and open it again to try once more.";
        img.parentNode.replaceChild(p, img);
      }
    });
  }

  function frNewsDecide(btn) {
    if (frBusy) return;
    var f = frOpenRecord();
    if (!f) return;
    var which = btn.getAttribute("data-frnews");
    var uid = btn.getAttribute("data-frnewsid");
    var question = {
      approve: "Approve this news update? It goes on the page straight away, and the organiser is emailed to say so.",
      reject: "Not use this news update? It stays off the page, and the organiser is emailed a short, kind note to say we will be in touch. Your reason stays here, for staff only.",
      hide: "Hide this news update? It comes off the page straight away. The organiser is not emailed.",
      show: "Show this news update on the page again?",
    }[which];
    if (!question || !window.confirm(question)) return;
    var body = {};
    if (which === "reject") {
      var reason = String(frNewsReasons[uid] || "").trim();
      if (reason) body.reason = reason;
    }
    frRun("news", "Saving…", function (run) {
      return frSend("POST", "/api/admin/fundraisers/" + f.id + "/news/" + encodeURIComponent(uid) + "/" + which, body).then(function (r) {
        if (!r.ok) run.say(frRefusal(r, "That did not work. Please try again."), true);
        else {
          if (which === "reject") delete frNewsReasons[uid];
          run.say({
            approve: "Approved. It is on the page now, and the organiser is emailed to say so.",
            reject: "Not used. It stays off the page, and the organiser is emailed a short, kind note.",
            hide: "Hidden. It is off the page now.",
            show: "It is back on the page.",
          }[which], false);
        }
        return Promise.all([frLoadNews(f.id), frLoadNewsCounts(), frLoadHistory(f.id)]);
      });
    });
  }

  function frNewsWire(view) {
    view.addEventListener("click", function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var b = t.closest("[data-frnews]");
      if (b) frNewsDecide(b);
    });
    view.addEventListener("input", function (e) {
      var t = e.target;
      if (!t || !t.getAttribute) return;
      var uid = t.getAttribute("data-frnewsreason");
      if (uid === null) return;
      frNewsReasons[uid] = t.value;
      nlFitBox(t);
    });
  }

  // ---- photos from the organiser (profile pictures, Jaimie, 2026-10-03) ----
  // The main photo and the round photo of themselves an organiser sends from their private area
  // (src/routes/fundraiser-pictures.ts). Every one waits for staff. The list shows "Photos to check"
  // on a sign up with any waiting, and the open sign up has a panel: each photo shown as the page will
  // show it (a round one beside "Organised by", a main one big), fetched with this sign in as a
  // waiting photo has no public address; Approve and Don't use (with an optional note the organiser
  // sees in their private area), and Take it off the page for one in use (a main photo comes off the
  // page too). Admins can also Delete for good. Approving a main photo makes it the page's photo, as
  // "Photo for its page" shows. Nothing is emailed. Every stored string is escaped. Kept here, in one
  // block, apart from the rest of the screen.
  var frPicsCounts = {}; // fundraiser id -> how many wait
  var frPicsRows = null; // { id, rows, organisedBy } or { id, failed } for the open sign up
  var frPicsNotes = {}; // picture id -> the note typed for the organiser
  var frPicsPhotos = {}; // photo address -> its data: address, "loading" or "failed"
  var FR_PICS_STATUS = {
    pending: { label: "Waiting for you to check", cls: "admin-pill--pending" },
    approved: { label: "In use on the page", cls: "admin-pill--active" },
    declined: { label: "Not used", cls: "admin-pill--cancelled" },
    removed: { label: "Taken off the page", cls: "admin-pill--cancelled" },
    replaced: { label: "Replaced by a newer one", cls: "admin-pill--cancelled" },
  };

  function frPicsPill(f) {
    return frPicsCounts[f.id] ? '<span class="admin-pill admin-pill--pending fr-pics-pill">Photos to check</span>' : "";
  }

  function frPicsSection() {
    return '<section class="fx-panel fx-panel--wide fr-pics-panel"><h4>Photos from the organiser</h4><div id="frPics"></div></section>';
  }

  function frLoadPicsCounts() {
    return authFetch("/api/admin/fundraising/pictures-waiting")
      .then(okJson)
      .then(function (d) {
        frPicsCounts = d && d.counts && typeof d.counts === "object" ? d.counts : {};
        frRenderList();
      })
      .catch(function () {
        /* only a pill: the list works without it */
      });
  }

  function frLoadPics(id) {
    return authFetch("/api/admin/fundraisers/" + encodeURIComponent(id) + "/pictures")
      .then(okJson)
      .then(function (d) {
        if (frOpenId !== id) return;
        frPicsRows = { id: id, rows: d && Array.isArray(d.pictures) ? d.pictures : [], organisedBy: (d && d.organisedBy) || "" };
        frPaintPics();
      })
      .catch(function (err) {
        if (err && err.message === "unauthorized") return;
        if (frOpenId !== id) return;
        frPicsRows = { id: id, failed: true };
        frPaintPics();
      });
  }

  function frPicsItem(p, write, organisedBy) {
    var st = FR_PICS_STATUS[p.status] || { label: String(p.status || ""), cls: "" };
    var id = Number(p.id);
    var round = p.kind === "profile";
    var when = "Sent " + H.fmtDate(p.createdAt) + (p.decidedBy && p.decidedBy !== "organiser" ? ", decided by " + frWho(p.decidedBy) : "");
    var photo = typeof p.photoUrl === "string" && /^\/api\/admin\/fundraisers\/\d+\/pictures\/\d+\/photo$/.test(p.photoUrl) ? p.photoUrl : "";
    var shown = !photo
      ? ""
      : round
        ? '<p class="fr-pic-as-page"><img class="fr-pic-round" data-frpicphoto="' + H.escapeHtml(photo) + '" alt="The round photo" width="64" height="64" hidden>' +
            "<span>Organised by " + H.escapeHtml(organisedBy || "") + "</span></p>"
        : '<img class="fr-pic-main" data-frpicphoto="' + H.escapeHtml(photo) + '" alt="The main photo" hidden>';
    var actions = "";
    if (write && p.status === "pending") {
      actions =
        '<label class="fx-call-label" for="frPicNote' + id + '">A note for the organiser (optional). They see it in their private area.</label>' +
        '<textarea class="fx-call-input fr-input" id="frPicNote' + id + '" rows="1" maxlength="500" data-frpicnote="' + id + '">' +
          H.escapeHtml(frPicsNotes[id] || "") + "</textarea>" +
        '<div class="fx-call-row fr-actions">' +
          '<button class="admin-btn admin-btn--small" type="button" data-frpic="approve" data-frpicid="' + id + '" data-frpickind="' + (round ? "profile" : "main") + '">Approve photo</button>' +
          '<button class="admin-btn admin-btn--small fr-btn-quiet" type="button" data-frpic="decline" data-frpicid="' + id + '" data-frpickind="' + (round ? "profile" : "main") + '">Don\'t use it</button>' +
        "</div>";
    } else if (write && p.status === "approved") {
      actions = '<button class="fr-link-btn" type="button" data-frpic="remove" data-frpicid="' + id + '" data-frpickind="' + (round ? "profile" : "main") + '">Take it off the page</button>';
    }
    // Review: an admin can delete a photo for good (its record, its bytes and any copy on the page).
    if (write && isAdmin()) {
      actions += '<button class="fr-link-btn fr-pic-delete" type="button" data-frpic="delete" data-frpicid="' + id + '" data-frpickind="' + (round ? "profile" : "main") + '">Delete for good</button>';
    }
    return (
      '<li data-frpicitem="' + id + '"' + (p.status === "pending" || p.status === "approved" ? "" : ' class="is-hidden"') + ">" +
        '<div class="fr-wall-head"><span class="admin-pill ' + st.cls + '">' + H.escapeHtml(st.label) + "</span>" +
          '<b class="fr-pic-kind">' + (round ? "Round photo" : "Main photo") + "</b>" +
          '<span class="fx-hist-who">' + H.escapeHtml(when) + "</span></div>" +
        (photo ? shown : '<p class="fx-empty">The photo itself has been deleted. Only this record of it is kept.</p>') +
        (p.note ? '<p class="fx-help">Our note to the organiser: ' + H.escapeHtml(p.note) + "</p>" : "") +
        actions +
      "</li>"
    );
  }

  function frPaintPics() {
    var box = el("frPics");
    if (!box || frOpenId == null) return;
    var s = frPicsRows && frPicsRows.id === frOpenId ? frPicsRows : null;
    var status = frNoticeHtml("pics", "frPicsStatus");
    if (!s) {
      box.innerHTML = '<p class="admin-loading">Loading…</p>';
      return;
    }
    if (s.failed) {
      box.innerHTML = '<div role="alert">' +
        unavailableHtml("The photos could not load just now. Close this sign up and open it again in a moment.") + "</div>";
      return;
    }
    // A photo a newer one replaced was never seen by anyone: it is left out.
    var rows = s.rows.filter(function (p) { return p.status !== "replaced"; });
    if (!rows.length) {
      box.innerHTML = '<p class="fx-empty">No photos from the organiser yet. They can send a main photo and a round photo of themselves from their private area while their page is up.</p>' + status;
      return;
    }
    var write = frCanWrite();
    var waitingRows = rows.filter(function (p) { return p.status === "pending"; });
    rows = waitingRows.concat(rows.filter(function (p) { return p.status !== "pending"; }));
    box.innerHTML =
      '<p class="fx-help">Each photo waits for you, and shows here as their page will show it. ' +
        "Nothing is emailed: the organiser sees where it is up to in their private area.</p>" +
      '<p class="fx-help fr-pics-check">Check: it is them or their day; everyone in it looks happy to be there; no child is named or shown in school uniform; ' +
        "no address, car number plate or anything private shows.</p>" +
      '<ul class="fr-wall fr-pics-list">' + rows.map(function (p) { return frPicsItem(p, write, s.organisedBy); }).join("") + "</ul>" + status;
    nlFitBoxes(Array.prototype.slice.call(box.querySelectorAll("textarea.fr-input")));
    Array.prototype.forEach.call(box.querySelectorAll("img[data-frpicphoto]"), function (img) {
      frPicsPhoto(img.getAttribute("data-frpicphoto"));
    });
    frRestDetail();
  }

  // A photo, with this sign in: a waiting one has no public address. Kept as a data: address, so a
  // redraw shows it again at once.
  function frPicsPhoto(url) {
    var have = frPicsPhotos[url];
    if (have === "loading") return;
    if (have) return frShowPicsPhoto(url);
    frPicsPhotos[url] = "loading";
    authFetch(url)
      .then(function (res) {
        if (!res.ok) throw new Error("status " + res.status);
        return res.blob();
      })
      .then(function (blob) {
        return new Promise(function (done, fail) {
          var reader = new window.FileReader();
          reader.onload = function () { done(String(reader.result || "")); };
          reader.onerror = fail;
          reader.readAsDataURL(blob);
        });
      })
      .then(function (dataUrl) {
        frPicsPhotos[url] = /^data:image\/(jpeg|png|webp);base64,/.test(dataUrl) ? dataUrl : "failed";
        frShowPicsPhoto(url);
      })
      .catch(function () {
        frPicsPhotos[url] = "failed";
        frShowPicsPhoto(url);
      });
  }
  function frShowPicsPhoto(url) {
    var v = frPicsPhotos[url];
    Array.prototype.forEach.call(doc.querySelectorAll("#frPics img[data-frpicphoto]"), function (img) {
      if (img.getAttribute("data-frpicphoto") !== url) return;
      if (v && v.indexOf("data:") === 0) {
        img.src = v;
        img.hidden = false;
      } else if (v === "failed") {
        var p = doc.createElement("p");
        p.className = "fx-empty";
        p.textContent = "The photo could not load. Close this sign up and open it again to try once more.";
        img.parentNode.replaceChild(p, img);
      }
    });
  }

  function frPicsDecide(btn) {
    if (frBusy) return;
    var f = frOpenRecord();
    if (!f) return;
    var which = btn.getAttribute("data-frpic");
    var pid = btn.getAttribute("data-frpicid");
    var round = btn.getAttribute("data-frpickind") === "profile";
    var question = {
      approve: round
        ? "Approve this round photo? It goes beside their name on their page straight away, and on their team's page if they are in one."
        : "Approve this main photo? It becomes the photo at the top of their page straight away, in place of any photo there now.",
      decline: "Not use this photo? It stays off the page. The organiser sees it was not used in their private area, with your note if you wrote one.",
      remove: round
        ? "Take this round photo off the page? It comes off straight away. The organiser sees it was taken off in their private area."
        : "Take this main photo off the page? It comes off their page straight away, and the page shows no photo until another is approved or added. The organiser sees it was taken off in their private area.",
      delete: "Delete this photo for good? It comes off the page if it is on it, and the photo and its record are deleted. Only the History keeps a note that it was deleted. This cannot be undone.",
    }[which];
    if (!question || !window.confirm(question)) return;
    var body = {};
    if (which === "decline") {
      var note = String(frPicsNotes[pid] || "").trim();
      if (note) body.reason = note;
    }
    frRun("pics", "Saving…", function (run) {
      return frSend("POST", "/api/admin/fundraisers/" + f.id + "/pictures/" + encodeURIComponent(pid) + "/" + which, body).then(function (r) {
        if (!r.ok) run.say(frRefusal(r, "That did not work. Please try again."), true);
        else {
          if (which === "decline") delete frPicsNotes[pid];
          run.say({
            approve: "Approved. It is on their page now.",
            decline: "Not used. The organiser sees that in their private area.",
            remove: "Taken off the page.",
            delete: "Deleted for good.",
          }[which], false);
        }
        var again = [frLoadPics(f.id), frLoadPicsCounts(), frLoadHistory(f.id)];
        // A main photo approved, taken off or deleted changes the page's photo: "Photo for its page" shows it.
        if (r.ok && !round && which !== "decline") again.push(frLoadDetail(f.id));
        return Promise.all(again);
      });
    });
  }

  function frPicsWire(view) {
    view.addEventListener("click", function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var b = t.closest("[data-frpic]");
      if (b) frPicsDecide(b);
    });
    view.addEventListener("input", function (e) {
      var t = e.target;
      if (!t || !t.getAttribute) return;
      var pid = t.getAttribute("data-frpicnote");
      if (pid === null) return;
      frPicsNotes[pid] = t.value;
      nlFitBox(t);
    });
  }

  // ---- team pages (Jaimie, 2026-10-03) ----
  // A team page and its members. In the list, a team is marked Team and a member sign up says which
  // team it is joining. In an open team: its split (the whole team's, or just the team organiser's),
  // its join link, its meter for the whole team, its members (every status, A to Z), the people its
  // team organiser added and where each invite is up to, and the handover of the team organiser role
  // (editors and admins; the new team organiser confirms with a code we email them). In an open
  // member sign up: the team it is joining. GET /api/admin/fundraisers/:id/team decides it all; this
  // only says it. Every stored string is escaped. ("frGroup" in the code, as frTeam is the team's
  // tools of TASK-503.)
  var frGroupView = null; // { id, data } or { id, failed } for the open sign up
  var frGroupDraft = {}; // the handover boxes, so a redraw keeps what was typed

  var FR_INVITE_WORDS = {
    held: "Held until you approve the team",
    sent: "Invited",
    reminded: "Invited, and reminded once",
    joined: "Joined",
    deleted: "Name and email deleted",
  };
  var FR_MEMBER_WORDS = { new: "Waiting for you to approve", approved: "Live", declined: "Declined", finished: "Finished" };

  function frGroupTitleOf(id) {
    var list = (frData && frData.fundraisers) || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i].title;
    return "";
  }

  function frGroupPills(f) {
    // A team's own row says so on its large kind pill; a member's row says which team.
    if (f.teamId && !f.teamLeftAt) {
      var title = frGroupTitleOf(f.teamId);
      // Waiting for staff: joining; approved since: on the team.
      var words = f.status === "new" ? "Joining " : "On the team ";
      return '<span class="admin-pill' + (f.status === "new" ? " admin-pill--pending" : "") + ' fr-joining-pill">' +
        H.escapeHtml(title ? words + title : words + "(a team)") + "</span>";
    }
    return "";
  }

  function frGroupSection(f) {
    if (!f.isTeam && !f.teamId) return "";
    return '<section class="fx-panel fx-panel--wide fr-group-panel"><h4>Team</h4><div id="frTeam"></div>' +
      frNoticeHtml("group", "frTeamStatus") + "</section>";
  }

  function frLoadGroup(id) {
    return authFetch("/api/admin/fundraisers/" + encodeURIComponent(id) + "/team")
      .then(okJson)
      .then(function (d) {
        if (frOpenId !== id) return;
        frGroupView = { id: id, data: d || {} };
        frPaintGroup();
      })
      .catch(function (err) {
        if (err && err.message === "unauthorized") return;
        if (frOpenId !== id) return;
        frGroupView = { id: id, failed: true };
        frPaintGroup();
      });
  }

  function frGroupMeter(m) {
    if (!m) return "";
    return "<p><strong>" + H.escapeHtml(frMoney(m.raisedPence) + " raised" + (m.targetPence ? " of " + frMoney(m.targetPence) : "") + ", by the whole team") +
      "</strong>" + (m.giftAidPence ? " " + H.escapeHtml("+ " + frMoney(m.giftAidPence) + " Gift Aid") : "") + "</p>";
  }

  function frGroupHandoverHtml(d, write) {
    var h = d.handover;
    if (h) {
      return '<p class="fx-help">' + H.escapeHtml(
        "Waiting for " + h.toFirstName + " " + h.toLastName + " (" + h.toEmail + ") to confirm with the code we emailed on " +
          H.fmtDate(h.createdAt) + ". Until they do, nothing changes.") + "</p>" +
        (write ? '<button class="admin-btn admin-btn--small fr-btn-quiet" type="button" data-frteam-cancel>Cancel the handover</button>' : "");
    }
    if (!write) return '<p class="fx-help">Editors and admins can hand the team organiser role to someone else here.</p>';
    var v = frGroupDraft;
    // Only to an approved member still on the team, or someone new.
    var members = (d.members || []).filter(function (m) { return !m.left && m.status === "approved"; });
    var options = '<option value="">Someone new</option>' + members.map(function (m) {
      return '<option value="' + Number(m.id) + '"' + (String(v.memberId || "") === String(m.id) ? " selected" : "") + ">" + H.escapeHtml(m.name) + "</option>";
    }).join("");
    var box = function (id, label, key, type, auto) {
      return '<div class="fx-field"><label for="' + id + '">' + label + "</label>" +
        '<input class="fr-input" id="' + id + '" type="' + type + '" autocomplete="' + auto + '" data-frteam-box="' + key + '" value="' + H.escapeHtml(v[key] || "") + '"></div>';
    };
    var someoneNew = !v.memberId;
    return '<p class="fx-help">Only when the team asks. We email the new team organiser a code; nothing changes until they put it in on their private area page. It works for 3 days.</p>' +
      '<div class="fx-field"><label for="frTeamMember">Hand it to</label><select class="fr-input" id="frTeamMember" data-frteam-member>' + options + "</select></div>" +
      (someoneNew ? box("frTeamFirst", "First name", "firstName", "text", "off") + box("frTeamLast", "Surname", "lastName", "text", "off") +
        box("frTeamEmail", "Email", "email", "email", "off") : "") +
      box("frTeamPhone", "Their phone" + (someoneNew ? "" : " (optional)"), "phone", "tel", "off") +
      '<div class="fx-call-row fr-actions"><button class="admin-btn admin-btn--small" type="button" data-frteam-handover>Email them a code</button></div>';
  }

  function frPaintGroup() {
    var box = el("frTeam");
    if (!box || frOpenId == null) return;
    var s = frGroupView && frGroupView.id === frOpenId ? frGroupView : null;
    if (!s) {
      box.innerHTML = '<p class="admin-loading">Loading…</p>';
      return;
    }
    if (s.failed) {
      box.innerHTML = '<div role="alert">' + unavailableHtml("The team could not load just now. Close this sign up and open it again in a moment.") + "</div>";
      return;
    }
    var d = s.data;
    if (d.kind === "member") {
      var t = d.team || {};
      box.innerHTML = "<p>" + H.escapeHtml((d.left ? "Was on the team " : "Joining the team ") + (t.title || "")) + "</p>" +
        (t.shareMode === "team" ? '<p class="fx-help">The whole team shares the same split, so this page has the team&rsquo;s. Correct it on the team.</p>' : "");
      return;
    }
    if (d.kind !== "team") {
      box.innerHTML = "";
      return;
    }
    var write = frCanWrite();
    var members = d.members || [];
    var invites = d.invites || [];
    box.innerHTML =
      "<p>" + H.escapeHtml(d.split || "") + "</p>" +
      '<p class="fx-help">Join link: <a href="' + H.escapeHtml(d.joinUrl || "") + '" target="_blank" rel="noopener">' +
        H.escapeHtml(String(d.joinUrl || "").replace(/^https?:\/\//, "")) + "</a></p>" +
      frGroupMeter(d.meter) +
      "<h5>Members</h5>" +
      (members.length
        ? '<ul class="fr-wall fr-group-list">' + members.map(function (m) {
            var words = m.left ? "Taken off the team" : FR_MEMBER_WORDS[m.status] || m.status;
            // Staff can take a current member off the team, as its team organiser can.
            var remove = write && !m.left && m.status !== "declined"
              ? ' <button class="fr-link-btn" type="button" data-frteam-remove="' + Number(m.id) + '" data-frteam-name="' + H.escapeHtml(m.name) + '">Take off the team</button>'
              : "";
            return "<li><strong>" + (m.pageUrl ? '<a href="' + H.escapeHtml(m.pageUrl) + '" target="_blank" rel="noopener">' + H.escapeHtml(m.name) + "</a>" : H.escapeHtml(m.name)) +
              "</strong> " + H.escapeHtml("(" + m.email + ")") + ' <span class="fx-hist-who">' + H.escapeHtml(words + ", " + frMoney(m.raisedPence) + " raised") + "</span>" + remove + "</li>";
          }).join("") + "</ul>"
        : '<p class="fx-empty">Nobody has joined yet.</p>') +
      "<h5>People the team organiser added</h5>" +
      (invites.length
        ? '<ul class="fr-wall fr-group-list">' + invites.map(function (i) {
            var when = i.status === "joined" ? i.joinedAt : i.status === "deleted" ? i.deletedAt : i.status === "reminded" ? i.remindedAt : i.sentAt;
            // Ticked under 18 by the team organiser: the email is their parent's or guardian's.
            var mail = i.email ? " (" + (i.under18 ? "under 18, parent or guardian’s email: " : "") + i.email + ")" : "";
            var who = i.name ? i.name + mail : "Name and email deleted";
            return "<li><strong>" + H.escapeHtml(who) + '</strong> <span class="fx-hist-who">' +
              H.escapeHtml((FR_INVITE_WORDS[i.status] || i.status) + (when ? ", " + H.fmtDate(when) : "")) + "</span></li>";
          }).join("") + "</ul>"
        : '<p class="fx-empty">Nobody was added. The team organiser can share the join link.</p>') +
      "<h5>Hand over the team organiser role</h5>" + frGroupHandoverHtml(d, write);
    frRestDetail();
  }

  function frGroupHandover() {
    var f = frOpenRecord();
    if (!f || frBusy) return;
    // What the boxes say now, whether or not they were typed into.
    var boxRoot = el("frTeam");
    if (boxRoot) {
      Array.prototype.forEach.call(boxRoot.querySelectorAll("[data-frteam-box]"), function (b) {
        frGroupDraft[b.getAttribute("data-frteam-box")] = b.value;
      });
      var pickNow = boxRoot.querySelector("[data-frteam-member]");
      if (pickNow) frGroupDraft.memberId = pickNow.value;
    }
    var v = frGroupDraft;
    var body = v.memberId
      ? { memberId: Number(v.memberId), phone: String(v.phone || "").trim() }
      : { firstName: String(v.firstName || "").trim(), lastName: String(v.lastName || "").trim(), email: String(v.email || "").trim(), phone: String(v.phone || "").trim() };
    if (v.memberId && !body.phone) delete body.phone;
    if (!window.confirm("Hand over the team organiser role? We will email them a code. Nothing changes until they put it in.")) return;
    frRun("group", "Sending…", function (run) {
      return frSend("POST", "/api/admin/fundraisers/" + f.id + "/team/handover", body).then(function (r) {
        if (!r.ok) {
          var fields = r.body && r.body.fields ? Object.keys(r.body.fields).map(function (k) { return r.body.fields[k]; }).join(" ") : "";
          run.say(fields || frRefusal(r, "That did not work. Please try again."), true);
        } else {
          frGroupDraft = {};
          run.say(r.body.emailed === false ? "Saved, but the email did not go. Cancel it and try again." : "We have emailed them the code.", r.body.emailed === false);
        }
        return Promise.all([frLoadGroup(f.id), frLoadHistory(f.id)]);
      });
    });
  }

  function frGroupCancel() {
    var f = frOpenRecord();
    if (!f || frBusy) return;
    if (!window.confirm("Cancel this handover? The code we emailed stops working.")) return;
    frRun("group", "Cancelling…", function (run) {
      return frSend("POST", "/api/admin/fundraisers/" + f.id + "/team/handover/cancel", {}).then(function (r) {
        run.say(r.ok ? "Cancelled. The code no longer works." : frRefusal(r, "That did not work. Please try again."), !r.ok);
        return Promise.all([frLoadGroup(f.id), frLoadHistory(f.id)]);
      });
    });
  }

  function frGroupRemove(btn) {
    var f = frOpenRecord();
    if (!f || frBusy) return;
    var mid = btn.getAttribute("data-frteam-remove");
    var name = btn.getAttribute("data-frteam-name") || "them";
    if (!window.confirm("Take " + name + " off the team? Their page stays up as their own, and what it raises no longer counts towards the team.")) return;
    frRun("group", "Saving…", function (run) {
      return frSend("POST", "/api/admin/fundraisers/" + f.id + "/team/members/" + encodeURIComponent(mid) + "/remove", {}).then(function (r) {
        run.say(r.ok ? name + " is off the team." : frRefusal(r, "That did not work. Please try again."), !r.ok);
        return Promise.all([frLoadGroup(f.id), frLoadHistory(f.id), frLoadList()]);
      });
    });
  }

  function frGroupWire(view) {
    view.addEventListener("click", function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var rm = t.closest("[data-frteam-remove]");
      if (rm) frGroupRemove(rm);
      else if (t.closest("[data-frteam-handover]")) frGroupHandover();
      else if (t.closest("[data-frteam-cancel]")) frGroupCancel();
    });
    view.addEventListener("input", function (e) {
      var t = e.target;
      if (!t || !t.getAttribute || t.getAttribute("data-frteam-box") === null) return;
      frGroupDraft[t.getAttribute("data-frteam-box")] = t.value;
    });
    view.addEventListener("change", function (e) {
      var t = e.target;
      if (!t || !t.hasAttribute || !t.hasAttribute("data-frteam-member")) return;
      frGroupDraft.memberId = t.value;
      frPaintGroup();
    });
  }

  // ---- keeping in touch (TASK-515) ----
  // The Automatic emails card: every automatic email to an organiser, rendered by the server
  // (src/routes/admin-fundraising-touch.ts) for the invented example or for one fundraiser raising
  // money, so each can be read before any is sent; and the switch, for admins only (it ships off).
  // On each fundraiser: a pill for each smart call prompt (src/fundraising/call-prompts.ts), and in
  // the open sign up the reason, the talking points and Called, with which automatic emails it has
  // had. The server decides everything; this only says it. Every stored string is escaped.
  var frTouch = null; // GET /api/admin/fundraising/touch: { today, settings, kinds, sent, prompts, promptCalls }
  var frTouchState = "loading"; // loading, failed or ok
  var frTouchBusy = false;
  var frTouchNotes = {}; // prompt key -> the note typed for its call, kept across a redraw
  var FR_TOUCH_EMAIL_W = 660;

  function frTouchLoad() {
    var card = el("frTouch");
    if (!card) return;
    return authFetch("/api/admin/fundraising/touch")
      .then(okJson)
      .then(function (d) {
        var ok = d && d.settings && Array.isArray(d.kinds);
        var was = frTouchState;
        frTouch = ok ? d : null;
        frTouchState = ok ? "ok" : "failed";
        frTouchRenderCard();
        // The pills and the open sign up's panel come from it; a second failure changes nothing.
        if (ok || was !== "failed") frRenderList();
      })
      .catch(function (err) {
        if (err && err.message === "unauthorized") return;
        var was = frTouchState;
        frTouch = null;
        frTouchState = "failed";
        frTouchRenderCard();
        if (was !== "failed") frRenderList();
      });
  }

  function frTouchKindInfo(kind) {
    var kinds = (frTouch && frTouch.kinds) || [];
    for (var i = 0; i < kinds.length; i++) if (kinds[i].kind === kind) return kinds[i];
    return null;
  }

  function frTouchRenderCard() {
    var card = el("frTouch");
    if (!card) return;
    if (!frTouch) {
      card.hidden = frTouchState !== "failed";
      el("frTouchState").textContent = frTouchState === "failed" ? "The automatic emails could not load just now. Try again in a moment." : "Checking…";
      return;
    }
    card.hidden = false;
    var s = frTouch.settings;
    card.classList.toggle("is-on", !!s.on);
    el("frTouchState").innerHTML = s.on
      ? "<b>On.</b> They go by themselves, each morning at 8am, and when you mark a fundraiser finished." +
        (s.updatedBy ? " Switched on " + H.escapeHtml(H.fmtDate(s.updatedAt)) + " by " + H.escapeHtml(frWho(s.updatedBy)) + "." : "")
      : "<b>Off.</b> None of these is sent. Read each one in All emails, then switch them on when you are happy.";
    // What the next run would send, so the first morning after switching on is no surprise.
    var due = frTouch.due || {};
    var dueIds = Object.keys(due);
    var byKind = {};
    dueIds.forEach(function (id) { byKind[due[id]] = (byKind[due[id]] || 0) + 1; });
    var dueWords = (frTouch.kinds || []).filter(function (k) { return byKind[k.kind]; }).map(function (k) {
      return k.label + " (" + byKind[k.kind] + ")";
    });
    el("frTouchDue").textContent = dueIds.length
      ? (s.on ? "The next 8am run sends up to " : "Switched on now, the next 8am run would send up to ") +
        (dueIds.length === 1 ? "1 email: " : dueIds.length + " emails: ") + dueWords.join(", ") +
        ". " + "Anyone who has asked us to stop is left out."
      : (s.on ? "Nothing is due at the next 8am run." : "Switched on now, the next 8am run would send nothing.");
    if (frTouch.approvalsUnavailable) el("frTouchDue").textContent += " " + FR_TOUCH_UNCHECKED;
    var heldCount = Object.keys(frTouch.held || {}).length;
    if (heldCount) {
      el("frTouchDue").textContent += " " + (heldCount === 1 ? "1 more is" : heldCount + " more are") + " waiting for your sign off.";
    }
    var btn = el("frTouchSwitch");
    var admin = isAdmin() && frCanWrite();
    btn.hidden = !admin;
    btn.textContent = s.on ? "Switch automatic emails off" : "Switch automatic emails on";
    btn.disabled = frTouchBusy;
    el("frTouchSwitchNote").hidden = admin;
  }

  // Reading and approving the emails themselves is in the All emails card (assets/js/admin/all-emails.js).
  // It asks for these when it draws "Show it for": every public page raising money that is approved
  // or finished, so an automatic email can be read as it would go today to a real fundraiser.
  // And whether to offer Approve and Withdraw: an admin who can also edit Fundraising, which is what
  // the server asks of them (authorizeSectionAsAdmin), read from /api/admin/me, not the token.
  window.AdminFundraising = {
    canApprove: function () {
      return isAdmin() && frCanWrite();
    },
    raisingPages: function () {
      return ((frData && frData.fundraisers) || [])
        .filter(function (f) { return f.path === "raising" && f.public && (f.status === "approved" || f.status === "finished"); })
        .map(function (f) { return { id: f.id, title: f.title, name: f.name }; });
    },
  };

  var FR_TOUCH_UNCHECKED = "Couldn't check sign-offs just now, so new wording is held.";

  function frTouchSwitch() {
    if (frTouchBusy || !frTouch) return;
    var on = !frTouch.settings.on;
    var question = on
      ? "Switch the automatic emails on? From the next 8am run they go to real organisers by themselves: first gift, halfway, target, a week before and after their date, need a hand, doing great and a year on, and the thank you when you mark one finished. Only switch on once you have read every one."
      : "Switch the automatic emails off? Nothing more goes until an admin switches them on again.";
    if (!window.confirm(question)) return;
    frTouchBusy = true;
    frTouchRenderCard();
    frTeamSay("frTouchStatus", "Saving…", false);
    frSend("PUT", "/api/admin/fundraising/touch/settings", { on: on })
      .then(function (r) {
        frTouchBusy = false;
        if (!r.ok) {
          frTeamSay("frTouchStatus", frRefusal(r, "That did not work. Please try again."), true);
          frTouchRenderCard();
          return;
        }
        frTouch.settings = r.body;
        frTouchRenderCard();
        frTeamSay("frTouchStatus", on ? "Automatic emails are on." : "Automatic emails are off.", false);
      })
      .catch(function (err) {
        frTouchBusy = false;
        if (err && err.message === "unauthorized") return;
        frTeamSay("frTouchStatus", "That did not work. Please try again.", true);
        frTouchRenderCard();
      });
  }

  // Is the thank you (17) for this sign up waiting for sign off, as it would go with what it has
  // raised? The list's meter, as the server reads it: a team page's whole team total.
  function frTouchFinishedWaiting(f) {
    var info = frTouchKindInfo("finished");
    if (!info || !info.waiting) return false;
    var listed = ((frData && frData.fundraisers) || []).filter(function (x) { return x.id === f.id; })[0];
    var m = (listed && listed.meter) || (frDetail && frDetail.meter) || {};
    var raised = Number(m.raisedPence || 0);
    return info.waiting.indexOf(raised > 0 ? "finished" : "finished_zero") !== -1;
  }

  function frTouchPrompts(f) {
    return (frTouch && frTouch.prompts && frTouch.prompts[f.id]) || [];
  }

  // The pills on the list, one for each prompt.
  function frTouchPills(f) {
    return frTouchPrompts(f)
      .map(function (p) {
        var tone = p.key === "behind" || p.key === "quiet" ? " is-call-due" : p.key === "ahead" || p.key === "on_track" ? " fr-prompt-good" : " admin-pill--pending";
        return '<span class="admin-pill fr-prompt-pill' + tone + '" data-frprompt-pill="' + H.escapeHtml(p.key) + '" title="' + H.escapeHtml(p.reason) + '">' +
          H.escapeHtml(p.pill) + "</span>";
      })
      .join("");
  }

  // "Keeping in touch" in the open sign up: the prompts with Called, then the automatic emails.
  function frTouchSection(f, write) {
    if (!frTouch) {
      if (frTouchState !== "failed") return "";
      return '<section class="fx-panel fx-panel--wide" data-frtouch-panel><h4>Keeping in touch</h4><p class="fx-empty">This could not load just now.</p></section>';
    }
    var prompts = frTouchPrompts(f);
    var calls = (frTouch.promptCalls && frTouch.promptCalls[f.id]) || [];
    var sentList = (frTouch.sent && frTouch.sent[f.id]) || [];
    var labels = {};
    (frTouch.kinds || []).forEach(function (k) { labels[k.kind] = k.label; });
    var promptsHtml = prompts.length
      ? '<ul class="fr-prompts">' + prompts.map(function (p) {
          return '<li class="fr-prompt" data-frprompt="' + H.escapeHtml(p.key) + '">' +
            '<p class="fx-letter"><span class="fx-state fx-state--todo">' + H.escapeHtml(p.label) + "</span> " + H.escapeHtml(p.reason) + "</p>" +
            '<ul class="fr-prompt-points">' + p.points.map(function (t) { return "<li>" + H.escapeHtml(t) + "</li>"; }).join("") + "</ul>" +
            (write
              ? '<label class="fx-call-label" for="frPromptNote-' + H.escapeHtml(p.key) + '">Note about the call (optional)</label>' +
                '<textarea class="fx-call-input fr-input" id="frPromptNote-' + H.escapeHtml(p.key) + '" data-frpromptnote="' + H.escapeHtml(p.key) +
                '" rows="2" maxlength="500">' + H.escapeHtml(frTouchNotes[p.key] || "") + "</textarea>" +
                '<div class="fx-call-row"><button class="admin-btn admin-btn--small" type="button" data-frpromptcall="' + H.escapeHtml(p.key) + '">Called</button></div>'
              : "") +
            "</li>";
        }).join("") + "</ul>"
      : '<p class="fx-letter"><span class="fx-state fx-state--done">No calls suggested today</span></p>';
    var callsHtml = calls.length
      ? '<h5 class="fr-touch-h5">Calls about a prompt</h5><ul class="fr-touch-list">' + calls.slice().reverse().map(function (c) {
          return "<li>" + H.escapeHtml(H.fmtDate(c.calledAt) + (c.calledBy ? " by " + c.calledBy : "") + ": " + c.prompt.replace(/_/g, " ")) +
            (c.note ? '<span class="fr-field-hint">' + H.escapeHtml(c.note) + "</span>" : "") + "</li>";
        }).join("") + "</ul>"
      : "";
    var next = frTouch.due && frTouch.due[f.id];
    var sentHtml = '<h5 class="fr-touch-h5">Automatic emails it has had</h5><ul class="fr-touch-list" data-frtouchsent>' +
      (sentList.length
        ? sentList.map(function (s) { return "<li>" + H.escapeHtml((labels[s.kind] || s.kind) + ", " + H.fmtDate(s.sentAt)) + "</li>"; }).join("")
        : '<li class="fx-none">None yet.' + (frTouch.settings.on ? "" : " Automatic emails are switched off.") + "</li>") +
      "</ul>" +
      (next ? '<p class="fr-field-hint" data-frtouchnext>Next: ' + H.escapeHtml(labels[next] || next) +
        (frTouch.settings.on ? ", at the next 8am run." : ", once automatic emails are switched on.") + "</p>" : "") +
      (f.path === "raising" && f.public
        ? '<div class="fx-call-row"><button class="admin-btn admin-btn--small fr-btn-quiet" type="button" data-allemails-open="touch" data-allemails-fundraiser="' + f.id + '"' +
          (next ? ' data-allemails-touch="' + H.escapeHtml(next) + '"' : "") + ">Read its automatic emails</button></div>"
        : '<p class="fr-field-hint">Automatic emails only go to public pages raising money.</p>');
    return '<section class="fx-panel fx-panel--wide fr-touch-panel" data-frtouch-panel><h4>Keeping in touch</h4>' + promptsHtml + callsHtml + sentHtml +
      frNoticeHtml("touch", "frTouchCallStatus") + "</section>";
  }

  function frTouchRecordCall(key) {
    if (frBusy) return;
    var f = frOpenRecord();
    if (!f) return;
    var note = String(frTouchNotes[key] || "").trim();
    if (note.length > 500) {
      frSay("touch", "A note can be up to 500 characters.", true);
      frPaintNotice("touch");
      return;
    }
    frRun("touch", "Saving…", function (run) {
      var body = { prompt: key };
      if (note) body.note = note;
      return frSend("POST", "/api/admin/fundraisers/" + f.id + "/prompt-calls", body).then(function (r) {
        if (!r.ok) {
          run.say(frRefusal(r, "That was not recorded. Please try again."), true);
          return;
        }
        if (run.open()) delete frTouchNotes[key];
        run.say("Call recorded.", false);
        return Promise.all([frReload(), frTouchLoad()]);
      });
    });
  }

  function frTouchWire(view) {
    var card = el("frTouch");
    if (card) {
      card.addEventListener("click", function (e) {
        var t = e.target;
        if (!t || !t.closest) return;
        if (t.closest("#frTouchSwitch")) frTouchSwitch();
      });
      // A sign off changed in All emails: what is due, and what is held, is read again.
      view.addEventListener("nbcc:wording-changed", function () {
        frTouchLoad();
        frLoadTeam();
      });
    }
    view.addEventListener("click", function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var call = t.closest("[data-frpromptcall]");
      if (call) {
        frTouchRecordCall(call.getAttribute("data-frpromptcall"));
        return;
      }
    });
    view.addEventListener("input", function (e) {
      var t = e.target;
      if (t && t.getAttribute && t.getAttribute("data-frpromptnote")) frTouchNotes[t.getAttribute("data-frpromptnote")] = t.value;
    });
  }

  // ---- the team's tools (TASK-503) ----
  // Beside the list: "Invite someone" (editors and admins) with the invites not taken up, and the
  // Weekly summary card (admins). On each fundraiser: "Time to call" a week before and a week after
  // its date, as Business supporters have it, and "Take off Get involved?" four weeks after its date
  // or once the organiser says they've finished. The server decides what is due
  // (src/fundraising/follow-up.ts); this only says it. Every stored string is escaped.

  function frLoadTeam() {
    return authFetch("/api/admin/fundraising/team")
      .then(okJson)
      .then(function (d) {
        var ok = d && d.calls && typeof d.calls === "object" && Array.isArray(d.invites);
        frTeam = ok ? d : null;
        frTeamState = ok ? "ok" : "failed";
        frRenderInvitePanel();
        frRenderList();
      })
      .catch(function (err) {
        if (err && err.message === "unauthorized") return;
        frTeam = null;
        frTeamState = "failed";
        frRenderInvitePanel();
        frRenderList();
      });
  }

  function frCallDue(f) {
    var c = frTeam && frTeam.calls ? frTeam.calls[f.id] : null;
    return !!(c && c.due);
  }
  function frPrompt(f) {
    if (f.offListAt || !frTeam || !frTeam.prompts) return null;
    return frTeam.prompts[f.id] || null;
  }
  function frTeamSay(id, msg, isError) {
    var s = el(id);
    if (!s) return;
    s.textContent = msg || "";
    s.classList.toggle("is-error", !!isError);
    s.classList.toggle("is-ok", !isError && !!msg);
  }

  // ---- Time to call ----
  function frCallsSection(f, write) {
    if (!f.eventDate) return "";
    return '<section class="fx-panel fr-calls-panel" data-frcalls><h4>Calls</h4>' + frCallsPanel(f, write) + "</section>";
  }

  function frCallRow(label, s) {
    if (!s) return "";
    var v = s.called
      ? H.escapeHtml(H.fmtDate(s.called.calledAt) + (s.called.calledBy ? " by " + s.called.calledBy : ""))
      : '<span class="fx-none">Not called yet. Due from ' + H.escapeHtml(H.fmtDate(s.dueOn)) + "</span>";
    return fulfilRow(label, v) +
      (s.called && s.called.note ? fulfilRow("Note from that call", '<span class="fx-address">' + H.escapeHtml(s.called.note) + "</span>") : "");
  }

  function frCallsPanel(f, write) {
    var c = frTeam && frTeam.calls ? frTeam.calls[f.id] : null;
    if (!c) {
      return frTeamState === "loading" ? '<p class="admin-loading">Loading…</p>' : '<p class="fx-empty">The calls could not load just now.</p>';
    }
    var today = frTeam.today || "";
    var state;
    if (c.due && c.dueWhich && c[c.dueWhich]) {
      state = '<span class="fx-state fx-state--todo">Time to call</span> ' + FR_CALL_WORDS[c.dueWhich] + " is due since " +
        H.escapeHtml(H.fmtDate(c[c.dueWhich].dueOn)) + ".";
    } else {
      var next = [c.before, c.after].filter(function (s) { return s && !s.called && today < s.dueOn; })[0];
      if (f.status !== "approved" && f.status !== "finished") {
        state = '<span class="fx-state fx-state--waiting">No calls yet</span> They start once it is approved.';
      } else if (next && f.status === "approved") {
        state = '<span class="fx-state fx-state--done">Next call due ' + H.escapeHtml(H.fmtDate(next.dueOn)) + "</span>";
      } else {
        state = '<span class="fx-state fx-state--done">No calls due</span>';
      }
    }
    // Which call the button records: the one due, or else the next one still to make.
    var which = c.dueWhich;
    if (!which && f.status === "approved") {
      if (c.before && !c.before.called && c.after && today < c.after.dueOn) which = "before";
      else if (c.after && !c.after.called) which = "after";
    }
    var form = "";
    if (write && which) {
      form =
        '<div class="fx-call-form fr-call-form">' +
          '<label class="fx-call-label" for="frCallNote">Note about the call (optional)</label>' +
          '<textarea class="fx-call-input fr-input" id="frCallNote" rows="3" maxlength="500">' + H.escapeHtml(frCallDraft) + "</textarea>" +
          '<p class="fx-help">Up to 500 characters. This records ' + FR_CALL_WORDS[which].toLowerCase() + " as made today.</p>" +
          '<div class="fx-call-row"><button class="admin-btn admin-btn--small" type="button" data-frcall="' + which + '">Mark as called</button></div>' +
        "</div>";
    }
    return (
      '<p class="fx-letter">' + state + "</p>" +
      '<dl class="fx-dl">' + frCallRow("A week before", c.before) + frCallRow("A week after", c.after) + "</dl>" +
      form + frNoticeHtml("call", "frCallStatus")
    );
  }

  function frRecordCall(which) {
    if (frBusy || !FR_CALL_WORDS[which]) return;
    var f = frOpenRecord();
    if (!f) return;
    var note = String(frCallDraft || "").trim();
    if (note.length > 500) {
      frSay("call", "A note can be up to 500 characters.", true);
      frPaintNotice("call");
      return;
    }
    if (!window.confirm("Record " + FR_CALL_WORDS[which].toLowerCase() + " " + f.title + " as made today?\n\n" +
      "This is recorded against your name and clears the reminder.")) return;
    frRun("call", "Saving…", function (run) {
      var body = { which: which };
      if (note) body.note = note;
      return frSend("POST", "/api/admin/fundraisers/" + f.id + "/calls", body).then(function (r) {
        if (!r.ok) {
          run.say(frRefusal(r, "That was not recorded. Please try again."), true);
          return;
        }
        if (run.open()) frCallDraft = "";
        run.say("Call recorded.", false);
        return frReload();
      });
    });
  }

  // ---- Take off Get involved? ----
  function frOffListSection(f, write) {
    var prompt = frPrompt(f);
    var off = !!(f.offListAt && f.status === "approved");
    if (!off && !prompt) return "";
    var body;
    if (off) {
      // The sign up tidy: "No, only people you send the link to" on the sign up form.
      body = '<p class="fx-letter">' + (f.offListBy === "organiser"
        ? '<span class="fx-state fx-state--done">Not on Get involved</span> as they asked when they signed up: only people they send the link to. '
        : '<span class="fx-state fx-state--done">Taken off Get involved</span> on ' +
          H.escapeHtml(H.fmtDate(f.offListAt)) + (f.offListBy ? " by " + H.escapeHtml(frWho(f.offListBy)) : "") + ". ") +
        (f.path === "raising" || (f.path === "event" && f.public) ? "Its page and giving link still work, so late gifts still count." : "It is no longer on the list.") + "</p>" +
        (write ? '<div class="fx-call-row fr-actions"><button class="admin-btn admin-btn--small fr-btn-quiet" type="button" data-frlist="on">Put it back on Get involved</button></div>' : "");
    } else {
      body = '<p class="fx-letter"><span class="fx-state fx-state--todo">Take off Get involved?</span> ' +
        (prompt === "finished" ? "They say they've finished." : "It is four weeks past its date.") +
        " Taking it off only takes it off the Get involved list. Its page and giving link keep working.</p>" +
        (write ? '<div class="fx-call-row fr-actions"><button class="admin-btn admin-btn--small" type="button" data-frlist="off">Take it off</button></div>' : "");
    }
    return '<section class="fx-panel fx-panel--wide fr-offlist-panel" data-frofflist><h4>Get involved</h4>' + body +
      frNoticeHtml("list", "frListStatus") + "</section>";
  }

  function frSetList(off) {
    if (frBusy) return;
    var f = frOpenRecord();
    if (!f) return;
    var question = off
      ? "Take " + f.title + " off Get involved? It comes off the list only: its page and giving link keep working, so late gifts still count."
      : "Put " + f.title + " back on Get involved?";
    if (!window.confirm(question)) return;
    frRun("list", "Saving…", function (run) {
      return frSend("POST", "/api/admin/fundraisers/" + f.id + (off ? "/off-list" : "/on-list")).then(function (r) {
        if (!r.ok) run.say(frRefusal(r, "That did not work. Please try again."), true);
        else run.say(off ? "Taken off Get involved. Its page still works." : "Back on Get involved.", false);
        return frReload();
      });
    });
  }

  // ---- Requests (TASK-505) ----
  // What the organiser asked for on the form, tracked to done: posters and leaflets sent, buckets
  // and tins out and back, a shout out done, someone arranged to come along. The server works out
  // where each is up to and what can be done next (src/fundraising/requests.ts); this only says it,
  // and sends what staff enter, with the step they saw so a second press changes nothing. Every
  // stored string is escaped. Nothing scrolls inside: the small form grows the page.
  var FR_REQ_FLOW = {
    printed: ["to_send", "sent"], lent: ["to_send", "with_them", "back"],
    shout_out: ["to_do", "done"], attend: ["to_arrange", "arranged", "done"],
  };
  var FR_REQ_LABELS = {
    to_send: "To send", sent: "Sent", with_them: "With them", back: "Back",
    to_do: "To do", done: "Done", to_arrange: "To arrange", arranged: "Arranged",
  };
  var FR_REQ_BUTTONS = {
    send: "Mark as sent", out: "Mark as with them", back: "Mark as back", done: "Mark as done",
    arrange: "Mark as arranged", count: "Change the count", undo: "Undo",
  };

  function frLoadRequests() {
    return authFetch("/api/admin/fundraising/requests")
      .then(okJson)
      .then(function (d) {
        var ok = !!(d && d.requests && typeof d.requests === "object" && d.toDo && d.notBack);
        frReq = ok ? d : null;
        frReqState = ok ? "ok" : "failed";
        frRenderList();
      })
      .catch(function (err) {
        if (err && err.message === "unauthorized") return;
        frReq = null;
        frReqState = "failed";
        frRenderList();
      });
  }

  function frReqsOf(f) {
    var list = frReq && frReq.requests ? frReq.requests[f.id] : null;
    return Array.isArray(list) ? list : [];
  }
  function frReqView(f, kind) {
    return frReqsOf(f).filter(function (v) { return v.kind === kind; })[0] || null;
  }
  function frReqToDo(f) {
    return !!(frReq && frReq.toDo && frReq.toDo[f.id]);
  }
  function frReqNotBack(f) {
    return !!(frReq && frReq.notBack && frReq.notBack[f.id]);
  }
  function frReqDueBack(f) {
    return frReqsOf(f).some(function (v) { return v.dueBack === true; });
  }
  // Did they ask for anything? Read from the sign up itself, for when the requests could not load.
  function frAskedAnything(f) {
    var w = f.wants || {};
    return ["posterCount", "leafletCount", "bucketCount", "tinCount", "leaflets", "buckets", "qrCount"].some(function (k) {
      return Number(w[k]) > 0;
    }) || !!w.shoutOut || !!w.attend;
  }
  // The first name of whoever is signed in, to fill in "who"; they can change it.
  function frReqMe() {
    if (!frTeam || !Array.isArray(frTeam.signers)) return "";
    var me = frTeam.signers.filter(function (s) { return String(s.id) === String(frTeam.me); })[0];
    return me ? String(me.firstName || "") : "";
  }
  function frReqToday() {
    return (frReq && frReq.today) || evToday();
  }
  function frCap(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function frRequestsSection(f, write) {
    var body;
    if (frReqState !== "ok") {
      if (!frAskedAnything(f)) return "";
      body = frReqState === "loading"
        ? '<p class="admin-loading">Loading…</p>'
        : '<p class="fx-empty">The requests could not load just now.</p>';
    } else {
      var list = frReqsOf(f);
      if (!list.length) return "";
      body = '<p class="fx-help">What they asked for on the form, and where each one is up to.</p>' +
        '<ul class="fr-req-list">' + list.map(function (v) { return frReqItemHtml(f, v, write); }).join("") + "</ul>";
    }
    return '<section class="fx-panel fx-panel--wide fr-requests-panel" data-frrequests><h4>Requests</h4>' + body +
      frNoticeHtml("req", "frReqStatus") + "</section>";
  }

  function frReqStateHtml(v) {
    if (v.noPermission && v.status === "to_do") return '<span class="fx-state fx-state--todo">Asked, but no permission to post yet: ask them</span>';
    var tone = v.outstanding ? "todo" : v.status === "with_them" || v.status === "arranged" ? (v.dueBack ? "todo" : "waiting") : "done";
    return '<span class="fx-state fx-state--' + tone + '">' + H.escapeHtml(v.statusLabel || FR_REQ_LABELS[v.status] || "") + "</span>";
  }

  // What has been recorded so far, a line each, in words.
  function frReqFacts(v) {
    var facts = [];
    var by = function (who) { return who ? ", by " + who : ""; };
    var day = function (d) { return d ? H.fmtDate(d) : "a day not given"; };
    var many = function (n) { return n !== null && n !== undefined ? n + " " : ""; };
    if (v.noPermission && v.status === "to_do") {
      facts.push("They did not tick that we can post about it on NBCC’s social media. Once they say yes, tick it under Change the details.");
    }
    if (v.group === "printed" && v.status === "sent") {
      facts.push(frCap(many(v.quantity) + (v.how === "dropped_off" ? "dropped off" : "posted") + " on " + day(v.sentOn) + by(v.handledBy)));
    }
    if (v.group === "lent" && v.status !== "to_send") facts.push(frCap(many(v.quantity) + "went out on " + day(v.sentOn) + by(v.handledBy)));
    if (v.group === "lent" && v.status === "back") {
      var out = v.quantity !== null && v.quantity !== undefined ? v.quantity : v.asked;
      facts.push((v.quantityBack !== null && v.quantityBack !== undefined ? v.quantityBack + " of " + out + " came back" : "Came back") + " on " + day(v.backOn));
    }
    if (v.dueOn && v.status !== "back") facts.push("Due back on " + H.fmtDate(v.dueOn));
    if (v.group === "shout_out" && v.status === "done") facts.push("Posted on " + day(v.doneOn) + by(v.handledBy));
    if (v.group === "attend" && v.going) facts.push("Going: " + v.going);
    if (v.group === "attend" && v.status === "done") facts.push("Came along on " + day(v.doneOn));
    var lines = facts.map(function (s) { return "<li>" + H.escapeHtml(s) + "</li>"; });
    if (v.note) lines.push('<li class="fr-req-note">' + H.escapeHtml("Note: " + v.note) + "</li>");
    if (v.backNote) lines.push('<li class="fr-req-note">' + H.escapeHtml("On what came back: " + v.backNote) + "</li>");
    if (v.link && frIsWebLink(v.link)) {
      lines.push('<li>The post: <a class="fx-tel" href="' + H.escapeHtml(v.link) + '" target="_blank" rel="noopener noreferrer">' +
        H.escapeHtml(v.link) + "</a></li>");
    }
    return lines.length ? '<ul class="fr-req-facts">' + lines.join("") + "</ul>" : "";
  }

  function frReqItemHtml(f, v, write) {
    var kind = H.escapeHtml(v.kind);
    var asked = typeof v.asked === "number" && v.asked > 0 ? '<span class="fr-req-asked">' + v.asked + " asked for</span>" : "";
    var head = '<div class="fr-req-head"><span class="fr-req-label">' + H.escapeHtml(v.label) + "</span>" + asked + frReqStateHtml(v) +
      (v.dueBack ? '<span class="admin-pill is-call-due fr-dueback-pill">Due back</span>' : "") + "</div>";
    var open = write && frReqForm && frReqForm.kind === v.kind;
    var actions = "";
    if (open) {
      actions = frReqFormHtml(f, v, frReqForm.action);
    } else if (write && Array.isArray(v.actions) && v.actions.length) {
      actions = '<div class="fx-call-row fr-req-actions">' + v.actions.filter(function (a) { return FR_REQ_BUTTONS[a]; }).map(function (a) {
        var quiet = a === "undo" || a === "count" ? " fr-btn-quiet" : "";
        return '<button class="admin-btn admin-btn--small' + quiet + '" type="button" data-frreqkind="' + kind + '" data-frreqact="' + a + '">' +
          FR_REQ_BUTTONS[a] + "</button>";
      }).join("") + "</div>";
    }
    return '<li class="fr-req" data-frreq="' + kind + '">' + head + frReqFacts(v) + actions + "</li>";
  }

  // The small form for one step: only the boxes that step needs, filled in where we can.
  function frReqFormHtml(f, v, action) {
    var today = frReqToday();
    var d = frReqDraft;
    var e = frReqErrors;
    var val = function (name, start) {
      if (Object.prototype.hasOwnProperty.call(d, name)) return d[name];
      return start === null || start === undefined ? "" : String(start);
    };
    var err = function (name) {
      var msg = e[name];
      return '<p class="fr-err" id="frReqErr-' + name + '" data-frreqerr="' + name + '"' + (msg ? "" : " hidden") + ">" + H.escapeHtml(msg || "") + "</p>";
    };
    var bad = function (name) { return e[name] ? ' aria-invalid="true" aria-describedby="frReqErr-' + name + '"' : ""; };
    var field = function (name, label, input, wide) {
      return '<div class="fr-field' + (wide ? " fr-field--wide" : "") + '"><label class="fx-call-label" for="frReq-' + name + '">' + H.escapeHtml(label) +
        "</label>" + input + err(name) + "</div>";
    };
    var dateBox = function (label, start) {
      return field("on", label, '<input class="fx-call-input" id="frReq-on" name="on" type="date" max="' + H.escapeHtml(today) + '" value="' +
        H.escapeHtml(val("on", start)) + '"' + bad("on") + ">");
    };
    var countBox = function (label, start, max) {
      return field("quantity", label, '<input class="fx-call-input" id="frReq-quantity" name="quantity" type="number" inputmode="numeric" min="' +
        (action === "back" ? 0 : 1) + '" max="' + max + '" step="1" value="' + H.escapeHtml(val("quantity", start)) + '"' + bad("quantity") + ">");
    };
    var textBox = function (name, label, start, max) {
      return field(name, label, '<input class="fx-call-input" id="frReq-' + name + '" name="' + name + '" type="text" maxlength="' + max +
        '" autocomplete="off" value="' + H.escapeHtml(val(name, start)) + '"' + bad(name) + ">");
    };
    var noteBox = function (label) {
      return field("note", label, '<textarea class="fx-call-input fr-input" id="frReq-note" name="note" rows="2" maxlength="500"' + bad("note") + ">" +
        H.escapeHtml(val("note", "")) + "</textarea>", true);
    };
    var boxes = "";
    if (action === "send") {
      var how = val("how", "");
      boxes =
        dateBox("Date sent", today) +
        '<fieldset class="fr-field fr-field--wide fr-checks-group"><legend class="fx-call-label">How they went</legend>' +
          '<div class="fr-checks-row">' +
            '<label class="fr-check"><input type="radio" name="how" value="post"' + (how === "post" ? " checked" : "") + "> By post</label>" +
            '<label class="fr-check"><input type="radio" name="how" value="dropped_off"' + (how === "dropped_off" ? " checked" : "") + "> Dropped off</label>" +
          "</div>" + err("how") + "</fieldset>" +
        textBox("by", "Who sent them", frReqMe(), 100) +
        countBox("How many were sent", v.asked, 1000) +
        noteBox("Note (optional)");
    } else if (action === "out") {
      boxes = dateBox("Date they went out", today) + countBox("How many went out", v.asked, 20) +
        textBox("by", "Who handled it", frReqMe(), 100) + noteBox("Note (optional)");
    } else if (action === "back") {
      boxes = dateBox("Date they came back", today) +
        countBox("How many came back", v.quantity !== null && v.quantity !== undefined ? v.quantity : v.asked, 20) +
        noteBox("Note on the money inside, or any missing (optional)");
    } else if (action === "done" && v.group === "shout_out") {
      boxes = dateBox("Date it was posted", today) + textBox("by", "Who posted it", frReqMe(), 100) +
        textBox("link", "Link to the post (optional)", "", 500);
    } else if (action === "done") {
      boxes = dateBox("Date someone came along", f.eventDate && f.eventDate <= today ? f.eventDate : today);
    } else if (action === "arrange") {
      boxes = textBox("going", "Who is going", "", 200) + noteBox("Note (optional)");
    } else if (action === "count") {
      boxes = countBox("How many were actually sent", v.quantity, 1000);
    }
    return (
      '<form class="fx-call-form fr-form fr-req-form" id="frReqForm" data-frreqfor="' + H.escapeHtml(v.kind) + '" novalidate>' +
        '<p class="fr-form-head">' + H.escapeHtml(v.label + ": " + FR_REQ_BUTTONS[action].toLowerCase()) + "</p>" +
        boxes +
        '<div class="fx-call-row fr-field--wide"><button class="admin-btn admin-btn--small" type="submit">Save</button>' +
          '<button class="fr-link-btn" type="button" data-frreqcancel>Cancel</button></div>' +
      "</form>"
    );
  }

  function frReqClear() {
    frReqForm = null;
    frReqDraft = {};
    frReqErrors = {};
  }

  function frReqCancel() {
    if (frBusy) return;
    frReqClear();
    frRenderList();
  }

  function frReqAct(kind, action) {
    if (frBusy) return;
    var f = frOpenRecord();
    var v = f && frReqView(f, kind);
    if (!v || !Array.isArray(v.actions) || v.actions.indexOf(action) < 0) return;
    if (action === "undo") return frReqUndo(f, v);
    frReqClear();
    frReqForm = { kind: kind, action: action };
    frSay("req", "", false);
    frRenderList();
    var first = doc.querySelector("#frReqForm input, #frReqForm textarea");
    if (first && first.focus) first.focus({ preventScroll: true });
  }

  function frReqUndo(f, v) {
    var steps = FR_REQ_FLOW[v.group] || [];
    var prev = steps[steps.indexOf(v.status) - 1];
    if (!prev) return;
    if (!window.confirm("Undo " + v.label + "? It goes back from " + FR_REQ_LABELS[v.status] + " to " + FR_REQ_LABELS[prev] +
      ", and what was entered for that step is cleared.")) return;
    frReqSend(f, v, { action: "undo", from: v.status });
  }

  function frReqSubmit(form) {
    if (frBusy || !frReqForm) return;
    var f = frOpenRecord();
    var v = f && frReqView(f, frReqForm.kind);
    if (!v) return;
    var action = frReqForm.action;
    var box = function (name) { return form.querySelector('[name="' + name + '"]'); };
    var read = function (name) { var x = box(name); return x ? String(x.value || "").trim() : ""; };
    var body = { action: action, from: v.status };
    if (box("on")) body.on = read("on");
    if (action === "send") {
      var how = form.querySelector('[name="how"]:checked');
      if (!how) {
        frSay("req", "Say whether it was posted or dropped off.", true);
        frPaintNotice("req");
        return;
      }
      body.how = how.value;
    }
    if (box("by")) body.by = read("by");
    if (box("going")) body.going = read("going");
    if (box("quantity")) body.quantity = read("quantity") === "" ? null : Number(read("quantity"));
    if (read("note")) body.note = read("note");
    if (read("link")) body.link = read("link");
    frReqSend(f, v, body);
  }

  function frReqSend(f, v, body) {
    frRun("req", "Saving…", function (run) {
      return frSend("POST", "/api/admin/fundraisers/" + f.id + "/requests/" + encodeURIComponent(v.kind), body).then(function (r) {
        if (r.ok) {
          if (run.open()) frReqClear();
          var words = r.body && typeof r.body.words === "string" && r.body.words ? r.body.words + "." : "";
          run.say(body.action === "undo" ? words || "Undone." : "Saved." + (words ? " " + words : ""), false);
          return frReload();
        }
        if (r.status === 400 && r.body && r.body.fields && typeof r.body.fields === "object") {
          if (run.open()) frReqErrors = r.body.fields;
          run.say(frRefusal(r, "Some of it needs another look."), true);
          return;
        }
        // Someone else moved it on, or it is no longer there: show how it stands now.
        if (run.open()) frReqClear();
        run.say(frRefusal(r, "That was not saved. Please try again."), true);
        return frReload();
      });
    });
  }

  // ---- Thank yous to supporters (TASK-507) ----
  // The thank yous organisers send from their private area (src/routes/fundraiser-thanks.ts). Every
  // one waits for staff. The list shows "Thank yous to check" on a sign up with any waiting, and the
  // open sign up has a Thank yous panel: the organiser's words, the gifts it picked, Approve and
  // send, and Don't send (with an optional reason that stays here, for staff only). Approving makes
  // the server email each giver who can be emailed, in the background, from the events inbox; the
  // panel then shows what happened to each gift. The organiser only ever sees how many it reached.
  // Every stored string is escaped. Kept here, in one block, apart from the rest of the screen,
  // reached from it by one line hooks marked TASK-507.
  var FR_THANKS_GIFTS_FIRST = 10;
  var frThanksCounts = {}; // fundraiser id -> how many wait
  var frThanksRows = null; // { id, rows } or { id, failed } or { id, loading } for the open sign up
  var frThanksReasons = {}; // thank you id -> the reason typed for not sending it

  function frThanksPill(f) {
    return frThanksCounts[f.id] ? '<span class="admin-pill admin-pill--pending fr-thanksto-pill">Thank yous to check</span>' : "";
  }

  function frThanksSection() {
    return '<section class="fx-panel fx-panel--wide fr-thanksto-panel" data-frthanks-panel><h4>Thank yous to supporters</h4><div id="frThanks"></div></section>';
  }

  function frLoadThanksCounts() {
    return authFetch("/api/admin/fundraising/thanks-waiting")
      .then(okJson)
      .then(function (d) {
        frThanksCounts = d && d.counts && typeof d.counts === "object" ? d.counts : {};
        frRenderList();
      })
      .catch(function () {
        /* only a pill: the list works without it */
      });
  }

  function frLoadThanks(id) {
    frThanksRows = { id: id, loading: true };
    return authFetch("/api/admin/fundraisers/" + encodeURIComponent(id) + "/thanks")
      .then(okJson)
      .then(function (d) {
        if (frOpenId !== id) return;
        frThanksRows = { id: id, rows: d && Array.isArray(d.thanks) ? d.thanks : [] };
        frPaintThanks();
      })
      .catch(function (err) {
        if (err && err.message === "unauthorized") return;
        if (frOpenId !== id) return;
        frThanksRows = { id: id, failed: true };
        frPaintThanks();
      });
  }

  // Staff's own words for where it is up to (the organiser's are "Waiting for us to check" and so on).
  function frThanksState(t) {
    if (t.status === "pending") return { label: "Waiting for you to check", cls: "admin-pill--pending" };
    if (t.status === "rejected") return { label: "Not sent", cls: "admin-pill--cancelled" };
    if (Number(t.waiting) > 0 || !t.deliveredAt) return { label: "Sending now", cls: "admin-pill--active" };
    return { label: "Sent to " + Number(t.sent) + " of " + Number(t.gifts), cls: "admin-pill--active" };
  }

  function frThanksItem(t, write) {
    var id = Number(t.id);
    var st = frThanksState(t);
    var n = Number(t.gifts) || 0;
    var when = "Sent for checking " + H.fmtDate(t.createdAt) + ", for " + n + (n === 1 ? " gift" : " gifts") +
      (t.decidedBy ? ", decided by " + frWho(t.decidedBy) : "");
    var people = Array.isArray(t.recipients) ? t.recipients : [];
    var key = "thanks" + id;
    var shown = frMore[key] ? people : people.slice(0, FR_THANKS_GIFTS_FIRST);
    var list = people.length
      ? '<ul class="fr-thanksto-people">' + shown.map(function (g) {
          return "<li><span class=\"fr-thanksto-who\">" + H.escapeHtml(g.name || "") + "</span> · " + H.escapeHtml(frMoney(g.amountPence)) +
            ' · <span class="fr-thanksto-outcome">' + H.escapeHtml(g.outcomeWords || g.outcome || "") + "</span></li>";
        }).join("") + "</ul>" + frMoreButton(key, shown.length, people.length)
      : "";
    var actions = "";
    if (write && t.status === "pending") {
      actions =
        '<p class="fx-help">Approve it and we email it to each of these givers who can be emailed, from the events inbox, one at a time. ' +
          "The organiser never sees their addresses, and replies come to us.</p>" +
        '<label class="fx-call-label" for="frThanksReason' + id + '">Why not send it (optional, for staff only)</label>' +
        '<textarea class="fx-call-input fr-input" id="frThanksReason' + id + '" rows="1" maxlength="500" data-frthanksreason="' + id + '">' +
          H.escapeHtml(frThanksReasons[id] || "") + "</textarea>" +
        '<div class="fx-call-row fr-actions">' +
          '<button class="admin-btn admin-btn--small" type="button" data-frthanks="approve" data-frthanksid="' + id + '">Approve and send</button>' +
          '<button class="admin-btn admin-btn--small fr-btn-quiet" type="button" data-frthanks="reject" data-frthanksid="' + id + '">Don\'t send</button>' +
        "</div>";
    }
    return (
      '<li data-frthanksitem="' + id + '"' + (t.status === "rejected" ? ' class="is-hidden"' : "") + ">" +
        '<div class="fr-wall-head"><span class="admin-pill ' + st.cls + '">' + H.escapeHtml(st.label) + "</span>" +
          '<span class="fx-hist-who">' + H.escapeHtml(when) + "</span></div>" +
        '<p class="fr-wall-msg fr-thanksto-msg">' + H.escapeHtml(t.message || "") + "</p>" +
        (t.status === "rejected" && t.rejectReason ? '<p class="fx-help">Our reason, for staff only: ' + H.escapeHtml(t.rejectReason) + "</p>" : "") +
        list +
        actions +
      "</li>"
    );
  }

  function frPaintThanks() {
    // Closed: forget them, so opening it again reads them afresh (how many went, say).
    if (frOpenId == null) {
      frThanksRows = null;
      return;
    }
    var box = el("frThanks");
    if (!box) return;
    var s = frThanksRows && frThanksRows.id === frOpenId ? frThanksRows : null;
    if (!s) {
      frLoadThanks(frOpenId);
      s = frThanksRows;
    }
    if (s.loading) {
      box.innerHTML = '<p class="admin-loading">Loading…</p>';
      return;
    }
    if (s.failed) {
      box.innerHTML = '<div role="alert">' +
        unavailableHtml("The thank yous could not load just now. Close this sign up and open it again in a moment.") + "</div>";
      return;
    }
    var status = frNoticeHtml("thanks", "frThanksStatus");
    if (!s.rows.length) {
      box.innerHTML = '<p class="fx-empty">No thank yous yet. The organiser can send one to their supporters from their private area, and it waits here for you to check.</p>' + status;
      return;
    }
    var write = frCanWrite();
    var rows = s.rows.filter(function (t) { return t.status === "pending"; })
      .concat(s.rows.filter(function (t) { return t.status !== "pending"; }));
    box.innerHTML =
      '<p class="fx-help">The organiser picked these gifts and wrote this. Check the words: once approved, each giver gets it by email from us.</p>' +
      '<ul class="fr-wall fr-thanksto-list">' + rows.map(function (t) { return frThanksItem(t, write); }).join("") + "</ul>" + status;
    nlFitBoxes(Array.prototype.slice.call(box.querySelectorAll("textarea.fr-input")));
    frRestDetail();
  }

  function frThanksDecide(btn) {
    if (frBusy) return;
    var f = frOpenRecord();
    if (!f) return;
    var which = btn.getAttribute("data-frthanks");
    var tid = btn.getAttribute("data-frthanksid");
    var question = {
      approve: "Approve and send this thank you? We email it straight away to each giver it picked who can be emailed. It cannot be taken back.",
      reject: "Not send this thank you? Nobody is emailed, and its gifts can be thanked again in a new one. Your reason stays here, for staff only.",
    }[which];
    if (!question || !window.confirm(question)) return;
    var body = {};
    if (which === "reject") {
      var reason = String(frThanksReasons[tid] || "").trim();
      if (reason) body.reason = reason;
    }
    frRun("thanks", "Saving…", function (run) {
      return frSend("POST", "/api/admin/fundraisers/" + f.id + "/thanks/" + encodeURIComponent(tid) + "/" + which, body).then(function (r) {
        if (!r.ok) run.say(frRefusal(r, "That did not work. Please try again."), true);
        else {
          if (which === "reject") delete frThanksReasons[tid];
          run.say(which === "approve"
            ? "Approved. The emails are going now, one at a time. Open this sign up again later to see how many went."
            : "Not sent. Nobody is emailed, and the organiser sees it was not sent.", false);
        }
        return Promise.all([frLoadThanks(f.id), frLoadThanksCounts(), frLoadHistory(f.id)]);
      });
    });
  }

  // The History line for each thank you action, with its numbers or reason.
  function frThanksHistoryWhat(action, data) {
    var n = Number(data.gifts) || 0;
    if (action === "fundraiser.thanks_posted") return "The organiser sent a thank you to check, for " + n + (n === 1 ? " gift" : " gifts");
    if (action === "fundraiser.thanks_approved") return "Thank you approved and sent";
    if (action === "fundraiser.thanks_rejected") return "Thank you not sent" + (data.reason ? ": " + String(data.reason) : "");
    if (action === "fundraiser.thanks_delivered") {
      var not = (Number(data.skipped) || 0) + (Number(data.failed) || 0);
      return "Thank you emails done: " + (Number(data.sent) || 0) + " sent, " + not + " not sent";
    }
    return String(action || "");
  }

  // Who did it, in History: the sender's own step reads "Sent automatically", not "system".
  function frThanksWho(h) {
    return String(h.action).indexOf("fundraiser.thanks_") === 0 && h.actor === "system" ? "Sent automatically" : frWho(h.actor);
  }

  function frThanksWire(view) {
    view.addEventListener("click", function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var b = t.closest("[data-frthanks]");
      if (b) frThanksDecide(b);
    });
    view.addEventListener("input", function (e) {
      var t = e.target;
      if (!t || !t.getAttribute) return;
      var tid = t.getAttribute("data-frthanksreason");
      if (tid === null) return;
      frThanksReasons[tid] = t.value;
      nlFitBox(t);
    });
  }

  // ---- Invite someone ----
  function frRenderInvitePanel() {
    var box = el("frInvite");
    if (!box) return;
    var write = frCanWrite();
    box.hidden = !write;
    if (!write) return;
    var select = el("frInviteSigner");
    var signers = (frTeam && frTeam.signers) || [];
    var key = signers.map(function (s) { return s.id + ":" + s.firstName; }).join("|");
    if (select.getAttribute("data-frsigners") !== key) {
      // Signed by the person signed in, unless they have chosen someone else.
      var chosen = select.getAttribute("data-frsigners") === null || !select.value ? (frTeam ? String(frTeam.me) : "") : select.value;
      select.innerHTML = signers.map(function (s) {
        return '<option value="' + Number(s.id) + '">' + H.escapeHtml(s.firstName) + "</option>";
      }).join("");
      select.setAttribute("data-frsigners", key);
      if (signers.some(function (s) { return String(s.id) === chosen; })) select.value = chosen;
    }
    frInviteSync();
    frRenderInvites();
  }

  // Invite types (Jaimie, B1 + I1): what they are invited to do. The words in the drop-down and on
  // the list, and the type in a sentence ("Send an in memory invite to..."). As INVITE_TYPE_LABELS
  // and INVITE_TYPE_PHRASES in src/fundraising/invite.ts.
  var FR_INVITE_TYPES = {
    raising: { label: "Raising money", phrase: "a raising money invite", the: "the raising money invite" },
    team: { label: "A team", phrase: "a team invite", the: "the team invite" },
    event: { label: "Hosting an event", phrase: "an event invite", the: "the event invite" },
    memory: { label: "In memory", phrase: "an in memory invite", the: "the in memory invite" },
  };
  // The in memory invite is new wording: the server only sends it once an admin has approved it
  // (key invite_memory, with the automatic emails' sign offs). Until then Send rests, and says why,
  // with a link to the All emails card, where an admin approves it.
  var FR_INVITE_WAITING = "The in memory invite wording is waiting for sign off, so this invite cannot be sent yet.";
  // When the sign offs could not be read there is nothing to approve: Send still rests, and says so.
  var FR_INVITE_UNCHECKED = "We could not check the sign off just now. Try again in a moment.";
  var FR_INVITE_KEYS = { memory: "invite_memory" };
  var frInviteWordingData = null; // the email being read: { type, subject, html, wordingKey }
  var frInviteWordingSeq = 0;

  function frInviteType() {
    var select = el("frInviteType");
    var v = select ? String(select.value || "") : "";
    return FR_INVITE_TYPES[v] ? v : "";
  }
  function frInviteApproval(key) {
    var w = frTeam && frTeam.inviteWording;
    return (w && !w.unavailable && w.approvals && w.approvals[key]) || null;
  }
  // Is the type chosen one whose wording is still waiting for sign off?
  function frInviteHeld() {
    var key = FR_INVITE_KEYS[frInviteType()];
    return !!key && !frInviteApproval(key);
  }
  // Why it is held: waiting for sign off, or the sign offs could not be read just now.
  function frInviteHeldWords() {
    var w = frTeam && frTeam.inviteWording;
    if (!w || w.unavailable) return FR_INVITE_UNCHECKED;
    return FR_INVITE_WAITING + (isAdmin() && frCanWrite() ? "" : " Only an admin can approve it.");
  }

  // The Send button, the note beside it and the sign off line, from what is chosen and approved.
  function frInviteSync() {
    // An in memory invite comes from Jodie, is signed by her and copies her (the server sees to all
    // three), so "Signed by" does nothing for it: the box goes, and one line says what is true.
    var memory = frInviteType() === "memory";
    var signer = el("frInviteSigner");
    var signerField = signer && signer.closest ? signer.closest(".fr-field") : null;
    if (signerField) signerField.hidden = memory;
    var memoryNote = el("frInviteMemoryNote");
    if (memoryNote) memoryNote.hidden = !memory;
    var held = frInviteHeld();
    var send = el("frInviteSend");
    if (send) send.disabled = held || frTeamBusy;
    var note = el("frInviteHeld");
    if (note) {
      note.hidden = !held;
      var heldWords = el("frInviteHeldWords");
      if (held && heldWords) heldWords.textContent = frInviteHeldWords();
      // The link to where it is approved. Nothing can be approved while the sign offs cannot be read.
      var heldLink = el("frInviteHeldLink");
      var unchecked = !frTeam || !frTeam.inviteWording || frTeam.inviteWording.unavailable;
      if (heldLink) {
        heldLink.hidden = unchecked;
        heldLink.textContent = unchecked ? "" : isAdmin() && frCanWrite() ? "Approve it in All emails" : "Read it in All emails";
      }
    }
    frInviteWordingMeta();
  }

  function frInviteSignOffHtml(key) {
    if (!key) return "";
    var w = frTeam && frTeam.inviteWording;
    if (!w || w.unavailable) return '<p class="fr-touch-signoff" data-frinvitesignoff>' + H.escapeHtml(FR_TOUCH_UNCHECKED) + "</p>";
    var a = frInviteApproval(key);
    if (!a) return '<p class="fr-touch-signoff" data-frinvitesignoff>' + "Waiting for sign off. It won't send until an admin approves it." + "</p>";
    return '<p class="fr-touch-approved" data-frinvitesignoff>Approved by ' + H.escapeHtml(frWho(a.approvedBy)) + " on " + H.escapeHtml(H.fmtDate(a.approvedAt)) + ".</p>";
  }

  function frInviteWordingMeta() {
    var meta = el("frInviteWordingMeta");
    var d = frInviteWordingData;
    if (!meta || !d) return;
    meta.innerHTML = frInviteSignOffHtml(d.wordingKey) +
      '<p class="fr-touch-subject"><span>Subject</span> ' + H.escapeHtml(d.subject || "") + "</p>";
  }

  // The type was chosen (or cleared, once sent): read its email. New wording waiting for sign off
  // opens by itself, so it is read before it is approved; approved wording stays folded away.
  function frInviteTypeChanged(keepOpen) {
    var type = frInviteType();
    var box = el("frInviteWording");
    var seq = ++frInviteWordingSeq;
    if (!keepOpen) {
      frInviteWordingData = null;
      if (box) box.hidden = true;
    }
    frInviteSync();
    if (!type || !box) return;
    if (!keepOpen) frTeamSay("frInviteStatus", "", false);
    // Signed as the signer chosen in the form, so the example reads as theirs will.
    // The in memory one is signed by Jodie whoever is chosen, so no signer is asked for.
    var signedBy = type === "memory" ? 0 : Number((el("frInviteSigner") || {}).value);
    return authFetch("/api/admin/fundraising/invite-wording/" + encodeURIComponent(type) + (signedBy ? "?signedBy=" + encodeURIComponent(signedBy) : ""))
      .then(okJson)
      .then(function (d) {
        if (seq !== frInviteWordingSeq || !d || typeof d.html !== "string") return;
        frInviteWordingData = d;
        box.hidden = false;
        var read = el("frInviteRead");
        // Left as it is when only the signer changed; opened by itself for wording to sign off.
        if (read && !keepOpen) read.open = !!d.wordingKey && !frInviteApproval(d.wordingKey);
        el("frInviteWordingFrame").setAttribute("srcdoc", d.html);
        frInviteSync();
        frInviteFit();
      })
      .catch(function (err) {
        if (err && err.message === "unauthorized") return;
        if (seq !== frInviteWordingSeq) return;
        frTeamSay("frInviteStatus", "That email could not load just now. Try again in a moment.", true);
      });
  }

  // The real 660px email, zoomed down to fit the card, and as tall as it is: the page grows. On a
  // phone it is drawn at the phone's own width instead, as their phone would show it, so it can be read.
  function frInviteFit() {
    var frame = el("frInviteWordingFrame"), wrap = el("frInviteWordingWrap");
    if (!frame || !wrap || !wrap.clientWidth) return;
    var cdoc = frame.contentDocument;
    if (!cdoc || !cdoc.body) return;
    var emailW = wrap.clientWidth >= 480 ? FR_TOUCH_EMAIL_W : Math.max(wrap.clientWidth, 300);
    var scale = Math.min(1, wrap.clientWidth / emailW);
    frame.style.width = emailW + "px";
    frame.style.height = "0px";
    frame.style.height = Math.max(cdoc.body.scrollHeight, cdoc.documentElement.scrollHeight) + "px";
    frame.style.zoom = scale;
  }

  function frRenderInvites() {
    var ul = el("frInvites");
    if (!ul) return;
    if (frTeamState !== "ok") {
      ul.innerHTML = '<li class="fr-people-empty">' + (frTeamState === "loading" ? "Loading…" : "The invites could not load just now.") + "</li>";
      return;
    }
    var list = frTeam.invites || [];
    if (!list.length) {
      ul.innerHTML = '<li class="fr-people-empty">Nobody is waiting to take up an invite.</li>';
      return;
    }
    ul.innerHTML = list.map(function (i) {
      var id = Number(i.id);
      // An invite past its 60 days: its link no longer works, so say so, and Resend sends a new one.
      var expired = i.expired === true;
      return '<li data-frinvite="' + id + '"><span class="fr-people-who"><b>' + H.escapeHtml(i.name) + "</b> <span>" + H.escapeHtml(i.email) + "</span>" +
        (FR_INVITE_TYPES[i.type] ? ' <span class="admin-pill fr-invite-type">' + H.escapeHtml(FR_INVITE_TYPES[i.type].label) + "</span>" : "") +
        (expired ? ' <span class="admin-pill fr-invite-expired">Expired</span>' : "") +
        // An in memory invite is signed by Jodie, whoever sent it: it does not say "Invited by".
        '<span class="fr-people-when">' + (i.type === "memory" ? "Invited" : "Invited by " + H.escapeHtml(i.signedBy)) + " on " + H.escapeHtml(H.fmtDate(i.createdAt)) +
        (i.resentAt ? ", sent again on " + H.escapeHtml(H.fmtDate(i.resentAt)) : "") +
        (expired ? ". The link has expired. Resend to send a new one." : "") + "</span></span>" +
        '<span class="fr-people-actions">' +
          '<button class="fr-link-btn" type="button" data-frinviteresend="' + id + '" aria-label="' + H.escapeHtml("Resend the invite to " + i.name) + '">Resend</button>' +
          '<button class="fr-link-btn" type="button" data-frinviteremove="' + id + '" aria-label="' + H.escapeHtml("Remove the invite to " + i.name) + '">Remove</button>' +
        "</span></li>";
    }).join("");
  }

  function frInviteFound(id) {
    return ((frTeam && frTeam.invites) || []).filter(function (i) { return String(i.id) === String(id); })[0] || null;
  }
  function frInviteRefusal(r, fallback) {
    if (r.status === 400 && r.body && r.body.fields) {
      var keys = Object.keys(r.body.fields);
      if (keys.length) return String(r.body.fields[keys[0]]);
    }
    return frRefusal(r, fallback);
  }
  function frInviteSent(r, name, sentWords) {
    return r.body && r.body.emailed === false ? "Saved, but the email did not go. Press Resend to try again." : sentWords + " " + name + ".";
  }
  // One invite at a time: the button rests until the answer is in.
  function frInviteRun(work) {
    if (frTeamBusy) return;
    frTeamBusy = true;
    var send = el("frInviteSend");
    if (send) send.disabled = true;
    return Promise.resolve()
      .then(work)
      .catch(function (err) {
        if (err && err.message === "unauthorized") return;
        frTeamSay("frInviteStatus", "That did not work. Please try again.", true);
      })
      .then(function () {
        frTeamBusy = false;
        if (send) send.disabled = false;
        frInviteSync();
      });
  }

  function frSendInvite() {
    if (frTeamBusy) return;
    // Jaimie 2026-10-03: the first name and surname in their own boxes, sent as typed.
    var firstName = String(el("frInviteFirstName").value || "").trim();
    var lastName = String(el("frInviteLastName").value || "").trim();
    var name = firstName + " " + lastName;
    var email = String(el("frInviteEmail").value || "").trim().toLowerCase();
    var note = String(el("frInviteNote").value || "").trim();
    var select = el("frInviteSigner");
    var signedBy = Number(select.value);
    // What they are invited to do: asked first, with nothing chosen for staff.
    var type = frInviteType();
    if (!type) return frTeamSay("frInviteStatus", "Choose what you are inviting them to do.", true);
    if (frInviteHeld()) return frTeamSay("frInviteStatus", frInviteHeldWords(), true);
    if (!firstName) return frTeamSay("frInviteStatus", "Add their first name.", true);
    if (!lastName) return frTeamSay("frInviteStatus", "Add their surname.", true);
    if (!FR_EMAIL.test(email)) return frTeamSay("frInviteStatus", "That isn't a whole email address.", true);
    if (note.length > 5000) return frTeamSay("frInviteStatus", "Keep the note to 5,000 characters or fewer.", true);
    // An in memory invite comes from Jodie: no signer is chosen, asked about or sent.
    var memory = type === "memory";
    if (!memory && !signedBy) return frTeamSay("frInviteStatus", "Choose who it is from.", true);
    var signer = select.options[select.selectedIndex] ? select.options[select.selectedIndex].textContent : "";
    // Names everything: the type in plain words, the full name, the email and the signer.
    var ask = "Send " + FR_INVITE_TYPES[type].phrase + " to " + name + " at " + email + (memory ? "? It comes from Jodie." : ", signed by " + signer + "?");
    if (!window.confirm(ask)) return;
    var body = { firstName: firstName, lastName: lastName, email: email, type: type };
    if (!memory) body.signedBy = signedBy;
    if (note) body.note = note;
    frTeamSay("frInviteStatus", "Sending…", false);
    return frInviteRun(function () {
      return frSend("POST", "/api/admin/fundraising/invites", body).then(function (r) {
        if (!r.ok) return frTeamSay("frInviteStatus", frInviteRefusal(r, "That did not send. Please try again."), true);
        el("frInviteFirstName").value = "";
        el("frInviteLastName").value = "";
        el("frInviteEmail").value = "";
        el("frInviteNote").value = "";
        // Nothing is chosen for the next one either.
        el("frInviteType").value = "";
        frInviteTypeChanged();
        frTeamSay("frInviteStatus", frInviteSent(r, name, "Invite sent to"), r.body && r.body.emailed === false);
        return frLoadTeam();
      });
    });
  }

  function frResendInvite(id) {
    var inv = frInviteFound(id);
    if (!inv || frTeamBusy) return;
    // The type stays as it was: the server keeps it, and sends the same words again.
    var what = FR_INVITE_TYPES[inv.type] ? FR_INVITE_TYPES[inv.type].the : "the invite";
    if (!window.confirm("Send " + what + " to " + inv.name + " again? The link in the first email stops working.")) return;
    frTeamSay("frInviteStatus", "Sending…", false);
    return frInviteRun(function () {
      return frSend("POST", "/api/admin/fundraising/invites/" + encodeURIComponent(id) + "/resend").then(function (r) {
        if (!r.ok) frTeamSay("frInviteStatus", frRefusal(r, "That did not send. Please try again."), true);
        else frTeamSay("frInviteStatus", frInviteSent(r, inv.name, "Sent again to"), r.body && r.body.emailed === false);
        return frLoadTeam();
      });
    });
  }

  function frRemoveInvite(id) {
    var inv = frInviteFound(id);
    if (!inv || frTeamBusy) return;
    if (!window.confirm("Remove the invite to " + inv.name + "? Their link stops working.")) return;
    return frInviteRun(function () {
      return frSend("DELETE", "/api/admin/fundraising/invites/" + encodeURIComponent(id)).then(function (r) {
        frTeamSay("frInviteStatus", r.ok ? "Removed the invite to " + inv.name + "." : frRefusal(r, "That was not removed. Please try again."), !r.ok);
        return frLoadTeam();
      });
    });
  }

  // ---- the Weekly summary (admins) ----
  function frLoadSummary() {
    var card = el("frSummary");
    if (!card) return;
    if (!(isAdmin() && frCanWrite())) {
      card.hidden = true;
      return;
    }
    return authFetch("/api/admin/fundraising/summary")
      .then(okJson)
      .then(function (d) {
        if (!d || !Array.isArray(d.recipients)) {
          card.hidden = true;
          return;
        }
        frSummaryData = d;
        card.hidden = false;
        frRenderSummary();
      })
      .catch(function (err) {
        if (err && err.message === "unauthorized") return;
        card.hidden = true;
      });
  }

  // The summary is one email with everyone on the To line, so only nbcc.scot addresses get it
  // (the rule itself: isSummaryAddress in src/fundraising/summary.ts, which the server goes by).
  function frSummaryGets(email) {
    return /^[^@]+@nbcc\.scot$/i.test(String(email || "").trim());
  }

  function frRenderSummary() {
    var d = frSummaryData;
    var all = d.recipients.length;
    // An address from elsewhere, on the list from before the rule, is left off the email.
    var n = d.recipients.filter(frSummaryGets).length;
    el("frSummary").classList.toggle("is-on", n > 0);
    el("frSummaryState").innerHTML = n
      ? "<b>On.</b> It goes to " + (n === 1 ? "1 person" : n + " people") + " at 8am on Mondays." +
        (d.lastWeek ? " The last one went on " + H.escapeHtml(H.fmtDate(d.lastWeek)) + "." : "")
      : all
        ? "<b>Off.</b> Nobody on the list has an nbcc.scot address, so no summary goes."
        : "<b>Off.</b> Nobody is on the list, so no summary goes.";
    el("frSummaryList").innerHTML = all
      ? d.recipients.map(function (e) {
          return '<li><span class="fr-people-who">' + H.escapeHtml(e) +
            (frSummaryGets(e) ? "" : '<span class="fr-people-when">Not an nbcc.scot address, so it is left off the email.</span>') + "</span>" +
            '<button class="fr-link-btn" type="button" data-frsummaryremove="' + H.escapeHtml(e) + '" aria-label="' + H.escapeHtml("Remove " + e) + '">Remove</button></li>';
        }).join("")
      : '<li class="fr-people-empty">Nobody on the list yet.</li>';
  }

  function frSummarySave(next, saidOk) {
    if (frTeamBusy) return Promise.resolve(false);
    frTeamBusy = true;
    frTeamSay("frSummaryStatus", "Saving…", false);
    return frSend("PUT", "/api/admin/fundraising/summary", { recipients: next })
      .then(function (r) {
        if (!r.ok) {
          frTeamSay("frSummaryStatus", frRefusal(r, "That did not save. Please try again."), true);
          return false;
        }
        frSummaryData = r.body;
        frRenderSummary();
        frTeamSay("frSummaryStatus", saidOk, false);
        return true;
      })
      .catch(function (err) {
        if (!(err && err.message === "unauthorized")) frTeamSay("frSummaryStatus", "That did not save. Please try again.", true);
        return false;
      })
      .then(function (ok) {
        frTeamBusy = false;
        return ok;
      });
  }

  function frSummaryAdd() {
    if (!frSummaryData) return;
    var box = el("frSummaryEmail");
    var email = String(box.value || "").trim().toLowerCase();
    var list = frSummaryData.recipients.slice();
    if (!FR_EMAIL.test(email)) return frTeamSay("frSummaryStatus", "That isn't a whole email address.", true);
    if (!frSummaryGets(email)) return frTeamSay("frSummaryStatus", "Only nbcc.scot addresses can get the weekly summary.", true);
    if (list.indexOf(email) !== -1) return frTeamSay("frSummaryStatus", "That address is already on the list.", true);
    if (list.length >= 10) return frTeamSay("frSummaryStatus", "The summary can go to up to 10 people. Remove someone to add another.", true);
    return frSummarySave(list.concat([email]).sort(), "Saved. " + email + " gets the next one.").then(function (ok) {
      if (ok) box.value = "";
    });
  }

  function frSummaryRemove(email) {
    if (!frSummaryData) return;
    if (!window.confirm("Stop sending the Monday summary to " + email + "?")) return;
    return frSummarySave(frSummaryData.recipients.filter(function (e) { return e !== email; }), "Saved. " + email + " no longer gets it.");
  }

  function frSummaryTest() {
    if (frTeamBusy) return;
    frTeamBusy = true;
    frTeamSay("frSummaryStatus", "Sending a test…", false);
    return frSend("POST", "/api/admin/fundraising/summary/test")
      .then(function (r) {
        frTeamSay("frSummaryStatus", r.ok ? "A test is on its way to " + r.body.sentTo + "." : frRefusal(r, "The test did not go. Please try again."), !r.ok);
      })
      .catch(function (err) {
        if (!(err && err.message === "unauthorized")) frTeamSay("frSummaryStatus", "The test did not go. Please try again.", true);
      })
      .then(function () {
        frTeamBusy = false;
      });
  }


  // ---- Categories (admins; the list itself for everyone who can see Fundraising) ----
  // What people choose from on the sign up form (src/fundraising/categories.ts). The server keeps the
  // order (A to Z, Other last) and every one ever made: none is deleted, so a sign up's
  // category always has its name. Admins add, rename, hide and put back; each is in audit_log.
  var frCats = null; // GET /api/admin/fundraising/categories: [{ key, label, active, used }]
  var frCatsFailed = false;
  var frCatEditing = null; // the key of the category being renamed
  var frCatDraft = ""; // its new name, as typed
  var frCatBusy = false; // a change to a category is on its way (the card's own, apart from the team's tools)

  // After a change, the keyboard goes back where it was: the row's own button (as it is now), or,
  // if that is not there or the change was refused, the status line that says what happened.
  function frCatFocus(selector) {
    var target = selector ? doc.querySelector(selector) : null;
    if (!target) target = el("frCatsStatus");
    if (target && target.focus) target.focus();
  }

  function frCatList() {
    if (frCats) return frCats;
    return FR_KINDS.map(function (k) { return { key: k[0], label: k[1], active: true }; })
      .concat(FR_OLD_KINDS.map(function (k) { return { key: k[0], label: k[1], active: false }; }));
  }
  function frCatFind(key) {
    return frCatList().filter(function (c) { return c.key === key; })[0] || null;
  }
  // A category's name; a key the list does not know, made readable.
  function frCatLabel(key) {
    var c = frCatFind(key);
    if (c) return c.label;
    var words = String(key || "").replace(/_\d+$/, "").replace(/_/g, " ").trim();
    return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Other";
  }
  // The sign up editor's choices: every category on the form, and the sign up's own if it is an old
  // one, so it shows as it is until someone changes it.
  function frKindOptions(current) {
    var opts = frCatList().filter(function (c) { return c.active; }).map(function (c) { return [c.key, c.label]; });
    var has = opts.some(function (o) { return o[0] === current; });
    if (current && !has) opts.unshift([current, frCatLabel(current) + " (no longer on the form)"]);
    return opts;
  }

  function frLoadCategories() {
    return authFetch("/api/admin/fundraising/categories")
      .then(okJson)
      .then(function (d) {
        frCats = d && Array.isArray(d.categories) ? d.categories : null;
        frCatsFailed = !frCats;
        frRenderCats();
      })
      .catch(function (err) {
        if (err && err.message === "unauthorized") return;
        frCats = null;
        frCatsFailed = true;
        frRenderCats();
      });
  }

  function frCatUsed(c) {
    var n = Number(c.used) || 0;
    return n === 0 ? "No sign ups yet" : n === 1 ? "1 sign up" : n + " sign ups";
  }

  function frCatRow(c) {
    var label = H.escapeHtml(c.label);
    var key = H.escapeHtml(c.key);
    if (frCatEditing === c.key) {
      return '<li class="fr-cat-editing"><span class="fr-people-who"><label class="fx-call-label" for="frCatRename">New name for ' + label + "</label>" +
        '<input class="fx-call-input" id="frCatRename" type="text" maxlength="40" autocomplete="off" value="' + H.escapeHtml(frCatDraft) + '"></span>' +
        '<span class="fr-people-actions"><button class="admin-btn" type="button" data-frcatsave>Save the name</button>' +
        '<button class="fr-link-btn" type="button" data-frcatcancel>Cancel</button></span></li>';
    }
    var actions = '<button class="fr-link-btn" type="button" data-frcatrename="' + key + '" aria-label="' + H.escapeHtml("Rename " + c.label) + '">Rename</button>';
    if (c.key === "other") {
      actions += '<span class="fr-cat-note">Always last on the form</span>';
    } else if (c.active) {
      actions += '<button class="fr-link-btn" type="button" data-frcathide="' + key + '" aria-label="' + H.escapeHtml("Hide " + c.label + " from the form") + '">Hide from the form</button>';
    } else {
      actions += '<button class="fr-link-btn" type="button" data-frcatshow="' + key + '" aria-label="' + H.escapeHtml("Put " + c.label + " back on the form") + '">Put back on the form</button>';
    }
    // The sign up tidy: a Sporting tick each (never Other, which is in both lists); an in memory
    // way of giving says so instead, as it is only ever offered on that path.
    var sporty = c.memoryOnly
      ? '<span class="fr-cat-note">In memory only</span>'
      : c.key === "other"
        ? ""
        : '<label class="fr-cat-sporty"><input type="checkbox" data-frcatsporty="' + key + '"' + (c.sporty ? " checked" : "") +
          ' aria-label="' + H.escapeHtml(c.label + " is a sporting category") + '"> Sporting</label>';
    return '<li><span class="fr-people-who">' + label + " <span>" + H.escapeHtml(frCatUsed(c)) + "</span></span>" +
      '<span class="fr-people-actions">' + sporty + actions + "</span></li>";
  }

  function frRenderCats() {
    var card = el("frCats");
    if (!card) return;
    if (!(isAdmin() && frCanWrite())) {
      card.hidden = true;
      return;
    }
    card.hidden = false;
    var list = el("frCatsList");
    var hidden = el("frCatsHidden");
    if (!frCats) {
      list.innerHTML = '<li class="fr-people-empty">' + (frCatsFailed ? "The categories could not load just now. Try again in a moment." : "Loading&hellip;") + "</li>";
      hidden.hidden = true;
      el("frCatsHiddenHead").hidden = true;
      return;
    }
    var on = frCats.filter(function (c) { return c.active; });
    var off = frCats.filter(function (c) { return !c.active; });
    list.innerHTML = on.length ? on.map(frCatRow).join("") : '<li class="fr-people-empty">Nothing is on the form yet.</li>';
    hidden.innerHTML = off.map(frCatRow).join("");
    hidden.hidden = off.length === 0;
    el("frCatsHiddenHead").hidden = off.length === 0;
    if (frCatEditing) {
      var box = el("frCatRename");
      if (box && doc.activeElement !== box) box.focus();
    }
  }

  // One change at a time. After it: the card, the sign ups (their category names) and the editor's list.
  // Answers true (saved), false (refused or failed) or null (another change was still on its way).
  function frCatSend(method, path, body, saidOk) {
    if (frCatBusy) return Promise.resolve(null);
    frCatBusy = true;
    frTeamSay("frCatsStatus", "Saving…", false);
    return frSend(method, path, body)
      .then(function (r) {
        if (!r.ok) {
          frTeamSay("frCatsStatus", frRefusal(r, "That did not save. Please try again."), true);
          return false;
        }
        frTeamSay("frCatsStatus", saidOk(r.body && r.body.category), false);
        return Promise.all([frLoadCategories(), frLoadList()]).then(function () { return true; });
      })
      .catch(function (err) {
        if (!(err && err.message === "unauthorized")) frTeamSay("frCatsStatus", "That did not save. Please try again.", true);
        return false;
      })
      .then(function (ok) {
        frCatBusy = false;
        return ok;
      });
  }

  function frCatAdd() {
    var box = el("frCatsNew");
    var label = String(box.value || "").replace(/\s+/g, " ").trim();
    if (label.length < 2) return frTeamSay("frCatsStatus", "Type the name of the category first, like Sponsored silence.", true);
    return frCatSend("POST", "/api/admin/fundraising/categories", { label: label }, function (c) {
      return "Added. " + (c ? c.label : label) + " is on the sign up form now, in its place A to Z.";
    }).then(function (ok) {
      if (ok === null) return;
      if (ok) {
        box.value = "";
        box.focus();
      } else frCatFocus(null);
    });
  }

  function frCatStartRename(key) {
    var c = frCatFind(key);
    if (!c) return;
    frCatEditing = key;
    frCatDraft = c.label;
    frTeamSay("frCatsStatus", "", false);
    frRenderCats();
  }
  function frCatCancelRename() {
    frCatEditing = null;
    frCatDraft = "";
    frRenderCats();
  }
  function frCatSaveRename() {
    var key = frCatEditing;
    var c = frCatFind(key);
    var box = el("frCatRename");
    var label = String((box && box.value) || "").replace(/\s+/g, " ").trim();
    if (!c) return;
    if (label.length < 2) return frTeamSay("frCatsStatus", "Type the new name first.", true);
    if (label === c.label) return frCatCancelRename();
    return frCatSend("PATCH", "/api/admin/fundraising/categories/" + encodeURIComponent(key), { label: label }, function (after) {
      return "Renamed. It says " + (after ? after.label : label) + " everywhere now.";
    }).then(function (ok) {
      if (ok === null) return;
      if (ok) {
        frCatEditing = null;
        frCatDraft = "";
        frRenderCats();
        frCatFocus('[data-frcatrename="' + key + '"]');
      } else frCatFocus(null);
    });
  }

  function frCatSetActive(key, active) {
    var c = frCatFind(key);
    if (!c) return;
    if (!active && !window.confirm("Take " + c.label + " off the sign up form? The sign ups that chose it keep it, and you can put it back.")) return;
    return frCatSend("PATCH", "/api/admin/fundraising/categories/" + encodeURIComponent(key), { active: active }, function () {
      return active ? c.label + " is back on the sign up form." : c.label + " is off the sign up form. The sign ups that chose it keep it.";
    }).then(function (ok) {
      if (ok === null) return;
      // The row has moved list: its button now does the opposite.
      frCatFocus(ok ? (active ? '[data-frcathide="' + key + '"]' : '[data-frcatshow="' + key + '"]') : null);
    });
  }

  // The sign up tidy: Sporting decides which list a category is in on the sign up form: with a Yes to
  // "Is it a sporting event?", only the sporting ones (and Other); with a No, only the rest.
  function frCatSetSporty(key, sporty) {
    var c = frCatFind(key);
    if (!c) return;
    return frCatSend("PATCH", "/api/admin/fundraising/categories/" + encodeURIComponent(key), { sporty: sporty }, function () {
      return sporty ? c.label + " is offered for a sporting event now." : c.label + " is offered when it is not a sporting event now.";
    }).then(function (ok) {
      if (ok === null) return;
      if (!ok) frRenderCats();
      frCatFocus(ok ? '[data-frcatsporty="' + key + '"]' : null);
    });
  }

  // ---- The sign up tidy (Jaimie, 2026-10-03) ----
  // What the welcome pack needs: the address (asked of everyone bar in memory), whether it is a
  // sporting event, and the T-shirt size. Staff may correct sport and the size before approving
  // (PUT /api/admin/fundraisers/:id/welcome-pack); a sporting event with no size says "Waiting for
  // T-shirt size", with a button that emails the organiser a private link to choose one (never
  // automatic). Kept here, in one block, reached from the rest of the screen by one line hooks.
  var FR_TSHIRT_SIZES = [
    ["kids_3_4", "Kids 3 to 4"], ["kids_5_6", "Kids 5 to 6"], ["kids_7_8", "Kids 7 to 8"], ["kids_9_10", "Kids 9 to 10"],
    ["kids_11_12", "Kids 11 to 12"], ["kids_13_14", "Kids 13 to 14"], ["adult_xs", "Adult XS"], ["adult_s", "Adult S"],
    ["adult_m", "Adult M"], ["adult_l", "Adult L"], ["adult_xl", "Adult XL"], ["adult_xxl", "Adult XXL"],
  ];
  var FR_EMPLOYER_MATCH = { yes: "Yes", no: "No", not_sure: "Not sure yet" };
  function frTshirtLabel(key) {
    var found = FR_TSHIRT_SIZES.filter(function (s) { return s[0] === key; })[0];
    return found ? found[1] : "";
  }
  function frWaitingForSize(f) {
    return f.isSporting === true && !f.tshirtSize;
  }
  // "Kept off Get involved" when the organiser asked for only people with the link.
  function frWebsiteWords(f) {
    if (!f.public) return "Not on the website";
    if (f.offListBy === "organiser") return "A page of its own, but not on Get involved: only people they send the link to";
    // An event's card needs a date: until it has one it has its page, but is not on the list.
    if (f.path === "event" && !f.eventDate) return "Not listed yet: no date. Its page is up; its card joins Get involved once it has a date";
    return "Show it on our website";
  }
  // The new answers, in What they told us. A sign up from before has none, and shows nothing.
  function frTidyRows(f) {
    var rows = "";
    if (f.childFirstName) {
      rows += fulfilRow("Fundraising for their child", H.escapeHtml(f.childFirstName) +
        (f.childConsent ? ". They ticked: parent or guardian, happy for the first name and any photo to be shown" : ""));
    }
    if (f.orgName) {
      rows += fulfilRow("Business, school or group", H.escapeHtml(f.orgName));
      if (f.employerMatch && FR_EMPLOYER_MATCH[f.employerMatch]) rows += fulfilRow("Employer will match", FR_EMPLOYER_MATCH[f.employerMatch]);
    }
    if (f.isSporting === true || f.isSporting === false) {
      rows += fulfilRow("Sporting event", f.isSporting ? "Yes" : "No");
      if (f.isSporting) {
        rows += fulfilRow("T-shirt size", f.tshirtSize
          ? H.escapeHtml(frTshirtLabel(f.tshirtSize))
          : '<span class="admin-pill admin-pill--pending fr-tshirt-wait">Waiting for T-shirt size</span>');
      }
    }
    if (f.memoryDirectorBusiness) rows += fulfilRow("Funeral director", H.escapeHtml(f.memoryDirectorBusiness));
    var contact = [f.memoryFamilyContactName, f.memoryFamilyContactEmail].filter(Boolean).join(", ");
    if (contact) rows += fulfilRow("Send givers' names to", H.escapeHtml(contact));
    if (f.callTime) rows += fulfilRow("A good time to call", H.escapeHtml(f.callTime));
    // A team member page for someone under 18: its emails greet their parent or guardian.
    if (f.guardianFirstName) {
      rows += fulfilRow("For someone under 18", "Their parent or guardian is " + H.escapeHtml(f.guardianFirstName) +
        (f.childConsent ? ". They ticked: happy for the first name and any photo to be shown" : ""));
    }
    var address = [f.postLine1, f.postLine2, f.postTown, f.postPostcode].filter(function (p) { return p && String(p).trim(); });
    if (address.length) {
      rows += fulfilRow(f.inMemory ? "Address for what they asked for" : "Address for the welcome pack",
        '<span class="fx-address">' + H.escapeHtml(address.join("\n")) + "</span>");
    }
    return rows;
  }
  function frWelcomeSection(f, write) {
    // Sport and the T-shirt are only ever for someone raising money, and never in memory.
    if (f.path !== "raising" || f.inMemory || f.teamId) return "";
    var sporting = f.isSporting === true;
    var waiting = frWaitingForSize(f);
    var asked = f.tshirtAskedAt
      ? '<p class="fx-help">Asked on ' + H.escapeHtml(H.fmtDate(f.tshirtAskedAt)) + (f.tshirtAskedBy ? " by " + H.escapeHtml(frWho(f.tshirtAskedBy)) : "") + ".</p>"
      : "";
    var state = waiting
      ? '<p class="fr-tshirt-state"><span class="admin-pill admin-pill--pending fr-tshirt-wait">Waiting for T-shirt size</span></p>' + asked
      : "";
    if (!write) {
      return '<section class="fx-panel fr-welcome-panel" data-frwelcome><h4>Sport and the T-shirt</h4>' +
        (state || '<p class="fx-help">' + (f.isSporting == null ? "They were not asked." : sporting ? "A sporting event, with a T-shirt size." : "Not a sporting event, so no T-shirt.") + "</p>") +
        "</section>";
    }
    var options = '<option value="">' + (sporting ? "No size yet" : "No T-shirt") + "</option>" + FR_TSHIRT_SIZES.map(function (s) {
      return '<option value="' + s[0] + '"' + (f.tshirtSize === s[0] ? " selected" : "") + ">" + H.escapeHtml(s[1]) + "</option>";
    }).join("");
    var form =
      '<form id="frWelcomeForm" class="fr-split-form fr-welcome-form" novalidate>' +
        '<p class="fx-help">Correct these if they tell you something different. A sporting event gets an NBCC T-shirt with its welcome pack.</p>' +
        '<fieldset class="fr-split-choice"><legend class="fx-call-label">Sporting event?</legend>' +
          '<label><input type="radio" name="isSporting" id="frSportYes" value="yes"' + (sporting ? " checked" : "") + "> Yes</label> " +
          '<label><input type="radio" name="isSporting" id="frSportNo" value="no"' + (f.isSporting === false ? " checked" : "") + "> No</label>" +
        "</fieldset>" +
        '<div data-frtshirtfield' + (sporting ? "" : " hidden") + ">" +
          '<label class="fx-call-label" for="frTshirtSize">T-shirt size</label>' +
          '<select class="fr-input fr-tshirt-select" id="frTshirtSize" name="tshirtSize"' + (sporting ? "" : " disabled") + ">" + options + "</select>" +
        "</div>" +
        '<div class="fx-call-row fr-actions"><button class="admin-btn admin-btn--small" type="submit">Save</button>' +
          (waiting ? '<button class="admin-btn admin-btn--small fr-btn-quiet" type="button" data-frtshirtask>' +
            (f.tshirtAskedAt ? "Ask them again for their T-shirt size" : "Ask them for their T-shirt size") + "</button>" : "") +
        "</div>" +
        (waiting ? '<span class="fr-field-hint">Emails ' + H.escapeHtml(f.email || "them") + " a private link to choose a size. Nothing is sent until you press it.</span>" : "") +
      "</form>";
    return '<section class="fx-panel fr-welcome-panel" data-frwelcome><h4>Sport and the T-shirt</h4>' + state + form +
      frNoticeHtml("welcome", "frWelcomeStatus") + "</section>";
  }
  // Yes or No in the form: the size shows, and works, only for Yes.
  function frWelcomeChoice(form) {
    var yes = !!form.querySelector("#frSportYes:checked");
    var field = form.querySelector("[data-frtshirtfield]");
    var size = form.querySelector("#frTshirtSize");
    if (field) field.hidden = !yes;
    if (size) size.disabled = !yes;
  }
  function frSaveWelcome(form) {
    if (frBusy) return;
    var f = frOpenRecord();
    if (!f) return;
    var yes = !!form.querySelector("#frSportYes:checked");
    var no = !!form.querySelector("#frSportNo:checked");
    if (!yes && !no) return frSay("welcome", "Choose Yes or No first.", true, f.id);
    var size = String((form.querySelector("#frTshirtSize") || {}).value || "");
    frRun("welcome", "Saving\u2026", function (run) {
      return frSend("PUT", "/api/admin/fundraisers/" + f.id + "/welcome-pack", { isSporting: yes, tshirtSize: yes && size ? size : null }).then(function (r) {
        if (!r.ok) {
          var fields = r.status === 400 && r.body && r.body.fields
            ? Object.keys(r.body.fields).map(function (k) { return r.body.fields[k]; }).join(" ")
            : "";
          run.say(fields || frRefusal(r, "That was not saved. Please try again."), true);
          return;
        }
        run.say(yes && !size ? "Saved. They are waiting for a T-shirt size: you can ask them for it." : "Saved.", false);
        return frReload();
      });
    });
  }
  function frTshirtAsk() {
    if (frBusy) return;
    var f = frOpenRecord();
    if (!f) return;
    if (!window.confirm("Email " + (f.email || "the organiser") + " a link to choose their T-shirt size?")) return;
    frRun("welcome", "Sending\u2026", function (run) {
      return frSend("POST", "/api/admin/fundraisers/" + f.id + "/tshirt-ask").then(function (r) {
        if (!r.ok) {
          run.say(frRefusal(r, "The email did not go. Please try again."), true);
          return frReload();
        }
        run.say("Sent. They have a link to choose their size.", false);
        return frReload();
      });
    });
  }

  // ---- Welcome packs (Jaimie, 2026-10-03) ----
  // The pack staff post to each approved fundraiser and event host (src/routes/admin-welcome-packs.ts).
  // The server works out what is in each one (the letter, what they asked for, the sponsor form for
  // someone raising money, the T-shirt for a sporting event) and where it is up to; this only shows
  // it. Ticking something they asked for also marks its request in the Requests part (the server
  // does it, in the same save). In the open sign up: a tick box for each thing (who ticked it, and when), "Leave out" with a
  // reason, the address ready to copy, who signs the letter (the Signed by list, starting with
  // whoever this staff member chose last), Print welcome pack and Print letter only, then Pack sent
  // and Undo. In memory of someone the same panel is "Things to send": only what they asked for,
  // with a covering note. The list has a "Pack to send" pill and a "Packs to send" filter. Viewers
  // read and print; editors and admins change. Every stored string is escaped. Kept here, in one
  // block, reached from the rest of the screen by one line hooks marked "welcome packs".
  var frPacks = null; // GET /api/admin/fundraising/packs: { packs, toSend, mySigner }
  var frPacksState = "loading"; // loading, failed or ok
  var frPackSkip = null; // the key of the thing whose "Leave out" form is open
  var frPackSkipDraft = ""; // the reason typed in it, kept across a redraw
  var FR_PACK_TONE = { to_pack: "todo", part: "waiting", ready: "todo", sent: "done" };

  function frLoadPacks() {
    return authFetch("/api/admin/fundraising/packs")
      .then(okJson)
      .then(function (d) {
        var ok = !!(d && d.packs && typeof d.packs === "object" && d.toSend && typeof d.toSend === "object");
        frPacks = ok ? d : null;
        frPacksState = ok ? "ok" : "failed";
        frRenderList();
      })
      .catch(function (err) {
        if (err && err.message === "unauthorized") return;
        frPacks = null;
        frPacksState = "failed";
        frRenderList();
      });
  }
  function frPackOf(f) {
    return (frPacks && frPacks.packs && frPacks.packs[f.id]) || null;
  }
  function frPackToSend(f) {
    return !!(frPacks && frPacks.toSend && frPacks.toSend[f.id]);
  }
  function frPackPill(f) {
    if (!frPackToSend(f)) return "";
    var v = frPackOf(f);
    return '<span class="admin-pill admin-pill--pending fr-pack-pill">' + (v && v.kind === "memory" ? "Things to send" : "Pack to send") + "</span>";
  }
  function frPackClear() {
    frPackSkip = null;
    frPackSkipDraft = "";
  }
  // Who signs: the one kept for this pack, else this staff member's last choice, else the first on the list.
  function frPackSignerNow(v) {
    var list = H.SIGNERS || [];
    if (v && v.signer) return { name: v.signer, role: v.signerRole || null };
    if (frPacks && frPacks.mySigner && frPacks.mySigner.name) return { name: frPacks.mySigner.name, role: frPacks.mySigner.role || null };
    return list[0] ? { name: list[0].name, role: list[0].role || null } : null;
  }

  function frPackItemHtml(v, item, write) {
    var key = H.escapeHtml(item.key);
    var sent = v.state === "sent";
    var skipped = !!item.skippedReason;
    var locked = !write || sent || skipped || !item.tickable;
    var who = "";
    if (item.ticked) {
      who = "Ticked by " + frWho(item.tickedBy) + (item.tickedAt ? " on " + H.fmtDate(item.tickedAt) : "");
    } else if (skipped) {
      who = "Left out: " + item.skippedReason + (item.tickedBy ? " (" + frWho(item.tickedBy) + ")" : "");
    }
    // The sign up has changed since the tick, in the server's words: before the pack is sent the
    // tick no longer counts ("needs ticking again"); after, it is only said.
    if (item.changeNote) who += (who ? ". " : "") + item.changeNote;
    var actions = "";
    if (write && !sent) {
      if (skipped) {
        actions += '<button class="fr-link-btn" type="button" data-frpackback="' + key + '">Put it back</button>';
      } else if (!item.ticked && frPackSkip !== item.key) {
        // Waiting on the organiser: the button that emails them the link to choose a size (the sign up tidy).
        if (item.waiting) {
          actions += '<button class="admin-btn admin-btn--small fr-btn-quiet" type="button" data-frtshirtask>Ask them for their T-shirt size</button>';
        }
        actions += '<button class="fr-link-btn" type="button" data-frpackskip="' + key + '">Leave out</button>';
      }
    }
    var form = "";
    if (write && !sent && frPackSkip === item.key) {
      form =
        '<form id="frPackSkipForm" class="fr-pack-skip" novalidate>' +
          '<label class="fx-call-label" for="frPackSkipReason">Why is it being left out?</label>' +
          '<div class="fx-call-row">' +
            '<input class="fx-call-input" id="frPackSkipReason" name="reason" type="text" maxlength="200" autocomplete="off" value="' + H.escapeHtml(frPackSkipDraft) + '">' +
            '<button class="admin-btn admin-btn--small" type="submit">Leave it out</button>' +
            '<button class="admin-btn admin-btn--small fr-btn-quiet" type="button" data-frpackskipcancel>Cancel</button>' +
          "</div>" +
        "</form>";
    }
    return (
      '<li class="fr-pack-item' + (item.done ? " is-done" : "") + (skipped ? " is-skipped" : "") + (item.waiting ? " is-waiting" : "") +
        '" data-frpackitem="' + key + '">' +
        '<label class="fr-pack-tick"><input type="checkbox" data-frpacktick="' + key + '"' + (item.ticked ? " checked" : "") + (locked ? " disabled" : "") + ">" +
          '<span class="fr-pack-words">' + H.escapeHtml(item.words) + "</span></label>" +
        (who ? '<span class="fr-pack-who">' + H.escapeHtml(who) + "</span>" : "") +
        (actions ? '<span class="fr-pack-actions">' + actions + "</span>" : "") +
        form +
      "</li>"
    );
  }

  function frPackAddressHtml(v) {
    var a = v.address || {};
    var lines = Array.isArray(a.lines) ? a.lines : [];
    var memory = v.kind === "memory";
    var note = v.addressNote ? '<p class="fr-field-hint">' + H.escapeHtml(v.addressNote) + "</p>" : "";
    if (!lines.length) {
      return '<div class="fr-pack-address"><h5 class="fx-call-label">Post to</h5><p class="fx-warn">No address given. Ask them where to post ' +
        (memory ? "them" : "it") + ".</p>" + note + "</div>";
    }
    var all = [a.name].concat(lines).filter(Boolean);
    return (
      '<div class="fr-pack-address"><h5 class="fx-call-label">Post to</h5>' +
        '<address id="frPackAddress">' + all.map(function (l) { return "<span>" + H.escapeHtml(l) + "</span>"; }).join("") + "</address>" +
        '<button class="admin-btn admin-btn--small fr-btn-quiet" type="button" data-frpackcopy>Copy address</button>' + note +
      "</div>"
    );
  }

  function frPackSignHtml(v, write) {
    var now = frPackSignerNow(v);
    var what = v.kind === "memory" ? "note" : "letter";
    if (!write) {
      return now ? '<p class="fr-pack-sign">Signed by ' + H.escapeHtml(now.name) + "</p>" : "";
    }
    var list = (H.SIGNERS || []).slice();
    // Someone chosen before who is no longer on the list still shows, so the pack says who signed it.
    if (now && !list.some(function (s) { return s.name === now.name; })) list.push({ name: now.name, role: now.role || "" });
    return (
      '<div class="fr-pack-sign"><label class="fx-call-label" for="frPackSigner">Signed by</label>' +
        '<select class="fx-call-input" id="frPackSigner">' + list.map(function (s) {
          return '<option value="' + H.escapeHtml(s.name) + '" data-role="' + H.escapeHtml(s.role || "") + '"' +
            (now && now.name === s.name ? " selected" : "") + ">" + H.escapeHtml(s.name) + "</option>";
        }).join("") + "</select>" +
        '<span class="fr-field-hint">Their name goes at the foot of the printed ' + what + ". Your choice is remembered for your next one.</span></div>"
    );
  }

  function frPackSection(f, write) {
    if (f.status !== "approved" && f.status !== "finished") return "";
    var open = '<section class="fx-panel fx-panel--wide fr-pack-panel" data-frpack>';
    if (frPacksState !== "ok") {
      // In memory with nothing asked for, and a team member's page, have no pack: say nothing of one.
      if (f.teamId || f.inMemory) return "";
      return open + "<h4>Welcome pack</h4>" + (frPacksState === "loading"
        ? '<p class="admin-loading">Loading…</p>'
        : '<p class="fx-empty">The welcome pack could not load just now.</p>') + "</section>";
    }
    var v = frPackOf(f);
    if (!v) return "";
    var memory = v.kind === "memory";
    var items = Array.isArray(v.items) ? v.items : [];
    // What is in, and what was left out: a thing left out is never counted as in the pack.
    var inIt = items.filter(function (i) { return i.ticked; }).length;
    var leftOut = items.filter(function (i) { return !!i.skippedReason; }).length;
    var sent = v.state === "sent";
    var gone = Array.isArray(v.goneNotes) ? v.goneNotes : [];
    // In memory with no posters asked for, the note is all there is to print.
    var noteOnly = memory && !items.some(function (i) { return !i.skippedReason && /^(posters_a4|posters_a3|leaflets)$/.test(i.key); });
    var help = memory
      ? "What they asked for on the form. Tick each thing as it goes in the envelope, then mark it as sent. Ticking something also marks the request as done."
      : "Everything this page gets in the post. Tick each thing as it goes in, then mark the pack as sent. Ticking something they asked for also marks the request as done.";
    var send = "";
    if (sent) {
      send = '<p class="fr-pack-sent">' + H.escapeHtml("Sent on " + H.fmtDate(v.sentAt) + (v.sentBy ? " by " + frWho(v.sentBy) : "")) + "</p>" +
        // It stays Sent: a later change to the sign up is flagged, never a tick to do again.
        (v.changedSinceSent ? '<span class="admin-pill admin-pill--pending fr-pack-changed">Changed since it was sent</span>' : "") +
        // What went and is no longer in the sign up, so the flag is never without its reason.
        (gone.length ? '<ul class="fr-pack-gone">' + gone.map(function (g) { return "<li>" + H.escapeHtml(g) + "</li>"; }).join("") + "</ul>" : "") +
        (write ? '<button class="admin-btn admin-btn--small fr-btn-quiet" type="button" data-frpackundo>Undo</button>' : "");
    } else if (write) {
      send = '<button class="admin-btn admin-btn--small" type="button" data-frpacksend' + (v.canSend ? "" : " disabled") + ">" + (memory ? "Sent" : "Pack sent") + "</button>" +
        (v.canSend ? "" : '<span class="fr-field-hint">Tick everything, or leave it out with a reason, first.</span>');
    }
    return (
      open + "<h4>" + H.escapeHtml(v.title || "Welcome pack") + "</h4>" +
        '<p class="fr-pack-head"><span class="fx-state fx-state--' + (FR_PACK_TONE[v.state] || "todo") + ' fr-pack-state">' + H.escapeHtml(v.stateLabel || "") + "</span>" +
          '<span class="fr-pack-count">' + inIt + " of " + items.length + (leftOut ? (memory ? " ready, " : " in, ") + leftOut + " left out" : memory ? " ready" : " in the pack") + "</span></p>" +
        (sent ? "" : '<p class="fx-help">' + help + "</p>") +
        '<ul class="fr-pack-list">' + items.map(function (i) { return frPackItemHtml(v, i, write); }).join("") + "</ul>" +
        '<div class="fr-pack-post">' + frPackAddressHtml(v) + frPackSignHtml(v, write) + "</div>" +
        '<div class="fx-call-row fr-pack-print">' +
          (noteOnly ? "" : '<button class="admin-btn admin-btn--small" type="button" data-frpackprint="all">' + (memory ? "Print the note and posters" : "Print welcome pack") + "</button>") +
          '<button class="admin-btn admin-btn--small' + (noteOnly ? "" : " fr-btn-quiet") + '" type="button" data-frpackprint="letter">' +
            (noteOnly ? "Print the note" : memory ? "Print note only" : "Print letter only") + "</button>" +
        "</div>" +
        (send ? '<div class="fx-call-row fr-pack-send">' + send + "</div>" : "") +
        frNoticeHtml("pack", "frPackStatus") +
      "</section>"
    );
  }

  // One press: save it, then read the packs (and the History) again so the list shows how it stands.
  function frPackPost(body, doing, saidOk) {
    var f = frOpenRecord();
    if (!f || frBusy) return;
    return frRun("pack", doing, function (run) {
      return frSend("POST", "/api/admin/fundraisers/" + f.id + "/pack", body).then(function (r) {
        if (r.ok) {
          if (run.open()) frPackClear();
          // What it did in Requests, in the Requests' own words.
          var also = r.body && Array.isArray(r.body.requests) ? r.body.requests.filter(function (w) { return typeof w === "string" && w; }) : [];
          run.say((saidOk || "Saved.") + (also.length ? " Also changed in Requests: " + also.join("; ") + "." : ""), false);
        } else if (r.status === 400 && r.body && r.body.fields) {
          run.say(Object.keys(r.body.fields).map(function (k) { return r.body.fields[k]; }).join(" "), true);
          return;
        } else {
          // Someone else changed it, or it is no longer there: show how it stands now.
          if (run.open()) frPackClear();
          run.say(frRefusal(r, "That was not saved. Please try again."), true);
        }
        // The Requests part too: a tick may have marked one of its requests, or opened it again.
        return Promise.all([frLoadPacks(), frLoadHistory(f.id), frLoadRequests()]).then(function () { return r.ok; });
      });
    });
  }

  // A tick or a leave out says what the list showed (as a request's `from` does): if the sign up
  // has changed since the page was opened, the server refuses it and the panel shows how it stands.
  function frPackSeen(body) {
    var f = frOpenRecord();
    var v = f && frPackOf(f);
    var item = v && Array.isArray(v.items) ? v.items.filter(function (i) { return i.key === body.key; })[0] : null;
    body.words = item ? item.words : "";
    body.quantity = item && typeof item.quantity === "number" ? item.quantity : null;
    return body;
  }

  function frPackSigner(select) {
    var opt = select.selectedOptions && select.selectedOptions[0];
    if (!opt) return;
    frPackPost({ action: "signer", name: opt.value, role: opt.getAttribute("data-role") || null }, "Saving…", "Saved. " + opt.value + " signs this one.");
  }

  function frPackCopy() {
    var box = el("frPackAddress");
    if (!box) return;
    var words = Array.prototype.map.call(box.querySelectorAll("span"), function (s) { return s.textContent; }).join("\n");
    var said = function (ok) {
      frSay("pack", ok ? "Address copied." : "Could not copy it. Select the address and copy it by hand.", !ok);
      frPaintNotice("pack");
    };
    if (window.navigator && window.navigator.clipboard && window.navigator.clipboard.writeText) {
      window.navigator.clipboard.writeText(words).then(function () { said(true); }, function () { said(false); });
    } else {
      said(false);
    }
  }

  // The print view opens in its own tab, as every material does (frOpenMaterial): fetched with the
  // staff member's session and shown from memory. Who signs is kept first, so the letter says it.
  function frPackPrint(part) {
    var f = frOpenRecord();
    if (!f || frBusy) return;
    var id = f.id;
    var v = frPackOf(f);
    var tab = window.open("", "_blank");
    try {
      if (tab) {
        tab.document.title = "Opening";
        tab.document.body.textContent = "Opening, one moment.";
      }
    } catch (e) { /* a tab we cannot write to still navigates */ }
    var select = el("frPackSigner");
    var opt = select && select.selectedOptions && select.selectedOptions[0];
    var keep = frCanWrite() && v && !v.signer && opt
      ? frSend("POST", "/api/admin/fundraisers/" + id + "/pack", { action: "signer", name: opt.value, role: opt.getAttribute("data-role") || null })
      : Promise.resolve(null);
    keep
      .then(function () {
        return authFetch("/api/admin/fundraisers/" + id + "/pack/print" + (part === "letter" ? "?part=letter" : ""));
      })
      .then(function (res) { return res.ok ? res.text() : Promise.reject(new Error("failed")); })
      .then(function (page) {
        var url = URL.createObjectURL(new Blob([page], { type: "text/html" }));
        if (tab && !tab.closed) tab.location.href = url;
        else window.open(url, "_blank");
        setTimeout(function () { URL.revokeObjectURL(url); }, 120000);
        if (keep && v && !v.signer && opt) frLoadPacks();
      })
      .catch(function (err) {
        if (err && err.message === "unauthorized") return;
        if (tab && !tab.closed) tab.close();
        frSay("pack", "Could not open that. Try again.", true, id);
        frPaintNotice("pack");
      });
  }

  function frPackWire(view) {
    view.addEventListener("click", function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var print = t.closest("[data-frpackprint]");
      if (print) return frPackPrint(print.getAttribute("data-frpackprint"));
      if (t.closest("[data-frpackcopy]")) return frPackCopy();
      var skip = t.closest("[data-frpackskip]");
      if (skip) {
        if (frBusy) return;
        frPackSkip = skip.getAttribute("data-frpackskip");
        frPackSkipDraft = "";
        frSay("pack", "", false);
        frRenderList();
        var box = el("frPackSkipReason");
        if (box && box.focus) box.focus({ preventScroll: true });
        return;
      }
      if (t.closest("[data-frpackskipcancel]")) {
        frPackClear();
        frSay("pack", "", false);
        return frRenderList();
      }
      var back = t.closest("[data-frpackback]");
      if (back) return frPackPost({ action: "untick", key: back.getAttribute("data-frpackback") }, "Saving…", "Put back.");
      if (t.closest("[data-frpacksend]")) return frPackPost({ action: "send" }, "Saving…", "Marked as sent.");
      if (t.closest("[data-frpackundo]")) {
        if (!window.confirm("Undo Sent? It goes back to Ready to send.")) return;
        return frPackPost({ action: "undo" }, "Saving…", "Undone.");
      }
    });
    view.addEventListener("change", function (e) {
      var t = e.target;
      if (!t || !t.getAttribute) return;
      if (t.id === "frPackSigner") return frPackSigner(t);
      var key = t.getAttribute("data-frpacktick");
      if (key === null) return;
      if (frBusy) {
        t.checked = !t.checked; // a change is already on its way: this one waits
        return;
      }
      if (!t.checked) return frPackPost({ action: "untick", key: key }, "Saving…", "Unticked.");
      frPackPost(frPackSeen({ action: "tick", key: key }), "Saving…", "Ticked.");
    });
    view.addEventListener("input", function (e) {
      if (e.target && e.target.id === "frPackSkipReason") frPackSkipDraft = e.target.value;
    });
    view.addEventListener("submit", function (e) {
      var form = e.target;
      if (!form || form.id !== "frPackSkipForm") return;
      e.preventDefault();
      var reason = String((form.querySelector('[name="reason"]') || {}).value || "").trim();
      if (!reason) {
        frSay("pack", "Say why it is being left out.", true);
        return frPaintNotice("pack");
      }
      var body = frPackSeen({ action: "skip", key: frPackSkip });
      body.reason = reason;
      frPackPost(body, "Saving…", "Left out.");
    });
  }

  // ---- What gifts could do (the list for everyone who can see Fundraising; changes for admins) ----
  // The shared "could" examples fundraiser, event and team pages show under the give amounts and the
  // meter (src/impact/examples.ts, GET /api/admin/impact-examples). Admins add, edit, switch off and
  // on, and move them up or down; the server checks the words say could, never will buy. Nothing is
  // deleted. Each change is in audit_log.
  var frImpact = null; // [{ id, amountPence, wording, active, sortOrder, onGiveForm, meterLine }]
  var frImpactFailed = false;
  var frImpactEditing = null; // the id of the example being edited
  var frImpactDraft = null; // { amount, wording, onGiveForm }, as typed
  var frImpactBusy = false;

  // "£25", "25", "2.50" -> pence; anything else -> null.
  function frImpactPence(typed) {
    var t = String(typed || "").replace(/[£,\s]/g, "");
    if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
    return Math.round(parseFloat(t) * 100);
  }
  function frImpactFind(id) {
    return (frImpact || []).filter(function (e) { return e.id === id; })[0] || null;
  }
  function frImpactCanEdit() {
    return isAdmin() && frCanWrite();
  }
  function frImpactWhere(e) {
    var where = e.onGiveForm ? "Under the give amounts" : "Big totals only";
    if (e.meterLine === "red_bags") where += ". Counts the Red Bags under the meter.";
    else if (e.meterLine === "uniforms") where += ". Counts the school uniforms under the meter.";
    return where;
  }

  function frLoadImpact() {
    return authFetch("/api/admin/impact-examples")
      .then(okJson)
      .then(function (d) {
        frImpact = d && Array.isArray(d.examples) ? d.examples : null;
        frImpactFailed = !frImpact;
        frRenderImpact();
      })
      .catch(function (err) {
        if (err && err.message === "unauthorized") return;
        frImpact = null;
        frImpactFailed = true;
        frRenderImpact();
      });
  }

  function frImpactRow(e, i, list) {
    var id = String(e.id);
    var line = H.formatPence(e.amountPence) + " " + e.wording;
    if (frImpactEditing === e.id) {
      var d = frImpactDraft || { amount: frPounds(e.amountPence), wording: e.wording, onGiveForm: e.onGiveForm };
      return '<li class="fr-impact-editing"><span class="fr-people-who">' +
        '<label class="fx-call-label" for="frImpactEditAmount">Amount (£)</label>' +
        '<input class="fx-call-input" id="frImpactEditAmount" type="text" inputmode="decimal" maxlength="9" autocomplete="off" value="' + H.escapeHtml(d.amount) + '">' +
        '<label class="fx-call-label" for="frImpactEditWording">What it could do</label>' +
        '<input class="fx-call-input" id="frImpactEditWording" type="text" maxlength="160" autocomplete="off" value="' + H.escapeHtml(d.wording) + '">' +
        '<label class="fr-impact-give" for="frImpactEditGive"><input id="frImpactEditGive" type="checkbox"' + (d.onGiveForm ? " checked" : "") + "> Show under the give amounts</label></span>" +
        '<span class="fr-people-actions"><button class="admin-btn" type="button" data-frimpactsave>Save</button>' +
        '<button class="fr-link-btn" type="button" data-frimpactcancel>Cancel</button></span></li>';
    }
    var name = H.escapeHtml(line);
    // The two the meter line counts with keep their words and amount: only on, off and moving.
    var fixed = e.meterLine ? '<span class="fr-impact-fixed">Used for the line under the meter, so its words and amount are fixed.</span>' : "";
    var who = '<span class="fr-people-who"><span class="fr-impact-line">' + name + '</span><span class="fr-impact-where">' + H.escapeHtml(frImpactWhere(e)) + "</span>" + fixed + "</span>";
    if (!frImpactCanEdit()) return "<li>" + who + "</li>";
    var actions = e.meterLine ? "" : '<button class="fr-link-btn" type="button" data-frimpactedit="' + id + '" aria-label="' + H.escapeHtml("Edit " + line) + '">Edit</button>';
    if (e.active) {
      if (i > 0) actions += '<button class="fr-link-btn" type="button" data-frimpactup="' + id + '" aria-label="' + H.escapeHtml("Move up: " + line) + '">Move up</button>';
      if (i < list.length - 1) actions += '<button class="fr-link-btn" type="button" data-frimpactdown="' + id + '" aria-label="' + H.escapeHtml("Move down: " + line) + '">Move down</button>';
      actions += '<button class="fr-link-btn" type="button" data-frimpactoff="' + id + '" aria-label="' + H.escapeHtml("Switch off " + line) + '">Switch off</button>';
    } else {
      actions += '<button class="fr-link-btn" type="button" data-frimpacton="' + id + '" aria-label="' + H.escapeHtml("Switch on " + line) + '">Switch on</button>';
    }
    return "<li>" + who + '<span class="fr-people-actions">' + actions + "</span></li>";
  }

  function frRenderImpact() {
    var card = el("frImpact");
    if (!card) return;
    card.hidden = false;
    var write = frImpactCanEdit();
    el("frImpactAddForm").hidden = !write;
    el("frImpactReadOnly").hidden = write;
    var list = el("frImpactList");
    var off = el("frImpactOff");
    if (!frImpact) {
      list.innerHTML = '<li class="fr-people-empty">' + (frImpactFailed ? "The examples could not load just now. Try again in a moment." : "Loading&hellip;") + "</li>";
      off.hidden = true;
      el("frImpactOffHead").hidden = true;
      return;
    }
    var on = frImpact.filter(function (e) { return e.active; });
    var gone = frImpact.filter(function (e) { return !e.active; });
    list.innerHTML = on.length ? on.map(frImpactRow).join("") : '<li class="fr-people-empty">No examples are switched on, so the pages show none.</li>';
    off.innerHTML = gone.map(frImpactRow).join("");
    off.hidden = gone.length === 0;
    el("frImpactOffHead").hidden = gone.length === 0;
    if (frImpactEditing !== null) {
      var box = el("frImpactEditWording");
      var a = doc.activeElement;
      if (box && a !== box && a !== el("frImpactEditAmount") && a !== el("frImpactEditGive")) box.focus();
    }
  }

  // One change at a time. Answers true (saved), false (refused or failed) or null (one on its way).
  function frImpactSend(method, path, body, saidOk) {
    if (frImpactBusy) return Promise.resolve(null);
    frImpactBusy = true;
    frTeamSay("frImpactStatus", "Saving…", false);
    return frSend(method, path, body)
      .then(function (r) {
        if (!r.ok) {
          frTeamSay("frImpactStatus", frRefusal(r, "That did not save. Please try again."), true);
          return false;
        }
        frTeamSay("frImpactStatus", saidOk, false);
        if (r.body && Array.isArray(r.body.examples)) {
          frImpact = r.body.examples;
          frRenderImpact();
          return true;
        }
        return frLoadImpact().then(function () { return true; });
      })
      .catch(function (err) {
        if (!(err && err.message === "unauthorized")) frTeamSay("frImpactStatus", "That did not save. Please try again.", true);
        return false;
      })
      .then(function (ok) {
        frImpactBusy = false;
        return ok;
      });
  }
  function frImpactFocus(selector) {
    var target = selector ? doc.querySelector(selector) : null;
    if (!target) target = el("frImpactStatus");
    if (target && target.focus) target.focus();
  }

  // What was typed, checked enough to send: the server checks the words say could.
  function frImpactRead(amountText, wordingText) {
    var amountPence = frImpactPence(amountText);
    var wording = String(wordingText || "").replace(/\s+/g, " ").trim();
    if (amountPence === null || amountPence < 100) return { error: "Type the amount in pounds first, like 25." };
    if (!wording) return { error: "Type what a gift could do, like could help buy a pair of school shoes." };
    return { amountPence: amountPence, wording: wording };
  }

  function frImpactAdd() {
    var read = frImpactRead(el("frImpactAmount").value, el("frImpactWording").value);
    if (read.error) return frTeamSay("frImpactStatus", read.error, true);
    var body = { amountPence: read.amountPence, wording: read.wording, onGiveForm: !!el("frImpactGive").checked };
    return frImpactSend("POST", "/api/admin/impact-examples", body, "Added. It shows on fundraiser, event and team pages now.").then(function (ok) {
      if (ok === null) return;
      if (ok) {
        el("frImpactAmount").value = "";
        el("frImpactWording").value = "";
        el("frImpactGive").checked = true;
        el("frImpactAmount").focus();
      } else frImpactFocus(null);
    });
  }

  function frImpactStartEdit(id) {
    var e = frImpactFind(id);
    if (!e) return;
    frImpactEditing = id;
    frImpactDraft = { amount: frPounds(e.amountPence), wording: e.wording, onGiveForm: !!e.onGiveForm };
    frTeamSay("frImpactStatus", "", false);
    frRenderImpact();
  }
  function frImpactCancelEdit() {
    var id = frImpactEditing;
    frImpactEditing = null;
    frImpactDraft = null;
    frRenderImpact();
    frImpactFocus('[data-frimpactedit="' + id + '"]');
  }
  function frImpactSaveEdit() {
    var id = frImpactEditing;
    if (!frImpactFind(id)) return;
    var read = frImpactRead(el("frImpactEditAmount").value, el("frImpactEditWording").value);
    if (read.error) return frTeamSay("frImpactStatus", read.error, true);
    var body = { amountPence: read.amountPence, wording: read.wording, onGiveForm: !!el("frImpactEditGive").checked };
    return frImpactSend("PATCH", "/api/admin/impact-examples/" + id, body, "Saved. The pages say it now.").then(function (ok) {
      if (ok === null) return;
      if (ok) {
        frImpactEditing = null;
        frImpactDraft = null;
        frRenderImpact();
        frImpactFocus('[data-frimpactedit="' + id + '"]');
      } else frImpactFocus(null);
    });
  }

  function frImpactSetActive(id, active) {
    var e = frImpactFind(id);
    if (!e) return;
    var line = H.formatPence(e.amountPence) + " " + e.wording;
    if (!active && !window.confirm("Switch off “" + line + "”? The pages stop showing it, and you can switch it on again.")) return;
    var said = active ? "Switched on. The pages show it now." : "Switched off. The pages no longer show it.";
    return frImpactSend("PATCH", "/api/admin/impact-examples/" + id, { active: active }, said).then(function (ok) {
      if (ok === null) return;
      frImpactFocus(ok ? (active ? '[data-frimpactoff="' + id + '"]' : '[data-frimpacton="' + id + '"]') : null);
    });
  }

  function frImpactMove(id, direction) {
    var said = direction === "up" ? "Moved up." : "Moved down.";
    return frImpactSend("POST", "/api/admin/impact-examples/" + id + "/move", { direction: direction }, said).then(function (ok) {
      if (ok === null) return;
      frImpactFocus(ok ? "[data-frimpact" + direction + '="' + id + '"]' : null);
    });
  }

  function frImpactWire(view) {
    view.addEventListener("click", function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      if (t.closest("#frImpactAdd")) return frImpactAdd();
      if (t.closest("[data-frimpactsave]")) return frImpactSaveEdit();
      if (t.closest("[data-frimpactcancel]")) return frImpactCancelEdit();
      var pick = function (name) {
        var b = t.closest("[data-frimpact" + name + "]");
        return b ? Number(b.getAttribute("data-frimpact" + name)) : null;
      };
      var id;
      if ((id = pick("edit")) !== null) return frImpactStartEdit(id);
      if ((id = pick("up")) !== null) return frImpactMove(id, "up");
      if ((id = pick("down")) !== null) return frImpactMove(id, "down");
      if ((id = pick("off")) !== null) return frImpactSetActive(id, false);
      if ((id = pick("on")) !== null) return frImpactSetActive(id, true);
    });
    // What is typed in an edit is kept, so a redraw never loses it.
    function keep(e) {
      var t = e.target;
      if (!t || !frImpactDraft) return;
      if (t.id === "frImpactEditAmount") frImpactDraft.amount = t.value;
      if (t.id === "frImpactEditWording") frImpactDraft.wording = t.value;
      if (t.id === "frImpactEditGive") frImpactDraft.onGiveForm = !!t.checked;
    }
    view.addEventListener("input", keep);
    view.addEventListener("change", keep);
    // Enter adds or saves; Escape leaves an edit as it was.
    view.addEventListener("keydown", function (e) {
      var t = e.target;
      if (!t || !t.id) return;
      if (e.key === "Enter" && (t.id === "frImpactAmount" || t.id === "frImpactWording")) {
        e.preventDefault();
        frImpactAdd();
      } else if ((t.id === "frImpactEditAmount" || t.id === "frImpactEditWording") && (e.key === "Enter" || e.key === "Escape")) {
        e.preventDefault();
        if (e.key === "Enter") frImpactSaveEdit();
        else frImpactCancelEdit();
      }
    });
  }

  // ---- boot: restore an in-tab session ----
  var claims = H.parseClaims(token());
  if (claims && typeof claims.exp === "number" && claims.exp > Date.now()) showApp(claims);
  else {
    clearToken();
    showLogin();
  }

  // --- Festive Ball (TASK-313) ------------------------------------------------
  //
  // The launch controls. The gate is the important one: flipping it publishes the ticket page
  // AND the home-page promotion in one move, so it gets a confirm and says in words what will
  // happen rather than relying on the operator knowing.
  var ballWired = false;
  var ballSettings = null;

  function ballStatus(id, msg) {
    var n = el(id);
    if (n) n.textContent = msg || "";
  }

  // <input type="datetime-local"> wants local wall-clock with no zone; the API speaks ISO.
  function toLocalInput(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    var pad = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
      "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  function fromLocalInput(value) {
    if (!value) return null;
    var d = new Date(value);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }

  // Only a live booking has seats to give back; anything already cancelled or refunded says so
  // instead of offering a button that would 409.
  function cancelCell(b) {
    // TASK-484: a cancelled bank transfer booking whose money arrives after all comes back, if its
    // seats are still free. Confirming money is for admins.
    // Only one cancelled while still unpaid: one paid and then cancelled has been refunded by hand.
    if (b.status === "cancelled" && b.paymentMethod === "transfer" && b.cancelledFrom === "pending" && isAdmin()) {
      return markPaidButton(b, true);
    }
    if (b.status !== "pending" && b.status !== "paid") return "—";
    if (!canEdit("ball")) return "";
    var transferMark = b.paymentMethod !== "transfer" ? "" : b.status === "pending" ? ' data-transfer="1"' : ' data-paid-transfer="1"';
    return '<button type="button" class="btn btn-small btn-danger" data-cancel-booking="' +
      H.escapeHtml(b.reference) + '"' + transferMark + ">Cancel</button>";
  }

  // ---- TASK-484: paying for the Ball by bank transfer -------------------------------------------
  //
  // The bank details and the switch (admins only), the bookings awaiting a transfer, and the three
  // things staff do with one: mark it paid (admins only, confirming the exact amount), give more
  // time, or cancel. The server enforces who may do what; this only decides what each person is offered.

  // "£1,020.00": the exact figure, because it is what staff check against the bank statement.
  function exactMoney(pence) {
    return "£" + (pence / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  // "2026-10-08" as "Thu 8 Oct". Noon UTC, so no time zone can move it a day.
  function shortDay(iso) {
    return new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", {
      weekday: "short", day: "numeric", month: "short", timeZone: "UTC",
    });
  }
  function addDays(iso, n) {
    var p = iso.split("-").map(Number);
    return new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)).toISOString().slice(0, 10);
  }
  function markPaidButton(b, cancelled) {
    return '<button type="button" class="btn btn-primary ball-mark-paid" data-mark-paid="' + H.escapeHtml(b.reference) +
      '" data-amount="' + b.totalPence + '" data-name="' + H.escapeHtml(b.buyerName) + '"' +
      (cancelled ? ' data-cancelled="1"' : "") + ">Mark as paid</button>";
  }

  var ballTransferRows = [];

  function ballTransfersTable(rows) {
    if (!rows.length) return '<p class="admin-empty">No bookings are waiting for a bank transfer.</p>';
    var body = rows.map(function (t) {
      var what = t.kind === "table"
        ? t.quantity + (t.quantity === 1 ? " table" : " tables")
        : t.quantity + (t.quantity === 1 ? " ticket" : " tickets");
      var actions = (isAdmin() ? markPaidButton(t, false) : "") +
        // One button, then two quieter links: marking money arrived is the job; the others are exceptions.
        (canEdit("ball")
          ? '<button type="button" class="admin-link" data-pay-by="' + H.escapeHtml(t.reference) +
            '" data-current="' + H.escapeHtml(t.payBy) + '">Give more time</button>' +
            '<button type="button" class="admin-link" data-cancel-booking="' + H.escapeHtml(t.reference) +
            '" data-transfer="1">Cancel</button>'
          : "");
      return '<tr data-ref="' + H.escapeHtml(t.reference) + '"' + ((t.buyerPhone || "").trim() ? "" : ' data-no-phone="1"') +
        '><td data-label="Reference">' + H.escapeHtml(t.reference) +
        // TASK-487: made since this person last opened Festive Ball.
        rowNewPill("ball", t.createdAt) +
        // One block, so the narrow card's flex cell keeps name, email, phone and company stacked.
        '</td><td data-label="Who"><span class="ball-who">' + H.escapeHtml(t.buyerName) + "<br /><small>" + H.escapeHtml(t.buyerEmail) +
        "</small>" +
        // Awaiting its transfer, so still going ahead: flagged if it has no phone number.
        ballPhoneBits(t, true) +
        // TASK-486: the company it is invoiced to, and the invoice they were given.
        (t.company
          ? "<br /><small>" + H.escapeHtml(t.company) +
            (t.invoiceUrl
              ? ' &middot; <a href="' + H.escapeHtml(t.invoiceUrl) + '" target="_blank" rel="noopener">Invoice</a>'
              : "") +
            "</small>"
          : "") +
        '</span></td><td data-label="Amount">' + exactMoney(t.totalPence) + "<br /><small>" + what +
        '</small></td><td data-label="Pay by">' + H.escapeHtml(shortDay(t.payBy)) +
        // TASK-485: past its date, for staff to decide on; and whether the reminder has gone.
        (t.overdue ? ' <span class="admin-pill is-new">Overdue</span>' : "") +
        (t.reminded ? "<br /><small>Reminder sent</small>" : "") +
        '</td><td data-label=""><span class="ball-transfer-actions">' + actions + "</span></td></tr>";
    }).join("");
    return '<div class="admin-table-wrap"><table class="admin-table ball-transfers-table"><thead><tr><th>Reference</th><th>Who</th><th>Amount</th>' +
      "<th>Pay by</th><th></th></tr></thead><tbody>" + body + "</tbody></table></div>";
  }

  // By reference, name or email, or by amount however it is typed: "1020", "1,020" or "£1,020.00".
  function filterBallTransfers() {
    var input = el("ballTransferSearch");
    var q = ((input && input.value) || "").trim().toLowerCase();
    // Only something that looks like money is matched as an amount: the digits in a reference such
    // as BALL-7KQ2MZ would otherwise find every total starting with 72.
    var digits = /^[£\d.,\s]+$/.test(q) ? q.replace(/[^0-9]/g, "") : "";
    Array.prototype.forEach.call(document.querySelectorAll("#ballTransfers tbody tr"), function (tr) {
      var t = ballTransferRows.filter(function (r) { return r.reference === tr.getAttribute("data-ref"); })[0];
      // Jaimie 2026-10-03: "Show only bookings with no phone number" covers this list too.
      var phoneHidden = ballNoPhoneOnly() && !tr.hasAttribute("data-no-phone");
      if (!t || !q) { tr.hidden = phoneHidden; return; }
      var text = (t.reference + " " + t.buyerName + " " + t.buyerEmail).toLowerCase();
      var byAmount = digits.length > 0 && String(t.totalPence).indexOf(digits) === 0;
      tr.hidden = phoneHidden || !(text.indexOf(q) !== -1 || byAmount);
    });
  }

  // TASK-488: staff add a bank transfer booking by hand, for a phone or email order. The server
  // (POST /api/admin/ball/transfer-bookings, Festive Ball edit) makes the same booking and sends the
  // same emails as the ticket page; this form only gathers what the buyer said.
  function longDay(iso) {
    return new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", {
      weekday: "long", day: "numeric", month: "long", timeZone: "UTC",
    });
  }
  function showAddTransfer(open) {
    el("ballAddTransferForm").hidden = !open;
    el("ballAddTransferOpen").setAttribute("aria-expanded", open ? "true" : "false");
    if (open) el("ballAddFirstName").focus();
  }
  function wireAddTransferBooking() {
    var form = el("ballAddTransferForm");
    var value = function (id) { return (el(id).value || "").trim(); };
    el("ballAddTransferOpen").addEventListener("click", function () {
      showAddTransfer(form.hidden);
    });
    el("ballAddCancel").addEventListener("click", function () {
      showAddTransfer(false);
    });
    el("ballAddInvoice").addEventListener("change", function () {
      el("ballAddInvoiceFields").hidden = !el("ballAddInvoice").checked;
    });
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!value("ballAddFirstName") || !value("ballAddSurname")) {
        ballStatus("ballAddStatus", "Give the buyer's first name and surname.");
        return;
      }
      if (value("ballAddEmail").indexOf("@") === -1) {
        ballStatus("ballAddStatus", "Give the buyer's email address: the bank details go there.");
        return;
      }
      // Jaimie 2026-10-03: the buyer's phone number, for menu choices. Optional here: staff may not
      // have it for a phone or email order, and the list flags the booking until someone adds it.
      var buyerPhone = el("ballAddBuyerPhone") ? value("ballAddBuyerPhone") : "";
      // One booking takes up to 4 tables or 9 tickets, as on the ticket page.
      var kind = el("ballAddKind").value;
      var quantity = Math.floor(Number(el("ballAddQuantity").value)) || 1;
      if (quantity > (kind === "table" ? 4 : 9)) {
        ballStatus("ballAddStatus", kind === "table"
          ? "One booking takes up to 4 tables. Add another booking for the rest."
          : "One booking takes up to 9 tickets. Add another booking for the rest, or book a table.");
        return;
      }
      var invoicing = el("ballAddInvoice").checked;
      if (invoicing && (!value("ballAddCompany") || !value("ballAddAddress"))) {
        ballStatus("ballAddStatus", "Give the company's name and address, for the invoice.");
        return;
      }
      if (!el("ballAddTerms").checked) {
        ballStatus("ballAddStatus", "Tick to confirm the buyer has agreed to the ticket terms.");
        return;
      }
      var body = {
        kind: kind,
        quantity: quantity,
        buyerFirstName: value("ballAddFirstName"),
        buyerSurname: value("ballAddSurname"),
        buyerEmail: value("ballAddEmail"),
        donationPence: Math.max(0, Math.round((Number(value("ballAddDonation")) || 0) * 100)),
        termsAccepted: true,
      };
      if (buyerPhone) body.buyerPhone = buyerPhone;
      if (invoicing) {
        body.invoice = {
          company: value("ballAddCompany"),
          address: value("ballAddAddress"),
          po: value("ballAddPo"),
          accountsEmail: value("ballAddAccountsEmail"),
          phone: value("ballAddPhone"),
        };
      }
      el("ballAddSave").disabled = true;
      ballStatus("ballAddStatus", "Adding…");
      authFetch("/api/admin/ball/transfer-bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
        .then(okJsonOrSaid)
        .then(function (d) {
          el("ballAddSave").disabled = false;
          ballStatus(
            "ballAddStatus",
            // The email goes after the booking is saved, so this says it is on its way, not that it arrived.
            "Added " + d.reference + ": " + exactMoney(d.totalPence) + " to pay by " + longDay(d.payBy) +
              ". The bank details are on their way to " + body.buyerFirstName + " by email.",
          );
          form.reset();
          el("ballAddInvoiceFields").hidden = true;
          showAddTransfer(false);
          loadBallTransfers();
        })
        .catch(function (err) {
          el("ballAddSave").disabled = false;
          if (err && err.message === "unauthorized") return;
          ballStatus("ballAddStatus", (err && err.said) || "Could not add that booking. Nothing has been changed.");
        });
    });
  }

  function loadBallTransfers() {
    // TASK-488: adding a booking by hand is for Festive Ball edit, as the server requires.
    el("ballAddTransferOpen").hidden = !canEdit("ball");
    if (!canEdit("ball")) el("ballAddTransferForm").hidden = true;
    authFetch("/api/admin/ball/transfers")
      .then(okJson)
      .then(function (d) {
        ballTransferRows = d.results || [];
        el("ballTransfers").innerHTML = ballTransfersTable(ballTransferRows);
        filterBallTransfers();
      })
      .catch(function () {
        el("ballTransfers").innerHTML = '<p class="admin-empty">Could not load the bookings awaiting a transfer.</p>';
      });
  }

  function loadBallTransferSettings() {
    authFetch("/api/admin/ball/transfer-settings")
      .then(okJson)
      .then(function (s) {
        el("ballTransferAccountName").value = s.accountName || "";
        el("ballTransferSortCode").value = s.sortCode || "";
        el("ballTransferAccountNumber").value = s.accountNumber || "";
        el("ballTransferOn").checked = !!s.on;
        el("ballTransferLastDay").value = s.lastDay || "";
        var admin = isAdmin();
        ["ballTransferAccountName", "ballTransferSortCode", "ballTransferAccountNumber", "ballTransferLastDay", "ballTransferOn", "ballTransferSave"]
          .forEach(function (id) { el(id).disabled = !admin; });
      })
      .catch(function () {
        ballStatus("ballTransferStatus", "Could not load the bank details.");
      });
  }

  function onMarkPaidClick(e) {
    var btn = e.target && e.target.closest && e.target.closest("[data-mark-paid]");
    if (!btn) return false;
    var reference = btn.getAttribute("data-mark-paid");
    var amount = Number(btn.getAttribute("data-amount"));
    var ask = "Has " + exactMoney(amount) + " arrived for " + reference + " (" + btn.getAttribute("data-name") + ")?" +
      "\n\nThey're emailed their confirmation and the link to tell us who's coming.";
    if (btn.getAttribute("data-cancelled")) {
      ask = "This booking was cancelled. If its seats are still free it comes back as paid, and they're emailed their confirmation.\n\n" + ask;
    }
    if (!window.confirm(ask)) return true;
    btn.disabled = true;
    authFetch("/api/admin/ball/bookings/" + encodeURIComponent(reference) + "/mark-paid", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmTotalPence: amount }),
    })
      .then(okJsonOrSaid)
      .then(function () { loadBall(); })
      .catch(function (err) {
        btn.disabled = false;
        if (err && err.message === "unauthorized") return;
        window.alert((err && err.said) || "Could not mark " + reference + " paid. Nothing has been changed.");
        loadBall();
      });
    return true;
  }

  function onPayByClick(e) {
    var btn = e.target && e.target.closest && e.target.closest("[data-pay-by]");
    if (!btn) return false;
    var reference = btn.getAttribute("data-pay-by");
    var next = window.prompt("New pay-by date for " + reference + " (YYYY-MM-DD)", addDays(btn.getAttribute("data-current"), 7));
    if (!next) return true;
    btn.disabled = true;
    authFetch("/api/admin/ball/bookings/" + encodeURIComponent(reference) + "/pay-by", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payBy: next.trim() }),
    })
      .then(okJsonOrSaid)
      .then(function () { loadBallTransfers(); })
      .catch(function (err) {
        btn.disabled = false;
        if (err && err.message === "unauthorized") return;
        window.alert((err && err.said) || "Could not change the date. Nothing has been changed.");
      });
    return true;
  }

  function onTransfersClick(e) {
    if (onBookingPhoneClick(e)) return;
    if (onMarkPaidClick(e)) return;
    if (onPayByClick(e)) return;
    onCancelBookingClick(e);
  }

  // TASK-324: seats held back for a named party, with a deadline. Replaces trusting a bare
  // number nobody can account for by November.
  function ballHoldsTable(rows) {
    if (!rows.length) return '<p class="admin-empty">Nothing is held back.</p>';
    var body = rows.map(function (h) {
      var what = h.quantity + " " + (h.kind === "table"
        ? (h.quantity === 1 ? "table" : "tables")
        : (h.quantity === 1 ? "seat" : "seats"));
      var until = h.expiresAt
        ? H.escapeHtml(new Date(h.expiresAt).toLocaleString("en-GB"))
        : "<em>until released</em>";
      var release = canEdit("ball")
        ? '<button type="button" class="btn btn-small" data-release-hold="' + h.id + '">Release</button>'
        : "";
      return "<tr><td>" + H.escapeHtml(h.name) + (h.note ? "<br /><small>" + H.escapeHtml(h.note) + "</small>" : "") +
        "</td><td>" + what + " (" + h.seats + " seats)</td><td>" + until +
        "</td><td>" + H.escapeHtml(h.createdBy) + "</td><td>" + release + "</td></tr>";
    }).join("");
    return '<table class="admin-table"><thead><tr><th>For</th><th>Held</th><th>Until</th>' +
      "<th>Placed by</th><th></th></tr></thead><tbody>" + body + "</tbody></table>";
  }

  function loadBallHolds() {
    authFetch("/api/admin/ball/holds")
      .then(okJson)
      .then(function (d) {
        el("ballHolds").innerHTML = ballHoldsTable(d.results || []);
      })
      .catch(function () {
        el("ballHolds").innerHTML = '<p class="admin-empty">Could not load holds.</p>';
      });
  }

  function onReleaseHoldClick(e) {
    var btn = e.target && e.target.closest && e.target.closest("[data-release-hold]");
    if (!btn) return;
    if (!window.confirm("Release these seats back on sale?")) return;
    btn.disabled = true;
    authFetch("/api/admin/ball/holds/" + encodeURIComponent(btn.getAttribute("data-release-hold")), {
      method: "DELETE",
    })
      .then(okJsonOrSaid)
      .then(function () { loadBall(); })
      .catch(function (err) {
        btn.disabled = false;
        if (err && err.message === "unauthorized") return;
        // The server's own reason when it gave one ("Those seats have already been released."),
        // then the list as it really is now, so a hold that has gone does not stay on screen.
        ballStatus("ballHoldStatus", (err && err.said) || "Could not release those seats.");
        loadBall();
      });
  }

  // Jaimie 2026-10-03: the booker's phone number, which the ticket page now asks for so NBCC can
  // contact them about menu choices. A booking still going ahead (paid, or awaiting its bank transfer)
  // with none is flagged, because staff chase those by hand; nothing is sent automatically.
  function ballStillOn(b) {
    return b.status === "paid" || (b.status === "pending" && b.paymentMethod === "transfer");
  }
  function ballPhoneBits(b, stillOn) {
    var phone = (b.buyerPhone || "").trim();
    var out = phone
      ? '<small><a href="tel:' + H.escapeHtml(phone.replace(/[^0-9+]/g, "")) + '">' + H.escapeHtml(phone) + "</a></small>"
      : stillOn ? '<span class="admin-pill is-new">No phone number yet</span>' : "";
    if (stillOn && canEdit("ball")) {
      out += '<button type="button" class="admin-link" data-booking-phone="' + H.escapeHtml(b.reference) +
        '" data-current="' + H.escapeHtml(phone) + '">' + (phone ? "Change phone" : "Add phone") + "</button>";
    }
    return out ? '<span class="ball-phone">' + out + "</span>" : "";
  }

  // "Show only bookings with no phone number", over the bookings table.
  // Every element here is null-checked: a browser holding an admin.html from before the phone boxes
  // existed must still get the rest of the Festive Ball screen.
  function ballNoPhoneOnly() {
    var only = el("ballNoPhoneOnly");
    return !!(only && only.checked);
  }
  function filterBallNoPhone() {
    var only = ballNoPhoneOnly();
    Array.prototype.forEach.call(document.querySelectorAll("#ballBookings tbody tr"), function (tr) {
      tr.hidden = only && !tr.hasAttribute("data-no-phone");
    });
    // The awaiting-transfer list, which has its own search as well.
    filterBallTransfers();
  }

  // How many bookings still going ahead (paid, or awaiting a transfer) have no phone number, as the
  // server counted them: every one, not only the rows on screen, and the same ones the pill marks.
  // Hidden if it did not say.
  function ballNoPhoneRender(n) {
    var box = el("ballNoPhone");
    if (!box) return;
    if (typeof n !== "number") {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    var count = el("ballNoPhoneCount");
    if (count) {
      count.textContent = n === 0
        ? "Every booking has a phone number."
        : n + (n === 1 ? " booking has" : " bookings have") + " no phone number yet.";
    }
    ["ballNoPhoneHow", "ballNoPhoneOnlyLabel"].forEach(function (id) {
      var node = el(id);
      if (node) node.hidden = n === 0;
    });
    var only = el("ballNoPhoneOnly");
    if (only && n === 0) only.checked = false;
    filterBallNoPhone();
  }

  // Add or change the number on a booking. An empty box takes it away; Cancel changes nothing.
  function onBookingPhoneClick(e) {
    var btn = e.target && e.target.closest && e.target.closest("[data-booking-phone]");
    if (!btn) return false;
    var reference = btn.getAttribute("data-booking-phone");
    var typed = window.prompt(
      "Phone number for booking " + reference + "\n\nDigits and spaces, for example 07700 900123. Leave it empty to take the number away.",
      btn.getAttribute("data-current") || "",
    );
    if (typed === null) return true;
    btn.disabled = true;
    authFetch("/api/admin/ball/bookings/" + encodeURIComponent(reference) + "/phone", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: typed.trim() }),
    })
      .then(okJsonOrSaid)
      .then(function () { loadBall(); })
      .catch(function (err) {
        btn.disabled = false;
        if (err && err.message === "unauthorized") return;
        window.alert((err && err.said) || "Could not save the phone number for " + reference + ". Nothing has been changed.");
      });
    return true;
  }

  function ballBookingsTable(rows) {
    if (!rows.length) return '<p class="admin-empty">No bookings yet.</p>';
    var body = rows.map(function (b) {
      var what = b.kind === "table"
        ? b.quantity + (b.quantity === 1 ? " table" : " tables")
        : b.quantity + (b.quantity === 1 ? " ticket" : " tickets");
      var stillOn = ballStillOn(b);
      var noPhone = stillOn && !(b.buyerPhone || "").trim();
      // Labelled cells, so on a phone each booking is a card like the transfers above.
      return "<tr" + (noPhone ? ' data-no-phone="1"' : "") + '><td data-label="Reference">' + H.escapeHtml(b.reference) +
        rowNewPill("ball", b.status === "paid" ? b.paidAt : null) +
        '</td><td data-label="Who"><span class="ball-who">' + H.escapeHtml(b.buyerName) +
        "<br /><small>" + H.escapeHtml(b.buyerEmail) + "</small>" + ballPhoneBits(b, stillOn) + '</span></td><td data-label="Bought">' + what +
        '</td><td class="admin-num" data-label="Paid">' + H.formatPence(b.totalPence) +
        '</td><td class="admin-num" data-label="Donation">' + (b.donationPence ? H.formatPence(b.donationPence) + (b.giftAid ? " (GA)" : "") : "—") +
        '</td><td data-label="Status">' + H.escapeHtml(b.status) + '</td><td data-label="Newsletter">' + (b.newsletterOptIn ? "Yes" : "—") +
        '</td><td data-label="">' + cancelCell(b) + "</td></tr>";
    }).join("");
    return '<table class="admin-table ball-bookings-table"><thead><tr><th>Reference</th><th>Who</th><th>Bought</th>' +
      "<th>Paid</th><th>Donation</th><th>Status</th><th>Newsletter</th><th></th></tr></thead><tbody>" +
      body + "</tbody></table>";
  }

  // TASK-336: the chase list. Everything here is a difference the dashboard could not show
  // before - seats bought against guests named - which is the question behind both "who do I
  // nudge?" and "can the venue start on the catering list yet?".
  function ballOutstandingTable(rows) {
    if (!rows.length) {
      return '<p class="admin-empty">Everyone who has paid has sent their guest details.</p>';
    }
    var body = rows.map(function (b) {
      // No link until the confirmation mints the token, so a booking paid moments ago can
      // legitimately have none. Say so rather than linking to /ball/guests/null.
      var link = b.guestLink
        ? '<a href="' + H.escapeHtml(b.guestLink) + '" target="_blank" rel="noopener">Their link</a>'
        : "<small>No link yet</small>";
      return "<tr><td>" + H.escapeHtml(b.reference) + "</td><td>" + H.escapeHtml(b.buyerName) +
        '<br /><small><a href="mailto:' + H.escapeHtml(b.buyerEmail) + '">' +
        H.escapeHtml(b.buyerEmail) + "</a></small></td>" +
        '<td class="admin-num">' + b.guestsNamed + " of " + b.seats +
        '</td><td class="admin-num">' + b.missing + "</td><td>" + link + "</td></tr>";
    }).join("");
    return '<table class="admin-table"><thead><tr><th>Reference</th><th>Who booked</th>' +
      "<th>Named</th><th>Still missing</th><th></th></tr></thead><tbody>" + body + "</tbody></table>";
  }

  function ballGuestProgressRender(d) {
    var s = d.summary || {};
    el("ballGuestProgress").innerHTML =
      statCard(s.guestsNamed + " of " + s.seatsBooked, "Guests named") +
      // Warn while anything is outstanding: this is the number that decides whether the venue
      // can be given a catering list, so "nearly there" should not look like "done".
      statCard(s.percentComplete + "%", "Catering list ready", s.guestsMissing > 0) +
      statCard(s.bookingsOutstanding || 0, "Bookings to chase", s.bookingsOutstanding > 0) +
      statCard(s.needsGiven || 0, "Dietary or access needs");
    el("ballOutstanding").innerHTML = ballOutstandingTable(d.outstanding || []);
  }

  // TASK-418: the same shape as the guest-details chase above it, because it answers the same
  // question about a different thing and staff read the two together.
  function ballMenuOutstandingTable(rows) {
    if (!rows.length) {
      return '<p class="admin-empty">Everyone who has been named has chosen what they want.</p>';
    }
    var body = rows.map(function (b) {
      var link = b.guestLink
        ? '<a href="' + H.escapeHtml(b.guestLink) + '" target="_blank" rel="noopener">Their link</a>'
        : "<small>No link yet</small>";
      return "<tr><td>" + H.escapeHtml(b.reference) + "</td><td>" + H.escapeHtml(b.buyerName) +
        '<br /><small><a href="mailto:' + H.escapeHtml(b.buyerEmail) + '">' +
        H.escapeHtml(b.buyerEmail) + "</a></small></td>" +
        '<td class="admin-num">' + b.chosen + " of " + b.guestsNamed +
        '</td><td class="admin-num">' + b.missing + "</td><td>" + link + "</td></tr>";
    }).join("");
    return '<table class="admin-table"><thead><tr><th>Reference</th><th>Who booked</th>' +
      "<th>Chosen</th><th>Still to choose</th><th></th></tr></thead><tbody>" + body + "</tbody></table>";
  }

  function ballMenuProgressRender(d) {
    var s = d.summary || {};
    // Before the venue confirms a menu there is nothing outstanding and nothing to chase. Say
    // that, rather than showing a confident "0%" against a menu that does not exist.
    if (!s.asking) {
      el("ballMenuProgress").innerHTML =
        '<p class="admin-empty">No menu set yet, so there is nothing for anyone to choose.</p>';
      el("ballMenuOutstanding").innerHTML = "";
      return;
    }
    el("ballMenuProgress").innerHTML =
      statCard(s.chosen + " of " + s.guestsNamed, "Guests who have chosen") +
      statCard(s.percentComplete + "%", "Kitchen order ready", s.outstanding > 0) +
      statCard(s.bookingsOutstanding || 0, "Bookings to chase", s.bookingsOutstanding > 0);
    el("ballMenuOutstanding").innerHTML = ballMenuOutstandingTable(d.outstanding || []);
  }

  function ballRender(d) {
    ballSettings = d.settings;
    var a = d.availability || {};
    var s = d.dashboard || {};

    el("ballStats").innerHTML =
      statCard(s.seatsSold || 0, "Seats sold") +
      statCard(a.seatsRemaining || 0, "Seats left") +
      statCard(a.tablesRemaining || 0, "Whole tables left") +
      statCard(H.formatPence(s.totalPence || 0), "Taken") +
      statCard(H.formatPence(s.donationsPence || 0), "Donations") +
      statCard(H.formatPence(s.giftAidablePence || 0), "Gift Aid eligible") +
      statCard(s.newsletterOptIns || 0, "Newsletter opt-ins");

    // Say what IS, then the button says what it will DO.
    el("ballGateState").textContent = d.gateOpen
      ? "The ticket page is PUBLIC and the ball is promoted on the home page."
      : "The ticket page is private. Only people with the preview password can see it, and the home page says nothing about the ball.";
    var btn = el("ballGateToggle");
    btn.textContent = d.gateOpen ? "Make it private again" : "Publish the ball page";
    btn.disabled = !canEdit("ball");

    el("ballGateOpensAt").value = toLocalInput(ballSettings.gateOpensAt);
    el("ballTotalTables").value = ballSettings.totalTables;
    el("ballSeatsPerTable").value = ballSettings.seatsPerTable;
    el("ballHeldSeats").value = ballSettings.heldSeats;
    el("ballSalesCloseAt").value = toLocalInput(ballSettings.salesCloseAt);
    el("ballSalesClosed").checked = !!ballSettings.salesClosed;
    // Staff think in percent, the database stores basis points so nothing is a float.
    el("ballCardFeePercent").value = (ballSettings.cardFeePercentBp / 100).toFixed(2);
    el("ballCardFeeFixed").value = ballSettings.cardFeeFixedPence;
    ballFeeExample(ballSettings.cardFeePercentBp, ballSettings.cardFeeFixedPence);
    // datetime-local wants "YYYY-MM-DDTHH:mm" in LOCAL time. Slicing the ISO string would show
    // a UTC clock face against a British evening date, an hour out for half the year.
    el("ballLockAt").value = ballSettings.guestDetailsLockAt
      ? new Date(
          new Date(ballSettings.guestDetailsLockAt).getTime() -
            new Date(ballSettings.guestDetailsLockAt).getTimezoneOffset() * 60000,
        )
          .toISOString()
          .slice(0, 16)
      : "";
    el("ballMenuOptions").value = ballSettings.menuOptions || "";
    el("ballMenuNote").value = ballSettings.menuNote || "";
    el("ballArrivalTime").value = ballSettings.arrivalTime || "";
    el("ballIncludedNote").value = ballSettings.includedNote || "";
    el("ballLineUpNote").value = ballSettings.lineUpNote || "";

    // Editors get view-only on this section by default (the gate publishes a page), so mirror
    // the server rule in the UI rather than letting someone fill a form that will 403.
    var canWrite = canEdit("ball");
    ["ballGateSchedule", "ballCapacitySave", "ballFeeSave", "ballHoldSave", "ballDetailsSave"].forEach(function (id) {
      var n = el(id);
      if (n) n.hidden = !canWrite;
    });
  }

  // Mirrors stripeFeePence in src/ball/pricing.ts, including the round-UP.
  function ballFeeExample(bp, fixedPence) {
    var node = el("ballFeeExample");
    if (!node) return;
    if (!isFinite(bp) || !isFinite(fixedPence) || bp < 0 || fixedPence < 0) {
      node.textContent = "";
      return;
    }
    var pounds = function (pence) { return "£" + (pence / 100).toFixed(2); };
    var one = Math.ceil((10000 * bp) / 10000) + fixedPence;
    var table = Math.ceil((100000 * bp) / 10000) + fixedPence;
    node.textContent =
      "At this rate a £100 ticket costs " + pounds(one) +
      " and a £1,000 table costs " + pounds(table) +
      " (" + pounds(Math.round(table / 10)) + " a seat) — that is what the page asks a buyer to cover.";
  }

  function ballSave(patch, statusId, done) {
    ballStatus(statusId, "Saving…");
    authFetch("/api/admin/ball", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    })
      .then(okJson)
      .then(function () {
        ballStatus(statusId, "Saved.");
        loadBall();
        if (done) done();
      })
      .catch(function () {
        ballStatus(statusId, "Could not save. Your changes have not been applied.");
      });
  }

  function loadBall() {
    ballWire();
    el("ballBookings").innerHTML = '<p class="admin-loading">Loading…</p>';
    loadBallHolds();
    loadBallTransfers();
    loadBallTransferSettings();
    authFetch("/api/admin/ball")
      .then(okJson)
      .then(ballRender)
      .catch(function () {
        el("ballGateState").textContent = "Could not load the ball settings.";
        // No seats sold and £0 taken would be a claim nobody could make (TASK-476).
        el("ballStats").innerHTML = "";
      });
    authFetch("/api/admin/ball/bookings")
      .then(okJson)
      .then(function (d) {
        el("ballBookings").innerHTML =
          ballBookingsTable(d.results || []) +
          // Said out loud rather than silently dropped: a run of abandoned checkouts is what a
          // broken payment flow looks like from the outside, and a table that quietly omitted
          // them would show nothing wrong.
          // Behind a fold, not gone. Someone who pressed pay and did not arrive is worth being
          // able to look at — they may still be mid-payment, or they may be someone to ring —
          // but they are not a sale, so they must not sit in the same table as people who
          // actually bought.
          (d.abandoned
            ? '<details class="admin-fold"><summary>' + d.abandoned +
              (d.abandoned === 1 ? " checkout was" : " checkouts were") +
              " started and never paid for" +
              "</summary><p class=\"admin-note\">No money was taken. Their seats are kept for up to an hour in case they are still paying, then go back on sale. " +
              "A very recent one may still be mid-payment.</p>" +
              ballBookingsTable(d.abandonedRows || []) +
              "</details>"
            : "");
        ballNoPhoneRender(d.noPhone);
      })
      .catch(function () {
        el("ballBookings").innerHTML = '<p class="admin-empty">Could not load bookings.</p>';
        ballNoPhoneRender(null);
      });
    authFetch("/api/admin/ball/guest-progress")
      .then(okJson)
      .then(ballGuestProgressRender)
      .catch(function () {
        el("ballGuestProgress").innerHTML =
          '<p class="admin-empty">Could not load guest details.</p>';
        el("ballOutstanding").innerHTML = "";
      });
    authFetch("/api/admin/ball/menu-progress")
      .then(okJson)
      .then(ballMenuProgressRender)
      .catch(function () {
        el("ballMenuProgress").innerHTML =
          '<p class="admin-empty">Could not load menu choices.</p>';
        el("ballMenuOutstanding").innerHTML = "";
      });
  }

  // Cancelling hands the seats back to the public pool. It does NOT refund: money moves in
  // Stripe, by a person, deliberately. The confirmation says so, because "cancel" reads like
  // "undo the whole thing" and a buyer who is out of pocket will not agree.
  function onCancelBookingClick(e) {
    var btn = e.target && e.target.closest && e.target.closest("[data-cancel-booking]");
    if (!btn) return;
    var reference = btn.getAttribute("data-cancel-booking");
    // TASK-484: an unpaid bank transfer booking has no money to refund, and they are told.
    var ok = window.confirm(
      btn.getAttribute("data-transfer")
        ? "Cancel booking " + reference + "?"
          + "\n\nIt hasn't been paid. The seats go straight back on sale, and they're emailed that it's cancelled."
        : btn.getAttribute("data-paid-transfer")
          ? "Cancel booking " + reference + "?"
            + "\n\nThe seats go straight back on sale."
            + "\n\nThis does NOT refund any money. They paid by bank transfer, so refund them from the bank."
          : "Cancel booking " + reference + "?"
            + "\n\nThe seats go straight back on sale."
            + "\n\nThis does NOT refund any money. If they paid, refund them in Stripe separately."
    );
    if (!ok) return;
    var note = window.prompt("Why? (optional, kept in the audit log)", "") || "";
    btn.disabled = true;
    authFetch("/api/admin/ball/bookings/" + encodeURIComponent(reference) + "/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note: note }),
    })
      .then(okJsonOrSaid)
      .then(function () { loadBall(); })
      .catch(function (err) {
        btn.disabled = false;
        if (err && err.message === "unauthorized") return;
        // The server's own reason when it gave one ("That booking is already cancelled..."), then
        // the bookings as they really are now.
        window.alert((err && err.said) || "Could not cancel " + reference + ". Nothing has been changed.");
        loadBall();
      });
  }

  function ballWire() {
    if (ballWired) return;
    ballWired = true;

    // Delegated, because the tables are re-rendered on every load, and attached HERE, once. They
    // used to be added inside each load, so every reload stacked another copy and a single click on
    // Cancel asked as many times as the screen had been loaded (found in TASK-484, where marking a
    // transfer paid reloads the screen).
    wireAddTransferBooking();
    el("ballHolds").addEventListener("click", onReleaseHoldClick);
    el("ballBookings").addEventListener("click", function (e) {
      if (onBookingPhoneClick(e)) return;
      if (onMarkPaidClick(e)) return;
      onCancelBookingClick(e);
    });
    // TASK-484: bank transfer.
    el("ballTransfers").addEventListener("click", onTransfersClick);
    el("ballTransferSearch").addEventListener("input", filterBallTransfers);
    if (el("ballNoPhoneOnly")) el("ballNoPhoneOnly").addEventListener("change", filterBallNoPhone);
    el("ballTransferForm").addEventListener("submit", function (e) {
      e.preventDefault();
      if (!isAdmin()) return;
      ballStatus("ballTransferStatus", "Saving…");
      authFetch("/api/admin/ball/transfer-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountName: el("ballTransferAccountName").value.trim(),
          sortCode: el("ballTransferSortCode").value.trim(),
          accountNumber: el("ballTransferAccountNumber").value.trim(),
          on: el("ballTransferOn").checked,
          // TASK-485: an empty box means no last day.
          lastDay: el("ballTransferLastDay").value || null,
        }),
      })
        .then(okJsonOrSaid)
        .then(function (s) {
          // TASK-485: switched on is not the same as offered: after the last day, card only.
          ballStatus(
            "ballTransferStatus",
            !s.on
              ? "Saved. The ticket page does not offer bank transfer."
              : s.offered
                ? "Saved. The ticket page offers bank transfer."
                : "Saved. The last day for transfers has passed, so the ticket page offers card only.",
          );
          loadBallTransferSettings();
        })
        .catch(function (err) {
          if (err && err.message === "unauthorized") return;
          ballStatus("ballTransferStatus", (err && err.said) || "Could not save. Nothing has been changed.");
        });
    });

    el("ballGateForm").addEventListener("submit", function (e) {
      e.preventDefault();
      if (!ballSettings) return;
      var opening = !el("ballGateToggle").textContent.startsWith("Make");
      // Publishing is visible to the whole internet and un-ringable once someone has seen it,
      // so name the consequence rather than asking "are you sure?".
      var message = opening
        ? "This publishes the ticket page at nbcc.scot/ball and puts the ball on the home page, for everyone. Continue?"
        : "This hides the ticket page again and removes the ball from the home page. Anyone mid-booking will lose it. Continue?";
      if (!window.confirm(message)) return;
      ballSave({ gateOpen: opening }, "ballGateStatus");
    });

    el("ballGateSchedule").addEventListener("click", function () {
      ballSave({ gateOpensAt: fromLocalInput(el("ballGateOpensAt").value) }, "ballGateStatus");
    });

    el("ballPasswordForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var input = el("ballPreviewPassword");
      var value = (input.value || "").trim();
      if (value.length < 8) {
        ballStatus("ballPasswordStatus", "Use at least 8 characters.");
        return;
      }
      ballSave({ previewPassword: value }, "ballPasswordStatus", function () {
        // Clear it from the field the moment it is saved — no reason to leave a password
        // sitting on screen in a shared office, or in the browser's form history.
        input.value = "";
        ballStatus(
          "ballPasswordStatus",
          "Password changed. Anyone using the old one will be asked again."
        );
      });
    });

    el("ballHoldForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var name = el("ballHoldName").value.trim();
      if (!name) { ballStatus("ballHoldStatus", "Say who the seats are for."); return; }
      var local = el("ballHoldExpires").value;
      ballStatus("ballHoldStatus", "Holding…");
      authFetch("/api/admin/ball/holds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name,
          kind: el("ballHoldKind").value,
          quantity: Number(el("ballHoldQuantity").value),
          note: el("ballHoldNote").value,
          expiresAt: local ? fromLocalInput(local) : null,
        }),
      })
        .then(okJson)
        .then(function () {
          ballStatus("ballHoldStatus", "Held.");
          el("ballHoldName").value = "";
          el("ballHoldNote").value = "";
          el("ballHoldExpires").value = "";
          loadBall();
        })
        .catch(function () {
          ballStatus("ballHoldStatus", "Could not hold those seats — there may not be enough left.");
        });
    });

    el("ballFeeForm").addEventListener("submit", function (e) {
      e.preventDefault();
      // Percent in the box, basis points on the wire: 1.2 -> 120. Rounded because a browser
      // number input will happily hand back 1.2000000000000002.
      var bp = Math.round(Number(el("ballCardFeePercent").value) * 100);
      var fixed = Math.round(Number(el("ballCardFeeFixed").value));
      ballSave({ cardFeePercentBp: bp, cardFeeFixedPence: fixed }, "ballFeeStatus");
    });

    // Show the consequence, not just the setting: the number that actually appears on the
    // ticket page next to a tickbox asking someone to pay it.
    ["ballCardFeePercent", "ballCardFeeFixed"].forEach(function (id) {
      el(id).addEventListener("input", function () {
        ballFeeExample(
          Math.round(Number(el("ballCardFeePercent").value) * 100),
          Math.round(Number(el("ballCardFeeFixed").value)),
        );
      });
    });

    el("ballCapacityForm").addEventListener("submit", function (e) {
      e.preventDefault();
      ballSave({
        totalTables: Number(el("ballTotalTables").value),
        seatsPerTable: Number(el("ballSeatsPerTable").value),
        heldSeats: Number(el("ballHeldSeats").value),
        salesCloseAt: fromLocalInput(el("ballSalesCloseAt").value),
        salesClosed: el("ballSalesClosed").checked,
      }, "ballCapacityStatus");
    });

    // The API is bearer-authenticated, so a plain href would 401. Fetch with the token, then
    // hand the browser a blob to save.
    [["ballDoorList", "door-list"], ["ballCatering", "catering"], ["ballBookingsCsv", "bookings"]]
      .forEach(function (pair) {
        var node = el(pair[0]);
        if (!node) return;
        node.addEventListener("click", function (e) {
          e.preventDefault();
          authFetch("/api/admin/ball/" + pair[1] + ".csv")
            .then(function (r) { return r.ok ? r.blob() : Promise.reject(new Error("failed")); })
            .then(function (blob) {
              var url = URL.createObjectURL(blob);
              var a = document.createElement("a");
              a.href = url;
              a.download = "festive-ball-" + pair[1] + ".csv";
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              URL.revokeObjectURL(url);
            })
            .catch(function () { window.alert("Could not download that list. Try again."); });
        });
      });

    // TASK-418: "the menu is here". Same shape as the reminder below, same safety: the button
    // names what it is about to do, and the server refuses while there is no menu to send.
    var menuBtn = el("ballSendMenuEmail");
    if (menuBtn) {
      menuBtn.hidden = !canEdit("ball");
      menuBtn.addEventListener("click", function () {
        if (!window.confirm("Email everyone who has paid to say the menu is confirmed? This emails real people, and each booking only gets it once.")) return;
        menuBtn.disabled = true;
        ballStatus("ballMenuEmailStatus", "Sending…");
        authFetch("/api/admin/ball/menu-email", { method: "POST" })
          .then(j)
          .then(function (d) {
            menuBtn.disabled = false;
            // j() resolves on any status, so a refusal arrives HERE with an error body rather
            // than in the catch. The one that matters: the server will not send an email headed
            // "the menu is here" carrying no menu, because that would burn the single send each
            // booking gets.
            if (d && d.error) {
              ballStatus("ballMenuEmailStatus", d.error + ".");
              return;
            }
            var failed = (d.failed || []).length;
            ballStatus(
              "ballMenuEmailStatus",
              d.sent === 0
                ? "Nobody needed it: everyone who has paid has already been told."
                : "Sent to " + d.sent + (d.sent === 1 ? " booking." : " bookings.") +
                    (failed ? " " + failed + " could not be sent and will be retried next time." : "")
            );
            loadBall();
          })
          .catch(function () {
            menuBtn.disabled = false;
            ballStatus("ballMenuEmailStatus", "Could not send. Nothing was emailed; try again.");
          });
      });
    }

    var remindBtn = el("ballSendReminders");
    if (remindBtn) {
      remindBtn.hidden = !canEdit("ball");
      remindBtn.addEventListener("click", function () {
        // Naming the number is the whole safety mechanism: "are you sure?" tells an operator
        // nothing, whereas "email 137 people" is a fact they can check against what they expect.
        if (!window.confirm("Send the reminder to everyone who has paid and not had it yet? This emails real people.")) return;
        remindBtn.disabled = true;
        ballStatus("ballReminderStatus", "Sending…");
        authFetch("/api/admin/ball/reminders", { method: "POST" })
          .then(okJsonOrSaid)
          .then(function (d) {
            remindBtn.disabled = false;
            var failed = (d.failed || []).length;
            ballStatus(
              "ballReminderStatus",
              "Sent " + d.sent + (d.sent === 1 ? " reminder." : " reminders.") +
                (failed ? " " + failed + " could not be sent and will be retried next time." : "")
            );
            loadBall();
          })
          .catch(function (err) {
            remindBtn.disabled = false;
            // The server's own words when it refuses ("The Ball has been and gone, so the reminder
            // was not sent."); otherwise a plain failure.
            ballStatus("ballReminderStatus", (err && err.said) || "Could not send. Nobody has been emailed twice. Please try again.");
          });
      });
    }

    el("ballMenuForm").addEventListener("submit", function (e) {
      e.preventDefault();
      // Empty clears it, which turns the menu section back off for every guest at once - the
      // way back out if the venue changes its mind after this has gone live.
      // Both in one save: the key is meaningless without the menu it explains, and saving them
      // separately is how a menu goes live carrying codes nobody can decode.
      ballSave(
        {
          menuOptions: el("ballMenuOptions").value,
          menuNote: el("ballMenuNote").value,
        },
        "ballMenuStatus",
      );
    });

    el("ballLockForm").addEventListener("submit", function (e) {
      e.preventDefault();
      // Empty clears it, which is the way back out if a date is agreed and then moves.
      var raw = el("ballLockAt").value;
      ballSave(
        { guestDetailsLockAt: raw ? new Date(raw).toISOString() : null },
        "ballLockStatus",
      );
    });

    el("ballChase").addEventListener("click", function () {
      var btn = el("ballChase");
      var status = el("ballChaseStatus");
      btn.disabled = true;
      status.textContent = "Sending…";
      authFetch("/api/admin/ball/chase", { method: "POST" })
        .then(okJson)
        .then(function (r) {
          // Count what was SENT, not what was outstanding: the two differ whenever somebody has
          // already been chased at this stage, and reporting the larger number would claim we
          // emailed people we deliberately skipped.
          status.textContent =
            r.sent === 0
              ? "Nobody was due a reminder just now."
              : "Sent " + r.sent + (r.sent === 1 ? " email." : " emails.") +
                (r.failed ? " " + r.failed + " could not be sent." : "");
          btn.disabled = false;
          loadBall();
        })
        .catch(function () {
          status.textContent = "Could not send the reminders.";
          btn.disabled = false;
        });
    });

    el("ballDetailsForm").addEventListener("submit", function (e) {
      e.preventDefault();
      ballSave({
        arrivalTime: el("ballArrivalTime").value,
        includedNote: el("ballIncludedNote").value,
        lineUpNote: el("ballLineUpNote").value,
      }, "ballDetailsStatus");
    });
  }
  // ---- Events (TASK-453) ----
  // The public /events page: a switch for the whole page (admins only), the list of events, the
  // eight-step form, and two previews. The previews are not an imitation: they are what
  // POST /api/admin/events/preview renders with the real page's renderer and stylesheets, shown in
  // frames sized to what they hold, so nothing scrolls inside them.
  var evData = null; // the last GET /api/admin/events
  var evListView = "upcoming";
  var evCurrent = null; // the event in the form, in the API's shape
  var evCurrentId = null; // null while it is new and unsaved
  var evSavedStatus = null; // the status it was saved with, so the button can say "Save changes"
  var evDirty = false;
  var evFlipped = false;
  var evPreviewTimer = null;
  var evPreviewSeq = 0;
  var evWired = false;
  var EV_MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var EV_DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var EV_PAGE_WIDTH = 1300; // the real page's widest deck; the page preview is laid out at this, then zoomed

  function evCanWrite() {
    return canEdit("events");
  }
  function evToday() {
    if (evData && evData.today) return evData.today;
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function evAddDays(iso, days) {
    var p = iso.split("-").map(Number);
    var d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + days));
    return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0") + "-" + String(d.getUTCDate()).padStart(2, "0");
  }
  function evParts(iso) {
    var p = String(iso || "").split("-").map(Number);
    var d = new Date(Date.UTC(p[0], (p[1] || 1) - 1, p[2] || 1));
    return { dow: EV_DOW[d.getUTCDay()], day: d.getUTCDate(), mon: EV_MON[d.getUTCMonth()] };
  }
  function evShortDate(iso) {
    var p = evParts(iso);
    return p.day + " " + p.mon;
  }
  function evTime12(hhmm) {
    if (!hhmm) return "";
    var h = Number(hhmm.slice(0, 2)), m = Number(hhmm.slice(3, 5));
    if (h === 12 && m === 0) return "12 noon";
    return (h % 12 || 12) + (m ? "." + String(m).padStart(2, "0") : "") + (h >= 12 ? "pm" : "am");
  }
  function evTimeText(e) {
    if (!e.start) return e.timeTbc ? "time to come" : "";
    return e.end ? evTime12(e.start) + " to " + evTime12(e.end) : "from " + evTime12(e.start);
  }
  // The same rule as isOnPage in src/events/model.ts, for the words on this screen only. The server
  // decides what is really on the page.
  function evIsOnPage(e) {
    if (e.date < evToday()) return false;
    if (e.status === "live") return true;
    if (e.status === "scheduled") return !!e.showFrom && e.showFrom <= evToday();
    return false;
  }

  var EV_FIELDS = [
    "name", "subtitle", "gist", "date", "start", "end", "timeTbc", "venue", "town", "address", "access",
    "imageSrc", "imageFit", "imageGround", "imageAlt", "cover", "costFront", "costBack", "flag", "listHeading",
    "whatsOn", "note", "runBy", "partnerName", "partnerFront", "partnerCredit", "partnerLogoSrc", "partnerLine",
    "bookingHow", "bookingUrl", "bookingLabel", "bookingNote", "status", "showFrom",
  ];

  function evBlank() {
    return {
      name: "", subtitle: "", gist: "", date: evAddDays(evToday(), 30), start: "19:00", end: "", timeTbc: false,
      venue: "", town: "", address: "", access: [], imageSrc: "", imageFit: "cover", imageGround: "night",
      imageAlt: "", cover: "crimson", costFront: "", costBack: "", flag: "", listHeading: "What’s on",
      whatsOn: "", note: "", runBy: "nbcc", partnerName: "", partnerFront: "Organised by",
      partnerCredit: "Organised by", partnerLogoSrc: "", partnerLine: "", bookingHow: "site", bookingUrl: "",
      bookingLabel: "Book your place", bookingNote: "", status: "draft", showFrom: "",
    };
  }
  function evFromRecord(r) {
    var e = {};
    EV_FIELDS.forEach(function (f) {
      var v = r[f];
      e[f] = v === null || v === undefined ? (f === "access" ? [] : f === "timeTbc" ? false : "") : v;
    });
    e.access = (r.access || []).slice();
    return e;
  }

  // ---- loading ----
  function loadEvents() {
    evWire();
    authFetch("/api/admin/events")
      .then(function (res) {
        if (!res.ok) throw new Error("status " + res.status);
        return res.json();
      })
      .then(function (d) {
        evData = d;
        evRenderSwitch();
        evRenderList();
        el("evAdd").hidden = !evCanWrite();
        // Arriving on the screen opens the soonest event, so there is always a card to look at.
        if (!evCurrent) {
          var upcoming = evSorted(d.events).filter(function (e) { return e.date >= evToday(); });
          if (upcoming.length) evOpen(upcoming[0]);
          else if (d.events.length) evOpen(d.events[0]);
          else if (evCanWrite()) evOpenNew();
        } else {
          evRenderList();
        }
      })
      .catch(function (err) {
        if (err && err.message === "unauthorized") return;
        // An alert of its own: the list is not a live region (TASK-465), and this must be heard.
        el("evList").innerHTML = '<p class="ev-admin-empty" role="alert">The events could not be loaded just now. Try again in a moment.</p>';
        el("evSwitchState").textContent = "Could not check.";
      });
  }

  // Settings shows the page switch without the events under it, so it reads the switch alone: no
  // event is opened and no preview is drawn while Our events is off screen. The same request the
  // list makes, as that is where the server says whether the page is on.
  function evLoadSwitch() {
    evWire();
    authFetch("/api/admin/events")
      .then(function (res) {
        if (!res.ok) throw new Error("status " + res.status);
        return res.json();
      })
      .then(function (d) {
        if (evData) {
          evData.pageOn = d.pageOn;
          evData.updatedAt = d.updatedAt;
          evData.updatedBy = d.updatedBy;
        } else {
          evData = d;
        }
        evRenderSwitch();
      })
      .catch(function (err) {
        if (err && err.message === "unauthorized") return;
        el("evSwitchState").textContent = "Could not check.";
      });
  }

  function evSorted(list) {
    return (list || []).slice().sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      if ((a.start || "99") !== (b.start || "99")) return (a.start || "99") < (b.start || "99") ? -1 : 1;
      return String(a.name).localeCompare(String(b.name));
    });
  }

  // ---- the switch ----
  function evRenderSwitch() {
    var on = !!(evData && evData.pageOn);
    var box = el("evSwitch");
    box.classList.toggle("is-on", on);
    el("evSwitchState").innerHTML = on
      ? "<b>Yes.</b> The page is at nbcc.scot/get-involved, and every page’s menu offers it as Get involved. Visitors see every event marked “On the website”."
      : "<b>No.</b> The page is switched off: nobody can see it and no menu mentions it. Build and check events here, then switch it on when you are ready.";
    el("evSwitchWho").textContent = evData && evData.updatedBy && evData.updatedBy.indexOf("admin:") === 0
      ? "Last " + (on ? "switched on" : "switched off") + " by " + evData.updatedBy.slice(6) + " on " + H.fmtDate(evData.updatedAt) + "."
      : "";
    var btn = el("evSwitchBtn");
    var mayFlip = isAdmin() && evCanWrite();
    btn.hidden = !mayFlip;
    el("evSwitchNote").hidden = mayFlip;
    btn.textContent = on ? "Take the page off the website" : "Put the page on the website";
    btn.className = on ? "btn btn-ghost" : "btn btn-primary";
    evUpdateWhere();
  }

  function evFlipSwitch() {
    var on = !!(evData && evData.pageOn);
    var question = on
      ? "Take the Get involved page off the website? It will disappear from the site and from every page’s menu straight away."
      : "Put the Get involved page on the website? Everyone will be able to see it, and every page’s menu will offer it, straight away.";
    if (!window.confirm(question)) return;
    var btn = el("evSwitchBtn");
    var status = el("evSwitchStatus");
    btn.disabled = true;
    status.className = "ty-status";
    status.textContent = on ? "Taking the page off…" : "Putting the page on…";
    authFetch("/api/admin/events/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pageOn: !on }),
    })
      .then(function (res) {
        return res.json().then(function (b) { return { ok: res.ok, body: b }; });
      })
      .then(function (r) {
        btn.disabled = false;
        if (!r.ok) {
          status.className = "ty-status is-error";
          status.textContent = r.body.error || "That did not work. Please try again.";
          return;
        }
        evData.pageOn = r.body.pageOn;
        evData.updatedAt = r.body.updatedAt;
        evData.updatedBy = r.body.updatedBy;
        status.className = "ty-status is-ok";
        status.textContent = r.body.pageOn ? "The Get involved page is now on the website." : "The Get involved page is now off the website.";
        evRenderSwitch();
        evSchedulePreview(0);
      })
      .catch(function () {
        btn.disabled = false;
        status.className = "ty-status is-error";
        status.textContent = "That did not work. Please try again.";
      });
  }

  // ---- the list ----
  function evRenderList() {
    var events = (evData && evData.events) || [];
    var today = evToday();
    var counts = { upcoming: 0, drafts: 0, past: 0 };
    events.forEach(function (e) {
      if (e.date < today) counts.past += 1;
      else if (e.status === "draft") counts.drafts += 1;
      else counts.upcoming += 1;
    });
    Object.keys(counts).forEach(function (k) {
      var c = doc.querySelector('[data-evcount="' + k + '"]');
      if (c) c.textContent = counts[k];
    });
    var rows = evSorted(events).filter(function (e) {
      if (evListView === "past") return e.date < today;
      if (evListView === "drafts") return e.date >= today && e.status === "draft";
      return e.date >= today && e.status !== "draft";
    });
    if (evListView === "past") rows.reverse(); // most recent first when looking back
    var wrap = el("evList");
    if (!rows.length) {
      var empty = {
        upcoming: "Nothing is coming up yet. Add an event and put it on the website, and it appears here.",
        drafts: "No drafts. An event saved as a draft waits here, off the website, until you put it up.",
        past: "Nothing yet. Events move here by themselves the morning after they happen, and stay for your records.",
      }[evListView];
      wrap.innerHTML = '<p class="ev-admin-empty">' + empty + "</p>";
      return;
    }
    wrap.innerHTML =
      '<table class="admin-table ev-admin-table"><thead><tr><th>Date</th><th>Event</th><th>Run by</th><th>Website</th><th><span class="sr-only">Open</span></th></tr></thead><tbody>' +
      rows.map(function (e) {
        var p = evParts(e.date);
        var pill;
        if (e.date < today) pill = '<span class="admin-pill admin-pill--cancelled">Past</span>';
        else if (e.status === "draft") pill = '<span class="admin-pill">Draft</span>';
        // TASK-465: the editor's own words ("On the website", "Goes up by itself"). In the compact
        // rows the Website heading is out of sight, and "From 14 Oct" read like the event's own date.
        else if (e.status === "scheduled" && !evIsOnPage(e)) pill = '<span class="admin-pill admin-pill--pending">Goes up ' + H.escapeHtml(evShortDate(e.showFrom)) + "</span>";
        else pill = '<span class="admin-pill admin-pill--active">On the website</span>';
        var editing = e.id === evCurrentId;
        var action = editing ? "Open" : evCanWrite() ? "Edit" : "View";
        return (
          '<tr class="' + (editing ? "is-editing" : "") + '"><td><div class="ev-admin-when"><span class="ev-mini-index"><b>' + p.day +
          "</b><span>" + p.mon + "</span></span><span>" + p.dow + '<span class="ev-admin-sub">' +
          H.escapeHtml(evTimeText(e) || "no time yet") + "</span></span></div></td>" +
          '<td><span class="ev-admin-name">' + H.escapeHtml(e.name) + '</span><span class="ev-admin-sub">' +
          H.escapeHtml([e.venue, e.town].filter(Boolean).join(", ")) + "</span></td>" +
          "<td>" + H.escapeHtml(e.runBy === "partner" ? e.partnerName || "A partner" : "NBCC") + "</td>" +
          "<td>" + pill + "</td>" +
          // Named after its event, visible word first ("Edit EmpowHer ’26"), so a screen reader going
          // down the list does not hear the same word five times; the open one is the current one.
          '<td><button class="ev-admin-edit" type="button" data-evopen="' + e.id + '" aria-label="' +
          // TASK-468: with its date, so a recurring event does not sound like its twin.
          H.escapeHtml(action + " " + e.name + ", " + evShortDate(e.date)) + '"' + (editing ? ' aria-current="true"' : "") + ">" + action +
          "</button></td></tr>"
        );
      }).join("") +
      "</tbody></table>";
  }

  // ---- the form ----
  function evConfirmLeave() {
    return !evDirty || window.confirm("You have changes to this event that are not saved. Leave them?");
  }
  function evOpen(record) {
    evCurrent = evFromRecord(record);
    evCurrentId = record.id;
    evSavedStatus = record.status;
    evShowEditor();
  }
  function evOpenNew() {
    evCurrent = evBlank();
    evCurrentId = null;
    evSavedStatus = null;
    evShowEditor();
    // No focus here (TASK-468): arriving on an empty list opens a blank event by itself, and arriving
    // never moves focus. The "Add an event" button puts you in the name field when you ask.
  }
  // TASK-465: opening an event redraws the list, which takes away the button just pressed, and
  // keyboard focus would fall back to the page. It goes to the editor's heading instead, which is
  // where the page is scrolling anyway. Only ever after a person presses a row's button: arriving on
  // the screen opens the soonest event by itself, and must not pull focus away from wherever it is.
  // No "smooth" of its own: the page already scrolls smoothly (styles.css), and the site turns that
  // off for anyone whose device asks for reduced motion, which a forced "smooth" would override.
  function evFocusEditor() {
    var title = el("evEditorTitle");
    if (title && title.focus) title.focus({ preventScroll: true });
    el("evEditor").scrollIntoView({ block: "start" });
  }
  function evShowEditor() {
    evDirty = false;
    evFlipped = false;
    el("evEditor").hidden = false;
    el("evPagePreviewBox").hidden = false;
    evFillForm();
    evClearErrors();
    evSetSaveState("", "");
    evRenderList();
    evSchedulePreview(0);
  }

  function evFillForm() {
    var form = el("evForm");
    var write = evCanWrite();
    Array.prototype.forEach.call(form.querySelectorAll("[data-evk]"), function (input) {
      var k = input.getAttribute("data-evk");
      var v = evCurrent[k];
      if (input.type === "radio") input.checked = String(v) === input.value;
      else if (input.type === "checkbox" && k === "access") input.checked = evCurrent.access.indexOf(input.value) !== -1;
      else if (input.type === "checkbox") input.checked = !!v;
      else input.value = v === null || v === undefined ? "" : v;
      input.disabled = !write;
    });
    Array.prototype.forEach.call(form.querySelectorAll("[data-evwrite]"), function (c) { c.hidden = !write; });
    el("evSave").hidden = !write;
    el("evDelete").hidden = !write || evCurrentId === null;
    el("evEditorTitle").textContent = evCurrentId === null ? "A new event" : (write ? "Editing: " : "") + (evCurrent.name || "Untitled event");
    el("evEditorHint").textContent = write ? "The card changes as you type." : "You can look, but only someone with edit access to Events can change it.";
    evSyncConditional();
    evSyncCounts();
    evSyncPictures();
    evSyncSaveLabel();
  }

  function evReadField(input) {
    var k = input.getAttribute("data-evk");
    if (input.type === "radio") {
      if (input.checked) evCurrent[k] = input.value;
    } else if (input.type === "checkbox" && k === "access") {
      var order = ["step free entry", "accessible toilets", "a hearing loop", "blue badge parking"];
      var list = evCurrent.access.filter(function (a) { return a !== input.value; });
      if (input.checked) list.push(input.value);
      evCurrent.access = order.filter(function (a) { return list.indexOf(a) !== -1; });
    } else if (input.type === "checkbox") {
      evCurrent[k] = input.checked;
    } else {
      evCurrent[k] = input.value;
    }
  }

  function evSyncConditional() {
    var hasImage = !!evCurrent.imageSrc;
    el("evImageOptions").hidden = !hasImage;
    el("evCoverOptions").hidden = hasImage;
    el("evGround").hidden = !(hasImage && evCurrent.imageFit === "whole");
    el("evPartner").hidden = evCurrent.runBy !== "partner";
    var how = evCurrent.bookingHow;
    el("evBookUrl").hidden = how === "none";
    el("evBookNote").hidden = how !== "away";
    el("evBookUrlLabel").textContent = how === "away" ? "Their booking page" : "Which page on nbcc.scot";
    el("evBookUrlHint").textContent = how === "away" ? "Paste the full web address, starting https://" : "For example /ball";
    el("evShowFrom").hidden = evCurrent.status !== "scheduled";
  }

  function evSyncCounts() {
    Array.prototype.forEach.call(doc.querySelectorAll("[data-evcountfor]"), function (out) {
      var input = el(out.getAttribute("data-evcountfor"));
      var max = Number(input.getAttribute("data-evmax"));
      var n = input.value.length;
      out.textContent = n + " of " + max;
      out.classList.toggle("is-over", n > max);
    });
  }

  function evSyncPictures() {
    var thumb = el("evThumb");
    var src = evCurrent.imageSrc;
    thumb.style.backgroundImage = src ? "url(" + JSON.stringify(src) + ")" : "none";
    thumb.classList.toggle("is-whole", !!src && evCurrent.imageFit === "whole");
    el("evThumbName").textContent = src ? "A picture is chosen." : "No picture yet. The card makes its own cover from the name.";
    el("evRemovePic").hidden = !src || !evCanWrite();
    el("evLogoState").textContent = evCurrent.partnerLogoSrc ? "A logo is chosen." : "No logo: their name is shown in words.";
    el("evRemoveLogo").hidden = !evCurrent.partnerLogoSrc || !evCanWrite();
  }

  function evSyncSaveLabel() {
    var s = evCurrent.status;
    var label;
    if (s === "draft") label = "Save as a draft";
    else if (s === "scheduled") label = evCurrent.showFrom ? "Save, to go up on " + evShortDate(evCurrent.showFrom) : "Save";
    else label = evSavedStatus === "live" ? "Save the changes" : "Save and put it on the website";
    el("evSaveBtn").textContent = label;
  }

  function evSetSaveState(text, kind) {
    var s = el("evSaveState");
    s.textContent = text;
    s.className = "spacer" + (kind ? " is-" + kind : "");
  }

  function evClearErrors() {
    Array.prototype.forEach.call(el("evForm").querySelectorAll(".ev-f-error"), function (p) { p.remove(); });
    Array.prototype.forEach.call(el("evForm").querySelectorAll(".ev-f.has-error"), function (f) { f.classList.remove("has-error"); });
    el("evProblems").hidden = true;
    el("evProblems").innerHTML = "";
  }

  // After a save: every marked answer, the list of what is missing, and the cursor on the first one.
  // From the live preview (focus false): the marks only, so the cursor never jumps out of the box
  // somebody is typing in.
  function evShowErrors(fields, problems, focus) {
    evClearErrors();
    var first = null;
    Object.keys(fields || {}).forEach(function (key) {
      var input = el("evForm").querySelector('[data-evk="' + key.split(".")[0] + '"]');
      var box = input && input.closest(".ev-f");
      if (!box) return;
      box.classList.add("has-error");
      var p = doc.createElement("p");
      p.className = "ev-f-error";
      p.textContent = fields[key];
      box.appendChild(p);
      if (!first) first = input;
    });
    if (problems && problems.length) {
      el("evProblems").innerHTML =
        "<p>Before this can go on the website:</p><ul>" +
        problems.map(function (m) { return "<li>" + H.escapeHtml(m) + "</li>"; }).join("") + "</ul>";
      el("evProblems").hidden = false;
    }
    if (focus !== false && first && first.focus) first.focus();
  }

  // ---- saving ----
  function evSave() {
    if (!evCanWrite()) return;
    var btn = el("evSaveBtn");
    btn.disabled = true;
    evSetSaveState("Saving…", "");
    var isNew = evCurrentId === null;
    authFetch(isNew ? "/api/admin/events" : "/api/admin/events/" + evCurrentId, {
      method: isNew ? "POST" : "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(evCurrent),
    })
      .then(function (res) {
        return res.json().then(function (b) { return { status: res.status, body: b }; });
      })
      .then(function (r) {
        btn.disabled = false;
        if (r.status === 400) {
          evShowErrors(r.body.fields, r.body.problems);
          evSetSaveState(r.body.problems ? "Not saved: a few things are missing." : "Not saved: have a look at the marked answers.", "error");
          return;
        }
        if (r.status === 404) {
          evSetSaveState("Not saved: someone has deleted this event.", "error");
          return;
        }
        if (r.status >= 300) {
          evSetSaveState(r.body.error || "Not saved. Please try again.", "error");
          return;
        }
        var saved = r.body.event;
        evCurrent = evFromRecord(saved);
        evCurrentId = saved.id;
        evSavedStatus = saved.status;
        evDirty = false;
        evClearErrors();
        evFillForm();
        var where = saved.status === "draft"
          ? "Saved as a draft."
          : evIsOnPage(saved)
            ? (evData && evData.pageOn ? "Saved, and on the website." : "Saved. It will show once the Get involved page is switched on.")
            : saved.status === "scheduled" ? "Saved. It goes up on " + evShortDate(saved.showFrom) + "." : "Saved.";
        evSetSaveState(where, "ok");
        var i = evData.events.findIndex(function (e) { return e.id === saved.id; });
        if (i === -1) evData.events.push(saved);
        else evData.events[i] = saved;
        evRenderList();
        evSchedulePreview(0);
      })
      .catch(function (err) {
        btn.disabled = false;
        if (err && err.message === "unauthorized") return;
        evSetSaveState("Not saved: the connection dropped. Please try again.", "error");
      });
  }

  function evDelete() {
    if (!evCanWrite() || evCurrentId === null) return;
    if (!window.confirm('Delete "' + (evCurrent.name || "this event") + '" for good? It comes off the website straight away. The Audit log keeps a record that it existed.')) return;
    var id = evCurrentId;
    authFetch("/api/admin/events/" + id, { method: "DELETE" })
      .then(function (res) {
        if (!res.ok && res.status !== 404) throw new Error("status " + res.status);
        evData.events = evData.events.filter(function (e) { return e.id !== id; });
        evCurrent = null;
        evCurrentId = null;
        evDirty = false;
        el("evEditor").hidden = true;
        el("evPagePreviewBox").hidden = true;
        evRenderList();
        // TASK-468: the editor, and the Delete button that had focus, are gone. Anyone who may delete
        // may add, so "Add an event" is there, just above the list: the likeliest next step. Focus
        // moves before "Deleted." is written, because some screen readers (VoiceOver) drop a polite
        // message that arrives in the same moment as a focus move.
        var add = el("evAdd");
        if (add && !add.hidden && add.focus) add.focus();
        el("evSwitchStatus").className = "ty-status is-ok";
        el("evSwitchStatus").textContent = "Deleted.";
      })
      .catch(function (err) {
        if (err && err.message === "unauthorized") return;
        evSetSaveState("Not deleted. Please try again.", "error");
      });
  }

  // ---- pictures ----
  // TASK-495: url is where the picture goes; Admin > Fundraising sends its photos to its own upload,
  // gated on fundraising rather than events. Events pictures go where they always have.
  // failed (optional, TASK-495) hears every way it can end without a picture, with what was said.
  function evUpload(file, statusEl, done, url, failed) {
    if (!file) return;
    if (!/^image\//.test(file.type)) {
      statusEl.className = "ty-status is-error";
      statusEl.textContent = "That file is not a picture. Try a JPG or PNG.";
      if (failed) failed(statusEl.textContent);
      return;
    }
    statusEl.className = "ty-status";
    statusEl.textContent = "Uploading…";
    function send(mime, base64) {
      authFetch(url || "/api/admin/event-images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mime: mime, dataBase64: base64, filename: file.name }),
      })
        .then(function (res) {
          return res.json().catch(function () { return {}; }).then(function (b) { return { status: res.status, body: b }; });
        })
        .then(function (r) {
          if (r.status !== 201) {
            statusEl.className = "ty-status is-error";
            statusEl.textContent = r.body.error || nlUploadHttpMessage(r.status);
            if (failed) failed(statusEl.textContent);
            return;
          }
          statusEl.className = "ty-status is-ok";
          statusEl.textContent = "Uploaded.";
          done(r.body.src);
        })
        .catch(function (err) {
          if (err && err.message === "unauthorized") {
            if (failed) failed("");
            return;
          }
          statusEl.className = "ty-status is-error";
          statusEl.textContent = "Upload failed. Please try again.";
          if (failed) failed(statusEl.textContent);
        });
    }
    // Shrunk in the browser first, exactly as a newsletter picture is (TASK-300): phone photos are
    // bigger than the upload allows.
    nlShrinkImage(file, function (shrunk) {
      if (shrunk) return send(shrunk.mime, shrunk.base64);
      var reader = new window.FileReader();
      reader.onload = function () {
        var url = String(reader.result);
        send(file.type, url.slice(url.indexOf(",") + 1));
      };
      // A file the browser cannot read must not leave the screen waiting for an upload forever.
      reader.onerror = function () {
        statusEl.className = "ty-status is-error";
        statusEl.textContent = "That picture could not be read. Please try another.";
        if (failed) failed(statusEl.textContent);
      };
      reader.readAsDataURL(file);
    });
  }

  // ---- the previews ----
  function evSchedulePreview(delay) {
    if (evPreviewTimer) clearTimeout(evPreviewTimer);
    evPreviewTimer = setTimeout(evRefreshPreview, delay === undefined ? 350 : delay);
  }

  function evRefreshPreview() {
    if (!evCurrent) return;
    var seq = ++evPreviewSeq;
    authFetch("/api/admin/events/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: evCurrent, id: evCurrentId }),
    })
      .then(function (res) {
        return res.json().then(function (b) { return { ok: res.ok, body: b }; });
      })
      .then(function (r) {
        if (seq !== evPreviewSeq) return; // an older answer arriving late must not overwrite a newer one
        if (!r.ok) {
          // The preview keeps showing the last good card; the marked answer says what to change.
          if (r.body.fields) evShowErrors(r.body.fields, null, false);
          return;
        }
        el("evCardPreview").srcdoc = r.body.card;
        el("evPagePreview").srcdoc = r.body.page;
        evUpdateWhere();
      })
      .catch(function () {});
  }

  function evFrameDoc(frame) {
    try {
      return frame.contentDocument;
    } catch (e) {
      return null;
    }
  }

  // Our events is off screen while another section of Get involved shows. A frame cannot be measured
  // then: fitting it would set it to nothing, and it would stay blank when the section came back.
  function evOffScreen() {
    var part = el("evEditor").closest("[data-gi-part]");
    return !!(part && part.hidden);
  }
  function evFitCard() {
    var frame = el("evCardPreview");
    var cdoc = evFrameDoc(frame);
    if (!cdoc || !cdoc.body || evOffScreen()) return;
    frame.style.height = "0px";
    frame.style.height = Math.max(cdoc.body.scrollHeight, cdoc.documentElement.scrollHeight) + "px";
  }

  // The real page is laid out at its own width and zoomed to fit the box, the way the newsletter
  // preview fits an email. Too narrow for a readable miniature (a phone), it shows the cards full
  // size in one column instead.
  function evFitPage() {
    var frame = el("evPagePreview");
    var box = el("evPageBox");
    var cdoc = evFrameDoc(frame);
    if (!cdoc || !cdoc.body || !box.clientWidth || evOffScreen()) return;
    var mini = box.clientWidth >= 640;
    frame.style.width = (mini ? EV_PAGE_WIDTH : box.clientWidth) + "px";
    frame.style.height = "0px";
    frame.style.height = Math.max(cdoc.body.scrollHeight, cdoc.documentElement.scrollHeight) + "px";
    frame.style.zoom = mini ? String(Math.min(1, box.clientWidth / EV_PAGE_WIDTH)) : "";
  }

  function evApplySide() {
    var frame = el("evCardPreview");
    var win = frame.contentWindow;
    var cdoc = evFrameDoc(frame);
    var card = cdoc && cdoc.querySelector(".ev-card");
    if (card && win && win.nbccEvents) win.nbccEvents.setFace(card, evFlipped, false);
    Array.prototype.forEach.call(doc.querySelectorAll("[data-evside]"), function (b) {
      var on = (b.getAttribute("data-evside") === "back") === evFlipped;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-pressed", String(on));
    });
  }

  function evUpdateWhere() {
    var where = el("evWhere");
    var note = el("evPagePrevNote");
    if (!evCurrent || !where) return;
    var pageOff = !(evData && evData.pageOn);
    var tail = pageOff ? " The Get involved page itself is switched off, so only staff can see this for now." : "";
    note.textContent = "Every event on the page in date order, with this one where its date puts it and the face down card last." + tail;
    var today = evToday();
    if (evCurrent.date && evCurrent.date < today) {
      where.textContent = "This date has passed, so the card is not on the page. It is kept under Past.";
      return;
    }
    if (evCurrent.status === "draft") {
      where.textContent = "Kept as a draft, so this card is not on the website. Choose “On the website” in step 8 to put it up.";
      return;
    }
    if (evCurrent.status === "scheduled" && evCurrent.showFrom > today) {
      where.textContent = "It goes up on " + evShortDate(evCurrent.showFrom) + ". Until then it is not on the page." + tail;
      return;
    }
    var others = ((evData && evData.events) || []).filter(function (e) { return e.id !== evCurrentId && evIsOnPage(e); });
    var list = evSorted(others.concat([Object.assign({ id: -1 }, evCurrent)]));
    var pos = -1;
    list.forEach(function (e, i) { if (e.id === -1) pos = i; });
    var before = list[pos - 1];
    var after = list[pos + 1];
    where.textContent =
      "Card " + (pos + 1) + " of " + list.length + " on the page" +
      (before ? ", after " + before.name + " (" + evShortDate(before.date) + ")" : ", first in the deck") +
      (after ? ", and before " + after.name + " (" + evShortDate(after.date) + ")." : ". The face down “more on the way” card follows it.") +
      tail;
  }

  // ---- wiring (once) ----
  function evWire() {
    if (evWired) return;
    evWired = true;
    var form = el("evForm");

    function onEdit(e) {
      var t = e.target;
      if (!t.hasAttribute || !t.hasAttribute("data-evk") || !evCurrent || !evCanWrite()) return;
      evReadField(t);
      evDirty = true;
      var box = t.closest(".ev-f");
      if (box && box.classList.contains("has-error")) {
        box.classList.remove("has-error");
        var err = box.querySelector(".ev-f-error");
        if (err) err.remove();
      }
      evSyncConditional();
      evSyncCounts();
      evSyncSaveLabel();
      if (t.getAttribute("data-evk") === "imageFit") evSyncPictures();
      if (t.getAttribute("data-evk") === "name") el("evEditorTitle").textContent = (evCurrentId === null ? "A new event: " : "Editing: ") + (evCurrent.name || "untitled");
      evSetSaveState("Not saved yet.", "");
      evUpdateWhere();
      evSchedulePreview();
    }
    form.addEventListener("input", onEdit);
    form.addEventListener("change", onEdit);
    form.addEventListener("submit", function (e) { e.preventDefault(); });

    el("evSaveBtn").addEventListener("click", evSave);
    el("evDelete").addEventListener("click", evDelete);
    el("evSwitchBtn").addEventListener("click", evFlipSwitch);
    el("evAdd").addEventListener("click", function () {
      if (!evConfirmLeave()) return;
      evOpenNew();
      var name = el("evf-name");
      if (name && name.focus) name.focus({ preventScroll: true });
      el("evEditor").scrollIntoView({ block: "start" }); // smooth, or not, as the page's own setting says
    });
    el("evList").addEventListener("click", function (e) {
      var b = e.target.closest("[data-evopen]");
      if (!b) return;
      var id = Number(b.getAttribute("data-evopen"));
      var record = (evData.events || []).filter(function (x) { return x.id === id; })[0];
      if (!record || (id === evCurrentId)) {
        evFocusEditor();
        return;
      }
      if (!evConfirmLeave()) return;
      evOpen(record);
      evFocusEditor();
    });
    Array.prototype.forEach.call(doc.querySelectorAll("[data-evlist]"), function (b) {
      b.addEventListener("click", function () {
        evListView = b.getAttribute("data-evlist");
        Array.prototype.forEach.call(doc.querySelectorAll("[data-evlist]"), function (x) {
          x.classList.toggle("is-active", x === b);
          x.setAttribute("aria-pressed", String(x === b));
        });
        evRenderList();
      });
    });
    Array.prototype.forEach.call(doc.querySelectorAll("[data-evside]"), function (b) {
      b.addEventListener("click", function () {
        evFlipped = b.getAttribute("data-evside") === "back";
        evApplySide();
      });
    });

    el("evPicture").addEventListener("change", function (e) {
      var file = e.target.files && e.target.files[0];
      e.target.value = "";
      evUpload(file, el("evPictureStatus"), function (src) {
        evCurrent.imageSrc = src;
        evDirty = true;
        evSyncConditional();
        evSyncPictures();
        evSetSaveState("Not saved yet.", "");
        evSchedulePreview(0);
      });
    });
    el("evRemovePic").addEventListener("click", function () {
      evCurrent.imageSrc = "";
      evDirty = true;
      evSyncConditional();
      evSyncPictures();
      evSetSaveState("Not saved yet.", "");
      evSchedulePreview(0);
    });
    el("evLogo").addEventListener("change", function (e) {
      var file = e.target.files && e.target.files[0];
      e.target.value = "";
      evUpload(file, el("evPictureStatus"), function (src) {
        evCurrent.partnerLogoSrc = src;
        evDirty = true;
        evSyncPictures();
        evSetSaveState("Not saved yet.", "");
        evSchedulePreview(0);
      });
    });
    el("evRemoveLogo").addEventListener("click", function () {
      evCurrent.partnerLogoSrc = "";
      evDirty = true;
      evSyncPictures();
      evSetSaveState("Not saved yet.", "");
      evSchedulePreview(0);
    });

    // Each preview document loads its own stylesheets and fonts, so it is measured when it has
    // loaded and again once its fonts are in: a heading that re-wraps in the brand font changes height.
    el("evCardPreview").addEventListener("load", function () {
      var frame = el("evCardPreview");
      var cdoc = evFrameDoc(frame);
      evFitCard();
      evApplySide();
      if (cdoc && cdoc.fonts && cdoc.fonts.ready) cdoc.fonts.ready.then(evFitCard);
      // Clicking the card inside the frame turns it, so keep the Front/Back buttons telling the truth.
      if (cdoc) {
        cdoc.addEventListener("click", function () {
          setTimeout(function () {
            var card = cdoc.querySelector(".ev-card");
            if (!card) return;
            evFlipped = card.classList.contains("is-flipped");
            Array.prototype.forEach.call(doc.querySelectorAll("[data-evside]"), function (b) {
              var on = (b.getAttribute("data-evside") === "back") === evFlipped;
              b.classList.toggle("is-active", on);
              b.setAttribute("aria-pressed", String(on));
            });
          }, 0);
        });
      }
    });
    el("evPagePreview").addEventListener("load", function () {
      var cdoc = evFrameDoc(el("evPagePreview"));
      evFitPage();
      if (cdoc && cdoc.fonts && cdoc.fonts.ready) cdoc.fonts.ready.then(evFitPage);
    });
    window.addEventListener("resize", function () {
      evFitPage();
      evFitCard();
    });
  }

  // ---- the Festive Ball ticket report (TASK-464) ----
  // A card under the page switch. Counts only, on Monday and Thursday mornings, to the people running
  // the Ball with us. The list is edited here and saved together with the switch; "Send a test to me"
  // sends the real email, marked as a test, to the signed-in person only. The preview frame is sized
  // to the email, and sized again when the window changes, so nothing scrolls inside the page.
  var BR_MAX = 10;
  // The same rule the server checks addresses by (zod's), so a slip is caught when it is added.
  var BR_EMAIL = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$/i;
  var brData = null;
  var brDraft = [];
  var brDirty = false;
  var brWired = false;

  function brSay(msg) {
    var s = el("evReportStatus");
    if (s) s.textContent = msg || "";
  }
  function brDayWords(day) {
    return new Date(day + "T12:00:00Z").toLocaleDateString("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      timeZone: "UTC",
    });
  }
  function brPeople(n) {
    return n === 1 ? "1 person" : n + " people";
  }
  function brSorted(list) {
    return list.slice().sort(function (a, b) {
      return a.name.localeCompare(b.name, "en-GB", { sensitivity: "base" }) || a.email.localeCompare(b.email);
    });
  }
  function brRenderState() {
    var n = brData.recipients.length;
    var html;
    if (brData.reportOn) {
      html =
        "<b>On.</b> It goes to " + brPeople(n) + " on Mondays and Thursdays at 8am. " +
        (brData.nextSend
          ? "The next one is on " + H.escapeHtml(brDayWords(brData.nextSend)) + "."
          : "There are no more before the Ball.");
    } else {
      html = "<b>Off.</b> " + (n ? "It is ready to go to " + brPeople(n) + " once it is switched on." : "Nobody gets it yet.");
    }
    // TASK-471: a report that did not go says so here, until the next one goes.
    if (brData.lastFailure) {
      html +=
        '<span class="ev-report-failed">' +
        H.escapeHtml(brDayWords(brData.lastFailure.sentOn)) +
        "’s report could not be sent, so nobody got it that day." +
        (brData.reportOn && brData.nextSend ? " The next one will try again as usual." : "") +
        "</span>";
    }
    el("evReportState").innerHTML = html;
    el("evReport").classList.toggle("is-on", !!brData.reportOn);
  }
  function brRenderList() {
    var canWrite = canEdit("events");
    var ul = el("evReportList");
    if (!brDraft.length) {
      ul.innerHTML = '<li class="ev-report-empty">Nobody on the list yet.</li>';
      return;
    }
    ul.innerHTML = brDraft
      .map(function (r, i) {
        return (
          '<li><span class="ev-report-who"><b>' + H.escapeHtml(r.name) + "</b> <span>" + H.escapeHtml(r.email) + "</span></span>" +
          (canWrite
            ? '<button class="ev-link-btn" type="button" data-brremove="' + i + '" aria-label="Remove ' + H.escapeHtml(r.name) + '">Remove</button>'
            : "") +
          "</li>"
        );
      })
      .join("");
  }
  function brRenderLast() {
    var parts = [];
    if (brData.lastScheduled) {
      parts.push("Last sent on " + brDayWords(brData.lastScheduled.sentOn) + " to " + brPeople(brData.lastScheduled.recipients.length) + ".");
    }
    if (brData.lastTest) {
      parts.push("Last test on " + brDayWords(brData.lastTest.sentOn) + ", to " + brData.lastTest.recipients.join(", ") + ".");
    }
    el("evReportLast").textContent = parts.join(" ");
  }
  // Shrinks the frame to nothing first, so it can get smaller as well as bigger, then fits the email.
  function brFitPreview() {
    var frame = el("evReportPreview");
    if (!frame || el("evReportBody").hidden) return;
    try {
      var cdoc = frame.contentDocument;
      if (!cdoc || !cdoc.body) return;
      frame.style.height = "0px";
      // The frame's own border counts inside its height, so it is added on, or the foot is cut off.
      var edges = frame.offsetHeight - frame.clientHeight;
      frame.style.height = Math.max(cdoc.body.scrollHeight, cdoc.documentElement.scrollHeight) + edges + "px";
    } catch (e) {
      /* a preview that cannot be measured keeps its minimum height */
    }
  }
  function brRenderPreview() {
    var frame = el("evReportPreview");
    if (!brData.preview) return;
    frame.onload = function () {
      brFitPreview();
      var cdoc = frame.contentDocument;
      if (cdoc && cdoc.fonts && cdoc.fonts.ready) cdoc.fonts.ready.then(brFitPreview);
    };
    frame.srcdoc = brData.preview.html;
  }
  function brRender() {
    var canWrite = canEdit("events");
    el("evReport").hidden = false;
    Array.prototype.forEach.call(doc.querySelectorAll("#evReport [data-reportwrite]"), function (n) {
      n.hidden = !canWrite;
    });
    if (!brDirty) el("evReportOn").checked = !!brData.reportOn;
    brRenderState();
    brRenderList();
    brRenderLast();
    brRenderPreview();
  }
  function brTake(d) {
    brData = d;
    // Coming back to Events reloads the card: changes nobody has saved yet are kept, not lost.
    if (!brDirty) brDraft = brSorted(d.recipients || []);
    brRender();
  }
  // Signing out forgets the card, so the next person to sign in never sees someone else's edits.
  function brReset() {
    brData = null;
    brDraft = [];
    brDirty = false;
  }
  function loadBallReport() {
    brWire();
    authFetch("/api/admin/ball-report")
      .then(function (res) {
        return res.ok ? res.json() : null;
      })
      .then(function (d) {
        if (!d) {
          el("evReport").hidden = true;
          return;
        }
        brTake(d);
      })
      .catch(function () {
        /* the rest of the Events page still works without it */
      });
  }
  function brMarkDirty() {
    brDirty = true;
    brSay("Press Save to keep these changes.");
  }
  function brAdd() {
    var name = el("evReportName").value.trim();
    var email = el("evReportEmail").value.trim().toLowerCase();
    if (!name) {
      brSay("Add their name.");
      el("evReportName").focus();
      return;
    }
    if (!BR_EMAIL.test(email)) {
      brSay("That isn't a whole email address.");
      el("evReportEmail").focus();
      return;
    }
    var already = brDraft.some(function (r) {
      return r.email === email;
    });
    if (already) {
      brSay("That address is already on the list.");
      el("evReportEmail").focus();
      return;
    }
    if (brDraft.length >= BR_MAX) {
      brSay("The report can go to up to " + BR_MAX + " people. Remove someone to add another.");
      return;
    }
    brDraft = brSorted(brDraft.concat([{ name: name, email: email }]));
    el("evReportName").value = "";
    el("evReportEmail").value = "";
    brRenderList();
    brMarkDirty();
    el("evReportName").focus();
  }
  function brJson(res, fallback) {
    return res
      .json()
      .catch(function () {
        return {};
      })
      .then(function (b) {
        if (!res.ok) {
          var err = new Error(b.error || fallback);
          err.path = b.path;
          throw err;
        }
        return b;
      });
  }
  function brFailed(err) {
    if (!err || err.message === "unauthorized") return;
    // A refused list says which entry: name the person, so the fix is obvious.
    var who = err.path && typeof err.path[0] === "number" ? brDraft[err.path[0]] : null;
    brSay(who ? who.name + " (" + who.email + "): " + err.message : err.message);
  }
  function brSave() {
    var b = el("evReportSave");
    b.disabled = true;
    brSay("Saving…");
    authFetch("/api/admin/ball-report", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reportOn: el("evReportOn").checked, recipients: brDraft }),
    })
      .then(function (res) {
        return brJson(res, "The report could not be saved. Please try again.");
      })
      .then(function (d) {
        brDirty = false;
        brTake(d);
        brSay("Saved.");
      })
      .catch(brFailed)
      .then(function () {
        b.disabled = false;
      });
  }
  function brTest() {
    var b = el("evReportTest");
    b.disabled = true;
    brSay("Sending a test to you…");
    authFetch("/api/admin/ball-report/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
      .then(function (res) {
        return brJson(res, "The test could not be sent. Please try again.");
      })
      .then(function (d) {
        brSay(
          "Sent to " + (d.sentTo || []).join(", ") + ". Have a look in your inbox." +
            (brDirty ? " Your changes to the list are not saved yet." : ""),
        );
        loadBallReport();
      })
      .catch(brFailed)
      .then(function () {
        b.disabled = false;
      });
  }
  function brWire() {
    if (brWired) return;
    brWired = true;
    el("evReportToggle").addEventListener("click", function () {
      var body = el("evReportBody");
      var open = body.hidden;
      body.hidden = !open;
      this.setAttribute("aria-expanded", open ? "true" : "false");
      this.textContent = open ? "Close" : "Open";
      if (open && brData) brRenderPreview();
    });
    el("evReportAdd").addEventListener("click", brAdd);
    ["evReportName", "evReportEmail"].forEach(function (id) {
      el(id).addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          e.preventDefault();
          brAdd();
        }
      });
    });
    el("evReportList").addEventListener("click", function (e) {
      var btn = e.target.closest ? e.target.closest("[data-brremove]") : null;
      if (!btn) return;
      brDraft.splice(Number(btn.getAttribute("data-brremove")), 1);
      brRenderList();
      brMarkDirty();
    });
    el("evReportOn").addEventListener("change", brMarkDirty);
    el("evReportSave").addEventListener("click", brSave);
    el("evReportTest").addEventListener("click", brTest);
    window.addEventListener("resize", brFitPreview);
  }
  // ---- Analytics (TASK-482) ----
  // Admin > Analytics: the collecting switch, then how many people visited, where they came from,
  // where they are, what they looked at and clicked, and what they used, for the last 7, 30 or 90
  // days next to the period before. Every panel comes from one GET /api/admin/analytics; the server
  // does the counting (src/analytics/report.ts), this only draws it.
  //
  // Nothing scrolls inside a box (the client's standing rule): a list longer than ten shows its top
  // ten and a "Show all" button that grows the page. A panel with nothing in it says "Not enough
  // visits yet", and one whose numbers failed to load says so rather than showing zeros (TASK-476).
  var AN_TOP = 10;
  // The server sends at most this many of a long list (LIST_LIMIT in src/db/analytics-report.ts).
  var AN_LIST_CAP = 100;
  var anDays = 30;
  var anSettings = null;
  var anReport = null;
  var anFailed = false;
  var anExpanded = {};
  var anWired = false;
  var anSeq = 0;

  var AN_CHANNELS = {
    newsletter: "Newsletter",
    email: "Email",
    qr: "QR code",
    search: "Search",
    social: "Social",
    other_websites: "Other websites",
    direct: "Direct: typed in, a bookmark or an app",
  };
  var AN_KINDS = {
    donate: "Donate buttons",
    tickets: "Ticket buttons",
    phone: "Phone links",
    email: "Email links",
    download: "Downloads",
    outbound: "Links to other websites",
  };
  var AN_KIND_ONE = {
    donate: "donate button",
    tickets: "ticket button",
    phone: "phone link",
    email: "email link",
    download: "download",
    outbound: "link to another website",
  };
  var AN_DEVICES = { phone: "Phone", tablet: "Tablet", computer: "Computer" };
  var AN_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var AN_EMPTY = '<p class="admin-empty an-empty">Not enough visits yet.</p>';
  var AN_FAILED = "This could not be loaded just now.";

  function anNum(n) {
    return Number(n || 0).toLocaleString("en-GB");
  }
  // "2026-09-30" as "30 September", or "30 Sep" when short. Read from the text, so no time zone moves it.
  function anDay(day, short) {
    var p = String(day || "").split("-");
    if (p.length !== 3) return String(day || "");
    var month = AN_MONTHS[Number(p[1]) - 1] || "";
    return Number(p[2]) + " " + (short ? month.slice(0, 3) : month);
  }
  function anDuration(seconds) {
    if (seconds === null || seconds === undefined) return "Not yet";
    var s = Math.round(seconds);
    if (s < 60) return s + " sec";
    var m = Math.floor(s / 60);
    return m + " min" + (s % 60 ? " " + (s % 60) + " sec" : "");
  }
  function anPage(path, title) {
    if (title) return title;
    if (path === "/") return "Home page";
    if (path === "other") return "Other pages";
    return path;
  }
  // "1 October 2026 at 08:30", UK time.
  function anWhen(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    var day = d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" });
    var time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
    return day + " at " + time;
  }
  function anSpan() {
    return "the " + ((anReport && anReport.days) || anDays) + " days before";
  }

  function anWire() {
    if (anWired) return;
    anWired = true;
    Array.prototype.forEach.call(doc.querySelectorAll("[data-andays]"), function (b) {
      b.addEventListener("click", function () {
        anSetDays(Number(b.getAttribute("data-andays")));
      });
    });
    el("anSwitchBtn").addEventListener("click", anFlipSwitch);
    el("view-analytics").addEventListener("click", function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      if (t.closest("[data-anrefresh]")) {
        anLoadNow();
        return;
      }
      var more = t.closest("[data-anmore]");
      if (!more) return;
      var id = more.getAttribute("data-anmore");
      anExpanded[id] = !anExpanded[id];
      anRenderPanels();
      var again = el(id).querySelector("[data-anmore]");
      if (again && again.focus) again.focus();
    });
  }

  function loadAnalytics() {
    anWire();
    anLoadSettings();
    anLoadReport();
  }

  // ---- the switch ----
  function anLoadSettings() {
    authFetch("/api/admin/analytics/settings")
      .then(okJson)
      .then(function (s) {
        anSettings = s;
        anRenderSwitch();
      })
      .catch(function (err) {
        if (err && err.message === "unauthorized") return;
        anSettings = null;
        el("anSwitch").classList.remove("is-on");
        el("anSwitchState").textContent = "Could not check whether visits are being counted.";
        el("anSwitchWho").textContent = "";
        el("anSwitchBtn").hidden = true;
        el("anSwitchNote").hidden = true;
      });
  }

  function anRenderSwitch() {
    var on = !!(anSettings && anSettings.collecting);
    el("anSwitch").classList.toggle("is-on", on);
    el("anSwitchState").innerHTML = on
      ? "<b>On.</b> Counting visits" + (anSettings.updatedAt ? " since " + H.escapeHtml(anWhen(anSettings.updatedAt)) : "") + "."
      : "<b>Off.</b> Nothing is being counted. Switching on starts counting each page view: which page, how the visitor " +
        "arrived (a newsletter, a search, another website), their town or city, whether they used a phone, tablet or " +
        "computer, how long they spent and how far down they read, and clicks on the buttons and links that matter. " +
        "There are no cookies, and nothing kept says who anyone is. " +
        '<a href="/privacy#counting-visits">What the privacy notice tells visitors</a>.';
    var by = anSettings && anSettings.updatedBy && anSettings.updatedBy.indexOf("admin:") === 0 ? anSettings.updatedBy.slice(6) : "";
    el("anSwitchWho").textContent = by
      ? (on ? "Switched on by " : "Switched off by ") + by + (on ? "" : " on " + H.fmtDate(anSettings.updatedAt)) + "."
      : "";
    var mayFlip = canEdit("analytics");
    var btn = el("anSwitchBtn");
    btn.hidden = !mayFlip;
    el("anSwitchNote").hidden = mayFlip;
    btn.textContent = on ? "Stop counting visits" : "Start counting visits";
    btn.className = on ? "btn btn-ghost" : "btn btn-primary";
  }

  function anFlipSwitch() {
    var on = !!(anSettings && anSettings.collecting);
    var question = on
      ? "Stop counting visits? Nothing more will be counted until someone starts it again. The numbers so far are kept."
      : "Start counting visits? From now on the website counts page views as described here, with no cookies.";
    if (!window.confirm(question)) return;
    var btn = el("anSwitchBtn");
    var status = el("anSwitchStatus");
    btn.disabled = true;
    status.className = "ty-status";
    status.textContent = on ? "Stopping…" : "Starting…";
    authFetch("/api/admin/analytics/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ collecting: !on }),
    })
      .then(okJsonOrSaid)
      .then(function (s) {
        btn.disabled = false;
        anSettings = s;
        anRenderSwitch();
        status.className = "ty-status is-ok";
        status.textContent = s.collecting ? "Counting visits is now on." : "Counting visits is now off.";
        anLoadNow();
      })
      .catch(function (err) {
        btn.disabled = false;
        if (err && err.message === "unauthorized") return;
        status.className = "ty-status is-error";
        status.textContent = (err && err.said) || "That did not work. Please try again.";
      });
  }

  // ---- the numbers ----
  function anSetDays(days) {
    if (days === anDays && anReport) return;
    anDays = days;
    Array.prototype.forEach.call(doc.querySelectorAll("[data-andays]"), function (b) {
      var active = Number(b.getAttribute("data-andays")) === days;
      b.classList.toggle("is-active", active);
      b.setAttribute("aria-pressed", active ? "true" : "false");
    });
    anLoadReport();
  }

  // A new period dims what is showing and says so until its numbers arrive. Only the latest request
  // may draw: a slower answer for a period chosen earlier is dropped when it turns up.
  function anLoadReport() {
    var seq = ++anSeq;
    var view = el("view-analytics");
    view.setAttribute("aria-busy", "true");
    view.classList.add("is-loading");
    el("anLoading").textContent = "Loading the last " + anDays + " days\u2026";
    authFetch("/api/admin/analytics?days=" + anDays)
      .then(okJson)
      .then(function (d) {
        if (seq !== anSeq) return;
        anReport = d;
        anFailed = false;
        anRenderAll();
      })
      .catch(function (err) {
        if (seq !== anSeq || (err && err.message === "unauthorized")) return;
        anReport = null;
        anFailed = true;
        anRenderAll();
      });
  }

  function anRenderAll() {
    var view = el("view-analytics");
    view.removeAttribute("aria-busy");
    view.classList.remove("is-loading");
    el("anLoading").textContent = "";
    anRenderPeriodNote();
    anRenderFigures();
    anRenderLine();
    anRenderPanels();
  }

  // "Up 12% on the 30 days before". A share is compared in points, not as a percentage of itself.
  function anChange(cur, prev, points) {
    var span = anSpan();
    if (points) {
      var d = cur - prev;
      if (d === 0) return "Same as " + span;
      return (d > 0 ? "Up " : "Down ") + Math.abs(d) + (Math.abs(d) === 1 ? " point" : " points") + " on " + span;
    }
    if (!prev) return cur ? "None in " + span : "Same as " + span;
    var pct = Math.round(((cur - prev) / prev) * 100);
    if (pct === 0) return "About the same as " + span;
    return (pct > 0 ? "Up " : "Down ") + Math.abs(pct) + "% on " + span;
  }

  function anRenderFigures() {
    var box = el("anFigures");
    if (anFailed) {
      box.innerHTML = unavailableHtml("The numbers could not be loaded just now. Try again in a moment, or choose the days again.");
      return;
    }
    var c = anReport.current.headline;
    var p = anReport.previous.headline;
    var cards = [
      ["Visitors", anNum(c.visitors), anChange(c.visitors, p.visitors)],
      ["Visits", anNum(c.visits), anChange(c.visits, p.visits)],
      ["Page views", anNum(c.views), anChange(c.views, p.views)],
      ["Visits that saw one page", c.bounceShare + "%", anChange(c.bounceShare, p.bounceShare, true)],
    ];
    box.innerHTML = cards
      .map(function (k) {
        return '<div class="admin-stat an-stat"><div class="n">' + H.escapeHtml(k[1]) + '</div><div class="l">' +
          H.escapeHtml(k[0]) + '</div><p class="an-change">' + H.escapeHtml(k[2]) + "</p></div>";
      })
      .join("");
  }

  // The line: inline SVG stretched to its box, so its lines keep their width (non-scaling-stroke) and
  // every word is HTML around it. The period before is a dashed grey line under it. Screen readers
  // get a sentence instead of the drawing; a pointer gets the day under it.
  function anRenderLine() {
    var box = el("anLine");
    if (anFailed) {
      box.innerHTML = unavailableHtml(AN_FAILED);
      return;
    }
    var cur = anReport.current.daily || [];
    var prev = anReport.previous.daily || [];
    var total = 0;
    var prevTotal = 0;
    var hi = null;
    var lo = null;
    cur.forEach(function (d) {
      total += d.visitors;
      if (!hi || d.visitors > hi.visitors) hi = d;
      if (!lo || d.visitors < lo.visitors) lo = d;
    });
    prev.forEach(function (d) {
      prevTotal += d.visitors;
    });
    if (!cur.length || total === 0) {
      box.innerHTML = AN_EMPTY;
      return;
    }
    // The top of the axis is even, so the gridline halfway up is a whole number of visitors too.
    var max = 1;
    cur.concat(prev).forEach(function (d) {
      if (d.visitors > max) max = d.visitors;
    });
    if (max % 2) max += 1;
    var W = 600;
    var HT = 160;
    var n = cur.length;
    function x(i) {
      return n === 1 ? W / 2 : (i * W) / (n - 1);
    }
    function y(v) {
      return HT - (v / max) * (HT - 4) - 2;
    }
    function points(list) {
      return list
        .slice(0, n)
        .map(function (d, i) {
          return x(i).toFixed(1) + "," + y(d.visitors).toFixed(1);
        })
        .join(" ");
    }
    var curPts = points(cur);
    var area = "M0," + HT + " L" + curPts.split(" ").join(" L") + " L" + x(n - 1).toFixed(1) + "," + HT + " Z";
    var span = anSpan();
    var summary =
      "Visitors each day from " + anDay(cur[0].day) + " to " + anDay(cur[n - 1].day) + ": " + anNum(total) + " in all, highest " +
      anNum(hi.visitors) + " on " + anDay(hi.day) + ", lowest " + anNum(lo.visitors) + " on " + anDay(lo.day) + ". " +
      "In " + span + ", " + anNum(prevTotal) + " in all.";
    box.innerHTML =
      '<p class="sr-only" id="anLineSummary">' + H.escapeHtml(summary) + "</p>" +
      '<ul class="an-legend" aria-hidden="true"><li><span class="an-key"></span>' + H.escapeHtml("Last " + n + " days") +
      '</li><li><span class="an-key is-prev"></span>' + H.escapeHtml(span.charAt(0).toUpperCase() + span.slice(1)) + "</li></ul>" +
      '<div class="an-chart" aria-hidden="true">' +
      '<div class="an-y"><span>' + anNum(max) + "</span><span>" + anNum(max / 2) + "</span><span>0</span></div>" +
      '<div class="an-plot">' +
      '<svg class="an-svg" viewBox="0 0 ' + W + " " + HT + '" preserveAspectRatio="none" focusable="false">' +
      '<line class="an-gridline" x1="0" x2="' + W + '" y1="' + y(max) + '" y2="' + y(max) + '"/>' +
      '<line class="an-gridline" x1="0" x2="' + W + '" y1="' + y(max / 2) + '" y2="' + y(max / 2) + '"/>' +
      '<line class="an-gridline is-base" x1="0" x2="' + W + '" y1="' + HT + '" y2="' + HT + '"/>' +
      (prev.length ? '<polyline class="an-line is-prev" points="' + points(prev) + '"/>' : "") +
      '<path class="an-area" d="' + area + '"/>' +
      '<polyline class="an-line" points="' + curPts + '"/>' +
      "</svg>" +
      '<span class="an-dot" hidden></span><div class="an-tip" hidden></div>' +
      "</div>" +
      '<div class="an-x"><span>' + H.escapeHtml(anDay(cur[0].day, true)) + "</span><span>" + H.escapeHtml(anDay(cur[n - 1].day, true)) + "</span></div>" +
      "</div>";
    var plot = box.querySelector(".an-plot");
    var dot = plot.querySelector(".an-dot");
    var tip = plot.querySelector(".an-tip");
    function show(e) {
      var rect = plot.getBoundingClientRect();
      if (!rect.width) return;
      var i = Math.max(0, Math.min(n - 1, Math.round(((e.clientX - rect.left) / rect.width) * (n - 1))));
      var d = cur[i];
      var before = prev[i];
      var left = (x(i) / W) * 100;
      dot.style.left = left + "%";
      dot.style.top = (y(d.visitors) / HT) * 100 + "%";
      tip.innerHTML =
        "<b>" + H.escapeHtml(anDay(d.day, true)) + "</b> " + anNum(d.visitors) + (d.visitors === 1 ? " visitor" : " visitors") +
        (before ? '<br><span class="an-tip-prev">Period before, ' + H.escapeHtml(anDay(before.day, true)) + ": " + anNum(before.visitors) + "</span>" : "");
      dot.hidden = false;
      tip.hidden = false;
      // Kept inside the chart, so near either end it never reaches past the card on a phone.
      var half = tip.offsetWidth / 2;
      var centre = (left / 100) * rect.width;
      tip.style.left = Math.max(half, Math.min(rect.width - half, centre)) + "px";
    }
    plot.addEventListener("pointermove", show);
    plot.addEventListener("pointerdown", show);
    plot.addEventListener("pointerleave", function () {
      dot.hidden = true;
      tip.hidden = true;
    });
  }

  // A ranked list with bars. Each row: `label` (already HTML), its number, and a bar against the
  // biggest. The top ten, and "Show all" when there are more.
  function anBars(id, rows, label, value, opts) {
    var box = el(id);
    if (!box) return;
    if (anFailed) {
      box.innerHTML = unavailableHtml(AN_FAILED);
      return;
    }
    if (!rows || !rows.length) {
      box.innerHTML = AN_EMPTY;
      return;
    }
    opts = opts || {};
    var total = 0;
    var max = 0;
    rows.forEach(function (r) {
      var v = value(r);
      total += v;
      if (v > max) max = v;
    });
    var shown = anExpanded[id] ? rows : rows.slice(0, AN_TOP);
    box.innerHTML =
      '<ol class="an-bars">' +
      shown
        .map(function (r) {
          var v = value(r);
          var share = total ? Math.round((v / total) * 100) : 0;
          return (
            '<li class="an-row"><span class="an-row-label">' + label(r) + '</span><span class="an-row-n">' + anNum(v) +
            (opts.share ? ' <span class="an-row-share">' + (share === 0 && v > 0 ? "under 1%" : share + "%") + "</span>" : "") +
            '</span><span class="an-track" aria-hidden="true"><span class="an-fill" style="width:' +
            (max ? Math.max(1, Math.round((v / max) * 100)) : 0) + '%"></span></span></li>'
          );
        })
        .join("") +
      "</ol>" +
      anMore(id, rows.length);
  }

  function anMore(id, count) {
    if (count <= AN_TOP) return "";
    var all = !!anExpanded[id];
    return (
      '<button class="an-more" type="button" data-anmore="' + id + '" aria-expanded="' + (all ? "true" : "false") + '">' +
      (all ? "Show the top 10" : count >= AN_LIST_CAP ? "Show the top " + count : "Show all " + count) + "</button>"
    );
  }

  function anPages(rows) {
    var box = el("anPages");
    if (anFailed) {
      box.innerHTML = unavailableHtml(AN_FAILED);
      return;
    }
    if (!rows || !rows.length) {
      box.innerHTML = AN_EMPTY;
      return;
    }
    var shown = anExpanded.anPages ? rows : rows.slice(0, AN_TOP);
    var head = ["Page", "Views", "Visitors", "Average time", "Average scroll", "Visits that began here"];
    box.innerHTML =
      '<table class="admin-table an-pages"><thead><tr>' +
      head
        .map(function (h, i) {
          return '<th scope="col"' + (i ? ' class="admin-num"' : "") + ">" + h + "</th>";
        })
        .join("") +
      "</tr></thead><tbody>" +
      shown
        .map(function (r) {
          var cells = [
            anPage(r.path, r.title),
            anNum(r.views),
            anNum(r.visitors),
            anDuration(r.avgActiveSeconds),
            r.avgScroll === null || r.avgScroll === undefined ? "Not yet" : r.avgScroll + "%",
            r.entryShare + "%",
          ];
          return (
            "<tr>" +
            cells
              .map(function (c, i) {
                return "<td" + (i ? ' class="admin-num"' : ' class="an-page"') + ' data-label="' + head[i] + '">' + H.escapeHtml(c) + "</td>";
              })
              .join("") +
            "</tr>"
          );
        })
        .join("") +
      "</tbody></table>" +
      anMore("anPages", rows.length);
  }

  function anRenderPanels() {
    var c = anReport ? anReport.current : {};
    var esc = H.escapeHtml;
    function visits(r) { return r.visits; }
    function visitors(r) { return r.visitors; }
    function clicks(r) { return r.clicks; }
    anBars("anChannels", c.channels, function (r) { return esc(AN_CHANNELS[r.channel] || r.channel); }, visits, { share: true });
    anBars("anWebsites", c.otherWebsites, function (r) { return esc(r.source); }, visits);
    // TASK-492: QR code scans, by the page whose code it was (named by the server).
    anBars("anQrCodes", c.qrCodes, function (r) { return esc(r.label); }, visits);
    anBars("anNewsletters", c.newsletters, function (r) { return esc(r.label); }, visits);
    anBars("anCities", c.cities, function (r) {
      return esc(r.city) + (r.region ? '<span class="an-row-sub">' + esc(r.region) + "</span>" : "");
    }, visitors);
    anBars("anCountries", c.countries, function (r) { return esc(r.name); }, visitors, { share: true });
    anPages(c.pages);
    anBars("anClickKinds", c.clickKinds, function (r) { return esc(AN_KINDS[r.kind] || r.kind); }, clicks);
    anBars("anClicks", c.clicks, function (r) {
      return esc(r.label || AN_KINDS[r.kind] || r.kind) + '<span class="an-row-sub">' + esc(AN_KIND_ONE[r.kind] || r.kind) + "</span>";
    }, clicks);
    anBars("anDevices", c.devices, function (r) { return esc(AN_DEVICES[r.device] || r.device); }, visitors, { share: true });
    anBars("anBrowsers", c.browsers, function (r) { return esc(r.browser); }, visitors, { share: true });
    anRenderNow(anFailed ? null : anReport.rightNow);
  }

  // Right now: people with a page view in the last 5 minutes. While counting is off nobody is
  // counted, so it says that rather than "0 people", which would read as an empty website.
  function anRenderNow(now) {
    var box = el("anNow");
    if (!now) {
      box.innerHTML = unavailableHtml(AN_FAILED);
      return;
    }
    var k = Number(now.people || 0);
    box.innerHTML =
      (now.collecting
        ? '<p class="an-now"><span class="an-now-n">' + anNum(k) + "</span> " +
          (k === 1 ? "person" : "people") + " on the website in the last 5 minutes.</p>"
        : '<p class="an-now">Counting is off, so nobody is being counted right now.</p>') +
      '<button class="an-more" type="button" data-anrefresh>Check again</button>';
  }

  function anLoadNow() {
    authFetch("/api/admin/analytics/now")
      .then(okJson)
      .then(function (now) {
        anRenderNow(now);
      })
      .catch(function (err) {
        if (err && err.message === "unauthorized") return;
        anRenderNow(null);
      });
  }

  // The small print under the chips: which days are counted and to when. Today is only part of a
  // day, so the days before are counted up to the same time of day (src/analytics/report.ts).
  var AN_CLOCK = (function () {
    try {
      return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    } catch {
      return null;
    }
  })();
  function anRenderPeriodNote() {
    var note = el("anPeriodNote");
    if (anFailed || !anReport || !anReport.current || !anReport.previous) {
      note.textContent = "";
      return;
    }
    var c = anReport.current;
    var p = anReport.previous;
    var time = AN_CLOCK && c.until ? AN_CLOCK.format(new Date(c.until)) : "";
    note.textContent =
      anDay(c.from) + " to now, beside " + anDay(p.from) + " to " + anDay(p.to) + "." +
      (time
        ? " Today is counted up to " + time + ", so " + anDay(p.to) + " is counted up to " + time +
          " too, and a morning is never set against a whole day."
        : "");
  }
})();
