import { describe, it, expect } from "vitest";
import { buildSupporterThanksEmail } from "../../src/fundraising/thanks-email";
import {
  emailShell,
  eyebrow,
  heading,
  bodyP,
  quoteBox,
  signOff,
  signOffText,
  questionsBox,
  questionsText,
} from "../../src/email/brand";
import { FOOTER_TEXT, POSTAL_ADDRESS } from "../../src/legal/registration";

// TASK-507: email 20, to a giver when the organiser thanks them (staff check it first), in the words
// Jaimie approved on 2026-10-02. Built from the brand helpers, so it sits in NBCC's usual shell with
// the events inbox as the contact. Every name and word here is invented.

const shell = (body: string) => emailShell(body, { contactEmail: "events@nbcc.scot", registration: true, postalAddress: POSTAL_ADDRESS });
const MESSAGE = "Thank you so much for sponsoring me! I’ll be running in my Santa suit.";
const LAST = "And from all of us: thank you too. Your gift helps the children, young people and vulnerable adults we support, all year round.";

describe("email 20, a thank you passed on to a giver", () => {
  const mail = buildSupporterThanksEmail({ organiserName: "sam example", title: "Sam's Santa Dash", message: MESSAGE });

  it("is from the organiser's first name in the subject", () => {
    expect(mail.subject).toBe("A thank you from Sam");
  });

  it("is exactly the approved words in the html", () => {
    expect(mail.html).toBe(
      shell(
        eyebrow("Fundraising for NBCC") +
          heading("A thank you from Sam") +
          bodyP("Hello,") +
          bodyP("Sam asked us to pass this on to you, for your gift to <b>Sam&#39;s Santa Dash</b>:") +
          quoteBox(`“${MESSAGE}”`) +
          bodyP(LAST) +
          signOff("Thanks so much,") +
          questionsBox("events@nbcc.scot"),
      ),
    );
  });

  it("says the same in the plain text part", () => {
    expect(mail.text).toBe(
      [
        "Fundraising for NBCC",
        "A thank you from Sam",
        "",
        "Hello,",
        "",
        "Sam asked us to pass this on to you, for your gift to Sam's Santa Dash:",
        "",
        `“${MESSAGE}”`,
        "",
        LAST,
        "",
        signOffText("Thanks so much,"),
        "",
        questionsText("events@nbcc.scot"),
        "",
        FOOTER_TEXT,
      ].join("\n"),
    );
  });

  it("escapes the message and the title, and keeps the message's line breaks", () => {
    const m = buildSupporterThanksEmail({ organiserName: "Sam", title: "<b>Dash</b>", message: "Line one\n<script>x</script>" });
    expect(m.html).not.toContain("<script>");
    expect(m.html).toContain("&lt;script&gt;");
    expect(m.html).toContain("Line one<br>");
    expect(m.html).toContain("<b>&lt;b&gt;Dash&lt;/b&gt;</b>");
  });

  it("never puts anything but a plain first name in the subject or heading", () => {
    const m = buildSupporterThanksEmail({ organiserName: "http://phish.example Sam", title: "Dash", message: "Thanks" });
    expect(m.subject).toBe("A thank you for your gift");
    expect(m.html).toContain(heading("A thank you for your gift"));
    expect(m.html).toContain(bodyP("The organiser asked us to pass this on to you, for your gift to <b>Dash</b>:"));
    expect(m.html).not.toContain("phish");
    expect(m.text).not.toContain("phish");
  });

  it("carries nothing about who else was thanked, or the organiser's email", () => {
    const m = buildSupporterThanksEmail({ organiserName: "Sam", title: "Dash", message: "Thanks" });
    expect(m.html).not.toMatch(/sam@|@example/);
  });
});
