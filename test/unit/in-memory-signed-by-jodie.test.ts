import { describe, it, expect } from "vitest";
import { MEMORY_EMAIL, MEMORY_SIGNER, buildSignInCodeEmail } from "../../src/fundraising/emails";
import { buildInMemoryApprovedEmail } from "../../src/fundraising/memory-emails";
import { buildMemoryReceiptEmail } from "../../src/fundraising/signup-tidy-emails";
import { buildSupporterThanksEmail } from "../../src/fundraising/thanks-email";
import { buildInviteEmail } from "../../src/fundraising/team-emails";
import { inviteSchema, memoryInviteCc } from "../../src/fundraising/invite";

// The charity, after the readthrough (2026-10-04): every email sent from "Jodie at NBCC" is signed
// by her: "With warmest thoughts," then "Jodie" then "NBCC Team", laid out as the staff invite lays
// out a named signer. In memory emails only. The in memory invite is always signed Jodie, whoever
// was chosen under "Signed by", and it copies in Jodie and nobody else. Every name is invented.

const BASE = "https://nbcc.test";
const TEXT = "With warmest thoughts,\nJodie\nNBCC Team";
const HTML = /With warmest thoughts,<br>Jodie<br><span style="[^"]*">NBCC Team<\/span><\/p>/;

type Built = { subject: string; html: string; text: string };
const invite = (type: "memory" | "raising" | "team" | "event", signer = "Robin") =>
  buildInviteEmail({ firstName: "Mary", note: null, signer, url: `${BASE}/fundraise?invite=example`, type });

describe("the one place the name lives", () => {
  it("is Jodie", () => expect(MEMORY_SIGNER).toBe("Jodie"));
});

const MEMORY_MAILS: Array<[string, Built]> = [
  ["the in memory invite", invite("memory")],
  ["the note after an in memory sign up", buildMemoryReceiptEmail("Sam Example")],
  ["your page in memory (family)", buildInMemoryApprovedEmail({ name: "Sam Example", firstName: "Sam", memoryName: "Mary Example", setupBy: "family" }, { pageUrl: `${BASE}/fundraise/x` })],
  ["your page in memory (funeral director)", buildInMemoryApprovedEmail({ name: "The Example Funeral Directors", memoryName: "Mary Example", setupBy: "funeral_director" }, { pageUrl: `${BASE}/fundraise/x` })],
  ["the giver's thank you, in memory", buildSupporterThanksEmail({ organiserName: "Sam Example", title: "In memory of Mary Example", message: "Thank you.", inMemory: true, giverName: "Alex Example", baseUrl: "https://nbcc.test" })],
  ["the gentle sign in code", buildSignInCodeEmail("Sam Example", "123456", { gentle: true })],
];

describe.each(MEMORY_MAILS)("%s", (_what, mail) => {
  it("is signed by Jodie in the plain text part", () => {
    expect(mail.text).toContain(TEXT);
    expect(mail.text.split("With warmest thoughts,").length - 1).toBe(1);
  });

  it("is signed by Jodie in the HTML, her name above NBCC Team", () => {
    expect(mail.html).toMatch(HTML);
  });
});

describe("the in memory invite", () => {
  it("is signed Jodie whoever was chosen under Signed by", () => {
    for (const signer of ["Robin", "Fern", ""]) {
      const mail = invite("memory", signer);
      expect(mail.text).toContain(TEXT);
      if (signer) expect(mail.html + mail.text).not.toContain(signer);
    }
  });
});

describe("emails that are not in memory", () => {
  it.each(["raising", "team", "event"] as const)("the %s invite is still signed by whoever was chosen", (type) => {
    const mail = invite(type);
    expect(mail.text).toContain("Warmest wishes,\nRobin\nNBCC Team");
    expect(mail.html + mail.text).not.toContain("Jodie");
  });

  it("the giver's thank you and the sign in code are signed as they were, with no name", () => {
    expect(buildSupporterThanksEmail({ organiserName: "Sam Example", title: "Sam's Santa Dash", message: "Thank you!", baseUrl: "https://nbcc.test" }).text).toContain("Thanks so much,\nNBCC Team");
    expect(buildSignInCodeEmail("Sam Example", "123456").text).toContain("Happy fundraising!\nNBCC Team");
  });
});

describe("who an in memory invite copies in", () => {
  it("is Jodie, and nobody else", () => {
    expect(memoryInviteCc("mary@example.com")).toBe(MEMORY_EMAIL);
  });

  it("is nobody when Jodie herself is the person invited", () => {
    expect(memoryInviteCc(" Jodie@NBCC.scot ")).toBeNull();
  });
});

describe("what the invite form must send", () => {
  const ok = { firstName: "Mary", lastName: "Smith", email: "mary@example.com" };

  it("needs no Signed by for an in memory invite, and ignores one that is sent", () => {
    const none = inviteSchema.safeParse({ ...ok, type: "memory" });
    expect(none.success).toBe(true);
    if (none.success) expect(none.data.signedBy).toBeNull();
    for (const signedBy of [5, 0, "x", null]) {
      const sent = inviteSchema.safeParse({ ...ok, type: "memory", signedBy });
      expect(sent.success).toBe(true);
      if (sent.success) expect(sent.data.signedBy).toBeNull();
    }
  });

  it.each(["raising", "team", "event", null, undefined] as const)("still needs one for %s", (type) => {
    const missing = inviteSchema.safeParse({ ...ok, ...(type === undefined ? {} : { type }) });
    expect(missing.success).toBe(false);
    // The same refusal as before the in memory change: the issue is on signedBy, worded as it was.
    if (!missing.success) expect(missing.error.issues.find((i) => i.path[0] === "signedBy")?.message).toBe("Required");
    expect(inviteSchema.safeParse({ ...ok, type, signedBy: 0 }).success).toBe(false);
    expect(inviteSchema.safeParse({ ...ok, type, signedBy: "3" }).success).toBe(false);
    const good = inviteSchema.safeParse({ ...ok, type, signedBy: 3 });
    expect(good.success).toBe(true);
    if (good.success) expect(good.data.signedBy).toBe(3);
  });
});
