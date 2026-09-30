import { createRequire } from "node:module";
import { resolve } from "node:path";
import { eventInputSchema, type EventRecord } from "../../../src/events/model";

// The two events production starts with, read from the seed migration itself so every test
// renders exactly what the database will hold rather than a copy that could drift from it.
const require = createRequire(import.meta.url);
const { SEED } = require(resolve(__dirname, "../../../migrations/1789100000002_events-seed.js")) as {
  SEED: Array<Record<string, unknown> & { slug: string }>;
};

// TASK-456: EmpowHer's leaflet, applied here by the same rule the migration's SQL uses: the picture
// only onto an event with none, each word only while it is still the seed's.
type Swap = { field: string; from: unknown; to: unknown };
const { LEAFLET } = require(resolve(__dirname, "../../../migrations/1789100000003_events-empowher-leaflet.js")) as {
  LEAFLET: { slug: string; picture: Swap[]; words: Swap[] };
};

function withLeaflet(raw: Record<string, unknown> & { slug: string }) {
  if (raw.slug !== LEAFLET.slug) return raw;
  const out: Record<string, unknown> & { slug: string } = { ...raw };
  if (out.imageSrc == null) for (const p of LEAFLET.picture) out[p.field] = p.to;
  for (const w of LEAFLET.words) if (out[w.field] === w.from) out[w.field] = w.to;
  return out;
}

// TASK-472: and the leaflet taken off again, wherever it is still exactly the leaflet. The words stay.
const { LEAFLET_OFF } = require(resolve(__dirname, "../../../migrations/1790900000000_events-empowher-leaflet-off.js")) as {
  LEAFLET_OFF: { slug: string; src: string; picture: Swap[] };
};

function withoutLeaflet(raw: Record<string, unknown> & { slug: string }) {
  if (raw.slug !== LEAFLET_OFF.slug || raw.imageSrc !== LEAFLET_OFF.src) return raw;
  const out: Record<string, unknown> & { slug: string } = { ...raw };
  for (const p of LEAFLET_OFF.picture) out[p.field] = p.to;
  return out;
}

export const SEED_EVENTS: EventRecord[] = SEED.map(withLeaflet).map(withoutLeaflet).map((raw, i) => ({
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
