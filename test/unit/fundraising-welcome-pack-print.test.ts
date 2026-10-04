// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderWelcomePack, type PackPrintInput } from "../../src/fundraising/welcome-pack-print";
import { packView, type PackSubject, type StoredPack } from "../../src/fundraising/welcome-pack";
import { MATERIALS_STATEMENT } from "../../src/legal/registration";
import type { MaterialAssets, MaterialFacts } from "../../src/fundraising/materials";

// Welcome packs (Jaimie, 2026-10-03): the one print view staff open from Admin > Fundraising. The
// welcome letter first (addressed, for a window envelope), then their posters in the sizes and
// numbers they asked for, then the sponsor form for someone raising money. In memory, a gentle
// covering note in place of the letter. Every person, place and number is invented.

const assets: MaterialAssets = { fontCss: "", logo: "data:image/png;base64,AAAA", logoOnDark: "data:image/png;base64,BBBB" };
const NONE = { posterCount: 0, leafletCount: 0, bucketCount: 0, tinCount: 0, leaflets: 0, buckets: 0, qrCount: 0, envelopeCount: 0, shoutOut: false, attend: false };

function subject(over: Partial<PackSubject> = {}): PackSubject {
  return {
    id: 9, status: "approved", path: "raising", public: true, title: "Robin's Big Walk", slug: "robins-big-walk",
    name: "Robin Example", firstName: "Robin", lastName: "Example", wants: { ...NONE, posterCount: 12, leafletCount: 30, bucketCount: 2 },
    postAddress: null, postLine1: "1 Example Road", postLine2: "Flat 2", postTown: "Exampleton", postPostcode: "EX1 1EX",
    approvedAt: "2026-10-01T09:00:00.000Z", inMemory: false, teamId: null, isSporting: true, tshirtSize: "adult_m",
    memoryName: null, memorySetupBy: null, memoryDirectorBusiness: null,
    ...over,
  };
}
function facts(over: Partial<MaterialFacts> = {}): MaterialFacts {
  return {
    id: 9, slug: "robins-big-walk", title: "Robin's Big Walk", organiser: "Robin Example", status: "approved",
    when: "Saturday 5 December 2026, 10am", where: "North Inch, Exampleton", line: "Five miles for NBCC.", targetPence: 50000,
    raisedPence: 0, giftAidPence: 0, link: "https://nbcc.scot/fundraise/robins-big-walk", linkKind: "page",
    linkWords: "nbcc.scot/fundraise/robins-big-walk",
    qrLinks: { poster: "https://nbcc.scot/q/9-a4", "poster-a3": "https://nbcc.scot/q/9-a3", leaflet: "https://nbcc.scot/q/9-a5" },
    splitStatement: null, otherCauseName: null, memory: null, event: false, entry: null,
    ...over,
  };
}
function input(over: Partial<PackPrintInput> = {}, s: PackSubject = subject(), stored: StoredPack | null = null, sizes = { a4: 10, a3: 2 }): PackPrintInput {
  return {
    subject: s,
    view: packView(s, stored, sizes)!,
    facts: facts(),
    assets,
    signer: { name: "Fern Example", role: "Volunteer, Night Before Christmas Campaign" },
    date: "3 October 2026",
    part: "all",
    ...over,
  };
}
function page(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}
const text = (n: Element | null) => (n?.textContent ?? "").replace(/\s+/g, " ").trim();

describe("the welcome pack's print view", () => {
  const doc = page(renderWelcomePack(input()));
  const pieces = Array.from(doc.querySelectorAll("[data-pack-piece]"));

  it("is one page of its own, never indexed, with a print button", () => {
    expect(doc.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe("noindex, nofollow");
    expect(doc.title).toContain("Welcome pack for Robin's Big Walk");
    expect(doc.querySelector(".toolbar button")?.textContent).toMatch(/Print/);
  });

  it("has the letter first, then the posters by size, then the leaflets, then the sponsor form", () => {
    expect(pieces.map((p) => p.getAttribute("data-pack-piece"))).toEqual(["letter", "posters_a4", "posters_a3", "leaflets", "sponsor_form"]);
  });

  it("prints up to 10 of each poster as copies, and one of everything else", () => {
    const copies = Object.fromEntries(pieces.map((p) => [p.getAttribute("data-pack-piece"), p.getAttribute("data-copies")]));
    expect(copies).toEqual({ letter: "1", posters_a4: "10", posters_a3: "2", leaflets: "1", sponsor_form: "1" });
    expect(text(doc.querySelector('[data-pack-piece="posters_a4"] .pk-label'))).toBe("A4 poster: prints 10 copies");
    expect(text(doc.querySelector('[data-pack-piece="posters_a3"] .pk-label'))).toBe("A3 poster: prints 2 copies, on A3 paper");
  });

  it("never copies a poster more than 10 times: above that it draws one, and says how many to print", () => {
    expect(text(doc.querySelector('[data-pack-piece="leaflets"] .pk-label'))).toBe(
      "A5 leaflet: print 30 copies of this page (set Copies in the print window), on A5 paper",
    );
    expect(text(doc.querySelector(".pk-bulk"))).toBe(
      "More than 10 of a kind are not copied here, so the page stays quick: 30 A5 leaflets. One of each is below. Print the rest from its own page, with the Materials buttons under Where it is up to (Poster, A4, Poster, A3 or Leaflet, A5), setting Copies in the print window.",
    );
    // The copying only happens in the print window, and is put away after.
    const script = Array.from(doc.querySelectorAll("script")).map((s) => s.textContent).join("\n");
    expect(script).toContain("beforeprint");
    expect(script).toContain("afterprint");
  });

  it("gives each size its own paper", () => {
    expect(doc.querySelector('[data-pack-piece="posters_a4"] .page.size-a4')).toBeTruthy();
    expect(doc.querySelector('[data-pack-piece="posters_a3"] .page.size-a3')).toBeTruthy();
    expect(doc.querySelector('[data-pack-piece="leaflets"] .page.size-a5')).toBeTruthy();
    expect(doc.querySelectorAll('[data-pack-piece="sponsor_form"] .page.landscape')).toHaveLength(2);
    const css = doc.querySelector("style")!.textContent!;
    expect(css).toContain("@page a3p{size:A3 portrait");
    expect(css).toContain(".wl{page:a4p}");
  });

  it("leaves out the organisers' Ask us note: this page is for staff", () => {
    expect(doc.querySelector(".ask-us")).toBeNull();
  });

  it("says what is in the pack but not printed here", () => {
    expect(text(doc.querySelector(".pk-also:not(.pk-bulk):not(.pk-warn)"))).toBe("Also in this pack, not printed here: 2 collection buckets and NBCC T-shirt, Adult M.");
  });

  it("addresses the letter to them, where a window envelope shows it", () => {
    const to = doc.querySelector(".wl-to")!;
    expect(Array.from(to.querySelectorAll("span")).map((s) => s.textContent)).toEqual(["Robin Example", "1 Example Road", "Flat 2", "Exampleton", "EX1 1EX"]);
  });

  it("has the letter's words, their page's address and its QR code, and who signs it", () => {
    const letter = doc.querySelector(".wl")!;
    expect(text(letter.querySelector(".wl-greeting"))).toBe("Dear Robin,");
    expect(text(letter.querySelector(".wl-heading"))).toBe("Robin's Big Walk");
    expect(text(letter)).toContain("Your page is live at nbcc.scot/fundraise/robins-big-walk.");
    expect(letter.querySelector(".wl-qr svg")).toBeTruthy();
    expect(Array.from(letter.querySelectorAll(".wl-list li")).map(text)).toEqual([
      "10 A4 posters", "2 A3 posters", "30 A5 leaflets", "2 collection buckets", "a paper sponsor form", "your NBCC T-shirt, size Adult M",
    ]);
    expect(text(letter)).toContain("nbcc.scot/fundraise/manage");
    expect(text(letter)).toContain("nbcc.scot/fundraise/help");
    expect(text(letter)).toContain("01292 811 015");
    expect(text(letter)).toContain("events@nbcc.scot");
    expect(text(letter.querySelector(".wl-sig"))).toBe("Fern Example");
    expect(text(letter.querySelector(".wl-role"))).toBe("Volunteer, Night Before Christmas Campaign");
    expect(text(letter.querySelector(".wl-date"))).toBe("3 October 2026");
  });

  it("carries the charity statement word for word, and our address with its apostrophe", () => {
    const letter = doc.querySelector(".wl")!;
    expect(text(letter.querySelector(".wl-legal"))).toBe(MATERIALS_STATEMENT);
    expect(text(letter.querySelector(".wl-from"))).toContain("The Elves' Workshop");
    expect(text(letter.querySelector(".wl-from"))).toContain("KA6 5EE");
  });

  it("escapes everything a person typed", () => {
    const s = subject({ title: "<b>Walk</b>", firstName: "<i>Robin</i>", postLine1: "<script>x</script>" });
    const html = renderWelcomePack(input({ facts: facts({ title: "<b>Walk</b>" }), signer: { name: "<u>Fern</u>", role: null } }, s));
    expect(html).not.toContain("<b>Walk</b>");
    expect(html).not.toContain("<i>Robin</i>");
    expect(html).not.toContain("<script>x</script>");
    expect(html).not.toContain("<u>Fern</u>");
  });
});

describe("a long address", () => {
  const to = (s: PackSubject) => page(renderWelcomePack(input({}, s))).querySelector(".wl-to")!;
  const warning = (s: PackSubject) => page(renderWelcomePack(input({}, s))).querySelector("[data-wl-warn]") as HTMLElement;

  it("is never clipped: the block has no hidden overflow", () => {
    const css = page(renderWelcomePack(input())).querySelector("style")!.textContent!;
    const rule = /\.wl-to\{[^}]*\}/.exec(css)![0];
    expect(rule).not.toContain("overflow:hidden");
  });

  it("is set smaller the longer it is, so it stays in the envelope's window", () => {
    expect(to(subject()).className).toBe("wl-to");
    expect(to(subject({ postLine1: "Flat 12, The Old Exampleton Granary and Maltings", postLine2: "147 Upper Exampleton Harbourside Road West" })).className).toBe("wl-to long");
    const longer = subject({
      firstName: "Alexandria-Josephine", lastName: "Featherstonehaugh-Montgomery of Exampleton",
      postLine1: "Flat 12, The Old Exampleton Granary and Maltings, Second Floor West", postLine2: "147 Upper Exampleton Harbourside Road West, Harbourside Quarter",
      postTown: "Exampleton by the Sea, near Greater Sampleton and District", postPostcode: "EX12 34EX",
    });
    expect(to(longer).className).toBe("wl-to tiny");
    expect(warning(longer).hidden).toBe(true);
  });

  it("warns staff on screen, never on paper, when it cannot fit the window at any size", () => {
    const line = "The Old Exampleton Granary and Maltings, Second Floor West, Harbourside Quarter, Greater Exampleton by the Sea, near Sampleton";
    const huge = subject({ firstName: line, lastName: "", postLine1: line, postLine2: line, postTown: line, postPostcode: "EX12 34EX" });
    const w = warning(huge);
    expect(w.hidden).toBe(false);
    expect(text(w)).toBe("This address is too long for the window of the envelope. Check that all of it shows through the window, or write the envelope by hand.");
    expect(w.classList.contains("pk-also")).toBe(true); // .pk-also never prints
    // Every line is still there, in full.
    expect(Array.from(to(huge).querySelectorAll("span")).filter((x) => x.textContent === line)).toHaveLength(4);
    // And the page checks the real size when it opens, in case the estimate was kind.
    const script = Array.from(page(renderWelcomePack(input())).querySelectorAll("script")).map((s) => s.textContent).join("\n");
    expect(script).toContain("data-wl-warn");
    expect(script).toContain("scrollHeight");
  });
});

describe("what is left out of the print", () => {
  it("is anything staff left out of the pack, in the letter's list too", () => {
    const s = subject();
    const stored: StoredPack = {
      sentAt: null, sentBy: null, signer: null, signerRole: null,
      items: [{ key: "posters_a3", label: "2 A3 posters", quantity: 2, tickedAt: null, tickedBy: "admin:fern@example.com", skippedReason: "No A3 paper" }],
    };
    const doc = page(renderWelcomePack(input({}, s, stored)));
    expect(doc.querySelector('[data-pack-piece="posters_a3"]')).toBeNull();
    expect(Array.from(doc.querySelectorAll(".wl-list li")).map(text)).not.toContain("2 A3 posters");
  });

  it("is the sponsor form, for an event host", () => {
    const s = subject({ path: "event", isSporting: null, tshirtSize: null, wants: { ...NONE, posterCount: 5 } });
    const doc = page(renderWelcomePack(input({ facts: facts({ event: true, linkWords: "nbcc.scot/event/robins-quiz", link: "https://nbcc.scot/event/robins-quiz" }) }, s, null, { a4: 5, a3: 0 })));
    expect(Array.from(doc.querySelectorAll("[data-pack-piece]")).map((p) => p.getAttribute("data-pack-piece"))).toEqual(["letter", "posters_a4"]);
    expect(doc.querySelector(".pk-bulk")).toBeNull();
    expect(text(doc.querySelector(".wl"))).toContain("Your event's page is live at nbcc.scot/event/robins-quiz.");
    expect(doc.querySelector(".pk-also:not(.pk-bulk):not(.pk-warn)")).toBeNull();
  });

  it("is everything but the letter, for Print letter only", () => {
    const doc = page(renderWelcomePack(input({ part: "letter" })));
    expect(Array.from(doc.querySelectorAll("[data-pack-piece]")).map((p) => p.getAttribute("data-pack-piece"))).toEqual(["letter"]);
    expect(doc.title).toContain("Welcome letter for Robin's Big Walk");
  });

  it("is the QR code, when the page is not up", () => {
    const s = subject({ public: false });
    const doc = page(renderWelcomePack(input({ facts: facts({ link: null, linkWords: null, linkKind: null, qrLinks: null }) }, s)));
    expect(doc.querySelector(".wl-qr")).toBeNull();
    expect(text(doc.querySelector(".wl"))).not.toContain("is live at");
  });
});

describe("in memory: the things to send", () => {
  const s = subject({
    inMemory: true, memoryName: "Margaret Exampleton", isSporting: null, tshirtSize: null,
    wants: { ...NONE, posterCount: 3, envelopeCount: 30, qrCount: 20 },
  });
  const doc = page(renderWelcomePack(input({ facts: facts({ memory: { name: "Margaret Exampleton", dates: "1940 to 2026" } }) }, s, null, { a4: 3, a3: 0 })));

  it("prints a gentle covering note in place of the welcome letter, then their posters", () => {
    expect(Array.from(doc.querySelectorAll("[data-pack-piece]")).map((p) => p.getAttribute("data-pack-piece"))).toEqual(["letter", "posters_a4"]);
    const note = doc.querySelector(".wl")!;
    expect(note.classList.contains("memory")).toBe(true);
    expect(text(note.querySelector(".wl-greeting"))).toBe("Dear Robin,");
    expect(text(note)).toContain("Here are the things you asked for, for Margaret Exampleton's page.");
    expect(text(note)).toContain("With warmest thoughts,");
    expect(text(note)).not.toContain("!");
    expect(text(note)).not.toMatch(/NBCC family|sponsor|T-shirt/);
    expect(note.querySelector(".wl-qr")).toBeNull();
    expect(doc.title).toContain("Things to send");
  });

  it("says what else goes with it", () => {
    expect(text(doc.querySelector(".pk-also:not(.pk-bulk):not(.pk-warn)"))).toBe("Also to send, not printed here: 20 QR cards for the order of service and 30 collection envelopes.");
  });
});
