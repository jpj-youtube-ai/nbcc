import { describe, it, expect } from "vitest";
import {
  buildSignUpThanksEmail,
  buildSignUpStaffEmail,
  buildApprovedEmail,
  buildManageLinkEmail,
  buildEditApprovedEmail,
  buildEditRejectedEmail,
  safeFirstName,
  FUNDRAISING_EMAIL,
} from "../../src/fundraising/emails";
import { questionsBox, signOff, PHONE_DISPLAY, PHONE_HREF } from "../../src/email/brand";
import type { SignUp } from "../../src/fundraising/model";

// TASK-493, reworded in TASK-497 to the words Jaimie signed off on 2026-10-02. Pure builders;
// plain friendly English, NBCC's shell, the events inbox to reply to. Every name and address here
// is invented.

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
const who = { name: "Sam Example", title: "Sam's <Santa> Dash" };
const PAGE = "https://nbcc.scot/fundraise/sams-santa-dash";

// What a person reads: the plain text, with web addresses taken out (a link may hold a hyphen).
const words = (text: string) =>
  text.replace(/https?:\/\/\S+/g, "").replace(/\S+@\S+/g, "").replace(/\bnbcc\.scot\/\S+/g, "");

function expectPlainEnglish(text: string) {
  expect(words(text)).not.toMatch(/[–—]/); // no en or em dashes
  expect(words(text)).not.toMatch(/ - /); // no spaced hyphen used as a dash
  expect(words(text)).not.toMatch(/[A-Za-z]-[A-Za-z]/); // no hyphens between words
}

// The two pieces every email to an organiser ends with, in both parts, and in that order.
function expectSignedWithQuestions(mail: { html: string; text: string }, line: string) {
  expect(mail.html).toContain("Got any questions?");
  expect(mail.html).toContain(`href="${PHONE_HREF}"`);
  expect(mail.html).toContain(`href="mailto:${FUNDRAISING_EMAIL}"`);
  expect(mail.html).toContain("NBCC Team");
  expect(mail.html.indexOf("NBCC Team")).toBeLessThan(mail.html.indexOf("Got any questions?"));
  expect(mail.text).toContain(line);
  expect(mail.text).toContain("NBCC Team");
  expect(mail.text).toContain("Got any questions?");
  expect(mail.text).toContain(`Call us: ${PHONE_DISPLAY}`);
  expect(mail.text).toContain(`Email us: ${FUNDRAISING_EMAIL}`);
  expect(mail.text.indexOf(line)).toBeLessThan(mail.text.indexOf("Got any questions?"));
}

describe("the questions box", () => {
  const html = questionsBox("events@nbcc.scot");

  it("asks, then offers a call and an email side by side, equally", () => {
    expect(html).toContain("Got any questions?");
    expect(html).toContain("We’d love to hear from you. Give us a ring or drop us a line, whichever suits you.");
    expect(html).toContain('<table role="presentation"');
    expect(html).toContain("Call us");
    expect(html).toContain(`<a href="${PHONE_HREF}"`);
    expect(html).toContain(`>${PHONE_DISPLAY}</a>`);
    expect(html).toContain("Email us");
    expect(html).toContain('<a href="mailto:events@nbcc.scot"');
    // The two tiles are the same: same width, size and weight.
    expect(html.match(/<td width="50%"/g)).toHaveLength(2);
    expect(html.match(/font-size:18px;font-weight:800/g)).toHaveLength(2);
  });

  it("escapes the address it is given", () => {
    expect(questionsBox('x"@example.com')).not.toContain('x"@');
  });
});

describe("the sign off", () => {
  it("is the friendly line, then NBCC Team in the serif maroon", () => {
    const html = signOff("Thanks so much,");
    expect(html).toContain("Thanks so much,<br>");
    expect(html).toMatch(/<span style="font-family:'Playfair Display'[^"]*;font-size:20px;font-weight:800;color:#800000">NBCC Team<\/span>/);
  });

  it("escapes its line", () => {
    expect(signOff("<b>x</b>")).not.toContain("<b>x</b>");
  });
});

describe("a safe first name, for the thank you", () => {
  it.each([
    ["Sam Example", "Sam"],
    ["  sam   example ", "Sam"],
    ["O'Neill", "O'Neill"],
    ["Anne-Marie Example", "Anne-Marie"],
    ["Siân Example", "Siân"],
  ])("takes %j as %j", (typed, first) => {
    expect(safeFirstName(typed)).toBe(first);
  });

  it("keeps only the first word, so a link typed after a name never travels", () => {
    expect(safeFirstName("Click http://evil.example")).toBe("Click");
  });

  it.each([
    ["markup", "<b>x"],
    ["a web address as one word", "evil.example/click"],
    ["digits", "Sam2"],
    ["too long", "Abcdefghijklmnopqrstuvwxyz"],
    ["nothing", ""],
    ["only spaces", "   "],
    ["a dangling hyphen", "Sam-"],
    ["an at sign", "sam@example.com"],
  ])("refuses %s", (_what, typed) => {
    expect(safeFirstName(typed)).toBeNull();
  });
});

describe("thanks for signing up", () => {
  const mail = buildSignUpThanksEmail("Sam Example");

  it("says the words Jaimie signed off", () => {
    expect(mail.subject).toBe("Thank you for fundraising for NBCC!");
    expect(mail.html).toContain("Fundraising for NBCC");
    expect(mail.html).toContain("Thank you, you’ve made our day!");
    expect(mail.html).toContain("We’re so excited that you want to raise money for NBCC. Every pound you raise helps the families we support, all year round, and we can’t wait to cheer you on.");
    expect(mail.html).toContain("What happens next");
    expect(mail.html).toContain("<ol");
    for (const step of [
      "Someone from our team will look at what you’ve sent us.",
      "We’ll be in touch within a few days, usually with a quick, friendly call, to say hello and talk through your plans.",
      "Once we’ve spoken, we’ll get you set up with everything you need.",
      "Nothing goes on our website until we’ve spoken. If this wasn’t you, don’t worry, you can ignore this email.",
    ]) {
      expect(mail.html).toContain(step);
      expect(mail.text).toContain(step);
    }
    expect(mail.html).toContain("<!doctype html>");
  });

  it("greets them by a safe first name, or just Hi there", () => {
    expect(mail.text).toContain("Hi there Sam,");
    expect(mail.html).toContain("Hi there Sam,");
    for (const typed of ["", "<b>x", "Abcdefghijklmnopqrstuvwxyz", undefined]) {
      expect(buildSignUpThanksEmail(typed).text).toContain("Hi there,");
    }
  });

  // Anyone can type any address into the form, so this email carries nothing else they typed: no
  // title or description, and the name only as one plain word. Otherwise the form is a way to send
  // any words, from NBCC, to anyone.
  it("carries none of their other words", () => {
    const hostile = buildSignUpThanksEmail("Click http://evil.example now");
    expect(hostile.subject + hostile.text + hostile.html).not.toContain("evil.example");
    expect(hostile.text).toContain("Hi there Click,");
    const long = buildSignUpThanksEmail(signUp.description);
    expect(long.text).toContain("Hi there Running,");
    expect(long.subject + long.text + long.html).not.toContain("round the park");
    const markup = buildSignUpThanksEmail("<b>Sam</b>");
    expect(markup.subject + markup.text + markup.html).not.toContain("<b>Sam");
  });

  it("is signed, with the questions box", () => expectSignedWithQuestions(mail, "Thanks so much,"));
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

  it("says the words Jaimie signed off, with the next steps", () => {
    expect(mail.html).toContain("Exciting news: a new fundraiser!");
    expect(mail.html).toContain("<b>Robin Testperson</b> has signed up <b>Robin&#39;s &lt;Santa&gt; Dash</b>. Nothing is public until someone approves it.");
    expect(mail.html).toContain("Next steps");
    for (const step of ["Give Robin a ring within a few days to say hello.", "Replying to this email replies to Robin."]) {
      expect(mail.html).toContain(step);
      expect(mail.text).toContain(step);
    }
    expect(mail.html).toContain("Approve or decline in Admin &gt; Fundraising.");
    expect(mail.text).toContain("Approve or decline in Admin > Fundraising.");
    expect(mail.html).toContain(">Open the admin</a>");
  });

  it("signs off Go team!, with no questions box: it is for the team", () => {
    expect(mail.html).toContain("Go team!<br>");
    expect(mail.text).toContain("Go team!\nNBCC Team");
    expect(mail.html).not.toContain("Got any questions?");
    expect(mail.text).not.toContain("Got any questions?");
  });

  it("says when it is only to let us know", () => {
    const privateOne = buildSignUpStaffEmail({ ...signUp, id: 43, public: false }, { adminUrl: "https://nbcc.scot/admin" });
    expect(privateOne.text).toMatch(/not to be shown on the website/i);
  });

  it("is plain English", () => expectPlainEnglish(mail.text));
});

describe("your page is live", () => {
  const mail = buildApprovedEmail(who, { pageUrl: PAGE, manageUrl: "https://nbcc.scot/fundraise/manage" });

  it("says the words Jaimie signed off, with the link to their page", () => {
    expect(mail.subject).toBe("Your fundraising page is live: Sam's <Santa> Dash");
    expect(mail.html).toContain("Your page is live!");
    expect(mail.text).toContain("Hi Sam,");
    expect(mail.html).toContain("Brilliant news: <b>Sam&#39;s &lt;Santa&gt; Dash</b> is approved and your very own NBCC fundraising page is live. We can’t wait to watch your meter fill up!");
    expect(mail.html).toContain(`href="${PAGE}"`);
    expect(mail.html).toContain(">See my page</a>");
    expect(mail.text).toContain(PAGE);
    expect(mail.html).toContain("Three things to do today");
    expect(mail.html).toContain("<b>Share your page</b> on Facebook, WhatsApp and by email. Most gifts come from people you know.");
    expect(mail.html).toContain("<b>Make the first gift yourself</b> if you can. Pages that start with a gift tend to raise more.");
    expect(mail.html).toContain("<b>Print your QR code</b> from your private area, for posters, buckets and the office fridge.");
    expect(mail.text).toContain("Share your page on Facebook, WhatsApp and by email. Most gifts come from people you know.");
    expect(mail.html).toContain("Every gift comes straight to NBCC, with Gift Aid on top when your supporters are UK taxpayers, and every message lands on your supporter wall.");
    expect(mail.text).toContain("We send you a code to get in, so there are no passwords to remember.");
    expect(mail.text).toContain("https://nbcc.scot/fundraise/manage");
  });

  it("is signed, with the questions box", () => expectSignedWithQuestions(mail, "Cheering you on all the way,"));
  it("is plain English", () => expectPlainEnglish(mail.text));
});

describe("you're on our list", () => {
  const mail = buildApprovedEmail(who, { pageUrl: null, manageUrl: null });

  it("says the words Jaimie signed off, with no page link", () => {
    expect(mail.subject).toBe("You're on our list: Sam's <Santa> Dash");
    expect(mail.html).toContain("You’re on our list!");
    expect(mail.html).toContain("Thank you so much for doing <b>Sam&#39;s &lt;Santa&gt; Dash</b> for NBCC. It’s all approved, and you’re officially part of the NBCC family.");
    expect(mail.html).toContain("If you asked us to show it, you’ll find it on our Get involved page at <b>nbcc.scot/get-involved</b>. We’ll be in touch about anything you asked us for.");
    expect(mail.text).not.toContain("/fundraise/");
  });

  it("is signed, with the questions box", () => expectSignedWithQuestions(mail, "You’re a star. Thank you,"));
  it("is plain English", () => expectPlainEnglish(mail.text));
});

describe("the manage link", () => {
  const link = "https://nbcc.scot/fundraise/manage?token=abcDEF123_xyz";
  const mail = buildManageLinkEmail(who, link);

  it("carries the link, and says it lasts 24 hours", () => {
    expect(mail.text).toContain(link);
    expect(mail.html).toContain(link);
    expect(mail.text).toMatch(/24 hours/);
    expect(mail.text).toMatch(/did not ask/);
  });

  it("is signed, with the questions box", () => expectSignedWithQuestions(mail, "Happy fundraising!"));
  it("is plain English", () => expectPlainEnglish(mail.text));
});

describe("your update is live", () => {
  const mail = buildEditApprovedEmail(who, { pageUrl: PAGE });

  it("says the words Jaimie signed off, with the link to their page", () => {
    expect(mail.subject).toBe("Your update is live: Sam's <Santa> Dash");
    expect(mail.html).toContain("Your update is live!");
    expect(mail.text).toContain("Hi Sam,");
    expect(mail.html).toContain("Good news: we’ve checked your changes to <b>Sam&#39;s &lt;Santa&gt; Dash</b> and they’re now on your page.");
    expect(mail.html).toContain("Why not share it again so everyone sees what’s new? A fresh share often brings in a few more gifts.");
    expect(mail.html).toContain(`href="${PAGE}"`);
    expect(mail.text).toContain(PAGE);
  });

  it("leaves out the page link and the share when there is no page to see", () => {
    const noPage = buildEditApprovedEmail(who, { pageUrl: null });
    expect(noPage.text).not.toContain("/fundraise/");
    expect(noPage.html).not.toContain("See my page");
    expect(noPage.text).not.toContain("share it again");
  });

  it("is signed, with the questions box", () => expectSignedWithQuestions(mail, "Thanks so much,"));
  it("is plain English", () => expectPlainEnglish(mail.text));
});

describe("about your update", () => {
  const mail = buildEditRejectedEmail(who);

  it("says the words Jaimie signed off", () => {
    expect(mail.subject).toBe("About your update to Sam's <Santa> Dash");
    expect(mail.html).toContain("About your update");
    expect(mail.text).toContain("Hi Sam,");
    expect(mail.html).toContain("Thank you for updating <b>Sam&#39;s &lt;Santa&gt; Dash</b>. We haven’t put this change on your page just yet, and someone from our team will give you a quick ring to talk it through.");
    expect(mail.html).toContain("Nothing to worry about: your page is still live, just as it was, and gifts are still coming in.");
    expect(mail.html).not.toContain("<Santa>");
  });

  it("is signed, with the questions box", () => expectSignedWithQuestions(mail, "Speak soon,"));
  it("is plain English", () => expectPlainEnglish(mail.text));
});
