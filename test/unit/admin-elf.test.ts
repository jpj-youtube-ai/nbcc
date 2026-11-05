import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// NBCC Elf Detective School in the admin: the switch, the pay what you can amounts, and the sign ups.
// Every family here is invented.

const { getUserAuthRowMock, db } = vi.hoisted(() => ({
  getUserAuthRowMock: vi.fn(),
  db: { getElfSettings: vi.fn(), setElfSettings: vi.fn(), listElfSignups: vi.fn(), setElfPreview: vi.fn() },
}));
vi.mock("../../src/db/admin-users", () => ({ getUserAuthRow: getUserAuthRowMock }));
vi.mock("../../src/db/elf", () => db);
vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));
vi.mock("../../src/config", () => ({
  config: { NODE_ENV: "development", ADMIN_SESSION_SECRET: "test-admin-secret", STRIPE_SECRET_KEY: "sk_test_aaaaaaaaaaaaaaaaaaaa", STRIPE_WEBHOOK_SECRET: "whsec_x" },
}));

import { getAdminElfSettings, getAdminElfSignups, patchAdminElfSettings } from "../../src/routes/admin-elf";
import { signAdminSession } from "../../src/admin/session";

const ON = { schoolOn: true, year: 2026, entryFromPence: 100, entrySuggestedPence: 500 };

// `permissions` is a saved Team matrix: {} means the role's own defaults.
const tokenFor = (role: string, permissions: object = {}) => {
  getUserAuthRowMock.mockResolvedValue({ id: 1, email: "staff@example.org", status: "active", role, permissions });
  return signAdminSession({ sub: 1, email: "staff@example.org", role, now: new Date(), secret: "test-admin-secret" }).token;
};

function mockRes() {
  const res = { statusCode: 200, body: undefined as unknown, status(c: number) { res.statusCode = c; return res; }, json(b: unknown) { res.body = b; return res; }, setHeader() { return res; } };
  return res;
}
const req = (role: string | null, body: unknown = {}, permissions: object = {}) => ({ headers: role ? { authorization: `Bearer ${tokenFor(role, permissions)}` } : {}, body, params: {}, query: {} });
/** A head elf: a viewer whom an admin has given the Elf Detective School in the Team matrix. */
const HEAD_ELF = { elf: "view" };
/* eslint-disable @typescript-eslint/no-explicit-any */
const run = async (h: (req: any, res: any) => Promise<unknown>, r: unknown) => {
  const res = mockRes();
  await h(r as any, res as any);
  return res;
};
/* eslint-enable @typescript-eslint/no-explicit-any */

beforeEach(() => {
  getUserAuthRowMock.mockReset();
  for (const f of Object.values(db)) f.mockReset();
  db.getElfSettings.mockResolvedValue(ON);
  db.setElfSettings.mockImplementation(async (patch: object) => ({ ...ON, ...patch }));
});

describe("the school's settings in the admin", () => {
  it("can be read by anyone given the Elf Detective School, but nobody signed out", async () => {
    expect((await run(getAdminElfSettings, req(null))).statusCode).toBe(401);
    const res = await run(getAdminElfSettings, req("viewer", {}, HEAD_ELF));
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ settings: ON });
  });

  it("is not for an editor or a viewer who has not been given the section", async () => {
    expect((await run(getAdminElfSettings, req("editor"))).statusCode).toBe(403);
    expect((await run(getAdminElfSettings, req("viewer"))).statusCode).toBe(403);
    expect((await run(getAdminElfSettings, req("editor", {}, { fundraising: "edit" }))).statusCode).toBe(403);
  });

  it("can only be changed by an admin", async () => {
    expect((await run(patchAdminElfSettings, req("viewer", { schoolOn: true }))).statusCode).toBe(403);
    expect((await run(patchAdminElfSettings, req("editor", { schoolOn: true }))).statusCode).toBe(403);
    const res = await run(patchAdminElfSettings, req("admin", { schoolOn: true }));
    expect(res.statusCode).toBe(200);
    expect(db.setElfSettings).toHaveBeenCalledWith({ schoolOn: true }, "admin:staff@example.org");
  });

  it("refuses amounts that do not make sense, in plain words, and saves nothing", async () => {
    for (const body of [{ entryFromPence: 50 }, { entryFromPence: 1100 }, { entrySuggestedPence: 99 }, { entrySuggestedPence: 6000 }, { entryFromPence: 300, entrySuggestedPence: 200 }, { schoolOn: "yes" }]) {
      const res = await run(patchAdminElfSettings, req("admin", body));
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(String((res.body as { error: string }).error)).toMatch(/^[A-Z]/);
    }
    // The suggested amount is checked against the "from" amount already saved, too.
    db.getElfSettings.mockResolvedValue({ ...ON, entryFromPence: 300 });
    expect((await run(patchAdminElfSettings, req("admin", { entrySuggestedPence: 200 }))).statusCode).toBe(400);
    expect(db.setElfSettings).not.toHaveBeenCalled();
  });
});

describe("the sign ups in the admin", () => {
  it("shows a head elf the paid sign ups, and nobody without the section", async () => {
    const summary = { families: 2, detectives: 3, entryPence: 1500, donationPence: 500, giftAidPence: 500, recent: [] };
    db.listElfSignups.mockResolvedValue(summary);
    const res = await run(getAdminElfSignups, req("viewer", {}, HEAD_ELF));
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(summary);
    expect((await run(getAdminElfSignups, req("editor"))).statusCode).toBe(403);
  });
});

// Head Elf HQ (5 November 2026): its own section under Content, after the Festive Ball; the old card
// in Get involved > Settings, and its script, are gone.
describe("the Elf Detective School in the admin's menu", () => {
  const html = readFileSync(resolve(__dirname, "../../admin.html"), "utf8");
  const content = html.slice(html.indexOf('id="adminNavContent"'), html.indexOf("</ul>", html.indexOf('id="adminNavContent"')));

  it("is in Content, right after the Festive Ball", () => {
    const views = [...content.matchAll(/data-view="([a-z-]+)"/g)].map((m) => m[1]);
    expect(views.indexOf("elf")).toBe(views.indexOf("ball") + 1);
    expect(content).toContain('data-view="elf">Elf Detective School</button>');
  });

  it("has a section of its own for Head Elf HQ to draw into", () => {
    expect(html).toMatch(/<section class="admin-view" id="view-elf"[^>]*hidden>/);
    expect(html).toContain('<div id="elfHq"></div>');
  });

  it("is no longer a card in Get involved", () => {
    expect(html).not.toContain('id="elfAdmin"');
    expect(html).not.toContain("/assets/js/admin/elf.js");
  });
});

describe("the private preview link", () => {
  it("is made by an admin only, and hands back a link with a long random code", async () => {
    const { postAdminElfPreview } = await import("../../src/routes/admin-elf");
    expect((await run(postAdminElfPreview, req("editor"))).statusCode).toBe(403);
    const res = await run(postAdminElfPreview, req("admin"));
    expect(res.statusCode).toBe(200);
    const url = String((res.body as { url: string }).url);
    expect(url).toMatch(/\/elf\/preview\/[0-9a-f]{64}$/);
  });
});
