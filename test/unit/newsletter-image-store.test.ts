import { describe, it, expect } from "vitest";
import { validateUpload, MAX_IMAGE_BYTES } from "../../src/newsletter/image-validation";

describe("validateUpload", () => {
  it("accepts an allowed mime within the size cap", () => {
    expect(validateUpload("image/png", 1024)).toEqual({ ok: true });
  });
  it("rejects a disallowed mime (e.g. svg)", () => {
    expect(validateUpload("image/svg+xml", 1024)).toEqual({ ok: false, reason: "mime" });
  });
  it("rejects an over-cap payload", () => {
    expect(validateUpload("image/jpeg", MAX_IMAGE_BYTES + 1)).toEqual({ ok: false, reason: "size" });
  });
});
