import { describe, it, expect } from "vitest";
import { prefsFromRow, subscriptionRow } from "../../src/admin/push";

// What we store about a phone, and what each person wants on it (TASK-NNN).
//
// Unit tests stay database-free (golden rule 5), so these cover the two pure mappings either side
// of the SQL: browser subscription in, row out; row out of the database, settings in.

describe("turning a browser subscription into a row", () => {
  it("keeps the endpoint and both keys", () => {
    expect(subscriptionRow(7, { endpoint: "https://push.example/abc", keys: { p256dh: "P", auth: "A" } })).toEqual({
      userId: 7,
      endpoint: "https://push.example/abc",
      p256dh: "P",
      auth: "A",
    });
  });

  // Half a subscription is worse than none: it would sit in the table failing on every sweep,
  // counting up failures that no retry could ever fix.
  it.each([
    ["no keys at all", { endpoint: "https://push.example/abc" }],
    ["an empty keys object", { endpoint: "https://push.example/abc", keys: {} }],
    ["no p256dh", { endpoint: "https://push.example/abc", keys: { auth: "A" } }],
    ["no auth", { endpoint: "https://push.example/abc", keys: { p256dh: "P" } }],
  ])("refuses %s", (_what, sub) => {
    expect(() => subscriptionRow(7, sub as never)).toThrow(/key/i);
  });

  it("refuses a subscription with no endpoint to send to", () => {
    expect(() => subscriptionRow(7, { endpoint: "", keys: { p256dh: "P", auth: "A" } })).toThrow(/endpoint/i);
  });

  // A push endpoint is a URL we will POST to on a timer. Anything that is not plainly https is
  // not something this should be talked into contacting.
  it.each(["http://push.example/abc", "file:///etc/passwd", "not a url"])("refuses %s", (endpoint) => {
    expect(() => subscriptionRow(7, { endpoint, keys: { p256dh: "P", auth: "A" } })).toThrow(/https/i);
  });
});

describe("what somebody's settings are before they have touched them", () => {
  // No row is the normal state: Jaimie asked for everything on, so nothing should have to be
  // written to get that.
  it("is everything on, nothing bundled, no quiet hours", () => {
    expect(prefsFromRow(null)).toEqual({ bundle: false, quietFrom: null, quietTo: null, areasOff: [] });
  });

  it("reads back what they chose", () => {
    expect(
      prefsFromRow({ bundle: true, quiet_from: "23:00:00", quiet_to: "07:00:00", areas_off: ["ball", "newsletter"] }),
    ).toEqual({ bundle: true, quietFrom: "23:00:00", quietTo: "07:00:00", areasOff: ["ball", "newsletter"] });
  });

  it("treats a null areas_off as none switched off, not as a crash", () => {
    expect(prefsFromRow({ bundle: false, quiet_from: null, quiet_to: null, areas_off: null }).areasOff).toEqual([]);
  });
});
