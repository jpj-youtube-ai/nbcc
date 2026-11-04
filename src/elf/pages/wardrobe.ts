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
import { icon } from "./icons";
import { elfPage, escapeHtml, sitePath } from "./shell";
import type { WardrobeView } from "./types";

// NBCC Elf Detective School: the wardrobe, where a detective dresses their elf in paper
// (docs/superpowers/specs/2026-11-04-elf-paper-design.md).
//
// The page is ONE form of choices: who the elf is, a whole costume, and the extras (a scene, a friend,
// a frame, glasses, a bow tie). Every choice is a radio button, so it works with no script: pick,
// press Save, and the server keeps the look. The page's script (assets/js/elf-wardrobe-ui.js) changes
// the stage as things are tried on, and saves without leaving the page.
//
// Every costume is shown, unlocked or not. One that is still locked cannot be picked: it is faint,
// wears a padlock and says which door opens it. The saved look is made safe before it is drawn, so the
// elf never wears what it has not unlocked, whatever was stored.
//
// Every picture and every rule comes from the one wardrobe file the browser also loads
// (src/elf/wardrobe.ts), so the page and its script cannot disagree.
//
// Pure: no pool, no config, no clock. Unit tested in test/unit/elf-page-wardrobe.test.ts.

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
  /** Why it cannot be picked yet: a few words for the tile, and the same thing in full. */
  lock?: { short: string; full: string };
  fresh?: boolean;
  kind?: string;
}

function tile(t: Tile): string {
  const classes = ["elf-wd-tile"];
  if (t.kind) classes.push(`elf-wd-tile--${t.kind}`);
  if (t.lock) classes.push("is-locked");
  if (t.fresh) classes.push("is-new");
  const said = t.words + (t.lock ? `, ${t.lock.full}` : t.fresh ? ", new" : "");
  return (
    `<div class="${classes.join(" ")}">` +
    `<input type="radio" name="${t.name}" id="${t.id}" value="${escapeHtml(t.value)}"${t.checked ? " checked" : ""}${t.lock ? " disabled" : ""} />` +
    `<label for="${t.id}">` +
    (t.art ? `<span class="elf-wd-art" aria-hidden="true">${t.art}</span>` : "") +
    (t.lock
      ? `<span class="elf-wd-lock" aria-hidden="true">${icon("padlock", 13)} ${escapeHtml(t.lock.short)}</span>`
      : `<span class="elf-wd-name" aria-hidden="true">${escapeHtml(t.caption)}</span>`) +
    (t.fresh ? `<span class="elf-wd-new" aria-hidden="true">New</span>` : "") +
    `<span class="sr-only">${escapeHtml(said)}</span>` +
    `</label></div>`
  );
}

/** A choice that is only words: "No costume", "Bunches". */
function wordTile(name: string, id: string, value: string, label: string, checked: boolean): string {
  return (
    `<div class="elf-wd-tile elf-wd-tile--word">` +
    `<input type="radio" name="${name}" id="${id}" value="${escapeHtml(value)}"${checked ? " checked" : ""} />` +
    `<label for="${id}"><span class="elf-wd-name">${escapeHtml(label)}</span></label></div>`
  );
}

const swatch = (fill: string, edge: string): string =>
  `<svg width="40" height="40" viewBox="0 0 40 40" focusable="false"><circle cx="20" cy="20" r="17" fill="${fill}" stroke="${edge}" stroke-width="2"/></svg>`;

const picture = (src: string, w: number, h: number, extra = ""): string =>
  `<img src="${PAPER}${src}" width="${w}" height="${h}" alt="" loading="lazy" decoding="async"${extra} />`;

/** A group of choices, with none on offer first where the thing can be left off. */
function group(legend: string, body: string, kind = ""): string {
  return `<fieldset class="elf-wd-group${kind ? ` elf-wd-group--${kind}` : ""}"><legend>${escapeHtml(legend)}</legend>${body}</fieldset>`;
}

// ---- the stage -------------------------------------------------------------------------------

/** The elf on its stage: the look's pictures laid in order, inside its frame. The pictures are the
 *  ones lookPictures names, so the page, its script and the server's PNG all lay the same ones. */
function stage(look: ElfLook, state: WardrobeState, label: string): string {
  const pictures = lookPictures(look, state);
  const parts = (["scene", "body", "glasses", "bow", "friend"] as const)
    .filter((part) => pictures[part])
    // The elf, glasses, bow tie and scene are each the whole 640 by 960 canvas; a friend is fitted in a square.
    .map((part) => `<img class="elf-wd-pic" data-picture="${part}" src="${PAPER}${pictures[part]}" width="${part === "friend" ? 240 : 640}" height="${part === "friend" ? 240 : 960}" alt="" decoding="async" />`)
    .join("");
  const frame = look.frame ? ` elf-frame--${look.frame}` : "";
  return `<div class="elf-wd-stage${frame}" role="img" aria-label="${escapeHtml(label)}">${parts}</div>`;
}

// ---- the sections ----------------------------------------------------------------------------

function elfPanel(look: ElfLook): string {
  const siblings = SIBLINGS.map((s) => wordTile("sibling", `wd-sib-${s.id}`, s.id, s.name, look.sibling === s.id)).join("");
  const skins = SKIN_TONES.map((s, i) =>
    tile({ name: "skin", value: s.id, id: `wd-skin-${s.id}`, art: swatch(s.hex, "#B39A82"), caption: "", words: `Skin tone ${i + 1}`, checked: look.skin === s.id, kind: "swatch" }),
  ).join("");
  const hairs = HAIR_COLOURS.map((h) =>
    tile({ name: "hair", value: h.id, id: `wd-hair-${h.id}`, art: swatch(h.hex, h.dark), caption: h.name, words: `${h.name} hair`, checked: look.hair === h.id, kind: "swatch" }),
  ).join("");
  const cuts = HAIR_STYLES.map((h) => wordTile("hairStyle", `wd-cut-${h.id}`, h.id, h.name, look.hairStyle === h.id)).join("");
  return (
    group("Boy or girl", `<div class="elf-wd-row elf-wd-row--words">${siblings}</div>`) +
    group("Skin", `<div class="elf-wd-row elf-wd-row--swatches">${skins}</div>`) +
    group("Hair colour", `<div class="elf-wd-row elf-wd-row--swatches">${hairs}</div>`) +
    group("Hair style", `<div class="elf-wd-row elf-wd-row--words">${cuts}</div>`)
  );
}

function costumeTile(c: Costume, look: ElfLook, state: WardrobeState, fresh: Set<string>): string {
  const open = costumeUnlocked(c.id, state);
  return tile({
    name: "costume",
    value: c.id,
    id: `wd-costume-${c.id}`,
    // The detective's own skin; the script swaps the tiles when the skin is changed.
    art: picture(`tiles/costumes/${c.id}-${look.skin}.webp`, 178, 300, ` data-costume="${c.id}"`),
    caption: c.name,
    words: c.name,
    checked: look.costume === c.id,
    lock: open ? undefined : { short: `Door ${c.door}`, full: `opens with door ${c.door}` },
    fresh: open && fresh.has(c.id),
    kind: "costume",
  });
}

function costumesPanel(look: ElfLook, state: WardrobeState, fresh: Set<string>): string {
  const doors: string[] = [];
  for (let door = 0; door <= DOOR_COUNT; door += 1) {
    const tiles = COSTUMES.filter((c) => c.door === door).map((c) => costumeTile(c, look, state, fresh)).join("");
    doors.push(`<div class="elf-wd-door"><p class="elf-wd-door__name">${door === 0 ? "From the start" : `Door ${door}`}</p><div class="elf-wd-row">${tiles}</div></div>`);
  }
  return group("Costumes", wordTile("costume", "wd-costume-none", "", "No costume", !look.costume) + `<div class="elf-wd-doors">${doors.join("")}</div>`, "named");
}

function scenesPanel(look: ElfLook): string {
  const tiles = SCENES.map((s) =>
    tile({ name: "scene", value: s.id, id: `wd-scene-${s.id}`, art: picture(`tiles/scenes/${s.id}.webp`, 160, 240), caption: s.name, words: s.name, checked: look.scene === s.id, kind: "scene" }),
  ).join("");
  return group("Scenes", `<div class="elf-wd-row">${tiles}</div>`, "named");
}

function friendsPanel(look: ElfLook): string {
  const tiles = FRIENDS.map((f) =>
    tile({ name: "friend", value: f.id, id: `wd-friend-${f.id}`, art: picture(`friends/${f.id}.webp`, 120, 120), caption: f.name, words: f.name, checked: look.friend === f.id, kind: "friend" }),
  ).join("");
  return group("Friends", wordTile("friend", "wd-friend-none", "", "No friend", !look.friend) + `<div class="elf-wd-row">${tiles}</div>`, "named");
}

/** Choices that are only words, with none first. */
function wordsGroup(legend: string, name: string, items: readonly WardrobeItem[], worn: string | null, none: string): string {
  const tiles = items.map((item) => wordTile(name, `wd-${name}-${item.id}`, item.id, item.name, worn === item.id)).join("");
  return group(legend, `<div class="elf-wd-row elf-wd-row--words">${wordTile(name, `wd-${name}-none`, "", none, !worn)}${tiles}</div>`, "named");
}

/** The whole wardrobe page. */
export function renderWardrobePage(view: WardrobeView): string {
  const d = view.detective;
  const state = safeState(view.state);
  const look = normaliseLook(view.look, state);
  const fresh = freshCostumes(view.fresh, state);
  const name = escapeHtml(d.name);
  const hq = sitePath(view.hqUrl) ?? "/";

  const sections: { id: string; name: string; isNew: boolean; html: string }[] = [
    { id: "wd-elf", name: "Your elf", isNew: false, html: elfPanel(look) },
    { id: "wd-costumes", name: "Costumes", isNew: fresh.size > 0, html: costumesPanel(look, state, fresh) },
    { id: "wd-scenes", name: "Scenes", isNew: false, html: scenesPanel(look) },
    { id: "wd-friends", name: "Friends", isNew: false, html: friendsPanel(look) },
    { id: "wd-frames", name: "Frames", isNew: false, html: wordsGroup("Frames", "frame", FRAMES, look.frame, "No frame") },
    {
      id: "wd-glasses",
      name: "Glasses and bow ties",
      isNew: false,
      html:
        wordsGroup("Glasses", "glasses", GLASSES, look.glasses, "No glasses") +
        wordsGroup("Bow ties", "bow", BOWS, look.bow, "No bow tie") +
        `<p class="elf-wd-note">A bow tie shows when there is no costume on.</p>`,
    },
  ];
  const tabs = sections
    .map(
      (s) =>
        `<li><a class="elf-wd-tab" href="#${s.id}">${escapeHtml(s.name)}` +
        `${s.isNew ? '<span class="elf-wd-tab__new"><span class="sr-only">, new things</span></span>' : ""}</a></li>`,
    )
    .join("");
  const panels = sections.map((s) => `<div class="elf-wd-panel" id="${s.id}">${s.html}</div>`).join("\n        ");

  const main = `  <section class="page-top elf-top elf-wd-top" aria-labelledby="elf-wd-heading">
    <div class="wrap">
      <span class="eyebrow">Elf Detective School</span>
      <h1 id="elf-wd-heading">The wardrobe</h1>
      <p class="lede">Two new costumes arrive with every door you do.</p>
    </div>
  </section>

  <section class="elf-wd-section" aria-label="Dress the elf">
    <div class="wrap">
      <form class="elf-wd" method="post" action="${sitePath(view.saveUrl) ?? "/"}" data-api="/api/elf/look" data-doors="${state.doors.join(",")}">
        <input type="hidden" name="detective" value="${escapeHtml(d.id)}" />
        <div class="elf-wd-preview">
          ${stage(look, state, `${d.name}'s elf`)}
          <div class="elf-wd-preview__body">
            <h2>${name}</h2>
            <p class="elf-wd-preview__rank">Badge ${escapeHtml(d.badgeNumber)} &middot; <b>${escapeHtml(d.rank)}</b></p>
            <p class="elf-wd-wearing">${escapeHtml(lookWords(look, state))}</p>
            <p class="elf-wd-status" role="status"></p>
            <button class="btn btn-primary" type="submit">Save this look</button>
          </div>
        </div>
        <div class="elf-wd-choices">
          <ul class="elf-wd-tabs">${tabs}</ul>
        ${panels}
          <p class="elf-wd-back"><a class="elf-link" href="${hq}">Back to Detective HQ</a></p>
        </div>
      </form>
    </div>
  </section>`;

  return elfPage({
    title: "The wardrobe",
    description: "Dress your elf detective in costumes that unlock as you do the doors, with scenes, friends, frames, glasses and bow ties.",
    cta: { href: view.hqUrl, label: "Detective HQ" },
    home: view.calendarUrl,
    main,
    scripts: ["elf-wardrobe.js", "elf-wardrobe-ui.js"],
  });
}
