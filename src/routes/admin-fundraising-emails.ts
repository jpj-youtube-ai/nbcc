import { Router, type Request, type Response } from "express";
import { authorizeSection } from "./admin-authz";
import { config } from "../config";
import { listWordingApprovals } from "../db/fundraising-touch";
import {
  CATALOGUE,
  CATALOGUE_GROUPS,
  emailState,
  findEmail,
  findVersion,
  renderVersion,
  type CatalogueEmail,
  type CatalogueVersion,
} from "../email/catalogue";

// All emails, in Admin > Fundraising: every email the fundraising, pledge, ticket and Festive Ball
// code can send, read from the one catalogue (src/email/catalogue.ts). Section "fundraising", view:
// anyone who can see Fundraising can read them.
//
//   GET /api/admin/fundraising/emails                 the list: groups, each email's name, subject,
//                                                     who gets it and when, its versions and where
//                                                     its sign off is up to. No HTML.              view
//   GET /api/admin/fundraising/emails/:id/:version    one version, rendered with the real builder
//                                                     and invented sample data                     view
//
// Nothing here approves or withdraws. A gated version carries the path of the endpoint that already
// does that (the automatic emails', the pledge emails' or the invite wording's: admins only, each
// with its own History action), so no gate is added, moved or changed by this file.
// Request and response shapes: README.md, "Community fundraising", All emails.

export const adminFundraisingEmailsRouter = Router();

type Approvals = Record<string, { approvedAt: string; approvedBy: string }>;

const base = () => config.PORTAL_BASE_URL.replace(/\/+$/, "");

// The approvals; when they cannot be read, none (so gated wording reads as waiting, as the senders
// treat it) and the card says so, rather than failing whole.
async function readApprovals(): Promise<{ map: Approvals; unavailable: boolean }> {
  try {
    const list = await listWordingApprovals();
    return { map: Object.fromEntries(list.map((a) => [a.key, { approvedAt: a.approvedAt, approvedBy: a.approvedBy }])), unavailable: false };
  } catch (err) {
    console.error("admin all emails: could not read the approved wordings:", err instanceof Error ? err.message : err);
    return { map: {}, unavailable: true };
  }
}

function approvalOf(v: CatalogueVersion, map: Approvals) {
  if (!v.approval) return null;
  const a = Object.prototype.hasOwnProperty.call(map, v.approval.key) ? map[v.approval.key] : null;
  return { key: v.approval.key, path: v.approval.path, approvedAt: a ? a.approvedAt : null, approvedBy: a ? a.approvedBy : null };
}

// The subject on the row is the usual version's. A builder that throws costs that row its subject,
// never the list.
function subjectOf(e: CatalogueEmail): string | null {
  try {
    return renderVersion(e, e.versions[0], base()).subject;
  } catch (err) {
    console.error(`admin all emails: ${e.id} could not be built:`, err instanceof Error ? err.message : err);
    return null;
  }
}

export async function getEmails(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "fundraising", "view"))) return;
  const read = await readApprovals();
  const approved = new Set(Object.keys(read.map));
  let waiting = 0;
  const groups = CATALOGUE_GROUPS.map((g) => ({
    id: g.id,
    name: g.name,
    emails: CATALOGUE.filter((e) => e.group === g.id).map((e) => {
      const s = emailState(e, approved);
      if (s.state === "waiting") waiting += 1;
      return {
        id: e.id,
        name: e.name,
        subject: subjectOf(e),
        who: e.who,
        audience: e.audience,
        note: e.note ?? null,
        touchKind: e.touchKind ?? null,
        state: s.state,
        waitingVersion: s.waitingVersion,
        versions: e.versions.map((v) => ({ id: v.id, label: v.label, approval: approvalOf(v, read.map) })),
      };
    }),
  }));
  return res.status(200).json({ count: CATALOGUE.length, waiting, approvalsUnavailable: read.unavailable, groups });
}

export async function getEmail(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "fundraising", "view"))) return;
  const email = findEmail(req.params.id);
  const version = email ? findVersion(email, req.params.version) : null;
  if (!email || !version) return res.status(404).json({ error: "There is no email of that name" });
  let mail: { subject: string; html: string };
  try {
    mail = renderVersion(email, version, base());
  } catch (err) {
    console.error(`admin all emails: ${email.id}/${version.id} could not be built:`, err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "That email could not be shown just now. The others are not affected." });
  }
  const read = version.approval ? await readApprovals() : { map: {}, unavailable: false };
  return res.status(200).json({
    id: email.id,
    version: version.id,
    label: version.label,
    approval: approvalOf(version, read.map),
    approvalsUnavailable: read.unavailable,
    ...mail,
  });
}

adminFundraisingEmailsRouter.get("/api/admin/fundraising/emails", getEmails);
adminFundraisingEmailsRouter.get("/api/admin/fundraising/emails/:id/:version", getEmail);
