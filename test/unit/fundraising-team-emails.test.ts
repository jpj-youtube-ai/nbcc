import { describe, it, expect } from "vitest";
import { buildInviteEmail, buildSummaryEmail } from "../../src/fundraising/team-emails";
import { FUNDRAISING_EMAIL } from "../../src/fundraising/emails";
import { PHONE_HREF, quoteBox, signOffAs } from "../../src/email/brand";
import type { SummaryLines } from "../../src/fundraising/summary";

// TASK-503: emails 7 (the invite) and 11 (the Monday summary), in the words Jaimie signed off on
// 2026-10-02. Every name and address here is invented.

const URL = "https://nbcc.test/fundraise?invite=abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ";

// What a person reads: the plain text, with web addresses taken out.
const words = (text: string) => text.replace(/https?:\/\/\S+/g, "").replace(/\S+@\S+/g, "");
function expectPlainEnglish(text: string) {
  expect(words(text)).not.toMatch(/[–—]/);
  expect(words(text)).not.toMatch(/ - /);
}

describe("the brand pieces the two emails add", () => {
  it("quotes a note in the serif italic box, escaped", () => {
    const html = quoteBox("<b>Hi</b>");
    expect(html).toContain("font-style:italic");
    expect(html).toContain("&lt;b&gt;Hi&lt;/b&gt;");
  });

  it("signs a close as a person, then the NBCC Team", () => {
    const html = signOffAs("Warmest wishes,", "Fern");
    expect(html).toMatch(/Warmest wishes,<br>Fern<br><span[^>]*>NBCC Team<\/span>/);
    expect(html).not.toContain("on behalf");
    expect(signOffAs("Warmest wishes,", "<i>")).toContain("<br>&lt;i&gt;<br>");
  });
});

describe("email 7, the invite", () => {
  const mail = buildInviteEmail({ name: "Alex Example", note: "Great to chat about the bake sale!", signer: "Fern", url: URL });

  it("has the approved subject", () => {
    expect(mail.subject).toBe("We'd love you to fundraise with us");
  });

  it("says the approved words, greeting them by first name", () => {
    for (const t of [mail.html, mail.text]) {
      expect(t).toContain("Fundraising for NBCC");
      expect(t).toContain("We’d love you to fundraise with us!");
      expect(t).toContain("Hi Alex,");
      expect(t).toContain("It was so lovely to chat with you about your plans to raise money for NBCC. Thank you, it honestly means the world to us.");
      expect(t).toContain("We’ve given you a head start: press the button below and your page is already filled in with what we talked about. It only takes a couple of minutes.");
      expect(t).toContain("You’ll get your very own fundraising page, with a meter that fills as gifts come in, a wall for your supporters’ messages and your own QR code for posters.");
      expect(t).toContain("Need posters, leaflets, a collection bucket or a shout out on our social media? Just ask, we’re here to help.");
    }
    expectPlainEnglish(mail.text);
  });

  it("has the Make my page button, linking to the form with the invite", () => {
    expect(mail.html).toContain(`href="${URL}"`);
    expect(mail.html).toContain(">Make my page</a>");
    expect(mail.text).toContain(`Make my page: ${URL}`);
  });

  it("shows the personal note in the quote box", () => {
    expect(mail.html).toContain(quoteBox("Great to chat about the bake sale!"));
    expect(mail.text).toContain("Great to chat about the bake sale!");
  });

  it("is signed by the person who sent it, then the questions box", () => {
    expect(mail.html).toContain(signOffAs("Warmest wishes,", "Fern"));
    expect(mail.text).toContain("Warmest wishes,\nFern\nNBCC Team");
    expect(mail.html).toContain("Got any questions?");
    expect(mail.html).toContain(`href="${PHONE_HREF}"`);
    expect(mail.html).toContain(`href="mailto:${FUNDRAISING_EMAIL}"`);
    expect(mail.html.indexOf("Warmest wishes,<br>Fern<br>")).toBeLessThan(mail.html.indexOf("Got any questions?"));
  });

  it("leaves the quote box out when there is no note", () => {
    const plain = buildInviteEmail({ name: "Alex", note: null, signer: "Fern", url: URL });
    expect(plain.html).not.toContain("font-style:italic;font-size:15px");
    expect(plain.html).toContain("Hi Alex,");
  });

  it("escapes everything staff typed", () => {
    const sly = buildInviteEmail({ name: "<script>x</script>", note: "<a href=\"https://bad.example\">click</a>\nsecond line", signer: "<b>", url: URL });
    expect(sly.html).not.toContain("<script>");
    expect(sly.html).not.toContain('<a href="https://bad.example"');
    expect(sly.html).toContain("&lt;a href=&quot;https://bad.example&quot;&gt;click&lt;/a&gt;<br>second line");
    expect(sly.html).toContain("Warmest wishes,<br>&lt;b&gt;<br>");
  });
});

describe("email 11, the Monday summary", () => {
  const lines: SummaryLines = {
    subject: "Fundraising this week: £1,240 raised, 10 things waiting",
    headline: "£1,240 raised",
    money: "£1,050 online and £190 paid in, plus £210 Gift Aid to claim. 14 fundraisers live, £8,930 raised in total.",
    newSignUps: ["Sam’s Santa Dash, raising money, Perth", "Coffee morning at <St Example’s>, holding an event"],
    waiting: ["2 sign ups to approve", "1 change to check"],
    comingUp: ["Sat 6 Dec: Sam’s Santa Dash, Perth"],
  };
  const mail = buildSummaryEmail(lines, { adminUrl: "https://nbcc.test/admin", test: false });

  it("has the subject with the money and what is waiting", () => {
    expect(mail.subject).toBe("Fundraising this week: £1,240 raised, 10 things waiting");
  });

  it("says the approved words around the numbers", () => {
    for (const t of [mail.html, mail.text]) {
      expect(t).toContain("For the team, Monday 8am");
      expect(t).toContain("Good morning, team!");
      expect(t).toContain("Here’s how fundraising went last week.");
      expect(t).toContain("£1,240 raised");
      expect(t).toContain(lines.money);
      expect(t).toMatch(/New sign ups/i);
      expect(t).toMatch(/Waiting on us/i);
      expect(t).toMatch(/Coming up/i);
      expect(t).toContain("2 sign ups to approve");
      expect(t).toContain("Sat 6 Dec: Sam’s Santa Dash, Perth");
    }
    expectPlainEnglish(mail.text);
  });

  it("escapes the titles organisers typed", () => {
    expect(mail.html).toContain("Coffee morning at &lt;St Example’s&gt;, holding an event");
    expect(mail.html).not.toContain("<St Example");
  });

  it("has the Open the admin button, then signs off, with no questions box", () => {
    expect(mail.html).toContain('href="https://nbcc.test/admin"');
    expect(mail.html).toContain(">Open the admin</a>");
    expect(mail.html).toContain("Have a brilliant week,");
    expect(mail.html).toContain("NBCC Team");
    expect(mail.html.indexOf("Open the admin")).toBeLessThan(mail.html.indexOf("Have a brilliant week,"));
    expect(mail.html).not.toContain("Got any questions?");
    expect(mail.text).toContain("Have a brilliant week,\nNBCC Team");
    expect(mail.text).toContain("Open the admin: https://nbcc.test/admin");
  });

  it("says so on a quiet week rather than showing empty headings", () => {
    const quiet = buildSummaryEmail({ ...lines, newSignUps: [], waiting: [], comingUp: [] }, { adminUrl: "https://nbcc.test/admin", test: false });
    for (const t of [quiet.html, quiet.text]) {
      expect(t).toContain("No new sign ups last week.");
      expect(t).toContain("Nothing is waiting on us. Lovely!");
      expect(t).toContain("Nothing dated in the next four weeks.");
    }
  });

  it("marks a test as a test", () => {
    const test = buildSummaryEmail(lines, { adminUrl: "https://nbcc.test/admin", test: true });
    expect(test.subject).toBe("Test: Fundraising this week: £1,240 raised, 10 things waiting");
    expect(test.html).toContain("This is a test");
    expect(test.text).toContain("This is a test");
  });
});
