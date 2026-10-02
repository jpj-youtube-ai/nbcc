import { addBallNavLink } from "./nav-link";
import { addEventsNavLink } from "../events/nav-link";
import { addFundraiseFooterLink } from "../fundraising/footer-link";

// The serve time changes every page gets, for the Festive Ball's own pages, which src/routes/ball.ts
// serves rather than the site router: the Festive Ball menu item (TASK-334), Get involved while that
// page is on (TASK-453), and, while fundraising is on, the footer's "Fundraise for us" pointing at
// the sign up (TASK-494). Pure, so it is tested without Stripe, config or a database. With nothing
// to add, the page comes back exactly as it was given.

export interface BallPageDecor {
  /** Add the Festive Ball menu item (the page itself: reaching it means the ball is visible). */
  ballItem: boolean;
  eventsOn: boolean;
  fundraisingOn: boolean;
}

export function decorateBallPage(html: string, d: BallPageDecor): string {
  let out = html;
  if (d.eventsOn) out = addEventsNavLink(out);
  if (d.ballItem) out = addBallNavLink(out);
  if (d.fundraisingOn) out = addFundraiseFooterLink(out);
  return out;
}
