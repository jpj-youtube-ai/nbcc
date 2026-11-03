import type Stripe from "stripe";
import type { PoolClient } from "pg";
import { config } from "../config";
import { sendElfWelcome } from "../clients/email";
import { SINGLE_DONATION_WORDING } from "../declarations/wording";
import { expireElfOrder, settleElfOrder } from "../db/elf";
import { subscribeSelf } from "../newsletter/self-signup";
import { doorInstant } from "./calendar";
import { badgeWords, buildElfWelcomeEmail } from "./emails";
import { familyDetectiveName } from "./names";

// NBCC Elf Detective School: Stripe's events for the school's payments (wave 1 plan, Task 5).
// Called first by dispatch in src/db/stripe-webhook.ts, inside its transaction, so an entry is
// never recorded as a gift. Anything not tagged product "elf_school" is left to the other handlers
// (null). The welcome email, and joining the newsletter when the box was ticked, run after COMMIT,
// best effort, like the event tickets' confirmation. Unit tested in test/unit/elf-webhook.test.ts.

export type ElfWebhookAction = "elf-paid" | "elf-already-paid" | "elf-not-paid" | "elf-unknown" | "elf-expired";

export interface ElfWebhookResult {
  action: ElfWebhookAction;
  afterCommit?: (() => Promise<void>) | null;
}

type Querier = Pick<PoolClient, "query">;

const isElfSession = (s: { metadata?: Stripe.Metadata | null } | null | undefined): boolean => s?.metadata?.product === "elf_school";

/** When school starts: door 1's first clue, at 5:30pm London time. */
function firstClueAt(year: number): Date {
  return doorInstant({ year }, 1, "17:30") ?? new Date(Date.UTC(year, 11, 1, 17, 30));
}

export async function handleElfEvent(client: Querier, event: Stripe.Event): Promise<ElfWebhookResult | null> {
  if (event.type !== "checkout.session.completed" && event.type !== "checkout.session.expired") return null;
  const s = event.data.object as Stripe.Checkout.Session;
  if (!isElfSession(s)) return null;
  const reference = s.metadata?.reference ?? "";

  if (event.type === "checkout.session.expired") {
    if (reference) await expireElfOrder(client, reference);
    return { action: "elf-expired" };
  }

  // Card only, so a completed checkout is paid; anything else waits.
  if (s.payment_status !== "paid") return { action: "elf-not-paid" };
  const settled = await settleElfOrder(client, {
    reference,
    sessionId: s.id,
    paidAt: new Date((s.created ?? Math.floor(Date.now() / 1000)) * 1000),
    wording: SINGLE_DONATION_WORDING,
  });
  if (settled === "unknown") {
    console.error(`elf school: checkout ${s.id} has no order ${reference}`);
    return { action: "elf-unknown" };
  }
  if (settled === "already") return { action: "elf-already-paid", afterCommit: null };

  const base = config.PORTAL_BASE_URL.replace(/\/+$/, "");
  return {
    action: "elf-paid",
    afterCommit: async () => {
      const mail = buildElfWelcomeEmail({
        grownUpName: settled.grownUpName,
        detectives: settled.detectives.map((d) => ({
          name: familyDetectiveName({ firstName: d.firstName, surname: d.surname, approved: true }),
          badge: badgeWords(d.badgeNumber),
        })),
        hqUrl: `${base}/elf/hq`,
        signInUrl: `${base}/elf/sign-in`,
        firstClueAt: firstClueAt(new Date().getUTCFullYear()),
      });
      try {
        await sendElfWelcome(settled.grownUpName, {
          email: settled.email,
          from: config.BALL_FROM_EMAIL,
          replyTo: config.BALL_FROM_EMAIL,
          ...mail,
        });
      } catch (err) {
        console.error("elf school welcome email failed:", err instanceof Error ? err.message : err);
      }
      if (settled.newsletter) {
        try {
          await subscribeSelf({ name: settled.grownUpName, email: settled.email, phone: null }, "elf");
        } catch (err) {
          console.error("elf school newsletter join failed:", err instanceof Error ? err.message : err);
        }
      }
    },
  };
}
