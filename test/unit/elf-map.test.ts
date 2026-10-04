import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { GAP_MILES, MAP, farFromAll, fromMap, milesBetween, milesToPx, onMap, toMap } from "../../src/elf/map";

// NBCC Elf Detective School: the planning map. The towns below are the eleven marked on the public
// About us map, with the circle centres copied from about.html, so the projection is pinned to the
// drawing staff already know.

const TOWNS = [
  { name: "Largs", lat: 55.795, lng: -4.87, x: 208.8, y: 40.6 },
  { name: "Ayr", lat: 55.458, lng: -4.629, x: 294.0, y: 251.3 },
  { name: "Kilwinning", lat: 55.655, lng: -4.703, x: 267.8, y: 128.1 },
  { name: "Stevenston", lat: 55.645, lng: -4.758, x: 248.4, y: 134.4 },
  { name: "Kilmarnock", lat: 55.611, lng: -4.495, x: 341.4, y: 155.6 },
  { name: "Auchinleck", lat: 55.47, lng: -4.295, x: 412.2, y: 243.8 },
  { name: "Maybole", lat: 55.356, lng: -4.68, x: 276.0, y: 315.0 },
  { name: "Dalmellington", lat: 55.324, lng: -4.406, x: 372.9, y: 335.0 },
  { name: "Ardrossan", lat: 55.642, lng: -4.809, x: 230.3, y: 136.2 },
  { name: "Irvine", lat: 55.612, lng: -4.669, x: 279.9, y: 155.0 },
  { name: "Girvan", lat: 55.241, lng: -4.859, x: 212.6, y: 386.9 },
];
const town = (name: string) => TOWNS.find((t) => t.name === name)!;

describe("the About us map's projection", () => {
  it("matches the map's own size", () => {
    const html = readFileSync(resolve(__dirname, "../../about.html"), "utf8");
    expect(html).toContain(`viewBox="0 0 ${MAP.width} ${MAP.height}"`);
  });

  it("puts each of the eleven towns where the map draws it", () => {
    for (const t of TOWNS) {
      const p = toMap(t);
      expect(p.x, `${t.name} x`).toBeCloseTo(t.x, 0);
      expect(p.y, `${t.name} y`).toBeCloseTo(t.y, 0);
      expect(Math.abs(p.x - t.x), `${t.name} x`).toBeLessThan(0.3);
      expect(Math.abs(p.y - t.y), `${t.name} y`).toBeLessThan(0.3);
    }
  });

  it("still finds those circles in about.html", () => {
    const html = readFileSync(resolve(__dirname, "../../about.html"), "utf8");
    for (const t of TOWNS) expect(html, t.name).toContain(`cx="${t.x.toFixed(1)}" cy="${t.y.toFixed(1)}"`);
  });

  it("turns a point on the map back into a position", () => {
    for (const t of TOWNS) {
      const back = fromMap(toMap(t).x, toMap(t).y);
      expect(back.lat).toBeCloseTo(t.lat, 6);
      expect(back.lng).toBeCloseTo(t.lng, 6);
    }
  });

  it("knows what is on the map and what is off it", () => {
    expect(onMap(town("Ayr"))).toBe(true);
    expect(onMap({ lat: 55.95, lng: -3.19 })).toBe(false); // far to the east
    expect(onMap({ lat: 57.5, lng: -4.6 })).toBe(false); // far to the north
  });
});

describe("miles", () => {
  it("measures the miles between two places", () => {
    expect(milesBetween(town("Ayr"), town("Kilmarnock"))).toBeCloseTo(11.8, 0);
    expect(milesBetween(town("Ayr"), town("Ayr"))).toBe(0);
  });

  it("draws ten miles as about ninety pixels", () => {
    expect(milesToPx(10)).toBeCloseTo(90.5, 0);
    expect(milesToPx(0)).toBe(0);
  });
});

describe("the gaps staff need to see", () => {
  it("flags anywhere more than ten miles from every hiding place", () => {
    expect(GAP_MILES).toBe(10);
    expect(farFromAll(town("Girvan"), [town("Ayr")])).toBe(true);
    expect(farFromAll(town("Maybole"), [town("Ayr")])).toBe(false);
  });

  it("is covered by any one place close enough", () => {
    expect(farFromAll(town("Girvan"), [town("Ayr"), town("Maybole")])).toBe(true);
    expect(farFromAll(town("Girvan"), [town("Ayr"), town("Girvan")])).toBe(false);
  });

  it("flags everywhere when there are no hiding places yet", () => {
    expect(farFromAll(town("Ayr"), [])).toBe(true);
  });

  it("uses the distance staff choose", () => {
    expect(farFromAll(town("Maybole"), [town("Ayr")], 5)).toBe(true);
  });
});
