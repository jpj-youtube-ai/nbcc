import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The Festive Ball's donate page (/ball/donate, Jaimie, 14 October 2026): its gifts show in Admin >
// Donations as Fill a Red Bag's do. A "Festive Ball" label beside the gift, a "Festive Ball only"
// filter, and (from the server) a Festive Ball line in the totals above the list. Since the gift log
// (docs/superpowers/plans/2026-11-05-donations-screen.md, Task 4) the filter is the Festive Ball's
// tile on the scoreboard and the list's cards say "Festive Ball" from the server's given_on_label; the
// compact table on the Overview and in Search keeps its pill.

const root = join(__dirname, "..", "..");
const html = readFileSync(join(root, "admin.html"), "utf8");
const js = readFileSync(join(root, "assets", "js", "admin", "app.js"), "utf8");

describe("Admin > Donations and the Festive Ball", () => {
  it("labels a gift from the Ball's donate page", () => {
    expect(js).toContain('if (d.source === "ball") gift += \' <span class="admin-pill dn-source-pill">Festive Ball</span>\';');
  });

  it("has a Festive Ball only filter beside the Red Bag one", () => {
    expect(html).toContain('<input class="gl-tile__box" type="checkbox" id="donationsBallFilter"><span class="gl-tile__name">Festive Ball</span>');
    expect(html.indexOf("donationsBallFilter")).toBeGreaterThan(html.indexOf("donationsRedBagFilter"));
  });

  // One table of places now, each with its source and its empty words.
  it("asks the server for Ball gifts only when it is ticked, and says so when there are none", () => {
    expect(js).toContain('{ id: "donationsBallFilter", source: "ball", none: "No Festive Ball gifts yet."');
    expect(js).toContain('query += "&source=" + place.source;');
  });

  // The filters and the places are two lists now, both sending the list back to page one.
  it("goes back to page one when it changes, as the other filters do", () => {
    expect(js).toContain(".concat(DONATION_SOURCE_IDS)");
    const wired = js.slice(js.indexOf(".concat(DONATION_SOURCE_IDS)"), js.indexOf(".concat(DONATION_SOURCE_IDS)") + 300);
    expect(wired).toContain("donationsOffset = 0;");
    expect(wired).toContain("loadDonations();");
  });

  it("never asks for two at once: ticking one unticks the others", () => {
    const start = js.indexOf("function oneSourceFilter(");
    expect(start).toBeGreaterThan(-1);
    const fn = js.slice(start, start + 800);
    // Every place's tick box, from the one table of places.
    expect(fn).toContain("DONATION_SOURCE_IDS.forEach");
    for (const id of ["donationsRedBagFilter", "donationsBallFilter", "donationsBallBagsFilter"]) expect(js).toContain('{ id: "' + id + '"');
    expect(fn).toContain(".checked = false");
  });
});

// The Ball's table cards (/bag, source ball_bags): their own label, filter and line, never folded
// into the Festive Ball's.
describe("Admin > Donations and the Ball's table bags", () => {
  it("labels a gift from a table card", () => {
    expect(js).toContain('if (d.source === "ball_bags") gift += \' <span class="admin-pill dn-source-pill">Red bags at the Ball</span>\';');
  });

  it("has a Red bags at the Ball only filter straight after the Festive Ball one", () => {
    expect(html).toContain('<input class="gl-tile__box" type="checkbox" id="donationsBallBagsFilter"><span class="gl-tile__name">Red bags at the Ball</span>');
    expect(html.indexOf("donationsBallBagsFilter")).toBeGreaterThan(html.indexOf("donationsBallFilter"));
  });

  it("asks the server for table bag gifts only when it is ticked, and says so when there are none", () => {
    expect(js).toContain('{ id: "donationsBallBagsFilter", source: "ball_bags", none: "No red bag gifts at the Ball yet."');
  });
});
