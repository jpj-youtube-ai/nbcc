// @vitest-environment jsdom
import { describe, it, expect, beforeAll, vi } from "vitest";

// TASK-644: Contact businesses and one business's page fed what the REAL server sends. The route
// handlers in src/routes/admin.ts run for real, with every query they make (src/db/outreach.ts)
// answered by invented rows in the tables' own shape (helpers/real-rows.ts): an ask again date comes
// back as pg gives a `date` column, a Date. Only the database is pretend.

vi.mock("../../src/db/pool", async () => ({ pool: (await import("./helpers/real-server")).db.pool }));
vi.mock("../../src/config", async () => ({ config: (await import("./helpers/real-server")).CONFIG }));

import { db, callRoute, replyWith, type Reply } from "./helpers/real-server";
import { outreachRows, down } from "./helpers/real-rows";
import { mountAdmin, el, q, text } from "./helpers/admin-settings-harness";
import {
  getAdminOutreach, getAdminOutreachTodo, getAdminOutreachReports, getAdminOutreachVolunteers, getAdminOutreachOne, patchAdminOutreach,
} from "../../src/routes/admin";

vi.setConfig({ testTimeout: 30_000 });

const real: Record<string, Reply> = {};
const broken: Record<string, Reply> = {};
beforeAll(async () => {
  const get = async (key: string, handler: Parameters<typeof callRoute>[0], opts: Parameters<typeof callRoute>[1] = {}) => {
    db.answer(outreachRows(), { email: "fern@example.com" });
    real[key] = await callRoute(handler, opts);
  };
  await get("GET /api/admin/outreach", getAdminOutreach, { query: { limit: "200", offset: "0" } });
  await get("GET /api/admin/outreach/todo", getAdminOutreachTodo, { query: { scope: "mine" } });
  await get("GET /api/admin/outreach/reports", getAdminOutreachReports);
  await get("GET /api/admin/outreach/volunteers", getAdminOutreachVolunteers);
  for (const id of ["21", "22", "23"]) await get(`GET /api/admin/outreach/${id}`, getAdminOutreachOne, { params: { id } });

  db.answer([down("WHERE outcome IS NULL OR outcome NOT IN")]);
  broken["GET /api/admin/outreach/todo"] = await callRoute(getAdminOutreachTodo, { query: { scope: "mine" } });
});

async function open(replies: Record<string, Reply>) {
  const admin = mountAdmin({ role: "admin" }, replyWith(replies));
  await admin.signIn();
  await admin.open("outreach");
  return admin;
}
async function openBusiness(id: number) {
  const admin = await open(real);
  (q(`#outList [data-out-open="${id}"]`) as HTMLElement).click();
  await admin.settle(12);
  return admin;
}
const NOTHING_MADE_UP = /undefined|NaN|Invalid Date|\[object Object\]/;

describe("Contact businesses with the real server's answers", () => {
  it("the real handlers answered, even for a business with an ask again date", () => {
    for (const [key, r] of Object.entries(real)) expect([key, r.status]).toEqual([key, 200]);
    expect(broken["GET /api/admin/outreach/todo"].status).toBe(500);
  });

  it("puts the business that asked us to come back now on the to do list", async () => {
    await open(real);
    const todo = text(el("outTodo"));
    expect(todo).toContain("Imaginary Florist");
    expect(todo).toContain("They asked us to come back around now.");
    expect(todo).not.toContain("Pretend Bakery Ltd");
    expect(todo).not.toMatch(NOTHING_MADE_UP);
  });

  it("lists every business with its contact and latest note", async () => {
    await open(real);
    const list = text(el("outList"));
    for (const s of ["Pretend Bakery Ltd", "Imaginary Florist", "Madeup Garage", "Said to try again in the autumn."]) expect(list).toContain(s);
    expect(list).not.toMatch(NOTHING_MADE_UP);
  });

  it("reports what came of it from the real figures", async () => {
    await open(real);
    const reports = text(el("outReports"));
    expect(reports).toContain("£150");
    expect(reports).not.toMatch(NOTHING_MADE_UP);
  });

  it("says plainly when the to do list could not be loaded", async () => {
    await open({ ...real, ...broken });
    expect(text(el("outTodo"))).toBe("Could not load this list.");
  });
});

describe("one business's page with the real server's answers", () => {
  it("shows who they are, the note, and the supporter they became", async () => {
    await openBusiness(21);
    const page = text(el("view-business"));
    for (const s of ["Pretend Bakery Ltd", "Robin Contact", "hello@bakery.example.com"]) expect(page).toContain(s);
    expect(page).not.toMatch(NOTHING_MADE_UP);
  });

  it("opens a business with an ask again date, and says the date as people do", async () => {
    await openBusiness(22);
    const page = text(el("view-business"));
    expect(page).not.toContain("Could not load that business.");
    expect(page).toContain("Imaginary Florist");
    expect(page).toContain("1 October 2026");
    expect(page).toContain("Said to try again in the autumn.");
    expect((el("businessAskAgain") as HTMLInputElement).value).toBe("2026-10-01");
  });
});

// TASK-647: the form's two requests go to the real PATCH handler, and its answers are what the page shows.
describe("changing a business's details with the real server", () => {
  const rowOf = (over: Record<string, unknown>) => ({
    ...(outreachRows()[3][1] as (p: unknown[]) => Record<string, unknown>[])([23])[0], ...over,
  });
  it("saves a new phone number through the real handler, and the page says so", async () => {
    // The route reads the business, then writes it: the UPDATE hands back the row as the table has it.
    const rules = outreachRows();
    db.answer([
      ["UPDATE business_outreach", [rowOf({ contact_phone: "01632 960123" })]],
      ...rules,
    ], { email: "fern@example.com" });
    const saved = await callRoute(patchAdminOutreach, { params: { id: "23" }, body: { contactPhone: "01632 960123" } });
    expect(saved.status).toBe(200);
    expect((saved.body as { business: { contactPhone: string } }).business.contactPhone).toBe("01632 960123");

    db.answer(outreachRows(), { email: "fern@example.com" });
    const refused = await callRoute(patchAdminOutreach, { params: { id: "23" }, body: { contactEmail: "other@example.com" } });
    expect(refused.status).toBe(400);

    const admin = mountAdmin({ role: "admin" }, replyWith({ ...real, "PATCH /api/admin/outreach/23": saved }));
    await admin.signIn();
    await admin.open("outreach");
    (q('#outList [data-out-open="23"]') as HTMLElement).click();
    await admin.settle(12);
    (q('.ak-parts [data-akpart="details"]') as HTMLElement).click();
    const phone = el("businessEditPhone") as HTMLInputElement;
    phone.value = "01632 960123";
    el("businessEditForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    await admin.settle(12);
    expect(text(el("businessEditStatus"))).toBe("Saved.");
    expect(text(el("businessEditEmail"))).toBe("garage@example.com");
  });
});
