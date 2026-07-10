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
  isLastEnabledAdmin,
  DuplicateEmailError,
  type ManagedUser,
} from "../db/admin-users";
import { inviteSchema, userPatchSchema, setPasswordSchema, forgotSchema } from "../admin/user-schema";
import { issueAdminActionToken, verifyAdminActionToken, adminActionLink, AdminActionTokenError } from "../admin/tokens";
import { hashPassword } from "../admin/password";
import { sendAdminInvite, sendAdminReset } from "../clients/email";
import { authorizeAdmin, actorOf } from "./admin";
import { config } from "../config";
import { createRateLimiter } from "../portal/request-limiter";

// Admin user-management + self/admin-initiated password reset (admin-management Phase 1, Task 5).
// The /api/admin/users* routes and the admin-initiated reset are Admin-role ONLY (authorizeAdmin
// with minRole "admin" — viewer/editor get 403); /forgot and /set-password are PUBLIC, since they
// are how a locked-out user gets back in, and are rate-limited. Every mutating write reuses the
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
  if (!authorizeAdmin(req, res, "admin")) return;
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
  const claims = authorizeAdmin(req, res, "admin");
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
  const claims = authorizeAdmin(req, res, "admin");
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
    console.error("admin user update failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin update is temporarily unavailable" });
  }
}

// DELETE /api/admin/users/:id — same anti-lockout guard as PATCH (change="delete"), then the audited
// delete. 404 when the id doesn't exist (either at the pre-check or — a benign race — the delete
// itself finding no row).
export async function deleteAdminUser(req: Request, res: Response): Promise<Response | void> {
  const claims = authorizeAdmin(req, res, "admin");
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
  if (!authorizeAdmin(req, res, "admin")) return;
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

// POST /api/admin/forgot — public, self-service "I forgot my password". ALWAYS returns the same
// 200 { ok: true } — match, no-match, disabled, still-invited, rate-limited, or a failed send are
// all indistinguishable to the caller (no account enumeration, mirrors postRequestAccess in
// src/routes/portal.ts). Only an ENABLED user (status === 'active'; not disabled, not still-invited
// — an invited user has no password to reset, they need the invite link) gets a reset email.
// Rate-limited per email + per IP (same dual-limiter shape as portal's request-access).
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
        await sendAdminReset({ email: user.email, fullName: user.full_name, link });
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
adminUsersRouter.post("/api/admin/forgot", postAdminForgot);
adminUsersRouter.post("/api/admin/set-password", postAdminSetPassword);
