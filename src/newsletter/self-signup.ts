import { addListSubscriber, getSubscriberListBySlug, getListMemberByEmail, type AddSubscriberOutcome } from "../db/subscriber-lists";
import { buildWelcomeEmail, shouldSendWelcome } from "./welcome";
import { newsletterSender } from "./theme";
import { signSubscriberUnsubscribeToken } from "../donors/unsubscribe-token";
import { sendNewsletter } from "../clients/email";
import { emailLinkTags } from "../email/tracked-links";
import { recordAudit } from "../db/donations";
import { config } from "../config";

// Someone joining the newsletter THEMSELVES. Moved out of the footer route (TASK-261, TASK-276)
// unchanged in TASK-493, so the fundraising sign up's newsletter tick box subscribes an organiser
// exactly as the footer form does:
//   - the NEWSLETTER list, consent_source 'footer' from the footer or 'fundraise' from the fundraising
//     form (a self signup either way: the person, not staff), added_by NULL;
//   - deduped by address (addListSubscriber); the person may revive their own earlier opt out;
//   - the welcome email at once, with its one click unsubscribe, recorded in the audit log, best
//     effort and after the write: the person IS subscribed whether or not it goes.
// Suppressed addresses (bounces, complaints) are held back where every newsletter send is
// (suppressedAmong in src/db/newsletters.ts), exactly as for a footer signup.

export async function subscribeSelf(
  person: { name: string; email: string; phone: string | null },
  source: "footer" | "fundraise" = "footer",
): Promise<AddSubscriberOutcome | "no_list"> {
  const list = await getSubscriberListBySlug("newsletter");
  if (!list) {
    // Seeded by migration: missing means the deploy is broken, not the visitor's problem.
    console.error("newsletter self signup: newsletter list missing");
    return "no_list";
  }
  const outcome = await addListSubscriber(
    list.id,
    { name: person.name, email: person.email, phone: person.phone },
    source,
    { revive: true }, // the person themselves is consenting again
  );
  if (shouldSendWelcome(source)) {
    void sendWelcome(list.id, person.email).catch((err) =>
      console.error("welcome email failed:", err instanceof Error ? err.message : err),
    );
  }
  return outcome;
}

// Send one welcome, and record that we did. Separate from the request so a slow provider never holds
// up the visitor's "you're signed up" response.
async function sendWelcome(listId: number, email: string): Promise<void> {
  const member = await getListMemberByEmail(listId, email);
  if (!member) return; // vanished between write and send: nothing to address it to
  const token = signSubscriberUnsubscribeToken(member.id, 0, config.ADMIN_SESSION_SECRET);
  const built = buildWelcomeEmail(member.name, `${config.PORTAL_BASE_URL}/unsubscribe/${token}`);
  await sendNewsletter({
    email,
    from: newsletterSender(config.NEWSLETTER_FROM_EMAIL),
    replyTo: config.NEWSLETTER_REPLY_TO_EMAIL,
    subject: built.subject,
    html: built.html,
    text: built.text,
    unsubscribeUrl: `${config.PORTAL_BASE_URL}/unsubscribe/${token}`,
    // TASK-480: it rides the newsletter sender but is not an issue, so it names itself.
    links: emailLinkTags("welcome"),
  });
  // Recorded like any other outbound message, so "what have we sent this person?" stays answerable.
  try {
    await recordAudit({
      actor: "signup",
      action: "welcome.sent",
      entity: "list_subscriber",
      entityId: member.id,
      data: { email, list: listId },
    });
  } catch (err) {
    console.error("welcome audit failed:", err instanceof Error ? err.message : err);
  }
}
