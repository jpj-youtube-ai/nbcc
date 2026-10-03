/* eslint-disable camelcase */

// Jaimie 2026-10-03: the Festive Ball booking form asks for the booker's phone number, required, so
// NBCC can contact them about menu choices for their table. It is NBCC's only: never sent to Stripe,
// the venue or the organiser.
//
// Additive only (golden rule 2): one nullable column with a named length check (40, the form's and
// the admin's limit). Bookings made before have no number, and staff add it in the admin. The code
// before this, still running while the deploy rolls out, inserts without the column, which a
// nullable column takes. Numbered to sort after the migrations merged before it (1791200000195,
// 1791200000197) and before the ones still to merge (1791200000200, 1791200000205).

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE ball_bookings
      ADD COLUMN IF NOT EXISTS buyer_phone text
  `);
  pgm.sql(`
    ALTER TABLE ball_bookings
      ADD CONSTRAINT ball_bookings_buyer_phone_length CHECK (buyer_phone IS NULL OR char_length(buyer_phone) <= 40)
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE ball_bookings
      DROP COLUMN IF EXISTS buyer_phone
  `);
};
