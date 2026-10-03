// TASK-511: the browser's copy of src/fundraising/social.ts, so the sign up form and the private
// area can tell someone about an Instagram or Facebook box before they press Send. The server is
// still the real check; test/unit/fundraising-social-links.test.ts holds the two to the same answers.
//
// A handle (@name, or just name) or a link, with or without https, is tidied to one full https link;
// anything that is not that website's address is refused in plain words. Written without lookbehind,
// so older phones can read it. A classic script: window.NBCCSocialHandles, and a CommonJS export
// under a guard for the tests.
(function (root) {
  "use strict";

  var SOCIAL_MAX = 300;
  var INSTAGRAM_PROBLEM = "Give your Instagram name, like @yourname, or the link to your Instagram profile.";
  var FACEBOOK_PROBLEM = "Give your Facebook page name, or paste the link to your Facebook page, group or event.";
  var INSTAGRAM_NOT_A_PERSON = ["p", "reel", "reels", "stories", "explore", "accounts", "tv", "direct", "about", "legal"];
  var FACEBOOK_NOT_A_PAGE = ["login", "login.php", "home.php", "sharer", "sharer.php", "dialog", "plugins", "help", "settings"];
  var FACEBOOK_BY_QUERY = ["story.php", "permalink.php", "watch", "photo.php", "video.php"];
  var TRACKING = /^(fbclid|mibextid|ref|refsrc|rdid|share_url|sfnsn|_rdr|_rdc|__tn__|__cft__.*|__xts__.*|utm_.*)$/i;

  function has(list, v) {
    return list.indexOf(v) !== -1;
  }
  // Instagram's rule: letters, numbers, full stops and underscores, up to 30, never starting or
  // ending with a full stop, and never two together.
  function instagramHandle(h) {
    return /^[A-Za-z0-9._]{1,30}$/.test(h) && h.charAt(0) !== "." && h.charAt(h.length - 1) !== "." && h.indexOf("..") === -1;
  }
  function addressParts(typed) {
    var rest = typed.replace(/^https?:\/\//i, "");
    var m = /^([A-Za-z0-9.-]+)(\/[^?#]*)?(\?[^#]*)?(#.*)?$/.exec(rest);
    if (!m) return null;
    return {
      host: m[1].toLowerCase(),
      parts: (m[2] || "").split("/").filter(Boolean),
      query: m[3] || "",
    };
  }
  function looksLikeAddress(typed) {
    return /^https?:\/\//i.test(typed) || typed.indexOf("/") !== -1 || /^((www|m)\.)?(instagram\.com|instagr\.am|facebook\.com|fb\.com)$/i.test(typed);
  }
  function keptQuery(query) {
    var kept = [];
    var pairs = query.replace(/^\?/, "").split("&");
    for (var i = 0; i < pairs.length; i++) {
      var pair = pairs[i];
      if (!pair) continue;
      var at = pair.indexOf("=");
      var key = at === -1 ? pair : pair.slice(0, at);
      var value = at === -1 ? "" : pair.slice(at + 1);
      if (TRACKING.test(key)) continue;
      if (!/^[A-Za-z0-9_]{1,40}$/.test(key) || !/^[A-Za-z0-9._~%-]{1,200}$/.test(value)) return null;
      kept.push(key + "=" + value);
    }
    return kept.length ? kept.join("&") : null;
  }

  function instagramLink(raw) {
    var typed = String(raw == null ? "" : raw).trim();
    if (typed === "") return { ok: true, link: null };
    var refuse = { ok: false, message: INSTAGRAM_PROBLEM };
    if (typed.length > SOCIAL_MAX) return refuse;
    var handle;
    if (looksLikeAddress(typed)) {
      var a = addressParts(typed);
      if (!a || !/^((www|m)\.)?(instagram\.com|instagr\.am)$/.test(a.host)) return refuse;
      var first = a.parts[0] || "";
      if (has(INSTAGRAM_NOT_A_PERSON, first.toLowerCase())) return refuse;
      handle = first.replace(/^@/, "");
    } else {
      handle = typed.replace(/^@/, "");
    }
    if (!instagramHandle(handle)) return refuse;
    return { ok: true, link: "https://www.instagram.com/" + handle.toLowerCase() };
  }

  function facebookLink(raw) {
    var typed = String(raw == null ? "" : raw).trim();
    if (typed === "") return { ok: true, link: null };
    var refuse = { ok: false, message: FACEBOOK_PROBLEM };
    if (typed.length > SOCIAL_MAX) return refuse;
    if (!looksLikeAddress(typed)) {
      var name = typed.replace(/^@/, "");
      return /^[A-Za-z0-9.]{1,80}$/.test(name) ? { ok: true, link: "https://www.facebook.com/" + name } : refuse;
    }
    var a = addressParts(typed);
    if (!a || !/^((www|m|web|mobile|business)\.)?(facebook\.com|fb\.com)$/.test(a.host)) return refuse;
    if (a.parts.length === 0 || a.parts.length > 5) return refuse;
    for (var i = 0; i < a.parts.length; i++) if (!/^[A-Za-z0-9._-]{1,100}$/.test(a.parts[i])) return refuse;
    var first = a.parts[0].toLowerCase();
    if (has(FACEBOOK_NOT_A_PAGE, first)) return refuse;
    if (first === "profile.php") {
      var id = /[?&]id=(\d{1,25})(?:&|$)/.exec(a.query);
      return id && a.parts.length === 1 ? { ok: true, link: "https://www.facebook.com/profile.php?id=" + id[1] } : refuse;
    }
    if (a.parts.length === 1 && has(FACEBOOK_BY_QUERY, first)) {
      var query = keptQuery(a.query);
      return query ? { ok: true, link: "https://www.facebook.com/" + a.parts[0] + "?" + query } : refuse;
    }
    return { ok: true, link: "https://www.facebook.com/" + a.parts.join("/") };
  }

  var api = { instagramLink: instagramLink, facebookLink: facebookLink };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.NBCCSocialHandles = api;
})(typeof window !== "undefined" ? window : this);
