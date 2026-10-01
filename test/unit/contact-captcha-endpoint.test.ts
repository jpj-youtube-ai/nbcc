import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-490: POST /api/contact with the Cloudflare Turnstile check. The order is honeypot, rate
// limit, the check, validation, store. A refused pass stores nothing; a check that cannot answer
// keeps the message and logs why. The Turnstile client, the contact DB, Stripe and config are
// mocked, so no network or env is touched. Each test posts from its own IP, because the rate
// limiter is shared across the file.

const { insertEnquiry, verifyCaptcha, captchaEnabled, captchaSiteKey } = vi.hoisted(() => ({
  insertEnquiry: vi.fn(),
  verifyCaptcha: vi.fn(),
  captchaEnabled: vi.fn(),
  captchaSiteKey: vi.fn(),
}));

vi.mock("../../src/db/contact", () => ({ insertEnquiry }));
vi.mock("../../src/clients/turnstile", () => ({ verifyCaptcha, captchaEnabled, captchaSiteKey }));
vi.mock("../../src/clients/stripe", () => ({
  stripe: { checkout: { sessions: { create: vi.fn() } } },
  stripePriceByPlan: {},
}));
vi.mock("../../src/config", () => ({
  config: { STRIPE_SUCCESS_URL: "https://nbcc.test/s", STRIPE_CANCEL_URL: "https://nbcc.test/c" },
}));

import { postContact, getContactCaptcha } from "../../src/routes/api";

type MockRes = { statusCode: number; body: unknown; status: (c: number) => MockRes; json: (b: unknown) => MockRes };
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

let nextIp = 0;
const freshIp = () => `198.51.100.${++nextIp}`;
const run = async (body: unknown, ip = freshIp()): Promise<MockRes> => {
  const res = mockRes();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await postContact({ body, ip } as any, res as any);
  return res;
};

const VALID = { firstName: "Ada", lastName: "Lovelace", email: "ada@example.com", message: "Happy to help at Christmas." };

beforeEach(() => {
  insertEnquiry.mockReset();
  insertEnquiry.mockResolvedValue({ id: 1 });
  verifyCaptcha.mockReset();
  captchaEnabled.mockReset();
  captchaEnabled.mockReturnValue(true);
  captchaSiteKey.mockReset();
});

describe("POST /api/contact with the spam check on", () => {
  it("bins a filled honeypot before Cloudflare is ever asked", async () => {
    const res = await run({ ...VALID, company: "Spam Ltd", captchaToken: "tok" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ status: "sent" });
    expect(verifyCaptcha).not.toHaveBeenCalled();
    expect(insertEnquiry).not.toHaveBeenCalled();
  });

  it("applies the rate limit before Cloudflare is asked", async () => {
    verifyCaptcha.mockResolvedValue({ outcome: "passed" });
    const ip = freshIp();
    for (let i = 0; i < 5; i++) expect((await run({ ...VALID, captchaToken: "tok" }, ip)).statusCode).toBe(200);
    const sixth = await run({ ...VALID, captchaToken: "tok" }, ip);
    expect(sixth.statusCode).toBe(429);
    expect(verifyCaptcha).toHaveBeenCalledTimes(5);
  });

  it("stores a message whose pass is genuine, without the pass", async () => {
    verifyCaptcha.mockResolvedValue({ outcome: "passed" });
    const ip = freshIp();
    const res = await run({ ...VALID, captchaToken: "tok-1" }, ip);
    expect(res.statusCode).toBe(200);
    expect(verifyCaptcha).toHaveBeenCalledWith("tok-1", ip);
    expect(insertEnquiry).toHaveBeenCalledOnce();
    expect(insertEnquiry.mock.calls[0][0]).toEqual(expect.objectContaining(VALID));
    expect(insertEnquiry.mock.calls[0][0]).not.toHaveProperty("captchaToken");
  });

  it("refuses a message whose pass is refused, and stores nothing", async () => {
    verifyCaptcha.mockResolvedValue({ outcome: "refused", reason: "invalid-input-response" });
    const res = await run({ ...VALID, captchaToken: "forged" });
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: "captcha" });
    expect(insertEnquiry).not.toHaveBeenCalled();
  });

  it("checks the pass before validation, so a bot without one learns nothing about the form", async () => {
    verifyCaptcha.mockResolvedValue({ outcome: "refused", reason: "missing-input-response" });
    const res = await run({ firstName: "" });
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: "captcha" });
  });

  it("keeps the message, and logs why, when the check cannot answer", async () => {
    verifyCaptcha.mockResolvedValue({ outcome: "unavailable", reason: "timeout" });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await run({ ...VALID, captchaToken: "tok" });
    expect(res.statusCode).toBe(200);
    expect(insertEnquiry).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith("contact captcha unavailable, message kept:", "timeout");
    log.mockRestore();
  });
});

describe("POST /api/contact with the spam check off", () => {
  it("behaves exactly as before: no call to Cloudflare, the message stored", async () => {
    captchaEnabled.mockReturnValue(false);
    const res = await run(VALID);
    expect(res.statusCode).toBe(200);
    expect(verifyCaptcha).not.toHaveBeenCalled();
    expect(insertEnquiry).toHaveBeenCalledOnce();
  });
});

describe("GET /api/contact/captcha", () => {
  it("tells the page the site key when the check is on", () => {
    captchaSiteKey.mockReturnValue("0x4AAAAAAFLWXsnTJas6eb4L");
    const res = mockRes();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getContactCaptcha({} as any, res as any);
    expect(res.body).toEqual({ siteKey: "0x4AAAAAAFLWXsnTJas6eb4L" });
  });

  it("tells the page null when it is off", () => {
    captchaSiteKey.mockReturnValue(null);
    const res = mockRes();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getContactCaptcha({} as any, res as any);
    expect(res.body).toEqual({ siteKey: null });
  });
});
