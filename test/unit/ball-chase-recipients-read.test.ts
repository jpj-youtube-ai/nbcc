import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// TASK-576: reading the volunteers' list back. A stored list that no longer passes the rules goes to
// nobody, and says so in the logs (without any address in the message). Invented addresses only.

const m = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../../src/db/pool", () => ({ pool: { query: m.query, connect: vi.fn() } }));
vi.mock("../../src/db/donations", () => ({ insertAudit: vi.fn() }));

import { getChaseRecipients, listRecentChaseSends } from "../../src/db/ball-chase";

let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  m.query.mockReset();
  errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => errors.mockRestore());

describe("getChaseRecipients", () => {
  it("returns a good list, tidied, and says nothing", async () => {
    m.query.mockResolvedValue({ rows: [{ chase_recipients: [{ name: "Amy Example", email: "Amy.Example@nbcc.scot" }] }] });
    expect(await getChaseRecipients()).toEqual([{ name: "Amy Example", email: "amy.example@nbcc.scot" }]);
    expect(errors).not.toHaveBeenCalled();
  });

  it("returns nobody for a stored list that fails the rules, and logs it without the addresses", async () => {
    m.query.mockResolvedValue({ rows: [{ chase_recipients: [{ name: "Sam Example", email: "sam.example@example.com" }] }] });
    expect(await getChaseRecipients()).toEqual([]);
    expect(errors).toHaveBeenCalledTimes(1);
    const said = String(errors.mock.calls[0][0]);
    expect(said).toContain("volunteers' list");
    expect(said).not.toContain("sam.example");
    expect(said).not.toContain("example.com");
  });

  it("returns nobody for no list at all, without alarm", async () => {
    m.query.mockResolvedValue({ rows: [] });
    expect(await getChaseRecipients()).toEqual([]);
    expect(errors).not.toHaveBeenCalled();
  });
});

describe("listRecentChaseSends", () => {
  it("names the sends by kind and day, newest first, as the query gave them", async () => {
    m.query.mockResolvedValue({
      rows: [
        { kind: "list", sent_on: "2026-10-28", n: 1 },
        { kind: "reminder", sent_on: "2026-10-28", n: 23 },
      ],
    });
    expect(await listRecentChaseSends()).toEqual([
      { kind: "list", sentOn: "2026-10-28", count: 1 },
      { kind: "reminder", sentOn: "2026-10-28", count: 23 },
    ]);
    const [sql, args] = m.query.mock.calls[0];
    expect(String(sql)).toContain("status = 'sent'");
    expect(args).toEqual([5]);
  });
});
