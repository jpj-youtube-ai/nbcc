import { describe, it, expect } from "vitest";
import { contactEnquirySchema, CONTACT_MESSAGE_MAX } from "../../src/contact/schema";

const valid = { firstName: "Ada", lastName: "Lovelace", email: "ada@example.com", message: "Hello" };

describe("contactEnquirySchema", () => {
  it("accepts a valid enquiry", () => {
    expect(contactEnquirySchema.parse(valid)).toEqual(valid);
  });

  it("defaults a missing lastName to empty string", () => {
    const { lastName, ...noLast } = valid;
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
