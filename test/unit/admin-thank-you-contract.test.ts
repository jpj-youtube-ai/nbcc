// @vitest-environment jsdom
import { describe, it, expect, beforeAll, vi } from "vitest";

// TASK-644: Admin > Thank you fed what the REAL server sends. The route handlers in
// src/routes/admin.ts run for real, with every query they make (src/db/thank-you.ts) answered by
// invented rows in the tables' own shape (helpers/real-rows.ts). Only the database is pretend.

vi.mock("../../src/db/pool", async () => ({ pool: (await import("./helpers/real-server")).db.pool }));
vi.mock("../../src/config", async () => ({ config: (await import("./helpers/real-server")).CONFIG }));

import { db, callRoute, replyWith, type Reply } from "./helpers/real-server";
import { thankYouRows, down } from "./helpers/real-rows";
import { mountAdmin, el, text, press } from "./helpers/admin-settings-harness";
import { getThankYouEligible, getAdminThankYouSent } from "../../src/routes/admin";

vi.setConfig({ testTimeout: 30_000 });

const real: Record<string, Reply> = {};
const broken: Record<string, Reply> = {};
beforeAll(async () => {
  db.answer(thankYouRows());
  real["GET /api/admin/thank-you/eligible"] = await callRoute(getThankYouEligible, { query: { threshold: "100000" } });
  db.answer(thankYouRows());
  real["GET /api/admin/thank-you/sent"] = await callRoute(getAdminThankYouSent, { query: { limit: "20", offset: "0" } });

  db.answer([down("AS since_thanked_pence")]);
  broken["GET /api/admin/thank-you/eligible"] = await callRoute(getThankYouEligible, { query: { threshold: "100000" } });
  db.answer([down("FROM thank_you_sent")]);
  broken["GET /api/admin/thank-you/sent"] = await callRoute(getAdminThankYouSent, { query: {} });
});

async function open(replies: Record<string, Reply>) {
  const admin = mountAdmin({ role: "admin" }, replyWith(replies));
  await admin.signIn();
  await admin.open("thank-you");
  return admin;
}
const NOTHING_MADE_UP = /undefined|NaN|Invalid Date|\[object Object\]|null/;

describe("Thank you with the real server's answers", () => {
  it("the real handlers answered", () => {
    for (const r of Object.values(real)) expect(r.status).toBe(200);
    for (const r of Object.values(broken)) expect(r.status).toBe(500);
  });

  it("lists who to thank: the business by its name, their largest gift, who was thanked and what came since", async () => {
    const admin = await open(real);
    // It opens on those ready to thank: the business, never thanked, with an email address.
    expect(text(el("tyEligibleTable"))).toContain("Pretend Bakery Ltd");
    expect(text(el("tyEligibleTable"))).not.toContain("Skye Pretend");
    press(el("tyShowAll"));
    await admin.settle();
    const who = text(el("tyEligibleTable"));
    for (const s of ["Pretend Bakery Ltd", "£5000", "Rowan Example", "£1500", "1 March 2026", "£250", "Skye Pretend"]) expect(who).toContain(s);
    expect(who).not.toMatch(NOTHING_MADE_UP);
    expect(text(el("tyEligibleCount"))).toBe("3 listed · 1 ready");
  });

  it("lists the letters sent, a gift of money and a gift in kind", async () => {
    await open(real);
    const sent = text(el("tySentTable"));
    for (const s of ["Rowan Example", "£1500", "Madeup Garage", "Two hampers for the raffle"]) expect(sent).toContain(s);
    expect(sent).not.toMatch(NOTHING_MADE_UP);
  });

  it("says plainly when either list could not be loaded", async () => {
    await open(broken);
    expect(text(el("tyEligibleTable"))).toMatch(/could not|unavailable/i);
    expect(text(el("tySentTable"))).toMatch(/could not|unavailable/i);
  });
});
