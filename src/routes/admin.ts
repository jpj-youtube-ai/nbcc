import { Router, type Request, type Response } from "express";
import { z } from "zod";
import {
  findUserByEmail,
  adminCancelGiftAid,
  recordAdminSubscriptionCancellation,
  searchDonors,
  searchDeclarations,
  searchDonations,
  submitClaimBatch,
  createClaimBatch,
  listEligibleForClaim,
  getDonorAddress,
  listAdjustmentDueDonations,
  ClaimBatchSubmitError,
  listRetentionExpiryDeclarations,
  listAwaitingDeclarationDonations,
  listGasdsDeadlineDonations,
  markGasdsClaimed,
  listDeclarationsDueReview,
  listDonations,
  listClaimBatches,
  listAuditLog,
  listDunning,
} from "../db/admin";
import { listClaimableDonationsForExport, assignDonationToBatch, BatchAssignmentError, recordAudit } from "../db/donations";
import {
  listBusinessFulfilments,
  markFulfilmentFlag,
  FULFILMENT_FLAGS,
  FulfilmentFlagError,
  listUninvitedBusinessSupporters,
  markFulfilmentInvited,
} from "../db/fulfilment";
import { runBusinessInviteBackfill } from "../business/backfill";
import { listStories, getStory, updateStory, deleteStory } from "../db/stories";
import { listEnquiries, getEnquiry, markReplied, deleteEnquiry } from "../db/contact";
import { toCharitiesOnlineCsv } from "../claims/charities-online";
import { verifyPassword } from "../admin/password";
import { touchLastLogin } from "../db/admin-users";
import { signAdminSession, type AdminSessionClaims } from "../admin/session";
import {
  generateLoginCode,
  hashLoginCode,
  verifyLoginCode,
  issueDeviceToken,
  verifyDeviceToken,
} from "../admin/two-factor";
import { upsertLoginCode, getLoginCode, bumpLoginCodeAttempts, deleteLoginCode } from "../db/login-codes";
import { twoFactorSchema } from "../admin/user-schema";
import { authorizeSection } from "./admin-authz";
import { getDonorPortalSnapshot, updateDonorPortal, getActiveDeclarationForDonor } from "../db/portal";
import { cancelSubscription } from "../clients/stripe";
import { DeclarationCancellationError, reviseDeclaration } from "../db/declarations";
import { declarationFieldsSchema } from "../declarations/fields";
import { getGasdsPoolReport } from "../gasds/pool";
import { listThankYouEligible, recordThankYouSent, listThankYouSent, deleteThankYouSent } from "../db/thank-you";
import { DEFAULT_THANK_YOU_THRESHOLD_PENCE, thankYouInputSchema, giftSummary } from "../thank-you/model";
import { buildThankYouEmailHtml, buildThankYouEmailText, thankYouSubject } from "../thank-you/letter";
import { signThankYouLetterToken } from "../thank-you/letter-token";
import { listSupporters, createSupporter, updateSupporter, deleteSupporter } from "../db/ticker";
import { supporterCreateSchema, supporterUpdateSchema } from "../ticker/model";
import {
  listNewsletters,
  getNewsletter,
  createNewsletter,
  updateNewsletterDraft,
  listNewsletterRecipients,
  addNewsletterSubscriber,
  listNewsletterSubscribers,
  unsubscribeSubscriberByEmail,
  claimNewsletterForSend,
  setNewsletterDeliverySummary,
} from "../db/newsletters";
import { renderNewsletter, newsletterDocSchema } from "../newsletter/blocks";
import { validateUpload, insertNewsletterImage } from "../db/newsletter-images";
import {
  validateAttachment,
  insertNewsletterAttachment,
  listNewsletterAttachments,
  listNewsletterAttachmentsForSend,
  deleteNewsletterAttachment,
} from "../db/newsletter-attachments";
import { signUnsubscribeToken } from "../donors/unsubscribe-token";
import { buildNewsletterHtml } from "../donors/newsletter";
import { sendNewsletter, sendThankYou, sendAdminLoginCode, sendBusinessSupporterInvite } from "../clients/email";
import { createRateLimiter } from "../portal/request-limiter";
import { clampPage } from "../db/admin";
import { config } from "../config";

// The role-based admin login endpoint (REQ-062 · TASK-105). POST /api/admin/login verifies a staff
// user's email + password (scrypt) and, on success, returns a signed session token — the bearer-token
// analogue of the donor portal's magic link — carrying the user's id/email/role. Invalid credentials
// return 401. The token is stateless (HMAC-signed with ADMIN_SESSION_SECRET, no DB session row); the
// role-gated admin actions that consume it are TASK-106. Mounted in src/app.ts (after express.json).
export const adminRouter = Router();

// A dummy scrypt hash to verify against when the email is unknown, so an unknown-email request does
// the same scrypt work as a known one — no user enumeration via response timing.
const DUMMY_HASH =
  "scrypt$00000000000000000000000000000000$" +
  "0000000000000000000000000000000000000000000000000000000000000000" +
  "0000000000000000000000000000000000000000000000000000000000000000";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  // Admin management Phase 3 (TASK-188): a 30-day "remember this device" token, replayed by the
  // front end from localStorage. Optional — its absence is the normal case (2FA required).
  deviceToken: z.string().optional(),
});

// Abuse control for both login steps (Phase 3 · TASK-188): cap attempts per email AND per client IP
// (mirrors src/routes/portal.ts's requestAccess). Separate limiter instances per step so a flood of
// bad codes at step 2 can't also starve step 1 (and vice versa). In-memory, per-task — same
// documented follow-up as request-limiter.ts.
const loginEmailLimiter = createRateLimiter({ max: 10, windowMs: 15 * 60 * 1000 });
const loginIpLimiter = createRateLimiter({ max: 30, windowMs: 15 * 60 * 1000 });
const twoFactorEmailLimiter = createRateLimiter({ max: 10, windowMs: 15 * 60 * 1000 });
const twoFactorIpLimiter = createRateLimiter({ max: 30, windowMs: 15 * 60 * 1000 });

// Same-host (loopback) requests are trusted and exempt from the login rate limiters above. Behind
// the ALB in staging/production the app runs with `trust proxy = 1`, so req.ip is ALWAYS the real
// forwarded client IP for external traffic — an attacker cannot forge it to loopback (the ALB
// appends the true client IP, which trust-proxy-1 selects). A request only presents as loopback when
// it originates on the box itself: local `npm run dev`, or the pr.yml BDD suite driving the app over
// http://localhost. Exempting loopback keeps the per-email/per-IP caps fully in force for every real
// external client, while letting the local test suite — which necessarily hammers one IP with reused
// emails across many logins — exercise the login flow. Approved explicitly (TASK-200).
function isLoopbackRequest(req: Request): boolean {
  const ip = req.ip ?? "";
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

const LOGIN_CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_LOGIN_CODE_ATTEMPTS = 5;
const TOO_MANY_ATTEMPTS_MESSAGE = "Too many attempts. Please try again shortly.";
const INVALID_CODE_MESSAGE = "Invalid or expired code";

export async function postAdminLogin(req: Request, res: Response): Promise<Response> {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid login request", details: parsed.error.flatten() });
  }

  const now = Date.now();
  if (!isLoopbackRequest(req)) {
    const emailOk = loginEmailLimiter.allow(parsed.data.email, now);
    const ipOk = loginIpLimiter.allow(req.ip ?? "unknown", now);
    if (!emailOk || !ipOk) {
      return res.status(429).json({ error: TOO_MANY_ATTEMPTS_MESSAGE });
    }
  }

  try {
    const user = await findUserByEmail(parsed.data.email);
    // Always run a password verification (against a dummy hash when the user is unknown) so the
    // timing does not reveal whether the email exists. A null password_hash (no credential set) and
    // a wrong password both fail here, yielding the same generic 401.
    const ok = await verifyPassword(parsed.data.password, user?.password_hash ?? DUMMY_HASH);
    if (!user || !ok) {
      return res.status(401).json({ error: "Invalid email or password" });
    }
    // Admin management Phase 1 (Task 6): a disabled or still-invited (no password accepted yet)
    // account is rejected with the SAME generic 401 as a bad password — no account enumeration of
    // the account's lifecycle status via a distinct error.
    if (user.status === "disabled" || user.status === "invited") {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    // Admin management Phase 3 (TASK-188): a valid 30-day device token FOR THIS USER skips the
    // mandatory 2FA code step — a stolen device token alone grants nothing without also knowing the
    // password, since we only reach here after the password check above.
    if (typeof parsed.data.deviceToken === "string" && parsed.data.deviceToken.length > 0) {
      const deviceClaims = verifyDeviceToken(parsed.data.deviceToken, config.ADMIN_SESSION_SECRET, new Date());
      if (deviceClaims && deviceClaims.sub === user.id) {
        await touchLastLogin(user.id);
        const { token, claims } = signAdminSession({
          sub: user.id,
          email: user.email,
          role: user.role,
          now: new Date(),
          secret: config.ADMIN_SESSION_SECRET,
        });
        return res.status(200).json({
          token,
          expiresAt: new Date(claims.exp).toISOString(),
          user: { id: user.id, email: user.email, fullName: user.full_name, role: user.role },
        });
      }
    }

    // Mandatory email 2FA: generate + store a one-time code and best-effort email it. No session is
    // issued yet — the front end proceeds to POST /api/admin/login/2fa. devCode is included ONLY
    // outside production (config.NODE_ENV !== "production"), so staging can always complete 2FA even
    // when the email client is stubbed there; production always emails the code and never echoes it.
    const code = generateLoginCode();
    await upsertLoginCode(
      user.id,
      hashLoginCode(code, config.ADMIN_SESSION_SECRET),
      new Date(Date.now() + LOGIN_CODE_TTL_MS),
    );
    await sendAdminLoginCode({ email: user.email, fullName: user.full_name, code }).catch((err) => {
      console.error(`admin login-code email to ${user.email} failed`, err);
    });
    return res.status(200).json({
      step: "2fa",
      email: user.email,
      devCode: config.NODE_ENV !== "production" ? code : undefined,
    });
  } catch (err) {
    // The message is safe to log; no secret, password, code, or device token is included.
    console.error("admin login failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Login is temporarily unavailable" });
  }
}

adminRouter.post("/api/admin/login", postAdminLogin);

// POST /api/admin/login/2fa — step 2 of admin login (Phase 3 · TASK-188). Verifies the one-time
// email code issued by step 1 and, on success, issues the session token (+ optionally a 30-day
// device token when the caller ticks "remember this device"). Every failure path — unknown/disabled
// user, no pending code, expired code, attempt cap exceeded, wrong code — returns the SAME generic
// 401 (no enumeration, mirrors postAdminLogin's anti-enumeration contract).
export async function postAdminLoginTwoFactor(req: Request, res: Response): Promise<Response> {
  const parsed = twoFactorSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid 2FA request", details: parsed.error.flatten() });
  }

  const now = Date.now();
  if (!isLoopbackRequest(req)) {
    const emailOk = twoFactorEmailLimiter.allow(parsed.data.email, now);
    const ipOk = twoFactorIpLimiter.allow(req.ip ?? "unknown", now);
    if (!emailOk || !ipOk) {
      return res.status(429).json({ error: TOO_MANY_ATTEMPTS_MESSAGE });
    }
  }

  try {
    const user = await findUserByEmail(parsed.data.email);
    if (!user || user.status === "disabled" || user.status === "invited") {
      return res.status(401).json({ error: INVALID_CODE_MESSAGE });
    }

    const row = await getLoginCode(user.id);
    if (!row || row.expires_at.getTime() <= Date.now()) {
      return res.status(401).json({ error: INVALID_CODE_MESSAGE });
    }

    // The attempt counter is bumped on EVERY verification try (including the one that turns out
    // correct) — a lockout check up front, before the code compare, so a request that arrives after
    // the cap is already exceeded never gets a free extra guess.
    const attempts = await bumpLoginCodeAttempts(user.id);
    if (attempts > MAX_LOGIN_CODE_ATTEMPTS) {
      await deleteLoginCode(user.id);
      return res.status(401).json({ error: INVALID_CODE_MESSAGE });
    }

    if (!verifyLoginCode(parsed.data.code, row.code_hash, config.ADMIN_SESSION_SECRET)) {
      return res.status(401).json({ error: INVALID_CODE_MESSAGE });
    }

    // Success: the code is one-time use — delete it immediately so it can't be replayed.
    await deleteLoginCode(user.id);
    await touchLastLogin(user.id);

    const { token } = signAdminSession({
      sub: user.id,
      email: user.email,
      role: user.role,
      now: new Date(),
      secret: config.ADMIN_SESSION_SECRET,
    });
    // deviceToken is genuinely OMITTED (not present-with-undefined) when not remembering — a
    // conditional spread rather than an `undefined`-valued key, so callers can rely on
    // `"deviceToken" in body` as well as a truthiness check.
    const deviceToken =
      parsed.data.remember === true
        ? issueDeviceToken({ sub: user.id, now: new Date(), secret: config.ADMIN_SESSION_SECRET })
        : undefined;

    return res.status(200).json({
      token,
      user: { id: user.id, email: user.email, fullName: user.full_name, role: user.role },
      ...(deviceToken !== undefined ? { deviceToken } : {}),
    });
  } catch (err) {
    // The message is safe to log; no secret, code, code hash, or device token is included.
    console.error("admin 2fa login failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Login is temporarily unavailable" });
  }
}

adminRouter.post("/api/admin/login/2fa", postAdminLoginTwoFactor);

// --- Role-gated admin actions on a donor's behalf (REQ-062 · TASK-106) --------------------------
// These mirror the self-serve donor-portal routes (src/routes/portal.ts) but are authorised by the
// admin session token instead of a magic-link token, and act on a donor by id. Authorisation is
// authorizeSection (src/routes/admin-authz.ts, Admin management Phase 2): a missing/invalid token is
// 401, and the DB-backed per-section permission matrix gates writes — Viewer-level access is
// read-only (403 on any PATCH/POST), Editor/Admin-level ("edit") may write. Every write reuses the
// existing audited helpers (updateDonorPortal / adminCancelGiftAid / recordAdminSubscriptionCancellation),
// so its audit_log row commits in the same transaction.

// Parse and validate the donor id in the path; sends a 400 and returns null when it is not a
// positive integer.
function donorId(req: Request, res: Response): number | null {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid donor id" });
    return null;
  }
  return id;
}

// The admin's audit actor label, so a donor-record change records WHICH admin acted on their behalf.
// Exported (Task 5) so src/routes/admin-users.ts records the same actor shape on its audited writes.
export const actorOf = (claims: AdminSessionClaims): string => `admin:${claims.email}`;

// Parse and validate the newsletter id in the path; sends a 400 and returns null when it is not a
// positive integer (mirrors donorId above).
function newsletterId(req: Request, res: Response): number | null {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid newsletter id" });
    return null;
  }
  return id;
}

// A newsletter arrives as EITHER a block document (bodyJson, the builder) OR raw HTML (bodyHtml,
// legacy + BDD). At least one is required. When bodyJson is present it is the source of truth and
// body_html is the compiled render; otherwise the raw HTML is stored as-is (rawHtml passthrough).
const newsletterBodySchema = z
  .object({
    subject: z.string().min(1),
    bodyJson: newsletterDocSchema.optional(),
    bodyHtml: z.string().min(1).optional(),
  })
  .refine((v) => v.bodyJson !== undefined || v.bodyHtml !== undefined, {
    message: "Provide bodyJson or bodyHtml",
  });

// Compile the posted payload into { bodyHtml, bodyJson } for storage. Preview name is neutral for
// the stored render — the real per-recipient name is applied at send time.
function compileNewsletterBody(data: z.infer<typeof newsletterBodySchema>): {
  bodyHtml: string;
  bodyJson: unknown | null;
} {
  if (data.bodyJson !== undefined) {
    return { bodyHtml: renderNewsletter(data.bodyJson, { firstName: "friend" }), bodyJson: data.bodyJson };
  }
  return { bodyHtml: data.bodyHtml as string, bodyJson: null };
}

// First name for the greeting merge: first whitespace-delimited token of the donor's full name,
// falling back to "friend" when we have no usable name.
function firstNameOf(fullName: string | null): string {
  const token = (fullName ?? "").trim().split(/\s+/)[0];
  return token.length > 0 ? token : "friend";
}

// GET /api/admin/newsletters — list summaries (Editor+; read-only but the tab is a staff tool).
export async function getAdminNewsletters(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "newsletter", "edit"))) return;
  return res.json(await listNewsletters());
}

// GET /api/admin/newsletters/:id — one newsletter incl. body_html (Editor+).
export async function getAdminNewsletter(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "newsletter", "edit"))) return;
  const id = newsletterId(req, res);
  if (id === null) return;
  const row = await getNewsletter(id);
  if (!row) return res.status(404).json({ error: "Newsletter not found" });
  return res.json(row);
}

// POST /api/admin/newsletters — create a new draft (Editor+).
export async function postAdminNewsletter(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "newsletter", "edit"))) return;
  const parsed = newsletterBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid newsletter", details: parsed.error.flatten() });
  }
  const { bodyHtml, bodyJson } = compileNewsletterBody(parsed.data);
  const created = await createNewsletter(parsed.data.subject, bodyHtml, bodyJson);
  return res.status(201).json(created);
}

// POST /api/admin/newsletters/preview — render a block document to email HTML for the live builder
// preview (Editor+). Stateless, no DB. Uses a sample first name so merge fields show realistically.
export async function postAdminNewsletterPreview(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "newsletter", "edit"))) return;
  const parsed = z.object({ bodyJson: newsletterDocSchema }).safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid newsletter", details: parsed.error.flatten() });
  }
  // Pass a placeholder unsubscribe URL so the preview shows the (non-functional) Unsubscribe button
  // the recipient will get — real sends substitute a signed per-recipient link.
  return res.json({ html: renderNewsletter(parsed.data.bodyJson, { firstName: "Jane", unsubscribeUrl: "#" }) });
}

// GET /api/admin/newsletters/recipients — Admin only. The deduped list of consenting donor emails a
// send would go to, for the send-confirmation dialog. Admin-gated (matches send) because it exposes
// donor PII; returns the same recipient set the send loop uses, so the confirmation can't drift.
export async function getAdminNewsletterRecipients(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "newsletter", "edit"))) return;
  const recipients = await listNewsletterRecipients();
  return res.json({ count: recipients.length, emails: recipients.map((r) => r.email) });
}

// POST /api/admin/newsletters/subscribers — manually add a newsletter subscriber (Editor+), e.g. an
// email collected verbally on a doorstep. Creates a consenting donor, or re-enables consent if the
// address is already on file (idempotent). 201 for a new subscriber, 200 for a re-subscribe.
const newsletterSubscriberSchema = z.object({
  email: z.string().trim().email(),
  name: z.string().trim().max(200).optional(),
});
export async function postAdminNewsletterSubscriber(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "newsletter", "edit"))) return;
  const parsed = newsletterSubscriberSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid subscriber", details: parsed.error.flatten() });
  }
  const result = await addNewsletterSubscriber(parsed.data.email, parsed.data.name);
  return res.status(result.status === "added" ? 201 : 200).json(result);
}

// PUT /api/admin/newsletters/:id — edit a draft (Editor+). A sent newsletter is immutable → 409.
export async function putAdminNewsletter(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "newsletter", "edit"))) return;
  const id = newsletterId(req, res);
  if (id === null) return;
  const parsed = newsletterBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid newsletter", details: parsed.error.flatten() });
  }
  const existing = await getNewsletter(id);
  if (!existing) return res.status(404).json({ error: "Newsletter not found" });
  if (existing.status === "sent") {
    return res.status(409).json({ error: "A sent newsletter cannot be edited" });
  }
  const { bodyHtml, bodyJson } = compileNewsletterBody(parsed.data);
  const updated = await updateNewsletterDraft(id, parsed.data.subject, bodyHtml, bodyJson);
  if (!updated) return res.status(409).json({ error: "A sent newsletter cannot be edited" });
  return res.json(updated);
}

// POST /api/admin/newsletters/:id/send — Admin only. Sends one email per consenting donor, each with
// an unsubscribe link, then marks the newsletter sent. Idempotent: an already-sent newsletter → 409.
export async function postAdminSendNewsletter(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "newsletter", "edit");
  if (!claims) return;
  const id = newsletterId(req, res);
  if (id === null) return;

  // Atomically claim the draft BEFORE sending. If another request already sent it (or it never
  // existed as a draft), we 409 without emailing anyone — a double-click cannot re-blast.
  const newsletter = await claimNewsletterForSend(id, claims.sub);
  if (!newsletter) {
    const existing = await getNewsletter(id);
    if (!existing) return res.status(404).json({ error: "Newsletter not found" });
    return res.status(409).json({ error: "This newsletter has already been sent" });
  }

  const recipients = await listNewsletterRecipients();
  const parsedDoc = newsletterDocSchema.safeParse(newsletter.bodyJson);
  // Load any file attachments once and base64-encode them; the same set goes to every recipient.
  const attachmentRows = await listNewsletterAttachmentsForSend(id);
  const attachments = attachmentRows.length
    ? attachmentRows.map((a) => ({ filename: a.filename, content: a.bytes.toString("base64"), contentType: a.mime }))
    : undefined;
  const failedEmails: string[] = [];
  for (const r of recipients) {
    const token = signUnsubscribeToken(r.donorId, config.ADMIN_SESSION_SECRET);
    const unsubscribeUrl = `${config.PORTAL_BASE_URL}/unsubscribe/${token}`;
    // Block-doc newsletters render per recipient (merge the first name) with the unsubscribe button
    // built into the branded frame footer. Legacy raw-HTML rows (no valid bodyJson) are not framed,
    // so they still get the standalone unsubscribe footer appended via buildNewsletterHtml.
    const html = parsedDoc.success
      ? renderNewsletter(parsedDoc.data, { firstName: firstNameOf(r.fullName), unsubscribeUrl })
      : buildNewsletterHtml(newsletter.bodyHtml, unsubscribeUrl);
    try {
      await sendNewsletter({
        email: r.email,
        from: config.NEWSLETTER_FROM_EMAIL,
        replyTo: config.NEWSLETTER_FROM_EMAIL,
        subject: newsletter.subject,
        html,
        attachments,
      });
    } catch (err) {
      // Best-effort: a single failed send is recorded (not fatal to the batch) so the delivery
      // summary can surface which addresses did not get it.
      console.error(`newsletter send to ${r.email} failed`, err);
      failedEmails.push(r.email);
    }
  }

  const sentCount = recipients.length - failedEmails.length;
  await setNewsletterDeliverySummary(id, {
    recipientCount: recipients.length,
    sentCount,
    failedCount: failedEmails.length,
    failedEmails,
  });
  return res.json({
    status: "sent",
    recipientCount: recipients.length,
    sentCount,
    failedCount: failedEmails.length,
    failedEmails,
  });
}

// POST /api/admin/newsletters/test-send — send ONE copy of the posted draft to the signed-in admin's
// own email (Editor+), so they can check how it lands in a real inbox before blasting everyone. Does
// not touch newsletter state (no claim, no status change). Mirrors the preview body ({ subject,
// bodyJson }); the subject is prefixed [TEST] and a placeholder unsubscribe URL is used.
const testSendSchema = z.object({ subject: z.string().trim().min(1), bodyJson: newsletterDocSchema });
export async function postAdminNewsletterTestSend(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "newsletter", "edit");
  if (!claims) return;
  const parsed = testSendSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid newsletter", details: parsed.error.flatten() });
  }
  const html = renderNewsletter(parsed.data.bodyJson, {
    firstName: firstNameOf(claims.email),
    unsubscribeUrl: `${config.PORTAL_BASE_URL}/unsubscribe/preview`,
  });
  try {
    await sendNewsletter({
      email: claims.email,
      from: config.NEWSLETTER_FROM_EMAIL,
      replyTo: config.NEWSLETTER_FROM_EMAIL,
      subject: `[TEST] ${parsed.data.subject}`,
      html,
    });
  } catch (err) {
    console.error("newsletter test-send failed", err);
    return res.status(502).json({ error: "Could not send the test email." });
  }
  return res.json({ sentTo: claims.email });
}

// GET /api/admin/newsletters/subscribers[?q=] — the managed subscriber list (Editor+, donor PII).
export async function getAdminNewsletterSubscribers(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "newsletter", "edit"))) return;
  const q = typeof req.query.q === "string" ? req.query.q : undefined;
  const subscribers = await listNewsletterSubscribers(q);
  return res.json({ count: subscribers.length, subscribers });
}

// GET /api/admin/newsletters/subscribers.csv — the full subscriber list as CSV (Editor+).
export async function getAdminNewsletterSubscribersCsv(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "newsletter", "edit"))) return;
  const subscribers = await listNewsletterSubscribers();
  const esc = (v: string): string => `"${v.replace(/"/g, '""')}"`;
  const csv = ["email,name", ...subscribers.map((s) => `${esc(s.email)},${esc(s.name ?? "")}`)].join("\r\n");
  return res
    .status(200)
    .type("text/csv")
    .set("Content-Disposition", 'attachment; filename="newsletter-subscribers.csv"')
    .send(csv);
}

// POST /api/admin/newsletters/subscribers/remove — unsubscribe an address (Editor+). Idempotent; a
// 404 when the address was not a consenting subscriber.
const removeSubscriberSchema = z.object({ email: z.string().trim().email() });
export async function postAdminRemoveNewsletterSubscriber(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "newsletter", "edit"))) return;
  const parsed = removeSubscriberSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid subscriber", details: parsed.error.flatten() });
  }
  const removed = await unsubscribeSubscriberByEmail(parsed.data.email);
  if (removed === 0) return res.status(404).json({ error: "That address is not a current subscriber" });
  return res.json({ email: parsed.data.email.trim().toLowerCase(), removed });
}

// --- Newsletter attachments (TASK-193) ---------------------------------------------------------
// Files attached to a draft newsletter and sent as email attachments to every recipient. Editor+
// (newsletter:edit); a sent newsletter is immutable, so uploads/deletes are draft-only.
const attachmentUploadSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  mime: z.string().min(1),
  dataBase64: z.string().min(1),
});

// POST /api/admin/newsletters/:id/attachments — upload a file to attach to this newsletter.
export async function postAdminNewsletterAttachment(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "newsletter", "edit");
  if (!claims) return;
  const id = newsletterId(req, res);
  if (id === null) return;
  const existing = await getNewsletter(id);
  if (!existing) return res.status(404).json({ error: "Newsletter not found" });
  if (existing.status === "sent") return res.status(409).json({ error: "A sent newsletter cannot be edited" });
  const parsed = attachmentUploadSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid upload" });
  const bytes = Buffer.from(parsed.data.dataBase64, "base64");
  const check = validateAttachment(parsed.data.mime, bytes.length);
  if (!check.ok) {
    const status = check.reason === "size" ? 413 : 400;
    return res
      .status(status)
      .json({ error: check.reason === "size" ? "Attachment too large (10 MB max)" : "Unsupported file type" });
  }
  const meta = await insertNewsletterAttachment(id, parsed.data.filename, parsed.data.mime, bytes, claims.sub);
  return res.status(201).json(meta);
}

// GET /api/admin/newsletters/:id/attachments — list this newsletter's attachments (metadata only).
export async function getAdminNewsletterAttachments(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "newsletter", "edit"))) return;
  const id = newsletterId(req, res);
  if (id === null) return;
  const attachments = await listNewsletterAttachments(id);
  return res.json({ attachments });
}

// DELETE /api/admin/newsletters/:id/attachments/:attId — remove an attachment (draft only).
export async function deleteAdminNewsletterAttachment(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "newsletter", "edit"))) return;
  const id = newsletterId(req, res);
  if (id === null) return;
  const existing = await getNewsletter(id);
  if (!existing) return res.status(404).json({ error: "Newsletter not found" });
  if (existing.status === "sent") return res.status(409).json({ error: "A sent newsletter cannot be edited" });
  const removed = await deleteNewsletterAttachment(id, String(req.params.attId));
  if (!removed) return res.status(404).json({ error: "Attachment not found" });
  return res.json({ removed: true });
}

// GET /api/admin/donors/:id — the donor snapshot (reuses getDonorPortalSnapshot). Read-only, so any
// authenticated role (Viewer and up) may call it.
export async function getAdminDonor(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "donations", "view"))) return;
  const id = donorId(req, res);
  if (id == null) return;
  try {
    const snapshot = await getDonorPortalSnapshot(id);
    if (!snapshot) return res.status(404).json({ error: "Donor not found" });
    // Enrich the admin view with the donor's postal address (declaration for an individual, billing
    // for a company) — kept off the donor-facing portal snapshot, so it is merged in here.
    const address = await getDonorAddress(id);
    const declaration = await getActiveDeclarationForDonor(id);
    return res.status(200).json({ ...snapshot, ...address, declaration });
  } catch (err) {
    console.error("admin donor read failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin is temporarily unavailable" });
  }
}

// The editable donor fields — same shape as the self-serve PATCH (src/routes/portal.ts).
const adminPatchSchema = z
  .object({
    fullName: z.string().trim().min(1).optional(),
    email: z.string().trim().email().optional(),
    emailConsent: z.boolean().optional(),
    anonymous: z.boolean().optional(),
    // Admin-only "hide from supporters wall" override (TASK-223): removes the donor from the public
    // wall regardless of any opt-in. Not exposed on the self-serve portal schema.
    hiddenFromSupporters: z.boolean().optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: "no fields to update" });

// PATCH /api/admin/donors/:id — update the donor's editable fields (reuses updateDonorPortal, which
// appends a `donor.updated` audit row in the same transaction). Editor/Admin only.
export async function patchAdminDonor(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "donations", "edit");
  if (!claims) return;
  const id = donorId(req, res);
  if (id == null) return;

  const parsed = adminPatchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid donor update", details: parsed.error.flatten() });
  }
  try {
    await updateDonorPortal(id, parsed.data, actorOf(claims));
    const snapshot = await getDonorPortalSnapshot(id);
    if (!snapshot) return res.status(404).json({ error: "Donor not found" });
    return res.status(200).json(snapshot);
  } catch (err) {
    console.error("admin donor update failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin update is temporarily unavailable" });
  }
}

// PATCH /api/admin/donors/:id/declaration — correct the identity/address on the donor's active Gift
// Aid declaration on their behalf (REQ-059 · TASK-130). The admin-authorised twin of the portal's
// patchDeclaration: Editor/Admin only. scope + taxpayer are held at the current values, so
// reviseDeclaration always AMENDS in place (a `declaration.amended` audit note, no new row); the
// account name is synced so donors.full_name never diverges from the declaration. Both audit rows
// record admin:<email>. No active declaration → 404. The amend and the name sync run in ONE
// transaction (reviseDeclaration's syncDonorFullName, TASK-131) — atomic.
export async function patchAdminDeclaration(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "donations", "edit");
  if (!claims) return;
  const id = donorId(req, res);
  if (id == null) return;

  const parsed = declarationFieldsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid declaration update", details: parsed.error.flatten() });
  }
  const fields = parsed.data;

  try {
    const active = await getActiveDeclarationForDonor(id);
    if (!active) {
      return res.status(404).json({ error: "No active Gift Aid declaration to edit" });
    }
    const result = await reviseDeclaration(active.id, fields, {
      scope: active.scope,
      confirmedTaxpayer: active.confirmedTaxpayer,
      mode: "once",
      actor: actorOf(claims),
      syncDonorFullName: `${fields.firstName} ${fields.lastName}`,
    });

    const snapshot = await getDonorPortalSnapshot(id);
    const address = await getDonorAddress(id);
    const declaration = await getActiveDeclarationForDonor(id);
    return res.status(200).json({ ...snapshot, ...address, declaration, outcome: result.outcome });
  } catch (err) {
    console.error("admin declaration update failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin update is temporarily unavailable" });
  }
}

// The subscription cancel body — same reduce-instead acknowledgement as the self-serve route.
const adminCancelSubSchema = z.object({
  subscriptionId: z.string().min(1),
  accepted: z.enum(["reduce", "cancel"]),
});

// POST /api/admin/donors/:id/subscription/cancel — cancel a donor's monthly gift on their behalf,
// behind the same reduce-instead gate as the self-serve flow (REQ-055). Editor/Admin only. Cancels
// in Stripe (cancelSubscription) then records the admin action (recordAdminSubscriptionCancellation).
export async function postAdminCancelSubscription(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "donations", "edit");
  if (!claims) return;
  const id = donorId(req, res);
  if (id == null) return;

  const parsed = adminCancelSubSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid cancel request", details: parsed.error.flatten() });
  }
  if (parsed.data.accepted !== "cancel") {
    return res.status(400).json({ error: "reduce-instead was chosen; reduce the plan via change-plan" });
  }
  try {
    await cancelSubscription(parsed.data.subscriptionId);
    await recordAdminSubscriptionCancellation(id, parsed.data.subscriptionId, actorOf(claims));
    return res.status(200).json({ cancelled: true });
  } catch (err) {
    console.error("admin subscription cancel failed:", err instanceof Error ? err.message : err);
    return res.status(502).json({ error: "Cancellation is temporarily unavailable" });
  }
}

// POST /api/admin/donors/:id/gift-aid/cancel — revoke the donor's active Gift Aid declaration on
// their behalf (reuses adminCancelGiftAid → buildDeclarationCancellation + writeWithAudit). No active
// declaration → 404; a concurrent revoke → 409. Editor/Admin only.
export async function postAdminCancelGiftAid(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "donations", "edit");
  if (!claims) return;
  const id = donorId(req, res);
  if (id == null) return;

  try {
    const result = await adminCancelGiftAid(id, actorOf(claims));
    if (!result.cancelled) {
      return res.status(404).json({ error: "No active Gift Aid declaration to cancel" });
    }
    return res.status(200).json({ cancelled: true, declarationId: result.declarationId });
  } catch (err) {
    if (err instanceof DeclarationCancellationError) {
      return res.status(409).json({ error: "Gift Aid is already cancelled" });
    }
    console.error("admin gift-aid cancel failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Gift Aid cancellation is temporarily unavailable" });
  }
}

adminRouter.get("/api/admin/donors/:id", getAdminDonor);
adminRouter.patch("/api/admin/donors/:id/declaration", patchAdminDeclaration);
adminRouter.patch("/api/admin/donors/:id", patchAdminDonor);
adminRouter.post("/api/admin/donors/:id/subscription/cancel", postAdminCancelSubscription);
adminRouter.post("/api/admin/donors/:id/gift-aid/cancel", postAdminCancelGiftAid);

// --- Admin search (REQ-062 · TASK-108) ----------------------------------------------------------
// Read-only lookups over donors / declarations / donations by a free `?q=` query (name, email, id or
// postcode). Read-only, so any authenticated role (Viewer and up) may call them. A missing/blank `q`
// is a 400; the results are capped in the db layer so an over-broad query stays bounded.
const searchQuerySchema = z.object({ q: z.string().trim().min(1) });

// Pull and validate the `?q=` query string; sends a 400 and returns null when it is missing/blank.
function searchQuery(req: Request, res: Response): string | null {
  const parsed = searchQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "A non-empty search query (?q=) is required" });
    return null;
  }
  return parsed.data.q;
}

export async function getAdminSearchDonors(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "search", "view"))) return;
  const q = searchQuery(req, res);
  if (q == null) return;
  try {
    return res.status(200).json({ results: await searchDonors(q) });
  } catch (err) {
    console.error("admin donor search failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Search is temporarily unavailable" });
  }
}

export async function getAdminSearchDeclarations(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "search", "view"))) return;
  const q = searchQuery(req, res);
  if (q == null) return;
  try {
    return res.status(200).json({ results: await searchDeclarations(q) });
  } catch (err) {
    console.error("admin declaration search failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Search is temporarily unavailable" });
  }
}

export async function getAdminSearchDonations(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "search", "view"))) return;
  const q = searchQuery(req, res);
  if (q == null) return;
  try {
    return res.status(200).json({ results: await searchDonations(q) });
  } catch (err) {
    console.error("admin donation search failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Search is temporarily unavailable" });
  }
}

adminRouter.get("/api/admin/search/donors", getAdminSearchDonors);
adminRouter.get("/api/admin/search/declarations", getAdminSearchDeclarations);
adminRouter.get("/api/admin/search/donations", getAdminSearchDonations);

// --- Admin claim operations (REQ-052/REQ-063 · TASK-109) ----------------------------------------
// POST /api/admin/claim-batches/:id/submit marks a claim batch submitted (a state change → Editor/
// Admin, audited in the same transaction); GET /api/admin/claims/adjustment-due lists the donations
// owing an HMRC adjustment (a read → Viewer and up).

// Parse and validate the claim-batch id in the path; sends a 400 and returns null when it is not a
// positive integer.
function claimBatchId(req: Request, res: Response): number | null {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid claim batch id" });
    return null;
  }
  return id;
}

export async function postAdminSubmitClaimBatch(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "claims", "edit");
  if (!claims) return;
  const id = claimBatchId(req, res);
  if (id == null) return;

  try {
    await submitClaimBatch(id, actorOf(claims));
    return res.status(200).json({ submitted: true, batchId: id });
  } catch (err) {
    if (err instanceof ClaimBatchSubmitError) {
      const status = err.reason === "not_found" ? 404 : 409;
      return res.status(status).json({ error: `Claim batch cannot be submitted: ${err.reason}` });
    }
    console.error("admin claim-batch submit failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Claim batch submit is temporarily unavailable" });
  }
}

export async function getAdminAdjustmentDue(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "claims", "view"))) return;
  try {
    return res.status(200).json({ results: await listAdjustmentDueDonations() });
  } catch (err) {
    console.error("admin adjustment-due list failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin is temporarily unavailable" });
  }
}

adminRouter.post("/api/admin/claim-batches/:id/submit", postAdminSubmitClaimBatch);
adminRouter.get("/api/admin/claims/adjustment-due", getAdminAdjustmentDue);

// POST /api/admin/claim-batches (REQ-052/REQ-062): open a new claim batch. A state change → Editor/
// Admin, audited (claim_batch.created). Returns the new batch id.
const createBatchBodySchema = z.object({ hmrcReference: z.string().min(1).optional() });

export async function postAdminCreateClaimBatch(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "claims", "edit");
  if (!claims) return;
  const parsed = createBatchBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Invalid claim batch request" });
  try {
    const { batchId } = await createClaimBatch(actorOf(claims), parsed.data.hmrcReference);
    return res.status(201).json({ batchId });
  } catch (err) {
    console.error("admin create claim-batch failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Claim batch create is temporarily unavailable" });
  }
}

// GET /api/admin/claims/eligible (REQ-052): the eligible-unbatched donations ready to be claimed
// (the "ready to claim" picker). A read → Viewer and up.
export async function getAdminEligibleForClaim(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "claims", "view"))) return;
  try {
    return res.status(200).json({ results: await listEligibleForClaim() });
  } catch (err) {
    console.error("admin eligible-for-claim list failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin is temporarily unavailable" });
  }
}

// POST /api/admin/claim-batches/:id/donations (REQ-052/REQ-062): assign one or many eligible
// donations to a batch. A state change → Editor/Admin. Each id is applied via the audited
// assignDonationToBatch (which enforces the claim invariant + one-batch guard); the outcomes are
// aggregated so a partial failure (already batched / not eligible) is reported, not silently dropped.
const assignBodySchema = z.object({ donationIds: z.array(z.number().int().positive()).min(1) });

export async function postAdminAssignBatchDonations(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "claims", "edit");
  if (!claims) return;
  const id = claimBatchId(req, res);
  if (id == null) return;
  const parsed = assignBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Invalid assignment request" });
  const assigned: number[] = [];
  const failed: { id: number; reason: string }[] = [];
  for (const donationId of parsed.data.donationIds) {
    try {
      await assignDonationToBatch(donationId, id, actorOf(claims));
      assigned.push(donationId);
    } catch (err) {
      if (err instanceof BatchAssignmentError) {
        failed.push({ id: donationId, reason: err.reason });
      } else {
        console.error("admin assign donation to batch failed:", err instanceof Error ? err.message : err);
        failed.push({ id: donationId, reason: "error" });
      }
    }
  }
  return res.status(200).json({ assigned, failed });
}

adminRouter.post("/api/admin/claim-batches", postAdminCreateClaimBatch);
adminRouter.get("/api/admin/claims/eligible", getAdminEligibleForClaim);
adminRouter.post("/api/admin/claim-batches/:id/donations", postAdminAssignBatchDonations);

// --- Admin retention + awaiting-declaration queues (REQ-046/REQ-049 · TASK-110) -----------------
// Two read-only admin queues (Viewer and up): declarations whose HMRC six-year retention window is
// expired/expiring, and donations whose in-person Gift Aid confirmation was sent but not completed.

export async function getAdminRetentionExpiry(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "claims", "view"))) return;
  try {
    return res.status(200).json({ results: await listRetentionExpiryDeclarations() });
  } catch (err) {
    console.error("admin retention-expiry queue failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin is temporarily unavailable" });
  }
}

export async function getAdminAwaitingDeclaration(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "claims", "view"))) return;
  try {
    return res.status(200).json({ results: await listAwaitingDeclarationDonations() });
  } catch (err) {
    console.error("admin awaiting-declaration queue failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin is temporarily unavailable" });
  }
}

// GASDS 2-year claim-deadline queue (TASK-135): small donations approaching or past the GASDS
// claim cliff (2 years after the tax-year-end of collection — shorter than Gift Aid's 4 years).
export async function getAdminGasdsDeadline(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "gasds", "view"))) return;
  try {
    return res.status(200).json({ results: await listGasdsDeadlineDonations() });
  } catch (err) {
    console.error("admin gasds-deadline queue failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin is temporarily unavailable" });
  }
}

adminRouter.get("/api/admin/queues/retention-expiry", getAdminRetentionExpiry);
adminRouter.get("/api/admin/queues/awaiting-declaration", getAdminAwaitingDeclaration);
// Declaration-review-due queue (TASK-136): active enduring/monthly declarations HMRC recommends
// re-confirming (made over ~2 years ago). Read-only, Viewer+.
export async function getAdminDeclarationReview(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "claims", "view"))) return;
  try {
    return res.status(200).json({ results: await listDeclarationsDueReview() });
  } catch (err) {
    console.error("admin declaration-review queue failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin is temporarily unavailable" });
  }
}

// Mark GASDS small gifts as claimed (TASK-138) — Editor+. Stamps gasds_claimed_at so the deadline
// queue stops surfacing them. Body: { donationIds: number[] }.
const gasdsMarkSchema = z.object({
  donationIds: z.array(z.number().int().positive()).min(1),
});

export async function postAdminMarkGasdsClaimed(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "gasds", "edit");
  if (!claims) return;
  const parsed = gasdsMarkSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid GASDS mark request", details: parsed.error.flatten() });
  }
  try {
    const result = await markGasdsClaimed(parsed.data.donationIds, actorOf(claims));
    return res.status(200).json({ claimed: result.claimedIds.length, claimedIds: result.claimedIds });
  } catch (err) {
    console.error("admin gasds mark-claimed failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin update is temporarily unavailable" });
  }
}

// GET /api/admin/queues/gasds-pool?year= — the annual GASDS small-donations pool report (REQ-050):
// the pool total, the SEPARATELY-read claimed Gift Aid total, and the remaining headroom (the binding
// of the three GASDS caps). Read-only, Viewer+. Defaults to the current calendar year when ?year is
// absent or not a positive integer. Surfaces the getGasdsPoolReport logic that had no route until now.
export async function getAdminGasdsPool(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "gasds", "view"))) return;
  try {
    const yearNum = Number(req.query.year);
    const year = Number.isInteger(yearNum) && yearNum > 0 ? yearNum : new Date().getFullYear();
    return res.status(200).json(await getGasdsPoolReport(year));
  } catch (err) {
    console.error("admin gasds-pool report failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin is temporarily unavailable" });
  }
}

adminRouter.get("/api/admin/queues/gasds-deadline", getAdminGasdsDeadline);
adminRouter.post("/api/admin/queues/gasds-deadline/mark-claimed", postAdminMarkGasdsClaimed);
adminRouter.get("/api/admin/queues/gasds-pool", getAdminGasdsPool);
adminRouter.get("/api/admin/queues/declaration-review", getAdminDeclarationReview);

// --- Thank-you letters: eligible-donors list (REQ-069 · TASK-162) --------------------------------
// Donors whose largest single PAID gift is >= the threshold (pence; ?threshold, default £1,000),
// most generous first, each tagged with whether they can be emailed (sendState) and whether they
// have been thanked. Read-only, Viewer+.
export async function getThankYouEligible(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "thank-you", "view"))) return;
  try {
    const thresholdNum = Number(req.query.threshold);
    const thresholdPence =
      Number.isInteger(thresholdNum) && thresholdNum > 0 ? thresholdNum : DEFAULT_THANK_YOU_THRESHOLD_PENCE;
    return res.status(200).json({ thresholdPence, results: await listThankYouEligible(thresholdPence) });
  } catch (err) {
    console.error("admin thank-you eligible list failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin is temporarily unavailable" });
  }
}

adminRouter.get("/api/admin/thank-you/eligible", getThankYouEligible);

// POST /api/admin/thank-you/send (REQ-069 · TASK-163). The compose form in the admin "Thank you"
// view posts the letter fields here. `sentBy` is taken from the authed admin (never trusted from the
// client), then the whole shape is validated by the shared thankYouInputSchema. We record the row +
// its audit entry atomically (recordThankYouSent), then BEST-EFFORT email the donor the branded
// letter — a failed send is logged, not fatal, so the letter is still recorded and the donor marked
// thanked. `signedByRole` and `letterDate` are presentation-only (not stored): the role is the
// signer's title on the letter, the date defaults to today. Editor+ (a send is an outbound write).
export async function postAdminThankYouSend(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "thank-you", "edit");
  if (!claims) return;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const parsed = thankYouInputSchema.safeParse({ ...body, sentBy: claims.email });
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid thank-you", details: parsed.error.flatten() });
  }
  const input = parsed.data;
  // signedByRole is stored via the schema (input.signedByRole); letterDate is presentation-only
  // (defaults to today) and not stored — the print page uses the row's sent_at instead.
  const letterDate =
    typeof body.letterDate === "string" && body.letterDate.trim()
      ? body.letterDate.trim()
      : new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  // Optional CC on the email (TASK-168), send-time only (not stored). Validated as an email when set.
  const ccRaw = typeof body.ccEmail === "string" ? body.ccEmail.trim() : "";
  if (ccRaw && !z.string().email().safeParse(ccRaw).success) {
    return res.status(400).json({ error: "Invalid CC email address" });
  }
  const cc = ccRaw || undefined;
  try {
    const id = await recordThankYouSent(input);
    try {
      // A tokenised link to the public print-your-letter page (the donor prints/saves a PDF there —
      // a link, not an attachment, so deliverability stays clean).
      const printUrl = `${config.PORTAL_BASE_URL}/thank-you/letter/${signThankYouLetterToken(id, config.ADMIN_SESSION_SECRET)}`;
      const view = {
        thankYouName: input.thankYouName,
        addressedTo: input.addressedTo,
        giftType: input.giftType,
        giftAmountPence: input.giftAmountPence,
        giftInKind: input.giftInKind,
        giftAided: input.giftAided,
        personalMessage: input.personalMessage,
        signedByName: input.signedByName,
        signedByRole: input.signedByRole ?? null,
        letterDate,
        printUrl,
      };
      await sendThankYou({
        email: input.recipientEmail,
        cc,
        from: config.GIVING_FROM_EMAIL,
        replyTo: config.GIVING_FROM_EMAIL,
        subject: thankYouSubject(input),
        html: buildThankYouEmailHtml(view),
        text: buildThankYouEmailText(view),
      });
    } catch (err) {
      // Best-effort: the row is recorded and the donor is marked thanked regardless of the send.
      console.error(`thank-you email to ${input.recipientEmail} failed`, err);
    }
    return res.status(201).json({ id, giftSummary: giftSummary(input) });
  } catch (err) {
    console.error("admin thank-you send failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin is temporarily unavailable" });
  }
}

adminRouter.post("/api/admin/thank-you/send", postAdminThankYouSend);

// GET /api/admin/thank-you/sent?limit&offset (REQ-069 · TASK-163). The sent-letter history, most
// recent first (paginated), backing the "Sent history" table in the admin "Thank you" view. Paging is
// clamped to a safe window (clampPage). Read-only, Viewer+.
export async function getAdminThankYouSent(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "thank-you", "view"))) return;
  try {
    const raw = pageArgs(req);
    const { limit, offset } = clampPage(raw.limit, raw.offset);
    const { results, total } = await listThankYouSent(limit, offset);
    // Attach each letter's public print URL (TASK-165) so staff can re-open/print any sent letter.
    const withPrint = results.map((r) => ({
      ...r,
      printUrl: `${config.PORTAL_BASE_URL}/thank-you/letter/${signThankYouLetterToken(r.id, config.ADMIN_SESSION_SECRET)}`,
    }));
    return res.status(200).json({ results: withPrint, total });
  } catch (err) {
    console.error("admin thank-you sent list failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin is temporarily unavailable" });
  }
}

adminRouter.get("/api/admin/thank-you/sent", getAdminThankYouSent);

// DELETE /api/admin/thank-you/sent/:id (REQ-069 · TASK-168). Remove a sent-letter history row (e.g. a
// mistaken send) and audit the deletion. Editor+ (a write); the append-only audit_log keeps both the
// original `thank_you.sent` and the new `thank_you.deleted` entry, so the governance trail is intact.
export async function deleteAdminThankYouSent(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "thank-you", "edit");
  if (!claims) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: "Invalid id" });
  }
  try {
    const deleted = await deleteThankYouSent(id, actorOf(claims));
    if (!deleted) return res.status(404).json({ error: "Thank-you letter not found" });
    return res.status(200).json({ deleted: true });
  } catch (err) {
    console.error("admin thank-you delete failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin is temporarily unavailable" });
  }
}

adminRouter.delete("/api/admin/thank-you/sent/:id", deleteAdminThankYouSent);

// --- Supporter ticker (REQ-003 · TASK-178) ------------------------------------------------------
// Admin-curated list of ongoing supporters shown in the site's scrolling ticker. Reads are Viewer+;
// writes (add/edit/delete) are Editor+ and audited. Parse the :id path param to a positive int.
function supporterId(req: Request, res: Response): number | null {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid supporter id" });
    return null;
  }
  return id;
}

// GET /api/admin/ticker — every supporter (active + hidden), display order. Viewer+.
export async function getAdminTicker(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "ticker", "view"))) return;
  try {
    return res.status(200).json({ results: await listSupporters() });
  } catch (err) {
    console.error("admin ticker list failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin is temporarily unavailable" });
  }
}

// POST /api/admin/ticker — add a supporter. Editor+.
export async function postAdminTicker(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "ticker", "edit");
  if (!claims) return;
  const parsed = supporterCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid supporter", details: parsed.error.flatten() });
  }
  try {
    const id = await createSupporter(parsed.data, actorOf(claims));
    return res.status(201).json({ id });
  } catch (err) {
    console.error("admin ticker create failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin is temporarily unavailable" });
  }
}

// PATCH /api/admin/ticker/:id — edit a supporter's name/active/sortOrder. Editor+.
export async function patchAdminTicker(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "ticker", "edit");
  if (!claims) return;
  const id = supporterId(req, res);
  if (id === null) return;
  const parsed = supporterUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid update", details: parsed.error.flatten() });
  }
  try {
    const updated = await updateSupporter(id, parsed.data, actorOf(claims));
    if (!updated) return res.status(404).json({ error: "Supporter not found" });
    return res.status(200).json({ updated: true });
  } catch (err) {
    console.error("admin ticker update failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin is temporarily unavailable" });
  }
}

// DELETE /api/admin/ticker/:id — remove a supporter. Editor+.
export async function deleteAdminTicker(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "ticker", "edit");
  if (!claims) return;
  const id = supporterId(req, res);
  if (id === null) return;
  try {
    const deleted = await deleteSupporter(id, actorOf(claims));
    if (!deleted) return res.status(404).json({ error: "Supporter not found" });
    return res.status(200).json({ deleted: true });
  } catch (err) {
    console.error("admin ticker delete failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin is temporarily unavailable" });
  }
}

adminRouter.get("/api/admin/ticker", getAdminTicker);
adminRouter.post("/api/admin/ticker", postAdminTicker);
adminRouter.patch("/api/admin/ticker/:id", patchAdminTicker);
adminRouter.delete("/api/admin/ticker/:id", deleteAdminTicker);

// --- Admin dashboard read lists (REQ-066 · TASK-114) --------------------------------------------
// Read-only lists that back the admin cockpit UI. Browsing/reads are Viewer and up; the Charities
// Online CSV export is a claims operation, gated to Editor/Admin like the batch-submit endpoint.

// Parse the optional ?limit / ?offset paging query into integers (or undefined); the db layer
// clamps them to a safe window (clampPage).
function pageArgs(req: Request): { limit?: number; offset?: number } {
  const limit = Number(req.query.limit);
  const offset = Number(req.query.offset);
  return {
    limit: Number.isInteger(limit) ? limit : undefined,
    offset: Number.isInteger(offset) ? offset : undefined,
  };
}

// GET /api/admin/donations?limit&offset&status&channel — browse all donations. Viewer and up.
export async function getAdminDonations(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "donations", "view"))) return;
  try {
    const { limit, offset } = pageArgs(req);
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const channel = typeof req.query.channel === "string" ? req.query.channel : undefined;
    return res.status(200).json(await listDonations({ limit, offset, status, channel }));
  } catch (err) {
    console.error("admin donations list failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin is temporarily unavailable" });
  }
}

// GET /api/admin/claim-batches — list claim batches with counts/totals. Viewer and up.
export async function getAdminClaimBatches(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "claims", "view"))) return;
  try {
    return res.status(200).json({ results: await listClaimBatches() });
  } catch (err) {
    console.error("admin claim-batches list failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin is temporarily unavailable" });
  }
}

// GET /api/admin/claim-batches/:id/export — the batch's Charities Online CSV (REQ-052). A claims
// operation, so Editor/Admin only (mirrors submit). Reuses the existing eligible-donations query +
// the pure CSV serializer; returns text/csv as a download.
export async function getAdminClaimBatchExport(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "claims", "edit"))) return;
  const id = claimBatchId(req, res);
  if (id == null) return;
  try {
    const rows = await listClaimableDonationsForExport(id);
    const csv = toCharitiesOnlineCsv(
      rows.map((r) => ({ donation: r.donation, declaration: r.declaration })),
    );
    res
      .status(200)
      .type("text/csv")
      .set("Content-Disposition", `attachment; filename="claim-batch-${id}.csv"`)
      .send(csv);
    return;
  } catch (err) {
    console.error("admin claim-batch export failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Export is temporarily unavailable" });
  }
}

// GET /api/admin/audit?limit&offset&entity&entityId — the append-only governance trail. Viewer+.
export async function getAdminAuditLog(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "audit", "view"))) return;
  try {
    const { limit, offset } = pageArgs(req);
    const entity = typeof req.query.entity === "string" ? req.query.entity : undefined;
    const entityIdNum = Number(req.query.entityId);
    const entityId = Number.isInteger(entityIdNum) ? entityIdNum : undefined;
    return res.status(200).json(await listAuditLog({ limit, offset, entity, entityId }));
  } catch (err) {
    console.error("admin audit list failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin is temporarily unavailable" });
  }
}

// GET /api/admin/subscriptions/dunning?status — at-risk / lapsed monthly gifts. Viewer and up.
export async function getAdminDunning(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "subscriptions", "view"))) return;
  try {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    return res.status(200).json({ results: await listDunning(status) });
  } catch (err) {
    console.error("admin dunning list failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin is temporarily unavailable" });
  }
}

adminRouter.get("/api/admin/donations", getAdminDonations);
adminRouter.get("/api/admin/claim-batches", getAdminClaimBatches);
adminRouter.get("/api/admin/claim-batches/:id/export", getAdminClaimBatchExport);
adminRouter.get("/api/admin/audit", getAdminAuditLog);
adminRouter.get("/api/admin/subscriptions/dunning", getAdminDunning);

// --- Admin Stories (Task C): list/view/manage My Story submissions -------------------------------
// Reads/writes go to the SEPARATE stories DB only (src/db/stories, storiesPool) — never
// src/db/pool.ts / the charity DB, and never audited via audit_log (that table lives in the
// charity DB; see src/db/stories.ts's comment). Browsing is Viewer+; changing status/tags/notes
// is an Editor+ write (mirrors patchAdminDonor).

// Parse and validate the story id in the path; sends a 400 and returns null when it is not a
// positive integer (mirrors donorId/claimBatchId).
function storyId(req: Request, res: Response): number | null {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid story id" });
    return null;
  }
  return id;
}

// GET /api/admin/stories?status=&use_scope= — newest-first, optionally filtered. Viewer+. The list
// projection is already PII-minimised by listStories (no story_text, no email/phone).
export async function getAdminStories(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "stories", "view"))) return;
  try {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const useScope = typeof req.query.use_scope === "string" ? req.query.use_scope : undefined;
    return res.status(200).json({ results: await listStories({ status, useScope }) });
  } catch (err) {
    console.error("admin stories list failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin is temporarily unavailable" });
  }
}

// GET /api/admin/stories/:id — the full record for the detail view. Viewer+.
export async function getAdminStory(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "stories", "view"))) return;
  const id = storyId(req, res);
  if (id == null) return;
  try {
    const story = await getStory(id);
    if (!story) return res.status(404).json({ error: "Story not found" });
    return res.status(200).json(story);
  } catch (err) {
    console.error("admin story read failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin is temporarily unavailable" });
  }
}

// The story statuses recognised by the workflow (mirrors migrations-stories's `status` comment):
// new -> reviewed -> used, or withdrawn at any point (e.g. the submitter asks to withdraw consent).
const STORY_STATUSES = ["new", "reviewed", "used", "withdrawn"] as const;

// PATCH body: status / admin_tags / admin_notes, all optional but at least one required (mirrors
// adminPatchSchema's "no fields to update" refine).
// adminNotes/adminTags are capped (2000 chars / 50 tags of up to 100 chars each) so a
// staff PATCH can never smuggle an unbounded payload into the stories DB — mirrors the
// story submission schema's own length caps (src/stories/schema.ts).
const storyPatchSchema = z
  .object({
    status: z.enum(STORY_STATUSES).optional(),
    adminTags: z.array(z.string().max(100)).max(50).optional(),
    adminNotes: z.string().max(2000).optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: "no fields to update" });

// PATCH /api/admin/stories/:id — update status / admin_tags / admin_notes (e.g. Withdraw). Editor/
// Admin only (mirrors patchAdminDonor). No audit_log row — see src/db/stories.ts's comment.
export async function patchAdminStory(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "stories", "edit"))) return;
  const id = storyId(req, res);
  if (id == null) return;

  const parsed = storyPatchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid story update", details: parsed.error.flatten() });
  }
  try {
    const story = await updateStory(id, parsed.data);
    if (!story) return res.status(404).json({ error: "Story not found" });
    return res.status(200).json(story);
  } catch (err) {
    console.error("admin story update failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin update is temporarily unavailable" });
  }
}

// DELETE /api/admin/stories/:id — G2 item 6: real hard-delete (erasure). Distinct from the
// PATCH status='withdrawn' path above, which only STOPS a story being used but keeps the
// row for the permanent archive: this permanently removes the row and everything it holds,
// for a submitter's actual right-to-erasure request. Editor/Admin only (mirrors patchAdminStory).
// No audit_log row (see src/db/stories.ts's comment — this feature is deliberately
// self-contained, and an erasure request should not itself retain the erased data anywhere).
export async function deleteAdminStory(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "stories", "edit"))) return;
  const id = storyId(req, res);
  if (id == null) return;
  try {
    const deleted = await deleteStory(id);
    if (!deleted) return res.status(404).json({ error: "Story not found" });
    return res.status(200).json({ deleted: true, id });
  } catch (err) {
    console.error("admin story delete failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin delete is temporarily unavailable" });
  }
}

adminRouter.get("/api/admin/stories", getAdminStories);
adminRouter.get("/api/admin/stories/:id", getAdminStory);
adminRouter.patch("/api/admin/stories/:id", patchAdminStory);
adminRouter.delete("/api/admin/stories/:id", deleteAdminStory);

// --- Admin Contact inbox (2026-07-10 spec): list/view/reply-status/delete contact enquiries -------
// Reads/writes go to the SEPARATE contact DB only (src/db/contact, contactPool) — never
// src/db/pool.ts / the charity DB, never the stories DB, never audit_log. Browsing is Viewer+;
// marking replied / deleting is an Editor+ write (mirrors the stories routes).

function contactId(req: Request, res: Response): number | null {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid enquiry id" });
    return null;
  }
  return id;
}

export async function getAdminContact(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "contact", "view"))) return;
  try {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    return res.status(200).json({ results: await listEnquiries(status) });
  } catch (err) {
    console.error("admin contact list failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin is temporarily unavailable" });
  }
}

export async function getAdminContactItem(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "contact", "view"))) return;
  const id = contactId(req, res);
  if (id == null) return;
  try {
    const row = await getEnquiry(id);
    if (!row) return res.status(404).json({ error: "Enquiry not found" });
    return res.status(200).json(row);
  } catch (err) {
    console.error("admin contact read failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin is temporarily unavailable" });
  }
}

const contactPatchSchema = z.object({ status: z.enum(["new", "replied"]) }).strict();

export async function patchAdminContact(req: Request, res: Response): Promise<Response | void> {
  // Capture the claims (not just the boolean gate) so we can record WHO marked it replied —
  // mirrors how patchAdminDonor uses claims for the audit actor. authorizeSection returns the
  // claims (with .email) on success, or null after sending the 401/403.
  const claims = await authorizeSection(req, res, "contact", "edit");
  if (!claims) return;
  const id = contactId(req, res);
  if (id == null) return;
  const parsed = contactPatchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid enquiry update", details: parsed.error.flatten() });
  }
  const replied = parsed.data.status === "replied";
  try {
    const row = await markReplied(id, replied, replied ? claims.email : null);
    if (!row) return res.status(404).json({ error: "Enquiry not found" });
    return res.status(200).json(row);
  } catch (err) {
    console.error("admin contact update failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin update is temporarily unavailable" });
  }
}

export async function deleteAdminContact(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "contact", "edit"))) return;
  const id = contactId(req, res);
  if (id == null) return;
  try {
    const deleted = await deleteEnquiry(id);
    if (!deleted) return res.status(404).json({ error: "Enquiry not found" });
    return res.status(200).json({ deleted: true, id });
  } catch (err) {
    console.error("admin contact delete failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin delete is temporarily unavailable" });
  }
}

adminRouter.get("/api/admin/contact", getAdminContact);
adminRouter.get("/api/admin/contact/:id", getAdminContactItem);
adminRouter.patch("/api/admin/contact/:id", patchAdminContact);
adminRouter.delete("/api/admin/contact/:id", deleteAdminContact);

// --- Admin newsletter (REQ-069 · TASK-161) -------------------------------------------------------
adminRouter.get("/api/admin/newsletters", getAdminNewsletters);
adminRouter.post("/api/admin/newsletters/preview", postAdminNewsletterPreview);
// The literal paths below must precede /:id so they aren't captured as an :id param.
adminRouter.get("/api/admin/newsletters/recipients", getAdminNewsletterRecipients);
adminRouter.post("/api/admin/newsletters/test-send", postAdminNewsletterTestSend);
adminRouter.get("/api/admin/newsletters/subscribers.csv", getAdminNewsletterSubscribersCsv);
adminRouter.get("/api/admin/newsletters/subscribers", getAdminNewsletterSubscribers);
adminRouter.post("/api/admin/newsletters/subscribers", postAdminNewsletterSubscriber);
adminRouter.post("/api/admin/newsletters/subscribers/remove", postAdminRemoveNewsletterSubscriber);
adminRouter.get("/api/admin/newsletters/:id", getAdminNewsletter);
adminRouter.post("/api/admin/newsletters", postAdminNewsletter);
adminRouter.put("/api/admin/newsletters/:id", putAdminNewsletter);
adminRouter.post("/api/admin/newsletters/:id/send", postAdminSendNewsletter);
adminRouter.get("/api/admin/newsletters/:id/attachments", getAdminNewsletterAttachments);
adminRouter.post("/api/admin/newsletters/:id/attachments", postAdminNewsletterAttachment);
adminRouter.delete("/api/admin/newsletters/:id/attachments/:attId", deleteAdminNewsletterAttachment);

// POST /api/admin/newsletter-images — upload one image for use in a newsletter block (Editor+).
// Body { mime, dataBase64 }. Validates mime allow-list + 2 MB cap, stores the bytes, returns the
// public serve URL. See src/routes/newsletter-images.ts for the GET side.
export async function postAdminNewsletterImage(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "newsletter", "edit");
  if (!claims) return;
  const parsed = z
    .object({ mime: z.string().min(1), dataBase64: z.string().min(1), filename: z.string().optional() })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid upload" });

  const bytes = Buffer.from(parsed.data.dataBase64, "base64");
  const check = validateUpload(parsed.data.mime, bytes.length);
  if (!check.ok) {
    const status = check.reason === "size" ? 413 : 400;
    return res
      .status(status)
      .json({ error: check.reason === "size" ? "Image too large (2 MB max)" : "Unsupported image type" });
  }
  const { id } = await insertNewsletterImage(parsed.data.mime, bytes, claims.sub);
  return res.status(201).json({ id, url: `${config.PORTAL_BASE_URL}/media/newsletter/${id}` });
}

adminRouter.post("/api/admin/newsletter-images", postAdminNewsletterImage);

// --- Business-supporter fulfilment (TASK-207) ---------------------------------------------------
// The admin API behind the business-supporter fulfilment workflow: list every business supporter's
// fulfilment record, and mark one fulfilment status flag done. Both are Editor+ (donations:edit) —
// the read is gated at the same Editor-and-up level the newsletter tab uses (an operational staff
// tool that exposes business PII + fulfilment state, not a Viewer read), and the mark is a write.
// The mark is audited + transactional (markFulfilmentFlag → writeWithAudit) and only ever writes one
// of the five allow-listed flags. Reads/writes go to the charity DB's business_supporter_fulfilment
// table (src/db/fulfilment.ts). Building the admin UI on top of this is a later task.

// Parse and validate the fulfilment-record id in the path; sends a 400 and returns null when it is
// not a positive integer (mirrors donorId / claimBatchId).
function fulfilmentId(req: Request, res: Response): number | null {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid fulfilment id" });
    return null;
  }
  return id;
}

// GET /api/admin/fulfilments — list every business-supporter fulfilment record (joined to its donor),
// most recent first. Editor+ (donations:edit).
export async function getAdminFulfilments(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "donations", "edit"))) return;
  try {
    return res.status(200).json({ results: await listBusinessFulfilments() });
  } catch (err) {
    console.error("admin fulfilments list failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin is temporarily unavailable" });
  }
}

// The mark body: exactly one of the five allow-listed flags (z.enum rejects anything else with a
// clean 400; markFulfilmentFlag re-checks the same allowlist as defence in depth).
const fulfilmentMarkSchema = z.object({ flag: z.enum(FULFILMENT_FLAGS) });

// POST /api/admin/fulfilments/:id/mark — set one fulfilment status flag true. Editor+ (donations:edit).
// Audited + transactional. An unknown flag → 400; an unknown record id → 404. Returns the updated record.
export async function postAdminMarkFulfilment(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "donations", "edit");
  if (!claims) return;
  const id = fulfilmentId(req, res);
  if (id == null) return;
  const parsed = fulfilmentMarkSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid fulfilment flag", details: parsed.error.flatten() });
  }
  try {
    const result = await markFulfilmentFlag(id, parsed.data.flag, actorOf(claims));
    return res.status(200).json({ id: result.id, flag: result.flag, value: result.value, record: result.record });
  } catch (err) {
    if (err instanceof FulfilmentFlagError) {
      // invalid_flag is already screened by the schema above; not_found → 404, any other → 400.
      return err.reason === "not_found"
        ? res.status(404).json({ error: "Fulfilment record not found" })
        : res.status(400).json({ error: "Invalid fulfilment flag" });
    }
    console.error("admin fulfilment mark failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin update is temporarily unavailable" });
  }
}

adminRouter.get("/api/admin/fulfilments", getAdminFulfilments);
adminRouter.post("/api/admin/fulfilments/:id/mark", postAdminMarkFulfilment);

// POST /api/admin/business-supporters/backfill-invites (TASK-214) — the one-time, idempotent catch-up
// that emails the thank-you INVITE to business supporters who became supporters BEFORE the going-
// forward webhook auto-invite (TASK-213) shipped and so never received it. Editor+ (donations:edit),
// same gate as the rest of the business-supporter tab. Safe to click more than once: it emails only
// records with invited_at IS NULL AND captured_at IS NULL, and stamps invited_at after each successful
// send, so a second run (or a double-click) sends 0. Every send is best-effort — one failure is
// counted and never aborts the rest — and the run appends one `fulfilment.backfill_invites` audit row.
// Returns the counts { pending, sent, failed }.
export async function postAdminBackfillBusinessInvites(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "donations", "edit");
  if (!claims) return;
  try {
    const result = await runBusinessInviteBackfill({
      listUninvited: listUninvitedBusinessSupporters,
      sendInvite: sendBusinessSupporterInvite,
      markInvited: markFulfilmentInvited,
      recordAudit,
      baseUrl: config.PORTAL_BASE_URL,
      from: config.GIVING_FROM_EMAIL,
      actor: actorOf(claims),
    });
    return res.status(200).json(result);
  } catch (err) {
    console.error("admin business-supporter invite backfill failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin is temporarily unavailable" });
  }
}

adminRouter.post("/api/admin/business-supporters/backfill-invites", postAdminBackfillBusinessInvites);
