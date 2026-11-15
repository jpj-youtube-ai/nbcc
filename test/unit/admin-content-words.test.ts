import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { resolve } from "node:path";

// The words Stories and Partners say, as pure functions in assets/js/admin/helpers.js
// (docs/superpowers/specs/2026-11-14-admin-refresh-content.md). What a story's sender agreed to is
// the most important thing on the Stories screens, so the sentences that say it are pinned here.
// Every name and date is invented.

const require = createRequire(import.meta.url);
const H = require(resolve(__dirname, "../../assets/js/admin/helpers.js"));

describe("longDate: a date as people say it", () => {
  it("is the day, the month in words and the year", () => {
    expect(H.longDate("2026-11-03T10:15:00Z")).toBe("3 November 2026");
    expect(H.longDate(new Date("2026-06-01T00:00:00Z"))).toBe("1 June 2026");
  });

  it("is the day it was in the UK, not in UTC", () => {
    // Half past eleven at night in UTC on 30 June is already 1 July in a British summer.
    expect(H.longDate("2026-06-30T23:30:00Z")).toBe("1 July 2026");
  });

  it("is empty for nothing, or for something that is not a date", () => {
    expect(H.longDate(null)).toBe("");
    expect(H.longDate("nonsense")).toBe("");
  });
});

describe("partnerKey: whether two partner names are the same name", () => {
  it("ignores capitals, the spaces around and between words, and an ampersand for and", () => {
    expect(H.partnerKey("  Rowan  Example JOINERY ")).toBe(H.partnerKey("rowan example joinery"));
    expect(H.partnerKey("Thistle & Example")).toBe(H.partnerKey("thistle and example"));
  });

  it("ignores full stops, commas and apostrophes", () => {
    expect(H.partnerKey("Heather's Example Cafe Ltd.")).toBe(H.partnerKey("Heathers Example Cafe Ltd"));
  });

  it("keeps two different names apart", () => {
    expect(H.partnerKey("Ayr Example Bakery")).not.toBe(H.partnerKey("Ayr Example Bakery Two"));
  });

  it("is empty for nothing", () => {
    expect(H.partnerKey("")).toBe("");
    expect(H.partnerKey(null)).toBe("");
  });
});

describe("storyConsentLine: what a story's sender agreed to, as one sentence", () => {
  const s = (o: Record<string, unknown>) => ({ use_scope: "public", consent_share_first_name: false, consent_share_town: false, ...o });
  it("says public use and which details may go with it", () => {
    expect(H.storyConsentLine(s({ consent_share_first_name: true }))).toBe("May be used in public, with their first name, not their town.");
    expect(H.storyConsentLine(s({ consent_share_first_name: true, consent_share_town: true }))).toBe("May be used in public, with their first name and their town.");
    expect(H.storyConsentLine(s({ consent_share_town: true }))).toBe("May be used in public, with their town, not their name.");
    expect(H.storyConsentLine(s({}))).toBe("May be used in public, without their name or their town.");
  });
  it("says a private story is never to be published, whatever else was ticked", () => {
    expect(H.storyConsentLine(s({ use_scope: "internal_only", consent_share_first_name: true }))).toBe("Private to NBCC: never to be published.");
  });
});

describe("consentIsOld: consent given over a year ago", () => {
  const now = new Date("2026-11-15T12:00:00Z");
  it("is true past 365 days and false up to then", () => {
    expect(H.consentIsOld("2025-11-14T12:00:00Z", now)).toBe(true);
    expect(H.consentIsOld("2025-11-16T12:00:00Z", now)).toBe(false);
    expect(H.consentIsOld(null, now)).toBe(false);
  });
});
