// Fill a Red Bag: THE SWITCH.
//
// One constant, and it is ON: the page is PUBLIC (Jaimie, 4 October 2026: "make it public but don't
// link anywhere to it right now").
//   - /fill-a-red-bag is the page, for everyone (src/routes/red-bag.ts);
//   - POST /api/checkout-session takes a Red Bag gift from anyone (src/routes/api.ts);
//   - /fill and /fill-a-bag forward to the page (src/routes/red-bag.ts).
//
// Public, but deliberately UNLINKED and UNLISTED for now. Nothing on the site links to it (not
// /donate, not the menu, not the footer), it is on no site map, and it tells search engines to
// leave it alone (the robots line in fill-a-red-bag.html, and the X-Robots-Tag header the route
// sends). People reach it only if they are given the address. test/unit/red-bag-page.test.ts holds
// all of that in place.
//
// WHAT IS LEFT, when Jaimie says:
//   a. add the link from /donate;
//   b. list the page: add it to SITE_PAGES in src/site/pages.ts (and take it out of PRIVATE_PAGES),
//      take the noindex line out of fill-a-red-bag.html, and take the X-Robots-Tag line for the
//      live page out of src/routes/red-bag.ts.
//
// TO TAKE IT DOWN AGAIN: set RED_BAG_LIVE to false. That one line is enough: the public gets the
// site's ordinary 404 at the address (and at /fill and /fill-a-bag, which stop forwarding), a
// signed in member of staff gets a preview under a "Staff preview: not public yet" strip, and the
// checkout refuses a Red Bag gift from anyone but staff.
// That path is kept and tested for exactly this.
//
// Deliberately a constant in code and not a config value or a database row: nothing here needs
// infrastructure, and switching it is a reviewed change like any other.
export const RED_BAG_LIVE = true;

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
