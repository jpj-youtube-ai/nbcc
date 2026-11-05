import { describe, it, expect } from "vitest";
import { MAX_NEAR_METRES, NEAR_METRES, isLatLng, isNear, metresBetween, nearRadius } from "../../src/elf/distance";

// NBCC Elf Detective School: how far a phone is from a hiding place. The points are town centres,
// not anybody's address.

const PLACE = { lat: 55.458, lng: -4.629 };
// One degree of latitude is 111,195 metres on the sphere this uses, so this many degrees north is N metres.
const north = (metres: number) => ({ lat: PLACE.lat + metres / 111_195, lng: PLACE.lng });

describe("the distance between two points", () => {
  it("is nothing between a point and itself", () => {
    expect(metresBetween(PLACE, PLACE)).toBe(0);
  });

  it("is about 111 kilometres for one degree of latitude", () => {
    expect(metresBetween({ lat: 55, lng: -4 }, { lat: 56, lng: -4 })).toBeCloseTo(111_195, -1);
  });

  it("shrinks with latitude for one degree of longitude", () => {
    expect(metresBetween({ lat: 60, lng: 0 }, { lat: 60, lng: 1 })).toBeCloseTo(55_597, -1);
  });

  it("is the same in either direction", () => {
    const a = { lat: 55.611, lng: -4.495 };
    expect(metresBetween(PLACE, a)).toBeCloseTo(metresBetween(a, PLACE), 6);
  });
});

describe("a real position", () => {
  it("is two finite numbers within the globe", () => {
    expect(isLatLng(PLACE)).toBe(true);
    expect(isLatLng({ lat: 91, lng: 0 })).toBe(false);
    expect(isLatLng({ lat: 0, lng: 181 })).toBe(false);
    expect(isLatLng({ lat: Number.NaN, lng: 0 })).toBe(false);
    expect(isLatLng({ lat: "55", lng: "-4" })).toBe(false);
    expect(isLatLng(null)).toBe(false);
    expect(isLatLng("here")).toBe(false);
  });
});

describe("being near a hiding place", () => {
  it("allows 300 metres by default", () => {
    expect(NEAR_METRES).toBe(300);
    expect(isNear(PLACE, north(200))).toBe(true);
    expect(isNear(PLACE, north(299))).toBe(true);
    expect(isNear(PLACE, north(301))).toBe(false);
    expect(isNear(PLACE, north(400))).toBe(false);
  });

  it("uses the distance staff have set, wider or tighter", () => {
    expect(isNear(PLACE, north(400), 500)).toBe(true);
    expect(isNear(PLACE, north(15), 20)).toBe(true);
    expect(isNear(PLACE, north(50), 20)).toBe(false);
  });

  it("takes the distance staff set as a number or as the text a database gives", () => {
    expect(nearRadius(500)).toBe(500);
    expect(nearRadius("500")).toBe(500);
    expect(nearRadius("62.5")).toBe(62.5);
  });

  it("goes back to 300 metres when the distance set is not a sensible one", () => {
    for (const set of [0, -20, Number.NaN, Number.POSITIVE_INFINITY, "", "   ", "far", null, undefined, {}, true]) {
      expect(nearRadius(set), String(set)).toBe(300);
    }
    expect(isNear(PLACE, north(200), 0)).toBe(true);
    expect(isNear(PLACE, north(5000), Number.POSITIVE_INFINITY)).toBe(false);
  });

  it("never stretches further than 2,000 metres", () => {
    expect(MAX_NEAR_METRES).toBe(2000);
    expect(nearRadius(50_000)).toBe(2000);
    expect(isNear(PLACE, north(1900), 50_000)).toBe(true);
    expect(isNear(PLACE, north(2100), 50_000)).toBe(false);
  });

  it("takes no notice of how unsure the phone says it is, because the phone supplies that figure", () => {
    const unsure = (metres: number) => ({ ...north(metres), accuracyMetres: 5000 });
    expect(isNear(PLACE, unsure(400))).toBe(false);
    expect(isNear(PLACE, unsure(50), 20)).toBe(false);
  });

  it("does not count a position that is not on the globe", () => {
    expect(isNear(PLACE, { lat: PLACE.lat + 360, lng: PLACE.lng })).toBe(false);
    expect(isNear(PLACE, { lat: Number.NaN, lng: PLACE.lng })).toBe(false);
  });
});
