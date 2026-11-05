/* NBCC Elf Detective School: the elf wardrobe.
 *
 * Every detective makes an elf and dresses it up, in paper (design:
 * docs/superpowers/specs/2026-11-04-elf-paper-design.md). This one file holds the whole wardrobe: who
 * the elf can be, the costumes and extras, which door unlocks each costume, and which pictures draw a
 * look. It is shared: the browser loads it as a plain script (window.NBCCElf), and the server loads the
 * very same file (src/elf/wardrobe.ts) to check a look is allowed and to draw an elf for an email, so
 * the two can never disagree.
 *
 * Costumes are whole and hooded, each painted on one elf in every skin, so they always fit. Three are
 * there from the start (door 0). Each door gives two more to every detective who does it: cracks it,
 * or visits its place later. Extras never touch the elf (a scene behind, a friend in front, a frame
 * round the picture) or sit on its face and collar (glasses, bow ties), and are all there from sign up.
 *
 * Nothing typed by anyone reaches a picture: every id is looked up in the lists below and anything
 * unknown or still locked goes back to the start, so a look can never smuggle in markup or wear
 * something it has not unlocked.
 */
(function () {
  "use strict";

  // ---- who the elf is ---------------------------------------------------------------------

  var SKIN_TONES = [
    { id: "s1", hex: "#F6D3B3" },
    { id: "s2", hex: "#E8B48A" },
    { id: "s3", hex: "#C98E5F" },
    { id: "s4", hex: "#9C6644" },
    { id: "s5", hex: "#6B4430" }
  ];

  // `dark` is the edge drawn round a hair swatch. It is chosen to stand out from every skin tone
  // above, because the hair's own colour does not always: brown hair and a brown face are close.
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
  //
  // The names are the ones Jaimie approved on the sheets.

  var COSTUMES = [
    { id: "workshop", name: "Workshop elf", door: 0 },
    { id: "reindeer", name: "Reindeer", door: 0 },
    { id: "snowman", name: "Snowman", door: 0 },
    { id: "advent", name: "Advent calendar", door: 1 },
    { id: "robin", name: "Robin", door: 1 },
    { id: "tree", name: "Christmas tree", door: 2 },
    { id: "polarbear", name: "Polar bear", door: 2 },
    { id: "ginger", name: "Gingerbread", door: 3 },
    { id: "highlandcow", name: "Highland cow", door: 3 },
    { id: "present", name: "Present", door: 4 },
    { id: "arcticfox", name: "Arctic fox", door: 4 },
    { id: "pudding", name: "Christmas pudding", door: 5 },
    { id: "squirrel", name: "Red squirrel", door: 5 },
    { id: "snowglobe", name: "Snow globe", door: 6 },
    { id: "puffin", name: "Puffin", door: 6 },
    { id: "cracker", name: "Christmas cracker", door: 7 },
    { id: "owl", name: "Snowy owl", door: 7 },
    { id: "candycane", name: "Candy cane", door: 8 },
    { id: "haggis", name: "Wee haggis", door: 8 },
    { id: "bauble", name: "Bauble", door: 9 },
    { id: "husky", name: "Husky", door: 9 },
    { id: "stocking", name: "Christmas stocking", door: 10 },
    { id: "unicorn", name: "Unicorn", door: 10 },
    { id: "star", name: "Star", door: 11 },
    { id: "scottie", name: "Scottie dog", door: 11 },
    { id: "snowflake", name: "Snowflake", door: 12 },
    { id: "hedgehog", name: "Hedgehog", door: 12 },
    { id: "nutcracker", name: "Nutcracker soldier", door: 13 },
    { id: "seal", name: "Seal pup", door: 13 },
    { id: "wreath", name: "Wreath", door: 14 },
    { id: "stag", name: "Stag", door: 14 },
    { id: "cocoa", name: "Hot chocolate", door: 15 },
    { id: "otter", name: "Otter", door: 15 },
    { id: "teddy", name: "Teddy bear", door: 16 },
    { id: "thistle", name: "Thistle", door: 16 },
    { id: "sprout", name: "Brussels sprout", door: 17 },
    { id: "pony", name: "Shetland pony", door: 17 },
    { id: "detective", name: "Detective", door: 18 },
    { id: "penguin", name: "Penguin", door: 18 },
    { id: "lights", name: "Christmas lights", door: 19 },
    { id: "sheep", name: "Sheep", door: 19 },
    { id: "yulelog", name: "Yule log", door: 20 },
    { id: "eagle", name: "Golden eagle", door: 20 },
    { id: "postbox", name: "Post box", door: 21 },
    { id: "nessie", name: "Nessie", door: 21 },
    { id: "bell", name: "Jingle bell", door: 22 },
    { id: "mouse", name: "Mouse", door: 22 },
    { id: "mincepie", name: "Mince pie", door: 23 },
    { id: "magnifier", name: "Magnifying glass", door: 23 },
    { id: "graduation", name: "Graduation", door: 24 },
    { id: "santa", name: "Santa suit", door: 24 }
  ];

  // Behind the elf. The village window is the stage every elf starts on.
  var SCENES = [
    { id: "village", name: "Snowy village window" },
    { id: "workshop", name: "Elves' Workshop" },
    { id: "forest", name: "Snowy forest" },
    { id: "loch", name: "Highland loch" },
    { id: "fireside", name: "Cosy fireside" },
    { id: "rooftops", name: "Rooftops at midnight" },
    { id: "ayr", name: "River Ayr" },
    { id: "prestwick", name: "Prestwick beach" },
    { id: "girvan", name: "Girvan harbour" },
    { id: "largs", name: "The Pencil, Largs" },
    { id: "cumnock", name: "Dumfries House, Cumnock" },
    { id: "culzean", name: "Culzean Castle" },
    { id: "alloway", name: "Burns Cottage, Alloway" },
    { id: "troon", name: "Troon harbour" },
    { id: "millport", name: "Crocodile Rock, Millport" },
    { id: "kilmarnock", name: "Dean Castle, Kilmarnock" }
  ];

  // Sitting just in front of the elf, on the plinth.
  var FRIENDS = [
    { id: "robin", name: "Robin" },
    { id: "reindeercalf", name: "Reindeer calf" },
    { id: "penguinchick", name: "Penguin chick" },
    { id: "scottiepuppy", name: "Scottie puppy" },
    { id: "highlandcalf", name: "Highland calf" },
    { id: "snowman", name: "Wee snowman" }
  ];

  // Round the picture, drawn by the page.
  var FRAMES = [
    { id: "candy", name: "Candy cane" },
    { id: "gold", name: "Gold" },
    { id: "holly", name: "Holly" },
    { id: "tartan", name: "Tartan" },
    { id: "starry", name: "Starry" }
  ];

  // Worn with or without a costume.
  var GLASSES = [
    { id: "specs-black", name: "Black glasses" },
    { id: "specs-gold", name: "Gold glasses" },
    { id: "specs-red", name: "Red glasses" },
    { id: "stars-gold", name: "Gold stars" },
    { id: "stars-red", name: "Red stars" },
    { id: "stars-blue", name: "Blue stars" }
  ];

  // Only with no costume: a costume covers the collar.
  var BOWS = [
    { id: "bow-red", name: "Red bow tie" },
    { id: "bow-green", name: "Green bow tie" },
    { id: "bow-gold", name: "Gold bow tie" }
  ];

  // ---- looking things up ------------------------------------------------------------------

  function find(list, id) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i];
    }
    return null;
  }

  function costumeOf(id) {
    return typeof id === "string" ? find(COSTUMES, id) : null;
  }

  /** Can this detective wear this costume? `state` is { doors }: the doors this detective has done,
   *  as whole numbers. A costume from the start always; any other once its own door is done. */
  function costumeUnlocked(costumeId, state) {
    var costume = costumeOf(costumeId);
    if (!costume) return false;
    if (costume.door === 0) return true;
    var doors = state && Array.isArray(state.doors) ? state.doors : [];
    for (var i = 0; i < doors.length; i++) {
      if (doors[i] === costume.door) return true;
    }
    return false;
  }

  // ---- words ------------------------------------------------------------------------------

  // A name keeps its capital wherever it comes in a sentence.
  var NAMES = /^(Christmas|Santa|Highland|Nessie)\b/;

  /** Words as they read in the middle of a sentence: "gold glasses", "Highland calf". */
  function inSentence(words) {
    var text = typeof words === "string" ? words : "";
    return NAMES.test(text) ? text : text.charAt(0).toLowerCase() + text.slice(1);
  }

  // ---- a look -----------------------------------------------------------------------------

  /** What a brand new detective's elf looks like: a sister with red bunches, in no costume, at the
   *  snowy village window. */
  function defaultLook() {
    return { sibling: "sister", skin: "s3", hair: "ginger", hairStyle: "bunches", costume: null, scene: "village", friend: null, frame: null, glasses: null, bow: null };
  }

  // A part of a look, taken only from the look itself, never from anything it inherits.
  function ownPart(look, name) {
    return Object.prototype.hasOwnProperty.call(look, name) ? look[name] : undefined;
  }

  /** A look made safe to keep and to draw: anything unknown, or a costume not yet unlocked, goes back
   *  to the start (no costume, the village window, and no friend, frame, glasses or bow tie). A look
   *  kept from the old layered wardrobe keeps only its sibling, skin and hair. */
  function normaliseLook(look, state) {
    var out = defaultLook();
    var given = look && typeof look === "object" ? look : {};
    // Each part is read ONCE into a variable and only that is checked and kept, so a look that
    // answers differently the second time it is asked cannot slip something past the check.
    var sibling = ownPart(given, "sibling");
    var skin = ownPart(given, "skin");
    var hair = ownPart(given, "hair");
    var hairStyle = ownPart(given, "hairStyle");
    var costume = ownPart(given, "costume");
    var scene = ownPart(given, "scene");
    var friend = ownPart(given, "friend");
    var frame = ownPart(given, "frame");
    var glasses = ownPart(given, "glasses");
    var bow = ownPart(given, "bow");
    if (typeof sibling === "string" && find(SIBLINGS, sibling)) out.sibling = sibling;
    if (typeof skin === "string" && find(SKIN_TONES, skin)) out.skin = skin;
    if (typeof hair === "string" && find(HAIR_COLOURS, hair)) out.hair = hair;
    if (typeof hairStyle === "string" && find(HAIR_STYLES, hairStyle)) out.hairStyle = hairStyle;
    if (typeof costume === "string" && costumeUnlocked(costume, state)) out.costume = costume;
    if (typeof scene === "string" && find(SCENES, scene)) out.scene = scene;
    if (typeof friend === "string" && find(FRIENDS, friend)) out.friend = friend;
    if (typeof frame === "string" && find(FRAMES, frame)) out.frame = frame;
    if (typeof glasses === "string" && find(GLASSES, glasses)) out.glasses = glasses;
    if (typeof bow === "string" && find(BOWS, bow)) out.bow = bow;
    return out;
  }

  /** The pictures a look is drawn from, under assets/img/elf/paper/, in the order they go on the
   *  stage: the scene; the costume in the detective's skin, or the elf with no costume; the glasses,
   *  fitted to the costume's face (no two costumes hold the face in quite the same place); a bow tie,
   *  only with no costume; and a friend. The frame is drawn by the page. The look is made safe first. */
  function lookPictures(look, state) {
    var safe = normaliseLook(look, state);
    return {
      scene: "scenes/" + safe.scene + ".webp",
      body: safe.costume
        ? "costumes/" + safe.costume + "-" + safe.skin + ".webp"
        : "elves/elf-" + safe.sibling + "-" + safe.skin + "-" + safe.hairStyle + "-" + safe.hair + ".webp",
      glasses: safe.glasses ? "pieces/" + safe.glasses + (safe.costume ? "--" + safe.costume : "") + ".webp" : null,
      bow: safe.bow && !safe.costume ? "pieces/" + safe.bow + ".webp" : null,
      friend: safe.friend ? "friends/" + safe.friend + ".webp" : null
    };
  }

  /** A look in words, for anyone who cannot see the picture: "Reindeer costume and gold glasses,
   *  with a robin. River Ayr, in a candy cane frame." Made safe first, so the words match the picture. */
  function lookWords(look, state) {
    var safe = normaliseLook(look, state);
    var costume = costumeOf(safe.costume);
    var glasses = find(GLASSES, safe.glasses);
    var bow = costume ? null : find(BOWS, safe.bow);
    var friend = find(FRIENDS, safe.friend);
    var frame = find(FRAMES, safe.frame);
    var worn = [];
    if (glasses) worn.push(inSentence(glasses.name.replace(/ stars$/, " star glasses")));
    if (bow) worn.push(inSentence(bow.name));
    var who;
    if (costume) {
      // "Santa suit" says what it is already.
      who = / suit$/.test(costume.name) ? costume.name : costume.name + " costume";
      if (worn.length) who += " and " + worn.join(" and ");
    } else {
      who = "No costume" + (worn.length ? ", " + worn.join(" and ") : "");
    }
    if (friend) who += ", with a " + inSentence(friend.name);
    var where = find(SCENES, safe.scene).name + (frame ? ", in a " + inSentence(frame.name) + " frame" : "");
    return who + ". " + where + ".";
  }

  // Nothing that reads the catalogue can change it: a slip that set one door number to nought
  // would hand that costume to everyone.
  function freeze(value) {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
      Object.freeze(value);
      for (var name in value) {
        if (Object.prototype.hasOwnProperty.call(value, name)) freeze(value[name]);
      }
    }
    return value;
  }
  [SIBLINGS, SKIN_TONES, HAIR_COLOURS, HAIR_STYLES, COSTUMES, SCENES, FRIENDS, FRAMES, GLASSES, BOWS].forEach(freeze);

  var api = {
    SIBLINGS: SIBLINGS,
    SKIN_TONES: SKIN_TONES,
    HAIR_COLOURS: HAIR_COLOURS,
    HAIR_STYLES: HAIR_STYLES,
    COSTUMES: COSTUMES,
    SCENES: SCENES,
    FRIENDS: FRIENDS,
    FRAMES: FRAMES,
    GLASSES: GLASSES,
    BOWS: BOWS,
    costumeUnlocked: costumeUnlocked,
    inSentence: inSentence,
    defaultLook: defaultLook,
    normaliseLook: normaliseLook,
    lookPictures: lookPictures,
    lookWords: lookWords
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    window.NBCCElf = api;
  }
})();
