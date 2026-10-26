import { describe, it, expect } from "vitest";
import { chaseRecipientsSchema } from "../../src/ball/chase";

// TASK-576: who the volunteers' chase list goes to. It carries people's phone numbers, so only
// nbcc.scot addresses are allowed. Every address and name here is invented.

const SAVED_MESSAGE = "Only nbcc.scot addresses: this list carries people's phone numbers.";

describe("chaseRecipientsSchema", () => {
  it("saves an nbcc.scot list tidied and in order by name", () => {
    const parsed = chaseRecipientsSchema.parse([
      { email: "  Zed.Example@NBCC.scot ", name: " Zed Example " },
      { email: "amy.example@nbcc.scot", name: "Amy Example" },
    ]);
    expect(parsed).toEqual([
      { email: "amy.example@nbcc.scot", name: "Amy Example" },
      { email: "zed.example@nbcc.scot", name: "Zed Example" },
    ]);
  });

  it("accepts an empty list", () => {
    expect(chaseRecipientsSchema.parse([])).toEqual([]);
  });

  it("refuses an address that is not nbcc.scot, with the reason", () => {
    const r = chaseRecipientsSchema.safeParse([{ email: "someone@example.com", name: "Some One" }]);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.map((i) => i.message)).toContain(SAVED_MESSAGE);
  });

  it("refuses a look-alike that only contains nbcc.scot", () => {
    const r = chaseRecipientsSchema.safeParse([{ email: "someone@nbcc.scot.example.com", name: "Some One" }]);
    expect(r.success).toBe(false);
  });

  it("refuses more than ten addresses", () => {
    const eleven = Array.from({ length: 11 }, (_, i) => ({ email: `person${i}@nbcc.scot`, name: `Person ${i}` }));
    const r = chaseRecipientsSchema.safeParse(eleven);
    expect(r.success).toBe(false);
    // The chase list's own words, not the ticket report's ("The report can go to up to 10 people.").
    if (!r.success) expect(r.error.issues.map((i) => i.message)).toContain("The chase list can go to up to 10 people.");
    expect(chaseRecipientsSchema.safeParse(eleven.slice(0, 10)).success).toBe(true);
  });

  it("refuses an address twice", () => {
    const r = chaseRecipientsSchema.safeParse([
      { email: "same@nbcc.scot", name: "One" },
      { email: "SAME@nbcc.scot", name: "Two" },
    ]);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.map((i) => i.message)).toContain("That address is already on the list.");
  });
});
