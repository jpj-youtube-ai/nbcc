/* NBCC Elf Detective School: the elf wardrobe.
 *
 * Every detective builds an elf, and the elf's wardrobe grows as doors are done. This one file
 * holds the whole wardrobe: what there is to wear, how many doors unlock each thing, and which
 * painted layers draw a look (the paintings themselves are listed in assets/js/elf-paint.js). It is
 * shared: the browser loads it as a plain script (window.NBCCElf), and the server loads the very
 * same file (src/elf/wardrobe.ts) to check a look is allowed and to draw an elf for an email, so
 * the two can never disagree.
 *
 * Pieces are mixed and matched by slot (hat, glasses, scarf, top, shoes, gadget, extra) and each
 * comes in three colours. Three new things unlock with every door. Outfits are whole costumes put
 * on in one tap: one arrives every three doors, plus one for the gold seal and one for winning a
 * race.
 *
 * Nothing typed by anyone reaches the drawing: every id is looked up in the lists below and
 * anything unknown or still locked falls back to the starter kit, so a look can never smuggle in
 * markup or wear something it has not earned.
 */
(function () {
  "use strict";

  // The dark brown a colour's trims default to.
  var INK = "#3A2416";
  var DOORS = 24;

  // ---- who the elf is ---------------------------------------------------------------------

  var SKIN_TONES = [
    { id: "s1", hex: "#F6D3B3" },
    { id: "s2", hex: "#E8B48A" },
    { id: "s3", hex: "#C98E5F" },
    { id: "s4", hex: "#9C6644" },
    { id: "s5", hex: "#6B4430" }
  ];

  // `dark` is the edge drawn round the hair. It is chosen to stand out from every skin tone above,
  // because the hair's own colour does not always: brown hair and a brown face are close.
  var HAIR_COLOURS = [
    { id: "dark", name: "Dark brown", hex: "#3A2416", dark: "#1E110A" },
    { id: "brown", name: "Brown", hex: "#7A4B2E", dark: "#4A2C1A" },
    { id: "ginger", name: "Red", hex: "#C9772F", dark: "#8E4F1C" },
    { id: "blonde", name: "Blonde", hex: "#E8C46A", dark: "#A67C1F" },
    { id: "black", name: "Black", hex: "#2B2A33", dark: "#111016" }
  ];

  // A brother or a sister of the school's logo elf, called a boy or a girl on the page (Jaimie,
  // 3 November 2026; the ids stay sister and brother, as the paintings are named). Every hairstyle is
  // open to both.
  var SIBLINGS = [
    { id: "sister", name: "Girl" },
    { id: "brother", name: "Boy" }
  ];

  var HAIR_STYLES = [
    { id: "short", name: "Short" },
    { id: "bunches", name: "Bunches" },
    { id: "curly", name: "Curly" }
  ];

  // ---- what there is to wear --------------------------------------------------------------

  var SLOTS = [
    { id: "hat", name: "Hats", optional: false },
    { id: "face", name: "Glasses", optional: true },
    { id: "neck", name: "Scarves and ties", optional: true },
    { id: "top", name: "Tops", optional: false },
    { id: "feet", name: "Shoes", optional: false },
    { id: "hand", name: "Gadgets", optional: true },
    { id: "extra", name: "Extras", optional: true }
  ];

  // A colour of a style: its id, the word people read, how many doors done unlock it (0 is the
  // starter kit), its main fill, and a darker shade for trims.
  function col(id, name, door, fill, dark) {
    return { id: id, name: name, door: door, fill: fill, dark: dark || INK };
  }

  var MAROON = "#800000";
  var RED = "#C02238";
  var RED_D = "#8E1626";
  var GREEN = "#1A531A";
  var GREEN_D = "#123C12";
  var BLUE = "#2F5D8C";
  var BLUE_D = "#1F4266";
  var GOLD = "#E0B43C";
  var GOLD_D = "#A67C1F";

  var STYLES = [
    // Hats.
    { id: "elf", slot: "hat", name: "Elf hat", box: "46 2 120 100", colours: [
      col("red", "Red", 0, RED), col("green", "Green", 1, GREEN), col("blue", "Blue", 3, BLUE)] },
    { id: "deer", slot: "hat", name: "Detective's hat", box: "44 26 112 76", colours: [
      col("tan", "Tan", 4, "#C9A26B", "#9C7A48"), col("grey", "Grey", 5, "#A9A9A0", "#6B6B64"), col("green", "Green", 11, "#7E9A66", "#55703F")] },
    { id: "bobble", slot: "hat", name: "Bobble hat", box: "48 10 104 84", colours: [
      col("red", "Red", 7, RED), col("green", "Green", 7, GREEN), col("blue", "Blue", 9, BLUE)] },
    { id: "santa", slot: "hat", name: "Santa hat", box: "46 16 132 86", colours: [
      col("red", "Red", 11, RED), col("green", "Green", 12, GREEN), col("blue", "Blue", 16, BLUE)] },
    { id: "tammy", slot: "hat", name: "Tammy", box: "42 24 116 70", colours: [
      col("red", "Red", 19, RED, "#A3202F"), col("green", "Green", 19, GREEN, GREEN), col("blue", "Blue", 21, BLUE, BLUE)] },
    { id: "crown", slot: "hat", name: "Cracker crown", box: "50 46 100 46", colours: [
      col("red", "Red", 22, RED), col("green", "Green", 22, "#2E7D32"), col("gold", "Gold", 24, GOLD)] },
    // Glasses.
    { id: "specs", slot: "face", name: "Round glasses", box: "54 84 92 32", colours: [
      col("black", "Black", 3, INK), col("red", "Red", 5, RED), col("gold", "Gold", 10, "#B8862B")] },
    { id: "stars", slot: "face", name: "Star glasses", box: "66 82 68 34", colours: [
      col("gold", "Gold", 16, GOLD, GOLD_D), col("red", "Red", 19, RED, RED_D), col("blue", "Blue", 23, BLUE, BLUE_D)] },
    // Scarves and ties.
    { id: "stripe", slot: "neck", name: "Striped scarf", box: "58 126 84 62", colours: [
      col("red", "Red", 2, RED), col("green", "Green", 2, GREEN), col("blue", "Blue", 4, BLUE)] },
    { id: "tartan", slot: "neck", name: "Tartan scarf", box: "58 126 84 62", colours: [
      col("red", "Red", 9, "#A3202F"), col("green", "Green", 10, GREEN), col("blue", "Blue", 14, BLUE)] },
    { id: "tinsel", slot: "neck", name: "Tinsel", box: "56 126 88 30", colours: [
      col("gold", "Gold", 15, GOLD, "#FFF4D6"), col("silver", "Silver", 15, "#B9B9C2", "#F4F4F8"), col("red", "Red", 23, RED, "#F6B8C0")] },
    { id: "bow", slot: "neck", name: "Bow tie", box: "76 126 48 32", colours: [
      col("red", "Red", 21, RED, RED_D), col("green", "Green", 22, "#2E7D32", GREEN_D), col("gold", "Gold", 24, GOLD, GOLD_D)] },
    // Tops.
    { id: "tunic", slot: "top", name: "Elf tunic", box: "44 132 112 80", colours: [
      col("green", "Green", 0, GREEN), col("red", "Red", 2, "#A3202F"), col("blue", "Blue", 4, BLUE)] },
    { id: "jumper", slot: "top", name: "Christmas jumper", box: "44 132 112 80", colours: [
      col("red", "Red", 6, RED), col("green", "Green", 6, GREEN), col("blue", "Blue", 9, BLUE)] },
    { id: "puffer", slot: "top", name: "Puffer jacket", box: "44 128 112 84", colours: [
      col("red", "Red", 17, RED, RED_D), col("green", "Green", 17, "#2E7D32", GREEN_D), col("blue", "Blue", 20, BLUE, BLUE_D)] },
    { id: "coat", slot: "top", name: "Detective's coat", box: "44 132 112 84", colours: [
      col("tan", "Tan", 18, "#B88A5D", "#8A6340"), col("grey", "Grey", 18, "#8E8E86", "#6B6B64"), col("navy", "Navy", 21, "#2B3A55", "#1C273A")] },
    // Shoes.
    { id: "curly", slot: "feet", name: "Curly shoes", box: "54 222 92 30", colours: [
      col("maroon", "Maroon", 0, MAROON), col("green", "Green", 1, GREEN), col("gold", "Gold", 7, "#B8862B")] },
    { id: "boots", slot: "feet", name: "Snow boots", box: "62 212 76 40", colours: [
      col("brown", "Brown", 5, "#5A3A22"), col("red", "Red", 6, "#A3202F"), col("blue", "Blue", 8, BLUE)] },
    { id: "wellies", slot: "feet", name: "Wellies", box: "62 200 76 52", colours: [
      col("green", "Green", 13, "#2E7D32", GREEN_D), col("red", "Red", 13, RED, RED_D), col("yellow", "Yellow", 15, "#E9C46A", GOLD_D)] },
    // Gadgets.
    { id: "mag", slot: "hand", name: "Magnifying glass", box: "124 156 50 62", colours: [
      col("brass", "Brass", 1, "#B8862B"), col("silver", "Silver", 3, "#A8A8AE"), col("gold", "Gold", 11, GOLD)] },
    { id: "torch", slot: "hand", name: "Torch", box: "118 106 76 104", colours: [
      col("red", "Red", 8, RED), col("green", "Green", 8, "#2E7D32"), col("blue", "Blue", 13, BLUE)] },
    { id: "notebook", slot: "hand", name: "Notebook", box: "126 160 48 52", colours: [
      col("red", "Red", 14, RED), col("green", "Green", 14, "#2E7D32"), col("blue", "Blue", 17, BLUE)] },
    { id: "lantern", slot: "hand", name: "Lantern", box: "124 184 40 52", colours: [
      col("gold", "Gold", 20, "#B8862B"), col("red", "Red", 20, "#A3202F"), col("green", "Green", 24, GREEN)] },
    // Extras.
    { id: "satchel", slot: "extra", name: "Clue satchel", box: "68 134 78 76", colours: [
      col("brown", "Brown", 10, "#8B5A3C", "#6E4429"), col("red", "Red", 12, "#A3202F", "#7A1622"), col("green", "Green", 18, "#2E7D32", "#1F4F22")] },
    { id: "badge", slot: "extra", name: "Star badge", box: "70 148 32 30", colours: [
      col("gold", "Gold", 12, "#E9C46A", "#B8862B"), col("silver", "Silver", 16, "#D9D9DE", "#8E8E96"), col("bronze", "Bronze", 23, "#D9A277", "#8A5A33")] }
  ];

  // Whole costumes. `doors` is how many doors done unlock it; `special` is the other way in.
  var OUTFITS = [
    { id: "workshop", name: "Workshop elf", doors: 0 },
    { id: "present", name: "Present", doors: 3 },
    { id: "tree", name: "Christmas tree", doors: 6 },
    { id: "pudding", name: "Christmas pudding", doors: 9 },
    { id: "snowman", name: "Snowman", doors: 12 },
    { id: "ginger", name: "Gingerbread elf", doors: 15 },
    { id: "reindeer", name: "Reindeer", doors: 18 },
    { id: "piper", name: "Highland piper", doors: 21 },
    { id: "grad", name: "Graduation robes", doors: 24 },
    { id: "golden", name: "Golden detective", special: "gold-seal" },
    { id: "nessie", name: "Nessie", special: "race-win" }
  ];

  var STARTER = { hat: ["elf", "red"], top: ["tunic", "green"], feet: ["curly", "maroon"] };

  // ---- looking things up ------------------------------------------------------------------

  function find(list, id) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i];
    }
    return null;
  }

  function styleOf(id) {
    return typeof id === "string" ? find(STYLES, id) : null;
  }

  function colourOf(style, colourId) {
    return style && typeof colourId === "string" ? find(style.colours, colourId) : null;
  }

  function outfitOf(id) {
    return typeof id === "string" ? find(OUTFITS, id) : null;
  }

  // Whole doors, from none to 24. Anything that is not a real number counts as none, so the starter
  // kit is always there and nothing else is.
  function doorsOf(state) {
    var n = state && typeof state.doorsDone === "number" && isFinite(state.doorsDone) ? Math.floor(state.doorsDone) : 0;
    return n < 0 ? 0 : n > DOORS ? DOORS : n;
  }

  // ---- what is unlocked -------------------------------------------------------------------

  /** Can this detective wear this colour of this style? */
  function pieceUnlocked(styleId, colourId, state) {
    var colour = colourOf(styleOf(styleId), colourId);
    return !!colour && colour.door <= doorsOf(state);
  }

  /** Can this detective wear this outfit? `state` is { doorsDone, goldSeal, wonRace }. The gold seal
   *  and the race win count only as a plain true, never as text such as "false". */
  function outfitUnlocked(outfitId, state) {
    var outfit = outfitOf(outfitId);
    if (!outfit) return false;
    if (outfit.special === "gold-seal") return !!state && state.goldSeal === true;
    if (outfit.special === "race-win") return !!state && state.wonRace === true;
    return outfit.doors <= doorsOf(state);
  }

  /** Everything that unlocks going from one state to another: pieces as { style, colour }, outfits as ids. */
  function newlyUnlocked(before, after) {
    var pieces = [];
    var outfits = [];
    var i;
    var j;
    for (i = 0; i < STYLES.length; i++) {
      for (j = 0; j < STYLES[i].colours.length; j++) {
        var id = STYLES[i].colours[j].id;
        if (pieceUnlocked(STYLES[i].id, id, after) && !pieceUnlocked(STYLES[i].id, id, before)) {
          pieces.push({ style: STYLES[i].id, colour: id });
        }
      }
    }
    for (i = 0; i < OUTFITS.length; i++) {
      if (outfitUnlocked(OUTFITS[i].id, after) && !outfitUnlocked(OUTFITS[i].id, before)) outfits.push(OUTFITS[i].id);
    }
    return { pieces: pieces, outfits: outfits };
  }

  // ---- words ------------------------------------------------------------------------------

  // A name keeps its capital wherever it comes in a sentence.
  var NAMES = /^(Christmas|Santa|Highland|Nessie)\b/;

  /** Words as they read in the middle of a sentence: "red snow boots", "Christmas tree outfit". */
  function inSentence(words) {
    var text = typeof words === "string" ? words : "";
    return NAMES.test(text) ? text : text.charAt(0).toLowerCase() + text.slice(1);
  }

  /** The words for a piece: "Grey detective's hat". Empty for anything unknown. */
  function pieceWords(styleId, colourId) {
    var style = styleOf(styleId);
    var colour = colourOf(style, colourId);
    if (!style || !colour) return "";
    return colour.name + " " + inSentence(style.name);
  }

  /** The words for an outfit: "Christmas tree outfit". Empty for anything unknown. */
  function outfitWords(outfitId) {
    var outfit = outfitOf(outfitId);
    return outfit ? outfit.name + " outfit" : "";
  }

  // ---- a look -----------------------------------------------------------------------------

  /** What a brand new detective's elf wears. */
  function defaultLook() {
    return {
      sibling: "sister",
      skin: "s2",
      hair: "brown",
      hairStyle: "short",
      outfit: null,
      pieces: { hat: STARTER.hat.slice(), face: null, neck: null, top: STARTER.top.slice(), feet: STARTER.feet.slice(), hand: null, extra: null }
    };
  }

  /** A look made safe to keep and to draw: anything unknown, misplaced or still locked falls back
   *  to the starter kit (or to nothing, for a slot that can be empty). */
  function normaliseLook(look, state) {
    var out = defaultLook();
    var given = look && typeof look === "object" ? look : {};
    // Each part is read ONCE into a variable and only that is checked and kept, so a look that
    // answers differently the second time it is asked cannot slip something past the check.
    var sibling = given.sibling;
    var skin = given.skin;
    var hair = given.hair;
    var hairStyle = given.hairStyle;
    var outfit = given.outfit;
    var worn = given.pieces;
    if (typeof sibling === "string" && find(SIBLINGS, sibling)) out.sibling = sibling;
    if (typeof skin === "string" && find(SKIN_TONES, skin)) out.skin = skin;
    if (typeof hair === "string" && find(HAIR_COLOURS, hair)) out.hair = hair;
    if (typeof hairStyle === "string" && find(HAIR_STYLES, hairStyle)) out.hairStyle = hairStyle;
    if (typeof outfit === "string" && outfitUnlocked(outfit, state)) out.outfit = outfit;
    var pieces = worn && typeof worn === "object" ? worn : {};
    for (var i = 0; i < SLOTS.length; i++) {
      var slot = SLOTS[i];
      var choice = pieces[slot.id];
      var styleId = Array.isArray(choice) ? choice[0] : null;
      var colourId = Array.isArray(choice) ? choice[1] : null;
      var style = styleOf(styleId);
      if (style && style.slot === slot.id && typeof colourId === "string" && pieceUnlocked(styleId, colourId, state)) {
        out.pieces[slot.id] = [styleId, colourId];
      } else if (slot.optional) {
        out.pieces[slot.id] = null;
      }
    }
    return out;
  }

  /** What a look is wearing, as one line: "Tan detective's hat, black round glasses and red elf
   *  tunic", or "The Christmas tree outfit" when an outfit covers everything else. The look is made
   *  safe first, the way drawElf does, so the words always match the drawing. */
  function lookWords(look, state) {
    var safe = normaliseLook(look, state);
    if (safe.outfit) return "The " + inSentence(outfitWords(safe.outfit));
    var parts = [];
    for (var i = 0; i < SLOTS.length; i++) {
      var choice = safe.pieces[SLOTS[i].id];
      if (!choice) continue;
      var words = pieceWords(choice[0], choice[1]);
      parts.push(parts.length ? inSentence(words) : words);
    }
    if (parts.length < 2) return parts.join("");
    return parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1];
  }

  // ---- drawing: the painted layers ---------------------------------------------------------
  //
  // The elf and every piece are paintings, made in the logo's style by OpenAI and cut into layers
  // that all sit on one canvas, so any elf can wear any piece (design:
  // docs/superpowers/specs/2026-11-03-elf-painted-wardrobe-design.md; the tool is scripts/elf-paint/).
  // assets/js/elf-paint.js lists every layer that has been painted and where it sits. A drawing is
  // an SVG that stacks those layers as pictures, in this order, bottom to top. An outfit replaces
  // all the pieces.
  var ORDER = ["feet", "top", "extra", "face", "neck", "hat", "hand"];
  var SETS = { tile: true, sm: true, lg: true };
  var FIRST_ELF = "elf-sister-s2-short-brown";
  var BACKDROP = '<circle cx="512" cy="820" r="560" fill="#EAF0E7"/><ellipse cx="512" cy="1345" rx="330" ry="34" fill="#DCCFB9"/>';
  var EMPTY = { canvas: { w: 1024, h: 1536, view: [-79, 0, 1182, 1536] }, layers: {} };

  function loadPaint() {
    if (typeof module !== "undefined" && module.exports) return require("./elf-paint.js");
    return (typeof window !== "undefined" && window.NBCCElfPaint) || EMPTY;
  }
  var paint = loadPaint();

  /** For tests: draw from another list of layers, or null to go back to the real one. */
  function usePaint(manifest) {
    paint = manifest || loadPaint();
  }

  function placeOf(name) {
    return Object.prototype.hasOwnProperty.call(paint.layers, name) ? paint.layers[name] : null;
  }

  /** The layers a look is drawn from, bottom to top, each with its place on the canvas. Only what
   *  has been painted is listed: a piece not painted yet is left out, and an elf not painted yet is
   *  the first elf instead (or no elf at all). The browser and the server both stack these. */
  function layersFor(look, state) {
    var safe = normaliseLook(look, state);
    var out = [];
    function add(name) {
      var place = placeOf(name);
      if (place) out.push({ name: name, x: place.x, y: place.y, w: place.w, h: place.h, cover: place.cover || null });
      return !!place;
    }
    if (!add("elf-" + safe.sibling + "-" + safe.skin + "-" + safe.hairStyle + "-" + safe.hair)) add(FIRST_ELF);
    if (safe.outfit) {
      add("outfit-" + safe.outfit);
      return out;
    }
    for (var i = 0; i < ORDER.length; i++) {
      var choice = safe.pieces[ORDER[i]];
      if (choice) add("piece-" + choice[0] + "-" + choice[1]);
    }
    return out;
  }

  function escapeText(value) {
    return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  // A short code made from a drawing, for a drawing that is not given a key of its own. The same
  // drawing always gets the same code.
  function codeOf(text) {
    var hash = 0x811c9dc5;
    for (var i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = (hash * 0x01000193) >>> 0;
    }
    return "e" + hash.toString(36);
  }

  function sizeOf(value, fallback) {
    var n = typeof value === "number" && isFinite(value) ? Math.round(value) : fallback;
    return n < 16 ? 16 : n > 2000 ? 2000 : n;
  }

  function picture(set, file, box, extra) {
    return '<image href="/assets/img/elf/' + set + "/" + file + '.webp" x="' + box.x + '" y="' + box.y + '" width="' + box.w + '" height="' + box.h + '" preserveAspectRatio="none"' + (extra || "") + "/>";
  }

  // The layers as an SVG. Where a piece hides part of the elf (an open mitten under a held torch),
  // the elf is drawn through a mask with those parts taken away. The mask's id ends in the
  // drawing's own key, so several elves can share one page.
  function stack(layers, set, width, label, key, backdrop) {
    var v = paint.canvas.view;
    var own = String(key || "").replace(/[^A-Za-z0-9_-]/g, "") || codeOf(set + layers.map(function (l) { return l.name; }).join(","));
    var covers = layers.filter(function (l) { return l.cover; });
    var defs = "";
    if (covers.length) {
      defs = '<defs><mask id="m-' + own + '" maskUnits="userSpaceOnUse" x="' + v[0] + '" y="' + v[1] + '" width="' + v[2] + '" height="' + v[3] + '">' +
        '<rect x="' + v[0] + '" y="' + v[1] + '" width="' + v[2] + '" height="' + v[3] + '" fill="#fff"/>' +
        covers.map(function (l) { return picture(set, l.name + ".cover", l.cover); }).join("") + "</mask></defs>";
    }
    var body = layers.map(function (l, i) {
      return picture(set, l.name, l, i === 0 && covers.length && /^elf-/.test(l.name) ? ' mask="url(#m-' + own + ')"' : "");
    }).join("");
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + Math.round(width * 1.3) + '" viewBox="' + v.join(" ") + '"' +
      (label ? ' role="img" aria-label="' + escapeText(label) + '"' : ' aria-hidden="true"') + ">" +
      defs + (backdrop ? BACKDROP : "") + body + "</svg>";
  }

  /** The whole elf as an SVG string. `state` is what the detective has unlocked. `opts` is:
   *    size      the width in pixels (the height follows);
   *    backdrop  the pale circle behind the elf, on unless false;
   *    label     the words a screen reader says, such as whose elf it is. They are made safe here.
   *              False for an elf that is decoration. Left out, it says "Elf detective";
   *    key       a short name that is this drawing's alone on the page. Give one whenever several
   *              elves are put into one page, so that their masks keep apart;
   *    set       which pictures: "sm" for screens (the default), "lg" for print. */
  function drawElf(look, state, opts) {
    var o = opts || {};
    var width = sizeOf(o.size, 210);
    var label = o.label === false ? "" : typeof o.label === "string" && o.label ? o.label : "Elf detective";
    var set = o.set === "lg" ? "lg" : "sm";
    return stack(layersFor(look, state), set, width, label, o.key, o.backdrop !== false);
  }

  /** One piece on its own, for a wardrobe tile: its small picture, fitted into a square of `size`
   *  and loaded only when it comes near the screen. Empty for anything unknown or not painted. */
  function drawPiece(styleId, colourId, size) {
    var style = styleOf(styleId);
    var colour = colourOf(style, colourId);
    if (!style || !colour) return "";
    var name = "piece-" + style.id + "-" + colour.id;
    var place = placeOf(name);
    if (!place) return "";
    var px = sizeOf(size, 40);
    var w = place.w >= place.h ? px : Math.round((px * place.w) / place.h);
    var h = place.w >= place.h ? Math.round((px * place.h) / place.w) : px;
    return '<img src="/assets/img/elf/tile/' + name + '.webp" width="' + w + '" height="' + h + '" alt="" loading="lazy" decoding="async" />';
  }

  /** One outfit on this elf, for a wardrobe tile, from the tile pictures. Empty for anything
   *  unknown or not painted. */
  function drawOutfit(outfitId, look, size) {
    var outfit = outfitOf(outfitId);
    if (!outfit || !placeOf("outfit-" + outfit.id)) return "";
    var base = normaliseLook(look, { doorsDone: 0 });
    var all = { doorsDone: DOORS, goldSeal: true, wonRace: true };
    return stack(layersFor(Object.assign({}, base, { outfit: outfit.id }), all), "tile", sizeOf(size, 58), "", outfit.id, false);
  }

  // Nothing that reads the catalogue can change it: a slip that set one door number to nought
  // would hand that piece to everyone.
  function freeze(value) {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
      Object.freeze(value);
      for (var name in value) {
        if (Object.prototype.hasOwnProperty.call(value, name)) freeze(value[name]);
      }
    }
    return value;
  }
  [SIBLINGS, SKIN_TONES, HAIR_COLOURS, HAIR_STYLES, SLOTS, STYLES, OUTFITS, STARTER].forEach(freeze);

  var api = {
    DOORS: DOORS,
    SIBLINGS: SIBLINGS,
    SKIN_TONES: SKIN_TONES,
    HAIR_COLOURS: HAIR_COLOURS,
    HAIR_STYLES: HAIR_STYLES,
    SLOTS: SLOTS,
    STYLES: STYLES,
    OUTFITS: OUTFITS,
    pieceUnlocked: pieceUnlocked,
    outfitUnlocked: outfitUnlocked,
    newlyUnlocked: newlyUnlocked,
    pieceWords: pieceWords,
    outfitWords: outfitWords,
    inSentence: inSentence,
    lookWords: lookWords,
    defaultLook: defaultLook,
    normaliseLook: normaliseLook,
    drawElf: drawElf,
    drawPiece: drawPiece,
    drawOutfit: drawOutfit,
    layersFor: layersFor,
    usePaint: usePaint
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    window.NBCCElf = api;
  }
})();
