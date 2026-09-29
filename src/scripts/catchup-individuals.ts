import { pool } from "../db/pool";
import { config } from "../config";
import { listCatchupDonors, mintDeclarationInvite } from "../db/catchup";
import { buildCatchupPlan } from "../outreach/catchup-plan";
import { recordThankYouSent } from "../db/thank-you";
import { sendThankYou } from "../clients/email";
import { buildThankYouEmailHtml, buildThankYouEmailText, thankYouSubject } from "../thank-you/letter";
import { signThankYouLetterToken } from "../thank-you/letter-token";
import { sendDeclarationConfirmation } from "../db/stripe-webhook";
import { signUnsubscribeToken } from "../donors/unsubscribe-token";

// TASK-438: thank the three individuals TASK-430 imported, and ask them about Gift Aid.
//
// DRY RUN BY DEFAULT. Prints every address it would write to and exactly what each would get,
// and sends nothing. Pass --commit to actually send. These are real letters to real people who
// have heard nothing for four months; getting it wrong twice is not an option.
//
// The recipient list is HARDCODED, deliberately, the same as the import that created them. It can
// therefore never be pointed at the whole donor table by accident - which for a script that emails
// people and opens Gift Aid declarations is the failure worth designing out.
//
// CONSENT. These three are recorded as having NOT consented to email, because they signed up
// through Stripe before there was a form to ask them on: they were never asked, they did not
// decline, and nothing in the database can tell those apart. The charity's decision was that a
// thank-you for a gift somebody made, and a question about that same gift, are administrative
// rather than marketing - so both go. This script does NOT touch their consent flags: recording an
// agreement nobody was ever asked for would be worse than the silence it is fixing. Instead the
// letter ASKS them, so any consent that follows is real.
const RECIPIENTS = [
  "fionamcilloney@btinternet.com", // Fiona McIlloney
  "bellemcf@hotmail.co.uk", // Mrs I J McFarlane
  "jodie.john@yahoo.co.uk", // Jodie McFarlane
];

const ACTOR = "script:catchup-individuals";
const money = (pence: number) => `£${(pence / 100).toFixed(2)}`;

async function main(): Promise<void> {
  const commit = process.argv.includes("--commit");

  const donors = await listCatchupDonors(RECIPIENTS);
  // Their own preference page, addressed to them and already signed: one click, tick boxes,
  // nothing to type and no form to go and find. "Sign up at nbcc.scot" is a request to go and
  // do some work, which is a good way to get no reply from somebody you have ignored for four
  // months.
  const plan = buildCatchupPlan(
    donors,
    (donorId) =>
      `${config.PORTAL_BASE_URL}/preferences/${signUnsubscribeToken(donorId, config.ADMIN_SESSION_SECRET)}`,
  );

  console.log("");
  console.log(commit ? "=== SENDING ===" : "=== DRY RUN - nothing will be sent ===");
  console.log("");

  const missing = RECIPIENTS.filter(
    (e) => !donors.some((d) => (d.email ?? "").trim().toLowerCase() === e),
  );
  for (const e of missing) console.log(`NOT FOUND ${e} - no donor with that email`);

  for (const entry of plan.entries) {
    console.log(`${entry.letter.addressedTo}  <${entry.letter.recipientEmail}>`);
    console.log(
      `  ${money(entry.monthlyPence)}/month x ${entry.months} = ${money(entry.letter.giftAmountPence)} given so far`,
    );
    console.log(`  thank-you letter for ${money(entry.letter.giftAmountPence)}, Gift Aid not claimed`);
    console.log(
      entry.giftAid
        ? `  Gift Aid request against donation ${entry.giftAid.donationId} (${money(entry.giftAid.amountPence)})`
        : "  no Gift Aid request - every donation already has a declaration under way",
    );
    console.log("  the note in the letter:");
    for (const line of entry.letter.personalMessage.split("\n\n")) {
      console.log(`    ${line}`);
    }
    console.log("");
  }

  for (const s of plan.skipped) console.log(`SKIPPED donor ${s.donorId}: ${s.reason}`);

  console.log(
    `TOTAL: ${plan.entries.length} letter(s), ${money(plan.totalPence)} of giving acknowledged, ` +
      `${plan.entries.filter((e) => e.giftAid).length} Gift Aid request(s).`,
  );
  console.log("");

  if (!commit) {
    console.log("Dry run only. Nothing was sent. Re-run with --commit to send for real.");
    console.log("NOTE: consent flags are never changed by this script; the letter asks instead.");
    return;
  }

  for (const entry of plan.entries) {
    // The thank-you first. recordThankYouSent writes the row and its audit together, which is what
    // stops anybody - a person or the daily pass - thanking them a second time.
    const id = await recordThankYouSent({
      donorId: entry.letter.donorId,
      thankYouName: entry.letter.thankYouName,
      addressedTo: entry.letter.addressedTo,
      recipientEmail: entry.letter.recipientEmail,
      giftType: "money",
      giftAmountPence: entry.letter.giftAmountPence,
      giftInKind: null,
      giftAided: entry.letter.giftAided,
      personalMessage: entry.letter.personalMessage,
      signedByName: "The Night Before Christmas Campaign",
      signedByRole: "From all of us, and every volunteer",
      sentBy: ACTOR,
    });

    const view = {
      thankYouName: entry.letter.thankYouName,
      addressedTo: entry.letter.addressedTo,
      giftType: "money" as const,
      giftAmountPence: entry.letter.giftAmountPence,
      giftInKind: null,
      giftAided: entry.letter.giftAided,
      personalMessage: entry.letter.personalMessage,
      signedByName: "The Night Before Christmas Campaign",
      signedByRole: "From all of us, and every volunteer",
      letterDate: new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }),
      printUrl: `${config.PORTAL_BASE_URL}/thank-you/letter/${signThankYouLetterToken(id, config.ADMIN_SESSION_SECRET)}`,
    };

    try {
      await sendThankYou({
        email: entry.letter.recipientEmail,
        from: config.GIVING_FROM_EMAIL,
        replyTo: config.GIVING_FROM_EMAIL,
        subject: thankYouSubject({ thankYouName: entry.letter.thankYouName }),
        html: buildThankYouEmailHtml(view),
        text: buildThankYouEmailText(view),
      });
      console.log(`THANKED ${entry.letter.recipientEmail} (letter ${id})`);
    } catch (err) {
      // Best-effort, matching the admin route: the row is recorded and they are marked thanked
      // whatever the relay does, so nobody is ever thanked twice by a retry.
      console.error(`thank-you to ${entry.letter.recipientEmail} FAILED`, err instanceof Error ? err.message : err);
    }

    if (!entry.giftAid) continue;

    // Then the Gift Aid request. mintDeclarationInvite puts the donation at 'pending' with a
    // token; sendDeclarationConfirmation emails the link and stamps 'sent' - or 'undelivered' if
    // the send throws, so a link that never arrived is never mistaken for one that did.
    const token = await mintDeclarationInvite(entry.giftAid.donationId, ACTOR);
    if (!token) {
      console.log(`  Gift Aid request skipped: donation ${entry.giftAid.donationId} already has one`);
      continue;
    }
    await sendDeclarationConfirmation({
      donationId: entry.giftAid.donationId,
      receiptEmail: entry.letter.recipientEmail,
      token,
      amountPence: entry.giftAid.amountPence,
      currency: "GBP",
    });
    console.log(`  Gift Aid request sent for donation ${entry.giftAid.donationId}`);
  }

  console.log("");
  console.log("Done. Consent flags were not changed - the letter asks them instead.");
}

main()
  .catch((err) => {
    console.error("CATCHUP_FAILED", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
