# Contact form spam check (Cloudflare Turnstile) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop bot spam reaching Admin → Contact form by checking a Cloudflare Turnstile pass on `POST /api/contact`, as specified in `docs/superpowers/specs/2026-09-30-contact-form-captcha-design.md`.

**Architecture:** A small client (`src/clients/turnstile.ts`) asks Cloudflare's siteverify about a pass and answers `passed`, `refused` or `unavailable`. `postContact` calls it between the rate limit and validation when both keys are configured. A refused pass stores nothing; an unavailable check keeps the message and logs why. The contact page alone loads `assets/js/contact-captcha.js`, which asks `GET /api/contact/captcha` for the site key, then loads Cloudflare's script and draws the box. The pass travels in a hidden `captchaToken` field that `main.js` already sends. It is a separate file because `main.js` and `styles.css` count towards `donate.html`'s page-weight budget, which has about **530 bytes** left as CI measures it (TASK-479 raised it to 262KB and added pulse.js).

**Tech Stack:** Express + TypeScript, zod config, Vitest (node and jsdom), classic browser JS with a CommonJS test guard, Terraform (SSM + ECS task definition), headless Chrome over the DevTools protocol for the browser check.

**Conventions for whoever runs this plan:**
- Work only in the worktree `C:/Users/jomcfarl/Downloads/nbcc-scot/nbcc/.claude/worktrees/contact-captcha` (branch `contact-form-captcha`). Other sessions use the main checkout and other worktrees.
- `TASK-NNN` in new comments is a stand-in for the task number. It is claimed at PR time (Task 11) and replaced then, never earlier, because other sessions claim numbers too.
- Test command: `npx vitest run <files>`. On this Windows machine `test/unit/perf-budget.test.ts` always fails because of CRLF line endings; that is a known artifact (Task 10 measures the real budget).
- No local database exists. Never start the real server; use the unit tests and the stand-in in Task 10.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/config/schema.ts` | Modify | `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` (default `""`), and `productionConfigProblems()` |
| `src/config/index.ts` | Modify | Refuse to start production when `productionConfigProblems()` reports anything |
| `.env.example` | Modify | Document both keys and Cloudflare's test keys |
| `src/clients/turnstile.ts` | Create | `captchaEnabled()`, `captchaSiteKey()`, `verifyCaptcha()`: the only code that knows Cloudflare's error codes |
| `src/routes/api.ts` | Modify | The check inside `postContact`; `GET /api/contact/captcha` |
| `contact.html` | Modify | Box container, hidden `captchaToken` field, `<noscript>` note, `contact-captcha.js` script tag |
| `assets/js/main.js` | Modify | One payload line: send `captchaToken` |
| `assets/js/contact-captcha.js` | Create | Ask for the site key, load Cloudflare's script, draw the box, hold Send without a pass, reset after each send |
| `infra/modules/app/variables.tf` | Modify | `turnstile_site_key` |
| `infra/modules/app/main.tf` | Modify | SSM SecureString `TURNSTILE_SECRET_KEY` (`REPLACE_ME`, `ignore_changes`) |
| `infra/modules/app/ecs.tf` | Modify | Task-def `environment` + `secrets` entries; `exec_secrets` IAM ARN |
| `infra/envs/production/main.tf` | Modify | The real (public) site key |
| `privacy.html` | Modify | Turnstile paragraph under "Sharing your data" |
| `README.md` | Modify | Paragraph in the contact inbox section |
| `test/unit/config-turnstile.test.ts` | Create | Config keys and the production rule |
| `test/unit/turnstile-client.test.ts` | Create | Every verdict, no network |
| `test/unit/contact-captcha-endpoint.test.ts` | Create | The route's order and outcomes, and the site-key endpoint |
| `test/unit/contact-captcha.test.ts` | Create | `contact-captcha.js` in jsdom, alone and with `main.js` |
| `test/unit/contact.test.ts` | Modify | The page markup, and `main.js` sending the hidden field |
| `test/unit/privacy-turnstile.test.ts` | Create | The privacy paragraph |

---

### Task 1: Config keys and the production rule

**Files:**
- Modify: `src/config/schema.ts` (add two keys inside `configSchema`; add a function after `export type Config`)
- Modify: `src/config/index.ts`
- Modify: `.env.example` (after the `STRIPE_PUBLISHABLE_KEY=` line)
- Test: `test/unit/config-turnstile.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/unit/config-turnstile.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { configSchema, productionConfigProblems } from "../../src/config/schema";

// TASK-NNN: the contact form's Cloudflare Turnstile keys. Off (empty) by default so local dev and
// CI boot with no call to Cloudflare; required in production, so the check can never silently
// switch itself off there.

const base = {
  DATABASE_URL: "postgres://app:app@localhost:5432/charity",
  STORIES_DATABASE_URL: "postgres://stories_app:stories@localhost:5432/stories",
  CONTACT_DATABASE_URL: "postgres://contact_app:contact@localhost:5432/contact",
  EXTERNAL_API_ONE_BASE_URL: "https://api.example/one",
  EXTERNAL_API_ONE_KEY: "k1",
  EXTERNAL_API_TWO_KEY: "k2",
  STRIPE_SECRET_KEY: "sk",
  STRIPE_PUBLISHABLE_KEY: "pk",
  STRIPE_SUCCESS_URL: "https://x.example/s",
  STRIPE_CANCEL_URL: "https://x.example/c",
  STRIPE_PRICE_BRONZE: "p",
  STRIPE_PRICE_SILVER: "p",
  STRIPE_PRICE_GOLD: "p",
  STRIPE_PRICE_PLATINUM: "p",
  STRIPE_WEBHOOK_SECRET: "whsec",
  DECLARATION_FORM_BASE_URL: "https://x.example/d",
  ADMIN_NOTIFICATION_EMAIL: "ops@nbcc.scot",
  PORTAL_BASE_URL: "https://x.example",
  BALL_BASE_URL: "https://x.example",
  BALL_PREVIEW_PASSWORD: "preview-pw",
  ADMIN_SESSION_SECRET: "s",
};

describe("Turnstile keys in config", () => {
  it("default to empty, so local dev and CI boot with the check off", () => {
    const c = configSchema.parse(base);
    expect(c.TURNSTILE_SITE_KEY).toBe("");
    expect(c.TURNSTILE_SECRET_KEY).toBe("");
    expect(productionConfigProblems(c)).toEqual([]);
  });

  it("are both required in production, so the check can never silently be off there", () => {
    const c = configSchema.parse({ ...base, NODE_ENV: "production" });
    expect(productionConfigProblems(c)).toEqual([
      "TURNSTILE_SITE_KEY is required in production",
      "TURNSTILE_SECRET_KEY is required in production",
    ]);
  });

  it("satisfy production once both are set, even while the secret is still REPLACE_ME", () => {
    const c = configSchema.parse({
      ...base,
      NODE_ENV: "production",
      TURNSTILE_SITE_KEY: "0x4AAAAAAFLWXsnTJas6eb4L",
      TURNSTILE_SECRET_KEY: "REPLACE_ME",
    });
    expect(productionConfigProblems(c)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run test/unit/config-turnstile.test.ts`
Expected: FAIL, `productionConfigProblems is not a function` (or the keys are `undefined`).

- [ ] **Step 3: Add the keys and the function**

In `src/config/schema.ts`, directly after the line `STRIPE_PUBLISHABLE_KEY: z.string().optional(),`, add:

```ts

  // Cloudflare Turnstile on the contact form (TASK-NNN). The SITE key is public: the browser draws
  // the box with it, so it is a plain task-def env value like STRIPE_PUBLISHABLE_KEY. The SECRET is
  // an SSM SecureString. The check is on only when BOTH are set: a secret without a site key would
  // refuse every message, because the page could not show the box. Empty outside production, so
  // local dev and CI boot with the check off; productionConfigProblems refuses a production without
  // them.
  TURNSTILE_SITE_KEY: z.string().default(""),
  TURNSTILE_SECRET_KEY: z.string().default(""),
```

At the end of `src/config/schema.ts`, after `export type Config = z.infer<typeof configSchema>;`, add:

```ts

// Rules that only hold in production, applied by src/config/index.ts after parsing. Kept out of
// configSchema itself so the schema stays a plain z.object that tests can parse and extend.
export function productionConfigProblems(c: Config): string[] {
  if (c.NODE_ENV !== "production") return [];
  const problems: string[] = [];
  // TASK-NNN: without both keys the contact form's spam check would silently be off.
  if (!c.TURNSTILE_SITE_KEY) problems.push("TURNSTILE_SITE_KEY is required in production");
  if (!c.TURNSTILE_SECRET_KEY) problems.push("TURNSTILE_SECRET_KEY is required in production");
  return problems;
}
```

Replace the whole of `src/config/index.ts` with:

```ts
import { configSchema, productionConfigProblems } from "./schema";

const parsed = configSchema.safeParse(process.env);

if (!parsed.success) {
  // Fail fast: a missing SSM parameter (or a typo'd key) stops the container
  // from booting, so you find it at deploy time via the health check -
  // not on the first user request in production.
  console.error(
    "Invalid environment configuration:",
    parsed.error.flatten().fieldErrors,
  );
  process.exit(1);
}

// The same fail-fast for rules that only apply in production (see productionConfigProblems).
const productionProblems = productionConfigProblems(parsed.data);
if (productionProblems.length > 0) {
  console.error("Invalid environment configuration:", productionProblems);
  process.exit(1);
}

export const config = parsed.data;
```

In `.env.example`, directly after the line `STRIPE_PUBLISHABLE_KEY=`, add:

```
# Cloudflare Turnstile on the contact form (TASK-NNN). OPTIONAL locally: leave BOTH blank and the
# check is off (no box on the page, no call to Cloudflare). To try it, use Cloudflare's test keys:
# site key 1x00000000000000000000AA with secret 1x0000000000000000000000000000000AA always pass;
# site key 2x00000000000000000000AB always blocks. Production requires both: the site key is a
# plain task-def env value, the secret an SSM SecureString.
TURNSTILE_SITE_KEY=
TURNSTILE_SECRET_KEY=
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/unit/config-turnstile.test.ts test/unit/config.test.ts test/unit/config-contact-url.test.ts test/unit/stripe-config.test.ts`
Expected: PASS, all files.

- [ ] **Step 5: Commit**

```bash
git add src/config/schema.ts src/config/index.ts .env.example test/unit/config-turnstile.test.ts
git commit -m "Captcha: the Turnstile keys, required in production"
```

---

### Task 2: The Turnstile client

**Files:**
- Create: `src/clients/turnstile.ts`
- Test: `test/unit/turnstile-client.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/unit/turnstile-client.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-NNN: asking Cloudflare whether a pass from the contact form's box is genuine. Every verdict,
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

  it.each(["missing-input-secret", "invalid-input-secret", "bad-request", "internal-error"])(
    "calls the check unavailable, rather than blaming the visitor, for %s",
    async (code) => {
      expect(await verifyCaptcha("tok", undefined, reply({ success: false, "error-codes": [code] }))).toEqual({
        outcome: "unavailable",
        reason: code,
      });
    },
  );

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
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run test/unit/turnstile-client.test.ts`
Expected: FAIL, cannot resolve `../../src/clients/turnstile`.

- [ ] **Step 3: Write the client**

Create `src/clients/turnstile.ts`:

```ts
import { config } from "../config";

// Cloudflare Turnstile (TASK-NNN): is a pass from the contact form's box genuine? This is the only
// code that knows Cloudflare's error codes, so its callers see one of three answers:
//   passed      - carry on
//   refused     - the visitor's pass is missing, invalid, expired or already used: store nothing
//   unavailable - the check itself could not answer (network, timeout, Cloudflare's own error, or
//                 our secret rejected): the caller keeps the message and logs the reason, so a
//                 genuine enquiry is never lost because the checker had a bad moment.
export type CaptchaVerdict =
  | { outcome: "passed" }
  | { outcome: "refused"; reason: string }
  | { outcome: "unavailable"; reason: string };

export const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TIMEOUT_MS = 5000;
// Cloudflare's passes are at most 2048 characters; anything longer is not one of theirs.
const MAX_TOKEN_LENGTH = 2048;
// Error codes about OUR request or Cloudflare itself, never about the visitor's pass.
const NOT_THE_VISITORS = new Set(["missing-input-secret", "invalid-input-secret", "bad-request", "internal-error"]);

// On only when BOTH keys are set: a secret without a site key would refuse every message, because
// the page could not show the box (see src/config/schema.ts). Boolean() so a config without the
// keys at all (a test's mock) reads as off.
export function captchaEnabled(): boolean {
  return Boolean(config.TURNSTILE_SITE_KEY) && Boolean(config.TURNSTILE_SECRET_KEY);
}

// What GET /api/contact/captcha tells the page: the site key when the check is on, else null.
export function captchaSiteKey(): string | null {
  return captchaEnabled() ? config.TURNSTILE_SITE_KEY : null;
}

export async function verifyCaptcha(
  token: unknown,
  remoteIp: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<CaptchaVerdict> {
  // A missing or oversized pass is refused here, without asking Cloudflare.
  if (typeof token !== "string" || token.trim() === "") return { outcome: "refused", reason: "missing-input-response" };
  if (token.length > MAX_TOKEN_LENGTH) return { outcome: "refused", reason: "invalid-input-response" };

  let res: Response;
  try {
    res = await fetchImpl(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secret: config.TURNSTILE_SECRET_KEY,
        response: token,
        ...(remoteIp ? { remoteip: remoteIp } : {}),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const name = typeof err === "object" && err !== null && "name" in err ? String(err.name) : "";
    return { outcome: "unavailable", reason: name === "TimeoutError" || name === "AbortError" ? "timeout" : "network error" };
  }
  if (!res.ok) return { outcome: "unavailable", reason: `Cloudflare replied ${res.status}` };

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { outcome: "unavailable", reason: "unreadable reply" };
  }
  if (!body || typeof body !== "object") return { outcome: "unavailable", reason: "unreadable reply" };
  const result = body as { success?: unknown; "error-codes"?: unknown };
  if (result.success === true) return { outcome: "passed" };

  const codes = Array.isArray(result["error-codes"]) ? result["error-codes"].map(String) : [];
  if (codes.some((code) => NOT_THE_VISITORS.has(code))) return { outcome: "unavailable", reason: codes.join(", ") };
  return { outcome: "refused", reason: codes.join(", ") || "no reason given" };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/unit/turnstile-client.test.ts`
Expected: PASS (18 tests).

- [ ] **Step 5: Commit**

```bash
git add src/clients/turnstile.ts test/unit/turnstile-client.test.ts
git commit -m "Captcha: a client that sorts Cloudflare's answers into three"
```

---

### Task 3: The check in the route, and the site-key endpoint

**Files:**
- Modify: `src/routes/api.ts` (imports; inside `postContact` after the rate limit; a new handler and route after the `/api/contact` route)
- Test: `test/unit/contact-captcha-endpoint.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/unit/contact-captcha-endpoint.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-NNN: POST /api/contact with the Cloudflare Turnstile check. The order is honeypot, rate
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
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run test/unit/contact-captcha-endpoint.test.ts`
Expected: FAIL. `getContactCaptcha` is not exported, and the honeypot/order tests fail because `verifyCaptcha` is never called.

- [ ] **Step 3: Add the check and the endpoint**

In `src/routes/api.ts`, after the line `import { createRateLimiter } from "../portal/request-limiter";`, add:

```ts
import { captchaEnabled, captchaSiteKey, verifyCaptcha } from "../clients/turnstile";
```

Inside `postContact`, directly after the rate-limit block (the `if (!contactLimiter.allow(...)) { ... }` that returns 429) and before `const parsed = contactEnquirySchema.safeParse(req.body);`, add:

```ts
  // TASK-NNN: Cloudflare Turnstile, when it is on. Before validation, so a bot without a valid pass
  // learns nothing about what the form expects. A refused pass stores nothing; a check that cannot
  // answer keeps the message and logs why, so a genuine enquiry is never lost to the checker.
  if (captchaEnabled()) {
    const verdict = await verifyCaptcha(req.body?.captchaToken, req.ip);
    if (verdict.outcome === "refused") {
      return res.status(400).json({ error: "captcha" });
    }
    if (verdict.outcome === "unavailable") {
      console.error("contact captcha unavailable, message kept:", verdict.reason);
    }
  }
```

Directly after the existing route registration

```ts
apiRouter.post(
  "/api/contact",
  express.urlencoded({ extended: false, limit: "16kb" }),
  postContact,
);
```

add:

```ts

// TASK-NNN: the contact page asks for the Turnstile site key and shows the box only if it gets one
// (assets/js/contact-captcha.js). Public: the site key is in every visitor's browser anyway.
export function getContactCaptcha(_req: Request, res: Response): Response {
  return res.status(200).json({ siteKey: captchaSiteKey() });
}

apiRouter.get("/api/contact/captcha", getContactCaptcha);
```

- [ ] **Step 4: Run the tests, new and existing**

Run: `npx vitest run test/unit/contact-captcha-endpoint.test.ts test/unit/contact-endpoint.test.ts`
Expected: PASS, both files. The existing file needs no change: its config mock has no Turnstile keys, so `captchaEnabled()` is false there.

- [ ] **Step 5: Commit**

```bash
git add src/routes/api.ts test/unit/contact-captcha-endpoint.test.ts
git commit -m "Captcha: check the pass in POST /api/contact, and tell the page the site key"
```

---

### Task 4: The page's markup

**Files:**
- Modify: `contact.html` (the `<head>` script tags; inside `<form id="contactForm">` before the submit button)
- Test: `test/unit/contact.test.ts` (append a `describe` at the end of the file)

- [ ] **Step 1: Write the failing test**

Append to `test/unit/contact.test.ts`:

```ts

// TASK-NNN: Cloudflare Turnstile's box, drawn by assets/js/contact-captcha.js only when the server
// says the check is on. Nothing is loaded from Cloudflare by the page itself.
describe("the contact form's spam check (TASK-NNN)", () => {
  const form = doc.getElementById("contactForm");

  it("has a place for the box above Send, hidden until it is drawn", () => {
    const box = doc.getElementById("contactCaptcha");
    const send = form?.querySelector('button[type="submit"]');
    expect(box?.closest("form")).toBe(form);
    expect(box?.hasAttribute("hidden")).toBe(true);
    expect(box && send ? box.compareDocumentPosition(send) & Node.DOCUMENT_POSITION_FOLLOWING : 0).toBeTruthy();
  });

  it("carries the pass in a hidden field that main.js sends", () => {
    const field = form?.querySelector("#captchaToken");
    expect(field?.getAttribute("type")).toBe("hidden");
    expect(field?.getAttribute("name")).toBe("captchaToken");
  });

  it("tells a visitor without JavaScript to email instead", () => {
    const note = form?.querySelector("noscript");
    expect(norm(note?.textContent)).toContain("needs JavaScript");
    expect(note?.innerHTML).toContain('href="mailto:info@nbcc.scot"');
  });

  it("loads its script deferred after main.js, and nothing from Cloudflare up front", () => {
    // Other scripts may sit beside these (TASK-479's pulse.js does), so check order, not the list.
    const srcs = [...doc.querySelectorAll("script[src]")].map((s) => s.getAttribute("src"));
    expect(srcs.filter((s) => s === "assets/js/contact-captcha.js")).toHaveLength(1);
    expect(srcs.indexOf("assets/js/contact-captcha.js")).toBeGreaterThan(srcs.indexOf("assets/js/main.js"));
    expect(doc.querySelector('script[src="assets/js/contact-captcha.js"]')?.hasAttribute("defer")).toBe(true);
    expect(html).not.toContain("challenges.cloudflare.com");
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run test/unit/contact.test.ts`
Expected: FAIL in the four new tests (no `#contactCaptcha`, no `#captchaToken`, no `<noscript>`, one script).

- [ ] **Step 3: Add the markup**

In `contact.html`, directly after the line `<script defer src="/assets/js/pulse.js"></script>` (TASK-479's analytics, which follows `main.js`), add (with the same indentation):

```html
    <script defer src="assets/js/contact-captcha.js"></script>
```

In `contact.html`, directly before the line `<button class="btn btn-holly" type="submit">Send message</button>`, add (with the same indentation):

```html
                <!-- TASK-NNN: Cloudflare Turnstile's box, drawn by assets/js/contact-captcha.js only
                     when the server says the check is on. The hidden field carries its pass, and
                     main.js sends it with the message. -->
                <div class="field" id="contactCaptcha" hidden></div>
                <input type="hidden" id="captchaToken" name="captchaToken" value="" />
                <noscript><p class="form-privacy">This form needs JavaScript to check you're not a robot. You can email us at <a href="mailto:info@nbcc.scot">info@nbcc.scot</a> instead.</p></noscript>
```

- [ ] **Step 4: Run the page's tests, including the copy rules and accessibility**

Run: `npx vitest run test/unit/contact.test.ts test/unit/copy-rules.test.ts test/unit/accessibility.test.ts`
Expected: PASS, all files.

- [ ] **Step 5: Commit**

```bash
git add contact.html test/unit/contact.test.ts
git commit -m "Captcha: a place for the box on the contact form, and a note without JavaScript"
```

---

### Task 5: main.js sends the pass

**Files:**
- Modify: `assets/js/main.js` (the `payload` object in `initContactForm`)
- Test: `test/unit/contact.test.ts` (inside `describe("contact form behaviour (jsdom)", ...)`)

- [ ] **Step 1: Write the failing test**

In `test/unit/contact.test.ts`, inside `describe("contact form behaviour (jsdom)", () => { ... })`, directly after the test named `"a valid submit shows a visible success message and clears errors only after a 200 (honest-save)"`, add:

```ts

  it("sends the spam check's pass from its hidden field with the message (TASK-NNN)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    (window as unknown as { fetch: unknown }).fetch = fetchMock;
    set("firstName", "Ada");
    set("email", "ada@example.com");
    set("message", "Hello NBCC, I would love to help.");
    set("captchaToken", "tok-1");
    submit();
    await flushPromises();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).captchaToken).toBe("tok-1");
  });
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run test/unit/contact.test.ts`
Expected: FAIL in the new test, `expected undefined to be 'tok-1'`.

- [ ] **Step 3: Add the payload line**

In `assets/js/main.js`, in `initContactForm`, change

```js
        message: value("message"),
      };
```

to

```js
        message: value("message"),
        captchaToken: value("captchaToken"), // TASK-NNN: set by contact-captcha.js
      };
```

Keep it to this one line: every byte added to `main.js` counts against `donate.html`'s budget.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/unit/contact.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add assets/js/main.js test/unit/contact.test.ts
git commit -m "Captcha: send the pass with the message"
```

---

### Task 6: contact-captcha.js

**Files:**
- Create: `assets/js/contact-captcha.js`
- Test: `test/unit/contact-captcha.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/unit/contact-captcha.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// TASK-NNN: assets/js/contact-captcha.js, the contact page's Cloudflare Turnstile box. jsdom does
// not fetch external scripts, so each test stands in for Cloudflare: it sets window.turnstile and
// calls the onload callback the script asked Cloudflare to call.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const html = readFileSync(resolve(ROOT, "contact.html"), "utf8");
const bodyHtml = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || ["", ""])[1];
const { initContactCaptcha } = require(resolve(ROOT, "assets/js/contact-captcha.js"));
const { initContactForm } = require(resolve(ROOT, "assets/js/main.js"));

type Win = Window & { fetch?: unknown; turnstile?: unknown; nbccTurnstileReady?: () => void };
const win = window as unknown as Win;
const KEY = "1x00000000000000000000AA";
const WAITING = "One moment, we're still checking you're not a robot.";
const BROKEN = "The spam check could not load. Please try again in a moment, or email info@nbcc.scot.";
const flush = () => new Promise((r) => setTimeout(r, 0));
const el = (id: string) => document.getElementById(id) as HTMLElement & { value?: string };
const turnstile = { render: vi.fn(() => "w1"), reset: vi.fn() };
const cloudflareScript = () =>
  document.head.querySelector('script[src*="challenges.cloudflare.com"]') as HTMLScriptElement | null;
const submit = () => el("contactForm").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
const renderOptions = () => (turnstile.render.mock.calls[0] as unknown as [HTMLElement, Record<string, (...a: unknown[]) => void>])[1];

function fillValidForm() {
  el("firstName").value = "Ada";
  el("email").value = "ada@example.com";
  el("message").value = "Happy to help.";
}

async function start(siteKey: string | null) {
  win.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ siteKey }) });
  initContactCaptcha(document, window);
  await flush();
  await flush();
}

function cloudflareArrives() {
  win.turnstile = turnstile;
  win.nbccTurnstileReady!();
}

beforeEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = bodyHtml;
  turnstile.render.mockClear();
  turnstile.reset.mockClear();
  delete win.turnstile;
  delete win.nbccTurnstileReady;
});

describe("with the check off", () => {
  it("asks the server, then draws nothing, loads nothing from Cloudflare, and never holds Send", async () => {
    await start(null);
    expect(win.fetch).toHaveBeenCalledWith("/api/contact/captcha");
    expect(cloudflareScript()).toBeNull();
    expect(el("contactCaptcha").hidden).toBe(true);
    fillValidForm();
    expect(submit()).toBe(true);
  });
});

describe("with the check on", () => {
  it("loads Cloudflare's script for explicit rendering, and draws the box once it is ready", async () => {
    await start(KEY);
    expect(cloudflareScript()?.src).toBe(
      "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=nbccTurnstileReady",
    );
    cloudflareArrives();
    expect(turnstile.render).toHaveBeenCalledWith(el("contactCaptcha"), expect.objectContaining({ sitekey: KEY }));
    expect(el("contactCaptcha").hidden).toBe(false);
  });

  it("draws the Compact box when the form is narrower than 300px, so nothing scrolls sideways", async () => {
    await start(KEY);
    cloudflareArrives();
    expect(renderOptions().size).toBe("compact");
  });

  it("draws the Flexible box when the form has room for it", async () => {
    await start(KEY);
    el("contactCaptcha").getBoundingClientRect = () => ({ width: 340 }) as DOMRect;
    cloudflareArrives();
    expect(renderOptions().size).toBe("flexible");
  });

  it("holds Send, saying why, while there is no pass yet", async () => {
    await start(KEY);
    cloudflareArrives();
    fillValidForm();
    expect(submit()).toBe(false);
    expect(el("formStatus").textContent).toBe(WAITING);
  });

  it("leaves an invalid form to main.js, which flags its fields", async () => {
    await start(KEY);
    cloudflareArrives();
    expect(submit()).toBe(true);
    expect(el("formStatus").textContent).not.toBe(WAITING);
  });

  it("puts the pass in the hidden field, lets Send through, and resets the box straight after", async () => {
    await start(KEY);
    cloudflareArrives();
    renderOptions().callback("tok-1");
    expect(el("captchaToken").value).toBe("tok-1");
    fillValidForm();
    expect(submit()).toBe(true);
    await flush();
    expect(turnstile.reset).toHaveBeenCalledWith("w1");
    expect(el("captchaToken").value).toBe("");
  });

  it("clears a pass that expires", async () => {
    await start(KEY);
    cloudflareArrives();
    renderOptions().callback("tok-1");
    renderOptions()["expired-callback"]();
    expect(el("captchaToken").value).toBe("");
  });

  it("says the check could not load, with the email address, when Cloudflare reports an error", async () => {
    await start(KEY);
    cloudflareArrives();
    renderOptions()["error-callback"]("110200");
    fillValidForm();
    expect(submit()).toBe(false);
    expect(el("formStatus").textContent).toBe(BROKEN);
  });

  it("says the same when Cloudflare's script cannot be fetched at all", async () => {
    await start(KEY);
    cloudflareScript()!.onerror!(new Event("error"));
    fillValidForm();
    expect(submit()).toBe(false);
    expect(el("formStatus").textContent).toBe(BROKEN);
  });
});

describe("with main.js", () => {
  it("sends the pass with the message, once, and resets the box for the next", async () => {
    const posted: string[] = [];
    win.fetch = vi.fn((url: string, init?: { body?: string }) => {
      if (url === "/api/contact/captcha") return Promise.resolve({ ok: true, json: async () => ({ siteKey: KEY }) });
      posted.push(JSON.parse(init!.body!).captchaToken);
      return Promise.resolve({ ok: true, json: async () => ({ status: "sent" }) });
    });
    initContactForm(document, window);
    initContactCaptcha(document, window);
    await flush();
    await flush();
    cloudflareArrives();
    renderOptions().callback("tok-1");
    fillValidForm();
    submit();
    await flush();
    await flush();
    expect(posted).toEqual(["tok-1"]);
    expect(turnstile.reset).toHaveBeenCalledWith("w1");
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run test/unit/contact-captcha.test.ts`
Expected: FAIL, cannot find `assets/js/contact-captcha.js`.

- [ ] **Step 3: Write contact-captcha.js**

Create `assets/js/contact-captcha.js`:

```js
// Contact form spam check (TASK-NNN): Cloudflare Turnstile, on the contact page only.
//
// Asks the server whether the check is on (GET /api/contact/captcha). Only when it gets a site key
// does it load Cloudflare's script and draw the box, so no other page, and no page in development
// or CI, loads anything from Cloudflare. It is its own file, not part of main.js, because main.js
// counts towards donate.html's page-weight budget, which has almost no room left.
//
// The pass goes into the form's hidden captchaToken field, which main.js's initContactForm sends
// with the message. Send is held, with a message, while there is no pass yet; after each send the
// box is reset, because a pass works once. A classic <script defer>, exported under a CommonJS
// guard so it can be unit-tested in jsdom, like main.js.
(function () {
  "use strict";

  var SCRIPT_URL =
    "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=nbccTurnstileReady";
  var WAITING = "One moment, we're still checking you're not a robot.";
  var BROKEN = "The spam check could not load. Please try again in a moment, or email info@nbcc.scot.";

  function initContactCaptcha(doc, win) {
    var form = doc.getElementById("contactForm");
    var box = doc.getElementById("contactCaptcha");
    var field = doc.getElementById("captchaToken");
    if (!form || !box || !field || typeof win.fetch !== "function") return null;
    var status = doc.getElementById("formStatus");
    var state = { on: false, broken: false, widgetId: null };

    function say(text) {
      if (!status) return;
      status.textContent = text;
      status.className = "form-status is-error";
    }

    // On the document in the capture phase, so it always runs before main.js's own submit handler
    // on the form, whatever order the two were set up in. Only a form that is otherwise valid is
    // held: an invalid one is left to main.js, which flags its fields.
    doc.addEventListener(
      "submit",
      function (e) {
        if (e.target !== form || !state.on) return;
        if (typeof form.checkValidity === "function" && !form.checkValidity()) return;
        if (!field.value) {
          e.preventDefault();
          e.stopImmediatePropagation();
          say(state.broken ? BROKEN : WAITING);
          return;
        }
        // main.js reads the pass during this same submit, so reset straight after, ready for the next.
        win.setTimeout(function () {
          field.value = "";
          if (win.turnstile && state.widgetId !== null) win.turnstile.reset(state.widgetId);
        }, 0);
      },
      true,
    );

    function render(siteKey) {
      box.hidden = false;
      // Flexible and Normal need 300px. A narrower form gets Compact, so nothing scrolls sideways.
      var wide = box.getBoundingClientRect().width >= 300;
      state.widgetId = win.turnstile.render(box, {
        sitekey: siteKey,
        size: wide ? "flexible" : "compact",
        callback: function (token) {
          field.value = token;
          state.broken = false;
        },
        "expired-callback": function () {
          field.value = "";
        },
        "timeout-callback": function () {
          field.value = "";
        },
        "error-callback": function () {
          field.value = "";
          state.broken = true;
        },
      });
    }

    win
      .fetch("/api/contact/captcha")
      .then(function (res) {
        return res && res.ok ? res.json() : null;
      })
      .then(function (data) {
        if (!data || !data.siteKey) return;
        state.on = true;
        win.nbccTurnstileReady = function () {
          render(data.siteKey);
        };
        var script = doc.createElement("script");
        script.src = SCRIPT_URL;
        script.async = true;
        script.defer = true;
        script.onerror = function () {
          state.broken = true;
        };
        doc.head.appendChild(script);
      })
      .catch(function () {
        // Could not ask: the form stays as it was. The server still checks if the check is on.
      });

    return state;
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { initContactCaptcha: initContactCaptcha };
  } else {
    initContactCaptcha(document, window);
  }
})();
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/unit/contact-captcha.test.ts test/unit/contact.test.ts`
Expected: PASS, both files.

- [ ] **Step 5: Commit**

```bash
git add assets/js/contact-captcha.js test/unit/contact-captcha.test.ts
git commit -m "Captcha: draw the box, hold Send without a pass, reset after each send"
```

---

### Task 7: Terraform

**Files:**
- Modify: `infra/modules/app/variables.tf` (after the `stripe_publishable_key` variable)
- Modify: `infra/modules/app/main.tf` (after the `aws_ssm_parameter.stripe_webhook_secret` resource)
- Modify: `infra/modules/app/ecs.tf` (three places)
- Modify: `infra/envs/production/main.tf` (after the `stripe_publishable_key = ...` line)

There is no Terraform on this machine. The Infra workflow's plan on the PR validates these files, and the `config-drift-reviewer` agent checks the wiring (Task 10).

- [ ] **Step 1: The site key variable**

In `infra/modules/app/variables.tf`, after the block

```hcl
variable "stripe_publishable_key" {
  type    = string
  default = "pk_test_replace_me"
}
```

add:

```hcl

# Cloudflare Turnstile SITE key for the contact form's spam check (TASK-NNN). PUBLIC: every visitor's
# browser draws the box with it, so it is a plain env value like stripe_publishable_key. Empty by
# default; production sets it, and the app refuses to start production without it.
variable "turnstile_site_key" {
  type    = string
  default = ""
}
```

- [ ] **Step 2: The secret's SSM parameter**

In `infra/modules/app/main.tf`, after the whole `resource "aws_ssm_parameter" "stripe_webhook_secret" { ... }` block, add:

```hcl

# Cloudflare Turnstile SECRET key (TASK-NNN): checks the contact form's passes with Cloudflare. A
# SecureString like the Stripe secret, created holding REPLACE_ME. The real value is pasted in out of
# band (aws ssm put-parameter --overwrite) and the apply never overwrites it. Until it is, every
# check reports our secret as invalid, and the contact form keeps messages and logs a warning.
resource "aws_ssm_parameter" "turnstile_secret_key" {
  name  = "/${var.project}/${var.environment}/TURNSTILE_SECRET_KEY"
  type  = "SecureString"
  value = "REPLACE_ME"
  lifecycle { ignore_changes = [value] }
}
```

- [ ] **Step 3: The task definition and the IAM policy**

In `infra/modules/app/ecs.tf`, inside `data "aws_iam_policy_document" "exec_secrets"`, after the line `aws_ssm_parameter.stripe_webhook_secret.arn,`, add:

```hcl
      # Cloudflare Turnstile secret (TASK-NNN), injected via valueFrom like the Stripe secret.
      aws_ssm_parameter.turnstile_secret_key.arn,
```

In the container's `environment` list, after the line `{ name = "STRIPE_PUBLISHABLE_KEY", value = var.stripe_publishable_key },`, add:

```hcl
      # Cloudflare Turnstile SITE key (TASK-NNN): public, so a plain env value like the publishable key.
      { name = "TURNSTILE_SITE_KEY", value = var.turnstile_site_key },
```

In the container's `secrets` list, after the line `{ name = "STRIPE_WEBHOOK_SECRET", valueFrom = aws_ssm_parameter.stripe_webhook_secret.arn },`, add:

```hcl
      # Cloudflare Turnstile SECRET key (TASK-NNN). Its ARN is also in exec_secrets above.
      { name = "TURNSTILE_SECRET_KEY", valueFrom = aws_ssm_parameter.turnstile_secret_key.arn },
```

- [ ] **Step 4: The production site key**

In `infra/envs/production/main.tf`, after the line that sets `stripe_publishable_key = "pk_live_..."`, add:

```hcl

  # Cloudflare Turnstile SITE key for the contact form (TASK-NNN). PUBLIC, from the widget
  # "nbcc.scot contact form" in the charity's Cloudflare account (hostname nbcc.scot, which covers
  # www). Verified 2026-10-01: Cloudflare draws the box for nbcc.scot and refuses localhost.
  turnstile_site_key = "0x4AAAAAAFLWXsnTJas6eb4L"
```

- [ ] **Step 5: Check the edits read cleanly, then commit**

Run: `git diff --stat -- infra/ && git diff -- infra/ | grep -c "turnstile"`
Expected: four files changed, and a count of at least 9.

```bash
git add infra/modules/app/variables.tf infra/modules/app/main.tf infra/modules/app/ecs.tf infra/envs/production/main.tf
git commit -m "Captcha: the Turnstile keys in production (site key public, secret in SSM)"
```

---

### Task 8: The privacy notice

**Files:**
- Modify: `privacy.html` (inside the "Sharing your data" section, after its paragraph)
- Test: `test/unit/privacy-turnstile.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/unit/privacy-turnstile.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// TASK-NNN: the privacy notice names the contact form's spam check, what Cloudflare receives, the
// lawful basis, and Cloudflare's own Turnstile privacy addendum.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const html = readFileSync(resolve(ROOT, "privacy.html"), "utf8");
const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("the privacy notice explains the contact form's spam check", () => {
  it("names Cloudflare Turnstile and what it receives", () => {
    expect(text).toContain("Cloudflare Turnstile");
    expect(text).toContain("your IP address");
    expect(text).toContain("does not use it for advertising");
  });

  it("gives the lawful basis", () => {
    expect(text).toContain("legitimate interest in keeping our inbox free of spam");
  });

  it("links Cloudflare's Turnstile privacy addendum", () => {
    expect(html).toContain('href="https://www.cloudflare.com/turnstile-privacy-policy/"');
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run test/unit/privacy-turnstile.test.ts`
Expected: FAIL, the text is not there.

- [ ] **Step 3: Add the paragraph**

In `privacy.html`, inside the section headed `<h2>Sharing your data</h2>`, directly after its existing paragraph (the one ending `who act on our instructions.` and its closing `</p>`), add with the same indentation:

```html
          <p>
            Our contact form uses Cloudflare Turnstile to check that a message comes from a person
            rather than a program sending spam. To make that check, Cloudflare receives your IP
            address and some information about your browser, and may keep a small amount of data in
            your browser (cookies or local storage) for that purpose only. Cloudflare does not use it
            for advertising. Our legal basis is our legitimate interest in keeping our inbox free of
            spam, so that real enquiries are answered. Cloudflare explains what it collects in its
            <a href="https://www.cloudflare.com/turnstile-privacy-policy/" target="_blank" rel="noopener">Turnstile privacy addendum</a>.
          </p>
```

- [ ] **Step 4: Run the tests, including the copy rules**

Run: `npx vitest run test/unit/privacy-turnstile.test.ts test/unit/copy-rules.test.ts test/unit/accessibility.test.ts`
Expected: PASS. (The copy rules forbid dashes, hyphenated words and the word "gift" on this page; the paragraph has none.)

- [ ] **Step 5: Commit**

```bash
git add privacy.html test/unit/privacy-turnstile.test.ts
git commit -m "Captcha: the privacy notice says what Cloudflare Turnstile receives"
```

---

### Task 9: README

**Files:**
- Modify: `README.md` (the contact inbox section: after the paragraph that ends `` (mocked `insertEnquiry`). ``, before the paragraph starting `**Retention-expiry anonymisation (REQ-064 · TASK-112).**`)

- [ ] **Step 1: Add the paragraph**

```markdown

**A spam check on the contact form (TASK-NNN).** Bot spam was reaching Admin → Contact form past the
honeypot and the rate limit, so `POST /api/contact` now checks a Cloudflare Turnstile pass between
the rate limit and validation whenever the check is on: both `TURNSTILE_SITE_KEY` and
`TURNSTILE_SECRET_KEY` set. Production refuses to start without them (`productionConfigProblems` in
`src/config/schema.ts`); local development and CI run with the check off. `src/clients/turnstile.ts`
asks Cloudflare's siteverify (5 second timeout) and answers `passed`, `refused` (the visitor's pass
is missing, invalid, expired or reused: **400** `{ error: "captcha" }`, nothing stored) or
`unavailable` (network, timeout, Cloudflare's own error, or our secret rejected: the message is
**kept** and an error logged, so a genuine enquiry is never lost to the checker). The page learns
the site key from `GET /api/contact/captcha`. `assets/js/contact-captcha.js`, loaded by
`contact.html` only, then draws the box (Flexible when the form is 300px wide or more, Compact
below that, so a 320px phone never scrolls sideways), holds Send with a message until there is a
pass, and resets the box after each send. It is a separate file because `main.js` counts towards
`donate.html`'s page-weight budget, which had about 530 bytes left; `main.js` only sends the hidden
`captchaToken` field. The secret is an SSM SecureString created holding `REPLACE_ME`: until the real
value is pasted in, every check reports our secret as invalid and messages are kept, with a warning
in the logs. Spec: `docs/superpowers/specs/2026-09-30-contact-form-captcha-design.md`.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "Captcha: README"
```

---

### Task 10: Verify

**Files:** none in the repo. Scratch scripts live in the session scratchpad (`$S` below).

- [ ] **Step 1: The full preflight**

Run: `npm run lint && npm run build && npm run test:unit`
Expected: lint and build exit 0. The unit suite passes except `test/unit/perf-budget.test.ts` (the known CRLF artifact on this machine).

- [ ] **Step 2: The real page-weight budget, as CI measures it**

CI checks out LF line endings, so this machine's file sizes overstate it. Commit first, then save this as `$S/budget-lf.mjs` (written with an editor tool, not a shell heredoc, which mangles the `\\b` escapes) and run `node "$S/budget-lf.mjs"` from the worktree:

```js
// Replays test/unit/perf-budget.test.ts's first-paint arithmetic using git's stored (LF) sizes,
// which is what CI's Linux checkout measures. Run from the repo root.
import { execSync } from "node:child_process";
const show = (p) => { try { return execSync(`git show HEAD:${p}`, { encoding: "utf8", maxBuffer: 1 << 26 }); } catch { return ""; } };
const size = (p) => { try { return Number(execSync(`git cat-file -s HEAD:${p}`).toString().trim()); } catch { return 0; } };
const tags = (html, name) => [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, "gi"))].map((m) => m[0]);
const attr = (t, n) => t.match(new RegExp(`\\b${n}="([^"]*)"`, "i"))?.[1];
const ext = (r) => /^(https?:)?\/\//i.test(r);
const rel = (r) => r.replace(/[?#].*$/, "").replace(/^\//, "");
for (const page of ["donate.html", "contact.html", "index.html", "about.html"]) {
  const html = show(page);
  const css = tags(html, "link").filter((t) => attr(t, "rel") === "stylesheet").map((t) => attr(t, "href")).filter(Boolean);
  const fonts = new Set(tags(html, "link").filter((t) => attr(t, "rel") === "preload" && attr(t, "as") === "font").map((t) => attr(t, "href")));
  for (const c of css) if (!ext(c)) for (const m of show(rel(c)).matchAll(/url\(['"]?([^'")]+\.(?:woff2?|ttf|otf))['"]?\)/gi)) fonts.add(m[1]);
  const scripts = tags(html, "script").filter((t) => /\bsrc=/i.test(t)).map((t) => attr(t, "src"));
  const imgs = tags(html, "img").filter((t) => attr(t, "loading") !== "lazy").map((t) => attr(t, "src")).filter(Boolean);
  const res = [...css, ...scripts, ...imgs, ...fonts];
  const bytes = size(page) + res.filter((r) => !ext(r)).reduce((s, r) => s + size(rel(r)), 0);
  console.log(`${page.padEnd(13)} ${bytes} of ${LIMIT} bytes, headroom ${LIMIT - bytes}; requests ${1 + res.length}/15 (${res.join(", ")})`);
}
```

and, near the top of that script after the `size` helper, read the budget from the test itself so a raise there is picked up:

```js
const LIMIT = 1024 * Number(show("test/unit/perf-budget.test.ts").match(/maxTransferKB:\s*(\d+)/)[1]);
```

Expected: `donate.html` headroom still positive (530 bytes against TASK-479's 262KB before this change; Task 5 adds about 70), and `contact.html` within budget at 7 of 15 requests (`pulse.js` and `contact-captcha.js` among them).

- [ ] **Step 3: A real browser, with Cloudflare's official test keys**

Test keys work on any hostname, so `localhost` is fine. Save `$S/captcha-stand-in.mjs`:

```js
// Stand-in for the NBCC server while checking the contact form's Turnstile box in a real browser.
// Serves the worktree's files, tells the page the site key, and checks each pass with Cloudflare
// using the matching test secret. Scratch tooling, not repo code.
//   SITE_KEY=... SECRET_KEY=... node captcha-stand-in.mjs <worktree> <port>
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";

const ROOT = resolve(process.argv[2]);
const PORT = Number(process.argv[3] || 4458);
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml",
  ".png": "image/png", ".webp": "image/webp", ".woff2": "font/woff2", ".ico": "image/x-icon" };
const json = (res, status, body) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname === "/api/contact/captcha") return json(res, 200, { siteKey: process.env.SITE_KEY || null });
  if (url.pathname === "/api/contact" && req.method === "POST") {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw || "{}");
    const verdict = await (await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: process.env.SECRET_KEY, response: body.captchaToken }),
    })).json();
    console.log("POST /api/contact", JSON.stringify({ token: String(body.captchaToken).slice(0, 12), verdict }));
    return verdict.success ? json(res, 200, { status: "sent" }) : json(res, 400, { error: "captcha" });
  }
  const rel = url.pathname === "/" || url.pathname === "/contact" ? "/contact.html" : url.pathname;
  const file = normalize(join(ROOT, rel));
  if (!file.startsWith(ROOT + sep)) { res.writeHead(403); return res.end(); }
  try {
    const data = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
}).listen(PORT, () => console.log(`stand-in on ${PORT}`));
```

and `$S/captcha-browser-check.mjs`:

```js
// Drives headless Chrome over the DevTools protocol against captcha-stand-in.mjs, with Cloudflare's
// official test keys. Scratch tooling, not repo code.
//   node captcha-browser-check.mjs <worktree> <scratchpad>
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";

const [WT, SCRATCH] = process.argv.slice(2);
const PORT = 4458, CDP = 9337, BASE = `http://localhost:${PORT}`;
const PASS = { site: "1x00000000000000000000AA", secret: "1x0000000000000000000000000000000AA" };
const BLOCK = { site: "2x00000000000000000000AB", secret: "2x0000000000000000000000000000000AA" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const standIn = (keys) => spawn(process.execPath, [join(SCRATCH, "captcha-stand-in.mjs"), WT, String(PORT)],
  { env: { ...process.env, SITE_KEY: keys.site, SECRET_KEY: keys.secret }, stdio: "inherit" });

const profile = join(SCRATCH, "captcha-check-" + Date.now());
const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe",
  ["--headless=new", `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`, "--no-first-run", "about:blank"], { stdio: "ignore" });
const out = {};
let server;
try {
  let target;
  for (let i = 0; i < 75 && !target; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json()).find((t) => t.type === "page"); } catch {}
    if (!target) await sleep(200);
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 1;
  const pending = new Map();
  const events = new Set();
  ws.onmessage = (m) => { const msg = JSON.parse(m.data); if (msg.id) { pending.get(msg.id)?.(msg); pending.delete(msg.id); } else for (const e of events) e(msg); };
  const send = (method, params = {}) => new Promise((r) => { const n = id++; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
  const js = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
  const open = async (width, height, mobile) => {
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile });
    const loaded = new Promise((r) => { const l = (m) => { if (m.method === "Page.loadEventFired") { events.delete(l); r(); } }; events.add(l); });
    await send("Page.navigate", { url: `${BASE}/contact` });
    await loaded;
  };
  const waitForPass = async (ms) => {
    for (let t = 0; t < ms; t += 250) { if (await js(`document.getElementById("captchaToken").value`)) return true; await sleep(250); }
    return false;
  };
  const fillAndSend = `(() => { const set = (id, v) => { document.getElementById(id).value = v; };
    set("firstName", "Ada"); set("email", "ada@example.com"); set("message", "Testing the spam check.");
    document.querySelector('#contactForm button[type="submit"]').click(); })()`;
  const page = `({ status: document.getElementById("formStatus").textContent.trim(),
    message: document.getElementById("message").value,
    scroll: document.documentElement.scrollWidth + "/" + document.documentElement.clientWidth,
    box: Math.round(document.getElementById("contactCaptcha").getBoundingClientRect().width) })`;
  await send("Page.enable");

  server = standIn(PASS);
  await sleep(800);
  for (const [name, w, h, mobile] of [["390", 390, 844, true], ["320", 320, 640, true], ["1280", 1280, 900, false]]) {
    await open(w, h, mobile);
    const gotPass = await waitForPass(15000);
    const before = await js(page);
    await js(fillAndSend);
    await sleep(2500);
    out[`passing key at ${name}`] = { gotPass, before, after: await js(page) };
  }
  server.kill();
  await sleep(500);

  server = standIn(BLOCK);
  await sleep(800);
  await open(390, 844, true);
  const gotPass = await waitForPass(8000);
  await js(fillAndSend);
  await sleep(1500);
  out["blocking key at 390"] = { gotPass, after: await js(page) };
  server.kill();
  await sleep(500);

  server = standIn(PASS);
  await sleep(800);
  await send("Emulation.setScriptExecutionDisabled", { value: true });
  await open(390, 844, true);
  const root = (await send("DOM.getDocument", { depth: -1 })).result.root.nodeId;
  const note = (await send("DOM.querySelector", { nodeId: root, selector: "#contactForm noscript p" })).result?.nodeId;
  out["JavaScript off"] = { noscriptNoteShown: Boolean(note) };
  ws.close();
} catch (e) {
  out.error = String((e && e.stack) || e);
} finally {
  try { server?.kill(); } catch {}
  chrome.kill();
  await sleep(800);
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
}
console.log(JSON.stringify(out, null, 2));
```

Run: `node "$S/captcha-browser-check.mjs" "$PWD" "$S"`
Expected:
- each `passing key` entry: `gotPass: true`, `after.status` starting "Thank you Ada", and `scroll` equal on both sides (`390/390`, `320/320`, `1265/1265` or similar). The box is 150 wide (Compact) at 320, and at least 300 (Flexible) at 1280.
- `blocking key at 390`: `gotPass: false`, `after.status` is the "still checking" or "could not load" message, and `after.message` is still "Testing the spam check.".
- `JavaScript off`: `noscriptNoteShown: true`. With scripting off the parser treats `<noscript>` content as real elements, so finding the `<p>` proves the note renders.

- [ ] **Step 4: Review**

Dispatch the `config-drift-reviewer` agent on the branch (the two keys through schema, `.env.example`, SSM, the task definition and `exec_secrets`), and a general code review of `origin/main..HEAD`. Fix anything Critical or Important.

---

### Task 11: Ship and roll out

- [ ] **Step 1: Claim the task number and replace the stand-in**

Use `/ship`, which takes the latest number in GitHub +1. Also check local branches, because other sessions hold numbers locally:
`{ gh run list --limit 200 --json headBranch,displayTitle --jq '.[].headBranch, .[].displayTitle'; gh pr list --state all --limit 200 --json title --jq '.[].title'; git branch -a --format='%(refname:short)'; } | grep -oiE 'task[-_ ]?[0-9]+' | grep -oE '[0-9]+' | sort -n | tail -1`

Then replace the stand-in in **this branch's files only**, rename the branch, and commit. `TASK-NNN`
is also a generic placeholder elsewhere in the repo (`CLAUDE.md`, including its machine-managed
block, `.claude/skills/ship/SKILL.md`, older plans and a test), and the guard hook does not see a
Bash `sed`, so a repo-wide replace would quietly rewrite them. This plan is left out too, because
its own steps use the placeholder:
`git grep -l "TASK-NNN" -- $(git diff --name-only origin/main...HEAD | grep -v '^docs/superpowers/plans/') | xargs sed -i 's/TASK-NNN/TASK-<number>/g' && git diff --stat && git branch -m contact-form-captcha task-<number>-contact-form-captcha && git commit -am "[TASK-<number>] Number the captcha change"`

Done for TASK-490: 29 lines in 19 files; none of them held `TASK-NNN` on `main`. On Windows, `sed -i`
rewrites CRLF files as LF. Git stores LF either way, but `test/unit/footer.test.ts` (byte-identical
footers) then fails locally until those files are checked out again.

- [ ] **Step 2: Open the PR straight away**

The PR title is what makes the number visible to other sessions. Title: `[TASK-<number>] A spam check on the contact form`. Run `gh pr list --state open` right after; on a clash, follow the memory rule (the PR with fewer mentions of the number moves).

- [ ] **Step 3: Green, then merge, then apply production infra**

Wait for `pr.yml` green, squash-merge, then (the diff touches `infra/`) trigger and watch the production Infra apply (`/ship` step 9). Watch the production deploy. If the deploy started before the SSM parameter existed and failed, re-run it after the apply.

- [ ] **Step 4: Jaimie pastes the secret**

The path is `/charity-site/production/TURNSTILE_SECRET_KEY` (`project = "charity-site"`, `environment = "production"` in `infra/envs/production/main.tf`; the README shows the Stripe secret at `/charity-site/production/STRIPE_SECRET_KEY`). First have Jaimie confirm the slot exists:

```bash
aws ssm get-parameter --name "/charity-site/production/TURNSTILE_SECRET_KEY" --query Parameter.Name --output text
```

Then this, with the secret pasted in place of `PASTE-THE-SECRET-KEY-HERE`. The secret never goes in chat:

```bash
aws ssm put-parameter --name "/charity-site/production/TURNSTILE_SECRET_KEY" --type SecureString --overwrite --value "PASTE-THE-SECRET-KEY-HERE"
```

- [ ] **Step 5: Restart on the same image, then test for real**

Restart the service so it reads the new value: the documented manual redeploy (`deploy-prod.yml` dispatched with the current `image_sha`), or `aws ecs update-service --force-new-deployment` from CloudShell. Then send a real test message from a phone and from a desktop: it reaches Admin → Contact form, and the logs show no `contact captcha unavailable` lines.
