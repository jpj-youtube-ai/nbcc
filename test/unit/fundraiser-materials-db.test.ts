import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-512: the SQL behind round two of the materials, against a mocked pool (no database).
//   - a fundraiser's scans per printed piece, counted from the site's visit counter (analytics_views,
//     channel 'qr', the piece's tag), once per person per day;
//   - an organiser's "Ask us to print these": the fundraiser locked, its wants and its posters or
//     leaflets request written, and an audit_log row, in one transaction.
// Every name and number is invented.

const { query, connect } = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn() }));
vi.mock("../../src/db/pool", () => ({ pool: { query, connect } }));
vi.mock("../../src/config", () => ({ config: { NODE_ENV: "test" } }));

import { askToPrint, fundraiserTitles, lastPrintAsks, materialScans, PrintAskError } from "../../src/db/fundraiser-materials";

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

beforeEach(() => {
  query.mockReset();
  connect.mockReset();
});

describe("scans per piece", () => {
  it("counts a fundraiser's three tags among the QR code visits, once per person per day", async () => {
    query.mockResolvedValue({ rows: [{ campaign: "f12-a4", scans: 3 }] });
    const rows = await materialScans(12);
    expect(rows).toEqual([{ campaign: "f12-a4", scans: 3 }]);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/FROM analytics_views/);
    expect(sql).toMatch(/channel = 'qr'/);
    expect(sql).toMatch(/count\(DISTINCT visitor \|\| '@' \|\| day::text\)/);
    expect(params).toEqual([["f12-a4", "f12-a3", "f12-a5"]]);
  });

  it("looks titles up by id for Analytics' labels, and asks nothing for none", async () => {
    expect(await fundraiserTitles([])).toEqual(new Map());
    expect(query).not.toHaveBeenCalled();
    query.mockResolvedValue({ rows: [{ id: 12, title: "Sam's Santa Dash" }] });
    expect(await fundraiserTitles([12, 12])).toEqual(new Map([[12, "Sam's Santa Dash"]]));
    expect(query.mock.calls[0][1]).toEqual([[12]]);
    // Only those with materials: a new or declined sign up is never named in Analytics.
    expect(query.mock.calls[0][0]).toContain("status IN ('approved', 'finished')");
  });
});

describe("asking us to print", () => {
  const fundraiser = (over: Record<string, unknown> = {}) => ({
    id: 12,
    status: "approved",
    event_date: "2026-12-05",
    wants: { posterCount: 0, bucketCount: 2 },
    post_line1: "1 Example Street",
    post_address: null,
    ...over,
  });

  it("locks the fundraiser, sets how many it wants, writes the request To send and audits it, together", async () => {
    const { calls, client } = useClient((sql) => {
      if (/FROM fundraisers WHERE id = \$1 FOR UPDATE/.test(sql)) return { rows: [fundraiser()] };
      return { rows: [] };
    });
    const r = await askToPrint(12, { kind: "posters", a4: 10, a3: 2 }, "organiser", "2026-10-03");
    expect(r.words).toBe("Posters: they asked us to print 10 A4 posters and 2 A3 posters");
    const sqls = calls.map((c) => c[0]);
    expect(sqls[0]).toBe("BEGIN");
    expect(sqls.at(-1)).toBe("COMMIT");
    const wants = calls.find((c) => /UPDATE fundraisers SET wants/.test(c[0]));
    expect(wants?.[0]).toMatch(/jsonb_set\(COALESCE\(wants, '\{\}'::jsonb\), \$2::text\[\], to_jsonb\(\$3::int\)\)/);
    expect(wants?.[1]).toEqual([12, ["posterCount"], 12]);
    const req = calls.find((c) => /INSERT INTO fundraiser_requests/.test(c[0]));
    expect(req?.[1].slice(0, 3)).toEqual([12, "posters", "to_send"]);
    expect(req?.[1]).toContain("Asked in their private area on 3 Oct: 10 A4 posters and 2 A3 posters.");
    const audit = calls.find((c) => /INSERT INTO audit_log/.test(c[0]));
    expect(audit?.[1][0]).toBe("organiser");
    expect(audit?.[1][1]).toBe("fundraiser.print_requested");
    expect(audit?.[1][3]).toBe(12);
    expect(audit?.[1][4]).toMatchObject({ kind: "posters", a4: 10, a3: 2, words: r.words, asked: "10 A4 posters and 2 A3 posters" });
    expect(audit?.[1][4]).toMatchObject({ before: null });
    expect(client.release).toHaveBeenCalled();
  });

  // TASK-512 review: like Undo, the request as it stood before is kept in the History.
  it("keeps the request as it stood before in the audit row", async () => {
    const { calls } = useClient((sql) => {
      if (/FROM fundraisers WHERE id = \$1 FOR UPDATE/.test(sql)) return { rows: [fundraiser()] };
      if (/FROM fundraiser_requests WHERE fundraiser_id/.test(sql)) {
        return { rows: [{ fundraiser_id: 12, kind: "posters", status: "sent", quantity: 10, quantity_back: null, how: "post", sent_on: "2026-10-01", back_on: null, done_on: null, handled_by: "Robin", going: null, note: null, back_note: null, link: null, updated_at: null, updated_by: "admin:kim@example.com" }] };
      }
      return { rows: [] };
    });
    await askToPrint(12, { kind: "posters", a4: 5, a3: 0 }, "organiser", "2026-10-03");
    const audit = calls.find((c) => /INSERT INTO audit_log/.test(c[0]));
    expect(audit?.[1][4]).toMatchObject({ before: { status: "sent", quantity: 10, sentOn: "2026-10-01", handledBy: "Robin", how: "post" } });
  });

  it("writes nothing when the fundraiser is past asking", async () => {
    const { calls } = useClient((sql) => (/FOR UPDATE/.test(sql) && /fundraisers/.test(sql) ? { rows: [fundraiser({ status: "finished" })] } : { rows: [] }));
    await expect(askToPrint(12, { kind: "leaflets", a5: 20 }, "organiser", "2026-10-03")).rejects.toBeInstanceOf(PrintAskError);
    expect(calls.some((c) => /INSERT|UPDATE fundraisers/.test(c[0]))).toBe(false);
    expect(calls.at(-1)?.[0]).toBe("ROLLBACK");
  });

  it("says so when there is nowhere to post them", async () => {
    const { calls } = useClient((sql) =>
      /FROM fundraisers WHERE id = \$1 FOR UPDATE/.test(sql) ? { rows: [fundraiser({ post_line1: null, post_address: null })] } : { rows: [] },
    );
    await askToPrint(12, { kind: "leaflets", a5: 20 }, "organiser", "2026-10-03");
    const req = calls.find((c) => /INSERT INTO fundraiser_requests/.test(c[0]));
    expect(String(req?.[1].find((v) => typeof v === "string" && v.startsWith("Asked")))).toMatch(/no address/);
  });

  it("reads each kind's last ask back from the audit log", async () => {
    query.mockResolvedValue({
      rows: [
        { kind: "posters", asked: "6 A4 posters", asked_on: "2026-10-03" },
        { kind: "leaflets", asked: "50 A5 leaflets", asked_on: "2026-10-01" },
      ],
    });
    expect(await lastPrintAsks(12)).toEqual([
      { kind: "posters", words: "6 A4 posters", on: "2026-10-03" },
      { kind: "leaflets", words: "50 A5 leaflets", on: "2026-10-01" },
    ]);
    expect(query.mock.calls[0][0]).toMatch(/DISTINCT ON \(data->>'kind'\)/);
    expect(query.mock.calls[0][0]).toMatch(/action = 'fundraiser.print_requested'/);
  });
});
