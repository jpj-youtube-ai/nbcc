import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { findUserByEmail } from "../db/admin";
import { verifyPassword } from "../admin/password";
import { signAdminSession } from "../admin/session";
import { config } from "../config";

// The role-based admin login endpoint (REQ-062 · TASK-105). POST /api/admin/login verifies a staff
// user's email + password (scrypt) and, on success, returns a signed session token — the bearer-token
// analogue of the donor portal's magic link — carrying the user's id/email/role. Invalid credentials
// return 401. The token is stateless (HMAC-signed with ADMIN_SESSION_SECRET, no DB session row); the
// role-gated admin actions that consume it are TASK-106. Mounted in src/app.ts (after express.json).
export const adminRouter = Router();

// A dummy scrypt hash to verify against when the email is unknown, so an unknown-email request does
// the same scrypt work as a known one — no user enumeration via response timing.
const DUMMY_HASH =
  "scrypt$00000000000000000000000000000000$" +
  "0000000000000000000000000000000000000000000000000000000000000000" +
  "0000000000000000000000000000000000000000000000000000000000000000";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function postAdminLogin(req: Request, res: Response): Promise<Response> {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid login request", details: parsed.error.flatten() });
  }

  try {
    const user = await findUserByEmail(parsed.data.email);
    // Always run a password verification (against a dummy hash when the user is unknown) so the
    // timing does not reveal whether the email exists. A null password_hash (no credential set) and
    // a wrong password both fail here, yielding the same generic 401.
    const ok = await verifyPassword(parsed.data.password, user?.password_hash ?? DUMMY_HASH);
    if (!user || !ok) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const { token, claims } = signAdminSession({
      sub: user.id,
      email: user.email,
      role: user.role,
      now: new Date(),
      secret: config.ADMIN_SESSION_SECRET,
    });
    return res.status(200).json({
      token,
      expiresAt: new Date(claims.exp).toISOString(),
      user: { id: user.id, email: user.email, fullName: user.full_name, role: user.role },
    });
  } catch (err) {
    // The message is safe to log; no secret or password is included.
    console.error("admin login failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Login is temporarily unavailable" });
  }
}

adminRouter.post("/api/admin/login", postAdminLogin);
