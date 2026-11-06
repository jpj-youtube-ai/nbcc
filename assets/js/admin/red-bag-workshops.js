// Admin > Fill a Red Bag > Company Workshops (6 November 2026): a company's own link to Fill a Red Bag
// (nbcc.scot/fill/<slug>), whose gifts fill that company's Workshop shelves. Its own file, under the
// list editor on the same view (#view-red-bag in admin.html); its API is
// src/routes/admin-red-bag-workshops.ts. app.js opens it beside the list editor.
//
// What staff do here: add a company (its name, and roughly how many people will see the link, which
// is private and only paces the Workshop), copy its link, download its QR code (PNG or SVG), and put
// it away (its link stops working; its gifts still count) or bring it back. Someone with view access
// sees all of it with no buttons that change anything. Nothing scrolls inside a box. Everything from
// the server is escaped before it is written; the QR codes are SVG our own server drew.
(function () {
  "use strict";

  var TOKEN_KEY = "nbcc_admin_token";
  var API = "/api/admin/red-bag-workshops";
  var SIZES = [
    ["small", "About 20 people (a team or small office)"],
    ["medium", "About 100 people (a company or school)"],
    ["large", "About 500 people (a big employer)"],
  ];

  function esc(s) {
    return String(s === undefined || s === null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
  function pounds(pence) {
    var p = Math.max(0, Math.round(Number(pence) || 0));
    var whole = Math.floor(p / 100);
    var rest = p % 100;
    var shown = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return rest ? "£" + shown + "." + (rest < 10 ? "0" : "") + rest : "£" + shown;
  }
  function bags(n) {
    return n + (n === 1 ? " bag" : " bags");
  }
  /** The link a name would make, as the server makes it (src/db/red-bag-workshops.ts, slugFromName). */
  function slugFromName(name) {
    return String(name || "")
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60)
      .replace(/-+$/g, "");
  }

  function initAdminRedBagWorkshops(doc, win) {
    var view = doc.getElementById("view-red-bag");
    var root = doc.getElementById("rbwRoot");
    if (!view || !root) return null;

    var server = null;
    var status = { text: "", kind: "" };
    var busy = false;
    var draftName = "";
    var draftSize = "medium";

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
    function say(text, kind) {
      status = { text: text, kind: kind || "" };
    }

    function card(w) {
      var may = server.mayEdit;
      var parts = [
        '<li class="rbw-card' + (w.archived ? " is-archived" : "") + '">',
        '<div class="rbw-card__words">',
        "<h4>" + esc(w.name) + (w.archived ? ' <span class="rbw-tag">Put away</span>' : "") + "</h4>",
        '<p class="rbw-link"><a href="' + esc(w.link) + '" target="_blank" rel="noopener">' + esc(w.link.replace(/^https:\/\//, "")) + "</a></p>",
        '<p class="rbw-count"><strong>' + esc(bags(w.bags)) + "</strong> filled, " + esc(pounds(w.pence)) + " given since 1 November</p>",
        '<div class="rbw-actions">',
      ];
      if (!w.archived) {
        parts.push('<button class="admin-btn admin-btn--small" type="button" data-rbw-copy="' + esc(w.link) + '">Copy the link</button>');
        parts.push('<button class="admin-btn admin-btn--small rbl-quiet" type="button" data-rbw-qr="' + w.id + '" data-rbw-format="png" data-rbw-slug="' + esc(w.slug) + '">QR code (PNG)</button>');
        parts.push('<button class="admin-btn admin-btn--small rbl-quiet" type="button" data-rbw-qr="' + w.id + '" data-rbw-format="svg" data-rbw-slug="' + esc(w.slug) + '">QR code (SVG)</button>');
      }
      if (may) {
        parts.push(
          '<button class="admin-btn admin-btn--small rbl-quiet" type="button" data-rbw-archive="' + w.id + '" data-rbw-to="' + (w.archived ? "false" : "true") + '"' + (busy ? " disabled" : "") + ">" + (w.archived ? "Bring it back" : "Put it away") + "</button>",
        );
      }
      parts.push("</div></div>");
      // The code is SVG our own server drew (src/site/qr.ts): it carries no script and no link of its own.
      if (w.qrSvg) parts.push('<div class="rbw-qr" aria-hidden="true">' + w.qrSvg + "</div>");
      parts.push("</li>");
      return parts.join("");
    }

    function render() {
      if (!server) return;
      var list = server.workshops || [];
      var html = [
        '<section class="rbw" aria-labelledby="rbwHeading">',
        '<h3 id="rbwHeading">Company Workshops</h3>',
        '<p class="admin-view-intro">A company\'s own link to Fill a Red Bag. Everyone who gives through it puts bags on that company\'s shelves in the Workshop, and the page shows only theirs, with their name on the sign. Their gifts count towards everyone\'s too. Everyone\'s shelves so far: <strong>' +
          esc(bags(server.everyone.bags)) +
          "</strong>, " +
          esc(pounds(server.everyone.pence)) +
          ".</p>",
      ];
      if (server.mayEdit) {
        var slug = slugFromName(draftName);
        html.push(
          '<form class="rbw-add" data-rbw-form novalidate>',
          '<div class="admin-field"><label for="rbwName">Company name</label><input id="rbwName" name="name" type="text" maxlength="80" autocomplete="off" value="' + esc(draftName) + '" /></div>',
          '<fieldset class="rbw-sizes"><legend>Roughly how many people will see the link?</legend><p class="rbw-hint">Never shown. It sets how quickly their shelves fill up, so a small team sees the Workshop change as quickly as a big company.</p>',
        );
        SIZES.forEach(function (s) {
          html.push('<label class="rbw-size"><input type="radio" name="size" value="' + s[0] + '"' + (draftSize === s[0] ? " checked" : "") + " /> " + esc(s[1]) + "</label>");
        });
        html.push(
          "</fieldset>",
          '<p class="rbw-hint" id="rbwPreview">' + (slug ? "Their link will be <strong>nbcc.scot/fill/" + esc(slug) + "</strong>. It is theirs for good, so check the name first." : "Type the name to see their link.") + "</p>",
          '<button class="admin-btn" type="submit"' + (busy || !slug ? " disabled" : "") + ">Add the company</button>",
          "</form>",
        );
      }
      html.push('<p class="ty-status rbw-status' + (status.kind ? " is-" + status.kind : "") + '" role="status" aria-live="polite">' + esc(status.text) + "</p>");
      html.push(list.length ? '<ul class="rbw-list">' + list.map(card).join("") + "</ul>" : '<p class="rbw-empty">No company has its own Workshop yet.</p>');
      html.push("</section>");
      root.innerHTML = html.join("");
    }

    function load() {
      return ask("GET", API)
        .then(function (r) {
          if (!r.ok) {
            root.innerHTML = '<p class="ty-status is-error" role="status">' + esc(r.data.error || "The company Workshops could not be loaded. Please try again.") + "</p>";
            return;
          }
          server = r.data;
          render();
        })
        .catch(function () {
          /* signed out: the page reloads */
        });
    }

    function add() {
      var slug = slugFromName(draftName);
      if (!slug || busy) return;
      busy = true;
      say("Adding…", "");
      render();
      ask("POST", API, { name: draftName.trim(), size: draftSize })
        .then(function (r) {
          busy = false;
          if (!r.ok) {
            say(r.data.error || "That could not be added. Please try again.", "error");
          } else {
            server = r.data;
            say(draftName.trim() + " has its own Workshop: nbcc.scot/fill/" + slug, "ok");
            draftName = "";
          }
          render();
        })
        .catch(function () {
          busy = false;
        });
    }

    function archive(id, to) {
      if (busy) return;
      busy = true;
      render();
      ask("POST", API + "/" + id + "/archive", { archived: to })
        .then(function (r) {
          busy = false;
          if (r.ok) server = r.data;
          say(r.ok ? (to ? "Put away. Its link no longer works; its gifts still count." : "Brought back. Its link works again.") : r.data.error || "That did not work. Please try again.", r.ok ? "ok" : "error");
          render();
        })
        .catch(function () {
          busy = false;
        });
    }

    // The code is a file behind the admin session, so it is fetched with the token and saved from here.
    function download(id, format, slug) {
      win
        .fetch(API + "/" + id + "/qr?format=" + format, { headers: { Authorization: "Bearer " + token() } })
        .then(function (res) {
          if (!res.ok) throw new Error("no code");
          return res.blob();
        })
        .then(function (blob) {
          var url = win.URL.createObjectURL(blob);
          var a = doc.createElement("a");
          a.href = url;
          a.download = "nbcc-fill-a-red-bag-" + slug + "." + format;
          doc.body.appendChild(a);
          a.click();
          a.parentNode.removeChild(a);
          win.setTimeout(function () {
            win.URL.revokeObjectURL(url);
          }, 1000);
        })
        .catch(function () {
          say("That QR code could not be made. Please try again.", "error");
          render();
        });
    }

    root.addEventListener("input", function (e) {
      if (e.target && e.target.id === "rbwName") {
        draftName = e.target.value;
        var slug = slugFromName(draftName);
        var preview = doc.getElementById("rbwPreview");
        if (preview) preview.innerHTML = slug ? "Their link will be <strong>nbcc.scot/fill/" + esc(slug) + "</strong>. It is theirs for good, so check the name first." : "Type the name to see their link.";
        var submit = root.querySelector("[data-rbw-form] button[type=submit]");
        if (submit) submit.disabled = busy || !slug;
      }
    });
    root.addEventListener("change", function (e) {
      if (e.target && e.target.name === "size") draftSize = e.target.value;
    });
    root.addEventListener("submit", function (e) {
      if (e.target && e.target.hasAttribute("data-rbw-form")) {
        e.preventDefault();
        add();
      }
    });
    root.addEventListener("click", function (e) {
      var b = e.target && e.target.closest ? e.target.closest("button") : null;
      if (!b) return;
      if (b.hasAttribute("data-rbw-copy")) {
        var link = b.getAttribute("data-rbw-copy");
        var done = function () {
          say("Link copied: " + link, "ok");
          render();
        };
        if (win.navigator && win.navigator.clipboard) win.navigator.clipboard.writeText(link).then(done, done);
        else done();
      } else if (b.hasAttribute("data-rbw-qr")) {
        download(b.getAttribute("data-rbw-qr"), b.getAttribute("data-rbw-format"), b.getAttribute("data-rbw-slug"));
      } else if (b.hasAttribute("data-rbw-archive")) {
        archive(b.getAttribute("data-rbw-archive"), b.getAttribute("data-rbw-to") === "true");
      }
    });

    var app = doc.getElementById("appView");
    if (!view.hidden && app && !app.hidden) load();

    return { open: load, load: load };
  }

  if (typeof module !== "undefined" && module.exports) module.exports = { initAdminRedBagWorkshops: initAdminRedBagWorkshops, slugFromName: slugFromName };
  else window.AdminRedBagWorkshops = initAdminRedBagWorkshops(document, window);
})();
