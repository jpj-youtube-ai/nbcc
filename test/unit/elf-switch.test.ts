import { describe, it, expect, vi } from "vitest";

// NBCC Elf Detective School ships switched off: while it is, every page and API answers 404.

vi.mock("../../src/db/elf", async (orig) => ({
  ...(await orig<typeof import("../../src/db/elf")>()),
  getElfSettings: async () => ({ schoolOn: false, year: 2026, entryFromPence: 100, entrySuggestedPence: 500 }),
}));
vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));
vi.mock("../../src/routes/api", () => ({ currentCardFee: async () => ({ percentBp: 120, fixedPence: 20 }) }));
vi.mock("../../src/config", () => ({ config: { NODE_ENV: "test", ADMIN_SESSION_SECRET: "s", PORTAL_BASE_URL: "https://nbcc.scot", BALL_FROM_EMAIL: "events@nbcc.scot" } }));

import { elfRouter } from "../../src/routes/elf";

type Layer = { route?: { path: string; methods: Record<string, boolean>; stack: { handle: (req: unknown, res: unknown, next: () => void) => unknown }[] } };

describe("while the school is switched off", () => {
  const routes = (elfRouter.stack as Layer[]).filter((l) => l.route).map((l) => l.route!);

  it("has every route behind the switch", () => {
    expect(routes.length).toBeGreaterThanOrEqual(12);
  });

  it.each(["/elf", "/elf/rules", "/elf/join", "/elf/sign-in", "/elf/hq", "/elf/welcome", "/api/elf/calendar", "/api/elf/me", "/api/elf/join", "/api/elf/look"])(
    "%s answers 404",
    async (path) => {
      const route = routes.find((r) => r.path === path);
      expect(route, path).toBeTruthy();
      let status = 200;
      let reached = false;
      const res = {
        locals: {},
        status(s: number) {
          status = s;
          return res;
        },
        type() {
          return res;
        },
        send() {
          return res;
        },
        json() {
          return res;
        },
        setHeader() {
          return res;
        },
      };
      // Run the route's handlers in order, as Express would, until one answers.
      for (const layer of route!.stack) {
        let next = false;
        await layer.handle({ headers: {}, body: {}, query: {}, params: {} }, res, () => (next = true));
        if (!next) break;
        if (layer === route!.stack[route!.stack.length - 1]) reached = true;
      }
      expect(status).toBe(404);
      expect(reached).toBe(false);
    },
  );
});
