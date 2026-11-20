import { signAdminSession } from "../../../src/admin/session";

// TASK-643: the REAL server's answers, for the admin screens' contract tests.
//
// A screen test that answers its fetches by hand only proves the screen matches the answer its
// author imagined. These helpers call the real route handler instead, with only the database
// stubbed: `db` stands in for src/db/pool's pool and hands back rows in the database's own shape
// (what pg returns for that SQL: ints from ::int, strings from to_char, Date objects for timestamptz
// columns). So what a screen test feeds the screen is exactly what production would send it, and a
// change on either side that breaks the other fails a test.
//
// In the test file (vi.mock is hoisted, so the factories import this file themselves):
//
//   vi.mock("../../src/db/pool", async () => ({ pool: (await import("./helpers/real-server")).db.pool }));
//   vi.mock("../../src/config", async () => ({ config: (await import("./helpers/real-server")).CONFIG }));
//
//   db.answer([[/FROM qr_codes ORDER BY/, [{ id: 3, name: "Leaflet", ... }]], ...]);
//   const reply = await callRoute(getNamedCodes, { query: {} });   // { status, body, headers }
//
// The signed-in person is a row of the users table like any other (answered here for you, as an
// admin unless `who` says otherwise), so the real permission check runs too. Invented data only:
// the repo is public.

export const SECRET = "contract-test-secret";

/** Enough of src/config for the routes and the database modules to load. */
export const CONFIG = {
  NODE_ENV: "development",
  DATABASE_URL: "postgres://localhost:5432/contract-test",
  ADMIN_SESSION_SECRET: SECRET,
  STRIPE_SECRET_KEY: "sk_test_placeholder",
  STRIPE_WEBHOOK_SECRET: "whsec_contract",
  PUBLIC_BASE_URL: "https://nbcc.scot",
  PORTAL_BASE_URL: "https://nbcc.scot",
};

type Rows = Record<string, unknown>[];
/** A rule: SQL that contains (or matches) the first part is answered with the second. */
export type Rule = [string | RegExp, Rows | ((params: unknown[]) => Rows)];

const USERS_SQL = "FROM users WHERE id = $1";

export type Who = { role?: "admin" | "editor" | "viewer"; permissions?: Record<string, string> | null; email?: string };

let rules: Rule[] = [];
let who: Required<Who> = { role: "admin", permissions: null, email: "pretend.admin@example.com" };
/** Every query the handler ran, in order, for a test that wants to see them. */
export const ran: { sql: string; params: unknown[] }[] = [];

function answer(sql: string, params: unknown[] = []): { rows: Rows; rowCount: number } {
  ran.push({ sql, params });
  if (sql.includes(USERS_SQL)) {
    const rows = [{ id: Number(params[0]), email: who.email, status: "active", role: who.role, permissions: who.permissions }];
    return { rows, rowCount: 1 };
  }
  for (const [match, out] of rules) {
    const hit = typeof match === "string" ? sql.includes(match) : match.test(sql);
    if (hit) {
      const rows = typeof out === "function" ? out(params) : out;
      return { rows, rowCount: rows.length };
    }
  }
  // Anything not answered reads as an empty table, as a fresh database would.
  return { rows: [], rowCount: 0 };
}

const client = {
  query: async (sql: string, params?: unknown[]) => answer(String(sql), params ?? []),
  release: () => undefined,
};

export const db = {
  pool: {
    query: async (sql: unknown, params?: unknown[]) => answer(String(sql), params ?? []),
    connect: async () => client,
  },
  /** Sets the rows the database holds for this test (and who is signed in). */
  answer(next: Rule[], as: Who = {}) {
    rules = next;
    who = { role: "admin", permissions: null, email: "pretend.admin@example.com", ...as };
    ran.length = 0;
  },
};

export type Reply = { status: number; body: unknown; headers: Record<string, string> };

/* eslint-disable @typescript-eslint/no-explicit-any */
type Handler = (req: any, res: any, next?: any) => Promise<unknown> | unknown;
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * The admin's jsdom harnesses answer a fetch at once, but a handler is async: so collect the real
 * replies first, then hand the screen this. Keys are "GET /api/admin/x?days=7" (matched first, with
 * the query) or "GET /api/admin/x" (any query). Anything not listed gets nothing back, so the
 * harness gives its own empty answer.
 */
export function replyWith(replies: Record<string, Reply>) {
  return (call: { method: string; path: string; url: string }): { status: number; body: unknown } | undefined => {
    const hit = replies[`${call.method} ${call.url}`] ?? replies[`${call.method} ${call.path}`];
    return hit ? { status: hit.status, body: hit.body } : undefined;
  };
}

/** Calls a real route handler as the signed-in person and gives back what it sent. */
export async function callRoute(
  handler: Handler,
  opts: { query?: Record<string, string>; params?: Record<string, string>; body?: unknown } = {},
): Promise<Reply> {
  const token = signAdminSession({ sub: 1, email: who.email, role: who.role, now: new Date(), secret: SECRET }).token;
  const reply: Reply = { status: 200, body: undefined, headers: {} };
  const res = {
    status(c: number) {
      reply.status = c;
      return res;
    },
    json(b: unknown) {
      // Through JSON and back, as the wire does: a Date becomes its ISO string, undefined goes.
      reply.body = JSON.parse(JSON.stringify(b));
      return res;
    },
    send(b: unknown) {
      reply.body = b;
      return res;
    },
    setHeader(k: string, v: string) {
      reply.headers[k.toLowerCase()] = v;
      return res;
    },
    type(t: string) {
      reply.headers["content-type"] = t;
      return res;
    },
    redirect(code: number, to: string) {
      reply.status = code;
      reply.headers.location = to;
      return res;
    },
  };
  const req = {
    method: "GET",
    headers: { authorization: `Bearer ${token}` },
    query: opts.query ?? {},
    params: opts.params ?? {},
    body: opts.body ?? {},
  };
  await handler(req, res, () => undefined);
  return reply;
}
