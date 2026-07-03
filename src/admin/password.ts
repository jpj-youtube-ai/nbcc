import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

// Salted password hashing for admin/staff accounts (TASK-105/REQ-062), using Node's built-in
// scrypt — no third-party dependency. A hash is stored as `scrypt$<saltHex>$<keyHex>`; the plaintext
// password never touches the database or the logs (golden rule 4). DB-free and side-effect-free, so
// it is unit-tested directly like src/portal/tokens.ts. Verification is constant-time
// (timingSafeEqual) to avoid leaking the hash through response timing.

const scryptAsync = promisify(scrypt);
const KEY_LEN = 64;
const SALT_LEN = 16;

// Hash a plaintext password with a fresh random salt. Returns the storable `scrypt$salt$key` string.
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LEN);
  const key = (await scryptAsync(password, salt, KEY_LEN)) as Buffer;
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

// Verify a plaintext password against a stored `scrypt$salt$key` hash. Returns false (never throws)
// for a null/undefined hash (an account with no password set) or a malformed one, so the caller can
// treat "no credential" and "wrong password" identically (a generic 401).
export async function verifyPassword(
  password: string,
  stored: string | null | undefined,
): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, saltHex, keyHex] = parts;
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltHex, "hex");
    expected = Buffer.from(keyHex, "hex");
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;
  const key = (await scryptAsync(password, salt, expected.length)) as Buffer;
  return key.length === expected.length && timingSafeEqual(key, expected);
}
