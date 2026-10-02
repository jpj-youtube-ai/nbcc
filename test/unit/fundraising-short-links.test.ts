import { describe, it, expect } from "vitest";
import { initialsSlug, freeSlugFrom } from "../../src/fundraising/slugs";
import { isValidSlug, RESERVED_SLUGS } from "../../src/fundraising/model";

// TASK-511: short page links. A new sign up's page is nbcc.scot/fundraise/<the initials of its
// name>: the first letter of each word, letters and numbers only, in lower case. Shorter than two,
// and the first word is used instead. A clash takes a number (ssd2, ssd3), a reserved address is
// never used, and no address a page has ever had is given to another. Every title is invented.

describe("the initials", () => {
  it.each([
    ["Sam's Santa Dash", "ssd"],
    ["Sam’s Santa Dash", "ssd"],
    ["The Office Bake Sale", "tobs"],
    ["Jo & Kim's 10k Run", "jk1r"],
    ["Siân's Café Morning", "scm"],
    ["coffee-morning for NBCC", "cmfn"],
    ["Bakeathon", "bakeathon"],
    ["Bakeathon!!", "bakeathon"],
    ["The Bakeathon", "tb"],
    ["  Robin   Quill  ", "rq"],
  ])("makes %j into %j", (title, slug) => {
    expect(initialsSlug(title)).toBe(slug);
  });

  it("falls back to fundraiser when there is nothing to use", () => {
    expect(initialsSlug("")).toBe("fundraiser");
    expect(initialsSlug("!!!")).toBe("fundraiser");
    expect(initialsSlug("A")).toBe("fundraiser");
    expect(initialsSlug("日本語")).toBe("fundraiser");
  });

  it("keeps a long name to a sensible length", () => {
    expect(initialsSlug("Supercalifragilisticexpialidociousbakeathonforeveryoneinexampletonandbeyond").length).toBeLessThanOrEqual(30);
    expect(initialsSlug(Array.from({ length: 80 }, () => "word").join(" ")).length).toBeLessThanOrEqual(30);
  });

  it("always makes an address the admin and the database accept", () => {
    for (const t of ["Sam's Santa Dash", "Bakeathon", "", "A", "9 to 5", "Ünïcödé Fun Run", "x".repeat(200)]) {
      expect(isValidSlug(initialsSlug(t)) || RESERVED_SLUGS.has(initialsSlug(t))).toBe(true);
    }
  });
});

describe("a free address", () => {
  it("is the initials when nobody has them", () => {
    expect(freeSlugFrom("ssd", new Set())).toBe("ssd");
  });

  it("takes the next number on a clash", () => {
    expect(freeSlugFrom("ssd", new Set(["ssd"]))).toBe("ssd2");
    expect(freeSlugFrom("ssd", new Set(["ssd", "ssd2", "ssd3"]))).toBe("ssd4");
    expect(freeSlugFrom("ssd", new Set(["ssd2"]))).toBe("ssd");
  });

  it("never uses a reserved address, the help page, the manage page, the logo pack or the sponsor form", () => {
    for (const reserved of ["help", "manage", "logos", "sponsor-form"]) expect(RESERVED_SLUGS.has(reserved)).toBe(true);
    expect(freeSlugFrom("help", new Set())).toBe("help2");
    expect(freeSlugFrom("manage", new Set(["manage2"]))).toBe("manage3");
  });

  it("is never one a page used to have, as the caller counts those as taken", () => {
    const takenNowOrBefore = new Set(["ssd", "ssd2"]);
    expect(freeSlugFrom("ssd", takenNowOrBefore)).toBe("ssd3");
  });
});
