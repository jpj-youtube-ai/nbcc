/* NBCC admin: the kit's small helpers, beside assets/css/admin-kit.css (2026-11-14).
 * Design: docs/superpowers/specs/2026-11-14-admin-refresh-design.md.
 *
 * What every screen in the kit's look needs and none should write twice: a table that names its own
 * cells for the phone, a bar of parts with one showing at a time, a spreadsheet to download, a thing
 * to copy, and "1 gift" against "2 gifts". No fetch and nothing of the admin's own state: app.js and
 * the screens' own files call these.
 *
 * A classic <script defer> before app.js, exported under a CommonJS guard so it is unit tested in
 * jsdom (test/unit/admin-kit.test.ts). In the browser it is window.AdminKit.
 */
(function () {
  "use strict";

  /** "1 gift", "2 gifts", "No gifts" is the caller's to say: this is only the count and the noun. */
  function plural(n, one, many) {
    var count = Number(n) || 0;
    return count + " " + (count === 1 ? one : many);
  }

  /**
   * Names every body cell of a table after its column's heading (data-label), so the phone layout
   * (.ak-cards) can put the name in front of the value. A cell that already has a data-label keeps
   * it; a heading with no words (an actions column) leaves its cells unnamed. Call it after the
   * table is drawn, and again after its rows are redrawn.
   */
  function labelCells(table) {
    if (!table || !table.querySelectorAll) return;
    var heads = Array.prototype.map.call(table.querySelectorAll("thead th"), function (th) {
      return (th.textContent || "").replace(/\s+/g, " ").trim();
    });
    if (!heads.length) return;
    Array.prototype.forEach.call(table.querySelectorAll("tbody tr"), function (tr) {
      var col = 0;
      Array.prototype.forEach.call(tr.children, function (cell) {
        var span = Number(cell.getAttribute("colspan")) || 1;
        if (cell.tagName === "TD" && span === 1 && !cell.hasAttribute("data-label") && heads[col]) {
          cell.setAttribute("data-label", heads[col]);
        }
        col += span;
      });
    });
  }

  /**
   * A bar of parts (.ak-parts) with one part showing at a time.
   *
   *   <div class="ak-parts" role="group" aria-label="Which part to show">
   *     <button type="button" class="ak-part-btn" data-akpart="money" aria-pressed="false">Money</button>
   *   </div>
   *   <div class="ak-part" data-akpart-body="money" role="region" aria-label="Money" hidden>...</div>
   *
   * root holds the bar and the parts. opts.start is the part to open on (default: the one already
   * pressed, else the first); opts.onShow(key) is told each time one is shown. Left and right arrows,
   * Home and End move along the bar, as on the Festive Ball's. Pressing a button brings its part to
   * the top of what you can see: the part itself where the bar is pinned (a laptop), the bar where it
   * is not (a phone), so you are never left looking at the foot of a shorter part.
   * Returns { show(key, scroll), current() }.
   */
  function wireParts(root, opts) {
    opts = opts || {};
    var none = { show: function () {}, current: function () { return null; } };
    if (!root || !root.querySelector) return none;
    var bar = root.querySelector(".ak-parts");
    if (!bar) return none;
    var current = null;

    function buttons() {
      return Array.prototype.filter.call(bar.querySelectorAll("[data-akpart]"), function (b) { return !b.hidden; });
    }
    function bodies() {
      // Only this bar's own parts: a part inside another bar of parts further in belongs to that one.
      return Array.prototype.filter.call(root.querySelectorAll("[data-akpart-body]"), function (p) {
        var owner = p.parentNode;
        while (owner && owner !== root) {
          if (owner.hasAttribute && owner.hasAttribute("data-akpart-body")) return false;
          owner = owner.parentNode;
        }
        return true;
      });
    }
    function show(key, scroll) {
      var list = buttons();
      var known = list.some(function (b) { return b.getAttribute("data-akpart") === key; });
      if (!known) key = list.length ? list[0].getAttribute("data-akpart") : null;
      if (key === null) return;
      current = key;
      list.forEach(function (b) {
        b.setAttribute("aria-pressed", b.getAttribute("data-akpart") === key ? "true" : "false");
      });
      var shown = null;
      bodies().forEach(function (p) {
        var on = p.getAttribute("data-akpart-body") === key;
        p.hidden = !on;
        if (on) shown = p;
      });
      if (scroll && shown) {
        var view = root.ownerDocument && root.ownerDocument.defaultView;
        var pinned = view && view.getComputedStyle ? view.getComputedStyle(bar).position === "sticky" : false;
        var target = pinned ? shown : bar;
        if (target.scrollIntoView) target.scrollIntoView({ block: "start" });
      }
      if (typeof opts.onShow === "function") opts.onShow(key);
    }

    bar.addEventListener("click", function (ev) {
      var btn = ev.target && ev.target.closest ? ev.target.closest("[data-akpart]") : null;
      if (!btn || !bar.contains(btn)) return;
      show(btn.getAttribute("data-akpart"), true);
    });
    bar.addEventListener("keydown", function (ev) {
      var btn = ev.target && ev.target.closest ? ev.target.closest("[data-akpart]") : null;
      if (!btn || !bar.contains(btn)) return;
      var list = buttons();
      var at = list.indexOf(btn);
      var next = -1;
      if (ev.key === "ArrowRight") next = (at + 1) % list.length;
      else if (ev.key === "ArrowLeft") next = (at - 1 + list.length) % list.length;
      else if (ev.key === "Home") next = 0;
      else if (ev.key === "End") next = list.length - 1;
      if (next < 0) return;
      ev.preventDefault();
      list[next].focus();
      show(list[next].getAttribute("data-akpart"), false);
    });

    var pressed = bar.querySelector('[data-akpart][aria-pressed="true"]');
    show(opts.start || (pressed ? pressed.getAttribute("data-akpart") : null), false);
    return { show: show, current: function () { return current; } };
  }

  /**
   * One cell of a spreadsheet. A cell that begins with = + - or @ (or a tab or a return) would be
   * run as a formula by Excel when the file is opened, so it is given a leading apostrophe and stays
   * words. A number is left a number. Quotes are doubled and the cell is quoted when it needs to be.
   */
  function csvCell(value) {
    if (value === null || value === undefined) return "";
    if (typeof value === "number") return isFinite(value) ? String(value) : "";
    var s = String(value);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  /** Rows (an array of arrays, the first usually the headings) as the text of a .csv file. */
  function toCsv(rows) {
    return (rows || [])
      .map(function (row) { return (row || []).map(csvCell).join(","); })
      .join("\r\n");
  }

  /**
   * Hands the person a .csv to save, made in the browser from what is already on the screen. The
   * leading mark is what tells Excel the file is UTF-8, so a pound sign or an accent arrives whole.
   * Returns false where the browser cannot (no Blob), so the caller can say so.
   */
  function downloadCsv(filename, rows, win) {
    win = win || (typeof window !== "undefined" ? window : null);
    if (!win || !win.Blob || !win.URL || !win.URL.createObjectURL) return false;
    var doc = win.document;
    var blob = new win.Blob(["﻿" + toCsv(rows)], { type: "text/csv;charset=utf-8" });
    var url = win.URL.createObjectURL(blob);
    var a = doc.createElement("a");
    a.href = url;
    a.download = filename;
    a.hidden = true;
    doc.body.appendChild(a);
    a.click();
    doc.body.removeChild(a);
    if (win.URL.revokeObjectURL) win.setTimeout(function () { win.URL.revokeObjectURL(url); }, 1000);
    return true;
  }

  /**
   * Copies words for pasting somewhere else. Resolves true when they were copied and false when the
   * browser would not, so the caller can say which; it never throws.
   */
  function copyText(text, win) {
    win = win || (typeof window !== "undefined" ? window : null);
    var nav = win && win.navigator;
    if (nav && nav.clipboard && nav.clipboard.writeText) {
      return nav.clipboard.writeText(String(text)).then(
        function () { return true; },
        function () { return false; }
      );
    }
    return Promise.resolve(false);
  }

  var api = {
    plural: plural,
    labelCells: labelCells,
    wireParts: wireParts,
    csvCell: csvCell,
    toCsv: toCsv,
    downloadCsv: downloadCsv,
    copyText: copyText,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else window.AdminKit = api;
})();
