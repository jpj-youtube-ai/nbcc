import { describe, it, expect } from "vitest";
import { parseStoriesUrl, quoteLiteral, quoteIdent } from "../../scripts/bootstrap-stories-db.mjs";

// TASK-B2 (REQ intent: "Persist My Story submissions to a dedicated stories
// database..."): scripts/bootstrap-stories-db.mjs provisions the `stories`
// database + `stories_app` role imperatively (no Terraform postgresql provider,
// private RDS). parseStoriesUrl is the pure, DB-free piece of that script — it
// extracts the role name, password, and database name from STORIES_DATABASE_URL
// so the rest of the script never string-concats a connection URL. Unit-tested
// here without a DB (mirrors the pure-function pattern in declaration-fields.test.ts).

describe("parseStoriesUrl", () => {
  it("extracts user, password, and database from a well-formed URL", () => {
    const result = parseStoriesUrl("postgres://stories_app:s3cret@db.example.com:5432/stories");
    expect(result).toEqual({
      user: "stories_app",
      password: "s3cret",
      database: "stories",
    });
  });

  it("handles the AWS sslmode=no-verify query string", () => {
    const result = parseStoriesUrl(
      "postgres://stories_app:s3cret@my-rds.eu-west-2.rds.amazonaws.com:5432/stories?sslmode=no-verify",
    );
    expect(result).toEqual({
      user: "stories_app",
      password: "s3cret",
      database: "stories",
    });
  });

  it("URL-decodes a password containing special characters", () => {
    const result = parseStoriesUrl("postgres://stories_app:p%40ss%2Fw0rd@localhost:5432/stories");
    expect(result.password).toBe("p@ss/w0rd");
  });

  it("works with the local docker-compose default", () => {
    const result = parseStoriesUrl("postgres://stories_app:stories@localhost:5432/stories");
    expect(result).toEqual({
      user: "stories_app",
      password: "stories",
      database: "stories",
    });
  });

  it("throws a clear error for a malformed URL", () => {
    expect(() => parseStoriesUrl("not-a-url")).toThrow();
  });

  it("throws a clear error when the URL has no database path", () => {
    expect(() => parseStoriesUrl("postgres://stories_app:stories@localhost:5432/")).toThrow(
      /database/i,
    );
  });

  it("throws a clear error when the URL has no credentials", () => {
    expect(() => parseStoriesUrl("postgres://localhost:5432/stories")).toThrow(/user|password/i);
  });
});

// G1 item 5: quoteLiteral/quoteIdent build raw SQL for CREATE/ALTER ROLE and CREATE DATABASE
// (positions that cannot take a bound parameter). These assert their escaping doubles an
// embedded quote correctly, so a password or role name containing one can never break out of
// the literal/identifier and inject SQL.
describe("quoteLiteral", () => {
  it("doubles an embedded single quote and wraps in single quotes", () => {
    expect(quoteLiteral("a'b")).toBe("'a''b'");
  });

  it("wraps a value with no special characters unchanged", () => {
    expect(quoteLiteral("s3cret")).toBe("'s3cret'");
  });
});

describe("quoteIdent", () => {
  it("doubles an embedded double quote and wraps in double quotes", () => {
    expect(quoteIdent('a"b')).toBe('"a""b"');
  });

  it("wraps an identifier with no special characters unchanged", () => {
    expect(quoteIdent("stories_app")).toBe('"stories_app"');
  });
});
