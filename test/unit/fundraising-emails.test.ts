import { describe, it, expect } from "vitest";
import {
  buildSignUpThanksEmail,
  buildSignUpStaffEmail,
  buildApprovedEmail,
  buildManageLinkEmail,
  FUNDRAISING_EMAIL,
} from "../../src/fundraising/emails";
import type { SignUp } from "../../src/fundraising/model";

// TASK-493: the four fundraising emails. Pure builders; plain friendly English, NBCC's shell, the
// events inbox to reply to. Every name and address here is invented.

const signUp: SignUp = {
  path: "raising",
  kind: "santa_dash",
  title: "Robin's <Santa> Dash",
  description: "Running round the park.",
  eventDate: "2026-12-05",
  startTime: "10:30",
  venue: "Example Park",
  town: "Exampleton",
  targetPence: 50000,
  public: true,
  name: "Robin Testperson",
  email: "robin@example.com",
  phone: "07700 900123",
  socialLink: "https://www.facebook.com/example.page",
  socialOk: true,
  wants: { leaflets: 20, buckets: 1, shoutOut: true, attend: false },
  postAddress: "1 Example Street, Exampleton",
  newsletterOk: true,
};

// What a person reads: the plain text, with web addresses taken out (a link may hold a hyphen).
const words = (text: string) => text.replace(/https?:\/\/\S+/g, "").replace(/\S+@\S+/g, "");

function expectPlainEnglish(text: string) {
  expect(words(text)).not.toMatch(/[–—]/); // no en or em dashes
  expect(words(text)).not.toMatch(/[A-Za-z]-[A-Za-z]/); // no hyphens between words
}

describe("thanks for signing up", () => {
  const mail = buildSignUpThanksEmail({ name: signUp.name, title: signUp.title });

  it("thanks them by first name and says what happens next", () => {
    expect(mail.subject).toContain("Thank you");
    expect(mail.text).toContain("Hi Robin");
    expect(mail.text).toMatch(/be in touch/);
    expect(mail.text).toContain(FUNDRAISING_EMAIL);
  });

  it("is in NBCC's shell, with their words escaped", () => {
    expect(mail.html).toContain("<!doctype html>");
    expect(mail.html).toContain("Robin&#39;s &lt;Santa&gt; Dash");
    expect(mail.html).not.toContain("<Santa>");
  });

  it("is plain English", () => expectPlainEnglish(mail.text));
});

describe("the summary to the events inbox", () => {
  const mail = buildSignUpStaffEmail({ ...signUp, id: 42 }, { adminUrl: "https://nbcc.scot/admin" });

  it("names the sign up and everything they asked for", () => {
    expect(mail.subject).toContain("Robin's <Santa> Dash");
    for (const bit of ["Robin Testperson", "robin@example.com", "07700 900123", "£500", "Leaflets or posters: 20",
      "Buckets or tins: 1", "1 Example Street, Exampleton", "https://www.facebook.com/example.page", "https://nbcc.scot/admin"]) {
      expect(mail.text).toContain(bit);
    }
    expect(mail.html).not.toContain("<Santa>");
  });

  it("says when it is only to let us know", () => {
    const privateOne = buildSignUpStaffEmail({ ...signUp, id: 43, public: false }, { adminUrl: "https://nbcc.scot/admin" });
    expect(privateOne.text).toMatch(/not to be shown on the website/i);
  });

  it("is plain English", () => expectPlainEnglish(mail.text));
});

describe("approved", () => {
  it("gives a raising money fundraiser the link to their page", () => {
    const mail = buildApprovedEmail(
      { name: signUp.name, title: signUp.title },
      { pageUrl: "https://nbcc.scot/fundraise/robins-santa-dash", manageUrl: "https://nbcc.scot/fundraise/manage" },
    );
    expect(mail.subject).toMatch(/live/i);
    expect(mail.text).toContain("https://nbcc.scot/fundraise/robins-santa-dash");
    expect(mail.html).toContain('href="https://nbcc.scot/fundraise/robins-santa-dash"');
    expect(mail.text).toContain("https://nbcc.scot/fundraise/manage");
    expectPlainEnglish(mail.text);
  });

  it("tells anyone else they are on our list", () => {
    const mail = buildApprovedEmail({ name: signUp.name, title: signUp.title }, { pageUrl: null, manageUrl: null });
    expect(mail.text).toMatch(/on our list/);
    expect(mail.text).not.toContain("/fundraise/");
    expectPlainEnglish(mail.text);
  });
});

describe("the manage link", () => {
  const link = "https://nbcc.scot/fundraise/manage?token=abcDEF123_xyz";
  const mail = buildManageLinkEmail({ name: signUp.name, title: signUp.title }, link);

  it("carries the link, and says it lasts 24 hours", () => {
    expect(mail.text).toContain(link);
    expect(mail.html).toContain(link);
    expect(mail.text).toMatch(/24 hours/);
    expect(mail.text).toMatch(/did not ask/);
  });

  it("is plain English", () => expectPlainEnglish(mail.text));
});
