import { describe, it, expect, vi, beforeEach } from "vitest";

// Joining the mailing list from /newsletter: the SQL for requests waiting to be confirmed, against a
// mocked pool (no database). One waiting request for an address; a fresh link no more often than
// every ten minutes; a link is found only by its hash and only until it expires; and requests nobody
// confirms are deleted. Every address here is invented.

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../../src/db/pool", () => ({ pool: { query } }));

import { deleteSignupRequest, findSignupRequest, purgeSignupRequests, saveSignupRequest } from "../../src/db/newsletter-signups";
import { LINK_DAYS, RESEND_MINUTES } from "../../src/mailing-list/model";

const NOW = new Date("2026-10-05T12:00:00.000Z");
const HASH = "a".repeat(64);

beforeEach(() => query.mockReset());

describe("saving a request", () => {
  it("stores the address in lower case with the hash, when it was sent and when it expires", async () => {
    query.mockResolvedValue({ rowCount: 1, rows: [] });
    const stored = await saveSignupRequest({ email: " Sam@Example.com ", firstName: "Sam", tokenHash: HASH }, NOW);
    expect(stored).toBe(true);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO newsletter_signup_requests/);
    expect(params[0]).toBe("sam@example.com");
    expect(params[1]).toBe("Sam");
    expect(params[2]).toBe(HASH);
    expect(params[3]).toEqual(NOW);
    expect(params[4]).toEqual(new Date(NOW.getTime() + LINK_DAYS * 86_400_000));
  });

  it("a second request for the same address replaces the link, but only once the wait is over", async () => {
    query.mockResolvedValue({ rowCount: 0, rows: [] });
    const stored = await saveSignupRequest({ email: "sam@example.com", firstName: "Sam", tokenHash: HASH }, NOW);
    expect(stored).toBe(false);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/ON CONFLICT \(email\) DO UPDATE/);
    expect(sql).toMatch(/WHERE newsletter_signup_requests\.sent_at <= \$6/);
    expect(params[5]).toEqual(new Date(NOW.getTime() - RESEND_MINUTES * 60_000));
  });

  it("waits ten minutes between links, and a link works for seven days", () => {
    expect(RESEND_MINUTES).toBe(10);
    expect(LINK_DAYS).toBe(7);
  });
});

describe("finding a request by its link", () => {
  it("looks it up by the hash, and only while it has not expired", async () => {
    query.mockResolvedValue({ rows: [{ email: "sam@example.com", first_name: "Sam" }] });
    expect(await findSignupRequest(HASH, NOW)).toEqual({ email: "sam@example.com", firstName: "Sam" });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/WHERE token_hash = \$1 AND expires_at > \$2/);
    expect(params).toEqual([HASH, NOW]);
  });

  it("is nothing when there is no such link", async () => {
    query.mockResolvedValue({ rows: [] });
    expect(await findSignupRequest(HASH, NOW)).toBeNull();
  });
});

describe("tidying up", () => {
  it("a used link is deleted, so it works once", async () => {
    query.mockResolvedValue({ rowCount: 1 });
    await deleteSignupRequest(HASH);
    expect(query.mock.calls[0][0]).toMatch(/DELETE FROM newsletter_signup_requests WHERE token_hash = \$1/);
    expect(query.mock.calls[0][1]).toEqual([HASH]);
  });

  it("requests nobody confirmed are deleted once their link has expired", async () => {
    query.mockResolvedValue({ rowCount: 3 });
    expect(await purgeSignupRequests(NOW)).toBe(3);
    expect(query.mock.calls[0][0]).toMatch(/DELETE FROM newsletter_signup_requests WHERE expires_at <= \$1/);
    expect(query.mock.calls[0][1]).toEqual([NOW]);
  });
});
