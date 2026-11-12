import { describe, it, expect } from "vitest";
import { prefsFromRow, subscriptionRow } from "../../src/admin/push";

// What we store about a phone, and what each person wants on it (TASK-619).
//
// Unit tests stay database-free (golden rule 5), so these cover the two pure mappings either side
// of the SQL: browser subscription in, row out; row out of the database, settings in.

// A real pair of values of the shapes a browser actually sends: a 65-byte uncompressed point
// and a 16-byte secret, both base64url.
const P256DH = Buffer.concat([Buffer.from([0x04]), Buffer.alloc(64, 7)]).toString("base64url");
const AUTH = Buffer.alloc(16, 9).toString("base64url");
const keys = { p256dh: P256DH, auth: AUTH };

describe("turning a browser subscription into a row", () => {
  it("keeps the endpoint and both keys", () => {
    expect(subscriptionRow(7, { endpoint: "https://push.example/abc", keys })).toEqual({
      userId: 7,
      endpoint: "https://push.example/abc",
      p256dh: P256DH,
      auth: AUTH,
    });
  });

  // Half a subscription is worse than none: it would sit in the table failing on every sweep,
  // counting up failures that no retry could ever fix.
  it.each([
    ["no keys at all", { endpoint: "https://push.example/abc" }],
    ["an empty keys object", { endpoint: "https://push.example/abc", keys: {} }],
    ["no p256dh", { endpoint: "https://push.example/abc", keys: { auth: AUTH } }],
    ["no auth", { endpoint: "https://push.example/abc", keys: { p256dh: P256DH } }],
  ])("refuses %s", (_what, sub) => {
    expect(() => subscriptionRow(7, sub as never)).toThrow(/key/i);
  });

  // base64url decoding never throws: "!" is a non-empty string that decodes to nothing at all.
  // A row stored with one of these sends happily, is accepted by the push service, and shows
  // nothing on the phone for ever.
  it.each([
    ["a p256dh that decodes to nothing", { p256dh: "!", auth: AUTH }, /p256dh/i],
    ["a compressed point", { p256dh: Buffer.concat([Buffer.from([0x02]), Buffer.alloc(32, 7)]).toString("base64url"), auth: AUTH }, /p256dh/i],
    ["an auth secret that decodes to nothing", { p256dh: P256DH, auth: "!" }, /auth secret/i],
    ["an 8-byte auth secret", { p256dh: P256DH, auth: Buffer.alloc(8).toString("base64url") }, /auth secret/i],
  ])("refuses %s", (_what, badKeys, message) => {
    expect(() => subscriptionRow(7, { endpoint: "https://push.example/abc", keys: badKeys })).toThrow(message);
  });

  it("refuses a subscription with no endpoint to send to", () => {
    expect(() => subscriptionRow(7, { endpoint: "", keys })).toThrow(/endpoint/i);
  });

  // A push endpoint is a URL we will POST to on a timer. Anything that is not plainly https is
  // not something this should be talked into contacting.
  it.each(["http://push.example/abc", "file:///etc/passwd", "not a url"])("refuses %s", (endpoint) => {
    expect(() => subscriptionRow(7, { endpoint, keys })).toThrow(/https/i);
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
