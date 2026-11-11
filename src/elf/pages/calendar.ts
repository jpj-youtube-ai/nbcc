import { DOOR_COUNT } from "../calendar";
import { SCHOOL_NAME, schoolLogo } from "../logo";
import { clockWords, countdownWords, dayWords, longDayWords, sameDay, sleepsUntil, things } from "../words";
import { GUESS_LINE, doorDetail, doorTile } from "./door";
import { candyCane, icon } from "./icons";
import { headingStrip, rosette } from "./paper";
import { elfPage, escapeHtml, sitePath } from "./shell";
import type { CalendarView, DoorView } from "./types";

// NBCC Elf Detective School: the public calendar. The plan is
// docs/superpowers/plans/2026-10-04-elf-detective-a3-screens.md; its paper look is
// docs/superpowers/specs/2026-11-04-elf-paper-design.md.
//
// An advent calendar: one torn card board in NBCC's solid rich maroon (Jaimie, 5 November 2026) and
// the 24 doors cut into it, in order, two to a row on a phone. Everything on this page is the same for every
// visitor, so it can be kept and served again without asking the database: a family's own marks are
// laid over it afterwards by the page's script, from a small private answer.
//
// Each door is followed in the page by its own detail. With no script, a door is a link to its
// detail and the stylesheet shows the one that was asked for. The script only makes that nicer.
//
// Pure: no pool, no config, no clock (the time is in the view). Unit tested in
// test/unit/elf-page-calendar.test.ts.

export interface CalendarStatus {
  /** What kind of news it is, for the stylesheet (which reads it with anything but letters taken out,
   *  as the page's script writes it: "found-hidden" is .elf-status--foundhidden). */
  kind: "before" | "today" | "hunting" | "found-hidden" | "found" | "revealed" | "snow" | "between" | "done";
  title: string;
  /** The lines under the title. Already safe HTML. */
  html: string;
}

const placeOf = (d: DoorView): string => (d.place ? escapeHtml(`${d.place.name}, ${d.place.town}`) : "");

function nextClueLine(view: CalendarView): string {
  const next = view.doors.find((d) => d.state === "shut");
  return next ? `<p>Next clue: ${dayWords(next.clueAt)} at ${clockWords(next.clueAt)}</p>` : "";
}

/** The news at the top of the calendar: what is happening today, in a title and a line or two. */
export function calendarStatus(view: CalendarView): CalendarStatus {
  const { now, doors } = view;
  const hunting = doors.find((d) => d.state === "hunting");
  if (hunting) {
    return {
      kind: "hunting",
      title: "The hunt is on!",
      // Decision 1: the finder wins the prize, and the elf stays at its place.
      html: `<p>${escapeHtml(hunting.elfName)} is hiding somewhere in NBCC's area. The first detective to type the word on its tag wins the prize.</p>`,
    };
  }
  const today = doors.find((d) => sameDay(d.clueAt, now));
  if (today && today.state === "shut") {
    const left = today.clueAt.getTime() - now.getTime();
    return {
      kind: "today",
      title: `Door ${today.door} opens today`,
      html:
        `<p>Clue out at ${clockWords(today.clueAt)}</p>` +
        `<p class="elf-status__count elf-cane-strip"><span class="elf-cd" data-until="${today.clueAt.toISOString()}">${countdownWords(left)}</span></p>`,
    };
  }
  // Found before its place is shown: who and when, never where.
  if (today && today.state === "found-hidden" && today.found) {
    const at = clockWords(today.found.at);
    const reveal = today.revealAt ? clockWords(today.revealAt) : "";
    return {
      kind: "found-hidden",
      title: `${escapeHtml(today.elfName)} has been found!`,
      html: `<p>${escapeHtml(today.found.by)} found today's elf${at ? ` at ${at}` : ""}.${reveal ? ` The hiding place is shown at ${reveal}.` : ""}</p>`,
    };
  }
  if (today && today.state === "snow") {
    return {
      kind: "snow",
      title: `${escapeHtml(today.elfName)} got snowed in`,
      html: `<p>Door ${today.door} could not open today. It counts as done for everyone.</p>` + nextClueLine(view),
    };
  }
  if (today && today.state === "found" && today.found) {
    return {
      kind: "found",
      title: `${escapeHtml(today.elfName)} has been found!`,
      html:
        `<p>${escapeHtml(today.found.by)} found today's elf at ${placeOf(today)} at ${clockWords(today.found.at)}.</p>` +
        nextClueLine(view),
    };
  }
  if (today && today.state === "revealed") {
    return {
      kind: "revealed",
      title: `${escapeHtml(today.elfName)} is still waiting`,
      html: `<p>Nobody found today's elf in time. It is at ${placeOf(today)}, and the first detective there still wins the prize.</p>` + nextClueLine(view),
    };
  }
  const next = doors.find((d) => d.state === "shut");
  if (!next) {
    return {
      kind: "done",
      title: "Every elf is home",
      html: "<p>All 24 doors are open. Thank you, detectives, and merry Christmas from everyone at NBCC.</p>",
    };
  }
  const sleeps = sleepsUntil(now, next.clueAt);
  const first = next.door === 1;
  return {
    kind: first ? "before" : "between",
    title: first ? `The hunt starts on ${longDayWords(next.clueAt)}` : `Door ${next.door} opens on ${longDayWords(next.clueAt)}`,
    html: `<p class="elf-status__count elf-cane-strip">${things(sleeps, "sleep")} to go</p><p>The first clue comes out at ${clockWords(next.clueAt)}.</p>`,
  };
}

// When the clue comes out, as the rules say it (src/elf/pages/rules.ts). TASK-613: Christmas Eve's door is
// a morning door (src/elf/calendar.ts), because places close early, and this says so with the doors off too.
const FIRST_STEP = {
  title: "A clue comes out",
  words:
    "Every day from 1 to 24 December, a clue tells detectives where one elf is hiding. It comes out after school on school days, and in the morning at weekends, in the holidays and on Christmas Eve.",
} as const;

/** How it works while December's doors are off: wave 1's four steps, word for word, so no new words go
 *  live before the doors do. The one exception is TASK-613's Christmas Eve, in the first step. */
const WAVE_ONE_STEPS: readonly { title: string; words: string }[] = [
  FIRST_STEP,
  {
    title: "Lock in your guess",
    words: "Pick the hiding place from the list before anyone finds the elf. Get it right and you have cracked the case.",
  },
  {
    title: "Race to find it",
    words: "The first detective to find the elf and type the secret word on its tag wins the elf and a prize.",
  },
  {
    title: "Collect your candy canes",
    words:
      "Once a door is open, visit its hiding place any day and scan the poster for a candy cane stamp. Every door you crack or visit takes you up the ranks.",
  },
];

/** How it works once December's doors are on. */
const STEPS: readonly { title: string; words: string }[] = [
  FIRST_STEP,
  {
    title: "Lock in your guess",
    words: GUESS_LINE,
  },
  {
    title: "Race to find it",
    words:
      "Three clues come out across the evening, each easier than the last. The first detective to find the elf and type the word on its tag wins the prize.",
  },
  {
    title: "Collect your candy canes",
    words:
      "Once a door is open, visit its hiding place any day in December, type the word on the elf's tag for a candy cane stamp, and add your picture to the door.",
  },
];

/** The whole public calendar page. `servedAt` is the moment the page is sent: the view is built once
 *  every 15 seconds and shared, so the script sets its clock by this, while the doors are drawn at the
 *  view's own time. */
export function renderCalendarPage(view: CalendarView, servedAt: Date = view.now): string {
  const ctx = { now: view.now, joinUrl: view.joinUrl, hqUrl: view.hqUrl };
  const join = sitePath(view.joinUrl) ?? "/";
  const hq = sitePath(view.hqUrl) ?? "/";
  // An elf found while its place is still hidden is found: its door wears the Found chip. The live feed
  // (src/routes/elf.ts) must count the same way, or the script would set the tally back.
  const found = view.doors.filter((d) => d.state === "found" || d.state === "found-hidden").length;
  const status = calendarStatus(view);

  const board = view.doors.map((d) => doorTile(d, view.now) + doorDetail(d, ctx)).join("\n");

  // Each step's number on a paper rosette, as the doors' numbers are in the wardrobe.
  const steps = (view.doorsOn ? STEPS : WAVE_ONE_STEPS).map(
    (s, i) =>
      `<li><span class="elf-steps__n" aria-hidden="true">${rosette({ className: "elf-steps__rosette", petals: 14 })}<b>${i + 1}</b></span>` +
      `<h3>${s.title}</h3><p>${s.words}</p></li>`,
  ).join("");

  const main = `  <section class="page-top elf-top" aria-labelledby="elf-heading">
    <div class="wrap elf-top__grid">
      <div class="elf-top__words">
        <h1 id="elf-heading">${schoolLogo(260, SCHOOL_NAME, "elf-top__logo")}</h1>
        <p class="elf-label elf-top__class">Class of ${view.year}</p>
        <p class="lede">24 cheeky elves have escaped from the Elves' Workshop. Find them all by the Night Before Christmas.</p>
        <p class="elf-top__actions">
          <a class="elf-btn elf-btn--crimson" href="${join}">Join Elf Detective School</a>
          <a class="elf-btn" href="${hq}">Detective HQ</a>
        </p>
      </div>
      <div class="elf-status elf-card elf-status--${status.kind.replace(/[^a-z]/g, "")}" aria-live="polite">
        <p class="elf-label elf-status__eyebrow">Today</p>
        <h2 class="elf-status__title">${status.title}</h2>
        <div class="elf-status__body">${status.html}</div>
      </div>
    </div>
  </section>

  <section class="elf-calendar" aria-labelledby="elf-calendar-heading">
    <div class="wrap">
      <div class="elf-calendar__head">
        ${headingStrip({ text: "The calendar", tag: "h2", back: "crimson", id: "elf-calendar-heading" })}
        <p class="elf-tally"><b>${found}</b> of ${DOOR_COUNT} elves found</p>
      </div>
      <div class="elf-advent">
        <span class="elf-advent__card" aria-hidden="true"></span>
        <div class="elf-board" id="elf-board" role="group" aria-label="Advent calendar of ${DOOR_COUNT} doors" data-now="${servedAt.toISOString()}" data-feed="/api/elf/calendar" data-door-api="/api/elf/door/" data-me="/api/elf/me">
${board}
        </div>
      </div>
      <ul class="elf-legend" aria-label="What the marks mean">
        <li><span class="elf-mark elf-mark--cracked">${icon("cracked", 16)}</span> You cracked it</li>
        <li><span class="elf-mark">${candyCane(16)}</span> You have been there</li>
        <li><span class="elf-chip elf-chip--today">Big prize</span> One of our biggest prizes</li>
      </ul>
    </div>
  </section>

  <section class="section elf-how" aria-labelledby="elf-how-heading">
    <div class="wrap">
      ${headingStrip({ text: "How it works", tag: "h2", back: "holly", id: "elf-how-heading" })}
      <ol class="elf-steps">${steps}</ol>
      <p class="elf-grown-up elf-note elf-note--kraft"><span class="elf-tape" aria-hidden="true"></span>Under 16? Bring a grown up with you to every hiding place.</p>
    </div>
  </section>

  <section class="section elf-join" aria-labelledby="elf-join-heading">
    <div class="wrap">
      <div class="elf-card elf-card--crimson elf-join__card">
        ${headingStrip({ text: "Join Elf Detective School", tag: "h2", back: "gold", id: "elf-join-heading" })}
        <p class="lede">Pay what you can. We suggest ${escapeHtml(view.price.suggested)} for each detective, and you can join from ${escapeHtml(view.price.from)}. A grown up joins and adds their detectives.</p>
        <p>Every pound could help remind someone that they have not been forgotten.</p>
        <p><a class="elf-btn elf-btn--crimson elf-btn--l" href="${join}">Join now</a></p>
      </div>
    </div>
  </section>`;

  return elfPage({
    title: "Elf Detective School",
    description:
      "NBCC's advent elf hunt. 24 cheeky elves are hiding across South West Scotland this December: crack the clues, find the elves and collect your candy canes.",
    cta: { href: view.joinUrl, label: "Join" },
    main,
    scripts: ["elf-calendar.js"],
    listed: true,
  });
}
