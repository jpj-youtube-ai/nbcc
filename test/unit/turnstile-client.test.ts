import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-490: asking Cloudflare whether a pass from the contact form's box is genuine. Every verdict,
// with fetch injected, so no network is touched. The config is mocked: the real one would validate
// process.env and exit.

const { mockConfig } = vi.hoisted(() => ({
  mockConfig: { TURNSTILE_SITE_KEY: "site", TURNSTILE_SECRET_KEY: "secret" } as Record<string, string>,
}));
vi.mock("../../src/config", () => ({ config: mockConfig }));

import { verifyCaptcha, captchaEnabled, captchaSiteKey, SITEVERIFY_URL } from "../../src/clients/turnstile";

const reply = (body: unknown, init: { ok?: boolean; status?: number } = {}) =>
  vi.fn().mockResolvedValue({ ok: init.ok ?? true, status: init.status ?? 200, json: async () => body });

beforeEach(() => {
  mockConfig.TURNSTILE_SITE_KEY = "site";
  mockConfig.TURNSTILE_SECRET_KEY = "secret";
});

describe("asking Cloudflare about a pass", () => {
  it("sends the secret, the pass and the visitor's IP to siteverify, and passes a success", async () => {
    const fetchImpl = reply({ success: true, "error-codes": [] });
    expect(await verifyCaptcha("tok", "203.0.113.9", fetchImpl)).toEqual({ outcome: "passed" });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(SITEVERIFY_URL);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ secret: "secret", response: "tok", remoteip: "203.0.113.9" });
  });

  it("leaves out the IP when there is none", async () => {
    const fetchImpl = reply({ success: true });
    await verifyCaptcha("tok", undefined, fetchImpl);
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ secret: "secret", response: "tok" });
  });

  it.each(["invalid-input-response", "timeout-or-duplicate", "missing-input-response"])(
    "refuses the visitor's pass for %s",
    async (code) => {
      expect(await verifyCaptcha("tok", undefined, reply({ success: false, "error-codes": [code] }))).toEqual({
        outcome: "refused",
        reason: code,
      });
    },
  );

  // Cloudflare sends these with HTTP 400 (checked against the live siteverify: a REPLACE_ME secret gets
  // a 400 naming invalid-input-secret), so the reason must be read from the body whatever the status.
  it.each([
    ["missing-input-secret", 400],
    ["invalid-input-secret", 400],
    ["bad-request", 400],
    ["internal-error", 500],
    ["internal-error", 200],
  ])("calls the check unavailable, naming the reason, rather than blaming the visitor, for %s (HTTP %i)", async (code, status) => {
    const fetchImpl = reply({ success: false, "error-codes": [code] }, { ok: status < 300, status });
    expect(await verifyCaptcha("tok", undefined, fetchImpl)).toEqual({ outcome: "unavailable", reason: code });
  });

  it("still refuses the visitor's pass when Cloudflare names it with an error status", async () => {
    const fetchImpl = reply({ success: false, "error-codes": ["invalid-input-response"] }, { ok: false, status: 400 });
    expect(await verifyCaptcha("tok", undefined, fetchImpl)).toEqual({ outcome: "refused", reason: "invalid-input-response" });
  });

  it("keeps the message when the visitor's reason comes with one of ours", async () => {
    const fetchImpl = reply({ success: false, "error-codes": ["invalid-input-response", "internal-error"] });
    expect(await verifyCaptcha("tok", undefined, fetchImpl)).toEqual({
      outcome: "unavailable",
      reason: "invalid-input-response, internal-error",
    });
  });

  it("never passes a success that comes with an error status", async () => {
    expect(await verifyCaptcha("tok", undefined, reply({ success: true }, { ok: false, status: 500 }))).toEqual({
      outcome: "unavailable",
      reason: "Cloudflare replied 500",
    });
  });

  it("names the status when an error reply cannot be read", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 502, json: async () => { throw new SyntaxError("html"); } });
    expect(await verifyCaptcha("tok", undefined, fetchImpl)).toEqual({ outcome: "unavailable", reason: "Cloudflare replied 502" });
  });

  it("refuses a failure that gives no reason", async () => {
    expect(await verifyCaptcha("tok", undefined, reply({ success: false }))).toEqual({
      outcome: "refused",
      reason: "no reason given",
    });
  });

  it("refuses a missing or blank pass without asking Cloudflare", async () => {
    const fetchImpl = reply({ success: true });
    expect(await verifyCaptcha(undefined, undefined, fetchImpl)).toEqual({ outcome: "refused", reason: "missing-input-response" });
    expect(await verifyCaptcha("   ", undefined, fetchImpl)).toEqual({ outcome: "refused", reason: "missing-input-response" });
    expect(await verifyCaptcha(42, undefined, fetchImpl)).toEqual({ outcome: "refused", reason: "missing-input-response" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([[""], [["tok"]], [{ token: "tok" }], [null]])("refuses %j as a pass without asking Cloudflare", async (token) => {
    const fetchImpl = reply({ success: true });
    expect(await verifyCaptcha(token, undefined, fetchImpl)).toEqual({ outcome: "refused", reason: "missing-input-response" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("gives up on Cloudflare after five seconds", async () => {
    const fetchImpl = reply({ success: true });
    await verifyCaptcha("tok", undefined, fetchImpl);
    expect(fetchImpl.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it("refuses a pass longer than Cloudflare ever issues, without asking", async () => {
    const fetchImpl = reply({ success: true });
    expect(await verifyCaptcha("x".repeat(2049), undefined, fetchImpl)).toEqual({
      outcome: "refused",
      reason: "invalid-input-response",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("is unavailable when Cloudflare cannot be reached", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    expect(await verifyCaptcha("tok", undefined, fetchImpl)).toEqual({ outcome: "unavailable", reason: "network error" });
  });

  it("is unavailable when Cloudflare does not answer in time", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new DOMException("timed out", "TimeoutError"));
    expect(await verifyCaptcha("tok", undefined, fetchImpl)).toEqual({ outcome: "unavailable", reason: "timeout" });
    const aborted = vi.fn().mockRejectedValue(new DOMException("aborted", "AbortError"));
    expect(await verifyCaptcha("tok", undefined, aborted)).toEqual({ outcome: "unavailable", reason: "timeout" });
  });

  it("is unavailable when Cloudflare replies with an error status", async () => {
    expect(await verifyCaptcha("tok", undefined, reply({}, { ok: false, status: 503 }))).toEqual({
      outcome: "unavailable",
      reason: "Cloudflare replied 503",
    });
  });

  it("is unavailable when the reply cannot be read", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => { throw new SyntaxError("bad json"); } });
    expect(await verifyCaptcha("tok", undefined, fetchImpl)).toEqual({ outcome: "unavailable", reason: "unreadable reply" });
  });
});

describe("whether the check is on", () => {
  it("is on, with the site key for the page, only when both keys are set", () => {
    expect(captchaEnabled()).toBe(true);
    expect(captchaSiteKey()).toBe("site");
    mockConfig.TURNSTILE_SECRET_KEY = "";
    expect(captchaEnabled()).toBe(false);
    expect(captchaSiteKey()).toBeNull();
    mockConfig.TURNSTILE_SECRET_KEY = "secret";
    mockConfig.TURNSTILE_SITE_KEY = "";
    expect(captchaEnabled()).toBe(false);
    expect(captchaSiteKey()).toBeNull();
  });

  it("treats keys a mocked or older config does not have as off", () => {
    delete mockConfig.TURNSTILE_SITE_KEY;
    delete mockConfig.TURNSTILE_SECRET_KEY;
    expect(captchaEnabled()).toBe(false);
  });
});
