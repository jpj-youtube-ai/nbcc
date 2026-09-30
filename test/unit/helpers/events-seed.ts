import { createRequire } from "node:module";
import { resolve } from "node:path";
import { eventInputSchema, type EventRecord } from "../../../src/events/model";

// The two events production starts with, read from the seed migration itself so every test
// renders exactly what the database will hold rather than a copy that could drift from it.
const require = createRequire(import.meta.url);
const { SEED } = require(resolve(__dirname, "../../../migrations/1789100000002_events-seed.js")) as {
  SEED: Array<Record<string, unknown> & { slug: string }>;
};

export const SEED_EVENTS: EventRecord[] = SEED.map((raw, i) => ({
  ...eventInputSchema.parse(raw),
  id: i + 1,
  slug: raw.slug,
}));

/** A seed event with some fields changed, for tests about one field at a time. */
export function seedWith(slug: string, over: Partial<EventRecord>): EventRecord {
  const base = SEED_EVENTS.find((e) => e.slug === slug);
  if (!base) throw new Error(`no seed event ${slug}`);
  return { ...base, ...over };
}
