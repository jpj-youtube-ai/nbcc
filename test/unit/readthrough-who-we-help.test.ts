import { describe, it, expect } from "vitest";
import { ABOUT_NBCC_FULL, ABOUT_NBCC_SHORT } from "../../src/email/brand";
import { buildSignUpThanksEmail } from "../../src/fundraising/emails";
import { buildSupporterThanksEmail } from "../../src/fundraising/thanks-email";
import { buildTouchEmail, sampleTouchData, touchEmailAsSent } from "../../src/fundraising/touch-emails";
import { buildTeamInviteEmail, buildTeamInviteReminderEmail, type InviteWords } from "../../src/fundraising/team-page-emails";
import { buildPledgeConfirmEmail, buildPledgeEmail, samplePledgeEmailData } from "../../src/pledges/emails";
import { buildTicketConfirmationEmail } from "../../src/tickets/emails";
import { buildInMemoryApprovedEmail } from "../../src/fundraising/memory-emails";
import { buildDonationConfirmation } from "../../src/donors/confirmation";

// The readthrough (2026-10-04), two things about saying who NBCC is and who it helps.
//
//   - "across South West Scotland": wherever a fundraising email says "children, young people and
//     vulnerable adults", it says where, in the website's exact words.
//   - The charity's own description of itself, word for word, added to the three emails whose reader
//     may never have dealt with NBCC: the pledge confirmation, the team invite (and its parent or
//     guardian version) and the ticket confirmation. Never said twice in one email.
//
// Every name and address here is invented.

const BASE = "https://nbcc.test";
const PLACE = "across South West Scotland";
const WHO = "children, young people and vulnerable adults";
const count = (s: string, needle: string) => s.split(needle).length - 1;

describe("across South West Scotland", () => {
  it("the thank you for signing up", () => {
    expect(buildSignUpThanksEmail("Sam Example").text).toContain(
      "We're so excited that you want to raise money for NBCC. Every pound you raise helps the children, young people and vulnerable adults we support across South West Scotland, all year round, and we can't wait to cheer you on.",
    );
  });

  it("the giver's thank you from the fundraiser says it in the charity's own description, and only there", () => {
    const text = buildSupporterThanksEmail({ organiserName: "Sam Example", title: "Sam's Santa Dash", message: "Thank you!", baseUrl: "https://nbcc.test" }).text;
    expect(text).toContain(`And from all of us: thank you too.\n\n${ABOUT_NBCC_FULL}\n`);
    expect(text).not.toContain("Your gift helps the children");
    expect(count(text, WHO)).toBe(1);
  });

  it("the giver's thank you on a page in memory of someone keeps its own closing line", () => {
    const text = buildSupporterThanksEmail({ organiserName: "Sam Example", title: "In memory of Mary Example", message: "Thank you!", inMemory: true, baseUrl: "https://nbcc.test" }).text;
    expect(text).toContain(
      "And from all of us: thank you too. Your gift helps the children, young people and vulnerable adults we support across South West Scotland, all year round.",
    );
    expect(text).not.toContain("volunteer led");
  });

  it("the target reached email says it once: in the first sentence, and not again two lines later", () => {
    const text = buildTouchEmail("target", sampleTouchData("target", BASE)).text;
    expect(text).toContain("That is a truly wonderful thing to have done for the children, young people and vulnerable adults we support across South West Scotland.");
    expect(text).toContain("every gift from here on is a bonus for the children, young people and vulnerable adults we support. Why not see if you can beat your goal?");
    expect(count(text, PLACE)).toBe(1);
  });

  it("the finished email", () => {
    expect(buildTouchEmail("finished", sampleTouchData("finished", BASE)).text).toContain(
      "You've made a real difference to the children, young people and vulnerable adults we support across South West Scotland.",
    );
  });

  it("the finished email for a page for someone under 18", () => {
    const d = { ...sampleTouchData("finished", BASE), name: "Jack Example", firstName: "Jack", guardianFirstName: "Sarah" };
    expect(touchEmailAsSent("finished", d).text).toContain("has made a real difference to the children, young people and vulnerable adults we support across South West Scotland.");
  });

  it("the need a hand email", () => {
    expect(buildTouchEmail("need_a_hand", sampleTouchData("need_a_hand", BASE)).text).toContain(
      "Every gift so far is already making a difference to the children, young people and vulnerable adults we support across South West Scotland.",
    );
  });

  it("the on track email", () => {
    expect(buildTouchEmail("on_track", sampleTouchData("on_track", BASE)).text).toContain(
      "Every pound helps the children, young people and vulnerable adults we support across South West Scotland, all year round.",
    );
  });

  it("is on the donation receipt once, in the charity's own description", () => {
    const receipt = buildDonationConfirmation({ fullName: "Sam Example", amountPence: 5000, currency: "GBP", giftAid: false, mode: "once" }).text;
    expect(count(receipt, PLACE)).toBe(1);
    expect(count(receipt, WHO)).toBe(1);
  });

  it("is never said twice in one email", () => {
    const mails = [
      buildSignUpThanksEmail("Sam Example"),
      buildSupporterThanksEmail({ organiserName: "Sam Example", title: "Sam's Santa Dash", message: "Thank you!", baseUrl: "https://nbcc.test" }),
      ...(["target", "finished", "need_a_hand", "on_track"] as const).map((k) => buildTouchEmail(k, sampleTouchData(k, BASE))),
    ];
    for (const m of mails) expect(count(m.text, PLACE)).toBe(1);
  });
});

describe("the charity's description of itself", () => {
  it("is the charity's own sentences, word for word", () => {
    expect(ABOUT_NBCC_FULL).toBe(
      "NBCC is a volunteer led charity here all year for children, young people and vulnerable adults across South West Scotland, with school clothing and crisis support whenever it is needed, and every December a full bag for those who would otherwise wake up on Christmas morning with nothing to open.",
    );
    expect(ABOUT_NBCC_SHORT).toBe("NBCC is a volunteer led charity here all year for children, young people and vulnerable adults across South West Scotland.");
  });

  const paragraph = (words: string) => new RegExp(`<p style="[^"]*">${words.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</p>`);
  const before = (text: string, a: string, b: string) => text.indexOf(a) !== -1 && text.indexOf(a) < text.indexOf(b);

  describe("the pledge confirmation, a short email, takes the full one", () => {
    const mail = buildPledgeConfirmEmail({ sponsorFirstName: "Alex", organiserName: "Sam Example", title: "Sam's Santa Dash", amountPence: 1000, confirmUrl: `${BASE}/pledge/confirm?t=example` });

    it("as its own paragraph, once, in both parts", () => {
      expect(mail.html).toMatch(paragraph(ABOUT_NBCC_FULL));
      expect(count(mail.html, ABOUT_NBCC_FULL)).toBe(1);
      expect(count(mail.text, ABOUT_NBCC_FULL)).toBe(1);
      expect(mail.text).toContain(`\n\n${ABOUT_NBCC_FULL}\n\n`);
    });

    it("near the end, after what happens next and before the sign off", () => {
      expect(before(mail.text, "There is nothing to pay today.", ABOUT_NBCC_FULL)).toBe(true);
      expect(before(mail.text, ABOUT_NBCC_FULL, "With thanks,\nNBCC Team")).toBe(true);
      expect(before(mail.html, "There is nothing to pay today.", ABOUT_NBCC_FULL)).toBe(true);
      expect(before(mail.html, ABOUT_NBCC_FULL, "With thanks,")).toBe(true);
    });

    it("says who NBCC helps only once", () => {
      expect(count(mail.text, WHO)).toBe(1);
    });
  });

  describe("the team invite takes the short one, in place of its own line about who we are", () => {
    const words = (o: Partial<InviteWords> = {}): InviteWords => ({
      firstName: "Alex",
      organiserName: "Sam Example",
      organiserFirstName: "Sam",
      under18: false,
      team: { title: "The Example Runners", kind: "santa", kindLabel: "Santa dash", kindOther: null, eventDate: "2026-12-05" } as InviteWords["team"],
      joinUrl: `${BASE}/fundraise/join/the-example-runners?invite=example`,
      ...o,
    });

    it.each([["to an adult", words()], ["to the parent or guardian of someone under 18", words({ firstName: "Jack", under18: true })]])("%s", (_who, o) => {
      const mail = buildTeamInviteEmail(o);
      expect(mail.html).toMatch(paragraph(ABOUT_NBCC_SHORT));
      expect(count(mail.html, ABOUT_NBCC_SHORT)).toBe(1);
      expect(mail.text).toContain(`\n\n${ABOUT_NBCC_SHORT}\n\n`);
      // The line it replaces said much the same, so it is gone rather than said twice.
      expect(mail.html + mail.text).not.toContain("a Scottish charity supporting");
      expect(count(mail.text, WHO)).toBe(1);
      expect(mail.text).not.toContain(ABOUT_NBCC_FULL);
      expect(before(mail.text, "Join the team:", ABOUT_NBCC_SHORT)).toBe(true);
      expect(before(mail.text, ABOUT_NBCC_SHORT, "Hope to see you on the team,\nNBCC Team")).toBe(true);
    });

    it("the reminder does not have it", () => {
      const reminder = buildTeamInviteReminderEmail(words());
      expect(reminder.html + reminder.text).not.toContain("volunteer led");
    });
  });

  describe("the ticket confirmation takes the short one", () => {
    const event = {
      title: "The Example Christmas Fair",
      eventDate: "2026-12-05",
      startTime: "19:30",
      endTime: "22:30",
      timeTbc: false,
      where: "Example Village Hall, 1 Example Road, Exampleton, EX1 1EX",
      organisedBy: "Example Community Group",
      pageUrl: `${BASE}/event/the-example-christmas-fair`,
    };
    const line = { id: 1, typeName: "Adult", unitPence: 1300, quantity: 2, refundedQuantity: 0 };
    const paid = buildTicketConfirmationEmail(event, { reference: "NBCC-EXAMPLE", firstName: "Alex", lines: [line], ticketsPence: 2600, feeCoverPence: 0, totalPence: 2600 } as Parameters<typeof buildTicketConfirmationEmail>[1]);
    const free = buildTicketConfirmationEmail(event, { reference: "NBCC-EXAMPLE", firstName: "Alex", lines: [{ ...line, unitPence: 0 }], ticketsPence: 0, feeCoverPence: 0, totalPence: 0 } as Parameters<typeof buildTicketConfirmationEmail>[1]);

    it.each([["a paid booking", paid], ["a free booking", free]])("%s: its own paragraph, once, as the last thing before the sign off", (_what, mail) => {
      expect(mail.subject).toBe("Your tickets for The Example Christmas Fair");
      expect(mail.html).toContain("You're booked in!");
      expect(mail.html).toMatch(paragraph(ABOUT_NBCC_SHORT));
      expect(count(mail.html, ABOUT_NBCC_SHORT)).toBe(1);
      expect(mail.text).toContain(`Can't come after all? Reply to this email and we'll help.\n\n${ABOUT_NBCC_SHORT}\n\nSee you there!\nNBCC Team`);
      expect(mail.text).not.toContain(ABOUT_NBCC_FULL);
      expect(count(mail.text, WHO)).toBe(1);
    });

    it("a paid booking still says where the ticket money goes, without saying who NBCC helps a second time", () => {
      expect(paid.text).toContain("Every penny of your ticket money goes to the Night Before Christmas Campaign (Scottish Charity SC047995).\nTickets are not donations, so Gift Aid does not apply to them.");
      expect(paid.text).not.toContain("vulnerable adults we support");
    });

    it("a free booking still says nothing about ticket money", () => {
      expect(free.text).not.toContain("Every penny of your ticket money");
    });
  });

  // The charity asked for it on the donation receipt too (ordinary, paid in, pledge, monthly, with or
  // without Gift Aid: one builder). The line before it no longer names the same people, so they are
  // named once.
  describe("the donation receipt takes the short one, straight after its closing line", () => {
    const base = { fullName: "Sam Example", amountPence: 5000, currency: "GBP", giftAid: false, mode: "once" } as const;
    const KIND = "Kindness like yours makes a real difference, at Christmas and all year round.";
    const variants: Array<[string, Parameters<typeof buildDonationConfirmation>[0]]> = [
      ["an ordinary donation", base],
      ["with Gift Aid", { ...base, giftAid: true }],
      ["monthly", { ...base, mode: "monthly" }],
      ["monthly with Gift Aid", { ...base, mode: "monthly", giftAid: true }],
      ["money a fundraiser paid in", { ...base, paidIn: true }],
      ["a paid pledge", { ...base, amountPence: 1000, reference: "NBCC-000123", donationDate: "2026-12-12T12:00:00Z" }],
    ];

    it.each(variants)("%s", (_what, input) => {
      const c = buildDonationConfirmation(input);
      expect(c.text).toContain(`

${KIND}

${ABOUT_NBCC_SHORT}

Night Before Christmas Campaign, known as NBCC,`);
      expect(c.html).toContain(`<p>${KIND}</p><p>${ABOUT_NBCC_SHORT}</p></section>`);
      expect(c.html + c.text).not.toContain("bring comfort, dignity and a moment of joy");
      expect(count(c.text, WHO)).toBe(1);
      expect(count(c.html, WHO)).toBe(1);
      expect(c.text).not.toContain(ABOUT_NBCC_FULL);
    });
  });

  it("is in the giver's thank you from the fundraiser, in full, once (2026-10-04)", () => {
    const m = buildSupporterThanksEmail({ organiserName: "Sam Example", title: "Sam's Santa Dash", message: "Thank you!", baseUrl: "https://nbcc.test" });
    expect(count(m.text, ABOUT_NBCC_FULL)).toBe(1);
    expect(count(m.html, ABOUT_NBCC_FULL)).toBe(1);
    expect(count(m.text, WHO)).toBe(1);
    expect(count(m.html, WHO)).toBe(1);
  });

  it("is not in the emails it was not asked for: in memory, the pay link, the giver's thank you in memory", () => {
    const others = [
      buildInMemoryApprovedEmail({ name: "Sam Example", memoryName: "Mary Example" }, { pageUrl: `${BASE}/fundraise/x` }),
      buildPledgeEmail("pledge_pay", samplePledgeEmailData(BASE)),
      buildPledgeEmail("pledge_reminder", samplePledgeEmailData(BASE)),
      buildSupporterThanksEmail({ organiserName: "Sam Example", title: "In memory of Mary Example", message: "Thank you!", inMemory: true, baseUrl: "https://nbcc.test" }),
    ];
    for (const m of others) expect(m.html + m.text).not.toContain("volunteer led");
  });
});
