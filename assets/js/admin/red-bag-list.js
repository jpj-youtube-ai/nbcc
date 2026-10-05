// Admin > Fill a Red Bag: the editor for the list on the public page /fill. Its own file beside
// app.js, so each can change without the other: it fills its own view (#view-red-bag in
// admin.html), reads the signed in person's token the way app.js keeps it, and asks its own API
// (src/routes/admin-red-bag-list.ts). app.js only shows the view and calls open().
//
// What staff can change: each item's name, price, heading, picture, order and whether it shows;
// new items; and, under each of the three themes, each example's amount, words, picture, order
// and whether it shows, and new examples. The four headings, the three themes, the £50 bag, the
// £2 minimum and every other word on the page are not here to change.
//
// How it works:
//   - everything typed changes a working copy on this screen only. "Save draft" sends it to the ONE
//     shared draft on the server. The bar at the foot always says which of the two is on screen;
//   - "Changes not yet on the website" lists, in plain words, what differs between what is on
//     screen and the website's list, as it is typed;
//   - Preview the page, Publish and Throw away changes work on the SAVED draft, so they wait for a
//     save. Publish and Throw away ask first, on the page, repeating the changes;
//   - History lists every publish; any earlier list (and the original one, from the code) can be
//     looked at, and put back as a draft;
//   - the rules (assets/js/red-bag-list.js, the very file the server checks with) run as staff
//     type, and say what is wrong beside the field. The server checks again whatever this does;
//   - someone with view access only sees all of it, with nothing to change and no buttons that
//     change anything.
// Nothing scrolls inside a box: long lists make the page longer. Everything from the server is
// escaped before it is written; the drawings come from the catalogue file, which is ours.
//
// A classic <script defer>, exported under a CommonJS guard so it can be unit tested in jsdom.
(function () {
  "use strict";

  var TOKEN_KEY = "nbcc_admin_token";
  var API = "/api/admin/red-bag-list";
  var PREVIEW_URL = "/fill?preview=draft";
  var MSG = {
    loading: "Loading...",
    failed: "The Fill a Red Bag list could not load. Open it again in a moment.",
    saveFailed: "That did not save. Please try again.",
    didNotWork: "That did not work. Please try again.",
    stale: "Someone else has changed the draft. Reload to see their changes.",
    saved: "Draft saved. Nothing has changed on the website yet.",
    published: "Published. The Fill a Red Bag page shows this list now.",
    thrownAway: "Changes thrown away. The draft is back to what the website shows.",
    putBack: "That list is now the draft. Nothing has changed on the website yet.",
    fixFirst: "Some things above need another look before this can be saved.",
    unsaved: "You have changes on this screen that are not saved.",
    allSaved: "Everything on this screen is saved in the draft.",
    nothingToSave: "This is the list the website shows. Nothing has been changed.",
    leave: "You have changes that are not saved. Leave without saving them?",
    saveFirst: "Save the draft first.",
    readOnly: "You can look at this list. Changing it needs edit access to Fill a Red Bag.",
    versionFailed: "That version could not load just now. Try again in a moment.",
  };
  // What each drawing is, for the picture chooser's labels (a screen reader cannot see them).
  var ART_NAMES = {
    "crisis-15": "Cuddly toy",
    "crisis-30": "Bed",
    "crisis-60": "Cooking pot",
    "school-25": "School shoes",
    "school-35": "Winter coat",
    "school-40": "School uniform",
    "hand-20": "Toiletries",
    "hand-75": "Briefcase",
    "hand-150": "Cooker",
    present: "Wrapped present",
  };
  var UP_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 19V6M6 11l6-6 6 6"/></svg>';
  var DOWN_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 5v13M6 13l6 6 6-6"/></svg>';

  function esc(s) {
    return String(s === undefined || s === null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
  function clone(o) {
    return JSON.parse(JSON.stringify(o));
  }

  function initAdminRedBagList(doc, win) {
    var view = doc.getElementById("view-red-bag");
    var root = doc.getElementById("rblRoot");
    var RB = win.NBCCRedBag;
    var L = win.NBCCRedBagList;
    if (!view || !root) return null;

    var server = null; // the editor's state as the server last gave it
    var working = null; // the list on screen
    var savedJson = ""; // the working list as it was when last loaded or saved
    var typed = {}; // "key:field" -> what is in a price or amount box, as typed
    var touched = {}; // "key:field" -> the field has been changed, so its problem is shown
    var showAll = false; // after a save was refused: every problem is shown
    var chooser = null; // the key whose picture chooser is open
    var confirming = null; // "publish" | "discard" | { restore: id }
    var looking = {}; // version id -> its list, while it is open
    var status = { text: "", kind: "" };
    var busy = false;
    var loadState = "idle"; // idle | loading | ok | failed
    var stale = false;

    // ---- small helpers ----
    function token() {
      try {
        return win.sessionStorage.getItem(TOKEN_KEY);
      } catch (e) {
        return null;
      }
    }
    function ask(method, path, body) {
      var opts = { method: method, headers: { Authorization: "Bearer " + token() } };
      if (body !== undefined) {
        opts.headers["Content-Type"] = "application/json";
        opts.body = JSON.stringify(body);
      }
      return win.fetch(path, opts).then(function (res) {
        if (res.status === 401) {
          // The session has gone: back to the sign in, as app.js does for its own requests.
          try {
            win.sessionStorage.removeItem(TOKEN_KEY);
          } catch (e) {
            /* nothing to clear */
          }
          if (win.location && typeof win.location.reload === "function") win.location.reload();
          throw new Error("unauthorized");
        }
        return res.json().then(
          function (data) {
            return { ok: res.ok, status: res.status, data: data || {} };
          },
          function () {
            return { ok: false, status: res.status, data: {} };
          },
        );
      });
    }
    function mayEdit() {
      return !!(server && server.mayEdit);
    }
    function isDirty() {
      return !!working && JSON.stringify(working) !== savedJson;
    }
    function hasDraft() {
      return !!(server && server.draft);
    }
    function stamp() {
      return { version: server && server.draft ? server.draft.version : 0, publishedId: server ? server.publishedId : null };
    }
    function problems() {
      return working ? L.validate(working) : [];
    }
    function problemFor(list, kind, key, field) {
      for (var i = 0; i < list.length; i += 1) if (list[i].kind === kind && list[i].key === key && list[i].field === field) return list[i].message;
      return "";
    }
    function shown(key, field) {
      return showAll || touched[key + ":" + field] === true;
    }
    function changes() {
      return working && server ? L.diff(server.website, working) : [];
    }
    function find(list, key) {
      for (var i = 0; i < list.length; i += 1) if (list[i].key === key) return list[i];
      return null;
    }
    function onWebsite(key) {
      return !!(server && (find(server.website.items, key) || find(server.website.examples, key)));
    }
    function allKeys() {
      return working.items
        .map(function (i) {
          return i.key;
        })
        .concat(
          working.examples.map(function (e) {
            return e.key;
          }),
        );
    }
    function artName(key) {
      if (ART_NAMES[key]) return ART_NAMES[key];
      var name = "";
      L.groups().forEach(function (g) {
        g.items.forEach(function (i) {
          if (i.key === key) name = i.name;
        });
      });
      return name || key;
    }
    function nameOf(item) {
      return item.name || "this new item";
    }
    function sentenceOf(e) {
      return (typeof e.pence === "number" ? RB.pounds(e.pence) : "An amount") + " " + e.words;
    }
    function when(iso) {
      var d = new Date(iso);
      if (!iso || isNaN(d.getTime())) return "";
      try {
        return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" });
      } catch (e) {
        return d.toISOString().slice(0, 10);
      }
    }
    function clock(iso) {
      var d = new Date(iso);
      if (!iso || isNaN(d.getTime())) return "";
      try {
        return d.toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Europe/London" }).replace(/\s/g, "");
      } catch (e) {
        return "";
      }
    }
    function firstName(name) {
      var n = String(name || "").trim();
      if (!n) return "Someone";
      return n.indexOf("@") !== -1 ? n : n.split(/\s+/)[0];
    }

    // ---- taking the server's state ----
    function take(state) {
      server = state;
      working = clone(state.draft ? state.draft.data : state.website);
      savedJson = JSON.stringify(working);
      typed = {};
      touched = {};
      showAll = false;
      chooser = null;
      confirming = null;
      stale = false;
      loadState = "ok";
    }
    function load() {
      loadState = "loading";
      status = { text: "", kind: "" };
      render();
      return ask("GET", API)
        .then(function (r) {
          if (!r.ok || !r.data || !r.data.website || !Array.isArray(r.data.website.items) || !Array.isArray(r.data.history)) throw new Error("failed");
          take(r.data);
          looking = {};
          render();
        })
        .catch(function (err) {
          if (err && err.message === "unauthorized") return;
          // Never an empty editor that looks like an empty list.
          server = null;
          working = null;
          loadState = "failed";
          render();
        });
    }

    // ---- drawing ----
    function errorHtml(id, message) {
      return '<p class="rbl-error" id="' + id + '"' + (message ? "" : " hidden") + ">" + esc(message) + "</p>";
    }
    function fieldAttrs(id, message) {
      return ' aria-describedby="' + id + '"' + (message ? ' aria-invalid="true"' : "");
    }
    function moveButtons(what, first, last) {
      return (
        '<span class="rbl-moves">' +
        '<button class="rbl-icon-btn" type="button" data-rbl-up aria-label="Move ' + esc(what) + ' up"' + (first ? " disabled" : "") + ">" + UP_ICON + "</button>" +
        '<button class="rbl-icon-btn" type="button" data-rbl-down aria-label="Move ' + esc(what) + ' down"' + (last ? " disabled" : "") + ">" + DOWN_ICON + "</button>" +
        "</span>"
      );
    }
    function chooserHtml(x, what) {
      var options = L.artKeys()
        .map(function (k) {
          return (
            '<button class="rbl-art-btn" type="button" data-rbl-art="' + esc(k) + '" aria-pressed="' + (x.art === k ? "true" : "false") + '" aria-label="' + esc(artName(k)) + '">' +
            RB.art(k, "", 36) +
            "</button>"
          );
        })
        .join("");
      return (
        '<div class="rbl-chooser" data-rbl-chooser role="group" aria-label="Choose a picture for ' + esc(what) + '">' +
        '<p class="rbl-chooser-title">Choose a picture for ' + esc(what) + "</p>" +
        '<div class="rbl-arts">' + options + "</div>" +
        '<button class="rbl-link-btn" type="button" data-rbl-chooser-close>Keep the picture it has</button>' +
        "</div>"
      );
    }
    function showBox(x, what) {
      return (
        '<label class="rbl-show"><input type="checkbox" data-rbl-show' + (x.hidden ? "" : " checked") + ' aria-label="Show ' + esc(what) + ' on the page" /> ' +
        "<span>" + (x.hidden ? "Hidden" : "Showing") + "</span></label>"
      );
    }

    function itemRow(i, list, bad) {
      var k = i.key;
      var id = "rbl-" + k;
      var same = list.filter(function (o) {
        return o.group === i.group;
      });
      var at = same.indexOf(i);
      var what = nameOf(i);
      var nameMsg = shown(k, "name") ? problemFor(bad, "item", k, "name") : "";
      var priceMsg = shown(k, "pence") ? problemFor(bad, "item", k, "pence") : "";
      var price = Object.prototype.hasOwnProperty.call(typed, k + ":pence") ? typed[k + ":pence"] : typeof i.pence === "number" ? L.poundsBox(i.pence) : "";
      if (!mayEdit()) {
        return (
          '<li class="rbl-row rbl-row--read' + (i.hidden ? " is-hidden" : "") + '" data-rbl-item="' + esc(k) + '">' +
          '<span class="rbl-pic">' + RB.art(i.art, "", 36) + "</span>" +
          '<span class="rbl-read-name">' + esc(i.name) + "</span> " +
          '<span class="rbl-read-price">' + esc(RB.pounds(i.pence)) + "</span> " +
          '<span class="rbl-read-state">' + (i.hidden ? "Hidden" : "Showing") + "</span>" +
          "</li>"
        );
      }
      var groups = L.groups()
        .map(function (g) {
          return '<option value="' + esc(g.key) + '"' + (g.key === i.group ? " selected" : "") + ">" + esc(g.heading) + "</option>";
        })
        .join("");
      return (
        '<li class="rbl-row' + (i.hidden ? " is-hidden" : "") + '" data-rbl-item="' + esc(k) + '">' +
        '<span class="rbl-pic">' + RB.art(i.art, "", 36) + "</span>" +
        '<span class="rbl-field rbl-field--name"><label class="fx-call-label" for="' + id + '-name">Name</label>' +
        '<input class="fx-call-input" id="' + id + '-name" type="text" maxlength="60" autocomplete="off" data-rbl-name value="' + esc(i.name) + '" aria-label="Name of ' + esc(what) + '"' + fieldAttrs(id + "-name-error", nameMsg) + " />" +
        errorHtml(id + "-name-error", nameMsg) + "</span>" +
        '<span class="rbl-field rbl-field--price"><label class="fx-call-label" for="' + id + '-price">Price (£)</label>' +
        '<input class="fx-call-input" id="' + id + '-price" type="text" inputmode="decimal" maxlength="9" autocomplete="off" data-rbl-price value="' + esc(price) + '" aria-label="Price of ' + esc(what) + '"' + fieldAttrs(id + "-price-error", priceMsg) + " />" +
        errorHtml(id + "-price-error", priceMsg) + "</span>" +
        '<span class="rbl-field rbl-field--group"><label class="fx-call-label" for="' + id + '-group">Heading</label>' +
        '<select class="fx-call-input" id="' + id + '-group" data-rbl-group aria-label="Heading for ' + esc(what) + '">' + groups + "</select></span>" +
        showBox(i, what) +
        moveButtons(what, at === 0, at === same.length - 1) +
        '<span class="rbl-links">' +
        '<button class="rbl-link-btn" type="button" data-rbl-picture aria-expanded="' + (chooser === k ? "true" : "false") + '" aria-label="Change picture of ' + esc(what) + '">Change picture</button>' +
        (onWebsite(k) ? "" : '<button class="rbl-link-btn" type="button" data-rbl-remove aria-label="Remove ' + esc(what) + '">Remove</button>') +
        "</span>" +
        (chooser === k ? chooserHtml(i, what) : "") +
        "</li>"
      );
    }

    function exampleRow(e, list, bad) {
      var k = e.key;
      var id = "rbl-" + k;
      var same = list.filter(function (o) {
        return o.theme === e.theme;
      });
      var at = same.indexOf(e);
      var rest = e.words.indexOf(L.COULD_HELP) === 0 ? e.words.slice(L.COULD_HELP.length) : e.words === L.COULD_HELP.trim() ? "" : e.words;
      var what = "the example " + (rest ? sentenceOf(e) : "being added");
      var amountMsg = shown(k, "pence") ? problemFor(bad, "example", k, "pence") : "";
      var wordsMsg = shown(k, "words") ? problemFor(bad, "example", k, "words") : "";
      var amount = Object.prototype.hasOwnProperty.call(typed, k + ":pence") ? typed[k + ":pence"] : typeof e.pence === "number" ? L.poundsBox(e.pence) : "";
      if (!mayEdit()) {
        return (
          '<li class="rbl-row rbl-row--read' + (e.hidden ? " is-hidden" : "") + '" data-rbl-example="' + esc(k) + '">' +
          '<span class="rbl-pic">' + RB.art(e.art, "", 36) + "</span>" +
          '<span class="rbl-read-name">' + esc(sentenceOf(e)) + "</span> " +
          '<span class="rbl-read-state">' + (e.hidden ? "Hidden" : "Showing") + "</span>" +
          "</li>"
        );
      }
      return (
        '<li class="rbl-row rbl-row--example' + (e.hidden ? " is-hidden" : "") + '" data-rbl-example="' + esc(k) + '">' +
        '<span class="rbl-pic">' + RB.art(e.art, "", 36) + "</span>" +
        '<span class="rbl-field rbl-field--price"><label class="fx-call-label" for="' + id + '-amount">Amount (£)</label>' +
        '<input class="fx-call-input" id="' + id + '-amount" type="text" inputmode="decimal" maxlength="9" autocomplete="off" data-rbl-amount value="' + esc(amount) + '" aria-label="Amount for ' + esc(what) + '"' + fieldAttrs(id + "-amount-error", amountMsg) + " />" +
        errorHtml(id + "-amount-error", amountMsg) + "</span>" +
        // The page writes "could help" itself: staff type only what follows, so an example can
        // never be published that does not read "£X could help ...".
        '<span class="rbl-field rbl-field--words"><label class="fx-call-label" for="' + id + '-words">What it could help with</label>' +
        '<span class="rbl-could"><span class="rbl-could-fixed" aria-hidden="true">could help</span>' +
        '<input class="fx-call-input" id="' + id + '-words" type="text" maxlength="120" autocomplete="off" data-rbl-words value="' + esc(rest) + '" aria-label="What it could help with, for ' + esc(what) + '"' + fieldAttrs(id + "-words-error", wordsMsg) + " /></span>" +
        errorHtml(id + "-words-error", wordsMsg) + "</span>" +
        showBox(e, what) +
        moveButtons(what, at === 0, at === same.length - 1) +
        '<span class="rbl-links">' +
        '<button class="rbl-link-btn" type="button" data-rbl-picture aria-expanded="' + (chooser === k ? "true" : "false") + '" aria-label="Change picture of ' + esc(what) + '">Change picture</button>' +
        (onWebsite(k) ? "" : '<button class="rbl-link-btn" type="button" data-rbl-remove aria-label="Remove ' + esc(what) + '">Remove</button>') +
        "</span>" +
        (chooser === k ? chooserHtml(e, what) : "") +
        "</li>"
      );
    }

    function itemsHtml(bad) {
      var full = working.items.length >= L.LIMITS.MAX_ITEMS;
      var groups = L.groups()
        .map(function (g) {
          var mine = working.items.filter(function (i) {
            return i.group === g.key;
          });
          var rows = mine
            .map(function (i) {
              return itemRow(i, working.items, bad);
            })
            .join("");
          var none = mine.length ? "" : '<li class="rbl-none">Nothing under this heading. The page leaves the heading out.</li>';
          var add = mayEdit()
            ? '<button class="admin-btn rbl-quiet rbl-add" type="button" data-rbl-add-item="' + esc(g.key) + '" aria-label="Add an item to ' + esc(g.heading) + '"' + (full ? " disabled" : "") + ">Add an item</button>"
            : "";
          return '<div class="rbl-group" data-rbl-group-box="' + esc(g.key) + '"><h4 class="rbl-group-title">' + esc(g.heading) + '</h4><ul class="rbl-rows">' + rows + none + "</ul>" + add + "</div>";
        })
        .join("");
      var listMsg = problemFor(bad, "list", "", "items");
      return (
        '<section class="rbl-card" aria-labelledby="rblItemsHead"><h3 class="admin-subhead" id="rblItemsHead">Pop these in the bag</h3>' +
        '<p class="rbl-intro">The items on the lined paper, under their four headings. A hidden item stays here and comes off the page.' + (full && mayEdit() ? " The list is full: it can have 30 items at most." : "") + "</p>" +
        (listMsg && (showAll || isDirty()) ? '<p class="rbl-error rbl-error--list" data-rbl-list-error>' + esc(listMsg) + "</p>" : "") +
        groups +
        "</section>"
      );
    }

    function examplesHtml(bad) {
      var themes = L.themes()
        .map(function (t) {
          var mine = working.examples.filter(function (e) {
            return e.theme === t.key;
          });
          var rows = mine
            .map(function (e) {
              return exampleRow(e, working.examples, bad);
            })
            .join("");
          var none = mine.length ? "" : '<li class="rbl-none">No examples here. The page leaves this theme out.</li>';
          var full = mine.length >= L.LIMITS.MAX_EXAMPLES_PER_THEME;
          var add = mayEdit()
            ? '<button class="admin-btn rbl-quiet rbl-add" type="button" data-rbl-add-example="' + esc(t.key) + '" aria-label="Add an example to ' + esc(t.title) + '"' + (full ? " disabled" : "") + ">Add an example</button>" +
              (full ? '<span class="rbl-hint">A theme can have 6 examples at most.</span>' : "")
            : "";
          return (
            '<div class="rbl-group" data-rbl-theme-box="' + esc(t.key) + '"><h4 class="rbl-group-title">' + esc(t.title) + '</h4><p class="rbl-group-sub">' + esc(t.sub) + "</p>" +
            '<ul class="rbl-rows">' + rows + none + "</ul>" + add + "</div>"
          );
        })
        .join("");
      return (
        '<section class="rbl-card" aria-labelledby="rblExamplesHead"><h3 class="admin-subhead" id="rblExamplesHead">Whenever the need comes</h3>' +
        '<p class="rbl-intro">The examples a donor can tap, under their three themes. The page writes the amount and "could help" itself, so each one reads like: £30 could help with fresh bedding for a child.</p>' +
        themes +
        "</section>"
      );
    }

    function changeList(lines) {
      return (
        '<ul class="rbl-changes" data-rbl-changes>' +
        lines
          .map(function (t) {
            return "<li>" + esc(t) + "</li>";
          })
          .join("") +
        "</ul>"
      );
    }

    function summaryHtml() {
      var lines = changes().map(function (c) {
        return c.text;
      });
      var dirty = isDirty();
      var out = '<section class="rbl-card rbl-summary" aria-labelledby="rblSummaryHead"><h3 class="admin-subhead" id="rblSummaryHead">Changes</h3>';
      out += '<p class="rbl-count" data-rbl-count>' + esc(L.countLine(lines.length)) + "</p>";
      if (lines.length) out += changeList(lines);
      if (server.draft && !dirty) {
        var by = server.draft.updatedByName ? " by " + esc(server.draft.updatedByName) : "";
        var at = when(server.draft.updatedAt);
        out += '<p class="rbl-hint" data-rbl-draft-meta>Draft last saved' + by + (at ? " on " + esc(at) + " at " + esc(clock(server.draft.updatedAt)) : "") + ".</p>";
      }
      if (confirming === "publish") {
        out +=
          '<div class="rbl-confirm" data-rbl-confirm="publish" role="group" aria-labelledby="rblConfirmTitle">' +
          '<p class="rbl-confirm-title" id="rblConfirmTitle" tabindex="-1">Publish ' + esc(L.changesWords(lines.length)) + " to the website?</p>" +
          "<p>The Fill a Red Bag page will show this to everyone straight away:</p>" +
          changeList(lines) +
          '<div class="rbl-actions"><button class="admin-btn" type="button" data-rbl-yes>Publish now</button>' +
          '<button class="admin-btn rbl-quiet" type="button" data-rbl-no>Not yet</button></div></div>';
      } else if (confirming === "discard") {
        out +=
          '<div class="rbl-confirm" data-rbl-confirm="discard" role="group" aria-labelledby="rblConfirmTitle">' +
          '<p class="rbl-confirm-title" id="rblConfirmTitle" tabindex="-1">Throw away ' + esc(lines.length === 1 ? "this change" : "these changes") + "?</p>" +
          "<p>The draft goes back to what the website shows. The website itself does not change.</p>" +
          '<div class="rbl-actions"><button class="admin-btn" type="button" data-rbl-yes>Throw them away</button>' +
          '<button class="admin-btn rbl-quiet" type="button" data-rbl-no>Keep them</button></div></div>';
      } else if (hasDraft() || dirty) {
        var wait = dirty ? ' disabled aria-describedby="rblSaveFirst"' : "";
        out += '<div class="rbl-actions">';
        out += '<button class="admin-btn rbl-quiet" type="button" data-rbl-preview' + wait + ">Preview the page</button>";
        if (mayEdit()) {
          if (lines.length) out += '<button class="admin-btn" type="button" data-rbl-publish' + wait + ">Publish</button>";
          out += '<button class="rbl-link-btn" type="button" data-rbl-discard>Throw away changes</button>';
        }
        out += "</div>";
        out += dirty
          ? '<p class="rbl-hint" id="rblSaveFirst">' + esc(MSG.saveFirst) + " Preview and Publish use the saved draft.</p>"
          : '<p class="rbl-hint">Preview opens the real page in a new tab, drawn from the draft. Giving is switched off there.</p>';
      }
      return out + "</section>";
    }

    function versionList(list) {
      var groups = L.groups()
        .map(function (g) {
          var mine = list.items.filter(function (i) {
            return i.group === g.key;
          });
          if (!mine.length) return "";
          return (
            "<li><strong>" + esc(g.heading) + ":</strong> " +
            mine
              .map(function (i) {
                return esc(i.name) + " " + esc(RB.pounds(i.pence)) + (i.hidden ? " (hidden)" : "");
              })
              .join(", ") +
            "</li>"
          );
        })
        .join("");
      var themes = L.themes()
        .map(function (t) {
          var mine = list.examples.filter(function (e) {
            return e.theme === t.key;
          });
          if (!mine.length) return "";
          return (
            "<li><strong>" + esc(t.title) + ":</strong> " +
            mine
              .map(function (e) {
                return esc(L.sentence(e)) + (e.hidden ? " (hidden)" : "");
              })
              .join("; ") +
            "</li>"
          );
        })
        .join("");
      return '<ul class="rbl-version-list" data-rbl-version-list>' + groups + themes + "</ul>";
    }

    function versionRow(id, title, sub, now) {
      var open = Object.prototype.hasOwnProperty.call(looking, id);
      var asking = confirming && confirming.restore === id;
      var out = '<li class="rbl-version" data-rbl-version="' + esc(id) + '">';
      out += '<div class="rbl-version-head"><p class="rbl-version-title">' + esc(title) + (now ? ' <span class="admin-pill is-public">On the website now</span>' : "") + "</p>";
      if (sub) out += '<p class="rbl-version-sub">' + esc(sub) + "</p>";
      out += "</div>";
      if (asking) {
        out +=
          '<div class="rbl-confirm" data-rbl-confirm="restore" role="group" aria-labelledby="rblConfirmTitle">' +
          '<p class="rbl-confirm-title" id="rblConfirmTitle" tabindex="-1">Put this list back as a draft?</p>' +
          "<p>" + (hasDraft() || isDirty() ? "It replaces the changes not yet on the website. " : "") + "Nothing changes on the website until you publish.</p>" +
          '<div class="rbl-actions"><button class="admin-btn" type="button" data-rbl-yes>Put it back as a draft</button>' +
          '<button class="admin-btn rbl-quiet" type="button" data-rbl-no>Leave it</button></div></div>';
      } else {
        out += '<div class="rbl-version-actions">';
        out += '<button class="rbl-link-btn" type="button" data-rbl-look aria-expanded="' + (open ? "true" : "false") + '" aria-label="' + esc((open ? "Close: " : "Look at: ") + title) + '">' + (open ? "Close this list" : "Look at this list") + "</button>";
        if (mayEdit()) out += '<button class="rbl-link-btn" type="button" data-rbl-putback aria-label="' + esc("Put back as a draft: " + title) + '">Put back as a draft</button>';
        out += "</div>";
      }
      if (open) out += looking[id] === "failed" ? '<p class="rbl-error">' + esc(MSG.versionFailed) + "</p>" : looking[id] ? versionList(looking[id]) : '<p class="admin-loading">Loading...</p>';
      return out + "</li>";
    }

    function historyHtml() {
      var rows = server.history
        .map(function (h) {
          var n = (h.changes || []).length;
          var title = firstName(h.publishedByName) + " published " + L.changesWords(n) + ", " + when(h.publishedAt);
          return versionRow(String(h.id), title, h.summary, h.id === server.publishedId);
        })
        .join("");
      rows += versionRow("original", "The original list", "The list the page started with. It is always here.", server.publishedId === null);
      return (
        '<section class="rbl-card" aria-labelledby="rblHistoryHead"><h3 class="admin-subhead" id="rblHistoryHead">History</h3>' +
        '<p class="rbl-intro">Every list that has been published, the newest first. Putting one back makes it the draft: it is still previewed and published like any change.</p>' +
        '<ul class="rbl-versions">' + rows + "</ul></section>"
      );
    }

    function barHtml(bad) {
      if (!mayEdit()) return '<p class="rbl-hint rbl-readonly" data-rbl-readonly>' + esc(MSG.readOnly) + "</p>";
      var dirty = isDirty();
      var state = dirty ? MSG.unsaved : hasDraft() ? MSG.allSaved : MSG.nothingToSave;
      var count = bad.length && (showAll || dirty) ? " " + (bad.length === 1 ? "1 thing needs" : bad.length + " things need") + " another look." : "";
      return (
        '<div class="rbl-bar' + (dirty ? " is-dirty" : "") + '" data-rbl-bar>' +
        '<p class="rbl-bar-state" data-rbl-saved-state>' + esc(state + (dirty ? count : "")) + "</p>" +
        '<button class="admin-btn" type="button" data-rbl-save' + (dirty && !busy ? "" : " disabled") + ">Save draft</button>" +
        "</div>"
      );
    }

    function statusHtml() {
      return (
        '<p class="ty-status rbl-status' + (status.kind ? " is-" + status.kind : "") + '" data-rbl-status role="status" aria-live="polite" tabindex="-1">' + esc(status.text) + "</p>" +
        (stale ? '<p class="rbl-stale"><button class="admin-btn" type="button" data-rbl-reload>Reload the list</button></p>' : "")
      );
    }

    function render() {
      if (loadState === "loading" || loadState === "idle") {
        root.innerHTML = '<p class="admin-loading">Loading...</p>';
        return;
      }
      if (loadState === "failed" || !server || !working || !RB || !L) {
        root.innerHTML = '<p class="admin-empty admin-unavailable" data-rbl-failed>' + esc(MSG.failed) + "</p>";
        return;
      }
      var bad = problems();
      root.innerHTML = itemsHtml(bad) + examplesHtml(bad) + summaryHtml() + statusHtml() + barHtml(bad) + historyHtml();
      root.classList.toggle("is-busy", busy);
    }

    // Redraw only what follows the fields, so a box being typed in is never replaced under the cursor.
    function refreshAround(row, kind, key) {
      var bad = problems();
      var fields = kind === "item" ? [["name", "name"], ["price", "pence"]] : [["amount", "pence"], ["words", "words"]];
      fields.forEach(function (f) {
        var id = "rbl-" + key + "-" + f[0];
        var input = doc.getElementById(id);
        var error = doc.getElementById(id + "-error");
        var message = shown(key, f[1]) ? problemFor(bad, kind, key, f[1]) : "";
        if (error) {
          error.textContent = message;
          error.hidden = !message;
        }
        if (input) {
          if (message) input.setAttribute("aria-invalid", "true");
          else input.removeAttribute("aria-invalid");
        }
      });
      replace(".rbl-summary", summaryHtml());
      replace("[data-rbl-bar]", barHtml(bad));
      var listError = root.querySelector("[data-rbl-list-error]");
      var listMsg = problemFor(bad, "list", "", "items");
      if (listError && !listMsg) listError.remove();
    }
    function replace(selector, html) {
      var old = root.querySelector(selector);
      if (!old) return;
      var box = doc.createElement("div");
      box.innerHTML = html;
      if (box.firstChild) old.parentNode.replaceChild(box.firstChild, old);
    }
    function focusOn(selector) {
      var el = selector ? root.querySelector(selector) : null;
      if (el && typeof el.focus === "function") el.focus();
    }
    function say(text, kind) {
      status = { text: text, kind: kind || "" };
    }

    // ---- changing the working list ----
    function rowOf(target) {
      var row = target.closest("[data-rbl-item], [data-rbl-example]");
      if (!row) return null;
      var isItem = row.hasAttribute("data-rbl-item");
      var key = row.getAttribute(isItem ? "data-rbl-item" : "data-rbl-example");
      var list = isItem ? working.items : working.examples;
      var x = find(list, key);
      return x ? { row: row, kind: isItem ? "item" : "example", key: key, list: list, x: x, sel: (isItem ? '[data-rbl-item="' : '[data-rbl-example="') + key + '"]' } : null;
    }
    function move(r, step) {
      var field = r.kind === "item" ? "group" : "theme";
      var same = r.list.filter(function (o) {
        return o[field] === r.x[field];
      });
      var other = same[same.indexOf(r.x) + step];
      if (!other) return false;
      var a = r.list.indexOf(r.x);
      var b = r.list.indexOf(other);
      r.list[a] = other;
      r.list[b] = r.x;
      return true;
    }

    root.addEventListener("input", function (e) {
      var t = e.target;
      if (!working || !mayEdit() || !t || !t.closest) return;
      var r = rowOf(t);
      if (!r) return;
      if (t.hasAttribute("data-rbl-name")) {
        r.x.name = String(t.value).replace(/\s+/g, " ").trim();
        touched[r.key + ":name"] = true;
      } else if (t.hasAttribute("data-rbl-price") || t.hasAttribute("data-rbl-amount")) {
        typed[r.key + ":pence"] = t.value;
        r.x.pence = L.parsePounds(t.value);
        touched[r.key + ":pence"] = true;
      } else if (t.hasAttribute("data-rbl-words")) {
        var rest = String(t.value).replace(/\s+/g, " ").trim();
        r.x.words = rest ? L.COULD_HELP + rest : L.COULD_HELP.trim();
        touched[r.key + ":words"] = true;
      } else return;
      say("", "");
      var line = root.querySelector("[data-rbl-status]");
      if (line) line.textContent = "";
      refreshAround(r.row, r.kind, r.key);
    });

    root.addEventListener("change", function (e) {
      var t = e.target;
      if (!working || !mayEdit() || !t || !t.closest) return;
      var r = rowOf(t);
      if (!r) return;
      if (t.hasAttribute("data-rbl-show")) {
        r.x.hidden = !t.checked;
        render();
        focusOn(r.sel + " [data-rbl-show]");
      } else if (t.hasAttribute("data-rbl-group")) {
        // To the end of its new heading.
        r.x.group = t.value;
        r.list.splice(r.list.indexOf(r.x), 1);
        r.list.push(r.x);
        render();
        focusOn(r.sel + " [data-rbl-group]");
      }
    });

    root.addEventListener("click", function (e) {
      var t = e.target;
      if (!t || !t.closest || busy) return;
      if (t.closest("[data-rbl-reload]")) return void load();
      if (!working || !server) return;

      // Open to anyone who can see the screen.
      if (t.closest("[data-rbl-preview]")) {
        if (typeof win.open === "function") win.open(PREVIEW_URL, "_blank");
        return;
      }
      var look = t.closest("[data-rbl-look]");
      if (look) return void lookAt(look.closest("[data-rbl-version]").getAttribute("data-rbl-version"));
      if (!mayEdit()) return;

      var addItem = t.closest("[data-rbl-add-item]");
      if (addItem) {
        var key = L.newKey("item", allKeys());
        working.items.push({ key: key, name: "", pence: null, group: addItem.getAttribute("data-rbl-add-item"), art: L.PRESENT, hidden: false });
        typed[key + ":pence"] = "";
        chooser = null;
        render();
        return focusOn('[data-rbl-item="' + key + '"] [data-rbl-name]');
      }
      var addExample = t.closest("[data-rbl-add-example]");
      if (addExample) {
        var ek = L.newKey("example", allKeys());
        working.examples.push({ key: ek, theme: addExample.getAttribute("data-rbl-add-example"), pence: null, words: L.COULD_HELP.trim(), art: L.PRESENT, hidden: false });
        typed[ek + ":pence"] = "";
        chooser = null;
        render();
        return focusOn('[data-rbl-example="' + ek + '"] [data-rbl-amount]');
      }

      var r = rowOf(t);
      if (r) {
        if (t.closest("[data-rbl-up]") || t.closest("[data-rbl-down]")) {
          var up = !!t.closest("[data-rbl-up]");
          if (!move(r, up ? -1 : 1)) return;
          render();
          // The same button, if it can still be pressed; the other one at the end of the list.
          var again = root.querySelector(r.sel + (up ? " [data-rbl-up]" : " [data-rbl-down]"));
          return focusOn(r.sel + (again && !again.disabled ? (up ? " [data-rbl-up]" : " [data-rbl-down]") : up ? " [data-rbl-down]" : " [data-rbl-up]"));
        }
        if (t.closest("[data-rbl-picture]")) {
          chooser = chooser === r.key ? null : r.key;
          render();
          return focusOn(chooser ? r.sel + ' [data-rbl-art][aria-pressed="true"]' : r.sel + " [data-rbl-picture]");
        }
        var art = t.closest("[data-rbl-art]");
        if (art) {
          r.x.art = art.getAttribute("data-rbl-art");
          chooser = null;
          render();
          return focusOn(r.sel + " [data-rbl-picture]");
        }
        if (t.closest("[data-rbl-chooser-close]")) {
          chooser = null;
          render();
          return focusOn(r.sel + " [data-rbl-picture]");
        }
        if (t.closest("[data-rbl-remove]") && !onWebsite(r.key)) {
          r.list.splice(r.list.indexOf(r.x), 1);
          if (chooser === r.key) chooser = null;
          render();
          return focusOn(r.kind === "item" ? "[data-rbl-add-item]" : "[data-rbl-add-example]");
        }
      }

      if (t.closest("[data-rbl-save]")) return void save();
      if (t.closest("[data-rbl-publish]")) {
        confirming = "publish";
        render();
        return focusOn("#rblConfirmTitle");
      }
      if (t.closest("[data-rbl-discard]")) {
        confirming = "discard";
        render();
        return focusOn("#rblConfirmTitle");
      }
      var putBack = t.closest("[data-rbl-putback]");
      if (putBack) {
        confirming = { restore: putBack.closest("[data-rbl-version]").getAttribute("data-rbl-version") };
        render();
        return focusOn("#rblConfirmTitle");
      }
      if (t.closest("[data-rbl-no]")) {
        var was = confirming;
        confirming = null;
        render();
        return focusOn(was === "publish" ? "[data-rbl-publish]" : was === "discard" ? "[data-rbl-discard]" : was ? '[data-rbl-version="' + was.restore + '"] [data-rbl-putback]' : null);
      }
      if (t.closest("[data-rbl-yes]")) {
        if (confirming === "publish") return void send("POST", API + "/publish", { version: stamp().version }, MSG.published);
        if (confirming === "discard") {
          // Nothing saved yet: the changes are only on this screen.
          if (!hasDraft()) {
            take(server);
            say(MSG.thrownAway, "ok");
            render();
            return focusOn("[data-rbl-status]");
          }
          return void send("POST", API + "/discard", { version: stamp().version }, MSG.thrownAway);
        }
        if (confirming && confirming.restore) {
          var from = confirming.restore === "original" ? "original" : Number(confirming.restore);
          return void send("POST", API + "/restore", { from: from, version: stamp().version, publishedId: stamp().publishedId }, MSG.putBack);
        }
      }
    });

    // ---- talking to the server ----
    function failedWith(r) {
      if (r && r.status === 409) {
        stale = true;
        say(MSG.stale, "error");
      } else say((r && r.data && r.data.error && r.status < 500 && r.data.error) || MSG.didNotWork, "error");
    }
    function send(method, path, body, done) {
      if (busy) return Promise.resolve(false);
      busy = true;
      root.classList.add("is-busy");
      return ask(method, path, body)
        .then(function (r) {
          busy = false;
          if (!r.ok || !r.data || !r.data.website) {
            confirming = null;
            failedWith(r);
            render();
            focusOn("[data-rbl-status]");
            return false;
          }
          take(r.data);
          say(done, "ok");
          render();
          focusOn("[data-rbl-status]");
          return true;
        })
        .catch(function (err) {
          busy = false;
          if (err && err.message === "unauthorized") return false;
          confirming = null;
          say(MSG.didNotWork, "error");
          render();
          focusOn("[data-rbl-status]");
          return false;
        });
    }
    function save() {
      if (!isDirty() || busy) return Promise.resolve(false);
      var bad = problems();
      if (bad.length) {
        showAll = true;
        say(bad[0].kind === "list" ? bad[0].message : MSG.fixFirst, "error");
        render();
        var first = root.querySelector('[aria-invalid="true"]');
        if (first) first.focus();
        else focusOn("[data-rbl-status]");
        return Promise.resolve(false);
      }
      var at = stamp();
      busy = true;
      root.classList.add("is-busy");
      return ask("PUT", API + "/draft", { data: L.clean(working), version: at.version, publishedId: at.publishedId })
        .then(function (r) {
          busy = false;
          if (!r.ok || !r.data || !r.data.website) {
            if (r.status === 400 && r.data && Array.isArray(r.data.problems)) showAll = true;
            if (r.status === 409 || r.status === 400) failedWith(r);
            else say(MSG.saveFailed, "error");
            // What is on screen stays exactly as it is: nothing typed is lost.
            render();
            focusOn("[data-rbl-status]");
            return false;
          }
          take(r.data);
          say(MSG.saved, "ok");
          render();
          focusOn("[data-rbl-status]");
          return true;
        })
        .catch(function (err) {
          busy = false;
          if (err && err.message === "unauthorized") return false;
          say(MSG.saveFailed, "error");
          render();
          focusOn("[data-rbl-status]");
          return false;
        });
    }
    function lookAt(id) {
      var back = '[data-rbl-version="' + id + '"] [data-rbl-look]';
      if (Object.prototype.hasOwnProperty.call(looking, id)) {
        delete looking[id];
        render();
        return focusOn(back);
      }
      looking[id] = null;
      render();
      focusOn(back);
      return ask("GET", API + "/versions/" + encodeURIComponent(id))
        .then(function (r) {
          if (!Object.prototype.hasOwnProperty.call(looking, id)) return;
          var list = r.ok && r.data && r.data.version ? L.clean(r.data.version.data) : null;
          looking[id] = list || "failed";
          render();
          focusOn(back);
        })
        .catch(function (err) {
          if (err && err.message === "unauthorized") return;
          if (!Object.prototype.hasOwnProperty.call(looking, id)) return;
          looking[id] = "failed";
          render();
        });
    }

    // ---- leaving with unsaved changes ----
    if (typeof win.addEventListener === "function") {
      win.addEventListener("beforeunload", function (e) {
        if (!isDirty()) return undefined;
        e.preventDefault();
        e.returnValue = MSG.leave;
        return MSG.leave;
      });
    }
    // Another section of the admin, My account or Sign out: asked BEFORE app.js hears the click.
    doc.addEventListener(
      "click",
      function (e) {
        if (!isDirty() || view.hidden) return;
        var t = e.target;
        var away = t && t.closest ? t.closest(".admin-nav-link, #accountBtn, #logoutBtn, .admin-brand, [data-rbl-reload]") : null;
        if (!away) return;
        if (away.getAttribute("data-view") === "red-bag") return;
        if (typeof win.confirm === "function" && win.confirm(MSG.leave)) {
          // Leaving: what was typed is let go, so the question is not asked twice.
          if (server) take(server);
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
      },
      true,
    );

    /** The section has been opened from the menu: read the list afresh, unless work is on screen. */
    function open() {
      if (isDirty()) {
        render();
        return Promise.resolve();
      }
      return load();
    }

    // Shown already (app.js opened this section before this file had run): read the list now.
    var app = doc.getElementById("appView");
    if (!view.hidden && app && !app.hidden) load();

    return {
      open: open,
      load: load,
      save: save,
      isDirty: isDirty,
      working: function () {
        return working;
      },
    };
  }

  if (typeof module !== "undefined" && module.exports) module.exports = { initAdminRedBagList: initAdminRedBagList };
  else window.AdminRedBagList = initAdminRedBagList(document, window);
})();
