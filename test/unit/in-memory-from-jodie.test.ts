import { describe, it, expect, vi } from "vitest";

// The readthrough (2026-10-04): every email on the in memory path that goes to a family, a funeral
// director or a giver comes from Jodie, because "events@" is the wrong note for a family arranging
// a funeral. This file checks the contact SHOWN in those emails (the "Got any questions?" box where
// there is one, and the address in the footer bar); the From and Reply-To they are sent with are in
// test/unit/in-memory-from-jodie-send.test.ts. Every name and address here is invented.

vi.mock("../../src/config", () => ({
  config: {
    NODE_ENV: "development",
    DATABASE_URL: "postgres://localhost:5432/test",
    ADMIN_SESSION_SECRET: "test-admin-secret",
    STRIPE_SECRET_KEY: "sk_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    STRIPE_WEBHOOK_SECRET: "whsec_placeholder",
    PORTAL_BASE_URL: "https://nbcc.test",
    BALL_BASE_URL: "https://nbcc.test",
    BALL_FROM_EMAIL: "events@nbcc.test",
  },
}));
vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));

import { CATALOGUE, type CatalogueEmail, type CatalogueVersion } from "../../src/email/catalogue";
import { FUNDRAISING_EMAIL, MEMORY_EMAIL, MEMORY_FROM, MEMORY_FROM_NAME, buildSignInCodeEmail } from "../../src/fundraising/emails";
import { buildInMemoryApprovedEmail } from "../../src/fundraising/memory-emails";
import { buildMemoryReceiptEmail, buildTshirtAskEmail } from "../../src/fundraising/signup-tidy-emails";
import { buildSupporterThanksEmail } from "../../src/fundraising/thanks-email";
import { buildInviteEmail } from "../../src/fundraising/team-emails";

const BASE = "https://nbcc.test";
const PHONE = "01292 811 015";

describe("the one place the address lives", () => {
  it("is Jodie's mailbox, with her name on the From line", () => {
    expect(MEMORY_EMAIL).toBe("jodie@nbcc.scot");
    expect(MEMORY_FROM_NAME).toBe("Jodie at NBCC");
    expect(MEMORY_FROM).toBe("Jodie at NBCC <jodie@nbcc.scot>");
  });

  it("leaves the events inbox as it was for everything else", () => {
    expect(FUNDRAISING_EMAIL).toBe("events@nbcc.scot");
  });
});

type Built = { subject: string; html: string; text: string };
const invite = (note: string | null) => buildInviteEmail({ firstName: "Mary", note, signer: "Robin", url: `${BASE}/fundraise?invite=example`, type: "memory" });
const thanks = { organiserName: "Sam Example", title: "In memory of Mary Example", message: "Thank you for remembering her with us." };

// Each in memory email, and whether it has a "Got any questions?" box.
const MEMORY_MAILS: Array<[string, Built, boolean]> = [
  ["the in memory invite", invite("It was good to talk on Tuesday."), false],
  ["the in memory invite with no note", invite(null), false],
  ["the note after an in memory sign up", buildMemoryReceiptEmail("Sam Example"), true],
  ["your page in memory (family)", buildInMemoryApprovedEmail({ name: "Sam Example", firstName: "Sam", memoryName: "Mary Example", setupBy: "family" }, { pageUrl: `${BASE}/fundraise/x` }), true],
  [
    "your page in memory (funeral director)",
    buildInMemoryApprovedEmail({ name: "The Example Funeral Directors", firstName: null, memoryName: "Mary Example", setupBy: "funeral_director" }, { pageUrl: `${BASE}/fundraise/x` }),
    true,
  ],
  ["the giver's thank you, in memory", buildSupporterThanksEmail({ ...thanks, inMemory: true, giverName: "Alex Example" }), true],
  ["the gentle sign in code", buildSignInCodeEmail("Sam Example", "123456", { gentle: true }), true],
];

describe.each(MEMORY_MAILS)("%s", (_what, mail, hasBox) => {
  it("never says events@, in the HTML or the plain text", () => {
    expect(mail.html).not.toContain("events@");
    expect(mail.text).not.toContain("events@");
    expect(mail.subject).not.toContain("events@");
  });

  it("shows Jodie's address in the footer bar", () => {
    const footer = mail.html.slice(mail.html.lastIndexOf('<tr><td style="background:#800000'));
    expect(footer).toContain('<a href="mailto:jodie@nbcc.scot"');
    expect(footer).toContain(">jodie@nbcc.scot</a>");
  });

  it("keeps the phone number", () => {
    expect(mail.html).toContain(PHONE);
  });

  it(hasBox ? "shows Jodie's address in the questions box, in both parts" : "has no questions box", () => {
    if (hasBox) {
      expect(mail.html).toContain("Got any questions?");
      // Twice: the questions box and the footer bar.
      expect(mail.html.split("mailto:jodie@nbcc.scot").length - 1).toBe(2);
      expect(mail.text).toContain(`Call us: ${PHONE}\nEmail us: jodie@nbcc.scot`);
    } else {
      expect(mail.html).not.toContain("Got any questions?");
      expect(mail.html.split("mailto:jodie@nbcc.scot").length - 1).toBe(1);
    }
  });
});

describe("the in memory invite", () => {
  it("still signs off with the first name of whoever sent it, though it comes from Jodie's address", () => {
    expect(invite(null).text).toContain("With warmest thoughts,\nRobin\nNBCC Team");
    expect(invite(null).html).toContain("With warmest thoughts,<br>Robin<br>");
  });
});

// The same builders, for anyone not on the in memory path: nothing about them moves.
describe("emails that are not in memory", () => {
  const others: Array<[string, Built]> = [
    ["the invite to raise money", buildInviteEmail({ firstName: "Mary", note: null, signer: "Robin", url: `${BASE}/fundraise?invite=example`, type: "raising" })],
    ["the invite to host an event", buildInviteEmail({ firstName: "Mary", note: null, signer: "Robin", url: `${BASE}/fundraise?invite=example`, type: "event" })],
    ["the invite to set up a team", buildInviteEmail({ firstName: "Mary", note: null, signer: "Robin", url: `${BASE}/fundraise?invite=example`, type: "team" })],
    ["the giver's thank you", buildSupporterThanksEmail({ organiserName: "Sam Example", title: "Sam's Santa Dash", message: "Thank you!" })],
    ["the sign in code", buildSignInCodeEmail("Sam Example", "123456")],
    ["the T-shirt size email", buildTshirtAskEmail("Sam", `${BASE}/fundraise/tshirt?t=example`)],
  ];

  it.each(others)("%s still shows the events inbox, and never Jodie's address", (_what, mail) => {
    expect(mail.html).toContain("mailto:events@nbcc.scot");
    expect(mail.html + mail.text).not.toContain("jodie@");
  });
});

// The catalogue is what an admin reads in All emails: the In memory group and every in memory
// version elsewhere show the new contact, and no other email does.
describe("All emails", () => {
  const isMemoryVersion = (e: CatalogueEmail, x: CatalogueVersion): boolean =>
    e.group === "memory" || e.id === "invite-memory" || ((e.id === "sign-in-code" || e.id === "supporter-thanks") && x.id.startsWith("in-memory"));
  const all = CATALOGUE.flatMap((e) => e.versions.map((x) => ({ e, x })));
  const memory = all.filter(({ e, x }) => isMemoryVersion(e, x));
  const rest = all.filter(({ e, x }) => !isMemoryVersion(e, x));

  it("finds every in memory version: the group's three emails, the invite, the gentle code and the giver's thank you", () => {
    expect(memory.map(({ e, x }) => `${e.id}/${x.id}`).sort()).toEqual(
      [
        "invite-memory/no-note",
        "invite-memory/usual",
        "memory-live-director/business",
        "memory-live-director/usual",
        "memory-live/group",
        "memory-live/usual",
        "memory-signup/no-name",
        "memory-signup/usual",
        "sign-in-code/in-memory",
        "sign-in-code/in-memory-no-name",
        "supporter-thanks/in-memory",
        "supporter-thanks/in-memory-no-name",
      ].sort(),
    );
  });

  it.each(memory.map(({ e, x }) => [`${e.id}/${x.id}`, x] as const))("%s shows Jodie's address and never events@", (_id, x) => {
    const { html } = x.render(BASE);
    expect(html).toContain("mailto:jodie@nbcc.scot");
    expect(html).not.toContain("events@");
    expect(html).toContain(PHONE);
  });

  it("no other email shows Jodie's address", () => {
    for (const { e, x } of rest) {
      expect(`${e.id}/${x.id}: ${x.render(BASE).html.includes("jodie@")}`).toBe(`${e.id}/${x.id}: false`);
    }
  });
});
