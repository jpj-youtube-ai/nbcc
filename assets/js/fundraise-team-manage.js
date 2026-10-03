// Team pages in the fundraising private area, /fundraise/manage (Jaimie, 2026-10-03).
//
//   - "Your team": the private area's own script (fundraise-manage.js) draws one card per
//     fundraiser once the team organiser has signed in. This one watches for those cards and asks
//     GET /api/fundraise/manage/fundraisers/:id/team for each (a page that is not a team answers
//     404, and gets nothing). A team's card gets the part from <template data-team-pattern>, before
//     "All done?": the join link and a message to forward, each to copy, and who has joined (live and
//     waiting for staff), each with a Remove button that takes them off the team after asking
//     (POST .../team/members/:memberId/remove; staff are told).
//   - "Taking over a team?": someone staff have asked to become a team organiser puts in their email
//     and the code we emailed them (POST /api/fundraise/manage/handover), then signs in as usual.
//
// Kept apart from fundraise-manage.js so each can change without the other. A classic
// <script defer>, exported under a CommonJS guard so it can be unit tested in jsdom.
(function () {
  "use strict";

  var API = "/api/fundraise/manage";
  var WAITING = "Waiting for us to check their page";

  function money(pence) {
    var p = Math.max(0, Math.round(Number(pence) || 0));
    var pounds = Math.floor(p / 100);
    var rest = p % 100;
    return "£" + pounds.toLocaleString("en-GB") + (rest ? "." + String(rest).padStart(2, "0") : "");
  }

  function initTeamManage(doc, win) {
    var list = doc.querySelector("[data-manage-list]");
    var pattern = doc.querySelector("template[data-team-pattern]");

    function say(node, text, kind) {
      if (!node) return;
      node.textContent = text;
      node.className = (node.className.indexOf("fr-share__status") !== -1 ? "fr-share__status" : "form-status") + (kind ? " is-" + kind : "");
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
      return win.fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(body || {}),
      });
    }

    // --- Your team ----------------------------------------------------------------------------------
    function memberItem(m) {
      var li = doc.createElement("li");
      var who = doc.createElement("span");
      who.className = "fr-mine__team-who";
      if (m.pageUrl) {
        var a = doc.createElement("a");
        a.href = m.pageUrl;
        a.target = "_blank";
        a.rel = "noopener";
        a.textContent = m.name;
        who.appendChild(a);
      } else {
        who.textContent = m.name;
      }
      var what = doc.createElement("span");
      what.className = "fr-mine__team-what";
      what.textContent =
        m.status === "waiting"
          ? WAITING
          : money(m.raisedPence) + " raised" + (m.targetPence ? " of " + money(m.targetPence) : "") + (m.status === "finished" ? ", finished" : "");
      var remove = doc.createElement("button");
      remove.type = "button";
      remove.className = "fr-link-btn";
      remove.setAttribute("data-team-remove", String(m.id));
      remove.setAttribute("data-team-name", m.name);
      remove.textContent = "Remove";
      remove.setAttribute("aria-label", "Take " + m.name + " off the team");
      li.appendChild(who);
      li.appendChild(what);
      li.appendChild(remove);
      return li;
    }

    function fill(part, data) {
      var q = function (sel) {
        return part.querySelector(sel);
      };
      q("[data-team-link]").textContent = data.joinUrl || "";
      q("[data-team-forward]").textContent = data.forwardMessage || "";
      var ul = q("[data-team-list]");
      ul.innerHTML = "";
      (data.members || []).forEach(function (m) {
        ul.appendChild(memberItem(m));
      });
      q("[data-team-empty]").hidden = (data.members || []).length > 0;
      part.__team = data;
    }

    function copyText(text) {
      var clip = win.navigator && win.navigator.clipboard;
      return clip && typeof clip.writeText === "function" ? clip.writeText(text) : Promise.reject(new Error("no clipboard"));
    }

    function wire(part, fid) {
      var copies = part.querySelector("[data-team-copies]");
      var clip = win.navigator && win.navigator.clipboard;
      if (copies) copies.hidden = !(clip && typeof clip.writeText === "function");
      var copyStatus = part.querySelector("[data-team-copy-status]");
      var status = part.querySelector("[data-team-status]");
      part.addEventListener("click", function (e) {
        var t = e.target && e.target.closest ? e.target.closest("button") : null;
        if (!t) return;
        if (t.hasAttribute("data-team-copy")) {
          var data = part.__team || {};
          var which = t.getAttribute("data-team-copy");
          copyText(which === "link" ? data.joinUrl : data.forwardMessage).then(
            function () {
              say(copyStatus, which === "link" ? "Join link copied." : "Message copied.");
            },
            function () {
              say(copyStatus, "Copying did not work here. Select the words and copy them instead.");
            },
          );
          return;
        }
        if (t.hasAttribute("data-team-remove")) {
          var id = t.getAttribute("data-team-remove");
          var name = t.getAttribute("data-team-name") || "them";
          var sure =
            typeof win.confirm !== "function" ||
            win.confirm(
              "Take " + name + " off the team? Their page stays up as their own, and what they raise no longer counts towards the team. We will let NBCC know.",
            );
          if (!sure) return;
          t.disabled = true;
          post(API + "/fundraisers/" + encodeURIComponent(fid) + "/team/members/" + encodeURIComponent(id) + "/remove")
            .then(readJson)
            .then(function (r) {
              if (r.status !== 200) {
                t.disabled = false;
                say(status, r.data.error || "We could not do that just now. Please try again in a few minutes.", "error");
                return null;
              }
              return load(fid).then(function (data) {
                if (data) fill(part, data);
                say(status, name + " is off the team. We have let NBCC know.", "success");
              });
            })
            .catch(function () {
              t.disabled = false;
              say(status, "We could not do that just now. Please try again in a few minutes.", "error");
            });
        }
      });
    }

    function load(fid) {
      return win
        .fetch(API + "/fundraisers/" + encodeURIComponent(fid) + "/team", { credentials: "same-origin" })
        .then(readJson)
        .then(function (r) {
          return r.status === 200 ? r.data : null;
        });
    }

    var asked = {};
    function scan() {
      if (!list || !pattern || typeof win.fetch !== "function") return;
      Array.prototype.forEach.call(list.querySelectorAll("[data-fundraiser]"), function (card) {
        var fid = card.getAttribute("data-fundraiser");
        if (!fid || asked[fid] === card || card.querySelector("[data-team-part]")) return;
        asked[fid] = card;
        load(fid)
          .then(function (data) {
            if (!data || !list.contains(card) || card.querySelector("[data-team-part]")) return;
            var part = pattern.content
              ? pattern.content.firstElementChild.cloneNode(true)
              : (function () {
                  var holder = doc.createElement("div");
                  holder.innerHTML = pattern.innerHTML;
                  return holder.firstElementChild;
                })();
            var heading = part.querySelector("h3");
            if (heading) heading.id = "mineTeamHeading-" + fid;
            part.setAttribute("aria-labelledby", "mineTeamHeading-" + fid);
            fill(part, data);
            wire(part, fid);
            var done = card.querySelector("[data-f-done-part]");
            if (done && done.parentNode) done.parentNode.insertBefore(part, done);
            else card.appendChild(part);
          })
          .catch(function () {
            /* the rest of the private area works without it */
          });
      });
    }
    if (list) {
      var Observer = win.MutationObserver || (typeof MutationObserver !== "undefined" ? MutationObserver : null);
      if (Observer) new Observer(scan).observe(list, { childList: true });
      scan();
    }

    // --- Taking over a team ---------------------------------------------------------------------------
    var row = doc.querySelector("[data-handover-row]");
    var open = doc.querySelector("[data-handover-open]");
    var panel = doc.querySelector("[data-manage-handover]");
    var form = doc.getElementById("handoverForm");
    var hStatus = doc.querySelector("[data-handover-status]");
    if (row) row.hidden = false;
    if (open && panel) {
      open.addEventListener("click", function () {
        panel.hidden = !panel.hidden;
        open.setAttribute("aria-expanded", panel.hidden ? "false" : "true");
        if (!panel.hidden) {
          var first = doc.getElementById("handoverEmail");
          try {
            if (first) first.focus();
          } catch (e) {
            /* focus unavailable */
          }
        }
      });
    }
    if (form) {
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var shared = win.NBCCFormValidation;
        if (shared && typeof shared.validateForm === "function" && !shared.validateForm(form, {}).valid) return;
        var email = String(doc.getElementById("handoverEmail").value || "").trim();
        var code = String(doc.getElementById("handoverCode").value || "").trim();
        var btn = form.querySelector("[data-handover-submit]");
        if (btn) btn.disabled = true;
        say(hStatus, "Checking…", "pending");
        post(API + "/handover", { email: email, code: code })
          .then(readJson)
          .then(function (r) {
            if (btn) btn.disabled = false;
            if (r.status === 200) {
              say(hStatus, "You are now the team organiser of " + (r.data.title || "the team") + ". Sign in above with the same email to look after your team.", "success");
              return;
            }
            say(hStatus, r.data.error || "We could not check that just now. Please try again in a few minutes.", "error");
          })
          .catch(function () {
            if (btn) btn.disabled = false;
            say(hStatus, "We could not check that just now. Please try again in a few minutes.", "error");
          });
      });
    }

    return { refresh: scan };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { initTeamManage: initTeamManage };
  } else {
    initTeamManage(document, window);
  }
})();
