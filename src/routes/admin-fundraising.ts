import { Router, type Request, type Response } from "express";
import { z, type ZodIssue } from "zod";
import { authorizeSection, authorizeSectionAsAdmin } from "./admin-authz";
import { actorOf } from "./admin";
import {
  adminPatchSchema,
  EVENT_SHORT_NAME_NEEDED,
  FINISH_BEFORE_START,
  hasPage,
  kindLabelOf,
  pagePath,
  shortName,
  splitSchema,
  type FundraiserRecord,
} from "../fundraising/model";
import { pageUrlFor } from "../fundraising/page-url";
import { loadCategories } from "../db/fundraising-categories";
import { isActiveCategory } from "../fundraising/categories";
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
  setFundraiserSplit,
  FundraiserError,
} from "../db/fundraisers";
import { insertEventImage } from "../db/events";
import { validateUpload } from "../newsletter/image-validation";
import { sendApprovedEmail, sendEditDecisionEmail, sendWaitingLiveEmails } from "../fundraising/send";
import { sendFinishedTouch } from "../fundraising/touch-runner";
import { touchFundraiser } from "../db/fundraising-touch";
import { TEAM_SHARE_MODE_MISSING, withTeamTotals } from "../fundraising/teams";
import { memoryAdminFacts } from "../fundraising/in-memory";
import { londonToday } from "../events/model";

// TASK-493: the admin API behind Admin > Fundraising. Section "fundraising": admins and editors
// edit by default, viewers look (src/admin/permissions.ts).
//
//   GET    /api/admin/fundraising/settings                           the switch            view
//   PATCH  /api/admin/fundraising/settings      { pageOn }           switch it             edit AND an admin
//   GET    /api/admin/fundraisers                                    every sign up         view
//   GET    /api/admin/fundraisers/:id                                one, with everything  view
//   PATCH  /api/admin/fundraisers/:id           any fields           edit it               edit
//   PUT    /api/admin/fundraisers/:id/split     { sharesWithOther, nbccSharePercent, otherCauseName }
//                                                correct the split, only before any gift  edit AND an admin
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

/** Team pages: why a team, or a page on a team, can never be made an event. */
export const TEAM_PATH = "A team raises money, so it can't be an event. Take everyone off the team first.";

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

// Event tickets: NBCC never sells the tickets of an event that shares with another cause.
export const TICKETS_SHARED = "This event shares what it raises with another cause, so NBCC can't sell its tickets.";
export const TICKETS_NO_SPLIT = "NBCC sells this event's tickets, so it can't share with another cause.";

// One place that turns the database's refusals into answers a volunteer can act on.
function failed(res: Response, what: string, err: unknown): Response {
  if (err instanceof FundraiserError) {
    switch (err.reason) {
      case "not_found":
        return res.status(404).json({ error: "That no longer exists" });
      case "slug_taken":
        // TASK-511: an address a page used to have still leads to that page, so it is never reused.
        return res.status(409).json({ error: "Another fundraiser has that web address, or had it before, so it cannot be used" });
      case "bad_status":
        return res.status(409).json({ error: "That cannot be done at this stage" });
      case "team_path":
        // Team pages: a team (or a page on one) raises money; the table's check would refuse it anyway.
        return res.status(409).json({ error: TEAM_PATH });
      case "not_waiting":
        return res.status(409).json({ error: "That change has already been dealt with" });
      case "tickets_shared":
        // Event tickets: all the ticket money must come to NBCC.
        return res.status(409).json({ error: TICKETS_SHARED, fields: { booking: TICKETS_SHARED } });
      case "tickets_no_split":
        return res.status(409).json({ error: TICKETS_NO_SPLIT });
      case "replaced":
        return res.status(409).json({ error: "This change has been replaced; look again" });
      case "needs_short_name":
        // Event pages: the short name is its web address, so it is set before anything is public.
        return res.status(409).json({ error: EVENT_SHORT_NAME_NEEDED, fields: { slug: EVENT_SHORT_NAME_NEEDED } });
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
  // Event pages: pagePath is where its page is, or would be (/event/<short name> for an event), for
  // the admin's QR code links; pageUrl only while it has one.
  return {
    ...f,
    kindLabel: kindLabelOf(f),
    pageUrl: hasPage(f) ? pageUrlFor(f) : null,
    pagePath: pagePath(f),
    // In memory (Jaimie, 2026-10-03): who set it up, and the quiet reminder a year on.
    ...memoryAdminFacts(f, londonToday(new Date())),
  };
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
      // Team pages: a team's total is the whole team's; its members keep their own.
      fundraisers: withTeamTotals(list).map((f) => ({ ...forAdmin(f), meter: f.meter, editWaiting: f.editWaiting })),
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
  // The categories on offer, as the database has them now: one an admin added a moment ago on
  // another server is read afresh rather than refused.
  await loadCategories();
  const kind = req.body?.kind;
  if (typeof kind === "string" && !isActiveCategory(kind)) await loadCategories({ fresh: true });
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

// --- the split with another cause (Jaimie, 2026-10-03) ----------------------------------------------
//
// Organisers can never change it (their changes, editSchema, do not take it), and nor can the
// ordinary edit above (adminPatchSchema does not take it either). An admin may correct it here, and
// only while the fundraiser has no gifts: once anyone has given, they gave on the statement as it
// stood. The database checks that under the row's lock (setFundraiserSplit).

export const SPLIT_LOCKED =
  "The split cannot be changed now: this fundraiser has had its first gift, and people gave on the split as it stood. Please call or email the organiser.";

export async function putAdminFundraiserSplit(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSectionAsAdmin(req, res, "fundraising");
  if (!claims) return;
  const got = ids(req, res, "id");
  if (!got) return;
  // Team pages: a team's correction may say whose split it is (the whole team's, or the organiser's).
  const { teamShareMode, ...rest } = (req.body ?? {}) as Record<string, unknown>;
  if (teamShareMode !== undefined && teamShareMode !== null && teamShareMode !== "team" && teamShareMode !== "organiser") {
    return res.status(400).json({ error: "Some of it needs another look", fields: { teamShareMode: TEAM_SHARE_MODE_MISSING } });
  }
  const parsed = splitSchema.safeParse(rest);
  if (!parsed.success) {
    return res.status(400).json({ error: "Some of it needs another look", fields: fieldErrors(parsed.error.issues) });
  }
  try {
    const mode = teamShareMode === "team" || teamShareMode === "organiser" ? teamShareMode : undefined;
    const saved = mode ? await setFundraiserSplit(got[0], parsed.data, actorOf(claims), mode) : await setFundraiserSplit(got[0], parsed.data, actorOf(claims));
    return res.status(200).json({ fundraiser: forAdmin(saved) });
  } catch (err) {
    if (err instanceof FundraiserError && err.reason === "has_gifts") return res.status(409).json({ error: SPLIT_LOCKED });
    if (err instanceof FundraiserError && err.reason === "team_mode_missing") {
      return res.status(400).json({ error: "Some of it needs another look", fields: { teamShareMode: TEAM_SHARE_MODE_MISSING } });
    }
    return failed(res, "split", err);
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
      // Team pages: a declined team's invites (names, emails and links) are deleted at once.
      if (move === "decline" && after.isTeam) {
        await bestEffort("team invites deleted", async () => (await import("../db/fundraising-teams")).deleteTeamInvites(after.id));
      }
      // TASK-515: the finished email (17, with the certificate), only while Automatic emails is on,
      // and only once. sendFinishedTouch checks every guard itself and never throws.
      if (move === "finish") {
        await bestEffort("finished thank you", async () => {
          // With the meter the daily run reads (a team page's whole team total), so the wording
          // and the amount agree with it.
          const withMeter = await touchFundraiser(after.id);
          if (withMeter) await sendFinishedTouch(withMeter);
        });
      }
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
adminFundraisingRouter.put("/api/admin/fundraisers/:id/split", putAdminFundraiserSplit);
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
