import { z } from "zod";
import { pool } from "./pool";

// DB access for the SHARED saved-template library (TASK-249). A template is a stored block document
// (the same shape newsletters.body_json holds) that any Editor can start a newsletter from, so it
// inherits every block feature for free — including the TASK-248 size step, which is a relative step
// and so stays correct when the template is reused on different copy. Single-statement writes over
// the pool, mirroring src/db/newsletters.ts (no transaction needed).

export interface NewsletterTemplateSummary {
  id: number;
  name: string;
  createdAt: string;
}
export interface NewsletterTemplate extends NewsletterTemplateSummary {
  bodyJson: unknown;
}

// The library is SHARED, so a bad name is everyone's problem: a blank one renders as an unclickable
// empty row in every Editor's picker, and a runaway one breaks its layout. Trimmed, so " Appeal " and
// "Appeal" can't sit side by side looking identical (the column's UNIQUE index then means it).
export const templateNameSchema = z.string().trim().min(1).max(80);

export async function listNewsletterTemplates(): Promise<NewsletterTemplateSummary[]> {
  // Deliberately NOT body_json: a document can be large and the picker only shows a name and a date.
  const { rows } = await pool.query(
    `SELECT id, name, created_at FROM newsletter_templates ORDER BY created_at DESC, id DESC`,
  );
  return rows.map((r) => ({ id: r.id, name: r.name, createdAt: r.created_at }));
}

export async function getNewsletterTemplate(id: number): Promise<NewsletterTemplate | null> {
  const { rows } = await pool.query(
    `SELECT id, name, created_at, body_json FROM newsletter_templates WHERE id = $1`,
    [id],
  );
  const r = rows[0];
  return r ? { id: r.id, name: r.name, createdAt: r.created_at, bodyJson: r.body_json } : null;
}

// Thrown when the name is already taken (pg unique-violation on newsletter_templates.name). The
// route maps it to a 409 the UI can explain — mirroring DuplicateEmailError in ./admin-users, so the
// "DB throws a domain error, route maps the status" split stays consistent across the codebase.
export class DuplicateTemplateNameError extends Error {
  constructor(public readonly templateName: string) {
    super(`a newsletter template named ${templateName} already exists`);
    this.name = "DuplicateTemplateNameError";
  }
}

// node-postgres throws a plain Error with the SQLSTATE attached as `code`; type it narrowly rather
// than importing a pg-specific error class. (Same one-line guard as ./admin-users — deliberately not
// shared, so newsletter code doesn't take a dependency on the admin-users module for a pg constant.)
function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}

// createdBy is nullable so a template outlives the staff account that saved it (the FK is ON DELETE
// SET NULL): the team's work is not the author's to take with them.
export async function createNewsletterTemplate(
  name: string,
  bodyJson: unknown,
  createdBy: number | null,
): Promise<NewsletterTemplateSummary> {
  try {
    const { rows } = await pool.query(
      `INSERT INTO newsletter_templates (name, body_json, created_by)
       VALUES ($1, $2::jsonb, $3) RETURNING id, name, created_at`,
      [name, JSON.stringify(bodyJson), createdBy],
    );
    return { id: rows[0].id, name: rows[0].name, createdAt: rows[0].created_at };
  } catch (err) {
    if (isUniqueViolation(err)) throw new DuplicateTemplateNameError(name);
    throw err;
  }
}

// Returns false when nothing matched, so the route can 404 rather than pretend it deleted something.
export async function deleteNewsletterTemplate(id: number): Promise<boolean> {
  const { rowCount } = await pool.query(`DELETE FROM newsletter_templates WHERE id = $1`, [id]);
  return (rowCount ?? 0) > 0;
}
