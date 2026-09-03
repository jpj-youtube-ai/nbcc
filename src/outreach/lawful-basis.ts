// TASK-403: whether we are allowed to email a given business, and why.
//
// Pure - no pool, no config, no clock - so the rule that stops an unlawful send is unit-tested
// without a database (golden rule 5).
//
// The law, briefly. The Privacy and Electronic Communications Regulations split recipients into
// "corporate subscribers" and "individual subscribers". A corporate subscriber - a limited
// company, an LLP, and (because Scots law gives partnerships their own legal personality) a
// Scottish partnership - may be sent unsolicited marketing. An individual subscriber - a sole
// trader, an English partnership - may not, and the ICO's position is that a charity promoting
// its aims counts as direct marketing. Post is not restricted this way; live calls are, by the
// TPS/CTPS registers rather than by this rule.
//
// The outreach form has always asked which kind of business it is. Until this module, nothing
// acted on the answer.

/**
 * Anything not positively known to be a corporate subscriber is treated as an individual.
 *
 * The default runs this way round on purpose: an individual wrongly treated as a company loses a
 * protection the law gave them, while a company wrongly treated as an individual costs a volunteer
 * one sentence.
 */
export function isIndividualSubscriber(businessType: string): boolean {
  return businessType !== "company";
}

export function needsConsentBasis(businessType: string): boolean {
  return isIndividualSubscriber(businessType);
}

/**
 * What the volunteer is asked. Deliberately in their language and not the law's: "how did they
 * agree to hear from us" gets a usable answer, "what is your lawful basis" gets a blank stare or
 * a guess, and a guess is worth nothing to whoever has to stand behind it later.
 */
export const CONSENT_BASIS_PROMPT = "How did they agree to hear from us?";

/** Short enough to be a shrug rather than an answer. */
const MIN_BASIS = 8;

export interface EmailCandidate {
  businessType: string;
  consentBasis: string | null;
}

/**
 * Why this business must not be emailed, or null when it may be.
 *
 * Returns the sentence a volunteer reads, because a refusal that does not explain itself just
 * gets worked around. It names the problem, the fix, and the two ways of getting in touch that
 * this rule does not restrict.
 */
export function emailBlockReason(business: EmailCandidate): string | null {
  if (!isIndividualSubscriber(business.businessType)) return null;
  if ((business.consentBasis ?? "").trim().length >= MIN_BASIS) return null;
  return (
    "This is a sole trader, so the law treats them as a person rather than a company: we may " +
    "only email them if they have already agreed to hear from us. Record how they agreed, or " +
    "give them a call or send a letter instead."
  );
}
