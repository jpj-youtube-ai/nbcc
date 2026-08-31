import { describe, it, expect } from "vitest";
import { buildKindEmail, type EmailKind } from "../../src/email/templates";
import { buildSesSendRequest, sesEndpoint } from "../../src/clients/ses-request";

// The branded transactional templates, ported into the app from the retired email-relay Worker
// (Resend→SES migration). These carry forward the contract the relay's tests guarded: every kind
// gets the branded shell, its OWN correct subject (TASK-209 — the login code must never say
// "Thank you for your donation"), and the charity registration exactly once.

describe("buildKindEmail subjects (TASK-209 contract)", () => {
  const cases: [EmailKind, RegExp][] = [
    ["donation", /thank you for your donation/i],
    ["receipt", /donation receipt/i],
    ["refund", /refund confirmation/i],
    ["loginCode", /sign-in code/i],
    ["adminInvite", /invitation/i],
    ["adminReset", /reset your nbcc admin password/i],
    ["portal", /donor portal link/i],
    ["declaration", /gift aid/i],
    ["lapsedDonor", /monthly donation has stopped/i],
    ["lapsedAdmin", /subscription has lapsed/i],
  ];
  it.each(cases)("%s carries its own subject", (kind, pattern) => {
    const built = buildKindEmail(kind, { fullName: "Ada", code: "123456", link: "https://x", html: "<p>b</p>", text: "b" });
    expect(built.subject).toMatch(pattern);
  });

  it("the login code never falls through to the donation default", () => {
    const built = buildKindEmail("loginCode", { fullName: "Ada", code: "123456" });
    expect(built.subject).not.toMatch(/donation/i);
  });
});

describe("buildKindEmail bodies", () => {
  it("puts the 6-digit code in the code box and the text part", () => {
    const built = buildKindEmail("loginCode", { fullName: "Ada", code: "654321" });
    expect(built.html).toContain("654321");
    expect(built.text).toContain("654321");
    expect(built.text).toContain("expires in 10 minutes");
  });

  it("escapes HTML in user-supplied values", () => {
    const built = buildKindEmail("loginCode", { fullName: "<script>alert(1)</script>", code: "1" });
    expect(built.html).not.toContain("<script>");
    expect(built.html).toContain("&lt;script&gt;");
  });

  it("template-built kinds carry the charity registration in the maroon footer", () => {
    const built = buildKindEmail("portal", { fullName: "Ada", link: "https://nbcc.scot/portal" });
    expect(built.html).toContain("SC047995");
    expect(built.text).toContain("SC047995");
  });

  it("app-built kinds do NOT duplicate the registration (their body already carries it)", () => {
    const built = buildKindEmail("donation", { html: "<p>Thanks — SC047995</p>", text: "Thanks — SC047995" });
    // exactly one occurrence: the app body's own, not a second one from the shell footer
    expect(built.html.split("SC047995").length - 1).toBe(1);
  });

  it("formats donation amounts as GBP in the declaration email", () => {
    const built = buildKindEmail("declaration", {
      declarationLink: "https://nbcc.scot/d/abc",
      shortLink: "https://nbcc.scot/g/abc",
      amountPence: 2500,
      currency: "GBP",
    });
    expect(built.html).toContain("£25.00");
    expect(built.text).toContain("https://nbcc.scot/d/abc");
  });

  it("wraps every kind in the branded shell", () => {
    const built = buildKindEmail("adminInvite", { fullName: "Ada", link: "https://x" });
    expect(built.html).toContain("nbcc-logo.png");
    expect(built.html).toContain("#800000"); // the maroon page
  });
});

// The SESv2 request mapping (src/clients/ses.ts) — pure builder, no config/network.
describe("buildSesSendRequest", () => {
  const base = { to: "donor@example.com", from: "noreply@nbcc.scot", subject: "S", html: "<p>h</p>", text: "t" };

  it("maps the message onto the SESv2 SendEmail shape", () => {
    expect(buildSesSendRequest(base)).toEqual({
      FromEmailAddress: "noreply@nbcc.scot",
      Destination: { ToAddresses: ["donor@example.com"] },
      Content: { Simple: { Subject: { Data: "S" }, Body: { Html: { Data: "<p>h</p>" }, Text: { Data: "t" } } } },
    });
  });

  it("carries replyTo, cc and the configuration set when present", () => {
    const req = buildSesSendRequest({ ...base, replyTo: "newsletter@nbcc.scot", cc: "cc@nbcc.scot", configurationSet: "nl" }) as Record<string, unknown>;
    expect(req.ReplyToAddresses).toEqual(["newsletter@nbcc.scot"]);
    expect((req.Destination as Record<string, unknown>).CcAddresses).toEqual(["cc@nbcc.scot"]);
    expect(req.ConfigurationSetName).toBe("nl");
  });

  it("turns the headers map into the RFC 8058 one-click header list", () => {
    const req = buildSesSendRequest({
      ...base,
      headers: {
        "List-Unsubscribe": "<https://nbcc.scot/unsubscribe/abc>",
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    }) as { Content: { Simple: { Headers: { Name: string; Value: string }[] } } };
    expect(req.Content.Simple.Headers).toEqual([
      { Name: "List-Unsubscribe", Value: "<https://nbcc.scot/unsubscribe/abc>" },
      { Name: "List-Unsubscribe-Post", Value: "List-Unsubscribe=One-Click" },
    ]);
  });

  it("omits optional fields rather than sending them empty", () => {
    const req = buildSesSendRequest(base) as Record<string, unknown>;
    expect("ReplyToAddresses" in req).toBe(false);
    expect("ConfigurationSetName" in req).toBe(false);
    expect("Headers" in (req.Content as { Simple: Record<string, unknown> }).Simple).toBe(false);
  });
});

describe("sesEndpoint", () => {
  it("targets the regional SESv2 outbound-emails endpoint", () => {
    expect(sesEndpoint("eu-west-1")).toBe("https://email.eu-west-1.amazonaws.com/v2/email/outbound-emails");
  });
});
