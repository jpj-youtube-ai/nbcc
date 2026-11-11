import type { WordRefusal } from "../claim";
import { clockWords, listWords, longDayWords, things } from "../words";
import { candyCane, icon } from "./icons";
import { elfPage, escapeHtml, sitePath } from "./shell";
import type { ClaimWin, PosterOutcome, PosterView, VisitWin } from "./types";

// NBCC Elf Detective School: the page a poster's QR code opens. The plan is
// docs/superpowers/plans/2026-10-04-elf-detective-a3-screens.md; the doors in December are
// docs/superpowers/plans/2026-11-10-elf-wave-2-game-1.md (Task 6).
//
// Every hiding place keeps its poster up all month, and its elf stays beside it all December
// (decision 1). Scanning it does one of these:
//   - someone who has not joined is asked to join;
//   - a family types the word on the elf's tag, ticking who is here. The first family to do so wins
//     the prize (one prize per family a year); every family after that, and a family that has won
//     already, collects a candy cane for each detective ticked and puts their elves on the door
//     (decision 3: the word is the proof of a visit, with no location and no photo needed);
//   - after a visit, a family can add a photo to the door. A head elf checks every photo first.
//
// ONE RULE SHAPES THIS PAGE. A poster is only a link, so anyone can open any place's page from
// home. Before its door is open, the page must therefore look exactly the same on the day an elf
// hides at a place as on every day before it, or opening all 24 pages would give the day's place
// away. So the page is told only what the public calendar already shows (posterViewFor), and until
// the elf is found or the door is open it never writes the door's number, its elf's name or its
// state. The words for a refused word keep the same secret: a wrong word is answered the same way
// everywhere (see src/elf/claim.ts).
//
// The form posts to the server like any form. The page's script (assets/js/elf-poster.js) sends it
// without leaving the page and shows the answer, which the server draws with claimWinHtml and
// visitWinHtml here, so the card is the same with or without the script.
//
// Pure: no pool, no config, no clock. Unit tested in test/unit/elf-page-poster.test.ts.

const UNKNOWN = "Something went wrong. Refresh the page and try again.";

const real = (d: unknown): d is Date => d instanceof Date && Number.isFinite(d.getTime());
/** A count as a whole number that is safe to write into the page, whatever a database hands over. */
const count = (n: unknown): number => Math.max(0, Math.floor(Number(n)) || 0);

/** "door 7", or "the practice door" for door 0, for the middle of a sentence. */
const doorWords = (door: unknown): string => (count(door) === 0 ? "the practice door" : `door ${count(door)}`);
/** The same at the start of a sentence: "Door 7", "The practice door". */
const startDoorWords = (door: unknown): string => {
  const words = doorWords(door);
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** What to tell a family whose word was refused. `triesLeft` is how many wrong words they may still
 *  type at this place, when the server knows. */
export function wordRefusalWords(reason: WordRefusal, triesLeft?: number): string {
  switch (reason) {
    case "wrong-word": {
      const left = typeof triesLeft === "number" && Number.isFinite(triesLeft) ? Math.max(0, Math.floor(triesLeft)) : null;
      if (left === 0) return "That is not the right word. That was your last try here.";
      const tries = left === null ? "" : ` You have ${things(left, "try", "tries")} left here.`;
      return `That is not the right word. Check the tag and try again.${tries}`;
    }
    case "too-many-tries":
      return "That is too many wrong words here. If you are holding the elf, show it to the staff: they can phone NBCC and we will sort it out.";
    case "too-early":
      return "That is the right word, but this elf is not out yet. Come back once its clue is on the calendar to claim it.";
    case "gone-home":
      return "This elf has gone home, so its word no longer gives a stamp. Thank you for calling in!";
    case "nothing-new":
      return "Everyone ticked already has this candy cane.";
    case "no-detectives":
      return "Tick who is here.";
    default:
      return UNKNOWN;
  }
}

const link = (url: string, words: string, cls = "elf-link"): string => `<a class="${cls}" href="${sitePath(url) ?? "/"}">${words}</a>`;
const line = (html: string, cls = ""): string => `<p${cls ? ` class="${cls}"` : ""}>${html}</p>`;

/** The gold card a winner shows the staff. Drawn by the server, for the page and for the script. */
export function claimWinHtml(win: ClaimWin): string {
  const names = listWords(win.detectives.map((d) => d.name));
  const elf = escapeHtml(win.elfName);
  const badges = win.detectives
    .map((d) => {
      const src = sitePath(d.elfUrl);
      const name = escapeHtml(d.name);
      return (
        `<li>${src ? `<img src="${src}" alt="${name}'s elf" width="72" height="94" />` : ""}` +
        `<span><b>${name}</b><br />Badge ${escapeHtml(d.badgeNumber)} &middot; ${escapeHtml(d.rank)}</span></li>`
      );
    })
    .join("");
  return (
    `<section class="elf-win" aria-labelledby="elf-win-heading">` +
    `<p class="elf-win__door">${icon("rosette", 18)} ${startDoorWords(win.door)}</p>` +
    `<h2 id="elf-win-heading">You're first!</h2>` +
    `<p class="elf-win__who">${names ? `${escapeHtml(names)} found ${elf}` : `${elf} has been found`} at ${escapeHtml(win.placeName)}.</p>` +
    `<ul class="elf-win__badges">${badges}</ul>` +
    (real(win.at) ? `<p class="elf-win__when">Found at ${clockWords(win.at)} on ${longDayWords(win.at)}</p>` : "") +
    // A clock that ticks tells the real card from a picture of one. The script shows it.
    (real(win.now) ? `<p class="elf-win__now" hidden>The time now is <b class="elf-clock" data-now="${win.now.toISOString()}"></b></p>` : "") +
    // Decision 1: the elf stays at its place all December, and the finder is given the prize.
    `<p class="elf-win__staff"><b>Show this screen to the staff.</b> They will give you the prize. ${elf} stays here for everyone else to find.</p>` +
    `<p class="elf-win__note">Your candy cane for this place has been added too.</p>` +
    `<p class="elf-win__links">${link(win.hqUrl, "Back to Detective HQ", "elf-btn elf-btn--crimson")} ${link(win.calendarUrl, "See the calendar")}</p>` +
    `</section>`
  );
}

/** The sheet for adding a photo to a door: a file to take or pick, the grown up's yes for this one
 *  photo (unticked until they tick it), and the promise. `prefix` keeps its ids apart from another
 *  sheet's on the same page. */
function photoSheet(o: { prefix: string; door: unknown; sendUrl: string; calendarUrl: string }): string {
  const door = doorWords(o.door);
  const send = sitePath(o.sendUrl) ?? "/";
  const id = (part: string): string => `${o.prefix}-${part}`;
  return (
    `<div class="elf-photo-sheet elf-note">` +
    `<span class="elf-tape" aria-hidden="true"></span>` +
    `<h3>Add a photo to ${door}</h3>` +
    line(`It goes behind ${door} on the calendar, in a row of photos with no names.`) +
    `<form class="elf-photo-sheet__form" method="post" action="${send}" enctype="multipart/form-data" data-api="${send}">` +
    // The picture the family has chosen, shown by the page's script before it is sent.
    `<figure class="elf-pol elf-photo-sheet__preview" hidden><span class="elf-pol__shot"></span><figcaption>Your photo</figcaption></figure>` +
    `<div class="elf-field"><label for="${id("photo")}">Take a photo here</label>` +
    `<input id="${id("photo")}" name="photo" type="file" accept="image/*" capture="environment" required /></div>` +
    `<div class="elf-consent elf-tick"><input id="${id("consent")}" name="consent" type="checkbox" value="yes" required />` +
    `<label for="${id("consent")}"><b>Yes, show this photo on ${door}</b> <span>Anyone looking at the calendar will see it. No names go with a photo.</span></label></div>` +
    `<p class="elf-form-status" role="status"></p>` +
    `<button class="elf-btn elf-btn--crimson" type="submit">Send it to the head elves</button>` +
    `</form>` +
    `<p class="elf-photo-sheet__links"><a class="elf-link elf-photo-sheet__skip" href="${sitePath(o.calendarUrl) ?? "/"}">Not this time</a></p>` +
    line("A head elf looks at every photo before anyone else can see it. We take out where and when it was taken. Every photo comes down at the end of January.", "elf-photo-sheet__promise") +
    `</div>`
  );
}

/** The card for a word that earned candy canes: a visit. Their elves are on the door, and they can
 *  add a photo. */
export function visitWinHtml(win: VisitWin): string {
  const names = listWords(win.detectives.map((d) => d.name));
  const door = doorWords(win.door);
  const rows = win.detectives
    .map((d) => {
      const bits = [`<b>${escapeHtml(d.name)}</b>: ${things(count(d.doorsDone), "door")} done.`];
      if (d.promotedTo) bits.push(`<span class="elf-visit__up">Promoted to ${escapeHtml(d.promotedTo)}!</span>`);
      if (count(d.newThings) > 0) bits.push(`${things(count(d.newThings), "new thing")} in the wardrobe. ${link(d.wardrobeUrl, "Dress the elf")}`);
      return `<li>${bits.join(" ")}</li>`;
    })
    .join("");
  return (
    `<section class="elf-visit elf-card elf-card--holly" aria-labelledby="elf-visit-heading">` +
    `<span class="elf-visit__cane">${candyCane(56)}</span>` +
    `<h2 id="elf-visit-heading">${startDoorWords(win.door)} done!</h2>` +
    (names ? line(`${escapeHtml(names)} ${win.detectives.length === 1 ? "has" : "have"} a candy cane stamp for visiting ${escapeHtml(win.placeName)}.`) : "") +
    (real(win.countsFrom) ? line(`It counts from ${clockWords(win.countsFrom)}, when the hiding place is shown.`, "elf-visit__from") : "") +
    `<ul class="elf-visit__who">${rows}</ul>` +
    line(`Your elves are on ${door}.`, "elf-visit__door") +
    photoSheet({ prefix: "elf-visit", door: win.photo.door, sendUrl: win.photo.sendUrl, calendarUrl: win.calendarUrl }) +
    `<p class="elf-visit__links">${link(win.hqUrl, "Back to Detective HQ", "elf-btn elf-btn--s")} ${link(win.calendarUrl, "See the calendar")}</p>` +
    `</section>`
  );
}

// ---- the page's own parts --------------------------------------------------------------------

/** One tick box for each detective. A family with only one to tick has it ticked for them. */
function ticks(prefix: string, legend: string, detectives: PosterView["detectives"]): string {
  const boxes = detectives
    .map((d, i) => {
      const id = `${prefix}-d-${i + 1}`;
      return (
        `<li><input type="checkbox" name="detective" id="${id}" value="${escapeHtml(d.id)}"${detectives.length === 1 ? " checked" : ""} />` +
        `<label for="${id}">${escapeHtml(d.name)}</label></li>`
      );
    })
    .join("");
  return `<fieldset class="elf-ticks"><legend>${legend}</legend><ul>${boxes}</ul></fieldset>`;
}

const status = (words = ""): string => `<p class="elf-form-status${words ? " is-error" : ""}" role="status">${escapeHtml(words)}</p>`;

/** A card on a taped note. */
const note = (cls: string, html: string): string => `<div class="elf-case elf-note ${cls}"><span class="elf-tape" aria-hidden="true"></span>${html}</div>`;

/** The one form: who is here, and the word on the elf's tag. Only the detectives who have not got
 *  this place's candy cane are offered; once everyone has it, there is nothing left to ask. */
function wordCard(view: PosterView, refusal: string): string {
  const have = view.detectives.filter((d) => d.hasStamp);
  const need = view.detectives.filter((d) => !d.hasStamp);
  const haveLine = have.length
    ? `<p class="elf-word__have">${icon("tick", 16)} ${escapeHtml(listWords(have.map((d) => d.name)))} already ${have.length === 1 ? "has" : "have"} this candy cane.</p>`
    : "";
  const form = need.length
    ? `<form class="elf-word" method="post" action="${sitePath(view.wordUrl) ?? "/"}" data-api="/api/elf/word">` +
      `<input type="hidden" name="code" value="${escapeHtml(view.code)}" />` +
      ticks("word", "Who is here?", need) +
      `<div class="elf-field"><label for="elf-word-input">The secret word on the elf's tag</label>` +
      `<input class="elf-word__input" id="elf-word-input" name="word" type="text" required maxlength="60" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" enterkeyhint="done" aria-describedby="elf-word-hint" />` +
      `<p class="elf-hint" id="elf-word-hint">A word and a number, like SNOWBALL 472.</p></div>` +
      status(refusal) +
      `<button class="elf-btn elf-btn--crimson" type="submit">Type in the word</button>` +
      `</form>`
    : "";
  return note("elf-word-card", haveLine + form);
}

/** The family's own photo for this door: waiting, up, or not used, with Take it down (the page's
 *  script sends it) and Send another (opens the sheet again, with no script). */
function yourPhoto(view: PosterView): string {
  const photo = view.yourPhoto;
  if (!photo) return "";
  const said =
    photo.status === "waiting"
      ? "Thank you! A head elf will look at your photo soon."
      : photo.status === "approved"
        ? `Your photo is on ${doorWords(view.door)}.`
        : photo.status === "declined"
          ? "We could not use that photo this time. You are welcome to send another."
          : null;
  if (!said) return "";
  return note(
    "elf-your-photo",
    `<h2>Your photo</h2>` +
      line(said, `elf-your-photo__said${photo.status === "approved" ? " is-ok" : ""}`) +
      (photo.status === "declined" ? "" : `<p class="elf-your-photo__actions"><button class="elf-btn elf-btn--s elf-your-photo__down" type="button">Take it down</button></p>`) +
      `<details class="elf-your-photo__again"><summary class="elf-btn elf-btn--s">Send another</summary>` +
      photoSheet({ prefix: "elf-again", door: view.door, sendUrl: view.photoUrl, calendarUrl: view.calendarUrl }) +
      `</details>`,
  );
}

/** The whole poster page. `outcome` is the answer to a form that was posted with no script. */
export function renderPosterPage(view: PosterView, outcome?: PosterOutcome): string {
  const place = escapeHtml(view.placeName);
  const elf = escapeHtml(view.elfName);
  const calendar = sitePath(view.calendarUrl) ?? "/";
  const result = !outcome || !outcome.ok ? "" : outcome.outcome === "won" ? claimWinHtml(outcome.win) : visitWinHtml(outcome.visit);
  const refusal = outcome && !outcome.ok ? wordRefusalWords(outcome.reason, outcome.triesLeft) : "";

  let lede: string;
  let body: string;
  if (!view.signedIn) {
    lede = `${place}, ${escapeHtml(view.placeTown)}, is one of this year's hiding places in NBCC Elf Detective School.`;
    body = note(
      "elf-join-card",
      `<h2>Want to join the hunt?</h2>` +
        `<p>From 1 to 24 December a cheeky elf hides at a different place each day. Detectives crack the clue, race to find the elf, and collect a candy cane at every place they visit.</p>` +
        `<p class="elf-poster__actions">${link(view.joinUrl, "Join Elf Detective School", "elf-btn elf-btn--crimson")} ${link(view.signInUrl, "I am already a detective", "elf-btn")}</p>`,
    );
  } else if (view.detectives.length === 0) {
    // Signed in, but nobody to tick: the form would be empty.
    lede = `${place} is one of this year's hiding places.`;
    body = note(
      "elf-join-card",
      `<h2>Add a detective first</h2>` +
        `<p>Your family has no detectives yet. Add one at Detective HQ, then scan this poster again.</p>` +
        `<p class="elf-poster__actions">${link(view.hqUrl, "Detective HQ", "elf-btn elf-btn--crimson")}</p>`,
    );
  } else if (view.goneHome) {
    lede = `${elf} has gone home, so there is nothing to find here now. Thank you for calling in!`;
    body = yourPhoto(view);
  } else {
    // The elf is named only once it is found or its door is open: before then the name would tie this
    // place to a door on the calendar, and so to its day.
    const reveal = real(view.revealAt) ? clockWords(view.revealAt) : "";
    lede = view.foundHidden
      ? `${elf} has been found! Type the word on its tag${reveal ? ` and your candy canes count from ${reveal}` : ""}.`
      : view.open
        ? `${elf} is here all December. Type the word on its tag for a candy cane.`
        : "Found the elf? Or here for a candy cane?";
    // An answer that counted brings its own card and its own way on, so the form steps aside.
    body = (outcome?.ok === true ? "" : wordCard(view, refusal)) + yourPhoto(view);
  }

  const main = `  <section class="page-top elf-top elf-poster-top" aria-labelledby="elf-poster-heading">
    <div class="wrap">
      <span class="eyebrow">Elf Detective School</span>
      <h1 id="elf-poster-heading">${place}</h1>
      <p class="lede">${lede}</p>
    </div>
  </section>

  <section class="elf-poster" aria-labelledby="elf-poster-heading">
    <div class="wrap">
      <div id="elf-result" class="elf-result" tabindex="-1" aria-live="polite">${result}</div>
      ${body}
      <p class="elf-grown-up">Under 16? Bring a grown up with you to every hiding place.</p>
      <p class="elf-poster__links"><a class="elf-link" href="${calendar}">See the calendar</a>${view.signedIn ? ` ${link(view.hqUrl, "Detective HQ")}` : ""}</p>
    </div>
  </section>`;

  return elfPage({
    title: view.placeName,
    description: "A hiding place in NBCC Elf Detective School: type the word on the elf's tag to win the prize or collect a candy cane.",
    cta: { href: view.calendarUrl, label: "The calendar" },
    home: view.calendarUrl,
    main,
    scripts: ["elf-poster.js"],
  });
}
