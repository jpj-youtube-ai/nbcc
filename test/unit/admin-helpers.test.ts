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

  it("escapeHtml neutralises a single quote (G1 item 4)", () => {
    expect(H.escapeHtml("O'Brien")).toBe("O&#39;Brien");
    expect(H.escapeHtml("'; DROP TABLE stories; --")).not.toContain("'");
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

// TASK-251: SIGNERS is THE list of people who can sign for NBCC. It exists so the thank-you letter's
// picker and the newsletter sign-off block are built from one source: "the same list of names" has to
// survive someone joining or leaving, and two hardcoded copies would not.
describe("SIGNERS (the one list of who can sign for NBCC)", () => {
  it("carries every signer with a name to sign and a role for the thank-you letter", () => {
    expect(H.SIGNERS.length).toBeGreaterThan(0);
    for (const s of H.SIGNERS) {
      expect(typeof s.name).toBe("string");
      expect(s.name.trim()).not.toBe("");
      expect(typeof s.role).toBe("string");
      expect(s.role.trim()).not.toBe("");
    }
  });

  it("includes the usual signatory", () => {
    expect(H.SIGNERS.map((s: { name: string }) => s.name)).toContain("Jodie McFarlane");
  });

  it("has no duplicate names — the picker keys on the name", () => {
    const names = H.SIGNERS.map((s: { name: string }) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

// TASK-256: the delivery-stats rate. Pure and defensive: rates read as "of the emails accepted, how
// many...", and the two degenerate cases must render as ABSENCE, not as a scary "0%" — a newsletter
// sent before tracking existed has no denominator, and that is "no data", not "nothing delivered".
describe("rateOf (delivery stats)", () => {
  it("formats a plain percentage of the denominator", () => {
    expect(H.rateOf(139, 142)).toBe("98%");
    expect(H.rateOf(3, 142)).toBe("2%"); // 1/142 would be 0.7% — that is the "<1%" case below, not "1%"
  });

  it("never rounds a non-zero count DOWN to 0% or a shortfall UP to 100%", () => {
    // 1 bounce out of 500 is real — "0%" would hide it; 499/500 delivered is not "100%".
    expect(H.rateOf(1, 500)).toBe("<1%");
    expect(H.rateOf(499, 500)).toBe("99%");
    expect(H.rateOf(500, 500)).toBe("100%");
    expect(H.rateOf(0, 500)).toBe("0%");
  });

  it("returns empty for a missing denominator rather than inventing a rate", () => {
    expect(H.rateOf(3, 0)).toBe("");
    expect(H.rateOf(0, 0)).toBe("");
  });
});

// Hosted newsletter documents (2026-07-22 design): the "Insert button" action in the Documents
// panel builds a standard button block pointing at the public viewer page. Pure, so the label
// default and href shape are pinned here rather than eyeballed in the composer.
describe("documentButtonBlock (hosted documents)", () => {
  const ID = "11111111-2222-4333-8444-555555555555";

  it("builds a button block linking the hosted viewer page on the given origin", () => {
    const b = H.documentButtonBlock("https://nbcc.scot", ID, "certificate.pdf");
    expect(b.type).toBe("button");
    expect(b.variant).toBe(0);
    expect(b.data.href).toBe("https://nbcc.scot/newsletter/document/" + ID);
  });

  it("defaults the label from the filename without its extension", () => {
    expect(H.documentButtonBlock("https://nbcc.scot", ID, "certificate.pdf").data.label)
      .toBe("View & print certificate");
    expect(H.documentButtonBlock("https://nbcc.scot", ID, "Order of Service.docx").data.label)
      .toBe("View & print Order of Service");
    // No extension: the whole name is the label.
    expect(H.documentButtonBlock("https://nbcc.scot", ID, "certificate").data.label)
      .toBe("View & print certificate");
  });
});
