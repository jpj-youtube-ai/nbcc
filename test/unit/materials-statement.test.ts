import { describe, it, expect } from "vitest";
import {
  MATERIALS_STATEMENT,
  MATERIALS_STATEMENT_SHORT,
  REGISTRATION_LINES,
} from "../../src/legal/registration";

// TASK-512: the charity statement every printed piece carries (poster, leaflet, sponsor form,
// certificate), and the shorter one on the social pictures. Section 52 of the Charities and Trustee
// Investment (Scotland) Act 2005 and OSCR's guidance for a SCIO: the name, "Scottish Charitable
// Incorporated Organisation" in full, and the charity number, on adverts, notices, campaign and
// fundraising documents. Pinned word for word, as Jaimie gave it, so nobody rewords it by accident.

describe("the charity statement on printed materials", () => {
  it("is exactly the wording Jaimie gave", () => {
    expect(MATERIALS_STATEMENT).toBe(
      "Night Before Christmas Campaign, known as NBCC, is a Scottish Charitable Incorporated Organisation. " +
        "Scottish Charity Number SC047995. Regulated by the Scottish Charity Regulator, OSCR. " +
        "The Elves' Workshop, Annbank Village Hall, Weston Avenue, Annbank, KA6 5EE",
    );
  });

  it("starts with the site's own registration lines, so the two cannot drift apart", () => {
    expect(MATERIALS_STATEMENT.startsWith(`${REGISTRATION_LINES[0]} ${REGISTRATION_LINES[1]} `)).toBe(true);
  });

  it("has no dashes", () => {
    expect(MATERIALS_STATEMENT).not.toMatch(/\w-\w|[–—]/);
  });
});

describe("the shorter statement on the social pictures", () => {
  it("is the agreed line", () => {
    expect(MATERIALS_STATEMENT_SHORT).toBe(
      "Night Before Christmas Campaign (NBCC), a Scottish Charitable Incorporated Organisation, SC047995",
    );
  });

  it("still has all three parts the law asks for", () => {
    expect(MATERIALS_STATEMENT_SHORT).toContain("Night Before Christmas Campaign");
    expect(MATERIALS_STATEMENT_SHORT).toContain("Scottish Charitable Incorporated Organisation");
    expect(MATERIALS_STATEMENT_SHORT).toContain("SC047995");
  });
});
