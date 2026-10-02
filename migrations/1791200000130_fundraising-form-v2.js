/* eslint-disable camelcase */

// TASK-511: the fundraising sign up form, round two, and short page links.
//
//   fundraisers.first_name, last_name   the organiser's name in two boxes. organiser_name is still
//                                       filled ("first last") for everything that reads it; a sign
//                                       up from before has these empty and keeps its single name.
//   fundraisers.kind_other              what "Something else" is, in their words (up to 80).
//   fundraisers.instagram, facebook     their Instagram and Facebook, each tidied to a full link
//                                       (https://www.instagram.com/name). social_link stays, for the
//                                       sign ups from before, and is still filled for anything that
//                                       reads it.
//
//   fundraiser_slug_history             every address a fundraiser's page used to have. When staff
//                                       change a page's address, the old one keeps working with a
//                                       301 to the new one, so a QR code printed with it never
//                                       breaks; and no other fundraiser may ever take it.
//
//   fundraiser_requests kind check      WIDENED to take 'qr_codes' (printed QR codes, To send then
//                                       Sent, like posters). Every kind allowed before still is.
//
// Printed QR codes as a request need no column: a new key in the existing wants jsonb (qrCount).
//
// Additive only (golden rule 2): nullable columns, a new table, and a check that only widens; code
// from before this release reads and writes everything as it did, so a code rollback is safe.
// Numbered 1791200000130: above 1791200000100 (the highest on main) and the two open fundraising
// PRs' 110 and 120, so it sorts last whichever lands first.

exports.shorthands = undefined;

const OLD_KINDS = ["posters", "leaflets", "leaflets_or_posters", "buckets", "tins", "buckets_or_tins", "shout_out", "attend"];
const NEW_KINDS = [...OLD_KINDS, "qr_codes"];
const kindCheck = (kinds) => `kind IN (${kinds.map((k) => `'${k}'`).join(", ")})`;

// The kind check was declared on the column in 1791200000080, so Postgres named it
// fundraiser_requests_kind_check (table, column, "check"). It is dropped by that name, and then
// (in case it was ever named otherwise) any other check that lists the kinds, found by one of them:
// Postgres keeps "kind IN (...)" as "(kind = ANY (ARRAY['posters'::text, ...]))", so the words
// "kind IN" are never there (review fix: looking for them found nothing, and adding ours failed).
// The widened one is then added back under the same name.
const dropKindChecks = `
  ALTER TABLE fundraiser_requests DROP CONSTRAINT IF EXISTS fundraiser_requests_kind_check;
  DO $$
  DECLARE c text;
  BEGIN
    FOR c IN
      SELECT conname FROM pg_constraint
       WHERE conrelid = 'fundraiser_requests'::regclass AND contype = 'c'
         AND pg_get_constraintdef(oid) LIKE '%shout_out%'
    LOOP
      EXECUTE format('ALTER TABLE fundraiser_requests DROP CONSTRAINT %I', c);
    END LOOP;
  END $$;
`;

exports.up = (pgm) => {
  pgm.addColumns("fundraisers", {
    first_name: { type: "text" },
    last_name: { type: "text" },
    kind_other: { type: "text" },
    instagram: { type: "text" },
    facebook: { type: "text" },
  });

  pgm.createTable(
    "fundraiser_slug_history",
    {
      old_slug: { type: "text", primaryKey: true },
      fundraiser_id: { type: "integer", notNull: true, references: "fundraisers", onDelete: "CASCADE" },
      created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
      created_by: { type: "text" },
    },
    { comment: "Every address a fundraiser's page used to have: each still answers with a 301, and is never reused (TASK-511)." },
  );
  pgm.createIndex("fundraiser_slug_history", "fundraiser_id");

  pgm.sql(dropKindChecks);
  pgm.sql(`ALTER TABLE fundraiser_requests ADD CONSTRAINT fundraiser_requests_kind_check CHECK (${kindCheck(NEW_KINDS)})`);
};

// Back to the old list. NOT VALID, so QR code requests already made do not stop the rollback; new
// rows are held to the old list again. The columns and the table go; the old addresses then stop
// redirecting, which is what the code before this did.
exports.down = (pgm) => {
  pgm.sql(dropKindChecks);
  pgm.sql(`ALTER TABLE fundraiser_requests ADD CONSTRAINT fundraiser_requests_kind_check CHECK (${kindCheck(OLD_KINDS)}) NOT VALID`);
  pgm.dropTable("fundraiser_slug_history");
  pgm.dropColumns("fundraisers", ["first_name", "last_name", "kind_other", "instagram", "facebook"]);
};
