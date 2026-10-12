import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CATALOGUE } from "../../src/email/catalogue";

// Jaimie, 12 October 2026: the Festive Ball ticket report names who has booked a whole table, and
// staff can send the day's report again. This holds the admin's side of it: the card says what the
// report now carries, the button is there and asks before it sends, and the "All emails" example
// shows the table. Every name in the example is invented.

const root = join(__dirname, "..", "..");
const html = readFileSync(join(root, "admin.html"), "utf8");
const js = readFileSync(join(root, "assets", "js", "admin", "app.js"), "utf8");

describe("the ticket report card", () => {
  it("no longer promises there are no names, and says whose names go", () => {
    expect(html).not.toContain("No names, no booking details and no money");
    expect(html).toContain("who has booked a whole table");
    expect(html).toContain("No contact details and no money.");
  });

  it("has a button to send today's report again, hidden until it can be used", () => {
    expect(html).toContain('id="evReportResend" hidden>Send today’s report again</button>');
  });

  it("asks before sending, names how many people, and posts to the resend route", () => {
    const start = js.indexOf("function brResend()");
    expect(start).toBeGreaterThan(-1);
    const fn = js.slice(start, js.indexOf("function brWire()", start));
    expect(fn).toContain("window.confirm(");
    expect(fn).toContain("brPeople(brData.recipients.length)");
    expect(fn).toContain('"/api/admin/ball-report/resend"');
    expect(fn.indexOf("window.confirm(")).toBeLessThan(fn.indexOf("authFetch("));
  });

  it("shows the button only when the server says today's report can go again, to those who can edit", () => {
    expect(js).toContain('el("evReportResend").hidden = !(canWrite && brData.canResend);');
  });
});

describe("the report in All emails", () => {
  const entry = CATALOGUE.find((e) => e.id === "ball-report");

  it("shows the table of who has booked, with made up people", () => {
    expect(entry).toBeDefined();
    const usual = entry!.versions.find((v) => v.id === "usual")!.render("https://nbcc.scot");
    expect(usual.html).toContain("Tables booked");
    expect(usual.html).toContain(">First name</th>");
    expect(usual.html).toContain("awaiting payment");
  });

  it("has the report as it looks when sent again", () => {
    const again = entry!.versions.find((v) => v.id === "sent-again");
    expect(again).toBeDefined();
    expect(again!.render("https://nbcc.scot").subject).toContain(", sent again");
  });

  it("says the names are made up", () => {
    expect(entry!.note).toContain("names");
  });
});
