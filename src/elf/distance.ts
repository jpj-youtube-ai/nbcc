// NBCC Elf Detective School: how far a phone is from a hiding place. The design is
// docs/superpowers/specs/2026-10-04-elf-detective-school-design.md ("Rules, precisely").
//
// A stamp needs proof of being there, because every business keeps its poster up all month and a
// photo of it could be passed round online. The phone's position is checked once against the place
// and then thrown away: nothing about where anyone is gets stored.
//
// A phone also says how sure it is of its position. That figure is deliberately not used. The phone
// supplies it, so trusting it would let a phone that claims to be unsure check in from across town,
// and would undo a tighter distance set by staff. A phone that cannot get a good fix sends a photo
// instead.
//
// Pure: no pool, no config, no clock. Unit tested in test/unit/elf-distance.test.ts.

export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_METRES = 6_371_000;

/** How close counts as being there. */
export const NEAR_METRES = 300;

/** The furthest that staff can stretch it to. */
export const MAX_NEAR_METRES = 2000;

/** Is this a real position: two finite numbers within the globe? */
export function isLatLng(value: unknown): value is LatLng {
  if (typeof value !== "object" || value === null) return false;
  const { lat, lng } = value as { lat?: unknown; lng?: unknown };
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
  );
}

const radians = (degrees: number): number => (degrees * Math.PI) / 180;

/** The distance between two points over the ground, in metres (the haversine formula). */
export function metresBetween(a: LatLng, b: LatLng): number {
  const dLat = radians(b.lat - a.lat);
  const dLng = radians(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METRES * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The distance that counts as near: the one staff set, as a number or as the text a database gives,
 *  when it is a real distance above nothing, and never more than 2,000 metres. Otherwise 300. So a
 *  setting left empty cannot switch the check off, and a huge one cannot let everyone in. */
export function nearRadius(setting: unknown): number {
  const set = typeof setting === "string" && setting.trim() !== "" ? Number(setting) : setting;
  if (typeof set !== "number" || !Number.isFinite(set) || set <= 0) return NEAR_METRES;
  return Math.min(set, MAX_NEAR_METRES);
}

/** Is the phone near the place? Only a real position within the radius counts. */
export function isNear(place: LatLng, phone: LatLng, radiusMetres?: unknown): boolean {
  return isLatLng(place) && isLatLng(phone) && metresBetween(place, phone) <= nearRadius(radiusMetres);
}
