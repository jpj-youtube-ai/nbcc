// Fill a Red Bag: the Elves' Workshop, the scene at the top of the thank you page
// (/fill/thank-you, fill-thank-you.html; docs/superpowers/specs/2026-10-04-fill-a-red-bag-design.md).
//
// "Watch it leave the Workshop" (Jaimie, 5 October 2026): an elf lifts the tied bag onto the shelf
// beside the others, the Workshop light goes down, and the line under it reads "Bag packed. The
// elves will take it from here." One drawing, made here and coloured by the page's own stylesheet
// (assets/css/red-bag-thanks.css). The Workshop the night before, well stocked: shelves of tied Red
// Bags and gifts (a teddy, books, a folded blanket, wrapped presents, a toy train), a window with
// snow falling outside, a Christmas tree with fairy lights that stay lit when the lamp goes down,
// a hanging lamp, the donor's bag with its gold ribbon and "Packed with love" tag, and a small elf
// seen from behind. No clock.
//
// For the eye only: hidden from screen readers, takes no tap and no focus, and says nothing the
// page does not say in words. It plays ONCE, with transform and opacity only, then rests; someone
// who asked for less motion is shown it at rest straight away. It never says the things were
// bought or who a bag is for: it is a bag on a shelf.
//
// Its own small file, loaded by the thank you page alone. The page's script
// (assets/js/red-bag-thanks.js) calls mount() behind a guard, so if this file is missing, old or
// broken the still bag simply stays. A classic <script defer>, exported under a CommonJS guard so it
// can be unit tested in jsdom.
(function (root) {
  "use strict";

  // The picture's size (16 to 10), and where things are in it.
  var W = 400;
  var H = 250;
  var SHELF_LEFT = 100; // the two long shelves, between the window and the tree
  var SHELF_WIDTH = 212;
  var TOP_SHELF_Y = 66; // gifts and two tied bags
  var SHELF_Y = 150; // the reaching shelf: the donor's bags stand here
  var SIDE_SHELF_Y = 172; // a short one under the window
  var LAMP_X = SHELF_LEFT + SHELF_WIDTH / 2;
  var TREE_X = 356;
  // A bag as drawn is 120 wide and stands on y = 128 (the page's own bag, src/red-bag/render.ts).
  var BAG_W = 120;
  var BAG_FOOT = 128;
  var MAX_YOURS = 5; // the donor's bags on the shelf, at most
  var TAG_LINES = ["Packed", "with love"]; // as on a full bag on the giving page

  /** How many of the donor's bags to draw: a whole number from one to five. */
  function shown(count) {
    var n = Number(count);
    if (!isFinite(n) || Math.floor(n) !== n || n < 1) return 1;
    return Math.min(MAX_YOURS, n);
  }

  function num(n) {
    return String(Math.round(n * 100) / 100);
  }

  /**
   * One tied Red Bag, as the inside of a 120 by 132 picture: the red paper bag with its cord
   * handles and a gold bow. `tag` adds the gift tag; `words` writes "Packed with love" on it.
   */
  function tiedBag(opts) {
    var o = opts || {};
    var tag = "";
    if (o.tag !== false) {
      tag =
        '<g class="rbw-tag"><path class="rbw-string" d="M60 20c-3 9 3 21 0 31"/>' +
        '<path class="rbw-card" d="M41 44h38l11 11v35a4 4 0 0 1-4 4H34a4 4 0 0 1-4-4V55z"/>' +
        '<circle class="rbw-hole" cx="60" cy="51.5" r="2.6"/>' +
        (o.words !== false ? '<text class="rbw-words"><tspan x="60" y="73">' + TAG_LINES[0] + '</tspan> <tspan x="60" y="88">' + TAG_LINES[1] + "</tspan></text>" : "") +
        "</g>";
    }
    return (
      '<path class="rbw-cord rbw-cord--back" d="M44 36C44 10 88 10 88 36"/>' +
      '<path class="rbw-tissue" d="M22 38l9-13 8 9 9-14 9 13 9-12 8 11 9-9 7 15z"/>' +
      '<path class="rbw-paper" d="M12 36h96v88a4 4 0 0 1-4 4H16a4 4 0 0 1-4-4z"/>' +
      '<path class="rbw-gusset" d="M92 36h16v88a4 4 0 0 1-4 4H92z"/>' +
      '<path class="rbw-fold" d="M12 36h96v10H12z"/>' +
      '<path class="rbw-crease" d="M12 46h96M92 46v82"/>' +
      '<path class="rbw-cord" d="M32 40C32 12 76 12 76 40"/>' +
      '<circle class="rbw-eyelet" cx="32" cy="41" r="2.2"/><circle class="rbw-eyelet" cx="76" cy="41" r="2.2"/>' +
      tag +
      '<g class="rbw-bow"><path class="rbw-ribbon" d="M57.5 20l-8 12 5.5-.5 2 4.5 3.5-15zM62.5 20l8 12-5.5-.5-2 4.5-3.5-15z"/>' +
      '<path class="rbw-ribbon" d="M60 18c-5-8-17-9-17-1s12 6 17 1zM60 18c5-8 17-9 17-1s-12 6-17 1z"/>' +
      '<rect class="rbw-knot" x="56" y="14" width="8" height="8" rx="2.5"/></g>'
    );
  }

  /** A tied bag as a picture of its own (the certificate's), for the eye only. */
  function bagPicture() {
    return '<svg class="rbw rbw--bag" viewBox="0 0 120 132" aria-hidden="true" focusable="false">' + tiedBag({ words: true }) + "</svg>";
  }

  /** A tied bag standing on a shelf: its left edge at `x`, its foot at `y`, `scale` of full size. */
  function bagAt(x, y, scale, cls, opts) {
    return '<g class="rbw-bag ' + cls + '" transform="translate(' + num(x) + " " + num(y - BAG_FOOT * scale) + ") scale(" + num(scale) + ')">' + tiedBag(opts) + "</g>";
  }

  // --- the things on the shelves: simple shapes, in the catalogue drawings' hand -------------------

  /** A wooden shelf: a plank on two brackets. */
  function shelf(x, y, w) {
    var a = x + 16;
    var b = x + w - 16;
    return (
      '<g class="rbw-shelf"><path class="rbw-bracket" d="M' + a + " " + (y + 7) + "h13c0 8-5 13-13 15zM" + b + " " + (y + 7) + 'h-13c0 8 5 13 13 15z"/>' +
      '<rect class="rbw-plank" x="' + x + '" y="' + y + '" width="' + w + '" height="8" rx="2"/>' +
      '<path class="rbw-grain rbw-extra" d="M' + (x + 14) + " " + (y + 4) + "h" + num(w * 0.2) + "M" + num(x + w * 0.44) + " " + (y + 4) + "h" + num(w * 0.3) + '"/></g>'
    );
  }

  /** A wrapped present with a ribbon and a bow, standing on `base`. `kind` picks its paper. */
  function present(x, base, w, h, kind, extra) {
    var top = base - h;
    var cx = x + w / 2;
    return (
      '<g class="rbw-present rbw-present--' + kind + (extra ? " rbw-extra" : "") + '">' +
      '<rect class="rbw-box" x="' + num(x) + '" y="' + num(top) + '" width="' + num(w) + '" height="' + num(h) + '" rx="1.5"/>' +
      '<path class="rbw-band" d="M' + num(cx - 2.2) + " " + num(top) + "h4.4v" + num(h) + 'h-4.4z"/>' +
      '<path class="rbw-loop" d="M' + num(cx) + " " + num(top) + "c-2.5-5.5-9-5.5-8-1 .8 3 5.5 2 8 1zM" + num(cx) + " " + num(top) + 'c2.5-5.5 9-5.5 8-1-.8 3-5.5 2-8 1z"/>' +
      "</g>"
    );
  }

  /** Three books lying in a stack. */
  function books(x, base) {
    return (
      '<g class="rbw-books">' +
      '<rect class="rbw-book rbw-book--a" x="' + x + '" y="' + (base - 6) + '" width="32" height="6" rx="1"/>' +
      '<rect class="rbw-book rbw-book--b" x="' + (x + 3) + '" y="' + (base - 12) + '" width="27" height="6" rx="1"/>' +
      '<rect class="rbw-book rbw-book--c" x="' + (x + 1) + '" y="' + (base - 18) + '" width="29" height="6" rx="1"/>' +
      '<path class="rbw-page" d="M' + (x + 5) + " " + (base - 3) + "h9M" + (x + 7) + " " + (base - 9) + "h7M" + (x + 6) + " " + (base - 15) + 'h8"/>' +
      "</g>"
    );
  }

  /** A folded blanket: two soft folds with a stripe. */
  function blanket(x, base, extra) {
    return (
      '<g class="rbw-blanket' + (extra ? " rbw-extra" : "") + '">' +
      '<rect class="rbw-fold-a" x="' + x + '" y="' + (base - 7) + '" width="30" height="7" rx="3.5"/>' +
      '<rect class="rbw-fold-a" x="' + (x + 1) + '" y="' + (base - 14) + '" width="28" height="7" rx="3.5"/>' +
      '<path class="rbw-stripe" d="M' + (x + 8) + " " + (base - 13) + "v5.500M" + (x + 21) + " " + (base - 13) + "v5.500M" + (x + 8) + " " + (base - 6) + "v5M" + (x + 21) + " " + (base - 6) + 'v5"/>' +
      "</g>"
    );
  }

  /**
   * One of the catalogue's own drawings (assets/js/red-bag-catalogue.js, art()), placed in the
   * scene; "" when the catalogue is not there to lend it, so the caller draws something else.
   */
  function borrowed(art, key, x, y, size) {
    if (typeof art !== "function") return "";
    var markup = "";
    try {
      markup = art(key, "", size);
    } catch (e) {
      markup = "";
    }
    if (typeof markup !== "string" || markup.indexOf("<svg ") !== 0) return "";
    return markup.replace("<svg ", '<svg x="' + num(x) + '" y="' + num(y) + '" ');
  }

  /** A five pointed star about (cx, cy). */
  function starPath(cx, cy, outer, inner) {
    var d = "";
    for (var i = 0; i < 10; i += 1) {
      var r = i % 2 === 0 ? outer : inner;
      var a = (Math.PI / 5) * i - Math.PI / 2;
      d += (i === 0 ? "M" : "L") + num(cx + r * Math.cos(a)) + " " + num(cy + r * Math.sin(a));
    }
    return d + "Z";
  }

  // The window's pane: the night outside, a few stars, snow that drifts down once and settles.
  var PANE = { x: 26, y: 32, w: 62, h: 74 };
  var STARS = [[38, 44], [75, 41], [63, 57], [45, 68], [81, 72]];
  // Where each flake comes to rest, its size, and which of three drifts it takes.
  var FLAKES = [[34, 86, 2, "a"], [48, 76, 1.6, "b"], [58, 93, 2.2, "c"], [70, 82, 1.7, "a"], [80, 95, 2, "b"], [42, 60, 1.5, "c"], [66, 64, 1.9, "a"], [77, 55, 1.5, "b"], [53, 48, 1.6, "c"]];
  function windowOnTheWall() {
    var stars = "";
    var i;
    for (i = 0; i < STARS.length; i += 1) stars += '<circle class="rbw-star' + (i > 2 ? " rbw-extra" : "") + '" cx="' + STARS[i][0] + '" cy="' + STARS[i][1] + '" r="1.1"/>';
    var flakes = "";
    for (i = 0; i < FLAKES.length; i += 1) flakes += '<circle class="rbw-flake rbw-flake--' + FLAKES[i][3] + '" cx="' + FLAKES[i][0] + '" cy="' + FLAKES[i][1] + '" r="' + FLAKES[i][2] + '"/>';
    return (
      '<g class="rbw-window">' +
      '<clipPath id="rbw-pane"><rect x="' + PANE.x + '" y="' + PANE.y + '" width="' + PANE.w + '" height="' + PANE.h + '"/></clipPath>' +
      '<rect class="rbw-frame" x="' + (PANE.x - 6) + '" y="' + (PANE.y - 6) + '" width="' + (PANE.w + 12) + '" height="' + (PANE.h + 12) + '" rx="3"/>' +
      '<rect class="rbw-night" x="' + PANE.x + '" y="' + PANE.y + '" width="' + PANE.w + '" height="' + PANE.h + '"/>' +
      '<g clip-path="url(#rbw-pane)">' + stars + flakes +
      // snow lying along the bottom of the pane
      '<path class="rbw-drift" d="M26 108v-7q7-5 14-2 8-5 16-1 9-5 16-1 8-3 16 1v10z"/></g>' +
      '<path class="rbw-bar" d="M' + (PANE.x + PANE.w / 2) + " " + PANE.y + "v" + PANE.h + "M" + PANE.x + " " + (PANE.y + 34) + "h" + PANE.w + '"/>' +
      '<rect class="rbw-sill" x="16" y="' + (PANE.y + PANE.h + 4) + '" width="82" height="6" rx="2"/>' +
      "</g>"
    );
  }

  // The fairy lights, strung along three swags; each has a soft glow that stays when the lamp dims.
  var FAIRIES = [[345, 110, "a"], [357, 113, "b"], [368, 108, "c"], [335, 154, "b"], [349, 159, "c"], [365, 158, "a"], [378, 151, "b"], [329, 198, "c"], [345, 204, "a"], [364, 203, "b"], [381, 196, "a"]];
  function tree() {
    return (
      '<g class="rbw-tree">' +
      '<rect class="rbw-trunk" x="' + (TREE_X - 5) + '" y="202" width="10" height="20"/>' +
      '<path class="rbw-pot" d="M' + (TREE_X - 14) + ' 220h28l-3 24h-22z"/>' +
      '<path class="rbw-fir" d="M' + TREE_X + " 128L" + (TREE_X - 38) + " 206H" + (TREE_X + 38) + 'Z"/>' +
      '<path class="rbw-fir" d="M' + TREE_X + " 96L" + (TREE_X - 30) + " 162H" + (TREE_X + 30) + 'Z"/>' +
      '<path class="rbw-fir" d="M' + TREE_X + " 64L" + (TREE_X - 20) + " 118H" + (TREE_X + 20) + 'Z"/>' +
      '<path class="rbw-garland rbw-extra" d="M341 107q15 10 31-3M331 151q24 13 50-5M324 195q31 14 64-6"/>' +
      '<path class="rbw-topper" d="' + starPath(TREE_X, 60, 8.5, 3.6) + '"/>' +
      "</g>"
    );
  }
  function fairyLights() {
    var out = '<g class="rbw-fairies">';
    for (var i = 0; i < FAIRIES.length; i += 1) {
      out +=
        '<circle class="rbw-fairy-glow" cx="' + FAIRIES[i][0] + '" cy="' + FAIRIES[i][1] + '" r="5.5"/>' +
        '<circle class="rbw-fairy rbw-fairy--' + FAIRIES[i][2] + '" cx="' + FAIRIES[i][0] + '" cy="' + FAIRIES[i][1] + '" r="2.3"/>';
    }
    return out + "</g>";
  }

  /**
   * The reaching shelf's row. The donor's bags stand side by side; with one or two there is a bag
   * of someone else's at each end, with three one at the left, and four or five fill the shelf
   * themselves (the others are on the shelf above). The middle one of the donor's is lifted in.
   */
  function row(yours) {
    var before = yours <= 3 ? 1 : 0;
    var after = yours <= 2 ? 1 : 0;
    var slots = before + yours + after;
    var gap = 8;
    var scale = Math.min(0.52, (SHELF_WIDTH - 8 - (slots - 1) * gap) / (slots * BAG_W));
    var width = slots * BAG_W * scale + (slots - 1) * gap;
    var left = SHELF_LEFT + (SHELF_WIDTH - width) / 2;
    var at = [];
    for (var i = 0; i < slots; i += 1) at.push(left + i * (BAG_W * scale + gap));
    return { scale: scale, at: at, before: before, after: after };
  }

  /**
   * The elf, seen from behind, drawn about the middle of the bag it lifts (x = 0) with the shelf's
   * top at y = 0: a pointed red hat with a bobble, the back of a head with two pointed ears, a green
   * tunic, and two arms up to the sides of the bag. In the stylesheet the body and the arms move
   * apart: the arms come down, and the elf steps back down until only the hat shows.
   */
  function elf(reach) {
    var hx = num(reach);
    return (
      '<g class="rbw-elf">' +
      '<g class="rbw-elf__body">' +
      // the tunic, running off the bottom of the picture
      '<path class="rbw-tunic" d="M-25 150c0-48 8-88 25-88s25 40 25 88z"/>' +
      '<path class="rbw-collar" d="M-13 66l4.5 6 4.3-6 4.2 6 4.2-6 4.3 6 4.5-6"/>' +
      // the ears, then the back of the head
      '<path class="rbw-skin" d="M-11 46l-11-7 5 13zM11 46l11-7-5 13z"/>' +
      '<circle class="rbw-skin" cx="0" cy="51" r="13.5"/>' +
      // the hat: a soft cone that leans, its brim and its bobble
      '<path class="rbw-hat" d="M-15.5 43C-10 26-2 15 10 8c3 12 5 23 5.5 35z"/>' +
      '<rect class="rbw-brim" x="-17.5" y="39.5" width="35" height="8" rx="4"/>' +
      '<circle class="rbw-bobble" cx="10.5" cy="7.5" r="4.2"/>' +
      "</g>" +
      '<g class="rbw-elf__arms">' +
      '<path class="rbw-sleeve rbw-sleeve--edge" d="M-16 72L-' + hx + " -12M16 72L" + hx + ' -12"/>' +
      '<path class="rbw-sleeve" d="M-16 72L-' + hx + " -12M16 72L" + hx + ' -12"/>' +
      '<circle class="rbw-mitt" cx="-' + hx + '" cy="-14" r="6"/><circle class="rbw-mitt" cx="' + hx + '" cy="-14" r="6"/>' +
      "</g></g>"
    );
  }

  /**
   * The whole scene as one inline picture. `count` is how many bags the donor filled (one to five
   * are drawn). `art` is the catalogue's art(), where it is there to lend the teddy and the toy
   * train; without it a present stands in each one's place. Drawn AT REST: the bags on the shelf,
   * the elf stepped down, the snow settled. The stylesheet plays it from the start while the page
   * says so (.is-playing), and dims the lamp.
   */
  function scene(count, art) {
    var yours = shown(count);
    var r = row(yours);
    var words = r.scale >= 0.45; // the tag's words, while the bags are big enough to read them
    var end = r.before + yours; // one past the donor's bags
    // The place of the bag the elf lifts: the middle one of the donor's, so the elf stands clear of
    // the window and the tree however many there are.
    var last = r.before + Math.floor(yours / 2);
    var bags = "";
    var i;
    if (r.before) bags += bagAt(r.at[0], SHELF_Y, r.scale, "rbw-bag--other", { tag: false });
    for (i = r.before; i < end; i += 1) if (i !== last) bags += bagAt(r.at[i], SHELF_Y, r.scale, "rbw-bag--yours", { words: words });
    if (r.after) bags += bagAt(r.at[end], SHELF_Y, r.scale, "rbw-bag--other", { tag: false });
    var liftX = r.at[last] + (BAG_W * r.scale) / 2;
    var reach = Math.max(11, (BAG_W * r.scale) / 2 - 5);

    // The top shelf: two tied bags at the ends, and between them a teddy, books, a blanket, a present.
    var top = TOP_SHELF_Y;
    var topShelf =
      shelf(SHELF_LEFT, top, SHELF_WIDTH) +
      bagAt(SHELF_LEFT + 6, top, 0.3, "rbw-bag--other", { tag: false }) +
      (borrowed(art, "soft-toy", 147, top - 30.5, 30) || present(150, top, 24, 21, "gold")) +
      books(188, top) +
      blanket(226, top, true) +
      present(259, top, 15, 18, "holly", true) +
      bagAt(SHELF_LEFT + SHELF_WIDTH - 36, top, 0.3, "rbw-bag--other", { tag: false });

    // The short shelf under the window: a present and the toy train.
    var sideShelf = shelf(14, SIDE_SHELF_Y, 84) + present(21, SIDE_SHELF_Y, 22, 19, "cream") + (borrowed(art, "toy", 54, SIDE_SHELF_Y - 30.5, 30) || present(58, SIDE_SHELF_Y, 26, 15, "crimson"));

    return (
      '<svg class="rbw" viewBox="0 0 ' + W + " " + H + '" aria-hidden="true" focusable="false" data-rbw-count="' + yours + '">' +
      '<rect class="rbw-wall" x="0" y="0" width="' + W + '" height="' + H + '"/>' +
      // the lamp's light on the wall: the wide pool goes when the light is turned down
      '<g class="rbw-light"><circle class="rbw-pool rbw-pool--wide" cx="' + LAMP_X + '" cy="56" r="176"/><circle class="rbw-pool rbw-pool--mid" cx="' + LAMP_X + '" cy="50" r="108"/></g>' +
      windowOnTheWall() +
      tree() +
      topShelf +
      sideShelf +
      // presents at the foot of the tree
      present(TREE_X - 40, 246, 22, 17, "cream") +
      present(TREE_X + 18, 246, 20, 21, "gold", true) +
      // the reaching shelf and its bags
      shelf(SHELF_LEFT, SHELF_Y, SHELF_WIDTH) +
      bags +
      // the bag being lifted into its place, and the elf lifting it
      '<g class="rbw-lift">' + bagAt(r.at[last], SHELF_Y, r.scale, "rbw-bag--yours rbw-bag--lifted", { words: words }) + "</g>" +
      '<g transform="translate(' + num(liftX) + " " + SHELF_Y + ')">' + elf(reach) + "</g>" +
      // dusk, over the room but not the window's pane: the night outside does not dim
      '<path class="rbw-dusk" fill-rule="evenodd" d="M0 0H' + W + "V" + H + "H0ZM" + PANE.x + " " + PANE.y + "H" + (PANE.x + PANE.w) + "V" + (PANE.y + PANE.h) + "H" + PANE.x + 'Z"/>' +
      // and not the fairy lights or the lamp
      fairyLights() +
      '<g class="rbw-lamp"><circle class="rbw-pool rbw-pool--near" cx="' + LAMP_X + '" cy="28" r="16"/>' +
      '<path class="rbw-flex" d="M' + LAMP_X + ' 0v11"/>' +
      '<circle class="rbw-bulb" cx="' + LAMP_X + '" cy="29" r="5.5"/><circle class="rbw-bulb rbw-bulb--lit" cx="' + LAMP_X + '" cy="29" r="5.5"/>' +
      '<path class="rbw-shade" d="M' + (LAMP_X - 12) + ' 10h24l10 19h-44z"/>' +
      '<g class="rbw-pull"><path class="rbw-flex" d="M' + (LAMP_X + 16) + ' 29v15"/><circle class="rbw-bead" cx="' + (LAMP_X + 16) + '" cy="46.5" r="2.4"/></g></g>' +
      "</svg>"
    );
  }

  /** Has this person asked for less motion? Yes, too, where the browser cannot say. */
  function lessMotion(win) {
    try {
      return !win || typeof win.matchMedia !== "function" || !!win.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch (e) {
      return true;
    }
  }

  // Longer than the scene (assets/css/red-bag-thanks.css runs about four seconds): where the
  // browser never says the last animation ended, the scene is put to rest by the clock.
  var REST_AFTER_MS = 5200;

  /**
   * Draw the scene into the page, in place of the still bag. `box` is the page's [data-rb-workshop];
   * `opts.count` the donor's bags; `opts.play` true on arrival after a gift (it plays once), false to
   * show it at rest; `opts.art` the catalogue's art(), if it is there. Returns true once the scene
   * is in the page.
   */
  function mount(box, opts) {
    var o = opts || {};
    var holder = box ? box.querySelector("[data-rb-workshop-scene]") : null;
    if (!holder) return false;
    holder.innerHTML = scene(o.count, o.art);
    holder.hidden = false;
    var still = box.querySelector(".rb-thanks__bag");
    if (still) still.hidden = true;

    var rested = false;
    function rest() {
      if (rested) return;
      rested = true;
      box.classList.remove("is-playing");
      box.classList.add("is-rested");
    }
    var win = o.win;
    if (!o.play || lessMotion(win)) {
      rest();
      return true;
    }
    box.classList.add("is-playing");
    // The line's fade is the last thing to finish.
    var line = box.querySelector("[data-rb-workshop-line]");
    if (line) {
      line.addEventListener("animationend", function (e) {
        if (e.target === line) rest();
      });
    }
    if (win && typeof win.setTimeout === "function") win.setTimeout(rest, REST_AFTER_MS);
    else if (!line) rest();
    return true;
  }

  var api = { scene: scene, tiedBag: tiedBag, bagPicture: bagPicture, mount: mount, shown: shown };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.NBCCRedBagWorkshop = api;
})(typeof window !== "undefined" ? window : this);
