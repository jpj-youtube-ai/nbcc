import type { PoolClient } from "pg";
import { pool } from "./pool";
import { insertAudit } from "./donations";
import { listAllFundraisers, type FundraiserSummary } from "./fundraisers";
import { londonToday } from "../events/model";
import { promptCounts, type PromptCall, type PromptCounts, type PromptFacts, type PromptKey } from "../fundraising/call-prompts";
import type { TouchFacts, TouchKind } from "../fundraising/touch-rules";
import { withTeamTotals } from "../fundraising/teams";

// TASK-515: the SQL behind keeping in touch: the Automatic emails switch, which new wordings an admin
// has approved (touch_wording_approvals), which automatic email each
// fundraiser has had (fundraiser_touchpoints, once each), the calls about a smart call prompt (in
// TASK-503's fundraiser_calls, which = 'prompt'), and the facts the pure rules read
// (src/fundraising/touch-rules.ts and call-prompts.ts). This file only moves rows. Every change a
// person makes writes its audit_log row in the same transaction.

export class TouchError extends Error {
  constructor(public readonly reason: "not_found") {
    super(`fundraising touch: ${reason}`);
    this.name = "TouchError";
  }
}

type Row = Record<string, unknown>;
const iso = (v: unknown): string | null => (v == null ? null : new Date(v as string).toISOString());

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

// --- the switch ----------------------------------------------------------------------------------

export interface TouchSettings {
  on: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

const SETTINGS_SQL = "SELECT touch_emails_on, touch_emails_updated_at, touch_emails_updated_by FROM fundraising_settings WHERE id = 1";

const toSettings = (row: Row | undefined): TouchSettings =>
  row
    ? { on: row.touch_emails_on === true, updatedAt: iso(row.touch_emails_updated_at), updatedBy: (row.touch_emails_updated_by as string | null) ?? null }
    : { on: false, updatedAt: null, updatedBy: null };

export async function getTouchSettings(): Promise<TouchSettings> {
  const r = await pool.query(SETTINGS_SQL);
  return toSettings(r.rows[0]);
}

/** Are the automatic emails switched on? Any failure reads as OFF, so nothing is sent by mistake. */
export async function touchEmailsOn(): Promise<boolean> {
  try {
    return (await getTouchSettings()).on;
  } catch {
    return false;
  }
}

export async function setTouchEmailsOn(on: boolean, actor: string): Promise<TouchSettings> {
  return inTransaction(async (client) => {
    await client.query(
      `INSERT INTO fundraising_settings (id, touch_emails_on, touch_emails_updated_at, touch_emails_updated_by) VALUES (1, $1, now(), $2)
       ON CONFLICT (id) DO UPDATE SET touch_emails_on = $1, touch_emails_updated_at = now(), touch_emails_updated_by = $2`,
      [on, actor],
    );
    await insertAudit(client, { actor, action: "fundraising.touch_emails_switched", entity: "fundraising_settings", entityId: 1, data: { on } });
    return toSettings((await client.query(SETTINGS_SQL)).rows[0]);
  });
}

// --- signing off the new wording (Jaimie, 2026-10-03) ---------------------------------------------

/** An admin's approval of one new wording (WORDING_KEYS in src/fundraising/touch-rules.ts). */
export interface WordingApproval {
  key: string;
  approvedAt: string;
  approvedBy: string;
}

const APPROVALS_SQL = "SELECT key, approved_at, approved_by FROM touch_wording_approvals";
const toApproval = (row: Row): WordingApproval => ({
  key: row.key as string,
  approvedAt: iso(row.approved_at) as string,
  approvedBy: row.approved_by as string,
});

export async function listWordingApprovals(): Promise<WordingApproval[]> {
  const r = await pool.query(`${APPROVALS_SQL} ORDER BY key`);
  return (r.rows as Row[]).map(toApproval);
}

/** The approved keys. Any failure reads as NONE approved, so no new wording is sent by mistake. */
export async function approvedWordingKeys(): Promise<Set<string>> {
  try {
    return new Set((await listWordingApprovals()).map((a) => a.key));
  } catch (err) {
    console.error("fundraising automatic emails: could not read the approved wordings:", err instanceof Error ? err.message : err);
    return new Set();
  }
}

/** Approve one wording. One already approved keeps its first approval (and no second History row). */
export async function approveWording(key: string, actor: string): Promise<WordingApproval> {
  return inTransaction(async (client) => {
    const r = await client.query(
      `INSERT INTO touch_wording_approvals (key, approved_by) VALUES ($1, $2)
       ON CONFLICT (key) DO NOTHING RETURNING key, approved_at, approved_by`,
      [key, actor],
    );
    if (r.rows[0]) {
      await insertAudit(client, { actor, action: "fundraising.touch_wording_approved", entity: "fundraising_settings", entityId: 1, data: { key } });
      return toApproval(r.rows[0]);
    }
    return toApproval((await client.query(`${APPROVALS_SQL} WHERE key = $1`, [key])).rows[0]);
  });
}

/** Withdraw one approval: that email stops going until it is approved again. False if it was not approved. */
export async function withdrawWording(key: string, actor: string): Promise<boolean> {
  return inTransaction(async (client) => {
    const r = await client.query("DELETE FROM touch_wording_approvals WHERE key = $1 RETURNING key, approved_at, approved_by", [key]);
    const row = r.rows[0];
    if (!row) return false;
    const was = toApproval(row);
    await insertAudit(client, {
      actor,
      action: "fundraising.touch_wording_withdrawn",
      entity: "fundraising_settings",
      entityId: 1,
      data: { key, approvedAt: was.approvedAt, approvedBy: was.approvedBy },
    });
    return true;
  });
}

// --- once per fundraiser ---------------------------------------------------------------------------

/**
 * Claim one automatic email for a fundraiser, BEFORE it is sent. True when this is the first claim;
 * false when it has been claimed (or sent) before, so it can never go twice, even with two runs at
 * once: the unique (fundraiser_id, kind) decides.
 */
export async function claimTouch(fundraiserId: number, kind: TouchKind, by: string): Promise<boolean> {
  const r = await pool.query(
    `INSERT INTO fundraiser_touchpoints (fundraiser_id, kind, sent_by) VALUES ($1, $2, $3)
     ON CONFLICT (fundraiser_id, kind) DO NOTHING RETURNING id`,
    [fundraiserId, kind, by],
  );
  return r.rows.length > 0;
}

/** The send failed: give the claim back, so a later run can try again. */
export async function releaseTouch(fundraiserId: number, kind: TouchKind): Promise<void> {
  await pool.query("DELETE FROM fundraiser_touchpoints WHERE fundraiser_id = $1 AND kind = $2", [fundraiserId, kind]);
}

/** It went: say so in the fundraiser's History. */
export async function recordTouchSent(fundraiserId: number, kind: TouchKind, actor: string): Promise<void> {
  const client = await pool.connect();
  try {
    await insertAudit(client, { actor, action: "fundraiser.touch_sent", entity: "fundraiser", entityId: fundraiserId, data: { kind } });
  } finally {
    client.release();
  }
}

// --- calls about a prompt --------------------------------------------------------------------------

/**
 * Record that somebody called about a prompt. Inserting FROM the fundraiser means one that is not
 * there inserts nothing and is not_found. The time is the server's.
 */
export async function recordPromptCall(
  fundraiserId: number,
  prompt: PromptKey,
  note: string | null,
  calledBy: string,
  actor: string,
): Promise<PromptCall> {
  return inTransaction(async (client) => {
    const r = await client.query(
      `INSERT INTO fundraiser_calls (fundraiser_id, which, prompt, called_by, note)
       SELECT f.id, 'prompt', $2, $3, $4 FROM fundraisers f WHERE f.id = $1
       RETURNING prompt, called_at, called_by, note`,
      [fundraiserId, prompt, calledBy, note],
    );
    const row = r.rows[0];
    if (!row) throw new TouchError("not_found");
    await insertAudit(client, { actor, action: "fundraiser.prompt_called", entity: "fundraiser", entityId: fundraiserId, data: { prompt, note } });
    return { prompt: row.prompt as PromptKey, calledAt: iso(row.called_at) as string, calledBy: (row.called_by as string | null) ?? null, note: (row.note as string | null) ?? null };
  });
}

// --- the facts -------------------------------------------------------------------------------------

export interface TouchCandidate {
  f: FundraiserSummary;
  touch: TouchFacts;
  prompt: PromptFacts;
}

// When a gift was paid, as the Monday summary reads it (src/db/fundraising-team.ts): a card gift
// when it was made, a Direct Debit when Stripe said it settled. Only online gifts: never money the
// organiser collected and paid in, and never one refunded in full.
const GIFTS_SQL = `
  SELECT g.fundraiser_id, min(g.paid_at) AS first_at, max(g.paid_at) AS last_at FROM (
    SELECT d.fundraiser_id,
           COALESCE((SELECT max(a.created_at) FROM audit_log a
                      WHERE a.entity = 'donation' AND a.entity_id = d.id AND a.action = 'donation.payment_succeeded'),
                    d.created_at) AS paid_at
      FROM donations d
     WHERE d.fundraiser_id IS NOT NULL AND d.payment_status = 'paid' AND NOT d.paid_in_by_organiser
       AND d.amount_pence > d.refunded_amount_pence
  ) g GROUP BY g.fundraiser_id`;

const FINISHED_SQL = `
  SELECT entity_id AS fundraiser_id, max(created_at) AS finished_at FROM audit_log
   WHERE entity = 'fundraiser' AND action = 'fundraiser.finished' GROUP BY entity_id`;

/** Every fundraiser, with what the rules need about each. */
export async function readTouchState(): Promise<TouchCandidate[]> {
  const [fundraisers, gifts, finished, sent, calls] = await Promise.all([
    // Team pages: a team is judged on its whole total (its own and its members'), against its target.
    listAllFundraisers().then(withTeamTotals),
    pool.query(GIFTS_SQL),
    pool.query(FINISHED_SQL),
    pool.query("SELECT fundraiser_id, kind, sent_at FROM fundraiser_touchpoints ORDER BY sent_at, id"),
    pool.query("SELECT fundraiser_id, prompt, called_at, called_by, note FROM fundraiser_calls WHERE which = 'prompt' ORDER BY called_at, id"),
  ]);
  const giftsBy = new Map<number, Row>(gifts.rows.map((r: Row) => [Number(r.fundraiser_id), r]));
  // Team pages: a team's gifts are its own and its current members' (approved or finished, not taken
  // off) together, for first gift and gone quiet. Members keep their own.
  const own = new Map(giftsBy);
  for (const m of fundraisers) {
    if (!m.teamId || m.teamLeftAt || (m.status !== "approved" && m.status !== "finished")) continue;
    const g = own.get(m.id);
    if (!g) continue;
    const t = giftsBy.get(m.teamId);
    const first = (a: unknown, b: unknown) => (a == null ? b : b == null ? a : new Date(a as string) < new Date(b as string) ? a : b);
    const last = (a: unknown, b: unknown) => (a == null ? b : b == null ? a : new Date(a as string) > new Date(b as string) ? a : b);
    giftsBy.set(m.teamId, { fundraiser_id: m.teamId, first_at: first(t?.first_at, g.first_at), last_at: last(t?.last_at, g.last_at) });
  }
  const finishedBy = new Map<number, string | null>(finished.rows.map((r: Row) => [Number(r.fundraiser_id), iso(r.finished_at)]));
  const sentBy = new Map<number, TouchFacts["sent"]>();
  for (const r of sent.rows as Row[]) {
    const id = Number(r.fundraiser_id);
    sentBy.set(id, [...(sentBy.get(id) ?? []), { kind: r.kind as TouchKind, sentAt: iso(r.sent_at) as string }]);
  }
  const callsBy = new Map<number, PromptCall[]>();
  for (const r of calls.rows as Row[]) {
    const id = Number(r.fundraiser_id);
    callsBy.set(id, [
      ...(callsBy.get(id) ?? []),
      { prompt: r.prompt as PromptKey, calledAt: iso(r.called_at) as string, calledBy: (r.called_by as string | null) ?? null, note: (r.note as string | null) ?? null },
    ]);
  }
  return fundraisers.map((f) => {
    const g = giftsBy.get(f.id);
    const last = g ? iso(g.last_at) : null;
    return {
      f,
      touch: { firstOnlineGiftAt: g ? iso(g.first_at) : null, lastOnlineGiftAt: last, finishedAt: finishedBy.get(f.id) ?? null, sent: sentBy.get(f.id) ?? [] },
      prompt: { lastOnlineGiftAt: last, calls: callsBy.get(f.id) ?? [] },
    };
  });
}

/** How many of each call prompt are showing today, for the Monday summary. */
export async function readPromptCounts(now: Date): Promise<PromptCounts> {
  const state = await readTouchState();
  return promptCounts(state.map((s) => ({ f: s.f, facts: s.prompt })), londonToday(now));
}
