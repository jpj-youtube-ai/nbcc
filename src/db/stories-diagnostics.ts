import { pool } from "./pool";
import { storiesPool } from "./stories-pool";

// TASK-308: a read-only look at WHERE the My Story data actually is.
//
// The admin Stories tab showed "No stories yet" - the EMPTY state, not the error state. That
// distinction matters: the query reached a database, found a `stories` table (an absent table would
// have errored), and got no rows back. Schema present, data absent, which is exactly what a
// freshly-created database looks like rather than a broken one.
//
// Every deploy runs a bootstrap that creates the stories database IF MISSING and builds its schema.
// Normally a no-op. But if the database NAME or credentials ever changed, that bootstrap would have
// made a new empty one and pointed the app at it - while the original sat alongside, untouched, full
// of the submissions nobody can see.
//
// So the useful question is not "is the table empty" (we know it is) but "is there another database
// on this server that is not". Answering it needs nothing more than a read, which is all this does.
//
// Strictly SELECT-only. It reports database NAMES and SIZES, never credentials and never story
// content - the whole point of the separate stories database is that its contents stay behind the
// consent model, and a diagnostic must not become a way around that.

export interface DatabaseOnInstance {
  name: string;
  /** Human-readable, e.g. "8329 kB". An empty database sits near the minimum; a populated one does not. */
  size: string;
  sizeBytes: number;
}

export interface StoriesDiagnostics {
  /** The database the app's stories pool is actually connected to right now. */
  connectedDatabase: string;
  storiesRowCount: number;
  /**
   * TASK-310: the id sequence's high-water mark - how many rows have EVER been created in this
   * table. It does not go backwards when rows are deleted, so it is the one number that separates
   * "no story was ever submitted here" from "stories existed and are gone".
   *
   * Null when the sequence cannot be read, which must not be mistaken for zero.
   */
  storiesEverCreated: number | null;
  /** Lifetime insert/delete counters. Reset if the server restarts stats, so treat as corroboration. */
  lifetimeInserts: number | null;
  lifetimeDeletes: number | null;
  /** Migration names recorded in the stories database, newest last. */
  migrationsApplied: string[];
  /** Every database on the same server, largest first - an orphaned copy shows up here. */
  databasesOnInstance: DatabaseOnInstance[];
}

export async function readStoriesDiagnostics(): Promise<StoriesDiagnostics> {
  const [who, count, migrations, everCreated, churn] = await Promise.all([
    storiesPool.query<{ db: string }>(`SELECT current_database() AS db`),
    storiesPool.query<{ n: string }>(`SELECT count(*) AS n FROM stories`),
    // node-pg-migrate records what it has run. An empty stories database that has just been
    // bootstrapped still shows every migration, so this tells us the schema is current, not that
    // data ever existed.
    storiesPool
      .query<{ name: string }>(`SELECT name FROM pgmigrations ORDER BY run_on ASC, id ASC`)
      .catch(() => ({ rows: [] as { name: string }[] })),
    // TASK-310: the high-water mark. pg_sequences is read WITHOUT touching the sequence - last_value
    // is null until the sequence has been used at least once, which is itself the answer.
    storiesPool
      .query<{ last_value: string | null }>(
        `SELECT last_value FROM pg_sequences
          WHERE schemaname = 'public' AND sequencename = 'stories_id_seq'`,
      )
      .catch(() => ({ rows: [] as { last_value: string | null }[] })),
    storiesPool
      .query<{ ins: string; del: string }>(
        `SELECT n_tup_ins AS ins, n_tup_del AS del
           FROM pg_stat_user_tables WHERE relname = 'stories'`,
      )
      .catch(() => ({ rows: [] as { ins: string; del: string }[] })),
  ]);

  // Listed through the MAIN pool: the app user has CREATEDB/CREATEROLE on RDS (it is what the
  // stories bootstrap relies on), so it can see the server's database catalogue. The stories user
  // deliberately cannot.
  const databases = await pool
    .query<{ name: string; size: string; size_bytes: string }>(
      `SELECT datname AS name,
              pg_size_pretty(pg_database_size(datname)) AS size,
              pg_database_size(datname) AS size_bytes
         FROM pg_database
        WHERE datallowconn AND NOT datistemplate
        ORDER BY pg_database_size(datname) DESC`,
    )
    .catch(() => ({ rows: [] as { name: string; size: string; size_bytes: string }[] }));

  const seq = everCreated.rows[0]?.last_value;
  const stats = churn.rows[0];

  return {
    connectedDatabase: who.rows[0]?.db ?? "(unknown)",
    storiesRowCount: Number(count.rows[0]?.n ?? 0),
    // A sequence that has never been used reports null, which genuinely means "none ever created".
    // A sequence we could not READ also gives us nothing - but that arrives as an empty result set,
    // so the two are distinguishable and only the former becomes 0.
    storiesEverCreated: everCreated.rows.length === 0 ? null : seq == null ? 0 : Number(seq),
    lifetimeInserts: stats ? Number(stats.ins) : null,
    lifetimeDeletes: stats ? Number(stats.del) : null,
    migrationsApplied: migrations.rows.map((r) => r.name),
    databasesOnInstance: databases.rows.map((r) => ({
      name: r.name,
      size: r.size,
      sizeBytes: Number(r.size_bytes),
    })),
  };
}
