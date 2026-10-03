import { Router, type Request, type Response } from "express";
import { z, type ZodIssue } from "zod";
import { authorizeSection } from "./admin-authz";
import type { AdminSessionClaims } from "../admin/session";
import { fromOurOwnPage, ownFundraiser, signedIn } from "./fundraise";
import { listForOrganiser, wallRows } from "../db/fundraisers";
import {
  createThanks,
  decideThanks,
  hasQueuedThanks,
  heldDonationIds,
  listThanks,
  listThanksForStaff,
  pendingThanksByFundraiser,
  ThanksError,
  type ThanksDecision,
} from "../db/fundraiser-thanks";
import { forOrganiser, SKIP_WORDS, thankableGifts, thanksPostSchema, thanksStatusWords } from "../fundraising/thanks";
import { sendQueuedThanks } from "../fundraising/thanks-send";
import { familyGifts, isInMemory } from "../fundraising/in-memory";

/** In memory: the gifts to pick, in the thank you's shape: the name they gave, never an amount. */
function familyThankable(rows: Parameters<typeof familyGifts>[0], held: Set<number>) {
  return familyGifts(rows, held).map((g) => ({ ...g, amountPence: null, giftAidPence: null }));
}

// TASK-507: "Thank your supporters". The rules are in src/fundraising/thanks.ts, the SQL in
// src/db/fundraiser-thanks.ts and the sending in src/fundraising/thanks-send.ts.
//
// The organiser, in their private area (signed in with the emailed code, as in src/routes/fundraise.ts,
// whose session, ownership and same origin checks these reuse; the session cookie is scoped to
// /api/fundraise/manage, so everything of theirs lives under it):
//   GET  /api/fundraise/manage/thanks                     their fundraisers, each with the gifts to pick
//                                                         and the thank yous sent so far
//   POST /api/fundraise/manage/fundraisers/:id/thanks     { message, donationIds }: waits for staff
//
// Staff, Admin > Fundraising (section "fundraising": view to look, edit to decide):
//   GET  /api/admin/fundraising/thanks-waiting                 how many wait on each sign up   view
//   GET  /api/admin/fundraisers/:id/thanks                     a sign up's thank yous          view
//   POST /api/admin/fundraisers/:id/thanks/:thanksId/approve   approve and send                edit
//   POST /api/admin/fundraisers/:id/thanks/:thanksId/reject    { reason? }: don't send         edit
//
// What keeps givers private: the organiser only ever gets the safe fields the gifts list already
// shows (a name or Anonymous, the amount unless hidden, the message, the date), a gift's id to tick,
// and how many a thank you reached. Never an address, a full name, or why a giver was skipped. The
// gifts they may pick are checked in the database to be gifts on THEIR fundraiser, so made up or
// borrowed ids store nothing. Approving answers staff first; the emails then go in the background,
// one at a time, each checked against the suppression list at that moment. Request and response
// shapes: README.md, "Thank your supporters (TASK-507)".

export const fundraiserThanksRouter = Router();

function fieldErrors(issues: ZodIssue[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path.join(".") || "form";
    const top = key.split(".")[0];
    if (!(top in out)) out[top] = issue.message;
  }
  return out;
}

function positiveId(value: unknown): number | null {
  const s = String(value ?? "");
  if (!/^[1-9]\d{0,9}$/.test(s)) return null;
  const n = Number(s);
  return n <= 2147483647 ? n : null;
}

const BAD_GIFT = { error: "Some of those gifts cannot be thanked. Please refresh the page and try again." };
const NONE_LEFT = { error: "You have already thanked every gift you picked." };
const LIMIT = { error: "You have sent 3 thank yous in the last day. Please try again tomorrow." };
const TRY_LATER = { error: "We could not send your thank you just now. Please try again in a few minutes." };
const UNAVAILABLE = { error: "Admin is temporarily unavailable" };

/** Start the background sender, after the answer. It never throws; this catches anything that slips. */
function sendInBackground(): void {
  void Promise.resolve()
    .then(() => sendQueuedThanks())
    .catch((err: unknown) => {
      console.error("fundraising thank you sending failed to start:", err instanceof Error ? err.message : err);
    });
}

// --- the organiser --------------------------------------------------------------------------------

export async function getOrganiserThanks(req: Request, res: Response): Promise<Response | void> {
  try {
    const s = await signedIn(req, res);
    if (!s) return;
    const mine = await listForOrganiser(s.email);
    const ids = mine.map((f) => f.id);
    const [held, thanks, gifts] = await Promise.all([heldDonationIds(ids), listThanks(ids), Promise.all(mine.map((f) => wallRows(f.id)))]);
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      fundraisers: mine.map((f, i) => ({
        id: f.id,
        canThank: f.status === "approved" || f.status === "finished",
        // In memory: only givers who asked to let the family know, with no amounts.
        gifts: isInMemory(f) ? familyThankable(gifts[i], held) : thankableGifts(gifts[i], held),
        thanks: thanks.filter((t) => t.fundraiserId === f.id).map(forOrganiser),
      })),
    });
  } catch (err) {
    console.error("fundraiser thanks read failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "This is temporarily unavailable" });
  }
}

export async function postOrganiserThanks(req: Request, res: Response): Promise<Response | void> {
  try {
    if (!fromOurOwnPage(req, res)) return;
    res.setHeader("Cache-Control", "no-store");
    const s = await signedIn(req, res);
    if (!s) return;
    const f = await ownFundraiser(req, res, s);
    if (!f) return;
    const parsed = thanksPostSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "Your thank you needs another look", fields: fieldErrors(parsed.error.issues) });
    }
    const out = await createThanks(f.id, s.email, parsed.data.message, parsed.data.donationIds);
    if (out.verdict === "limit") return res.status(429).json(LIMIT);
    if (out.verdict === "bad_gift") return res.status(400).json(BAD_GIFT);
    if (out.verdict === "none") return res.status(409).json(NONE_LEFT);
    return res.status(202).json({ status: "waiting", alreadyThanked: out.alreadyThanked, thanks: forOrganiser(out.thanks) });
  } catch (err) {
    if (err instanceof ThanksError && err.reason === "not_found") return res.status(404).json({ error: "Not found" });
    if (err instanceof ThanksError && err.reason === "bad_status") {
      return res.status(410).json({ error: "This fundraiser can no longer send thank yous. Please email events@nbcc.scot." });
    }
    console.error("fundraiser thanks post failed:", err instanceof Error ? err.message : err);
    return res.status(500).json(TRY_LATER);
  }
}

// --- staff ----------------------------------------------------------------------------------------

// Who did it, in the audit log: exactly as actorOf in ./admin writes it. Not imported from there, as
// that module loads the Stripe client and all the admin routes with it.
const actorOf = (claims: AdminSessionClaims): string => `admin:${claims.email}`;

const OUTCOME_WORDS: Record<string, string> = {
  waiting: "Waiting for you to check",
  queued: "Waiting to send",
  sending: "Sending",
  sent: "Sent",
  failed: "Not sent: the email failed",
  cancelled: "Not sent",
};

export async function getThanksWaiting(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "fundraising", "view"))) return;
  try {
    const counts = await pendingThanksByFundraiser();
    // Gifts left queued (a restart part way through sending, say) are picked up again here, the next
    // time anyone opens Admin > Fundraising. Best effort, and never in the way of the answer.
    hasQueuedThanks()
      .then((queued) => {
        if (queued) sendInBackground();
      })
      .catch(() => undefined);
    return res.status(200).json({ counts });
  } catch (err) {
    console.error("admin fundraiser thanks count failed:", err instanceof Error ? err.message : err);
    return res.status(500).json(UNAVAILABLE);
  }
}

export async function getAdminThanks(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "fundraising", "view"))) return;
  const id = positiveId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });
  try {
    const rows = await listThanksForStaff(id);
    return res.status(200).json({
      thanks: rows.map((t) => ({
        ...t,
        statusWords: thanksStatusWords(t),
        recipients: t.recipients.map((g) => ({
          donationId: g.donationId,
          name: g.name,
          amountPence: g.amountPence,
          outcome: g.outcome,
          outcomeWords: g.outcome === "skipped" && g.skipReason ? `Not sent: ${SKIP_WORDS[g.skipReason]}` : (OUTCOME_WORDS[g.outcome] ?? g.outcome),
          sentAt: g.sentAt,
        })),
      })),
    });
  } catch (err) {
    console.error("admin fundraiser thanks read failed:", err instanceof Error ? err.message : err);
    return res.status(500).json(UNAVAILABLE);
  }
}

const reasonSchema = z.object({ reason: z.string().trim().max(500).optional() });

function decision(which: ThanksDecision) {
  return async (req: Request, res: Response): Promise<Response | void> => {
    const claims = await authorizeSection(req, res, "fundraising", "edit");
    if (!claims) return;
    const id = positiveId(req.params.id);
    const thanksId = positiveId(req.params.thanksId);
    if (!id || !thanksId) return res.status(400).json({ error: "Invalid id" });
    let reason: string | null = null;
    if (which === "reject") {
      const parsed = reasonSchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ error: "Keep the reason to 500 characters or fewer" });
      reason = parsed.data.reason ? parsed.data.reason : null;
    }
    let row;
    try {
      row = await decideThanks(id, thanksId, which, actorOf(claims), reason);
    } catch (err) {
      if (err instanceof ThanksError && err.reason === "not_found") return res.status(404).json({ error: "That no longer exists" });
      if (err instanceof ThanksError) return res.status(409).json({ error: "That thank you has already been dealt with. Look again." });
      console.error(`admin fundraiser thanks ${which} failed:`, err instanceof Error ? err.message : err);
      return res.status(500).json(UNAVAILABLE);
    }
    res.status(200).json({ thanks: { ...row, statusWords: thanksStatusWords(row) } });
    // Approved: the emails go in the background, after the answer, so staff are not kept waiting.
    if (which === "approve") sendInBackground();
    return res;
  };
}

export const postApproveThanks = decision("approve");
export const postRejectThanks = decision("reject");

fundraiserThanksRouter.get("/api/fundraise/manage/thanks", getOrganiserThanks);
fundraiserThanksRouter.post("/api/fundraise/manage/fundraisers/:id/thanks", postOrganiserThanks);
fundraiserThanksRouter.get("/api/admin/fundraising/thanks-waiting", getThanksWaiting);
fundraiserThanksRouter.get("/api/admin/fundraisers/:id/thanks", getAdminThanks);
fundraiserThanksRouter.post("/api/admin/fundraisers/:id/thanks/:thanksId/approve", postApproveThanks);
fundraiserThanksRouter.post("/api/admin/fundraisers/:id/thanks/:thanksId/reject", postRejectThanks);
