import type { PoolClient } from "pg";
import { pool } from "./pool";
import { insertAudit } from "./donations";
import { redBagList, type RedBagList, type RedBagListProblem } from "../red-bag/list";

// Fill a Red Bag: the versions of the list staff edit, in the red_bag_lists table
// (migrations/1791200000260_red-bag-lists.js). A row is a whole list: the ONE shared draft
// (status 'draft', at most one, with a stamp that moves on with every save), or a list that was
// published (status 'published', kept for ever: the history). The website's list is the one
// published last. With none published, the website uses the list written in the catalogue.
//
// Two halves, kept apart on purpose:
//
//   THE PUBLIC PAGE reads loadPublishedRedBagList, and nothing else here. It is as careful as
//   loadImpactExamples and then some: kept for a minute, read again at once on this server after a
//   publish, and it NEVER throws and never waits long. If the database cannot answer, hangs, or
//   holds a list that fails the list's own rules, the page gets the last good list, or null (the
//   built-in list), and it is said once in the log. /fill must not fail or slow because of this.
//
//   THE ADMIN reads and writes the rest, and those DO throw: the screen then says it could not
//   load, or the save says it did not work. Every write checks the stamp inside one transaction
//   with the draft's row locked, so two people can never overwrite each other unseen; publish,
//   throw away and put back each write their audit_log row in that same transaction.

export const RED_BAG_LIST_CACHE_MS = 60_000;
/** After a read that failed, how long the last good list stands before the database is asked again. */
export const RED_BAG_LIST_RETRY_MS = 10_000;
/** How long a page view will wait on the database for the list before carrying on without it. */
export const RED_BAG_LIST_READ_TIMEOUT_MS = 1_500;

/**
 * stale: the draft (or the website's list) has changed since the screen was opened.
 * invalid: the list fails its rules (`problems` says where). nothing: the draft says what the
 * website already says. not_found: no such published version.
 */
export class RedBagListError extends Error {
  constructor(
    public readonly reason: "stale" | "invalid" | "nothing" | "not_found",
    public readonly problems: RedBagListProblem[] = [],
  ) {
    super(reason);
  }
}

/** Who is doing it: the audit actor ("admin:someone@nbcc.scot") and the name the history shows. */
export interface RedBagListWho {
  actor: string;
  name: string;
}

/** What the screen had open when it sent a change: the draft's stamp (0: no draft) and the website's list. */
export interface RedBagListStamp {
  version: number;
  publishedId: number | null;
}

export interface RedBagDraft {
  data: RedBagList;
  version: number;
  updatedAt: string | null;
  updatedByName: string | null;
  /** The published version it was put back from, "original" for the built-in list, or null. */
  restoredFrom: number | "original" | null;
}

export interface RedBagVersion {
  id: number;
  publishedAt: string | null;
  publishedByName: string | null;
  /** One line: the first few changes. */
  summary: string;
  /** Every change it made to the website, in plain words. */
  changes: string[];
  restoredFrom: number | null;
  restoredOriginal: boolean;
}

export interface RedBagEditorState {
  /** The website's list: the one published last, or the built-in list. */
  website: RedBagList;
  /** The id of the list published last; null while the website uses the built-in list. */
  publishedId: number | null;
  draft: RedBagDraft | null;
  history: RedBagVersion[];
}

type Row = Record<string, unknown>;
const iso = (v: unknown): string | null => (v == null ? null : new Date(v as string).toISOString());
const text = (v: unknown): string | null => (v == null ? null : String(v));

const VERSION_COLUMNS = "id, summary, changes, restored_from, restored_original, published_at, published_by_name";
const DRAFT_COLUMNS = "id, data, version, restored_from, restored_original, updated_at, updated_by_name";

function toVersion(r: Row): RedBagVersion {
  return {
    id: Number(r.id),
    publishedAt: iso(r.published_at),
    publishedByName: text(r.published_by_name),
    summary: text(r.summary) ?? "",
    changes: Array.isArray(r.changes) ? r.changes.map(String) : [],
    restoredFrom: r.restored_from == null ? null : Number(r.restored_from),
    restoredOriginal: Boolean(r.restored_original),
  };
}

/** A stored list as a list, or the built-in one if what is stored is not the shape of a list. */
function listOf(data: unknown): RedBagList {
  return redBagList().clean(data) ?? redBagList().builtIn();
}

function toDraft(r: Row): RedBagDraft {
  return {
    data: listOf(r.data),
    version: Number(r.version) || 1,
    updatedAt: iso(r.updated_at),
    updatedByName: text(r.updated_by_name),
    restoredFrom: r.restored_original ? "original" : r.restored_from == null ? null : Number(r.restored_from),
  };
}

// ------------------------------------------------------------------------------------------------
// The public page's read
// ------------------------------------------------------------------------------------------------

const LATEST_PUBLISHED = `SELECT id, data FROM red_bag_lists
  WHERE status = 'published'
  ORDER BY published_at DESC, id DESC
  LIMIT 1`;

let cached: { list: RedBagList | null } | null = null; // null: nothing read yet
let readAt = 0;
let complained = false;
let reading: Promise<RedBagList | null> | null = null;

/** Forget the list as last read, so the next loadPublishedRedBagList reads it again. */
export function forgetPublishedRedBagList(): void {
  cached = null;
  readAt = 0;
  complained = false;
  reading = null;
}

const copy = (list: RedBagList | null): RedBagList | null => (list ? (JSON.parse(JSON.stringify(list)) as RedBagList) : null);

function within<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((done, fail) => {
    const timer = setTimeout(() => fail(new Error(`no answer in ${ms}ms`)), ms);
    if (typeof timer === "object" && typeof timer.unref === "function") timer.unref();
    work.then(
      (v) => {
        clearTimeout(timer);
        done(v);
      },
      (e) => {
        clearTimeout(timer);
        fail(e);
      },
    );
  });
}

async function readNow(now: number): Promise<RedBagList | null> {
  try {
    const r = await within(pool.query(LATEST_PUBLISHED), RED_BAG_LIST_READ_TIMEOUT_MS);
    const row = r.rows[0] as Row | undefined;
    let list: RedBagList | null = null;
    if (row) {
      const rules = redBagList();
      list = rules.clean(row.data);
      if (!list || rules.validate(list).length) throw new Error(`the published list (id ${String(row.id)}) does not pass the list's rules`);
    }
    cached = { list };
    readAt = now;
    complained = false;
    return list;
  } catch (err) {
    if (!complained) {
      console.error("fill a red bag list read failed, using the last good list:", err instanceof Error ? err.message : err);
      complained = true;
    }
    // The last good list stands (the built-in one, before any was read), and the database is left
    // alone for a short while rather than asked again by every page view.
    if (!cached) cached = { list: null };
    readAt = now - RED_BAG_LIST_CACHE_MS + RED_BAG_LIST_RETRY_MS;
    return cached.list;
  }
}

/**
 * The website's list for the public page: the one published last, as read in the last minute, or
 * read now (fresh: always read now). Null means none is published: use the built-in list. NEVER
 * throws and never waits more than a moment; see the top of this file. Each caller gets its own copy.
 */
export async function loadPublishedRedBagList(o: { fresh?: boolean; now?: number } = {}): Promise<RedBagList | null> {
  const now = o.now ?? Date.now();
  if (!o.fresh && cached && now - readAt < RED_BAG_LIST_CACHE_MS) return copy(cached.list);
  if (!reading || o.fresh) {
    const mine: Promise<RedBagList | null> = readNow(now).finally(() => {
      if (reading === mine) reading = null;
    });
    reading = mine;
  }
  try {
    return copy(await reading);
  } catch {
    return copy(cached ? cached.list : null);
  }
}

// ------------------------------------------------------------------------------------------------
// The admin's reads
// ------------------------------------------------------------------------------------------------

/** Everything the editor shows: the website's list, the draft and the history (newest first). */
export async function readRedBagEditor(): Promise<RedBagEditorState> {
  const [draft, latest, history] = await Promise.all([
    pool.query(`SELECT ${DRAFT_COLUMNS} FROM red_bag_lists WHERE status = 'draft'`),
    pool.query(LATEST_PUBLISHED),
    pool.query(`SELECT ${VERSION_COLUMNS} FROM red_bag_lists WHERE status = 'published' ORDER BY published_at DESC, id DESC LIMIT 100`),
  ]);
  const published = latest.rows[0] as Row | undefined;
  return {
    website: published ? listOf(published.data) : redBagList().builtIn(),
    publishedId: published ? Number(published.id) : null,
    draft: draft.rows[0] ? toDraft(draft.rows[0] as Row) : null,
    history: history.rows.map((r) => toVersion(r as Row)),
  };
}

/** One published version with its list, to look at; null if there is no such published version. */
export async function readRedBagVersion(id: number): Promise<(RedBagVersion & { data: RedBagList }) | null> {
  const r = await pool.query(`SELECT ${VERSION_COLUMNS}, data FROM red_bag_lists WHERE id = $1 AND status = 'published'`, [id]);
  const row = r.rows[0] as Row | undefined;
  return row ? { ...toVersion(row), data: listOf(row.data) } : null;
}

/** The draft, for the preview of the page; null when there is none. Throws if it cannot be read. */
export async function readRedBagDraft(): Promise<RedBagDraft | null> {
  const r = await pool.query(`SELECT ${DRAFT_COLUMNS} FROM red_bag_lists WHERE status = 'draft'`);
  return r.rows[0] ? toDraft(r.rows[0] as Row) : null;
}

/** The name the history shows for a member of staff: their full name, or their email address. */
export async function redBagStaffName(userId: number, email: string): Promise<string> {
  try {
    const r = await pool.query<{ full_name: string | null }>("SELECT full_name FROM users WHERE id = $1", [userId]);
    return (r.rows[0]?.full_name ?? "").trim() || email;
  } catch {
    return email;
  }
}

// ------------------------------------------------------------------------------------------------
// The admin's writes
// ------------------------------------------------------------------------------------------------

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

interface Held {
  /** The draft's row, locked for this transaction; null when there is no draft. */
  draft: Row | null;
  /** The website's list just now. */
  website: RedBagList;
  publishedId: number | null;
}

/** The draft, locked, and the website's list, read inside the transaction every write runs in. */
async function hold(client: PoolClient): Promise<Held> {
  const d = await client.query(`SELECT ${DRAFT_COLUMNS} FROM red_bag_lists WHERE status = 'draft' FOR UPDATE`);
  const p = await client.query(LATEST_PUBLISHED);
  const published = p.rows[0] as Row | undefined;
  return {
    draft: (d.rows[0] as Row | undefined) ?? null,
    website: published ? listOf(published.data) : redBagList().builtIn(),
    publishedId: published ? Number(published.id) : null,
  };
}

/**
 * Is what the screen had open still what is there? With a draft: its stamp must be the one sent.
 * With none: the screen must have known there was none (stamp 0) AND have been looking at the list
 * that is still the website's, so a draft is never started from a list someone has since replaced.
 */
function stillCurrent(held: Held, stamp: RedBagListStamp): boolean {
  if (held.draft) return Number(held.draft.version) === stamp.version;
  return stamp.version === 0 && held.publishedId === stamp.publishedId;
}

const isUniqueViolation = (err: unknown): boolean => typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";

/** Write `data` as the draft: over the one there is (its stamp moves on by one), or as a new one. */
async function writeDraft(
  client: PoolClient,
  held: Held,
  data: RedBagList,
  who: RedBagListWho,
  from: { id: number | null; original: boolean } | null,
): Promise<Row> {
  const json = JSON.stringify(data);
  if (held.draft) {
    // Put back: the note of where it came from is replaced. A plain save keeps whatever it had.
    const r = from
      ? await client.query(
          `UPDATE red_bag_lists
              SET data = $1::jsonb, version = version + 1, updated_at = now(), updated_by = $2, updated_by_name = $3,
                  restored_from = $5, restored_original = $6
            WHERE id = $4 AND status = 'draft'
            RETURNING ${DRAFT_COLUMNS}`,
          [json, who.actor, who.name, held.draft.id, from.id, from.original],
        )
      : await client.query(
          `UPDATE red_bag_lists
              SET data = $1::jsonb, version = version + 1, updated_at = now(), updated_by = $2, updated_by_name = $3
            WHERE id = $4 AND status = 'draft'
            RETURNING ${DRAFT_COLUMNS}`,
          [json, who.actor, who.name, held.draft.id],
        );
    if (!r.rows[0]) throw new RedBagListError("stale");
    return r.rows[0] as Row;
  }
  try {
    const r = await client.query(
      `INSERT INTO red_bag_lists (status, data, version, created_by, updated_by, updated_by_name, restored_from, restored_original)
       VALUES ('draft', $1::jsonb, 1, $2, $2, $3, $4, $5)
       RETURNING ${DRAFT_COLUMNS}`,
      [json, who.actor, who.name, from ? from.id : null, from ? from.original : false],
    );
    return r.rows[0] as Row;
  } catch (err) {
    // The table allows one draft: someone else started one in the same instant.
    if (isUniqueViolation(err)) throw new RedBagListError("stale");
    throw err;
  }
}

/**
 * Save the draft. The list is tidied and checked first (invalid: nothing is stored). Refused
 * (stale) if the draft, or the website's list under a draft not yet started, has changed since the
 * screen was opened: nothing is lost on the server. Not audited: only what reaches the public is.
 */
export async function saveRedBagDraft(raw: unknown, stamp: RedBagListStamp, who: RedBagListWho): Promise<RedBagDraft> {
  const rules = redBagList();
  const problems = rules.validate(raw);
  const data = rules.clean(raw);
  if (problems.length || !data) throw new RedBagListError("invalid", problems);
  return inTransaction(async (client) => {
    const held = await hold(client);
    if (!stillCurrent(held, stamp)) throw new RedBagListError("stale");
    return toDraft(await writeDraft(client, held, data, who, null));
  });
}

/**
 * Publish: the draft becomes the website's list. Checked again against the rules, and refused if
 * it says nothing new. Its row is kept as it is published, with who, when and every change in
 * plain words. Afterwards this server reads the list again at once, so /fill shows it.
 */
export async function publishRedBagDraft(version: number, who: RedBagListWho): Promise<RedBagVersion> {
  const rules = redBagList();
  const published = await inTransaction(async (client) => {
    const held = await hold(client);
    if (!held.draft || Number(held.draft.version) !== version) throw new RedBagListError("stale");
    const problems = rules.validate(held.draft.data);
    if (problems.length) throw new RedBagListError("invalid", problems);
    const changes = rules.diff(held.website, held.draft.data);
    if (!changes.length) throw new RedBagListError("nothing");
    const lines = changes.map((c) => c.text);
    const summary = rules.summary(changes);
    const r = await client.query(
      `UPDATE red_bag_lists
          SET status = 'published', published_at = now(), published_by = $2, published_by_name = $3, summary = $4, changes = $5::jsonb
        WHERE id = $1 AND status = 'draft'
        RETURNING ${VERSION_COLUMNS}`,
      [held.draft.id, who.actor, who.name, summary, JSON.stringify(lines)],
    );
    if (!r.rows[0]) throw new RedBagListError("stale");
    const row = r.rows[0] as Row;
    await insertAudit(client, {
      actor: who.actor,
      action: "red_bag.list_published",
      entity: "red_bag_list",
      entityId: Number(row.id),
      data: { summary, changes: lines, replaced: held.publishedId },
    });
    return toVersion(row);
  });
  forgetPublishedRedBagList();
  await loadPublishedRedBagList({ fresh: true });
  return published;
}

/** Throw the draft away. The website is untouched. Audited with what was dropped. */
export async function discardRedBagDraft(version: number, who: RedBagListWho): Promise<void> {
  const rules = redBagList();
  await inTransaction(async (client) => {
    const held = await hold(client);
    if (!held.draft || Number(held.draft.version) !== version) throw new RedBagListError("stale");
    const changes = rules.diff(held.website, held.draft.data);
    await client.query("DELETE FROM red_bag_lists WHERE id = $1 AND status = 'draft'", [held.draft.id]);
    await insertAudit(client, {
      actor: who.actor,
      action: "red_bag.draft_thrown_away",
      entity: "red_bag_list",
      entityId: Number(held.draft.id),
      data: { summary: rules.summary(changes), changes: changes.map((c) => c.text) },
    });
  });
}

/**
 * Put an earlier list back AS A DRAFT: a published version by its id, or "original" for the list
 * written in the catalogue. The website is untouched; the draft is then looked at, previewed and
 * published like any other. Replaces the draft there is, so the stamp is checked. Audited.
 */
export async function restoreRedBagList(from: number | "original", stamp: RedBagListStamp, who: RedBagListWho): Promise<RedBagDraft> {
  const rules = redBagList();
  return inTransaction(async (client) => {
    const held = await hold(client);
    if (!stillCurrent(held, stamp)) throw new RedBagListError("stale");
    let data: RedBagList;
    if (from === "original") data = rules.builtIn();
    else {
      const r = await client.query("SELECT id, data FROM red_bag_lists WHERE id = $1 AND status = 'published'", [from]);
      const found = r.rows[0] as Row | undefined;
      const stored = found ? rules.clean(found.data) : null;
      if (!stored) throw new RedBagListError("not_found");
      data = stored;
    }
    const row = await writeDraft(client, held, data, who, { id: from === "original" ? null : from, original: from === "original" });
    await insertAudit(client, { actor: who.actor, action: "red_bag.list_put_back", entity: "red_bag_list", entityId: Number(row.id), data: { from } });
    return toDraft(row);
  });
}
