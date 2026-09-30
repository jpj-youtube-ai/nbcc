// TASK-478: the New pills in the admin. Pure rules only: which sections can carry a pill, who may
// see each, and whether one is new to a person. The SQL is in src/db/whats-new.ts and the routes in
// src/routes/admin-whats-new.ts. See docs/superpowers/specs/2026-09-30-admin-new-pills-design.md.

import { can, type PermissionMap, type Section } from "./permissions";

export type Area = "contact" | "stories" | "donations" | "monthly" | "fulfilments" | "ball" | "newsletter" | "events";

// Each is the menu section (its data-view) and the gate its menu link uses in admin.html, so a pill
// never sits on a section the person cannot open. Every one except events also has arrivals, the
// query for which is in src/db/whats-new.ts.
export const AREAS: ReadonlyArray<{ area: Area; section: Section; level: "view" | "edit" }> = [
  { area: "contact", section: "contact", level: "view" },
  { area: "stories", section: "stories", level: "view" },
  { area: "donations", section: "donations", level: "view" },
  { area: "monthly", section: "donations", level: "view" },
  { area: "fulfilments", section: "business-supporters", level: "edit" },
  { area: "ball", section: "ball", level: "view" },
  { area: "newsletter", section: "newsletter", level: "view" },
  { area: "events", section: "events", level: "view" },
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
  if (input.latestArrival && input.latestArrival > since) return true;
  return featureIsNew(input.area, input.seenAt, input.accountCreatedAt, input.features);
}
