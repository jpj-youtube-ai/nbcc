# Admin phone app and notifications — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The admin installs on an iPhone home screen as its own app with NBCC's maroon icon, and pushes a notification for every arrival that would raise a New pill.

**Architecture:** Task 1 makes the admin installable and is shippable on its own. Tasks 2–4 build the push machinery bottom-up: config, then Web Push encryption written from the RFCs (no dependency is addable — see Global Constraints), then the tables. Task 5 keeps the installed app signed in for 30 days so a tap lands on the thing rather than a password box. Tasks 6–7 read arrivals and decide what to send, reusing the existing New-pill areas, permissions and per-person `seenAt` rather than inventing a second idea of "new". Tasks 8–9 are the service worker, the `?area=` landing and the settings screen.

**Tech Stack:** Express + TypeScript, Postgres (node-pg-migrate), **`node:crypto` only** for Web Push, `sharp` (already present) for build-time icons, vanilla JS admin SPA, Vitest + Cucumber.

**Spec:** `docs/superpowers/specs/2026-11-12-admin-phone-app-design.md`

## Global Constraints

- **No new npm dependency.** `README.md`: *"the npm registry is blocked on the owner's machine and a new runtime dep would break local dev"*. VAPID (RFC 8292) and payload encryption (RFC 8291) are written from the specs on `node:crypto`, the way the AWS SigV4 signer and the QR encoder already are. `web-push` is not an option.
- Icon artwork: `NBCC_LOGO_DARK_BG_.svg` (whole logo, elf + wordmark) on maroon **`#800000`**. Home-screen name **`NBCC Admin`**. Manifest `display` **must** be `"standalone"` — `"browser"` silently disables iOS push.
- **No personal names in notification text.** Amount, kind and source only.
- **Only arrivals from outside the charity notify.** Nothing a staff member does in the admin buzzes anyone, including themselves (Jaimie, 12 Nov: *"nothing a staff member does should buzz"*). Monthly renewals follow the Monthly pill, which counts only the first paid gift.
- Filtered by `reachableAreas(perms)` from `src/admin/whats-new.ts`, read fresh on every sweep so a permission change takes effect at once. Never widen it.
- **Burst cap:** more than **20** arrivals for one person in one minute collapses into a single "N new things" notification (Jaimie, 12 Nov). Below that, one notification each.
- Defaults: bundling **off**, quiet hours **off**, every area **on**. A quiet-hours or bundled arrival is **dropped, not held** — the New pill still shows it, and production runs a single Fargate task that restarts on deploy, so nothing in memory can be trusted to flush.
- **Installed-app sessions last 30 days** (Jaimie, 12 Nov). Browser-tab sessions stay at 8 hours.
- Golden rule 3 — new config in `src/config/schema.ts`, `.env.example`, SSM in `infra/modules/app/main.tf`, task-def `secrets` in `infra/modules/app/ecs.tf`, and the parameter ARN in the `exec_secrets` IAM policy in `ecs.tf`.
- Golden rule 2 — migrations additive only; re-check the new files sort after `1791200000460_elf-family-mobile.js` against `main` immediately before merging.
- Unit tests database-free; HTTP behaviour gets a Cucumber scenario. `README.md` updated in the same PR.
- **PR #699 is left alone.** It also edits `admin.html`'s head and its `site-icons.test.ts` asserts every page carries its four lines. Reviving it is its own job; whoever does it makes `admin.html` an exception.

## Review Focus

1. **A subscription the browser has revoked** returns 404/410 and must be deleted, not retried forever — Task 7.
2. **Two sweeps at once** must not both send the same arrival; the cursor is claimed in one atomic `UPDATE … RETURNING` — Task 7.
3. **Permissions reduced after subscribing** must stop that area's notifications immediately — Task 7.
4. **A screen-only area** (`events`, `analytics`, `qr`, `red-bag`, `invoices` have no `ARRIVALS` entry) must return empty, not throw — Task 6.
5. **A notification tapped when the session has gone** must land on the login screen and then the right section, not a blank page — Task 8.

---

### Task 1: The admin installs as an app

**Files:**
- Create: `scripts/make-admin-icons.mjs`, `assets/admin-icons/{nbcc-logo-dark-bg.svg,apple-touch-icon.png,icon-192.png,icon-512.png,icon-maskable-512.png,admin.webmanifest}`
- Modify: `admin.html` (head)
- Test: `test/unit/admin-app-install.test.ts`, `features/admin-app-install.feature`

**Interfaces:**
- Produces: the manifest at `/assets/admin-icons/admin.webmanifest`, `start_url` and `scope` `/admin`.

- [ ] **Step 1: Copy the artwork in and write the generator**

Copy `NBCC_LOGO_DARK_BG_.svg` to `assets/admin-icons/nbcc-logo-dark-bg.svg`. `scripts/make-admin-icons.mjs` renders it with `sharp` at `density: 150` (higher overflows sharp's pixel limit on this 1500-unit viewBox), composited at 80% inset on opaque `#800000`, to the four sizes; the maskable one insets to 60% to survive Android's circular mask. No alpha channel in any of them.

- [ ] **Step 2: Write the failing test**

```ts
it("asks to be installed as an app, not a bookmark", () => {
  const m = JSON.parse(readFileSync(resolve(ROOT, "assets/admin-icons/admin.webmanifest"), "utf8"));
  expect(m.display).toBe("standalone");          // "browser" kills iOS push
  expect(m.start_url).toBe("/admin");
  expect(m.scope).toBe("/admin");
  expect(m.name).toBe("NBCC Admin");
  expect(m.background_color).toBe("#800000");
  expect(m.theme_color).toBe("#800000");
});
it("names the icon and the manifest in the admin's head", () => {
  const head = readFileSync(resolve(ROOT, "admin.html"), "utf8");
  expect(head).toContain('<link rel="manifest" href="/assets/admin-icons/admin.webmanifest" />');
  expect(head).toContain('<link rel="apple-touch-icon" href="/assets/admin-icons/apple-touch-icon.png" />');
  expect(head).toContain('<meta name="apple-mobile-web-app-title" content="NBCC Admin" />');
  expect(head).toContain('<meta name="theme-color" content="#800000" />');
});
it("ships icons with no transparency, because iOS fills it with black", async () => {
  for (const f of ["apple-touch-icon.png", "icon-192.png", "icon-512.png"])
    expect((await sharp(resolve(ROOT, "assets/admin-icons", f)).metadata()).channels, f).toBe(3);
});
```

- [ ] **Step 3: Run it and watch it fail** — `npx vitest run test/unit/admin-app-install.test.ts`
- [ ] **Step 4: Generate the icons, write the manifest, add the four head lines** after the viewport meta. `/assets` is already an `express.static` mount, so no new route unless a test proves a 404.
- [ ] **Step 5: Run the tests** — PASS
- [ ] **Step 6: Cucumber** — `/assets/admin-icons/admin.webmanifest` is 200 with `content-type` containing `application/manifest+json`; the apple-touch-icon is 200.
- [ ] **Step 7: Commit** — `feat: the admin installs on a phone as its own app, on maroon`

---

### Task 2: The signing keys, wired through config

**Files:** Modify `src/config/schema.ts`, `.env.example`, `infra/modules/app/main.tf`, `infra/modules/app/ecs.tf`. Test `test/unit/config-push.test.ts`.

**Interfaces:** Produces `config.VAPID_PUBLIC_KEY`, `config.VAPID_PRIVATE_KEY`, `config.VAPID_SUBJECT` (`string`, default `""`), and `pushIsConfigured(c): boolean`.

- [ ] **Step 1: Write the failing test**

```ts
it("treats push as switched off when the keys are absent", () => {
  expect(pushIsConfigured({ VAPID_PUBLIC_KEY: "", VAPID_PRIVATE_KEY: "" })).toBe(false);
  expect(pushIsConfigured({ VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv" })).toBe(true);
});
```

- [ ] **Step 2: Run it and watch it fail**
- [ ] **Step 3: Add the three keys and `pushIsConfigured`** — `z.string().default("")`, matching the `GOOGLE_*` style. Defaulting to empty keeps every existing environment and CI booting unchanged, and leaves the feature dormant until the real values are pasted into SSM out of band (the Turnstile/Stripe pattern).
- [ ] **Step 4: Wire the other four touch-points.** A missed ARN in `exec_secrets` stops the task starting.
- [ ] **Step 5: Run the tests, then dispatch `config-drift-reviewer` over the diff**
- [ ] **Step 6: Commit** — `feat: VAPID keys for admin push, wired through every config touch-point`

---

### Task 3: Web Push encryption, written from the RFCs

The riskiest task in the plan and the only one with no safe fallback, so it is pure, dependency-free and pinned to published vectors.

**Files:** Create `src/admin/web-push.ts`. Test `test/unit/web-push-crypto.test.ts`.

**Interfaces:**
- Produces:
  - `vapidAuthHeader(input: { audience: string; subject: string; publicKey: string; privateKey: string; now?: Date }): string` — the full `vapid t=…, k=…` value.
  - `encryptPayload(input: { plaintext: Buffer; uaPublicKey: string; authSecret: string; salt?: Buffer; ephemeral?: crypto.ECDH }): Buffer` — an RFC 8188 `aes128gcm` body.
  - `subscriptionIsDead(err: { statusCode?: number }): boolean`

- [ ] **Step 1: Write the failing test, pinned to the RFCs**

```ts
// RFC 8291 §5 worked example: fixed salt, fixed keys, known ciphertext.
it("reproduces RFC 8291's worked example byte for byte", () => {
  const body = encryptPayload({
    plaintext: Buffer.from("When I grow up, I want to be a watermelon"),
    uaPublicKey: RFC8291.uaPublic, authSecret: RFC8291.authSecret,
    salt: RFC8291.salt, ephemeral: RFC8291.asKeyPair,
  });
  expect(body.toString("base64url")).toBe(RFC8291.expectedBody);
});
it("lays the body out as salt, record size, key length, key, ciphertext", () => {
  const body = encryptPayload({ plaintext: Buffer.from("hi"), uaPublicKey: UA, authSecret: AUTH });
  expect(body.length).toBeGreaterThan(16 + 4 + 1 + 65);
  expect(body.readUInt32BE(16)).toBe(4096);
  expect(body.readUInt8(20)).toBe(65);
});
it("signs a VAPID token for the push service's origin, valid for 12 hours", () => {
  const header = vapidAuthHeader({ audience: "https://fcm.googleapis.com", subject: "mailto:hello@nbcc.scot",
    publicKey: PUB, privateKey: PRIV, now: new Date("2026-11-12T00:00:00Z") });
  const [, jwt, key] = header.match(/^vapid t=([^,]+), k=(.+)$/);
  const claims = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());
  expect(claims).toEqual({ aud: "https://fcm.googleapis.com", sub: "mailto:hello@nbcc.scot",
    exp: Math.floor(Date.parse("2026-11-12T12:00:00Z") / 1000) });
  expect(JSON.parse(Buffer.from(jwt.split(".")[0], "base64url").toString())).toEqual({ typ: "JWT", alg: "ES256" });
  expect(key).toBe(PUB);
});
it("signs with a raw 64-byte r||s signature, not DER", () => {
  const jwt = vapidAuthHeader({ ...ARGS }).match(/t=([^,]+)/)[1];
  expect(Buffer.from(jwt.split(".")[2], "base64url")).toHaveLength(64);
});
it("knows a gone subscription from a wobble", () => {
  expect(subscriptionIsDead({ statusCode: 410 })).toBe(true);
  expect(subscriptionIsDead({ statusCode: 404 })).toBe(true);
  expect(subscriptionIsDead({ statusCode: 500 })).toBe(false);
});
```

- [ ] **Step 2: Run it and watch it fail** — `npx vitest run test/unit/web-push-crypto.test.ts`

- [ ] **Step 3: Implement `src/admin/web-push.ts`**

All on `node:crypto`. The encryption follows RFC 8291 §3.4: ECDH P-256 against the subscriber's key, then
`IKM = HKDF(salt: authSecret, ikm: sharedSecret, info: "WebPush: info" ‖ 0x00 ‖ uaPublic ‖ asPublic, 32)`,
then `CEK = HKDF(salt, IKM, "Content-Encoding: aes128gcm" ‖ 0x00, 16)` and
`NONCE = HKDF(salt, IKM, "Content-Encoding: nonce" ‖ 0x00, 12)`; plaintext gains a single `0x02`
delimiter before AES-128-GCM. The signature uses `crypto.sign(null, data, { key, dsaEncoding: "ieee-p1363" })`,
which yields raw `r‖s` directly — `createSign` would give DER and every push service would reject it.
`salt` and `ephemeral` are injectable **only** so the RFC vector can be reproduced; both default to fresh random.

- [ ] **Step 4: Run the tests** — PASS
- [ ] **Step 5: Independent review of this file alone** by a fresh reviewer, before anything is built on it.
- [ ] **Step 6: Commit** — `feat: Web Push encryption and VAPID signing, from the RFCs, no dependency`

---

### Task 4: Remembering which phones to buzz

**Files:** Create `migrations/<timestamp>_admin-push.js`, `src/db/admin-push.ts`. Test `test/unit/admin-push-model.test.ts`.

**Interfaces:**
- Produces: `saveSubscription(userId, sub)`, `deleteSubscription(endpoint)`, `allSubscriptions()`, `subscriptionsFor(userId)`, `getPrefs(userId)`, `setPrefs(userId, prefs)`, `claimCursor(userId, area, at): Promise<boolean>`
- `StoredSubscription = { id: number; userId: number; endpoint: string; p256dh: string; auth: string }`
- `NotifyPrefs = { bundle: boolean; quietFrom: string | null; quietTo: string | null; areasOff: Area[] }`

- [ ] **Step 1: Write the migration** — three additive tables. `admin_push_subscriptions` (`admin_user_id` FK **on delete cascade**, so a removed member stops being buzzed; `endpoint` text UNIQUE; `p256dh`, `auth`, `created_at`, `last_ok_at`, `failures` int default 0). `admin_notify_prefs` (`admin_user_id` PK/FK, `bundle` bool default false, `quiet_from`/`quiet_to` time null, `areas_off` text[] default `'{}'`). `admin_notify_cursor` (`admin_user_id`, `area`, `notified_at`, PK on the pair). Then `ls migrations | sort | tail` and confirm it sorts last.

- [ ] **Step 2: Write the failing test** — pure mapping only, either side of the SQL

```ts
it("turns a browser subscription into the row we store", () => {
  expect(subscriptionRow(7, { endpoint: "https://x/1", keys: { p256dh: "P", auth: "A" } }))
    .toEqual({ adminUserId: 7, endpoint: "https://x/1", p256dh: "P", auth: "A" });
});
it("refuses a subscription with no keys rather than storing half of one", () => {
  expect(() => subscriptionRow(7, { endpoint: "https://x/1", keys: {} })).toThrow(/keys/i);
});
it("defaults somebody who has never opened the settings to everything on", () => {
  expect(prefsFromRow(null)).toEqual({ bundle: false, quietFrom: null, quietTo: null, areasOff: [] });
});
```

- [ ] **Step 3: Run it and watch it fail**
- [ ] **Step 4: Implement `src/db/admin-push.ts`.** `claimCursor` is the single atomic statement the sweep relies on:

```sql
INSERT INTO admin_notify_cursor (admin_user_id, area, notified_at) VALUES ($1,$2,$3)
ON CONFLICT (admin_user_id, area) DO UPDATE SET notified_at = $3
 WHERE admin_notify_cursor.notified_at < $3
RETURNING notified_at
```

No row returned means another sweep got there first.

- [ ] **Step 5: Run the tests, then dispatch `migration-safety-reviewer`**
- [ ] **Step 6: Commit** — `feat: store which phones to notify, each person's settings, and the send cursor`

---

### Task 5: The installed app stays signed in for 30 days

**Files:** Modify `src/admin/session.ts`, `src/routes/admin.ts` (login), `assets/js/admin/app.js`. Test `test/unit/admin-session-installed.test.ts`.

**Interfaces:** Consumes `ADMIN_SESSION_TTL_MS`. Produces `INSTALLED_APP_TTL_MS` and a `installed: boolean` field on the login request.

- [ ] **Step 1: Write the failing test**

```ts
it("gives a pinned app thirty days and a browser tab eight hours", () => {
  expect(sessionTtlMs({ installed: true })).toBe(30 * 24 * 60 * 60 * 1000);
  expect(sessionTtlMs({ installed: false })).toBe(8 * 60 * 60 * 1000);
  expect(sessionTtlMs({})).toBe(8 * 60 * 60 * 1000);   // absent means a tab
});
```

- [ ] **Step 2: Run it and watch it fail**
- [ ] **Step 3: Implement `sessionTtlMs`** in `src/admin/session.ts` and honour it where the login route mints the token.
- [ ] **Step 4: Send and keep it from the client** — `app.js` posts `installed: window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true`, and when that is true keeps the token in `localStorage` rather than `sessionStorage`, because iOS closing the app would otherwise wipe a 30-day session on the first eviction. A browser tab is unchanged.
- [ ] **Step 5: Run the tests** — PASS
- [ ] **Step 6: Commit** — `feat: the pinned admin app stays signed in for 30 days`

---

### Task 6: What arrived, not just when

**Files:** Modify `src/db/whats-new.ts`, `src/admin/whats-new.ts`. Test `test/unit/whats-new-details.test.ts`.

**Interfaces:** Produces `arrivalDetails(area: Area, since: Date, limit?: number): Promise<ArrivalItem[]>` and the pure `arrivalLine(area: Area, fields: Record<string, unknown>): string`, where `ArrivalItem = { at: Date; area: Area; line: string }`.

- [ ] **Step 1: Write the failing test**

```ts
it("says what it was and where it came from, never who", () => {
  expect(arrivalLine("donations", { amountPence: 2500, source: "in_person" })).toBe("£25 donation — card reader");
  expect(arrivalLine("donations", { amountPence: 1050, source: "online" })).toBe("£10.50 donation — website");
  expect(arrivalLine("fundraising", { name: "Robert Burns Academy" })).toBe("New Get involved sign-up");
  expect(arrivalLine("contact", {})).toBe("New message on the contact form");
});
it("carries no personal name through, even when one is handed to it", () => {
  expect(arrivalLine("fundraising", { name: "Sarah McBride" })).not.toMatch(/Sarah/);
});
it("returns nothing for an area that is a screen rather than an arrival", async () => {
  await expect(arrivalDetails("analytics", new Date(0))).resolves.toEqual([]);
});
```

- [ ] **Step 2: Run it and watch it fail**
- [ ] **Step 3: Implement both.** `arrivalLine` is pure and lives beside the rules in `src/admin/whats-new.ts`. `arrivalDetails` is an `ARRIVAL_DETAILS` sibling to the existing `ARRIVALS` map in `src/db/whats-new.ts`, keeping its `db` field so contact and stories keep reading their own pools — the isolation rule in `src/db/contact-pool.ts` is not bent. An area with no entry returns `[]` (Review Focus 4).
- [ ] **Step 4: Run the tests** — PASS
- [ ] **Step 5: Commit** — `feat: the New-pill arrivals can say what arrived, for a notification to quote`

---

### Task 7: The sweep that sends them

**Files:** Create `src/admin/notify.ts`, `src/admin/notify-runner.ts`. Modify `src/app.ts`. Test `test/unit/admin-notify.test.ts`, `features/admin-notifications.feature`.

**Interfaces:** Consumes Task 3 (`vapidAuthHeader`, `encryptPayload`, `subscriptionIsDead`), Task 4's model, Task 6's `arrivalDetails`, and the existing `reachableAreas` / `arrivalsSince`. Produces the pure `dueNotifications(input): Outgoing[]`, `quietNow(prefs, at): boolean`, and `sweep(): Promise<number>`.

- [ ] **Step 1: Write the failing test**

```ts
it("sends one notification per arrival when bundling is off", () => {
  expect(dueNotifications({ areas: [{ area: "donations", items: [a(1), a(2)] }], prefs: OFF })).toHaveLength(2);
});
it("collapses a burst, so a bulk import cannot send two hundred", () => {
  const items = Array.from({ length: 47 }, (_, i) => a(i));
  const out = dueNotifications({ areas: [{ area: "donations", items }], prefs: OFF });
  expect(out).toHaveLength(1);
  expect(out[0].body).toContain("47 new");
});
it("leaves a normal busy minute alone", () => {
  expect(dueNotifications({ areas: [{ area: "donations", items: Array.from({ length: 20 }, (_, i) => a(i)) }], prefs: OFF })).toHaveLength(20);
});
it("sends one covering note when bundling is on", () => {
  expect(dueNotifications({ areas: [{ area: "donations", items: [a(1), a(2)] }], prefs: { ...OFF, bundle: true } })).toHaveLength(1);
});
it("sends nothing for an area the person has switched off", () => {
  expect(dueNotifications({ areas: [{ area: "donations", items: [a(1)] }], prefs: { ...OFF, areasOff: ["donations"] } })).toEqual([]);
});
it("drops a quiet-hours arrival rather than holding it", () => {
  expect(quietNow({ ...OFF, quietFrom: "23:00", quietTo: "07:00" }, at("2026-11-12T02:00:00Z"))).toBe(true);
  expect(quietNow({ ...OFF, quietFrom: "23:00", quietTo: "07:00" }, at("2026-11-12T12:00:00Z"))).toBe(false);
});
```

- [ ] **Step 2: Run it and watch it fail**
- [ ] **Step 3: Implement `src/admin/notify.ts`** — the pure decisions above. The burst cap is `> 20` per person per sweep.
- [ ] **Step 4: Implement the runner.** `sweep()` walks each subscription's owner, reads permissions **fresh** (Review Focus 3), asks `arrivalDetails` per reachable area since that person's cursor, claims the cursor with Task 4's `claimCursor` before sending (Review Focus 2), and POSTs with `fetch` using Task 3's header and body. A `410`/`404` deletes the subscription (Review Focus 1); anything else increments `failures`. `src/app.ts` starts a 60-second interval **only** when `pushIsConfigured(config)`, so a developer without keys sees nothing rather than a crash loop.
- [ ] **Step 5: Run the tests** — PASS
- [ ] **Step 6: Cucumber** — a signed-in admin POSTs a subscription and reads it back; an unauthenticated POST is 401.
- [ ] **Step 7: Commit** — `feat: sweep the New-pill arrivals every minute and push them to phones`

---

### Task 8: The service worker, and landing where the notification points

**Files:** Create `assets/js/admin/admin-sw.js`. Modify `src/routes/site.ts`, `assets/js/admin/app.js`. Test `test/unit/admin-sw.test.ts`.

**Interfaces:** Produces a worker at `/admin-sw.js` served with `Service-Worker-Allowed: /admin`.

- [ ] **Step 1: Write the failing test**

```ts
it("is served from the root so it can control /admin", () => {
  expect(siteRoutes).toContain('"/admin-sw.js"');
  expect(siteRoutes).toContain('"Service-Worker-Allowed", "/admin"');
});
it("shows what the push said and opens the admin where it points", () => {
  const sw = readFileSync(resolve(ROOT, "assets/js/admin/admin-sw.js"), "utf8");
  expect(sw).toContain('addEventListener("push"');
  expect(sw).toContain('addEventListener("notificationclick"');
  expect(sw).toContain("clients.openWindow");
});
it("remembers where it was going across a sign-in", () => {
  expect(app).toContain('params.get("area")');
  expect(app).toContain("selectView(");
});
```

- [ ] **Step 2: Run it and watch it fail**
- [ ] **Step 3: Write the worker and serve it.** It reads `event.data.json()` as `{ title, body, area, tag }` and calls `showNotification` with the 192px icon; `notificationclick` focuses an open admin window or opens `/admin?area=<area>`. A worker under `/assets/` cannot control `/admin`, so this one file is served at `/admin-sw.js` with the `Service-Worker-Allowed` header.
- [ ] **Step 4: Add the landing.** The admin has no URL routing at all today, so this is the whole of it: on load, read `?area=`, hold it across sign-in if a password is needed (Review Focus 5), then `selectView` it and strip the query with `history.replaceState`. **Section-level only** — not the individual record.
- [ ] **Step 5: Register the worker** after a successful sign-in, guarded by `"serviceWorker" in navigator`.
- [ ] **Step 6: Run the tests** — PASS
- [ ] **Step 7: Commit** — `feat: a service worker for the admin, and a notification lands on its section`

---

### Task 9: Turning it on, from the admin

**Files:** Create `src/routes/admin-push.ts`. Modify `admin.html`, `assets/js/admin/app.js`, `assets/css/admin.css`, `src/app.ts`. Test `test/unit/admin-notifications-screen.test.ts`.

**Interfaces:** Produces `GET /api/admin/push/key`, `GET|POST|DELETE /api/admin/push/subscription`, `GET|PUT /api/admin/push/prefs`, authorised with `authorizeAny` exactly as `src/routes/admin-whats-new.ts` does.

- [ ] **Step 1: Write the failing test**

```ts
it("warns, before it asks, that iOS only asks once", () => {
  const view = doc.getElementById("view-notifications");
  expect(view?.textContent).toMatch(/only asks once/i);
  expect(view?.textContent).toMatch(/delete the icon.*add it again/i);
});
it("says what pressing it does", () => {
  expect(doc.getElementById("pushEnable")?.textContent?.trim()).toBe("Turn on notifications for this phone");
});
it("tells an iPhone user to pin it first, because a tab cannot be notified", () => {
  expect(app).toContain("display-mode: standalone");
  expect(app).toMatch(/Add to Home Screen/i);
});
it("offers the calm-down switches, off by default", () => {
  expect(doc.getElementById("pushBundle")?.hasAttribute("checked")).toBe(false);
  expect(doc.getElementById("pushQuietFrom")).not.toBeNull();
});
it("lists each area so one can be switched off on its own", () => {
  expect(app).toContain("AREAS");
  expect(app).toContain("areasOff");
});
```

- [ ] **Step 2: Run it and watch it fail**
- [ ] **Step 3: Build the routes** and mount them in `src/app.ts`.
- [ ] **Step 4: Build the card** — a Notifications section with the warning *above* the button, per-area switches, and the bundle/quiet controls. On tap: `Notification.requestPermission()` then `pushManager.subscribe` with the key from `/api/admin/push/key`. If not running standalone on iOS, say to pin it first instead of asking.
- [ ] **Step 5: Run the tests** — PASS
- [ ] **Step 6: Commit** — `feat: turn notifications on for this phone, and choose what buzzes`

---

### Task 10: README, review, ship

- [ ] **Step 1: Document it** — a "The admin as a phone app" section: installing it, that iOS asks once, the three config values, the 30-day installed session, the burst cap, and that the sweep runs every 60 seconds only when the keys are set.
- [ ] **Step 2: Run everything** — `npm run lint && npm run build && npm run test:unit`. The Windows-only `perf-budget` and `footer-master` failures are expected locally; CI is the truth.
- [ ] **Step 3: Whole-branch review** by a fresh reviewer, fixes applied.
- [ ] **Step 4: Check the migration still sorts last against `main`, then `/ship`.**
