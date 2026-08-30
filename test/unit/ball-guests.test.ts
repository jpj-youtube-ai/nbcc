import { describe, it, expect } from "vitest";
import {
  guestSubmissionSchema,
  makeGuestToken,
  isExpired,
  GUEST_RETENTION_DAYS,
  EVENT_DATE,
} from "../../src/ball/guests";

const valid = {
  tableName: "Ayrshire Bakery",
  guests: [
    { fullName: "Jo Smith", dietary: "Coeliac", accessNeeds: "" },
    { fullName: "Pat Brown", dietary: "", accessNeeds: "Step-free access" },
  ],
};

describe("guestSubmissionSchema", () => {
  it("accepts names with optional dietary and access notes", () => {
    expect(guestSubmissionSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts a submission with no table name", () => {
    const r = guestSubmissionSchema.safeParse({ guests: valid.guests });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.tableName).toBeNull();
  });

  it("blanks become null rather than empty strings on the record", () => {
    const r = guestSubmissionSchema.safeParse({
      tableName: "  ",
      guests: [{ fullName: "Jo Smith", dietary: "   ", accessNeeds: "" }],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.tableName).toBeNull();
      expect(r.data.guests[0].dietary).toBeNull();
      expect(r.data.guests[0].accessNeeds).toBeNull();
    }
  });

  it("requires a name for every guest listed", () => {
    expect(
      guestSubmissionSchema.safeParse({ guests: [{ fullName: "  ", dietary: "Vegan" }] }).success,
    ).toBe(false);
  });

  it("allows a partly filled table — people often know some names first", () => {
    expect(guestSubmissionSchema.safeParse({ guests: [{ fullName: "Jo Smith" }] }).success).toBe(true);
  });

  it("refuses an empty submission", () => {
    expect(guestSubmissionSchema.safeParse({ guests: [] }).success).toBe(false);
  });

  it("refuses more guests than the largest possible booking", () => {
    const guests = Array.from({ length: 41 }, (_, i) => ({ fullName: `Guest ${i}` }));
    expect(guestSubmissionSchema.safeParse({ guests }).success).toBe(false);
  });

  it("caps free text so a paste cannot fill the door list", () => {
    expect(
      guestSubmissionSchema.safeParse({
        guests: [{ fullName: "Jo", dietary: "x".repeat(501) }],
      }).success,
    ).toBe(false);
  });

  it("trims a name rather than storing the spaces", () => {
    const r = guestSubmissionSchema.safeParse({ guests: [{ fullName: "  Jo Smith  " }] });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.guests[0].fullName).toBe("Jo Smith");
  });
});

describe("makeGuestToken", () => {
  it("is long enough not to be guessed and url-safe", () => {
    const token = makeGuestToken(Buffer.alloc(24, 7));
    expect(token).toMatch(/^[A-Za-z0-9_-]{32,}$/);
  });

  it("is deterministic for the same bytes and different for others", () => {
    const a = Buffer.alloc(24, 1);
    const b = Buffer.alloc(24, 2);
    expect(makeGuestToken(a)).toBe(makeGuestToken(a));
    expect(makeGuestToken(a)).not.toBe(makeGuestToken(b));
  });
});

describe("retention", () => {
  it("keeps guest details for 90 days after the ball, matching the published terms", () => {
    expect(GUEST_RETENTION_DAYS).toBe(90);
  });

  it("nothing has expired the day after the event", () => {
    const dayAfter = new Date(EVENT_DATE.getTime() + 24 * 60 * 60 * 1000);
    expect(isExpired(new Date("2027-02-05T00:00:00Z"), dayAfter)).toBe(false);
  });

  it("expires once the retention date passes", () => {
    expect(isExpired(new Date("2027-02-05T00:00:00Z"), new Date("2027-02-06T00:00:00Z"))).toBe(true);
  });

  it("treats an unreadable date as NOT expired, so a bad value never deletes data early", () => {
    expect(isExpired(new Date("nonsense"), new Date("2030-01-01T00:00:00Z"))).toBe(false);
  });
});
