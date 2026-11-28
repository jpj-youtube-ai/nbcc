/* eslint-disable */
// Workshop drop-offs (docs/superpowers/specs/2026-11-28-workshop-dropoffs-design.md): one row each
// time somebody bringing something into the Elves Workshop leaves their details on the tablet page at
// /workshop. Staff send proper thank-you letters from the list in Admin > Giving > Workshop drop-offs.
//
// Additive: a new table, and the newsletter's consent check widened to take 'workshop' (older code
// never writes it).

exports.up = (pgm) => {
  pgm.createTable(
    "workshop_dropoffs",
    {
      id: "id",
      name: { type: "text", notNull: true },
      email: { type: "text", notNull: true },
      brought: { type: "text", notNull: true },
      group_name: { type: "text" },
      phone: { type: "text" },
      newsletter: { type: "boolean", notNull: true, default: false },
      created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    },
    { comment: "Somebody who brought something into the Elves Workshop and left their details at /workshop." },
  );
  pgm.createIndex("workshop_dropoffs", "created_at");

  pgm.dropConstraint("list_subscribers", "list_subscribers_consent_source_check");
  pgm.addConstraint("list_subscribers", "list_subscribers_consent_source_check", {
    check: "consent_source IN ('footer', 'import', 'admin', 'fundraise', 'elf', 'workshop')",
  });
};

exports.down = (pgm) => {
  // Back to the narrower set: only safe while no row says 'workshop' (down is never run on production).
  pgm.dropConstraint("list_subscribers", "list_subscribers_consent_source_check");
  pgm.addConstraint("list_subscribers", "list_subscribers_consent_source_check", {
    check: "consent_source IN ('footer', 'import', 'admin', 'fundraise', 'elf')",
  });
  pgm.dropTable("workshop_dropoffs");
};
