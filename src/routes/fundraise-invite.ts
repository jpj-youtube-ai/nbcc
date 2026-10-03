import { Router, type Request, type Response } from "express";
import { createRateLimiter } from "../portal/request-limiter";
import { findInviteByHash, markInviteUsed } from "../db/fundraising-team";
import { hashInviteToken, invitePrefill, inviteVerdict, readInviteToken } from "../fundraising/invite";

// TASK-503: the public side of an invite from Admin > Fundraising (src/routes/admin-fundraising-team.ts).
//
//   POST /api/fundraise/invite   { token }  -> { firstName, lastName, email }, to fill in the sign up form
//
// The token comes from the invite's link (/fundraise?invite=...). A POST, so it never sits in a
// server's access log as part of an address. Only the first name, surname and email come back; an
// unknown, used or out of date token gets one plain answer, so a guess learns nothing. Tries are
// limited per address. The form still works without it: an invite only saves typing.
//
// When the sign up arrives with the token (POST /api/fundraise, `invite`), useInvite marks the
// invite used and links it to the new sign up, best effort.

export const fundraiseInviteRouter = Router();

const prefillLimiter = createRateLimiter({ max: 30, windowMs: 15 * 60_000 });
const GONE = { error: "That invite link has expired or already been used. You can still fill in the form." };

export async function postInvitePrefill(req: Request, res: Response): Promise<Response> {
  if (!prefillLimiter.allow(req.ip ?? "unknown", Date.now())) {
    return res.status(429).json({ error: "Too many tries. Please wait a few minutes and try again." });
  }
  const token = readInviteToken(req.body?.token);
  if (!token) return res.status(404).json(GONE);
  try {
    const invite = await findInviteByHash(hashInviteToken(token));
    if (inviteVerdict(invite, new Date()) !== "ok" || !invite) return res.status(404).json(GONE);
    return res.status(200).json(invitePrefill(invite));
  } catch (err) {
    console.error("fundraise invite lookup failed:", err instanceof Error ? err.message : err);
    return res.status(503).json({ error: "We could not fill this in just now. You can still fill in the form." });
  }
}

/** The sign up made from an invite has been saved: mark the invite used. Never throws. */
export async function useInvite(raw: unknown, fundraiserId: number): Promise<void> {
  const token = readInviteToken(raw);
  if (!token) return;
  try {
    await markInviteUsed(hashInviteToken(token), fundraiserId);
  } catch (err) {
    console.error("fundraise invite could not be marked used:", err instanceof Error ? err.message : err);
  }
}

fundraiseInviteRouter.post("/api/fundraise/invite", postInvitePrefill);
