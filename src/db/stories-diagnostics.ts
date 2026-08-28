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
  /** Migration names recorded in the stories database, newest last. */
  migrationsApplied: string[];
  /** Every database on the same server, largest first - an orphaned copy shows up here. */
  databasesOnInstance: DatabaseOnInstance[];
}

export async function readStoriesDiagnostics(): Promise<StoriesDiagnostics> {
  const [who, count, migrations] = await Promise.all([
    storiesPool.query<{ db: string }>(`SELECT current_database() AS db`),
    storiesPool.query<{ n: string }>(`SELECT count(*) AS n FROM stories`),
    // node-pg-migrate records what it has run. An empty stories database that has just been
    // bootstrapped still shows every migration, so this tells us the schema is current, not that
    // data ever existed.
    storiesPool
      .query<{ name: string }>(`SELECT name FROM pgmigrations ORDER BY run_on ASC, id ASC`)
      .catch(() => ({ rows: [] as { name: string }[] })),
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

  return {
    connectedDatabase: who.rows[0]?.db ?? "(unknown)",
    storiesRowCount: Number(count.rows[0]?.n ?? 0),
    migrationsApplied: migrations.rows.map((r) => r.name),
    databasesOnInstance: databases.rows.map((r) => ({
      name: r.name,
      size: r.size,
      sizeBytes: Number(r.size_bytes),
    })),
  };
}
