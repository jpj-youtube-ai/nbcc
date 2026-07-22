import { Router, type Request, type Response } from "express";
import { getNewsletterAttachmentById } from "../db/newsletter-attachments";
import { buildDocumentPage, buildDocumentNotFoundPage } from "../newsletter/document-page";

// Public hosted newsletter documents (replaces email attachments — see
// docs/superpowers/specs/2026-07-22-newsletter-hosted-documents-design.md). A newsletter's button
// block links `/newsletter/document/<uuid>`; recipients open it with no session, so both routes are
// unauthenticated and the random uuid is the whole capability (the newsletter-images trust model).
//
// Same 22P02 guard as newsletter-images: a malformed id hitting `WHERE id = $1` on a uuid column
// makes Postgres throw rather than return no rows, and an unhandled rejection on a public route is
// a crash-loop DoS — so ids are shape-checked before the DB call, and handlers are belt-and-
// suspenders wrapped.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Content-Disposition filename: quoted-string with quotes/control chars stripped, so an uploaded
// filename can't smuggle header syntax.
function dispositionFilename(filename: string): string {
  return filename.replace(/["\\\r\n]/g, "").slice(0, 200) || "document";
}

export const newsletterDocumentsRouter = Router();

// The branded viewer page: inline preview (PDF/images) + open/print + download actions.
newsletterDocumentsRouter.get("/newsletter/document/:id", async (req: Request, res: Response) => {
  const notFound = () => res.status(404).type("html").send(buildDocumentNotFoundPage());
  if (!UUID_RE.test(req.params.id)) return notFound();
  try {
    const doc = await getNewsletterAttachmentById(req.params.id);
    if (!doc) return notFound();
    return res
      .status(200)
      .type("html")
      .send(buildDocumentPage({ id: doc.id, filename: doc.filename, mime: doc.mime }));
  } catch (err) {
    console.error("newsletter document page failed", err);
    return res.status(500).type("text/plain").send("Error");
  }
});

// The bytes. Inline by default (the browser's own PDF/image viewer is the print path);
// `?download=1` switches to an attachment disposition carrying the original filename. These routes
// serve UPLOADED bytes inline from our origin, so: nosniff pins the stored mime (the upload
// allow-list has no HTML/SVG), and a sandboxing CSP inerts anything that would try to script.
newsletterDocumentsRouter.get(
  "/newsletter/document/:id/file",
  async (req: Request, res: Response) => {
    if (!UUID_RE.test(req.params.id)) return res.status(404).type("text/plain").send("Not found");
    try {
      const doc = await getNewsletterAttachmentById(req.params.id);
      if (!doc) return res.status(404).type("text/plain").send("Not found");
      const disposition = req.query.download === "1" ? "attachment" : "inline";
      res.setHeader("Content-Type", doc.mime);
      res.setHeader("Content-Disposition", `${disposition}; filename="${dispositionFilename(doc.filename)}"`);
      res.setHeader("X-Content-Type-Options", "nosniff");
      // Sandbox everything except PDFs: CSP sandbox can disable the browser's built-in PDF viewer
      // (the certificate use case). PDFs are covered by nosniff + the upload allow-list, which
      // admits no HTML/SVG/scriptable types — the same posture as /media/newsletter images.
      if (doc.mime !== "application/pdf") {
        res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'");
      }
      // Bytes for a given uuid never change (documents are insert/delete only), so cache hard.
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      return res.send(doc.bytes);
    } catch (err) {
      console.error("newsletter document serve failed", err);
      return res.status(500).type("text/plain").send("Error");
    }
  },
);
