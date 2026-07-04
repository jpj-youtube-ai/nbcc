# Donation Journey BDD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an end-to-end BDD feature that walks every donor persona through the whole server-side donation journey — `POST /api/checkout-session` → the signed Stripe completion webhook (built from the *real* stamped metadata) → the resulting `donations`/`donors`/`declarations` DB rows.

**Architecture:** The offline Stripe stub already lets the checkout + webhook run without a live account. We add a strictly-guarded "session echo" to the checkout response (stub-mode only) so a Cucumber step can capture the exact metadata `buildSessionParams` stamped, then replay it into a signed `checkout.session.completed` event — mirroring how Stripe echoes your session back at completion. Step defs stay pure HTTP + `pg`.

**Tech Stack:** TypeScript/Express, Zod, `stripe` SDK (offline `generateTestHeaderString` for signing), Cucumber (`@cucumber/cucumber`), `pg`, Vitest.

## Global Constraints

- **Never read `process.env` outside the config module** (golden rule 3). The seam reads `config.NODE_ENV`, not `process.env`.
- **Additive only.** No migration, no schema change, no change to the production response contract. The echo field appears ONLY when `!stripeConfigured && config.NODE_ENV !== "production"`; production never stubs.
- **Tests required** (golden rules 1 & 5): the seam gets a Vitest unit test; the journeys are `.feature` scenarios.
- **README.md tracks every change** (golden rule 7): update the testing/BDD section.
- **Branch/PR:** branch `task-116-donation-journey-bdd`; PR title starts `[TASK-116]`; drive `pr.yml` green; self-merge (per CLAUDE.md PR workflow).
- **DB cleanup convention:** journey rows are keyed `pi_journey_%` / `sub_journey_%`; event ids use `Date.now()`-based uniqueness so no `stripe_webhook_events` cleanup is needed (mirrors `stripe-webhook.steps.js`).

Exact DB shapes (confirmed in `src/db/donations.ts`, `src/db/stripe-webhook-model.ts`):
- `donors(donor_type, full_name, business_name, company_number, email, email_consent, anonymous, billing_address, billing_postcode)`
- `declarations(donor_id, title, first_name, last_name, house_name_number, address, postcode, non_uk, scope, wording_version, wording_snapshot, confirmed_taxpayer)` — `scope ∈ {'this_donation','all_donations'}`; metadata `declarationScope='enduring'` maps to `'all_donations'`.
- `donations(donor_id, declaration_id, mode, plan, amount_pence, currency, gift_aid, gasds_eligible, payment_channel, claim_status, stripe_session_id, stripe_payment_intent_id, stripe_subscription_id, stripe_charge_id, payment_status)`
- `donation_partner_shares(donation_id, declaration_id, share_pence)`

---

## File Structure

- **Modify** `src/routes/api.ts` — add the stub-only `session` echo to the `postCheckoutSession` 200 response. (~6 lines + one import.)
- **Create** `test/unit/checkout-session-echo.test.ts` — Vitest: echo present in stub mode, absent when configured.
- **Create** `features/donation-journey.feature` — the persona matrix, tagged `@db @donation-journey`.
- **Create** `features/steps/donation-journey.steps.js` — the capture-and-complete `When` steps, the tagged cleanup `Before`, and the DB `Then`s not already provided by `stripe-webhook.steps.js`.
- **Modify** `README.md` — note the new end-to-end journey feature.

Reused global step defs (Cucumber loads all `features/steps/**/*.js`, so these are available to the new feature without redefining):
- `features/steps/health.steps.js` → `Then("the response status should be {int}")`
- `features/steps/checkout.steps.js` → `When("I POST {string} with JSON:")` (reject scenarios)
- `features/steps/stripe-webhook.steps.js` → `When("I POST a signed Stripe {string} webhook event:")` and every payment-intent-keyed `Then` (amount, gift aid true/false, claim status, linked declaration, donor type, business name, audit row, gasds eligible, payment channel).

---

### Task 1: The stub-echo seam in the checkout endpoint

**Files:**
- Modify: `src/routes/api.ts` (imports near line 6; `postCheckoutSession` near lines 269-289)
- Test: `test/unit/checkout-session-echo.test.ts`

**Interfaces:**
- Produces: the checkout 200 body is `{ url }` in production, and `{ url, session: { id, metadata, mode } }` when `!stripeConfigured && config.NODE_ENV !== "production"`. `metadata` is the exact `Record<string,string>` `buildSessionParams` stamped; `mode` is `"payment" | "subscription"`.

- [ ] **Step 1: Write the failing test**

Create `test/unit/checkout-session-echo.test.ts` (mirrors `checkout-session.test.ts`'s mock harness, but stub-mode):

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// The stub-mode echo (TASK-116): when Stripe is NOT configured and we are not in
// production, postCheckoutSession echoes the built session (id + metadata + mode) on
// the 200 body so the BDD journey can replay the REAL stamped metadata into the
// completion webhook. In production (or with a real key) the body stays { url }.
const { create } = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock("../../src/clients/stripe", () => ({
  stripe: { checkout: { sessions: { create } } },
  stripePriceByPlan: {
    bronze: "price_bronze_id",
    silver: "price_silver_id",
    gold: "price_gold_id",
    platinum: "price_platinum_id",
  },
  // Not configured → the stub is active → the echo should appear.
  stripeConfigured: false,
}));

const { mockConfig } = vi.hoisted(() => ({
  mockConfig: {
    STRIPE_SUCCESS_URL: "https://nbcc.test/donate/thank-you",
    STRIPE_CANCEL_URL: "https://nbcc.test/donate",
    STRIPE_DONATION_PRODUCT: undefined as string | undefined,
    NODE_ENV: "test",
  },
}));
vi.mock("../../src/config", () => ({ config: mockConfig }));

import { postCheckoutSession } from "../../src/routes/api";

type MockRes = {
  statusCode: number;
  body: unknown;
  status: (c: number) => MockRes;
  json: (b: unknown) => MockRes;
};
function mockRes(): MockRes {
  const res = { statusCode: 200, body: undefined as unknown } as MockRes;
  res.status = (c: number) => ((res.statusCode = c), res);
  res.json = (b: unknown) => ((res.body = b), res);
  return res;
}
const run = async (body: unknown): Promise<MockRes> => {
  const res = mockRes();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await postCheckoutSession({ body } as any, res as any);
  return res;
};

beforeEach(() => {
  create.mockClear();
  create.mockResolvedValue({ id: "cs_preview_1", url: "https://checkout.stripe.com/c/pay/test_1" });
  mockConfig.NODE_ENV = "test";
});

describe("POST /api/checkout-session — stub-mode session echo (TASK-116)", () => {
  it("echoes the built session id + metadata + mode on the 200 body when stubbed and not in production", async () => {
    const res = await run({ mode: "once", plan: null, amount: 5000, giftAid: true });
    expect(res.statusCode).toBe(200);
    const body = res.body as { url: string; session?: { id: string; mode: string; metadata: Record<string, string> } };
    expect(body.url).toBe("https://checkout.stripe.com/c/pay/test_1");
    expect(body.session).toBeDefined();
    expect(body.session!.id).toBe("cs_preview_1");
    expect(body.session!.mode).toBe("payment");
    // The echoed metadata is exactly what buildSessionParams stamped.
    expect(body.session!.metadata.giftAid).toBe("true");
    expect(body.session!.metadata.mode).toBe("once");
  });

  it("echoes mode='subscription' for a monthly gift", async () => {
    const res = await run({ mode: "monthly", plan: "gold", amount: 5000, giftAid: false, ageConfirmed: true });
    const body = res.body as { session?: { mode: string } };
    expect(body.session!.mode).toBe("subscription");
  });

  it("does NOT echo the session in production even when stubbed", async () => {
    mockConfig.NODE_ENV = "production";
    const res = await run({ mode: "once", plan: null, amount: 5000, giftAid: false });
    expect((res.body as { session?: unknown }).session).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/unit/checkout-session-echo.test.ts`
Expected: FAIL — `body.session` is `undefined` (the endpoint returns only `{ url }`).

- [ ] **Step 3: Implement the seam**

In `src/routes/api.ts`, extend the stripe import (line 6) to include `stripeConfigured`:

```ts
import { stripe, stripeConfigured, stripePriceByPlan, changeSubscriptionPlan, SamePlanError } from "../clients/stripe";
```

Replace the body of `postCheckoutSession`'s success path (lines ~278-280) so it builds the params once, then conditionally echoes:

```ts
  try {
    const params = buildSessionParams(parsed.data);
    const session = await stripe.checkout.sessions.create(params);
    const body: { url: string | null; session?: { id: string; metadata: typeof params.metadata; mode: typeof params.mode } } = {
      url: session.url,
    };
    // Stub-mode echo (TASK-116): when there is no live Stripe (offline stub) and we are
    // not in production, hand the built session back so the BDD donation journey can
    // replay the REAL stamped metadata into the completion webhook — mirroring how Stripe
    // echoes your session object back in checkout.session.completed. Production NEVER stubs
    // (see src/clients/stripe.ts), so its response stays { url }. The frontend reads only url.
    if (!stripeConfigured && config.NODE_ENV !== "production") {
      body.session = { id: session.id, metadata: params.metadata, mode: params.mode };
    }
    return res.status(200).json(body);
  } catch (err) {
```

(The existing `catch` block and its 502 return are unchanged.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/unit/checkout-session-echo.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Run lint + full unit suite + typecheck (nothing else regressed)**

Run: `npm run lint && npm run build && npm run test:unit`
Expected: all green. In particular `test/unit/checkout-session.test.ts` still passes (it mocks `stripeConfigured: true`, so its bodies never carry `session`, and `create` there returns `{ url }` with no `id` — the echo branch is skipped).

- [ ] **Step 6: Commit**

```bash
git add src/routes/api.ts test/unit/checkout-session-echo.test.ts
git commit -m "[TASK-116] Echo the built checkout session in stub mode for the donation journey BDD"
```

---

### Task 2: Journey step-def infrastructure + individual personas

**Files:**
- Create: `features/donation-journey.feature`
- Create: `features/steps/donation-journey.steps.js`

**Interfaces:**
- Consumes: the Task 1 echo (`response.session`); the global `Then("the response status should be {int}")` and the payment-intent-keyed `Then`s from `stripe-webhook.steps.js`.
- Produces (new global steps, available to Tasks 3-4):
  - `When("I start checkout with JSON:")` — POSTs the payload, stores `this.session`, `this.statusCode`, `this.body`.
  - `When("Stripe completes the checkout with:")` — builds + signs + POSTs `checkout.session.completed` from `this.session` + docstring completion fields.
  - `When("Stripe settles the pending payment as {word}:")` — builds + signs + POSTs `checkout.session.async_payment_(succeeded|failed)` for `this.session.id` (BACS).
  - `Then("the declaration for payment intent {string} should have scope {string}")`
  - `Then("the declaration for payment intent {string} should have wording version {string}")`
  - `Then("the declaration for payment intent {string} should have blank postcode")`
  - `Then("the donor for payment intent {string} should have anonymous {word}")`
  - `Then("the donation for subscription {string} should have gift aid {word}")`
  - `Then("the declaration for subscription {string} should have scope {string}")`
  - `Then("there should be exactly {int} partner share for payment intent {string}")`
  - `Then("the partner shares for payment intent {string} should sum to {int}")`

- [ ] **Step 1: Write the failing feature (individual personas only for this task)**

Create `features/donation-journey.feature`:

```gherkin
@db @donation-journey
Feature: End-to-end donation journey (REQ-028/REQ-029/REQ-036)
  A donor completes checkout and Stripe fires the completion webhook it built. Each
  scenario POSTs /api/checkout-session, captures the REAL stamped session metadata
  (echoed in stub mode, TASK-116), replays it into a signed checkout.session.completed
  event with the payment fields Stripe adds at completion, and asserts the resulting
  donor / donation / declaration rows. Stripe is the offline stub; no live account.

  Scenario: individual one-off Gift Aid (UK) becomes a claimable declared donation
    When I start checkout with JSON:
      """
      { "mode": "once", "plan": null, "amount": 5000, "giftAid": true, "donorType": "individual",
        "fullName": "Ada Individual", "email": "ada.journey@example.com", "emailConsent": true,
        "declaration": { "firstName": "Ada", "lastName": "Individual", "houseNameNumber": "12",
          "address": "Analytical Avenue, London", "postcode": "KA1 1AA", "nonUk": false } }
      """
    Then the response status should be 200
    When Stripe completes the checkout with:
      """
      { "payment_intent": "pi_journey_ind_uk", "amount_total": 5000,
        "customer_details": { "name": "Ada Individual", "email": "ada.journey@example.com" } }
      """
    Then the response status should be 200
    And there should be exactly 1 donation with payment intent "pi_journey_ind_uk"
    And the donation with payment intent "pi_journey_ind_uk" should have gift aid true
    And the donation with payment intent "pi_journey_ind_uk" should have claim status "eligible"
    And the donation with payment intent "pi_journey_ind_uk" should have a linked declaration
    And the declaration for payment intent "pi_journey_ind_uk" should have scope "this_donation"
    And the declaration for payment intent "pi_journey_ind_uk" should have wording version "hmrc-single-2024-01"
    And the donor for payment intent "pi_journey_ind_uk" should have donor type "individual"

  Scenario: individual one-off Gift Aid (non-UK) stores a declaration with a blank postcode
    When I start checkout with JSON:
      """
      { "mode": "once", "plan": null, "amount": 5000, "giftAid": true, "donorType": "individual",
        "declaration": { "firstName": "Jean", "lastName": "Journey", "houseNameNumber": "La Rue",
          "address": "St Helier, Jersey", "nonUk": true } }
      """
    Then the response status should be 200
    When Stripe completes the checkout with:
      """
      { "payment_intent": "pi_journey_ind_nonuk", "amount_total": 5000 }
      """
    Then the response status should be 200
    And there should be exactly 1 donation with payment intent "pi_journey_ind_nonuk"
    And the donation with payment intent "pi_journey_ind_nonuk" should have a linked declaration
    And the declaration for payment intent "pi_journey_ind_nonuk" should have blank postcode

  Scenario: individual one-off, no Gift Aid, anonymous is stored non-claimable and anonymous
    When I start checkout with JSON:
      """
      { "mode": "once", "plan": null, "amount": 5000, "giftAid": false, "donorType": "individual",
        "anonymous": true }
      """
    Then the response status should be 200
    When Stripe completes the checkout with:
      """
      { "payment_intent": "pi_journey_ind_anon", "amount_total": 5000 }
      """
    Then the response status should be 200
    And there should be exactly 1 donation with payment intent "pi_journey_ind_anon"
    And the donation with payment intent "pi_journey_ind_anon" should have gift aid false
    And the donation with payment intent "pi_journey_ind_anon" should have claim status "not_eligible"
    And the donor for payment intent "pi_journey_ind_anon" should have anonymous true
```

- [ ] **Step 2: Run the feature to verify it fails**

Run (app not yet needed — the run fails on undefined steps first):
`npx cucumber-js features/donation-journey.feature`
Expected: FAIL — "Undefined. Implement with the following snippet" for `I start checkout with JSON:` etc.

- [ ] **Step 3: Implement the step definitions**

Create `features/steps/donation-journey.steps.js`:

```js
const { When, Then, Before, AfterAll } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");
const Stripe = require("stripe");
const { Pool } = require("pg");

// Steps for donation-journey.feature (TASK-116). Chains the REAL journey: POST
// /api/checkout-session (capturing the stub-echoed session metadata), then a signed
// checkout.session.completed built from that metadata + the payment fields Stripe adds at
// completion. Signs with the same STRIPE_WEBHOOK_SECRET the app verifies against
// (generateTestHeaderString is pure HMAC — no live account). DB assertions use DATABASE_URL.
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "whsec_dummy";
const stripe = new Stripe("sk_test_bdd"); // key unused: generateTestHeaderString is pure HMAC
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

let seq = 0;
function signedEvent(type, object) {
  seq += 1;
  const payload = JSON.stringify({
    id: `evt_journey_${Date.now()}_${seq}`,
    object: "event",
    type,
    data: { object },
  });
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  return { payload, signature };
}
async function postWebhook(payload, signature) {
  return fetch(`${BASE_URL}/api/stripe/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Stripe-Signature": signature },
    body: payload,
  });
}

// Deterministic cleanup for the tagged scenarios: remove journey rows in FK order
// (partner shares → donations → declarations → donors). Capturing donor ids from the
// donations FIRST lets us reach donors with no email (anonymous / partnership) too.
Before({ tags: "@donation-journey" }, async function () {
  const { rows } = await pool.query(
    "SELECT id, donor_id FROM donations WHERE stripe_payment_intent_id LIKE 'pi_journey_%' OR stripe_subscription_id LIKE 'sub_journey_%'",
  );
  const donationIds = rows.map((r) => r.id);
  const donorIds = [...new Set(rows.map((r) => r.donor_id).filter((id) => id != null))];
  if (donationIds.length) {
    await pool.query("DELETE FROM donation_partner_shares WHERE donation_id = ANY($1)", [donationIds]);
    await pool.query("DELETE FROM donations WHERE id = ANY($1)", [donationIds]);
  }
  if (donorIds.length) {
    await pool.query("DELETE FROM declarations WHERE donor_id = ANY($1)", [donorIds]);
    await pool.query("DELETE FROM donors WHERE id = ANY($1)", [donorIds]);
  }
});

AfterAll(async function () {
  await pool.end();
});

When("I start checkout with JSON:", async function (docString) {
  const res = await fetch(`${BASE_URL}/api/checkout-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: docString,
  });
  this.statusCode = res.status;
  this.text = await res.text();
  try {
    this.body = JSON.parse(this.text);
  } catch {
    this.body = {};
  }
  // Present only in stub mode (TASK-116). Undefined on a 400 (rejected before Stripe).
  this.session = this.body.session;
});

When("Stripe completes the checkout with:", async function (docString) {
  assert.ok(this.session, "no session echoed from checkout — is the Stripe stub active?");
  const c = JSON.parse(docString);
  const object = {
    id: this.session.id,
    object: "checkout.session",
    metadata: this.session.metadata,
    mode: this.session.mode,
    amount_total: c.amount_total ?? null,
    currency: c.currency ?? "gbp",
    payment_status: c.payment_status ?? "paid",
    payment_intent: c.payment_intent ?? null,
    subscription: c.subscription ?? null,
    customer_details: c.customer_details ?? null,
    created: c.created ?? 1700000000,
  };
  const { payload, signature } = signedEvent("checkout.session.completed", object);
  const res = await postWebhook(payload, signature);
  this.statusCode = res.status;
  this.text = await res.text();
});

When("Stripe settles the pending payment as {word}:", async function (outcome) {
  assert.ok(this.session, "no session echoed from checkout — is the Stripe stub active?");
  const type =
    outcome === "succeeded"
      ? "checkout.session.async_payment_succeeded"
      : "checkout.session.async_payment_failed";
  const { payload, signature } = signedEvent(type, { id: this.session.id, object: "checkout.session" });
  const res = await postWebhook(payload, signature);
  this.statusCode = res.status;
  this.text = await res.text();
});

async function declarationForPaymentIntent(paymentIntent) {
  const r = await pool.query(
    `SELECT dec.* FROM donations d JOIN declarations dec ON dec.id = d.declaration_id
      WHERE d.stripe_payment_intent_id = $1`,
    [paymentIntent],
  );
  assert.ok(r.rows.length > 0, `no linked declaration for payment intent ${paymentIntent}`);
  return r.rows[0];
}

Then(
  "the declaration for payment intent {string} should have scope {string}",
  async function (paymentIntent, scope) {
    const dec = await declarationForPaymentIntent(paymentIntent);
    assert.equal(dec.scope, scope);
  },
);

Then(
  "the declaration for payment intent {string} should have wording version {string}",
  async function (paymentIntent, version) {
    const dec = await declarationForPaymentIntent(paymentIntent);
    assert.equal(dec.wording_version, version);
  },
);

Then(
  "the declaration for payment intent {string} should have blank postcode",
  async function (paymentIntent) {
    const dec = await declarationForPaymentIntent(paymentIntent);
    assert.ok(
      dec.postcode == null || dec.postcode === "",
      `expected a blank postcode, got ${JSON.stringify(dec.postcode)}`,
    );
  },
);

Then(
  "the donor for payment intent {string} should have anonymous {word}",
  async function (paymentIntent, expected) {
    const r = await pool.query(
      `SELECT dn.anonymous FROM donations d JOIN donors dn ON dn.id = d.donor_id
        WHERE d.stripe_payment_intent_id = $1`,
      [paymentIntent],
    );
    assert.ok(r.rows.length > 0, `no donor for payment intent ${paymentIntent}`);
    assert.equal(r.rows[0].anonymous, expected === "true");
  },
);

Then(
  "the donation for subscription {string} should have gift aid {word}",
  async function (subscriptionId, expected) {
    const r = await pool.query(
      "SELECT gift_aid FROM donations WHERE stripe_subscription_id = $1 AND stripe_payment_intent_id IS NULL ORDER BY id ASC LIMIT 1",
      [subscriptionId],
    );
    assert.ok(r.rows.length > 0, `no parent donation for subscription ${subscriptionId}`);
    assert.equal(r.rows[0].gift_aid, expected === "true");
  },
);

Then(
  "the declaration for subscription {string} should have scope {string}",
  async function (subscriptionId, scope) {
    const r = await pool.query(
      `SELECT dec.scope
         FROM donations d JOIN declarations dec ON dec.id = d.declaration_id
        WHERE d.stripe_subscription_id = $1 AND d.stripe_payment_intent_id IS NULL
        ORDER BY d.id ASC LIMIT 1`,
      [subscriptionId],
    );
    assert.ok(r.rows.length > 0, `no parent declaration for subscription ${subscriptionId}`);
    assert.equal(r.rows[0].scope, scope);
  },
);

Then(
  "there should be exactly {int} partner share for payment intent {string}",
  async function (count, paymentIntent) {
    const r = await pool.query(
      `SELECT count(*)::int AS n
         FROM donation_partner_shares s JOIN donations d ON d.id = s.donation_id
        WHERE d.stripe_payment_intent_id = $1`,
      [paymentIntent],
    );
    assert.equal(r.rows[0].n, count);
  },
);

Then(
  "the partner shares for payment intent {string} should sum to {int}",
  async function (paymentIntent, total) {
    const r = await pool.query(
      `SELECT COALESCE(sum(s.share_pence), 0)::int AS total
         FROM donation_partner_shares s JOIN donations d ON d.id = s.donation_id
        WHERE d.stripe_payment_intent_id = $1`,
      [paymentIntent],
    );
    assert.equal(r.rows[0].total, total);
  },
);
```

- [ ] **Step 4: Start the app in stub mode against the local dev DB, then run the feature**

The app must be running on `BASE_URL` (stub mode = a placeholder `STRIPE_SECRET_KEY`, `NODE_ENV` not production) with migrations applied on the local `nbcc-db` Postgres (:5435). In one terminal:

```bash
npm run build
# .env must point DATABASE_URL at the local nbcc-db (:5435) and use placeholder Stripe keys
node --env-file=.env dist/index.js
```

In another terminal:

```bash
npx cucumber-js features/donation-journey.feature
```

Expected: PASS — 3 scenarios, all steps green. (If a step reports the session is missing, the app is not in stub mode — check that `STRIPE_SECRET_KEY` is a placeholder, not a real `sk_`/`rk_` key.)

- [ ] **Step 5: Commit**

```bash
git add features/donation-journey.feature features/steps/donation-journey.steps.js
git commit -m "[TASK-116] Add end-to-end donation journey BDD: individual personas"
```

---

### Task 3: Company, partnership, and monthly personas

**Files:**
- Modify: `features/donation-journey.feature` (append scenarios)

**Interfaces:**
- Consumes: all steps from Task 2 + the global `stripe-webhook.steps.js` steps (audit row, gift aid, claim status, donor type/business name, `I POST a signed Stripe {string} webhook event:`).

- [ ] **Step 1: Append the company + partnership + monthly scenarios**

Append to `features/donation-journey.feature`:

```gherkin
  Scenario: company one-off (no consideration) is stored non-eligible and gets a CT-receipt path
    When I start checkout with JSON:
      """
      { "mode": "once", "plan": null, "amount": 100000, "giftAid": false, "donorType": "company",
        "businessName": "Acme Ltd",
        "company": { "legalName": "Acme Ltd", "contactName": "Ada Lovelace",
          "contactEmail": "finance.journey@example.com", "billingAddress": "1 Office Park, London",
          "billingPostcode": "SW1A 1AA", "considerationGiven": false } }
      """
    Then the response status should be 200
    When Stripe completes the checkout with:
      """
      { "payment_intent": "pi_journey_co_clean", "amount_total": 100000,
        "customer_details": { "name": "Ada Lovelace", "email": "finance.journey@example.com" } }
      """
    Then the response status should be 200
    And there should be exactly 1 donation with payment intent "pi_journey_co_clean"
    And the donation with payment intent "pi_journey_co_clean" should have gift aid false
    And the donation with payment intent "pi_journey_co_clean" should have claim status "not_eligible"
    And the donor for payment intent "pi_journey_co_clean" should have donor type "company"
    And the donor for payment intent "pi_journey_co_clean" should have business name "Acme Ltd"

  Scenario: company one-off WITH consideration is flagged for the trustees (no receipt)
    When I start checkout with JSON:
      """
      { "mode": "once", "plan": null, "amount": 100000, "giftAid": false, "donorType": "company",
        "businessName": "Beta Ltd",
        "company": { "legalName": "Beta Ltd", "contactName": "Grace Hopper",
          "contactEmail": "finance2.journey@example.com", "billingAddress": "2 Office Park, London",
          "billingPostcode": "SW1A 1AA", "considerationGiven": true } }
      """
    Then the response status should be 200
    When Stripe completes the checkout with:
      """
      { "payment_intent": "pi_journey_co_consid", "amount_total": 100000 }
      """
    Then the response status should be 200
    And there should be exactly 1 donation with payment intent "pi_journey_co_consid"
    And there should be a "donation.flagged_for_trustees" audit row for the donation with payment intent "pi_journey_co_consid"

  Scenario: partnership Gift Aid records one declaration + one share per partner, summing to the amount
    When I start checkout with JSON:
      """
      { "mode": "once", "plan": null, "amount": 10000, "giftAid": true, "donorType": "partnership",
        "partners": [
          { "firstName": "Ada", "lastName": "Partner", "houseNameNumber": "1",
            "address": "Partnership House, London", "postcode": "SW1A 1AA", "nonUk": false, "sharePence": 6000 },
          { "firstName": "Grace", "lastName": "Partner", "houseNameNumber": "1",
            "address": "Partnership House, London", "postcode": "SW1A 1AA", "nonUk": false, "sharePence": 4000 } ] }
      """
    Then the response status should be 200
    When Stripe completes the checkout with:
      """
      { "payment_intent": "pi_journey_partnership", "amount_total": 10000 }
      """
    Then the response status should be 200
    And there should be exactly 1 donation with payment intent "pi_journey_partnership"
    And there should be exactly 2 partner share for payment intent "pi_journey_partnership"
    And the partner shares for payment intent "pi_journey_partnership" should sum to 10000

  Scenario: monthly Gift Aid (enduring) records an enduring declaration, and a later invoice bills a further donation
    When I start checkout with JSON:
      """
      { "mode": "monthly", "plan": "gold", "amount": 2500, "giftAid": true, "ageConfirmed": true,
        "donorType": "individual", "email": "grace.journey@example.com", "emailConsent": true,
        "declaration": { "firstName": "Grace", "lastName": "Monthly", "houseNameNumber": "9",
          "address": "Recurring Road, London", "postcode": "KA1 1AA", "nonUk": false } }
      """
    Then the response status should be 200
    When Stripe completes the checkout with:
      """
      { "subscription": "sub_journey_monthly", "amount_total": 2500, "payment_intent": null,
        "customer_details": { "name": "Grace Monthly", "email": "grace.journey@example.com" } }
      """
    Then the response status should be 200
    And the donation for subscription "sub_journey_monthly" should have gift aid true
    And the declaration for subscription "sub_journey_monthly" should have scope "all_donations"
    # A later renewal invoice books a further donation against the same subscription/donor.
    When I POST a signed Stripe "invoice.paid" webhook event:
      """
      {
        "id": "in_journey_monthly",
        "object": "invoice",
        "amount_paid": 2500,
        "currency": "gbp",
        "subscription": "sub_journey_monthly",
        "payment_intent": "pi_journey_monthly_renewal",
        "charge": "ch_journey_monthly_renewal",
        "billing_reason": "subscription_cycle"
      }
      """
    Then the response status should be 200
    And there should be exactly 1 donation with payment intent "pi_journey_monthly_renewal"
    And the donation with payment intent "pi_journey_monthly_renewal" should have amount 2500
    And the donation with payment intent "pi_journey_monthly_renewal" should have gift aid true
```

- [ ] **Step 2: Run the feature (app still running from Task 2)**

Run: `npx cucumber-js features/donation-journey.feature`
Expected: PASS — 7 scenarios. (Re-running is safe: the `@donation-journey` `Before` clears `pi_journey_%` / `sub_journey_%` rows first.)

- [ ] **Step 3: Commit**

```bash
git add features/donation-journey.feature
git commit -m "[TASK-116] Add company, partnership, and monthly donation journeys"
```

---

### Task 4: BACS settlement journey + reject cases + README

**Files:**
- Modify: `features/donation-journey.feature` (append)
- Modify: `README.md`

**Interfaces:**
- Consumes: `When("Stripe settles the pending payment as {word}:")` (Task 2); global reject steps.

- [ ] **Step 1: Append the BACS settlement journey + the new reject case**

Append to `features/donation-journey.feature`:

```gherkin
  Scenario: a BACS gift is claimable only after the pending mandate settles
    When I start checkout with JSON:
      """
      { "mode": "once", "plan": null, "amount": 5000, "giftAid": true, "donorType": "individual",
        "declaration": { "firstName": "Ada", "lastName": "Bacs", "houseNameNumber": "12",
          "address": "Analytical Avenue, London", "postcode": "KA1 1AA", "nonUk": false } }
      """
    Then the response status should be 200
    # Stripe reports payment_status 'unpaid' while a BACS mandate is pending confirmation.
    When Stripe completes the checkout with:
      """
      { "payment_intent": "pi_journey_bacs", "amount_total": 5000, "payment_status": "unpaid" }
      """
    Then the response status should be 200
    And there should be exactly 1 donation with payment intent "pi_journey_bacs"
    And the donation with payment intent "pi_journey_bacs" should have a linked declaration
    And the donation with payment intent "pi_journey_bacs" should have claim status "not_eligible"
    # The mandate confirms asynchronously: the SAME donation flips to eligible.
    When Stripe settles the pending payment as succeeded:
      """
      """
    Then the response status should be 200
    And there should be exactly 1 donation with payment intent "pi_journey_bacs"
    And the donation with payment intent "pi_journey_bacs" should have claim status "eligible"

  Scenario: a partnership whose shares do not sum to the amount is rejected before checkout
    # The other rejects (monthly without 18+, company asserting Gift Aid, company missing
    # details) are covered by features/checkout.feature; this adds the partnership-sum reject.
    When I POST "/api/checkout-session" with JSON:
      """
      { "mode": "once", "plan": null, "amount": 10000, "giftAid": true, "donorType": "partnership",
        "partners": [
          { "firstName": "Ada", "lastName": "Partner", "houseNameNumber": "1",
            "address": "Partnership House, London", "postcode": "SW1A 1AA", "nonUk": false, "sharePence": 6000 },
          { "firstName": "Grace", "lastName": "Partner", "houseNameNumber": "1",
            "address": "Partnership House, London", "postcode": "SW1A 1AA", "nonUk": false, "sharePence": 3000 } ] }
      """
    Then the response status should be 400
```

- [ ] **Step 2: Run the full feature**

Run: `npx cucumber-js features/donation-journey.feature`
Expected: PASS — 9 scenarios.

- [ ] **Step 3: Update README.md**

In the testing/BDD section of `README.md`, add a line noting the new coverage. Find the paragraph that lists the BDD features (search for `stripe-webhook.feature` or "Cucumber") and add:

```markdown
- `features/donation-journey.feature` — the end-to-end donation journey: each donor
  persona (individual UK / non-UK / anonymous, monthly enduring, company with/without
  consideration, partnership, BACS pending→settled) POSTs `/api/checkout-session`,
  replays the real stamped metadata into the signed `checkout.session.completed`
  webhook, and asserts the resulting donor/donation/declaration rows. Runs offline via
  the Stripe stub; the checkout endpoint echoes the built session in stub mode only.
```

(Match the surrounding list's exact bullet style; if the features are described in prose rather than a list, add an equivalent sentence.)

- [ ] **Step 4: Run the WHOLE BDD suite + unit + lint (nothing regressed)**

With the app running on `BASE_URL`:

```bash
npm run lint && npm run build && npm run test:unit
npx cucumber-js
```

Expected: all features green (existing + the new `donation-journey.feature`), all unit tests green, lint clean.

- [ ] **Step 5: Commit**

```bash
git add features/donation-journey.feature README.md
git commit -m "[TASK-116] Add BACS settlement journey + partnership-sum reject + README"
```

---

### Task 5: PR to green merge

- [ ] **Step 1: Rebase on main + push**

```bash
git fetch origin && git rebase origin/main
git push -u origin task-116-donation-journey-bdd
```

Resolve any conflicts per CLAUDE.md ("Resolving merge conflicts" — additive; keep both). Re-run `npm run lint && npm run build && npm run test:unit` after any resolution.

- [ ] **Step 2: Open the PR**

```bash
gh pr create --title "[TASK-116] End-to-end donation journey BDD" --body "<summary + test evidence>"
```

- [ ] **Step 3: Watch checks to green, then self-merge**

```bash
gh pr checks --watch
gh pr merge --squash --delete-branch   # only once pr.yml is green
```

Red ⇒ open the failing job, fix the cause, push, wait again. Never merge red or pending.

---

## Self-Review

**1. Spec coverage:**
- Seam (stub-echo, guarded) → Task 1. ✓
- Chained journey (POST → capture real metadata → signed completion → DB) → Task 2 steps. ✓
- Individual once GA UK / non-UK / no-GA anonymous → Task 2. ✓
- Monthly GA enduring → Task 3. ✓
- Company consideration not-given / given → Task 3. ✓
- Partnership 2 partners, shares → Task 3. ✓
- BACS pending → settled → Task 4. ✓
- Rejects: partnership mis-sum → Task 4 (new); the other three are covered in `checkout.feature` — noted in the feature to avoid duplicate-coverage drift. ✓
- New Then assertions (scope, wording version, blank postcode, anonymous, partner-share count/sum, subscription-keyed gift aid/scope) → Task 2 step defs. ✓
- README (golden rule 7) → Task 4. ✓
- Verification (lint/build/unit/full BDD) → Tasks 1, 4. ✓

Note: the spec's "company consideration given" outcome resolved to an audit row `donation.flagged_for_trustees` (confirmed in `handleCheckoutCompleted`, `src/db/stripe-webhook.ts`), asserted via the existing audit-row step — no new column needed. The partner-share row is `donation_partner_shares` (confirmed in `src/db/donations.ts`).

**2. Placeholder scan:** No TBD/TODO. Every step shows real Gherkin/JS/commands. The README step says "match the surrounding style" because the exact bullet text depends on the current README wording — the content to add is given verbatim.

**3. Type/name consistency:** `this.session` shape `{ id, metadata, mode }` produced by Task 1 is consumed identically in Task 2's `When` steps. Step phrasings are unique (no collision with global steps: individual `payment intent` DB steps live in `stripe-webhook.steps.js`; the new ones use distinct text — `declaration for payment intent`, `donor ... anonymous`, `... for subscription`, `partner share`). Payment-intent keys `pi_journey_*` and subscription `sub_journey_*` match the cleanup `LIKE` patterns.
</content>
