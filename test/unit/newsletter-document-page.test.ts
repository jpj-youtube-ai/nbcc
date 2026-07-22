import { describe, expect, it } from "vitest";
import { buildDocumentPage, buildDocumentNotFoundPage } from "../../src/newsletter/document-page";

const PDF = { id: "11111111-2222-4333-8444-555555555555", filename: "certificate.pdf", mime: "application/pdf" };

describe("newsletter document page", () => {
  it("renders a PDF viewer page with an inline preview and print/download actions", () => {
    const html = buildDocumentPage(PDF);
    // Inline preview embeds the file route.
    expect(html).toContain(`/newsletter/document/${PDF.id}/file`);
    expect(html).toMatch(/<iframe|<object/);
    // Both actions link to the file route; download carries the ?download=1 switch.
    expect(html).toContain(`/newsletter/document/${PDF.id}/file?download=1`);
    expect(html.toLowerCase()).toContain("download");
    expect(html.toLowerCase()).toContain("print");
    // The filename is shown.
    expect(html).toContain("certificate.pdf");
    // Not indexable: these are capability URLs from an email.
    expect(html).toContain("noindex");
  });

  it("renders images with an <img> preview, not an iframe", () => {
    const html = buildDocumentPage({ ...PDF, filename: "photo.png", mime: "image/png" });
    expect(html).toContain("<img");
    expect(html).not.toContain("<iframe");
  });

  it("renders no inline preview for types the browser will not display (e.g. Word)", () => {
    const html = buildDocumentPage({
      ...PDF,
      filename: "letter.docx",
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("<img");
    // Actions still present.
    expect(html).toContain(`/newsletter/document/${PDF.id}/file?download=1`);
  });

  it("escapes the filename", () => {
    const html = buildDocumentPage({ ...PDF, filename: '<script>alert(1)</script>.pdf' });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("builds a branded not-found page", () => {
    const html = buildDocumentNotFoundPage();
    expect(html.toLowerCase()).toContain("could not be found");
    expect(html).toContain("NBCC");
  });
});
