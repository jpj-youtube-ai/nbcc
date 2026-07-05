# Mandatory email + portal for all donors + history dashboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make donor email mandatory + always stored (thank-you to every donor), let ANY donor (not just subscribers) self-request a portal magic link by email, and show a donation-history dashboard that aggregates a donor's giving by email.

**Architecture:** Server-side enforcement of a required email on the checkout schema; the webhook always persists the email and the thank-you send is decoupled from marketing consent; the self-request route switches from a Stripe lookup to a stored-email lookup (covering one-off donors); the portal read aggregates all donations sharing the donor's email at read time (no schema change, identity = email).

**Tech Stack:** Express + TypeScript, Zod, node-postgres, Vitest, Cucumber; vanilla progressive-enhancement JS.

## Global Constraints

- No migration and no new config/secret — the `email` column already exists (nullable); we just always populate it. `/health` untouched.
- Never read `process.env` outside `src/config` (golden rule 3).
- Unit tests are DB-free (Vitest); DB/HTTP behaviour is covered by Cucumber BDD (golden rule 5).
- `SPEC.md` is generated — do NOT hand-edit it; REQ-039/REQ-061 text updates happen on the board.
- The self-request route MUST keep returning an identical generic 200 for match / no-match / send-failure / over-rate-limit; only a malformed email → 400. Message verbatim: `If that email matches a supporter, we've sent a portal link.`
- Identity for history = email, case-insensitive (`LOWER(email) = LOWER($1)`). Token targets the newest donor row.
- Update `README.md` in the same task as any behaviour/route change (golden rule 7).
- BDD donor emails MUST match the portal cleanup pattern `%portal.bdd@example.com`.
- Branch will be `task-<NNN>-...`; PR title starts `[TASK-NNN]` (number set at PR time).

---

### Task 1: Mandatory email — server enforcement

**Files:**
- Modify: `src/routes/api.ts` (the `checkoutBodySchema` `.superRefine` chain, ~line 120-128)
- Test: `test/unit/checkout-session.test.ts` (add cases; it calls `postCheckoutSession` with a mocked res)
- Modify: `features/checkout.feature` (add a 400 scenario)
- Modify: `README.md`

**Interfaces:**
- Consumes: nothing new.
- Produces: the checkout endpoint now rejects an individual/partnership donation without a valid `email` (400); company path unaffected (uses `company.contactEmail`).

- [ ] **Step 1: Add the failing unit cases** — append inside the existing `describe` in `test/unit/checkout-session.test.ts` (mirror the existing handler-call style; `postCheckoutSession(makeReq(body), res)` then assert `res.statusCode`):

```ts
  it("rejects an individual donation with no email (REQ-039: email is mandatory)", async () => {
    const res = makeRes();
    await postCheckoutSession(
      makeReq({ mode: "once", amount: 2500, giftAid: false, donorType: "individual" }),
      res as unknown as import("express").Response,
    );
    expect(res.statusCode).toBe(400);
  });

  it("rejects an individual donation with a malformed email", async () => {
    const res = makeRes();
    await postCheckoutSession(
      makeReq({ mode: "once", amount: 2500, giftAid: false, donorType: "individual", email: "not-an-email" }),
      res as unknown as import("express").Response,
    );
    expect(res.statusCode).toBe(400);
  });

  it("accepts an individual donation that includes a valid email", async () => {
    const res = makeRes();
    await postCheckoutSession(
      makeReq({ mode: "once", amount: 2500, giftAid: false, donorType: "individual", email: "donor@example.com" }),
      res as unknown as import("express").Response,
    );
    expect(res.statusCode).toBe(200);
  });
```

Note: reuse the file's existing `makeReq`/`makeRes` helpers (or the equivalent already present). If the file lacks a `makeReq` that sets a JSON body, use the same construction the existing valid-body tests use, adding the `email` field.

- [ ] **Step 2: Run to verify the first two fail**

Run: `npm run test:unit -- checkout-session`
Expected: the two "rejects…" cases FAIL (currently 200/url because email is optional); the "accepts…" case passes.

- [ ] **Step 3: Make email required for non-company paths** — in `src/routes/api.ts`, extend the final `.superRefine` (the one that checks the company object, ~line 120) by adding an email check. Replace:

```ts
  .superRefine((b, ctx) => {
    if (b.donorType === "company" && b.company === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "a company donation requires company details",
        path: ["company"],
      });
    }
  });
```

with:

```ts
  .superRefine((b, ctx) => {
    if (b.donorType === "company" && b.company === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "a company donation requires company details",
        path: ["company"],
      });
    }
    // REQ-039 (revised): email is mandatory and always stored, so we can send every
    // donor a thank-you and a portal link. Required for the individual/partnership paths;
    // a company carries its own required company.contactEmail instead, so it is exempt here.
    if (b.donorType !== "company") {
      const email = (b.email ?? "").trim();
      const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
      if (!ok) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "a valid email is required",
          path: ["email"],
        });
      }
    }
  });
```

- [ ] **Step 4: Run to verify green**

Run: `npm run test:unit -- checkout-session`
Expected: all three new cases PASS.

- [ ] **Step 5: Add a BDD scenario** — append to `features/checkout.feature` (mirror the existing "rejected … 400" scenarios' Given/When/Then wording for posting to `/api/checkout-session`):

```gherkin
  Scenario: an individual donation without an email is rejected (REQ-039: email mandatory)
    When I post a checkout session:
      """
      { "mode": "once", "amount": 2500, "giftAid": false, "donorType": "individual" }
      """
    Then the response status should be 400
```

If the existing checkout steps use a different post step phrasing, match it exactly (check `features/steps/*.js` for the checkout post step and reuse its wording).

- [ ] **Step 6: README** — in the donate/checkout section, note that email is now required for individual/partnership donations (company continues to use its contact email) and is always stored so every donor receives a thank-you; the marketing-consent tick now governs marketing only.

- [ ] **Step 7: Lint, build, verify**

Run: `npm run lint && npm run build && npm run test:unit -- checkout-session`
Expected: green.

- [ ] **Step 8: Commit**

```bash
git add src/routes/api.ts test/unit/checkout-session.test.ts features/checkout.feature README.md
git commit -m "feat: require a valid email for individual/partnership donations (REQ-039)"
```

---

### Task 2: Always store email + thank-you to every donor

**Files:**
- Modify: `src/db/stripe-webhook-model.ts` (`donationFromCheckoutSession` ~line 102; `confirmationEmailFor` ~line 256)
- Test: `test/unit/stripe-webhook-model.test.ts` (email-storage assertion)
- Test: `test/unit/donation-confirmation-email.test.ts` (consent-decoupled send)

**Interfaces:**
- Consumes: nothing new.
- Produces: `donationFromCheckoutSession` stores `email` whenever supplied (independent of consent); `confirmationEmailFor(donor, gift)` returns a payload whenever `donor.email` is present (no consent gate).

- [ ] **Step 1: Update the failing unit expectations**

In `test/unit/donation-confirmation-email.test.ts`, the suite currently asserts NO send when `email_consent=false`. Change that expectation: with an email present but consent false, EXACTLY ONE confirmation send now happens. Locate the test asserting no-send-on-consent-false and rewrite it:

```ts
  it("sends the confirmation when an email is present even if consent is false (transactional thank-you)", async () => {
    await sendConfirmation(
      confirmationEmailForFixture({ email: "donor@example.com", emailConsent: false, fullName: "Dee" }),
    );
    expect(sendDonationConfirmation).toHaveBeenCalledTimes(1);
  });
```

Adjust to the file's actual helpers: if the test builds the payload via `confirmationEmailFor` or an event fixture, keep that construction but set consent false and expect one send. Keep the existing "no send when email absent" case as-is.

In `test/unit/stripe-webhook-model.test.ts`, add (or adjust) an assertion that a checkout session with an email but `emailConsent` not "true" still maps to a donor row whose `email` is set:

```ts
  it("stores the donor email even when marketing consent was not given (REQ-039 revised)", () => {
    const { donor } = donationFromCheckoutSession(
      makeSession({ metadata: { mode: "once", donorType: "individual", email: "keep@example.com", emailConsent: "false" } }),
    );
    expect(donor.email).toBe("keep@example.com");
    expect(donor.emailConsent).toBe(false);
  });
```

Use the file's existing session-fixture helper (e.g. `makeSession`/`checkoutSession`); match its shape.

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:unit -- stripe-webhook-model donation-confirmation-email`
Expected: the new/updated cases FAIL (email currently null without consent; send currently suppressed without consent).

- [ ] **Step 3: Always store the email** — in `src/db/stripe-webhook-model.ts`, in the individual return of `donationFromCheckoutSession` (~line 102), replace:

```ts
      email: consented && md.email ? md.email : null,
```

with:

```ts
      // REQ-039 (revised): email is mandatory + always stored so every donor gets a
      // thank-you and can reach the portal. Marketing consent (emailConsent) is separate.
      email: md.email ? md.email : null,
```

- [ ] **Step 4: Decouple the thank-you from consent** — in the same file, in `confirmationEmailFor` (~line 256), replace:

```ts
  if (!donor.email || donor.emailConsent !== true) return null;
```

with:

```ts
  // A donation confirmation/thank-you is transactional, so it sends whenever we have an
  // email — no marketing-consent gate (REQ-039 revised). Marketing sends stay gated elsewhere.
  if (!donor.email) return null;
```

Also update the function's leading comment to reflect that it is no longer the consent gate.

- [ ] **Step 5: Run to verify green**

Run: `npm run test:unit -- stripe-webhook-model donation-confirmation-email`
Expected: PASS. Then run the broader webhook suite to catch fallout: `npm run test:unit -- stripe-webhook` — fix any test that assumed consent-gated email/thank-you by updating its expectation to the new behaviour (email stored / thank-you sent). Do not weaken assertions beyond the consent-gate change.

- [ ] **Step 6: Commit**

```bash
git add src/db/stripe-webhook-model.ts test/unit/stripe-webhook-model.test.ts test/unit/donation-confirmation-email.test.ts
git commit -m "feat: always store donor email + send thank-you regardless of marketing consent (REQ-039)"
```

---

### Task 3: Mandatory email — donate form (frontend)

**Files:**
- Modify: `donate.html` (~line 223-224, the individual email field)
- Modify: `assets/js/main.js` (`initGiveToggle`'s `apply()`, ~line 187-214)

**Interfaces:**
- Consumes: nothing.
- Produces: the individual email input is `required` on the individual/partnership paths and un-required (not blocking) on the company path.

- [ ] **Step 1: Make the field required in the markup** — in `donate.html`, replace:

```html
<label for="donorEmail">Email <span class="give-optional">(optional)</span></label>
<input autocomplete="email" class="give-field-input" id="donorEmail" name="email" placeholder="you@example.com" type="email"/>
```

with (mirroring the `#companyContactEmail` required pattern at line 388-389):

```html
<label for="donorEmail">Email <span aria-hidden="true" class="give-req">*</span></label>
<input aria-required="true" autocomplete="email" class="give-field-input" id="donorEmail" name="email" placeholder="you@example.com" required="" type="email"/>
```

- [ ] **Step 2: Un-require it on the company path** — in `assets/js/main.js`, inside `initGiveToggle`'s `apply()` (the function that toggles path-specific visibility, ~line 187), add near the company block a toggle so a company donor is not forced to fill the individual email (the server exempts company). Add, after the `company` handling block (after line 213, before the closing `}` of `apply`):

```js
      // REQ-039: the individual email is required on the individual/partnership paths, but a
      // company donates via its own contact email — un-require the individual field there so a
      // hidden/irrelevant required input never blocks submission (mirrors the company inputs above).
      var donorEmail = doc.getElementById("donorEmail");
      if (donorEmail) {
        if (path === "company") {
          donorEmail.removeAttribute("required");
          donorEmail.removeAttribute("aria-required");
        } else {
          donorEmail.setAttribute("required", "");
          donorEmail.setAttribute("aria-required", "true");
        }
      }
```

- [ ] **Step 3: Verify the page still builds/serves and BDD is green**

Run: `npm run build`
Then run the donate/site BDD (start app per README with the prepared env, run cucumber): `npm run test:bdd -- --tags @site` and any `@donate`/checkout tags. Expected: green (the change is additive markup + an attribute toggle). Also confirm the required attribute is present:

Run: `grep -n 'id="donorEmail"' donate.html`
Expected: the line shows `required` and `aria-required="true"`.

- [ ] **Step 4: Commit**

```bash
git add donate.html assets/js/main.js
git commit -m "feat: mark the donor email required on the donate form (individual/partnership) (REQ-039)"
```

---

### Task 4: Self-request keyed off stored email (all donors)

**Files:**
- Modify: `src/db/portal.ts` (add `findNewestDonorByEmail`; remove `findDonorBySubscriptionIds`)
- Modify: `src/routes/portal.ts` (`postRequestAccess` lookup swap + imports)
- Modify: `src/clients/stripe.ts` (remove `findSubscriptionIdsByEmail` + the stub `customers` block and the stub `subscriptions.list` added for it)
- Delete: `test/unit/portal-stripe-lookup.test.ts`
- Modify: `features/portal.feature` + `features/steps/portal.steps.js` (one-off donor scenario)
- Modify: `README.md`

**Interfaces:**
- Consumes: `issuePortalAccessToken`, `portalMagicLink`, `sendPortalMagicLink`, `config.PORTAL_BASE_URL`, `createRateLimiter` (all existing).
- Produces: `findNewestDonorByEmail(email: string): Promise<{ donorId: number; fullName: string } | null>`.

- [ ] **Step 1: Add the failing BDD scenario** — append to `features/portal.feature`:

```gherkin
  Scenario: a one-off donor (no subscription) self-requests a portal link
    Given a one-off donor "Fay Portal" with email "fay.oneoff.portal.bdd@example.com"
    When I POST a portal access request for "fay.oneoff.portal.bdd@example.com"
    Then the portal response status should be 200
    And the portal response field "message" should be "If that email matches a supporter, we've sent a portal link."
    And a portal token exists for "fay.oneoff.portal.bdd@example.com"
```

Add the seeding step to `features/steps/portal.steps.js` (a donor row with a stored email and a one-off donation, NO subscription id):

```js
Given("a one-off donor {string} with email {string}", async function (name, email) {
  const donor = await pool.query(
    "INSERT INTO donors (donor_type, full_name, email, email_consent) VALUES ('individual', $1, $2, false) RETURNING id",
    [name, email],
  );
  await pool.query(
    `INSERT INTO donations (donor_id, mode, amount_pence, gift_aid, claim_status)
     VALUES ($1, 'once', 2500, false, 'not_eligible')`,
    [donor.rows[0].id],
  );
});
```

(The `@portal` Before hook already clears donations/declarations/tokens/donors for `%portal.bdd@example.com`, added in TASK-123.)

- [ ] **Step 2: Run to verify it fails**

Start the app (prepared env) and run `npm run test:bdd -- --tags @portal`.
Expected: the new scenario FAILS — the current route uses the Stripe lookup, which returns no subscription for a one-off donor, so no token is created.

- [ ] **Step 3: Add the stored-email lookup** — append to `src/db/portal.ts`:

```ts
// Resolve the newest donor row for a stored email (REQ-061 revised). With email now mandatory
// and always stored, the self-request route reaches ANY donor — including one-off donors with no
// Stripe subscription — by their stored donors.email. Case-insensitive; newest row wins (that is
// the canonical row the token targets). Returns null when no donor has that email.
export async function findNewestDonorByEmail(
  email: string,
): Promise<{ donorId: number; fullName: string } | null> {
  const res = await pool.query<{ id: number; full_name: string }>(
    `SELECT id, full_name FROM donors WHERE LOWER(email) = LOWER($1) ORDER BY id DESC LIMIT 1`,
    [email],
  );
  const row = res.rows[0];
  return row ? { donorId: row.id, fullName: row.full_name } : null;
}
```

Then delete `findDonorBySubscriptionIds` (the whole export block, ~line 216-234) from `src/db/portal.ts`.

- [ ] **Step 4: Swap the route lookup** — in `src/routes/portal.ts`:

Change the imports: in the `../db/portal` import, replace `findDonorBySubscriptionIds` with `findNewestDonorByEmail`. Remove `findSubscriptionIdsByEmail` from the `../clients/stripe` import (keep `cancelSubscription`).

Replace the try-block body in `postRequestAccess` (currently lines ~177-188):

```ts
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
```

with:

```ts
    try {
      // REQ-061 revised: email is mandatory + always stored, so we match ANY donor (one-off
      // included) by their stored email — no Stripe subscription lookup needed.
      const donor = await findNewestDonorByEmail(email);
      if (donor) {
        const { token } = await issuePortalAccessToken(donor.donorId, { actor: "donor" });
        const link = portalMagicLink(config.PORTAL_BASE_URL, token);
        // Best-effort, mirroring the other sends: a provider failure is logged, never surfaced.
        await sendPortalMagicLink({ email, fullName: donor.fullName, link });
      }
    } catch (err) {
      console.error("portal access request failed:", err instanceof Error ? err.message : err);
    }
```

Update the `postRequestAccess` leading comment to say donors are matched by their stored email (not Stripe).

- [ ] **Step 5: Remove the now-unused Stripe helper + stub** — in `src/clients/stripe.ts`:
  - Delete the `findSubscriptionIdsByEmail` export (added in TASK-123).
  - In `stubStripe()`, delete the `customers: { list: ... }` block and delete ONLY the `list:` member added inside `subscriptions` (keep `retrieve`, `update`, `cancel`).
  - Delete the file `test/unit/portal-stripe-lookup.test.ts`.

- [ ] **Step 6: Run to verify green**

Run: `npm run lint && npm run build && npm run test:unit`
Then start the app + `npm run test:bdd -- --tags @portal`.
Expected: unit suite green (the deleted test is gone; nothing else imports the removed functions), all `@portal` scenarios green including the new one-off scenario and the existing enumeration guard.

- [ ] **Step 7: README** — update the portal section: the self-request route now matches donors by their stored email (covers one-off donors), no longer via Stripe.

- [ ] **Step 8: Commit**

```bash
git add src/db/portal.ts src/routes/portal.ts src/clients/stripe.ts features/portal.feature features/steps/portal.steps.js README.md
git rm test/unit/portal-stripe-lookup.test.ts
git commit -m "feat: self-request portal link by stored email, covering one-off donors (REQ-061)"
```

---

### Task 5: Donation-history aggregate + snapshot API

**Files:**
- Modify: `src/db/portal.ts` (add `getDonorDonationHistory` + type)
- Modify: `src/routes/portal.ts` (`getPortal` attaches history)
- Modify: `features/portal.feature` + `features/steps/portal.steps.js` (history assertions)

**Interfaces:**
- Consumes: `getDonorPortalSnapshot` (existing, returns `email`).
- Produces: `getDonorDonationHistory(email: string): Promise<DonorDonationHistory>` where `DonorDonationHistory = { totalPence: number; count: number; donations: Array<{ date: string; amountPence: number; mode: "once" | "monthly"; giftAid: boolean; status: string }> }`. The GET snapshot response gains a `history` field of that shape.

- [ ] **Step 1: Add the failing BDD scenario** — append to `features/portal.feature`:

```gherkin
  Scenario: the portal shows a donor's donation history and total
    Given a donor "Gil Portal" with email "gil.portal.bdd@example.com" and a valid portal token
    And the donor has 3 recorded donations totalling 6000 pence
    When I GET the donor portal
    Then the portal response status should be 200
    And the portal history count should be 3
    And the portal history total pence should be 6000
```

Add steps to `features/steps/portal.steps.js`:

```js
Given("the donor has {int} recorded donations totalling {int} pence", async function (count, totalPence) {
  const donor = await pool.query("SELECT donor_id FROM portal_access_tokens WHERE token = $1", [this.portalToken]);
  const donorId = donor.rows[0].donor_id;
  const each = Math.floor(totalPence / count);
  let remaining = totalPence;
  for (let i = 0; i < count; i++) {
    const amount = i === count - 1 ? remaining : each;
    remaining -= amount;
    await pool.query(
      `INSERT INTO donations (donor_id, mode, amount_pence, gift_aid, claim_status)
       VALUES ($1, 'once', $2, false, 'not_eligible')`,
      [donorId, amount],
    );
  }
});

Then("the portal history count should be {int}", function (n) {
  assert.equal(this.portalBody.history && this.portalBody.history.count, n);
});

Then("the portal history total pence should be {int}", function (n) {
  assert.equal(this.portalBody.history && this.portalBody.history.totalPence, n);
});
```

- [ ] **Step 2: Run to verify it fails**

Start the app + `npm run test:bdd -- --tags @portal`.
Expected: the new scenario FAILS — the GET response has no `history` field yet.

- [ ] **Step 3: Add the aggregate query** — append to `src/db/portal.ts`:

```ts
// A donor's giving history for the portal dashboard (REQ-061 revised). Identity = email: a donor
// who gave N times is N donor rows sharing an email, so this aggregates every donation joined to a
// donor row with that email (case-insensitive), newest first, plus the count and gross total. Pure
// read (pool.query). An email with no donations yields an empty history (count 0, total 0).
export interface DonorDonationHistory {
  totalPence: number;
  count: number;
  donations: Array<{
    date: string;
    amountPence: number;
    mode: "once" | "monthly";
    giftAid: boolean;
    status: string;
  }>;
}

export async function getDonorDonationHistory(email: string): Promise<DonorDonationHistory> {
  const res = await pool.query<{
    created_at: Date;
    amount_pence: number;
    mode: string;
    gift_aid: boolean;
    payment_status: string;
  }>(
    `SELECT d.created_at, d.amount_pence, d.mode, d.gift_aid, d.payment_status
       FROM donations d JOIN donors dn ON dn.id = d.donor_id
      WHERE LOWER(dn.email) = LOWER($1)
      ORDER BY d.created_at DESC, d.id DESC`,
    [email],
  );
  const donations = res.rows.map((r) => ({
    date: r.created_at.toISOString(),
    amountPence: r.amount_pence,
    mode: r.mode === "monthly" ? ("monthly" as const) : ("once" as const),
    giftAid: r.gift_aid,
    status: r.payment_status,
  }));
  const totalPence = donations.reduce((sum, d) => sum + d.amountPence, 0);
  return { totalPence, count: donations.length, donations };
}
```

- [ ] **Step 4: Attach history to the GET snapshot** — in `src/routes/portal.ts`, add `getDonorDonationHistory` to the `../db/portal` import, and change `getPortal` to compose it. Replace:

```ts
    const snapshot = await getDonorPortalSnapshot(donorId);
    if (!snapshot) return res.status(404).json({ error: "Donor not found" });
    return res.status(200).json(snapshot);
```

with:

```ts
    const snapshot = await getDonorPortalSnapshot(donorId);
    if (!snapshot) return res.status(404).json({ error: "Donor not found" });
    // Aggregate the donor's giving by email (identity = email); empty history when no email on file.
    const history = snapshot.email
      ? await getDonorDonationHistory(snapshot.email)
      : { totalPence: 0, count: 0, donations: [] };
    return res.status(200).json({ ...snapshot, history });
```

- [ ] **Step 5: Run to verify green**

Run: `npm run lint && npm run build`, start the app + `npm run test:bdd -- --tags @portal`.
Expected: the history scenario passes (count 3, total 6000); existing portal scenarios still green.

- [ ] **Step 6: Commit**

```bash
git add src/db/portal.ts src/routes/portal.ts features/portal.feature features/steps/portal.steps.js
git commit -m "feat: aggregate donor donation history by email in the portal snapshot (REQ-061)"
```

---

### Task 6: Portal history dashboard (frontend)

**Files:**
- Modify: `portal.html` (add a history card after the Gift Aid card, ~line 172)
- Modify: `assets/js/main.js` (`render` in `initPortal`, ~line 823-854)
- Modify: `README.md`

**Interfaces:**
- Consumes: the GET snapshot's `history` field (Task 5).
- Produces: a rendered donations table + total + count on the portal page.

- [ ] **Step 1: Add the history card markup** — in `portal.html`, after the Gift Aid card's closing `</div>` (line 172) and before the action-status `<p>` (line 174), insert:

```html
          <!-- Your donation history (REQ-061 revised): aggregated by email. -->
          <div class="portal-card card reveal" aria-labelledby="portal-history-heading">
            <h2 id="portal-history-heading">Your giving</h2>
            <p class="portal-plan">
              Total given: <strong id="portalTotal">£0.00</strong>
              (<span id="portalCount">0</span> donations)
            </p>
            <p class="portal-note" id="portalNoHistory" hidden>
              We have no recorded donations for your email yet.
            </p>
            <table class="portal-history" id="portalHistoryTable">
              <thead>
                <tr><th scope="col">Date</th><th scope="col">Amount</th><th scope="col">Type</th><th scope="col">Gift Aid</th><th scope="col">Status</th></tr>
              </thead>
              <tbody id="portalHistoryBody"></tbody>
            </table>
          </div>
```

- [ ] **Step 2: Render the history** — in `assets/js/main.js`, inside `render(data)` (before `if (statusEl) statusEl.hidden = true;`, ~line 851), add:

```js
      // Donation history (REQ-061 revised): total, count, and a row per donation.
      var history = data.history || { totalPence: 0, count: 0, donations: [] };
      var totalEl = doc.getElementById("portalTotal");
      if (totalEl) totalEl.textContent = "£" + (history.totalPence / 100).toFixed(2);
      var countEl = doc.getElementById("portalCount");
      if (countEl) countEl.textContent = String(history.count);
      var noHistory = doc.getElementById("portalNoHistory");
      var historyTable = doc.getElementById("portalHistoryTable");
      var body = doc.getElementById("portalHistoryBody");
      if (body) {
        body.textContent = "";
        (history.donations || []).forEach(function (d) {
          var tr = doc.createElement("tr");
          var cells = [
            new Date(d.date).toLocaleDateString(),
            "£" + (d.amountPence / 100).toFixed(2),
            d.mode === "monthly" ? "Monthly" : "One-off",
            d.giftAid ? "Yes" : "No",
            d.status,
          ];
          cells.forEach(function (text) {
            var td = doc.createElement("td");
            td.textContent = text;
            tr.appendChild(td);
          });
          body.appendChild(tr);
        });
      }
      var hasHistory = (history.count || 0) > 0;
      if (noHistory) noHistory.hidden = hasHistory;
      if (historyTable) historyTable.hidden = !hasHistory;
```

- [ ] **Step 3: Verify build + BDD + markup**

Run: `npm run build`, start the app + `npm run test:bdd -- --tags @portal` (and `@site` if portal page text is asserted there). Expected: green.
Run: `grep -n 'portalHistoryBody' portal.html assets/js/main.js` — both present.

- [ ] **Step 4: README** — note the portal now shows a donation-history dashboard (total, count, per-donation rows) aggregated by the donor's email.

- [ ] **Step 5: Commit**

```bash
git add portal.html assets/js/main.js README.md
git commit -m "feat: portal donation-history dashboard (total, count, per-donation rows) (REQ-061)"
```

---

## Self-Review

**Spec coverage:**
- Part A mandatory email: server enforcement → Task 1; always-store + thank-you decouple → Task 2; donate form → Task 3.
- Part B self-request by stored email (one-off donors) + Stripe cleanup → Task 4.
- Part C history aggregate + snapshot → Task 5; dashboard UI → Task 6.
- Identity = email, newest row canonical, case-insensitive → Tasks 4 & 5 (`findNewestDonorByEmail`, `LOWER(email)`).
- MVP edit semantics (canonical row) → unchanged code, no task needed; noted in spec.
- No migration/config; `/health` untouched → confirmed (only additive reads/edits).

**Placeholder scan:** none — every code step carries complete code. Two steps say "match the file's existing helper" (test `makeReq`/`makeSession`, checkout post step) — these are lookups of an existing name, not deferred implementation; the implementer confirms the exact identifier in the named file.

**Type consistency:** `findNewestDonorByEmail → { donorId, fullName } | null` consumed in the route as `donor.donorId`/`donor.fullName` (matches the removed `findDonorBySubscriptionIds` shape, so `issuePortalAccessToken`/`sendPortalMagicLink` calls are unchanged). `DonorDonationHistory { totalPence, count, donations[] }` produced by `getDonorDonationHistory` (Task 5), consumed by the BDD (`history.count`/`history.totalPence`) and the frontend `data.history` (Task 6) — field names align. `confirmationEmailFor` signature unchanged; only its gate loosened.
