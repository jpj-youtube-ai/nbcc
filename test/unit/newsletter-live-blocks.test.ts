import { describe, it, expect } from "vitest";
import { newsletterDocSchema, renderBlock, renderNewsletter, type Block, type BlockType } from "../../src/newsletter/blocks";
import { htmlToPlainText } from "../../src/newsletter/plain-text";
import {
  LIVE_PAPER_TYPES,
  ukToday,
  liveSourcesIn,
  withFrozenTotals,
  withoutFrozenTotals,
} from "../../src/newsletter/live-blocks";
import { preflightNewsletter } from "../../src/newsletter/preflight";
import type { RenderCtx } from "../../src/newsletter/theme";

// TASK-646: the two live blocks of the paper look (Stage 2 of the 14 November design).
//   countdown, "Sleeps to go": counted in UK days from ctx.today, and ALWAYS printing the real date,
//     because an email is often opened days after it was sent.
//   liveTotal, "Live total": bags filled through Fill a Red Bag, pounds raised by the Santa Sleigh, or
//     a number typed in. Never "0 bags" or "£0": below where it is shown, or with no number, it shows
//     the words for when there is no number, or nothing.

const LINK = "https://example.com/go";
const NASTY = '<b>X</b> & "q"';
const VARIANTS = [0, 1, 2, 3];
const base: RenderCtx = { firstName: "Jane", today: "2026-11-14" };

const block = (type: BlockType, variant: number, data: Record<string, unknown>): Block => ({ type, variant, data });
const render = (type: BlockType, variant: number, data: Record<string, unknown>, ctx: Partial<RenderCtx> = {}): string =>
  renderBlock(block(type, variant, data), { ...base, ...ctx });
const text = (type: BlockType, variant: number, data: Record<string, unknown>, ctx: Partial<RenderCtx> = {}): string =>
  htmlToPlainText(render(type, variant, data, ctx));

describe("the live blocks are registered as new types", () => {
  it("are accepted by the document schema", () => {
    for (const type of LIVE_PAPER_TYPES) {
      expect(newsletterDocSchema.safeParse({ blocks: [{ type, variant: 3, data: {} }] }).success).toBe(true);
    }
    expect(LIVE_PAPER_TYPES).toEqual(["liveTotal", "countdown"]);
  });
});

describe("ukToday", () => {
  it("is the date in the UK, not in UTC", () => {
    // 23:30 UTC on 30 June is already 1 July in the UK (summer time).
    expect(ukToday(new Date("2026-06-30T23:30:00Z"))).toBe("2026-07-01");
    expect(ukToday(new Date("2026-12-24T23:30:00Z"))).toBe("2026-12-24");
  });
});

describe("countdown, Sleeps to go", () => {
  const eve = { date: "2026-12-24", label: "until Christmas Eve", unit: "sleeps", afterText: "Merry Christmas from all of us." };

  it("counts the days from today in the UK and always prints the real date", () => {
    expect(text("countdown", 2, eve)).toContain("40 sleeps until Christmas Eve (Thursday 24 December)");
    for (const v of VARIANTS) {
      const t = text("countdown", v, eve);
      expect(t, `variant ${v}`).toContain("40 sleeps until Christmas Eve");
      expect(t, `variant ${v}`).toContain("Thursday 24 December");
    }
  });

  it("can count days instead of sleeps, and says one sleep, not one sleeps", () => {
    expect(text("countdown", 2, { ...eve, unit: "days" })).toContain("40 days until Christmas Eve");
    expect(text("countdown", 2, eve, { today: "2026-12-23" })).toContain("1 sleep until Christmas Eve");
    expect(text("countdown", 2, { ...eve, unit: "days" }, { today: "2026-12-23" })).toContain("1 day until Christmas Eve");
  });

  it("names the year when the day is in another year from today", () => {
    expect(text("countdown", 2, { ...eve, date: "2027-01-05", label: "until we open again" })).toContain("Tuesday 5 January 2027");
  });

  it("shows the after words, or nothing, on and after the day", () => {
    for (const today of ["2026-12-24", "2026-12-30"]) {
      for (const v of VARIANTS) {
        const t = text("countdown", v, eve, { today });
        expect(t).toContain("Merry Christmas from all of us.");
        expect(t).not.toMatch(/\d+ sleeps?/);
      }
      expect(render("countdown", 0, { ...eve, afterText: "" }, { today })).toBe("");
    }
  });

  it("renders nothing for a date that is not a date", () => {
    for (const date of ["", "2026-02-31", "24/12/2026", "soon"]) expect(render("countdown", 0, { ...eve, date })).toBe("");
  });

  it("counts from today in the UK when no day is given", () => {
    const html = renderBlock(block("countdown", 2, { ...eve, date: "2099-12-24" }), { firstName: "Jane" });
    expect(htmlToPlainText(html)).toMatch(/\d+ sleeps until Christmas Eve/);
  });

  it("escapes what an author types and cuts it to its limit", () => {
    const html = render("countdown", 0, { ...eve, label: NASTY });
    expect(html).not.toContain("<b>X</b>");
    expect(html).toContain("&lt;b&gt;X&lt;/b&gt; &amp; &quot;q&quot;");
    expect(text("countdown", 2, { ...eve, label: "x".repeat(200) })).toContain("x".repeat(60) + " (");
  });

  it("gives each style its own look, from tables and inline styles only", () => {
    const looks = VARIANTS.map((v) => render("countdown", v, eve));
    expect(new Set(looks).size).toBe(4);
    for (const h of looks) {
      expect(h).not.toMatch(/<svg|<script|position:|transform|display:flex|display:grid/i);
      expect(Buffer.byteLength(h)).toBeLessThan(4096);
    }
  });
});

describe("liveTotal, Live total", () => {
  const bags = { source: "redBag", after: "bags filled so far", fallbackText: "Every gift helps fill a Red Bag." };
  const sleigh = { source: "sleigh", after: "raised by the sleigh so far this year", fallbackText: "Every coin helps." };

  it("shows today's number of bags from the context", () => {
    for (const v of VARIANTS) {
      expect(text("liveTotal", v, bags, { live: { redBag: 1312 } }), `variant ${v}`).toContain("1,312 bags filled so far");
    }
  });

  it("shows the sleigh's total as money", () => {
    expect(text("liveTotal", 3, sleigh, { live: { sleigh: 123400 } })).toContain("£1,234 raised by the sleigh so far this year");
  });

  it("shows a number typed in, as money when it starts with a pound sign", () => {
    expect(text("liveTotal", 3, { source: "typed", typed: "2500", after: "children helped" })).toContain("2,500 children helped");
    expect(text("liveTotal", 3, { source: "typed", typed: "£12,000", before: "Together we raised" })).toContain("Together we raised £12,000");
  });

  it("prefers the number frozen in when the newsletter was sent", () => {
    const frozen = { ...bags, sent: { value: 400, at: "2026-12-01T09:00:00.000Z" } };
    expect(text("liveTotal", 0, frozen, { live: { redBag: 999 } })).toContain("400 bags filled so far");
  });

  it("shows the fallback words when the frozen read failed, whatever today's number is", () => {
    const failed = { ...bags, sent: { value: null, at: "2026-12-01T09:00:00.000Z" } };
    const t = text("liveTotal", 0, failed, { live: { redBag: 999 } });
    expect(t).toContain("Every gift helps fill a Red Bag.");
    expect(t).not.toContain("999");
  });

  it("never prints 0 bags or £0: the fallback words, or nothing", () => {
    for (const v of VARIANTS) {
      for (const live of [{ redBag: 0 }, { redBag: null }, {}]) {
        const t = text("liveTotal", v, bags, { live });
        expect(t).toContain("Every gift helps fill a Red Bag.");
        expect(t).not.toMatch(/\b0 bags/);
      }
      expect(text("liveTotal", v, sleigh, { live: { sleigh: 0 } })).not.toContain("£0");
      expect(render("liveTotal", v, { ...bags, fallbackText: "" }, { live: { redBag: 0 } })).toBe("");
    }
  });

  it("hides a number below where it was chosen to show", () => {
    const t = text("liveTotal", 0, { ...bags, hideBelow: "50" }, { live: { redBag: 49 } });
    expect(t).toContain("Every gift helps fill a Red Bag.");
    expect(t).not.toContain("49");
    expect(text("liveTotal", 0, { ...bags, hideBelow: "50" }, { live: { redBag: 50 } })).toContain("50 bags");
  });

  it("draws a bar towards a target in the progress style, held at full", () => {
    const half = render("liveTotal", 2, { ...bags, target: "200" }, { live: { redBag: 100 } });
    expect(half).toContain("width:50%");
    expect(htmlToPlainText(half)).toContain("Our target: 200");
    expect(render("liveTotal", 2, { ...sleigh, target: "£1,000" }, { live: { sleigh: 250000 } })).toContain("width:100%");
    expect(htmlToPlainText(render("liveTotal", 2, { ...sleigh, target: "1000" }, { live: { sleigh: 50000 } }))).toContain("Our target: £1,000");
    // No target: no bar.
    expect(render("liveTotal", 2, bags, { live: { redBag: 100 } })).not.toContain("width:");
  });

  it("adds a sticker button only with words and a link we would send", () => {
    expect(render("liveTotal", 0, { ...bags, label: "Fill a bag", href: LINK }, { live: { redBag: 5 } })).toContain(`href="${LINK}"`);
    expect(render("liveTotal", 0, { ...bags, label: "Fill a bag", href: "javascript:alert(1)" }, { live: { redBag: 5 } })).not.toContain("href=");
  });

  it("escapes what an author types", () => {
    const html = render("liveTotal", 1, { ...bags, before: NASTY, typed: NASTY }, { live: { redBag: 5 } });
    expect(html).not.toContain("<b>X</b>");
    expect(html).toContain("&lt;b&gt;X&lt;/b&gt;");
    const fb = render("liveTotal", 3, { ...bags, fallbackText: NASTY }, { live: {} });
    expect(fb).not.toContain("<b>X</b>");
  });

  it("gives each style its own look, from tables and inline styles only", () => {
    const looks = VARIANTS.map((v) => render("liveTotal", v, { ...bags, target: "200" }, { live: { redBag: 100 } }));
    expect(new Set(looks).size).toBe(4);
    for (const h of looks) {
      expect(h).not.toMatch(/<svg|<script|position:|transform|display:flex|display:grid/i);
      expect(Buffer.byteLength(h)).toBeLessThan(4096);
    }
  });
});

describe("freezing the live totals for a send", () => {
  const doc = {
    blocks: [
      { type: "text", variant: 0, data: { text: "Hello" }, size: 0 },
      { type: "liveTotal", variant: 0, data: { source: "redBag", after: "bags" }, size: 0 },
      { type: "liveTotal", variant: 3, data: { source: "sleigh" }, size: 0 },
      { type: "liveTotal", variant: 3, data: { source: "typed", typed: "5" }, size: 0 },
    ],
  };

  it("lists the sources a newsletter reads, once each, never the typed one", () => {
    expect(liveSourcesIn(doc)).toEqual(["redBag", "sleigh"]);
    expect(liveSourcesIn({ blocks: [] })).toEqual([]);
    expect(liveSourcesIn(null)).toEqual([]);
  });

  it("sets only data.sent, only on the live totals that read a source", () => {
    const at = "2026-12-01T09:00:00.000Z";
    const next = withFrozenTotals(doc, { redBag: 312, sleigh: null }, at) as typeof doc;
    expect(next.blocks[1].data).toEqual({ source: "redBag", after: "bags", sent: { value: 312, at } });
    expect(next.blocks[2].data).toEqual({ source: "sleigh", sent: { value: null, at } });
    expect(next.blocks[0]).toEqual(doc.blocks[0]);
    expect(next.blocks[3]).toEqual(doc.blocks[3]);
    // The original is not changed.
    expect((doc.blocks[1].data as Record<string, unknown>).sent).toBeUndefined();
  });

  it("takes a frozen number out again before a draft or template is saved", () => {
    const frozen = withFrozenTotals(doc, { redBag: 312, sleigh: 100 }, "2026-12-01T09:00:00.000Z");
    expect(withoutFrozenTotals(frozen)).toEqual(doc);
  });

  it("leaves a newsletter with no live totals exactly as it was, the same object", () => {
    const plain = { blocks: [{ type: "text", variant: 0, data: { text: "Hi" }, size: 0 }] };
    expect(withoutFrozenTotals(plain)).toBe(plain);
  });
});

describe("the checks before sending", () => {
  const ctx = (over: Record<string, unknown> = {}) => ({ subject: "A subject", testSent: true, today: "2026-11-14", ...over });
  const one = (type: BlockType, data: Record<string, unknown>, variant = 0) =>
    newsletterDocSchema.parse({ blocks: [{ type, variant, data }] });
  const said = (d: ReturnType<typeof one>, over = {}) => preflightNewsletter(d, ctx(over)).map((f) => `${f.level}: ${f.message}`).join("\n");

  it("blocks a countdown with no date or a date that is not real", () => {
    expect(said(one("countdown", { label: "until Christmas Eve" }))).toContain("block: A countdown has no date");
    expect(said(one("countdown", { date: "2026-02-31" }))).toContain("block: A countdown has no date");
  });

  it("warns on a countdown whose day has come or passed", () => {
    expect(said(one("countdown", { date: "2026-11-14" }))).toContain("warn: A countdown's day has already come");
    expect(said(one("countdown", { date: "2026-12-24" }))).not.toContain("countdown");
  });

  it("warns on a countdown whose day comes before the newsletter is scheduled to send", () => {
    const d = one("countdown", { date: "2026-12-01" });
    expect(said(d, { sendAt: "2026-12-02T09:00:00.000Z" })).toContain("warn: A countdown's day comes before this is scheduled to send");
    expect(said(d, { sendAt: "2026-11-20T09:00:00.000Z" })).not.toContain("countdown");
  });

  it("warns when a live total has no number to show right now", () => {
    const d = one("liveTotal", { source: "redBag", fallbackText: "Every gift helps." });
    expect(said(d, { live: { redBag: 0 } })).toContain("warn: A live total has no number to show right now");
    expect(said(d, { live: { redBag: 12 } })).not.toContain("live total");
    // Without today's numbers the check cannot know, so it says nothing.
    expect(said(d)).not.toContain("live total");
    expect(said(one("liveTotal", { source: "typed", typed: "" }))).toContain("A live total has no number to show right now");
  });

  it("counts a live total's button link that is not a link as a dead button", () => {
    expect(said(one("liveTotal", { source: "typed", typed: "5", label: "Go", href: "nbcc.scot" }))).toContain("block: A button has no working link");
  });
});

describe("existing newsletters are untouched", () => {
  it("renders a document with no live blocks the same with or without live numbers and a day", () => {
    const doc = newsletterDocSchema.parse({ blocks: [{ type: "text", variant: 0, data: { text: "Hello" } }] });
    expect(renderNewsletter(doc, { firstName: "Jane", live: { redBag: 5 }, today: "2026-11-14" })).toBe(renderNewsletter(doc, { firstName: "Jane" }));
  });
});
