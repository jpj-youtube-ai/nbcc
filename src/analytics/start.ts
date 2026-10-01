import { connectGeoDb } from "./geo-db";
import { setPlaceResolver, type Place } from "./place";

// The one join between the counting (TASK-479) and the location database (TASK-481): at start-up,
// connect the DB-IP lookup when the file is in the image. Without it the app still starts and the
// counting simply records no place. Called from src/index.ts, not createApp(), so tests and BDD
// runs that build an app never open the file.
export function startPlaceLookups(
  connect: () => ((ip: string) => Place | null) | null = connectGeoDb,
): boolean {
  const lookup = connect();
  setPlaceResolver(lookup);
  return lookup !== null;
}
