import { describe, it, expect, vi, beforeEach } from "vitest";

// The readthrough (2026-10-04): what the in memory emails are SENT with. From "Jodie at NBCC"
// <jodie@nbcc.scot>, Reply-To jodie@nbcc.scot, on the same nbcc.scot sending identity as every other
// transactional email (the identity is the whole domain, so any address at nbcc.scot signs and
// aligns the same way). The email log, the transactional configuration set (which is what carries
// bounces and complaints back) and the copy to an invite's signer all work as before. Everything
// that is not in memory is sent exactly as it was. Every name and address here is invented.

const { sendSes, record } = vi.hoisted(() => ({
  sendSes: vi.fn<(msg: unknown) => Promise<string>>(async () => "ses-message-1"),
  record: vi.fn<(row: unknown) => Promise<undefined>>(async () => undefined),
}));
const db = vi.hoisted(() => ({ claimNextWaitingLiveEmail: vi.fn(), markLiveEmailWaiting: vi.fn(), fundraisingIsOn: vi.fn(), websiteChoiceChangedByStaff: vi.fn() }));

vi.mock("../../src/config", () => ({
  config: {
    EMAIL_PROVIDER: "ses",
    NODE_ENV: "production",
    MAIL_FROM: "noreply@nbcc.scot",
    SES_TRANSACTIONAL_CONFIGURATION_SET: "transactional",
    PORTAL_BASE_URL: "https://nbcc.scot",
    BALL_BASE_URL: "https://nbcc.scot",
    BALL_FROM_EMAIL: "events@nbcc.scot",
  },
}));
vi.mock("../../src/clients/ses", () => ({ sendSesEmail: sendSes }));
vi.mock("../../src/db/email-log", () => ({ recordEmailSend: record }));
vi.mock("../../src/db/fundraisers", () => db);

import { sendApprovedEmail, sendSignInCodeEmail, sendSignUpEmails } from "../../src/fundraising/send";
import { memorySender } from "../../src/fundraising/emails";
import { sendFundraiseInvite } from "../../src/clients/email";
import { buildSesSendRequest, type SesMessage } from "../../src/clients/ses-request";
import type { FundraiserRecord } from "../../src/fundraising/model";

const JODIE_FROM = "Jodie at NBCC <jodie@nbcc.scot>";
const JODIE = "jodie@nbcc.scot";
const EVENTS = "events@nbcc.scot";

const record9 = (over: Partial<FundraiserRecord> = {}): FundraiserRecord =>
  ({
    id: 9, slug: "ime", path: "raising", kind: "other", title: "In memory of Margaret Exampleton", description: "Remembering Margaret.",
    eventDate: null, startTime: null, venue: "", town: "", targetPence: 50000, public: true, status: "approved", name: "Sam Example",
    firstName: "Sam", email: "sam@example.com", phone: "07700 900456", socialLink: null, socialOk: false,
    wants: { posterCount: 0, leafletCount: 0, bucketCount: 0, tinCount: 0, leaflets: 0, buckets: 0, shoutOut: false, attend: false },
    postAddress: null, newsletterOk: false, imageSrc: null, declinedReason: null, createdAt: "2026-10-02T10:00:00.000Z", approvedAt: null,
    approvedBy: null, updatedAt: "2026-10-02T10:00:00.000Z", updatedBy: null, inMemory: true, memoryName: "Margaret Exampleton",
    memoryDates: "1948 to 2026", memorySetupBy: "family", memoryPermission: true, memoryShowTarget: false, ...over,
  }) as FundraiserRecord;

/** What went to SES, by the subject it carried. */
const sent = (): SesMessage[] => sendSes.mock.calls.map((c) => c[0] as SesMessage);
const logged = (): Array<{ kind: string; recipient: string; status: string; sesMessageId: string | null }> =>
  record.mock.calls.map((c) => c[0] as { kind: string; recipient: string; status: string; sesMessageId: string | null });

beforeEach(() => {
  sendSes.mockClear();
  record.mockClear();
  for (const fn of Object.values(db)) fn.mockReset().mockResolvedValue(undefined);
  db.fundraisingIsOn.mockResolvedValue(true);
  db.websiteChoiceChangedByStaff.mockResolvedValue(false);
});

describe("the sender for the in memory path", () => {
  it("is Jodie, with her name, replying to her", () => {
    expect(memorySender()).toEqual({ from: JODIE_FROM, replyTo: JODIE });
  });
});

describe("after an in memory sign up", () => {
  it("sends the family the short note from Jodie, replying to Jodie", async () => {
    await sendSignUpEmails(record9());
    const note = sent().find((m) => m.subject === "We have your details for the page") as SesMessage;
    expect(note.to).toBe("sam@example.com");
    expect(note.from).toBe(JODIE_FROM);
    expect(note.replyTo).toBe(JODIE);
    expect(note.html).not.toContain("events@");
    expect(buildSesSendRequest(note)).toMatchObject({
      FromEmailAddress: JODIE_FROM,
      ReplyToAddresses: [JODIE],
      Destination: { ToAddresses: ["sam@example.com"] },
      // The configuration set is what sends bounces and complaints back to the suppression list.
      ConfigurationSetName: "transactional",
    });
  });

  it("still logs it, with the id SES gave it, so a bounce finds its row", async () => {
    await sendSignUpEmails(record9());
    expect(logged()).toContainEqual(expect.objectContaining({ kind: "fundraiseMemoryReceipt", recipient: "sam@example.com", status: "sent", sesMessageId: "ses-message-1" }));
  });

  it("leaves the notice to staff as it was: from and to the events inbox, replying to the family", async () => {
    await sendSignUpEmails(record9());
    const notice = sent().find((m) => m.subject.startsWith("New page in memory of")) as SesMessage;
    expect(notice).toMatchObject({ to: EVENTS, from: EVENTS, replyTo: "sam@example.com" });
    expect(notice.html).toContain("mailto:events@nbcc.scot");
  });
});

describe("when staff approve an in memory page", () => {
  it.each([["a family", "family"], ["a funeral director", "funeral_director"]])("tells %s from Jodie, replying to Jodie", async (_who, setupBy) => {
    expect(await sendApprovedEmail(record9({ memorySetupBy: setupBy as FundraiserRecord["memorySetupBy"] }))).toBe(true);
    const [mail] = sent();
    expect(mail.subject).toBe("Your page in memory of Margaret Exampleton");
    expect(mail.from).toBe(JODIE_FROM);
    expect(mail.replyTo).toBe(JODIE);
    expect(mail.html + (mail.text ?? "")).not.toContain("events@");
    expect(logged()).toContainEqual(expect.objectContaining({ kind: "fundraiseApproved", recipient: "sam@example.com", status: "sent" }));
  });
});

describe("the sign in code", () => {
  it("comes from Jodie for someone with a page in memory of someone", async () => {
    await sendSignInCodeEmail("sam@example.com", "Sam Example", "123456", { gentle: true });
    const [mail] = sent();
    expect(mail.from).toBe(JODIE_FROM);
    expect(mail.replyTo).toBe(JODIE);
    expect(mail.html).not.toContain("events@");
    // The log still keeps a subject without the code.
    expect(record.mock.calls[0][0]).toMatchObject({ kind: "fundraiseCode", subject: "Your NBCC sign in code" });
  });

  it("comes from the events inbox, as it always did, for anyone else", async () => {
    await sendSignInCodeEmail("sam@example.com", "Sam Example", "123456");
    const [mail] = sent();
    expect(mail.from).toBe(EVENTS);
    expect(mail.replyTo).toBe(EVENTS);
    expect(mail.html).toContain("mailto:events@nbcc.scot");
    expect(mail.html).not.toContain("jodie@");
  });
});

describe("an ordinary fundraiser's emails", () => {
  it("are sent from the events inbox, exactly as before", async () => {
    await sendSignUpEmails(record9({ inMemory: false, title: "Sam's Walk" }));
    await sendApprovedEmail(record9({ inMemory: false, title: "Sam's Walk" }));
    expect(sent().length).toBe(3);
    for (const m of sent()) {
      expect(m.from).toBe(EVENTS);
      expect(m.html + (m.text ?? "")).not.toContain("jodie@");
    }
  });
});

describe("the in memory invite, as SES gets it", () => {
  const MAIL = { email: "morag@example.com", ...memorySender(), subject: "A page in memory of someone you love", html: "<p>x</p>", text: "x" };

  it("is from Jodie, replies to Jodie, and copies in Jodie", async () => {
    await sendFundraiseInvite("Morag Example", { ...MAIL, cc: "jodie@nbcc.scot" });
    const msg = sent()[0];
    expect(buildSesSendRequest(msg)).toMatchObject({
      FromEmailAddress: JODIE_FROM,
      ReplyToAddresses: [JODIE],
      Destination: { ToAddresses: ["morag@example.com"], CcAddresses: ["jodie@nbcc.scot"] },
      ConfigurationSetName: "transactional",
    });
    expect(logged()).toContainEqual(expect.objectContaining({ kind: "fundraiseInvite", recipient: "morag@example.com", status: "sent" }));
  });
});
