/* eslint-disable camelcase */

// Fill a Red Bag: a company's own Workshop (Jaimie, 5 and 6 November 2026). Staff make a link for a
// company (nbcc.scot/fill/ge-aviation) in Admin > Fill a Red Bag; everyone who gives through it puts
// bags on THAT company's shelves, and the night look's Workshop shows only theirs. Two things, both
// additive.
//
// 1. A NEW TABLE, red_bag_workshops. One row a company:
//
//      slug         its link, after /fill/: small letters, numbers and single hyphens. Unique for
//                   ever, archived or not, so a printed QR code can never come to mean someone else.
//      name         what the Workshop's sign says, as staff typed it.
//      size         'small' | 'medium' | 'large': roughly how many people will see the link (about 20,
//                   100 or 500). Private, never shown: it only paces the Workshop's stages
//                   (src/red-bag/workshop.ts, LADDERS).
//      archived_at  set when staff put it away: its link stops working, its gifts still count.
//
//    No row is seeded: with none, /fill is exactly as it was.
//
// 2. donations.red_bag_workshop_id: which company's Workshop a Fill a Red Bag gift was given through.
//    Null for every other gift and for every gift before this. Nothing fills it in here, and the
//    donation's own INSERT does not name it: the Stripe webhook writes it in the same separate,
//    after-commit, fill-only-if-empty statement that writes donations.source (tagDonationSource,
//    src/db/stripe-webhook.ts). ON DELETE SET NULL, so a workshop could never block a donation.
//    The index holds only the rows that have one.
//
// Additive only (golden rule 2): a new table, and a nullable column with no default (a change to the
// table's description, no rewrite of the rows), so a code rollback is safe: old code neither reads
// nor writes either. The access section is the existing "red-bag" one, so there is nothing to backfill.
// Numbered 1791200000390: after the 370 of the donations work (TASK-594), with room between.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable("red_bag_workshops", {
    id: "id",
    slug: { type: "text", notNull: true, unique: true, check: "slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) <= 60" },
    name: { type: "text", notNull: true, check: "length(btrim(name)) BETWEEN 1 AND 80" },
    size: { type: "text", notNull: true, default: "medium", check: "size IN ('small', 'medium', 'large')" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    created_by: { type: "text" },
    archived_at: { type: "timestamptz" },
  });
  pgm.addColumns("donations", {
    red_bag_workshop_id: {
      type: "integer",
      references: "red_bag_workshops",
      onDelete: "SET NULL",
      comment: "The company Workshop (red_bag_workshops) a Fill a Red Bag gift was given through. Null otherwise.",
    },
  });
  pgm.createIndex("donations", "red_bag_workshop_id", { name: "donations_red_bag_workshop", where: "red_bag_workshop_id IS NOT NULL" });
};

exports.down = (pgm) => {
  pgm.dropIndex("donations", "red_bag_workshop_id", { name: "donations_red_bag_workshop" });
  pgm.dropColumns("donations", ["red_bag_workshop_id"]);
  pgm.dropTable("red_bag_workshops");
};
