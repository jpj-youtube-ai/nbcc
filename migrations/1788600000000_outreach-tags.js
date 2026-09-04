/* eslint-disable camelcase */

// TASK-416: tags on a business.
//
// Search already finds what somebody thought to type into the note. A tag is the same information
// made structured, so "show me everyone from the Chamber breakfast" is a filter rather than a
// hopeful search for a word that may or may not be in there.
//
// A text[] rather than a join table: there will be a handful per business, they are never renamed
// centrally, and a table would be three more queries for something a filter reads in one.
//
// Additive and nullable (expand-contract).

exports.up = (pgm) => {
  pgm.addColumn("business_outreach", {
    tags: {
      type: "text[]",
      comment: "Lower-cased, de-duplicated, at most ten. Parsed in src/outreach/paste.ts.",
    },
  });
  // The list filters on them, and GIN is what makes an array containment check worth doing.
  pgm.createIndex("business_outreach", "tags", { method: "gin" });
};

exports.down = (pgm) => {
  pgm.dropColumn("business_outreach", "tags");
};
