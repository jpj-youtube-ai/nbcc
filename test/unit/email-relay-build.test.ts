import { describe, it, expect } from "vitest";
// The email-relay Worker maps the app's payload shapes to Resend sends. This guards the app↔relay
// contract for the newsletter (TASK-162): the bug was that sendNewsletter's payload was not
// recognised by the relay (recipient in `to`, no discriminator), so every send 422'd and no email
// left. buildEmail is a pure mapper, so we can exercise it directly.
import { buildEmail } from "../../services/email-relay/src/index.js";

describe("email-relay buildEmail — newsletter payload", () => {
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

describe("email-relay buildEmail — thank-you payload (REQ-069 · TASK-163)", () => {
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
});
