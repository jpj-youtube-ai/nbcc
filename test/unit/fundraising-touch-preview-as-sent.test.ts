import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// "Show it for" in Admin > Fundraising > All emails shows an automatic email "as it would go today"
// for a real fundraiser. It has to be the email the daily run would really send, so both build it
// with the one function (touchEmailAsSent). The case that had drifted: a page for someone under 18,
// where the email greets the parent or guardian. The preview used to greet the child.
// The database is mocked. Every name and address is invented.

const touch = vi.hoisted(() => ({ listWordingApprovals: vi.fn(), touchFundraiser: vi.fn() }));
const { getUserAuthRowMock } = vi.hoisted(() => ({ getUserAuthRowMock: vi.fn() }));

// The real module, with only the two reads this test needs faked (the runner takes its own fakes).
vi.mock("../../src/db/fundraising-touch", async (importOriginal) => ({ ...(await importOriginal<object>()), ...touch }));
vi.mock("../../src/db/admin-users", () => ({ getUserAuthRow: getUserAuthRowMock }));
vi.mock("../../src/config", () => ({
  config: {
    NODE_ENV: "test",
    DATABASE_URL: "postgres://localhost:5432/test",
    ADMIN_SESSION_SECRET: "test-admin-secret",
    STRIPE_SECRET_KEY: "sk_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    STRIPE_WEBHOOK_SECRET: "whsec_placeholder",
    PORTAL_BASE_URL: "https://nbcc.test",
    BALL_FROM_EMAIL: "events@nbcc.test",
  },
}));
vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));

import * as routes from "../../src/routes/admin-fundraising-touch";
import { runTouchEmails, type TouchDeps } from "../../src/fundraising/touch-runner";
import { signAdminSession } from "../../src/admin/session";
import { meter, type FundraiserRecord, type Meter } from "../../src/fundraising/model";
import { WORDING_KEYS } from "../../src/fundraising/touch-rules";
import { buildTouchEmail, touchEmailAsSent, touchEmailData } from "../../src/fundraising/touch-emails";
import type { TouchCandidate } from "../../src/db/fundraising-touch";

type F = FundraiserRecord & { meter: Meter; editWaiting: boolean };
const WANTS = { posterCount: 0, leafletCount: 0, bucketCount: 0, tinCount: 0, leaflets: 0, buckets: 0, shoutOut: false, attend: false };
function fr(over: Partial<FundraiserRecord> = {}): F {
  const base = {
    id: 7, slug: "jacks-santa-dash", path: "raising", kind: "santa_dash", title: "Jack's Santa Dash", description: "A dash.",
    eventDate: "2026-12-06", startTime: null, venue: "", town: "Exampleton", targetPence: 50000, public: true, status: "approved",
    name: "Jack Example", firstName: "Jack", email: "sarah@example.com", phone: "07700 900123", socialLink: null, socialOk: true, wants: { ...WANTS },
    postAddress: null, newsletterOk: false, imageSrc: null, declinedReason: null, createdAt: "2026-10-01T09:00:00.000Z",
    approvedAt: "2026-10-06T09:00:00.000Z", approvedBy: "admin:fern@example.com", updatedAt: "2026-10-06T09:00:00.000Z", updatedBy: null,
    creditName: null, ...over,
  } as FundraiserRecord;
  return { ...base, meter: meter({ onlinePence: 20000, cashPence: 0, targetPence: base.targetPence }), editWaiting: false };
}
const candidate = (f: F): TouchCandidate => ({
  f,
  touch: { firstOnlineGiftAt: null, lastOnlineGiftAt: null, finishedAt: null, sent: [] },
  prompt: { lastOnlineGiftAt: null, calls: [] },
});

// 29 November 2026, 8am in the UK: a page dated 6 December is a week away, so "One week to go" is due.
const NOW = new Date("2026-11-29T08:00:00.000Z");

/** What the daily run really sends for this fundraiser: its subject and HTML. */
async function sentByTheRun(f: F): Promise<{ kind: string; subject: string; html: string }> {
  const sent: Array<{ kind: string; subject: string; html: string }> = [];
  const deps: TouchDeps = {
    touchOn: vi.fn(async () => true),
    fundraisingOn: vi.fn(async () => true),
    readState: vi.fn(async () => [candidate(f)]),
    blocked: vi.fn(async () => false),
    claim: vi.fn(async () => true),
    release: vi.fn(async () => undefined),
    recordSent: vi.fn(async () => undefined),
    againLink: vi.fn(async () => "https://nbcc.test/fundraise?again=example"),
    approvedWordings: vi.fn(async () => new Set<string>(WORDING_KEYS)),
    markFinishedPending: vi.fn(async () => undefined),
    clearFinishedPending: vi.fn(async () => undefined),
    send: vi.fn(async (kind: string, _name: string, m: { subject: string; html: string }) => {
      sent.push({ kind, subject: m.subject, html: m.html });
    }),
  };
  await runTouchEmails(NOW, deps);
  expect(sent).toHaveLength(1);
  return sent[0];
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function preview(kind: string, id: number): Promise<{ subject: string; html: string }> {
  getUserAuthRowMock.mockResolvedValue({ id: 3, email: "fern@example.com", status: "active", role: "viewer", permissions: {} });
  const token = signAdminSession({ sub: 3, email: "fern@example.com", role: "viewer", now: new Date(), secret: "test-admin-secret" }).token;
  const res = { statusCode: 200, body: undefined as any } as any;
  res.status = (c: number) => ((res.statusCode = c), res);
  res.json = (b: unknown) => ((res.body = b), res);
  await routes.getTouchPreview({ headers: { authorization: `Bearer ${token}` }, body: {}, params: { kind }, query: { fundraiserId: String(id) } } as any, res);
  expect(res.statusCode).toBe(200);
  return res.body;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

beforeEach(() => {
  touch.listWordingApprovals.mockReset().mockResolvedValue([]);
  touch.touchFundraiser.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});

describe("an automatic email shown for a real fundraiser", () => {
  it("is exactly what the daily run would send, for a page for someone under 18", async () => {
    const jack = fr({ guardianFirstName: "Sarah" });
    touch.touchFundraiser.mockResolvedValue(jack);
    const real = await sentByTheRun(jack);
    expect(real.kind).toBe("week_before");
    // The run greets the parent or guardian, and its subject is about the child, never to them.
    expect(real.html).toContain("Hi Sarah, this is about Jack&#39;s page.");
    expect(real.html).not.toContain("Hi Jack,");
    const shown = await preview("week_before", 7);
    expect(shown.subject).toBe(real.subject);
    expect(shown.html).toBe(real.html);
  });

  it("is exactly what the daily run would send, for an adult's page", async () => {
    const sam = fr({ name: "Sam Example", firstName: "Sam", title: "Sam's Santa Dash" });
    touch.touchFundraiser.mockResolvedValue(sam);
    const real = await sentByTheRun(sam);
    const shown = await preview("week_before", 7);
    expect(shown.subject).toBe(real.subject);
    expect(shown.html).toBe(real.html);
    expect(shown.html).toContain("Hi Sam,");
  });
});

describe("touchEmailAsSent", () => {
  it("is the builder's email for an adult, untouched", () => {
    const data = touchEmailData(fr({ name: "Sam Example", firstName: "Sam" }), "https://nbcc.test");
    expect(touchEmailAsSent("halfway", data)).toEqual(buildTouchEmail("halfway", data));
  });

  it("greets the parent or guardian on a page for someone under 18, in the HTML and the plain text", () => {
    const data = touchEmailData(fr({ guardianFirstName: "Sarah" }), "https://nbcc.test");
    const mail = touchEmailAsSent("halfway", data);
    expect(mail.html).toContain("Hi Sarah, this is about Jack&#39;s page.");
    expect(mail.text).toContain("Hi Sarah, this is about Jack's page.");
  });
});

describe("one path, so they cannot drift", () => {
  const read = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");

  it.each(["src/fundraising/touch-runner.ts", "src/routes/admin-fundraising-touch.ts", "src/email/catalogue.ts"])("%s builds an automatic email only through touchEmailAsSent", (file) => {
    const src = read(file);
    expect(src).toMatch(/\btouchEmailAsSent\(/);
    expect(src).not.toMatch(/\bbuildTouchEmail\(/);
  });
});
