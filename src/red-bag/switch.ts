// Fill a Red Bag: THE SWITCH.
//
// One constant, and it is off. While it is off:
//   - /fill-a-red-bag is the site's ordinary 404 to the public, and a preview to a signed in member
//     of staff (src/routes/red-bag.ts);
//   - POST /api/checkout-session refuses a Red Bag gift from anyone but staff (src/routes/api.ts).
//
// GOING LIVE, when Jaimie says, is one small change:
//   1. set RED_BAG_LIVE to true;
//   2. add the link from /donate;
//   3. list the page: add it to SITE_PAGES in src/site/pages.ts (and take it out of PRIVATE_PAGES),
//      and take the noindex line out of fill-a-red-bag.html.
//
// Deliberately a constant in code and not a config value or a database row: nothing here needs
// infrastructure, and switching it on is a reviewed change like any other.
export const RED_BAG_LIVE = false;

/** The page's one address. */
export const RED_BAG_PATH = "/fill-a-red-bag";

/** Is the page public? Asked through a function so each caller reads it when it is needed. */
export function redBagIsLive(): boolean {
  return RED_BAG_LIVE;
}

/**
 * What a visitor gets. "open": the page. "preview": the page with the "Staff preview" strip.
 * "closed": the site's 404, exactly as if the page did not exist.
 */
export type RedBagAccess = "open" | "preview" | "closed";

export function redBagAccess(live: boolean, staff: boolean): RedBagAccess {
  if (live) return "open";
  return staff ? "preview" : "closed";
}
