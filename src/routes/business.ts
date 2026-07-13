import { Router, type Request, type Response } from "express";
import { z } from "zod";
import {
  getCertificateContextByToken,
  getFulfilmentPageContextByToken,
  updateFulfilmentPreferences,
  FulfilmentCaptureError,
  type FulfilmentPreferences,
} from "../db/fulfilment";
import { bandHasPlatinumPerks, perksForBand, type BandPerks } from "../donors/fulfilment";
import { buildCertificateHtml, certificateHeroName, formatMonthYear } from "../business/certificate";
import { createRateLimiter } from "../portal/request-limiter";

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

// --- Business thank-you page API (TASK-212) -----------------------------------------------------
// The private thank-you page (/business/thank-you) reads and captures the business's recognition
// choices through these two token-addressed routes. The token in the private link IS the auth (there
// is no login), so, exactly like the certificate route above: an unknown token returns the SAME
// generic 404 as a known one that is out of scope (no enumeration), and both routes are rate limited
// so the token space cannot be brute-forced. The capture is SUBMIT-ONCE, enforced in the DB
// (updateFulfilmentPreferences only writes when captured_at IS NULL) and mirrored in the UI.

// Generic replies. The 404 is identical for "unknown token" and "token not found on write", so a
// valid link is indistinguishable from an invalid one. Dash free (task copy constraint).
const FULFILMENT_NOT_FOUND = "This link is not valid. Please ask us for a new one.";
const FULFILMENT_ALREADY_CAPTURED = "You have already sent us your choices. Thank you.";
const FULFILMENT_UNAVAILABLE = "This page is temporarily unavailable. Please try again shortly.";

// Abuse control (mirrors src/routes/portal.ts): cap loads/submissions per token and per client IP.
// In-memory + per-task (a distributed limiter is the documented follow-up). Module-scoped so the
// window persists across requests.
const fulfilmentTokenLimiter = createRateLimiter({ max: 40, windowMs: 15 * 60 * 1000 });
const fulfilmentIpLimiter = createRateLimiter({ max: 200, windowMs: 15 * 60 * 1000 });

// True when the request is over either limit. BOTH limiters are evaluated unconditionally first (so a
// token-limited request still consumes its IP-window slot — short-circuiting would let it skip the IP
// check), exactly like postRequestAccess in src/routes/portal.ts.
function fulfilmentOverLimit(token: string, ip: string): boolean {
  const now = Date.now();
  const tokenOk = fulfilmentTokenLimiter.allow(token, now);
  const ipOk = fulfilmentIpLimiter.allow(ip, now);
  return !(tokenOk && ipOk);
}

// The raw thank-you form body. Every detail field is optional here; which answers are REQUIRED depends
// on the band (its perks) and on the toggle answers, so that is enforced in fulfilmentBodySchema's
// superRefine (server-authoritative — it never trusts the client about the band). `.strict()` rejects
// unknown keys. The certificate address is submitted as its four UK parts and composed server-side.
const fulfilmentBodyBase = z
  .object({
    listOnSupporters: z.boolean(),
    creditName: z.string().trim().min(1).max(200).optional(),
    website: z.string().trim().max(300).optional(),
    wantSocial: z.boolean().optional(),
    socials: z.string().trim().max(200).optional(),
    wantBadge: z.boolean().optional(),
    wantCertificate: z.boolean().optional(),
    certificateDelivery: z.enum(["download", "post"]).optional(),
    addressLine1: z.string().trim().max(200).optional(),
    addressLine2: z.string().trim().max(200).optional(),
    town: z.string().trim().max(120).optional(),
    postcode: z.string().trim().max(20).optional(),
  })
  .strict();

type FulfilmentBody = z.infer<typeof fulfilmentBodyBase>;

// Band-aware validation: EVERY question the band exposes must be answered (nothing may be left blank),
// and any detail a Yes reveals must be filled in. The supporters-page question is asked of every band;
// the social / badge / certificate questions only of a band whose perks include them (platinum). This
// is the server-side mirror of the page's "block submit until every section is answered".
function fulfilmentBodySchema(perks: BandPerks) {
  return fulfilmentBodyBase.superRefine((b, ctx) => {
    // Supporters page (all bands): choosing to be shown requires the display name.
    if (b.listOnSupporters && !b.creditName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["creditName"],
        message: "Tell us how your business name should appear",
      });
    }
    if (perks.socialThankYou && typeof b.wantSocial !== "boolean") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["wantSocial"],
        message: "Please answer the social media thank you question",
      });
    }
    if (perks.digitalBadge && typeof b.wantBadge !== "boolean") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["wantBadge"],
        message: "Please answer the digital badge question",
      });
    }
    if (perks.certificate) {
      if (typeof b.wantCertificate !== "boolean") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["wantCertificate"],
          message: "Please answer the certificate question",
        });
      } else if (b.wantCertificate) {
        if (!b.certificateDelivery) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["certificateDelivery"],
            message: "Please choose how to receive your certificate",
          });
        } else if (b.certificateDelivery === "post") {
          if (!b.addressLine1) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["addressLine1"],
              message: "Please add the first line of your address",
            });
          }
          if (!b.town) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["town"],
              message: "Please add your town or city",
            });
          }
          if (!b.postcode) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["postcode"],
              message: "Please add your postcode",
            });
          }
        }
      }
    }
  });
}

// A trimmed value, or null when empty/absent (the columns store NULL, not "").
function orNull(value: string | undefined): string | null {
  return value && value.length > 0 ? value : null;
}

// Compose the four UK address parts into the single certificate_address text column, one part per
// line, skipping any blank optional line.
function composeAddress(b: FulfilmentBody): string {
  return [b.addressLine1, b.addressLine2, b.town, b.postcode].filter((p) => p && p.length > 0).join("\n");
}

// Resolve the validated body into the stored preferences, SERVER-SIDE against the band's perks: a band
// that does not earn a perk can never set its flag true (defence in depth — the page already hides
// those sections). consent_featured records that the business agreed to be publicly celebrated, which
// is true when they chose to appear on the Supporters page OR asked for the public social thank you.
function resolvePreferences(b: FulfilmentBody, perks: BandPerks): FulfilmentPreferences {
  const wantSocial = perks.socialThankYou ? b.wantSocial === true : false;
  const wantBadge = perks.digitalBadge ? b.wantBadge === true : false;
  const wantCertificate = perks.certificate ? b.wantCertificate === true : false;
  const certificateDelivery = wantCertificate ? (b.certificateDelivery ?? null) : null;
  const certificateAddress =
    wantCertificate && certificateDelivery === "post" ? composeAddress(b) : null;
  return {
    creditName: b.listOnSupporters ? (b.creditName ?? null) : null,
    website: b.listOnSupporters ? orNull(b.website) : null,
    socials: wantSocial ? orNull(b.socials) : null,
    listOnSupporters: b.listOnSupporters,
    wantSocial,
    wantBadge,
    wantCertificate,
    certificateDelivery,
    certificateAddress,
    consentFeatured: b.listOnSupporters || wantSocial,
  };
}

// GET /api/business/fulfilment/:token — the state the page renders: the greeting name, the band and
// its eligible perks (the page shows one section per perk), whether the record is already captured,
// and, when captured, the saved choices (so an already-submitted record renders its read-only
// confirmation). Unknown token → the generic 404.
export async function getFulfilment(req: Request, res: Response): Promise<Response> {
  const token = req.params.token;
  if (fulfilmentOverLimit(token, req.ip ?? "unknown")) {
    return res.status(429).json({ error: "Too many requests. Please try again shortly." });
  }
  try {
    const ctx = await getFulfilmentPageContextByToken(token);
    if (!ctx) return res.status(404).json({ error: FULFILMENT_NOT_FOUND });
    const perks = perksForBand(ctx.band);
    return res.status(200).json({
      businessName: ctx.businessName,
      band: ctx.band,
      perks,
      captured: ctx.captured,
      preferences: ctx.captured
        ? {
            listOnSupporters: ctx.listOnSupporters,
            creditName: ctx.creditName,
            website: ctx.website,
            wantSocial: ctx.wantSocial,
            socials: ctx.socials,
            wantBadge: ctx.wantBadge,
            wantCertificate: ctx.wantCertificate,
            certificateDelivery: ctx.certificateDelivery,
            certificateAddress: ctx.certificateAddress,
            consentFeatured: ctx.consentFeatured,
          }
        : null,
    });
  } catch (err) {
    console.error("business fulfilment read failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: FULFILMENT_UNAVAILABLE });
  }
}

// POST /api/business/fulfilment/:token — capture the choices ONCE. Order: rate limit, then resolve the
// record (unknown → generic 404; already captured → 409, so the page shows the read-only
// confirmation), then band-aware validation, then the audited submit-once write. The write is itself
// submit-once (captured_at IS NULL guard) so a race that slips past the pre-check still 409s.
export async function postFulfilment(req: Request, res: Response): Promise<Response> {
  const token = req.params.token;
  if (fulfilmentOverLimit(token, req.ip ?? "unknown")) {
    return res.status(429).json({ error: "Too many requests. Please try again shortly." });
  }

  let ctx;
  try {
    ctx = await getFulfilmentPageContextByToken(token);
  } catch (err) {
    console.error("business fulfilment lookup failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: FULFILMENT_UNAVAILABLE });
  }
  if (!ctx) return res.status(404).json({ error: FULFILMENT_NOT_FOUND });
  if (ctx.captured) return res.status(409).json({ error: FULFILMENT_ALREADY_CAPTURED });

  const perks = perksForBand(ctx.band);
  const parsed = fulfilmentBodySchema(perks).safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "Please answer every question", details: parsed.error.flatten() });
  }
  const preferences = resolvePreferences(parsed.data, perks);

  try {
    await updateFulfilmentPreferences(token, preferences, "business");
    return res.status(200).json({ captured: true, businessName: ctx.businessName, perks, preferences });
  } catch (err) {
    if (err instanceof FulfilmentCaptureError) {
      // already_captured (a concurrent submit won the race) → 409; not_found → the generic 404.
      return err.reason === "already_captured"
        ? res.status(409).json({ error: FULFILMENT_ALREADY_CAPTURED })
        : res.status(404).json({ error: FULFILMENT_NOT_FOUND });
    }
    console.error("business fulfilment write failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "We could not save your choices just now. Please try again." });
  }
}

businessRouter.get("/api/business/fulfilment/:token", getFulfilment);
businessRouter.post("/api/business/fulfilment/:token", postFulfilment);
