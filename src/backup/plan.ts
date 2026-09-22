import { readdirSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// TASK-423: the single source of truth for what "everything" means in the nightly backup.
//
// NBCC runs THREE databases, not one. The main charity database, and two deliberately isolated
// ones so the public "My Story" form and the contact form can never read or write donor data (see
// STORIES_DATABASE_URL / CONTACT_DATABASE_URL in src/config/schema.ts, and src/db/stories-pool.ts
// / src/db/contact-pool.ts). That isolation is good for security and a trap for backups: the
// obvious `pg_dump $DATABASE_URL` captures 42 of 44 tables and silently drops every story
// submission and every contact enquiry, while still producing a file of entirely plausible size.
//
// Adding a database to this list is what makes it get backed up. test/unit/backup-plan.test.ts
// reads the migration directories off disk and fails if one exists that this file does not name,
// so a fourth database cannot be added without the backup noticing.

export type BackupDatabase = {
  /** The config key holding its connection string. */
  configKey: "DATABASE_URL" | "STORIES_DATABASE_URL" | "CONTACT_DATABASE_URL";
  /** Its migrations directory, which is also the proof the database exists. */
  migrationsDir: string;
  /** Folder name inside the archive. Must be unique. */
  label: string;
};

export const BACKUP_DATABASES: BackupDatabase[] = [
  { configKey: "DATABASE_URL", migrationsDir: "migrations", label: "main" },
  { configKey: "STORIES_DATABASE_URL", migrationsDir: "migrations-stories", label: "stories" },
  { configKey: "CONTACT_DATABASE_URL", migrationsDir: "migrations-contact", label: "contact" },
];

/**
 * Every table a database's migrations create, read from the migrations themselves rather than
 * from a list someone has to remember to update. `root` is passed in rather than derived from
 * __dirname: this module is compiled to CommonJS for production but loaded as ESM by Vitest, and
 * __dirname is not reliably defined in both.
 */
export function tablesIn(root: string, migrationsDir: string): string[] {
  const dir = resolve(root, migrationsDir);
  if (!existsSync(dir)) return [];
  const tables = new Set<string>();
  for (const file of readdirSync(dir).filter((n) => n.endsWith(".js"))) {
    const src = readFileSync(resolve(dir, file), "utf8");
    // The table name sits on the line AFTER createTable( in most of these files, so this has to
    // tolerate whitespace and newlines between the paren and the name.
    for (const m of src.matchAll(/createTable\(\s*["'`]([a-z_]+)["'`]/g)) tables.add(m[1]);
  }
  return [...tables].sort();
}

/**
 * How many tables a complete backup should contain. The run aborts rather than uploading if the
 * dump produces fewer: a half-finished dump still writes a file, and without this check it would
 * replace a good archive with a broken one, night after night, until nothing good was left.
 */
export function expectedTableCount(root: string): number {
  return BACKUP_DATABASES.reduce((n, db) => n + tablesIn(root, db.migrationsDir).length, 0);
}
