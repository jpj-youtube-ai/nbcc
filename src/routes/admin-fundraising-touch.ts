import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { authorizeSection, authorizeSectionAsAdmin } from "./admin-authz";
import { actorOf } from "./admin";
import { config } from "../config";
import { getFundraiser } from "../db/fundraisers";
import { getTouchSettings, readTouchState, recordPromptCall, setTouchEmailsOn, TouchError } from "../db/fundraising-touch";
import { callPrompts, PROMPT_KEYS, type CallPrompt, type PromptCall, type PromptKey } from "../fundraising/call-prompts";
import { buildTouchEmail, sampleTouchData, touchEmailData } from "../fundraising/touch-emails";
import { NEW_WORDING_KINDS, nextTouch, TOUCH_KINDS, TOUCH_LABELS, TOUCH_WHEN, type TouchKind, type TouchSent } from "../fundraising/touch-rules";
import { followUpToday } from "../fundraising/follow-up";

// TASK-515: keeping in touch, in Admin > Fundraising. Section "fundraising": viewers look, editors
// and admins record calls, and the Automatic emails switch is for admins only (like the
// fundraising switch). Its own router, beside the others, so nothing there changes.
//
//   GET  /api/admin/fundraising/touch                  the switch, every automatic email and when
//                                                      it goes, what each fundraiser has had, what
//                                                      the next 8am run would send (were it on),
//                                                      and the call prompts showing today          view
//   GET  /api/admin/fundraising/touch/preview/:kind    one email, rendered, for the invented sample
//        ?fundraiserId=N                               or for that fundraiser                      view
//   PUT  /api/admin/fundraising/touch/settings         { on: true | false }                        admin
//   POST /api/admin/fundraisers/:id/prompt-calls       { prompt, note? }                           edit
//
// Jaimie's rule: every automatic email is readable here before any is sent. The switch ships OFF.
// Request and response shapes: README.md, "Community fundraising", keeping in touch.

export const adminFundraisingTouchRouter = Router();

const UNAVAILABLE = { error: "Admin is temporarily unavailable" };

function failed(res: Response, what: string, err: unknown): Response {
  if (err instanceof TouchError && err.reason === "not_found") return res.status(404).json({ error: "That fundraiser no longer exists" });
  console.error(`admin fundraising ${what} failed:`, err instanceof Error ? err.message : err);
  return res.status(500).json(UNAVAILABLE);
}

const isKind = (k: unknown): k is TouchKind => typeof k === "string" && (TOUCH_KINDS as readonly string[]).includes(k);
const base = () => config.PORTAL_BASE_URL.replace(/\/+$/, "");

// --- the overview ----------------------------------------------------------------------------------

export async function getTouch(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "fundraising", "view"))) return;
  try {
    const today = followUpToday(new Date());
    const [settings, state] = await Promise.all([getTouchSettings(), readTouchState()]);
    const sent: Record<string, TouchSent[]> = {};
    const prompts: Record<string, CallPrompt[]> = {};
    const promptCalls: Record<string, PromptCall[]> = {};
    // What the next 8am run would send, were the switch on: so nobody is surprised by the first one.
    const due: Record<string, TouchKind> = {};
    for (const s of state) {
      const id = String(s.f.id);
      if (s.touch.sent.length) sent[id] = s.touch.sent;
      const showing = callPrompts(s.f, s.prompt, today);
      if (showing.length) prompts[id] = showing;
      if (s.prompt.calls.length) promptCalls[id] = s.prompt.calls;
      const next = nextTouch(s.f, s.touch, today);
      if (next) due[id] = next;
    }
    const kinds = TOUCH_KINDS.map((kind) => ({ kind, label: TOUCH_LABELS[kind], when: TOUCH_WHEN[kind], newWording: NEW_WORDING_KINDS.includes(kind) }));
    return res.status(200).json({ today, settings, kinds, sent, prompts, promptCalls, due });
  } catch (err) {
    return failed(res, "keep in touch read", err);
  }
}

// --- one email, rendered ---------------------------------------------------------------------------

export async function getTouchPreview(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "fundraising", "view"))) return;
  const kind = req.params.kind;
  if (!isKind(kind)) return res.status(404).json({ error: "There is no automatic email of that kind" });
  const raw = (req.query ?? {}).fundraiserId;
  try {
    let data = sampleTouchData(kind, base());
    let sample = true;
    if (raw !== undefined && raw !== "") {
      const id = Number(raw);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });
      const f = await getFundraiser(id);
      if (!f) return res.status(404).json({ error: "That fundraiser no longer exists" });
      data = touchEmailData(f, base());
      sample = false;
    }
    const mail = buildTouchEmail(kind, data);
    return res.status(200).json({ kind, label: TOUCH_LABELS[kind], newWording: NEW_WORDING_KINDS.includes(kind), sample, title: data.title, ...mail });
  } catch (err) {
    return failed(res, "automatic email preview", err);
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
adminFundraisingTouchRouter.post("/api/admin/fundraisers/:id/prompt-calls", postPromptCall);
