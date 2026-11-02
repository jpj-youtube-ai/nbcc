// Red bags at the Festive Ball (docs/superpowers/specs/2026-11-02-ball-table-bags-design.md).
//
// On the night (Saturday 7 November 2026) guests scan a table card to /bag and give £50 a red bag.
// The browser sends only a number of bags; the SERVER sets the amount from it (src/routes/api.ts),
// so a forged amount can never change what is charged. Pure: no config, no database, no clock.

/** One red bag, in pence: £50. */
export const BALL_BAG_PENCE = 5000;

/** The most bags one gift may give. */
export const BALL_BAGS_MAX = 20;

/** The giving page, and the thank you Stripe returns to after paying. */
export const BALL_BAGS_PATH = "/bag";
export const BALL_BAGS_THANKS_PATH = "/bag/thank-you";

/** What a number of bags costs, in pence. */
export function ballBagsPence(bags: number): number {
  return bags * BALL_BAG_PENCE;
}
