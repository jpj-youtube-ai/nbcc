import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PoolClient } from "pg";

// TASK-213: ensureFulfilmentRecord must tell the caller whether it actually INSERTED the row (a NEW
// business supporter) or hit the ON CONFLICT (donor_id) DO NOTHING and re-read an existing one. The
// webhook uses that `created` flag to audit `fulfilment.created` and send the thank-you invite ONCE,
// only on the newly created record. DB-free: we drive a fake PoolClient and assert the queries +
// the returned { id, created } (the pool/config are mocked only so importing the module never boots
// the real DB — ensureFulfilmentRecord itself uses the passed client, not the module pool).

vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));
vi.mock("../../src/config", () => ({
  config: { NODE_ENV: "development", DATABASE_URL: "postgres://localhost:5432/test" },
}));

import { ensureFulfilmentRecord } from "../../src/db/fulfilment";

const queryMock = vi.fn();
const client = { query: queryMock } as unknown as PoolClient;

beforeEach(() => {
  queryMock.mockReset();
});

describe("ensureFulfilmentRecord — created vs conflict", () => {
  it("returns { created: true } and the inserted id on a fresh donor (INSERT ... RETURNING yields a row)", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: 42 }], rowCount: 1 }); // the INSERT returned a row

    const result = await ensureFulfilmentRecord(client, {
      donorId: 10,
      band: "gold",
      token: "tok-abc",
    });

    expect(result).toEqual({ id: 42, created: true });
    // A successful insert needs exactly ONE query — no re-select.
    expect(queryMock).toHaveBeenCalledTimes(1);
    const [sql, params] = queryMock.mock.calls[0];
    expect(String(sql)).toMatch(/insert into business_supporter_fulfilment/i);
    expect(String(sql)).toMatch(/on conflict \(donor_id\) do nothing/i);
    expect(String(sql)).toMatch(/returning id/i);
    expect(params).toEqual([10, "gold", "tok-abc"]);
  });

  it("returns { created: false } and the existing id on a conflict (INSERT yields no row, re-select finds it)", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // ON CONFLICT DO NOTHING → no row
      .mockResolvedValueOnce({ rows: [{ id: 7 }], rowCount: 1 }); // re-select the pre-existing row

    const result = await ensureFulfilmentRecord(client, {
      donorId: 10,
      band: "gold",
      token: "tok-new",
    });

    expect(result).toEqual({ id: 7, created: false });
    // Insert (no row) then a re-select by donor id.
    expect(queryMock).toHaveBeenCalledTimes(2);
    const [selectSql, selectParams] = queryMock.mock.calls[1];
    expect(String(selectSql)).toMatch(/select id from business_supporter_fulfilment where donor_id = \$1/i);
    expect(selectParams).toEqual([10]);
  });
});
