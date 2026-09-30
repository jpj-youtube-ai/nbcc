import { Router, type Request, type Response } from "express";
import { getEventImage } from "../db/events";

// TASK-453: the public serve for pictures and organiser logos uploaded from the admin's Events
// section. The same shape as GET /media/newsletter/:id (src/routes/newsletter-images.ts), for the
// same reasons: lookup by uuid only, so there is no path to traverse; a non-uuid is refused before
// the database sees it, because Postgres throws on a malformed uuid rather than finding nothing;
// and nosniff, so a served upload can never be read as anything but the picture it claims to be
// (the upload allow-list is raster only, with no SVG).

export const eventImagesRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

eventImagesRouter.get("/media/events/:id", async (req: Request, res: Response) => {
  if (!UUID_RE.test(req.params.id)) return res.status(404).type("text/plain").send("Not found");
  try {
    const img = await getEventImage(req.params.id);
    if (!img) return res.status(404).type("text/plain").send("Not found");
    res.setHeader("Content-Type", img.mime);
    res.setHeader("X-Content-Type-Options", "nosniff");
    // A picture's address never changes what it points to (a new upload gets a new id).
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    return res.send(img.bytes);
  } catch (err) {
    console.error("event image serve failed", err);
    return res.status(500).type("text/plain").send("Error");
  }
});
