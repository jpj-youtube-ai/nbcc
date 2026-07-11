# Admin Management — Phase 3: Mandatory Email 2FA on Login

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Every admin login requires a one-time code emailed to the user (mandatory), unless the browser is a trusted device (remembered for 30 days). No authenticator app, no enrolment.

**Architecture:** Two-step login. Step 1 (`POST /api/admin/login`, email+password) verifies the password/status as today, then: if the request carries a valid 30-day **device token** for this user, issue the session immediately; otherwise generate a 6-digit code, store its keyed hash in `admin_login_codes` (one active code per user, upserted), email it, and respond `200 { step: "2fa" }` (no session yet). Step 2 (`POST /api/admin/login/2fa`, email+code+remember) verifies the code (expiry + attempt cap + keyed-hash compare), issues the session, and — if "remember this device" — returns a signed device token the front-end stores in `localStorage` and replays on future logins. Device tokens and code hashes reuse `ADMIN_SESSION_SECRET` (domain-separated), so no new secret. The device token replaces only the *second factor*; the password is always required, so a stolen device token alone grants nothing.

**Stub safety (critical):** the email client stubs (no network) outside production when `EMAIL_SEND_URL` is a placeholder. So on staging, the code may not actually be delivered. Step 1 therefore includes the code in its JSON response **only when the email client is stubbed** (`emailStubbed === true`, which is always false in production) — so admins can complete 2FA on staging even without live email, while production always emails it and never exposes it.

**Tech Stack:** Express + TS, node crypto (HMAC), pg, Zod, Vitest, Cucumber, classic-script admin JS. No new deps, no new config secret.

## Global Constraints
- Additive migration only (new `admin_login_codes` table).
- No new config/secret; sign device tokens + keyed-hash codes with `config.ADMIN_SESSION_SECRET`, each with a distinct HMAC domain prefix (mirror `src/admin/tokens.ts`'s `ACTION_TOKEN_DOMAIN`).
- Mandatory: a non-trusted login MUST go through the code step; there is no way to skip 2FA except a valid device token.
- Rate-limit step 1 (per email/IP) and step 2 (per email/IP); cap code attempts (5) and expire codes (10 min).
- Never log codes, code hashes, or device tokens. Constant-time compare for code + token verification.
- The code is exposed in the response ONLY when `emailStubbed` is true (never in production).
- Green PR + tests; README updated.

## Data model (additive migration)
`admin_login_codes`: `user_id int PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE`, `code_hash text NOT NULL`, `expires_at timestamptz NOT NULL`, `attempts int NOT NULL DEFAULT 0`. One row per user (the latest challenge), upserted on each step-1.

---

### Task 1: 2FA code + device-token crypto (pure)
**Files:** Create `src/admin/two-factor.ts`, `test/unit/admin-two-factor.test.ts`.
**Produces:**
- `generateLoginCode(): string` — a 6-digit numeric string, cryptographically random (`crypto.randomInt(0, 1_000_000)` zero-padded). (Not pure/deterministic — test only its shape: 6 digits.)
- `hashLoginCode(code: string, secret: string): string` — `hmacSha256("admincode.v1:" + code)` base64url. Keyed so a DB leak of `code_hash` can't be brute-forced offline without the secret.
- `verifyLoginCode(code: string, hash: string, secret: string): boolean` — constant-time compare of `hashLoginCode(code, secret)` vs `hash`.
- `ADMIN_DEVICE_TTL_MS = 30*24*3600_000`.
- `issueDeviceToken({ sub, now, secret, ttlMs? }): string` and `verifyDeviceToken(token, secret, now): { sub: number } | null` — same base64url(claims).hmac shape as `src/admin/session.ts`, with HMAC domain prefix `"admindevice.v1:"` and claims `{ sub, purpose: "device", iat, exp }`. Returns null (not throw) on malformed/bad-sig/expired.
- [ ] TDD: code is 6 digits; hash/verify round-trips + wrong code fails + wrong secret fails; device token round-trips, rejects tamper/expiry/wrong-secret; a session token (no domain prefix) does NOT verify as a device token.
- [ ] Implement (read `src/admin/session.ts` + `src/admin/tokens.ts` for the HMAC shape + domain-prefix pattern); commit `[TASK-188] phase3: 2FA code + device-token crypto`.

### Task 2: login-code storage
**Files:** Create `migrations/<ts>_admin-login-codes.js`; add to `src/db/admin-users.ts` (or a new `src/db/login-codes.ts`).
- [ ] Migration: create `admin_login_codes` as above; down drops it.
- [ ] `upsertLoginCode(userId, codeHash, expiresAt): Promise<void>` — INSERT ... ON CONFLICT (user_id) DO UPDATE SET code_hash, expires_at, attempts=0.
- [ ] `getLoginCode(userId): Promise<{ code_hash: string; expires_at: Date; attempts: number } | null>`.
- [ ] `bumpLoginCodeAttempts(userId): Promise<number>` — `UPDATE ... SET attempts = attempts + 1 RETURNING attempts`.
- [ ] `deleteLoginCode(userId): Promise<void>`.
- [ ] build clean; commit `[TASK-188] phase3: login-code table + store`.

### Task 3: email the login code (+ stub flag)
**Files:** `src/clients/email.ts`.
- [ ] Export `emailStubbed = useStub` (the existing module-level boolean) so the login handler can tell when the code won't actually be delivered.
- [ ] `sendAdminLoginCode({ email, fullName, code }): Promise<void>` — mirror `sendAdminInvite` exactly (same stub-seam + best-effort). Subject/body: "Your NBCC admin sign-in code is <code>" (no em-dashes). Build clean; commit `[TASK-188] phase3: login-code email + stub flag`.

### Task 4: two-step login flow
**Files:** `src/routes/admin.ts` (`postLogin` + new `postLoginTwoFactor`), `src/app.ts` (mount the 2fa route if new router), `src/admin/user-schema.ts` (a `twoFactorSchema`). Update the existing login test.
**Behaviour:**
- Step 1 `POST /api/admin/login` `{ email, password, deviceToken? }`:
  1. Verify password + `status` (as Phase 1: disabled/invited → generic 401). Unchanged timing/anti-enumeration.
  2. If `deviceToken` present and `verifyDeviceToken(deviceToken, secret, now)?.sub === user.id` → issue the session token exactly as today, `touchLastLogin`, return `{ token, user }` (2FA skipped — trusted device).
  3. Else: `const code = generateLoginCode()`; `upsertLoginCode(user.id, hashLoginCode(code, secret), now+10min)`; best-effort `sendAdminLoginCode(...)`; return `200 { step: "2fa", email, devCode: emailStubbed ? code : undefined }`. (devCode is ONLY set when email is stubbed — never in production.)
- Step 2 `POST /api/admin/login/2fa` `{ email, code, remember? }` (rate-limited):
  1. Look up the user by email + `getLoginCode(user.id)`. Missing or `expires_at <= now` → 401 generic. 
  2. `bumpLoginCodeAttempts`; if the returned count > 5 → `deleteLoginCode` + 401.
  3. `verifyLoginCode(code, row.code_hash, secret)` false → 401.
  4. Success: `deleteLoginCode(user.id)`, `touchLastLogin`, issue the session token. If `remember` → also `deviceToken = issueDeviceToken({ sub: user.id, now, secret })`. Return `{ token, user, deviceToken? }`.
- Rate-limit both endpoints (reuse `createRateLimiter`, per email + per IP).
- [ ] TDD: extend the login test — password ok + no device → `{ step: "2fa" }` (+ devCode when the email client is stubbed in the test env); a valid device token → session directly (no code); step 2 with the right code → session; wrong code → 401 and increments attempts; 6th attempt → 401; expired code → 401; `remember` → returns a deviceToken that verifies. Mock the db + email + (for devCode) `emailStubbed`.
- [ ] commit `[TASK-188] phase3: two-step email-code login + trusted device`.

### Task 5: front-end login 2FA step
**Files:** `admin.html` (login card), `assets/js/admin/app.js`.
- [ ] The login form: on submit, POST step 1 with `{ email, password, deviceToken: localStorage["nbcc_admin_device"] || undefined }`. If the response is `{ token }` → proceed as today. If `{ step: "2fa" }` → reveal a **code entry** panel (a 6-digit input + a "Remember this device for 30 days" checkbox + Verify button; and, when `devCode` is present because email is stubbed, show a small note "Email delivery is off in this environment. Your code is <devCode>."). Verify → POST step 2 `{ email, code, remember }`; on success store `token` as today and, if a `deviceToken` came back, `localStorage.setItem("nbcc_admin_device", deviceToken)`. Show errors inline (honest-save; wrong code stays on the code panel).
- [ ] Escape everything; no em-dashes; mirror the existing `.admin-login-*` styles. If ids change, update `test/unit/admin-shell.test.ts` (the login form assertions).
- [ ] full gate green; commit `[TASK-188] phase3: login 2FA code step + remember device`.

### Task 6: BDD + README
- [ ] `features/admin-2fa.feature` (`@db` where needed): login with correct password returns step:2fa and emails/exposes a code; wrong code 401; correct code issues a session; a valid device token skips the code; too many wrong codes lock the attempt. Reuse existing step style.
- [ ] README: document mandatory email 2FA, the two-step flow, the 30-day trusted device, and the stub-safe dev code on non-production.
- [ ] full `npm run lint && build && test:unit` green; commit `[TASK-188] phase3: BDD + README`.

## Self-Review
Covers: crypto (T1), storage (T2), email+stub-flag (T3), two-step flow with trusted-device + stub-safe dev code (T4), UI (T5), tests/docs (T6). Mandatory (no skip except device token); password always required; rate-limited + attempt-capped + expiring codes; keyed hashes; domain-separated tokens; no new secret; additive migration. Security-review focus for the final pass: can 2FA be bypassed (e.g. step 2 reached without step 1, a forged/replayed device token, a device token for user A accepted for user B, code brute-force within the attempt cap, the devCode leaking in production), and no code/token logging.
