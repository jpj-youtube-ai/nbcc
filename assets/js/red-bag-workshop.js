// Fill a Red Bag: the Elves' Workshop, the little scene at the top of the thank you page
// (/fill/thank-you, fill-thank-you.html; docs/superpowers/specs/2026-10-04-fill-a-red-bag-design.md).
//
// "Watch it leave the Workshop" (Jaimie, 5 October 2026): an elf lifts the tied bag onto the shelf
// beside the others, the Workshop light goes down, and the line under it reads "Bag packed. The
// elves will take it from here." One drawing, made here and coloured by the page's own stylesheet
// (assets/css/red-bag-thanks.css): a wooden shelf with tied red bags on it, a hanging lamp, the
// donor's bag with its gold ribbon and "Packed with love" tag, and a small elf seen from behind.
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

  // The picture's size, and where things are in it.
  var W = 320;
  var H = 264;
  var SHELF_Y = 158; // the top of the plank: the bags stand on it
  var SHELF_LEFT = 24;
  var SHELF_WIDTH = W - 2 * SHELF_LEFT;
  var LAMP_X = W / 2;
  // A bag as drawn is 120 wide and stands on y = 128 (the page's own bag, src/red-bag/render.ts).
  var BAG_W = 120;
  var BAG_FOOT = 128;
  var MAX_YOURS = 5; // the donor's bags on the shelf, at most
  var OTHERS = 2; // the bags already there: one at each end
  var TAG_LINES = ["Packed", "with love"]; // as on a full bag on the giving page

  /** How many of the donor's bags to draw: a whole number from one to five. */
  function shown(count) {
    var n = Number(count);
    if (!isFinite(n) || Math.floor(n) !== n || n < 1) return 1;
    return Math.min(MAX_YOURS, n);
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

  function num(n) {
    return String(Math.round(n * 100) / 100);
  }

  /** Where the bags stand: `slots` of them in a row on the shelf, each `scale` of full size. */
  function row(yours) {
    var slots = yours + OTHERS;
    var gap = yours >= 3 ? 6 : 10;
    var scale = Math.min(0.66, (SHELF_WIDTH - 8 - (slots - 1) * gap) / (slots * BAG_W));
    var width = slots * BAG_W * scale + (slots - 1) * gap;
    var left = (W - width) / 2;
    var at = [];
    for (var i = 0; i < slots; i += 1) at.push(left + i * (BAG_W * scale + gap));
    return { scale: scale, at: at, y: SHELF_Y - BAG_FOOT * scale };
  }

  function bagOnShelf(x, r, cls, opts) {
    return '<g class="rbw-bag ' + cls + '" transform="translate(' + num(x) + " " + num(r.y) + ") scale(" + num(r.scale) + ')">' + tiedBag(opts) + "</g>";
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
      '<path class="rbw-sleeve rbw-sleeve--edge" d="M-16 72L-' + hx + ' -12M16 72L' + hx + ' -12"/>' +
      '<path class="rbw-sleeve" d="M-16 72L-' + hx + ' -12M16 72L' + hx + ' -12"/>' +
      '<circle class="rbw-mitt" cx="-' + hx + '" cy="-14" r="6"/><circle class="rbw-mitt" cx="' + hx + '" cy="-14" r="6"/>' +
      "</g></g>"
    );
  }

  /**
   * The whole scene as one inline picture. `count` is how many bags the donor filled (one to five
   * are drawn). Drawn AT REST: the bags on the shelf, the elf stepped down. The stylesheet plays it
   * from the start while the page says so (.is-playing), and dims the lamp.
   */
  function scene(count) {
    var yours = shown(count);
    var r = row(yours);
    var last = yours; // the place of the bag the elf lifts: the last of the donor's
    var words = r.scale >= 0.45; // the tag's words, while the bags are big enough to read them
    var bags = bagOnShelf(r.at[0], r, "rbw-bag--other", { tag: false });
    for (var i = 1; i < last; i += 1) bags += bagOnShelf(r.at[i], r, "rbw-bag--yours", { words: words });
    bags += bagOnShelf(r.at[yours + 1], r, "rbw-bag--other", { tag: false });
    var liftX = r.at[last] + (BAG_W * r.scale) / 2;
    var reach = Math.max(11, (BAG_W * r.scale) / 2 - 5);
    return (
      '<svg class="rbw" viewBox="0 0 ' + W + " " + H + '" aria-hidden="true" focusable="false" data-rbw-count="' + yours + '">' +
      '<rect class="rbw-wall" x="0" y="0" width="' + W + '" height="' + H + '"/>' +
      // the lamp's light on the wall: the wide pool goes when the light is turned down
      '<g class="rbw-light"><circle class="rbw-pool rbw-pool--wide" cx="' + LAMP_X + '" cy="66" r="150"/><circle class="rbw-pool rbw-pool--mid" cx="' + LAMP_X + '" cy="60" r="96"/></g>' +
      // the shelf: two wooden brackets and a plank
      '<g class="rbw-shelf"><path class="rbw-bracket" d="M54 ' + (SHELF_Y + 8) + "h16c0 9-6 15-16 17zM266 " + (SHELF_Y + 8) + 'h-16c0 9 6 15 16 17z"/>' +
      '<rect class="rbw-plank" x="' + SHELF_LEFT + '" y="' + SHELF_Y + '" width="' + SHELF_WIDTH + '" height="9" rx="2"/>' +
      '<path class="rbw-grain" d="M40 ' + (SHELF_Y + 4.5) + "h46M118 " + (SHELF_Y + 4.5) + "h70M214 " + (SHELF_Y + 4.5) + 'h52"/></g>' +
      bags +
      // the bag being lifted into its place, and the elf lifting it
      '<g class="rbw-lift">' + bagOnShelf(r.at[last], r, "rbw-bag--yours rbw-bag--lifted", { words: words }) + "</g>" +
      '<g transform="translate(' + num(liftX) + " " + SHELF_Y + ')">' + elf(reach) + "</g>" +
      // dusk, over everything but the lamp
      '<rect class="rbw-dusk" x="0" y="0" width="' + W + '" height="' + H + '"/>' +
      '<g class="rbw-lamp"><circle class="rbw-pool rbw-pool--near" cx="' + LAMP_X + '" cy="48" r="25"/>' +
      '<path class="rbw-flex" d="M' + LAMP_X + " 0v24" + '"/>' +
      '<circle class="rbw-bulb" cx="' + LAMP_X + '" cy="47" r="6.5"/><circle class="rbw-bulb rbw-bulb--lit" cx="' + LAMP_X + '" cy="47" r="6.5"/>' +
      '<path class="rbw-shade" d="M' + (LAMP_X - 13) + " 23h26l11 23h-48z" + '"/>' +
      '<g class="rbw-pull"><path class="rbw-flex" d="M' + (LAMP_X + 17) + " 46v20" + '"/><circle class="rbw-bead" cx="' + (LAMP_X + 17) + '" cy="68.5" r="2.6"/></g></g>' +
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
   * show it at rest. Returns true once the scene is in the page.
   */
  function mount(box, opts) {
    var o = opts || {};
    var holder = box ? box.querySelector("[data-rb-workshop-scene]") : null;
    if (!holder) return false;
    holder.innerHTML = scene(o.count);
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
