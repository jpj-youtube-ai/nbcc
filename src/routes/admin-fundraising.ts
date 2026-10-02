import { Router, type Request, type Response } from "express";
import { z, type ZodIssue } from "zod";
import { authorizeSection, authorizeSectionAsAdmin } from "./admin-authz";
import { actorOf } from "./admin";
import { adminPatchSchema, FINISH_BEFORE_START, hasPage, KIND_LABELS, shortName, type FundraiserRecord } from "../fundraising/model";
import {
  addCash,
  decideEdit,
  fundraiserHistory,
  getFundraiser,
  getFundraisingSettings,
  listAllFundraisers,
  listCash,
  listEdits,
  moveFundraiser,
  patchFundraiser,
  removeCash,
  setFundraisingOn,
  setMessageHidden,
  wallRows,
  fundraisingIsOn,
  countWaitingLiveEmails,
  FundraiserError,
} from "../db/fundraisers";
import { insertEventImage } from "../db/events";
import { validateUpload } from "../newsletter/image-validation";
import { sendApprovedEmail, sendEditDecisionEmail, sendWaitingLiveEmails, fundraiserPageUrl } from "../fundraising/send";

// TASK-493: the admin API behind Admin > Fundraising. Section "fundraising": admins and editors
// edit by default, viewers look (src/admin/permissions.ts).
//
//   GET    /api/admin/fundraising/settings                           the switch            view
//   PATCH  /api/admin/fundraising/settings      { pageOn }           switch it             edit AND an admin
//   GET    /api/admin/fundraisers                                    every sign up         view
//   GET    /api/admin/fundraisers/:id                                one, with everything  view
//   PATCH  /api/admin/fundraisers/:id           any fields           edit it               edit
//   POST   /api/admin/fundraisers/:id/approve                        approve and email     edit
//   POST   /api/admin/fundraisers/:id/decline   { reason? }          decline (internal)    edit
//   POST   /api/admin/fundraisers/:id/finish                         mark finished         edit
//   POST   /api/admin/fundraisers/:id/edits/:editId/approve          apply a waiting change edit
//   POST   /api/admin/fundraisers/:id/edits/:editId/reject           drop a waiting change  edit
//   POST   /api/admin/fundraisers/:id/cash      { amountPence, paidInOn, note? }             edit
//   DELETE /api/admin/fundraisers/:id/cash/:cashId                                           edit
//   POST   /api/admin/fundraisers/:id/wall/:donationId/hide|show                             edit
//   GET    /api/admin/fundraisers/:id/history                        its audit log         view
//   POST   /api/admin/fundraiser-images         { mime, dataBase64 } upload a photo        edit
//
// Switching fundraising on puts Get involved's fundraisers and every approved page in front of the
// public, so it is a launch decision: admins only, read live from the database, like the Events
// switch. Every write records who did it in audit_log, in the same transaction (src/db/fundraisers.ts).
// Request and response shapes: README.md, "Community fundraising".
//
// TASK-497, the emails: approving emails the organiser at once, except a page holder approved while
// fundraising is off, who is marked as waiting and sent "Your page is live" when an admin switches
// it on (in the background, after the answer). Approving or rejecting a waiting change emails the
// organiser too. Every email goes after its write has committed, best effort: a failed send is
// logged and never fails the answer.

export const adminFundraisingRouter = Router();

const UNAVAILABLE = { error: "Admin is temporarily unavailable" };

function fieldErrors(issues: ZodIssue[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path.join(".") || "form";
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

function positiveId(value: unknown): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function ids(req: Request, res: Response, ...names: string[]): number[] | null {
  const out: number[] = [];
  for (const name of names) {
    const id = positiveId(req.params[name]);
    if (id === null) {
      res.status(400).json({ error: "Invalid id" });
      return null;
    }
    out.push(id);
  }
  return out;
}

// One place that turns the database's refusals into answers a volunteer can act on.
function failed(res: Response, what: string, err: unknown): Response {
  if (err instanceof FundraiserError) {
    switch (err.reason) {
      case "not_found":
        return res.status(404).json({ error: "That no longer exists" });
      case "slug_taken":
        return res.status(409).json({ error: "Another fundraiser already uses that web address" });
      case "bad_status":
        return res.status(409).json({ error: "That cannot be done at this stage" });
      case "not_waiting":
        return res.status(409).json({ error: "That change has already been dealt with" });
      case "replaced":
        return res.status(409).json({ error: "This change has been replaced; look again" });
      case "bad_times":
        // A staff change names the box to look at; an organiser's change can only be rejected or
        // waited on, so it says why it cannot be approved.
        if (what === "update") {
          return res.status(400).json({ error: "Some of it needs another look", fields: { [err.field ?? "endTime"]: FINISH_BEFORE_START } });
        }
        return res.status(409).json({ error: "This change would put the finish time before the start. Change the finish time first, or reject it." });
    }
  }
  // A slug taken in the moment between the check and the save.
  if (typeof err === "object" && err !== null && (err as { code?: string }).code === "23505") {
    return res.status(409).json({ error: "Another fundraiser already uses that web address" });
  }
  console.error(`admin fundraising ${what} failed:`, err instanceof Error ? err.message : err);
  return res.status(500).json(UNAVAILABLE);
}

// Run an email step after the write it follows has committed. Whatever happens to it, the write
// stands and the answer is the write's.
async function bestEffort(what: string, send: () => Promise<unknown>): Promise<void> {
  try {
    await send();
  } catch (err) {
    console.error(`admin fundraising ${what} email failed:`, err instanceof Error ? err.message : err);
  }
}

function forAdmin(f: FundraiserRecord) {
  return { ...f, kindLabel: KIND_LABELS[f.kind], pageUrl: hasPage(f) ? fundraiserPageUrl(f.slug) : null };
}

// --- the switch ----------------------------------------------------------------------------------

export async function getAdminFundraisingSettings(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "fundraising", "view"))) return;
  let settings;
  try {
    settings = await getFundraisingSettings();
  } catch (err) {
    return failed(res, "settings read", err);
  }
  // How many page holders are waiting for "Your page is live", for the question before switching
  // on. Only a nicety: if it cannot be counted the screen says it without a number.
  try {
    return res.status(200).json({ ...settings, liveEmailsWaiting: await countWaitingLiveEmails() });
  } catch (err) {
    console.error("admin fundraising waiting count failed:", err instanceof Error ? err.message : err);
    return res.status(200).json(settings);
  }
}

const settingsSchema = z.object({ pageOn: z.boolean() }).strict();

export async function patchAdminFundraisingSettings(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSectionAsAdmin(req, res, "fundraising");
  if (!claims) return;
  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Say whether fundraising should be on or off" });
  let settings;
  try {
    settings = await setFundraisingOn(parsed.data.pageOn, actorOf(claims));
  } catch (err) {
    return failed(res, "switch", err);
  }
  res.status(200).json(settings);
  // Switched on: everyone approved while it was off hears their page is live. In the background,
  // after the answer, so the admin is not kept waiting on a run of emails; sendWaitingLiveEmails
  // claims one at a time, stops if fundraising is switched off again, and never throws, and this
  // catches anything that slips past it anyway.
  if (settings.pageOn) void bestEffort("live", sendWaitingLiveEmails);
  return res;
}

// --- reading -------------------------------------------------------------------------------------

export async function getAdminFundraisers(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "fundraising", "view"))) return;
  try {
    const [settings, list] = await Promise.all([getFundraisingSettings(), listAllFundraisers()]);
    return res.status(200).json({
      pageOn: settings.pageOn,
      fundraisers: list.map((f) => ({ ...forAdmin(f), meter: f.meter, editWaiting: f.editWaiting })),
    });
  } catch (err) {
    return failed(res, "list", err);
  }
}

export async function getAdminFundraiser(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "fundraising", "view"))) return;
  const got = ids(req, res, "id");
  if (!got) return;
  const [id] = got;
  try {
    const f = await getFundraiser(id);
    if (!f) return res.status(404).json({ error: "That no longer exists" });
    const [edits, cash, wall] = await Promise.all([listEdits(id), listCash(id), wallRows(id)]);
    const { meter, editWaiting, ...record } = f;
    return res.status(200).json({
      fundraiser: forAdmin(record),
      meter,
      waitingEdit: edits.find((e) => e.status === "waiting") ?? null,
      editWaiting,
      edits,
      cash,
      // Staff see every gift on the page, hidden ones included, with the giver's full name.
      wall: wall.map((w) => ({ ...w, shortName: w.showName && !w.anonymous ? shortName(w.fullName) : "Anonymous" })),
    });
  } catch (err) {
    return failed(res, "read", err);
  }
}

export async function getAdminFundraiserHistory(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "fundraising", "view"))) return;
  const got = ids(req, res, "id");
  if (!got) return;
  try {
    return res.status(200).json({ history: await fundraiserHistory(got[0]) });
  } catch (err) {
    return failed(res, "history", err);
  }
}

// --- staff changes -------------------------------------------------------------------------------

export async function patchAdminFundraiser(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "fundraising", "edit");
  if (!claims) return;
  const got = ids(req, res, "id");
  if (!got) return;
  const parsed = adminPatchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Some of it needs another look", fields: fieldErrors(parsed.error.issues) });
  }
  try {
    return res.status(200).json({ fundraiser: forAdmin(await patchFundraiser(got[0], parsed.data, actorOf(claims))) });
  } catch (err) {
    return failed(res, "update", err);
  }
}

const declineSchema = z.object({ reason: z.string().trim().max(500).optional() }).strict();

function moveHandler(move: "approve" | "decline" | "finish") {
  return async (req: Request, res: Response): Promise<Response | void> => {
    const claims = await authorizeSection(req, res, "fundraising", "edit");
    if (!claims) return;
    const got = ids(req, res, "id");
    if (!got) return;
    let reason: string | null = null;
    if (move === "decline") {
      const parsed = declineSchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ error: "Keep the reason to 500 characters or fewer" });
      reason = parsed.data.reason ? parsed.data.reason : null;
    }
    try {
      const { after, livePending } = await moveFundraiser(got[0], move, actorOf(claims), reason);
      // After the approval has committed, best effort: it stands whether or not the email goes. A
      // page holder approved while fundraising is off waits for the switch instead (livePending).
      if (move === "approve" && !livePending) await bestEffort("approved", () => sendApprovedEmail(after));
      return res.status(200).json({ fundraiser: forAdmin(after) });
    } catch (err) {
      return failed(res, move, err);
    }
  };
}

export const postApproveFundraiser = moveHandler("approve");
export const postDeclineFundraiser = moveHandler("decline");
export const postFinishFundraiser = moveHandler("finish");

function editDecision(approve: boolean) {
  return async (req: Request, res: Response): Promise<Response | void> => {
    const claims = await authorizeSection(req, res, "fundraising", "edit");
    if (!claims) return;
    const got = ids(req, res, "id", "editId");
    if (!got) return;
    let after: FundraiserRecord;
    try {
      after = await decideEdit(got[0], got[1], approve, actorOf(claims));
    } catch (err) {
      return failed(res, approve ? "edit approve" : "edit reject", err);
    }
    // "Your update is live" or "About your update", after the decision has committed.
    await bestEffort(approve ? "update live" : "about your update", async () =>
      sendEditDecisionEmail(after, approve, await fundraisingIsOn()),
    );
    return res.status(200).json({ fundraiser: forAdmin(after) });
  };
}

export const postApproveEdit = editDecision(true);
export const postRejectEdit = editDecision(false);

const cashSchema = z
  .object({
    amountPence: z.number().int("Give the amount in pence.").min(1, "Give an amount.").max(10_000_000, "That is more than £100,000."),
    paidInOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-12-05.")
      .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v), "That date does not exist."),
    note: z.string().trim().max(500, "Keep the note to 500 characters or fewer.").default(""),
  })
  .strict();

export async function postAdminCash(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "fundraising", "edit");
  if (!claims) return;
  const got = ids(req, res, "id");
  if (!got) return;
  const parsed = cashSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Some of it needs another look", fields: fieldErrors(parsed.error.issues) });
  }
  try {
    return res.status(201).json({ cash: await addCash(got[0], parsed.data, actorOf(claims)) });
  } catch (err) {
    return failed(res, "cash add", err);
  }
}

export async function deleteAdminCash(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "fundraising", "edit");
  if (!claims) return;
  const got = ids(req, res, "id", "cashId");
  if (!got) return;
  try {
    await removeCash(got[0], got[1], actorOf(claims));
    return res.status(200).json({ removed: got[1] });
  } catch (err) {
    return failed(res, "cash remove", err);
  }
}

function wallChoice(hidden: boolean) {
  return async (req: Request, res: Response): Promise<Response | void> => {
    const claims = await authorizeSection(req, res, "fundraising", "edit");
    if (!claims) return;
    const got = ids(req, res, "id", "donationId");
    if (!got) return;
    try {
      await setMessageHidden(got[0], got[1], hidden, actorOf(claims));
      return res.status(200).json({ donationId: got[1], hidden });
    } catch (err) {
      return failed(res, hidden ? "hide" : "show", err);
    }
  };
}

export const postHideMessage = wallChoice(true);
export const postShowMessage = wallChoice(false);

// A photo for a fundraiser's page, stored exactly as an event picture (served at /media/events/:id)
// but gated on fundraising rather than events, so the Fundraising screen needs no other access.
const uploadSchema = z.object({ mime: z.string().min(1), dataBase64: z.string().min(1), filename: z.string().optional() });

export async function postAdminFundraiserImage(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "fundraising", "edit");
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
    return failed(res, "image upload", err);
  }
}

adminFundraisingRouter.get("/api/admin/fundraising/settings", getAdminFundraisingSettings);
adminFundraisingRouter.patch("/api/admin/fundraising/settings", patchAdminFundraisingSettings);
adminFundraisingRouter.get("/api/admin/fundraisers", getAdminFundraisers);
adminFundraisingRouter.get("/api/admin/fundraisers/:id", getAdminFundraiser);
adminFundraisingRouter.patch("/api/admin/fundraisers/:id", patchAdminFundraiser);
adminFundraisingRouter.get("/api/admin/fundraisers/:id/history", getAdminFundraiserHistory);
adminFundraisingRouter.post("/api/admin/fundraisers/:id/approve", postApproveFundraiser);
adminFundraisingRouter.post("/api/admin/fundraisers/:id/decline", postDeclineFundraiser);
adminFundraisingRouter.post("/api/admin/fundraisers/:id/finish", postFinishFundraiser);
adminFundraisingRouter.post("/api/admin/fundraisers/:id/edits/:editId/approve", postApproveEdit);
adminFundraisingRouter.post("/api/admin/fundraisers/:id/edits/:editId/reject", postRejectEdit);
adminFundraisingRouter.post("/api/admin/fundraisers/:id/cash", postAdminCash);
adminFundraisingRouter.delete("/api/admin/fundraisers/:id/cash/:cashId", deleteAdminCash);
adminFundraisingRouter.post("/api/admin/fundraisers/:id/wall/:donationId/hide", postHideMessage);
adminFundraisingRouter.post("/api/admin/fundraisers/:id/wall/:donationId/show", postShowMessage);
adminFundraisingRouter.post("/api/admin/fundraiser-images", postAdminFundraiserImage);
