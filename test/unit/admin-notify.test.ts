import { describe, it, expect } from "vitest";
import { BURST_CAP, dueNotifications, quietNow } from "../../src/admin/notify";
import type { NotifyPrefs } from "../../src/admin/push";
import type { ArrivalItem } from "../../src/admin/whats-new";

// What actually gets sent to a phone (TASK-NNN). Pure decisions only — no database, no network.
//
// Jaimie asked for a buzz every single time, with no bundling and no quiet hours, and that is the
// default these tests pin. The switches exist so that changing her mind costs a tap rather than
// another piece of work, and the burst cap exists because she also agreed that a bulk import
// firing two hundred notifications is not what "every time" meant.

const OFF: NotifyPrefs = { bundle: false, quietFrom: null, quietTo: null, areasOff: [] };
const at = (n: number): ArrivalItem => ({
  at: new Date(Date.UTC(2026, 10, 12, 12, 0, n)),
  area: "donations",
  line: `£${n} donation — website`,
});

describe("one buzz per arrival, as asked for", () => {
  it("sends one notification each", () => {
    const out = dueNotifications({ areas: [{ area: "donations", items: [at(1), at(2), at(3)] }], prefs: OFF });
    expect(out).toHaveLength(3);
    expect(out.map((o) => o.body)).toEqual(["£1 donation — website", "£2 donation — website", "£3 donation — website"]);
  });

  it("says which part of the admin it is about, so the title is not just NBCC every time", () => {
    const out = dueNotifications({ areas: [{ area: "donations", items: [at(1)] }], prefs: OFF });
    expect(out[0].title).toBe("Donations");
    expect(out[0].area).toBe("donations");
  });

  it("sends nothing when nothing has arrived", () => {
    expect(dueNotifications({ areas: [], prefs: OFF })).toEqual([]);
    expect(dueNotifications({ areas: [{ area: "donations", items: [] }], prefs: OFF })).toEqual([]);
  });

  it("covers several areas in one sweep", () => {
    const out = dueNotifications({
      areas: [
        { area: "donations", items: [at(1)] },
        { area: "contact", items: [{ at: new Date(), area: "contact", line: "New message on the contact form" }] },
      ],
      prefs: OFF,
    });
    expect(out).toHaveLength(2);
    expect(out.map((o) => o.title)).toEqual(["Donations", "Contact form"]);
  });
});

describe("the burst cap", () => {
  // A CSV import or a webhook replay puts hundreds of rows in at once. Two hundred buzzes is the
  // "switch it off forever" moment the whole design is trying to avoid, so Jaimie agreed to this
  // one exception on 12 Nov.
  it("collapses a burst into a single notification saying how many", () => {
    const items = Array.from({ length: 47 }, (_, i) => at(i));
    const out = dueNotifications({ areas: [{ area: "donations", items }], prefs: OFF });
    expect(out).toHaveLength(1);
    expect(out[0].body).toContain("47 new things");
  });

  it("counts across the whole sweep, not per area", () => {
    const half = Array.from({ length: 11 }, (_, i) => at(i));
    const out = dueNotifications({
      areas: [
        { area: "donations", items: half },
        { area: "fundraising", items: half.map((x) => ({ ...x, area: "fundraising" as const, line: "New Get involved sign-up" })) },
      ],
      prefs: OFF,
    });
    expect(out).toHaveLength(1);
    expect(out[0].body).toContain("22 new things");
  });

  it("leaves a normal busy spell completely alone", () => {
    const items = Array.from({ length: BURST_CAP }, (_, i) => at(i));
    expect(dueNotifications({ areas: [{ area: "donations", items }], prefs: OFF })).toHaveLength(BURST_CAP);
  });

  // A burst spans areas, so it cannot claim to be about one of them.
  it("opens the admin generally rather than pretending to be one section", () => {
    const items = Array.from({ length: 30 }, (_, i) => at(i));
    expect(dueNotifications({ areas: [{ area: "donations", items }], prefs: OFF })[0].area).toBeNull();
  });
});

describe("the switches, all off by default", () => {
  it("bundles into one when bundling is on", () => {
    const out = dueNotifications({ areas: [{ area: "donations", items: [at(1), at(2)] }], prefs: { ...OFF, bundle: true } });
    expect(out).toHaveLength(1);
    expect(out[0].body).toContain("2 new things");
  });

  it("says the single thing properly even when bundling is on", () => {
    const out = dueNotifications({ areas: [{ area: "donations", items: [at(1)] }], prefs: { ...OFF, bundle: true } });
    expect(out).toHaveLength(1);
    expect(out[0].body).toBe("£1 donation — website");
  });

  it("sends nothing for an area somebody has switched off", () => {
    const out = dueNotifications({ areas: [{ area: "donations", items: [at(1)] }], prefs: { ...OFF, areasOff: ["donations"] } });
    expect(out).toEqual([]);
  });

  it("switching one area off leaves the others alone", () => {
    const out = dueNotifications({
      areas: [
        { area: "donations", items: [at(1)] },
        { area: "contact", items: [{ at: new Date(), area: "contact", line: "New message on the contact form" }] },
      ],
      prefs: { ...OFF, areasOff: ["donations"] },
    });
    expect(out.map((o) => o.area)).toEqual(["contact"]);
  });
});

describe("quiet hours", () => {
  const quiet: NotifyPrefs = { ...OFF, quietFrom: "23:00:00", quietTo: "07:00:00" };

  it("is off unless somebody sets it", () => {
    expect(quietNow(OFF, new Date("2026-11-12T03:00:00Z"))).toBe(false);
  });

  // The usual case spans midnight, which a naive from < now < to gets backwards.
  it("covers the night when it runs past midnight", () => {
    expect(quietNow(quiet, new Date("2026-11-12T23:30:00Z"))).toBe(true);
    expect(quietNow(quiet, new Date("2026-11-12T02:00:00Z"))).toBe(true);
    expect(quietNow(quiet, new Date("2026-11-12T06:59:00Z"))).toBe(true);
    expect(quietNow(quiet, new Date("2026-11-12T07:01:00Z"))).toBe(false);
    expect(quietNow(quiet, new Date("2026-11-12T12:00:00Z"))).toBe(false);
  });

  it("also works for a daytime quiet spell that does not span midnight", () => {
    const day: NotifyPrefs = { ...OFF, quietFrom: "09:00:00", quietTo: "17:00:00" };
    expect(quietNow(day, new Date("2026-11-12T12:00:00Z"))).toBe(true);
    expect(quietNow(day, new Date("2026-11-12T20:00:00Z"))).toBe(false);
  });

  it("is off unless BOTH ends are set, so half a setting never silences a phone", () => {
    expect(quietNow({ ...OFF, quietFrom: "23:00:00", quietTo: null }, new Date("2026-11-12T23:30:00Z"))).toBe(false);
    expect(quietNow({ ...OFF, quietFrom: null, quietTo: "07:00:00" }, new Date("2026-11-12T03:00:00Z"))).toBe(false);
  });
});
