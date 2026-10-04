import { describe, it, expect } from "vitest";
import { buildSignupConfirmEmail } from "../../src/mailing-list/confirm-email";
import { WHO_WE_ARE_SHORT } from "../../src/mailing-list/model";

// Joining the mailing list from /newsletter: the one email, asking them to confirm. Short, in the
// shared brand shell, and it carries nothing a stranger typed but one plain first name.

const URL = "https://nbcc.test/newsletter/confirm?t=abc";
const build = (firstName = "Sam") => buildSignupConfirmEmail({ firstName, confirmUrl: URL });

describe("the email asking someone to confirm they want to join the mailing list", () => {
  it("says there is one more step, with one button to the link", () => {
    const e = build();
    expect(e.subject).toBe("One more step to join the NBCC mailing list");
    expect(e.html).toContain(">One more step</h1>");
    expect(e.html).toContain(`href="${URL}"`);
    expect(e.html).toContain(">Yes, add me to the mailing list</a>");
    expect(e.html.match(/href="https:\/\/nbcc\.test\/newsletter\/confirm/g)).toHaveLength(1);
  });

  it("greets them by first name, and says who NBCC is in the charity's own words", () => {
    const e = build();
    expect(e.html).toContain("Hello Sam,");
    expect(e.html).toContain(WHO_WE_ARE_SHORT);
    expect(e.text).toContain(WHO_WE_ARE_SHORT);
  });

  it("says they can ignore it and nothing will happen", () => {
    const line = "If you didn't ask for this, you can ignore this email and nothing will happen.";
    expect(build().html).toContain(line.replace("'", "&#39;"));
    expect(build().text).toContain(line);
  });

  it("says how long the link works and that they can unsubscribe", () => {
    expect(build().text).toContain("The link works for 7 days.");
    expect(build().text).toContain("unsubscribe at any time");
  });

  it("is in the shared brand shell", () => {
    const e = build();
    expect(e.html).toContain("https://nbcc.scot/assets/img/nbcc-logo.png");
    expect(e.html).toContain("Scottish Charity Number SC047995");
    expect(e.html).toContain("info@nbcc.scot");
  });

  it("has a plain text part with the link written out", () => {
    const e = build();
    expect(e.text).toContain(`Yes, add me to the mailing list: ${URL}`);
    expect(e.text).not.toMatch(/<[a-z]/i);
  });

  it("a first name that is not a plain name is left out, so the form cannot send anyone's words", () => {
    for (const odd of ["https://bad.example", "<b>Sam</b>", "Win-a-prize-at-bad.example", ""]) {
      const e = build(odd);
      expect(e.html).toContain("Hello,");
      expect(e.html).not.toContain("bad.example");
      expect(e.text).not.toContain("bad.example");
    }
  });

  it("uses plain UK English: no long dashes and straight apostrophes", () => {
    const e = build();
    for (const part of [e.subject, e.html, e.text]) expect(part).not.toMatch(/[–—‘’]/);
  });
});
