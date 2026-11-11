import { describe, it, expect, vi, beforeEach } from "vitest";

// NBCC Elf Detective School: what the email log keeps. The log is kept for six tax years and copied into
// the nightly backups, so a child's name never goes in it. A promotion's and a graduation's subject name
// the detective, so the proud email's log row keeps a fixed subject instead; the email the family gets is
// unchanged. Every other elf email's subject names no detective. Every name and address here is invented.

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
    PORTAL_BASE_URL: "https://nbcc.scot",
    BALL_BASE_URL: "https://nbcc.scot",
  },
}));
vi.mock("../../src/clients/ses", () => ({ sendSesEmail: sendSes }));
vi.mock("../../src/db/email-log", () => ({ recordEmailSend: record }));

import {
  sendElfClue,
  sendElfFindAlert,
  sendElfMorning,
  sendElfPhotoAlert,
  sendElfPlaceReminder,
  sendElfProud,
  sendElfSignInCode,
  sendElfTestAlert,
  sendElfWelcome,
} from "../../src/clients/email";
import {
  buildElfClueEmail,
  buildElfFindAlertEmail,
  buildElfMorningEmail,
  buildElfPhotoAlertEmail,
  buildElfPlaceReminderEmail,
  buildElfProudEmail,
  buildElfSignInCodeEmail,
  buildElfTestAlertEmail,
  buildElfWelcomeEmail,
  type BuiltEmail,
} from "../../src/elf/emails";

const DETECTIVE = "Detective Ruby Tinselfoot";
const A_DETECTIVE = /Ruby|Tinselfoot/;
const C1 = new Date("2026-12-07T17:30:00.000Z");
const to = (mail: BuiltEmail) => ({ email: "sam@example.com", from: "events@nbcc.scot", replyTo: "events@nbcc.scot", ...mail });
const sentSubject = () => (sendSes.mock.calls.at(-1)![0] as { subject: string }).subject;
const sentHtml = () => (sendSes.mock.calls.at(-1)![0] as { html: string }).html;
const logged = () => record.mock.calls.map((c) => c[0] as { kind: string; subject: string });

beforeEach(() => {
  sendSes.mockClear();
  record.mockClear();
});

describe("the proud email in the email log", () => {
  it("sends a promotion with the detective in its subject, and logs a fixed subject without them", async () => {
    const mail = buildElfProudEmail({ kind: "promoted", grownUpName: "Sam Example", detectiveName: DETECTIVE, rank: "Junior Detective", hqUrl: "https://nbcc.scot/elf/hq", giveUrl: "https://nbcc.scot/donate" });
    await sendElfProud("Sam Example", to(mail));
    expect(sentSubject()).toBe("Detective Ruby Tinselfoot is now a Junior Detective");
    expect(sentHtml()).toContain("Detective Ruby Tinselfoot has been promoted to Junior Detective");
    expect(logged()).toEqual([expect.objectContaining({ kind: "elfProud", subject: "A proud moment from Elf Detective School" })]);
    expect(JSON.stringify(record.mock.calls)).not.toMatch(A_DETECTIVE);
  });

  it("logs the same fixed subject for a graduation and a prize won, and sends each as it was built", async () => {
    const proud = (o: Partial<Parameters<typeof buildElfProudEmail>[0]>) =>
      buildElfProudEmail({ kind: "won", grownUpName: "Sam Example", detectiveName: DETECTIVE, hqUrl: "https://nbcc.scot/elf/hq", giveUrl: "https://nbcc.scot/donate", ...o });
    await sendElfProud("Sam Example", to(proud({ kind: "graduated" })));
    expect(sentSubject()).toBe("Detective Ruby Tinselfoot has graduated!");
    await sendElfProud("Sam Example", to(proud({ kind: "won", elfName: "Pip", door: 7 })));
    expect(sentSubject()).toBe("You found Pip!");
    expect(sentHtml()).toContain("Detective Ruby Tinselfoot was the first to find Pip on door 7");
    expect(logged().map((r) => r.subject)).toEqual(["A proud moment from Elf Detective School", "A proud moment from Elf Detective School"]);
    expect(JSON.stringify(record.mock.calls)).not.toMatch(A_DETECTIVE);
  });
});

describe("every other elf email in the email log", () => {
  it("logs a subject that names no detective, though the email itself may", async () => {
    await sendElfWelcome("Sam Example", to(buildElfWelcomeEmail({ grownUpName: "Sam Example", detectives: [{ name: DETECTIVE, badge: "EDS 0042" }], hqUrl: "https://nbcc.scot/elf/hq", signInUrl: "https://nbcc.scot/elf/sign-in", firstClueAt: C1 })));
    await sendElfSignInCode("Sam Example", to(buildElfSignInCodeEmail("482915")));
    await sendElfClue(
      "Sam Example",
      to(
        buildElfClueEmail({
          grownUpName: "Sam Example",
          door: 7,
          elfName: "Pip",
          clue: { words: "I am waiting by the pine cones.", pictureAlt: null },
          clue1At: C1,
          clue2At: C1,
          clue3At: C1,
          revealAt: C1,
          hqUrl: "https://nbcc.scot/elf/hq",
          fact: null,
          giveUrl: "https://nbcc.scot/donate",
        }),
      ),
    );
    await sendElfPlaceReminder("Alex Example", to(buildElfPlaceReminderEmail({ contactName: "Alex Example", placeName: "Pine Cone Café", elfName: "Pip", door: 7, clue1At: C1, closesAt: "5pm", phone: "01632 960 123" })));
    await sendElfMorning(
      "Alex Example",
      to(
        buildElfMorningEmail({
          day: new Date("2026-12-08T08:00:00.000Z"),
          today: null,
          yesterday: { door: 7, finders: [{ firstName: "Ruby", surname: "Tinselfoot", approved: true }], foundAt: C1, place: null, state: "found-hidden", snow: false },
          photosWaiting: 0,
          posts: { today: null, yesterday: null },
          pictures: { today: null, yesterday: null },
          adminUrl: "https://nbcc.scot/admin",
        }),
      ),
    );
    await sendElfFindAlert("Alex Example", to(buildElfFindAlertEmail({ door: 7, elfName: "Pip", detectives: ["Ruby Tinselfoot"], grownUpName: "Sam Example", at: C1, placeName: "Pine Cone Café", adminUrl: "https://nbcc.scot/admin" })));
    await sendElfPhotoAlert("Alex Example", to(buildElfPhotoAlertEmail({ door: 7, adminUrl: "https://nbcc.scot/admin" })));
    await sendElfTestAlert("Alex Example", to(buildElfTestAlertEmail({ name: "Alex Example", adminUrl: "https://nbcc.scot/admin" })));
    const rows = logged();
    expect(rows.map((r) => r.kind)).toEqual(["elfWelcome", "elfSignInCode", "elfClue", "elfPlaceReminder", "elfMorning", "elfFindAlert", "elfPhotoAlert", "elfTestAlert"]);
    for (const r of rows) expect(r.subject, r.kind).not.toMatch(A_DETECTIVE);
    // The welcome, the morning email and the find alert do name the detective, in the email itself.
    expect(JSON.stringify(sendSes.mock.calls)).toMatch(A_DETECTIVE);
  });
});
