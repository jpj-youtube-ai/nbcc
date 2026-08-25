import { describe, it, expect } from "vitest";
import { buildPreferences, applyPreferences, joinableLists } from "../../src/newsletter/preferences";

const lists = [
  { id: 3, name: "Volunteers" },
  { id: 7, name: "Business supporters" },
];

describe("buildPreferences — what a person is allowed to SEE", () => {
  // The rule the whole feature turns on. Anyone holding a forwarded email holds the token, so the
  // page must never become a catalogue of who we have lists for.
  it("shows only the lists this address is actually on", () => {
    const view = buildPreferences({
      email: "morven@example.test",
      memberships: [{ id: 11, listId: 3, listName: "Volunteers" }],
      donor: null,
    });
    expect(view.lists.map((l) => l.listName)).toEqual(["Volunteers"]);
    expect(JSON.stringify(view)).not.toContain("Business supporters");
  });

  it("never leaks a list even when one is passed in alongside", () => {
    const view = buildPreferences({
      email: "morven@example.test",
      memberships: [],
      donor: null,
    });
    expect(view.lists).toEqual([]);
    for (const l of lists) expect(JSON.stringify(view)).not.toContain(l.name);
  });

  // A donor-only supporter must still get a usable page, not an empty one.
  it("offers the donor's two switches when the address belongs to a donor", () => {
    const view = buildPreferences({
      email: "sam@example.test",
      memberships: [],
      donor: { id: 5, emailConsent: true, thankyouConsent: true },
    });
    expect(view.donor).toEqual({ newsletter: true, thankYou: true });
    expect(view.lists).toEqual([]);
  });

  it("omits the donor switches entirely for a plain subscriber", () => {
    const view = buildPreferences({
      email: "vol@example.test",
      memberships: [{ id: 11, listId: 3, listName: "Volunteers" }],
      donor: null,
    });
    expect(view.donor).toBeNull();
  });

  it("reflects an opt-out that has already happened", () => {
    const view = buildPreferences({
      email: "sam@example.test",
      memberships: [],
      donor: { id: 5, emailConsent: false, thankyouConsent: true },
    });
    expect(view.donor).toEqual({ newsletter: false, thankYou: true });
  });
});

describe("applyPreferences — what a submission is allowed to CHANGE", () => {
  const view = buildPreferences({
    email: "morven@example.test",
    memberships: [
      { id: 11, listId: 3, listName: "Volunteers" },
      { id: 12, listId: 7, listName: "Business supporters" },
    ],
    donor: { id: 5, emailConsent: true, thankyouConsent: true },
  });

  it("leaves the lists that were kept, and drops the ones that were not", () => {
    const plan = applyPreferences(view, { keepListIds: [3], newsletter: true, thankYou: true });
    expect(plan.unsubscribeMemberIds).toEqual([12]);
    expect(plan.setNewsletter).toBe(true);
    expect(plan.setThankYou).toBe(true);
  });

  // The consent decisions are independent — the whole point of splitting the column.
  it("stops the newsletter while keeping thank-you letters", () => {
    const plan = applyPreferences(view, { keepListIds: [3, 7], newsletter: false, thankYou: true });
    expect(plan.setNewsletter).toBe(false);
    expect(plan.setThankYou).toBe(true);
    expect(plan.unsubscribeMemberIds).toEqual([]);
  });

  // A tampered submission naming a list this person is not on must not become an instruction.
  it("ignores a membership id that is not this person's", () => {
    const plan = applyPreferences(view, { keepListIds: [3, 999], newsletter: true, thankYou: true });
    expect(plan.unsubscribeMemberIds).toEqual([12]);
  });

  it("turning everything off unsubscribes every membership and both consents", () => {
    const plan = applyPreferences(view, { keepListIds: [], newsletter: false, thankYou: false });
    expect(plan.unsubscribeMemberIds).toEqual([11, 12]);
    expect(plan.setNewsletter).toBe(false);
    expect(plan.setThankYou).toBe(false);
    expect(plan.leavesNothing).toBe(true);
  });

  it("knows when the person still hears from us", () => {
    const plan = applyPreferences(view, { keepListIds: [3], newsletter: false, thankYou: false });
    expect(plan.leavesNothing).toBe(false);
  });

  // A subscriber has no donor row, so a submission claiming otherwise cannot invent consent.
  it("cannot set donor consent for an address with no donor row", () => {
    const subscriberView = buildPreferences({
      email: "vol@example.test",
      memberships: [{ id: 11, listId: 3, listName: "Volunteers" }],
      donor: null,
    });
    const plan = applyPreferences(subscriberView, { keepListIds: [3], newsletter: true, thankYou: true });
    expect(plan.setNewsletter).toBeNull();
    expect(plan.setThankYou).toBeNull();
  });
});

// TASK-291: public lists may be OFFERED to someone who is not on them. Private ones may never be
// mentioned — that is the whole point of the flag.
describe("joinableLists — what a stranger may be offered", () => {
  const all = [
    { id: 1, name: "Newsletter", kind: "everyone" as const, visibility: "public" as const },
    { id: 3, name: "Volunteers", kind: "manual" as const, visibility: "private" as const },
    { id: 4, name: "Events", kind: "manual" as const, visibility: "public" as const },
    { id: 9, name: "Donors", kind: "donors" as const, visibility: "public" as const },
  ];

  it("offers a public list the person is not on", () => {
    const out = joinableLists(all, []);
    expect(out.map((l) => l.name)).toEqual(["Newsletter", "Events"]);
  });

  // The disclosure rule. A private list must not appear anywhere in the output, at any time.
  it("never offers a private list", () => {
    const out = joinableLists(all, []);
    expect(JSON.stringify(out)).not.toContain("Volunteers");
  });

  // Donors follows donor consent and cannot be joined by hand, so it is never an option even
  // though it is marked public.
  it("never offers the automatic Donors audience", () => {
    const out = joinableLists(all, []);
    expect(JSON.stringify(out)).not.toContain("Donors");
  });

  it("does not offer something they are already on", () => {
    const out = joinableLists(all, [4]);
    expect(out.map((l) => l.name)).toEqual(["Newsletter"]);
  });

  it("offers nothing when they are already on everything public", () => {
    expect(joinableLists(all, [1, 4])).toEqual([]);
  });
});
