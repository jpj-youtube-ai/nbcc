// @vitest-environment jsdom
import { describe, it, expect, beforeAll, vi } from "vitest";

// TASK-644: Newsletter (Overview, All newsletters, Results, Audiences) fed what the REAL server
// sends. The route handlers in src/routes/admin.ts run for real, with every query they make
// (src/db/newsletters.ts, newsletter-events.ts, subscriber-lists.ts, newsletter-send-jobs.ts)
// answered by invented rows in the tables' own shape (helpers/real-rows.ts). Only the database is
// pretend.

vi.mock("../../src/db/pool", async () => ({ pool: (await import("./helpers/real-server")).db.pool }));
vi.mock("../../src/config", async () => ({ config: (await import("./helpers/real-server")).CONFIG }));

import { db, callRoute, replyWith, type Reply } from "./helpers/real-server";
import { newsletterRows, down } from "./helpers/real-rows";
import { mountAdmin, el, q, text, press } from "./helpers/admin-settings-harness";
import {
  adminRouter, getAdminNewsletters, getAdminNewsletterStats, getAdminNewsletterInflight, getAdminSubscriberLists,
} from "../../src/routes/admin";

vi.setConfig({ testTimeout: 30_000 });

/** What the router runs for one GET path: the handler as production calls it. */
function routeOf(path: string): Parameters<typeof callRoute>[0] {
  type Layer = { route?: { path: string; methods: Record<string, boolean>; stack: { handle: Parameters<typeof callRoute>[0] }[] } };
  const layer = (adminRouter.stack as unknown as Layer[]).find((l) => l.route?.path === path && l.route.methods.get);
  if (!layer?.route) throw new Error("no route " + path);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

const real: Record<string, Reply> = {};
beforeAll(async () => {
  db.answer(newsletterRows());
  real["GET /api/admin/newsletters"] = await callRoute(getAdminNewsletters);
  db.answer(newsletterRows());
  real["GET /api/admin/newsletters/41/stats"] = await callRoute(getAdminNewsletterStats, { params: { id: "41" } });
  db.answer(newsletterRows());
  real["GET /api/admin/newsletters/send-jobs/inflight"] = await callRoute(getAdminNewsletterInflight);
  db.answer(newsletterRows());
  real["GET /api/admin/subscriber-lists"] = await callRoute(getAdminSubscriberLists);
});

async function open(replies: Record<string, Reply>) {
  const admin = mountAdmin({ role: "admin" }, replyWith(replies));
  await admin.signIn();
  await admin.open("newsletter");
  return admin;
}
async function go(admin: { settle: () => Promise<void> }, panel: string) {
  press(q(`#view-newsletter [data-nl-panel="${panel}"]`));
  await admin.settle();
}
const NOTHING_MADE_UP = /undefined|NaN|Invalid Date|\[object Object\]|null/;

describe("Newsletter with the real server's answers", () => {
  it("the real handlers answered", () => {
    for (const r of Object.values(real)) expect(r.status).toBe(200);
  });

  it("Overview: the last send, how many it reached, and the audiences", async () => {
    await open(real);
    const overview = text(el("nlPanelOverview"));
    // 110 of the 118 accepted were delivered and 25 clicked: the rates, from the real counts.
    for (const s of ["Our winter news", "93.2%", "21.2%", "could not be sent to 2 addresses", "300 people"]) expect(overview).toContain(s);
    expect(overview).not.toMatch(NOTHING_MADE_UP);
  });

  it("All newsletters: the sent one with its date and who sent it, and the draft", async () => {
    const admin = await open(real);
    await go(admin, "nlPanelHistory");
    const list = text(el("newsletterList"));
    for (const s of ["Our winter news", "Spring appeal", "2 November 2026"]) expect(list).toContain(s);
    expect(list).not.toMatch(NOTHING_MADE_UP);
  });

  it("Results: delivered, bounced, clicked and the link people pressed, from the real stats", async () => {
    const admin = await open(real);
    await go(admin, "nlPanelHistory");
    press(q('#newsletterList [data-who-got="41"]'));
    await admin.settle();
    const results = text(el("nlPanelResults"));
    expect(text(el("nlResultsTitle"))).toBe("Our winter news");
    expect(text(el("nlResultsMeta"))).toContain("fern@example.com");
    expect(text(el("nlResultsMeta"))).toContain("Newsletter");
    for (const s of ["110", "25", "https://nbcc.scot/donate"]) expect(results).toContain(s);
    expect(results).not.toMatch(NOTHING_MADE_UP);
  });

  it("Audiences: each audience with how many are on it", async () => {
    const admin = await open(real);
    await go(admin, "nlPanelAudience");
    const audiences = text(el("nlPanelAudience"));
    for (const s of ["Newsletter", "Donors", "Volunteers", "300", "250", "12"]) expect(audiences).toContain(s);
    expect(audiences).not.toMatch(NOTHING_MADE_UP);
  });

  it("says Newsletters are unavailable when the list fails", async () => {
    await open({ "GET /api/admin/newsletters": { status: 500, body: { error: "Admin is temporarily unavailable" }, headers: {} } });
    expect(text(el("newsletterList"))).toContain("Newsletters are unavailable.");
  });

  it("a database failure on a newsletter read answers 500, rather than stopping the server", async () => {
    // Express 4 does not catch a rejected handler, and nothing in src catches an unhandled
    // rejection: a read that threw took the whole server down instead of telling the screen.
    for (const path of ["/api/admin/newsletters", "/api/admin/subscriber-lists", "/api/admin/newsletters/suppressions", "/api/admin/newsletters/send-jobs/inflight"]) {
      db.answer([down("FROM")]);
      const reply = await callRoute(routeOf(path));
      expect([path, reply.status]).toEqual([path, 500]);
    }
    db.answer([down("FROM")]);
    const stats = await callRoute(routeOf("/api/admin/newsletters/:id/stats"), { params: { id: "41" } });
    expect(stats.status).toBe(500);
  });
});
