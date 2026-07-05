# Donor-portal self-request route — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `POST /api/portal/request` so a subscription donor can obtain a one-time portal magic link by entering their email, closing the "portal is unreachable" gap (REQ-061 / TASK-123).

**Architecture:** A new public handler on the existing `portalRouter` validates an email, rate-limits, looks the donor up **via their Stripe customer email** (subscription donors are reachable even when we stored no marketing email), maps the Stripe subscription id to our donor row, then issues + emails a magic link using the already-built `issuePortalAccessToken` / `sendPortalMagicLink`. It always returns an identical generic `200` (no enumeration).

**Tech Stack:** Express + TypeScript, Zod, Stripe SDK (offline stub for local/CI), node-postgres, Vitest, Cucumber.

## Global Constraints

- Never read `process.env` outside `src/config` (golden rule 3). No new config value here — reuse `PORTAL_BASE_URL`.
- No new secret and **no migration** (additive rule N/A — nothing schema-side changes).
- Unit tests are DB-free (Vitest); DB/HTTP behaviour is covered by Cucumber BDD (golden rule 5).
- `sendPortalMagicLink` is best-effort: a send failure is logged, never surfaced.
- Update `README.md` in the same PR (golden rule 7).
- BDD donor emails MUST match the portal cleanup pattern `%portal.bdd@example.com`.
- Existing `portalRouter` is already mounted in `src/app.ts` — do **not** touch `app.ts`.
- Branch `task-123-portal-self-request`; PR title starts `[TASK-123]`.

---

### Task 1: Pure in-memory request rate-limiter

**Files:**
- Create: `src/portal/request-limiter.ts`
- Test: `test/unit/portal-request-limiter.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `createRateLimiter(opts: { max: number; windowMs: number }): { allow(key: string, now: number): boolean }` — sliding-window counter, `now` injected (no `Date.now()` inside, so it is deterministically testable).

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/portal-request-limiter.test.ts
import { describe, it, expect } from "vitest";
import { createRateLimiter } from "../../src/portal/request-limiter";

describe("createRateLimiter", () => {
  it("allows up to max within the window, then denies", () => {
    const rl = createRateLimiter({ max: 2, windowMs: 1000 });
    expect(rl.allow("a@x", 0)).toBe(true);
    expect(rl.allow("a@x", 100)).toBe(true);
    expect(rl.allow("a@x", 200)).toBe(false); // 3rd in window
  });

  it("tracks keys independently", () => {
    const rl = createRateLimiter({ max: 1, windowMs: 1000 });
    expect(rl.allow("a@x", 0)).toBe(true);
    expect(rl.allow("b@x", 0)).toBe(true); // different key, own budget
    expect(rl.allow("a@x", 0)).toBe(false);
  });

  it("frees the budget once the window has passed", () => {
    const rl = createRateLimiter({ max: 1, windowMs: 1000 });
    expect(rl.allow("a@x", 0)).toBe(true);
    expect(rl.allow("a@x", 500)).toBe(false);
    expect(rl.allow("a@x", 1001)).toBe(true); // window elapsed
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- portal-request-limiter`
Expected: FAIL — cannot find module `request-limiter`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/portal/request-limiter.ts
// A tiny sliding-window rate limiter for the portal self-request route (REQ-061 · TASK-123).
// Pure + DB-free: state is an in-memory map of key -> hit timestamps, and `now` is injected so
// the window logic is deterministically unit-testable. In-memory state is PER-TASK — acceptable
// for the single Fargate task today; a distributed limiter is a documented follow-up.
export function createRateLimiter(opts: { max: number; windowMs: number }) {
  const hits = new Map<string, number[]>();
  return {
    allow(key: string, now: number): boolean {
      const cutoff = now - opts.windowMs;
      const recent = (hits.get(key) ?? []).filter((t) => t > cutoff);
      if (recent.length >= opts.max) {
        hits.set(key, recent);
        return false;
      }
      recent.push(now);
      hits.set(key, recent);
      return true;
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- portal-request-limiter`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/portal/request-limiter.ts test/unit/portal-request-limiter.test.ts
git commit -m "feat: pure in-memory rate limiter for portal self-request (TASK-123)"
```

---

### Task 2: Stripe lookup — subscription ids by email (+ offline stub)

**Files:**
- Modify: `src/clients/stripe.ts` (add export near `cancelSubscription`; extend `stubStripe()`)
- Test: `test/unit/portal-stripe-lookup.test.ts`

**Interfaces:**
- Consumes: the module-level `stripe` client (real SDK or offline stub).
- Produces: `findSubscriptionIdsByEmail(email: string): Promise<string[]>` — every Stripe subscription id (any status) belonging to customers with that email. In stub mode it is deterministic: email `e` → `["sub_stub_" + e]` (customer `cus_stub_" + e`). This exact rule is relied on by the BDD seed in Task 3.

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/portal-stripe-lookup.test.ts
// The unit suite runs with a placeholder STRIPE_SECRET_KEY and NODE_ENV=test, so `stripe`
// is the offline stub — no network. This pins the deterministic stub mapping the BDD depends on.
import { describe, it, expect } from "vitest";
import { findSubscriptionIdsByEmail } from "../../src/clients/stripe";

describe("findSubscriptionIdsByEmail (offline stub)", () => {
  it("maps an email to its deterministic stub subscription id", async () => {
    expect(await findSubscriptionIdsByEmail("donor@x")).toEqual(["sub_stub_donor@x"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- portal-stripe-lookup`
Expected: FAIL — `findSubscriptionIdsByEmail` is not exported.

- [ ] **Step 3a: Extend the offline stub** in `src/clients/stripe.ts`

Inside `stubStripe()`'s returned object, add a `customers` block and a `list` to the existing `subscriptions` block. Add the `customers` property alongside `checkout`/`subscriptions`:

```ts
    customers: {
      // Deterministic: any queried email maps to a single stub customer whose id encodes it,
      // so findSubscriptionIdsByEmail is reproducible offline (BDD seeds against this rule).
      list: async (params: Stripe.CustomerListParams) => ({
        data: params.email ? [{ id: `cus_stub_${params.email}`, object: "customer", email: params.email }] : [],
      }),
    },
```

And add `list` inside the existing `subscriptions: { ... }` object (next to `retrieve`/`update`/`cancel`):

```ts
      // One active stub subscription per customer; its id echoes the customer's encoded email
      // so the whole email -> subscription -> donor-row chain is deterministic offline.
      list: async (params: Stripe.SubscriptionListParams) => ({
        data: [
          {
            id: `sub_stub_${String(params.customer).replace(/^cus_stub_/, "")}`,
            object: "subscription",
            status: "active",
            items: { data: [{ id: "si_preview", price: { id: "price_preview_current" } }] },
          },
        ],
      }),
```

- [ ] **Step 3b: Add the real helper** in `src/clients/stripe.ts` (after `cancelSubscription`)

```ts
// Find every Stripe subscription id for the customers registered under an email (REQ-061 · TASK-123).
// The self-request route uses this to reach subscription donors by their Stripe customer email —
// which Stripe always holds — even when we stored no marketing email for them (REQ-039). Offline the
// stub above makes this deterministic; with a real key it lists customers then their subscriptions.
export async function findSubscriptionIdsByEmail(email: string): Promise<string[]> {
  const customers = await stripe.customers.list({ email, limit: 100 });
  const ids: string[] = [];
  for (const customer of customers.data) {
    const subs = await stripe.subscriptions.list({ customer: customer.id, status: "all", limit: 100 });
    for (const sub of subs.data) ids.push(sub.id);
  }
  return ids;
}
```

- [ ] **Step 4: Run test + typecheck**

Run: `npm run test:unit -- portal-stripe-lookup && npm run build`
Expected: test PASS; build succeeds (the stub cast is `as unknown as Stripe`, so the new members typecheck).

- [ ] **Step 5: Commit**

```bash
git add src/clients/stripe.ts test/unit/portal-stripe-lookup.test.ts
git commit -m "feat: Stripe findSubscriptionIdsByEmail + offline stub (TASK-123)"
```

---

### Task 3: The self-request route (db mapping + handler + BDD + README)

**Files:**
- Modify: `src/db/portal.ts` (add `findDonorBySubscriptionIds`)
- Modify: `src/routes/portal.ts` (add `requestBodySchema`, `postRequestAccess`, route line)
- Modify: `features/portal.feature` (new scenarios)
- Modify: `features/steps/portal.steps.js` (new steps + extend the `@portal` cleanup to also clear donations)
- Modify: `README.md` (portal section)

**Interfaces:**
- Consumes: `createRateLimiter` (Task 1); `findSubscriptionIdsByEmail` (Task 2); existing `issuePortalAccessToken` (`src/db/portal.ts`), `portalMagicLink` (`src/portal/tokens.ts`), `sendPortalMagicLink` + `PortalMagicLinkEmail` (`src/clients/email.ts`), `config.PORTAL_BASE_URL`.
- Produces: `findDonorBySubscriptionIds(subIds: string[]): Promise<{ donorId: number; fullName: string } | null>` (newest match); route `POST /api/portal/request`.

- [ ] **Step 1: Write the failing BDD scenarios** — append to `features/portal.feature`

```gherkin
  Scenario: a subscription donor self-requests a portal link
    Given a subscription donor "Deb Portal" with email "deb.selfreq.portal.bdd@example.com"
    When I POST a portal access request for "deb.selfreq.portal.bdd@example.com"
    Then the portal response status should be 200
    And the portal response field "message" should be "If that email matches a supporter, we've sent a portal link."
    And a portal token exists for "deb.selfreq.portal.bdd@example.com"

  Scenario: an unknown email gets the same generic response and no link
    When I POST a portal access request for "nobody.selfreq.portal.bdd@example.com"
    Then the portal response status should be 200
    And the portal response field "message" should be "If that email matches a supporter, we've sent a portal link."
    And no portal token exists for "nobody.selfreq.portal.bdd@example.com"

  Scenario: a malformed email is rejected
    When I POST a portal access request for "not-an-email"
    Then the portal response status should be 400
```

- [ ] **Step 2: Add the BDD steps** — edit `features/steps/portal.steps.js`

First, extend the existing `Before({ tags: "@portal" }, ...)` cleanup to clear donations before donors (the new scenario seeds a donation; donors delete would otherwise FK-fail). Add this line **before** the `DELETE FROM donors` line, after the declarations delete:

```js
  await pool.query(`DELETE FROM donations WHERE ${donorFilter}`);
```

Then append these steps (before `AfterAll`):

```js
// Seed a subscription donor: a donor row (no stored marketing email needed for the lookup) plus a
// 'monthly' donation whose stripe_subscription_id equals the deterministic stub id for this email
// (Task 2: email e -> "sub_stub_" + e), so the route's Stripe->donor mapping resolves offline.
Given("a subscription donor {string} with email {string}", async function (name, email) {
  const donor = await pool.query(
    "INSERT INTO donors (donor_type, full_name, email, email_consent) VALUES ('individual', $1, $2, true) RETURNING id",
    [name, email],
  );
  await pool.query(
    `INSERT INTO donations (donor_id, mode, amount_pence, gift_aid, claim_status, stripe_subscription_id)
     VALUES ($1, 'monthly', 1000, false, 'not_eligible', $2)`,
    [donor.rows[0].id, `sub_stub_${email}`],
  );
});

When("I POST a portal access request for {string}", async function (email) {
  const res = await fetch(`${BASE_URL}/api/portal/request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  this.portalStatus = res.status;
  this.portalBody = await res.json().catch(() => ({}));
});

Then("a portal token exists for {string}", async function (email) {
  const row = await pool.query(
    `SELECT 1 FROM portal_access_tokens t JOIN donors d ON d.id = t.donor_id WHERE d.email = $1`,
    [email],
  );
  assert.ok(row.rowCount > 0, "expected a portal token for the donor");
});

Then("no portal token exists for {string}", async function (email) {
  const row = await pool.query(
    `SELECT 1 FROM portal_access_tokens t JOIN donors d ON d.id = t.donor_id WHERE d.email = $1`,
    [email],
  );
  assert.equal(row.rowCount, 0, "expected no portal token for an unknown email");
});
```

- [ ] **Step 3: Run BDD to verify the new scenarios fail**

Run: `npm run build && npm run test:bdd -- --tags @portal`
Expected: the three new scenarios FAIL (route returns 404 — not yet added). (Start the app on `BASE_URL` first per README; existing @portal scenarios still pass.)

- [ ] **Step 4: Add the db mapping helper** — append to `src/db/portal.ts`

```ts
// Resolve a donor from Stripe subscription ids (REQ-061 · TASK-123). Given the subscription ids
// Stripe returns for a requester's email, find the matching donation row and return its donor —
// newest donation wins when several match. Returns null when no stored donation references any of
// the ids (an unknown/one-off email), so the caller can respond generically without enumerating.
export async function findDonorBySubscriptionIds(
  subIds: string[],
): Promise<{ donorId: number; fullName: string } | null> {
  if (subIds.length === 0) return null;
  const res = await pool.query<{ donor_id: number; full_name: string }>(
    `SELECT d.donor_id, dn.full_name
       FROM donations d JOIN donors dn ON dn.id = d.donor_id
      WHERE d.stripe_subscription_id = ANY($1)
      ORDER BY d.id DESC
      LIMIT 1`,
    [subIds],
  );
  const row = res.rows[0];
  return row ? { donorId: row.donor_id, fullName: row.full_name } : null;
}
```

- [ ] **Step 5: Add the route** — edit `src/routes/portal.ts`

Add to the imports at the top:

```ts
import { config } from "../config";
import { findSubscriptionIdsByEmail } from "../clients/stripe";
import { portalMagicLink } from "../portal/tokens";
import { sendPortalMagicLink } from "../clients/email";
import { createRateLimiter } from "../portal/request-limiter";
```

Extend the existing `../db/portal` import to also pull `issuePortalAccessToken` and `findDonorBySubscriptionIds`.

Then add, above the route registrations at the bottom:

```ts
// The self-serve portal access request (REQ-061 · TASK-123). A donor enters their email; we reach
// subscription donors via their Stripe customer email (always held by Stripe) and email them a
// one-time magic link. The response is ALWAYS the same generic 200 — match, no-match, or a failed
// send — so the endpoint never reveals whether an email belongs to a supporter (no enumeration).
const requestBodySchema = z.object({ email: z.string().trim().email() });

// Abuse control: cap requests per email and per client IP. In-memory + per-task (documented follow-up
// for a distributed limiter). Module-scoped so the window persists across requests.
const emailLimiter = createRateLimiter({ max: 3, windowMs: 15 * 60 * 1000 });
const ipLimiter = createRateLimiter({ max: 20, windowMs: 15 * 60 * 1000 });

const GENERIC_REQUEST_MESSAGE = "If that email matches a supporter, we've sent a portal link.";

export async function postRequestAccess(req: Request, res: Response): Promise<Response | void> {
  const parsed = requestBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "A valid email is required" });
  }
  const email = parsed.data.email;
  const now = Date.now();

  // Over-limit is treated exactly like any other outcome: the generic 200, no work done.
  if (emailLimiter.allow(email, now) && ipLimiter.allow(req.ip ?? "unknown", now)) {
    try {
      const subIds = await findSubscriptionIdsByEmail(email);
      const donor = await findDonorBySubscriptionIds(subIds);
      if (donor) {
        const { token } = await issuePortalAccessToken(donor.donorId, { actor: "donor" });
        const link = portalMagicLink(config.PORTAL_BASE_URL, token);
        // Best-effort, mirroring the other sends: a provider failure is logged, never surfaced.
        await sendPortalMagicLink({ email, fullName: donor.fullName, link });
      }
    } catch (err) {
      console.error("portal access request failed:", err instanceof Error ? err.message : err);
    }
  }

  return res.status(200).json({ message: GENERIC_REQUEST_MESSAGE });
}
```

Add the route registration next to the others:

```ts
portalRouter.post("/api/portal/request", postRequestAccess);
```

- [ ] **Step 6: Run BDD + lint + typecheck to verify green**

Run: `npm run lint && npm run build && npm run test:bdd -- --tags @portal`
Expected: all @portal scenarios PASS (existing + 3 new).

- [ ] **Step 7: Update README** — in the donor-portal section of `README.md`, add a line documenting the new endpoint:

```md
- `POST /api/portal/request` `{ email }` — a subscription donor requests a one-time portal
  magic link. The donor is matched via their **Stripe customer email** (so subscription donors
  are reachable even without a stored marketing email) and, on a match, emailed a link
  (`issuePortalAccessToken` → `portalMagicLink` → `sendPortalMagicLink`). Always returns an
  identical generic `200` — no email enumeration. Rate-limited per email and per IP (in-memory,
  per-task; a distributed limiter is a follow-up).
```

- [ ] **Step 8: Full local verification**

Run: `npm run lint && npm run build && npm run test:unit && npm run test:bdd -- --tags @portal`
Expected: all green.

- [ ] **Step 9: Commit**

```bash
git add src/db/portal.ts src/routes/portal.ts features/portal.feature features/steps/portal.steps.js README.md
git commit -m "feat: POST /api/portal/request self-request magic link (TASK-123)"
```

---

## Self-Review

**Spec coverage:**
- Route `POST /api/portal/request`, Zod email, 400 on malformed → Task 3 (schema + scenario 3).
- Rate-limit per-email + per-IP, over-limit → generic 200 → Task 1 + Task 3 handler.
- Stripe `customers.list` + `subscriptions.list` lookup → Task 2.
- Map subscription id → donor row (newest) → Task 3 `findDonorBySubscriptionIds`.
- Issue token + build link + best-effort send → Task 3 handler.
- Always identical generic 200, no enumeration → Task 3 handler + BDD scenarios 1 & 2 assert the identical message and token/no-token.
- Not in scope (one-off donors, mandatory email, consent-free storage, distributed limiter) → documented, no task. ✓
- No new config/secret/migration → confirmed; no `add-config` / migration tasks. ✓

**Placeholder scan:** none — every code step is complete.

**Type consistency:** `findSubscriptionIdsByEmail` (Task 2) → `string[]`, consumed by `findDonorBySubscriptionIds(subIds)` (Task 3). `findDonorBySubscriptionIds` returns `{ donorId, fullName } | null`; handler uses `donor.donorId` / `donor.fullName`. `issuePortalAccessToken(donorId, { actor })` returns `{ token }` (matches `src/db/portal.ts`). `sendPortalMagicLink({ email, fullName, link })` matches `PortalMagicLinkEmail`. `createRateLimiter({ max, windowMs }).allow(key, now)` consistent across Tasks 1 and 3. ✓
