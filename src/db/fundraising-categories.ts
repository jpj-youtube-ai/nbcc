import type { PoolClient } from "pg";
import { pool } from "./pool";
import { insertAudit } from "./donations";
import {
  ALL_BUILT_IN_CATEGORIES,
  OTHER_KIND,
  categoryKeyFor,
  knownCategories,
  rememberCategories,
  sortCategories,
  type Category,
} from "../fundraising/categories";

// The fundraising categories table (migrations/1791200000160), and the list as last read.
//
// The sign up form and the checks on a sign up's category use the list as last read, kept for a
// minute (CATEGORY_CACHE_MS). A change made here is read again at once on this server; another
// server sees it within the minute, and reads afresh sooner whenever a sign up names a category it
// has not seen (loadCategories({ fresh: true })). Every name shown with a sign up comes with the row
// itself (src/db/fundraisers.ts), so a rename shows everywhere at once.
//
// Every change writes its audit_log row in the same transaction, against entity
// "fundraising_category" (its key is in the data: audit_log.entity_id is a number).

export const CATEGORY_CACHE_MS = 60_000;

export type CategoryErrorReason = "not_found" | "label_taken" | "other_always_on";

export class CategoryError extends Error {
  constructor(
    public readonly reason: CategoryErrorReason,
    /** For label_taken: the category that already has the name. */
    public readonly key?: string,
  ) {
    super(reason);
  }
}

type Row = Record<string, unknown>;
const iso = (v: unknown): string | null => (v == null ? null : new Date(v as string).toISOString());

function toCategory(r: Row): Category {
  return {
    key: String(r.key),
    label: String(r.label),
    active: Boolean(r.active),
    // The sign up tidy (migrations/1791200000210): false until an admin ticks Sporting.
    sporty: r.sporty === true,
    memoryOnly: r.memory_only === true,
    createdAt: iso(r.created_at),
    createdBy: r.created_by == null ? null : String(r.created_by),
    retiredAt: iso(r.retired_at),
    used: Number(r.used ?? 0) || 0,
  };
}

const COLUMNS = "key, label, active, sporty, memory_only, created_at, created_by, retired_at";

/**
 * Every category, A to Z with Other last. With used, how many sign ups have each (the admin's card
 * only: the list kept for the form never counts them).
 */
export async function listCategories(o: { used?: boolean } = {}): Promise<Category[]> {
  const used = o.used ? ",\n            (SELECT count(*) FROM fundraisers f WHERE f.kind = c.key) AS used" : "";
  const r = await pool.query(`SELECT c.key, c.label, c.active, c.sporty, c.memory_only, c.created_at, c.created_by, c.retired_at${used}
       FROM fundraising_categories c`);
  return sortCategories(r.rows.map(toCategory));
}

/** Another admin took the name (or the key) a moment before: the unique index says so. */
function takenInTheMeantime(err: unknown): never {
  if (typeof err === "object" && err !== null && (err as { code?: string }).code === "23505") throw new CategoryError("label_taken");
  throw err;
}

let readAt = 0;
let cached: Category[] | null = null;

/** Forget the list as last read, so the next loadCategories reads it again. */
export function forgetCategories(): void {
  readAt = 0;
  cached = null;
}

/**
 * The list, as read in the last minute, or read now (fresh: always read now). Remembered for the
 * sign up rules and the names (rememberCategories). Never throws: if the database cannot answer,
 * the list last read stands, or the built in one before any has been.
 */
export async function loadCategories(o: { fresh?: boolean; now?: number } = {}): Promise<Category[]> {
  const now = o.now ?? Date.now();
  if (!o.fresh && cached && now - readAt < CATEGORY_CACHE_MS) return cached;
  try {
    const list = await listCategories();
    cached = list;
    readAt = now;
    rememberCategories(list);
    return list;
  } catch (err) {
    console.error("fundraising categories read failed:", err instanceof Error ? err.message : err);
    return cached ?? (knownCategories().length ? knownCategories() : sortCategories([...ALL_BUILT_IN_CATEGORIES]));
  }
}

async function inTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** After a change here: this server reads the list again now, so the form shows it at once. */
async function rereadAfterChange(): Promise<void> {
  forgetCategories();
  await loadCategories({ fresh: true });
}

/** Add a category, on offer at once. Its key is made from its name; a name already there is refused. */
export async function addCategory(label: string, actor: string): Promise<Category> {
  const added = await inTransaction(async (client) => {
    // One at a time, so two admins adding at once can never be given the same key.
    await client.query("LOCK TABLE fundraising_categories IN SHARE ROW EXCLUSIVE MODE");
    const all = await client.query<{ key: string; label: string }>("SELECT key, label FROM fundraising_categories");
    const same = all.rows.find((r) => r.label.toLowerCase() === label.toLowerCase());
    if (same) throw new CategoryError("label_taken", same.key);
    const key = categoryKeyFor(label, all.rows.map((r) => r.key));
    const r = await client
      .query(`INSERT INTO fundraising_categories (key, label, active, created_by) VALUES ($1, $2, true, $3) RETURNING ${COLUMNS}`, [
        key,
        label,
        actor,
      ])
      .catch(takenInTheMeantime);
    await insertAudit(client, {
      actor,
      action: "fundraising.category_added",
      entity: "fundraising_category",
      entityId: null,
      data: { key, label },
    });
    return toCategory(r.rows[0]);
  });
  await rereadAfterChange();
  return added;
}

/**
 * Rename a category, or take it off the form (active false) or put it back, or mark it sporting or
 * not (the sign up tidy). Never deletes: the sign ups that have it keep it, under its name. Other is
 * always on the form.
 */
export async function updateCategory(
  key: string,
  change: { label?: string; active?: boolean; sporty?: boolean },
  actor: string,
): Promise<Category> {
  const after = await inTransaction(async (client) => {
    const found = await client.query<{ key: string; label: string; active: boolean; sporty: boolean }>(
      "SELECT key, label, active, sporty FROM fundraising_categories WHERE key = $1 FOR UPDATE",
      [key],
    );
    const before = found.rows[0];
    if (!before) throw new CategoryError("not_found");
    if (key === OTHER_KIND && change.active === false) throw new CategoryError("other_always_on");
    const label = change.label ?? before.label;
    const active = change.active ?? before.active;
    const sporty = change.sporty ?? before.sporty === true;
    if (label.toLowerCase() !== before.label.toLowerCase()) {
      const clash = await client.query<{ key: string }>(
        "SELECT key FROM fundraising_categories WHERE lower(label) = lower($1) AND key <> $2",
        [label, key],
      );
      if (clash.rows[0]) throw new CategoryError("label_taken", clash.rows[0].key);
    }
    const r = await client
      .query(
        `UPDATE fundraising_categories
            SET label = $2, active = $3, sporty = $4,
                retired_at = CASE WHEN $3 THEN NULL ELSE COALESCE(retired_at, now()) END
          WHERE key = $1
          RETURNING ${COLUMNS}`,
        [key, label, active, sporty],
      )
      .catch(takenInTheMeantime);
    await insertAudit(client, {
      actor,
      action: "fundraising.category_changed",
      entity: "fundraising_category",
      entityId: null,
      data: {
        key,
        label,
        ...(active !== before.active ? { active } : {}),
        ...(sporty !== (before.sporty === true) ? { sporty } : {}),
        was: { label: before.label, active: before.active, sporty: before.sporty === true },
      },
    });
    return toCategory(r.rows[0]);
  });
  await rereadAfterChange();
  return after;
}
