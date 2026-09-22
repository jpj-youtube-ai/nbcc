// TASK-423: deciding which old backups to remove from Google Drive.
//
// This is the only part of the backup that deletes anything, which makes it the only part that can
// destroy what the whole feature exists to protect. An off-by-one does not fail loudly at 2am, it
// quietly removes the copy that was needed.
//
// Rule: keep the 30 most recent, and keep the newest backup from each of the last 12 months.
// Everything else goes. Daily cover for recent mistakes, monthly cover for the ones noticed late.

/** Our backups are named nbcc-backup-YYYY-MM-DD.7z. Anything else in the folder is not ours. */
const OURS = /^nbcc-backup-\d{4}-\d{2}-\d{2}\.7z$/;

const KEEP_DAILY = 30;
const KEEP_MONTHLY = 12;

export type StoredBackup = { id: string; name: string; createdTime: string };

export function selectForDeletion(files: StoredBackup[], now: Date): StoredBackup[] {
  // The folder belongs to the charity, not to this job. If someone files a document in it, tidying
  // it away would be both wrong and alarming.
  const ours = files.filter((f) => OURS.test(f.name));
  if (ours.length === 0) return [];

  const newestFirst = [...ours].sort((a, b) => b.createdTime.localeCompare(a.createdTime));

  const keep = new Set<string>();

  // 1. The daily window.
  for (const f of newestFirst.slice(0, KEEP_DAILY)) keep.add(f.id);

  // 2. The newest of each month, for the last twelve months. newestFirst order means the first
  //    time a month is seen is its newest backup.
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - KEEP_MONTHLY);
  const monthsSeen = new Set<string>();
  for (const f of newestFirst) {
    const month = f.createdTime.slice(0, 7);
    if (monthsSeen.has(month)) continue;
    monthsSeen.add(month);
    if (Date.parse(f.createdTime) >= cutoff.getTime()) keep.add(f.id);
  }

  const doomed = newestFirst.filter((f) => !keep.has(f.id));

  // A listing truncated by a transient API error must not become a mass deletion. If the rule says
  // remove everything, the rule is not what is wrong.
  if (doomed.length >= ours.length) return [];

  return doomed;
}
