// Fill a Red Bag: the Workshop behind the night look (Jaimie, 5 and 6 November 2026). One bag on its
// shelves for every £50 given through Fill a Red Bag this season, twelve painted stages
// (assets/img/red-bag/workshop/s00 to s12), and a ladder that says which stage a number of bags has
// reached. Pure: the totals come from src/db/red-bag-workshops.ts, the drawing from render.ts.

/** The Workshop never looks empty: it opens with its nearest shelves already stocked. */
export const WORKSHOP_FIRST_STAGE = 3;
/** The last painted stage: the Workshop overflowing. */
export const WORKSHOP_LAST_STAGE = 12;
/** One bag on the shelves, in pence: the page's own full bag. */
export const WORKSHOP_BAG_PENCE = 5000;

/** The private size staff choose for a company (about 20, 100 or 500 people). Never shown. */
export const WORKSHOP_SIZES = ["small", "medium", "large"] as const;
export type WorkshopSize = (typeof WORKSHOP_SIZES)[number];

/**
 * How many bags move the Workshop up each stage after the opening one, "quick start, scaled": the
 * first gifts change it at once and the steps grow after. Nine rungs: stages 4 to 12. The everyday
 * page (everyone's bags) climbs the slowest.
 */
export const LADDERS: Record<WorkshopSize | "everyone", readonly number[]> = {
  small: [1, 2, 3, 5, 7, 10, 13, 16, 20],
  medium: [1, 3, 6, 10, 16, 25, 40, 65, 100],
  large: [1, 5, 15, 30, 60, 110, 180, 300, 500],
  everyone: [2, 10, 30, 60, 120, 220, 360, 600, 1000],
};

export interface WorkshopView {
  stage: number;
  bags: number;
  /** Bags still to come before the next stage; 0 once the last is reached (it keeps counting). */
  nextIn: number;
  /** A company's name, on its own link: the sign is theirs. */
  name?: string;
}

/** What the Workshop shows for `pence` given, on a company's ladder (or everyone's). */
export function workshopView(pence: number, size: WorkshopSize | "everyone", name?: string): WorkshopView {
  const given = Number.isFinite(pence) && pence > 0 ? pence : 0;
  const bags = Math.floor(given / WORKSHOP_BAG_PENCE);
  const rungs = Object.prototype.hasOwnProperty.call(LADDERS, size) ? LADDERS[size] : LADDERS.everyone;
  const reached = rungs.filter((r) => bags >= r).length;
  const next = rungs.find((r) => bags < r);
  const view: WorkshopView = { stage: WORKSHOP_FIRST_STAGE + reached, bags, nextIn: next === undefined ? 0 : next - bags };
  return name ? { ...view, name } : view;
}
