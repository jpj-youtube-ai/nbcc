import type { Request, Response } from "express";
import { getUserAuthRow } from "../db/admin-users";
import { verifyAdminSession, type AdminSessionClaims } from "../admin/session";
import { effectivePermissions, can, type Section, type PermissionMap } from "../admin/permissions";
import { config } from "../config";

// The DB-backed authorization gate (Admin management Phase 2, Task 3) that replaces authorizeAdmin
// (src/routes/admin.ts) across all ~48 /api/admin/* routes (Task 4). Unlike authorizeAdmin, which
// only trusted the role baked into the session token at LOGIN time, authorizeSection re-loads the
// user's LIVE row from the DB on every single request (getUserAuthRow), so a disable or a
// permissions edit takes effect on the very next request — closing the stale-session gap Phase 1
// left (a disabled user's still-valid token kept working until it expired, up to 8h).
//
// Steps, mirroring authorizeAdmin's token handling EXACTLY (same bearer-parsing, same 401 messages)
// so the swap is behaviourally invisible except for the DB check it adds:
//   1. Verify the bearer session token (verifyAdminSession). Missing -> 401 "Missing admin session
//      token"; invalid/expired -> 401 "Invalid or expired admin session".
//   2. Load the user's fresh row. Missing or status === "disabled" -> the SAME generic 401 as an
//      invalid session (never a distinct message — that would let a caller enumerate which accounts
//      exist/are disabled).
//   3. Compute effective permissions (stored per-section map, else the role's defaults) and check
//      `can(perms, section, level)`. Insufficient -> 403 { error: "forbidden" }.
//   4. Otherwise return the verified claims, exactly as authorizeAdmin did, so callers that need the
//      actor (email/sub) for an audit log keep working unchanged.

function bearerToken(req: Request): string | null {
  const header = req.headers?.authorization ?? "";
  const match = /^Bearer (.+)$/i.exec(header);
  return match ? match[1] : null;
}

export async function authorizeSection(
  req: Request,
  res: Response,
  section: Section,
  level: "view" | "edit",
): Promise<AdminSessionClaims | null> {
  const token = bearerToken(req);
  if (!token) {
    res.status(401).json({ error: "Missing admin session token" });
    return null;
  }

  let claims: AdminSessionClaims;
  try {
    claims = verifyAdminSession(token, config.ADMIN_SESSION_SECRET, new Date());
  } catch {
    res.status(401).json({ error: "Invalid or expired admin session" });
    return null;
  }

  const row = await getUserAuthRow(claims.sub);
  if (!row || row.status === "disabled") {
    // Generic — identical to the invalid-session 401 above, so a caller cannot tell a missing or
    // disabled account apart from a plain expired/tampered token.
    res.status(401).json({ error: "Invalid or expired admin session" });
    return null;
  }

  const perms = effectivePermissions(row);
  if (!can(perms, section, level)) {
    res.status(403).json({ error: "forbidden" });
    return null;
  }

  return claims;
}

// The caller's effective per-section permissions, for the /me + nav-filter endpoint (Task 5). Null
// when the user is gone or disabled (same treatment as authorizeSection step 2) so that endpoint can
// 401 rather than leak a permission map for an account that no longer has access.
export async function loadEffectivePermissions(sub: number): Promise<PermissionMap | null> {
  const row = await getUserAuthRow(sub);
  if (!row || row.status === "disabled") return null;
  return effectivePermissions(row);
}
