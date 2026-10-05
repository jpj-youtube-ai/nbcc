// Fill a Red Bag, /fill (docs/superpowers/specs/2026-10-04-fill-a-red-bag-design.md).
//
// The page is drawn by the server and its list reads fine without this file. This makes it work:
//   - the steppers on the paper (minus, a number box you can type in, plus; 0 to 99) and the
//     examples under "Whenever the need comes" (tap to add, tap again or Remove to take out), all
//     adding up to ONE running total;
//   - the round-up: one button by the total offering the NEXT milestone only (half a bag, a full
//     bag, then the next whole bag). Pressed, it adds "A little extra to round up" under "Also in
//     your bag". It keeps its TARGET, so the extra shrinks and grows as the bag changes and the
//     total stays put. Emptying the bag clears it: a round-up never stands alone. Simply extra
//     money: it buys nothing;
//   - once or monthly: two buttons, "Give once" and "Give monthly", as on the donate page;
//   - the bags, the status line and the total, kept in step. The sums and the words come from the
//     one catalogue (assets/js/red-bag-catalogue.js, window.NBCCRedBag), never from here;
//   - Donate: under £2 it shows the friendly nudge; from £2 it opens the details step, the same asks
//     as the give form on a fundraiser's page (assets/js/fundraiser.js), then the donate page's
//     checkout: POST /api/checkout-session with the donate page's body plus redBag: true. Stripe
//     opens on the page when it can and on Stripe's own page when it cannot;
//   - before leaving for Stripe, it leaves the total in this tab's memory for the thank you, which
//     is a page of its own: /fill/thank-you (assets/js/red-bag-thanks.js). For show only; the
//     server never trusts it.
//
// Only the total is ever sent: no list of items leaves the page, because the items are examples of
// what a donation could do, not things being bought.
//
// Its own file rather than main.js, which counts towards donate.html's page weight budget. It uses
// main.js's shared field highlighting (window.NBCCFormValidation) when it is there. A classic
// <script defer>, exported under a CommonJS guard so it can be unit tested in jsdom.
(function () {
  "use strict";

  // The card fee shown beside the offer, as the donate page shows it (main.js). The server works out
  // the real figure from the rate it holds; this is only the words.
  var CARD_FEE_BP = 120;
  var CARD_FEE_FIXED_PENCE = 20;

  // What this tab remembers across the trip to Stripe, for the thank you page: the total, and
  // whether Gift Aid and monthly were chosen. Display only. (assets/js/red-bag-thanks.js reads it.)
  var GIFT_KEY = "nbcc_red_bag_gift";
  // The admin's session, kept by admin.html for the tab. Read ONLY on a staff preview.
  var ADMIN_TOKEN_KEY = "nbcc_admin_token";

  var MSG = {
    check: "Please check the highlighted answers below and try again.",
    opening: "Opening secure payment…",
    refused: "Something in the form needs another look. Please check it and try again.",
    // Only ever met by staff: while the page is switched off the checkout takes a Red Bag donation
    // from a signed in member of staff alone, and says this when their session has run out.
    notOpen: "Fill a Red Bag is not open yet. If you are staff, please sign in again at /admin, then come back to this page.",
    down: "Payment is not working just now. Please try again in a few minutes, or give on our donate page.",
    // Only ever met by staff, on the draft preview of the list (src/red-bag/render.ts says the same).
    draftOff: "This is a preview. Giving is switched off here.",
  };

  function each(list, fn) {
    Array.prototype.forEach.call(list, fn);
  }

  function setText(el, words) {
    // Written only when the words change, so a live region is heard once for each new line.
    if (el && el.textContent !== words) el.textContent = words;
  }

  function focusOn(el) {
    if (!el) return;
    try {
      el.focus({ preventScroll: false });
    } catch (e) {
      /* focus unavailable */
    }
  }

  function storage(win) {
    try {
      return win.sessionStorage || null;
    } catch (e) {
      return null;
    }
  }

  function initRedBag(doc, win, nav) {
    var rb = win && win.NBCCRedBag;
    var builder = doc.querySelector("[data-rb-builder]");
    if (!rb || !builder) return null;
    nav = nav || { assign: function (u) { win.location.href = u; } };

    var details = doc.querySelector("[data-rb-details]");
    var bagsBox = doc.querySelector("[data-rb-bags]");
    var bagTemplate = doc.getElementById("rbBagTemplate");
    var more = doc.querySelector("[data-rb-more]");
    var status = doc.querySelector("[data-rb-status]");
    var totalEl = doc.querySelector("[data-rb-total]");
    var perMonth = doc.querySelector("[data-rb-per-month]");
    var modeButtons = doc.querySelectorAll("[data-rb-mode]");
    var roundBtn = doc.querySelector("[data-rb-round]");
    var roundAmount = doc.querySelector("[data-rb-round-amount]");
    var roundWords = doc.querySelector("[data-rb-round-words]");
    var donateBtn = doc.querySelector("[data-rb-donate]");
    var nudge = doc.querySelector("[data-rb-nudge]");
    var also = doc.querySelector("[data-rb-also]");
    var alsoList = doc.querySelector("[data-rb-also-list]");
    var form = doc.getElementById("rbDetailsForm");
    var summary = form ? form.querySelector("[data-rb-error]") : null;
    var payBtn = form ? form.querySelector("[data-rb-pay]") : null;
    var preview = !!(doc.body && doc.body.getAttribute("data-rb-preview") === "true");
    // The draft preview (Admin > Fill a Red Bag > Preview the page): the page drawn from a list the
    // public cannot see yet. GIVING IS SWITCHED OFF in it: Donate only says so. The server draws no
    // details form on that page either (src/red-bag/render.ts), so there is nothing to send.
    var draft = !!(doc.body && doc.body.getAttribute("data-rb-draft") === "true");
    // The bottom bar: the total and a Donate button at the foot of the screen, at every width,
    // shown while the real ones are out of sight.
    var bar = doc.querySelector("[data-rb-bar]");
    var barTotal = doc.querySelector("[data-rb-bar-total]");
    var barDonate = doc.querySelector("[data-rb-bar-donate]");
    var step = "bag";
    var canWatch = false;
    var realOnScreen = false;
    var footerOnScreen = false;

    var quantities = {};
    var tapped = []; // example keys, in the order they were tapped
    var mode = "once"; // or "monthly"
    // The milestone a round-up was pressed for, in pence; 0 for none. It is the TARGET that is kept,
    // not an amount: the extra is always whatever takes their own items up to it.
    var roundTarget = 0;
    var roundLine = null; // its line under "Also in your bag", made once and kept
    var busy = false;

    // --- the feel good layer -------------------------------------------------------------------
    // Decoration only, and all of it hidden from screen readers: a drawing of the item drops into
    // the bag (or into the bottom bar's total while the bag is off screen), things peek out of the
    // bag's top (the latest added, the newest in front), the bag wobbles, a full bag is tied with a
    // ribbon and a tag, paper snow and gold stars fall over the whole screen at half a bag and (the
    // big moment) at each full one, and an elf scribbles a note on the paper. WHAT to show comes
    // from the catalogue's pure functions (peekOrder, latestPeeks, milestoneCrossed, flurryDue,
    // flurryPlan, strains, noteFor); this only applies it. It changes no sum and no word, takes no tap and never moves the focus. Everything
    // made here is cleared away by a timer, so nothing builds up however fast the donor taps.
    //
    // It can NEVER stop the page working. Two guards: (1) the whole layer is switched off unless the
    // catalogue has every part of it (a donor can be handed this file with the OLD catalogue while a
    // new version is going out); (2) every way in from the page's own code goes through safe(), so
    // anything that goes wrong in here is swallowed, said once in the console, and the sums, the
    // status line, Donate and the checkout carry on untouched.
    var delightOn =
      !!rb.NOTES &&
      !!rb.TAG_LINES &&
      ["art", "peekOrder", "latestPeeks", "strains", "milestoneCrossed", "flurryKind", "flurryDue", "flurryPlan", "noteKind", "noteFor", "notePlacements", "quadTouches"].every(function (name) {
        return typeof rb[name] === "function";
      });
    var delightSaid = false;
    function safe(fn) {
      return function () {
        if (!delightOn) return undefined;
        try {
          return fn.apply(null, arguments);
        } catch (e) {
          if (!delightSaid && typeof console !== "undefined" && console && typeof console.error === "function") {
            delightSaid = true;
            console.error("Fill a Red Bag: a decoration failed and was skipped.", e);
          }
          return undefined;
        }
      };
    }
    var NAV_HEIGHT = 80; // the site's fixed header: a bag under it is not "on screen"
    var MAX_DROPS = 3; // in the air at once; a tap beyond that simply plays no drop
    var DROP_MS = 600; // as in the stylesheet
    var TYPING_MS = 450; // a typed number is finished when the typing stops this long
    var NOTE_MS = 3200;
    var NOTE_HOLD_MS = 900; // a note on one row is left alone this long before the next replaces it
    var PEEK_OUT_MS = 240; // a peek that is leaving sinks for this long (as in the stylesheet), then goes
    // Where the three peeks sit along the bag's top, their tilt and their size: [across, down,
    // degrees, scale], in the bag's own picture (120 wide, its rim at 36). The first is the FRONT
    // place, for the newest thing: the biggest, and standing tallest. A peek is drawn PEEK_SIZE
    // across (5 October 2026: about a third bigger than the 28 it was, and higher out of the bag),
    // with PEEK_RISE of it above the place it is seated. They stay inside the bag's own picture, so
    // they can never reach a neighbouring bag, the words below, or change the panel's height.
    var PEEK_SIZE = 38;
    var PEEK_RISE = 24;
    var PEEK_AT = [
      [31, 33, -8, 1.05],
      [60, 36, 3, 0.97],
      [92, 37, 11, 0.95],
    ];
    var SNOW =
      '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path class="rb-flake__snow" d="M12 1.5l2.6 6 6.5-.75-3.9 5.25 3.9 5.25-6.5-.75-2.6 6-2.6-6-6.5.75L6.8 12 2.9 6.75l6.5.75z"/></svg>';
    var STAR =
      '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path class="rb-flake__star" d="M12 2.5l2.8 6 6.5.8-4.8 4.5 1.3 6.5L12 17l-5.8 3.3 1.3-6.5-4.8-4.5 6.5-.8z"/></svg>';

    var ready = false; // nothing plays while the page is being set up
    var order = []; // the items in the bag, the newest first
    var seen = {}; // each item's quantity when it was last celebrated
    var typing = {}; // a timer for each number box still being typed in
    var inTheAir = 0;
    var flurryBox = null; // the one layer of snow and stars, while it falls
    var flurryKind = ""; // "half" or "full", while it falls
    var flurryTimer = null;
    var flurryAt = {}; // when each milestone last had its snow: the cooldown
    var lastPence = 0;
    var noteEl = null;
    var noteTimer = null;
    var noteRow = null;
    var noteAt = 0;
    var lastNote = "";
    var noteWait = null; // the newest change on a row whose note is still having its moment
    var skipRow = null; // the row last found to have no clear place for a note, and when
    var skipAt = 0;
    var bumpTimer = null;

    // Where a drop flies: one layer over the builder. It takes no tap and clips what leaves it.
    var fx = null;
    if (delightOn) {
      fx = doc.createElement("div");
      fx.className = "rb-fx";
      fx.setAttribute("aria-hidden", "true");
      builder.appendChild(fx);
    }

    /** Has this person asked for less motion? Asked each time, so a change of setting is kept to. */
    function calm() {
      try {
        return !!(typeof win.matchMedia === "function" && win.matchMedia("(prefers-reduced-motion: reduce)").matches);
      } catch (e) {
        return false;
      }
    }
    function later(fn, ms) {
      return setTimeout(fn, ms);
    }
    function gone(el) {
      if (el && el.parentNode) el.parentNode.removeChild(el);
    }
    /** Drawn shapes for inside a bag (our own fixed markup, never anything typed). */
    function shapes(markup) {
      var holder = doc.createElement("div");
      holder.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg">' + markup + "</svg>";
      return holder.firstChild.firstChild;
    }

    // Every bag carries a place for the peeks, BEHIND its own paper so they look inside it, and the
    // ribbon and tag, which the stylesheet shows once the bag is full.
    function dress(svg) {
      if (svg.querySelector(".rb-bag__peeks")) return;
      var paper = svg.querySelector(".rb-bag__paper");
      var peeks = shapes('<g class="rb-bag__peeks"></g>');
      if (paper) svg.insertBefore(peeks, paper);
      else svg.appendChild(peeks);
      svg.appendChild(
        shapes(
          '<g class="rb-bag__tie">' +
            '<g class="rb-bag__tag"><path class="rb-bag__string" d="M60 20c-3 9 3 21 0 31"/>' +
            '<path class="rb-bag__card" d="M41 44h38l11 11v35a4 4 0 0 1-4 4H34a4 4 0 0 1-4-4V55z"/>' +
            '<circle class="rb-bag__hole" cx="60" cy="51.5" r="2.6"/>' +
            '<text class="rb-bag__tag-words"><tspan x="60" y="73">' +
            rb.TAG_LINES[0] +
            '</tspan> <tspan x="60" y="88">' +
            rb.TAG_LINES[1] +
            "</tspan></text></g>" +
            '<g class="rb-bag__bow"><path class="rb-bag__ribbon" d="M57.5 20l-8 12 5.5-.5 2 4.5 3.5-15zM62.5 20l8 12-5.5-.5-2 4.5-3.5-15z"/>' +
            '<path class="rb-bag__ribbon" d="M60 18c-5-8-17-9-17-1s12 6 17 1zM60 18c5-8 17-9 17-1s-12 6-17 1z"/>' +
            '<rect class="rb-bag__knot" x="56" y="14" width="8" height="8" rx="2.5"/></g>' +
            "</g>",
        ),
      );
    }

    /** Put a peek in its place. The place is a style, so a move from one to the next can slide. */
    function seat(g, at) {
      g.style.transform = "translate(" + PEEK_AT[at][0] + "px," + PEEK_AT[at][1] + "px) rotate(" + PEEK_AT[at][2] + "deg) scale(" + PEEK_AT[at][3] + ")";
      g.setAttribute("data-rb-slot", String(at));
    }
    function peek(key, at) {
      var g = shapes('<g class="rb-peek"><g class="rb-peek__in">' + rb.art(key, "", PEEK_SIZE).replace("<svg ", '<svg x="' + -PEEK_SIZE / 2 + '" y="' + -PEEK_RISE + '" ') + "</g></g>");
      g.setAttribute("data-rb-peek", key);
      seat(g, at);
      return g;
    }
    /** A peek leaves: it sinks back into the bag and is cleared away (at once, for less motion). */
    function sink(g) {
      g.removeAttribute("data-rb-peek");
      g.removeAttribute("data-rb-slot");
      if (calm()) return gone(g);
      g.classList.add("is-leaving");
      later(function () {
        gone(g);
      }, PEEK_OUT_MS);
    }

    // What peeks out of one bag: `want` is three places, the front (newest) first. A thing that
    // stays keeps its own drawing and slides to its new place; a new one pops up; one that is no
    // longer wanted sinks. They are drawn oldest first, so the newest is the one on top.
    function dressPeeks(holder, want) {
      var have = {};
      each(holder.querySelectorAll("[data-rb-peek]"), function (g) {
        var key = g.getAttribute("data-rb-peek");
        if (want.indexOf(key) === -1 || have[key]) sink(g);
        else have[key] = g;
      });
      var under = null;
      for (var i = want.length - 1; i >= 0; i -= 1) {
        var key = want[i];
        if (!key) continue;
        var g = have[key];
        if (!g) {
          g = peek(key, i);
          holder.insertBefore(g, under ? under.nextSibling : holder.firstChild);
        } else {
          if (g.getAttribute("data-rb-slot") !== String(i)) seat(g, i);
          // Only one that has become newer than its neighbours is moved (and so pops up afresh).
          if (under && !(under.compareDocumentPosition(g) & 4)) holder.insertBefore(g, under.nextSibling);
        }
        under = g;
      }
    }

    // The bags as they stand: the peeks in the one that is filling, the handles straining when it
    // is nearly full, and the tag's words on the newest full bag while the bags are big enough.
    function dressBags(state) {
      var filling = state.drawn.length && state.drawn[state.drawn.length - 1] < 1 ? state.drawn.length - 1 : -1;
      var fill = filling === -1 ? 1 : state.drawn[filling];
      var newestFull = -1;
      state.drawn.forEach(function (f, n) {
        if (f >= 1) newestFull = n;
      });
      // The latest things added, the newest first, leaving out anything whose number box is empty
      // just now (half way through being retyped).
      var slots = rb.latestPeeks(
        order.filter(function (key) {
          return quantities[key] > 0;
        }),
        fill,
      );
      each(bagsBox.querySelectorAll(".rb-bag"), function (svg, n) {
        dress(svg);
        dressPeeks(svg.querySelector(".rb-bag__peeks"), n === filling ? slots : []);
        if (n === filling && rb.strains(fill)) svg.classList.add("is-heavy");
        else svg.classList.remove("is-heavy");
        if (n === newestFull && state.drawn.length <= 3) svg.classList.add("is-latest");
        else svg.classList.remove("is-latest");
      });
    }

    /**
     * Keep the list of what is in the bag, the newest first, on a FINISHED change (a plus or minus,
     * an arrow key, a box left, or the typing stopped), and show the peeks that follow from it.
     */
    function track(key, was, now) {
      if (was === now) return;
      order = rb.peekOrder(order, key, was, now);
      if (bagsBox) dressBags(rb.bags(total()));
    }

    // A small happy wobble of the bag that is filling, after `wait` seconds (as a drop lands).
    function wobble(wait) {
      if (calm() || !bagsBox) return;
      var bag = bagsBox.lastElementChild;
      if (!bag || bag.classList.contains("is-wobbling")) return;
      // Its arrival is over: two animations on one bag would restart the arrival when this one ends.
      bag.classList.remove("is-new");
      bag.style.setProperty("--rb-wait", (wait || 0) + "s");
      bag.classList.add("is-wobbling");
      later(
        function () {
          bag.classList.remove("is-wobbling");
        },
        (wait || 0) * 1000 + 420,
      );
    }

    // One drawing of the item hops from its row and drops into the bag. With the bag off screen (a
    // phone, part way down the list) it drops into the bottom bar's total instead, and with neither
    // to hand it gives a small hop where it is. Says whether it went to the bag.
    function drop(key, row) {
      if (calm() || inTheAir >= MAX_DROPS) return false;
      var from = (row.querySelector(".rb-qty") || row).getBoundingClientRect();
      var home = fx;
      var x = from.left + from.width / 2;
      var y = from.top + from.height / 2;
      var to = { x: x, y: y + 46 };
      var where = "hop";
      var bag = bagsBox ? bagsBox.lastElementChild : null;
      var box = bag ? bag.getBoundingClientRect() : null;
      var screen = win.innerHeight || (doc.documentElement && doc.documentElement.clientHeight) || 0;
      if (box && box.width > 0 && box.bottom > NAV_HEIGHT && box.top < screen) {
        to = { x: box.left + box.width / 2, y: box.top + box.height * 0.3 };
        where = "bag";
      } else if (bar && !bar.hidden && barTotal) {
        var sum = barTotal.getBoundingClientRect();
        to = { x: sum.left + sum.width / 2, y: sum.top + sum.height / 2 };
        where = "bar";
        // It flies inside the bar itself (which is fixed to the screen), so it is drawn above the
        // bar and is seen to land on the total, not lost behind it.
        home = bar;
        barTotal.classList.add("is-bumped");
        // ONE timer, so an earlier tap's timer never cuts a later nod short.
        clearTimeout(bumpTimer);
        bumpTimer = later(function () {
          barTotal.classList.remove("is-bumped");
        }, DROP_MS + 400);
      }
      var layer = home.getBoundingClientRect();
      var el = doc.createElement("span");
      el.className = "rb-drop rb-drop--" + where;
      el.setAttribute("aria-hidden", "true");
      el.style.left = Math.round(x - layer.left) + "px";
      el.style.top = Math.round(y - layer.top) + "px";
      el.style.setProperty("--rb-dx", Math.round(to.x - x) + "px");
      el.style.setProperty("--rb-dy", Math.round(to.y - y) + "px");
      el.innerHTML = '<span class="rb-drop__y"><span class="rb-drop__hop">' + rb.art(key) + "</span></span>";
      home.appendChild(el);
      inTheAir += 1;
      later(function () {
        gone(el);
        inTheAir -= 1;
      }, DROP_MS + 80);
      return where === "bag";
    }

    /** Clear the snow and stars away, whatever is left of them. */
    function endFlurry() {
      clearTimeout(flurryTimer);
      flurryTimer = null;
      gone(flurryBox);
      flurryBox = null;
      flurryKind = "";
    }

    // The snow and stars, over the WHOLE screen: one layer on the page's body, which the stylesheet
    // fixes to the screen above the header and the bottom bar. It takes no tap, is hidden from
    // screen readers, and is taken out of the page when its time is up. One at a time: only the big
    // moment (a full bag) may take the place of the lighter one (half a bag) while that is falling.
    // Says whether it began.
    function flurry(kind) {
      if (calm() || !doc.body || step !== "bag") return false;
      if (flurryBox && !(kind === "full" && flurryKind === "half")) return false;
      var plan = rb.flurryPlan(kind, win.innerWidth || (doc.documentElement && doc.documentElement.clientWidth) || 0);
      if (!plan || !plan.pieces || !plan.pieces.length) return false;
      var box = doc.createElement("div");
      box.className = "rb-flurry rb-flurry--" + kind;
      box.setAttribute("aria-hidden", "true");
      plan.pieces.forEach(function (p) {
        var piece = doc.createElement("span");
        piece.className = "rb-flake rb-flake--" + (p.star ? "star" : "snow") + (p.big ? " rb-flake--big" : "");
        piece.style.setProperty("--rb-x", p.x + "%");
        piece.style.setProperty("--rb-d", p.wait + "s");
        piece.style.setProperty("--rb-t", p.fall + "s");
        piece.style.setProperty("--rb-s", p.drift + "px");
        piece.style.setProperty("--rb-r", p.turn + "deg");
        piece.style.setProperty("--rb-w", p.size + "px");
        piece.innerHTML = p.star ? STAR : SNOW;
        box.appendChild(piece);
      });
      endFlurry();
      doc.body.appendChild(box);
      flurryBox = box;
      flurryKind = kind;
      flurryTimer = later(endFlurry, plan.ms + 100);
      return true;
    }

    // The snow and stars: only when a milestone is newly crossed on the way up, and not for the
    // same milestone again within the cooldown (someone stepping back and forth across £25).
    function milestone(pence) {
      var crossed = rb.milestoneCrossed(lastPence, pence);
      lastPence = pence;
      if (!crossed || !ready) return;
      var now = Date.now();
      if (rb.flurryDue(crossed, flurryAt, now) && flurry(rb.flurryKind(crossed))) flurryAt[crossed] = now;
    }

    /** The example's own small drawing at the start of its line; the line's words are unchanged. */
    function alsoIcon(span, key) {
      span.insertAdjacentHTML("afterbegin", rb.art(key, "rb-also__icon", 26));
    }

    // --- where the note may lie: never over a name, a price, a heading or a control ---
    // Measured, not assumed. The words of everything on the paper are found as INK (how far the
    // letters really reach, from a canvas that is never added to the page or drawn on), the buttons
    // and number boxes as their boxes, and the note is tried in each place the catalogue lists
    // (above the row, below it, smaller, smallest) until its own ink touches none of them. If there
    // is nowhere clear, no note is written. Where a browser cannot measure, the note is as it was.
    var NOTE_GAP = 2; // px of clear paper kept between the note and anything else
    var inkCtx = null;
    // Measurements are remembered (the same words in the same type), but only once the page's
    // fonts have arrived: before that the letters measured are a stand-in's, in a font of the very
    // same name. And if the browser says a font has arrived since, they are all forgotten.
    var inkSeen = {};
    function fontsIn() {
      return !doc.fonts || typeof doc.fonts.status !== "string" || doc.fonts.status === "loaded";
    }
    if (delightOn && doc.fonts && typeof doc.fonts.addEventListener === "function") {
      doc.fonts.addEventListener("loadingdone", function () {
        inkSeen = {};
      });
    }
    /** How far a line of these words reaches above and below, within its line of type. */
    function inkOf(el, words) {
      var cs = win.getComputedStyle(el);
      var font = cs.fontStyle + " " + cs.fontWeight + " " + cs.fontSize + " " + cs.fontFamily;
      var known = inkSeen[font + "|" + words];
      if (known) return known;
      if (!inkCtx) inkCtx = doc.createElement("canvas").getContext("2d");
      if (!inkCtx) return null;
      inkCtx.font = font;
      var m = inkCtx.measureText(words);
      if (typeof m.fontBoundingBoxAscent !== "number" || typeof m.actualBoundingBoxAscent !== "number") return null;
      known = { box: m.fontBoundingBoxAscent + m.fontBoundingBoxDescent, top: m.fontBoundingBoxAscent - m.actualBoundingBoxAscent, bottom: m.fontBoundingBoxAscent + m.actualBoundingBoxDescent };
      if (fontsIn()) inkSeen[font + "|" + words] = known;
      return known;
    }
    /** Everything on the paper a note must keep off, as boxes. Null where it cannot be measured. */
    function inTheWay(paper) {
      var out = [];
      var ok = true;
      each(paper.querySelectorAll(".rb-item__name, .rb-item__price, .rb-also__words, .rb-group__title, h2, h3"), function (el) {
        var words = (el.textContent || "").replace(/\s+/g, " ").trim();
        if (!words || !ok) return;
        var ink = inkOf(el, words);
        if (!ink) {
          ok = false;
          return;
        }
        var range = doc.createRange();
        range.selectNodeContents(el);
        each(range.getClientRects(), function (q) {
          if (q.width > 0) out.push({ x: q.left - NOTE_GAP, y: q.top + (q.height - ink.box) / 2 + ink.top - NOTE_GAP, w: q.width + 2 * NOTE_GAP, h: ink.bottom - ink.top + 2 * NOTE_GAP });
        });
      });
      each(paper.querySelectorAll("button, input"), function (el) {
        var q = el.getBoundingClientRect();
        if (q.width > 0) out.push({ x: q.left - NOTE_GAP, y: q.top - NOTE_GAP, w: q.width + 2 * NOTE_GAP, h: q.height + 2 * NOTE_GAP, round: el.classList.contains("rb-step") });
      });
      return ok ? out : null;
    }
    /** A note's own ink as it lies now: four corners, turned as the stylesheet turns it. */
    function noteInk(row, el) {
      var ink = inkOf(el, el.textContent);
      if (!ink) return null;
      var at = row.getBoundingClientRect();
      var x = at.left + (row.clientLeft || 0) + el.offsetLeft;
      var y = at.top + (row.clientTop || 0) + el.offsetTop;
      var w = el.offsetWidth;
      var h = el.offsetHeight;
      var top = y + (h - ink.box) / 2;
      // It turns about its bottom right corner (as in the stylesheet).
      var t = new win.DOMMatrix(win.getComputedStyle(el).transform);
      function turn(px, py) {
        var dx = px - (x + w);
        var dy = py - (y + h);
        return [x + w + t.a * dx + t.c * dy + t.e, y + h + t.b * dx + t.d * dy + t.f];
      }
      return [turn(x, top + ink.top), turn(x + w, top + ink.top), turn(x + w, top + ink.bottom), turn(x, top + ink.bottom)];
    }
    /** Put a note where it touches nothing. Says false if there is nowhere: then none is shown. */
    function fitNote(row, el) {
      el.className = "rb-note";
      var paper = typeof row.closest === "function" ? row.closest(".rb-paper") : null;
      if (!paper || typeof win.DOMMatrix !== "function" || typeof win.getComputedStyle !== "function" || !(row.getBoundingClientRect().width > 0)) return true;
      // The paper lies at a slight tilt on a wide screen. It is measured square on, and put back
      // before the browser draws anything, so nothing is seen to move.
      var tilt = paper.style.transform;
      paper.style.transform = "none";
      try {
        var things = inTheWay(paper);
        if (!things) return true;
        var edge = paper.getBoundingClientRect();
        var ways = rb.notePlacements(row.parentNode && row.parentNode.firstElementChild === row);
        for (var i = 0; i < ways.length; i += 1) {
          el.className = "rb-note rb-note--" + (ways[i].below ? "below" : "above") + (ways[i].size ? " rb-note--" + ways[i].size : "");
          var quad = noteInk(row, el);
          if (!quad) {
            el.className = "rb-note";
            return true;
          }
          var clear = quad.every(function (p) {
            return p[0] >= edge.left + 1 && p[0] <= edge.right - 1;
          });
          for (var j = 0; clear && j < things.length; j += 1) {
            if (rb.quadTouches(quad, things[j])) clear = false;
          }
          if (clear) return true;
        }
        return false;
      } finally {
        paper.style.transform = tilt;
      }
    }

    // The elf's note: ONE at a time, on the row just changed. Quick taps on one row keep the note
    // that is there rather than flickering through several.
    function scribble(row, change) {
      clearTimeout(noteWait);
      noteWait = null;
      if (!row || step !== "bag") return;
      var now = Date.now();
      var kind = rb.noteKind(change);
      // A note on this row is still having its moment (quick taps, a held key): leave it be, with no
      // rewrite and no reflow, and write the NEWEST change once the moment is up. The same goes for
      // a row that has just been found to have no clear place for a note: it is not measured again
      // on every tap, only once more when the moment is up.
      var since = 0;
      if (kind !== "first" && kind !== "example" && noteEl && noteRow === row && noteEl.parentNode === row && now - noteAt < NOTE_HOLD_MS) since = noteAt;
      else if (skipRow === row && now - skipAt < NOTE_HOLD_MS) since = skipAt;
      if (since) {
        noteWait = later(
          safe(function () {
            noteWait = null;
            scribble(row, change);
          }),
          NOTE_HOLD_MS - (now - since),
        );
        return;
      }
      var words = rb.noteFor(change, lastNote, Math.random());
      if (!words) return;
      // The new note is written and fitted as a note of its own, so that one still showing on
      // another row is not touched unless this one really has somewhere to go.
      var fresh = doc.createElement("span");
      fresh.className = "rb-note";
      fresh.setAttribute("aria-hidden", "true");
      fresh.textContent = words;
      row.appendChild(fresh);
      // Nowhere clear of the names, prices and buttons: no note this time, rather than one over
      // them. Any note already showing is left to finish in its own time.
      var fits = false;
      try {
        fits = fitNote(row, fresh);
      } finally {
        if (!fits) {
          gone(fresh);
          skipRow = row;
          skipAt = now;
        }
      }
      if (!fits) return;
      skipRow = null;
      // ONE note at a time: the one that was showing gives way to this one.
      clearTimeout(noteTimer);
      if (noteEl && noteEl !== fresh) gone(noteEl);
      noteEl = fresh;
      // Read once so the fade begins from nothing each time.
      void fresh.offsetWidth;
      fresh.classList.add("is-on");
      lastNote = words;
      noteRow = row;
      noteAt = now;
      noteTimer = later(function () {
        fresh.classList.remove("is-on");
        noteTimer = later(function () {
          gone(fresh);
          if (noteEl === fresh) noteEl = null;
        }, 320);
      }, NOTE_MS);
    }

    // An item's quantity has settled (a plus or minus, an arrow key, a box left, or the typing
    // stopped): ONE drop however far it jumped, the wobble, and a note.
    function celebrate(key, row) {
      if (typing[key]) {
        clearTimeout(typing[key]);
        typing[key] = null;
      }
      var before = seen[key] || 0;
      var after = quantities[key] || 0;
      seen[key] = after;
      track(key, before, after);
      if (!ready || step !== "bag" || after === before) return;
      if (after > before) {
        var price = Number(row.getAttribute("data-pence")) || 0;
        wobble(drop(key, row) ? 0.4 : 0);
        scribble(row, { kind: "in", key: key, quantity: after, step: after - before, first: rb.totalPence(quantities, tapped) - (after - before) * price <= 0 });
      } else scribble(row, { kind: "out", key: key, quantity: after, step: before - after });
    }
    function celebrateSoon(key, row) {
      if (typing[key]) clearTimeout(typing[key]);
      typing[key] = later(function () {
        typing[key] = null;
        celebrate(key, row);
      }, TYPING_MS);
    }

    // Every way in from the page's own code, made safe (see the top of this block).
    dressBags = safe(dressBags);
    track = safe(track);
    endFlurry = safe(endFlurry);
    wobble = safe(wobble);
    milestone = safe(milestone);
    alsoIcon = safe(alsoIcon);
    scribble = safe(scribble);
    celebrate = safe(celebrate);
    celebrateSoon = safe(celebrateSoon);

    // The working parts ship hidden; the script that can work them shows them.
    each(doc.querySelectorAll("[data-needs-js]"), function (n) {
      n.hidden = false;
    });
    each(doc.querySelectorAll("[data-nojs]"), function (n) {
      n.hidden = true;
    });

    /** Their own items and examples, before any round-up. */
    function own() {
      return rb.totalPence(quantities, tapped);
    }
    /** What the round-up adds just now: nothing once their own items reach its target. */
    function extra() {
      return rb.roundUpPence(own(), roundTarget);
    }
    /** The total shown, and exactly what is sent: their own items plus the round-up. */
    function total() {
      return own() + extra();
    }
    function isMonthly() {
      return mode === "monthly";
    }
    function exampleOf(key) {
      var found = null;
      rb.examples().forEach(function (e) {
        if (e.key === key) found = e;
      });
      return found;
    }

    // --- the bags -------------------------------------------------------------------------------
    function newBag() {
      var svg = null;
      if (bagTemplate && bagTemplate.content && bagTemplate.content.firstElementChild) {
        svg = bagTemplate.content.firstElementChild.cloneNode(true);
      } else if (bagsBox && bagsBox.firstElementChild) {
        svg = bagsBox.firstElementChild.cloneNode(true);
        svg.classList.remove("is-full", "is-new");
      }
      return svg;
    }

    // A bag added after the page loaded "arrives" (is-new) ONCE. It lets go of that when its own
    // animation ends (or shortly after, where the browser never says so): left on, any later
    // animation on the bag would end by starting the arrival again, and the bag would blink.
    function arrived(bag) {
      var done = function (e) {
        if (e && e.target !== bag) return;
        bag.classList.remove("is-new");
      };
      bag.addEventListener("animationend", done);
      setTimeout(done, 520);
    }

    function drawBags(pence) {
      if (!bagsBox) return;
      var state = rb.bags(pence);
      var have = bagsBox.querySelectorAll(".rb-bag");
      // Bags are only ever added at the end or taken from the end, so a full one stays where it is.
      for (var i = have.length; i < state.drawn.length; i += 1) {
        var bag = newBag();
        if (!bag) break;
        bag.classList.add("is-new");
        bagsBox.appendChild(bag);
        arrived(bag);
      }
      have = bagsBox.querySelectorAll(".rb-bag");
      for (var j = have.length - 1; j >= state.drawn.length; j -= 1) bagsBox.removeChild(have[j]);
      each(bagsBox.querySelectorAll(".rb-bag"), function (svg, n) {
        var f = state.drawn[n] || 0;
        // Anything in the bag at all shows, even a 10p pencil.
        var shown = f > 0 && f < 0.07 ? 0.07 : f;
        svg.style.setProperty("--rb-fill", String(Math.round(shown * 1000) / 1000));
        if (f >= 1) svg.classList.add("is-full");
        else svg.classList.remove("is-full");
      });
      bagsBox.setAttribute("data-count", String(state.drawn.length));
      dressBags(state);
      if (more) {
        more.hidden = state.more === 0;
        setText(more, state.more ? "and " + state.more + " more" : "");
      }
    }

    // --- everything that follows the total ------------------------------------------------------
    // `typing` is true only while a number box is still being typed in (its `input` event). The
    // round-up's target is let go only on a FINISHED change (a plus or minus, an arrow key, a box
    // left, an example, Remove): a box emptied on the way to a new number, or a number half typed,
    // must not throw it away. Mid edit the sums simply follow what is in the box.
    function refresh(typing) {
      if (roundTarget && typing !== true) {
        var mine = own();
        // A round-up never stands alone: once their own choices come to nothing it is cleared.
        // And once their own choices reach or pass its target it has done its job and is
        // forgotten: taking things out later does not bring it back.
        if (mine === 0 || mine >= roundTarget) roundTarget = 0;
      }
      var pence = total();
      drawBags(pence);
      milestone(pence);
      setText(status, rb.statusLine(pence));
      setText(totalEl, rb.pounds(pence));
      if (perMonth) perMonth.hidden = !isMonthly();
      if (nudge && pence >= rb.MIN_PENCE) nudge.hidden = true;
      drawRoundUp(pence);
      // Donate names what it would give: "Donate £31", or "Donate £31 every month".
      setText(donateBtn, pence ? "Donate " + rb.pounds(pence) + (isMonthly() ? " every month" : "") : "Donate");
      setText(barTotal, rb.pounds(pence));
      refreshBar();
      refreshDetails();
    }

    // The bar shows only when it is of use and nothing would be doubled: on the bag step, with
    // something in the bag, while the real total and Donate are off screen, and never over the
    // footer (the charity's details). Where the browser
    // cannot say what is on screen it never shows. While it shows, the page is a little longer
    // (body.rb-bar-on), so it can never rest on the last of the footer.
    function refreshBar() {
      if (!bar) return;
      var show = canWatch && step === "bag" && !realOnScreen && !footerOnScreen && total() > 0;
      bar.hidden = !show;
      if (doc.body) {
        if (show) doc.body.classList.add("rb-bar-on");
        else doc.body.classList.remove("rb-bar-on");
      }
    }

    // --- the steppers ---------------------------------------------------------------------------
    each(builder.querySelectorAll("[data-rb-item]"), function (row) {
      var key = row.getAttribute("data-rb-item");
      var box = row.querySelector("input");
      var minus = row.querySelector("[data-rb-minus]");
      var plus = row.querySelector("[data-rb-plus]");
      if (!box) return;

      function set(n, write) {
        var q = rb.clampQuantity(n);
        quantities[key] = q;
        if (write) box.value = String(q);
        // They SAY they are off, and stay focusable: a button that switched itself off while it
        // held the focus would drop a keyboard user out of the list.
        if (minus) minus.setAttribute("aria-disabled", q <= 0 ? "true" : "false");
        if (plus) plus.setAttribute("aria-disabled", q >= rb.MAX_QUANTITY ? "true" : "false");
        if (q > 0) row.classList.add("is-in");
        else row.classList.remove("is-in");
        refresh(!write);
        // The drop, the wobble and the note wait for a FINISHED change, so a typed jump plays once.
        if (write) celebrate(key, row);
        else celebrateSoon(key, row);
      }

      // Typing counts at once, with no Enter; the box is only tidied when it is left, so a number
      // half typed is never rewritten under the fingers.
      box.addEventListener("input", function () {
        set(box.value, false);
      });
      box.addEventListener("blur", function () {
        set(box.value, true);
      });
      // Up and down arrows step it, as a number box would.
      box.addEventListener("keydown", function (e) {
        var step = e.key === "ArrowUp" ? 1 : e.key === "ArrowDown" ? -1 : 0;
        if (!step) return;
        e.preventDefault();
        set(rb.clampQuantity(box.value) + step, true);
      });
      box.addEventListener("focus", function () {
        if (typeof box.select === "function") {
          try {
            box.select();
          } catch (e) {
            /* selecting unavailable */
          }
        }
      });
      if (minus) {
        minus.addEventListener("click", function () {
          if (minus.getAttribute("aria-disabled") === "true") return;
          set(rb.clampQuantity(box.value) - 1, true);
        });
      }
      if (plus) {
        plus.addEventListener("click", function () {
          if (plus.getAttribute("aria-disabled") === "true") return;
          set(rb.clampQuantity(box.value) + 1, true);
        });
      }
      set(box.value, true);
    });

    // --- the examples: tap to add, tap again (or Remove) to take out ------------------------------
    function exampleButton(key) {
      return doc.querySelector('[data-rb-example="' + key + '"]');
    }

    // The round-up's own line, last under "Also in your bag". ONE element, made once and kept:
    // only its amount is rewritten as the bag changes, so it is never rebuilt under a finger.
    function roundUpLine() {
      if (roundLine) return roundLine;
      var li = doc.createElement("li");
      li.className = "rb-item rb-item--round";
      li.setAttribute("data-rb-round-line", "");
      var words = doc.createElement("span");
      words.className = "rb-also__words";
      words.textContent = rb.WORDS.roundUp;
      var sum = doc.createElement("span");
      sum.className = "rb-item__price";
      sum.setAttribute("data-rb-round-sum", "");
      var remove = doc.createElement("button");
      remove.type = "button";
      remove.className = "rb-remove";
      remove.setAttribute("data-rb-round-remove", "");
      remove.textContent = "Remove";
      remove.addEventListener("click", function () {
        roundTarget = 0;
        refresh();
        // The button that offers it again is where they land (or Donate, if the bag is now empty).
        focusOn(roundBtn && !roundBtn.hidden ? roundBtn : donateBtn);
      });
      li.appendChild(words);
      li.appendChild(sum);
      li.appendChild(remove);
      roundLine = li;
      return li;
    }

    // The round-up button and its line, for the total shown. The button offers the NEXT milestone
    // above that total, so once a round-up is in, it offers the step after it, and pressing that
    // replaces the target: two round-ups are never stacked.
    function drawRoundUp(pence) {
      var offer = rb.roundUpOffer(pence);
      if (roundBtn) {
        roundBtn.hidden = !offer;
        if (offer) {
          setText(roundAmount, "+ " + rb.pounds(offer.add));
          setText(roundWords, offer.words);
        }
      }
      if (!also || !alsoList) return;
      var add = extra();
      if (add > 0) {
        var li = roundUpLine();
        var amount = rb.pounds(add);
        setText(li.querySelector("[data-rb-round-sum]"), amount);
        li.querySelector("[data-rb-round-remove]").setAttribute("aria-label", "Remove from your bag: " + rb.WORDS.roundUp + ", " + amount);
        if (alsoList.lastChild !== li) alsoList.appendChild(li);
      } else if (roundLine && roundLine.parentNode === alsoList) {
        alsoList.removeChild(roundLine);
      }
      also.hidden = !alsoList.firstChild;
    }

    if (roundBtn) {
      roundBtn.addEventListener("click", function () {
        var offer = rb.roundUpOffer(total());
        if (!offer) return;
        roundTarget = offer.target;
        refresh();
        wobble(0);
      });
    }

    function drawAlso() {
      if (!also || !alsoList) return;
      while (alsoList.firstChild) alsoList.removeChild(alsoList.firstChild);
      tapped.forEach(function (key) {
        var e = exampleOf(key);
        if (!e) return;
        var words = rb.pounds(e.pence) + " " + e.words;
        var li = doc.createElement("li");
        li.className = "rb-item";
        var span = doc.createElement("span");
        span.className = "rb-also__words";
        span.textContent = words;
        alsoIcon(span, key);
        var remove = doc.createElement("button");
        remove.type = "button";
        remove.className = "rb-remove";
        remove.setAttribute("data-rb-remove", key);
        remove.setAttribute("aria-label", "Remove from your bag: " + words);
        remove.textContent = "Remove";
        remove.addEventListener("click", function () {
          setExample(key, false);
          focusOn(exampleButton(key));
        });
        li.appendChild(span);
        li.appendChild(remove);
        alsoList.appendChild(li);
      });
      // The round-up's line goes back on, last, when everything is refreshed.
      also.hidden = !alsoList.firstChild;
    }

    function setExample(key, on) {
      var at = tapped.indexOf(key);
      if (on && at === -1) tapped.push(key);
      if (!on && at !== -1) tapped.splice(at, 1);
      var btn = exampleButton(key);
      if (btn) btn.setAttribute("aria-pressed", on ? "true" : "false");
      drawAlso();
      refresh();
      if (on && ready) {
        wobble(0);
        var line = alsoList ? alsoList.querySelector('[data-rb-remove="' + key + '"]') : null;
        scribble(line ? line.parentNode : null, { kind: "example", key: key });
      }
    }

    each(doc.querySelectorAll("[data-rb-example]"), function (btn) {
      btn.addEventListener("click", function () {
        setExample(btn.getAttribute("data-rb-example"), btn.getAttribute("aria-pressed") !== "true");
      });
    });

    // --- once or monthly: two buttons, one of them pressed ---------------------------------------
    each(modeButtons, function (btn) {
      btn.addEventListener("click", function () {
        mode = btn.getAttribute("data-rb-mode") === "monthly" ? "monthly" : "once";
        each(modeButtons, function (b) {
          b.setAttribute("aria-pressed", b.getAttribute("data-rb-mode") === mode ? "true" : "false");
        });
        refresh();
      });
    });

    // --- Donate: the nudge, or on to the details step ----------------------------------------------
    function showStep(to) {
      step = to;
      // The list, the themes and the bag are one section: they go and come back together.
      builder.hidden = step !== "bag";
      if (details) details.hidden = step !== "details";
      // The snow belongs to the bag: it never falls over the donor's details.
      if (step !== "bag") endFlurry();
      refreshBar();
    }

    // One Donate, two buttons: the real one, and the bottom bar's. Under £2 the nudge shows; from
    // the bar it is also brought into view, since the bar only shows while the nudge's place is
    // off screen.
    function pressDonate(fromBar) {
      if (draft) {
        if (nudge) {
          setText(nudge, MSG.draftOff);
          nudge.hidden = false;
          if (fromBar && typeof nudge.scrollIntoView === "function") nudge.scrollIntoView({ block: "center" });
        }
        if (fromBar) focusOn(donateBtn);
        return;
      }
      if (total() < rb.MIN_PENCE) {
        if (nudge) {
          nudge.hidden = false;
          if (fromBar && typeof nudge.scrollIntoView === "function") nudge.scrollIntoView({ block: "center" });
        }
        // The bar goes once the real Donate is on screen, and its button with it: hand the focus on.
        if (fromBar) focusOn(donateBtn);
        return;
      }
      if (!details) return;
      showStep("details");
      refreshDetails();
      ensureStripeJs(doc, win);
      focusOn(doc.getElementById("rb-details-title"));
    }
    if (donateBtn) {
      donateBtn.addEventListener("click", function () {
        pressDonate(false);
      });
    }
    if (barDonate) {
      barDonate.addEventListener("click", function () {
        pressDonate(true);
      });
    }
    var watched = doc.querySelector("[data-rb-watch]");
    if (bar && watched && typeof win.IntersectionObserver === "function") {
      canWatch = true;
      new win.IntersectionObserver(function (entries) {
        realOnScreen = !!(entries.length && entries[entries.length - 1].isIntersecting);
        refreshBar();
      }).observe(watched);
      var footer = doc.querySelector("footer");
      if (footer) {
        new win.IntersectionObserver(function (entries) {
          footerOnScreen = !!(entries.length && entries[entries.length - 1].isIntersecting);
          refreshBar();
        }).observe(footer);
      }
    }
    var back = doc.querySelector("[data-rb-back]");
    if (back) {
      back.addEventListener("click", function () {
        showStep("bag");
        focusOn(donateBtn);
      });
    }

    // --- the details step ---------------------------------------------------------------------------
    function byId(id) {
      return doc.getElementById(id);
    }
    function val(id) {
      var e = byId(id);
      return e ? String(e.value || "").trim() : "";
    }
    function checked(id) {
      var e = byId(id);
      return !!(e && e.checked);
    }
    /** Hide a block and switch its controls off, so a hidden question is never asked or sent. */
    function showBlock(block, on) {
      if (!block) return;
      block.hidden = !on;
      each(block.querySelectorAll("input, select, textarea"), function (c) {
        c.disabled = !on;
      });
    }

    function refreshDetails() {
      if (!form) return;
      var pence = total();
      var month = isMonthly();
      var a = rb.pounds(pence);
      setText(doc.querySelector("[data-rb-details-total]"), a);
      var dm = doc.querySelector("[data-rb-details-monthly]");
      if (dm) dm.hidden = !month;
      // One off only: the card fee. Monthly only: 18 or over, and the all donations declaration.
      showBlock(form.querySelector("[data-rb-fee]"), !month);
      showBlock(form.querySelector("[data-rb-age]"), month);
      each(form.querySelectorAll("[data-rb-wording]"), function (w) {
        w.hidden = w.getAttribute("data-rb-wording") !== (month ? "monthly" : "once");
      });
      setText(form.querySelector("[data-rb-fee-amount]"), pence ? rb.pounds(Math.ceil((pence * CARD_FEE_BP) / 10000) + CARD_FEE_FIXED_PENCE) : "a little");
      setText(
        form.querySelector("[data-rb-giftaid-headline]"),
        pence ? "Make your " + a + " worth " + rb.pounds(Math.round(pence * 1.25)) : "Make your donation worth 25% more",
      );
      var giftAid = checked("rbGiftAid");
      var declaration = byId("rbDeclaration");
      if (declaration) {
        declaration.hidden = !giftAid;
        each(declaration.querySelectorAll("input"), function (c) {
          c.disabled = !giftAid;
        });
      }
      var abroad = giftAid && checked("rbNonUk");
      var postcodeField = byId("rbPostcodeField");
      var postcode = byId("rbPostcode");
      if (postcodeField) postcodeField.hidden = abroad;
      if (postcode) postcode.disabled = !giftAid || abroad;
      if (payBtn && !busy) payBtn.textContent = pence ? "Donate " + a + (month ? " every month" : "") : "Donate";
    }

    function payload() {
      var month = isMonthly();
      var body = {
        mode: month ? "monthly" : "once",
        plan: null,
        amount: total(),
        giftAid: checked("rbGiftAid"),
        coverFee: !month && checked("rbCoverFee"),
        donorType: "individual",
        fullName: (val("rbFirstName") + " " + val("rbSurname")).trim(),
        email: val("rbEmail"),
        emailConsent: checked("rbEmailConsent"),
      };
      if (month) body.ageConfirmed = checked("rbAgeConfirmed");
      if (body.giftAid) {
        var abroad = checked("rbNonUk");
        body.declaration = {
          firstName: val("rbFirstName"),
          lastName: val("rbSurname"),
          houseNameNumber: val("rbHouse"),
          address: val("rbAddress"),
          nonUk: abroad,
        };
        // A one off covers this donation; a monthly one is enduring, which the server sets itself.
        if (!month) body.declaration.scope = "this_donation";
        if (!abroad) body.declaration.postcode = val("rbPostcode");
      }
      body.redBag = true;
      return body;
    }

    function showError(words) {
      if (!summary) return;
      summary.textContent = words;
      summary.hidden = false;
      summary.setAttribute("tabindex", "-1");
      focusOn(summary);
    }

    function validate() {
      var shared = win.NBCCFormValidation;
      if (shared && typeof shared.validateForm === "function") {
        if (summary) summary.textContent = MSG.check;
        return shared.validateForm(form, { summary: summary }).valid;
      }
      if (typeof form.checkValidity === "function" && !form.checkValidity()) {
        showError(MSG.check);
        return false;
      }
      return true;
    }

    function setBusy(on) {
      busy = on;
      if (payBtn) {
        payBtn.disabled = on;
        if (on) payBtn.textContent = MSG.opening;
      }
      if (!on) refreshDetails();
    }

    function remember(body) {
      var s = storage(win);
      if (!s) return;
      try {
        s.setItem(GIFT_KEY, JSON.stringify({ pence: body.amount, giftAid: !!body.giftAid, monthly: body.mode === "monthly" }));
      } catch (e) {
        /* the thank you is simply the plain one */
      }
    }

    function post(body, uiMode) {
      var out = {};
      for (var k in body) if (Object.prototype.hasOwnProperty.call(body, k)) out[k] = body[k];
      if (uiMode) out.uiMode = uiMode;
      var headers = { "Content-Type": "application/json" };
      // While the page is switched off, the checkout takes a Red Bag gift only from signed in staff.
      // The session goes with it ONLY on the preview the server marked, never on the public page.
      if (preview) {
        var s = storage(win);
        var token = null;
        try {
          token = s ? s.getItem(ADMIN_TOKEN_KEY) : null;
        } catch (e) {
          token = null;
        }
        if (token) headers.Authorization = "Bearer " + token;
      }
      return win
        .fetch("/api/checkout-session", { method: "POST", headers: headers, body: JSON.stringify(out) })
        .then(function (res) {
          return res.json().then(
            function (data) {
              return { status: res.status, data: data || {} };
            },
            function () {
              return { status: res.status, data: {} };
            },
          );
        });
    }

    function handle(r) {
      if (r.status === 200) return true;
      setBusy(false);
      showError(r.status === 400 ? MSG.refused : r.status === 403 ? MSG.notOpen : MSG.down);
      return false;
    }

    function hosted(body) {
      post(body)
        .then(function (r) {
          if (!handle(r)) return;
          if (r.data.url) {
            remember(body);
            nav.assign(r.data.url);
          } else {
            setBusy(false);
            showError(MSG.down);
          }
        })
        .catch(function () {
          setBusy(false);
          showError(MSG.down);
        });
    }

    var mount = doc.getElementById("rbEmbeddedCheckout");
    function embeddedThenHosted(body) {
      if (typeof win.Stripe !== "function" || !mount) return hosted(body);
      post(body, "embedded")
        .then(function (r) {
          if (!handle(r)) return;
          if (!r.data.clientSecret || !r.data.publishableKey) return hosted(body);
          var stripe;
          try {
            stripe = win.Stripe(r.data.publishableKey);
          } catch (e) {
            return hosted(body);
          }
          return stripe
            .initEmbeddedCheckout({ clientSecret: r.data.clientSecret })
            .then(function (checkout) {
              embedded.instance = checkout;
              remember(body);
              openModal(doc);
              checkout.mount(mount);
              setBusy(false);
            })
            .catch(function () {
              closeModal(doc);
              hosted(body);
            });
        })
        .catch(function () {
          hosted(body);
        });
    }

    if (form) {
      form.addEventListener("input", refreshDetails);
      form.addEventListener("change", refreshDetails);
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        if (busy) return;
        if (summary) summary.hidden = true;
        if (total() < rb.MIN_PENCE) return showError(rb.WORDS.nudge);
        if (!validate()) return;
        if (typeof win.fetch !== "function") return showError(MSG.down);
        setBusy(true);
        embeddedThenHosted(payload());
      });
      wireModal(doc);
      // Back from Stripe's own page with the Back button: the browser brings this page out of its
      // back and forward cache exactly as it was left, the pay button still switched off and
      // saying "Opening secure payment". Make it ready again.
      if (typeof win.addEventListener === "function") {
        win.addEventListener("pageshow", function (e) {
          if (e && e.persisted) setBusy(false);
        });
      }
    }

    refresh();
    // The first bag was on the page already: it does not "arrive".
    each(doc.querySelectorAll("[data-rb-bags] .rb-bag"), function (b) {
      b.classList.remove("is-new");
    });
    // From here on, a change is the donor's own, and may be celebrated.
    ready = true;

    return { total: total, payload: payload };
  }

  // --- Stripe on the page: the donate page's modal, driven from here ---------------------------------
  var embedded = { instance: null };

  function ensureStripeJs(doc, win) {
    if (typeof win.Stripe === "function" || doc.getElementById("stripe-js-sdk")) return;
    if (!doc.getElementById("rbEmbeddedCheckout") || !doc.head) return;
    var s = doc.createElement("script");
    s.id = "stripe-js-sdk";
    s.src = "https://js.stripe.com/v3/";
    s.async = true;
    doc.head.appendChild(s);
  }

  function openModal(doc) {
    var modal = doc.getElementById("rbCheckoutModal");
    if (modal) {
      modal.hidden = false;
      modal.setAttribute("aria-hidden", "false");
    }
    if (doc.body) doc.body.classList.add("give-embedded-open");
    focusOn(doc.getElementById("rbCheckoutClose"));
  }

  function closeModal(doc) {
    var modal = doc.getElementById("rbCheckoutModal");
    if (modal) {
      modal.hidden = true;
      modal.setAttribute("aria-hidden", "true");
    }
    if (doc.body) doc.body.classList.remove("give-embedded-open");
    if (embedded.instance) {
      try {
        embedded.instance.destroy();
      } catch (e) {
        /* already gone */
      }
      embedded.instance = null;
    }
    var mount = doc.getElementById("rbEmbeddedCheckout");
    if (mount) mount.innerHTML = "";
    focusOn(doc.querySelector("[data-rb-pay]"));
  }

  function wireModal(doc) {
    var close = doc.getElementById("rbCheckoutClose");
    var modal = doc.getElementById("rbCheckoutModal");
    if (!close || !modal || close.__rbWired) return;
    close.__rbWired = true;
    close.addEventListener("click", function () {
      closeModal(doc);
    });
    doc.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !modal.hidden) closeModal(doc);
    });
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { initRedBag: initRedBag };
  } else {
    initRedBag(document, window);
  }
})();
