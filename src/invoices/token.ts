import { createHmac, timingSafeEqual } from "node:crypto";

// The private link to an invoice for a donation, `/invoice/<token>`, as `id.hmac` signed with
// config.ADMIN_SESSION_SECRET (the same method as the Festive Ball's invoices, src/ball/invoice-token.ts).
// The signature covers "donation-invoice:<id>", so neither kind of invoice link can ever open the other,
// and knowing an invoice number never opens an invoice.

const sign = (id: string, secret: string): string =>
  createHmac("sha256", secret).update(`donation-invoice:${id}`).digest("base64url");

export function signDonationInvoiceToken(id: number, secret: string): string {
  return `${id}.${sign(String(id), secret)}`;
}

export function verifyDonationInvoiceToken(token: string, secret: string): number {
  const parts = (token ?? "").split(".");
  if (parts.length !== 2 || !/^[1-9]\d{0,9}$/.test(parts[0]) || !parts[1]) throw new Error("invoice token malformed");
  const a = Buffer.from(parts[1]);
  const b = Buffer.from(sign(parts[0], secret));
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error("invoice token bad signature");
  return Number(parts[0]);
}
