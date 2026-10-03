// The fundraising sign up form at /fundraise (TASK-494).
//
// The sign up tidy (Jaimie and the form appropriateness audit, 2026-10-03): one question at a time,
// with Next and Back and a five stage progress bar (assets/js/fundraise-steps.js). Three paths from
// the first question: raising money, holding an event, or a page in memory of someone. Each path is
// asked only what fits it (data-paths on a step or a box), in its own words (data-say-<path>, with
// raising money's words for an event where it has none of its own), and in memory of someone the
// stages have gentler names, nothing is upbeat, and there is no welcome pack.
//
// Sending goes to POST /api/fundraise as JSON. In memory is sent as raising money with inMemory, as
// the server has always taken it. A 400 puts each of the server's plain English messages next to its
// own field (going back to its step), a 404 means fundraising has been switched off meanwhile (the
// gentle "not open yet" panel shows), and success swaps the form for a thank you that says what
// happens next.
//
// The spam check is the contact form's (TASK-490): GET /api/fundraise/captcha, and only when that
// gives a site key AND someone starts on the form is Cloudflare's script loaded. Without a pass, a
// send is held with a message. The server is the real check.
//
// Its own file, never main.js: main.js counts towards donate.html's page weight budget. It uses
// main.js's shared field highlighting (window.NBCCFormValidation) when it is there. A classic
// <script defer>, exported under a CommonJS guard so it can be unit tested in jsdom.
(function () {
  "use strict";

  var StepsLib = null;
  if (typeof module !== "undefined" && module.exports && typeof require === "function") {
    try {
      StepsLib = require("./fundraise-steps.js");
    } catch (e) {
      StepsLib = null;
    }
  }

  var SCRIPT_URL =
    "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=nbccFundraiseTurnstileReady";
  var MSG = {
    sending: "Sending your sign up…",
    waiting: "One moment, we're still checking you're not a robot. Please press Send again in a second.",
    tick: "Please tick the box above Send my sign up to show you're not a robot.",
    captcha: "The check that you're not a robot did not go through. Please try it again, then press Send.",
    broken: "The spam check could not load. Please try again in a moment, or email events@nbcc.scot.",
    busy: "Too many sign ups from here just now. Please try again in a few minutes.",
    failed: "We could not send your sign up just now. Please try again in a moment, or email events@nbcc.scot.",
    check: "Please check the highlighted answers and try again.",
  };

  // The stages of the progress bar, for each path (Jaimie, 2026-10-03). In memory: gentler names,
  // and no lift near the end.
  var STAGES = {
    // Jaimie, 2026-10-03: the fun part first, then who they are.
    raising: ["Your fundraiser", "About you", "Sharing", "What you'd like", "Check and send"],
    event: ["Your event", "About you", "Sharing", "What you'd like", "Check and send"],
    memory: ["About them", "The page", "Your details", "Anything we can send", "Check the details"],
  };
  var LIFT = { 4: "Nearly there!", 5: "Last step!" };

  // The API's field names, and the control each one's message belongs beside.
  var FIELD_CONTROL = {
    path: "pathRaising",
    // kind: the first category in play on the form, whichever it is (controlEl, below).
    title: "title",
    description: "description",
    eventDate: "eventDate",
    dateTbc: "dateTbc",
    startTime: "startTime",
    venue: "venue",
    town: "town",
    targetPence: "target",
    public: "listedYes",
    listed: "listedYes",
    // TASK-511
    kindOther: "kindOther",
    firstName: "firstName",
    lastName: "lastName",
    name: "firstName",
    email: "email",
    phone: "phone",
    instagram: "instagram",
    facebook: "facebook",
    socialLink: "facebook",
    "wants.shoutOut": "shareShout",
    "wants.attend": "attendYes",
    "wants.qrCount": "qrCodes",
    "wants.posterCount": "posters",
    "wants.leafletCount": "leaflets",
    "wants.bucketCount": "buckets",
    "wants.tinCount": "tins",
    "wants.envelopeCount": "envelopes",
    // The combined numbers of a sign up from before the split, if the server ever names them.
    "wants.leaflets": "leaflets",
    "wants.buckets": "buckets",
    wants: "posters",
    postLine1: "postLine1",
    postLine2: "postLine2",
    postTown: "postTown",
    postPostcode: "postPostcode",
    newsletterOk: "newsletterOk",
    cardLine: "cardLine",
    endTime: "endTime",
    timeTbc: "timeTbc",
    venueAddress: "venueAddress",
    venuePostcode: "venuePostcode",
    access: "access-0",
    price: "price",
    booking: "booking-away",
    ticketUrl: "ticketUrl",
    ageLimit: "ageLimit",
    dressCode: "dressCode",
    included: "included",
    creditName: "creditName",
    // Jaimie, 2026-10-03
    over18: "over18Yes",
    sharesWithOther: "sharesYes",
    nbccSharePercent: "nbccSharePercent",
    otherCauseName: "otherCauseName",
    // Team pages (Jaimie, 2026-10-03). A person added is named by place: teamMembers.<n>.<part>.
    team: "teamYes",
    teamShareMode: "teamShareTeam",
    teamMembers: "teamName",
    // In memory (Jaimie, 2026-10-03)
    inMemory: "pathMemory",
    memoryName: "memoryName",
    memoryDates: "memoryDates",
    memorySetupBy: "memorySetupBy-family",
    memoryPermission: "memoryPermission",
    memoryShowTarget: "memoryShowTargetYes",
    // The sign up tidy
    isSporting: "sportingYes",
    tshirtSize: "tshirtSize",
    splitConfirmed: "splitConfirmed",
    childFundraiser: "childMe",
    childFirstName: "childFirstName",
    childConsent: "childConsent",
    forOrganisation: "orgYes",
    orgName: "orgName",
    employerMatch: "matchYes",
    memoryDirectorBusiness: "memoryDirectorBusiness",
    memoryFamilyContactName: "memoryFamilyContactName",
    memoryFamilyContactEmail: "memoryFamilyContactEmail",
    callTime: "callTime",
  };
  // Team pages: the most people a team organiser adds on the form.
  var TEAM_MEMBERS_MAX = 30;
  // The sign up tidy (Jaimie, 2026-10-03): what a No to "Are you 18 or over?" says. The server says the same.
  var UNDER_18 =
    "You need to be 18 or over to sign up. A parent, carer or another adult you trust can do it for you and name you on the page. If you'd like to talk it through, call 01292 811 015 or email events@nbcc.scot.";
  // The answers only an event is asked: what is sent for one, and blanks for anything else.
  var EVENT_TEXT = ["cardLine", "endTime", "venueAddress", "venuePostcode", "price", "ageLimit", "dressCode", "included", "creditName"];
  // In memory, set up by the family: the permission they tick, and its prompt.
  var FAMILY_PERMISSION_MISSING = "Please tick to say the close family are happy for it to go ahead.";
  var PERMISSION_MISSING = "Please tick to say you have the family’s permission.";

  // The server names a field inside a list or an object with dots ("access.0", "wants.tinCount"):
  // the control it belongs beside, or the nearest one that stands for the whole.
  function controlFor(key) {
    if (FIELD_CONTROL[key]) return FIELD_CONTROL[key];
    var top = String(key).split(".")[0];
    return FIELD_CONTROL[top] || key;
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

  // The forms ship hidden (without JavaScript the browser would send them as a web address, names
  // and all); the script that can send them properly shows them and hides the line saying so.
  function showForms(doc, root) {
    Array.prototype.forEach.call((root || doc).querySelectorAll("form[data-needs-js]"), function (f) {
      f.hidden = false;
    });
    Array.prototype.forEach.call(doc.querySelectorAll("[data-nojs]"), function (n) {
      n.hidden = true;
    });
  }

  function initFundraiseForm(doc, win) {
    var form = doc.getElementById("fundraiseForm");
    var openPanel = doc.querySelector("[data-fundraise-open]");
    if (!form || !openPanel || openPanel.hidden) return null;
    showForms(doc, openPanel);

    var closedPanel = doc.querySelector("[data-fundraise-closed]");
    var thanks = doc.querySelector("[data-fundraise-thanks]");
    var status = doc.getElementById("formStatus");
    var summary = form.querySelector("[data-form-error]");
    var submitBtn = form.querySelector("[data-submit]");
    var tokenField = doc.getElementById("captchaToken");
    var captchaBox = doc.getElementById("fundraiseCaptcha");
    var sending = false;
    var wizard = null;

    function el(id) {
      return doc.getElementById(id);
    }
    function val(id) {
      var e = el(id);
      return e ? String(e.value || "").trim() : "";
    }
    function checked(id) {
      var e = el(id);
      return !!(e && e.checked);
    }
    function whole(id) {
      var n = parseInt(val(id), 10);
      return isFinite(n) && n > 0 ? n : 0;
    }
    function radio(name) {
      var r = form.querySelector('input[name="' + name + '"]:checked');
      return r ? r.value : "";
    }
    function say(text, kind) {
      if (!status) return;
      status.textContent = text;
      status.className = "form-status" + (kind ? " is-" + kind : "");
    }
    function need(control, required) {
      if (!control) return;
      control.required = required;
      if (required) control.setAttribute("aria-required", "true");
      else control.removeAttribute("aria-required");
    }
    function needAll(name, required) {
      Array.prototype.forEach.call(form.querySelectorAll('input[name="' + name + '"]'), function (r) {
        need(r, required);
      });
    }
    function inPlayEl(c) {
      for (var n = c; n && n !== doc.body; n = n.parentElement) if (n.hidden) return false;
      return true;
    }
    // The control a server message belongs beside. The categories come from the database, so the
    // category message goes by the first one in play, whichever it is.
    function controlEl(key) {
      if (key === "kind") {
        var kinds = Array.prototype.filter.call(form.querySelectorAll('input[name="kind"]'), inPlayEl);
        return kinds[0] || form.querySelector('input[name="kind"]');
      }
      if (key === "socialOk") return el(path() === "memory" ? "memoryShareYes" : "shareShout");
      // Team pages: "teamMembers.1.email" is the email box of the second person added.
      var person = /^teamMembers\.(\d+)\.(firstName|lastName|email)$/.exec(String(key));
      if (person) {
        var row = form.querySelectorAll("[data-team-row]")[Number(person[1])];
        return row ? row.querySelector('input[data-part="' + person[2] + '"]') : null;
      }
      return el(controlFor(key));
    }

    // --- the three paths ------------------------------------------------------------------------
    function path() {
      return radio("path");
    }
    function memory() {
      return path() === "memory";
    }
    function dateTbc() {
      return path() !== "memory" && path() !== "" && checked("dateTbc");
    }
    /** Is this box or step on the path chosen? Before a path is chosen, only the ones for every path. */
    function onPath(n) {
      var paths = n.getAttribute("data-paths");
      if (!paths) return true;
      return (" " + paths + " ").indexOf(" " + path() + " ") !== -1;
    }
    var pathed = Array.prototype.slice.call(form.querySelectorAll("[data-paths]"));
    /** Show it only when it is on their path AND the condition holds. */
    function shown(n, when) {
      if (!n) return;
      n.hidden = !(onPath(n) && when !== false);
    }

    // The words follow the path: data-say-<path>, else raising money's words for an event, else the
    // words the page was written with. Prompts likewise (data-invalid-<path>).
    var sayings = Array.prototype.slice.call(doc.querySelectorAll("[data-say-raising], [data-say-event], [data-say-memory]"));
    sayings.forEach(function (n) {
      if (!n.hasAttribute("data-say-default")) n.setAttribute("data-say-default", n.textContent);
    });
    var prompted = Array.prototype.slice.call(form.querySelectorAll("[data-invalid-raising], [data-invalid-event], [data-invalid-memory]"));
    prompted.forEach(function (n) {
      if (!n.hasAttribute("data-invalid-default")) n.setAttribute("data-invalid-default", n.getAttribute("data-invalid-message") || "");
    });
    function wordsFor(n, prefix, p) {
      return n.getAttribute(prefix + p) || (p === "event" ? n.getAttribute(prefix + "raising") : null) || n.getAttribute(prefix + "default") || "";
    }
    function applyWords() {
      var p = path();
      sayings.forEach(function (n) {
        // The description's words for a team are its own (applyTeam).
        if (n.hasAttribute("data-say-team") && isTeam()) return;
        var w = wordsFor(n, "data-say-", p);
        if (w && n.textContent !== w) n.textContent = w;
      });
      prompted.forEach(function (n) {
        var w = wordsFor(n, "data-invalid-", p);
        if (w && !n.matches("fieldset")) n.setAttribute("data-invalid-message", w);
      });
      // The categories: every one carries the path's prompt, as any may be the first in play.
      var group = el("kindGroup");
      var kindWords = group ? wordsFor(group, "data-invalid-", p) : "";
      if (kindWords) {
        Array.prototype.forEach.call(form.querySelectorAll('input[name="kind"]'), function (r) {
          r.setAttribute("data-invalid-message", kindWords);
        });
      }
      var other = el("kindOther");
      if (other) other.setAttribute("placeholder", p === "memory" ? other.getAttribute("data-say-memory-placeholder") || "" : "Like a sponsored silence");
    }

    var dateRequired = form.querySelector("[data-date-required]");
    var dateOptional = form.querySelector("[data-date-optional]");
    var venueRequired = form.querySelector("[data-venue-required]");
    var venueOptional = form.querySelector("[data-venue-optional]");
    var eventTimes = form.querySelector("[data-event-times]");
    var targetQ = form.querySelector("[data-target-question]");
    function applyPath() {
      var p = path();
      var event = p === "event";
      pathed.forEach(function (n) {
        n.hidden = !onPath(n);
      });
      applyWords();
      // Jaimie, 2026-10-03: "Not decided yet" makes the date optional (an event's too), and lets it go.
      var tbc = dateTbc();
      var dateBox = el("eventDate");
      need(dateBox, event && !tbc);
      if (dateBox) {
        if (tbc && dateBox.value) dateBox.value = "";
        dateBox.disabled = tbc;
      }
      if (dateRequired) dateRequired.hidden = !event || tbc;
      if (dateOptional) dateOptional.hidden = event;
      // An event's card needs somewhere to say it is.
      need(el("venue"), event);
      if (venueRequired) venueRequired.hidden = !event;
      if (venueOptional) venueOptional.hidden = event;
      if (eventTimes) eventTimes.hidden = !event;
      // Team pages: a team's target is asked with the team, so the page's target goes.
      if (targetQ) targetQ.hidden = isTeam();
      // The one liner under the heading: no welcome pack in memory of someone.
      var lede = doc.querySelector("[data-one-liner]");
      if (lede) {
        var w = p === "memory" ? lede.getAttribute("data-say-memory") : lede.getAttribute("data-say-default");
        if (w && lede.textContent !== w) lede.textContent = w;
      }
    }

    // --- who is fundraising (C4), and for a business, school or group (C5) ------------------------
    function applyWho() {
      var child = path() === "raising" && radio("childFundraiser") === "child";
      shown(form.querySelector("[data-child-fields]"), child);
      need(el("childFirstName"), child);
      need(el("childConsent"), child);
      var org = path() !== "memory" && radio("forOrganisation") === "yes";
      shown(form.querySelector("[data-org-fields]"), org);
      need(el("orgName"), org);
    }

    // --- TASK-511: what Other is, only when it is chosen -------------------------------
    var kindOtherField = form.querySelector("[data-kind-other]");
    function applyKind() {
      var p = path();
      var sporting = radio("isSporting");
      // The sign up tidy: someone raising money sees only the sporting categories for a sporting
      // event, and only the rest otherwise. Other is in both. A choice no longer offered is let go.
      var options = form.querySelector("[data-kind-options]");
      if (options) {
        var labels = Array.prototype.slice.call(options.querySelectorAll("label.fr-option"));
        var count = 0;
        labels.forEach(function (label) {
          var input = label.querySelector("input");
          var isOther = input && input.value === "other";
          var sporty = label.hasAttribute("data-sporty");
          var on = p !== "raising" || !sporting || isOther || (sporting === "yes" ? sporty : !sporty);
          label.hidden = !on;
          if (on) count += 1;
          else if (input && input.checked) input.checked = false;
        });
        options.style.setProperty("--rows", String(Math.max(1, Math.ceil(count / 2))));
      }
      // A choice on the other list (in memory, or not) is let go too.
      Array.prototype.forEach.call(form.querySelectorAll('input[name="kind"]:checked'), function (r) {
        if (!inPlayEl(r) && r.closest && r.closest("[data-paths]") && !onPath(r.closest("[data-paths]"))) r.checked = false;
      });
      var other = radio("kind") === "other";
      if (kindOtherField) kindOtherField.hidden = !other;
      need(el("kindOther"), other);
    }

    // --- the sign up tidy: is it a sporting event, and the T-shirt ---------------------------------
    var tshirtStep = form.querySelector("[data-tshirt-step]");
    function applySporting() {
      var yes = path() === "raising" && radio("isSporting") === "yes";
      if (tshirtStep) tshirtStep.hidden = !yes;
      need(el("tshirtSize"), yes);
    }

    // --- a shout out, and the gentle question in memory ---------------------------------------------
    function applySocial() {
      var m = memory();
      needAll("share", !m && path() !== "");
      needAll("memoryShare", m);
    }

    // --- Jaimie, 2026-10-03: 18 or over ---------------------------------------------------------
    // A No stops the form there: the kind note says what to do instead, Next stays where it is, and
    // nothing is sent. Yes and they carry on.
    var ageNote = form.querySelector("[data-age-note]");
    function under18() {
      return radio("over18") === "no";
    }
    function applyAge() {
      var no = under18();
      var words = no ? UNDER_18 : "";
      if (ageNote && ageNote.textContent !== words) ageNote.textContent = words;
      form.classList.toggle("fr-under-18", no);
    }

    // --- Jaimie, 2026-10-03: sharing with another cause ------------------------------------------
    // NBCC's percentage and the other cause's name, only on a Yes; a No hides and clears them. The
    // sign up tidy: then a step of its own to check the split as it will be shown, ticked as right.
    var splitFields = form.querySelector("[data-split-fields]");
    var splitCheck = form.querySelector("[data-split-check]");
    var splitSeen = "";
    function sharing() {
      return radio("sharesWithOther") === "yes";
    }
    function applySplit() {
      var yes = sharing();
      if (splitFields) splitFields.hidden = !yes;
      ["nbccSharePercent", "otherCauseName"].forEach(function (id) {
        var box = el(id);
        need(box, yes);
        if (!yes && box && box.value) box.value = "";
      });
      if (splitCheck) splitCheck.hidden = !yes;
      need(el("splitConfirmed"), yes);
      var percent = val("nbccSharePercent");
      var cause = val("otherCauseName");
      var now = percent + "|" + cause;
      // A change to the split asks for the tick again: they ticked what they saw.
      if (now !== splitSeen) {
        splitSeen = now;
        var tick = el("splitConfirmed");
        if (tick && tick.checked) tick.checked = false;
      }
      var p = form.querySelector("[data-split-percent]");
      var c = form.querySelector("[data-split-cause]");
      if (p) p.textContent = (percent || "?") + "%";
      if (c) c.textContent = cause || "the other cause";
    }

    // --- Team pages (Jaimie, 2026-10-03): just me, or a team? ------------------------------------
    var teamFields = form.querySelector("[data-team-fields]");
    var teamRows = form.querySelector("[data-team-rows]");
    var teamAdd = form.querySelector("[data-team-add]");
    var teamShare = form.querySelector("[data-team-share]");
    var notTeam = Array.prototype.slice.call(form.querySelectorAll("[data-not-team]"));
    var rowSeq = 0;
    var PARTS = [
      ["firstName", "First name", "text", 50, "Almost! Just add their first name."],
      ["lastName", "Surname", "text", 50, "Almost! Just add their surname."],
      ["email", "Email", "email", 254, "Almost! Just check this email address."],
    ];
    function isTeam() {
      return path() === "raising" && radio("team") === "team";
    }
    function teamRowList() {
      return Array.prototype.slice.call(form.querySelectorAll("[data-team-row]"));
    }
    function applyTeamRows() {
      var list = teamRowList();
      list.forEach(function (li, i) {
        var boxes = Array.prototype.slice.call(li.querySelectorAll("input[data-part]"));
        var any = boxes.some(function (b) {
          return String(b.value || "").trim() !== "";
        });
        boxes.forEach(function (b) {
          need(b, any);
        });
        var remove = li.querySelector("[data-team-remove]");
        if (remove) remove.setAttribute("aria-label", "Remove team member " + (i + 1));
      });
      if (teamAdd) teamAdd.disabled = list.length >= TEAM_MEMBERS_MAX;
    }
    function addTeamRow() {
      if (!teamRows || teamRowList().length >= TEAM_MEMBERS_MAX) return null;
      rowSeq += 1;
      var li = doc.createElement("li");
      li.className = "fr-team-row";
      li.setAttribute("data-team-row", "");
      var row = doc.createElement("div");
      row.className = "fr-row fr-row--three";
      PARTS.forEach(function (p) {
        var id = "teamMember" + rowSeq + "-" + p[0];
        var field = doc.createElement("div");
        field.className = "give-field";
        var label = doc.createElement("label");
        label.setAttribute("for", id);
        label.textContent = p[1];
        var input = doc.createElement("input");
        input.className = "give-field-input";
        input.id = id;
        input.name = id;
        input.type = p[2];
        input.maxLength = p[3];
        input.setAttribute("autocomplete", "off");
        input.setAttribute("data-part", p[0]);
        input.setAttribute("data-invalid-message", p[4]);
        field.appendChild(label);
        field.appendChild(input);
        row.appendChild(field);
      });
      var remove = doc.createElement("button");
      remove.type = "button";
      remove.className = "fr-link-btn fr-team-remove";
      remove.setAttribute("data-team-remove", "");
      remove.textContent = "Remove";
      li.appendChild(row);
      li.appendChild(remove);
      teamRows.appendChild(li);
      applyTeamRows();
      return li;
    }
    if (teamAdd) {
      teamAdd.addEventListener("click", function () {
        var li = addTeamRow();
        var first = li && li.querySelector("input");
        if (first && first.focus) {
          try {
            first.focus();
          } catch (e) {
            /* focus unavailable */
          }
        }
      });
    }
    if (teamRows) {
      teamRows.addEventListener("click", function (e) {
        var btn = e.target && e.target.closest ? e.target.closest("[data-team-remove]") : null;
        if (!btn) return;
        var li = btn.closest("[data-team-row]");
        if (li && li.parentNode) li.parentNode.removeChild(li);
        if (!teamRowList().length) addTeamRow();
        applyTeamRows();
      });
    }
    function applyTeam() {
      var team = isTeam();
      if (teamFields) teamFields.hidden = !team;
      need(el("teamName"), team);
      notTeam.forEach(function (n) {
        n.hidden = team || !onPath(n);
      });
      if (team && teamRows && !teamRowList().length) addTeamRow();
      var shareMode = team && sharing();
      if (teamShare) teamShare.hidden = !shareMode;
      needAll("teamShareMode", shareMode);
      applyTeamRows();
      // The description's words for a team (the appropriateness audit).
      var words = form.querySelector("[data-say-team]");
      if (words) {
        var w = team ? words.getAttribute("data-say-team") : wordsFor(words, "data-say-", path());
        if (w && words.textContent !== w) words.textContent = w;
      }
    }

    // --- In memory of someone (Jaimie, 2026-10-03), now a path of its own ------------------------
    // Who it remembers and who is setting it up are needed; the name for the page and the words about
    // them are optional (staff go through it with them on the phone); with an amount, they are asked
    // whether to show it, with nothing chosen. A funeral director gives the business name.
    var memoryTarget = form.querySelector("[data-memory-target]");
    var titleRequired = form.querySelector("[data-title-required]");
    var titleOptional = form.querySelector("[data-title-optional]");
    var memoryTitleHelp = form.querySelector("[data-memory-title-help]");
    var descRequired = form.querySelector("[data-description-required]");
    var descOptional = form.querySelector("[data-description-optional]");
    var directorFields = form.querySelector("[data-director-fields]");
    var permissionWords = form.querySelector("[data-permission-words]");
    var permissionDefault = permissionWords ? permissionWords.innerHTML : "";
    function inMemory() {
      return memory();
    }
    function applyMemory() {
      var yes = memory();
      need(el("memoryName"), yes);
      need(el("memoryPermission"), yes);
      needAll("memorySetupBy", yes);
      need(el("title"), !yes && !isTeam());
      if (titleRequired) titleRequired.hidden = yes;
      if (titleOptional) titleOptional.hidden = !yes;
      if (memoryTitleHelp) memoryTitleHelp.hidden = !yes;
      need(el("description"), !yes);
      if (descRequired) descRequired.hidden = yes;
      if (descOptional) descOptional.hidden = !yes;
      var who = radio("memorySetupBy");
      var director = yes && who === "funeral_director";
      if (directorFields) directorFields.hidden = !director;
      need(el("memoryDirectorBusiness"), director);
      // The permission, in the words that fit who is setting it up (the appropriateness audit).
      var permission = el("memoryPermission");
      if (permissionWords) {
        var family = who === "family";
        var html = family ? permissionWords.getAttribute("data-say-family") : permissionDefault;
        if (permissionWords.innerHTML !== html) permissionWords.innerHTML = html;
        if (permission) permission.setAttribute("data-invalid-message", family ? FAMILY_PERMISSION_MISSING : PERMISSION_MISSING);
      }
      // Jaimie, A2: the words at the top follow who is setting it up.
      var leadNow = who === "funeral_director" ? "director" : who === "family" || who === "friend" ? "family" : "before";
      Array.prototype.forEach.call(form.querySelectorAll("[data-memory-lead]"), function (n) {
        n.hidden = n.getAttribute("data-memory-lead") !== leadNow;
      });
      var asked = yes && parseFloat(val("target")) > 0;
      if (memoryTarget) memoryTarget.hidden = !asked;
      needAll("memoryShowTarget", asked);
    }

    // --- the ticket link, only for tickets sold on another website ------------------------------
    var ticketField = form.querySelector("[data-ticket-field]");
    function applyBooking() {
      if (ticketField) ticketField.hidden = radio("booking") !== "away";
    }

    // --- what they would like, and the address ----------------------------------------------------
    // Come along: only with a day or a place to come along to. The address: always, for the welcome
    // pack; in memory, only when there is something to send.
    var attend = form.querySelector("[data-attend]");
    var addressField = form.querySelector("[data-address-field]");
    var postedNote = form.querySelector("[data-posted-note]");
    function posted() {
      var m = memory();
      var n = whole("posters") + whole("qrCodes") + (m ? whole("envelopes") : whole("leaflets") + whole("buckets") + whole("tins"));
      return n > 0;
    }
    function applyWants() {
      var m = memory();
      var something = path() === "event" || !!val("eventDate") || !!val("venue");
      var askAttend = !m && path() !== "" && something;
      if (attend) attend.hidden = !askAttend;
      needAll("attend", askAttend);
      var p = posted();
      if (addressField) addressField.hidden = m && !p;
      ["postLine1", "postTown", "postPostcode"].forEach(function (id) {
        need(el(id), !m || p);
      });
      if (postedNote) postedNote.hidden = m || !p;
    }

    // --- characters left -----------------------------------------------------------------------
    var counters = Array.prototype.slice.call(form.querySelectorAll("[data-count-for]"));
    function applyCounts() {
      counters.forEach(function (c) {
        var box = el(c.getAttribute("data-count-for"));
        var max = parseInt(c.getAttribute("data-count-max"), 10) || (box && box.maxLength) || 0;
        if (!box || !max || !box.value) return;
        var left = Math.max(0, max - box.value.length);
        c.textContent = left === 1 ? "1 character left." : left + " characters left.";
      });
    }

    // --- Review fix: Instagram and Facebook, checked as they leave the box -------------------------
    var SOCIAL = { instagram: "instagramLink", facebook: "facebookLink" };
    var socialHelp = {};
    function socialProblem(id) {
      var rules = win.NBCCSocialHandles;
      var box = el(id);
      if (!rules || !box || !SOCIAL[id] || !inPlayEl(box)) return null;
      var r = rules[SOCIAL[id]](box.value);
      return r && r.ok === false ? r.message : null;
    }
    function checkSocial(target) {
      var id = target && target.id;
      if (!SOCIAL[id]) return;
      var help = el(id + "Help");
      if (help && socialHelp[id] === undefined) socialHelp[id] = help.textContent;
      var problem = socialProblem(id);
      if (help) help.textContent = problem || socialHelp[id];
      if (problem) target.setAttribute("aria-invalid", "true");
      else target.removeAttribute("aria-invalid");
    }

    // --- the answers, to check before sending -----------------------------------------------------
    var review = form.querySelector("[data-review]");
    function labelOfChoice(name) {
      var r = form.querySelector('input[name="' + name + '"]:checked');
      var l = r && r.closest ? r.closest("label") : null;
      return l ? String(l.textContent || "").replace(/\s+/g, " ").trim() : "";
    }
    function buildReview() {
      if (!review) return;
      while (review.firstChild) review.removeChild(review.firstChild);
      var m = memory();
      var team = isTeam();
      var rows = [];
      var whatWords = { raising: "Raising money", event: "Holding an event", memory: "A page in memory of someone" };
      rows.push(["What", whatWords[path()] || ""]);
      if (m) rows.push(["In memory of", [val("memoryName"), val("memoryDates")].filter(Boolean).join(", ")]);
      if (path() === "raising" && radio("childFundraiser") === "child") rows.push(["Fundraising", val("childFirstName")]);
      if (!m && radio("forOrganisation") === "yes") rows.push(["For", val("orgName")]);
      var kind = labelOfChoice("kind");
      if (kind === "Other" || kind === "Something else") kind = val("kindOther") || kind;
      rows.push([m ? "How people will give" : "Kind", kind]);
      if (path() === "raising" && radio("isSporting") === "yes") {
        var size = el("tshirtSize");
        rows.push(["T-shirt", size && size.selectedIndex > 0 ? size.options[size.selectedIndex].text : ""]);
      }
      var title = team ? val("teamName") : val("title");
      if (title || !m) rows.push(["Name for it", title || ""]);
      var when = [val("eventDate"), val("startTime")].filter(Boolean).join(" at ");
      if (when) rows.push([m ? "The funeral or service" : "When", when]);
      else if (dateTbc()) rows.push(["When", "Not decided yet"]);
      var where = [val("venue"), val("town")].filter(Boolean).join(", ");
      if (where) rows.push(["Where", where]);
      var amount = team ? val("teamTarget") : val("target");
      if (amount) rows.push([m || path() === "event" ? "Hoping to raise" : "Target", "£" + amount]);
      rows.push(["On Get involved", team ? "Yes, team pages always are" : radio("listed") === "no" ? "No, only people you send the link to" : radio("listed") === "yes" ? "Yes" : ""]);
      rows.push([
        "Sharing",
        sharing() ? val("nbccSharePercent") + "% to NBCC, the rest to " + val("otherCauseName") : radio("sharesWithOther") === "no" ? "No, all of it comes to NBCC" : "",
      ]);
      rows.push(["Your name", [val("firstName"), val("lastName")].join(" ").trim()]);
      rows.push(["Email", val("email")]);
      rows.push(["Phone", val("phone")]);
      if (addressField && !addressField.hidden) {
        rows.push(["Address", [val("postLine1"), val("postLine2"), val("postTown"), val("postPostcode")].filter(Boolean).join(", ")]);
      }
      rows.forEach(function (r) {
        var dt = doc.createElement("dt");
        dt.textContent = r[0];
        var dd = doc.createElement("dd");
        dd.textContent = r[1] || "Not given";
        review.appendChild(dt);
        review.appendChild(dd);
      });
    }

    function applyAll() {
      applyPath();
      applyWho();
      applyTeam();
      applyMemory();
      applyAge();
      applySplit();
      applySporting();
      applyKind();
      applySocial();
      applyBooking();
      applyWants();
      // The team's own target, and in memory's question, after the path (applyPath shows the step).
      if (targetQ) targetQ.hidden = isTeam() || !onPath(targetQ);
    }
    // Review fix: whatever goes wrong in tidying the form, the form still works.
    function safely(work) {
      try {
        work();
      } catch (err) {
        if (win.console && win.console.error) win.console.error("fundraise form:", err);
      }
    }

    // --- the steps: Next, Back and the progress bar (assets/js/fundraise-steps.js) ---------------
    var Steps = win.NBCCFormSteps || StepsLib;
    var steps = Array.prototype.slice.call(form.querySelectorAll("[data-step]"));
    var ageStep = form.querySelector("[data-age-step]");
    if (ageStep) {
      steps.slice(steps.indexOf(ageStep) + 1).forEach(function (step) {
        step.setAttribute("data-after-age", "");
      });
    }
    // The rule the browser cannot check on its own: an event's finish is after its start.
    function finishBeforeStart() {
      if (path() !== "event") return null;
      var start = val("startTime");
      var end = val("endTime");
      return start && end && end <= start ? el("endTime") : null;
    }
    function extraFor(scope, serverFields) {
      return function () {
        var out = [];
        var end = finishBeforeStart();
        if (end && scope.contains(end)) out.push({ control: end, message: "The finish time is before the start." });
        Object.keys(SOCIAL).forEach(function (id) {
          var problem = socialProblem(id);
          var box = el(id);
          if (problem && box && scope.contains(box)) out.push({ control: box, message: problem });
        });
        // A number outside its range (a percentage of 100, a target of 5): the shared check only knows
        // empty and patterns, so each number box in play is held to its own min and max here.
        Array.prototype.forEach.call(scope.querySelectorAll('input[type="number"]'), function (box) {
          var raw = String(box.value || "").trim();
          if (!raw || !inPlayEl(box)) return;
          var n = Number(raw);
          var min = box.getAttribute("min");
          var max = box.getAttribute("max");
          var whole = box.getAttribute("step") === "1";
          var bad = !isFinite(n) || (min !== null && n < Number(min)) || (max !== null && n > Number(max)) || (whole && Math.floor(n) !== n);
          if (bad) out.push({ control: box, message: box.getAttribute("data-invalid-message") || "Please check this number." });
        });
        if (serverFields) {
          Object.keys(serverFields).forEach(function (key) {
            var control = controlEl(key);
            if (control) out.push({ control: control, message: serverFields[key] });
          });
        }
        return out;
      };
    }
    if (Steps && steps.length > 1) {
      wizard = Steps.create(form, {
        doc: doc,
        win: win,
        steps: steps,
        nav: form.querySelector("[data-step-nav]"),
        progress: form.querySelector("[data-progress]"),
        news: form.querySelector("[data-step-news]"),
        stageOf: function (step) {
          var m = memory() && step.getAttribute("data-stage-memory");
          return Number(m || step.getAttribute("data-stage")) || 1;
        },
        // In memory the address comes after what to send (it is only asked when something is), though
        // the page has it with Your details, where it belongs for everyone else.
        orderOf: function (step) {
          var m = memory() && step.getAttribute("data-stage-memory");
          var stage = Number(m || step.getAttribute("data-stage")) || 1;
          return memory() && step === addressField ? stage + 0.5 : stage;
        },
        stages: function () {
          return STAGES[path()] || STAGES.raising;
        },
        lift: function (at) {
          return memory() ? "" : LIFT[at] || "";
        },
        validate: function (step) {
          return Steps.checkStep(win, step, extraFor(step, null));
        },
        canLeave: function (step) {
          // Under 18: Next stays here. The note says what to do instead.
          if (step === ageStep && under18()) {
            applyAge();
            try {
              el("over18No").focus();
            } catch (e) {
              /* focus unavailable */
            }
            return false;
          }
          return true;
        },
        onShow: function (step) {
          if (step.hasAttribute("data-review-step")) safely(buildReview);
          if (summary) summary.hidden = true;
        },
      });
    }

    form.addEventListener("change", function (e) {
      safely(applyAll);
      safely(function () {
        checkSocial(e && e.target);
      });
      if (wizard) safely(wizard.refresh);
    });
    form.addEventListener("input", function () {
      safely(applyWho);
      safely(applyWants);
      safely(applyTeamRows);
      safely(applyMemory);
      safely(applySplit);
      safely(applyCounts);
      if (wizard) safely(wizard.refresh);
    });
    applyAll();
    if (wizard) wizard.refresh();

    // --- the spam check, loaded only when needed ------------------------------------------------
    var captcha = { on: false, siteKey: null, loading: false, widgetId: null, broken: false, interactive: false };

    function renderCaptcha() {
      if (captcha.widgetId !== null || !win.turnstile || !captchaBox) return;
      captchaBox.hidden = false;
      var room = form.clientWidth || 400;
      captcha.widgetId = win.turnstile.render(captchaBox, {
        sitekey: captcha.siteKey,
        size: room >= 340 ? "flexible" : "compact",
        callback: function (token) {
          tokenField.value = token;
          captcha.broken = false;
          captcha.interactive = false;
        },
        "expired-callback": function () {
          tokenField.value = "";
        },
        "timeout-callback": function () {
          tokenField.value = "";
        },
        "error-callback": function () {
          tokenField.value = "";
          captcha.broken = true;
        },
        "before-interactive-callback": function () {
          captcha.interactive = true;
        },
      });
    }

    function loadCaptcha() {
      if (!captcha.on || captcha.loading) return;
      captcha.loading = true;
      win.nbccFundraiseTurnstileReady = renderCaptcha;
      var s = doc.createElement("script");
      s.src = SCRIPT_URL;
      s.async = true;
      s.defer = true;
      s.onerror = function () {
        captcha.broken = true;
        captcha.loading = false;
        if (s.parentNode) s.parentNode.removeChild(s);
      };
      doc.head.appendChild(s);
    }

    function resetCaptcha() {
      if (tokenField) tokenField.value = "";
      if (win.turnstile && captcha.widgetId !== null) win.turnstile.reset(captcha.widgetId);
    }

    form.addEventListener("focusin", loadCaptcha);
    form.addEventListener("input", loadCaptcha);

    if (typeof win.fetch === "function") {
      win
        .fetch("/api/fundraise/captcha")
        .then(function (res) {
          return res && res.ok ? res.json() : null;
        })
        .then(function (data) {
          if (!data || !data.siteKey) return;
          captcha.siteKey = data.siteKey;
          captcha.on = true;
          if (form.contains(doc.activeElement)) loadCaptcha();
        })
        .catch(function () {
          /* Could not ask: the server still checks if the check is on. */
        });
    }

    // --- an invite from the team (TASK-503) ---------------------------------------------------------
    // Opened from a staff invite's link (/fundraise?invite=...): ask the server for it, by POST so
    // the token never sits in an address, and fill in the first name, surname and email, nothing
    // else, leaving anything already typed. The sign up carries it back so the invite is marked
    // used. A link that no longer works changes nothing.
    var inviteToken = null;
    var inviteMatch = /[?&]invite=([A-Za-z0-9_-]{43})(?:&|$)/.exec((win.location && win.location.search) || "");
    if (inviteMatch && typeof win.fetch === "function") {
      var asked = win.fetch("/api/fundraise/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: inviteMatch[1] }),
      });
      // Asked: now take the token out of the address bar and the history (as the private area
      // does), keeping anything else in the address. The sign up still carries it back.
      if (win.history && typeof win.history.replaceState === "function") {
        try {
          var rest = String(win.location.search || "")
            .replace(/^\?/, "")
            .split("&")
            .filter(function (part) { return part && !/^invite=/.test(part); })
            .join("&");
          win.history.replaceState(win.history.state, "", (win.location.pathname || "/fundraise") + (rest ? "?" + rest : "") + (win.location.hash || ""));
        } catch (e) {
          /* The address stays as it was; nothing else changes. */
        }
      }
      asked
        .then(function (res) {
          return res && res.ok ? res.json() : null;
        })
        .then(function (data) {
          if (!data) return;
          inviteToken = inviteMatch[1];
          // Jaimie 2026-10-03: staff type the first name and surname in their own boxes, and they
          // come back exactly. An answer with only one name (from before) is split as TASK-511 did:
          // the first word, and the rest as the surname.
          var first = "";
          var last = "";
          if (typeof data.firstName === "string") {
            first = data.firstName.trim();
            last = typeof data.lastName === "string" ? data.lastName.trim() : "";
          } else if (typeof data.name === "string") {
            var parts = data.name.trim().split(/\s+/);
            first = parts[0] || "";
            last = parts.slice(1).join(" ");
          }
          [["firstName", first], ["lastName", last], ["email", data.email]].forEach(function (pair) {
            var box = el(pair[0]);
            if (box && !String(box.value || "").trim() && typeof pair[1] === "string" && pair[1]) box.value = pair[1];
          });
          applyAll();
          if (wizard) wizard.refresh();
        })
        .catch(function () {
          /* Could not ask: the form works the same without it. */
        });
    }

    // --- Do it again, from the year on email (TASK-515) ---------------------------------------------
    // Opened from email 18's link (/fundraise?again=...): ask the server for last year's details, by
    // POST, take the token out of the address at once, and fill in only the boxes still empty (and a
    // choice not yet made). Never the date or the address: those are this year's. The sign up carries
    // the token back so the link is used once. A link that no longer works changes nothing.
    var againToken = null;
    var againMatch = /[?&]again=([A-Za-z0-9_-]{43})(?:&|$)/.exec((win.location && win.location.search) || "");
    if (againMatch && typeof win.fetch === "function") {
      var againAsked = win.fetch("/api/fundraise/again", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: againMatch[1] }),
      });
      if (win.history && typeof win.history.replaceState === "function") {
        try {
          var againRest = String(win.location.search || "")
            .replace(/^\?/, "")
            .split("&")
            .filter(function (part) { return part && !/^again=/.test(part); })
            .join("&");
          win.history.replaceState(win.history.state, "", (win.location.pathname || "/fundraise") + (againRest ? "?" + againRest : "") + (win.location.hash || ""));
        } catch (e) {
          /* The address stays as it was; nothing else changes. */
        }
      }
      againAsked
        .then(function (res) {
          return res && res.ok ? res.json() : null;
        })
        .then(function (data) {
          if (!data) return;
          againToken = againMatch[1];
          // A choice, only when none is made yet, and only one the form offers.
          ["path", "kind"].forEach(function (name) {
            if (radio(name) || typeof data[name] !== "string") return;
            var pick = form.querySelector('input[name="' + name + '"][value="' + String(data[name]).replace(/[^a-z0-9_]/gi, "") + '"]');
            if (pick) pick.checked = true;
          });
          var target = typeof data.targetPence === "number" && data.targetPence > 0 ? String(data.targetPence % 100 === 0 ? data.targetPence / 100 : (data.targetPence / 100).toFixed(2)) : "";
          [
            ["title", data.title], ["description", data.description], ["target", target], ["venue", data.venue], ["town", data.town],
            ["kindOther", data.kindOther], ["instagram", data.instagram], ["facebook", data.facebook], ["firstName", data.firstName],
            ["lastName", data.lastName], ["email", data.email], ["phone", data.phone],
          ].forEach(function (pair) {
            var box = el(pair[0]);
            if (box && !String(box.value || "").trim() && typeof pair[1] === "string" && pair[1]) box.value = pair[1];
          });
          applyAll();
          if (wizard) wizard.refresh();
        })
        .catch(function () {
          /* Could not ask: the form works the same without it. */
        });
    }

    // --- checking and sending -------------------------------------------------------------------
    // The whole form, before sending (and with the server's messages after). Anything wrong: back to
    // the first step with a problem, with the focus on it.
    function validate(serverFields) {
      var shared = win.NBCCFormValidation;
      var ok;
      if (shared && typeof shared.validateForm === "function") {
        if (summary) summary.textContent = MSG.check;
        ok = shared.validateForm(form, { summary: summary, extraChecks: extraFor(form, serverFields) }).valid;
      } else if (serverFields) {
        say(Object.keys(serverFields).map(function (k) { return serverFields[k]; }).join(" "), "error");
        ok = false;
      } else if (finishBeforeStart()) {
        say("The finish time is before the start.", "error");
        ok = false;
      } else {
        ok = typeof form.checkValidity !== "function" || form.checkValidity();
      }
      if (!ok && wizard) {
        var flagged = form.querySelector('[aria-invalid="true"]');
        var step = flagged ? wizard.stepOf(flagged) : null;
        if (step) {
          wizard.goTo(step);
          if (summary) summary.hidden = true;
          try {
            flagged.focus();
          } catch (e) {
            /* focus unavailable */
          }
        }
      }
      return ok;
    }

    // TASK-511: a yes or no: true, false, or null when not answered (the server asks for it).
    function yesNo(name) {
      var v = radio(name);
      return v === "yes" ? true : v === "no" ? false : null;
    }

    function wholePence(pounds) {
      return isFinite(pounds) && pounds > 0 ? Math.round(pounds * 100) : null;
    }

    function payload() {
      var p = path();
      var m = p === "memory";
      var event = p === "event";
      var raising = p === "raising";
      var pounds = parseFloat(val("target"));
      var addressOn = addressField && !addressField.hidden;
      var booking = event ? radio("booking") : "";
      var access = event
        ? Array.prototype.filter
            .call(form.querySelectorAll('input[name="access"]'), function (b) {
              return b.checked;
            })
            .map(function (b) {
              return b.value;
            })
        : [];
      // Team pages: a team's name and target are the page's.
      var team = isTeam();
      var teamPounds = parseFloat(val("teamTarget"));
      var share = radio("share");
      var attendAsked = attend && !attend.hidden;
      var body = {
        // In memory is sent as raising money, with inMemory, as the server has always taken it.
        path: m ? "raising" : p,
        kind: radio("kind"),
        kindOther: radio("kind") === "other" ? val("kindOther") : "",
        title: team ? val("teamName") : val("title"),
        description: val("description"),
        eventDate: dateTbc() ? "" : val("eventDate"),
        dateTbc: dateTbc() && !val("eventDate"),
        startTime: m ? "" : val("startTime"),
        venue: val("venue"),
        town: m ? "" : val("town"),
        targetPence: wholePence(team ? teamPounds : pounds),
        // The sign up tidy (C2): every sign up gets a page; listed says whether it goes on Get involved.
        public: true,
        listed: team ? true : yesNo("listed"),
        firstName: val("firstName"),
        lastName: val("lastName"),
        email: val("email"),
        phone: val("phone"),
        instagram: m ? "" : val("instagram"),
        facebook: m ? "" : val("facebook"),
        socialOk: m ? yesNo("memoryShare") : share ? share !== "no" : null,
        // Jaimie, 2026-10-03: never filled in for them, by an invite or Do it again.
        over18: yesNo("over18"),
        sharesWithOther: yesNo("sharesWithOther"),
        nbccSharePercent: sharing() ? val("nbccSharePercent") : null,
        otherCauseName: sharing() ? val("otherCauseName") : "",
        splitConfirmed: sharing() && checked("splitConfirmed"),
        // In memory: its own path, and the answers only for it.
        inMemory: m ? true : raising ? false : null,
        memoryName: m ? val("memoryName") : "",
        memoryDates: m ? val("memoryDates") : "",
        memorySetupBy: m ? radio("memorySetupBy") : "",
        memoryPermission: m && checked("memoryPermission"),
        memoryShowTarget: m && isFinite(pounds) && pounds > 0 ? yesNo("memoryShowTarget") : null,
        memoryDirectorBusiness: m && radio("memorySetupBy") === "funeral_director" ? val("memoryDirectorBusiness") : "",
        memoryFamilyContactName: m && radio("memorySetupBy") === "funeral_director" ? val("memoryFamilyContactName") : "",
        memoryFamilyContactEmail: m && radio("memorySetupBy") === "funeral_director" ? val("memoryFamilyContactEmail") : "",
        callTime: m ? val("callTime") : "",
        // The sign up tidy: sport and the T-shirt (raising money), a child, and a business.
        isSporting: raising ? yesNo("isSporting") : null,
        tshirtSize: raising && radio("isSporting") === "yes" ? val("tshirtSize") : "",
        childFundraiser: raising ? radio("childFundraiser") || null : null,
        childFirstName: raising && radio("childFundraiser") === "child" ? val("childFirstName") : "",
        childConsent: raising && radio("childFundraiser") === "child" && checked("childConsent"),
        forOrganisation: m ? null : yesNo("forOrganisation"),
        orgName: !m && radio("forOrganisation") === "yes" ? val("orgName") : "",
        employerMatch: !m && radio("forOrganisation") === "yes" ? radio("employerMatch") || null : null,
        wants: {
          posterCount: whole("posters"),
          leafletCount: m ? 0 : whole("leaflets"),
          bucketCount: m ? 0 : whole("buckets"),
          tinCount: m ? 0 : whole("tins"),
          qrCount: whole("qrCodes"),
          envelopeCount: m ? whole("envelopes") : 0,
          shoutOut: m ? false : share ? share === "shout" : null,
          attend: attendAsked ? yesNo("attend") : false,
        },
        postLine1: addressOn ? val("postLine1") : "",
        postLine2: addressOn ? val("postLine2") : "",
        postTown: addressOn ? val("postTown") : "",
        postPostcode: addressOn ? val("postPostcode") : "",
        newsletterOk: !m && checked("newsletterOk"),
      };
      EVENT_TEXT.forEach(function (k) {
        body[k] = event ? val(k) : "";
      });
      body.timeTbc = event && checked("timeTbc");
      body.access = access;
      body.booking = booking;
      body.ticketUrl = booking === "away" ? val("ticketUrl") : "";
      // Team pages: every row in order (the server names a problem by its place), even an empty one.
      body.team = raising ? radio("team") || null : "me";
      body.teamShareMode = team && sharing() ? radio("teamShareMode") || null : null;
      body.teamMembers = team
        ? teamRowList().map(function (li) {
            var part = function (name) {
              var b = li.querySelector('input[data-part="' + name + '"]');
              return b ? String(b.value || "").trim() : "";
            };
            return { firstName: part("firstName"), lastName: part("lastName"), email: part("email") };
          })
        : [];
      body.company = val("company");
      body.captchaToken = tokenField ? tokenField.value : "";
      if (inviteToken) body.invite = inviteToken;
      if (againToken) body.again = againToken; // TASK-515
      return body;
    }

    function done(body) {
      var first = String(body.firstName || "").split(/\s+/)[0] || "";
      var nameSlot = doc.querySelector("[data-thanks-name]");
      if (nameSlot) nameSlot.textContent = first ? ", " + first : "";
      var m = body.inMemory === true;
      var steps = doc.querySelector("[data-thanks-steps]");
      var memorySteps = doc.querySelector("[data-thanks-memory]");
      if (steps) steps.hidden = m;
      if (memorySteps) memorySteps.hidden = !m;
      var listed = doc.querySelector("[data-thanks-listed]");
      if (listed) listed.hidden = body.listed === false;
      var teamLine = doc.querySelector("[data-thanks-team]");
      if (teamLine) teamLine.hidden = body.team !== "team";
      // In memory (the appropriateness audit): gently, and only a short receipt has gone.
      var eyebrow = doc.querySelector("[data-thanks-eyebrow]");
      if (eyebrow) eyebrow.textContent = m ? "Thank you" : "Sign up received";
      var emailed = doc.querySelector("[data-thanks-emailed]");
      if (emailed && m) emailed.textContent = "We have your details, and we have sent you a short email to say so. Here is what happens next.";
      openPanel.hidden = true;
      if (thanks) {
        thanks.hidden = false;
        try {
          thanks.focus();
          if (thanks.scrollIntoView) thanks.scrollIntoView({ block: "start" });
        } catch (e) {
          /* focus unavailable */
        }
      }
    }

    function closed() {
      openPanel.hidden = true;
      if (closedPanel) {
        closedPanel.hidden = false;
        closedPanel.setAttribute("tabindex", "-1");
        try {
          closedPanel.focus();
        } catch (e) {
          /* focus unavailable */
        }
      }
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (sending) return;
      // Enter in a box before the last step is Next, not Send.
      if (wizard && !wizard.isLast()) {
        wizard.next();
        return;
      }
      say("", null);
      // Under 18: nothing is sent. The note says what to do instead.
      if (under18()) {
        applyAge();
        if (wizard && ageStep) wizard.goTo(ageStep);
        try {
          el("over18No").focus();
        } catch (err) {
          /* focus unavailable */
        }
        return;
      }
      if (!validate(null)) return;
      if (captcha.on && !tokenField.value) {
        loadCaptcha();
        say(captcha.broken ? MSG.broken : captcha.interactive ? MSG.tick : MSG.waiting, captcha.broken ? "error" : "pending");
        return;
      }
      if (typeof win.fetch !== "function") {
        say(MSG.failed, "error");
        return;
      }
      var body = payload();
      sending = true;
      if (submitBtn) submitBtn.disabled = true;
      say(MSG.sending, "pending");
      win
        .fetch("/api/fundraise", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
        .then(function (res) {
          return res.json().then(
            function (data) {
              return { status: res.status, data: data || {} };
            },
            function () {
              return { status: res.status, data: {} };
            },
          );
        })
        .then(function (r) {
          sending = false;
          if (submitBtn) submitBtn.disabled = false;
          if (r.status === 200) {
            say("", null);
            done(body);
            return;
          }
          if (r.status === 404) {
            say("", null);
            closed();
            return;
          }
          resetCaptcha();
          if (r.status === 400 && r.data.error === "captcha") return say(MSG.captcha, "error");
          if (r.status === 400 && r.data.fields) {
            say("", null);
            validate(r.data.fields);
            return;
          }
          say(r.status === 429 ? MSG.busy : MSG.failed, "error");
        })
        .catch(function () {
          sending = false;
          if (submitBtn) submitBtn.disabled = false;
          say(MSG.failed, "error");
        });
    });

    growTextareas(form);
    return { payload: payload, steps: wizard, inMemory: inMemory };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { initFundraiseForm: initFundraiseForm };
  } else {
    initFundraiseForm(document, window);
  }
})();
