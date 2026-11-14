import { describe, it, expect, vi, beforeEach } from "vitest";

// Admin refresh (2026-11-14): what Contact businesses and the one business page ask the server.
//   GET   /api/admin/outreach?limit=&offset=   a page of the list, with the true total, the counts
//                                               over every business, and each row's latest note
//   GET   /api/admin/outreach/:id               gains what to do next, and the supporter they became
//   PATCH /api/admin/outreach/:id               change the details of a business (edit; audited)
// DB-free, as admin-business-calls-api.test.ts is: the pool, the per-request auth row and config
// are mocked. Every business, person, address and number here is invented.

const { queryMock, clientQueryMock, mockClient, connect, getUserAuthRowMock } = vi.hoisted(() => {
  const queryMock = vi.fn();
  const clientQueryMock = vi.fn();
  const mockClient = { query: clientQueryMock, release: vi.fn() };
  const connect = vi.fn(async () => mockClient);
  const getUserAuthRowMock = vi.fn();
  return { queryMock, clientQueryMock, mockClient, connect, getUserAuthRowMock };
});
vi.mock("../../src/db/pool", () => ({ pool: { query: queryMock, connect } }));
vi.mock("../../src/db/admin-users", () => ({ getUserAuthRow: getUserAuthRowMock }));
vi.mock("../../src/config", () => ({
  config: {
    NODE_ENV: "development",
    DATABASE_URL: "postgres://localhost:5432/test",
    ADMIN_SESSION_SECRET: "test-admin-secret",
    STRIPE_SECRET_KEY: "sk_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    STRIPE_WEBHOOK_SECRET: "whsec_placeholder",
  },
}));
vi.mock("../../src/clients/stripe", () => ({ cancelSubscription: vi.fn() }));

import { getAdminOutreach, getAdminOutreachOne, patchAdminOutreach } from "../../src/routes/admin";
import { signAdminSession } from "../../src/admin/session";
import type { PermissionMap } from "../../src/admin/permissions";

const SECRET = "test-admin-secret";
const ME = "fern@example.com";
let authRow: { id: number; email: string; status: string; role: string; permissions: PermissionMap };
const tokenFor = (role: string) => {
  authRow = { ...authRow, role };
  return signAdminSession({ sub: 1, email: ME, role, now: new Date(), secret: SECRET }).token;
};

type MockRes = { statusCode: number; body: unknown; status: (c: number) => MockRes; json: (b: unknown) => MockRes };
function mockRes(): MockRes {
  const res = { statusCode: 200, body: undefined as unknown } as MockRes;
  res.status = (c) => {
    res.statusCode = c;
    return res;
  };
  res.json = (b) => {
    res.body = b;
    return res;
  };
  return res;
}
type Opts = { id?: string; role?: string; token?: string; body?: unknown; query?: Record<string, string> };
function req(opts: Opts) {
  const headers: Record<string, string> = {};
  const token = opts.token !== undefined ? opts.token : tokenFor(opts.role ?? "editor");
  if (token) headers.authorization = "Bearer " + token;
  return { params: { id: opts.id ?? "4" }, headers, body: opts.body ?? {}, query: opts.query ?? {} };
}
/* eslint-disable @typescript-eslint/no-explicit-any */
async function run(handler: (rq: any, rs: any) => Promise<unknown>, o: Opts) {
  const res = mockRes();
  await handler(req(o) as any, res as any);
  return res;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// One business as the database holds it.
function dbRow(over: Record<string, unknown> = {}) {
  return {
    id: 4, business_name: "Invented Joinery Ltd", contact_name: "Jo Example", contact_email: "jo@inventedjoinery.example",
    contact_phone: "01632 960111", business_type: "company", note: null, owner: "Fern Example", sent_by: null, sent_at: null,
    outcome: null, outcome_at: null, ask_again_on: null, last_engagement_at: null, created_at: "2026-10-01T09:00:00.000Z",
    owner_email: ME, warm_intro: null, ctps_checked_at: "2026-10-05T09:00:00.000Z", ctps_checked_by: ME, donor_id: null,
    sent_with_personal_message: null, nudge_sent_at: null, nudge_sent_by: null, tags: ["chamber"],
    details_source: "website_or_listing", consent_basis: null, consent_basis_recorded_by: null, consent_basis_recorded_at: null,
    ...over,
  };
}

let listRows: Record<string, unknown>[] = [];
let countRows: Record<string, unknown>[] = [];
let noteRows: Record<string, unknown>[] = [];
let one: Record<string, unknown> | null = null;
let known: Record<string, unknown>[] = [];

// Each statement on one line with single spaces, so a test can look for a phrase in it.
const flat = (sql: unknown) => String(sql).split(/\s+/).join(" ");
const calls = (phrase: string) => queryMock.mock.calls.filter((c) => flat(c[0]).includes(phrase));
const LIST = "FROM business_outreach ORDER BY created_at DESC";
const UPDATE = "UPDATE business_outreach SET business_name";
const LATEST_NOTES = "DISTINCT ON (outreach_id)";
const SUPPORTER = "FROM donors WHERE id = $1";
const audits = () => clientQueryMock.mock.calls.filter((c) => flat(c[0]).includes("INSERT INTO audit_log"));

beforeEach(() => {
  queryMock.mockReset();
  clientQueryMock.mockReset();
  mockClient.release.mockClear();
  connect.mockClear();
  authRow = { id: 1, email: ME, status: "active", role: "editor", permissions: {} };
  getUserAuthRowMock.mockReset();
  getUserAuthRowMock.mockImplementation(async () => authRow);
  listRows = [dbRow(), dbRow({ id: 5, business_name: "Pretend Motors", contact_email: null, owner_email: null })];
  countRows = [
    { outcome: null, sent_at: null, owner_email: ME },
    { outcome: null, sent_at: null, owner_email: null },
    { outcome: "signed_up", sent_at: "2026-09-01T09:00:00.000Z", owner_email: null },
  ];
  noteRows = [{ outreach_id: 4, author: ME, body: "Rang and spoke to Jo.", created_at: "2026-10-20T10:00:00.000Z" }];
  one = dbRow();
  known = [];
  queryMock.mockImplementation(async (sql: string, params?: unknown[]) => {
    const s = flat(sql);
    if (s.includes(LIST)) return { rows: listRows, rowCount: listRows.length };
    if (s.includes("SELECT outcome, sent_at, owner_email FROM business_outreach")) return { rows: countRows, rowCount: countRows.length };
    if (s.includes(LATEST_NOTES)) return { rows: noteRows, rowCount: noteRows.length };
    if (s.includes("FROM business_outreach_notes")) return { rows: [], rowCount: 0 };
    if (s.includes(UPDATE)) {
      const p = params as unknown[];
      const cleared = p[9] === true;
      const row = {
        ...(one as Record<string, unknown>), business_name: p[1], contact_name: p[2], contact_email: p[3], contact_phone: p[4],
        warm_intro: p[5], owner: p[6], owner_email: p[7], tags: p[8],
        ...(cleared ? { ctps_checked_at: null, ctps_checked_by: null } : {}),
      };
      return { rows: [row], rowCount: 1 };
    }
    if (s.includes("FROM business_outreach WHERE id = $1")) return one ? { rows: [one], rowCount: 1 } : { rows: [], rowCount: 0 };
    if (s.includes("SELECT id, business_name, contact_email, outcome, sent_at, sent_by FROM business_outreach")) {
      return { rows: known, rowCount: known.length };
    }
    if (s.includes(SUPPORTER)) return { rows: [{ id: 42, name: "Invented Joinery Ltd" }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  clientQueryMock.mockImplementation(async () => ({ rows: [], rowCount: 1 }));
});

type ListBody = {
  results: { id: number; latestNote: { body: string; author: string; createdAt: string } | null }[];
  total: number;
  counts: Record<string, number>;
};

describe("the list of businesses, past the first 200", () => {
  it("asks for the newest 200 when it is not told otherwise", async () => {
    await run(getAdminOutreach, {});
    expect(calls(LIST)[0][1]).toEqual([200, 0]);
  });

  it("asks the database for the page it was asked for", async () => {
    await run(getAdminOutreach, { query: { limit: "50", offset: "400" } });
    expect(calls(LIST)[0][1]).toEqual([50, 400]);
  });

  it("falls back to the first page when the numbers are nonsense, and never asks for more than 500", async () => {
    await run(getAdminOutreach, { query: { limit: "lots", offset: "-5" } });
    expect(calls(LIST)[0][1]).toEqual([200, 0]);
    await run(getAdminOutreach, { query: { limit: "99999", offset: "1.5" } });
    expect(calls(LIST)[1][1]).toEqual([500, 0]);
  });

  it("says how many there are altogether, and counts every business, not only the page", async () => {
    const body = (await run(getAdminOutreach, { query: { limit: "1" } })).body as ListBody;
    expect(body.results).toHaveLength(2);
    expect(body.total).toBe(3);
    expect(body.counts).toMatchObject({ total: 3, waiting: 2, signedUp: 1, mine: 1, emailed: 1, replied: 1 });
  });

  it("puts the latest note on each business that has one", async () => {
    const body = (await run(getAdminOutreach, {})).body as ListBody;
    expect(body.results[0].latestNote).toEqual({ body: "Rang and spoke to Jo.", author: ME, createdAt: "2026-10-20T10:00:00.000Z" });
    expect(body.results[1].latestNote).toBeNull();
    // Only for the businesses on this page.
    expect(calls(LATEST_NOTES)[0][1]).toEqual([[4, 5]]);
  });

  it("does not go looking for notes when the page is empty", async () => {
    listRows = [];
    const body = (await run(getAdminOutreach, { query: { offset: "600" } })).body as ListBody;
    expect(body.results).toEqual([]);
    expect(body.total).toBe(3);
    expect(calls(LATEST_NOTES)).toHaveLength(0);
  });

  it("is for anyone who may see Contact businesses, and nobody else", async () => {
    expect((await run(getAdminOutreach, { role: "viewer" })).statusCode).toBe(200);
    expect((await run(getAdminOutreach, { token: "" })).statusCode).toBe(401);
  });
});

type OneBody = {
  business: Record<string, unknown>;
  notes: unknown[];
  todo: { kind: string; reason: string; action: string } | null;
  supporter: { id: number; name: string } | null;
};

describe("one business says what to do next, in the words of the to do list", () => {
  it("is ready to send when it has an address and has never been emailed", async () => {
    const body = (await run(getAdminOutreachOne, {})).body as OneBody;
    expect(body.todo).toMatchObject({ kind: "send", reason: "Added, with an address, but never emailed.", action: "Send the invitation" });
  });

  it("needs nothing once they have said no", async () => {
    one = dbRow({ outcome: "declined", outcome_at: "2026-10-10T09:00:00.000Z" });
    expect(((await run(getAdminOutreachOne, {})).body as OneBody).todo).toBeNull();
  });

  it("names the supporter they became, when somebody has linked one", async () => {
    one = dbRow({ outcome: "signed_up", donor_id: 42 });
    const body = (await run(getAdminOutreachOne, {})).body as OneBody;
    expect(body.supporter).toEqual({ id: 42, name: "Invented Joinery Ltd" });
  });

  it("names no supporter, and does not look for one, when none is linked", async () => {
    const body = (await run(getAdminOutreachOne, {})).body as OneBody;
    expect(body.supporter).toBeNull();
    expect(calls(SUPPORTER)).toHaveLength(0);
  });
});

type PatchBody = { business?: Record<string, unknown>; error?: string; matches?: unknown[] };
const DETAILS = {
  businessName: "Invented Joinery Ltd", contactName: "Jo Example", contactEmail: "jo@inventedjoinery.example",
  contactPhone: "01632 960111", warmIntro: "", owner: "Fern Example", ownerEmail: ME, tags: "chamber",
};

describe("changing the details of a business", () => {
  it("is refused without a session, and for someone who may only look", async () => {
    expect((await run(patchAdminOutreach, { token: "", body: DETAILS })).statusCode).toBe(401);
    expect((await run(patchAdminOutreach, { role: "viewer", body: DETAILS })).statusCode).toBe(403);
    expect(calls(UPDATE)).toHaveLength(0);
    expect(audits()).toHaveLength(0);
  });

  it("saves what was typed and hands the business back", async () => {
    const res = await run(patchAdminOutreach, {
      body: { ...DETAILS, contactName: " Jo Sample ", contactEmail: "Hello@InventedJoinery.example", warmIntro: "Rowan knows the owner" },
    });
    expect(res.statusCode).toBe(200);
    expect(calls(UPDATE)[0][1]).toEqual([
      4, "Invented Joinery Ltd", "Jo Sample", "hello@inventedjoinery.example", "01632 960111", "Rowan knows the owner",
      "Fern Example", ME, ["chamber"], false,
    ]);
    const b = (res.body as PatchBody).business as Record<string, unknown>;
    expect(b.contactName).toBe("Jo Sample");
    expect(b.contactEmail).toBe("hello@inventedjoinery.example");
  });

  it("leaves alone whatever it was not sent", async () => {
    await run(patchAdminOutreach, { body: { contactName: "Jo Sample" } });
    const p = calls(UPDATE)[0][1] as unknown[];
    expect(p[1]).toBe("Invented Joinery Ltd");
    expect(p[3]).toBe("jo@inventedjoinery.example");
    expect(p[4]).toBe("01632 960111");
    expect(p[8]).toEqual(["chamber"]);
  });

  it("tidies the tags as the add form does", async () => {
    await run(patchAdminOutreach, { body: { tags: "Chamber, supplier ,chamber" } });
    expect((calls(UPDATE)[0][1] as unknown[])[8]).toEqual(["chamber", "supplier"]);
  });

  it("empties a box that was cleared", async () => {
    await run(patchAdminOutreach, { body: { contactName: "", contactEmail: "", owner: "", ownerEmail: "" } });
    const p = calls(UPDATE)[0][1] as unknown[];
    expect([p[2], p[3], p[6], p[7]]).toEqual([null, null, null, null]);
  });

  it("refuses a business with no name, or an address that is not one, in a sentence", async () => {
    const noName = await run(patchAdminOutreach, { body: { businessName: " " } });
    expect(noName.statusCode).toBe(400);
    expect((noName.body as PatchBody).error).toBe("The business needs a name");
    const badEmail = await run(patchAdminOutreach, { body: { contactEmail: "jo at invented joinery" } });
    expect(badEmail.statusCode).toBe(400);
    expect((badEmail.body as PatchBody).error).toBe("That email address does not look right");
    expect(calls(UPDATE)).toHaveLength(0);
  });

  it("does not know a business that is not there", async () => {
    one = null;
    expect((await run(patchAdminOutreach, { body: DETAILS })).statusCode).toBe(404);
    expect((await run(patchAdminOutreach, { id: "nonsense", body: DETAILS })).statusCode).toBe(400);
  });

  // Who may be emailed turns on these three, so they are not this route's to change.
  it("never changes the kind of business, where the details came from, or how they agreed", async () => {
    await run(patchAdminOutreach, {
      body: { ...DETAILS, contactName: "Jo Sample", businessType: "company", detailsSource: "social", consentBasis: "said yes" },
    });
    const sql = flat(calls(UPDATE)[0][0]);
    expect(sql).not.toContain("business_type =");
    expect(sql).not.toContain("details_source =");
    expect(sql).not.toContain("consent_basis =");
    expect(sql).not.toContain("sent_at =");
  });
});

describe("a changed phone number has to be checked against the register again", () => {
  it("clears the checked mark when the number changes", async () => {
    const res = await run(patchAdminOutreach, { body: { contactPhone: "01632 960222" } });
    expect((calls(UPDATE)[0][1] as unknown[])[9]).toBe(true);
    const b = (res.body as PatchBody).business as Record<string, unknown>;
    expect(b.contactPhone).toBe("01632 960222");
    expect(b.ctpsCheckedAt).toBeNull();
    expect(b.ctpsCheckedBy).toBeNull();
  });

  it("clears it in the same statement that changes the number", async () => {
    await run(patchAdminOutreach, { body: { contactPhone: "01632 960222" } });
    const sql = flat(calls(UPDATE)[0][0]);
    expect(sql).toContain("ctps_checked_at = CASE WHEN $10::boolean THEN NULL ELSE ctps_checked_at END");
    expect(sql).toContain("ctps_checked_by = CASE WHEN $10::boolean THEN NULL ELSE ctps_checked_by END");
  });

  it("keeps the mark when the same number is typed with different spaces, or not sent at all", async () => {
    await run(patchAdminOutreach, { body: { contactPhone: "01632960111", contactName: "Jo Sample" } });
    expect((calls(UPDATE)[0][1] as unknown[])[9]).toBe(false);
    await run(patchAdminOutreach, { body: { contactName: "Jo Sample" } });
    expect((calls(UPDATE)[1][1] as unknown[])[9]).toBe(false);
  });

  it("clears it when the number is taken away", async () => {
    await run(patchAdminOutreach, { body: { contactPhone: "" } });
    expect((calls(UPDATE)[0][1] as unknown[])[9]).toBe(true);
  });
});

describe("the do not contact rule still holds when details are changed", () => {
  const declined = {
    id: 9, business_name: "Pretend Bakery", contact_email: "hello@pretendbakery.example", outcome: "declined", sent_at: null, sent_by: null,
  };

  it("refuses a new name that belongs to a business that said no, until the volunteer says it is a different one", async () => {
    known = [{ id: 4, business_name: "Invented Joinery Ltd", contact_email: null, outcome: null, sent_at: null, sent_by: null }, declined];
    const res = await run(patchAdminOutreach, { body: { businessName: "Pretend Bakery Ltd" } });
    expect(res.statusCode).toBe(409);
    expect((res.body as PatchBody).error).toBe("This business has told us not to contact them again");
    expect((res.body as PatchBody).matches).toHaveLength(1);
    expect(calls(UPDATE)).toHaveLength(0);

    const again = await run(patchAdminOutreach, { body: { businessName: "Pretend Bakery Ltd", acknowledgedMatches: true } });
    expect(again.statusCode).toBe(200);
    expect(calls(UPDATE)).toHaveLength(1);
  });

  it("refuses a new email address at a business that said no", async () => {
    known = [declined];
    const res = await run(patchAdminOutreach, { body: { contactEmail: "orders@pretendbakery.example" } });
    expect(res.statusCode).toBe(409);
  });

  it("is not stopped by itself, or by a match that was already there before the change", async () => {
    one = dbRow({ business_name: "Pretend Bakery Two" });
    known = [{ id: 4, business_name: "Pretend Bakery Two", contact_email: null, outcome: null, sent_at: null, sent_by: null }, declined];
    // Only the name of the contact changes: nothing new to warn about.
    expect((await run(patchAdminOutreach, { body: { contactName: "Jo Sample" } })).statusCode).toBe(200);
    // The email changes, the name does not: the similar name was there before, so it does not block.
    expect((await run(patchAdminOutreach, { body: { contactEmail: "jo@somewhere-else.example" } })).statusCode).toBe(200);
  });

  // "Pretend Bakery Two" only looked like the business that said no. Renamed to its exact name, it
  // IS that business as far as anyone can tell, and the earlier, weaker likeness must not wave it through.
  it("is stopped when a likeness that was already there becomes the very same name", async () => {
    one = dbRow({ business_name: "Pretend Bakery Two" });
    known = [declined];
    const res = await run(patchAdminOutreach, { body: { businessName: "Pretend Bakery Ltd" } });
    expect(res.statusCode).toBe(409);
    expect(calls(UPDATE)).toHaveLength(0);
  });

  it("will not rename, or readdress, a business that itself said no", async () => {
    one = dbRow({ outcome: "declined" });
    const res = await run(patchAdminOutreach, { body: { businessName: "Another Name Ltd" } });
    expect(res.statusCode).toBe(409);
    expect((res.body as PatchBody).error).toBe(
      "This business asked us not to contact them again, so its name and email address are kept as they are",
    );
    expect((await run(patchAdminOutreach, { body: { contactEmail: "new@inventedjoinery.example" } })).statusCode).toBe(409);
    expect(calls(UPDATE)).toHaveLength(0);
    // Everything else can still be put right.
    expect((await run(patchAdminOutreach, { body: { contactName: "Jo Sample", contactPhone: "01632 960222" } })).statusCode).toBe(200);
  });
});

describe("a change of details is written to the audit log", () => {
  it("says who changed what, without copying the details themselves into the log", async () => {
    await run(patchAdminOutreach, { body: { ...DETAILS, contactEmail: "new@inventedjoinery.example", contactPhone: "01632 960222" } });
    expect(audits()).toHaveLength(1);
    const [actor, action, entity, entityId, data] = audits()[0][1] as [string, string, string, number, Record<string, unknown>];
    expect(actor).toBe(ME);
    expect(action).toBe("outreach.details_changed");
    expect(entity).toBe("business_outreach");
    expect(entityId).toBe(4);
    expect(data).toEqual({ businessName: "Invented Joinery Ltd", changed: ["contactEmail", "contactPhone"], tpsCheckCleared: true });
    expect(JSON.stringify(data)).not.toContain("01632");
    expect(JSON.stringify(data)).not.toContain("new@");
  });

  it("writes nothing when the change was refused", async () => {
    await run(patchAdminOutreach, { body: { contactEmail: "nonsense" } });
    expect(audits()).toHaveLength(0);
  });

  it("writes nothing, and changes nothing, when nothing was different", async () => {
    const res = await run(patchAdminOutreach, { body: DETAILS });
    expect(res.statusCode).toBe(200);
    expect(calls(UPDATE)).toHaveLength(0);
    expect(audits()).toHaveLength(0);
    expect(((res.body as PatchBody).business as Record<string, unknown>).businessName).toBe("Invented Joinery Ltd");
  });
});
