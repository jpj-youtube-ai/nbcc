import { pool } from "../db/pool";
import { stripe, stripeConfigured } from "../clients/stripe";
import { isUniformSession, uniformPaymentFromLinkSession } from "../uniform/model";
import { moveUniformSale, type UniformMoveOutcome } from "../db/uniform-payments";

// TASK-604: move the school uniform payments that came in before the Uniform tile out of donations.
//
// DRY RUN BY DEFAULT: says what it would do and writes nothing. Pass --apply to do it.
//   node dist/scripts/move-uniform-payments.js            (dry run)
//   node dist/scripts/move-uniform-payments.js --apply
//
// It asks Stripe for every payment link marked product = uniform, then for every paid checkout each
// link made, and hands each to moveUniformSale (src/db/uniform-payments.ts), one transaction each: a
// sale recorded as a donation is moved to uniform_payments (its whole row kept, so it can be undone),
// one already moved is left, and a donation something else depends on (a Gift Aid claim, an invoice
// ...) is left for staff, named by its donation id. It prints counts and money only, never a name or
// an email address. Safe to run again.

const money = (pence: number) => `£${(pence / 100).toFixed(2)}`;

async function main(): Promise<void> {
  if (!stripeConfigured) throw new Error("Stripe is not configured here: there is nothing to ask.");
  const apply = process.argv.includes("--apply");
  const links: string[] = [];
  for await (const link of stripe.paymentLinks.list({ limit: 100 })) {
    if (isUniformSession(link.metadata)) links.push(link.id);
  }
  const tally: Record<UniformMoveOutcome, { count: number; pence: number }> = {
    moved: { count: 0, pence: 0 },
    recorded: { count: 0, pence: 0 },
    held: { count: 0, pence: 0 },
    already_uniform: { count: 0, pence: 0 },
  };
  const heldSessions: string[] = [];
  for (const link of links) {
    for await (const s of stripe.checkout.sessions.list({ payment_link: link, limit: 100 })) {
      if (s.status !== "complete" || s.payment_status !== "paid") continue;
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const r = await moveUniformSale(client, uniformPaymentFromLinkSession(s), new Date(s.created * 1000), { apply });
        await client.query(apply ? "COMMIT" : "ROLLBACK");
        tally[r.outcome].count += 1;
        tally[r.outcome].pence += r.amountPence;
        if (r.outcome === "held") heldSessions.push(s.id);
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    }
  }
  const verb = apply ? "" : "would be ";
  console.log(apply ? "APPLIED" : "DRY RUN (nothing written; pass --apply to do it)");
  console.log(`Uniform payment links in Stripe: ${links.length}`);
  console.log(`Recorded as donations, ${verb}moved to Uniform: ${tally.moved.count} (${money(tally.moved.pence)})`);
  console.log(`Never recorded, ${verb}kept as Uniform: ${tally.recorded.count} (${money(tally.recorded.pence)})`);
  console.log(`Already under Uniform: ${tally.already_uniform.count} (${money(tally.already_uniform.pence)})`);
  console.log(`Left as donations for staff to look at (in a claim or linked): ${tally.held.count} (${money(tally.held.pence)})`);
  if (heldSessions.length) console.log(`  their checkout sessions: ${heldSessions.join(", ")}`);
}

main()
  .catch((err) => {
    console.error("move-uniform-payments failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
