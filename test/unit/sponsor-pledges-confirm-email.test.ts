import { describe, it, expect } from "vitest";
import { buildPledgeConfirmEmail, buildPledgeStaffEmail } from "../../src/pledges/emails";

// Sponsor pledges: the one email sent when someone pledges, "Please confirm your £10 pledge". Anyone
// can type any address into the form, so it carries fixed words, one safe first name and the approved
// page's title, and nothing else they typed. And the plain note to the events inbox. Every name here
// is invented.

const data = {
  sponsorFirstName: "Alex",
  organiserName: "Robin Testperson",
  title: "Robin's Santa Dash",
  amountPence: 1000,
  confirmUrl: "https://nbcc.example/pledge/confirm?t=12.abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG",
};

describe("the confirm email", () => {
  const mail = buildPledgeConfirmEmail(data);

  it("asks them to confirm, with the amount", () => {
    expect(mail.subject).toBe("Please confirm your £10 pledge");
    expect(mail.html).toContain("Hello Alex,");
    expect(mail.text).toContain("Thank you for pledging £10 to sponsor Robin for Robin's Santa Dash. Please press the button to confirm it was you.");
  });

  it("has one button, to the confirm link", () => {
    expect(mail.html).toContain('href="https://nbcc.example/pledge/confirm?t=12.abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG"');
    expect(mail.html.match(/<a [^>]*border-radius:999px/g)?.length).toBe(1);
    expect(mail.html).toContain("Confirm my £10 pledge");
    expect(mail.text).toContain("Confirm my £10 pledge: https://nbcc.example/pledge/confirm?t=12.");
  });

  it("says nothing is paid today, and what happens if it was not them", () => {
    expect(mail.text).toContain("There is nothing to pay today. Once Robin has finished, we'll email you a link to pay.");
    expect(mail.text).toContain("If this wasn't you, you don't need to do anything. A pledge that isn't confirmed is deleted after 7 days, and we won't email you again.");
  });

  it("carries nothing else a stranger typed: no message, no surname, and only a safe first name", () => {
    const odd = buildPledgeConfirmEmail({ ...data, sponsorFirstName: "http://bad.example now", organiserName: "<b>x</b>", title: "<i>Dash</i>" });
    expect(odd.html).toContain("Hello,");
    expect(odd.html).not.toContain("bad.example");
    expect(odd.html).not.toContain("<i>Dash</i>");
    expect(odd.html).toContain("&lt;i&gt;Dash&lt;/i&gt;");
    expect(odd.text).toContain("to sponsor the organiser for");
  });

  it("is a whole branded email from the events inbox, with no dashes in its words", () => {
    expect(mail.html).toMatch(/^<!doctype html>/);
    expect(mail.html).toContain("events@nbcc.scot");
    const words = mail.text.replace(/https?:\S+/g, "");
    expect(words).not.toMatch(/[–—]/);
    expect(words).not.toMatch(/\w-\w/);
  });
});

describe("the note to the events inbox", () => {
  it("is a heading, plain lines and a way in to the admin, escaped", () => {
    const mail = buildPledgeStaffEmail({ subject: "1 pledge paid twice: check and refund", lines: ["Robin's Santa Dash: pledge 12 was paid twice <ok>."], adminUrl: "https://nbcc.example/admin" });
    expect(mail.subject).toBe("1 pledge paid twice: check and refund");
    expect(mail.html).toContain("pledge 12 was paid twice &lt;ok&gt;.");
    expect(mail.html).toContain('href="https://nbcc.example/admin"');
    expect(mail.text).toContain("Robin's Santa Dash: pledge 12 was paid twice <ok>.");
    expect(mail.text).toContain("https://nbcc.example/admin");
  });
});
