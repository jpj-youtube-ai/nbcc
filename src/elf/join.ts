import type StripeNS from "stripe";
import { z } from "zod";
import { cleanFirstName, isFestiveSurname, type FirstNameRefusal } from "./names";
import { normaliseUkMobile } from "./alerts";
import { declarationFieldsSchema } from "../declarations/fields";
import { grossedUpFeePence, type CardFeeRate } from "../ball/pricing";
import type { ElfSettings } from "./settings";

// NBCC Elf Detective School: the rules of enrolling and paying. Designs:
// docs/superpowers/specs/2026-10-04-elf-detective-school-design.md (decisions 10 and 11, "Names")
// and the wave 1 plan, docs/superpowers/plans/2026-11-03-elf-detective-wave1-sign-up.md (Task 3).
//
// One grown up enrols the family's detectives and pays what they can: at least the admin's "from"
// amount for each detective (£1), with the admin's suggested amount (£5) offered. The entry is never
// Gift Aided; a separate gift can be, with its declaration. A detective is a first name and a
// festive surname from the list: never a real surname, school or age, so there are no such fields.
// The grown up gives a UK mobile number (TASK-613), only so NBCC can ring them straight away if one
// of their detectives wins the grand prize on Christmas Eve.
//
// Pure: no pool, no config, no clock (apart from the checkout's expiry). Unit tested in
// test/unit/elf-join.test.ts.

export const MAX_DETECTIVES = 8;
const MAX_ENTRY_PENCE = 100_000; // £1,000
const MAX_DONATION_PENCE = 1_000_000;
const CHECKOUT_MINUTES = 31;

const pence = (max: number) => z.number().int().min(0).max(max);

/** The words for a first name the checks refuse, said kindly, with no dashes. */
export function firstNameRefusalWords(reason: FirstNameRefusal): string {
  switch (reason) {
    case "empty":
      return "Please give each detective a first name.";
    case "too-long":
      return "Please keep each first name to 20 letters or fewer.";
    case "one-word":
      return "Please give just one first name: the festive surname comes from the list.";
    case "letters-only":
    case "a-to-z":
      return "Please use only the letters A to Z in a first name.";
    case "blocked":
      return "Please choose a different first name.";
  }
}

const detectiveSchema = z.object({ firstName: z.string().max(60), surname: z.string().max(40) });

/** The words for a mobile number that is missing or is not a UK mobile (TASK-613). */
export const MOBILE_WORDS = "Please type a UK mobile number, like 07700 900 123.";

/** The shape of an enrolment as it is sent. Checked further by parseJoin. */
export function joinBodySchema() {
  return z.object({
    grownUpName: z.string().trim().min(1, "Please tell us your name.").max(80),
    email: z.string().trim().toLowerCase().email("Please give an email address we can reach you at.").max(200),
    /** The grown up's mobile, so NBCC can ring the grand prize winner's grown up on Christmas Eve
     *  (TASK-613). parseJoin checks it and keeps it as +447 and nine digits, as a head elf's mobile is
     *  kept (normaliseUkMobile, src/elf/alerts.ts). */
    mobile: z.string().max(40),
    detectives: z.array(detectiveSchema).max(50),
    entryPence: pence(10_000_000),
    donationPence: pence(MAX_DONATION_PENCE).default(0),
    giftAid: z.boolean().default(false),
    declaration: declarationFieldsSchema.optional(),
    coverFee: z.boolean().default(false),
    newsletter: z.boolean().default(false),
    agreed: z.boolean(),
    /** A field people never see: anything in it is a robot. */
    website: z.string().max(0).optional(),
    captchaToken: z.string().max(4000).optional(),
  });
}

export type JoinBody = z.infer<ReturnType<typeof joinBodySchema>>;

/** The least, the suggested and the most a family can pay for this many detectives. */
export function entryLimits(
  settings: ElfSettings,
  detectives: number,
): { fromPence: number; suggestedPence: number; maxPence: number } {
  return {
    fromPence: settings.entryFromPence * detectives,
    suggestedPence: settings.entrySuggestedPence * detectives,
    maxPence: MAX_ENTRY_PENCE,
  };
}

function poundsWords(p: number): string {
  const whole = p % 100 === 0;
  return `£${(p / 100).toLocaleString("en-GB", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })}`;
}

export type JoinResult = { ok: true; body: JoinBody } | { ok: false; errors: string[] };

const FIELD_WORDS: Record<string, string> = {
  mobile: MOBILE_WORDS,
  entryPence: "Please give the entry in pounds and pence, like 5 or 5.50.",
  donationPence: "Please give the gift in pounds and pence, like 5 or 5.50.",
  detectives: "Please check each detective's first name and surname.",
  agreed: "Please agree to the rules to enrol.",
  website: "Something went wrong. Please try again.",
};

const DECLARATION_WORDS: Record<string, string> = {
  firstName: "For Gift Aid, please give your first and last name.",
  lastName: "For Gift Aid, please give your first and last name.",
  houseNameNumber: "For Gift Aid, please give your house name or number.",
  address: "For Gift Aid, please give the rest of your home address.",
  postcode: "For Gift Aid, please give a UK postcode, or tick that your home is outside the UK.",
};

/** One shape problem in plain words: never a field's name, never zod's own words. */
function issueWords(i: z.ZodIssue): string {
  const [field, part] = i.path.map(String);
  if (field === "declaration") return DECLARATION_WORDS[part ?? ""] ?? "Please check your Gift Aid declaration: each line needs filling in.";
  if (i.message.startsWith("Please")) return i.message;
  return FIELD_WORDS[field ?? ""] ?? "Something on the form needs another look. Please check it and try again.";
}

/** Check an enrolment against every rule. Names are cleaned, and every refusal is in plain words. */
export function parseJoin(settings: ElfSettings, sent: unknown): JoinResult {
  const shaped = joinBodySchema().safeParse(sent);
  if (!shaped.success) {
    const messages = shaped.error.issues.map(issueWords);
    return { ok: false, errors: [...new Set(messages)] };
  }
  const body = shaped.data;
  const errors: string[] = [];

  const mobile = normaliseUkMobile(body.mobile);
  if (!mobile) errors.push(MOBILE_WORDS);
  if (body.detectives.length === 0) errors.push("Please enrol at least one detective.");
  if (body.detectives.length > MAX_DETECTIVES) errors.push(`You can enrol up to ${MAX_DETECTIVES} detectives at a time.`);
  const detectives = body.detectives.map((d) => {
    const first = cleanFirstName(d.firstName);
    if (!first.ok) errors.push(firstNameRefusalWords(first.reason));
    if (!isFestiveSurname(d.surname)) errors.push("Please pick a surname from the list for each detective.");
    return { firstName: first.ok ? first.name : d.firstName, surname: d.surname };
  });

  const count = Math.max(1, body.detectives.length);
  const limits = entryLimits(settings, count);
  if (body.entryPence < limits.fromPence) {
    errors.push(
      `Please pay at least ${poundsWords(limits.fromPence)} for ${count} detective${count === 1 ? "" : "s"}.`,
    );
  }
  if (body.entryPence > limits.maxPence) errors.push("Please pay no more than £1,000 for the entry. A gift can be added below.");

  if (body.giftAid && body.donationPence === 0) errors.push("Gift Aid can only go on a gift. Please add a gift or untick Gift Aid.");
  if (body.giftAid && body.donationPence > 0 && !body.declaration) errors.push("Please fill in the Gift Aid declaration.");
  if (!body.agreed) errors.push("Please agree to the rules to enrol.");

  if (errors.length > 0 || !mobile) return { ok: false, errors: [...new Set(errors)] };
  return { ok: true, body: { ...body, mobile, detectives, declaration: body.giftAid ? body.declaration : undefined } };
}

/** Pounds as typed ("5", "5.50", "£10") in whole pence. Anything else is NaN, which the schema refuses. */
export function penceFromPounds(typed: unknown): number {
  if (typeof typed !== "string" || typed.trim() === "") return 0;
  const m = /^£?\s*(\d{1,7})(?:\.(\d{1,2}))?$/.exec(typed.trim());
  if (!m) return Number.NaN;
  return Number(m[1]) * 100 + Number((m[2] ?? "0").padEnd(2, "0"));
}

const ticked = (v: unknown) => v === "on" || v === "true" || v === "1" || v === true;
const text = (v: unknown) => (typeof v === "string" ? v : "");

/** How many detective rows the plain form has. */
export const FORM_ROWS = MAX_DETECTIVES;

/** An enrolment as the plain form sends it (no script), in the shape parseJoin checks. Detective
 *  rows left without a first name are skipped. The Gift Aid declaration comes along only when Gift
 *  Aid is ticked. */
export function joinBodyFromForm(form: Record<string, unknown>): Record<string, unknown> {
  const detectives: { firstName: string; surname: string }[] = [];
  for (let n = 1; n <= FORM_ROWS; n += 1) {
    const firstName = text(form[`detective-${n}-first`]).trim();
    if (firstName) detectives.push({ firstName, surname: text(form[`detective-${n}-surname`]) });
  }
  const giftAid = ticked(form.giftAid);
  const body: Record<string, unknown> = {
    grownUpName: text(form.grownUpName),
    email: text(form.email),
    mobile: text(form.mobile),
    detectives,
    entryPence: penceFromPounds(form.entry),
    donationPence: penceFromPounds(form.donation),
    giftAid,
    coverFee: ticked(form.coverFee),
    newsletter: ticked(form.newsletter),
    agreed: ticked(form.agreed),
    website: text(form.website),
    captchaToken: text(form["cf-turnstile-response"]) || undefined,
  };
  if (giftAid) {
    const decl = (k: string) => text(form[`decl-${k}`]).trim() || undefined;
    body.declaration = {
      firstName: decl("firstName"),
      lastName: decl("lastName"),
      houseNameNumber: decl("houseNameNumber"),
      address: decl("address"),
      postcode: decl("postcode"),
      nonUk: ticked(form["decl-nonUk"]),
    };
  }
  return body;
}

/** The card fee, covering the entry and the gift together, only when ticked. */
export function feeCoverPence(body: JoinBody, rate: CardFeeRate): number {
  if (!body.coverFee) return 0;
  return grossedUpFeePence(body.entryPence + body.donationPence, rate);
}

/** The Stripe Checkout Session for an enrolment. The addresses come from this site, never the form. */
export function buildElfSessionParams(o: {
  reference: string;
  body: JoinBody;
  feeCoverPence: number;
  baseUrl: string;
  familyId: number;
}): StripeNS.Checkout.SessionCreateParams {
  const base = o.baseUrl.replace(/\/+$/, "");
  const line = (name: string, amount: number): StripeNS.Checkout.SessionCreateParams.LineItem => ({
    quantity: 1,
    price_data: { currency: "gbp", unit_amount: amount, product_data: { name } },
  });
  const lines = [line("Elf Detective School entry", o.body.entryPence)];
  if (o.body.donationPence > 0) lines.push(line("A gift to NBCC", o.body.donationPence));
  if (o.feeCoverPence > 0) lines.push(line("Covering the card fee", o.feeCoverPence));
  const metadata = {
    product: "elf_school",
    reference: o.reference,
    familyId: String(o.familyId),
    giftAid: String(o.body.giftAid),
    feeCoverPence: String(o.feeCoverPence),
  };
  return {
    mode: "payment",
    payment_method_types: ["card"],
    line_items: lines,
    customer_email: o.body.email,
    metadata,
    payment_intent_data: { metadata },
    success_url: `${base}/elf/welcome?elf_session={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/elf/join`,
    expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_MINUTES * 60,
  };
}
