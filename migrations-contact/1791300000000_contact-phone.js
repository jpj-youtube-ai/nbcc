/* eslint-disable */
// TASK-565: an optional phone number on the contact form (Jaimie, 5 October 2026), for anyone who
// would rather be called back.
//
// Additive and safe on populated data (golden rule 2): one NEW nullable column with no default.
// Every existing enquiry simply has no number. Nothing dropped, renamed, or made NOT NULL, so a
// code-level rollback leaves a column nobody reads.

exports.up = (pgm) => {
  pgm.addColumn("contact_enquiries", {
    phone: {
      type: "text",
      notNull: false,
      comment: "The phone number the sender chose to give. NULL = none given; the form's box is optional.",
    },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn("contact_enquiries", "phone");
};
