import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-588: the named QR codes' routes. Anyone who can view Site pages sees and downloads them;
// making and changing one needs edit. "Goes to" is only ever a value from the list. A scan is sent
// on and counted, and anything that is not one of ours falls through. The database, the session's
// user and the page switches are mocked. Invented names only.

const m = vi.hoisted(() => ({
  getUserAuthRow: vi.fn(),
  qrGates: vi.fn(),
  listQrCodes: vi.fn(),
  listScanDays: vi.fn(),
  qrCodeTarget: vi.fn(),
  countScan: vi.fn(),
  createQrCode: vi.fn(),
  updateQrCode: vi.fn(),
}));
vi.mock("../../src/db/admin-users", () => ({ getUserAuthRow: m.getUserAuthRow }));
vi.mock("../../src/routes/admin-qr", () => ({ qrGates: m.qrGates }));
vi.mock("../../src/db/qr-codes", () => ({
  listQrCodes: m.listQrCodes,
  listScanDays: m.listScanDays,
  qrCodeTarget: m.qrCodeTarget,
  countScan: m.countScan,
  createQrCode: m.createQrCode,
  updateQrCode: m.updateQrCode,
}));
vi.mock("../../src/config", () => ({ config: { NODE_ENV: "development", ADMIN_SESSION_SECRET: "test-admin-secret" } }));

import { getNamedCodeImage, getNamedCodes, getNamedScan, patchNamedCode, postNamedCode } from "../../src/routes/qr-codes";
import { signAdminSession } from "../../src/admin/session";

const SECRET = "test-admin-secret";
const tokenFor = (role: "admin" | "editor" | "viewer", permissions: Record<string, string> = {}) => {
  m.getUserAuthRow.mockResolvedValue({ id: 4, email: "sam@example.com", status: "active", role, permissions });
  return signAdminSession({ sub: 4, email: "sam@example.com", role, now: new Date(), secret: SECRET }).token;
};

type MockRes = {
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
  redirectedTo?: string;
  status: (c: number) => MockRes;
  json: (b: unknown) => MockRes;
  setHeader: (k: string, v: string) => MockRes;
  type: (t: string) => MockRes;
  send: (b: unknown) => MockRes;
  redirect: (c: number, u: string) => void;
};
function mockRes(): MockRes {
  const res = { statusCode: 200, body: undefined as unknown, headers: {} as Record<string, string> } as MockRes;
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; return res; };
  res.type = (t) => { res.headers["content-type"] = t; return res; };
  res.send = (b) => { res.body = b; return res; };
  res.redirect = (c, u) => { res.statusCode = c; res.redirectedTo = u; };
  return res;
}
type Req = { token?: string | null; query?: Record<string, string>; params?: Record<string, string>; body?: unknown };
const call = async (handler: (rq: never, rs: never) => Promise<unknown>, r: Req = {}) => {
  const res = mockRes();
  const headers = r.token ? { authorization: `Bearer ${r.token}` } : {};
  await handler({ headers, query: r.query ?? {}, params: r.params ?? {}, body: r.body ?? {} } as never, res as never);
  return res;
};

const CODE = { id: 12, name: "Donate billboard, High Street", target: "/donate", hidden: false, createdAt: "2026-11-01T10:00:00.000Z", updatedBy: "admin:sam@example.com", updatedAt: "2026-11-01T10:00:00.000Z" };

beforeEach(() => {
  vi.clearAllMocks();
  m.qrGates.mockResolvedValue({ ballOpen: false, eventsOn: true, fundraisingOn: true });
  m.listQrCodes.mockResolvedValue([CODE]);
  m.listScanDays.mockResolvedValue([{ codeId: 12, day: "2026-10-01", scans: 4 }, { codeId: 99, day: "2026-10-01", scans: 50 }]);
  m.qrCodeTarget.mockResolvedValue("/donate");
  m.countScan.mockResolvedValue(undefined);
  m.createQrCode.mockResolvedValue({ ...CODE, id: 13 });
  m.updateQrCode.mockResolvedValue(CODE);
});

describe("GET /api/admin/qr-codes/named", () => {
  it("needs a session, and Site pages view", async () => {
    expect((await call(getNamedCodes)).statusCode).toBe(401);
    expect((await call(getNamedCodes, { token: tokenFor("viewer", { site: "none" }) })).statusCode).toBe(403);
    expect((await call(getNamedCodes, { token: tokenFor("viewer", { site: "view" }) })).statusCode).toBe(200);
  });

  it("gives each code its name, where it goes, its short link, its own scans and a preview", async () => {
    const res = await call(getNamedCodes, { token: tokenFor("viewer", { site: "view" }) });
    const body = res.body as { codes: Record<string, unknown>[]; destinations: { value: string }[] };
    expect(body.codes).toHaveLength(1);
    const c = body.codes[0];
    expect(c).toMatchObject({ id: 12, name: CODE.name, target: "/donate", targetTitle: "Donate", targetLive: true, hidden: false, link: "https://nbcc.scot/q/c12" });
    expect((c.scans as { total: number }).total).toBe(4);
    expect(String(c.svg)).toContain("<svg");
    expect(body.destinations.map((d) => d.value)).toContain("https://drop.nbcc.scot");
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("says so when the list cannot load, rather than showing none", async () => {
    m.listQrCodes.mockRejectedValue(new Error("down"));
    const res = await call(getNamedCodes, { token: tokenFor("admin") });
    expect(res.statusCode).toBe(500);
  });
});

describe("POST /api/admin/qr-codes/named", () => {
  it("needs Site pages edit: view is not enough", async () => {
    const res = await call(postNamedCode, { token: tokenFor("viewer", { site: "view" }), body: { name: "Card", target: "/donate" } });
    expect(res.statusCode).toBe(403);
    expect(m.createQrCode).not.toHaveBeenCalled();
  });

  it("makes a code from a name and a value from the list, and records who", async () => {
    const res = await call(postNamedCode, { token: tokenFor("admin"), body: { name: "  Jo's   business card ", target: "https://vol.nbcc.scot" } });
    expect(res.statusCode).toBe(201);
    expect(res.body).toEqual({ id: 13, link: "https://nbcc.scot/q/c13" });
    expect(m.createQrCode).toHaveBeenCalledWith("Jo's business card", "https://vol.nbcc.scot", "admin:sam@example.com");
  });

  it("refuses a missing name, and anything that is not on the list", async () => {
    const t = tokenFor("admin");
    expect((await call(postNamedCode, { token: t, body: { name: " ", target: "/donate" } })).body).toMatchObject({ field: "name" });
    for (const target of ["/donat", "https://example.com", "/donate?x=1", undefined]) {
      const res = await call(postNamedCode, { token: t, body: { name: "Card", target } });
      expect(res.statusCode, String(target)).toBe(400);
      expect(res.body).toMatchObject({ field: "target" });
    }
    expect(m.createQrCode).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/admin/qr-codes/named/:id", () => {
  it("renames, changes where it goes, and hides, with edit", async () => {
    const t = tokenFor("admin");
    const res = await call(patchNamedCode, { token: t, params: { id: "12" }, body: { name: "New name", target: "/fill", hidden: true } });
    expect(res.statusCode).toBe(200);
    expect(m.updateQrCode).toHaveBeenCalledWith(12, { name: "New name", target: "/fill", hidden: true }, "admin:sam@example.com");
  });

  it("needs edit, a known code and a real change", async () => {
    expect((await call(patchNamedCode, { token: tokenFor("viewer", { site: "view" }), params: { id: "12" }, body: { hidden: true } })).statusCode).toBe(403);
    const t = tokenFor("admin");
    expect((await call(patchNamedCode, { token: t, params: { id: "abc" }, body: { hidden: true } })).statusCode).toBe(404);
    m.updateQrCode.mockResolvedValueOnce(null);
    expect((await call(patchNamedCode, { token: t, params: { id: "77" }, body: { hidden: true } })).statusCode).toBe(404);
    expect((await call(patchNamedCode, { token: t, params: { id: "12" }, body: {} })).statusCode).toBe(400);
    expect((await call(patchNamedCode, { token: t, params: { id: "12" }, body: { target: "https://example.com" } })).statusCode).toBe(400);
    expect((await call(patchNamedCode, { token: t, params: { id: "12" }, body: { hidden: "yes" } })).statusCode).toBe(400);
  });
});

describe("GET /api/admin/qr-codes/named/:id/image", () => {
  it("downloads the code, holding its short link, as SVG or PNG", async () => {
    const t = tokenFor("viewer", { site: "view" });
    const svg = await call(getNamedCodeImage, { token: t, params: { id: "12" }, query: { format: "svg" } });
    expect(svg.statusCode).toBe(200);
    expect(svg.headers["content-type"]).toBe("image/svg+xml");
    expect(svg.headers["content-disposition"]).toBe('attachment; filename="nbcc-qr-c12.svg"');
    const png = await call(getNamedCodeImage, { token: t, params: { id: "12" }, query: { format: "png" } });
    expect(png.headers["content-type"]).toBe("image/png");
    expect(Buffer.isBuffer(png.body)).toBe(true);
  });

  it("refuses an unknown code or format", async () => {
    const t = tokenFor("admin");
    expect((await call(getNamedCodeImage, { token: t, params: { id: "12" }, query: { format: "gif" } })).statusCode).toBe(400);
    m.qrCodeTarget.mockResolvedValueOnce(null);
    expect((await call(getNamedCodeImage, { token: t, params: { id: "40" }, query: { format: "svg" } })).statusCode).toBe(404);
  });
});

describe("GET /q/c<id>: a scan", () => {
  const PHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
  const scan = async (code: string, ua = PHONE, method = "GET") => {
    const res = mockRes();
    const next = vi.fn();
    await getNamedScan({ method, params: { code }, headers: { "user-agent": ua } } as never, res as never, next);
    return { res, next };
  };

  it("sends a page scan on with its Analytics tags, never kept, and counts it", async () => {
    const { res, next } = await scan("c12");
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(302);
    expect(res.redirectedTo).toBe("https://nbcc.scot/donate?utm_medium=qr&utm_campaign=c12");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(m.countScan).toHaveBeenCalledWith(12, expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
  });

  it("sends a sign up site scan on as it is", async () => {
    m.qrCodeTarget.mockResolvedValueOnce("https://drop.nbcc.scot");
    const { res } = await scan("C12");
    expect(res.redirectedTo).toBe("https://drop.nbcc.scot");
  });

  it("sends a bot or link preview on without counting it", async () => {
    const { res } = await scan("c12", "WhatsApp/2.23.20 A");
    expect(res.statusCode).toBe(302);
    expect(m.countScan).not.toHaveBeenCalled();
    await scan("c12", PHONE, "HEAD");
    expect(m.countScan).not.toHaveBeenCalled();
  });

  it("still sends the scan on when counting fails", async () => {
    m.countScan.mockRejectedValueOnce(new Error("down"));
    const { res } = await scan("c12");
    expect(res.statusCode).toBe(302);
  });

  it("lets anything that is not one of ours fall through", async () => {
    expect((await scan("12-a4")).next).toHaveBeenCalled();
    m.qrCodeTarget.mockResolvedValueOnce(null);
    expect((await scan("c404")).next).toHaveBeenCalled();
  });

  it("sends a scan to the home page when the code cannot be looked up just then", async () => {
    m.qrCodeTarget.mockRejectedValueOnce(new Error("down"));
    const { res, next } = await scan("c12");
    expect(next).not.toHaveBeenCalled();
    expect(res.redirectedTo).toBe("https://nbcc.scot/?utm_medium=qr&utm_campaign=c12");
  });
});
