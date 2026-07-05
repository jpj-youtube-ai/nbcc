// Demo / mock data covering the donation model's cardinalities, for local dev and the admin
// dashboard (REQ-066). Re-runnable: it clears its own rows first (tagged by the '@demo.nbcc'
// donor email and 'DEMO' claim-batch reference) then re-inserts. audit_log is append-only (a DB
// trigger blocks DELETE), so its demo rows are inserted only when none exist yet.
//
//   DATABASE_URL=postgres://app:app@localhost:5435/charity node scripts/seed-demo.mjs
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const one = async (sql, p = []) => (await pool.query(sql, p)).rows[0];
const run = (sql, p = []) => pool.query(sql, p);
const yearsAgo = (y) => new Date(Date.now() - Math.round(y * 365 * 864e5));
const daysAgo = (d) => new Date(Date.now() - d * 864e5);

const WORDING = "I want to Gift Aid my donation and any donations I make in the future or have made in the past 4 years to NBCC. I am a UK taxpayer and understand that if I pay less Income Tax and/or Capital Gains Tax than the amount of Gift Aid claimed on all my donations in that tax year it is my responsibility to pay any difference.";
let sess = 0;

function donor(t) {
  return one(
    `INSERT INTO donors (donor_type, full_name, business_name, company_number, email, email_consent, anonymous, billing_address, billing_postcode)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [t.type, t.name, t.business || null, t.company_number || null, t.email, t.consent ?? true, t.anon ?? false, t.billing || null, t.billing_postcode || null],
  );
}
function decl(t) {
  return one(
    `INSERT INTO declarations (donor_id, title, first_name, last_name, house_name_number, address, postcode, non_uk, scope, wording_version, wording_snapshot, confirmed_taxpayer, created_at, revoked_at, superseded_by_declaration_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'2025-v1',$10,true,$11,$12,$13) RETURNING id`,
    [t.donor, t.title || null, t.first, t.last, t.house, t.address, t.postcode ?? null, t.nonUk ?? false, t.scope, WORDING, t.created ?? new Date(), t.revoked ?? null, t.supersededBy ?? null],
  );
}
function donation(t) {
  return one(
    `INSERT INTO donations (donor_id, declaration_id, mode, plan, amount_pence, gift_aid, refunded_amount_pence, claim_status, payment_channel, declaration_status, declaration_token, gasds_eligible, payment_status, claim_batch_id, stripe_session_id, stripe_subscription_id, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id`,
    [t.donor, t.decl ?? null, t.mode, t.plan ?? null, t.pence, t.giftAid ?? false, t.refunded ?? 0, t.claim ?? "not_eligible", t.channel ?? "online", t.declStatus ?? "not_required", t.token ?? null, t.gasds ?? false, t.pay ?? "paid", t.batch ?? null, "demo_sess_" + sess++, t.sub ?? null, t.created ?? new Date()],
  );
}
function audit(actor, action, entity, entityId, data = {}) {
  return run(`INSERT INTO audit_log (actor, action, entity, entity_id, data) VALUES ($1,$2,$3,$4,$5)`, [actor, action, entity, entityId, data]);
}

async function main() {
  // ---- clean prior demo rows (FK-safe order; audit_log handled separately) ----
  const demoDonors = `SELECT id FROM donors WHERE email LIKE '%@demo.nbcc'`;
  await run(`DELETE FROM claim_adjustments WHERE donation_id IN (SELECT id FROM donations WHERE donor_id IN (${demoDonors}))`);
  await run(`DELETE FROM donation_benefits WHERE donation_id IN (SELECT id FROM donations WHERE donor_id IN (${demoDonors}))`);
  await run(`DELETE FROM donation_partner_shares WHERE donation_id IN (SELECT id FROM donations WHERE donor_id IN (${demoDonors}))`);
  await run(`DELETE FROM donations WHERE donor_id IN (${demoDonors})`);
  await run(`DELETE FROM subscription_dunning WHERE donor_id IN (${demoDonors})`);
  await run(`DELETE FROM declarations WHERE donor_id IN (${demoDonors})`);
  await run(`DELETE FROM claim_batches WHERE hmrc_reference LIKE 'DEMO%'`);
  await run(`DELETE FROM donors WHERE email LIKE '%@demo.nbcc'`);

  // ---- claim batches: open / submitted / adjustment_due ----
  const bOpen = (await one(`INSERT INTO claim_batches (status, hmrc_reference) VALUES ('open','DEMO-OPEN-PENDING') RETURNING id`)).id;
  const bSubmitted = (await one(`INSERT INTO claim_batches (status, submitted_at, hmrc_reference) VALUES ('submitted', now() - interval '18 days', 'DEMO-HMRC-2026-01') RETURNING id`)).id;
  const bAdj = (await one(`INSERT INTO claim_batches (status, submitted_at, hmrc_reference) VALUES ('adjustment_due', now() - interval '45 days', 'DEMO-HMRC-2025-12') RETURNING id`)).id;

  // ---- donors: individuals (bronze/silver/gold), companies, anonymous, monthly, edge cases ----
  const grace = (await donor({ type: "individual", name: "Grace Hopper", email: "grace@demo.nbcc" })).id;
  const ada = (await donor({ type: "individual", name: "Ada Lovelace", email: "ada@demo.nbcc" })).id;
  const alan = (await donor({ type: "individual", name: "Alan Turing", email: "alan@demo.nbcc" })).id;
  const kath = (await donor({ type: "individual", name: "Katherine Johnson", email: "katherine@demo.nbcc" })).id;
  const tim = (await donor({ type: "individual", name: "Tim Lee", email: "tim@demo.nbcc", consent: false })).id;
  const edith = (await donor({ type: "individual", name: "Edith Clarke", email: "edith@demo.nbcc" })).id;
  const beacon = (await donor({ type: "company", name: "Beacon Industries", business: "Beacon Industries Ltd", company_number: "SC123456", email: "giving@demo.nbcc", billing: "1 Beacon Way, Ayr", billing_postcode: "KA7 1AA" })).id;
  const acme = (await donor({ type: "company", name: "Acme Widgets", business: "Acme Widgets Ltd", company_number: "12345678", email: "acme@demo.nbcc", billing: "5 Widget Rd, Irvine", billing_postcode: "KA12 8AA" })).id;
  const corner = (await donor({ type: "company", name: "Corner Shop", business: "Corner Shop Ltd", company_number: "87654321", email: "corner@demo.nbcc", billing: "9 High St, Girvan", billing_postcode: "KA26 9AA" })).id;
  const anon = (await donor({ type: "individual", name: "A Kind Stranger", email: "anon@demo.nbcc", anon: true })).id;
  const dorothy = (await donor({ type: "individual", name: "Dorothy Vaughan", email: "dorothy@demo.nbcc" })).id;
  const lucy = (await donor({ type: "individual", name: "Lucy Lapsed", email: "lucy@demo.nbcc" })).id;
  const hedy = (await donor({ type: "individual", name: "Hedy Lamarr", email: "hedy@demo.nbcc" })).id;
  const maryj = (await donor({ type: "individual", name: "Mary Jackson", email: "maryj@demo.nbcc" })).id;
  const rosalind = (await donor({ type: "individual", name: "Rosalind Franklin", email: "rosalind@demo.nbcc" })).id;

  // ---- declarations: active enduring/single, revoked, superseded lineage, non-UK, retention edge cases ----
  const dEnduring = (await decl({ donor: grace, first: "Grace", last: "Hopper", house: "12", address: "New York Ave, Ayr", postcode: "KA8 0AA", scope: "all_donations" })).id;
  const dSingle = (await decl({ donor: ada, title: "Ms", first: "Ada", last: "Lovelace", house: "1", address: "Analytical St, Prestwick", postcode: "KA9 1AA", scope: "this_donation" })).id;
  const dRevoked = (await decl({ donor: alan, first: "Alan", last: "Turing", house: "7", address: "Enigma Rd, Troon", postcode: "KA10 6AA", scope: "this_donation", revoked: daysAgo(30) })).id;
  const dNew = (await decl({ donor: kath, first: "Katherine", last: "Johnson", house: "3", address: "Orbit Way, Ayr", postcode: "KA7 2AA", scope: "all_donations" })).id;
  await decl({ donor: kath, first: "Katherine", last: "Johnson", house: "2", address: "Old Orbit Way, Ayr", postcode: "KA7 2AB", scope: "all_donations", revoked: daysAgo(60), supersededBy: dNew });
  const dNonUk = (await decl({ donor: edith, first: "Edith", last: "Clarke", house: "4", address: "Power Ln, St Helier", nonUk: true, scope: "this_donation" })).id;
  const dAnon = (await decl({ donor: anon, first: "Real", last: "Name", house: "8", address: "Private Rd, Ayr", postcode: "KA7 3AA", scope: "this_donation" })).id;
  const dMonthly = (await decl({ donor: dorothy, first: "Dorothy", last: "Vaughan", house: "6", address: "Compute Cres, Ayr", postcode: "KA7 4AA", scope: "all_donations" })).id;
  const dExpired = (await decl({ donor: hedy, first: "Hedy", last: "Lamarr", house: "5", address: "Signal St, Ayr", postcode: "KA7 5AA", scope: "all_donations", created: yearsAgo(7.2), revoked: yearsAgo(7) })).id;
  const dExpiring = (await decl({ donor: maryj, first: "Mary", last: "Jackson", house: "10", address: "Wind St, Ayr", postcode: "KA7 6AA", scope: "all_donations", created: yearsAgo(5.7), revoked: yearsAgo(5.6) })).id;

  // ---- donations: the matrix (mode/plan/gift-aid/channel/claim/declaration/refund/status) ----
  // monthly + eligible (active enduring)
  await donation({ donor: grace, decl: dEnduring, mode: "monthly", plan: "platinum", pence: 10000, giftAid: true, claim: "eligible", declStatus: "completed", sub: "demo_sub_grace", created: daysAgo(3) });
  // once + gift aid + batched (in the open batch)
  await donation({ donor: ada, decl: dSingle, mode: "once", pence: 5000, giftAid: true, claim: "batched", batch: bOpen, declStatus: "completed", created: daysAgo(6) });
  // once + gift aid revoked -> not eligible
  await donation({ donor: alan, decl: dRevoked, mode: "once", pence: 2500, giftAid: true, claim: "not_eligible", declStatus: "completed", created: daysAgo(35) });
  // once + gift aid + CLAIMED (in the submitted batch)
  await donation({ donor: kath, decl: dNew, mode: "once", pence: 3000, giftAid: true, claim: "claimed", batch: bSubmitted, declStatus: "completed", created: daysAgo(20) });
  // once, no gift aid, not eligible, no consent donor
  await donation({ donor: tim, mode: "once", pence: 1000, created: daysAgo(2) });
  // once + non-UK declaration + eligible
  await donation({ donor: edith, decl: dNonUk, mode: "once", pence: 1500, giftAid: true, claim: "eligible", declStatus: "completed", created: daysAgo(9) });
  // company once (never claimable) + billing
  await donation({ donor: beacon, mode: "once", pence: 50000, claim: "not_eligible", created: daysAgo(12) });
  await donation({ donor: acme, mode: "once", pence: 4000, claim: "not_eligible", created: daysAgo(15) });
  await donation({ donor: corner, mode: "once", pence: 1000, claim: "not_eligible", created: daysAgo(22) });
  // anonymous (display-only) but claimable with the real declaration
  await donation({ donor: anon, decl: dAnon, mode: "once", pence: 7500, giftAid: true, claim: "eligible", declStatus: "completed", created: daysAgo(4) });
  // monthly gold + claimed
  await donation({ donor: dorothy, decl: dMonthly, mode: "monthly", plan: "gold", pence: 5000, giftAid: true, claim: "claimed", batch: bSubmitted, declStatus: "completed", sub: "demo_sub_dorothy", created: daysAgo(25) });
  // monthly with a FAILED payment (dunning past_due)
  await donation({ donor: dorothy, decl: dMonthly, mode: "monthly", plan: "gold", pence: 5000, giftAid: true, claim: "not_eligible", pay: "failed", sub: "demo_sub_dorothy", created: daysAgo(1) });
  // monthly bronze lapsed donor
  await donation({ donor: lucy, mode: "monthly", plan: "bronze", pence: 1000, claim: "not_eligible", pay: "failed", sub: "demo_sub_lucy", created: daysAgo(30) });
  // in-person (card present) small gift, GASDS eligible, no declaration
  await donation({ donor: corner, mode: "once", pence: 2000, channel: "in_person", gasds: true, claim: "not_eligible", created: daysAgo(8) });
  // in-person awaiting declaration: sent + undelivered
  await donation({ donor: rosalind, mode: "once", pence: 3000, channel: "in_person", giftAid: true, claim: "not_eligible", declStatus: "sent", token: "demo_tok_sent", created: daysAgo(5) });
  await donation({ donor: rosalind, mode: "once", pence: 2000, channel: "in_person", giftAid: true, claim: "not_eligible", declStatus: "undelivered", token: "demo_tok_undeliv", created: daysAgo(5) });
  // pending payment (BACS-style lead time)
  await donation({ donor: grace, decl: dEnduring, mode: "once", pence: 6000, giftAid: true, claim: "not_eligible", pay: "pending", created: daysAgo(1) });
  // retention: expired + expiring (claimed donations dated in the past)
  await donation({ donor: hedy, decl: dExpired, mode: "once", pence: 5000, giftAid: true, claim: "claimed", batch: bSubmitted, declStatus: "completed", created: yearsAgo(7) });
  await donation({ donor: maryj, decl: dExpiring, mode: "once", pence: 5000, giftAid: true, claim: "claimed", batch: bSubmitted, declStatus: "completed", created: yearsAgo(5.6) });
  // adjustment_due: claimed then refunded -> owes HMRC an adjustment
  const adjDon = (await donation({ donor: grace, decl: dEnduring, mode: "once", pence: 6000, giftAid: true, refunded: 6000, claim: "adjustment_due", batch: bAdj, declStatus: "completed", created: daysAgo(50) })).id;
  await run(`INSERT INTO claim_adjustments (donation_id, claim_batch_id, adjustment_pence, reason) VALUES ($1,$2,$3,$4)`, [adjDon, bAdj, 1500, "Full refund after the Gift Aid was claimed"]);
  // partial refund on an eligible gift (recalculated on the retained amount)
  await donation({ donor: ada, decl: dSingle, mode: "once", pence: 4000, giftAid: true, refunded: 1500, claim: "eligible", declStatus: "completed", created: daysAgo(11) });

  // ---- subscription dunning: active / past_due / lapsed ----
  await run(`INSERT INTO subscription_dunning (donor_id, stripe_subscription_id, status, failed_attempts) VALUES ($1,'demo_sub_grace','active',0)`, [grace]);
  await run(`INSERT INTO subscription_dunning (donor_id, stripe_subscription_id, status, failed_attempts) VALUES ($1,'demo_sub_dorothy','past_due',2)`, [dorothy]);
  await run(`INSERT INTO subscription_dunning (donor_id, stripe_subscription_id, status, failed_attempts, lapsed_at) VALUES ($1,'demo_sub_lucy','lapsed',3, now() - interval '9 days')`, [lucy]);

  // ---- audit_log: only when no demo trail exists yet (append-only; cannot be deleted) ----
  const seeded = (await one(`SELECT count(*)::int AS n FROM audit_log WHERE actor = 'demo-seed'`)).n;
  if (seeded === 0) {
    await audit("demo-seed", "donation.created", "donation", adjDon, { amount_pence: 6000 });
    await audit("demo-seed", "declaration.revoked", "declaration", dRevoked, {});
    await audit("admin:kenny@nightbeforechristmas.co.uk", "donor.updated", "donor", dorothy, { fields: ["email"] });
    await audit("admin:isabella@nightbeforechristmas.co.uk", "admin.subscription_cancelled", "donor", lucy, { subscriptionId: "demo_sub_lucy" });
    await audit("admin:kenny@nightbeforechristmas.co.uk", "claim_batch.submitted", "claim_batch", bSubmitted, {});
    await audit("system", "donor.personal_data_anonymized", "donor", hedy, { declarationId: dExpired });
  }

  const counts = await one(`SELECT
     (SELECT count(*) FROM donors WHERE email LIKE '%@demo.nbcc') AS donors,
     (SELECT count(*) FROM donations WHERE stripe_session_id LIKE 'demo_%') AS donations,
     (SELECT count(*) FROM claim_batches WHERE hmrc_reference LIKE 'DEMO%' OR status='open') AS batches`);
  console.log("seeded:", counts);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
