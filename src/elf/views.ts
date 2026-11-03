import { doorInstant } from "./calendar";
import { badgeWords } from "./emails";
import { familyDetectiveName } from "./names";
import { progressOf } from "./progress";
import type { ElfSettings } from "./settings";
import { SLOTS, defaultLook, wardrobeState, type ElfLook } from "./wardrobe";
import type { DetectiveView, HqView, WardrobeView } from "./pages/types";

// NBCC Elf Detective School: what the database holds, turned into what the screens show (wave 1
// plan, Tasks 7 and 8). Pure: the rows come in, the views go out. In wave 1 no door has opened, so
// every detective has 0 doors done; wave 2 brings the cracked and visited doors in here.
// Unit tested in test/unit/elf-views.test.ts.

export interface DetectiveRow {
  id: number;
  firstName: string;
  surname: string;
  nameApproved: boolean;
  badgeNumber: number | null;
  look: unknown;
  fresh: string[];
}

export interface FamilyRow {
  id: number;
  grownUpName: string;
  detectives: DetectiveRow[];
}

/** When school starts: door 1's first clue, at 5:30pm London time. */
export function firstClueAt(year: number): Date {
  return doorInstant({ year }, 1, "17:30") ?? new Date(Date.UTC(year, 11, 1, 17, 30));
}

/** What a detective has earned so far. Wave 1: nothing yet. */
function earned() {
  const progress = progressOf({ cracked: [], visited: [] });
  return { progress, state: wardrobeState(progress, false) };
}

export function detectiveViewFor(d: DetectiveRow): DetectiveView {
  const { progress } = earned();
  return {
    id: String(d.id),
    // A family always sees its own detectives' names in full.
    name: familyDetectiveName({ firstName: d.firstName, surname: d.surname, approved: true }),
    nameApproved: d.nameApproved,
    badgeNumber: d.badgeNumber === null ? "" : badgeWords(d.badgeNumber),
    rank: progress.rank,
    doorsDone: progress.doorsDone,
    next: progress.next ? { rank: progress.next.rank, toGo: progress.next.toGo } : null,
    graduate: progress.graduate,
    goldSeal: progress.goldSeal,
    elfUrl: `/elf/hq/elf/${d.id}.svg`,
    newThings: d.fresh.length,
    wardrobeUrl: `/elf/hq/wardrobe/${d.id}`,
  };
}

function firstWord(name: string): string {
  return name.trim().split(/\s+/)[0] ?? "";
}

export function hqViewFor(o: { family: FamilyRow; settings: ElfSettings; now: Date }): HqView {
  const start = firstClueAt(o.settings.year);
  return {
    now: o.now,
    familyName: firstWord(o.family.grownUpName),
    detectives: o.family.detectives.map(detectiveViewFor),
    today: null,
    nextClueAt: o.now.getTime() < start.getTime() ? start : null,
    marks: { doors: [] },
    calendarUrl: "/elf",
    guessUrl: "/api/elf/guess",
  };
}

export function wardrobeViewFor(o: { detective: DetectiveRow; settings: ElfSettings }): WardrobeView {
  const { state } = earned();
  return {
    detective: detectiveViewFor(o.detective),
    look: (o.detective.look as ElfLook | null) ?? defaultLook(),
    state,
    fresh: o.detective.fresh,
    hqUrl: "/elf/hq",
    calendarUrl: "/elf",
    saveUrl: "/api/elf/look",
  };
}

/** What the server builds the wardrobe state from in wave 1, for saving a look. */
export function wardrobeStateNow() {
  return earned().state;
}

/** A look as the plain wardrobe form sends it (no script): skin, hair, hairStyle, outfit, and one
 *  piece-<slot> field of "style:colour" for each slot. normaliseLook makes it safe afterwards. */
export function lookFromForm(form: Record<string, unknown>): Record<string, unknown> {
  const text = (v: unknown) => (typeof v === "string" ? v : "");
  const pieces: Record<string, [string, string] | null> = {};
  for (const slot of SLOTS) {
    const [style, colour] = text(form[`piece-${slot.id}`]).split(":");
    pieces[slot.id] = style && colour ? [style, colour] : null;
  }
  return { skin: text(form.skin), hair: text(form.hair), hairStyle: text(form.hairStyle), outfit: text(form.outfit) || null, pieces };
}
