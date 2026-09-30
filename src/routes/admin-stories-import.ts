import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { authorizeSection } from "./admin-authz";
import { lookupsFor, planImport, previewOf, readOldSiteExport } from "../stories/old-site-import";
import { erasedStoriesAmong, insertImportedStories, storiesAlreadyHere } from "../db/stories";

// TASK-461: bring the old website's My Story submissions in from its CSV export.
//
//   POST /api/admin/stories/import   { csv, commit? }   stories: edit
//
// Without `commit` it only reads: what would be added, and what would not and why. With it, it reads
// the file again here, never trusting a plan sent back from the browser, and saves. A story erased
// from the admin is never added again (TASK-475): the erase remembered its fingerprint.
//
// The file holds names, emails and phone numbers. The server keeps nothing from it but the rows that
// become stories, and logs only counts. No audit_log row: the stories feature never touches the
// charity database (src/db/stories.ts).

export const STORIES_IMPORT_PATH = "/api/admin/stories/import";
// The admin refuses a file over 2 MB before sending it; this leaves room for the JSON around it.
export const STORIES_IMPORT_BODY_LIMIT = "3mb";

const body = z.object({ csv: z.string().min(1), commit: z.boolean().optional() }).strict();

export const adminStoriesImportRouter = Router();

export async function postStoriesImport(req: Request, res: Response): Promise<void> {
  const claims = await authorizeSection(req, res, "stories", "edit");
  if (!claims) return;
  const input = body.safeParse(req.body);
  if (!input.success) {
    res.status(400).json({ error: "Choose the CSV file exported from the old website's form." });
    return;
  }
  const read = readOldSiteExport(input.data.csv);
  if (!read.ok) {
    res.status(400).json({ error: read.error });
    return;
  }
  try {
    const lookups = lookupsFor(read.rows);
    const [alreadyHere, erasedEarlier] = await Promise.all([storiesAlreadyHere(lookups), erasedStoriesAmong(lookups)]);
    const plan = planImport(read.rows, alreadyHere, new Date(), erasedEarlier);
    const preview = previewOf(plan);
    if (!input.data.commit) {
      res.json(preview);
      return;
    }
    const added = await insertImportedStories(plan.add.map((a) => a.story));
    // Who ran it, and how many: never anything from the file itself.
    console.log(`stories import from the old website by ${claims.email}: ${added} added, ${plan.skip.length} left out`);
    res.json({ ...preview, added });
  } catch (err) {
    console.error("stories import failed:", err instanceof Error ? err.message : err);
    res.status(500).json({
      error: input.data.commit
        ? "The stories could not be saved. Nothing was added."
        : "The file could not be checked against the stories already here. Nothing was saved.",
    });
  }
}

adminStoriesImportRouter.post(STORIES_IMPORT_PATH, postStoriesImport);
