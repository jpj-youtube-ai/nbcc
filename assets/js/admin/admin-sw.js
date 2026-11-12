// The admin's service worker: it receives a push while the app is shut and shows it, and opens
// the right part of the admin when somebody taps it.
//
// Served from /admin-sw.js, NOT from under /assets, because a worker can only control pages at or
// below its own path and the admin lives at /admin. src/routes/site.ts serves this one file from
// the root with a Service-Worker-Allowed header so its /admin scope is permitted.
//
// This file runs on its own, outside the page, with no access to anything app.js holds. It
// deliberately knows almost nothing: the server decides what each notification says, and this
// just shows it.

/* eslint-env serviceworker */

var ICON = "/assets/admin-icons/icon-192.png";

self.addEventListener("install", function () {
  // Take over straight away rather than waiting for every admin tab to close. There is no cache
  // here and nothing to migrate, so there is no older worker whose work could be interrupted.
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", function (event) {
  var data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = {};
  }
  // A push with no readable body still gets shown. Every browser requires a visible notification
  // for every push it delivers, and showing nothing can cost the site its permission to push.
  var title = data.title || "NBCC Admin";
  var options = {
    body: data.body || "Something new in the admin",
    icon: ICON,
    badge: ICON,
    // Replaces an earlier notification with the same tag rather than stacking a duplicate, which
    // is what makes a retried send harmless.
    tag: data.tag || "nbcc-admin",
    data: { area: data.area || null },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  var area = event.notification.data && event.notification.data.area;
  var target = area ? "/admin?area=" + encodeURIComponent(area) : "/admin";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (windows) {
      for (var i = 0; i < windows.length; i += 1) {
        if (windows[i].url.indexOf("/admin") !== -1 && "focus" in windows[i]) {
          // Already open: bring it forward and tell the page where to go, rather than opening a
          // second copy that would make them sign in again.
          if (area && windows[i].postMessage) windows[i].postMessage({ nbccGoTo: area });
          return windows[i].focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
