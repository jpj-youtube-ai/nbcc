import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const { query } = vi.hoisted(() => ({ query: vi.fn(async () => ({ rowCount: 2, rows: [] })) }));
vi.mock("../../src/db/pool", () => ({ pool: { query, connect: vi.fn() } }));
vi.mock("../../src/config", () => ({ config: { NODE_ENV: "test" } }));

import { signPledgeToken, verifyPledgeToken } from "../../src/pledges/token";
import { eraseEmailLogFor } from "../../src/db/email-log";

// Sponsor pledges, after review: a link made to CONFIRM a pledge never pays or cancels one (and the
// other way round); the email log forgets a sponsor when their pledge is anonymised; and the pledge
// emails are logged without the sponsor's name.

const ROOT = resolve(__dirname, "../..");
const SECRET = "a-test-secret-that-is-not-real";

describe("what a pledge link is for", () => {
  it("a confirm link only confirms, and a pay link only pays", () => {
    const confirm = signPledgeToken(5, "nonce-a", SECRET, "confirm");
    const pay = signPledgeToken(5, "nonce-a", SECRET);
    expect(confirm).not.toBe(pay);
    expect(verifyPledgeToken(confirm, () => "nonce-a", SECRET, "confirm")).toBe(5);
    expect(verifyPledgeToken(confirm, () => "nonce-a", SECRET)).toBeNull();
    expect(verifyPledgeToken(pay, () => "nonce-a", SECRET, "confirm")).toBeNull();
    expect(verifyPledgeToken(pay, () => "nonce-a", SECRET, "pay")).toBe(5);
  });
});

describe("the email log and a sponsor's details", () => {
  it("can forget one address for just some kinds of email", async () => {
    expect(await eraseEmailLogFor("Alex@Example.com", ["fundraisePledgePay", "fundraisePledgeReminder"])).toBe(2);
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toMatch(/DELETE FROM email_log WHERE recipient = lower\(\$1\) AND kind = ANY\(\$2\)/);
    expect(params).toEqual(["Alex@Example.com", ["fundraisePledgePay", "fundraisePledgeReminder"]]);
  });

  it("still forgets every row for an address when no kinds are given", async () => {
    query.mockClear();
    await eraseEmailLogFor("alex@example.com");
    expect((query.mock.calls[0] as unknown as [string])[0]).toBe("DELETE FROM email_log WHERE recipient = lower($1)");
  });

  it("logs the pledge emails with no name, and names every kind for the admin's Email audit", () => {
    const client = readFileSync(resolve(ROOT, "src/clients/email.ts"), "utf8");
    for (const kind of ["fundraisePledgeConfirm", "fundraisePledgePay", "fundraisePledgeReminder"]) {
      expect(client).toContain(`sendVerbatim("${kind}", null, message)`);
    }
    expect(client).toContain('sendVerbatim("fundraisePledgeStaff", null, message)');
    // The note to the events inbox is staff only: its links are never tagged.
    expect(readFileSync(resolve(ROOT, "src/email/tracked-links.ts"), "utf8")).toContain('"fundraisePledgeStaff"');
  });
});
