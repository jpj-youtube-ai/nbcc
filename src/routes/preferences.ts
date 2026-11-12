import { Router, type Request, type Response } from "express";
import express from "express";
import { verifyUnsubscribeToken, UnsubscribeTokenError } from "../donors/unsubscribe-token";
import { donorConsentForEmail, setDonorConsents } from "../db/newsletters";
import {
  listMembershipsForEmail,
  unsubscribeListMember,
  listOfferableLists,
  addListSubscriber,
} from "../db/subscriber-lists";
import { pool } from "../db/pool";
import { addOptOut, liftOptOut } from "../db/email-opt-outs";
import { buildPreferences, applyPreferences, joinableLists, type PreferenceView, type OfferableList } from "../newsletter/preferences";
import { preferencesInvalidPage, preferencesPage } from "../newsletter/email-pages";
import { pageFailed, sendSitePage } from "../site/chrome";
import { config } from "../config";

// TASK-291: the preference centre. Reached from the confirmation the unsubscribe link already shows,
// so the guarantee that clicking "unsubscribe" unsubscribes you is untouched — this is what you can
// do NEXT, not a gate in front of it.
//
// Two rules, both enforced in src/newsletter/preferences.ts and both about what a token entitles you
// to: the page shows only the lists this address is genuinely on, and a submission can only act on
// what the page offered.
//
// TASK-615: the pages wear the site's banner, menu and footer (src/newsletter/email-pages.ts) and go out
// as every page does (sendSitePage). The reads, the plan, the writes and what the page says are as they
// were.
export const preferencesRouter = Router();

const invalid = (req: Request, res: Response) => sendSitePage(req, res.status(400), preferencesInvalidPage());

/** Resolve the token to ONE address. Everything else is looked up from that address, never from the token. */
async function emailForToken(token: string): Promise<string | null> {
  let claims: { kind: "donor" | "subscriber"; id: number };
  try {
    claims = verifyUnsubscribeToken(token, config.ADMIN_SESSION_SECRET);
  } catch (err) {
    if (err instanceof UnsubscribeTokenError) return null;
    throw err;
  }
  if (claims.kind === "donor") {
    const { rows } = await pool.query(`SELECT lower(email) AS email FROM donors WHERE id = $1`, [claims.id]);
    return rows[0]?.email ?? null;
  }
  const { rows } = await pool.query(`SELECT lower(email) AS email FROM list_subscribers WHERE id = $1`, [
    claims.id,
  ]);
  return rows[0]?.email ?? null;
}

async function viewFor(email: string): Promise<{ view: PreferenceView; offers: OfferableList[] }> {
  const [memberships, donor, all] = await Promise.all([
    listMembershipsForEmail(email),
    donorConsentForEmail(email),
    listOfferableLists(),
  ]);
  const view = buildPreferences({ email, memberships, donor });
  // TASK-291: only PUBLIC lists they are not already on. A private list never reaches the page -
  // not greyed out, not mentioned, because a greyed-out row still says the list exists.
  const offers = joinableLists(all, memberships.map((m) => m.listId));
  return { view, offers };
}

preferencesRouter.get("/preferences/:token", async (req: Request, res: Response) => {
  try {
    const email = await emailForToken(req.params.token);
    if (!email) return await invalid(req, res);
    const { view, offers } = await viewFor(email);
    return await sendSitePage(req, res, preferencesPage(view, offers, req.params.token, false));
  } catch (err) {
    pageFailed(res, "email choices page", err);
  }
});

// Exported so it can be unit tested without a server (test/unit/preferences-opt-out.test.ts).
export async function postPreferences(req: Request, res: Response): Promise<Response | void> {
  try {
    return await savePreferences(req, res);
  } catch (err) {
    pageFailed(res, "email choices", err);
  }
}

async function savePreferences(req: Request, res: Response): Promise<Response> {
  const email = await emailForToken(req.params.token);
  if (!email) return invalid(req, res);
  const { view, offers } = await viewFor(email);

  // "Stop all emails" is a submit button of its own, so the way OUT is always one click — a
  // preference centre that makes leaving harder than it was is a dark pattern and a PECR problem.
  const stopAll = req.body?.all === "off";
  const raw = req.body?.keep;
  const keepListIds = stopAll
    ? []
    : (Array.isArray(raw) ? raw : raw == null ? [] : [raw])
        .map((v: unknown) => Number(v))
        .filter((n: number) => Number.isInteger(n) && n > 0);

  const plan = applyPreferences(view, {
    keepListIds,
    newsletter: stopAll ? false : req.body?.newsletter != null,
    thankYou: stopAll ? false : req.body?.thankyou != null,
  });

  // Joining is opt-IN only, and only from what was actually offered: a submission naming a
  // private list is ignored rather than obeyed, or the page becomes a way to add yourself to
  // audiences you were never meant to see.
  if (!stopAll) {
    const offered = new Set(offers.map((o) => o.id));
    const rawJoin = req.body?.join;
    const joinIds = (Array.isArray(rawJoin) ? rawJoin : rawJoin == null ? [] : [rawJoin])
      .map((v: unknown) => Number(v))
      .filter((n: number) => Number.isInteger(n) && offered.has(n));
    for (const listId of joinIds) {
      await addListSubscriber(listId, { name: null, email, phone: null }, "footer", { revive: true });
    }
  }

  // TASK-507: the address level opt out list, which a fundraiser's thank you (email 20) respects.
  // Written FIRST, so a failure later in the save never loses someone's "stop". "Stop all emails"
  // always records it, donor row or not; thank yous turned off records it; thank yous turned back on
  // lifts it (a tombstone, never a delete). A failure here is logged loudly and the rest still saves,
  // so the person's choice about everything else is never lost to it.
  try {
    if (stopAll) await addOptOut(email, "all", "preferences");
    else if (plan.setThankYou === false) await addOptOut(email, "thank_you", "preferences");
    else if (plan.setThankYou === true) await liftOptOut(email, "preferences");
  } catch (err) {
    console.error(
      "PREFERENCES OPT OUT NOT RECORDED: the email_opt_outs write failed; check this address by hand:",
      err instanceof Error ? err.message : err,
    );
  }

  // Memberships first, then donor consent. A person can hold both, and the plan already covers
  // each independently — "stop all emails" simply produces a plan where everything is off.
  for (const memberId of plan.unsubscribeMemberIds) await unsubscribeListMember(memberId);
  if (plan.setNewsletter !== null && plan.setThankYou !== null) {
    await setDonorConsents(email, { newsletter: plan.setNewsletter, thankYou: plan.setThankYou });
  }

  const after = await viewFor(email);
  return sendSitePage(req, res, preferencesPage(after.view, after.offers, req.params.token, true));
}

preferencesRouter.post("/preferences/:token", express.urlencoded({ extended: false }), postPreferences);
