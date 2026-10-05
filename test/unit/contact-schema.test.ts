import { describe, it, expect } from "vitest";
import { contactEnquirySchema, CONTACT_MESSAGE_MAX } from "../../src/contact/schema";

const valid = { firstName: "Ada", lastName: "Lovelace", email: "ada@example.com", message: "Hello" };

describe("contactEnquirySchema", () => {
  it("accepts a valid enquiry", () => {
    expect(contactEnquirySchema.parse(valid)).toEqual({ ...valid, phone: "" });
  });

  it("defaults a missing lastName to empty string", () => {
    const noLast = { ...valid };
    delete (noLast as Partial<typeof valid>).lastName;
    expect(contactEnquirySchema.parse(noLast).lastName).toBe("");
  });

  it("rejects an empty firstName", () => {
    expect(contactEnquirySchema.safeParse({ ...valid, firstName: "" }).success).toBe(false);
  });

  it("rejects an invalid email", () => {
    expect(contactEnquirySchema.safeParse({ ...valid, email: "nope" }).success).toBe(false);
  });

  it("rejects an empty message", () => {
    expect(contactEnquirySchema.safeParse({ ...valid, message: "" }).success).toBe(false);
  });

  it("rejects a message longer than the cap", () => {
    const long = "x".repeat(CONTACT_MESSAGE_MAX + 1);
    expect(contactEnquirySchema.safeParse({ ...valid, message: long }).success).toBe(false);
  });
});

describe("the optional phone number", () => {
  it("is empty when none is sent", () => {
    expect(contactEnquirySchema.parse(valid).phone).toBe("");
  });

  it("is empty when the box was left blank", () => {
    expect(contactEnquirySchema.parse({ ...valid, phone: "   " }).phone).toBe("");
  });

  it.each(["07700 900123", "+44 (0)1292 811 015", "01292-811015"])("keeps %s as typed, trimmed", (phone) => {
    expect(contactEnquirySchema.parse({ ...valid, phone: "  " + phone + " " }).phone).toBe(phone);
  });

  it.each(["call me", "12345", "07700 900123 ext four", "0".repeat(41)])("refuses %s", (phone) => {
    expect(contactEnquirySchema.safeParse({ ...valid, phone }).success).toBe(false);
  });
});
