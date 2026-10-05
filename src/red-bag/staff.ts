import { verifyAdminSession } from "../admin/session";
import { redBagIsLive } from "./switch";

// Fill a Red Bag: "is this a signed in member of staff?", for the preview while the page is
// switched off. The SAME session the admin uses: the bearer token admin.html keeps for the tab
// (sessionStorage), verified with verifyAdminSession, and the user's row read fresh so someone
// switched off since they signed in is refused at once (as src/routes/admin-authz.ts does).
//
// Unlike the admin's own gate this never writes a response: it only answers yes or no, and it
// fails CLOSED. A missing, forged or expired session, an account that is disabled or gone, or a
// database that cannot be read are all "no": the cost of wrongly saying yes is showing a page that
// has not been announced, and the cost of wrongly saying no is a member of staff signing in again.
// Any role will do: looking at a page before it is public needs no particular section.

export async function isStaffRequest(authorization: string | undefined): Promise<boolean> {
  const match = /^Bearer (.+)$/i.exec(authorization ?? "");
  if (!match) return false;
  try {
    const { config } = await import("../config");
    const claims = verifyAdminSession(match[1], config.ADMIN_SESSION_SECRET, new Date());
    const { getUserAuthRow } = await import("../db/admin-users");
    const row = await getUserAuthRow(claims.sub);
    return !!row && row.status !== "disabled";
  } catch {
    return false;
  }
}

/**
 * May this request see the DRAFT list on the page (/fill?preview=draft)? A signed in member of
 * staff who holds VIEW of the "red-bag" access section, read fresh from the database on this very
 * request, exactly as the admin's own routes do (authorizeSection). Fails CLOSED like isStaffRequest
 * above: no token, a forged or expired one, a disabled account, someone without the section, or a
 * database that cannot answer are all "no", and the visitor is simply given the published page.
 */
export async function mayViewRedBagDraft(authorization: string | undefined): Promise<boolean> {
  const match = /^Bearer (.+)$/i.exec(authorization ?? "");
  if (!match) return false;
  try {
    const { config } = await import("../config");
    const claims = verifyAdminSession(match[1], config.ADMIN_SESSION_SECRET, new Date());
    const { getUserAuthRow } = await import("../db/admin-users");
    const row = await getUserAuthRow(claims.sub);
    if (!row || row.status === "disabled") return false;
    const { can, effectivePermissions } = await import("../admin/permissions");
    return can(effectivePermissions(row), "red-bag", "view");
  } catch {
    return false;
  }
}

/** May this request use Fill a Red Bag? Everyone once it is live; before that, staff only. */
export async function redBagOpenTo(authorization: string | undefined): Promise<boolean> {
  return redBagIsLive() || (await isStaffRequest(authorization));
}
