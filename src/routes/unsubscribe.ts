import { Router, type Request, type Response } from "express";
import { verifyUnsubscribeToken, UnsubscribeTokenError } from "../donors/unsubscribe-token";
import { unsubscribeDonor, unsubscribeAllListsForEmail } from "../db/newsletters";
import { recordUnsubscribeEvent, recordUnsubscribeEventForEmail } from "../db/newsletter-events";
import { unsubscribeListMember } from "../db/subscriber-lists";
import { scopeForKind, doneMessage, type UnsubscribeScope } from "../newsletter/unsubscribe-copy";
import { unsubscribeConfirmPage, unsubscribeMessagePage } from "../newsletter/email-pages";
import { pageFailed, sendSitePage } from "../site/chrome";
import { config } from "../config";

// Public newsletter unsubscribe (TASK-161/REQ-069). A newsletter email carries
// `${PORTAL_BASE_URL}/unsubscribe/<token>`. The token is a stateless HMAC of the donor id (signed
// with ADMIN_SESSION_SECRET). A valid token stops that person's email (idempotent) and returns a
// small page — rendered in code, so no new static .html file is needed (avoids Dockerfile-COPY /
// page-list guard drift). An invalid token → 400.
//
// TASK-297: the GET no longer writes. Corporate mail security — Microsoft Defender Safe Links,
// Proofpoint URL Defense, Mimecast, Barracuda — fetches every link in an incoming email to sandbox
// it BEFORE the recipient sees the message, and turning click tracking on means that fetch follows a
// links.nbcc.scot redirect straight to this route. While the GET unsubscribed on sight, those
// scanners silently removed people who never clicked anything, and nothing in the data could tell
// that apart from a real unsubscribe. So: GET asks, POST acts. That is the split RFC 8058 one-click
// already assumed, so Gmail and Yahoo are untouched — see the POST registration at the bottom.
//
// TASK-615: the pages wear the site's banner, menu and footer (src/newsletter/email-pages.ts) and go
// out as every page does (sendSitePage). What they say, the form, the writes and every status are as
// they were.
export const unsubscribeRouter = Router();

type Claims = { kind: "donor" | "subscriber"; id: number; newsletterId: number | null };

const NOT_VALID = "This unsubscribe link is not valid.";

// TASK-255/259: the token names the newsletter the link was printed in (feeds the stats), and —
// since audiences exist — WHO is unsubscribing: a donor (global newsletter consent) or a list
// subscriber (that one list's membership). Legacy tokens verify forever and attribute to none.
// Returns null for a token that is not ours; anything else unexpected is thrown.
function claimsOf(req: Request): Claims | null {
  try {
    return verifyUnsubscribeToken(req.params.token, config.ADMIN_SESSION_SECRET);
  } catch (err) {
    if (err instanceof UnsubscribeTokenError) return null;
    throw err;
  }
}

// GET — ask, never act. It does no database work about the person: an automated scanner fetch costs a
// signature check, and the reads every page of the site makes for its menu (sendSitePage).
async function renderConfirm(req: Request, res: Response): Promise<void> {
  try {
    const claims = claimsOf(req);
    if (!claims) {
      await sendSitePage(req, res.status(400), unsubscribeMessagePage(NOT_VALID));
      return;
    }
    const scope: UnsubscribeScope = scopeForKind(claims.kind);
    res.status(200).set("Cache-Control", "no-store");
    await sendSitePage(req, res, unsubscribeConfirmPage(req.params.token, scope));
  } catch (err) {
    pageFailed(res, "unsubscribe question", err);
  }
}

// POST — the write.
async function handleUnsubscribe(req: Request, res: Response): Promise<Response | void> {
  try {
    const claims = claimsOf(req);
    if (!claims) return await sendSitePage(req, res.status(400), unsubscribeMessagePage(NOT_VALID));

    // The write differs by kind, the promise doesn't: this address stops getting THAT kind of email.
    // A donor's flag is their global newsletter consent; a subscriber's tombstone is one list only — a
    // volunteer leaving volunteer emails must not silently lose the newsletter they also wanted.
    let unsubscribedEmail: string | null = null;
    const scope: UnsubscribeScope = scopeForKind(claims.kind);
    if (claims.kind === "donor") {
      unsubscribedEmail = await unsubscribeDonor(claims.id);
      // Make it STICK: the same person may also sit on a list as a plain subscriber (donated with the
      // box ticked, then signed up through the website footer). Without this they were mailed again on
      // the very next send, after being told they had unsubscribed.
      if (unsubscribedEmail) await unsubscribeAllListsForEmail(unsubscribedEmail);
    } else {
      const member = await unsubscribeListMember(claims.id);
      if (!member) {
        return await sendSitePage(req, res.status(400), unsubscribeMessagePage(NOT_VALID));
      }
      unsubscribedEmail = member.email;
    }

    // Attribute the unsubscribe on the stats dashboard. Best-effort: the person IS unsubscribed by the
    // writes above; failing their confirmation page over stats bookkeeping would be backwards.
    if (claims.newsletterId != null) {
      try {
        if (claims.kind === "donor") await recordUnsubscribeEvent(claims.newsletterId, claims.id);
        else if (unsubscribedEmail)
          await recordUnsubscribeEventForEmail(claims.newsletterId, unsubscribedEmail);
      } catch (err) {
        console.error("unsubscribe event recording failed:", err instanceof Error ? err.message : err);
      }
    }
    // TASK-272: what we say depends on what we actually did — a donor link stops ALL our marketing
    // email, a subscriber link leaves one audience. TASK-291: the token is still good, so the person
    // can go straight on to turn individual things back on — including undoing this.
    res.status(200).set("Cache-Control", "no-store");
    return await sendSitePage(req, res, unsubscribeMessagePage(doneMessage(scope), req.params.token));
  } catch (err) {
    pageFailed(res, "unsubscribe", err);
  }
}

unsubscribeRouter.get("/unsubscribe/:token", renderConfirm);
// RFC 8058 one-click. Gmail and Yahoo POST here from their own "unsubscribe" button, expecting a 2xx
// and no interaction — so this path must never gain a confirmation step. The POST body is irrelevant
// and deliberately not parsed: the token in the URL is the whole instruction.
unsubscribeRouter.post("/unsubscribe/:token", handleUnsubscribe);
