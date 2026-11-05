import express, { Router, type Request, type Response } from "express";
import { authorizeSection } from "./admin-authz";
import { config } from "../config";
import { createRateLimiter } from "../portal/request-limiter";
import { ukDay } from "../analytics/visitor";
import { bankDetailsSchema } from "../ball/transfer";
import { declarationFieldsSchema, type DeclarationFields } from "../declarations/fields";
import { displayState, invoiceNumber, isPayable, isRealDay, parseInvoiceInput } from "../invoices/model";
import { verifyDonationInvoiceToken } from "../invoices/token";
import { renderDonationInvoicePage } from "../invoices/page";
import { buildInvoiceEmail } from "../invoices/emails";
import { buildInvoiceSessionParams } from "../invoices/checkout";
import {
  cancelInvoice,
  createInvoice,
  getInvoice,
  getInvoiceSettings,
  linkFor,
  listInvoices,
  markInvoicePaidByTransfer,
  markSent,
  saveGiftAid,
  saveInvoiceSettings,
  type InvoiceRow,
} from "../db/invoices";
import { sendInvoiceEmail } from "../clients/email";

// Invoices for donations (docs/superpowers/specs/2026-11-05-donation-invoices-design.md).
//
//   GET  /api/admin/invoices                  the invoices, newest first, and the bank details     donations: view
//   POST /api/admin/invoices                  make one and email it                                donations: edit
//   POST /api/admin/invoices/:id/resend       email it again (waiting only)                        donations: edit
//   POST /api/admin/invoices/:id/mark-paid    a bank transfer arrived: { paidOn }                  donations: edit
//   POST /api/admin/invoices/:id/cancel       cancel a waiting invoice                             donations: edit
//   PUT  /api/admin/invoices/bank             the bank details on invoices, or { clear: true }     donations: edit
//   GET  /invoice/:token                      the private invoice page                             the link
//   POST /invoice/:token/pay                  to Stripe for this invoice (with a person's Gift Aid) the link
//   POST /invoice/:token/gift-aid             keep a person's Gift Aid declaration until paid      the link
//
// The private pages are plain forms, so they work without any script. A paid or cancelled invoice can
// never start a payment. A business or group never gives Gift Aid, whatever is posted.

const NOT_FOUND = "That invoice is not there. It may have been made on another screen: reload the page.";
const GIFT_AID_INCOMPLETE =
  "To add Gift Aid, fill in your first and last name, house name or number, street and town, and postcode. Or untick the Gift Aid box.";
const CARD_DOWN = "Card payments are not working just now. Please try again in a few minutes, or pay by bank transfer.";

const actorOf = (claims: { email: string }) => `admin:${claims.email}`;
const today = () => ukDay(new Date());

function idOf(raw: unknown): number | null {
  const s = String(raw ?? "");
  if (!/^[1-9]\d{0,9}$/.test(s)) return null;
  const id = Number(s);
  return id <= 2147483647 ? id : null;
}

function forAdmin(inv: InvoiceRow, day: string) {
  return { ...inv, number: invoiceNumber(inv.id), state: displayState(inv, day), link: linkFor(inv.id) };
}

async function emailInvoice(inv: InvoiceRow): Promise<boolean> {
  try {
    const bank = await getInvoiceSettings().catch(() => null);
    const e = buildInvoiceEmail({
      number: invoiceNumber(inv.id),
      contactName: inv.contactName,
      orgName: inv.orgName,
      amountPence: inv.amountPence,
      description: inv.description,
      note: inv.note,
      dueOn: inv.dueOn,
      link: linkFor(inv.id),
      bankTransfer: Boolean(bank),
    });
    await sendInvoiceEmail({ email: inv.email, name: inv.orgName ?? inv.contactName, ...e });
    return true;
  } catch (err) {
    console.error("invoice email failed:", err instanceof Error ? err.message : err);
    return false;
  }
}

export async function getAdminInvoices(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "donations", "view"))) return;
  res.setHeader("Cache-Control", "no-store");
  try {
    const [invoices, bank] = await Promise.all([listInvoices(), getInvoiceSettings()]);
    const day = today();
    return res.status(200).json({ invoices: invoices.map((i) => forAdmin(i, day)), bank, today: day });
  } catch (err) {
    console.error("admin invoices: listing failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "The invoices could not load. Please try again." });
  }
}

export async function postAdminInvoice(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "donations", "edit");
  if (!claims) return;
  res.setHeader("Cache-Control", "no-store");
  const day = today();
  const parsed = parseInvoiceInput(req.body, day);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error, field: parsed.field });
  let inv: InvoiceRow;
  try {
    inv = await createInvoice(parsed.value, day, actorOf(claims));
  } catch (err) {
    console.error("admin invoices: making one failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "That invoice could not be saved. Please try again." });
  }
  const sent = await emailInvoice(inv);
  if (sent) await markSent(inv.id, actorOf(claims)).catch(() => undefined);
  return res.status(201).json({ id: inv.id, number: invoiceNumber(inv.id), link: linkFor(inv.id), sent });
}

export async function postResendInvoice(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "donations", "edit");
  if (!claims) return;
  res.setHeader("Cache-Control", "no-store");
  const id = idOf(req.params.id);
  const inv = id ? await getInvoice(id) : null;
  if (!inv) return res.status(404).json({ error: NOT_FOUND });
  if (inv.status !== "waiting") return res.status(409).json({ error: "Only an invoice that is still waiting can be emailed again." });
  if (!(await emailInvoice(inv))) return res.status(502).json({ error: "The email did not go. Please try again in a few minutes." });
  await markSent(inv.id, actorOf(claims)).catch(() => undefined);
  return res.status(200).json({ id: inv.id, sent: true });
}

export async function postMarkInvoicePaid(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "donations", "edit");
  if (!claims) return;
  res.setHeader("Cache-Control", "no-store");
  const id = idOf(req.params.id);
  const paidOn = (req.body ?? {}).paidOn;
  if (!isRealDay(paidOn) || paidOn > today()) {
    return res.status(400).json({ error: "Choose the date the money arrived. It cannot be in the future.", field: "paidOn" });
  }
  const inv = id ? await getInvoice(id) : null;
  if (!inv) return res.status(404).json({ error: NOT_FOUND });
  // A double press must never record one transfer twice. A real second payment by card is recorded by
  // the webhook; a second transfer is rare enough for staff to add by hand.
  if (inv.status === "paid") return res.status(409).json({ error: "This invoice is already paid. Reload the page to see it." });
  try {
    const out = await markInvoicePaidByTransfer(inv.id, paidOn, actorOf(claims));
    if (!out) return res.status(404).json({ error: NOT_FOUND });
    return res.status(200).json({ id: inv.id, outcome: out.outcome, donationId: out.donationId });
  } catch (err) {
    console.error("admin invoices: marking paid failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "That could not be saved. Please try again." });
  }
}

export async function postCancelInvoice(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "donations", "edit");
  if (!claims) return;
  res.setHeader("Cache-Control", "no-store");
  const id = idOf(req.params.id);
  if (!id) return res.status(404).json({ error: NOT_FOUND });
  try {
    const out = await cancelInvoice(id, actorOf(claims));
    if (!out) return res.status(409).json({ error: "Only an invoice that is still waiting can be cancelled. Reload the page to see it." });
    return res.status(200).json({ id: out.id });
  } catch (err) {
    console.error("admin invoices: cancelling failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "That could not be saved. Please try again." });
  }
}

export async function putInvoiceBank(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "donations", "edit");
  if (!claims) return;
  res.setHeader("Cache-Control", "no-store");
  const body = (req.body ?? {}) as Record<string, unknown>;
  let bank = null;
  if (body.clear !== true) {
    const parsed = bankDetailsSchema.safeParse({
      accountName: body.accountName ?? "",
      sortCode: String(body.sortCode ?? ""),
      accountNumber: String(body.accountNumber ?? ""),
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return res.status(400).json({ error: issue?.message ?? "Check the bank details.", field: String(issue?.path[0] ?? "") });
    }
    bank = parsed.data;
  }
  try {
    await saveInvoiceSettings(bank, actorOf(claims));
    return res.status(200).json({ bank });
  } catch (err) {
    console.error("admin invoices: bank details failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "The bank details could not be saved. Please try again." });
  }
}

// --- the private page ---------------------------------------------------------------------------

const publicLimiter = createRateLimiter({ max: 20, windowMs: 60 * 60 * 1000 });

function isLoopback(req: Request): boolean {
  const ip = req.ip ?? "";
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

async function invoiceFromLink(req: Request): Promise<InvoiceRow | null> {
  let id: number;
  try {
    id = verifyDonationInvoiceToken(String(req.params.token ?? ""), config.ADMIN_SESSION_SECRET);
  } catch {
    return null;
  }
  return getInvoice(id);
}

async function sendPage(
  res: Response,
  status: number,
  inv: InvoiceRow,
  token: string,
  o: { justPaid?: boolean; message?: string | null; giftAid?: Partial<DeclarationFields> | null } = {},
): Promise<void> {
  const state = displayState(inv, today());
  const bank = isPayable(state) ? await getInvoiceSettings().catch(() => null) : null;
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res
    .status(status)
    .type("html")
    .send(
      renderDonationInvoicePage({
        number: invoiceNumber(inv.id),
        token,
        issuedOn: inv.issuedOn,
        dueOn: inv.dueOn,
        state,
        paidOn: inv.paidOn,
        paidBy: inv.paidBy,
        payerKind: inv.payerKind,
        contactName: inv.contactName,
        orgName: inv.orgName,
        address: inv.address,
        postcode: inv.postcode,
        description: inv.description,
        note: inv.note,
        amountPence: inv.amountPence,
        bank,
        giftAid: o.giftAid !== undefined ? o.giftAid : inv.giftAid,
        justPaid: Boolean(o.justPaid),
        message: o.message ?? null,
      }),
    );
}

function notFound(res: Response): void {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.status(404).type("text").send("Not found");
}

/** What the person typed in the Gift Aid box: null when unticked, else the fields or what was wrong. */
function giftAidPosted(body: Record<string, unknown>): { ticked: false } | { ticked: true; fields: DeclarationFields | null; typed: Partial<DeclarationFields> } {
  if (body.giftAid !== "yes") return { ticked: false };
  const s = (k: string) => (typeof body[k] === "string" ? String(body[k]).trim() : "");
  const typed = {
    firstName: s("firstName"),
    lastName: s("lastName"),
    houseNameNumber: s("houseNameNumber"),
    address: s("address"),
    postcode: s("postcode").toUpperCase(),
    nonUk: false,
  };
  const parsed = declarationFieldsSchema.safeParse(typed);
  return { ticked: true, fields: parsed.success ? parsed.data : null, typed };
}

export async function getInvoicePage(req: Request, res: Response): Promise<void> {
  try {
    const inv = await invoiceFromLink(req);
    if (!inv) return notFound(res);
    await sendPage(res, 200, inv, String(req.params.token), { justPaid: req.query.paid === "1" });
  } catch (err) {
    console.error("invoice page failed:", err instanceof Error ? err.message : err);
    res.status(500).type("text").send("Sorry, this invoice could not be shown just now. Please try again in a few minutes.");
  }
}

export async function postInvoicePay(req: Request, res: Response): Promise<void> {
  if (!isLoopback(req) && !publicLimiter.allow(req.ip ?? "unknown", Date.now())) {
    res.status(429).type("text").send("Too many tries. Please wait a while and try again.");
    return;
  }
  const token = String(req.params.token ?? "");
  try {
    const inv = await invoiceFromLink(req);
    if (!inv) return notFound(res);
    if (!isPayable(displayState(inv, today()))) {
      return sendPage(res, 409, inv, token, { message: "This invoice can no longer be paid. It is shown as it stands now." });
    }
    if (inv.payerKind === "person") {
      const ga = giftAidPosted((req.body ?? {}) as Record<string, unknown>);
      if (ga.ticked && !ga.fields) return sendPage(res, 400, inv, token, { message: GIFT_AID_INCOMPLETE, giftAid: ga.typed });
      await saveGiftAid(inv.id, ga.ticked ? ga.fields : null);
    }
    const { stripe } = await import("../clients/stripe");
    const params = buildInvoiceSessionParams({
      invoiceId: inv.id,
      number: invoiceNumber(inv.id),
      amountPence: inv.amountPence,
      description: inv.description,
      email: inv.email,
      baseUrl: config.PORTAL_BASE_URL,
      token,
    });
    let session;
    try {
      // One session a minute per invoice, so a double click reuses it.
      session = await stripe.checkout.sessions.create(params, { idempotencyKey: `donation-invoice-${inv.id}-${Math.floor(Date.now() / 60_000)}` });
    } catch (err) {
      console.error("invoice checkout failed:", err instanceof Error ? err.message : err);
      return sendPage(res, 502, inv, token, { message: CARD_DOWN });
    }
    res.redirect(303, session.url ?? `/invoice/${token}`);
  } catch (err) {
    console.error("invoice pay failed:", err instanceof Error ? err.message : err);
    res.status(500).type("text").send("Sorry, something went wrong. Please try again in a few minutes.");
  }
}

export async function postInvoiceGiftAid(req: Request, res: Response): Promise<void> {
  if (!isLoopback(req) && !publicLimiter.allow(req.ip ?? "unknown", Date.now())) {
    res.status(429).type("text").send("Too many tries. Please wait a while and try again.");
    return;
  }
  const token = String(req.params.token ?? "");
  try {
    const inv = await invoiceFromLink(req);
    if (!inv) return notFound(res);
    if (inv.payerKind !== "person" || !isPayable(displayState(inv, today()))) {
      return sendPage(res, 409, inv, token, { message: "Gift Aid cannot be added to this invoice." });
    }
    const ga = giftAidPosted((req.body ?? {}) as Record<string, unknown>);
    if (ga.ticked && !ga.fields) return sendPage(res, 400, inv, token, { message: GIFT_AID_INCOMPLETE, giftAid: ga.typed });
    await saveGiftAid(inv.id, ga.ticked ? ga.fields : null);
    res.redirect(303, `/invoice/${token}#pay-h`);
  } catch (err) {
    console.error("invoice gift aid failed:", err instanceof Error ? err.message : err);
    res.status(500).type("text").send("Sorry, something went wrong. Please try again in a few minutes.");
  }
}

const form = express.urlencoded({ extended: false, limit: "10kb" });

export const invoicesRouter = Router();
invoicesRouter.get("/api/admin/invoices", getAdminInvoices);
invoicesRouter.post("/api/admin/invoices", postAdminInvoice);
invoicesRouter.put("/api/admin/invoices/bank", putInvoiceBank);
invoicesRouter.post("/api/admin/invoices/:id/resend", postResendInvoice);
invoicesRouter.post("/api/admin/invoices/:id/mark-paid", postMarkInvoicePaid);
invoicesRouter.post("/api/admin/invoices/:id/cancel", postCancelInvoice);
invoicesRouter.get("/invoice/:token", getInvoicePage);
invoicesRouter.post("/invoice/:token/pay", form, postInvoicePay);
invoicesRouter.post("/invoice/:token/gift-aid", form, postInvoiceGiftAid);
