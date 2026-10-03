import { z } from "zod";
import { escapeHtml } from "../events/render";
import { checkNewsPhoto, type NewsPhotoMime } from "./news";
import { hasPage, type FundraiserRecord } from "./model";
import { isInMemory } from "./in-memory";

// Profile pictures (Jaimie, 2026-10-03). From their private area an organiser sends two pictures,
// each with a live preview of how their page will look:
//
//   - main     the big photo on their page (the one staff could already upload). Approved, it
//              becomes the page's photo exactly as if staff had uploaded it.
//   - profile  a small round photo of themselves, shown beside their name on their page ("Organised
//              by Robin O."), like JustGiving, and on their team's page. Square, cropped in the
//              browser where they can drag it into place.
//
// Both are checked by staff before they show (the standing rule: staff approve all public content,
// pictures included). Until then a picture has no public address: its own address answers nothing
// until it is approved. Staff approve or decline in Admin > Fundraising, with an optional note the
// organiser sees. The server turns each picture the right way up, makes it smaller and saves it again
// (src/fundraising/picture-process.ts), so nothing from the camera is kept, such as where it was taken.
//
// Team pages: each member, and the team organiser, show their round photo once approved, and the
// NBCC elf in the same round frame until then (src/fundraising/team-render.ts). A page in memory of
// someone has no round photo: its main photo is of the person remembered.
//
// Pure: no pool, no config, no clock. Unit tested in test/unit/fundraising-pictures.test.ts. The SQL
// is in src/db/fundraiser-pictures.ts and the routes in src/routes/fundraiser-pictures.ts. Words
// people read are plain, friendly English, with no dashes.

export const PICTURE_KINDS = ["main", "profile"] as const;
export type PictureKind = (typeof PICTURE_KINDS)[number];

export const PICTURE_STATUSES = ["pending", "approved", "declined", "replaced", "removed"] as const;
export type PictureStatus = (typeof PICTURE_STATUSES)[number];

/** Pictures one fundraiser may send in any 24 hours, of both kinds together. */
export const PICTURES_PER_DAY = 10;

/** Where an approved profile photo is served from, by its own id (a uuid) only. */
export const PROFILE_PHOTO_PREFIX = "/media/fundraiser-profile/";

/** What the upload form sends. The picture is checked once it is decoded. */
export const pictureUploadSchema = z
  .object({
    kind: z.enum(PICTURE_KINDS),
    mime: z.string().min(1).max(100),
    dataBase64: z.string().min(1),
  })
  .strict();

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

/** The picture's bytes, or none at all when what was sent is not base64. */
export function decodeBase64(b64: string): Buffer {
  const clean = b64.replace(/\s+/g, "");
  return BASE64_RE.test(clean) ? Buffer.from(clean, "base64") : Buffer.alloc(0);
}

/**
 * A JPEG, PNG or WebP whose bytes really are that type, no bigger than any other upload (2 MB): the
 * same check as a news update's photo.
 */
export function checkPictureUpload(mime: string, bytes: Uint8Array): { ok: true; mime: NewsPhotoMime } | { ok: false; reason: "type" | "size" } {
  return checkNewsPhoto(mime, bytes);
}

/** Only an approved fundraiser with a page has somewhere for its pictures to go. */
export function canSendPictures(f: Pick<FundraiserRecord, "status" | "public" | "path">): boolean {
  return f.status === "approved" && hasPage(f);
}

/**
 * Whether a page shows its organiser's round photo: every page but one in memory of someone, which
 * shows the photo of the person remembered instead. For those the private area offers no round
 * photo, the page draws none, the public address answers nothing, and staff cannot approve one.
 */
export function profilePhotoAllowed(f: Pick<FundraiserRecord, "status" | "public" | "path"> & { inMemory?: boolean | null }): boolean {
  return !isInMemory(f);
}

export function pictureLimitReached(sentInLastDay: number): boolean {
  return sentInLastDay >= PICTURES_PER_DAY;
}

const STATUS_WORDS: Record<PictureStatus, string> = {
  pending: "Waiting for us to check",
  approved: "On your page",
  declined: "Not used",
  replaced: "Replaced by a newer one",
  removed: "Taken off your page",
};

/** Where a picture is up to, as the organiser reads it. */
export function pictureStatusWords(status: PictureStatus): string {
  return STATUS_WORDS[status] ?? "Not used";
}

/** A profile photo's words for someone who cannot see it: "A photo of Robin O.". */
export function profileAlt(name: string): string {
  return `A photo of ${name}`;
}

export function profilePhotoSrc(photoId: string): string {
  return `${PROFILE_PHOTO_PREFIX}${photoId}`;
}

/** A picture as the database holds it, without its bytes. */
export interface PictureRow {
  id: number;
  fundraiserId: number;
  kind: PictureKind;
  status: PictureStatus;
  photoId: string;
  /** False once its bytes have gone (not used, replaced or taken off): only the record is left. */
  hasPhoto: boolean;
  width: number;
  height: number;
  createdAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  declineReason: string | null;
}

/**
 * What the organiser sees of one kind: the one in use (approved), and the newest they sent after it
 * (waiting, or not used, or taken off). A replaced one is never shown: a newer one took its place.
 */
export function organiserPictureView(rows: PictureRow[], kind: PictureKind): { inUse: PictureRow | null; latest: PictureRow | null } {
  const mine = rows
    .filter((r) => r.kind === kind && r.status !== "replaced")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id);
  const inUse = mine.find((r) => r.status === "approved") ?? null;
  const newest = mine[0] ?? null;
  return { inUse, latest: newest && newest !== inUse ? newest : null };
}

// --- the round frame on the public pages --------------------------------------------------------------

const PROFILE_SRC_RE = /^\/media\/fundraiser-profile\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Only a profile photo's own address is ever drawn in the round frame. */
export function isProfilePhotoSrc(src: unknown): src is string {
  return typeof src === "string" && PROFILE_SRC_RE.test(src);
}

/** The NBCC elf, in the same round frame, for someone on a team page without a photo yet. */
export const ELF_SRC = "/assets/img/nbcc-elf-96.png";

/**
 * Someone's round photo, described by the name the page shows ("A photo of Robin O."); or, with
 * `elf`, the NBCC elf when they have none. The elf says nothing to a screen reader: their name is
 * right beside it. Nothing at all without a photo and without `elf`.
 */
export function avatarHtml(src: string | null | undefined, name: string, opts: { elf?: boolean } = {}): string {
  if (isProfilePhotoSrc(src)) {
    return `<img class="fr-avatar" src="${escapeHtml(src)}" alt="${escapeHtml(profileAlt(name))}" width="48" height="48" loading="lazy" decoding="async" />`;
  }
  if (!opts.elf) return "";
  return `<img class="fr-avatar fr-avatar--elf" src="${ELF_SRC}" alt="" width="48" height="48" loading="lazy" decoding="async" />`;
}
