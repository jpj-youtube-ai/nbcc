import { Router, type Request, type Response } from "express";
import { verifyUnsubscribeToken, UnsubscribeTokenError } from "../donors/unsubscribe-token";
import { unsubscribeDonor } from "../db/newsletters";
import { recordUnsubscribeEvent, recordUnsubscribeEventForEmail } from "../db/newsletter-events";
import { unsubscribeListMember } from "../db/subscriber-lists";
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
  let claims: { kind: "donor" | "subscriber"; id: number; newsletterId: number | null };
  try {
    // TASK-255/259: the token names the newsletter the link was printed in (feeds the stats), and —
    // since audiences exist — WHO is unsubscribing: a donor (global newsletter consent) or a list
    // subscriber (that one list's membership). Legacy tokens verify forever and attribute to none.
    claims = verifyUnsubscribeToken(req.params.token, config.ADMIN_SESSION_SECRET);
  } catch (err) {
    if (err instanceof UnsubscribeTokenError) {
      return res.status(400).type("html").send(page("This unsubscribe link is not valid."));
    }
    throw err;
  }

  // The write differs by kind, the promise doesn't: this address stops getting THAT kind of email.
  // A donor's flag is their global newsletter consent; a subscriber's tombstone is one list only — a
  // volunteer leaving volunteer emails must not silently lose the newsletter they also wanted.
  let unsubscribedEmail: string | null = null;
  if (claims.kind === "donor") {
    await unsubscribeDonor(claims.id);
  } else {
    const member = await unsubscribeListMember(claims.id);
    if (!member) {
      return res.status(400).type("html").send(page("This unsubscribe link is not valid."));
    }
    unsubscribedEmail = member.email;
  }

  // Attribute the unsubscribe on the stats dashboard. Best-effort: the person IS unsubscribed by the
  // writes above; failing their confirmation page over stats bookkeeping would be backwards.
  if (claims.newsletterId != null) {
    try {
      if (claims.kind === "donor") await recordUnsubscribeEvent(claims.newsletterId, claims.id);
      else if (unsubscribedEmail) await recordUnsubscribeEventForEmail(claims.newsletterId, unsubscribedEmail);
    } catch (err) {
      console.error("unsubscribe event recording failed:", err instanceof Error ? err.message : err);
    }
  }
  return res
    .status(200)
    .type("html")
    .send(page("You've been unsubscribed. You will no longer receive our newsletter."));
});
