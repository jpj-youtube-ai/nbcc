// @vitest-environment jsdom
import { describe, it, expect, beforeAll, vi } from "vitest";

// TASK-644: Business supporters, Monthly givers and Invoices fed what the REAL server sends. The
// route handlers (src/routes/admin.ts, src/routes/invoices.ts) run for real, with every query they
// make (src/db/fulfilment.ts, src/db/monthly-supporters.ts, src/db/invoices.ts) answered by invented
// rows in the tables' own shape (helpers/real-rows.ts). Only the database is pretend.

vi.mock("../../src/db/pool", async () => ({ pool: (await import("./helpers/real-server")).db.pool }));
vi.mock("../../src/config", async () => ({ config: (await import("./helpers/real-server")).CONFIG }));

import { db, callRoute, replyWith, ran, type Reply } from "./helpers/real-server";
import { supporterRows, down } from "./helpers/real-rows";
import { mountAdmin, el, q, text, choose } from "./helpers/admin-settings-harness";
import { getAdminFulfilments, getAdminMonthlySupporters } from "../../src/routes/admin";
import { getAdminInvoices } from "../../src/routes/invoices";

vi.setConfig({ testTimeout: 30_000 });

const real: Record<string, Reply> = {};
const broken: Record<string, Reply> = {};
let fulfilmentSql = "";
beforeAll(async () => {
  db.answer(supporterRows());
  real["GET /api/admin/fulfilments"] = await callRoute(getAdminFulfilments);
  fulfilmentSql = ran.map((r) => r.sql).find((s) => s.includes("FROM business_supporter_fulfilment f")) ?? "";
  db.answer(supporterRows());
  real["GET /api/admin/monthly-supporters"] = await callRoute(getAdminMonthlySupporters);
  db.answer(supporterRows());
  real["GET /api/admin/invoices"] = await callRoute(getAdminInvoices);

  db.answer([down("FROM business_supporter_fulfilment f")]);
  broken["GET /api/admin/fulfilments"] = await callRoute(getAdminFulfilments);
  db.answer([down("agg.first_paid_at")]);
  broken["GET /api/admin/monthly-supporters"] = await callRoute(getAdminMonthlySupporters);
  db.answer([down("FROM donation_invoices")]);
  broken["GET /api/admin/invoices"] = await callRoute(getAdminInvoices);
});

async function open(view: string, replies: Record<string, Reply>) {
  const admin = mountAdmin({ role: "admin" }, replyWith(replies));
  await admin.signIn();
  await admin.open(view);
  return admin;
}
const NOTHING_MADE_UP = /undefined|NaN|Invalid Date|\[object Object\]/;

describe("Business supporters, Monthly givers and Invoices with the real server's answers", () => {
  it("the real handlers answered", () => {
    for (const r of Object.values(real)) expect(r.status).toBe(200);
    for (const r of Object.values(broken)) expect(r.status).toBe(500);
  });

  it("Business supporters: the list route reads their email and what they give a month", () => {
    // The open card shows both (fulfilmentAbout); until TASK-644 the route never sent either.
    expect(fulfilmentSql).toContain("AS donor_email");
    expect(fulfilmentSql).toContain("AS monthly_pence");
  });

  it("Business supporters: draws the business, and its open card gives the email and the monthly amount", async () => {
    const admin = await open("fulfilments", real);
    const view = text(el("view-fulfilments"));
    expect(view).toContain("Pretend Bakery Ltd");
    expect(view).not.toMatch(NOTHING_MADE_UP);
    (q('[data-fulfil-toggle="3"]') as HTMLElement).click();
    await admin.settle();
    const card = q('[data-fx-open="3"]');
    expect((card?.querySelector('a[href^="mailto:"]') as HTMLAnchorElement | null)?.getAttribute("href")).toBe("mailto:accounts@example.com");
    expect(text(card)).toContain("Gives £50 a month");
  });

  it("Business supporters: says plainly when the list could not be loaded", async () => {
    await open("fulfilments", { ...real, ...broken });
    expect(text(el("view-fulfilments"))).toMatch(/could not|unavailable/i);
  });

  it("Monthly givers: names each giver with what they give, since when, and a cancelled one as cancelled", async () => {
    const admin = await open("monthly", real);
    let table = text(el("monthlyTable"));
    // It opens on Still giving, which leaves the cancelled one out.
    for (const s of ["Kirsty Imaginary", "£15", "kirsty@example.com"]) expect(table).toContain(s);
    expect(table).not.toContain("Struan Unreal");
    choose(el("monthlyStateFilter"), "");
    await admin.settle();
    table = text(el("monthlyTable"));
    for (const s of ["Struan Unreal", "£5"]) expect(table).toContain(s);
    expect(table).toMatch(/cancel/i);
    expect(text(el("view-monthly"))).not.toMatch(NOTHING_MADE_UP);
  });

  it("Monthly givers: says plainly when they could not be loaded", async () => {
    await open("monthly", { ...real, ...broken });
    expect(text(el("monthlyTable"))).toMatch(/could not|unavailable/i);
  });

  it("Invoices: each invoice with its number, who it is to, the amount and where it stands", async () => {
    await open("invoices", real);
    const view = text(el("view-invoices"));
    for (const s of ["INV-0012", "Pretend Bakery Ltd", "£250", "INV-0011", "Ailsa Sample", "£40", "INV-0010", "£100"]) expect(view).toContain(s);
    expect(view).toMatch(/overdue/i);
    expect(view).toMatch(/paid/i);
    expect(view).not.toMatch(NOTHING_MADE_UP);
  });

  it("Invoices: says plainly when they could not be loaded", async () => {
    await open("invoices", { ...real, ...broken });
    expect(text(el("invList"))).toContain("The invoices could not load.");
  });
});
