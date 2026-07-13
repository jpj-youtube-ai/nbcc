import { Router, type Request, type Response } from "express";
import { getCertificateContextByToken } from "../db/fulfilment";
import { bandHasPlatinumPerks } from "../donors/fulfilment";
import { buildCertificateHtml, certificateHeroName, formatMonthYear } from "../business/certificate";

// Public business-supporter certificate delivery (TASK-211). A Platinum business supporter's
// secure-thank-you link carries a token; GET /business/certificate/<token> renders their personalised,
// print-ready Certificate of Appreciation (the browser prints it to PDF — no server-side PDF library).
//
// The certificate is a PLATINUM-only recognition perk (src/donors/fulfilment.ts) AND opt-in, so it is
// served ONLY when all three hold: the token resolves to a fulfilment row, that row's band is
// platinum, and want_certificate is true. Any other case is a 404 — the same response as an unknown
// token, so a non-eligible token can't be distinguished from a missing one.
export const businessRouter = Router();

// A small, self-contained 404 page (mirrors the notice pattern in src/routes/thank-you.ts).
function notFound(res: Response): Response {
  return res
    .status(404)
    .type("html")
    .send(
      `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Certificate | Night Before Christmas Campaign</title></head>
<body style="font-family:system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem">
<h1>Certificate not found</h1><p>This certificate link is not valid.</p></body></html>`,
    );
}

export async function getCertificate(req: Request, res: Response): Promise<Response> {
  const ctx = await getCertificateContextByToken(req.params.token);
  // Gate: unknown token, not a platinum band, or the business did not opt into a certificate.
  if (!ctx || !bandHasPlatinumPerks(ctx.band) || !ctx.wantCertificate) {
    return notFound(res);
  }
  const businessName = certificateHeroName(ctx);
  // "Supporting since" = the Month Year of their earliest donation (defaulting to now in the
  // degenerate no-donations case, so the page always renders).
  const since = formatMonthYear(ctx.supportingSince ?? new Date());
  return res.status(200).type("html").send(buildCertificateHtml({ businessName, since }));
}

businessRouter.get("/business/certificate/:token", getCertificate);
