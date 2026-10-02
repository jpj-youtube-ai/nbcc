import { z } from "zod";
import { londonToday } from "../events/model";
import { containsBlockedWord } from "../donors/display-name-filter";
import { MAX_IMAGE_BYTES } from "../newsletter/image-validation";
import { hasPage, type FundraiserRecord } from "./model";

// TASK-506: a fundraiser page's countdown, and the news updates its organiser posts.
//
//   - Countdown: while the date is still to come, "12 days to go" ("Tomorrow!" the day before); on
//     the day, a banner wishing them luck with the share links; after it, nothing (the finished and
//     thank you states already say what there is to say). UK days, so the clocks changing never
//     makes it a day out.
//   - News: the organiser posts a short update, with a photo if they like, from their private area.
//     Every one waits for staff, and only an approved one is ever public, newest first. A photo is
//     served to the public only once its update is approved (never while it waits, and never after
//     staff hide it); before then only the organiser and staff can see it.
//
// Pure: no pool, no config, no clock (the time is passed in). Unit tested in
// test/unit/fundraising-news.test.ts. The SQL is in src/db/fundraiser-updates.ts and the routes in
// src/routes/fundraiser-news.ts. Words people read are plain, friendly English, with no dashes.

// --- the countdown ---------------------------------------------------------------------------------

/** Whole days from one YYYY-MM-DD to another. Counted on the calendar, so no clock change can move it. */
export function daysBetween(from: string, to: string): number {
  const utc = (ymd: string) => {
    const [y, m, d] = ymd.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((utc(to) - utc(from)) / 86_400_000);
}

export type Countdown = { kind: "days"; days: number } | { kind: "today" };

/**
 * What the page says about its date, as of `now`: the days to go, the day itself, or nothing (no
 * date, the date has passed, or the fundraiser is finished).
 */
export function countdownFor(p: { eventDate: string | null; finished?: boolean }, now: Date): Countdown | null {
  if (!p.eventDate || p.finished) return null;
  const days = daysBetween(londonToday(now), p.eventDate);
  if (days < 0) return null;
  return days === 0 ? { kind: "today" } : { kind: "days", days };
}

// --- news updates ----------------------------------------------------------------------------------

export const NEWS_MAX = 500;
/** Updates one fundraiser may post in any 24 hours. */
export const NEWS_PER_DAY = 5;
export const NEWS_STATUSES = ["pending", "approved", "rejected", "hidden"] as const;
export type NewsStatus = (typeof NEWS_STATUSES)[number];

/** The photo types an organiser may send: the staff upload's, less GIF (a canvas cannot shrink one). */
export const NEWS_PHOTO_MIME = ["image/jpeg", "image/png", "image/webp"] as const;
export type NewsPhotoMime = (typeof NEWS_PHOTO_MIME)[number];

export const NEWS_REFUSED = "Please choose different words for your update.";

/** Only an approved fundraiser with a page has somewhere for its news to go. */
export function canPostNews(f: Pick<FundraiserRecord, "status" | "public" | "path">): boolean {
  return f.status === "approved" && hasPage(f);
}

export function newsLimitReached(postedInLastDay: number): boolean {
  return postedInLastDay >= NEWS_PER_DAY;
}

/** What the update form sends. The photo, if any, is checked separately once it is decoded. */
export const newsPostSchema = z.object({
  text: z.preprocess(
    (v) => (typeof v === "string" ? v.trim() : v),
    z
      .string({ required_error: "Write a few words for your update.", invalid_type_error: "Write a few words for your update." })
      .min(1, "Write a few words for your update.")
      .max(NEWS_MAX, `Keep your update to ${NEWS_MAX} characters or fewer.`)
      .refine((v) => !containsBlockedWord(v), NEWS_REFUSED),
  ),
  photo: z
    .object({ mime: z.string().min(1).max(100), dataBase64: z.string().min(1) })
    .nullable()
    .optional()
    .transform((v) => v ?? null),
});

export type NewsPost = z.infer<typeof newsPostSchema>;

/** What the first bytes say a picture is, or null for anything that is not a JPEG, PNG or WebP. */
export function sniffImageMime(bytes: Uint8Array): NewsPhotoMime | null {
  const b = bytes;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v)) return "image/png";
  const ascii = (from: number, to: number) => String.fromCharCode(...Array.from(b.subarray(from, to)));
  if (b.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}

/**
 * A photo sent with an update: one of the three types, its bytes really that type (so nothing else
 * can be served under a picture's name), and no bigger than the photos staff upload (2 MB).
 */
export function checkNewsPhoto(mime: string, bytes: Uint8Array): { ok: true; mime: NewsPhotoMime } | { ok: false; reason: "type" | "size" } {
  if (!(NEWS_PHOTO_MIME as readonly string[]).includes(mime) || sniffImageMime(bytes) !== mime) return { ok: false, reason: "type" };
  if (bytes.length > MAX_IMAGE_BYTES) return { ok: false, reason: "size" };
  return { ok: true, mime: mime as NewsPhotoMime };
}

const STATUS_WORDS: Record<NewsStatus, string> = {
  pending: "Waiting for us to check",
  approved: "On your page",
  rejected: "Not used",
  hidden: "Not used",
};

/** Where an update is up to, as the organiser reads it. */
export function newsStatusWords(status: NewsStatus): string {
  return STATUS_WORDS[status] ?? "Not used";
}

/** An update as the database holds it, without the photo's bytes. */
export interface NewsRow {
  id: number;
  fundraiserId: number;
  text: string;
  status: NewsStatus;
  /** The photo's own address (a uuid), or null with no photo. */
  photoId: string | null;
  createdAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  /** Why staff did not use it. Internal: never shown to the organiser or the public. */
  rejectReason: string | null;
}

/** One update as the public page shows it. */
export interface NewsEntry {
  id: number;
  text: string;
  createdAt: string;
  photoSrc: string | null;
}

export const newsPhotoSrc = (photoId: string) => `/media/fundraiser-news/${photoId}`;

/** The approved updates, newest first, field by field so nothing internal reaches the page. */
export function publicNews(rows: NewsRow[]): NewsEntry[] {
  return rows
    .filter((r) => r.status === "approved")
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : b.id - a.id))
    .map((r) => ({ id: r.id, text: r.text, createdAt: r.createdAt, photoSrc: r.photoId ? newsPhotoSrc(r.photoId) : null }));
}
