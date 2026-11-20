// @vitest-environment jsdom
import { describe, it, expect, beforeAll, vi } from "vitest";

// TASK-643: Admin > Analytics fed what the REAL server sends. The route handlers in
// src/routes/admin-analytics.ts run for real, with every query they make (src/db/analytics-report.ts,
// src/db/analytics.ts) answered by invented rows in the tables' own shape (helpers/real-rows.ts).
// Only the database is pretend, so a change to what the server sends that the screen does not
// expect, or the other way round, fails here. The screen tests beside this one answer by hand.

vi.mock("../../src/db/pool", async () => ({ pool: (await import("./helpers/real-server")).db.pool }));
vi.mock("../../src/config", async () => ({ config: (await import("./helpers/real-server")).CONFIG }));

import { db, callRoute, replyWith, type Reply } from "./helpers/real-server";
import { analyticsRows } from "./helpers/real-rows";
import { mountAdmin, el, q, qa, text, press } from "./helpers/admin-settings-harness";
import { getAnalytics, getAnalyticsNow, getAnalyticsSettingsRoute } from "../../src/routes/admin-analytics";

vi.setConfig({ testTimeout: 30_000 });

const real: Record<string, Reply> = {};
const empty: Record<string, Reply> = {};
beforeAll(async () => {
  for (const days of ["7", "30", "90"]) {
    db.answer(analyticsRows());
    real[`GET /api/admin/analytics?days=${days}`] = await callRoute(getAnalytics, { query: { days } });
  }
  db.answer(analyticsRows());
  real["GET /api/admin/analytics/settings"] = await callRoute(getAnalyticsSettingsRoute);
  db.answer(analyticsRows());
  real["GET /api/admin/analytics/now"] = await callRoute(getAnalyticsNow);

  db.answer(analyticsRows({ collecting: false, empty: true }));
  empty["GET /api/admin/analytics"] = await callRoute(getAnalytics, { query: { days: "30" } });
  db.answer(analyticsRows({ collecting: false, empty: true }));
  empty["GET /api/admin/analytics/settings"] = await callRoute(getAnalyticsSettingsRoute);
});

async function open(replies: Record<string, Reply>) {
  const admin = mountAdmin({ role: "admin" }, replyWith(replies));
  await admin.signIn();
  await admin.open("analytics");
  return admin;
}
const part = (key: string) => q(`#view-analytics [data-akpart-body="${key}"]`);

describe("Analytics with the real server's answer", () => {
  it("the real handlers answered (so the rows below are what production would send)", () => {
    for (const r of Object.values(real)) expect(r.status).toBe(200);
    expect(empty["GET /api/admin/analytics"].status).toBe(200);
  });

  it("says the summary in words from the real report", async () => {
    await open(real);
    expect(text(el("anSummary"))).toBe(
      "412 people visited in the last 30 days, about 37% more than the 30 days before. The biggest share of visits came from a search (about 42%). The home page was looked at most, with 600 views.",
    );
  });

  it("shows the four figures and the line of days", async () => {
    await open(real);
    const figures = text(el("anFigures"));
    for (const n of ["412", "530", "1,290", "41%"]) expect(figures).toContain(n);
    expect(figures).toContain("Down 3 points on the 30 days before (44% then)");
    expect(q("#view-analytics svg")).not.toBeNull();
  });

  it("fills every part with the real rows", async () => {
    await open(real);
    const from = text(part("from"));
    for (const s of ["Search", "Other websites", "www.example.org", "Our winter news", "Donate billboard, High Street", "Sam's Santa Dash, A4 poster", "Festive Ball", "Not named"]) {
      expect(from).toContain(s);
    }
    const where = text(part("where"));
    for (const s of ["Kilmarnock", "Dublin", "United Kingdom", "Ireland"]) expect(where).toContain(s);
    const pages = text(part("pages"));
    for (const s of ["Home page", "Donate", "/a-page-that-has-gone", "1 min 15 sec"]) expect(pages).toContain(s);
    expect(text(part("clicks"))).toContain("Donate now");
    const used = text(part("devices"));
    for (const s of ["Phone", "Tablet", "Safari", "Chrome"]) expect(used).toContain(s);
    expect(text(el("view-analytics"))).not.toMatch(/undefined|NaN|\[object Object\]/);
  });

  it("says who switched counting on, from the real switch", async () => {
    await open(real);
    expect(text(el("view-analytics"))).toContain("Switched on by fern@example.com.");
    expect(text(el("anSwitchBtn"))).toBe("Stop counting visits");
  });

  it("changes the days from the real 7 and 90 day answers", async () => {
    const admin = await open(real);
    press(q('[data-andays="7"]'));
    await admin.settle();
    expect(text(el("anSummary"))).toMatch(/^412 people visited in the last 7 days, about 37% more than the 7 days before\./);
    press(q('[data-andays="90"]'));
    await admin.settle();
    expect(text(el("anSummary"))).toMatch(/^412 people visited in the last 90 days/);
  });

  it("links through to QR codes, which then loads", async () => {
    const admin = await open(real);
    const go = q('#view-analytics [data-an-go="qr"]');
    expect(go && go.hidden).toBe(false);
    press(go);
    await admin.settle();
    expect(admin.calls.some((c) => c.path === "/api/admin/qr-codes/named")).toBe(true);
  });

  it("says plainly that nothing is counted when the switch is off and the tables are empty", async () => {
    await open(empty);
    expect(text(el("anSummary"))).toBe("Nobody has been counted visiting in the last 30 days.");
    expect(text(el("anSwitchBtn"))).toBe("Start counting visits");
    expect(qa("#view-analytics .is-error").filter((n) => text(n))).toEqual([]);
  });
});
