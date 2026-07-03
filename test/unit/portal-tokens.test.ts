import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-100 (REQ-061): the donor-portal magic-link tokens. The pure token logic (expiry, one-time
// use, link URL) is tested DB-free; the audited issue/consume writes are tested against a mocked
// pool, mirroring test/unit/donations-batch.test.ts.

import {
  issuePortalToken,
  verifyPortalToken,
  portalMagicLink,
  PortalTokenError,
  PORTAL_TOKEN_TTL_MS,
  type PortalTokenRecord,
} from "../../src/portal/tokens";

const NOW = new Date("2026-07-03T12:00:00.000Z");

describe("pure token logic (DB-free) — REQ-061", () => {
  it("issues a record whose expiry is now + ttl", () => {
    const rec = issuePortalToken({ token: "tok_1", donorId: 42, now: NOW, ttlMs: 60_000 });
    expect(rec).toEqual({ token: "tok_1", donor_id: 42, expires_at: new Date(NOW.getTime() + 60_000) });
    // Default ttl is used when none is given.
    const def = issuePortalToken({ token: "tok_1", donorId: 42, now: NOW });
    expect(def.expires_at.getTime()).toBe(NOW.getTime() + PORTAL_TOKEN_TTL_MS);
  });

  it("verifies a freshly issued token to the correct donor_id", () => {
    const rec: PortalTokenRecord = { token: "tok_1", donor_id: 42, expires_at: new Date(NOW.getTime() + 60_000), used_at: null };
    expect(verifyPortalToken(rec, NOW)).toEqual({ donorId: 42 });
  });

  it("rejects an EXPIRED token", () => {
    const rec: PortalTokenRecord = { token: "tok_1", donor_id: 42, expires_at: new Date(NOW.getTime() - 1), used_at: null };
    expect(() => verifyPortalToken(rec, NOW)).toThrow(PortalTokenError);
    try {
      verifyPortalToken(rec, NOW);
    } catch (err) {
      expect((err as PortalTokenError).reason).toBe("expired");
    }
  });

  it("rejects a token that was already USED (one-time use)", () => {
    const rec: PortalTokenRecord = { token: "tok_1", donor_id: 42, expires_at: new Date(NOW.getTime() + 60_000), used_at: new Date(NOW.getTime() - 1000) };
    try {
      verifyPortalToken(rec, NOW);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as PortalTokenError).reason).toBe("already_used");
    }
  });

  it("rejects an unknown token (no row)", () => {
    expect(() => verifyPortalToken(undefined, NOW)).toThrow(PortalTokenError);
  });

  it("builds a magic-link URL from the base + token, trimming a trailing slash", () => {
    expect(portalMagicLink("https://nbcc.test/", "tok_1")).toBe("https://nbcc.test/portal/access?token=tok_1");
  });
});

// --- The audited DB writes, mocked pool --------------------------------------------------------
const { queryMock, mockClient, connect } = vi.hoisted(() => {
  const queryMock = vi.fn();
  const mockClient = { query: queryMock, release: vi.fn() };
  const connect = vi.fn(async () => mockClient);
  return { queryMock, mockClient, connect };
});
vi.mock("../../src/db/pool", () => ({ pool: { connect } }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
import { issuePortalAccessToken, consumePortalToken } from "../../src/db/portal";

// The token row the consume SELECT returns — mutated per test.
let selectRow: PortalTokenRecord | undefined;

function installQuery() {
  queryMock.mockImplementation(async (sql: string) => {
    if (/^\s*(begin|commit|rollback)/i.test(sql)) return {};
    if (/select[\s\S]*from portal_access_tokens/i.test(sql))
      return { rows: selectRow ? [selectRow] : [], rowCount: selectRow ? 1 : 0 };
    if (/insert into portal_access_tokens/i.test(sql)) return { rowCount: 1, rows: [] };
    if (/update portal_access_tokens/i.test(sql)) return { rowCount: 1, rows: [] };
    if (/insert into audit_log/i.test(sql)) return { rowCount: 1, rows: [] };
    return { rows: [], rowCount: 0 };
  });
}

const sqls = (): string[] => queryMock.mock.calls.map((c) => String(c[0]).trim());
const has = (re: RegExp): boolean => sqls().some((s) => re.test(s));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = (re: RegExp): any[] | undefined => queryMock.mock.calls.find((c) => re.test(String(c[0])));

beforeEach(() => {
  queryMock.mockReset();
  mockClient.release.mockClear();
  connect.mockClear();
  installQuery();
  selectRow = { token: "tok_1", donor_id: 42, expires_at: new Date(Date.now() + 60_000), used_at: null };
});

describe("issuePortalAccessToken (audited write) — REQ-061", () => {
  it("inserts a token row + a portal.token_issued audit row in one transaction", async () => {
    const result = await issuePortalAccessToken(42, { ttlMs: 60_000 });
    expect(result.donorId).toBe(42);
    expect(typeof result.token).toBe("string");
    expect(result.expiresAt).toBeInstanceOf(Date);

    const seq = sqls();
    expect(seq[0]).toMatch(/^begin/i);
    expect(seq[seq.length - 1]).toMatch(/^commit/i);
    expect(has(/insert into portal_access_tokens/i)).toBe(true);
    const insert = call(/insert into portal_access_tokens/i);
    expect(insert?.[1][0]).toBe(42); // donor_id
    const audits = queryMock.mock.calls.filter((c) => /insert into audit_log/i.test(String(c[0])));
    expect(audits.map((c) => c[1][1])).toContain("portal.token_issued");
  });
});

describe("consumePortalToken (audited write) — REQ-061", () => {
  it("verifies a fresh token, marks it used, and returns the donor id in one transaction", async () => {
    const result = await consumePortalToken("tok_1");
    expect(result).toEqual({ donorId: 42 });
    const update = call(/update portal_access_tokens/i);
    expect(update?.[0]).toMatch(/used_at = now\(\)/i);
    const audits = queryMock.mock.calls.filter((c) => /insert into audit_log/i.test(String(c[0])));
    expect(audits.map((c) => c[1][1])).toContain("portal.token_used");
    expect(sqls().pop()).toMatch(/^commit/i);
  });

  it("cannot be verified a second time (an already-used token throws, rolling back)", async () => {
    // Simulate the row now carrying used_at (as it would after the first consume committed).
    selectRow = { token: "tok_1", donor_id: 42, expires_at: new Date(Date.now() + 60_000), used_at: new Date() };
    await expect(consumePortalToken("tok_1")).rejects.toMatchObject({ reason: "already_used" });
    expect(sqls().pop()).toMatch(/^rollback/i);
    expect(has(/update portal_access_tokens/i)).toBe(false);
  });

  it("rejects an expired token and an unknown token, rolling back", async () => {
    selectRow = { token: "tok_1", donor_id: 42, expires_at: new Date(Date.now() - 1), used_at: null };
    await expect(consumePortalToken("tok_1")).rejects.toMatchObject({ reason: "expired" });

    selectRow = undefined;
    await expect(consumePortalToken("nope")).rejects.toMatchObject({ reason: "not_found" });
    expect(sqls().pop()).toMatch(/^rollback/i);
  });
});
