// Fill a Red Bag: the list, the themes, the £50 bag value, and the sums.
//
// The ONE place these live (docs/superpowers/specs/2026-10-04-fill-a-red-bag-design.md). The page
// loads this file in the browser (assets/js/red-bag.js uses it as window.NBCCRedBag); the server
// reads the very same file to draw the list into the page (src/red-bag/catalogue.ts), and the tests
// read it too, so the three can never disagree. When staff can edit the list in the admin (half 2),
// only the data below moves; the sums and the words stay.
//
// The rules it keeps:
//   - money is whole pence, always, so 10p pencils never drift;
//   - the items are EXAMPLES of what a donation could do. Every example says "could", never "will"
//     (Code of Fundraising Practice; OSCR): the donation is for NBCC's general funds;
//   - one Red Bag Full of Joy is around £50, as the donate page says;
//   - a round-up is simply extra money towards the next milestone (half a bag, a full bag, the next
//     whole bag). It buys nothing and is never described as buying anything.
//
// No DOM, no clock, nothing but data and pure functions. A classic script, exported under a
// CommonJS guard so the server and the unit tests can load it.
(function () {
  "use strict";

  var BAG_VALUE_PENCE = 5000;
  var MIN_PENCE = 200;
  var MAX_QUANTITY = 99;
  var MAX_BAGS_DRAWN = 5;
  // The first milestone a round-up offers: half a bag. After it, every whole bag.
  var HALF_BAG_PENCE = BAG_VALUE_PENCE / 2;

  // The headings are the printed "Donation ideas" sheet's own, in its order.
  var GROUPS = [
    {
      key: "home",
      heading: "Home comforts",
      items: [
        { key: "blanket", name: "Blanket", pence: 800 },
        { key: "insulated-cup", name: "Insulated cup", pence: 700 },
        { key: "toiletry-set", name: "Toiletry & fragrance gift set", pence: 500 },
      ],
    },
    {
      key: "play",
      heading: "Play & downtime",
      items: [
        { key: "toy", name: "Toy", pence: 500 },
        { key: "soft-toy", name: "Soft toy", pence: 400 },
        { key: "headphones", name: "Headphones", pence: 900 },
      ],
    },
    {
      key: "books",
      heading: "Books & creativity",
      items: [
        { key: "book", name: "Book", pence: 300 },
        { key: "colouring-book", name: "Colouring book", pence: 200 },
        { key: "pencil", name: "Pencil", pence: 10 },
        { key: "notebook", name: "Notebook", pence: 100 },
      ],
    },
    {
      key: "clothing",
      heading: "Clothing",
      items: [
        { key: "pyjamas", name: "Pyjamas (ages 13 & under)", pence: 500 },
        { key: "socks", name: "Socks (pair)", pence: 100 },
        { key: "hat-gloves", name: "Hat & gloves", pence: 400 },
      ],
    },
  ];

  // "Whenever the need comes": three themes, three examples each. `words` follows the amount:
  // "£15 could help replace a child's favourite cuddly toy". (A fourth theme, "Red Bags Full of
  // Joy", came out on 4 October 2026: the donor is already filling a bag from the list.)
  var THEMES = [
    {
      key: "crisis",
      title: "After a crisis",
      sub: "Helping families start again",
      examples: [
        { key: "crisis-15", pence: 1500, words: "could help replace a child's favourite cuddly toy" },
        { key: "crisis-30", pence: 3000, words: "could help with fresh bedding for a child" },
        { key: "crisis-60", pence: 6000, words: "could help a family with kitchen basics to start again" },
      ],
    },
    {
      key: "school",
      title: "Clothing & school",
      sub: "When families can't stretch to it",
      examples: [
        { key: "school-25", pence: 2500, words: "could help with a pair of school shoes" },
        { key: "school-35", pence: 3500, words: "could help keep a child warm with a winter coat" },
        { key: "school-40", pence: 4000, words: "could help a child start school in a uniform that fits" },
      ],
    },
    {
      key: "hand",
      title: "A hand at rock bottom",
      sub: "When it matters most",
      examples: [
        { key: "hand-20", pence: 2000, words: "could help with toiletries and warm clothes in a hard moment" },
        { key: "hand-75", pence: 7500, words: "could help a young person take their first step into their own business" },
        { key: "hand-150", pence: 15000, words: "could help towards a bed or cooker for someone moving into a home with nothing" },
      ],
    },
  ];

  // Word for word where the design says so (the elves line, who it is for, the nudge).
  var WORDS = {
    elves: "Our elves use your gift wherever it's needed most, so the items are a taste of what it could do, not a shopping list.",
    audience: "children, young people and vulnerable adults",
    empty: "Your bag is empty. Pop something in.",
    nudge: "Add a little more to reach £2. Maybe some socks?",
    another: "Another one is filling.",
    // The line a round-up adds under "Also in your bag". Extra money, plainly.
    roundUp: "A little extra to round up",
  };

  // How full one bag looks in words, by the share of £50 reached (from £2 up).
  var FILL_WORDS = [
    [0.19, "Your bag is starting to fill."],
    [0.38, "Your bag is about a quarter full."],
    [0.63, "Your bag is about half full."],
    [0.88, "Your bag is about three quarters full."],
    [1, "Your bag is nearly full."],
  ];

  function items() {
    var out = [];
    GROUPS.forEach(function (g) {
      g.items.forEach(function (i) {
        out.push(i);
      });
    });
    return out;
  }

  function examples() {
    var out = [];
    THEMES.forEach(function (t) {
      t.examples.forEach(function (e) {
        out.push(e);
      });
    });
    return out;
  }

  /** A quantity as typed: a whole number from 0 to 99. Anything else is 0. */
  function clampQuantity(value) {
    var n = Math.floor(Number(String(value === undefined || value === null ? "" : value).trim()));
    if (!isFinite(n) || n < 0) return 0;
    return n > MAX_QUANTITY ? MAX_QUANTITY : n;
  }

  /**
   * The running total in pence: every item at its quantity ({ key: quantity }), plus each example
   * tapped ([key]) once. Whole pence in, whole pence out. Unknown keys count for nothing.
   */
  function totalPence(quantities, exampleKeys) {
    var q = quantities || {};
    var total = 0;
    items().forEach(function (i) {
      if (Object.prototype.hasOwnProperty.call(q, i.key)) total += clampQuantity(q[i.key]) * i.pence;
    });
    var tapped = exampleKeys || [];
    examples().forEach(function (e) {
      if (tapped.indexOf(e.key) !== -1) total += e.pence;
    });
    return total;
  }

  /**
   * The bags to draw for a total. `full`: whole bags reached. `drawn`: how full each bag on screen
   * is, 0 to 1, five at most: the full ones, then the one filling. `more`: whole bags not drawn.
   */
  function bags(pence) {
    var total = Math.max(0, Math.floor(pence || 0));
    var full = Math.floor(total / BAG_VALUE_PENCE);
    var rest = total % BAG_VALUE_PENCE;
    var drawn = [];
    for (var i = 0; i < full && i < MAX_BAGS_DRAWN; i += 1) drawn.push(1);
    if (drawn.length < MAX_BAGS_DRAWN && (rest > 0 || full === 0)) drawn.push(rest / BAG_VALUE_PENCE);
    return { full: full, drawn: drawn, more: Math.max(0, full - MAX_BAGS_DRAWN) };
  }

  /** The line under the bags. Always "could" in spirit: it describes the bag, and promises nothing. */
  function statusLine(pence) {
    var total = Math.max(0, Math.floor(pence || 0));
    if (total === 0) return WORDS.empty;
    if (total < MIN_PENCE) return WORDS.nudge;
    if (total < BAG_VALUE_PENCE) {
      var share = total / BAG_VALUE_PENCE;
      for (var i = 0; i < FILL_WORDS.length; i += 1) {
        if (share < FILL_WORDS[i][0]) return FILL_WORDS[i][1];
      }
      return FILL_WORDS[FILL_WORDS.length - 1][1];
    }
    var full = Math.floor(total / BAG_VALUE_PENCE);
    var line =
      full === 1
        ? "That's around the value of a whole Red Bag Full of Joy."
        : "That's around the value of " + full + " Red Bags Full of Joy.";
    return total % BAG_VALUE_PENCE ? line + " " + WORDS.another : line;
  }

  /**
   * The next milestone above a total, in pence: half a bag (£25), then a full bag (£50), then every
   * whole bag after it. Always ABOVE the total, so a total sitting exactly on one is offered the
   * next. Nothing (0) for an empty bag.
   */
  function nextMilestone(pence) {
    var total = Math.max(0, Math.floor(pence || 0));
    if (total === 0) return 0;
    if (total < HALF_BAG_PENCE) return HALF_BAG_PENCE;
    return (Math.floor(total / BAG_VALUE_PENCE) + 1) * BAG_VALUE_PENCE;
  }

  /** A milestone in words: "half a bag", "a full bag", "2 full bags". */
  function milestoneWords(targetPence) {
    var target = Math.max(0, Math.floor(targetPence || 0));
    if (target === HALF_BAG_PENCE) return "half a bag";
    var n = Math.round(target / BAG_VALUE_PENCE);
    return n <= 1 ? "a full bag" : n + " full bags";
  }

  /**
   * The round-up on offer for a total (the total as shown, any round-up already in it): the next
   * milestone, what pressing it would add to that total, and the button's words. Null for an empty
   * bag: there is nothing to round up.
   */
  function roundUpOffer(pence) {
    var total = Math.max(0, Math.floor(pence || 0));
    var target = nextMilestone(total);
    if (!target) return null;
    return { target: target, add: target - total, words: "Round up to " + milestoneWords(target) };
  }

  /**
   * The top-up a round-up adds: whatever takes the donor's own items (and examples) up to the
   * target they chose. So it shrinks as they add things, grows back as they take things out, and
   * is nothing once their own items reach or pass the target. Whole pence.
   */
  function roundUpPence(ownPence, targetPence) {
    var own = Math.max(0, Math.floor(ownPence || 0));
    var target = Math.max(0, Math.floor(targetPence || 0));
    return target > own ? target - own : 0;
  }

  /** £8, £54.10, £1,250; and 10p for anything under a pound. */
  function pounds(pence) {
    var p = Math.max(0, Math.floor(pence || 0));
    if (p > 0 && p < 100) return p + "p";
    var whole = Math.floor(p / 100);
    var rest = p % 100;
    var shown = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return rest ? "£" + shown + "." + (rest < 10 ? "0" : "") + rest : "£" + shown;
  }

  var api = {
    BAG_VALUE_PENCE: BAG_VALUE_PENCE,
    MIN_PENCE: MIN_PENCE,
    MAX_QUANTITY: MAX_QUANTITY,
    MAX_BAGS_DRAWN: MAX_BAGS_DRAWN,
    GROUPS: GROUPS,
    THEMES: THEMES,
    WORDS: WORDS,
    items: items,
    examples: examples,
    clampQuantity: clampQuantity,
    totalPence: totalPence,
    bags: bags,
    statusLine: statusLine,
    HALF_BAG_PENCE: HALF_BAG_PENCE,
    nextMilestone: nextMilestone,
    milestoneWords: milestoneWords,
    roundUpOffer: roundUpOffer,
    roundUpPence: roundUpPence,
    pounds: pounds,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else window.NBCCRedBag = api;
})();
