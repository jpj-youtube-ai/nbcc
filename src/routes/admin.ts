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
import { listClaimableDonationsForExport, assignDonationToBatch, BatchAssignmentError } from "../db/donations";
import { toCharitiesOnlineCsv } from "../claims/charities-online";
import { verifyPassword } from "../admin/password";
import { signAdminSession, verifyAdminSession, type AdminSessionClaims } from "../admin/session";
import { getDonorPortalSnapshot, updateDonorPortal, getActiveDeclarationForDonor } from "../db/portal";
import { cancelSubscription } from "../clients/stripe";
import { DeclarationCancellationError, reviseDeclaration } from "../db/declarations";
import { declarationFieldsSchema } from "../declarations/fields";
import { getGasdsPoolReport } from "../gasds/pool";
import {
  listNewsletters,
  getNewsletter,
  createNewsletter,
  updateNewsletterDraft,
  listNewsletterRecipients,
  claimNewsletterForSend,
  setNewsletterRecipientCount,
} from "../db/newsletters";
import { signUnsubscribeToken } from "../donors/unsubscribe-token";
import { buildNewsletterHtml } from "../donors/newsletter";
import { sendNewsletter } from "../clients/email";
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
});

export async function postAdminLogin(req: Request, res: Response): Promise<Response> {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid login request", details: parsed.error.flatten() });
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
  } catch (err) {
    // The message is safe to log; no secret or password is included.
    console.error("admin login failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Login is temporarily unavailable" });
  }
}

adminRouter.post("/api/admin/login", postAdminLogin);

// --- Role-gated admin actions on a donor's behalf (REQ-062 · TASK-106) --------------------------
// These mirror the self-serve donor-portal routes (src/routes/portal.ts) but are authorised by the
// admin session token instead of a magic-link token, and act on a donor by id. Authorisation is the
// authOrReject-style helper below (mirroring portal.ts): a missing/invalid token is 401, and the
// role rank gates writes — Viewer is read-only (403 on any PATCH/POST), Editor and Admin may write.
// Every write reuses the existing audited helpers (updateDonorPortal / adminCancelGiftAid /
// recordAdminSubscriptionCancellation), so its audit_log row commits in the same transaction.

const ROLE_RANK: Record<string, number> = { viewer: 1, editor: 2, admin: 3 };

function bearerToken(req: Request): string | null {
  const header = req.headers?.authorization ?? "";
  const match = /^Bearer (.+)$/i.exec(header);
  return match ? match[1] : null;
}

// Verify the admin session token and enforce the minimum role. On failure it sends the 401/403
// response and returns null; on success it returns the session claims (mirrors portal's authOrReject).
function authorizeAdmin(req: Request, res: Response, minRole: string): AdminSessionClaims | null {
  const token = bearerToken(req);
  if (!token) {
    res.status(401).json({ error: "Missing admin session token" });
    return null;
  }
  let claims: AdminSessionClaims;
  try {
    claims = verifyAdminSession(token, config.ADMIN_SESSION_SECRET, new Date());
  } catch {
    res.status(401).json({ error: "Invalid or expired admin session" });
    return null;
  }
  if ((ROLE_RANK[claims.role] ?? 0) < (ROLE_RANK[minRole] ?? 0)) {
    res.status(403).json({ error: "Your role does not permit this action" });
    return null;
  }
  return claims;
}

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
const actorOf = (claims: AdminSessionClaims): string => `admin:${claims.email}`;

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

const newsletterBodySchema = z.object({
  subject: z.string().min(1),
  bodyHtml: z.string().min(1),
});

// GET /api/admin/newsletters — list summaries (Editor+; read-only but the tab is a staff tool).
export async function getAdminNewsletters(req: Request, res: Response): Promise<Response | void> {
  if (!authorizeAdmin(req, res, "editor")) return;
  return res.json(await listNewsletters());
}

// GET /api/admin/newsletters/:id — one newsletter incl. body_html (Editor+).
export async function getAdminNewsletter(req: Request, res: Response): Promise<Response | void> {
  if (!authorizeAdmin(req, res, "editor")) return;
  const id = newsletterId(req, res);
  if (id === null) return;
  const row = await getNewsletter(id);
  if (!row) return res.status(404).json({ error: "Newsletter not found" });
  return res.json(row);
}

// POST /api/admin/newsletters — create a new draft (Editor+).
export async function postAdminNewsletter(req: Request, res: Response): Promise<Response | void> {
  if (!authorizeAdmin(req, res, "editor")) return;
  const parsed = newsletterBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid newsletter", details: parsed.error.flatten() });
  }
  const created = await createNewsletter(parsed.data.subject, parsed.data.bodyHtml);
  return res.status(201).json(created);
}

// PUT /api/admin/newsletters/:id — edit a draft (Editor+). A sent newsletter is immutable → 409.
export async function putAdminNewsletter(req: Request, res: Response): Promise<Response | void> {
  if (!authorizeAdmin(req, res, "editor")) return;
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
  const updated = await updateNewsletterDraft(id, parsed.data.subject, parsed.data.bodyHtml);
  if (!updated) return res.status(409).json({ error: "A sent newsletter cannot be edited" });
  return res.json(updated);
}

// POST /api/admin/newsletters/:id/send — Admin only. Sends one email per consenting donor, each with
// an unsubscribe link, then marks the newsletter sent. Idempotent: an already-sent newsletter → 409.
export async function postAdminSendNewsletter(req: Request, res: Response): Promise<Response | void> {
  const claims = authorizeAdmin(req, res, "admin");
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
  for (const r of recipients) {
    const token = signUnsubscribeToken(r.donorId, config.ADMIN_SESSION_SECRET);
    const unsubscribeUrl = `${config.PORTAL_BASE_URL}/unsubscribe/${token}`;
    const html = buildNewsletterHtml(newsletter.bodyHtml, unsubscribeUrl);
    try {
      await sendNewsletter({
        email: r.email,
        from: config.NEWSLETTER_FROM_EMAIL,
        replyTo: config.NEWSLETTER_FROM_EMAIL,
        subject: newsletter.subject,
        html,
      });
    } catch (err) {
      // Best-effort: a single failed send is logged, not fatal to the batch.
      console.error(`newsletter send to ${r.email} failed`, err);
    }
  }

  await setNewsletterRecipientCount(id, recipients.length);
  return res.json({ status: "sent", recipientCount: recipients.length });
}

// GET /api/admin/donors/:id — the donor snapshot (reuses getDonorPortalSnapshot). Read-only, so any
// authenticated role (Viewer and up) may call it.
export async function getAdminDonor(req: Request, res: Response): Promise<Response | void> {
  if (!authorizeAdmin(req, res, "viewer")) return;
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
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: "no fields to update" });

// PATCH /api/admin/donors/:id — update the donor's editable fields (reuses updateDonorPortal, which
// appends a `donor.updated` audit row in the same transaction). Editor/Admin only.
export async function patchAdminDonor(req: Request, res: Response): Promise<Response | void> {
  const claims = authorizeAdmin(req, res, "editor");
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
  const claims = authorizeAdmin(req, res, "editor");
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
  const claims = authorizeAdmin(req, res, "editor");
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
  const claims = authorizeAdmin(req, res, "editor");
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
  if (!authorizeAdmin(req, res, "viewer")) return;
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
  if (!authorizeAdmin(req, res, "viewer")) return;
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
  if (!authorizeAdmin(req, res, "viewer")) return;
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
  const claims = authorizeAdmin(req, res, "editor");
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
  if (!authorizeAdmin(req, res, "viewer")) return;
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
  const claims = authorizeAdmin(req, res, "editor");
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
  if (!authorizeAdmin(req, res, "viewer")) return;
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
  const claims = authorizeAdmin(req, res, "editor");
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
  if (!authorizeAdmin(req, res, "viewer")) return;
  try {
    return res.status(200).json({ results: await listRetentionExpiryDeclarations() });
  } catch (err) {
    console.error("admin retention-expiry queue failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin is temporarily unavailable" });
  }
}

export async function getAdminAwaitingDeclaration(req: Request, res: Response): Promise<Response | void> {
  if (!authorizeAdmin(req, res, "viewer")) return;
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
  if (!authorizeAdmin(req, res, "viewer")) return;
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
  if (!authorizeAdmin(req, res, "viewer")) return;
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
  const claims = authorizeAdmin(req, res, "editor");
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
  if (!authorizeAdmin(req, res, "viewer")) return;
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
  if (!authorizeAdmin(req, res, "viewer")) return;
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
  if (!authorizeAdmin(req, res, "viewer")) return;
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
  if (!authorizeAdmin(req, res, "editor")) return;
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
  if (!authorizeAdmin(req, res, "viewer")) return;
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
  if (!authorizeAdmin(req, res, "viewer")) return;
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

// --- Admin newsletter (REQ-069 · TASK-161) -------------------------------------------------------
adminRouter.get("/api/admin/newsletters", getAdminNewsletters);
adminRouter.get("/api/admin/newsletters/:id", getAdminNewsletter);
adminRouter.post("/api/admin/newsletters", postAdminNewsletter);
adminRouter.put("/api/admin/newsletters/:id", putAdminNewsletter);
adminRouter.post("/api/admin/newsletters/:id/send", postAdminSendNewsletter);
