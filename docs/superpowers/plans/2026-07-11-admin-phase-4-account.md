# Admin Management — Phase 4: My Account + Audit Visibility

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Let any signed-in admin manage their OWN account — change their display name and their password — and confirm the existing Audit view surfaces the admin-user events (invite, role/permission changes, resets, etc.) that Phases 1–3 already record.

**Architecture:** Small, self-service additions on top of the existing auth. `GET /api/admin/me` (already returns email + permissions) is extended to also return `fullName`. Two new self-only endpoints, gated by the existing `authorizeAny` (verifies the session + non-disabled user) and always acting on `claims.sub` (never an arbitrary id): `PATCH /api/admin/me` (own name) and `POST /api/admin/me/password` (own password, requires the current password). The audit trail already receives every `admin_user.*` event and the Audit view already lists `audit_log`, so Phase 4's audit work is verification + a self-password audit event, not new plumbing.

**Tech Stack:** Express + TS, pg, Zod, Vitest, Cucumber, classic-script admin JS. No new deps, no new config, no migration.

## Global Constraints
- Self-only: the /me write endpoints act on `claims.sub`, never an id from the body/path. A user can only change their OWN name/password here (managing others stays in the team-gated Team tab).
- Changing own password requires the CURRENT password (verify with the existing `verifyPassword`/`src/admin/password.ts`); new password min length matches the invite/reset rule (10).
- Audited via `writeWithAudit`: `admin_user.name_changed` and `admin_user.password_changed`, actor = `self:<email>`.
- Email is NOT self-editable (it's the login identity + audit actor); only an admin changes it via the Team tab. No change here.
- Never log passwords. No em-dashes in visible copy. Green PR + tests; README updated.

---

### Task 1: Self-account endpoints
**Files:** `src/routes/admin-users.ts` (or wherever `/api/admin/me` lives — grep for it), `src/admin/user-schema.ts`, `src/db/admin-users.ts`; `test/unit/admin-users-routes.test.ts`.
**Produces:**
- Extend `GET /api/admin/me` to include `fullName` (read from `getUserAuthRow` or a small getter that also selects `full_name`) alongside `email` + `permissions`.
- `PATCH /api/admin/me` (authorizeAny) — body `{ fullName: string(1..120) }` (Zod `meNameSchema`); update the CURRENT user's (`claims.sub`) `full_name`; audited `admin_user.name_changed` (actor `self:<email>`); return `{ ok: true, fullName }`.
- `POST /api/admin/me/password` (authorizeAny) — body `{ currentPassword: string, newPassword: string(10..200) }` (Zod `mePasswordSchema`); load the current user's `password_hash` (server-side, e.g. `getPasswordHash(claims.sub)` from Phase 1), `verifyPassword(currentPassword, hash)` — on mismatch return 400 `{ error: "wrong_password" }` (rate-limited); else `hashPassword(newPassword)` and update; audited `admin_user.password_changed` (actor self). Do NOT change status. Return `{ ok: true }`.
- DB helpers in `src/db/admin-users.ts`: `setOwnName(userId, fullName, actor)` and `setOwnPassword(userId, passwordHash, actor)` — audited, mirroring the existing audited writes; neither touches role/status/permissions.
- [ ] TDD (mirror `admin-users-routes.test.ts`): /me returns fullName; PATCH /me changes only the caller's name (uses claims.sub, ignores any id in the body); password change with the right current password succeeds; wrong current password → 400 and no change; a disabled/invalid session → 401. Rate-limit the password endpoint.
- [ ] Implement; commit `[TASK-197] phase4: self-account (name + password) endpoints`.

### Task 2: "My account" front-end
**Files:** `admin.html`, `assets/js/admin/app.js`, `assets/css/admin.css` (minimal).
- [ ] Add a **My account** entry point — a link/button in the topbar (`.admin-user`, next to the email/sign-out) that opens a `#view-account` section (or a simple panel). It contains: the user's email (read-only), a change-name form (prefilled from `GET /api/admin/me` fullName), and a change-password form (current + new + confirm, client-side match + 10-char check). Save name → `PATCH /api/admin/me`; save password → `POST /api/admin/me/password`. Honest-save: show success only on 200; on 400 wrong-password show an inline error. Update the topbar name/email display after a name change.
- [ ] Reuse existing `.admin-*` styles; escape everything; no em-dashes. This is a self view (not gated by any section permission — every signed-in user can manage their own account), so do NOT add it to the permission-filtered section nav; reach it from the topbar. If you add ids the shell test checks, update `test/unit/admin-shell.test.ts`.
- [ ] full gate green; commit `[TASK-197] phase4: My account UI`.

### Task 3: Audit visibility + BDD + README
- [ ] **Verify (no new plumbing expected):** confirm the existing Audit view (`view-audit` / `loadAudit` / `GET /api/admin/audit` / `listAuditLog`) surfaces `admin_user.*` rows. If the audit list needs an entity/action filter to make admin-user events easy to find, add a light one (optional); otherwise leave as-is and state in the report that the events already appear (they are written to `audit_log` by Phases 1–3 and listed by `listAuditLog`).
- [ ] `features/admin-account.feature` (`@db` where needed): change own name; change own password with the correct current password; wrong current password is rejected; a name/password change appears in the audit log. Reuse existing step style; dry-run must be clean.
- [ ] README: document "My account" (self name + password), that email changes are admin-only, and that admin-user actions are recorded in the Audit log.
- [ ] full `npm run lint && build && test:unit` green; commit `[TASK-197] phase4: audit visibility check + BDD + README`.

## Self-Review
Covers: self name + password endpoints (T1), My account UI (T2), audit verification + tests/docs (T3). Self-only (claims.sub), current-password required, audited, no email self-edit, no migration. Security-review focus for the final pass: can `/me` write endpoints be aimed at another user's id (they must always use claims.sub); is the current-password check enforced before a password change; is the new password hashed (never stored/echoed plaintext); does a disabled user get rejected (authorizeAny); rate-limit on the password endpoint.
