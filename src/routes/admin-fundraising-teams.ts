import { Router, type Request, type Response } from "express";
import { authorizeSection } from "./admin-authz";
import type { AdminSessionClaims } from "../admin/session";
import { config } from "../config";
import { fundraisingIsOn, getFundraiser } from "../db/fundraisers";
import { cancelHandover, listTeamInvites, listTeamMembers, openHandoverFor, removeTeamMemberByStaff, startHandover, TeamError } from "../db/fundraising-teams";
import { hasPage, type FundraiserRecord } from "../fundraising/model";
import { hashSignInCode, newSignInCode } from "../fundraising/sign-in";
import { HANDOVER_CODE_TTL_MS, handoverCodeKey, handoverSchema, inviteStatus, joinUrl, teamMeter } from "../fundraising/teams";
import { sendHandoverCodeEmail } from "../fundraising/team-send";

// Team pages (Jaimie, 2026-10-03): Admin > Fundraising, for teams. Section "fundraising": viewers
// look; editors and admins hand the team organiser role over (staff only: no self service).
//
//   GET  /api/admin/fundraisers/:id/team                     a team: its members (every status, A to
//                                                            Z), its invites, its split, its combined
//                                                            meter and any handover still open; a
//                                                            member page: which team it is joining
//   POST /api/admin/fundraisers/:id/team/handover  { memberId, phone? } or { firstName, lastName,
//                                                  email, phone }: email the new team organiser a
//                                                  code; it changes nothing until they confirm it
//   POST /api/admin/fundraisers/:id/team/handover/cancel     cancel the handover still open
//   POST /api/admin/fundraisers/:id/team/members/:memberId/remove
//                                                            take someone off the team (editors and
//                                                            admins): as the team organiser's remove

export const adminFundraisingTeamsRouter = Router();

const UNAVAILABLE = { error: "Admin is temporarily unavailable" };

// As src/routes/admin.ts names who did it, without loading that router (and Stripe) here.
const actorOf = (claims: AdminSessionClaims): string => `admin:${claims.email}`;

function idOf(req: Request, res: Response): number | null {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id" });
    return null;
  }
  return id;
}

const base = () => config.PORTAL_BASE_URL.replace(/\/+$/, "");

/** The split, in words, for staff. */
export function teamSplitWords(t: Pick<FundraiserRecord, "sharesWithOther" | "nbccSharePercent" | "otherCauseName" | "teamShareMode">): string {
  if (t.sharesWithOther !== true) return "Not sharing with another cause: everything comes to NBCC.";
  const split = `${t.nbccSharePercent}% with NBCC, the rest to ${t.otherCauseName}`;
  return t.teamShareMode === "team"
    ? `The whole team’s split: every member page shares ${split}.`
    : `Just the team organiser’s split (${split}): each member is asked when they join.`;
}

export async function getAdminTeam(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "fundraising", "view"))) return;
  const id = idOf(req, res);
  if (id === null) return;
  try {
    const f = await getFundraiser(id);
    if (!f) return res.status(404).json({ error: "That no longer exists" });
    if (f.teamId) {
      const t = await getFundraiser(f.teamId);
      return res.status(200).json({
        kind: "member",
        left: Boolean(f.teamLeftAt),
        team: t ? { id: t.id, title: t.title, slug: t.slug, shareMode: t.teamShareMode ?? null, status: t.status } : null,
      });
    }
    if (!f.isTeam) return res.status(200).json({ kind: "none" });
    const [members, invites, handover] = await Promise.all([listTeamMembers(id), listTeamInvites(id), openHandoverFor(id)]);
    const counting = members.filter((m) => !m.teamLeftAt && (m.status === "approved" || m.status === "finished"));
    return res.status(200).json({
      kind: "team",
      shareMode: f.teamShareMode ?? null,
      split: teamSplitWords(f),
      joinUrl: joinUrl(base(), f.slug),
      meter: teamMeter(f.meter, counting.map((m) => m.meter), f.targetPence),
      members: [...members]
        .sort((a, b) => a.name.localeCompare(b.name, "en-GB", { sensitivity: "base" }) || a.id - b.id)
        .map((m) => ({
          id: m.id,
          name: m.name,
          email: m.email,
          status: m.status,
          left: Boolean(m.teamLeftAt),
          raisedPence: m.meter.raisedPence,
          targetPence: m.meter.targetPence,
          pageUrl: hasPage(m) ? `${base()}/fundraise/${m.slug}` : null,
        })),
      invites: invites.map((i) => ({
        id: i.id,
        name: i.firstName ? `${i.firstName} ${i.lastName ?? ""}`.trim() : null,
        email: i.email,
        under18: i.under18 === true,
        status: inviteStatus(i),
        createdAt: i.createdAt,
        sentAt: i.sentAt,
        remindedAt: i.remindedAt,
        joinedAt: i.joinedAt,
        deletedAt: i.deletedAt,
      })),
      handover,
    });
  } catch (err) {
    console.error("admin team read failed:", err instanceof Error ? err.message : err);
    return res.status(500).json(UNAVAILABLE);
  }
}

function fieldErrors(issues: Array<{ path: Array<string | number>; message: string }>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of issues) {
    const k = i.path.join(".") || "form";
    if (!(k in out)) out[k] = i.message;
  }
  return out;
}

export async function postAdminHandover(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "fundraising", "edit");
  if (!claims) return;
  const id = idOf(req, res);
  if (id === null) return;
  const parsed = handoverSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Some of it needs another look", fields: fieldErrors(parsed.error.issues) });
  try {
    // Nothing team related emails anyone while fundraising is off.
    if (!(await fundraisingIsOn())) {
      return res.status(409).json({ error: "Fundraising is switched off, so we cannot email the code. Switch fundraising on first." });
    }
    const team = await getFundraiser(id);
    if (!team) return res.status(404).json({ error: "That no longer exists" });
    if (!team.isTeam) return res.status(409).json({ error: "Only a team has a team organiser to hand over." });
    let to: { firstName: string; lastName: string; email: string; phone: string };
    if ("memberId" in parsed.data) {
      const m = await getFundraiser(parsed.data.memberId);
      // Only someone whose member page staff have approved, still on the team (or someone new).
      if (!m || m.teamId !== id || m.teamLeftAt || m.status !== "approved") {
        return res.status(400).json({ error: "Choose someone whose page we have approved, on this team." });
      }
      const words = m.name.trim().split(/\s+/);
      to = { firstName: m.firstName || words[0], lastName: m.lastName || words.slice(1).join(" ") || words[0], email: m.email, phone: parsed.data.phone ?? "" };
    } else {
      to = parsed.data;
    }
    // The code goes only in the email; only its keyed hash is stored, bound to this team and email.
    const code = newSignInCode();
    const codeHash = hashSignInCode(handoverCodeKey(id, to.email), code, config.ADMIN_SESSION_SECRET);
    await startHandover(id, to, codeHash, new Date(Date.now() + HANDOVER_CODE_TTL_MS), actorOf(claims));
    const emailed = await sendHandoverCodeEmail(to, team, code);
    return res.status(200).json({ handover: await openHandoverFor(id), emailed });
  } catch (err) {
    if (err instanceof TeamError) return res.status(409).json({ error: "Only a team has a team organiser to hand over." });
    console.error("admin team handover failed:", err instanceof Error ? err.message : err);
    return res.status(500).json(UNAVAILABLE);
  }
}

export async function postAdminHandoverCancel(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "fundraising", "edit");
  if (!claims) return;
  const id = idOf(req, res);
  if (id === null) return;
  try {
    return res.status(200).json({ cancelled: await cancelHandover(id, actorOf(claims)) });
  } catch (err) {
    console.error("admin team handover cancel failed:", err instanceof Error ? err.message : err);
    return res.status(500).json(UNAVAILABLE);
  }
}

/**
 * Staff take someone off a team: the same effect as the team organiser's remove (their page carries on
 * as their own, no longer counting on the team), recorded against the member of staff.
 */
export async function postAdminRemoveMember(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "fundraising", "edit");
  if (!claims) return;
  const id = idOf(req, res);
  if (id === null) return;
  const memberId = Number(req.params.memberId);
  if (!Number.isInteger(memberId) || memberId <= 0) return res.status(400).json({ error: "Invalid id" });
  try {
    await removeTeamMemberByStaff(id, memberId, actorOf(claims));
    return res.status(200).json({ removed: memberId });
  } catch (err) {
    if (err instanceof TeamError) return res.status(404).json({ error: "That person is no longer on this team." });
    console.error("admin team member removal failed:", err instanceof Error ? err.message : err);
    return res.status(500).json(UNAVAILABLE);
  }
}

adminFundraisingTeamsRouter.get("/api/admin/fundraisers/:id/team", getAdminTeam);
adminFundraisingTeamsRouter.post("/api/admin/fundraisers/:id/team/members/:memberId/remove", postAdminRemoveMember);
adminFundraisingTeamsRouter.post("/api/admin/fundraisers/:id/team/handover", postAdminHandover);
adminFundraisingTeamsRouter.post("/api/admin/fundraisers/:id/team/handover/cancel", postAdminHandoverCancel);
