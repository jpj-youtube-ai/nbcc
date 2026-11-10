import { DOOR_COUNT } from "../calendar";
import { isOpen } from "../doors";
import { clockWords, countdownWords, dayWords, sleepsUntil } from "../words";
import { candyCane, icon } from "./icons";
import { escapeHtml, sitePath } from "./shell";
import type { DoorView } from "./types";

// NBCC Elf Detective School: one door of the public calendar, and the detail that opens out beneath
// it. The plan is docs/superpowers/plans/2026-10-04-elf-detective-a3-screens.md.
//
// A door is a link to its own detail, so the calendar works with no script at all. The page's script
// only makes it nicer: it opens the detail in place, ticks the countdown and fetches a door again
// when the live feed says it has changed. Both the page and that fetch draw a door with the
// functions here, so the two can never show a door differently.
//
// It is an advent calendar door (docs/superpowers/specs/2026-11-04-elf-paper-design.md, decisions
// 13 and 14): a card door cut into the board's solid rich maroon, on a hinge, with a little paper pull
// tab and its number printed on it. While it is shut, everything on it is printed on the door itself;
// once it is open, the door has swung almost flat and what was behind it fills the door, big enough
// to see on a phone.
//
// One rule is kept here whatever a caller passes in: where an elf is hiding is never written while
// its door is shut or the elf is being hunted. Not in the door, not in its detail, not in the words
// a screen reader says.
//
// Pure: no pool, no config, no clock (the time is passed in). Unit tested in
// test/unit/elf-page-door.test.ts.

export type DoorKind = "found" | "revealed" | "hunting" | "today" | "tomorrow" | "later";

export interface DoorContext {
  now: Date;
  joinUrl: string;
  hqUrl: string;
}

const CARVING_LINE = "Look at the shape cut out of the door. Can you guess the prize?";

/** The painted gold bow on today's door, as on a present. */
const BOW = "/assets/img/elf/paper/deco/bow-gold.webp";

/** What kind of door it is at this moment. A shut door is today's, tomorrow's or a later one, by the
 *  day in London. */
export function doorKind(d: DoorView, now: Date): DoorKind {
  // Tasks 5 and 6 draw the new states properly: for now a hidden find reads as found, a snow day as hunting.
  if (d.state === "found-hidden") return "found";
  if (d.state === "snow") return "hunting";
  if (d.state !== "shut") return d.state;
  const sleeps = sleepsUntil(now, d.clueAt);
  return sleeps === 0 ? "today" : sleeps === 1 ? "tomorrow" : "later";
}

/** The place as people read it, "The Toy Shop, Troon", but only once the door is open. */
function placeWords(d: DoorView): string | null {
  return isOpen(d.state) && d.place ? `${d.place.name}, ${d.place.town}` : null;
}

/** The door in full words, for a screen reader. */
export function doorLabel(d: DoorView, now: Date): string {
  const kind = doorKind(d, now);
  const place = placeWords(d);
  const big = d.bigPrize ? " Big prize." : "";
  if (kind === "found") {
    return `Door ${d.door}, found.${place ? ` ${place}.` : ""}${d.found ? ` Found by ${d.found.by}.` : ""}`;
  }
  if (kind === "revealed") return `Door ${d.door}, not found yet.${place ? ` ${d.elfName} is waiting at ${place}.` : ""}`;
  if (kind === "hunting") return `Door ${d.door}. The hunt is on.${big}`;
  if (kind === "today") return `Door ${d.door}, today. Clue out at ${clockWords(d.clueAt)}.${big}`;
  if (kind === "tomorrow") return `Door ${d.door}, tomorrow. Clue out at ${clockWords(d.clueAt)}.${big}`;
  return `Door ${d.door}, shut. Clue out ${dayWords(d.clueAt)} at ${clockWords(d.clueAt)}.${big}`;
}

/** The prize's shape, cut out of card and laid on the door. With no shape of its own, a door has the
 *  mystery star, which the stylesheet supplies. */
function carving(d: DoorView): string {
  const shape = sitePath(d.shapeUrl);
  const style = shape ? ` style="--shape:url('${shape}')"` : "";
  return `<span class="elf-carve"${style} aria-hidden="true"><span class="elf-carve__hi"></span><span class="elf-carve__lo"></span></span>`;
}

/** The picture on an open door: the winner's photo once there is one, their elf until then. */
function winnerPicture(d: DoorView, width: number): string {
  const photo = sitePath(d.found?.photoUrl);
  if (photo) {
    return `<img class="elf-shot elf-shot--photo" src="${photo}" alt="" width="${width}" height="${width}" loading="lazy" decoding="async" />`;
  }
  const elf = sitePath(d.found?.elfUrl);
  if (elf) {
    const height = Math.round(width * 1.3);
    return `<img class="elf-shot elf-shot--elf" src="${elf}" alt="" width="${width}" height="${height}" loading="lazy" decoding="async" />`;
  }
  return carving(d);
}

function countdown(d: DoorView, now: Date): string {
  // A door whose clue time is not a real date stays shut (src/elf/doors.ts): it has no countdown,
  // and it must never bring the whole calendar down.
  if (!Number.isFinite(d.clueAt.getTime()) || !Number.isFinite(now.getTime())) return "";
  const left = d.clueAt.getTime() - now.getTime();
  return `<span class="elf-cd" data-until="${d.clueAt.toISOString()}">${countdownWords(left)}</span>`;
}

/** A paper chip (src/elf/pages/paper.ts's pieces), in the look for what it says. */
const paperChip = (look: "done" | "missed" | "today" | "soon" | "new", cls: string, html: string): string =>
  `<span class="elf-chip elf-chip--${look} ${cls}">${html}</span>`;

/** A big prize's chip, on a door and in its detail. */
const bigPrizeChip = (cls: string): string => paperChip("today", cls, "Big prize");

function chip(kind: DoorKind, d: DoorView): string {
  if (kind === "found") return paperChip("done", "elf-door__chip", "Found");
  if (kind === "revealed") return paperChip("missed", "elf-door__chip", "Still here");
  if (kind === "hunting") return paperChip("new", "elf-door__chip", "Hunt on");
  if (kind === "today") return paperChip("today", "elf-door__chip", "Today");
  if (kind === "tomorrow") return paperChip("soon", "elf-door__chip", "Tomorrow");
  return d.bigPrize ? bigPrizeChip("elf-door__chip") : "";
}

/** The foot of a door: when its clue comes out, how long is left, or where the elf was. */
function foot(kind: DoorKind, d: DoorView, now: Date): string {
  if (kind === "found" || kind === "revealed") {
    return `<span class="elf-door__foot elf-door__place">${escapeHtml(d.place?.name ?? "")}</span>`;
  }
  if (kind === "hunting") return paperChip("soon", "elf-door__foot", `Find ${escapeHtml(d.elfName)}!`);
  if (kind === "today") {
    return paperChip("today", "elf-door__foot", `<span class="elf-door__more">Clue in </span>${countdown(d, now)}`);
  }
  const weekday = dayWords(d.clueAt).split(" ")[0];
  return paperChip("soon", "elf-door__foot elf-door__date", `${weekday}<span class="elf-door__more"> ${clockWords(d.clueAt)}</span>`);
}

/** A short code that changes whenever the door would be drawn differently. The live feed carries it,
 *  so the page's script knows which doors to fetch again. Counts are left out: they change with
 *  every visit and are not worth a fetch. */
export function doorVersion(d: DoorView, now: Date): string {
  const parts = [
    d.door,
    doorKind(d, now),
    d.clueAt.getTime(),
    d.shapeUrl,
    d.bigPrize,
    d.teaser,
    d.elfName,
    placeWords(d),
    d.found ? [d.found.at.getTime(), d.found.by, d.found.elfUrl, d.found.photoUrl] : null,
  ];
  let hash = 0x811c9dc5;
  for (const ch of JSON.stringify(parts)) {
    hash ^= ch.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/** The door on the board: a link to its own detail. */
export function doorTile(d: DoorView, now: Date): string {
  const kind = doorKind(d, now);
  const open = kind === "found" || kind === "revealed";
  // Today's door, and the one being hunted, glow gold with the bow.
  const gold = kind === "today" || kind === "hunting";
  const double = d.door === DOOR_COUNT;
  const worn = chip(kind, d);
  // The picture fills the open door; the stylesheet fits it in, so this is only its size hint.
  const face = kind === "found" ? winnerPicture(d, 160) : carving(d);
  const print =
    worn +
    // The family's own marks sit on the corner of the picture. The page's script fills them in.
    `<span class="elf-door__face">${face}<span class="elf-door__marks" aria-hidden="true"></span></span>` +
    foot(kind, d, now);
  const tab = `<span class="elf-door__tab"></span>`;
  // Shut, the door carries everything printed on it; open, only its number swings away with it.
  const bow = gold ? `<img class="elf-door__bow" src="${BOW}" width="480" height="361" alt="" decoding="async" />` : "";
  const onDoor = `<span class="elf-door__num">${d.door}</span>` + (open ? "" : bow + print);
  const flaps = double
    ? `<span class="elf-door__flap elf-door__flap--left" aria-hidden="true">${onDoor}${tab}</span>` +
      `<span class="elf-door__flap elf-door__flap--right" aria-hidden="true">${tab}</span>`
    : `<span class="elf-door__flap" aria-hidden="true">${onDoor}${tab}</span>`;
  const shape = double ? " elf-door--double" : d.door === DOOR_COUNT - 1 ? " elf-door--wide" : "";
  const classes = `elf-door elf-door--${kind}${shape}${gold ? " elf-door--gold" : ""}${open ? " is-open" : ""}${worn ? " has-chip" : ""}`;
  return (
    `<a class="${classes}" id="door-${d.door}" href="#case-${d.door}" ` +
    `data-door="${d.door}" data-kind="${kind}" data-v="${doorVersion(d, now)}" aria-label="${escapeHtml(doorLabel(d, now))}">` +
    flaps +
    (open ? print : "") +
    `</a>`
  );
}

const line = (html: string, cls = ""): string => `<p${cls ? ` class="${cls}"` : ""}>${html}</p>`;

function countLines(d: DoorView): string {
  if (!d.counts) return "";
  const { cracked, visited } = d.counts;
  const crackedWords =
    cracked === 0 ? "Nobody cracked this case" : `${cracked} ${cracked === 1 ? "detective" : "detectives"} cracked this case`;
  const visitedWords =
    visited === 0 ? "Nobody has been there yet" : `${visited} ${visited === 1 ? "has" : "have"} been there since`;
  return (
    `<ul class="elf-detail__counts">` +
    `<li><span class="elf-mark elf-mark--cracked">${icon("cracked", 16)}</span> ${crackedWords}</li>` +
    `<li><span class="elf-mark">${candyCane(16)}</span> ${visitedWords}</li>` +
    `</ul>`
  );
}

/** What a door's detail says. `media` is the picture beside the words. */
function detailParts(d: DoorView, ctx: DoorContext): { meta: string; title: string; media: string; body: string } {
  const kind = doorKind(d, ctx.now);
  const day = dayWords(d.clueAt);
  const clock = clockWords(d.clueAt);
  const elf = escapeHtml(d.elfName);
  const place = escapeHtml(placeWords(d) ?? "");
  const fact = d.factLine && isOpen(d.state) ? line(`<b>Did you know?</b> ${escapeHtml(d.factLine)}`, "elf-detail__fact") : "";
  const hq = sitePath(ctx.hqUrl) ?? "/";
  const join = sitePath(ctx.joinUrl) ?? "/";
  const when = (words: string): string => line(`${icon("clock", 16)} ${words}`, "elf-detail__when");
  const bigCarving = `<span class="elf-detail__shape">${carving(d)}</span>`;
  // A prize staff chose to show off keeps its chip and its teaser on its own day too.
  const bigPrize = d.bigPrize ? line(`${bigPrizeChip("elf-detail__big")}${d.teaser ? `: ${escapeHtml(d.teaser)}` : ""}`) : "";

  if (kind === "found") {
    const foundAt = d.found ? ` &middot; found at ${clockWords(d.found.at)}` : "";
    const by = d.found ? line(`${icon("rosette", 16)} Found first by ${escapeHtml(d.found.by)}`, "elf-detail__by") : "";
    return {
      meta: `Door ${d.door} &middot; ${day}${foundAt}`,
      title: place,
      media: `<span class="elf-detail__paper">${winnerPicture(d, 150)}</span>`,
      body:
        by +
        countLines(d) +
        fact +
        line("Been there? Scan the poster at the door to collect your candy cane.", "elf-detail__hint"),
    };
  }
  if (kind === "revealed") {
    return {
      meta: `Door ${d.door} &middot; ${day} &middot; not found yet`,
      title: place,
      media: bigCarving,
      body:
        line(
          `Nobody found ${elf} in time, so here is the hiding place. ${elf} is still waiting, and the first detective to read the secret word wins.`,
        ) +
        countLines(d) +
        fact,
    };
  }
  if (kind === "hunting") {
    return {
      meta: `Door ${d.door} &middot; ${day}`,
      title: "The hunt is on!",
      media: bigCarving,
      body:
        line(`${elf}'s clue came out at ${clock}. ${elf} is hiding somewhere in NBCC's area.`) +
        bigPrize +
        line("The first detective to find the elf and read its secret word wins it.") +
        `<p class="elf-detail__actions"><a class="elf-btn elf-btn--crimson elf-btn--s" href="${hq}">See the clue</a> ` +
        `<a class="elf-link" href="${join}">Not a detective yet? Join in</a></p>`,
    };
  }
  if (kind === "today") {
    return {
      meta: `Door ${d.door} &middot; ${day} &middot; today`,
      title: "Today's elf is hiding",
      media: bigCarving,
      body:
        when(`Clue out at ${clock}, in ${countdown(d, ctx.now)}`) +
        bigPrize +
        line("Then the race is on. The first detective to find the elf and read its secret word wins it.") +
        line("Lock in your guess before anyone finds it to crack the case.") +
        `<p class="elf-detail__actions"><a class="elf-btn elf-btn--crimson elf-btn--s" href="${hq}">Detective HQ</a> ` +
        `<a class="elf-link" href="${join}">Not a detective yet? Join in</a></p>`,
    };
  }
  const teaser = d.teaser ? escapeHtml(d.teaser) : CARVING_LINE;
  return {
    meta: `Door ${d.door} &middot; ${day}`,
    title: kind === "tomorrow" ? "Tomorrow's prize" : d.bigPrize ? "One of our biggest prizes" : "Still shut",
    media: bigCarving,
    body: line(teaser) + when(kind === "tomorrow" ? `Clue out tomorrow at ${clock}` : `Clue out ${day} at ${clock}`),
  };
}

/** The detail that opens out beneath a door: a note taped across the calendar. */
export function doorDetail(d: DoorView, ctx: DoorContext): string {
  const kind = doorKind(d, ctx.now);
  const parts = detailParts(d, ctx);
  return (
    `<section class="elf-detail elf-detail--${kind} elf-note" id="case-${d.door}" data-door="${d.door}" aria-labelledby="case-${d.door}-h">` +
    `<span class="elf-tape" aria-hidden="true"></span>` +
    `<div class="elf-detail__media">${parts.media}</div>` +
    `<div class="elf-detail__body">` +
    `<p class="elf-detail__meta">${parts.meta}</p>` +
    `<h3 class="elf-detail__title" id="case-${d.door}-h">${parts.title}</h3>` +
    parts.body +
    `<p class="elf-detail__mine" hidden></p>` +
    `</div>` +
    `</section>`
  );
}
