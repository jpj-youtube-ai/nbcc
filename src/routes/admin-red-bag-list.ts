import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { authorizeSection, loadEffectivePermissions } from "./admin-authz";
import { actorOf } from "./admin";
import type { AdminSessionClaims } from "../admin/session";
import { can } from "../admin/permissions";
import {
  RedBagListError,
  discardRedBagDraft,
  publishRedBagDraft,
  readRedBagEditor,
  readRedBagVersion,
  redBagStaffName,
  restoreRedBagList,
  saveRedBagDraft,
  type RedBagListWho,
} from "../db/red-bag-lists";
import { redBagList } from "../red-bag/list";

// Admin > Fill a Red Bag: the editor for the list on /fill (the items, their prices, and the
// "Whenever the need comes" examples). Staff change a shared DRAFT; nothing reaches the public
// until someone publishes. The screen is assets/js/admin/red-bag-list.js.
//
//   GET  /api/admin/red-bag-list                the editor's state                       red-bag view
//   GET  /api/admin/red-bag-list/versions/:id   one earlier version, or "original"       red-bag view
//   PUT  /api/admin/red-bag-list/draft          { data, version, publishedId }           red-bag edit
//   POST /api/admin/red-bag-list/publish        { version }                              red-bag edit
//   POST /api/admin/red-bag-list/discard        { version }                              red-bag edit
//   POST /api/admin/red-bag-list/restore        { from, version, publishedId }           red-bag edit
//
// The editor's state, which every write answers with afresh:
//   { mayEdit, website, publishedId, draft: { data, version, updatedAt, updatedByName,
//     restoredFrom } | null, changes: [plain words], history: [{ id, publishedAt, publishedByName,
//     summary, changes, restoredFrom, restoredOriginal }] }
//
// `version` is the draft's stamp as the screen last saw it (0: it saw no draft), and `publishedId`
// the website's list it was looking at. A change sent against a stamp that has moved on is refused
// with 409 and STALE_MESSAGE; nothing is lost on the server. The list's rules
// (assets/js/red-bag-list.js) are checked on every save and again on publish, here on the server,
// whatever the screen did: a list that fails is refused with 400 and the rule's own words.
// Publish, throw away and put back are each in audit_log; a save of the draft is not.

export const adminRedBagListRouter = Router();

const UNAVAILABLE = { error: "Admin is temporarily unavailable" };
export const STALE_MESSAGE = "Someone else has changed the draft. Reload to see their changes.";
export const NOTHING_MESSAGE = "There is nothing to publish: the draft says what the website already says.";
export const GONE_MESSAGE = "That version is not there any more.";
const BAD_REQUEST = "That did not look right. Reload the page and try again.";

function failed(res: Response, what: string, err: unknown): Response {
  if (err instanceof RedBagListError) {
    if (err.reason === "stale") return res.status(409).json({ error: STALE_MESSAGE, code: "stale" });
    if (err.reason === "nothing") return res.status(400).json({ error: NOTHING_MESSAGE, code: "nothing" });
    if (err.reason === "not_found") return res.status(404).json({ error: GONE_MESSAGE, code: "not_found" });
    return res.status(400).json({ error: err.problems[0]?.message ?? redBagList().MESSAGES.broken, code: "invalid", problems: err.problems });
  }
  console.error(`admin red bag list ${what} failed:`, err instanceof Error ? err.message : err);
  return res.status(500).json(UNAVAILABLE);
}

/** The editor's state for this person. Throws if the database cannot answer. */
async function editorState(claims: AdminSessionClaims): Promise<Record<string, unknown>> {
  const [state, perms] = await Promise.all([readRedBagEditor(), loadEffectivePermissions(claims.sub)]);
  return {
    mayEdit: !!perms && can(perms, "red-bag", "edit"),
    website: state.website,
    publishedId: state.publishedId,
    draft: state.draft,
    // What publishing the draft would change on the website, in plain words.
    changes: state.draft ? redBagList().diff(state.website, state.draft.data).map((c) => c.text) : [],
    history: state.history,
  };
}

async function whoIs(claims: AdminSessionClaims): Promise<RedBagListWho> {
  return { actor: actorOf(claims), name: await redBagStaffName(claims.sub, claims.email) };
}

export async function getAdminRedBagList(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "red-bag", "view");
  if (!claims) return;
  try {
    return res.status(200).json(await editorState(claims));
  } catch (err) {
    return failed(res, "read", err);
  }
}

export async function getAdminRedBagVersion(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "red-bag", "view"))) return;
  const raw = String(req.params.id ?? "");
  try {
    if (raw === "original") return res.status(200).json({ version: { id: "original", data: redBagList().builtIn() } });
    if (!/^[1-9]\d{0,9}$/.test(raw)) return res.status(400).json({ error: "That is not a version of the list." });
    const version = await readRedBagVersion(Number(raw));
    if (!version) return res.status(404).json({ error: GONE_MESSAGE, code: "not_found" });
    return res.status(200).json({ version });
  } catch (err) {
    return failed(res, "version read", err);
  }
}

const stamp = z.number().int().min(0).max(2_000_000_000);
const publishedId = z.number().int().positive().nullable();

const saveSchema = z.object({ data: z.record(z.string(), z.unknown()), version: stamp, publishedId }).strict();

export async function putAdminRedBagDraft(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "red-bag", "edit");
  if (!claims) return;
  const parsed = saveSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: BAD_REQUEST });
  try {
    await saveRedBagDraft(parsed.data.data, { version: parsed.data.version, publishedId: parsed.data.publishedId }, await whoIs(claims));
    return res.status(200).json(await editorState(claims));
  } catch (err) {
    return failed(res, "save", err);
  }
}

const stampOnly = z.object({ version: stamp }).strict();

export async function postAdminRedBagPublish(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "red-bag", "edit");
  if (!claims) return;
  const parsed = stampOnly.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: BAD_REQUEST });
  try {
    await publishRedBagDraft(parsed.data.version, await whoIs(claims));
    return res.status(200).json(await editorState(claims));
  } catch (err) {
    return failed(res, "publish", err);
  }
}

export async function postAdminRedBagDiscard(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "red-bag", "edit");
  if (!claims) return;
  const parsed = stampOnly.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: BAD_REQUEST });
  try {
    await discardRedBagDraft(parsed.data.version, await whoIs(claims));
    return res.status(200).json(await editorState(claims));
  } catch (err) {
    return failed(res, "throw away", err);
  }
}

const restoreSchema = z.object({ from: z.union([z.literal("original"), z.number().int().positive()]), version: stamp, publishedId }).strict();

export async function postAdminRedBagRestore(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "red-bag", "edit");
  if (!claims) return;
  const parsed = restoreSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: BAD_REQUEST });
  try {
    await restoreRedBagList(parsed.data.from, { version: parsed.data.version, publishedId: parsed.data.publishedId }, await whoIs(claims));
    return res.status(200).json(await editorState(claims));
  } catch (err) {
    return failed(res, "put back", err);
  }
}

adminRedBagListRouter.get("/api/admin/red-bag-list", getAdminRedBagList);
adminRedBagListRouter.get("/api/admin/red-bag-list/versions/:id", getAdminRedBagVersion);
adminRedBagListRouter.put("/api/admin/red-bag-list/draft", putAdminRedBagDraft);
adminRedBagListRouter.post("/api/admin/red-bag-list/publish", postAdminRedBagPublish);
adminRedBagListRouter.post("/api/admin/red-bag-list/discard", postAdminRedBagDiscard);
adminRedBagListRouter.post("/api/admin/red-bag-list/restore", postAdminRedBagRestore);
