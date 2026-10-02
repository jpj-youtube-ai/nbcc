/* Events page: turning the cards over.
 *
 * The page works without this file. Every card ships with both faces in the markup, and
 * without JavaScript they simply stack, front then back, so every detail and every booking
 * link is still there. This switches the deck into its card form and wires the turning.
 *
 * Turning a card over:
 *   - Click or tap anywhere on a card, or use its "See the full details" / "Turn back" button.
 *     The buttons are the real controls: they are what a keyboard or screen reader uses.
 *   - Links on the back go where they say. Selecting text (to copy an address, say) does
 *     not turn the card.
 *   - Escape turns a card back over.
 *
 * The face you cannot see is made inert, so it is out of the tab order and out of the
 * screen reader's reach. Focus follows the turn: to the back's heading on the way over, and
 * to the front's button on the way back, so a keyboard user never loses their place.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else if (typeof document !== "undefined") {
    // The admin's preview frames reach in through this to turn the card to the side staff asked for.
    root.nbccEvents = api;
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () {
        api.initDeck(document, window);
        api.initChips(document, window);
      });
    } else {
      api.initDeck(document, window);
      api.initChips(document, window);
    }
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function setFace(card, flipped, moveFocus) {
    var front = card.querySelector(".ev-front");
    var back = card.querySelector(".ev-back");
    if (!front || !back) return;

    // If focus is on the face being turned away, it has to go somewhere, or it falls to the
    // top of the page when that face goes inert.
    var active = card.ownerDocument.activeElement;
    if (active && (flipped ? front : back).contains(active)) moveFocus = true;

    card.classList.toggle("is-flipped", flipped);
    front.inert = flipped;
    back.inert = !flipped;
    // aria-hidden as well, for the few browsers still without inert.
    front.setAttribute("aria-hidden", flipped ? "true" : "false");
    back.setAttribute("aria-hidden", flipped ? "false" : "true");

    if (moveFocus) {
      var target = flipped
        ? back.querySelector(".ev-title[tabindex]") || back.querySelector(".ev-turn")
        : front.querySelector(".ev-turn");
      if (target) target.focus({ preventScroll: true });
    }
  }

  function isFlipped(card) {
    return card.classList.contains("is-flipped");
  }

  function selectedText(win) {
    var sel = win.getSelection ? win.getSelection() : null;
    return sel ? String(sel) : "";
  }

  function columnCount(deck, win) {
    var cols = win.getComputedStyle(deck).gridTemplateColumns || "";
    var n = cols.split(" ").filter(Boolean).length;
    return n > 0 ? n : 1;
  }

  /* Deal the cards onto the table as each comes into view, left to right across a row. */
  function dealIn(deck, cards, doc, win) {
    var reduced =
      typeof win.matchMedia === "function" && win.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // data-no-deal: the admin's previews redraw as staff type, and a deal on every redraw would be
    // a card jumping about under their hands.
    if (reduced || !win.IntersectionObserver || deck.hasAttribute("data-no-deal")) return;

    var cols = columnCount(deck, win);
    cards.forEach(function (card, i) {
      card.style.setProperty("--deal-delay", (i % cols) * 110 + "ms");
      card.classList.add("is-waiting");
    });

    function deal(card) {
      if (!card.classList.contains("is-waiting")) return;
      card.classList.add("is-dealt");
      card.classList.remove("is-waiting");
      // Hand the transform back to the hover and flip styles once the deal has landed.
      win.setTimeout(function () {
        card.classList.remove("is-dealt");
        card.style.removeProperty("--deal-delay");
      }, 1100);
    }

    var io = new win.IntersectionObserver(
      function (entries, obs) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          obs.unobserve(entry.target);
          deal(entry.target);
        });
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    cards.forEach(function (card) {
      io.observe(card);
    });

    // A card must never be left face down on the table. If the observer has not fired by now (a
    // background tab, a print preview, a browser that throttles it), deal whatever is still waiting.
    win.setTimeout(function () {
      io.disconnect();
      cards.forEach(deal);
    }, 2500);
  }

  function initDeck(doc, win) {
    var deck = doc.querySelector("[data-deck]");
    if (!deck) return null;

    var cards = Array.prototype.slice.call(deck.querySelectorAll(".ev-card"));
    deck.classList.add("deck--flip");
    var hint = doc.querySelector("[data-deck-hint]");
    if (hint) hint.hidden = false;

    cards.forEach(function (card) {
      setFace(card, false, false);

      card.addEventListener("click", function (e) {
        var target = e.target;
        if (target.closest && target.closest("a")) return; // links go where they say
        var viaButton = !!(target.closest && target.closest(".ev-turn"));
        // Selecting an address or a phone number to copy it must not turn the card over.
        if (!viaButton && selectedText(win)) return;
        setFace(card, !isFlipped(card), viaButton || e.detail === 0);
      });

      card.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && isFlipped(card)) {
          e.preventDefault();
          setFace(card, false, true);
        }
      });
    });

    dealIn(deck, cards, doc, win);
    return { deck: deck, cards: cards, setFace: setFace };
  }

  /* Get involved's chips (TASK-494): All, Events and Fundraisers filter the cards in place. They ship
   * hidden, so without this script every card simply shows. Each card carries data-kind ("event" or
   * "fundraiser"); the face down card counts as an event. A status line tells a screen reader what
   * is showing, and an empty Fundraisers view says so rather than leaving a blank table. */
  var STATUS = { all: "Showing everything", event: ["event", "events"], fundraiser: ["fundraiser", "fundraisers"] };

  function initChips(doc, win) {
    var group = doc.querySelector("[data-chips]");
    var deck = doc.querySelector("[data-deck]");
    if (!group || !deck) return null;
    var buttons = Array.prototype.slice.call(group.querySelectorAll("[data-show]"));
    var cards = Array.prototype.slice.call(deck.querySelectorAll(".ev-card"));
    var status = doc.querySelector("[data-chips-status]");

    function show(kind) {
      var count = 0;
      cards.forEach(function (card) {
        var match = kind === "all" || card.getAttribute("data-kind") === kind;
        card.hidden = !match;
        if (match && !card.classList.contains("ev-card--more")) count += 1;
      });
      buttons.forEach(function (b) {
        b.setAttribute("aria-pressed", b.getAttribute("data-show") === kind ? "true" : "false");
      });
      Array.prototype.forEach.call(doc.querySelectorAll("[data-chips-empty]"), function (el) {
        el.hidden = !(el.getAttribute("data-chips-empty") === kind && count === 0);
      });
      if (status) {
        var words = STATUS[kind];
        status.textContent = kind === "all" ? words : "Showing " + count + " " + (count === 1 ? words[0] : words[1]);
      }
    }

    buttons.forEach(function (b) {
      b.addEventListener("click", function () {
        show(b.getAttribute("data-show"));
      });
    });
    group.hidden = false;
    return { show: show, win: win };
  }

  return { initDeck: initDeck, setFace: setFace, initChips: initChips };
});
