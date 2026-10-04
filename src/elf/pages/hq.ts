import { DOOR_COUNT } from "../calendar";
import { clockWords, countdownWords, longDayWords, sleepsUntil, things } from "../words";
import { candyCane, icon } from "./icons";
import { elfPage, escapeHtml, sitePath } from "./shell";
import type { DetectiveView, FamilyMarks, HqView, TodayView } from "./types";

// NBCC Elf Detective School: Detective HQ, a family's own page. The plan is
// docs/superpowers/plans/2026-10-04-elf-detective-a3-screens.md.
//
// Three things, in the order a family wants them: today's case (the clue and their guess), their
// detectives (each one's elf, rank and progress), and the marks they have collected. It is private,
// so it shows first names in full and is never listed by search engines.
//
// The guess is an ordinary form that posts to the server, so it works with no script. The page's
// script only saves the guess without leaving the page.
//
// One rule is kept here whatever the view holds: the clue is never written before it is out.
//
// Pure: no pool, no config, no clock (the time is in the view). Unit tested in
// test/unit/elf-page-hq.test.ts.

const line = (html: string, cls = ""): string => `<p${cls ? ` class="${cls}"` : ""}>${html}</p>`;

/** The clue as staff wrote it, with its line breaks kept. */
function clueHtml(clue: string): string {
  return escapeHtml(clue).replace(/\r?\n/g, "<br />\n");
}

function guessForm(today: TodayView, guessUrl: string): string {
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
    `<input type="hidden" name="door" value="${today.door}" />` +
    `<fieldset><legend>Where is ${escapeHtml(today.elfName)} hiding?</legend><ul class="elf-guess__choices">${choices}</ul></fieldset>` +
    `<p class="elf-guess__status" role="status">${status}</p>` +
    `<button class="btn btn-primary" type="submit">${today.guess ? "Change my guess" : "Lock in my guess"}</button>` +
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
      line(`${things(sleepsUntil(view.now, view.nextClueAt), "sleep")} to go`, "elf-case__count")
    );
  }
  const head = `<p class="elf-case__door">Door ${today.door}</p>`;
  if (today.state === "shut") {
    const left = today.clueAt.getTime() - view.now.getTime();
    return (
      head +
      `<h2 id="elf-case-heading">Today's clue is on its way</h2>` +
      line(`Clue out at ${clockWords(today.clueAt)}`) +
      `<p class="elf-case__count"><span class="elf-cd" data-until="${today.clueAt.toISOString()}">${countdownWords(left)}</span></p>` +
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

function detectiveCard(d: DetectiveView): string {
  const name = escapeHtml(d.name);
  const elf = sitePath(d.elfUrl);
  const wardrobe = sitePath(d.wardrobeUrl) ?? "/";
  const done = d.graduate ? `All ${DOOR_COUNT} doors done` : `${things(d.doorsDone, "door")} done`;
  const next = d.next ? `${d.next.toGo} more to ${escapeHtml(d.next.rank)}` : "";
  const picture = elf
    ? `<img class="elf-detective__elf" src="${elf}" alt="${name}'s elf" width="96" height="125" loading="lazy" decoding="async" />`
    : "";
  return (
    `<article class="elf-detective">` +
    picture +
    `<div class="elf-detective__body">` +
    `<h3>${name}</h3>` +
    `<p class="elf-detective__rank">Badge ${escapeHtml(d.badgeNumber)} &middot; <b>${escapeHtml(d.rank)}</b>` +
    `${d.goldSeal ? ' <span class="elf-pill elf-pill--big">Gold seal</span>' : ""}</p>` +
    `<progress max="${DOOR_COUNT}" value="${Math.max(0, Math.min(DOOR_COUNT, d.doorsDone))}">${d.doorsDone} of ${DOOR_COUNT}</progress>` +
    `<p class="elf-detective__progress">${done}${next ? `. ${next}.` : "."}</p>` +
    (d.nameApproved
      ? ""
      : line("On the public calendar this name shows as its first letter until our team has checked it.", "elf-detective__note")) +
    `<p class="elf-detective__actions"><a class="btn btn-ghost" href="${wardrobe}">Dress the elf</a>` +
    `${d.newThings > 0 ? ` <span class="elf-new">${d.newThings} new</span>` : ""}</p>` +
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
      `<li aria-label="Door ${door}: ${said}"${isCracked || isVisited ? ' class="is-done"' : ""}>` +
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
  const main = `  <section class="page-top elf-top" aria-labelledby="elf-hq-heading">
    <div class="wrap">
      <span class="eyebrow">Elf Detective School</span>
      <h1 id="elf-hq-heading">Detective HQ</h1>
      <p class="lede elf-hq__hello">Hello ${escapeHtml(view.familyName)}. Here is today's case, and how your detectives are getting on.</p>
    </div>
  </section>

  <section class="elf-hq-case" aria-labelledby="elf-case-heading">
    <div class="wrap">
      <div class="elf-case elf-case--${view.today ? view.today.state : "none"}" data-now="${view.now.toISOString()}">
        ${caseCard(view)}
      </div>
    </div>
  </section>

  <section class="section elf-hq-team" aria-labelledby="elf-team-heading">
    <div class="wrap">
      <h2 id="elf-team-heading" class="h-lg">Your detectives</h2>
      <div class="elf-detectives">${view.detectives.map(detectiveCard).join("")}</div>
    </div>
  </section>

  <section class="section elf-hq-marks" aria-labelledby="elf-marks-heading">
    <div class="wrap">
      <h2 id="elf-marks-heading" class="h-lg">Your marks</h2>
      <p class="lede">A magnifying glass for every case you crack, and a candy cane for every hiding place you visit.</p>
      ${marksBoard(view.marks)}
      <p><a class="btn btn-ghost" href="${calendar}">See the calendar</a></p>
    </div>
  </section>`;

  return elfPage({
    title: "Detective HQ",
    description: "Your family's Elf Detective School page: today's clue, your guess, and your detectives' progress.",
    cta: { href: view.calendarUrl, label: "The calendar" },
    main,
    scripts: ["elf-hq.js"],
  });
}
