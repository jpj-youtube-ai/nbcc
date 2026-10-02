import { Router, type Request, type Response } from "express";
import type { ZodIssue } from "zod";
import { authorizeSection } from "./admin-authz";
import { actorOf } from "./admin";
import { listAllFundraisers } from "../db/fundraisers";
import { changeRequest, listRequestRows, RequestError } from "../db/fundraising-requests";
import { followUpToday } from "../fundraising/follow-up";
import {
  REQUEST_KINDS,
  requestActionSchema,
  requestTotals,
  requestViews,
  requestsToDo,
  type RequestKind,
  type RequestRow,
  type RequestView,
} from "../fundraising/requests";

// TASK-505: the Requests part of each sign up in Admin > Fundraising: posters and leaflets sent,
// buckets and tins out and back, shout outs done, someone arranged to come along. Section
// "fundraising": viewers look, editors and admins change. Its own router, beside
// src/routes/admin-fundraising.ts and admin-fundraising-team.ts, so nothing there changes.
//
//   GET  /api/admin/fundraising/requests             every sign up's requests, pills and totals  view
//   POST /api/admin/fundraisers/:id/requests/:kind   { action, from, ...what was entered }        edit
//
// `from` is the step the person saw; if it has moved on since, nothing changes (409). Every change
// writes audit_log in the same transaction (src/db/fundraising-requests.ts). Request and response
// shapes: README.md, "Community fundraising", the requests.

export const adminFundraisingRequestsRouter = Router();

const UNAVAILABLE = { error: "Admin is temporarily unavailable" };
const LOOK_AGAIN = "Some of it needs another look";

function fieldErrors(issues: ZodIssue[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path.join(".") || "form";
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

export async function getFundraisingRequests(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "fundraising", "view");
  if (!claims) return;
  try {
    const today = followUpToday(new Date());
    const [fundraisers, rows] = await Promise.all([listAllFundraisers(), listRequestRows()]);
    const byId = new Map<number, RequestRow[]>();
    for (const r of rows) byId.set(r.fundraiserId, [...(byId.get(r.fundraiserId) ?? []), r]);
    const requests: Record<string, RequestView[]> = {};
    const toDo: Record<string, true> = {};
    const notBack: Record<string, true> = {};
    for (const f of fundraisers) {
      const views = requestViews(f, byId.get(f.id) ?? [], today);
      if (!views.length) continue;
      requests[String(f.id)] = views;
      if (requestsToDo(f, views, today)) toDo[String(f.id)] = true;
      if (views.some((v) => v.status === "with_them")) notBack[String(f.id)] = true;
    }
    const totals = requestTotals(
      fundraisers.map((f) => ({ f, rows: byId.get(f.id) ?? [] })),
      today,
    );
    return res.status(200).json({ today, requests, toDo, notBack, totals });
  } catch (err) {
    console.error("admin fundraising requests read failed:", err instanceof Error ? err.message : err);
    return res.status(500).json(UNAVAILABLE);
  }
}

export async function postFundraiserRequest(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "fundraising", "edit");
  if (!claims) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });
  const kind = String(req.params.kind);
  if (!(REQUEST_KINDS as readonly string[]).includes(kind)) return res.status(404).json({ error: "They did not ask for that." });
  const parsed = requestActionSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: LOOK_AGAIN, fields: fieldErrors(parsed.error.issues) });
  try {
    const out = await changeRequest(id, kind as RequestKind, parsed.data, actorOf(claims), followUpToday(new Date()));
    return res.status(200).json(out);
  } catch (err) {
    if (err instanceof RequestError) {
      if (err.reason === "invalid") return res.status(400).json({ error: LOOK_AGAIN, fields: { [err.field ?? "form"]: err.message } });
      const status = err.reason === "not_found" || err.reason === "not_asked" ? 404 : 409;
      return res.status(status).json({ error: err.message });
    }
    console.error("admin fundraising request change failed:", err instanceof Error ? err.message : err);
    return res.status(500).json(UNAVAILABLE);
  }
}

adminFundraisingRequestsRouter.get("/api/admin/fundraising/requests", getFundraisingRequests);
adminFundraisingRequestsRouter.post("/api/admin/fundraisers/:id/requests/:kind", postFundraiserRequest);
