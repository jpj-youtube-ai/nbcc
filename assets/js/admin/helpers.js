// Pure, DOM-free helpers for the admin dashboard (REQ-066). Formatting, session-claim decoding and
// role-gating — no fetch, no DOM — so they are unit-tested directly (test/unit/admin-helpers.test.ts),
// mirroring the CommonJS-guard export style of assets/js/main.js. In the browser they hang off
// window.AdminHelpers; app.js consumes them.
(function () {
  "use strict";

  // Pence -> a GBP string: 5000 -> "£50", 2550 -> "£25.50".
  function formatPence(pence) {
    if (typeof pence !== "number" || !isFinite(pence)) return "";
    var pounds = pence / 100;
    return "£" + (pounds % 1 === 0 ? pounds.toFixed(0) : pounds.toFixed(2));
  }

  // HTML-escape a value for safe interpolation into a table cell.
  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function b64urlDecode(input) {
    var s = String(input).replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    if (typeof atob === "function") return atob(s);
    return Buffer.from(s, "base64").toString("binary"); // Node fallback (tests)
  }

  // Decode the admin session token's claims for DISPLAY + UI gating only (the server still enforces
  // every rule). The token is `base64url(claimsJson).base64url(sig)`; returns the claims object or
  // null when it does not parse / has no role. Does NOT verify the signature — that is the server's job.
  function parseClaims(token) {
    if (!token || typeof token !== "string") return null;
    var parts = token.split(".");
    if (parts.length !== 2 || !parts[0]) return null;
    try {
      var claims = JSON.parse(b64urlDecode(parts[0]));
      return claims && typeof claims.role === "string" ? claims : null;
    } catch (e) {
      return null;
    }
  }

  var RANK = { viewer: 1, editor: 2, admin: 3 };

  // Whether `role` meets the minimum role rank for an action (viewer < editor < admin).
  function roleCan(role, minRole) {
    return (RANK[role] || 0) >= (RANK[minRole] || 0);
  }

  // Format an ISO/date value as DD/MM/YYYY (UTC), or "" when absent/invalid.
  function fmtDate(value) {
    if (!value) return "";
    var d = new Date(value);
    if (isNaN(d.getTime())) return "";
    var dd = String(d.getUTCDate()).padStart(2, "0");
    var mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    return dd + "/" + mm + "/" + d.getUTCFullYear();
  }

  var api = {
    formatPence: formatPence,
    escapeHtml: escapeHtml,
    parseClaims: parseClaims,
    roleCan: roleCan,
    fmtDate: fmtDate,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else window.AdminHelpers = api;
})();
