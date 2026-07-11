import { Router, type Request, type Response } from "express";
import {
  listUsers,
  getManagedUser,
  getManagedUserByEmail,
  getPasswordHash,
  inviteUser,
  setUserRole,
  setUserStatus,
  deleteUser,
  setUserPassword,
  setUserPermissions,
  isLastEnabledAdmin,
  setOwnName,
  setOwnPassword,
  DuplicateEmailError,
  LastAdminError,
  type ManagedUser,
} from "../db/admin-users";
import {
  inviteSchema,
  userPatchSchema,
  setPasswordSchema,
  forgotSchema,
  permissionsSchema,
  meNameSchema,
  mePasswordSchema,
} from "../admin/user-schema";
import { issueAdminActionToken, verifyAdminActionToken, adminActionLink, AdminActionTokenError } from "../admin/tokens";
import { hashPassword, verifyPassword } from "../admin/password";
import { sendAdminInvite, sendAdminReset } from "../clients/email";
import { actorOf } from "./admin";
import { authorizeSection, authorizeAny, loadEffectivePermissions } from "./admin-authz";
import { config } from "../config";
import { createRateLimiter } from "../portal/request-limiter";

// Admin user-management + self/admin-initiated password reset (admin-management Phase 2). The
// /api/admin/users* routes and the admin-initiated reset are gated to the "team" section
// (authorizeSection(..., "team", "view"|"edit") — a viewer/editor with no team access gets 403);
// /forgot and /set-password are PUBLIC, since they are how a locked-out user gets back in, and are
// rate-limited. Every mutating write reuses the
// audited src/db/admin-users functions (Task 3), so each state change appends its own audit_log row
// in the same transaction. The anti-lockout guard (isLastEnabledAdmin) runs BEFORE any mutation on a
// PATCH/DELETE that could orphan the last enabled admin, returning 409 { error: "last_admin" }
// without touching the row. Tokens/passwords are never logged (only send/verify failures, by message).
export const adminUsersRouter = Router();

// Parse and validate the user id in the path; sends a 400 and returns null when it is not a
// positive integer (mirrors donorId/storyId/contactId in src/routes/admin.ts).
function userId(req: Request, res: Response): number | null {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid user id" });
    return null;
  }
  return id;
}

// GET /api/admin/users — the Team table (Task 8). Admin only (this whole surface manages who can
// sign in, so it is gated tighter than the read-only Viewer/Editor lists elsewhere in admin.ts).
export async function getAdminUsers(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "team", "view"))) return;
  try {
    return res.status(200).json({ results: await listUsers() });
  } catch (err) {
    console.error("admin users list failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin is temporarily unavailable" });
  }
}

// POST /api/admin/users — invite a new staff user. Creates an `invited` row with no password, then
// issues + emails a purpose="invite" action token bound to bind="" (an invited user has no hash yet
// — mirrors inviteUser's password_hash=NULL). A duplicate email -> 409. The email send is
// best-effort (logged, not fatal) — the invite row is already committed by the time we send.
export async function postAdminUsers(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "team", "edit");
  if (!claims) return;
  const parsed = inviteSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid invite request", details: parsed.error.flatten() });
  }
  try {
    const { id } = await inviteUser(
      { email: parsed.data.email, full_name: parsed.data.fullName, role: parsed.data.role },
      actorOf(claims),
    );
    try {
      const token = issueAdminActionToken({
        sub: id,
        purpose: "invite",
        bind: "",
        now: new Date(),
        secret: config.ADMIN_SESSION_SECRET,
      });
      const link = adminActionLink(config.PORTAL_BASE_URL, "/invite", token);
      await sendAdminInvite({ email: parsed.data.email, fullName: parsed.data.fullName, link });
    } catch (err) {
      // Best-effort: the invite row is recorded regardless of the send (mirrors sendThankYou/
      // sendNewsletter's best-effort contract elsewhere in admin.ts).
      console.error(`admin invite email to ${parsed.data.email} failed`, err);
    }
    return res.status(201).json({ id });
  } catch (err) {
    if (err instanceof DuplicateEmailError) {
      return res.status(409).json({ error: "A user with that email already exists" });
    }
    console.error("admin invite failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Invite is temporarily unavailable" });
  }
}

// PATCH /api/admin/users/:id — change role and/or status. BEFORE mutating, checks whether the change
// would orphan admins: a role move away from 'admin' is a "demote", status -> 'disabled' is a
// "disable" (isLastEnabledAdmin only trips when the target is CURRENTLY an enabled admin and no
// other enabled admin remains — see wouldOrphanAdmins). Either trip -> 409 { error: "last_admin" },
// no write. role and status are applied as separate audited writes (setUserRole/setUserStatus each
// append their own admin_user.role_changed / admin_user.status_changed row) since that is the shape
// the Task 3 db layer exposes — a PATCH touching both fields yields two audit rows, which is correct
// (two distinct state changes).
export async function patchAdminUser(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "team", "edit");
  if (!claims) return;
  const id = userId(req, res);
  if (id == null) return;
  const parsed = userPatchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid user update", details: parsed.error.flatten() });
  }
  try {
    const target = await getManagedUser(id);
    if (!target) return res.status(404).json({ error: "User not found" });

    if (parsed.data.role !== undefined && parsed.data.role !== "admin") {
      if (await isLastEnabledAdmin(target, "demote")) {
        return res.status(409).json({ error: "last_admin" });
      }
    }
    if (parsed.data.status === "disabled") {
      if (await isLastEnabledAdmin(target, "disable")) {
        return res.status(409).json({ error: "last_admin" });
      }
    }

    let updated: ManagedUser | null = target;
    if (parsed.data.role !== undefined) {
      updated = await setUserRole(id, parsed.data.role, actorOf(claims));
      if (!updated) return res.status(404).json({ error: "User not found" });
    }
    if (parsed.data.status !== undefined) {
      updated = await setUserStatus(id, parsed.data.status, actorOf(claims));
      if (!updated) return res.status(404).json({ error: "User not found" });
    }
    return res.status(200).json(updated);
  } catch (err) {
    // Security review FIX #4: the pre-check above is fast but not atomic with the write; the db
    // layer's transactional guard (assertAdminsRemain) is authoritative and throws LastAdminError
    // when a concurrent request raced past the pre-check. Map it to the same 409 the pre-check
    // returns — the write has already been rolled back by the time this is caught.
    if (err instanceof LastAdminError) {
      return res.status(409).json({ error: "last_admin" });
    }
    console.error("admin user update failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin update is temporarily unavailable" });
  }
}

// DELETE /api/admin/users/:id — same anti-lockout guard as PATCH (change="delete"), then the audited
// delete. 404 when the id doesn't exist (either at the pre-check or — a benign race — the delete
// itself finding no row).
export async function deleteAdminUser(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "team", "edit");
  if (!claims) return;
  const id = userId(req, res);
  if (id == null) return;
  try {
    const target = await getManagedUser(id);
    if (!target) return res.status(404).json({ error: "User not found" });
    if (await isLastEnabledAdmin(target, "delete")) {
      return res.status(409).json({ error: "last_admin" });
    }
    const deleted = await deleteUser(id, actorOf(claims));
    if (!deleted) return res.status(404).json({ error: "User not found" });
    return res.status(200).json({ deleted: true });
  } catch (err) {
    // Security review FIX #4: same TOCTOU race as PATCH — see patchAdminUser's catch comment.
    if (err instanceof LastAdminError) {
      return res.status(409).json({ error: "last_admin" });
    }
    console.error("admin user delete failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin delete is temporarily unavailable" });
  }
}

// POST /api/admin/users/:id/reset — an admin-initiated password reset. Issues + emails a
// purpose="reset" action token bound to the user's CURRENT password_hash (so the link stops working
// the moment a password is set — single-use). No status gate: an admin may reset a disabled or
// invited user's credential too (e.g. resending a lost invite as a reset). 404 when the user doesn't
// exist; the email send is best-effort.
export async function postAdminUserReset(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "team", "edit"))) return;
  const id = userId(req, res);
  if (id == null) return;
  try {
    const target = await getManagedUser(id);
    if (!target) return res.status(404).json({ error: "User not found" });
    const passwordHash = await getPasswordHash(id);
    const token = issueAdminActionToken({
      sub: id,
      purpose: "reset",
      bind: passwordHash ?? "",
      now: new Date(),
      secret: config.ADMIN_SESSION_SECRET,
    });
    const link = adminActionLink(config.PORTAL_BASE_URL, "/reset", token);
    try {
      await sendAdminReset({ email: target.email, fullName: target.full_name, link });
    } catch (err) {
      console.error(`admin reset email to ${target.email} failed`, err);
    }
    return res.status(200).json({ sent: true });
  } catch (err) {
    console.error("admin user reset failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Reset is temporarily unavailable" });
  }
}

// PATCH /api/admin/users/:id/permissions (Admin Phase 2, Task 5) — set a user's per-section
// view/edit matrix. Gated to "team" edit, like every other .../users* mutation. The body must be
// a COMPLETE 13-section matrix (permissionsSchema), matching what the Team editor UI always
// submits. Anti-lockout: re-expressed from "the last role='admin'" to "the last user with
// EFFECTIVE team:edit" — mirrors patchAdminUser's role guard exactly (only pre-check when the
// NEW value moves the target's team level away from "edit"; the db layer's transactional
// assertAdminsRemain, now keyed on the same effective-team-edit count, is authoritative and closes
// the TOCTOU gap the same way it does for role/status changes).
export async function patchUserPermissions(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "team", "edit");
  if (!claims) return;
  const id = userId(req, res);
  if (id == null) return;
  const parsed = permissionsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid permissions update", details: parsed.error.flatten() });
  }
  try {
    const target = await getManagedUser(id);
    if (!target) return res.status(404).json({ error: "User not found" });

    if (parsed.data.permissions.team !== "edit") {
      if (await isLastEnabledAdmin(target, "demote")) {
        return res.status(409).json({ error: "last_admin" });
      }
    }

    const updated = await setUserPermissions(id, parsed.data.permissions, actorOf(claims));
    if (!updated) return res.status(404).json({ error: "User not found" });
    return res.status(200).json(updated);
  } catch (err) {
    // Same TOCTOU race as patchAdminUser/deleteAdminUser — see their catch comments. The db
    // layer's same-transaction guard is authoritative when a concurrent request races the
    // pre-check above.
    if (err instanceof LastAdminError) {
      return res.status(409).json({ error: "last_admin" });
    }
    console.error("admin permissions update failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Permissions update is temporarily unavailable" });
  }
}

// GET /api/admin/me (Admin Phase 2, Task 5) — any valid, non-disabled session (no section/level
// check; authorizeAny only verifies the token + that the account isn't disabled). Returns the
// caller's own effective permissions, for the front-end to filter its nav and gate write controls
// client-side (the server-side authorizeSection gate on every other route remains the real
// enforcement — this endpoint is not a security boundary, just a read of "what can I do").
// Admin Phase 4 (TASK-197): also returns fullName (read via getManagedUser, which already selects
// full_name for the Team table) so the front-end "My account" panel can prefill the name form
// without a second bespoke query.
export async function getAdminMe(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeAny(req, res);
  if (!claims) return;
  const permissions = await loadEffectivePermissions(claims.sub);
  if (!permissions) {
    // Race: the account was disabled/removed between authorizeAny's check and this load. Same
    // generic 401 authorizeAny itself would have sent.
    return res.status(401).json({ error: "Invalid or expired admin session" });
  }
  const managed = await getManagedUser(claims.sub);
  if (!managed) {
    // Same race as above (removed between authorizeAny and this load) — same generic 401.
    return res.status(401).json({ error: "Invalid or expired admin session" });
  }
  return res.status(200).json({ email: claims.email, fullName: managed.full_name, permissions });
}

// PATCH /api/admin/me (Admin Phase 4, TASK-197) — self-only display-name change. Gated by
// authorizeAny (any valid, non-disabled session; no section/level check — every signed-in staff
// member may rename themselves). ALWAYS acts on claims.sub; any `id` present in the body is
// ignored (meNameSchema doesn't even accept one). Audited admin_user.name_changed via setOwnName.
export async function patchAdminMe(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeAny(req, res);
  if (!claims) return;
  const parsed = meNameSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid name update", details: parsed.error.flatten() });
  }
  try {
    await setOwnName(claims.sub, parsed.data.fullName, actorOf(claims));
    return res.status(200).json({ ok: true, fullName: parsed.data.fullName });
  } catch (err) {
    console.error("admin self name update failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Update is temporarily unavailable" });
  }
}

// POST /api/admin/me/password (Admin Phase 4, TASK-197) — self-only password change, requiring the
// CURRENT password (verified server-side via getPasswordHash + verifyPassword; never trusts a
// client-supplied hash). Rate-limited per-caller AND per-IP (mirrors postAdminForgot's dual-limiter
// shape) so repeated wrong guesses can't be used to brute-force the current password. ALWAYS acts on
// claims.sub. Never logs currentPassword/newPassword. Audited admin_user.password_changed via
// setOwnPassword — status is never touched (see setOwnPassword's comment).
const mePasswordUserLimiter = createRateLimiter({ max: 5, windowMs: 15 * 60 * 1000 });
const mePasswordIpLimiter = createRateLimiter({ max: 20, windowMs: 15 * 60 * 1000 });

export async function postAdminMePassword(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeAny(req, res);
  if (!claims) return;
  const parsed = mePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid password update", details: parsed.error.flatten() });
  }
  const now = Date.now();
  const userOk = mePasswordUserLimiter.allow(String(claims.sub), now);
  const ipOk = mePasswordIpLimiter.allow(req.ip ?? "unknown", now);
  if (!userOk || !ipOk) {
    return res.status(429).json({ error: "Too many attempts. Please try again shortly." });
  }
  try {
    const hash = await getPasswordHash(claims.sub);
    const valid = await verifyPassword(parsed.data.currentPassword, hash);
    if (!valid) {
      return res.status(400).json({ error: "wrong_password" });
    }
    const newHash = await hashPassword(parsed.data.newPassword);
    await setOwnPassword(claims.sub, newHash, actorOf(claims));
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("admin self password update failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Update is temporarily unavailable" });
  }
}

// POST /api/admin/forgot — public, self-service "I forgot my password". ALWAYS returns the same
// 200 { ok: true } — match, no-match, disabled, still-invited, rate-limited, or a failed send are
// all indistinguishable to the caller (no account enumeration, mirrors postRequestAccess in
// src/routes/portal.ts). Only an ENABLED user (status === 'active'; not disabled, not still-invited
// — an invited user has no password to reset, they need the invite link) gets a reset email.
// Rate-limited per email + per IP (same dual-limiter shape as portal's request-access).
//
// Security review FIX #3: the send is fire-and-forget (never awaited), so response latency is
// identical whether or not an email actually goes out — awaiting it would leak, via timing, which
// emails belong to an active account. The admin-initiated /users/:id/reset MAY still await its
// send: that route is admin-authenticated and already reveals the account exists (404 vs sent),
// so there is no enumeration signal left to protect there.
const forgotEmailLimiter = createRateLimiter({ max: 3, windowMs: 15 * 60 * 1000 });
const forgotIpLimiter = createRateLimiter({ max: 20, windowMs: 15 * 60 * 1000 });

export async function postAdminForgot(req: Request, res: Response): Promise<Response> {
  const parsed = forgotSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "A valid email is required" });
  }
  const email = parsed.data.email;
  const now = Date.now();
  // Evaluate both limiters unconditionally (mirrors postRequestAccess) so an email-limited request
  // still consumes its IP-window slot rather than short-circuiting.
  const emailOk = forgotEmailLimiter.allow(email, now);
  const ipOk = forgotIpLimiter.allow(req.ip ?? "unknown", now);
  if (emailOk && ipOk) {
    try {
      const user = await getManagedUserByEmail(email);
      if (user && user.status === "active") {
        const passwordHash = await getPasswordHash(user.id);
        const token = issueAdminActionToken({
          sub: user.id,
          purpose: "reset",
          bind: passwordHash ?? "",
          now: new Date(),
          secret: config.ADMIN_SESSION_SECRET,
        });
        const link = adminActionLink(config.PORTAL_BASE_URL, "/reset", token);
        // Fire-and-forget: do NOT await, so the response latency below never reveals whether a
        // send happened. Wrapped in Promise.resolve() so a synchronous throw is caught the same
        // way as a rejected promise. Errors are swallowed here (not fatal) — the generic 200
        // below is the response either way.
        Promise.resolve(sendAdminReset({ email: user.email, fullName: user.full_name, link })).catch((err) => {
          console.error(`admin forgot-password reset email to ${user.email} failed`, err);
        });
      }
    } catch (err) {
      // Best-effort + no-enumeration: any failure here still yields the generic 200 below.
      console.error("admin forgot-password failed:", err instanceof Error ? err.message : err);
    }
  }
  return res.status(200).json({ ok: true });
}

// POST /api/admin/set-password — public, rate-limited. Accepts either an invite or a reset token
// (the `purpose` claim only changes which audit action is recorded). Re-checks the token's `bind`
// against the user's LIVE password_hash so a token can only ever be redeemed once — completing an
// invite or a reset changes password_hash, so any earlier copy of the link stops matching. Any
// invalid/expired/tampered token, or a missing user, is a generic 400 (no detail that would help an
// attacker distinguish "bad token" from "already used" from "no such user").
const setPasswordLimiter = createRateLimiter({ max: 10, windowMs: 15 * 60 * 1000 });
const INVALID_LINK_MESSAGE = "This link has expired or already been used";

export async function postAdminSetPassword(req: Request, res: Response): Promise<Response> {
  const parsed = setPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid set-password request", details: parsed.error.flatten() });
  }
  const key = req.ip ?? "unknown";
  if (!setPasswordLimiter.allow(key, Date.now())) {
    return res.status(429).json({ error: "Too many attempts. Please try again shortly." });
  }
  try {
    const claims = verifyAdminActionToken(parsed.data.token, config.ADMIN_SESSION_SECRET, new Date());
    const target = await getManagedUser(claims.sub);
    if (!target) {
      return res.status(400).json({ error: INVALID_LINK_MESSAGE });
    }
    // Security review FIX #5: disabling a user does NOT clear password_hash, so a disabled
    // user's reset-token bind can still match the live row. Without this check, completing
    // set-password would flip status back to 'active' (setUserPassword), letting a disabled
    // admin self-reactivate. Same generic invalid-link 400 as a bad token — no detail that would
    // reveal the account is disabled. Only an invited or active target may proceed.
    if (target.status === "disabled") {
      return res.status(400).json({ error: INVALID_LINK_MESSAGE });
    }
    const passwordHash = await getPasswordHash(claims.sub);
    if (claims.bind !== (passwordHash ?? "")) {
      return res.status(400).json({ error: INVALID_LINK_MESSAGE });
    }
    const hash = await hashPassword(parsed.data.password);
    const action = claims.purpose === "invite" ? "admin_user.activated" : "admin_user.password_reset";
    await setUserPassword(claims.sub, hash, `self:${target.email}`, action);
    return res.status(200).json({ ok: true });
  } catch (err) {
    if (err instanceof AdminActionTokenError) {
      return res.status(400).json({ error: INVALID_LINK_MESSAGE });
    }
    console.error("admin set-password failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Set-password is temporarily unavailable" });
  }
}

adminUsersRouter.get("/api/admin/users", getAdminUsers);
adminUsersRouter.post("/api/admin/users", postAdminUsers);
adminUsersRouter.patch("/api/admin/users/:id", patchAdminUser);
adminUsersRouter.delete("/api/admin/users/:id", deleteAdminUser);
adminUsersRouter.post("/api/admin/users/:id/reset", postAdminUserReset);
adminUsersRouter.patch("/api/admin/users/:id/permissions", patchUserPermissions);
adminUsersRouter.get("/api/admin/me", getAdminMe);
adminUsersRouter.patch("/api/admin/me", patchAdminMe);
adminUsersRouter.post("/api/admin/me/password", postAdminMePassword);
adminUsersRouter.post("/api/admin/forgot", postAdminForgot);
adminUsersRouter.post("/api/admin/set-password", postAdminSetPassword);
