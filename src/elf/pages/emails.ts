import { titleStrip } from "./paper";
import { elfPage, line, sitePath } from "./shell";

// NBCC Elf Detective School, Christmas Eve and the grand prize: the page the small link at the foot of a clue email,
// a promotion or a graduation opens, so a family can stop the emails that are not essential, or start them again.
// The plan is docs/superpowers/plans/2026-11-12-elf-grand-prize.md (Task 7); the design is "Stop these emails" in
// docs/superpowers/specs/2026-11-12-elf-catch-up-and-grand-prize-design.md.
//
// Following a link never changes anything (mail security software opens every link in an email), so the page asks,
// and only its button changes the family's switch (POST /elf/emails/:token in src/routes/elf.ts). It needs no
// script and no sign in: the token in the link is the family's own. It shows nothing of the family, neither its name
// nor its email, so a forwarded email gives nothing away. Detective HQ has the same switch, for a family signed in
// (src/elf/pages/hq.ts).
//
// Pure: no pool, no config, no clock. Unit tested in test/unit/elf-page-emails.test.ts.

/** What always comes, whether the emails are stopped or not: said under the switch here and in Detective HQ. */
export const ALWAYS_COME_WORDS = "Sign in codes, payment receipts and the email when your family finds an elf first always come.";

export interface EmailsView {
  /** Has the family stopped the emails that are not essential? */
  stopped: boolean;
  /** What the page's button has just done: stopped the emails or started them again; null when the page is only
   *  opened from the link. */
  said: "stopped" | "started" | null;
  /** Where the button posts: the link's own address on this site, `/elf/emails/${token}`. */
  postUrl: string;
}

const ASK =
  "Stop the emails from Elf Detective School? You will not get each door's first clue, or the emails when a detective is promoted or graduates. Everything stays in Detective HQ.";
const STOPPED = "You have stopped the emails from Elf Detective School. Everything is still in Detective HQ.";
const SAID: Record<"stopped" | "started", string> = {
  stopped: "Done. We will not send you these emails any more.",
  started: "Done. They will start again with the next clue.",
};

/** The button: it stops the emails while they are on and starts them again once they are stopped, as a plain form
 *  that posts to this site. Nothing for an address that is not on this site. */
function switchForm(post: string | null, stopped: boolean): string {
  if (!post) return "";
  return (
    `<form class="elf-emails" method="post" action="${post}">` +
    `<input type="hidden" name="stopped" value="${stopped ? "no" : "yes"}" />` +
    `<button class="elf-btn elf-btn--crimson" type="submit">${stopped ? "Start them again" : "Stop these emails"}</button>` +
    `</form>`
  );
}

/** The whole of the page. Once its button has been pressed, what it did takes the place of what the page said
 *  before, and the button turns round, so a family that pressed it by mistake can put it back. */
export function renderEmailsPage(view: EmailsView): string {
  const stopped = view.stopped === true;
  const said = view.said === "stopped" || view.said === "started" ? SAID[view.said] : null;
  const now = said ? `<p class="elf-emails__said is-ok" role="status">${said}</p>` : line(stopped ? STOPPED : ASK, "elf-emails__now");
  const main = `  <section class="page-top elf-top elf-emails-top" aria-labelledby="elf-emails-heading">
    <div class="wrap">
      <p class="elf-label">Elf Detective School</p>
      ${titleStrip({ text: "Your emails", tag: "h1", id: "elf-emails-heading" })}
    </div>
  </section>

  <div class="elf-emails-page">
    <div class="wrap">
      <div class="elf-emails-note elf-case elf-note">
        <span class="elf-tape" aria-hidden="true"></span>
        ${now}${switchForm(sitePath(view.postUrl), stopped)}${line(ALWAYS_COME_WORDS, "elf-hint elf-emails__always")}
      </div>
    </div>
  </div>`;

  return elfPage({
    title: "Your emails",
    description: "Stop the emails from NBCC Elf Detective School, or start them again.",
    cta: { href: "/elf/hq", label: "Detective HQ" },
    main,
  });
}
