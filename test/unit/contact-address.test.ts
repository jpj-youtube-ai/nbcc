import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { POSTAL_ADDRESS_LINES } from "../../src/legal/registration";

// TASK-421: the contact page disagreed with itself.
//
// Its footer carried the registered address in full, and the "where to find us" card three
// hundred lines above it carried a hand-written summary: "Annbank Village Hall / Annbank,
// Ayrshire, South West Scotland". No street, no postcode. The one card on the site whose whole
// job is to tell somebody where to send a letter was the one that could not.
//
// src/legal/registration.ts has held the real address all along, and every other page renders it
// from there. The card was the single hand-typed copy, which is the shape that drifts.
//
// Static HTML cannot import the constant, so a test ties the two together instead, exactly as
// ball-inclusions.test.ts ties the ticket page to TICKET_INCLUDES.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (f: string) => readFileSync(resolve(ROOT, f), "utf8");
const collapse = (s: string) => s.replace(/\s+/g, " ");

// The address card is the contact-point that is NOT a link: the phone and email ones wrap an
// <a>, this one is plain text. Sliced rather than matched on the icon, because the icon is a
// path of SVG coordinates and asserting on those would break the moment somebody redraws a pin.
function addressCard(html: string): string {
  const cards = [...html.matchAll(/<li class="card contact-point">([\s\S]*?)<\/li>/g)].map((m) => m[1]);
  return collapse(cards.find((c) => !c.includes("<a href")) ?? "");
}

const contact = read("contact.html");

describe("the address on the contact page", () => {
  it("has a card that is not a phone or email link", () => {
    expect(addressCard(contact)).not.toBe("");
  });

  it.each(POSTAL_ADDRESS_LINES.map((line) => [line]))(
    "carries %s, the way the registered address has it",
    (line) => {
      expect(addressCard(contact)).toContain(line);
    },
  );

  // The two parts whose absence was the actual problem: you cannot post anything to a locality.
  it("gives a street and a postcode, which a summary cannot", () => {
    const card = addressCard(contact);
    expect(card).toContain("Weston Avenue");
    expect(card).toMatch(/KA6\s?5EE/);
  });

  // "South West Scotland" is true and belongs on the page: it is who NBCC serves, and it appears
  // in the lede and the footer blurb. It is not an address, so it does not belong in this card.
  it("no longer offers a region where a postcode should be", () => {
    expect(addressCard(contact)).not.toContain("South West Scotland");
  });
});

describe("no page names the hall without saying where it is", () => {
  // The drift was one page disagreeing with fifteen. This is what stops a sixteenth.
  const pages = readdirSync(ROOT).filter((f) => f.endsWith(".html"));

  it.each(pages.map((p) => [p]))("%s", (page) => {
    const html = read(page);
    if (!html.includes("Annbank Village Hall")) return;
    expect(collapse(html)).toContain("Weston Avenue");
    expect(collapse(html)).toMatch(/KA6\s?5EE/);
  });
});
