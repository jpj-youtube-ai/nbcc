import { DOOR_COUNT } from "../calendar";
import { isOpen } from "../doors";
import { detectiveName } from "../names";
import { COLLAGE_MAX, type ScrapElf, type ScrapPhoto } from "../scrapbook";
import { clockWords, countdownWords, dayWords, findOutWords, longDayWords, sleepsUntil, things } from "../words";
import { candyCane, icon } from "./icons";
import { rosette } from "./paper";
import { count, escapeHtml, line, sitePath } from "./shell";
import type { DoorView } from "./types";

// NBCC Elf Detective School: one door of the public calendar, and the detail that opens out beneath
// it. The plan is docs/superpowers/plans/2026-10-04-elf-detective-a3-screens.md; the doors in
// December are docs/superpowers/plans/2026-11-10-elf-wave-2-game-1.md (Task 6), drawn to match the
// mockup door-scrapbook-v2.html with decision 11's two rows.
//
// A door is a link to its own detail, so the calendar works with no script at all. The page's script
// only makes it nicer: it opens the detail in place, ticks the countdown and fetches a door again
// when the live feed says it has changed. Both the page and that fetch draw a door with the
// functions here, so the two can never show a door differently.
//
// It is an advent calendar door (docs/superpowers/specs/2026-11-04-elf-paper-design.md, decisions
// 13 and 14): a card door cut into the board's solid rich maroon, on a hinge, with a little paper pull
// tab and its number printed on it. While it is shut, everything on it is printed on the door itself;
// once its place is shown, the door has swung almost flat and the room behind it shows: up to three
// of the elves that found it, and how many pictures there are. Its detail is then a scrapbook: who
// found the elf, the prize, everyone's elves with their detective names, the finders first, and then
// the photos in a row of their own with no names, so nobody can match a face to a name.
//
// One rule is kept here whatever a caller passes in: nothing of a door's place is written before the
// door is open. Not its place, not its scrapbook, not a photo, not in the door, its detail or the
// words a screen reader says. A child is named only through detectiveName (src/elf/names.ts), and a
// photo never has a name beside it. The family's own photo is marked by the page's script, never here.
//
// Pure: no pool, no config, no clock (the time is passed in). Unit tested in
// test/unit/elf-page-door.test.ts.

export type DoorKind = "found" | "found-hidden" | "revealed" | "snow" | "hunting" | "today" | "tomorrow" | "later";

export interface DoorContext {
  now: Date;
  joinUrl: string;
  hqUrl: string;
}

const CARVING_LINE = "Look at the shape cut out of the door. Can you guess the prize?";

/** How the guess works, in one line: the calendar's second step says it too. A guess counts until the
 *  hiding place is shown, not until the elf is found. */
export const GUESS_LINE = "Type in your guess at Detective HQ before the hiding place is shown. Get it right and you have cracked the case.";

/** Who wins what (decision 1): the finder wins the prize, and the elf stays at its place. */
const PRIZE_LINE = "The first detective to find the elf and type the word on its tag wins the prize.";

/** Today's door's two lines on the race and the guess while December's doors are off: wave 1's, word
 *  for word, so no new words go live before the doors do. */
const WAVE_ONE_TODAY = [
  "Then the race is on. The first detective to find the elf and read its secret word wins it.",
  "Lock in your guess before anyone finds it to crack the case.",
] as const;

/** The painted gold bow on today's door, as on a present. */
const BOW = "/assets/img/elf/paper/deco/bow-gold.webp";

/** What kind of door it is at this moment. A shut door is today's, tomorrow's or a later one, by the
 *  day in London. */
export function doorKind(d: DoorView, now: Date): DoorKind {
  if (d.state !== "shut") return d.state;
  const sleeps = sleepsUntil(now, d.clueAt);
  return sleeps === 0 ? "today" : sleeps === 1 ? "tomorrow" : "later";
}

/** Is the door standing open, its place shown? */
const isOpenKind = (kind: DoorKind): boolean => kind === "found" || kind === "revealed";

/** The place as people read it, "The Toy Shop, Troon", but only once the door is open. */
function placeWords(d: DoorView): string | null {
  return isOpen(d.state) && d.place ? `${d.place.name}, ${d.place.town}` : null;
}

/** "Found by Detective R. Tinselfoot at 5:47pm", leaving out a time that is not real. Safe HTML: the
 *  names are made safe, then dressed by `name` (the scrapbook sets them in bold). */
function foundSentence(found: { at: Date; by: string }, name = (safe: string): string => safe): string {
  const at = clockWords(found.at);
  return `Found by ${name(escapeHtml(found.by))}${at ? ` at ${at}` : ""}`;
}

/** The door in full words, for a screen reader. */
export function doorLabel(d: DoorView, now: Date): string {
  const kind = doorKind(d, now);
  const place = placeWords(d);
  const big = d.bigPrize ? " Big prize." : "";
  if (kind === "found") {
    return `Door ${d.door}, found.${place ? ` ${place}.` : ""}${d.found ? ` Found by ${d.found.by}.` : ""}`;
  }
  if (kind === "found-hidden") {
    // The place is shown at the reveal only to a family that has had its guess (Plan 2c-1, Task 9).
    const reveal = d.revealAt ? clockWords(d.revealAt) : "";
    return `Door ${d.door}, found.${d.found ? ` Found by ${d.found.by}.` : ""}${reveal ? ` ${findOutWords(reveal, false)}` : ""}`;
  }
  if (kind === "snow") return `Door ${d.door}, snow day. ${d.elfName} got snowed in.`;
  // An elf that has gone home can no longer be found or visited (Task 9, fix round 1): never "waiting" then.
  if (kind === "revealed" && d.goneHome) {
    return `Door ${d.door}. Nobody found ${d.elfName} in time, and it has gone home.${place ? ` ${d.elfName} was hiding at ${place}.` : ""}`;
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

/** A snow day's face: a paper snowflake, cut out of card the way a prize's shape is (the stylesheet
 *  supplies its shape: no picture). */
const snowflake = (): string =>
  `<span class="elf-carve elf-snowflake" aria-hidden="true"><span class="elf-carve__hi"></span><span class="elf-carve__lo"></span></span>`;

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

/** What a door says beside its number. An open door whose elf is found needs no word: its room shows
 *  the elves that found it. */
function chip(kind: DoorKind, d: DoorView): string {
  if (kind === "found") return "";
  if (kind === "found-hidden") return paperChip("done", "elf-door__chip", "Found");
  if (kind === "snow") return paperChip("soon", "elf-door__chip", "Snow day");
  if (kind === "revealed") return paperChip("missed", "elf-door__chip", "Still here");
  if (kind === "hunting") return paperChip("new", "elf-door__chip", "Hunt on");
  if (kind === "today") return paperChip("today", "elf-door__chip", "Today");
  if (kind === "tomorrow") return paperChip("soon", "elf-door__chip", "Tomorrow");
  return d.bigPrize ? bigPrizeChip("elf-door__chip") : "";
}

/** The foot of a shut door: when its clue comes out, how long is left, or who found its elf. */
function foot(kind: DoorKind, d: DoorView, now: Date): string {
  if (kind === "found-hidden") return d.found ? paperChip("soon", "elf-door__foot elf-door__by", `Found by ${escapeHtml(d.found.by)}`) : "";
  if (kind === "snow" || isOpenKind(kind)) return "";
  if (kind === "hunting") return paperChip("soon", "elf-door__foot", `Find ${escapeHtml(d.elfName)}!`);
  if (kind === "today") {
    return paperChip("today", "elf-door__foot", `<span class="elf-door__more">Clue in </span>${countdown(d, now)}`);
  }
  const weekday = dayWords(d.clueAt).split(" ")[0];
  return paperChip("soon", "elf-door__foot elf-door__date", `${weekday}<span class="elf-door__more"> ${clockWords(d.clueAt)}</span>`);
}

/** The family's own marks sit on the corner of the picture. The page's script fills them in. */
const MARKS = `<span class="elf-door__marks" aria-hidden="true"></span>`;

/** The room behind an open door: its number, up to three of the elves that found it (elves only,
 *  never a photo), its place, and how many pictures the scrapbook holds. With no elf yet, the prize's
 *  shape in gold. */
function room(d: DoorView): string {
  const elves = d.collage
    .map((url) => sitePath(url))
    .filter((url): url is string => url !== null)
    .slice(0, COLLAGE_MAX);
  const pics = elves.length
    ? elves.map((src) => `<span class="elf-mini"><img src="${src}" alt="" width="240" height="360" loading="lazy" decoding="async" /></span>`).join("")
    : carving(d);
  const pictures = d.scrapbook ? count(d.scrapbook.count) : 0;
  const place = d.place ? `<span class="elf-door__place">${escapeHtml(d.place.name)}</span>` : "";
  return (
    `<span class="elf-room">` +
    `<span class="elf-room__num">${d.door}</span>` +
    `<span class="elf-room__pics">${pics}</span>` +
    `<span class="elf-room__foot">${place}${pictures > 0 ? paperChip("soon", "elf-room__count", String(pictures)) : ""}</span>` +
    MARKS +
    `</span>`
  );
}

/** A short code that changes whenever the door would be drawn differently. The live feed carries it,
 *  so the page's script knows which doors to fetch again. Counts are left out: they change with
 *  every visit and are not worth a fetch. A new elf or photo in the scrapbook is. What only an open
 *  door draws counts only once it is open. */
export function doorVersion(d: DoorView, now: Date): string {
  const open = isOpen(d.state);
  const book = open ? d.scrapbook : null;
  const parts: unknown[] = [
    d.door,
    doorKind(d, now),
    d.clueAt.getTime(),
    d.shapeUrl,
    d.bigPrize,
    d.teaser,
    d.elfName,
    d.found ? [d.found.at.getTime(), d.found.by] : null,
    d.revealAt ? d.revealAt.getTime() : null,
    // December's doors switched on change what today's door says.
    d.doorsOn === true,
    open ? [placeWords(d), d.prize, d.collage, d.goneHome, d.factLine] : null,
    book ? [book.count, book.elves.map((e) => [e.pictureUrl, e.found, e.detective ? detectiveName(e.detective) : ""]), book.photos.map((p) => p.url)] : null,
  ];
  // Only an open door with a go adds it, so every other door keeps the code it had before having a go
  // came in: with December's doors off the calendar and its feed are exactly as they were (ruling F4).
  if (open && d.goUrl) parts.push(d.goUrl);
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
  const open = isOpenKind(kind);
  // Today's door, the one being hunted, and the one found while its place is hidden glow gold with the bow.
  const gold = kind === "today" || kind === "hunting" || kind === "found-hidden";
  const double = d.door === DOOR_COUNT;
  const worn = chip(kind, d);
  const face = kind === "snow" ? snowflake() : carving(d);
  const print = worn + `<span class="elf-door__face">${face}${MARKS}</span>` + foot(kind, d, now);
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
    (open ? room(d) + worn : "") +
    `</a>`
  );
}

/** How many families cracked the case and have been there since (doorCounts counts a family once,
 *  however many detectives it has). */
function countLines(d: DoorView): string {
  if (!d.counts) return "";
  const cracked = count(d.counts.cracked);
  const visited = count(d.counts.visited);
  const crackedWords =
    cracked === 0 ? "Nobody cracked this case" : `${cracked} ${cracked === 1 ? "family" : "families"} cracked this case`;
  const visitedWords =
    visited === 0 ? "Nobody has been there yet" : `${visited} ${visited === 1 ? "has" : "have"} been there since`;
  return (
    `<ul class="elf-detail__counts">` +
    `<li><span class="elf-mark elf-mark--cracked">${icon("cracked", 16)}</span> ${crackedWords}</li>` +
    `<li><span class="elf-mark">${candyCane(16)}</span> ${visitedWords}</li>` +
    `</ul>`
  );
}

/** The section every detail is: a note taped across the calendar, under its door. */
function section(d: DoorView, kind: DoorKind, extra: string, inner: string): string {
  return (
    `<section class="elf-detail elf-detail--${kind} elf-note${extra}" id="case-${d.door}" data-door="${d.door}" aria-labelledby="case-${d.door}-h">` +
    `<span class="elf-tape" aria-hidden="true"></span>` +
    inner +
    `</section>`
  );
}

/** What a shut door's detail says. `media` is the picture beside the words. */
function detailParts(d: DoorView, kind: DoorKind, ctx: DoorContext): { meta: string; title: string; media: string; body: string } {
  const day = dayWords(d.clueAt);
  const clock = clockWords(d.clueAt);
  const elf = escapeHtml(d.elfName);
  const hq = sitePath(ctx.hqUrl) ?? "/";
  const join = sitePath(ctx.joinUrl) ?? "/";
  const when = (words: string): string => line(`${icon("clock", 16)} ${words}`, "elf-detail__when");
  const bigCarving = `<span class="elf-detail__shape">${carving(d)}</span>`;
  // A prize staff chose to show off keeps its chip and its teaser on its own day too.
  const bigPrize = d.bigPrize ? line(`${bigPrizeChip("elf-detail__big")}${d.teaser ? `: ${escapeHtml(d.teaser)}` : ""}`) : "";
  const joinIn = `<a class="elf-link" href="${join}">Not a detective yet? Join in</a>`;

  if (kind === "found-hidden") {
    const reveal = d.revealAt ? clockWords(d.revealAt) : "";
    const said = [d.found ? `${foundSentence(d.found)}.` : "", reveal ? findOutWords(reveal, false) : ""].filter((s) => s !== "").join(" ");
    return {
      meta: `Door ${d.door} &middot; ${day}`,
      title: `${elf} has been found!`,
      media: bigCarving,
      body:
        (said ? line(`${icon("rosette", 16)} ${said}`, "elf-detail__by") : "") +
        line("Clues are still coming out in Detective HQ, and you can still lock in your guess.") +
        `<p class="elf-detail__actions"><a class="elf-btn elf-btn--crimson elf-btn--s" href="${hq}">Detective HQ</a> ${joinIn}</p>`,
    };
  }
  if (kind === "snow") {
    return {
      meta: `Door ${d.door} &middot; ${day}`,
      title: `${elf} got snowed in`,
      media: `<span class="elf-detail__shape">${snowflake()}</span>`,
      body: line("This door could not open today, so it counts as done for every detective. The hunt goes on tomorrow."),
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
        line(`${PRIZE_LINE} ${elf} stays there for everyone else to find.`) +
        `<p class="elf-detail__actions"><a class="elf-btn elf-btn--crimson elf-btn--s" href="${hq}">See the clue</a> ${joinIn}</p>`,
    };
  }
  if (kind === "today") {
    // Today's door shows with December's doors off too, when it must read exactly as wave 1's did. Its
    // elf is not named before its clue is out.
    const race = d.doorsOn
      ? line(`Then the race is on. ${PRIZE_LINE} The elf stays there for everyone else to find.`) + line(GUESS_LINE)
      : line(WAVE_ONE_TODAY[0]) + line(WAVE_ONE_TODAY[1]);
    return {
      meta: `Door ${d.door} &middot; ${day} &middot; today`,
      title: "Today's elf is hiding",
      media: bigCarving,
      body:
        when(`Clue out at ${clock}, in ${countdown(d, ctx.now)}`) +
        bigPrize +
        race +
        `<p class="elf-detail__actions"><a class="elf-btn elf-btn--crimson elf-btn--s" href="${hq}">Detective HQ</a> ${joinIn}</p>`,
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

// ---- the scrapbook behind an open door ------------------------------------------------------------

/** One of the scrapbook's headings, in handwriting. */
const bookHeading = (words: string, extra = ""): string => `<h4 class="elf-book__heading">${words}${extra ? ` ${extra}` : ""}</h4>`;

/** Who found the elf and when, beside a paper rosette. */
function foundLine(d: DoorView): string {
  if (!d.found) return "";
  return (
    `<p class="elf-book__found">` +
    `<span class="elf-book__seal" aria-hidden="true">${rosette({ className: "elf-book__rosette", petals: 16 })}<b>Found</b></span>` +
    `<span>${foundSentence(d.found, (names) => `<b>${names}</b>`)}</span></p>`
  );
}

/** The prize, named once the elf is found whether or not staff showed it off, beside the shape cut
 *  into the door. */
function prizeLine(d: DoorView): string {
  const prize = typeof d.prize === "string" ? d.prize.trim().replace(/\.+$/, "") : "";
  if (!prize || !d.found) return "";
  return (
    `<p class="elf-book__prize"><span class="elf-book__cut" aria-hidden="true">${carving(d)}</span>` +
    `<span>${escapeHtml(d.found.by)} won the prize cut into this door: ${escapeHtml(prize)}.</span></p>`
  );
}

/** One detective's elf on a polaroid of its own, with its detective name. The finders' wear the
 *  "FOUND FIRST!" rosette. */
function elfPolaroid(e: ScrapElf): string {
  const src = sitePath(e.pictureUrl);
  const first = e.found === true;
  const seal = first ? `<span class="elf-pol__seal">${rosette({ className: "elf-pol__rosette", petals: 18 })}<b>FOUND FIRST!</b></span>` : "";
  const shot = src ? `<img src="${src}" alt="" width="240" height="360" loading="lazy" decoding="async" />` : "";
  const name = e.detective ? detectiveName(e.detective) : "A detective";
  return `<figure class="elf-pol${first ? " elf-pol--first" : ""}">${seal}<span class="elf-pol__shot">${shot}</span><figcaption>${escapeHtml(name)}</figcaption></figure>`;
}

/** A photo, in a frame with no words at all: no caption, no alt, no title. Its token, already in its
 *  address, lets the page's script find the family's own photo to mark. */
function photoPolaroid(p: ScrapPhoto): string {
  const src = sitePath(p.url);
  if (!src) return "";
  const token = typeof p.token === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(p.token) ? ` data-token="${p.token}"` : "";
  return `<figure class="elf-pol"${token}><span class="elf-pol__shot"><img src="${src}" alt="" width="480" height="560" loading="lazy" decoding="async" /></span></figure>`;
}

/** The last line of an open door with no place to show (the calendar everyone shares, before Christmas
 *  Day), while having a go is open: where was the elf hiding, and a go in Detective HQ to find out. The
 *  elf "is" hiding only while it can still be found, at a revealed door whose elf has not gone home
 *  (ruling F8). */
function goLine(d: DoorView, elf: string, stillHiding: boolean): string {
  const go = sitePath(d.goUrl);
  if (!go) return "";
  const ask = stillHiding ? `Where is ${elf} hiding?` : `Where was ${elf} hiding?`;
  return line(
    `${ask} Crack the case in Detective HQ to find out. <a class="elf-btn elf-btn--crimson elf-btn--s" href="${go}">Have a go</a>`,
    "elf-book__end elf-detail__hint elf-book__go",
  );
}

/** An open door's detail: the scrapbook. With no place to show (the calendar everyone shares, before
 *  Christmas Day) its title says who found the elf, or that nobody did in time, in place of the place,
 *  and its last line offers a go in Detective HQ in place of a visit. */
function scrapbook(d: DoorView, kind: DoorKind): string {
  const elf = escapeHtml(d.elfName);
  const book = d.scrapbook;
  const elves = book ? book.elves : [];
  const photos = book ? book.photos.map(photoPolaroid).filter((html) => html !== "") : [];
  const where = placeWords(d);
  // The elf can still be found only at a revealed door whose elf has not gone home.
  const stillHiding = kind === "revealed" && !d.goneHome;
  const title = where !== null ? escapeHtml(where) : kind === "found" ? `${elf} was found!` : `Nobody found ${elf} in time`;
  // A revealed door whose elf has gone home has nothing left to win: its end line says it has gone home.
  const lead =
    kind === "found"
      ? foundLine(d) + prizeLine(d)
      : where === null
        ? stillHiding
          ? line(`${elf} is still hiding, and the first detective to type the word on its tag wins the prize.`, "elf-book__still")
          : ""
        : d.goneHome
          ? line(`Nobody found ${elf} in time, so here is the hiding place.`, "elf-book__still")
          : line(
              `Nobody found ${elf} in time, so here is the hiding place. ${elf} is still there, and the first detective to type the word on its tag wins the prize.`,
              "elf-book__still",
            );
  const everyone = elves.length
    ? bookHeading("Everyone who found this elf", `<span class="elf-book__count">${things(count(book?.count), "picture")}</span>`) +
      `<div class="elf-collage">${elves.map(elfPolaroid).join("")}</div>`
    : "";
  const pictures = photos.length ? bookHeading("Photos from the door") + `<div class="elf-photos">${photos.join("")}</div>` : "";
  const fact = d.factLine ? line(`<b>Did you know?</b> ${escapeHtml(d.factLine)}`, "elf-detail__fact") : "";
  // The visit line steps aside for the family's own line (the page's script); the gone home line never does.
  const gone = d.goneHome ? line(`${elf} has gone home now, so there is nothing to find there. The pictures stay.`, "elf-book__end elf-book__gone") : "";
  const visit = d.place ? line(`The elf is still at ${escapeHtml(d.place.name)}. Visit to add your picture.`, "elf-book__end elf-detail__hint") : "";
  const end = where === null ? gone + goLine(d, elf, stillHiding) : gone || visit;
  return (
    `<div class="elf-detail__body">` +
    `<p class="elf-detail__meta">Door ${d.door} &middot; ${longDayWords(d.clueAt)}</p>` +
    `<h3 class="elf-detail__title" id="case-${d.door}-h">${title}</h3>` +
    lead +
    countLines(d) +
    everyone +
    pictures +
    fact +
    end +
    `<p class="elf-detail__mine" hidden></p>` +
    `<p class="elf-book__close"><a class="elf-btn elf-btn--s" href="#door-${d.door}">Close door ${d.door}</a></p>` +
    `</div>`
  );
}

/** The detail that opens out beneath a door: a note taped across the calendar. Behind an open door it
 *  is the scrapbook. */
export function doorDetail(d: DoorView, ctx: DoorContext): string {
  const kind = doorKind(d, ctx.now);
  if (isOpenKind(kind)) return section(d, kind, " elf-book", scrapbook(d, kind));
  const parts = detailParts(d, kind, ctx);
  return section(
    d,
    kind,
    "",
    `<div class="elf-detail__media">${parts.media}</div>` +
      `<div class="elf-detail__body">` +
      `<p class="elf-detail__meta">${parts.meta}</p>` +
      `<h3 class="elf-detail__title" id="case-${d.door}-h">${parts.title}</h3>` +
      parts.body +
      `<p class="elf-detail__mine" hidden></p>` +
      `</div>`,
  );
}
