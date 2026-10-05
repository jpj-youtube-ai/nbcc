import { describe, it, expect } from "vitest";
import { AREAS, FEATURES, LAUNCH_AT, reachableAreas, arrivalsSince, featureIsNew, isNew } from "../../src/admin/whats-new";
import { roleToPermissions, SECTIONS } from "../../src/admin/permissions";

// TASK-478: a New pill on each admin section that holds something a person has not seen, cleared
// for that person alone when they open it. These are the rules; the database and routes sit on top.

const at = (iso: string) => new Date(iso);

describe("the sections that can carry a New pill", () => {
  it("covers every kind of arrival the client asked for, and the Events page", () => {
    expect(AREAS.map((a) => a.area)).toEqual([
      "contact", "stories", "donations", "monthly", "fulfilments", "ball", "newsletter", "events", "analytics", "qr", "fundraising",
    ]);
  });

  // The same gates the menu uses, so a pill never sits on a section the person cannot open.
  it("gates each on the permission its menu link uses", () => {
    const gate = Object.fromEntries(AREAS.map((a) => [a.area, `${a.section}:${a.level}`]));
    expect(gate).toEqual({
      contact: "contact:view", stories: "stories:view", donations: "donations:view",
      monthly: "donations:view", fulfilments: "business-supporters:edit", ball: "ball:view",
      newsletter: "newsletter:view", events: "events:view", analytics: "analytics:view",
      // TASK-492: QR codes has no permission of its own; its menu link gates on Site pages.
      qr: "site:view",
      fundraising: "fundraising:view",
    });
    for (const a of AREAS) expect(SECTIONS).toContain(a.section);
  });

  it("offers a person only the sections they may open", () => {
    const viewer = reachableAreas(roleToPermissions("viewer")).map((a) => a.area);
    expect(viewer).toContain("donations");
    expect(viewer).not.toContain("fulfilments"); // business-supporters needs edit
    expect(viewer).not.toContain("analytics"); // admins only by role (TASK-479)
    expect(reachableAreas(roleToPermissions("admin")).map((a) => a.area)).toEqual(AREAS.map((a) => a.area));
    expect(reachableAreas({})).toEqual([]);
  });

  // TASK-482: Admin > Analytics is a new screen, so everyone who can open it sees it as New once.
  it("announces Admin > Analytics", () => {
    expect(FEATURES.some((f) => f.area === "analytics")).toBe(true);
  });

  // TASK-495: Admin > Fundraising is a new screen, announced with the screen itself (the core,
  // TASK-493, has the API and no screen). Each new sign up is an arrival as well.
  it("announces Admin > Fundraising, with the screen that shows it", () => {
    const line = FEATURES.find((f) => f.area === "fundraising");
    expect(line?.what).toMatch(/^Admin > Fundraising: .*\(TASK-495\)$/);
  });

  it("lists new parts of the admin only against sections that exist", () => {
    for (const f of FEATURES) expect(AREAS.map((a) => a.area)).toContain(f.area);
  });
});

describe("since when a person has seen a section", () => {
  it("is the last time they opened it", () => {
    expect(arrivalsSince(at("2026-10-05T09:00:00Z"), at("2020-01-01T00:00:00Z"))).toEqual(at("2026-10-05T09:00:00Z"));
  });

  // Launch day must not light up years of old records.
  it("starts at launch for someone who has never opened it", () => {
    expect(arrivalsSince(null, at("2020-01-01T00:00:00Z"))).toEqual(LAUNCH_AT);
  });

  it("starts when their account was made, for someone invited after launch", () => {
    expect(arrivalsSince(null, at("2027-01-01T00:00:00Z"))).toEqual(at("2027-01-01T00:00:00Z"));
  });
});

describe("new parts of the admin", () => {
  const features = [{ area: "events" as const, added: at("2026-09-30T12:00:00Z"), what: "The Events page" }];

  it("are new to someone whose account predates them and who has not opened the section since", () => {
    expect(featureIsNew("events", null, at("2025-01-01T00:00:00Z"), features)).toBe(true);
    expect(featureIsNew("events", at("2026-10-01T08:00:00Z"), at("2025-01-01T00:00:00Z"), features)).toBe(false);
  });

  it("are not new to someone who joined after they were added", () => {
    expect(featureIsNew("events", null, at("2026-11-01T00:00:00Z"), features)).toBe(false);
  });

  it("belong only to their own section", () => {
    expect(featureIsNew("contact", null, at("2025-01-01T00:00:00Z"), features)).toBe(false);
  });
});

describe("is a section new to a person", () => {
  const base = { accountCreatedAt: at("2025-01-01T00:00:00Z"), features: [] };

  it("is when something arrived after they last opened it", () => {
    expect(isNew({ ...base, area: "contact", seenAt: at("2026-10-05T09:00:00Z"), latestArrival: at("2026-10-05T10:00:00Z") })).toBe(true);
  });

  it("is not when everything arrived before", () => {
    expect(isNew({ ...base, area: "contact", seenAt: at("2026-10-05T09:00:00Z"), latestArrival: at("2026-10-05T08:00:00Z") })).toBe(false);
    expect(isNew({ ...base, area: "contact", seenAt: null, latestArrival: at("2026-09-01T00:00:00Z") })).toBe(false); // before launch
    expect(isNew({ ...base, area: "contact", seenAt: null, latestArrival: null })).toBe(false);
  });

  // Postgres keeps microseconds; a JavaScript Date keeps milliseconds. An arrival the database has
  // already found later than the visit can come back looking like the same moment (TASK-478's first
  // CI run: an account and a sign-up made within one millisecond).
  it("is when something arrived in the same millisecond as the visit", () => {
    const moment = at("2026-10-05T09:00:00.123Z");
    expect(isNew({ ...base, area: "contact", seenAt: moment, latestArrival: new Date(moment) })).toBe(true);
  });

  it("is when a new part of the admin arrived there, even with no arrivals", () => {
    const features = [{ area: "events" as const, added: at("2026-09-30T12:00:00Z"), what: "The Events page" }];
    expect(isNew({ ...base, features, area: "events", seenAt: null, latestArrival: null })).toBe(true);
  });
});

// The Donations pill for Fill a Red Bag. Opening a section stamps it as seen now, and a part is new
// while it was added after that: so an entry dated ahead of the clock comes straight back after
// staff open Donations, and cannot be cleared until its date arrives. This one entry only.
describe("the Fill a Red Bag pill on Donations", () => {
  const entry = FEATURES.find((f) => f.area === "donations" && /Fill a Red Bag/.test(f.what));

  it("is announced on Donations", () => {
    expect(entry).toBeDefined();
  });

  it("is dated in the past, so it is never ahead of the clock", () => {
    expect(entry!.added.getTime()).toBeLessThanOrEqual(Date.now());
    // The day it shipped, and no later.
    expect(entry!.added.getTime()).toBeLessThanOrEqual(at("2026-10-05T23:59:59Z").getTime());
  });

  it("shows for an older account, and is cleared by opening Donations", () => {
    const account = at("2026-01-01T00:00:00Z");
    expect(featureIsNew("donations", null, account)).toBe(true);
    expect(featureIsNew("donations", new Date(), account)).toBe(false);
  });
});
