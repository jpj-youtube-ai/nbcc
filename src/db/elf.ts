import { randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "./pool";
import { insertAudit } from "./donations";
import { ELF_DEFAULTS, type ElfSettings } from "../elf/settings";
import type { JoinBody } from "../elf/join";
import type { FamilyRow } from "../elf/views";
import type { DoorsDone } from "../elf/progress";
import { normaliseFavourites, normaliseLook, wardrobeState, type ElfLook } from "../elf/wardrobe";

// NBCC Elf Detective School: the data layer (tables in migrations/1791200000310_elf-school.js).
// Designs: docs/superpowers/specs/2026-10-04-elf-detective-school-design.md and
// 2026-11-03-elf-detective-secret-places-design.md. The rules themselves are pure, in src/elf/.

export { ELF_DEFAULTS, type ElfSettings };

interface SettingsRow {
  school_on: boolean;
  year: number;
  entry_from_pence: number;
  entry_suggested_pence: number;
  preview_hash?: string | null;
  place_phone?: string | null;
  doors_on?: boolean;
}

const SETTINGS_SQL = "SELECT school_on, year, entry_from_pence, entry_suggested_pence, preview_hash, place_phone, doors_on FROM elf_settings WHERE id = 1";

function settingsFrom(row: SettingsRow | undefined): ElfSettings {
  if (!row) return { ...ELF_DEFAULTS };
  return {
    schoolOn: row.school_on,
    year: row.year,
    entryFromPence: row.entry_from_pence,
    entrySuggestedPence: row.entry_suggested_pence,
    previewHash: row.preview_hash ?? null,
    placePhone: row.place_phone ?? null,
    doorsOn: row.doors_on === true,
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

// --- the settings and the switch -----------------------------------------------------------------

/** The settings. Any failure reads as switched OFF, so nothing shows that should not. */
export async function getElfSettings(): Promise<ElfSettings> {
  try {
    const r = await pool.query<SettingsRow>(SETTINGS_SQL);
    return settingsFrom(r.rows[0]);
  } catch (err) {
    // Reading as switched off is the safe answer, but it hides a broken database, so it is logged:
    // one line, the error's own message only. A database that cannot be reached at all fails with no
    // message (Node's AggregateError for a refused connection), so then its code, or its kind.
    const said = err instanceof Error ? err.message || String((err as { code?: unknown }).code ?? "") || err.name : String(err);
    console.error("elf settings could not be read, so the school reads as switched off:", said);
    return { ...ELF_DEFAULTS };
  }
}

const SETTING_COLUMNS = {
  schoolOn: "school_on",
  entryFromPence: "entry_from_pence",
  entrySuggestedPence: "entry_suggested_pence",
  placePhone: "place_phone",
  doorsOn: "doors_on",
} as const;

/** Change some settings, with the row locked, and say so in the audit log. The admin route checks
 *  the values (src/routes/admin-elf.ts); the table's CHECKs are the last guard. */
export async function setElfSettings(
  patch: Partial<Omit<ElfSettings, "year">>,
  actor: string,
): Promise<ElfSettings> {
  return inTransaction(async (client) => {
    const before = await client.query<SettingsRow>(`${SETTINGS_SQL} FOR UPDATE`);
    const keys = (Object.keys(SETTING_COLUMNS) as (keyof typeof SETTING_COLUMNS)[]).filter((k) => patch[k] !== undefined);
    if (keys.length > 0) {
      const sets = keys.map((k, i) => `${SETTING_COLUMNS[k]} = $${i + 1}`);
      await client.query(
        `UPDATE elf_settings SET ${sets.join(", ")}, updated_at = now(), updated_by = $${keys.length + 1} WHERE id = 1`,
        [...keys.map((k) => patch[k]), actor],
      );
      await insertAudit(client, {
        actor,
        action: "elf.settings",
        entity: "elf_settings",
        entityId: 1,
        data: { before: settingsFrom(before.rows[0]), patch },
      });
    }
    const after = await client.query<SettingsRow>(SETTINGS_SQL);
    return settingsFrom(after.rows[0]);
  });
}

/** Set or clear the private preview link (the sha256 of its code), and say so in the audit log. */
export async function setElfPreview(previewHash: string | null, actor: string): Promise<void> {
  await inTransaction(async (client) => {
    await client.query("UPDATE elf_settings SET preview_hash = $1, updated_at = now(), updated_by = $2 WHERE id = 1", [previewHash, actor]);
    await insertAudit(client, { actor, action: previewHash ? "elf.preview.made" : "elf.preview.ended", entity: "elf_settings", entityId: 1, data: {} });
  });
}

// --- enrolling, before the payment -----------------------------------------------------------------

export interface PendingJoin {
  familyId: number;
  orderId: number;
  reference: string;
  detectiveIds: number[];
}

const REFERENCE_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function newReference(): string {
  const bytes = randomBytes(6);
  return `EDS-${[...bytes].map((b) => REFERENCE_LETTERS[b % REFERENCE_LETTERS.length]).join("")}`;
}

/**
 * Save an enrolment, checked by parseJoin, before it is paid: one family per email (stored lower
 * case), its new detectives not yet active, and a pending order for them. A family that already has
 * paid for detectives must sign in to add more ("sign-in-first", and nothing is saved): otherwise
 * anyone could add detectives to someone else's family by typing their email. `familyId` is the
 * signed in family, whose email is then not used.
 */
export async function createPendingJoin(o: {
  body: JoinBody;
  browserTokenHash: string;
  feeCoverPence: number;
  familyId?: number;
}): Promise<PendingJoin | "sign-in-first"> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let familyId = o.familyId;
    if (familyId === undefined) {
      const family = await client.query<{ id: number; active: boolean }>(
        `INSERT INTO elf_families (email, grown_up_name, newsletter) VALUES ($1, $2, $3)
         ON CONFLICT (email) DO UPDATE
           SET grown_up_name = CASE WHEN elf_families.active THEN elf_families.grown_up_name ELSE EXCLUDED.grown_up_name END,
               newsletter = CASE WHEN elf_families.active THEN elf_families.newsletter ELSE EXCLUDED.newsletter END
         RETURNING id, active`,
        [o.body.email.trim().toLowerCase(), o.body.grownUpName, o.body.newsletter],
      );
      if (family.rows[0].active) {
        await client.query("ROLLBACK");
        return "sign-in-first";
      }
      familyId = family.rows[0].id;
    }
    const detectiveIds: number[] = [];
    for (const d of o.body.detectives) {
      const r = await client.query<{ id: number }>(
        "INSERT INTO elf_detectives (family_id, first_name, surname) VALUES ($1, $2, $3) RETURNING id",
        [familyId, d.firstName, d.surname],
      );
      detectiveIds.push(r.rows[0].id);
    }
    const reference = newReference();
    const order = await client.query<{ id: number }>(
      `INSERT INTO elf_orders
         (reference, family_id, detective_ids, entry_pence, donation_pence, fee_cover_pence, gift_aid, declaration, browser_token_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [
        reference,
        familyId,
        detectiveIds,
        o.body.entryPence,
        o.body.donationPence,
        o.feeCoverPence,
        o.body.giftAid,
        o.body.giftAid && o.body.declaration ? JSON.stringify(o.body.declaration) : null,
        o.browserTokenHash,
      ],
    );
    await client.query("COMMIT");
    return { familyId, orderId: order.rows[0].id, reference, detectiveIds };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Remember which Stripe session pays for an order. */
export async function attachStripeSession(orderId: number, sessionId: string): Promise<void> {
  await pool.query("UPDATE elf_orders SET stripe_session_id = $2 WHERE id = $1 AND status = 'pending'", [orderId, sessionId]);
}

// --- settling a payment (called from the Stripe webhook, inside its transaction) -------------------

type Querier = Pick<PoolClient, "query">;

export interface SettledOrder {
  orderId: number;
  familyId: number;
  email: string;
  grownUpName: string;
  newsletter: boolean;
  /** This payment opened the family's account (it had no paid order before). */
  openedFamily: boolean;
  detectives: { id: number; firstName: string; surname: string; badgeNumber: number }[];
}

/**
 * A paid checkout: pending to paid, once. The family and the order's detectives become active, each
 * detective gets the next badge number (a detective that already has one keeps it), and the order
 * remembers whether it opened the family's account (the family had no paid order before). A gift
 * with Gift Aid keeps the declaration wording it was given under. "already" when the order was not
 * pending (Stripe sends an event again), "unknown" when no order has that reference.
 */
export async function settleElfOrder(
  client: Querier,
  o: { reference: string; sessionId: string; paidAt: Date; wording: { wording_version: string; wording_snapshot: string } },
): Promise<SettledOrder | "already" | "unknown"> {
  const found = await client.query<{
    id: number;
    family_id: number;
    detective_ids: number[];
    status: string;
    gift_aid: boolean;
    family_active: boolean;
    email: string;
    grown_up_name: string;
    newsletter: boolean;
  }>(
    `SELECT o.id, o.family_id, o.detective_ids, o.status, o.gift_aid, f.active AS family_active, f.email, f.grown_up_name, f.newsletter
       FROM elf_orders o
       JOIN elf_families f ON f.id = o.family_id
      WHERE o.reference = $1
        FOR UPDATE OF o, f`,
    [o.reference],
  );
  const row = found.rows[0];
  if (!row) return "unknown";
  if (row.status !== "pending") return "already";
  const wording = row.gift_aid ? JSON.stringify({ ...o.wording, declared_at: o.paidAt.toISOString() }) : null;
  await client.query(
    `UPDATE elf_orders SET status = 'paid', paid_at = $2, stripe_session_id = COALESCE(stripe_session_id, $3), opened_family = $4,
            declaration = CASE WHEN $5::jsonb IS NULL THEN declaration ELSE COALESCE(declaration, '{}'::jsonb) || $5::jsonb END
      WHERE id = $1`,
    [row.id, o.paidAt, o.sessionId, !row.family_active, wording],
  );
  await client.query("UPDATE elf_families SET active = true WHERE id = $1", [row.family_id]);
  const detectives = await client.query<{ id: number; first_name: string; surname: string; badge_number: number }>(
    `UPDATE elf_detectives SET active = true, badge_number = COALESCE(badge_number, nextval('elf_badge_seq'))
      WHERE id = ANY($1::int[]) AND family_id = $2
      RETURNING id, first_name, surname, badge_number`,
    [row.detective_ids, row.family_id],
  );
  await insertAudit(client as PoolClient, {
    actor: "stripe",
    action: "elf.paid",
    entity: "elf_order",
    entityId: row.id,
    data: { reference: o.reference, sessionId: o.sessionId, detectives: row.detective_ids.length, openedFamily: !row.family_active },
  });
  return {
    orderId: row.id,
    familyId: row.family_id,
    email: row.email,
    grownUpName: row.grown_up_name,
    newsletter: row.newsletter,
    openedFamily: !row.family_active,
    detectives: detectives.rows
      .map((d) => ({ id: d.id, firstName: d.first_name, surname: d.surname, badgeNumber: d.badge_number }))
      .sort((a, b) => a.id - b.id),
  };
}

/** An abandoned checkout: pending to expired. A paid order is never touched. */
export async function expireElfOrder(client: Querier, reference: string): Promise<void> {
  await client.query("UPDATE elf_orders SET status = 'expired' WHERE reference = $1 AND status = 'pending'", [reference]);
}

// --- signing in --------------------------------------------------------------------------------------

/** The family for an email, only once it has paid for detectives. */
export async function activeFamilyByEmail(email: string): Promise<{ id: number; grownUpName: string } | null> {
  const r = await pool.query<{ id: number; grown_up_name: string }>(
    // A family a head elf has removed is not found, so it gets no sign in code (Head Elf HQ).
    "SELECT id, grown_up_name FROM elf_families WHERE email = $1 AND active AND removed_at IS NULL",
    [email.trim().toLowerCase()],
  );
  return r.rows[0] ? { id: r.rows[0].id, grownUpName: r.rows[0].grown_up_name } : null;
}

export async function saveElfSignInCode(email: string, codeHash: string, expiresAt: Date): Promise<void> {
  await pool.query(
    `INSERT INTO elf_sign_in_codes (email, code_hash, expires_at, attempts) VALUES ($1, $2, $3, 0)
     ON CONFLICT (email) DO UPDATE SET code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at, attempts = 0, created_at = now()`,
    [email.trim().toLowerCase(), codeHash, expiresAt],
  );
}

/** Count a try at the code BEFORE it is compared, so tries sent at once each use one up. */
export async function countElfCodeTry(email: string): Promise<{ codeHash: string; expiresAt: Date; attempts: number } | null> {
  const r = await pool.query<{ code_hash: string; expires_at: Date | string; attempts: number }>(
    "UPDATE elf_sign_in_codes SET attempts = attempts + 1 WHERE email = $1 RETURNING code_hash, expires_at, attempts",
    [email.trim().toLowerCase()],
  );
  const row = r.rows[0];
  return row ? { codeHash: row.code_hash, expiresAt: new Date(row.expires_at), attempts: row.attempts } : null;
}

export async function deleteElfSignInCode(email: string): Promise<void> {
  await pool.query("DELETE FROM elf_sign_in_codes WHERE email = $1", [email.trim().toLowerCase()]);
}

/** Start a session. Sessions and codes long past their time are tidied away on the way. */
export async function createElfSession(sessionHash: string, familyId: number, expiresAt: Date): Promise<void> {
  await pool.query("DELETE FROM elf_sessions WHERE expires_at < now() - interval '1 day'");
  await pool.query("DELETE FROM elf_sign_in_codes WHERE expires_at < now() - interval '1 day'");
  await pool.query("INSERT INTO elf_sessions (session_hash, family_id, expires_at) VALUES ($1, $2, $3)", [sessionHash, familyId, expiresAt]);
}

export async function findElfSession(sessionHash: string): Promise<{ familyId: number } | null> {
  const r = await pool.query<{ family_id: number }>(
    `SELECT s.family_id FROM elf_sessions s JOIN elf_families f ON f.id = s.family_id
      WHERE s.session_hash = $1 AND s.expires_at > now() AND f.active AND f.removed_at IS NULL`,
    [sessionHash],
  );
  return r.rows[0] ? { familyId: r.rows[0].family_id } : null;
}

/** End every session of a family but one: when someone proves the email with a code, a session
 *  made earlier by a browser that only paid (and never proved the email) stops working. */
export async function endOtherElfSessions(familyId: number, keepHash: string): Promise<void> {
  await pool.query("DELETE FROM elf_sessions WHERE family_id = $1 AND session_hash <> $2", [familyId, keepHash]);
}

export async function deleteElfSession(sessionHash: string): Promise<void> {
  await pool.query("DELETE FROM elf_sessions WHERE session_hash = $1", [sessionHash]);
}

/** What the page Stripe sends people back to needs to know about the order it paid for. */
export async function orderForWelcome(
  stripeSessionId: string,
): Promise<{ familyId: number; status: "pending" | "paid" | "expired"; openedFamily: boolean; browserTokenHash: string | null } | null> {
  const r = await pool.query<{ family_id: number; status: "pending" | "paid" | "expired"; opened_family: boolean; browser_token_hash: string | null }>(
    "SELECT family_id, status, opened_family, browser_token_hash FROM elf_orders WHERE stripe_session_id = $1",
    [stripeSessionId],
  );
  const row = r.rows[0];
  return row ? { familyId: row.family_id, status: row.status, openedFamily: row.opened_family, browserTokenHash: row.browser_token_hash } : null;
}

// --- Detective HQ and the wardrobe -------------------------------------------------------------------

/** A signed in family and its active detectives, oldest first. */
export async function familyWithDetectives(familyId: number): Promise<FamilyRow | null> {
  const f = await pool.query<{ id: number; grown_up_name: string; email: string }>("SELECT id, grown_up_name, email FROM elf_families WHERE id = $1 AND active", [familyId]);
  if (!f.rows[0]) return null;
  const d = await pool.query<{ id: number; first_name: string; surname: string; name_approved: boolean; badge_number: number | null; look: unknown; fresh: string[]; favourites: unknown }>(
    `SELECT id, first_name, surname, name_approved, badge_number, look, fresh, favourites FROM elf_detectives
      WHERE family_id = $1 AND active ORDER BY id`,
    [familyId],
  );
  return {
    id: f.rows[0].id,
    grownUpName: f.rows[0].grown_up_name,
    email: f.rows[0].email,
    detectives: d.rows.map((r) => ({
      id: r.id,
      firstName: r.first_name,
      surname: r.surname,
      nameApproved: r.name_approved,
      badgeNumber: r.badge_number,
      look: r.look,
      fresh: r.fresh ?? [],
      favourites: r.favourites ?? [],
    })),
  };
}

/**
 * Save a detective's look, for their own family only. The doors the detective has done are worked out
 * here, never taken from the page, and the look is made safe against them (normaliseLook), so a locked
 * costume is stored as none. A present opened (its costume id in `tried`) is taken off `fresh`; an id
 * sent twice, not a string, or not one of this detective's presents does no harm. With `favourites`,
 * those are made safe (normaliseFavourites) and stored; without, the stored ones stay. "not-found" for
 * a detective that is not this family's.
 */
export async function saveLook(o: {
  detectiveId: number;
  familyId: number;
  look: unknown;
  tried: unknown[];
  favourites?: unknown[];
  /** The doors this detective has done: the server's, never the page's. */
  doors: DoorsDone;
}): Promise<{ look: ElfLook; favourites: ElfLook[] } | "not-found"> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query<{ id: number; fresh: string[]; favourites: unknown }>(
      "SELECT id, fresh, favourites FROM elf_detectives WHERE id = $1 AND family_id = $2 AND active FOR UPDATE",
      [o.detectiveId, o.familyId],
    );
    if (!r.rows[0]) {
      await client.query("ROLLBACK");
      return "not-found";
    }
    const state = wardrobeState(o.doors);
    const look = normaliseLook(o.look, state);
    const tried = new Set(o.tried.filter((t): t is string => typeof t === "string"));
    const fresh = (r.rows[0].fresh ?? []).filter((k) => !tried.has(k));
    let favourites: ElfLook[];
    if (o.favourites) {
      favourites = normaliseFavourites(o.favourites, state);
      await client.query("UPDATE elf_detectives SET look = $2, fresh = $3, favourites = $4 WHERE id = $1", [o.detectiveId, JSON.stringify(look), fresh, JSON.stringify(favourites)]);
    } else {
      favourites = normaliseFavourites(r.rows[0].favourites, state);
      await client.query("UPDATE elf_detectives SET look = $2, fresh = $3 WHERE id = $1", [o.detectiveId, JSON.stringify(look), fresh]);
    }
    await client.query("COMMIT");
    return { look, favourites };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
