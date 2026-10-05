import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// TASK-565: the contact form's optional phone number, from the form's rule (contact-schema.test.ts)
// and the page (contact.test.ts) through to the database and the admin's open message.

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../../src/db/contact-pool", () => ({ contactPool: { query } }));

import { insertEnquiry, listEnquiries, getEnquiry, markReplied } from "../../src/db/contact";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (f: string) => readFileSync(resolve(ROOT, f), "utf8");

const enquiry = { firstName: "Ada", lastName: "Example", email: "ada@example.com", message: "Hello" };

beforeEach(() => {
  query.mockReset();
  query.mockResolvedValue({ rows: [{ id: 1 }], rowCount: 1 });
});

describe("storing the phone number", () => {
  it("stores the number the sender gave", async () => {
    await insertEnquiry({ ...enquiry, phone: "07700 900123" });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("(first_name, last_name, email, phone, message)");
    expect(params).toEqual(["Ada", "Example", "ada@example.com", "07700 900123", "Hello"]);
  });

  it("stores no number, not an empty one, when the box was left blank", async () => {
    await insertEnquiry({ ...enquiry, phone: "" });
    expect(query.mock.calls[0][1][3]).toBeNull();
  });

  it("reads the number back on the list, on an open message, and after marking it replied", async () => {
    await listEnquiries();
    await getEnquiry(1);
    await markReplied(1, true, "staff@example.com");
    for (const [sql] of query.mock.calls) expect(sql).toMatch(/email, phone, message/);
  });
});

describe("the migration", () => {
  const sql = read("migrations-contact/1791300000000_contact-phone.js");

  it("only adds one column that may be empty, so existing messages are untouched", () => {
    expect(sql).toMatch(/addColumn\("contact_enquiries",\s*\{\s*phone:\s*\{\s*type: "text",\s*notNull: false/);
    expect(sql.match(/pgm\.\w+\(/g)).toEqual(["pgm.addColumn(", "pgm.dropColumn("]);
  });
});

describe("the admin's open message", () => {
  it("shows a Phone line under Email, only when a number was given", () => {
    const js = read("assets/js/admin/app.js").replace(/\s+/g, " ");
    expect(js).toContain('dl("Email", c.email) + // Optional on the form, so only a line when the sender gave one. (c.phone ? dl("Phone", c.phone) : "") + dl("Received"');
  });
});
