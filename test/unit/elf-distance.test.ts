import { describe, it, expect } from "vitest";
import { MAX_ACCURACY_ALLOWANCE_METRES, NEAR_METRES, isLatLng, isNear, metresBetween } from "../../src/elf/distance";

// NBCC Elf Detective School: how far a phone is from a hiding place. The points are invented.

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
    expect(isNear(PLACE, north(400))).toBe(false);
  });

  it("allows for a phone that says its own position is rough", () => {
    expect(isNear(PLACE, { ...north(400), accuracyMetres: 150 })).toBe(true);
    expect(isNear(PLACE, { ...north(400), accuracyMetres: 50 })).toBe(false);
  });

  it("caps that allowance, so a wildly unsure phone cannot check in from across town", () => {
    expect(MAX_ACCURACY_ALLOWANCE_METRES).toBe(500);
    expect(isNear(PLACE, { ...north(700), accuracyMetres: 5000 })).toBe(true);
    expect(isNear(PLACE, { ...north(900), accuracyMetres: 5000 })).toBe(false);
  });

  it("ignores a negative accuracy", () => {
    expect(isNear(PLACE, { ...north(400), accuracyMetres: -200 })).toBe(false);
  });

  it("uses the distance staff have set", () => {
    expect(isNear(PLACE, north(400), 500)).toBe(true);
  });
});
