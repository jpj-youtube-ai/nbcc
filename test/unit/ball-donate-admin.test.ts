import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The Festive Ball's donate page (/ball/donate, Jaimie, 14 October 2026): its gifts show in Admin >
// Donations as Fill a Red Bag's do. A "Festive Ball" label beside the gift, a "Festive Ball only"
// filter, and (from the server) a Festive Ball line in the totals above the list.

const root = join(__dirname, "..", "..");
const html = readFileSync(join(root, "admin.html"), "utf8");
const js = readFileSync(join(root, "assets", "js", "admin", "app.js"), "utf8");

describe("Admin > Donations and the Festive Ball", () => {
  it("labels a gift from the Ball's donate page", () => {
    expect(js).toContain('if (d.source === "ball") gift += \' <span class="admin-pill dn-source-pill">Festive Ball</span>\';');
  });

  it("has a Festive Ball only filter beside the Red Bag one", () => {
    expect(html).toContain('<input type="checkbox" id="donationsBallFilter"> Festive Ball only');
    expect(html.indexOf("donationsBallFilter")).toBeGreaterThan(html.indexOf("donationsRedBagFilter"));
  });

  it("asks the server for Ball gifts only when it is ticked, and says so when there are none", () => {
    expect(js).toContain('(ball ? "&source=ball" : "")');
    expect(js).toContain('"No Festive Ball gifts yet."');
  });

  it("goes back to page one when it changes, as the other filters do", () => {
    expect(js).toContain(
      '["donationsPaymentFilter", "donationsModeFilter", "donationsRedBagFilter", "donationsBallFilter", "donationsBallBagsFilter", "donationsInvoiceFilter", "donationsElfFilter"]',
    );
  });

  it("never asks for two at once: ticking one unticks the others", () => {
    const start = js.indexOf("function oneSourceFilter(");
    expect(start).toBeGreaterThan(-1);
    const fn = js.slice(start, start + 800);
    expect(fn).toContain("donationsRedBagFilter");
    expect(fn).toContain("donationsBallFilter");
    expect(fn).toContain("donationsBallBagsFilter");
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
    expect(html).toContain('<input type="checkbox" id="donationsBallBagsFilter"> Red bags at the Ball only');
    expect(html.indexOf("donationsBallBagsFilter")).toBeGreaterThan(html.indexOf("donationsBallFilter"));
  });

  it("asks the server for table bag gifts only when it is ticked, and says so when there are none", () => {
    expect(js).toContain('(ballBags ? "&source=ball_bags" : "")');
    expect(js).toContain('"No red bag gifts at the Ball yet."');
  });
});
