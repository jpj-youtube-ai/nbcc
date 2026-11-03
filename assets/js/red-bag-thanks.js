// Fill a Red Bag: the thank you page, /fill/thank-you (fill-thank-you.html;
// docs/superpowers/specs/2026-10-04-fill-a-red-bag-design.md).
//
// Stripe brings the donor back here. The page is drawn by the server and reads as a plain thank you
// without this file. This:
//   - shows the total this tab remembered before leaving for Stripe (assets/js/red-bag.js left it
//     in sessionStorage), "every month" for a monthly donation, and the Gift Aid line when Gift Aid
//     was added. For show only: the server never trusts it. Missing or odd, the plain line stays;
//   - takes the payment's id out of the address bar at once;
//   - lands the focus on the heading;
//   - makes the picture to share, "I filled a Red Bag", which names no amount.
//
// And the feel good pieces (5 October 2026), each behind a guard so that none of them can stop the
// thank you above from working:
//   - the Elves' Workshop scene in place of the still bag (assets/js/red-bag-workshop.js draws and
//     plays it; if that file is missing or breaks, the still bag stays);
//   - a name for the picture, "Fern filled a Red Bag". What is typed NEVER leaves the browser: the
//     box belongs to no form, and nothing here makes a request. Because the picture carries NBCC's
//     name, the name is screened against the supporter wall's own list, which the server draws into
//     the page (src/donors/display-name-filter.ts); with no list, the box is put away;
//   - a certificate to print, with that name, what for and the date, and never an amount.
//
// Its own small file, so the thank you does not load the giving page's script. A classic
// <script defer>, exported under a CommonJS guard so it can be unit tested in jsdom.
(function () {
  "use strict";

  // What the giving page left in this tab's memory. Display only.
  var GIFT_KEY = "nbcc_red_bag_gift";
  // The most a remembered total may be and still be shown: £100,000. The figure is only what the
  // tab kept, for show; anything above this is not believed, and the plain thank you stays.
  var MAX_SHOWN_PENCE = 10000000;
  // The giving page's public address, for sharing.
  var PAGE_URL = "https://nbcc.scot/fill";

  function each(list, fn) {
    Array.prototype.forEach.call(list, fn);
  }

  function setText(el, words) {
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

  // How many Red Bags the gift filled: one for each full bag's worth of what the tab remembered
  // (the bag's total, before any card fee: assets/js/red-bag.js keeps exactly that), and never fewer
  // than one. One, too, when nothing believable was remembered. For the words and the shelf only.
  function believed(gift, rb) {
    return !!gift && typeof gift.pence === "number" && isFinite(gift.pence) && gift.pence >= rb.MIN_PENCE && gift.pence <= MAX_SHOWN_PENCE && Math.floor(gift.pence) === gift.pence;
  }
  function bagsFilled(gift, rb) {
    var worth = rb && rb.BAG_VALUE_PENCE;
    if (!rb || !believed(gift, rb) || !(worth > 0)) return 1;
    return Math.max(1, Math.floor(gift.pence / worth));
  }

  // --- a name for the picture and the certificate ---------------------------------------------------
  // Up to 30 characters: letters, numbers, spaces and plain punctuation. Anything else is dropped.
  var NAME_MAX = 30;
  var NOT_KEPT;
  try {
    // Letters with the marks they are built from (so Hindi, Bengali, Tamil, Thai and an accent
    // typed as a separate mark all stay whole), and numbers.
    NOT_KEPT = new RegExp("[^\\p{L}\\p{M}\\p{N} '\u2019.,&!-]", "gu");
  } catch (e) {
    NOT_KEPT = /[^A-Za-z0-9\u00C0-\u024F\u0300-\u036F '\u2019.,&!-]/g;
  }
  /** Whole characters, never half of one (a letter outside the first plane is two units). */
  function chars(s) {
    return typeof Array.from === "function" ? Array.from(s) : s.split("");
  }
  /** What is typed, without what a name may not have. Spaces stay, so a second word can be typed. */
  function keepChars(raw) {
    return String(raw == null ? "" : raw)
      .replace(/\s/g, " ")
      .replace(NOT_KEPT, "");
  }
  /** The name as it is shown: trimmed, runs of spaces closed up, 30 characters at most. */
  function cleanName(raw) {
    return chars(keepChars(raw).replace(/ +/g, " ").trim()).slice(0, NAME_MAX).join("").trim();
  }

  /**
   * Is this name one NBCC would not put its own name beside? The supporter wall's rule
   * (containsBlockedWord, src/donors/display-name-filter.ts), with its lists as the server drew
   * them into the page: whole words, and a very few that are refused anywhere in the letters.
   * With no lists it answers yes: closed, not open.
   */
  function nameBlocked(name, lists) {
    if (!lists || !Array.isArray(lists.words) || !Array.isArray(lists.inside)) return true;
    var lower = String(name || "").toLowerCase();
    if (!lower) return false;
    var tokens = lower.split(/[^a-z]+/);
    var i;
    for (i = 0; i < lists.words.length; i += 1) if (tokens.indexOf(lists.words[i]) !== -1) return true;
    var letters = lower.replace(/[^a-z]/g, "");
    for (i = 0; i < lists.inside.length; i += 1) if (lists.inside[i] && letters.indexOf(lists.inside[i]) !== -1) return true;
    return false;
  }

  /** The words across the picture. With no name it is the plain one, however many bags. */
  function pictureHeadline(name, bags) {
    return name ? name + " " + filledWords(bags) : "I filled a Red Bag";
  }
  function filledWords(bags) {
    return bags >= 2 ? "filled " + bags + " Red Bags" : "filled a Red Bag";
  }
  /** The certificate's "what for". Never an amount. */
  function certificateFor(bags) {
    return bags >= 2 ? "for filling " + bags + " Red Bags Full of Joy" : "for filling a Red Bag Full of Joy";
  }
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  /** "5 October 2026", as the site's printed pieces write a date. */
  function longDate(d) {
    return d.getDate() + " " + MONTHS[d.getMonth()] + " " + d.getFullYear();
  }

  function storage(win) {
    try {
      return win.sessionStorage || null;
    } catch (e) {
      return null;
    }
  }

  // The payment's id (session_id, which Stripe filled in) comes straight out of the address bar, so
  // it is never copied, shared, bookmarked or kept in the history. The total is what this tab
  // remembered before leaving for Stripe; missing or odd, the plain thank you stays.
  function initThanks(doc, win) {
    var rb = win && win.NBCCRedBag;
    var thanks = doc.querySelector("[data-rb-thanks]");
    if (!rb || !thanks) return null;
    var loc = win.location || {};
    if (/[?&](session_id|thanks)=/.test(String(loc.search || "")) && win.history && typeof win.history.replaceState === "function") {
      try {
        win.history.replaceState(null, "", loc.pathname);
      } catch (e) {
        /* the address stays as it is */
      }
    }
    var gift = null;
    var s = storage(win);
    if (s) {
      try {
        gift = JSON.parse(s.getItem(GIFT_KEY) || "null");
        s.removeItem(GIFT_KEY);
      } catch (e) {
        gift = null;
      }
    }
    var ok = believed(gift, rb);
    var totalLine = thanks.querySelector("[data-rb-thanks-total]");
    var plain = thanks.querySelector("[data-rb-thanks-plain]");
    var aid = thanks.querySelector("[data-rb-thanks-giftaid]");
    if (ok && totalLine) {
      setText(thanks.querySelector("[data-rb-thanks-amount]"), rb.pounds(gift.pence) + (gift.monthly ? " every month" : ""));
      totalLine.hidden = false;
      if (plain) plain.hidden = true;
      if (aid && gift.giftAid === true) {
        setText(thanks.querySelector("[data-rb-thanks-giftaid-amount]"), rb.pounds(Math.round(gift.pence * 0.25)));
        aid.hidden = false;
      }
    }
    each(thanks.querySelectorAll(".rb-bag"), function (b) {
      b.classList.add("is-full");
    });
    // The page's one big heading is the thank you: the focus lands there on arrival.
    focusOn(doc.getElementById("rb-thanks-title"));

    // The feel good pieces. Each goes through safe(): whatever goes wrong in one is swallowed, said
    // once in the console, and everything above and the share below carry on untouched.
    var said = false;
    function safe(fn) {
      return function () {
        try {
          return fn.apply(null, arguments);
        } catch (e) {
          if (!said && typeof console !== "undefined" && console && typeof console.error === "function") {
            said = true;
            console.error("Fill a Red Bag: a part of the thank you failed and was skipped.", e);
          }
          return undefined;
        }
      };
    }
    // What the pieces share: the bags filled, the name as it may be shown, and how to redraw.
    var st = {
      bags: bagsFilled(ok ? gift : null, rb),
      name: "",
      redraw: function () {},
      changed: [],
    };
    safe(showWorkshop)(doc, win, thanks, { count: st.bags, play: !!ok });
    var named = safe(initName)(doc, win, st);
    safe(sayWhatItShows)(doc, st);
    initShare(doc, win, doc, st);
    if (named) safe(initCertificate)(doc, win, st, named);
    return thanks;
  }

  // --- the Workshop scene, in place of the still bag ---------------------------------------------------
  // Drawn and played by assets/js/red-bag-workshop.js. Without it, the still bag stays.
  function showWorkshop(doc, win, thanks, opts) {
    var shop = win.NBCCRedBagWorkshop;
    var box = thanks.querySelector("[data-rb-workshop]");
    if (!box || !shop || typeof shop.mount !== "function") return false;
    try {
      return shop.mount(box, { count: opts.count, play: opts.play, win: win, art: win.NBCCRedBag && win.NBCCRedBag.art });
    } catch (e) {
      // Half drawn is worse than not drawn: back to the still bag, then say so once.
      var holder = box.querySelector("[data-rb-workshop-scene]");
      var still = box.querySelector(".rb-thanks__bag");
      if (holder) {
        holder.hidden = true;
        holder.innerHTML = "";
      }
      if (still) still.hidden = false;
      box.classList.remove("is-playing");
      throw e;
    }
  }

  // --- the name box --------------------------------------------------------------------------------------
  // Shown only when the filter's lists are in the page. Returns what the certificate needs from it.
  function initName(doc, win, st) {
    var box = doc.querySelector("[data-rb-name]");
    var input = box ? box.querySelector("input") : null;
    var holder = box ? box.querySelector("[data-rb-name-filter]") : null;
    if (!box || !input || !holder) return null;
    // The lists come as base64 of their JSON (src/red-bag/render.ts), so the page's source does not
    // show the words. Missing or not readable: no lists, and the box stays put away.
    var lists = null;
    try {
      var decode = typeof win.atob === "function" ? win.atob : atob;
      lists = JSON.parse(decode(String(holder.textContent || "").replace(/\s+/g, "")));
    } catch (e) {
      lists = null;
    }
    if (nameBlocked("a", lists)) return null; // no list: closed
    var error = box.querySelector("[data-rb-name-error]");
    var blocked = false;

    // The refusal describes the box only while a name is refused: on a good name a screen reader
    // hears the hint alone.
    var hintId = (input.getAttribute("aria-describedby") || "").split(/\s+/)[0];
    function read(e) {
      // A letter still being put together (an accent, or a keyboard that composes): leave it be.
      // compositionend reads it once it is whole.
      if (e && e.type === "input" && e.isComposing) return;
      var typed = input.value;
      // What is kept, and no more than 30 whole characters of it (the box has no limit of its own:
      // that would count half characters).
      var kept = chars(keepChars(typed)).slice(0, NAME_MAX).join("");
      if (kept !== typed) {
        // Something typed is not kept. Put the caret back where it was, not at the end.
        var caret = null;
        try {
          caret = input.selectionStart;
        } catch (err) {
          caret = null;
        }
        input.value = kept;
        if (typeof caret === "number") {
          var at = keepChars(typed.slice(0, caret)).length;
          try {
            input.setSelectionRange(at, at);
          } catch (err) {
            /* the caret stays where the browser put it */
          }
        }
      }
      var name = cleanName(kept);
      blocked = nameBlocked(name, lists);
      st.name = blocked ? "" : name;
      if (error) error.hidden = !blocked;
      if (blocked) input.setAttribute("aria-invalid", "true");
      else input.removeAttribute("aria-invalid");
      var described = blocked && error && error.id ? [hintId, error.id] : [hintId];
      input.setAttribute("aria-describedby", described.filter(Boolean).join(" "));
      st.redraw();
      each(st.changed, function (fn) {
        fn();
      });
    }
    input.addEventListener("input", read);
    input.addEventListener("compositionend", read);
    box.hidden = false;
    return {
      input: input,
      isBlocked: function () {
        return blocked;
      },
    };
  }

  // --- what the picture shows, said honestly ---------------------------------------------------------------
  // The page says "only that you filled a Red Bag". While the picture itself says how many bags
  // (a name, and two bags or more), the sentence says so. Never an amount either way.
  function sayWhatItShows(doc, st) {
    var note = doc.querySelector("[data-rb-share-note]");
    if (!note) return;
    function say() {
      // The picture counts the bags only beside a name ("Fern filled 2 Red Bags").
      setText(note, st.name && st.bags >= 2 ? "It shows no amount, only how many bags you filled." : "It shows no amount, only that you filled a Red Bag.");
    }
    st.changed.push(say);
    say();
  }

  // --- the certificate to print ---------------------------------------------------------------------------
  // The page's own hidden certificate (fill-thank-you.html), filled in and printed by the browser:
  // while <html> carries rb-print-cert, the print stylesheet shows the certificate alone on one A4
  // sheet. No file is made and nothing is sent.
  var PRINT_CLASS = "rb-print-cert";
  // The paper for the certificate: A4, upright, no margin (the certificate draws its own white
  // edge, and with no margin the browser has no room for its own header and footer). An ordinary
  // @page rule, which every browser that honours @page understands, put in the page only while the
  // certificate prints so that an ordinary print of the page keeps the browser's own margins. The
  // certificate sizes itself to whatever page it is given, so it is one page even where this rule
  // is ignored.
  var PAGE_RULE = "@page{size:A4 portrait;margin:0}";
  // How long after the button a "before print" is taken to be the button's own. It only tells the
  // button's print from a later ordinary one; it never takes the mark away.
  var OWN_PRINT_MS = 2000;
  // Names longer than these are set smaller, so the certificate is always one page.
  var LONG_NAME = 16;
  var LONGER_NAME = 24;
  function initCertificate(doc, win, st, named) {
    var ask = doc.querySelector("[data-rb-cert-ask]");
    var button = ask ? ask.querySelector("[data-rb-cert-print]") : null;
    var cert = doc.querySelector("[data-rb-cert]");
    if (!ask || !button || !cert || typeof win.print !== "function") return null;
    var status = ask.querySelector("[data-rb-cert-status]");
    var root = doc.documentElement;

    // A tied bag on it, where the Workshop's drawing is there to borrow.
    var shop = win.NBCCRedBagWorkshop;
    var bag = cert.querySelector("[data-rb-cert-bag]");
    if (bag && shop && typeof shop.bagPicture === "function") {
      try {
        bag.innerHTML = shop.bagPicture();
      } catch (e) {
        bag.innerHTML = "";
      }
    }

    st.changed.push(function () {
      setText(status, "");
    });
    button.addEventListener("click", function () {
      if (named.isBlocked()) {
        focusOn(named.input);
        return;
      }
      if (!st.name) {
        setText(status, "Add a name above first, and it goes on your certificate.");
        focusOn(named.input);
        return;
      }
      setText(status, "");
      var nameEl = cert.querySelector("[data-rb-cert-name]");
      setText(nameEl, st.name);
      if (nameEl) {
        var length = chars(st.name).length;
        nameEl.classList[length > LONG_NAME ? "add" : "remove"]("is-long");
        nameEl.classList[length > LONGER_NAME ? "add" : "remove"]("is-longer");
      }
      setText(cert.querySelector("[data-rb-cert-for]"), certificateFor(st.bags));
      setText(cert.querySelector("[data-rb-cert-date]"), longDate(new Date()));
      mark();
      // This print is the button's own. Some browsers say "before print" inside print(), some a
      // moment after it has come back; either way that one is not an ordinary print.
      own = true;
      if (ownTimer !== null && typeof win.clearTimeout === "function") win.clearTimeout(ownTimer);
      ownTimer = typeof win.setTimeout === "function" ? win.setTimeout(disown, OWN_PRINT_MS) : null;
      opening = true;
      try {
        win.print();
      } finally {
        opening = false;
      }
    });

    // The mark (and the paper rule with it) stays for as long as the print window may be open: no
    // clock takes it away, because on a phone print() comes straight back while the donor is still
    // looking at the preview. It comes off when the browser says printing is over, when the window
    // is looked at again, and when an ordinary print starts (so that, where the button's print
    // quietly did nothing, a later print of the page prints the page).
    var own = false;
    var ownTimer = null;
    var opening = false;
    var pageRule = null;
    function mark() {
      root.classList.add(PRINT_CLASS);
      if (!pageRule && doc.head) {
        pageRule = doc.createElement("style");
        pageRule.setAttribute("data-rb-print-page", "");
        pageRule.textContent = PAGE_RULE;
        doc.head.appendChild(pageRule);
      }
    }
    function unmark() {
      root.classList.remove(PRINT_CLASS);
      if (pageRule && pageRule.parentNode) pageRule.parentNode.removeChild(pageRule);
      pageRule = null;
    }
    function disown() {
      own = false;
      ownTimer = null;
    }
    if (typeof win.addEventListener === "function") {
      win.addEventListener("beforeprint", function () {
        if (own) {
          own = false;
          return;
        }
        unmark();
      });
      win.addEventListener("afterprint", unmark);
      win.addEventListener("focus", function () {
        // not in the moment the button is opening the print window
        if (!opening) unmark();
      });
    }
    ask.hidden = false;
    return ask;
  }

  // --- the picture to share: "I filled a Red Bag", and never an amount -----------------------------
  // The bag is the page's own drawing (src/red-bag/render.ts), tied and full.
  // Drawn on a canvas in the browser, the way the fundraisers' social pictures are
  // (assets/js/fundraise-social.js): no image library on the server, and nothing leaves the page
  // until the giver chooses to share or save it.
  var C = { cream: "#F8F5EE", crimson: "#C02238", maroon: "#800000", tan: "#D29C8A", tanSoft: "#F3E4DD", slate: "#333333", holly: "#1A531A" };

  // The widest the words may be, and their face.
  var WORDS_WIDE = 900;
  function headFace(size) {
    return "800 " + size + 'px "Playfair Display", Georgia, serif';
  }
  /** The biggest size, from `from` down to `least`, at which the words fit across the picture. */
  function fitSize(ctx, words, from, least) {
    var size = from;
    for (; size > least; size -= 4) {
      ctx.font = headFace(size);
      if (ctx.measureText(words).width <= WORDS_WIDE) break;
    }
    ctx.font = headFace(size);
    return size;
  }

  function drawPicture(canvas, win, name, bags) {
    var ctx = null;
    try {
      ctx = canvas.getContext("2d");
    } catch (e) {
      ctx = null;
    }
    if (!ctx || typeof win.Path2D !== "function") return false;
    var W = canvas.width;
    var H = canvas.height;
    ctx.fillStyle = C.cream;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = C.maroon;
    ctx.lineWidth = 6;
    ctx.strokeRect(36, 36, W - 72, H - 72);

    // The bag: the page's own drawing (src/red-bag/render.ts), full, four times the size.
    var k = 4.3;
    ctx.save();
    ctx.translate((W - 120 * k) / 2, 96);
    ctx.scale(k, k);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = C.maroon;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 3.4;
    ctx.stroke(new win.Path2D("M44 36C44 10 88 10 88 36"));
    ctx.globalAlpha = 1;
    ctx.fillStyle = C.cream;
    ctx.strokeStyle = C.tan;
    ctx.lineWidth = 1.2;
    var tissue = new win.Path2D("M22 38l9-13 8 9 9-14 9 13 9-12 8 11 9-9 7 15z");
    ctx.fill(tissue);
    ctx.stroke(tissue);
    var body = new win.Path2D("M12 36h96v88a4 4 0 0 1-4 4H16a4 4 0 0 1-4-4z");
    ctx.fillStyle = C.crimson;
    ctx.fill(body);
    ctx.fillStyle = C.maroon;
    ctx.globalAlpha = 0.16;
    ctx.fill(new win.Path2D("M92 36h16v88a4 4 0 0 1-4 4H92z"));
    ctx.globalAlpha = 0.12;
    ctx.fill(new win.Path2D("M12 36h96v10H12z"));
    ctx.globalAlpha = 0.4;
    ctx.strokeStyle = C.maroon;
    ctx.lineWidth = 1;
    ctx.stroke(new win.Path2D("M12 46h96M92 46v82"));
    ctx.globalAlpha = 1;
    ctx.strokeStyle = C.crimson;
    ctx.lineWidth = 3.4;
    ctx.stroke(new win.Path2D("M32 40C32 12 76 12 76 40"));
    ctx.fillStyle = C.maroon;
    ctx.beginPath();
    ctx.arc(32, 41, 2.2, 0, Math.PI * 2);
    ctx.arc(76, 41, 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.textAlign = "center";
    ctx.fillStyle = C.crimson;
    var rule = 838;
    if (!name) {
      ctx.font = headFace(96);
      ctx.fillText("I filled a Red Bag", W / 2, 800);
    } else {
      // With a name: on one line while it fits at a good size; a longer name has a line of its
      // own, as small as it needs to be to fit. The last argument is the browser's own squeeze, for
      // the rare name that is still too wide.
      var whole = pictureHeadline(name, bags);
      ctx.font = headFace(68);
      if (ctx.measureText(whole).width <= WORDS_WIDE) {
        fitSize(ctx, whole, 96, 68);
        ctx.fillText(whole, W / 2, 800, WORDS_WIDE);
      } else {
        fitSize(ctx, name, 76, 40);
        ctx.fillText(name, W / 2, 740, WORDS_WIDE);
        ctx.font = headFace(68);
        ctx.fillText(filledWords(bags), W / 2, 816, WORDS_WIDE);
        rule = 852;
      }
    }
    ctx.fillStyle = C.holly;
    ctx.fillRect(W / 2 - 150, rule, 300, 4);
    ctx.fillStyle = C.slate;
    ctx.font = '400 40px "Poppins", system-ui, sans-serif';
    ctx.fillText("Fill one too at nbcc.scot/fill", W / 2, 912);
    ctx.font = '400 26px "Poppins", system-ui, sans-serif';
    ctx.fillText("Night Before Christmas Campaign (NBCC). Scottish Charity SC047995.", W / 2, 984);
    return true;
  }

  function initShare(doc, win, thanks, st) {
    var box = thanks.querySelector("[data-rb-share]");
    var canvas = box ? box.querySelector("[data-rb-share-picture]") : null;
    if (!box || !canvas) return null;
    var status = box.querySelector("[data-rb-share-status]");
    var save = box.querySelector("[data-rb-share-save]");
    var send = box.querySelector("[data-rb-share-send]");
    var words = "I filled a Red Bag with NBCC. You can fill one too: " + PAGE_URL;

    // Draw the picture as it now stands (with the name, where one may be shown), and point "Save
    // the picture" at it. Should the named one ever fail to draw, the plain one is drawn instead.
    function paint() {
      var name = (st && st.name) || "";
      var bags = (st && st.bags) || 1;
      var done = false;
      try {
        done = drawPicture(canvas, win, name, bags);
      } catch (e) {
        name = "";
        done = drawPicture(canvas, win, "", 1);
      }
      if (!done) return false;
      canvas.setAttribute("aria-label", "A red paper gift bag on cream, with the words: " + pictureHeadline(name, bags) + ". Night Before Christmas Campaign.");
      drawnAt += 1; // the file to save is now behind the picture
      return true;
    }

    // "Save the picture" points at a blob: an address made of a random id, which says nothing about
    // the picture. (The picture's own bytes in the address would hand a trace of the name to
    // anything that reads link addresses, as the site's visit counter does for downloads.) The
    // file is made when it is wanted (the pointer or the keyboard reaches Save, or it is pressed),
    // not for every letter typed, and the one before it is let go.
    var drawnAt = 0; // counts the picture's redraws
    var madeAt = -1; // the redraw the file to save was made from
    var saveUrl = "";
    function fresh() {
      return !!saveUrl && madeAt === drawnAt;
    }
    var urls = win.URL;
    var canSave = !!save && typeof canvas.toBlob === "function" && !!urls && typeof urls.createObjectURL === "function";
    // Make the file from the picture as it now is. The browser hands the file back a moment later;
    // if the picture has been redrawn by then (another letter typed), that file is of the old
    // picture: it is not used, and one is made again. `then` runs once Save points at a file of the
    // picture as it stands; `failed` if no file could be made.
    function makeFile(then, failed) {
      if (!canSave) return;
      if (fresh()) {
        if (then) then();
        return;
      }
      var at = drawnAt;
      function gaveUp() {
        if (failed) failed();
      }
      try {
        canvas.toBlob(function (blob) {
          // Another asking got there first, with the picture as it stands: use that one.
          if (fresh()) {
            if (then) then();
            return;
          }
          if (at !== drawnAt) {
            makeFile(then, failed);
            return;
          }
          var next = "";
          try {
            next = blob ? urls.createObjectURL(blob) : "";
          } catch (e) {
            next = "";
          }
          if (!next) {
            gaveUp();
            return;
          }
          if (saveUrl && typeof urls.revokeObjectURL === "function") {
            try {
              urls.revokeObjectURL(saveUrl);
            } catch (e) {
              /* it is let go with the page */
            }
          }
          saveUrl = next;
          madeAt = at;
          save.href = next;
          save.hidden = false;
          if (then) then();
        }, "image/png");
      } catch (e) {
        gaveUp();
      }
    }
    if (canSave) {
      each(["pointerenter", "focus", "touchstart"], function (name) {
        save.addEventListener(name, function () {
          makeFile();
        });
      });
      save.addEventListener("click", function (e) {
        // Pointing at the picture as it stands: the browser saves it, and that is the one click.
        if (fresh()) return;
        // Behind the picture: this press is not followed. The file is made, then saved through a
        // link of its own that is never put in the page, so the press stays one click to anything
        // that counts clicks, and Save itself is not pressed a second time.
        e.preventDefault();
        makeFile(
          function () {
            var link = doc.createElement("a");
            link.href = saveUrl;
            link.setAttribute("download", save.getAttribute("download") || "i-filled-a-red-bag.png");
            link.click();
          },
          function () {
            setText(status, "Sorry, that didn't work. Please try again.");
          },
        );
      });
    }

    function finish() {
      if (!paint()) {
        canvas.hidden = true;
        return;
      }
      makeFile();
      if (st) st.redraw = paint;
      var nav = win.navigator || {};
      if (send && typeof nav.share === "function" && typeof canvas.toBlob === "function" && typeof win.File === "function") {
        send.hidden = false;
        send.addEventListener("click", function () {
          canvas.toBlob(function (blob) {
            if (!blob) return;
            var file = new win.File([blob], "i-filled-a-red-bag.png", { type: "image/png" });
            var data = { text: words };
            if (typeof nav.canShare === "function" && nav.canShare({ files: [file] })) data.files = [file];
            nav.share(data).then(
              function () {
                setText(status, "Thank you for sharing.");
              },
              function () {
                /* they closed the share sheet: nothing to say */
              },
            );
          }, "image/png");
        });
      }
    }

    // The words are drawn in the page's own faces, so wait for them where the browser can say.
    var fonts = doc.fonts;
    if (fonts && typeof fonts.load === "function") {
      Promise.all([fonts.load('800 96px "Playfair Display"'), fonts.load('400 40px "Poppins"')]).then(finish, finish);
    } else {
      finish();
    }

    // Copy the link, shown only where copying works (as on a fundraiser's page).
    var copy = box.querySelector("[data-rb-copy-link]");
    var clip = win.navigator && win.navigator.clipboard;
    if (copy && clip && typeof clip.writeText === "function") {
      copy.hidden = false;
      copy.addEventListener("click", function () {
        clip.writeText(PAGE_URL).then(
          function () {
            setText(status, "Link copied. You can paste it anywhere.");
          },
          function () {
            setText(status, "Copying did not work here. The link is " + PAGE_URL);
          },
        );
      });
    }
    return box;
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      initThanks: initThanks,
      bagsFilled: bagsFilled,
      cleanName: cleanName,
      nameBlocked: nameBlocked,
      pictureHeadline: pictureHeadline,
      certificateFor: certificateFor,
      longDate: longDate,
    };
  } else {
    initThanks(document, window);
  }
})();
