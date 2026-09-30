import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "../config";
import { createS3Client } from "../clients/s3";
import { createCredentialProvider } from "../clients/aws-sigv4";
import { archiveName } from "../backup/run";
import { BACKUP_DATABASES } from "../backup/plan";
import { libpqEnvFromUrl, scrubConnectionStrings } from "../backup/pg-tools";
import type { Manifest } from "../backup/manifest";
import {
  assertSafeRestoreTarget,
  compareRestore,
  describeVerdict,
  scratchDatabaseName,
  type RestoredCounts,
} from "../backup/restore-check";

// TASK-452: prove the backup can be turned back into a database.
//
// Everything else proves a FILE is produced and stored in two places. It does not prove the file is
// worth anything. This pulls the archive back out of S3, unpacks it with the real passphrase,
// rebuilds every database into a THROWAWAY copy, counts the rows, compares them to the manifest,
// and drops the copies.
//
// It never writes to a live database. assertSafeRestoreTarget refuses any target that is not
// provably a throwaway, and it is called immediately before every create, restore and drop rather
// than once at the top - a guard you can walk past is not a guard.

const exec = promisify(execFile);

// Same contract as the backup's runner: the connection details go in the ENVIRONMENT, never argv,
// so a failure message cannot carry the database password into a log (TASK-427).
async function run(cmd: string, args: string[], env?: NodeJS.ProcessEnv) {
  try {
    return await exec(cmd, args, { env: env ?? process.env, maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    throw new Error(scrubConnectionStrings(err instanceof Error ? err.message : String(err)));
  }
}

/** psql against the maintenance database, for CREATE/DROP DATABASE. */
function adminEnv(): NodeJS.ProcessEnv {
  return { ...process.env, ...libpqEnvFromUrl(config.DATABASE_URL), PGDATABASE: "postgres" };
}

/** psql against one restored throwaway. */
function scratchEnv(name: string): NodeJS.ProcessEnv {
  assertSafeRestoreTarget(name);
  return { ...process.env, ...libpqEnvFromUrl(config.DATABASE_URL), PGDATABASE: name };
}

async function dropScratch(name: string): Promise<void> {
  assertSafeRestoreTarget(name);
  // WITH (FORCE) so a lingering connection cannot leave a throwaway database behind for ever.
  await run("psql", ["-v", "ON_ERROR_STOP=1", "-c", `DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`], adminEnv());
}

async function main(): Promise<void> {
  if (!config.BACKUP_S3_BUCKET || !config.BACKUP_ARCHIVE_PASSPHRASE) {
    console.error("RESTORE_SKIPPED backups are not configured");
    process.exitCode = 1;
    return;
  }

  // The same construction the backup uses, so this reads the bucket the backup writes.
  const s3 = createS3Client({
    bucket: config.BACKUP_S3_BUCKET,
    region: config.BACKUP_S3_REGION,
    credentials: createCredentialProvider({
      accessKeyId: config.AWS_ACCESS_KEY_ID,
      secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
      sessionToken: config.AWS_SESSION_TOKEN,
      containerCredentialsRelativeUri: config.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI,
    }),
  });

  // The manifest is written only after the archive it describes is safely stored, so it always
  // describes a real archive rather than an attempt.
  const manifest = await s3.getJson<Manifest>("latest-manifest.json");
  if (!manifest) {
    console.error("RESTORE_FAILED no manifest in S3: there is no backup to verify");
    process.exitCode = 1;
    return;
  }

  // Restore the archive the manifest is FOR, not today's. Verifying a different file from the one
  // whose row counts you are comparing against would pass or fail for the wrong reasons.
  const name = archiveName(new Date(manifest.takenAt));
  const archive = await s3.getBytes(`archives/${name}`);
  if (!archive) {
    console.error(`RESTORE_FAILED the manifest describes ${name}, which is not in the bucket`);
    process.exitCode = 1;
    return;
  }

  console.log(`Verifying ${name} (${archive.byteLength} bytes), taken ${manifest.takenAt}`);

  const work = await mkdtemp(join(tmpdir(), "restore-check-"));
  const created: string[] = [];
  try {
    const archivePath = join(work, name);
    await writeFile(archivePath, archive);

    // Unpack with the real passphrase. If this fails the archive is not recoverable, which is
    // exactly the thing worth finding out now rather than in an emergency.
    const payload = join(work, "payload");
    await run("7z", ["x", `-p${config.BACKUP_ARCHIVE_PASSPHRASE}`, `-o${payload}`, "-y", archivePath]);

    const restored: RestoredCounts = {};
    const now = new Date();

    for (const db of BACKUP_DATABASES) {
      const target = scratchDatabaseName(db.label, now);
      assertSafeRestoreTarget(target);

      await run("psql", ["-v", "ON_ERROR_STOP=1", "-c", `CREATE DATABASE "${target}"`], adminEnv());
      created.push(target);

      const dump = join(payload, db.label, `${db.label}.dump`);
      // --no-owner: the roles in production do not exist in a throwaway, and a restore that failed
      // on ownership would be reporting the wrong problem.
      await run("pg_restore", ["--no-owner", "--dbname", target, dump], scratchEnv(target));

      // Count from the RESTORED database, by asking it what tables it has rather than trusting the
      // manifest's list - so a table that failed to restore is absent here rather than counted as
      // zero against a name we supplied ourselves.
      const { stdout } = await run(
        "psql",
        [
          "-tA",
          "-F",
          ",",
          "-c",
          `SELECT relname, n_live_tup FROM pg_stat_user_tables`,
        ],
        scratchEnv(target),
      );

      // n_live_tup is an estimate, so every table is counted exactly. Slower and correct: an
      // estimate that happened to match would prove nothing.
      const tables: Record<string, number> = {};
      for (const line of stdout.split("\n").map((l) => l.trim()).filter(Boolean)) {
        const table = line.split(",")[0];
        const { stdout: exact } = await run(
          "psql",
          ["-tA", "-c", `SELECT count(*) FROM "${table}"`],
          scratchEnv(target),
        );
        tables[table] = Number(exact.trim());
      }
      restored[db.label] = tables;
      console.log(`  ${db.label}: restored ${Object.keys(tables).length} tables`);
    }

    const verdict = compareRestore(manifest, restored);
    console.log("");
    console.log(describeVerdict(verdict));
    if (!verdict.pass) {
      for (const d of verdict.discrepancies) {
        console.error(`  ${d.database}.${d.table}: manifest ${d.expected}, restored ${d.actual ?? "MISSING"}`);
      }
      process.exitCode = 1;
    }
  } finally {
    // Always, even on failure: a throwaway database left behind is a copy of every donor record
    // sitting in the same instance as the real one.
    for (const name of created) {
      try {
        await dropScratch(name);
      } catch (err) {
        console.error(`could not drop ${name}:`, err instanceof Error ? err.message : err);
      }
    }
    await rm(work, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error("RESTORE_FAILED", scrubConnectionStrings(err instanceof Error ? err.message : String(err)));
  process.exitCode = 1;
});
