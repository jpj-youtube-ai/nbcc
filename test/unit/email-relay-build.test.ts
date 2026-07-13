import { describe, it, expect } from "vitest";
// The email-relay Worker maps the app's payload shapes to Resend sends. This guards the app↔relay
// contract for the newsletter (TASK-162): the bug was that sendNewsletter's payload was not
// recognised by the relay (recipient in `to`, no discriminator), so every send 422'd and no email
// left. buildEmail is a pure mapper, so we can exercise it directly.
import { buildEmail } from "../../services/email-relay/src/index.js";

describe("email-relay buildEmail:newsletter payload", () => {
  const payload = {
    newsletter: true,
    email: "donor@example.com",
    from: "newsletter@nbcc.scot",
    replyTo: "newsletter@nbcc.scot",
    subject: "Winter update",
    html: "<p>Hello</p>",
  };

  it("recognises a newsletter payload (recipient from `email`)", () => {
    const built = buildEmail(payload);
    expect(built).not.toBeNull();
    expect(built.to).toBe("donor@example.com");
  });

  it("uses the newsletter's OWN subject, not the donation-confirmation default", () => {
    const built = buildEmail(payload);
    expect(built.subject).toBe("Winter update");
    expect(built.subject).not.toMatch(/donation/i);
  });

  it("passes through the per-message from and replyTo so the send is repliable", () => {
    const built = buildEmail(payload);
    expect(built.from).toBe("newsletter@nbcc.scot");
    expect(built.replyTo).toBe("newsletter@nbcc.scot");
    expect(built.html).toBe("<p>Hello</p>");
  });

  it("does not misclassify a donation confirmation as a newsletter", () => {
    // A donation-confirmation payload (no `newsletter` flag) must still hit the default branch.
    const built = buildEmail({ email: "d@example.com", fullName: "Ada", amountPence: 2500, currency: "GBP", html: "<p>Thanks</p>", text: "Thanks" });
    expect(built.subject).toMatch(/donation/i);
  });
});

describe("email-relay buildEmail:thank-you payload (REQ-069 · TASK-163)", () => {
  const payload = {
    thankYou: true,
    email: "margaret@example.com",
    from: "newsletter@nbcc.scot",
    replyTo: "newsletter@nbcc.scot",
    subject: "Thank you, Margaret",
    html: "<h1>Thank you, Margaret.</h1>",
  };

  it("recognises a thank-you payload and keeps its own subject, from and reply-to", () => {
    const built = buildEmail(payload);
    expect(built).not.toBeNull();
    expect(built.to).toBe("margaret@example.com");
    expect(built.subject).toBe("Thank you, Margaret");
    expect(built.subject).not.toMatch(/donation/i);
    expect(built.from).toBe("newsletter@nbcc.scot");
    expect(built.replyTo).toBe("newsletter@nbcc.scot");
    expect(built.html).toBe("<h1>Thank you, Margaret.</h1>");
  });

  it("forwards an optional CC when present, and omits it otherwise (TASK-168)", () => {
    expect(buildEmail(payload).cc).toBeUndefined();
    const withCc = buildEmail({ ...payload, cc: "colleague@nbcc.scot" });
    expect(withCc.cc).toBe("colleague@nbcc.scot");
  });
});

// TASK-209: every transactional email is now routed by an explicit `kind`, wrapped in ONE branded
// shell (modelled on the thank-you letter email), and given its OWN correct subject. These guards
// pin: (a) the kind→subject map; (b) the branded shell (logo + cream panel + light color-scheme);
// (c) the maroon footer bar carrying the phone number + giving@ on EVERY kind; (d) the charity
// registration appearing exactly once (never duplicated); (e) the old collisions being gone
// (2FA login-code no longer the donation default; portal / invite / reset all distinct).
describe("email-relay buildEmail:TASK-209 branded shell + correct subject per kind", () => {
  const LOGO = "https://nbcc.scot/assets/img/nbcc-logo.png";
  // A fragment shared by both the canonical (app body) and letter.ts (relay footer) wordings, so
  // one count works for every kind. Exactly one occurrence per email means no duplicate registration.
  const REG_FRAGMENT = "known as NBCC, is a Scottish Charitable Incorporated Organisation";
  // The app-built kinds ship their own body ending with the canonical registration line.
  const REG_HTML =
    '<p class="charity-registration">Night Before Christmas Campaign, known as NBCC, is a Scottish Charitable Incorporated Organisation.<br />Scottish Charity Number SC047995. Regulated by the Scottish Charity Regulator, OSCR.</p>';
  const REG_TEXT =
    "Night Before Christmas Campaign, known as NBCC, is a Scottish Charitable Incorporated Organisation.\nScottish Charity Number SC047995. Regulated by the Scottish Charity Regulator, OSCR.";
  const count = (hay: string, needle: string) => hay.split(needle).length - 1;

  // Sample payloads mirror exactly what src/clients/email.ts posts for each kind.
  const cases = [
    { name: "donation", builtBy: "app", subject: "Thank you for your donation to NBCC",
      payload: { kind: "donation", email: "d@x.com", fullName: "Ada", amountPence: 2500, currency: "GBP",
        html: `<section class="donation-confirmation"><p>Thank you Ada.</p>${REG_HTML}</section>`, text: `Thank you Ada.\n\n${REG_TEXT}\n` } },
    { name: "receipt", builtBy: "app", subject: "Your NBCC donation receipt",
      payload: { kind: "receipt", email: "c@x.com", legalName: "Acme Ltd", amountPence: 10000, currency: "GBP",
        html: `<section class="ct-receipt"><p>Receipt.</p>${REG_HTML}</section>`, text: `Receipt.\n\n${REG_TEXT}\n` } },
    { name: "refund", builtBy: "app", subject: "Your NBCC refund confirmation",
      payload: { kind: "refund", email: "d@x.com", fullName: "Ada", refundedPence: 2500, currency: "GBP",
        html: `<section class="refund-confirmation"><p>Refunded.</p>${REG_HTML}</section>`, text: `Refunded.\n\n${REG_TEXT}\n` } },
    { name: "loginCode", builtBy: "relay", subject: "Your NBCC admin sign-in code",
      payload: { kind: "loginCode", email: "admin@x.com", fullName: "Sam", code: "123456", subject: "ignored", text: "ignored" } },
    { name: "adminInvite", builtBy: "relay", subject: "Your NBCC admin account invitation",
      payload: { kind: "adminInvite", email: "admin@x.com", fullName: "Sam", link: "https://nbcc.scot/invite?token=abc" } },
    { name: "adminReset", builtBy: "relay", subject: "Reset your NBCC admin password",
      payload: { kind: "adminReset", email: "admin@x.com", fullName: "Sam", link: "https://nbcc.scot/reset?token=abc" } },
    { name: "portal", builtBy: "relay", subject: "Your NBCC donor portal link",
      payload: { kind: "portal", email: "d@x.com", fullName: "Ada", link: "https://nbcc.scot/portal?token=abc" } },
    { name: "declaration", builtBy: "relay", subject: "Add Gift Aid to your NBCC donation",
      payload: { kind: "declaration", email: "d@x.com", declarationLink: "https://nbcc.scot/gift-aid/declare?token=abc", shortLink: "https://nbcc.scot/g/abc", amountPence: 2500, currency: "GBP" } },
    { name: "lapsedDonor", builtBy: "relay", subject: "Your NBCC monthly donation has stopped",
      payload: { kind: "lapsedDonor", email: "d@x.com", fullName: "Ada", subscriptionId: "sub_123" } },
    { name: "lapsedAdmin", builtBy: "relay", subject: "A monthly NBCC subscription has lapsed",
      payload: { kind: "lapsedAdmin", email: "admin@x.com", donorName: "Ada", subscriptionId: "sub_123" } },
  ] as const;

  for (const c of cases) {
    describe(`kind: ${c.name}`, () => {
      const built = buildEmail(c.payload);
      it("is recognised and routed to its correct subject", () => {
        expect(built).not.toBeNull();
        expect(built.to).toBe(c.payload.email);
        expect(built.subject).toBe(c.subject);
      });
      it("wraps the body in the branded shell (logo + cream panel + light color-scheme)", () => {
        expect(built.html).toContain(`<img src="${LOGO}"`);
        expect(built.html).toContain("background:#F8F5EE"); // cream content panel
        expect(built.html).toContain('name="color-scheme" content="light"');
      });
      it("carries the maroon footer bar with the phone number and giving@ address", () => {
        expect(built.html).toContain("background:#800000;color:#F8F5EE"); // the maroon footer bar
        expect(built.html).toContain("01292 811 015");
        expect(built.html).toContain('href="tel:+441292811015"');
        expect(built.html).toContain("giving@nbcc.scot");
        expect(built.html).toContain('href="mailto:giving@nbcc.scot"');
        // the plain-text part carries the same contacts.
        expect(built.text).toContain("01292 811 015");
        expect(built.text).toContain("giving@nbcc.scot");
      });
      it("shows the charity registration exactly once (never duplicated)", () => {
        expect(count(built.html, REG_FRAGMENT)).toBe(1);
        expect(count(built.text, REG_FRAGMENT)).toBe(1);
      });
    });
  }

  it("puts the registration in the maroon footer for relay-built kinds, and omits it from the footer for app-built kinds", () => {
    const relay = buildEmail({ kind: "loginCode", email: "admin@x.com", fullName: "Sam", code: "123456" });
    // relay-built: the maroon footer carries the registration (letter.ts wording).
    expect(relay.html).toContain("Scottish Charity Number SC047995, regulated by OSCR.");
    const app = buildEmail(cases.find((c) => c.name === "donation")!.payload);
    // app-built: registration lives in the app body (canonical wording); the footer stays contacts-only,
    // so the letter.ts footer wording is NOT added on top of the app body.
    expect(app.html).toContain('class="charity-registration"');
    expect(app.html).not.toContain("Scottish Charity Number SC047995, regulated by OSCR.");
  });

  it("gives the 2FA login code its OWN subject + body, not the donation default (old collision gone)", () => {
    const built = buildEmail({ kind: "loginCode", email: "admin@x.com", fullName: "Sam", code: "654321" });
    expect(built.subject).toBe("Your NBCC admin sign-in code");
    expect(built.subject).not.toMatch(/donation/i);
    expect(built.subject).not.toContain("654321"); // the code rides in the body, never the subject
    expect(built.html).toContain("654321");
  });

  it("gives loginCode, adminInvite, adminReset and portal four DISTINCT subjects (old link/2FA collisions gone)", () => {
    const subj = (payload: Record<string, unknown>) => buildEmail(payload).subject;
    const subjects = [
      subj({ kind: "loginCode", email: "a@x.com", fullName: "S", code: "111111" }),
      subj({ kind: "adminInvite", email: "a@x.com", fullName: "S", link: "https://nbcc.scot/i" }),
      subj({ kind: "adminReset", email: "a@x.com", fullName: "S", link: "https://nbcc.scot/r" }),
      subj({ kind: "portal", email: "a@x.com", fullName: "S", link: "https://nbcc.scot/p" }),
    ];
    expect(new Set(subjects).size).toBe(4);
  });
});

// TASK-209: the legacy field heuristics are kept ONLY as a deploy-skew net, so a payload that arrives
// WITHOUT a `kind` (an older app talking to a newer Worker, or vice versa) still delivers rather than
// 422-ing. These confirm the fallback still routes.
describe("email-relay buildEmail:TASK-209 deploy-skew fallback (no `kind`)", () => {
  it("still routes a no-kind link payload via the legacy heuristics", () => {
    const built = buildEmail({ email: "d@x.com", fullName: "Ada", link: "https://nbcc.scot/portal?token=abc" });
    expect(built).not.toBeNull();
    expect(built.subject).toBe("Your NBCC donor portal access link");
  });

  it("still routes a no-kind donation payload to the donation default", () => {
    const built = buildEmail({ email: "d@x.com", fullName: "Ada", amountPence: 2500, currency: "GBP", html: "<p>Thanks</p>", text: "Thanks" });
    expect(built.subject).toBe("Thank you for your donation to NBCC");
  });
});
