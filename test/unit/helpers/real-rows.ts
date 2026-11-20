import type { Rule } from "./real-server";
import { ukDay } from "../../../src/analytics/visitor";

// TASK-643: invented database rows, in each table's own shape (what pg hands back for the SQL the
// real code runs), for the contract tests in test/unit/admin-*-contract.test.ts. Every name, place
// and number is made up; the repo is public.

const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
/** Each UK day from `from` to `to`, as to_char(day, 'YYYY-MM-DD') gives it. */
function daysBetween(from: unknown, to: unknown): string[] {
  const out: string[] = [];
  const end = Date.parse(`${String(to)}T12:00:00Z`);
  for (let t = Date.parse(`${String(from)}T12:00:00Z`); t <= end; t += DAY) out.push(iso(t));
  return out;
}

/** Admin > Analytics: analytics_views, analytics_clicks, analytics_settings, and the names it looks up. */
export function analyticsRows(opts: { collecting?: boolean; empty?: boolean } = {}): Rule[] {
  const collecting = opts.collecting ?? true;
  const settings = [{ collecting, updated_at: new Date(Date.now() - 40 * DAY), updated_by: "admin:fern@example.com" }];
  if (opts.empty) return [["FROM analytics_settings", settings]];
  let headlines = 0;
  return [
    ["FROM analytics_settings", settings],
    // The headline: the period's first, then the period before's.
    ["AS bounces", () => (headlines++ === 0 ? [{ visitors: 412, visits: 530, views: 1290, bounces: 217 }] : [{ visitors: 300, visits: 380, views: 900, bounces: 167 }])],
    ["count(DISTINCT visitor)::int AS visitors", (p) => daysBetween(p[0], p[1]).filter((_, i) => i % 4 !== 3).map((day, i) => ({ day, visitors: 3 + ((i * 7) % 11) }))],
    ["channel = 'qr'", [{ campaign: "c14", visits: 30 }, { campaign: "ball", visits: 9 }, { campaign: "f12-a4", visits: 4 }, { campaign: null, visits: 1 }]],
    ["channel = 'newsletter'", [{ campaign: "41", visits: 140 }, { campaign: "spring-flyer", visits: 3 }]],
    ["channel = 'other_websites'", [{ source: "www.example.org", visits: 12 }, { source: "news.example.net", visits: 4 }]],
    ["SELECT channel, count(*)", [{ channel: "search", visits: 220 }, { channel: "newsletter", visits: 143 }, { channel: "direct", visits: 100 }, { channel: "qr", visits: 44 }, { channel: "other_websites", visits: 16 }, { channel: "social", visits: 7 }]],
    ["FROM newsletters WHERE id = ANY", [{ id: 41, subject: "Our winter news" }]],
    ["FROM fundraisers WHERE id = ANY", [{ id: 12, title: "Sam's Santa Dash" }]],
    ["FROM qr_codes WHERE id = ANY", [{ id: 14, name: "Donate billboard, High Street" }]],
    ["SELECT city, region, country", [{ city: "Kilmarnock", region: "Scotland", country: "GB", visitors: 180 }, { city: "Ayr", region: "Scotland", country: "GB", visitors: 60 }, { city: "Dublin", region: null, country: "IE", visitors: 5 }]],
    ["upper(country) AS country", [{ country: "GB", visitors: 400 }, { country: "IE", visitors: 12 }]],
    [`AS "avgActiveSeconds"`, [
      { path: "/", views: 600, visitors: 330, avgActiveSeconds: 75, avgScroll: 62, entries: 371 },
      { path: "/donate", views: 200, visitors: 150, avgActiveSeconds: 40, avgScroll: 80, entries: 53 },
      { path: "/a-page-that-has-gone", views: 3, visitors: 2, avgActiveSeconds: null, avgScroll: null, entries: 2 },
    ]],
    ["SELECT kind, label", [{ kind: "donate", label: "Donate now", clicks: 90 }, { kind: "outbound", label: "www.example.org", clicks: 6 }]],
    ["SELECT kind, count(*)", [{ kind: "donate", clicks: 90 }, { kind: "outbound", clicks: 6 }]],
    ["SELECT device,", [{ device: "phone", visitors: 300 }, { device: "computer", visitors: 100 }, { device: "tablet", visitors: 12 }]],
    ["SELECT browser,", [{ browser: "Safari", visitors: 220 }, { browser: "Chrome", visitors: 180 }]],
    ["AS n FROM analytics_views", [{ n: 3 }]],
  ];
}

/** Admin > QR codes: qr_codes and qr_code_scans (the page codes need no table). */
export function qrRows(opts: { today?: string; extra?: { id: number; name: string; target: string }[] } = {}): Rule[] {
  // The UK day, as the server counts "today" (scanSummary), not the UTC one.
  const today = opts.today ?? ukDay(new Date());
  const back = (n: number) => iso(Date.parse(`${today}T12:00:00Z`) - n * DAY);
  const at = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY);
  const code = (id: number, name: string, target: string, hidden: boolean, daysAgo: number) => ({
    id,
    name,
    target,
    hidden,
    created_at: at(daysAgo),
    updated_by: "admin:fern@example.com",
    updated_at: at(daysAgo),
  });
  const made = (opts.extra ?? []).map((c) => code(c.id, c.name, c.target, false, 0));
  return [
    // Making one (createQrCode) and changing one (updateQrCode), each inside writeWithAudit.
    ["INSERT INTO qr_codes", (p) => [code(15, String(p[0]), String(p[1]), false, 0)]],
    ["FOR UPDATE", (p) => [code(Number(p[0]), "Business card, Sam", "/", false, 10)]],
    ["UPDATE qr_codes", (p) => [code(Number(p[0]), String(p[1] ?? "Business card, Sam"), String(p[2] ?? "/"), p[3] === true, 10)]],
    ["FROM qr_codes ORDER BY id DESC", [
      ...made,
      code(14, "Donate billboard, High Street", "/donate", false, 30),
      code(13, "Business card, Sam", "/", false, 10),
      code(12, "Table card at the Festive Ball, with a very long name to see it wrap", "/ball", false, 5),
      code(10, "Volunteer sign up", "https://vol.nbcc.scot", false, 60),
      code(9, "Old leaflet", "/donate", true, 90),
    ]],
    ["FROM qr_code_scans", [
      { code_id: 14, day: back(0), scans: 5 },
      { code_id: 14, day: back(3), scans: 33 },
      { code_id: 14, day: back(20), scans: 176 },
      { code_id: 12, day: back(1), scans: 41 },
      { code_id: 9, day: back(40), scans: 77 },
    ]],
    ["SELECT target FROM qr_codes WHERE id = $1", (p) => (Number(p[0]) === 404 ? [] : [{ target: "/donate" }])],
  ];
}

/** Admin > Site pages: site_aliases and site_page_seo (the pages themselves come from src/site/pages.ts). */
export function siteRows(): Rule[] {
  const at = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY);
  return [
    ["FROM site_aliases ORDER BY from_path", [
      { id: 3, from_path: "/drop", to_path: "https://drop.nbcc.scot", created_by: "admin:fern@example.com", created_at: at(11) },
      { id: 1, from_path: "/give", to_path: "/donate", created_by: "seed", created_at: at(70) },
    ]],
    ["FROM site_page_seo", [{ page_path: "/privacy", listed: false }]],
  ];
}

/** A Date this many days ago, as pg gives a timestamptz column. */
const ago = (days: number) => new Date(Date.now() - days * DAY);
/** A rule whose query fails, as a database that is down does. */
export const down = (match: string | RegExp): Rule => [match, () => { throw new Error("database is down"); }];

/** Admin > Giving (Claims, GASDS, monthly gifts): donations, donors, declarations, claim_batches, subscription_dunning. */
export function givingRows(): Rule[] {
  return [
    // Claims: ready to claim (listEligibleForClaim).
    ["WHERE d.claim_status = 'eligible'", [
      { id: 501, donor_id: 41, donor_name: "Rowan Example", amount_pence: 2500, postcode: "KA1 1AA", created_at: ago(20) },
      { id: 502, donor_id: 42, donor_name: "Skye Pretend", amount_pence: 1050, postcode: null, created_at: ago(18) },
    ]],
    // The donations in one batch (listClaimBatchDonations).
    ["WHERE d.claim_batch_id = $1", (p) => (Number(p[0]) === 7 ? [
      { id: 480, donor_id: 43, donor_name: "Morven Madeup", amount_pence: 10000, refunded_amount_pence: 2000, postcode: "KA3 3CC", created_at: ago(60), claim_status: "batched" },
    ] : [])],
    // The batches (listClaimBatches): counts from ::int.
    ["FROM claim_batches b", [
      { id: 8, status: "open", submitted_at: null, regulator: "OSCR", charity_number: "SC000000", hmrc_reference: null, created_at: ago(3), donation_count: 0, total_pence: 0 },
      { id: 7, status: "submitted", submitted_at: ago(30), regulator: "OSCR", charity_number: "SC000000", hmrc_reference: "PRETEND-REF-7", created_at: ago(45), donation_count: 1, total_pence: 10000 },
    ]],
    // To repay (listAdjustmentDueDonations).
    ["WHERE d.claim_status = 'adjustment_due'", [
      { id: 470, donor_id: 44, donor_name: "Isla Invented", donor_email: "isla@example.com", amount_pence: 5000, refunded_amount_pence: 5000, claim_status: "adjustment_due", claim_batch_id: 7, created_at: ago(90), adjustment_pence: 1250, adjustment_reason: "refund via charge.refunded" },
    ]],
    // Declarations not come back (listAwaitingDeclarationDonations).
    ["declaration_status IN ('sent','undelivered')", [
      { id: 460, donor_id: 45, donor_name: "Calum Fictional", donor_email: "calum@example.com", declaration_status: "undelivered", declaration_token: "pretend-token-never-shown", amount_pence: 3000, created_at: ago(12) },
    ]],
    // Due a review (listDeclarationsDueReview).
    ["dec.scope = 'all_donations' AND dec.created_at <= $1", [
      { id: 30, donor_id: 46, first_name: "Ailsa", last_name: "Sample", created_at: new Date("2023-03-14T10:00:00Z") },
    ]],
    // Near their keep date (listRetentionExpiryDeclarations): claimed seven years ago, so expired.
    ["AS last_claimed_at", [
      { id: 20, donor_id: 47, first_name: "Euan", last_name: "Placeholder", scope: "this_donation", revoked_at: null, last_claimed_at: ago(7 * 365) },
    ]],
    // GASDS: small donations not yet claimed (listGasdsDeadlineDonations).
    ["dn.gasds_claimed_at IS NULL", [
      { id: 601, donor_id: 51, full_name: "Bucket Collection, High Street", amount_pence: 1500, created_at: ago(400) },
      { id: 602, donor_id: 52, full_name: "Fiona Notreal", amount_pence: 2000, created_at: ago(30) },
    ]],
    // GASDS: the latest marks (listGasdsClaimedLately) and their donations.
    ["WHERE action = 'gasds.claimed'", [{ id: 900, actor: "admin:fern@example.com", created_at: ago(2), data: { donationIds: [590, 591] } }]],
    ["SELECT id, amount_pence, gasds_claimed_at FROM donations", [
      { id: 590, amount_pence: 1000, gasds_claimed_at: ago(2) },
      { id: 591, amount_pence: 750, gasds_claimed_at: ago(2) },
    ]],
    // GASDS pool (getGasdsPoolReport): SUM of an int comes back as a numeric string.
    ["gasds_eligible = true AND EXTRACT", [{ total: "3500" }]],
    ["gift_aid = true AND claim_status IN", [{ total: "120000" }]],
    // Monthly gifts that need attention (listDunning).
    ["FROM subscription_dunning sd", [
      { id: 1, donor_id: 61, donor_name: "Kirsty Imaginary", donor_email: "kirsty@example.com", stripe_subscription_id: "sub_pretend1", status: "past_due", failed_attempts: 2, lapsed_at: null, cancelled_at: null, updated_at: ago(1), monthly_pence: 1500, first_paid_at: ago(300), phone: null },
      { id: 2, donor_id: 62, donor_name: "Struan Unreal", donor_email: "struan@example.com", stripe_subscription_id: "sub_pretend2", status: "lapsed", failed_attempts: 4, lapsed_at: ago(10), cancelled_at: null, updated_at: ago(10), monthly_pence: 500, first_paid_at: ago(700), phone: "01234 000000" },
      { id: 3, donor_id: 63, donor_name: "Mhairi Madeup", donor_email: null, stripe_subscription_id: "sub_pretend3", status: "active", failed_attempts: 0, lapsed_at: null, cancelled_at: ago(5), updated_at: ago(5), monthly_pence: null, first_paid_at: null, phone: null },
    ]],
  ];
}
