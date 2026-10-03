import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// The sign up tidy (Jaimie, 2026-10-03): each fundraising category is sporting or not. Someone
// raising money says whether it is a sporting event, and sees only the sporting categories (or only
// the others), with Other in both. Run, Walk and Santa dash start sporting; an admin ticks
// "Sporting" for any other in Admin > Fundraising, Categories, and it is in audit_log. The database
// is a fake pool. Every name here is invented.

const { getUserAuthRowMock } = vi.hoisted(() => ({ getUserAuthRowMock: vi.fn() }));
vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));
vi.mock("../../src/db/admin-users", () => ({ getUserAuthRow: getUserAuthRowMock }));
vi.mock("../../src/config", () => ({
  config: {
    NODE_ENV: "development",
    DATABASE_URL: "postgres://localhost:5432/test",
    ADMIN_SESSION_SECRET: "test-admin-secret",
    STRIPE_SECRET_KEY: "sk_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    STRIPE_WEBHOOK_SECRET: "whsec_placeholder",
    PORTAL_BASE_URL: "https://nbcc.test",
  },
}));

import { pool } from "../../src/db/pool";
import { forgetCategories, listCategories, updateCategory } from "../../src/db/fundraising-categories";
import { BUILT_IN_CATEGORIES, STARTING_CATEGORIES, formCategories, rememberCategories } from "../../src/fundraising/categories";
import { kindOptionsHtml, renderFundraiseSignUp } from "../../src/fundraising/render";
import * as routes from "../../src/routes/admin-fundraising-categories";
import { signAdminSession } from "../../src/admin/session";

const ROOT = resolve(__dirname, "../..");
const query = pool.query as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  query.mockReset();
  (pool.connect as unknown as ReturnType<typeof vi.fn>).mockReset();
  forgetCategories();
  rememberCategories(BUILT_IN_CATEGORIES);
  getUserAuthRowMock.mockReset();
});

describe("the starting list", () => {
  it("has Run, Walk and Santa dash sporting, and nothing else", () => {
    expect(STARTING_CATEGORIES.filter((c) => c.sporty).map((c) => c.key).sort()).toEqual(["run", "santa_dash", "walk"]);
  });

  it("keeps the sporting mark on the form's list", () => {
    expect(formCategories().find((c) => c.key === "walk")?.sporty).toBe(true);
    expect(formCategories().find((c) => c.key === "quiz")?.sporty).toBe(false);
  });
});

describe("the categories on the sign up form", () => {
  it("mark each sporting one, so the form can show only those", () => {
    const html = kindOptionsHtml([
      { key: "walk", label: "Walk", sporty: true },
      { key: "quiz", label: "Quiz", sporty: false },
      { key: "other", label: "Other" },
    ]);
    expect(html).toContain('<label class="fr-option fr-option--small" for="kind-walk" data-sporty>');
    expect(html).toContain('<label class="fr-option fr-option--small" for="kind-quiz">');
    expect(html).not.toMatch(/for="kind-other" data-sporty/);
  });

  it("are marked in the page as written, as the server draws them", () => {
    const page = readFileSync(resolve(ROOT, "fundraise.html"), "utf8");
    for (const key of ["run", "walk", "santa_dash"]) expect(page).toContain(`for="kind-${key}" data-sporty>`);
    expect(renderFundraiseSignUp(page, true, formCategories())).toContain('for="kind-walk" data-sporty>');
  });
});

describe("reading and changing the mark", () => {
  const row = (key: string, label: string, sporty: boolean) => ({
    key, label, active: true, sporty, created_at: "2026-10-03T09:00:00Z", created_by: "migration", retired_at: null, used: "0",
  });

  it("is read with each category", async () => {
    query.mockResolvedValue({ rows: [row("walk", "Walk", true), row("quiz", "Quiz", false)] });
    const list = await listCategories();
    expect(list.map((c) => [c.key, c.sporty])).toEqual([["quiz", false], ["walk", true]]);
    expect(String(query.mock.calls[0][0])).toMatch(/c\.sporty/);
  });

  it("is changed by an admin, and the change is in audit_log", async () => {
    const calls: Array<[string, unknown[]]> = [];
    const client = {
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        calls.push([sql, params]);
        if (/SELECT key, label, active, sporty FROM fundraising_categories WHERE key/.test(sql)) return { rows: [{ key: "quiz", label: "Quiz", active: true, sporty: false }] };
        if (/UPDATE fundraising_categories/.test(sql)) return { rows: [row("quiz", "Quiz", true)] };
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    (pool.connect as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(client);
    query.mockResolvedValue({ rows: [] });
    const after = await updateCategory("quiz", { sporty: true }, "admin:kim@nbcc.test");
    expect(after.sporty).toBe(true);
    const update = calls.find(([sql]) => /UPDATE fundraising_categories/.test(sql))!;
    expect(update[0]).toMatch(/sporty = \$4/);
    expect(update[1][3]).toBe(true);
    const audit = calls.find(([sql]) => /INSERT INTO audit_log/.test(sql))!;
    expect(JSON.stringify(audit[1])).toMatch(/"sporty":true/);
    expect(JSON.stringify(audit[1])).toMatch(/"was":\{[^}]*"sporty":false/);
  });
});

describe("the admin route", () => {
  type MockRes = { statusCode: number; body: unknown; status: (c: number) => MockRes; json: (b: unknown) => MockRes };
  function mockRes(): MockRes {
    const res = { statusCode: 200, body: undefined as unknown } as MockRes;
    res.status = (c) => ((res.statusCode = c), res);
    res.json = (b) => ((res.body = b), res);
    return res;
  }
  function tokenFor(role: string) {
    getUserAuthRowMock.mockResolvedValue({ id: 1, email: "kim@nbcc.test", status: "active", role, permissions: {} });
    return signAdminSession({ sub: 1, email: "kim@nbcc.test", role, now: new Date(), secret: "test-admin-secret" }).token;
  }
  /* eslint-disable @typescript-eslint/no-explicit-any */
  async function patch(role: string, body: unknown) {
    const res = mockRes();
    await routes.patchAdminCategory({ headers: { authorization: `Bearer ${tokenFor(role)}` }, body, params: { key: "quiz" } } as any, res as any);
    return res;
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */

  it("refuses an editor", async () => {
    expect((await patch("editor", { sporty: true })).statusCode).toBe(403);
  });

  it("refuses a mark that is not a yes or no", async () => {
    expect((await patch("admin", { sporty: "yes" })).statusCode).toBe(400);
  });
});

describe("the in memory ways of giving on the sign up form", () => {
  it("are their own list, with Something else last, as the server draws them", async () => {
    const { memoryKindOptionsHtml } = await import("../../src/fundraising/render");
    const { MEMORY_CATEGORIES, memoryCategories, ALL_BUILT_IN_CATEGORIES } = await import("../../src/fundraising/categories");
    rememberCategories(ALL_BUILT_IN_CATEGORIES);
    const html = memoryKindOptionsHtml(memoryCategories());
    expect(html).toContain('<label class="fr-option fr-option--small" for="kind-memory_flowers"><input id="kind-memory_flowers" name="kind" type="radio" value="memory_flowers"');
    expect(html).toContain('for="kind-memory-other"><input id="kind-memory-other" name="kind" type="radio" value="other"');
    expect(html).toContain("<span>Something else</span>");
    const page = readFileSync(resolve(ROOT, "fundraise.html"), "utf8");
    const squash = (s: string) => s.replace(/\s+/g, " ").trim();
    const block = (page.match(/<!-- memory-kinds -->([\s\S]*?)<!-- \/memory-kinds -->/) ?? ["", ""])[1];
    expect(squash(block)).toBe(squash(html));
    const drawn = renderFundraiseSignUp(page, true, formCategories(), memoryCategories([...MEMORY_CATEGORIES.slice(0, 1), { key: "other", label: "Other", active: true }]));
    expect(drawn).toContain('value="memory_flowers"');
    expect(drawn).not.toContain('value="memory_service"');
  });
});
