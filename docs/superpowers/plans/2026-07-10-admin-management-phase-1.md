# Admin Management — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin manage who can sign in to `/admin` — invite, remove, disable, and set each person's role — from the UI (no more migrations), and let users recover access via self-service and admin-initiated password resets.

**Architecture:** Extends the existing admin auth (the `users` table in the main DB, `findUserByEmail`, `signAdminSession`/`verifyAdminSession`, `authorizeAdmin`, the `POST /api/admin/login` handler) rather than replacing it. New user-management routes are `admin`-role-gated. Invite/reset links are stateless, purpose-scoped, short-lived HMAC tokens that mirror the donor magic-link pattern (`src/portal/tokens.ts`) and are single-use by binding to the user's current `password_hash`. Every user-management write appends an `audit_log` row in the same transaction via the existing `writeWithAudit` truth-model.

**Tech Stack:** Express + TypeScript, node crypto (HMAC/scrypt — no new deps), pg, Zod, Vitest, Cucumber. Classic-script admin front-end (`assets/js/admin/app.js` + `helpers.js`).

## Global Constraints

- **Additive migration only** (golden rule 2): new columns on `users` are nullable or defaulted; no destructive change.
- **No new config secret.** Invite/reset tokens sign with the existing `config.ADMIN_SESSION_SECRET`; links build on the existing `config.PORTAL_BASE_URL` (the public site base). No `process.env` outside the config module.
- **Every user-management write is audited** in one transaction via `writeWithAudit` (from `src/db/donations.ts`), actor = the acting admin's email (`admin:<email>`), mirroring the existing `actorOf` in `src/routes/admin.ts`.
- **Roles stay `viewer` / `editor` / `admin`** in Phase 1. The per-section view/edit matrix is **Phase 2** — do NOT refactor `authorizeAdmin` or the ~48 route call sites here.
- **Only the `admin` role** may reach `/api/admin/users*`. viewer/editor get 403.
- **Anti-lockout:** an admin cannot demote, disable, or delete the **last** enabled admin.
- **No account enumeration** on the public `/api/admin/forgot` endpoint (uniform response whether or not the email exists).
- **Passwords** are hashed with the existing scrypt helper in `src/admin/password.ts` (read it; reuse `hashPassword`/`verifyPassword` exactly as `postLogin` does). Never log a password, hash, or token.
- **Green PR with tests; README updated in the same PR** (golden rules 1, 7).

## File Structure

**Create:**
- `migrations/<ts>_admin-user-lifecycle.js` — additive columns on `users`.
- `src/admin/tokens.ts` — purpose-scoped invite/reset HMAC tokens (mirror `src/portal/tokens.ts`).
- `src/admin/user-schema.ts` — Zod schemas for invite + patch.
- `src/db/admin-users.ts` — user CRUD + last-admin guard, all via `pool` / `writeWithAudit`.
- `src/routes/admin-users.ts` — the `/api/admin/users*` + forgot/invite/reset endpoints (mounted in `src/app.ts`), OR a clearly-delimited block appended to `src/routes/admin.ts` (follow whichever the reviewer prefers; this plan uses a new file).
- `set-password.html` — the standalone invite/reset set-password page (mirrors `portal.html`'s standalone style).
- Tests: `test/unit/admin-tokens.test.ts`, `test/unit/admin-user-schema.test.ts`, `test/unit/admin-users-guard.test.ts`, `features/admin-users.feature`.

**Modify:**
- `src/routes/admin.ts` — `postLogin`: stamp `last_login_at`, reject `disabled`/`invited` accounts.
- `src/app.ts` — mount the new router; add `/invite`, `/reset` clean routes (or via `_redirects`).
- `admin.html` + `assets/js/admin/app.js` — the admin-only **Team** view.
- `README.md` — document the new routes, the Team tab, and the invite/reset flow.
- `.env.example` / `pr.yml` — no change (no new config).

---

### Task 1: User-lifecycle columns (additive migration)

**Files:**
- Create: `migrations/<ts>_admin-user-lifecycle.js`
- Test: applied by CI `npm run migrate`; no unit test (DB migration).

**Interfaces:**
- Produces on `users`: `status` (`invited`|`active`|`disabled`, default `active`), `invited_at timestamptz`, `last_login_at timestamptz`.

- [ ] **Step 1: Generate the migration**

Run: `npx node-pg-migrate create admin-user-lifecycle`
Expected: prints `migrations/<timestamp>_admin-user-lifecycle.js`.

- [ ] **Step 2: Write the migration** (additive only — existing rows default to `active` so current admins keep working)

```js
/* eslint-disable */
// Admin management Phase 1: give admin `users` a lifecycle (invited -> active, or disabled)
// plus an invited_at / last_login_at stamp. Additive only (golden rule 2): every existing
// row defaults to status='active', so current admins keep signing in unchanged.
exports.shorthands = undefined;
exports.up = (pgm) => {
  pgm.addColumns("users", {
    status: { type: "text", notNull: true, default: "active" }, // invited | active | disabled
    invited_at: { type: "timestamptz" },
    last_login_at: { type: "timestamptz" },
  });
  pgm.addConstraint("users", "users_status_check", {
    check: "status IN ('invited', 'active', 'disabled')",
  });
};
exports.down = (pgm) => {
  pgm.dropConstraint("users", "users_status_check");
  pgm.dropColumns("users", ["status", "invited_at", "last_login_at"]);
};
```

- [ ] **Step 3: Apply locally (if a local DB is reachable) + build**

Run: `npm run migrate` (skip if no local DB — CI applies it) then `npm run build`.
Expected: migration applies; tsc clean.

- [ ] **Step 4: Commit**

```bash
git add migrations
git commit -m "[TASK-NNN] admin mgmt: user lifecycle columns (status, invited_at, last_login_at)"
```

---

### Task 2: Invite/reset tokens

**Files:**
- Create: `src/admin/tokens.ts`
- Test: `test/unit/admin-tokens.test.ts`

**Interfaces:**
- Consumes: `config.ADMIN_SESSION_SECRET`, `config.PORTAL_BASE_URL`.
- Produces:
  - `issueAdminActionToken(input: { sub: number; purpose: "invite" | "reset"; bind: string; now: Date; ttlMs?: number; secret: string }): string`
  - `verifyAdminActionToken(token: string, secret: string, now: Date): { sub: number; purpose: "invite" | "reset"; bind: string }` (throws `AdminActionTokenError` with reason `malformed`/`bad_signature`/`expired`).
  - `ADMIN_INVITE_TTL_MS = 48*3600_000`, `ADMIN_RESET_TTL_MS = 60*60_000`.
  - `adminActionLink(baseUrl: string, path: "/invite" | "/reset", token: string): string`.
- `bind` is the user's current `password_hash ?? ""` at issue time; verification is re-checked against the live row by the caller so a completed invite/used reset link stops working (single-use).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { issueAdminActionToken, verifyAdminActionToken, AdminActionTokenError, adminActionLink } from "../../src/admin/tokens";

const secret = "test-secret";
const now = new Date("2026-07-10T12:00:00Z");

describe("admin action tokens", () => {
  it("round-trips an invite token", () => {
    const t = issueAdminActionToken({ sub: 7, purpose: "invite", bind: "", now, secret });
    expect(verifyAdminActionToken(t, secret, now)).toEqual({ sub: 7, purpose: "invite", bind: "" });
  });
  it("rejects a tampered token", () => {
    const t = issueAdminActionToken({ sub: 7, purpose: "reset", bind: "h", now, secret });
    expect(() => verifyAdminActionToken(t + "x", secret, now)).toThrow(AdminActionTokenError);
  });
  it("rejects the wrong secret", () => {
    const t = issueAdminActionToken({ sub: 7, purpose: "reset", bind: "h", now, secret });
    expect(() => verifyAdminActionToken(t, "other", now)).toThrow(/bad_signature/);
  });
  it("expires", () => {
    const t = issueAdminActionToken({ sub: 7, purpose: "reset", bind: "h", now, ttlMs: 1000, secret });
    expect(() => verifyAdminActionToken(t, secret, new Date(now.getTime() + 2000))).toThrow(/expired/);
  });
  it("builds a link", () => {
    expect(adminActionLink("https://nbcc.scot", "/invite", "TOK")).toBe("https://nbcc.scot/invite?token=TOK");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/admin-tokens.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement, mirroring `src/admin/session.ts`'s HMAC shape**

Read `src/admin/session.ts` and `src/portal/tokens.ts` first, then create `src/admin/tokens.ts`:

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

// Purpose-scoped, short-lived, stateless HMAC token for the admin invite + password-reset links
// (Phase 1). Same shape as src/admin/session.ts: base64url(claims).base64url(hmacSha256(claims)),
// signed with ADMIN_SESSION_SECRET. The `purpose` claim means an invite token can never be replayed
// as a session or a reset. `bind` is the user's password_hash at issue time; the caller re-checks it
// against the live row so a link stops working once the password has been set/changed (single-use).

export const ADMIN_INVITE_TTL_MS = 48 * 60 * 60 * 1000;
export const ADMIN_RESET_TTL_MS = 60 * 60 * 1000;

export interface AdminActionClaims {
  sub: number;
  purpose: "invite" | "reset";
  bind: string;
  iat: number;
  exp: number;
}

export class AdminActionTokenError extends Error {
  constructor(public readonly reason: "malformed" | "bad_signature" | "expired") {
    super(`admin action token invalid: ${reason}`);
    this.name = "AdminActionTokenError";
  }
}

function b64url(s: string): string {
  return Buffer.from(s, "utf8").toString("base64url");
}
function signBody(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

export function issueAdminActionToken(input: {
  sub: number;
  purpose: "invite" | "reset";
  bind: string;
  now: Date;
  ttlMs?: number;
  secret: string;
}): string {
  const iat = input.now.getTime();
  const ttl = input.ttlMs ?? (input.purpose === "invite" ? ADMIN_INVITE_TTL_MS : ADMIN_RESET_TTL_MS);
  const claims: AdminActionClaims = { sub: input.sub, purpose: input.purpose, bind: input.bind, iat, exp: iat + ttl };
  const body = b64url(JSON.stringify(claims));
  return `${body}.${signBody(body, input.secret)}`;
}

export function verifyAdminActionToken(
  token: string,
  secret: string,
  now: Date,
): { sub: number; purpose: "invite" | "reset"; bind: string } {
  const parts = (token ?? "").split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new AdminActionTokenError("malformed");
  const [body, sig] = parts;
  const expected = signBody(body, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new AdminActionTokenError("bad_signature");
  let claims: AdminActionClaims;
  try {
    claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as AdminActionClaims;
  } catch {
    throw new AdminActionTokenError("malformed");
  }
  if (typeof claims.exp !== "number" || claims.exp <= now.getTime()) throw new AdminActionTokenError("expired");
  return { sub: claims.sub, purpose: claims.purpose, bind: claims.bind };
}

export function adminActionLink(baseUrl: string, path: "/invite" | "/reset", token: string): string {
  return `${baseUrl.replace(/\/$/, "")}${path}?token=${encodeURIComponent(token)}`;
}
```

- [ ] **Step 4: Run test + build** — `npx vitest run test/unit/admin-tokens.test.ts` PASS; `npm run build` clean.
- [ ] **Step 5: Commit** — `[TASK-NNN] admin mgmt: invite/reset action tokens`.

---

### Task 3: User CRUD + last-admin guard (DB layer)

**Files:**
- Create: `src/db/admin-users.ts`
- Test: `test/unit/admin-users-guard.test.ts` (the pure guard); the DB functions are exercised by the BDD in Task 8 (DB-bound, mirroring `src/db/admin.ts`).

**Interfaces:**
- Consumes: `pool` (`src/db/pool.ts`), `writeWithAudit` (`src/db/donations.ts`).
- Produces:
  - `type ManagedUser = { id: number; email: string; full_name: string; role: string; status: string; invited_at: Date | null; last_login_at: Date | null }` (never includes `password_hash`).
  - `listUsers(): Promise<ManagedUser[]>` — all users, newest first.
  - `getManagedUser(id: number): Promise<ManagedUser | null>`
  - `inviteUser(input: { email: string; full_name: string; role: string }, actor: string): Promise<{ id: number }>` — inserts `status='invited'`, `password_hash=NULL`, `invited_at=now()`; audited `admin_user.invited`. Throws `DuplicateEmailError` on a unique-violation.
  - `setUserRole(id: number, role: string, actor: string): Promise<ManagedUser | null>` — audited `admin_user.role_changed`.
  - `setUserStatus(id: number, status: "active" | "disabled", actor: string): Promise<ManagedUser | null>` — audited `admin_user.status_changed`.
  - `deleteUser(id: number, actor: string): Promise<boolean>` — audited `admin_user.removed`.
  - `setUserPassword(id: number, passwordHash: string, actor: string, action: "admin_user.activated" | "admin_user.password_reset"): Promise<void>` — sets `password_hash`, `status='active'`; audited.
  - `touchLastLogin(id: number): Promise<void>` — sets `last_login_at=now()` (no audit).
  - `countEnabledAdmins(): Promise<number>` — `role='admin' AND status!='disabled'`.
  - `isLastEnabledAdmin(target: ManagedUser, change: "demote" | "disable" | "delete"): Promise<boolean>` — pure-ish guard (queries count); true when the change would drop the enabled-admin count to zero.
  - `class DuplicateEmailError extends Error`.

- [ ] **Step 1: Write the failing guard test** (the pure decision, DB-mocked)

```ts
import { describe, it, expect, vi } from "vitest";
vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn() } }));
import { wouldOrphanAdmins } from "../../src/db/admin-users";

describe("last-admin guard", () => {
  const admin = { id: 1, email: "a@x", full_name: "A", role: "admin", status: "active", invited_at: null, last_login_at: null };
  const editor = { ...admin, id: 2, role: "editor" };
  it("blocks removing the only enabled admin", () => {
    expect(wouldOrphanAdmins(admin, "delete", 1)).toBe(true);
    expect(wouldOrphanAdmins(admin, "disable", 1)).toBe(true);
    expect(wouldOrphanAdmins(admin, "demote", 1)).toBe(true);
  });
  it("allows when another admin remains", () => {
    expect(wouldOrphanAdmins(admin, "delete", 2)).toBe(false);
  });
  it("ignores non-admins", () => {
    expect(wouldOrphanAdmins(editor, "delete", 1)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run test/unit/admin-users-guard.test.ts` FAIL (module missing).

- [ ] **Step 3: Implement `src/db/admin-users.ts`.** Extract the guard decision as a **pure** exported function `wouldOrphanAdmins(target, change, enabledAdminCount)` so it is unit-testable without a DB; the DB helpers call `countEnabledAdmins()` and pass the count in. Mirror `src/db/admin.ts`'s `writeWithAudit` usage for every mutating function (actor threaded through, one audit row per write). Return `ManagedUser` shapes (never select `password_hash` into the returned object). Full code (write it; do not abbreviate) covering all Interfaces above — model the SQL and the `writeWithAudit` calls on `submitClaimBatch`/`markGasdsClaimed` in `src/db/admin.ts`, and the `pg` unique-violation handling (`err.code === "23505"` → `DuplicateEmailError`).

- [ ] **Step 4: Run test + build** — guard test PASS; `npm run build` clean.
- [ ] **Step 5: Commit** — `[TASK-NNN] admin mgmt: user CRUD + last-admin guard (audited)`.

---

### Task 4: Request schemas (Zod)

**Files:**
- Create: `src/admin/user-schema.ts`
- Test: `test/unit/admin-user-schema.test.ts`

**Interfaces:**
- Produces:
  - `inviteSchema` — `{ email: string(email, ≤254), fullName: string(1..120), role: enum(viewer|editor|admin) }`.
  - `userPatchSchema` — `.strict()`, `{ role?: enum(...); status?: enum(active|disabled) }`, refine at least one field.
  - `setPasswordSchema` — `{ token: string(min 1), password: string(min 10, max 200) }`.
  - `forgotSchema` — `{ email: string(email) }`.

- [ ] **Step 1: failing test** — accept valid, reject bad email, reject empty patch, reject a <10-char password, reject a bad role. (Write the cases in full, mirroring `test/unit/contact-schema.test.ts`.)
- [ ] **Step 2: run → FAIL.**
- [ ] **Step 3: implement** the four Zod schemas with the exact bounds above.
- [ ] **Step 4: run → PASS; build clean.**
- [ ] **Step 5: Commit** — `[TASK-NNN] admin mgmt: user request schemas`.

---

### Task 5: Admin user-management routes (admin-only)

**Files:**
- Create: `src/routes/admin-users.ts`
- Modify: `src/app.ts` (mount `adminUsersRouter`)
- Test: `test/unit/admin-users-routes.test.ts`

**Interfaces:**
- Consumes: `authorizeAdmin` (import from `src/routes/admin.ts` — export it if not already), the Task 3 db layer, the Task 4 schemas, `hashPassword` from `src/admin/password.ts`, the email client (`src/clients/email.ts`), `issueAdminActionToken`/`adminActionLink` (Task 2), `config`, `createRateLimiter`.
- Produces (all gated to `admin` role except the two public ones):
  - `GET /api/admin/users` → `{ results: ManagedUser[] }`.
  - `POST /api/admin/users` → invite: create invited user, issue an `invite` token bound to `""`, email `adminActionLink(PORTAL_BASE_URL, "/invite", token)`, return `201 { id }`. Duplicate email → 409.
  - `PATCH /api/admin/users/:id` → role/status change, **guarded** (`wouldOrphanAdmins` → 409 `{ error: "last_admin" }`), audited → updated `ManagedUser` or 404.
  - `DELETE /api/admin/users/:id` → guarded delete → `{ deleted: true }` or 404.
  - `POST /api/admin/users/:id/reset` → issue a `reset` token bound to the user's current `password_hash`, email the reset link, `200 { sent: true }`.
  - `POST /api/admin/forgot` (public, rate-limited, uniform response) → if the email maps to an enabled user, email a reset link; always `200 { ok: true }`.
  - `POST /api/admin/set-password` (public) → `{ token, password }`: verify the action token, re-check `bind === user.password_hash ?? ""` (single-use), hash the new password, `setUserPassword`, `200 { ok: true }`. Invalid/expired/used → 400.

- [ ] **Step 1: Read the auth + login + email patterns first.** Read `src/routes/admin.ts` (`authorizeAdmin`, `actorOf`, `postLogin`, how `hashPassword`/`verifyPassword` from `src/admin/password.ts` are used), and `src/clients/email.ts` (the send function signature) so the invite/reset emails are sent exactly like the newsletter/thank-you sends. Export `authorizeAdmin` from `admin.ts` if it is not already exported.

- [ ] **Step 2: Write the failing route test** mirroring `test/unit/admin-contact-routes.test.ts`: mock the db layer + the email client, authenticate with a real `admin`-role signed session (copy the auth setup from `test/unit/admin-stories-api.test.ts`). Assert: non-admin (editor token) → 403 on every `/users` route; invite calls `inviteUser` + sends an email; PATCH that would orphan admins → 409; `set-password` with a good token calls `setUserPassword`; `forgot` returns 200 for both known and unknown email and only sends when known.

- [ ] **Step 3: run → FAIL.**

- [ ] **Step 4: Implement `src/routes/admin-users.ts`.** Full handlers per Interfaces. Use `const claims = authorizeAdmin(req, res, "admin"); if (!claims) return;` for the gated routes and `actorOf(claims)` as the audit actor. Rate-limit `/forgot` and `/set-password` with `createRateLimiter`. Never log tokens/passwords. Mount `app.use(adminUsersRouter)` in `src/app.ts` next to the other routers.

- [ ] **Step 5: run test + build + lint → all pass. Commit** — `[TASK-NNN] admin mgmt: user-management + forgot/reset endpoints`.

---

### Task 6: Login stamps last-login and rejects disabled/invited

**Files:**
- Modify: `src/routes/admin.ts` (`postLogin`)
- Test: extend the existing login test (find it: `test/unit/admin-*.test.ts` covering `postLogin`)

**Interfaces:**
- Consumes: `touchLastLogin`, and the user's `status` (add it to `findUserByEmail`'s select + `AdminUserRow`).

- [ ] **Step 1:** Add `status` to `AdminUserRow` and the `findUserByEmail` SELECT in `src/db/admin.ts`.
- [ ] **Step 2: failing test** — a `disabled` user with a correct password gets 401 (not a session); a successful login calls `touchLastLogin`. (Mock the db; mirror the existing login test.)
- [ ] **Step 3: run → FAIL.**
- [ ] **Step 4: implement** — in `postLogin`, after the password verifies, reject when `status === "disabled" || status === "invited"` (return the same generic 401 as a bad password — no enumeration), else `await touchLastLogin(user.id)` and issue the session as today.
- [ ] **Step 5: run → PASS; full `npm run test:unit`. Commit** — `[TASK-NNN] admin mgmt: block disabled/invited logins, stamp last_login`.

---

### Task 7: Set-password page (invite + reset accept)

**Files:**
- Create: `set-password.html`
- Modify: `_redirects` (`/invite` and `/reset` → `set-password.html`), `Dockerfile` (COPY `set-password.html`), `src/routes/site.ts` if needed (the `_redirects` loop already serves it).
- Test: covered by the BDD in Task 8 + the dockerfile-site-assets guard.

**Interfaces:** the page reads `?token=` from the URL and POSTs `{ token, password }` to `/api/admin/set-password`; on 200 it shows success + a link to `/admin`; on 400 it shows "this link has expired or already been used — ask an admin to re-send."

- [ ] **Step 1:** Create `set-password.html` — a standalone page (mirror `portal.html`'s standalone head + brand styling, no public nav): a password field + confirm, honest-save (success only on 200), inline error. Both `/invite` and `/reset` use this one page (the token's `purpose` differs but the accept flow is identical: set a password).
- [ ] **Step 2:** Add to `_redirects`: `/invite  /set-password.html  200` and `/reset  /set-password.html  200` (and the canonical `301!` lines); add `set-password.html` to the `Dockerfile` COPY list (the `dockerfile-site-assets` guard enforces this).
- [ ] **Step 3:** `npm run test:unit` (the dockerfile-site-assets + copy-rules guards must stay green) + `npm run build`.
- [ ] **Step 4: Commit** — `[TASK-NNN] admin mgmt: set-password page for invite/reset`.

---

### Task 8: Team view (admin front-end) + BDD + README

**Files:**
- Modify: `admin.html` (Team nav item + `#view-team`), `assets/js/admin/app.js` (`loadTeam` + actions), `README.md`
- Create: `features/admin-users.feature`
- Test: `features/admin-users.feature`; `test/unit/admin-shell.test.ts` (add `team` to the nav-order + view-exists assertions)

**Interfaces:** consumes `GET/POST/PATCH/DELETE /api/admin/users*`.

- [ ] **Step 1: admin.html** — add a nav item under a new **"Admin"** group (or the Governance group): `<li><button class="admin-nav-link" data-view="team">Team</button></li>`, and a `#view-team` section (intro + an invite form: email, name, role select, Invite button; + a `#teamTable`). Mirror the Stories/Contact view markup. Add `team` to `test/unit/admin-shell.test.ts`'s two nav arrays.
- [ ] **Step 2: app.js** — add `else if (name === "team") loadTeam();` to `selectView`; implement `loadTeam()` (GET `/api/admin/users` → table: Name, Email, Role select, Status, Last login, actions [Reset password, Disable/Enable, Remove]); wire the invite form (POST); wire role change (PATCH `{role}`), status toggle (PATCH `{status}`), reset (POST `/:id/reset`), remove (DELETE, with confirm). Use `H.escapeHtml` on every interpolated value; gate all write controls behind `H.roleCan(currentRole, "admin")`. Show a 409 `last_admin` error inline ("this is the last admin — promote someone else first"). This is DOM glue (not unit-tested); cross-check every id against admin.html in the report.
- [ ] **Step 3: features/admin-users.feature** — scenarios: invite a user (201 + an email would be sent); accept via set-password then log in; forgot-password returns 200 for unknown + known; admin disables a user and their login is blocked; a non-admin gets 403 from `/api/admin/users`; the last-admin guard returns 409. Mirror existing `features/*.feature` step style (`@db` where a real DB is needed).
- [ ] **Step 4: README** — document the Team tab, the invite/reset flow, the new `/api/admin/users*` + `/api/admin/forgot` + `/api/admin/set-password` routes, and the `/invite` /`/reset` pages.
- [ ] **Step 5:** `npm run lint && npm run build && npm run test:unit` all green. Commit — `[TASK-NNN] admin mgmt: Team view, BDD, README`.

---

## Self-Review

**Spec coverage (Phase 1 slice):** user management (invite/remove/disable/role) → Tasks 3, 5, 8 ✅; password resets self-service + admin → Tasks 2, 5, 7 ✅; audited writes → Task 3 ✅; anti-lockout → Tasks 3, 5 ✅; no-enumeration forgot → Task 5 ✅; additive migration → Task 1 ✅; login lifecycle → Task 6 ✅. **Deferred (documented):** the per-section view/edit matrix (Phase 2 — `authorizeAdmin` untouched here); email 2FA (Phase 3); audit *viewer* UI + "My account" (Phase 4). Roles stay viewer/editor/admin in Phase 1.

**Placeholder scan:** Task 3 Step 3 says "write it, do not abbreviate" for the full db layer rather than pasting every line — acceptable because the exact SQL/`writeWithAudit` shape is defined by the Interfaces block and modelled on named functions in `src/db/admin.ts`; every other code step shows full code. No TBD/TODO.

**Type consistency:** `ManagedUser` (Task 3) is consumed by Tasks 5/8 unchanged. `wouldOrphanAdmins(target, change, enabledAdminCount)` signature matches its test (Task 3) and caller (Task 5). Token functions (Task 2) match their callers in Task 5. `authorizeAdmin(req, res, "admin")` returns claims (per `admin.ts`) — Task 5 captures them. `AdminUserRow` gains `status` (Task 6) consumed by `postLogin`. Consistent. ✅

## Notes for the executor
- **Task order:** 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8. Task 5 needs 2+3+4; Task 6 needs 3; Task 8 needs 5.
- **Do NOT touch `authorizeAdmin` or the ~48 route call sites** — that is Phase 2 (the matrix).
- **Read before writing** in Tasks 5/6/8: `src/admin/password.ts`, `src/clients/email.ts`, `postLogin` in `admin.ts`, and the existing admin route tests for the auth-mock shape. Do not guess these.
- **No new config/secret.** If a task tries to add one, stop — reuse `ADMIN_SESSION_SECRET` + `PORTAL_BASE_URL`.
