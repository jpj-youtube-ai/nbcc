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
import { readStoriesDiagnostics } from "../db/stories-diagnostics";
import { ballSettingsUpdateSchema } from "../ball/settings";
import { hashPassword } from "../admin/password";
import { bookingsCsv, cateringCsv, doorListCsv } from "../ball/exports";
import { buildBallReminderEmail } from "../ball/reminder-email";
import { sendBallReminder } from "../clients/email";
import { availability } from "../ball/capacity";
import { holdCreateSchema, seatsForHold } from "../ball/holds";
import { isGateOpen } from "../ball/gate";
import {
  getCapacityState,
  getDashboard,
  getSettings as getBallSettings,
  cancelBooking,
  createHold,
  listActiveHolds,
  releaseHold,
  listBookings,
  listBookingsForExport,
  listBookingsNeedingReminder,
  listGuestsForExport,
  listWaitingList,
  markReminderSent,
  purgeExpiredGuests,
  updateSettings as updateBallSettings,
  listGuestProgress,
  listAbandonedBookings,
} from "../db/ball";
import {
  summariseGuestProgress,
  outstandingBookings,
  guestLinkFor,
} from "../ball/guest-progress";
import { archiveStory, restoreStory } from "../db/stories";
import { recordErasure, listErasures } from "../db/erasure-log";
import { listEmailLog, listRecentEmailFailures } from "../db/email-log";
import {
  listKnownBusinesses,
  createOutreach,
  listOutreach,
  getOutreach,
  markOutreachSent,
  linkOutreachDonor,
  listOutreachForReports,
  listBusinessDonors,
  markCtpsChecked,
  listOutreachForTodo,
  listVolunteers,
  setOutreachOutcome,
  addOutreachNote,
  listOutreachNotes,
} from "../db/outreach";
import { buildOutreachEmail } from "../outreach/invitation-email";
import { sendOutreachInvitation } from "../clients/email";
import { findMatches, isDoNotContact } from "../outreach/matching";
import { emailBlockReason } from "../outreach/lawful-basis";
import { isOutcome, wantsAskAgainDate } from "../outreach/outcomes";
import { whatIsNeeded, sortTodos } from "../outreach/todo";
import { buildDisclosure } from "../outreach/disclosure";
import {
  buildFunnel,
  buildMoneyRaised,
  buildByVolunteer,
  buildPersonalMessageEffect,
} from "../outreach/reports";
import { similarity, normaliseBusinessName } from "../outreach/matching";
import { outreachCreateSchema } from "../outreach/model";
import { parseArchiveView } from "../admin/archive-filter";
import { listEnquiries, getEnquiry, markReplied, deleteEnquiry, archiveEnquiry, restoreEnquiry } from "../db/contact";
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
  deleteDraftNewsletter,
  listRecipientsForList,
  listRecipientsForLists,
  setNewsletterLists,
} from "../db/newsletters";
import {
  templateNameSchema,
  listNewsletterTemplates,
  getNewsletterTemplate,
  createNewsletterTemplate,
  deleteNewsletterTemplate,
  DuplicateTemplateNameError,
} from "../db/newsletter-templates";
import { renderNewsletter, newsletterDocSchema } from "../newsletter/blocks";
// TASK-254: the subject's own merge. NOT applyMerge — a subject is plain text, not HTML.
import { mergeSubject, newsletterSender } from "../newsletter/theme";
import { validateUpload, insertNewsletterImage } from "../db/newsletter-images";
import {
  validateAttachment,
  insertNewsletterAttachment,
  listNewsletterAttachments,
  deleteNewsletterAttachment,
} from "../db/newsletter-attachments";
import {
  listSubscriberLists,
  createSubscriberList,
  getSubscriberList,
  getSubscriberListBySlug,
  addListSubscriber,
  listListMembers,
  removeListMember,
  getMembershipStates,
  DuplicateListError,
  listArchivedSubscriberLists,
  archiveSubscriberList,
  restoreSubscriberList,
  BuiltInListError,
  setListVisibility,
  type SubscriberListRef,
} from "../db/subscriber-lists";
import { listSuppressions, unsuppressEmail } from "../db/email-suppressions";
import {
  createSendJob,
  getJobForNewsletter,
  setJobStatus,
  listJobRecipients,
  listInflightJobs,
} from "../db/newsletter-send-jobs";
import { pacingSummary, DEFAULT_PER_MINUTE } from "../newsletter/send-pacing";
import { parseScheduleAt, scheduleSummary } from "../newsletter/schedule";
import { htmlToPlainText } from "../newsletter/plain-text";
import { preflightNewsletter } from "../newsletter/preflight";
import { recipientOutcome, OUTCOME_LABELS } from "../newsletter/recipient-outcome";
import { runSendTick } from "../newsletter/send-worker";
import { parseImportFile } from "../newsletter/import-parse";
import { parseTargetListIds, foldOutcomes, type TargetOutcome } from "../newsletter/audience-targets";
import { getNewsletterStats } from "../db/newsletter-events";
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


// The sample donor the live preview and the test send both personalise as (TASK-254). One constant,
// because those two exist to show the SAME thing — what a donor will actually receive — and a second
// copy would drift the moment someone changed one of them.
const PREVIEW_FIRST_NAME = "Jane";

// --- Saved newsletter templates (TASK-249) -------------------------------------------------------
// A SHARED library: any Editor can save the newsletter they are building as a reusable template, and
// any Editor can start from one. Mounted on its OWN /api/admin/newsletter-templates path rather than
// under /newsletters/… on purpose — /api/admin/newsletters/:id would capture a literal "templates"
// segment as an id (the hazard the route table already warns about).
function templateId(req: Request, res: Response): number | null {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid template id" });
    return null;
  }
  return id;
}

// GET /api/admin/newsletter-templates — the library (Editor+, matching the rest of the tab).
export async function getAdminNewsletterTemplates(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "newsletter", "view"))) return;
  return res.json(await listNewsletterTemplates());
}

// GET /api/admin/newsletter-templates/:id — one template, including its block document (Editor+).
export async function getAdminNewsletterTemplate(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "newsletter", "view"))) return;
  const id = templateId(req, res);
  if (id === null) return;
  const row = await getNewsletterTemplate(id);
  if (!row) return res.status(404).json({ error: "Template not found" });
  return res.json(row);
}

// POST /api/admin/newsletter-templates — save a block document as a reusable template (Editor+).
// The document is parsed with newsletterDocSchema, the SAME schema the newsletter itself is saved
// through: a template that cannot render is worse than no template, because the team only finds out
// when they start next month's newsletter from it. Parsing also normalises it (defaults applied), so
// what is stored is a document the renderer already accepts.
export async function postAdminNewsletterTemplate(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "newsletter", "edit");
  if (!claims) return;
  const parsed = z
    .object({ name: templateNameSchema, bodyJson: newsletterDocSchema })
    .safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid template", details: parsed.error.flatten() });
  }
  try {
    const created = await createNewsletterTemplate(parsed.data.name, parsed.data.bodyJson, claims.sub);
    return res.status(201).json(created);
  } catch (err) {
    // A shared library makes a name clash routine, not exceptional — explain it, never 500.
    if (err instanceof DuplicateTemplateNameError) {
      return res.status(409).json({ error: "A template with that name already exists" });
    }
    throw err;
  }
}

// DELETE /api/admin/newsletter-templates/:id — remove one from the shared library (Editor+).
export async function deleteAdminNewsletterTemplate(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "newsletter", "edit"))) return;
  const id = templateId(req, res);
  if (id === null) return;
  const removed = await deleteNewsletterTemplate(id);
  if (!removed) return res.status(404).json({ error: "Template not found" });
  return res.status(204).end();
}

// DELETE /api/admin/newsletters/:id — delete a DRAFT (Admin only: sending is Admin-only, so its
// cleanup is too).
//
// A SENT newsletter is IMMUTABLE (TASK-258, superseding TASK-252's redact option): it is the
// charity's permanent record of what was said to donors — trustees, complaints and the Fundraising
// Regulator all ask "what exactly did you send?" — and the stored content carries no donor data
// (names merge per recipient at send time), so privacy never required deleting it. A sent id here is
// refused with the same 409 shape as editing one; the function that could redact was REMOVED from the
// db module, so there is nothing an authorised-but-mistaken caller could reach.
export async function deleteAdminNewsletter(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "newsletter", "edit");
  if (!claims) return;
  if (claims.role !== "admin") {
    return res.status(403).json({ error: "Only an admin can delete a newsletter" });
  }
  const id = newsletterId(req, res);
  if (id === null) return;
  const existing = await getNewsletter(id);
  if (!existing) return res.status(404).json({ error: "Newsletter not found" });

  if (existing.status === "sent") {
    return res.status(409).json({ error: "A sent newsletter is a permanent record and cannot be deleted" });
  }

  // The audit row is written INSIDE the delete, in the same transaction (writeWithAudit).
  const removed = await deleteDraftNewsletter(id, claims.email, existing.subject);
  if (!removed) return res.status(404).json({ error: "Newsletter not found" });
  return res.status(200).json({ status: "deleted", id });
}

// GET /api/admin/newsletters/:id/stats — the delivery-truth aggregates for one newsletter (TASK-255):
// sends / delivered / bounced / complained / unsubscribed + the bounced addresses for list cleaning.
// Editor+ like the rest of the tab. AGGREGATES ONLY — there is deliberately no "who opened what" view
// (see the Phase 1 spec); the bounced list is operational (dead addresses), not behavioural.
export async function getAdminNewsletterStats(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "newsletter", "view"))) return;
  const id = newsletterId(req, res);
  if (id === null) return;
  const existing = await getNewsletter(id);
  if (!existing) return res.status(404).json({ error: "Newsletter not found" });
  return res.json(await getNewsletterStats(id));
}

// --- Subscriber lists / audiences (TASK-259; donor audience + archiving TASK-270) -----------------
// Editor+, matching the tab. Memberships tombstone rather than delete (consent history). An audience's
// `kind` says what it MEANS — 'donors' is the live donor audience, 'everyone' is Newsletter (its own
// members plus the donors), 'manual' is exactly the people on it. Archiving is likewise a tombstone.
export async function getAdminSubscriberLists(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "newsletter", "view"))) return;
  return res.json(await listSubscriberLists());
}

// TASK-272: the suppression list, made visible and reversible. Silent blocking would be its own
// failure mode — if a real supporter's mailbox bounced once during an outage, staff need to see that
// we stopped writing to them and be able to undo it. Viewing is Viewer+, lifting is Editor+.
export async function getAdminSuppressions(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "newsletter", "view"))) return;
  return res.json(await listSuppressions());
}

export async function postAdminSuppressionLift(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "newsletter", "edit");
  if (!claims) return;
  const parsed = z.object({ email: z.string().trim().email() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "A valid email address is needed" });
  const lifted = await unsuppressEmail(parsed.data.email, claims.email);
  if (!lifted) return res.status(404).json({ error: "That address is not blocked" });
  return res.status(200).json({ lifted: true });
}

export async function getAdminArchivedSubscriberLists(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "newsletter", "view"))) return;
  return res.json(await listArchivedSubscriberLists());
}

// TASK-270: the two things an audience can refuse. 'donors' is resolved live from donor consent, so
// there is nothing to hand-manage; an archived audience is retired and must take no new people.
// Returned as a message so every caller refuses in the same words the admin will read.
function listNotManageable(list: SubscriberListRef): string | null {
  if (list.archivedAt) return "That audience is archived — restore it before adding people";
  if (list.kind === "donors") {
    return "Donors updates itself from donor consent, so people can't be added to it by hand";
  }
  return null;
}

// Retire an audience. A tombstone (archived_at), never a delete: past sends keep their audience label
// and the membership rows survive as consent history. Built-ins (Newsletter, Donors) refuse — 409.
export async function deleteAdminSubscriberList(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "newsletter", "edit"))) return;
  const listId = Number(req.params.id);
  if (!Number.isInteger(listId) || listId <= 0) return res.status(400).json({ error: "Invalid list id" });
  try {
    const archived = await archiveSubscriberList(listId);
    if (!archived) return res.status(404).json({ error: "Subscriber list not found" });
    return res.status(204).end();
  } catch (err) {
    if (err instanceof BuiltInListError) {
      return res.status(409).json({ error: "Newsletter and Donors are built in and can't be archived" });
    }
    throw err;
  }
}

export async function postAdminSubscriberListRestore(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "newsletter", "edit"))) return;
  const listId = Number(req.params.id);
  if (!Number.isInteger(listId) || listId <= 0) return res.status(400).json({ error: "Invalid list id" });
  const restored = await restoreSubscriberList(listId);
  if (!restored) return res.status(404).json({ error: "Archived list not found" });
  return res.status(200).json({ restored: true });
}

export async function postAdminSubscriberList(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "newsletter", "edit"))) return;
  const parsed = z.object({ name: z.string().trim().min(1).max(60) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Give the audience a name" });
  try {
    return res.status(201).json(await createSubscriberList(parsed.data.name));
  } catch (err) {
    if (err instanceof DuplicateListError) {
      return res.status(409).json({ error: "An audience with that name already exists" });
    }
    if (err instanceof Error && /no usable characters/.test(err.message)) {
      return res.status(400).json({ error: "Give the audience a name" });
    }
    throw err;
  }
}

export async function getAdminListMembers(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "newsletter", "view"))) return;
  const listId = Number(req.params.id);
  if (!Number.isInteger(listId) || listId <= 0) return res.status(400).json({ error: "Invalid list id" });
  const list = await getSubscriberList(listId);
  if (!list) return res.status(404).json({ error: "Subscriber list not found" });
  return res.json(await listListMembers(listId));
}

export async function postAdminListMember(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "newsletter", "edit");
  if (!claims) return;
  const listId = Number(req.params.id);
  if (!Number.isInteger(listId) || listId <= 0) return res.status(400).json({ error: "Invalid list id" });
  const list = await getSubscriberList(listId);
  if (!list) return res.status(404).json({ error: "Subscriber list not found" });
  const refusal = listNotManageable(list);
  if (refusal) return res.status(400).json({ error: refusal });
  const parsed = z
    .object({
      name: z.string().trim().max(120).optional(),
      email: z.string().trim().email(),
      phone: z.string().trim().max(30).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "A valid email address is needed" });
  // Staff typing someone in is a deliberate act — it may revive an opted-out membership (unlike an
  // import, which never may).
  const outcome = await addListSubscriber(
    listId,
    { name: parsed.data.name ?? null, email: parsed.data.email, phone: parsed.data.phone ?? null },
    "admin",
    // TASK-278: stamp WHO added them. "Who put this person on the list?" is the first question when
    // an address turns out to be wrong or someone says they never signed up.
    { revive: true, addedBy: claims.email },
  );
  return res.status(outcome === "added" ? 201 : 200).json({ outcome });
}

// TASK-282: add ONE person to SEVERAL audiences in one action. Someone met at an event is often a
// volunteer AND a business contact AND wants the newsletter, and doing that as three trips through
// the same form is where a list gets half-populated.
//
// The single-list endpoint above is untouched and still serves anything aimed at one audience.
// This one lives outside /subscriber-lists/:id because there is no single :id to put in the path.
//
// Deliberately NOT a transaction. Each membership is an independent, idempotent row: pressing it
// again is a no-op ('exists'), so a partial write is recoverable and honestly reportable. Wrapping
// five independent writes in a transaction would buy an atomicity nobody asked for while hiding
// WHICH audience failed — the one fact the volunteer needs.
export async function postAdminListMembersMulti(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "newsletter", "edit");
  if (!claims) return;
  const parsed = z
    .object({
      listIds: z.array(z.number()).min(1),
      name: z.string().trim().max(120).optional(),
      email: z.string().trim().email(),
      phone: z.string().trim().max(30).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "A valid email address is needed" });
  const listIds = parseTargetListIds(parsed.data.listIds);
  if (!listIds) return res.status(400).json({ error: "Choose at least one audience" });

  // Check EVERY audience before writing ANY. A half-done add that still reports success is worse
  // than a clean refusal: the volunteer has no way to tell which half happened, and the obvious
  // fix — press it again — silently doubles the work that did succeed.
  const lists: SubscriberListRef[] = [];
  for (const id of listIds) {
    const list = await getSubscriberList(id);
    if (!list) return res.status(404).json({ error: "Subscriber list not found" });
    const refusal = listNotManageable(list);
    if (refusal) return res.status(400).json({ error: refusal });
    lists.push(list);
  }

  const results: TargetOutcome[] = [];
  for (const list of lists) {
    // Same call, same options as the single-list route: staff typing someone in is a deliberate
    // act, so it may revive an opted-out membership (revive: true) — unlike an import, which may
    // never. addedBy stamps which volunteer did it (TASK-278).
    const outcome = await addListSubscriber(
      list.id,
      { name: parsed.data.name ?? null, email: parsed.data.email, phone: parsed.data.phone ?? null },
      "admin",
      { revive: true, addedBy: claims.email },
    );
    results.push({ listId: list.id, listName: list.name, outcome });
  }
  const folded = foldOutcomes(results);
  try {
    await recordAudit({
      actor: claims.email,
      action: "subscribers.added",
      entity: "subscriber_list",
      entityId: lists[0].id,
      data: {
        email: parsed.data.email,
        audiences: lists.map((l) => l.slug),
        added: folded.added,
        resubscribed: folded.resubscribed,
        alreadyOnList: folded.alreadyOnList,
        previouslyUnsubscribed: folded.previouslyUnsubscribed,
      },
    });
  } catch (err) {
    console.error("multi-add audit failed:", err instanceof Error ? err.message : err);
  }
  // 201 for anything that actually changed - a revived membership is a change, not a no-op.
  return res.status(folded.changed > 0 ? 201 : 200).json(folded);
}

// TASK-291: mark an audience private or public. Only MANUAL lists can change - Newsletter is
// publicly joinable by definition (the website footer) and Donors cannot be joined by hand, so
// letting either be flipped would record a promise the code does not keep.
export async function postAdminListVisibility(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "newsletter", "edit");
  if (!claims) return;
  const listId = Number(req.params.id);
  if (!Number.isInteger(listId) || listId <= 0) return res.status(400).json({ error: "Invalid list id" });
  const parsed = z.object({ visibility: z.enum(["private", "public"]) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Choose private or public" });
  const changed = await setListVisibility(listId, parsed.data.visibility);
  if (!changed) {
    return res.status(400).json({
      error: "Only your own audiences can be made public — Newsletter and Donors are fixed",
    });
  }
  try {
    await recordAudit({
      actor: claims.email,
      action: "subscribers.list_visibility",
      entity: "subscriber_list",
      entityId: listId,
      data: { visibility: parsed.data.visibility },
    });
  } catch (err) {
    console.error("visibility audit failed:", err instanceof Error ? err.message : err);
  }
  return res.json({ visibility: parsed.data.visibility });
}

export async function deleteAdminListMember(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "newsletter", "edit"))) return;
  const listId = Number(req.params.id);
  const memberId = Number(req.params.memberId);
  if (!Number.isInteger(listId) || listId <= 0 || !Number.isInteger(memberId) || memberId <= 0) {
    return res.status(400).json({ error: "Invalid id" });
  }
  const removed = await removeListMember(listId, memberId);
  if (!removed) return res.status(404).json({ error: "Member not found" });
  return res.status(204).end();
}

// TASK-260: spreadsheet import, in two steps that the UI walks through:
//   preview — parse the uploaded file (CSV or .xlsx) and report EXACTLY what an import would do:
//             rows ready, problem rows (line + reason), already-on-list, and previously-opted-out
//             (which an import may NEVER revive — a spreadsheet cannot overrule an opt-out);
//   import  — takes the rows back WITH an explicit attestation that these people consented to be
//             contacted. No attestation, no import: that tick is what the charity shows a regulator.
const importFileSchema = z.object({
  filename: z.string().trim().min(1),
  dataBase64: z.string().min(1),
});
const IMPORT_MAX_BYTES = 2 * 1024 * 1024;

export async function postAdminListImportPreview(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "newsletter", "edit"))) return;
  const listId = Number(req.params.id);
  if (!Number.isInteger(listId) || listId <= 0) return res.status(400).json({ error: "Invalid list id" });
  const list = await getSubscriberList(listId);
  if (!list) return res.status(404).json({ error: "Subscriber list not found" });
  const refusal = listNotManageable(list);
  if (refusal) return res.status(400).json({ error: refusal });
  const parsed = importFileSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Upload a CSV or Excel file" });
  const data = Buffer.from(parsed.data.dataBase64, "base64");
  if (data.length > IMPORT_MAX_BYTES) return res.status(413).json({ error: "File too large (2 MB max)" });

  let fileRows;
  try {
    fileRows = await parseImportFile(parsed.data.filename, data);
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : "Could not read that file" });
  }

  const states = await getMembershipStates(listId, fileRows.rows.map((r) => r.email));
  const active = new Set(states.filter((s) => !s.unsubscribed).map((s) => s.email));
  const optedOut = new Set(states.filter((s) => s.unsubscribed).map((s) => s.email));
  const ready = fileRows.rows.filter((r) => !active.has(r.email) && !optedOut.has(r.email));
  return res.json({
    rows: fileRows.rows,
    issues: fileRows.issues,
    readyCount: ready.length,
    alreadyOnList: fileRows.rows.filter((r) => active.has(r.email)).map((r) => r.email),
    previouslyUnsubscribed: fileRows.rows.filter((r) => optedOut.has(r.email)).map((r) => r.email),
  });
}

const importCommitSchema = z.object({
  rows: z
    .array(z.object({ name: z.string().trim().max(120).nullable(), email: z.string().trim().email() }))
    .min(1)
    .max(5000),
  attestation: z.literal(true),
});

export async function postAdminListImport(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "newsletter", "edit");
  if (!claims) return;
  const listId = Number(req.params.id);
  if (!Number.isInteger(listId) || listId <= 0) return res.status(400).json({ error: "Invalid list id" });
  const list = await getSubscriberList(listId);
  if (!list) return res.status(404).json({ error: "Subscriber list not found" });
  const refusal = listNotManageable(list);
  if (refusal) return res.status(400).json({ error: refusal });
  const parsed = importCommitSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Confirm these people have agreed to be contacted before importing",
    });
  }
  const counts = { added: 0, alreadyOnList: 0, previouslyUnsubscribed: 0 };
  for (const row of parsed.data.rows) {
    // source 'import' + revive:false — the tombstone rule: a spreadsheet cannot overrule an opt-out.
    const outcome = await addListSubscriber(listId, { name: row.name, email: row.email, phone: null }, "import", {
      revive: false,
      addedBy: claims.email, // TASK-278: which volunteer imported this list
    });
    if (outcome === "added") counts.added++;
    else if (outcome === "exists") counts.alreadyOnList++;
    else if (outcome === "previously_unsubscribed") counts.previouslyUnsubscribed++;
  }
  // A summary audit row (recordAudit — the memberships are already durably written; this mirrors the
  // TASK-214 batch-summary pattern): who imported, into which list, with what result.
  try {
    await recordAudit({
      actor: claims.email,
      action: "subscribers.imported",
      entity: "subscriber_list",
      entityId: listId,
      data: { list: list.slug, attestation: true, ...counts },
    });
  } catch (err) {
    console.error("import audit failed:", err instanceof Error ? err.message : err);
  }
  return res.status(200).json(counts);
}

// TASK-282: preview an import against SEVERAL audiences.
//
// "Already on the list" is per-audience, so the aggregate has to mean something precise. A row is
// READY if it would join at least ONE of the chosen audiences: somebody already on Volunteers but
// not on Newsletter is genuinely work to do, and folding them into "already on the list" would
// tell the volunteer nothing needed doing when four hundred additions did.
export async function postAdminListImportPreviewMulti(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "newsletter", "edit"))) return;
  const parsed = importFileSchema.extend({ listIds: z.array(z.number()).min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Upload a CSV or Excel file" });
  const listIds = parseTargetListIds(parsed.data.listIds);
  if (!listIds) return res.status(400).json({ error: "Choose at least one audience" });

  const lists: SubscriberListRef[] = [];
  for (const id of listIds) {
    const list = await getSubscriberList(id);
    if (!list) return res.status(404).json({ error: "Subscriber list not found" });
    const refusal = listNotManageable(list);
    if (refusal) return res.status(400).json({ error: refusal });
    lists.push(list);
  }

  const data = Buffer.from(parsed.data.dataBase64, "base64");
  if (data.length > IMPORT_MAX_BYTES) return res.status(413).json({ error: "File too large (2 MB max)" });
  let fileRows;
  try {
    fileRows = await parseImportFile(parsed.data.filename, data);
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : "Could not read that file" });
  }

  const emails = fileRows.rows.map((r) => r.email);
  const optedOut = new Set<string>();
  const activeIn = new Map<string, number>();
  const audiences: { listId: number; listName: string; alreadyOnList: number }[] = [];
  for (const list of lists) {
    const states = await getMembershipStates(list.id, emails);
    const active = states.filter((s) => !s.unsubscribed).map((s) => s.email);
    states.filter((s) => s.unsubscribed).forEach((s) => optedOut.add(s.email));
    active.forEach((e) => activeIn.set(e, (activeIn.get(e) ?? 0) + 1));
    audiences.push({ listId: list.id, listName: list.name, alreadyOnList: active.length });
  }

  const isOptedOut = (email: string) => optedOut.has(email);
  const onEvery = (email: string) => (activeIn.get(email) ?? 0) === lists.length;
  return res.json({
    rows: fileRows.rows,
    issues: fileRows.issues,
    readyCount: fileRows.rows.filter((r) => !isOptedOut(r.email) && !onEvery(r.email)).length,
    audiences,
    // Named for what it means with several audiences in play: on ALL of them already, so this
    // import genuinely has nothing to do for that person.
    alreadyOnEvery: fileRows.rows.filter((r) => !isOptedOut(r.email) && onEvery(r.email)).map((r) => r.email),
    previouslyUnsubscribed: fileRows.rows.filter((r) => isOptedOut(r.email)).map((r) => r.email),
  });
}

// TASK-282: commit an import into SEVERAL audiences. revive:false is applied per audience, so the
// tombstone rule — a spreadsheet may never overrule an opt-out — stays exactly where it already is
// rather than being restated somewhere it could drift.
export async function postAdminListImportMulti(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "newsletter", "edit");
  if (!claims) return;
  const parsed = importCommitSchema.extend({ listIds: z.array(z.number()).min(1) }).safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Confirm these people have agreed to be contacted before importing",
    });
  }
  const listIds = parseTargetListIds(parsed.data.listIds);
  if (!listIds) return res.status(400).json({ error: "Choose at least one audience" });

  const lists: SubscriberListRef[] = [];
  for (const id of listIds) {
    const list = await getSubscriberList(id);
    if (!list) return res.status(404).json({ error: "Subscriber list not found" });
    const refusal = listNotManageable(list);
    if (refusal) return res.status(400).json({ error: refusal });
    lists.push(list);
  }

  const audiences: { listId: number; listName: string; added: number; alreadyOnList: number; previouslyUnsubscribed: number }[] = [];
  const total = { added: 0, alreadyOnList: 0, previouslyUnsubscribed: 0 };
  for (const list of lists) {
    // Folded through the same tested helper as the single-person route rather than a second
    // hand-rolled counter, so a new outcome can never go silently uncounted here.
    const results: TargetOutcome[] = [];
    for (const row of parsed.data.rows) {
      const outcome = await addListSubscriber(list.id, { name: row.name, email: row.email, phone: null }, "import", {
        revive: false,
        addedBy: claims.email,
      });
      results.push({ listId: list.id, listName: list.name, outcome });
    }
    const folded = foldOutcomes(results);
    // revive:false cannot produce a resubscribe, but count it as added if it ever did rather than
    // dropping it - a membership that is now active must show up somewhere in the totals.
    const counts = {
      added: folded.added + folded.resubscribed,
      alreadyOnList: folded.alreadyOnList,
      previouslyUnsubscribed: folded.previouslyUnsubscribed,
    };
    total.added += counts.added;
    total.alreadyOnList += counts.alreadyOnList;
    total.previouslyUnsubscribed += counts.previouslyUnsubscribed;
    audiences.push({ listId: list.id, listName: list.name, ...counts });
  }
  try {
    await recordAudit({
      actor: claims.email,
      action: "subscribers.imported",
      entity: "subscriber_list",
      entityId: lists[0].id,
      data: { lists: lists.map((l) => l.slug), attestation: true, rows: parsed.data.rows.length, ...total },
    });
  } catch (err) {
    console.error("import audit failed:", err instanceof Error ? err.message : err);
  }
  return res.status(200).json({ ...total, audiences });
}

// GET /api/admin/newsletters — list summaries (Editor+; read-only but the tab is a staff tool).
export async function getAdminNewsletters(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "newsletter", "view"))) return;
  return res.json(await listNewsletters());
}

// GET /api/admin/newsletters/:id — one newsletter incl. body_html (Editor+).
export async function getAdminNewsletter(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "newsletter", "view"))) return;
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
  return res.json({
    html: renderNewsletter(parsed.data.bodyJson, { firstName: PREVIEW_FIRST_NAME, unsubscribeUrl: "#" }),
  });
}

// GET /api/admin/newsletters/recipients — Admin only. The deduped list of consenting donor emails a
// send would go to, for the send-confirmation dialog. Admin-gated (matches send) because it exposes
// donor PII; returns the same recipient set the send loop uses, so the confirmation can't drift.
// TASK-288: turn whatever the client sent — `listIds`, a single `listId`, or nothing at all —
// into the audiences to mail. One place, so the send and the preview beside it can never
// disagree about what a selection means, which would show one count and mail another.
async function resolveAudiences(
  raw: { listIds?: number[]; listId?: number },
): Promise<{ lists: SubscriberListRef[] } | { error: string; status: number }> {
  let ids: number[] = [];
  if (Array.isArray(raw.listIds) && raw.listIds.length) {
    const parsed = parseTargetListIds(raw.listIds);
    if (!parsed) return { error: "Choose at least one audience", status: 400 };
    ids = parsed;
  } else if (raw.listId) {
    ids = [raw.listId];
  }
  if (!ids.length) {
    // Unchanged default: no audience named means the newsletter audience, as it always has.
    const fallback = await getSubscriberListBySlug("newsletter");
    if (!fallback) return { error: "Subscriber list not found", status: 404 };
    return { lists: [fallback] };
  }
  const lists: SubscriberListRef[] = [];
  for (const id of ids) {
    const list = await getSubscriberList(id);
    if (!list) return { error: "Subscriber list not found", status: 404 };
    // TASK-270: an archived audience is retired. Refused here, before anything is claimed, so
    // one archived pick cannot half-send to the others.
    if (list.archivedAt) {
      return { error: `${list.name} is archived — restore it to send to it`, status: 400 };
    }
    lists.push(list);
  }
  return { lists };
}

export async function getAdminNewsletterRecipients(req: Request, res: Response): Promise<Response | void> {
  // TASK-288: ?listIds=1,2 previews the DEDUPLICATED union of several audiences — the count shown
  // here is the count that will be mailed, which is the whole point of showing it.
  {
    const rawIds = req.query.listIds;
    if (rawIds != null) {
      if (!(await authorizeSection(req, res, "newsletter", "edit"))) return;
      const ids = String(rawIds)
        .split(",")
        .map((x) => Number(x.trim()))
        .filter((x) => Number.isInteger(x) && x > 0);
      const resolved = await resolveAudiences({ listIds: ids });
      if ("error" in resolved) return res.status(resolved.status).json({ error: resolved.error });
      const recipients = await listRecipientsForLists(resolved.lists);
      return res.json({
        count: recipients.length,
        emails: recipients.map((r) => r.email),
        audience: resolved.lists.map((l) => l.name).join(" + "),
        audiences: resolved.lists.map((l) => ({ id: l.id, name: l.name, kind: l.kind })),
        kind: resolved.lists.length === 1 ? resolved.lists[0].kind : "multi",
      });
    }
  }
  // TASK-259: ?listId= previews the chosen audience; absent = the newsletter audience, as ever.
  {
    const rawListId = req.query.listId;
    if (rawListId != null) {
      const listId = Number(rawListId);
      if (!Number.isInteger(listId) || listId <= 0) return res.status(400).json({ error: "Invalid list" });
      if (!(await authorizeSection(req, res, "newsletter", "edit"))) return;
      const list = await getSubscriberList(listId);
      if (!list) return res.status(404).json({ error: "Subscriber list not found" });
      const recipients = await listRecipientsForList(list);
      // TASK-270: the audience's NAME and KIND ride along so the send confirmation can name what it
      // is about to mail ("Send to Volunteers — 42 people?") instead of the old generic "consenting
      // subscribers", which read identically whether you were mailing volunteers or every donor.
      return res.json({
        count: recipients.length,
        emails: recipients.map((r) => r.email),
        audience: list.name,
        kind: list.kind,
      });
    }
  }
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

// POST /api/admin/newsletters/:id/send — Admin only. Sends one email per recipient of the CHOSEN
// AUDIENCE (TASK-259; body {listId} optional, defaulting to the newsletter list — consenting donors
// plus its subscribers), each with an unsubscribe link, then marks the newsletter sent. Idempotent:
// an already-sent newsletter → 409.
export async function postAdminSendNewsletter(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "newsletter", "edit");
  if (!claims) return;
  const id = newsletterId(req, res);
  if (id === null) return;

  // Resolve the audiences BEFORE claiming: an unknown or archived list must fail without marking
  // anything sent. TASK-288: `listIds` for several, `listId` still accepted for one.
  const listParse = z
    .object({
      listId: z.number().int().positive().optional(),
      listIds: z.array(z.number()).optional(),
    })
    .safeParse(req.body ?? {});
  if (!listParse.success) return res.status(400).json({ error: "Invalid list" });
  const resolved = await resolveAudiences(listParse.data);
  if ("error" in resolved) return res.status(resolved.status).json({ error: resolved.error });
  const lists = resolved.lists;

  // Atomically claim the draft BEFORE sending. If another request already sent it (or it never
  // existed as a draft), we 409 without emailing anyone — a double-click cannot re-blast.
  const newsletter = await claimNewsletterForSend(id, claims.sub);
  if (!newsletter) {
    const existing = await getNewsletter(id);
    if (!existing) return res.status(404).json({ error: "Newsletter not found" });
    return res.status(409).json({ error: "This newsletter has already been sent" });
  }
  // TASK-288: every audience is recorded. list_id keeps the first, so the history join and the
  // stats panel read exactly as they always have.
  await setNewsletterLists(
    id,
    lists.map((l) => l.id),
  );

  // TASK-274: ENQUEUE, don't send here. The old loop ran every recipient inside this request, behind
  // the ALB's 60-second default: a few hundred people outran it, the admin saw "Send failed" while the
  // server was in fact still sending, and a restart left a newsletter marked sent, partly delivered,
  // with no record of who had been reached and no way to resume. There was no pacing (the provider
  // accepts roughly 2/second) and no retry, so a burst simply lost people.
  //
  // Now the recipients become queue rows and a background worker sends them at a controlled rate.
  // `rollout: "gentle"` ramps a daily cap (200, then 400, 800 ...) so a first big send from a lightly
  // used domain warms up instead of arriving as one spike that looks like a compromised account.
  // Deduplicated across every chosen audience: somebody on two lists gets ONE email.
  const recipients = await listRecipientsForLists(lists);
  if (recipients.length === 0) {
    return res.status(400).json({
      error:
        lists.length === 1
          ? "That audience has nobody to send to"
          : "Those audiences have nobody to send to",
    });
  }
  const optionsParse = z
    .object({
      rollout: z.enum(["immediate", "gentle"]).optional(),
      perMinute: z.number().int().min(1).max(600).optional(),
      // TASK-280 (letter J): an ISO time to start at. Absent = send now, so the common case is
      // unchanged and nobody has to opt out of scheduling.
      scheduledAt: z.string().optional().nullable(),
    })
    .safeParse(req.body ?? {});
  if (!optionsParse.success) return res.status(400).json({ error: "Invalid send options" });

  // Validated by the same pure rules the UI uses, so the two cannot disagree about what is a valid
  // time — and a past time is refused rather than sending instantly, which is the opposite of what
  // someone reaching for "schedule" wants.
  const when = parseScheduleAt(optionsParse.data.scheduledAt, new Date());
  if (!when.ok) return res.status(400).json({ error: when.reason });

  const job = await createSendJob({
    newsletterId: id,
    // The job records the FIRST audience, matching newsletters.list_id. The recipients it carries
    // are already the deduplicated union, so this is a label for the job, not the thing that
    // decides who gets mailed (TASK-288).
    listId: lists[0].id,
    recipients,
    rollout: optionsParse.data.rollout ?? "immediate",
    perMinute: optionsParse.data.perMinute ?? DEFAULT_PER_MINUTE,
    createdBy: claims.email,
    scheduledAt: when.at,
  });

  // The recipient count is known NOW and is part of the record; the sent/failed split is filled in by
  // the worker as it goes (the job's own counters are the live truth in the meantime).
  await setNewsletterDeliverySummary(id, {
    recipientCount: recipients.length,
    sentCount: 0,
    failedCount: 0,
    failedEmails: [],
  });

  // Start draining straight away rather than waiting up to a whole tick. Deliberately NOT awaited:
  // the 202 goes back immediately and the sending continues in the background, which is the entire
  // point of the change. Errors are the worker's own problem — the queue rows stay pending and the
  // next tick retries them.
  // Only start draining straight away when this is meant to go now; a scheduled job waits for the
  // worker to find it due.
  if (!when.at) void runSendTick().catch((err) =>
    console.error("immediate send tick failed:", err instanceof Error ? err.message : err),
  );

  return res.status(202).json({
    status: when.at ? "scheduled" : "queued",
    jobId: job.id,
    recipientCount: recipients.length,
    rollout: job.rollout,
    scheduledAt: job.scheduledAt,
  });
}

// GET /api/admin/newsletters/:id/send-job — live progress for the send bar. Viewer+ (reading how far
// a send got is not a write).
export async function getAdminNewsletterSendJob(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "newsletter", "view"))) return;
  const id = newsletterId(req, res);
  if (id === null) return;
  const job = await getJobForNewsletter(id);
  if (!job) return res.status(404).json({ error: "No send for this newsletter" });
  const summary = pacingSummary(
    {
      rollout: job.rollout,
      perMinute: job.perMinute,
      dailyCap: job.dailyCap,
      ceiling: config.NEWSLETTER_DAILY_SEND_CAP, // TASK-302: the standing daily ceiling
      startedAt: job.startedAt ? new Date(job.startedAt) : null,
    },
    0,
    job.pending,
    new Date(),
  );
  // TASK-280: while a send is waiting for its time, say WHEN plainly — "pending" invites someone to
  // assume it is stuck and press send a second time.
  const scheduled = scheduleSummary(job.scheduledAt ? new Date(job.scheduledAt) : null, new Date());
  return res.json({ ...job, summary: scheduled || summary, scheduleSummary: scheduled });
}

// POST /api/admin/newsletters/:id/send-job/:action — pause, resume or cancel a send in flight. There
// was previously NO way to stop one: once the loop started, closing the browser did not stop the
// server, and a newsletter going to the wrong audience could not be halted.
export async function postAdminNewsletterSendJobAction(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "newsletter", "edit"))) return;
  const id = newsletterId(req, res);
  if (id === null) return;
  const action = String(req.params.action);
  const status = action === "pause" ? "paused" : action === "resume" ? "running" : action === "cancel" ? "cancelled" : null;
  if (!status) return res.status(400).json({ error: "Unknown action" });
  const job = await getJobForNewsletter(id);
  if (!job) return res.status(404).json({ error: "No send for this newsletter" });
  const changed = await setJobStatus(job.id, status);
  if (!changed) return res.status(409).json({ error: "That send has already finished" });
  return res.json({ status });
}

// GET /api/admin/newsletters/send-jobs/inflight — everything currently queued, scheduled, running or
// paused (TASK-285). The Overview needs to say "one newsletter is waiting to go" without asking about
// each newsletter in turn, and a send paused halfway is exactly the thing that gets forgotten.
// Viewer+: this is scheduling state, not donor data.
export async function getAdminNewsletterInflight(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "newsletter", "view"))) return;
  const jobs = await listInflightJobs();
  if (!jobs.length) return res.json(null);
  const job = jobs[0];
  const newsletter = await getNewsletter(job.newsletterId);
  return res.json({
    newsletterId: job.newsletterId,
    subject: newsletter ? newsletter.subject : null,
    status: job.status,
    scheduledAt: job.scheduledAt,
    total: job.total,
    sent: job.sent,
  });
}

// GET /api/admin/newsletters/:id/send-job/recipients — exactly who this send reached, and who it did
// not, with the reason. The old aggregate-only design could not answer this at all.
export async function getAdminNewsletterSendRecipients(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "newsletter", "view"))) return;
  const id = newsletterId(req, res);
  if (id === null) return;
  const job = await getJobForNewsletter(id);
  if (!job) return res.status(404).json({ error: "No send for this newsletter" });
  // TASK-303: the outcome is decided HERE, by the same pure rules a test covers, so the browser only
  // renders a label and cannot invent a different definition of "arrived".
  const rows = await listJobRecipients(job.id, id);
  return res.json(
    rows.map((r) => {
      const outcome = recipientOutcome(r.status, r.mailboxEvent);
      return { ...r, outcome, outcomeLabel: OUTCOME_LABELS[outcome] };
    }),
  );
}

// POST /api/admin/newsletters/test-send — send ONE copy of the posted draft to the signed-in admin's
// own email (Editor+), so they can check how it lands in a real inbox before blasting everyone. Does
// not touch newsletter state (no claim, no status change). Mirrors the preview body ({ subject,
// bodyJson }); the subject is prefixed [TEST] and a placeholder unsubscribe URL is used.
// TASK-277 (letter S): `to` is the optional SEED LIST — a handful of your own addresses at different
// providers, because where a message lands is decided per provider and one inbox cannot tell you.
// Capped at five: this sends real email to arbitrary addresses, so it stays a seed test rather than a
// second, ungoverned way to mail people.
const testSendSchema = z.object({
  subject: z.string().trim().min(1),
  bodyJson: newsletterDocSchema,
  to: z.array(z.string().trim().email()).min(1).max(5).optional(),
});
// POST /api/admin/newsletters/preflight — the pre-send checks (TASK-277, letter P). Takes the CURRENT
// draft, exactly like the preview and the test send do, so it checks what is about to go out rather
// than the last saved version. Read-only; Editor+ because only they can send.
const preflightSchema = z.object({
  subject: z.string().default(""),
  bodyJson: newsletterDocSchema,
  testSent: z.boolean().default(false),
});

export async function postAdminNewsletterPreflight(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "newsletter", "edit"))) return;
  const parsed = preflightSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid newsletter" });
  const findings = preflightNewsletter(parsed.data.bodyJson, {
    subject: parsed.data.subject,
    testSent: parsed.data.testSent,
  });
  return res.json({ findings });
}

export async function postAdminNewsletterTestSend(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "newsletter", "edit");
  if (!claims) return;
  const parsed = testSendSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid newsletter", details: parsed.error.flatten() });
  }
  // TASK-254: a test send exists to show what a DONOR will get, so it merges the SAMPLE name the live
  // preview uses — not firstNameOf(claims.email), which greeted the tester as "Dear admin@nbcc.scot"
  // and, once the subject merged too, would have put an email address in the title as well. Preview,
  // test send and the real thing now agree about what personalisation looks like.
  const html = renderNewsletter(parsed.data.bodyJson, {
    firstName: PREVIEW_FIRST_NAME,
    unsubscribeUrl: `${config.PORTAL_BASE_URL}/unsubscribe/preview`,
  });
  // Built once and both sent and echoed back, so what the tester is told to look for is necessarily
  // what actually went out.
  // TASK-292: the same fallback the real send uses, so a test shows what will actually arrive.
  const testSubject = `[TEST] ${mergeSubject(
    parsed.data.subject,
    PREVIEW_FIRST_NAME,
    parsed.data.bodyJson?.merge?.nameFallback ?? "",
  )}`;
  // TASK-277 (letter S): the SEED TEST. A test to one inbox tells you the email renders; it tells you
  // nothing about where it LANDS. Gmail, Outlook and Yahoo each decide inbox-vs-junk differently, so
  // the only way to know is to send to an address at each before committing to the real audience.
  // Defaults to the signed-in admin, so the existing one-click test is unchanged.
  const seeds = parsed.data.to?.length ? parsed.data.to : [claims.email];
  const failed: string[] = [];
  for (const address of seeds) {
    try {
      await sendNewsletter({
        email: address,
        from: newsletterSender(config.NEWSLETTER_FROM_EMAIL),
        replyTo: config.NEWSLETTER_REPLY_TO_EMAIL,
        subject: testSubject,
        html,
        // TASK-275: the test copy carries the text part too — a test that differs from the real send is
        // not a test of the real send.
        text: htmlToPlainText(html),
      });
    } catch (err) {
      console.error(`newsletter test-send to ${address} failed`, err);
      failed.push(address);
    }
  }
  if (failed.length === seeds.length) {
    return res.status(502).json({ error: "Could not send the test email." });
  }
  // Echo the subject actually sent (TASK-254). It makes the merge observable end to end — the
  // raw-subject bug lived at this call site, not in the merge function — and it is worth showing the
  // tester: "check your inbox for '[TEST] Hey, Jane!'" beats "sent".
  return res.json({
    sentTo: seeds.filter((a) => !failed.includes(a)),
    failed,
    subject: testSubject,
  });
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
  // TASK-272: honour the SAME ?q= the on-screen search uses. The export ignored it, so filtering to a
  // dozen people and pressing Export handed you the entire list — a quietly wrong answer, and a
  // needlessly large pile of personal data to have downloaded.
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const subscribers = await listNewsletterSubscribers(q || undefined);
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
  if (!(await authorizeSection(req, res, "newsletter", "view"))) return;
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
    return res.status(400).json({ error: "reduce-instead was chosen; reduce your donation from the donate page" });
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
    const paymentStatus = typeof req.query.paymentStatus === "string" ? req.query.paymentStatus : undefined;
    return res.status(200).json(await listDonations({ limit, offset, status, channel, paymentStatus }));
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

// GET /api/admin/email-log?type&status&q&limit&offset — the email send audit (email-audit
// feature): every send attempt with its outcome, plus the recent-failures band. Gated on the
// email-audit section, which NO role except admin carries by default (donor-identifying send
// data — granted per person via the Team matrix).
export async function getAdminEmailLog(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "email-audit", "view"))) return;
  try {
    const paged = pageArgs(req);
    // Clamped: the page reads 50 at a time; an unbounded limit would let one request dump the
    // whole log.
    const limit = Math.min(Math.max(paged.limit ?? 50, 1), 200);
    const offset = Math.max(paged.offset ?? 0, 0);
    const kind = typeof req.query.type === "string" && req.query.type ? req.query.type : undefined;
    const status = typeof req.query.status === "string" && req.query.status ? req.query.status : undefined;
    const q = typeof req.query.q === "string" ? req.query.q : undefined;
    const [listed, failures] = await Promise.all([
      listEmailLog({ kind, status, q, limit, offset }),
      // The red band only decorates the FIRST page of an unfiltered view — a filtered or paged
      // request is already a deliberate search, and repeating the band above it would just
      // duplicate rows the filter may deliberately exclude.
      !kind && !status && !q && offset === 0 ? listRecentEmailFailures() : Promise.resolve([]),
    ]);
    return res.status(200).json({ results: listed.rows, total: listed.total, failures });
  } catch (err) {
    console.error("admin email log list failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin is temporarily unavailable" });
  }
}

// --- Site addressing (site-pages feature): spare addresses + search visibility -------------
// GET  /api/admin/site-pages          — the registry pages (with effective listed flags) + aliases
// POST /api/admin/site-aliases        — add a spare address (validated, friendly refusals)
// DELETE /api/admin/site-aliases/:id  — remove one
// PATCH /api/admin/site-seo           — set one page's "show to search engines" choice
// Reads need site:view; every write needs site:edit (admins by default — public URLs and what
// Google lists are launch-sensitive).
export async function getAdminSitePages(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "site", "view"))) return;
  try {
    const { ALL_PAGES, PRIVATE_PAGES } = await import("../site/pages");
    const { listAliases, getSeoOverrides } = await import("../db/site-pages");
    const [aliases, overrides] = await Promise.all([listAliases(), getSeoOverrides()]);
    const pages = ALL_PAGES.map((p) => ({
      path: p.path,
      title: p.title,
      ballGated: Boolean(p.ballGated),
      listedByDefault: p.listedByDefault,
      listed: overrides.get(p.path) ?? p.listedByDefault,
      overridden: overrides.has(p.path),
    }));
    // The private half goes out alongside, so the admin can show ONE complete list. It is static
    // and carries no SEO choice, because none of these pages is a search destination.
    return res.status(200).json({ pages, aliases, privatePages: PRIVATE_PAGES });
  } catch (err) {
    console.error("admin site pages read failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin is temporarily unavailable" });
  }
}

export async function postAdminSiteAlias(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "site", "edit");
  if (!claims) return;
  try {
    const from = typeof req.body?.from === "string" ? req.body.from.trim().toLowerCase() : "";
    const to = typeof req.body?.to === "string" ? req.body.to.trim() : "";
    const { aliasFromProblem, aliasToProblem } = await import("../site/pages");
    const problem = aliasFromProblem(from) ?? aliasToProblem(to);
    if (problem) return res.status(400).json({ error: problem });
    const { addAlias } = await import("../db/site-pages");
    const added = await addAlias(from, to, `admin:${claims.email}`);
    if (!added) return res.status(409).json({ error: "That spare address already exists." });
    return res.status(201).json({ ok: true });
  } catch (err) {
    console.error("admin site alias add failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin is temporarily unavailable" });
  }
}

export async function deleteAdminSiteAlias(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "site", "edit"))) return;
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid id" });
    const { removeAlias } = await import("../db/site-pages");
    return (await removeAlias(id))
      ? res.status(200).json({ ok: true })
      : res.status(404).json({ error: "Not found" });
  } catch (err) {
    console.error("admin site alias delete failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin is temporarily unavailable" });
  }
}

export async function patchAdminSiteSeo(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "site", "edit");
  if (!claims) return;
  try {
    const path = typeof req.body?.path === "string" ? req.body.path : "";
    const listed = req.body?.listed;
    const { isKnownPage } = await import("../site/pages");
    if (!isKnownPage(path) || typeof listed !== "boolean") {
      return res.status(400).json({ error: "Pick a real page and a yes or no." });
    }
    const { setSeoListed } = await import("../db/site-pages");
    await setSeoListed(path, listed, `admin:${claims.email}`);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("admin site seo update failed:", err instanceof Error ? err.message : err);
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
adminRouter.get("/api/admin/email-log", getAdminEmailLog);
adminRouter.get("/api/admin/site-pages", getAdminSitePages);
adminRouter.post("/api/admin/site-aliases", postAdminSiteAlias);
adminRouter.delete("/api/admin/site-aliases/:id", deleteAdminSiteAlias);
adminRouter.patch("/api/admin/site-seo", patchAdminSiteSeo);

// --- Business outreach (TASK-354) ---------------------------------------------------------------
//
// Cold contact asking local businesses to become monthly supporters. The front of a funnel whose
// later stages already exist; this ends at "they signed up".

/** The id in the path, or null after sending a 400. Shared so the four routes agree. */
function outreachId(req: Request, res: Response): number | null {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Unknown business" });
    return null;
  }
  return id;
}

// POST /api/admin/outreach/check — what does the matcher say about this business?
//
// Deliberately its own endpoint rather than part of the create: the volunteer sees the warnings
// BEFORE committing anything, which is the entire point. Checking is a read, so Viewer+ can do it.
export async function postAdminOutreachCheck(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "outreach", "view"))) return;
  const businessName = typeof req.body?.businessName === "string" ? req.body.businessName.trim() : "";
  const contactEmail = typeof req.body?.contactEmail === "string" ? req.body.contactEmail.trim() : "";
  if (!businessName) return res.status(400).json({ error: "A business name is needed" });
  try {
    const known = await listKnownBusinesses();
    const matches = findMatches({ businessName, contactEmail: contactEmail || null }, known);
    return res.status(200).json({ matches, doNotContact: isDoNotContact(matches) });
  } catch (err) {
    console.error("outreach check failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin is temporarily unavailable" });
  }
}

// POST /api/admin/outreach — add a business. Creates a DRAFT; nothing is sent here.
export async function postAdminOutreach(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "outreach", "edit");
  if (!claims) return;
  const parsed = outreachCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid business", details: parsed.error.issues });
  }
  try {
    // Checked again on the server, not only in the browser. A decline is an instruction, and the
    // browser is not where instructions are enforced.
    const known = await listKnownBusinesses();
    const matches = findMatches(parsed.data, known);
    if (isDoNotContact(matches) && parsed.data.acknowledgedMatches !== true) {
      return res.status(409).json({
        error: "This business has told us not to contact them again",
        matches,
      });
    }
    const row = await createOutreach({
      businessName: parsed.data.businessName,
      contactName: parsed.data.contactName ?? null,
      contactEmail: parsed.data.contactEmail ?? null,
      contactPhone: parsed.data.contactPhone ?? null,
      businessType: parsed.data.businessType,
      note: parsed.data.note ?? null,
      warmIntro: parsed.data.warmIntro ?? null,
      ownerEmail: parsed.data.ownerEmail ?? null,
      detailsSource: parsed.data.detailsSource,
      consentBasis: parsed.data.consentBasis ?? null,
      recordedBy: claims.email,
      owner: parsed.data.owner ?? null,
    });
    return res.status(201).json({ business: row, matches });
  } catch (err) {
    console.error("outreach create failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin is temporarily unavailable" });
  }
}

// GET /api/admin/outreach — the list behind the landing counts.
export async function getAdminOutreach(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "outreach", "view"))) return;
  try {
    return res.status(200).json({ results: await listOutreach() });
  } catch (err) {
    console.error("outreach list failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin is temporarily unavailable" });
  }
}

adminRouter.post("/api/admin/outreach/check", postAdminOutreachCheck);
adminRouter.post("/api/admin/outreach", postAdminOutreach);
// POST /api/admin/outreach/:id/send — send the invitation to one business.
//
// Editor+, because it puts an email in a stranger's inbox. One business at a time by design:
// there is no bulk send here and there is not meant to be.
export async function postAdminOutreachSend(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "outreach", "edit"))) return;
  const id = outreachId(req, res);
  if (id === null) return;

  const signerName = typeof req.body?.signerName === "string" ? req.body.signerName.trim() : "";
  const signerRole = typeof req.body?.signerRole === "string" ? req.body.signerRole.trim() : "";
  const personalMessage =
    typeof req.body?.personalMessage === "string" ? req.body.personalMessage.trim() : "";
  if (!signerName || !signerRole) {
    return res.status(400).json({ error: "Choose who this is from" });
  }

  try {
    const business = await getOutreach(id);
    if (!business) return res.status(404).json({ error: "Unknown business" });
    if (!business.contactEmail) {
      return res.status(400).json({ error: "This business has no email address yet" });
    }
    if (business.sentAt) {
      // A fact, not a telling-off: two volunteers can open the same business at once.
      return res.status(409).json({ error: "This business has already been emailed" });
    }
    // PECR (TASK-403): a sole trader is a person in law, not a company, so we may only email one
    // who has already agreed to hear from us. Checked HERE and not only on the screen, because
    // the browser is not where the law is enforced.
    const blocked = emailBlockReason(business);
    if (blocked) return res.status(422).json({ error: blocked });

    const base = config.PORTAL_BASE_URL.replace(/\/+$/, "");
    const mail = buildOutreachEmail({
      businessName: business.businessName,
      contactName: business.contactName,
      personalMessage: personalMessage || null,
      signerName,
      signerRole,
      donateUrl: `${base}/donate`,
      bookletUrl: `${base}/assets/nbcc-business-booklet-2026.pdf`,
      privacyUrl: `${base}/privacy`,
      detailsSource: business.detailsSource,
    });

    await sendOutreachInvitation(business.businessName, {
      email: business.contactEmail,
      from: config.GIVING_FROM_EMAIL,
      replyTo: config.GIVING_FROM_EMAIL,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    });

    // Stamped only AFTER the send succeeds, so a provider failure leaves the draft sendable
    // rather than marking a business as contacted when nothing left the building.
    // Whether a line of their own went with it - not the line itself, which we have no reason to
    // keep. It is the only way to ever answer "does taking the extra minute help?" (TASK-413).
    await markOutreachSent(id, signerName, personalMessage.length > 0);
    return res.status(200).json({ sent: true });
  } catch (err) {
    console.error("outreach send failed:", err instanceof Error ? err.message : err);
    return res.status(502).json({ error: "The email could not be sent. Nothing has been recorded." });
  }
}

// POST /api/admin/outreach/preview — the exact email, rendered, before anyone sends it.
//
// The preview goes through buildOutreachEmail, the same function the send uses, so what the
// volunteer reads on screen cannot drift from what the business receives. Re-implementing the
// template in browser JavaScript would have been faster and would have started lying within a week.
export async function postAdminOutreachPreview(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "outreach", "view"))) return;
  const base = config.PORTAL_BASE_URL.replace(/\/+$/, "");
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const mail = buildOutreachEmail({
    businessName: str(req.body?.businessName, 200) || "your business",
    contactName: str(req.body?.contactName, 120) || null,
    personalMessage: str(req.body?.personalMessage, 1000) || null,
    signerName: str(req.body?.signerName, 120) || "NBCC",
    signerRole: str(req.body?.signerRole, 160) || "Night Before Christmas Campaign",
    donateUrl: `${base}/donate`,
    bookletUrl: `${base}/assets/nbcc-business-booklet-2026.pdf`,
    privacyUrl: `${base}/privacy`,
    detailsSource: str(req.body?.detailsSource, 40) || null,
  });
  return res.status(200).json({ subject: mail.subject, html: mail.html });
}

// GET /api/admin/outreach/:id — one business, and everything written about it.
//
// The whole point of the business page: a volunteer who has never seen this firm before gets the
// history in one place instead of piecing it together from a list row.
export async function getAdminOutreachOne(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "outreach", "view"))) return;
  const id = outreachId(req, res);
  if (id === null) return;
  try {
    const [business, notes] = await Promise.all([getOutreach(id), listOutreachNotes(id)]);
    if (!business) return res.status(404).json({ error: "Unknown business" });
    return res.status(200).json({ business, notes });
  } catch (err) {
    console.error("outreach read failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin is temporarily unavailable" });
  }
}

// POST /api/admin/outreach/:id/outcome — record what happened.
//
// Editor+, because a decline written here puts the business permanently out of reach of the
// matcher. Audited for the same reason.
export async function postAdminOutreachOutcome(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "outreach", "edit");
  if (!claims) return;
  const id = outreachId(req, res);
  if (id === null) return;

  const outcome = req.body?.outcome;
  if (!isOutcome(outcome)) return res.status(400).json({ error: "Choose what happened" });

  const raw = typeof req.body?.askAgainOn === "string" ? req.body.askAgainOn.trim() : "";
  if (raw && !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return res.status(400).json({ error: "Use a date like 2027-03-01" });
  }
  // A date on any other outcome is noise: nothing reads it, so storing it would only mislead
  // whoever found it later.
  const askAgainOn = wantsAskAgainDate(outcome) ? raw || null : null;

  try {
    const business = await getOutreach(id);
    if (!business) return res.status(404).json({ error: "Unknown business" });
    await setOutreachOutcome(id, outcome, askAgainOn);
    // Which donor they became, chosen by the volunteer at the moment they know it. Only
    // meaningful on a sign-up; clearing it on any other outcome keeps the money report honest if
    // somebody corrects a mistake.
    const donorId = Number(req.body?.donorId);
    await linkOutreachDonor(id, outcome === "signed_up" && Number.isInteger(donorId) && donorId > 0 ? donorId : null);
    await recordAudit({
      actor: claims.email,
      action: "outreach.outcome_recorded",
      entity: "business_outreach",
      entityId: id,
      data: { businessName: business.businessName, outcome, askAgainOn },
    });
    return res.status(200).json({ saved: true });
  } catch (err) {
    console.error("outreach outcome failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin is temporarily unavailable" });
  }
}

// POST /api/admin/outreach/:id/notes — add a note.
//
// Append-only by design: there is no edit and no delete. A note is what somebody thought at the
// time, and a record that can be tidied afterwards is not a record. It is also disclosable if the
// business ever asks what we hold, which is why the screen says to write it that way.
export async function postAdminOutreachNote(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "outreach", "edit");
  if (!claims) return;
  const id = outreachId(req, res);
  if (id === null) return;

  const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
  if (!body) return res.status(400).json({ error: "The note needs something in it" });
  if (body.length > 2000) return res.status(400).json({ error: "That note is too long" });

  try {
    const business = await getOutreach(id);
    if (!business) return res.status(404).json({ error: "Unknown business" });
    await addOutreachNote(id, claims.email, body);
    await recordAudit({
      actor: claims.email,
      action: "outreach.note_added",
      entity: "business_outreach",
      entityId: id,
      data: { businessName: business.businessName },
    });
    return res.status(201).json({ notes: await listOutreachNotes(id) });
  } catch (err) {
    console.error("outreach note failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin is temporarily unavailable" });
  }
}

adminRouter.get("/api/admin/outreach", getAdminOutreach);
adminRouter.post("/api/admin/outreach/preview", postAdminOutreachPreview);
// GET /api/admin/outreach/todo?scope=mine|all — the one list a volunteer opens.
//
// Defaults to "mine", which means MINE PLUS ANYTHING UNASSIGNED. Showing everyone's work by
// default means two volunteers chase the same business; showing only what is assigned means an
// unassigned business belongs to nobody and quietly rots. Neither is acceptable, so the default
// is both, and "everything" is one click away.
export async function getAdminOutreachTodo(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "outreach", "view");
  if (!claims) return;
  const scope = req.query.scope === "all" ? "all" : "mine";
  try {
    const rows = await listOutreachForTodo();
    const now = new Date();
    const mine = (r: { ownerEmail: string | null }) =>
      scope === "all" || !r.ownerEmail || r.ownerEmail === claims.email;
    const todos = sortTodos(
      rows
        .filter(mine)
        .map((r) => whatIsNeeded(r, now))
        .filter((t): t is NonNullable<typeof t> => t !== null),
    );
    // The count for the OTHER scope, so the toggle can say what is behind it rather than making
    // somebody click to find out whether it is worth clicking.
    const everything = sortTodos(
      rows.map((r) => whatIsNeeded(r, now)).filter((t): t is NonNullable<typeof t> => t !== null),
    );
    return res.status(200).json({ scope, todos, totalEverywhere: everything.length });
  } catch (err) {
    console.error("outreach todo failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin is temporarily unavailable" });
  }
}

// GET /api/admin/outreach/volunteers — who a business can be handed to.
//
// The admin users, not the letter-signers the picker used to offer: signing a thank-you letter
// and chasing a local business are different jobs done by different people, and a volunteer who
// does the second but not the first could not be assigned anything.
export async function getAdminOutreachVolunteers(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "outreach", "view"))) return;
  try {
    return res.status(200).json({ volunteers: await listVolunteers() });
  } catch (err) {
    console.error("outreach volunteers failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin is temporarily unavailable" });
  }
}

// Registered BEFORE /:id, or Express reads "todo" and "volunteers" as business ids.
// GET /api/admin/outreach/reports — is any of this working, and what works best?
export async function getAdminOutreachReports(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "outreach", "view"))) return;
  try {
    const rows = await listOutreachForReports();
    return res.status(200).json({
      funnel: buildFunnel(rows),
      money: buildMoneyRaised(rows),
      byVolunteer: buildByVolunteer(rows),
      personalMessage: buildPersonalMessageEffect(rows),
    });
  } catch (err) {
    console.error("outreach reports failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin is temporarily unavailable" });
  }
}

// GET /api/admin/outreach/:id/donors — which donor is this business, for the volunteer to pick.
//
// Ranked by the SAME matcher the duplicate check uses, in TypeScript. Ranking in SQL would mean a
// second notion of "these look like the same firm", and the two would drift.
export async function getAdminOutreachDonors(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "outreach", "view"))) return;
  const id = outreachId(req, res);
  if (id === null) return;
  try {
    const business = await getOutreach(id);
    if (!business) return res.status(404).json({ error: "Unknown business" });
    const wanted = normaliseBusinessName(business.businessName);
    const donors = (await listBusinessDonors())
      .map((d) => ({ ...d, score: similarity(wanted, normaliseBusinessName(d.name)) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 25);
    return res.status(200).json({ donors });
  } catch (err) {
    console.error("outreach donors failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin is temporarily unavailable" });
  }
}

adminRouter.get("/api/admin/outreach/reports", getAdminOutreachReports);
adminRouter.get("/api/admin/outreach/todo", getAdminOutreachTodo);
adminRouter.get("/api/admin/outreach/volunteers", getAdminOutreachVolunteers);
// GET /api/admin/outreach/:id/disclosure — everything we hold about this business, as text.
//
// A subject access response. Viewer+ can read it, because reading what we already hold is not a
// change; it is the answering that a person does. Plain text, because it gets pasted into a reply.
export async function getAdminOutreachDisclosure(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "outreach", "view"))) return;
  const id = outreachId(req, res);
  if (id === null) return;
  try {
    const [business, notes] = await Promise.all([getOutreach(id), listOutreachNotes(id)]);
    if (!business) return res.status(404).json({ error: "Unknown business" });
    return res.status(200).json({ text: buildDisclosure(business, notes, new Date()) });
  } catch (err) {
    console.error("outreach disclosure failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin is temporarily unavailable" });
  }
}

// POST /api/admin/outreach/:id/ctps — record that the number was checked against the TPS register.
//
// Editor+, because it is an assertion a named person is making. Calling a business on the
// Corporate TPS register is an offence, and bulk screening needs a paid licence we are not buying
// at this volume, so this is the honest control: the number stays hidden until somebody says they
// have checked, and their name and the date are kept.
export async function postAdminOutreachCtps(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "outreach", "edit");
  if (!claims) return;
  const id = outreachId(req, res);
  if (id === null) return;
  try {
    const business = await getOutreach(id);
    if (!business) return res.status(404).json({ error: "Unknown business" });
    await markCtpsChecked(id, claims.email);
    await recordAudit({
      actor: claims.email,
      action: "outreach.tps_checked",
      entity: "business_outreach",
      entityId: id,
      data: { businessName: business.businessName },
    });
    return res.status(200).json({ checked: true });
  } catch (err) {
    console.error("outreach ctps failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin is temporarily unavailable" });
  }
}

adminRouter.get("/api/admin/outreach/:id", getAdminOutreachOne);
adminRouter.get("/api/admin/outreach/:id/disclosure", getAdminOutreachDisclosure);
adminRouter.post("/api/admin/outreach/:id/ctps", postAdminOutreachCtps);
adminRouter.get("/api/admin/outreach/:id/donors", getAdminOutreachDonors);
adminRouter.post("/api/admin/outreach/:id/outcome", postAdminOutreachOutcome);
adminRouter.post("/api/admin/outreach/:id/notes", postAdminOutreachNote);
adminRouter.post("/api/admin/outreach/:id/send", postAdminOutreachSend);
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
    // TASK-311: archived stories are hidden unless asked for by name.
    const view = parseArchiveView(req.query.view);
    return res.status(200).json({ results: await listStories({ status, useScope, view }) });
  } catch (err) {
    console.error("admin stories list failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin is temporarily unavailable" });
  }
}

// TASK-311: archiving replaced deleting as the everyday action on the two public-form pages.
//
// Three stories were permanently deleted from production and nothing could say what had gone, when
// or why. Archiving is reversible and instant; erasure is not, so it now has to be deliberate:
// the record must already be archived, and a reason must be given.
//
// Erasure stays possible on purpose. A charity must be able to honour a GDPR erasure request, and
// the Stories page exists partly to withdraw a story if consent is revoked. What changes is that it
// is no longer the button somebody reaches for by accident.
export async function archiveAdminStory(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "stories", "edit"))) return;
  const id = storyId(req, res);
  if (id === null) return;
  return res.status(200).json({ archived: await archiveStory(id) });
}

export async function restoreAdminStory(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "stories", "edit"))) return;
  const id = storyId(req, res);
  if (id === null) return;
  return res.status(200).json({ restored: await restoreStory(id) });
}

export async function archiveAdminContact(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "contact", "edit"))) return;
  const id = contactId(req, res);
  if (id === null) return;
  return res.status(200).json({ archived: await archiveEnquiry(id) });
}

export async function restoreAdminContact(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "contact", "edit"))) return;
  const id = contactId(req, res);
  if (id === null) return;
  return res.status(200).json({ restored: await restoreEnquiry(id) });
}

// GET /api/admin/erasures - what has been permanently erased, and why. Carries no personal data by
// design: kind, id, when, who, reason. Nothing that would make the erasure a pretence.
export async function getAdminErasures(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "stories", "view"))) return;
  try {
    return res.status(200).json({ results: await listErasures() });
  } catch (err) {
    console.error("erasure log read failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin is temporarily unavailable" });
  }
}

// GET /api/admin/diagnostics/stories - TASK-308. Read-only: where the My Story data actually is.
//
// The Stories tab showed the EMPTY state, not the error state, which means the query reached a
// database and found a stories table with no rows in it. That is what a freshly-bootstrapped
// database looks like, so the question worth answering is whether another database on the same
// server still holds the submissions. Sizes answer that without exposing a single story.
//
// Admin-level (stories:edit), never Viewer: it reports the database names on the server.
export async function getAdminStoriesDiagnostics(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "stories", "edit"))) return;
  try {
    return res.status(200).json(await readStoriesDiagnostics());
  } catch (err) {
    console.error("stories diagnostics failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Diagnostics unavailable" });
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
// TASK-311: permanent erasure, and deliberately harder than it was.
//
// Three stories were erased from production and nothing could say what had gone, when or why. Two
// gates now stand in front of it: the record must ALREADY be archived (so the everyday tidy-up
// action cannot reach this by accident), and a reason must be given. A tombstone is written to
// erasure_log BEFORE the row is destroyed - if the process dies between the two, a record of an
// erasure that did not happen is noticed and corrected, whereas an erasure with no record is exactly
// the silence this exists to prevent.
//
// Erasure itself stays available on purpose: a charity must be able to honour a GDPR erasure
// request, and this page exists partly to withdraw a story if consent is revoked.
export async function deleteAdminStory(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "stories", "edit");
  if (!claims) return;
  const id = storyId(req, res);
  if (id == null) return;
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  if (!reason) {
    return res.status(400).json({ error: "A reason is required to erase a story permanently." });
  }
  try {
    const story = await getStory(id);
    if (!story) return res.status(404).json({ error: "Story not found" });
    if (!(story as { archived_at?: string | null }).archived_at) {
      return res.status(409).json({ error: "Archive the story first. Erasing is permanent." });
    }
    await recordErasure({ recordKind: "story", recordId: id, erasedBy: claims.email, reason });
    const deleted = await deleteStory(id);
    if (!deleted) return res.status(404).json({ error: "Story not found" });
    return res.status(200).json({ deleted: true, id });
  } catch (err) {
    console.error("admin story delete failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin delete is temporarily unavailable" });
  }
}

adminRouter.get("/api/admin/stories", getAdminStories);
adminRouter.post("/api/admin/stories/:id/archive", archiveAdminStory);
adminRouter.post("/api/admin/stories/:id/restore", restoreAdminStory);
adminRouter.post("/api/admin/contact/:id/archive", archiveAdminContact);
adminRouter.post("/api/admin/contact/:id/restore", restoreAdminContact);
adminRouter.get("/api/admin/erasures", getAdminErasures);
adminRouter.get("/api/admin/diagnostics/stories", getAdminStoriesDiagnostics);
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

// TASK-311: same two gates as a story erasure, for the same reason - a message from a real person
// should not be destroyed by a stray click, and what was destroyed should remain knowable.
export async function deleteAdminContact(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "contact", "edit");
  if (!claims) return;
  const id = contactId(req, res);
  if (id == null) return;
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  if (!reason) {
    return res.status(400).json({ error: "A reason is required to erase a message permanently." });
  }
  try {
    const enquiry = await getEnquiry(id);
    if (!enquiry) return res.status(404).json({ error: "Enquiry not found" });
    if (!(enquiry as { archived_at?: string | null }).archived_at) {
      return res.status(409).json({ error: "Archive the message first. Erasing is permanent." });
    }
    await recordErasure({ recordKind: "contact_enquiry", recordId: id, erasedBy: claims.email, reason });
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

// --- Saved newsletter templates (TASK-249) -------------------------------------------------------
// Its own path, NOT /api/admin/newsletters/templates — that would be captured by the /newsletters/:id
// route below and 400 as an invalid id.
// TASK-259: audiences. Own path for the same :id-capture reason as templates.
adminRouter.get("/api/admin/subscriber-lists", getAdminSubscriberLists);
adminRouter.post("/api/admin/subscriber-lists", postAdminSubscriberList);
// TASK-270: archived audiences. The literal path is declared BEFORE the :id routes so it is not
// captured as an id (the same ordering reason as the templates routes above).
adminRouter.get("/api/admin/subscriber-lists/archived", getAdminArchivedSubscriberLists);
// TASK-272: blocked addresses (hard bounces + spam complaints), visible and liftable.
adminRouter.post("/api/admin/newsletters/preflight", postAdminNewsletterPreflight);
adminRouter.get("/api/admin/newsletters/suppressions", getAdminSuppressions);
// TASK-274: background send job — live progress, pause/resume/cancel, and who it reached.
// A literal path, so it must be registered BEFORE /:id/... or "send-jobs" is captured as an id.
adminRouter.get("/api/admin/newsletters/send-jobs/inflight", getAdminNewsletterInflight);
adminRouter.get("/api/admin/newsletters/:id/send-job", getAdminNewsletterSendJob);
adminRouter.get("/api/admin/newsletters/:id/send-job/recipients", getAdminNewsletterSendRecipients);
adminRouter.post("/api/admin/newsletters/:id/send-job/:action", postAdminNewsletterSendJobAction);
adminRouter.post("/api/admin/newsletters/suppressions/lift", postAdminSuppressionLift);
adminRouter.post("/api/admin/subscriber-lists/:id/restore", postAdminSubscriberListRestore);
adminRouter.delete("/api/admin/subscriber-lists/:id", deleteAdminSubscriberList);
adminRouter.post("/api/admin/subscriber-lists/:id/import/preview", postAdminListImportPreview);
adminRouter.post("/api/admin/subscriber-lists/:id/import", postAdminListImport);
adminRouter.get("/api/admin/subscriber-lists/:id/members", getAdminListMembers);
adminRouter.post("/api/admin/subscriber-lists/:id/members", postAdminListMember);
adminRouter.delete("/api/admin/subscriber-lists/:id/members/:memberId", deleteAdminListMember);
adminRouter.post("/api/admin/subscriber-lists/:id/visibility", postAdminListVisibility);
// TASK-282: multi-audience writes. They carry a set of list ids in the BODY, so they cannot live
// under /subscriber-lists/:id — there is no single id to put in the path. The single-list routes
// above are unchanged and still serve anything aimed at one audience.
adminRouter.post("/api/admin/subscriber-list-members", postAdminListMembersMulti);
adminRouter.post("/api/admin/subscriber-list-import/preview", postAdminListImportPreviewMulti);
adminRouter.post("/api/admin/subscriber-list-import", postAdminListImportMulti);
adminRouter.get("/api/admin/newsletter-templates", getAdminNewsletterTemplates);
adminRouter.post("/api/admin/newsletter-templates", postAdminNewsletterTemplate);
adminRouter.get("/api/admin/newsletter-templates/:id", getAdminNewsletterTemplate);
adminRouter.delete("/api/admin/newsletter-templates/:id", deleteAdminNewsletterTemplate);

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
// Literal-suffix route: registered BEFORE the bare /:id (same hazard note as the block above).
adminRouter.get("/api/admin/newsletters/:id/stats", getAdminNewsletterStats);
adminRouter.get("/api/admin/newsletters/:id", getAdminNewsletter);
adminRouter.post("/api/admin/newsletters", postAdminNewsletter);
adminRouter.put("/api/admin/newsletters/:id", putAdminNewsletter);
adminRouter.post("/api/admin/newsletters/:id/send", postAdminSendNewsletter);
// TASK-252: a draft is deleted; a SENT newsletter is redacted (content + bounced addresses cleared,
// audit stub kept). Admin only — sending is admin-only, so unsending's paper trail is too.
adminRouter.delete("/api/admin/newsletters/:id", deleteAdminNewsletter);
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
// most recent first. Needs business-supporters:edit (TASK-406) - it used to ride on
// donations:edit, which meant anyone who could correct a donation could also work through
// somebody's perks and read the address their certificate is posted to.
export async function getAdminFulfilments(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "business-supporters", "edit"))) return;
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

// POST /api/admin/fulfilments/:id/mark — set one fulfilment status flag true.
// Needs business-supporters:edit (TASK-406). Audited + transactional. An unknown flag → 400; an
// unknown record id → 404. Returns the updated record.
export async function postAdminMarkFulfilment(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "business-supporters", "edit");
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
  // business-supporters:edit (TASK-406): it lives on that tab and it puts email in inboxes.
  const claims = await authorizeSection(req, res, "business-supporters", "edit");
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

// --- Festive Ball (TASK-313) --------------------------------------------------
//
// The controls that let staff launch and run the ball without a developer: the gate toggle,
// capacity, held-back seats, the sales window, and the details the venue had not confirmed
// when the page was written. There is deliberately no ticket price here — see
// src/ball/settings.ts.

// GET /api/admin/ball — settings, live availability and the money so far. Viewer+.
export async function getAdminBall(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "ball", "view"))) return;
  try {
    const [settings, state, dashboard] = await Promise.all([
      getBallSettings(),
      getCapacityState(),
      getDashboard(),
    ]);
    return res.status(200).json({
      settings,
      gateOpen: isGateOpen(settings, new Date()),
      availability: availability(state),
      dashboard,
    });
  } catch (err) {
    console.error("admin ball read failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin is temporarily unavailable" });
  }
}

// PATCH /api/admin/ball — change any subset of the settings. Editor+ WITH the ball section
// granted: the default editor role gets view only, because flipping the gate publishes the
// page and puts the ball on the home page.
export async function patchAdminBall(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "ball", "edit");
  if (!claims) return;
  const parsed = ballSettingsUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid settings", details: parsed.error.flatten() });
  }
  try {
    // Swap the plaintext password for its hash BEFORE anything else sees the object. Everything
    // downstream — the SQL, the audit row, the response — only ever handles the hash, so there
    // is no path by which the password could be written down (golden rule 4).
    const { previewPassword, ...rest } = parsed.data;
    const write = previewPassword
      ? { ...rest, previewPasswordHash: await hashPassword(previewPassword) }
      : rest;

    const settings = await updateBallSettings(write, actorOf(claims));
    return res.status(200).json({
      settings,
      gateOpen: isGateOpen(settings, new Date()),
      passwordChanged: Boolean(previewPassword),
    });
  } catch (err) {
    console.error("admin ball update failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin is temporarily unavailable" });
  }
}

// GET /api/admin/ball/bookings — who bought what, newest first. Viewer+.
export async function getAdminBallBookings(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "ball", "view"))) return;
  const limit = Number(req.query.limit ?? 200);
  const offset = Number(req.query.offset ?? 0);
  try {
    const [results, abandoned] = await Promise.all([
      listBookings(
        Number.isFinite(limit) ? limit : 200,
        Number.isFinite(offset) ? offset : 0,
      ),
      listAbandonedBookings(),
    ]);
    // The rows AND the count. NBCC wanted to see who had tried, without those attempts sitting
    // in the same table as people who actually bought — so they travel together and the admin
    // puts them behind a fold.
    return res.status(200).json({
      results,
      abandoned: abandoned.length,
      abandonedRows: abandoned,
    });
  } catch (err) {
    console.error("admin ball bookings failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin is temporarily unavailable" });
  }
}

// POST /api/admin/ball/bookings/:reference/cancel — release a booking's seats. Editor+ WITH
// the ball section granted, the same bar as changing capacity: this hands seats back to the
// public pool and, near a sell-out, decides who gets them.
//
// It does NOT refund. Money moves in Stripe, by a person, deliberately.
export async function postAdminBallCancelBooking(
  req: Request,
  res: Response,
): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "ball", "edit");
  if (!claims) return;
  const reference = String(req.params.reference ?? "").trim();
  if (!reference) return res.status(400).json({ error: "Which booking?" });
  const rawNote = typeof req.body?.note === "string" ? req.body.note.trim() : "";
  const note = rawNote.length > 0 ? rawNote.slice(0, 500) : null;
  try {
    const outcome = await cancelBooking(reference, claims.email, note);
    if (!outcome.ok) {
      return outcome.reason === "not_found"
        ? res.status(404).json({ error: "No booking with that reference." })
        : res.status(409).json({
            error: `That booking is already ${outcome.status}, so there are no seats to give back.`,
          });
    }
    return res.status(200).json({ cancelled: reference, seatsReturned: outcome.seats });
  } catch (err) {
    console.error("admin ball cancel failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin is temporarily unavailable" });
  }
}

// GET /api/admin/ball/holds — what is currently held back and for whom. Viewer+.
export async function getAdminBallHolds(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "ball", "view"))) return;
  try {
    return res.status(200).json({ results: await listActiveHolds() });
  } catch (err) {
    console.error("admin ball holds failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin is temporarily unavailable" });
  }
}

// POST /api/admin/ball/holds — take seats or tables off sale for a named party. Editor+ WITH
// the ball section: this consumes capacity exactly as a purchase does.
export async function postAdminBallHold(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "ball", "edit");
  if (!claims) return;
  const parsed = holdCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Check the hold", details: parsed.error.issues });
  }
  const h = parsed.data;
  try {
    const outcome = await createHold(
      { ...h, seats: seatsForHold(h.kind, h.quantity) },
      claims.email,
    );
    if (!outcome.ok) {
      return res.status(409).json({ error: "There are not enough seats left to hold that many." });
    }
    return res.status(201).json({ id: outcome.id, seats: seatsForHold(h.kind, h.quantity) });
  } catch (err) {
    console.error("admin ball hold create failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin is temporarily unavailable" });
  }
}

// DELETE /api/admin/ball/holds/:id — hand the seats back early. Editor+ WITH the ball section.
export async function deleteAdminBallHold(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "ball", "edit");
  if (!claims) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "Which hold?" });
  try {
    const outcome = await releaseHold(id, claims.email);
    if (!outcome.ok) {
      return outcome.reason === "not_found"
        ? res.status(404).json({ error: "No such hold." })
        : res.status(409).json({ error: "Those seats have already been released." });
    }
    return res.status(200).json({ released: id, seatsReturned: outcome.seats });
  } catch (err) {
    console.error("admin ball hold release failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin is temporarily unavailable" });
  }
}

adminRouter.get("/api/admin/ball", getAdminBall);
adminRouter.patch("/api/admin/ball", patchAdminBall);
// GET /api/admin/ball/guest-progress — who still owes us their guests, and how far off a
// complete catering list is. Viewer+, the same bar as the bookings list it sits beside.
//
// The chase list carries each buyer's own guest link so staff can resend it, rather than asking
// someone to find a confirmation email from weeks ago. That link is a bearer token for one
// booking's guest details, which is why this is behind the admin session like everything else
// here and why it is never logged.
export async function getAdminBallGuestProgress(
  req: Request,
  res: Response,
): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "ball", "view"))) return;
  try {
    const rows = await listGuestProgress();
    return res.status(200).json({
      summary: summariseGuestProgress(rows),
      outstanding: outstandingBookings(rows).map((b) => ({
        ...b,
        guestLink: guestLinkFor(b, config.BALL_BASE_URL),
      })),
    });
  } catch (err) {
    console.error("admin ball guest progress failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin is temporarily unavailable" });
  }
}

adminRouter.get("/api/admin/ball/bookings", getAdminBallBookings);
adminRouter.get("/api/admin/ball/guest-progress", getAdminBallGuestProgress);

// POST /api/admin/ball/chase — email everyone whose guest details are still outstanding, now.
//
// Editor+, not Viewer: it sends real email to real buyers. It runs the same pass the daily task
// runs, so a booking already chased today is skipped rather than emailed twice — pressing this
// button twice is safe, which is the property that matters for something staff will press when
// they are not sure whether it worked the first time.
export async function postAdminBallChase(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "ball", "edit"))) return;
  try {
    const { runBallRunUp } = await import("../ball/run-up-runner");
    const result = await runBallRunUp();
    return res.status(200).json(result);
  } catch (err) {
    console.error("ball chase failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Could not send the chase emails" });
  }
}

adminRouter.post("/api/admin/ball/chase", postAdminBallChase);
adminRouter.post("/api/admin/ball/bookings/:reference/cancel", postAdminBallCancelBooking);
adminRouter.get("/api/admin/ball/holds", getAdminBallHolds);
adminRouter.post("/api/admin/ball/holds", postAdminBallHold);
adminRouter.delete("/api/admin/ball/holds/:id", deleteAdminBallHold);

// The three lists (TASK-313 plan 5). Viewer+ can read them; they are downloads of data the
// section already shows on screen.
//
// Each purges expired guest rows first. That keeps the ninety-day promise in the ticket terms
// without a scheduler to forget to run — the deletion happens on the path that would otherwise
// be the one place stale data escapes into a file.
function csvResponse(res: Response, filename: string, body: string): Response {
  return res
    .status(200)
    .type("text/csv")
    .set("Content-Disposition", `attachment; filename="${filename}"`)
    .send(body);
}

export async function getAdminBallDoorList(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "ball", "view"))) return;
  try {
    await purgeExpiredGuests();
    return csvResponse(res, "festive-ball-door-list.csv", doorListCsv(await listGuestsForExport()));
  } catch (err) {
    console.error("ball door list failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin is temporarily unavailable" });
  }
}

// For the venue. Contains ONLY what they need to cater and seat people — the filtering that
// keeps that promise lives in cateringCsv, which is unit-tested for exactly this.
export async function getAdminBallCatering(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "ball", "view"))) return;
  try {
    await purgeExpiredGuests();
    return csvResponse(res, "festive-ball-catering.csv", cateringCsv(await listGuestsForExport()));
  } catch (err) {
    console.error("ball catering list failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin is temporarily unavailable" });
  }
}

export async function getAdminBallBookingsCsv(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "ball", "view"))) return;
  try {
    return csvResponse(res, "festive-ball-bookings.csv", bookingsCsv(await listBookingsForExport()));
  } catch (err) {
    console.error("ball bookings export failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin is temporarily unavailable" });
  }
}

adminRouter.get("/api/admin/ball/door-list.csv", getAdminBallDoorList);
adminRouter.get("/api/admin/ball/catering.csv", getAdminBallCatering);
adminRouter.get("/api/admin/ball/bookings.csv", getAdminBallBookingsCsv);

// POST /api/admin/ball/reminders — send the "a week to go" email to everyone who has paid and
// has not had it. Editor+ WITH the ball section granted, like the other writes here.
//
// Staff-triggered rather than scheduled: this app has no scheduler, and a cron misfiring at 3am
// against a guest list is a worse failure than a button someone has to press. Idempotency lives
// in the query (reminder_sent_at IS NULL) and each booking is STAMPED AS IT SENDS, so a provider
// failure halfway through four hundred never re-emails the ones already done.
export async function postAdminBallReminders(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "ball", "edit");
  if (!claims) return;
  try {
    const [targets, settings] = await Promise.all([
      listBookingsNeedingReminder(),
      getBallSettings(),
    ]);
    const base = config.BALL_BASE_URL.replace(/\/+$/, "");

    let sent = 0;
    const failed: string[] = [];
    for (const t of targets) {
      const mail = buildBallReminderEmail(
        { reference: t.reference, buyerName: t.buyerName, seats: t.seats, tableName: t.tableName },
        t.guests,
        {
          arrivalTime: settings.arrivalTime,
          includedNote: settings.includedNote,
          guestLink: t.guestToken ? `${base}/ball/guests/${t.guestToken}` : null,
        },
      );
      try {
        await sendBallReminder({
          email: t.buyerEmail,
          from: config.BALL_FROM_EMAIL,
          replyTo: config.BALL_FROM_EMAIL,
          subject: mail.subject,
          html: mail.html,
          text: mail.text,
        });
        await markReminderSent(t.id);
        sent += 1;
      } catch {
        // Not stamped, so this one is picked up next time. Recorded rather than thrown: one bad
        // address must not stop the other 399 people getting their reminder.
        failed.push(t.reference);
      }
    }
    await recordAudit({
      actor: actorOf(claims),
      action: "ball.reminders_sent",
      entity: "ball_bookings",
      entityId: null,
      data: { sent, failed: failed.length },
    });
    return res.status(200).json({ sent, failed });
  } catch (err) {
    console.error("ball reminders failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin is temporarily unavailable" });
  }
}

adminRouter.post("/api/admin/ball/reminders", postAdminBallReminders);

// GET /api/admin/ball/waiting-list — who is waiting, oldest first. Viewer+.
export async function getAdminBallWaitingList(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "ball", "view"))) return;
  try {
    return res.status(200).json({ results: await listWaitingList() });
  } catch (err) {
    console.error("ball waiting list read failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin is temporarily unavailable" });
  }
}

adminRouter.get("/api/admin/ball/waiting-list", getAdminBallWaitingList);
