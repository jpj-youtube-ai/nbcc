// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { renderFundraiserPage } from "../../src/fundraising/render";
import { meter, type PublicPage } from "../../src/fundraising/model";

// Event pages: an event's page runs the fundraiser page's script (assets/js/fundraiser.js). After a
// giver adds to the wall, it opens the event's own page again, at /event/<short name>, not the
// fundraiser address. Every name here is invented.

const ROOT = resolve(__dirname, "../..");
const require = createRequire(import.meta.url);
const { initWallStep } = require(resolve(ROOT, "assets/js/fundraiser.js"));
const template = readFileSync(resolve(ROOT, "fundraiser.html"), "utf8");

const page: PublicPage = {
  id: 12, slug: "eqn", path: "event", kind: "quiz", kindLabel: "A quiz night", title: "Exampleton Quiz Night",
  description: "Teams of four.", eventDate: "2026-12-05", startTime: "19:00", venue: "The Hall", town: "Exampleton",
  imageSrc: null, organisedBy: "Alex E.", url: "/event/eqn", meter: meter({ onlinePence: 0, cashPence: 0, targetPence: null }),
  wall: [], giving: { fundraiserId: 12, minimumPence: 200 },
};

describe("adding to the wall on an event's page", () => {
  it("opens the event's own page again once saved", async () => {
    const html = renderFundraiserPage(template, page, {
      pageUrl: "https://nbcc.test/event/eqn",
      now: new Date(Date.UTC(2026, 10, 25)),
      thanks: { message: false, sessionId: "cs_test_a1B2c3" },
    });
    document.documentElement.innerHTML = new DOMParser().parseFromString(html, "text/html").documentElement.innerHTML;
    let assigned: string | null = null;
    const fetch = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ status: "added", entry: null }) }));
    initWallStep(document, { fetch, location: { pathname: "/event/eqn", search: "" } }, { assign: (u: string) => (assigned = u) });
    document.getElementById("frWallForm")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    expect(fetch).toHaveBeenCalledWith("/api/fundraisers/eqn/wall-message", expect.anything());
    expect(assigned).toBe("/event/eqn?thanks=1&added=1");
  });
});
