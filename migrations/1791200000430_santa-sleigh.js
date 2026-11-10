/* eslint-disable camelcase */

// The Kilmarnock Santa Sleigh (docs/superpowers/specs/2026-11-10-santa-sleigh-design.md).
//
//   1. sleigh_nights: one row per night the sleigh goes out: its UK date, the areas it goes round,
//      its start and finish times once known (empty means "Timings TBC"), and the bucket cash staff
//      count for that night. Card machine taps are tagged donations.source = 'santa_sleigh' when
//      they fall inside a night's window (src/db/sleigh.ts); nothing here holds them.
//   2. sleigh_settings: one row: the first day counted in the year's total, and the day the page
//      switches off and forwards to the home page.
//
// Seeded with the seven 2026 nights from the poster, "Kilmarnock Santa Sleigh 2026". Both tables are
// new (additive only, golden rule 2); nothing existing changes shape.

const NIGHTS_2026 = [
  ["2026-12-15", "New Farm"],
  ["2026-12-16", "Wardneuk, Onthank & Altonhill"],
  ["2026-12-17", "Bellfield & Shortlees"],
  ["2026-12-18", "Fardalehill, Margaret Parker, Whisky"],
  ["2026-12-20", "Southcraig & surrounding"],
  ["2026-12-21", "Gargieston & Moorfield"],
  ["2026-12-22", "Caprington & Grange"],
];

exports.up = (pgm) => {
  pgm.createTable(
    "sleigh_nights",
    {
      id: "id",
      night_on: { type: "date", notNull: true, unique: true, comment: "The night, as a UK date." },
      areas: { type: "text", notNull: true, comment: "The areas the sleigh goes round that night." },
      starts_at: { type: "time", comment: "UK time it sets off; empty until known (Timings TBC)." },
      ends_at: { type: "time", comment: "UK time it finishes; empty until known (Timings TBC)." },
      bucket_pence: {
        type: "integer",
        notNull: true,
        default: 0,
        check: "bucket_pence >= 0",
        comment: "Bucket cash counted for the night, typed in by staff. Never in donation figures.",
      },
      updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    },
    { comment: "Kilmarnock Santa Sleigh nights: date, areas, times and bucket cash." },
  );

  pgm.createTable(
    "sleigh_settings",
    {
      id: { type: "integer", primaryKey: true, check: "id = 1", comment: "Only ever one row." },
      season_from: { type: "date", notNull: true, default: "2026-11-01", comment: "The first UK day counted in the year's total." },
      off_on: { type: "date", notNull: true, default: "2027-01-31", comment: "From this UK day the page forwards to the home page." },
      updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    },
    { comment: "Kilmarnock Santa Sleigh settings: one row." },
  );

  const values = NIGHTS_2026.map(([on, areas]) => `('${on}', '${areas.replace(/'/g, "''")}')`).join(",\n    ");
  pgm.sql(`INSERT INTO sleigh_nights (night_on, areas) VALUES
    ${values}
  ON CONFLICT (night_on) DO NOTHING`);
  pgm.sql(`INSERT INTO sleigh_settings (id) VALUES (1) ON CONFLICT DO NOTHING`);
};

exports.down = (pgm) => {
  pgm.dropTable("sleigh_settings", { ifExists: true });
  pgm.dropTable("sleigh_nights", { ifExists: true });
};
