# Admin Management System — Design Spec

**Date:** 2026-07-10
**Status:** Design approved in brainstorming. **Build decision: phased** (Phase 1 first). For user review before writing the Phase 1 plan.

**Revision (2026-07-10, second pass) — two changes to fold into the sections below when the Phase 1 plan is written:**
1. **2FA is email one-time codes, not an authenticator app.** Emailed 6-digit code on login (reuses the email + token machinery). Removes the `ADMIN_TOTP_ENC_KEY` secret, the TOTP/QR enrolment, and `src/auth/totp.ts` / `crypto.ts`. Trade-off: strength depends on the admin's email account (Google Workspace, which can itself enforce 2FA). Login OTPs are short-lived, single-use, and hashed at rest (or stateless + signed); never logged.
2. **Access is a per-person, per-section view/edit matrix, not three fixed roles.** Each admin user has, for every admin section (Overview, Donations, Claims, GASDS, Subscriptions, Stories, Partners, Contact, Newsletter, Thank you, Audit, Team), one of **none / view / edit**. `edit` on the **Team** section = the "can manage people" capability (replaces the old `admin` role). The nav shows only sections the user can view or edit. Anti-lockout guard becomes "can't remove the last person with edit on Team." This replaces the global `viewer/editor/admin` role in `authorizeAdmin` with a section+level check on every admin route.

A separate admin **navigation + homepage redesign** (the sidebar is feature-heavy) is being explored in parallel; the new nav renders each person's permitted sections from the matrix above.
**Feature:** Identity & access management for the `/admin` dashboard — manage admin users from the UI (no more migrations), password resets, authenticator-app 2FA, an audit trail, and self-service profile.

## Goal

Let admins manage who can sign in to `/admin` and what they can do, entirely from the UI, and let users recover access safely on their own — replacing today's process where accounts and roles are granted by hand-writing database migrations and there is no password-reset path.

## Scope (and what's out)

**In scope** — the `/admin` dashboard users only (the few privileged staff):
- User management: invite / remove / disable, set role — from the UI.
- Password resets: self-service ("forgot password" email link) **and** admin-initiated.
- Two-factor authentication (TOTP authenticator app) on the `/admin` login, including admin-initiated 2FA reset (lost device).
- Audit trail of sensitive account actions.
- Self-service "My account" (own name, password, 2FA).

**Out of scope:**
- The `/workshop` volunteer launchpad — it is a separate, open, unauthenticated page (shipped in TASK-183). There is **no** "all volunteers log in" tier; only the `/admin` few have accounts.
- SMS/hardware 2FA (authenticator app only).
- Self-service email change (email is the login identity → admin-only).
- SSO / external identity providers.

## Decisions (locked in brainstorming)

1. **Two-step login with TOTP 2FA.** Email + password, then a 6-digit authenticator code. Session issued only after both. Applies to every admin (the most sensitive data in the system lives behind `/admin`).
2. **Invite flow for onboarding.** An admin enters name + email + role; the system emails a short-lived signed invite link; the invitee sets their own password and enrols 2FA. No admin ever sees anyone's password.
3. **Resets: both self-service and admin-initiated.** Plus admin-initiated **2FA reset** for a lost device (re-enrol on next login) — without it, a lost phone means permanent lockout.
4. **Only `admin` role manages users.** viewer/editor manage only their own account.
5. **Lives in the main app DB.** Admin users are already the `users` table there; this is additive columns, not a new database.
6. **TOTP secrets encrypted at rest** with a new config secret (a leaked DB must not hand over everyone's 2FA seeds).

## Architecture

Extends the existing admin auth (`src/db/admin.ts`, `src/admin/session.ts`, the `POST /api/admin/login` endpoint, `authorizeAdmin`) rather than replacing it. Reuses: the HMAC session (`ADMIN_SESSION_SECRET`), the email-send client (`src/clients/email.ts`), the donor-portal expiring-signed-token pattern (for invite/reset links), and `createRateLimiter`.

```
Invite:   admin → POST /api/admin/users → email signed invite link
                → GET /invite/:token (set password + enrol TOTP) → account active
Login:    POST /api/admin/login (email+pw) → 200 "2FA required"
                → POST /api/admin/login/2fa (code) → session token
Reset:    self:  POST /api/admin/forgot → email reset link → set password
          admin: POST /api/admin/users/:id/reset → email that user a reset link
          2FA:   admin: POST /api/admin/users/:id/reset-2fa → clear TOTP, re-enrol next login
Manage:   GET/POST/PATCH/DELETE /api/admin/users*  (admin role only)
Account:  GET/PATCH /api/admin/me (own name / password / 2FA)  (any signed-in user)
```

### Data model (additive migration on `users`, main DB)

Expand-contract, additive-only (golden rule 2):

| column | type | notes |
|---|---|---|
| `status` | text not null default 'active' | `invited` / `active` / `disabled` |
| `totp_secret` | text | encrypted at rest; null until enrolled |
| `totp_enabled` | boolean not null default false | |
| `invited_at` | timestamptz | when invited |
| `last_login_at` | timestamptz | updated on successful login |

Existing columns unchanged: `id`, `email`, `full_name`, `role` (viewer/editor/admin), `password_hash`.

Invite and reset tokens are **stateless HMAC-signed** (email + a `purpose` claim + expiry), signed with the existing `ADMIN_SESSION_SECRET` — the `purpose` claim (`invite` / `reset`) means an invite token can never be replayed as a session token, so no second signing secret is needed. Mirrors the donor magic-link pattern; no token table.

### Config (golden rule 3)

- `ADMIN_TOTP_ENC_KEY` (new secret) — encrypts `totp_secret` at rest. Wired through `src/config/schema.ts` + `.env.example` + SSM param + task-def secret + `exec_secrets` IAM + `pr.yml` env.

## Components

- `src/auth/totp.ts` — pure RFC 6238 TOTP (generate secret, build otpauth URI for the QR, verify a code with a ±1 step window). Node `crypto` only, no dependency. Unit-tested.
- `src/auth/crypto.ts` — AES-GCM encrypt/decrypt for `totp_secret` using `ADMIN_TOTP_ENC_KEY`. Unit-tested.
- `src/auth/tokens.ts` — sign/verify short-lived purpose-scoped invite/reset tokens (reuses the HMAC approach). Unit-tested.
- `src/db/admin-users.ts` — user CRUD (list, get, invite/create, setRole, disable, delete, setPassword, setTotp, clearTotp, touchLastLogin) via the main pool. Every mutating call writes an `audit_log` row in the same transaction (the existing audit truth-model).
- `src/routes/admin-users.ts` (or extend `admin.ts`) — the `/api/admin/users*`, `/api/admin/me`, invite/reset/2FA endpoints. Zod-validated, rate-limited, role-gated.
- `src/routes/invite.ts` — `GET /invite/:token` serves the set-password + enrol-2FA page; `POST` completes it.
- Login: extend `postLogin` to return a "2FA required" step; add `POST /api/admin/login/2fa`.
- Front-end (`admin.html` + `assets/js/admin/app.js`): a new admin-only **"Team"** view (list users; invite; change role; disable/remove; reset password; reset 2FA) and a small **"My account"** panel (name, change password, re-enrol 2FA). Login form gains the 2FA code step. Mirrors existing admin-tab patterns (no new visual system).

## Flows & error handling

- **Invite:** create `status='invited'` user (no password) → email link (e.g. 48h expiry) → invitee sets password + scans QR to enrol TOTP → `status='active'`, `totp_enabled=true`. Expired/used token → clear error + "ask an admin to re-invite".
- **Login:** bad credentials → 401 (generic, timing-safe as today). Good credentials + `totp_enabled` → 200 `{ step: "2fa" }` + a short-lived interim token; `POST /login/2fa` with a valid code → full session. Bad code → 401, rate-limited. `last_login_at` updated on success.
- **Self-service reset:** `POST /forgot` always responds the same (no account enumeration); if the email exists, send a reset link. Link → set new password. 2FA still required on next login.
- **Admin reset password / reset 2FA:** admin-only; emails the user a link / clears their TOTP so they re-enrol next login. Audited.
- **Roles:** only `admin` reaches `/api/admin/users*`; a non-admin gets 403. An admin cannot remove/disable/demote **their own** last admin account (guard against locking everyone out).
- **Rate limiting:** login, `/login/2fa`, `/forgot`, and invite-accept endpoints are rate-limited (reuse `createRateLimiter`).

## Audit trail

Every sensitive action appends an `audit_log` row (existing table, same transaction as the change): `admin_user.invited`, `admin_user.role_changed`, `admin_user.disabled`, `admin_user.removed`, `admin_user.password_reset`, `admin_user.totp_reset`, `admin.login_succeeded`, `admin.login_failed`. Actor = the acting admin's email (mirrors the donor `actorOf`); for self-service, actor = the user themselves.

## Security notes

- TOTP secrets encrypted at rest (`ADMIN_TOTP_ENC_KEY`); never logged.
- Invite/reset tokens: short-lived, single-purpose, HMAC-signed; single-use where practical (bind to `password_hash`/`status` so a completed invite link stops working).
- No account enumeration on `/forgot` (uniform response).
- All new DB changes additive (safe rollback).
- 2FA enrolment shows the secret/QR once; recovery is admin-initiated reset (documented), not recovery codes (kept out of scope for simplicity — can be added later).

## Testing

- **Unit (DB-free):** TOTP generate/verify + window; AES-GCM round-trip; token sign/verify + expiry + tamper; password hashing; role-gating; Zod schemas; the "can't remove last admin" guard.
- **BDD:** invite → set password + 2FA → active; login-with-2FA (good/bad code); forgot-password; admin reset password; admin reset 2FA; non-admin blocked from user management (403).

## Phasing (optional, if you want to de-risk)

- **Phase 1** — user management (invite/remove/role) + password resets. Kills the migrations, gets self-serve accounts.
- **Phase 2** — TOTP 2FA (login step, enrolment, admin 2FA reset, `ADMIN_TOTP_ENC_KEY`).
- **Phase 3** — audit trail + "My account".

Designed to build as one coherent piece too; the user model is shaped so 2FA drops in cleanly if phased.
