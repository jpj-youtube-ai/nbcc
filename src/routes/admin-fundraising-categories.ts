import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { authorizeSection, authorizeSectionAsAdmin } from "./admin-authz";
import { actorOf } from "./admin";
import { addCategory, listCategories, updateCategory, CategoryError } from "../db/fundraising-categories";
import { KEY_PATTERN, categoryLabelSchema } from "../fundraising/categories";

// Fundraising categories, the Categories card in Admin > Fundraising (src/fundraising/categories.ts).
//
//   GET   /api/admin/fundraising/categories          every category, A to Z    fundraising view
//   POST  /api/admin/fundraising/categories          { label }: add one          an admin
//   PATCH /api/admin/fundraising/categories/:key     { label?, active? }         an admin
//
// Seeing the list needs only Fundraising view, as the sign up editor offers it. Adding, renaming and
// hiding are for admins: they change the public sign up form. There is no delete: a category is kept
// for good, so every sign up that chose one keeps it and its name. Each change is in audit_log
// (src/db/fundraising-categories.ts). Shapes: README.md, "Fundraising categories".

export const adminFundraisingCategoriesRouter = Router();

const UNAVAILABLE = { error: "Admin is temporarily unavailable" };

function failed(res: Response, what: string, err: unknown): Response {
  if (err instanceof CategoryError) {
    switch (err.reason) {
      case "not_found":
        return res.status(404).json({ error: "That category is not there any more" });
      case "label_taken":
        return res.status(409).json({ error: "There is already a category called that. If it is hidden, bring it back instead." });
      case "other_always_on":
        return res.status(409).json({ error: "Other is always on the form, so it cannot be hidden." });
    }
  }
  console.error(`admin fundraising categories ${what} failed:`, err instanceof Error ? err.message : err);
  return res.status(500).json(UNAVAILABLE);
}

export async function getAdminCategories(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "fundraising", "view"))) return;
  try {
    return res.status(200).json({ categories: await listCategories() });
  } catch (err) {
    return failed(res, "list", err);
  }
}

const addSchema = z.object({ label: categoryLabelSchema }).strict();

export async function postAdminCategory(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSectionAsAdmin(req, res, "fundraising");
  if (!claims) return;
  const parsed = addSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Give the category a name." });
  }
  try {
    return res.status(201).json({ category: await addCategory(parsed.data.label, actorOf(claims)) });
  } catch (err) {
    return failed(res, "add", err);
  }
}

const changeSchema = z
  .object({ label: categoryLabelSchema.optional(), active: z.boolean().optional() })
  .strict()
  .refine((b) => b.label !== undefined || b.active !== undefined, { message: "There is nothing to change." });

export async function patchAdminCategory(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSectionAsAdmin(req, res, "fundraising");
  if (!claims) return;
  const key = String(req.params.key ?? "");
  if (!KEY_PATTERN.test(key)) return res.status(400).json({ error: "That is not a category" });
  const parsed = changeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "There is nothing to change." });
  }
  try {
    return res.status(200).json({ category: await updateCategory(key, parsed.data, actorOf(claims)) });
  } catch (err) {
    return failed(res, "change", err);
  }
}

adminFundraisingCategoriesRouter.get("/api/admin/fundraising/categories", getAdminCategories);
adminFundraisingCategoriesRouter.post("/api/admin/fundraising/categories", postAdminCategory);
adminFundraisingCategoriesRouter.patch("/api/admin/fundraising/categories/:key", patchAdminCategory);
