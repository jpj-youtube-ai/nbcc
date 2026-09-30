import { describe, it, expect } from "vitest";
import {
  eventInputSchema,
  publishProblems,
  slugify,
  londonToday,
  isOnPage,
  sortForPage,
  FLAGS,
  type EventInput,
} from "../../src/events/model";

// TASK-453: the rules for an event, decided in one pure file so the route, the database layer
// and the admin all agree on what is allowed - and, more importantly, on what is NOT: no image
// from somewhere else on the internet, no booking link that runs script, no invented urgency.

const valid = (over: Record<string, unknown> = {}) => ({
  name: "Festive Ball 2026",
  subtitle: "A Night to Remember",
  gist: "An elegant evening at The Park Hotel.",
  date: "2026-11-07",
  start: "19:00",
  end: "",
  timeTbc: true,
  venue: "The Park Hotel",
  town: "Kilmarnock",
  address: "The Park Hotel, Rugby Park, Kilmarnock.",
  access: [],
  imageSrc: "/assets/img/ball-lockup.svg",
  imageFit: "whole",
  imageGround: "night",
  imageAlt: "",
  cover: "crimson",
  costFront: "£100 each",
  costBack: "£100 each, or £1,000 for a table of ten.",
  flag: "",
  listHeading: "On the night",
  whatsOn: "*Michelle McManus*, your host",
  note: "",
  runBy: "partner",
  partnerName: "The Designer Rooms",
  partnerFront: "Organised by",
  partnerCredit: "Organised and sponsored by",
  partnerLogoSrc: "/assets/img/the-designer-rooms.png",
  partnerLine: "They are covering the cost of the night.",
  bookingHow: "site",
  bookingUrl: "/ball#tickets",
  bookingLabel: "Book tickets",
  bookingNote: "",
  status: "live",
  showFrom: "",
  ...over,
});

const parse = (over: Record<string, unknown> = {}) => eventInputSchema.safeParse(valid(over));
const problemFields = (over: Record<string, unknown>) => {
  const r = parse(over);
  return r.success ? [] : r.error.issues.map((i) => i.path.join("."));
};

describe("what an event may contain", () => {
  it("accepts a complete event and tidies the spacing", () => {
    const r = parse({ name: "  Festive Ball 2026  ", venue: " The Park Hotel " });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.name).toBe("Festive Ball 2026");
    expect(r.data.venue).toBe("The Park Hotel");
  });

  it("turns blank optional times and dates into nothing, not empty strings", () => {
    const r = parse({ end: "", showFrom: "" });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.end).toBeNull();
    expect(r.data.showFrom).toBeNull();
  });

  it("needs a name", () => {
    expect(problemFields({ name: "   " })).toContain("name");
  });

  it("needs a real calendar date", () => {
    expect(problemFields({ date: "2026-02-30" })).toContain("date");
    expect(problemFields({ date: "7 November" })).toContain("date");
  });

  it("refuses a finish before the start", () => {
    expect(problemFields({ start: "22:00", end: "18:00" })).toContain("end");
  });

  // Honest scarcity only (the Code of Fundraising Practice): the corner note is chosen from a list
  // of plain statements, never typed, so nobody can write "Only 2 left!" on a whim.
  it("only takes a corner note from the fixed list", () => {
    expect(FLAGS).toContain("Spaces limited");
    expect(problemFields({ flag: "Only 2 left!" })).toContain("flag");
  });

  it("only takes the organiser credits from the fixed lists", () => {
    expect(problemFields({ partnerFront: "Brought to you by" })).toContain("partnerFront");
    expect(problemFields({ partnerCredit: "Proudly presented by" })).toContain("partnerCredit");
  });

  describe("pictures come only from the site itself", () => {
    it("accepts an uploaded picture", () => {
      expect(problemFields({ imageSrc: "/media/events/0f8fad5b-d9cb-469f-a165-70867728950e" })).toEqual([]);
    });
    it("accepts one of the site's own images", () => {
      expect(problemFields({ imageSrc: "/assets/img/ball-lockup.svg" })).toEqual([]);
    });
    it.each([
      "https://evil.example/x.png",
      "//evil.example/x.png",
      "javascript:alert(1)",
      "/media/events/../../etc/passwd",
      "/assets/img/../../admin.html",
      "data:image/png;base64,AAAA",
    ])("refuses %s", (src) => {
      expect(problemFields({ imageSrc: src })).toContain("imageSrc");
      expect(problemFields({ partnerLogoSrc: src })).toContain("partnerLogoSrc");
    });
  });

  describe("booking links cannot run script", () => {
    it("accepts a web address for booking somewhere else", () => {
      expect(problemFields({ bookingHow: "away", bookingUrl: "https://adautocare.co.uk/empowher" })).toEqual([]);
    });
    it.each(["javascript:alert(1)", "/ball", "data:text/html,hi", "https://"])(
      "refuses %s for booking somewhere else",
      (url) => {
        expect(problemFields({ bookingHow: "away", bookingUrl: url })).toContain("bookingUrl");
      },
    );
    it("accepts a page on nbcc.scot for booking here", () => {
      expect(problemFields({ bookingHow: "site", bookingUrl: "/ball#tickets" })).toEqual([]);
    });
    it.each(["//evil.example", "https://nbcc.scot/ball", "javascript:alert(1)", "ball"])(
      "refuses %s for booking here",
      (url) => {
        expect(problemFields({ bookingHow: "site", bookingUrl: url })).toContain("bookingUrl");
      },
    );
    it("ignores the link when no booking is needed", () => {
      const r = parse({ bookingHow: "none", bookingUrl: "javascript:alert(1)" });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.bookingUrl).toBe("");
    });
  });

  it("needs a date to go up on when it is scheduled", () => {
    expect(problemFields({ status: "scheduled", showFrom: "" })).toContain("showFrom");
    expect(problemFields({ status: "scheduled", showFrom: "2026-10-01" })).toEqual([]);
  });

  it("only takes access features from the list", () => {
    expect(problemFields({ access: ["step free entry", "a hearing loop"] })).toEqual([]);
    expect(problemFields({ access: ["free parking for all"] })).toContain("access.0");
  });

  it("caps the length of the gist so a stray paste cannot flood the card", () => {
    expect(problemFields({ gist: "x".repeat(201) })).toContain("gist");
  });
});

describe("what an event needs before it can go on the page", () => {
  const input = (over: Record<string, unknown> = {}) => eventInputSchema.parse(valid(over)) as EventInput;

  it("has nothing missing when complete", () => {
    expect(publishProblems(input())).toEqual([]);
  });

  it("lets a draft be saved half finished, but says what publishing still needs", () => {
    const draft = input({ gist: "", venue: "", status: "draft" });
    expect(publishProblems(draft)).toEqual([
      "Add the gist for the front of the card.",
      "Add the venue.",
    ]);
  });

  it("needs somewhere to book, unless no booking is needed", () => {
    expect(publishProblems(input({ bookingUrl: "" }))).toContain("Add the booking link.");
    expect(publishProblems(input({ bookingHow: "none", bookingUrl: "" }))).toEqual([]);
  });

  it("needs the organiser's name when someone else is running it", () => {
    expect(publishProblems(input({ partnerName: "" }))).toContain("Add the name of whoever is running it.");
    expect(publishProblems(input({ runBy: "nbcc", partnerName: "" }))).toEqual([]);
  });
});

describe("slugs, for the card's web address", () => {
  it("is lowercase words joined by hyphens, apostrophes dropped", () => {
    expect(slugify("EmpowHer ’26")).toBe("empowher-26");
    expect(slugify("Festive Ball 2026")).toBe("festive-ball-2026");
    expect(slugify("  Quiz night: round 2!  ")).toBe("quiz-night-round-2");
  });
  it("never comes back empty", () => {
    expect(slugify("!!!")).toBe("event");
  });
});

describe("what today is, in Scotland", () => {
  it("counts a late October evening in British Summer Time as the next day", () => {
    expect(londonToday(new Date("2026-10-24T23:30:00Z"))).toBe("2026-10-25");
  });
  it("counts a late December evening in GMT as the same day", () => {
    expect(londonToday(new Date("2026-12-01T23:30:00Z"))).toBe("2026-12-01");
  });
});

describe("which events are on the page", () => {
  const today = "2026-11-04";
  it("shows a live event up to and including its own day", () => {
    expect(isOnPage({ status: "live", showFrom: null, date: "2026-11-04" }, today)).toBe(true);
    expect(isOnPage({ status: "live", showFrom: null, date: "2026-11-07" }, today)).toBe(true);
  });
  it("drops an event the day after it happened", () => {
    expect(isOnPage({ status: "live", showFrom: null, date: "2026-11-03" }, today)).toBe(false);
  });
  it("never shows a draft", () => {
    expect(isOnPage({ status: "draft", showFrom: null, date: "2026-11-07" }, today)).toBe(false);
  });
  it("shows a scheduled event from its date to go up, and not before", () => {
    expect(isOnPage({ status: "scheduled", showFrom: "2026-11-05", date: "2026-11-20" }, today)).toBe(false);
    expect(isOnPage({ status: "scheduled", showFrom: "2026-11-04", date: "2026-11-20" }, today)).toBe(true);
  });
});

describe("the order of the deck", () => {
  it("is by date, then start time with no time last, then name", () => {
    const sorted = sortForPage([
      { date: "2026-11-07", start: "19:00", name: "Ball" },
      { date: "2026-11-04", start: null, name: "Zed" },
      { date: "2026-11-04", start: "18:00", name: "EmpowHer" },
      { date: "2026-11-04", start: null, name: "Alpha" },
    ]);
    expect(sorted.map((e) => e.name)).toEqual(["EmpowHer", "Alpha", "Zed", "Ball"]);
  });
});
