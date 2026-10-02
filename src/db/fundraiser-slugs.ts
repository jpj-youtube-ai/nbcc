import { pool } from "./pool";

// TASK-511: the addresses a fundraiser's page used to have (fundraiser_slug_history). When staff
// change a page's address, the old one is kept here (src/db/fundraisers.ts patchFundraiser), and
// /fundraise/<old> answers with a 301 to the page's address now (src/routes/fundraise-pages.ts), so
// a QR code printed with the old link never breaks. No other page may ever take an old address.

/** The address now of the page that used to be at `oldSlug`, or null when no page ever was. */
export async function currentSlugFor(oldSlug: string): Promise<string | null> {
  const r = await pool.query<{ slug: string }>(
    `SELECT f.slug FROM fundraiser_slug_history h JOIN fundraisers f ON f.id = h.fundraiser_id
      WHERE h.old_slug = $1`,
    [oldSlug],
  );
  return r.rows[0]?.slug ?? null;
}
