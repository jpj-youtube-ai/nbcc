import { Router, type Request, type Response } from "express";
import { getNewsletterImage } from "../db/newsletter-images";

// Public serve for uploaded newsletter images (TASK-168/REQ-069). Email clients fetch images with
// no session, so this is unauthenticated. Lookup is by uuid only (no path input → no traversal);
// the raster-only upload allow-list + nosniff header prevent a served upload from being sniffed as
// script. The /media/* prefix is deliberately NOT under /assets (no static-server / page-guard clash).
export const newsletterImagesRouter = Router();

// Lookup is by uuid only. A malformed id passed straight to `WHERE id = $1` on the `uuid` column
// makes Postgres THROW `22P02 invalid input syntax for type uuid` rather than return no rows; with
// no global error middleware, an unhandled rejection from that would crash the process — a public,
// unauthenticated DoS. Reject non-uuid ids before the DB call, and belt-and-suspenders wrap the
// handler so any other unexpected DB error 500s instead of crashing.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

newsletterImagesRouter.get("/media/newsletter/:id", async (req: Request, res: Response) => {
  if (!UUID_RE.test(req.params.id)) return res.status(404).type("text/plain").send("Not found");
  try {
    const img = await getNewsletterImage(req.params.id);
    if (!img) return res.status(404).type("text/plain").send("Not found");
    res.setHeader("Content-Type", img.mime);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    return res.send(img.bytes);
  } catch (err) {
    console.error("newsletter image serve failed", err);
    return res.status(500).type("text/plain").send("Error");
  }
});
