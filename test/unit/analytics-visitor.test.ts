import { describe, it, expect } from "vitest";
import { visitorId, newSalt, ukDay } from "../../src/analytics/visitor";

// TASK-479: the daily visitor id. The salt changes every UK day and is deleted the next, so the id
// cannot be followed from one day to the next or turned back into an IP address.

const IP = "203.0.113.7";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0 Safari/537.36";

describe("visitorId", () => {
  it("is 16 hex characters", () => {
    expect(visitorId("salt-one", IP, UA)).toMatch(/^[0-9a-f]{16}$/);
  });

  it("matches for the same person on the same day", () => {
    expect(visitorId("salt-one", IP, UA)).toBe(visitorId("salt-one", IP, UA));
  });

  it("does not match the next day, when the salt has changed", () => {
    expect(visitorId("salt-one", IP, UA)).not.toBe(visitorId("salt-two", IP, UA));
  });

  it("differs for a different address or browser", () => {
    expect(visitorId("salt-one", IP, UA)).not.toBe(visitorId("salt-one", "198.51.100.1", UA));
    expect(visitorId("salt-one", IP, UA)).not.toBe(visitorId("salt-one", IP, UA + " Edg/128.0"));
  });

  it("never contains the address itself", () => {
    expect(visitorId("salt-one", IP, UA)).not.toContain("203");
  });
});

describe("newSalt", () => {
  it("is long, random and different every time", () => {
    const a = newSalt();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(newSalt()).not.toBe(a);
  });
});

describe("ukDay", () => {
  it("is the date in the UK, not in UTC", () => {
    // 23:30 UTC on 30 June is 00:30 on 1 July in British Summer Time.
    expect(ukDay(new Date("2026-06-30T23:30:00Z"))).toBe("2026-07-01");
    // In winter the UK is on UTC.
    expect(ukDay(new Date("2026-12-31T23:30:00Z"))).toBe("2026-12-31");
  });
});
