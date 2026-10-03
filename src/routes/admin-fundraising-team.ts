import { Router, type Request, type Response } from "express";
import { z, type ZodIssue } from "zod";
import { authorizeSection, authorizeSectionAsAdmin } from "./admin-authz";
import { actorOf } from "./admin";
import { config } from "../config";
import { listAllFundraisers } from "../db/fundraisers";
import {
  countRecentInvites,
  createInvite,
  getSigner,
  getSummarySettings,
  listFundraiserCalls,
  listOpenInvites,
  listSigners,
  recordFundraiserCall,
  removeInvite,
  resendInvite,
  saveSummaryRecipients,
  setOffList,
  TeamError,
  type InviteRow,
} from "../db/fundraising-team";
import { sendFundraiseInvite } from "../clients/email";
import {
  INVITES_PER_DAY,
  INVITE_REFRESH,
  hashInviteToken,
  inviteCc,
  inviteSchema,
  inviteUrl,
  inviteVerdict,
  newInviteToken,
} from "../fundraising/invite";
import { CALL_WHICH, callStates, followUpToday, offListPrompt, type CallRecord, type CallStates } from "../fundraising/follow-up";
import { summaryRecipientsSchema } from "../fundraising/summary";
import { buildInviteEmail } from "../fundraising/team-emails";
import { sendSummaryTest } from "../fundraising/summary-runner";

// TASK-503: the fundraising team's tools, in Admin > Fundraising. Section "fundraising": viewers
// look, editors and admins act, and the Monday summary's list is for admins only (like the switch).
// Its own router, beside src/routes/admin-fundraising.ts, so nothing there changes.
//
//   GET    /api/admin/fundraising/team                     calls, prompts, open invites, signers  view
//   POST   /api/admin/fundraising/invites                  { firstName, lastName, email, note?, signedBy }  edit
//   POST   /api/admin/fundraising/invites/:id/resend       a new link, emailed again             edit
//   DELETE /api/admin/fundraising/invites/:id              its link stops working                edit
//   POST   /api/admin/fundraisers/:id/calls                { which, note? }                      edit
//   POST   /api/admin/fundraisers/:id/off-list             take it off Get involved              edit
//   POST   /api/admin/fundraisers/:id/on-list              put it back                           edit
//   GET    /api/admin/fundraising/summary                  who gets the Monday summary           admin
//   PUT    /api/admin/fundraising/summary                  { recipients: [emails] }              admin
//   POST   /api/admin/fundraising/summary/test             the summary, to the admin asking      admin
//
// An invite's token goes only in the email, never back to the page, and only its hash is kept.
// The invite (and a resend) copies in the member of staff who sent it, from their admin session
// (Jaimie 2026-10-03), so they have a copy; never the token anywhere else.
// Each member of staff may send 50 invites (and resends) a day. Every write records who did it in
// audit_log (src/db/fundraising-team.ts). Request and response shapes: README.md, "Community
// fundraising", the team's tools.

export const adminFundraisingTeamRouter = Router();

const UNAVAILABLE = { error: "Admin is temporarily unavailable" };
const TOO_MANY = { error: `You have sent ${INVITES_PER_DAY} invites today. Please send the rest tomorrow.` };

function fieldErrors(issues: ZodIssue[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path.join(".") || "form";
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

function idParam(req: Request, res: Response): number | null {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id" });
    return null;
  }
  return id;
}

function failed(res: Response, what: string, err: unknown, notFound = "That no longer exists"): Response {
  if (err instanceof TeamError) {
    if (err.reason === "not_found") return res.status(404).json({ error: notFound });
    if (err.reason === "bad_status") return res.status(409).json({ error: "Only an approved fundraiser can be taken off Get involved" });
  }
  console.error(`admin fundraising ${what} failed:`, err instanceof Error ? err.message : err);
  return res.status(500).json(UNAVAILABLE);
}

const base = () => config.PORTAL_BASE_URL.replace(/\/+$/, "");

// Email the invite with a fresh token, greeting them by first name and copying in the member of
// staff sending it (`senderEmail`, from their session; left off when missing, never failing the
// invite). Best effort: the invite stands either way; true when it went.
async function emailInvite(
  inv: Pick<InviteRow, "name" | "firstName" | "email" | "note" | "signedBy">,
  token: string,
  senderEmail: string | null | undefined,
): Promise<boolean> {
  try {
    const mail = buildInviteEmail({ firstName: inv.firstName, note: inv.note, signer: inv.signedBy, url: inviteUrl(base(), token) });
    const cc = inviteCc(senderEmail, inv.email);
    await sendFundraiseInvite(inv.name, {
      email: inv.email,
      ...(cc ? { cc } : {}),
      from: config.BALL_FROM_EMAIL,
      replyTo: config.BALL_FROM_EMAIL,
      ...mail,
    });
    return true;
  } catch (err) {
    // Never the token or the link.
    console.error("admin fundraising invite email failed:", err instanceof Error ? err.message : err);
    return false;
  }
}

// --- the team's tools, read together --------------------------------------------------------------

export async function getFundraisingTeam(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "fundraising", "view");
  if (!claims) return;
  try {
    const now = new Date();
    const today = followUpToday(now);
    const [fundraisers, allCalls, invites, signers] = await Promise.all([
      listAllFundraisers(),
      listFundraiserCalls(),
      listOpenInvites(),
      listSigners(),
    ]);
    const byId = new Map<number, CallRecord[]>();
    for (const c of allCalls) byId.set(c.fundraiserId, [...(byId.get(c.fundraiserId) ?? []), c]);
    const calls: Record<string, CallStates> = {};
    const prompts: Record<string, string> = {};
    for (const f of fundraisers) {
      if (f.eventDate) calls[String(f.id)] = callStates(f, byId.get(f.id) ?? [], today);
      const prompt = offListPrompt(f, today);
      if (prompt) prompts[String(f.id)] = prompt;
    }
    // An invite whose link is past its 60 days is still listed, marked expired, so it can be resent.
    const listed = invites.map((i) => ({
      ...i,
      expired: inviteVerdict({ createdAt: new Date(i.createdAt), resentAt: i.resentAt ? new Date(i.resentAt) : null, usedAt: null }, now) === "expired",
    }));
    return res.status(200).json({ today, me: claims.sub, calls, prompts, invites: listed, signers });
  } catch (err) {
    return failed(res, "team read", err);
  }
}

// --- invites -------------------------------------------------------------------------------------

export async function postInvite(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "fundraising", "edit");
  if (!claims) return;
  const parsed = inviteSchema.safeParse(req.body);
  if (!parsed.success) {
    // A page loaded before the two name boxes, with a one word name: no box to point at.
    if (parsed.error.issues.some((i) => i.message === INVITE_REFRESH)) return res.status(400).json({ error: INVITE_REFRESH });
    return res.status(400).json({ error: "Some of it needs another look", fields: fieldErrors(parsed.error.issues) });
  }
  try {
    const signer = await getSigner(parsed.data.signedBy);
    if (!signer) return res.status(400).json({ error: "Some of it needs another look", fields: { signedBy: "Choose who it is from." } });
    if ((await countRecentInvites(actorOf(claims))) >= INVITES_PER_DAY) return res.status(429).json(TOO_MANY);
    const token = newInviteToken();
    const inv = await createInvite(
      {
        firstName: parsed.data.firstName,
        lastName: parsed.data.lastName,
        email: parsed.data.email,
        note: parsed.data.note,
        signedBy: signer.firstName,
        cc: inviteCc(claims.email, parsed.data.email) ?? null,
        tokenHash: hashInviteToken(token),
      },
      actorOf(claims),
    );
    const emailed = await emailInvite(inv, token, claims.email);
    return res.status(201).json({ invite: inv, emailed });
  } catch (err) {
    return failed(res, "invite", err);
  }
}

export async function postResendInvite(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "fundraising", "edit");
  if (!claims) return;
  const id = idParam(req, res);
  if (id === null) return;
  try {
    if ((await countRecentInvites(actorOf(claims))) >= INVITES_PER_DAY) return res.status(429).json(TOO_MANY);
    const token = newInviteToken();
    const inv = await resendInvite(id, hashInviteToken(token), actorOf(claims), claims.email);
    const emailed = await emailInvite(inv, token, claims.email);
    return res.status(200).json({ invite: inv, emailed });
  } catch (err) {
    return failed(res, "invite resend", err, "That invite has been taken up or removed");
  }
}

export async function deleteInvite(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "fundraising", "edit");
  if (!claims) return;
  const id = idParam(req, res);
  if (id === null) return;
  try {
    await removeInvite(id, actorOf(claims));
    return res.status(200).json({ removed: id });
  } catch (err) {
    return failed(res, "invite remove", err, "That invite has been taken up or removed");
  }
}

// --- calls ---------------------------------------------------------------------------------------

// Which call, and an optional note of up to 500 characters. Nothing else: the time is the server's,
// so a call cannot be backdated from the page.
const callSchema = z
  .object({
    which: z.enum(CALL_WHICH as [string, ...string[]], { errorMap: () => ({ message: "Say which call it was." }) }),
    note: z.string().max(500, "A note can be up to 500 characters.").optional(),
  })
  .strict();

export async function postFundraiserCall(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "fundraising", "edit");
  if (!claims) return;
  const id = idParam(req, res);
  if (id === null) return;
  const parsed = callSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Say which call it was." });
  const note = parsed.data.note?.trim() || null;
  try {
    const call = await recordFundraiserCall(id, parsed.data.which as "before" | "after", note, claims.email, actorOf(claims));
    return res.status(200).json({ call });
  } catch (err) {
    return failed(res, "call", err, "That fundraiser no longer exists, or has no date");
  }
}

// --- Get involved --------------------------------------------------------------------------------

function listChoice(off: boolean) {
  return async (req: Request, res: Response): Promise<Response | void> => {
    const claims = await authorizeSection(req, res, "fundraising", "edit");
    if (!claims) return;
    const id = idParam(req, res);
    if (id === null) return;
    try {
      return res.status(200).json(await setOffList(id, off, actorOf(claims)));
    } catch (err) {
      return failed(res, off ? "off list" : "on list", err);
    }
  };
}

export const postOffList = listChoice(true);
export const postOnList = listChoice(false);

// --- the Monday summary ----------------------------------------------------------------------------

export async function getSummary(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSectionAsAdmin(req, res, "fundraising"))) return;
  try {
    return res.status(200).json(await getSummarySettings());
  } catch (err) {
    return failed(res, "summary read", err);
  }
}

const summaryBody = z.object({ recipients: z.array(z.unknown()) }).strict();

export async function putSummary(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSectionAsAdmin(req, res, "fundraising");
  if (!claims) return;
  const body = summaryBody.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "Send the list of email addresses." });
  const list = summaryRecipientsSchema.safeParse(body.data.recipients);
  if (!list.success) {
    const issue = list.error.issues[0];
    return res.status(400).json({ error: issue?.message ?? "Check the list of email addresses.", path: issue?.path ?? [] });
  }
  try {
    await saveSummaryRecipients(list.data, actorOf(claims));
    return res.status(200).json(await getSummarySettings());
  } catch (err) {
    return failed(res, "summary save", err);
  }
}

export async function postSummaryTest(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSectionAsAdmin(req, res, "fundraising");
  if (!claims) return;
  try {
    // Only ever to the admin asking.
    await sendSummaryTest(claims.email);
    return res.status(200).json({ sentTo: claims.email });
  } catch (err) {
    console.error("admin fundraising summary test failed:", err instanceof Error ? err.message : err);
    return res.status(502).json({ error: "The test did not go. Please try again in a moment." });
  }
}

adminFundraisingTeamRouter.get("/api/admin/fundraising/team", getFundraisingTeam);
adminFundraisingTeamRouter.post("/api/admin/fundraising/invites", postInvite);
adminFundraisingTeamRouter.post("/api/admin/fundraising/invites/:id/resend", postResendInvite);
adminFundraisingTeamRouter.delete("/api/admin/fundraising/invites/:id", deleteInvite);
adminFundraisingTeamRouter.post("/api/admin/fundraisers/:id/calls", postFundraiserCall);
adminFundraisingTeamRouter.post("/api/admin/fundraisers/:id/off-list", postOffList);
adminFundraisingTeamRouter.post("/api/admin/fundraisers/:id/on-list", postOnList);
adminFundraisingTeamRouter.get("/api/admin/fundraising/summary", getSummary);
adminFundraisingTeamRouter.put("/api/admin/fundraising/summary", putSummary);
adminFundraisingTeamRouter.post("/api/admin/fundraising/summary/test", postSummaryTest);
