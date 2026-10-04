import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";

// Joining the mailing list from /newsletter: the one table it needs, for requests waiting to be
// confirmed by email. A new table only, so a code rollback is safe (golden rule 2). It must sort
// after 240: node-pg-migrate refuses on production to run one that sorts before a migration already
// run. Never asserted to be the last one.

const ROOT = resolve(__dirname, "../..");
const NAME = "1791200000250_newsletter-signup-requests.js";

type Call = { op: string; args: unknown[] };
function run(fn: "up" | "down"): Call[] {
  const calls: Call[] = [];
  const fixed: Record<string, unknown> = { func: (s: string) => ({ func: s }) };
  const pgm = new Proxy(fixed, {
    get(target, op: string) {
      if (op in target) return target[op];
      return (...args: unknown[]) => calls.push({ op, args });
    },
  });
  const migration = createRequire(import.meta.url)(resolve(ROOT, "migrations", NAME)) as Record<"up" | "down", (p: unknown) => void>;
  migration[fn](pgm);
  return calls;
}

describe("the mailing list sign up requests migration", () => {
  it("sorts after 240", () => {
    expect(readdirSync(resolve(ROOT, "migrations"))).toContain(NAME);
    expect(NAME > "1791200000240").toBe(true);
  });

  it("only makes one new table and its index", () => {
    const up = run("up");
    expect(up.map((c) => c.op).sort()).toEqual(["createIndex", "createTable"]);
    expect(up.find((c) => c.op === "createTable")?.args[0]).toBe("newsletter_signup_requests");
  });

  it("keeps the minimum: the address, the first name, a hash of the link and three times", () => {
    const columns = run("up").find((c) => c.op === "createTable")?.args[1] as Record<string, { unique?: boolean; notNull?: boolean }>;
    expect(Object.keys(columns).sort()).toEqual(["created_at", "email", "expires_at", "first_name", "id", "sent_at", "token_hash"]);
    // One waiting request for an address, and a link is found by its hash.
    expect(columns.email.unique).toBe(true);
    expect(columns.token_hash.unique).toBe(true);
    for (const c of ["email", "first_name", "token_hash", "sent_at", "expires_at"]) expect(columns[c].notNull, c).toBe(true);
  });

  it("never keeps the link itself", () => {
    const columns = run("up").find((c) => c.op === "createTable")?.args[1] as Record<string, unknown>;
    expect(Object.keys(columns)).not.toContain("token");
  });

  it("down takes the table away", () => {
    const down = run("down");
    expect(down).toHaveLength(1);
    expect(down[0].op).toBe("dropTable");
    expect(down[0].args[0]).toBe("newsletter_signup_requests");
  });
});
