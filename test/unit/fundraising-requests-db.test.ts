import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-505: the SQL behind the requests, against a mocked pool (no database). A change locks its
// fundraiser, reads the request as stored, applies the pure rules (src/fundraising/requests.ts),
// writes one row per fundraiser and kind, and records it in audit_log, all in one transaction.
// Every name and number is invented.

const { query, connect } = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn() }));
vi.mock("../../src/db/pool", () => ({ pool: { query, connect } }));
vi.mock("../../src/config", () => ({ config: { NODE_ENV: "test" } }));

import { changeRequest, listRequestRows, listRequestRowsFor, RequestError } from "../../src/db/fundraising-requests";

type Answer = (sql: string, params: unknown[]) => unknown;
function useClient(answer: Answer) {
  const calls: Array<[string, unknown[]]> = [];
  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push([sql, params]);
      return answer(sql, params) ?? { rows: [] };
    }),
    release: vi.fn(),
  };
  connect.mockResolvedValue(client);
  return { calls, client };
}
const sqlIn = (calls: Array<[string, unknown[]]>, re: RegExp) => calls.find((c) => re.test(c[0]));
const audits = (calls: Array<[string, unknown[]]>) => calls.filter((c) => /INSERT INTO audit_log/.test(c[0])).map((c) => c[1]);

const fundraiserRow = (over: Record<string, unknown> = {}) => ({
  id: 9,
  status: "approved",
  social_ok: true,
  event_date: "2026-12-12",
  wants: { posterCount: 10, bucketCount: 2 },
  ...over,
});
const stored = (over: Record<string, unknown> = {}) => ({
  fundraiser_id: 9,
  kind: "posters",
  status: "sent",
  quantity: 10,
  quantity_back: null,
  how: "post",
  sent_on: "2026-12-03",
  back_on: null,
  done_on: null,
  handled_by: "Fern",
  going: null,
  note: null,
  back_note: null,
  link: null,
  updated_at: new Date("2026-12-03T10:00:00Z"),
  updated_by: "admin:fern@example.com",
  ...over,
});

beforeEach(() => {
  query.mockReset().mockResolvedValue({ rows: [] });
  connect.mockReset();
});

describe("reading", () => {
  it("reads every request, with its dates as UK days", async () => {
    query.mockResolvedValue({ rows: [stored()] });
    const rows = await listRequestRows();
    expect(query.mock.calls[0][0]).toMatch(/to_char\(sent_on, 'YYYY-MM-DD'\)/);
    expect(rows).toEqual([
      {
        fundraiserId: 9,
        kind: "posters",
        status: "sent",
        quantity: 10,
        quantityBack: null,
        how: "post",
        sentOn: "2026-12-03",
        backOn: null,
        doneOn: null,
        handledBy: "Fern",
        going: null,
        note: null,
        backNote: null,
        link: null,
        updatedAt: "2026-12-03T10:00:00.000Z",
        updatedBy: "admin:fern@example.com",
      },
    ]);
  });

  it("reads one fundraiser's requests by its id", async () => {
    await listRequestRowsFor(9);
    expect(query.mock.calls[0][0]).toMatch(/WHERE fundraiser_id = \$1/);
    expect(query.mock.calls[0][1]).toEqual([9]);
  });
});

describe("changing one", () => {
  const SEND = { action: "send" as const, from: "to_send" as const, on: "2026-12-03", how: "post" as const, by: "Fern", quantity: 8, note: "Second class" };

  it("locks the fundraiser, writes the new step and records who did what, in one transaction", async () => {
    const { calls, client } = useClient((sql) => {
      if (/FROM fundraisers/.test(sql)) return { rows: [fundraiserRow()] };
      if (/INSERT INTO fundraiser_requests/.test(sql)) return { rows: [stored({ quantity: 8, note: "Second class" })] };
      return undefined;
    });
    const out = await changeRequest(9, "posters", SEND, "admin:fern@example.com", "2026-12-07");
    expect(calls[0][0]).toBe("BEGIN");
    expect(sqlIn(calls, /FROM fundraisers/)![0]).toMatch(/FOR UPDATE/);
    expect(sqlIn(calls, /FROM fundraiser_requests/)![0]).toMatch(/FOR UPDATE/);
    const write = sqlIn(calls, /INSERT INTO fundraiser_requests/)!;
    expect(write[0]).toMatch(/ON CONFLICT \(fundraiser_id, kind\) DO UPDATE/);
    expect(write[1]).toEqual([9, "posters", "sent", 8, null, "post", "2026-12-03", null, null, "Fern", null, "Second class", null, null, "admin:fern@example.com"]);
    expect(audits(calls)).toEqual([
      [
        "admin:fern@example.com",
        "fundraiser.request_updated",
        "fundraiser",
        9,
        {
          kind: "posters",
          action: "send",
          from: "to_send",
          to: "sent",
          words: "Posters: sent (by post)",
          entered: { on: "2026-12-03", how: "post", by: "Fern", quantity: 8, note: "Second class" },
        },
      ],
    ]);
    expect(calls[calls.length - 1][0]).toBe("COMMIT");
    expect(client.release).toHaveBeenCalled();
    expect(out.row).toMatchObject({ kind: "posters", status: "sent", quantity: 8 });
    expect(out.words).toBe("Posters: sent (by post)");
  });

  it("records what an Undo cleared", async () => {
    const { calls } = useClient((sql) => {
      if (/FROM fundraisers/.test(sql)) return { rows: [fundraiserRow()] };
      if (/FROM fundraiser_requests/.test(sql)) return { rows: [stored()] };
      if (/INSERT INTO fundraiser_requests/.test(sql)) return { rows: [stored({ status: "to_send", quantity: null, how: null, sent_on: null, handled_by: null })] };
      return undefined;
    });
    await changeRequest(9, "posters", { action: "undo", from: "sent" }, "admin:fern@example.com", "2026-12-07");
    const data = audits(calls)[0][4] as Record<string, unknown>;
    expect(data).toMatchObject({ action: "undo", from: "sent", to: "to_send", words: "Posters: undone, back to To send" });
    expect(data.before).toMatchObject({ status: "sent", quantity: 10, how: "post", sentOn: "2026-12-03", handledBy: "Fern" });
  });

  it("says not found, and writes nothing, for a fundraiser that is not there", async () => {
    const { calls } = useClient(() => undefined);
    await expect(changeRequest(9, "posters", SEND, "admin:fern@example.com", "2026-12-07")).rejects.toMatchObject({ reason: "not_found" });
    expect(sqlIn(calls, /INSERT INTO/)).toBeUndefined();
    expect(calls[calls.length - 1][0]).toBe("ROLLBACK");
  });

  it("refuses a change from an out of date screen, and writes nothing", async () => {
    const { calls } = useClient((sql) => {
      if (/FROM fundraisers/.test(sql)) return { rows: [fundraiserRow()] };
      if (/FROM fundraiser_requests/.test(sql)) return { rows: [stored()] };
      return undefined;
    });
    const err = await changeRequest(9, "posters", SEND, "admin:fern@example.com", "2026-12-07").catch((e) => e);
    expect(err).toBeInstanceOf(RequestError);
    expect(err).toMatchObject({ reason: "conflict" });
    expect(sqlIn(calls, /INSERT INTO/)).toBeUndefined();
  });

  it("passes on which field is wrong", async () => {
    useClient((sql) => (/FROM fundraisers/.test(sql) ? { rows: [fundraiserRow()] } : undefined));
    const err = await changeRequest(9, "posters", { ...SEND, on: "2026-12-08" }, "admin:fern@example.com", "2026-12-07").catch((e) => e);
    expect(err).toMatchObject({ reason: "invalid", field: "on", message: "That date is still to come." });
  });
});
