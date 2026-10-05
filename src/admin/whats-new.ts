// TASK-478: the New pills in the admin. Pure rules only: which sections can carry a pill, who may
// see each, and whether one is new to a person. The SQL is in src/db/whats-new.ts and the routes in
// src/routes/admin-whats-new.ts. See docs/superpowers/specs/2026-09-30-admin-new-pills-design.md.

import { can, type PermissionMap, type Section } from "./permissions";

export type Area =
  | "contact"
  | "stories"
  | "donations"
  | "monthly"
  | "fulfilments"
  | "ball"
  | "newsletter"
  | "events"
  | "analytics"
  | "qr"
  | "fundraising";

// Each is the menu section (its data-view) and the gate its menu link uses in admin.html, so a pill
// never sits on a section the person cannot open. Every one except events and analytics also has
// arrivals, the query for which is in src/db/whats-new.ts.
export const AREAS: ReadonlyArray<{ area: Area; section: Section; level: "view" | "edit" }> = [
  { area: "contact", section: "contact", level: "view" },
  { area: "stories", section: "stories", level: "view" },
  { area: "donations", section: "donations", level: "view" },
  { area: "monthly", section: "donations", level: "view" },
  { area: "fulfilments", section: "business-supporters", level: "edit" },
  { area: "ball", section: "ball", level: "view" },
  { area: "newsletter", section: "newsletter", level: "view" },
  { area: "events", section: "events", level: "view" },
  // TASK-482: Admin > Analytics. New as a screen only: page views are not news to tell staff about.
  { area: "analytics", section: "analytics", level: "view" },
  // TASK-492: QR codes. No permission of its own: its menu link gates on Site pages.
  { area: "qr", section: "site", level: "view" },
  // TASK-493: Admin > Fundraising. Each new sign up at /fundraise is an arrival.
  { area: "fundraising", section: "fundraising", level: "view" },
];

export function isArea(value: unknown): value is Area {
  return AREAS.some((a) => a.area === value);
}

// New parts of the admin. When you ship a new screen, or a change staff should notice, add a line
// here: everyone whose account is older than it sees a New pill on that section until they open it.
export const FEATURES: ReadonlyArray<{ area: Area; added: Date; what: string }> = [
  { area: "events", added: new Date("2026-09-30T12:00:00Z"), what: "The Events page and its ticket report (TASK-453, TASK-464)" },
  { area: "monthly", added: new Date("2026-09-30T12:00:00Z"), what: "Monthly givers (TASK-447)" },
  { area: "stories", added: new Date("2026-09-30T12:00:00Z"), what: "Stories brought in from the old website (TASK-461)" },
  { area: "analytics", added: new Date("2026-10-01T12:00:00Z"), what: "Admin > Analytics: where visitors come from and what they look at (TASK-482)" },
  { area: "qr", added: new Date("2026-10-02T12:00:00Z"), what: "QR codes for every page, to print or share (TASK-492)" },
  { area: "fundraising", added: new Date("2026-10-02T12:00:00Z"), what: "Admin > Fundraising: approve sign ups, check changes, record cash and look after the supporter wall (TASK-495)" },
  { area: "donations", added: new Date("2026-10-06T12:00:00Z"), what: "Donations: Fill a Red Bag against the Donate page, a Red Bag label on each gift and a Fill a Red Bag only filter" },
];

// When the pills went live. Someone who has never opened a section is counted as having seen it
// then (or when their account was made, if later), so launch day does not light up years of old
// records.
export const LAUNCH_AT = new Date("2026-09-30T00:00:00Z");

export function reachableAreas(perms: PermissionMap) {
  return AREAS.filter((a) => can(perms, a.section, a.level));
}

// The moment arrivals are counted from: the person's last visit, or failing that the later of
// launch and their account being made.
export function arrivalsSince(seenAt: Date | null, accountCreatedAt: Date): Date {
  if (seenAt) return seenAt;
  return accountCreatedAt > LAUNCH_AT ? accountCreatedAt : LAUNCH_AT;
}

// A new part of the admin is new to someone whose account is older than it and who has not opened
// that section since it was added.
export function featureIsNew(
  area: Area,
  seenAt: Date | null,
  accountCreatedAt: Date,
  features: ReadonlyArray<{ area: Area; added: Date }> = FEATURES,
): boolean {
  const since = seenAt ?? accountCreatedAt;
  return features.some((f) => f.area === area && f.added > since);
}

export function isNew(input: {
  area: Area;
  seenAt: Date | null;
  accountCreatedAt: Date;
  latestArrival: Date | null;
  features?: ReadonlyArray<{ area: Area; added: Date }>;
}): boolean {
  const since = arrivalsSince(input.seenAt, input.accountCreatedAt);
  // At or after, not strictly after: the database keeps microseconds and has already found this
  // arrival strictly later than `since`, but both reach us cut to milliseconds, so one that came in
  // within the same millisecond looks equal here. `>` would throw it away.
  if (input.latestArrival && input.latestArrival >= since) return true;
  return featureIsNew(input.area, input.seenAt, input.accountCreatedAt, input.features);
}
