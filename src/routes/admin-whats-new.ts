import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { authorizeAny, loadEffectivePermissions } from "./admin-authz";
import { arrivalsSince, isArea, isNew, reachableAreas } from "../admin/whats-new";
import { getAccountCreatedAt, getSeen, latestArrival, markSeen } from "../db/whats-new";

// TASK-478: the New pills in the admin, per person.
//
//   GET  /api/admin/whats-new        { areas: [{ area, new, since }] }, for the sections they may open
//   POST /api/admin/whats-new/seen   { area }: they have just opened it, so it is no longer new to them
//
// Open to anyone signed in: each answer covers only the sections the person's own permissions reach,
// and says nothing about what is there beyond "something is new".

const UNAUTHORISED = { error: "Invalid or expired admin session" };

export async function getWhatsNew(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeAny(req, res);
  if (!claims) return;
  const perms = await loadEffectivePermissions(claims.sub);
  const createdAt = perms ? await getAccountCreatedAt(claims.sub) : null;
  if (!perms || !createdAt) return res.status(401).json(UNAUTHORISED);

  const seen = await getSeen(claims.sub);
  const areas = await Promise.all(
    reachableAreas(perms).map(async ({ area }) => {
      const seenAt = seen.get(area) ?? null;
      const since = arrivalsSince(seenAt, createdAt);
      let latest: Date | null = null;
      try {
        latest = await latestArrival(area, since);
      } catch (err) {
        // One database being down must not take every pill with it: this section just shows none.
        console.error(`whats-new: ${area} could not be checked:`, err instanceof Error ? err.message : err);
      }
      return { area, new: isNew({ area, seenAt, accountCreatedAt: createdAt, latestArrival: latest }), since: since.toISOString() };
    }),
  );
  return res.status(200).json({ areas });
}

const seenBody = z.object({ area: z.string() });

export async function postWhatsNewSeen(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeAny(req, res);
  if (!claims) return;
  const body = seenBody.safeParse(req.body);
  if (!body.success || !isArea(body.data.area)) {
    return res.status(400).json({ error: "That is not a section of the admin." });
  }
  const area = body.data.area;
  const perms = await loadEffectivePermissions(claims.sub);
  if (!perms) return res.status(401).json(UNAUTHORISED);
  if (!reachableAreas(perms).some((a) => a.area === area)) {
    return res.status(403).json({ error: "You do not have access to that section." });
  }
  const seenAt = await markSeen(claims.sub, area);
  return res.status(200).json({ area, seenAt: seenAt.toISOString() });
}

export const adminWhatsNewRouter = Router();
adminWhatsNewRouter.get("/api/admin/whats-new", getWhatsNew);
adminWhatsNewRouter.post("/api/admin/whats-new/seen", postWhatsNewSeen);
