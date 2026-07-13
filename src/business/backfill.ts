// TASK-214: the one-time, idempotent, admin-triggered catch-up backfill that emails the thank-you
// INVITE to business supporters who became supporters BEFORE the going-forward webhook auto-invite
// (TASK-213) shipped, and so never received it. It is pure orchestration over injected seams (the
// un-invited list, the send, the invited-stamp, the summary audit, plus the env-correct base + from +
// actor), so it is fully DB-free and config-free — the route wires the real implementations, the unit
// test passes plain stubs. It reuses the SAME pure branded builder the webhook uses
// (buildBusinessSupporterInviteEmail), so a backfilled invite is byte-for-byte the webhook invite.
//
// SAFETY (no double-send): every supporter is emailed at most once across all runs. The un-invited
// list is gated on invited_at IS NULL, and each supporter is stamped invited (markInvited) ONLY after
// its send SUCCEEDS — so a second run, or a re-click, finds them already invited and sends 0, while a
// supporter whose send FAILED stays invited_at NULL and is retried on the next run. Sends run
// SEQUENTIALLY (dozens of supporters at most; sequential respects the email relay's rate limits), and
// each is best-effort: one failed send is counted and never aborts the rest of the run.

import { buildBusinessSupporterInviteEmail } from "./invite-email";
import type { BusinessSupporterInviteEmail } from "../clients/email";
import type { UninvitedBusinessSupporter } from "../db/fulfilment";
import type { AuditInput } from "../db/donations";

// The run outcome. pending = how many un-invited supporters were found; sent = how many were emailed
// AND stamped invited on this run; failed = how many sends failed (left invited_at NULL, catchable on
// a later run). pending === sent + failed.
export interface BusinessInviteBackfillResult {
  pending: number;
  sent: number;
  failed: number;
}

// The injected seams. The route supplies the real implementations (listUninvitedBusinessSupporters,
// sendBusinessSupporterInvite, markFulfilmentInvited, recordAudit) plus config.PORTAL_BASE_URL /
// config.GIVING_FROM_EMAIL and the acting admin's actor label; the unit test supplies stubs.
export interface BusinessInviteBackfillDeps {
  listUninvited: () => Promise<UninvitedBusinessSupporter[]>;
  sendInvite: (message: BusinessSupporterInviteEmail) => Promise<void>;
  // Returns unknown (not void) so the real markFulfilmentInvited — which returns whether it newly
  // stamped a row — is assignable directly; the backfill ignores the return.
  markInvited: (fulfilmentId: number) => Promise<unknown>;
  recordAudit: (entry: AuditInput) => Promise<void>;
  baseUrl: string; // config.PORTAL_BASE_URL — the env-correct public base for the tokenised link
  from: string; // config.GIVING_FROM_EMAIL — the repliable From/Reply-To (verified giving inbox)
  actor: string; // the acting admin's audit actor label (admin:<email>)
}

export async function runBusinessInviteBackfill(
  deps: BusinessInviteBackfillDeps,
): Promise<BusinessInviteBackfillResult> {
  const pending = await deps.listUninvited();
  let sent = 0;
  let failed = 0;

  for (const supporter of pending) {
    try {
      // Build the branded invite on the env-correct base + this supporter's own token (byte-for-byte
      // the webhook invite), then send it repliable From/Reply-To the giving inbox.
      const invite = buildBusinessSupporterInviteEmail({
        businessName: supporter.name,
        baseUrl: deps.baseUrl,
        token: supporter.token,
      });
      await deps.sendInvite({
        email: supporter.email,
        from: deps.from,
        replyTo: deps.from,
        subject: invite.subject,
        html: invite.html,
        text: invite.text,
      });
      // Stamp invited ONLY after the send succeeded, so a failed send above (which threw) never marks
      // the supporter and the next run retries them. A mark failure here is swallowed by the catch,
      // same best-effort contract as the webhook auto-invite.
      await deps.markInvited(supporter.fulfilmentId);
      sent += 1;
    } catch {
      // Best-effort: one failed send (or stamp) is counted and must not abort the rest of the run.
      failed += 1;
    }
  }

  const result: BusinessInviteBackfillResult = { pending: pending.length, sent, failed };
  // One summary audit row for the whole run (actor = the admin who triggered it). The per-item work is
  // already done, so this is appended once at the end rather than per supporter.
  await deps.recordAudit({
    actor: deps.actor,
    action: "fulfilment.backfill_invites",
    entity: "business_supporter_fulfilment",
    entityId: null,
    data: { pending: result.pending, sent: result.sent, failed: result.failed },
  });
  return result;
}
