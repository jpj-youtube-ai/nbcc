import type { PoolClient } from "pg";
import type Stripe from "stripe";
import { pool } from "./pool";
import { insertAudit } from "./donations";
import { eraseEmailLogFor } from "./email-log";
import { londonToday } from "../events/model";
import {
  PLEDGE_EMAIL_LOG_KINDS,
  doublePaidCount,
  pledgeDeclarationWording,
  unpaidTwoWeeksOn,
  type PledgeEmailKind,
  type PledgeFundraiser,
  type PledgeInput,
  type PledgeRow,
  type PledgeStatus,
} from "../pledges/model";

// Sponsor pledges (Jaimie, 2026-10-03): the SQL. The rules are in src/pledges/model.ts; this file only
// moves rows (migrations/1791200000220_sponsor-pledges.js). A pledge is a promise, never money: nothing
// here writes a donation. The donation is made by the Stripe webhook when the pledge is paid, and
// settlePledge marks the pledge paid inside that same transaction. Every change writes its audit_log
// row (entity "sponsor_pledge") in the same transaction, never with a sponsor's name or address in it.

type Row = Record<string, unknown>;
const iso = (v: unknown): string | null => (v == null ? null : new Date(v as string).toISOString());
const text = (v: unknown): string | null => (v == null ? null : String(v));

/** A stored pledge, with what only the server and staff may see. */
export interface PledgeRecord extends PledgeRow {
  tokenNonce: string;
  gaHouse: string | null;
  gaAddress: string | null;
  gaPostcode: string | null;
  gaNonUk: boolean;
  gaWordingVersion: string | null;
  gaWordingSnapshot: string | null;
  gaDeclaredAt: string | null;
  donationId: number | null;
  /** The Stripe checkout last opened for it, to close before another is opened. */
  checkoutSessionId?: string | null;
  payEmailResends?: number;
}

// A claim with no send behind it after an hour is stale (the task died part way): it reads as not
// claimed, so the next run sends it. "refunded": paid online, and that donation has since been
// refunded in full.
const staleClaim = (claimed: string, sent: string) =>
  `CASE WHEN p.${sent} IS NULL AND p.${claimed} < now() - interval '1 hour' THEN NULL ELSE p.${claimed} END AS ${claimed}`;
const COLUMNS = `p.id, p.fundraiser_id, p.first_name, p.surname, p.email, p.amount_pence, p.message, p.message_hidden, p.show_name,
  p.show_amount, p.gift_aid, p.ga_house, p.ga_address, p.ga_postcode, p.ga_non_uk, p.ga_wording_version, p.ga_wording_snapshot,
  p.ga_declared_at, p.status, p.token_nonce, p.created_at, p.confirmed_at, p.hidden_at,
  ${staleClaim("pay_email_claimed_at", "pay_email_sent_at")}, p.pay_email_sent_at,
  ${staleClaim("reminder_claimed_at", "reminder_sent_at")}, p.reminder_sent_at,
  p.pay_email_last_sent_at, p.pay_email_resends, p.checkout_session_id,
  p.paid_at, p.paid_amount_pence, p.donation_id, p.declaration_id, p.double_paid_at, p.double_paid_checked_at,
  p.cash_marked_at, p.cancelled_at, p.anonymised_at,
  COALESCE((SELECT d.amount_pence <= d.refunded_amount_pence FROM donations d WHERE d.id = p.donation_id), false) AS refunded`;

export function toPledge(r: Row): PledgeRecord {
  return {
    id: Number(r.id),
    fundraiserId: Number(r.fundraiser_id),
    firstName: text(r.first_name),
    surname: text(r.surname),
    email: text(r.email),
    amountPence: Number(r.amount_pence),
    message: text(r.message),
    messageHidden: r.message_hidden === true,
    showName: r.show_name === true,
    showAmount: r.show_amount !== false,
    giftAid: r.gift_aid === true,
    status: String(r.status) as PledgeStatus,
    createdAt: iso(r.created_at) as string,
    confirmedAt: iso(r.confirmed_at),
    hiddenAt: iso(r.hidden_at),
    payEmailClaimedAt: iso(r.pay_email_claimed_at),
    payEmailSentAt: iso(r.pay_email_sent_at),
    reminderClaimedAt: iso(r.reminder_claimed_at),
    reminderSentAt: iso(r.reminder_sent_at),
    payEmailLastSentAt: iso(r.pay_email_last_sent_at),
    payEmailResends: Number(r.pay_email_resends ?? 0),
    checkoutSessionId: text(r.checkout_session_id),
    paidAt: iso(r.paid_at),
    paidAmountPence: r.paid_amount_pence == null ? null : Number(r.paid_amount_pence),
    doublePaidAt: iso(r.double_paid_at),
    doublePaidCheckedAt: iso(r.double_paid_checked_at),
    cashMarkedAt: iso(r.cash_marked_at),
    cancelledAt: iso(r.cancelled_at),
    anonymisedAt: iso(r.anonymised_at),
    refunded: r.refunded === true,
    tokenNonce: String(r.token_nonce ?? ""),
    gaHouse: text(r.ga_house),
    gaAddress: text(r.ga_address),
    gaPostcode: text(r.ga_postcode),
    gaNonUk: r.ga_non_uk === true,
    gaWordingVersion: text(r.ga_wording_version),
    gaWordingSnapshot: text(r.ga_wording_snapshot),
    gaDeclaredAt: iso(r.ga_declared_at),
    donationId: r.donation_id == null ? null : Number(r.donation_id),
  };
}

async function inTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

const audit = (client: PoolClient, actor: string, action: string, pledgeId: number, data: Record<string, unknown>) =>
  insertAudit(client, { actor, action, entity: "sponsor_pledge", entityId: pledgeId, data });

// A fresh nonce, made by the database: every link already emailed for the pledge stops working. It
// only has to change (the signature's secret is what keeps a link from being forged).
const NEW_NONCE = "md5(random()::text || clock_timestamp()::text || id::text)";

// --- making one, and confirming it -----------------------------------------------------------------

/**
 * Store a pledge, UNCONFIRMED: it counts for nothing until its sponsor confirms it by email. With
 * Gift Aid, its declaration is kept exactly as worded for that amount (pledgeDeclarationWording),
 * dated now by the database. The same person pledging the same amount on the same page within ten
 * minutes (a second press of the button) makes no second pledge, and gets no second email.
 */
export async function createPledge(fundraiserId: number, p: PledgeInput, nonce: string): Promise<{ pledge: PledgeRecord; duplicate: boolean }> {
  return inTransaction(async (client) => {
    const same = await client.query(
      `SELECT ${COLUMNS} FROM sponsor_pledges p
        WHERE p.fundraiser_id = $1 AND lower(p.email) = $2 AND p.amount_pence = $3 AND p.status IN ('unconfirmed', 'open')
          AND p.created_at > now() - interval '10 minutes'
        ORDER BY p.id DESC LIMIT 1`,
      [fundraiserId, p.email, p.amountPence],
    );
    if (same.rows[0]) return { pledge: toPledge(same.rows[0]), duplicate: true };
    const wording = p.giftAid ? pledgeDeclarationWording(p.amountPence) : null;
    const r = await client.query(
      `INSERT INTO sponsor_pledges AS p
         (fundraiser_id, first_name, surname, email, amount_pence, message, show_name, show_amount, gift_aid,
          ga_house, ga_address, ga_postcode, ga_non_uk, ga_wording_version, ga_wording_snapshot, ga_declared_at, token_nonce, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, CASE WHEN $9 THEN now() END, $16, 'unconfirmed')
       RETURNING ${COLUMNS}`,
      [
        fundraiserId,
        p.firstName,
        p.surname,
        p.email,
        p.amountPence,
        p.message,
        p.showName,
        p.showAmount,
        p.giftAid,
        p.house,
        p.address,
        p.postcode,
        p.nonUk,
        wording?.wording_version ?? null,
        wording?.wording_snapshot ?? null,
        nonce,
      ],
    );
    const pledge = toPledge(r.rows[0]);
    await audit(client, "public", "pledge.created", pledge.id, { fundraiserId, amountPence: p.amountPence, giftAid: p.giftAid });
    return { pledge, duplicate: false };
  });
}

/** The confirm email went. */
export async function markConfirmEmailSent(id: number): Promise<void> {
  await pool.query("UPDATE sponsor_pledges SET confirm_email_sent_at = now() WHERE id = $1", [id]);
}

/** The sponsor pressed Confirm: the pledge is open. True when it was confirmed now. */
export async function confirmPledge(id: number): Promise<boolean> {
  return inTransaction(async (client) => {
    const r = await client.query(
      "UPDATE sponsor_pledges SET status = 'open', confirmed_at = now() WHERE id = $1 AND status = 'unconfirmed' RETURNING fundraiser_id",
      [id],
    );
    if (!r.rows[0]) return false;
    await audit(client, "sponsor", "pledge.confirmed", id, { fundraiserId: Number(r.rows[0].fundraiser_id) });
    return true;
  });
}

/**
 * Delete a pledge its sponsor never confirmed, outright, with the log rows of the email sent about
 * it. Only ever an unconfirmed one. True when it was deleted.
 */
export async function deleteUnconfirmedPledge(id: number): Promise<boolean> {
  const email = await inTransaction(async (client) => {
    const r = await client.query("DELETE FROM sponsor_pledges WHERE id = $1 AND status = 'unconfirmed' RETURNING fundraiser_id, email", [id]);
    if (!r.rows[0]) return undefined;
    await audit(client, "system:schedule", "pledge.unconfirmed_deleted", id, { fundraiserId: Number(r.rows[0].fundraiser_id) });
    return text(r.rows[0].email);
  });
  if (email === undefined) return false;
  if (email) await eraseEmailLogFor(email, PLEDGE_EMAIL_LOG_KINDS);
  return true;
}

// --- reading ---------------------------------------------------------------------------------------

export async function getPledge(id: number): Promise<PledgeRecord | null> {
  const r = await pool.query(`SELECT ${COLUMNS} FROM sponsor_pledges p WHERE p.id = $1`, [id]);
  return r.rows[0] ? toPledge(r.rows[0]) : null;
}

/** Every pledge on these fundraisers, newest first. Unconfirmed ones too: the caller decides. */
export async function listPledges(fundraiserIds: number[]): Promise<PledgeRecord[]> {
  if (fundraiserIds.length === 0) return [];
  const r = await pool.query(`SELECT ${COLUMNS} FROM sponsor_pledges p WHERE p.fundraiser_id = ANY($1) ORDER BY p.created_at DESC, p.id DESC`, [fundraiserIds]);
  return (r.rows as Row[]).map(toPledge);
}

/** A pledge with what the rules and the emails need to know about its fundraiser. */
export interface PledgeWithFundraiser {
  p: PledgeRecord;
  f: PledgeFundraiser & { title: string; slug: string; name: string };
}

const WITH_FUNDRAISER = `SELECT ${COLUMNS}, f.path AS f_path, f.public AS f_public, f.status AS f_status, f.kind AS f_kind,
    to_char(f.event_date, 'YYYY-MM-DD') AS f_event_date, f.is_team AS f_is_team, f.team_id AS f_team_id, f.in_memory AS f_in_memory,
    f.title AS f_title, f.slug AS f_slug, f.organiser_name AS f_name,
    (SELECT max(a.created_at) FROM audit_log a WHERE a.entity = 'fundraiser' AND a.entity_id = f.id AND a.action = 'fundraiser.finished') AS f_finished_at
  FROM sponsor_pledges p JOIN fundraisers f ON f.id = p.fundraiser_id`;

function toWithFundraiser(r: Row): PledgeWithFundraiser {
  return {
    p: toPledge(r),
    f: {
      id: Number(r.fundraiser_id),
      path: r.f_path as PledgeFundraiser["path"],
      public: r.f_public === true,
      status: r.f_status as PledgeFundraiser["status"],
      kind: String(r.f_kind ?? ""),
      eventDate: text(r.f_event_date),
      isTeam: r.f_is_team === true,
      teamId: r.f_team_id == null ? null : Number(r.f_team_id),
      inMemory: r.f_in_memory === true,
      finishedAt: iso(r.f_finished_at),
      title: String(r.f_title ?? ""),
      slug: String(r.f_slug ?? ""),
      name: String(r.f_name ?? ""),
    },
  };
}

export async function getPledgeWithFundraiser(id: number): Promise<PledgeWithFundraiser | null> {
  const r = await pool.query(`${WITH_FUNDRAISER} WHERE p.id = $1`, [id]);
  return r.rows[0] ? toWithFundraiser(r.rows[0]) : null;
}

/** Every pledge the daily pass may still act on: any whose details have not been removed. */
export async function readLivePledges(): Promise<PledgeWithFundraiser[]> {
  const r = await pool.query(`${WITH_FUNDRAISER} WHERE p.anonymised_at IS NULL AND (p.status <> 'paid' OR p.email IS NOT NULL) ORDER BY p.id`);
  return (r.rows as Row[]).map(toWithFundraiser);
}

/** Every pledge with its fundraiser, for staff. */
export async function readAllPledges(): Promise<PledgeWithFundraiser[]> {
  const r = await pool.query(`${WITH_FUNDRAISER} ORDER BY p.created_at DESC, p.id DESC`);
  return (r.rows as Row[]).map(toWithFundraiser);
}

/** How many pledges are still unpaid two weeks after their event, for the Monday summary. */
export async function countUnpaidPledges(now: Date): Promise<number> {
  const r = await pool.query(`${WITH_FUNDRAISER} WHERE p.status = 'open'`);
  return unpaidTwoWeeksOn((r.rows as Row[]).map(toWithFundraiser), londonToday(now));
}

/** How many pledges were paid twice and nobody has checked yet, for the Monday summary. */
export async function countDoublePaidPledges(): Promise<number> {
  const r = await pool.query("SELECT double_paid_at, double_paid_checked_at FROM sponsor_pledges WHERE double_paid_at IS NOT NULL AND double_paid_checked_at IS NULL");
  return doublePaidCount((r.rows as Row[]).map((x) => ({ doublePaidAt: iso(x.double_paid_at), doublePaidCheckedAt: iso(x.double_paid_checked_at) })));
}

// --- the two later emails, once each ---------------------------------------------------------------

const EMAIL_COLUMNS: Record<PledgeEmailKind, { claimed: string; sent: string; also: string }> = {
  pledge_pay: { claimed: "pay_email_claimed_at", sent: "pay_email_sent_at", also: "" },
  // The reminder only ever follows a pay email that went.
  pledge_reminder: { claimed: "reminder_claimed_at", sent: "reminder_sent_at", also: " AND pay_email_sent_at IS NOT NULL" },
};

/**
 * Claim one email for a pledge, BEFORE it is sent. True when this is the first claim, and the pledge
 * is still open: false when it has been claimed (or sent) before, so it can never go twice, even with
 * two runs at once. A claim with no send behind it after an hour (the task died part way) is stale,
 * and may be claimed again.
 */
export async function claimPledgeEmail(id: number, kind: PledgeEmailKind): Promise<boolean> {
  const c = EMAIL_COLUMNS[kind];
  const r = await pool.query(
    `UPDATE sponsor_pledges SET ${c.claimed} = now()
      WHERE id = $1 AND (${c.claimed} IS NULL OR (${c.sent} IS NULL AND ${c.claimed} < now() - interval '1 hour'))
        AND status = 'open'${c.also} RETURNING id`,
    [id],
  );
  return r.rows.length > 0;
}

/** The send failed: give the claim back, so a later run can try again. Never one that went. */
export async function releasePledgeEmail(id: number, kind: PledgeEmailKind): Promise<void> {
  const c = EMAIL_COLUMNS[kind];
  await pool.query(`UPDATE sponsor_pledges SET ${c.claimed} = NULL WHERE id = $1 AND ${c.sent} IS NULL`, [id]);
}

/**
 * It went: say so on the pledge and in History (never with the address). The FIRST time each went is
 * kept: a pay link staff send again by hand never restarts the reminder or the 90 day clocks.
 */
export async function markPledgeEmailSent(id: number, fundraiserId: number, kind: PledgeEmailKind, actor: string): Promise<void> {
  const c = EMAIL_COLUMNS[kind];
  const last = kind === "pledge_pay" ? ", pay_email_last_sent_at = now()" : "";
  await inTransaction(async (client) => {
    await client.query(
      `UPDATE sponsor_pledges SET ${c.sent} = COALESCE(${c.sent}, now()), ${c.claimed} = COALESCE(${c.claimed}, now())${last} WHERE id = $1`,
      [id],
    );
    await audit(client, actor, "pledge.email_sent", id, { fundraiserId, kind });
  });
}

/**
 * Staff sending the pay link by hand: hold the pledge for ten minutes, so two presses (or two people)
 * never send it twice, and count it apart from the first send. True when this press may send.
 */
export async function claimPayLinkResend(id: number): Promise<boolean> {
  const r = await pool.query(
    `UPDATE sponsor_pledges SET pay_email_last_sent_at = now(), pay_email_resends = pay_email_resends + 1
      WHERE id = $1 AND status = 'open' AND (pay_email_last_sent_at IS NULL OR pay_email_last_sent_at < now() - interval '10 minutes')
      RETURNING id`,
    [id],
  );
  return r.rows.length > 0;
}

/** That send failed: let it be tried again straight away. */
export async function releasePayLinkResend(id: number): Promise<void> {
  await pool.query("UPDATE sponsor_pledges SET pay_email_last_sent_at = pay_email_sent_at, pay_email_resends = GREATEST(pay_email_resends - 1, 0) WHERE id = $1", [id]);
}

// --- cancelling, cash, hiding ----------------------------------------------------------------------

/** Cancel a pledge that is still open; its emailed links stop working. True when it was cancelled now. */
export async function cancelPledge(id: number, by: string): Promise<boolean> {
  return inTransaction(async (client) => {
    const r = await client.query(
      `UPDATE sponsor_pledges SET status = 'cancelled', cancelled_at = now(), cancelled_by = $2, token_nonce = ${NEW_NONCE}
        WHERE id = $1 AND status = 'open' RETURNING fundraiser_id`,
      [id, by],
    );
    if (!r.rows[0]) return false;
    await audit(client, by, "pledge.cancelled", id, { fundraiserId: Number(r.rows[0].fundraiser_id) });
    return true;
  });
}

/**
 * The organiser says a sponsor paid them in cash (or, with paid false, that they did not after all).
 * Only for a pledge on THAT fundraiser: open to cash, or cash back to open while its details are
 * still there. Marked as cash, its home address goes at once: cash never has Gift Aid online. Put
 * back to open, it gets fresh links. Null when nothing changed.
 */
export async function markPledgeCash(fundraiserId: number, id: number, paid: boolean, by: string): Promise<PledgeRecord | null> {
  return inTransaction(async (client) => {
    const r = paid
      ? await client.query(
          `UPDATE sponsor_pledges AS p SET status = 'cash', cash_marked_at = now(), cash_marked_by = $3,
                  ga_house = NULL, ga_address = NULL, ga_postcode = NULL
            WHERE id = $1 AND fundraiser_id = $2 AND status = 'open' RETURNING ${COLUMNS}`,
          [id, fundraiserId, by],
        )
      : await client.query(
          `UPDATE sponsor_pledges AS p SET status = 'open', cash_marked_at = NULL, cash_marked_by = NULL, token_nonce = ${NEW_NONCE}
            WHERE id = $1 AND fundraiser_id = $2 AND status = 'cash' AND anonymised_at IS NULL RETURNING ${COLUMNS}`,
          [id, fundraiserId],
        );
    if (!r.rows[0]) return null;
    await audit(client, by, paid ? "pledge.cash_marked" : "pledge.cash_unmarked", id, { fundraiserId });
    return toPledge(r.rows[0]);
  });
}

/** The organiser takes a pledge on THEIR fundraiser off the page (or puts it back). Null when it is not theirs. */
export async function setPledgeHiddenByOrganiser(fundraiserId: number, id: number, hidden: boolean, by: string): Promise<PledgeRecord | null> {
  return inTransaction(async (client) => {
    const r = await client.query(
      `UPDATE sponsor_pledges AS p SET hidden_at = CASE WHEN $3 THEN now() END, hidden_by = CASE WHEN $3 THEN $4 END
        WHERE id = $1 AND fundraiser_id = $2 AND status <> 'unconfirmed' RETURNING ${COLUMNS}`,
      [id, fundraiserId, hidden, by],
    );
    if (!r.rows[0]) return null;
    await audit(client, by, hidden ? "pledge.hidden_by_organiser" : "pledge.shown_by_organiser", id, { fundraiserId });
    return toPledge(r.rows[0]);
  });
}

/** Staff hide (or show again) a pledge's message on the page, as they do a gift's. */
export async function setPledgeMessageHidden(fundraiserId: number, id: number, hidden: boolean, actor: string): Promise<boolean> {
  return inTransaction(async (client) => {
    const r = await client.query("UPDATE sponsor_pledges SET message_hidden = $3 WHERE id = $1 AND fundraiser_id = $2 RETURNING id", [id, fundraiserId, hidden]);
    if (!r.rows[0]) return false;
    await audit(client, actor, hidden ? "pledge.message_hidden" : "pledge.message_shown", id, { fundraiserId });
    return true;
  });
}

/** Remember the Stripe checkout just opened for a pledge, so the next one can close it first. */
export async function saveCheckoutSession(id: number, sessionId: string): Promise<void> {
  await pool.query("UPDATE sponsor_pledges SET checkout_session_id = $2 WHERE id = $1 AND status = 'open'", [id, sessionId]);
}

// --- paid ------------------------------------------------------------------------------------------

export interface PledgePayment {
  pledgeId: number;
  /** The donation itself, in pence: what Stripe took, less anything given to cover the card fee. */
  paidPence: number;
  /** When the Gift Aid declaration was made with the pledge, as the checkout stamped it (ISO), or null. */
  declaredAt: string | null;
}

type PledgeSession = Pick<Stripe.Checkout.Session, "metadata" | "amount_total">;

/**
 * The pledge a completed checkout session paid for, or null for every other session. Only the pay
 * page stamps metadata.pledgeId (src/routes/pledges.ts), from a signed link.
 */
export function pledgeFromSession(session: PledgeSession): PledgePayment | null {
  const md = session.metadata ?? {};
  const raw = md.pledgeId ?? "";
  if (!/^[1-9]\d{0,9}$/.test(raw) || Number(raw) > 2147483647) return null;
  const fee = /^\d{1,9}$/.test(md.feeCoverPence ?? "") ? Number(md.feeCoverPence) : 0;
  const stamped = md.pledgeDeclaredAt ?? "";
  const declaredAt = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(stamped) && !Number.isNaN(Date.parse(stamped)) ? new Date(stamped).toISOString() : null;
  return { pledgeId: Number(raw), paidPence: Math.max(0, (session.amount_total ?? 0) - fee), declaredAt };
}

/**
 * Before the webhook records a payment made from a pledge's pay link: if that pledge is ALREADY paid,
 * take Gift Aid off this second payment (the session's metadata is changed in place, before anything
 * reads it). One declaration covers one donation, so a second payment must never write a second
 * declaration; it is a mistake for staff to refund (settlePledge flags it). The pledge's row is
 * locked, so two payments arriving together are taken one after the other. Every other session, and
 * a first payment, is left exactly as it came.
 */
export async function guardPledgePayment(client: PoolClient, session: PledgeSession): Promise<void> {
  const payment = pledgeFromSession(session);
  if (!payment || !session.metadata) return;
  const r = await client.query("SELECT status FROM sponsor_pledges WHERE id = $1 FOR UPDATE", [payment.pledgeId]);
  if (r.rows[0]?.status !== "paid") return;
  const md = session.metadata;
  for (const key of Object.keys(md)) {
    if (key.startsWith("decl") && key !== "declarationScope") delete md[key];
  }
  delete md.giftAidWording;
  delete md.giftAidWordingVersion;
  delete md.pledgeDeclaredAt;
  delete md.declarationScope;
  md.giftAid = "false";
}

/**
 * Mark a pledge paid, inside the webhook's own transaction: the donation the payment made, the Gift
 * Aid declaration it carried, and what was paid. The home address is dropped from the pledge (the
 * declaration has it now), its links stop working, and when the declaration was made is kept in
 * sponsor_pledge_declarations, which nothing can delete from under it.
 *
 * A pledge already paid is left alone and FLAGGED (double_paid_at): the second payment is still a
 * donation, for staff to check and refund. So is one marked as paid in cash that is then paid
 * online. A payment for a pledge that is no longer there says so in History.
 */
export async function settlePledge(client: PoolClient, payment: PledgePayment, made: { donationId: number; declarationId: number | null; eventId: string }): Promise<void> {
  const found = await client.query(
    "SELECT status, fundraiser_id, gift_aid, ga_declared_at, ga_wording_version, ga_wording_snapshot FROM sponsor_pledges WHERE id = $1 FOR UPDATE",
    [payment.pledgeId],
  );
  const row = found.rows[0] as Row | undefined;
  const keep = async (declaredAt: string | null, version: string | null, snapshot: string | null) => {
    if (made.declarationId == null || !declaredAt) return;
    await client.query(
      `INSERT INTO sponsor_pledge_declarations (pledge_id, donation_id, declaration_id, declared_at, wording_version, wording_snapshot)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [payment.pledgeId, made.donationId, made.declarationId, declaredAt, version, snapshot],
    );
  };
  if (!row) {
    await audit(client, "stripe", "pledge.paid_missing", payment.pledgeId, { eventId: made.eventId, donationId: made.donationId, paidPence: payment.paidPence });
    await keep(payment.declaredAt, null, null);
    return;
  }
  const fundraiserId = Number(row.fundraiser_id);
  const flag = () => client.query("UPDATE sponsor_pledges SET double_paid_at = now(), double_paid_donation_id = $2, double_paid_checked_at = NULL WHERE id = $1", [payment.pledgeId, made.donationId]);
  if (row.status === "paid") {
    await flag();
    await audit(client, "stripe", "pledge.paid_again", payment.pledgeId, { eventId: made.eventId, fundraiserId, donationId: made.donationId, paidPence: payment.paidPence });
    return;
  }
  await client.query(
    `UPDATE sponsor_pledges SET status = 'paid', paid_at = now(), paid_amount_pence = $2, donation_id = $3, declaration_id = $4,
            ga_house = NULL, ga_address = NULL, ga_postcode = NULL, checkout_session_id = NULL, token_nonce = ${NEW_NONCE}
      WHERE id = $1`,
    [payment.pledgeId, payment.paidPence, made.donationId, made.declarationId],
  );
  const declaredAt = iso(row.ga_declared_at) ?? payment.declaredAt;
  const wasCash = row.status === "cash";
  if (wasCash) await flag();
  await audit(client, "stripe", "pledge.paid", payment.pledgeId, {
    eventId: made.eventId,
    fundraiserId,
    donationId: made.donationId,
    declarationId: made.declarationId,
    paidPence: payment.paidPence,
    giftAidDeclaredAt: made.declarationId != null ? declaredAt : null,
    ...(row.status !== "open" ? { paidAfter: String(row.status) } : {}),
  });
  await keep(declaredAt, text(row.ga_wording_version), text(row.ga_wording_snapshot));
}

/**
 * settlePledge behind a savepoint: whatever goes wrong marking the pledge, the donation the webhook
 * has just recorded stays. The failure is logged by pledge id; staff see the pledge still unpaid
 * beside a donation on the page.
 */
export async function settlePledgeSafely(client: PoolClient, payment: PledgePayment, made: { donationId: number; declarationId: number | null; eventId: string }): Promise<void> {
  await client.query("SAVEPOINT sponsor_pledge");
  try {
    await settlePledge(client, payment, made);
    await client.query("RELEASE SAVEPOINT sponsor_pledge");
  } catch (err) {
    console.error(`pledge ${payment.pledgeId} could not be marked paid; its donation ${made.donationId} is kept:`, err instanceof Error ? err.message : err);
    await client.query("ROLLBACK TO SAVEPOINT sponsor_pledge");
  }
}

/** guardPledgePayment behind a savepoint too: a failure there leaves the session as it came. */
export async function guardPledgePaymentSafely(client: PoolClient, session: PledgeSession): Promise<void> {
  if (!pledgeFromSession(session)) return;
  await client.query("SAVEPOINT sponsor_pledge_guard");
  try {
    await guardPledgePayment(client, session);
    await client.query("RELEASE SAVEPOINT sponsor_pledge_guard");
  } catch (err) {
    console.error("pledge payment could not be checked against its pledge:", err instanceof Error ? err.message : err);
    await client.query("ROLLBACK TO SAVEPOINT sponsor_pledge_guard");
  }
}

// --- paid twice ------------------------------------------------------------------------------------

/** Pledges paid twice that the events inbox has not been told about yet. */
export async function listDoublePaidToAlert(): Promise<PledgeWithFundraiser[]> {
  const r = await pool.query(`${WITH_FUNDRAISER} WHERE p.double_paid_at IS NOT NULL AND p.double_paid_alerted_at IS NULL ORDER BY p.id`);
  return (r.rows as Row[]).map(toWithFundraiser);
}

export async function markDoublePaidAlerted(ids: number[]): Promise<void> {
  if (ids.length) await pool.query("UPDATE sponsor_pledges SET double_paid_alerted_at = now() WHERE id = ANY($1)", [ids]);
}

/** Staff have looked at a pledge paid twice (and refunded what needed refunding). */
export async function markDoublePaidChecked(id: number, actor: string): Promise<boolean> {
  return inTransaction(async (client) => {
    const r = await client.query(
      "UPDATE sponsor_pledges SET double_paid_checked_at = now(), double_paid_checked_by = $2 WHERE id = $1 AND double_paid_at IS NOT NULL RETURNING fundraiser_id",
      [id, actor],
    );
    if (!r.rows[0]) return false;
    await audit(client, actor, "pledge.double_paid_checked", id, { fundraiserId: Number(r.rows[0].fundraiser_id) });
    return true;
  });
}

// --- removing personal details ---------------------------------------------------------------------

async function forgetInEmailLog(id: number): Promise<void> {
  const r = await pool.query("SELECT email FROM sponsor_pledges WHERE id = $1", [id]);
  const email = text(r.rows[0]?.email);
  if (email) await eraseEmailLogFor(email, PLEDGE_EMAIL_LOG_KINDS);
}

/**
 * Remove an unpaid pledge's personal details (name, email, message, home address), keeping the
 * amount; one still open becomes "expired". The email log's rows for the emails about it go too.
 * Never a paid one, and never twice.
 */
export async function anonymisePledge(id: number): Promise<boolean> {
  return inTransaction(async (client) => {
    const who = await client.query("SELECT email FROM sponsor_pledges WHERE id = $1 FOR UPDATE", [id]);
    const email = text(who.rows[0]?.email);
    const r = await client.query(
      `UPDATE sponsor_pledges
          SET first_name = NULL, surname = NULL, email = NULL, message = NULL, ga_house = NULL, ga_address = NULL, ga_postcode = NULL,
              status = CASE WHEN status = 'open' THEN 'expired' ELSE status END, anonymised_at = now()
        WHERE id = $1 AND anonymised_at IS NULL AND status NOT IN ('paid', 'unconfirmed')
        RETURNING fundraiser_id, status`,
      [id],
    );
    if (!r.rows[0]) return false;
    if (email) await eraseEmailLogFor(email, PLEDGE_EMAIL_LOG_KINDS);
    await audit(client, "system:schedule", "pledge.anonymised", id, { fundraiserId: Number(r.rows[0].fundraiser_id), status: String(r.rows[0].status) });
    return true;
  });
}

/** A paid pledge loses its email (its donation's donor record has it), and its log rows; the name stays. */
export async function trimPaidPledge(id: number): Promise<void> {
  await forgetInEmailLog(id);
  await pool.query("UPDATE sponsor_pledges SET email = NULL WHERE id = $1 AND status = 'paid'", [id]);
}
