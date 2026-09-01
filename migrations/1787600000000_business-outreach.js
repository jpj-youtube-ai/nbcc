/* eslint-disable camelcase */

// TASK-351: business outreach — cold contact asking local businesses to become monthly supporters.
//
// The front of a funnel whose every later stage already exists (invite email, token-gated
// thank-you page, certificate, Supporters listing, reminders). This ends at "they signed up".
//
// Design note that shapes the columns: there are no tracking tokens here. A business that signs
// up donates through /donate, and that record already carries their name and email, so the fuzzy
// matcher answers "have they started giving?" without a link that breaks the moment somebody
// forwards the email to whoever actually authorises the money.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable("business_outreach", {
    id: "id",
    business_name: { type: "text", notNull: true },
    contact_name: { type: "text" },
    contact_email: { type: "text" },
    contact_phone: { type: "text" },
    // 'company' or 'sole_trader'. Drives a PECR warning rather than a hard block: limited
    // companies and LLPs may be emailed without prior consent; sole traders and unincorporated
    // partnerships count as individuals and may not.
    business_type: { type: "text", notNull: true, default: "company" },
    // Private to admin, never sent. Personal data all the same - it usually names a human - so
    // the form tells volunteers to write it as though the person will read it one day.
    note: { type: "text" },
    // Which volunteer is looking after this one, so two people do not chase the same firm.
    owner: { type: "text" },
    sent_by: { type: "text" },
    sent_at: { type: "timestamptz" },
    // NULL until a volunteer records one. See the outcome list in the design doc: the middle
    // states ("interested, call back", "wrong person, passed on") carry most of the value, which
    // is why this is not a boolean.
    outcome: { type: "text" },
    outcome_at: { type: "timestamptz" },
    // "Not this year, ask again" is worth more than a decline, but only if something remembers.
    ask_again_on: { type: "date" },
    // Anything that counts as the business engaging: a reply, a call, an outcome being set. Drives
    // both the call list and the three-year retention purge.
    last_engagement_at: { type: "timestamptz" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  // The matcher scans every row on every add, the lists filter on outcome and dates, and the
  // purge scans for staleness.
  pgm.createIndex("business_outreach", ["outcome"]);
  pgm.createIndex("business_outreach", ["sent_at"]);
  pgm.createIndex("business_outreach", ["ask_again_on"]);
  pgm.createIndex("business_outreach", ["last_engagement_at"]);

  // Dated notes with an author. The single most valuable thing here for a volunteer-run charity:
  // "rang 3 Sept, spoke to Jim, their year end is March, try again then" is knowledge that
  // otherwise lives in one person's head and leaves when they do.
  //
  // Append-only by intention - there is no edit path. A note that can be quietly rewritten is not
  // a record of what happened.
  pgm.createTable("business_outreach_notes", {
    id: "id",
    outreach_id: {
      type: "integer",
      notNull: true,
      references: "business_outreach",
      onDelete: "CASCADE",
      comment: "Deleting a business takes its notes with it.",
    },
    author: { type: "text", notNull: true },
    body: { type: "text", notNull: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.createIndex("business_outreach_notes", ["outreach_id", { name: "created_at", sort: "DESC" }]);
};

exports.down = (pgm) => {
  pgm.dropTable("business_outreach_notes");
  pgm.dropTable("business_outreach");
};
