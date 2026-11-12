import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// The admin's service worker, and where a tapped notification lands (TASK-619).

const ROOT = resolve(__dirname, "../..");
const sw = readFileSync(resolve(ROOT, "assets/js/admin/admin-sw.js"), "utf8");
const app = readFileSync(resolve(ROOT, "assets/js/admin/app.js"), "utf8");
const site = readFileSync(resolve(ROOT, "src/routes/site.ts"), "utf8");

describe("where the worker is served from", () => {
  // A worker may only control pages at or below its own path, so one served from /assets could
  // never control /admin however it is registered. This is the whole reason for the extra route.
  it("comes from the root, not from under /assets", () => {
    expect(site).toContain('router.get("/admin-sw.js"');
    expect(app).toContain('register("/admin-sw.js", { scope: "/admin" })');
  });

  it("is allowed to widen its scope to /admin", () => {
    expect(site).toContain('res.setHeader("Service-Worker-Allowed", "/admin")');
  });

  it("is not cached, so a fix to it reaches a phone that already has the old one", () => {
    expect(site).toMatch(/Service-Worker-Allowed[\s\S]{0,200}Cache-Control", "no-cache"/);
  });
});

describe("receiving a push", () => {
  it("shows what the server said", () => {
    expect(sw).toContain('self.addEventListener("push"');
    expect(sw).toContain("self.registration.showNotification");
  });

  // Every browser requires a visible notification for every push delivered. Showing nothing can
  // cost the site its permission to push at all, so a body we cannot read still shows something.
  it("still shows something when the payload cannot be read", () => {
    expect(sw).toContain("Something new in the admin");
    expect(sw).toMatch(/catch \(e\) \{\s*data = \{\};/);
  });

  it("replaces an earlier notification with the same tag rather than stacking a duplicate", () => {
    expect(sw).toContain("tag: data.tag");
  });
});

describe("tapping a notification", () => {
  it("closes it and opens the admin at the right section", () => {
    expect(sw).toContain('self.addEventListener("notificationclick"');
    expect(sw).toContain("event.notification.close()");
    expect(sw).toContain('"/admin?area=" + encodeURIComponent(area)');
  });

  // Opening a second window would make somebody sign in again on a phone that already had the
  // admin open.
  it("brings an open admin forward instead of opening a second copy", () => {
    expect(sw).toContain("self.clients.matchAll");
    expect(sw).toContain("focus()");
    expect(sw).toContain("postMessage({ nbccGoTo: area })");
    expect(app).toContain("event.data && event.data.nbccGoTo");
  });
});

describe("landing on the right section", () => {
  // The admin has no URL routing at all, so this is the entirety of it.
  it("reads the area out of the address", () => {
    expect(app).toContain('params.get("area")');
    expect(app).toContain("selectView(area)");
  });

  // A 2am tap on a phone whose session has lapsed shows the password box first. Capturing the
  // destination at load, before sign-in, is what carries it across.
  it("remembers it across a sign-in, then applies it once the app is on screen", () => {
    expect(app).toContain("var pendingArea = null");
    expect(app).toMatch(/loadMyPermissions\(\);[\s\S]{0,400}if \(pendingArea\)/);
  });

  it("strips it from the address, so a refresh does not send you there again", () => {
    expect(app).toContain("window.history.replaceState({}, \"\", window.location.pathname)");
  });

  it("registers the worker only once somebody is signed in", () => {
    expect(app).toMatch(/registerPushWorker\(\);\s*\}/);
    expect(app).toContain("function registerPushWorker()");
  });
});
