import type { Door } from "../calendar";
import type { DoorState } from "../doors";
import type { Rank } from "../progress";
import type { ElfLook, WardrobeState } from "../wardrobe";

// NBCC Elf Detective School: what each screen is given. The plan is
// docs/superpowers/plans/2026-10-04-elf-detective-a3-screens.md.
//
// A screen is a function from one of these views to a page. The view already holds every answer:
// a screen never works a rule out for itself, never reads a clock and never looks anything up. So
// the same screens run on pretend data today and on the database later, and a test can show a
// screen any state it likes.
//
// Types only. Nothing here runs.

/** One door as the public calendar shows it. The same for every visitor, so it can be cached. */
export interface DoorView {
  door: Door;
  state: DoorState;
  /** When the clue comes out. */
  clueAt: Date;
  /** The picture of the prize shape to carve into the door, as a path on this site, or null for
   *  the mystery star. */
  shapeUrl: string | null;
  /** Staff ticked "Show off": the door wears a Big prize pill and the teaser is shown. */
  bigPrize: boolean;
  teaser: string | null;
  /** The name of this door's elf. */
  elfName: string;
  /** Where it was hiding. Shown only once the door is open, whatever is passed in. */
  place: { name: string; town: string } | null;
  /** Who found it. Null until it is found. `by` is the detective names as people read them. */
  found: { at: Date; by: string; elfUrl: string; photoUrl: string | null } | null;
  /** How many detectives cracked it and how many have visited. Null until the door is open. */
  counts: { cracked: number; visited: number } | null;
  /** The short NBCC fact for children. Shown once the door is open. */
  factLine: string | null;
}

export interface CalendarView {
  year: number;
  now: Date;
  /** All 24, door 1 first. */
  doors: DoorView[];
  /** Every hiding place, public from the start, without its day. */
  places: { name: string; town: string; found: boolean }[];
  /** The price as words, set in the admin: from "£1", suggested "£5". */
  price: { from: string; suggested: string };
  joinUrl: string;
  hqUrl: string;
}

/** A family's own marks on the calendar. Private and small: the page's script fetches it. */
export interface FamilyMarks {
  doors: { door: Door; cracked: boolean; visited: boolean }[];
}

export interface DetectiveView {
  id: string;
  /** The name as the family sees it, from familyDetectiveName: "Detective Ruby Tinselfoot". */
  name: string;
  /** Has a member of staff ticked the first name yet? Until then the public sees its first letter. */
  nameApproved: boolean;
  badgeNumber: string;
  rank: Rank;
  doorsDone: number;
  next: { rank: Rank; toGo: number } | null;
  graduate: boolean;
  goldSeal: boolean;
  elfUrl: string;
  /** How many things in the wardrobe have not been tried on yet. */
  newThings: number;
  wardrobeUrl: string;
}

/** Today's case, for a family. Built from the door's state at the moment the page is drawn. */
export interface TodayView {
  door: Door;
  state: DoorState;
  clueAt: Date;
  elfName: string;
  /** The clue, once it is out. Never before. */
  clue: string | null;
  /** The places a family can still guess from, while the elf is hunted. */
  options: { id: string; name: string; town: string }[];
  /** The place the family has guessed, or null. `name` is there so it can be said once the door is
   *  open and the place is no longer one of the options. */
  guess: { id: string; name: string; town: string } | null;
  /** How it ended, once the door is open: where the elf was, who found it (nobody yet for a revealed
   *  door), and whether this family cracked the case. */
  outcome: { place: string; by: string | null; at: Date | null; cracked: boolean } | null;
}

export interface HqView {
  now: Date;
  /** The grown up's first name, for the greeting. */
  familyName: string;
  detectives: DetectiveView[];
  /** Today's case, or null on a day with no door (before 1 December, after Christmas Eve). */
  today: TodayView | null;
  /** When the next clue comes out, for a day with no case of its own. */
  nextClueAt: Date | null;
  marks: FamilyMarks;
  calendarUrl: string;
  /** Where the guess form posts when there is no script. */
  guessUrl: string;
}

export interface WardrobeView {
  detective: DetectiveView;
  /** The look as saved. It is made safe again before it is drawn. */
  look: ElfLook;
  /** What the detective has earned. Build it with wardrobeState in src/elf/wardrobe.ts. */
  state: WardrobeState;
  /** What has not been tried on yet: "style:colour" for a piece, the id for an outfit. */
  fresh: string[];
  hqUrl: string;
  /** Where the form posts when there is no script. */
  saveUrl: string;
}

export interface PosterView {
  /** The place's own code from its poster. The page never says which door it belongs to. */
  code: string;
  placeName: string;
  /** Only what the public calendar already shows: is this place's door open? */
  open: boolean;
  /** Is the elf still there to be claimed? True unless the door is found. */
  claimable: boolean;
  signedIn: boolean;
  detectives: { id: string; name: string; hasStamp: boolean }[];
  joinUrl: string;
  calendarUrl: string;
}
