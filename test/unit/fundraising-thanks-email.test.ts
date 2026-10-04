import { describe, it, expect } from "vitest";
import { buildSupporterThanksEmail } from "../../src/fundraising/thanks-email";
import {
  emailShell,
  eyebrow,
  heading,
  subheading,
  bodyP,
  button,
  quoteBox,
  signOff,
  signOffText,
  signOffAs,
  signOffAsText,
  questionsBox,
  questionsText,
  ABOUT_NBCC_FULL,
} from "../../src/email/brand";
import { FOOTER_TEXT, POSTAL_ADDRESS } from "../../src/legal/registration";

// TASK-507: email 20, to a giver when the organiser thanks them (staff check it first), in the words
// Jaimie approved on 2026-10-02. Built from the brand helpers, so it sits in NBCC's usual shell with
// the events inbox as the contact. Every name and word here is invented.
//
// 2026-10-04: many of these givers have never dealt with NBCC, so the ordinary version now says who
// the charity is (its own description, once) and invites them to keep in touch: a button to the
// mailing list page and a link to the Get involved page. An invitation only. The in memory version
// is exactly as it was.

const BASE = "https://nbcc.test";
const NEWSLETTER = "https://nbcc.test/newsletter";
const GET_INVOLVED = "https://nbcc.test/get-involved";
const shell = (body: string) => emailShell(body, { contactEmail: "events@nbcc.scot", registration: true, postalAddress: POSTAL_ADDRESS });
const MESSAGE = "Thank you so much for sponsoring me! I’ll be running in my Santa suit.";
const LAST = "And from all of us: thank you too.";
const OLD_LAST = "And from all of us: thank you too. Your gift helps the children, young people and vulnerable adults we support across South West Scotland, all year round.";
const KEEP_HEADING = "We'd love to keep in touch";
const KEEP = "If you'd like to hear how your gift helps, join our mailing list. It's a few emails a year, and you can unsubscribe at any time.";
const JOIN = "Join our mailing list";
const MORE = "There's lots going on, too. See what's coming up, and support the people fundraising for NBCC, on our";
const WHO = "children, young people and vulnerable adults";
const count = (s: string, needle: string) => s.split(needle).length - 1;

describe("email 20, a thank you passed on to a giver", () => {
  const mail = buildSupporterThanksEmail({ organiserName: "sam example", title: "Sam's Santa Dash", message: MESSAGE, baseUrl: BASE });

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
          bodyP(ABOUT_NBCC_FULL) +
          subheading(KEEP_HEADING) +
          bodyP(KEEP) +
          button(NEWSLETTER, JOIN) +
          bodyP(`${MORE} <a href="${GET_INVOLVED}" style="color:inherit">Get involved page</a>.`) +
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
        ABOUT_NBCC_FULL,
        "",
        KEEP_HEADING,
        KEEP,
        `${JOIN}: ${NEWSLETTER}`,
        "",
        `${MORE} Get involved page: ${GET_INVOLVED}`,
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
    const m = buildSupporterThanksEmail({ organiserName: "Sam", title: "<b>Dash</b>", message: "Line one\n<script>x</script>", baseUrl: BASE });
    expect(m.html).not.toContain("<script>");
    expect(m.html).toContain("&lt;script&gt;");
    expect(m.html).toContain("Line one<br>");
    expect(m.html).toContain("<b>&lt;b&gt;Dash&lt;/b&gt;</b>");
  });

  it("never puts anything but a plain first name in the subject or heading", () => {
    const m = buildSupporterThanksEmail({ organiserName: "http://phish.example Sam", title: "Dash", message: "Thanks", baseUrl: BASE });
    expect(m.subject).toBe("A thank you for your gift");
    expect(m.html).toContain(heading("A thank you for your gift"));
    expect(m.html).toContain(bodyP("The organiser asked us to pass this on to you, for your gift to <b>Dash</b>:"));
    expect(m.html).not.toContain("phish");
    expect(m.text).not.toContain("phish");
  });

  it("carries nothing about who else was thanked, or the organiser's email", () => {
    const m = buildSupporterThanksEmail({ organiserName: "Sam", title: "Dash", message: "Thanks", baseUrl: BASE });
    expect(m.html).not.toMatch(/sam@|@example/);
  });
});

describe("email 20 introduces NBCC and invites the giver to keep in touch", () => {
  const mail = buildSupporterThanksEmail({ organiserName: "Sam Example", title: "Sam's Santa Dash", message: MESSAGE, baseUrl: BASE });
  const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);

  it("has the charity's own description once, as its own paragraph, in both parts", () => {
    expect(count(mail.html, ABOUT_NBCC_FULL)).toBe(1);
    expect(mail.html).toContain(bodyP(ABOUT_NBCC_FULL));
    expect(count(mail.text, ABOUT_NBCC_FULL)).toBe(1);
    expect(mail.text).toContain(`\n\n${ABOUT_NBCC_FULL}\n\n`);
  });

  it("no longer has the old closing sentence, so the same people are not listed twice", () => {
    expect(mail.html + mail.text).not.toContain("Your gift helps the children");
    expect(mail.html + mail.text).not.toContain(OLD_LAST);
    expect(count(mail.text, WHO)).toBe(1);
    expect(count(mail.html, WHO)).toBe(1);
  });

  it("has the keep in touch heading and the standard button to the mailing list page", () => {
    expect(mail.html).toContain(subheading(KEEP_HEADING));
    expect(mail.html).toContain(bodyP(KEEP));
    expect(mail.html).toContain(button(NEWSLETTER, JOIN));
    expect(count(mail.html, `href="${NEWSLETTER}"`)).toBe(1);
  });

  it("links the Get involved page", () => {
    expect(mail.html).toContain(`<a href="${GET_INVOLVED}" style="color:inherit">Get involved page</a>.`);
    expect(count(mail.html, `href="${GET_INVOLVED}"`)).toBe(1);
  });

  it("writes both addresses out in the plain text part", () => {
    expect(mail.text).toContain(`${JOIN}: ${NEWSLETTER}\n`);
    expect(mail.text).toContain(`Get involved page: ${GET_INVOLVED}\n`);
  });

  it("is an invitation only: the two links carry no token, no query string and nothing about the giver", () => {
    const named = buildSupporterThanksEmail({ organiserName: "Sam Example", title: "Sam's Santa Dash", message: MESSAGE, baseUrl: BASE, giverName: "Alex Example" });
    expect(named).toEqual(mail);
    const site = hrefs(mail.html).filter((h) => h.startsWith(BASE));
    expect(site.sort()).toEqual([GET_INVOLVED, NEWSLETTER]);
    for (const part of [mail.html, mail.text]) {
      expect(part).not.toMatch(/nbcc\.test\/[^\s"<]*[?#&=]/);
      expect(part).not.toMatch(/token|utm_/i);
      expect(part).not.toContain("Alex");
    }
  });

  it("builds the links on the base it is given, with or without a trailing slash", () => {
    const m = buildSupporterThanksEmail({ organiserName: "Sam", title: "Dash", message: "Thanks", baseUrl: "https://nbcc.test/" });
    expect(m.html).toContain(`href="${NEWSLETTER}"`);
    expect(m.html).toContain(`href="${GET_INVOLVED}"`);
    expect(m.text).not.toContain("nbcc.test//");
  });

  it("is in plain words: no long dashes, and straight apostrophes in NBCC's own lines", () => {
    const own = buildSupporterThanksEmail({ organiserName: "Sam", title: "Dash", message: "Thanks", baseUrl: BASE });
    expect(own.text).not.toMatch(/[–—‘’]/);
  });
});

describe("email 20 on a page in memory of someone is as it was", () => {
  const m = buildSupporterThanksEmail({ organiserName: "Sam Example", title: "In memory of Mary Example", message: "Thank you.", inMemory: true, giverName: "Alex Example", baseUrl: BASE });
  const memoryShell = (body: string) => emailShell(body, { contactEmail: "jodie@nbcc.scot", registration: true, postalAddress: POSTAL_ADDRESS });

  it("is exactly the gentle version, from Jodie, with the closing line it always had", () => {
    expect(m.html).toBe(
      memoryShell(
        eyebrow("In memory") +
          heading("A thank you from Sam") +
          bodyP("Dear Alex,") +
          bodyP("Sam asked us to pass this on to you, for your gift to <b>In memory of Mary Example</b>:") +
          quoteBox("“Thank you.”") +
          bodyP(OLD_LAST) +
          signOffAs("With warmest thoughts,", "Jodie") +
          questionsBox("jodie@nbcc.scot"),
      ),
    );
    expect(m.text).toBe(
      [
        "In memory",
        "A thank you from Sam",
        "",
        "Dear Alex,",
        "",
        "Sam asked us to pass this on to you, for your gift to In memory of Mary Example:",
        "",
        "“Thank you.”",
        "",
        OLD_LAST,
        "",
        signOffAsText("With warmest thoughts,", "Jodie"),
        "",
        questionsText("jodie@nbcc.scot"),
        "",
        FOOTER_TEXT,
      ].join("\n"),
    );
  });

  it("carries none of the keep in touch section", () => {
    for (const part of [m.html, m.text]) {
      expect(part).not.toContain("volunteer led");
      expect(part).not.toContain(KEEP_HEADING);
      expect(part).not.toContain("mailing list");
      expect(part).not.toContain("nbcc.test");
      expect(part).not.toContain("Get involved");
    }
  });
});
