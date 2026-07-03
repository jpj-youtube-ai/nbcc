// Charities Online Gift Aid claim export (REQ-052 / TASK-083).
//
// Produces the HMRC Charities Online CSV for finance to run and upload manually. It
// reads every claim_status='eligible' donation (optionally scoped to one claim batch)
// joined to its declaration + donor, then formats it through the pure row builder /
// CSV serializer in src/claims/charities-online.ts. NO admin auth / UI is in scope
// here — the authenticated trigger surface is REQ-062/REQ-063; this only makes the file.
//
// Run (needs DATABASE_URL + the app config, same env the service boots with — the query
// goes through src/db/pool.ts):
//   npm run export:charities-online                 # all eligible donations -> stdout
//   npm run export:charities-online -- --batch 7    # only claim_batch_id = 7
//   npm run export:charities-online -- --out claim.csv
//
// Run via tsx (see the npm script) so the TypeScript src/ modules import directly.
import { writeFileSync } from "node:fs";
import { listClaimableDonationsForExport } from "../src/db/donations.ts";
import { toCharitiesOnlineCsv } from "../src/claims/charities-online.ts";
import { pool } from "../src/db/pool.ts";

// Minimal flag parsing (no dependency): --batch <id> scopes to one claim batch, --out
// <file> writes to a file instead of stdout.
function parseArgs(argv) {
  const args = { batch: undefined, out: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--batch") args.batch = Number.parseInt(argv[(i += 1)], 10);
    else if (argv[i] === "--out") args.out = argv[(i += 1)];
  }
  return args;
}

async function main() {
  const { batch, out } = parseArgs(process.argv.slice(2));
  if (batch !== undefined && !Number.isInteger(batch)) {
    throw new Error("--batch expects an integer claim_batch_id");
  }

  const rows = await listClaimableDonationsForExport(batch);
  const csv = toCharitiesOnlineCsv(rows);

  if (out) {
    writeFileSync(out, csv);
    // Progress to stderr so stdout stays clean when piped.
    console.error(`Wrote ${rows.length} eligible donation(s) to ${out}`);
  } else {
    process.stdout.write(csv + "\n");
    console.error(`Exported ${rows.length} eligible donation(s).`);
  }
}

main()
  .catch((err) => {
    console.error("charities-online export failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
