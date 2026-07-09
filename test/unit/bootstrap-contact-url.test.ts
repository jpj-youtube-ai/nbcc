import { describe, it, expect } from "vitest";
import { parseContactUrl, quoteIdent, quoteLiteral } from "../../scripts/bootstrap-contact-db.mjs";

describe("parseContactUrl", () => {
  it("extracts user/password/database", () => {
    expect(parseContactUrl("postgres://contact_app:pw@host:5432/contact")).toEqual({
      user: "contact_app",
      password: "pw",
      database: "contact",
    });
  });

  it("throws on a non-URL", () => {
    expect(() => parseContactUrl("not-a-url")).toThrow();
  });

  it("throws when user or password is missing", () => {
    expect(() => parseContactUrl("postgres://host:5432/contact")).toThrow();
  });
});

describe("identifier/literal quoting", () => {
  it("doubles embedded quotes", () => {
    expect(quoteIdent('a"b')).toBe('"a""b"');
    expect(quoteLiteral("a'b")).toBe("'a''b'");
  });
});
