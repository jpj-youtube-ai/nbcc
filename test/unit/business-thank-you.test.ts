// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// TASK-212: business-thank-you.html — the private, token-gated, SUBMIT-ONCE thank-you page. On load
// initBusinessThankYou reads the token from the query string (?token=…), GETs
// /api/business/fulfilment/:token and either shows the error card, renders the read-only confirmation
// (already captured), or reveals the capture form (hiding whichever recognition sections the band does
// not earn). Static markup is parsed with jsdom; behaviour runs against the real
// initBusinessThankYou from assets/js/business-thankyou.js, mirroring donor-portal.test.ts.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const html = readFileSync(resolve(ROOT, "business-thank-you.html"), "utf8");
const doc0 = new DOMParser().parseFromString(html, "text/html");
const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

// The four recognition sections and the answer that reveals each one's detail.
const RECS = ["btyRecSupporters", "btyRecSocial", "btyRecBadge", "btyRecCertificate"];

describe("business thank-you page markup (TASK-212)", () => {
  it("is a private page: noindex robots + its own canonical", () => {
    const robots = doc0.querySelector('meta[name="robots"]')?.getAttribute("content") ?? "";
    expect(robots).toMatch(/noindex/i);
    expect(doc0.querySelector('link[rel="canonical"]')?.getAttribute("href")).toContain("/business/thank-you");
  });

  it("carries all four recognition sections, each with a required marker", () => {
    for (const id of RECS) {
      const fs = doc0.getElementById(id);
      expect(fs, `#${id} missing`).not.toBeNull();
      expect(fs?.tagName.toLowerCase()).toBe("fieldset");
      expect(fs?.querySelector(".bty-req"), `#${id} has no required marker`).not.toBeNull();
    }
  });

  it("pre-selects NOTHING: no radio or checkbox ships checked", () => {
    expect(doc0.querySelectorAll("input[checked]").length).toBe(0);
    const inputs = doc0.querySelectorAll<HTMLInputElement>('input[type="radio"], input[type="checkbox"]');
    expect(inputs.length).toBeGreaterThan(0);
    inputs.forEach((el) => expect(el.checked).toBe(false));
  });

  it("makes every top-level recognition question required", () => {
    for (const name of ["listOnSupporters", "wantSocial", "wantBadge", "wantCertificate"]) {
      const radios = doc0.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`);
      expect(radios.length, `${name} radios missing`).toBe(2);
      radios.forEach((r) => expect(r.hasAttribute("required")).toBe(true));
    }
  });

  it("keeps every detail block hidden until a choice reveals it", () => {
    for (const key of ["supporters", "social", "badge", "certificate", "certificateAddress"]) {
      const detail = doc0.querySelector(`[data-detail="${key}"]`);
      expect(detail, `detail ${key} missing`).not.toBeNull();
      expect(detail?.hasAttribute("hidden"), `detail ${key} must start hidden`).toBe(true);
    }
  });

  it("splits the certificate postal address into UK parts", () => {
    for (const id of ["btyAddr1", "btyAddr2", "btyTown", "btyPostcode"]) {
      expect(doc0.getElementById(id), `#${id} missing`).not.toBeNull();
    }
  });

  it("has a single submit control, and a read-only confirmation region that starts hidden", () => {
    expect(doc0.getElementById("btySubmit")).not.toBeNull();
    const confirm = doc0.getElementById("btyConfirm");
    expect(confirm).not.toBeNull();
    expect(confirm?.hasAttribute("hidden")).toBe(true);
  });

  it("offers a friendly fallback (contact + email) when the link is not usable", () => {
    const err = doc0.getElementById("btyError");
    expect(err).not.toBeNull();
    expect(err?.hasAttribute("hidden")).toBe(true);
    expect(err?.querySelector('a[href="/contact"]')).not.toBeNull();
    expect(err?.querySelector('a[href^="mailto:"]')).not.toBeNull();
  });

  it("notes the single-submit + emailed-links behaviour in the copy", () => {
    const body = norm(doc0.querySelector("main")?.textContent).toLowerCase();
    expect(body).toContain("single submit");
    expect(body).toContain("email you your download links");
  });
});

// The task copy constraint: NO dashes of any kind (em, en or hyphen) in the visible page copy. Strip
// <head>, <script>, <style> and every tag (class names / URLs / autocomplete tokens carry hyphens but
// live inside tags), leaving only rendered text. Mirrors business-certificate.test.ts.
describe("business thank-you copy (task constraint: no dashes in page copy)", () => {
  it("contains no hyphen or dash characters in the visible text", () => {
    const copy = html
      .replace(/<!--[\s\S]*?-->/g, "") // HTML comments are not rendered copy (their --> carries dashes)
      .replace(/<head[\s\S]*?<\/head>/gi, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ");
    expect(copy).not.toMatch(/[-‐‑‒–—]/);
  });
});

// --- Behaviour (jsdom), against the real initBusinessThankYou ----------------------------------
const { initBusinessThankYou } = require(resolve(ROOT, "assets/js/business-thankyou.js"));

const TOKEN = "tok_page";
const PLATINUM_PERKS = {
  supportersListing: true,
  newsletter: true,
  socialThankYou: true,
  digitalBadge: true,
  certificate: true,
};
const BRONZE_PERKS = {
  supportersListing: true,
  newsletter: true,
  socialThankYou: false,
  digitalBadge: false,
  certificate: false,
};

function makeWin(fetchImpl: ReturnType<typeof vi.fn>, search = `?token=${TOKEN}`) {
  return { fetch: fetchImpl, location: { search, href: "" } } as unknown as Window & typeof globalThis;
}
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  document.body.innerHTML = doc0.querySelector("main")?.outerHTML ?? "";
});

describe("initBusinessThankYou behaviour (jsdom)", () => {
  it("exports initBusinessThankYou from the page script", () => {
    expect(typeof initBusinessThankYou).toBe("function");
  });

  it("reveals the form and hides the platinum-only sections for a bronze band", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({
      businessName: "Small Bakery Ltd", band: "bronze", perks: BRONZE_PERKS, captured: false, preferences: null,
    }) }) as unknown as Response);
    initBusinessThankYou(document, makeWin(fetchMock));
    await flush();

    expect(String(fetchMock.mock.calls[0][0])).toBe(`/api/business/fulfilment/${TOKEN}`);
    expect(document.getElementById("btyContent")!.hidden).toBe(false);
    expect(document.getElementById("btyForm")!.hidden).toBe(false);
    // Supporters section stays; the three platinum sections are hidden for bronze.
    expect(document.getElementById("btyRecSupporters")!.hidden).toBe(false);
    expect(document.getElementById("btyRecSocial")!.hidden).toBe(true);
    expect(document.getElementById("btyRecBadge")!.hidden).toBe(true);
    expect(document.getElementById("btyRecCertificate")!.hidden).toBe(true);
    expect(norm(document.getElementById("btyName")?.textContent)).toContain("Small Bakery Ltd");
  });

  it("shows every section for a platinum band", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({
      businessName: "Gorilla Jetwash", band: "platinum", perks: PLATINUM_PERKS, captured: false, preferences: null,
    }) }) as unknown as Response);
    initBusinessThankYou(document, makeWin(fetchMock));
    await flush();
    for (const id of RECS) expect(document.getElementById(id)!.hidden).toBe(false);
  });

  it("reveals a detail only after its question is answered Yes", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({
      businessName: "Gorilla Jetwash", band: "platinum", perks: PLATINUM_PERKS, captured: false, preferences: null,
    }) }) as unknown as Response);
    initBusinessThankYou(document, makeWin(fetchMock));
    await flush();

    const detail = document.querySelector('[data-detail="supporters"]') as HTMLElement;
    expect(detail.hidden).toBe(true);
    const show = document.querySelector('input[name="listOnSupporters"][value="yes"]') as HTMLInputElement;
    show.checked = true;
    show.dispatchEvent(new Event("change", { bubbles: true }));
    expect(detail.hidden).toBe(false);
  });

  it("renders the read-only confirmation directly for an already-captured record (submit-once)", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({
      businessName: "Gorilla Jetwash",
      band: "platinum",
      perks: PLATINUM_PERKS,
      captured: true,
      preferences: {
        listOnSupporters: true, creditName: "Gorilla Jetwash", website: null,
        wantSocial: false, socials: null, wantBadge: true, wantCertificate: true,
        certificateDelivery: "download", certificateAddress: null, consentFeatured: true,
      },
    }) }) as unknown as Response);
    initBusinessThankYou(document, makeWin(fetchMock));
    await flush();

    expect(document.getElementById("btyForm")!.hidden).toBe(true);
    const confirm = document.getElementById("btyConfirm")!;
    expect(confirm.hidden).toBe(false);
    expect(norm(confirm.textContent)).toContain("You are all set");
    // The download links the platinum supporter is entitled to.
    expect(confirm.querySelector('a[href="/assets/img/nbcc-supporter-badge.svg"]')).not.toBeNull();
    expect(confirm.querySelector(`a[href="/business/certificate/${TOKEN}"]`)).not.toBeNull();
    // The generated confirmation copy is also dash free.
    expect(norm(confirm.textContent)).not.toMatch(/[-‐‑‒–—]/);
  });

  it("submits ONCE and swaps the form for the confirmation on success", async () => {
    const savedPayload = {
      businessName: "Small Bakery Ltd",
      band: "bronze",
      perks: BRONZE_PERKS,
      captured: true,
      preferences: { listOnSupporters: false, creditName: null, wantSocial: false, wantBadge: false, wantCertificate: false, certificateDelivery: null },
    };
    const fetchMock = vi.fn(async (_url: string, opts?: RequestInit) => {
      if (opts && opts.method === "POST") return { ok: true, json: async () => savedPayload } as unknown as Response;
      return { ok: true, json: async () => ({ businessName: "Small Bakery Ltd", band: "bronze", perks: BRONZE_PERKS, captured: false, preferences: null }) } as unknown as Response;
    });
    initBusinessThankYou(document, makeWin(fetchMock));
    await flush();
    fetchMock.mockClear();

    // Answer the only bronze question with "Keep us private" (no further detail required).
    const priv = document.querySelector('input[name="listOnSupporters"][value="no"]') as HTMLInputElement;
    priv.checked = true;
    priv.dispatchEvent(new Event("change", { bubbles: true }));
    document.getElementById("btyForm")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`/api/business/fulfilment/${TOKEN}`);
    expect((opts as RequestInit)?.method).toBe("POST");
    expect(JSON.parse(String((opts as RequestInit)?.body))).toMatchObject({ listOnSupporters: false });
    expect(document.getElementById("btyForm")!.hidden).toBe(true);
    expect(document.getElementById("btyConfirm")!.hidden).toBe(false);
  });

  it("blocks the submit until the required question is answered (no POST)", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({
      businessName: "Small Bakery Ltd", band: "bronze", perks: BRONZE_PERKS, captured: false, preferences: null,
    }) }) as unknown as Response);
    initBusinessThankYou(document, makeWin(fetchMock));
    await flush();
    fetchMock.mockClear();

    // Submit with nothing answered → a message, no POST.
    document.getElementById("btyForm")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(norm(document.getElementById("btyFormStatus")?.textContent).length).toBeGreaterThan(0);
  });

  it("highlights the required question inline and enforces the credit name via the shared helper (TASK-225)", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({
      businessName: "Small Bakery Ltd", band: "bronze", perks: BRONZE_PERKS, captured: false, preferences: null,
    }) }) as unknown as Response);
    initBusinessThankYou(document, makeWin(fetchMock));
    await flush();
    fetchMock.mockClear();

    // Empty submit: the required Supporters question is flagged at once, summary shown, no POST.
    document.getElementById("btyForm")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    const yes = document.querySelector('input[name="listOnSupporters"][value="yes"]') as HTMLInputElement;
    expect(yes.getAttribute("aria-invalid")).toBe("true");
    expect(norm(document.querySelector('#btyFormStatus[role="alert"]')?.textContent).length).toBeGreaterThan(0);

    // Choosing "Show my business" with no credit name flags that field (a cross-field rule).
    yes.checked = true;
    yes.dispatchEvent(new Event("change", { bubbles: true }));
    document.getElementById("btyForm")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.getElementById("btyCreditName")?.getAttribute("aria-invalid")).toBe("true");
  });

  it("shows the error card and never fetches when the URL carries no token", async () => {
    const fetchMock = vi.fn();
    initBusinessThankYou(document, makeWin(fetchMock, ""));
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.getElementById("btyError")!.hidden).toBe(false);
    expect(document.getElementById("btyContent")!.hidden).toBe(true);
  });

  it("shows the error card when the GET says the link is not valid", async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }) as unknown as Response);
    initBusinessThankYou(document, makeWin(fetchMock));
    await flush();
    expect(document.getElementById("btyError")!.hidden).toBe(false);
    expect(document.getElementById("btyContent")!.hidden).toBe(true);
  });
});
