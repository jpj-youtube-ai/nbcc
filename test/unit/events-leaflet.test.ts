// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { eventInputSchema, isSafeImageSrc, publishProblems } from "../../src/events/model";
import { renderCard } from "../../src/events/render";
import { SEED_EVENTS } from "./helpers/events-seed";

// TASK-456: EmpowHer '26 shows the organiser's leaflet, and the card says what the leaflet says.
//
// A migration makes the change on production's copy of the event, one field at a time, and only
// where a field still holds exactly what the seed put there: nothing staff have changed in the
// admin since is ever overwritten. These tests pin that without a database; features/events.feature
// runs the real SQL against Postgres in CI.

type Swap = { field: string; column: string; from: string | null; to: string };

const REPO = resolve(__dirname, "../..");
const require = createRequire(import.meta.url);
const migration = require(resolve(REPO, "migrations/1789100000003_events-empowher-leaflet.js")) as {
  LEAFLET: { slug: string; picture: Swap[]; words: Swap[] };
  up: (pgm: { sql: (s: string) => void }) => void;
  down: (pgm: { sql: (s: string) => void }) => void;
};
const { SEED } = require(resolve(REPO, "migrations/1789100000002_events-seed.js")) as {
  SEED: Array<Record<string, unknown> & { slug: string }>;
};
const { LEAFLET } = migration;
const seeded = SEED.find((e) => e.slug === LEAFLET.slug)!;
const LEAFLET_SRC = "/assets/img/empowher-2026-leaflet.webp";

const quoted = (value: string | null) => (value === null ? "NULL" : `'${value.replace(/'/g, "''")}'`);

function sqlOf(run: (pgm: { sql: (s: string) => void }) => void): string {
  const statements: string[] = [];
  run({ sql: (s) => statements.push(s) });
  return statements.join("\n");
}

// TASK-472: Jaimie took the leaflet off the card in the admin, and the file has left the site. A
// later migration takes it off every other database too, so no card points at a missing file.
const off = require(resolve(REPO, "migrations/1790900000000_events-empowher-leaflet-off.js")) as {
  LEAFLET_OFF: { slug: string; src: string; picture: Swap[] };
  up: (pgm: { sql: (s: string) => void }) => void;
  down: (pgm: { sql: (s: string) => void }) => void;
};

describe("the leaflet, taken off again (TASK-472)", () => {
  it("is gone from the site, and was at an address the admin itself would accept", () => {
    expect(off.LEAFLET_OFF.src).toBe(LEAFLET_SRC);
    expect(isSafeImageSrc(LEAFLET_SRC)).toBe(true);
    expect(existsSync(resolve(REPO, LEAFLET_SRC.slice(1)))).toBe(false);
  });

  it("comes off only where it is still exactly the leaflet, back to the event's own settings", () => {
    const up = sqlOf(off.up);
    expect(up).toContain(`WHERE slug = 'empowher-2026' AND image_src = '${LEAFLET_SRC}'`);
    for (const p of off.LEAFLET_OFF.picture) {
      expect(up).toContain(`${p.column} = ${quoted(p.to as string | null)}`);
      // Back to exactly what the first migration replaced.
      const before = LEAFLET.picture.find((q) => q.field === p.field)!;
      expect(p.to).toBe(before.from);
      expect(p.from).toBe(before.to);
    }
  });

  it("leaves the words, updated_by and every table alone, and has nothing to put back", () => {
    const up = sqlOf(off.up);
    for (const w of LEAFLET.words) expect(up).not.toContain(w.column + " =");
    expect(up).not.toMatch(/updated_by/);
    expect(up).not.toMatch(/\b(alter|drop|create|insert|delete)\b/i);
    expect(sqlOf(off.down)).toBe("");
  });
});

describe("the change, field by field", () => {
  it("is for EmpowHer, and starts every word from exactly what the seed put there", () => {
    expect(LEAFLET.slug).toBe("empowher-2026");
    // If these drifted apart the swap would match nothing on production and quietly do nothing.
    for (const w of [...LEAFLET.words, ...LEAFLET.picture]) expect(seeded[w.field], w.field).toBe(w.from);
  });

  it("leaves the event able to stay live, passing every rule the admin applies", () => {
    const after: Record<string, unknown> = { ...seeded };
    for (const s of [...LEAFLET.picture, ...LEAFLET.words]) after[s.field] = s.to;
    const parsed = eventInputSchema.parse(after);
    expect(parsed.status).toBe("live");
    expect(publishProblems(parsed)).toEqual([]);
  });

  it("puts the picture on only where there is none, all three settings together", () => {
    const up = sqlOf(migration.up);
    for (const p of LEAFLET.picture) {
      expect(up).toContain(`${p.column} = CASE WHEN image_src IS NULL THEN ${quoted(p.to)} ELSE ${p.column} END`);
    }
  });

  it("changes a word only while it is still the seed's, so an edit made in the admin stands", () => {
    const up = sqlOf(migration.up);
    for (const w of LEAFLET.words) {
      expect(up).toContain(`${w.column} = CASE WHEN ${w.column} = ${quoted(w.from)} THEN ${quoted(w.to)} ELSE ${w.column} END`);
    }
  });

  it("touches only EmpowHer, and only when there is something to change", () => {
    const up = sqlOf(migration.up);
    expect(up).toMatch(/^\s*UPDATE events SET/);
    expect(up).toContain(`WHERE slug = 'empowher-2026' AND (image_src IS NULL OR address = ${quoted(LEAFLET.words[0].from)}`);
  });

  // updated_by stays whatever it was: the seed's down removes only rows no person has touched, and a
  // system change must never make a row staff edited look untouched.
  it("never claims a row for the system, and changes no table", () => {
    const up = sqlOf(migration.up);
    expect(up).not.toMatch(/updated_by/);
    expect(up).not.toMatch(/\b(alter|drop|create|insert|delete)\b/i);
  });

  it("undoes only what it did", () => {
    const down = sqlOf(migration.down);
    for (const p of LEAFLET.picture) {
      expect(down).toContain(`${p.column} = CASE WHEN image_src = '${LEAFLET_SRC}' THEN ${quoted(p.from)} ELSE ${p.column} END`);
    }
    for (const w of LEAFLET.words) {
      expect(down).toContain(`${w.column} = CASE WHEN ${w.column} = ${quoted(w.to)} THEN ${quoted(w.from)} ELSE ${w.column} END`);
    }
    expect(down).not.toMatch(/updated_by/);
  });
});

describe("the card, as production will show it", () => {
  const card = () => {
    const t = document.createElement("template");
    t.innerHTML = renderCard(SEED_EVENTS.find((e) => e.slug === "empowher-2026")!);
    return t.content;
  };

  it("has no picture, as Jaimie chose, and makes its own cover from the name", () => {
    const art = card().querySelector(".ev-front .ev-art")!;
    expect(art.classList.contains("ev-art--type")).toBe(true);
    expect(card().querySelector(".ev-front img")).toBeNull();
    expect(card().querySelector(`[src="${LEAFLET_SRC}"]`)).toBeNull();
  });

  it("names Ali Wright as the host the way the leaflet does, and AD Autocare as the organiser", () => {
    const f = card();
    expect(f.querySelector(".ev-front .ev-host")?.textContent).toBe("Organised by AD Autocare");
    const list = [...f.querySelectorAll(".ev-back .ev-list li")].map((li) => li.innerHTML);
    expect(list[0]).toBe("<b>Ali Wright</b> from Now Radio’s Ali and Michael in the Morning, your host for the evening");
    expect(list[1]).toBe("<b>Car care workshops</b> with Andrew Dodds and his team: change a tyre, check your oil");
  });

  it("gives the street on the back", () => {
    const where = card().querySelectorAll(".ev-back .ev-facts li")[1];
    expect(where.textContent).toBe("Where: AD Autocare, Wallacetown Drive, Heathfield, Ayr");
  });
});
