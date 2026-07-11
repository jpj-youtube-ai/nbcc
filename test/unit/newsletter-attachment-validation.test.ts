import { describe, it, expect } from "vitest";
import { validateAttachment, MAX_ATTACHMENT_BYTES } from "../../src/newsletter/attachment-validation";

describe("newsletter attachment validation", () => {
  it("accepts allowed document/image types within the size cap", () => {
    expect(validateAttachment("application/pdf", 1024)).toEqual({ ok: true });
    expect(validateAttachment("image/png", 1024)).toEqual({ ok: true });
    expect(
      validateAttachment("application/vnd.openxmlformats-officedocument.wordprocessingml.document", 2048),
    ).toEqual({ ok: true });
  });

  it("rejects a disallowed mime type", () => {
    expect(validateAttachment("application/x-msdownload", 1024)).toEqual({ ok: false, reason: "mime" });
    expect(validateAttachment("image/svg+xml", 1024)).toEqual({ ok: false, reason: "mime" });
  });

  it("rejects empty or oversize files", () => {
    expect(validateAttachment("application/pdf", 0)).toEqual({ ok: false, reason: "size" });
    expect(validateAttachment("application/pdf", MAX_ATTACHMENT_BYTES + 1)).toEqual({ ok: false, reason: "size" });
    expect(validateAttachment("application/pdf", MAX_ATTACHMENT_BYTES)).toEqual({ ok: true });
  });
});
