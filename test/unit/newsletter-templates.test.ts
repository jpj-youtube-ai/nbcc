import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-249: the shared saved-template library. A template is a stored block document any Editor can
// start a newsletter from. Two things are worth proving here, DB-free:
//
//  1. the NAME contract (pure): the library is shared, so a blank/whitespace or runaway name would be
//     everyone's problem, not just the saver's;
//  2. the QUERY shapes: the pool is mocked at the boundary (same approach as
//     charities-online-query.test.ts / donations-batch.test.ts), so we can assert the list stays
//     light (no body_json), the picker orders newest-first, and a save round-trips the doc.
//
// The rule that a template must be a VALID block document is enforced by newsletterDocSchema at the
// route (asserted in admin-newsletter-templates.test.ts) — a template that cannot render is worse
// than no template, because you only find out when you start next month's newsletter from it.

const { queryMock, connect } = vi.hoisted(() => ({ queryMock: vi.fn(), connect: vi.fn() }));
vi.mock("../../src/db/pool", () => ({ pool: { query: queryMock, connect } }));

import {
  templateNameSchema,
  listNewsletterTemplates,
  getNewsletterTemplate,
  createNewsletterTemplate,
  deleteNewsletterTemplate,
  DuplicateTemplateNameError,
} from "../../src/db/newsletter-templates";

const lastSql = (): string => String(queryMock.mock.calls[queryMock.mock.calls.length - 1][0]);
const lastParams = (): unknown[] => queryMock.mock.calls[queryMock.mock.calls.length - 1][1];

const doc = { blocks: [{ type: "text", variant: 0, data: { text: "Hi" }, size: 1 }] };

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockResolvedValue({ rows: [], rowCount: 0 });
});

describe("templateNameSchema (pure — the shared library's one bit of hygiene)", () => {
  it("accepts a sensible name and trims surrounding whitespace", () => {
    expect(templateNameSchema.parse("  Christmas Appeal  ")).toBe("Christmas Appeal");
  });

  it("rejects blank or whitespace-only names", () => {
    // "" would render as an unclickable blank row in everyone's picker.
    expect(templateNameSchema.safeParse("").success).toBe(false);
    expect(templateNameSchema.safeParse("   ").success).toBe(false);
  });

  it("rejects a runaway name rather than letting it break the picker layout", () => {
    expect(templateNameSchema.safeParse("x".repeat(81)).success).toBe(false);
    expect(templateNameSchema.safeParse("x".repeat(80)).success).toBe(true);
  });
});

describe("newsletter template queries", () => {
  it("lists WITHOUT body_json (the picker only needs id/name/date) newest first", () => {
    listNewsletterTemplates();
    const sql = lastSql();
    expect(sql).toMatch(/from\s+newsletter_templates/i);
    expect(sql).not.toMatch(/body_json/i); // the doc can be large; the picker never needs it
    expect(sql).toMatch(/order\s+by\s+created_at\s+desc/i);
  });

  it("fetches one template WITH its body_json (that is the point of opening it)", () => {
    getNewsletterTemplate(7);
    expect(lastSql()).toMatch(/body_json/i);
    expect(lastParams()).toEqual([7]);
  });

  it("saves the name, the document and who saved it", () => {
    createNewsletterTemplate("Christmas Appeal", doc, 3);
    expect(lastSql()).toMatch(/insert\s+into\s+newsletter_templates/i);
    expect(lastParams()).toEqual(["Christmas Appeal", JSON.stringify(doc), 3]);
  });

  it("keeps a template when the staff account that saved it is gone (created_by is nullable)", () => {
    createNewsletterTemplate("Orphan", doc, null);
    expect(lastParams()).toEqual(["Orphan", JSON.stringify(doc), null]);
  });

  it("turns a duplicate name into a domain error the route can 409 (shared library)", async () => {
    // Two Editors both saving "Christmas Appeal" is the normal case for a SHARED library, not an edge
    // case — it must come back as something the UI can explain, never a raw 500.
    queryMock.mockRejectedValueOnce(Object.assign(new Error("dupe"), { code: "23505" }));
    await expect(createNewsletterTemplate("Christmas Appeal", doc, 3)).rejects.toBeInstanceOf(
      DuplicateTemplateNameError,
    );
  });

  it("does not swallow an unrelated database failure as a duplicate", async () => {
    // Mapping every insert failure to "name taken" would hide real outages behind a wrong message.
    queryMock.mockRejectedValueOnce(Object.assign(new Error("connection lost"), { code: "08006" }));
    await expect(createNewsletterTemplate("Anything", doc, 3)).rejects.toThrow("connection lost");
  });

  it("deletes by id and reports whether anything was actually removed", async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    await expect(deleteNewsletterTemplate(7)).resolves.toBe(true);
    expect(lastSql()).toMatch(/delete\s+from\s+newsletter_templates/i);
    expect(lastParams()).toEqual([7]);

    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await expect(deleteNewsletterTemplate(999)).resolves.toBe(false); // → the route 404s
  });
});
