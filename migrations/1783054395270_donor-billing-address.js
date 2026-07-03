/* eslint-disable */
// TASK-085 (REQ-038/REQ-053): a company donation captures billing details for the receipt /
// records. Additive / expand-contract: two brand-new NULLABLE text columns on donors, so every
// existing donor row is unaffected (they back-fill to NULL) and no existing column is dropped,
// renamed or made NOT NULL — a code-level rollback stays safe (golden rule 2). Independent of
// the earlier additive migrations (order between them does not matter). Mirrors the additive
// column style of 1783010739790 (declaration-status-and-token) and 1783014186353 (gasds-eligible).
//
// billing_address / billing_postcode are set only for a company donor (donor_type='company')
// from the REQ-038 company object; individuals and partnerships leave them NULL. The mapping
// lives in src/donors/company.ts (buildCompanyDonorRow) and the write in src/db/donations.ts.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumn("donors", {
    billing_address: { type: "text" }, // nullable: a company's billing address (REQ-038)
    billing_postcode: { type: "text" }, // nullable: a company's billing postcode (REQ-038)
  });
};

exports.down = (pgm) => {
  pgm.dropColumn("donors", ["billing_address", "billing_postcode"]);
};
