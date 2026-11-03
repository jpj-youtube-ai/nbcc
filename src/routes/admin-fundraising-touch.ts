import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { authorizeSection, authorizeSectionAsAdmin } from "./admin-authz";
import { actorOf } from "./admin";
import { config } from "../config";
import {
  approveWording,
  getTouchSettings,
  listWordingApprovals,
  readTouchState,
  recordPromptCall,
  setTouchEmailsOn,
  TouchError,
  touchFundraiser,
  withdrawWording,
  type WordingApproval,
} from "../db/fundraising-touch";
import { callPrompts, PROMPT_KEYS, type CallPrompt, type PromptCall, type PromptKey } from "../fundraising/call-prompts";
import { sampleTouchData, touchEmailAsSent, touchEmailData } from "../fundraising/touch-emails";
import {
  isNewWording,
  NEW_WORDING_KINDS,
  pickTouch,
  TOUCH_KINDS,
  TOUCH_LABELS,
  TOUCH_WHEN,
  WORDING_KEYS,
  wordingKey,
  wordingKeysOf,
  type TouchKind,
  type TouchSent,
} from "../fundraising/touch-rules";
import { followUpToday } from "../fundraising/follow-up";
import { sampleTeamMemberJoinedEmail } from "../fundraising/team-page-emails";
import { TEAM_JOINED_KEY, TEAM_JOINED_LABEL, TEAM_JOINED_WHEN, TEAM_WORDING_KEYS } from "../fundraising/teams";

// TASK-515: keeping in touch, in Admin > Fundraising. Section "fundraising": viewers look, editors
// and admins record calls, and the Automatic emails switch is for admins only (like the
// fundraising switch). Its own router, beside the others, so nothing there changes.
//
//   GET  /api/admin/fundraising/touch                  the switch, every automatic email and when
//                                                      it goes, what each fundraiser has had, what
//                                                      the next 8am run would send (were it on),
//                                                      and the call prompts showing today          view
//   GET  /api/admin/fundraising/touch/preview/:kind    one email, rendered, for the invented sample
//        ?sample=zero                                  (with nothing raised yet)
//        ?fundraiserId=N                               or for that fundraiser                      view
//   PUT  /api/admin/fundraising/touch/settings         { on: true | false }                        admin
//   POST   /api/admin/fundraising/touch/approvals/:key approve one new wording (WORDING_KEYS, and
//                                                      "team_joined")                              admin
//   DELETE /api/admin/fundraising/touch/approvals/:key withdraw that approval                      admin
//   POST /api/admin/fundraisers/:id/prompt-calls       { prompt, note? }                           edit
//
// Jaimie's rule: every automatic email is readable here before any is sent. The switch ships OFF.
// And (2026-10-03) new wording only sends once an admin has approved it here.
//
// Jaimie, 2026-10-04: the email to a team organiser when staff approve a new team member's page
// ("[First name] has joined [team name]", src/fundraising/team-send.ts) is listed here too, after the
// nine to an organiser, as the kind "team_joined". It is new wording, read and approved here like the
// others (key "team_joined"), and it obeys the same switch. Its preview is always the invented example.
// Request and response shapes: README.md, "Community fundraising", keeping in touch.

export const adminFundraisingTouchRouter = Router();

const UNAVAILABLE = { error: "Admin is temporarily unavailable" };

function failed(res: Response, what: string, err: unknown): Response {
  if (err instanceof TouchError && err.reason === "not_found") return res.status(404).json({ error: "That fundraiser no longer exists" });
  console.error(`admin fundraising ${what} failed:`, err instanceof Error ? err.message : err);
  return res.status(500).json(UNAVAILABLE);
}

const isKind = (k: unknown): k is TouchKind => typeof k === "string" && (TOUCH_KINDS as readonly string[]).includes(k);
const isWordingKey = (k: unknown): k is string =>
  typeof k === "string" && ((WORDING_KEYS as readonly string[]).includes(k) || (TEAM_WORDING_KEYS as readonly string[]).includes(k));
// The approvals; when they cannot be read, none (so new wording reads as held, as the sender treats
// it) and the card says so, rather than failing whole.
async function readApprovals(): Promise<{ list: WordingApproval[]; unavailable: boolean }> {
  try {
    return { list: await listWordingApprovals(), unavailable: false };
  } catch (err) {
    console.error("admin fundraising: could not read the approved wordings:", err instanceof Error ? err.message : err);
    return { list: [], unavailable: true };
  }
}

const approvalMap = (list: WordingApproval[]) =>
  Object.fromEntries(list.map((a) => [a.key, { approvedAt: a.approvedAt, approvedBy: a.approvedBy }])) as Record<string, { approvedAt: string; approvedBy: string }>;
const base = () => config.PORTAL_BASE_URL.replace(/\/+$/, "");

// --- the overview ----------------------------------------------------------------------------------

export async function getTouch(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "fundraising", "view"))) return;
  try {
    const today = followUpToday(new Date());
    const [settings, state, read] = await Promise.all([getTouchSettings(), readTouchState(), readApprovals()]);
    const approvals = approvalMap(read.list);
    const approved = new Set(Object.keys(approvals));
    const sent: Record<string, TouchSent[]> = {};
    const prompts: Record<string, CallPrompt[]> = {};
    const promptCalls: Record<string, PromptCall[]> = {};
    // What the next 8am run would send, were the switch on: so nobody is surprised by the first one.
    // And what it would hold back, its new wording waiting for sign off.
    const due: Record<string, TouchKind> = {};
    const held: Record<string, TouchKind> = {};
    for (const s of state) {
      const id = String(s.f.id);
      if (s.touch.sent.length) sent[id] = s.touch.sent;
      const showing = callPrompts(s.f, s.prompt, today);
      if (showing.length) prompts[id] = showing;
      if (s.prompt.calls.length) promptCalls[id] = s.prompt.calls;
      // The same pick the daily run makes (touch-runner.ts).
      const pick = pickTouch(s.f, s.touch, today, approved);
      if (pick.kind) due[id] = pick.kind;
      if (pick.held.length) held[id] = pick.held[0];
    }
    const kinds = TOUCH_KINDS.map((kind) => ({
      kind,
      label: TOUCH_LABELS[kind],
      when: TOUCH_WHEN[kind],
      newWording: NEW_WORDING_KINDS.includes(kind),
      // The versions of it still waiting for sign off (its usual one, and the one with nothing raised).
      waiting: wordingKeysOf(kind).filter((k) => !approved.has(k)),
    }));
    // The email to a team organiser about a new member: new wording, signed off here with the rest.
    const teamJoined = {
      kind: TEAM_JOINED_KEY,
      label: TEAM_JOINED_LABEL,
      when: TEAM_JOINED_WHEN,
      newWording: true,
      waiting: approved.has(TEAM_JOINED_KEY) ? [] : [TEAM_JOINED_KEY],
    };
    return res
      .status(200)
      .json({ today, settings, kinds: [...kinds, teamJoined], approvals, approvalsUnavailable: read.unavailable, sent, prompts, promptCalls, due, held });
  } catch (err) {
    return failed(res, "keep in touch read", err);
  }
}

// --- one email, rendered ---------------------------------------------------------------------------

export async function getTouchPreview(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "fundraising", "view"))) return;
  const kind = req.params.kind;
  if (kind === TEAM_JOINED_KEY) return teamJoinedPreview(res);
  if (!isKind(kind)) return res.status(404).json({ error: "There is no automatic email of that kind" });
  const raw = (req.query ?? {}).fundraiserId;
  try {
    let data = sampleTouchData(kind, base());
    // The example with nothing raised yet: 16, 17 and 18 read differently then.
    if ((req.query ?? {}).sample === "zero") data = { ...data, raisedPence: 0 };
    let sample = true;
    if (raw !== undefined && raw !== "") {
      const id = Number(raw);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });
      // A team page with its whole team's total, as the daily run and Mark finished send it.
      const f = await touchFundraiser(id);
      if (!f) return res.status(404).json({ error: "That fundraiser no longer exists" });
      data = touchEmailData(f, base());
      sample = false;
    }
    // As the daily run sends it: on a page for someone under 18 it greets their parent or guardian.
    const mail = touchEmailAsSent(kind, data);
    const key = wordingKey(kind, data.raisedPence);
    const read = key ? await readApprovals() : { list: [], unavailable: false };
    const approval = key ? (approvalMap(read.list)[key] ?? null) : null;
    return res.status(200).json({
      kind,
      label: TOUCH_LABELS[kind],
      newWording: isNewWording(kind, data.raisedPence),
      wordingKey: key,
      approval,
      approvalsUnavailable: read.unavailable,
      sample,
      title: data.title,
      ...mail,
    });
  } catch (err) {
    return failed(res, "automatic email preview", err);
  }
}

// The email to a team organiser about a new member: always the invented example (it is about two
// people, so "Show it for" one fundraiser does not apply), with its sign off.
async function teamJoinedPreview(res: Response): Promise<Response> {
  try {
    const read = await readApprovals();
    return res.status(200).json({
      kind: TEAM_JOINED_KEY,
      label: TEAM_JOINED_LABEL,
      newWording: true,
      wordingKey: TEAM_JOINED_KEY,
      approval: approvalMap(read.list)[TEAM_JOINED_KEY] ?? null,
      approvalsUnavailable: read.unavailable,
      sample: true,
      title: "Team Tinsel",
      ...sampleTeamMemberJoinedEmail(base()),
    });
  } catch (err) {
    return failed(res, "new team member email preview", err);
  }
}

// --- the switch ------------------------------------------------------------------------------------

const settingsBody = z.object({ on: z.boolean() }).strict();

export async function putTouchSettings(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSectionAsAdmin(req, res, "fundraising");
  if (!claims) return;
  const body = settingsBody.safeParse(req.body ?? {});
  if (!body.success) return res.status(400).json({ error: "Say whether the automatic emails are on or off." });
  try {
    return res.status(200).json(await setTouchEmailsOn(body.data.on, actorOf(claims)));
  } catch (err) {
    return failed(res, "automatic emails switch", err);
  }
}

// --- signing off the new wording (Jaimie, 2026-10-03) ----------------------------------------------

export async function postWordingApproval(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSectionAsAdmin(req, res, "fundraising");
  if (!claims) return;
  const key = req.params.key;
  if (!isWordingKey(key)) return res.status(404).json({ error: "There is no new wording of that name to approve" });
  try {
    return res.status(200).json({ approval: await approveWording(key, actorOf(claims)) });
  } catch (err) {
    return failed(res, "wording approval", err);
  }
}

export async function deleteWordingApproval(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSectionAsAdmin(req, res, "fundraising");
  if (!claims) return;
  const key = req.params.key;
  if (!isWordingKey(key)) return res.status(404).json({ error: "There is no new wording of that name" });
  try {
    return res.status(200).json({ withdrawn: await withdrawWording(key, actorOf(claims)) });
  } catch (err) {
    return failed(res, "withdrawing a wording approval", err);
  }
}

// --- a call about a prompt -------------------------------------------------------------------------

// Which prompt, and an optional note of up to 500 characters. Nothing else: the time is the
// server's, so a call cannot be backdated from the page.
const promptCallSchema = z
  .object({
    prompt: z.enum(PROMPT_KEYS as unknown as [PromptKey, ...PromptKey[]], { errorMap: () => ({ message: "Say which prompt the call was about." }) }),
    note: z.string().max(500, "A note can be up to 500 characters.").optional(),
  })
  .strict();

export async function postPromptCall(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "fundraising", "edit");
  if (!claims) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });
  const parsed = promptCallSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Say which prompt the call was about." });
  const note = parsed.data.note?.trim() || null;
  try {
    const call = await recordPromptCall(id, parsed.data.prompt, note, claims.email, actorOf(claims));
    return res.status(200).json({ call });
  } catch (err) {
    return failed(res, "prompt call", err);
  }
}

adminFundraisingTouchRouter.get("/api/admin/fundraising/touch", getTouch);
adminFundraisingTouchRouter.get("/api/admin/fundraising/touch/preview/:kind", getTouchPreview);
adminFundraisingTouchRouter.put("/api/admin/fundraising/touch/settings", putTouchSettings);
adminFundraisingTouchRouter.post("/api/admin/fundraising/touch/approvals/:key", postWordingApproval);
adminFundraisingTouchRouter.delete("/api/admin/fundraising/touch/approvals/:key", deleteWordingApproval);
adminFundraisingTouchRouter.post("/api/admin/fundraisers/:id/prompt-calls", postPromptCall);
