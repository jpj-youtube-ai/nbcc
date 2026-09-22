import { BACKUP_DATABASES, type BackupDatabase } from "./plan";
import { buildManifest, verifyAgainstPrevious, type Manifest } from "./manifest";

// TASK-423: the nightly backup, as pure orchestration with every real seam injected.
//
// The design point is refusal. A backup system that ships whatever it managed to produce is worse
// than having none, because it replaces good archives with broken ones while reporting success,
// and it does so every night until there is nothing good left. So the order here is: produce,
// CHECK, and only then ship. Nothing reaches a destination that has not passed both the
// completeness check (did we get all 44 tables?) and the continuity check (is this plausibly the
// same dataset as last night?).

export type DumpResult = { tables: Record<string, number>; dumpBytes: number };

export type BackupSeams = {
  now: Date;
  /** The deployed commit, stamped into the image as GIT_SHA. */
  commit: string;
  /** How many tables a complete backup contains, counted from the migrations. */
  expectedTables: number;
  /** False on a dev machine, which must never write to or prune the production store. */
  enabled: boolean;

  dump: (db: BackupDatabase) => Promise<DumpResult>;
  /** Gather the deployed site itself, so the website can be rebuilt and not merely its data. */
  collectWebsite: () => Promise<number>;
  packageArchive: (manifest: Manifest) => Promise<Buffer>;
  previousManifest: () => Promise<Manifest | null>;
  putToS3: (name: string, body: Buffer, manifest: Manifest) => Promise<void>;
  putToDrive: (name: string, body: Buffer) => Promise<void>;
  pruneDrive: () => Promise<number>;
  alert: (subject: string, body: string) => Promise<void>;
};

export type BackupOutcome =
  | { status: "disabled" }
  | { status: "aborted"; reason: string }
  | { status: "failed"; reason: string }
  | { status: "partial"; manifest: Manifest; reason: string }
  | { status: "ok"; manifest: Manifest; pruned: number };

export function archiveName(now: Date): string {
  return `nbcc-backup-${now.toISOString().slice(0, 10)}.7z`;
}

export async function runBackup(seams: BackupSeams): Promise<BackupOutcome> {
  if (!seams.enabled) return { status: "disabled" };

  const name = archiveName(seams.now);

  // --- produce -------------------------------------------------------------
  let manifest: Manifest;
  let archive: Buffer;
  try {
    const databases = [];
    for (const db of BACKUP_DATABASES) {
      const { tables, dumpBytes } = await seams.dump(db);
      databases.push({ label: db.label, tables, dumpBytes });
    }
    await seams.collectWebsite();

    manifest = buildManifest({
      takenAt: seams.now.toISOString(),
      commit: seams.commit,
      databases,
      archiveBytes: 0, // filled in once the archive exists
    });
    archive = await seams.packageArchive(manifest);
    manifest = { ...manifest, archiveBytes: archive.byteLength };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await seams.alert("NBCC backup FAILED", `The backup could not be produced.\n\n${reason}`);
    return { status: "failed", reason };
  }

  // --- check, before anything is shipped -----------------------------------
  if (manifest.tableCount !== seams.expectedTables) {
    const reason = `dumped ${manifest.tableCount} tables, expected ${seams.expectedTables}`;
    await seams.alert(
      "NBCC backup REFUSED: tables missing",
      `The backup was not uploaded, because it is incomplete: ${reason}.\n\n` +
        `Last night's archive is untouched and is still the most recent good copy.`,
    );
    return { status: "aborted", reason };
  }

  const continuity = verifyAgainstPrevious(manifest, await seams.previousManifest());
  if (!continuity.ok) {
    await seams.alert(
      "NBCC backup REFUSED: looks wrong",
      `The backup was not uploaded: ${continuity.reason}.\n\n` +
        `Last night's archive is untouched and is still the most recent good copy.`,
    );
    return { status: "aborted", reason: continuity.reason };
  }

  // --- ship ----------------------------------------------------------------
  // S3 first. It is the copy protected by Object Lock and the one that restores quickly, so if
  // Drive is having a bad day there is no reason to lose both.
  try {
    await seams.putToS3(name, archive, manifest);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await seams.alert("NBCC backup FAILED", `Could not write the backup to S3.\n\n${reason}`);
    return { status: "failed", reason };
  }

  try {
    await seams.putToDrive(name, archive);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    // Not a disaster: the locked copy exists. But a permanently broken Drive upload would
    // otherwise go unnoticed forever, and Drive is the copy that survives losing AWS.
    await seams.alert(
      "NBCC backup PARTIAL: the off-site copy failed",
      `Tonight's backup is safe in AWS, but did not reach Google Drive.\n\n${reason}\n\n` +
        `Until this is fixed there is no copy outside AWS.`,
    );
    return { status: "partial", manifest, reason };
  }

  // Pruning deletes things, so it only ever runs after a backup that was good enough to ship.
  const pruned = await seams.pruneDrive();
  return { status: "ok", manifest, pruned };
}
