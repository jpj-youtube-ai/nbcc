import { DOOR_COUNT } from "../calendar";
import { clockWords, countdownWords, dayWords, longDayWords, sameDay, sleepsUntil, things } from "../words";
import { doorDetail, doorTile } from "./door";
import { candyCane, icon } from "./icons";
import { elfPage, escapeHtml, sitePath } from "./shell";
import type { CalendarView, DoorView } from "./types";

// NBCC Elf Detective School: the public calendar. The plan is
// docs/superpowers/plans/2026-10-04-elf-detective-a3-screens.md.
//
// A walnut board of 24 oak doors, the look Jaimie signed off. Everything on this page is the same
// for every visitor, so it can be kept and served again without asking the database: a family's own
// marks are laid over it afterwards by the page's script, from a small private answer.
//
// Each door is followed in the page by its own detail. With no script, a door is a link to its
// detail and the stylesheet shows the one that was asked for. The script only makes that nicer.
//
// Pure: no pool, no config, no clock (the time is in the view). Unit tested in
// test/unit/elf-page-calendar.test.ts.

export interface CalendarStatus {
  /** What kind of news it is, for the stylesheet. */
  kind: "before" | "today" | "hunting" | "found" | "revealed" | "between" | "done";
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
      html: `<p>${escapeHtml(hunting.elfName)} is hiding somewhere in NBCC's area. The first detective to read the secret word wins.</p>`,
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
        `<p class="elf-status__count"><span class="elf-cd" data-until="${today.clueAt.toISOString()}">${countdownWords(left)}</span></p>`,
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
      html: `<p>Nobody found today's elf in time. It is at ${placeOf(today)}, and the first detective there still wins.</p>` + nextClueLine(view),
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
    html: `<p class="elf-status__count">${things(sleeps, "sleep")} to go</p><p>The first clue comes out at ${clockWords(next.clueAt)}.</p>`,
  };
}

const STEPS: readonly { title: string; words: string }[] = [
  {
    title: "A clue comes out",
    words:
      "Every day from 1 to 24 December, a clue tells detectives where one elf is hiding. It comes out after school on school days and in the morning at weekends.",
  },
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

/** The whole public calendar page. */
export function renderCalendarPage(view: CalendarView): string {
  const ctx = { now: view.now, joinUrl: view.joinUrl, hqUrl: view.hqUrl };
  const join = sitePath(view.joinUrl) ?? "/";
  const hq = sitePath(view.hqUrl) ?? "/";
  const found = view.doors.filter((d) => d.state === "found").length;
  const status = calendarStatus(view);

  const board = view.doors.map((d) => doorTile(d, view.now) + doorDetail(d, ctx)).join("\n");

  const steps = STEPS.map((s) => `<li><h3>${s.title}</h3><p>${s.words}</p></li>`).join("");

  const places = view.places
    .map(
      (p) =>
        `<li${p.found ? ' class="is-found"' : ""}>${escapeHtml(`${p.name}, ${p.town}`)}` +
        `${p.found ? ' <span class="elf-pill elf-pill--found">Found</span>' : ""}</li>`,
    )
    .join("");

  const main = `  <section class="page-top elf-top" aria-labelledby="elf-heading">
    <div class="wrap elf-top__grid">
      <div class="elf-top__words">
        <span class="eyebrow">NBCC &middot; Class of ${view.year}</span>
        <h1 id="elf-heading">Elf Detective School</h1>
        <p class="lede">24 cheeky elves have escaped from the Elves' Workshop. Find them all by the Night Before Christmas.</p>
        <p class="elf-top__actions">
          <a class="btn btn-primary" href="${join}">Join the school</a>
          <a class="btn btn-ghost" href="${hq}">Detective HQ</a>
        </p>
      </div>
      <div class="elf-status elf-status--${status.kind}" aria-live="polite">
        <p class="elf-status__eyebrow">Today</p>
        <h2 class="elf-status__title">${status.title}</h2>
        ${status.html}
      </div>
    </div>
  </section>

  <section class="elf-calendar" aria-labelledby="elf-calendar-heading">
    <div class="wrap">
      <div class="elf-calendar__head">
        <h2 id="elf-calendar-heading">The calendar</h2>
        <p class="elf-tally"><b>${found}</b> of ${DOOR_COUNT} elves found</p>
      </div>
      <div class="elf-board" id="elf-board" role="group" aria-label="Advent calendar of ${DOOR_COUNT} doors" data-feed="/api/elf/calendar" data-door-api="/api/elf/door/" data-me="/api/elf/me">
${board}
      </div>
      <ul class="elf-legend" aria-label="What the marks mean">
        <li><span class="elf-mark elf-mark--cracked">${icon("cracked", 16)}</span> You cracked it</li>
        <li><span class="elf-mark">${candyCane(16)}</span> You have been there</li>
        <li><span class="elf-pill elf-pill--big">Big prize</span> One of our biggest prizes</li>
      </ul>
    </div>
  </section>

  <section class="section elf-how" aria-labelledby="elf-how-heading">
    <div class="wrap">
      <h2 id="elf-how-heading" class="h-lg">How it works</h2>
      <ol class="elf-steps">${steps}</ol>
    </div>
  </section>

  <section class="section elf-where" aria-labelledby="elf-where-heading">
    <div class="wrap">
      <h2 id="elf-where-heading" class="h-lg">Where could they be hiding?</h2>
      <p class="lede">These are this year's hiding places. Which elf is where, and on which day, is for you to work out.</p>
      <ul class="elf-places">${places}</ul>
    </div>
  </section>

  <section class="section elf-join" aria-labelledby="elf-join-heading">
    <div class="wrap">
      <h2 id="elf-join-heading" class="h-lg">Join Elf Detective School</h2>
      <p class="lede">Pay what you can. We suggest ${escapeHtml(view.price.suggested)} for each detective, and you can join from ${escapeHtml(view.price.from)}. A grown up joins and adds their detectives.</p>
      <p>Every pound helps remind someone that they have not been forgotten.</p>
      <p><a class="btn btn-primary" href="${join}">Join the school</a></p>
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
