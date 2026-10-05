// Fill a Red Bag: the list staff can edit (5 October 2026), and its rules.
//
// Staff change the items, their prices and the "Whenever the need comes" examples in the admin
// (Admin > Fill a Red Bag): they save a draft, look at it on the real page, and publish it. This
// file is the ONE place the rules for such a list live:
//   - what a list holds, and the list written in the catalogue as one (builtIn);
//   - what it may hold (validate): the server checks every save and every publish with it
//     (src/red-bag/list.ts reads this very file), and the admin screen checks as staff type;
//   - what differs between the website's list and the draft, in plain words (diff);
//   - the list as the page's catalogue reads it (toCatalogue).
//
// A list is { v: 1, items: [...], examples: [...] }:
//   an item     { key, name, pence, group, art, hidden }    group: one of the four headings' keys
//   an example  { key, theme, pence, words, art, hidden }   theme: one of the three themes' keys
// Their order in the list is their order on the page, under each heading and each theme. `art` is
// the key of one of the catalogue's drawings. `words` follows the amount and always begins "could
// help": the page writes "£30 could help with fresh bedding for a child".
//
// What staff can NOT change is simply not in a list: the four headings, the three themes and their
// one-line descriptions, the £50 bag, the £2 minimum, the elf's notes and the drawings themselves.
//
// No DOM, no clock: data and pure functions. A classic script, exported under a CommonJS guard so
// the server and the unit tests can load it. In the browser it needs the catalogue loaded first.
(function () {
  "use strict";

  var RB = typeof module !== "undefined" && module.exports ? require("./red-bag-catalogue.js") : window.NBCCRedBag;

  var LIMITS = {
    ITEM_MIN_PENCE: 10,
    ITEM_MAX_PENCE: 50000,
    EXAMPLE_MIN_PENCE: 100,
    EXAMPLE_MAX_PENCE: 100000,
    NAME_MAX: 40,
    WORDS_MAX: 90, // what staff type, after "could help"
    MAX_ITEMS: 30,
    MAX_EXAMPLES_PER_THEME: 6,
  };
  // The picture for anything with no drawing of its own.
  var PRESENT = "present";
  // What every example begins with. Staff never type it: the editor writes it for them.
  var COULD_HELP = "could help ";
  // A new item's or example's key: "n-", then letters, numbers and single hyphens. No key the
  // catalogue was written with starts that way (test/unit/red-bag-list.test.ts holds that), so a
  // new one can never be taken for a built-in item, a drawing or an elf's note.
  var NEW_KEY_RE = /^n-[a-z0-9]+(-[a-z0-9]+)*$/;
  var KEY_MAX = 48;

  var MESSAGES = {
    price: "A price must be between 10p and £500.",
    amount: "An amount must be between £1 and £1,000.",
    nameEmpty: "Give this item a name.",
    nameLong: "A name can be 40 characters at most.",
    plain: "Leave out < and > and anything that is not plain text.",
    will: 'Say "could", never "will": these are examples, not promises.',
    buy: 'Leave out "buy", "buys" and "bought": nothing is bought item by item.',
    dash: "Use a comma or a full stop, not a long dash.",
    couldHelp: 'An example must read "could help" and then what with.',
    wordsEmpty: "Say what it could help with.",
    wordsLong: "This can be 90 characters at most.",
    sameName: "Two items showing cannot have the same name.",
    noneShowing: "At least one item must be showing.",
    tooMany: "The list can have 30 items at most.",
    tooManyExamples: "A theme can have 6 examples at most.",
    // Something no screen of ours could have sent: a key, a heading or a picture that does not exist.
    broken: "Something in the list is not right. Reload the page and try again.",
  };

  function has(o, k) {
    return Object.prototype.hasOwnProperty.call(o, k);
  }
  function groups() {
    return RB.BUILT_IN.groups;
  }
  function themes() {
    return RB.BUILT_IN.themes;
  }
  function groupKeys() {
    return groups().map(function (g) {
      return g.key;
    });
  }
  function themeKeys() {
    return themes().map(function (t) {
      return t.key;
    });
  }
  function headingOf(key) {
    var found = "";
    groups().forEach(function (g) {
      if (g.key === key) found = g.heading;
    });
    return found;
  }
  function titleOf(key) {
    var found = "";
    themes().forEach(function (t) {
      if (t.key === key) found = t.title;
    });
    return found;
  }
  /** Every drawing a picture can be chosen from: the catalogue's, the present among them. */
  function artKeys() {
    return Object.keys(RB.ART);
  }

  /** The list written in the catalogue, as a list staff can edit. A fresh copy every time. */
  function builtIn() {
    var items = [];
    var examples = [];
    groups().forEach(function (g) {
      g.items.forEach(function (i) {
        items.push({ key: i.key, name: i.name, pence: i.pence, group: g.key, art: has(RB.ART, i.key) ? i.key : PRESENT, hidden: false });
      });
    });
    themes().forEach(function (t) {
      t.examples.forEach(function (e) {
        examples.push({ key: e.key, theme: t.key, pence: e.pence, words: e.words, art: has(RB.ART, e.key) ? e.key : PRESENT, hidden: false });
      });
    });
    return { v: 1, items: items, examples: examples };
  }

  // Which built-in key is what: { key: "item" } or { key: the example's theme }.
  function builtInKinds() {
    var kinds = {};
    groups().forEach(function (g) {
      g.items.forEach(function (i) {
        kinds[i.key] = { kind: "item" };
      });
    });
    themes().forEach(function (t) {
      t.examples.forEach(function (e) {
        kinds[e.key] = { kind: "example", theme: t.key };
      });
    });
    return kinds;
  }

  /** Text as it is kept: the spaces round it gone, and every run of space inside it made one. */
  function tidy(value) {
    return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : value;
  }

  /**
   * What was sent, as a list and nothing more: only the fields a list holds, names and words
   * tidied, `hidden` plainly true or false. Null if it is not the shape of a list at all. It does
   * not judge the values: validate does.
   */
  function clean(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || !Array.isArray(raw.items) || !Array.isArray(raw.examples)) return null;
    var bad = false;
    var items = raw.items.map(function (i) {
      if (!i || typeof i !== "object" || Array.isArray(i)) {
        bad = true;
        return null;
      }
      return { key: i.key, name: tidy(i.name), pence: i.pence, group: i.group, art: i.art, hidden: i.hidden === true };
    });
    var examples = raw.examples.map(function (e) {
      if (!e || typeof e !== "object" || Array.isArray(e)) {
        bad = true;
        return null;
      }
      return { key: e.key, theme: e.theme, pence: e.pence, words: tidy(e.words), art: e.art, hidden: e.hidden === true };
    });
    return bad ? null : { v: 1, items: items, examples: examples };
  }

  /** Are two lists the same list? */
  function same(a, b) {
    var x = clean(a);
    var y = clean(b);
    return !!x && !!y && JSON.stringify(x) === JSON.stringify(y);
  }

  /**
   * The wording rules every name and example keeps, in ONE place (the public page's own tests hold
   * its fixed words to the same): never "will", never "buy", "buys", "bought" or "buying", and no
   * en or em dash. The message for the first one broken, or "".
   */
  function wordingProblem(text) {
    var t = String(text === undefined || text === null ? "" : text);
    if (/\bwill\b/i.test(t)) return MESSAGES.will;
    if (/\b(buy|buys|buying|bought)\b/i.test(t)) return MESSAGES.buy;
    if (/[\u2013\u2014]/.test(t)) return MESSAGES.dash;
    return "";
  }
  function isPlain(text) {
    // eslint-disable-next-line no-control-regex
    return !/[<>\u0000-\u001f\u007f-\u009f]/.test(text);
  }
  function wholePence(n, min, max) {
    return typeof n === "number" && isFinite(n) && Math.floor(n) === n && n >= min && n <= max;
  }

  /** What is wrong with an item's name, or "". */
  function nameProblem(name) {
    var n = tidy(name);
    if (typeof n !== "string" || !n) return MESSAGES.nameEmpty;
    if (n.length > LIMITS.NAME_MAX) return MESSAGES.nameLong;
    if (!isPlain(n)) return MESSAGES.plain;
    return wordingProblem(n);
  }
  /** What is wrong with an example's words ("could help ..."), or "". */
  function wordsProblem(words) {
    var w = tidy(words);
    if (typeof w !== "string") return MESSAGES.couldHelp;
    if (w === COULD_HELP.trim()) return MESSAGES.wordsEmpty;
    if (w.indexOf(COULD_HELP) !== 0) return MESSAGES.couldHelp;
    if (w.length - COULD_HELP.length > LIMITS.WORDS_MAX) return MESSAGES.wordsLong;
    if (!isPlain(w)) return MESSAGES.plain;
    return wordingProblem(w);
  }
  function priceProblem(pence) {
    return wholePence(pence, LIMITS.ITEM_MIN_PENCE, LIMITS.ITEM_MAX_PENCE) ? "" : MESSAGES.price;
  }
  function amountProblem(pence) {
    return wholePence(pence, LIMITS.EXAMPLE_MIN_PENCE, LIMITS.EXAMPLE_MAX_PENCE) ? "" : MESSAGES.amount;
  }

  /**
   * Everything wrong with a list, in the list's order: [{ kind: "item" | "example" | "list", key,
   * field, message }]. Empty means it may be saved and published. A list that is broken in a way
   * no screen could have made it (a key, heading or picture that does not exist, the same key
   * twice) gets the one `broken` message and nothing else.
   */
  function validate(raw) {
    var list = clean(raw);
    var broken = [{ kind: "list", key: "", field: "", message: MESSAGES.broken }];
    if (!list) return broken;
    var kinds = builtInKinds();
    var gKeys = groupKeys();
    var tKeys = themeKeys();
    var arts = artKeys();
    var seen = {};
    var sound = true;
    function keyFor(x, kind, theme) {
      if (typeof x.key !== "string" || x.key.length > KEY_MAX || has(seen, x.key)) return false;
      seen[x.key] = true;
      if (has(kinds, x.key)) return kinds[x.key].kind === kind && (kind === "item" || kinds[x.key].theme === theme);
      return NEW_KEY_RE.test(x.key);
    }
    list.items.forEach(function (i) {
      if (!keyFor(i, "item") || gKeys.indexOf(i.group) === -1 || typeof i.art !== "string" || arts.indexOf(i.art) === -1) sound = false;
    });
    list.examples.forEach(function (e) {
      if (tKeys.indexOf(e.theme) === -1 || !keyFor(e, "example", e.theme) || typeof e.art !== "string" || arts.indexOf(e.art) === -1) sound = false;
    });
    if (!sound) return broken;

    var out = [];
    function say(kind, key, field, message) {
      if (message) out.push({ kind: kind, key: key, field: field, message: message });
    }
    var names = {};
    var showing = 0;
    list.items.forEach(function (i) {
      var n = nameProblem(i.name);
      say("item", i.key, "name", n);
      say("item", i.key, "pence", priceProblem(i.pence));
      if (i.hidden) return;
      showing += 1;
      if (n) return;
      var as = i.name.toLowerCase();
      if (has(names, as)) say("item", i.key, "name", MESSAGES.sameName);
      names[as] = true;
    });
    list.examples.forEach(function (e) {
      say("example", e.key, "pence", amountProblem(e.pence));
      say("example", e.key, "words", wordsProblem(e.words));
    });
    if (list.items.length > LIMITS.MAX_ITEMS) say("list", "", "items", MESSAGES.tooMany);
    else if (!showing) say("list", "", "items", MESSAGES.noneShowing);
    tKeys.forEach(function (t) {
      var n = list.examples.filter(function (e) {
        return e.theme === t;
      }).length;
      if (n > LIMITS.MAX_EXAMPLES_PER_THEME) say("list", t, "examples", MESSAGES.tooManyExamples);
    });
    return out;
  }

  /**
   * A key for something new, from its name: "n-selection-box-k3x9a". Never one in `taken`. `random`
   * is Math.random unless a test hands in its own.
   */
  function newKey(name, taken, random) {
    var roll = typeof random === "function" ? random : Math.random;
    var slug = String(name || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24)
      .replace(/-+$/g, "");
    if (!slug) slug = "item";
    var used = taken || [];
    for (var tries = 0; tries < 50; tries += 1) {
      var tail = "";
      for (var i = 0; i < 5; i += 1) tail += "abcdefghijklmnopqrstuvwxyz0123456789".charAt(Math.floor(roll() * 36) % 36);
      var key = "n-" + slug + "-" + tail;
      if (used.indexOf(key) === -1) return key;
    }
    return "n-" + slug + "-" + String(used.length) + "x" + String(Date.now ? Date.now() % 100000 : 0);
  }

  /** Pounds as typed, in pence: "£12", "12", "12.5", "0.10", "10p", "1,000". Null for anything else. */
  function parsePounds(typed) {
    var t = String(typed === undefined || typed === null ? "" : typed).replace(/[£,\s]/g, "");
    var m = /^(\d{1,7})p$/i.exec(t);
    if (m) return Number(m[1]);
    m = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(t);
    if (!m) return null;
    var pence = m[2] ? (m[2].length === 1 ? Number(m[2]) * 10 : Number(m[2])) : 0;
    return Number(m[1]) * 100 + pence;
  }
  /** Pence as its box shows it, in pounds: 12, 12.50, 0.10. */
  function poundsBox(pence) {
    var p = Math.max(0, Math.floor(Number(pence) || 0));
    var rest = p % 100;
    return String(Math.floor(p / 100)) + (rest ? "." + (rest < 10 ? "0" : "") + rest : "");
  }

  /** An example as the page says it: "£30 could help with fresh bedding for a child". */
  function sentence(e) {
    return RB.pounds(e.pence) + " " + e.words;
  }

  var ARROW = " \u2192 ";

  function byKey(list) {
    var map = {};
    list.forEach(function (x) {
      map[x.key] = x;
    });
    return map;
  }
  // The keys both lists hold under the same heading (or theme), in each list's order.
  function orderChanged(was, now, field, value) {
    var a = byKey(was);
    var b = byKey(now);
    function common(list, other) {
      return list
        .filter(function (x) {
          return x[field] === value && has(other, x.key) && other[x.key][field] === value;
        })
        .map(function (x) {
          return x.key;
        });
    }
    return common(was, b).join("|") !== common(now, a).join("|");
  }

  /**
   * What differs between the website's list and the draft, in plain words: [{ kind, text }], the
   * items first, then the examples, each in the draft's order. Empty when they say the same.
   */
  function diff(website, draft) {
    var was = clean(website) || builtIn();
    var now = clean(draft) || was;
    var out = [];
    function say(kind, text) {
      out.push({ kind: kind, text: text });
    }
    var before = byKey(was.items);
    var after = byKey(now.items);
    now.items.forEach(function (i) {
      var w = has(before, i.key) ? before[i.key] : null;
      if (!w) return say("new", (i.hidden ? "New, hidden for now: " : "New: ") + i.name + " " + RB.pounds(i.pence));
      if (w.name !== i.name) say("renamed", "Renamed: " + w.name + ARROW + i.name);
      if (w.pence !== i.pence) say("price", i.name + " " + RB.pounds(w.pence) + ARROW + RB.pounds(i.pence));
      if (w.group !== i.group) say("moved", "Moved: " + i.name + ", from " + headingOf(w.group) + " to " + headingOf(i.group));
      if (w.hidden !== i.hidden) say(i.hidden ? "hidden" : "shown", (i.hidden ? "Hidden: " : "Shown again: ") + i.name);
      if (w.art !== i.art) say("picture", "Picture changed: " + i.name);
    });
    was.items.forEach(function (w) {
      if (!has(after, w.key)) say("removed", "Removed: " + w.name);
    });
    groupKeys().forEach(function (g) {
      if (orderChanged(was.items, now.items, "group", g)) say("order", "Order changed: " + headingOf(g));
    });

    var exBefore = byKey(was.examples);
    var exAfter = byKey(now.examples);
    now.examples.forEach(function (e) {
      var w = has(exBefore, e.key) ? exBefore[e.key] : null;
      if (!w) return say("example-new", (e.hidden ? "New example, hidden for now: " : "New example: ") + sentence(e));
      if (w.pence !== e.pence || w.words !== e.words) say("example-changed", "Example changed: " + sentence(w) + ARROW + sentence(e));
      if (w.hidden !== e.hidden) say(e.hidden ? "example-hidden" : "example-shown", (e.hidden ? "Example hidden: " : "Example shown again: ") + sentence(e));
      if (w.art !== e.art) say("example-picture", "Example picture changed: " + sentence(e));
    });
    was.examples.forEach(function (w) {
      if (!has(exAfter, w.key)) say("example-removed", "Example removed: " + sentence(w));
    });
    themeKeys().forEach(function (t) {
      if (orderChanged(was.examples, now.examples, "theme", t)) say("example-order", "Example order changed: " + titleOf(t));
    });
    return out;
  }

  /** The count above the differences. */
  function countLine(n) {
    if (!n) return "No changes. This is what the website shows now.";
    return n === 1 ? "1 change not yet on the website" : n + " changes not yet on the website";
  }
  /** "1 change", "3 changes". */
  function changesWords(n) {
    return n === 1 ? "1 change" : n + " changes";
  }

  /** One line for the history: the first three differences, and how many more. */
  function summary(lines) {
    var texts = (lines || []).map(function (l) {
      return l.text;
    });
    if (!texts.length) return "No changes";
    if (texts.length <= 3) return texts.join("; ");
    return texts.slice(0, 3).join("; ") + "; and " + (texts.length - 3) + " more";
  }

  /**
   * The list as the page's catalogue reads it (its useList, and the block of data the server draws
   * into the page): what is showing only, under each of the four headings and three themes, in
   * order. A heading or a theme with nothing showing is there but empty; the page leaves it out.
   */
  function toCatalogue(list) {
    var l = clean(list) || builtIn();
    return {
      groups: groups().map(function (g) {
        return {
          key: g.key,
          items: l.items
            .filter(function (i) {
              return i.group === g.key && !i.hidden;
            })
            .map(function (i) {
              return { key: i.key, name: i.name, pence: i.pence, art: i.art };
            }),
        };
      }),
      themes: themes().map(function (t) {
        return {
          key: t.key,
          examples: l.examples
            .filter(function (e) {
              return e.theme === t.key && !e.hidden;
            })
            .map(function (e) {
              return { key: e.key, pence: e.pence, words: e.words, art: e.art };
            }),
        };
      }),
    };
  }

  var api = {
    LIMITS: LIMITS,
    PRESENT: PRESENT,
    COULD_HELP: COULD_HELP,
    MESSAGES: MESSAGES,
    groups: groups,
    themes: themes,
    headingOf: headingOf,
    titleOf: titleOf,
    artKeys: artKeys,
    builtIn: builtIn,
    clean: clean,
    same: same,
    wordingProblem: wordingProblem,
    nameProblem: nameProblem,
    wordsProblem: wordsProblem,
    priceProblem: priceProblem,
    amountProblem: amountProblem,
    validate: validate,
    newKey: newKey,
    parsePounds: parsePounds,
    poundsBox: poundsBox,
    sentence: sentence,
    diff: diff,
    countLine: countLine,
    changesWords: changesWords,
    summary: summary,
    toCatalogue: toCatalogue,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else window.NBCCRedBagList = api;
})();
