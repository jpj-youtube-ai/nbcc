/* eslint-disable camelcase */

// The sign up tidy (Jaimie and the form appropriateness audit, 2026-10-03). The public sign up form
// becomes step by step with Next and Back, asks everyone (bar in memory) an address for a welcome
// pack, and fits whoever is filling it in.
//
// fundraising_categories
//   sporty                   a sporting category (Run, Walk, Santa dash...). Someone raising money for
//                            a sporting event sees only these (and Other); anyone else sees the rest.
//                            Admins tick "Sporting" in Admin > Fundraising, Categories.
//   memory_only              a way of giving in memory of someone ("Donations instead of flowers"),
//                            offered only on the in memory path, and never on the others.
//   Seeded: Run, Walk and Santa dash sporting (matched by key or name, whatever the case, if they are
//   there), and the three in memory ways of giving (src/fundraising/categories.ts MEMORY_CATEGORIES).
//
// fundraisers
//   is_sporting              "Is it a sporting event?" Raising money only, never in memory. Null when
//                            not asked (and on every sign up before).
//   tshirt_size              their size for an NBCC T-shirt, for a sporting event (TSHIRT_SIZES)
//   tshirt_token_hash        staff may email them a private link to choose a size: only its sha256 is
//   tshirt_asked_at          kept, with when and by whom it was last sent. The link is used once.
//   tshirt_asked_by
//   child_first_name         raising money for their child: the child's first name (on the page), and
//   child_consent            the parent's or guardian's tick to show it and any photo
//   org_name                 for a business, school or group: its name (on the page), and whether the
//   employer_match           employer will match what is raised (yes, no or not_sure)
//   memory_director_business in memory, set up by a funeral director: the business, and the family's
//   memory_family_contact_name   contact, for the names of people who gave
//   memory_family_contact_email
//   call_time                a good time to call them
//   date_tbc                 they ticked "Not decided yet" beside the date (an event may then have none yet)
//   guardian_first_name      a team member page for someone under 18: their parent's or guardian's
//                            first name (with child_consent, their tick), greeted in its emails
//
//   fundraisers_memory_setup_by_known   WIDENED to take 'someone_else' (a colleague, club or church)
//   fundraisers_booking_check           WIDENED to take 'donations' (free entry, donations welcome)
//   fundraiser_requests kind check      WIDENED to take 'envelopes' (collection envelopes for a
//                                       funeral or service, To send then Sent, like posters)
//
// The address for the welcome pack needs no column: it is the four post_* boxes the form already had.
// Envelopes need none either: a new key in the wants jsonb (envelopeCount).
//
// Additive only (golden rule 2): nullable columns, columns with a constant default, new rows, and
// checks that only widen. ROLLING BACK the code past this release needs one step first, as code from
// before this does not know memory_only and would offer the in memory ways of giving on the ordinary
// form: run ROLLBACK_SQL (below, and in README.md), which takes them off the form.
//
// Numbered 1791200000210: after the profile pictures migration (205), so it sorts after every
// migration already run in production.

exports.shorthands = undefined;

const SPORTY_KEYS = ["run", "walk", "santa_dash"];
const SPORTY_LABELS = ["run", "walk", "santa dash"];

/** As src/fundraising/categories.ts MEMORY_CATEGORIES has them. */
const MEMORY_SEED = [
  { key: "memory_flowers", label: "Donations instead of flowers" },
  { key: "memory_service", label: "A collection at the funeral or service" },
  { key: "memory_event", label: "A memorial walk, run or event" },
];
exports.MEMORY_SEED = MEMORY_SEED;

const TSHIRT_SIZES = [
  "kids_3_4", "kids_5_6", "kids_7_8", "kids_9_10", "kids_11_12", "kids_13_14",
  "adult_xs", "adult_s", "adult_m", "adult_l", "adult_xl", "adult_xxl",
];
const EMPLOYER_MATCH = ["yes", "no", "not_sure"];
const OLD_SETUP_BY = ["family", "friend", "funeral_director"];
const NEW_SETUP_BY = [...OLD_SETUP_BY, "someone_else"];
const OLD_BOOKINGS = ["away", "door", "free"];
const NEW_BOOKINGS = [...OLD_BOOKINGS, "donations"];
const OLD_REQUEST_KINDS = ["posters", "leaflets", "leaflets_or_posters", "buckets", "tins", "buckets_or_tins", "shout_out", "attend", "qr_codes"];
const NEW_REQUEST_KINDS = [...OLD_REQUEST_KINDS, "envelopes"];

const FUNDRAISER_COLUMNS = [
  "is_sporting",
  "tshirt_size",
  "tshirt_token_hash",
  "tshirt_asked_at",
  "tshirt_asked_by",
  "child_first_name",
  "child_consent",
  "org_name",
  "employer_match",
  "memory_director_business",
  "memory_family_contact_name",
  "memory_family_contact_email",
  "call_time",
  "date_tbc",
  "guardian_first_name",
];

const quote = (s) => `'${String(s).replace(/'/g, "''")}'`;
const list = (xs) => xs.map(quote).join(", ");

/** Run by hand BEFORE rolling back code past this release: the in memory ways of giving come off the form. */
const ROLLBACK_SQL = "UPDATE fundraising_categories SET active = false, retired_at = COALESCE(retired_at, now()) WHERE memory_only;";
exports.ROLLBACK_SQL = ROLLBACK_SQL;

// The request kind check, by its name and then any other that lists the kinds (as 1791200000130).
const dropRequestKindChecks = `
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
  pgm.addColumns("fundraising_categories", {
    sporty: { type: "boolean", notNull: true, default: false },
    memory_only: { type: "boolean", notNull: true, default: false },
  });
  pgm.sql(`UPDATE fundraising_categories
     SET sporty = true
   WHERE lower(key) IN (${list(SPORTY_KEYS)}) OR lower(label) IN (${list(SPORTY_LABELS)})`);
  // One at a time, and only where neither its key nor its name (whatever the case: the names are
  // unique) is already there, so a category an admin added with the same name never stops the run.
  for (const c of MEMORY_SEED) {
    pgm.sql(`INSERT INTO fundraising_categories (key, label, active, sporty, memory_only, created_by)
    SELECT ${quote(c.key)}, ${quote(c.label)}, true, false, true, 'migration'
     WHERE NOT EXISTS (SELECT 1 FROM fundraising_categories WHERE lower(label) = lower(${quote(c.label)}))
  ON CONFLICT (key) DO NOTHING`);
  }

  pgm.addColumns("fundraisers", {
    is_sporting: { type: "boolean" },
    tshirt_size: { type: "text" },
    tshirt_token_hash: { type: "text" },
    tshirt_asked_at: { type: "timestamptz" },
    tshirt_asked_by: { type: "text" },
    child_first_name: { type: "text" },
    child_consent: { type: "boolean" },
    org_name: { type: "text" },
    employer_match: { type: "text" },
    memory_director_business: { type: "text" },
    memory_family_contact_name: { type: "text" },
    memory_family_contact_email: { type: "text" },
    call_time: { type: "text" },
    date_tbc: { type: "boolean" },
    guardian_first_name: { type: "text" },
  });
  pgm.addConstraint("fundraisers", "fundraisers_tshirt_size_known", {
    check: `tshirt_size IS NULL OR tshirt_size IN (${list(TSHIRT_SIZES)})`,
  });
  pgm.addConstraint("fundraisers", "fundraisers_employer_match_known", {
    check: `employer_match IS NULL OR employer_match IN (${list(EMPLOYER_MATCH)})`,
  });
  pgm.addConstraint("fundraisers", "fundraisers_signup_tidy_lengths", {
    check:
      "(child_first_name IS NULL OR char_length(child_first_name) <= 50) AND (org_name IS NULL OR char_length(org_name) <= 100)" +
      " AND (memory_director_business IS NULL OR char_length(memory_director_business) <= 100)" +
      " AND (memory_family_contact_name IS NULL OR char_length(memory_family_contact_name) <= 100)" +
      " AND (memory_family_contact_email IS NULL OR char_length(memory_family_contact_email) <= 254)" +
      " AND (call_time IS NULL OR char_length(call_time) <= 80)" +
      " AND (guardian_first_name IS NULL OR char_length(guardian_first_name) <= 50)",
  });
  // One private link opens one sign up.
  pgm.createIndex("fundraisers", "tshirt_token_hash", { unique: true, where: "tshirt_token_hash IS NOT NULL", name: "fundraisers_tshirt_token_hash_unique" });

  // Widen who may set up an in memory page (the check from 1791200000195).
  pgm.dropConstraint("fundraisers", "fundraisers_memory_setup_by_known", { ifExists: true });
  pgm.addConstraint("fundraisers", "fundraisers_memory_setup_by_known", {
    check: `memory_setup_by IS NULL OR memory_setup_by IN (${list(NEW_SETUP_BY)})`,
  });

  // Widen how people get in to an event (the check from 1791200000040).
  pgm.dropConstraint("fundraisers", "fundraisers_booking_check", { ifExists: true });
  pgm.addConstraint("fundraisers", "fundraisers_booking_check", {
    check: `booking IS NULL OR booking IN (${list(NEW_BOOKINGS)})`,
  });

  pgm.sql(dropRequestKindChecks);
  pgm.sql(`ALTER TABLE fundraiser_requests ADD CONSTRAINT fundraiser_requests_kind_check CHECK (kind IN (${list(NEW_REQUEST_KINDS)}))`);
};

// Back to the old checks, NOT VALID so rows made since do not stop the rollback. The in memory ways
// of giving are taken off the form (a sign up may have one, so the rows stay).
exports.down = (pgm) => {
  pgm.sql(dropRequestKindChecks);
  pgm.sql(`ALTER TABLE fundraiser_requests ADD CONSTRAINT fundraiser_requests_kind_check CHECK (kind IN (${list(OLD_REQUEST_KINDS)})) NOT VALID`);
  pgm.dropConstraint("fundraisers", "fundraisers_memory_setup_by_known", { ifExists: true });
  pgm.sql(
    `ALTER TABLE fundraisers ADD CONSTRAINT fundraisers_memory_setup_by_known CHECK (memory_setup_by IS NULL OR memory_setup_by IN (${list(OLD_SETUP_BY)})) NOT VALID`,
  );
  pgm.dropConstraint("fundraisers", "fundraisers_booking_check", { ifExists: true });
  pgm.sql(
    `ALTER TABLE fundraisers ADD CONSTRAINT fundraisers_booking_check CHECK (booking IS NULL OR booking IN (${list(OLD_BOOKINGS)})) NOT VALID`,
  );
  pgm.sql(ROLLBACK_SQL);
  pgm.dropColumns("fundraisers", FUNDRAISER_COLUMNS);
  pgm.dropColumns("fundraising_categories", ["sporty", "memory_only"]);
};
