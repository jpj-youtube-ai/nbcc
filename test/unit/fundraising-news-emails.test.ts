import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-506: the emails an organiser gets when staff approve or do not use a news update. The same
// style as "Your update is live" and "About your update" (emails 9 and 10), worded for a news update,
// signed, with the questions box. A reason staff give for not using one is internal and never in
// them. Every name and address here is invented.

const mail = vi.hoisted(() => ({
  sendFundraiseNewsApproved: vi.fn(),
  sendFundraiseNewsRejected: vi.fn(),
}));
vi.mock("../../src/clients/email", () => mail);
vi.mock("../../src/db/fundraisers", () => ({ claimNextWaitingLiveEmail: vi.fn(), markLiveEmailWaiting: vi.fn(), fundraisingIsOn: vi.fn() }));
vi.mock("../../src/config", () => ({
  config: { NODE_ENV: "test", PORTAL_BASE_URL: "https://nbcc.test", BALL_FROM_EMAIL: "events@nbcc.test" },
}));

import { buildNewsApprovedEmail, buildNewsRejectedEmail, FUNDRAISING_EMAIL } from "../../src/fundraising/emails";
import { sendNewsDecisionEmail } from "../../src/fundraising/send";
import { PHONE_DISPLAY } from "../../src/email/brand";
import type { FundraiserRecord } from "../../src/fundraising/model";

const who = { name: "Sam Example", title: "Sam's <Santa> Dash" };
const PAGE = "https://nbcc.scot/fundraise/sams-santa-dash";
const words = (text: string) => text.replace(/https?:\/\/\S+/g, "").replace(/\S+@\S+/g, "");

function expectPlainEnglish(text: string) {
  expect(words(text)).not.toMatch(/[–—]/);
  expect(words(text)).not.toMatch(/ - /);
  expect(words(text)).not.toMatch(/[A-Za-z]-[A-Za-z]/);
}
function expectSignedWithQuestions(m: { html: string; text: string }, line: string) {
  expect(m.html).toContain("Got any questions?");
  expect(m.html).toContain(`href="mailto:${FUNDRAISING_EMAIL}"`);
  expect(m.html.indexOf("NBCC Team")).toBeLessThan(m.html.indexOf("Got any questions?"));
  expect(m.text).toContain(line);
  expect(m.text).toContain(`Call us: ${PHONE_DISPLAY}`);
  expect(m.text.indexOf(line)).toBeLessThan(m.text.indexOf("Got any questions?"));
}

describe("Your news update is live", () => {
  const m = buildNewsApprovedEmail(who, { pageUrl: PAGE });

  it("says it is on their page, with the link and a nudge to share", () => {
    expect(m.subject).toBe("Your news update is live: Sam's <Santa> Dash");
    expect(m.html).toContain("Your news update is live!");
    expect(m.text).toContain("Hi Sam,");
    expect(m.html).toContain("Good news: we’ve checked your news update for <b>Sam&#39;s &lt;Santa&gt; Dash</b> and it’s now on your page.");
    expect(m.html).toContain(`href="${PAGE}"`);
    expect(m.text).toContain(`See my page: ${PAGE}`);
    expect(m.text).toContain("share");
    expect(m.html).not.toContain("<Santa>");
  });

  it("says it is saved, with no link, when the page is not up", () => {
    const saved = buildNewsApprovedEmail(who, { pageUrl: null });
    expect(saved.subject).toBe("Your news update is saved: Sam's <Santa> Dash");
    expect(saved.text).toContain("it’s all saved");
    expect(saved.text).not.toContain("See my page");
    expectSignedWithQuestions(saved, "Thanks so much,");
  });

  it("is signed, with the questions box, in plain English", () => {
    expectSignedWithQuestions(m, "Thanks so much,");
    expectPlainEnglish(m.text);
  });
});

describe("About your news update", () => {
  const m = buildNewsRejectedEmail(who, { pageLive: true });

  it("says kindly that it is not on the page, and that we will ring", () => {
    expect(m.subject).toBe("About your news update for Sam's <Santa> Dash");
    expect(m.html).toContain("About your news update");
    expect(m.text).toContain("Hi Sam,");
    expect(m.html).toContain(
      "Thank you for sending a news update for <b>Sam&#39;s &lt;Santa&gt; Dash</b>. We haven’t put this one on your page, and someone from our team will give you a quick ring to talk it through.",
    );
    expect(m.html).toContain("Nothing to worry about: your page is still live, just as it was, and gifts are still coming in.");
  });

  it("does not talk about a live page when there is none", () => {
    const quiet = buildNewsRejectedEmail(who, { pageLive: false });
    expect(quiet.text).toContain("Nothing to worry about: everything stays just as it was.");
    expect(quiet.text).not.toContain("still live");
  });

  it("is signed, with the questions box, in plain English", () => {
    expectSignedWithQuestions(m, "Speak soon,");
    expectPlainEnglish(m.text);
  });
});

describe("sending them", () => {
  const record = (over: Partial<FundraiserRecord> = {}) =>
    ({
      id: 9, slug: "sams-walk", path: "raising", kind: "run_walk", title: "Sam's Walk", name: "Sam Example",
      email: "sam@example.com", public: true, status: "approved", ...over,
    }) as FundraiserRecord;

  beforeEach(() => {
    for (const fn of Object.values(mail)) fn.mockReset().mockResolvedValue(undefined);
  });

  it("sends Your news update is live, with the page link while the page is up, from the events inbox", async () => {
    expect(await sendNewsDecisionEmail(record(), true, true)).toBe(true);
    const [name, sent] = mail.sendFundraiseNewsApproved.mock.calls[0];
    expect(name).toBe("Sam Example");
    expect(sent).toMatchObject({ email: "sam@example.com", from: "events@nbcc.test", replyTo: "events@nbcc.test" });
    expect(sent.text).toContain("See my page: https://nbcc.test/fundraise/sams-walk");
  });

  it("leaves the link out while fundraising is switched off", async () => {
    await sendNewsDecisionEmail(record(), true, false);
    expect(mail.sendFundraiseNewsApproved.mock.calls[0][1].text).not.toContain("See my page");
  });

  it("sends About your news update when it is not used", async () => {
    await sendNewsDecisionEmail(record(), false, true);
    expect(mail.sendFundraiseNewsApproved).not.toHaveBeenCalled();
    expect(mail.sendFundraiseNewsRejected.mock.calls[0][1].subject).toBe("About your news update for Sam's Walk");
  });

  it("never throws when the email cannot go: the decision stands", async () => {
    mail.sendFundraiseNewsRejected.mockRejectedValue(new Error("SES is down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await sendNewsDecisionEmail(record(), false, true)).toBe(false);
    err.mockRestore();
  });
});
