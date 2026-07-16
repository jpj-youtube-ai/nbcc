import { Router, type Request, type Response } from "express";
import { verifyUnsubscribeToken, UnsubscribeTokenError } from "../donors/unsubscribe-token";
import { unsubscribeDonor } from "../db/newsletters";
import { recordUnsubscribeEvent } from "../db/newsletter-events";
import { config } from "../config";

// Public newsletter unsubscribe (TASK-161/REQ-069). A newsletter email carries
// `${PORTAL_BASE_URL}/unsubscribe/<token>`. The token is a stateless HMAC of the donor id (signed
// with ADMIN_SESSION_SECRET). A valid token flips that donor's email_consent to false (idempotent)
// and returns a small confirmation page — rendered inline, so no new static .html file is needed
// (avoids Dockerfile-COPY / page-list guard drift). An invalid token → 400.
export const unsubscribeRouter = Router();

function page(message: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Newsletter | Night Before Christmas Campaign</title></head>
<body style="font-family:system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem">
<h1>Newsletter</h1><p>${message}</p></body></html>`;
}

unsubscribeRouter.get("/unsubscribe/:token", async (req: Request, res: Response) => {
  let claims: { donorId: number; newsletterId: number | null };
  try {
    // TASK-255: a v2 token also names the newsletter the link was printed in (legacy tokens verify
    // forever and attribute to none) — that id feeds the stats dashboard below.
    claims = verifyUnsubscribeToken(req.params.token, config.ADMIN_SESSION_SECRET);
  } catch (err) {
    if (err instanceof UnsubscribeTokenError) {
      return res.status(400).type("html").send(page("This unsubscribe link is not valid."));
    }
    throw err;
  }
  await unsubscribeDonor(claims.donorId);
  // TASK-255: attribute the unsubscribe to the newsletter the link was printed in (v2 tokens only —
  // legacy links unsubscribe fine but attribute to none). Best-effort: the donor IS unsubscribed by
  // the line above; failing their confirmation page over stats bookkeeping would be backwards.
  if (claims.newsletterId != null) {
    try {
      await recordUnsubscribeEvent(claims.newsletterId, claims.donorId);
    } catch (err) {
      console.error("unsubscribe event recording failed:", err instanceof Error ? err.message : err);
    }
  }
  return res
    .status(200)
    .type("html")
    .send(page("You've been unsubscribed. You will no longer receive our newsletter."));
});
