import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-039 (REQ-030): POST /api/contact validates a website enquiry
// { firstName, lastName, email, message } and forwards it to the configured form
// service via src/clients/contact, returning success. Bad/missing required fields
// are rejected with 400; an upstream forwarding failure returns 502 (the
// front-end then degrades to its mailto fallback, REQ-027). DB-free: the contact
// client, the Stripe client and config are mocked, so no SDK/network/env is
// touched. Mirrors test/unit/checkout-session.test.ts.

const { forwardEnquiry } = vi.hoisted(() => ({ forwardEnquiry: vi.fn() }));

vi.mock("../../src/clients/contact", () => ({ forwardEnquiry }));

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

const run = async (body: unknown): Promise<MockRes> => {
  const res = mockRes();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await postContact({ body } as any, res as any);
  return res;
};

const VALID = {
  firstName: "Ada",
  lastName: "Lovelace",
  email: "ada@example.com",
  message: "Happy to help at Christmas.",
};

beforeEach(() => {
  forwardEnquiry.mockReset();
  forwardEnquiry.mockResolvedValue(undefined);
});

describe("POST /api/contact — valid enquiry (REQ-030)", () => {
  it("forwards the enquiry and returns a success status", async () => {
    const res = await run(VALID);
    expect(res.statusCode).toBe(200);
    expect(forwardEnquiry).toHaveBeenCalledOnce();
    expect(forwardEnquiry).toHaveBeenCalledWith(expect.objectContaining(VALID));
  });

  it("accepts a missing/empty last name (optional field)", async () => {
    const res = await run({
      firstName: VALID.firstName,
      email: VALID.email,
      message: VALID.message,
    });
    expect(res.statusCode).toBe(200);
    expect(forwardEnquiry).toHaveBeenCalledOnce();
  });
});

describe("POST /api/contact — invalid bodies return 400", () => {
  it.each([
    ["a missing first name", { ...VALID, firstName: "" }],
    ["a missing message", { ...VALID, message: "" }],
    ["a malformed email", { ...VALID, email: "not-an-email" }],
    ["a missing email", { firstName: "Ada", lastName: "L", message: "Hi" }],
    ["an empty body", {}],
  ])("rejects %s and never forwards", async (_label, body) => {
    const res = await run(body);
    expect(res.statusCode).toBe(400);
    expect(forwardEnquiry).not.toHaveBeenCalled();
  });
});

describe("POST /api/contact — upstream failure", () => {
  it("returns 502 when forwarding throws", async () => {
    forwardEnquiry.mockRejectedValueOnce(new Error("form service down"));
    const res = await run(VALID);
    expect(res.statusCode).toBe(502);
  });
});
