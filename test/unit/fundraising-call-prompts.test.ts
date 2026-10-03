import { describe, it, expect } from "vitest";
import { callPrompts, pacePrompt, PROMPT_KEYS, PROMPT_RULES, promptCounts, type PromptFacts } from "../../src/fundraising/call-prompts";
import { meter, type FundraiserRecord, type Meter } from "../../src/fundraising/model";

// TASK-515: the smart call prompts in Admin > Fundraising. Pure rules, every one against a fixed UK
// day. Every name and amount here is invented.

type F = FundraiserRecord & { meter: Meter };

const WANTS = { posterCount: 0, leafletCount: 0, bucketCount: 0, tinCount: 0, leaflets: 0, buckets: 0, shoutOut: false, attend: false };

function fr(over: Partial<FundraiserRecord> = {}, raised = 0): F {
  const base = {
    id: 7,
    slug: "sams-santa-dash",
    path: "raising",
    kind: "run_walk",
    title: "Sam's Santa Dash",
    description: "A run.",
    eventDate: "2026-12-06",
    startTime: null,
    venue: "",
    town: "Exampleton",
    targetPence: 60000,
    public: true,
    status: "approved",
    name: "Sam Example",
    email: "sam@example.com",
    phone: "07700 900123",
    socialLink: null,
    socialOk: true,
    wants: { ...WANTS },
    postAddress: null,
    postLine1: null,
    postLine2: null,
    postTown: null,
    postPostcode: null,
    newsletterOk: false,
    imageSrc: null,
    declinedReason: null,
    createdAt: "2026-10-01T09:00:00.000Z",
    approvedAt: "2026-10-06T09:00:00.000Z",
    approvedBy: "admin:fern@example.com",
    updatedAt: "2026-10-06T09:00:00.000Z",
    updatedBy: null,
    cardLine: null,
    endTime: null,
    timeTbc: false,
    venueAddress: null,
    venuePostcode: null,
    access: [],
    price: null,
    booking: null,
    ticketUrl: null,
    ageLimit: null,
    dressCode: null,
    included: null,
    creditName: null,
    ...over,
  } as FundraiserRecord;
  return { ...base, meter: meter({ onlinePence: raised, cashPence: 0, targetPence: base.targetPence }) };
}

const facts = (over: Partial<PromptFacts> = {}): PromptFacts => ({ lastOnlineGiftAt: "2026-11-25T10:00:00.000Z", calls: [], ...over });
const keys = (f: F, today: string, x: Partial<PromptFacts> = {}) => callPrompts(f, facts(x), today).map((p) => p.key);

describe("the rule table", () => {
  it("has one rule for every prompt, each with a pill, a reason and talking points", () => {
    expect(PROMPT_RULES.map((r) => r.key)).toEqual([...PROMPT_KEYS]);
    for (const r of PROMPT_RULES) {
      expect(r.label.length).toBeGreaterThan(0);
      expect(r.pill.length).toBeGreaterThan(0);
      expect(r.pill.length).toBeLessThanOrEqual(r.label.length);
      expect(r.points.length).toBeGreaterThan(0);
      for (const words of [r.pill, r.label, ...r.points]) expect(words).not.toMatch(/[–—]| - /);
    }
  });
});

describe("pace: behind, ahead or on track", () => {
  it("is behind when the date is 1 to 14 days away and less than a third is raised", () => {
    expect(pacePrompt(fr({}, 19999), "2026-11-22")).toBe("behind"); // 14 days away, under £200 of £600
    expect(pacePrompt(fr({}, 19999), "2026-12-05")).toBe("behind"); // 1 day away
    expect(pacePrompt(fr({}, 19999), "2026-11-21")).not.toBe("behind"); // 15 days away
    expect(pacePrompt(fr({}, 19999), "2026-12-06")).toBeNull(); // the day itself
    expect(pacePrompt(fr({}, 20000), "2026-12-01")).not.toBe("behind"); // exactly a third
  });

  it("is ahead when the target is reached with more than 7 days to go", () => {
    expect(pacePrompt(fr({}, 60000), "2026-11-28")).toBe("ahead"); // 8 days away
    expect(pacePrompt(fr({}, 60000), "2026-11-29")).toBeNull(); // 7 days away: not ahead, and not on track
  });

  it("is on track within a quarter either side of the straight line from approval to the date", () => {
    // Approved 6 Oct, date 6 Dec: 61 days. On 5 Nov (30 days in) the line is at £295.08 of £600.
    expect(pacePrompt(fr({}, 29500), "2026-11-05")).toBe("on_track");
    expect(pacePrompt(fr({}, 22200), "2026-11-05")).toBe("on_track"); // just inside 75%
    expect(pacePrompt(fr({}, 22000), "2026-11-05")).toBeNull(); // just under
    expect(pacePrompt(fr({}, 36800), "2026-11-05")).toBe("on_track"); // just inside 125%
    expect(pacePrompt(fr({}, 37000), "2026-11-05")).toBeNull();
  });

  it("waits a quarter of the way in before calling anyone on track", () => {
    expect(pacePrompt(fr({}, 3000), "2026-10-15")).toBeNull();
  });

  it("needs a target, a date, an approval and a page raising money", () => {
    expect(pacePrompt(fr({ targetPence: null }, 100), "2026-12-01")).toBeNull();
    expect(pacePrompt(fr({ eventDate: null }, 100), "2026-12-01")).toBeNull();
    expect(pacePrompt(fr({ approvedAt: null }, 100), "2026-12-01")).toBeNull();
    expect(pacePrompt(fr({ status: "finished" }, 100), "2026-12-01")).toBeNull();
    expect(pacePrompt(fr({ path: "event", targetPence: null }, 0), "2026-12-01")).toBeNull();
  });
});

describe("gone quiet", () => {
  it("shows after 14 days with no online gift, before the date", () => {
    expect(keys(fr({}, 10000), "2026-11-20", { lastOnlineGiftAt: "2026-11-06T12:00:00.000Z" })).toContain("quiet");
    expect(keys(fr({}, 10000), "2026-11-19", { lastOnlineGiftAt: "2026-11-06T12:00:00.000Z" })).not.toContain("quiet");
    // On or after the date it is not quiet, it is over.
    expect(keys(fr({}, 10000), "2026-12-06", { lastOnlineGiftAt: "2026-11-06T12:00:00.000Z" })).not.toContain("quiet");
  });

  it("counts from its approval when nobody has given yet", () => {
    expect(keys(fr({}, 0), "2026-10-20", { lastOnlineGiftAt: null })).toContain("quiet");
    expect(keys(fr({}, 0), "2026-10-19", { lastOnlineGiftAt: null })).not.toContain("quiet");
  });

  it("is only for a live page", () => {
    expect(keys(fr({ public: false }, 0), "2026-11-20", { lastOnlineGiftAt: null })).not.toContain("quiet");
    expect(keys(fr({ status: "new" }, 0), "2026-11-20", { lastOnlineGiftAt: null })).toEqual([]);
  });

  it("goes quiet for a fortnight after a call about it", () => {
    const calls = [{ prompt: "quiet" as const, calledAt: "2026-11-20T10:00:00.000Z" }];
    expect(keys(fr({}, 10000), "2026-11-25", { lastOnlineGiftAt: "2026-11-01T12:00:00.000Z", calls })).not.toContain("quiet");
    expect(keys(fr({}, 10000), "2026-12-04", { lastOnlineGiftAt: "2026-11-01T12:00:00.000Z", calls })).toContain("quiet");
  });
});

describe("material suggestions", () => {
  it("offers a collection tin to a bake sale or coffee morning that asked for none", () => {
    const sale = fr({ kind: "bake_sale", path: "event", targetPence: null, eventDate: "2027-02-01" });
    expect(keys(sale, "2026-11-20")).toContain("tin");
    expect(keys(fr({ kind: "bake_sale", wants: { ...WANTS, tinCount: 1 } }), "2026-11-20")).not.toContain("tin");
    expect(keys(fr({ kind: "bake_sale", wants: { ...WANTS, bucketCount: 2 } }), "2026-11-20")).not.toContain("tin");
    expect(keys(fr({ kind: "bake_sale", wants: { ...WANTS, buckets: 1 } }), "2026-11-20")).not.toContain("tin");
  });

  it("reads the newer split kinds as well as the old combined ones", () => {
    for (const kind of ["bake_sale_2", "coffee_morning"]) expect(keys(fr({ kind } as never), "2026-11-20")).toContain("tin");
    for (const kind of ["run", "walk"]) expect(keys(fr({ kind } as never), "2026-11-20")).toContain("sponsor_form");
    expect(keys(fr({ kind: "quiz" } as never), "2026-11-20")).not.toContain("tin");
  });

  it("points a run, walk or Santa dash to the sponsor form unless they asked for one", () => {
    expect(keys(fr({ kind: "run_walk" }), "2026-11-20")).toContain("sponsor_form");
    expect(keys(fr({ kind: "santa_dash" }), "2026-11-20")).toContain("sponsor_form");
    expect(keys(fr({ kind: "quiz_party" }), "2026-11-20")).not.toContain("sponsor_form");
    expect(keys(fr({ kind: "santa_dash" }), "2026-11-20", { sponsorFormAsked: true })).not.toContain("sponsor_form");
  });

  it("offers posters and leaflets within 21 days of the date when none were asked for", () => {
    expect(keys(fr(), "2026-11-15")).toContain("posters"); // 21 days
    expect(keys(fr(), "2026-11-14")).not.toContain("posters"); // 22 days
    expect(keys(fr({ wants: { ...WANTS, posterCount: 10 } }), "2026-11-20")).not.toContain("posters");
    expect(keys(fr({ wants: { ...WANTS, leaflets: 50 } }), "2026-11-20")).not.toContain("posters");
    expect(keys(fr(), "2026-12-07")).not.toContain("posters"); // past the date
  });

  it("stops suggesting a thing once somebody has called about it", () => {
    const calls = [{ prompt: "sponsor_form" as const, calledAt: "2026-11-01T10:00:00.000Z" }];
    expect(keys(fr({ kind: "run_walk" }), "2026-11-20", { calls })).not.toContain("sponsor_form");
  });
});

describe("each prompt as staff read it", () => {
  it("gives a reason with the numbers, and the talking points", () => {
    const [behind] = callPrompts(fr({}, 12000), facts(), "2026-11-28");
    expect(behind.key).toBe("behind");
    expect(behind.label).toBe("Behind");
    expect(behind.reason).toBe("Its date is 8 days away and it has raised £120 of its £600 target, under a third.");
    expect(behind.points.join(" ")).toMatch(/posters/i);
    expect(behind.points.join(" ")).toMatch(/shout out/i);
    expect(behind.points.join(" ")).toMatch(/come along/i);
  });

  it("is cleared for good by a call about behind, ahead or on track", () => {
    const calls = [{ prompt: "behind" as const, calledAt: "2026-11-27T10:00:00.000Z" }];
    expect(keys(fr({}, 12000), "2026-11-28", { calls })).not.toContain("behind");
  });

  it("says nothing about a sign up that is not approved", () => {
    expect(keys(fr({ status: "declined" }, 0), "2026-11-28")).toEqual([]);
  });
});

describe("the counts for the Monday summary", () => {
  it("adds up each kind of prompt", () => {
    const list = [
      { f: fr({ id: 1 }, 12000), facts: facts() }, // behind, sponsor form, posters
      { f: fr({ id: 2, kind: "bake_sale" }, 60000), facts: facts() }, // ahead, tin, posters
      { f: fr({ id: 3, status: "new" }, 0), facts: facts() },
    ];
    // The sponsor form shows as a pill but is not counted: nothing can be done about it but a call.
    expect(promptCounts(list, "2026-11-22")).toEqual({ behind: 1, ahead: 1, onTrack: 0, quiet: 0, materials: 3 });
  });
});
