import { describe, it, expect } from "vitest";
import { mergeRecipients } from "../../src/newsletter/merge-recipients";

const r = (email: string, extra: Partial<{ donorId: number | null; subscriberId: number | null; fullName: string | null }> = {}) => ({
  email,
  donorId: extra.donorId ?? null,
  subscriberId: extra.subscriberId ?? null,
  fullName: extra.fullName ?? null,
});

describe("mergeRecipients", () => {
  it("returns a single audience unchanged", () => {
    const out = mergeRecipients([[r("a@x.test"), r("b@x.test")]]);
    expect(out.map((x) => x.email)).toEqual(["a@x.test", "b@x.test"]);
  });

  // The whole reason this function exists. Somebody on Volunteers AND Newsletter must get ONE
  // email, not one per audience.
  it("sends a person on two audiences exactly one email", () => {
    const out = mergeRecipients([
      [r("shared@x.test"), r("only-a@x.test")],
      [r("shared@x.test"), r("only-b@x.test")],
    ]);
    expect(out).toHaveLength(3);
    expect(out.filter((x) => x.email === "shared@x.test")).toHaveLength(1);
  });

  it("treats addresses that differ only by case as the same person", () => {
    const out = mergeRecipients([[r("Sam@X.test")], [r("sam@x.test")]]);
    expect(out).toHaveLength(1);
    expect(out[0].email).toBe("sam@x.test");
  });

  // A donor row carries the donor id used for the unsubscribe token and the merge name. If the same
  // person also sits on a manual list, keeping the richer record means the greeting still works.
  it("keeps the record that knows who the person is", () => {
    const out = mergeRecipients([
      [r("sam@x.test")],
      [r("sam@x.test", { donorId: 7, fullName: "Sam Tait" })],
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].donorId).toBe(7);
    expect(out[0].fullName).toBe("Sam Tait");
  });

  it("does not let a later, emptier record overwrite a known name", () => {
    const out = mergeRecipients([
      [r("sam@x.test", { donorId: 7, fullName: "Sam Tait" })],
      [r("sam@x.test")],
    ]);
    expect(out[0].donorId).toBe(7);
    expect(out[0].fullName).toBe("Sam Tait");
  });

  it("sorts by email so the queue order is stable and reviewable", () => {
    const out = mergeRecipients([[r("c@x.test")], [r("a@x.test")], [r("b@x.test")]]);
    expect(out.map((x) => x.email)).toEqual(["a@x.test", "b@x.test", "c@x.test"]);
  });

  it("handles no audiences and empty audiences", () => {
    expect(mergeRecipients([])).toEqual([]);
    expect(mergeRecipients([[], []])).toEqual([]);
  });
});
