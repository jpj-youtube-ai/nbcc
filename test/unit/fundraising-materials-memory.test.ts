// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { escapeHtml } from "../../src/events/render";
import { MATERIALS_STATEMENT } from "../../src/legal/registration";
import { materialAssets, materialFacts, renderPoster, renderSocial, renderSponsorForm, SPONSOR_DECLARATION } from "../../src/fundraising/materials";
import { meter, type FundraiserRecord } from "../../src/fundraising/model";

// In memory pages (Jaimie, 2026-10-03): the posters, the leaflet, the pictures to share and the
// sponsor form of a page in memory of someone are the gentle versions. "In memory", "In memory of
// <name>" with the dates, "Give in their memory" by the QR code, the target only if the family chose
// to show it, the quieter colours of the page, and never "Fundraising for NBCC". The charity
// statement, and any split statement, stay word for word. Every name here is invented.

const ROOT = resolve(__dirname, "../..");
const require = createRequire(import.meta.url);
const { initSocial } = require(resolve(ROOT, "assets/js/fundraise-social.js"));

const record = (over: Partial<FundraiserRecord> = {}): FundraiserRecord =>
  ({
    id: 9, slug: "ime", path: "raising", kind: "other", title: "Margaret's Christmas Fund", description: "Remembering Margaret, who loved Christmas.",
    eventDate: null, startTime: null, venue: "", town: "Exampleton", targetPence: 150000, public: true, status: "approved", name: "Sam Sample",
    email: "sam@example.com", phone: "07700 900456", socialLink: null, socialOk: false,
    wants: { posterCount: 0, leafletCount: 0, bucketCount: 0, tinCount: 0, leaflets: 0, buckets: 0, shoutOut: false, attend: false },
    postAddress: null, newsletterOk: false, imageSrc: null, declinedReason: null, createdAt: "2026-10-02T10:00:00.000Z", approvedAt: null,
    approvedBy: null, updatedAt: "2026-10-02T10:00:00.000Z", updatedBy: null, cardLine: null, inMemory: true, memoryName: "Margaret Exampleton",
    memoryDates: "1948 to 2026", memorySetupBy: "family", memoryPermission: true, memoryShowTarget: false, ...over,
  }) as FundraiserRecord;

const URLS = { pageUrl: "https://nbcc.test/fundraise/ime", getInvolvedUrl: "https://nbcc.test/get-involved" };
const facts = (over: Partial<FundraiserRecord> = {}) => materialFacts(record(over), meter({ onlinePence: 30000, cashPence: 0, targetPence: 150000 }), URLS);

describe("the facts an in memory page's materials are drawn from", () => {
  it("carry who it remembers, and nothing for any other page", () => {
    expect(facts().memory).toEqual({ name: "Margaret Exampleton", dates: "1948 to 2026" });
    expect(facts({ inMemory: false }).memory).toBeNull();
  });
});

describe("the poster and the leaflet, in memory", () => {
  for (const size of ["a4", "a5", "a3"] as const) {
    it(`(${size}) are the gentle version: In memory, the name and dates, Give in their memory`, () => {
      const html = renderPoster(facts(), materialAssets(), size);
      expect(html).not.toContain("Fundraising for NBCC");
      expect(html).toContain('class="p-eyebrow">In memory<');
      expect(html).toContain("In memory of Margaret Exampleton");
      expect(html).toContain("1948 to 2026");
      expect(html).toContain("Give in their memory");
      expect(html).not.toContain("Scan to give");
      expect(html).toContain("poster memory");
      expect(html).toContain(escapeHtml(MATERIALS_STATEMENT));
    });
  }

  it("leave the target off unless the family chose to show it, and say it gently when they did", () => {
    expect(renderPoster(facts(), materialAssets())).not.toContain("£1,500");
    const shown = renderPoster(facts({ memoryShowTarget: true }), materialAssets());
    expect(shown).toContain("£1,500");
    expect(shown).not.toContain("Help us raise");
  });

  it("keep the split statement", () => {
    const html = renderPoster(facts({ sharesWithOther: true, nbccSharePercent: 50, otherCauseName: "Exampleton Hospice" }), materialAssets());
    expect(html).toContain("50% of what we raise goes to the Night Before Christmas Campaign");
  });

  it("leave every other poster as it was", () => {
    const html = renderPoster(facts({ inMemory: false, memoryName: null }), materialAssets());
    expect(html).toContain("Fundraising for NBCC");
    expect(html).not.toContain("poster memory");
  });
});

describe("the sponsor form, in memory", () => {
  it("says who it remembers, never Fundraising for NBCC, and keeps HMRC's declaration word for word", () => {
    const html = renderSponsorForm(facts(), materialAssets());
    expect(html).not.toContain("Fundraising for NBCC");
    expect(html).toContain("In memory of Margaret Exampleton, 1948 to 2026");
    expect(html).toContain(escapeHtml(SPONSOR_DECLARATION));
    expect(html).toContain("sf-memory");
  });
});

// --- the pictures to share ------------------------------------------------------------------------

const drawn = new Map<HTMLCanvasElement, string[]>();
function fakeContext(canvas: HTMLCanvasElement) {
  const texts: string[] = [];
  drawn.set(canvas, texts);
  const noop = () => undefined;
  const gradient = { addColorStop: noop };
  return new Proxy(
    {
      font: "10px sans-serif",
      fillText: (t: string) => texts.push(t),
      measureText: function (this: { font: string }, t: string) {
        const size = Number(/(\d+)px/.exec(this.font)?.[1] ?? 10);
        return { width: t.length * size * 0.5 };
      },
      createLinearGradient: () => gradient,
      createRadialGradient: () => gradient,
    } as Record<string, unknown>,
    {
      get: (target, key) => (key in target ? target[key as string] : noop),
      set: (target, key, value) => ((target[key as string] = value), true),
    },
  );
}

beforeEach(() => {
  drawn.clear();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) {
    return fakeContext(this) as unknown as CanvasRenderingContext2D;
  });
});

describe("the pictures to share, in memory", () => {
  const ASSETS = { fontCss: "", logo: "data:image/png;base64,TE9HTw==", logoOnDark: "data:image/png;base64,REFSSw==" };

  it("are drawn gently: In memory, the name, Give in their memory, never Fundraising for NBCC", async () => {
    const html = renderSocial(facts(), ASSETS, "");
    expect(html).not.toContain("Fundraising for NBCC");
    document.documentElement.innerHTML = new DOMParser().parseFromString(html, "text/html").documentElement.innerHTML;
    const data = JSON.parse(document.getElementById("socialData")!.textContent!);
    // The page's colours are cream, so the logo is the one with maroon lettering.
    expect(data.logoOnDark).toBe(ASSETS.logo);
    expect(data.memory).toEqual({ name: "Margaret Exampleton", dates: "1948 to 2026" });
    await initSocial(document, window, { loadImage: () => Promise.resolve(null) }).ready;
    for (const kind of ["square", "portrait", "story", "facebook", "cover"]) {
      const words = (drawn.get(document.querySelector<HTMLCanvasElement>(`canvas[data-social="${kind}"]`)!) ?? []).join(" ");
      expect(words, kind).toContain("IN MEMORY");
      expect(words, kind).not.toContain("FUNDRAISING FOR NBCC");
      expect(words, kind).toContain("Margaret Exampleton");
    }
    const story = (drawn.get(document.querySelector<HTMLCanvasElement>('canvas[data-social="story"]')!) ?? []).join(" ");
    expect(story).toContain("Give in their memory");
  });
});
