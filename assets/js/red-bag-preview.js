// Fill a Red Bag: the staff preview's way in, while the page is switched off.
//
// /fill-a-red-bag is the site's ordinary 404 to every plain visit (src/routes/red-bag.ts). The admin
// keeps its session as a token in the tab (sessionStorage), not in a cookie, so the server cannot
// see it on an ordinary visit. This script, which only that 404 carries, bridges the two: if THIS
// tab is signed in to the admin, it asks for the same address again with the token, and shows the
// page that comes back. The server checks the token; a wrong or expired one just gets the 404 again.
//
// With no admin session in the tab it does nothing at all: the public sees the 404, untouched.
// So staff: sign in at /admin, then go to /fill-a-red-bag in the same tab.
(function () {
  "use strict";

  function start(doc, win) {
    var token = null;
    try {
      token = win.sessionStorage.getItem("nbcc_admin_token");
    } catch (e) {
      token = null;
    }
    if (!token || typeof win.fetch !== "function") return null;
    var loc = win.location;
    return win
      .fetch(loc.pathname + (loc.search || ""), { headers: { Authorization: "Bearer " + token }, cache: "no-store" })
      .then(function (res) {
        return res.status === 200 ? res.text() : null;
      })
      .then(function (html) {
        if (!html) return false;
        // The whole page, scripts and all, in place of the 404.
        doc.open();
        doc.write(html);
        doc.close();
        return true;
      })
      .catch(function () {
        return false;
      });
  }

  if (typeof module !== "undefined" && module.exports) module.exports = { start: start };
  else start(document, window);
})();
