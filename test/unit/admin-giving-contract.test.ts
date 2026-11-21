// @vitest-environment jsdom
import { describe, it, expect, beforeAll, vi } from "vitest";

// TASK-644: Admin > Giving (Claims, GASDS, monthly gifts that need attention) fed what the REAL server
// sends. The route handlers in src/routes/admin.ts run for real, with every query they make
// (src/db/admin.ts, src/gasds/pool.ts) answered by invented rows in the tables' own shape
// (helpers/real-rows.ts). Only the database is pretend. The admin-giving-*.test.ts files answer by hand.

vi.mock("../../src/db/pool", async () => ({ pool: (await import("./helpers/real-server")).db.pool }));
vi.mock("../../src/config", async () => ({ config: (await import("./helpers/real-server")).CONFIG }));

import { db, callRoute, type Reply } from "./helpers/real-server";
import { givingRows, down } from "./helpers/real-rows";
import { givingScreen, settle, el, q, qa, text, press, type Call } from "./helpers/giving-screen";
import {
  getAdminEligibleForClaim, getAdminClaimBatches, getAdminAdjustmentDue, getAdminAwaitingDeclaration,
  getAdminDeclarationReview, getAdminRetentionExpiry, getAdminClaimBatchDonations, getAdminGasdsDeadline,
  getAdminGasdsClaimed, getAdminGasdsPool, getAdminDunning,
} from "../../src/routes/admin";

vi.setConfig({ testTimeout: 30_000 });

const real: Record<string, Reply> = {};
const broken: Record<string, Reply> = {};
beforeAll(async () => {
  const get = async (key: string, handler: Parameters<typeof callRoute>[0], opts: Parameters<typeof callRoute>[1] = {}) => {
    db.answer(givingRows());
    real[key] = await callRoute(handler, opts);
  };
  await get("/api/admin/claims/eligible", getAdminEligibleForClaim);
  await get("/api/admin/claim-batches", getAdminClaimBatches);
  await get("/api/admin/claims/adjustment-due", getAdminAdjustmentDue);
  await get("/api/admin/queues/awaiting-declaration", getAdminAwaitingDeclaration);
  await get("/api/admin/queues/declaration-review", getAdminDeclarationReview);
  await get("/api/admin/queues/retention-expiry", getAdminRetentionExpiry);
  await get("/api/admin/claim-batches/7/donations", getAdminClaimBatchDonations, { params: { id: "7" } });
  await get("/api/admin/queues/gasds-deadline?all=1", getAdminGasdsDeadline, { query: { all: "1" } });
  await get("/api/admin/queues/gasds-claimed", getAdminGasdsClaimed);
  await get("/api/admin/queues/gasds-pool", getAdminGasdsPool);
  await get("/api/admin/subscriptions/dunning", getAdminDunning);

  db.answer([down("FROM subscription_dunning")]);
  broken["/api/admin/subscriptions/dunning"] = await callRoute(getAdminDunning);
  db.answer([down("dn.gasds_claimed_at IS NULL")]);
  broken["/api/admin/queues/gasds-deadline?all=1"] = await callRoute(getAdminGasdsDeadline, { query: { all: "1" } });
});

const from = (replies: Record<string, Reply>) => (call: Call) => {
  const hit = replies[call.path + (call.query ? "?" + call.query : "")] ?? replies[call.path];
  return hit ? { status: hit.status, body: hit.body } : undefined;
};
const tileN = (sel: string) => text(q(sel)?.querySelector(".ak-tile__n"));

describe("Giving with the real server's answers", () => {
  it("the real handlers answered", () => {
    for (const r of Object.values(real)) expect(r.status).toBe(200);
    for (const r of Object.values(broken)) expect(r.status).toBe(500);
    // The declaration link's token is sent, but must never reach the page (checked below).
    expect(JSON.stringify(real["/api/admin/queues/awaiting-declaration"].body)).toContain("pretend-token-never-shown");
  });

  it("Claims: counts every tile and draws each list's names, amounts and dates", async () => {
    const screen = givingScreen(from(real));
    screen.giving.openClaims();
    await settle();
    expect(tileN('[data-claims-tile="ready"]')).toBe("2");
    expect(tileN('[data-claims-tile="open"]')).toBe("1");
    expect(tileN('[data-claims-tile="sent"]')).toBe("1");
    expect(tileN('[data-claims-tile="repay"]')).toBe("1");
    expect(tileN('[data-claims-tile="awaiting"]')).toBe("1");
    expect(tileN('[data-claims-tile="review"]')).toBe("1");
    expect(tileN('[data-claims-tile="keep"]')).toBe("1");

    const ready = text(el("eligibleTable"));
    for (const s of ["Rowan Example", "£25", "KA1 1AA", "Skye Pretend", "£10.50", "Donation 501"]) expect(ready).toContain(s);
    const batches = text(el("batchesTable"));
    for (const s of ["PRETEND-REF-7", "£100"]) expect(batches).toContain(s);
    const repay = text(el("adjustmentTable"));
    for (const s of ["Isla Invented", "£50", "£12.50", "The donation was refunded", "Batch 7"]) expect(repay).toContain(s);
    const awaiting = text(el("claimsAwaiting"));
    for (const s of ["Calum Fictional", "calum@example.com", "Could not be delivered", "£30"]) expect(awaiting).toContain(s);
    expect(text(el("claimsReview"))).toContain("Ailsa Sample");
    expect(text(el("claimsReview"))).toContain("14 March 2023");
    expect(text(el("claimsReview"))).toContain("14 March 2025");
    const keep = text(el("claimsKeep"));
    for (const s of ["Euan Placeholder", "Keep date has passed", "One donation"]) expect(keep).toContain(s);

    const all = text(el("view-claims"));
    expect(all).not.toMatch(/undefined|NaN|Invalid Date|\[object Object\]/);
    expect(document.body.innerHTML).not.toContain("pretend-token-never-shown");
  });

  it("Claims: opens a sent batch to show what is in it, from the real batch answer", async () => {
    const screen = givingScreen(from(real));
    screen.giving.openClaims();
    await settle();
    await press(q('#batchesTable [data-batch-open="7"]'));
    const box = text(el("claimsBatch7Donations"));
    for (const s of ["Morven Madeup", "£100", "KA3 3CC", "£20 of it refunded"]) expect(box).toContain(s);
  });

  it("GASDS: counts what is not yet claimed, the latest mark and the year's pool", async () => {
    const screen = givingScreen(from(real));
    screen.giving.openGasds();
    await settle();
    expect(tileN('#gasdsFilters [data-gasds-filter="all"]')).toBe("2");
    expect(text(q('#gasdsFilters [data-gasds-filter="all"] .ak-tile__says'))).toContain("£35 in all");
    const recent = text(el("gasdsRecent"));
    for (const s of ["fern@example.com", "£17.50"]) expect(recent).toContain(s);
    expect(qa("#gasdsRecent [data-gasds-undo]").length).toBe(1);
    const pool = text(el("gasdsPool"));
    for (const s of ["£35", "£1200", String(new Date().getFullYear())]) expect(pool).toContain(s);
    expect(text(el("view-gasds"))).not.toMatch(/undefined|NaN|Invalid Date|\[object Object\]/);
  });

  it("GASDS: says plainly when the list could not be loaded", async () => {
    const screen = givingScreen(from({ ...real, ...broken }));
    screen.giving.openGasds();
    await settle();
    expect(text(el("gasdsTable"))).toBe("GASDS donations are unavailable.");
  });

  it("Monthly gifts: sorts the real rows into their tiles and says what happened", async () => {
    const screen = givingScreen(from(real));
    screen.giving.openSubs();
    await settle();
    const table = text(el("subsTable"));
    for (const s of ["Kirsty Imaginary", "£15", "Struan Unreal", "£5"]) expect(table).toContain(s);
    expect(text(el("view-subscriptions"))).not.toMatch(/undefined|NaN|Invalid Date|\[object Object\]/);
    expect(tileN('[data-subs-filter="cancelled"]')).toBe("1");
  });

  it("Monthly gifts: says plainly when they could not be loaded", async () => {
    const screen = givingScreen(from({ ...real, ...broken }));
    screen.giving.openSubs();
    await settle();
    expect(text(el("subsTable"))).toBe("Monthly gifts that need attention are unavailable.");
  });
});
