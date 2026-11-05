import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderBallPage } from "../../src/ball/page";
import { renderHomePromo } from "../../src/ball/home-promo";

// Jaimie, 5 November 2026: ticket sales for the Festive Ball have closed. The page stays up with all
// its details, but the ways to buy come down: the booking form gives way to a short closed note, and
// the "Book tickets" buttons go from the Ball page and the home page. Sold out is different: the
// waiting list still takes the form's place, as before.

const ROOT = resolve(__dirname, "../..");
const template = readFileSync(resolve(ROOT, "ball.html"), "utf8");
const home = readFileSync(resolve(ROOT, "index.html"), "utf8");
const settings = { arrivalTime: null, includedNote: null, lineUpNote: null };
const open = renderBallPage(template, { settings, gateOpen: true });
const closed = renderBallPage(template, { settings, gateOpen: true, salesClosed: true });

describe("the Ball page once ticket sales have closed", () => {
  it("has no Book tickets button anywhere", () => {
    expect(open.split("Book tickets").length - 1).toBe(2);
    expect(closed).not.toContain("Book tickets");
  });

  it("hides the booking form and shows the closed note in its place", () => {
    expect(closed).toMatch(/<form class="ball-form reveal" id="ballForm" novalidate hidden>/);
    expect(closed).toMatch(/<div class="ball-closed[^"]*" id="ballClosed">/);
    expect(closed).toContain("Thank you to everyone who has booked. We can't wait to see you on Saturday.");
  });

  it("leaves out the box about bigger bookings and invoices, which only matters while booking", () => {
    // Left out, not hidden: the Ball stylesheet gives the box a display of its own.
    expect(closed).not.toContain("Booking bigger, or paying by invoice?");
    expect(open).toContain('<aside class="ball-invoice reveal" aria-labelledby="ball-invoice-heading">');
    expect(closed).toContain('id="ballWaitingForm"');
  });

  it("says so in the tickets heading", () => {
    expect(closed).toContain('<h2 id="tickets-heading">Ticket sales have now closed.</h2>');
    expect(closed).not.toContain("Book your seat, or take a table for ten.");
  });

  it("points anyone who cannot come to the donate page, and gives our phone and email", () => {
    const note = closed.slice(closed.indexOf('id="ballClosed"'), closed.indexOf("</div>", closed.indexOf('id="ballClosed"')));
    expect(note).toContain('href="/ball/donate"');
    expect(note).toContain("01292 811 015");
    expect(note).toContain("events@nbcc.scot");
  });

  it("keeps every detail of the night", () => {
    for (const keep of ["What's the night about?", "Can't make it? Donate", 'id="the-night"', 'id="who"', 'id="practical"', "The Designer Rooms"]) {
      expect(closed).toContain(keep);
    }
  });

  it("keeps the waiting list for when the Ball is sold out", () => {
    expect(closed).toContain('id="ballWaitingForm"');
  });

  it("changes nothing while sales are open", () => {
    expect(renderBallPage(template, { settings, gateOpen: true, salesClosed: false })).toBe(open);
    expect(open).toMatch(/<div class="ball-closed[^"]*" id="ballClosed" hidden>/);
    expect(open).toMatch(/<form class="ball-form reveal" id="ballForm" novalidate>/);
  });

  it("keeps the house style in the note: no dashes", () => {
    const note = template.slice(template.indexOf('id="ballClosed"'), template.indexOf("</div>", template.indexOf('id="ballClosed"')));
    expect(note.replace(/<[^>]+>/g, " ")).not.toMatch(/[–—]/);
  });
});

describe("the home page's Ball promotion once ticket sales have closed", () => {
  const promoOpen = renderHomePromo(home, { gateOpen: true });
  const promoClosed = renderHomePromo(home, { gateOpen: true, salesClosed: true });

  it("has no Book tickets button and no 'Tickets now on sale'", () => {
    expect(promoOpen).toContain("Book tickets");
    expect(promoOpen).toContain("Tickets now on sale");
    expect(promoClosed).not.toContain("Book tickets");
    expect(promoClosed).not.toContain("Tickets now on sale");
    expect(promoClosed).toContain("Ticket sales have now closed");
  });

  it("still tells people about the night", () => {
    expect(promoClosed).toContain("Join us for A Night to Remember.");
    expect(promoClosed).toContain('class="ball-banner" href="/ball"');
  });
});

describe("the page script", () => {
  const js = readFileSync(resolve(ROOT, "assets/js/ball.js"), "utf8");
  it("does not repeat the closed message above the note the server already shows", () => {
    expect(js).toContain('document.getElementById("ballClosed")');
  });
});
