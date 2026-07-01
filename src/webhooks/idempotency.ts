import type { PoolClient } from "pg";

// Webhook idempotency (REQ-036 / TASK-048): the load-bearing de-dup foundation so a
// resent Stripe event never double-creates a donation. These helpers CLAIM/record a
// Stripe event id in the webhook_events ledger and report whether it was already
// seen — the caller skips the state write when it was.
//
// They take the caller's PoolClient and issue NO BEGIN/COMMIT of their own, so they
// COMPOSE inside one transaction with TASK-045's audited write helper rather than
// duplicating transaction handling. The client comes from the pool in
// src/db/pool.ts (via writeWithAudit in src/db/donations.ts) — this module never
// opens its own connection. Intended use by the (TASK-046) webhook handler:
//
//   await writeWithAudit(async (client) => {
//     const { alreadyProcessed } = await claimWebhookEvent(client, event.id, event.type);
//     if (alreadyProcessed) return { skipped: true };      // redelivery — no-op
//     const result = await applyDonationStateWrite(client, event);
//     await markWebhookEventProcessed(client, event.id);
//     return result;
//   }, toAudit);
//
// Because the claim and the state write share the transaction, either both commit
// or both roll back — a claimed id is never left behind for a write that failed.

export interface ClaimResult {
  // true when this event id was already in the ledger (a redelivery) — the caller
  // must NOT repeat the state write.
  alreadyProcessed: boolean;
}

// Claim an event id: INSERT it, or do nothing if it is already present. The
// INSERT … ON CONFLICT DO NOTHING is atomic, so two concurrent deliveries of the
// same event race safely — exactly one gets rowCount 1 (claimed), the other 0.
export async function claimWebhookEvent(
  client: Pick<PoolClient, "query">,
  stripeEventId: string,
  type: string,
): Promise<ClaimResult> {
  const res = await client.query(
    `INSERT INTO webhook_events (stripe_event_id, type)
     VALUES ($1, $2)
     ON CONFLICT (stripe_event_id) DO NOTHING`,
    [stripeEventId, type],
  );
  return { alreadyProcessed: (res.rowCount ?? 0) === 0 };
}

// Stamp processed_at once the event's state write has been applied (still inside
// the same transaction), distinguishing a fully-processed event from one merely
// claimed. Idempotent: re-stamping an already-processed row is harmless.
export async function markWebhookEventProcessed(
  client: Pick<PoolClient, "query">,
  stripeEventId: string,
): Promise<void> {
  await client.query(`UPDATE webhook_events SET processed_at = now() WHERE stripe_event_id = $1`, [
    stripeEventId,
  ]);
}
