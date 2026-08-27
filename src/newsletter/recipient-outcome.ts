// TASK-303: what actually happened to one recipient, as opposed to what we did about them.
//
// The per-person view used to show our queue row and label it "Received". That conflated two
// different facts, and they come apart exactly when it matters most - when the provider is refusing,
// when an address is dead, or when a receiving server is holding mail back from a young domain.
//
//   what WE did           the queue row: sent it, still to send, gave up
//   what the MAILBOX said  a webhook event: delivered, bounced, complained - or nothing yet
//
// Handing a message to the mail service is not the same as it arriving. Keeping the two apart is the
// difference between "200 went out" and "95 are known to have landed, and here is the list".
//
// Pure and DB-free like the rest of src/newsletter, so the rules are unit-tested directly.

export type RecipientState =
  /** A mailbox confirmed delivery. The only state that means it genuinely arrived. */
  | "arrived"
  /** The mail came back, or was reported as spam. This address did not receive it. */
  | "bounced"
  /** We handed it over and nothing has come back yet. Common, and not a problem on its own. */
  | "sent-unconfirmed"
  /** Still in the queue; will be sent. */
  | "waiting"
  /** The send gave up on this address. Nobody should be here - see TASK-302. */
  | "given-up"
  /** Being sent right now. */
  | "sending";

export const OUTCOME_LABELS: Record<RecipientState, string> = {
  arrived: "Arrived",
  bounced: "Blocked or bounced",
  "sent-unconfirmed": "Sent, not yet confirmed",
  waiting: "Still to send",
  "given-up": "Not sent - we gave up",
  sending: "Sending now",
};

/**
 * Combine our record with the mailbox's, letting the mailbox win.
 *
 * The mailbox overrules our row deliberately: a delivery event is first-hand evidence that the
 * message landed, while our row only records what we handed over and can lag or be wrong. An
 * unrecognised queue status falls to "waiting" rather than "given-up" - the whole point of TASK-302
 * is that nobody is written off quietly, so the ambiguous case must be the one that still gets sent.
 */
export function recipientOutcome(queueStatus: string, mailboxEvent: string | null): RecipientState {
  if (mailboxEvent === "bounced" || mailboxEvent === "complained") return "bounced";
  if (mailboxEvent === "delivered") return "arrived";
  if (queueStatus === "sent") return "sent-unconfirmed";
  if (queueStatus === "failed") return "given-up";
  if (queueStatus === "sending") return "sending";
  return "waiting";
}
