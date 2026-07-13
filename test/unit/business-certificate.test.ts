import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-211: the per-business Platinum certificate route + its pure helpers. The DB read
// (getCertificateContextByToken) is mocked so the route logic — the platinum + opt-in gate and the
// render — is exercised DB-free; the real certificate module runs (it inlines the committed brand
// assets), so this also proves the page renders end to end.

const { getCtxMock } = vi.hoisted(() => ({ getCtxMock: vi.fn() }));
vi.mock("../../src/db/fulfilment", () => ({ getCertificateContextByToken: getCtxMock }));

import { getCertificate } from "../../src/routes/business";
import { formatMonthYear, certificateHeroName, renderCertificate } from "../../src/business/certificate";

type MockRes = {
  statusCode: number;
  body: unknown;
  contentType: string | undefined;
  status: (c: number) => MockRes;
  type: (t: string) => MockRes;
  json: (b: unknown) => MockRes;
  send: (b: unknown) => MockRes;
};
function mockRes(): MockRes {
  const res = { statusCode: 200, body: undefined as unknown, contentType: undefined } as MockRes;
  res.status = (c) => { res.statusCode = c; return res; };
  res.type = (t) => { res.contentType = t; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.send = (b) => { res.body = b; return res; };
  return res;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = async (token: string) => { const res = mockRes(); await getCertificate({ params: { token } } as any, res as any); return res; };

// A platinum supporter who opted into the certificate; earliest donation Dec 2025.
const platinumCtx = {
  band: "platinum" as const,
  wantCertificate: true,
  businessName: "Gorilla Jetwash",
  fullName: "Sam McGorilla",
  supportingSince: new Date(Date.UTC(2025, 11, 5)),
};

beforeEach(() => {
  getCtxMock.mockReset();
});

describe("GET /business/certificate/:token (TASK-211)", () => {
  it("renders the certificate for a platinum token that opted into the certificate", async () => {
    getCtxMock.mockResolvedValue(platinumCtx);
    const res = await run("tok_plat");
    expect(res.statusCode).toBe(200);
    expect(res.contentType).toBe("html");
    const html = String(res.body);
    expect(html).toContain("Gorilla Jetwash"); // the business name is the hero
    expect(html).toContain("Supporting since December 2025"); // derived from earliest donation
    expect(html).toContain("Scottish Charity No. SC047995");
    expect(html).toContain("Certificate of Appreciation");
    expect(html).toContain("Platinum Donor");
  });

  it("falls back to the donor full_name when there is no business_name", async () => {
    getCtxMock.mockResolvedValue({ ...platinumCtx, businessName: null, fullName: "Jane Doe" });
    const res = await run("tok_indiv");
    expect(res.statusCode).toBe(200);
    expect(String(res.body)).toContain("Jane Doe");
  });

  it("404s for an unknown token", async () => {
    getCtxMock.mockResolvedValue(null);
    const res = await run("nope");
    expect(res.statusCode).toBe(404);
  });

  it("404s for a non-platinum token", async () => {
    getCtxMock.mockResolvedValue({ ...platinumCtx, band: "gold" });
    const res = await run("tok_gold");
    expect(res.statusCode).toBe(404);
  });

  it("404s for a platinum token with want_certificate false", async () => {
    getCtxMock.mockResolvedValue({ ...platinumCtx, wantCertificate: false });
    const res = await run("tok_nocert");
    expect(res.statusCode).toBe(404);
  });

  it("escapes a business name so it cannot inject markup", async () => {
    getCtxMock.mockResolvedValue({ ...platinumCtx, businessName: "<script>x</script>" });
    const html = String((await run("tok_xss")).body);
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("formatMonthYear (DB-free pure helper)", () => {
  it("formats a Date as 'Month Year'", () => {
    expect(formatMonthYear(new Date(Date.UTC(2025, 11, 5)))).toBe("December 2025");
    expect(formatMonthYear(new Date(Date.UTC(2026, 0, 1)))).toBe("January 2026");
    expect(formatMonthYear(new Date(Date.UTC(2024, 6, 31)))).toBe("July 2024");
  });

  it("is UTC-based (a start-of-month instant does not roll to the previous month)", () => {
    // Midnight UTC on 1 March — must read as March regardless of the runner's local timezone.
    expect(formatMonthYear(new Date("2025-03-01T00:00:00Z"))).toBe("March 2025");
  });
});

describe("certificateHeroName (DB-free pure helper)", () => {
  it("prefers the business name, falling back to full_name when absent or blank", () => {
    expect(certificateHeroName({ businessName: "Acme Ltd", fullName: "Ada" })).toBe("Acme Ltd");
    expect(certificateHeroName({ businessName: null, fullName: "Jane Doe" })).toBe("Jane Doe");
    expect(certificateHeroName({ businessName: "   ", fullName: "Jane Doe" })).toBe("Jane Doe");
  });
});

describe("renderCertificate copy (task constraint: no dashes in certificate copy)", () => {
  it("contains no hyphen or dash characters in the visible certificate text", () => {
    const html = renderCertificate({
      businessName: "Example Trading Co",
      since: "December 2025",
      fontCss: "",
      logoDataUri: "data:image/png;base64,AA==",
    });
    // Strip <style>, <head> and every tag, leaving only rendered copy. The remaining text must carry
    // no hyphen-minus, en dash or em dash (CSS/HTML syntax with hyphens lives inside the stripped tags).
    const copy = html
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<head[\s\S]*?<\/head>/gi, "")
      .replace(/<[^>]+>/g, " ");
    expect(copy).not.toMatch(/[-‐‑‒–—]/);
    expect(copy).toContain("Certificate of Appreciation");
  });
});
