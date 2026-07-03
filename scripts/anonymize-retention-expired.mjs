// Retention-expiry personal-data anonymisation job (REQ-064 / TASK-112).
//
// Anonymises the captured personal data of every declaration whose HMRC six-year retention window has
// CLOSED. It reuses the same admin surface as the retention-expiry queue: listRetentionExpiryDeclarations
// finds the 'expired' rows, and anonymizeDonorPersonalData redacts each donor + declaration and appends
// one audit_log row in a single transaction (reusing the pure computeRetentionExpiry rule verbatim). An
// 'expiring' or indefinitely-retained declaration is skipped. Intended to run on a schedule (nightly),
// outside the HTTP API — the admin queue (TASK-110) surfaces the same rows for review.
//
// Run (needs DATABASE_URL + the app config, same env the service boots with — writes go through
// src/db/pool.ts):
//   npm run anonymize:retention-expired            # anonymise every expired declaration
//   npm run anonymize:retention-expired -- --dry   # list what WOULD be anonymised, write nothing
//
// Run via tsx (see the npm script) so the TypeScript src/ modules import directly.
import {
  listRetentionExpiryDeclarations,
  anonymizeDonorPersonalData,
} from "../src/db/admin.ts";
import { pool } from "../src/db/pool.ts";

function parseArgs(argv) {
  return { dry: argv.includes("--dry") };
}

async function main() {
  const { dry } = parseArgs(process.argv.slice(2));

  // Only the 'expired' rows are anonymised; 'expiring' rows are surfaced by the queue but left alone.
  const expired = (await listRetentionExpiryDeclarations()).filter((r) => r.flag === "expired");

  if (dry) {
    for (const r of expired) {
      console.error(`would anonymise declaration ${r.id} (donor ${r.donor_id}), expired ${r.retentionExpiry}`);
    }
    console.error(`Dry run: ${expired.length} expired declaration(s) would be anonymised.`);
    return;
  }

  let anonymised = 0;
  for (const r of expired) {
    const result = await anonymizeDonorPersonalData(r.id);
    if (result.anonymized) anonymised += 1;
  }
  console.error(`Anonymised ${anonymised} of ${expired.length} expired declaration(s).`);
}

main()
  .catch((err) => {
    console.error("retention anonymisation failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
