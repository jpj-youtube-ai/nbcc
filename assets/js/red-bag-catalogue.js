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
   * is nothing once their own items reach or pass the target. It never stands alone: with none of
   * their own choices in the bag there is nothing to round up, and it is nothing. Whole pence.
   */
  function roundUpPence(ownPence, targetPence) {
    var own = Math.max(0, Math.floor(ownPence || 0));
    var target = Math.max(0, Math.floor(targetPence || 0));
    if (own === 0) return 0;
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

  // ---------------------------------------------------------------------------------------------
  // The feel good layer (4 October 2026). Decoration only: none of it changes a price, a total or
  // a word the donor already reads, and none of it says anything is bought or goes to anyone.
  // ---------------------------------------------------------------------------------------------

  // The drawings: one for every item on the list and every example, all in ONE place. Each is the
  // inside of a 40 by 40 picture, drawn with simple shapes. They carry no colour of their own: the
  // stylesheet (assets/css/red-bag.css, .rb-art) gives the classes the site's colours.
  //   r crimson, d maroon, t tan, s pale tan, c cream, w white, h holly, g gold, e slate (fills);
  //   n no outline; l a cream line; q a crimson line; x a thicker line.
  var ART = {
    // --- the list ---
    blanket:
      '<rect class="r" x="4" y="19" width="32" height="13" rx="4"/><path class="c" d="M23 19h6v13h-6z"/>' +
      '<rect class="r" x="4" y="8" width="30" height="13" rx="5.5"/><path class="c" d="M21.5 8h6v13h-6z"/>' +
      '<path class="l" d="M9 14.5h8M9 25.5h9"/><path d="M9 32v3.5M15 32v3.5M21 32v3.5M27 32v3.5M32.5 31.5v3.5"/>',
    "insulated-cup":
      '<path class="h" d="M11 13h18l-2 21a2 2 0 0 1-2 2H15a2 2 0 0 1-2-2z"/><path class="c" d="M11.7 20h16.6l-.8 8H12.5z"/>' +
      '<path class="t" d="M10 8h20a1.5 1.5 0 0 1 1.5 1.5V13h-23V9.5A1.5 1.5 0 0 1 10 8z"/><path class="t" d="M16 8V5.5h8V8"/>' +
      '<path class="r n" d="M20 22.2c1.2-1.6 3.4-.3 2.6 1.4-.5 1-1.6 1.7-2.6 2.6-1-.9-2.1-1.6-2.6-2.6-.8-1.7 1.4-3 2.6-1.4z"/>',
    "toiletry-set":
      '<path class="s" d="M6 19a3 3 0 0 1 3-3h7a3 3 0 0 1 3 3v15a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2z"/><rect class="t" x="10" y="11" width="5" height="5"/>' +
      '<path d="M12.5 11V7h6v2.5"/><rect class="r" x="8.5" y="22" width="8" height="8" rx="1.5"/>' +
      '<rect class="c" x="23" y="21" width="12" height="15" rx="2.5"/><rect class="g" x="26.5" y="15.5" width="5" height="5.5" rx="1"/><path d="M26 28.5h6"/>' +
      '<path class="g n" d="M29 3l1 2.6 2.6 1-2.6 1-1 2.6-1-2.6-2.6-1 2.6-1z"/>',
    toy:
      '<path d="M20 9V5.5"/><circle class="r" cx="20" cy="4" r="2.2"/><rect class="t" x="10.5" y="9" width="19" height="12.5" rx="3"/>' +
      '<circle class="w" cx="16" cy="15" r="2.3"/><circle class="w" cx="24" cy="15" r="2.3"/><circle class="d n" cx="16" cy="15" r=".9"/><circle class="d n" cx="24" cy="15" r=".9"/>' +
      '<rect class="r" x="12.5" y="23.5" width="15" height="10.5" rx="2"/><path d="M12.5 26.5H8.5v5M27.5 26.5h4v5M17 34v3.5M23 34v3.5"/>' +
      '<circle class="g" cx="20" cy="28.7" r="2.2"/>',
    "soft-toy":
      '<ellipse class="c" cx="14.5" cy="9" rx="3.2" ry="7.5"/><ellipse class="c" cx="25.5" cy="9" rx="3.2" ry="7.5"/>' +
      '<ellipse class="t n" cx="14.5" cy="9.5" rx="1.3" ry="4.5"/><ellipse class="t n" cx="25.5" cy="9.5" rx="1.3" ry="4.5"/>' +
      '<ellipse class="c" cx="20" cy="31" rx="8" ry="7"/><circle class="c" cx="13" cy="36" r="2.8"/><circle class="c" cx="27" cy="36" r="2.8"/>' +
      '<circle class="c" cx="20" cy="20" r="8"/><circle class="d n" cx="16.8" cy="19" r="1"/><circle class="d n" cx="23.2" cy="19" r="1"/>' +
      '<path class="r n" d="M18.7 22h2.6L20 23.6z"/><path d="M20 23.6v1.2M18 25.5c1 1 3 1 4 0"/>',
    headphones:
      '<path class="x" d="M9 24v-4a11 11 0 0 1 22 0v4"/><rect class="r" x="4.5" y="21.5" width="8" height="13.5" rx="3.5"/>' +
      '<rect class="r" x="27.5" y="21.5" width="8" height="13.5" rx="3.5"/><path class="l" d="M8.5 25.5v5.5M31.5 25.5v5.5"/>',
    book:
      '<path class="w" d="M12 9h21v25H12z"/><path d="M33 12.5h-3M33 16h-3M33 30h-3"/><path class="h" d="M8 6h20a2 2 0 0 1 2 2v24a2 2 0 0 1-2 2H8z"/>' +
      '<path d="M12.5 6v28"/><path class="l" d="M16.5 13h9.5M16.5 17.5h6.5"/><path class="g n" d="M21 23l1 2.5 2.5 1-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1z"/>',
    "colouring-book":
      '<rect class="c" x="4" y="7" width="23" height="28" rx="2"/><path d="M8.5 7v28"/><circle class="g" cx="17.5" cy="17" r="3.5"/>' +
      '<path d="M17.5 10.5v1.5M17.5 22v1.5M11 17h1.5M23 17h1.5M13 12.5l1 1M22 12.5l-1 1M13 21.5l1-1M22 21.5l-1-1"/>' +
      '<path class="q" d="M11.5 29c1.5-2.5 3 2.5 4.5 0s3 2.5 4.5 0 2 1 3.5 0"/>' +
      '<path class="r" d="M30 15h6v19a1.5 1.5 0 0 1-1.5 1.5h-3A1.5 1.5 0 0 1 30 34z"/><path class="r" d="M30 15l3-6.5 3 6.5z"/><path class="l" d="M30 21h6M30 29h6"/>',
    pencil:
      '<path class="g" d="M14.5 13h11v19h-11z"/><path d="M18.2 13v19M21.8 13v19"/><path class="s" d="M14.5 13L20 3l5.5 10z"/><path class="d n" d="M18.2 6.3L20 3l1.8 3.3z"/>' +
      '<rect class="c" x="14.5" y="32" width="11" height="2.8"/><path class="t" d="M14.5 34.8h11V36a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2z"/>',
    notebook:
      '<rect class="r" x="7" y="8" width="26" height="29" rx="2.5"/><rect class="c" x="12" y="16" width="16" height="9" rx="1.5"/><path d="M15 20.5h10"/>' +
      '<path class="x" d="M12 5v6M17.3 5v6M22.7 5v6M28 5v6"/><path class="l" d="M12 30.5h16"/>',
    pyjamas:
      '<path class="c" d="M14 6L5 10.5l2.5 7.5 4.5-2v19.5h16V16l4.5 2 2.5-7.5L26 6l-6 6.5z"/><path d="M20 12.5v23"/>' +
      '<path class="q" d="M15.5 15v20.5M24.5 15v20.5M8.3 11.5l2.2 5.3M31.7 11.5l-2.2 5.3"/>' +
      '<circle class="r n" cx="22.2" cy="18" r="1.1"/><circle class="r n" cx="22.2" cy="24" r="1.1"/><circle class="r n" cx="22.2" cy="30" r="1.1"/>' +
      '<path class="g n" d="M15.8 21.5a3.3 3.3 0 1 0 3.4 4.6 2.8 2.8 0 0 1-3.4-4.6z"/>',
    socks:
      '<path class="h" d="M21 4h8v14l7 5.5a4.5 4.5 0 0 1-2.7 8.1H31a8 8 0 0 1-5.7-2.4L22.5 26.5A5 5 0 0 1 21 23z"/><path class="c" d="M21 4h8v4.5h-8z"/>' +
      '<path class="r" d="M7 8h9v14l8 6a4.5 4.5 0 0 1-2.7 8.1H18a8 8 0 0 1-5.7-2.4L8.5 30A5 5 0 0 1 7 26.5z"/><path class="c" d="M7 8h9v5H7z"/>' +
      '<path class="l" d="M7 17.5h9M7 21h9"/><path class="l" d="M21 12.5h8"/>',
    "hat-gloves":
      '<circle class="c" cx="16" cy="8" r="4.5"/><path class="r" d="M4.5 26a11.5 11.5 0 0 1 23 0z"/><path class="l" d="M8 21.5l2.7-3 2.7 3 2.6-3 2.7 3 2.6-3 2.7 3"/>' +
      '<rect class="c" x="2.5" y="25" width="27" height="7.5" rx="3"/><path d="M9 25v7.5M16 25v7.5M23 25v7.5"/>' +
      '<path class="h" d="M26.5 21.5l-2.3 1.5a2.3 2.3 0 0 0 2.3 4"/><path class="h" d="M26.5 18.5a4.5 4.5 0 0 1 9 0V31h-9z"/><rect class="c" x="25.5" y="31" width="11" height="5.5" rx="1.5"/>',
    // --- the examples under "Whenever the need comes" ---
    "crisis-15":
      '<circle class="t" cx="11.5" cy="8.5" r="4.2"/><circle class="t" cx="28.5" cy="8.5" r="4.2"/><circle class="s n" cx="11.5" cy="8.5" r="1.8"/><circle class="s n" cx="28.5" cy="8.5" r="1.8"/>' +
      '<ellipse class="t" cx="9.5" cy="26" rx="3.3" ry="4.8"/><ellipse class="t" cx="30.5" cy="26" rx="3.3" ry="4.8"/>' +
      '<ellipse class="t" cx="20" cy="29.5" rx="9" ry="8"/><ellipse class="s n" cx="20" cy="30.5" rx="4.8" ry="5"/>' +
      '<circle class="t" cx="13" cy="36" r="3.3"/><circle class="t" cx="27" cy="36" r="3.3"/>' +
      '<circle class="t" cx="20" cy="14.5" r="9.5"/><ellipse class="s" cx="20" cy="17.5" rx="4.2" ry="3.2"/>' +
      '<circle class="d n" cx="16.2" cy="12.5" r="1"/><circle class="d n" cx="23.8" cy="12.5" r="1"/><path class="d n" d="M18.7 16h2.6L20 17.6z"/><path d="M20 17.6v1.4"/>',
    "crisis-30":
      '<rect class="t" x="3" y="9" width="4.5" height="26" rx="1.5"/><rect class="t" x="33" y="18" width="4" height="17" rx="1.5"/>' +
      '<rect class="w" x="9" y="15.5" width="10" height="6" rx="2.5"/><path class="r" d="M7.5 21.5H33V30H7.5z"/><path class="c" d="M7.5 21.5h8l3 8.5h-11z"/>' +
      '<path class="l" d="M22 25.8h7.5"/><path d="M7.5 30H33"/>',
    "crisis-60":
      '<path d="M14.5 7c-1.3-1.5 1.3-2.5 0-4M20 6c-1.3-1.5 1.3-2.5 0-4M25.5 7c-1.3-1.5 1.3-2.5 0-4"/>' +
      '<path class="r" d="M8 19h24v12a4 4 0 0 1-4 4H12a4 4 0 0 1-4-4z"/><path class="x" d="M8 23.5H4.5M32 23.5h3.5"/>' +
      '<path class="t" d="M6.5 19a13.5 6.5 0 0 1 27 0z"/><circle class="g" cx="20" cy="11" r="2.2"/><path class="l" d="M13 26v4"/>',
    "school-25":
      '<path class="e" d="M11 18.5v-7c0-1 .8-1.8 1.8-1.8H18l5 5 7.5 1.4c2.8.5 4.5 1.8 4.5 3.400z"/><rect class="t" x="10" y="18.5" width="26" height="3" rx="1.5"/>' +
      '<path class="e" d="M4.5 31.5v-8.3c0-1.1.9-2 2-2h5.8l5.5 5.6 8.2 1.5c3 .5 5 2 5 3.7z"/><rect class="t" x="3.5" y="31.5" width="28.5" height="3.5" rx="1.7"/>' +
      '<path class="l" d="M12.5 23.5l3.8 4.8M16.5 26.3l2.5-2M19.3 28l2.2-1.8"/>',
    "school-35":
      '<path class="h" d="M14 7l-7.5 4L3.5 28.5h5.5l1.5-8V36h19V20.5l1.5 8h5.5L33.5 11 26 7z"/><path class="c" d="M13 7.5c.5 4.5 13.5 4.5 14 0l-2.5-3h-9z"/>' +
      '<path d="M20 11v25"/><path class="l" d="M13 27.5h4M23 27.5h4"/><circle class="g n" cx="22.3" cy="16" r="1.1"/><circle class="g n" cx="22.3" cy="21" r="1.1"/>',
    "school-40":
      '<path class="d" d="M14 7l-8 4-2.5 18.5h5.5l1.5-9V36h19V20.5l1.5 9h5.5L34 11l-8-4-6 8.5z"/><path class="w" d="M14 7l6 8.5L26 7l-2.5-2h-7z"/>' +
      '<path class="r" d="M20 8l1.8 2.2L20 15.5l-1.8-5.3z"/><path class="l" d="M10.5 32.5h19M4.7 26.5h4.6M30.7 26.5h4.6"/>',
    "hand-20":
      '<rect class="s" x="3.5" y="22.5" width="21" height="12.5" rx="4.5"/><rect x="8" y="26" width="12" height="5.5" rx="2.7"/>' +
      '<circle class="w" cx="8.5" cy="16" r="2.8"/><circle class="w" cx="15.5" cy="11.5" r="3.8"/><circle class="w" cx="21.5" cy="17.5" r="2.2"/>' +
      '<rect class="h" x="29.5" y="15" width="4.5" height="21.5" rx="2.2"/><rect class="w" x="28.5" y="3.5" width="6.5" height="10" rx="1.8"/><path d="M28.5 7h6.5M28.5 10h6.5"/>',
    "hand-75":
      '<path class="x" d="M13.5 16v-3.5a3 3 0 0 1 3-3h7a3 3 0 0 1 3 3V16"/><rect class="r" x="4" y="16" width="32" height="19" rx="2.5"/><path d="M4 23h32"/>' +
      '<rect class="g" x="17" y="20.5" width="6" height="5" rx="1"/><path class="l" d="M8.5 29.5h6M25.5 29.5h6"/>',
    "hand-150":
      '<path class="h" d="M10.5 8V5h8v3"/><path d="M18.5 6h3"/><rect class="c" x="6" y="8" width="28" height="29" rx="2.5"/><path d="M6 15.5h28"/>' +
      '<circle class="r" cx="12" cy="11.8" r="1.5"/><circle class="r" cx="20" cy="11.8" r="1.5"/><circle class="r" cx="28" cy="11.8" r="1.5"/>' +
      '<rect class="s" x="10" y="19" width="20" height="13.5" rx="1.5"/><path class="x" d="M13.5 22h13"/><rect class="t" x="13.5" y="25" width="13" height="5" rx="1"/>',
  };

  /**
   * One drawing as an inline picture, for the eye only: never read out and never in the tab order.
   * Nothing for a key with no drawing. `cls` adds a class, `size` sets its width and height.
   */
  function art(key, cls, size) {
    if (!Object.prototype.hasOwnProperty.call(ART, key)) return "";
    var px = size || 40;
    return (
      '<svg class="rb-art' + (cls ? " " + cls : "") + '" viewBox="0 0 40 40" width="' + px + '" height="' + px + '" aria-hidden="true" focusable="false">' +
      ART[key] +
      "</svg>"
    );
  }

  // What the gift tag on a full bag reads, a line at a time.
  var TAG_LINES = ["Packed", "with love"];

  // How many things may peek out of the top of a bag: more as it fills, three at most. A full bag is
  // tied and tagged, so nothing peeks from it.
  var MAX_PEEKS = 3;
  function peekCount(fill) {
    var f = Number(fill) || 0;
    if (f <= 0 || f >= 1) return 0;
    if (f < 0.25) return 1;
    return f < 0.5 ? 2 : 3;
  }

  /**
   * Which items peek out of the bag that is filling, as three places (an item's key, or null).
   * `previous` is what peeked before, `keys` the items in the bag with the newest first, `fill` how
   * full that bag is (0 to 1). Only things in the bag ever peek; what was peeking stays where it
   * was; a free place goes to the newest item not yet showing; an item taken out loses its peek.
   */
  function peekSlots(previous, keys, fill) {
    var inBag = (keys || []).filter(function (k) {
      return Object.prototype.hasOwnProperty.call(ART, k);
    });
    var allowed = peekCount(fill);
    var out = [];
    var shown = 0;
    var i;
    for (i = 0; i < MAX_PEEKS; i += 1) {
      var was = previous ? previous[i] : null;
      if (was && shown < allowed && inBag.indexOf(was) !== -1 && out.indexOf(was) === -1) {
        out.push(was);
        shown += 1;
      } else out.push(null);
    }
    for (i = 0; i < inBag.length && shown < allowed; i += 1) {
      if (out.indexOf(inBag[i]) !== -1) continue;
      out[out.indexOf(null)] = inBag[i];
      shown += 1;
    }
    return out;
  }

  /** The handles strain a touch when the bag is nearly full (as the status line says it is). */
  function strains(fill) {
    var f = Number(fill) || 0;
    return f >= 0.88 && f < 1;
  }

  /**
   * The milestone a change has just crossed on the way UP, in pence: half a bag (£25), then every
   * full bag. The highest one when several are passed at once. Nothing (0) on the way down or
   * standing still, so a milestone comes again only after the total has dropped below it.
   */
  function milestoneCrossed(beforePence, afterPence) {
    var before = Math.max(0, Math.floor(beforePence || 0));
    var after = Math.max(0, Math.floor(afterPence || 0));
    if (after <= before) return 0;
    var top = Math.floor(after / BAG_VALUE_PENCE) * BAG_VALUE_PENCE;
    if (top > before) return top;
    return before < HALF_BAG_PENCE && after >= HALF_BAG_PENCE ? HALF_BAG_PENCE : 0;
  }

  // The elf's notes: short lines scribbled on the paper beside the row just changed, as if an elf
  // were reading over the donor's shoulder. ALL of them are here, in this ONE list, so they are easy
  // to read through and change. The rules (test/unit/red-bag-delight.test.ts holds them):
  //   - never say anything is bought, or that a particular person receives it; never "will";
  //   - no pressure, no guilt, nobody ranked; kind when something is taken out;
  //   - no dashes or hyphens, British spelling, 32 characters at most so a note fits on one line.
  // In `several`, {n} is how many and {things} is the item's plural from `things`.
  var NOTES = {
    items: {
      blanket: ["Ooh, a blanket. Cosy.", "A blanket. A hug you can fold."],
      "insulated-cup": ["Tea that stays hot. Magic.", "A warm cup. Lovely."],
      "toiletry-set": ["Smelling lovely. Nice touch.", "A little bit of pampering."],
      toy: ["A toy! The elves are jealous.", "Playtime. Our favourite."],
      "soft-toy": ["Something to cuddle. Aww.", "Soft toys give great hugs."],
      headphones: ["Headphones. Tunes on!", "Music to our pointy ears."],
      book: ["A book! Elves love a story.", "Once upon a time..."],
      "colouring-book": ["Colouring in. Pure calm.", "Outside the lines? Go for it."],
      pencil: ["A pencil! Small but mighty.", "Sharp thinking."],
      notebook: ["A notebook. Big ideas welcome.", "Blank pages. Endless plans."],
      pyjamas: ["Pyjamas! Snug as a bug.", "Fresh jammies. The dream."],
      socks: ["Socks! A classic.", "Warm toes. Happy days."],
      "hat-gloves": ["Hat and gloves. Toasty!", "Wrapped up warm. Lovely."],
    },
    general: ["Lovely choice.", "Oh, nice one.", "The elves are impressed.", "You're good at this.", "That's the spirit.", "Elf approved."],
    first: ["And we're off! Great start.", "First thing in. Lovely.", "Here we go! Elves are cheering."],
    several: ["{n} {things}? You legend.", "{n} {things}! Brilliant.", "{n} {things}. What a pile!"],
    things: {
      blanket: "blankets",
      "insulated-cup": "cups",
      "toiletry-set": "gift sets",
      toy: "toys",
      "soft-toy": "soft toys",
      headphones: "headphones",
      book: "books",
      "colouring-book": "colouring books",
      pencil: "pencils",
      notebook: "notebooks",
      pyjamas: "pyjamas",
      socks: "pairs of socks",
      "hat-gloves": "hats and gloves",
    },
    out: ["No bother. Back on the shelf.", "Changed your mind? That's fine.", "Out it comes. No worries.", "Easy done. Your bag, your call."],
    example: ["That's a lovely one.", "A kind thought, that.", "All year round. Love that.", "Thoughtful. Elves noticed."],
  };

  function several(template, key, n) {
    return template.replace("{n}", String(n)).replace("{things}", NOTES.things[key] || "of those");
  }

  /**
   * What kind of note a change earns. A change is { kind: "in" | "out" | "example", key, quantity
   * (what the item is at now), step (how many it went up by), first (the bag was empty before) }.
   * "several" is a typed jump to three or more, or reaching 3, 5, 10, 15 and so on one at a time.
   */
  function noteKind(change) {
    if (!change) return "";
    if (change.kind === "out") return "out";
    if (change.kind === "example") return "example";
    if (change.kind !== "in") return "";
    if (change.first) return "first";
    var q = change.quantity || 0;
    var step = change.step || 1;
    if (q >= 3 && NOTES.things[change.key] && (step > 1 || q === 3 || q % 5 === 0)) return "several";
    return "item";
  }

  /**
   * The note for a change. `last` is the note shown before, which is never chosen again straight
   * away; `roll` is a number from 0 to 1 that picks among the alternatives (the page passes a
   * random one, so this stays a pure function). An empty string for a change it does not know.
   */
  function noteFor(change, last, roll) {
    var kind = noteKind(change);
    if (!kind) return "";
    var r = Number(roll) || 0;
    r = r < 0 ? 0 : r >= 1 ? 0.999999 : r;
    var list;
    if (kind === "several") {
      list = NOTES.several.map(function (t) {
        return several(t, change.key, change.quantity);
      });
    } else if (kind === "item") {
      // Mostly about the item itself; something general now and then.
      var own = NOTES.items[change.key] || [];
      if (own.length && r < 0.7) {
        list = own;
        r = r / 0.7;
      } else {
        list = NOTES.general;
        r = own.length ? (r - 0.7) / 0.3 : r;
      }
    } else list = NOTES[kind];
    var pool = list.filter(function (n) {
      return n !== last;
    });
    if (!pool.length) pool = list;
    return pool[Math.min(pool.length - 1, Math.floor(r * pool.length))] || "";
  }

  /** Every note that can ever be shown, the "several" ones written out for each item (3 and 99). */
  function allNotes() {
    var out = [];
    Object.keys(NOTES.items).forEach(function (k) {
      out = out.concat(NOTES.items[k]);
    });
    out = out.concat(NOTES.general, NOTES.first, NOTES.out, NOTES.example);
    Object.keys(NOTES.things).forEach(function (k) {
      NOTES.several.forEach(function (t) {
        out.push(several(t, k, 3));
        out.push(several(t, k, 99));
      });
    });
    return out;
  }

  var api = {
    ART: ART,
    art: art,
    TAG_LINES: TAG_LINES,
    MAX_PEEKS: MAX_PEEKS,
    peekCount: peekCount,
    peekSlots: peekSlots,
    strains: strains,
    milestoneCrossed: milestoneCrossed,
    NOTES: NOTES,
    noteKind: noteKind,
    noteFor: noteFor,
    allNotes: allNotes,
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
