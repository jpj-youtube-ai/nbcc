import { Router, type Request, type Response } from "express";
import { getNewsletterImage } from "../db/newsletter-images";

// Public serve for uploaded newsletter images (TASK-168/REQ-069). Email clients fetch images with
// no session, so this is unauthenticated. Lookup is by uuid only (no path input → no traversal);
// the raster-only upload allow-list + nosniff header prevent a served upload from being sniffed as
// script. The /media/* prefix is deliberately NOT under /assets (no static-server / page-guard clash).
export const newsletterImagesRouter = Router();

newsletterImagesRouter.get("/media/newsletter/:id", async (req: Request, res: Response) => {
  const img = await getNewsletterImage(req.params.id);
  if (!img) return res.status(404).type("text/plain").send("Not found");
  res.setHeader("Content-Type", img.mime);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  return res.send(img.bytes);
});
