import { randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "./pool";
import { insertAudit } from "./donations";
import { ELF_DEFAULTS, type ElfSettings } from "../elf/settings";
import type { JoinBody } from "../elf/join";

// NBCC Elf Detective School: the data layer (tables in migrations/1791200000310_elf-school.js).
// Designs: docs/superpowers/specs/2026-10-04-elf-detective-school-design.md and
// 2026-11-03-elf-detective-secret-places-design.md. The rules themselves are pure, in src/elf/.

export { ELF_DEFAULTS, type ElfSettings };

interface SettingsRow {
  school_on: boolean;
  year: number;
  entry_from_pence: number;
  entry_suggested_pence: number;
}

const SETTINGS_SQL = "SELECT school_on, year, entry_from_pence, entry_suggested_pence FROM elf_settings WHERE id = 1";

function settingsFrom(row: SettingsRow | undefined): ElfSettings {
  if (!row) return { ...ELF_DEFAULTS };
  return {
    schoolOn: row.school_on,
    year: row.year,
    entryFromPence: row.entry_from_pence,
    entrySuggestedPence: row.entry_suggested_pence,
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
  } catch {
    return { ...ELF_DEFAULTS };
  }
}

const SETTING_COLUMNS = {
  schoolOn: "school_on",
  entryFromPence: "entry_from_pence",
  entrySuggestedPence: "entry_suggested_pence",
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
