import { renderNewsletter, type NewsletterDoc } from "./blocks";
import { firstNameOf } from "./theme";
import { htmlToPlainText } from "./plain-text";

// TASK-276: the welcome email sent when someone signs up through the website footer.
//
// It is also the SAFEGUARD that makes one-step signup safe. Signing up joins you immediately — no
// confirmation click — which is friendlier and loses fewer supporters, but on its own it means a
// person could be added by someone else and never know. The welcome email closes that: it arrives at
// once, says plainly what has happened, and carries the same one-click unsubscribe as every other
// send. Anyone added by mistake finds out immediately and can leave in one press.
//
// Sent ONLY for the website signup. A spreadsheet import must never trigger it — that would mail
// hundreds of people out of the blue, which is exactly the "why am I getting this?" reaction that
// produces spam complaints.
//
// Built as a block DOCUMENT and rendered through the ordinary newsletter renderer, rather than as
// bespoke HTML: the branding, frame, footer and unsubscribe button then come from the same place as
// everything else, and a future brand change flows through automatically instead of leaving this one
// email behind looking dated.

export const WELCOME_SUBJECT = "Thanks for signing up — welcome to NBCC";

// WHO gets a welcome, expressed as a rule rather than as a convention about which route calls what.
//
// Only 'footer' — somebody who just typed their address into the website and pressed sign up. They are
// expecting a reply this second, so a welcome is warm and answers "did that work?".
//
// NOT 'import': a spreadsheet of a few hundred people would each get an unexpected email about a
// signup they don't remember making, which is precisely the "why am I getting this?" reaction that
// produces spam complaints — and complaints cost the sending domain far more than the welcome is
// worth. A volunteer importing a list must never trigger a mailout.
//
// NOT 'admin': staff typing someone in are usually recording a conversation already had, not
// prompting a fresh introduction.
//
// A predicate, not a comment, so wiring the welcome into another path later cannot silently mail a
// whole import — it would have to change this rule and the test that pins it.
export function shouldSendWelcome(source: "footer" | "import" | "admin"): boolean {
  return source === "footer";
}

export function welcomeDoc(): NewsletterDoc {
  return {
    blocks: [
      { type: "masthead", variant: 0, data: {}, size: 0 },
      {
        type: "greeting",
        variant: 0,
        data: {
          heading: "Thank you for signing up",
          lead: "You'll now hear from the Night Before Christmas Campaign a few times a year.",
        },
        size: 0,
      },
      {
        type: "text",
        variant: 0,
        data: {
          text:
            "We're a volunteer-run Scottish charity, and we're here all year — not just at Christmas. " +
            "We'll write occasionally to share what your support makes possible: the Red Bags Full of Joy " +
            "our volunteers deliver, the people they reach, and the ways you can help if you'd like to.",
        },
        size: 0,
      },
      {
        type: "text",
        variant: 0,
        data: {
          // The safeguard, said plainly. Someone added by mistake must not have to hunt for the way out.
          text:
            "We'll never share your details, and every email we send has an unsubscribe link at the " +
            "bottom. **If you didn't sign up for this**, just use that link and you'll hear no more from us.",
        },
        size: 0,
      },
      {
        type: "button",
        variant: 0,
        data: { label: "See what we do", href: "https://nbcc.scot/about-us" },
        size: 0,
      },
    ],
  };
}

// The rendered welcome email. `unsubscribeUrl` is the recipient's own one-click link — the same one
// the frame footer and the List-Unsubscribe header use.
export function buildWelcomeEmail(
  name: string | null,
  unsubscribeUrl: string,
): { subject: string; html: string; text: string } {
  const html = renderNewsletter(welcomeDoc(), { firstName: firstNameOf(name), unsubscribeUrl });
  return { subject: WELCOME_SUBJECT, html, text: htmlToPlainText(html) };
}
