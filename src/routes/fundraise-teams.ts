import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { createRateLimiter } from "../portal/request-limiter";
import { captchaEnabled, verifyCaptcha } from "../clients/turnstile";
import { config } from "../config";
import { createFundraiser, fundraisingIsOn, getBySlug } from "../db/fundraisers";
import { confirmHandover, findTeamInviteByHash, linkMember, listTeamMembers, removeTeamMember, TeamError } from "../db/fundraising-teams";
import { hasPage, type FundraiserRecord } from "../fundraising/model";
import { readCode, signInCodeMatches } from "../fundraising/sign-in";
import {
  checkJoin,
  forwardMessage,
  handoverCodeKey,
  hashTeamInviteToken,
  isCurrentMember,
  joinUrl,
  memberSignUp,
  readTeamInviteToken,
} from "../fundraising/teams";
import { sendJoinEmails, sendMemberRemovedEmail } from "../fundraising/team-send";
import { fromOurOwnPage, ownFundraiser, signedIn } from "./fundraise";
import { trapFilled } from "../fundraising/signup-tidy";

// Team pages (Jaimie, 2026-10-03): the public side of a team. Everything is OFF while fundraising
// is switched off, like the rest of fundraising.
//
//   POST /api/fundraise/teams/:slug/join            the join form: a member page waiting for staff,
//                                                   linked to the team (honeypot, per address limit,
//                                                   the spam check like the sign up form)
//   POST /api/fundraise/team-invite      { token }  an invite's link: { firstName, lastName, email,
//                                                   teamSlug } to fill in the join form, nothing else
//   GET  /api/fundraise/manage/fundraisers/:id/team                 the team organiser's own team:
//                                                   the join link, the message to forward, members
//   POST /api/fundraise/manage/fundraisers/:id/team/members/:memberId/remove
//                                                   take someone off the team (staff are told)
//   POST /api/fundraise/manage/handover  { email, code }  the new team organiser confirms a handover
//                                                   staff started, with the code we emailed them
//
// The private area's rules (src/routes/fundraise.ts) apply to the two in it: signed in with an
// emailed code, only the organiser's own team, and every change refused unless our own page sent it.

export const fundraiseTeamsRouter = Router();

type Fields = Record<string, string>;
const NOT_FOUND = { error: "This team is not taking new members just now." };
const TOO_MANY = { error: "Too many tries. Please wait a few minutes and try again." };

/** Exempt from the limits exactly as the sign up form is: only a request made on the box itself. */
function isLoopback(req: Request): boolean {
  const ip = req.ip ?? "";
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

const base = () => config.PORTAL_BASE_URL.replace(/\/+$/, "");

/** An approved team, while fundraising is on, or null. */
async function openTeam(slug: string): Promise<(FundraiserRecord & { meter: unknown }) | null> {
  if (!(await fundraisingIsOn())) return null;
  const t = await getBySlug(slug);
  return t && t.isTeam && t.status === "approved" ? t : null;
}

// --- joining -------------------------------------------------------------------------------------------

const joinLimiter = createRateLimiter({ max: 5, windowMs: 10 * 60_000 });

export async function postJoinTeam(req: Request, res: Response): Promise<Response> {
  if (trapFilled(req.body)) {
    console.warn("team join: trap box filled in");
    return res.status(200).json({ status: "received" });
  }
  if (!isLoopback(req) && !joinLimiter.allow(req.ip ?? "unknown", Date.now())) {
    return res.status(429).json({ error: "Too many sign ups. Please try again shortly." });
  }
  try {
    const team = await openTeam(String(req.params.slug ?? ""));
    if (!team) return res.status(404).json(NOT_FOUND);
    if (captchaEnabled()) {
      const verdict = await verifyCaptcha(req.body?.captchaToken, req.ip);
      if (verdict.outcome === "refused") return res.status(400).json({ error: "captcha" });
      if (verdict.outcome === "unavailable") console.error("team join captcha unavailable, join kept:", verdict.reason);
    }
    const checked = checkJoin(req.body, team);
    if (!checked.join) return res.status(400).json({ error: "Some of the form needs another look", fields: checked.fields as Fields });
    const token = readTeamInviteToken(req.body?.invite);
    const inviteHash = token ? hashTeamInviteToken(token) : null;
    const member = await createFundraiser(memberSignUp(team, checked.join), (client, id) => linkMember(client, id, team.id, inviteHash));
    await sendJoinEmails(member, team);
    return res.status(200).json({ status: "received" });
  } catch (err) {
    if (err instanceof TeamError && err.reason === "team_closed") return res.status(404).json(NOT_FOUND);
    console.error("team join failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "We could not take your sign up right now. Please try again later." });
  }
}

// --- an invite's link ----------------------------------------------------------------------------------

const prefillLimiter = createRateLimiter({ max: 30, windowMs: 15 * 60_000 });
const GONE = { error: "That invite link no longer fills the form in. You can still fill it in yourself." };

export async function postTeamInvitePrefill(req: Request, res: Response): Promise<Response> {
  res.setHeader("Cache-Control", "no-store");
  if (!isLoopback(req) && !prefillLimiter.allow(req.ip ?? "unknown", Date.now())) return res.status(429).json(TOO_MANY);
  const token = readTeamInviteToken(req.body?.token);
  if (!token) return res.status(404).json(GONE);
  try {
    // Only while fundraising is on, and only for a team still taking members.
    if (!(await fundraisingIsOn())) return res.status(404).json(GONE);
    const inv = await findTeamInviteByHash(hashTeamInviteToken(token));
    if (!inv || inv.teamStatus !== "approved" || inv.deletedAt || inv.joinedAt || !inv.sentAt || !inv.firstName || !inv.email) return res.status(404).json(GONE);
    return res.status(200).json({ firstName: inv.firstName, lastName: inv.lastName ?? "", email: inv.email, teamSlug: inv.teamSlug });
  } catch (err) {
    console.error("team invite lookup failed:", err instanceof Error ? err.message : err);
    return res.status(503).json({ error: "We could not fill this in just now. You can still fill in the form." });
  }
}

// --- the team organiser's private area -----------------------------------------------------------------

const STATUS_WORDS: Record<FundraiserRecord["status"], string> = { new: "waiting", approved: "live", declined: "declined", finished: "finished" };

/** The team organiser's own team: the join link, the message to forward, and who has joined. */
export async function getManageTeam(req: Request, res: Response): Promise<Response | void> {
  try {
    const s = await signedIn(req, res);
    if (!s) return;
    const team = await ownFundraiser(req, res, s);
    if (!team) return;
    if (!team.isTeam) return res.status(404).json({ error: "Not found" });
    const link = joinUrl(base(), team.slug);
    const members = (await listTeamMembers(team.id))
      .filter(isCurrentMember)
      .sort((a, b) => a.name.localeCompare(b.name, "en-GB", { sensitivity: "base" }) || a.id - b.id)
      // Their name, where their page is up to and what it has raised: never their email.
      .map((m) => ({
        id: m.id,
        name: m.name,
        status: STATUS_WORDS[m.status],
        raisedPence: m.meter.raisedPence,
        targetPence: m.meter.targetPence,
        pageUrl: hasPage(m) ? `${base()}/fundraise/${m.slug}` : null,
      }));
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ joinUrl: link, forwardMessage: forwardMessage(team, link), shareMode: team.teamShareMode ?? null, members });
  } catch (err) {
    console.error("team private area read failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "This page is temporarily unavailable" });
  }
}

export async function postRemoveTeamMember(req: Request, res: Response): Promise<Response | void> {
  try {
    if (!fromOurOwnPage(req, res)) return;
    const s = await signedIn(req, res);
    if (!s) return;
    const team = await ownFundraiser(req, res, s);
    if (!team) return;
    const memberId = Number(req.params.memberId);
    if (!team.isTeam || !Number.isSafeInteger(memberId) || memberId <= 0) return res.status(404).json({ error: "Not found" });
    const { team: t, member } = await removeTeamMember(team.id, memberId, s.email);
    await sendMemberRemovedEmail(t, member);
    return res.status(200).json({ status: "removed", memberId });
  } catch (err) {
    if (err instanceof TeamError) return res.status(404).json({ error: "That person is no longer on your team." });
    console.error("team member removal failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "We could not do that just now. Please try again in a few minutes." });
  }
}

// --- confirming a handover -----------------------------------------------------------------------------

const handoverSchema = z.object({ email: z.string().trim().email().max(254), code: z.unknown() });
const handoverEmailLimiter = createRateLimiter({ max: 10, windowMs: 15 * 60_000 });
const handoverIpLimiter = createRateLimiter({ max: 30, windowMs: 15 * 60_000 });
export const HANDOVER_WRONG = "That code does not work. Check it and your email address, or ask us to send a new one.";

export async function postHandoverConfirm(req: Request, res: Response): Promise<Response | void> {
  if (!fromOurOwnPage(req, res)) return;
  const parsed = handoverSchema.safeParse(req.body);
  const code = parsed.success ? readCode(parsed.data.code) : null;
  if (!parsed.success || !code) return res.status(400).json({ error: "Please put in your email address and the 6 digit code." });
  const email = parsed.data.email.toLowerCase();
  if (!isLoopback(req)) {
    const now = Date.now();
    const emailOk = handoverEmailLimiter.allow(email, now);
    const ipOk = handoverIpLimiter.allow(req.ip ?? "unknown", now);
    if (!emailOk || !ipOk) return res.status(429).json(TOO_MANY);
  }
  try {
    if (!(await fundraisingIsOn())) return res.status(404).json({ error: "Not found" });
    const secret = config.ADMIN_SESSION_SECRET;
    const r = await confirmHandover(email, (h) => signInCodeMatches(handoverCodeKey(h.teamId, email), code, h.codeHash, secret), new Date());
    if (r.status !== "ok") return res.status(401).json({ error: HANDOVER_WRONG });
    return res.status(200).json({ status: "ok", title: r.team.title });
  } catch (err) {
    console.error("team handover confirm failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "We could not do that just now. Please try again in a few minutes." });
  }
}

fundraiseTeamsRouter.post("/api/fundraise/teams/:slug/join", postJoinTeam);
fundraiseTeamsRouter.post("/api/fundraise/team-invite", postTeamInvitePrefill);
fundraiseTeamsRouter.get("/api/fundraise/manage/fundraisers/:id/team", getManageTeam);
fundraiseTeamsRouter.post("/api/fundraise/manage/fundraisers/:id/team/members/:memberId/remove", postRemoveTeamMember);
fundraiseTeamsRouter.post("/api/fundraise/manage/handover", postHandoverConfirm);
