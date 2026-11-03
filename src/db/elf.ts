import type { PoolClient } from "pg";
import { pool } from "./pool";
import { insertAudit } from "./donations";
import { ELF_DEFAULTS, type ElfSettings } from "../elf/settings";

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
