import type { Door } from "../calendar";
import type { WordRefusal } from "../claim";
import type { DoorState } from "../doors";
import type { Rank } from "../progress";
import type { Scrapbook } from "../scrapbook";
import type { ElfLook, WardrobeState } from "../wardrobe";
import type { ElfSettings } from "../settings";

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
  /** When clue 1 comes out, as the calendar shows it (DoorRun.calendarAt). */
  clueAt: Date;
  /** The picture of the prize shape to carve into the door, as a path on this site, or null for
   *  the mystery star. */
  shapeUrl: string | null;
  /** Staff ticked "Show off": the door wears a Big prize pill and the teaser is shown. */
  bigPrize: boolean;
  /** The prize words, before the find, only when staff ticked Show off. */
  teaser: string | null;
  /** The prize words once the elf is found, whatever Show off says. Null until then, and null while
   *  the place is still hidden (found-hidden). */
  prize: string | null;
  /** The name of this door's elf. */
  elfName: string;
  /** Where it was hiding. Null until the door is open. The screens also refuse to show it before
   *  then, whatever is passed in: two locks on the one secret. */
  place: { name: string; town: string } | null;
  /** Who found it, from the moment it is found (even while the place is still hidden), else null.
   *  `by` is PUBLIC: it MUST come from detectiveNames in src/elf/names.ts, which shows a first name
   *  staff have not ticked yet as its first letter. Never familyDetectiveName. */
  found: { at: Date; by: string } | null;
  /** While the elf is found but the place is still hidden: when the place will be shown. */
  revealAt: Date | null;
  /** How many detectives cracked it and how many have visited. Null until the door is open. */
  counts: { cracked: number; visited: number } | null;
  /** The elves and photos on the door. Null until the door is open. */
  scrapbook: Scrapbook | null;
  /** The door tile's mini collage: elf pictures only, never a photo. Empty until the door is open. */
  collage: string[];
  /** Has the door's place sent the elves home? */
  goneHome: boolean;
  /** The short NBCC fact for children. Shown once the door is open. */
  factLine: string | null;
}

export interface CalendarView {
  year: number;
  now: Date;
  /** All 24, door 1 first. */
  doors: DoorView[];
  /** The price as words, set in the admin: from "£1", suggested "£5". */
  price: { from: string; suggested: string };
  joinUrl: string;
  hqUrl: string;
}

/** A family's own marks on the calendar. Private and small: the page's script fetches it. */
export interface FamilyMarks {
  doors: { door: Door; cracked: boolean; visited: boolean; snow: boolean }[];
  /** The family's own photos, so it can take one down from the calendar. */
  photos: { door: Door; token: string; status: "waiting" | "approved" | "declined" }[];
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
  /** The frame the detective chose for their elf's picture (a FRAMES id), or null for a plain mount. */
  frame: string | null;
  /** How many costumes are waiting in the wardrobe as presents to open. */
  newThings: number;
  wardrobeUrl: string;
}

/** Today's case, for a family. Built from the door's state at the moment the page is drawn. */
export interface TodayView {
  /** 1 to 24, or 0 for the practice door. */
  door: Door | 0;
  practice: boolean;
  state: DoorState;
  elfName: string;
  /** The clues that are out, in order, and no others. None on a snow day. */
  clues: { n: 1 | 2 | 3; at: Date; words: string | null; pictureUrl: string | null; pictureAlt: string | null }[];
  /** When the next clue comes out, or null once all three are out (and on a snow day). */
  nextClueAt: Date | null;
  /** When the place is shown. */
  revealAt: Date;
  /** The guess the family typed, as typed, or null. */
  guess: { text: string; at: Date } | null;
  /** Can the family still type or change a guess? */
  canGuess: boolean;
  /** How it ended, once the door is open: where the elf was, who found it (nobody yet for a revealed
   *  door), and whether this family cracked the case. `by` names ANOTHER family's detectives, so
   *  it is public too: it MUST come from detectiveNames, like DoorView.found.by. */
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
  /** Where a signed in family adds another detective (wave 1). Left out, no link is shown. */
  addDetectiveUrl?: string;
}

export interface WardrobeView {
  detective: DetectiveView;
  /** The look as saved, made safe. */
  look: ElfLook;
  /** The doors the detective has done. Build it with wardrobeState in src/elf/wardrobe.ts. */
  state: WardrobeState;
  /** The costumes unlocked and not opened yet, by id: wrapped presents to tap open. */
  fresh: string[];
  /** Up to three favourite looks (Snap a photo), newest first, made safe. */
  favourites: ElfLook[];
  /** Has this elf been made (a look saved) yet? Step 1 folds away once it has. */
  made: boolean;
  /** The moment the page is drawn, so each door's chip says Today, Missed or its day. */
  now: Date;
  /** Doors 1 to 24: each one's clue time (as the calendar has it) and its date, YYYY-MM-DD. */
  doorDays: { door: number; clueAt: Date; date: string }[];
  hqUrl: string;
  /** The calendar: where the school's logo in the bar leads. */
  calendarUrl: string;
  /** Where the form posts when there is no script. */
  saveUrl: string;
}

/** The page a poster's QR code opens. A shut door and a hunting door give the same view, so the page
 *  cannot say whether today is the day an elf hides here. `door` is used only in the outcome cards
 *  and the photo sheet. */
export interface PosterView {
  /** The place's own code from its poster. */
  code: string;
  door: Door | 0;
  /** The name of the door's elf. The page writes it only once the elf is found, the place is open,
   *  or the elves have gone home: before then it would tie the place to a door on the calendar. */
  elfName: string;
  placeName: string;
  placeTown: string;
  /** Is this place's door open? Then visitors can see where it ended up. */
  open: boolean;
  /** Is the elf still there to be claimed? */
  claimable: boolean;
  /** The elf is found but the place is still hidden. */
  foundHidden: boolean;
  /** While found-hidden: when the place is shown. */
  revealAt: Date | null;
  goneHome: boolean;
  signedIn: boolean;
  /** The family's detectives, with who already has this place's candy cane. Empty when nobody is
   *  signed in. Names as the family sees them. */
  detectives: { id: string; name: string; hasStamp: boolean }[];
  /** The family's own photo for this door, if it sent one. */
  yourPhoto: { token: string; status: "waiting" | "approved" | "declined" } | null;
  joinUrl: string;
  signInUrl: string;
  calendarUrl: string;
  hqUrl: string;
  /** Where the word form posts when there is no script. */
  wordUrl: string;
  /** Where a photo is sent. */
  photoUrl: string;
}

/** A word that won: what the gold "You're first!" card shows the staff. */
export interface ClaimWin {
  /** 1 to 24, or 0 for the practice door ("The practice door"). */
  door: Door | 0;
  elfName: string;
  placeName: string;
  /** When the claim arrived, and the server's time as the card is drawn (for the ticking clock). */
  at: Date;
  now: Date;
  /** The badge of each detective who found it: name, number, rank and their elf (decision 13). */
  detectives: { name: string; badgeNumber: string; rank: Rank; elfUrl: string }[];
  calendarUrl: string;
  hqUrl: string;
}

/** A word that earned stamps: a visit. */
export interface VisitWin {
  door: Door | 0;
  placeName: string;
  /** When the visit counts from, when that is later than now; else null. */
  countsFrom: Date | null;
  detectives: {
    name: string;
    doorsDone: number;
    /** The rank this visit has just earned, if it earned one. */
    promotedTo: Rank | null;
    /** How many things this visit has just added to the wardrobe. */
    newThings: number;
    wardrobeUrl: string;
  }[];
  photo: { door: Door | 0; sendUrl: string };
  calendarUrl: string;
  hqUrl: string;
}

/** What happened to a form that was posted with no script, so the page can be drawn with the
 *  answer in it. With the script, the same answers come back from the API instead. */
export type PosterOutcome =
  | { form: "word"; ok: true; outcome: "won"; win: ClaimWin }
  | { form: "word"; ok: true; outcome: "visited"; visit: VisitWin }
  | { form: "word"; ok: false; reason: WordRefusal; triesLeft?: number };

/** The enrol page (wave 1). `values` are what was typed, put back after a refusal, by form field name. */
export interface JoinView {
  settings: ElfSettings;
  /** The Turnstile site key when the robot check is on, or null. */
  captchaSiteKey: string | null;
  surnames: readonly string[];
  errors?: string[];
  values?: Record<string, string>;
  /** A signed in family adding a detective: the grown up is known, so only the detectives and the
   *  payment are asked for. */
  signedIn?: { grownUpName: string; email: string };
}
