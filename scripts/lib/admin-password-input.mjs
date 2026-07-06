// Pure input resolution for scripts/set-admin-password.mjs, split into its own module so it can be
// unit-tested without importing the DB pool (src/db/pool.ts validates config at import time and exits
// when the full service env is absent). No side effects, no I/O.

// Pulls the email from argv (--email <addr>) and the password from the environment. Throws a clear
// Error on anything missing/invalid so the caller can exit 1. The password is intentionally NOT read
// from argv (which leaks into process listings / shell history).
export function resolveInputs(argv, env) {
  const args = argv.slice(2);
  const i = args.indexOf("--email");
  const email = i !== -1 ? args[i + 1] : undefined;
  if (!email || !email.includes("@")) {
    throw new Error("Usage: ADMIN_PASSWORD=… npm run admin:set-password -- --email <address>");
  }
  const password = env.ADMIN_PASSWORD;
  if (!password) {
    throw new Error("ADMIN_PASSWORD env var is required (do not pass the password on the command line)");
  }
  if (password.length < 12) {
    throw new Error("ADMIN_PASSWORD must be at least 12 characters");
  }
  return { email, password };
}
