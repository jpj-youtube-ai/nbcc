import { describe, expect, it } from "vitest";
import {
  buildChaseListEmail,
  buildChaseReminderEmail,
  exampleChaseList,
  exampleReminderGroup,
} from "../../src/ball/chase-email";
import type { ChaseList, ChaseRow, ReminderGroup } from "../../src/ball/chase";

// All the people, addresses, numbers and links here are invented.

const DEADLINE = new Date("2026-11-04T10:00:00Z");
const link = (token: string) => `https://example.com/ball/guests/${token}`;

function row(over: Partial<ChaseRow> = {}): ChaseRow {
  return {
    id: 1,
    reference: "BALL-0001",
    status: "paid",
    paymentMethod: "card",
    buyerName: "Ada Example",
    buyerFirstName: "Ada",
    buyerEmail: "ada@example.com",
    buyerPhone: "07000 000001",
    guestToken: "tok-1",
    seats: 10,
    choices: Array<string | null>(3).fill("Main: Pie"),
    reminderSentOn: null,
    unnamed: 7,
    unchosen: 2,
    ...over,
  };
}

function group(...rows: ChaseRow[]): ReminderGroup {
  return { email: "ada@example.com", firstName: "Ada", bookings: rows };
}

const reminder = (g: ReminderGroup, days = 7) =>
  buildChaseReminderEmail({ group: g, daysToDeadline: days, deadline: DEADLINE, guestLink: link });

const emptyList = (over: Partial<ChaseList> = {}): ChaseList => ({
  toChase: [],
  cannotEmail: [],
  awaitingPayment: [],
  complete: 0,
  unnamed: 0,
  unchosen: 0,
  ...over,
});

const chaseList = (list: ChaseList, days = 7, test = false) =>
  buildChaseListEmail({ list, daysToDeadline: days, deadline: DEADLINE, guestLink: link, test });

// What a reader sees: no tags, no entities.
const visible = (html: string) =>
  html
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ");

describe("the reminder", () => {
  it("counts down in the subject", () => {
    expect(reminder(group(row()), 7).subject).toBe("7 days to go: your Festive Ball guests and meals");
    expect(reminder(group(row()), 5).subject).toBe("5 days to go: your Festive Ball guests and meals");
    expect(reminder(group(row()), 1).subject).toBe("Last chance: your Festive Ball guests and meals by 10am tomorrow");
  });

  it("puts the action box first, then the greeting, with the date in the house style", () => {
    const { html, text } = reminder(group(row()));
    expect(html).toContain("Please do this by 10am on Wednesday 4<sup>th</sup> November");
    expect(html).toContain("7 days to go");
    expect(text).toContain("by 10am on Wednesday 4th November");
    expect(html.indexOf("Please do this by")).toBeLessThan(html.indexOf("Hello"));
    expect(html.indexOf("Add your guests and meals")).toBeLessThan(html.indexOf("Hello"));
    expect(html.indexOf("7 of your 10 seats still need a name")).toBeLessThan(html.indexOf("Hello"));
    expect(text.indexOf("by 10am on Wednesday 4th November")).toBeLessThan(text.indexOf("Hello"));
    expect(text.indexOf("Add your guests and meals")).toBeLessThan(text.indexOf("Hello"));
  });

  it("says last chance on the last day", () => {
    const { html, text } = reminder(group(row()), 1);
    expect(html).toContain("Last chance: please do this by 10am tomorrow, Wednesday 4<sup>th</sup> November");
    expect(text).toContain("Last chance: please do this by 10am tomorrow, Wednesday 4th November");
  });

  it("says exactly what is missing, and links the booking's own page", () => {
    const { html, text } = reminder(group(row()));
    expect(html).toContain("7 of your 10 seats still need a name");
    expect(html).toContain("2 of your guests still need to choose their meals");
    expect(html).toContain(`href="${link("tok-1")}"`);
    expect(text).toContain("7 of your 10 seats still need a name");
    expect(text).toContain("2 of your guests still need to choose their meals");
    expect(text).toContain(link("tok-1"));
  });

  it("uses the singular forms", () => {
    const { html, text } = reminder(group(row({ seats: 2, choices: ["Main: Pie", null], unnamed: 1, unchosen: 1 })));
    expect(html).toContain("1 of your 2 seats still needs a name");
    expect(html).toContain("1 of your guests still needs to choose their meal");
    expect(text).toContain("1 of your 2 seats still needs a name");
    expect(text).toContain("1 of your guests still needs to choose their meal");
  });

  it("leaves out the meals line when only names are missing", () => {
    const { html, text } = reminder(group(row({ unchosen: 0 })));
    expect(html).toContain("7 of your 10 seats still need a name");
    expect(html).not.toContain("still need to choose");
    expect(text).not.toContain("still need to choose");
  });

  it("leaves out the names line when only meals are missing", () => {
    const { html } = reminder(group(row({ seats: 3, unnamed: 0, unchosen: 2 })));
    expect(html).not.toContain("still need a name");
    expect(html).toContain("2 of your guests still need to choose their meals");
  });

  it("says we will choose, and never promises a phone call", () => {
    const { html, text } = reminder(group(row()));
    expect(text).toContain("If we haven't heard from you by 10am on Wednesday 4th November, we'll choose for you.");
    expect(html).toContain("If we haven't heard from you by 10am on Wednesday 4<sup>th</sup> November, we'll choose for you.");
    for (const part of [visible(html), text]) {
      expect(part).not.toMatch(/\bring\b/i);
      expect(part).not.toContain("call you");
    }
  });

  it("shows both bookings, each with its own link and missing lines", () => {
    const g = group(
      row(),
      row({ id: 2, reference: "BALL-0002", guestToken: "tok-2", seats: 4, choices: ["Main: Pie"], unnamed: 3, unchosen: 0 }),
    );
    const { html, text } = reminder(g);
    for (const part of [html, text]) {
      expect(part).toContain("Booking BALL-0001");
      expect(part).toContain("Booking BALL-0002");
      expect(part).toContain(link("tok-1"));
      expect(part).toContain(link("tok-2"));
      expect(part).toContain("3 of your 4 seats still need a name");
      expect(part).toContain("7 of your 10 seats still need a name");
    }
    expect(html.match(/Add your guests and meals/g)).toHaveLength(2);
  });

  it("greets by first name and escapes anything typed", () => {
    const { html, text } = reminder({ ...group(row()), firstName: "<script>alert(1)</script>" });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(text).toContain("Hello <script>alert(1)</script>.");
  });

  it("has the contact panel and the Ball footer", () => {
    const { html, text } = reminder(group(row()));
    expect(html).toContain("events@nbcc.scot");
    expect(text).toContain("events@nbcc.scot");
    expect(text).toContain("The Designer Rooms");
  });

  it("says the time the way a person would", () => {
    const at = (iso: string) =>
      buildChaseReminderEmail({ group: group(row()), daysToDeadline: 7, deadline: new Date(iso), guestLink: link }).text;
    expect(at("2026-11-04T10:30:00Z")).toContain("by 10.30am on Wednesday 4th November");
    expect(at("2026-11-04T16:00:00Z")).toContain("by 4pm on Wednesday 4th November");
    expect(at("2026-11-04T12:00:00Z")).toContain("by 12pm on Wednesday 4th November");
    // Summer time: 09:00 UTC is 10am in London.
    expect(at("2026-06-04T09:00:00Z")).toContain("by 10am on Thursday 4th June");
  });

  it("has no en or em dash anywhere a reader can see", () => {
    for (const days of [7, 5, 3, 1]) {
      const e = reminder(group(row(), row({ id: 2, reference: "BALL-0002", guestToken: "tok-2" })), days);
      for (const part of [e.subject, visible(e.html), e.text]) expect(part).not.toMatch(/[–—]/);
    }
  });

  it("has an example for the catalogue", () => {
    const g = exampleReminderGroup();
    expect(g.bookings.length).toBeGreaterThan(0);
    expect(reminder(g).html).toContain("Add your guests and meals");
    expect(JSON.stringify(g)).toContain("example");
  });
});

describe("the volunteers' list", () => {
  it("counts the bookings to chase in the subject", () => {
    const list = emptyList({ toChase: [row(), row({ id: 2, reference: "BALL-0002" })], unnamed: 14, unchosen: 4 });
    expect(chaseList(list, 7).subject).toBe("Festive Ball chase list: 2 bookings to chase, 7 days to go");
    expect(chaseList(list, 1).subject).toBe("Festive Ball chase list: 2 bookings to chase, 1 day to go");
    expect(chaseList(list, 0).subject).toBe("Festive Ball chase list: 2 bookings to chase before 10am today");
    expect(chaseList(emptyList({ toChase: [row()] }), 5).subject).toBe("Festive Ball chase list: 1 booking to chase, 5 days to go");
  });

  it("shows each booking's details and its own link", () => {
    const list = emptyList({
      toChase: [row({ seats: 10, choices: Array<string | null>(6).fill("Main: Pie"), unnamed: 4, unchosen: 2 })],
    });
    const { html, text } = chaseList(list);
    for (const part of [html, text]) {
      expect(part).toContain("Ada Example");
      expect(part).toContain("07000 000001");
      expect(part).toContain("ada@example.com");
      expect(part).toContain("BALL-0001");
      expect(part).toContain("6 of 10 seats named");
      expect(part).toContain("4 of 6 meals chosen");
      expect(part).toContain(link("tok-1"));
    }
    expect(html).toContain('href="tel:07000000001"');
    expect(html).toContain('href="mailto:ada@example.com"');
  });

  it("says when there is no phone number", () => {
    const { html, text } = chaseList(emptyList({ toChase: [row({ buyerPhone: null })] }));
    expect(html).toContain("no phone given");
    expect(text).toContain("no phone given");
    expect(html).not.toContain("tel:07");
  });

  it("has the three sections, and leaves out the empty ones", () => {
    const full = emptyList({
      toChase: [row()],
      cannotEmail: [row({ id: 2, reference: "BALL-0002", buyerEmail: "", guestToken: null })],
      awaitingPayment: [row({ id: 3, reference: "BALL-0003", status: "pending", paymentMethod: "transfer", choices: [], unnamed: 10, unchosen: 0 })],
    });
    const { html, text } = chaseList(full);
    for (const part of [html, text]) {
      expect(part).toContain("To chase");
      expect(part).toContain("Paid, but we cannot email them");
      expect(part).toContain("Waiting for their bank transfer");
      expect(part).toContain("BALL-0003");
    }
    expect(text).toContain("0 of 10 seats named");

    const only = chaseList(emptyList({ toChase: [row()] }));
    for (const part of [only.html, only.text]) {
      expect(part).toContain("To chase");
      expect(part).not.toContain("Paid, but we cannot email them");
      expect(part).not.toContain("Waiting for their bank transfer");
    }
  });

  it("gives the totals", () => {
    const { html, text } = chaseList(emptyList({ toChase: [row()], complete: 12, unnamed: 7, unchosen: 2 }));
    for (const part of [visible(html).replace(/\s+/g, " "), text]) {
      expect(part).toContain("12 bookings complete");
      expect(part).toContain("7 seats still without a name");
      expect(part).toContain("2 guests still to choose their meals");
    }
  });

  it("says it is the last list on the deadline morning", () => {
    expect(chaseList(emptyList({ toChase: [row()] }), 0).text).toContain("the last list before 10am on Wednesday 4th November");
    expect(chaseList(emptyList({ toChase: [row()] }), 0).html).toContain("Wednesday 4<sup>th</sup> November");
    expect(chaseList(emptyList({ toChase: [row()] }), 7).text).not.toContain("the last list");
  });

  it("reads correctly on every day, including the last but one", () => {
    const list = emptyList({ toChase: [row()] });
    const one = chaseList(list, 1);
    for (const part of [one.html, one.text]) {
      expect(part).toContain("The guest details close at 10am on Wednesday 4");
      expect(part).toContain("(1 day to go).");
      expect(part).not.toContain("there are 1 day");
    }
    expect(chaseList(list, 3).text).toContain("(3 days to go).");
  });

  it("lets a long address wrap, and does not link a phone with no digits", () => {
    const long = `${"a".repeat(60)}@example.com`;
    const { html, text } = chaseList(emptyList({ toChase: [row({ buyerEmail: long, buyerPhone: "n/a" })] }));
    expect(html).toContain(`href="mailto:${long}"`);
    expect(html).toContain("overflow-wrap:anywhere");
    expect(html).toContain("word-break:break-word");
    // The only tel: links are the Ball's own number in the shell and the contact panel.
    expect(html).not.toContain('href="tel:"');
    expect(html.match(/href="tel:/g)).toHaveLength(chaseList(emptyList({ toChase: [row({ buyerPhone: null })] })).html.match(/href="tel:/g)!.length);
    expect(html).toContain("n/a");
    expect(text).toContain("Phone: n/a");
  });

  it("marks a test, and only a test", () => {
    const list = emptyList({ toChase: [row()] });
    for (const part of [chaseList(list, 7, true).html, chaseList(list, 7, true).text]) {
      expect(part).toContain("This is a test with made-up bookings");
    }
    expect(chaseList(list).html).not.toContain("This is a test");
    expect(chaseList(list).text).not.toContain("This is a test");
  });

  it("escapes what people typed", () => {
    const { html } = chaseList(emptyList({ toChase: [row({ buyerName: "<b>Bob</b>", buyerPhone: "<i>1</i>" })] }));
    expect(html).not.toContain("<b>Bob</b>");
    expect(html).toContain("&lt;b&gt;Bob&lt;/b&gt;");
    expect(html).not.toContain("<i>1</i>");
  });

  it("has no en or em dash anywhere a reader can see", () => {
    const e = chaseList(exampleChaseList(), 0, true);
    for (const part of [e.subject, visible(e.html), e.text]) expect(part).not.toMatch(/[–—]/);
  });

  it("has an example with every section, for the catalogue", () => {
    const l = exampleChaseList();
    expect(l.toChase.length).toBeGreaterThan(0);
    expect(l.cannotEmail.length).toBeGreaterThan(0);
    expect(l.awaitingPayment.length).toBeGreaterThan(0);
    expect(JSON.stringify(l)).not.toMatch(/@(?!example\.com)/);
  });
});
