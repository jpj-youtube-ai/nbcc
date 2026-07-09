import { describe, it, expect } from "vitest";
import { buildGmailReplyUrl } from "../../assets/js/gmail-reply.js";

const enquiry = {
  email: "ada@example.com",
  first_name: "Ada",
  last_name: "Lovelace",
  message: "Do you take item donations?",
  created_at: "2026-07-10T14:32:00.000Z",
};

describe("buildGmailReplyUrl", () => {
  const url = buildGmailReplyUrl(enquiry);

  it("targets Gmail web compose", () => {
    expect(url.startsWith("https://mail.google.com/mail/?view=cm&fs=1")).toBe(true);
  });

  it("addresses the sender", () => {
    expect(url).toContain("to=" + encodeURIComponent("ada@example.com"));
  });

  it("uses the fixed subject", () => {
    expect(url).toContain("su=" + encodeURIComponent("Re: your message to NBCC"));
  });

  it("quotes the original message and submission time in the body", () => {
    const body = decodeURIComponent(url.split("body=")[1]);
    expect(body).toContain("Do you take item donations?");
    expect(body).toContain("Ada Lovelace");
    expect(body).toContain("ada@example.com");
    expect(body).toMatch(/Received:/);
  });
});
