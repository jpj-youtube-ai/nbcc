import { escapeHtml } from "./page";
import { FOOTER_HTML, FOOTER_TEXT } from "../legal/registration";

// TASK-338: the emails the run-up sends. Pure — no pool, no config, no clock — like
// ./confirmation-email.ts, so every one is unit-tested without a database or a provider.
//
// Three of them, and each has a different job:
//   summary     — you have just saved your guest list; here is what we now hold
//   chase       — we still need your guests, and here is the date we need them by
//   final-call  — that date is today
//
// All three carry the buyer's own guest link, because "find the email from October" is the step
// where people give up.

export interface RunUpGuest {
  fullName: string;
  dietary: string | null;
  accessNeeds: string | null;
}

export interface RunUpEmail {
  subject: string;
  html: string;
  text: string;
}

const SHELL_OPEN =
  '<div style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;' +
  'max-width:600px;margin:0 auto;padding:24px;background:#F8F5EE;">';
const H1 = 'style="margin:0 0 18px;font-family:Georgia,serif;font-size:22px;font-weight:600;color:#800000;"';
const P = 'style="margin:0 0 16px;color:#333333;"';
const LINK = 'style="color:#800000;font-weight:600;"';

function shell(body: string): string {
  return `${SHELL_OPEN}
${body}
  <div style="margin-top:24px;padding-top:16px;border-top:1px solid #E9DFD2;color:#6F6A66;font-size:12px;line-height:1.6;">
    ${FOOTER_HTML}
  </div>
</div>`;
}

// "Friday 24 October" — the date a person would say, not an ISO stamp. Formatted in London,
// because a deadline rendered in the server's timezone can land a day out.
export function readableDate(value: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Europe/London",
  }).format(value);
}

// --- what they told us -------------------------------------------------------------------

export interface GuestSummaryInput {
  buyerFirstName: string;
  reference: string;
  seats: number;
  guests: RunUpGuest[];
  guestLink: string;
  lockAt: Date | null;
}

export function buildGuestSummaryEmail(input: GuestSummaryInput): RunUpEmail {
  const named = input.guests.length;
  const missing = Math.max(0, input.seats - named);

  // The read-back IS the point of this email. Someone has just typed ten names and a list of
  // allergies into a form and pressed save; without this they have no record of what they sent
  // and no way to check it, and an allergy recorded wrongly is the one that matters.
  const rows = input.guests
    .map((g) => {
      const notes = [g.dietary, g.accessNeeds].filter(Boolean).join(" · ");
      return (
        `<tr><td style="padding:8px 0;border-bottom:1px solid #E9DFD2;color:#333333;">` +
        `${escapeHtml(g.fullName)}` +
        (notes ? `<br /><span style="color:#6F6A66;font-size:14px;">${escapeHtml(notes)}</span>` : "") +
        `</td></tr>`
      );
    })
    .join("");

  const stillNeeded = missing
    ? `<p ${P}>You have <b>${missing}</b> ${missing === 1 ? "place" : "places"} still to fill${
        input.lockAt ? `, and we need ${missing === 1 ? "it" : "them"} by <b>${readableDate(input.lockAt)}</b>` : ""
      }. You can go back to the same link any time.</p>`
    : `<p ${P}>That is everyone. Thank you — nothing else is needed from you before the night.</p>`;

  const html = shell(`  <h1 ${H1}>Thank you, we have your guest list</h1>
  <p ${P}>Hello ${escapeHtml(input.buyerFirstName)}, here is exactly what we now hold for booking <b>${escapeHtml(input.reference)}</b>. Please check it, especially anything about food.</p>
  <table role="presentation" style="width:100%;border-collapse:collapse;margin:0 0 16px;">${rows}</table>
  ${stillNeeded}
  <p ${P}><a href="${escapeHtml(input.guestLink)}" ${LINK}>Change these details</a></p>
  <p style="margin:0 0 16px;color:#6F6A66;font-size:14px;">We share food and access needs with the venue so they can look after everyone properly. Nothing else about your guests is passed on.</p>`);

  const list = input.guests
    .map((g) => {
      const notes = [g.dietary, g.accessNeeds].filter(Boolean).join(" · ");
      return `- ${g.fullName}${notes ? ` (${notes})` : ""}`;
    })
    .join("\n");

  const text = `THANK YOU, WE HAVE YOUR GUEST LIST

Hello ${input.buyerFirstName}, here is exactly what we now hold for booking ${input.reference}.
Please check it, especially anything about food.

${list}

${
    missing
      ? `You have ${missing} ${missing === 1 ? "place" : "places"} still to fill${
          input.lockAt ? `, and we need ${missing === 1 ? "it" : "them"} by ${readableDate(input.lockAt)}` : ""
        }.`
      : "That is everyone. Thank you - nothing else is needed from you before the night."
  }

Change these details: ${input.guestLink}

We share food and access needs with the venue so they can look after everyone properly.
Nothing else about your guests is passed on.

${FOOTER_TEXT}`;

  return {
    subject: `Your guest list for the Festive Ball (${input.reference})`,
    html,
    text,
  };
}

// --- the chase, and the last call --------------------------------------------------------

export interface ChaseInput {
  buyerFirstName: string;
  reference: string;
  seats: number;
  guestsNamed: number;
  guestLink: string;
  lockAt: Date;
  finalCall: boolean;
}

export function buildGuestChaseEmail(input: ChaseInput): RunUpEmail {
  const missing = Math.max(0, input.seats - input.guestsNamed);
  const some = input.guestsNamed > 0;
  const by = readableDate(input.lockAt);

  // Two registers from one builder, because the difference between them is genuinely small: the
  // ask is identical and only the urgency changes. Two separate templates would drift.
  const opening = input.finalCall
    ? `We close the guest list for the Festive Ball <b>today</b>, so this is the last chance to tell us who is coming.`
    : `The venue needs the final guest list by <b>${by}</b>, so this is a nudge rather than anything to worry about.`;

  const where = some
    ? `You have given us ${input.guestsNamed} of ${input.seats}. We still need <b>${missing}</b> more.`
    : `We do not have any names yet for your ${input.seats === 1 ? "ticket" : `${input.seats} places`}.`;

  const html = shell(`  <h1 ${H1}>${input.finalCall ? "Last call for your guest list" : "We still need your guest list"}</h1>
  <p ${P}>Hello ${escapeHtml(input.buyerFirstName)}. ${opening}</p>
  <p ${P}>${where}</p>
  <p ${P}><a href="${escapeHtml(input.guestLink)}" ${LINK}>Add your guests</a></p>
  <p ${P}>It takes a couple of minutes, you can save what you know and come back, and it is what lets the venue cater for allergies properly.</p>
  <p style="margin:0 0 16px;color:#6F6A66;font-size:14px;">Booking ${escapeHtml(input.reference)}. If someone else in your party is filling this in, just pass them the link.</p>`);

  const text = `${input.finalCall ? "LAST CALL FOR YOUR GUEST LIST" : "WE STILL NEED YOUR GUEST LIST"}

Hello ${input.buyerFirstName}. ${
    input.finalCall
      ? "We close the guest list for the Festive Ball today, so this is the last chance to tell us who is coming."
      : `The venue needs the final guest list by ${by}, so this is a nudge rather than anything to worry about.`
  }

${
    some
      ? `You have given us ${input.guestsNamed} of ${input.seats}. We still need ${missing} more.`
      : `We do not have any names yet for your ${input.seats === 1 ? "ticket" : `${input.seats} places`}.`
  }

Add your guests: ${input.guestLink}

It takes a couple of minutes, you can save what you know and come back, and it is what lets
the venue cater for allergies properly.

Booking ${input.reference}. If someone else in your party is filling this in, just pass them the link.

${FOOTER_TEXT}`;

  return {
    subject: input.finalCall
      ? `Last call: your Festive Ball guest list closes today`
      : `We still need your Festive Ball guest list`,
    html,
    text,
  };
}
