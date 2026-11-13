import { clockWords } from "../words";
import { titleStrip } from "./paper";
import { elfPage, escapeHtml, line, real, sitePath } from "./shell";
import type { EntryView } from "./types";

// NBCC Elf Detective School, Christmas Eve and the grand prize: the page where a family sends in a graduate's
// picture for the grand prize, from Detective HQ. The plan is docs/superpowers/plans/2026-11-12-elf-grand-prize.md
// (Task 3); the design is part 2 of docs/superpowers/specs/2026-11-12-elf-catch-up-and-grand-prize-design.md.
//
// One picture a detective: a drawing, or a photo of the family's naughtiest elf at home. Until the entries close
// the family can send a new one in its place; once they have closed, the page says so and has no form. The
// picture in is shown here to its own family only (the picture's address answers no one else), and the page
// never asks for an age.
//
// Sending needs the page's script (assets/js/elf-entry.js), as a door's photo does: it makes the picture
// smaller in the browser and sends it as JSON. The form still posts to this site like any form.
//
// Pure: no pool, no config, no clock (the time is in the view). Unit tested in
// test/unit/elf-page-entry.test.ts.

/** The picture already in, as its family sees it, under its own address on this site; nothing for any other. Its
 *  real size is not known here: the stylesheet fits it inside the note, whatever its shape. */
function pictureHtml(view: EntryView, name: string): string {
  const src = view.sent ? sitePath(view.sent.pictureUrl) : null;
  return src ? `<img class="elf-entry__pic" src="${src}" alt="${name}'s picture" width="800" height="600" decoding="async" />` : "";
}

/** The form: the picture, the family's mobile when it has none (the join form's words and check), the status
 *  line the script answers in, and the button. */
function formHtml(view: EntryView, post: string): string {
  const mobile = view.askMobile === true
    ? `<div class="elf-field"><label for="elf-entry-mobile">Mobile number</label>` +
      `<p class="elf-hint" id="elf-entry-mobile-hint">So we can ring you straight away if one of your detectives wins the grand prize on Christmas Eve. We only use it for that.</p>` +
      `<input id="elf-entry-mobile" name="mobile" type="tel" maxlength="20" autocomplete="tel" inputmode="tel" required aria-describedby="elf-entry-mobile-hint" /></div>`
    : "";
  return (
    `<form class="elf-entry" method="post" action="${post}" enctype="multipart/form-data" data-api="${post}">` +
    `<div class="elf-field"><label for="elf-entry-picture">Your picture</label>` +
    `<input id="elf-entry-picture" name="picture" type="file" accept="image/*" required /></div>` +
    mobile +
    `<p class="elf-form-status" role="status"></p>` +
    `<button class="elf-btn elf-btn--crimson" type="submit">${view.sent ? "Send a new picture" : "Send it to the head elves"}</button>` +
    `</form>`
  );
}

/** The whole of the entry page. */
export function renderEntryPage(view: EntryView): string {
  const name = escapeHtml(view.detective.name);
  const time = real(view.closesAt) ? clockWords(view.closesAt) : "";
  const post = sitePath(view.postUrl);
  const hq = sitePath(view.hqUrl) ?? "/elf/hq";
  const open = view.open === true;
  const sent = view.sent !== null && typeof view.sent === "object";
  const picture = pictureHtml(view, name);
  // Once a picture is in, the page says so under it: until when it can be changed while the entries are open.
  const isIn = sent
    ? line(`${name}'s picture is in.${open && time ? ` You can change it until ${time} on Christmas Eve.` : ""}`, "elf-entry__in")
    : "";
  const when = open ? (sent || !time ? "" : line(`Entries close at ${time} on Christmas Eve.`, "elf-entry__closes")) : time ? line(`Grand prize entries closed at ${time} on Christmas Eve.`, "elf-entry__closes") : "";
  const form = open && post ? formHtml(view, post) : "";
  const promise =
    form || sent
      ? line(
          "We make the picture again, so nothing from the camera is kept: not where, not when, not the phone. Only the head elves see it, and it is deleted at the end of January.",
          "elf-entry__promise",
        )
      : "";
  const main = `  <section class="page-top elf-top elf-entry-top" aria-labelledby="elf-entry-heading">
    <div class="wrap">
      <p class="elf-label">Detective HQ</p>
      ${titleStrip({ text: "Send in your picture", tag: "h1", id: "elf-entry-heading" })}
      <p class="lede elf-entry__for">For ${name}, for the grand prize: a drawing, or a photo of your naughtiest elf at home.</p>
    </div>
  </section>

  <div class="elf-entry-page">
    <div class="wrap">
      <div class="elf-entry-note elf-case elf-note">
        <span class="elf-tape" aria-hidden="true"></span>
        ${picture}${isIn}${when}${form}${promise}
      </div>
      <p class="elf-entry__back"><a class="elf-btn" href="${hq}">Back to Detective HQ</a></p>
    </div>
  </div>`;

  return elfPage({
    title: "Send in your picture",
    description: "Your family's picture for the NBCC Elf Detective School grand prize: a drawing, or a photo of your naughtiest elf at home.",
    cta: { href: hq, label: "Detective HQ" },
    main,
    scripts: ["elf-entry.js"],
  });
}
