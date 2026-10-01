/* eslint-disable camelcase */

// TASK-491: a reminder to phone each business that gives monthly, every three months
// (docs/superpowers/specs/2026-10-02-business-call-reminders-design.md).
//
// Additive only (golden rule 2):
//   business_supporter_fulfilment.phone   nullable; the number to call them on. The admin checks
//                                         it (digits, spaces, + ( ) -, up to 40 characters).
//   business_supporter_calls              one row per call made: when, who by, and an optional note.
//                                         Cleared with the supporter record it belongs to.
//
// And a one off copy: a business that came to us through Contact businesses often has its number
// there already (business_outreach.contact_phone, linked by business_outreach.donor_id). Copy it
// into an EMPTY phone only, and only when it would pass the admin's own check, so nothing is
// overwritten and nothing malformed arrives. Each copy is logged, so the supporter's History says
// where the number came from. The SQL is exported so features/business-calls.feature can run it
// against Postgres inside a transaction it rolls back.
//
// Numbered above 1791000000003, the highest on main.

const BACKFILL_PHONE_SQL = `
  WITH source AS (
    SELECT DISTINCT ON (o.donor_id) o.donor_id, btrim(o.contact_phone) AS phone
      FROM business_outreach o
     WHERE o.donor_id IS NOT NULL
       AND o.contact_phone IS NOT NULL
       AND btrim(o.contact_phone) ~ '^[0-9 +()-]+$'
       AND char_length(btrim(o.contact_phone)) <= 40
       AND char_length(regexp_replace(o.contact_phone, '[^0-9]', '', 'g')) >= 7
     ORDER BY o.donor_id, o.created_at DESC, o.id DESC
  ),
  filled AS (
    UPDATE business_supporter_fulfilment f
       SET phone = s.phone, updated_at = now()
      FROM source s
     WHERE s.donor_id = f.donor_id
       AND f.phone IS NULL
    RETURNING f.id, f.phone
  )
  INSERT INTO audit_log (actor, action, entity, entity_id, data)
  SELECT 'migration:TASK-491', 'fulfilment.phone', 'business_supporter_fulfilment', id,
         jsonb_build_object('phone', phone, 'source', 'outreach')
    FROM filled
`;

exports.BACKFILL_PHONE_SQL = BACKFILL_PHONE_SQL;

exports.up = (pgm) => {
  pgm.addColumns("business_supporter_fulfilment", {
    phone: { type: "text" },
  });

  pgm.createTable(
    "business_supporter_calls",
    {
      id: "id",
      fulfilment_id: {
        type: "integer",
        notNull: true,
        references: "business_supporter_fulfilment",
        onDelete: "CASCADE",
      },
      called_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
      called_by: { type: "text" },
      note: { type: "text" },
    },
    {
      constraints: {
        check: "note IS NULL OR char_length(note) <= 500",
      },
    },
  );
  pgm.createIndex("business_supporter_calls", ["fulfilment_id", { name: "called_at", sort: "DESC" }]);

  pgm.sql(BACKFILL_PHONE_SQL);
};

exports.down = (pgm) => {
  pgm.dropTable("business_supporter_calls");
  pgm.dropColumns("business_supporter_fulfilment", ["phone"]);
};
