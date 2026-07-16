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
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
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

  // Task C (Stories tab): a plain-English "how old is this consent" label, e.g. "today",
  // "1 day ago", "5 days ago", "6 months ago" — so admin can judge whether an old consent should
  // still be relied on before reusing a story publicly (spec's Retention guardrail 3). `now`
  // defaults to the current time; a Date/ISO string may be passed for deterministic tests.
  function consentAge(value, now) {
    if (!value) return "";
    var then = new Date(value);
    if (isNaN(then.getTime())) return "";
    var ref = now instanceof Date ? now : now ? new Date(now) : new Date();
    var days = Math.floor((ref.getTime() - then.getTime()) / 86400000);
    if (days <= 0) return "today";
    if (days === 1) return "1 day ago";
    if (days < 60) return days + " days ago";
    var months = Math.floor(days / 30);
    return months + " month" + (months === 1 ? "" : "s") + " ago";
  }

  // Task C: human labels for the story enum fields, used by the Stories list/detail badges.
  var STORY_LABELS = {
    useScope: { public: "Public", internal_only: "Internal only" },
    status: { new: "New", reviewed: "Reviewed", used: "Used", withdrawn: "Withdrawn" },
    submitterRole: {
      supported: "Supported",
      family_carer: "Family / carer",
      volunteer: "Volunteer",
      professional_partner: "Professional partner",
      supporter_donor: "Supporter / donor",
      other: "Other",
    },
    ageBand: { "16_24": "16-24", "25_44": "25-44", "45_64": "45-64", "65_plus": "65+" },
    recipientType: { child: "Child", young_person: "Young person", vulnerable_adult: "Vulnerable adult" },
  };
  function storyLabel(key, value) {
    if (value == null || value === "") return "Not given";
    var map = STORY_LABELS[key];
    return (map && map[value]) || String(value);
  }

  // TASK-241 (admin donations list): one display label + state for a donation's payment, combining
  // payment_status ('pending'/'paid'/'failed') with the separately-tracked refunded_amount_pence. A
  // pending/failed gift shows that state; a settled gift shows Refunded (refund >= amount), Partly
  // refunded (partial) or Paid. `state` drives the pill styling (.admin-pill--<state>). Pure/DOM-free.
  function paymentLabel(d) {
    var status = d && d.payment_status;
    if (status === "pending") return { label: "Pending", state: "pending" };
    if (status === "failed") return { label: "Failed", state: "failed" };
    var amount = d && typeof d.amount_pence === "number" ? d.amount_pence : 0;
    var refunded = d && typeof d.refunded_amount_pence === "number" ? d.refunded_amount_pence : 0;
    if (refunded > 0 && refunded >= amount) return { label: "Refunded", state: "refunded" };
    if (refunded > 0) return { label: "Partly refunded", state: "partial" };
    return { label: "Paid", state: "paid" };
  }

  // TASK-245 (admin subscriptions view): one display label + state for a subscription_dunning row.
  // A voluntary cancel is stamped in cancelled_at while status may stay 'active', so Cancelled takes
  // precedence; otherwise the dunning status maps to Lapsed / At risk / Active. `state` drives the pill
  // styling (.admin-pill--<state>). Pure/DOM-free.
  function subscriptionStateLabel(row) {
    if (row && row.cancelled_at) return { label: "Cancelled", state: "cancelled" };
    var status = row && row.status;
    if (status === "lapsed") return { label: "Lapsed", state: "lapsed" };
    if (status === "past_due") return { label: "At risk", state: "past_due" };
    return { label: "Active", state: "active" };
  }

  // Who can sign for NBCC (TASK-251). THE list — the thank-you letter's signer picker and the
  // newsletter's sign-off block are both built from this, so "the same list of names" stays true when
  // someone joins or leaves. It used to be hardcoded <option> tags in admin.html; a second copy in the
  // newsletter builder would have drifted the first time the team changed.
  //   name — as it should be SIGNED.
  //   role — the formal title the thank-you LETTER prints under the signature.
  // The newsletter sign-off says "On behalf of everyone at NBCC" instead of a title, so it uses the
  // name from here and its own role line.
  var SIGNERS = [
    { name: "Jodie McFarlane", role: "Head Elf (Trustee), Night Before Christmas Campaign" },
    { name: "Isabella McFarlane", role: "Procurement (Trustee), Night Before Christmas Campaign" },
    { name: "Jon McFarlane", role: "Marketing, Night Before Christmas Campaign" },
    { name: "Jaimie Wakefield", role: "Project Manager, Night Before Christmas Campaign" },
  ];

  var api = {
    formatPence: formatPence,
    escapeHtml: escapeHtml,
    parseClaims: parseClaims,
    roleCan: roleCan,
    fmtDate: fmtDate,
    consentAge: consentAge,
    storyLabel: storyLabel,
    paymentLabel: paymentLabel,
    subscriptionStateLabel: subscriptionStateLabel,
    SIGNERS: SIGNERS,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else window.AdminHelpers = api;
})();
