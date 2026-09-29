import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-431: sending ONE business supporter their catch-up invite.
//
// The only way to send a catch-up invite until now was the TASK-214 backfill button, which emails
// every un-invited supporter at once. That is the right tool for its job and the wrong one for
// "RMC Double Glazing has been paying since May and nobody ever wrote to them" — which is exactly
// what happened, and what this is for.
//
// Deliberately NOT a second send path. It reuses runBusinessInviteBackfill unchanged, by handing it
// a list of one, so an individual invite goes through the same build, the same send, the same
// send-then-stamp ordering and the same audit as the bulk run. A parallel implementation would be a
// second place for the double-send bug to live.

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock("../../src/db/pool", () => ({ pool: { query: queryMock, connect: vi.fn() } }));
vi.mock("../../src/config", () => ({
  config: { NODE_ENV: "development", DATABASE_URL: "postgres://localhost:5432/test" },
}));

import { getUninvitedBusinessSupporter } from "../../src/db/fulfilment";
import { runBusinessInviteBackfill, type BusinessInviteBackfillDeps } from "../../src/business/backfill";

beforeEach(() => {
  queryMock.mockReset();
});

describe("getUninvitedBusinessSupporter — one supporter, same gate as the bulk list", () => {
  it("applies the identical un-invited gate, narrowed to one id", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ id: 12, token: "tok-rmc", band: "platinum", email: "stephanie@example.test", business_name: "RMC Double Glazing (Ayr) Ltd", full_name: "Stephanie" }],
      rowCount: 1,
    });

    const row = await getUninvitedBusinessSupporter(12);

    const [sql, params] = queryMock.mock.calls[0];
    // Every condition the bulk list uses must be here too. If the individual send were allowed to
    // skip one of them, the "send to just this one" button would become the way to double-email a
    // supporter who already has their link.
    expect(String(sql)).toMatch(/invited_at is null/i);
    expect(String(sql)).toMatch(/captured_at is null/i);
    expect(String(sql)).toMatch(/token is not null/i);
    expect(String(sql)).toMatch(/email\s+is not null/i);
    expect(String(sql)).toMatch(/f\.id\s*=\s*\$1/i);
    expect(params).toEqual([12]);

    expect(row).toEqual({
      fulfilmentId: 12,
      token: "tok-rmc",
      band: "platinum",
      email: "stephanie@example.test",
      name: "RMC Double Glazing (Ayr) Ltd",
    });
  });

  it("returns null when the supporter is already invited, so the button cannot re-send", async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    expect(await getUninvitedBusinessSupporter(12)).toBeNull();
  });

  it("falls back to the person's name when there is no business name, like the bulk list", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ id: 3, token: "t", band: "bronze", email: "s@biz.test", business_name: "   ", full_name: "Sam Sole" }],
      rowCount: 1,
    });
    expect((await getUninvitedBusinessSupporter(3))?.name).toBe("Sam Sole");
  });
});

describe("sending to one supporter reuses the bulk run", () => {
  const supporter = {
    fulfilmentId: 12,
    token: "tok-rmc",
    band: "platinum" as const,
    email: "stephanie@example.test",
    name: "RMC Double Glazing (Ayr) Ltd",
  };

  const deps = (over: Partial<BusinessInviteBackfillDeps> = {}): BusinessInviteBackfillDeps => ({
    listUninvited: async () => [supporter],
    sendInvite: vi.fn(async () => {}),
    markInvited: vi.fn(async () => true),
    recordAudit: vi.fn(async () => {}),
    baseUrl: "https://nbcc.scot",
    from: "giving@nbcc.scot",
    actor: "admin:jaimie@example.test",
    ...over,
  });

  it("emails exactly that one supporter, and stamps them invited", async () => {
    const d = deps();
    const result = await runBusinessInviteBackfill(d);

    expect(result).toEqual({ pending: 1, sent: 1, failed: 0 });
    expect(d.sendInvite).toHaveBeenCalledTimes(1);
    expect(d.markInvited).toHaveBeenCalledWith(12);

    const [message] = (d.sendInvite as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(message.email).toBe("stephanie@example.test");
    // The real branded builder ran, on the real base, with this supporter's own token.
    expect(message.html).toContain("https://nbcc.scot");
    expect(message.html).toContain("tok-rmc");
    expect(message.html).toContain("RMC Double Glazing (Ayr) Ltd");
  });

  it("sends nothing at all when the supporter is already invited", async () => {
    const d = deps({ listUninvited: async () => [] });
    expect(await runBusinessInviteBackfill(d)).toEqual({ pending: 0, sent: 0, failed: 0 });
    expect(d.sendInvite).not.toHaveBeenCalled();
  });

  // A failed send must leave invited_at NULL so the supporter can be tried again. Stamping first
  // would lose them silently, which for a supporter nobody has written to in four months is the
  // worst available outcome.
  it("does not stamp invited when the send fails", async () => {
    const d = deps({ sendInvite: vi.fn(async () => { throw new Error("relay down"); }) });
    expect(await runBusinessInviteBackfill(d)).toEqual({ pending: 1, sent: 0, failed: 1 });
    expect(d.markInvited).not.toHaveBeenCalled();
  });
});

describe("the audit row says which kind of send it was", () => {
  const supporter = { fulfilmentId: 12, token: "t", band: "platinum" as const, email: "a@b.test", name: "RMC" };
  const base = {
    listUninvited: async () => [supporter],
    sendInvite: async () => {},
    markInvited: async () => true,
    baseUrl: "https://nbcc.scot",
    from: "giving@nbcc.scot",
    actor: "admin:jaimie@example.test",
  };

  it("still records the bulk run as fulfilment.backfill_invites when nothing is overridden", async () => {
    const recordAudit = vi.fn(async () => {});
    await runBusinessInviteBackfill({ ...base, recordAudit });
    expect(recordAudit.mock.calls[0][0]).toMatchObject({
      action: "fulfilment.backfill_invites",
      entityId: null,
    });
  });

  // Otherwise the log reads as though someone clicked the bulk backfill, and "who did we email, and
  // why" stops being answerable from the audit trail.
  it("records an individual send under its own action, against that supporter", async () => {
    const recordAudit = vi.fn(async () => {});
    await runBusinessInviteBackfill({
      ...base,
      recordAudit,
      auditAction: "fulfilment.send_invite",
      auditEntityId: 12,
    });
    expect(recordAudit.mock.calls[0][0]).toMatchObject({
      action: "fulfilment.send_invite",
      entity: "business_supporter_fulfilment",
      entityId: 12,
      actor: "admin:jaimie@example.test",
      data: { pending: 1, sent: 1, failed: 0 },
    });
  });
});
