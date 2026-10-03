/* eslint-disable camelcase */

// What gifts could do (Jaimie, 2026-10-03): one shared list of examples, like "£25 could help buy a
// pair of school shoes".
//
//   impact_examples   an amount, the words (always "could", never "will buy" or "will pay for", so a
//                     gift never becomes a restricted fund), on or off, the list's order, whether it
//                     shows under the give amounts (the £40 uniform is for big totals only), and
//                     which line under the meter counts with it (red_bags, uniforms: set here, not by
//                     staff). Staff add, edit, switch off and reorder them in Admin > Fundraising.
//                     Fundraiser, event and team pages show them; a Fill a Red Bag page will too.
//
// Seeded with the five Jaimie approved, matching src/impact/examples.ts (STARTING_EXAMPLES, checked
// by test/unit/impact-examples-migration.test.ts), only into an empty table.
//
// Additive (golden rule 2): one new table, nothing else changed. Numbered 1791200000200 to sort after
// the in memory pages (195), wording approvals (197) and ball phone (198) migrations, which merge first.

exports.shorthands = undefined;

/** The list, as src/impact/examples.ts has it (STARTING_EXAMPLES). */
const SEED = [
  { amountPence: 500, wording: "could help put a cosy pair of pyjamas in a Red Bag", active: true, sortOrder: 10, onGiveForm: true, meterLine: null },
  { amountPence: 1000, wording: "could help put pyjamas, socks, a hat and gloves in a Red Bag", active: true, sortOrder: 20, onGiveForm: true, meterLine: null },
  { amountPence: 2500, wording: "could help buy a pair of school shoes", active: true, sortOrder: 30, onGiveForm: true, meterLine: null },
  { amountPence: 5000, wording: "could help fill a whole Red Bag Full of Joy", active: true, sortOrder: 40, onGiveForm: true, meterLine: "red_bags" },
  { amountPence: 4000, wording: "could help a child start school in a uniform that fits", active: true, sortOrder: 50, onGiveForm: false, meterLine: "uniforms" },
];
exports.SEED = SEED;

const quote = (s) => (s === null ? "NULL" : `'${String(s).replace(/'/g, "''")}'`);

exports.up = (pgm) => {
  pgm.createTable(
    "impact_examples",
    {
      id: "id",
      amount_pence: { type: "integer", notNull: true, check: "amount_pence BETWEEN 100 AND 1000000" },
      // The server checks the words first, with a kinder message; this holds them whatever writes.
      wording: {
        type: "text",
        notNull: true,
        // Starts "could"; never a promise (the same list as src/impact/examples.ts PROMISES).
        check:
          "char_length(wording) BETWEEN 1 AND 200 AND wording ~* '^could\\M'" +
          " AND wording !~* '\\m(will\\s+(buy|pay\\s+for|cover|fund|provide)|pays\\s+for|buys)\\M'",
      },
      active: { type: "boolean", notNull: true, default: true },
      sort_order: { type: "integer", notNull: true, default: 0 },
      on_give_form: { type: "boolean", notNull: true, default: true },
      meter_line: { type: "text", unique: true, check: "meter_line IN ('red_bags', 'uniforms')" },
      created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
      created_by: { type: "text" },
      updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
      updated_by: { type: "text" },
    },
    { comment: "What gifts could do: amount + could wording, shown on fundraiser, event and team pages. Staff edit them in Admin > Fundraising." },
  );

  const rows = SEED.map(
    (e) => `(${e.amountPence}, ${quote(e.wording)}, ${e.active}, ${e.sortOrder}, ${e.onGiveForm}, ${quote(e.meterLine)}, 'migration', 'migration')`,
  ).join(",\n      ");
  pgm.sql(`INSERT INTO impact_examples (amount_pence, wording, active, sort_order, on_give_form, meter_line, created_by, updated_by)
    SELECT * FROM (VALUES
      ${rows}
    ) AS seed (amount_pence, wording, active, sort_order, on_give_form, meter_line, created_by, updated_by)
    WHERE NOT EXISTS (SELECT 1 FROM impact_examples)`);
};

exports.down = (pgm) => {
  pgm.dropTable("impact_examples");
};
