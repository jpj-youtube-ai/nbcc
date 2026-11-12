import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";

// The admin pinned to a phone's home screen as its own app (TASK-NNN).
//
// Two of these tests look fussy and are not. `display: "standalone"` is what makes iOS treat the
// pinned page as a web app rather than a bookmark, and a web app is the ONLY thing iOS will deliver
// a push notification to — set it to "browser" and notifications stop working with no error
// anywhere. And a transparent icon is filled with BLACK by iOS, not with the page's colour, so the
// alpha check is what keeps the maroon tile maroon.

const ROOT = resolve(__dirname, "../..");
const ICONS = resolve(ROOT, "assets/admin-icons");
const manifest = JSON.parse(readFileSync(resolve(ICONS, "admin.webmanifest"), "utf8"));
const head = readFileSync(resolve(ROOT, "admin.html"), "utf8");

describe("the admin asks to be installed as an app", () => {
  it("is standalone, not a bookmark", () => {
    expect(manifest.display).toBe("standalone");
  });

  // Pinned from any screen, it must open the admin itself. The scope keeps the service worker and
  // the app window to /admin rather than claiming the whole site.
  it("opens the admin, and claims only the admin", () => {
    expect(manifest.start_url).toBe("/admin");
    expect(manifest.scope).toBe("/admin");
  });

  it("is called NBCC Admin, so it is not mistaken for the public site's icon", () => {
    expect(manifest.name).toBe("NBCC Admin");
    expect(manifest.short_name).toBe("NBCC Admin");
  });

  it("is maroon behind and around", () => {
    expect(manifest.background_color).toBe("#800000");
    expect(manifest.theme_color).toBe("#800000");
  });

  it("offers every size a phone asks for, including a maskable one for Android", () => {
    const by = Object.fromEntries(manifest.icons.map((i) => [i.src.split("/").pop(), i]));
    expect(Object.keys(by).sort()).toEqual([
      "apple-touch-icon.png",
      "icon-192.png",
      "icon-512.png",
      "icon-maskable-512.png",
    ]);
    expect(by["icon-maskable-512.png"].purpose).toBe("maskable");
    expect(by["icon-192.png"].type).toBe("image/png");
  });
});

describe("the admin's head names them", () => {
  it.each([
    '<link rel="manifest" href="/assets/admin-icons/admin.webmanifest" />',
    '<link rel="apple-touch-icon" href="/assets/admin-icons/apple-touch-icon.png" />',
    '<meta name="apple-mobile-web-app-title" content="NBCC Admin" />',
    '<meta name="theme-color" content="#800000" />',
  ])("carries %s", (line) => {
    expect(head).toContain(line);
  });
});

describe("the icon files themselves", () => {
  it.each(["apple-touch-icon.png", "icon-192.png", "icon-512.png", "icon-maskable-512.png"])(
    "%s has no transparency, because iOS fills it with black",
    async (file) => {
      const meta = await sharp(resolve(ICONS, file)).metadata();
      expect(meta.channels).toBe(3);
      expect(meta.hasAlpha).toBe(false);
    },
  );

  it.each([
    ["apple-touch-icon.png", 180],
    ["icon-192.png", 192],
    ["icon-512.png", 512],
    ["icon-maskable-512.png", 512],
  ])("%s is %ipx square", async (file, size) => {
    const meta = await sharp(resolve(ICONS, file)).metadata();
    expect(meta.width).toBe(size);
    expect(meta.height).toBe(size);
  });
});
