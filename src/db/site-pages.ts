import { pool } from "./pool";

// DB access for the site addressing feature (site-pages): the spare-address table the site
// router consults for unknown paths, and the per-page search-visibility overrides behind
// sitemap.xml. Single-statement reads/writes over the pool, mirroring src/db/email-log.ts.

export interface SiteAlias {
  id: number;
  fromPath: string;
  toPath: string;
  createdBy: string;
  createdAt: string;
}

export async function listAliases(): Promise<SiteAlias[]> {
  const { rows } = await pool.query(
    `SELECT id, from_path, to_path, created_by, created_at FROM site_aliases ORDER BY from_path`,
  );
  return rows.map((r) => ({
    id: r.id,
    fromPath: r.from_path,
    toPath: r.to_path,
    createdBy: r.created_by,
    createdAt: r.created_at,
  }));
}

// The hot-path lookup the 404 catch-all makes: one indexed read by exact path (lowercased —
// addresses are typed by hand, and /About should find /about). Null = no alias, fall through
// to the branded 404.
export async function resolveAlias(path: string): Promise<string | null> {
  const { rows } = await pool.query(`SELECT to_path FROM site_aliases WHERE from_path = lower($1)`, [path]);
  return rows[0]?.to_path ?? null;
}

// Returns false when the address is already taken (unique violation) rather than throwing —
// the route turns that into a friendly 409, not a 500.
export async function addAlias(fromPath: string, toPath: string, actor: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `INSERT INTO site_aliases (from_path, to_path, created_by) VALUES (lower($1), $2, $3)
     ON CONFLICT (from_path) DO NOTHING`,
    [fromPath, toPath, actor],
  );
  return (rowCount ?? 0) > 0;
}

export async function removeAlias(id: number): Promise<boolean> {
  const { rowCount } = await pool.query(`DELETE FROM site_aliases WHERE id = $1`, [id]);
  return (rowCount ?? 0) > 0;
}

// The admin's per-page search-visibility choices: path -> listed. Absence = registry default.
export async function getSeoOverrides(): Promise<Map<string, boolean>> {
  const { rows } = await pool.query(`SELECT page_path, listed FROM site_page_seo`);
  return new Map(rows.map((r) => [r.page_path, r.listed]));
}

// Upsert one choice. Setting a page BACK to its default still stores the row — an explicit
// admin decision beats an implicit default, and the panel shows who last touched it.
export async function setSeoListed(pagePath: string, listed: boolean, actor: string): Promise<void> {
  await pool.query(
    `INSERT INTO site_page_seo (page_path, listed, updated_by, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (page_path) DO UPDATE SET listed = $2, updated_by = $3, updated_at = now()`,
    [pagePath, listed, actor],
  );
}
