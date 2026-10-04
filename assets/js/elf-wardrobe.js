/* NBCC Elf Detective School: the elf wardrobe.
 *
 * Every detective builds an elf, and the elf's wardrobe grows as doors are done. This one file
 * holds the whole wardrobe: what there is to wear, how many doors unlock each thing, and how every
 * piece and outfit is drawn. It is shared: the browser loads it as a plain script (window.NBCCElf),
 * and the server loads the very same file (src/elf/wardrobe.ts) to check a look is allowed and to
 * draw an elf for an email, so the two can never disagree.
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

  var CREAM = "#F8F5EE";
  var INK = "#3A2416";
  // Cream trims get a fine outline so they still show on a light page.
  var TRIM = '" stroke="#D9CBB0" stroke-width="1.5';
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
    { id: "ginger", name: "Ginger", hex: "#C9772F", dark: "#8E4F1C" },
    { id: "blonde", name: "Blonde", hex: "#E8C46A", dark: "#A67C1F" },
    { id: "black", name: "Black", hex: "#2B2A33", dark: "#111016" }
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
    var skin = given.skin;
    var hair = given.hair;
    var hairStyle = given.hairStyle;
    var outfit = given.outfit;
    var worn = given.pieces;
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

  // ---- drawing: shared parts ---------------------------------------------------------------

  // Stripes, checks and tartans are SVG patterns, and a pattern is found by its id. On a page that
  // holds several drawings the first element with an id wins, so if every drawing carried the same
  // ids, one hidden drawing would take the stripes off all the others. So the patterns are kept
  // here by name, and svg() gives each drawing only the ones it uses, under ids of its own.
  var PATTERNS = {};

  function pattern(id, w, h, inner) {
    PATTERNS[id] = { w: w, h: h, inner: inner };
  }

  function scarfPattern(key, fill) {
    pattern("ew-sc-" + key, 10, 20, '<rect width="10" height="20" fill="' + fill + '"/><rect width="5" height="20" fill="' + CREAM + '"/>');
  }

  // The lines over a tartan are kept thin, so the cloth's own colour carries it: with thick lines
  // the red tartan and the green one came out much the same brown.
  function tartanPattern(key, base, over, thin) {
    pattern("ew-tt-" + key, 12, 12,
      '<rect width="12" height="12" fill="' + base + '"/><path d="M0 6h12M6 0v12" stroke="' + over + '" stroke-width="1.5"/><path d="M0 2h12M2 0v12" stroke="' + thin + '" stroke-width="0.8"/>');
  }

  function checkPattern(key, base, line) {
    pattern("ew-ck-" + key, 8, 8, '<rect width="8" height="8" fill="' + base + '"/><path d="M0 4h8M4 0v8" stroke="' + line + '" stroke-width="1.5"/>');
  }

  pattern("ew-stp", 14, 10, '<rect width="14" height="10" fill="' + CREAM + '"/><rect width="14" height="5" fill="' + RED + '"/>');
  scarfPattern("red", RED);
  scarfPattern("green", GREEN);
  scarfPattern("blue", BLUE);
  tartanPattern("red", "#A3202F", GREEN, "#E9C46A");
  tartanPattern("green", GREEN, RED, "#E9C46A");
  tartanPattern("blue", BLUE, GREEN, CREAM);
  checkPattern("tan", "#C9A26B", "#9C7A48");
  checkPattern("grey", "#A9A9A0", "#6B6B64");
  checkPattern("green", "#7E9A66", "#55703F");
  checkPattern("gold", GOLD, GOLD_D);

  var LEGS = '<rect x="80" y="198" width="14" height="40" fill="url(#ew-stp)"/><rect x="106" y="198" width="14" height="40" fill="url(#ew-stp)"/>';

  var FACE =
    '<circle cx="76" cy="113" r="7" fill="#F2A7A0" opacity=".75"/><circle cx="124" cy="113" r="7" fill="#F2A7A0" opacity=".75"/>' +
    '<circle cx="84" cy="100" r="5" fill="' + INK + '"/><circle cx="116" cy="100" r="5" fill="' + INK + '"/>' +
    '<circle cx="86" cy="98" r="1.6" fill="#FFFDFA"/><circle cx="118" cy="98" r="1.6" fill="#FFFDFA"/>' +
    '<path d="M90 116q10 10 20 0" fill="none" stroke="' + INK + '" stroke-width="3" stroke-linecap="round"/>';

  function sleeves(fill, width) {
    return '<path d="M76 146Q60 160 56 184M124 146Q140 160 144 184" stroke="' + fill + '" stroke-width="' + (width || 14) + '" fill="none" stroke-linecap="round"/>';
  }

  function hands(skin) {
    return '<circle cx="56" cy="188" r="8" fill="' + skin + '"/><circle cx="144" cy="188" r="8" fill="' + skin + '"/>';
  }

  function ears(skin) {
    return '<path d="M60 92L34 74l22 30z" fill="' + skin + '"/><path d="M140 92l26-18-22 30z" fill="' + skin + '"/>';
  }

  function head(skin) {
    return '<circle cx="100" cy="96" r="44" fill="' + skin + '"/>';
  }

  // Hair is drawn in two passes: the part behind the head, then the part in front of the face.
  // `hair` is a hair colour from the catalogue. Every part of the hair is drawn with a darker edge:
  // brown hair on a brown face is nearly one colour, and the edge is what shows the hair is there.
  function hairGroup(hair, shapes) {
    return '<g fill="' + hair.hex + '" stroke="' + hair.dark + '" stroke-width="1.6" stroke-linejoin="round">' + shapes + "</g>";
  }

  function hairBack(style, hair) {
    if (style === "bunches") return hairGroup(hair, '<circle cx="50" cy="124" r="14"/><circle cx="150" cy="124" r="14"/>');
    if (style === "curly") return hairGroup(hair, '<circle cx="54" cy="96" r="13"/><circle cx="146" cy="96" r="13"/>');
    return "";
  }

  function hairFront(style, hair) {
    if (style === "curly") {
      return hairGroup(hair, '<circle cx="62" cy="76" r="13"/><circle cx="76" cy="62" r="13"/><circle cx="92" cy="55" r="13"/><circle cx="108" cy="55" r="13"/><circle cx="124" cy="62" r="13"/><circle cx="138" cy="76" r="13"/>');
    }
    var fringe = '<path d="M58 90Q58 52 100 50q42 2 42 40-12-14-28-10-14-12-28 0-16-6-28 10z"/>';
    if (style === "bunches") {
      return hairGroup(hair, fringe) + '<circle cx="57" cy="112" r="5" fill="' + RED + '"/><circle cx="143" cy="112" r="5" fill="' + RED + '"/>';
    }
    // Short hair comes down beside the face. A hat is always worn and covers the fringe, so without
    // these two tufts the hair colour a child picks would not show at all.
    return hairGroup(hair, fringe + '<path d="M55.5 88h13q1 16-6 28-6-9-7-28z"/><path d="M144.5 88h-13q-1 16 6 28 6-9 7-28z"/>');
  }

  function star(x, y, fill, stroke) {
    return '<path transform="translate(' + (x - 20) + " " + (y - 5) + ')" d="M20 5l4.1 8.3 9.2 1.3-6.6 6.5 1.6 9.1-8.3-4.4-8.3 4.4 1.6-9.1-6.6-6.5 9.2-1.3z" fill="' + fill + '" stroke="' + stroke + '" stroke-width="1.5"/>';
  }

  // The face on its own, for costumes where only the face shows through.
  function faceIn(skin, cx, cy, rx, ry, ring) {
    return '<ellipse cx="' + cx + '" cy="' + cy + '" rx="' + (rx + 5) + '" ry="' + (ry + 5) + '" fill="' + ring + '"/>' +
      '<ellipse cx="' + cx + '" cy="' + cy + '" rx="' + rx + '" ry="' + ry + '" fill="' + skin + '"/>' +
      '<circle cx="' + (cx - 17) + '" cy="' + (cy + 8) + '" r="5" fill="#F2A7A0" opacity=".75"/><circle cx="' + (cx + 17) + '" cy="' + (cy + 8) + '" r="5" fill="#F2A7A0" opacity=".75"/>' +
      '<circle cx="' + (cx - 10) + '" cy="' + (cy - 3) + '" r="4" fill="' + INK + '"/><circle cx="' + (cx + 10) + '" cy="' + (cy - 3) + '" r="4" fill="' + INK + '"/>' +
      '<circle cx="' + (cx - 8.6) + '" cy="' + (cy - 4.4) + '" r="1.3" fill="#FFFDFA"/><circle cx="' + (cx + 11.4) + '" cy="' + (cy - 4.4) + '" r="1.3" fill="#FFFDFA"/>' +
      '<path d="M' + (cx - 7) + " " + (cy + 9) + 'q7 7 14 0" fill="none" stroke="' + INK + '" stroke-width="2.6" stroke-linecap="round"/>';
  }

  // ---- drawing: the pieces ----------------------------------------------------------------
  // Each takes the colour (from the catalogue) and returns its layer, drawn as worn.

  var PIECES = {
    // Hats.
    elf: function (c) {
      return '<path d="M60 84Q70 24 142 16q-22 22 0 68z" fill="' + c.fill + '"/><path d="M54 84q46-16 92 0v10q-46-16-92 0z" fill="' + CREAM + TRIM + '"/><circle cx="142" cy="16" r="9" fill="' + CREAM + TRIM + '"/>';
    },
    deer: function (c) {
      return '<path d="M56 78Q56 36 100 34t44 44z" fill="url(#ew-ck-' + c.id + ')"/><path d="M54 76q46 12 92 0l6 6q-52 16-104 0z" fill="' + c.dark + '"/><path d="M92 36q8-10 16 0" fill="none" stroke="#5A3A22" stroke-width="3"/>';
    },
    bobble: function (c) {
      return '<path d="M58 74Q58 34 100 32t42 42z" fill="' + c.fill + '"/><path d="M72 48v24M86 38v34M100 34v38M114 38v34M128 48v24" stroke="#FFFDFA" stroke-opacity=".25" stroke-width="3"/><path d="M54 72q46 12 92 0v10q-46 12-92 0z" fill="' + CREAM + TRIM + '"/><circle cx="100" cy="26" r="11" fill="' + CREAM + TRIM + '"/>';
    },
    santa: function (c) {
      return '<path d="M58 86Q62 30 112 24q34-2 50 36-16-10-30-2 12 14 14 28z" fill="' + c.fill + '"/><path d="M52 84q48-16 96 0v12q-48-16-96 0z" fill="' + CREAM + TRIM + '"/><circle cx="163" cy="63" r="11" fill="' + CREAM + TRIM + '"/>';
    },
    tammy: function (c) {
      return '<ellipse cx="100" cy="58" rx="54" ry="21" fill="url(#ew-tt-' + c.id + ')"/><path d="M58 70q42 14 84 0v10q-42 14-84 0z" fill="#2B2A33"/><circle cx="100" cy="39" r="8" fill="' + c.fill + '"/>';
    },
    crown: function (c) {
      return '<path d="M58 84V58l14 12 14-16 14 16 14-16 14 16 14-12v26q-42-14-84 0z" fill="' + c.fill + '"/>';
    },
    // Glasses.
    specs: function (c) {
      return '<g fill="none" stroke="' + c.fill + '" stroke-width="3"><circle cx="84" cy="100" r="11"/><circle cx="116" cy="100" r="11"/><path d="M95 100h10M73 97l-14-5M127 97l14-5"/></g>';
    },
    stars: function (c) {
      var one = "l3.2 8.6 9.2.4-7.2 5.7 2.4 8.8-7.6-5-7.6 5 2.4-8.8-7.2-5.7 9.2-.4z";
      return '<g fill="' + c.fill + '" fill-opacity=".45" stroke="' + c.dark + '" stroke-width="3" stroke-linejoin="round"><path d="M84 87' + one + '"/><path d="M116 87' + one + '"/><path d="M96 98h8" fill="none"/></g>';
    },
    // Scarves and ties.
    stripe: function (c) {
      return '<g stroke="' + c.fill + '" stroke-width="1.5" stroke-linejoin="round"><path d="M66 132q34 14 68 0v12q-34 14-68 0z" fill="url(#ew-sc-' + c.id + ')"/><path d="M112 142l9 40h-12l-6-38z" fill="url(#ew-sc-' + c.id + ')"/></g>';
    },
    tartan: function (c) {
      return '<path d="M66 132q34 14 68 0v12q-34 14-68 0z" fill="url(#ew-tt-' + c.id + ')"/><path d="M112 142l9 40h-12l-6-38z" fill="url(#ew-tt-' + c.id + ')"/>';
    },
    tinsel: function (c) {
      return '<path d="M64 136l6 8 6-8 6 8 6-8 6 8 6-8 6 8 6-8 6 8 6-8 6 8" fill="none" stroke="' + c.fill + '" stroke-width="6" stroke-linejoin="round" stroke-linecap="round"/><path d="M67 140l6 6 6-6 6 6 6-6 6 6 6-6 6 6 6-6 6 6 6-6" fill="none" stroke="' + c.dark + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
    },
    bow: function (c) {
      return '<path d="M100 142l-17-10v20zM100 142l17-10v20z" fill="' + c.fill + '"/><circle cx="100" cy="142" r="5" fill="' + c.dark + '"/>';
    },
    // Tops. Sleeves are drawn separately, in the same colour.
    tunic: function (c) {
      return '<path d="M72 138h56l14 66-10-6-10 6-11-6-11 6-11-6-10 6-10-6-11 6z" fill="' + c.fill + '"/><rect x="64" y="174" width="72" height="8" fill="' + INK + '"/><rect x="94" y="172" width="12" height="12" rx="2" fill="none" stroke="#E9C46A" stroke-width="3"/>';
    },
    jumper: function (c) {
      return '<path d="M72 138h56l10 66H62z" fill="' + c.fill + '"/><path d="M70 160l7.5 8 7.5-8 7.5 8 7.5-8 7.5 8 7.5-8 7.5 8 7.5-8" fill="none" stroke="' + CREAM + '" stroke-width="3" stroke-linejoin="round"/><path d="M64 194h72" stroke="' + CREAM + '" stroke-width="4"/>';
    },
    puffer: function (c) {
      return '<path d="M70 138h60l10 68H60z" fill="' + c.fill + '"/><path d="M68 156h64M66 172h68M63 188h74" stroke="' + c.dark + '" stroke-width="2.5"/><path d="M100 140v66" stroke="' + CREAM + '" stroke-width="2"/><path d="M80 138q20 12 40 0v-7q-20 10-40 0z" fill="' + c.dark + '"/>';
    },
    coat: function (c) {
      return '<path d="M70 138h60l12 70H58z" fill="' + c.fill + '"/><path d="M86 138l14 20-8 6-12-22z" fill="' + c.dark + '"/><path d="M114 138l-14 20 8 6 12-22z" fill="' + c.dark + '"/><path d="M100 158v50" stroke="' + c.dark + '" stroke-width="2"/><rect x="63" y="180" width="74" height="6" fill="' + c.dark + '"/><circle cx="93" cy="172" r="2.5" fill="' + INK + '"/><circle cx="93" cy="196" r="2.5" fill="' + INK + '"/><circle cx="107" cy="172" r="2.5" fill="' + INK + '"/><circle cx="107" cy="196" r="2.5" fill="' + INK + '"/>';
    },
    // Shoes.
    curly: function (c) {
      return '<path d="M95 234v12H72c-12 0-14-12-8-14 3-1 4 4 10 2z" fill="' + c.fill + '"/><path d="M105 234v12h23c12 0 14-12 8-14-3-1-4 4-10 2z" fill="' + c.fill + '"/><circle cx="63" cy="231" r="3.5" fill="#E9C46A"/><circle cx="137" cy="231" r="3.5" fill="#E9C46A"/>';
    },
    boots: function (c) {
      return '<path d="M80 220h15v26H70c-5 0-7-7-2-9l12-4z" fill="' + c.fill + '"/><path d="M120 220h-15v26h25c5 0 7-7 2-9l-12-4z" fill="' + c.fill + '"/><rect x="68" y="244" width="28" height="4" rx="2" fill="' + INK + '"/><rect x="104" y="244" width="28" height="4" rx="2" fill="' + INK + '"/><path d="M80 223h15M105 223h15" stroke="' + CREAM + '" stroke-width="4"/>';
    },
    wellies: function (c) {
      return '<path d="M79 206h16v40H70c-5 0-7-7-2-9l11-4z" fill="' + c.fill + '"/><path d="M121 206h-16v40h25c5 0 7-7 2-9l-11-4z" fill="' + c.fill + '"/><path d="M79 209h16M105 209h16" stroke="' + c.dark + '" stroke-width="4"/><rect x="68" y="244" width="28" height="4" rx="2" fill="' + c.dark + '"/><rect x="104" y="244" width="28" height="4" rx="2" fill="' + c.dark + '"/>';
    },
    // Gadgets, held in the right hand.
    mag: function (c) {
      return '<path d="M146 192l-9 20" stroke="#6E4429" stroke-width="6" stroke-linecap="round"/><circle cx="153" cy="176" r="13" fill="#EAF4F8" stroke="' + c.fill + '" stroke-width="4"/>';
    },
    torch: function (c) {
      return '<g transform="rotate(24 144 188)"><path d="M136 150l-10-38h36l-10 38z" fill="#FFF4D6" opacity=".85"/><rect x="134" y="148" width="20" height="13" rx="3" fill="#C9C9CF"/><rect x="137" y="160" width="14" height="34" rx="3" fill="' + c.fill + '"/><rect x="141" y="168" width="6" height="8" rx="2" fill="' + CREAM + '"/></g>';
    },
    notebook: function (c) {
      return '<g transform="rotate(10 150 190)"><rect x="138" y="170" width="26" height="32" rx="3" fill="' + c.fill + '"/><rect x="143" y="176" width="17" height="3" fill="' + CREAM + '"/><rect x="143" y="183" width="11" height="3" fill="' + CREAM + '"/><path d="M139 175h-4M139 183h-4M139 191h-4M139 198h-4" stroke="' + INK + '" stroke-width="2" stroke-linecap="round"/></g>';
    },
    lantern: function (c) {
      return '<path d="M144 192v6" stroke="' + INK + '" stroke-width="2"/><path d="M134 206a10 9 0 0 1 20 0" fill="none" stroke="' + c.fill + '" stroke-width="3"/><rect x="134" y="206" width="20" height="20" rx="3" fill="#FFF4D6" stroke="' + c.fill + '" stroke-width="3"/><path d="M144 209c-4 5-3 10 0 12 3-2 4-7 0-12z" fill="#E07A2F"/><rect x="131" y="225" width="26" height="5" rx="2" fill="' + c.fill + '"/>';
    },
    // Extras.
    satchel: function (c) {
      return '<path d="M76 142l48 46" stroke="' + c.dark + '" stroke-width="5"/><rect x="110" y="184" width="28" height="20" rx="3" fill="' + c.fill + '"/><path d="M110 184h28v8q-14 6-28 0z" fill="' + c.dark + '"/>';
    },
    badge: function (c) {
      return star(86, 152, c.fill, c.dark);
    }
  };

  // ---- drawing: the outfits ---------------------------------------------------------------
  // Each takes who the elf is ({ skin, hair, hairStyle } as colours and a style id) and returns
  // the whole figure.

  function elfHead(a) {
    return hairBack(a.hairStyle, a.hair) + ears(a.skin) + head(a.skin) + FACE + hairFront(a.hairStyle, a.hair);
  }

  var OUTFIT_DRAW = {
    // The starter kit dressed for work: a tool apron with a pencil in the pocket, a toy mallet and a
    // bell on the hat. It has to look different from the starter pieces, or putting it on would
    // seem to do nothing.
    workshop: function (a) {
      return LEGS + PIECES.curly({ fill: MAROON }) + PIECES.tunic({ fill: GREEN }) + sleeves(GREEN) +
        '<path d="M84 148h32l10 30v20q-26 8-52 0v-20z" fill="#C9A26B" stroke="#9C7A48" stroke-width="2" stroke-linejoin="round"/><path d="M74 178h52" stroke="#9C7A48" stroke-width="3"/>' +
        '<rect x="89" y="182" width="22" height="13" rx="3" fill="#B58C55" stroke="#9C7A48" stroke-width="1.5"/><path d="M105 185l3-12" stroke="#E9C46A" stroke-width="3" stroke-linecap="round"/><path d="M108 173l1-4" stroke="' + INK + '" stroke-width="3" stroke-linecap="round"/>' +
        hands(a.skin) +
        '<path d="M141 198L157 162" stroke="#8B5A3C" stroke-width="5" stroke-linecap="round"/><rect x="142" y="152" width="30" height="15" rx="4" transform="rotate(24 157 159.5)" fill="#B5713A" stroke="#6E4429" stroke-width="2"/>' +
        elfHead(a) + PIECES.elf({ fill: RED }) +
        '<circle cx="142" cy="16" r="9" fill="#E9C46A" stroke="#B8862B" stroke-width="1.5"/><path d="M137 18h10" stroke="#B8862B" stroke-width="1.5" stroke-linecap="round"/>';
    },
    present: function (a) {
      return LEGS + PIECES.curly({ fill: MAROON }) +
        '<path d="M62 150L44 178M138 150l18 28" stroke="' + RED + '" stroke-width="12" stroke-linecap="round"/><circle cx="42" cy="182" r="8" fill="' + a.skin + '"/><circle cx="158" cy="182" r="8" fill="' + a.skin + '"/>' +
        '<rect x="56" y="130" width="88" height="96" rx="4" fill="' + RED + '"/><rect x="94" y="130" width="12" height="96" fill="#E9C46A"/><rect x="56" y="170" width="88" height="12" fill="#E9C46A"/><path d="M126 186l14 6-4 12-14-6z" fill="' + CREAM + '" stroke="#B8862B" stroke-width="1.5"/>' +
        elfHead(a) +
        '<path d="M100 50c-14-20-40-18-36-2 3 10 24 8 36 2zM100 50c14-20 40-18 36-2-3 10-24 8-36 2z" fill="#E9C46A" stroke="#B8862B" stroke-width="2"/><path d="M96 54l-10 18M104 54l10 18" stroke="#E9C46A" stroke-width="5" stroke-linecap="round"/><circle cx="100" cy="51" r="6" fill="#B8862B"/>';
    },
    tree: function (a) {
      return LEGS + PIECES.curly({ fill: MAROON }) +
        '<rect x="80" y="204" width="40" height="8" rx="2" fill="#6E4429"/><path d="M83 212h34l-3 18H86z" fill="#8B5A3C"/>' +
        '<path d="M100 98L172 210H28z" fill="#245A27"/><path d="M100 50L162 146H38z" fill="#2E6B30"/><path d="M100 18L148 88H52z" fill="#357A37"/>' +
        '<path d="M46 138q54 22 108 0M36 198q64 24 128 0" fill="none" stroke="#E9C46A" stroke-width="3" stroke-dasharray="2 5" stroke-linecap="round"/>' +
        '<circle cx="80" cy="62" r="5" fill="' + RED + '"/><circle cx="122" cy="68" r="5" fill="#E9C46A"/><circle cx="56" cy="128" r="6" fill="' + CREAM + '"/><circle cx="144" cy="128" r="6" fill="' + RED + '"/><circle cx="74" cy="182" r="7" fill="#E9C46A"/><circle cx="104" cy="170" r="6" fill="' + RED + '"/><circle cx="134" cy="190" r="7" fill="' + CREAM + '"/><circle cx="96" cy="148" r="5" fill="#E9C46A"/>' +
        '<circle cx="62" cy="152" r="8" fill="' + a.skin + '"/><circle cx="138" cy="152" r="8" fill="' + a.skin + '"/>' +
        faceIn(a.skin, 100, 100, 28, 26, "#1F4F22") + star(100, 2, "#E9C46A", "#B8862B");
    },
    pudding: function (a) {
      return LEGS + PIECES.curly({ fill: INK }) +
        '<circle cx="34" cy="176" r="8" fill="' + a.skin + '"/><circle cx="166" cy="176" r="8" fill="' + a.skin + '"/>' +
        '<circle cx="100" cy="164" r="66" fill="#6B3A1F"/>' +
        '<circle cx="58" cy="188" r="3.5" fill="#3A1E0F"/><circle cx="76" cy="212" r="3.5" fill="#A3202F"/><circle cx="100" cy="222" r="3.5" fill="#3A1E0F"/><circle cx="124" cy="212" r="3.5" fill="#3A1E0F"/><circle cx="142" cy="188" r="3.5" fill="#A3202F"/><circle cx="62" cy="208" r="3" fill="#E9C46A"/><circle cx="138" cy="208" r="3" fill="#E9C46A"/>' +
        '<path d="M40 140Q48 98 100 96t60 44q-8 10-16 0-8 14-18 2-8 14-18 2-8 14-18 2-8 14-18 2-8 12-16-4z" fill="#FBF7EC"/>' +
        faceIn(a.skin, 100, 170, 27, 25, "#4A2614") +
        '<path d="M100 96q-14-14-28-4 12 2 10 12 8-6 18-8zM100 96q14-14 28-4-12 2-10 12-8-6-18-8z" fill="' + GREEN + '"/><circle cx="96" cy="90" r="4.5" fill="' + RED + '"/><circle cx="104" cy="90" r="4.5" fill="' + RED + '"/><circle cx="100" cy="84" r="4.5" fill="' + RED + '"/>';
    },
    snowman: function (a) {
      return '<ellipse cx="82" cy="244" rx="14" ry="6" fill="#2B2A33"/><ellipse cx="118" cy="244" rx="14" ry="6" fill="#2B2A33"/>' +
        '<circle cx="100" cy="196" r="50" fill="#FBFBF7" stroke="#D9D4C7" stroke-width="2"/>' +
        '<path d="M70 136L34 110M130 136l36-26" stroke="#6E4429" stroke-width="4" stroke-linecap="round"/><circle cx="31" cy="107" r="7" fill="' + RED + '"/><circle cx="169" cy="107" r="7" fill="' + RED + '"/>' +
        '<circle cx="100" cy="140" r="38" fill="#FBFBF7" stroke="#D9D4C7" stroke-width="2"/>' +
        '<circle cx="100" cy="150" r="4" fill="#2B2A33"/><circle cx="100" cy="166" r="4" fill="#2B2A33"/><circle cx="100" cy="198" r="4.5" fill="#2B2A33"/><circle cx="100" cy="216" r="4.5" fill="#2B2A33"/>' +
        '<circle cx="100" cy="92" r="44" fill="#FBFBF7" stroke="#D9D4C7" stroke-width="2"/>' +
        faceIn(a.skin, 100, 96, 27, 25, "#E9E4D8") +
        '<path d="M100 96l16 4-16 4z" fill="#E07A2F"/>' +
        '<path d="M64 124q36 14 72 0v10q-36 14-72 0z" fill="' + RED + '"/><path d="M118 132l8 30h-10l-5-28z" fill="' + RED + '"/>' +
        '<rect x="66" y="48" width="68" height="8" rx="2" fill="#2B2A33"/><rect x="78" y="14" width="44" height="36" rx="2" fill="#2B2A33"/><rect x="78" y="40" width="44" height="6" fill="' + RED + '"/><path d="M110 41q6-6 10 0q-6 6-10 0z" fill="' + GREEN + '"/>';
    },
    ginger: function (a) {
      return '<path d="M86 206L80 238M114 206l6 32" stroke="#B5713A" stroke-width="18" stroke-linecap="round"/><path d="M72 236h16M112 236h16" stroke="#FBF7EC" stroke-width="3" stroke-linecap="round" stroke-dasharray="3 3"/>' +
        '<path d="M74 146Q56 160 48 182M126 146Q144 160 152 182" stroke="#B5713A" stroke-width="18" fill="none" stroke-linecap="round"/><path d="M42 176l10 8M148 184l10-8" stroke="#FBF7EC" stroke-width="3" stroke-linecap="round"/>' +
        '<path d="M68 136h64a10 10 0 0 1 10 10v60H58v-60a10 10 0 0 1 10-10z" fill="#B5713A"/><circle cx="100" cy="158" r="5" fill="' + RED + '"/><circle cx="100" cy="176" r="5" fill="' + GREEN + '"/><circle cx="100" cy="194" r="5" fill="#E9C46A"/>' +
        '<circle cx="100" cy="94" r="46" fill="#B5713A"/><ellipse cx="100" cy="98" rx="35" ry="33" fill="none" stroke="#FBF7EC" stroke-width="3" stroke-dasharray="4 4"/>' +
        faceIn(a.skin, 100, 98, 26, 24, "#8E5426");
    },
    reindeer: function (a) {
      return '<ellipse cx="84" cy="242" rx="12" ry="6" fill="' + INK + '"/><ellipse cx="116" cy="242" rx="12" ry="6" fill="' + INK + '"/>' +
        '<path d="M66 134h68l8 104h-34l-4-32h-8l-4 32H58z" fill="#8B5A3C"/><ellipse cx="100" cy="176" rx="22" ry="28" fill="#E9D2B0"/>' +
        '<path d="M74 144Q58 160 56 184M126 144Q142 160 144 184" fill="none" stroke="#8B5A3C" stroke-width="15" stroke-linecap="round"/><circle cx="56" cy="188" r="8" fill="' + INK + '"/><circle cx="144" cy="188" r="8" fill="' + INK + '"/>' +
        '<g fill="none" stroke="#C9A26B" stroke-width="6" stroke-linecap="round"><path d="M80 56L66 18M72 38l-16-6M68 26l6-14"/><path d="M120 56l14-38M128 38l16-6M132 26l-6-14"/></g>' +
        '<path d="M60 74q-26-8-34 6 18 12 38 2z" fill="#8B5A3C"/><path d="M140 74q26-8 34 6-18 12-38 2z" fill="#8B5A3C"/>' +
        '<circle cx="100" cy="94" r="46" fill="#8B5A3C"/>' +
        faceIn(a.skin, 100, 98, 27, 25, "#6E4429") +
        '<circle cx="100" cy="101" r="5" fill="' + RED + '"/><circle cx="98.5" cy="99.5" r="1.4" fill="#F8C8C8"/>';
    },
    piper: function (a) {
      return '<rect x="80" y="204" width="14" height="32" fill="' + CREAM + '"/><rect x="106" y="204" width="14" height="32" fill="' + CREAM + '"/><path d="M80 212h14M106 212h14" stroke="' + RED + '" stroke-width="4"/>' +
        '<path d="M95 234v12H72c-6 0-8-8-2-10z" fill="#2B2A33"/><path d="M105 234v12h23c6 0 8-8 2-10z" fill="#2B2A33"/>' +
        '<path d="M66 176h68l10 36H56z" fill="url(#ew-tt-red)"/>' +
        '<path d="M70 138h60l6 42H64z" fill="#2B2A33"/><path d="M90 138l10 22 10-22z" fill="' + CREAM + '"/><circle cx="92" cy="168" r="2.5" fill="#C9C9CF"/><circle cx="108" cy="168" r="2.5" fill="#C9C9CF"/>' +
        '<path d="M90 180h20v14q-10 10-20 0z" fill="' + CREAM + '" stroke="#D9CBB0" stroke-width="1.5"/><path d="M95 194v8M100 196v8M105 194v8" stroke="#2B2A33" stroke-width="2"/>' +
        '<path d="M58 158L24 112M62 156L34 104M66 158L44 112" stroke="#2B2A33" stroke-width="4" stroke-linecap="round"/><circle cx="24" cy="111" r="4" fill="' + CREAM + '"/><circle cx="34" cy="103" r="4" fill="' + CREAM + '"/><circle cx="44" cy="111" r="4" fill="' + CREAM + '"/>' +
        '<ellipse cx="62" cy="168" rx="18" ry="13" fill="url(#ew-tt-green)" transform="rotate(-20 62 168)"/>' +
        '<path d="M76 146Q70 172 86 196M124 146Q128 176 104 206" stroke="#2B2A33" stroke-width="13" fill="none" stroke-linecap="round"/><path d="M78 176L100 218" stroke="#2B2A33" stroke-width="4"/><circle cx="88" cy="198" r="7" fill="' + a.skin + '"/><circle cx="102" cy="208" r="7" fill="' + a.skin + '"/>' +
        elfHead(a) +
        '<path d="M62 76L78 52q24-8 48 4l12 20q-38-12-76 0z" fill="#2B2A33"/><path d="M62 76q38-12 76 0l-2 6q-36-11-72 0z" fill="url(#ew-tt-red)"/><path d="M136 78l10 20M140 76l14 16" stroke="#2B2A33" stroke-width="3" stroke-linecap="round"/>';
    },
    grad: function (a) {
      return LEGS + PIECES.curly({ fill: "#2A1C05" }) +
        '<path d="M68 136h64l18 102H50z" fill="#2A1C05"/><path d="M90 138L82 238M110 138L118 238" stroke="#B8862B" stroke-width="4"/><path d="M76 136q24 26 48 0z" fill="#B8862B"/>' +
        sleeves("#2A1C05", 18) + hands(a.skin) +
        '<g transform="rotate(-24 152 184)"><rect x="140" y="178" width="30" height="11" rx="5.5" fill="' + CREAM + '" stroke="#D9CBB0" stroke-width="1.5"/><path d="M155 178v11" stroke="' + RED + '" stroke-width="3"/></g>' +
        elfHead(a) +
        '<path d="M70 62v14q30 12 60 0V62l-30 10z" fill="#2A1C05"/><path d="M48 54L100 36l52 18-52 18z" fill="#2A1C05"/><path d="M100 54l36 10v18" fill="none" stroke="#B8862B" stroke-width="3"/><circle cx="136" cy="84" r="4" fill="#B8862B"/>';
    },
    golden: function (a) {
      return LEGS + PIECES.boots({ fill: "#B8862B" }) + PIECES.coat({ fill: "#D4A53A", dark: GOLD_D }) + sleeves("#D4A53A") + hands(a.skin) +
        star(86, 152, "#FFF4D6", "#B8862B") + elfHead(a) + PIECES.deer({ id: "gold", dark: GOLD_D }) + PIECES.mag({ fill: GOLD });
    },
    nessie: function (a) {
      return '<circle cx="40" cy="206" r="20" fill="#3E8A5A"/><path d="M150 214q22-4 24-24 0-10-8-10" fill="none" stroke="#3E8A5A" stroke-width="14" stroke-linecap="round"/>' +
        '<ellipse cx="100" cy="196" rx="62" ry="40" fill="#3E8A5A"/><ellipse cx="100" cy="204" rx="40" ry="26" fill="#9BCFA9"/>' +
        '<path d="M76 160Q70 116 82 76h36q12 40 6 84z" fill="#3E8A5A"/><circle cx="100" cy="76" r="42" fill="#3E8A5A"/>' +
        '<path d="M80 40l8-16 8 14zM96 34l8-16 8 14zM112 40l8-14 6 16z" fill="#2F6B45"/>' +
        '<circle cx="82" cy="44" r="7" fill="#FFFDFA"/><circle cx="118" cy="44" r="7" fill="#FFFDFA"/><circle cx="83" cy="45" r="3.5" fill="#2B2A33"/><circle cx="119" cy="45" r="3.5" fill="#2B2A33"/>' +
        faceIn(a.skin, 100, 84, 25, 23, "#2F6B45") +
        PIECES.tartan({ id: "blue" }) +
        '<path d="M24 236q10-8 20 0t20 0 20 0 20 0 20 0 20 0 20 0 20 0" fill="none" stroke="' + BLUE + '" stroke-width="4" stroke-linecap="round"/>';
    }
  };

  // ---- drawing: putting it together -------------------------------------------------------

  var BACKDROP = '<circle cx="100" cy="148" r="96" fill="#EAF0E7"/><ellipse cx="100" cy="249" rx="62" ry="6" fill="#DCCFB9"/>';

  function appearance(look) {
    return {
      skin: find(SKIN_TONES, look.skin).hex,
      hair: find(HAIR_COLOURS, look.hair),
      hairStyle: look.hairStyle
    };
  }

  function layer(choice) {
    if (!choice) return "";
    var style = styleOf(choice[0]);
    return PIECES[style.id](colourOf(style, choice[1]));
  }

  // The figure for a look that has already been made safe.
  function figure(look) {
    var a = appearance(look);
    if (look.outfit) return OUTFIT_DRAW[look.outfit](a);
    var p = look.pieces;
    var top = colourOf(styleOf(p.top[0]), p.top[1]);
    // Every slot is drawn through layer(), so anything added to the catalogue is drawn too.
    return LEGS + layer(p.feet) + layer(p.top) + sleeves(top.fill) + hands(a.skin) + layer(p.extra) +
      hairBack(a.hairStyle, a.hair) + ears(a.skin) + head(a.skin) + FACE + layer(p.face) + hairFront(a.hairStyle, a.hair) +
      layer(p.neck) + layer(p.hat) + layer(p.hand);
  }

  function escapeText(value) {
    return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  // A short code made from a drawing, for a drawing that is not given a key of its own. The same
  // drawing always gets the same code, so the same elf is always drawn the same way.
  function codeOf(text) {
    var hash = 0x811c9dc5;
    for (var i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = (hash * 0x01000193) >>> 0;
    }
    return "e" + hash.toString(36);
  }

  // The finished SVG. It carries only the patterns this drawing uses, under ids that end in `key`,
  // so that many drawings can share a page (see PATTERNS above). `label` is plain words.
  function svg(viewBox, width, height, label, inner, key) {
    var own = String(key || "").replace(/[^A-Za-z0-9_-]/g, "") || codeOf(inner);
    var used = [];
    var body = inner.replace(/url\(#(ew-[a-z-]+)\)/g, function (whole, id) {
      if (!PATTERNS[id]) return whole;
      if (used.indexOf(id) < 0) used.push(id);
      return "url(#" + id + "-" + own + ")";
    });
    var defs = "";
    for (var i = 0; i < used.length; i++) {
      var p = PATTERNS[used[i]];
      defs += '<pattern id="' + used[i] + "-" + own + '" width="' + p.w + '" height="' + p.h + '" patternUnits="userSpaceOnUse">' + p.inner + "</pattern>";
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '" viewBox="' + viewBox + '"' +
      (label ? ' role="img" aria-label="' + escapeText(label) + '"' : ' aria-hidden="true"') + ">" +
      (defs ? "<defs>" + defs + "</defs>" : "") + body + "</svg>";
  }

  function sizeOf(value, fallback) {
    var n = typeof value === "number" && isFinite(value) ? Math.round(value) : fallback;
    return n < 16 ? 16 : n > 2000 ? 2000 : n;
  }

  /** The whole elf as an SVG string. `state` is what the detective has unlocked. `opts` is:
   *    size      the width in pixels (the height follows);
   *    backdrop  the pale circle behind the elf, on unless false;
   *    label     the words a screen reader says, such as whose elf it is. They are made safe here.
   *              False for an elf that is decoration. Left out, it says "Elf detective";
   *    key       a short name that is this drawing's alone on the page. Give one whenever several
   *              elves are put into one page as SVG, so that their patterns keep apart. */
  function drawElf(look, state, opts) {
    var o = opts || {};
    var safe = normaliseLook(look, state);
    var width = sizeOf(o.size, 210);
    var label = o.label === false ? "" : typeof o.label === "string" && o.label ? o.label : "Elf detective";
    return svg("0 0 200 260", width, Math.round(width * 1.3), label, (o.backdrop === false ? "" : BACKDROP) + figure(safe), o.key);
  }

  /** One piece on its own, cropped close, for a wardrobe tile. Empty for anything unknown. */
  function drawPiece(styleId, colourId, size) {
    var style = styleOf(styleId);
    var colour = colourOf(style, colourId);
    if (!style || !colour) return "";
    var inner = PIECES[style.id](colour) + (style.slot === "top" ? sleeves(colour.fill) : "");
    var px = sizeOf(size, 40);
    return svg(style.box, px, px, "", inner, style.id + "-" + colour.id);
  }

  /** One outfit on a plain elf, for a wardrobe tile. Empty for anything unknown. */
  function drawOutfit(outfitId, look, size) {
    if (!outfitOf(outfitId)) return "";
    var base = normaliseLook(look, { doorsDone: 0 });
    var px = sizeOf(size, 58);
    return svg("0 0 200 260", px, Math.round(px * 1.3), "", OUTFIT_DRAW[outfitId](appearance(base)), outfitId);
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
  [SKIN_TONES, HAIR_COLOURS, HAIR_STYLES, SLOTS, STYLES, OUTFITS, STARTER, PATTERNS].forEach(freeze);

  var api = {
    DOORS: DOORS,
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
    drawOutfit: drawOutfit
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    window.NBCCElf = api;
  }
})();
