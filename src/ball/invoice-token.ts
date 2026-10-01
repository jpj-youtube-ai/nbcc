import { createHmac, timingSafeEqual } from "node:crypto";

// TASK-486: the private link to a Festive Ball invoice, `/ball/invoice/<token>`. The invoice carries a
// company's address and the booking's money, so the link must not be guessable from a booking number.
// Stateless, like the thank-you letter's token (src/thank-you/letter-token.ts): `id.hmac`, signed with
// config.ADMIN_SESSION_SECRET. The signature covers "invoice:<id>", not the bare id, so a token made for
// another purpose with the same secret and number can never open an invoice.

const sign = (id: string, secret: string): string =>
  createHmac("sha256", secret).update(`invoice:${id}`).digest("base64url");

export function signInvoiceToken(bookingId: number, secret: string): string {
  return `${bookingId}.${sign(String(bookingId), secret)}`;
}

export function verifyInvoiceToken(token: string, secret: string): number {
  const parts = (token ?? "").split(".");
  if (parts.length !== 2 || !/^[1-9]\d*$/.test(parts[0]) || !parts[1]) throw new Error("invoice token malformed");
  const a = Buffer.from(parts[1]);
  const b = Buffer.from(sign(parts[0], secret));
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error("invoice token bad signature");
  return Number(parts[0]);
}
