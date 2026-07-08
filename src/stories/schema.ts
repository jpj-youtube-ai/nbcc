import { z } from "zod";

// Pure, DB-free validation + mapping for POST /api/my-story (Task B1). Field names and
// enum values mirror Task A's form EXACTLY (my-story.html `name=`/`value=` attributes),
// since the same schema validates both the JSON path (JS on) and the native
// application/x-www-form-urlencoded path (JS off) — see src/routes/api.ts.
//
// Text lengths are capped here (not in the migration), so the DB migration stays
// additive if a cap ever needs to change (spec: "Text lengths capped in the Zod
// schema... to keep the migration additive").

export const SUBMITTER_ROLES = [
  "supported",
  "family_carer",
  "volunteer",
  "professional_partner",
  "supporter_donor",
  "other",
] as const;

export const USE_SCOPES = ["public", "internal_only"] as const;

export const AGE_BANDS = ["16_24", "25_44", "45_64", "65_plus"] as const;

export const RECIPIENT_TYPES = ["child", "young_person", "vulnerable_adult"] as const;

// A native form POST sends a checked checkbox as the string "on" (or sometimes "true"),
// and OMITS an unchecked one entirely — so `undefined` must also coerce to false. The
// JSON path sends real booleans. This one coercer handles both transports identically.
function coerceCheckbox(value: unknown): boolean {
  return value === true || value === "on" || value === "true";
}

const checkboxField = z.preprocess(coerceCheckbox, z.boolean());

// Optional free-text fields: trim, treat an empty string as absent, cap length so no
// single field can be used to smuggle an oversized payload.
function optionalText(max: number) {
  return z.preprocess((v) => {
    if (typeof v !== "string") return undefined;
    const trimmed = v.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }, z.string().max(max).optional());
}

export const storySubmissionSchema = z.object({
  submitterRole: z.enum(SUBMITTER_ROLES).optional(),
  storyText: z
    .string()
    .trim()
    .min(1, "please share a little of your story")
    .max(5000, "please keep your story under 5000 characters"),
  shortQuote: optionalText(300),
  useScope: z.enum(USE_SCOPES),
  shareFirstName: checkboxField.default(false),
  shareTown: checkboxField.default(false),
  thirdPartyConsent: checkboxField.default(false),
  contactForMore: checkboxField.default(false),
  photoInterest: checkboxField.default(false),
  firstName: optionalText(200),
  // An absent email is fine (optional); a PRESENT one must be well-formed.
  email: z.preprocess((v) => {
    if (typeof v !== "string") return undefined;
    const trimmed = v.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }, z.string().email().optional()),
  phone: optionalText(50),
  town: optionalText(200),
  gender: optionalText(100),
  heardAbout: optionalText(300),
  ageBand: z.preprocess((v) => (v === "" ? undefined : v), z.enum(AGE_BANDS).optional()),
  recipientType: z.preprocess((v) => (v === "" ? undefined : v), z.enum(RECIPIENT_TYPES).optional()),
  // The required final confirm (age-gate + accuracy + third-party permission combined).
  // Must be truthy — a falsy or missing value fails validation.
  confirmOver16: checkboxField.refine((v) => v === true, {
    message: "please confirm you are 16 or over and the details are accurate",
  }),
  // Honeypot: a real visitor never fills this hidden field. Accepted here (not
  // stripped) so the route handler can inspect it and silently drop bot submissions
  // without inserting — the schema itself does not reject a filled honeypot.
  website: optionalText(500),
});

export type StorySubmission = z.infer<typeof storySubmissionSchema>;

// The stories table row shape (snake_case columns; mirrors migrations-stories/*_stories.js).
// created_at / consent_captured_at / id are DB-assigned defaults, not supplied here.
export interface StoryRecord {
  submitter_role: string | null;
  story_text: string;
  short_quote: string | null;
  use_scope: string;
  consent_share_first_name: boolean;
  consent_share_town: boolean;
  third_party_consent: boolean;
  contact_for_more: boolean;
  photo_interest: boolean;
  submitter_first_name: string | null;
  submitter_email: string | null;
  submitter_phone: string | null;
  submitter_town: string | null;
  age_band: string | null;
  gender: string | null;
  recipient_type: string | null;
  heard_about: string | null;
  confirmed_over_16: boolean;
}

// Map a validated submission onto the DB row shape. Never reads/writes the honeypot —
// that field is inspected by the route handler only, and never persisted.
export function buildStoryRecord(input: StorySubmission): StoryRecord {
  return {
    submitter_role: input.submitterRole ?? null,
    story_text: input.storyText,
    short_quote: input.shortQuote ?? null,
    use_scope: input.useScope,
    consent_share_first_name: input.shareFirstName,
    consent_share_town: input.shareTown,
    third_party_consent: input.thirdPartyConsent,
    contact_for_more: input.contactForMore,
    photo_interest: input.photoInterest,
    submitter_first_name: input.firstName ?? null,
    submitter_email: input.email ?? null,
    submitter_phone: input.phone ?? null,
    submitter_town: input.town ?? null,
    age_band: input.ageBand ?? null,
    gender: input.gender ?? null,
    recipient_type: input.recipientType ?? null,
    heard_about: input.heardAbout ?? null,
    confirmed_over_16: input.confirmOver16,
  };
}
