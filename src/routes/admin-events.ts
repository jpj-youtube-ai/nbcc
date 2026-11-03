import { Router, type Request, type Response } from "express";
import { z, type ZodIssue } from "zod";
import { authorizeSection } from "./admin-authz";
import { actorOf } from "./admin";
import {
  eventInputSchema,
  publishProblems,
  londonToday,
  slugify,
  sortForPage,
  type EventInput,
  type EventRecord,
} from "../events/model";
import { renderCard, renderDeck, renderPreviewDocument } from "../events/render";
import {
  createEvent,
  deleteEvent,
  getEventsSettings,
  insertEventImage,
  listAllEvents,
  listPageEvents,
  setEventsPageOn,
  updateEvent,
} from "../db/events";
import { validateUpload } from "../newsletter/image-validation";

// TASK-453: the admin API behind the Events section.
//
//   GET    /api/admin/events            the switch and every event         events: view
//   POST   /api/admin/events            a new event                        events: edit
//   PUT    /api/admin/events/:id        a new version of an event          events: edit
//   DELETE /api/admin/events/:id        remove one                         events: edit
//   PATCH  /api/admin/events/settings   switch the whole page on or off    events: edit AND an admin
//   POST   /api/admin/events/preview    the card and the page, as HTML     events: view
//   POST   /api/admin/event-images      upload a picture or a logo         events: edit
//
// Switching the page on puts it, its menu link and its site map entry in front of the public, so
// it is a launch decision rather than content work: admins only, whatever the section matrix says
// (the precedent is deleting a newsletter). Everything else follows the matrix.
//
// An event may be SAVED half finished as a draft; it may not go live until publishProblems is
// empty. Refusals name the field and say what to do, because a volunteer reads them.

export const adminEventsRouter = Router();

type FieldErrors = Record<string, string>;

function fieldErrors(issues: ZodIssue[]): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of issues) {
    const key = issue.path.join(".") || "event";
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

function eventId(req: Request, res: Response): number | null {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid event id" });
    return null;
  }
  return id;
}

// Parse a save. 400 with the fields named when the event itself is not acceptable, and 400 with
// the plain-English list when it is acceptable but not ready to go live.
function parseSave(body: unknown, res: Response): EventInput | null {
  const parsed = eventInputSchema.safeParse(body);
  if (!parsed.success) {
    res.status(400).json({ error: "Some of the event needs another look", fields: fieldErrors(parsed.error.issues) });
    return null;
  }
  if (parsed.data.status !== "draft") {
    const problems = publishProblems(parsed.data);
    if (problems.length > 0) {
      res.status(400).json({ error: "Not ready to go on the website yet", problems });
      return null;
    }
  }
  return parsed.data;
}

export async function getAdminEvents(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "events", "view"))) return;
  try {
    const [settings, events] = await Promise.all([getEventsSettings(), listAllEvents()]);
    return res.status(200).json({ ...settings, today: londonToday(new Date()), events });
  } catch (err) {
    console.error("admin events read failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin is temporarily unavailable" });
  }
}

export async function postAdminEvent(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "events", "edit");
  if (!claims) return;
  const input = parseSave(req.body, res);
  if (!input) return;
  try {
    const event = await createEvent(input, actorOf(claims));
    return res.status(201).json({ event });
  } catch (err) {
    console.error("admin event create failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin is temporarily unavailable" });
  }
}

export async function putAdminEvent(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "events", "edit");
  if (!claims) return;
  const id = eventId(req, res);
  if (id === null) return;
  const input = parseSave(req.body, res);
  if (!input) return;
  try {
    const event = await updateEvent(id, input, actorOf(claims));
    if (!event) return res.status(404).json({ error: "That event no longer exists" });
    return res.status(200).json({ event });
  } catch (err) {
    console.error("admin event update failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin is temporarily unavailable" });
  }
}

export async function deleteAdminEvent(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "events", "edit");
  if (!claims) return;
  const id = eventId(req, res);
  if (id === null) return;
  try {
    const deleted = await deleteEvent(id, actorOf(claims));
    if (!deleted) return res.status(404).json({ error: "That event no longer exists" });
    return res.status(200).json({ deleted });
  } catch (err) {
    console.error("admin event delete failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin is temporarily unavailable" });
  }
}

const settingsSchema = z.object({ pageOn: z.boolean() }).strict();

export async function patchAdminEventsSettings(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "events", "edit");
  if (!claims) return;
  if (claims.role !== "admin") {
    return res.status(403).json({ error: "Only an admin can switch the Get involved page on or off" });
  }
  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Say whether the page should be on or off" });
  try {
    const settings = await setEventsPageOn(parsed.data.pageOn, actorOf(claims));
    return res.status(200).json(settings);
  } catch (err) {
    console.error("admin events switch failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin is temporarily unavailable" });
  }
}

// A preview has to draw something while the form is still being filled in, so a missing name or
// date gets a stand-in rather than a refusal. Anything present is still held to every rule: a
// booking link that could run script is refused here exactly as it is on save.
function previewCandidate(raw: unknown): Record<string, unknown> {
  const base = raw && typeof raw === "object" ? { ...(raw as Record<string, unknown>) } : {};
  if (typeof base.name !== "string" || base.name.trim() === "") base.name = "Your event’s name";
  if (typeof base.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(base.date)) {
    base.date = londonToday(new Date(Date.now() + 30 * 86400000));
  }
  return base;
}

const previewSchema = z.object({ event: z.unknown(), id: z.number().int().positive().nullish() });

export async function postAdminEventsPreview(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "events", "view"))) return;
  const body = previewSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "Nothing to preview" });
  const parsed = eventInputSchema.safeParse(previewCandidate(body.data.event));
  if (!parsed.success) {
    return res.status(400).json({ error: "Some of the event needs another look", fields: fieldErrors(parsed.error.issues) });
  }
  const input = parsed.data;
  const record: EventRecord = { ...input, id: body.data.id ?? 0, slug: slugify(input.name) };
  try {
    // The page as it would be with this version of the event on it: everything live, without the
    // event's saved self, plus this version wherever its date puts it. Past dates are left off,
    // exactly as the real page would leave them.
    const today = londonToday(new Date());
    const others = (await listPageEvents(today)).filter((e) => e.id !== record.id);
    const deck = record.date >= today ? sortForPage([...others, record]) : others;
    return res.status(200).json({
      card: renderPreviewDocument(renderCard(record, "preview-")),
      page: renderPreviewDocument(renderDeck(deck, "page-")),
      problems: publishProblems(input),
      onPage: record.date >= today,
    });
  } catch (err) {
    console.error("admin events preview failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin is temporarily unavailable" });
  }
}

const uploadSchema = z.object({ mime: z.string().min(1), dataBase64: z.string().min(1), filename: z.string().optional() });

export async function postAdminEventImage(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "events", "edit");
  if (!claims) return;
  const parsed = uploadSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid upload" });
  const bytes = Buffer.from(parsed.data.dataBase64, "base64");
  const check = validateUpload(parsed.data.mime, bytes.length);
  if (!check.ok) {
    return res
      .status(check.reason === "size" ? 413 : 400)
      .json({ error: check.reason === "size" ? "That picture is too big (2 MB at most)" : "That file is not a picture we can use: try a JPG or PNG" });
  }
  try {
    const { id } = await insertEventImage(parsed.data.mime, bytes, claims.sub);
    return res.status(201).json({ id, src: `/media/events/${id}` });
  } catch (err) {
    console.error("admin event image upload failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin is temporarily unavailable" });
  }
}

adminEventsRouter.get("/api/admin/events", getAdminEvents);
adminEventsRouter.post("/api/admin/events", postAdminEvent);
// Registered before /:id so "settings" and "preview" are never read as an event id.
adminEventsRouter.patch("/api/admin/events/settings", patchAdminEventsSettings);
adminEventsRouter.post("/api/admin/events/preview", postAdminEventsPreview);
adminEventsRouter.put("/api/admin/events/:id", putAdminEvent);
adminEventsRouter.delete("/api/admin/events/:id", deleteAdminEvent);
adminEventsRouter.post("/api/admin/event-images", postAdminEventImage);
