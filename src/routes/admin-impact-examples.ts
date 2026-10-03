import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { authorizeSection, authorizeSectionAsAdmin } from "./admin-authz";
import { actorOf } from "./admin";
import {
  addImpactExample,
  listImpactExamples,
  moveImpactExample,
  updateImpactExample,
  ImpactExampleError,
} from "../db/impact-examples";
import { WORDING_PROMISE_MESSAGE, WORDING_START_MESSAGE, impactAmountSchema, impactWordingSchema } from "../impact/examples";

// What gifts could do (src/impact/examples.ts): the shared list of "could" examples, the card in
// Admin > Fundraising.
//
//   GET   /api/admin/impact-examples              every example, in the list's order   fundraising view
//   POST  /api/admin/impact-examples              { amountPence, wording, onGiveForm? }   an admin
//   PATCH /api/admin/impact-examples/:id          { amountPence?, wording?, active?, onGiveForm? }   an admin
//   POST  /api/admin/impact-examples/:id/move     { direction: "up" | "down" }   an admin
//
// Seeing the list needs only Fundraising view. Changing it is for admins, as with the Categories: it
// changes what every fundraiser, event and team page says. The words must start with could, and never
// promise (will buy, will pay for, buys...: OSCR, a gift must never read as a promise, or it becomes a
// restricted fund). The two the meter line counts with keep their amount and words (409): only on and
// off. There is no delete: switch one off instead. Each change is in audit_log. Shapes: README.md,
// "What gifts could do".

export const adminImpactExamplesRouter = Router();

const UNAVAILABLE = { error: "Admin is temporarily unavailable" };

export const FIXED_MESSAGE =
  "This example is used for the line under the meter, so its words and amount are fixed. You can switch it off or on.";

function failed(res: Response, what: string, err: unknown): Response {
  if (err instanceof ImpactExampleError) {
    if (err.reason === "fixed") return res.status(409).json({ error: FIXED_MESSAGE });
    return res.status(404).json({ error: "That example is not there any more" });
  }
  // The table's own check on the words (or amount) caught something the server's checks let by.
  if (typeof err === "object" && err !== null && (err as { code?: string }).code === "23514") {
    return res.status(400).json({ error: `${WORDING_START_MESSAGE} ${WORDING_PROMISE_MESSAGE}` });
  }
  console.error(`admin impact examples ${what} failed:`, err instanceof Error ? err.message : err);
  return res.status(500).json(UNAVAILABLE);
}

const firstIssue = (e: z.ZodError, fallback: string) => e.issues[0]?.message ?? fallback;

function idOf(req: Request): number | null {
  const raw = String(req.params.id ?? "");
  return /^[1-9]\d{0,9}$/.test(raw) ? Number(raw) : null;
}

export async function getAdminImpactExamples(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "fundraising", "view"))) return;
  try {
    return res.status(200).json({ examples: await listImpactExamples() });
  } catch (err) {
    return failed(res, "list", err);
  }
}

const addSchema = z
  .object({ amountPence: impactAmountSchema, wording: impactWordingSchema, onGiveForm: z.boolean().optional() })
  .strict();

export async function postAdminImpactExample(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSectionAsAdmin(req, res, "fundraising");
  if (!claims) return;
  const parsed = addSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: firstIssue(parsed.error, "Give an amount and what it could do.") });
  const { amountPence, wording, onGiveForm } = parsed.data;
  try {
    const example = await addImpactExample({ amountPence, wording, onGiveForm: onGiveForm ?? true }, actorOf(claims));
    return res.status(201).json({ example });
  } catch (err) {
    return failed(res, "add", err);
  }
}

const changeSchema = z
  .object({
    amountPence: impactAmountSchema.optional(),
    wording: impactWordingSchema.optional(),
    active: z.boolean().optional(),
    onGiveForm: z.boolean().optional(),
  })
  .strict()
  .refine((b) => Object.values(b).some((v) => v !== undefined), { message: "There is nothing to change." });

export async function patchAdminImpactExample(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSectionAsAdmin(req, res, "fundraising");
  if (!claims) return;
  const id = idOf(req);
  if (id === null) return res.status(400).json({ error: "That is not an example" });
  const parsed = changeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: firstIssue(parsed.error, "There is nothing to change.") });
  try {
    return res.status(200).json({ example: await updateImpactExample(id, parsed.data, actorOf(claims)) });
  } catch (err) {
    return failed(res, "change", err);
  }
}

const moveSchema = z.object({ direction: z.enum(["up", "down"], { message: "Move it up or down." }) }).strict();

export async function postMoveImpactExample(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSectionAsAdmin(req, res, "fundraising");
  if (!claims) return;
  const id = idOf(req);
  if (id === null) return res.status(400).json({ error: "That is not an example" });
  const parsed = moveSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: firstIssue(parsed.error, "Move it up or down.") });
  try {
    await moveImpactExample(id, parsed.data.direction, actorOf(claims));
    return res.status(200).json({ examples: await listImpactExamples() });
  } catch (err) {
    return failed(res, "move", err);
  }
}

adminImpactExamplesRouter.get("/api/admin/impact-examples", getAdminImpactExamples);
adminImpactExamplesRouter.post("/api/admin/impact-examples", postAdminImpactExample);
adminImpactExamplesRouter.patch("/api/admin/impact-examples/:id", patchAdminImpactExample);
adminImpactExamplesRouter.post("/api/admin/impact-examples/:id/move", postMoveImpactExample);
