// @vitest-environment jsdom
import { describe, it, expect, beforeAll, vi } from "vitest";

// TASK-644: Audit, Email audit and Notifications fed what the REAL server sends. The route handlers
// (src/routes/admin.ts, src/routes/admin-push.ts) run for real, with every query they make
// (src/db/admin.ts, src/db/email-log.ts, src/db/admin-push.ts) answered by invented rows in the
// tables' own shape (helpers/real-rows.ts). Only the database is pretend.

vi.mock("../../src/db/pool", async () => ({ pool: (await import("./helpers/real-server")).db.pool }));
vi.mock("../../src/config", async () => ({ config: (await import("./helpers/real-server")).CONFIG }));

import { db, callRoute, replyWith, type Reply } from "./helpers/real-server";
import { auditRows, down } from "./helpers/real-rows";
import { mountAdmin, el, text } from "./helpers/admin-settings-harness";
import { getAdminAuditLog, getAdminEmailLog } from "../../src/routes/admin";
import { adminPushRouter } from "../../src/routes/admin-push";

vi.setConfig({ testTimeout: 30_000 });

/** The handler a router holds for one GET path (admin-push.ts writes its handlers inline). */
function routerGet(path: string): Parameters<typeof callRoute>[0] {
  type Layer = { route?: { path: string; methods: Record<string, boolean>; stack: { handle: Parameters<typeof callRoute>[0] }[] } };
  const layer = (adminPushRouter.stack as unknown as Layer[]).find((l) => l.route?.path === path && l.route.methods.get);
  if (!layer?.route) throw new Error("no route " + path);
  return layer.route.stack[0].handle;
}

const real: Record<string, Reply> = {};
const broken: Record<string, Reply> = {};
beforeAll(async () => {
  db.answer(auditRows());
  real["GET /api/admin/audit"] = await callRoute(getAdminAuditLog, { query: { limit: "50", offset: "0", summary: "1" } });
  db.answer(auditRows());
  real["GET /api/admin/email-log"] = await callRoute(getAdminEmailLog, { query: { limit: "50", offset: "0" } });
  db.answer(auditRows());
  real["GET /api/admin/push/prefs"] = await callRoute(routerGet("/api/admin/push/prefs"));
  db.answer(auditRows());
  real["GET /api/admin/push/subscription"] = await callRoute(routerGet("/api/admin/push/subscription"));

  db.answer([down("FROM audit_log")]);
  broken["GET /api/admin/audit"] = await callRoute(getAdminAuditLog, { query: { summary: "1" } });
  db.answer([down("FROM email_log")]);
  broken["GET /api/admin/email-log"] = await callRoute(getAdminEmailLog, { query: {} });
  db.answer([down("FROM admin_notify_prefs")]);
  broken["GET /api/admin/push/prefs"] = await callRoute(routerGet("/api/admin/push/prefs"));
});

async function open(view: string, replies: Record<string, Reply>) {
  const admin = mountAdmin({ role: "admin" }, replyWith(replies));
  await admin.signIn();
  await admin.open(view);
  return admin;
}
const NOTHING_MADE_UP = /undefined|NaN|Invalid Date|\[object Object\]/;

describe("Audit, Email audit and Notifications with the real server's answers", () => {
  it("the real handlers answered", () => {
    for (const r of Object.values(real)) expect(r.status).toBe(200);
    for (const r of Object.values(broken)) expect(r.status).toBe(500);
  });

  it("Audit: says who did what, naming the staff member and the person a change was about", async () => {
    await open("audit", real);
    const list = text(el("auditTable"));
    for (const s of ["Fern Example changed a donor's details", "Team member: Sam Pretend (sam@example.com)", "Stripe recorded a failed monthly payment", "Tuesday 10 November 2026 at 4:05pm"]) {
      expect(list).toContain(s);
    }
    expect(list).not.toMatch(NOTHING_MADE_UP);
  });

  it("Audit: says plainly when it could not be loaded", async () => {
    await open("audit", broken);
    expect(text(el("auditTable"))).toMatch(/could not|unavailable/i);
  });

  it("Email audit: lists each email with who it went to, its subject and what happened, and the bounce in the band", async () => {
    await open("email-audit", real);
    const list = text(el("emailAuditTable"));
    for (const s of ["rowan@example.com", "Thank you for your gift", "Your sign in code", "Provider refused the send"]) expect(list).toContain(s);
    expect(list).not.toMatch(NOTHING_MADE_UP);
    const band = text(el("emailAuditFailures"));
    expect(band).toContain("gone@example.com");
    expect(band).not.toMatch(NOTHING_MADE_UP);
  });

  it("Email audit: says plainly when it could not be loaded", async () => {
    await open("email-audit", broken);
    expect(text(el("emailAuditTable"))).toMatch(/could not|unavailable/i);
  });

  it("Notifications: shows their phones, quiet time and what buzzes, from the real settings", async () => {
    await open("notifications", real);
    expect(text(el("pushPhoneCount"))).toBe("2 phones are set up.");
    expect((el("pushBundle") as HTMLInputElement).checked).toBe(true);
    expect((el("pushQuietFrom") as HTMLInputElement).value).toBe("22:00");
    expect((el("pushQuietTo") as HTMLInputElement).value).toBe("07:30");
    expect(text(el("pushQuietSaid"))).toMatch(/^Quiet from 10(:00)?\s?pm until 7:30\s?am\.$/i);
    expect((el("pushAreas").querySelector('[data-push-area="newsletter"]') as HTMLInputElement).checked).toBe(false);
    expect((el("pushAreas").querySelector('[data-push-area="donations"]') as HTMLInputElement).checked).toBe(true);
  });

  it("Notifications: says plainly when the settings could not be loaded", async () => {
    await open("notifications", broken);
    expect(text(el("pushAreas"))).toBe("Could not load your settings.");
  });
});
