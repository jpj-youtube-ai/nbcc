// NBCC Elf Detective School: how far a phone is from a hiding place. The design is
// docs/superpowers/specs/2026-10-04-elf-detective-school-design.md ("Rules, precisely").
//
// A stamp needs proof of being there, because every business keeps its poster up all month and a
// photo of it could be passed round online. The phone's position is checked once against the place
// and then thrown away: nothing about where anyone is gets stored. Phones are often vague indoors,
// so the phone's own estimate of how rough its position is widens the allowance, up to a cap.
//
// Pure: no pool, no config, no clock. Unit tested in test/unit/elf-distance.test.ts.

export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_METRES = 6_371_000;

/** How close counts as being there. */
export const NEAR_METRES = 300;

/** The most a phone's own uncertainty can add to that. */
export const MAX_ACCURACY_ALLOWANCE_METRES = 500;

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

/** Is the phone near the place? Within the radius, widened by the phone's own uncertainty up to the cap. */
export function isNear(
  place: LatLng,
  phone: LatLng & { accuracyMetres?: number },
  radiusMetres: number = NEAR_METRES,
): boolean {
  const allowance = Math.min(Math.max(phone.accuracyMetres ?? 0, 0), MAX_ACCURACY_ALLOWANCE_METRES);
  return metresBetween(place, phone) <= radiusMetres + allowance;
}
