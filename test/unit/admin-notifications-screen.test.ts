// @vitest-environment jsdom

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AREA_TITLES } from "../../src/admin/whats-new";

// The Notifications screen (TASK-619): turning your own phone on, and choosing what buzzes.

const ROOT = resolve(__dirname, "../..");
const html = readFileSync(resolve(ROOT, "admin.html"), "utf8");
const app = readFileSync(resolve(ROOT, "assets/js/admin/app.js"), "utf8");
const css = readFileSync(resolve(ROOT, "assets/css/admin.css"), "utf8");
const doc = new DOMParser().parseFromString(html, "text/html");
const view = doc.getElementById("view-notifications");

describe("the screen", () => {
  it("exists, hidden, and is in the menu for everyone", () => {
    expect(view).not.toBeNull();
    expect(view?.hasAttribute("hidden")).toBe(true);
    const link = doc.querySelector('.admin-nav-link[data-view="notifications"]');
    expect(link).not.toBeNull();
    // No data-view-gate: a person subscribes their OWN phone, and what they actually receive is
    // filtered by their permissions when it is sent.
    expect(link?.hasAttribute("data-view-gate")).toBe(false);
  });

  it("is wired into the view switcher", () => {
    expect(app).toContain('else if (name === "notifications") loadPushSettings();');
  });
});

describe("warning before asking, not after", () => {
  // iOS asks for notification permission once and only once. Somebody who taps Don't Allow has to
  // delete the icon and add it back. A caption under the button would be read after the damage.
  it("says the phone only asks once, above the button", () => {
    const text = view?.textContent ?? "";
    expect(text).toMatch(/only asks once/i);
    expect(text).toMatch(/delete the icon/i);
    const warning = html.indexOf('id="pushOnceWarning"');
    const button = html.indexOf('id="pushEnable"');
    expect(warning).toBeGreaterThan(-1);
    expect(warning).toBeLessThan(button);
  });

  // An iPhone will not deliver to a Safari tab, only to a home-screen app, so a button pressed in
  // a tab would appear to work and then never fire.
  it("tells an iPhone user to pin it first", () => {
    expect(view?.textContent).toMatch(/Add to Home Screen/i);
    expect(app).toContain("isInstalledApp()");
    expect(app).toMatch(/only sends notifications to the app, never to a Safari tab/);
  });

  it("says the way back if the phone said no", () => {
    expect(app).toMatch(/delete the icon from your home screen and add it back/);
  });
});

describe("the button", () => {
  it("says what pressing it does", () => {
    expect(doc.getElementById("pushEnable")?.textContent?.trim()).toBe("Turn on notifications for this phone");
    expect(doc.getElementById("pushPrefsSave")?.textContent?.trim()).toBe("Save these settings");
  });

  it("asks the phone, then subscribes, then tells the server", () => {
    expect(app).toContain("Notification.requestPermission()");
    expect(app).toContain("reg.pushManager.subscribe({ userVisibleOnly: true");
    expect(app).toContain('"/api/admin/push/subscription"');
  });

  it("does not offer to turn on what the server cannot send", () => {
    expect(app).toContain("if (!d.configured)");
    expect(app).toMatch(/not set up on the server yet/);
  });
});

describe("choosing what buzzes", () => {
  it("offers every area something can arrive in", () => {
    for (const area of ["donations", "monthly", "fundraising", "contact", "ball", "fulfilments", "stories", "newsletter"]) {
      expect(app, area).toContain(`["${area}", "${AREA_TITLES[area as keyof typeof AREA_TITLES]}"]`);
    }
  });

  it("does not offer areas nothing ever arrives in", () => {
    for (const area of ["analytics", "qr", "red-bag", "invoices", "events"]) {
      expect(app, area).not.toContain(`["${area}", "`);
    }
  });

  it("sends back the ones switched OFF, since everything is on by default", () => {
    expect(app).toContain("if (!box.checked) off.push(box.getAttribute(\"data-push-area\"))");
    expect(app).toContain("areasOff: off");
  });
});

describe("the calm-down switches", () => {
  it("ship off, because Jaimie asked for a buzz every time", () => {
    expect(doc.getElementById("pushBundle")?.hasAttribute("checked")).toBe(false);
    expect((doc.getElementById("pushQuietFrom") as HTMLInputElement | null)?.getAttribute("value")).toBeNull();
  });

  it("says what is held back is still visible on screen", () => {
    expect(view?.textContent).toMatch(/still shows as a New pill/i);
  });
});

describe("the styling it relies on", () => {
  // A page built from class names that do not exist renders as unreadable plain text, which has
  // happened here before and is invisible to a test that only checks the words.
  it.each(["np-steps", "np-areas", "np-quiet"])("%s is defined", (cls) => {
    expect(css).toMatch(new RegExp(`\\.${cls}\\b`));
  });

  it("uses the status classes the admin stylesheet actually shows", () => {
    // .err is hidden by the public stylesheet; is-ok / is-error are the admin's own.
    expect(app).toContain('"admin-action-status is-error"');
    expect(app).toContain('"admin-action-status is-ok"');
  });
});
