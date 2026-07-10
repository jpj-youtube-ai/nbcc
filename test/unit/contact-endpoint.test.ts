import { describe, it, expect, vi, beforeEach } from "vitest";

// Contact inbox (2026-07-10 spec, Task 5): POST /api/contact validates a website enquiry
// { firstName, lastName, email, message } and STORES it in the isolated contact DB via
// insertEnquiry (src/db/contact.ts) — no external forward. A honeypot (`company`) filled by a
// bot is silently accepted (200) but never stored. A per-IP rate limit returns 429. Bad/missing
// required fields are rejected with 400; a DB failure returns 500. DB-free: src/db/contact,
// the Stripe client and config are mocked, so no SDK/network/env is touched. Mirrors
// test/unit/checkout-session.test.ts.

const { insertEnquiry } = vi.hoisted(() => ({ insertEnquiry: vi.fn() }));

vi.mock("../../src/db/contact", () => ({ insertEnquiry }));

// api.ts also imports the Stripe client + config at module load; mock both so the
// real config (which would validate process.env and exit) is never loaded.
vi.mock("../../src/clients/stripe", () => ({
  stripe: { checkout: { sessions: { create: vi.fn() } } },
  stripePriceByPlan: {},
}));
vi.mock("../../src/config", () => ({
  config: { STRIPE_SUCCESS_URL: "https://nbcc.test/s", STRIPE_CANCEL_URL: "https://nbcc.test/c" },
}));

import { postContact } from "../../src/routes/api";

type MockRes = {
  statusCode: number;
  body: unknown;
  status: (c: number) => MockRes;
  json: (b: unknown) => MockRes;
};

function mockRes(): MockRes {
  const res = { statusCode: 200, body: undefined as unknown } as MockRes;
  res.status = (c: number) => {
    res.statusCode = c;
    return res;
  };
  res.json = (b: unknown) => {
    res.body = b;
    return res;
  };
  return res;
}

const run = async (body: unknown, ip = "1.1.1.1"): Promise<MockRes> => {
  const res = mockRes();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await postContact({ body, ip } as any, res as any);
  return res;
};

const VALID = {
  firstName: "Ada",
  lastName: "Lovelace",
  email: "ada@example.com",
  message: "Happy to help at Christmas.",
};

beforeEach(() => {
  insertEnquiry.mockReset();
  insertEnquiry.mockResolvedValue({ id: 1 });
});

describe("POST /api/contact — valid enquiry stores it (2026-07-10 contact-inbox)", () => {
  it("stores the enquiry and returns a success status", async () => {
    const res = await run(VALID, "9.9.9.1");
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ status: "sent" });
    expect(insertEnquiry).toHaveBeenCalledOnce();
    expect(insertEnquiry).toHaveBeenCalledWith(expect.objectContaining(VALID));
  });

  it("accepts a missing/empty last name (optional field)", async () => {
    const res = await run(
      {
        firstName: VALID.firstName,
        email: VALID.email,
        message: VALID.message,
      },
      "9.9.9.2",
    );
    expect(res.statusCode).toBe(200);
    expect(insertEnquiry).toHaveBeenCalledOnce();
  });
});

describe("POST /api/contact — invalid bodies return 400", () => {
  it.each([
    ["a missing first name", { ...VALID, firstName: "" }],
    ["a missing message", { ...VALID, message: "" }],
    ["a malformed email", { ...VALID, email: "not-an-email" }],
    ["a missing email", { firstName: "Ada", lastName: "L", message: "Hi" }],
    ["an empty body", {}],
  ])("rejects %s and never stores", async (_label, body) => {
    const res = await run(body, "9.9.9.3");
    expect(res.statusCode).toBe(400);
    expect(insertEnquiry).not.toHaveBeenCalled();
  });
});

describe("POST /api/contact — honeypot", () => {
  it("silently accepts a filled honeypot with 200 and never stores", async () => {
    const res = await run({ ...VALID, company: "spam co" }, "9.9.9.4");
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ status: "sent" });
    expect(insertEnquiry).not.toHaveBeenCalled();
  });
});

describe("POST /api/contact — rate limit", () => {
  it("returns 429 after exceeding the per-IP limit", async () => {
    const ip = "9.9.9.5";
    for (let i = 0; i < 5; i++) {
      const ok = await run(VALID, ip);
      expect(ok.statusCode).toBe(200);
    }
    const limited = await run(VALID, ip);
    expect(limited.statusCode).toBe(429);
  });
});

describe("POST /api/contact — store failure", () => {
  it("returns 500 when the store fails", async () => {
    insertEnquiry.mockRejectedValueOnce(new Error("db down"));
    const res = await run(VALID, "9.9.9.6");
    expect(res.statusCode).toBe(500);
  });
});
