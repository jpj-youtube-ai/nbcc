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
import {
  buildPreferences,
  applyPreferences,
  joinableLists,
  type PreferenceView,
  type OfferableList,
} from "../newsletter/preferences";
import { config } from "../config";

// TASK-291: the preference centre. Reached from the confirmation the unsubscribe link already shows,
// so the guarantee that clicking "unsubscribe" unsubscribes you is untouched — this is what you can
// do NEXT, not a gate in front of it.
//
// Two rules, both enforced in src/newsletter/preferences.ts and both about what a token entitles you
// to: the page shows only the lists this address is genuinely on, and a submission can only act on
// what the page offered.
export const preferencesRouter = Router();

const esc = (s: string): string =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );

function shell(body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Your emails | Night Before Christmas Campaign</title>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:36rem;margin:0 auto;
    padding:3rem 1.25rem;color:#2B2723;background:#F1EBDF;line-height:1.6}
  h1{font-size:1.5rem;margin:0 0 .5rem;color:#800000}
  .card{background:#FFFDFA;border:1px solid #E2D6C4;border-radius:14px;padding:1.25rem;margin:1.25rem 0}
  label{display:flex;gap:.7rem;align-items:flex-start;padding:.7rem 0;border-bottom:1px solid #EDE4D5}
  label:last-of-type{border-bottom:0}
  input[type=checkbox]{width:18px;height:18px;margin-top:.2rem;accent-color:#800000;flex:none}
  b{display:block}
  .muted{color:#6B655E;font-size:.9rem}
  button{font:inherit;font-weight:600;border-radius:8px;padding:.6rem 1.1rem;cursor:pointer;border:1.4px solid #E2D6C4;background:#F8F4EB;color:#2B2723}
  .save{background:#A8182C;border-color:#A8182C;color:#FFFDFA}
  .row{display:flex;gap:.6rem;flex-wrap:wrap;margin-top:1rem;align-items:center}
  .all{background:none;border:0;color:#800000;text-decoration:underline;padding:.6rem 0}
</style></head><body>${body}</body></html>`;
}

const invalid = (res: Response) =>
  res.status(400).type("html").send(shell("<h1>Your emails</h1><p>This link is not valid.</p>"));

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

function render(
  view: PreferenceView,
  offers: OfferableList[],
  token: string,
  saved: boolean,
): string {
  const nothingLeft = view.lists.length === 0 && !view.donor && offers.length === 0;
  if (nothingLeft) {
    return shell(
      `<h1>Your emails</h1><div class="card"><p>We are not sending anything to
       <b>${esc(view.email)}</b>. Nothing more to turn off.</p></div>`,
    );
  }
  const listRows = view.lists
    .map(
      (l) =>
        `<label><input type="checkbox" name="keep" value="${l.listId}" checked>
         <span><b>${esc(l.listName)}</b><span class="muted">Emails for this group only.</span></span></label>`,
    )
    .join("");
  const donorRows = view.donor
    ? `<label><input type="checkbox" name="newsletter"${view.donor.newsletter ? " checked" : ""}>
       <span><b>Newsletter</b><span class="muted">A few updates a year about the campaign.</span></span></label>
       <label><input type="checkbox" name="thankyou"${view.donor.thankYou ? " checked" : ""}>
       <span><b>Thank-you letters</b><span class="muted">A personal thank you when you give.</span></span></label>`
    : "";
  return shell(
    `<h1>Your emails</h1>
     <p class="muted">For <b>${esc(view.email)}</b>. Tick what you would like to keep.</p>
     ${saved ? '<div class="card"><b>Saved.</b> Your choices are in effect now.</div>' : ""}
     <form method="post" action="/preferences/${encodeURIComponent(token)}">
       <div class="card">${donorRows}${listRows}</div>
       <div class="row">
         <button type="submit" class="save">Save my choices</button>
         <button type="submit" name="all" value="off" class="all">Or stop all emails</button>
       </div>
       ${
         offers.length
           ? `<h2 style="font-size:1.05rem;margin:1.5rem 0 .25rem">Would you like anything else?</h2>
              <p class="muted">Only if you want it — nothing here is on unless you tick it.</p>
              <div class="card">${offers
                .map(
                  (o) =>
                    `<label><input type="checkbox" name="join" value="${o.id}">
                     <span><b>${esc(o.name)}</b></span></label>`,
                )
                .join("")}</div>`
           : ""
       }
     </form>
     <p class="muted">Donation receipts still come through whatever you choose — those are records of
     your gift, not marketing.</p>`,
  );
}

preferencesRouter.get("/preferences/:token", async (req: Request, res: Response) => {
  const email = await emailForToken(req.params.token);
  if (!email) return invalid(res);
  const { view, offers } = await viewFor(email);
  return res.type("html").send(render(view, offers, req.params.token, false));
});

preferencesRouter.post(
  "/preferences/:token",
  express.urlencoded({ extended: false }),
  async (req: Request, res: Response) => {
    const email = await emailForToken(req.params.token);
    if (!email) return invalid(res);
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

    // Memberships first, then donor consent. A person can hold both, and the plan already covers
    // each independently — "stop all emails" simply produces a plan where everything is off.
    for (const memberId of plan.unsubscribeMemberIds) await unsubscribeListMember(memberId);
    if (plan.setNewsletter !== null && plan.setThankYou !== null) {
      await setDonorConsents(email, { newsletter: plan.setNewsletter, thankYou: plan.setThankYou });
    }

    const after = await viewFor(email);
    return res.type("html").send(render(after.view, after.offers, req.params.token, true));
  },
);
