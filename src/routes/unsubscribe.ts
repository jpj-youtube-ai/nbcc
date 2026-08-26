import { Router, type Request, type Response } from "express";
import { verifyUnsubscribeToken, UnsubscribeTokenError } from "../donors/unsubscribe-token";
import { unsubscribeDonor, unsubscribeAllListsForEmail } from "../db/newsletters";
import { recordUnsubscribeEvent, recordUnsubscribeEventForEmail } from "../db/newsletter-events";
import { unsubscribeListMember } from "../db/subscriber-lists";
import {
  scopeForKind,
  confirmPrompt,
  doneMessage,
  type UnsubscribeScope,
} from "../newsletter/unsubscribe-copy";
import { config } from "../config";

// Public newsletter unsubscribe (TASK-161/REQ-069). A newsletter email carries
// `${PORTAL_BASE_URL}/unsubscribe/<token>`. The token is a stateless HMAC of the donor id (signed
// with ADMIN_SESSION_SECRET). A valid token stops that person's email (idempotent) and returns a
// small page — rendered inline, so no new static .html file is needed (avoids Dockerfile-COPY /
// page-list guard drift). An invalid token → 400.
//
// TASK-297: the GET no longer writes. Corporate mail security — Microsoft Defender Safe Links,
// Proofpoint URL Defense, Mimecast, Barracuda — fetches every link in an incoming email to sandbox
// it BEFORE the recipient sees the message, and turning click tracking on means that fetch follows a
// links.nbcc.scot redirect straight to this route. While the GET unsubscribed on sight, those
// scanners silently removed people who never clicked anything, and nothing in the data could tell
// that apart from a real unsubscribe. So: GET asks, POST acts. That is the split RFC 8058 one-click
// already assumed, so Gmail and Yahoo are untouched — see the POST registration at the bottom.
export const unsubscribeRouter = Router();

const esc = (s: string): string =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );

// The NBCC palette, matching the preference centre (src/routes/preferences.ts) so the public
// email-management pages read as one thing rather than three unrelated screens.
function shell(body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Newsletter | Night Before Christmas Campaign</title>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:36rem;margin:0 auto;
    padding:3rem 1.25rem;color:#2B2723;background:#F1EBDF;line-height:1.6}
  h1{font-size:1.5rem;margin:0 0 .5rem;color:#800000}
  .card{background:#FFFDFA;border:1px solid #E2D6C4;border-radius:14px;padding:1.25rem;margin:1.25rem 0}
  button{font:inherit;font-weight:600;border-radius:8px;padding:.7rem 1.2rem;cursor:pointer;
    border:1.4px solid #A8182C;background:#A8182C;color:#FFFDFA}
  .row{display:flex;gap:.9rem;flex-wrap:wrap;margin-top:1rem;align-items:center}
  a{color:#800000}
  .muted{color:#6B655E;font-size:.9rem}
</style></head><body>${body}</body></html>`;
}

// TASK-291: every page offers the preference centre. On the confirmation that is what you can do
// NEXT; on the ask it is the gentler alternative to leaving altogether — never a gate in front of it.
function manageLink(token: string, label: string): string {
  return `<p><a href="/preferences/${encodeURIComponent(token)}">${label}</a></p>`;
}

function page(message: string, token?: string): string {
  const manage = token
    ? manageLink(token, "Choose which emails you get — you can keep some and stop others.")
    : "";
  return shell(`<h1>Newsletter</h1><div class="card"><p>${message}</p>${manage}</div>`);
}

type Claims = { kind: "donor" | "subscriber"; id: number; newsletterId: number | null };

// TASK-255/259: the token names the newsletter the link was printed in (feeds the stats), and —
// since audiences exist — WHO is unsubscribing: a donor (global newsletter consent) or a list
// subscriber (that one list's membership). Legacy tokens verify forever and attribute to none.
// Returns null having already sent the 400, so both handlers just bail.
function readClaims(req: Request, res: Response): Claims | null {
  try {
    return verifyUnsubscribeToken(req.params.token, config.ADMIN_SESSION_SECRET);
  } catch (err) {
    if (err instanceof UnsubscribeTokenError) {
      res.status(400).type("html").send(page("This unsubscribe link is not valid."));
      return null;
    }
    throw err;
  }
}

// GET — ask, never act. Deliberately does no database work at all: an automated scanner fetch should
// cost us one signature check and nothing more.
function renderConfirm(req: Request, res: Response): void {
  const claims = readClaims(req, res);
  if (!claims) return;
  const scope: UnsubscribeScope = scopeForKind(claims.kind);
  res
    .status(200)
    .type("html")
    .set("Cache-Control", "no-store")
    .send(
      shell(
        `<h1>Unsubscribe</h1>
<div class="card">
  <p>${confirmPrompt(scope)}</p>
  <form method="post" action="/unsubscribe/${esc(req.params.token)}" class="row">
    <button type="submit">Yes, unsubscribe me</button>
    <a href="https://nbcc.scot">No, keep my emails</a>
  </form>
</div>
${manageLink(req.params.token, "Or choose which emails you get — you can keep some and stop others.")}
<p class="muted">We ask because security software at some workplaces opens every link in an email
automatically. Without this step it could unsubscribe you without you ever clicking.</p>`,
      ),
    );
}

// POST — the write.
async function handleUnsubscribe(req: Request, res: Response): Promise<Response | void> {
  const claims = readClaims(req, res);
  if (!claims) return;

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
      return res.status(400).type("html").send(page("This unsubscribe link is not valid."));
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
  return res
    .status(200)
    .type("html")
    .set("Cache-Control", "no-store")
    .send(page(doneMessage(scope), req.params.token));
}

unsubscribeRouter.get("/unsubscribe/:token", renderConfirm);
// RFC 8058 one-click. Gmail and Yahoo POST here from their own "unsubscribe" button, expecting a 2xx
// and no interaction — so this path must never gain a confirmation step. The POST body is irrelevant
// and deliberately not parsed: the token in the URL is the whole instruction.
unsubscribeRouter.post("/unsubscribe/:token", handleUnsubscribe);
