import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-515: POST /api/fundraise/again, which the sign up form asks when it is opened from email 18's
// Do it again link. Only the safe details come back; an unknown, used or out of date link all get
// the same plain 404, so a guess learns nothing; tries are limited per address. The sign up made from
// it marks it used. Every name here is invented.

const { findAgainByHash, markAgainUsed, getFundraiser } = vi.hoisted(() => ({
  findAgainByHash: vi.fn(),
  markAgainUsed: vi.fn(),
  getFundraiser: vi.fn(),
}));
vi.mock("../../src/db/fundraiser-again", () => ({ findAgainByHash, markAgainUsed }));
vi.mock("../../src/db/fundraisers", () => ({ getFundraiser }));
vi.mock("../../src/config", () => ({ config: { NODE_ENV: "test" } }));
vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));

import { postAgainPrefill, useAgain, againLimiterReset } from "../../src/routes/fundraise-again";
import { hashAgainToken } from "../../src/fundraising/again";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const TOKEN = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ";

/* eslint-disable @typescript-eslint/no-explicit-any */
async function ask(body: unknown, ip = "203.0.113.5") {
  const res = { statusCode: 200, body: undefined as unknown } as any;
  res.status = (c: number) => ((res.statusCode = c), res);
  res.json = (b: unknown) => ((res.body = b), res);
  await postAgainPrefill({ body, ip } as any, res);
  return res;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const last = {
  id: 7, path: "raising", kind: "santa_dash", kindOther: null, title: "Sam's Santa Dash 2026", description: "A mile in Santa suits.",
  targetPence: 50000, venue: "Riverside Park", town: "Exampleton", name: "Sam Example", firstName: "Sam", lastName: "Example",
  email: "sam@example.com", phone: "07700 900123", instagram: null, facebook: null, status: "finished",
  postLine1: "1 Example Street", eventDate: "2026-12-06", declinedReason: "internal", wants: { posterCount: 10 },
};

beforeEach(() => {
  againLimiterReset();
  findAgainByHash.mockReset().mockResolvedValue({ fundraiserId: 7, expiresAt: new Date(Date.now() + 86_400_000), usedAt: null });
  markAgainUsed.mockReset().mockResolvedValue(7);
  getFundraiser.mockReset().mockResolvedValue(last);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("asking for last year's details", () => {
  it("looks the link up by its hash and gives back only the safe details", async () => {
    const res = await ask({ token: TOKEN });
    expect(res.statusCode).toBe(200);
    expect(findAgainByHash).toHaveBeenCalledWith(hashAgainToken(TOKEN));
    expect(getFundraiser).toHaveBeenCalledWith(7);
    expect(Object.keys(res.body).sort()).toEqual(
      ["description", "email", "facebook", "firstName", "instagram", "kind", "kindOther", "lastName", "path", "phone", "targetPence", "title", "town", "venue"].sort(),
    );
    const json = JSON.stringify(res.body);
    for (const never of ["1 Example Street", "2026-12-06", "internal", "posterCount", "finished"]) expect(json).not.toContain(never);
  });

  it("answers an unknown, used or out of date link, or a missing fundraiser, with the same 404", async () => {
    const answers: unknown[] = [];
    findAgainByHash.mockResolvedValueOnce(null);
    answers.push((await ask({ token: TOKEN })).body);
    findAgainByHash.mockResolvedValueOnce({ fundraiserId: 7, expiresAt: new Date(Date.now() + 86_400_000), usedAt: new Date() });
    answers.push((await ask({ token: TOKEN })).body);
    findAgainByHash.mockResolvedValueOnce({ fundraiserId: 7, expiresAt: new Date(Date.now() - 1000), usedAt: null });
    answers.push((await ask({ token: TOKEN })).body);
    getFundraiser.mockResolvedValueOnce(null);
    answers.push((await ask({ token: TOKEN })).body);
    answers.push((await ask({ token: "not-a-token" })).body);
    answers.push((await ask({})).body);
    expect(new Set(answers.map((a) => JSON.stringify(a))).size).toBe(1);
    expect((await ask({ token: "x" })).statusCode).toBe(404);
  });

  it("limits tries from one address", async () => {
    findAgainByHash.mockResolvedValue(null);
    for (let i = 0; i < 30; i++) expect((await ask({ token: TOKEN }, "198.51.100.9")).statusCode).toBe(404);
    expect((await ask({ token: TOKEN }, "198.51.100.9")).statusCode).toBe(429);
    expect((await ask({ token: TOKEN }, "198.51.100.10")).statusCode).toBe(404);
  });

  it("says so plainly when it cannot look", async () => {
    findAgainByHash.mockRejectedValue(new Error("down"));
    expect((await ask({ token: TOKEN })).statusCode).toBe(503);
  });
});

describe("the sign up made from it", () => {
  it("marks the link used, by its hash, and never throws", async () => {
    await useAgain(TOKEN, 31);
    expect(markAgainUsed).toHaveBeenCalledWith(hashAgainToken(TOKEN), 31);
    markAgainUsed.mockRejectedValue(new Error("down"));
    await expect(useAgain(TOKEN, 32)).resolves.toBeUndefined();
  });

  it("does nothing without a token", async () => {
    await useAgain(undefined, 31);
    await useAgain("nonsense", 31);
    expect(markAgainUsed).not.toHaveBeenCalled();
  });

  it("is wired into the sign up, after it is saved", () => {
    const src = readFileSync(resolve(__dirname, "../../src/routes/fundraise.ts"), "utf8");
    const saved = src.indexOf("await createFundraiser(parsed.data)");
    const used = src.indexOf("await useAgain(req.body?.again, record.id)");
    expect(saved).toBeGreaterThan(-1);
    expect(used).toBeGreaterThan(saved);
  });
});
