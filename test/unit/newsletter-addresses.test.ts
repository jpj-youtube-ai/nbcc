import { describe, it, expect } from "vitest";
import { configSchema } from "../../src/config/schema";

// TASK-298: the newsletter now sends from its own domain, news.nbcc.scot (TASK-296), so a campaign
// that upsets a spam filter cannot drag down the deliverability of donation receipts, Gift Aid
// confirmations or admin login codes — those keep the apex's separate reputation.
//
// The trap: news.nbcc.scot exists ONLY to send. It has no MX and no A record — it is a non-existent
// domain as far as receiving goes — so mail to newsletter@news.nbcc.scot hard-bounces. From and
// Reply-To were a single setting, so switching the From alone would have silently broken every
// reply, including the ones our own pages invite ("just reply to any of our emails and we'll put it
// right"). They are two settings now, and these tests hold them apart.

const field = (key: string) =>
  (configSchema.shape as unknown as Record<string, { parse: (v: unknown) => unknown }>)[key];

const defaultOf = (key: string): string => String(field(key).parse(undefined));

describe("newsletter From and Reply-To (TASK-298)", () => {
  it("sends from the dedicated newsletter domain", () => {
    expect(defaultOf("NEWSLETTER_FROM_EMAIL")).toBe("newsletter@news.nbcc.scot");
  });

  it("takes replies at a mailbox that can actually receive them", () => {
    expect(defaultOf("NEWSLETTER_REPLY_TO_EMAIL")).toBe("newsletter@nbcc.scot");
  });

  it("never points Reply-To at the send-only domain", () => {
    // The whole failure mode, in one assertion: if these two ever collapse back into one value, a
    // supporter hitting Reply gets a bounce instead of reaching a human.
    const replyTo = defaultOf("NEWSLETTER_REPLY_TO_EMAIL");
    expect(replyTo.endsWith("@news.nbcc.scot")).toBe(false);
    expect(replyTo).not.toBe(defaultOf("NEWSLETTER_FROM_EMAIL"));
  });

  it("validates both as real email addresses", () => {
    expect(() => field("NEWSLETTER_REPLY_TO_EMAIL").parse("not-an-email")).toThrow();
    expect(() => field("NEWSLETTER_FROM_EMAIL").parse("not-an-email")).toThrow();
  });

  it("leaves the giving address alone — thank-you letters still send from the apex", () => {
    // Only the newsletter moves. Receipts and thank-you letters are transactional; they belong on
    // the domain whose reputation they already have.
    expect(defaultOf("GIVING_FROM_EMAIL")).toBe("giving@nbcc.scot");
  });
});
