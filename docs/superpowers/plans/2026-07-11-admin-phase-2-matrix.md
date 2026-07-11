# Admin Management — Phase 2: Per-Section View/Edit Matrix

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Replace the global viewer/editor/admin role gate with a per-person, per-section permission matrix (none/view/edit), enforced fresh on every admin request, with a matrix editor in the Team tab and the nav showing only sections a user can access.

**Architecture:** A DB-backed `authorizeSection(req, res, section, level)` (async) replaces the ~48 `authorizeAdmin(req, res, minRole)` call sites. It verifies the session token, re-loads the user's live row (`status`, `role`, `permissions`) from the DB each request, rejects a disabled user (closing the stale-session gap Phase 1 left), and checks the effective permission for that section+level. A user's effective permissions = their stored `permissions` JSONB if set, else derived from their `role` (`roleToPermissions`), so existing users keep exactly their current access with zero data migration and admins can then fine-tune per person.

**Tech Stack:** Express + TypeScript, pg (JSONB), Zod, Vitest, Cucumber, classic-script admin JS.

## Global Constraints
- Additive migration only: add `permissions jsonb NOT NULL DEFAULT '{}'` to `users`; keep the `role` column (it seeds the default + labels presets).
- No new config/secret.
- `authorizeSection` loads the user fresh per request (revocation + disable are immediate). Admin traffic is low, so a per-request `SELECT` is fine.
- **Preserve current access semantics during the refactor:** for each existing route, `level = "view"` if it currently calls `authorizeAdmin(..., "viewer")`, else `"edit"` (for `"editor"` or `"admin"`). `section` per the mapping table below. This must not silently widen or narrow anyone's access beyond the role→matrix defaults.
- Anti-lockout becomes "cannot remove the last user with **edit on the `team` section**" (the new "admin").
- Every permissions change is audited via `writeWithAudit` (`admin_user.permissions_changed`).
- Green PR + tests; README updated.

## Sections (the matrix rows)
`overview, search, donations, claims, gasds, subscriptions, stories, ticker, contact, newsletter, thank-you, audit, team` (13). Levels: `none | view | edit` (edit implies view). `overview` has no gated route of its own (it aggregates other sections) — it is always visible in the nav; its widgets call section routes that enforce their own gates.

## Route → section mapping (all 48; level from current minRole per the rule above)
| Route prefix | Section |
|---|---|
| `/api/admin/audit` | audit |
| `/api/admin/claim-batches*`, `/api/admin/claims/*` | claims |
| `/api/admin/queues/gasds-*`, `/api/admin/queues/gasds-pool` | gasds |
| `/api/admin/queues/retention-expiry`, `/api/admin/queues/declaration-review`, `/api/admin/queues/awaiting-declaration` | claims |
| `/api/admin/donations`, `/api/admin/donors/*` | donations |
| `/api/admin/search/*` | search |
| `/api/admin/stories*` | stories |
| `/api/admin/contact*` | contact |
| `/api/admin/ticker*` | ticker |
| `/api/admin/newsletters*`, `/api/admin/newsletter-images` | newsletter |
| `/api/admin/thank-you/*` | thank-you |
| `/api/admin/subscriptions/dunning` | subscriptions |
| `/api/admin/users*` | team |
| `/api/admin/login`, `/api/admin/forgot`, `/api/admin/set-password` | PUBLIC — leave untouched |

## Role → default permissions (`roleToPermissions`)
- `admin` → `edit` on every section (incl. `team`).
- `editor` → `edit` on donations, claims, gasds, subscriptions, stories, ticker, contact, newsletter, thank-you, search; `view` on audit; `none` on `team`.
- `viewer` → `view` on all sections except `team` (`none`); no `edit` anywhere.

---

### Task 1: Permission model (pure)
**Files:** Create `src/admin/permissions.ts`, `test/unit/admin-permissions.test.ts`.
**Produces:** `type Section` (the 13), `type Level = "none"|"view"|"edit"`, `SECTIONS: Section[]`, `type PermissionMap = Partial<Record<Section, Level>>`, `roleToPermissions(role: string): PermissionMap`, `effectivePermissions(row: { role: string; permissions: PermissionMap | null }): PermissionMap` (stored if non-empty else roleToPermissions), `can(perms: PermissionMap, section: Section, level: "view"|"edit"): boolean` (edit satisfies view; missing/none fails).
- [ ] Test (RED→GREEN): can('edit') satisfies view; can with 'none'/missing fails; roleToPermissions('admin') is edit-everywhere incl team; editor has no team; viewer has no edit; effectivePermissions falls back to role when permissions empty and uses stored when present.
- [ ] Implement; run; commit `[TASK-186] phase2: permission model`.

### Task 2: permissions column + user row getter
**Files:** Create `migrations/<ts>_user-permissions.js`; modify `src/db/admin-users.ts`.
- [ ] Migration: `pgm.addColumns("users", { permissions: { type: "jsonb", notNull: true, default: "{}" } })` (additive; existing rows get `{}` → fall back to role). down drops it.
- [ ] `getUserAuthRow(id): Promise<{ id:number; email:string; status:string; role:string; permissions: PermissionMap } | null>` — fresh SELECT of the auth-relevant fields (no password_hash). Add `permissions` to `ManagedUser` + `listUsers`/`getManagedUser` selects.
- [ ] `setUserPermissions(id, permissions: PermissionMap, actor): Promise<ManagedUser|null>` — audited `admin_user.permissions_changed`, in `writeWithAudit`.
- [ ] build clean; commit `[TASK-186] phase2: permissions column + getters`.

### Task 3: authorizeSection (DB-backed gate)
**Files:** Create `src/routes/admin-authz.ts` (or add to admin.ts); `test/unit/admin-authz.test.ts`.
**Produces:** `async function authorizeSection(req, res, section: Section, level: "view"|"edit"): Promise<AdminSessionClaims | null>` — verify the bearer session (reuse `verifyAdminSession`); on invalid → 401 + null. Load `getUserAuthRow(claims.sub)`; if missing or `status==="disabled"` → 401 + null (generic). Compute `effectivePermissions`; if `!can(perms, section, level)` → 403 `{ error: "forbidden" }` + null; else return claims. Also export `loadEffectivePermissions(sub): Promise<PermissionMap|null>` for the nav/me endpoint.
- [ ] Test (mock getUserAuthRow + a real signed token): valid+permitted → claims; disabled → 401; missing perm → 403; edit route with only view → 403; view route with edit → ok.
- [ ] Implement; commit `[TASK-186] phase2: authorizeSection gate`.

### Task 4: Refactor all 48 routes to authorizeSection
**Files:** `src/routes/admin.ts`, `src/routes/admin-users.ts`; update the route tests that asserted role gating.
- [ ] For EACH `/api/admin/*` handler (except the 3 public ones), replace `authorizeAdmin(req, res, MINROLE)` with `await authorizeSection(req, res, SECTION, LEVEL)` where SECTION is from the mapping table and LEVEL is `view` if MINROLE was `viewer` else `edit`. The `team` routes (users*) become `authorizeSection(..., "team", "edit")` for writes and `"team","view"` for the GET list. Keep the `const claims = ...; if (!claims) return;` shape where the handler needs claims (actor).
- [ ] Remove/retire `authorizeAdmin` once no caller remains (or keep as a thin deprecated wrapper if a non-section use exists — there should be none).
- [ ] Update the affected route unit tests: a viewer-permission token can GET but a viewer hitting an edit route gets 403; an editor-permission token can edit its sections but not `team`; a token whose user was disabled gets 401. Mirror the existing admin route test auth setup but stub `getUserAuthRow` to return the tested permissions.
- [ ] Full `npm run test:unit` green; build+lint clean; commit `[TASK-186] phase2: gate all admin routes by section+level`.

### Task 5: permissions endpoint + /me + adapted last-admin guard
**Files:** `src/routes/admin-users.ts`; `test/unit/admin-users-routes.test.ts`.
- [ ] `PATCH /api/admin/users/:id/permissions` (requires `team` edit): body validated by a Zod schema (`{ permissions: Record<section, level> }`, strict to the 13 sections + 3 levels); `setUserPermissions`; audited. **Last-admin guard:** before reducing someone's `team` from edit (or via role/status change), block if they are the last user with effective `team:edit` → 409 `{ error: "last_admin" }` (reuse the transactional guard pattern, counting `team:edit` holders instead of `role='admin'`). Update `countEnabledAdmins`/guard to count effective team-edit holders.
- [ ] `GET /api/admin/me` (any valid session): returns `{ email, permissions: effectivePermissions }` for the logged-in user — the front-end uses it to filter the nav and gate controls.
- [ ] Tests: set permissions (team edit only); non-team-edit user gets 403; removing the last team-edit user → 409; /me returns the caller's effective perms.
- [ ] commit `[TASK-186] phase2: permissions endpoint + /me + team-edit lockout guard`.

### Task 6: Team matrix editor + nav filtering (front-end)
**Files:** `admin.html`, `assets/js/admin/app.js`, `assets/css/admin.css` (minimal).
- [ ] In the Team detail (open a user row): render a matrix — the 13 sections as rows, a `none/view/edit` control per row (a small segmented control or select), pre-filled from the user's effective permissions; plus preset buttons "Viewer / Editor / Admin" that fill the matrix from `roleToPermissions`. Save → `PATCH /api/admin/users/:id/permissions`. Show the 409 last-admin message. Gate the whole editor behind the current user having `team:edit`.
- [ ] Nav filtering: on load, `GET /api/admin/me`; hide each `.admin-nav-link` whose `data-view` section the user cannot `view` (keep `overview` always visible). Store the caller's perms in a module var; gate in-view write controls with a `canEdit(section)` helper replacing the old `roleCan(currentRole, "editor")` checks in each `load*`.
- [ ] escape everything; no em-dashes; mirror existing admin components. Update `test/unit/admin-shell.test.ts` only if ids change.
- [ ] Full gate green; commit `[TASK-186] phase2: matrix editor + permission-aware nav`.

### Task 7: BDD + README
- [ ] `features/admin-permissions.feature`: a user with only `stories:view` can GET stories but 403s on a stories write and 403s on donations; granting `donations:edit` lets them act; removing the last team-edit user 409s. `@db` where needed.
- [ ] README: document the matrix, `authorizeSection`, the permissions endpoint + `/me`, and that roles now seed defaults.
- [ ] Full `npm run lint && build && test:unit` green; commit `[TASK-186] phase2: BDD + README`.

## Self-Review
Covers: matrix model (T1), storage (T2), fresh DB-backed gate closing the disabled-session gap (T3), all-route refactor preserving semantics via the level rule (T4), editing + /me + adapted lockout (T5), UI + nav filtering (T6), tests/docs (T7). Role→matrix fallback = zero data migration, no one loses access. Anti-lockout re-expressed as team-edit holders. `authorizeSection` is async so all call sites `await`. Security-review focus for the final pass: any route mis-mapped to the wrong section or wrong level (widening access), any remaining `authorizeAdmin` call, the team-edit lockout race (use the transactional guard), and nav-hiding not being a security control (server still enforces).
