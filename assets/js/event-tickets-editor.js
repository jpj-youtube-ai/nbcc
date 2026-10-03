// Event tickets: the little editor for the kinds of ticket an organiser proposes (a name, a price and
// an optional number on sale each), used on the sign up form (/fundraise, when "NBCC sells the tickets
// for me" is chosen) and in the private area (/fundraise/manage). It only draws the rows and reads
// them back; the server checks everything (src/tickets/model.ts checkTicketTypes) and staff approve
// every ticket before it goes on sale.
//
// window.NBCCTicketEditor.mount(root): draws the first row in root's [data-et-rows] and wires its
// [data-et-add] button. .read(root): { types: [{ name, pricePence, quantity }], limit }.
// A classic <script defer>, exported under a CommonJS guard so it can be unit tested in jsdom.
(function () {
  "use strict";

  var MAX_TYPES = 10;

  function field(doc, id, label, attrs, optional, placeholder) {
    var wrap = doc.createElement("div");
    wrap.className = "give-field";
    var l = doc.createElement("label");
    l.setAttribute("for", id);
    l.textContent = label;
    if (optional) {
      var o = doc.createElement("span");
      o.className = "give-optional";
      o.textContent = " (optional)";
      l.appendChild(o);
    }
    var input = doc.createElement("input");
    input.className = "give-field-input";
    input.id = id;
    Object.keys(attrs).forEach(function (k) {
      input.setAttribute(k, attrs[k]);
    });
    if (placeholder) input.setAttribute("placeholder", placeholder);
    wrap.appendChild(l);
    wrap.appendChild(input);
    return wrap;
  }

  function mount(root, prefix) {
    var doc = root.ownerDocument;
    var rows = root.querySelector("[data-et-rows]");
    var add = root.querySelector("[data-et-add]");
    if (!rows) return null;
    var seq = 0;
    var pre = prefix || "etType";

    function renumber() {
      var list = rows.querySelectorAll("[data-et-row]");
      Array.prototype.forEach.call(list, function (row, i) {
        var remove = row.querySelector("[data-et-remove]");
        if (remove) {
          remove.hidden = list.length === 1;
          remove.setAttribute("aria-label", "Remove ticket " + (i + 1));
        }
      });
      if (add) add.hidden = list.length >= MAX_TYPES;
    }

    function addRow() {
      var n = seq;
      seq += 1;
      var row = doc.createElement("div");
      row.className = "et-row";
      row.setAttribute("data-et-row", "");
      row.appendChild(field(doc, pre + "Name" + n, "Kind of ticket", { type: "text", maxlength: "60", autocomplete: "off", "data-et-name": "" }, false, "Like Adult"));
      row.appendChild(field(doc, pre + "Price" + n, "Price, in pounds", { type: "number", inputmode: "decimal", min: "0", max: "500", step: "0.01", "data-et-price": "", "data-invalid-message": "Almost! A ticket can be up to £500. Put 0 if it's free." }, false, "10"));
      row.appendChild(field(doc, pre + "Qty" + n, "How many", { type: "number", inputmode: "numeric", min: "1", max: "5000", step: "1", "data-et-quantity": "", "data-invalid-message": "Almost! Just put a whole number, or leave it empty for no limit." }, false, "No limit"));
      var remove = doc.createElement("button");
      remove.type = "button";
      remove.className = "fr-link-btn et-row__remove";
      remove.setAttribute("data-et-remove", "");
      remove.textContent = "Remove";
      remove.addEventListener("click", function () {
        rows.removeChild(row);
        renumber();
      });
      row.appendChild(remove);
      rows.appendChild(row);
      renumber();
      return row;
    }

    if (add) {
      add.addEventListener("click", function () {
        var row = addRow();
        var first = row.querySelector("input");
        if (first && first.focus) first.focus();
      });
    }
    if (!rows.querySelector("[data-et-row]")) addRow();
    // "When should ticket sales close?": the date and time box only for their own choice.
    var closeAt = root.querySelector("[data-et-close-at-field]");
    function applyClose() {
      var chosen = root.querySelector('input[data-et-close]:checked');
      if (closeAt) closeAt.hidden = !chosen || chosen.value !== "custom";
    }
    Array.prototype.forEach.call(root.querySelectorAll("input[data-et-close]"), function (r) {
      r.addEventListener("change", applyClose);
    });
    applyClose();
    return { addRow: addRow };
  }

  // Pounds as typed ("10", "7.50") to whole pence; anything else is left for the server to refuse.
  function pence(text) {
    var t = String(text || "").trim();
    if (!/^\d+(\.\d{1,2})?$/.test(t)) return t === "" ? null : NaN;
    return Math.round(parseFloat(t) * 100);
  }

  function read(root) {
    var types = [];
    Array.prototype.forEach.call(root.querySelectorAll("[data-et-row]"), function (row) {
      var v = function (sel) {
        var e = row.querySelector(sel);
        return e ? String(e.value || "").trim() : "";
      };
      var name = v("[data-et-name]");
      var price = v("[data-et-price]");
      var quantity = v("[data-et-quantity]");
      // A row left wholly empty is not a ticket (but the first always is, so an empty form is refused).
      if (!name && !price && !quantity && types.length > 0) return;
      var p = pence(price);
      types.push({ name: name, pricePence: p !== null && isFinite(p) ? p : -1, quantity: quantity === "" ? null : Number(quantity) });
    });
    var limitBox = root.querySelector("[data-et-limit]");
    var limit = limitBox ? String(limitBox.value || "").trim() : "";
    // When sales close: when the event starts unless they chose otherwise (a date and time, as typed).
    var chosen = root.querySelector("input[data-et-close]:checked");
    var close = chosen ? chosen.value : "start";
    var atBox = root.querySelector("[data-et-close-at]");
    var out = { types: types, limit: limit === "" ? null : Number(limit), close: close };
    if (close === "custom") out.closeAt = atBox ? String(atBox.value || "").trim() : "";
    return out;
  }

  var api = { mount: mount, read: read, pence: pence };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    window.NBCCTicketEditor = api;
    Array.prototype.forEach.call(document.querySelectorAll("[data-nbcc-tickets]"), function (root) {
      mount(root);
    });
  }
})();
