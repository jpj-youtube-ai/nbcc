// TASK-427: connecting pg_dump and psql to the same database the app uses.
//
// The nightly backup failed every night from the day it shipped:
//
//   pg_dump: error: invalid sslmode value: "no-verify"
//
// DATABASE_URL ends sslmode=no-verify, which is NOT a PostgreSQL option. It is an extension
// invented by node-postgres meaning "encrypt but do not verify the certificate" (see the comment
// on db_url in infra/modules/app/main.tf, where it is chosen so the image need not carry the RDS
// CA bundle). pg_dump and psql use libpq, which has never heard of it and refuses to connect.
// libpq spells the same thing "require".
//
// Nothing caught this. Every unit test mocks the database and CI's Postgres does not enforce TLS,
// so no test ever put that string in front of a libpq tool. It could only fail against the real
// RDS instance.
//
// The connection now travels by ENVIRONMENT rather than on the command line. That is not
// cosmetic: the original failure printed the whole failing command, the command carried the
// connection string, and the database password went into CloudWatch. Out of argv, it cannot reach
// an error message, a log line, or `ps` inside the container.

/** libpq's complete set. Anything else is a node-postgres extension and must be translated. */
const LIBPQ_SSLMODES = new Set([
  "disable",
  "allow",
  "prefer",
  "require",
  "verify-ca",
  "verify-full",
]);

// node-postgres accepts options libpq does not. no-verify means "encrypt, do not check the
// certificate", which libpq spells "require" - its require encrypts without verifying, while
// verify-ca and verify-full are the ones that check. Same meaning, different vocabulary.
const NODE_POSTGRES_TRANSLATIONS: Record<string, string> = { "no-verify": "require" };

export type LibpqEnv = {
  PGHOST: string;
  PGPORT: string;
  PGUSER: string;
  PGPASSWORD: string;
  PGDATABASE: string;
  PGSSLMODE: string;
};

/**
 * Connection details for pg_dump / psql, as environment variables.
 *
 * On the DEFAULT when a URL carries no sslmode: "prefer", not "require".
 *
 * "require" was the first instinct, since RDS sets force_ssl=1 and refuses unencrypted
 * connections. It is also wrong, and wrong in the same shape as the bug being fixed here: local
 * development and CI run Postgres with no TLS at all, so "require" would refuse to connect and
 * the fix for production would have broken everywhere else.
 *
 * "prefer" negotiates encryption when the server offers it and falls back when it does not, so it
 * is correct in both places. Production never relies on it anyway: Terraform always writes an
 * explicit sslmode into the URL (infra/modules/app/main.tf), so the default only ever applies on
 * a developer's machine, and RDS enforces encryption server-side regardless of what the client
 * asks for.
 */
export function libpqEnvFromUrl(connectionString: string): LibpqEnv {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    // Deliberately does not echo the string back: it contains the password.
    throw new Error("The database connection string could not be parsed as a URL.");
  }

  const requested = url.searchParams.get("sslmode");
  // An explicit sslmode we recognise is honoured. Anything else - node-postgres's
  // no-verify, or a typo - becomes a value libpq will actually accept.
  const sslmode = requested
    ? LIBPQ_SSLMODES.has(requested)
      ? requested
      : NODE_POSTGRES_TRANSLATIONS[requested] ?? "prefer"
    : "prefer";

  return {
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    // The URL form percent-encodes anything awkward. Handing libpq the encoded text fails as
    // "password authentication failed", which reads like a wrong password rather than an
    // encoding bug, and would cost an afternoon.
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.replace(/^\//, "")),
    PGSSLMODE: sslmode,
  };
}

/**
 * Mask the password in any connection string appearing in text we are about to log.
 *
 * Belt and braces. With the environment approach above the password should never reach an error
 * message at all, but everything printed about a failure goes through here regardless, because
 * being wrong once costs a password sitting in a log for thirty days.
 */
export function scrubConnectionStrings(text: string): string {
  return text.replace(/(postgres(?:ql)?:\/\/[^:/@\s]+:)[^@\s]*@/gi, "$1***@");
}
