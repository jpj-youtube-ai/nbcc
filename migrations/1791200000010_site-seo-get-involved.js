/* eslint-disable camelcase */

// TASK-494: the Events page became Get involved, at /get-involved (/events now redirects there). An
// admin's saved choice about listing it for search engines (Admin > Site pages, site_page_seo) was
// saved against /events, so it would quietly stop applying. This copies it to /get-involved, once.
//
// Additive and data only: it inserts at most one row and changes nothing else. It never overwrites a
// choice already saved for /get-involved, and leaves the /events row alone (harmless: /events is no
// longer a page in the registry). The copy is marked, so `down` removes only the row it made.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO site_page_seo (page_path, listed, updated_by, updated_at)
    SELECT '/get-involved', listed, 'migration:get-involved', now()
      FROM site_page_seo WHERE page_path = '/events'
    ON CONFLICT (page_path) DO NOTHING
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DELETE FROM site_page_seo WHERE page_path = '/get-involved' AND updated_by = 'migration:get-involved'`);
};
