import type { ClaimRefusal } from "../claim";
import { isOpen, type DoorState } from "../doors";
import type { StampRefusal } from "../stamps";
import { clockWords, listWords, longDayWords, things } from "../words";
import { candyCane, icon } from "./icons";
import { elfPage, escapeHtml, sitePath } from "./shell";
import type { ClaimWin, PosterOutcome, PosterView, StampWin } from "./types";

// NBCC Elf Detective School: the page a poster's QR code opens. The plan is
// docs/superpowers/plans/2026-10-04-elf-detective-a3-screens.md.
//
// Every hiding place keeps its poster up all month. Scanning it does one of three things:
//   - someone who has not joined is asked to join;
//   - a family claims the elf, by ticking who found it and typing the secret word on its tag;
//   - once the place's door is open on the calendar, a family checks in for a candy cane, with
//     the phone's location (the page's script) or a photo taken there (works with no script).
//
// ONE RULE SHAPES THIS PAGE. A poster is only a link, so anyone can open any place's page from
// home. The page must therefore look exactly the same on the day an elf hides at a place as on
// every day before it, or opening all 24 pages would give the day's place away. So the page is
// told only what the public calendar already shows (posterState below): never the door's number,
// its state or its clue time. The words for a refused claim keep the same secret: a wrong word is
// answered the same way everywhere (see src/elf/claim.ts).
//
// Both forms post to the server like any form. The page's script (assets/js/elf-poster.js) sends
// them without leaving the page and shows the answer, which the server draws with claimWinHtml and
// stampWinHtml here, so the card is the same with or without the script.
//
// Pure: no pool, no config, no clock. Unit tested in test/unit/elf-page-poster.test.ts.

/** What the poster page may know about its place's door: only what the calendar shows everyone.
 *  A shut door and a door whose elf is being hunted give the same answer, on purpose. */
export function posterState(doorState: DoorState): Pick<PosterView, "open" | "claimable"> {
  return { open: isOpen(doorState), claimable: doorState !== "found" };
}

const UNKNOWN = "Something went wrong. Refresh the page and try again.";

const real = (d: Date): boolean => d instanceof Date && Number.isFinite(d.getTime());
/** A count as a whole number that is safe to write into the page, whatever a database hands over. */
const count = (n: unknown): number => Math.max(0, Math.floor(Number(n)) || 0);

/** What to tell a family whose claim was refused. `triesLeft` is how many wrong words they may
 *  still type at this place, when the server knows. */
export function claimRefusalWords(reason: ClaimRefusal, triesLeft?: number): string {
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
    case "already-found":
      return "This elf has already been found.";
    case "already-won":
      return "Well spotted! Your family has already won an elf this year, and it is one elf for each family. Please leave this one hiding for the next detective.";
    case "no-detectives":
      return "Tick who found the elf.";
    default:
      return UNKNOWN;
  }
}

/** What to tell a family whose check in was refused. */
export function stampRefusalWords(reason: StampRefusal): string {
  switch (reason) {
    case "door-not-open":
      return "This place's door has not opened yet. Come back once it has.";
    case "no-detectives":
      return "Tick who is here.";
    case "nothing-new":
      return "Everyone ticked already has this candy cane.";
    case "too-far":
      return "Your phone looks too far from here. Move closer and try again, or take a photo here instead.";
    case "place-unknown":
      return "We cannot check locations at this place yet. Please take a photo here instead.";
    case "no-proof":
      return "We need your location or a photo taken here.";
    default:
      return UNKNOWN;
  }
}

const link = (url: string, words: string, cls = "elf-link"): string => `<a class="${cls}" href="${sitePath(url) ?? "/"}">${words}</a>`;

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
    `<p class="elf-win__door">${icon("rosette", 18)} Door ${count(win.door)}</p>` +
    `<h2 id="elf-win-heading">You're first!</h2>` +
    `<p class="elf-win__who">${names ? `${escapeHtml(names)} found ${elf}` : `${elf} has been found`} at ${escapeHtml(win.placeName)}.</p>` +
    `<ul class="elf-win__badges">${badges}</ul>` +
    (real(win.at) ? `<p class="elf-win__when">Found at ${clockWords(win.at)} on ${longDayWords(win.at)}</p>` : "") +
    // A clock that ticks tells the real card from a picture of one. The script shows it.
    (real(win.now) ? `<p class="elf-win__now" hidden>The time now is <b class="elf-clock" data-now="${win.now.toISOString()}"></b></p>` : "") +
    `<p class="elf-win__staff"><b>Show this screen to the staff.</b> They will hand over ${elf} and the prize.</p>` +
    `<p class="elf-win__note">Your candy cane for this place has been added too.</p>` +
    `<p class="elf-win__links">${link(win.hqUrl, "Back to Detective HQ", "btn btn-primary")} ${link(win.calendarUrl, "See the calendar")}</p>` +
    `</section>`
  );
}

/** The card for a check in that earned candy canes. */
export function stampWinHtml(win: StampWin): string {
  const names = listWords(win.detectives.map((d) => d.name));
  const rows = win.detectives
    .map((d) => {
      const bits = [`<b>${escapeHtml(d.name)}</b>: ${things(count(d.doorsDone), "door")} done.`];
      if (d.promotedTo) bits.push(`<span class="elf-stamped__up">Promoted to ${escapeHtml(d.promotedTo)}!</span>`);
      if (count(d.newThings) > 0) bits.push(`${things(count(d.newThings), "new thing")} in the wardrobe. ${link(d.wardrobeUrl, "Dress the elf")}`);
      return `<li>${bits.join(" ")}</li>`;
    })
    .join("");
  return (
    `<section class="elf-stamped" aria-labelledby="elf-stamped-heading">` +
    `<span class="elf-stamped__cane">${candyCane(56)}</span>` +
    `<h2 id="elf-stamped-heading">Candy cane collected!</h2>` +
    `<p>${escapeHtml(names)} ${win.detectives.length === 1 ? "has" : "have"} visited ${escapeHtml(win.placeName)}.</p>` +
    `<ul class="elf-stamped__who">${rows}</ul>` +
    `<p class="elf-stamped__links">${link(win.hqUrl, "Back to Detective HQ", "btn btn-primary")} ${link(win.calendarUrl, "See the calendar")}</p>` +
    `</section>`
  );
}

// ---- the forms ------------------------------------------------------------------------------

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

function claimCard(view: PosterView, refusal: string): string {
  const intro = view.open
    ? "Nobody found this elf in time, so it is still waiting here. The first detective to read its secret word wins it."
    : "Tick who found it, then type the secret word on its tag.";
  return (
    `<div class="elf-case elf-claim-card">` +
    `<h2>Found the elf?</h2>` +
    `<p>${intro}</p>` +
    `<form class="elf-claim" method="post" action="${sitePath(view.claimUrl) ?? "/"}" data-api="/api/elf/claim">` +
    `<input type="hidden" name="code" value="${escapeHtml(view.code)}" />` +
    ticks("claim", "Who found it?", view.detectives) +
    `<div class="elf-field"><label for="elf-word">The secret word on the elf's tag</label>` +
    `<input class="elf-word" id="elf-word" name="word" type="text" required maxlength="60" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" enterkeyhint="done" aria-describedby="elf-word-hint" />` +
    `<p class="elf-hint" id="elf-word-hint">A word and a number, like SNOWBALL 472.</p></div>` +
    status(refusal) +
    `<button class="btn btn-primary" type="submit">We found the elf!</button>` +
    `</form></div>`
  );
}

function stampCard(view: PosterView, refusal: string): string {
  const have = view.detectives.filter((d) => d.hasStamp);
  const need = view.detectives.filter((d) => !d.hasStamp);
  const haveLine = have.length
    ? `<p class="elf-stamp__have">${icon("tick", 16)} ${escapeHtml(listWords(have.map((d) => d.name)))} already ${have.length === 1 ? "has" : "have"} this candy cane.</p>`
    : "";
  const form = need.length
    ? `<form class="elf-stamp" method="post" action="${sitePath(view.stampUrl) ?? "/"}" enctype="multipart/form-data" data-api="/api/elf/stamp">` +
      `<input type="hidden" name="code" value="${escapeHtml(view.code)}" />` +
      ticks("stamp", "Who is here?", need) +
      // The phone's location can only be read by the script, which shows this part.
      `<div class="elf-stamp__location" hidden>` +
      `<button class="btn btn-primary" type="button">Check in with my location</button>` +
      `<p class="elf-hint">We look at where your phone is once, to see that you are here. Nothing is kept.</p>` +
      `<p class="elf-stamp__or">Rather not share it?</p></div>` +
      `<div class="elf-field"><label for="elf-photo">Take a photo here</label>` +
      `<input id="elf-photo" name="photo" type="file" accept="image/*" capture="environment" required aria-describedby="elf-photo-hint" />` +
      `<p class="elf-hint" id="elf-photo-hint">Only NBCC's team sees it, to check the visit. It is never shown on the website, and it is deleted at the end of January.</p></div>` +
      status(refusal) +
      `<button class="btn btn-ghost" type="submit">Check in with a photo</button>` +
      `</form>`
    : "";
  return (
    `<div class="elf-case elf-stamp-card">` +
    `<h2>Collect your candy cane</h2>` +
    (need.length ? `<p>Every hiding place you visit earns a candy cane on your calendar.</p>` : "") +
    haveLine +
    form +
    `</div>`
  );
}

/** The whole poster page. `outcome` is the answer to a form that was posted with no script. */
export function renderPosterPage(view: PosterView, outcome?: PosterOutcome): string {
  const place = escapeHtml(view.placeName);
  const calendar = sitePath(view.calendarUrl) ?? "/";
  const won = outcome?.ok === true;
  const result = !outcome || !outcome.ok ? "" : outcome.form === "claim" ? claimWinHtml(outcome.win) : stampWinHtml(outcome.win);
  const claimRefusal = outcome && !outcome.ok && outcome.form === "claim" ? claimRefusalWords(outcome.reason, outcome.triesLeft) : "";
  const stampRefusal = outcome && !outcome.ok && outcome.form === "stamp" ? stampRefusalWords(outcome.reason) : "";

  let lede: string;
  let body: string;
  if (!view.signedIn) {
    lede = `${place}, ${escapeHtml(view.placeTown)}, is one of this year's hiding places in NBCC Elf Detective School.`;
    body =
      `<div class="elf-case elf-join-card">` +
      `<h2>Want to join the hunt?</h2>` +
      `<p>From 1 to 24 December a cheeky elf hides at a different place each day. Detectives crack the clue, race to find the elf, and collect a candy cane at every place they visit.</p>` +
      `<p class="elf-poster__actions">${link(view.joinUrl, "Join Elf Detective School", "btn btn-primary")} ${link(view.signInUrl, "I am already a detective", "btn btn-ghost")}</p>` +
      `</div>`;
  } else if (view.detectives.length === 0) {
    // Signed in, but nobody to tick: the forms would be empty.
    lede = `${place} is one of this year's hiding places.`;
    body =
      `<div class="elf-case elf-join-card"><h2>Add a detective first</h2>` +
      `<p>Your family has no detectives yet. Add one at Detective HQ, then scan this poster again.</p>` +
      `<p class="elf-poster__actions">${link(view.hqUrl, "Detective HQ", "btn btn-primary")}</p></div>`;
  } else {
    const claiming = view.claimable && !(won && outcome?.form === "claim");
    lede = !view.open
      ? "Have you found an elf here? Or are you here for a candy cane?"
      : view.claimable
        ? "The elf that hid here has not been found yet, and you can collect your candy cane."
        : "The elf that hid here has been found. You can still collect your candy cane.";
    body =
      (claiming ? claimCard(view, claimRefusal) : "") +
      (view.open
        ? stampCard(view, stampRefusal)
        : `<div class="elf-poster__later"><h2>Here for a candy cane?</h2>` +
          `<p>You can check in at ${place} once its door has opened on the calendar. A door opens when its elf is found, or when the place closes for the day.</p></div>`);
  }

  const main = `  <section class="page-top elf-top elf-poster-top" aria-labelledby="elf-poster-heading">
    <div class="wrap">
      <span class="eyebrow">Elf Detective School</span>
      <h1 id="elf-poster-heading">${place}</h1>
      <p class="lede">${lede}</p>
    </div>
  </section>

  <section class="elf-poster" aria-label="${view.signedIn ? "Claim an elf or check in" : "Join in"}">
    <div class="wrap">
      <div id="elf-result" class="elf-result" tabindex="-1" aria-live="polite">${result}</div>
      ${body}
      <p class="elf-grown-up">Under 16? Bring a grown up with you to every hiding place.</p>
      <p class="elf-poster__links"><a class="elf-link" href="${calendar}">See the calendar</a>${view.signedIn ? ` ${link(view.hqUrl, "Detective HQ")}` : ""}</p>
    </div>
  </section>`;

  return elfPage({
    title: view.placeName,
    description: "A hiding place in NBCC Elf Detective School: claim the elf with its secret word, or check in for a candy cane.",
    cta: { href: view.calendarUrl, label: "The calendar" },
    main,
    scripts: ["elf-poster.js"],
  });
}
