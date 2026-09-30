// TASK-479: the town or city a view came from, looked up from the IP address, which is then
// forgotten. The lookup itself (the DB-IP database reader) is connected at start-up by TASK-481
// through setPlaceResolver; until then, and whenever a lookup fails, no place is recorded.

export type Place = { country: string | null; region: string | null; city: string | null };

type Resolver = (ip: string) => Place | null;

const NOWHERE: Place = { country: null, region: null, city: null };

let resolver: Resolver | null = null;

/** Connect the place lookup (or pass null to disconnect it). */
export function setPlaceResolver(fn: Resolver | null): void {
  resolver = fn;
}

export function resolvePlace(ip: string): Place {
  if (!resolver) return { ...NOWHERE };
  try {
    return resolver(ip) ?? { ...NOWHERE };
  } catch {
    return { ...NOWHERE };
  }
}
