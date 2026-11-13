import { DOOR_COUNT } from "../calendar";
import { FRAMES } from "../wardrobe";
import { clockWords, countdownWords, dayWords, longDayWords, sleepsUntil, things } from "../words";
import { candyCane, icon } from "./icons";
import { headingStrip, titleStrip } from "./paper";
import { count, elfPage, escapeHtml, line, real, sitePath } from "./shell";
import type { DetectiveView, FamilyMarks, HqView, TodayView } from "./types";

// NBCC Elf Detective School: Detective HQ, a family's own page. The plan is
// docs/superpowers/plans/2026-10-04-elf-detective-a3-screens.md; its paper look is
// docs/superpowers/specs/2026-11-04-elf-paper-design.md.
//
// Three things, in the order a family wants them: today's case (on a taped note: the clue ladder, one
// note a clue as each comes out, and the family's typed guess), their detectives (each on a card
// sheet: their elf in its frame, rank and progress), and the marks they have collected. It is private,
// so it shows first names in full and is never listed by search engines. While December's doors are on
// (Plan 2c-1), a family that missed today's evening is offered its one go once the place is shown, and the
// other missed doors it can still crack are listed under today's case.
//
// The guess is an ordinary form that posts to the server, so it works with no script. The page's
// script only saves the guess without leaving the page, and fetches the page again when the next
// clue is due.
//
// One rule is kept here whatever the view holds: a clue is never written before it is out. Two locks
// on the one secret: the view holds only the clues that are out (none on a snow day), and this page
// writes only the clues whose time has come by the view's own clock (none if that clock is not real).
//
// Pure: no pool, no config, no clock (the time is in the view). Unit tested in
// test/unit/elf-page-hq.test.ts.

/** The clue as staff wrote it, with its line breaks kept. */
function clueHtml(clue: string): string {
  return escapeHtml(clue).replace(/\r?\n/g, "<br />\n");
}

/** One clue that is out, on a taped note of its own: its number, its time, its words and its picture. The
 *  go page (src/elf/pages/go.ts) draws its clues with it too. */
export function clueNote(c: TodayView["clues"][number]): string {
  const at = real(c.at) ? clockWords(c.at) : "";
  const picture = sitePath(c.pictureUrl);
  return (
    `<li class="elf-clue">` +
    `<span class="elf-tape" aria-hidden="true"></span>` +
    `<p class="elf-clue__head"><b class="elf-clue__n">Clue ${count(c.n)}</b>${at ? ` <span class="elf-clue__at">${at}</span>` : ""}</p>` +
    (c.words ? `<p class="elf-clue__words">${clueHtml(c.words)}</p>` : "") +
    (picture ? `<img class="elf-clue__pic" src="${picture}" alt="${escapeHtml(c.pictureAlt ?? "")}" width="800" height="600" loading="lazy" decoding="async" />` : "") +
    `</li>`
  );
}

/** The clue ladder: a note for each clue that is out, then when the next comes out (counting down),
 *  or, once all three are out, when the hiding place is shown (as soon as the elf is found, once the
 *  reveal time has passed with the elf still hiding). Only a clue whose time has come is written,
 *  whatever the view holds; with no real clock, no clue at all. */
function clueLadder(today: TodayView, now: Date): string {
  if (!real(now)) return "";
  const out = today.clues.filter((c) => real(c.at) && c.at.getTime() <= now.getTime());
  const notes = out.length ? `<ol class="elf-ladder">${out.map(clueNote).join("")}</ol>` : "";
  const next = today.nextClueAt;
  if (real(next)) {
    const n = Math.min(3, out.length + 1);
    return (
      notes +
      line(`Clue ${n} comes out at ${clockWords(next)}`, "elf-ladder__next") +
      `<p class="elf-case__count elf-cane-strip"><span class="elf-cd" data-until="${next.toISOString()}">${countdownWords(next.getTime() - now.getTime())}</span></p>`
    );
  }
  if (next === null && real(today.revealAt)) {
    return notes + line(`The hiding place is shown at ${clockWords(today.revealAt)}`, "elf-ladder__next");
  }
  if (next === null && today.state === "hunting") {
    return notes + line("The hiding place is shown as soon as the elf is found.", "elf-ladder__next");
  }
  return notes;
}

/** On the door's own day, when the hiding place closes, under the clue ladder and without naming it (the
 *  spec's answer 5); nothing without a closing time to say. */
function closesLine(today: TodayView): string {
  return real(today.closesAt) ? line(`The hiding place closes at ${clockWords(today.closesAt)} today.`, "elf-ladder__closes") : "";
}

/** Why a guess sent with no script was not taken (the server's words), as a status line, or nothing. */
function guessErrorLine(today: TodayView): string {
  return typeof today.guessError === "string" && today.guessError !== ""
    ? `<p class="elf-guess__status is-error" role="status">${escapeHtml(today.guessError)}</p>`
    : "";
}

/** The guess: one box to type the place in. Its legend asks the question; its label says how. A guess
 *  that was not taken says why in the status line; otherwise the line shows the guess locked in. */
function guessForm(today: TodayView, guessUrl: string): string {
  if (!today.canGuess) return guessErrorLine(today) + line("There is nothing left to guess just now. Keep an eye on the calendar.");
  const locked = today.guess ? `Your guess: ${escapeHtml(today.guess.text)}. You can change it until the hiding place is shown.` : "";
  const status = guessErrorLine(today) || `<p class="elf-guess__status" role="status">${locked}</p>`;
  return (
    `<form class="elf-guess" method="post" action="${sitePath(guessUrl) ?? "/"}" data-api="/api/elf/guess">` +
    `<input type="hidden" name="door" value="${count(today.door)}" />` +
    `<fieldset><legend>Where is ${escapeHtml(today.elfName)} hiding?</legend>` +
    `<label class="elf-guess__hint" for="guess-text">Type the name of the place. Spelling does not have to be perfect.</label>` +
    `<input class="elf-guess__text" id="guess-text" name="text" type="text" required maxlength="80" autocomplete="off" autocapitalize="words" enterkeyhint="done" value="${escapeHtml(today.guess?.text ?? "")}" />` +
    `</fieldset>` +
    status +
    `<button class="elf-btn elf-btn--crimson" type="submit">${today.guess ? "Change my guess" : "Lock in my guess"}</button>` +
    `</form>`
  );
}

/** How a door that has opened turned out for a family that can see its place, and on the door's own day when
 *  the place closes. Once the elf has gone home it can no longer be found, nor its place visited (the poster
 *  refuses the word), so the case says only where it was hiding: no prize still to win, and no visit. */
function outcomeHtml(today: TodayView): string {
  const outcome = today.outcome;
  if (!outcome) return "";
  const elf = escapeHtml(today.elfName);
  const place = escapeHtml(outcome.place);
  const goneHome = today.goneHome === true;
  const where =
    today.state === "revealed" && !goneHome
      ? // Decision 1: the finder wins the prize, and the elf stays at its place.
        line(`Nobody found ${elf} in time. ${elf} is still waiting at ${place}, and the first detective to type the word on its tag still wins the prize.`)
      : line(`${elf} was hiding at ${place}.`) +
        (outcome.by ? line(`${icon("rosette", 16)} Found first by ${escapeHtml(outcome.by)}${outcome.at ? ` at ${clockWords(outcome.at)}` : ""}`, "elf-case__by") : "");
  const guess = today.guess ? escapeHtml(today.guess.text) : null;
  // The guess as the family typed it: spelling did not have to be perfect.
  const verdict = outcome.cracked
    ? line(
        `<span class="elf-mark elf-mark--cracked">${icon("cracked", 16)}</span> <b>You cracked it!</b> ${guess ? `Your guess was ${guess}.` : "Your guess was right."}`,
        "elf-case__verdict is-cracked",
      )
    : guess
      ? line(`Your guess was ${guess}. Not this time, but there is a new clue tomorrow.`, "elf-case__verdict")
      : line("You did not lock in a guess for this one. There is a new clue tomorrow.", "elf-case__verdict");
  const closes = real(today.closesAt) ? line(`${place} closes at ${clockWords(today.closesAt)} today.`, "elf-case__hint") : "";
  const visit = goneHome ? "" : line("Visit the hiding place and scan its poster to collect your candy cane.", "elf-case__hint");
  return where + verdict + visit + closes;
}

/** "Have a go", which door it is said to a screen reader alone: Detective HQ can show several at once (today's
 *  case and the doors still to crack), and a list of the page's links must tell them apart. */
const haveAGo = (which: string): string => `Have a go<span class="sr-only"> at ${which}</span>`;

/** A family that cannot see the place yet, once it is shown, and may still crack the case: its one go (Plan
 *  2c-1), in place of how the case turned out. Only a go on this site is offered. */
function goCard(today: TodayView): string {
  const go = sitePath(today.goUrl);
  if (!go) return "";
  return (
    line("You did not lock in a guess in time, but you can still crack this case, with one guess.") +
    `<p><a class="elf-btn elf-btn--crimson" href="${go}">${haveAGo(today.practice ? "the practice door" : `door ${count(today.door)}`)}</a></p>`
  );
}

function caseCard(view: HqView): string {
  const today = view.today;
  if (!today) {
    if (!view.nextClueAt) {
      return `<h2 id="elf-case-heading">Every door is open</h2>` + line("Thank you, detectives, and merry Christmas from everyone at NBCC.");
    }
    const first = longDayWords(view.nextClueAt).endsWith(" 1 December");
    return (
      `<h2 id="elf-case-heading">${first ? "The hunt starts soon" : "No clue today"}</h2>` +
      line(`The ${first ? "first" : "next"} clue comes out on ${longDayWords(view.nextClueAt)} at ${clockWords(view.nextClueAt)}.`) +
      line(`${things(sleepsUntil(view.now, view.nextClueAt), "sleep")} to go`, "elf-case__count elf-cane-strip")
    );
  }
  // A practice evening is plainly a practice: never "Door 0".
  const head = today.practice
    ? `<p class="elf-case__door elf-practice">The practice door <span class="elf-chip elf-chip--new">Practice</span></p>`
    : `<p class="elf-case__door">Door ${count(today.door)}</p>`;
  // Where the case has no guess form, a guess sent with no script that was not taken still says why.
  const refused = guessErrorLine(today);
  if (today.state === "shut") {
    // A door whose clue time is not a real date stays shut (src/elf/doors.ts). Say so plainly.
    const clueAt = today.nextClueAt ?? new Date(NaN);
    if (!real(clueAt) || !real(view.now)) {
      return head + `<h2 id="elf-case-heading">Today's clue is on its way</h2>` + line("Come back later to read it and lock in your guess.") + refused;
    }
    const left = clueAt.getTime() - view.now.getTime();
    return (
      head +
      `<h2 id="elf-case-heading">Today's clue is on its way</h2>` +
      line(`Clue out at ${clockWords(clueAt)}`) +
      `<p class="elf-case__count elf-cane-strip"><span class="elf-cd" data-until="${clueAt.toISOString()}">${countdownWords(left)}</span></p>` +
      line("Come back then to read it and lock in your guess.") +
      refused
    );
  }
  // Found before the place is shown: the clues keep coming and the guessing goes on until then.
  if (today.state === "hunting" || today.state === "found-hidden") {
    return (
      head +
      `<h2 id="elf-case-heading">${today.state === "hunting" ? "The hunt is on!" : `${escapeHtml(today.elfName)} has been found!`}</h2>` +
      clueLadder(today, view.now) +
      closesLine(today) +
      guessForm(today, view.guessUrl)
    );
  }
  if (today.state === "snow") {
    return head + `<h2 id="elf-case-heading">Snow day</h2>` + line(`${escapeHtml(today.elfName)} got snowed in. This door counts as done for everyone.`) + refused;
  }
  // The place is shown: how it turned out for a family that can see it, or its one go for a family that may
  // still crack the case. An elf shown with nobody found is still out there only until it goes home.
  const elf = escapeHtml(today.elfName);
  const heading = today.state === "found" ? "Case closed" : today.goneHome === true ? `${elf} has gone home` : `${elf} is still out there`;
  return (
    head +
    `<h2 id="elf-case-heading">${heading}</h2>` +
    refused +
    (today.outcome ? outcomeHtml(today) : goCard(today))
  );
}

/** The missed doors the family may still crack (Plan 2c-1), newest first, each on a card sheet: its number,
 *  its day, its elf and its go. Only a go on this site is drawn, and with none the list is not on the page
 *  at all, so with December's doors off Detective HQ is exactly what it was. */
function crackSection(view: HqView): string {
  const doors = (Array.isArray(view.toCrack) ? view.toCrack : []).flatMap((d) => {
    const go = sitePath(d.url);
    return go ? [{ ...d, go }] : [];
  });
  if (!doors.length) return "";
  const items = doors
    .map(
      (d, i) =>
        `<li class="elf-crack__door elf-card elf-card--${SHEETS[i % SHEETS.length]}">` +
        `<h3>Door ${count(d.door)}</h3>` +
        (real(d.clueAt) ? `<p>${dayWords(d.clueAt)}</p>` : "") +
        `<p>${escapeHtml(d.elfName)}</p>` +
        `<a class="elf-btn elf-btn--crimson elf-btn--s" href="${d.go}">${haveAGo(`door ${count(d.door)}`)}</a>` +
        `</li>`,
    )
    .join("");
  return `

  <section class="section elf-hq-crack" aria-labelledby="elf-crack-heading">
    <div class="wrap">
      ${headingStrip({ text: "Doors you can still crack", tag: "h2", back: "gold", id: "elf-crack-heading" })}
      <p class="lede">Missed a door? Crack its case here, with one guess. You get the same three clues, one at a time.</p>
      <ul class="elf-crack">${items}</ul>
    </div>
  </section>`;
}

/** The costumes waiting in the wardrobe, as presents (draft words for Jaimie). */
function presentsWords(n: number): string {
  return n === 1 ? "A present to open" : n === 2 ? "Two presents to open" : `${n} presents to open`;
}

/** The card sheets' backing colours, in turn down the family. */
const SHEETS = ["crimson", "holly", "gold", "tan"] as const;

function detectiveCard(d: DetectiveView, i: number): string {
  const name = escapeHtml(d.name);
  const elf = sitePath(d.elfUrl);
  const wardrobe = sitePath(d.wardrobeUrl) ?? "/";
  const doors = Math.min(DOOR_COUNT, count(d.doorsDone));
  const done = d.graduate ? `All ${DOOR_COUNT} doors done` : `${things(doors, "door")} done`;
  const next = d.next ? `${count(d.next.toGo)} more to ${escapeHtml(d.next.rank)}` : "";
  // The elf in the frame the detective chose, or a plain paper mount. Only a frame the wardrobe has.
  const frame = FRAMES.some((f) => f.id === d.frame) ? ` elf-frame--${d.frame}` : "";
  const picture = elf
    ? `<div class="elf-frame${frame} elf-detective__frame"><img class="elf-detective__elf" src="${elf}" alt="${name}'s elf" width="96" height="144" loading="lazy" decoding="async" /></div>`
    : "";
  const presents = count(d.newThings);
  return (
    `<article class="elf-detective elf-card elf-card--${SHEETS[i % SHEETS.length]}">` +
    picture +
    `<div class="elf-detective__body">` +
    `<h3>${name}</h3>` +
    `<p class="elf-detective__rank">Badge ${escapeHtml(d.badgeNumber)} <span class="elf-chip elf-chip--done">${escapeHtml(d.rank)}</span>` +
    `${d.goldSeal ? ' <span class="elf-chip elf-chip--today">Gold seal</span>' : ""}</p>` +
    // The doors done, on the candy cane strip: still a progress bar to a screen reader.
    `<progress class="elf-cane-progress" max="${DOOR_COUNT}" value="${doors}" aria-label="${done}">${doors} of ${DOOR_COUNT}</progress>` +
    `<p class="elf-detective__progress">${done}${next ? `. ${next}.` : "."}</p>` +
    (d.nameApproved
      ? ""
      : line("On the public calendar this name shows as its first letter until our team has checked it.", "elf-detective__note")) +
    `<p class="elf-detective__actions"><a class="elf-btn elf-btn--holly elf-btn--s" href="${wardrobe}">Dress the elf</a>` +
    `${presents > 0 ? ` <span class="elf-chip elf-chip--new elf-new">${presentsWords(presents)}</span>` : ""}</p>` +
    `</div></article>`
  );
}

function marksBoard(marks: FamilyMarks): string {
  const byDoor = new Map(marks.doors.map((m) => [Number(m.door), m]));
  let cracked = 0;
  let visited = 0;
  let cells = "";
  for (let door = 1; door <= DOOR_COUNT; door++) {
    const mark = byDoor.get(door);
    const isCracked = mark?.cracked === true;
    const isVisited = mark?.visited === true;
    // A snow day counts as done for every detective, though nobody cracked it or went there.
    const isSnow = mark?.snow === true;
    if (isCracked) cracked += 1;
    if (isVisited) visited += 1;
    const said = isSnow
      ? "snowed in, so it counts as done."
      : isCracked && isVisited
        ? "cracked and visited"
        : isCracked
          ? "cracked"
          : isVisited
            ? "visited"
            : "not done yet";
    cells +=
      // The words go in the page, not in aria-label: a label on a plain list item is not always read.
      `<li${isCracked || isVisited || isSnow ? ' class="is-done"' : ""}><span class="sr-only">Door ${door}: ${said}</span>` +
      `<span class="elf-marks__num" aria-hidden="true">${door}</span>` +
      (isCracked ? `<span class="elf-mark elf-mark--cracked">${icon("cracked", 14)}</span>` : "") +
      (isVisited ? `<span class="elf-mark">${candyCane(14)}</span>` : "") +
      `</li>`;
  }
  return (
    `<ol class="elf-marks">${cells}</ol>` +
    `<p class="elf-marks__sum">${cracked} cracked and ${visited} visited so far</p>`
  );
}

/** The whole of Detective HQ. */
export function renderHqPage(view: HqView): string {
  const calendar = sitePath(view.calendarUrl) ?? "/";
  const main = `  <section class="page-top elf-top elf-hq-top" aria-labelledby="elf-hq-heading">
    <div class="wrap">
      <p class="elf-label">Elf Detective School</p>
      ${titleStrip({ text: "Detective HQ", tag: "h1", id: "elf-hq-heading" })}
      <p class="lede elf-hq__hello">Hello ${escapeHtml(view.familyName)}. Here is today's case, and how your detectives are getting on.</p>
    </div>
  </section>

  <section class="elf-hq-case" aria-labelledby="elf-case-heading">
    <div class="wrap">
      <div class="elf-case elf-case--${view.today ? view.today.state : "none"} elf-note" data-now="${real(view.now) ? view.now.toISOString() : ""}">
        <span class="elf-tape" aria-hidden="true"></span>
        ${caseCard(view)}
      </div>
    </div>
  </section>${crackSection(view)}

  <section class="section elf-hq-team" aria-labelledby="elf-team-heading">
    <div class="wrap">
      ${headingStrip({ text: "Your detectives", tag: "h2", back: "holly", id: "elf-team-heading" })}
      <div class="elf-detectives">${view.detectives.map(detectiveCard).join("")}</div>
      ${sitePath(view.addDetectiveUrl) ? `<p class="elf-add-detective"><a class="elf-btn" href="${sitePath(view.addDetectiveUrl)}">Add a detective</a></p>` : ""}
    </div>
  </section>

  <section class="section elf-hq-marks" aria-labelledby="elf-marks-heading">
    <div class="wrap">
      ${headingStrip({ text: "Your marks", tag: "h2", back: "crimson", id: "elf-marks-heading" })}
      <p class="lede">A magnifying glass for every case you crack, and a candy cane for every hiding place you visit.</p>
      ${marksBoard(view.marks)}
      <p><a class="elf-btn" href="${calendar}">See the calendar</a></p>
    </div>
  </section>`;

  return elfPage({
    title: "Detective HQ",
    description: "Your family's Elf Detective School page: today's clue, your guess, and your detectives' progress.",
    cta: { href: view.calendarUrl, label: "The calendar" },
    home: view.calendarUrl,
    main,
    scripts: ["elf-hq.js"],
  });
}
