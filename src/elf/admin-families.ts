import { z } from "zod";
import { cleanFirstName, isFestiveSurname } from "./names";
import { firstNameRefusalWords } from "./join";

// NBCC Elf Detective School: what a head elf may change about a family in Head Elf HQ, and the
// Families list's filters. Design: docs/superpowers/specs/2026-11-05-elf-admin-design.md (decisions 5
// and 7): the same rules as enrolling, and a changed name is checked again before it shows in public.
// Pure: no pool. Unit tested in test/unit/elf-admin-families.test.ts.

/** The Families list's filters: everyone, names waiting for a tick, enrolled this week, removed. */
export type FamilyFilter = "all" | "check" | "week" | "removed";
const FILTERS: readonly FamilyFilter[] = ["all", "check", "week", "removed"];

/** A filter from the address, with anything it does not know read as everyone. */
export function familyFilter(sent: unknown): FamilyFilter {
  return typeof sent === "string" && (FILTERS as readonly string[]).includes(sent) ? (sent as FamilyFilter) : "all";
}

export interface DetectiveChange {
  firstName?: string;
  surname?: string;
  /** Whether the first name may show in public. */
  approved?: boolean;
}

const NOTHING = "Nothing to change.";
type Parsed<T> = { ok: true; change: T } | { ok: false; error: string };

/** A change to a detective: a first name and a festive surname as enrolling takes them, and the tick.
 *  A changed name loses its tick, unless the same change ticks it. */
export function parseDetectiveChange(sent: unknown): Parsed<DetectiveChange> {
  const s = sent && typeof sent === "object" ? (sent as Record<string, unknown>) : {};
  const change: DetectiveChange = {};
  if ("firstName" in s) {
    const first = cleanFirstName(s.firstName);
    if (!first.ok) return { ok: false, error: firstNameRefusalWords(first.reason) };
    change.firstName = first.name;
  }
  if ("surname" in s) {
    if (typeof s.surname !== "string" || !isFestiveSurname(s.surname)) return { ok: false, error: "Please choose a festive surname from the list." };
    change.surname = s.surname;
  }
  if (typeof s.approved === "boolean") change.approved = s.approved;
  const renamed = change.firstName !== undefined || change.surname !== undefined;
  if (!renamed && change.approved === undefined) return { ok: false, error: NOTHING };
  if (renamed && change.approved !== true) change.approved = false;
  return { ok: true, change };
}

export interface FamilyChange {
  grownUpName?: string;
  email?: string;
}

const emailSchema = z.string().email().max(200);

/** A change to a family's details: the grown up's name and email, tidied as enrolling tidies them. */
export function parseFamilyChange(sent: unknown): Parsed<FamilyChange> {
  const s = sent && typeof sent === "object" ? (sent as Record<string, unknown>) : {};
  const change: FamilyChange = {};
  if ("grownUpName" in s) {
    const name = typeof s.grownUpName === "string" ? s.grownUpName.trim().replace(/\s+/g, " ") : "";
    if (!name) return { ok: false, error: "Please give the grown up's name." };
    if (name.length > 80) return { ok: false, error: "Please keep the grown up's name to 80 letters or fewer." };
    change.grownUpName = name;
  }
  if ("email" in s) {
    const email = typeof s.email === "string" ? s.email.trim().toLowerCase() : "";
    if (!emailSchema.safeParse(email).success) return { ok: false, error: "Please give an email address we can reach them at." };
    change.email = email;
  }
  if (change.grownUpName === undefined && change.email === undefined) return { ok: false, error: NOTHING };
  return { ok: true, change };
}
