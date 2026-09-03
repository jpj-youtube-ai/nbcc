/* eslint-disable camelcase */

// TASK-403: why we are allowed to email THIS business.
//
// PECR treats limited companies, LLPs and Scottish partnerships as "corporate subscribers" - they
// may be sent marketing without prior consent. Sole traders and English partnerships are
// "individual subscribers" and may not, and the ICO treats charity fundraising as direct
// marketing. The outreach form already asked which kind of business it is; nothing acted on the
// answer, so a volunteer could email a sole trader with no lawful basis at all.
//
// This column is that basis, in the volunteer's own words ("gave me her card at the Chamber
// breakfast and said to email"). It is required before a sole trader can be emailed and is shown
// back to whoever sends, so the person pressing the button can see why it is allowed.
//
// Additive and nullable (expand-contract): every existing row keeps working, and a company needs
// no basis because the law does not ask for one.

exports.up = (pgm) => {
  pgm.addColumn("business_outreach", {
    // WHERE the details came from, so the Article 14 line in the email can be true for THIS
    // business rather than a sentence that happens to be right most of the time. A disclosure
    // that is wrong is worse than one that is vague. Defaulted for the handful of rows added
    // before this column existed, all of which did come from a website or a listing.
    details_source: {
      type: "text",
      notNull: true,
      default: "website_or_listing",
      check:
        "details_source IN ('website_or_listing', 'given_to_us', 'referred', 'social')",
    },
    consent_basis: {
      type: "text",
      comment:
        "How an individual subscriber (sole trader, non-Scottish partnership) agreed to hear " +
        "from us. Required before we may email one; meaningless for a corporate subscriber.",
    },
    consent_basis_recorded_by: {
      type: "text",
      comment: "Which volunteer recorded that basis, so it can be asked about later.",
    },
    consent_basis_recorded_at: { type: "timestamptz" },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn("business_outreach", [
    "consent_basis",
    "consent_basis_recorded_by",
    "consent_basis_recorded_at",
  ]);
};
