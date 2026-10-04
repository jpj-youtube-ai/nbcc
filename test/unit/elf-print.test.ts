// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderElfCertificate, renderElfPoster, renderElfTag, renderStaffCard, shareCardSvg } from "../../src/elf/print";
import type { CertificatePrint, PlacePrint, ShareCardPrint, StaffCardPrint } from "../../src/elf/print";
import { MATERIALS_STATEMENT } from "../../src/legal/registration";
import { defaultLook, drawElf } from "../../src/elf/wardrobe";

// NBCC Elf Detective School: the things NBCC prints or a family shares. Every shop, elf, word and
// detective here is invented, and the phone number is a made up one that cannot be dialled.

const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");
const words = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
/** Everything a person reads on the paper itself (the toolbar and the on screen note are not printed). */
const paper = (html: string) => words(parse(html).querySelector(".page"));

const PLACE: PlacePrint = { placeName: "The Toy Shop", placeTown: "Troon", posterUrl: "https://nbcc.scot/elf/p/toy-shop-k4f9" };
const CARD: StaffCardPrint = { ...PLACE, door: 7, elfName: "Bauble", clueAt: new Date("2026-12-07T17:30:00.000Z"), phone: "01632 960 123" };
const SIX = { doorsDone: 24, goldSeal: true, wonRace: false };
const LOOK = { ...defaultLook(), outfit: "grad" };
const CERT: CertificatePrint = { name: "Detective Ruby Tinselfoot", badgeNumber: "0427", year: 2026, goldSeal: true, look: LOOK, state: SIX, awardedOn: new Date("2026-12-24T18:00:00.000Z") };
const SHARE: ShareCardPrint = { publicName: "Detective R. Tinselfoot", rank: "Junior Detective", doorsDone: 6, look: defaultLook(), state: { doorsDone: 6 }, year: 2026 };

describe("the poster for a hiding place", () => {
  const html = renderElfPoster(PLACE);
  const doc = parse(html);

  it("is one A4 page that names the place and tells detectives to scan", () => {
    expect(doc.querySelectorAll(".page").length).toBe(1);
    expect(html).toContain("@page{size:A4 portrait;margin:0}");
    expect(paper(html)).toContain("The Toy Shop");
    expect(paper(html)).toContain("Detectives, scan here");
    expect(doc.querySelector('meta[name="robots"]')!.getAttribute("content")).toBe("noindex, nofollow");
  });

  it("carries one QR code, and it is the code for this place's own page", () => {
    const codes = doc.querySelectorAll(".page svg[role='img']");
    expect(codes.length).toBe(1);
    expect(codes[0].querySelector("title")!.textContent).toBe("QR code for The Toy Shop's Elf Detective School page");
    const other = renderElfPoster({ ...PLACE, posterUrl: "https://nbcc.scot/elf/p/bakery-x1y2" });
    expect(parse(other).querySelector(".page svg[role='img'] path")!.getAttribute("d")).not.toBe(codes[0].querySelector("path")!.getAttribute("d"));
  });

  it("says how to claim an elf and how to collect a candy cane", () => {
    expect(paper(html)).toContain("Found the elf? Scan, then type the secret word on its tag.");
    expect(paper(html)).toContain("Here for a candy cane? Scan to check in once this place's door has opened.");
    expect(paper(html)).toContain("Under 16? Bring a grown up with you to every hiding place.");
  });

  it("stays up all month, so it never says when the elf is here", () => {
    const text = paper(html);
    expect(text).not.toMatch(/\b(today|tonight|door \d|\d{1,2} December|\d(am|pm))\b/i);
  });

  it("carries the charity's statement", () => {
    expect(paper(html)).toContain(MATERIALS_STATEMENT);
  });

  it("refuses an address that is not a poster page on a secure site, so a wrong code is never printed", () => {
    for (const bad of ["http://nbcc.scot/elf/p/toy-shop", "https://nbcc.scot/elf/hq", "/elf/p/toy-shop", "https://nbcc.scot/elf/p/toy shop", "javascript:alert(1)", ""]) {
      expect(() => renderElfPoster({ ...PLACE, posterUrl: bad }), bad).toThrow();
    }
  });

  it("makes the place's name safe", () => {
    const bad = parse(renderElfPoster({ ...PLACE, placeName: "<img src=x onerror=alert(1)>", placeTown: "<b>T</b>" }));
    expect(bad.querySelector(".page img[src='x'], .page b > b, [onerror]")).toBeNull();
  });
});

describe("the card for a hiding place's staff", () => {
  const html = renderStaffCard(CARD);
  const text = paper(html);

  it("tells the shop its elf, its day and when to put the elf out", () => {
    expect(text).toContain("For the team at The Toy Shop");
    expect(text).toContain("Your elf is Bauble");
    expect(text).toContain("Monday 7 December");
    expect(text).toContain("door 7");
    expect(text).toContain("The clue comes out at 5:30pm");
  });

  it("asks the shop to keep its day a secret", () => {
    expect(text).toContain("Please do not tell anyone which day is yours");
  });

  it("says how to tell the real gold screen from a picture of one", () => {
    expect(text).toContain("You're first!");
    expect(text).toContain("It names The Toy Shop");
    expect(text).toContain("It shows the right date");
    expect(text).toContain("Its clock is ticking");
    expect(text).toContain("hand over Bauble and the prize");
  });

  it("gives NBCC's number for a family that has typed too many wrong words", () => {
    expect(text).toContain("too many wrong words");
    expect(text).toContain("01632 960 123");
  });

  it("says what happens if nobody finds the elf", () => {
    expect(text).toContain("If nobody finds Bauble");
  });

  it("is not drawn without a real clue time", () => {
    expect(() => renderStaffCard({ ...CARD, clueAt: new Date("x") })).toThrow();
  });
});

describe("the tag an elf wears", () => {
  it("shows the elf's name and its secret word in capitals", () => {
    const text = paper(renderElfTag({ elfName: "Bauble", secretWord: "Snowball 472" }));
    expect(text).toContain("I am Bauble");
    expect(text).toContain("SNOWBALL 472");
    expect(text).toContain("type my secret word");
  });

  it("refuses a word that could be guessed from home", () => {
    for (const bad of ["Snowball", "Snowball 4", "472", ""]) expect(() => renderElfTag({ elfName: "Bauble", secretWord: bad }), bad).toThrow();
  });

  it("makes the name and the word safe", () => {
    const doc = parse(renderElfTag({ elfName: "<b>B</b>", secretWord: "<i>A</i> 123" }));
    expect(doc.querySelector(".page b > b, .page i")).toBeNull();
  });
});

describe("the graduate's certificate", () => {
  const html = renderElfCertificate(CERT);
  const text = paper(html);

  it("is one A4 page on its side that names the detective, the class and the date", () => {
    expect(html).toContain("@page{size:A4 landscape;margin:0}");
    expect(text).toContain("Detective Ruby Tinselfoot");
    expect(text).toContain("Class of 2026");
    expect(text).toContain("Badge 0427");
    expect(text).toContain("Thursday 24 December 2026");
    expect(text).toContain("all 24 doors");
  });

  it("draws the detective's own elf, made safe first", () => {
    const svg = parse(html).querySelector(".page .cert-elf svg")!;
    expect(svg.getAttribute("aria-label")).toBe("Detective Ruby Tinselfoot's elf");
    const cheat = renderElfCertificate({ ...CERT, look: { ...defaultLook(), outfit: "nessie" } });
    expect(parse(cheat).querySelector(".cert-elf")!.innerHTML).toBe(parse(renderElfCertificate({ ...CERT, look: defaultLook() })).querySelector(".cert-elf")!.innerHTML);
  });

  it("shows the gold seal only when it has been earned", () => {
    expect(text).toContain("Gold seal");
    expect(paper(renderElfCertificate({ ...CERT, goldSeal: false }))).not.toContain("Gold seal");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(paper(renderElfCertificate({ ...CERT, goldSeal: "true" as any }))).not.toContain("Gold seal");
  });

  it("spells the workshop the one way, and carries the charity's statement", () => {
    expect(text).toContain("Elves' Workshop");
    expect(text).toContain(MATERIALS_STATEMENT);
  });
});

describe("the share card", () => {
  const svg = shareCardSvg(SHARE);
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");

  it("is one picture of 1200 by 630", () => {
    expect(doc.querySelector("parsererror")).toBeNull();
    expect(doc.documentElement.tagName).toBe("svg");
    expect(doc.documentElement.getAttribute("width")).toBe("1200");
    expect(doc.documentElement.getAttribute("height")).toBe("630");
  });

  it("shows the name as the public may see it, the rank and the doors done", () => {
    const text = words(doc.documentElement);
    expect(text).toContain("Detective R. Tinselfoot");
    expect(text).toContain("Junior Detective");
    expect(text).toContain("6 of 24 doors done");
    expect(text).toContain("NBCC Elf Detective School 2026");
  });

  it("sets a long name smaller so that it stays on the card", () => {
    const size = (svg: string) => Number(/font-size="(\d+)" fill="#800000"/.exec(svg)![1]);
    expect(size(shareCardSvg({ ...SHARE, publicName: "Detective Jo Fir" }))).toBe(58);
    const long = size(shareCardSvg({ ...SHARE, publicName: "Detective Christopher Sparkleboots" }));
    expect(long).toBeLessThan(40);
    expect(long * 0.56 * "Detective Christopher Sparkleboots".length).toBeLessThanOrEqual(620);
  });

  it("shows the elf, never a photo", () => {
    expect(svg).not.toMatch(/<image\b/);
    expect(svg).toContain(drawElf(defaultLook(), { doorsDone: 6 }, { size: 380, backdrop: true, label: false, key: "share" }).replace(/^<svg[^>]*>/, "").slice(0, 200));
  });

  it("makes the name safe", () => {
    const bad = shareCardSvg({ ...SHARE, publicName: '<script>x</script>"&' });
    expect(new DOMParser().parseFromString(bad, "image/svg+xml").querySelector("parsererror, script")).toBeNull();
  });
});

describe("house rules for everything printed", () => {
  const pages: [string, string][] = [
    ["poster", renderElfPoster(PLACE)],
    ["staff card", renderStaffCard(CARD)],
    ["tag", renderElfTag({ elfName: "Bauble", secretWord: "Snowball 472" })],
    ["certificate", renderElfCertificate(CERT)],
  ];

  it.each(pages)("%s: no dashes and no hyphenated words in anything read", (_name, html) => {
    const doc = parse(html);
    // The paper itself: the toolbar and the note above it are the site's own and are not printed.
    const walker = doc.createTreeWalker(doc.querySelector(".page")!, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.parentElement?.closest("script, style")) continue;
      const said = (node.textContent ?? "").trim();
      expect(said, said).not.toMatch(/[–—]|[A-Za-z0-9]-[A-Za-z0-9]/);
    }
  });

  it.each(pages)("%s: one paper size, a print button, and no page for search engines", (_name, html) => {
    expect(html.match(/@page\{/g)!.length).toBe(1);
    expect(html).toContain("Print or save as PDF");
    expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
  });

  it("has no dashes or hyphenated words on the share card either", () => {
    const text = words(new DOMParser().parseFromString(shareCardSvg(SHARE), "image/svg+xml").documentElement);
    expect(text).not.toMatch(/[–—]|[A-Za-z0-9]-[A-Za-z0-9]/);
  });
});
