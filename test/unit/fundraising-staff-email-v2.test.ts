import { describe, it, expect } from "vitest";
import { buildSignUpStaffEmail, type StaffSummary } from "../../src/fundraising/emails";

// TASK-511: the email to the events inbox about a new sign up carries every new answer: the name in
// two parts, what Something else is, Instagram and Facebook on their own lines, printed QR codes,
// and a shout out asked for without permission to post, said plainly. Every name is invented.

const base: StaffSummary = {
  id: 51,
  path: "raising",
  kind: "other",
  kindOther: "A sponsored silence",
  title: "Robin's Silent Day",
  description: "Not a word for 24 hours.",
  eventDate: "2026-12-05",
  startTime: null,
  venue: "",
  town: "Exampleton",
  targetPence: 20000,
  public: false,
  firstName: "Robin",
  lastName: "Quill",
  name: "Robin Quill",
  email: "robin.quill@example.com",
  phone: "07700 900123",
  instagram: "https://www.instagram.com/robin.quiet",
  facebook: null,
  socialLink: "https://www.instagram.com/robin.quiet",
  socialOk: false,
  wants: { posterCount: 2, leafletCount: 0, bucketCount: 0, tinCount: 0, leaflets: 0, buckets: 0, qrCount: 40, shoutOut: true, attend: false },
  postLine1: "1 Example Road",
  postLine2: null,
  postTown: "Exampleton",
  postPostcode: "EX1 1EX",
  newsletterOk: false,
  cardLine: null,
  endTime: null,
  timeTbc: false,
  venueAddress: null,
  venuePostcode: null,
  access: [],
  price: null,
  booking: null,
  ticketUrl: null,
  ageLimit: null,
  dressCode: null,
  included: null,
  creditName: null,
};

const mail = buildSignUpStaffEmail(base, { adminUrl: "https://nbcc.scot/admin" });

describe("the email to the events inbox, round two", () => {
  it("says what Something else is, in their words", () => {
    expect(mail.text).toContain("Kind: Something else: A sponsored silence");
  });

  it("gives the first name and the surname", () => {
    expect(mail.text).toContain("First name: Robin");
    expect(mail.text).toContain("Surname: Quill");
  });

  it("gives Instagram and Facebook a line each", () => {
    expect(mail.text).toContain("Instagram: https://www.instagram.com/robin.quiet");
    expect(mail.text).toContain("Facebook: Not given");
    expect(mail.text).not.toContain("Facebook or Instagram");
  });

  it("counts the printed QR codes with the other things to post", () => {
    expect(mail.text).toContain("Printed QR codes: 40");
  });

  it("says plainly when a shout out is asked for without permission to post", () => {
    expect(mail.text).toContain("We can post about it: No");
    expect(mail.text).toContain("A social media shout out: Yes please, but they have not said we can post about it, so ask them first");
  });

  it("says the website it means is ours", () => {
    expect(mail.text).toContain("On the NBCC website: No, not to be shown on the website");
  });

  it("still reads a sign up from before, with its one social link", () => {
    const old = buildSignUpStaffEmail(
      { ...base, firstName: undefined, lastName: undefined, instagram: undefined, facebook: undefined, kind: "santa_dash", kindOther: null, socialLink: "https://www.facebook.com/old.page" },
      { adminUrl: "https://nbcc.scot/admin" },
    );
    expect(old.text).toContain("Facebook or Instagram: https://www.facebook.com/old.page");
    expect(old.text).not.toContain("First name:");
    expect(old.text).toContain("Kind: A Santa dash");
  });
});
