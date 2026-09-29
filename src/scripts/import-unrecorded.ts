import { pool } from "../db/pool";
import { stripe, stripeConfigured } from "../clients/stripe";
import { buildImportPlan, type ImportRequest, type StripeCustomerDetail } from "../reconcile/import-plan";
import { importHistoricalSupporter, alreadyImportedCharges, findDonorByEmail } from "../db/historical-import";

// TASK-430: record the five supporters the charity never knew it had.
//
// DRY RUN BY DEFAULT. Prints exactly what it would create and writes nothing. Pass --commit to
// actually write. This puts money into a charity's financial records, so it does not get to be a
// one-pass operation.
//
// The customer list is HARDCODED, deliberately. These five were found by `npm run reconcile:stripe`
// and their classification was confirmed by the charity: RMC is a company, three are individuals,
// and one is the charity's own test payment. Hardcoding means this script cannot be pointed at an
// arbitrary customer by accident, and that the decision about who is a company was made by a human
// looking at names rather than by a heuristic guessing from them.
const CUSTOMERS: { id: string; classification: ImportRequest["classification"]; note: string }[] = [
  {
    id: "cus_UaUbc78CEaRp1S",
    classification: { kind: "company", band: "platinum" },
    note: "RMC Double Glazing (Ayr) Ltd - £100/mo since 26 May. Stripe product says Platinum.",
  },
  {
    id: "cus_UXrjR8e2vFKMWs",
    classification: { kind: "individual" },
    note: "Fiona McIlloney - £10/mo since May, never thanked.",
  },
  {
    id: "cus_UXYHQrj5HPNsbp",
    classification: { kind: "individual" },
    note: "Mrs I J McFarlane - £10/mo since May, never thanked.",
  },
  {
    id: "cus_UXY8IxBAztPWHK",
    classification: { kind: "individual" },
    note: "Jodie McFarlane - £10/mo since May, never thanked.",
  },
  {
    id: "cus_UXYZYfBAhV9Y70",
    // Recorded because the money genuinely left a card, but emailing the charity a thank-you for
    // its own test, and inviting it to Gift Aid it, would be noise.
    classification: { kind: "individual", suppressEmails: true },
    note: "The charity's own test payment (£10, one-off). Recorded, not emailed.",
  },
];

const money = (pence: number) => `£${(pence / 100).toFixed(2)}`;
const day = (d: Date) => d.toISOString().slice(0, 10);

async function loadCustomer(id: string): Promise<StripeCustomerDetail> {
  const customer = await stripe.customers.retrieve(id);
  if (customer.deleted) throw new Error(`Stripe customer ${id} is deleted`);

  const charges: StripeCustomerDetail["charges"] = [];
  for await (const c of stripe.charges.list({ customer: id, limit: 100 })) {
    if (c.status !== "succeeded" || c.refunded) continue;
    charges.push({
      id: c.id,
      // Stripe timestamps are seconds. The date the money actually moved is the whole point of
      // this import: recording these as "today" would be a wrong number in the accounts.
      paidAt: new Date(c.created * 1000),
      amountPence: c.amount - (c.amount_refunded ?? 0),
    });
  }
  charges.sort((a, b) => a.paidAt.getTime() - b.paidAt.getTime());

  const subs = await stripe.subscriptions.list({ customer: id, status: "all", limit: 1 });

  return {
    id: customer.id,
    email: customer.email ?? null,
    name: customer.name ?? null,
    subscriptionId: subs.data[0]?.id ?? null,
    charges,
  };
}

async function main(): Promise<void> {
  const commit = process.argv.includes("--commit");

  if (!stripeConfigured) {
    console.error("Stripe is not configured; refusing to run.");
    process.exitCode = 1;
    return;
  }

  const requests: ImportRequest[] = [];
  for (const c of CUSTOMERS) {
    requests.push({ customer: await loadCustomer(c.id), classification: c.classification });
  }
  const plan = buildImportPlan(requests);

  console.log("");
  console.log(commit ? "=== IMPORTING (writing) ===" : "=== DRY RUN - nothing will be written ===");
  console.log("");

  for (const entry of plan.entries) {
    const note = CUSTOMERS.find((c) => c.id === entry.donor.stripeCustomerId)?.note ?? "";
    const existingDonor = await findDonorByEmail(entry.donor.email);
    const dupes = await alreadyImportedCharges(entry.donations.map((d) => d.stripeChargeId));

    console.log(`${entry.donor.businessName ?? entry.donor.fullName}  <${entry.donor.email}>`);
    console.log(`  ${note}`);
    console.log(
      `  as ${entry.donor.donorType}` +
        (entry.fulfilment ? `, supporter band ${entry.fulfilment.band}` : "") +
        (existingDonor ? `  [donor ${existingDonor} already exists - will reuse, not duplicate]` : "  [new donor]"),
    );
    for (const d of entry.donations) {
      const already = dupes.has(d.stripeChargeId);
      console.log(`    ${day(d.paidAt)}  ${money(d.amountPence).padStart(8)}  ${d.stripeChargeId}${already ? "   ALREADY RECORDED - will skip" : ""}`);
    }
    console.log(`  emails: ${entry.emails.length ? entry.emails.join(", ") : "(none)"}`);
    console.log("");
  }

  for (const s of plan.skipped) console.log(`SKIPPED ${s.id}: ${s.reason}`);

  console.log(`TOTAL: ${plan.donationCount} donations, ${money(plan.totalPence)} across ${plan.entries.length} supporter(s).`);
  console.log("");

  if (!commit) {
    console.log("Dry run only. Nothing was written. Re-run with --commit to apply.");
    console.log("NOTE: --commit creates records ONLY. No emails are sent by this script.");
    return;
  }

  for (const entry of plan.entries) {
    const out = await importHistoricalSupporter(entry);
    console.log(
      `IMPORTED ${entry.donor.email}: donor ${out.donorId}, ${out.donationIds.length} donation(s)` +
        (out.fulfilmentId ? `, supporter record ${out.fulfilmentId}` : "") +
        (out.skippedCharges.length ? `, ${out.skippedCharges.length} already present` : ""),
    );
  }
  console.log("");
  console.log("Records created. Emails are a SEPARATE, deliberate step.");
}

main()
  .catch((err) => {
    console.error("IMPORT_FAILED", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
