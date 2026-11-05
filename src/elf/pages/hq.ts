import { DOOR_COUNT } from "../calendar";
import { FRAMES } from "../wardrobe";
import { clockWords, countdownWords, longDayWords, sleepsUntil, things } from "../words";
import { candyCane, icon } from "./icons";
import { headingStrip, titleStrip } from "./paper";
import { elfPage, escapeHtml, sitePath } from "./shell";
import type { DetectiveView, FamilyMarks, HqView, TodayView } from "./types";

// NBCC Elf Detective School: Detective HQ, a family's own page. The plan is
// docs/superpowers/plans/2026-10-04-elf-detective-a3-screens.md; its paper look is
// docs/superpowers/specs/2026-11-04-elf-paper-design.md.
//
// Three things, in the order a family wants them: today's case (the clue and their guess, on a taped
// note), their detectives (each on a card sheet: their elf in its frame, rank and progress), and the
// marks they have collected. It is private, so it shows first names in full and is never listed by
// search engines.
//
// The guess is an ordinary form that posts to the server, so it works with no script. The page's
// script only saves the guess without leaving the page.
//
// One rule is kept here whatever the view holds: the clue is never written before it is out.
//
// Pure: no pool, no config, no clock (the time is in the view). Unit tested in
// test/unit/elf-page-hq.test.ts.

const line = (html: string, cls = ""): string => `<p${cls ? ` class="${cls}"` : ""}>${html}</p>`;

/** Is this a real moment? A date built from a missing or mangled value is not, and must never
 *  bring the whole page down. */
const real = (d: Date): boolean => d instanceof Date && Number.isFinite(d.getTime());

/** A count as a whole number that is safe to write into the page, whatever a database hands over. */
const count = (n: unknown): number => Math.max(0, Math.floor(Number(n)) || 0);

/** The clue as staff wrote it, with its line breaks kept. */
function clueHtml(clue: string): string {
  return escapeHtml(clue).replace(/\r?\n/g, "<br />\n");
}

function guessForm(today: TodayView, guessUrl: string): string {
  if (today.options.length === 0) return line("There is nothing left to guess just now. Keep an eye on the calendar.");
  const choices = today.options
    .map((place, i) => {
      const id = `guess-${i + 1}`;
      const checked = today.guess?.id === place.id ? " checked" : "";
      const required = i === 0 ? " required" : "";
      return (
        `<li><input type="radio" name="placeId" id="${id}" value="${escapeHtml(place.id)}"${checked}${required} />` +
        `<label for="${id}">${escapeHtml(`${place.name}, ${place.town}`)}</label></li>`
      );
    })
    .join("");
  const status = today.guess
    ? `Your guess: ${escapeHtml(`${today.guess.name}, ${today.guess.town}`)}. You can change it until the elf is found.`
    : "";
  return (
    `<form class="elf-guess" method="post" action="${sitePath(guessUrl) ?? "/"}" data-api="/api/elf/guess">` +
    `<input type="hidden" name="door" value="${count(today.door)}" />` +
    `<fieldset><legend>Where is ${escapeHtml(today.elfName)} hiding?</legend><ul class="elf-guess__choices">${choices}</ul></fieldset>` +
    `<p class="elf-guess__status" role="status">${status}</p>` +
    `<button class="elf-btn elf-btn--crimson" type="submit">${today.guess ? "Change my guess" : "Lock in my guess"}</button>` +
    `</form>`
  );
}

/** How a door that has opened turned out for this family. */
function outcomeHtml(today: TodayView): string {
  const outcome = today.outcome;
  if (!outcome) return "";
  const elf = escapeHtml(today.elfName);
  const place = escapeHtml(outcome.place);
  const where =
    today.state === "revealed"
      ? line(`Nobody found ${elf} in time. ${elf} is still waiting at ${place}, and the first detective to read the secret word still wins.`)
      : line(`${elf} was hiding at ${place}.`) +
        (outcome.by ? line(`${icon("rosette", 16)} Found first by ${escapeHtml(outcome.by)}${outcome.at ? ` at ${clockWords(outcome.at)}` : ""}`, "elf-case__by") : "");
  const guess = today.guess ? escapeHtml(`${today.guess.name}, ${today.guess.town}`) : null;
  const verdict = outcome.cracked
    ? line(`<span class="elf-mark elf-mark--cracked">${icon("cracked", 16)}</span> <b>You cracked it!</b> Your guess was right.`, "elf-case__verdict is-cracked")
    : guess
      ? line(`Your guess was ${guess}. Not this time, but there is a new clue tomorrow.`, "elf-case__verdict")
      : line("You did not lock in a guess for this one. There is a new clue tomorrow.", "elf-case__verdict");
  return where + verdict + line("Visit the hiding place and scan its poster to collect your candy cane.", "elf-case__hint");
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
  const head = `<p class="elf-case__door">Door ${count(today.door)}</p>`;
  if (today.state === "shut") {
    // A door whose clue time is not a real date stays shut (src/elf/doors.ts). Say so plainly.
    if (!real(today.clueAt) || !real(view.now)) {
      return head + `<h2 id="elf-case-heading">Today's clue is on its way</h2>` + line("Come back later to read it and lock in your guess.");
    }
    const left = today.clueAt.getTime() - view.now.getTime();
    return (
      head +
      `<h2 id="elf-case-heading">Today's clue is on its way</h2>` +
      line(`Clue out at ${clockWords(today.clueAt)}`) +
      `<p class="elf-case__count elf-cane-strip"><span class="elf-cd" data-until="${today.clueAt.toISOString()}">${countdownWords(left)}</span></p>` +
      line("Come back then to read it and lock in your guess.")
    );
  }
  if (today.state === "hunting") {
    return (
      head +
      `<h2 id="elf-case-heading">The hunt is on!</h2>` +
      (today.clue ? `<blockquote class="elf-clue">${clueHtml(today.clue)}</blockquote>` : "") +
      guessForm(today, view.guessUrl)
    );
  }
  return (
    head +
    `<h2 id="elf-case-heading">${today.state === "found" ? "Case closed" : `${escapeHtml(today.elfName)} is still out there`}</h2>` +
    outcomeHtml(today)
  );
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
    if (isCracked) cracked += 1;
    if (isVisited) visited += 1;
    const said = isCracked && isVisited ? "cracked and visited" : isCracked ? "cracked" : isVisited ? "visited" : "not done yet";
    cells +=
      // The words go in the page, not in aria-label: a label on a plain list item is not always read.
      `<li${isCracked || isVisited ? ' class="is-done"' : ""}><span class="sr-only">Door ${door}: ${said}</span>` +
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
  </section>

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
