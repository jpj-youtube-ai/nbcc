import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-214: the invite-backfill building blocks — the invited-tracking DB accessors
// (markFulfilmentInvited, listUninvitedBusinessSupporters) and the pure orchestrator
// (runBusinessInviteBackfill). DB-free, mirroring fulfilment-ensure-record.test.ts: the DB accessors
// are exercised against a mocked pool.query (asserting the exact idempotency guard + the un-invited
// gate), and the orchestrator is pure over injected seams, so it takes plain stubs and needs no DB at
// all. It reuses the REAL pure invite builder, so the tests also prove the env-correct tokenised link.

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock("../../src/db/pool", () => ({ pool: { query: queryMock, connect: vi.fn() } }));
vi.mock("../../src/config", () => ({
  config: { NODE_ENV: "development", DATABASE_URL: "postgres://localhost:5432/test" },
}));

import { markFulfilmentInvited, listUninvitedBusinessSupporters } from "../../src/db/fulfilment";
import { runBusinessInviteBackfill, type BusinessInviteBackfillDeps } from "../../src/business/backfill";

beforeEach(() => {
  queryMock.mockReset();
});

describe("markFulfilmentInvited — idempotent stamp (TASK-214)", () => {
  it("stamps invited_at = now() guarded by invited_at IS NULL, returning true when it newly marked", async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 1, rows: [] });
    const marked = await markFulfilmentInvited(7);
    expect(marked).toBe(true);
    const [sql, params] = queryMock.mock.calls[0];
    expect(String(sql)).toMatch(/update business_supporter_fulfilment/i);
    expect(String(sql)).toMatch(/set\s+invited_at\s*=\s*now\(\)/i);
    // The idempotency guard: only a row that has not already been invited is ever stamped.
    expect(String(sql)).toMatch(/where\s+id\s*=\s*\$1\s+and\s+invited_at\s+is\s+null/i);
    expect(params).toEqual([7]);
  });

  it("is a no-op when already invited (the guard matches zero rows → returns false)", async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    expect(await markFulfilmentInvited(7)).toBe(false);
    // Still exactly one UPDATE — the guard, not a prior read, enforces the no-op.
    expect(queryMock).toHaveBeenCalledTimes(1);
  });
});

describe("listUninvitedBusinessSupporters — the un-invited gate (TASK-214)", () => {
  it("selects only invited_at IS NULL + captured_at IS NULL + has-email + has-token rows, mapped", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        { id: 1, token: "tok-1", band: "gold", email: "a@biz.test", business_name: "Bean There", full_name: "Jo Trader" },
        { id: 2, token: "tok-2", band: "bronze", email: "b@biz.test", business_name: null, full_name: "Sam Sole" },
      ],
      rowCount: 2,
    });
    const rows = await listUninvitedBusinessSupporters();

    const [sql] = queryMock.mock.calls[0];
    expect(String(sql)).toMatch(/from business_supporter_fulfilment/i);
    expect(String(sql)).toMatch(/join\s+donors/i);
    expect(String(sql)).toMatch(/invited_at is null/i);
    expect(String(sql)).toMatch(/captured_at is null/i);
    expect(String(sql)).toMatch(/token is not null/i);
    expect(String(sql)).toMatch(/dn\.email is not null/i);
    expect(String(sql)).toMatch(/dn\.email <> ''/i);

    // business_name is the greeting name, falling back to full_name when it is null (row 2).
    expect(rows).toEqual([
      { fulfilmentId: 1, token: "tok-1", band: "gold", email: "a@biz.test", name: "Bean There" },
      { fulfilmentId: 2, token: "tok-2", band: "bronze", email: "b@biz.test", name: "Sam Sole" },
    ]);
  });

  it("returns an empty list when nobody is un-invited (drives the second-run-sends-0 case)", async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    expect(await listUninvitedBusinessSupporters()).toEqual([]);
  });
});

describe("runBusinessInviteBackfill — pure orchestration over injected seams (TASK-214)", () => {
  const baseUrl = "https://nbcc.test";
  const from = "giving@nbcc.scot";
  const actor = "admin:kenny@nbcc.test";

  const supporter = (o: Partial<{ fulfilmentId: number; token: string; band: string; email: string; name: string }> = {}) => ({
    fulfilmentId: 1,
    token: "tok-1",
    band: "gold" as const,
    email: "a@biz.test",
    name: "Bean There",
    ...o,
  });

  function makeDeps(overrides: Partial<BusinessInviteBackfillDeps> = {}): BusinessInviteBackfillDeps {
    return {
      listUninvited: vi.fn(async () => []),
      sendInvite: vi.fn(async () => undefined),
      markInvited: vi.fn(async () => true),
      recordAudit: vi.fn(async () => undefined),
      baseUrl,
      from,
      actor,
      ...overrides,
    };
  }

  it("sends the env-correct tokenised invite to each un-invited supporter, marks each, audits a summary", async () => {
    const deps = makeDeps({
      listUninvited: vi.fn(async () => [
        supporter({ fulfilmentId: 1, token: "tok-1", name: "Bean There", email: "a@biz.test" }),
        supporter({ fulfilmentId: 2, token: "tok-2", name: "Acme Ltd", email: "b@biz.test" }),
      ]),
    });

    const result = await runBusinessInviteBackfill(deps);
    expect(result).toEqual({ pending: 2, sent: 2, failed: 0 });

    // Each send goes out From/Reply-To the giving inbox with the env-correct tokenised link + subject.
    expect(deps.sendInvite).toHaveBeenCalledTimes(2);
    const m0 = (deps.sendInvite as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(m0.email).toBe("a@biz.test");
    expect(m0.from).toBe(from);
    expect(m0.replyTo).toBe(from);
    expect(m0.subject).toContain("Bean There");
    expect(m0.html).toContain('href="https://nbcc.test/business/thank-you?token=tok-1"');
    expect(m0.text).toContain("https://nbcc.test/business/thank-you?token=tok-1");

    // Each supporter is stamped invited (only after its send succeeded).
    expect((deps.markInvited as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])).toEqual([1, 2]);

    // Exactly one summary audit row for the whole run.
    expect(deps.recordAudit).toHaveBeenCalledOnce();
    expect((deps.recordAudit as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
      actor,
      action: "fulfilment.backfill_invites",
      entity: "business_supporter_fulfilment",
      entityId: null,
      data: { pending: 2, sent: 2, failed: 0 },
    });
  });

  it("sends 0 (and marks nobody) when there are no un-invited supporters — an idempotent second run", async () => {
    const deps = makeDeps(); // listUninvited → []
    const result = await runBusinessInviteBackfill(deps);
    expect(result).toEqual({ pending: 0, sent: 0, failed: 0 });
    expect(deps.sendInvite).not.toHaveBeenCalled();
    expect(deps.markInvited).not.toHaveBeenCalled();
    // The run is still recorded (an empty summary row).
    expect(deps.recordAudit).toHaveBeenCalledOnce();
  });

  it("counts a failed send, does NOT mark that supporter invited, and does NOT abort the rest of the run", async () => {
    const deps = makeDeps({
      listUninvited: vi.fn(async () => [
        supporter({ fulfilmentId: 1, token: "tok-1", email: "fail@biz.test" }),
        supporter({ fulfilmentId: 2, token: "tok-2", email: "ok@biz.test" }),
      ]),
      sendInvite: vi.fn(async (msg: { email: string }) => {
        if (msg.email === "fail@biz.test") throw new Error("relay 500");
      }),
    });

    const result = await runBusinessInviteBackfill(deps);
    expect(result).toEqual({ pending: 2, sent: 1, failed: 1 });
    // Only the supporter whose send succeeded (id 2) is stamped invited; the failed one (id 1) is left
    // un-invited so a later run retries it.
    expect((deps.markInvited as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])).toEqual([2]);
    // The failure did not stop the second send.
    expect(deps.sendInvite).toHaveBeenCalledTimes(2);
  });
});
