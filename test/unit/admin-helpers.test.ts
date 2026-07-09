import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { signAdminSession } from "../../src/admin/session";

// TASK-115 (REQ-066): the pure admin dashboard helpers (assets/js/admin/helpers.js) — formatting,
// session-claim decoding and role gating. DOM-free, so required straight into the unit suite (same
// CommonJS-guard style as assets/js/main.js), with parseClaims fed a REAL token from signAdminSession.

const require = createRequire(import.meta.url);
const H = require(resolve(__dirname, "../../assets/js/admin/helpers.js"));

describe("admin helpers (TASK-115)", () => {
  it("formatPence renders GBP", () => {
    expect(H.formatPence(5000)).toBe("£50");
    expect(H.formatPence(2550)).toBe("£25.50");
    expect(H.formatPence(0)).toBe("£0");
    expect(H.formatPence("x")).toBe("");
  });

  it("escapeHtml neutralises markup", () => {
    expect(H.escapeHtml('<b>&"')).toBe("&lt;b&gt;&amp;&quot;");
    expect(H.escapeHtml(null)).toBe("");
  });

  it("roleCan ranks viewer < editor < admin", () => {
    expect(H.roleCan("admin", "editor")).toBe(true);
    expect(H.roleCan("editor", "editor")).toBe(true);
    expect(H.roleCan("viewer", "editor")).toBe(false);
    expect(H.roleCan("nope", "viewer")).toBe(false);
  });

  it("fmtDate formats DD/MM/YYYY (UTC)", () => {
    expect(H.fmtDate("2026-07-04T12:00:00Z")).toBe("04/07/2026");
    expect(H.fmtDate(null)).toBe("");
    expect(H.fmtDate("nonsense")).toBe("");
  });

  it("parseClaims decodes a real admin session token (display/gating only)", () => {
    const { token, claims } = signAdminSession({
      sub: 7,
      email: "staff@nbcc",
      role: "editor",
      now: new Date(),
      secret: "unit-secret",
    });
    const parsed = H.parseClaims(token);
    expect(parsed.role).toBe("editor");
    expect(parsed.email).toBe("staff@nbcc");
    expect(parsed.sub).toBe(7);
    expect(parsed.exp).toBe(claims.exp);
    expect(H.parseClaims("garbage")).toBeNull();
    expect(H.parseClaims(null)).toBeNull();
  });

  // Task C (Stories tab): a plain-English "how old is this consent" label, so admin can judge
  // whether an old consent should be reused publicly (spec's Retention guardrail 3).
  describe("consentAge", () => {
    it("renders 'today' for a timestamp within the last 24h", () => {
      const now = new Date("2026-07-09T12:00:00Z");
      expect(H.consentAge("2026-07-09T06:00:00Z", now)).toBe("today");
    });

    it("renders '1 day ago' for exactly one day", () => {
      const now = new Date("2026-07-09T12:00:00Z");
      expect(H.consentAge("2026-07-08T12:00:00Z", now)).toBe("1 day ago");
    });

    it("renders 'N days ago' for a few days", () => {
      const now = new Date("2026-07-09T12:00:00Z");
      expect(H.consentAge("2026-07-04T12:00:00Z", now)).toBe("5 days ago");
    });

    it("renders 'N months ago' beyond 60 days", () => {
      const now = new Date("2026-07-09T12:00:00Z");
      expect(H.consentAge("2026-01-09T12:00:00Z", now)).toBe("6 months ago");
    });

    it("renders '' for a missing/invalid value", () => {
      expect(H.consentAge(null, new Date())).toBe("");
      expect(H.consentAge("nonsense", new Date())).toBe("");
    });
  });

  // Task C: human labels for the story enum fields, used by the Stories list/detail badges.
  describe("storyLabel", () => {
    it("maps use_scope", () => {
      expect(H.storyLabel("useScope", "public")).toBe("Public");
      expect(H.storyLabel("useScope", "internal_only")).toBe("Internal only");
    });
    it("maps status", () => {
      expect(H.storyLabel("status", "new")).toBe("New");
      expect(H.storyLabel("status", "withdrawn")).toBe("Withdrawn");
    });
    it("maps submitterRole", () => {
      expect(H.storyLabel("submitterRole", "family_carer")).toBe("Family / carer");
      expect(H.storyLabel("submitterRole", null)).toBe("Not given");
    });
    it("falls back to the raw value for an unmapped key", () => {
      expect(H.storyLabel("unknownKey", "raw_value")).toBe("raw_value");
    });
  });
});
