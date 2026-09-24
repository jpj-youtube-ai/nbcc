import { describe, it, expect } from "vitest";
import { repliedSummary, waitingLabel } from "../../src/contact/enquiry-summary";

// TASK-425. Two small pure helpers behind the admin enquiry notice.
//
// contact_enquiries has stored replied_at and replied_by since it was built, and the admin has
// never shown either. So "who dealt with this, and when" was already being recorded and thrown
// away. These format it, and the waiting count that drives the notice bar.

describe("who replied, and when", () => {
  const at = new Date("2026-09-22T13:03:00.000Z"); // 14:03 British Summer Time

  it("names the person and the moment", () => {
    expect(
      repliedSummary({ status: "replied", replied_by: "jaimie@nbcc.scot", replied_at: at }),
    ).toBe("by jaimie@nbcc.scot, 22 Sep 14:03");
  });

  // The site and everyone using it are in the UK, and 13:03 would be an hour out all summer.
  it("shows UK local time, not UTC", () => {
    const winter = new Date("2026-01-15T13:03:00.000Z"); // no daylight saving
    expect(repliedSummary({ status: "replied", replied_by: "a@b.c", replied_at: winter })).toBe(
      "by a@b.c, 15 Jan 13:03",
    );
  });

  it("says nothing at all for an enquiry nobody has answered", () => {
    expect(repliedSummary({ status: "new", replied_by: null, replied_at: null })).toBeNull();
  });

  // Marked replied before replied_by existed, or by a route that did not set it. Still worth
  // saying WHEN, rather than showing nothing and looking as though it never happened.
  it("gives the time even when it does not know who", () => {
    expect(repliedSummary({ status: "replied", replied_by: null, replied_at: at })).toBe(
      "22 Sep 14:03",
    );
  });

  it("gives up rather than inventing a time it does not have", () => {
    expect(
      repliedSummary({ status: "replied", replied_by: "jaimie@nbcc.scot", replied_at: null }),
    ).toBeNull();
  });

  it("accepts the ISO string the API actually sends, not only a Date", () => {
    expect(
      repliedSummary({ status: "replied", replied_by: "a@b.c", replied_at: at.toISOString() }),
    ).toBe("by a@b.c, 22 Sep 14:03");
  });

  it("refuses to render an unparseable date as 'Invalid Date'", () => {
    expect(repliedSummary({ status: "replied", replied_by: "a@b.c", replied_at: "not a date" })).toBeNull();
  });

  // Why the month name is ours rather than Intl's. en-GB abbreviates September as "Sept", so
  // Intl would put one four-letter month in a column of three-letter ones, and the exact string
  // would depend on the ICU data of whichever Node runs it. A test pinning it would then pass
  // locally and fail in CI, which this repo has already been bitten by once.
  it("abbreviates every month to three letters, on any Node version", () => {
    for (let month = 0; month < 12; month += 1) {
      const summary = repliedSummary({
        status: "replied",
        replied_by: null,
        replied_at: new Date(Date.UTC(2026, month, 15, 12, 0, 0)),
      });
      const abbreviation = summary?.split(" ")[1] ?? "";
      expect(abbreviation, `month index ${month}`).toHaveLength(3);
    }
  });
});

describe("the waiting count", () => {
  // Nothing outstanding means no bar at all. A permanent "0 waiting" banner is furniture people
  // learn to ignore, which is exactly what this must not become.
  it("says nothing when there is nothing waiting", () => {
    expect(waitingLabel(0)).toBeNull();
  });

  it("gets the singular right", () => {
    expect(waitingLabel(1)).toBe("1 enquiry waiting for a reply");
  });

  it("gets the plural right", () => {
    expect(waitingLabel(4)).toBe("4 enquiries waiting for a reply");
  });

  it("treats a negative or nonsense count as nothing waiting", () => {
    expect(waitingLabel(-1)).toBeNull();
    expect(waitingLabel(Number.NaN)).toBeNull();
  });
});
