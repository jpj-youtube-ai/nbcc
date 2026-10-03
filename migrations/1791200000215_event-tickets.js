/* eslint-disable camelcase */

// Event tickets (Jaimie, points 23 and 24). An organiser holding an event can ask NBCC to sell the
// tickets for them, when all of the ticket money comes to NBCC. Staff approve the ticket types (every
// public thing waits for staff); buyers pay through Stripe Checkout; the webhook confirms the order
// and the buyer is emailed their tickets. Organisers can only ask for a refund; admins make it.
// Ticket money is never a gift: no Gift Aid, never in the donations table. src/tickets/ has the rules.
//
// fundraisers.booking        a fourth answer, 'nbcc': "NBCC sells the tickets for me".
//
// event_ticket_settings      one row per ticketed event: the overall sales limit staff set (null:
//                            no overall limit), the one the organiser proposed and is waiting for
//                            staff, and when staff closed sales by hand. Its row is what a checkout
//                            locks, so two buyers can never both take the last place.
// event_ticket_types         Adult, Child, Table of 8: a name, a price (whole pence: £0 for a free
//                            ticket that still needs booking, or £1 to £500) and
//                            an optional number on sale. Proposed by the organiser (or staff), live
//                            once approved, withdrawn when declined or taken off sale. Never deleted
//                            once on sale: orders name them.
// event_ticket_orders        one per checkout. The buyer's name, email and phone; the money (tickets,
//                            the card fee they chose to cover, the total, what has been refunded);
//                            Stripe's session, payment intent and charge. A pending order holds its
//                            places until hold_expires_at (an hour: Stripe closes the checkout at 31
//                            minutes, and its expired event releases them sooner).
// event_ticket_order_lines   what an order bought: the type, its name and price as sold, how many,
//                            and how many of those have since been refunded (back on sale).
// event_ticket_refund_requests  a refund an organiser asked for, and what staff did about it (one
//                            open request a booking).
// event_ticket_refunds       every refund: written down 'pending' with its own idempotency key BEFORE
//                            Stripe is asked, then 'done' (with Stripe's refund id) or 'failed', so a
//                            timed out refund is finished, never paid twice.
//
// An order also keeps what staff are told about it (flags: paid late, a wrong amount, a dispute), a
// hash of the buyer's address (to cap open checkouts), and when its phone number was deleted (90
// days after the event). An order stops its event being deleted (ON DELETE RESTRICT): a record of
// money never goes with it.
//
// Additive only: new tables, and a check widened to take one more answer, so a code rollback is
// safe (golden rule 2). Numbered 1791200000215, after 1791200000210, built alongside it.

exports.shorthands = undefined;

const OLD = ["away", "door", "free", "donations"];
const NEW = [...OLD, "nbcc"];
const quoted = (list) => list.map((v) => `'${v}'`).join(", ");

const fundraiser = { type: "integer", notNull: true, references: "fundraisers", onDelete: "CASCADE" };
// A record of money must never go with its event: an order (and a refund request) stops the delete.
const fundraiserKept = { type: "integer", notNull: true, references: "fundraisers", onDelete: "RESTRICT" };
const now = (pgm) => ({ type: "timestamptz", notNull: true, default: pgm.func("now()") });

exports.up = (pgm) => {
  pgm.sql("ALTER TABLE fundraisers DROP CONSTRAINT IF EXISTS fundraisers_booking_check");
  pgm.sql(`ALTER TABLE fundraisers ADD CONSTRAINT fundraisers_booking_check CHECK (booking IS NULL OR booking IN (${quoted(NEW)}))`);

  pgm.createTable("event_ticket_settings", {
    fundraiser_id: { ...fundraiser, primaryKey: true },
    sales_limit: { type: "integer" },
    proposed_sales_limit: { type: "integer" },
    proposed_at: { type: "timestamptz" },
    sales_closed_at: { type: "timestamptz" },
    sales_closed_by: { type: "text" },
    // When sales close, as the host chose and staff approved: when the event starts (also null, for
    // anything from before it was asked), midnight the day before, or a moment they chose. And the
    // host's proposal still waiting for staff.
    sales_close_mode: { type: "text" },
    sales_close_at: { type: "timestamptz" },
    proposed_close_mode: { type: "text" },
    proposed_close_at: { type: "timestamptz" },
    updated_at: now(pgm),
    updated_by: { type: "text" },
  });
  pgm.addConstraint("event_ticket_settings", "event_ticket_settings_limit_range", {
    check: "(sales_limit IS NULL OR (sales_limit >= 1 AND sales_limit <= 5000)) AND (proposed_sales_limit IS NULL OR (proposed_sales_limit >= 1 AND proposed_sales_limit <= 5000))",
  });

  pgm.addConstraint("event_ticket_settings", "event_ticket_settings_close_known", {
    check:
      "(sales_close_mode IS NULL OR sales_close_mode IN ('start', 'day_before', 'custom')) AND (proposed_close_mode IS NULL OR proposed_close_mode IN ('start', 'day_before', 'custom'))",
  });

  pgm.createTable("event_ticket_types", {
    id: "id",
    fundraiser_id: fundraiser,
    name: { type: "text", notNull: true },
    price_pence: { type: "integer", notNull: true },
    quantity: { type: "integer" },
    sort_order: { type: "integer", notNull: true, default: 0 },
    status: { type: "text", notNull: true, default: "proposed" },
    proposed_by: { type: "text", notNull: true },
    proposed_at: now(pgm),
    approved_at: { type: "timestamptz" },
    approved_by: { type: "text" },
    withdrawn_at: { type: "timestamptz" },
    withdrawn_by: { type: "text" },
  });
  pgm.addConstraint("event_ticket_types", "event_ticket_types_name_length", {
    check: "char_length(btrim(name)) >= 1 AND char_length(name) <= 60",
  });
  pgm.addConstraint("event_ticket_types", "event_ticket_types_price_range", {
    // Free (£0, for a ticket that still needs booking), or from £1 to £500.
    check: "price_pence = 0 OR (price_pence >= 100 AND price_pence <= 50000)",
  });
  pgm.addConstraint("event_ticket_types", "event_ticket_types_quantity_range", {
    check: "quantity IS NULL OR (quantity >= 1 AND quantity <= 5000)",
  });
  pgm.addConstraint("event_ticket_types", "event_ticket_types_status_known", {
    check: "status IN ('proposed', 'approved', 'withdrawn')",
  });
  pgm.createIndex("event_ticket_types", "fundraiser_id");

  pgm.createTable("event_ticket_orders", {
    id: "id",
    reference: { type: "text", notNull: true, unique: true },
    fundraiser_id: fundraiserKept,
    status: { type: "text", notNull: true, default: "pending" },
    buyer_first_name: { type: "text", notNull: true },
    buyer_surname: { type: "text", notNull: true },
    buyer_email: { type: "text", notNull: true },
    buyer_phone: { type: "text" },
    tickets_pence: { type: "integer", notNull: true },
    fee_cover_pence: { type: "integer", notNull: true, default: 0 },
    total_pence: { type: "integer", notNull: true },
    refunded_pence: { type: "integer", notNull: true, default: 0 },
    stripe_session_id: { type: "text", unique: true },
    stripe_payment_intent_id: { type: "text" },
    hold_expires_at: { type: "timestamptz", notNull: true },
    paid_at: { type: "timestamptz" },
    confirmation_sent_at: { type: "timestamptz" },
    confirmation_claimed_at: { type: "timestamptz" },
    confirmation_attempts: { type: "integer", notNull: true, default: 0 },
    // A refund email to the buyer that did not go: how much it was to say, and how often it was tried.
    refund_email_unsent_pence: { type: "integer" },
    refund_email_attempts: { type: "integer", notNull: true, default: 0 },
    flags: { type: "jsonb", notNull: true, default: pgm.func("'{}'::jsonb") },
    disputed_at: { type: "timestamptz" },
    ip_hash: { type: "text" },
    phone_deleted_at: { type: "timestamptz" },
    created_at: now(pgm),
  });
  pgm.addConstraint("event_ticket_orders", "event_ticket_orders_status_known", {
    check: "status IN ('pending', 'paid', 'expired', 'cancelled')",
  });
  pgm.addConstraint("event_ticket_orders", "event_ticket_orders_money", {
    check: "tickets_pence >= 0 AND fee_cover_pence >= 0 AND total_pence = tickets_pence + fee_cover_pence",
  });
  pgm.addConstraint("event_ticket_orders", "event_ticket_orders_refund_range", {
    check: "refunded_pence >= 0 AND refunded_pence <= total_pence",
  });
  pgm.createIndex("event_ticket_orders", "fundraiser_id");
  pgm.createIndex("event_ticket_orders", "stripe_payment_intent_id");

  pgm.createTable("event_ticket_order_lines", {
    id: "id",
    order_id: { type: "integer", notNull: true, references: "event_ticket_orders", onDelete: "CASCADE" },
    ticket_type_id: { type: "integer", notNull: true, references: "event_ticket_types", onDelete: "RESTRICT" },
    type_name: { type: "text", notNull: true },
    unit_pence: { type: "integer", notNull: true },
    quantity: { type: "integer", notNull: true },
    refunded_quantity: { type: "integer", notNull: true, default: 0 },
  });
  pgm.addConstraint("event_ticket_order_lines", "event_ticket_order_lines_quantity", {
    check: "quantity >= 1 AND quantity <= 20 AND refunded_quantity >= 0 AND refunded_quantity <= quantity",
  });
  pgm.createIndex("event_ticket_order_lines", "order_id");
  pgm.createIndex("event_ticket_order_lines", "ticket_type_id");

  pgm.createTable("event_ticket_refund_requests", {
    id: "id",
    order_id: { type: "integer", notNull: true, references: "event_ticket_orders", onDelete: "CASCADE" },
    fundraiser_id: fundraiserKept,
    reason: { type: "text", notNull: true },
    requested_by: { type: "text", notNull: true },
    requested_at: now(pgm),
    status: { type: "text", notNull: true, default: "open" },
    dealt_at: { type: "timestamptz" },
    dealt_by: { type: "text" },
    dealt_note: { type: "text" },
  });
  pgm.addConstraint("event_ticket_refund_requests", "event_ticket_refund_requests_status_known", {
    check: "status IN ('open', 'refunded', 'declined')",
  });
  pgm.addConstraint("event_ticket_refund_requests", "event_ticket_refund_requests_reason_length", {
    check: "char_length(btrim(reason)) >= 1 AND char_length(reason) <= 500",
  });
  pgm.createIndex("event_ticket_refund_requests", "fundraiser_id");
  // One open request a booking: a second ask while one is waiting is refused by the database too.
  pgm.createIndex("event_ticket_refund_requests", "order_id", { name: "event_ticket_refund_requests_one_open", unique: true, where: "status = 'open'" });

  pgm.createTable("event_ticket_refunds", {
    id: "id",
    order_id: { type: "integer", notNull: true, references: "event_ticket_orders", onDelete: "CASCADE" },
    amount_pence: { type: "integer", notNull: true },
    lines: { type: "jsonb", notNull: true, default: pgm.func("'[]'::jsonb") },
    status: { type: "text", notNull: true, default: "pending" },
    idempotency_key: { type: "text", notNull: true, unique: true },
    stripe_refund_id: { type: "text", unique: true },
    request_id: { type: "integer", references: "event_ticket_refund_requests", onDelete: "SET NULL" },
    completed_at: { type: "timestamptz" },
    note: { type: "text" },
    refunded_by: { type: "text", notNull: true },
    created_at: now(pgm),
  });
  pgm.addConstraint("event_ticket_refunds", "event_ticket_refunds_amount", { check: "amount_pence >= 1" });
  pgm.addConstraint("event_ticket_refunds", "event_ticket_refunds_status_known", { check: "status IN ('pending', 'done', 'failed')" });
  pgm.createIndex("event_ticket_refunds", "order_id");
};

exports.down = (pgm) => {
  pgm.dropTable("event_ticket_refunds");
  pgm.dropTable("event_ticket_refund_requests");
  pgm.dropTable("event_ticket_order_lines");
  pgm.dropTable("event_ticket_orders");
  pgm.dropTable("event_ticket_types");
  pgm.dropTable("event_ticket_settings");
  pgm.sql("ALTER TABLE fundraisers DROP CONSTRAINT IF EXISTS fundraisers_booking_check");
  // NOT VALID: an event that chose 'nbcc' in the meantime does not block the way back.
  pgm.sql(`ALTER TABLE fundraisers ADD CONSTRAINT fundraisers_booking_check CHECK (booking IS NULL OR booking IN (${quoted(OLD)})) NOT VALID`);
};
