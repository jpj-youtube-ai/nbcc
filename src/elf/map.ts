import { isLatLng, metresBetween, type LatLng } from "./distance";

// NBCC Elf Detective School: the planning map. The design is
// docs/superpowers/specs/2026-10-04-elf-detective-school-design.md (decision 19).
//
// While staff sign up businesses they need to see where the hiding places are and where the gaps
// are, on the map they already know: the one on the About us page. That drawing came with no
// projection, but its eleven town circles fit one exactly, so a hiding place can be pinned from its
// position, and a click on the map can be turned back into a position.
//
// The gap staff asked to see: anywhere more than about ten miles from every hiding place.
//
// Pure: no pool, no config, no clock. Unit tested in test/unit/elf-map.test.ts, which pins all
// eleven towns to the circles in about.html.

/** The About us map: its size, the position of its top left corner, and its scale in pixels per degree. */
export const MAP = { width: 499, height: 456, lat0: 55.86, lng0: -5.46, pxPerLat: 625, pxPerLng: 353.8 } as const;

const METRES_PER_MILE = 1609.344;
/** One degree of latitude over the ground, on the sphere src/elf/distance.ts uses. */
const METRES_PER_DEGREE_LAT = 111_194.93;

/** How far from every hiding place counts as a gap. */
export const GAP_MILES = 10;

/** Where a position falls on the map, in the map's own pixels. */
export function toMap(p: LatLng): { x: number; y: number } {
  return { x: (p.lng - MAP.lng0) * MAP.pxPerLng, y: (MAP.lat0 - p.lat) * MAP.pxPerLat };
}

/** The position under a point on the map. It is for reading the map, never for giving a hiding place
 *  its position: one pixel is about 178 metres, so a click two pixels out would put a place beyond
 *  the 300 metres a stamp allows. A place's position comes from its address. */
export function fromMap(x: number, y: number): LatLng {
  return { lat: MAP.lat0 - y / MAP.pxPerLat, lng: MAP.lng0 + x / MAP.pxPerLng };
}

/** Does this position fall inside the drawing? A position that is not real does not. */
export function onMap(p: LatLng): boolean {
  if (!isLatLng(p)) return false;
  const { x, y } = toMap(p);
  // A hair of slack, so that the drawing's own corners count as on it despite the arithmetic.
  return x >= -1e-6 && x <= MAP.width + 1e-6 && y >= -1e-6 && y <= MAP.height + 1e-6;
}

/** The miles between two positions, over the ground. */
export function milesBetween(a: LatLng, b: LatLng): number {
  return metresBetween(a, b) / METRES_PER_MILE;
}

/** How many of the map's pixels a distance in miles covers. */
export function milesToPx(miles: number): number {
  return (miles * METRES_PER_MILE * MAP.pxPerLat) / METRES_PER_DEGREE_LAT;
}

/** Is this position more than `miles` from every hiding place? True everywhere when there are none.
 *  A place with no real position yet is left out, so one unfinished place cannot hide every gap, and
 *  a distance that is not a real one goes back to ten miles.
 *
 *  To shade the gaps on the drawing there is no need to ask this for every pixel: a circle of
 *  `milesToPx(miles)` round each place covers the same ground, and what is left uncovered is the gap. */
export function farFromAll(point: LatLng, places: readonly LatLng[], miles: number = GAP_MILES): boolean {
  const limit = typeof miles === "number" && Number.isFinite(miles) && miles > 0 ? miles : GAP_MILES;
  return places.filter(isLatLng).every((place) => milesBetween(point, place) > limit);
}
