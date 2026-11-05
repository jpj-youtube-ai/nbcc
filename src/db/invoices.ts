import type { PoolClient } from "pg";
import { pool } from "./pool";
import { insertAudit, insertDonorAndDonation, writeWithAudit } from "./donations";
import { config } from "../config";
import type { BankDetails } from "../ball/transfer";
import type { DeclarationFields } from "../declarations/fields";
import { invoiceNumber, type InvoiceInput, type InvoiceStatus, type PayerKind } from "../invoices/model";
import { donationWrite, receiptPlan, settleKind, type SettleKind } from "../invoices/settle";
import { signDonationInvoiceToken } from "../invoices/token";
import { buildGroupReceiptEmail, buildInvoiceStaffEmail, buildInvoicesPaidTwiceNote, invoiceLink } from "../invoices/emails";
import { buildDonationConfirmation, donationReference } from "../donors/confirmation";
import { buildCorporationTaxReceipt } from "../donors/receipt";
import { sendCompanyReceipt, sendDonationConfirmation, sendInvoiceReceipt, sendInvoiceStaff } from "../clients/email";

// Invoices for donations: storage (migrations/1791200000330_donation-invoices.js) and the one path a
// payment takes, card or bank transfer, to become a donation (settleInvoice). Every change is audited.

export interface InvoiceRow {
  id: number;
  payerKind: PayerKind;
  contactName: string;
  orgName: string | null;
  email: string;
  address: string | null;
  postcode: string | null;
  considerationGiven: boolean | null;
  description: string;
  note: string | null;
  amountPence: number;
  issuedOn: string;
  dueOn: string;
  status: InvoiceStatus;
  paidOn: string | null;
  paidBy: "card" | "transfer" | null;
  donationId: number | null;
  cancelledAt: string | null;
  paidTwiceAt: string | null;
  giftAid: Partial<DeclarationFields> | null;
  giftAidAt: string | null;
  sendCount: number;
  lastSentAt: string | null;
  createdBy: string;
  createdAt: string;
}

// Dates come back as YYYY-MM-DD text and moments as ISO text, so nothing depends on the server's zone.
const COLUMNS = `id, payer_kind, contact_name, org_name, email, address, postcode, consideration_given, description,
  note, amount_pence, issued_on::text AS issued_on, due_on::text AS due_on, status, paid_on::text AS paid_on, paid_by,
  donation_id, to_char(cancelled_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS cancelled_at,
  to_char(paid_twice_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS paid_twice_at, gift_aid,
  to_char(gift_aid_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS gift_aid_at, send_count,
  to_char(last_sent_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS last_sent_at, created_by,
  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at`;

type Raw = Record<string, unknown>;

export function rowFrom(r: Raw): InvoiceRow {
  return {
    id: Number(r.id),
    payerKind: r.payer_kind as PayerKind,
    contactName: String(r.contact_name),
    orgName: (r.org_name as string | null) ?? null,
    email: String(r.email),
    address: (r.address as string | null) ?? null,
    postcode: (r.postcode as string | null) ?? null,
    considerationGiven: (r.consideration_given as boolean | null) ?? null,
    description: String(r.description),
    note: (r.note as string | null) ?? null,
    amountPence: Number(r.amount_pence),
    issuedOn: String(r.issued_on),
    dueOn: String(r.due_on),
    status: r.status as InvoiceStatus,
    paidOn: (r.paid_on as string | null) ?? null,
    paidBy: (r.paid_by as "card" | "transfer" | null) ?? null,
    donationId: r.donation_id == null ? null : Number(r.donation_id),
    cancelledAt: (r.cancelled_at as string | null) ?? null,
    paidTwiceAt: (r.paid_twice_at as string | null) ?? null,
    giftAid: (r.gift_aid as Partial<DeclarationFields> | null) ?? null,
    giftAidAt: (r.gift_aid_at as string | null) ?? null,
    sendCount: Number(r.send_count ?? 0),
    lastSentAt: (r.last_sent_at as string | null) ?? null,
    createdBy: String(r.created_by),
    createdAt: String(r.created_at),
  };
}

export async function listInvoices(): Promise<InvoiceRow[]> {
  const res = await pool.query(`SELECT ${COLUMNS} FROM donation_invoices ORDER BY id DESC`);
  return res.rows.map(rowFrom);
}

export async function getInvoice(id: number): Promise<InvoiceRow | null> {
  const res = await pool.query(`SELECT ${COLUMNS} FROM donation_invoices WHERE id = $1`, [id]);
  return res.rows[0] ? rowFrom(res.rows[0]) : null;
}

export async function createInvoice(input: InvoiceInput, issuedOn: string, actor: string): Promise<InvoiceRow> {
  return writeWithAudit(
    async (client) => {
      const res = await client.query(
        `INSERT INTO donation_invoices
           (payer_kind, contact_name, org_name, email, address, postcode, consideration_given, description, note,
            amount_pence, issued_on, due_on, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13)
         RETURNING ${COLUMNS}`,
        [
          input.payerKind,
          input.contactName,
          input.orgName,
          input.email,
          input.address,
          input.postcode,
          input.considerationGiven,
          input.description,
          input.note,
          input.amountPence,
          issuedOn,
          input.dueOn,
          actor,
        ],
      );
      return rowFrom(res.rows[0]);
    },
    (inv) => ({
      actor,
      action: "invoice.created",
      entity: "donation_invoice",
      entityId: inv.id,
      data: { number: invoiceNumber(inv.id), payerKind: inv.payerKind, amountPence: inv.amountPence, dueOn: inv.dueOn },
    }),
  );
}

/** The invoice was emailed (first time or again). */
export async function markSent(id: number, actor: string): Promise<void> {
  await writeWithAudit(
    async (client) => {
      await client.query(
        `UPDATE donation_invoices SET send_count = send_count + 1, last_sent_at = now() WHERE id = $1`,
        [id],
      );
      return id;
    },
    () => ({ actor, action: "invoice.sent", entity: "donation_invoice", entityId: id }),
  );
}

/** Cancel a waiting invoice. Null when there is no such invoice or it is no longer waiting. */
export async function cancelInvoice(id: number, actor: string): Promise<InvoiceRow | null> {
  const NOT_WAITING = Symbol("not waiting");
  try {
    return await writeWithAudit(
      async (client) => {
        const res = await client.query(
          `UPDATE donation_invoices SET status = 'cancelled', cancelled_at = now(), updated_by = $2, updated_at = now()
            WHERE id = $1 AND status = 'waiting' RETURNING ${COLUMNS}`,
          [id, actor],
        );
        if (!res.rows[0]) throw NOT_WAITING;
        return rowFrom(res.rows[0]);
      },
      (inv) => ({ actor, action: "invoice.cancelled", entity: "donation_invoice", entityId: inv.id, data: { number: invoiceNumber(inv.id) } }),
    );
  } catch (err) {
    if (err === NOT_WAITING) return null;
    throw err;
  }
}

export type SaveGiftAidResult = "saved" | "cleared" | "not-person" | "not-waiting" | "missing";

/** Keep (or clear) a person's Gift Aid declaration with their invoice until it is paid. */
export async function saveGiftAid(id: number, fields: DeclarationFields | null): Promise<SaveGiftAidResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const cur = await client.query(`SELECT payer_kind, status FROM donation_invoices WHERE id = $1 FOR UPDATE`, [id]);
    const row = cur.rows[0] as { payer_kind: string; status: string } | undefined;
    let result: SaveGiftAidResult;
    if (!row) result = "missing";
    else if (row.payer_kind !== "person") result = "not-person";
    else if (row.status !== "waiting") result = "not-waiting";
    else {
      await client.query(
        `UPDATE donation_invoices SET gift_aid = $2::jsonb, gift_aid_at = CASE WHEN $2::jsonb IS NULL THEN NULL ELSE now() END WHERE id = $1`,
        [id, fields ? JSON.stringify(fields) : null],
      );
      await insertAudit(client, {
        actor: "public",
        action: fields ? "invoice.gift_aid_saved" : "invoice.gift_aid_cleared",
        entity: "donation_invoice",
        entityId: id,
      });
      result = fields ? "saved" : "cleared";
    }
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function getInvoiceSettings(): Promise<BankDetails | null> {
  const res = await pool.query(`SELECT account_name, sort_code, account_number FROM donation_invoice_settings WHERE id = 1`);
  const r = res.rows[0] as { account_name: string | null; sort_code: string | null; account_number: string | null } | undefined;
  if (!r || !r.account_name || !r.sort_code || !r.account_number) return null;
  return { accountName: r.account_name, sortCode: r.sort_code, accountNumber: r.account_number };
}

export async function saveInvoiceSettings(bank: BankDetails | null, actor: string): Promise<void> {
  await writeWithAudit(
    async (client) => {
      await client.query(
        `INSERT INTO donation_invoice_settings (id, account_name, sort_code, account_number, updated_by, updated_at)
         VALUES (1, $1, $2, $3, $4, now())
         ON CONFLICT (id) DO UPDATE SET account_name = $1, sort_code = $2, account_number = $3, updated_by = $4, updated_at = now()`,
        [bank?.accountName ?? null, bank?.sortCode ?? null, bank?.accountNumber ?? null, actor],
      );
      return null;
    },
    // Never the account number itself in the log: only that the details were set or cleared.
    () => ({ actor, action: "invoice_settings.updated", entity: "donation_invoice_settings", entityId: 1, data: { set: Boolean(bank) } }),
  );
}

/** The private link to an invoice. */
export function linkFor(id: number): string {
  return invoiceLink(signDonationInvoiceToken(id, config.ADMIN_SESSION_SECRET), config.PORTAL_BASE_URL);
}

export interface SettleOutcome {
  outcome: SettleKind | "already-recorded" | "refused";
  donationId: number | null;
  invoice: InvoiceRow;
  /** The receipt, to send AFTER the transaction commits. Never throws. */
  receipt: () => Promise<void>;
}

const nothing = async (): Promise<void> => {};

/**
 * One payment on an invoice becomes one donation, inside the caller's transaction. The invoice row is
 * locked, so a card payment and Mark paid at the same moment are taken one after the other. A Stripe
 * session already recorded against this invoice (a redelivery under a new event id) records nothing.
 * Null when there is no such invoice.
 */
export async function settleInvoice(
  client: PoolClient,
  id: number,
  pay: {
    by: "card" | "transfer";
    paidOn: string;
    sessionId: string | null;
    paymentIntentId: string | null;
    actor: string;
    /** Mark paid: an invoice already paid is refused here, inside the lock, so two presses never record one transfer twice. */
    refuseIfPaid?: boolean;
  },
): Promise<SettleOutcome | null> {
  const cur = await client.query(`SELECT ${COLUMNS} FROM donation_invoices WHERE id = $1 FOR UPDATE`, [id]);
  if (!cur.rows[0]) return null;
  const inv = rowFrom(cur.rows[0]);
  if (pay.refuseIfPaid && inv.status === "paid") return { outcome: "refused", donationId: null, invoice: inv, receipt: nothing };

  if (pay.sessionId) {
    const seen = await client.query(`SELECT id FROM donations WHERE invoice_id = $1 AND stripe_session_id = $2 LIMIT 1`, [id, pay.sessionId]);
    if (seen.rows[0]) return { outcome: "already-recorded", donationId: Number(seen.rows[0].id), invoice: inv, receipt: nothing };
  }

  const kind = settleKind(inv.status);
  const write = donationWrite(inv, { sessionId: pay.sessionId, paymentIntentId: pay.paymentIntentId }, kind);
  const made = await insertDonorAndDonation(client, write.donor, write.donation, write.declaration);
  // The payment's own date, and where it came from, on the donation itself.
  await client.query(
    `UPDATE donations SET source = 'invoice', invoice_id = $2, created_at = CASE WHEN $3 = 'transfer' THEN ($4::date + time '12:00') AT TIME ZONE 'Europe/London' ELSE created_at END
      WHERE id = $1`,
    [made.donationId, id, pay.by, pay.paidOn],
  );

  let updated: InvoiceRow;
  if (kind === "paid-twice") {
    const res = await client.query(
      `UPDATE donation_invoices SET paid_twice_at = now(), paid_twice_alerted_at = NULL, updated_by = $2, updated_at = now()
        WHERE id = $1 RETURNING ${COLUMNS}`,
      [id, pay.actor],
    );
    updated = rowFrom(res.rows[0]);
  } else {
    const res = await client.query(
      `UPDATE donation_invoices SET status = 'paid', paid_on = $2, paid_by = $3, donation_id = $4, updated_by = $5, updated_at = now()
        WHERE id = $1 RETURNING ${COLUMNS}`,
      [id, pay.paidOn, pay.by, made.donationId, pay.actor],
    );
    updated = rowFrom(res.rows[0]);
  }

  const plan = receiptPlan(inv);
  await insertAudit(client, {
    actor: pay.actor,
    action: kind === "paid-twice" ? "invoice.paid_twice" : "invoice.paid",
    entity: "donation_invoice",
    entityId: id,
    data: { number: invoiceNumber(id), by: pay.by, paidOn: pay.paidOn, donationId: made.donationId, afterCancel: kind === "paid-after-cancel" },
  });
  if (plan === "trustees") {
    // The same flag the Donate page leaves for a business gift with something given in return.
    await insertAudit(client, {
      actor: pay.actor,
      action: "donation.flagged_for_trustees",
      entity: "donation",
      entityId: made.donationId,
      data: { reason: "consideration_given", legalName: inv.orgName, invoice: invoiceNumber(id) },
    });
  }

  const receipt = async (): Promise<void> => {
    try {
      await sendReceipt(updated, plan, made.donationId, pay.paidOn, write.donation.giftAid);
    } catch (err) {
      console.error("invoice receipt failed:", err instanceof Error ? err.message : err);
    }
  };
  return { outcome: kind, donationId: made.donationId, invoice: updated, receipt };
}

async function sendReceipt(
  inv: InvoiceRow,
  plan: ReturnType<typeof receiptPlan>,
  donationId: number,
  paidOn: string,
  giftAid: boolean,
): Promise<void> {
  const number = invoiceNumber(inv.id);
  const url = linkFor(inv.id);
  if (plan === "person") {
    const c = buildDonationConfirmation({
      fullName: inv.contactName,
      amountPence: inv.amountPence,
      giftAid,
      mode: "once",
      reference: donationReference(donationId),
      donationDate: paidOn,
      invoice: { number, url },
    });
    await sendDonationConfirmation({ email: inv.email, fullName: inv.contactName, amountPence: inv.amountPence, currency: "GBP", ...c });
  } else if (plan === "business") {
    const r = buildCorporationTaxReceipt({
      legalName: inv.orgName ?? inv.contactName,
      amountPence: inv.amountPence,
      donationDate: paidOn,
      invoice: { number, url },
    });
    await sendCompanyReceipt({ email: inv.email, legalName: inv.orgName ?? inv.contactName, amountPence: inv.amountPence, currency: "GBP", ...r });
  } else if (plan === "group") {
    const e = buildGroupReceiptEmail({
      number,
      orgName: inv.orgName ?? inv.contactName,
      contactName: inv.contactName,
      amountPence: inv.amountPence,
      paidOn,
      link: url,
      reference: donationReference(donationId),
    });
    await sendInvoiceReceipt({ email: inv.email, name: inv.orgName, ...e });
  }
}

/** Staff pressed Mark paid: a bank transfer arrived on paidOn. Its own transaction; receipt after commit. */
export async function markInvoicePaidByTransfer(id: number, paidOn: string, actor: string): Promise<SettleOutcome | null> {
  const client = await pool.connect();
  let out: SettleOutcome | null;
  try {
    await client.query("BEGIN");
    out = await settleInvoice(client, id, { by: "transfer", paidOn, sessionId: null, paymentIntentId: null, actor, refuseIfPaid: true });
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  if (out) await out.receipt();
  return out;
}

/** Tell the giving inbox about every invoice paid twice that it has not yet been told about. Never throws. */
export async function sendInvoicesPaidTwiceAlert(): Promise<number> {
  try {
    const res = await pool.query(
      `SELECT id, COALESCE(org_name, contact_name) AS who, amount_pence FROM donation_invoices
        WHERE paid_twice_at IS NOT NULL AND paid_twice_alerted_at IS NULL ORDER BY id`,
    );
    const rows = res.rows as { id: number; who: string; amount_pence: number }[];
    if (rows.length === 0) return 0;
    const note = buildInvoicesPaidTwiceNote(
      rows.map((r) => ({ number: invoiceNumber(Number(r.id)), orgOrName: r.who, amountPence: Number(r.amount_pence) })),
    );
    const adminUrl = `${config.PORTAL_BASE_URL.replace(/\/+$/, "")}/admin`;
    await sendInvoiceStaff(buildInvoiceStaffEmail({ ...note, adminUrl }));
    await pool.query(`UPDATE donation_invoices SET paid_twice_alerted_at = now() WHERE id = ANY($1::int[])`, [rows.map((r) => Number(r.id))]);
    return rows.length;
  } catch (err) {
    console.error("invoices paid twice alert failed:", err instanceof Error ? err.message : err);
    return 0;
  }
}
