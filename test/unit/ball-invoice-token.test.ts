import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { signInvoiceToken, verifyInvoiceToken } from "../../src/ball/invoice-token";

// TASK-486: the private link to a Festive Ball invoice. The invoice carries a company's address and
// the booking's money, so its address cannot be guessed from a booking number.

const SECRET = "test-secret-for-invoices";

describe("the invoice link's token", () => {
  it("comes back as the booking it was made for", () => {
    expect(verifyInvoiceToken(signInvoiceToken(42, SECRET), SECRET)).toBe(42);
  });

  it("is refused when the booking number is changed", () => {
    const [, sig] = signInvoiceToken(42, SECRET).split(".");
    expect(() => verifyInvoiceToken(`43.${sig}`, SECRET)).toThrow();
  });

  it("is refused when signed with another secret", () => {
    expect(() => verifyInvoiceToken(signInvoiceToken(42, "another"), SECRET)).toThrow();
  });

  it("is refused when it is not a token at all", () => {
    for (const bad of ["", "42", "abc.def", ".x", "0.x", "-1.x"]) {
      expect(() => verifyInvoiceToken(bad, SECRET), bad).toThrow();
    }
  });

  // A thank-you letter's token for the same number must not open an invoice.
  it("is not interchangeable with another kind of signed link", () => {
    const token = signInvoiceToken(42, SECRET);
    expect(token.startsWith("42.")).toBe(true);
    expect(token).not.toBe(`42.${createHmac("sha256", SECRET).update("42").digest("base64url")}`);
  });
});
