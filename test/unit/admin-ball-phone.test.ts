import { describe, it, expect, vi, beforeEach } from "vitest";

// Jaimie 2026-10-03: bookings made before the ticket page asked for the booker's phone number have
// none. Staff chase them by hand, so the admin counts them and lets staff add or change the number,
// audited like every other admin edit (the database half is in src/db/ball.ts, run on Postgres by
// features/ball-admin.feature). Every name and number here is invented.

const m = vi.hoisted(() => ({
  getUserAuthRow: vi.fn(),
  setBookingPhone: vi.fn(),
  countPaidWithoutPhone: vi.fn(),
  listBookings: vi.fn(),
  listAbandonedBookings: vi.fn(),
}));
vi.mock("../../src/db/ball", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/db/ball")>()),
  setBookingPhone: m.setBookingPhone,
  countPaidWithoutPhone: m.countPaidWithoutPhone,
  listBookings: m.listBookings,
  listAbandonedBookings: m.listAbandonedBookings,
}));
vi.mock("../../src/db/admin-users", () => ({ getUserAuthRow: m.getUserAuthRow }));
vi.mock("../../src/config", () => ({
  config: {
    NODE_ENV: "development",
    DATABASE_URL: "postgres://localhost:5432/test",
    ADMIN_SESSION_SECRET: "test-admin-secret",
    STRIPE_SECRET_KEY: "sk_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    STRIPE_WEBHOOK_SECRET: "whsec_placeholder",
  },
}));
vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));

import { getAdminBallBookings, putAdminBallBookingPhone } from "../../src/routes/admin";
import { signAdminSession } from "../../src/admin/session";

const tokenFor = (role: "admin" | "editor" | "viewer", permissions: Record<string, string> = {}) => {
  m.getUserAuthRow.mockResolvedValue({ id: 2, email: "staff@example.com", status: "active", role, permissions });
  return signAdminSession({ sub: 2, email: "staff@example.com", role, now: new Date(), secret: "test-admin-secret" }).token;
};

type MockRes = { statusCode: number; body: unknown; status: (c: number) => MockRes; json: (b: unknown) => MockRes };
function mockRes(): MockRes {
  const res = { statusCode: 200, body: undefined as unknown } as MockRes;
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}
const put = async (token: string, body: unknown, reference = "BALL-7KQ2MZ") => {
  const res = mockRes();
  await putAdminBallBookingPhone(
    { headers: { authorization: `Bearer ${token}` }, params: { reference }, body, query: {} } as never,
    res as never,
  );
  return res;
};
const answer = (res: MockRes) => res.body as Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  m.setBookingPhone.mockResolvedValue({ ok: true, phone: "07700 900123" });
  m.countPaidWithoutPhone.mockResolvedValue(4);
  m.listBookings.mockResolvedValue([]);
  m.listAbandonedBookings.mockResolvedValue([]);
});

describe("PUT /api/admin/ball/bookings/:reference/phone", () => {
  it("needs Festive Ball edit, not just view", async () => {
    expect((await put(tokenFor("viewer"), { phone: "07700 900123" })).statusCode).toBe(403);
    expect(m.setBookingPhone).not.toHaveBeenCalled();
  });

  it("saves a number, trimmed, as the member of staff who typed it", async () => {
    const res = await put(tokenFor("editor", { ball: "edit" }), { phone: "  07700 900123 " });
    expect(res.statusCode).toBe(200);
    expect(answer(res)).toEqual({ reference: "BALL-7KQ2MZ", phone: "07700 900123" });
    expect(m.setBookingPhone).toHaveBeenCalledWith("BALL-7KQ2MZ", "07700 900123", "admin:staff@example.com");
  });

  it("takes the number away when the box is empty", async () => {
    m.setBookingPhone.mockResolvedValue({ ok: true, phone: null });
    const res = await put(tokenFor("admin"), { phone: "" });
    expect(res.statusCode).toBe(200);
    expect(m.setBookingPhone).toHaveBeenCalledWith("BALL-7KQ2MZ", null, "admin:staff@example.com");
  });

  it("refuses something that is not a phone number, and says why", async () => {
    const res = await put(tokenFor("admin"), { phone: "call me" });
    expect(res.statusCode).toBe(400);
    expect(String(answer(res).error)).toMatch(/phone number/i);
    expect(m.setBookingPhone).not.toHaveBeenCalled();
  });

  it("refuses a body with anything else in it", async () => {
    expect((await put(tokenFor("admin"), { phone: "07700 900123", status: "paid" })).statusCode).toBe(400);
    expect(m.setBookingPhone).not.toHaveBeenCalled();
  });

  it("says when there is no such booking", async () => {
    m.setBookingPhone.mockResolvedValue({ ok: false });
    const res = await put(tokenFor("admin"), { phone: "07700 900123" }, "BALL-ZZZZZZ");
    expect(res.statusCode).toBe(404);
  });
});

describe("GET /api/admin/ball/bookings", () => {
  it("says how many paid bookings have no phone number", async () => {
    const res = mockRes();
    await getAdminBallBookings({ headers: { authorization: `Bearer ${tokenFor("viewer")}` }, query: {}, params: {} } as never, res as never);
    expect(res.statusCode).toBe(200);
    expect(answer(res).noPhone).toBe(4);
  });
});
