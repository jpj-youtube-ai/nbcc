import type { PoolClient } from "pg";
import { pool } from "./pool";
import { insertAudit, writeWithAudit } from "./donations";
import { listAllFundraisers } from "./fundraisers";
import { listRequestRows } from "./fundraising-requests";
import { countPendingUpdates } from "./fundraiser-updates";
import { countPendingPictures } from "./fundraiser-pictures";
import { countPendingThanks } from "./fundraiser-thanks";
import { countHeldMessages } from "./fundraiser-memory";
import { readPromptCounts } from "./fundraising-touch";
import { summaryPackIds } from "./welcome-packs";
import { INVITE_TTL_DAYS, inviteCc, inviteFullName, inviteNameParts, inviteTypeOf, inviteWordingKey, staffFirstName, type InviteType } from "../fundraising/invite";
import { summaryRecipientsSchema, type SummaryInputs } from "../fundraising/summary";
import type { CallRecord, CallWhich } from "../fundraising/follow-up";

// TASK-503: the SQL behind the fundraising team's tools (invites, calls, taking a fundraiser off Get
// involved, and the Monday summary). The rules are pure, in src/fundraising/invite.ts, follow-up.ts
// and summary.ts; this file only moves rows. Every change a person makes writes its audit_log row in
// the same transaction: an invite against entity "fundraiser_invite", and a call or taking it off the
// list against "fundraiser" and its id, so it shows in that fundraiser's History.

export class TeamError extends Error {
  // wording_waiting: a resend of an invite whose wording is waiting for sign off (the in memory one).
  constructor(public readonly reason: "not_found" | "bad_status" | "wording_waiting") {
    super(`fundraising team: ${reason}`);
    this.name = "TeamError";
  }
}

type Row = Record<string, unknown>;
const iso = (v: unknown): string | null => (v == null ? null : new Date(v as string).toISOString());
const dateOf = (v: unknown): Date => new Date(v as string);

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

// --- invites -------------------------------------------------------------------------------------

/**
 * An invite as staff see it. Never its token or the token's hash. firstName and lastName are as
 * staff typed them; for an invite sent before the two boxes (no first_name), its one name split at
 * the first space (src/fundraising/invite.ts, inviteNameParts). type is what they were invited to
 * do (invite_type, migration 1791200000235), or null for an invite from before the drop-down.
 */
export interface InviteRow {
  id: number;
  name: string;
  firstName: string;
  lastName: string;
  email: string;
  note: string | null;
  signedBy: string;
  sentBy: string;
  createdAt: string;
  resentAt: string | null;
  type: InviteType | null;
}

const INVITE_COLUMNS =
  "id, name, first_name, last_name, email, note, signed_by, sent_by, created_at, resent_at, used_at, used_by_fundraiser_id, invite_type";

// The first name and surname kept with the row, or the old split of its one name.
const namePartsOf = (r: Row) =>
  inviteNameParts({ name: String(r.name), firstName: (r.first_name as string | null) ?? null, lastName: (r.last_name as string | null) ?? null });

function toInvite(r: Row): InviteRow {
  return {
    id: Number(r.id),
    name: String(r.name),
    ...namePartsOf(r),
    email: String(r.email),
    note: (r.note as string | null) ?? null,
    signedBy: String(r.signed_by),
    sentBy: String(r.sent_by),
    createdAt: iso(r.created_at) as string,
    resentAt: iso(r.resent_at),
    type: inviteTypeOf(r.invite_type),
  };
}

// The sign off an invite of this type needs (the in memory one), read with a lock on its row inside
// the transaction that stores or resends the invite, so an approval cannot be withdrawn between the
// check and the send: the withdrawal waits for this transaction, or this finds the row gone. Throws
// wording_waiting when it is not approved, which rolls the transaction back.
async function requireSignOff(client: PoolClient, type: InviteType | null | undefined): Promise<void> {
  const key = inviteWordingKey(type);
  if (!key) return;
  const r = await client.query("SELECT 1 FROM touch_wording_approvals WHERE key = $1 FOR SHARE", [key]);
  if (!r.rows[0]) throw new TeamError("wording_waiting");
}

export async function createInvite(
  // cc: who the email copies in (whoever it is signed by), or null; kept on the audit row, where a
  // resend finds it again. `actor` is who pressed send.
  // inviteType: what they are invited to do, or none from an admin page loaded before the drop-down.
  i: {
    firstName: string;
    lastName: string;
    email: string;
    note: string | null;
    signedBy: string;
    cc: string | null;
    tokenHash: string;
    inviteType?: InviteType | null;
  },
  actor: string,
): Promise<InviteRow> {
  return writeWithAudit(
    async (client) => {
      await requireSignOff(client, i.inviteType);
      // `name` keeps the two joined, for the admin list, the Monday summary and a code rollback.
      const r = await client.query(
        `INSERT INTO fundraiser_invites (name, first_name, last_name, email, note, signed_by, sent_by, token_hash, invite_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING ${INVITE_COLUMNS}`,
        [inviteFullName(i.firstName, i.lastName), i.firstName, i.lastName, i.email, i.note, i.signedBy, actor, i.tokenHash, i.inviteType ?? null],
      );
      return toInvite(r.rows[0]);
    },
    (inv) => ({
      actor,
      action: "fundraiser_invite.sent",
      entity: "fundraiser_invite",
      entityId: inv.id,
      data: { email: inv.email, signedBy: inv.signedBy, cc: i.cc, ...(inv.type ? { type: inv.type } : {}) },
    }),
  );
}

// Who a resend copies in, read inside its transaction from the invite's `fundraiser_invite.sent`
// audit row. A null cc there means the send chose no copy (the signer was the person invited), so
// the resend has none either. An address there is used only while it still belongs to someone who
// can sign in (not disabled, as getSigner decides), so nobody who has left is sent the invitee's
// details. Otherwise (no row, a row from before the copy was recorded, an address that is not whole
// or is no longer staff) the copy goes to the person resending it.
async function resendCopy(client: PoolClient, id: number, recipient: string, senderEmail: string | null | undefined): Promise<string | null> {
  const r = await client.query(
    `SELECT data ? 'cc' AS has_cc, data->>'cc' AS cc FROM audit_log
      WHERE entity = 'fundraiser_invite' AND entity_id = $1 AND action = 'fundraiser_invite.sent'
      ORDER BY id DESC LIMIT 1`,
    [id],
  );
  const row = r.rows[0] as { has_cc?: boolean; cc?: string | null } | undefined;
  const fallback = () => inviteCc(senderEmail, recipient) ?? null;
  if (!row || !row.has_cc) return fallback();
  if (row.cc === null || row.cc === undefined) return null;
  const kept = inviteCc(row.cc, "");
  if (!kept) return fallback();
  const live = await client.query("SELECT 1 FROM users WHERE lower(email) = $1 AND status <> 'disabled' LIMIT 1", [kept]);
  return live.rows[0] ? (inviteCc(kept, recipient) ?? null) : fallback();
}

/**
 * A new token and a new date for an invite not taken up. Throws not_found otherwise. The `cc` that
 * comes back is who the email copies in, and the audit row says so: whoever was copied in when the
 * invite was sent (the address on its `fundraiser_invite.sent` audit row: the signer, or for an
 * invite from before 2026-10-04 whoever sent it), while they can still sign in; see resendCopy.
 * senderEmail, the member of staff resending it, is used only when no address was kept or it is no
 * longer staff's. `actor` is who pressed Resend. The type stays as it was. An
 * invite whose wording is waiting for sign off (an in memory one whose approval was withdrawn)
 * throws wording_waiting and nothing changes: the transaction is rolled back, so the link in the
 * first email still works.
 */
export async function resendInvite(
  id: number,
  tokenHash: string,
  actor: string,
  senderEmail?: string | null,
): Promise<InviteRow & { cc: string | null }> {
  return inTransaction(async (client) => {
    const r = await client.query(
      `UPDATE fundraiser_invites SET token_hash = $2, resent_at = now()
        WHERE id = $1 AND used_at IS NULL RETURNING ${INVITE_COLUMNS}`,
      [id, tokenHash],
    );
    if (!r.rows[0]) throw new TeamError("not_found");
    const inv = toInvite(r.rows[0]);
    await requireSignOff(client, inv.type);
    const cc = await resendCopy(client, id, inv.email, senderEmail);
    await insertAudit(client, {
      actor,
      action: "fundraiser_invite.resent",
      entity: "fundraiser_invite",
      entityId: id,
      data: { email: inv.email, cc },
    });
    return { ...inv, cc };
  });
}

/** Remove an invite not taken up. Its link stops working. Throws not_found otherwise. */
export async function removeInvite(id: number, actor: string): Promise<void> {
  await inTransaction(async (client) => {
    const r = await client.query(`DELETE FROM fundraiser_invites WHERE id = $1 AND used_at IS NULL RETURNING ${INVITE_COLUMNS}`, [id]);
    if (!r.rows[0]) throw new TeamError("not_found");
    await insertAudit(client, {
      actor,
      action: "fundraiser_invite.removed",
      entity: "fundraiser_invite",
      entityId: id,
      data: { email: String(r.rows[0].email) },
    });
  });
}

/** Invites not taken up, the latest sent first. */
export async function listOpenInvites(): Promise<InviteRow[]> {
  const r = await pool.query(
    `SELECT ${INVITE_COLUMNS} FROM fundraiser_invites WHERE used_at IS NULL
      ORDER BY COALESCE(resent_at, created_at) DESC, id DESC LIMIT 200`,
  );
  return r.rows.map(toInvite);
}

export interface FoundInvite {
  id: number;
  name: string;
  firstName: string;
  lastName: string;
  email: string;
  createdAt: Date;
  resentAt: Date | null;
  usedAt: Date | null;
  /** What they were invited to do, or null for an invite from before the drop-down. */
  inviteType: InviteType | null;
}

export async function findInviteByHash(tokenHash: string): Promise<FoundInvite | null> {
  const r = await pool.query(`SELECT ${INVITE_COLUMNS} FROM fundraiser_invites WHERE token_hash = $1`, [tokenHash]);
  const row = r.rows[0];
  if (!row) return null;
  return {
    id: Number(row.id),
    name: String(row.name),
    ...namePartsOf(row),
    email: String(row.email),
    createdAt: dateOf(row.created_at),
    resentAt: row.resent_at ? dateOf(row.resent_at) : null,
    usedAt: row.used_at ? dateOf(row.used_at) : null,
    inviteType: inviteTypeOf(row.invite_type),
  };
}

/**
 * The sign up made from an invite has arrived: mark it used and link it, once, and only while it is
 * in date. One statement, with its audit row, so two sign ups at once cannot both take it. The id of
 * the invite, or null when there was none to take.
 */
export async function markInviteUsed(tokenHash: string, fundraiserId: number): Promise<number | null> {
  const r = await pool.query<{ entity_id: number }>(
    `WITH used AS (
       UPDATE fundraiser_invites SET used_at = now(), used_by_fundraiser_id = $2
        WHERE token_hash = $1 AND used_at IS NULL
          AND COALESCE(resent_at, created_at) > now() - interval '${INVITE_TTL_DAYS} days'
        RETURNING id
     )
     INSERT INTO audit_log (actor, action, entity, entity_id, data)
     SELECT 'public', 'fundraiser_invite.used', 'fundraiser_invite', id, jsonb_build_object('fundraiserId', $2::integer) FROM used
     RETURNING entity_id`,
    [tokenHash, fundraiserId],
  );
  return r.rows[0] ? Number(r.rows[0].entity_id) : null;
}

/** How many invites this person sent or resent in the last 24 hours. */
export async function countRecentInvites(actor: string): Promise<number> {
  const r = await pool.query<{ n: string }>(
    `SELECT count(*) AS n FROM audit_log
      WHERE actor = $1 AND action IN ('fundraiser_invite.sent', 'fundraiser_invite.resent')
        AND created_at > now() - interval '24 hours'`,
    [actor],
  );
  return Number(r.rows[0]?.n ?? 0);
}

export interface Signer {
  id: number;
  firstName: string;
}

/** Staff an invite can be signed by: everyone who can sign in, by first name only. */
export async function listSigners(): Promise<Signer[]> {
  const r = await pool.query(
    "SELECT id, full_name, email FROM users WHERE status <> 'disabled' ORDER BY lower(full_name), id",
  );
  return r.rows.map((u) => ({ id: Number(u.id), firstName: staffFirstName(u.full_name as string | null, String(u.email)) }));
}

/** One signer, with their own email address (their admin sign in), for the copy of the invite. */
export async function getSigner(id: number): Promise<(Signer & { email: string }) | null> {
  const r = await pool.query("SELECT id, full_name, email FROM users WHERE id = $1 AND status <> 'disabled'", [id]);
  const u = r.rows[0];
  return u ? { id: Number(u.id), firstName: staffFirstName(u.full_name as string | null, String(u.email)), email: String(u.email) } : null;
}

// --- calls ---------------------------------------------------------------------------------------

/**
 * Record that somebody made the call before or after a fundraiser's date. Inserting FROM the
 * fundraiser means one that is not there, or has no date, inserts nothing and is not_found.
 */
export async function recordFundraiserCall(
  fundraiserId: number,
  which: CallWhich,
  note: string | null,
  calledBy: string,
  actor: string,
): Promise<CallRecord> {
  return inTransaction(async (client) => {
    const r = await client.query(
      `INSERT INTO fundraiser_calls (fundraiser_id, which, called_by, note)
       SELECT f.id, $2, $3, $4 FROM fundraisers f WHERE f.id = $1 AND f.event_date IS NOT NULL
       RETURNING id, fundraiser_id, which, called_at, called_by, note`,
      [fundraiserId, which, calledBy, note],
    );
    const row = r.rows[0];
    if (!row) throw new TeamError("not_found");
    await insertAudit(client, {
      actor,
      action: "fundraiser.called",
      entity: "fundraiser",
      entityId: fundraiserId,
      data: { which, note },
    });
    return { which: row.which as CallWhich, calledAt: iso(row.called_at) as string, calledBy: row.called_by ?? null, note: row.note ?? null };
  });
}

// The calls before and after a date only: TASK-515's calls about a prompt (which = 'prompt') are read
// by src/db/fundraising-touch.ts.
export async function listFundraiserCalls(): Promise<Array<CallRecord & { fundraiserId: number }>> {
  const r = await pool.query(
    "SELECT fundraiser_id, which, called_at, called_by, note FROM fundraiser_calls WHERE which IN ('before', 'after') ORDER BY called_at DESC, id DESC",
  );
  return r.rows.map((row) => ({
    fundraiserId: Number(row.fundraiser_id),
    which: row.which as CallWhich,
    calledAt: iso(row.called_at) as string,
    calledBy: (row.called_by as string | null) ?? null,
    note: (row.note as string | null) ?? null,
  }));
}

// --- taking a fundraiser off Get involved ----------------------------------------------------------

/**
 * Take an approved fundraiser off the Get involved list (`off`), or put it back. Its status, page and
 * giving link are untouched: only the list changes. Idempotent: taking off one already off keeps
 * the first time.
 */
export async function setOffList(id: number, off: boolean, actor: string): Promise<{ offListAt: string | null }> {
  return inTransaction(async (client) => {
    const found = await client.query("SELECT status, slug, off_list_at FROM fundraisers WHERE id = $1 FOR UPDATE", [id]);
    const before = found.rows[0];
    if (!before) throw new TeamError("not_found");
    if (off && before.status !== "approved") throw new TeamError("bad_status");
    const r = await client.query(
      off
        ? `UPDATE fundraisers SET off_list_at = now(), off_list_by = $2, updated_at = now(), updated_by = $2
            WHERE id = $1 AND off_list_at IS NULL RETURNING off_list_at`
        : `UPDATE fundraisers SET off_list_at = NULL, off_list_by = NULL, updated_at = now(), updated_by = $2
            WHERE id = $1 RETURNING off_list_at`,
      [id, actor],
    );
    // Already off: nothing changed, and nothing to record.
    if (off && !r.rows[0]) return { offListAt: iso(before.off_list_at) };
    await insertAudit(client, {
      actor,
      action: off ? "fundraiser.taken_off_list" : "fundraiser.put_back_on_list",
      entity: "fundraiser",
      entityId: id,
      data: { slug: String(before.slug) },
    });
    return { offListAt: iso(r.rows[0]?.off_list_at) };
  });
}

// --- the Monday summary ----------------------------------------------------------------------------

export interface SummarySettings {
  recipients: string[];
  /** The Monday it last went, as YYYY-MM-DD, or null before the first. */
  lastWeek: string | null;
}

export async function getSummarySettings(): Promise<SummarySettings> {
  const r = await pool.query(
    "SELECT summary_recipients, to_char(summary_last_week, 'YYYY-MM-DD') AS last_week FROM fundraising_settings WHERE id = 1",
  );
  const row = r.rows[0];
  // Read through the same rule it is saved by, so the list is always tidy; anything else is nobody.
  const parsed = summaryRecipientsSchema.safeParse(row?.summary_recipients ?? []);
  return { recipients: parsed.success ? parsed.data : [], lastWeek: (row?.last_week as string | null) ?? null };
}

/** Save who gets the summary, with a History row naming who was added and who removed. */
export async function saveSummaryRecipients(recipients: string[], actor: string): Promise<void> {
  await inTransaction(async (client) => {
    const before = await client.query("SELECT summary_recipients FROM fundraising_settings WHERE id = 1 FOR UPDATE");
    const was = new Set<string>(Array.isArray(before.rows[0]?.summary_recipients) ? (before.rows[0].summary_recipients as string[]) : []);
    const now = new Set(recipients);
    await client.query("UPDATE fundraising_settings SET summary_recipients = $1::jsonb WHERE id = 1", [JSON.stringify(recipients)]);
    await insertAudit(client, {
      actor,
      action: "fundraising.summary_recipients_saved",
      entity: "fundraising_settings",
      entityId: 1,
      data: { recipients: recipients.length, added: [...now].filter((e) => !was.has(e)), removed: [...was].filter((e) => !now.has(e)) },
    });
  });
}

/**
 * Claim this Monday for the summary. Under the row's lock, so two runs at once cannot both send it:
 * the second finds the week taken and gets null. Gives back the week it replaced, for releasing.
 */
export async function claimSummaryWeek(week: string): Promise<{ previous: string | null } | null> {
  return inTransaction(async (client) => {
    const r = await client.query("SELECT to_char(summary_last_week, 'YYYY-MM-DD') AS last_week FROM fundraising_settings WHERE id = 1 FOR UPDATE");
    const previous = (r.rows[0]?.last_week as string | null) ?? null;
    if (previous !== null && previous >= week) return null;
    await client.query("UPDATE fundraising_settings SET summary_last_week = $1::date WHERE id = 1", [week]);
    return { previous };
  });
}

/** Nothing went: give the week back, so a rerun can try again. */
export async function releaseSummaryWeek(week: string, previous: string | null): Promise<void> {
  await pool.query("UPDATE fundraising_settings SET summary_last_week = $2::date WHERE id = 1 AND summary_last_week = $1::date", [
    week,
    previous,
  ]);
}

/**
 * Everything the summary counts, as at `now`. Gifts and cash from a fortnight back is plenty.
 *
 * When a gift was paid: donations has no paid time of its own. A card gift is paid when it is made
 * (created_at). A Direct Debit (BACS) gift is made pending and becomes paid days later, when Stripe
 * sends checkout.session.async_payment_succeeded; the webhook then writes an audit_log row,
 * "donation.payment_succeeded", against the donation, in the same transaction as the change. So
 * the paid time is that row's time when there is one, and created_at otherwise. Cash counts by when
 * staff recorded it (created_at), not the day it was paid in, so cash typed in late still appears.
 */
export async function readSummaryInputs(now: Date): Promise<SummaryInputs> {
  const since = new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000);
  const [fundraisers, gifts, cash, calls, invites, newsToCheck, requests, thanksToCheck, prompts, photosToCheck] = await Promise.all([
    listAllFundraisers(),
    pool.query(
      `SELECT g.* FROM (
         SELECT d.fundraiser_id, d.amount_pence, d.refunded_amount_pence, d.gift_aid, d.paid_in_by_organiser,
                COALESCE((SELECT max(a.created_at) FROM audit_log a
                           WHERE a.entity = 'donation' AND a.entity_id = d.id AND a.action = 'donation.payment_succeeded'),
                         d.created_at) AS paid_at
           FROM donations d
          WHERE d.fundraiser_id IS NOT NULL AND d.payment_status = 'paid'
       ) g WHERE g.paid_at >= $1`,
      [since],
    ),
    pool.query(
      `SELECT fundraiser_id, amount_pence, created_at FROM fundraiser_cash WHERE created_at >= $1`,
      [since],
    ),
    listFundraiserCalls(),
    listOpenInvites(),
    // TASK-506: the news updates waiting for staff. Only one line of the summary: if it cannot be
    // counted, the summary still goes, without it.
    countPendingUpdates().catch((err: unknown) => {
      console.error("fundraising summary news count failed:", err instanceof Error ? err.message : err);
      return 0;
    }),
    // TASK-505: the requests staff have acted on, so only what is still to do is counted.
    listRequestRows(),
    // TASK-507: the thank yous waiting for staff. Only one line of the summary: if it cannot be
    // counted, the summary still goes, without it.
    countPendingThanks().catch((err: unknown) => {
      console.error("fundraising summary thank yous count failed:", err instanceof Error ? err.message : err);
      return 0;
    }),
    // TASK-515: the smart call prompts showing today. Only one line of the summary: if they cannot
    // be counted, the summary still goes, without it.
    readPromptCounts(now).catch((err: unknown) => {
      console.error("fundraising summary call prompts count failed:", err instanceof Error ? err.message : err);
      return undefined;
    }),
    // Profile pictures: the photos waiting for staff. Only one line of the summary: if it cannot be
    // counted, the summary still goes, without it.
    countPendingPictures().catch((err: unknown) => {
      console.error("fundraising summary photos count failed:", err instanceof Error ? err.message : err);
      return 0;
    }),
  ]);
  return {
    now,
    newsToCheck,
    photosToCheck,
    fundraisers,
    gifts: gifts.rows.map((g) => ({
      fundraiserId: Number(g.fundraiser_id),
      amountPence: Number(g.amount_pence),
      refundedPence: Number(g.refunded_amount_pence ?? 0),
      giftAid: Boolean(g.gift_aid),
      paidIn: Boolean(g.paid_in_by_organiser),
      paidAt: iso(g.paid_at) as string,
    })),
    cash: cash.rows.map((c) => ({ fundraiserId: Number(c.fundraiser_id), amountPence: Number(c.amount_pence), recordedAt: iso(c.created_at) as string })),
    calls,
    invites: invites.map((i) => ({ name: i.name, firstName: i.firstName, signedBy: i.signedBy, createdAt: i.createdAt, resentAt: i.resentAt, type: i.type })),
    requests,
    thanksToCheck,
    prompts,
    // Sponsor pledges still unpaid two weeks after their event, and those paid twice. Each is only
    // one line of the summary: if it cannot be counted, the summary still goes, without it.
    pledgesUnpaid: await import("./pledges")
      .then((m) => m.countUnpaidPledges(now))
      .catch((err: unknown) => {
        console.error("fundraising summary unpaid pledges count failed:", err instanceof Error ? err.message : err);
        return 0;
      }),
    pledgesPaidTwice: await import("./pledges")
      .then((m) => m.countDoublePaidPledges())
      .catch((err: unknown) => {
        console.error("fundraising summary pledges paid twice count failed:", err instanceof Error ? err.message : err);
        return 0;
      }),
    // Welcome packs: whose pack has gone, with nothing more owed. If they cannot be read, the
    // summary still goes, without its welcome pack lines.
    // And whose waiting T-shirt staff left out with a reason: a pack to send, not one waiting for a size.
    ...(await summaryPackIds(fundraisers)
      .then((p) => ({ packsSent: [...p.settled], packsTshirtLeftOut: [...p.tshirtLeftOut] }))
      .catch((err: unknown) => {
        console.error("fundraising summary welcome packs read failed:", err instanceof Error ? err.message : err);
        return { packsSent: null, packsTshirtLeftOut: null };
      })),
    // In memory: messages waiting for staff. Only one line of the summary: if they cannot be counted,
    // the summary still goes, without it.
    messagesToCheck: await countHeldMessages().catch((err: unknown) => {
      console.error("fundraising summary in memory messages count failed:", err instanceof Error ? err.message : err);
      return 0;
    }),
  };
}
