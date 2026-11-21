// @vitest-environment jsdom
import { describe, it, expect, beforeAll, vi } from "vitest";

// TASK-644: Stories and Partners fed what the REAL server sends. The route handlers in
// src/routes/admin.ts run for real, with every query they make (src/db/stories.ts on the stories
// database, src/db/ticker.ts) answered by invented rows in the tables' own shape
// (helpers/real-rows.ts). Only the databases are pretend.

vi.mock("../../src/db/pool", async () => ({ pool: (await import("./helpers/real-server")).db.pool }));
vi.mock("../../src/db/stories-pool", async () => ({ storiesPool: (await import("./helpers/real-server")).db.pool }));
vi.mock("../../src/config", async () => ({ config: (await import("./helpers/real-server")).CONFIG }));

import { db, callRoute, replyWith, type Reply } from "./helpers/real-server";
import { storiesRows, down } from "./helpers/real-rows";
import { mountAdmin, el, q, text } from "./helpers/admin-settings-harness";
import { getAdminStories, getAdminStory, getAdminTicker } from "../../src/routes/admin";

vi.setConfig({ testTimeout: 30_000 });

const real: Record<string, Reply> = {};
const broken: Record<string, Reply> = {};
beforeAll(async () => {
  for (const view of ["live", "archived"]) {
    db.answer(storiesRows());
    real[`GET /api/admin/stories?view=${view}`] = await callRoute(getAdminStories, { query: { view } });
  }
  db.answer(storiesRows());
  real["GET /api/admin/stories/5"] = await callRoute(getAdminStory, { params: { id: "5" } });
  db.answer(storiesRows());
  real["GET /api/admin/ticker"] = await callRoute(getAdminTicker);

  db.answer([down("FROM stories")]);
  broken["GET /api/admin/stories"] = await callRoute(getAdminStories, { query: { view: "live" } });
  db.answer([down("FROM supporter_ticker")]);
  broken["GET /api/admin/ticker"] = await callRoute(getAdminTicker);
});

async function open(view: string, replies: Record<string, Reply>) {
  const admin = mountAdmin({ role: "admin" }, replyWith(replies));
  await admin.signIn();
  await admin.open(view);
  return admin;
}
const NOTHING_MADE_UP = /undefined|NaN|Invalid Date|\[object Object\]|null/;

describe("Stories with the real server's answers", () => {
  it("the real handlers answered", () => {
    for (const r of Object.values(real)) expect(r.status).toBe(200);
    for (const r of Object.values(broken)) expect(r.status).toBe(500);
    // The list never carries the story itself or how to reach the person.
    expect(JSON.stringify(real["GET /api/admin/stories?view=live"].body)).not.toContain("ailsa@example.com");
  });

  it("lists the live stories, and counts the archived one apart", async () => {
    await open("stories", real);
    const list = text(el("storiesTable"));
    // The quote is on the opened story only; the list says who sent it and what they agreed to.
    for (const s of ["May be used in public, with their first name and their town.", "Private to NBCC: never to be published.", "1 October 2026", "1 September 2026"]) {
      expect(list).toContain(s);
    }
    expect(list).not.toContain("family_carer");
    expect(q('#storiesTable [data-story="5"]')).not.toBeNull();
    expect(q('#storiesTable [data-story="4"]')).not.toBeNull();
    expect(q('#storiesTable [data-story="2"]')).toBeNull();
    expect(text(el("view-stories"))).not.toMatch(NOTHING_MADE_UP);
  });

  it("opens one story with its words, the quote and how to reach them", async () => {
    const admin = await open("stories", real);
    (q('#storiesTable [data-story="5"]') as HTMLElement).click();
    await admin.settle();
    const story = text(el("storyDetail"));
    for (const s of ["A made-up story, long enough to read as one.", "They made Christmas happen for us.", "ailsa@example.com", "Testtown"]) expect(story).toContain(s);
    expect(story).not.toMatch(NOTHING_MADE_UP);
  });

  it("says plainly when the stories could not be loaded", async () => {
    await open("stories", broken);
    expect(text(el("storiesTable"))).toBe("Stories are unavailable.");
  });
});

describe("Partners with the real server's answers", () => {
  it("lists each partner and whether it is showing", async () => {
    await open("ticker", real);
    const view = text(el("view-ticker"));
    for (const s of ["Pretend Bakery Ltd", "Madeup Garage", "Showing", "Hidden"]) expect(view).toContain(s);
    expect(view).not.toMatch(NOTHING_MADE_UP);
  });

  it("says plainly when the partners could not be loaded", async () => {
    await open("ticker", broken);
    expect(text(el("tickerTable"))).toMatch(/could not|unavailable/i);
  });
});
