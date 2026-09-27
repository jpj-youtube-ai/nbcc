import { describe, it, expect } from "vitest";
import { libpqEnvFromUrl, scrubConnectionStrings } from "../../src/backup/pg-tools";

// TASK-427. The nightly backup failed every night from the day it shipped, with:
//
//   pg_dump: error: invalid sslmode value: "no-verify"
//
// DATABASE_URL ends sslmode=no-verify. That is NOT a PostgreSQL option: it is an extension
// invented by node-postgres, meaning "encrypt but do not verify the certificate". pg_dump and psql
// use libpq, which has never heard of it and refuses to connect. libpq's equivalent is "require".
//
// Nothing caught it. Every unit test mocks the database, and CI's Postgres does not enforce TLS,
// so no test ever put this string in front of a libpq tool. It could only fail against the real
// RDS instance, at 2am, which is exactly what it did.
//
// The second half of the same incident: the failure printed the whole command, and the command
// carried the connection string, so the database password went into CloudWatch. Passing the
// connection details through the environment instead keeps the password out of argv entirely, so
// it cannot reach an error message, a log line, or `ps` inside the container.

const URL_UNDER_TEST =
  "postgres://app:s3cr3t-p%40ss@charity-site-production.abc123.eu-west-2.rds.amazonaws.com:5432/charity?sslmode=no-verify";

describe("translating a node-postgres URL for libpq tools", () => {
  const env = libpqEnvFromUrl(URL_UNDER_TEST);

  // THE bug. no-verify is meaningless to libpq; require is the same thing in its vocabulary:
  // encrypt the connection, do not verify the certificate.
  it("turns node-postgres's no-verify into libpq's require", () => {
    expect(env.PGSSLMODE).toBe("require");
  });

  it("pulls the connection apart correctly", () => {
    expect(env.PGHOST).toBe("charity-site-production.abc123.eu-west-2.rds.amazonaws.com");
    expect(env.PGPORT).toBe("5432");
    expect(env.PGUSER).toBe("app");
    expect(env.PGDATABASE).toBe("charity");
  });

  // Terraform generates the password, so it can contain characters that are percent-encoded in a
  // URL. Handing libpq the still-encoded form would fail authentication with a bare "password
  // authentication failed", which looks like a wrong password rather than an encoding bug.
  it("decodes a percent-encoded password", () => {
    expect(env.PGPASSWORD).toBe("s3cr3t-p@ss");
  });

  it("leaves a real libpq sslmode alone", () => {
    expect(libpqEnvFromUrl("postgres://u:p@h:5432/d?sslmode=verify-full").PGSSLMODE).toBe(
      "verify-full",
    );
    expect(libpqEnvFromUrl("postgres://u:p@h:5432/d?sslmode=require").PGSSLMODE).toBe("require");
  });

  // "require" was the first instinct here, since RDS refuses unencrypted connections. It is wrong
  // in exactly the shape of the bug this fixes: local development and CI run Postgres with no TLS,
  // so require would refuse to connect and the production fix would break everywhere else.
  // Production never reaches this default anyway, because Terraform always writes an explicit
  // sslmode into the URL.
  it("defaults to prefer, so a plain local database still works", () => {
    expect(libpqEnvFromUrl("postgres://u:p@h:5432/d").PGSSLMODE).toBe("prefer");
  });

  // THE GUARD. The whole incident was one value libpq does not accept. Whatever arrives, whatever
  // node-postgres invents next, the output must be something libpq will take: anything else fails
  // at 2am against the only database that can prove it.
  it.each([
    ["no-verify"],
    ["require"],
    ["verify-full"],
    ["disable"],
    ["prefer"],
    ["allow"],
    ["verify-ca"],
    ["something-nobody-has-invented-yet"],
    [""],
  ])("produces a sslmode libpq accepts, given %s", (given) => {
    const env = libpqEnvFromUrl(`postgres://u:p@h:5432/d?sslmode=${given}`);
    expect(["disable", "allow", "prefer", "require", "verify-ca", "verify-full"]).toContain(
      env.PGSSLMODE,
    );
  });

  // Translating to something weaker than asked for would quietly downgrade a connection that was
  // meant to be encrypted. no-verify means encrypt-without-checking, and so does require.
  it("never downgrades an encrypted request to an unencrypted one", () => {
    expect(libpqEnvFromUrl("postgres://u:p@h/d?sslmode=no-verify").PGSSLMODE).not.toBe("disable");
    expect(libpqEnvFromUrl("postgres://u:p@h/d?sslmode=no-verify").PGSSLMODE).not.toBe("allow");
  });

  it("defaults the port when the URL omits it", () => {
    expect(libpqEnvFromUrl("postgres://u:p@h/d").PGPORT).toBe("5432");
  });

  it("refuses a URL it cannot parse rather than half-connecting", () => {
    expect(() => libpqEnvFromUrl("not a url")).toThrow(/could not be parsed/i);
  });
});

describe("keeping passwords out of anything we log", () => {
  // Belt and braces. The environment approach means the password should never reach an error
  // message, but anything we print about a failure goes through here anyway, because the cost of
  // being wrong once is a password in a log file for thirty days.
  it("masks the password in a connection string", () => {
    expect(scrubConnectionStrings(`connect failed: ${URL_UNDER_TEST}`)).toContain(
      "postgres://app:***@",
    );
    expect(scrubConnectionStrings(`connect failed: ${URL_UNDER_TEST}`)).not.toContain("s3cr3t");
  });

  it("masks every occurrence, not just the first", () => {
    const two = `${URL_UNDER_TEST} and again ${URL_UNDER_TEST}`;
    expect(scrubConnectionStrings(two).match(/\*\*\*/g)).toHaveLength(2);
    expect(scrubConnectionStrings(two)).not.toContain("s3cr3t");
  });

  it("handles postgresql:// as well as postgres://", () => {
    const alt = "postgresql://app:hunter2@host:5432/db";
    expect(scrubConnectionStrings(alt)).toBe("postgresql://app:***@host:5432/db");
  });

  it("leaves text without a connection string untouched", () => {
    expect(scrubConnectionStrings("pg_dump: error: something else entirely")).toBe(
      "pg_dump: error: something else entirely",
    );
  });

  it("does not choke on an empty string", () => {
    expect(scrubConnectionStrings("")).toBe("");
  });

  // The exact shape of the real leak, with an invented password. This is what execFile rejected
  // with when pg_dump failed, and what went into CloudWatch: the whole command line, connection
  // string and all. Testing the real shape rather than a tidy one, because the tidy one is not
  // what happened.
  it("masks the password in the error that actually leaked it", () => {
    const real =
      "Command failed: pg_dump --format=custom --no-owner --file /tmp/nbcc-backup-6md3gp/payload/main/main.dump " +
      "postgres://app:NOTtheRealPassw0rd@charity-site-production.cbqcckmssiya.eu-west-2.rds.amazonaws.com:5432/charity?sslmode=no-verify\n" +
      'pg_dump: error: invalid sslmode value: "no-verify"';

    const safe = scrubConnectionStrings(real);

    expect(safe).not.toContain("NOTtheRealPassw0rd");
    expect(safe).toContain("postgres://app:***@");
    // Everything else must survive, or the scrubbing has cost us the diagnosis.
    expect(safe).toContain('invalid sslmode value: "no-verify"');
    expect(safe).toContain("charity-site-production.cbqcckmssiya.eu-west-2.rds.amazonaws.com");
  });
});
