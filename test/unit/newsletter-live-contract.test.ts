// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-646: the server's side of the live blocks, from the REAL route handlers with only the database
// pretend (helpers/real-server.ts), answering the Red Bag and sleigh totals in the shape Postgres gives
// them (GROUPING() as an int, SUM() as a string).
//   * the preview shows today's number and answers it as `live`, for the block's "Right now" line;
//   * the checks before sending know today's numbers and when the send is scheduled for;
//   * a frozen number never reaches a saved draft or a template.

vi.mock("../../src/db/pool", async () => ({ pool: (await import("./helpers/real-server")).db.pool }));
vi.mock("../../src/config", async () => ({ config: (await import("./helpers/real-server")).CONFIG }));

import { db, ran, callRoute } from "./helpers/real-server";
import {
  postAdminNewsletterPreview,
  postAdminNewsletterPreflight,
  postAdminNewsletter,
  postAdminNewsletterTemplate,
} from "../../src/routes/admin";
import { forgetRedBagWorkshops } from "../../src/db/red-bag-workshops";
import { forgetSleighTotals } from "../../src/db/sleigh";

const RED_BAG = [/GROUP BY ROLLUP \(red_bag_workshop_id\)/, [{ is_total: 1, workshop_id: null, pence: "1560000" }]] as const;
const SLEIGH = (online: string) =>
  [/AS bucket_pence/, [{ online_pence: online, card_pence: "20000", gifts: "12", bucket_pence: "3400" }]] as const;

const bags = { type: "liveTotal", variant: 3, data: { source: "redBag", after: "bags filled so far", fallbackText: "Every gift helps." } };
const sleigh = { type: "liveTotal", variant: 3, data: { source: "sleigh", after: "raised by the sleigh", fallbackText: "Every coin helps." } };

beforeEach(() => {
  forgetRedBagWorkshops();
  forgetSleighTotals();
  ran.length = 0;
});

describe("the preview", () => {
  it("shows today's number of bags and answers it as live", async () => {
    db.answer([[...RED_BAG]]);
    const r = await callRoute(postAdminNewsletterPreview, { body: { bodyJson: { blocks: [bags] } } });
    expect(r.status).toBe(200);
    const b = r.body as { html: string; live: Record<string, unknown> };
    expect(b.live).toEqual({ redBag: 312 });
    expect(b.html).toContain("312</b> bags filled so far");
  });

  it("shows the sleigh's total as money", async () => {
    db.answer([[...SLEIGH("100000")]]);
    const r = await callRoute(postAdminNewsletterPreview, { body: { bodyJson: { blocks: [sleigh] } } });
    expect((r.body as { live: unknown }).live).toEqual({ sleigh: 123400 });
    expect((r.body as { html: string }).html).toContain("£1,234</b> raised by the sleigh");
  });

  it("reads nothing and answers exactly as before for a newsletter with no live total", async () => {
    db.answer([]);
    const r = await callRoute(postAdminNewsletterPreview, { body: { bodyJson: { blocks: [{ type: "text", variant: 0, data: { text: "Hi" } }] } } });
    expect(Object.keys(r.body as object)).toEqual(["html"]);
    expect(ran.some((q) => /red_bag|sleigh/.test(q.sql))).toBe(false);
  });

  it("shows the fallback words, not £0, when the sleigh has raised nothing yet", async () => {
    db.answer([[/AS bucket_pence/, [{ online_pence: "0", card_pence: "0", gifts: "0", bucket_pence: "0" }]]]);
    const r = await callRoute(postAdminNewsletterPreview, { body: { bodyJson: { blocks: [sleigh] } } });
    const html = (r.body as { html: string }).html;
    expect(html).toContain("Every coin helps.");
    expect(html).not.toContain("£0");
  });
});

describe("the checks before sending", () => {
  it("say when a live total has no number to show right now", async () => {
    db.answer([[/AS bucket_pence/, [{ online_pence: "0", card_pence: "0", gifts: "0", bucket_pence: "0" }]]]);
    const r = await callRoute(postAdminNewsletterPreflight, { body: { subject: "Hi", testSent: true, bodyJson: { blocks: [sleigh] } } });
    const said = (r.body as { findings: { message: string }[] }).findings.map((f) => f.message).join(" ");
    expect(said).toContain("A live total has no number to show right now");
  });

  it("check a countdown against the day the send is scheduled for", async () => {
    db.answer([]);
    const countdown = { type: "countdown", variant: 2, data: { date: "2099-12-01", label: "until the day" } };
    const r = await callRoute(postAdminNewsletterPreflight, {
      body: { subject: "Hi", testSent: true, bodyJson: { blocks: [countdown] }, sendAt: "2099-12-02T09:00:00.000Z" },
    });
    const said = (r.body as { findings: { message: string }[] }).findings.map((f) => f.message).join(" ");
    expect(said).toContain("A countdown's day comes before this is scheduled to send");
  });

  it("refuse a scheduled time that is not a time", async () => {
    db.answer([]);
    const r = await callRoute(postAdminNewsletterPreflight, { body: { subject: "Hi", bodyJson: { blocks: [] }, sendAt: "next week" } });
    expect(r.status).toBe(400);
  });
});

describe("a frozen number never reaches a draft or a template", () => {
  const frozen = { ...bags, data: { ...bags.data, sent: { value: 400, at: "2026-12-01T09:00:00.000Z" } } };

  it("is taken out when a newsletter is saved", async () => {
    db.answer([[/INSERT INTO newsletters/, (p) => [{ id: 9, subject: p[0], body_html: p[1], body_json: p[2], status: "draft", sent_at: null, recipient_count: 0, sent_count: 0, failed_count: 0, failed_emails: [] }]]]);
    const r = await callRoute(postAdminNewsletter, { body: { subject: "Hi", bodyJson: { blocks: [frozen] } } });
    expect(r.status).toBe(201);
    const insert = ran.find((q) => q.sql.includes("INSERT INTO newsletters"));
    expect(JSON.stringify(insert?.params[2])).not.toContain("sent");
    // The stored email holds the fallback words: a saved draft has no number of its own.
    expect(String(insert?.params[1])).toContain("Every gift helps.");
  });

  it("is taken out when a template is saved", async () => {
    db.answer([[/INSERT INTO newsletter_templates/, (p) => [{ id: 3, name: p[0], body_json: p[1], created_at: new Date("2026-11-20T10:00:00Z"), created_by: 1 }]]]);
    await callRoute(postAdminNewsletterTemplate, { body: { name: "Invented template", bodyJson: { blocks: [frozen] } } });
    const insert = ran.find((q) => q.sql.includes("INSERT INTO newsletter_templates"));
    expect(insert).toBeTruthy();
    expect(JSON.parse(String(insert?.params[1])).blocks[0].data).toEqual(bags.data);
  });
});
