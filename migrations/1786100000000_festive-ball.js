/* eslint-disable camelcase */

// TASK-313: Festive Ball 2026 ticketing (7 Nov 2026, The Park Hotel, Kilmarnock).
//
// Three tables, all NEW — nothing existing is touched, so this is additive-only under the
// expand-contract rule and a code-level rollback stays safe.
//
//   ball_settings     — one row, the knobs staff control: capacity, held-back seats, the
//                       password gate, and when sales open and close.
//   ball_bookings     — one row per purchase. Money in integer pence, matching the
//                       donations columns; no floats reach the database.
//   ball_reservations — short-lived seat holds during checkout, so two people cannot buy
//                       the last table at once. Rows expire logically via expires_at, so a
//                       stale row never affects availability even before it is swept.

exports.up = (pgm) => {
  pgm.createTable("ball_settings", {
    id: { type: "integer", primaryKey: true, default: 1 },
    total_tables: { type: "integer", notNull: true, default: 40 },
    seats_per_table: { type: "integer", notNull: true, default: 10 },
    held_seats: {
      type: "integer",
      notNull: true,
      default: 0,
      comment: "Comps and sponsor guests. Never offered for sale.",
    },
    gate_open: {
      type: "boolean",
      notNull: true,
      default: false,
      comment:
        "FALSE = password-gated preview, and the home-page promotion is not rendered at all. " +
        "Staff flip this to launch. Defaults FALSE so the page can never go public by accident.",
    },
    gate_opens_at: {
      type: "timestamptz",
      comment: "Optional scheduled unlock, a safety net behind the manual toggle.",
    },
    sales_close_at: { type: "timestamptz" },
    sales_closed: { type: "boolean", notNull: true, default: false },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  // Exactly one settings row, ever.
  pgm.addConstraint("ball_settings", "ball_settings_singleton", { check: "id = 1" });
  pgm.sql("INSERT INTO ball_settings (id) VALUES (1) ON CONFLICT DO NOTHING");

  pgm.createTable("ball_bookings", {
    id: "id",
    reference: { type: "text", notNull: true, unique: true },
    kind: { type: "text", notNull: true },
    quantity: { type: "integer", notNull: true },
    seats: {
      type: "integer",
      notNull: true,
      comment: "Seats consumed: quantity, or quantity x seats_per_table for a whole table.",
    },
    buyer_name: { type: "text", notNull: true },
    buyer_email: { type: "text", notNull: true },
    tickets_pence: { type: "integer", notNull: true },
    donation_pence: { type: "integer", notNull: true, default: 0 },
    fee_cover_pence: { type: "integer", notNull: true, default: 0 },
    total_pence: { type: "integer", notNull: true },
    gift_aid: { type: "boolean", notNull: true, default: false },
    newsletter_opt_in: { type: "boolean", notNull: true, default: false },
    stripe_session_id: { type: "text", unique: true },
    status: { type: "text", notNull: true, default: "pending" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    paid_at: { type: "timestamptz" },
  });
  pgm.addConstraint("ball_bookings", "ball_bookings_kind_check", {
    check: "kind IN ('seat', 'table')",
  });
  pgm.addConstraint("ball_bookings", "ball_bookings_status_check", {
    check: "status IN ('pending', 'paid', 'refunded', 'cancelled')",
  });
  // The availability read filters on status, so index it.
  pgm.createIndex("ball_bookings", "status");

  pgm.createTable("ball_reservations", {
    id: "id",
    token: { type: "text", notNull: true, unique: true },
    kind: { type: "text", notNull: true },
    quantity: { type: "integer", notNull: true },
    seats: { type: "integer", notNull: true },
    expires_at: { type: "timestamptz", notNull: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.addConstraint("ball_reservations", "ball_reservations_kind_check", {
    check: "kind IN ('seat', 'table')",
  });
  pgm.createIndex("ball_reservations", "expires_at");
};

exports.down = (pgm) => {
  pgm.dropTable("ball_reservations");
  pgm.dropTable("ball_bookings");
  pgm.dropTable("ball_settings");
};
