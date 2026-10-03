import { Router, type Request, type Response } from "express";
import { createRateLimiter } from "../portal/request-limiter";
import { lookUpAgain, markAgainUsed } from "../db/fundraiser-again";
import { getFundraiser } from "../db/fundraisers";
import { againPrefill, againVerdict, hashAgainToken, readAgainToken } from "../fundraising/again";

// TASK-515: the public side of "Do it again" (src/fundraising/again.ts), from email 18 (a year on).
//
//   POST /api/fundraise/again   { token }  -> last year's safe details, to fill in the sign up form
//
// The token comes from the email's button (/fundraise?again=...). A POST, so it never sits in a
// server's access log as part of an address. Only the safe details come back (againPrefill); an
// unknown, used or out of date link, or one whose fundraiser has gone, all get one plain answer, so
// a guess learns nothing. Each link gives the details at most 3 times (lookUpAgain), and tries are
// limited per address, as for an invite. The form still works
// without it, and the new sign up waits for staff to approve it like any other.
//
// When the sign up arrives with the token (POST /api/fundraise, `again`), useAgain marks the link
// used and records it in last year's History, best effort.

export const fundraiseAgainRouter = Router();

const LIMIT = { max: 30, windowMs: 15 * 60_000 };
let limiter = createRateLimiter(LIMIT);
/** Tests only: start the per address count again. */
export function againLimiterReset(): void {
  limiter = createRateLimiter(LIMIT);
}

const GONE = { error: "That link has expired or already been used. You can still fill in the form." };

export async function postAgainPrefill(req: Request, res: Response): Promise<Response> {
  if (!limiter.allow(req.ip ?? "unknown", Date.now())) {
    return res.status(429).json({ error: "Too many tries. Please wait a few minutes and try again." });
  }
  const token = readAgainToken(req.body?.token);
  if (!token) return res.status(404).json(GONE);
  try {
    const now = new Date();
    const link = await lookUpAgain(hashAgainToken(token));
    if (!link || againVerdict(link, now) !== "ok") return res.status(404).json(GONE);
    const f = await getFundraiser(link.fundraiserId);
    if (!f) return res.status(404).json(GONE);
    return res.status(200).json(againPrefill(f, now));
  } catch (err) {
    console.error("fundraise again lookup failed:", err instanceof Error ? err.message : err);
    return res.status(503).json({ error: "We could not fill this in just now. You can still fill in the form." });
  }
}

/** The sign up made from a Do it again link has been saved: mark the link used. Never throws. */
export async function useAgain(raw: unknown, fundraiserId: number): Promise<void> {
  const token = readAgainToken(raw);
  if (!token) return;
  try {
    await markAgainUsed(hashAgainToken(token), fundraiserId);
  } catch (err) {
    console.error("fundraise again link could not be marked used:", err instanceof Error ? err.message : err);
  }
}

fundraiseAgainRouter.post("/api/fundraise/again", postAgainPrefill);
