// TASK-438: thanking the three individuals the charity never knew it had, and asking them about
// Gift Aid.
//
// Fiona McIlloney, Mrs I J McFarlane and Jodie McFarlane have each given £10 a month since May.
// Until TASK-430 imported them there was no record of any of it, so in four months they have had no
// thank-you, no receipt and no Gift Aid request. This decides what each of them is sent.
//
// Pure on purpose. What a letter tells somebody about their own giving, and whether they are asked
// to make a legal declaration to HMRC, are the parts worth being certain about — so they are decided
// in a file with no database and no mail server in it.

export type CatchupDonation = {
  id: number;
  amountPence: number;
  paidAt: Date;
  /** Their existing declaration state. Only a donation with no declaration can be invited. */
  declarationStatus: string;
};

export type CatchupDonor = {
  donorId: number;
  fullName: string;
  email: string | null;
  /** True once they have been thanked. One letter per donor, ever - so this is final. */
  alreadyThanked: boolean;
  donations: CatchupDonation[];
};

export type CatchupLetter = {
  donorId: number;
  recipientEmail: string;
  thankYouName: string;
  addressedTo: string;
  /** The TOTAL they have given, not the monthly figure - see the note in buildCatchupPlan. */
  giftAmountPence: number;
  /** Always false: nobody has declared, and a letter claiming otherwise is a lie about their tax. */
  giftAided: false;
  personalMessage: string;
};

export type CatchupGiftAidInvite = {
  /** The donation the declaration link is addressed to. */
  donationId: number;
  amountPence: number;
};

export type CatchupEntry = {
  donor: CatchupDonor;
  letter: CatchupLetter;
  /** Null when there is no donation that can carry a declaration invite. */
  giftAid: CatchupGiftAidInvite | null;
  monthlyPence: number;
  months: number;
};

export type CatchupPlan = {
  entries: CatchupEntry[];
  skipped: { donorId: number; reason: string }[];
  totalPence: number;
};

const money = (pence: number) => `£${(pence / 100).toFixed(2).replace(/\.00$/, "")}`;

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * The note that goes in the letter.
 *
 * Three things it has to do, and the order matters. Say what they have actually given, because
 * nobody has ever acknowledged it. Apologise for the silence without explaining the plumbing - the
 * reason this happened is the charity's problem, not theirs. Then ASK whether they want to hear
 * from us, because we have never asked: they signed up through Stripe before there was a form to
 * ask on, so their record says "no consent" purely because the question was never put to them.
 */
export function catchupMessage(input: {
  monthlyPence: number;
  totalPence: number;
  firstMonth: string;
}): string {
  return [
    `Your ${money(input.monthlyPence)} a month since ${input.firstMonth} now comes to ${money(input.totalPence)}, and it has been arriving quietly ever since.`,
    `We are sorry it has taken us until now to say so. You have been supporting us all year and hearing nothing back, and that is our fault rather than yours.`,
    `We have also never asked whether you would like to hear how the campaign is going - so we are asking now rather than assuming. If you would, you can sign up at nbcc.scot. If you would rather not, you will not hear from us again.`,
  ].join("\n\n");
}

/**
 * Work out what each person is sent, without sending any of it.
 *
 * REFUSES rather than guesses, with a reason each time:
 *   - no email address: there is nowhere to send anything.
 *   - no paid donations: there is nothing to thank them for.
 *   - already thanked: one letter per donor is final, and a second would undo the first's meaning.
 *
 * The amount in the letter is the TOTAL they have given, not the monthly figure. The automatic
 * business letter uses the monthly amount because it goes out days after somebody signs up, when
 * one payment has been taken. This is a catch-up covering months, so "thank you for your donation
 * of £10" would thank them for a twentieth of what they have actually given.
 */
export function buildCatchupPlan(donors: CatchupDonor[]): CatchupPlan {
  const entries: CatchupEntry[] = [];
  const skipped: { donorId: number; reason: string }[] = [];

  for (const donor of donors) {
    if (!donor.email) {
      skipped.push({ donorId: donor.donorId, reason: "no email address" });
      continue;
    }
    if (donor.donations.length === 0) {
      skipped.push({ donorId: donor.donorId, reason: "no paid donations to thank them for" });
      continue;
    }
    if (donor.alreadyThanked) {
      skipped.push({ donorId: donor.donorId, reason: "already thanked - one letter per donor is final" });
      continue;
    }

    const byDate = [...donor.donations].sort((a, b) => a.paidAt.getTime() - b.paidAt.getTime());
    const totalPence = byDate.reduce((sum, d) => sum + d.amountPence, 0);
    const first = byDate[0];
    const latest = byDate[byDate.length - 1];
    // The regular amount, taken from the most recent payment rather than an average: an average
    // across a part-month would print a figure that has never left their account.
    const monthlyPence = latest.amountPence;

    // Only a donation still sitting at not_required can be invited. One already part-way through
    // the declaration flow has a link of its own out there, and issuing a second would be two
    // routes to the same declaration.
    const invitable = byDate.filter((d) => d.declarationStatus === "not_required");
    const target = invitable.length ? invitable[invitable.length - 1] : null;

    entries.push({
      donor,
      letter: {
        donorId: donor.donorId,
        recipientEmail: donor.email,
        thankYouName: donor.fullName,
        addressedTo: donor.fullName,
        giftAmountPence: totalPence,
        giftAided: false,
        personalMessage: catchupMessage({
          monthlyPence,
          totalPence,
          firstMonth: MONTHS[first.paidAt.getUTCMonth()],
        }),
      },
      giftAid: target ? { donationId: target.id, amountPence: target.amountPence } : null,
      monthlyPence,
      months: byDate.length,
    });
  }

  return {
    entries,
    skipped,
    totalPence: entries.reduce((sum, e) => sum + e.letter.giftAmountPence, 0),
  };
}
