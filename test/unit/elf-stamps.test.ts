import { describe, it, expect } from "vitest";
import { decideStamp, type StampContext } from "../../src/elf/stamps";
import type { LatLng } from "../../src/elf/distance";

// NBCC Elf Detective School: earning a candy cane stamp for visiting. Every id is invented, and the
// points are a town centre, not anybody's address.

const PLACE = { lat: 55.458, lng: -4.629 };
const HERE = { lat: 55.4585, lng: -4.629 }; // about 55 metres north
const A_KILOMETRE = { lat: 55.467, lng: -4.629 }; // about 1 kilometre north
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

  it("takes one ticked box, which a form sends as a single value", () => {
    expect(decideStamp(ctx, { detectiveIds: "d1", location: HERE, hasPhoto: false })).toEqual({
      ok: true,
      detectiveIds: ["d1"],
      proof: "location",
    });
  });

  it("matches ids that are numbers in the database with the same ids from a form", () => {
    const numbered = { ...ctx, familyDetectiveIds: [14, 15], alreadyStamped: [14] };
    expect(decideStamp(numbered, { detectiveIds: ["14", "15"], location: HERE, hasPhoto: false })).toEqual({
      ok: true,
      detectiveIds: ["15"],
      proof: "location",
    });
  });

  it("uses the distance staff have set", () => {
    const tight = decideStamp({ ...ctx, radiusMetres: 20 }, { detectiveIds: ["d1"], location: HERE, hasPhoto: false });
    expect(tight).toEqual({ ok: false, reason: "too-far" });
  });

  it("goes back to 300 metres when the distance set is not a sensible one", () => {
    for (const radiusMetres of [0, -5, Number.NaN, null]) {
      const got = decideStamp({ ...ctx, radiusMetres }, { detectiveIds: ["d1"], location: HERE, hasPhoto: false });
      expect(got, String(radiusMetres)).toEqual({ ok: true, detectiveIds: ["d1"], proof: "location" });
      const kilometre = decideStamp({ ...ctx, radiusMetres }, { detectiveIds: ["d1"], location: A_KILOMETRE, hasPhoto: false });
      expect(kilometre, String(radiusMetres)).toEqual({ ok: false, reason: "too-far" });
    }
    const everywhere = decideStamp(
      { ...ctx, radiusMetres: Number.POSITIVE_INFINITY },
      { detectiveIds: ["d1"], location: FAR, hasPhoto: false },
    );
    expect(everywhere).toEqual({ ok: false, reason: "too-far" });
  });

  it("treats a family with no stamps recorded yet as having none", () => {
    const none = { ...ctx, alreadyStamped: null };
    expect(decideStamp(none, { detectiveIds: ["d1"], location: HERE, hasPhoto: false }).ok).toBe(true);
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

  it("refuses with no detective chosen, which a form sends as nothing at all", () => {
    expect(decideStamp(ctx, { detectiveIds: [], location: HERE, hasPhoto: false })).toEqual({
      ok: false,
      reason: "no-detectives",
    });
    expect(decideStamp(ctx, { detectiveIds: undefined, location: HERE, hasPhoto: false })).toEqual({
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

  it("counts a photo only when the server says, with a plain true, that it received one", () => {
    for (const said of ["false", "true", "0", 1, {}]) {
      const got = decideStamp(ctx, { detectiveIds: ["d1"], location: null, hasPhoto: said as unknown as boolean });
      expect(got, String(said)).toEqual({ ok: false, reason: "no-proof" });
    }
  });

  it("treats a position that is not on the globe as not shared", () => {
    const nowhere = { lat: 999, lng: 0 };
    expect(decideStamp(ctx, { detectiveIds: ["d1"], location: nowhere, hasPhoto: false })).toEqual({
      ok: false,
      reason: "no-proof",
    });
    expect(decideStamp(ctx, { detectiveIds: ["d1"], location: nowhere, hasPhoto: true })).toEqual({
      ok: true,
      detectiveIds: ["d1"],
      proof: "photo",
    });
  });

  it("says the place is unknown, not that the phone is too far, when the place has no real position", () => {
    const asText = { lat: "55.458", lng: "-4.629" } as unknown as LatLng;
    expect(decideStamp({ ...ctx, place: asText }, { detectiveIds: ["d1"], location: HERE, hasPhoto: false })).toEqual({
      ok: false,
      reason: "place-unknown",
    });
    expect(decideStamp({ ...ctx, place: asText }, { detectiveIds: ["d1"], location: HERE, hasPhoto: true })).toEqual({
      ok: true,
      detectiveIds: ["d1"],
      proof: "photo",
    });
  });

  it("says the place is unknown when staff have not given it a position yet", () => {
    expect(decideStamp({ ...ctx, place: null }, { detectiveIds: ["d1"], location: HERE, hasPhoto: false })).toEqual({
      ok: false,
      reason: "place-unknown",
    });
  });
});
