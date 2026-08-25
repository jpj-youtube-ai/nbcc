import { Router, type Request, type Response } from "express";
import { verifyUnsubscribeToken, UnsubscribeTokenError } from "../donors/unsubscribe-token";
import { unsubscribeDonor, unsubscribeAllListsForEmail } from "../db/newsletters";
import { recordUnsubscribeEvent, recordUnsubscribeEventForEmail } from "../db/newsletter-events";
import { unsubscribeListMember } from "../db/subscriber-lists";
import { config } from "../config";

// Public newsletter unsubscribe (TASK-161/REQ-069). A newsletter email carries
// `${PORTAL_BASE_URL}/unsubscribe/<token>`. The token is a stateless HMAC of the donor id (signed
// with ADMIN_SESSION_SECRET). A valid token flips that donor's email_consent to false (idempotent)
// and returns a small confirmation page — rendered inline, so no new static .html file is needed
// (avoids Dockerfile-COPY / page-list guard drift). An invalid token → 400.
export const unsubscribeRouter = Router();

// TASK-291: every confirmation now offers the preference centre. The unsubscribe itself has
// already happened by the time this renders - the link is what you can do NEXT, never a gate in
// front of leaving.
function page(message: string, token?: string): string {
  const manage = token
    ? `<p><a href="/preferences/${encodeURIComponent(token)}">Choose which emails you get</a> —
       you can keep some and stop others.</p>`
    : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Newsletter | Night Before Christmas Campaign</title></head>
<body style="font-family:system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem">
<h1>Newsletter</h1><p>${message}</p>${manage}</body></html>`;
}

// TASK-272: shared by the GET (the in-body link a person clicks) and the POST that mail clients fire
// for RFC 8058 one-click unsubscribe. Same effect either way — the token in the URL is the whole
// instruction, so the POST body is irrelevant and deliberately not parsed.
async function handleUnsubscribe(req: Request, res: Response): Promise<Response> {
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
  // TASK-272: what we tell them depends on what we actually did — a donor link stops ALL our
  // marketing email, a subscriber link leaves one audience. Saying "you will no longer receive our
  // newsletter" for both was wrong in each direction: a donor was not told their thank-you letters
  // stop too, and a volunteer was told the newsletter stops when it doesn't.
  let scope: "everything" | "one-list" = "one-list";
  if (claims.kind === "donor") {
    unsubscribedEmail = await unsubscribeDonor(claims.id);
    scope = "everything";
    // Make it STICK: the same person may also sit on a list as a plain subscriber (donated with the
    // box ticked, then signed up through the website footer). Without this they were mailed again on
    // the very next send, after being told they had unsubscribed.
    if (unsubscribedEmail) await unsubscribeAllListsForEmail(unsubscribedEmail);
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
    .send(
      page(
        scope === "everything"
          ? "You've been unsubscribed. We'll stop sending you emails — including our newsletter and thank-you letters. Donation receipts still come through, because those are records of your gift. If this was a mistake, just reply to any of our emails or contact us and we'll put it right."
          : "You've been unsubscribed from this mailing list. Anything else you get from us is separate and still on.",
        // TASK-291: the token is still good, so the person can go straight on to turn individual
        // things back on or off — including undoing this if they meant to keep it.
        req.params.token,
      ),
    );
}

unsubscribeRouter.get("/unsubscribe/:token", handleUnsubscribe);
// RFC 8058 one-click. Gmail and Yahoo POST here from their own "unsubscribe" button, expecting a 2xx
// and no interaction. Registered alongside the GET so a link that was mailed before this existed
// keeps working exactly as it did.
unsubscribeRouter.post("/unsubscribe/:token", handleUnsubscribe);
