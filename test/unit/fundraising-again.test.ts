import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  AGAIN_TTL_DAYS,
  againExpiresAt,
  againPrefill,
  againUrl,
  againVerdict,
  hashAgainToken,
  newAgainToken,
  readAgainToken,
} from "../../src/fundraising/again";
import type { FundraiserRecord } from "../../src/fundraising/model";

// TASK-515: "Do it again", from email 18 (a year on). Its button opens the sign up form filled in from
// last year's fundraiser, in one click: a one use link, kept only as a hash, for 60 days, that fills
// in the safe details and nothing about anyone who gave. Pure rules. Every name here is invented.

const rec = (over: Partial<FundraiserRecord> = {}): FundraiserRecord =>
  ({
    id: 7, slug: "sams-santa-dash-2026", path: "raising", kind: "santa_dash", kindOther: null, title: "Sam's Santa Dash 2026",
    description: "A mile in Santa suits.", eventDate: "2026-12-06", startTime: "10:00", venue: "Riverside Park", town: "Exampleton",
    targetPence: 50000, public: true, status: "finished", name: "Sam Example", firstName: "Sam", lastName: "Example",
    email: "sam@example.com", phone: "07700 900123", socialLink: null, instagram: "sams.dash", facebook: null, socialOk: true,
    wants: { posterCount: 10, leafletCount: 0, bucketCount: 2, tinCount: 0, leaflets: 0, buckets: 0, shoutOut: true, attend: false },
    postAddress: null, postLine1: "1 Example Street", postLine2: null, postTown: "Exampleton", postPostcode: "EX1 1EX",
    newsletterOk: true, imageSrc: "/media/events/x", declinedReason: "internal", createdAt: "2026-10-01T09:00:00Z",
    approvedAt: "2026-10-02T09:00:00Z", approvedBy: "admin:fern@example.com", updatedAt: "2026-10-02T09:00:00Z", updatedBy: null,
    cardLine: null, endTime: null, timeTbc: false, venueAddress: null, venuePostcode: null, access: [], price: null, booking: null,
    ticketUrl: null, ageLimit: null, dressCode: null, included: null, creditName: null, ...over,
  }) as FundraiserRecord;

const NOW = new Date("2027-12-06T08:00:00Z");

describe("the link", () => {
  it("is 32 random bytes, kept only as a hash with its own prefix", () => {
    const t = newAgainToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newAgainToken()).not.toBe(t);
    expect(hashAgainToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashAgainToken(t)).not.toContain(t);
    // Not the invite's hash of the same token: one kind of link can never open the other.
    expect(hashAgainToken(t)).not.toBe(createHash("sha256").update("fundraiseinvite.v1:" + t).digest("hex"));
  });

  it("reads only a token of the right shape", () => {
    const t = newAgainToken();
    expect(readAgainToken(` ${t} `)).toBe(t);
    for (const bad of [undefined, null, 5, "", "short", t + "x", "<script>".padEnd(43, "a")]) expect(readAgainToken(bad)).toBeNull();
  });

  it("opens the sign up form", () => {
    expect(againUrl("https://nbcc.test/", "abc")).toBe("https://nbcc.test/fundraise?again=abc");
  });

  it("works for 60 days, once", () => {
    const made = new Date("2027-12-06T08:00:00Z");
    expect(AGAIN_TTL_DAYS).toBe(60);
    const expiresAt = againExpiresAt(made);
    expect(expiresAt.toISOString()).toBe("2028-02-04T08:00:00.000Z");
    expect(againVerdict(null, made)).toBe("none");
    expect(againVerdict({ expiresAt, usedAt: null }, new Date("2028-02-04T07:59:59Z"))).toBe("ok");
    expect(againVerdict({ expiresAt, usedAt: null }, new Date("2028-02-04T08:00:00Z"))).toBe("expired");
    expect(againVerdict({ expiresAt, usedAt: new Date("2027-12-07T10:00:00Z") }, made)).toBe("used");
  });
});

describe("what it fills in", () => {
  it("is only the safe details of last year's fundraiser", () => {
    const p = againPrefill(rec(), NOW);
    expect(p).toEqual({
      path: "raising",
      kind: "santa_dash",
      kindOther: null,
      title: "Sam's Santa Dash 2027",
      description: "A mile in Santa suits.",
      targetPence: 50000,
      venue: "Riverside Park",
      town: "Exampleton",
      instagram: "sams.dash",
      facebook: null,
      firstName: "Sam",
      lastName: "Example",
      email: "sam@example.com",
      phone: "07700 900123",
    });
    // Never the date, the address, what they asked for, the photo, staff notes or anything else.
    const json = JSON.stringify(p);
    for (const never of ["2026-12-06", "1 Example Street", "EX1 1EX", "/media/", "internal", "fern@", "posterCount", "newsletter"]) {
      expect(json).not.toContain(never);
    }
  });

  it("moves a year in the name on to this year, and leaves a name without one alone", () => {
    expect(againPrefill(rec({ title: "Santa Dash 2025 and 2026" }), NOW).title).toBe("Santa Dash 2027 and 2027");
    expect(againPrefill(rec({ title: "Sam's Santa Dash" }), NOW).title).toBe("Sam's Santa Dash");
    expect(againPrefill(rec({ title: "Dash 2028" }), NOW).title).toBe("Dash 2028");
    expect(againPrefill(rec({ title: "Room 1999 bake off" }), NOW).title).toBe("Room 1999 bake off");
  });

  it("splits the name of a sign up from before the name had two boxes", () => {
    const p = againPrefill(rec({ firstName: null, lastName: null, name: "Robin Van Example" }), NOW);
    expect(p.firstName).toBe("Robin");
    expect(p.lastName).toBe("Van Example");
  });

  it("carries the other kind's words, and no target for an event", () => {
    expect(againPrefill(rec({ kind: "other", kindOther: "A sponsored silence" }), NOW).kindOther).toBe("A sponsored silence");
    expect(againPrefill(rec({ path: "event", targetPence: null }), NOW).targetPence).toBeNull();
  });
});
