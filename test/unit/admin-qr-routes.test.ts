import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-492: the admin's QR codes. The list of pages (with each code drawn as an SVG for its
// preview) and a code to download as SVG or PNG. Anyone who can view Site pages may use them; the
// codes point only at public pages of nbcc.scot. The session's user, the Ball's gate and the Events
// switch are mocked. Invented addresses only.

const m = vi.hoisted(() => ({
  getUserAuthRow: vi.fn(),
  getSettings: vi.fn(),
  isGateOpen: vi.fn(),
  getEventsSettings: vi.fn(),
}));
vi.mock("../../src/db/admin-users", () => ({ getUserAuthRow: m.getUserAuthRow }));
vi.mock("../../src/db/ball", () => ({ getSettings: m.getSettings }));
vi.mock("../../src/ball/gate", () => ({ isGateOpen: m.isGateOpen }));
vi.mock("../../src/db/events", () => ({ getEventsSettings: m.getEventsSettings }));
vi.mock("../../src/config", () => ({ config: { NODE_ENV: "development", ADMIN_SESSION_SECRET: "test-admin-secret" } }));

import { getQrCodes, getQrImage } from "../../src/routes/admin-qr";
import { signAdminSession } from "../../src/admin/session";
import { SITE_PAGES } from "../../src/site/pages";

const SECRET = "test-admin-secret";
const tokenFor = (role: "admin" | "editor" | "viewer", permissions: Record<string, string> = {}) => {
  m.getUserAuthRow.mockResolvedValue({ id: 4, email: "sam@example.com", status: "active", role, permissions });
  return signAdminSession({ sub: 4, email: "sam@example.com", role, now: new Date(), secret: SECRET }).token;
};

type MockRes = {
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
  status: (c: number) => MockRes;
  json: (b: unknown) => MockRes;
  setHeader: (k: string, v: string) => MockRes;
  type: (t: string) => MockRes;
  send: (b: unknown) => MockRes;
};
function mockRes(): MockRes {
  const res = { statusCode: 200, body: undefined as unknown, headers: {} as Record<string, string> } as MockRes;
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; return res; };
  res.type = (t) => { res.headers["content-type"] = t; return res; };
  res.send = (b) => { res.body = b; return res; };
  return res;
}
const call = async (
  handler: (rq: never, rs: never) => Promise<unknown>,
  token: string | null,
  query: Record<string, string> = {},
) => {
  const res = mockRes();
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  await handler({ headers, query, params: {}, body: {} } as never, res as never);
  return res;
};

beforeEach(() => {
  vi.clearAllMocks();
  m.getSettings.mockResolvedValue({});
  m.isGateOpen.mockReturnValue(false);
  m.getEventsSettings.mockResolvedValue({ pageOn: true });
});

describe("GET /api/admin/qr-codes", () => {
  it("needs a session", async () => {
    expect((await call(getQrCodes, null)).statusCode).toBe(401);
  });

  it("needs Site pages access", async () => {
    expect((await call(getQrCodes, tokenFor("viewer", { site: "none" }))).statusCode).toBe(403);
  });

  it("lists every page with its link, whether it is live, and its code to preview", async () => {
    const res = await call(getQrCodes, tokenFor("viewer"));
    expect(res.statusCode).toBe(200);
    const pages = (res.body as { pages: Array<{ path: string; live: boolean; link: string; svg: string }> }).pages;
    expect(pages[0]).toMatchObject({ path: "/", title: "Home", live: true, link: "https://nbcc.scot/?utm_medium=qr&utm_campaign=home" });
    expect(pages.every((p) => p.svg.startsWith("<svg"))).toBe(true);
    expect(pages.find((p) => p.path === "/ball")?.live).toBe(false);
    expect(pages.find((p) => p.path === "/events")?.live).toBe(true);
    expect(pages.length).toBeGreaterThanOrEqual(SITE_PAGES.length);
  });

  // A switch that cannot be read is treated as off: better "not live yet" than a dead poster.
  it("counts a gate it cannot read as not live", async () => {
    m.getEventsSettings.mockRejectedValue(new Error("down"));
    const res = await call(getQrCodes, tokenFor("viewer"));
    const pages = (res.body as { pages: Array<{ path: string; live: boolean }> }).pages;
    expect(pages.find((p) => p.path === "/events")?.live).toBe(false);
  });
});

describe("GET /api/admin/qr-codes/image", () => {
  it("needs a session and Site pages access", async () => {
    expect((await call(getQrImage, null, { path: "/ball", format: "svg" })).statusCode).toBe(401);
    expect((await call(getQrImage, tokenFor("viewer", { site: "none" }), { path: "/ball", format: "svg" })).statusCode).toBe(403);
  });

  it("downloads the SVG, named after the page", async () => {
    const res = await call(getQrImage, tokenFor("viewer"), { path: "/ball/terms", format: "svg" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/svg+xml");
    expect(res.headers["content-disposition"]).toBe('attachment; filename="nbcc-qr-ball-terms.svg"');
    expect(res.headers["cache-control"]).toBe("private, no-store");
    expect(String(res.body).startsWith("<svg")).toBe(true);
  });

  it("downloads the PNG, named after the page", async () => {
    const res = await call(getQrImage, tokenFor("viewer"), { path: "/give", format: "png" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(res.headers["content-disposition"]).toBe('attachment; filename="nbcc-qr-give.png"');
    expect(Buffer.isBuffer(res.body)).toBe(true);
  });

  it("refuses an address that is not a page on nbcc.scot, or an unknown format", async () => {
    const token = tokenFor("viewer");
    for (const query of [
      { path: "https://evil.example/", format: "svg" },
      { path: "give", format: "svg" },
      { path: "/ball", format: "gif" },
      { format: "png" },
    ]) {
      const res = await call(getQrImage, token, query as Record<string, string>);
      expect(res.statusCode, JSON.stringify(query)).toBe(400);
      expect((res.body as { error: string }).error).toBe("Give an address on nbcc.scot, starting with /");
    }
  });
});
