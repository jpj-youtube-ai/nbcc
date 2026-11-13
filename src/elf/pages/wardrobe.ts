import { DOOR_COUNT, isDoor } from "../calendar";
import {
  BOWS,
  COSTUMES,
  FRAMES,
  FRIENDS,
  GLASSES,
  HAIR_COLOURS,
  HAIR_STYLES,
  SCENES,
  SIBLINGS,
  SKIN_TONES,
  costumeUnlocked,
  lookPictures,
  lookWords,
  normaliseLook,
} from "../wardrobe";
import type { Costume, ElfLook, WardrobeItem, WardrobeState } from "../wardrobe";
import { dayWords, sameDay } from "../words";
import { giftTag, headingStrip, paperCircle, rosette, titleStrip, type TagColour } from "./paper";
import { elfPage, escapeHtml, sitePath } from "./shell";
import type { WardrobeView } from "./types";

// NBCC Elf Detective School: the wardrobe, where a detective dresses their elf in paper
// (docs/superpowers/specs/2026-11-04-elf-paper-design.md; mockup 6, approved by Jaimie on 4 November
// 2026).
//
// The page is ONE form of choices: who the elf is (step 1, "Your elf"), a whole costume, and the
// extras (a scene, a friend, a frame, glasses, a bow tie; step 2, "Dress up"). Every choice is a radio
// button, so it works with no script: pick, press Save, and the server keeps the look. The page's
// script (assets/js/elf-wardrobe-ui.js) changes the stage as things are tried on and saves without
// leaving the page, folds step 1 away, turns the gift tags into tabs, opens presents, and brings the
// rest of mockup 6 to life: the elf talking back, snow, Surprise me, Snap a photo and the sounds.
//
// Every costume is shown, unlocked or not. One that is still locked cannot be picked: it is faint,
// wears the painted padlock and, tapped, says on its note why. The saved look is made safe before it
// is drawn, so the elf never wears what it has not unlocked, whatever was stored.
//
// Every picture and every rule comes from the one wardrobe file the browser also loads
// (src/elf/wardrobe.ts), so the page and its script cannot disagree.
//
// Pure: no pool, no config, no clock (the time is in the view). Unit tested in
// test/unit/elf-page-wardrobe.test.ts.

const PAPER = "/assets/img/elf/paper/";

/** The doors done, as real door numbers only, so a state that is not what it should be opens nothing. */
function safeState(state: WardrobeState | undefined): WardrobeState {
  const doors = state && Array.isArray(state.doors) ? state.doors.filter(isDoor) : [];
  return { doors: [...new Set(doors)].sort((a, b) => a - b) };
}

/** The costumes that have arrived and are not opened yet. Only real costumes the detective can wear count. */
function freshCostumes(listed: unknown, state: WardrobeState): Set<string> {
  return new Set((Array.isArray(listed) ? listed : []).filter((id): id is string => typeof id === "string" && costumeUnlocked(id, state)));
}

// ---- each door's chip ----------------------------------------------------------------------

export type DoorChipKind = "start" | "presents" | "done" | "today" | "missed" | "soon";

/** What a door's costumes are, on the chip beside the door: the first that is true of From the
 *  start, presents waiting, done, today, missed, or its day. */
export function doorChip(door: number, view: WardrobeView): { kind: DoorChipKind; words: string } {
  if (door === 0) return { kind: "start", words: "From the start" };
  const state = safeState(view.state);
  const fresh = freshCostumes(view.fresh, state);
  const waiting = COSTUMES.filter((c) => c.door === door && fresh.has(c.id)).length;
  if (waiting > 0) return { kind: "presents", words: waiting === 1 ? "A present" : "Two presents" };
  if (state.doors.includes(door)) return { kind: "done", words: "Done" };
  const day = (Array.isArray(view.doorDays) ? view.doorDays : []).find((d) => d.door === door);
  const clueAt = day?.clueAt;
  if (clueAt && view.now && sameDay(clueAt, view.now)) return { kind: "today", words: "Today" };
  if (clueAt && view.now && clueAt.getTime() < view.now.getTime()) return { kind: "missed", words: "Missed" };
  return { kind: "soon", words: clueAt ? dayWords(clueAt) : `Door ${door}` };
}

/** Why a locked costume is locked, on its note: what the door's chip says, in a sentence. A missed door the
 *  family can still crack from Detective HQ (Plan 2c-1) says so: it may not know the place to visit. */
function lockNote(door: number, view: WardrobeView): string {
  const kind = doorChip(door, view).kind;
  if (kind === "today") return "Crack today's door to open it";
  if (kind === "missed") return crackable(view).includes(door) ? "Crack it in Detective HQ to catch up" : "Visit the place to catch up";
  return `Opens with door ${door}`;
}

/** The doors the family can still crack from Detective HQ, or none when the view holds no list. */
const crackable = (view: WardrobeView): readonly number[] => (Array.isArray(view.crackable) ? view.crackable : []);

/** The chip's look (src/elf/pages/paper.ts's pieces) for each kind. */
const CHIP_LOOK: Record<DoorChipKind, string> = { start: "done", presents: "new", done: "done", today: "today", missed: "missed", soon: "soon" };

// ---- one choice ----------------------------------------------------------------------------

interface Tile {
  /** The radio group, and this choice's value in it. */
  name: string;
  value: string;
  id: string;
  /** The picture, already safe markup, or nothing for a choice that is only words. */
  art: string;
  /** The words under the picture. */
  caption: string;
  /** The whole choice in words, for a screen reader. */
  words: string;
  checked: boolean;
  /** Why it cannot be picked yet, as its note says it. */
  lock?: string;
  /** A costume that has arrived and is not opened yet: the present it is wrapped in. */
  present?: string;
  kind?: string;
}

function tile(t: Tile): string {
  const classes = ["elf-wd-tile"];
  if (t.kind) classes.push(`elf-wd-tile--${t.kind}`);
  if (t.lock) classes.push("is-locked");
  if (t.present) classes.push("is-new");
  const lock = t.lock ? `${t.lock.charAt(0).toLowerCase()}${t.lock.slice(1)}` : "";
  const said = t.words + (t.lock ? `, ${lock}` : t.present ? ", a present to open" : "");
  return (
    `<div class="${classes.join(" ")}">` +
    `<input type="radio" name="${t.name}" id="${t.id}" value="${escapeHtml(t.value)}"${t.checked ? " checked" : ""}${t.lock ? " disabled" : ""} />` +
    `<label for="${t.id}">` +
    (t.art ? `<span class="elf-wd-art" aria-hidden="true">${t.art}</span>` : "") +
    (t.caption ? `<span class="elf-wd-name" aria-hidden="true">${escapeHtml(t.caption)}</span>` : "") +
    (t.lock
      ? `<span class="elf-wd-lock" aria-hidden="true"><img src="${PAPER}icons/icon-lock.webp" width="138" height="192" alt="" loading="lazy" decoding="async" /></span>` +
        `<span class="elf-wd-why" aria-hidden="true">${escapeHtml(t.lock)}</span>`
      : "") +
    (t.present
      ? `<span class="elf-wd-present" aria-hidden="true"><img src="${PAPER}deco/present-${t.present}.webp" width="480" height="480" alt="" loading="lazy" decoding="async" /><span>Tap to open</span></span>`
      : "") +
    `<span class="sr-only">${escapeHtml(said)}</span>` +
    `</label></div>`
  );
}

/** A choice that is only words, on a torn paper button: "No costume", "Bunches". */
function wordTile(name: string, id: string, value: string, label: string, checked: boolean): string {
  return (
    `<div class="elf-wd-tile elf-wd-tile--word">` +
    `<input type="radio" name="${name}" id="${id}" value="${escapeHtml(value)}"${checked ? " checked" : ""} />` +
    `<label for="${id}"><span class="elf-wd-name">${escapeHtml(label)}</span></label></div>`
  );
}

const picture = (src: string, w: number, h: number, lazy: boolean, extra = ""): string =>
  `<img src="${PAPER}${src}" width="${w}" height="${h}" alt=""${lazy ? ' loading="lazy"' : ""} decoding="async"${extra} />`;

/** A group of choices, with none on offer first where the thing can be left off. */
function group(legend: string, body: string, kind = ""): string {
  return `<fieldset class="elf-wd-group${kind ? ` elf-wd-group--${kind}` : ""}"><legend>${escapeHtml(legend)}</legend>${body}</fieldset>`;
}

// ---- the stage -------------------------------------------------------------------------------

/** The painted fairy lights of the village scene, as [left %, top %, size]: each given a warm glow. */
const BULBS: readonly (readonly [number, number, number])[] = [
  [4.58, 15.53, 3.42], [13.28, 12.57, 4.1], [24.15, 6.4, 3.91], [30.17, 11.07, 4.2], [38.82, 15.1, 4], [49.78, 16.63, 4], [59.85, 15.12, 4],
  [68.38, 11.03, 4], [74.33, 4.9, 4], [83.33, 11.64, 4.2], [93.33, 15.79, 4.2], [3.86, 27.97, 3.4], [96.4, 28.2, 3.4],
];

/** The elf on its stage: the look's pictures laid in order, inside its paper frame, with the scene's
 *  fairy lights. The pictures are the ones lookPictures names, so the page, its script and the
 *  server's PNG all lay the same ones. */
function stage(look: ElfLook, state: WardrobeState, label: string): string {
  const pictures = lookPictures(look, state);
  const parts = (["scene", "body", "glasses", "bow", "friend"] as const)
    .filter((part) => pictures[part])
    // The elf, glasses, bow tie and scene are each the whole 640 by 960 canvas; a friend is fitted in a square.
    .map((part) => `<img class="elf-wd-pic" data-picture="${part}" src="${PAPER}${pictures[part]}" width="${part === "friend" ? 240 : 640}" height="${part === "friend" ? 240 : 960}" alt="" decoding="async" />`)
    .join("");
  const glows = BULBS.map(([x, y, d], i) => `<span style="left:${x}%;top:${y}%;--d:${d};--t:-${((i * 0.73) % 2.8).toFixed(2)}s"></span>`).join("");
  const frame = look.frame ? ` elf-frame--${look.frame}` : "";
  return (
    `<div class="elf-frame${frame} elf-wd-frame">` +
    `<div class="elf-wd-stage" role="img" aria-label="${escapeHtml(label)}" data-scene="${escapeHtml(look.scene)}">${parts}` +
    `<span class="elf-wd-glows" aria-hidden="true">${glows}</span>` +
    `<span class="elf-wd-snow" aria-hidden="true"></span><span class="elf-wd-flash" aria-hidden="true"></span>` +
    `</div></div>`
  );
}

/** One favourite look, pegged on the string: a button that wears it again. */
function polaroid(look: ElfLook, state: WardrobeState): string {
  const pictures = lookPictures(look, state);
  const costume = COSTUMES.find((c) => c.id === look.costume);
  const caption = costume ? costume.name : "My elf";
  return (
    `<button type="button" class="elf-wd-polaroid" aria-label="Wear this look again: ${escapeHtml(caption)}" data-look="${escapeHtml(JSON.stringify(look))}">` +
    `<span class="elf-wd-polaroid__pic" aria-hidden="true">${picture(pictures.scene, 640, 960, true, ' class="elf-wd-polaroid__scene"')}${picture(pictures.body, 640, 960, true, ' class="elf-wd-polaroid__elf"')}</span>` +
    `<span class="elf-wd-polaroid__cap" aria-hidden="true">${escapeHtml(caption)}</span></button>`
  );
}

// ---- step 1: your elf --------------------------------------------------------------------------

function elfMaker(look: ElfLook): string {
  const siblings = SIBLINGS.map((s) => wordTile("sibling", `wd-sib-${s.id}`, s.id, s.name, look.sibling === s.id)).join("");
  const skins = SKIN_TONES.map((s, i) =>
    tile({ name: "skin", value: s.id, id: `wd-skin-${s.id}`, art: paperCircle(s.hex), caption: "", words: `Skin tone ${i + 1}`, checked: look.skin === s.id, kind: "circle" }),
  ).join("");
  const hairs = HAIR_COLOURS.map((h) =>
    tile({ name: "hair", value: h.id, id: `wd-hair-${h.id}`, art: paperCircle(h.hex), caption: h.name, words: `${h.name} hair`, checked: look.hair === h.id, kind: "circle" }),
  ).join("");
  const cuts = HAIR_STYLES.map((h) => wordTile("hairStyle", `wd-cut-${h.id}`, h.id, h.name, look.hairStyle === h.id)).join("");
  return (
    group("Boy or girl", `<div class="elf-wd-row elf-wd-row--words">${siblings}</div>`) +
    group("Skin", `<div class="elf-wd-row elf-wd-row--circles">${skins}</div>`) +
    group("Hair colour", `<div class="elf-wd-row elf-wd-row--circles">${hairs}</div>`) +
    group("Hair style", `<div class="elf-wd-row elf-wd-row--words">${cuts}</div>`)
  );
}

// ---- step 2: dress up ------------------------------------------------------------------------

const PRESENTS = ["crimson", "holly", "cream"] as const;
const SHEETS = ["crimson", "holly", "gold", "tan"] as const;
const STAR = `<svg class="elf-wd-door__star" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m12 2 2.9 6.6 7.1.8-5.3 4.8 1.5 7-6.2-3.6-6.2 3.6 1.5-7L2 9.4l7.1-.8z"/></svg>`;

function costumeTile(c: Costume, look: ElfLook, state: WardrobeState, fresh: Set<string>, view: WardrobeView, at: number): string {
  const open = costumeUnlocked(c.id, state);
  return tile({
    name: "costume",
    value: c.id,
    id: `wd-costume-${c.id}`,
    // The detective's own skin (the script swaps the tiles when the skin is changed); the three from
    // the start, the open tab's first row, come at once and the rest as they come near.
    art: picture(`tiles/costumes/${c.id}-${look.skin}.webp`, 178, 300, c.door !== 0, ` data-costume="${c.id}"`),
    caption: c.name,
    words: c.name,
    checked: look.costume === c.id,
    lock: open ? undefined : lockNote(c.door, view),
    present: open && fresh.has(c.id) ? PRESENTS[at % PRESENTS.length] : undefined,
    kind: "costume",
  });
}

function costumesPanel(look: ElfLook, state: WardrobeState, fresh: Set<string>, view: WardrobeView, opened: number): string {
  const doors: string[] = [];
  let presents = 0;
  for (let door = 0; door <= DOOR_COUNT; door += 1) {
    const tiles = COSTUMES.filter((c) => c.door === door)
      .map((c) => costumeTile(c, look, state, fresh, view, fresh.has(c.id) ? presents++ : 0))
      .join("");
    const chip = doorChip(door, view);
    const name = door === 0 ? chip.words : `Door ${door}`;
    doors.push(
      `<section class="elf-wd-door elf-card elf-card--${SHEETS[door % SHEETS.length]}" aria-label="${door === 0 ? name : `${name}, ${chip.words}`}">` +
        `<header class="elf-wd-door__head"><span class="elf-wd-door__num" aria-hidden="true">${rosette({ className: "elf-wd-door__rosette", petals: 14 })}${door === 0 ? STAR : `<b>${door}</b>`}</span>` +
        `<p class="elf-wd-door__name">${name}</p>` +
        (door === 0 ? "" : `<span class="elf-chip elf-chip--${CHIP_LOOK[chip.kind]} elf-wd-door__chip">${escapeHtml(chip.words)}</span>`) +
        `</header><div class="elf-wd-row">${tiles}</div></section>`,
    );
  }
  return group(
    "Costumes",
    `<p class="elf-wd-haul"><b>${opened}</b> of ${COSTUMES.length} costumes are yours</p>` +
      `<progress class="elf-cane-progress elf-wd-haul__bar" max="${COSTUMES.length}" value="${opened}" aria-label="${opened} of ${COSTUMES.length} costumes are yours">${opened} of ${COSTUMES.length}</progress>` +
      wordTile("costume", "wd-costume-none", "", "No costume", !look.costume) +
      `<div class="elf-wd-doors">${doors.join("")}</div>`,
    "named",
  );
}

function scenesPanel(look: ElfLook): string {
  const tiles = SCENES.map((s) =>
    tile({ name: "scene", value: s.id, id: `wd-scene-${s.id}`, art: picture(`tiles/scenes/${s.id}.webp`, 160, 240, true), caption: s.name, words: s.name, checked: look.scene === s.id, kind: "scene" }),
  ).join("");
  return group("Scenes", `<p class="elf-wd-note">Stand your elf somewhere new. Every scene is yours from the start.</p><div class="elf-wd-row">${tiles}</div>`, "named");
}

function friendsPanel(look: ElfLook): string {
  const tiles = FRIENDS.map((f) =>
    tile({ name: "friend", value: f.id, id: `wd-friend-${f.id}`, art: picture(`friends/${f.id}.webp`, 217, 240, true), caption: f.name, words: f.name, checked: look.friend === f.id, kind: "friend" }),
  ).join("");
  return group("Friends", wordTile("friend", "wd-friend-none", "", "No friend", !look.friend) + `<div class="elf-wd-row">${tiles}</div>`, "named");
}

function framesPanel(look: ElfLook): string {
  const tiles = FRAMES.map((f) =>
    tile({ name: "frame", value: f.id, id: `wd-frame-${f.id}`, art: `<span class="elf-frame elf-frame--${f.id} elf-wd-swatch"></span>`, caption: f.name, words: `${f.name} frame`, checked: look.frame === f.id, kind: "frame" }),
  ).join("");
  return group("Frames", wordTile("frame", "wd-frame-none", "", "No frame", !look.frame) + `<div class="elf-wd-row">${tiles}</div>`, "named");
}

/** Choices that are only words, with none first. */
function wordsGroup(legend: string, name: string, items: readonly WardrobeItem[], worn: string | null, none: string): string {
  const tiles = items.map((item) => wordTile(name, `wd-${name}-${item.id}`, item.id, item.name, worn === item.id)).join("");
  return group(legend, `<div class="elf-wd-row elf-wd-row--words">${wordTile(name, `wd-${name}-none`, "", none, !worn)}${tiles}</div>`, "named");
}

/** The five gift tags that name step 2's sections: [panel, name, icon, tag colour]. */
const TAGS: readonly (readonly [string, string, string, TagColour])[] = [
  ["wd-costumes", "Costumes", "costume", "crimson"],
  ["wd-scenes", "Scenes", "scene", "holly"],
  ["wd-friends", "Friends", "friend", "gold"],
  ["wd-frames", "Frames", "frame", "tan"],
  ["wd-glasses", "Glasses and bow ties", "glasses", "card"],
];

/** The whole wardrobe page. */
export function renderWardrobePage(view: WardrobeView): string {
  const d = view.detective;
  const state = safeState(view.state);
  const look = normaliseLook(view.look, state);
  const fresh = freshCostumes(view.fresh, state);
  const opened = COSTUMES.filter((c) => costumeUnlocked(c.id, state) && !fresh.has(c.id)).length;
  const name = escapeHtml(d.name);
  const hq = sitePath(view.hqUrl) ?? "/";
  const favourites = (Array.isArray(view.favourites) ? view.favourites : []).slice(0, 3).map((f) => normaliseLook(f, state));
  const hairName = HAIR_COLOURS.find((h) => h.id === look.hair)?.name ?? "";
  const styleName = HAIR_STYLES.find((h) => h.id === look.hairStyle)?.name ?? "";
  const sibling = SIBLINGS.find((s) => s.id === look.sibling)?.name ?? "";

  const panels: { id: string; html: string; isNew: boolean }[] = [
    { id: "wd-costumes", isNew: fresh.size > 0, html: costumesPanel(look, state, fresh, view, opened) },
    { id: "wd-scenes", isNew: false, html: scenesPanel(look) },
    { id: "wd-friends", isNew: false, html: friendsPanel(look) },
    { id: "wd-frames", isNew: false, html: framesPanel(look) },
    {
      id: "wd-glasses",
      isNew: false,
      html:
        wordsGroup("Glasses", "glasses", GLASSES, look.glasses, "No glasses") +
        wordsGroup("Bow ties", "bow", BOWS, look.bow, "No bow tie") +
        `<p class="elf-wd-note">A bow tie shows when there is no costume on.</p>`,
    },
  ];
  const tags = TAGS.map(
    ([id, label, ic, colour], i) =>
      `<li><a class="elf-wd-tab elf-tag" href="#${id}">${giftTag({ i, colour })}` +
      `<span class="elf-wd-tab__label"><img src="${PAPER}icons/icon-${ic}.webp" width="150" height="192" alt="" decoding="async" />${escapeHtml(label)}</span>` +
      `${panels[i].isNew ? '<span class="elf-wd-tab__new"><span class="sr-only">, new things</span></span>' : ""}</a></li>`,
  ).join("");
  const panelHtml = panels.map((p) => `<div class="elf-wd-panel" id="${p.id}">${p.html}</div>`).join("\n          ");
  const looks = favourites.length
    ? favourites.map((f) => polaroid(f, state)).join("")
    : `<p class="elf-wd-looks__empty">Snap a photo to peg your look here</p>`;
  const icon = (ic: string): string => `<img src="${PAPER}icons/icon-${ic}.webp" width="150" height="192" alt="" decoding="async" />`;

  const main = `  <section class="page-top elf-top elf-wd-top" aria-labelledby="elf-wd-heading">
    <div class="wrap">
      <p class="elf-label">Elf Detective School</p>
      ${titleStrip({ text: "The wardrobe", tag: "h1", id: "elf-wd-heading" })}
      <p class="lede">Dress your elf. Every door you do brings two new costumes, wrapped up as presents.</p>
    </div>
  </section>

  <section class="elf-wd-section" aria-label="Dress the elf">
    <div class="wrap">
      <form class="elf-wd" method="post" action="${sitePath(view.saveUrl) ?? "/"}" data-api="/api/elf/look" data-doors="${state.doors.join(",")}" data-made="${view.made ? "true" : "false"}">
        <input type="hidden" name="detective" value="${escapeHtml(d.id)}" />
        <aside class="elf-wd-preview" aria-label="${name}'s elf">
          <div class="elf-wd-stick">
            <div class="elf-wd-show">
              <img class="elf-wd-hang elf-wd-hang--a" src="${PAPER}deco/bauble.webp" width="393" height="480" alt="" decoding="async" />
              <img class="elf-wd-hang elf-wd-hang--b" src="${PAPER}deco/bauble.webp" width="393" height="480" alt="" decoding="async" />
              ${stage(look, state, `${d.name}'s elf`)}
              <p class="elf-wd-say" aria-live="polite"></p>
              <span class="elf-wd-seal" aria-hidden="true">${rosette({ className: "elf-wd-seal__rosette", petals: 18, tails: true })}<b>${opened}</b> <small>of ${COSTUMES.length}</small></span>
            </div>
            <p class="elf-wd-taphint" aria-hidden="true" hidden>Tap the stage to make it snow</p>
            <div class="elf-wd-tools" hidden>
              <button type="button" class="elf-btn elf-btn--cane elf-wd-surprise">${icon("surprise")}<span>Surprise me</span></button>
              <button type="button" class="elf-btn elf-btn--holly elf-wd-snap">${icon("camera")}<span>Snap a photo</span></button>
            </div>
          </div>
        </aside>
        <!-- The name plate is not in the stage's column: beside the choices the stage stays in view, and
             anything under it in its column would be hidden as the page scrolls (Jaimie, 8 November 2026). -->
        <div class="elf-wd-plate elf-card elf-card--crimson">
          ${headingStrip({ text: d.name, tag: "h2", back: "holly" })}
          <p class="elf-wd-preview__rank">Badge ${escapeHtml(d.badgeNumber)} <span class="elf-chip elf-chip--done">${escapeHtml(d.rank)}</span></p>
          <p class="elf-wd-wearing">${escapeHtml(lookWords(look, state))}</p>
          <p class="elf-wd-status" role="status"></p>
          <button class="elf-btn elf-btn--crimson" type="submit">Save this look</button>
          <section class="elf-wd-looks" aria-labelledby="wd-looks-h">
            ${headingStrip({ text: "My favourite looks", tag: "h3", back: "tan", id: "wd-looks-h" })}
            <div class="elf-wd-looks__line"><span class="elf-wd-looks__string" aria-hidden="true"></span><div class="elf-wd-looks__row">${looks}</div></div>
          </section>
          <button type="button" class="elf-btn elf-btn--s elf-wd-sound" aria-pressed="false" hidden>${icon("bell")}<span>Sounds off</span></button>
        </div>

        <div class="elf-wd-dress">
          <section class="elf-wd-step elf-wd-step--elf" aria-labelledby="wd-step1">
            <div class="elf-wd-me elf-card elf-card--holly">
              <img class="elf-deco elf-wd-me__bow" src="${PAPER}deco/bow-gold.webp" width="480" height="361" alt="" decoding="async" />
              <span class="elf-wd-me__badge" aria-hidden="true">${rosette({ className: "elf-wd-me__rosette", petals: 20 })}<img class="elf-wd-me__face" src="${PAPER}${lookPictures(look, state).body}" width="640" height="960" alt="" decoding="async" /></span>
              <div class="elf-wd-me__words"><h2 id="wd-step1">Your elf</h2><p class="elf-wd-me__said">${escapeHtml(`${sibling}, ${`${hairName} ${styleName}`.toLowerCase()}`)}</p></div>
              <button type="button" class="elf-btn elf-btn--s elf-wd-change" aria-expanded="true" aria-controls="wd-elf" hidden>Change</button>
            </div>
            <div class="elf-wd-fold" id="wd-elf"><div class="elf-wd-fold__in">
              <div class="elf-paper elf-wd-maker">
                <span class="elf-tape" aria-hidden="true"></span>
                <p class="elf-wd-maker__title">Make your elf</p>
                ${elfMaker(look)}
                <button type="button" class="elf-btn elf-btn--crimson elf-btn--l elf-wd-done" hidden>Done, dress me up</button>
              </div>
            </div></div>
          </section>

          <section class="elf-wd-step elf-wd-step--dress" aria-labelledby="wd-step2">
            ${headingStrip({ text: "Dress up", tag: "h2", back: "crimson", id: "wd-step2" })}
            <ul class="elf-wd-tabs">${tags}</ul>
          ${panelHtml}
          </section>
          <p class="elf-wd-back"><a class="elf-btn" href="${hq}">Back to Detective HQ</a></p>
        </div>
      </form>
    </div>
  </section>
  <button type="button" class="elf-wd-peek" aria-label="Back to your elf" hidden></button>`;

  return elfPage({
    title: "The wardrobe",
    description: "Dress your elf detective in costumes that unlock as you do the doors, with scenes, friends, frames, glasses and bow ties.",
    cta: { href: view.hqUrl, label: "Detective HQ" },
    home: view.calendarUrl,
    main,
    scripts: ["elf-wardrobe.js", "elf-wardrobe-ui.js"],
  });
}
