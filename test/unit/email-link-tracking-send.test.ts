import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// TASK-480: the utm words are added in ONE place, just before an email leaves (sendAndLog in
// src/clients/email.ts), to both its html and its plain text. Newsletters name their issue; every
// other email names its kind. Every address here is invented.

const { sendSes, record } = vi.hoisted(() => ({
  sendSes: vi.fn<(msg: unknown) => Promise<string>>(async () => "ses-message-1"),
  record: vi.fn<(row: unknown) => Promise<undefined>>(async () => undefined),
}));

vi.mock("../../src/config", () => ({
  config: {
    EMAIL_PROVIDER: "ses",
    NODE_ENV: "production",
    MAIL_FROM: "noreply@nbcc.scot",
    SES_TRANSACTIONAL_CONFIGURATION_SET: "transactional",
    SES_NEWSLETTER_CONFIGURATION_SET: "newsletter",
    PORTAL_BASE_URL: "https://site.example.test",
    BALL_BASE_URL: "https://nbcc.scot",
  },
}));
vi.mock("../../src/clients/ses", () => ({ sendSesEmail: sendSes }));
vi.mock("../../src/db/email-log", () => ({ recordEmailSend: record }));

import { sendBallConfirmation, sendNewsletter, sendDonationConfirmation } from "../../src/clients/email";
import { newsletterLinkTags } from "../../src/email/tracked-links";

type Sent = { html?: string; text?: string; headers?: Record<string, string> };
const lastSent = () => sendSes.mock.calls[sendSes.mock.calls.length - 1][0] as Sent;

beforeEach(() => {
  sendSes.mockClear();
  record.mockClear();
});

describe("other emails name their kind", () => {
  it("tags a Ball confirmation's links in html and text", async () => {
    await sendBallConfirmation({
      email: "buyer@example.com",
      from: "events@nbcc.scot",
      replyTo: "events@nbcc.scot",
      subject: "Your Festive Ball tickets",
      html: '<a href="https://nbcc.scot/ball">The Ball</a> <a href="https://nbcc.scot/ball/guests/abc">Guests</a>',
      text: "The Ball: https://nbcc.scot/ball\nGuests: https://nbcc.scot/ball/guests/abc",
    });
    const sent = lastSent();
    expect(sent.html).toBe(
      '<a href="https://nbcc.scot/ball?utm_source=email&amp;utm_medium=email&amp;utm_campaign=ballConfirmation">The Ball</a> <a href="https://nbcc.scot/ball/guests/abc">Guests</a>',
    );
    expect(sent.text).toBe(
      "The Ball: https://nbcc.scot/ball?utm_source=email&utm_medium=email&utm_campaign=ballConfirmation\nGuests: https://nbcc.scot/ball/guests/abc",
    );
  });

  it("counts the configured site address as ours", async () => {
    await sendDonationConfirmation({
      email: "donor@example.com",
      fullName: "Sam Example",
      amountPence: 1000,
      currency: "gbp",
      html: '<a href="https://site.example.test/events">Events</a>',
      text: "Events: https://site.example.test/events",
    });
    const sent = lastSent();
    expect(sent.html).toContain("https://site.example.test/events?utm_source=email&amp;utm_medium=email&amp;utm_campaign=donation");
    expect(sent.text).toContain("https://site.example.test/events?utm_source=email&utm_medium=email&utm_campaign=donation");
  });
});

describe("newsletters name their issue", () => {
  const base = {
    email: "reader@example.com",
    from: "NBCC <hello@news.nbcc.scot>",
    replyTo: "hello@nbcc.scot",
    subject: "Autumn news",
    html: '<a href="https://nbcc.scot/events">Events</a> <a href="https://site.example.test/unsubscribe/abc">Unsubscribe</a>',
    text: "Events (https://nbcc.scot/events)\nUnsubscribe (https://site.example.test/unsubscribe/abc)",
    unsubscribeUrl: "https://site.example.test/unsubscribe/abc",
  };

  it("tags with the newsletter words and leaves unsubscribe alone", async () => {
    await sendNewsletter({ ...base, links: newsletterLinkTags(42) });
    const sent = lastSent();
    expect(sent.html).toBe(
      '<a href="https://nbcc.scot/events?utm_source=newsletter&amp;utm_medium=email&amp;utm_campaign=42">Events</a> <a href="https://site.example.test/unsubscribe/abc">Unsubscribe</a>',
    );
    expect(sent.text).toBe(
      "Events (https://nbcc.scot/events?utm_source=newsletter&utm_medium=email&utm_campaign=42)\nUnsubscribe (https://site.example.test/unsubscribe/abc)",
    );
    expect(sent.headers?.["List-Unsubscribe"]).toBe("<https://site.example.test/unsubscribe/abc>");
  });

  it("leaves a newsletter with no tags given (the admin test send) exactly as it is", async () => {
    await sendNewsletter(base);
    const sent = lastSent();
    expect(sent.html).toBe(base.html);
    expect(sent.text).toBe(base.text);
  });
});

describe("the senders pass the right tags", () => {
  const read = (p: string) => readFileSync(resolve(__dirname, "../../", p), "utf8");

  it("the newsletter send job names the newsletter by its id", () => {
    expect(read("src/newsletter/send-worker.ts")).toContain("links: newsletterLinkTags(job.newsletterId)");
  });

  it("the footer signup welcome names itself as the welcome email", () => {
    expect(read("src/routes/subscribe.ts")).toContain('links: emailLinkTags("welcome")');
  });
});
