import { describe, it, expect } from "vitest";
import { decideStamp, type StampContext } from "../../src/elf/stamps";

// NBCC Elf Detective School: earning a candy cane stamp for visiting. Every id and place is invented.

const PLACE = { lat: 55.458, lng: -4.629 };
const HERE = { lat: 55.4585, lng: -4.629 }; // about 55 metres north
const FAR = { lat: 55.5, lng: -4.629 }; // about 4.7 kilometres north

const ctx: StampContext = {
  doorState: "found",
  place: PLACE,
  familyDetectiveIds: ["d1", "d2", "d3"],
  alreadyStamped: [],
};

describe("earning a stamp", () => {
  it("stamps the detectives who are there when the phone is near the place", () => {
    expect(decideStamp(ctx, { detectiveIds: ["d1", "d2"], location: HERE, hasPhoto: false })).toEqual({
      ok: true,
      detectiveIds: ["d1", "d2"],
      proof: "location",
    });
  });

  it("works on a revealed door too", () => {
    const got = decideStamp({ ...ctx, doorState: "revealed" }, { detectiveIds: ["d1"], location: HERE, hasPhoto: false });
    expect(got.ok).toBe(true);
  });

  it("takes a photo instead when no location is shared", () => {
    expect(decideStamp(ctx, { detectiveIds: ["d1"], location: null, hasPhoto: true })).toEqual({
      ok: true,
      detectiveIds: ["d1"],
      proof: "photo",
    });
  });

  it("takes a photo when the location is too far, and says the photo was the proof", () => {
    expect(decideStamp(ctx, { detectiveIds: ["d1"], location: FAR, hasPhoto: true })).toEqual({
      ok: true,
      detectiveIds: ["d1"],
      proof: "photo",
    });
  });

  it("prefers the location when both are given and the phone is near", () => {
    const got = decideStamp(ctx, { detectiveIds: ["d1"], location: HERE, hasPhoto: true });
    expect(got).toEqual({ ok: true, detectiveIds: ["d1"], proof: "location" });
  });

  it("only stamps the detectives who do not have this stamp yet, each once", () => {
    const got = decideStamp(
      { ...ctx, alreadyStamped: ["d1"] },
      { detectiveIds: ["d1", "d2", "d2"], location: HERE, hasPhoto: false },
    );
    expect(got).toEqual({ ok: true, detectiveIds: ["d2"], proof: "location" });
  });

  it("uses the distance staff have set", () => {
    const tight = decideStamp({ ...ctx, radiusMetres: 20 }, { detectiveIds: ["d1"], location: HERE, hasPhoto: false });
    expect(tight).toEqual({ ok: false, reason: "too-far" });
  });
});

describe("not earning a stamp", () => {
  it("refuses until the door is open", () => {
    expect(decideStamp({ ...ctx, doorState: "hunting" }, { detectiveIds: ["d1"], location: HERE, hasPhoto: false })).toEqual({
      ok: false,
      reason: "door-not-open",
    });
    expect(decideStamp({ ...ctx, doorState: "shut" }, { detectiveIds: ["d1"], location: HERE, hasPhoto: false })).toEqual({
      ok: false,
      reason: "door-not-open",
    });
  });

  it("refuses with no detective chosen", () => {
    expect(decideStamp(ctx, { detectiveIds: [], location: HERE, hasPhoto: false })).toEqual({
      ok: false,
      reason: "no-detectives",
    });
  });

  it("refuses a detective from another family", () => {
    expect(decideStamp(ctx, { detectiveIds: ["d9"], location: HERE, hasPhoto: false })).toEqual({
      ok: false,
      reason: "not-your-detective",
    });
  });

  it("says so when everyone chosen already has this stamp", () => {
    expect(decideStamp({ ...ctx, alreadyStamped: ["d1", "d2"] }, { detectiveIds: ["d1", "d2"], location: HERE, hasPhoto: false })).toEqual({
      ok: false,
      reason: "nothing-new",
    });
  });

  it("refuses a phone that is too far away with no photo", () => {
    expect(decideStamp(ctx, { detectiveIds: ["d1"], location: FAR, hasPhoto: false })).toEqual({
      ok: false,
      reason: "too-far",
    });
  });

  it("refuses with neither a location nor a photo", () => {
    expect(decideStamp(ctx, { detectiveIds: ["d1"], location: null, hasPhoto: false })).toEqual({
      ok: false,
      reason: "no-proof",
    });
  });
});
