// The fundraising private area, /fundraise/manage (TASK-501; TASK-494 opened it by a 24 hour link,
// which is retired).
//
// Signed out: a box for the organiser's email, which asks POST /api/fundraise/manage/request for a
// code (the server always gives the same answer, so this never tells anyone who is signed up), then
// a box for the 6 digit code, sent to POST /api/fundraise/manage/sign-in. The server answers a right
// code with an http only cookie this script never sees.
//
// Signed in (GET /api/fundraise/manage/me): one card per fundraiser of theirs, copied from the
// hidden pattern in the page: where it is up to, its page and QR code, what it has raised, the
// latest gifts and messages, their details to change (only what differs is sent, and every change
// waits for staff), paying in what they collected (POST .../pay-in opens Stripe), and "I've
// finished". Sign out ends the session.
//
// A classic <script defer>, exported under a CommonJS guard so it can be unit tested in jsdom.
(function () {
  "use strict";

  var API = "/api/fundraise/manage";

  // The details an organiser may ask to change (EDITABLE_FIELDS in src/fundraising/model.ts).
  // kind: how the box is read; nullable: an emptied box is sent as null.
  var FIELDS = [
    { key: "description", kind: "text" },
    { key: "targetPence", kind: "pence", nullable: true },
    { key: "cardLine", kind: "text", nullable: true },
    { key: "eventDate", kind: "text", nullable: true },
    { key: "startTime", kind: "text", nullable: true },
    { key: "endTime", kind: "text", nullable: true },
    { key: "timeTbc", kind: "bool" },
    { key: "venue", kind: "text" },
    { key: "town", kind: "text" },
    { key: "venueAddress", kind: "text", nullable: true },
    { key: "venuePostcode", kind: "text", nullable: true },
    { key: "access", kind: "list" },
    { key: "price", kind: "text", nullable: true },
    { key: "booking", kind: "radio", nullable: true },
    { key: "ticketUrl", kind: "text", nullable: true },
    { key: "ageLimit", kind: "text", nullable: true },
    { key: "dressCode", kind: "text", nullable: true },
    { key: "included", kind: "text", nullable: true },
    { key: "socialLink", kind: "text", nullable: true },
    // TASK-511 review: a sign up made since the form's second round changes these instead.
    { key: "instagram", kind: "text", nullable: true },
    { key: "facebook", kind: "text", nullable: true },
  ];
  // TASK-511 review: the link rules, as the server checks them (assets/js/social-handles.js).
  var LINK_RULES = { instagram: "instagramLink", facebook: "facebookLink" };

  var GIFTS_FIRST = 10;

  var MSG = {
    oldLink: "Links are no longer used. Put in your email address below and we will send you a sign in code.",
    again: "Please sign in again. Put in your email address below and we will send you a new code.",
    trouble: "We could not open your private area just now. Please try again in a few minutes.",
    requestFailed: "We could not send that just now. Please try again in a few minutes.",
    sending: "Sending…",
    newCode: "We have sent a new code, if that email belongs to an approved fundraiser.",
    wrongCode: "That code does not work. Check it, or ask for a new one.",
    tooMany: "Too many tries. Please wait a few minutes and try again.",
    needCode: "Put in the 6 digit code from the email",
    signedOut: "You have signed out.",
    nothing: "You have not changed anything yet.",
    saveFailed: "We could not send your changes just now. Please try again in a few minutes.",
    check: "Please check the highlighted answers below and try again.",
    amount: "Put in an amount from £1 to £10,000",
    payFailed: "Card payments are not working just now. Please try again in a few minutes.",
    opening: "Opening the secure payment page…",
    finishFailed: "We could not send that just now. Please try again in a few minutes.",
    printFailed: "We could not send that just now. Please try again in a few minutes, or give us a call on 01292 811 015.",
  };

  var LONG_DATE = (function () {
    try {
      return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "long", year: "numeric" });
    } catch (e) {
      return null;
    }
  })();

  function longDate(iso) {
    if (!iso) return "";
    try {
      return LONG_DATE ? LONG_DATE.format(new Date(iso)) : String(iso).slice(0, 10);
    } catch (e) {
      return "";
    }
  }

  // £60, £10.01, £1,250.
  function money(pence) {
    var n = Number(pence) || 0;
    var whole = n % 100 === 0;
    try {
      return "£" + (n / 100).toLocaleString("en-GB", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
    } catch (e) {
      return "£" + (whole ? String(n / 100) : (n / 100).toFixed(2));
    }
  }

  // A text box grows with what is typed, so nothing ever scrolls inside it (Jaimie's rule). CSS
  // field-sizing does this where the browser supports it; this does it everywhere else.
  function growTextareas(root) {
    Array.prototype.forEach.call(root.querySelectorAll("textarea"), function (t) {
      function grow() {
        if (!t.scrollHeight) return;
        t.style.height = "auto";
        t.style.height = t.scrollHeight + 4 + "px";
        t.style.overflowY = "hidden";
      }
      t.addEventListener("input", grow);
      t.__frGrow = grow;
      grow();
    });
  }

  // The forms ship hidden (without JavaScript the browser would send them as a web address); the
  // script that can send them properly shows them and hides the line saying so.
  function showForms(doc) {
    Array.prototype.forEach.call(doc.querySelectorAll("form[data-needs-js]"), function (f) {
      f.hidden = false;
    });
    Array.prototype.forEach.call(doc.querySelectorAll("[data-nojs]"), function (n) {
      n.hidden = true;
    });
  }

  function initManage(doc, win) {
    var requestPanel = doc.querySelector("[data-manage-request]");
    var codePanel = doc.querySelector("[data-manage-code]");
    var area = doc.querySelector("[data-manage-area]");
    if (!requestPanel || !codePanel || !area) return null;
    var loading = doc.querySelector("[data-manage-loading]");
    var problem = doc.querySelector("[data-manage-problem]");
    var requestForm = doc.getElementById("manageRequestForm");
    var requestStatus = doc.querySelector("[data-request-status]");
    var codeForm = doc.getElementById("manageCodeForm");
    var codeStatus = doc.querySelector("[data-code-status]");
    var codeEmail = doc.querySelector("[data-code-email]");
    var list = doc.querySelector("[data-manage-list]");
    var none = doc.querySelector("[data-manage-none]");
    var paidThanks = doc.querySelector("[data-paid-thanks]");
    var areaStatus = doc.querySelector("[data-area-status]");
    // The pattern for one fundraiser's card comes off the page, so its ids are never doubled.
    var patternHost = doc.querySelector("[data-manage-pattern]");
    var pattern = patternHost ? patternHost.querySelector("article") : null;
    if (patternHost && patternHost.parentNode) patternHost.parentNode.removeChild(patternHost);
    var email = "";
    showForms(doc);

    function el(id) {
      return doc.getElementById(id);
    }
    function say(node, text, kind) {
      if (!node) return;
      node.textContent = text;
      node.className = "form-status" + (kind ? " is-" + kind : "");
    }
    function validate(form, summary, extra) {
      var shared = win.NBCCFormValidation;
      if (shared && typeof shared.validateForm === "function") {
        if (summary) summary.textContent = MSG.check;
        return shared.validateForm(form, {
          summary: summary || undefined,
          extraChecks: function () {
            return extra || [];
          },
        }).valid;
      }
      return !(extra && extra.length) && (typeof form.checkValidity !== "function" || form.checkValidity());
    }
    function readJson(res) {
      return res.json().then(
        function (data) {
          return { status: res.status, data: data || {} };
        },
        function () {
          return { status: res.status, data: {} };
        },
      );
    }
    function post(url, body) {
      var init = { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin" };
      if (body !== undefined) init.body = JSON.stringify(body);
      return win.fetch(url, init).then(readJson);
    }
    function showOnly(panel) {
      [requestPanel, codePanel, area, loading].forEach(function (p) {
        if (p) p.hidden = p !== panel;
      });
    }
    function toRequest(text) {
      showOnly(requestPanel);
      if (problem) {
        problem.textContent = text || "";
        problem.hidden = !text;
      }
    }

    // --- asking for a code ------------------------------------------------------------------------
    function askForCode(addr, status, then) {
      say(status, MSG.sending, "pending");
      return post(API + "/request", { email: addr })
        .then(function (r) {
          if (r.status === 200) return then(r);
          if (r.status === 400 && status === requestStatus) {
            say(status, "", null);
            return validate(requestForm, null, [{ control: el("manageEmail"), message: "Please give a valid email address." }]);
          }
          say(status, r.data.error || MSG.requestFailed, "error");
        })
        .catch(function () {
          say(status, MSG.requestFailed, "error");
        });
    }

    if (requestForm) {
      requestForm.addEventListener("submit", function (e) {
        e.preventDefault();
        if (!validate(requestForm, null, null)) return;
        var addr = String(el("manageEmail").value || "").trim();
        askForCode(addr, requestStatus, function () {
          email = addr;
          say(requestStatus, "", null);
          if (codeEmail) codeEmail.textContent = addr;
          if (problem) problem.hidden = true;
          showOnly(codePanel);
          var box = el("manageCode");
          if (box) {
            box.value = "";
            try {
              box.focus();
            } catch (err) {
              /* focus unavailable */
            }
          }
        });
      });
    }

    var again = doc.querySelector("[data-code-again]");
    if (again) {
      again.addEventListener("click", function () {
        if (!email) return toRequest("");
        askForCode(email, codeStatus, function () {
          say(codeStatus, MSG.newCode, "success");
        });
      });
    }
    var change = doc.querySelector("[data-code-change]");
    if (change) {
      change.addEventListener("click", function () {
        say(codeStatus, "", null);
        toRequest("");
        var box = el("manageEmail");
        if (box) {
          try {
            box.focus();
          } catch (err) {
            /* focus unavailable */
          }
        }
      });
    }

    // --- signing in with the code -----------------------------------------------------------------
    if (codeForm) {
      codeForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var box = el("manageCode");
        var code = String((box && box.value) || "").replace(/[\s-]/g, "");
        if (!/^\d{6}$/.test(code)) {
          say(codeStatus, "", null);
          validate(codeForm, null, [{ control: box, message: MSG.needCode }]);
          return;
        }
        say(codeStatus, MSG.sending, "pending");
        post(API + "/sign-in", { email: email, code: code })
          .then(function (r) {
            if (r.status === 200) {
              say(codeStatus, "", null);
              return loadArea();
            }
            if (r.status === 429) return say(codeStatus, r.data.error || MSG.tooMany, "error");
            if (r.status === 401 || r.status === 400) return say(codeStatus, r.data.error || MSG.wrongCode, "error");
            say(codeStatus, MSG.trouble, "error");
          })
          .catch(function () {
            say(codeStatus, MSG.trouble, "error");
          });
      });
    }

    // --- signed in ----------------------------------------------------------------------------------
    function loadArea() {
      return win
        .fetch(API + "/me", { credentials: "same-origin" })
        .then(readJson)
        .then(function (r) {
          if (r.status === 200 && r.data && Array.isArray(r.data.fundraisers)) return showArea(r.data.fundraisers);
          if (r.status === 401) return toRequest(problem && !problem.hidden ? problem.textContent : "");
          toRequest(MSG.trouble);
        })
        .catch(function () {
          toRequest(MSG.trouble);
        });
    }

    function showArea(fundraisers) {
      if (list) list.innerHTML = "";
      fundraisers.forEach(function (f) {
        var card = buildCard(f);
        if (card && list) list.appendChild(card);
      });
      if (none) none.hidden = fundraisers.length > 0;
      showOnly(area);
      if (paidThanks && !paidThanks.hidden) {
        try {
          paidThanks.focus();
        } catch (e) {
          /* focus unavailable */
        }
      }
    }

    // Every id in the copy gets the fundraiser's id on the end, and every label and heading
    // reference with it, so two cards never share an id.
    function giveOwnIds(card, fid) {
      var suffix = "-" + fid;
      var ids = {};
      Array.prototype.forEach.call(card.querySelectorAll("[id]"), function (n) {
        ids[n.id] = true;
        n.id = n.id + suffix;
      });
      if (card.id) {
        ids[card.id] = true;
        card.id = card.id + suffix;
      }
      var all = [card].concat(Array.prototype.slice.call(card.querySelectorAll("[for], [aria-labelledby], [aria-describedby]")));
      all.forEach(function (n) {
        ["for", "aria-labelledby", "aria-describedby"].forEach(function (attr) {
          var v = n.getAttribute(attr);
          if (!v) return;
          n.setAttribute(
            attr,
            v
              .split(/\s+/)
              .map(function (t) {
                return ids[t] ? t + suffix : t;
              })
              .join(" "),
          );
        });
      });
    }

    function statusWords(f) {
      if (f.status === "finished") return "Finished. Thank you for everything you raised.";
      if (f.path === "event") {
        // Event pages: an approved public event has its own page as well as its card.
        if (f.public && f.pageUrl) return "Approved. Your event's page is live, and it is on our Get involved page.";
        return f.public ? "Approved. Your event is listed on our Get involved page." : "Approved. It is not shown on our website, as you asked.";
      }
      return f.public ? "Approved. Your page is live." : "Approved. It is not shown on our website, as you asked.";
    }

    function buildCard(f) {
      if (!pattern) return null;
      var card = pattern.cloneNode(true);
      card.setAttribute("data-fundraiser", String(f.id));
      giveOwnIds(card, f.id);
      var q = function (sel) {
        return card.querySelector(sel);
      };
      var event = f.path === "event";

      q("[data-f-title]").textContent = f.title || "";
      q("[data-f-status]").textContent = statusWords(f);
      var pageLine = q("[data-f-page-line]");
      pageLine.hidden = !f.pageUrl;
      if (f.pageUrl) q("[data-f-page]").setAttribute("href", f.pageUrl);

      // The QR code: the page's, so only a page has one.
      var qr = q("[data-f-qr]");
      qr.hidden = !f.qrUrl;
      if (f.qrUrl) {
        var img = q("[data-f-qr-img]");
        img.setAttribute("src", f.qrUrl);
        img.setAttribute("alt", "QR code for " + (f.title || "your page"));
        var dl = q("[data-f-qr-download]");
        dl.setAttribute("href", f.qrUrl);
        dl.setAttribute("download", "nbcc-" + f.slug + "-qr-code.svg");
      }

      // TASK-504: "Your materials", and the print size QR code beside the SVG. The certificate
      // comes once the fundraiser is finished (the server sends its link only then).
      var mats = f.materials || null;
      var png = q("[data-f-qr-png]");
      if (png) {
        png.hidden = !(mats && mats.qrPng);
        if (mats && mats.qrPng) {
          png.setAttribute("href", mats.qrPng);
          png.setAttribute("download", "nbcc-" + f.slug + "-qr-code.png");
        }
      }
      var matsPart = q("[data-f-materials]");
      if (matsPart) {
        matsPart.hidden = !mats;
        if (mats) {
          // TASK-512: the A3 poster and the A5 leaflet too.
          ["poster", "posterA3", "leaflet", "social", "sponsorForm", "certificate"].forEach(function (key) {
            var item = q('[data-f-mat="' + key + '"]');
            if (!item) return;
            item.hidden = !mats[key];
            if (mats[key]) item.querySelector("a").setAttribute("href", mats[key]);
          });
        }
      }
      wirePrint(card, f);

      var m = f.meter || {};
      q("[data-f-raised]").textContent =
        m.targetPence ? money(m.raisedPence) + " raised of your " + money(m.targetPence) + " target" : money(m.raisedPence) + " raised so far";

      fillGifts(card, f.gifts || []);
      // Gifts are made on a page: with no page and nothing given, there is nothing to show.
      var giftsPart = q("[data-f-gifts-part]");
      if (giftsPart) giftsPart.hidden = !f.pageUrl && !(f.gifts && f.gifts.length);
      setWaiting(card, f.waitingEdit);
      fillRequests(card, f.requests);

      // Which details apply: a target for a page raising money, the event details for an event.
      Array.prototype.forEach.call(card.querySelectorAll("[data-event-only]"), function (n) {
        n.hidden = !event;
      });
      Array.prototype.forEach.call(card.querySelectorAll("[data-raising-only]"), function (n) {
        n.hidden = event;
      });
      // Finished (Jaimie's decision): it stays here, with its gifts, QR code and paying in late
      // money, but takes no more changes, and there is nothing left to say it has finished.
      var finished = f.status === "finished";
      if (finished) {
        q("form[data-f-edit]").hidden = true;
        q("[data-f-edit-intro]").hidden = true;
        q("[data-f-edit-closed]").hidden = false;
        q("[data-f-done-part]").hidden = true;
      }
      wireEdit(card, f);
      wirePayIn(card, f);
      wireFinished(card, f);
      growTextareas(card);
      return card;
    }

    // TASK-505: what they asked us for, and where each is up to, in words. Read only. Only a full
    // https address becomes a link (a shout out's post); everything else is text.
    function fillRequests(card, requests) {
      var part = card.querySelector("[data-f-requests]");
      var ul = card.querySelector("[data-f-requests-list]");
      if (!part || !ul) return;
      var list = Array.isArray(requests) ? requests : [];
      part.hidden = list.length === 0;
      var d = card.ownerDocument;
      list.forEach(function (r) {
        var li = d.createElement("li");
        var label = d.createElement("strong");
        label.textContent = String((r && r.label) || "") + ":";
        li.appendChild(label);
        li.appendChild(d.createTextNode(" " + String((r && r.words) || "")));
        if (r && typeof r.link === "string" && /^https:\/\/[^\s"'<>]+$/i.test(r.link)) {
          li.appendChild(d.createTextNode(". "));
          var a = d.createElement("a");
          a.setAttribute("href", r.link);
          a.setAttribute("target", "_blank");
          a.setAttribute("rel", "noopener noreferrer");
          a.textContent = "See the post";
          li.appendChild(a);
        }
        ul.appendChild(li);
      });
    }

    function fillGifts(card, gifts) {
      var ol = card.querySelector("[data-f-gifts]");
      var empty = card.querySelector("[data-f-gifts-empty]");
      var more = card.querySelector("[data-f-gifts-more]");
      empty.hidden = gifts.length > 0;
      gifts.forEach(function (g, i) {
        var li = doc.createElement("li");
        li.className = "fr-wall__item";
        var head = doc.createElement("p");
        head.className = "fr-wall__head";
        var who = doc.createElement("span");
        who.className = "fr-wall__who";
        who.textContent = g.name || "Anonymous";
        head.appendChild(who);
        if (g.amountPence !== null && g.amountPence !== undefined) {
          var amount = doc.createElement("span");
          amount.className = "fr-wall__amount";
          amount.textContent = money(g.amountPence);
          head.appendChild(amount);
        }
        li.appendChild(head);
        if (g.message) {
          var msg = doc.createElement("p");
          msg.className = "fr-wall__msg";
          msg.textContent = g.message;
          li.appendChild(msg);
        }
        var when = doc.createElement("p");
        when.className = "fr-wall__when";
        when.textContent = longDate(g.createdAt);
        li.appendChild(when);
        if (i >= GIFTS_FIRST) li.hidden = true;
        ol.appendChild(li);
      });
      more.hidden = gifts.length <= GIFTS_FIRST;
      more.textContent = "Show all " + gifts.length;
      more.addEventListener("click", function () {
        Array.prototype.forEach.call(ol.querySelectorAll("li"), function (li) {
          li.hidden = false;
        });
        more.hidden = true;
      });
    }

    function setWaiting(card, w) {
      var box = card.querySelector("[data-f-waiting]");
      if (!box) return;
      box.hidden = !w;
      var when = card.querySelector("[data-f-waiting-when]");
      if (w && when) {
        var d = longDate(w.createdAt);
        when.textContent = d ? "You sent it on " + d + "." : "";
      }
    }

    function sessionOver() {
      toRequest(MSG.again);
    }

    // --- changing the details --------------------------------------------------------------------
    function controls(form, key) {
      return Array.prototype.slice.call(form.querySelectorAll('[name="' + key + '"]'));
    }
    function hiddenIn(form, c) {
      var node = c;
      while (node && node !== form) {
        if (node.hidden) return true;
        node = node.parentElement;
      }
      return false;
    }
    function show(form, x, value) {
      var cs = controls(form, x.key);
      if (!cs.length) return;
      if (x.kind === "bool") cs[0].checked = Boolean(value);
      else if (x.kind === "list") {
        var have = Array.isArray(value) ? value : [];
        cs.forEach(function (c) {
          c.checked = have.indexOf(c.value) !== -1;
        });
      } else if (x.kind === "radio") {
        cs.forEach(function (c) {
          c.checked = c.value === value;
        });
      } else if (x.kind === "pence") cs[0].value = value === null || value === undefined ? "" : String(Math.round(Number(value)) / 100);
      else cs[0].value = value === null || value === undefined ? "" : String(value);
    }
    function read(form, x) {
      var cs = controls(form, x.key);
      if (x.kind === "bool") return Boolean(cs[0] && cs[0].checked);
      if (x.kind === "list") {
        return cs
          .filter(function (c) {
            return c.checked;
          })
          .map(function (c) {
            return c.value;
          });
      }
      if (x.kind === "radio") {
        var on = cs.filter(function (c) {
          return c.checked;
        })[0];
        return on ? on.value : null;
      }
      var raw = String((cs[0] && cs[0].value) || "").trim();
      if (x.kind === "pence") {
        if (!raw) return null;
        var p = parseFloat(raw);
        return isFinite(p) ? Math.round(p * 100) : raw;
      }
      if (!raw && x.nullable) return null;
      return raw;
    }
    function same(x, a, b) {
      if (x.kind === "list") return (Array.isArray(a) ? a : []).join("|") === (Array.isArray(b) ? b : []).join("|");
      if (x.kind === "bool") return Boolean(a) === Boolean(b);
      var blank = function (v) {
        return v === null || v === undefined || v === "";
      };
      if (blank(a) && blank(b)) return true;
      return String(a) === String(b);
    }

    function wireEdit(card, f) {
      var form = card.querySelector("form[data-f-edit]");
      if (!form) return;
      var approved = f.editable || {};
      var status = card.querySelector("[data-f-edit-status]");
      var summary = card.querySelector("[data-f-edit-error]");
      var submit = card.querySelector("[data-f-edit-submit]");
      var sent = card.querySelector("[data-f-sent]");
      var shown = {};
      FIELDS.forEach(function (x) {
        shown[x.key] = approved[x.key];
      });
      var w = f.waitingEdit;
      if (w && w.changes) {
        Object.keys(w.changes).forEach(function (k) {
          shown[k] = w.changes[k];
        });
      }
      FIELDS.forEach(function (x) {
        show(form, x, shown[x.key]);
      });

      // TASK-511 review: Instagram and Facebook each in a box of their own for a sign up made since
      // the form's second round; the one link box for one from before. Only boxes shown are sent.
      var two = f.linkBoxes === "two";
      var linkOne = card.querySelector("[data-link-one]");
      var linkTwo = card.querySelector("[data-link-two]");
      if (linkOne) linkOne.hidden = two;
      if (linkTwo) linkTwo.hidden = !two;

      // The ticket link only when tickets are sold on another website.
      var ticket = card.querySelector("[data-ticket-link]");
      function ticketShown() {
        if (ticket) ticket.hidden = read(form, { key: "booking", kind: "radio" }) !== "away";
      }
      controls(form, "booking").forEach(function (c) {
        c.addEventListener("change", ticketShown);
      });
      ticketShown();

      form.addEventListener("submit", function (e) {
        e.preventDefault();
        say(status, "", null);
        var linkProblems = [];
        var rules = win.NBCCSocialHandles;
        Object.keys(LINK_RULES).forEach(function (key) {
          var c = controls(form, key)[0];
          if (!rules || !c || hiddenIn(form, c)) return;
          var r = rules[LINK_RULES[key]](c.value);
          if (r && r.ok === false) linkProblems.push({ control: c, message: r.message });
        });
        if (!validate(form, summary, linkProblems.length ? linkProblems : null)) return;
        var changes = {};
        FIELDS.forEach(function (x) {
          var cs = controls(form, x.key);
          if (!cs.length || hiddenIn(form, cs[0])) return;
          var now = read(form, x);
          if (!same(x, now, approved[x.key])) changes[x.key] = now;
        });
        if (!Object.keys(changes).length) return say(status, MSG.nothing, "error");
        if (submit) submit.disabled = true;
        say(status, MSG.sending, "pending");
        post(API + "/fundraisers/" + encodeURIComponent(f.id) + "/edit", changes)
          .then(function (r) {
            if (submit) submit.disabled = false;
            if (r.status === 202) {
              say(status, "", null);
              setWaiting(card, r.data.edit || { createdAt: new Date().toISOString() });
              if (sent) {
                sent.hidden = false;
                try {
                  sent.focus();
                } catch (err) {
                  /* focus unavailable */
                }
              }
              return;
            }
            if (r.status === 400 && r.data.fields) {
              say(status, "", null);
              var checks = [];
              Object.keys(r.data.fields).forEach(function (k) {
                var cs = controls(form, k);
                if (cs.length) checks.push({ control: cs[0], message: r.data.fields[k] });
              });
              if (checks.length) validate(form, summary, checks);
              else say(status, r.data.fields.form || r.data.error || MSG.saveFailed, "error");
              return;
            }
            if (r.status === 401) return sessionOver();
            say(status, r.data.error || MSG.saveFailed, "error");
          })
          .catch(function () {
            if (submit) submit.disabled = false;
            say(status, MSG.saveFailed, "error");
          });
      });
    }

    // --- paying in ----------------------------------------------------------------------------------
    function wirePayIn(card, f) {
      var form = card.querySelector("form[data-f-payin]");
      if (!form) return;
      var status = card.querySelector("[data-f-payin-status]");
      var submit = card.querySelector("[data-f-payin-submit]");
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        say(status, "", null);
        var box = form.querySelector('[name="amount"]');
        var raw = String((box && box.value) || "").replace(/[£,\s]/g, "");
        var pence = /^\d+(\.\d{1,2})?$/.test(raw) ? Math.round(parseFloat(raw) * 100) : NaN;
        if (!(pence >= 100 && pence <= 1000000)) {
          validate(form, null, [{ control: box, message: MSG.amount }]);
          return;
        }
        if (!validate(form, null, null)) return;
        var cover = form.querySelector('[name="coverFee"]');
        if (submit) submit.disabled = true;
        say(status, MSG.opening, "pending");
        post(API + "/fundraisers/" + encodeURIComponent(f.id) + "/pay-in", { amountPence: pence, coverFee: Boolean(cover && cover.checked) })
          .then(function (r) {
            if (r.status === 200 && r.data.url) return win.location.assign(r.data.url);
            if (submit) submit.disabled = false;
            if (r.status === 401) return sessionOver();
            if (r.status === 400 && r.data.fields && r.data.fields.amountPence) {
              say(status, "", null);
              return validate(form, null, [{ control: box, message: r.data.fields.amountPence }]);
            }
            say(status, r.data.error || MSG.payFailed, "error");
          })
          .catch(function () {
            if (submit) submit.disabled = false;
            say(status, MSG.payFailed, "error");
          });
      });
    }

    // --- I've finished ------------------------------------------------------------------------------
    // TASK-512: "Ask us to print these", beside the posters and the leaflet. Each ask becomes the
    // posters or leaflets request staff track; the words say where it is up to. Only while the
    // fundraiser is approved and still to come (print.canAsk); after that, a line to call us instead.
    function wirePrint(card, f) {
      var print = f.print || null;
      var closed = card.querySelector("[data-f-print-closed]");
      var forms = card.querySelectorAll("form[data-f-print]");
      function show(p) {
        Array.prototype.forEach.call(forms, function (form) {
          var kind = form.getAttribute("data-f-print");
          var line = p && p[kind];
          var status = form.querySelector("[data-f-print-status]");
          if (status && line && line.words) say(status, String(line.words), line.status === "sent" ? "success" : "pending");
        });
      }
      Array.prototype.forEach.call(forms, function (form) {
        form.hidden = !(print && print.canAsk);
      });
      if (closed) closed.hidden = !(print && !print.canAsk);
      if (!print) return;
      show(print);
      Array.prototype.forEach.call(forms, function (form) {
        var kind = form.getAttribute("data-f-print");
        var status = form.querySelector("[data-f-print-status]");
        var button = form.querySelector("button[type=submit]");
        var count = function (name) {
          var input = form.querySelector('input[name="' + name + '"]');
          var raw = input ? String(input.value || "").trim() : "";
          return raw === "" ? 0 : Number(raw);
        };
        form.addEventListener("submit", function (e) {
          e.preventDefault();
          var body = kind === "posters" ? { kind: "posters", a4: count("a4"), a3: count("a3") } : { kind: "leaflets", a5: count("a5") };
          var numbers = kind === "posters" ? [body.a4, body.a3] : [body.a5];
          var total = numbers.reduce(function (n, x) {
            return n + x;
          }, 0);
          if (!numbers.every(function (x) { return Number.isInteger(x) && x >= 0; }) || total < 1) {
            say(status, "Say how many you would like, as a whole number.", "error");
            return;
          }
          if (button) button.disabled = true;
          say(status, MSG.sending, "pending");
          post(API + "/fundraisers/" + encodeURIComponent(f.id) + "/print-request", body)
            .then(function (r) {
              if (button) button.disabled = false;
              if (r.status === 200) {
                form.reset();
                var line = r.data.print && r.data.print[kind];
                return say(status, line && line.words ? String(line.words) : "Thank you. We have your order and will be in touch.", "success");
              }
              if (r.status === 401) return sessionOver();
              var fields = r.data.fields || {};
              var first = fields[Object.keys(fields)[0]];
              say(status, String(first || r.data.error || MSG.printFailed), "error");
            })
            .catch(function () {
              if (button) button.disabled = false;
              say(status, MSG.printFailed, "error");
            });
        });
      });
    }

    function wireFinished(card, f) {
      var button = card.querySelector("[data-f-finished]");
      var thanks = card.querySelector("[data-f-finished-thanks]");
      var status = card.querySelector("[data-f-finished-status]");
      function done() {
        if (button) button.hidden = true;
        if (thanks) thanks.hidden = false;
      }
      if (f.finishedRequestedAt) done();
      if (!button) return;
      button.addEventListener("click", function () {
        button.disabled = true;
        say(status, MSG.sending, "pending");
        post(API + "/fundraisers/" + encodeURIComponent(f.id) + "/finished")
          .then(function (r) {
            button.disabled = false;
            if (r.status === 200) {
              say(status, "", null);
              return done();
            }
            if (r.status === 401) return sessionOver();
            say(status, r.data.error || MSG.finishFailed, "error");
          })
          .catch(function () {
            button.disabled = false;
            say(status, MSG.finishFailed, "error");
          });
      });
    }

    // --- signing out --------------------------------------------------------------------------------
    var out = doc.querySelector("[data-sign-out]");
    if (out) {
      out.addEventListener("click", function () {
        out.disabled = true;
        post(API + "/sign-out")
          .catch(function () {
            return null;
          })
          .then(function () {
            out.disabled = false;
            if (list) list.innerHTML = "";
            toRequest("");
            say(requestStatus, MSG.signedOut, "success");
          });
      });
    }

    // --- opening the page ---------------------------------------------------------------------------
    var params;
    try {
      params = new URLSearchParams(win.location.search || "");
    } catch (e) {
      params = null;
    }
    var oldLink = Boolean(params && params.get("token"));
    var paid = Boolean(params && params.get("paid") === "1");
    if (oldLink || paid) {
      // Out of the address bar: an old link token is never left on screen, in a bookmark or in
      // history, and a reload does not say thank you twice.
      try {
        if (win.history && typeof win.history.replaceState === "function") {
          win.history.replaceState(null, "", win.location.pathname || "/fundraise/manage");
        }
      } catch (e) {
        /* history unavailable */
      }
    }
    if (oldLink && problem) {
      problem.textContent = MSG.oldLink;
      problem.hidden = false;
    }
    if (paid && paidThanks) paidThanks.hidden = false;
    if (areaStatus) say(areaStatus, "", null);

    showOnly(loading);
    if (loading) loading.hidden = false;
    loadArea();

    return { oldLink: oldLink, paid: paid };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { initManage: initManage };
  } else {
    initManage(document, window);
  }
})();
