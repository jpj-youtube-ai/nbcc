// Pure input resolution for the set-admin-password ops runner (src/ops/set-admin-password.ts), kept in
// its own module so it can be unit-tested without importing the DB pool (src/db/pool.ts validates
// config at import time and exits when the full service env is absent). No side effects, no I/O.

export interface AdminPasswordInputs {
  email: string;
  password: string;
}

// Pulls the email from argv (--email <addr>) and the password from the environment. Throws a clear
// Error on anything missing/invalid so the caller can exit non-zero. The password is intentionally NOT
// read from argv (which leaks into process listings / shell history / the ecs run-task API call).
export function resolveInputs(argv: string[], env: NodeJS.ProcessEnv): AdminPasswordInputs {
  const args = argv.slice(2);
  const i = args.indexOf("--email");
  const email = i !== -1 ? args[i + 1] : undefined;
  if (!email || !email.includes("@")) {
    throw new Error("Usage: node dist/ops/set-admin-password.js --email <address> (ADMIN_PASSWORD in env)");
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
