import { describe, it, expect, vi } from "vitest";
import { gatherNeeds, type NeedSource } from "../../src/admin/overview-sources";
import { roleToPermissions } from "../../src/admin/permissions";

// TASK-507: gathering "Needs you". Each source runs only for people who may see its screen, each on
// its own, so one that fails is named and the rest still count. The sources here are invented.

const source = (over: Partial<NeedSource>): NeedSource => ({
  name: "Contact form",
  section: "contact",
  level: "view",
  read: async () => ({ contactWaiting: { count: 2 } }),
  ...over,
});

describe("gathering what needs people", () => {
  it("asks only the sources a person may see, and counts what they find", async () => {
    const hidden = vi.fn(async () => ({ businessCalls: { count: 9 } }));
    const got = await gatherNeeds(roleToPermissions("viewer"), [
      source({}),
      // Business supporters needs edit; a viewer has none.
      source({ name: "Business supporters", section: "business-supporters", level: "edit", read: hidden }),
    ]);
    expect(got.counts).toEqual({ contactWaiting: { count: 2 } });
    expect(got.failed).toEqual([]);
    expect(hidden).not.toHaveBeenCalled();
  });

  it("names a source that fails, and still counts the rest", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const got = await gatherNeeds(roleToPermissions("admin"), [
      source({}),
      source({ name: "Festive Ball", section: "ball", read: async () => { throw new Error("down"); } }),
    ]);
    expect(got.counts).toEqual({ contactWaiting: { count: 2 } });
    expect(got.failed).toEqual(["Festive Ball"]);
  });

  it("lets one source count several kinds, and names a screen once however many of its sources fail", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const got = await gatherNeeds(roleToPermissions("admin"), [
      source({ name: "Fundraising", section: "fundraising", read: async () => ({ fundraisingNew: { count: 1 }, fundraiserCalls: { count: 3 } }) }),
      source({ name: "Claims", section: "claims", read: async () => { throw new Error("a"); } }),
      source({ name: "Claims", section: "claims", read: async () => { throw new Error("b"); } }),
    ]);
    expect(got.counts).toEqual({ fundraisingNew: { count: 1 }, fundraiserCalls: { count: 3 } });
    expect(got.failed).toEqual(["Claims"]);
  });

  it("asks nothing for someone who can see nothing", async () => {
    const read = vi.fn(async () => ({}));
    const none = Object.fromEntries(Object.keys(roleToPermissions("admin")).map((k) => [k, "none"])) as ReturnType<typeof roleToPermissions>;
    const got = await gatherNeeds(none, [source({ read }), source({ section: "ball", read })]);
    expect(read).not.toHaveBeenCalled();
    expect(got).toEqual({ counts: {}, failed: [] });
  });
});
