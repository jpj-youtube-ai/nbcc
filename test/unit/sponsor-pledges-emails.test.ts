import { describe, it, expect } from "vitest";
import { buildPledgeEmail, samplePledgeEmailData, PLEDGE_EMAIL_LABELS, PLEDGE_EMAIL_WHEN, type PledgeEmailData } from "../../src/pledges/emails";
import { PLEDGE_WORDING_KEYS } from "../../src/pledges/model";

// Sponsor pledges: the two emails to a sponsor. Pure, in NBCC's usual shell with the events inbox as
// the contact. Every name and address here is invented.

const data = (over: Partial<PledgeEmailData> = {}): PledgeEmailData => ({
  sponsorFirstName: "Alex",
  organiserName: "Robin Testperson",
  title: "Robin's Santa Dash",
  amountPence: 1000,
  giftAid: false,
  pledgedAt: "2026-11-01T10:00:00.000Z",
  payUrl: "https://nbcc.example/pledge/pay?t=12.abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG",
  cancelUrl: "https://nbcc.example/pledge/cancel?t=12.abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG",
  ...over,
});

describe("the pay email", () => {
  const mail = buildPledgeEmail("pledge_pay", data());

  it("has the subject Jaimie asked for", () => {
    expect(mail.subject).toBe("Robin finished Robin's Santa Dash! Here's your link to pay your £10 pledge");
  });

  it("greets the sponsor, says what they pledged and when, and has the pay button", () => {
    expect(mail.html).toContain("Hello Alex,");
    expect(mail.html).toContain("On 1<sup>st</sup> November 2026 you pledged £10");
    expect(mail.text).toContain("On 1st November 2026 you pledged £10");
    expect(mail.html).toContain('href="https://nbcc.example/pledge/pay?t=12.abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG"');
    expect(mail.html).toContain("Pay my £10 pledge");
    expect(mail.text).toContain("Pay my £10 pledge: https://nbcc.example/pledge/pay?t=12.");
  });

  it("explains why they are getting it, and that only one reminder follows", () => {
    expect(mail.text).toContain("Why you're getting this: you made a pledge on Robin's fundraising page at nbcc.scot.");
    expect(mail.html).toContain("Why you&#39;re getting this: you made a pledge on Robin&#39;s fundraising page at nbcc.scot.");
    for (const part of [mail.html, mail.text]) expect(part).toContain("one reminder in a week, and nothing after that");
  });

  it("has a link to say they can't pay after all", () => {
    expect(mail.html).toContain("Can&#39;t pay this after all?");
    expect(mail.text).toContain("Can't pay this after all?");
    expect(mail.html).toContain('href="https://nbcc.example/pledge/cancel?t=12.');
    expect(mail.text).toContain("https://nbcc.example/pledge/cancel?t=12.");
  });

  it("says what to do if they already paid in cash", () => {
    expect(mail.text).toContain("Already paid Robin in cash? You don't need to pay again.");
  });

  it("mentions Gift Aid only when they declared it", () => {
    expect(mail.text).not.toContain("Gift Aid");
    const aided = buildPledgeEmail("pledge_pay", data({ giftAid: true }));
    expect(aided.text).toContain("You asked us to add Gift Aid when you pledged. We'll claim it once you've paid, at no cost to you.");
  });

  it("escapes the title, and never puts an unsafe name in", () => {
    const odd = buildPledgeEmail("pledge_pay", data({ title: "<b>Dash</b> & more", organiserName: "http://bad.example now", sponsorFirstName: "<script>" }));
    expect(odd.html).not.toContain("<b>Dash</b>");
    expect(odd.html).toContain("&lt;b&gt;Dash&lt;/b&gt; &amp; more");
    expect(odd.html).not.toContain("<script>");
    expect(odd.html).toContain("Hello,");
    expect(odd.subject).toBe("<b>Dash</b> & more has finished! Here's your link to pay your £10 pledge");
    expect(odd.text).toContain("the organiser");
    // No capital letter mid sentence (Jaimie, 2026-10-04).
    expect(odd.text).toContain("Great news: the organiser has finished");
    expect(odd.html + odd.text).not.toContain("Great news: The organiser");
  });

  it("writes a name ending in s with just the apostrophe", () => {
    expect(buildPledgeEmail("pledge_pay", data({ organiserName: "James Example" })).text).toContain("on James' fundraising page");
  });

  it("is a whole branded email from the events inbox, with the charity's registration", () => {
    expect(mail.html).toMatch(/^<!doctype html>/);
    expect(mail.html).toContain("events@nbcc.scot");
    expect(mail.html).toContain("SC047995");
    expect(mail.text).toContain("events@nbcc.scot");
  });

  it("has no dashes in its words, and never says families", () => {
    const words = mail.text.replace(/https?:\S+/g, "");
    expect(words).not.toMatch(/[–—]/);
    expect(words).not.toMatch(/\w-\w/);
    expect(words.toLowerCase()).not.toContain("famil");
  });
});

describe("the reminder", () => {
  const mail = buildPledgeEmail("pledge_reminder", data({ amountPence: 1250 }));

  it("says it is a reminder, with the amount and the fundraiser", () => {
    expect(mail.subject).toBe("A reminder: your £12.50 pledge for Robin's Santa Dash");
    expect(mail.html).toContain("Pay my £12.50 pledge");
  });

  it("says it is the only one", () => {
    expect(mail.text).toContain("This is the only reminder we'll send.");
  });

  it("still has the way out, and why they are getting it", () => {
    expect(mail.text).toContain("Can't pay this after all?");
    expect(mail.text).toContain("Why you're getting this");
  });
});

describe("for the admin's preview", () => {
  it("has a label and a when for each wording key", () => {
    for (const key of PLEDGE_WORDING_KEYS) {
      expect(PLEDGE_EMAIL_LABELS[key]).toBeTruthy();
      expect(PLEDGE_EMAIL_WHEN[key]).toBeTruthy();
    }
  });

  it("has an invented example to show", () => {
    const d = samplePledgeEmailData("https://nbcc.example/");
    expect(d.title).toBe("Sam's Santa Dash");
    expect(d.payUrl.startsWith("https://nbcc.example/pledge/pay?t=")).toBe(true);
    expect(buildPledgeEmail("pledge_pay", d).subject).toContain("Sam finished Sam's Santa Dash!");
  });
});
