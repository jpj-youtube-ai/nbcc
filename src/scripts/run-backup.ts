import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, mkdir, writeFile, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "../config";
import { expectedTableCount, tablesIn } from "../backup/plan";
import { runBackup, type BackupSeams } from "../backup/run";
import type { Manifest } from "../backup/manifest";
import { createS3Client } from "../clients/s3";
import { createCredentialProvider } from "../clients/aws-sigv4";
import {
  federationAudience,
  signCallerIdentity,
  buildSubjectToken,
  exchangeForFederatedToken,
  impersonateServiceAccount,
} from "../clients/google-federation";
import { uploadFile, listBackups, deleteFile, resolveFolderKind } from "../clients/google-drive";
import { selectForDeletion } from "../backup/retention";
import { sendBackupAlert } from "../clients/email";

// TASK-423: the nightly backup runner. Wiring ONLY — every decision lives in src/backup/run.ts,
// which is pure and unit-tested. This file supplies the real seams: pg_dump, psql, 7z, S3, Drive.
//
// It lives under src/ so tsc emits it into dist/ and it runs as `node dist/scripts/run-backup.js`
// with no tsx and no devDependencies, because the runtime image is `npm ci --omit=dev`. Same
// shape as src/scripts/send-reminders.ts, and fired the same way: an EventBridge schedule runs it
// as a one-off Fargate task with the container command overridden (infra/modules/app/backups.tf).

const run = promisify(execFile);

// The repo root inside the image, which is also the deployed website.
const APP_ROOT = process.cwd();

const resolveCredentials = createCredentialProvider({
  accessKeyId: config.AWS_ACCESS_KEY_ID,
  secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
  sessionToken: config.AWS_SESSION_TOKEN,
  containerCredentialsRelativeUri: config.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI,
});

const s3 = createS3Client({
  bucket: config.BACKUP_S3_BUCKET,
  region: config.BACKUP_S3_REGION,
  credentials: resolveCredentials,
});

/**
 * A Google access token, with no key anywhere.
 *
 * Sign a GetCallerIdentity call with the ECS task role, hand that to Google, let Google check it
 * with AWS, then swap the result for the service account's own token. See google-federation.ts
 * for why there is no key file: the organisation forbids creating them.
 */
async function googleAccessToken(): Promise<string> {
  const audience = federationAudience({
    projectNumber: config.GOOGLE_WORKLOAD_IDENTITY_PROJECT_NUMBER,
    poolId: config.GOOGLE_WORKLOAD_IDENTITY_POOL,
    providerId: config.GOOGLE_WORKLOAD_IDENTITY_PROVIDER,
  });
  const signed = signCallerIdentity({ credentials: await resolveCredentials(), audience });
  const federated = await exchangeForFederatedToken({
    audience,
    subjectToken: buildSubjectToken(signed),
  });
  return impersonateServiceAccount({
    federatedToken: federated,
    serviceAccountEmail: config.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  });
}

async function main(): Promise<void> {
  const now = new Date();
  const work = await mkdtemp(join(tmpdir(), "nbcc-backup-"));
  // Everything to be archived goes in payload/; the archive itself is written beside it, never
  // inside it. 7z is then pointed at a directory rather than a glob — execFile does not go through
  // a shell, so a "*" would arrive at 7z as a literal asterisk and archive nothing.
  const payload = join(work, "payload");

  try {
    await mkdir(payload, { recursive: true });
    const seams: BackupSeams = {
      now,
      commit: config.GIT_SHA,
      expectedTables: expectedTableCount(APP_ROOT),
      enabled: Boolean(config.BACKUP_S3_BUCKET && config.BACKUP_ARCHIVE_PASSPHRASE),

      // One pg_dump per database, plus a CSV per table alongside it. The dump is the artefact a
      // restore actually uses; the CSVs are there so the charity can read its own data in Excel
      // without Postgres, a developer, or this codebase.
      async dump(db) {
        const url = config[db.configKey];
        const dir = join(payload, db.label);
        await mkdir(dir, { recursive: true });

        const dumpPath = join(dir, `${db.label}.dump`);
        await run("pg_dump", ["--format=custom", "--no-owner", "--file", dumpPath, url]);

        const tables: Record<string, number> = {};
        for (const table of tablesIn(APP_ROOT, db.migrationsDir)) {
          await run("psql", [
            url,
            "-c",
            `\\copy (SELECT * FROM ${table}) TO '${join(dir, `${table}.csv`)}' WITH CSV HEADER`,
          ]);
          const { stdout } = await run("psql", [
            url,
            "-tA",
            "-c",
            `SELECT count(*) FROM ${table}`,
          ]);
          tables[table] = Number(stdout.trim());
        }

        return { tables, dumpBytes: (await stat(dumpPath)).size };
      },

      // The website itself, not merely its data. This is the deployed tree: every page, asset and
      // compiled server file exactly as it is running. It means a recovery does not depend on
      // GitHub also still existing.
      async collectWebsite() {
        const tarPath = join(payload, "website.tar.gz");
        await run("tar", [
          "czf",
          tarPath,
          "-C",
          APP_ROOT,
          "--exclude=node_modules",
          "--exclude=.git",
          ".",
        ]);
        return (await stat(tarPath)).size;
      },

      async packageArchive(manifest) {
        await writeFile(join(payload, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
        // A plain-text note beside the encrypted data, for whoever opens this in five years with
        // no memory of how it was made.
        await writeFile(
          join(payload, "HOW-TO-RESTORE.txt"),
          [
            "NBCC backup archive",
            "",
            "Each database has a .dump (restore with pg_restore) and a folder of .csv files",
            "(open in Excel). website.tar.gz is the deployed site itself.",
            "manifest.json lists every table and its row count at the time this was taken;",
            "check a restore against it rather than trusting that it looked fine.",
            "",
            "The password for this archive is in the charity's password manager.",
            "It is deliberately not stored in AWS, so that losing the AWS account does not",
            "also lose the ability to open these files.",
          ].join("\n"),
          "utf8",
        );

        const archivePath = join(work, "archive.7z");
        // -mhe=on encrypts the file NAMES too, so the archive does not leak its own structure.
        // Run FROM the payload directory and archive ".", so 7z never sees a wildcard it would
        // have to expand itself, and never tries to archive its own output.
        //
        // The passphrase is an argument, so it is briefly visible in the process list. Accepted:
        // this container runs one process, for under a minute, with no other users, and p7zip
        // offers no way to read a password from stdin non-interactively.
        await run("7z", ["a", `-p${config.BACKUP_ARCHIVE_PASSPHRASE}`, "-mhe=on", archivePath, "."], {
          cwd: payload,
        });
        return readFile(archivePath);
      },

      previousManifest: () => s3.getJson<Manifest>("latest-manifest.json"),

      async putToS3(name, body, manifest) {
        await s3.put(`archives/${name}`, body);
        // Written last and separately: it is the record of what a GOOD backup looks like, so it
        // must only advance once the archive it describes is safely stored.
        await s3.put(
          "latest-manifest.json",
          Buffer.from(JSON.stringify(manifest, null, 2)),
          "application/json",
        );
      },

      async putToDrive(name, body) {
        const accessToken = await googleAccessToken();
        const folder = await resolveFolderKind({
          accessToken,
          folderId: config.GOOGLE_DRIVE_FOLDER_ID,
        });
        await uploadFile(
          {
            accessToken,
            folderId: config.GOOGLE_DRIVE_FOLDER_ID,
            sharedDrive: folder.sharedDrive,
          },
          { name, body },
        );
      },

      async pruneDrive() {
        const accessToken = await googleAccessToken();
        const folder = await resolveFolderKind({
          accessToken,
          folderId: config.GOOGLE_DRIVE_FOLDER_ID,
        });
        const target = {
          accessToken,
          folderId: config.GOOGLE_DRIVE_FOLDER_ID,
          sharedDrive: folder.sharedDrive,
        };
        const doomed = selectForDeletion(await listBackups(target), now);
        for (const file of doomed) await deleteFile(target, file.id);
        return doomed.length;
      },

      async alert(subject, body) {
        await sendBackupAlert({ email: config.ADMIN_NOTIFICATION_EMAIL, subject, body });
      },
    };

    const outcome = await runBackup(seams);

    switch (outcome.status) {
      case "disabled":
        console.log("backup disabled (no bucket or passphrase configured) — nothing to do");
        return;
      case "ok":
        // The exact string a CloudWatch metric filter counts. The alarm treats its ABSENCE as the
        // emergency, so this line is the only evidence that anything happened at all.
        console.log(
          `BACKUP_OK tables=${outcome.manifest.tableCount} rows=${outcome.manifest.rowCount} ` +
            `bytes=${outcome.manifest.archiveBytes} pruned=${outcome.pruned}`,
        );
        return;
      case "partial":
        console.error(`BACKUP_PARTIAL ${outcome.reason}`);
        process.exitCode = 1;
        return;
      default:
        console.error(`BACKUP_FAILED ${outcome.reason}`);
        process.exitCode = 1;
    }
  } finally {
    // The work directory holds an unencrypted dump of every donor, declaration and guest record.
    // It lives in a container that is about to be destroyed, but leaving it lying around while
    // the upload happens is not a habit worth having.
    await rm(work, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error("BACKUP_FAILED", err);
  process.exitCode = 1;
});
